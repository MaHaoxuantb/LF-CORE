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
