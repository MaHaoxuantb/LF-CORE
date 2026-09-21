export function nodeLabel(node) {
  const markdown = node.document?.markdown || '';
  const first = markdown.split('\n').find((line) => line.trim()) || '';
  const plain = first.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/==|[`*_~]/g, '').trim();
  const label = plain || 'Untitled node';
  return label.length > 58 ? `${label.slice(0, 55)}…` : label;
}
