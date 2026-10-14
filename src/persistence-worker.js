import { PersistenceJobs } from './persistence-jobs.js';
import { writeDatabaseState } from './state-store.js';
import { getPdf, getMedia } from './source-store.js';

const jobs = new PersistenceJobs({
  writeState: writeDatabaseState,
  readMedia: (source) => source.type === 'pdf' ? getPdf(source.id) : getMedia(source.id)
});
let queue = Promise.resolve();
self.onmessage = ({ data: { requestId, job } }) => {
  const operation = queue.then(() => jobs.run(job));
  queue = operation.catch(() => {});
  operation.then((result) => {
    self.postMessage({ requestId, ok: true, result }, result?.contents instanceof ArrayBuffer ? [result.contents] : []);
  }, (error) => self.postMessage({ requestId, ok: false, error: { name: error.name, message: error.message } }));
};
