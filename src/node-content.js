export function isSourceNode(node) {
  return node?.document?.type === 'source' && typeof node.document.sourceId === 'string';
}

export function sourceNode(source, id = crypto.randomUUID()) {
  if (!source?.id) throw new Error('A source node needs an existing source.');
  return {
    id,
    parentId: null,
    document: { type: 'source', sourceId: source.id },
    anchor: null,
    sourceRefs: [],
    collapsed: false,
    provenance: 'source'
  };
}

export function nodeLabel(node, sources = []) {
  if (isSourceNode(node)) {
    const source = sources.find((entry) => entry.id === node.document.sourceId);
    return source?.title || 'Missing source';
  }
  const markdown = node.document?.markdown || '';
  const first = markdown.split('\n').find((line) => line.trim()) || '';
  const plain = first.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/==|[`*_~]/g, '').trim();
  const label = plain || 'Untitled node';
  return label.length > 58 ? `${label.slice(0, 55)}…` : label;
}
