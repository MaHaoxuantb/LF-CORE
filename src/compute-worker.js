import {runCompute} from './compute-jobs.js';
self.onmessage = async ({data}) => {
 try {const result = await runCompute(data.job); const buffers = [...new Set([...(result?.media || []), ...(result?.pdfs || [])].map(item => item.bytes.buffer))]; self.postMessage({requestId: data.requestId, ok: true, result}, buffers);}
 catch (error) {self.postMessage({requestId: data.requestId, ok: false, error: {name: error.name, message: error.message}});}
};
