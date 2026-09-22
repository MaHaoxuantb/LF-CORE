import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixMarkdownLines, wrapMarkdownSelection } from '../src/markdown-edit.js';

test('wrapMarkdownSelection wraps selected text and keeps it selected', () => {
  assert.deepEqual(wrapMarkdownSelection('make this bold', 5, 9, '**'), {
    value: 'make **this** bold',
    start: 7,
    end: 11
  });
});

test('wrapMarkdownSelection inserts an editable placeholder for an empty selection', () => {
  assert.deepEqual(wrapMarkdownSelection('Math: ', 6, 6, '$', '$', 'x^2'), {
    value: 'Math: $x^2$',
    start: 7,
    end: 10
  });
});

test('prefixMarkdownLines formats every touched line', () => {
  assert.deepEqual(prefixMarkdownLines('one\ntwo\nthree', 1, 7, '- '), {
    value: '- one\n- two\nthree',
    start: 3,
    end: 11
  });
});
