export function makeAnchor(targetId, text, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) {
    throw new Error('Select article text before creating a node.');
  }
  const quote = text.slice(start, end);
  if (!quote.trim()) throw new Error('Select article text before creating a node.');
  return { id: crypto.randomUUID(), targetId, start, end, quote, prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40) };
}

function commonSuffix(a, b) {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
}

function commonPrefix(a, b) {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count++;
  return count;
}

export function resolveAnchor(anchor, text) {
  if (!anchor || !anchor.quote || !text) return null;
  const candidates = [];
  let cursor = 0;
  while ((cursor = text.indexOf(anchor.quote, cursor)) !== -1) {
    const end = cursor + anchor.quote.length;
    const context = commonSuffix(anchor.prefix || '', text.slice(Math.max(0, cursor - 40), cursor))
      + commonPrefix(anchor.suffix || '', text.slice(end, end + 40));
    candidates.push({ start: cursor, end, context, distance: Math.abs(cursor - anchor.start) });
    cursor += 1;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.context - a.context || a.distance - b.distance);
  if (candidates.length > 1 && candidates[0].context === candidates[1].context && candidates[0].distance === candidates[1].distance) return null;
  return { start: candidates[0].start, end: candidates[0].end };
}

export function selectionOffsets(element, selection = window.getSelection()) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return { start: before.toString().length, end: before.toString().length + range.toString().length };
}
