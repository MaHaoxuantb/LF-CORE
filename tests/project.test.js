import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/storage.js';
import { parseProject, projectFileName, serializeProject } from '../src/project.js';

test('a project round trip preserves content and remaps storage identities', () => {
  const workspace = createWorkspace('Ocean / currents', '# Ocean currents\n\nNotes.');
  workspace.accentColor = 'blue';
  workspace.sources.push({ id: 'pdf-old', type: 'pdf', title: 'Reader', fileName: 'reader.pdf', pages: 2 });
  workspace.nodes.push({ id: 'node-1', document: { type: 'markdown', markdown: '# Gyres' }, sourceRefs: [{ sourceId: 'pdf-old', anchor: { targetId: 'pdf-old', quote: 'water' } }] });
  workspace.nodes.push({ id: 'source-node-1', document: { type: 'source', sourceId: 'pdf-old' }, sourceRefs: [] });
  workspace.research.questions.push({ id: 'q1', text: 'Why?', sourceIds: ['pdf-old'] });
  workspace.research.findings.push({ id: 'f1', sourceIds: ['pdf-old'], status: 'proposed' });
  const serialized = serializeProject(workspace, [{ id: 'chat-1', title: 'Question' }], new Map([['pdf-old', new Uint8Array([37, 80, 68, 70])]]), '2026-09-21T00:00:00.000Z');
  const ids = ['pdf-new', 'workspace-new'];
  const imported = parseProject(serialized, { uuid: () => ids.shift(), now: () => '2026-09-22T00:00:00.000Z' });
  assert.equal(imported.workspace.id, 'workspace-new');
  assert.equal(imported.workspace.sources[0].id, 'pdf-new');
  assert.equal(imported.workspace.nodes[0].sourceRefs[0].sourceId, 'pdf-new');
  assert.equal(imported.workspace.nodes[0].sourceRefs[0].anchor.targetId, 'pdf-new');
  assert.deepEqual(imported.workspace.nodes[1].document, { type: 'source', sourceId: 'pdf-new' });
  assert.deepEqual(imported.workspace.research.questions[0].sourceIds, ['pdf-new']);
  assert.deepEqual(imported.workspace.research.findings[0].sourceIds, ['pdf-new']);
  assert.deepEqual(imported.pdfs[0], { id: 'pdf-new', bytes: new Uint8Array([37, 80, 68, 70]) });
  assert.equal(imported.chats[0].title, 'Question');
  assert.equal(imported.workspace.accentColor, 'blue');
  assert.equal(workspace.id === imported.workspace.id, false);
});

test('project files reject unsupported data and missing PDFs', () => {
  assert.throws(() => parseProject('{bad json'), /not a valid LinecoFlow project/);
  assert.throws(() => parseProject(JSON.stringify({ format: 'linecoflow-project', version: 99 })), /unsupported format or version/);
  const workspace = createWorkspace('Missing PDF');
  workspace.sources.push({ id: 'missing', type: 'pdf', title: 'Missing' });
  assert.throws(() => serializeProject(workspace, [], new Map()), /PDF “Missing” is missing/);
});

test('project filenames are portable and clearly identified', () => {
  assert.equal(projectFileName('  Études / waves?  '), 'Etudes-waves.lfcore');
  assert.equal(projectFileName('***'), 'Untitled-project.lfcore');
});
