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

export function highlightAtSelection(highlights, targetId, text, selection) {
  return highlights.find((highlight) => {
    if (highlight.targetId !== targetId) return false;
    const range = resolveAnchor(highlight, text);
    return range?.start === selection.start && range?.end === selection.end;
  });
}

// Read formula source once, replacing both of KaTeX's rendering trees.
export function passageText(element) {
  if (element.nodeType === 1 && element.matches('[data-math-source]')) return element.dataset.mathSource;
  const clone = element.cloneNode(true);
  for (const formula of clone.querySelectorAll('[data-math-source]')) {
    formula.replaceWith(formula.ownerDocument.createTextNode(formula.dataset.mathSource));
  }
  return clone.textContent || '';
}

export function passageOffset(element, node, offset = 0) {
  const before = element.ownerDocument.createRange();
  before.selectNodeContents(element);
  if (node.nodeType === 1 && node.matches('[data-math-source]') && offset === 0) before.setEndBefore(node);
  else before.setEnd(node, offset);
  return passageText(before.cloneContents()).length;
}

export function selectionOffsets(element, selection = window.getSelection()) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(element)) return null;
  // A reverse drag can finish just beyond the first character or preview edge.
  // Keep the portion inside this document rather than discarding the selection.
  if (!element.contains(range.startContainer)) range.setStart(element, 0);
  if (!element.contains(range.endContainer)) range.setEnd(element, element.childNodes.length);
  const formulaAt = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-math-source]');
  const first = formulaAt(range.startContainer), last = formulaAt(range.endContainer);
  if (first && element.contains(first)) {
    const tail = element.ownerDocument.createRange();
    tail.selectNodeContents(first); tail.setStart(range.startContainer, range.startOffset);
    if (tail.toString()) range.setStartBefore(first);
    else range.setStartAfter(first);
  }
  if (last && element.contains(last)) {
    const head = element.ownerDocument.createRange();
    head.selectNodeContents(last); head.setEnd(range.endContainer, range.endOffset);
    if (head.toString()) range.setEndAfter(last);
    else range.setEndBefore(last);
  }
  const fragment = range.cloneContents();
  const start = passageOffset(element, range.startContainer, range.startOffset);
  const end = start + passageText(fragment).length;
  if (start === end) return null;
  return { start, end, ...(fragment.querySelector('[data-math-source]') ? { containsMath: true } : {}) };
}
