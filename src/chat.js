export const MAX_CONTEXT_CHARS = 40_000;

export function contextSnapshot(workspace, selection) {
  const targets = [];
  const mode = selection.mode || (selection.article ? 'article' : 'selected');
  if (mode === 'article' || mode === 'all') targets.push({ id: 'article', title: 'Master article', markdown: workspace.article.markdown });
  const nodeIds = mode === 'all' ? workspace.nodes.map((node) => node.id) : mode === 'selected' ? selection.nodeIds || [] : [];
  for (const id of [...new Set(nodeIds)]) {
    const node = workspace.nodes.find((entry) => entry.id === id);
    if (node) targets.push({ id, title: node.title, markdown: node.document?.markdown || '' });
  }
  const passage = selection.passage && targets.some((target) => target.id === selection.passage.targetId)
    ? { targetId: selection.passage.targetId, quote: selection.passage.quote } : null;
  const text = [
    `Workspace: ${workspace.title}`,
    ...targets.map((target) => `Target ID: ${target.id}\nTitle: ${target.title}\nMarkdown:\n${target.markdown}`),
    ...(passage ? [`Selected passage in ${passage.targetId}:\n${passage.quote}`] : [])
  ].join('\n\n---\n\n');
  return { targets, passage, text, size: text.length };
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
