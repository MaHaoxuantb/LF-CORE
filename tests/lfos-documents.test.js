import test from 'node:test';
import assert from 'node:assert/strict';
import { LFOSDocuments } from '../src/lfos-documents.js';

function fixture() {
  let content = 'original';
  let revision = 0;
  const writes = [], releases = [];
  const integration = {
    has: () => true,
    saveProject: async ({ handle, contents }) => {
      writes.push({ handle, contents });
      return { handle: handle || { id: 'new' }, cancelled: false };
    },
    release: async (handle) => releases.push(handle.id)
  };
  const store = new LFOSDocuments({
    integration,
    revision: () => revision,
    snapshot: async () => ({ revision, contents: content, name: 'Notes.lfcore' })
  });
  store.remember('project', { id: 'opened' });
  return { store, integration, writes, releases, edit: (value) => { content = value; revision++; } };
}

test('autosave writes only changed linked files, without opening a picker', async () => {
  const f = fixture();
  await f.store.save('project', { automatic: true });
  await f.store.save('local', { automatic: true });
  assert.equal(f.writes.length, 0);
  f.edit('edited');
  await f.store.save('project', { automatic: true });
  assert.deepEqual(f.writes, [{ handle: { id: 'opened' }, contents: 'edited' }]);
  assert.equal(f.store.isDirty('project'), false);
});

test('edits during a write stay dirty and the next queued save writes them', async () => {
  const f = fixture();
  let finishWrite, started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const writePromise = new Promise((resolve) => { finishWrite = resolve; });
  const save = f.integration.saveProject;
  f.integration.saveProject = async (options) => { started(); await writePromise; return save(options); };
  f.edit('first');
  const first = f.store.save('project', { automatic: true });
  await startedPromise;
  f.edit('second');
  finishWrite();
  await first;
  assert.equal(f.store.isDirty('project'), true);
  await f.store.save('project', { automatic: true });
  assert.deepEqual(f.writes.map((write) => write.contents), ['first', 'second']);
  assert.equal(f.store.isDirty('project'), false);
});

test('conflicts preserve dirty state and pause automatic retries until Save As', async () => {
  const f = fixture();
  const save = f.integration.saveProject;
  let attempts = 0;
  f.integration.saveProject = async () => { attempts++; throw Object.assign(new Error('changed elsewhere'), { code: 'CONFLICT' }); };
  f.edit('edited');
  await assert.rejects(f.store.save('project', { automatic: true }), { code: 'CONFLICT' });
  await f.store.save('project', { automatic: true });
  assert.equal(attempts, 1);
  assert.equal(f.store.isDirty('project'), true);
  assert.equal(f.store.entries.get('project').error.code, 'CONFLICT');
  f.integration.saveProject = save;
  await f.store.save('project', { saveAs: true, allowPicker: true });
  assert.equal(f.store.entries.get('project').handle.id, 'new');
  assert.equal(f.store.entries.get('project').error, null);
  assert.deepEqual(f.releases, ['opened']);
  f.edit('later');
  await f.store.save('project', { automatic: true });
  assert.equal(f.writes.at(-1).handle.id, 'new');
});

test('Save As and autosave run in order and use the new destination', async () => {
  const f = fixture();
  let finish, started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  const save = f.integration.saveProject;
  f.integration.saveProject = async (options) => {
    if (!options.handle) { started(); await pending; }
    return save(options);
  };
  f.edit('first');
  const saveAs = f.store.save('project', { saveAs: true, allowPicker: true });
  await startedPromise;
  f.edit('second');
  const automatic = f.store.save('project', { automatic: true });
  finish();
  await Promise.all([saveAs, automatic]);
  assert.deepEqual(f.writes.map((write) => [write.handle?.id, write.contents]), [[undefined, 'first'], ['new', 'second']]);
});

test('forgetting a document during a write releases it without recreating its binding', async () => {
  const f = fixture();
  let finish, started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  f.integration.saveProject = async () => { started(); await pending; return { handle: { id: 'updated' }, cancelled: false }; };
  f.edit('edited');
  const save = f.store.save('project');
  await startedPromise;
  const forgotten = f.store.forget('project');
  finish();
  await Promise.all([save, forgotten]);
  assert.equal(f.store.entries.has('project'), false);
  assert.deepEqual(f.releases, ['opened', 'updated']);
});

test('cancelled Save As keeps the original destination and dirty state', async () => {
  const f = fixture();
  f.edit('edited');
  f.integration.saveProject = async () => ({ cancelled: true, handle: null });
  await f.store.save('project', { saveAs: true });
  assert.equal(f.store.entries.get('project').handle.id, 'opened');
  assert.equal(f.store.isDirty('project'), true);
  assert.deepEqual(f.releases, []);
});

test('cancelling Save As after a conflict keeps background autosave paused', async () => {
  const f = fixture();
  f.edit('edited');
  const conflict = Object.assign(new Error('changed elsewhere'), { code: 'CONFLICT' });
  f.integration.saveProject = async () => { throw conflict; };
  await assert.rejects(f.store.save('project', { automatic: true }), { code: 'CONFLICT' });
  f.integration.saveProject = async () => ({ cancelled: true, handle: null });
  await f.store.save('project', { saveAs: true });
  assert.equal(f.store.entries.get('project').error, conflict);
  f.integration.saveProject = async () => assert.fail('must not retry a conflicted destination');
  await f.store.save('project', { automatic: true });
});
