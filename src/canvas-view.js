export function hasCanvasView(view) {
  return !!view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom) && view.zoom > 0;
}

export function fittedCanvasView(bounds, viewport, article) {
  const minX = Math.min(-430, ...bounds.map((point) => point.x));
  const maxX = Math.max(article.width + 80, ...bounds.map((point) => point.x + point.width));
  const minY = Math.min(-80, ...bounds.map((point) => point.y));
  const maxY = Math.max(article.height + 80, ...bounds.map((point) => point.y + point.height));
  const width = maxX - minX + 160, height = maxY - minY + 160;
  const zoom = Math.max(.45, Math.min(1, viewport.width / width, viewport.height / height));
  return {
    zoom,
    x: viewport.width / 2 - ((minX + maxX) / 2) * zoom,
    y: viewport.height / 2 - ((minY + maxY) / 2) * zoom
  };
}

export function canvasTransform(view) {
  if (!hasCanvasView(view)) throw new TypeError('Canvas camera coordinates must be finite and zoom must be positive.');
  return `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;
}
