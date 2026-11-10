import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegion } from '../src/screenshot.js';
const snapshot = { viewRevision: 'v1', viewport: { width: 800, height: 600 } };
test('region captures require current view coordinates and reject invalid or oversized regions', () => {
  const valid = { x: 10, y: 20, width: 200, height: 100 };
  assert.doesNotThrow(() => validateRegion(valid, 'v1', snapshot));
  assert.throws(() => validateRegion(valid, 'old', snapshot), { code: 'CONFLICT' });
  for (const patch of [{ x: -1 }, { width: 0 }, { y: NaN }, { x: 799 }, { height: Infinity }]) assert.throws(() => validateRegion({ ...valid, ...patch }, 'v1', snapshot), { code: 'INVALID_ARGUMENT' });
});
