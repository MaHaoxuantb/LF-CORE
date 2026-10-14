export class PersistenceClient {
  constructor(state, { WorkerRef = globalThis.Worker } = {}) {
    this.pending = new Map();
    this.snapshotKeys = new WeakMap();
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.sentSnapshots = new Set();
    for (const kind of ['history', 'redo']) {
      for (const [id, entries] of Object.entries(state[kind])) entries.forEach((entry, index) => {
        const key = `${kind}:${id}:${index}`;
        this.snapshotKeys.set(entry, key); this.sentSnapshots.add(key);
      });
    }
    try {
      this.worker = new WorkerRef('/dist/persistence-worker.js', { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const operation = this.pending.get(data.requestId);
        if (!operation) return;
        this.pending.delete(data.requestId);
        if (data.ok) operation.resolve(data.result);
        else operation.reject(Object.assign(new Error(data.error.message), { name: data.error.name }));
      };
      this.worker.onerror = () => this.fail(new Error('The background save worker stopped. Reload before saving again.'));
      this.worker.onmessageerror = () => this.fail(new Error('The background save worker could not receive data.'));
      this.ready = this.request({ type: 'initialize', state });
      // Connection failure is reported by save/export, without an unhandled rejection.
      this.ready.catch(() => {});
    } catch (error) { this.fail(error); this.ready = Promise.resolve(); }
  }

  fail(error) {
    this.error = error;
    for (const operation of this.pending.values()) operation.reject(error);
    this.pending.clear();
    this.worker?.terminate();
  }

  request(job) {
    if (this.error) return Promise.reject(this.error);
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try { this.worker.postMessage({ requestId, job }); }
      catch (error) { this.pending.delete(requestId); reject(error); }
    });
  }

  save(state, ids) {
    const snapshots = [];
    const reference = (value) => {
      let key = this.snapshotKeys.get(value);
      if (!key) { key = `snapshot:${++this.snapshotSequence}`; this.snapshotKeys.set(value, key); }
      return key;
    };
    const projects = state.workspaces.filter((item) => ids.has(item.id)).map((workspace) => ({
      workspace, chats: state.chats[workspace.id] || [],
      history: (state.history[workspace.id] || []).map(reference),
      redo: (state.redo[workspace.id] || []).map(reference)
    }));
    // Track which immutable snapshots the worker has already received.
    for (const kind of ['history', 'redo']) for (const project of projects) {
      (state[kind][project.workspace.id] || []).forEach((value) => {
        const key = reference(value);
        if (!this.sentSnapshots.has(key)) snapshots.push({ key, value });
      });
    }
    const result = this.request({ type: 'save', order: state.workspaces.map((item) => item.id), projects, snapshots });
    const retained = new Set(['history', 'redo'].flatMap((kind) => Object.values(state[kind]).flat().map(reference)));
    return result.then((value) => {
      const known = new Set(this.sentSnapshots);
      for (const { key } of snapshots) known.add(key);
      this.sentSnapshots = new Set([...known].filter((key) => retained.has(key)));
      return value;
    });
  }

  package(workspace, chats) {
    // postMessage captures this project immediately; later edits cannot change
    // the snapshot while the worker is loading its attachments.
    return this.request({ type: 'package', workspace, chats });
  }
}
