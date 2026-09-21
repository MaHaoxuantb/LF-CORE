import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextSnapshot, MAX_CONTEXT_CHARS, parseChatResponse, proposalStatus } from '../src/chat.js';
import { chatModel } from '../src/ai.js';
import { emptyState, loadState, saveState, snapshotWorkspace } from '../src/storage.js';

const workspace = {
  title: 'Plate tectonics',
  article: { markdown: '# Article\n\nOriginal text.', origins: [] },
  nodes: [
    { id: 'node-a', title: 'Evidence', document: { markdown: 'Old evidence.' }, origins: [] },
    { id: 'node-b', title: 'Motion', document: { markdown: 'Old motion.' }, origins: [] }
  ]
};

test('all context contains the article, nodes, and passage without silent truncation', () => {
  const snapshot = contextSnapshot(workspace, { mode: 'all', passage: { targetId: 'article', quote: 'Original text.' } });
  assert.deepEqual(snapshot.targets.map((target) => target.id), ['article', 'node-a', 'node-b']);
  assert.match(snapshot.text, /Original text/);
  assert.match(snapshot.text, /Old motion/);
  assert.match(snapshot.text, /Old evidence/);
  assert.ok(snapshot.size < MAX_CONTEXT_CHARS);
});

test('three context scopes send the article, selected nodes, or the whole workspace', () => {
  const article = contextSnapshot(workspace, { mode: 'article', nodeIds: ['node-a'] });
  const selected = contextSnapshot(workspace, { mode: 'selected', nodeIds: ['node-b'] });
  const all = contextSnapshot(workspace, { mode: 'all', nodeIds: [] });
  assert.deepEqual(article.targets.map((target) => target.id), ['article']);
  assert.deepEqual(selected.targets.map((target) => target.id), ['node-b']);
  assert.deepEqual(all.targets.map((target) => target.id), ['article', 'node-a', 'node-b']);
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

test('undo can be reflected from target provenance without deleting chat records', () => {
  const proposal = { id: 'proposal-a', targetId: 'node-a', status: 'accepted' };
  assert.equal(proposalStatus(workspace, proposal), 'undone');
  workspace.nodes[0].origins.push({ kind: 'ai', proposalId: 'proposal-a' });
  assert.equal(proposalStatus(workspace, proposal), 'accepted');
  workspace.nodes[0].origins = [];
  assert.equal(proposalStatus(workspace, proposal), 'undone');
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
