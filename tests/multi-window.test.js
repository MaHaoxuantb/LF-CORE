import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createWorkspace, emptyState } from '../src/storage.js';
import { openDatabase, readDatabaseState, commitDatabaseProjects, loadDatabaseState } from '../src/state-store.js';
import { PersistenceClient } from '../src/persistence-client.js';
import { PersistenceJobs } from '../src/persistence-jobs.js';
import { WindowCoordinator } from '../src/window-coordinator.js';

globalThis.indexedDB = indexedDB;
const storage = { getItem: () => null };
async function reset() {
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('learning-canvas-state-v1'); r.onsuccess = resolve; r.onerror = () => reject(r.error); });
}
async function seed() {
  await reset();
  const state = emptyState();
  state.workspaces = [createWorkspace('A'), createWorkspace('B')];
  await commitDatabaseProjects(state, { ids: state.workspaces.map(w => w.id) });
  return state.workspaces.map(w => w.id);
}
function workerClient(state) {
  class MockWorker {
    constructor() { this.jobs = new PersistenceJobs({ writeState: commitDatabaseProjects }); this.queue = Promise.resolve(); }
    postMessage(message) {
      const { requestId, job } = structuredClone(message);
      this.queue = this.queue.then(async () => {
        try { this.onmessage({ data: { requestId, ok: true, result: await this.jobs.run(job) } }); }
        catch (error) { this.onmessage({ data: { requestId, ok: false, error } }); }
      });
    }
    terminate() {}
  }
  return new PersistenceClient(state, { WorkerRef: MockWorker });
}

test('two windows save separate projects without losing either edit', async () => {
  const [a, b] = await seed();
  const one = await readDatabaseState(), two = await readDatabaseState();
  const first = workerClient(one), second = workerClient(two);
  await Promise.all([first.ready, second.ready]);
  one.workspaces[0].title = 'A edited'; two.workspaces[1].title = 'B edited';
  await Promise.all([first.save(one, new Set([a])), second.save(two, new Set([b]))]);
  const saved = await readDatabaseState();
  assert.deepEqual(saved.workspaces.map(w => w.title), ['A edited', 'B edited']);
  assert.equal(saved.databaseRevisions[a], 2); assert.equal(saved.databaseRevisions[b], 2);
});

test('stale writers conflict atomically without partially updating other projects', async () => {
  const [a, b] = await seed();
  const one = await readDatabaseState(), stale = await readDatabaseState();
  one.workspaces[0].title = 'Authoritative A';
  await commitDatabaseProjects(one, { ids: [a], expected: one.databaseRevisions });
  stale.workspaces[1].title = 'Must not commit';
  await assert.rejects(commitDatabaseProjects(stale, { ids: [b, a], expected: stale.databaseRevisions }), { name: 'ConflictError' });
  assert.deepEqual((await readDatabaseState()).workspaces.map(w => w.title), ['Authoritative A', 'B']);
});

test('stale library orders cannot remove a concurrently created project or resurrect a deleted project', async () => {
  const [a, b] = await seed();
  const stale = await readDatabaseState(), other = await readDatabaseState();
  const c = createWorkspace('C'); other.workspaces.unshift(c);
  await commitDatabaseProjects(other, { ids: [c.id], expected: other.databaseRevisions });
  stale.workspaces = stale.workspaces.filter(w => w.id !== a);
  await commitDatabaseProjects(stale, { ids: [a], expected: stale.databaseRevisions });
  other.workspaces.find(w => w.id === b).title = 'B edited';
  await commitDatabaseProjects(other, { ids: [b], expected: other.databaseRevisions });
  const saved = await readDatabaseState();
  assert.deepEqual(saved.workspaces.map(w => w.title), ['C', 'B edited']);
  await assert.rejects(commitDatabaseProjects(other, { ids: [a], expected: other.databaseRevisions }), { name: 'ConflictError' });
});

test('queued saves use the revision acknowledged by the previous worker commit', async () => {
  const [a] = await seed(); const state = await readDatabaseState(); const client = workerClient(state);
  await client.ready;
  state.workspaces[0].title = 'First'; const first = client.save(state, new Set([a]));
  state.workspaces[0].title = 'Second'; const second = client.save(state, new Set([a]));
  await Promise.all([first, second]);
  assert.equal((await readDatabaseState()).workspaces[0].title, 'Second');
  assert.equal(state.databaseRevisions[a], 3);
});

test('old whole-library state migrates atomically with chats and undo intact', async () => {
  await reset(); const db = await openDatabase(); const state = emptyState(); const workspace = createWorkspace('Migrated');
  state.workspaces.push(workspace); state.history[workspace.id] = [structuredClone(workspace)]; state.chats[workspace.id] = [{ id: 'chat' }];
  await new Promise((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(state, 'workspace-state'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  const [one, two] = await Promise.all([readDatabaseState(), readDatabaseState()]);
  assert.deepEqual(one, two); assert.deepEqual(one.history, state.history); assert.deepEqual(one.chats, state.chats);
  assert.equal(one.databaseRevisions[workspace.id], 1);
  assert.equal((await loadDatabaseState({ storage })).workspaces[0].title, 'Migrated');
});

test('real IndexedDB migration verifies localStorage before removing its only copy', async () => {
  await reset(); const state = emptyState(); state.workspaces.push(createWorkspace('Local migration'));
  const memory = new Map([['learning-canvas:documents-v4', JSON.stringify(state)]]);
  const local = { getItem: key => memory.get(key) ?? null, removeItem: key => memory.delete(key) };
  const loaded = await loadDatabaseState({ storage: local });
  assert.equal(loaded.workspaces[0].title, 'Local migration');
  assert.equal(memory.size, 0); assert.equal(loaded.databaseRevisions[loaded.workspaces[0].id], 1);
});

function lockManager() {
  const held = new Set();
  return { request: async (name, options, callback) => {
    if (held.has(name)) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
test('project leases exclude a second writer, request owner focus, and hand off on release', async () => {
  const locks = lockManager(), channels = new Set(), focused = [];
  class Channel {
    constructor() { channels.add(this); }
    postMessage(data) { for (const channel of channels) if (channel !== this) channel.onmessage?.({ data }); }
    close() { channels.delete(this); }
  }
  const one = new WindowCoordinator({ locks, Channel, onFocus: key => focused.push(key) });
  const two = new WindowCoordinator({ locks, Channel });
  assert.equal(await one.acquire('project:A'), true);
  assert.equal(await two.acquire('project:B'), true);
  assert.equal(await two.acquire('project:A'), false);
  assert.deepEqual(focused, ['project:A']);
  one.release('project:A'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await two.acquire('project:A'), true);
  one.close(); two.close();
});

test('unsupported browsers fail closed rather than creating uncoordinated writers', async () => {
  const coordinator = new WindowCoordinator({ locks: null, Channel: null });
  await assert.rejects(coordinator.acquire('project:A'), /Web Locks/);
});

test('a live library refresh can introduce projects absent from an existing worker mirror', async () => {
  const [a] = await seed(); const state = await readDatabaseState(); const client = workerClient(state); await client.ready;
  const other = await readDatabaseState(); const created = createWorkspace('Created later'); other.workspaces.unshift(created);
  await commitDatabaseProjects(other, { ids: [created.id], expected: other.databaseRevisions });
  state.workspaces.unshift(structuredClone(created));
  state.workspaces.find(w => w.id === a).title = 'Still editable';
  await client.save(state, new Set([a]));
  const saved = await readDatabaseState();
  assert.equal(saved.workspaces.find(w => w.id === a).title, 'Still editable');
  assert.equal(saved.workspaces.find(w => w.id === created.id).title, 'Created later');
});

test('deleting the last project does not resurrect a divergent legacy fallback on reload', async () => {
  const ids = await seed(); const state = await readDatabaseState();
  state.workspaces = []; await commitDatabaseProjects(state, { ids, expected: state.databaseRevisions });
  const legacy = emptyState(); legacy.workspaces.push(createWorkspace('Divergent fallback'));
  const memory = new Map([['learning-canvas:documents-v4', JSON.stringify(legacy)]]);
  const local = { getItem: key => memory.get(key) ?? null, removeItem: key => memory.delete(key) };
  assert.equal((await loadDatabaseState({ storage: local })).workspaces.length, 0);
  assert.equal(memory.size, 1);
});
