import html2canvas from 'html2canvas';
const fail = (code, message) => Object.assign(new Error(message), { code });
export function validateRegion(region, expectedRevision, snapshot) {
  if (snapshot.viewRevision !== expectedRevision) throw fail('CONFLICT', 'The view changed. Inspect it again before capturing.');
  if (!region || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) || region.width <= 0 || region.height <= 0 || region.x < 0 || region.y < 0 || region.x + region.width > snapshot.viewport.width || region.y + region.height > snapshot.viewport.height) throw fail('INVALID_ARGUMENT', 'Select a region within the visible app content.');
}
function ready(promise, signal) {
  return new Promise((resolve, reject) => {
    const finish = (action, value) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); action(value); };
    const cancel = () => finish(reject, fail('CANCELLED', 'Capture cancelled.'));
    const timer = setTimeout(() => finish(reject, fail('UNAVAILABLE', 'Content is still loading. Wait for the preview and capture again.')), 15000);
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), reason => finish(reject, reason));
  });
}
async function png(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(fail('UNAVAILABLE', 'PNG encoding failed.')), 'image/png'));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(fail('UNAVAILABLE', 'PNG bytes could not be read.')); reader.readAsDataURL(blob); });
}
export async function captureRegion(region, expectedRevision, getSnapshot, signal) {
  const intersects = node => { const bounds = node.getBoundingClientRect(); return bounds.right > region.x && bounds.bottom > region.y && bounds.left < region.x + region.width && bounds.top < region.y + region.height; };
  const snapshot = getSnapshot(); validateRegion(region, expectedRevision, snapshot);
  await ready(document.fonts?.ready, signal);
  if (signal?.aborted) throw fail('CANCELLED', 'Capture cancelled.');
  const root = document.querySelector('.workspace-shell');
  if (!root) throw fail('UNAVAILABLE', 'Open the project content before capturing.');
  if (root.querySelector('[data-capture-pending]')) {
    let observer;
    try { await ready(new Promise(resolve => {
      const check = () => { if (![...root.querySelectorAll('[data-capture-pending]')].some(intersects)) resolve(); };
      observer = new MutationObserver(check); observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-capture-pending'] }); check();
    }), signal); } finally { observer?.disconnect(); }
  }
  for (const image of root.querySelectorAll('img')) {
    if (image.closest('.ai-panel') || !intersects(image)) continue;
    try { await ready(image.decode(), signal); } catch { throw fail('UNAVAILABLE', 'An image is not ready. Wait for it to load and capture again.'); }
    const url = new URL(image.currentSrc || image.src, location.href);
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== location.origin && image.crossOrigin !== 'anonymous') throw fail('UNAVAILABLE', 'A cross-origin image cannot be exported. Import a local copy first.');
  }
  // html2canvas 1.4 predates computed CSS Color 4 values (including color-mix results).
  // Resolve those through the browser's own canvas color parser before cloning.
  const colorCanvas = document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
  if (!colorContext) throw fail('UNAVAILABLE', 'Canvas rendering is unavailable in this browser.');
  const normalizeColors = value => value.replace(/(?:color|oklch|oklab|lab|lch)\([^)]*\)/g, color => {
    colorContext.clearRect(0, 0, 1, 1); colorContext.fillStyle = color; colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  });
  const colorKeys = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow'];
  const originalElements = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
  const resolvedColors = originalElements.map(node => { const style = getComputedStyle(node); return colorKeys.map(key => [key, normalizeColors(style.getPropertyValue(key)).replace(/url\([\"\']?[^)]*#([^\"\')]+)[\"\']?\)/g, 'url(#$1)')]); });
  const replacements = [];
  for (const node of root.querySelectorAll('canvas, svg, video')) {
    if (node.closest('.ai-panel') || !intersects(node)) continue;
    if (node.tagName.toLowerCase() === 'canvas') { try { node.toDataURL('image/png'); } catch { throw fail('UNAVAILABLE', 'A protected preview cannot be captured.'); } }
    if (node.tagName.toLowerCase() === 'video') {
      if (node.readyState < 2) throw fail('UNAVAILABLE', 'Load a video frame before capturing it.');
      const frame = document.createElement('canvas');
      const ratio = Math.min(1, 2048 / Math.max(node.videoWidth, node.videoHeight));
      frame.width = Math.max(1, Math.round(node.videoWidth * ratio)); frame.height = Math.max(1, Math.round(node.videoHeight * ratio));
      try { frame.getContext('2d').drawImage(node, 0, 0, frame.width, frame.height); replacements.push({ node, url: frame.toDataURL('image/png') }); }
      catch { throw fail('UNAVAILABLE', 'This video frame is protected and cannot be exported.'); }
    }
    // html2canvas does not paint inline SVG paths; inline their resolved styles.
    if (node.tagName.toLowerCase() === 'svg') {
      const clone = node.cloneNode(true), originals = [node, ...node.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
      copies.forEach((copy, index) => { const style = getComputedStyle(originals[index]); for (const key of ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'font', 'color', 'stop-color', 'stop-opacity', 'marker-start', 'marker-end']) copy.style.setProperty(key, normalizeColors(style.getPropertyValue(key)).replace(/url\([\"\']?[^)]*#([^\"\')]+)[\"\']?\)/g, 'url(#$1)')); });
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(bounds.width)); clone.setAttribute('height', String(bounds.height));
      replacements.push({ node, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)) });
    }
  }
  validateRegion(region, expectedRevision, getSnapshot());
  const styleIds = originalElements.map((node, index) => { const previous = node.getAttribute('data-capture-style'); node.setAttribute('data-capture-style', String(index)); return { node, previous }; });
  const ids = replacements.map(({ node }, index) => { const previous = node.getAttribute('data-capture-svg'); node.setAttribute('data-capture-svg', String(index)); return { node, previous }; });
  let canvas;
  try {
    canvas = await html2canvas(document.body, { x: region.x, y: region.y, width: region.width, height: region.height, scale: Math.min(devicePixelRatio || 1, 2, 8192 / Math.max(region.width, region.height), Math.sqrt(16_777_216 / (region.width * region.height))), useCORS: true, allowTaint: false, foreignObjectRendering: false, logging: false,
      ignoreElements: node => !!node.closest?.('.ai-panel, lfos-agent-panel, .capture-overlay, .screenshot-preview'),
      onclone(doc) {
        for (const target of doc.querySelectorAll('[data-capture-style]')) { const colors = resolvedColors[Number(target.getAttribute('data-capture-style'))]; if (target.style && colors) for (const [key, value] of colors) target.style.setProperty(key, value, 'important'); }
        for (let index = 0; index < replacements.length; index++) { const node = doc.querySelector(`[data-capture-svg="${index}"]`); if (!node) continue; const image = doc.createElement('img'); image.src = replacements[index].url; image.style.cssText = node.style.cssText; image.style.width = `${replacements[index].node.clientWidth}px`; image.style.height = `${replacements[index].node.clientHeight}px`; image.style.objectFit = getComputedStyle(replacements[index].node).objectFit; image.setAttribute('class', node.getAttribute('class') || ''); node.replaceWith(image); }
        const scene = doc.querySelector('.scene'); if (scene) { const { camera } = snapshot; scene.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`; }
      },
    });
  } finally { for (const { node, previous } of styleIds) { if (previous === null) node.removeAttribute('data-capture-style'); else node.setAttribute('data-capture-style', previous); } for (const { node, previous } of ids) previous === null ? node.removeAttribute('data-capture-svg') : node.setAttribute('data-capture-svg', previous); }
  if (signal?.aborted) throw fail('CANCELLED', 'Capture cancelled.');
  validateRegion(region, expectedRevision, getSnapshot());
  const dataBase64 = await png(canvas);
  if (dataBase64.length > 8_000_000) throw fail('INVALID_ARGUMENT', 'Image is too large. Capture a smaller region.');
  const preview = document.createElement('canvas');
  let ratio = Math.min(1, 2048 / Math.max(canvas.width, canvas.height)); let previewBase64;
  do { preview.width = Math.max(1, Math.round(canvas.width * ratio)); preview.height = Math.max(1, Math.round(canvas.height * ratio)); preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height); previewBase64 = await png(preview); ratio *= .75; } while (previewBase64.length > 1_024_000 && ratio > .05);
  if (previewBase64.length > 1_024_000) throw fail('INVALID_ARGUMENT', 'Image is too large for visual inspection. Capture a smaller region.');
  return { dataBase64, previewBase64, width: canvas.width, height: canvas.height };
}
export function selectRegion() {
  return new Promise(resolve => {
    const overlay = document.createElement('div'); overlay.className = 'capture-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Drag to select a screenshot region. Escape cancels.'); overlay.tabIndex = -1;
    const box = document.createElement('div'); box.className = 'capture-region'; overlay.append(box);
    let start;
    const finish = region => { document.removeEventListener('keydown', key, true); overlay.remove(); resolve(region); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); } };
    overlay.onpointerdown = event => { start = { x: event.clientX, y: event.clientY }; overlay.setPointerCapture(event.pointerId); };
    const bounds = event => ({ x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) });
    overlay.onpointermove = event => { if (!start) return; const r = bounds(event); Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }); };
    overlay.onpointerup = event => { if (!start) return; const r = bounds(event); finish(r.width > 1 && r.height > 1 ? r : null); };
    overlay.onpointercancel = () => finish(null);
    document.addEventListener('keydown', key, true); document.body.append(overlay); overlay.focus();
  });
}
export async function exportPng(dataUrl, title, integration) {
  if (integration.connected) {
    if (!integration.has('files.save') || !integration.has('files.write')) throw fail('UNAVAILABLE', 'Enable LFOS file Save permission to export this image.');
    const handle = await integration.lfos.files.save({ suggestedName: `${title}.png`, accept: [{ description: 'PNG image', extensions: ['.png'], mimeTypes: ['image/png'] }] });
    if (!handle) return false;
    await integration.lfos.files.write(handle, Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)));
  } else { const link = document.createElement('a'); link.href = dataUrl; link.download = `${title}.png`; document.body.append(link); link.click(); link.remove(); }
  return true;
}
