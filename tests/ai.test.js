import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { completionUrl, encryptApiKey, unlockApiKey, getApiKey, lockApiKey, saveModelSettings, saveModelSecret, saveDeveloperMode, loadModelSettings } from '../src/model-settings.js';
import { complete, generateArticle, askModel, partialChatReply, proposeInsertion } from '../src/ai.js';

globalThis.crypto ||= webcrypto;

test('settings keep only encrypted key material; unlocking is session scoped', async () => {
  const secret = await encryptApiKey('sk-private-example', 'a strong passphrase');
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) };
  saveModelSettings({ endpoint: 'https://api.openai.com/v1', models: ['model-a'], selectedModel: 'model-a', secret }, storage);
  assert.ok(!JSON.stringify([...data]).includes('sk-private-example'));
  lockApiKey(); assert.equal(getApiKey(), '');
  await assert.rejects(unlockApiKey(loadModelSettings(storage).secret, 'wrong passphrase'));
  await assert.rejects(unlockApiKey(loadModelSettings(storage).secret, ''), /Enter the passphrase/);
  assert.equal(await unlockApiKey(secret, 'a strong passphrase'), 'sk-private-example');
  lockApiKey();
});

test('an encrypted key can be stored before model configuration and unlocked later', async () => {
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) };
  const secret = await encryptApiKey('sk-first', 'another strong passphrase');
  saveModelSecret(secret, storage);
  lockApiKey();
  assert.equal(await unlockApiKey(loadModelSettings(storage).secret, 'another strong passphrase'), 'sk-first');
  saveModelSecret(null, storage);
  assert.equal(loadModelSettings(storage).secret, null);
  lockApiKey();
});

test('completion endpoint validates transport and preserves compatible paths', () => {
  assert.equal(completionUrl('https://host.example/v1/'), 'https://host.example/v1/chat/completions');
  assert.equal(completionUrl('http://127.0.0.1:8080/v1/chat/completions'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.throws(() => completionUrl('http://host.example/v1'));
  assert.equal(completionUrl('http://host.example/v1', true), 'http://host.example/v1/chat/completions');
  assert.throws(() => completionUrl('https://host.example/v1?key=secret'));
});

test('developer mode persists and opts model requests into HTTP transport', async () => {
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) };
  saveDeveloperMode(true, storage);
  const settings = saveModelSettings({ endpoint: 'http://model.lan/v1', models: ['local-model'], selectedModel: '', developerMode: loadModelSettings(storage).developerMode }, storage);
  assert.equal(loadModelSettings(storage).developerMode, true);
  let requestedUrl;
  await complete(settings, '', [], { fetcher: async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Ready.' } }] }) };
  } });
  assert.equal(requestedUrl, 'http://model.lan/v1/chat/completions');
});

test('single listed model becomes active when selection is empty', () => {
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) };
  const saved = saveModelSettings({ endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: ['openai/gpt-5.6-luna'], selectedModel: '' }, storage);
  assert.equal(saved.selectedModel, 'openai/gpt-5.6-luna');
  assert.equal(loadModelSettings(storage).selectedModel, 'openai/gpt-5.6-luna');
});

test('OpenAI compatible request sends only selected context and returns answer', async () => {
  const calls = [];
  const settings = { endpoint: 'https://host.example/v1', models: ['model-a'], selectedModel: 'model-a' };
  const fetcher = async (url, request) => {
    calls.push({ url, request });
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Explanation.' } }] }) };
  };
  const answer = await askModel(settings, 'secret', 'Why?', { kind: 'selected passage', text: 'Just this excerpt.' }, { fetcher });
  assert.equal(answer, 'Explanation.');
  assert.equal(calls[0].request.headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].url, 'https://host.example/v1/chat/completions');
  assert.match(calls[0].request.body, /Just this excerpt/);
  assert.doesNotMatch(calls[0].request.body, /full source/i);
});

test('proposed edits do not mutate article and malformed generation is rejected', async () => {
  const before = '# Article\n\nA proof step.\n';
  const preview = proposeInsertion(before, 'An explanation.', { kind: 'article', quote: 'A proof step.' });
  assert.equal(before, '# Article\n\nA proof step.\n');
  assert.match(preview.after, /A proof step\.\n\nAn explanation/);
  const settings = { endpoint: 'https://host.example/v1', models: ['a'], selectedModel: 'a' };
  await assert.rejects(generateArticle(settings, '', 'LEAN', { fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Short.' } }] }) }) }), /incomplete article/);
  await assert.rejects(complete(settings, '', [], { fetcher: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
});

test('streaming completion decodes SSE deltas and reports accumulated text', async () => {
  const settings = { endpoint: 'https://host.example/v1', models: ['a'], selectedModel: 'a' };
  const chunks = [
    'data: {"choices":[{"delta":{"content":"H',
    'el"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
  ].map((chunk) => new TextEncoder().encode(chunk));
  let index = 0, request, updates = [];
  const fetcher = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, body: { getReader: () => ({ read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true } }) } };
  };
  const result = await complete(settings, '', [], { fetcher, onDelta: (delta, accumulated) => updates.push([delta, accumulated]) });
  assert.equal(request.stream, true);
  assert.equal(result, 'Hello');
  assert.deepEqual(updates, [['Hel', 'Hel'], ['lo', 'Hello']]);
});

test('partial chat reply exposes only the decoded reply field', () => {
  assert.equal(partialChatReply('{"reply":"First line\\nSecond'), 'First line\nSecond');
  assert.equal(partialChatReply('{"reply":"A \\u263A'), 'A ☺');
  assert.equal(partialChatReply('{"rep'), '');
  assert.equal(partialChatReply('Plain response'), 'Plain response');
});
