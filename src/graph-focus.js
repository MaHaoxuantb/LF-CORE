export const GRAPH_FOCUS_MODES = ['directional', 'connected', 'neighbors'];
export const DEFAULT_GRAPH_FOCUS = { mode: 'directional', depth: 5 };

export function normalizeGraphFocusPreferences(value = {}) {
  const mode = GRAPH_FOCUS_MODES.includes(value?.mode) ? value.mode : DEFAULT_GRAPH_FOCUS.mode;
  const parsedDepth = Number.parseInt(value?.depth, 10);
  const depth = Number.isFinite(parsedDepth) ? Math.min(20, Math.max(1, parsedDepth)) : DEFAULT_GRAPH_FOCUS.depth;
  return { mode, depth };
}

function add(adjacency, from, to) {
  if (!adjacency.has(from)) adjacency.set(from, new Set());
  adjacency.get(from).add(to);
}

function walk(adjacency, rootId, depth) {
  const reached = new Set([rootId]);
  let frontier = new Set([rootId]);
  for (let hop = 0; hop < depth && frontier.size; hop++) {
    const next = new Set();
    for (const id of frontier) {
      for (const related of adjacency.get(id) || []) {
        if (reached.has(related)) continue;
        reached.add(related);
        next.add(related);
      }
    }
    frontier = next;
  }
  return reached;
}

export function relatedNodeIds(workspace, rootId, mode = DEFAULT_GRAPH_FOCUS.mode, depth = DEFAULT_GRAPH_FOCUS.depth) {
  const nodeIds = new Set((workspace?.nodes || []).map((node) => node.id).filter(Boolean));
  if (!nodeIds.has(rootId)) return new Set();

  const preferences = normalizeGraphFocusPreferences({ mode, depth });
  const highlightOwners = new Map((workspace?.highlights || []).map((highlight) => [highlight.id, highlight.targetId]));
  const endpointNode = (id) => {
    if (nodeIds.has(id)) return id;
    if (typeof id !== 'string' || !id.startsWith('h:')) return null;
    const owner = highlightOwners.get(id.slice(2));
    return nodeIds.has(owner) ? owner : null;
  };

  const outgoing = new Map(), incoming = new Map(), connected = new Map();
  for (const edge of workspace?.edges || []) {
    const from = endpointNode(edge.fromId), to = endpointNode(edge.toId);
    if (!from || !to || from === to) continue;
    add(connected, from, to); add(connected, to, from);
    const direction = ['forward', 'reverse', 'both'].includes(edge.direction) ? edge.direction : 'both';
    if (direction === 'forward' || direction === 'both') {
      add(outgoing, from, to); add(incoming, to, from);
    }
    if (direction === 'reverse' || direction === 'both') {
      add(outgoing, to, from); add(incoming, from, to);
    }
  }

  if (preferences.mode === 'neighbors') return walk(connected, rootId, 1);
  if (preferences.mode === 'connected') return walk(connected, rootId, preferences.depth);
  return new Set([...walk(incoming, rootId, preferences.depth), ...walk(outgoing, rootId, preferences.depth)]);
}
