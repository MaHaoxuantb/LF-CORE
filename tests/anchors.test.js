import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAnchor, resolveAnchor } from '../src/anchors.js';
import { createWorkspace, emptyState, loadSaveMode, loadState, saveSaveMode, saveState } from '../src/storage.js';
import { headingTokens } from '../src/markdown.js';

test('multi-sentence article links survive nearby edits', () => {
  const body = 'Start. First sentence. Second sentence. End.';
  const start = body.indexOf('First');
  const end = body.indexOf(' End.');
  const anchor = makeAnchor('article', body, start, end);
  assert.deepEqual(resolveAnchor(anchor, `New intro. ${body} Extra ending.`), { start: start + 11, end: end + 11 });
  assert.equal(resolveAnchor(anchor, body.replace('First sentence.', 'Changed thought.')), null);
});

test('Markdown workspace, graph sizes, history and redo reopen', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const state = emptyState();
  const workspace = createWorkspace('Topology', '# Topology\n\n## Overview\n\nA connected space.');
  workspace.nodes.push({ id: 'n1', title: 'Idea', parentId: null });
  workspace.layout.positions.n1 = { x: 800, y: 100 };
  workspace.layout.sizes.n1 = { width: 310, height: 165 };
  workspace.layout.articleSize = { width: 660, minHeight: 700 };
  state.workspaces.push(workspace);
  state.history[workspace.id] = [structuredClone(workspace)];
  state.redo[workspace.id] = [structuredClone(workspace)];
  saveState(state, storage);
  const reopened = loadState(storage);
  assert.equal(reopened.workspaces[0].nodes[0].title, 'Idea');
  assert.match(reopened.workspaces[0].article.markdown, /## Overview/);
  assert.equal(reopened.workspaces[0].layout.positions.n1.x, 800);
  assert.deepEqual(reopened.workspaces[0].layout.sizes.n1, { width: 310, height: 165 });
  assert.deepEqual(reopened.workspaces[0].layout.articleSize, { width: 660, minHeight: 700 });
  assert.equal(reopened.history[workspace.id].length, 1);
  assert.equal(reopened.redo[workspace.id].length, 1);
});

test('previous canvas sections migrate to Markdown without changing stored originals', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const oldWorkspace = createWorkspace('Old');
  oldWorkspace.article = { id: 'a', revision: 2, sections: [{ id: 's', title: 'Overview', body: 'A body.' }] };
  oldWorkspace.nodes = [{ id: 'n', title: 'Note', kind: 'question', anchor: { sectionId: 's', start: 0, end: 2, quote: 'A body.', prefix: '', suffix: '' } }];
  oldWorkspace.layout = { positions: { n: { x: 10, y: 20 } } };
  const old = { version: 2, history: { [oldWorkspace.id]: [structuredClone(oldWorkspace)] }, workspaces: [oldWorkspace] };
  memory.set('learning-canvas:canvas-v2', JSON.stringify(old));
  const migrated = loadState(storage);
  assert.equal(migrated.version, 4);
  assert.match(migrated.workspaces[0].article.markdown, /# Old\n\n## Overview\n\nA body\./);
  assert.equal(migrated.workspaces[0].nodes[0].parentId, null);
  assert.equal(migrated.workspaces[0].nodes[0].kind, undefined);
  assert.equal(migrated.workspaces[0].nodes[0].anchor.start, -1);
  assert.equal(migrated.workspaces[0].nodes[0].anchor.targetId, 'article');
  assert.equal(migrated.workspaces[0].nodes[0].anchor.sectionId, undefined);
  assert.deepEqual(migrated.workspaces[0].nodes[0].document, { type: 'markdown', markdown: '' });
  assert.equal(migrated.history[oldWorkspace.id].length, 1);
  assert.equal(JSON.parse(memory.get('learning-canvas:canvas-v2')).version, 2);
});

test('saved card notes migrate to Markdown in workspaces and undo history', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const workspace = createWorkspace('Saved');
  const anchor = makeAnchor('parent', 'Selected passage.', 0, 8);
  workspace.nodes = [
    { id: 'parent', title: 'Parent', body: '**Important** detail', parentId: null },
    { id: 'child', title: 'Child', body: 'A note', parentId: 'parent', anchor }
  ];
  const old = { version: 3, workspaces: [workspace], history: { [workspace.id]: [structuredClone(workspace)] }, redo: { [workspace.id]: [structuredClone(workspace)] } };
  memory.set('learning-canvas:markdown-v3', JSON.stringify(old));
  const migrated = loadState(storage);
  for (const copy of [migrated.workspaces[0], migrated.history[workspace.id][0], migrated.redo[workspace.id][0]]) {
    assert.deepEqual(copy.nodes[0].document, { type: 'markdown', markdown: '**Important** detail' });
    assert.deepEqual(copy.nodes[1].document, { type: 'markdown', markdown: 'A note' });
    assert.equal(copy.nodes[1].anchor.targetId, 'parent');
    assert.equal(copy.nodes[0].body, undefined);
  }
  assert.equal(JSON.parse(memory.get('learning-canvas:markdown-v3')).version, 3);
});

test('save preference is independent of workspace data', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(loadSaveMode(storage), 'auto');
  saveSaveMode('manual', storage);
  assert.equal(loadSaveMode(storage), 'manual');
  assert.equal(memory.has('learning-canvas:documents-v4'), false);
  saveSaveMode('auto', storage);
  assert.equal(loadSaveMode(storage), 'auto');
  assert.throws(() => saveSaveMode('sometimes', storage), /Unsupported save mode/);
});

test('outline uses headings and skips fenced code', () => {
  assert.deepEqual(headingTokens('# A\n\nText\n\n```md\n# Not a heading\n```\n\n### B'), [
    { level: 1, title: 'A' }, { level: 3, title: 'B' }
  ]);
});
