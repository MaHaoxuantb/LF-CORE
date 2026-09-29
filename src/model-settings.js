export const MODEL_SETTINGS_KEY = 'learning-canvas:model-settings-v1';
let unlockedKey = '';

const KEY_REQUIRED_HOSTS = new Set(['api.openai.com', 'openrouter.ai']);

export function endpointRequiresApiKey(value) {
  try { return KEY_REQUIRED_HOSTS.has(new URL(value.trim()).hostname.toLowerCase()); }
  catch { return false; }
}

export function completionUrl(value, allowHttp = false) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('Use an endpoint without credentials, query, or fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowHttp))) throw new Error('Use HTTPS, HTTP on localhost, or enable Developer mode for another HTTP endpoint.');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path || ''}/chat/completions`;
  return url.href;
}

export function loadModelSettings(storage = localStorage) {
  const parsed = JSON.parse(storage.getItem(MODEL_SETTINGS_KEY) || 'null');
  if (!parsed) return { endpoint: 'https://api.openai.com/v1', models: [], selectedModel: '', secret: null, developerMode: false };
  return { endpoint: parsed.endpoint || '', models: Array.isArray(parsed.models) ? parsed.models : [], selectedModel: parsed.selectedModel || '', secret: parsed.secret || null, developerMode: parsed.developerMode === true };
}

export function saveModelSettings(settings, storage = localStorage) {
  const models = [...new Set(settings.models.map((name) => name.trim()).filter(Boolean))];
  if (!models.length) throw new Error('Add at least one model.');
  const developerMode = settings.developerMode === true;
  completionUrl(settings.endpoint, developerMode);
  const selectedModel = settings.selectedModel?.trim() || models[0];
  if (!models.includes(selectedModel)) throw new Error('The active model must match a model in the list.');
  const saved = { endpoint: settings.endpoint.trim(), models, selectedModel, secret: settings.secret || null, developerMode };
  storage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(saved));
  return saved;
}

export function saveModelSecret(secret, storage = localStorage) {
  const settings = loadModelSettings(storage);
  storage.setItem(MODEL_SETTINGS_KEY, JSON.stringify({ ...settings, secret: secret || null }));
  return { ...settings, secret: secret || null };
}

export function saveDeveloperMode(enabled, storage = localStorage) {
  const settings = loadModelSettings(storage);
  const developerMode = enabled === true;
  storage.setItem(MODEL_SETTINGS_KEY, JSON.stringify({ ...settings, developerMode }));
  return { ...settings, developerMode };
}

const bytes = (array) => Array.from(array, (n) => n.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g)?.map((part) => parseInt(part, 16)) || []);
async function derive(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptApiKey(key, passphrase) {
  if (!key.trim() || !passphrase || passphrase.length < 12) throw new Error('Enter a key and a passphrase of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(passphrase, salt), new TextEncoder().encode(key.trim()));
  unlockedKey = key.trim();
  return { version: 1, salt: bytes(salt), iv: bytes(iv), ciphertext: bytes(new Uint8Array(ciphertext)) };
}

export async function unlockApiKey(secret, passphrase) {
  if (!secret || secret.version !== 1) throw new Error('No stored key to unlock.');
  if (!passphrase) throw new Error('Enter the passphrase used when the key was stored.');
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(secret.iv) }, await derive(passphrase, fromHex(secret.salt)), fromHex(secret.ciphertext));
    unlockedKey = new TextDecoder().decode(plaintext);
    return unlockedKey;
  } catch { throw new Error('Could not unlock the key. Check your passphrase.'); }
}

export function getApiKey() { return unlockedKey; }
export function lockApiKey() { unlockedKey = ''; }
