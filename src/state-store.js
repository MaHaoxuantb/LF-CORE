import { clearLegacyState, emptyState, hasLegacyState, loadState, normalizeState } from './storage.js';

const DATABASE = 'learning-canvas-state-v1';
const STORE = 'records';
const STATE_KEY = 'workspace-state';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Workspace storage could not be opened.'));
    request.onblocked = () => reject(new Error('Workspace storage upgrade is blocked by another LF CORE tab.'));
  });
}

async function transact(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Workspace storage failed.'));
      transaction.onerror = () => reject(transaction.error || new Error('Workspace storage failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Workspace storage was interrupted.'));
    });
  } finally {
    database.close();
  }
}

// Migrate the old whole-library record in one transaction. Keeping the same
// object store lets existing installations upgrade without blocking open tabs.
const PROJECT_PREFIX = 'project:';
const LIBRARY_KEY = 'library-v2';
function projectRecord(state, workspace, revision = 1) {
  const id = workspace.id;
  return { workspace, revision, history: state.history[id] || [], redo: state.redo[id] || [], chats: state.chats[id] || [] };
}
async function databaseOperation(action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      let result, failure;
      const fail = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Project storage failed.'));
      const store = tx.objectStore(STORE);
      const meta = store.get(LIBRARY_KEY);
      meta.onsuccess = () => {
        if (meta.result) return action(store, meta.result, value => { result = value; }, fail);
        const legacy = store.get(STATE_KEY);
        legacy.onsuccess = () => {
          try {
            const state = legacy.result == null ? emptyState() : normalizeState(legacy.result);
            const library = { order: state.workspaces.map(w => w.id), initialized: legacy.result != null };
            for (const workspace of state.workspaces) store.put(projectRecord(state, workspace), PROJECT_PREFIX + workspace.id);
            store.put(library, LIBRARY_KEY);
            store.delete(STATE_KEY);
            action(store, library, value => { result = value; }, fail);
          } catch (error) { fail(error); }
        };
      };
    });
  } finally { db.close(); }
}
export function readDatabaseState() {
  return databaseOperation((store, library, done) => {
    const state = emptyState(); state.databaseRevisions = {}; state.databaseInitialized = library.initialized !== false;
    let remaining = library.order.length;
    if (!remaining) return done(state);
    const records = new Map();
    for (const id of library.order) {
      const request = store.get(PROJECT_PREFIX + id);
      request.onsuccess = () => {
        records.set(id, request.result);
        if (--remaining) return;
        for (const id of library.order) {
          const record = records.get(id); if (!record) continue;
          state.workspaces.push(record.workspace);
          for (const kind of ['history', 'redo', 'chats']) state[kind][id] = record[kind];
          state.databaseRevisions[id] = record.revision;
        }
        done(state);
      };
    }
  });
}
// Only explicitly changed/deleted IDs participate; stale library lists cannot
// delete projects created by another window. Compare and write in one IDB tx.
export function commitDatabaseProjects(state, { ids, expected = {} }) {
  return databaseOperation((store, library, done, fail) => {
    const changes = [...new Set(ids)]; const revisions = {};
    const projects = new Map(state.workspaces.map(w => [w.id, w]));
    let remaining = changes.length;
    if (!remaining) return done(revisions);
    const records = new Map();
    for (const id of changes) {
      const request = store.get(PROJECT_PREFIX + id);
      request.onsuccess = () => {
        records.set(id, request.result);
        if (--remaining) return;
        for (const id of changes) {
          if ((records.get(id)?.revision || 0) !== (expected[id] || 0)) {
            return fail(Object.assign(new Error('This project changed in another window. Reopen it before saving.'), { name: 'ConflictError' }));
          }
        }
        const deleted = new Set();
        for (const id of changes) {
          const workspace = projects.get(id);
          if (!workspace) { store.delete(PROJECT_PREFIX + id); deleted.add(id); revisions[id] = 0; }
          else {
            revisions[id] = (expected[id] || 0) + 1;
            store.put(projectRecord(state, workspace, revisions[id]), PROJECT_PREFIX + id);
          }
        }
        const order = library.order.filter(id => !deleted.has(id));
        for (const workspace of [...state.workspaces].reverse()) if (changes.includes(workspace.id) && !order.includes(workspace.id)) order.unshift(workspace.id);
        store.put({ order, initialized: true }, LIBRARY_KEY);
        done(revisions);
      };
    }
  });
}
export const writeDatabaseState = state => commitDatabaseProjects(state, { ids: state.workspaces.map(w => w.id), expected: state.databaseRevisions });
export const writeDatabaseView = (id, view) => transact('readwrite', (store) => store.put(view, `view:${id}`));

export async function restoreDatabaseViews(state, read = (id) => transact('readonly', (store) => store.get(`view:${id}`))) {
  await Promise.all(state.workspaces.map(async (workspace) => {
    const view = await read(workspace.id);
    if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom) && view.zoom > 0) workspace.view = { x: view.x, y: view.y, zoom: view.zoom, outlineOpen: !!view.outlineOpen };
  }));
}

function comparableState(state) {
  return JSON.stringify(state.workspaces.map(workspace => ({
    workspace, history: state.history[workspace.id] || [], redo: state.redo[workspace.id] || [], chats: state.chats[workspace.id] || []
  })));
}

export async function loadDatabaseState({
  read = readDatabaseState,
  write = writeDatabaseState,
  storage = localStorage
} = {}) {
  const stored = await read();
  if (stored != null && (stored.workspaces.length || stored.databaseInitialized || !hasLegacyState(storage))) {
    const loaded = normalizeState(stored);
    if (hasLegacyState(storage)) {
      const legacy = loadState(storage);
      if (comparableState(legacy) === comparableState(loaded)) clearLegacyState(storage);
    }
    return loaded;
  }

  const hadLegacyState = hasLegacyState(storage);
  const migrated = hadLegacyState ? loadState(storage) : emptyState();
  await write(migrated);

  // Do not remove the only known-good copy until IndexedDB can return a valid,
  // byte-equivalent state record.
  const verified = normalizeState(await read());
  if (comparableState(verified) !== comparableState(migrated)) {
    throw new Error('Workspace migration could not be verified. Existing browser data was left untouched.');
  }
  if (hadLegacyState) clearLegacyState(storage);
  return verified;
}

export async function requestPersistentStorage(storageManager = navigator.storage) {
  if (!storageManager?.persist) return false;
  try { return await storageManager.persist(); }
  catch { return false; }
}
