import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasTransform, fittedCanvasView, hasCanvasView } from '../src/canvas-view.js';

test('fresh document camera is fitted to finite coordinates before its first transform', () => {
  assert.equal(hasCanvasView({ x: null, y: null, zoom: 1 }), false);
  const view = fittedCanvasView([], { width: 1100, height: 720 }, { width: 490, height: 550 });
  assert.equal(hasCanvasView(view), true);
  assert.equal(canvasTransform(view), `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`);
  assert.equal(canvasTransform({ ...view }), canvasTransform(view), 'a toolbar rerender must not change camera setup');
});

test('saved cameras preserve zero and negative coordinates; invalid cameras cannot reach CSS', () => {
  for (const view of [{ x: 0, y: 0, zoom: 1 }, { x: -500, y: 100, zoom: .75 }]) assert.equal(hasCanvasView(view), true);
  for (const view of [{ x: null, y: 0, zoom: 1 }, { x: undefined, y: 0, zoom: 1 }, { x: 0, y: NaN, zoom: 1 }, { x: 0, y: 0, zoom: 0 }]) {
    assert.equal(hasCanvasView(view), false);
    assert.throws(() => canvasTransform(view), /finite/);
  }
});

test('fit uses the current document size and keeps node bounds inside the camera calculation', () => {
  const bounds = [{ x: 760, y: 22, width: 238, height: 108 }, { x: -380, y: 200, width: 238, height: 108 }];
  const view = fittedCanvasView(bounds, { width: 1100, height: 720 }, { width: 490, height: 550 });
  assert.ok(view.zoom >= .45 && view.zoom <= 1);
  assert.equal(view.x + (-430 + 998) / 2 * view.zoom, 550);
  assert.equal(view.y + (-80 + 630) / 2 * view.zoom, 360);
  const tallDocument = fittedCanvasView(bounds, { width: 1100, height: 720 }, { width: 490, height: 1200 });
  assert.notEqual(tallDocument.y, view.y);
});
