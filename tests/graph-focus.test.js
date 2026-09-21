import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraphFocusPreferences, relatedNodeIds } from '../src/graph-focus.js';

const graph = (nodes, edges, highlights = []) => ({ nodes: nodes.map((id) => ({ id })), edges, highlights });
const edge = (fromId, toId, direction = 'forward') => ({ fromId, toId, direction });
const sorted = (ids) => [...ids].sort();

test('directional focus gives incoming and outgoing chains independent depth budgets', () => {
  const ids = 'ABCDEFGH'.split('');
  const workspace = graph(ids, ids.slice(0, -1).map((id, index) => edge(id, ids[index + 1])));
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'G', 'directional', 5)), ['B', 'C', 'D', 'E', 'F', 'G', 'H']);
});

test('directional focus respects reverse and bidirectional edges and includes branches', () => {
  const workspace = graph(['root', 'in', 'out', 'branch', 'both'], [
    edge('root', 'in', 'reverse'),
    edge('root', 'out'),
    edge('out', 'branch'),
    edge('root', 'both', 'both'),
  ]);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'root', 'directional', 1)), ['both', 'in', 'out', 'root']);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'root', 'directional', 2)), ['both', 'branch', 'in', 'out', 'root']);
});

test('connected and neighbor focus ignore direction while honoring their radii', () => {
  const workspace = graph(['A', 'B', 'C', 'D'], [edge('A', 'B'), edge('C', 'B'), edge('C', 'D')]);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'A', 'neighbors', 20)), ['A', 'B']);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'A', 'connected', 2)), ['A', 'B', 'C']);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'A', 'connected', 3)), ['A', 'B', 'C', 'D']);
});

test('highlight endpoints map to their owning nodes while article highlights add no node', () => {
  const workspace = graph(['A', 'B', 'C'], [
    edge('h:inside-a', 'B'),
    edge('h:article', 'C'),
  ], [
    { id: 'inside-a', targetId: 'A' },
    { id: 'article', targetId: 'article' },
  ]);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'A', 'directional', 5)), ['A', 'B']);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'C', 'directional', 5)), ['C']);
});

test('cycles, duplicate edges, malformed endpoints, and collapsed flags do not affect traversal', () => {
  const workspace = graph(['A', 'B', 'C'], [
    edge('A', 'B'), edge('A', 'B'), edge('B', 'C'), edge('C', 'A'), edge('missing', 'A'),
  ]);
  workspace.nodes[2].collapsed = true;
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'A', 'connected', 20)), ['A', 'B', 'C']);
  assert.deepEqual(sorted(relatedNodeIds(workspace, 'missing', 'connected', 5)), []);
});

test('focus preferences default and clamp invalid values', () => {
  assert.deepEqual(normalizeGraphFocusPreferences(), { mode: 'directional', depth: 5 });
  assert.deepEqual(normalizeGraphFocusPreferences({ mode: 'unknown', depth: 0 }), { mode: 'directional', depth: 1 });
  assert.deepEqual(normalizeGraphFocusPreferences({ mode: 'connected', depth: 99 }), { mode: 'connected', depth: 20 });
  assert.deepEqual(normalizeGraphFocusPreferences({ mode: 'neighbors', depth: '7' }), { mode: 'neighbors', depth: 7 });
});
