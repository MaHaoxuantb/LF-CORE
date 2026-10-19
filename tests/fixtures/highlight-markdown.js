// Bundle with esbuild to dist/highlight-markdown-checks.js, then open
// /tests/fixtures/highlight-markdown.html on the local development server.
import { marked } from 'marked';
import { wrapMarkdownHighlight, unwrapMarkdownHighlight, markdownHTMLText } from '../../src/markdown.js';
import { makeAnchor } from '../../src/anchors.js';
const output = document.querySelector('#results');
let checks = 0, failures = 0;
function check(name, fn) {
  checks++;
  try { fn(); output.textContent += `PASS ${name}\n`; }
  catch (error) { failures++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
}
function equal(actual, expected) {
  if (actual !== expected) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
for (const [name, source, quote, expected] of [
  ['italics', '==*hello*==', 'hello', '*hello*'],
  ['link', '==[hello](https://example.com)==', 'hello', '[hello](https://example.com)'],
  ['named entity', '==Copyright &copy; today==', 'Copyright © today', 'Copyright &copy; today'],
  ['formula in italics', '==*$\\frac{a}{b}$*==', '$\\frac{a}{b}$', '*$\\frac{a}{b}$*'],
  ['leading indentation', '==\t**hello**\t==', 'hello', '&#9;**hello**\t'],
]) check(`remove ${name} with the production DOM reader`, () => {
  const text = markdownHTMLText(marked.parse(source)), start = text.indexOf(quote);
  const anchor = makeAnchor('article', text, start, start + quote.length);
  equal(unwrapMarkdownHighlight(source, quote, anchor, markdownHTMLText), expected);
});
check('repeated formatted quote removal follows its context after edits', () => {
  const old = '# Notes\n\nFirst hello. Second hello. End.';
  const text = markdownHTMLText(marked.parse(old)), start = text.lastIndexOf('hello');
  const anchor = makeAnchor('article', text, start, start + 5);
  const source = '# Notes\n\nA long introduction. First ==*hello*==. Second ==*hello*==. End.';
  equal(unwrapMarkdownHighlight(source, 'hello', anchor, markdownHTMLText), '# Notes\n\nA long introduction. First ==*hello*==. Second *hello*. End.');
});
check('wrapping part of bold text preserves its formatting', () => {
  equal(wrapMarkdownHighlight('A **bold word** ends', 'bold', 2, markdownHTMLText), 'A **==bold== word** ends');
});
check('selected code does not highlight a later identical quote', () => {
  const source = '## Heading\n\n`hello` and hello';
  const text = markdownHTMLText(marked.parse(source)), start = text.indexOf('ell');
  const anchor = makeAnchor('article', text, start, start + 3);
  equal(wrapMarkdownHighlight(source, 'ell', anchor, markdownHTMLText), source);
});
output.textContent += `\n${failures ? `${failures} FAILED` : `All ${checks} checks passed`}`;
document.title = failures ? 'FAIL: Markdown highlights' : 'PASS: Markdown highlights';
