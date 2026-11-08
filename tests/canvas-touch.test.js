import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCanvasTouch } from '../src/canvas-touch.js';

function fixture() {
  const emitter = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
      dispatchEvent(event) { for (const callback of [...(listeners.get(event.type) || [])]) callback(event); }
    };
  };
  const host = emitter(), timers = new Map(), captures = new Set();
  let timerId = 0, view = { x: 20, y: 30, zoom: 1 }, saves = 0, cleared = 0, active = false, menus = 0, selection = false;
  Object.assign(host, {
    PointerEvent: class { constructor(type, properties) { Object.assign(this, properties, { type }); } },
    getSelection: () => ({ removeAllRanges() {} }),
    setTimeout(callback) { const id = ++timerId; timers.set(id, () => { timers.delete(id); callback(); }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const viewport = Object.assign(emitter(), {
    ownerDocument: { defaultView: host },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 10, top: 15 }),
    setPointerCapture: (id) => captures.add(id), hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
    closest: () => null
  });
  const target = (kind) => ({
    closest: (selector) => kind === 'card' && selector.includes('.topic-card') ? {} : kind === 'input' && selector.includes('input') ? { matches: () => false } : null,
    dispatchEvent: (event) => host.dispatchEvent(event)
  });
  attachCanvasTouch(viewport, {
    getView: () => view, updateView: (next) => { view = next; }, saveView: () => saves++,
    setActive: (next) => { active = next; }, clearSelection: () => cleared++, openMenu: () => menus++, selectionMode: () => selection
  });
  const fire = (type, id, x, y, entry = viewport, pointerType = 'touch') => {
    const event = {
      type, pointerId: id, clientX: x, clientY: y, target: entry, pointerType,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }
    };
    (type === 'pointerdown' || type === 'click' ? viewport : host).dispatchEvent(event);
    return event;
  };
  return { host, viewport, target, fire, timers, captures, view: () => view, saves: () => saves, cleared: () => cleared,
    active: () => active, menus: () => menus, selection: (next) => { selection = next; } };
}

test('one finger pans in screen pixels, ignores jitter and unrelated pointers, and saves once', () => {
  const f = fixture();
  assert.equal(f.fire('pointerdown', 1, 100, 100).stopped, true);
  f.fire('pointermove', 1, 103, 102);
  assert.deepEqual(f.view(), { x: 20, y: 30, zoom: 1 });
  f.fire('pointermove', 9, 900, 900);
  f.fire('pointermove', 1, 150, 130);
  assert.deepEqual(f.view(), { x: 70, y: 60, zoom: 1 });
  f.fire('pointerup', 1, 150, 130);
  assert.equal(f.saves(), 1);
  assert.equal(f.active(), false);
  assert.equal(f.captures.size, 0);
  assert.equal(f.fire('click', 1, 150, 130).prevented, true);
  assert.equal(f.cleared(), 0);
});

test('pinching preserves the world point under the moving midpoint and continues with one finger', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 100);
  f.fire('pointerdown', 2, 200, 100);
  f.fire('pointermove', 1, 50, 120);
  f.fire('pointermove', 2, 250, 120);
  assert.equal(f.view().zoom, 1.8, 'zoom respects the existing camera maximum');
  assert.ok(Math.abs(f.view().x - (140 - 120 * 1.8)) < 1e-9);
  assert.ok(Math.abs(f.view().y - (105 - 55 * 1.8)) < 1e-9);
  f.fire('pointerup', 2, 250, 120);
  const before = { ...f.view() };
  f.fire('pointermove', 1, 70, 150);
  assert.equal(f.view().x, before.x + 20);
  assert.equal(f.view().y, before.y + 30);
  f.fire('pointerup', 1, 70, 150);
  assert.equal(f.saves(), 1);
});

test('second finger cancels a card interaction before taking camera ownership', () => {
  const f = fixture(), card = f.target('card'), cancelled = [];
  f.host.addEventListener('pointercancel', (event) => cancelled.push(event.pointerId));
  assert.equal(f.fire('pointerdown', 1, 100, 100, card).stopped, undefined);
  assert.equal(f.fire('pointerdown', 2, 200, 100).stopped, true);
  assert.ok(cancelled.includes(1));
  f.fire('pointermove', 2, 240, 100);
  assert.ok(f.view().zoom > 1);
  f.fire('pointercancel', 1, 100, 100);
  assert.equal(f.captures.size, 0);
  assert.equal(f.active(), false);
  assert.equal(f.saves(), 1);
});

test('selection mode keeps one-finger marquee available and still allows two-finger navigation', () => {
  const f = fixture();
  f.selection(true);
  assert.equal(f.fire('pointerdown', 1, 100, 100).stopped, undefined);
  assert.equal(f.active(), false);
  assert.equal(f.fire('pointerdown', 2, 200, 100).stopped, true);
  f.fire('pointermove', 2, 210, 100);
  assert.ok(f.view().zoom > 1);
  f.host.dispatchEvent({ type: 'blur' });
  assert.equal(f.active(), false);
  assert.equal(f.captures.size, 0);
});

test('tap clears selection, hold opens the menu, and movement cancels the hold timer', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 100);
  f.fire('pointerup', 1, 100, 100);
  assert.equal(f.cleared(), 1);
  assert.equal(f.saves(), 0);
  f.fire('pointerdown', 2, 100, 100);
  [...f.timers.values()][0]();
  f.fire('pointerup', 2, 100, 100);
  assert.equal(f.menus(), 1);
  assert.equal(f.cleared(), 1);
  f.fire('pointerdown', 3, 100, 100);
  f.fire('pointermove', 3, 130, 100);
  assert.equal(f.timers.size, 0);
  f.fire('pointerup', 3, 130, 100);
});

test('inputs, mouse, and pen retain their normal event handling', () => {
  const f = fixture();
  for (const type of ['mouse', 'pen']) assert.equal(f.fire('pointerdown', 1, 100, 100, f.viewport, type).stopped, undefined);
  assert.equal(f.fire('pointerdown', 1, 100, 100, f.target('input')).stopped, undefined);
  assert.equal(f.active(), false);
  assert.equal(f.host.listeners.get('pointermove')?.size || 0, 0);
});

test('swiping overflowing content scrolls the note without changing or saving the camera', () => {
  const f = fixture(), content = { scrollLeft: 0, scrollTop: 0, clientHeight: 80, scrollHeight: 800, clientWidth: 240, scrollWidth: 240 };
  const target = {
    closest: (selector) => selector.includes('node-content') ? content : selector.includes('.topic-card') ? {} : null,
    dispatchEvent: (event) => f.host.dispatchEvent(event)
  };
  f.fire('pointerdown', 1, 100, 100, target);
  f.fire('pointermove', 1, 100, 60);
  assert.equal(content.scrollTop, 40);
  f.fire('pointerup', 1, 100, 50);
  assert.equal(content.scrollTop, 50);
  assert.deepEqual(f.view(), { x: 20, y: 30, zoom: 1 });
  assert.equal(f.saves(), 0);
  assert.equal(f.cleared(), 0);
  assert.equal(f.captures.size, 0);
});

test('losing camera capture ends navigation and releases all gesture listeners', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 100);
  f.fire('pointermove', 1, 140, 120);
  f.viewport.dispatchEvent({ type: 'lostpointercapture', pointerId: 1, target: f.viewport });
  assert.equal(f.active(), false);
  assert.equal(f.saves(), 1);
  assert.equal(f.captures.size, 0);
  for (const type of ['pointermove', 'pointerup', 'pointercancel', 'blur']) assert.equal(f.host.listeners.get(type)?.size || 0, 0);
});
