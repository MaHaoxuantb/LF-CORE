const edgeDirection = (edge) => ['forward', 'reverse', 'both'].includes(edge?.direction) ? edge.direction : 'both';

function endpointExists(workspace, id) {
  if (typeof id !== 'string' || !id) return false;
  if (id.startsWith('h:')) return (workspace?.highlights || []).some((highlight) => `h:${highlight.id}` === id);
  return (workspace?.nodes || []).some((node) => node.id === id);
}

/**
 * Return the single endpoint whose one-way arrow leads into nodeId.
 * Bidirectional links and ambiguous multiple predecessors do not define a
 * sibling relationship.
 */
export function siblingPredecessor(workspace, nodeId) {
  if (!(workspace?.nodes || []).some((node) => node.id === nodeId)) return null;
  const matches = [];
  for (const edge of workspace?.edges || []) {
    const direction = edgeDirection(edge);
    let predecessorId = null;
    if (direction === 'forward' && edge.toId === nodeId) predecessorId = edge.fromId;
    if (direction === 'reverse' && edge.fromId === nodeId) predecessorId = edge.toId;
    if (!predecessorId || predecessorId === nodeId || !endpointExists(workspace, predecessorId)) continue;
    matches.push({ edge, predecessorId });
  }
  return matches.length === 1 ? matches[0] : null;
}
