import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_LIMITS, WorkspaceAgentService, applyAgentProposal, parseAgentResponse } from '../src/agent-service.js';
import { createWorkspace } from '../src/storage.js';

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

function fixture() {
  const workspace = createWorkspace('Agent test', '# Article\n\nOriginal.');
  workspace.id = 'workspace'; workspace.updatedAt = 'base-time';
  workspace.nodes.push(
    { id: 'a', parentId: null, document: { type: 'markdown', markdown: '# A\n\nAlpha.' }, sourceRefs: [] },
    { id: 'b', parentId: 'a', document: { type: 'markdown', markdown: '# B\n\nBeta.' }, sourceRefs: [] }
  );
  workspace.layout.positions = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
  return workspace;
}

test('agent protocol accepts only bounded allowlisted calls', () => {
  assert.deepEqual(parseAgentResponse('{"status":"ready","message":"Done","calls":[]}'), { status: 'ready', message: 'Done', calls: [] });
  assert.throws(() => parseAgentResponse('not json'), /invalid agent response/);
  assert.throws(() => parseAgentResponse('{"status":"continue","message":"","calls":[{"id":"1","tool":"delete_node","args":{}}]}'), /Unsupported agent tool/);
  const calls = Array.from({ length: AGENT_LIMITS.maxCallsPerTurn + 1 }, (_, index) => ({ id: String(index), tool: 'get_project_index', args: {} }));
  assert.throws(() => parseAgentResponse(JSON.stringify({ status: 'continue', message: '', calls })), /more than/);
});

test('draft tools inspect, create, edit, connect, and remain isolated', async () => {
  const workspace = fixture();
  const service = new WorkspaceAgentService(workspace, { uuid: ids(), now: () => 'proposal-time' });
  const [index, read] = await service.executeCalls([
    { id: 'index', tool: 'get_project_index', args: { limit: 1 } },
    { id: 'read', tool: 'read_document', args: { targetId: 'article', startLine: 1, endLine: 3 } }
  ]);
  assert.equal(index.result.nodes.length, 1);
  assert.match(read.result.text, /Original/);
  const created = await service.executeCalls([{ id: 'create', tool: 'create_node', args: { clientId: 'new', parentId: 'a', markdown: '# New\n\nDraft.' } }]);
  const nodeId = created[0].result.nodeId;
  await service.executeCalls([
    { id: 'edit', tool: 'replace_markdown', args: { targetId: 'article', markdown: '# Article\n\nRevised.' } },
    { id: 'edge', tool: 'create_edge', args: { fromId: 'b', toId: 'new', label: 'extends', direction: 'both' } }
  ]);
  assert.equal(workspace.nodes.length, 2);
  assert.equal(workspace.article.markdown, '# Article\n\nOriginal.');
  assert.equal(service.draft.nodes.find((node) => node.id === nodeId).parentId, 'a');
  assert.equal(service.draft.edges[0].label, 'extends');
});

test('an invalid call makes the whole returned call batch a no-op', async () => {
  const service = new WorkspaceAgentService(fixture(), { uuid: ids() });
  await assert.rejects(service.executeCalls([
    { id: 'valid', tool: 'replace_markdown', args: { targetId: 'a', markdown: '# Changed' } },
    { id: 'invalid', tool: 'set_parent', args: { nodeId: 'a', parentId: 'b' } }
  ]), /cycle/);
  assert.equal(service.draft.nodes.find((node) => node.id === 'a').document.markdown, '# A\n\nAlpha.');
  assert.equal(service.operations.length, 0);
});

test('source passage tokens are required for source attachments', async () => {
  const service = new WorkspaceAgentService(fixture(), {
    uuid: ids(),
    searchSources: async () => [{ sourceId: 'source', title: 'Reader', page: 2, fullText: 'Before useful evidence after', start: 7, end: 22, text: 'useful evidence' }]
  });
  const search = await service.executeCalls([{ id: 'search', tool: 'search_sources', args: { query: 'evidence' } }]);
  const token = search[0].result.matches[0].passageToken;
  await assert.rejects(service.executeCalls([{ id: 'bad', tool: 'attach_source_reference', args: { nodeId: 'a', passageToken: 'made-up' } }]), /not issued/);
  await service.executeCalls([{ id: 'attach', tool: 'attach_source_reference', args: { nodeId: 'a', passageToken: token } }]);
  const reference = service.draft.nodes.find((node) => node.id === 'a').sourceRefs[0];
  assert.equal(reference.page, 2);
  assert.equal(reference.anchor.quote, 'useful evidence');
});

test('parent cycles, duplicate edges, and size limits are rejected', async () => {
  const service = new WorkspaceAgentService(fixture(), { uuid: ids() });
  await assert.rejects(service.executeCalls([{ id: 'cycle', tool: 'set_parent', args: { nodeId: 'a', parentId: 'b' } }]), /cycle/);
  await service.executeCalls([{ id: 'edge', tool: 'create_edge', args: { fromId: 'a', toId: 'b' } }]);
  await assert.rejects(service.executeCalls([{ id: 'duplicate', tool: 'create_edge', args: { fromId: 'b', toId: 'a' } }]), /already connected/);
  await assert.rejects(service.executeCalls([{ id: 'large', tool: 'replace_markdown', args: { targetId: 'a', markdown: 'x'.repeat(AGENT_LIMITS.maxMarkdownChars + 1) } }]), /too large/);
});

test('agent draft enforces mutation and created-node limits', async () => {
  const nodeService = new WorkspaceAgentService(fixture(), { uuid: ids() });
  for (let batch = 0; batch < 2; batch++) {
    const count = batch === 0 ? 8 : AGENT_LIMITS.maxCreatedNodes - 8;
    await nodeService.executeCalls(Array.from({ length: count }, (_, index) => ({ id: `n-${batch}-${index}`, tool: 'create_node', args: { markdown: `# Node ${batch}-${index}` } })));
  }
  await assert.rejects(nodeService.executeCalls([{ id: 'too-many', tool: 'create_node', args: { markdown: '# Extra' } }]), /created-node limit/);

  const mutationService = new WorkspaceAgentService(fixture(), { uuid: ids() });
  for (let batch = 0; batch < 3; batch++) {
    await mutationService.executeCalls(Array.from({ length: 8 }, (_, index) => ({ id: `m-${batch}-${index}`, tool: 'replace_markdown', args: { targetId: 'a', markdown: `# Revision ${batch}-${index}` } })));
  }
  await assert.rejects(mutationService.executeCalls([{ id: 'mutation-extra', tool: 'replace_markdown', args: { targetId: 'a', markdown: '# Extra' } }]), /mutation limit/);
});

test('accepted agent proposals apply atomically and reject stale workspaces', async () => {
  const workspace = fixture();
  const service = new WorkspaceAgentService(workspace, { uuid: ids(), now: () => 'proposal-time' });
  await service.executeCalls([
    { id: 'create', tool: 'create_node', args: { markdown: '# New' } },
    { id: 'edit', tool: 'replace_markdown', args: { targetId: 'article', markdown: '# Revised article' } }
  ]);
  const proposal = service.proposal('Built a branch.');
  const next = applyAgentProposal(workspace, proposal, { acceptedAt: 'accepted-time' });
  assert.equal(next.nodes.length, 3);
  assert.equal(next.article.markdown, '# Revised article');
  assert.equal(next.article.revision, workspace.article.revision + 1);
  assert.equal(next.updatedAt, 'accepted-time');
  assert.equal(workspace.nodes.length, 2);
  assert.throws(() => applyAgentProposal({ ...workspace, updatedAt: 'newer' }, proposal), /workspace changed/);
});
