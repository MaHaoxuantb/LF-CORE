import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePdfSourceIndex, readWorkspaceSource, searchWorkspaceSources, textFromPdfItems } from '../src/source-index.js';

test('PDF text items become stable page text', () => {
  assert.equal(textFromPdfItems([{ str: 'Plate' }, { str: 'motion', hasEOL: true }, { str: 'Evidence' }]), 'Plate motion\nEvidence');
});

test('PDF indexes are cached by checksum and report progress', async () => {
  const records = new Map(), progress = [];
  let loads = 0;
  const options = {
    getCached: async (id) => records.get(id),
    putCached: async (id, record) => records.set(id, record),
    loadDocument: async () => ({ numPages: 2, getPage: async (page) => ({ getTextContent: async () => ({ items: [{ str: `Page ${page}` }] }) }) }),
    onProgress: (value) => progress.push(value)
  };
  const source = { id: 'pdf', type: 'pdf', checksum: 'sum' };
  const first = await ensurePdfSourceIndex(source, { ...options, loadDocument: async (...args) => { loads++; return options.loadDocument(...args); } });
  const second = await ensurePdfSourceIndex(source, { ...options, loadDocument: async () => { loads++; } });
  assert.deepEqual(first.pages, ['Page 1', 'Page 2']);
  assert.deepEqual(second.pages, first.pages);
  assert.equal(loads, 1);
  assert.equal(progress.length, 2);
});

test('workspace source search returns bounded ranked passages and page locations', async () => {
  const workspace = { sources: [
    { id: 'text', type: 'text', title: 'Notes', text: 'A long introduction. Plate motion is measured by satellites.' },
    { id: 'pdf', type: 'pdf', title: 'Reader' }
  ] };
  const ensurePdfIndex = async () => ({ pages: ['Plate motion appears on this PDF page.', 'Unrelated.'] });
  const matches = await searchWorkspaceSources(workspace, 'plate motion', { ensurePdfIndex, limit: 4 });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].score >= matches[1].score, true);
  assert.equal(matches.find((match) => match.sourceId === 'pdf').page, 1);
  assert.match(matches.find((match) => match.sourceId === 'text').text, /Plate motion/);
});

test('source reads reject empty scanned PDF pages', async () => {
  const workspace = { sources: [{ id: 'pdf', type: 'pdf', title: 'Scan' }] };
  await assert.rejects(readWorkspaceSource(workspace, 'pdf', { page: 1 }, { ensurePdfIndex: async () => ({ pages: [''] }) }), /OCR is unavailable/);
});

test('PDF indexing stops cleanly when canceled', async () => {
  const controller = new AbortController();
  let saved = false;
  await assert.rejects(ensurePdfSourceIndex({ id: 'pdf', type: 'pdf', checksum: 'sum' }, {
    getCached: async () => null,
    putCached: async () => { saved = true; },
    loadDocument: async () => ({ numPages: 2, getPage: async (page) => ({ getTextContent: async () => ({ items: [{ str: String(page) }] }) }) }),
    onProgress: ({ page }) => { if (page === 1) controller.abort(); },
    signal: controller.signal
  }), /canceled/);
  assert.equal(saved, false);
});
