import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';

marked.use(markedKatex({ throwOnError: false, trust: false, nonStandard: true }));

export function renderMarkdown(source) {
  const html = marked.parse(source || '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } });
}

export function headingTokens(source) {
  const found = [];
  function visit(tokens) {
    for (const token of tokens || []) {
      if (token.type === 'heading') found.push({ level: token.depth, title: token.text.replace(/<[^>]+>/g, '').replace(/\*\*|__|`/g, '').trim() });
      if (token.tokens) visit(token.tokens);
      if (token.items) for (const item of token.items) visit(item.tokens);
    }
  }
  visit(marked.lexer(source || ''));
  return found;
}
