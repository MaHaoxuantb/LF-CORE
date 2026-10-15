import {parentPort} from 'node:worker_threads';
globalThis.self = {postMessage: (value, transfer) => parentPort.postMessage(value, transfer)};
await import('../../src/compute-worker.js');
parentPort.on('message', data => self.onmessage({data}));
