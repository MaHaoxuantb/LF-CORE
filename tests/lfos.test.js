import test from 'node:test';
import assert from 'node:assert/strict';
import { LFCORE_MIME_TYPE, LFOSIntegration } from '../src/lfos.js';

function framedWindow() { return { self: {}, top: {}, lfos: null }; }

test('LFOS detection stays inactive in a top-level browser', async () => {
  const windowRef = {};
  windowRef.self = windowRef.top = windowRef;
  let loaded = false;
  const integration = new LFOSIntegration({ windowRef, loadSdk: async () => { loaded = true; } });
  assert.equal(await integration.connect(), null);
  assert.equal(loaded, false);
  assert.equal(integration.connected, false);
});

test('LFOS connection is authoritative and exposes only advertised capabilities', async () => {
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities: ['files.open'] }),
    capabilities: { has: (name) => name === 'files.open' }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  await integration.connect();
  assert.equal(integration.connected, true);
  assert.equal(integration.has('files.open'), true);
  assert.equal(integration.has('files.save'), false);
});

test('opening an LFOS project reads the handle and preserves it for later writes', async () => {
  const handle = { id: 'one', name: 'Notes.lfcore', type: LFCORE_MIME_TYPE, lastModified: 7 };
  let options;
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities: ['files.open', 'files.read'] }),
    capabilities: { has: (name) => ['files.open', 'files.read'].includes(name) },
    files: {
      open: async (value) => { options = value; return handle; },
      read: async () => new TextEncoder().encode('{"format":"linecoflow-project"}').buffer,
      release: async () => null
    }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  const opened = await integration.openProject();
  assert.equal(opened.handle, handle);
  assert.equal(opened.file.name, 'Notes.lfcore');
  assert.equal(await opened.file.text(), '{"format":"linecoflow-project"}');
  assert.deepEqual(options.accept[0].extensions, ['.lfcore']);
});

test('initial activation reads the launch file and retains its handle for in-place saves', async () => {
  const handle = { id: 'launch', name: 'Launch.lfcore', type: LFCORE_MIME_TYPE, lastModified: 7 };
  const contents = '{"format":"linecoflow-project"}';
  const calls = [];
  const capabilities = ['activation.getInitial', 'files.read', 'files.write'];
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    capabilities: { has: (name) => capabilities.includes(name) },
    activation: { getInitial: async () => { calls.push('activation.getInitial'); return { type: 'open-file', file: handle }; } },
    files: {
      read: async (value) => { assert.equal(value, handle); calls.push('files.read'); return new TextEncoder().encode(contents).buffer; },
      write: async (value, data) => { assert.equal(value, handle); assert.equal(data, contents); calls.push('files.write'); return handle; }
    }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  const opened = await integration.initialProject();
  assert.equal(opened.handle, handle);
  assert.equal(opened.file.name, handle.name);
  assert.equal(opened.file.type, LFCORE_MIME_TYPE);
  assert.equal(await opened.file.text(), contents);
  const saved = await integration.saveProject({ handle: opened.handle, contents });
  assert.equal(saved.handle, handle);
  assert.deepEqual(calls, ['activation.getInitial', 'files.read', 'files.write']);
});

for (const [scenario, capabilities] of [
  ['ordinary launch', ['files.open', 'files.read']],
  ['obsolete activation capability', ['activation.openFile', 'files.read']],
  ['missing read permission', ['activation.getInitial']]
]) {
  test(`initial activation skips ${scenario}`, async () => {
    const sdk = {
      ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
      capabilities: { has: (name) => capabilities.includes(name) },
      activation: { getInitial: async () => assert.fail('must not request activation') },
      files: { read: async () => assert.fail('must not read a file') }
    };
    const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
    assert.equal(await integration.initialProject(), null);
    assert.equal(integration.connected, true);
  });
}

test('initial activation accepts a null result without reading a file', async () => {
  let requests = 0;
  const capabilities = ['activation.getInitial', 'files.read'];
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    activation: { getInitial: async () => { requests += 1; return null; } },
    files: { read: async () => assert.fail('must not read a file') }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  assert.equal(await integration.initialProject(), null);
  assert.equal(requests, 1);
});

test('saving uses an existing handle in place and Save As requests a new handle', async () => {
  const opened = { id: 'open', name: 'Open.lfcore' };
  const destination = { id: 'save', name: 'Saved.lfcore' };
  const writes = [];
  let saveOptions;
  const capabilities = ['files.save', 'files.write'];
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    capabilities: { has: (name) => capabilities.includes(name) },
    files: {
      save: async (options) => { saveOptions = options; return destination; },
      write: async (handle, data) => { writes.push([handle, data]); return { ...handle, size: data.length }; },
      release: async () => null
    }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  assert.equal((await integration.saveProject({ handle: opened, contents: 'one' })).handle.id, 'open');
  assert.equal((await integration.saveProject({ suggestedName: 'Saved.lfcore', contents: 'two' })).handle.id, 'save');
  assert.deepEqual(writes.map(([handle]) => handle.id), ['open', 'save']);
  assert.equal(saveOptions.requiredExtension, '.lfcore');
});

test('lifecycle dirty state is sent only when it changes', async () => {
  const states = [];
  const capabilities = ['lifecycle.setUnsavedChanges'];
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    capabilities: { has: (name) => capabilities.includes(name) },
    lifecycle: { setUnsavedChanges: async (dirty) => states.push(dirty) }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  await integration.setUnsavedChanges(true);
  await integration.setUnsavedChanges(true);
  await integration.setUnsavedChanges(false);
  assert.deepEqual(states, [true, false]);
});

test('lifecycle updates remain ordered when dirty state changes during a request', async () => {
  const states = [];
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const capabilities = ['lifecycle.setUnsavedChanges'];
  const sdk = {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    capabilities: { has: (name) => capabilities.includes(name) },
    lifecycle: { setUnsavedChanges: async (dirty) => { states.push(dirty); if (dirty) await first; } }
  };
  const integration = new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: sdk }) });
  const dirty = integration.setUnsavedChanges(true);
  const clean = integration.setUnsavedChanges(false);
  await Promise.resolve();
  finishFirst();
  await Promise.all([dirty, clean]);
  assert.deepEqual(states, [true, false]);
  assert.equal(integration.unsavedChanges, false);
});

function intelligenceIntegration({ capabilities = ['ai.responses.text'], create } = {}) {
  return new LFOSIntegration({ windowRef: framedWindow(), loadSdk: async () => ({ lfos: {
    ready: async () => ({ name: 'LFOS', protocolVersion: 1, capabilities }),
    ai: { responses: { create } }
  } }) });
}

test('SolOS AI detection requires both advertised capability and SDK method', async () => {
  for (const options of [{ capabilities: [], create: () => assert.fail('must not generate') }, {}]) {
    const integration = intelligenceIntegration(options);
    await integration.connect();
    assert.equal(integration.intelligenceAvailable, false);
    await assert.rejects(integration.completeText([], 'medium'), /unavailable/);
  }
});

test('SolOS streams map roles, forward each thinking effort, and await completion', async () => {
  for (const effort of ['none', 'low', 'medium', 'high']) {
    let request, cancels = 0;
    const integration = intelligenceIntegration({ create: async value => {
      request = value;
      return {
        completed: Promise.resolve({ text: 'Hello' }),
        cancel: () => cancels++,
        async *[Symbol.asyncIterator]() {
          yield { type: 'output_text.delta', delta: 'Hel' };
          yield { type: 'output_text.delta', delta: 'lo' };
          yield { type: 'completed', usage: {} };
        }
      };
    } });
    const updates = [];
    const messages = [{ role: 'system', content: 'Instructions' }, { role: 'user', content: 'Question' }, { role: 'assistant', content: 'History' }];
    assert.equal(await integration.completeText(messages, effort, { onDelta: (...args) => updates.push(args) }), 'Hello');
    assert.deepEqual(request.input.map(message => message.role), ['developer', 'user', 'assistant']);
    assert.equal(messages[0].role, 'system');
    assert.equal(request.reasoning.effort, effort);
    assert.equal(request.maxOutputTokens, 16384);
    assert.equal('model' in request, false);
    assert.deepEqual(updates, [['Hel', 'Hel'], ['lo', 'Hello']]);
    assert.equal(cancels, 0);
  }
});

test('SolOS rejects failed completion even after partial output and cancels stream', async () => {
  let cancels = 0;
  const failure = Object.assign(new Error('Shared allowance exhausted'), { code: 'ai_allowance_exhausted' });
  const integration = intelligenceIntegration({ create: async () => ({
    completed: Promise.reject(failure), cancel: () => cancels++,
    async *[Symbol.asyncIterator]() { yield { type: 'output_text.delta', delta: 'Partial' }; }
  }) });
  await assert.rejects(integration.completeText([], 'high'), error => error === failure);
  assert.equal(cancels, 1);
});

test('SolOS cancellation during creation and streaming cancels and rejects', async () => {
  for (const duringCreation of [true, false]) {
    const controller = new AbortController();
    let cancels = 0;
    const integration = intelligenceIntegration({ create: async () => {
      if (duringCreation) controller.abort();
      return {
        completed: Promise.resolve({ text: 'Partial' }), cancel: () => cancels++,
        async *[Symbol.asyncIterator]() {
          yield { type: 'output_text.delta', delta: 'Partial' };
          controller.abort();
        }
      };
    } });
    await assert.rejects(integration.completeText([], 'low', { signal: controller.signal }), /canceled/);
    assert.ok(cancels >= 1);
  }
  const controller = new AbortController(); controller.abort();
  const integration = intelligenceIntegration({ create: async () => assert.fail('already canceled') });
  await assert.rejects(integration.completeText([], 'low', { signal: controller.signal }), /canceled/);
});
