export class ViewPersistence {
  constructor({ write, onError = () => {}, delay = 500 }) {
    this.write = write;
    this.onError = onError;
    this.delay = delay;
    this.pending = new Map();
    this.revisions = new Map();
    this.queue = Promise.resolve();
  }

  schedule(id, view) {
    const revision = (this.revisions.get(id) || 0) + 1;
    this.revisions.set(id, revision);
    this.pending.set(id, { view: { ...view }, revision });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(this.onError), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    const jobs = [...this.pending];
    this.pending.clear();
    const operation = this.queue.then(async () => {
      let failure;
      for (const [id, job] of jobs) {
        try { await this.write(id, job.view); }
        catch (error) {
          if (this.revisions.get(id) === job.revision) this.pending.set(id, job);
          failure ||= error;
        }
      }
      if (failure) throw failure;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
