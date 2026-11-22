import { encodeProjectAttachment, serializeProjectWithAttachments, projectFileName } from './project.js';

export async function packageProject(workspace, chats, readMedia, cache = null) {
  const files = new Map();
  for (const source of workspace.sources || []) {
    if (!['pdf', 'image', 'video', 'file'].includes(source.type)) continue;
    const key = cache && source.checksum ? JSON.stringify([source.id, source.type, source.checksum]) : null;
    let attachment = key && cache.entries.get(key);
    if (attachment) {
      cache.entries.delete(key);
      cache.entries.set(key, attachment);
    } else {
      attachment = encodeProjectAttachment(source, await readMedia(source));
      const size = attachment.data.length;
      if (key && size <= cache.limit) {
        while (cache.size + size > cache.limit) {
          const [oldest, value] = cache.entries.entries().next().value;
          cache.size -= value.data.length;
          cache.entries.delete(oldest);
        }
        cache.entries.set(key, attachment);
        cache.size += size;
      }
    }
    files.set(source.id, attachment);
  }
  const contents = new TextEncoder().encode(serializeProjectWithAttachments(workspace, chats, files)).buffer;
  return { contents, name: projectFileName(workspace.title) };
}

// The worker owns the large library/undo mirror. UI messages contain only the
// changed project and newly created undo snapshots, rather than the full library.
export class PersistenceJobs {
  constructor({ writeState, readMedia, attachmentCacheLimit = 96 * 1024 * 1024 }) {
    this.writeState = writeState;
    this.readMedia = readMedia;
    this.snapshots = new Map();
    this.attachmentCache = { entries: new Map(), size: 0, limit: attachmentCacheLimit };
  }

  async run(job) {
    if (job.type === 'initialize') {
      this.state = job.state;
      this.revisions = { ...job.state.databaseRevisions };
      for (const kind of ['history', 'redo']) {
        for (const [id, entries] of Object.entries(this.state[kind])) entries.forEach((entry, index) => this.snapshots.set(`${kind}:${id}:${index}`, entry));
      }
      return null;
    }
    if (job.type === 'package') return packageProject(job.workspace, job.chats, this.readMedia, this.attachmentCache);
    if (job.type !== 'save') throw new Error('Unknown persistence operation.');
    for (const { key, value } of job.snapshots) this.snapshots.set(key, value);
    const resolveSnapshot = (key) => {
      if (!this.snapshots.has(key)) throw new Error('An undo snapshot is missing.');
      return this.snapshots.get(key);
    };
    const patches = job.projects.map((patch) => ({ ...patch, history: patch.history.map(resolveSnapshot), redo: patch.redo.map(resolveSnapshot) }));
    for (const patch of patches) {
      this.state.workspaces = this.state.workspaces.filter((item) => item.id !== patch.workspace.id);
      this.state.workspaces.push(patch.workspace);
      this.state.chats[patch.workspace.id] = patch.chats;
      this.state.history[patch.workspace.id] = patch.history;
      this.state.redo[patch.workspace.id] = patch.redo;
    }
    const projects = new Map(this.state.workspaces.map((item) => [item.id, item]));
    // The library UI may know projects created in another window after this
    // worker initialized. Their records are not part of this worker's mirror;
    // the database commit preserves them independently.
    this.state.workspaces = job.order.filter(id => projects.has(id)).map(id => projects.get(id));
    for (const kind of ['history', 'redo', 'chats']) {
      for (const id of Object.keys(this.state[kind])) if (!projects.has(id) || !job.order.includes(id)) delete this.state[kind][id];
    }
    // Bound memory to undo snapshots still referenced by the current library.
    const retained = new Set(Object.values(this.state.history).flat().concat(Object.values(this.state.redo).flat()));
    for (const [key, value] of this.snapshots) if (!retained.has(value)) this.snapshots.delete(key);
    const ids = job.ids || job.projects.map(p => p.workspace.id);
    const expected = Object.fromEntries(ids.map(id => [id, Math.max(job.expected?.[id] || 0, this.revisions[id] || 0)]));
    const revisions = await this.writeState(this.state, { ids, expected });
    if (revisions) Object.assign(this.revisions, revisions);
    return { revisions };
  }
}
