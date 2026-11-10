import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('historical agent proposals render without a live task object', () => {
  const start = source.indexOf('function renderAgentProposalCard(');
  const end = source.indexOf('\nfunction currentAgentFocus(', start);
  const el = (tag, props, ...children) => ({ tag, props, children, append(...items) { this.children.push(...items); } });
  const render = vm.runInNewContext(`${source.slice(start, end)}; renderAgentProposalCard`, {
    el, agentProposalStatus: () => 'accepted',
  });
  const card = render({ runStatus: 'ready', operations: [], message: 'Historical result' }, {});
  assert.equal(card.tag, 'section');
  assert.ok(card.children.some(child => child?.props?.text === 'Historical result'));
});


test('live task events do not replace the universal composer or duplicate its controls', () => {
  const start = source.indexOf('function receiveHostAgentTask(');
  const end = source.indexOf('async function pauseProjectTasks(', start);
  assert.ok(!source.slice(start, end).includes('renderAiPanel('));
  assert.ok(!source.includes('function renderHostAgentTask('));
  assert.ok(source.includes("document.createElement('lfos-agent-panel')"));
});
