import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMoveGeometry, resolveResizeGeometry, selectionBounds, snapValue } from '../src/node-geometry.js';

test('grid snapping handles positive and negative canvas coordinates', () => {
  assert.equal(snapValue(35), 24);
  assert.equal(snapValue(37), 48);
  assert.equal(snapValue(-35), -24);
  assert.equal(snapValue(-37), -48);
});

test('selection bounds preserve a multi-node selection as one rectangle', () => {
  assert.deepEqual(selectionBounds([
    { x: 10, y: 20, width: 100, height: 80 },
    { x: 150, y: -10, width: 50, height: 40 }
  ]), { x: 10, y: -10, width: 190, height: 110 });
});

test('moving can use grid snapping without alignment', () => {
  const result = resolveMoveGeometry({
    bounds: { x: 10, y: 10, width: 100, height: 100 }, dx: 19, dy: 40, snapping: true
  });
  assert.deepEqual({ dx: result.dx, dy: result.dy }, { dx: 14, dy: 38 });
  assert.deepEqual(result.guides, []);
});

test('alignment overrides the nearby grid position on each axis', () => {
  const result = resolveMoveGeometry({
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    dx: 47,
    dy: 47,
    targets: [{ id: 'target', x: 50, y: 50, width: 120, height: 80 }],
    snapping: true,
    alignment: true
  });
  assert.deepEqual({ dx: result.dx, dy: result.dy }, { dx: 50, dy: 50 });
  assert.deepEqual(result.guides.map((guide) => guide.axis), ['x', 'y']);
});

test('alignment tolerance stays constant in screen pixels across zoom levels', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 };
  const targets = [{ id: 'target', x: 105, y: 500, width: 100, height: 100 }];
  assert.equal(resolveMoveGeometry({ bounds, dx: 100, dy: 0, targets, alignment: true, zoom: 1 }).dx, 105);
  assert.equal(resolveMoveGeometry({ bounds, dx: 100, dy: 0, targets, alignment: true, zoom: 2 }).dx, 100);
});

test('alignment candidate selection is deterministic when distances tie', () => {
  const result = resolveMoveGeometry({
    bounds: { x: 0, y: 0, width: 20, height: 20 },
    dx: 100,
    dy: 100,
    targets: [
      { id: 'z', x: 96, y: 300, width: 20, height: 20 },
      { id: 'a', x: 104, y: 400, width: 20, height: 20 }
    ],
    alignment: true
  });
  assert.equal(result.dx, 104);
});

test('moving with both features disabled returns the raw pointer delta', () => {
  const result = resolveMoveGeometry({
    bounds: { x: 10, y: 20, width: 30, height: 40 }, dx: 13.5, dy: -7.25,
    targets: [{ id: 'target', x: 24, y: 12, width: 30, height: 40 }]
  });
  assert.deepEqual({ dx: result.dx, dy: result.dy, guides: result.guides }, { dx: 13.5, dy: -7.25, guides: [] });
});

test('resize snaps only the active right and bottom edges', () => {
  const result = resolveResizeGeometry({
    rect: { x: 10, y: 20, width: 100, height: 100 }, width: 127, height: 119, snapping: true
  });
  assert.deepEqual({ width: result.width, height: result.height }, { width: 134, height: 124 });
});

test('resize aligns right and bottom edges to other node edges', () => {
  const result = resolveResizeGeometry({
    rect: { x: 10, y: 20, width: 100, height: 100 },
    width: 187,
    height: 178,
    targets: [{ id: 'target', x: 200, y: 200, width: 80, height: 90 }],
    alignment: true
  });
  assert.deepEqual({ width: result.width, height: result.height }, { width: 190, height: 180 });
  assert.deepEqual(result.guides.map((guide) => guide.axis), ['x', 'y']);
});

test('keyboard-style resize constrains snapping to the changed axis', () => {
  const result = resolveResizeGeometry({
    rect: { x: 10, y: 20, width: 101, height: 103 },
    width: 121,
    height: 103,
    snapping: true,
    axes: ['x']
  });
  assert.deepEqual({ width: result.width, height: result.height }, { width: 110, height: 103 });
});
