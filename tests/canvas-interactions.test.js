import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveMoveGeometry, resolveResizeGeometry, selectionBounds } from '../src/node-geometry.js';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

// Exercise the actual event handlers with a small DOM/event boundary, without
// booting storage, workers, PDF.js, and the rest of the application.
function fixture() {
  const item = { id: 'project', layout: { positions: { a: { x: 0, y: 0 }, b: { x: 400, y: 100 } }, sizes: { a: { width: 240, height: 120 }, b: { width: 240, height: 120 } } } };
  const element = () => ({ style: {}, attributes: {}, classList: { toggle() {} }, setAttribute(name, value) { this.attributes[name] = value; }, setPointerCapture() {}, hasPointerCapture: () => false, addEventListener() {}, removeEventListener() {} });
  const cards = { a: element(), b: element() }, controls = { Undo: element(), Redo: element(), 'Toggle snap': element(), 'Toggle align': element() };
  const listeners = new Map();
  let saves = 0, connections = 0;
  const context = vm.createContext({
    console, structuredClone, committingProject: false, item, cards, geometryPreferences: { snapping: true, alignment: true },
    GEOMETRY_GUIDES_KEY: 'geometry', localStorage: { setItem() {} },
    selectedIds: new Set(), editGroup: null, state: { history: {}, redo: {} }, view: { zoom: 1 },
    NODE_SIZE_LIMITS: { minWidth: 160, maxWidth: 920, minHeight: 80, maxHeight: 920 },
    work: () => item, snapshotWorkspace: structuredClone, persist: () => saves++,
    renderWorkspace: () => assert.fail('interaction must preserve the mounted canvas and header'),
    graphIsReadOnly: () => false, nodeGeometryTargets: () => [],
    pointFor: (entry, id) => ({ ...entry.layout.positions[id], ...entry.layout.sizes[id] }),
    selectionBounds, resolveMoveGeometry, resolveResizeGeometry,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)), maximumNodeHeight: () => 920,
    showAlignmentGuides() {}, applyNodeSizeClass() {}, updateCardOverflow() {}, updateConnectors: () => connections++,
    document: { querySelector(selector) {
      const node = selector.match(/^\[data-node="(.*?)"\]$/);
      const label = selector.match(/^\[aria-label="(.*?)"\]$/);
      return node ? cards[node[1]] : label ? controls[label[1]] : null;
    } },
    window: {
      getSelection: () => ({ removeAllRanges() {} }),
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name)
    }
  });
  for (const name of ['setGeometryPreference', 'change', 'syncNodeGeometry', 'startNodeDrag', 'startNodeResize', 'resizeNodeWithKeys', 'refreshWorkspacePanels', 'toggleOutline', 'openSource', 'disposeAiPanel', 'toggleAiPanel', 'toggleResearchPanel']) {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `${name} exists`);
    vm.runInContext(match[0], context);
  }
  const pointer = { button: 0, clientX: 0, clientY: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} };
  return { context, item, cards, controls, listeners, pointer, saves: () => saves, connections: () => connections };
}

test('snap and align combinations update controls without remounting the canvas', () => {
  const f = fixture();
  for (const [name, enabled] of [['snapping', false], ['alignment', false], ['snapping', true], ['alignment', true]]) {
    f.context.setGeometryPreference(name, enabled);
    assert.equal(f.controls[name === 'snapping' ? 'Toggle snap' : 'Toggle align'].attributes['aria-pressed'], String(enabled));
  }
  assert.equal(f.saves(), 0);
});

test('node drag prevents native selection before the first move', () => {
  const f = fixture();
  let prevented = false, cleared = false;
  f.context.window.getSelection = () => ({ removeAllRanges() { cleared = true; } });
  f.context.startNodeDrag({ ...f.pointer, preventDefault() { prevented = true; } }, { id: 'a' }, f.cards.a);
  assert.equal(prevented, true);
  assert.equal(cleared, true);
  assert.deepEqual(f.item.layout.positions.a, { x: 0, y: 0 });
  f.listeners.get('pointerup')({ type: 'pointerup' });
  assert.equal(f.saves(), 0);
  assert.equal(f.listeners.size, 0);
});

test('losing window focus during a drag restores geometry and removes listeners', () => {
  const f = fixture(), original = structuredClone(f.item.layout.positions);
  f.context.startNodeDrag(f.pointer, { id: 'a' }, f.cards.a);
  f.listeners.get('pointermove')({ clientX: 80, clientY: 40 });
  f.listeners.get('blur')();
  assert.deepEqual(structuredClone(f.item.layout.positions), original);
  assert.equal(f.saves(), 0);
  assert.equal(f.listeners.size, 0);
});

test('single, group, and cleared selection preserve mounted cards and content', () => {
  const f = fixture();
  const cards = ['a', 'b'].map((id) => ({
    dataset: { node: id }, selected: false,
    classList: { toggle(name, enabled) { if (name === 'selected') cards.find((card) => card.dataset.node === id).selected = enabled; }, remove() {} },
    querySelector: () => null, append() {}
  }));
  let toolbar = null;
  Object.assign(f.context, {
    graphFocus: null, editingTarget: null, activeConnection: null,
    selectedId: 'a', renderNodeActions: () => ({}),
    el: () => ({ remove() { toolbar = null; } }), button: () => ({}), removeNodes() {},
    document: {
      querySelector: (selector) => selector === '.canvas-shell' ? { append(entry) { toolbar = entry; } } : selector === '.selection-toolbar' ? toolbar : null,
      querySelectorAll: (selector) => selector === '.topic-card' ? cards : []
    }
  });
  f.item.nodes = [{ id: 'a' }, { id: 'b' }];
  vm.runInContext(source.match(/^function syncCanvasSelection\([^]*?^}/m)[0], f.context);
  f.context.syncCanvasSelection();
  assert.deepEqual(cards.map((card) => card.selected), [true, false]);
  f.context.selectedId = null;
  f.context.selectedIds = new Set(['a', 'b']);
  f.context.syncCanvasSelection();
  assert.deepEqual(cards.map((card) => card.selected), [true, true]);
  assert.ok(toolbar);
  f.context.selectedIds.clear();
  f.context.syncCanvasSelection();
  assert.deepEqual(cards.map((card) => card.selected), [false, false]);
  assert.equal(toolbar, null);
});

for (const group of [false, true]) {
  for (const cancel of [false, true]) {
    test(`${group ? 'group' : 'single'} drag ${cancel ? 'cancellation restores' : 'commit saves'} geometry in place`, () => {
      const f = fixture();
      if (group) f.context.selectedIds = new Set(['a', 'b']);
      const original = structuredClone(f.item.layout.positions);
      f.context.startNodeDrag(f.pointer, { id: 'a' }, f.cards.a);
      f.listeners.get('pointermove')({ clientX: 73, clientY: 39 });
      assert.notEqual(f.item.layout.positions.a.x, original.a.x);
      const final = structuredClone(f.item.layout.positions);
      f.listeners.get(cancel ? 'pointercancel' : 'pointerup')({ type: cancel ? 'pointercancel' : 'pointerup' });
      assert.deepEqual(structuredClone(f.item.layout.positions), cancel ? original : final);
      assert.equal(f.cards.a.style.left, `${f.item.layout.positions.a.x}px`);
      assert.equal(f.saves(), cancel ? 0 : 1);
      assert.equal(f.context.state.history.project?.length || 0, cancel ? 0 : 1);
      if (!cancel) {
        assert.deepEqual(f.context.state.history.project[0].layout.positions, original);
        assert.equal(f.controls.Undo.disabled, false);
        assert.equal(f.controls.Redo.disabled, true);
      }
      assert.equal(f.listeners.size, 0);
    });
  }
}

for (const cancel of [false, true]) {
  test(`resize ${cancel ? 'cancellation' : 'commit'} preserves the card and correct undo geometry`, () => {
    const f = fixture(), original = structuredClone(f.item.layout.sizes.a);
    f.context.startNodeResize(f.pointer, { id: 'a' }, f.cards.a, f.cards.a);
    f.listeners.get('pointermove')({ clientX: 80, clientY: 60 });
    const final = structuredClone(f.item.layout.sizes.a);
    f.listeners.get(cancel ? 'pointercancel' : 'pointerup')({ type: cancel ? 'pointercancel' : 'pointerup' });
    assert.deepEqual(structuredClone(f.item.layout.sizes.a), cancel ? original : final);
    assert.equal(f.cards.a.style.width, `${f.item.layout.sizes.a.width}px`);
    assert.equal(f.saves(), cancel ? 0 : 1);
    if (!cancel) assert.deepEqual(f.context.state.history.project[0].layout.sizes.a, original);
    assert.equal(f.listeners.size, 0);
  });
}

test('keyboard resize keeps focus on the mounted grip and records history', () => {
  const f = fixture();
  f.context.resizeNodeWithKeys({ ...f.pointer, key: 'ArrowRight' }, { id: 'a' });
  assert.equal(f.item.layout.sizes.a.width, 264);
  assert.equal(f.cards.a.style.width, '264px');
  assert.equal(f.context.state.history.project.length, 1);
});

test('opening, switching, and closing panels only replaces panel DOM', () => {
  const f = fixture(), mounted = new Set(), buttons = new Map();
  const panel = (name) => ({ name, remove() { mounted.delete(this); } });
  const shell = { append: (entry) => mounted.add(entry) };
  f.context.document = {
    querySelectorAll: () => [...mounted],
    querySelector: (selector) => {
      if (selector === '.canvas-shell') return shell;
      if (!buttons.has(selector)) buttons.set(selector, { classList: { toggle() {} }, setAttribute() {} });
      return buttons.get(selector);
    }
  };
  Object.assign(f.context, {
    aiPanel: null, researchPanel: null, openSourceId: null,
    renderSourcesPanel: () => panel('library'),
    renderAiPanel: () => shell.append(panel('chat')),
    renderResearchPanel: () => shell.append(panel('research')),
    openAiPanel: () => { f.context.aiPanel = {}; f.context.refreshWorkspacePanels(); }
  });
  f.context.openSource('library');
  assert.deepEqual([...mounted].map((entry) => entry.name), ['library']);
  f.context.toggleAiPanel();
  assert.deepEqual([...mounted].map((entry) => entry.name), ['chat']);
  let cancelled = 0;
  f.context.aiPanel.chatController = { abort: () => cancelled++ };
  f.context.toggleAiPanel();
  assert.equal(cancelled, 1);
  assert.equal(mounted.size, 0);
  f.context.researchPanel = {};
  f.context.refreshWorkspacePanels();
  f.context.openSource('library');
  assert.equal(f.context.researchPanel, null);
  assert.deepEqual([...mounted].map((entry) => entry.name), ['library']);
  f.context.openSource(null);
  assert.equal(mounted.size, 0);
});

test('outline toggling preserves the canvas and updates its existing header control', () => {
  const f = fixture();
  let outline = null, saved = 0;
  const control = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, classList: { toggle() {} } };
  Object.assign(f.context, {
    outlineOpen: false,
    saveView: () => saved++,
    renderOutline: () => ({ remove() { outline = null; } }),
    document: { querySelector(selector) {
      if (selector === '.outline-panel') return outline;
      if (selector === '.canvas-shell') return { append: (entry) => { outline = entry; } };
      return control;
    } }
  });
  f.context.toggleOutline();
  assert.ok(outline);
  assert.equal(control.attributes['aria-label'], 'Hide outline');
  f.context.toggleOutline();
  assert.equal(outline, null);
  assert.equal(control.attributes['aria-label'], 'Open outline');
  assert.equal(saved, 2);
});
