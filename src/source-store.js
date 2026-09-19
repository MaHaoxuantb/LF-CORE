const DATABASE = 'learning-canvas-sources-v1';
const STORE = 'pdf-bytes';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Source storage could not be opened.'));
  });
}

async function transact(id, mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Source storage failed.'));
      transaction.onerror = () => reject(transaction.error || new Error('Source storage failed.'));
    });
  } finally {
    database.close();
  }
}

export const putPdf = (id, bytes) => transact(id, 'readwrite', (store) => store.put(bytes, id));
export const getPdf = (id) => transact(id, 'readonly', (store) => store.get(id));
export const deletePdf = (id) => transact(id, 'readwrite', (store) => store.delete(id));
