import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { wrapMarkdownHighlight, unwrapMarkdownHighlight } from '../src/markdown.js';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

function fixture() {
  const anchor = { id: 'h1', targetId: 'article', quote: 'Passage', start: 0, end: 7 };
  const item = {
    id: 'project', article: { markdown: '== Passage ==' }, highlights: [anchor],
    nodes: [{ id: 'n1', parentId: null, anchor: { ...anchor } }],
    edges: [{ id: 'e1', fromId: 'h:h1', toId: 'n1' }]
  };
  const listeners = new Map();
  const element = () => ({
    children: [], handlers: {}, style: {}, dataset: {}, classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    removeEventListener(name) { delete this.handlers[name]; },
    setAttribute() {}, setPointerCapture() {}, hasPointerCapture: () => false,
    remove() {}, focus() {}, querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, width: 100, height: 20 })
  });
  const shell = element(), layer = element(), mark = element();
  const context = vm.createContext({
    committingProject: false, item, selectedPassage: null, state: { history: {}, redo: {} }, editGroup: null,
    graphIsReadOnly: () => false, work: () => item, persist() {}, renderWorkspace() {},
    snapshotWorkspace: structuredClone, crypto, wrapMarkdownHighlight, unwrapMarkdownHighlight, markdownHTMLText: undefined,
    isHighlightId: (id) => id.startsWith('h:'),
    highlightFor: (entry, id) => entry.highlights.find((h) => `h:${h.id}` === id),
    nodeLabel: () => 'Note', shortTitle: (text) => text, announce() {}, selectConnection() {},
    closeContextMenu() {}, view: { zoom: 1 }, window: {
      innerWidth: 1000, innerHeight: 800, getSelection: () => ({ removeAllRanges() {} }),
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name)
    },
    document: { querySelector: (selector) => selector === '.workspace-shell' ? shell : selector === '.scene' ? mark : selector === '.passage-toolbar' ? null : layer },
    el: element, button: (label, action) => ({ label, action }),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    endpointAtPointer: () => null, endpointPoint: () => null
  });
  for (const name of ['change', 'markdownTarget', 'markAnchorInMarkdown', 'unmarkAnchorInMarkdown', 'ensureUnifiedNodeEdges', 'openLinkMenu', 'startEdgeDrag', 'activateHighlightActions']) {
    vm.runInContext(source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))[0], context);
  }
  const event = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...extra });
  return { item, anchor, mark, shell, context, listeners, event };
}

test('clicking a saved highlight exposes removal, clears its links, and survives normalization', () => {
  const f = fixture();
  f.context.activateHighlightActions(f.mark, f.anchor);
  f.mark.handlers.pointerdown(f.event());
  f.listeners.get('pointerup')(f.event({ type: 'pointerup' }));
  const remove = f.shell.children.at(-1).children.find((entry) => entry.label === 'Remove highlight');
  assert.ok(remove);
  remove.action();
  assert.equal(f.item.article.markdown, ' Passage ');
  assert.equal(f.item.highlights.length, 0);
  assert.equal(f.item.edges.length, 0);
  assert.equal(f.item.nodes.length, 1);
  assert.equal(f.item.nodes[0].anchor, null);
  f.context.ensureUnifiedNodeEdges(f.item);
  assert.equal(f.item.highlights.length, 0);
  assert.equal(f.context.state.history.project[0].article.markdown, '== Passage ==');
});

for (const key of ['Enter', ' ', 'F10']) {
  test(`${key} opens actions for a Markdown highlight and registers it once`, () => {
    const f = fixture();
    f.item.highlights = [];
    let registrations = 0;
    f.context.activateHighlightActions(f.mark, f.anchor, () => {
      if (!f.item.highlights.length) { registrations++; f.item.highlights.push(f.anchor); }
    });
    f.mark.handlers.keydown(f.event({ key, shiftKey: key === 'F10' }));
    f.mark.handlers.contextmenu(f.event());
    assert.equal(registrations, 1);
    assert.ok(f.shell.children.at(-1).children.some((entry) => entry.label === 'Remove highlight'));
  });
}

test('dragging or canceling a highlight does not open its actions', () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    f.context.activateHighlightActions(f.mark, f.anchor);
    f.mark.handlers.pointerdown(f.event());
    if (!cancel) f.listeners.get('pointermove')(f.event({ clientX: 20 }));
    // Cancel the drag after movement, or cancel a stationary press.
    f.listeners.get('pointercancel')(f.event({ type: 'pointercancel' }));
    assert.equal(f.shell.children.length, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test('read-only highlights cannot register or expose mutation actions', () => {
  const f = fixture();
  f.context.graphIsReadOnly = () => true;
  f.context.activateHighlightActions(f.mark, f.anchor, () => assert.fail('must not register'));
  f.mark.handlers.contextmenu(f.event());
  f.mark.handlers.keydown(f.event({ key: 'Enter' }));
  f.context.openLinkMenu('h:h1', f.mark);
  assert.equal(f.shell.children.length, 0);
});

test('removing highlights preserves internal spacing and Markdown formatting', () => {
  for (const [markdown, quote, plain] of [
    ['== Passage ==', 'Passage', ' Passage '],
    ['==\t**Passage**\t==', 'Passage', '&#9;**Passage**\t'],
    ['## 3.== Installing and using Lean==', 'Installing and using Lean', '## 3. Installing and using Lean'],
    ['==One== and ==Two==', 'Two', '==One== and Two']
  ]) assert.equal(unwrapMarkdownHighlight(markdown, quote, markdown.indexOf(quote)), plain);
  assert.equal(wrapMarkdownHighlight('== Passage ==', 'Passage'), '== Passage ==');
});

test('removing an unmarked occurrence does not erase a different repeated highlight', () => {
  assert.equal(unwrapMarkdownHighlight('Passage and ==Passage==', 'Passage', 0), 'Passage and ==Passage==');
  assert.equal(unwrapMarkdownHighlight('Passage and ==Passage==', 'Passage', 12), 'Passage and Passage');
});

test('rendered anchor fragments receive working removal actions', () => {
  const f = fixture();
  let fragment;
  const textNode = { nodeValue: 'Passage', parentElement: { closest: () => null }, replaceWith(value) { fragment = value; } };
  Object.assign(f.context, {
    textOf: () => 'Passage', passageOffset: () => 0, resolveAnchor: () => ({ start: 0, end: 7 }),
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ getPropertyValue: () => '#aabbcc' })
  });
  Object.assign(f.context.document, {
    documentElement: {},
    createTreeWalker() {
      let visited = false;
      return { currentNode: textNode, nextNode() { if (visited) return false; visited = true; return true; } };
    },
    createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => '' }),
    createDocumentFragment: () => ({ children: [], append(child) { this.children.push(child); } })
  });
  vm.runInContext(source.match(/^function markAnchors\([^]*?^}/m)[0], f.context);
  f.context.markAnchors({ querySelectorAll: () => [] }, [f.anchor]);
  assert.equal(fragment.children.length, 1);
  fragment.children[0].handlers.keydown(f.event({ key: 'Enter' }));
  const remove = f.shell.children.at(-1).children.find((entry) => entry.label === 'Remove highlight');
  assert.ok(remove);
  remove.action();
  assert.equal(f.item.article.markdown, ' Passage ');
});

test('formula annotation removal and normalization leave LaTeX source unchanged', () => {
  const f = fixture();
  const markdown = '$$\n\\frac{a}{b}\n$$';
  Object.assign(f.anchor, { quote: markdown, containsMath: true });
  Object.assign(f.item.nodes[0].anchor, f.anchor);
  f.item.article.markdown = markdown;
  f.context.ensureUnifiedNodeEdges(f.item);
  assert.equal(f.item.article.markdown, markdown);
  f.context.openLinkMenu('h:h1', f.mark);
  f.shell.children.at(-1).children.find((entry) => entry.label === 'Remove highlight').action();
  assert.equal(f.item.article.markdown, markdown);
  assert.equal(f.item.highlights.length, 0);
  assert.equal(f.item.nodes[0].anchor, null);
  assert.equal(f.context.state.history.project[0].highlights[0].containsMath, true);
});

test('selection toolbar protects reverse selections and clamps to its measured width', () => {
  const f = fixture();
  f.context.selectedPassage = { targetId: 'article', start: 0, end: 7, x: 990, y: 100 };
  Object.assign(f.context, { aiFeaturesEnabled: false, createAnchoredNode() {}, createHighlight() {} });
  vm.runInContext(source.match(/^function renderPassageToolbar\([^]*?^}/m)[0], f.context);
  f.context.renderPassageToolbar();
  const toolbar = f.shell.children.at(-1);
  assert.equal(toolbar.style.left, '892px');
  let prevented = false, stopped = false;
  toolbar.handlers.pointerdown(f.event({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(f.context.selectedPassage.start, 0);
});

test('passage selection finishes outside the preview and cleans up on cancellation', () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    let captured = 0;
    f.context.capturePassage = () => captured++;
    f.mark.isConnected = true;
    vm.runInContext(source.match(/^function attachPassageSelection\([^]*?^}/m)[0], f.context);
    f.context.attachPassageSelection(f.mark, 'article');
    f.mark.handlers.pointerdown(f.event({ target: { closest: () => null } }));
    f.listeners.get(cancel ? 'pointercancel' : 'mouseup')(f.event({ type: cancel ? 'pointercancel' : 'mouseup' }));
    assert.equal(captured, cancel ? 0 : 1);
    assert.equal(f.listeners.size, 0);
  }
});

test('right-clicking a highlight does not start canvas panning', () => {
  const f = fixture();
  f.context.activateHighlightActions(f.mark, f.anchor);
  let stopped = false;
  f.mark.handlers.pointerdown(f.event({ button: 2, stopPropagation() { stopped = true; } }));
  assert.equal(stopped, true);
  assert.equal(f.listeners.size, 0);
});


test('accessibility activation opens highlight actions without following an enclosing link', () => {
  const f = fixture();
  f.context.activateHighlightActions(f.mark, f.anchor);
  let prevented = false;
  f.mark.handlers.click(f.event({ detail: 0, preventDefault() { prevented = true; } }));
  assert.equal(prevented, true);
  assert.ok(f.shell.children.at(-1).children.some((entry) => entry.label === 'Remove highlight'));
});

for (const kind of ['blur', 'lostpointercapture']) {
  test(`${kind} cancels a highlight drag and removes its listeners`, () => {
    const f = fixture();
    f.context.activateHighlightActions(f.mark, f.anchor);
    f.mark.handlers.pointerdown(f.event());
    const finish = kind === 'blur' ? f.listeners.get(kind) : f.mark.handlers[kind];
    finish(f.event({ type: kind }));
    assert.equal(f.listeners.size, 0);
    assert.equal(f.mark.handlers.lostpointercapture, undefined);
    assert.equal(f.shell.children.length, 0);
  });
}

test('a second pointer cannot finish the active highlight drag', () => {
  const f = fixture();
  f.context.activateHighlightActions(f.mark, f.anchor);
  f.mark.handlers.pointerdown(f.event());
  f.listeners.get('pointerup')(f.event({ type: 'pointerup', pointerId: 2 }));
  assert.ok(f.listeners.has('pointerup'));
  assert.equal(f.shell.children.length, 0);
  f.listeners.get('pointercancel')(f.event({ type: 'pointercancel' }));
});

test('repairing a shared passage updates every node copy without restoring old highlights', () => {
  const f = fixture();
  f.item.article.markdown = '==Passage== Repaired';
  f.item.nodes.push({ id: 'n2', parentId: null, anchor: { ...f.anchor } });
  f.item.edges.push({ id: 'e2', fromId: 'h:h1', toId: 'n2' });
  f.context.selectedPassage = { targetId: 'article', start: 8, end: 16 };
  Object.assign(f.context, {
    sourcePlainText: () => 'Passage Repaired', isDescendant: () => false,
    makeAnchor: (targetId, text, start, end) => ({ id: 'unused', targetId, quote: text.slice(start, end), start, end, prefix: text.slice(0, start), suffix: text.slice(end) })
  });
  vm.runInContext(source.match(/^function reconnect\([^]*?^}/m)[0], f.context);
  f.context.reconnect(f.item.nodes[0]);
  f.context.ensureUnifiedNodeEdges(f.item);
  assert.equal(f.item.article.markdown, 'Passage ==Repaired==');
  assert.deepEqual(f.item.nodes.map((node) => node.anchor.quote), ['Repaired', 'Repaired']);
  assert.equal(f.item.highlights.length, 1);
  assert.equal(f.item.highlights[0].quote, 'Repaired');
  assert.equal(f.item.edges.length, 2);
});
