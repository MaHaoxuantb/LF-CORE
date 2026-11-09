// Two fingers own the camera. One finger keeps selection, drag and edit behavior.
export function attachCanvasTouch(viewport, { getView, updateView, saveView, setActive }) {
  const host = viewport.ownerDocument.defaultView;
  const pointers = new Map();
  let gesture = null, contentScroll = null, suppressClick = false, handingOff = false;
  const point = (event) => ({ x: event.clientX, y: event.clientY, target: event.target });
  const center = () => {
    const [a, b = a] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
  };
  const capture = (id) => viewport.setPointerCapture(id);
  const release = (id) => { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); };
  const baseline = () => { gesture = { ...gesture, camera: { ...getView() }, origin: center() }; };
  const cancelInteraction = () => {
    // Let the existing drag, resize, link and marquee handlers roll back their
    // previews before transferring capture to the camera gesture.
    handingOff = true;
    for (const [pointerId, entry] of pointers) {
      entry.target.dispatchEvent(new host.PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'touch' }));
    }
    handingOff = false;
  };
  const stop = () => {
    const ids = [...pointers.keys()];
    pointers.clear();
    const changed = gesture?.changed && !gesture.scrolling;
    gesture = null;
    contentScroll = null;
    host.removeEventListener('pointermove', move, true);
    host.removeEventListener('pointerup', finish, true);
    host.removeEventListener('pointercancel', finish, true);
    host.removeEventListener('blur', cancel);
    viewport.removeEventListener('lostpointercapture', lost);
    ids.forEach(release);
    viewport.classList.remove('panning');
    setActive(false);
    if (changed) saveView();
  };
  const cancel = () => { if (gesture) suppressClick = true; stop(); };
  const lost = (event) => { if (event.target === viewport && !handingOff && gesture && pointers.has(event.pointerId) && !viewport.hasPointerCapture(event.pointerId)) cancel(); };
  const move = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { ...point(event), target: previous.target });
    if (!gesture && contentScroll) {
      if (Math.hypot(event.clientX - contentScroll.x, event.clientY - contentScroll.y) < 8 || host.getSelection()?.isCollapsed === false) return;
      cancelInteraction();
      gesture = { scrolling: true, changed: true };
      capture(event.pointerId);
      setActive(true);
    }
    if (!gesture) return;
    if (gesture.scrolling) {
      suppressClick = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      contentScroll.element.scrollLeft = contentScroll.left - (event.clientX - contentScroll.x) / contentScroll.zoom;
      contentScroll.element.scrollTop = contentScroll.top - (event.clientY - contentScroll.y) / contentScroll.zoom;
      return;
    }
    if (pointers.size < 2) return;
    const current = center(), { origin, camera } = gesture;
    if (!gesture.changed && Math.hypot(current.x - origin.x, current.y - origin.y) < 8 && Math.abs(current.distance - origin.distance) < 8) return;
    gesture.changed = true;
    suppressClick = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = viewport.getBoundingClientRect();
    const zoom = pointers.size > 1 && origin.distance > 0
      ? Math.max(.35, Math.min(1.8, camera.zoom * current.distance / origin.distance)) : camera.zoom;
    updateView({
      zoom,
      x: current.x - rect.left - (origin.x - rect.left - camera.x) / camera.zoom * zoom,
      y: current.y - rect.top - (origin.y - rect.top - camera.y) / camera.zoom * zoom
    });
    viewport.classList.add('panning');
  };
  const finish = (event) => {
    if (handingOff || !pointers.has(event.pointerId)) return;
    const owned = !!gesture;
    if (owned && event.type === 'pointerup') move(event);
    if (owned && event.type === 'pointercancel') { suppressClick = true; stop(); return; }
    pointers.delete(event.pointerId);
    if (owned) {
      release(event.pointerId);
      if (pointers.size) baseline();
      else stop();
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (!pointers.size) stop();
  };
  viewport.addEventListener('pointerdown', (event) => {
    if (!pointers.size) suppressClick = false;
    if (event.pointerType !== 'touch') return;
    const control = event.target.closest('button, input, textarea, select, a, [contenteditable], audio, video');
    if (!pointers.size && control && !control.matches('.resize-grip, .link-grip, .connection-handle')) return;
    pointers.set(event.pointerId, point(event));
    if (pointers.size === 1) {
      host.addEventListener('pointermove', move, { capture: true, passive: false });
      host.addEventListener('pointerup', finish, true);
      host.addEventListener('pointercancel', finish, true);
      host.addEventListener('blur', cancel);
      viewport.addEventListener('lostpointercapture', lost);
      const content = event.target.closest('.topic-card.selected .node-content:not(.source-node-content)');
      if (content && (content.scrollHeight > content.clientHeight || content.scrollWidth > content.clientWidth)) {
        contentScroll = { element: content, x: event.clientX, y: event.clientY, left: content.scrollLeft, top: content.scrollTop, zoom: getView().zoom };
      }
      // Let the existing one-finger marquee and card handlers receive the touch.
      return;
    } else {
      cancelInteraction();
      contentScroll = null;
      gesture = { changed: gesture?.changed || false };
      baseline();
      suppressClick = true;
      host.getSelection()?.removeAllRanges();
      for (const id of pointers.keys()) capture(id);
      closeAndCapture(event);
    }
  }, true);
  function closeAndCapture(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    capture(event.pointerId);
    setActive(true);
  }
  viewport.addEventListener('click', (event) => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  // Keep native context menus from interrupting active touch navigation.
  viewport.addEventListener('contextmenu', (event) => {
    if (gesture) event.preventDefault();
  }, true);
}
