export function wrapMarkdownSelection(value, start, end, before, after = before, placeholder = '') {
  const selected = value.slice(start, end);
  const content = selected || placeholder;
  const replacement = `${before}${content}${after}`;
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    start: start + before.length,
    end: start + before.length + content.length
  };
}

export function prefixMarkdownLines(value, start, end, prefix) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const selected = value.slice(lineStart, lineEnd);
  const lines = selected.split('\n');
  const replacement = lines.map((line) => `${prefix}${line}`).join('\n');
  return {
    value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    start: start + prefix.length,
    end: end + prefix.length * lines.length
  };
}
