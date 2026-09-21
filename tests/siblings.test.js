import test from 'node:test';
import assert from 'node:assert/strict';
import { siblingPredecessor } from '../src/siblings.js';

const workspace = (edges, highlights = []) => ({
  nodes: ['before', 'node', 'other'].map((id) => ({ id })),
  edges,
  highlights,
});

test('a single forward edge into a node enables a sibling predecessor', () => {
  const edge = { id: 'e', fromId: 'before', toId: 'node', direction: 'forward' };
  assert.deepEqual(siblingPredecessor(workspace([edge]), 'node'), { edge, predecessorId: 'before' });
});

test('connection direction, not stored endpoint order, determines the predecessor', () => {
  const edge = { id: 'e', fromId: 'node', toId: 'before', direction: 'reverse' };
  assert.deepEqual(siblingPredecessor(workspace([edge]), 'node'), { edge, predecessorId: 'before' });
  assert.equal(siblingPredecessor(workspace([{ ...edge, direction: 'forward' }]), 'node'), null);
});

test('highlight-to-node arrows can define siblings', () => {
  const edge = { id: 'e', fromId: 'h:passage', toId: 'node', direction: 'forward' };
  const item = workspace([edge], [{ id: 'passage', targetId: 'article' }]);
  assert.deepEqual(siblingPredecessor(item, 'node'), { edge, predecessorId: 'h:passage' });
});

test('unconnected, bidirectional, missing, and ambiguous predecessors do not enable siblings', () => {
  assert.equal(siblingPredecessor(workspace([]), 'node'), null);
  assert.equal(siblingPredecessor(workspace([{ fromId: 'before', toId: 'node', direction: 'both' }]), 'node'), null);
  assert.equal(siblingPredecessor(workspace([{ fromId: 'missing', toId: 'node', direction: 'forward' }]), 'node'), null);
  assert.equal(siblingPredecessor(workspace([
    { fromId: 'before', toId: 'node', direction: 'forward' },
    { fromId: 'other', toId: 'node', direction: 'forward' },
  ]), 'node'), null);
});
