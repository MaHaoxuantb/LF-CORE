import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { THINKING_EFFORTS, loadModelSettings, saveModelSettings } from '../src/model-settings.js';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

async function fixture(available, initial = {}) {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  if (Object.keys(initial).length) saveModelSettings({ ...loadModelSettings(storage), ...initial }, storage);
  const elements = [];
  const el = (tag, attrs = {}, ...children) => {
    const element = { tag, hidden: false, disabled: false, ...attrs, children, listeners: {},
      value: attrs.value || '', textContent: attrs.text || '',
      append(...children) { this.children.push(...children); },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      focus() {}, remove() {}, querySelector() { return null; }
    };
    elements.push(element);
    return element;
  };
  const context = vm.createContext({
    lfosConnection: Promise.resolve(), lfos: { intelligenceAvailable: available },
    loadModelSettings: () => loadModelSettings(storage), saveModelSettings: value => saveModelSettings(value, storage),
    THINKING_EFFORTS, el, button: (text, action) => { const button = el('button', { text }); button.listeners.click = action; return button; },
    document: { querySelector: () => null, body: { append() {} } },
    aiFeaturesEnabled: true, aiPanel: null, getApiKey: () => '', endpointRequiresApiKey: () => true,
    announce() {}, PRODUCT_NAME: 'LF CORE', PRODUCT_VERSION: '0.1.0'
  });
  for (const name of ['renderSettings', 'aiConfigurationIssue']) {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
    vm.runInContext(match[0], context);
  }
  await context.renderSettings();
  return { context, settings: () => loadModelSettings(storage), find: label => elements.find(element => element['aria-label'] === label), button: text => elements.find(element => element.tag === 'button' && element.textContent === text) };
}

test('AI Settings offers SolOS only when detected and saves chosen effort without a key or model', async () => {
  const plain = await fixture(false);
  assert.deepEqual(plain.find('AI provider').children.map(option => option.value), ['endpoint']);
  const solos = await fixture(true);
  const provider = solos.find('AI provider');
  assert.deepEqual(provider.children.map(option => option.value), ['endpoint', 'solos']);
  provider.value = 'solos'; provider.listeners.change();
  const effort = solos.find('Thinking effort');
  assert.deepEqual(effort.children.map(option => option.value), ['none', 'low', 'medium', 'high']);
  effort.value = 'high';
  await solos.button('Save AI settings').listeners.click();
  assert.equal(solos.settings().provider, 'solos');
  assert.equal(solos.settings().thinkingEffort, 'high');
  assert.equal(solos.settings().models.length, 0);
  assert.equal(solos.context.aiConfigurationIssue(solos.settings()), '');
});

test('unavailable saved SolOS selection is disabled and requires explicit provider selection', async () => {
  const f = await fixture(false, { provider: 'solos', thinkingEffort: 'low' });
  const option = f.find('AI provider').children.find(option => option.value === 'solos');
  assert.equal(option.disabled, true);
  assert.match(f.context.aiConfigurationIssue(f.settings()), /unavailable/);
  await f.button('Save AI settings').listeners.click();
  assert.equal(f.settings().provider, 'solos');
});

test('SolOS availability ignores a locked key retained for another provider', async () => {
  const f = await fixture(true, { provider: 'solos', secret: { version: 1, ciphertext: 'encrypted' } });
  assert.equal(f.context.aiConfigurationIssue(f.settings()), '');
  f.find('Thinking effort').value = 'none';
  await f.button('Save AI settings').listeners.click();
  assert.equal(f.settings().secret.ciphertext, 'encrypted');
  assert.equal(f.settings().thinkingEffort, 'none');
});
