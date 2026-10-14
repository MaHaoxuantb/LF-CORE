let sequence = 0;
let worker = null;
let queue = Promise.resolve();
export function backgroundCompute(job, signal) {
 const next = queue.catch(() => {}).then(() => {
  if (signal?.aborted) throw new DOMException('Work canceled.', 'AbortError');
  return new Promise((resolve, reject) => {
   worker ||= new Worker('/dist/compute-worker.js', {type: 'module'});
   const current = worker, requestId = ++sequence;
   const cleanup = () => {signal?.removeEventListener('abort', cancel); current.onmessage = null; current.onerror = null; current.onmessageerror = null;};
   const fail = error => {cleanup(); current.terminate(); if (worker === current) worker = null; reject(error);};
   const cancel = () => fail(new DOMException('Work canceled.', 'AbortError'));
   signal?.addEventListener('abort', cancel, {once: true});
   current.onmessage = ({data}) => {if (data.requestId !== requestId) return; cleanup(); if (data.ok) resolve(data.result); else reject(Object.assign(new Error(data.error.message), {name: data.error.name}));};
   current.onerror = current.onmessageerror = () => fail(new Error('Background processing stopped. Keep your project and retry.'));
   try {current.postMessage({requestId, job});} catch (error) {fail(error);}
  });
 }); queue = next; return next;
}
