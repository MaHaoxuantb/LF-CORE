export const LFOS_SDK_URL = 'https://os.linecoflow.com/sdk/v1/lfos.js';
export const LFCORE_MIME_TYPE = 'application/vnd.linecoflow.project+json';
export const LFCORE_FILE_FILTER = Object.freeze([{
  description: 'LF CORE Project',
  extensions: ['.lfcore'],
  mimeTypes: [LFCORE_MIME_TYPE]
}]);

function isFramed(windowRef) {
  if (!windowRef) return false;
  try { return windowRef.self !== windowRef.top; }
  catch { return true; }
}

export class LFOSIntegration {
  constructor({
    windowRef = globalThis.window,
    loadSdk = () => import(LFOS_SDK_URL)
  } = {}) {
    this.windowRef = windowRef;
    this.loadSdk = loadSdk;
    this.lfos = null;
    this.environment = null;
    this.error = null;
    this.connection = null;
    this.unsavedChanges = false;
    this.lifecycleQueue = Promise.resolve();
  }

  isPotentiallyAvailable() { return isFramed(this.windowRef); }
  get connected() { return this.environment?.name === 'LFOS'; }

  async connect() {
    if (this.connection) return this.connection;
    if (!this.isPotentiallyAvailable()) return null;
    this.connection = (async () => {
      try {
        const module = await this.loadSdk();
        const sdk = module?.lfos || this.windowRef?.lfos;
        if (!sdk?.ready) throw new Error('The LFOS SDK is unavailable.');
        const environment = await sdk.ready();
        if (environment?.name !== 'LFOS' || environment.protocolVersion !== 1) {
          throw new Error('The LFOS host is incompatible.');
        }
        this.lfos = sdk;
        this.environment = environment;
        this.error = null;
        return environment;
      } catch (error) {
        this.lfos = null;
        this.environment = null;
        this.error = error;
        return null;
      }
    })();
    return this.connection;
  }

  has(capability) {
    if (!this.connected) return false;
    if (this.lfos?.capabilities?.has) return this.lfos.capabilities.has(capability);
    return this.environment.capabilities?.includes(capability) === true;
  }

  get intelligenceAvailable() {
    return this.has('ai.responses.text') && typeof this.lfos?.ai?.responses?.create === 'function';
  }

  async completeText(messages, effort, { signal, onDelta } = {}) {
    await this.connect();
    if (!this.intelligenceAvailable) throw new Error('SolOS Intelligence is unavailable. Check SolOS connection and AI permission, or choose another provider in AI Settings.');
    const cancelled = () => new Error('SolOS Intelligence request was canceled.');
    if (signal?.aborted) throw cancelled();
    const stream = await this.lfos.ai.responses.create({
      input: messages.map(({ role, content }) => ({ role: role === 'system' ? 'developer' : role, content })),
      reasoning: { effort },
      text: { format: { type: 'text' } },
      maxOutputTokens: 16384
    });
    // Observe rejection immediately, including cancellation before iteration starts.
    const completed = stream.completed.then(value => ({ value }), error => ({ error }));
    const cancel = () => stream.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    let text = '', finished = false;
    try {
      if (signal?.aborted) { cancel(); throw cancelled(); }
      for await (const event of stream) {
        if (signal?.aborted) throw cancelled();
        if (event.type === 'output_text.delta') {
          text += event.delta;
          onDelta?.(event.delta, text);
        }
      }
      const result = await completed;
      if (signal?.aborted) throw cancelled();
      if (result.error) throw result.error;
      if (!text.trim()) throw new Error('SolOS Intelligence returned an empty response.');
      finished = true;
      return text.trim();
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (!finished) cancel();
    }
  }

  async openProject() {
    await this.connect();
    if (!this.has('files.open') || !this.has('files.read')) return null;
    const handle = await this.lfos.files.open({ title: 'Open LF CORE Project', accept: LFCORE_FILE_FILTER });
    return handle ? this.readProject(handle) : null;
  }

  async initialProject() {
    await this.connect();
    if (!this.has('activation.getInitial') || !this.has('files.read')) return null;
    const activation = await this.lfos.activation.getInitial();
    return activation?.type === 'open-file' && activation.file ? this.readProject(activation.file) : null;
  }

  async readProject(handle) {
    try {
      const bytes = await this.lfos.files.read(handle);
      return {
        handle,
        file: new File([bytes], handle.name, { type: handle.type || LFCORE_MIME_TYPE, lastModified: handle.lastModified })
      };
    } catch (error) {
      await this.release(handle);
      throw error;
    }
  }

  async saveProject({ handle = null, suggestedName, contents }) {
    await this.connect();
    if (!this.has('files.write')) return null;
    let destination = handle;
    let created = false;
    if (!destination) {
      if (!this.has('files.save')) return null;
      destination = await this.lfos.files.save({
        title: 'Save LF CORE Project',
        suggestedName,
        requiredExtension: '.lfcore',
        mimeType: LFCORE_MIME_TYPE
      });
      if (!destination) return { cancelled: true, handle: null };
      created = true;
    }
    try {
      const updated = await this.lfos.files.write(destination, contents);
      return { cancelled: false, handle: updated || destination };
    } catch (error) {
      if (created) await this.release(destination);
      throw error;
    }
  }

  async setUnsavedChanges(dirty) {
    const next = !!dirty;
    const operation = this.lifecycleQueue.then(async () => {
      await this.connect();
      if (!this.has('lifecycle.setUnsavedChanges') || next === this.unsavedChanges) return false;
      await this.lfos.lifecycle.setUnsavedChanges(next);
      this.unsavedChanges = next;
      return true;
    });
    this.lifecycleQueue = operation.catch(() => {});
    return operation;
  }

  async release(handle) {
    if (!handle || !this.lfos?.files?.release) return;
    try { await this.lfos.files.release(handle); }
    catch { /* A released or expired handle needs no further cleanup. */ }
  }
}

export function createLFOSIntegration(options) { return new LFOSIntegration(options); }
