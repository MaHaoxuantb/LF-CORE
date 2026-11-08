// Web Locks are the authority; messages only refresh views and request focus.
// No time-based leases: sleeping/background windows retain their ownership.
export class WindowCoordinator {
  constructor({ locks = globalThis.navigator?.locks, Channel = globalThis.BroadcastChannel, onChange = () => {}, onFocus = () => {} } = {}) {
    this.locks = locks;
    this.leases = new Map();
    this.pending = new Map();
    this.onChange = onChange;
    this.onFocus = onFocus;
    this.channel = Channel ? new Channel('lfcore-windows-v1') : null;
    if (this.channel) this.channel.onmessage = ({ data }) => {
      if (data?.type === 'changed') this.onChange();
      if (data?.type === 'focus' && this.leases.has(data.key)) this.onFocus(data.key);
    };
  }
  owns(key) { return this.leases.has(key); }
  acquire(key) {
    if (this.owns(key)) return Promise.resolve(true);
    if (this.pending.has(key)) return this.pending.get(key);
    if (!this.locks) return Promise.reject(new Error('Multiple-window editing requires browser Web Locks. Use a supported secure browser.'));
    const operation = new Promise((resolve, reject) => {
      this.locks.request(`lfcore:${key}`, { ifAvailable: true }, async lock => {
        if (!lock) {
          this.channel?.postMessage({ type: 'focus', key });
          resolve(false); return;
        }
        await new Promise(release => { this.leases.set(key, release); resolve(true); });
      }).catch(reject);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
  release(key) { this.leases.get(key)?.(); this.leases.delete(key); }
  changed() { this.channel?.postMessage({ type: 'changed' }); }
  close() { for (const key of this.leases.keys()) this.release(key); this.channel?.close(); }
}
