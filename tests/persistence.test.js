import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { PersistenceClient } from '../src/persistence-client.js';
import { PersistenceJobs } from '../src/persistence-jobs.js';
import { ViewPersistence } from '../src/view-persistence.js';
import { restoreDatabaseViews } from '../src/state-store.js';
import { createWorkspace, emptyState } from '../src/storage.js';
import { parseProject } from '../src/project.js';
import { LFOSDocuments } from '../src/lfos-documents.js';
import { projectExportBytes } from '../electron/project-export.js';

function fixture() {
  const state = emptyState();
  const first = createWorkspace('First'), second = createWorkspace('Second');
  state.workspaces = [first, second];
  state.history[first.id] = [structuredClone(first)];
  const messages = [], writes = [];
  class MockWorker {
    constructor() {
      this.jobs = new PersistenceJobs({ writeState: async (value) => writes.push(structuredClone(value)), readMedia: async () => null });
      this.queue = Promise.resolve();
    }
    postMessage(message) {
      const data = structuredClone(message);
      messages.push(data.job);
      this.queue = this.queue.then(async () => {
        try { this.onmessage({ data: { requestId: data.requestId, ok: true, result: await this.jobs.run(data.job) } }); }
        catch (error) { this.onmessage({ data: { requestId: data.requestId, ok: false, error } }); }
      });
    }
    terminate() {}
  }
  const client = new PersistenceClient(state, { WorkerRef: MockWorker });
  return { state, first, second, messages, writes, client };
}

test('worker storage sends changed projects and new undo snapshots, preserving the rest of the library', async () => {
  const f = fixture();
  await f.client.ready;
  const baseline = f.state.history[f.first.id][0];
  f.first.title = 'Edited';
  const next = structuredClone(f.first);
  f.state.history[f.first.id].push(next);
  await f.client.save(f.state, new Set([f.first.id]));
  const job = f.messages.at(-1);
  assert.equal(job.projects.length, 1);
  assert.equal(job.snapshots.length, 1);
  assert.equal(f.writes.at(-1).workspaces[1].title, 'Second');
  assert.deepEqual(f.writes.at(-1).history[f.first.id], [baseline, next]);
  await f.client.save(f.state, new Set([f.first.id]));
  assert.equal(f.messages.at(-1).snapshots.length, 0, 'existing undo data must not be cloned on each save');
});

test('worker storage supports undo/redo references, pruning, deletion, and reordered projects', async () => {
  const f = fixture(); await f.client.ready;
  const snapshot = f.state.history[f.first.id].pop();
  f.state.redo[f.first.id] = [snapshot];
  f.state.workspaces.reverse();
  await f.client.save(f.state, new Set([f.first.id]));
  assert.deepEqual(f.writes.at(-1).redo[f.first.id], [snapshot]);
  f.state.redo[f.first.id] = [];
  await f.client.save(f.state, new Set([f.first.id]));
  // A retained reference reappearing after pruning must be sent again.
  f.state.history[f.first.id] = [snapshot];
  await f.client.save(f.state, new Set([f.first.id]));
  assert.deepEqual(f.writes.at(-1).history[f.first.id], [snapshot]);
  f.state.workspaces = [f.second];
  delete f.state.history[f.first.id]; delete f.state.redo[f.first.id];
  await f.client.save(f.state, new Set([f.first.id]));
  assert.equal(f.writes.at(-1).workspaces.length, 1);
  assert.equal(f.writes.at(-1).history[f.first.id], undefined);
});

test('saving one project does not acknowledge unsent undo records from another project', async () => {
  const f = fixture(); await f.client.ready;
  const snapshot = structuredClone(f.second);
  f.state.history[f.second.id] = [snapshot];
  await f.client.save(f.state, new Set([f.first.id]));
  await f.client.save(f.state, new Set([f.second.id]));
  assert.equal(f.messages.at(-1).snapshots.length, 1);
  assert.deepEqual(f.writes.at(-1).history[f.second.id], [snapshot]);
});

test('worker requests capture exact content and report failures rather than claiming a save', async () => {
  const f = fixture(); await f.client.ready;
  const request = f.client.package(f.first, []);
  f.first.title = 'Later edit';
  const packed = await request;
  assert.equal(parseProject(new TextDecoder().decode(packed.contents)).workspace.title, 'First');
  const pending = f.client.package(f.first, []);
  f.client.worker.onerror();
  await assert.rejects(pending, /background save worker stopped/);
  await assert.rejects(f.client.save(f.state, new Set([f.first.id])), /background save worker stopped/);
});

test('a worker storage failure remains retryable and missing undo records never reach disk', async () => {
  const f = fixture(); await f.client.ready;
  const snapshot = structuredClone(f.first);
  f.state.history[f.first.id].push(snapshot);
  const write = f.client.worker.jobs.writeState;
  f.client.worker.jobs.writeState = async () => { throw new Error('quota exhausted'); };
  await assert.rejects(f.client.save(f.state, new Set([f.first.id])), /quota exhausted/);
  f.client.worker.jobs.writeState = write;
  await f.client.save(f.state, new Set([f.first.id]));
  assert.equal(f.writes.at(-1).history[f.first.id].length, 2);
  const count = f.writes.length;
  await assert.rejects(f.client.request({ type: 'save', order: f.state.workspaces.map((item) => item.id), snapshots: [], projects: [{ workspace: f.first, chats: [], history: ['missing'], redo: [] }] }), /undo snapshot is missing/);
  assert.equal(f.writes.length, count);
});

test('camera persistence coalesces updates and never dirties or exports the LFOS document', async () => {
  const writes = [];
  const views = new ViewPersistence({ write: async (id, view) => writes.push([id, view]) });
  const workspace = createWorkspace('Pan test');
  let revision = 0;
  const documents = new LFOSDocuments({
    integration: { has: () => true, saveProject: async () => assert.fail('panning must not export'), release: async () => {} },
    revision: () => revision, snapshot: async () => assert.fail('panning must not package attachments')
  });
  documents.remember(workspace.id, { id: 'file' });
  for (let x = 0; x < 100; x++) {
    workspace.view = { x, y: 20, zoom: 1, outlineOpen: false };
    views.schedule(workspace.id, workspace.view);
  }
  await views.flush();
  await documents.save(workspace.id, { automatic: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].x, 99);
  assert.equal(documents.isDirty(workspace.id), false);
  revision++;
  assert.equal(documents.isDirty(workspace.id), true, 'content edits must still dirty the document');
  const state = emptyState(); state.workspaces.push(workspace);
  workspace.view = { x: 0, y: 0, zoom: 1 };
  await restoreDatabaseViews(state, async () => writes[0][1]);
  assert.equal(workspace.view.x, 99, 'the locally saved camera must survive reopening');
});

test('view persistence retains failed jobs and never retries an older camera over a newer one', async () => {
  let finish, started;
  const start = new Promise((resolve) => { started = resolve; });
  const wait = new Promise((resolve) => { finish = resolve; });
  const writes = [];
  const views = new ViewPersistence({ write: async (id, view) => {
    if (view.x === 1) { started(); await wait; throw new Error('storage failed'); }
    writes.push([id, view.x]);
  } });
  views.schedule('one', { x: 1 });
  views.schedule('two', { x: 10 });
  const first = views.flush();
  await start;
  views.schedule('one', { x: 2 });
  const second = views.flush();
  finish();
  await assert.rejects(first, /storage failed/); await second;
  await views.flush();
  assert.deepEqual(writes, [['two', 10], ['one', 2]]);
});

test('project packaging runs on another thread and returns transferable bytes with embedded media', async () => {
  const workspace = createWorkspace('Threaded export');
  workspace.sources.push({ id: 'attachment', type: 'file', title: 'Attachment', fileName: 'sample.bin' });
  const moduleUrl = new URL('../src/persistence-jobs.js', import.meta.url).href;
  const worker = new Worker(`const { parentPort, threadId } = require('node:worker_threads'); parentPort.on('message', async workspace => {
    const { packageProject } = await import(${JSON.stringify(moduleUrl)});
    const result = await packageProject(workspace, [], async () => new Uint8Array([1, 2, 3]).buffer);
    parentPort.postMessage({ ...result, threadId }, [result.contents]);
  });`, { eval: true });
  try {
    const response = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    worker.postMessage(workspace);
    const result = await response;
    assert.ok(result.threadId > 0);
    assert.ok(result.contents instanceof ArrayBuffer);
    const project = parseProject(new TextDecoder().decode(result.contents));
    assert.equal(project.workspace.title, 'Threaded export');
    assert.deepEqual([...project.media[0].bytes], [1, 2, 3]);
    assert.deepEqual(projectExportBytes('Threaded-export.lfcore', result.contents), Buffer.from(result.contents));
    assert.throws(() => projectExportBytes('old.lfcore', '{}'), /ArrayBuffer/, 'the obsolete string export payload must be rejected');
  } finally { await worker.terminate(); }
});
