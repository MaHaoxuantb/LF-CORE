import { serializeProject, projectFileName } from './project.js';

export async function packageProject(workspace, chats, readMedia) {
  const bytes = new Map();
  for (const source of workspace.sources || []) {
    if (['pdf', 'image', 'video', 'file'].includes(source.type)) bytes.set(source.id, await readMedia(source));
  }
  const contents = new TextEncoder().encode(serializeProject(workspace, chats, bytes)).buffer;
  return { contents, name: projectFileName(workspace.title) };
}

// The worker owns the large library/undo mirror. UI messages contain only the
// changed project and newly created undo snapshots, rather than the full library.
export class PersistenceJobs {
  constructor({ writeState, readMedia }) {
    this.writeState = writeState;
    this.readMedia = readMedia;
    this.snapshots = new Map();
  }

  async run(job) {
    if (job.type === 'initialize') {
      this.state = job.state;
      for (const kind of ['history', 'redo']) {
        for (const [id, entries] of Object.entries(this.state[kind])) entries.forEach((entry, index) => this.snapshots.set(`${kind}:${id}:${index}`, entry));
      }
      return null;
    }
    if (job.type === 'package') return packageProject(job.workspace, job.chats, this.readMedia);
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
    this.state.workspaces = job.order.map((id) => {
      if (!projects.has(id)) throw new Error('A project snapshot is missing.');
      return projects.get(id);
    });
    for (const kind of ['history', 'redo', 'chats']) {
      for (const id of Object.keys(this.state[kind])) if (!projects.has(id) || !job.order.includes(id)) delete this.state[kind][id];
    }
    // Bound memory to undo snapshots still referenced by the current library.
    const retained = new Set(Object.values(this.state.history).flat().concat(Object.values(this.state.redo).flat()));
    for (const [key, value] of this.snapshots) if (!retained.has(value)) this.snapshots.delete(key);
    await this.writeState(this.state);
    return null;
  }
}
