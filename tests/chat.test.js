import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextSnapshot, diffMarkdownLines, MAX_CONTEXT_CHARS, parseChatResponse, proposalStatus } from '../src/chat.js';
import { chatModel } from '../src/ai.js';
import { emptyState, loadState, saveState, snapshotWorkspace } from '../src/storage.js';

const workspace = {
  title: 'Plate tectonics',
  article: { markdown: '# Article\n\nOriginal text.', origins: [] },
  nodes: [
    { id: 'node-a', document: { markdown: '# Evidence\n\nOld evidence.' }, origins: [] },
    { id: 'node-b', document: { markdown: '# Motion\n\nOld motion.' }, origins: [] }
  ]
};

test('all context contains every target while preserving the explicit selection', () => {
  const snapshot = contextSnapshot(workspace, { mode: 'all', nodeIds: ['node-b'], passage: { targetId: 'article', quote: 'Original text.' } });
  assert.deepEqual(snapshot.targets.map((target) => target.id), ['article', 'node-a', 'node-b']);
  assert.deepEqual(snapshot.selectedTargetIds, ['node-b', 'article']);
  assert.match(snapshot.text, /Original text/);
  assert.match(snapshot.text, /Old motion/);
  assert.match(snapshot.text, /Old evidence/);
  assert.match(snapshot.text, /Target ID: node-a\nSelection role: REFERENCE/);
  assert.match(snapshot.text, /Target ID: node-b\nSelection role: SELECTED/);
  assert.doesNotMatch(snapshot.text, /Target ID: node-a\nTitle:/);
  assert.ok(snapshot.size < MAX_CONTEXT_CHARS);
});

test('three context scopes send the article, selected nodes, or the whole workspace', () => {
  const article = contextSnapshot(workspace, { mode: 'article', nodeIds: ['node-a'] });
  const selected = contextSnapshot(workspace, { mode: 'selected', nodeIds: ['node-b'] });
  const all = contextSnapshot(workspace, { mode: 'all', nodeIds: [] });
  assert.deepEqual(article.targets.map((target) => target.id), ['article']);
  assert.deepEqual(article.selectedTargetIds, ['article']);
  assert.deepEqual(selected.targets.map((target) => target.id), ['node-b']);
  assert.deepEqual(selected.selectedTargetIds, ['node-b']);
  assert.deepEqual(all.targets.map((target) => target.id), ['article', 'node-a', 'node-b']);
  assert.deepEqual(all.selectedTargetIds, []);
  assert.deepEqual(contextSnapshot(workspace, { article: true, nodeIds: ['node-b'] }).targets.map((target) => target.id), ['article']);
});

test('chat edits are limited to selected targets and valid complete Markdown', () => {
  const result = parseChatResponse('{"reply":"Updated it.","edits":[{"targetId":"node-a","markdown":"New evidence."}]}', ['node-a']);
  assert.equal(result.edits[0].markdown, 'New evidence.');
  assert.throws(() => parseChatResponse('{"reply":"Changed","edits":[{"targetId":"article","markdown":"# Changed"}]}', ['node-a']), /unselected target/);
  assert.throws(() => parseChatResponse('{"reply":"Changed","edits":[{"targetId":"node-a","markdown":""}]}', ['node-a']), /invalid/);
  assert.deepEqual(parseChatResponse('An explanation.', []), { reply: 'An explanation.', edits: [] });
});

test('model receives conversation and current context while preserving target boundaries', async () => {
  let sent;
  const settings = { endpoint: 'https://host.example/v1', models: ['model-a'], selectedModel: 'model-a' };
  const snapshot = contextSnapshot(workspace, { article: false, nodeIds: ['node-a'] });
  const fetcher = async (_url, request) => {
    sent = JSON.parse(request.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"Done.","edits":[{"targetId":"node-a","markdown":"Revised."}]}' } }] }) };
  };
  const result = await chatModel(settings, '', [{ role: 'user', content: 'Earlier question' }], 'Revise it', snapshot, { fetcher });
  assert.equal(result.edits[0].targetId, 'node-a');
  assert.match(JSON.stringify(sent.messages), /Earlier question/);
  assert.match(JSON.stringify(sent.messages), /Old evidence/);
  assert.doesNotMatch(JSON.stringify(sent.messages), /Old motion/);
});

test('all context allows edits only to explicitly selected nodes', async () => {
  let sent;
  const settings = { endpoint: 'https://host.example/v1', models: ['model-a'], selectedModel: 'model-a' };
  const snapshot = contextSnapshot(workspace, { mode: 'all', nodeIds: ['node-b'] });
  const fetcher = async (_url, request) => {
    sent = JSON.parse(request.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"Done.","edits":[{"targetId":"node-b","markdown":"Revised motion."}]}' } }] }) };
  };
  const result = await chatModel(settings, '', [], 'Develop the selected node', snapshot, { fetcher });
  assert.deepEqual(result.edits.map((edit) => edit.targetId), ['node-b']);
  assert.match(sent.messages[0].content, /explicitly selected IDs: \["node-b"\]/);
  assert.throws(() => parseChatResponse('{"reply":"Wrong target","edits":[{"targetId":"node-a","markdown":"Changed."}]}', snapshot.selectedTargetIds), /unselected target/);
});

test('undo can be reflected from target provenance without deleting chat records', () => {
  const proposal = { id: 'proposal-a', targetId: 'node-a', status: 'accepted' };
  assert.equal(proposalStatus(workspace, proposal), 'undone');
  workspace.nodes[0].origins.push({ kind: 'ai', proposalId: 'proposal-a' });
  assert.equal(proposalStatus(workspace, proposal), 'accepted');
  workspace.nodes[0].origins = [];
  assert.equal(proposalStatus(workspace, proposal), 'undone');
});

test('line diff marks additions and removals with stable line numbers', () => {
  const lines = diffMarkdownLines('# Title\nold\nshared\n', '# Title\nnew\nshared\nextra\n');
  assert.deepEqual(lines.map((line) => [line.kind, line.beforeLine, line.afterLine, line.text]), [
    ['context', 1, 1, '# Title'],
    ['removed', 2, null, 'old'],
    ['added', null, 2, 'new'],
    ['context', 3, 3, 'shared'],
    ['added', null, 4, 'extra'],
    ['context', 4, 5, '']
  ]);
});

test('line diff handles identical and large replacements', () => {
  assert.deepEqual(diffMarkdownLines('same', 'same').map((line) => line.kind), ['context']);
  const oldText = Array.from({ length: 600 }, (_, i) => `old ${i}`).join('\n');
  const newText = Array.from({ length: 600 }, (_, i) => `new ${i}`).join('\n');
  const lines = diffMarkdownLines(oldText, newText);
  assert.equal(lines.filter((line) => line.kind === 'removed').length, 600);
  assert.equal(lines.filter((line) => line.kind === 'added').length, 600);
  assert.equal(lines.at(-1).afterLine, 600);
});

test('saved chats reopen separately from workspace undo snapshots', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const state = emptyState();
  state.workspaces.push({ ...workspace, id: 'workspace-a' });
  state.history['workspace-a'] = [snapshotWorkspace(state.workspaces[0])];
  state.chats['workspace-a'] = [{ id: 'chat-a', title: 'A question', messages: [{ role: 'user', content: 'Why?' }] }];
  saveState(state, storage);
  const reopened = loadState(storage);
  assert.equal(reopened.chats['workspace-a'][0].messages[0].content, 'Why?');
  assert.equal(reopened.history['workspace-a'][0].chats, undefined);
});
