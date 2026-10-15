import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createWorkspace} from '../src/storage.js';
import {serializeProject} from '../src/project.js';

test('project import decodes exact attachment bytes on a real worker and survives invalid jobs', async () => {
 const worker = new Worker(new URL('./fixtures/compute-node.js', import.meta.url));
 const call = job => new Promise((resolve, reject) => {
  worker.once('message', resolve); worker.once('error', reject);
  worker.postMessage({requestId: 1, job});
 });
 try {
  const workspace = createWorkspace('Worker fixture');
  workspace.sources.push({id: 'pdf', type: 'pdf', title: 'Fixture'});
  const bytes = new Uint8Array([37,80,68,70,0,255,128]);
  const serialized = serializeProject(workspace, [], new Map([['pdf', bytes]]));
  const imported = await call({type: 'import', file: new Blob([serialized])});
  assert.equal(imported.ok, true);
  assert.equal(imported.result.workspace.title, workspace.title);
  assert.deepEqual(imported.result.pdfs[0].bytes, bytes);
  const invalid = await call({type: 'import', file: new Blob(['{bad'])});
  assert.equal(invalid.ok, false);
  const recovered = await call({type: 'import', file: new Blob([serialized])});
  assert.equal(recovered.ok, true);
 } finally {await worker.terminate();}
});
