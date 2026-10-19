import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import { passageText, resolveAnchor } from './anchors.js';

// Keep each rendered formula paired with its original source. Highlight anchors
// use this one source string, rather than KaTeX's visual and accessibility trees.
const mathExtension = markedKatex({ throwOnError: false, trust: false, nonStandard: true });
for (const extension of mathExtension.extensions) {
  const render = extension.renderer;
  extension.renderer = function(token) {
    const source = token.type === 'blockKatex' ? token.raw.trimEnd() : token.raw;
    const escaped = source.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = render.call(this, token);
    return `<span class="math-formula" data-math-source="${escaped}">${token.type === 'blockKatex' ? html.trimEnd() : html}</span>${token.type === 'blockKatex' ? '\n' : ''}`;
  };
}
marked.use(mathExtension);
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
    if (rest[0] === '$') {
      const math = mathExtension.extensions.map((extension) => extension.tokenizer?.(rest, [])).find(Boolean);
      if (math) {
        const raw = math.type === 'blockKatex' ? math.raw.trimEnd() : math.raw;
        for (let offset = 0; offset < raw.length; offset++) { text += raw[offset]; rawIndexes.push(index + offset); }
        index += raw.length; lineStart = false; continue;
      }
    }
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
    const contentStart = projection.rawIndexes[cursor], contentEnd = projection.rawIndexes[cursor + quote.length - 1] + 1;
    let start = contentStart, end = contentEnd;
    for (const token of ['**', '__', '~~', '`']) if (source.slice(Math.max(0, start - token.length), start) === token) start -= token.length;
    for (const token of ['**', '__', '~~', '`']) if (source.slice(end, end + token.length) === token) end += token.length;
    const opening = /==[^\S\r\n]*$/.exec(source.slice(0, start));
    const closing = /^[^\S\r\n]*==/.exec(source.slice(end));
    ranges.push({ start, end, contentStart, contentEnd, plainStart: cursor, marked: !!opening && !!closing,
      markerStart: opening?.index, markerEnd: closing ? end + closing[0].length : null });
    cursor += Math.max(1, quote.length);
  }
  return ranges;
}

function matchMarkdownQuote(source, quote, expected) {
  const matches = markdownQuoteRanges(source, quote);
  const anchor = typeof expected === 'object' ? expected : { quote, start: expected };
  const range = resolveAnchor(anchor, markdownProjection(source).text);
  return range && matches.find((match) => match.plainStart === range.start);
}

export function wrapMarkdownHighlight(source, quote, expectedStart = 0, htmlText = basicHTMLText) {
  if (!source || !quote) return source;
  const match = matchMarkdownQuote(source, quote, expectedStart);
  if (!match || match.marked) return source;
  const withoutMarks = (html) => html.replace(/<mark class="markdown-highlight">|<\/mark>/g, '');
  const originalHTML = marked.parse(source), original = withoutMarks(originalHTML);
  const anchor = typeof expectedStart === 'object' ? expectedStart : { quote, start: expectedStart };
  const intended = resolveAnchor(anchor, htmlText(originalHTML));
  if (!intended) return source;
  for (const [start, end] of [[match.start, match.end], [match.contentStart, match.contentEnd]]) {
    const candidate = `${source.slice(0, start)}==${source.slice(start, end)}==${source.slice(end)}`;
    // Partial formatting, code and overlapping ranges must not change the
    // document's rendered content. Those highlights can remain annotations.
    const html = marked.parse(candidate);
    if (withoutMarks(html) !== original) continue;
    const matchesIntended = [...html.matchAll(/<mark class="markdown-highlight">([\s\S]*?)<\/mark>/g)].some((mark) => {
      const start = htmlText(html.slice(0, mark.index)).length;
      return start === intended.start && start + htmlText(mark[1]).length === intended.end;
    });
    if (matchesIntended) return candidate;
  }
  return source;
}

// The application supplies a DOM reader, including KaTeX's canonical source.
// This fallback also keeps the source helper usable without a browser.
function basicHTMLText(html) {
  const decode = (text) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity.toLowerCase()];
  });
  let text = '', mathDepth = 0;
  for (const [part] of html.matchAll(/<[^>]*>|[^<]+/g)) {
    if (mathDepth) {
      if (/^<span\b/.test(part)) mathDepth++;
      else if (/^<\/span>/.test(part)) mathDepth--;
      continue;
    }
    const math = /^<span\b[^>]*data-math-source="([^"]*)"/.exec(part);
    if (math) { text += decode(math[1]); mathDepth = 1; }
    else if (!part.startsWith('<')) text += decode(part);
  }
  return text;
}

export function markdownHTMLText(html) {
  return passageText(DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true }, RETURN_DOM_FRAGMENT: true }));
}

export function unwrapMarkdownHighlight(source, quote, expectedStart = 0, htmlText = basicHTMLText) {
  if (!source || !quote) return source;
  const html = marked.parse(source);
  const anchor = typeof expectedStart === 'object' ? expectedStart : { quote, start: expectedStart };
  const range = resolveAnchor(anchor, htmlText(html));
  if (!range) return source;
  const leading = quote.length - quote.trimStart().length, trailing = quote.length - quote.trimEnd().length;
  const mark = [...html.matchAll(/<mark class="markdown-highlight">([\s\S]*?)<\/mark>/g)].find((match) => {
    const start = htmlText(html.slice(0, match.index)).length;
    return start === range.start + leading && start + htmlText(match[1]).length === range.end - trailing;
  });
  if (!mark) return source;
  const expectedHTML = html.slice(0, mark.index) + mark[1] + html.slice(mark.index + mark[0].length);
  const rawMarks = new Set();
  marked.walkTokens(marked.lexer(source), (token) => { if (token.type === 'highlight') rawMarks.add(token.raw); });
  for (const raw of rawMarks) {
    let start = source.indexOf(raw);
    while (start !== -1) {
      const inner = raw.slice(2, -2);
      const replacements = [inner];
      if (start === 0 || source[start - 1] === '\n') {
        // Removing a marker at column zero must not turn its leading spaces
        // or tab into an indented code block.
        replacements.push(inner.replace(/^[ \t]+/, (spaces) => [...spaces].map((ch) => ch === '\t' ? '&#9;' : '&#32;').join('')));
      }
      // Verify the exact rendered mark disappears. Identical syntax inside a
      // code block, or another occurrence of the quote, cannot be removed.
      for (const replacement of replacements) {
        const candidate = source.slice(0, start) + replacement + source.slice(start + raw.length);
        const candidateHTML = marked.parse(candidate).replace(/&#9;/g, '\t').replace(/&#32;/g, ' ');
        if (candidateHTML === expectedHTML.replace(/&#9;/g, '\t').replace(/&#32;/g, ' ')) return candidate;
      }
      start = source.indexOf(raw, start + 1);
    }
  }
  return source;
}

export function renderMarkdown(source) {
  const html = marked.parse(source || '');
  const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } });
  return sanitized.replace(/<a\b([^>]*)>/gi, (_, attributes) => {
    const withoutWindowing = attributes.replace(/\s+(?:target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<a${withoutWindowing} target="_blank" rel="noopener noreferrer">`;
  });
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
