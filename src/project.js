export const PROJECT_FORMAT = 'linecoflow-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.lfcore';

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
}

function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('The project contains an invalid embedded file.');
  }
  let binary;
  try { binary = atob(value); }
  catch { throw new Error('The project contains an invalid embedded file.'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function projectFileName(title) {
  const safe = String(title || 'Untitled project')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'Untitled-project';
  return `${safe}${PROJECT_EXTENSION}`;
}

export function serializeProject(workspace, chats = [], pdfBytes = new Map(), exportedAt = new Date().toISOString()) {
  assertObject(workspace, 'There is no project to download.');
  const files = {};
  for (const source of workspace.sources || []) {
    if (source.type !== 'pdf') continue;
    const bytes = pdfBytes.get(source.id);
    if (!bytes) throw new Error(`The PDF “${source.title || source.fileName || 'Untitled source'}” is missing. Reattach it before downloading this project.`);
    files[source.id] = { encoding: 'base64', data: bytesToBase64(bytes) };
  }
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt,
    project: { workspace: structuredClone(workspace), chats: structuredClone(Array.isArray(chats) ? chats : []) },
    files
  });
}

function remapPdfSourceIds(workspace, idMap) {
  for (const source of workspace.sources || []) if (idMap.has(source.id)) source.id = idMap.get(source.id);
  for (const node of workspace.nodes || []) {
    if (node.document?.type === 'source' && idMap.has(node.document.sourceId)) node.document.sourceId = idMap.get(node.document.sourceId);
    for (const reference of node.sourceRefs || []) {
      if (idMap.has(reference.sourceId)) reference.sourceId = idMap.get(reference.sourceId);
      if (reference.anchor && idMap.has(reference.anchor.targetId)) reference.anchor.targetId = idMap.get(reference.anchor.targetId);
    }
  }
  for (const question of workspace.research?.questions || []) {
    question.sourceIds = (question.sourceIds || []).map((id) => idMap.get(id) || id);
  }
  for (const finding of workspace.research?.findings || []) {
    finding.sourceIds = (finding.sourceIds || []).map((id) => idMap.get(id) || id);
  }
  for (const origin of workspace.article?.origins || []) {
    if (origin.kind === 'research') origin.sourceIds = (origin.sourceIds || []).map((id) => idMap.get(id) || id);
  }
}

export function parseProject(serialized, { uuid = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  let bundle;
  try { bundle = JSON.parse(serialized); }
  catch { throw new Error('This is not a valid LinecoFlow project file.'); }
  assertObject(bundle, 'This is not a valid LinecoFlow project file.');
  if (bundle.format !== PROJECT_FORMAT || bundle.version !== PROJECT_VERSION) throw new Error('This project file uses an unsupported format or version.');
  assertObject(bundle.project, 'This project file is missing its project data.');
  assertObject(bundle.project.workspace, 'This project file is missing its canvas.');
  const workspace = structuredClone(bundle.project.workspace);
  if (typeof workspace.title !== 'string' || !workspace.article || typeof workspace.article.markdown !== 'string' || !Array.isArray(workspace.nodes) || !Array.isArray(workspace.sources)) {
    throw new Error('This project file contains invalid canvas data.');
  }
  const files = bundle.files ?? {};
  assertObject(files, 'This project file contains invalid embedded files.');
  const pdfs = [];
  const idMap = new Map();
  for (const source of workspace.sources) {
    if (source.type !== 'pdf') continue;
    const file = files[source.id];
    if (!file || file.encoding !== 'base64') throw new Error(`The project is missing the PDF “${source.title || source.fileName || 'Untitled source'}”.`);
    const id = uuid();
    idMap.set(source.id, id);
    pdfs.push({ id, bytes: base64ToBytes(file.data) });
  }
  remapPdfSourceIds(workspace, idMap);
  workspace.id = uuid();
  workspace.createdAt = now();
  workspace.updatedAt = workspace.createdAt;
  const chats = Array.isArray(bundle.project.chats) ? structuredClone(bundle.project.chats) : [];
  return { workspace, chats, pdfs };
}
