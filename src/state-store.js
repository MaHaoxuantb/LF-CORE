import { clearLegacyState, emptyState, hasLegacyState, loadState, normalizeState } from './storage.js';

const DATABASE = 'learning-canvas-state-v1';
const STORE = 'records';
const STATE_KEY = 'workspace-state';

function openDatabase() {
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

export const readDatabaseState = () => transact('readonly', (store) => store.get(STATE_KEY));
export const writeDatabaseState = (state) => transact('readwrite', (store) => store.put(state, STATE_KEY));

export async function loadDatabaseState({
  read = readDatabaseState,
  write = writeDatabaseState,
  storage = localStorage
} = {}) {
  const stored = await read();
  if (stored != null) {
    const loaded = normalizeState(stored);
    if (hasLegacyState(storage)) {
      const legacy = loadState(storage);
      if (JSON.stringify(legacy) === JSON.stringify(loaded)) clearLegacyState(storage);
    }
    return loaded;
  }

  const hadLegacyState = hasLegacyState(storage);
  const migrated = hadLegacyState ? loadState(storage) : emptyState();
  await write(migrated);

  // Do not remove the only known-good copy until IndexedDB can return a valid,
  // byte-equivalent state record.
  const verified = normalizeState(await read());
  if (JSON.stringify(verified) !== JSON.stringify(migrated)) {
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
