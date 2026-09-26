export const MAX_CONTEXT_CHARS = 40_000;

export function contextSnapshot(workspace, selection) {
  const targets = [];
  const mode = selection.mode || (selection.article ? 'article' : 'selected');
  if (mode === 'article' || mode === 'all') targets.push({ id: 'article', title: 'Master article', markdown: workspace.article.markdown });
  const nodeIds = mode === 'all' ? workspace.nodes.filter((node) => !isSourceNode(node)).map((node) => node.id) : mode === 'selected' ? selection.nodeIds || [] : [];
  for (const id of [...new Set(nodeIds)]) {
    const node = workspace.nodes.find((entry) => entry.id === id);
    if (node && !isSourceNode(node)) targets.push({ id, title: nodeLabel(node, workspace.sources), markdown: node.document?.markdown || '' });
  }
  const requestedSelection = mode === 'article' ? ['article'] : selection.nodeIds || [];
  const selectedTargetIds = [...new Set(requestedSelection)].filter((id) => targets.some((target) => target.id === id));
  const passage = selection.passage && targets.some((target) => target.id === selection.passage.targetId)
    ? { targetId: selection.passage.targetId, quote: selection.passage.quote } : null;
  if (passage && !selectedTargetIds.includes(passage.targetId)) selectedTargetIds.push(passage.targetId);
  const selected = new Set(selectedTargetIds);
  const text = [
    `Workspace: ${workspace.title}`,
    `Context scope: ${mode === 'all' ? 'all workspace content' : mode === 'article' ? 'master article' : 'selected nodes only'}\nExplicitly selected target IDs: ${selectedTargetIds.length ? selectedTargetIds.join(', ') : 'none'}\nTargets marked REFERENCE are context only and are not selected for editing.`,
    ...targets.map((target) => `Target ID: ${target.id}\nSelection role: ${selected.has(target.id) ? 'SELECTED' : 'REFERENCE'}\n${target.id === 'article' ? `Title: ${target.title}\n` : ''}Markdown:\n${target.markdown}`),
    ...(passage ? [`Selected passage in ${passage.targetId}:\n${passage.quote}`] : [])
  ].join('\n\n---\n\n');
  return { targets, selectedTargetIds, passage, text, size: text.length };
}

export function parseChatResponse(raw, allowedIds) {
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch {
    if (/^\s*[{[]/.test(raw) || /^\s*```json/i.test(raw)) throw new Error('The model returned an invalid edit response. Try again.');
    return { reply: raw.trim(), edits: [] };
  }
  if (!parsed || typeof parsed.reply !== 'string' || !Array.isArray(parsed.edits)) throw new Error('The model returned an invalid edit response. Try again.');
  if (parsed.edits.length > 8) throw new Error('The model proposed too many changes at once.');
  const seen = new Set();
  const edits = parsed.edits.map((edit) => {
    if (!edit || typeof edit.targetId !== 'string' || !allowedIds.includes(edit.targetId) || seen.has(edit.targetId)
      || typeof edit.markdown !== 'string' || !edit.markdown.trim() || edit.markdown.length > 100_000) {
      throw new Error('The model proposed an invalid or unselected target. No changes were made.');
    }
    seen.add(edit.targetId);
    return { targetId: edit.targetId, markdown: edit.markdown };
  });
  if (!parsed.reply.trim() && !edits.length) throw new Error('The model returned an empty response.');
  return { reply: parsed.reply.trim(), edits };
}

export function proposalStatus(workspace, proposal) {
  if (proposal.status === 'discarded') return 'discarded';
  if (proposal.status !== 'accepted') return 'proposed';
  const target = proposal.targetId === 'article' ? workspace.article : workspace.nodes.find((node) => node.id === proposal.targetId);
  return target?.origins?.some((origin) => origin.proposalId === proposal.id) ? 'accepted' : 'undone';
}

// A bounded line diff keeps large model proposals responsive in the browser.
export function diffMarkdownLines(before, after) {
  const oldLines = before.split('\n'), newLines = after.split('\n');
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length, newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
  const operations = oldLines.slice(0, start).map((text) => ({ kind: 'context', text }));
  const oldMiddle = oldLines.slice(start, oldEnd), newMiddle = newLines.slice(start, newEnd);
  if (oldMiddle.length * newMiddle.length > 250_000) {
    for (const text of oldMiddle) operations.push({ kind: 'removed', text });
    for (const text of newMiddle) operations.push({ kind: 'added', text });
  } else {
    const width = newMiddle.length + 1;
    const table = new Uint32Array((oldMiddle.length + 1) * width);
    for (let i = oldMiddle.length - 1; i >= 0; i--) {
      for (let j = newMiddle.length - 1; j >= 0; j--) {
        table[i * width + j] = oldMiddle[i] === newMiddle[j]
          ? 1 + table[(i + 1) * width + j + 1]
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < oldMiddle.length || j < newMiddle.length) {
      if (i < oldMiddle.length && j < newMiddle.length && oldMiddle[i] === newMiddle[j]) {
        operations.push({ kind: 'context', text: oldMiddle[i++] }); j++;
      } else if (i < oldMiddle.length && (j === newMiddle.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        operations.push({ kind: 'removed', text: oldMiddle[i++] });
      } else operations.push({ kind: 'added', text: newMiddle[j++] });
    }
  }
  for (let i = oldEnd; i < oldLines.length; i++) operations.push({ kind: 'context', text: oldLines[i] });
  let oldNumber = 1, newNumber = 1;
  return operations.map(({ kind, text }) => ({
    kind, text,
    beforeLine: kind === 'added' ? null : oldNumber++,
    afterLine: kind === 'removed' ? null : newNumber++
  }));
}
import { isSourceNode, nodeLabel } from './node-content.js';
