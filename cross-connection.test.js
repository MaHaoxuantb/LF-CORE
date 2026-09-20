import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionPort, crossConnectionRoute, nearestConnectionSide } from './src/cross-connection.js';

const a = { x: 0, y: 0, width: 100, height: 80 };
const b = { x: 300, y: 50, width: 100, height: 80 };

test('both ends of a bidirectional connection route independently', () => {
  const route = crossConnectionRoute(a, b, 'top', 'bottom');
  assert.deepEqual([route.x1, route.y1, route.x2, route.y2], [50, 0, 350, 130]);
  assert.equal(route.fromSide, 'top');
  assert.equal(route.toSide, 'bottom');
  assert.notEqual(route.d, crossConnectionRoute(a, b, 'right', 'bottom').d);
  assert.notEqual(route.d, crossConnectionRoute(a, b, 'top', 'left').d);
});

test('automatic route attaches on facing sides', () => {
  const route = crossConnectionRoute(a, b);
  assert.deepEqual([route.fromSide, route.toSide], ['right', 'left']);
  assert.deepEqual([route.x1, route.x2], [100, 300]);
});

test('dragging snaps to the nearest side of the selected node', () => {
  assert.equal(nearestConnectionSide(a, 49, -40), 'top');
  assert.equal(nearestConnectionSide(a, 140, 40), 'right');
  assert.deepEqual(connectionPort(a, 'bottom'), { x: 50, y: 80, nx: 0, ny: 1 });
});
