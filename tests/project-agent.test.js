import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/storage.js';
import { ProjectAgentService, projectCapabilities, projectSession, readAgentAttachment } from '../src/project-agent.js';
import { serializeProject, parseProject } from '../src/project.js';

function fixture(options = {}) {
  let workspace = createWorkspace('Project', '# Article\n\nOriginal paragraph.');
  workspace.projectRevision = 0;
  const history = [];
  const service = new ProjectAgentService({
    getWorkspace: () => workspace,
    commit: async (before, next) => { history.push(before); workspace = next; },
    readSource: async () => ({ sourceId: 'source', fullText: 'Verified source passage.', text: 'Verified source passage.', start: 0, end: 24 }),
    ...options,
  });
  let sequence = 0;
  const call = (tool, args = {}, overrides = {}) => service.invoke({ capability: `com.linecoflow.lfcore.${tool}`, arguments: args, sessionId: projectSession(workspace).id, taskId: 'task', operationId: `op-${++sequence}`, expectedRevision: workspace.projectRevision, ...overrides });
  return { service, call, history, get workspace() { return workspace; } };
}

test('project tools apply durable transactions with revision preconditions and receipts', async () => {
  const f = fixture();
  const original = structuredClone(f.workspace);
  const result = await f.call('create_node', { markdown: '# New node' }, { operationId: 'create-once' });
  assert.equal(f.workspace.nodes.length, 1); assert.equal(result.revision, 1); assert.equal(f.history.length, 1);
  const repeated = await f.call('create_node', { markdown: '# New node' }, { operationId: 'create-once', expectedRevision: 0 });
  assert.deepEqual(repeated, result); assert.equal(f.workspace.nodes.length, 1); assert.equal(f.history.length, 1);
  assert.equal(original.nodes.length, 0);
  await assert.rejects(f.call('create_node', { markdown: '# Different' }, { operationId: 'create-once' }), /different request/);
  await assert.rejects(f.call('replace_markdown', { targetId: 'article', markdown: '# Stale' }, { expectedRevision: 0 }), { code: 'CONFLICT' });
  assert.equal((await f.service.operationStatus({ sessionId: 'session', operationId: 'create-once' })).status, 'committed');
});
test('precise edits preserve unrelated content and reject ambiguous matches', async () => {
  const f = fixture();
  await f.call('edit_markdown', { targetId: 'article', before: 'Original paragraph.', after: 'Revised paragraph.' });
  assert.equal(f.workspace.article.markdown, '# Article\n\nRevised paragraph.');
  await assert.rejects(f.call('edit_markdown', { targetId: 'article', before: 'Missing', after: 'x' }), /exactly once/);
});
test('invalid graph edits and failed persistence leave the original state intact', async () => {
  const f = fixture({ commit: async () => { throw new Error('Disk full'); } });
  await assert.rejects(f.call('create_node', { markdown: '# Draft' }), /Disk full/);
  assert.equal(f.workspace.nodes.length, 0); assert.equal(f.workspace.agentReceipts, undefined);
  const graph = fixture(); const a = await graph.call('create_node', { markdown: '# A' });
  const b = await graph.call('create_node', { markdown: '# B', parentId: a.nodeId });
  await assert.rejects(graph.call('set_parent', { nodeId: a.nodeId, parentId: b.nodeId }), /cycle/);
  await graph.call('delete_node', { nodeId: a.nodeId });
  assert.equal(graph.workspace.nodes[0].parentId, null);
});
test('concurrent writes serialize and reject the stale second request', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.call('create_node', { markdown: '# A' }, { expectedRevision: 0 }), f.call('create_node', { markdown: '# B' }, { expectedRevision: 0 })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(f.workspace.nodes.length, 1);
});
test('source tokens remain scoped to a task and provenance survives attachment', async () => {
  const f = fixture();
  f.workspace.sources.push({ id: 'source', type: 'text', title: 'Source', text: 'Verified source passage.' });
  const node = await f.call('create_node', { markdown: '# Finding' });
  const passage = await f.call('read_source_passage', { sourceId: 'source' });
  await assert.rejects(f.call('attach_source_reference', { nodeId: node.nodeId, passageToken: passage.passageToken }, { taskId: 'other-task' }), /not issued/);
  await f.call('attach_source_reference', { nodeId: node.nodeId, passageToken: passage.passageToken });
  assert.equal(f.workspace.nodes[0].sourceRefs[0].agentRunId, 'task');
  assert.equal(f.workspace.nodes[0].sourceRefs[0].anchor.quote, 'Verified source passage.');
});
test('research and source capabilities operate on the full project', async () => {
  const f = fixture();
  const source = await f.call('import_source', { title: 'Local evidence', text: 'Plates move slowly.' });
  await f.call('update_research', { kind: 'questions', text: 'How do plates move?', sourceIds: [source.sourceId] });
  const records = await f.call('read_research', { kind: 'questions' });
  assert.equal(records.records.length, 1);
  assert.equal((await f.call('search_project', { query: 'plates' })).matches.length, 1);
  await f.call('delete_source', { sourceId: source.sourceId });
  assert.deepEqual(f.workspace.research.questions[0].sourceIds, []);
  assert.ok(projectCapabilities(f.workspace).some(item => item.effect === 'destructive'));
});
test('cancellation before commit cannot publish a change', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.invoke({ capability: 'com.linecoflow.lfcore.create_node', arguments: { markdown: '# A' }, sessionId: projectSession(f.workspace).id, taskId: 'task', operationId: 'op', expectedRevision: 0 }, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(f.workspace.nodes.length, 0);
});
test('project exports retain task summaries but exclude live receipts and task handles', async () => {
  const f = fixture(); await f.call('create_node', { markdown: '# New' });
  const exported = serializeProject(f.workspace, [{ messages: [{ role: 'assistant', content: 'Done', agentTaskId: 'live', agentTask: { status: 'completed', summary: 'Done' } }] }]);
  const bundle = JSON.parse(exported);
  assert.equal(bundle.project.workspace.agentReceipts, undefined); assert.equal(bundle.project.chats[0].messages[0].agentTaskId, undefined);
  const imported = parseProject(exported);
  assert.equal(imported.workspace.projectRevision, 0); assert.equal(imported.chats[0].messages[0].agentTask.summary, 'Done');
});

test('project index includes source nodes and aliases survive separate mutations', async () => {
  const f = fixture();
  const source = await f.call('import_source', { title: 'Source', text: 'Evidence.' });
  const sourceCard = await f.call('create_source_node', { sourceId: source.sourceId });
  const parent = await f.call('create_node', { clientId: 'parent', markdown: '# Parent' });
  await f.call('create_node', { markdown: '# Child', parentId: 'parent' });
  await f.call('create_edge', { fromId: sourceCard.nodeId, toId: parent.nodeId });
  const index = await f.call('get_project_index');
  assert.equal(index.nodes.length, 3);
  assert.ok(index.nodes.some(node => node.type === 'source' && node.sourceId === source.sourceId));
  assert.equal(f.workspace.nodes.at(-1).parentId, parent.nodeId);
});

test('parallel source reads retain both passage tokens', async () => {
  const f = fixture();
  f.workspace.sources.push({ id: 'source', type: 'text', title: 'Source', text: 'Verified source passage.' });
  const node = await f.call('create_node', { markdown: '# Finding' });
  const passages = await Promise.all([f.call('read_source_passage', { sourceId: 'source' }), f.call('read_source_passage', { sourceId: 'source' })]);
  for (const passage of passages) await f.call('attach_source_reference', { nodeId: node.nodeId, passageToken: passage.passageToken });
  assert.equal(f.workspace.nodes[0].sourceRefs.length, 2);
});

test('attachment import and project export register readable source artifacts', async () => {
  const f = fixture({
    importAttachment: async args => ({ id: 'file', type: 'file', title: args.fileName }),
    exportProject: async () => ({ sourceId: 'export', fileName: 'Project.lfcore', bytes: 123, mimeType: 'application/json' }),
  });
  await f.call('import_attachment', { fileName: 'data.txt', mimeType: 'text/plain', dataBase64: 'SGVsbG8=' });
  await f.call('export_project');
  assert.deepEqual(f.workspace.sources.map(source => source.id), ['file']);
  assert.equal(f.workspace.agentArtifacts[0].id, 'export');
});


test('operation status waits for in-flight commits before reporting absence', async () => {
  let release, started;
  const committing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let workspace = createWorkspace('Project', '# Article');
  const service = new ProjectAgentService({ getWorkspace: () => workspace, commit: async (_before, next) => { started(); await gate; workspace = next; } });
  const write = service.invoke({ capability: 'com.linecoflow.lfcore.create_node', arguments: { markdown: '# New' }, sessionId: projectSession(workspace).id, taskId: 'task', operationId: 'pending', expectedRevision: 0 });
  await committing;
  let settled = false;
  const receipt = service.operationStatus({ sessionId: projectSession(workspace).id, operationId: 'pending' }).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release(); await write;
  assert.equal((await receipt).status, 'committed');
});

test('source deletion removes dependent highlights, edges, anchors and layout', async () => {
  const f = fixture();
  const source = await f.call('import_source', { title: 'Evidence', text: 'Text' });
  const card = await f.call('create_source_node', { sourceId: source.sourceId });
  const other = await f.call('create_node', { markdown: '# Other' });
  f.workspace.highlights = [{ id: 'highlight', targetId: card.nodeId }];
  f.workspace.nodes.find(node => node.id === other.nodeId).anchor = { targetId: card.nodeId };
  f.workspace.edges.push({ id: 'edge', fromId: 'h:highlight', toId: other.nodeId });
  f.workspace.layout = { positions: { [card.nodeId]: { x: 0, y: 0 } }, sizes: { [card.nodeId]: { width: 100 } } };
  await f.call('delete_source', { sourceId: source.sourceId });
  assert.deepEqual(f.workspace.highlights, []);
  assert.deepEqual(f.workspace.edges, []);
  assert.equal(f.workspace.nodes[0].anchor, null);
  assert.equal(f.workspace.layout.positions[card.nodeId], undefined);
});

test('precise edits resolve task aliases without changing caller arguments', async () => {
  const f = fixture();
  const node = await f.call('create_node', { clientId: 'note', markdown: '# Before' });
  const args = { targetId: 'note', before: 'Before', after: 'After' };
  await f.call('edit_markdown', args);
  assert.equal(args.targetId, 'note');
  assert.equal(f.workspace.nodes.find(entry => entry.id === node.nodeId).document.markdown, '# After');
});


test('attachment reads reject missing bytes and invalid ranges, preserving valid empty files', async () => {
  const workspace = createWorkspace('Project');
  workspace.sources.push({ id: 'file', title: 'File', type: 'file' });
  const args = { sourceId: 'file' };
  const store = value => ({ getMedia: async () => value });
  await assert.rejects(readAgentAttachment(workspace, args, store(null)), { code: 'NOT_FOUND' });
  for (const range of [{ offset: -1 }, { length: 0 }, { length: 24001 }, { offset: 0.5 }]) {
    await assert.rejects(readAgentAttachment(workspace, { ...args, ...range }, store(new ArrayBuffer(0))), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal((await readAgentAttachment(workspace, args, store(new ArrayBuffer(0)))).totalBytes, 0);
  const bytes = new Uint8Array([9, 65, 66, 67, 9]);
  const result = await readAgentAttachment(workspace, { ...args, offset: 1, length: 2 }, store(bytes.subarray(1, 4)));
  assert.equal(result.totalBytes, 3);
  assert.equal(result.data, btoa('BC'));
});
