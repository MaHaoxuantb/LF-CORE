// The SDK supplies iframe CSS-pixel geometry, including changes in app zoom.
export function attachLFOSHeader(header, integration, { ResizeObserverRef = globalThis.ResizeObserver, onError = console.warn } = {}) {
  let disposed = false, pending = false, rerun = false, geometry = null;
  let observer, unsubscribe, unbind;

  const update = async () => {
    if (disposed || !geometry) return;
    if (pending) { rerun = true; return; }
    const canIntegrate = geometry.canIntegrate;
    header.classList.toggle('lfos-adaptive-header', canIntegrate);
    if (canIntegrate) {
      header.style.minHeight = `${geometry.headerHeight}px`;
      header.style.paddingLeft = `${geometry.leadingInset + 8}px`;
      header.style.paddingRight = `${geometry.trailingInset + 8}px`;
    } else {
      header.style.minHeight = '';
      header.style.paddingLeft = '';
      header.style.paddingRight = '';
    }
    const fits = canIntegrate && header.clientHeight >= geometry.headerHeight &&
      header.clientWidth >= geometry.leadingInset + geometry.trailingInset + 200 &&
      header.scrollWidth <= header.clientWidth &&
      Array.from(header.children || []).every((child) => child.scrollWidth <= child.clientWidth);
    // A shrinking flex group can overflow into its neighbor while the outer row
    // still fits. In fallback mode the shell owns a separate row above the app.
    if (canIntegrate && !fits) {
      header.style.paddingLeft = '8px';
      header.style.paddingRight = '8px';
    }
    if (fits === (geometry.mode === 'overlay')) return;
    pending = true;
    try { geometry = await integration.lfos.windowChrome.setIntegrated(fits); }
    catch (error) { onError('[LF CORE] Could not integrate the LFOS header.', error); }
    finally {
      pending = false;
      if (disposed) void integration.lfos.windowChrome.setIntegrated(false).catch(() => {});
      else if (rerun) { rerun = false; void update(); }
    }
  };

  void integration.connect().then(() => {
    if (disposed || !integration.has('windowChrome.get') || !integration.has('windowChrome.setIntegrated')) return;
    unbind = integration.lfos.windowChrome.bindDragRegion(header);
    unsubscribe = integration.lfos.windowChrome.subscribe((value) => { geometry = value; void update(); });
    observer = new ResizeObserverRef(() => void update());
    observer.observe(header);
  }).catch((error) => onError('[LF CORE] Could not prepare the LFOS header.', error));

  return () => {
    disposed = true;
    observer?.disconnect(); unsubscribe?.(); unbind?.();
    if (unsubscribe) void integration.lfos.windowChrome.setIntegrated(false).catch(() => {});
  };
}
