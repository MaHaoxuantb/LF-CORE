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


test('task updates refresh Stop and placeholder without replacing the composer draft', () => {
  const start = source.indexOf('function syncHostAgentComposer(');
  const end = source.indexOf('\nfunction updateHostAgentTaskView(', start);
  const input = { value: 'Unsent draft', placeholder: '' };
  let stop;
  const form = {
    querySelector: selector => selector === 'textarea' ? input : stop,
    append: control => { stop = control; },
  };
  const sync = vm.runInNewContext(`${source.slice(start, end)}; syncHostAgentComposer`, {
    currentChat: () => ({ id: 'conversation' }),
    document: { querySelector: () => form },
    agentStopButton: task => ({ dataset: { agentStop: task.id }, remove() { stop = undefined; } }),
  });
  sync({ id: 'task', conversationId: 'conversation', status: 'running' });
  assert.equal(stop.dataset.agentStop, 'task');
  sync({ id: 'task', conversationId: 'conversation', status: 'completed' });
  assert.equal(stop, undefined);
  assert.equal(input.value, 'Unsent draft');
  assert.match(input.placeholder, /Describe/);
});
