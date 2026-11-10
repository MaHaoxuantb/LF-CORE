const invalid = message => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
const childOf = (workspace, edge) => workspace.nodes.find(node => node.id === edge.toId);
function detach(workspace, edge) {
  const child = childOf(workspace, edge);
  if (edge.structural && child?.parentId === edge.fromId) child.parentId = null;
  if (child?.anchor?.id && edge.fromId === `h:${child.anchor.id}`) child.anchor = null;
}
export function removeRelationship(workspace, id) {
  const edge = workspace.edges.find(edge => edge.id === id);
  if (!edge) throw Object.assign(new Error('Relationship not found.'), { code: 'NOT_FOUND' });
  detach(workspace, edge); workspace.edges = workspace.edges.filter(edge => edge.id !== id);
}
export function updateRelationship(workspace, id, patch) {
  const edge = workspace.edges.find(edge => edge.id === id);
  if (!edge) throw Object.assign(new Error('Relationship not found.'), { code: 'NOT_FOUND' });
  const fromId = patch.fromId ?? edge.fromId, toId = patch.toId ?? edge.toId;
  const exists = id => workspace.nodes.some(node => node.id === id) || (workspace.highlights || []).some(h => `h:${h.id}` === id);
  if (!exists(fromId) || !exists(toId) || fromId === toId) throw invalid('Invalid relationship endpoints.');
  if (workspace.edges.some(other => other.id !== id && (other.fromId === fromId && other.toId === toId || other.fromId === toId && other.toId === fromId))) throw invalid('Those nodes are already connected.');
  if (patch.direction !== undefined && !['forward', 'reverse', 'both'].includes(patch.direction)) throw invalid('Invalid relationship direction.');
  for (const side of ['fromSide', 'toSide']) if (patch[side] !== undefined && !['auto', 'left', 'top', 'right', 'bottom'].includes(patch[side])) throw invalid('Invalid connection side.');
  if (fromId !== edge.fromId || toId !== edge.toId) {
    detach(workspace, edge);
    const child = workspace.nodes.find(node => node.id === toId);
    if (child && fromId.startsWith('h:') && !child.anchor) child.anchor = { ...workspace.highlights.find(h => `h:${h.id}` === fromId) };
    if (edge.structural) {
      if (child && !fromId.startsWith('h:')) { child.parentId = fromId; child.anchor = null; workspace.edges = workspace.edges.filter(other => other.id === edge.id || !other.structural || other.toId !== toId); }
      else edge.structural = false;
    }
  }
  Object.assign(edge, patch, { fromId, toId });
  return edge;
}
export function setProjectParent(workspace, id, parentId, uuid = () => crypto.randomUUID()) {
  const node = workspace.nodes.find(node => node.id === id);
  if (!node || parentId && !workspace.nodes.some(node => node.id === parentId)) throw Object.assign(new Error('Node or parent not found.'), { code: 'NOT_FOUND' });
  const visited = new Set([id]); let cursor = parentId;
  while (cursor) { if (visited.has(cursor)) throw invalid('Parent change would create a cycle.'); visited.add(cursor); cursor = workspace.nodes.find(n => n.id === cursor)?.parentId; }
  const anchorId = node.anchor?.id;
  workspace.edges = workspace.edges.filter(edge => !(edge.structural && edge.toId === id) && !(anchorId && edge.fromId === `h:${anchorId}` && edge.toId === id));
  node.anchor = null; node.parentId = parentId ?? null;
  if (parentId) {
    const existing = workspace.edges.find(edge => edge.fromId === parentId && edge.toId === id);
    if (existing) existing.structural = true;
    else workspace.edges.push({ id: uuid(), fromId: parentId, toId: id, label: null, direction: 'forward', structural: true });
  }
}
