import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachSourceToQuestion, compareIdeas, createResearchProposal, createResearchQuestion,
  discoverSources, normalizeResearch, recordCloseout, verifiedSourceFromResult
} from '../src/research.js';

const ids = (...values) => { let index = 0; return () => values[index++]; };

test('research question keeps selected context and a source trail', () => {
  const workspace = { sources: [] };
  normalizeResearch(workspace);
  const question = createResearchQuestion('Why does this move?', { targetIds: ['node-a'], quote: 'The plate moves.' }, '2026-01-01', ids('q1'));
  workspace.research.questions.push(question);
  const source = verifiedSourceFromResult({ providerId: 'https://openalex.org/W1', title: 'Plate motion', url: 'https://doi.org/10.1/test', authors: ['A. Author'] }, '2026-01-02', ids('s1'));
  attachSourceToQuestion(workspace, question.id, source);
  assert.deepEqual(question.context.targetIds, ['node-a']);
  assert.deepEqual(question.sourceIds, ['s1']);
  assert.equal(workspace.sources[0].discovery.provider, 'OpenAlex');
  assert.equal(workspace.sources[0].discovery.verifiedAt, '2026-01-02');
});

test('source discovery parses verified provider records and rejects network ambiguity', async () => {
  let requested;
  const results = await discoverSources('plate movement', { fetcher: async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ results: [{ id: 'https://openalex.org/W1', display_name: 'Motion', doi: 'https://doi.org/10.1/x', publication_year: 2024, cited_by_count: 4, authorships: [{ author: { display_name: 'R. One' } }], primary_location: { source: { display_name: 'Journal' } } }] }) };
  } });
  assert.match(requested, /api\.openalex\.org\/works/);
  assert.equal(results[0].title, 'Motion');
  assert.deepEqual(results[0].authors, ['R. One']);
  await assert.rejects(() => discoverSources('x', { fetcher: async () => { throw new TypeError('offline'); } }), /Could not reach/);
});

test('comparison flags only a possible contradiction and produces a reviewable merge', () => {
  const result = compareIdeas([
    { id: 'a', title: 'First', text: 'Plate motion increases measured displacement.' },
    { id: 'b', title: 'Second', text: 'Plate motion does not increase measured displacement.' }
  ], '2026-01-01', ids('c1'));
  assert.equal(result.possibleContradictions.length, 1);
  assert.match(result.markdown, /prompt to inspect the sources, not a conclusion/);
});

test('research consolidation remains proposed and preserves its question and sources', () => {
  const workspace = { article: { markdown: '# Article\n\nOriginal.' } };
  const proposal = createResearchProposal(workspace, { text: 'A reviewed finding.', questionId: 'q1', sourceIds: ['s1'] }, '2026-01-01', ids('p1'));
  assert.equal(proposal.status, 'proposed');
  assert.equal(workspace.article.markdown, '# Article\n\nOriginal.');
  assert.match(proposal.after, /A reviewed finding/);
  assert.deepEqual(proposal.sourceIds, ['s1']);
});

test('session closeout keeps current understanding and discrete open questions', () => {
  const closeout = recordCloseout({ understanding: 'I understand the measurement.', openQuestions: '- What drives it?\nHow precise is GPS?' }, '2026-01-01', ids('z1'));
  assert.equal(closeout.understanding, 'I understand the measurement.');
  assert.deepEqual(closeout.openQuestions, ['What drives it?', 'How precise is GPS?']);
});
