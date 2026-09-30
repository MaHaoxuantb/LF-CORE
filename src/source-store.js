const DATABASE = 'learning-canvas-sources-v1';
const VERSION = 3;
const PDF_STORE = 'pdf-bytes';
const TEXT_STORE = 'source-text-index';
const MEDIA_STORE = 'media-bytes';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PDF_STORE)) request.result.createObjectStore(PDF_STORE);
      if (!request.result.objectStoreNames.contains(TEXT_STORE)) request.result.createObjectStore(TEXT_STORE);
      if (!request.result.objectStoreNames.contains(MEDIA_STORE)) request.result.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Source storage could not be opened.'));
  });
}

async function transact(storeName, mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Source storage failed.'));
      transaction.onerror = () => reject(transaction.error || new Error('Source storage failed.'));
    });
  } finally {
    database.close();
  }
}

export const putPdf = (id, bytes) => transact(PDF_STORE, 'readwrite', (store) => store.put(bytes, id));
export const getPdf = (id) => transact(PDF_STORE, 'readonly', (store) => store.get(id));
export const deletePdf = (id) => transact(PDF_STORE, 'readwrite', (store) => store.delete(id));
export const putMedia = (id, bytes) => transact(MEDIA_STORE, 'readwrite', (store) => store.put(bytes, id));
export const getMedia = (id) => transact(MEDIA_STORE, 'readonly', (store) => store.get(id));
export const deleteMedia = (id) => transact(MEDIA_STORE, 'readwrite', (store) => store.delete(id));
export const putSourceTextIndex = (id, record) => transact(TEXT_STORE, 'readwrite', (store) => store.put(record, id));
export const getSourceTextIndex = (id) => transact(TEXT_STORE, 'readonly', (store) => store.get(id));
export const deleteSourceTextIndex = (id) => transact(TEXT_STORE, 'readwrite', (store) => store.delete(id));
