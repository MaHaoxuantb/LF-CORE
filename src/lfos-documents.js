// Serialize writes so autosave, explicit save, and Save As cannot race handles.
export class LFOSDocuments {
  constructor({ integration, signature, snapshot, onChange = () => {} }) {
    this.integration = integration;
    this.signature = signature;
    this.snapshot = snapshot;
    this.onChange = onChange;
    this.entries = new Map();
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  remember(id, handle) {
    const previous = this.entries.get(id)?.handle;
    this.entries.set(id, { handle, signature: this.signature(id), error: null, saving: false });
    if (previous && previous.id !== handle.id) void this.enqueue(() => this.integration.release(previous));
    this.onChange();
  }

  forget(id) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    this.onChange();
    // A pending write may replace the handle before its release.
    return entry ? this.enqueue(() => this.integration.release(entry.handle)) : Promise.resolve();
  }

  isDirty(id, entry = this.entries.get(id)) {
    return !!entry && this.signature(id) !== entry.signature;
  }

  save(id, { automatic = false, saveAs = false, allowPicker = false } = {}) {
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (automatic && (!entry || entry.error || !this.isDirty(id, entry))) return null;
      if (!entry && !allowPicker) return null;
      if (entry && !saveAs && !entry.error && !this.isDirty(id, entry)) return { handle: entry.handle, cancelled: false };
      const previousError = entry?.error;
      if (entry) { entry.saving = true; entry.error = null; this.onChange(); }
      try {
        if (!this.integration.has('files.write')) throw new Error('LFOS file write permission is unavailable.');
        const snapshot = await this.snapshot(id);
        const result = await this.integration.saveProject({
          handle: saveAs ? null : entry?.handle,
          suggestedName: snapshot.name,
          contents: snapshot.contents
        });
        if (!result) throw new Error('LFOS could not save this project.');
        if (result.cancelled) {
          if (entry) entry.error = previousError;
          return result;
        }
        const previous = entry?.handle;
        if (entry) entry.handle = result.handle;
        if (!entry || this.entries.get(id) === entry) {
          this.entries.set(id, { handle: result.handle, signature: snapshot.signature, error: null, saving: false });
        }
        if (previous && previous.id !== result.handle.id) await this.integration.release(previous);
        return result;
      } catch (error) {
        if (entry) entry.error = error;
        throw error;
      } finally {
        if (entry) entry.saving = false;
        this.onChange();
      }
    });
  }
}
