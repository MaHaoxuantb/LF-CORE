export const STORAGE_KEY = 'learning-canvas:documents-v4';
export const SAVE_MODE_KEY = 'learning-canvas:save-mode-v1';
const MARKDOWN_KEY = 'learning-canvas:markdown-v3';
const CANVAS_KEY = 'learning-canvas:canvas-v2';
const FIRST_KEY = 'learning-canvas:v1';

export function emptyState() { return { version: 4, workspaces: [], history: {}, redo: {}, chats: {} }; }

export function createWorkspace(title, markdown = '') {
  const id = crypto.randomUUID();
  const name = title.trim() || 'Untitled workspace';
  const now = new Date().toISOString();
  return {
    id, title: name, createdAt: now, updatedAt: now,
    article: { id: crypto.randomUUID(), revision: 1, markdown: markdown || `# ${name}\n\n` },
    nodes: [], highlights: [], edges: [], sources: [], layout: { positions: {}, sizes: {}, articleSize: { width: 490, minHeight: 550 } },
    view: { x: null, y: null, zoom: 1, outlineOpen: false }
  };
}

function validate(parsed, version) {
  if (!parsed || parsed.version !== version || !Array.isArray(parsed.workspaces) || !parsed.history || typeof parsed.history !== 'object') {
    throw new Error('The saved library has an unsupported format.');
  }
  return parsed;
}

function migrateWorkspace(old) {
  const work = structuredClone(old);
  if (typeof work.article.markdown !== 'string') {
    const sections = Array.isArray(work.article.sections) ? work.article.sections : [];
    work.article.markdown = `# ${work.title}\n\n${sections.map((section) => `## ${section.title}\n\n${section.body}`).join('\n\n')}`.trimEnd() + '\n';
    delete work.article.sections;
  }
  work.nodes = (work.nodes || []).map((node) => {
    const next = { ...node, parentId: node.parentId ?? null };
    if (next.anchor) {
      next.anchor = { ...next.anchor, targetId: 'article', start: -1, end: -1 };
      delete next.anchor.sectionId;
    }
    delete next.kind;
    return next;
  });
  work.layout ||= {};
  work.layout.positions ||= {};
  work.layout.sizes ||= {};
  work.layout.articleSize ||= { width: 490, minHeight: 550 };
  work.view ||= { x: null, y: null, zoom: 1 };
  work.view.outlineOpen ??= false;
  return work;
}

function normalizeWorkspace(work) {
  work.sources ||= [];
  work.highlights ||= [];
  for (const node of work.nodes || []) {
    node.sourceRefs ||= [];
    if (node.anchor && 'sectionId' in node.anchor) {
      node.anchor.targetId = 'article';
      delete node.anchor.sectionId;
    }
    if (!node.document) node.document = { type: 'markdown', markdown: node.body ?? '' };
    else if (!node.document.type && typeof node.document.markdown === 'string') node.document.type = 'markdown';
    if (typeof node.title === 'string' && node.title.trim()) {
      const title = node.title.trim();
      const existing = node.document.markdown || '';
      if (!existing.trimStart().startsWith(`# ${title}\n`) && existing.trim() !== `# ${title}`) {
        node.document.markdown = `# ${title}${existing ? `\n\n${existing}` : ''}`;
      }
    }
    delete node.title;
    delete node.body;
  }
  return work;
}

export function loadState(storage = localStorage) {
  const current = storage.getItem(STORAGE_KEY);
  if (current) {
    const parsed = validate(JSON.parse(current), 4);
    parsed.redo ||= {};
    parsed.chats ||= {};
    parsed.workspaces.forEach(normalizeWorkspace);
    Object.values(parsed.history).flat().forEach(normalizeWorkspace);
    Object.values(parsed.redo).flat().forEach(normalizeWorkspace);
    return parsed;
  }
  const markdown = storage.getItem(MARKDOWN_KEY);
  if (markdown) {
    const parsed = validate(JSON.parse(markdown), 3);
    parsed.redo ||= {};
    parsed.chats ||= {};
    parsed.workspaces.forEach(normalizeWorkspace);
    Object.values(parsed.history).flat().forEach(normalizeWorkspace);
    Object.values(parsed.redo).flat().forEach(normalizeWorkspace);
    parsed.version = 4;
    return parsed;
  }
  const canvas = storage.getItem(CANVAS_KEY);
  if (canvas) {
    const parsed = validate(JSON.parse(canvas), 2);
    return { version: 4, workspaces: parsed.workspaces.map(migrateWorkspace).map(normalizeWorkspace), history: Object.fromEntries(Object.entries(parsed.history).map(([id, snapshots]) => [id, snapshots.map(migrateWorkspace).map(normalizeWorkspace)])), redo: {}, chats: {} };
  }
  const first = storage.getItem(FIRST_KEY);
  if (first) {
    const parsed = validate(JSON.parse(first), 1);
    return { version: 4, workspaces: parsed.workspaces.map(migrateWorkspace).map(normalizeWorkspace), history: {}, redo: {}, chats: {} };
  }
  return emptyState();
}

export function saveState(state, storage = localStorage) { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
export function loadSaveMode(storage = localStorage) { return storage.getItem(SAVE_MODE_KEY) === 'manual' ? 'manual' : 'auto'; }
export function saveSaveMode(mode, storage = localStorage) {
  if (mode !== 'manual' && mode !== 'auto') throw new Error('Unsupported save mode.');
  storage.setItem(SAVE_MODE_KEY, mode);
}
export function snapshotWorkspace(workspace) { return structuredClone(workspace); }
