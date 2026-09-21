import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';

marked.use(markedKatex({ throwOnError: false, trust: false, nonStandard: true }));
marked.use({
  extensions: [{
    name: 'highlight',
    level: 'inline',
    start(source) { return source.indexOf('=='); },
    tokenizer(source) {
      const match = /^==([^\S\r\n]*)(?=\S)([\s\S]*?\S)([^\S\r\n]*)==/.exec(source);
      if (!match) return undefined;
      return { type: 'highlight', raw: match[0], leading: match[1], text: match[2], trailing: match[3], tokens: this.lexer.inlineTokens(match[2]) };
    },
    renderer(token) { return `${token.leading}<mark class="markdown-highlight">${this.parser.parseInline(token.tokens)}</mark>${token.trailing}`; }
  }]
});

function markdownProjection(source) {
  let text = '', lineStart = true;
  const rawIndexes = [];
  for (let index = 0; index < source.length;) {
    const rest = source.slice(index);
    const blockPrefix = lineStart && /^(?:#{1,6}|>|[-+*]|\d+\.)\s+/.exec(rest);
    if (blockPrefix) { index += blockPrefix[0].length; lineStart = false; continue; }
    const delimiter = /^(?:==|\*\*|__|~~|`+)/.exec(rest);
    if (delimiter) { index += delimiter[0].length; continue; }
    if (rest.startsWith('![')) { index += 2; continue; }
    if (rest[0] === '[') { index += 1; continue; }
    if (rest.startsWith('](')) {
      const close = source.indexOf(')', index + 2);
      if (close !== -1) { index = close + 1; continue; }
    }
    if (rest[0] === '\\' && index + 1 < source.length) { index += 1; continue; }
    text += source[index]; rawIndexes.push(index);
    lineStart = source[index] === '\n'; index += 1;
  }
  return { text, rawIndexes };
}

function markdownQuoteRanges(source, quote) {
  const projection = markdownProjection(source), ranges = [];
  let cursor = 0;
  while ((cursor = projection.text.indexOf(quote, cursor)) !== -1) {
    let start = projection.rawIndexes[cursor];
    let end = projection.rawIndexes[cursor + quote.length - 1] + 1;
    for (const token of ['**', '__', '~~', '`']) if (source.slice(Math.max(0, start - token.length), start) === token) start -= token.length;
    for (const token of ['**', '__', '~~', '`']) if (source.slice(end, end + token.length) === token) end += token.length;
    ranges.push({ start, end, plainStart: cursor, marked: source.slice(Math.max(0, start - 2), start) === '==' && source.slice(end, end + 2) === '==' });
    cursor += Math.max(1, quote.length);
  }
  return ranges;
}

export function wrapMarkdownHighlight(source, quote, expectedStart = 0) {
  if (!source || !quote) return source;
  const matches = markdownQuoteRanges(source, quote);
  if (!matches.length) return source;
  matches.sort((a, b) => Math.abs(a.plainStart - expectedStart) - Math.abs(b.plainStart - expectedStart));
  const match = matches[0];
  if (match.marked) return source;
  return `${source.slice(0, match.start)}==${source.slice(match.start, match.end)}==${source.slice(match.end)}`;
}

export function unwrapMarkdownHighlight(source, quote, expectedStart = 0) {
  if (!source || !quote) return source;
  const matches = markdownQuoteRanges(source, quote).filter((match) => match.marked);
  if (!matches.length) return source;
  matches.sort((a, b) => Math.abs(a.plainStart - expectedStart) - Math.abs(b.plainStart - expectedStart));
  const match = matches[0], start = match.start - 2, end = match.end + 2;
  return `${source.slice(0, start)}${source.slice(match.start, match.end)}${source.slice(end)}`;
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

export function renderMarkdown(source) {
  const html = marked.parse(source || '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } });
}

export function headingTokens(source) {
  const found = [];
  function visit(tokens) {
    for (const token of tokens || []) {
      if (token.type === 'heading') found.push({ level: token.depth, title: token.text.replace(/<[^>]+>/g, '').replace(/==|\*\*|__|`/g, '').trim() });
      if (token.tokens) visit(token.tokens);
      if (token.items) for (const item of token.items) visit(item.tokens);
    }
  }
  visit(marked.lexer(source || ''));
  return found;
}
