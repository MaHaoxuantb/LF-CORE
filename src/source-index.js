function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Source indexing was canceled.', 'AbortError');
}

export function textFromPdfItems(items = []) {
  let text = '';
  for (const item of items) {
    const value = typeof item?.str === 'string' ? item.str : '';
    if (!value) continue;
    if (text && !/\s$/.test(text) && !/^\s/.test(value)) text += ' ';
    text += value;
    if (item.hasEOL) text += '\n';
  }
  return text.trim();
}

export async function ensurePdfSourceIndex(source, {
  getCached,
  putCached,
  loadDocument,
  onProgress = () => {},
  signal
}) {
  if (!source || source.type !== 'pdf') throw new Error('Only PDF sources need text extraction.');
  const cached = await getCached(source.id);
  if (cached && cached.checksum === (source.checksum || null) && Array.isArray(cached.pages)) return cached;
  abortIfNeeded(signal);
  const document = await loadDocument(source.id);
  if (!document) throw new Error('PDF bytes are missing. Reattach the original file.');
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    abortIfNeeded(signal);
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(textFromPdfItems(content.items));
    onProgress({ sourceId: source.id, page: pageNumber, pages: document.numPages });
  }
  const record = { sourceId: source.id, checksum: source.checksum || null, pages, indexedAt: new Date().toISOString() };
  await putCached(source.id, record);
  return record;
}

function queryTerms(query) {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
}

function excerpts(text, query, terms, limit) {
  const lower = text.toLocaleLowerCase();
  const exact = lower.indexOf(query.toLocaleLowerCase());
  const hits = [];
  if (exact >= 0) hits.push({ index: exact, score: 100 + query.length });
  for (const term of terms) {
    let index = 0, count = 0;
    while ((index = lower.indexOf(term, index)) >= 0 && count < 6) {
      hits.push({ index, score: term.length }); index += term.length; count++;
    }
  }
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  for (const hit of hits) {
    if (selected.some((entry) => Math.abs(entry.index - hit.index) < 120)) continue;
    selected.push(hit);
    if (selected.length >= limit) break;
  }
  return selected.map(({ index, score }) => {
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + 420);
    return { start, end, text: text.slice(start, end), score };
  });
}

export async function searchWorkspaceSources(workspace, query, {
  sourceIds,
  limit = 8,
  ensurePdfIndex,
  signal,
  onProgress
} = {}) {
  const allowed = Array.isArray(sourceIds) && sourceIds.length ? new Set(sourceIds) : null;
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('Use at least one searchable word.');
  const results = [];
  for (const source of workspace.sources || []) {
    if (allowed && !allowed.has(source.id)) continue;
    abortIfNeeded(signal);
    if (source.type === 'text') {
      for (const match of excerpts(source.text || '', query, terms, limit)) results.push({ sourceId: source.id, title: source.title, page: null, fullText: source.text || '', ...match });
    } else if (source.type === 'pdf') {
      const record = await ensurePdfIndex(source, { signal, onProgress });
      record.pages.forEach((text, index) => {
        for (const match of excerpts(text, query, terms, limit)) results.push({ sourceId: source.id, title: source.title, page: index + 1, fullText: text, ...match });
      });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || (a.page || 0) - (b.page || 0)).slice(0, limit);
}

export async function readWorkspaceSource(workspace, sourceId, { page = 1, start = 0, end } = {}, { ensurePdfIndex, signal, onProgress } = {}) {
  const source = (workspace.sources || []).find((entry) => entry.id === sourceId);
  if (!source) throw new Error('Source not found.');
  let text, resolvedPage = null;
  if (source.type === 'text') text = source.text || '';
  else if (source.type === 'pdf') {
    const record = await ensurePdfIndex(source, { signal, onProgress });
    if (!Number.isInteger(Number(page)) || Number(page) < 1 || Number(page) > record.pages.length) throw new Error('PDF page is outside the document.');
    resolvedPage = Number(page); text = record.pages[resolvedPage - 1] || '';
    if (!text.trim()) throw new Error('No selectable text was found on this page. OCR is unavailable.');
  } else throw new Error('This source type does not expose local text.');
  const from = Math.max(0, Number.isInteger(Number(start)) ? Number(start) : 0);
  const to = Math.min(text.length, Number.isInteger(Number(end)) ? Number(end) : from + 4_000);
  if (from >= to) throw new Error('The requested source range is empty.');
  return { sourceId, title: source.title, page: resolvedPage, fullText: text, start: from, end: to, text: text.slice(from, to) };
}
