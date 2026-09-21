import { makeAnchor, resolveAnchor, selectionOffsets } from './anchors.js';
import { createWorkspace, emptyState, loadSaveMode, loadState, saveSaveMode, saveState, snapshotWorkspace } from './storage.js';
import { renderMarkdown, headingTokens, wrapMarkdownHighlight, unwrapMarkdownHighlight } from './markdown.js';
import { nodeLabel } from './node-content.js';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/build/pdf.mjs';
import { putPdf, getPdf, deletePdf } from './source-store.js';
import { connectionPort, crossConnectionRoute, nearestConnectionSide, snappedConnectionSides } from './cross-connection.js';
import { loadModelSettings, saveModelSettings, encryptApiKey, unlockApiKey, getApiKey, lockApiKey } from './model-settings.js';
import { chatModel } from './ai.js';
import { contextSnapshot, diffMarkdownLines, MAX_CONTEXT_CHARS, proposalStatus } from './chat.js';
import { normalizeGraphFocusPreferences, relatedNodeIds } from './graph-focus.js';
import { siblingPredecessor } from './siblings.js';
import { parseProject, projectFileName, serializeProject, PROJECT_EXTENSION } from './project.js';
import { attachSourceToQuestion, compareIdeas, createResearchProposal, createResearchQuestion, discoverSources, normalizeResearch, recordCloseout, verifiedSourceFromResult } from './research.js';
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
const GRAPH_FOCUS_KEY = 'learning-canvas:graph-focus-v1';
const themes = ['auto', 'light', 'dark'];
const colors = ['violet', 'blue', 'green', 'rose', 'amber'];
let theme = localStorage.getItem(THEME_KEY) || 'auto';
let color = localStorage.getItem(COLOR_KEY) || 'violet';
let graphFocusPreferences;
try { graphFocusPreferences = normalizeGraphFocusPreferences(JSON.parse(localStorage.getItem(GRAPH_FOCUS_KEY) || '{}')); }
catch { graphFocusPreferences = normalizeGraphFocusPreferences(); }
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
let researchPanel = null;
let graphFocus = null, graphFocusNodeIds = null, spaceKeySession = null;

// Focus is a viewing mode: navigation and focus controls remain available, but
// graph records must not be changed while the related view is on screen.
function graphIsReadOnly() { return !!graphFocus; }

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
  if (graphFocus) { clearTimeout(viewTimer); viewTimer = null; return false; }
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

function closeDocumentMenu() {
  document.querySelector('.document-menu')?.remove();
  document.querySelectorAll('.document-menu-button').forEach((control) => control.setAttribute('aria-expanded', 'false'));
}

function renameWorkspace() {
  const item = work();
  const wrapper = document.querySelector('.document-menu-control');
  if (!item || !wrapper || wrapper.querySelector('.document-title-input')) return;
  closeDocumentMenu();
  const title = wrapper.querySelector('.document-menu-button');
  const input = el('input', { class: 'document-title-input', value: item.title, 'aria-label': 'Rename project', spellcheck: 'false' });
  title.replaceWith(input);
  const finish = (save = true) => {
    if (!input.isConnected) return;
    const value = input.value.trim();
    if (save && value && value !== item.title) change((workspace) => { workspace.title = value; });
    else renderWorkspace();
  };
  input.addEventListener('blur', () => finish(true), { once: true });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.focus();
  input.select();
}

function documentMenuSubmenu(label, values, current, action, format = (value) => value[0].toUpperCase() + value.slice(1)) {
  const wrapper = el('div', { class: 'document-menu-submenu' });
  const trigger = button(label, () => wrapper.classList.toggle('open'), 'document-menu-option submenu-trigger', { role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const submenu = el('div', { class: 'document-submenu', role: 'menu', 'aria-label': label });
  for (const value of values) {
    const option = button(format(value), () => action(value), 'document-menu-option', { role: 'menuitemradio', 'aria-checked': current === value });
    submenu.append(option);
  }
  let closeTimer;
  const syncExpanded = () => trigger.setAttribute('aria-expanded', String(wrapper.classList.contains('open')));
  const cancelClose = () => { clearTimeout(closeTimer); closeTimer = undefined; };
  const open = () => {
    cancelClose();
    wrapper.parentElement?.querySelectorAll('.document-menu-submenu.open').forEach((item) => {
      if (item !== wrapper) {
        item.classList.remove('open');
        item.querySelector('.submenu-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });
    wrapper.classList.add('open');
    syncExpanded();
  };
  const closeAfterPointerTravel = () => {
    cancelClose();
    closeTimer = setTimeout(() => { wrapper.classList.remove('open'); syncExpanded(); }, 400);
  };
  trigger.addEventListener('click', () => { cancelClose(); syncExpanded(); });
  wrapper.addEventListener('mouseenter', open);
  wrapper.addEventListener('mouseleave', closeAfterPointerTravel);
  wrapper.append(trigger, submenu);
  return wrapper;
}

function appendAppearanceOptions(menu) {
  menu.append(el('div', { class: 'document-menu-heading', text: 'Appearance' }));
  menu.append(documentMenuSubmenu('Mode', themes, theme, (value) => setAppearance(value, color)));
  menu.append(documentMenuSubmenu('Accent color', colors, color, (value) => setAppearance(theme, value)));
}

async function downloadProject() {
  const item = work();
  if (!item) return;
  closeDocumentMenu();
  flushView();
  const pdfBytes = new Map();
  try {
    for (const source of item.sources || []) {
      if (source.type !== 'pdf') continue;
      pdfBytes.set(source.id, await getPdf(source.id));
    }
    const contents = serializeProject(item, state.chats[item.id] || [], pdfBytes);
    if (window.lfcoreDesktop?.saveProject) {
      const saved = await window.lfcoreDesktop.saveProject(projectFileName(item.title), contents);
      if (saved) announce('Project downloaded.');
      return;
    }
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/vnd.linecoflow.project+json' }));
    const link = el('a', { href: url, download: projectFileName(item.title) });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    announce('Project downloaded.');
  } catch (error) { announce(`Project download failed: ${error.message}`); }
}

function toggleDocumentMenu(wrapper) {
  if (wrapper.querySelector('.document-menu')) return closeDocumentMenu();
  closeSaveMenu();
  closeDocumentMenu();
  const menu = el('div', { class: 'document-menu', role: 'menu', 'aria-label': 'Project options' });
  menu.append(el('div', { class: 'document-menu-heading', text: 'File' }));
  menu.append(button('Rename', renameWorkspace, 'document-menu-option', { role: 'menuitem' }));
  menu.append(button('Download project', downloadProject, 'document-menu-option', { role: 'menuitem' }));
  menu.append(documentMenuSubmenu('Saving', ['auto', 'manual'], saveMode, (value) => setSaveMode(value), (value) => value === 'auto' ? 'Auto save' : 'Manual save'));
  menu.append(el('div', { class: 'document-menu-separator', role: 'separator' }));
  appendAppearanceOptions(menu);
  wrapper.append(menu);
  wrapper.querySelector('.document-menu-button')?.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
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
  wrapper.append(button(saveLabel(), saveNow, 'save-main', { 'aria-label': 'Save status' }));
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
  if (generate) openAiPanel({ targetId: 'article', draft: `Write an introductory article about ${title.trim() || 'this topic'} with a clear outline, examples, and open questions. Replace the current working notes.` });
}

async function uploadProject(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(PROJECT_EXTENSION)) throw new Error(`Choose a ${PROJECT_EXTENSION} project file.`);
  const imported = parseProject(await file.text());
  const storedPdfIds = [];
  try {
    for (const pdf of imported.pdfs) {
      await putPdf(pdf.id, pdf.bytes.buffer);
      storedPdfIds.push(pdf.id);
    }
    state.workspaces.unshift(imported.workspace);
    state.history[imported.workspace.id] = [];
    state.redo[imported.workspace.id] = [];
    state.chats[imported.workspace.id] = imported.chats;
    if (!persist(true)) throw new Error('The project could not be saved in browser storage.');
  } catch (error) {
    state.workspaces = state.workspaces.filter((entry) => entry.id !== imported.workspace.id);
    delete state.history[imported.workspace.id]; delete state.redo[imported.workspace.id]; delete state.chats[imported.workspace.id];
    await Promise.allSettled(storedPdfIds.map((id) => deletePdf(id)));
    throw error;
  }
  openWorkspace(imported.workspace.id);
  announce('Project uploaded.');
}

function renderHome() {
  if (flushView()) persist();
  currentId = null; selectedId = null; selectedIds.clear(); selectedPassage = null; openSourceId = null;
  graphFocus = null; graphFocusNodeIds = null; spaceKeySession = null;
  const header = el('header', { class: 'home-header' }, el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: 'LF' }), el('span', { class: 'brand-name', text: 'CORE' }), el('span', { class: 'brand-company', text: 'LinecoFlow' })));
  const form = el('form', { class: 'create-form entry-form' });
  let entryMode = 'topic';
  const tabs = el('div', { class: 'entry-tabs', role: 'tablist', 'aria-label': 'Start from' });
  const input = el('input', { type: 'text', placeholder: 'What are you learning?', 'aria-label': 'Project title' });
  const pasted = el('textarea', { class: 'entry-paste', placeholder: 'Paste the original text here. It stays separate from your article.', 'aria-label': 'Pasted source text' });
  const pdf = el('input', { type: 'file', accept: '.pdf,application/pdf', class: 'entry-file', 'aria-label': 'Choose a local PDF' });
  const create = el('button', { type: 'submit', text: 'Create canvas  ↗' });
  const projectUpload = el('input', { type: 'file', accept: PROJECT_EXTENSION, class: 'project-upload-input', 'aria-label': 'Upload project' });
  const uploadProjectButton = button('Upload project', async () => {
    if (!window.lfcoreDesktop?.openProject) return projectUpload.click();
    uploadProjectButton.disabled = true;
    try {
      const opened = await window.lfcoreDesktop.openProject();
      if (opened) await uploadProject(new File([opened.contents], opened.name, { type: 'application/vnd.linecoflow.project+json' }));
    } catch (error) { announce(`Project upload failed: ${error.message}`); }
    finally { uploadProjectButton.disabled = false; }
  }, 'project-upload-button');
  projectUpload.addEventListener('change', async () => {
    uploadProjectButton.disabled = true;
    try { await uploadProject(projectUpload.files?.[0]); }
    catch (error) { announce(`Project upload failed: ${error.message}`); }
    finally { uploadProjectButton.disabled = false; projectUpload.value = ''; }
  });
  const setMode = (mode) => {
    entryMode = mode;
    input.placeholder = mode === 'topic' ? 'What are you learning?' : mode === 'paste' ? 'Project title (optional)' : 'Project title (defaults to PDF name)';
    pasted.hidden = mode !== 'paste'; pdf.hidden = mode !== 'pdf';
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  };
  for (const [mode, label] of [['topic', 'Topic'], ['paste', 'Pasted text'], ['pdf', 'Local PDF']]) tabs.append(button(label, () => setMode(mode), 'entry-tab', { role: 'tab', 'data-mode': mode, 'aria-selected': 'false' }));
  if (loadError) { input.disabled = true; pasted.disabled = true; pdf.disabled = true; create.disabled = true; uploadProjectButton.disabled = true; }
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
    for (const topic of topics) item.nodes.push({ id: crypto.randomUUID(), document: { type: 'markdown', markdown: `# ${topic.title}\n\n${topic.body}` }, parentId: null, anchor: null, collapsed: false, provenance: 'learner' });
    attachExampleAnchors(item);
    ensurePositions(item); persist(); openWorkspace(item.id);
  }, 'example-link');
  if (loadError) exampleButton.disabled = true;
  const main = el('main', { class: 'home-main' }, el('div', { class: 'home-eyebrow', text: 'YOUR WORKSPACE' }), el('h1', { text: 'Follow the shape of a thought.' }), el('p', { class: 'home-lead', text: 'Write at the center. Explore connected nodes, then return to what matters.' }), form, el('div', { class: 'home-secondary-actions' }, exampleButton, uploadProjectButton, projectUpload), el('div', { class: 'list-heading' }, el('h2', { text: 'Your canvases' })), cards);
  if (loadError) main.prepend(el('p', { class: 'error-banner', text: `${loadError} Existing data was left untouched.` }));
  app.replaceChildren(el('div', { class: 'home' }, header, main));
  updateSaveControls();
}

function deleteWorkspace(id) {
  const item = state.workspaces.find((entry) => entry.id === id);
  if (!item || !window.confirm(`Delete “${item.title}” and all its connected nodes? This cannot be undone.`)) return;
  for (const source of item.sources || []) if (source.type === 'pdf') pendingPdfDeletes.add(source.id);
  state.workspaces = state.workspaces.filter((entry) => entry.id !== id);
  delete state.history[id]; delete state.redo[id]; delete state.chats[id];
  persist(); renderHome();
}

function openWorkspace(id) {
  currentId = id; aiPanel = null; selectedId = null; selectedIds.clear(); editingMarkdown = false; selectedPassage = null; editGroup = null; openSourceId = null;
  graphFocus = null; graphFocusNodeIds = null; spaceKeySession = null;
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
    const label = nodeLabel(node);
    if (node.anchor || node.parentId || !Object.hasOwn(examplePassages, label)) continue;
    const quote = examplePassages[label], start = text.indexOf(quote);
    if (start < 0) continue;
    node.anchor = makeAnchor('article', text, start, start + quote.length);
    changed = true;
  }
  return changed;
}

function saveView() {
  clearTimeout(viewTimer);
  if (graphFocus) { viewTimer = null; return; }
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
  if (graphFocus) return fitGraphFocus();
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

function saveGraphFocusPreferences() {
  try { localStorage.setItem(GRAPH_FOCUS_KEY, JSON.stringify(graphFocusPreferences)); }
  catch { announce('Could not save the graph focus preference.'); }
}

function syncGraphFocus(item) {
  if (!graphFocus) { graphFocusNodeIds = null; return; }
  if (!item.nodes.some((node) => node.id === graphFocus.rootId)) {
    view = { ...graphFocus.beforeView };
    graphFocus = null;
    graphFocusNodeIds = null;
    spaceKeySession = null;
    return;
  }
  graphFocusNodeIds = relatedNodeIds(item, graphFocus.rootId, graphFocus.mode, graphFocus.depth);
}

function viewTransform(value) {
  return `translate(${value.x}px, ${value.y}px) scale(${value.zoom})`;
}

function focusEdgeIds(item) {
  return new Set((item?.edges || []).filter((edge) => isFocusEdge(item, edge)).map((edge) => edge.id));
}

function animateOpacity(element, from, to) {
  if (!element?.animate || Math.abs(from - to) < .001) return;
  element.animate([{ opacity: from }, { opacity: to }], { duration: 360, easing: 'cubic-bezier(.22, 1, .36, 1)' });
}

function animateGraphFocusTransition({ kind, fromView, previousNodeIds = new Set(), previousEdgeIds = new Set() }) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const scene = document.querySelector('.scene');
  if (scene?.animate && fromView) {
    scene.animate([{ transform: viewTransform(fromView) }, { transform: viewTransform(view) }], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }
  const controls = document.querySelectorAll('.workspace-chrome, .zoom-controls, .outline-panel, .details-panel, .sources-panel, .ai-panel, .passage-toolbar, .selection-toolbar');
  if (kind === 'enter') {
    for (const element of document.querySelectorAll('.focus-muted')) animateOpacity(element, 1, Number.parseFloat(getComputedStyle(element).opacity));
    for (const element of controls) animateOpacity(element, 1, Number.parseFloat(getComputedStyle(element).opacity));
    const watermark = document.querySelector('.app-watermark');
    if (watermark) animateOpacity(watermark, .115, Number.parseFloat(getComputedStyle(watermark).opacity));
    return;
  }
  if (kind === 'exit') {
    const background = [document.querySelector('.paper'), ...document.querySelectorAll('.topic-card')].filter(Boolean);
    for (const element of background) {
      if (element.dataset.node && previousNodeIds.has(element.dataset.node)) continue;
      animateOpacity(element, .1, Number.parseFloat(getComputedStyle(element).opacity));
    }
    for (const element of document.querySelectorAll('.connectors path[data-edge], .edge-label-chip')) {
      const id = element.dataset.edge || element.dataset.edgeLabel;
      if (!previousEdgeIds.has(id)) animateOpacity(element, .1, Number.parseFloat(getComputedStyle(element).opacity));
    }
    for (const element of controls) animateOpacity(element, .1, Number.parseFloat(getComputedStyle(element).opacity));
    const watermark = document.querySelector('.app-watermark');
    if (watermark) animateOpacity(watermark, .012, Number.parseFloat(getComputedStyle(watermark).opacity));
    return;
  }
  for (const card of document.querySelectorAll('.topic-card')) {
    const wasRelated = previousNodeIds.has(card.dataset.node), isRelated = graphFocusNodeIds.has(card.dataset.node);
    if (wasRelated !== isRelated) animateOpacity(card, wasRelated ? 1 : .1, isRelated ? 1 : .1);
  }
  const currentEdges = focusEdgeIds(work());
  for (const element of document.querySelectorAll('.connectors path[data-edge], .edge-label-chip')) {
    const id = element.dataset.edge || element.dataset.edgeLabel;
    const wasRelated = previousEdgeIds.has(id), isRelated = currentEdges.has(id);
    if (wasRelated !== isRelated) animateOpacity(element, wasRelated ? 1 : .1, isRelated ? 1 : .1);
  }
}

function fitGraphFocus(transition = null) {
  const viewport = document.querySelector('.canvas-viewport'), item = work();
  if (!viewport || !item || !graphFocusNodeIds?.size) return;
  const bounds = item.nodes.filter((node) => graphFocusNodeIds.has(node.id)).map((node) => pointFor(item, node.id));
  if (!bounds.length) return;
  const minX = Math.min(...bounds.map((point) => point.x));
  const maxX = Math.max(...bounds.map((point) => point.x + point.width));
  const minY = Math.min(...bounds.map((point) => point.y));
  const maxY = Math.max(...bounds.map((point) => point.y + point.height));
  const availableWidth = Math.max(240, viewport.clientWidth - (outlineOpen ? 310 : 80));
  const availableHeight = Math.max(220, viewport.clientHeight - 150);
  const width = Math.max(180, maxX - minX + 120), height = Math.max(120, maxY - minY + 120);
  view.zoom = clamp(Math.min(availableWidth / width, availableHeight / height, 1), .45, 1);
  const leftOffset = outlineOpen ? 275 : 0;
  view.x = leftOffset + availableWidth / 2 - ((minX + maxX) / 2) * view.zoom;
  view.y = 70 + availableHeight / 2 - ((minY + maxY) / 2) * view.zoom;
  applyView();
  if (transition) animateGraphFocusTransition(transition);
}

function enterGraphFocus(rootId = selectedId) {
  const item = work();
  if (!item || !rootId || selectedIds.size || !item.nodes.some((node) => node.id === rootId)) return false;
  if (flushView()) persist();
  const fromView = { ...view };
  selectedId = rootId;
  graphFocus = { rootId, ...graphFocusPreferences, beforeView: { ...view } };
  activeConnection = null;
  selectedPassage = null;
  renderWorkspace();
  fitGraphFocus({ kind: 'enter', fromView });
  return true;
}

function exitGraphFocus() {
  if (!graphFocus) return false;
  const item = work(), fromView = { ...view };
  const previousNodeIds = new Set(graphFocusNodeIds);
  const previousEdgeIds = focusEdgeIds(item);
  const beforeView = graphFocus.beforeView;
  graphFocus = null;
  graphFocusNodeIds = null;
  view = { ...beforeView };
  renderWorkspace();
  animateGraphFocusTransition({ kind: 'exit', fromView, previousNodeIds, previousEdgeIds });
  return true;
}

function updateGraphFocus(next) {
  if (!graphFocus) return;
  const fromView = { ...view };
  const previousNodeIds = new Set(graphFocusNodeIds), previousEdgeIds = focusEdgeIds(work());
  graphFocusPreferences = normalizeGraphFocusPreferences({ ...graphFocusPreferences, ...next });
  graphFocus.mode = graphFocusPreferences.mode;
  graphFocus.depth = graphFocusPreferences.depth;
  saveGraphFocusPreferences();
  renderWorkspace();
  fitGraphFocus({ kind: 'update', fromView, previousNodeIds, previousEdgeIds });
}

function focusNodeFromActions(id) {
  if (!graphFocus) return enterGraphFocus(id);
  if (graphFocus.rootId === id) return exitGraphFocus();
  const fromView = { ...view };
  const previousNodeIds = new Set(graphFocusNodeIds), previousEdgeIds = focusEdgeIds(work());
  graphFocus.rootId = id;
  selectedId = id;
  renderWorkspace();
  fitGraphFocus({ kind: 'update', fromView, previousNodeIds, previousEdgeIds });
  return true;
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
  item.highlights ||= [];
  for (const highlight of item.highlights) if (markAnchorInMarkdown(item, highlight)) changed = true;
  for (const node of item.nodes) {
    // Bring older passage links into the same edge collection as card links.
    if (node.anchor) {
      if (markAnchorInMarkdown(item, node.anchor)) changed = true;
      if (!node.anchor.id) { node.anchor.id = crypto.randomUUID(); changed = true; }
      if (!item.highlights.some((highlight) => highlight.id === node.anchor.id)) {
        item.highlights.push({ ...node.anchor }); changed = true;
      }
      const highlightId = `h:${node.anchor.id}`;
      if (!item.edges.some((edge) => edge.fromId === highlightId && edge.toId === node.id)) {
        item.edges.push({ id: crypto.randomUUID(), fromId: highlightId, toId: node.id, label: node.anchor.description ?? node.anchor.label ?? null, direction: node.anchor.direction || 'forward' });
        changed = true;
      }
      if (node.parentId !== null) { node.parentId = null; changed = true; }
      const before = item.edges.length;
      item.edges = item.edges.filter((edge) => !(edge.structural && edge.toId === node.id));
      if (item.edges.length !== before) changed = true;
      continue;
    }
    const targetId = node.parentId;
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

const isHighlightId = (id) => typeof id === 'string' && id.startsWith('h:');
const highlightFor = (item, id) => item.highlights?.find((entry) => entry.id === id?.slice(2));
const endpointExists = (item, id) => isHighlightId(id) ? !!highlightFor(item, id) : item.nodes.some((node) => node.id === id);
const endpointVisible = (item, id) => isHighlightId(id)
  ? (highlightFor(item, id)?.targetId === 'article' || !!item.nodes.find((node) => node.id === highlightFor(item, id)?.targetId && isVisible(item, node)))
  : !!item.nodes.find((node) => node.id === id && isVisible(item, node));

function markdownTarget(item, targetId) {
  return targetId === 'article' ? item.article : item.nodes.find((node) => node.id === targetId)?.document;
}

function markAnchorInMarkdown(item, anchor) {
  const target = markdownTarget(item, anchor?.targetId);
  if (!target || typeof target.markdown !== 'string') return false;
  const next = wrapMarkdownHighlight(target.markdown, anchor.quote, anchor.start);
  if (next === target.markdown) return false;
  target.markdown = next;
  return true;
}

function unmarkAnchorInMarkdown(item, anchor) {
  const target = markdownTarget(item, anchor?.targetId);
  if (!target || typeof target.markdown !== 'string') return false;
  const next = unwrapMarkdownHighlight(target.markdown, anchor.quote, anchor.start);
  if (next === target.markdown) return false;
  target.markdown = next;
  return true;
}

function endpointPoint(item, id, toward = null) {
  if (!isHighlightId(id)) return endpointExists(item, id) ? pointFor(item, id) : null;
  const highlight = highlightFor(item, id);
  if (!highlight) return null;
  const marks = [...document.querySelectorAll(`.anchor-mark[data-highlight="${highlight.id}"]`)];
  const scene = document.querySelector('.scene');
  if (!marks.length || !scene) return null;
  const origin = highlight.targetId === 'article' ? rootBounds : pointFor(item, highlight.targetId);
  const right = !toward || toward.x + toward.width / 2 >= origin.x + origin.width / 2;
  const rects = marks.flatMap((mark) => {
    const visible = mark.closest('.node-content')?.getBoundingClientRect();
    return [...mark.getClientRects()].filter((rect) => rect.width && rect.height && (!visible || (rect.bottom > visible.top && rect.top < visible.bottom)));
  });
  const line = rects.sort((a, b) => right ? b.right - a.right : a.left - b.left)[0];
  if (!line) return null;
  const bounds = scene.getBoundingClientRect();
  return { x: ((right ? line.right : line.left) - bounds.left) / view.zoom, y: (line.top + line.height / 2 - bounds.top) / view.zoom, width: 0, height: 0 };
}

function edgePoints(item, edge) {
  const fromBase = isHighlightId(edge.fromId) ? null : endpointPoint(item, edge.fromId);
  const toBase = isHighlightId(edge.toId) ? null : endpointPoint(item, edge.toId);
  return { from: fromBase || endpointPoint(item, edge.fromId, toBase), to: toBase || endpointPoint(item, edge.toId, fromBase) };
}

function renderWorkspace() {
  const item = work(); if (!item) return renderHome();
  ensureUnifiedNodeEdges(item);
  syncGraphFocus(item);
  if (graphFocus && selectedId && !graphFocusNodeIds.has(selectedId)) selectedId = graphFocus.rootId;
  if (activeConnection?.kind === 'edge') {
    const edge = item.edges.find((entry) => entry.id === activeConnection.id);
    if (!edge || !endpointVisible(item, edge.fromId) || !endpointVisible(item, edge.toId) || (graphFocus && !isFocusEdge(item, edge))) activeConnection = null;
  }
  if (selectedId) selectedIds.clear();
  else selectedIds = new Set([...selectedIds].filter((id) => item.nodes.some((node) => node.id === id && isVisible(item, node))));
  ensurePositions(item);
  const chrome = el('div', { class: 'workspace-chrome' },
    el('div', { class: 'header-left-group' },
      el('div', { class: 'header-home' },
        iconButton('M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', 'Home', renderHome)),
      el('div', { class: 'header-left' },
        iconButton('M4 5h16M4 10h11M4 15h16M4 20h11', outlineOpen ? 'Hide outline' : 'Open outline', () => { outlineOpen = !outlineOpen; saveView(); renderWorkspace(); }, outlineOpen),
        el('div', { class: 'document-menu-control' },
          button(item.title, () => toggleDocumentMenu(document.querySelector('.document-menu-control')), 'workspace-title document-menu-button', { 'aria-label': `Project options for ${item.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: item.title }),
        ),
        saveControl(),
        historyButton('undo', undo, !!state.history[item.id]?.length),
        historyButton('redo', redo, !!state.redo[item.id]?.length))),
    el('div', { class: 'header-right' },
      button('Chat', toggleAiPanel, `source-toggle ${aiPanel ? 'active' : ''}`, { 'aria-pressed': String(!!aiPanel), 'aria-label': 'Toggle chat' }),
      button('Research', toggleResearchPanel, `source-toggle ${researchPanel ? 'active' : ''}`, { 'aria-pressed': String(!!researchPanel), 'aria-label': 'Toggle research' }),
      button(`Sources${item.sources?.length ? ` ${item.sources.length}` : ''}`, () => openSource(openSourceId ? null : item.sources?.[0]?.id || 'library'), `source-toggle ${openSourceId ? 'active' : ''}`, { 'aria-pressed': String(!!openSourceId), 'aria-label': 'Toggle sources' })));

  app.replaceChildren(el('div', { class: `workspace-shell ${graphFocus ? 'graph-focus-active graph-focus-readonly' : ''}`.trim() }, renderCanvas(item), chrome));
  updateSaveControls();
  applyView();
  for (const preview of document.querySelectorAll('.markdown-preview')) {
    const targetId = preview.dataset.documentId;
    markAnchors(preview, item.highlights.filter((highlight) => highlight.targetId === targetId));
    activateMarkdownHighlightDrag(preview, targetId);
  }
  document.querySelectorAll('.topic-card').forEach(updateCardOverflow);
  document.querySelectorAll('.markdown-editor').forEach(resizeEditor);
  measurePaper();
  renderConnectionHandles(document.querySelector('.scene'), item);
  if (selectedPassage) renderPassageToolbar();
  if (aiPanel) renderAiPanel();
  if (researchPanel) renderResearchPanel();
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
  const viewport = el('main', { class: 'canvas-viewport', 'aria-label': 'Knowledge canvas', 'aria-readonly': String(graphIsReadOnly()) });
  const scene = el('div', { class: 'scene' });
  scene.append(renderPaper(item));
  scene.append(renderConnectors(item));
  for (const node of item.nodes) if (isVisible(item, node)) scene.append(renderNode(node, item));
  // Lines that meet passage marks sit above the document and cards.
  scene.append(renderAnchorConnectors(item));
  for (const edge of item.edges) {
    if (endpointVisible(item, edge.fromId) && endpointVisible(item, edge.toId)) scene.append(renderEdgeLabel(item, edge));
  }
  viewport.append(scene, el('div', { class: 'app-watermark', 'aria-hidden': 'true', text: 'LF CORE' }));
  attachPanAndZoom(viewport);
  const presets = el('div', { class: 'zoom-presets', role: 'menu', 'aria-label': 'Zoom presets' });
  const zoomMenu = el('div', { class: 'zoom-menu' }, button('100%', () => { const open = zoomMenu.classList.toggle('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', String(open)); if (open) presets.querySelector('button')?.focus(); }, 'zoom-value', { 'aria-label': 'Zoom level; choose a preset', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }), presets);
  for (const level of [50, 75, 100, 125, 150, 175]) presets.append(button(`${level}%`, () => { zoomTo(level / 100); zoomMenu.classList.remove('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', 'false'); }, 'zoom-preset', { role: 'menuitem' }));
  presets.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); zoomMenu.classList.remove('open'); zoomMenu.querySelector('.zoom-value').setAttribute('aria-expanded', 'false'); zoomMenu.querySelector('.zoom-value').focus(); } });
  const zoom = el('div', { class: 'zoom-controls' }, button('−', () => zoomTo(view.zoom - .15), '', { 'aria-label': 'Zoom out' }), zoomMenu, button('+', () => zoomTo(view.zoom + .15), '', { 'aria-label': 'Zoom in' }), el('span', { class: 'zoom-divider' }), button('Fit', fitCanvas, 'fit-button', { 'aria-label': 'Fit canvas' }));
  const shell = el('div', { class: `canvas-shell ${graphFocus ? 'graph-focus-active graph-focus-readonly' : ''}`.trim() }, viewport, zoom);
  if (outlineOpen) shell.append(renderOutline(item));
  if (!graphIsReadOnly() && !selectedId && selectedIds.size > 1) {
    shell.append(el('div', { class: 'selection-toolbar', role: 'status' }, el('span', { text: `${selectedIds.size} selected` }), button('Delete', () => removeNodes([...selectedIds]), 'selection-delete'), button('Clear', () => { selectedIds.clear(); renderWorkspace(); }, 'selection-clear')));
  }
  if (graphFocus) shell.append(renderGraphFocusToolbar(item));
  if (openSourceId) shell.append(renderSourcesPanel(item));
  return shell;
}

function renderGraphFocusToolbar(item) {
  const root = item.nodes.find((node) => node.id === graphFocus.rootId);
  const toolbar = el('div', { class: 'graph-focus-toolbar', role: 'toolbar', 'aria-label': 'Related-node focus settings' });
  const mode = el('select', { 'aria-label': 'Relationship mode', title: 'Choose which related nodes are shown' });
  for (const [value, label] of [['directional', 'Directional'], ['connected', 'Connected'], ['neighbors', 'Neighbors']]) {
    mode.append(el('option', { value, text: label }));
  }
  mode.value = graphFocus.mode;
  mode.addEventListener('change', () => updateGraphFocus({ mode: mode.value }));
  const depth = el('input', { type: 'number', min: '1', max: '20', step: '1', value: String(graphFocus.depth), 'aria-label': 'Maximum chain length', title: 'Maximum relationship hops in each direction' });
  depth.disabled = graphFocus.mode === 'neighbors';
  const applyDepth = () => updateGraphFocus({ depth: depth.value });
  depth.addEventListener('change', applyDepth);
  toolbar.append(
    el('span', { class: 'graph-focus-label', text: `Focused: ${root ? nodeLabel(root) : 'node'}`, title: root ? nodeLabel(root) : '' }),
    mode,
    el('label', { class: 'graph-focus-depth' }, el('span', { text: 'Depth' }), depth),
    button('×', exitGraphFocus, 'graph-focus-exit', { 'aria-label': 'Exit related-node focus', title: 'Exit focus · Space or Escape' })
  );
  return toolbar;
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
      const matches = (box) => [...viewport.querySelectorAll('.topic-card:not(.focus-muted)')].filter((card) => {
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
    const nodeContent = event.target.closest?.('.topic-card.selected .node-content');
    if (!event.ctrlKey && !event.metaKey && nodeContent && (nodeContent.scrollHeight > nodeContent.clientHeight || nodeContent.scrollWidth > nodeContent.clientWidth)) return;
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
  const menu = el('div', { class: 'context-menu', role: 'menu', 'aria-label': group ? 'Selection options' : node ? `${nodeLabel(node)} options` : onPaper ? 'Document options' : 'Canvas options' });
  const option = (label, action, destructive = false) => menu.append(button(label, () => { closeContextMenu(); action(); }, `context-option ${destructive ? 'destructive' : ''}`, { role: 'menuitem' }));
  if (group) {
    if (!graphIsReadOnly()) option('Delete selected nodes', () => removeNodes([...selectedIds]), true);
  } else if (node) {
    option('Show node actions', () => selectNode(node.id));
    option('Chat with node', () => openAiPanel({ targetId: node.id }));
    if (!graphIsReadOnly()) {
      option('Edit content on canvas', () => beginNodeMarkdownEdit(node.id));
      if (passage?.targetId === node.id) option('Create node from highlight', () => { selectedPassage = passage; createAnchoredNode(); });
      option('Add child', () => addNode(node.id));
      if (siblingPredecessor(item, node.id)) option('Add sibling', () => addSibling(node));
      menu.append(el('div', { class: 'context-separator', role: 'separator' }));
      option('Delete node', () => removeNode(node.id), true);
    }
  } else if (onPaper) {
    option('Chat with article', () => openAiPanel({ targetId: 'article' }));
    if (!graphIsReadOnly() && passage?.targetId === 'article') option('Create node from highlight', () => { selectedPassage = passage; createAnchoredNode(); });
    option(editingMarkdown ? 'Done editing' : 'Edit document', () => { editingMarkdown = !editingMarkdown; selectedPassage = null; renderWorkspace(); if (editingMarkdown) document.querySelector('.markdown-editor')?.focus(); });
    if (!graphIsReadOnly()) option('Add node', () => addNode(null, null, floatingPosition));
    option('Fit canvas', fitCanvas);
  } else {
    if (!graphIsReadOnly()) option('Add node', () => addNode(null, null, floatingPosition));
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
  if (!event.target.closest('.document-menu-control')) closeDocumentMenu();
  if (!event.target.closest('.zoom-menu')) {
    document.querySelector('.zoom-menu.open')?.classList.remove('open');
    document.querySelector('.zoom-value')?.setAttribute('aria-expanded', 'false');
  }
}, true);

function isNormallyVisible(item, node) {
  let parentId = node.parentId;
  while (parentId) {
    const parent = item.nodes.find((entry) => entry.id === parentId);
    if (!parent || parent.collapsed) return false;
    parentId = parent.parentId;
  }
  return true;
}

function isVisible(item, node) {
  return isNormallyVisible(item, node) || !!graphFocusNodeIds?.has(node.id);
}

function focusNodeClass(id) {
  if (!graphFocusNodeIds) return '';
  return graphFocusNodeIds.has(id) ? 'focus-related' : 'focus-muted';
}

function focusEndpointOwner(item, id) {
  if (!isHighlightId(id)) return item.nodes.some((node) => node.id === id) ? id : null;
  const targetId = highlightFor(item, id)?.targetId;
  return targetId === 'article' || item.nodes.some((node) => node.id === targetId) ? targetId : null;
}

function isFocusEdge(item, edge) {
  if (!graphFocusNodeIds) return false;
  const owners = [focusEndpointOwner(item, edge.fromId), focusEndpointOwner(item, edge.toId)];
  if (owners.includes(null)) return false;
  return owners.every((id) => id === 'article' || graphFocusNodeIds.has(id)) && owners.some((id) => graphFocusNodeIds.has(id));
}

function focusEdgeClass(item, edge) {
  if (!graphFocusNodeIds) return '';
  return isFocusEdge(item, edge) ? 'focus-related' : 'focus-muted';
}

function pointFor(item, id) {
  if (!id) return rootBounds;
  const point = item.layout.positions[id];
  return point ? { ...point, ...NODE, ...item.layout.sizes?.[id] } : rootBounds;
}

function sourceFor(item, node) {
  if (!node.anchor && node.parentId) return { point: pointFor(item, node.parentId), fromY: null, anchored: false };
  const marks = [...document.querySelectorAll(`.anchor-mark[data-highlight="${node.anchor?.id}"]`)];
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
  const focusClass = className.match(/\bfocus-(?:related|muted)\b/)?.[0] || '';
  const hit = el('path', { d: path.getAttribute('d'), class: `connector-hit ${focusClass}`.trim(), 'aria-label': graphIsReadOnly() ? 'Connection' : 'Edit connection endpoints', tabindex: '0', role: 'button' });
  const activate = (event) => { event.stopPropagation(); onClick(event); };
  hit.addEventListener('click', activate);
  hit.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); } });
  svg.append(path, hit);
  path._hit = hit;
  return path;
}

function selectConnection(kind, id) {
  if (graphIsReadOnly()) return;
  closeContextMenu();
  activeConnection = { kind, id };
  renderWorkspace();
  document.querySelector('.connection-handle')?.focus({ preventScroll: true });
}

function connectionEnd(item, id, end) {
  const edge = item.edges.find((entry) => entry.id === id);
  if (!edge) return null;
  const endpointId = end === 'from' ? edge.fromId : edge.toId;
  return { rect: edgePoints(item, edge)[end], side: edge[end === 'from' ? 'fromSide' : 'toSide'] || 'auto', endpointId };
}

function endpointAtPointer(clientX, clientY) {
  // The connector SVG and its hit paths sit above the canvas. Use all
  // elements under the pointer rather than only the topmost one, otherwise
  // dragging across a line can fail to discover the card underneath it.
  const elements = document.elementsFromPoint(clientX, clientY);
  const mark = elements.map((entry) => entry.closest?.('.anchor-mark')).find(Boolean);
  if (mark) return `h:${mark.dataset.highlight}`;
  const card = elements.map((entry) => entry.closest?.('.topic-card')).find(Boolean);
  return card?.dataset.node || null;
}

function previewConnection(item, id, end, side, replacementId = null) {
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
    const previewEdge = { ...edge, fromId, toId };
    const { from, to } = edgePoints(item, previewEdge);
    if (from && to) updateCrossRoute(path, from, to, fromSide, toSide);
    const label = document.querySelector(`[data-edge-label="${id}"]`);
    if (label) {
      placeEdgeLabel(label, item, previewEdge, fromSide, toSide);
    }
}

function renderConnectionHandles(scene, item) {
  if (graphIsReadOnly() || !activeConnection) return;
  const { id } = activeConnection;
  const ends = ['from', 'to'];
  for (const end of ends) {
    const target = connectionEnd(item, id, end);
    if (!target?.rect) continue;
    let side = target.side;
    if (side === 'auto') {
      const edge = item.edges.find((entry) => entry.id === id);
      const points = edgePoints(item, edge);
      const route = crossConnectionRoute(points.from, points.to, edge.fromSide, edge.toSide);
      side = route[end === 'from' ? 'fromSide' : 'toSide'];
    }
    const handle = button('', () => {}, 'connection-handle', { 'aria-label': `Drag ${end === 'from' ? 'first' : 'second'} endpoint to another node or highlight; arrow keys adjust node side`, title: 'Drag to a node or highlight' });
    handle.dataset.end = end;
    const position = connectionPort(target.rect, side, isHighlightId(target.endpointId) ? 0 : 8);
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
        const candidateId = next.clientX === undefined ? null : endpointAtPointer(next.clientX, next.clientY);
        const edge = item.edges.find((entry) => entry.id === id);
        const otherId = edge && end === 'from' ? edge.toId : edge?.fromId;
        replacementId = candidateId && candidateId !== otherId && candidateId !== target.endpointId &&
          !item.edges.some((candidate) => candidate.id !== id && ((candidate.fromId === candidateId && candidate.toId === otherId) || (candidate.toId === candidateId && candidate.fromId === otherId))) ? candidateId : null;
        document.querySelectorAll('.topic-card.edge-target').forEach((card) => card.classList.remove('edge-target'));
        if (replacementId && !isHighlightId(replacementId)) document.querySelector(`[data-node="${replacementId}"]`)?.classList.add('edge-target');
        const nextRect = replacementId ? endpointPoint(item, replacementId) : target.rect;
        if (!nextRect) return;
        nextSide = isHighlightId(replacementId || target.endpointId) ? 'auto' : nearestConnectionSide(nextRect, x, y);
        const port = connectionPort(nextRect, nextSide === 'auto' ? 'right' : nextSide, isHighlightId(replacementId || target.endpointId) ? 0 : 8);
        handle.style.left = `${port.x}px`; handle.style.top = `${port.y}px`;
        previewConnection(item, id, end, nextSide, replacementId);
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
            const edge = entry.edges.find((entry) => entry.id === id);
            if (replacementId) {
              const oldToId = edge.toId;
              const oldFromId = edge.fromId;
              edge[end === 'from' ? 'fromId' : 'toId'] = replacementId;
              const oldChild = entry.nodes.find((node) => node.id === oldToId);
              if (oldChild?.anchor?.id && oldFromId === `h:${oldChild.anchor.id}`) oldChild.anchor = null;
              const newChild = entry.nodes.find((node) => node.id === edge.toId);
              if (newChild && isHighlightId(edge.fromId) && !newChild.anchor) newChild.anchor = { ...highlightFor(entry, edge.fromId) };
              if (edge.structural) {
                if (oldChild?.parentId === oldFromId) oldChild.parentId = null;
                if (newChild && !isHighlightId(edge.fromId)) newChild.parentId = edge.fromId;
                else edge.structural = false;
              }
            }
            edge[end === 'from' ? 'fromSide' : 'toSide'] = nextSide;
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
      if (isHighlightId(target.endpointId)) return;
      change((entry) => {
        entry.edges.find((edge) => edge.id === id)[end === 'from' ? 'fromSide' : 'toSide'] = nextSide;
      });
      document.querySelector(`.connection-handle[data-end="${end}"]`)?.focus({ preventScroll: true });
    });
    scene.append(handle);
  }
}

function edgeMidpoint(from, to, fromSide = 'auto', toSide = 'auto') {
  const route = crossConnectionRoute(from, to, fromSide, toSide);
  // A cubic curve's midpoint is not generally halfway between its endpoints.
  // Place the description at t=.5 so it stays on the visible connection.
  return {
    x: (route.x1 + 3 * route.c1x + 3 * route.c2x + route.x2) / 8,
    y: (route.y1 + 3 * route.c1y + 3 * route.c2y + route.y2) / 8,
  };
}

function placeEdgeLabel(label, item, edge, fromSide = edge.fromSide, toSide = edge.toSide) {
  const { from, to } = edgePoints(item, edge);
  if (!from || !to) { label.style.display = 'none'; return; }
  label.style.display = '';
  const middle = edgeMidpoint(from, to, fromSide, toSide);
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
  const chip = el('div', { class: `edge-label-chip ${selected ? 'active' : ''} ${focusEdgeClass(item, edge)}`.trim(), 'data-edge-label': edge.id });
  placeEdgeLabel(chip, item, edge);
  const name = button(edge.label || '', () => {
    if (!selected) { selectConnection('edge', edge.id); return; }
    if (graphIsReadOnly()) return;
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
      const child = entry.nodes.find((node) => node.id === removed?.toId);
      if (child?.anchor?.id && removed?.fromId === `h:${child.anchor.id}`) child.anchor = null;
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
  for (const [id, color, orient] of [['arrow-forward', accent, 'auto'], ['arrow-reverse', accent, 'auto-start-reverse']]) {
    defs.append(el('marker', { id, markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient, markerUnits: 'userSpaceOnUse', viewBox: '0 0 8 8' }, el('path', { d: 'M1 1 7 4 1 7', fill: 'none', stroke: color, style: `stroke: ${color}`, 'stroke-width': '1.6', 'stroke-opacity': '.78', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
  }
  svg.append(defs);
  const edges = [...item.edges].sort((a, b) => Number(isFocusEdge(item, a)) - Number(isFocusEdge(item, b)));
  for (const edge of edges) {
    if (isHighlightId(edge.fromId) || isHighlightId(edge.toId)) continue;
    const from = item.nodes.find((node) => node.id === edge.fromId), to = item.nodes.find((node) => node.id === edge.toId);
    if (!from || !to || !isVisible(item, from) || !isVisible(item, to)) continue;
    const lineClass = `cross-line ${edgeDirection(edge) === 'both' ? '' : 'one-way'} ${focusEdgeClass(item, edge)}`.trim();
    const direction = edgeDirection(edge);
    const path = makeConnector(svg, edge.id, pointFor(item, from.id), pointFor(item, to.id), null, edge.toSide, lineClass, { 'data-edge': edge.id, ...edgeMarkerAttrs(edge) }, () => selectConnection('edge', edge.id), direction === 'both', direction === 'reverse');
    updateCrossRoute(path, pointFor(item, from.id), pointFor(item, to.id), edge.fromSide, edge.toSide);
  }
  return svg;
}

function renderAnchorConnectors(item) {
  const svg = el('svg', { class: 'connectors anchor-connectors', viewBox: '-4000 -4000 8000 8000', role: 'group', 'aria-label': 'Passage connections' });
  svg.append(el('defs'));
  const edges = [...item.edges].sort((a, b) => Number(isFocusEdge(item, a)) - Number(isFocusEdge(item, b)));
  for (const edge of edges) {
    if (!isHighlightId(edge.fromId) && !isHighlightId(edge.toId)) continue;
    if (!endpointVisible(item, edge.fromId) || !endpointVisible(item, edge.toId)) continue;
    const { from, to } = edgePoints(item, edge);
    const direction = edgeDirection(edge);
    const lineClass = `cross-line ${direction === 'both' ? '' : 'one-way'} ${focusEdgeClass(item, edge)}`.trim();
    const path = makeConnector(svg, edge.id, from || rootBounds, to || rootBounds, null, edge.toSide, lineClass, { 'data-edge': edge.id, ...edgeMarkerAttrs(edge) }, () => selectConnection('edge', edge.id), direction === 'both', direction === 'reverse');
    if (!from || !to) { path.style.display = 'none'; path._hit.style.display = 'none'; }
    else updateCrossRoute(path, from, to, edge.fromSide, edge.toSide);
  }
  return svg;
}

function updateConnectors() {
  const item = work(); if (!item) return;
  for (const edge of item.edges) {
    const path = document.querySelector(`[data-edge="${edge.id}"]`);
    const { from, to } = edgePoints(item, edge);
    if (path) {
      path.style.display = from && to ? '' : 'none';
      path._hit.style.display = from && to ? '' : 'none';
      if (from && to) updateCrossRoute(path, from, to, edge.fromSide, edge.toSide);
    }
    const label = document.querySelector(`[data-edge-label="${edge.id}"]`);
    if (label) placeEdgeLabel(label, item, edge);
  }
  positionConnectionHandles(item);
}

function positionConnectionHandles(item) {
  if (!activeConnection) return;
  const { id } = activeConnection;
  for (const handle of document.querySelectorAll('.connection-handle:not(.dragging)')) {
    const end = handle.dataset.end;
    const target = connectionEnd(item, id, end);
    if (!target?.rect) continue;
    let side = target.side;
    if (side === 'auto') {
      const edge = item.edges.find((entry) => entry.id === id);
      const points = edgePoints(item, edge);
      const route = crossConnectionRoute(points.from, points.to, edge.fromSide, edge.toSide);
      side = route[end === 'from' ? 'fromSide' : 'toSide'];
    }
    const port = connectionPort(target.rect, side, isHighlightId(target.endpointId) ? 0 : 8);
    handle.style.left = `${port.x}px`; handle.style.top = `${port.y}px`;
  }
}

function renderNode(node, item) {
  const pos = item.layout.positions[node.id];
  const label = nodeLabel(node);
  const card = el('div', { class: `topic-card ${selectedId === node.id || selectedIds.has(node.id) ? 'selected' : ''} ${focusNodeClass(node.id)}`.trim(), 'data-node': node.id, tabindex: '0', role: 'button', 'aria-label': label });
  const size = pointFor(item, node.id);
  card.style.left = `${pos.x}px`; card.style.top = `${pos.y}px`; card.style.width = `${size.width}px`; card.style.height = `${size.height}px`;
  applyNodeSizeClass(card, size.width, size.height);
  const content = el('div', { class: 'node-content markdown-preview', 'data-document-id': node.id, tabindex: '0', 'aria-label': `${label} content` });
  content.innerHTML = renderMarkdown(node.document?.markdown || '');
  content.addEventListener('mouseup', (event) => capturePassage(content, node.id, event));
  content.addEventListener('keyup', (event) => capturePassage(content, node.id, event));
  content.addEventListener('dblclick', (event) => {
    if (event.target.closest('.anchor-mark')) return;
    event.stopPropagation();
    beginNodeMarkdownEdit(node.id);
  });
  const count = item.nodes.filter((entry) => entry.parentId === node.id).length;
  const footer = count && !graphIsReadOnly() ? el('div', { class: 'topic-footer' }, button(node.collapsed ? `＋ ${count}` : `− ${count}`, (event) => { event.stopPropagation(); change((entry) => { entry.nodes.find((n) => n.id === node.id).collapsed = !node.collapsed; }); }, 'collapse-button', { 'aria-label': node.collapsed ? 'Expand children' : 'Collapse children' })) : null;
  const resize = graphIsReadOnly() ? null : button('', () => {}, 'resize-grip node-resize', { 'aria-label': `Resize ${label}`, title: 'Drag to resize; arrow keys also work' });
  const link = graphIsReadOnly() ? null : button('↔', () => {}, 'link-grip', { 'aria-label': `Connect ${label} to another node or create one`, title: 'Drag to a node to connect, or empty space to create a node' });
  link?.addEventListener('pointerdown', (event) => startEdgeDrag(event, node, link));
  link?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); event.stopPropagation();
    openLinkMenu(node.id, link);
  });
  resize?.addEventListener('pointerdown', (event) => startNodeResize(event, node, card, resize));
  resize?.addEventListener('keydown', (event) => resizeNodeWithKeys(event, node));
  card.append(content);
  if (footer) card.append(footer);
  if (link) card.append(link);
  if (resize) card.append(resize);
  if (selectedId === node.id && !graphFocus) card.append(renderNodeActions(node, item));
  card.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.node-content, .anchor-mark, button, input')) return;
    startNodeDrag(event, node, card);
  });
  card.addEventListener('click', (event) => {
    if (card._nodeDragged) { card._nodeDragged = false; return; }
    if (event.target.closest('.anchor-mark, button, input') || !window.getSelection()?.isCollapsed) return;
    selectNodeInPlace(node.id, card, node, item);
  });
  card.addEventListener('dblclick', (event) => { if (!graphIsReadOnly() && !event.target.closest('.node-content')) beginNodeMarkdownEdit(node.id); });
  card.addEventListener('keydown', (event) => { if (event.target === card && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); selectNode(node.id); } });
  return card;
}

function renderNodeActions(node, item) {
  const toolbar = el('div', { class: 'node-actions', role: 'toolbar', 'aria-label': `${nodeLabel(node)} actions` });
  const canAddSibling = !!siblingPredecessor(item, node.id);
  const primary = el('div', { class: 'node-actions-row' },
    ...(graphIsReadOnly() ? [] : [
      button('Edit', () => beginNodeMarkdownEdit(node.id), 'node-action primary', { title: 'Edit Markdown on the card' }),
      button('＋ Child', () => addNode(node.id), 'node-action'),
      ...(canAddSibling ? [button('＋ Sibling', () => addSibling(node), 'node-action')] : []),
    ]),
    button('Chat', () => openAiPanel({ targetId: node.id }), 'node-action'));
  toolbar.append(primary);

  const contextual = el('div', { class: 'node-actions-row secondary' });
  const focusLabel = graphFocus?.rootId === node.id ? 'Exit focus' : graphFocus ? 'Refocus' : 'Focus';
  contextual.append(button(focusLabel, () => focusNodeFromActions(node.id), 'node-action', {
    title: graphFocus?.rootId === node.id ? 'Restore the full graph' : 'Show this node and its related graph'
  }));
  if (node.anchor) {
    const anchorRange = resolveAnchor(node.anchor, sourcePlainText(item, node.anchor.targetId));
    contextual.append(button(anchorRange ? '↗ Passage' : 'Repair link', () => anchorRange ? goToPassage(node) : reconnect(node), `node-action ${anchorRange ? '' : 'warning'}`, {
      title: anchorRange ? `Go to linked passage: “${shortTitle(node.anchor.quote)}”` : 'Reconnect this node to the selected passage'
    }));
  }
  if (node.sourceRefs?.length) {
    const sources = el('div', { class: 'node-source-control' });
    const menu = el('div', { class: 'node-source-menu', role: 'menu', 'aria-label': 'Node sources' });
    const toggle = button(`Sources ${node.sourceRefs.length}`, () => {
      const open = sources.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('button')?.focus();
    }, 'node-action', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    for (const reference of node.sourceRefs) {
      const source = item.sources?.find((entry) => entry.id === reference.sourceId);
      menu.append(button(`${source?.title || 'Missing source'}${reference.page ? ` · p. ${reference.page}` : ''}`, () => openSource(reference.sourceId, reference.page || 1, reference.anchor), 'node-source-item', {
        role: 'menuitem', title: `Open original passage: “${shortTitle(reference.anchor.quote)}”`
      }));
    }
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      sources.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    });
    sources.append(toggle, menu);
    contextual.append(sources);
  }
  if (!graphIsReadOnly()) contextual.append(button(item.nodes.some((entry) => entry.parentId === node.id) ? 'Delete branch' : 'Delete', () => removeNode(node.id), 'node-action destructive'));
  toolbar.append(contextual);
  return toolbar;
}

function openLinkMenu(sourceId, grip) {
  closeContextMenu();
  const item = work();
  const candidates = [
    ...item.nodes.map((node) => ({ id: node.id, title: nodeLabel(node) })),
    ...item.highlights.map((highlight) => ({ id: `h:${highlight.id}`, title: `“${shortTitle(highlight.quote)}”` })),
  ];
  const available = candidates.filter((candidate) => candidate.id !== sourceId &&
    !item.edges.some((edge) => (edge.fromId === sourceId && edge.toId === candidate.id) || (edge.toId === sourceId && edge.fromId === candidate.id)));
  if (!available.length && !isHighlightId(sourceId)) return announce('No unconnected endpoints are available.');
  const menu = el('div', { class: 'context-menu', role: 'menu', 'aria-label': 'Connect endpoint' });
  for (const candidate of available) menu.append(button(`Connect to ${candidate.title}`, () => {
    closeContextMenu();
    const points = edgePoints(item, { fromId: sourceId, toId: candidate.id });
    const sides = points.from && points.to ? snappedConnectionSides(points.from, points.to) : {};
    change((entry) => { entry.edges.push({ id: crypto.randomUUID(), fromId: sourceId, toId: candidate.id, label: null, direction: 'forward', ...sides }); });
    announce('Connected. Select the line to edit its relationship.');
  }, 'context-option', { role: 'menuitem' }));
  if (isHighlightId(sourceId)) {
    menu.append(el('div', { class: 'context-separator', role: 'separator' }));
    menu.append(button('Remove highlight', () => {
      closeContextMenu();
      change((entry) => {
        const highlight = highlightFor(entry, sourceId);
        if (highlight) unmarkAnchorInMarkdown(entry, highlight);
        entry.highlights = entry.highlights.filter((highlight) => `h:${highlight.id}` !== sourceId);
        entry.edges = entry.edges.filter((edge) => edge.fromId !== sourceId && edge.toId !== sourceId);
        for (const node of entry.nodes) if (node.anchor?.id && `h:${node.anchor.id}` === sourceId) node.anchor = null;
      });
    }, 'context-option destructive', { role: 'menuitem' }));
  }
  document.querySelector('.workspace-shell')?.append(menu);
  const rect = grip.getBoundingClientRect();
  menu.style.left = `${clamp(rect.left, 8, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${clamp(rect.bottom + 4, 8, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector('button')?.focus();
}

function startEdgeDrag(event, node, grip, preserveClick = false, prepareSource = null) {
  if (graphIsReadOnly() || event.button !== 0) return;
  if (!preserveClick) event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const scene = document.querySelector('.scene');
  const sourceId = typeof node === 'string' ? node : node.id;
  const layer = document.querySelector(isHighlightId(sourceId) ? '.anchor-connectors' : '.connectors');
  const preview = el('path', { class: 'edge-preview', 'marker-end': 'url(#arrow-forward)' });
  const snapPort = el('circle', { class: 'edge-preview-port', r: '5' });
  layer.append(preview, snapPort);
  grip.setPointerCapture?.(event.pointerId);
  let target = null, destination = null, moved = false, sides = {};
  const move = (next) => {
    if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
    if (!moved) { prepareSource?.(); window.getSelection()?.removeAllRanges(); moved = true; }
    const rect = scene.getBoundingClientRect();
    destination = { x: (next.clientX - rect.left) / view.zoom, y: (next.clientY - rect.top) / view.zoom, width: 0, height: 0 };
    const hoveredId = endpointAtPointer(next.clientX, next.clientY);
    const nextId = hoveredId === sourceId ? null : hoveredId;
    if (target !== nextId) {
      if (target && !isHighlightId(target)) document.querySelector(`[data-node="${target}"]`)?.classList.remove('edge-target');
      target = nextId;
      if (target && !isHighlightId(target)) document.querySelector(`[data-node="${target}"]`)?.classList.add('edge-target');
    }
    const item = work();
    const points = target ? edgePoints(item, { fromId: sourceId, toId: target }) : { from: endpointPoint(item, sourceId, destination), to: destination };
    if (!points.from || !points.to) return;
    sides = snappedConnectionSides(points.from, points.to, target && !isHighlightId(target) ? destination : null);
    const route = crossConnectionRoute(points.from, points.to, sides.fromSide, sides.toSide);
    preview.setAttribute('d', route.d);
    snapPort.setAttribute('cx', route.x2); snapPort.setAttribute('cy', route.y2);
  };
  const finish = (next) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
    if (target && !isHighlightId(target)) document.querySelector(`[data-node="${target}"]`)?.classList.remove('edge-target');
    preview.remove(); snapPort.remove();
    if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    if (next.type !== 'pointerup' || !destination || !moved) return;
    const item = work();
    if (target && item.edges.some((edge) => (edge.fromId === sourceId && edge.toId === target) || (edge.fromId === target && edge.toId === sourceId))) return announce('These endpoints are already connected.');
    if (!target) {
      const newRect = { x: destination.x - NODE.width / 2, y: destination.y - NODE.height / 2, ...NODE };
      const from = endpointPoint(item, sourceId, newRect);
      if (from) sides = snappedConnectionSides(from, newRect);
    }
    change((entry) => {
      let newId = target;
      if (!newId) {
        newId = crypto.randomUUID();
        const sourceHighlight = isHighlightId(sourceId) ? highlightFor(entry, sourceId) : null;
        entry.nodes.push({ id: newId, parentId: null, document: { type: 'markdown', markdown: '' }, anchor: sourceHighlight ? { ...sourceHighlight } : null, collapsed: false, provenance: 'learner' });
        entry.layout.positions[newId] = { x: destination.x - NODE.width / 2, y: destination.y - NODE.height / 2 };
      }
      const incoming = entry.edges.some((edge) => edge.toId === newId) || entry.nodes.some((candidate) => candidate.id === newId && candidate.parentId);
      entry.edges.push({ id: crypto.randomUUID(), fromId: sourceId, toId: newId, label: null, direction: incoming ? 'both' : 'forward', ...sides });
    });
    selectedId = target && !isHighlightId(target) ? target : null;
    announce(target ? 'Endpoints connected.' : 'Node created and connected.');
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
  if (graphIsReadOnly() || event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const item = work(), original = { ...pointFor(item, node.id) }, x = event.clientX, y = event.clientY;
  grip.setPointerCapture(event.pointerId);
  const move = (next) => {
    const width = clamp(Math.round(original.width + (next.clientX - x) / view.zoom), 170, 680);
    const height = Math.max(100, Math.round(original.height + (next.clientY - y) / view.zoom));
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
  if (graphIsReadOnly()) return;
  const steps = { ArrowRight: [20, 0], ArrowLeft: [-20, 0], ArrowDown: [0, 20], ArrowUp: [0, -20] };
  const step = steps[event.key]; if (!step) return;
  event.preventDefault(); event.stopPropagation();
  change((item) => {
    const size = pointFor(item, node.id);
    item.layout.sizes[node.id] = { width: clamp(size.width + step[0], 170, 680), height: Math.max(100, size.height + step[1]) };
  });
  document.querySelector(`[data-node="${node.id}"] .node-resize`)?.focus();
}

function startNodeDrag(event, node, card) {
  if (graphIsReadOnly() || event.button !== 0) return;
  const item = work(), moving = selectedIds.has(node.id) ? [...selectedIds] : [node.id];
  const original = Object.fromEntries(moving.map((id) => [id, { ...item.layout.positions[id] }]));
  const originX = event.clientX, originY = event.clientY;
  let moved = false, ended = false;
  const move = (next) => {
    if (!moved && Math.hypot(next.clientX - originX, next.clientY - originY) < 5) return;
    if (!moved) {
      moved = true;
      card._nodeDragged = true;
      event.preventDefault();
      card.setPointerCapture?.(event.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    const dx = Math.round((next.clientX - originX) / view.zoom), dy = Math.round((next.clientY - originY) / view.zoom);
    for (const id of moving) {
      const position = { x: original[id].x + dx, y: original[id].y + dy };
      item.layout.positions[id] = position;
      const element = document.querySelector(`[data-node="${id}"]`);
      if (element) { element.style.left = `${position.x}px`; element.style.top = `${position.y}px`; }
    }
    updateConnectors();
  };
  const up = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (card.hasPointerCapture?.(event.pointerId)) card.releasePointerCapture(event.pointerId);
    if (!moved) return;
    const final = Object.fromEntries(moving.map((id) => [id, { ...item.layout.positions[id] }]));
    for (const id of moving) item.layout.positions[id] = original[id];
    if (moving.some((id) => final[id].x !== original[id].x || final[id].y !== original[id].y)) {
      change((entry) => { for (const id of moving) entry.layout.positions[id] = final[id]; });
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function selectNodeInPlace(id, card, node, item) {
  selectedId = id;
  selectedIds.clear();
  selectedPassage = null;
  editGroup = null;
  document.querySelectorAll('.topic-card').forEach((entry) => {
    entry.classList.toggle('selected', entry === card);
    entry.querySelector('.node-actions')?.remove();
  });
  if (!graphFocus) card.append(renderNodeActions(node, item));
}

function selectNode(id) { selectedId = id; selectedIds.clear(); selectedPassage = null; editGroup = null; renderWorkspace(); }

function beginNodeMarkdownEdit(id) {
  if (graphIsReadOnly()) return;
  const item = work();
  const node = item?.nodes.find((entry) => entry.id === id);
  const card = document.querySelector(`[data-node="${id}"]`);
  if (!node || !card) return;
  const preview = card.querySelector('.node-content');
  if (!preview || preview.querySelector('.node-markdown-editor')) return;
  const editor = el('textarea', { class: 'node-markdown-editor', 'aria-label': `${nodeLabel(node)} Markdown`, spellcheck: 'true' });
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
  editor.style.height = '100%';
}

function addSibling(node) {
  if (graphIsReadOnly()) return;
  const item = work();
  if (!item || !node) return;
  const predecessor = siblingPredecessor(item, node.id);
  if (!predecessor) return announce('A sibling needs exactly one one-way connection leading into this node.');

  const { edge, predecessorId } = predecessor;
  const sourceHighlight = isHighlightId(predecessorId) ? highlightFor(item, predecessorId) : null;
  const anchor = sourceHighlight ? { ...sourceHighlight } : null;
  const structural = !!edge.structural && !sourceHighlight;
  const currentPosition = item.layout.positions[node.id];
  const position = currentPosition
    ? { x: currentPosition.x, y: currentPosition.y + (item.layout.sizes[node.id]?.height || NODE.height) + 24 }
    : suggestedPosition(item, structural ? predecessorId : null);
  const newNode = {
    id: crypto.randomUUID(),
    parentId: structural ? predecessorId : null,
    document: { type: 'markdown', markdown: anchor ? `# ${shortTitle(anchor.quote)}` : '' },
    anchor,
    collapsed: false,
    provenance: 'learner'
  };

  change((entry) => {
    if (anchor) {
      markAnchorInMarkdown(entry, anchor);
      entry.highlights ||= [];
      if (!entry.highlights.some((highlight) => highlight.id === anchor.id)) entry.highlights.push({ ...anchor });
    }
    entry.nodes.push(newNode);
    entry.layout.positions[newNode.id] = position;
    const points = edgePoints(entry, { fromId: predecessorId, toId: newNode.id });
    const sides = points.from && points.to ? snappedConnectionSides(points.from, points.to) : {};
    entry.edges.push({
      id: crypto.randomUUID(),
      fromId: predecessorId,
      toId: newNode.id,
      label: edge.label ?? null,
      direction: 'forward',
      ...(structural ? { structural: true } : {}),
      ...sides
    });
  });
  selectedPassage = null; selectedId = newNode.id; editingMarkdown = false; renderWorkspace();
  if (anchor) focusSourceAndNode(newNode.id);
  else focusNode(newNode.id);
  beginNodeMarkdownEdit(newNode.id);
}

function addNode(parentId = null, anchor = null, preferredPosition = null) {
  if (graphIsReadOnly()) return;
  const item = work(); if (!item) return;
  const node = { id: crypto.randomUUID(), parentId: parentId ?? null, document: { type: 'markdown', markdown: anchor ? `# ${shortTitle(anchor.quote)}` : '' }, anchor, collapsed: false, provenance: 'learner' };
  const position = preferredPosition || suggestedPosition(item, parentId);
  change((entry) => {
    if (anchor) {
      markAnchorInMarkdown(entry, anchor);
      entry.highlights ||= [];
      entry.edges ||= [];
      if (!entry.highlights.some((highlight) => highlight.id === anchor.id)) entry.highlights.push({ ...anchor });
      if (!entry.edges.some((edge) => edge.fromId === `h:${anchor.id}` && edge.toId === node.id)) {
        entry.edges.push({ id: crypto.randomUUID(), fromId: `h:${anchor.id}`, toId: node.id, label: anchor.description ?? anchor.label ?? null, direction: anchor.direction || 'forward' });
      }
    }
    entry.nodes.push(node); entry.layout.positions[node.id] = position;
  });
  selectedPassage = null; selectedId = node.id; editingMarkdown = false; renderWorkspace();
  if (anchor) focusSourceAndNode(node.id);
  else focusNode(node.id);
  beginNodeMarkdownEdit(node.id);
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
  const left = outlineOpen ? 280 : 32, right = 32, top = 80, bottom = 105;
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
  if (graphIsReadOnly()) return;
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
    const removedHighlights = new Set(entry.highlights.filter((highlight) => removed.has(highlight.targetId)).map((highlight) => `h:${highlight.id}`));
    entry.highlights = entry.highlights.filter((highlight) => !removedHighlights.has(`h:${highlight.id}`));
    entry.edges = entry.edges.filter((edge) => !removed.has(edge.fromId) && !removed.has(edge.toId) && !removedHighlights.has(edge.fromId) && !removedHighlights.has(edge.toId));
    for (const nodeId of removed) { delete entry.layout.positions[nodeId]; delete entry.layout.sizes[nodeId]; }
  });
  selectedId = roots.length === 1 && !removed.has(roots[0].parentId) ? roots[0].parentId : null;
  selectedIds.clear(); selectedPassage = null;
  renderWorkspace(); announce(`${removed.size} node${removed.size === 1 ? '' : 's'} deleted. Undo is available.`);
}

function openSource(id, page = 1, anchor = null) {
  // Chat and Sources are mutually exclusive workspace panels. Opening one
  // always turns the other one off; clicking the active menu item passes null
  // and simply closes it.
  if (id !== null) { aiPanel = null; researchPanel = null; }
  openSourceId = id;
  sourcePage = page;
  sourceJump = anchor;
  renderWorkspace();
}

function toggleAiPanel() {
  if (aiPanel) {
    aiPanel = null;
    renderWorkspace();
    return;
  }
  researchPanel = null;
  openSourceId = null;
  openAiPanel();
}

function selectedResearchContext(item) {
  const ids = selectedId ? [selectedId] : [...selectedIds];
  if (selectedPassage?.targetId && selectedPassage.targetId !== 'article' && !ids.includes(selectedPassage.targetId)) ids.push(selectedPassage.targetId);
  return { targetIds: ids, quote: selectedPassage?.quote || '' };
}

function toggleResearchPanel() {
  if (researchPanel) { researchPanel = null; renderWorkspace(); return; }
  const item = work(); if (!item) return;
  normalizeResearch(item);
  const context = selectedResearchContext(item);
  const suggested = context.quote ? `What should I verify about “${shortTitle(context.quote)}”?` : '';
  researchPanel = { tab: 'questions', questionId: item.research.questions.find((question) => question.status === 'open')?.id || null, draftQuestion: suggested, query: '', results: [], error: '', loading: false, ideaIds: new Set(context.targetIds) };
  aiPanel = null; openSourceId = null;
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
  const node = { id: crypto.randomUUID(), document: { type: 'markdown', markdown: `# ${shortTitle(reference.anchor.quote)}\n\n> ${reference.anchor.quote.replace(/\n/g, '\n> ')}` }, parentId: null, anchor: null, sourceRefs: [reference], collapsed: false, provenance: 'source' };
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
    for (const node of nodes) chooser.append(el('option', { value: node.id, text: nodeLabel(node) }));
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
  for (const source of item.sources || []) sidebar.append(button(`${source.type === 'pdf' ? '▤' : source.type === 'web' ? '↗' : '≡'}  ${source.title}`, () => openSource(source.id), `source-list-item ${source.id === openSourceId ? 'active' : ''}`));
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
  const description = source.type === 'pdf' ? `${source.pages} page PDF · stored locally`
    : source.type === 'web' ? `Metadata verified via ${source.discovery?.provider || 'source discovery'} · ${source.publishedAt || 'date unknown'}`
      : 'Pasted text · stored locally';
  body.append(el('div', { class: 'source-reader-heading' }, el('strong', { text: source.title }), el('small', { text: description })));
  const actions = el('div', { class: 'source-selection-actions', 'aria-live': 'polite' });
  body.append(actions);
  if (source.type === 'web') {
    const card = el('article', { class: 'web-source-card' });
    card.append(el('div', { class: 'research-badge verified', text: '✓ Metadata verified' }));
    if (source.authors?.length) card.append(el('p', { text: source.authors.join(', ') }));
    if (source.venue) card.append(el('p', { text: `${source.venue}${source.publishedAt ? ` · ${source.publishedAt}` : ''}` }));
    card.append(el('p', { class: 'ai-muted', text: 'Verification confirms that this provider record exists. It does not confirm that the source supports a particular claim; inspect the original before consolidating a finding.' }));
    card.append(el('a', { class: 'panel-action source-external-link', href: source.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open original source ↗' }));
    if (source.openAccessUrl && source.openAccessUrl !== source.url) card.append(el('a', { class: 'panel-secondary source-external-link', href: source.openAccessUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Open accessible copy ↗' }));
    body.append(card);
    return;
  }
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
  const mark = document.querySelector(`.anchor-mark[data-highlight="${node.anchor?.id}"]`);
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
    const anchor = { ...makeAnchor(targetId, sourcePlainText(work(), targetId), selectedPassage.start, selectedPassage.end), id: node.anchor?.id || crypto.randomUUID() };
    change((entry) => {
      const target = entry.nodes.find((n) => n.id === node.id);
      if (target.anchor) unmarkAnchorInMarkdown(entry, target.anchor);
      target.anchor = anchor; target.parentId = null;
      const index = entry.highlights.findIndex((highlight) => highlight.id === anchor.id);
      if (index >= 0) entry.highlights[index] = { ...anchor };
      else entry.highlights.push({ ...anchor });
      markAnchorInMarkdown(entry, anchor);
    });
    selectedPassage = null; announce('Passage reconnected.');
  } catch (error) { announce(error.message); }
}

function renderPaper(item) {
  const paper = el('article', { class: `paper ${graphFocus ? 'focus-muted' : ''}`.trim(), 'aria-label': 'Document' });
  paper.style.left = `${ROOT.x}px`; paper.style.top = `${ROOT.y}px`;
  paper.style.width = `${item.layout.articleSize.width}px`;
  paper.style.minHeight = `${item.layout.articleSize.minHeight}px`;
  paper.append(el('div', { class: 'paper-heading' }, el('span', { class: 'paper-label', text: 'master article' }), button('Chat about article', () => openAiPanel({ targetId: 'article' }), 'paper-ai-action')));
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

function markAnchors(preview, highlights) {
  const allText = textOf(preview);
  const links = highlights.map((highlight) => ({ highlight, range: resolveAnchor(highlight, allText) })).filter((entry) => entry.range);
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
        const item = work();
        const link = item.edges.find((edge) => edge.fromId === `h:${match.highlight.id}` || edge.toId === `h:${match.highlight.id}`);
        const linkedNode = item.nodes.find((node) => node.anchor?.id === match.highlight.id);
        const mark = el('span', { class: 'anchor-mark', tabindex: '0', role: 'button', 'data-highlight': match.highlight.id, ...(linkedNode ? { 'data-anchor-node': linkedNode.id } : {}), title: 'Click to edit connections', text });
        mark.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
        mark.style.borderBottomColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const open = (event) => {
          if (event.type === 'click' && !window.getSelection()?.isCollapsed) return;
          event.stopPropagation(); selectedPassage = null;
          if (link) selectConnection('edge', link.id);
        };
        mark.addEventListener('click', open);
        mark.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          startEdgeDrag(event, `h:${match.highlight.id}`, mark);
        });
        mark.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); open(event); }
        });
        fragment.append(mark);
      }
    }
    textNode.replaceWith(fragment);
  }
}

function activateMarkdownHighlightDrag(preview, targetId) {
  for (const mark of preview.querySelectorAll('.markdown-highlight')) {
    if (mark.querySelector('.anchor-mark')) continue;
    const before = document.createRange(); before.selectNodeContents(preview); before.setEnd(mark, 0);
    const plain = textOf(preview), start = before.toString().length, end = start + textOf(mark).length;
    const anchor = makeAnchor(targetId, plain, start, end);
    let registered = false;
    const register = () => {
      if (registered) return;
      change((item) => { (item.highlights ||= []).push(anchor); }, { rerender: false });
      registered = true;
      mark.classList.add('anchor-mark');
      mark.dataset.highlight = anchor.id;
    };
    mark.classList.add('connectable-highlight');
    mark.title = 'Drag to connect; drop on empty canvas to create a node';
    mark.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      startEdgeDrag(event, `h:${anchor.id}`, mark, false, register);
    });
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
  const actions = graphIsReadOnly() ? [] : [button('＋ Node', createAnchoredNode, 'passage-create', { 'aria-label': 'Create connected node' }), button('Highlight', createHighlight, 'passage-create', { 'aria-label': 'Save highlight for connections' })];
  actions.push(button('Chat', () => openAiPanel({ targetId: selectedPassage.targetId, quote: sourcePlainText(work(), selectedPassage.targetId).slice(selectedPassage.start, selectedPassage.end) }), 'passage-create'));
  actions.push(button('×', () => { selectedPassage = null; toolbar.remove(); }, 'passage-close', { 'aria-label': 'Dismiss selection action' }));
  const toolbar = el('div', { class: 'passage-toolbar' }, actions);
  toolbar.style.left = `${clamp(selectedPassage.x + 12, 12, window.innerWidth - 135)}px`;
  toolbar.style.top = `${clamp(selectedPassage.y - 48, 72, window.innerHeight - 58)}px`;
  document.querySelector('.workspace-shell')?.append(toolbar);
}

function createAnchoredNode() {
  if (graphIsReadOnly()) return;
  const selection = selectedPassage; if (!selection) return;
  try {
    const item = work();
    const existing = item.highlights.find((highlight) => highlight.targetId === selection.targetId && highlight.start === selection.start && highlight.end === selection.end);
    const anchor = { ...(existing || makeAnchor(selection.targetId, sourcePlainText(item, selection.targetId), selection.start, selection.end)) };
    addNode(null, anchor, positionForPassage(item, selection.targetId));
  }
  catch (error) { announce(error.message); }
}

function createHighlight() {
  if (graphIsReadOnly()) return;
  const selection = selectedPassage; if (!selection) return;
  try {
    const item = work();
    const existing = item.highlights.find((highlight) => highlight.targetId === selection.targetId && highlight.start === selection.start && highlight.end === selection.end);
    if (existing) { selectedPassage = null; renderWorkspace(); return announce('This passage is already highlighted. Drag its highlight to connect it.'); }
    const anchor = makeAnchor(selection.targetId, sourcePlainText(item, selection.targetId), selection.start, selection.end);
    selectedPassage = null;
    change((entry) => { markAnchorInMarkdown(entry, anchor); (entry.highlights ||= []).push(anchor); });
    announce('Highlight saved as ==marked text==. Drag it to a node or another highlight to connect.');
  } catch (error) { announce(error.message); }
}

function renderSettings(container = null) {
  document.querySelector('.model-settings-overlay')?.remove();
  const saved = loadModelSettings();
  const overlay = container ? null : el('div', { class: 'model-settings-overlay' });
  const panel = el('section', { class: `model-settings-card ${container ? 'chat-settings' : ''}`, ...(container ? {} : { role: 'dialog', 'aria-modal': 'true' }), 'aria-label': 'Model settings' });
  const close = () => { if (container) { aiPanel.tab = 'chat'; renderAiPanel(); } else overlay.remove(); };
  overlay?.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  if (!container) panel.append(el('div', { class: 'ai-heading' }, el('h2', { text: 'Model settings' }), button('×', close, 'panel-close', { 'aria-label': 'Close settings' })));
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
  if (container) container.append(panel);
  else { overlay.append(panel); document.body.append(overlay); endpoint.focus(); }
}

function chatList() { return state.chats[currentId] ||= []; }

function currentChat() { return chatList().find((chat) => chat.id === aiPanel?.chatId); }

function newChat(seed = {}) {
  const nodeIds = seed.targetId && seed.targetId !== 'article' ? [seed.targetId]
    : selectedIds.size ? [...selectedIds] : selectedId ? [selectedId] : [];
  const mode = seed.targetId === 'article' || (!seed.targetId && !nodeIds.length) ? 'article' : 'selected';
  const passage = seed.quote && seed.targetId ? { targetId: seed.targetId, quote: seed.quote } : null;
  const now = new Date().toISOString();
  const chat = { id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now,
    context: { mode, nodeIds, passage }, messages: [] };
  chatList().push(chat);
  persist();
  aiPanel = { chatId: chat.id, tab: 'chat', draft: seed.draft || '', busy: false, error: '', previewId: null, width: aiPanel?.width };
  renderAiPanel();
}

function openAiPanel(seed = null) {
  if (!work()) return;
  // Opening Chat from any entry point also closes Sources, not just the
  // top-right toggle, so there can only be one workspace panel visible.
  openSourceId = null;
  if (seed || selectedId || selectedIds.size || !chatList().length) {
    newChat(seed || {});
    renderWorkspace();
    return;
  }
  const chat = [...chatList()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  aiPanel = { chatId: chat.id, tab: 'chat', draft: '', busy: false, error: '', previewId: null, width: aiPanel?.width };
  renderWorkspace();
}

function getChatProposal(id) {
  for (const message of currentChat()?.messages || []) {
    const proposal = message.proposals?.find((entry) => entry.id === id);
    if (proposal) return proposal;
  }
  return null;
}

function changeChatContext(update) {
  const chat = currentChat(); if (!chat) return;
  update(chat.context);
  if (chat.context.passage && !contextSnapshot(work(), chat.context).passage) chat.context.passage = null;
  chat.updatedAt = new Date().toISOString();
  persist(); renderAiPanel();
}

function renderContextPicker(item, chat) {
  const snapshot = contextSnapshot(item, chat.context);
  const mode = chat.context.mode || (chat.context.article ? 'article' : 'selected');
  const liveSelection = selectedId ? [selectedId] : [...selectedIds];
  const availableSelected = liveSelection.length ? liveSelection : chat.context.nodeIds || [];
  const picker = el('select', { class: 'chat-context-select', 'aria-label': 'Context scope', title: `${snapshot.size.toLocaleString()} / ${MAX_CONTEXT_CHARS.toLocaleString()} context characters` });
  for (const [value, label] of [['article', 'Master article'], ['selected', 'Selected nodes'], ['all', 'All']]) {
    const choice = el('option', { value, text: label });
    if (value === 'selected' && !availableSelected.length) choice.disabled = true;
    picker.append(choice);
  }
  picker.value = mode;
  picker.addEventListener('change', () => changeChatContext((context) => {
    context.mode = picker.value;
    if (picker.value === 'selected' && liveSelection.length) context.nodeIds = liveSelection;
  }));
  const contextControl = el('label', { class: 'chat-context-control' },
    el('span', { text: 'Context:' }), picker, el('span', { class: 'chat-context-chevron', 'aria-hidden': 'true', text: '⌄' }));
  return { snapshot, picker: contextControl };
}

function renderProposalDiff(before, after) {
  const lines = diffMarkdownLines(before, after);
  const added = lines.filter((line) => line.kind === 'added').length;
  const removed = lines.filter((line) => line.kind === 'removed').length;
  const view = el('div', { class: 'chat-diff-view', role: 'region', 'aria-label': 'Markdown change diff' });
  for (const line of lines) {
    view.append(el('div', { class: `chat-diff-line chat-diff-${line.kind}` },
      el('span', { class: 'chat-diff-number', 'aria-hidden': 'true', text: line.beforeLine ?? '' }),
      el('span', { class: 'chat-diff-number', 'aria-hidden': 'true', text: line.afterLine ?? '' }),
      el('span', { class: 'chat-diff-sign', 'aria-hidden': 'true', text: line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : '' }),
      el('span', { class: 'chat-diff-code', text: line.text || ' ' })));
  }
  return { view, added, removed };
}

function chatProposals(chat) {
  return chat.messages.flatMap((message) => message.proposals || []);
}

function pendingChatProposals(chat, item) {
  return chatProposals(chat).filter((proposal) => ['proposed', 'undone'].includes(proposalStatus(item, proposal)));
}

function proposalMarkdown(item, proposal) {
  const target = proposal.targetId === 'article' ? item.article : item.nodes.find((node) => node.id === proposal.targetId);
  return proposal.targetId === 'article' ? target?.markdown : target?.document?.markdown;
}

function applyChatProposals(proposals, overrides = new Map()) {
  const workspace = work();
  if (!workspace || !proposals.length) return false;
  if (graphIsReadOnly() && proposals.some((proposal) => proposal.targetId !== 'article')) {
    aiPanel.error = 'Exit focus to apply changes to graph nodes.';
    renderAiPanel();
    return false;
  }
  const duplicate = proposals.find((proposal, index) => proposals.findIndex((entry) => entry.targetId === proposal.targetId) !== index);
  if (duplicate) {
    aiPanel.error = 'Multiple pending changes target the same node. Review those changes individually.';
    renderAiPanel();
    return false;
  }
  for (const proposal of proposals) {
    if (proposalMarkdown(workspace, proposal) !== proposal.before) {
      aiPanel.error = 'Some content changed since these proposals were made. Review the remaining changes individually.';
      renderAiPanel();
      return false;
    }
    if (!(overrides.get(proposal.id) ?? proposal.after).trim()) {
      aiPanel.error = 'Proposed Markdown cannot be empty.';
      renderAiPanel();
      return false;
    }
  }
  const acceptedAt = new Date().toISOString();
  for (const proposal of proposals) {
    proposal.after = overrides.get(proposal.id) ?? proposal.after;
    proposal.status = 'accepted';
    proposal.acceptedAt = acceptedAt;
  }
  change((entry) => {
    for (const proposal of proposals) {
      const edited = proposal.targetId === 'article' ? entry.article : entry.nodes.find((node) => node.id === proposal.targetId);
      if (proposal.targetId === 'article') edited.markdown = proposal.after;
      else edited.document.markdown = proposal.after;
      (edited.origins ||= []).push({ kind: 'ai', proposalId: proposal.id, acceptedAt, model: proposal.model });
    }
  }, { article: proposals.some((proposal) => proposal.targetId === 'article') });
  aiPanel.previewId = null;
  aiPanel.previewText = null;
  aiPanel.previewEditing = false;
  aiPanel.error = '';
  renderWorkspace();
  return true;
}

function renderProposalCard(proposal, item) {
  const status = proposalStatus(item, proposal);
  const node = item.nodes.find((entry) => entry.id === proposal.targetId);
  const target = proposal.targetId === 'article' ? 'Master article' : node ? nodeLabel(node) : 'Removed node';
  const card = el('div', { class: 'chat-proposal' }, el('div', { class: 'chat-proposal-heading' },
    el('strong', { text: `Proposed edit · ${target}` }), el('span', { text: status === 'accepted' ? 'Applied' : status === 'undone' ? 'Undone' : status === 'discarded' ? 'Discarded' : 'Needs review' })));
  const reviewing = aiPanel.previewId === proposal.id;
  if (!reviewing) {
    const historical = status === 'accepted' || status === 'discarded';
    card.append(button(historical ? 'View diff' : 'Review diff', () => { aiPanel.previewId = proposal.id; aiPanel.previewText = proposal.after; aiPanel.previewEditing = false; aiPanel.error = ''; renderAiPanel(); }, 'chat-review-button'));
    if (!historical) card.append(button('Discard', () => { proposal.status = 'discarded'; persist(); renderAiPanel(); }, 'chat-text-button'));
  }
  if (reviewing) {
    const historical = status === 'accepted' || status === 'discarded';
    const proposedText = aiPanel.previewText ?? proposal.after;
    const diff = renderProposalDiff(proposal.before, proposedText);
    const diffMount = el('div', { class: 'chat-diff-mount' }, diff.view);
    const summary = el('div', { class: 'chat-diff-summary' },
      el('span', { text: 'Markdown changes' }),
      el('span', { class: 'chat-diff-counts' },
        el('span', { class: 'chat-diff-removed-count', text: `−${diff.removed}` }),
        el('span', { class: 'chat-diff-added-count', text: `+${diff.added}` })));
    const editor = el('textarea', { class: 'chat-diff-editor', 'aria-label': 'Edit proposed Markdown', spellcheck: 'false' });
    editor.value = proposedText;
    editor.hidden = !aiPanel.previewEditing;
    editor.addEventListener('input', () => {
      aiPanel.previewText = editor.value;
      const next = renderProposalDiff(proposal.before, editor.value);
      diffMount.replaceChildren(next.view);
      summary.querySelector('.chat-diff-removed-count').textContent = `−${next.removed}`;
      summary.querySelector('.chat-diff-added-count').textContent = `+${next.added}`;
    });
    const edit = button(aiPanel.previewEditing ? 'Hide editor' : 'Edit proposed Markdown', () => {
      aiPanel.previewEditing = !aiPanel.previewEditing;
      editor.hidden = !aiPanel.previewEditing;
      edit.textContent = aiPanel.previewEditing ? 'Hide editor' : 'Edit proposed Markdown';
      if (aiPanel.previewEditing) editor.focus();
    }, 'chat-text-button');
    card.append(summary, diffMount);
    if (!historical) card.append(edit, editor);
    const actions = el('div', { class: 'chat-diff-actions' });
    if (!historical) {
      actions.append(button('Apply change', () => {
        if (applyChatProposals([proposal], new Map([[proposal.id, aiPanel.previewText ?? proposal.after]]))) announce(`${target} updated. Undo is available.`);
      }, 'chat-apply-button'),
      button('Discard', () => { proposal.status = 'discarded'; aiPanel.previewId = null; aiPanel.previewText = null; persist(); renderAiPanel(); }, 'chat-text-button'));
    }
    actions.append(button(historical ? 'Close diff' : 'Close review', () => { aiPanel.previewId = null; aiPanel.previewText = null; renderAiPanel(); }, 'chat-text-button'));
    card.append(actions);
  }
  return card;
}

function renderChatTranscript(panel, item, chat) {
  const transcript = el('div', { class: 'ai-chat-messages', 'aria-live': 'polite' });
  if (!chat.messages.length) transcript.append(el('div', { class: 'ai-chat-welcome' },
    el('div', { class: 'ai-chat-welcome-mark', text: '✦' }),
    el('h3', { text: 'Think it through.' }),
    el('p', { text: 'Ask a question, or tell chat how to revise the selected article or nodes.' })));
  for (const message of chat.messages) {
    const bubble = el('div', { class: `ai-message ai-message-${message.role}` });
    if (message.role === 'user') {
      bubble.append(el('p', { text: message.content }));
      if (message.contextSnapshot) bubble.append(el('small', { class: 'chat-message-context', text: `Context: ${message.contextSnapshot.targets.map((target) => target.title).join(', ') || 'none'}` }));
    } else {
      if (message.content) {
        const answer = el('div', { class: 'ai-output markdown-preview' });
        answer.innerHTML = renderMarkdown(message.content);
        bubble.append(answer);
      }
      for (const proposal of message.proposals || []) bubble.append(renderProposalCard(proposal, item));
      bubble.append(el('small', { class: 'chat-message-context', text: `${message.model} · ${new Date(message.createdAt).toLocaleString()}` }));
    }
    transcript.append(bubble);
  }
  if (aiPanel.busy) {
    const streaming = el('div', { class: `ai-message ai-message-assistant ${aiPanel.streamingReply ? 'ai-chat-streaming' : 'ai-chat-thinking'}` });
    if (aiPanel.streamingReply) {
      const answer = el('div', { class: 'ai-output markdown-preview' });
      answer.innerHTML = renderMarkdown(aiPanel.streamingReply);
      streaming.append(answer);
    } else streaming.textContent = 'Thinking…';
    transcript.append(streaming);
  }
  panel.append(transcript);
  requestAnimationFrame(() => { if (transcript.isConnected) transcript.scrollTop = transcript.scrollHeight; });
}

function updateStreamingChatReply(reply) {
  const transcript = document.querySelector('.ai-panel .ai-chat-messages');
  const bubble = transcript?.lastElementChild;
  if (!bubble?.classList.contains('ai-message-assistant')) return;
  bubble.classList.toggle('ai-chat-thinking', !reply);
  bubble.classList.toggle('ai-chat-streaming', !!reply);
  if (!reply) bubble.textContent = 'Thinking…';
  else {
    const answer = el('div', { class: 'ai-output markdown-preview' });
    answer.innerHTML = renderMarkdown(reply);
    bubble.replaceChildren(answer);
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderChatComposer(panel, item, chat, snapshot, picker) {
  const settings = loadModelSettings();
  const unavailable = !settings.models.length || !!(settings.secret && !getApiKey());
  if (unavailable) panel.append(el('div', { class: 'chat-config-notice' },
    el('span', { text: !settings.models.length ? 'Choose an endpoint and model to start chatting.' : 'Unlock your API key to continue chatting.' }),
    button('Model settings', () => { aiPanel.tab = 'settings'; renderAiPanel(); }, 'chat-text-button')));
  if (snapshot.size > MAX_CONTEXT_CHARS) panel.append(el('p', { class: 'ai-error chat-error', text: 'Context is too large. Choose a smaller scope before sending.' }));
  if (aiPanel.error) panel.append(el('p', { class: 'ai-error chat-error', role: 'alert', text: aiPanel.error }));
  const form = el('form', { class: 'ai-chat-composer' });
  const pending = pendingChatProposals(chat, item);
  if (pending.length) {
    const counts = pending.reduce((total, proposal) => {
      const lines = diffMarkdownLines(proposal.before, proposal.after);
      total.added += lines.filter((line) => line.kind === 'added').length;
      total.removed += lines.filter((line) => line.kind === 'removed').length;
      return total;
    }, { added: 0, removed: 0 });
    const targets = new Set(pending.map((proposal) => proposal.targetId)).size;
    const label = `${targets} ${targets === 1 ? 'node' : 'nodes'} changed`;
    form.append(el('div', { class: 'chat-pending-summary', role: 'status' },
      el('span', { class: 'chat-pending-label', text: label }),
      el('span', { class: 'chat-pending-counts' },
        el('span', { class: 'chat-diff-added-count', text: `+${counts.added}` }),
        el('span', { class: 'chat-diff-removed-count', text: `−${counts.removed}` })),
      button('Apply all', () => {
        if (applyChatProposals(pending)) announce(`${label} applied. Undo reverses the whole batch.`);
      }, 'chat-apply-all')));
  }
  const input = el('textarea', { class: 'ai-question', 'aria-label': 'Your message', title: 'Enter to send · Option + Enter for a new line', placeholder: 'Ask or describe a change…', rows: '1' });
  input.value = aiPanel.draft || '';
  const resizeInput = () => { input.style.height = 'auto'; input.style.height = `${Math.min(100, input.scrollHeight)}px`; };
  input.addEventListener('input', () => { aiPanel.draft = input.value; resizeInput(); });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (event.altKey) {
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      aiPanel.draft = input.value;
      resizeInput();
    } else form.requestSubmit();
  });
  const send = button('Send', () => {}, 'panel-action', { 'aria-label': 'Send message' });
  send.type = 'submit'; send.disabled = unavailable || aiPanel.busy || snapshot.size > MAX_CONTEXT_CHARS;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || aiPanel.busy) return;
    const selected = contextSnapshot(work(), chat.context);
    if (selected.size > MAX_CONTEXT_CHARS) { aiPanel.error = 'Context is too large. Deselect items before sending.'; renderAiPanel(); return; }
    const config = loadModelSettings();
    if (!config.models.length || (config.secret && !getApiKey())) { aiPanel.tab = 'settings'; renderAiPanel(); return; }
    const scope = aiPanel, workspaceId = item.id, chatId = chat.id;
    const prior = chat.messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({ role: message.role, content: message.content }));
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: question, contextSnapshot: selected, createdAt: new Date().toISOString() };
    chat.messages.push(userMessage);
    if (chat.title === 'New chat') chat.title = question.slice(0, 56);
    chat.updatedAt = userMessage.createdAt;
    scope.draft = ''; scope.error = ''; scope.busy = true; scope.streamingReply = '';
    persist(); renderAiPanel();
    try {
      let renderScheduled = false;
      const result = await chatModel(config, getApiKey(), prior, question, selected, { onReply: (reply) => {
        if (scope !== aiPanel || currentId !== workspaceId) return;
        scope.streamingReply = reply;
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
          renderScheduled = false;
          if (scope === aiPanel && currentId === workspaceId && scope.busy) updateStreamingChatReply(scope.streamingReply);
        });
      } });
      const savedChat = state.chats[workspaceId]?.find((entry) => entry.id === chatId);
      if (!savedChat) return;
      const proposals = result.edits.map((edit) => ({
        id: crypto.randomUUID(), targetId: edit.targetId,
        before: selected.targets.find((target) => target.id === edit.targetId).markdown,
        after: edit.markdown, status: 'proposed', model: config.selectedModel
      }));
      savedChat.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: result.reply, proposals,
        model: config.selectedModel, endpoint: config.endpoint, createdAt: new Date().toISOString() });
      savedChat.updatedAt = new Date().toISOString(); persist();
    } catch (error) {
      chat.messages = chat.messages.filter((message) => message.id !== userMessage.id);
      if (scope === aiPanel) { scope.error = error.message; scope.draft = question; }
      persist();
    } finally {
      scope.busy = false; scope.streamingReply = '';
      if (scope === aiPanel && currentId === workspaceId) renderAiPanel();
    }
  });
  form.append(input, picker, send);
  panel.append(form);
  requestAnimationFrame(() => { if (input.isConnected) resizeInput(); });
  if (!aiPanel.busy && !aiPanel.previewId) requestAnimationFrame(() => { if (input.isConnected) input.focus(); });
}

function startChatResize(event, panel) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startWidth = panel.getBoundingClientRect().width;
  const minWidth = 300;
  const maxWidth = Math.max(minWidth, window.innerWidth - 32);
  const updateWidth = (clientX) => {
    const width = clamp(startWidth - (clientX - startX), minWidth, maxWidth);
    panel.style.width = `${width}px`;
    if (aiPanel) aiPanel.width = width;
  };
  const finish = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
  };
  const move = (moveEvent) => { moveEvent.preventDefault(); updateWidth(moveEvent.clientX); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function activeResearchQuestion(item) {
  const research = normalizeResearch(item);
  return research.questions.find((question) => question.id === researchPanel?.questionId) || research.questions[0] || null;
}

function researchSourceLink(source) {
  const link = source.url
    ? el('a', { class: 'research-source-link', href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.title })
    : button(source.title, () => openSource(source.id), 'research-source-link');
  return el('div', { class: 'research-source-row' }, link,
    source.discovery?.verifiedAt ? el('span', { class: 'research-badge verified', text: '✓ provider record' }) : el('span', { class: 'research-badge', text: 'local source' }));
}

function findResearchProposal(item, id) {
  return normalizeResearch(item).findings.find((proposal) => proposal.id === id);
}

function applyResearchProposal(id, editedText) {
  const item = work();
  const proposal = item && findResearchProposal(item, id);
  if (!proposal) return;
  if (item.article.markdown !== proposal.before) {
    researchPanel.error = 'The article changed after this proposal was created. Create a fresh proposal so no newer work is overwritten.';
    renderResearchPanel(); return;
  }
  const after = String(editedText || '').trim();
  if (!after) { researchPanel.error = 'The proposed article cannot be empty.'; renderResearchPanel(); return; }
  const acceptedAt = new Date().toISOString();
  change((workspace) => {
    const saved = findResearchProposal(workspace, id);
    saved.after = after; saved.status = 'accepted'; saved.acceptedAt = acceptedAt;
    workspace.article.markdown = after;
    (workspace.article.origins ||= []).push({ kind: 'research', proposalId: id, questionId: saved.questionId, sourceIds: saved.sourceIds, comparisonId: saved.comparisonId, acceptedAt });
  }, { article: true });
  researchPanel.previewId = null;
  announce('Research proposal applied. The source and reasoning trail were preserved; Undo is available.');
}

function renderResearchProposal(proposal, item) {
  const card = el('article', { class: 'research-proposal' });
  const heading = el('div', { class: 'research-card-heading' }, el('strong', { text: 'Article proposal' }), el('span', { class: `research-status ${proposal.status}`, text: proposal.status }));
  card.append(heading);
  if (proposal.sourceIds?.length) card.append(el('p', { class: 'research-trail', text: `${proposal.sourceIds.length} attached source${proposal.sourceIds.length === 1 ? '' : 's'} · reasoning trail retained` }));
  if (proposal.status === 'proposed') {
    if (researchPanel.previewId !== proposal.id) {
      card.append(button('Review before applying', () => { researchPanel.previewId = proposal.id; renderResearchPanel(); }, 'chat-review-button'),
        button('Discard', () => change((workspace) => { findResearchProposal(workspace, proposal.id).status = 'discarded'; }), 'chat-text-button'));
    } else {
      const editor = el('textarea', { class: 'research-proposal-editor', 'aria-label': 'Proposed complete article', value: proposal.after });
      card.append(el('p', { class: 'research-warning', text: 'Review the complete article below. Attached records verify source identity, not whether every claim is supported.' }), renderProposalDiff(proposal.before, proposal.after), editor,
        el('div', { class: 'research-actions' }, button('Apply to article', () => applyResearchProposal(proposal.id, editor.value), 'chat-apply-button'), button('Cancel review', () => { researchPanel.previewId = null; renderResearchPanel(); }, 'chat-text-button')));
    }
  }
  return card;
}

function renderResearchQuestions(panel, item) {
  const research = normalizeResearch(item);
  const create = el('div', { class: 'research-create' });
  const questionInput = el('textarea', { placeholder: 'What do you want to verify?', 'aria-label': 'New research question', value: researchPanel.draftQuestion || '' });
  create.append(questionInput, button('Save question', () => {
    try {
      const question = createResearchQuestion(questionInput.value, selectedResearchContext(item));
      researchPanel.questionId = question.id; researchPanel.draftQuestion = ''; researchPanel.query = question.text;
      change((workspace) => normalizeResearch(workspace).questions.unshift(question));
    } catch (error) { researchPanel.error = error.message; renderResearchPanel(); }
  }, 'panel-action'));
  panel.append(create);
  if (research.questions.length) {
    const chooser = el('select', { class: 'research-question-select', 'aria-label': 'Research question' });
    for (const question of research.questions) chooser.append(el('option', { value: question.id, text: `${question.status === 'open' ? '○' : '✓'} ${question.text}` }));
    const active = activeResearchQuestion(item);
    chooser.value = active?.id || '';
    chooser.addEventListener('change', () => { researchPanel.questionId = chooser.value; researchPanel.query = ''; researchPanel.results = []; renderResearchPanel(); });
    panel.append(chooser);
  }
  const question = activeResearchQuestion(item);
  if (!question) return panel.append(el('p', { class: 'research-empty', text: 'Save a question from your selected passage or nodes to begin a traceable research thread.' }));
  const sourceIds = new Set(question.sourceIds || []);
  const attached = item.sources.filter((source) => sourceIds.has(source.id));
  const questionCard = el('section', { class: 'research-section' }, el('div', { class: 'research-card-heading' }, el('strong', { text: question.text }), button(question.status === 'open' ? 'Mark resolved' : 'Reopen', () => change((workspace) => {
    const saved = normalizeResearch(workspace).questions.find((entry) => entry.id === question.id);
    saved.status = saved.status === 'open' ? 'resolved' : 'open'; saved.updatedAt = new Date().toISOString();
  }), 'chat-text-button')));
  if (question.context?.quote) questionCard.append(el('blockquote', { class: 'research-context', text: question.context.quote }));
  questionCard.append(el('p', { class: 'research-label', text: `ATTACHED SOURCES · ${attached.length}` }));
  for (const source of attached) questionCard.append(researchSourceLink(source));
  const available = item.sources.filter((source) => !sourceIds.has(source.id));
  if (available.length) {
    const existing = el('select', { 'aria-label': 'Existing source to attach' });
    for (const source of available) existing.append(el('option', { value: source.id, text: source.title }));
    questionCard.append(el('div', { class: 'research-attach-existing' }, existing, button('Attach existing', () => {
      const source = item.sources.find((entry) => entry.id === existing.value);
      if (source) change((workspace) => attachSourceToQuestion(workspace, question.id, source));
    }, 'panel-secondary')));
  }
  const search = el('div', { class: 'research-search' });
  const query = el('input', { value: researchPanel.query || question.text, placeholder: 'Search scholarly works', 'aria-label': 'Source discovery query' });
  search.append(query, button(researchPanel.loading ? 'Searching…' : 'Discover sources', async () => {
    researchPanel.query = query.value; researchPanel.loading = true; researchPanel.error = ''; researchPanel.results = [];
    renderResearchPanel();
    try { researchPanel.results = await discoverSources(researchPanel.query); }
    catch (error) { researchPanel.error = error.message; }
    finally { researchPanel.loading = false; renderResearchPanel(); }
  }, 'panel-action', researchPanel.loading ? { disabled: '' } : {}));
  questionCard.append(search, el('p', { class: 'research-disclaimer', text: 'Discovery sends these search terms to OpenAlex. Attaching a result verifies its provider record and preserves a link to the original; read it before relying on a claim.' }));
  for (const result of researchPanel.results || []) {
    const resultCard = el('article', { class: 'research-result' }, el('strong', { text: result.title }), el('small', { text: [result.authors.slice(0, 3).join(', '), result.venue, result.publishedAt, `${result.citedByCount} indexed citations`].filter(Boolean).join(' · ') || 'Publication details unavailable' }));
    const already = item.sources.some((source) => source.discovery?.providerId === result.providerId && sourceIds.has(source.id));
    resultCard.append(el('div', { class: 'research-actions' }, el('a', { href: result.url, target: '_blank', rel: 'noopener noreferrer', text: 'Inspect original ↗' }), button(already ? 'Attached' : 'Attach to question', () => {
      if (already) return;
      try {
        const source = verifiedSourceFromResult(result);
        change((workspace) => attachSourceToQuestion(workspace, question.id, source));
        announce('Verified source record attached to the research question.');
      } catch (error) { researchPanel.error = error.message; renderResearchPanel(); }
    }, 'panel-secondary', already ? { disabled: '' } : {})));
    questionCard.append(resultCard);
  }
  const finding = el('textarea', { class: 'research-finding-input', placeholder: 'Write what you learned after inspecting the source. This becomes a proposal, not an automatic edit.', 'aria-label': 'Research finding' });
  questionCard.append(el('p', { class: 'research-label', text: 'PROPOSE A FINDING' }), finding, button('Create article proposal', () => {
    try {
      const proposal = createResearchProposal(item, { text: finding.value, questionId: question.id, sourceIds: [...sourceIds], title: 'Research finding' });
      researchPanel.previewId = proposal.id;
      change((workspace) => normalizeResearch(workspace).findings.unshift(proposal));
    } catch (error) { researchPanel.error = error.message; renderResearchPanel(); }
  }, 'panel-secondary'));
  for (const proposal of research.findings.filter((entry) => entry.questionId === question.id)) questionCard.append(renderResearchProposal(proposal, item));
  panel.append(questionCard);
}

function renderResearchCompare(panel, item) {
  const ideas = [{ id: 'article', title: 'Master article', text: item.article.markdown }, ...item.nodes.map((node) => ({ id: node.id, title: nodeLabel(node), text: node.document?.markdown || '' }))];
  const list = el('div', { class: 'research-idea-list' });
  for (const idea of ideas) {
    const checkbox = el('input', { type: 'checkbox', value: idea.id, ...(researchPanel.ideaIds?.has(idea.id) ? { checked: '' } : {}) });
    checkbox.addEventListener('change', () => { researchPanel.ideaIds ||= new Set(); checkbox.checked ? researchPanel.ideaIds.add(idea.id) : researchPanel.ideaIds.delete(idea.id); });
    list.append(el('label', {}, checkbox, el('span', { text: idea.title })));
  }
  panel.append(el('p', { class: 'research-disclaimer', text: 'Compare two or more ideas. Contradiction flags are lexical prompts for review, never factual conclusions.' }), list,
    button('Compare and draft merge', () => {
      try {
        const selected = ideas.filter((idea) => researchPanel.ideaIds?.has(idea.id));
        const comparison = compareIdeas(selected);
        const proposal = createResearchProposal(item, { text: comparison.markdown, comparisonId: comparison.id, title: 'Compared ideas' });
        researchPanel.previewId = proposal.id;
        change((workspace) => { const research = normalizeResearch(workspace); research.comparisons.unshift(comparison); research.findings.unshift(proposal); });
      } catch (error) { researchPanel.error = error.message; renderResearchPanel(); }
    }, 'panel-action'));
  for (const comparison of normalizeResearch(item).comparisons) {
    const card = el('article', { class: 'research-section' }, el('div', { class: 'research-card-heading' }, el('strong', { text: `Comparison · ${comparison.ideaIds.length} ideas` }), el('small', { text: new Date(comparison.createdAt).toLocaleString() })));
    if (comparison.sharedTerms.length) card.append(el('p', { class: 'research-trail', text: `Shared terms: ${comparison.sharedTerms.join(', ')}` }));
    if (comparison.possibleContradictions.length) for (const flag of comparison.possibleContradictions) card.append(el('p', { class: 'research-contradiction', text: flag.note }));
    else card.append(el('p', { class: 'research-no-contradiction', text: 'No simple polarity conflict was detected. This does not establish agreement.' }));
    for (const proposal of normalizeResearch(item).findings.filter((entry) => entry.comparisonId === comparison.id)) card.append(renderResearchProposal(proposal, item));
    panel.append(card);
  }
}

function renderResearchCloseout(panel, item) {
  const research = normalizeResearch(item);
  const understanding = el('textarea', { placeholder: 'What do you understand now?', 'aria-label': 'Current understanding' });
  const open = el('textarea', { placeholder: 'One open question per line', 'aria-label': 'Open questions' });
  open.value = research.questions.filter((question) => question.status === 'open').map((question) => question.text).join('\n');
  panel.append(el('p', { class: 'research-disclaimer', text: 'Close the session with a compact return point. This record does not alter the article.' }), understanding, open,
    button('Save session closeout', () => {
      try { const closeout = recordCloseout({ understanding: understanding.value, openQuestions: open.value }); change((workspace) => normalizeResearch(workspace).closeouts.unshift(closeout)); }
      catch (error) { researchPanel.error = error.message; renderResearchPanel(); }
    }, 'panel-action'));
  for (const closeout of research.closeouts) {
    const card = el('article', { class: 'research-section' }, el('small', { text: new Date(closeout.createdAt).toLocaleString() }));
    if (closeout.understanding) card.append(el('h3', { text: 'Current understanding' }), el('p', { text: closeout.understanding }));
    if (closeout.openQuestions.length) card.append(el('h3', { text: 'Open questions' }), el('ul', {}, ...closeout.openQuestions.map((question) => el('li', { text: question }))));
    panel.append(card);
  }
}

function renderResearchPanel() {
  document.querySelector('.research-panel')?.remove();
  const item = work(); if (!item || !researchPanel) return;
  const panel = el('aside', { class: 'research-panel', 'aria-label': 'Research and consolidation' });
  const heading = el('header', { class: 'research-heading' }, el('div', {}, el('span', { class: 'research-eyebrow', text: 'PHASE 4' }), el('h2', { text: 'Research & consolidate' })), button('×', () => { researchPanel = null; renderWorkspace(); }, 'panel-close', { 'aria-label': 'Close research' }));
  const tabs = el('div', { class: 'research-tabs', role: 'tablist' });
  for (const [id, label] of [['questions', 'Questions'], ['compare', 'Compare'], ['closeout', 'Closeout']]) tabs.append(button(label, () => { researchPanel.tab = id; researchPanel.error = ''; renderResearchPanel(); }, '', { role: 'tab', 'aria-selected': String(researchPanel.tab === id) }));
  const body = el('div', { class: 'research-body' });
  if (researchPanel.error) body.append(el('p', { class: 'research-error', text: researchPanel.error }));
  if (researchPanel.tab === 'compare') renderResearchCompare(body, item);
  else if (researchPanel.tab === 'closeout') renderResearchCloseout(body, item);
  else renderResearchQuestions(body, item);
  panel.append(heading, tabs, body);
  document.querySelector('.workspace-shell')?.append(panel);
}

function renderAiPanel() {
  document.querySelector('.ai-panel')?.remove();
  const item = work(); if (!item || !aiPanel) return;
  const chat = currentChat(); if (!chat) return;
  const panel = el('aside', { class: 'ai-panel', 'aria-label': 'Workspace chat', ...(aiPanel.width ? { style: `width: ${aiPanel.width}px` } : {}) });
  panel.addEventListener('pointerdown', (event) => {
    if (event.clientX - panel.getBoundingClientRect().left <= 8) startChatResize(event, panel);
  });
  const navigate = (page) => { aiPanel.tab = page; aiPanel.error = ''; renderAiPanel(); };
  const heading = el('header', { class: 'ai-heading chat-page-heading' });
  const left = el('div', { class: 'chat-heading-left' });
  if (aiPanel.tab === 'chat') {
    left.append(button('☰', () => navigate('history'), 'chat-header-icon', { 'aria-label': 'Chat history', title: 'Chat history' }));
  } else {
    left.append(button('←', () => navigate('chat'), 'chat-header-icon', { 'aria-label': 'Back to chat', title: 'Back to chat' }));
  }
  left.append(el('h2', { text: aiPanel.tab === 'chat' ? chat.title : aiPanel.tab === 'history' ? 'Chat history' : 'Model settings' }));
  const actions = el('div', { class: 'chat-heading-actions' });
  if (aiPanel.tab === 'chat') {
    actions.append(button('＋', () => newChat(), 'chat-header-icon', { 'aria-label': 'New chat', title: 'New chat' }),
      button('⚙', () => navigate('settings'), 'chat-header-icon', { 'aria-label': 'Model settings', title: 'Model settings' }));
  }
  actions.append(button('×', () => { aiPanel = null; renderWorkspace(); }, 'panel-close', { 'aria-label': 'Close chat' }));
  heading.append(left, actions);
  panel.append(heading);
  if (aiPanel.tab === 'settings') renderSettings(panel);
  else if (aiPanel.tab === 'history') {
    const list = el('div', { class: 'chat-history-list' });
    list.append(button('＋ New chat', () => newChat(), 'chat-new-button'));
    for (const entry of [...chatList()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      list.append(button(entry.title, () => {
        aiPanel.chatId = entry.id; aiPanel.tab = 'chat'; aiPanel.draft = ''; aiPanel.previewId = null; renderAiPanel();
      }, `chat-history-row ${entry.id === chat.id ? 'active' : ''}`, { title: new Date(entry.updatedAt).toLocaleString() }));
    }
    panel.append(list);
  } else {
    const { snapshot, picker } = renderContextPicker(item, chat);
    renderChatTranscript(panel, item, chat);
    renderChatComposer(panel, item, chat, snapshot, picker);
  }
  document.querySelector('.workspace-shell')?.append(panel);
}

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase(), mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Escape' && document.querySelector('.save-menu')) { event.preventDefault(); closeSaveMenu(); return; }
  if (event.key === 'Escape' && document.querySelector('.document-menu')) { event.preventDefault(); closeDocumentMenu(); return; }
  if (mod && key === 's') { event.preventDefault(); saveNow(); return; }
  if (!currentId) return;
  if (event.key === 'Escape' && document.querySelector('.context-menu')) { event.preventDefault(); closeContextMenu(); return; }
  // Escape exits focus even when the focus toolbar (or another control) has focus.
  // Keep this before the editable-control guard so the advertised global shortcut
  // still works after changing the relationship mode or depth.
  if (event.key === 'Escape' && graphFocus) { event.preventDefault(); exitGraphFocus(); return; }
  if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
  if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) { event.preventDefault(); redo(); return; }
  if (mod && key === 'k' && selectedPassage) { event.preventDefault(); createAnchoredNode(); return; }
  if (event.target.closest('button, input, textarea, select, [contenteditable]')) return;
  if (event.key === ' ') {
    if (event.repeat) {
      if (spaceKeySession?.entered && graphFocus) {
        event.preventDefault();
        spaceKeySession.held = true;
      }
      return;
    }
    if (spaceKeySession?.down) { event.preventDefault(); return; }
    spaceKeySession = { down: true, entered: false, held: false, exited: false };
    if (graphFocus) {
      event.preventDefault();
      spaceKeySession.exited = true;
      exitGraphFocus();
      return;
    }
    if (selectedId && !selectedIds.size) {
      event.preventDefault();
      spaceKeySession.entered = enterGraphFocus();
      return;
    }
    if (!selectedId && !selectedIds.size) { event.preventDefault(); fitCanvas(); }
    return;
  }
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
  else if (event.key === 'Enter' && selectedId) { event.preventDefault(); addSibling(work().nodes.find((node) => node.id === selectedId)); }
  else if (key === 'f2' && selectedId) { event.preventDefault(); beginNodeMarkdownEdit(selectedId); }
  else if ((key === 'backspace' || key === 'delete') && (selectedId || selectedIds.size) && window.getSelection()?.isCollapsed) { event.preventDefault(); removeNodes(selectedId ? [selectedId] : [...selectedIds]); }
});

document.addEventListener('keyup', (event) => {
  if (event.key !== ' ') return;
  const session = spaceKeySession;
  spaceKeySession = null;
  if (session?.entered && session.held && graphFocus) {
    event.preventDefault();
    exitGraphFocus();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (saveMode === 'auto' && flushView()) persist(true);
  if (dirty) { event.preventDefault(); event.returnValue = ''; }
});

renderHome();
