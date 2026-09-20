import { makeAnchor, resolveAnchor, selectionOffsets } from './anchors.js';
import { createWorkspace, emptyState, loadSaveMode, loadState, saveSaveMode, saveState, snapshotWorkspace } from './storage.js';
import { renderMarkdown, headingTokens } from './markdown.js';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/build/pdf.mjs';
import { putPdf, getPdf, deletePdf } from './source-store.js';
import { connectionPort, crossConnectionRoute, nearestConnectionSide } from './cross-connection.js';
import { loadModelSettings, saveModelSettings, encryptApiKey, unlockApiKey, getApiKey, lockApiKey } from './model-settings.js';
import { generateArticle, askModel, proposeInsertion } from './ai.js';
import 'katex/dist/katex.min.css';
import './style.css';

GlobalWorkerOptions.workerSrc = '/dist/pdf.worker.mjs';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const ROOT = { x: 0, y: 0, width: 490, height: 550 };
let rootBounds = { ...ROOT };
const NODE = { width: 238, height: 108 };
const example = `# Plate tectonics

Earth’s outer shell is divided into large plates that move slowly over the mantle. Their motion helps explain why earthquakes, volcanoes, and mountain ranges cluster in particular places.

## Three kinds of boundary

At a **divergent boundary**, plates move apart and new crust can form. At a **convergent boundary**, plates move together; one may sink beneath the other, or two continents may collide. At a **transform boundary**, plates slide past one another.

Local rock types and motion rates matter. A useful next step is to understand how scientists measure such slow movement.

## Evidence for movement

Matching rock layers and fossils on distant continents helped establish that continents had moved. Today, satellite positioning measures plate motion directly.

If a plate moves $3\\,\\mathrm{cm}$ each year, it moves roughly $3\\,\\mathrm{m}$ in a century.

$$
d = vt
$$

What evidence would distinguish plate movement from another explanation for a mountain range?
`;
const examplePassages = {
  'What moves the plates?': 'Earth’s outer shell is divided into large plates that move slowly over the mantle.',
  'Evidence for motion': 'Matching rock layers and fossils on distant continents helped establish that continents had moved.',
  'Three boundary types': 'At a divergent boundary, plates move apart and new crust can form.',
  'How fast do plates move?': 'If a plate moves'
};

let state, loadError = null, saveError = null;
try { state = loadState(); } catch (error) { state = emptyState(); loadError = error.message; saveError = error.message; }
let saveMode = 'auto';
try { saveMode = loadSaveMode(); } catch { /* Browser storage can be unavailable. */ }
const THEME_KEY = 'learning-canvas:theme-v1';
const COLOR_KEY = 'learning-canvas:color-v1';
const themes = ['auto', 'light', 'dark'];
const colors = ['violet', 'blue', 'green', 'rose', 'amber'];
let theme = localStorage.getItem(THEME_KEY) || 'auto';
let color = localStorage.getItem(COLOR_KEY) || 'violet';
if (!themes.includes(theme)) theme = 'auto';
if (!colors.includes(color)) color = 'violet';
function applyAppearance() {
  const accentColors = { violet: '#635fdb', blue: '#2563a9', green: '#287a58', rose: '#b04468', amber: '#aa6b20' };
  const lightSoftColors = { violet: '#e9e6ff', blue: '#dcecff', green: '#dff4e8', rose: '#ffe0e9', amber: '#ffedcf' };
  const darkSoftColors = { violet: '#39345c', blue: '#263d5a', green: '#234a38', rose: '#542d3b', amber: '#5a4324' };
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.color = color;
  document.documentElement.dataset.dark = String(dark);
  document.documentElement.style.setProperty('--accent', accentColors[color] || accentColors.violet);
  document.documentElement.style.setProperty('--accent-soft', (dark ? darkSoftColors : lightSoftColors)[color] || (dark ? darkSoftColors : lightSoftColors).violet);
}
function setAppearance(nextTheme = theme, nextColor = color) {
  theme = nextTheme; color = nextColor;
  localStorage.setItem(THEME_KEY, theme); localStorage.setItem(COLOR_KEY, color);
  applyAppearance(); renderWorkspace();
}
applyAppearance();
const colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
const handleSystemAppearanceChange = () => {
  if (theme !== 'auto') return;
  applyAppearance();
  renderWorkspace();
};
if (colorSchemeQuery?.addEventListener) colorSchemeQuery.addEventListener('change', handleSystemAppearanceChange);
else if (colorSchemeQuery) colorSchemeQuery.addListener(handleSystemAppearanceChange);
let lastSaved = JSON.stringify(state), dirty = false;
let currentId = null, selectedId = null, selectedIds = new Set(), editingMarkdown = false, outlineOpen = false;
let activeConnection = null;
let openSourceId = null, sourcePage = 1, sourceJump = null;
const pdfDocuments = new Map();
const pendingPdfDeletes = new Set();
let selectedPassage = null, editGroup = null, view = { x: 0, y: 0, zoom: 1 };
let viewTimer = null, toastTimer = null;
let aiPanel = null;

function el(tag, attrs = {}, ...children) {
  const node = ['svg', 'path', 'text', 'defs', 'marker', 'circle', 'linearGradient', 'stop'].includes(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}
const button = (label, action, className = '', attrs = {}) => el('button', { type: 'button', class: className, text: label, onclick: action, ...attrs });
const work = () => state.workspaces.find((item) => item.id === currentId);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function announce(message) {
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 3200);
}

function saveLabel() { return saveError ? 'Save failed' : dirty ? 'Unsaved' : 'Saved'; }

function updateSaveControls() {
  for (const wrapper of document.querySelectorAll('.save-control')) wrapper.dataset.state = saveError ? 'error' : dirty ? 'dirty' : 'saved';
  for (const control of document.querySelectorAll('.save-main')) {
    control.textContent = saveLabel();
    control.title = saveMode === 'manual' ? 'Save now · ⌘S / Ctrl+S' : 'Auto save is on';
    control.setAttribute('aria-label', `${saveLabel()}. ${saveMode === 'manual' ? 'Manual save. Click to save now.' : 'Auto save. Click for save options.'}`);
    control.disabled = !!loadError;
  }
  for (const control of document.querySelectorAll('.save-mode-button')) control.title = `Save options · ${saveMode === 'auto' ? 'Auto save' : 'Manual save'}`;
}

function persist(force = false) {
  if (loadError) { saveError = 'Saved data could not be read; no data was overwritten.'; updateSaveControls(); return false; }
  const serialized = JSON.stringify(state);
  dirty = serialized !== lastSaved;
  if (saveMode === 'manual' && !force) { updateSaveControls(); return true; }
  try {
    saveState(state);
    lastSaved = serialized; dirty = false; saveError = null;
    for (const id of pendingPdfDeletes) {
      pendingPdfDeletes.delete(id);
      pdfDocuments.delete(id);
      deletePdf(id).catch(() => announce('A removed PDF could not be cleared from local storage.'));
    }
    updateSaveControls();
    return true;
  } catch (error) {
    saveError = error.message; dirty = true;
    updateSaveControls(); announce('Could not save. Check browser storage.');
    return false;
  }
}

function flushView() {
  if (!viewTimer) return false;
  clearTimeout(viewTimer); viewTimer = null;
  const item = work();
  if (item) item.view = { ...view, outlineOpen };
  return !!item;
}

function saveNow() {
  flushView();
  const saved = persist(true);
  if (saved) announce('Saved.');
  return saved;
}

function setSaveMode(mode) {
  if (mode === saveMode) return;
  if (mode === 'manual' && !saveNow()) return;
  try { saveSaveMode(mode); }
  catch { announce('Could not save this preference. Check browser storage.'); return; }
  saveMode = mode;
  if (mode === 'auto') saveNow();
  updateSaveControls();
}

function closeSaveMenu() {
  document.querySelector('.save-menu')?.remove();
  document.querySelectorAll('.save-mode-button').forEach((control) => control.setAttribute('aria-expanded', 'false'));
}

function toggleSaveMenu(wrapper) {
  if (wrapper.querySelector('.save-menu')) return closeSaveMenu();
  closeSaveMenu();
  const menu = el('div', { class: 'save-menu', role: 'menu', 'aria-label': 'Save options' });
  const action = (label, handler, attrs = {}) => menu.append(button(label, () => { closeSaveMenu(); handler(); }, 'save-menu-option', attrs));
  action('Save now     ⌘S', saveNow, { role: 'menuitem' });
  menu.append(el('div', { class: 'save-menu-separator', role: 'separator' }));
  for (const mode of ['auto', 'manual']) action(`${saveMode === mode ? '✓' : '  '} ${mode === 'auto' ? 'Auto save' : 'Manual save'}`, () => setSaveMode(mode), { role: 'menuitemradio', 'aria-checked': saveMode === mode });
  wrapper.append(menu);
  wrapper.querySelector('.save-mode-button')?.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
}

function saveControl() {
  const wrapper = el('div', { class: 'save-control', 'data-state': saveError ? 'error' : dirty ? 'dirty' : 'saved' });
  wrapper.append(button(saveLabel(), () => saveMode === 'manual' ? saveNow() : toggleSaveMenu(wrapper), 'save-main', { 'aria-label': 'Save status' }), button('', () => toggleSaveMenu(wrapper), 'save-mode-button', { 'aria-label': 'Save options', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }));
  return wrapper;
}

function change(update, { group = null, article = false, rerender = true } = {}) {
  const item = work(); if (!item) return;
  const history = state.history[item.id] ||= [];
  if (!group || group !== editGroup) {
    history.push(snapshotWorkspace(item));
    if (history.length > 40) history.shift();
  }
  editGroup = group;
  state.redo[item.id] = [];
  update(item);
  if (article) item.article.revision++;
  item.updatedAt = new Date().toISOString();
  persist();
  if (rerender) renderWorkspace();
  else {
    const undoControl = document.querySelector('[aria-label="Undo"]');
    const redoControl = document.querySelector('[aria-label="Redo"]');
    if (undoControl) undoControl.disabled = !state.history[item.id]?.length;
    if (redoControl) redoControl.disabled = !state.redo[item.id]?.length;
  }
}

function undo() {
  const item = work();
  const previous = item && state.history[item.id]?.pop();
  if (!previous) return announce('Nothing to undo.');
  (state.redo[item.id] ||= []).push(snapshotWorkspace(item));
  state.workspaces[state.workspaces.findIndex((entry) => entry.id === item.id)] = previous;
  if (selectedId && !previous.nodes.some((node) => node.id === selectedId)) selectedId = null;
  selectedIds = new Set([...selectedIds].filter((id) => previous.nodes.some((node) => node.id === id)));
  editingMarkdown = false; selectedPassage = null; editGroup = null;
  persist(); renderWorkspace(); announce('Change undone.');
}

function redo() {
  const item = work();
  const next = item && state.redo[item.id]?.pop();
  if (!next) return announce('Nothing to redo.');
  (state.history[item.id] ||= []).push(snapshotWorkspace(item));
  state.workspaces[state.workspaces.findIndex((entry) => entry.id === item.id)] = next;
  if (selectedId && !next.nodes.some((node) => node.id === selectedId)) selectedId = null;
  selectedIds = new Set([...selectedIds].filter((id) => next.nodes.some((node) => node.id === id)));
  editingMarkdown = false; selectedPassage = null; editGroup = null;
  persist(); renderWorkspace(); announce('Change redone.');
}

function ensurePositions(item) {
  item.layout ||= { positions: {} };
  item.layout.positions ||= {};
  item.layout.sizes ||= {};
  item.layout.articleSize ||= { width: ROOT.width, minHeight: ROOT.height };
  item.nodes.forEach((node, index) => {
    if (!item.layout.positions[node.id]) item.layout.positions[node.id] = suggestedPosition(item, node.parentId ?? null, index);
  });
}

function suggestedPosition(item, parentId, index = item.nodes.length) {
  const siblings = item.nodes.filter((node) => (node.parentId ?? null) === parentId && item.layout.positions[node.id]);
  if (parentId) {
    const parent = item.layout.positions[parentId] || { x: 740, y: 0 };
    const side = parent.x < 0 ? -1 : 1;
    return { x: parent.x + side * 340, y: parent.y + siblings.length * 132 };
  }
  const side = index % 2 === 0 ? 1 : -1;
  const sideCount = item.nodes.slice(0, index).filter((node) => (node.parentId ?? null) === null && (item.layout.positions[node.id]?.x ?? (item.nodes.indexOf(node) % 2 ? -1 : 1)) * side > 0).length;
  return { x: side > 0 ? 760 : -380, y: 22 + sideCount * 154 };
}

function positionAtCanvasPoint(clientX, clientY) {
  const scene = document.querySelector('.scene');
  if (!scene || !view.zoom) return null;
  const rect = scene.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / view.zoom - NODE.width / 2,
    y: (clientY - rect.top) / view.zoom - NODE.height / 2
  };
}

function sourceTitle(name) { return name.replace(/\.pdf$/i, '').trim() || 'Untitled source'; }

function pastedSource(title, text) {
  return { id: crypto.randomUUID(), type: 'text', title: title.trim() || 'Pasted text', text, addedAt: new Date().toISOString() };
}

async function pdfSource(file, id = crypto.randomUUID(), expectedChecksum = null) {
  if (!file || !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
  if (file.size > 50 * 1024 * 1024) throw new Error('This PDF is over the 50 MB import limit.');
  const bytes = await file.arrayBuffer();
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (expectedChecksum && checksum !== expectedChecksum) throw new Error('This is a different PDF. Reattach the original file so saved passages stay accurate.');
  const document = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  await putPdf(id, bytes);
  pdfDocuments.set(id, document);
  return { id, type: 'pdf', title: sourceTitle(file.name), fileName: file.name, byteLength: bytes.byteLength, checksum, pages: document.numPages, addedAt: new Date().toISOString() };
}

function startWorkspace(title, source = null, generate = false) {
  const item = createWorkspace(title, `# ${title.trim() || 'Untitled workspace'}\n\n## Working notes\n\n`);
  if (source) item.sources.push(source);
  state.workspaces.unshift(item); state.history[item.id] = [];
  persist(); openWorkspace(item.id);
  if (source) openSource(source.id);
  if (generate) openAiPanel({ kind: 'generate' });
}

function renderHome() {
  if (flushView()) persist();
  currentId = null; selectedId = null; selectedIds.clear(); selectedPassage = null; openSourceId = null;
  const header = el('header', { class: 'home-header' }, el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: 'LF' }), el('span', { class: 'brand-name', text: 'CORE' }), el('span', { class: 'brand-company', text: 'LinecoFlow' })), button('Model settings', renderSettings, 'source-toggle'));
  const form = el('form', { class: 'create-form entry-form' });
  let entryMode = 'topic';
  const tabs = el('div', { class: 'entry-tabs', role: 'tablist', 'aria-label': 'Start from' });
  const input = el('input', { type: 'text', placeholder: 'What are you learning?', 'aria-label': 'Workspace title' });
  const pasted = el('textarea', { class: 'entry-paste', placeholder: 'Paste the original text here. It stays separate from your article.', 'aria-label': 'Pasted source text' });
  const pdf = el('input', { type: 'file', accept: '.pdf,application/pdf', class: 'entry-file', 'aria-label': 'Choose a local PDF' });
  const create = el('button', { type: 'submit', text: 'Create canvas  ↗' });
  const setMode = (mode) => {
    entryMode = mode;
    input.placeholder = mode === 'topic' ? 'What are you learning?' : mode === 'paste' ? 'Workspace title (optional)' : 'Workspace title (defaults to PDF name)';
    pasted.hidden = mode !== 'paste'; pdf.hidden = mode !== 'pdf';
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  };
  for (const [mode, label] of [['topic', 'Topic'], ['paste', 'Pasted text'], ['pdf', 'Local PDF']]) tabs.append(button(label, () => setMode(mode), 'entry-tab', { role: 'tab', 'data-mode': mode, 'aria-selected': 'false' }));
  if (loadError) { input.disabled = true; pasted.disabled = true; pdf.disabled = true; create.disabled = true; }
  form.append(tabs, input, pasted, pdf, create);
  setMode('topic');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    create.disabled = true;
    try {
      if (entryMode === 'topic') {
        if (!input.value.trim()) return announce('Enter a topic first.');
        startWorkspace(input.value, null, true);
      } else if (entryMode === 'paste') {
        if (!pasted.value.trim()) return announce('Paste some source text first.');
        if (pasted.value.length > 500_000) return announce('Pasted text is over the 500,000 character limit. Use a PDF for longer material.');
        const title = input.value.trim() || pasted.value.trim().split('\n')[0].slice(0, 80) || 'Pasted source';
        startWorkspace(title, pastedSource(title, pasted.value));
      } else {
        if (!pdf.files?.[0]) return announce('Choose a PDF first.');
        const source = await pdfSource(pdf.files[0]);
        startWorkspace(input.value.trim() || source.title, source);
      }
    } catch (error) { announce(`Could not create workspace: ${error.message}`); }
    finally { create.disabled = false; }
  });
  const cards = el('div', { class: 'workspace-list' });
  if (!state.workspaces.length) cards.append(el('p', { class: 'empty-home', text: 'Your canvas is ready. Start a topic or open the example below.' }));
  for (const item of [...state.workspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const tile = el('div', { class: 'workspace-tile' });
    tile.append(button('', () => openWorkspace(item.id), 'workspace-open', { 'aria-label': `Open ${item.title}` }), button('×', () => deleteWorkspace(item.id), 'workspace-delete', { 'aria-label': `Delete ${item.title}`, title: `Delete ${item.title}` }));
    tile.firstElementChild.append(el('span', { class: 'tile-glyph', text: '◈' }), el('span', {}, el('strong', { text: item.title }), el('small', { text: `${item.nodes.length} connected node${item.nodes.length === 1 ? '' : 's'}` })), el('span', { class: 'tile-arrow', text: '↗' }));
    cards.append(tile);
  }
  const exampleButton = button('Explore the Plate tectonics example', () => {
    const item = createWorkspace('Plate tectonics', example);
    state.workspaces.unshift(item); state.history[item.id] = [];
    const topics = [
      { title: 'What moves the plates?', body: 'Investigate the forces behind slow plate motion.' },
      { title: 'Evidence for motion', body: 'Fossils, rock layers, and satellite measurements.' },
      { title: 'Three boundary types', body: 'Divergent, convergent, and transform.' },
      { title: 'How fast do plates move?', body: 'A next study question.' }
    ];
    for (const topic of topics) item.nodes.push({ id: crypto.randomUUID(), title: topic.title, document: { type: 'markdown', markdown: topic.body }, parentId: null, anchor: null, collapsed: false, provenance: 'learner' });
    attachExampleAnchors(item);
    ensurePositions(item); persist(); openWorkspace(item.id);
  }, 'example-link');
  if (loadError) exampleButton.disabled = true;
  const main = el('main', { class: 'home-main' }, el('div', { class: 'home-eyebrow', text: 'YOUR WORKSPACE' }), el('h1', { text: 'Follow the shape of a thought.' }), el('p', { class: 'home-lead', text: 'Write at the center. Explore connected nodes, then return to what matters.' }), form, exampleButton, el('div', { class: 'list-heading' }, el('h2', { text: 'Your canvases' })), cards);
  if (loadError) main.prepend(el('p', { class: 'error-banner', text: `${loadError} Existing data was left untouched.` }));
  app.replaceChildren(el('div', { class: 'home' }, header, main));
  updateSaveControls();
}

function deleteWorkspace(id) {
  const item = state.workspaces.find((entry) => entry.id === id);
  if (!item || !window.confirm(`Delete “${item.title}” and all its connected nodes? This cannot be undone.`)) return;
  for (const source of item.sources || []) if (source.type === 'pdf') pendingPdfDeletes.add(source.id);
  state.workspaces = state.workspaces.filter((entry) => entry.id !== id);
  delete state.history[id]; delete state.redo[id];
  persist(); renderHome();
}

function openWorkspace(id) {
  currentId = id; aiPanel = null; selectedId = null; selectedIds.clear(); editingMarkdown = false; selectedPassage = null; editGroup = null; openSourceId = null;
  const item = work(); if (!item) return renderHome();
  const needsFit = !item.layout?.articleSize;
  if (attachExampleAnchors(item)) {
    for (const snapshot of state.history[item.id] || []) attachExampleAnchors(snapshot);
    for (const snapshot of state.redo[item.id] || []) attachExampleAnchors(snapshot);
    persist();
  }
  ensurePositions(item);
  const saved = item.view || {};
  view = { x: saved.x, y: saved.y, zoom: saved.zoom || 1 };
  outlineOpen = !!saved.outlineOpen;
  renderWorkspace();
  if (needsFit || view.x == null || view.y == null) fitCanvas();
}

function attachExampleAnchors(item) {
  if (item.title !== 'Plate tectonics' || item.article?.markdown !== example) return false;
  const text = markdownPlainText(item.article.markdown);
  let changed = false;
  for (const node of item.nodes) {
    if (node.anchor || node.parentId || !Object.hasOwn(examplePassages, node.title)) continue;
    const quote = examplePassages[node.title], start = text.indexOf(quote);
    if (start < 0) continue;
    node.anchor = makeAnchor('article', text, start, start + quote.length);
    changed = true;
  }
  return changed;
}

function saveView() {
  clearTimeout(viewTimer);
  if (saveMode === 'manual') {
    viewTimer = null;
    const item = work(); if (!item) return;
    item.view = { ...view, outlineOpen };
    persist();
    return;
  }
  viewTimer = setTimeout(() => {
    viewTimer = null;
    const item = work(); if (!item) return;
    item.view = { ...view, outlineOpen };
    persist();
  }, 250);
}

function applyView() {
  const scene = document.querySelector('.scene');
  const viewport = document.querySelector('.canvas-viewport');
  if (!scene || !viewport) return;
  scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  viewport.style.backgroundSize = `${24 * view.zoom}px ${24 * view.zoom}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  document.querySelector('.zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
}

function fitCanvas() {
  const viewport = document.querySelector('.canvas-viewport'); if (!viewport) return;
  const item = work();
  const bounds = item.nodes.map((node) => pointFor(item, node.id));
  const minX = Math.min(-430, ...bounds.map((point) => point.x));
  const maxX = Math.max(rootBounds.width + 80, ...bounds.map((point) => point.x + point.width));
  const minY = Math.min(-80, ...bounds.map((point) => point.y));
  const maxY = Math.max(rootBounds.height + 80, ...bounds.map((point) => point.y + point.height));
  const width = maxX - minX + 160, height = maxY - minY + 160;
  view.zoom = clamp(Math.min(viewport.clientWidth / width, viewport.clientHeight / height, 1), .45, 1);
  view.x = viewport.clientWidth / 2 - ((minX + maxX) / 2) * view.zoom;
  view.y = viewport.clientHeight / 2 - ((minY + maxY) / 2) * view.zoom;
  applyView(); saveView();
}

function zoomTo(next, clientX, clientY) {
  const viewport = document.querySelector('.canvas-viewport'); if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  const worldX = (px - view.x) / view.zoom, worldY = (py - view.y) / view.zoom;
  view.zoom = clamp(next, .35, 1.8);
  view.x = px - worldX * view.zoom; view.y = py - worldY * view.zoom;
  applyView(); saveView();
}

function ensureUnifiedNodeEdges(item) {
  let changed = false;
  for (const node of item.nodes) {
    const targetId = node.anchor?.targetId || node.parentId;
    if (!targetId || !item.nodes.some((candidate) => candidate.id === targetId)) continue;
    const existing = item.edges.find((edge) => edge.fromId === targetId && edge.toId === node.id);
    const exists = item.edges.some((edge) => edge.structural && edge.toId === node.id);
    if (existing) {
      if (!existing.structural) { existing.structural = true; changed = true; }
    } else if (!exists) {
      item.edges.push({ id: crypto.randomUUID(), fromId: targetId, toId: node.id, label: null, direction: 'forward', structural: true });
      changed = true;
    }
  }
  if (changed) persist();
}

function renderWorkspace() {
  const item = work(); if (!item) return renderHome();
  ensureUnifiedNodeEdges(item);
  if (selectedId) selectedIds.clear();
  else selectedIds = new Set([...selectedIds].filter((id) => item.nodes.some((node) => node.id === id && isVisible(item, node))));
  ensurePositions(item);
  const chrome = el('div', { class: 'workspace-chrome' },
    el('div', { class: 'header-left' },
      el('span', { class: 'workspace-brand', 'aria-label': 'LF CORE by LinecoFlow' }, el('strong', { text: 'LF' }), el('span', { text: 'CORE' })),
      iconButton('M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', 'Home', renderHome),
      iconButton('M4 5h16M4 10h11M4 15h16M4 20h11', outlineOpen ? 'Hide outline' : 'Open outline', () => { outlineOpen = !outlineOpen; saveView(); renderWorkspace(); }, outlineOpen),
      el('span', { class: 'workspace-title', text: item.title }),
      button(`Sources${item.sources?.length ? ` ${item.sources.length}` : ''}`, () => openSource(openSourceId ? null : item.sources?.[0]?.id || 'library'), 'source-toggle', { 'aria-label': 'Open sources' })),
    el('div', { class: 'header-right' },
      button('Ask AI', () => openAiPanel({ kind: 'ask', targetId: selectedId || 'article' }), 'source-toggle'),
      button(`AI history${item.proposals?.length ? ` ${item.proposals.length}` : ''}`, () => openAiPanel({ kind: 'history' }), 'source-toggle'),
      button('Model settings', renderSettings, 'source-toggle'),
      saveControl(),
      appearanceControl(),
      historyButton('undo', undo, !!state.history[item.id]?.length),
      historyButton('redo', redo, !!state.redo[item.id]?.length)));
  app.replaceChildren(el('div', { class: 'workspace-shell' }, renderCanvas(item), chrome));
  updateSaveControls();
  applyView();
  for (const preview of document.querySelectorAll('.markdown-preview')) {
    const targetId = preview.dataset.documentId;
    markAnchors(preview, item.nodes.filter((node) => node.anchor?.targetId === targetId));
  }
  document.querySelectorAll('.topic-card').forEach(updateCardOverflow);
  document.querySelectorAll('.markdown-editor').forEach(resizeEditor);
  measurePaper();
  if (selectedPassage) renderPassageToolbar();
  if (aiPanel) renderAiPanel();
}

function appearanceControl() {
  const wrapper = el('div', { class: 'appearance-control' });
  const control = button('◐', () => wrapper.classList.toggle('open'), 'header-icon', { 'aria-label': 'Appearance', title: 'Appearance' });
  const menu = el('div', { class: 'appearance-menu', role: 'menu', 'aria-label': 'Appearance settings' });
  menu.append(el('strong', { text: 'Appearance' }));
  const modeIcons = { auto: '◐', light: '☀', dark: '☾' };
  const colorIcons = { violet: '●', blue: '●', green: '●', rose: '●', amber: '●' };
  const choice = (value, current, icon, action) => {
    const option = button('', action, 'appearance-option', { role: 'menuitemradio', 'aria-checked': current === value });
    option.append(el('span', { class: 'appearance-option-icon', text: icon }), el('span', { text: value[0].toUpperCase() + value.slice(1) }), el('span', { class: 'appearance-option-check', text: current === value ? '✓' : '' }));
    if (colorIcons[value]) option.dataset.color = value;
    return option;
  };
  menu.append(el('label', { text: 'MODE' }), ...themes.map((value) => choice(value, theme, modeIcons[value], () => { setAppearance(value, color); wrapper.classList.remove('open'); })));
  menu.append(el('label', { text: 'ACCENT COLOR' }), ...colors.map((value) => choice(value, color, colorIcons[value], () => { setAppearance(theme, value); wrapper.classList.remove('open'); })));
  wrapper.append(control, menu); return wrapper;
}

function iconButton(path, label, action, active = false) {
  const svg = el('svg', { viewBox: '0 0 24 24', width: '19', height: '19', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(el('path', { d: path }));
  const control = button('', action, `header-icon ${active ? 'active' : ''}`, { 'aria-label': label, title: label });
  control.append(svg);
  return control;
}

function historyButton(kind, action, enabled) {
  const svg = el('svg', { viewBox: '0 0 24 24', width: '19', height: '19', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(el('path', { d: kind === 'undo' ? 'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14' : 'm15 14 5-5-5-5m5 5h-9a7 7 0 0 0 0 14' }));
  const control = button('', action, 'header-icon', { 'aria-label': kind === 'undo' ? 'Undo' : 'Redo', title: kind === 'undo' ? 'Undo · ⌘Z / Ctrl+Z' : 'Redo · ⇧⌘Z / Ctrl+Shift+Z' });
  control.disabled = !enabled;
  control.append(svg);
  return control;
}

function renderCanvas(item) {
  const viewport = el('main', { class: 'canvas-viewport', 'aria-label': 'Knowledge canvas' });
  const scene = el('div', { class: 'scene' });
  scene.append(renderPaper(item));
  scene.append(renderConnectors(item));
  for (const node of item.nodes) if (isVisible(item, node)) scene.append(renderNode(node, item));
  // Anchored branch lines must sit above the source card: their origin is a
  // highlighted passage inside that card, not its boundary.
  scene.append(renderAnchorConnectors(item));
  for (const edge of item.edges) {
    const from = item.nodes.find((node) => node.id === edge.fromId);
    const to = item.nodes.find((node) => node.id === edge.toId);
    if (from && to && isVisible(item, from) && isVisible(item, to)) scene.append(renderEdgeLabel(item, edge));
  }
  renderConnectionHandles(scene, item);
  viewport.append(scene);
  attachPanAndZoom(viewport);
  const presets = el('div', { class: 'zoom-presets', role: 'menu', 'aria-label': 'Zoom presets' });
  const zoomMenu = el('div', { class: 'zoom-menu' }, button('100%', () => { const open = zoomMenu.classList.toggle('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', String(open)); if (open) presets.querySelector('button')?.focus(); }, 'zoom-value', { 'aria-label': 'Zoom level; choose a preset', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }), presets);
  for (const level of [50, 75, 100, 125, 150, 175]) presets.append(button(`${level}%`, () => { zoomTo(level / 100); zoomMenu.classList.remove('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', 'false'); }, 'zoom-preset', { role: 'menuitem' }));
  presets.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); zoomMenu.classList.remove('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', 'false'); zoomMenu.querySelector('.zoom-value').focus(); } });
  const zoom = el('div', { class: 'zoom-controls' }, button('−', () => zoomTo(view.zoom - .15), '', { 'aria-label': 'Zoom out' }), zoomMenu, button('+', () => zoomTo(view.zoom + .15), '', { 'aria-label': 'Zoom in' }), el('span', { class: 'zoom-divider' }), button('Fit', fitCanvas, 'fit-button', { 'aria-label': 'Fit canvas' }));
  const shell = el('div', { class: 'canvas-shell' }, viewport, zoom);
  if (outlineOpen) shell.append(renderOutline(item));
  if (selectedId) {
    const node = item.nodes.find((entry) => entry.id === selectedId);
    if (node) shell.append(renderDetails(node, item));
  } else if (selectedIds.size > 1) {
    shell.append(el('div', { class: 'selection-toolbar', role: 'status' }, el('span', { text: `${selectedIds.size} selected` }), button('Delete', () => removeNodes([...selectedIds]), 'selection-delete'), button('Clear', () => { selectedIds.clear(); renderWorkspace(); }, 'selection-clear')));
  }
  if (openSourceId) shell.append(renderSourcesPanel(item));
  return shell;
}

function attachPanAndZoom(viewport) {
  let suppressCanvasClick = false;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !event.target.closest('.paper, .topic-card, .edge-label-chip, .connector-hit, .connection-handle')) {
      event.preventDefault();
      closeContextMenu();
      const start = { x: event.clientX, y: event.clientY, moved: false };
      const frame = viewport.getBoundingClientRect();
      const rectangle = el('div', { class: 'selection-rectangle', 'aria-hidden': 'true' });
      viewport.setPointerCapture(event.pointerId);
      const bounds = (x, y) => ({ left: Math.min(start.x, x), top: Math.min(start.y, y), right: Math.max(start.x, x), bottom: Math.max(start.y, y) });
      const matches = (box) => [...viewport.querySelectorAll('.topic-card')].filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
      });
      const move = (next) => {
        if (!start.moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
        if (!start.moved) { start.moved = true; viewport.append(rectangle); viewport.classList.add('selecting'); }
        const box = bounds(next.clientX, next.clientY);
        Object.assign(rectangle.style, { left: `${box.left - frame.left}px`, top: `${box.top - frame.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
        const included = new Set(matches(box));
        viewport.querySelectorAll('.topic-card').forEach((card) => card.classList.toggle('marquee-target', included.has(card)));
      };
      const finish = (next) => {
        viewport.removeEventListener('pointermove', move);
        viewport.removeEventListener('pointerup', finish);
        viewport.removeEventListener('pointercancel', cancel);
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        viewport.classList.remove('selecting');
        if (start.moved && next.type === 'pointerup') {
          const ids = matches(bounds(next.clientX, next.clientY)).map((card) => card.dataset.node);
          selectedId = ids.length === 1 ? ids[0] : null;
          selectedIds = new Set(ids.length > 1 ? ids : []);
          selectedPassage = null;
          suppressCanvasClick = true;
          setTimeout(() => { suppressCanvasClick = false; }, 0);
          renderWorkspace();
        } else if (next.type === 'pointerup') {
          selectedId = null; selectedIds.clear(); selectedPassage = null; activeConnection = null;
          renderWorkspace();
        } else {
          rectangle.remove();
          viewport.querySelectorAll('.marquee-target').forEach((card) => card.classList.remove('marquee-target'));
        }
      };
      const cancel = () => finish({ type: 'pointercancel' });
      viewport.addEventListener('pointermove', move);
      viewport.addEventListener('pointerup', finish);
      viewport.addEventListener('pointercancel', cancel);
      return;
    }
    if (event.button !== 2 || event.target.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    closeContextMenu();
    const start = { x: event.clientX, y: event.clientY, panX: view.x, panY: view.y, target: event.target, moved: false };
    viewport.setPointerCapture(event.pointerId);
    const move = (next) => {
      if (!start.moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
      start.moved = true;
      viewport.classList.add('panning');
      view.x = start.panX + next.clientX - start.x;
      view.y = start.panY + next.clientY - start.y;
      applyView();
    };
    const finish = (next) => {
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', finish);
      viewport.removeEventListener('pointercancel', cancel);
      viewport.classList.remove('panning');
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (start.moved) saveView();
      else if (next.type === 'pointerup') openContextMenu(start.target, next.clientX, next.clientY);
    };
    const cancel = () => finish({ type: 'pointercancel' });
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', cancel);
  });
  viewport.addEventListener('click', (event) => {
    if (suppressCanvasClick) return;
    if (event.button !== 0 || event.target.closest('.paper, .topic-card, .edge-label-chip, .connector-hit')) return;
    if (!window.getSelection()?.isCollapsed) return;
    closeContextMenu();
    if (selectedId || selectedIds.size || selectedPassage) { selectedId = null; selectedIds.clear(); selectedPassage = null; renderWorkspace(); }
  });
  viewport.addEventListener('contextmenu', (event) => {
    if (event.target.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
  });
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoomTo(view.zoom * (event.deltaY < 0 ? 1.08 : .92), event.clientX, event.clientY);
    else { view.x -= event.deltaX; view.y -= event.deltaY; applyView(); saveView(); }
  }, { passive: false });
}

function closeContextMenu() { document.querySelector('.context-menu')?.remove(); }

function openContextMenu(target, x, y) {
  closeContextMenu();
  const item = work(); if (!item) return;
  const card = target.closest('.topic-card');
  const node = card && item.nodes.find((entry) => entry.id === card.dataset.node);
  const onPaper = !!target.closest('.paper');
  const group = selectedIds.size > 1 && !onPaper && (!node || selectedIds.has(node.id));
  const passage = selectedPassage;
  const floatingPosition = positionAtCanvasPoint(x, y);
  if (!group && !node && (selectedId || selectedIds.size)) { selectedId = null; selectedIds.clear(); renderWorkspace(); }
  const menu = el('div', { class: 'context-menu', role: 'menu', 'aria-label': group ? 'Selection options' : node ? `${node.title} options` : onPaper ? 'Document options' : 'Canvas options' });
  const option = (label, action, destructive = false) => menu.append(button(label, () => { closeContextMenu(); action(); }, `context-option ${destructive ? 'destructive' : ''}`, { role: 'menuitem' }));
  if (group) {
    option(`Clear ${selectedIds.size} selected`, () => { selectedIds.clear(); renderWorkspace(); });
    menu.append(el('div', { class: 'context-separator', role: 'separator' }));
    option('Delete selected nodes', () => removeNodes([...selectedIds]), true);
  } else if (node) {
    option('Open details', () => selectNode(node.id));
    option('Ask about node', () => openAiPanel({ kind: 'ask', targetId: node.id }));
    option('Edit content on canvas', () => beginNodeMarkdownEdit(node.id));
    if (passage?.targetId === node.id) option('Create node from highlight', () => { selectedPassage = passage; createAnchoredNode(); });
    option('Add child', () => addNode(node.id));
    option('Add sibling', () => addNode(node.parentId));
    option('Rename', () => beginRename(node.id));
    menu.append(el('div', { class: 'context-separator', role: 'separator' }));
    option('Delete node', () => removeNode(node.id), true);
  } else if (onPaper) {
    option('Ask about article', () => openAiPanel({ kind: 'ask', targetId: 'article' }));
    option('Generate article draft', () => openAiPanel({ kind: 'generate' }));
    if (passage?.targetId === 'article') option('Create node from highlight', () => { selectedPassage = passage; createAnchoredNode(); });
    option(editingMarkdown ? 'Done editing' : 'Edit document', () => { editingMarkdown = !editingMarkdown; selectedPassage = null; renderWorkspace(); if (editingMarkdown) document.querySelector('.markdown-editor')?.focus(); });
    option('Add node', () => addNode(null, null, floatingPosition));
    option('Fit canvas', fitCanvas);
  } else {
    option('Add node', () => addNode(null, null, floatingPosition));
    option('Fit canvas', fitCanvas);
    option('Zoom in', () => zoomTo(view.zoom + .15, x, y));
    option('Zoom out', () => zoomTo(view.zoom - .15, x, y));
  }
  document.querySelector('.workspace-shell')?.append(menu);
  menu.style.left = `${clamp(x, 8, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${clamp(y, 8, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...menu.querySelectorAll('[role="menuitem"]')];
    const index = options.indexOf(document.activeElement);
    options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  });
  menu.querySelector('button')?.focus();
}

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.context-menu')) closeContextMenu();
  if (!event.target.closest('.save-control')) closeSaveMenu();
  if (!event.target.closest('.zoom-menu')) {
    document.querySelector('.zoom-menu.open')?.classList.remove('open');
    document.querySelector('.zoom-value')?.setAttribute('aria-expanded', 'false');
  }
}, true);

function isVisible(item, node) {
  let parentId = node.parentId;
  while (parentId) {
    const parent = item.nodes.find((entry) => entry.id === parentId);
    if (!parent || parent.collapsed) return false;
    parentId = parent.parentId;
  }
  return true;
}

function pointFor(item, id) {
  if (!id) return rootBounds;
  const point = item.layout.positions[id];
  return point ? { ...point, ...NODE, ...item.layout.sizes?.[id] } : rootBounds;
}

function sourceFor(item, node) {
  if (!node.anchor && node.parentId) return { point: pointFor(item, node.parentId), fromY: null, anchored: false };
  const marks = [...document.querySelectorAll(`.anchor-mark[data-anchor-node="${node.id}"]`)];
  const scene = document.querySelector('.scene');
  if (marks.length && scene && view.zoom) {
    const to = pointFor(item, node.id);
    const origin = node.anchor?.targetId === 'article' ? rootBounds : pointFor(item, node.anchor?.targetId);
    const right = to.x + to.width / 2 >= origin.x + origin.width / 2;
    const rects = marks.flatMap((mark) => {
      const scroll = mark.closest('.node-content');
      const visible = scroll?.getBoundingClientRect();
      return [...mark.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0 && (!visible || (rect.bottom > visible.top && rect.top < visible.bottom)));
    });
    const line = rects.sort((a, b) => right ? b.right - a.right : a.left - b.left)[0];
    if (line) {
      const sceneRect = scene.getBoundingClientRect();
      const x = ((right ? line.right : line.left) - sceneRect.left) / view.zoom;
      const y = (line.top + line.height / 2 - sceneRect.top) / view.zoom;
      return { point: { x, y, width: 0, height: 0 }, fromY: null, anchored: true };
    }
  }
  return null;
}

function measurePaper() {
  const paper = document.querySelector('.paper');
  if (!paper) return;
  rootBounds = { x: ROOT.x, y: ROOT.y, width: paper.offsetWidth, height: paper.offsetHeight };
  updateConnectors();
}

function connectorRoute(from, to, fromY = null, side = 'auto') {
  const targetSide = side === 'auto' ? (to.x >= from.x + from.width / 2 ? 'left' : 'right') : side;
  const entry = {
    left: [to.x, to.y + to.height / 2, -1, 0],
    right: [to.x + to.width, to.y + to.height / 2, 1, 0],
    top: [to.x + to.width / 2, to.y, 0, -1],
    bottom: [to.x + to.width / 2, to.y + to.height, 0, 1],
  }[targetSide];
  const [x2, y2, dx, dy] = entry;
  const anchored = from.width === 0 && from.height === 0;
  const x1 = anchored ? from.x : dx ? (dx < 0 ? from.x + from.width : from.x) : from.x + from.width / 2;
  const y1 = fromY ?? (anchored ? from.y : dy ? (dy < 0 ? from.y + from.height : from.y) : from.y + from.height / 2);
  const bend = Math.max(48, (dx ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) * .48);
  const c1x = x1 + (dx ? -dx * bend : 0), c1y = y1 + (dy ? -dy * bend : 0);
  const c2x = x2 + dx * bend, c2y = y2 + dy * bend;
  return { d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`, x1, y1, x2, y2 };
}

function curve(from, to, fromY = null, side = 'auto') {
  return connectorRoute(from, to, fromY, side).d;
}

function updateRoute(path, from, to, fromY = null, side = 'auto') {
  const route = connectorRoute(from, to, fromY, side);
  path.setAttribute('d', route.d);
  if (path._hit) path._hit.setAttribute('d', route.d);
  const gradient = path._gradient || (path.dataset.gradient && document.getElementById(path.dataset.gradient));
  if (gradient) {
    const start = path._gradientReverse ? { x: route.x2, y: route.y2 } : { x: route.x1, y: route.y1 };
    const end = path._gradientReverse ? { x: route.x1, y: route.y1 } : { x: route.x2, y: route.y2 };
    gradient.setAttribute('x1', start.x); gradient.setAttribute('y1', start.y);
    gradient.setAttribute('x2', end.x); gradient.setAttribute('y2', end.y);
  }
}

function updateCrossRoute(path, from, to, fromSide = 'auto', toSide = 'auto') {
  const route = crossConnectionRoute(from, to, fromSide, toSide);
  path.setAttribute('d', route.d);
  path._hit?.setAttribute('d', route.d);
  if (path._gradient) {
    const start = path._gradientReverse ? { x: route.x2, y: route.y2 } : { x: route.x1, y: route.y1 };
    const end = path._gradientReverse ? { x: route.x1, y: route.y1 } : { x: route.x2, y: route.y2 };
    path._gradient.setAttribute('x1', start.x); path._gradient.setAttribute('y1', start.y);
    path._gradient.setAttribute('x2', end.x); path._gradient.setAttribute('y2', end.y);
  }
}


function makeConnector(svg, id, from, to, fromY, side, className, attrs, onClick, solid = false, reverseGradient = false) {
  const path = el('path', { ...attrs, class: className });
  if (!solid) {
    const gradientId = `line-${id}`;
    const gradient = el('linearGradient', { id: gradientId, gradientUnits: 'userSpaceOnUse' }, el('stop', { offset: '0%', class: 'line-start' }), el('stop', { offset: '100%', class: 'line-end' }));
    svg.querySelector('defs').append(gradient);
    path.dataset.gradient = gradientId;
    path.style.stroke = `url(#${gradientId})`;
    path._gradient = gradient;
    path._gradientReverse = reverseGradient;
  }
  updateRoute(path, from, to, fromY, side);
  const hit = el('path', { d: path.getAttribute('d'), class: 'connector-hit', 'aria-label': 'Edit connection endpoints', tabindex: '0', role: 'button' });
  const activate = (event) => { event.stopPropagation(); onClick(event); };
  hit.addEventListener('click', activate);
  hit.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); } });
  svg.append(path, hit);
  path._hit = hit;
  return path;
}

function selectConnection(kind, id) {
  closeContextMenu();
  activeConnection = { kind, id };
  renderWorkspace();
  document.querySelector('.connection-handle')?.focus({ preventScroll: true });
}

function connectionEnd(item, kind, id, end) {
  if (kind === 'node') {
    const node = item.nodes.find((entry) => entry.id === id);
    return node ? { rect: pointFor(item, node.id), side: node.connectionSide || 'auto' } : null;
  }
  const edge = item.edges.find((entry) => entry.id === id);
  if (!edge) return null;
  return { rect: pointFor(item, end === 'from' ? edge.fromId : edge.toId), side: edge[end === 'from' ? 'fromSide' : 'toSide'] || 'auto' };
}

function nodeAtPointer(clientX, clientY) {
  // The connector SVG and its hit paths sit above the canvas. Use all
  // elements under the pointer rather than only the topmost one, otherwise
  // dragging across a line can fail to discover the card underneath it.
  return document.elementsFromPoint(clientX, clientY)
    .map((entry) => entry.closest?.('.topic-card'))
    .find((card) => card);
}

function previewConnection(item, kind, id, end, side, replacementId = null) {
  if (kind === 'node') {
    const node = item.nodes.find((entry) => entry.id === id);
    const source = node && sourceFor(item, node);
    const path = document.querySelector(`[data-to="${id}"]`);
    if (source && path) updateRoute(path, source.point, pointFor(item, id), source.fromY, side);
  } else {
    const edge = item.edges.find((entry) => entry.id === id);
    const path = document.querySelector(`[data-edge="${id}"]`);
    if (!edge || !path) return;
    // Keep the proposed endpoint in the rendered route. The data is only
    // changed on pointerup, so using the edge's stored endpoint here makes
    // dragging to another card appear not to preview the destination.
    const fromId = end === 'from' && replacementId ? replacementId : edge.fromId;
    const toId = end === 'to' && replacementId ? replacementId : edge.toId;
    const fromSide = end === 'from' ? side : edge.fromSide || 'auto';
    const toSide = end === 'to' ? side : edge.toSide || 'auto';
    updateCrossRoute(path, pointFor(item, fromId), pointFor(item, toId), fromSide, toSide);
    const label = document.querySelector(`[data-edge-label="${id}"]`);
    if (label) {
      const previewEdge = { ...edge, fromId, toId };
      placeEdgeLabel(label, item, previewEdge, fromSide, toSide);
    }
  }
}

function renderConnectionHandles(scene, item) {
  if (!activeConnection) return;
  const { kind, id } = activeConnection;
  const ends = kind === 'edge' ? ['from', 'to'] : ['to'];
  for (const end of ends) {
    const target = connectionEnd(item, kind, id, end);
    if (!target) continue;
    let side = target.side;
    if (side === 'auto' && kind === 'node') {
      const node = item.nodes.find((entry) => entry.id === id);
      const source = sourceFor(item, node)?.point || rootBounds;
      side = target.rect.x >= source.x + source.width / 2 ? 'left' : 'right';
    } else if (side === 'auto') {
      const edge = item.edges.find((entry) => entry.id === id);
      const route = crossConnectionRoute(pointFor(item, edge.fromId), pointFor(item, edge.toId), edge.fromSide, edge.toSide);
      side = route[end === 'from' ? 'fromSide' : 'toSide'];
    }
    const handle = button('', () => {}, 'connection-handle', { 'aria-label': `Drag ${end === 'from' ? 'first' : 'second'} endpoint to another node or side; arrow keys adjust, Home resets`, title: 'Drag to another node or side of this node' });
    handle.dataset.end = end;
    const position = connectionPort(target.rect, side, 8);
    handle.style.left = `${position.x}px`; handle.style.top = `${position.y}px`;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      let nextSide = side;
      let moved = false;
      let replacementId = null;
      const move = (next) => {
        if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
        moved = true;
        const sceneRect = scene.getBoundingClientRect();
        const x = (next.clientX - sceneRect.left) / view.zoom;
        const y = (next.clientY - sceneRect.top) / view.zoom;
        const hovered = next.clientX === undefined ? null : nodeAtPointer(next.clientX, next.clientY);
        const edge = kind === 'edge' ? item.edges.find((entry) => entry.id === id) : null;
        const candidateId = hovered?.dataset.node;
        const otherId = edge && end === 'from' ? edge.toId : edge?.fromId;
        replacementId = candidateId && candidateId !== otherId && candidateId !== id ? candidateId : null;
        document.querySelectorAll('.topic-card.edge-target').forEach((card) => card.classList.remove('edge-target'));
        if (replacementId) document.querySelector(`[data-node="${replacementId}"]`)?.classList.add('edge-target');
        const nextRect = replacementId ? pointFor(item, replacementId) : target.rect;
        nextSide = nearestConnectionSide(nextRect, x, y);
        const port = connectionPort(nextRect, nextSide, 8);
        handle.style.left = `${port.x}px`; handle.style.top = `${port.y}px`;
        previewConnection(item, kind, id, end, nextSide, replacementId);
      };
      const finish = (next) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.classList.remove('dragging');
        document.querySelectorAll('.topic-card.edge-target').forEach((card) => card.classList.remove('edge-target'));
        if (next.type === 'pointercancel') { renderWorkspace(); return; }
        if (!moved || (!replacementId && nextSide === side)) { renderWorkspace(); return; }
        change((entry) => {
          if (kind === 'node') entry.nodes.find((node) => node.id === id).connectionSide = nextSide;
          else {
            const edge = entry.edges.find((entry) => entry.id === id);
            if (replacementId) edge[end === 'from' ? 'fromId' : 'toId'] = replacementId;
            edge[end === 'from' ? 'fromSide' : 'toSide'] = nextSide;
            if (edge.structural && end === 'from') entry.nodes.find((node) => node.id === edge.toId).parentId = replacementId;
          }
        });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
    handle.addEventListener('keydown', (event) => {
      const nextSide = { ArrowLeft: 'left', ArrowUp: 'top', ArrowRight: 'right', ArrowDown: 'bottom', Home: 'auto' }[event.key];
      if (!nextSide) return;
      event.preventDefault(); event.stopPropagation();
      change((entry) => {
        if (kind === 'node') entry.nodes.find((node) => node.id === id).connectionSide = nextSide;
        else entry.edges.find((edge) => edge.id === id)[end === 'from' ? 'fromSide' : 'toSide'] = nextSide;
      });
      document.querySelector(`.connection-handle[data-end="${end}"]`)?.focus({ preventScroll: true });
    });
    scene.append(handle);
  }
}

function edgeMidpoint(from, to, fromSide = 'auto', toSide = 'auto') {
  const route = crossConnectionRoute(from, to, fromSide, toSide);
  return { x: (route.x1 + route.x2) / 2, y: (route.y1 + route.y2) / 2 };
}

function placeEdgeLabel(label, item, edge, fromSide = edge.fromSide, toSide = edge.toSide) {
  const middle = edgeMidpoint(pointFor(item, edge.fromId), pointFor(item, edge.toId), fromSide, toSide);
  label.style.left = `${middle.x}px`;
  label.style.top = `${middle.y}px`;
}

function edgeDirection(edge) { return ['forward', 'reverse', 'both'].includes(edge.direction) ? edge.direction : 'both'; }

function edgeMarkerAttrs(edge) {
  const direction = edgeDirection(edge);
  return {
    ...(direction === 'forward' || direction === 'both' ? { 'marker-end': 'url(#arrow-forward)' } : {}),
    ...(direction === 'reverse' || direction === 'both' ? { 'marker-start': 'url(#arrow-reverse)' } : {}),
  };
}

function renderEdgeLabel(item, edge) {
  const selected = activeConnection?.kind === 'edge' && activeConnection.id === edge.id;
  const chip = el('div', { class: `edge-label-chip ${selected ? 'active' : ''}`, 'data-edge-label': edge.id });
  placeEdgeLabel(chip, item, edge);
  const name = button(edge.label || '', () => {
    if (!selected) { selectConnection('edge', edge.id); return; }
    const input = el('input', { class: 'edge-label-input', value: edge.label || '', 'aria-label': 'Relationship description' });
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim() || null;
      if (save && value !== (edge.label ?? null)) change((entry) => { entry.edges.find((link) => link.id === edge.id).label = value; });
      else { input.replaceWith(name); name.focus(); }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    name.replaceWith(input); input.focus(); input.select();
  }, 'edge-label-name', { 'aria-label': edge.label ? 'Edit relationship description' : 'Add relationship description', title: edge.label ? 'Edit relationship description' : 'Add relationship description' });
  if (selected) {
    const directions = { forward: '→', both: '↔', reverse: '←' };
    const type = button(directions[edgeDirection(edge)], () => {
      const next = { forward: 'both', both: 'reverse', reverse: 'forward' }[edgeDirection(edge)];
      change((entry) => { entry.edges.find((link) => link.id === edge.id).direction = next; });
    }, 'edge-type-button', { 'aria-label': `Connection type: ${edgeDirection(edge)}. Click to change`, title: 'Change connection type' });
    const remove = button('×', () => change((entry) => {
      const removed = entry.edges.find((link) => link.id === edge.id);
      if (removed?.structural) {
        const child = entry.nodes.find((node) => node.id === removed.toId);
        if (child) { child.parentId = null; if (child.anchor?.targetId === removed.fromId) child.anchor = null; }
      }
      entry.edges = entry.edges.filter((link) => link.id !== edge.id);
    }), 'edge-label-remove', { 'aria-label': 'Remove relationship' });
    chip.append(type, name, remove);
  } else chip.append(name);
  return chip;
}

function renderConnectors(item) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#514fc1';
  const svg = el('svg', { class: 'connectors', viewBox: '-4000 -4000 8000 8000', role: 'group', 'aria-label': 'Node connections' });
  const defs = el('defs');
  for (const [id, color, orient] of [['arrow-primary', accent, 'auto'], ['arrow-forward', accent, 'auto'], ['arrow-reverse', accent, 'auto-start-reverse']]) {
    defs.append(el('marker', { id, markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient, markerUnits: 'userSpaceOnUse', viewBox: '0 0 8 8' }, el('path', { d: 'M1 1 7 4 1 7', fill: 'none', stroke: color, style: `stroke: ${color}`, 'stroke-width': '1.6', 'stroke-opacity': '.78', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
  }
  svg.append(defs);
  for (const node of item.nodes) {
    if (!isVisible(item, node) || node.anchor) continue;
    if (!node.parentId || item.edges.some((edge) => edge.structural && edge.toId === node.id)) continue;
    const source = sourceFor(item, node);
    const path = makeConnector(svg, node.id, source?.point || rootBounds, pointFor(item, node.id), source?.fromY, node.connectionSide, 'branch-line', { 'data-to': node.id, 'marker-end': 'url(#arrow-primary)' }, () => selectConnection('node', node.id));
    if (!source) { path.style.display = 'none'; path._hit.style.display = 'none'; }
    if (node.anchor) {
      const dot = el('circle', { class: 'origin-dot', 'data-origin': node.id, cx: source?.point.x ?? 0, cy: source?.point.y ?? 0, r: '3' });
      if (!source) dot.style.display = 'none';
      svg.append(dot);
    }
  }
  for (const edge of item.edges) {
    const from = item.nodes.find((node) => node.id === edge.fromId), to = item.nodes.find((node) => node.id === edge.toId);
    if (!from || !to || !isVisible(item, from) || !isVisible(item, to)) continue;
    const lineClass = `cross-line ${edgeDirection(edge) === 'both' ? '' : 'one-way'}`.trim();
    const direction = edgeDirection(edge);
    const path = makeConnector(svg, edge.id, pointFor(item, from.id), pointFor(item, to.id), null, edge.toSide, lineClass, { 'data-edge': edge.id, ...edgeMarkerAttrs(edge) }, () => selectConnection('edge', edge.id), direction === 'both', direction === 'reverse');
    updateCrossRoute(path, pointFor(item, from.id), pointFor(item, to.id), edge.fromSide, edge.toSide);
  }
  return svg;
}

function renderAnchorConnectors(item) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#514fc1';
  const svg = el('svg', { class: 'connectors anchor-connectors', viewBox: '-4000 -4000 8000 8000', role: 'group', 'aria-label': 'Passage connections' });
  const defs = el('defs');
  defs.append(el('marker', { id: 'arrow-anchor', markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto', markerUnits: 'userSpaceOnUse', viewBox: '0 0 8 8' }, el('path', { d: 'M1 1 7 4 1 7', fill: 'none', stroke: accent, style: `stroke: ${accent}`, 'stroke-width': '1.6', 'stroke-opacity': '.72', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
  svg.append(defs);
  for (const node of item.nodes) {
    if (!isVisible(item, node) || !node.anchor) continue;
    const source = sourceFor(item, node);
    const path = makeConnector(svg, node.id, source?.point || rootBounds, pointFor(item, node.id), source?.fromY, node.connectionSide, 'branch-line', { 'data-to': node.id, 'marker-end': 'url(#arrow-anchor)' }, () => selectConnection('node', node.id));
    if (!source) { path.style.display = 'none'; path._hit.style.display = 'none'; }
    const dot = el('circle', { class: 'origin-dot', 'data-origin': node.id, cx: source?.point.x ?? 0, cy: source?.point.y ?? 0, r: '3' });
    if (!source) dot.style.display = 'none';
    svg.append(dot);
  }
  return svg;
}

function updateConnectors() {
  const item = work(); if (!item) return;
  for (const node of item.nodes) {
    const path = document.querySelector(`[data-to="${node.id}"]`);
    const source = sourceFor(item, node);
    if (path) {
      path.style.display = source ? '' : 'none';
      if (path._hit) path._hit.style.display = source ? '' : 'none';
      if (source) updateRoute(path, source.point, pointFor(item, node.id), source.fromY, node.connectionSide);
    }
    const dot = document.querySelector(`[data-origin="${node.id}"]`);
    if (dot) {
      dot.style.display = source?.anchored ? '' : 'none';
      if (source?.anchored) { dot.setAttribute('cx', source.point.x); dot.setAttribute('cy', source.point.y); }
    }
  }
  for (const edge of item.edges) {
    const path = document.querySelector(`[data-edge="${edge.id}"]`);
    if (path) updateCrossRoute(path, pointFor(item, edge.fromId), pointFor(item, edge.toId), edge.fromSide, edge.toSide);
    const label = document.querySelector(`[data-edge-label="${edge.id}"]`);
    if (label) placeEdgeLabel(label, item, edge);
  }
  positionConnectionHandles(item);
}

function positionConnectionHandles(item) {
  if (!activeConnection) return;
  const { kind, id } = activeConnection;
  for (const handle of document.querySelectorAll('.connection-handle:not(.dragging)')) {
    const end = handle.dataset.end;
    const target = connectionEnd(item, kind, id, end);
    if (!target) continue;
    let side = target.side;
    if (side === 'auto' && kind === 'node') {
      const source = sourceFor(item, item.nodes.find((node) => node.id === id))?.point || rootBounds;
      side = target.rect.x >= source.x + source.width / 2 ? 'left' : 'right';
    } else if (side === 'auto') {
      const edge = item.edges.find((entry) => entry.id === id);
      const route = crossConnectionRoute(pointFor(item, edge.fromId), pointFor(item, edge.toId), edge.fromSide, edge.toSide);
      side = route[end === 'from' ? 'fromSide' : 'toSide'];
    }
    const port = connectionPort(target.rect, side, 8);
    handle.style.left = `${port.x}px`; handle.style.top = `${port.y}px`;
  }
}

function renderNode(node, item) {
  const pos = item.layout.positions[node.id];
  const card = el('div', { class: `topic-card ${selectedId === node.id || selectedIds.has(node.id) ? 'selected' : ''}`, 'data-node': node.id, tabindex: '0', role: 'button', 'aria-label': node.title });
  const size = pointFor(item, node.id);
  card.style.left = `${pos.x}px`; card.style.top = `${pos.y}px`; card.style.width = `${size.width}px`; card.style.height = `${size.height}px`;
  applyNodeSizeClass(card, size.width, size.height);
  const grip = el('button', { type: 'button', class: 'drag-grip', text: '⠿', title: 'Move', 'aria-label': `Move ${node.title}` });
  grip.addEventListener('pointerdown', (event) => startNodeDrag(event, node, card, grip));
  grip.addEventListener('keydown', (event) => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 24 : 8;
    const ids = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
    change((entry) => {
      for (const id of ids) {
        const position = entry.layout.positions[id];
        position.x += direction[0] * step;
        position.y += direction[1] * step;
      }
    }, { group: `keyboard-move:${ids.join(',')}` });
    document.querySelector(`[data-node="${node.id}"] .drag-grip`)?.focus();
  });
  const title = el('strong', { class: 'topic-title', text: node.title || 'Untitled' });
  const content = el('div', { class: 'node-content markdown-preview', 'data-document-id': node.id, tabindex: '0', 'aria-label': `${node.title} content` });
  content.innerHTML = renderMarkdown(node.document?.markdown || '');
  content.addEventListener('mouseup', (event) => capturePassage(content, node.id, event));
  content.addEventListener('keyup', (event) => capturePassage(content, node.id, event));
  content.addEventListener('dblclick', (event) => {
    if (event.target.closest('.anchor-mark')) return;
    event.stopPropagation();
    beginNodeMarkdownEdit(node.id);
  });
  const count = item.nodes.filter((entry) => entry.parentId === node.id).length;
  const footer = count ? el('div', { class: 'topic-footer' }, button(node.collapsed ? `＋ ${count}` : `− ${count}`, (event) => { event.stopPropagation(); change((entry) => { entry.nodes.find((n) => n.id === node.id).collapsed = !node.collapsed; }); }, 'collapse-button', { 'aria-label': node.collapsed ? 'Expand children' : 'Collapse children' })) : null;
  const resize = button('', () => {}, 'resize-grip node-resize', { 'aria-label': `Resize ${node.title}`, title: 'Drag to resize; arrow keys also work' });
  const link = button('↔', () => {}, 'link-grip', { 'aria-label': `Connect ${node.title} to another node or create one`, title: 'Drag to a node to connect, or empty space to create a node' });
  link.addEventListener('pointerdown', (event) => startEdgeDrag(event, node, link));
  link.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); event.stopPropagation();
    openLinkMenu(node, link);
  });
  resize.addEventListener('pointerdown', (event) => startNodeResize(event, node, card, resize));
  resize.addEventListener('keydown', (event) => resizeNodeWithKeys(event, node));
  card.append(el('div', { class: 'topic-top' }, grip), title, content);
  if (footer) card.append(footer);
  card.append(link, resize);
  card.addEventListener('click', (event) => {
    // Leave the content surface alone so the browser can deliver a dblclick
    // without the first click replacing the card's DOM.
    if (event.target.closest('.node-content, .anchor-mark, button, input') || !window.getSelection()?.isCollapsed) return;
    selectNode(node.id);
  });
  card.addEventListener('dblclick', (event) => { if (!event.target.closest('.node-content')) beginRename(node.id); });
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); selectNode(node.id); } });
  return card;
}

function openLinkMenu(node, grip) {
  closeContextMenu();
  const item = work();
  const available = item.nodes.filter((candidate) => candidate.id !== node.id &&
    !item.edges.some((edge) => (edge.fromId === node.id && edge.toId === candidate.id) || (edge.toId === node.id && edge.fromId === candidate.id)));
  if (!available.length) return announce('No unconnected nodes are available.');
  const menu = el('div', { class: 'context-menu', role: 'menu', 'aria-label': `Connect ${node.title}` });
  for (const candidate of available) menu.append(button(`Connect to ${candidate.title}`, () => {
    closeContextMenu();
    change((entry) => { entry.edges.push({ id: crypto.randomUUID(), fromId: node.id, toId: candidate.id, label: null }); });
    announce('Nodes connected. Select the relationship on the line to add a description.');
  }, 'context-option', { role: 'menuitem' }));
  document.querySelector('.workspace-shell')?.append(menu);
  const rect = grip.getBoundingClientRect();
  menu.style.left = `${clamp(rect.left, 8, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${clamp(rect.bottom + 4, 8, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector('button')?.focus();
}

function startEdgeDrag(event, node, grip, preserveClick = false) {
  if (event.button !== 0) return;
  if (!preserveClick) event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const scene = document.querySelector('.scene');
  const preview = el('path', { class: 'edge-preview', 'marker-end': 'url(#arrow-forward)' });
  document.querySelector('.connectors').append(preview);
  grip.setPointerCapture?.(event.pointerId);
  let target = null, destination = null, moved = false;
  const move = (next) => {
    if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
    moved = true;
    const rect = scene.getBoundingClientRect();
    destination = { x: (next.clientX - rect.left) / view.zoom, y: (next.clientY - rect.top) / view.zoom, width: 0, height: 0 };
    preview.setAttribute('d', curve(pointFor(work(), node.id), destination));
    const hovered = document.elementFromPoint(next.clientX, next.clientY)?.closest('.topic-card');
    const nextId = hovered?.dataset.node === node.id ? null : hovered?.dataset.node || null;
    if (target !== nextId) {
      document.querySelector(`[data-node="${target}"]`)?.classList.remove('edge-target');
      target = nextId;
      hovered?.classList.toggle('edge-target', !!target);
    }
  };
  const finish = (next) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
    document.querySelector(`[data-node="${target}"]`)?.classList.remove('edge-target'); preview.remove();
    if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    if (next.type !== 'pointerup' || !destination || !moved) return;
    const item = work();
    if (target && item.edges.some((edge) => (edge.fromId === node.id && edge.toId === target) || (edge.fromId === target && edge.toId === node.id))) return announce('These nodes are already connected.');
    change((entry) => {
      let newId = target;
      if (!newId) {
        newId = crypto.randomUUID();
        const anchor = node.anchor ? { ...node.anchor, id: crypto.randomUUID() } : null;
        entry.nodes.push({ id: newId, parentId: null, title: anchor ? shortTitle(anchor.quote) : 'Untitled', document: { type: 'markdown', markdown: '' }, anchor, collapsed: false, provenance: 'learner' });
        entry.layout.positions[newId] = { x: destination.x - NODE.width / 2, y: destination.y - NODE.height / 2 };
      }
      const incoming = entry.edges.some((edge) => edge.toId === newId) || entry.nodes.some((candidate) => candidate.id === newId && candidate.parentId);
      entry.edges.push({ id: crypto.randomUUID(), fromId: node.id, toId: newId, label: null, direction: incoming ? 'both' : 'forward' });
    });
    selectedId = target ? target : null;
    announce(target ? 'Nodes connected.' : 'Node created and connected.');
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); move(event);
}

function applyNodeSizeClass(card, width, height) {
  const expanded = width >= 280 || height >= 180;
  card.classList.toggle('expanded', expanded);
}

function updateCardOverflow(card) {
  const content = card.querySelector('.node-content');
  if (content) card.classList.toggle('content-overflow', content.scrollHeight > content.clientHeight + 2 || content.scrollWidth > content.clientWidth + 2);
}

function startNodeResize(event, node, card, grip) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const item = work(), original = { ...pointFor(item, node.id) }, x = event.clientX, y = event.clientY;
  grip.setPointerCapture(event.pointerId);
  const move = (next) => {
    const width = clamp(Math.round(original.width + (next.clientX - x) / view.zoom), 170, 680);
    const height = clamp(Math.round(original.height + (next.clientY - y) / view.zoom), 100, 480);
    item.layout.sizes[node.id] = { width, height };
    card.style.width = `${width}px`; card.style.height = `${height}px`;
    applyNodeSizeClass(card, width, height);
    updateCardOverflow(card);
    updateConnectors();
  };
  let ended = false;
  const up = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('mouseup', up);
    grip.removeEventListener('lostpointercapture', up);
    const final = item.layout.sizes[node.id] || { width: original.width, height: original.height };
    item.layout.sizes[node.id] = { width: original.width, height: original.height };
    if (final.width !== original.width || final.height !== original.height) change((entry) => { entry.layout.sizes[node.id] = final; });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('mouseup', up);
  grip.addEventListener('lostpointercapture', up);
}

function resizeNodeWithKeys(event, node) {
  const steps = { ArrowRight: [20, 0], ArrowLeft: [-20, 0], ArrowDown: [0, 20], ArrowUp: [0, -20] };
  const step = steps[event.key]; if (!step) return;
  event.preventDefault(); event.stopPropagation();
  change((item) => {
    const size = pointFor(item, node.id);
    item.layout.sizes[node.id] = { width: clamp(size.width + step[0], 170, 680), height: clamp(size.height + step[1], 100, 480) };
  });
  document.querySelector(`[data-node="${node.id}"] .node-resize`)?.focus();
}

function startNodeDrag(event, node, card, grip) {
  if (event.button !== 0) return;
  event.stopPropagation(); event.preventDefault();
  const item = work(), moving = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
  const original = Object.fromEntries(moving.map((id) => [id, { ...item.layout.positions[id] }]));
  const originX = event.clientX, originY = event.clientY;
  grip.setPointerCapture(event.pointerId);
  const move = (next) => {
    const dx = Math.round((next.clientX - originX) / view.zoom), dy = Math.round((next.clientY - originY) / view.zoom);
    for (const id of moving) {
      const position = { x: original[id].x + dx, y: original[id].y + dy };
      item.layout.positions[id] = position;
      const element = document.querySelector(`[data-node="${id}"]`);
      if (element) { element.style.left = `${position.x}px`; element.style.top = `${position.y}px`; }
    }
    updateConnectors();
  };
  let ended = false;
  const up = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('mouseup', up);
    grip.removeEventListener('lostpointercapture', up);
    const final = Object.fromEntries(moving.map((id) => [id, { ...item.layout.positions[id] }]));
    for (const id of moving) item.layout.positions[id] = original[id];
    if (moving.some((id) => final[id].x !== original[id].x || final[id].y !== original[id].y)) change((entry) => { for (const id of moving) entry.layout.positions[id] = final[id]; });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('mouseup', up);
  grip.addEventListener('lostpointercapture', up);
}

function selectNode(id) { selectedId = id; selectedIds.clear(); selectedPassage = null; editGroup = null; renderWorkspace(); }

function beginNodeMarkdownEdit(id) {
  const item = work();
  const node = item?.nodes.find((entry) => entry.id === id);
  const card = document.querySelector(`[data-node="${id}"]`);
  if (!node || !card) return;
  const preview = card.querySelector('.node-content');
  if (!preview || preview.querySelector('.node-markdown-editor')) return;
  const editor = el('textarea', { class: 'node-markdown-editor', 'aria-label': `${node.title} Markdown`, spellcheck: 'true' });
  editor.value = node.document?.markdown || '';
  const originalMarkdown = editor.value;
  preview.replaceChildren(editor);
  card.classList.add('editing-node-content');
  const finish = (save = true) => {
    if (!editor.isConnected) return;
    if (!save) {
      if (editor.value !== originalMarkdown) {
        change((entry) => { entry.nodes.find((entryNode) => entryNode.id === id).document.markdown = originalMarkdown; }, { group: `markdown:${id}`, rerender: false });
      }
      editGroup = null;
      renderWorkspace();
      return;
    }
    // Persist once more on exit in case the browser did not emit an input
    // event for the final change (for example, IME/composition input).
    if (editor.value !== (work().nodes.find((entry) => entry.id === id)?.document?.markdown || '')) {
      change((entry) => { entry.nodes.find((entryNode) => entryNode.id === id).document.markdown = editor.value; }, { group: `markdown:${id}`, rerender: false });
    }
    editGroup = null;
    renderWorkspace();
  };
  editor.addEventListener('blur', () => finish(true), { once: true });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
  });
  editor.addEventListener('input', () => {
    change((entry) => { entry.nodes.find((entryNode) => entryNode.id === id).document.markdown = editor.value; }, { group: `markdown:${id}`, rerender: false });
    resizeNodeEditor(editor);
    updateCardOverflow(card);
  });
  resizeNodeEditor(editor);
  editor.focus();
  editor.select();
}

function resizeNodeEditor(editor) {
  editor.style.height = 'auto';
  editor.style.height = `${Math.max(60, Math.min(editor.scrollHeight + 2, 360))}px`;
}

function beginRename(id) {
  const card = document.querySelector(`[data-node="${id}"]`); if (!card) return;
  const title = card.querySelector('.topic-title');
  const node = work().nodes.find((entry) => entry.id === id);
  const input = el('input', { class: 'inline-title', value: node.title, 'aria-label': 'Rename node' });
  title.replaceWith(input); input.focus(); input.select();
  const finish = () => { const value = input.value.trim() || 'Untitled'; if (value !== node.title) change((entry) => { entry.nodes.find((n) => n.id === id).title = value; }); else renderWorkspace(); };
  input.addEventListener('blur', finish, { once: true });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } if (event.key === 'Escape') { input.value = node.title; input.blur(); } });
}

function addNode(parentId = null, anchor = null, preferredPosition = null) {
  const item = work(); if (!item) return;
  const node = { id: crypto.randomUUID(), parentId, title: anchor ? shortTitle(anchor.quote) : 'Untitled', document: { type: 'markdown', markdown: '' }, anchor, collapsed: false, provenance: 'learner' };
  const position = preferredPosition || suggestedPosition(item, parentId);
  change((entry) => { entry.nodes.push(node); entry.layout.positions[node.id] = position; });
  selectedPassage = null; selectedId = node.id; editingMarkdown = false; renderWorkspace();
  if (anchor) focusSourceAndNode(node.id);
  else focusNode(node.id);
  beginRename(node.id);
}

function shortTitle(text) { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > 58 ? `${clean.slice(0, 55)}…` : clean; }

function positionForPassage(item, targetId) {
  const selection = selectedPassage;
  const scene = document.querySelector('.scene');
  if (!selection || !scene || !view.zoom) return null;
  const source = targetId === 'article' ? rootBounds : pointFor(item, targetId);
  const sceneRect = scene.getBoundingClientRect();
  const browserSelection = window.getSelection();
  const rangeRect = browserSelection?.rangeCount ? browserSelection.getRangeAt(0).getBoundingClientRect() : null;
  const screenY = rangeRect ? rangeRect.top + rangeRect.height / 2 : selection.y;
  const passageY = (screenY - sceneRect.top) / view.zoom;
  const bottom = source.y + source.height - NODE.height - 16;
  if (bottom < source.y + 16) return null;
  // An anchored node belongs beside the passage that created it. Keep it on
  // the source's right edge and align its vertical centre with the highlight,
  // rather than falling back to the generic top-level layout position.
  return {
    x: source.x + source.width + 90,
    y: clamp(passageY - NODE.height / 2, source.y + 16, bottom)
  };
}

function focusNode(id) {
  const viewport = document.querySelector('.canvas-viewport'), point = work()?.layout.positions[id];
  if (!viewport || !point) return;
  const size = pointFor(work(), id);
  view.x = viewport.clientWidth / 2 - (point.x + size.width / 2) * view.zoom;
  view.y = viewport.clientHeight / 2 - (point.y + size.height / 2) * view.zoom;
  applyView(); saveView();
}

function focusSourceAndNode(id) {
  const viewport = document.querySelector('.canvas-viewport'), item = work();
  if (!viewport || !item) return;
  const target = item.nodes.find((entry) => entry.id === id);
  const node = pointFor(item, id);
  // The old implementation used the complete article bounds here. That made
  // a long article force the whole canvas to zoom out just to show one branch.
  // The anchor mark is the thing being navigated to, so use its actual line.
  const source = target && sourceFor(item, target)?.point;
  const from = source || node;
  const minX = Math.min(from.x, node.x), maxX = Math.max(from.x + (from.width || 0), node.x + node.width);
  const minY = Math.min(from.y, node.y), maxY = Math.max(from.y + (from.height || 0), node.y + node.height);
  const left = outlineOpen ? 280 : 32, right = selectedId ? 358 : 32, top = 80, bottom = 65;
  const width = Math.max(220, viewport.clientWidth - left - right), height = Math.max(220, viewport.clientHeight - top - bottom);
  const padding = 24;
  // Reveal the relationship with the smallest possible pan. Keeping the
  // current zoom means adding a branch feels like placing a nearby object,
  // not like changing the user's scale to fit the entire document.
  let dx = 0, dy = 0;
  const screenLeft = minX * view.zoom + view.x, screenRight = maxX * view.zoom + view.x;
  const screenTop = minY * view.zoom + view.y, screenBottom = maxY * view.zoom + view.y;
  if (screenRight > left + width - padding) dx = left + width - padding - screenRight;
  if (screenLeft + dx < left + padding) dx = left + padding - screenLeft;
  if (screenBottom > top + height - padding) dy = top + height - padding - screenBottom;
  if (screenTop + dy < top + padding) dy = top + padding - screenTop;
  view.x += dx; view.y += dy;
  applyView(); saveView();
}

function removeNode(id) { removeNodes([id]); }

function removeNodes(ids) {
  const item = work(); if (!item) return;
  const roots = ids.map((id) => item.nodes.find((entry) => entry.id === id)).filter(Boolean);
  if (!roots.length) return;
  const removed = new Set(roots.map((node) => node.id));
  let growing = true;
  while (growing) {
    growing = false;
    for (const child of item.nodes) if ((removed.has(child.parentId) || removed.has(child.anchor?.targetId)) && !removed.has(child.id)) { removed.add(child.id); growing = true; }
  }
  change((entry) => {
    entry.nodes = entry.nodes.filter((node) => !removed.has(node.id));
    entry.edges = entry.edges.filter((edge) => !removed.has(edge.fromId) && !removed.has(edge.toId));
    for (const nodeId of removed) { delete entry.layout.positions[nodeId]; delete entry.layout.sizes[nodeId]; }
  });
  selectedId = roots.length === 1 && !removed.has(roots[0].parentId) ? roots[0].parentId : null;
  selectedIds.clear(); selectedPassage = null;
  renderWorkspace(); announce(`${removed.size} node${removed.size === 1 ? '' : 's'} deleted. Undo is available.`);
}

function renderDetails(node, item) {
  const anchorRange = resolveAnchor(node.anchor, sourcePlainText(item, node.anchor?.targetId));
  const panel = el('aside', { class: 'details-panel', 'aria-label': 'Node details' }, el('div', { class: 'panel-heading' }, el('span', { class: 'panel-eyebrow', text: 'NODE DETAILS' }), button('×', () => { selectedId = null; renderWorkspace(); }, 'panel-close', { 'aria-label': 'Close details' })));
  const title = el('input', { class: 'details-title', value: node.title, 'aria-label': 'Title' });
  title.addEventListener('input', () => {
    change((entry) => { entry.nodes.find((n) => n.id === node.id).title = title.value; }, { group: `title:${node.id}`, rerender: false });
    const card = document.querySelector(`[data-node="${node.id}"] .topic-title`); if (card) card.textContent = title.value;
  });
  title.addEventListener('blur', () => { editGroup = null; });
  const markdown = el('textarea', { class: 'details-markdown', placeholder: 'Write here…', 'aria-label': 'Markdown content', spellcheck: 'true' }); markdown.value = node.document?.markdown || '';
  markdown.addEventListener('input', () => {
    change((entry) => { entry.nodes.find((n) => n.id === node.id).document.markdown = markdown.value; }, { group: `markdown:${node.id}`, rerender: false });
    const preview = document.querySelector(`[data-node="${node.id}"] .node-content`);
    if (preview) {
      preview.innerHTML = renderMarkdown(markdown.value);
      markAnchors(preview, work().nodes.filter((entry) => entry.anchor?.targetId === node.id));
      updateCardOverflow(preview.closest('.topic-card'));
      updateConnectors();
    }
  });
  markdown.addEventListener('blur', () => { editGroup = null; });
  panel.append(el('label', { text: 'TITLE' }), title, el('label', { text: 'CONTENT' }), markdown);
  if (node.sourceRefs?.length) {
    panel.append(el('label', { text: 'SOURCES' }));
    for (const reference of node.sourceRefs) {
      const source = item.sources?.find((entry) => entry.id === reference.sourceId);
      const link = button(`${source?.title || 'Missing source'}${reference.page ? ` · p. ${reference.page}` : ''}\n“${reference.anchor.quote}”`, () => openSource(reference.sourceId, reference.page || 1, reference.anchor), 'source-ref', { title: 'Open original passage' });
      panel.append(link);
    }
  }
  if (node.anchor) {
    panel.append(el('div', { class: `source-quote ${anchorRange ? '' : 'unresolved'}` }, el('span', { class: 'source-label', text: anchorRange ? 'LINKED PASSAGE' : 'PASSAGE NEEDS REPAIR' }), el('p', { text: node.anchor.quote })));
    panel.append(button(anchorRange ? '↗ Go to passage' : 'Reconnect selected passage', () => anchorRange ? goToPassage(node) : reconnect(node), 'panel-action'));
  }
  const actions = el('div', { class: 'panel-actions' }, button('＋ Child', () => addNode(node.id), 'panel-action'), button('＋ Sibling', () => addNode(node.parentId), 'panel-secondary'));
  panel.append(actions);
  panel.append(button('Ask about this node', () => openAiPanel({ kind: 'ask', targetId: node.id }), 'panel-secondary'));
  panel.append(button(item.nodes.some((entry) => entry.parentId === node.id) ? 'Delete node and its descendants' : 'Delete node', () => removeNode(node.id), 'remove-branch'));
  return panel;
}

function openSource(id, page = 1, anchor = null) {
  openSourceId = id;
  sourcePage = page;
  sourceJump = anchor;
  renderWorkspace();
}

function sourceReference(source, page, text, offsets) {
  return { id: crypto.randomUUID(), sourceId: source.id, page: source.type === 'pdf' ? page : null, anchor: makeAnchor(source.id, text, offsets.start, offsets.end) };
}

function attachSourceReference(nodeId, reference) {
  change((item) => { item.nodes.find((node) => node.id === nodeId).sourceRefs ||= []; item.nodes.find((node) => node.id === nodeId).sourceRefs.push(reference); });
  announce('Source passage attached to node.');
}

function createNodeFromSource(reference) {
  const item = work();
  const node = { id: crypto.randomUUID(), title: shortTitle(reference.anchor.quote), document: { type: 'markdown', markdown: `> ${reference.anchor.quote.replace(/\n/g, '\n> ')}` }, parentId: null, anchor: null, sourceRefs: [reference], collapsed: false, provenance: 'source' };
  const position = suggestedPosition(item, null);
  change((entry) => { entry.nodes.push(node); entry.layout.positions[node.id] = position; });
  openSourceId = null; sourceJump = null; selectedId = node.id; selectedPassage = null;
  renderWorkspace(); focusNode(node.id);
}

function sourceSelectionActions(source, page, textRoot, actions) {
  const offsets = selectionOffsets(textRoot);
  if (!offsets || !textRoot.textContent.slice(offsets.start, offsets.end).trim()) return;
  const reference = sourceReference(source, page, textRoot.textContent, offsets);
  actions.replaceChildren(
    el('span', { class: 'source-selection-quote', text: `“${shortTitle(reference.anchor.quote)}”` }),
    button('Create node', () => createNodeFromSource(reference), 'panel-action'),
  );
  const nodes = work()?.nodes || [];
  if (nodes.length) {
    const chooser = el('select', { 'aria-label': 'Node to attach passage to' });
    for (const node of nodes) chooser.append(el('option', { value: node.id, text: node.title }));
    if (selectedId) chooser.value = selectedId;
    actions.append(chooser, button('Attach passage', () => attachSourceReference(chooser.value, reference), 'panel-secondary'));
  }
}

function textRangeAt(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let position = 0, startFound = false, node;
  while ((node = walker.nextNode())) {
    const next = position + node.length;
    if (!startFound && start <= next) { range.setStart(node, Math.max(0, start - position)); startFound = true; }
    if (startFound && end <= next) { range.setEnd(node, Math.max(0, end - position)); return range; }
    position = next;
  }
  return null;
}

function showSourcePassage(textRoot, anchor, surface) {
  const location = resolveAnchor(anchor, textRoot.textContent);
  if (!location) return announce('Saved passage was not found in this source.');
  const range = textRangeAt(textRoot, location.start, location.end);
  if (!range) return;
  const bounds = surface.getBoundingClientRect();
  for (const rect of range.getClientRects()) {
    if (!rect.width || !rect.height) continue;
    const highlight = el('div', { class: 'source-passage-highlight', 'aria-hidden': 'true' });
    Object.assign(highlight.style, { left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    surface.append(highlight);
  }
  const first = range.getClientRects()[0];
  if (first) surface.parentElement.scrollTop += first.top - surface.parentElement.getBoundingClientRect().top - 90;
  sourceJump = null;
}

function renderSourcesPanel(item) {
  const panel = el('section', { class: 'sources-panel', 'aria-label': 'Sources' });
  const sidebar = el('div', { class: 'sources-sidebar' }, el('div', { class: 'sources-heading' }, el('strong', { text: 'Sources' }), button('×', () => openSource(null), 'panel-close', { 'aria-label': 'Close sources' })));
  for (const source of item.sources || []) sidebar.append(button(`${source.type === 'pdf' ? '▤' : '≡'}  ${source.title}`, () => openSource(source.id), `source-list-item ${source.id === openSourceId ? 'active' : ''}`));
  const addText = el('div', { class: 'source-add-text' });
  const textTitle = el('input', { placeholder: 'Source title', 'aria-label': 'Pasted source title' });
  const textBody = el('textarea', { placeholder: 'Paste source text…', 'aria-label': 'Source text' });
  addText.append(textTitle, textBody, button('Add pasted text', () => {
    if (!textBody.value.trim()) return announce('Paste source text first.');
    if (textBody.value.length > 500_000) return announce('Pasted text is over the 500,000 character limit.');
    const source = pastedSource(textTitle.value || 'Pasted text', textBody.value);
    change((entry) => { entry.sources ||= []; entry.sources.push(source); });
    openSource(source.id);
  }, 'panel-action'));
  const addPdf = el('input', { type: 'file', accept: '.pdf,application/pdf', 'aria-label': 'Import PDF', class: 'source-file-input' });
  addPdf.addEventListener('change', async () => {
    if (!addPdf.files?.[0]) return;
    try { const source = await pdfSource(addPdf.files[0]); change((entry) => { entry.sources ||= []; entry.sources.push(source); }); openSource(source.id); }
    catch (error) { announce(`PDF import failed: ${error.message}`); }
  });
  sidebar.append(el('div', { class: 'source-add-heading', text: 'ADD SOURCE' }), addText, addPdf);
  const body = el('div', { class: 'source-reader' });
  const source = item.sources?.find((entry) => entry.id === openSourceId);
  if (!source) body.append(el('div', { class: 'source-empty', text: 'Choose a source, paste text, or import a PDF. Original material stays separate from the article.' }));
  else renderSourceContent(body, source);
  panel.append(sidebar, body);
  return panel;
}

function renderSourceContent(body, source) {
  body.append(el('div', { class: 'source-reader-heading' }, el('strong', { text: source.title }), el('small', { text: source.type === 'pdf' ? `${source.pages} page PDF · stored locally` : 'Pasted text · stored locally' })));
  const actions = el('div', { class: 'source-selection-actions', 'aria-live': 'polite' });
  body.append(actions);
  if (source.type === 'text') {
    const scroll = el('div', { class: 'source-scroll' });
    const surface = el('div', { class: 'source-text-surface' });
    const textRoot = el('div', { class: 'source-text', text: source.text });
    surface.append(textRoot); scroll.append(surface); body.append(scroll);
    textRoot.addEventListener('mouseup', () => sourceSelectionActions(source, null, textRoot, actions));
    textRoot.addEventListener('keyup', () => sourceSelectionActions(source, null, textRoot, actions));
    if (sourceJump) queueMicrotask(() => showSourcePassage(textRoot, sourceJump, surface));
    return;
  }
  const controls = el('div', { class: 'source-page-controls' });
  const pageInput = el('input', { type: 'number', min: '1', max: String(source.pages), value: String(sourcePage), 'aria-label': 'PDF page number' });
  const changePage = (page) => { sourcePage = clamp(Number(page) || 1, 1, source.pages); sourceJump = null; openSource(source.id, sourcePage); };
  pageInput.addEventListener('change', () => changePage(pageInput.value));
  controls.append(button('←', () => changePage(sourcePage - 1), '', { 'aria-label': 'Previous page', ...(sourcePage <= 1 ? { disabled: '' } : {}) }), el('span', { text: 'Page' }), pageInput, el('span', { text: `/ ${source.pages}` }), button('→', () => changePage(sourcePage + 1), '', { 'aria-label': 'Next page', ...(sourcePage >= source.pages ? { disabled: '' } : {}) }));
  body.append(controls);
  const scroll = el('div', { class: 'source-scroll' });
  body.append(scroll);
  queueMicrotask(() => drawPdfPage(source, sourcePage, scroll, actions));
}

async function drawPdfPage(source, number, scroll, actions) {
  if (!scroll.isConnected) return;
  try {
    let document = pdfDocuments.get(source.id);
    if (!document) {
      const bytes = await getPdf(source.id);
      if (!bytes) return showMissingPdf(source, scroll);
      document = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      pdfDocuments.set(source.id, document);
    }
    if (!scroll.isConnected) return;
    const page = await document.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.5, 760 / base.width) });
    const surface = el('div', { class: 'pdf-page-surface' });
    surface.style.width = `${viewport.width}px`; surface.style.height = `${viewport.height}px`;
    surface.style.setProperty('--total-scale-factor', String(viewport.scale));
    surface.style.setProperty('--scale-factor', String(viewport.scale));
    const canvas = el('canvas');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewport.width * ratio); canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d');
    const textRoot = el('div', { class: 'textLayer' });
    surface.append(canvas, textRoot); scroll.replaceChildren(surface);
    await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
    await new TextLayer({ textContentSource: page.streamTextContent(), container: textRoot, viewport }).render();
    if (!scroll.isConnected) return;
    textRoot.addEventListener('mouseup', () => sourceSelectionActions(source, number, textRoot, actions));
    textRoot.addEventListener('keyup', () => sourceSelectionActions(source, number, textRoot, actions));
    if (sourceJump && sourcePage === number) showSourcePassage(textRoot, sourceJump, surface);
    if (!textRoot.textContent.trim()) actions.append(el('span', { class: 'source-hint', text: 'No selectable text was found on this page. Scanned PDFs need OCR, which is not available yet.' }));
  } catch (error) {
    if (scroll.isConnected) scroll.replaceChildren(el('div', { class: 'source-error', text: `Could not read this PDF: ${error.message}` }));
  }
}

function showMissingPdf(source, scroll) {
  const file = el('input', { type: 'file', accept: '.pdf,application/pdf', 'aria-label': 'Reattach original PDF' });
  const message = el('div', { class: 'source-error' }, el('strong', { text: 'PDF bytes are missing from this browser.' }), el('p', { text: `Reattach ${source.fileName}. Saved references will be kept and checked against the original file.` }), file);
  scroll.replaceChildren(message);
  file.addEventListener('change', async () => {
    if (!file.files?.[0]) return;
    try { await pdfSource(file.files[0], source.id, source.checksum); openSource(source.id, sourcePage, sourceJump); }
    catch (error) { announce(`Could not reattach: ${error.message}`); }
  });
}

function goToPassage(node) {
  selectedId = null; editingMarkdown = false; selectedPassage = null; renderWorkspace();
  const mark = document.querySelector(`.anchor-mark[data-anchor-node="${node.id}"]`);
  if (!mark) return announce('The linked passage could not be found.');
  centerOnElement(mark);
  mark.classList.add('arrived'); setTimeout(() => mark.classList.remove('arrived'), 1700);
  mark.focus();
}

function reconnect(node) {
  if (!selectedPassage) return announce('Select the matching passage first.');
  try {
    const targetId = selectedPassage.targetId;
    if (targetId === node.id || isDescendant(work(), targetId, node.id)) return announce('Choose a passage outside this node and its descendants.');
    const anchor = makeAnchor(targetId, sourcePlainText(work(), targetId), selectedPassage.start, selectedPassage.end);
    change((entry) => { const target = entry.nodes.find((n) => n.id === node.id); target.anchor = anchor; target.parentId = targetId === 'article' ? null : targetId; });
    selectedPassage = null; announce('Passage reconnected.');
  } catch (error) { announce(error.message); }
}

function renderPaper(item) {
  const paper = el('article', { class: 'paper', 'aria-label': 'Document' });
  paper.style.left = `${ROOT.x}px`; paper.style.top = `${ROOT.y}px`;
  paper.style.width = `${item.layout.articleSize.width}px`;
  paper.style.minHeight = `${item.layout.articleSize.minHeight}px`;
  paper.append(el('div', { class: 'paper-heading' }, el('span', { class: 'paper-label', text: 'master article' }), item.article.origins?.length ? button(`AI edits ${item.article.origins.length}`, () => openAiPanel({ kind: 'history' }), 'paper-ai-action', { title: 'Review accepted AI proposals and model provenance' }) : null, button('Generate draft', () => openAiPanel({ kind: 'generate' }), 'paper-ai-action')));
  const scroll = el('div', { class: 'paper-scroll' });
  if (editingMarkdown) {
    const editor = el('textarea', { class: 'markdown-editor', 'aria-label': 'Edit document', spellcheck: 'true' });
    editor.value = item.article.markdown;
    editor.addEventListener('input', () => {
      change((entry) => { entry.article.markdown = editor.value; }, { group: 'article-markdown', article: true, rerender: false });
      resizeEditor(editor); refreshOutline();
    });
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); editingMarkdown = false; editGroup = null; renderWorkspace(); }
    });
    editor.addEventListener('blur', () => { editGroup = null; });
    scroll.append(editor);
  } else {
    const preview = el('div', { class: 'markdown-preview', 'data-document-id': 'article', tabindex: '0' });
    preview.innerHTML = renderMarkdown(item.article.markdown);
    preview.addEventListener('mouseup', (event) => capturePassage(preview, 'article', event));
    preview.addEventListener('keyup', (event) => capturePassage(preview, 'article', event));
    scroll.append(preview);
  }
  paper.append(scroll);
  const grip = button('', () => {}, 'resize-grip paper-resize', { 'aria-label': 'Resize article', title: 'Drag to resize article; arrow keys also work' });
  grip.addEventListener('pointerdown', (event) => startPaperResize(event, paper, grip));
  grip.addEventListener('keydown', (event) => {
    const steps = { ArrowRight: [24, 0], ArrowLeft: [-24, 0], ArrowDown: [0, 24], ArrowUp: [0, -24] };
    const step = steps[event.key]; if (!step) return;
    event.preventDefault(); event.stopPropagation();
    change((entry) => {
      const size = entry.layout.articleSize;
      size.width = clamp(size.width + step[0], 320, 1100);
      size.minHeight = clamp(size.minHeight + step[1], 250, 2400);
    });
    document.querySelector('.paper-resize')?.focus();
  });
  paper.append(grip);
  return paper;
}

function startPaperResize(event, paper, grip) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const size = { ...work().layout.articleSize };
  const startX = event.clientX, startY = event.clientY;
  grip.setPointerCapture(event.pointerId);
  const move = (next) => {
    const width = clamp(Math.round(size.width + (next.clientX - startX) / view.zoom), 320, 1100);
    const minHeight = clamp(Math.round(size.minHeight + (next.clientY - startY) / view.zoom), 250, 2400);
    paper.style.width = `${width}px`; paper.style.minHeight = `${minHeight}px`;
    measurePaper();
  };
  let ended = false;
  const up = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('mouseup', up);
    grip.removeEventListener('lostpointercapture', up);
    const final = { width: Number.parseInt(paper.style.width, 10), minHeight: Number.parseInt(paper.style.minHeight, 10) };
    if (final.width !== size.width || final.minHeight !== size.minHeight) change((entry) => { entry.layout.articleSize = final; });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('mouseup', up);
  grip.addEventListener('lostpointercapture', up);
}

function resizeEditor(editor) {
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight + 2}px`;
  measurePaper();
}

function textOf(element) {
  const range = document.createRange(); range.selectNodeContents(element); return range.toString();
}

function markdownPlainText(markdown) {
  const temp = el('div'); temp.innerHTML = renderMarkdown(markdown); return textOf(temp);
}

function sourcePlainText(item, targetId) {
  if (!targetId) return '';
  const markdown = targetId === 'article' ? item.article.markdown : item.nodes.find((node) => node.id === targetId)?.document?.markdown;
  return markdown == null ? '' : markdownPlainText(markdown);
}

function capturePassage(preview, targetId, event) {
  if (event.type === 'mouseup' && event.button !== 0) return;
  const offsets = selectionOffsets(preview);
  if (!offsets) { selectedPassage = null; document.querySelector('.passage-toolbar')?.remove(); return; }
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  selectedPassage = { ...offsets, targetId, x: event.clientX || rect?.right || window.innerWidth / 2, y: event.clientY || rect?.bottom || window.innerHeight / 2 };
  renderPassageToolbar();
}

function isDescendant(item, candidateId, ancestorId) {
  let current = candidateId;
  while (current && current !== 'article') {
    if (current === ancestorId) return true;
    current = item.nodes.find((node) => node.id === current)?.parentId;
  }
  return false;
}

function markAnchors(preview, nodes) {
  const allText = textOf(preview);
  const links = nodes.map((node) => ({ node, range: resolveAnchor(node.anchor, allText) })).filter((entry) => entry.range);
  if (!links.length) return;
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  const textNodes = []; while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    if (!textNode.nodeValue || textNode.parentElement?.closest('.katex, .anchor-mark')) continue;
    const before = document.createRange(); before.selectNodeContents(preview); before.setEnd(textNode, 0);
    const start = before.toString().length, end = start + textNode.nodeValue.length;
    const cuts = new Set([start, end]);
    for (const link of links) if (link.range.start < end && link.range.end > start) { cuts.add(Math.max(start, link.range.start)); cuts.add(Math.min(end, link.range.end)); }
    if (!links.some((link) => link.range.start < end && link.range.end > start)) continue;
    const points = [...cuts].sort((a, b) => a - b), fragment = document.createDocumentFragment();
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index], b = points[index + 1], text = textNode.nodeValue.slice(a - start, b - start);
      const match = links.find((link) => link.range.start <= a && link.range.end >= b);
      if (!match) fragment.append(document.createTextNode(text));
      else {
        const mark = el('span', { class: 'anchor-mark', tabindex: '0', role: 'button', 'data-anchor-node': match.node.id, title: 'Open connected node', text });
        mark.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
        mark.style.borderBottomColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const open = (event) => {
          if (event.type === 'click' && !window.getSelection()?.isCollapsed) return;
          event.stopPropagation(); selectedId = match.node.id; selectedPassage = null;
          renderWorkspace(); focusSourceAndNode(selectedId);
        };
        mark.addEventListener('click', open);
        mark.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          startEdgeDrag(event, match.node, mark, true);
        });
        mark.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); open(event); } });
        fragment.append(mark);
      }
    }
    textNode.replaceWith(fragment);
  }
}

function renderOutline(item) {
  const panel = el('aside', { class: 'outline-panel', 'aria-label': 'Document outline' }, el('div', { class: 'outline-heading', text: 'OUTLINE' }));
  const headings = headingTokens(item.article.markdown);
  if (!headings.length) panel.append(el('p', { class: 'outline-empty', text: 'Add headings to see the outline.' }));
  headings.forEach((heading, index) => {
    const row = button(heading.title, () => {
      selectedId = null; editingMarkdown = false; selectedPassage = null; renderWorkspace();
      const target = document.querySelectorAll('.paper .markdown-preview h1, .paper .markdown-preview h2, .paper .markdown-preview h3, .paper .markdown-preview h4, .paper .markdown-preview h5, .paper .markdown-preview h6')[index];
      if (target) { centerOnElement(target); target.classList.add('arrived'); setTimeout(() => target.classList.remove('arrived'), 1600); }
    }, 'outline-row');
    row.style.paddingLeft = `${12 + (heading.level - 1) * 14}px`;
    panel.append(row);
  });
  return panel;
}

function refreshOutline() {
  const panel = document.querySelector('.outline-panel');
  if (panel) panel.replaceWith(renderOutline(work()));
}

function centerOnElement(element) {
  const viewport = document.querySelector('.canvas-viewport'); if (!viewport) return;
  const rect = element.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
  view.x += bounds.left + bounds.width / 2 - (rect.left + rect.width / 2);
  view.y += bounds.top + bounds.height / 2 - (rect.top + rect.height / 2);
  applyView(); saveView();
}

function renderPassageToolbar() {
  document.querySelector('.passage-toolbar')?.remove();
  if (!selectedPassage) return;
  const toolbar = el('div', { class: 'passage-toolbar' }, button('＋ Node', createAnchoredNode, 'passage-create', { 'aria-label': 'Create connected node' }), button('Ask AI', () => openAiPanel({ kind: 'ask', targetId: selectedPassage.targetId, quote: sourcePlainText(work(), selectedPassage.targetId).slice(selectedPassage.start, selectedPassage.end) }), 'passage-create'), button('×', () => { selectedPassage = null; toolbar.remove(); }, 'passage-close', { 'aria-label': 'Dismiss selection action' }));
  toolbar.style.left = `${clamp(selectedPassage.x + 12, 12, window.innerWidth - 135)}px`;
  toolbar.style.top = `${clamp(selectedPassage.y - 48, 72, window.innerHeight - 58)}px`;
  document.querySelector('.workspace-shell')?.append(toolbar);
}

function createAnchoredNode() {
  const selection = selectedPassage; if (!selection) return;
  try {
    const parentId = selection.targetId === 'article' ? null : selection.targetId;
    const item = work();
    const anchor = makeAnchor(selection.targetId, sourcePlainText(item, selection.targetId), selection.start, selection.end);
    addNode(parentId, anchor, positionForPassage(item, selection.targetId));
  }
  catch (error) { announce(error.message); }
}

function renderSettings() {
  document.querySelector('.model-settings-overlay')?.remove();
  const saved = loadModelSettings();
  const overlay = el('div', { class: 'model-settings-overlay' });
  const panel = el('section', { class: 'model-settings-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Model settings' });
  const close = () => overlay.remove();
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  panel.append(el('div', { class: 'ai-heading' }, el('h2', { text: 'Model settings' }), button('×', close, 'panel-close', { 'aria-label': 'Close settings' })));
  panel.append(el('p', { text: 'OpenAI compatible chat completions. Only the context shown before a request is sent to this endpoint. The key is encrypted locally with your passphrase and unlocked for this tab session.' }));
  const endpoint = el('input', { type: 'url', value: saved.endpoint, 'aria-label': 'API endpoint', placeholder: 'https://api.openai.com/v1' });
  const models = el('textarea', { 'aria-label': 'Models, one per line', placeholder: 'One model ID per line' }); models.value = saved.models.join('\n');
  const selected = el('input', { value: saved.selectedModel, 'aria-label': 'Selected model', placeholder: 'First listed model is used by default' });
  models.addEventListener('input', () => {
    const ids = models.value.split(/\r?\n/).map((id) => id.trim()).filter(Boolean);
    if (!ids.includes(selected.value.trim())) selected.value = ids[0] || '';
  });
  const apiKey = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New API key', placeholder: saved.secret ? 'Stored encrypted; leave blank to keep' : 'Optional for a local endpoint' });
  const passphrase = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Encryption passphrase', placeholder: 'At least 12 characters to store or unlock a key' });
  const status = el('p', { class: 'ai-status', role: 'status', text: saved.secret ? getApiKey() ? 'Key unlocked for this tab.' : 'Encrypted key is locked. Unlock before requesting.' : 'No stored key. Local endpoints may allow requests without one.' });
  panel.append(el('label', { text: 'ENDPOINT' }), endpoint, el('label', { text: 'MODELS · ONE ID PER LINE' }), models, el('label', { text: 'ACTIVE MODEL' }), selected, el('label', { text: 'API KEY' }), apiKey, el('label', { text: 'PASSPHRASE' }), passphrase, status);
  const controls = el('div', { class: 'ai-actions' });
  controls.append(button('Save settings', async () => {
    try {
      const ids = models.value.split(/\r?\n/).map((id) => id.trim()).filter(Boolean);
      if (!ids.length) throw new Error('Add at least one model ID.');
      if (!selected.value.trim()) selected.value = ids[0];
      if (!ids.includes(selected.value.trim())) throw new Error('Select a model from the list.');
      let secret = loadModelSettings().secret;
      if (apiKey.value) secret = await encryptApiKey(apiKey.value, passphrase.value);
      saveModelSettings({ endpoint: endpoint.value, models: ids, selectedModel: selected.value.trim(), secret });
      apiKey.value = ''; passphrase.value = '';
      status.textContent = 'Settings saved locally.';
      announce('Model settings saved.');
    } catch (error) { status.textContent = error.message; }
  }, 'panel-action'));
  controls.append(button('Unlock key', async () => {
    try { await unlockApiKey(loadModelSettings().secret, passphrase.value); passphrase.value = ''; status.textContent = 'Key unlocked for this tab.'; }
    catch (error) { status.textContent = error.message; }
  }, 'panel-secondary'));
  controls.append(button('Lock key', () => { lockApiKey(); status.textContent = 'Key locked.'; }, 'panel-secondary'));
  controls.append(button('Remove key', () => {
    try { const next = loadModelSettings(); next.secret = null; saveModelSettings(next); lockApiKey(); apiKey.value = ''; status.textContent = 'Stored key removed.'; }
    catch (error) { status.textContent = error.message; }
  }, 'panel-secondary'));
  panel.append(controls, el('p', { class: 'ai-muted', text: 'The endpoint and model IDs are stored in browser storage. Your key is stored only as AES-GCM ciphertext; losing the passphrase means replacing the key. Browser site data can be cleared to remove settings. Use a trusted endpoint that permits browser CORS requests.' }));
  overlay.append(panel); document.body.append(overlay); endpoint.focus();
}

function openAiPanel(next) {
  aiPanel = { ...next, proposalId: null, error: '', busy: false, messages: [] };
  if (next.kind === 'ask' && !next.quote) {
    const node = work()?.nodes.find((entry) => entry.id === next.targetId);
    aiPanel.quote = node ? `${node.title}\n${node.document?.markdown || ''}` : '';
  }
  renderAiPanel();
}

function aiProposal(item) { return item.proposals?.find((proposal) => proposal.id === aiPanel?.proposalId); }

function renderAiPanel() {
  document.querySelector('.ai-panel')?.remove();
  const item = work(); if (!item || !aiPanel) return;
  const panel = el('aside', { class: 'ai-panel', 'aria-label': aiPanel.kind === 'generate' ? 'Article draft' : aiPanel.kind === 'history' ? 'AI history' : 'Ask AI' });
  panel.append(el('div', { class: 'ai-heading' }, el('h2', { text: aiPanel.kind === 'generate' ? 'Generate article draft' : aiPanel.kind === 'history' ? 'AI history' : 'Ask AI' }), button('×', () => { aiPanel = null; panel.remove(); }, 'panel-close', { 'aria-label': 'Close AI panel' })));
  if (aiPanel.kind === 'history') {
    panel.append(el('p', { class: 'ai-muted', text: 'Saved proposals, requests, model origin, and acceptance status for this workspace.' }));
    if (!item.proposals?.length) panel.append(el('p', { text: 'No AI proposals yet.' }));
    for (const record of [...(item.proposals || [])].reverse()) panel.append(button(`${record.type === 'article-draft' ? 'Article draft' : 'Answer'} · ${record.status} · ${record.request.slice(0, 60)}`, () => { aiPanel = { kind: record.type === 'article-draft' ? 'generate' : 'ask', targetId: record.context?.targetId || 'article', quote: record.context?.quote || '', proposalId: record.id, messages: [], draft: '', error: '', busy: false }; renderAiPanel(); }, 'ai-history-item'));
    document.querySelector('.workspace-shell')?.append(panel);
    return;
  }
  const settings = loadModelSettings();
  const proposal = aiProposal(item);
  if (aiPanel.kind === 'ask') {
    const unavailable = !settings.models.length || (settings.secret && !getApiKey());
    if (unavailable) panel.append(el('p', { class: 'ai-error', text: !settings.models.length ? 'Configure an endpoint and model before using AI.' : 'Unlock your encrypted API key in Model settings.' }), button('Open model settings', renderSettings, 'panel-action'));
    const contextLabel = aiPanel.quote ? aiPanel.quote.slice(0, 180) : aiPanel.targetId === 'article' ? 'Article excerpt' : 'Selected node';
    const chatToolbar = el('div', { class: 'ai-chat-toolbar' }, el('span', { class: 'ai-chat-context', text: `Working with · ${contextLabel}` }), button('New chat', () => { aiPanel.messages = []; aiPanel.proposalId = null; aiPanel.preview = null; aiPanel.error = ''; aiPanel.draft = ''; renderAiPanel(); }, 'ai-new-chat'));
    panel.append(chatToolbar);
    const transcript = el('div', { class: 'ai-chat-messages', 'aria-live': 'polite' });
    const records = item.proposals || [];
    const messages = aiPanel.messages.length ? aiPanel.messages : (proposal ? [{ role: 'user', content: proposal.request }, { role: 'assistant', content: proposal.output, proposalId: proposal.id }] : []);
    if (!messages.length) transcript.append(el('div', { class: 'ai-chat-welcome' }, el('div', { class: 'ai-chat-welcome-mark', text: '✦' }), el('h3', { text: 'How can I help?' }), el('p', { text: 'Ask about the article, a selected passage, or one of your nodes.' })));
    for (const message of messages) {
      const bubble = el('div', { class: `ai-message ai-message-${message.role}` });
      bubble.append(el('div', { class: 'ai-message-label', text: message.role === 'user' ? 'You' : 'AskAI' }));
      if (message.role === 'assistant') {
        const answer = el('div', { class: 'ai-output markdown-preview' }); answer.innerHTML = renderMarkdown(message.content); bubble.append(answer);
        const answerProposal = records.find((record) => record.id === message.proposalId);
        if (answerProposal?.status === 'proposed') bubble.append(button('Put this in the article', () => { aiPanel.proposalId = answerProposal.id; aiPanel.preview = proposeInsertion(work().article.markdown, answerProposal.output, { kind: aiPanel.targetId === 'article' ? 'article' : 'node', quote: aiPanel.quote }); renderAiPanel(); }, 'ai-chat-action'));
        if (answerProposal?.status === 'accepted') bubble.append(el('span', { class: 'ai-message-status', text: 'Added to article' }));
      } else bubble.append(el('p', { text: message.content }));
      transcript.append(bubble);
    }
    if (aiPanel.busy) transcript.append(el('div', { class: 'ai-message ai-message-assistant ai-chat-thinking', text: 'AskAI is thinking…' }));
    panel.append(transcript);
    if (aiPanel.error) panel.append(el('p', { class: 'ai-error', role: 'alert', text: aiPanel.error }));
    const composer = el('form', { class: 'ai-chat-composer' });
    const input = el('textarea', { class: 'ai-question', 'aria-label': 'Your message', placeholder: 'Ask a question about this context…', rows: '2' });
    input.value = aiPanel.draft || '';
    input.addEventListener('input', () => { aiPanel.draft = input.value; });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); } });
    const send = button(aiPanel.busy ? 'Working…' : 'Send', () => {}, 'panel-action');
    send.type = 'submit'; send.disabled = unavailable || aiPanel.busy;
    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (aiPanel.busy) return;
      const scope = aiPanel, workspaceId = item.id, question = input.value.trim();
      if (!question) { scope.error = 'Enter a question first.'; renderAiPanel(); return; }
      scope.messages.push({ role: 'user', content: question }); scope.draft = ''; scope.busy = true; scope.error = ''; renderAiPanel();
      try {
        const config = loadModelSettings();
        const context = scope.quote || (scope.targetId === 'article' ? item.article.markdown.slice(0, 6000) : '');
        const output = await askModel(config, getApiKey(), question, { kind: scope.targetId === 'article' ? 'article excerpt' : 'node or selected passage', text: context });
        if (currentId !== workspaceId || aiPanel !== scope) return;
        const record = { id: crypto.randomUUID(), type: 'answer', status: 'proposed', request: question, context: { targetId: scope.targetId || 'article', quote: context.slice(0, 6000) }, output, model: config.selectedModel, endpoint: config.endpoint, createdAt: new Date().toISOString(), provenance: 'ai', uncertainty: 'Model output has not been source verified.' };
        change((entry) => { (entry.proposals ||= []).push(record); }, { rerender: false });
        scope.messages.push({ role: 'assistant', content: output, proposalId: record.id });
      } catch (error) { if (aiPanel === scope) scope.error = error.message; }
      finally { if (aiPanel === scope) { scope.busy = false; renderAiPanel(); } }
    });
    composer.append(input, send, el('small', { class: 'ai-chat-composer-hint', text: 'Enter to send · Shift + Enter for a new line' })); panel.append(composer);
    if (aiPanel.preview) {
      const preview = aiPanel.preview, selectedProposal = records.find((record) => record.id === aiPanel.proposalId);
      panel.append(el('h3', { text: `Review change · ${preview.location}` }), el('p', { class: 'ai-muted', text: 'Review the proposed Markdown before accepting it.' }));
      const before = el('textarea', { class: 'ai-diff', readonly: '', 'aria-label': 'Article before change' }); before.value = preview.before;
      const after = el('textarea', { class: 'ai-diff', 'aria-label': 'Proposed article Markdown' }); after.value = preview.after;
      panel.append(before, after, button('Accept article change', () => {
        if (work().article.markdown !== preview.before) { aiPanel.error = 'The article changed. Review the proposal again.'; aiPanel.preview = null; renderAiPanel(); return; }
        if (!after.value.trim() || !selectedProposal) return;
        change((entry) => { entry.article.markdown = after.value; entry.article.origins ||= []; entry.article.origins.push({ kind: 'ai', proposalId: selectedProposal.id, acceptedAt: new Date().toISOString(), model: selectedProposal.model }); entry.proposals.find((candidate) => candidate.id === selectedProposal.id).status = 'accepted'; }, { article: true });
        aiPanel.preview = null; aiPanel.proposalId = null; renderWorkspace(); announce('Article updated. Undo is available.');
      }, 'panel-action'), button('Cancel review', () => { aiPanel.preview = null; aiPanel.proposalId = null; renderAiPanel(); }, 'panel-secondary'));
    }
    document.querySelector('.workspace-shell')?.append(panel);
    if (!aiPanel.busy) requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; input.focus(); });
    return;
  }
  if (!proposal && (!settings.models.length || (settings.secret && !getApiKey()))) {
    panel.append(el('p', { class: 'ai-error', text: !settings.models.length ? 'Configure an endpoint and model before using AI.' : 'Unlock your encrypted API key in Model settings.' }), button('Open model settings', renderSettings, 'panel-action'));
  }
  if (!proposal) {
    const context = aiPanel.kind === 'generate' ? `Topic: ${item.title}` : aiPanel.quote || (aiPanel.targetId === 'article' ? 'Article (first 6,000 characters)' : 'Node');
    panel.append(el('p', { class: 'ai-muted', text: `Sent to ${settings.endpoint || 'your endpoint'} · ${settings.selectedModel || 'no model selected'}` }), el('p', { class: 'ai-context', text: context.slice(0, 700) }));
    if (aiPanel.kind === 'ask') {
      const input = el('textarea', { class: 'ai-question', 'aria-label': 'Your question', placeholder: 'What would you like to understand?' });
      input.value = aiPanel.question || '';
      input.addEventListener('input', () => { aiPanel.question = input.value; });
      panel.append(input);
      const suggestions = el('div', { class: 'ai-suggestions' });
      for (const suggestion of ['Explain this step', 'Give an example', 'What is uncertain?']) suggestions.append(button(suggestion, () => { input.value = suggestion; aiPanel.question = suggestion; input.focus(); }, 'panel-secondary'));
      panel.append(suggestions);
    }
    if (aiPanel.error) panel.append(el('p', { class: 'ai-error', role: 'alert', text: aiPanel.error }));
    const request = button(aiPanel.busy ? 'Working…' : aiPanel.kind === 'generate' ? 'Generate draft' : 'Ask', async () => {
      if (aiPanel.busy) return;
      const scope = aiPanel, workspaceId = item.id;
      const question = scope.question?.trim();
      if (scope.kind === 'ask' && !question) { scope.error = 'Enter a question first.'; renderAiPanel(); return; }
      const config = loadModelSettings();
      if (!config.models.length || (config.secret && !getApiKey())) { scope.error = 'Configure a model and unlock your key first.'; renderAiPanel(); return; }
      scope.busy = true; scope.error = ''; renderAiPanel();
      try {
        const context = scope.quote || (scope.targetId === 'article' ? item.article.markdown.slice(0, 6000) : '');
        const output = scope.kind === 'generate' ? await generateArticle(config, getApiKey(), item.title) : await askModel(config, getApiKey(), question, { kind: scope.targetId === 'article' ? 'article excerpt' : 'node or selected passage', text: context });
        if (currentId !== workspaceId || aiPanel !== scope) return;
        const record = { id: crypto.randomUUID(), type: scope.kind === 'generate' ? 'article-draft' : 'answer', status: 'proposed', request: question || item.title, context: { targetId: scope.targetId || 'article', quote: context.slice(0, 6000) }, output, model: config.selectedModel, endpoint: config.endpoint, createdAt: new Date().toISOString(), provenance: 'ai', uncertainty: 'Model output has not been source verified.' };
        change((entry) => { (entry.proposals ||= []).push(record); }, { rerender: false });
        scope.proposalId = record.id; renderAiPanel();
      } catch (error) { if (aiPanel === scope) { scope.error = error.message; renderAiPanel(); } }
      finally { scope.busy = false; }
    }, 'panel-action');
    request.disabled = aiPanel.busy || !settings.models.length || !!(settings.secret && !getApiKey());
    panel.append(request);
  } else {
    panel.append(el('p', { class: 'ai-muted', text: `${proposal.type === 'article-draft' ? 'Proposed article and outline' : 'Answer proposal'} · ${proposal.model} · ${new Date(proposal.createdAt).toLocaleString()} · ${proposal.status}` }), el('p', { class: 'ai-muted', text: proposal.uncertainty }));
    const output = el('div', { class: 'ai-output markdown-preview' }); output.innerHTML = renderMarkdown(proposal.output); panel.append(output);
    if (proposal.status === 'proposed') {
      panel.append(button(proposal.type === 'article-draft' ? 'Preview article replacement' : 'Put this in the article', () => {
        aiPanel.preview = proposal.type === 'article-draft' ? { before: work().article.markdown, after: proposal.output, location: 'Replace the full article' } : proposeInsertion(work().article.markdown, proposal.output, { kind: aiPanel.targetId === 'article' ? 'article' : 'node', quote: aiPanel.quote });
        renderAiPanel();
      }, 'panel-action'));
      if (aiPanel.preview) {
        const preview = aiPanel.preview;
        panel.append(el('h3', { text: `Review change · ${preview.location}` }), el('p', { class: 'ai-muted', text: 'Before and after Markdown. You can edit the proposed text before accepting.' }));
        const before = el('textarea', { class: 'ai-diff', readonly: '', 'aria-label': 'Article before change' }); before.value = preview.before;
        const after = el('textarea', { class: 'ai-diff', 'aria-label': 'Proposed article Markdown' }); after.value = preview.after;
        panel.append(before, after, button('Accept article change', () => {
          if (work().article.markdown !== preview.before) { aiPanel.error = 'The article changed. Review the proposal again.'; aiPanel.preview = null; renderAiPanel(); return; }
          if (!after.value.trim()) return;
          change((entry) => {
            entry.article.markdown = after.value;
            entry.article.origins ||= [];
            entry.article.origins.push({ kind: 'ai', proposalId: proposal.id, acceptedAt: new Date().toISOString(), model: proposal.model });
            entry.proposals.find((candidate) => candidate.id === proposal.id).status = 'accepted';
          }, { article: true });
          aiPanel = null; renderWorkspace(); announce('Article updated. Undo is available.');
        }, 'panel-action'));
      }
      if (aiPanel.error) panel.append(el('p', { class: 'ai-error', role: 'alert', text: aiPanel.error }));
      panel.append(button('Discard proposal', () => { change((entry) => { entry.proposals.find((candidate) => candidate.id === proposal.id).status = 'discarded'; }); aiPanel = null; renderWorkspace(); }, 'panel-secondary'));
    }
    panel.append(button('New request', () => { aiPanel = { kind: aiPanel.kind, targetId: aiPanel.targetId, quote: aiPanel.quote, proposalId: null, busy: false, error: '' }; renderAiPanel(); }, 'panel-secondary'));
  }
  document.querySelector('.workspace-shell')?.append(panel);
}

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase(), mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Escape' && document.querySelector('.save-menu')) { event.preventDefault(); closeSaveMenu(); return; }
  if (mod && key === 's') { event.preventDefault(); saveNow(); return; }
  if (!currentId) return;
  if (event.key === 'Escape' && document.querySelector('.context-menu')) { event.preventDefault(); closeContextMenu(); return; }
  if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
  if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) { event.preventDefault(); redo(); return; }
  if (mod && key === 'k' && selectedPassage) { event.preventDefault(); createAnchoredNode(); return; }
  if (event.target.closest('input, textarea, select, [contenteditable]')) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const contextId = selectedId || selectedIds.values().next().value;
    const target = contextId ? document.querySelector(`[data-node="${contextId}"]`) : document.querySelector('.paper');
    const rect = target?.getBoundingClientRect();
    if (target && rect) openContextMenu(target, rect.left + 24, rect.top + 24);
    return;
  }
  if (event.key === 'Escape') { selectedId = null; selectedIds.clear(); selectedPassage = null; renderWorkspace(); return; }
  if (event.key === 'Tab' && selectedId) { event.preventDefault(); addNode(selectedId); }
  else if (event.key === 'Enter' && selectedId) { event.preventDefault(); addNode(work().nodes.find((node) => node.id === selectedId)?.parentId || null); }
  else if (key === 'f2' && selectedId) { event.preventDefault(); beginRename(selectedId); }
  else if ((key === 'backspace' || key === 'delete') && (selectedId || selectedIds.size) && window.getSelection()?.isCollapsed) { event.preventDefault(); removeNodes(selectedId ? [selectedId] : [...selectedIds]); }
  else if (event.key === ' ' && !selectedId && !selectedIds.size) { event.preventDefault(); fitCanvas(); }
});

window.addEventListener('beforeunload', (event) => {
  if (saveMode === 'auto' && flushView()) persist(true);
  if (dirty) { event.preventDefault(); event.returnValue = ''; }
});

renderHome();
