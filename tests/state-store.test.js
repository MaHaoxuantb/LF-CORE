import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, emptyState, saveState, STORAGE_KEY } from '../src/storage.js';
import { loadDatabaseState } from '../src/state-store.js';

function memoryStorage() {
  const memory = new Map();
  return {
    memory,
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key)
  };
}

test('moves legacy workspace state to IndexedDB and keeps preferences', async () => {
  const storage = memoryStorage();
  const original = emptyState();
  original.workspaces.push(createWorkspace('Migrated project'));
  saveState(original, storage);
  storage.setItem('learning-canvas:theme-v1', 'dark');
  let databaseState;

  const loaded = await loadDatabaseState({
    storage,
    read: async () => databaseState,
    write: async (state) => { databaseState = structuredClone(state); }
  });

  assert.equal(loaded.workspaces[0].title, 'Migrated project');
  assert.equal(databaseState.workspaces[0].title, 'Migrated project');
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem('learning-canvas:theme-v1'), 'dark');
});

test('does not remove legacy state when the IndexedDB write cannot be verified', async () => {
  const storage = memoryStorage();
  const original = emptyState();
  original.workspaces.push(createWorkspace('Keep the fallback'));
  saveState(original, storage);

  await assert.rejects(loadDatabaseState({
    storage,
    read: async () => undefined,
    write: async () => {}
  }));

  assert.notEqual(storage.getItem(STORAGE_KEY), null);
});

test('loads existing IndexedDB state and clears a leftover verified legacy copy', async () => {
  const storage = memoryStorage();
  const legacy = emptyState();
  legacy.workspaces.push(createWorkspace('Same database copy'));
  saveState(legacy, storage);
  const databaseState = structuredClone(legacy);

  const loaded = await loadDatabaseState({ storage, read: async () => structuredClone(databaseState) });

  assert.equal(loaded.workspaces[0].title, 'Same database copy');
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('preserves a divergent legacy copy when IndexedDB already contains different data', async () => {
  const storage = memoryStorage();
  const legacy = emptyState();
  legacy.workspaces.push(createWorkspace('Possible rollback data'));
  saveState(legacy, storage);
  const databaseState = emptyState();
  databaseState.workspaces.push(createWorkspace('Database copy'));

  const loaded = await loadDatabaseState({ storage, read: async () => structuredClone(databaseState) });

  assert.equal(loaded.workspaces[0].title, 'Database copy');
  assert.notEqual(storage.getItem(STORAGE_KEY), null);
});
