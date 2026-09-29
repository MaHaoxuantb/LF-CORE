export const CANVAS_GRID_SIZE = 24;
export const ALIGNMENT_TOLERANCE_PX = 6;

export function snapValue(value, gridSize = CANVAS_GRID_SIZE) {
  if (!Number.isFinite(value) || !Number.isFinite(gridSize) || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function selectionBounds(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function axisAnchors(rect, axis) {
  if (axis === 'x') return [
    { name: 'left', value: rect.x },
    { name: 'center', value: rect.x + rect.width / 2 },
    { name: 'right', value: rect.x + rect.width }
  ];
  return [
    { name: 'top', value: rect.y },
    { name: 'center', value: rect.y + rect.height / 2 },
    { name: 'bottom', value: rect.y + rect.height }
  ];
}

function bestAlignment(moving, targets, axis, tolerance, movingNames = null, targetNames = null) {
  const movingAnchors = axisAnchors(moving, axis).filter((anchor) => !movingNames || movingNames.includes(anchor.name));
  const candidates = [];
  for (const target of targets) {
    const targetAnchors = axisAnchors(target, axis).filter((anchor) => !targetNames || targetNames.includes(anchor.name));
    for (const movingAnchor of movingAnchors) {
      for (const targetAnchor of targetAnchors) {
        const adjustment = targetAnchor.value - movingAnchor.value;
        if (Math.abs(adjustment) > tolerance) continue;
        candidates.push({
          adjustment,
          value: targetAnchor.value,
          movingAnchor: movingAnchor.name,
          targetAnchor: targetAnchor.name,
          targetId: String(target.id ?? ''),
          target
        });
      }
    }
  }
  candidates.sort((a, b) => Math.abs(a.adjustment) - Math.abs(b.adjustment)
    || a.targetId.localeCompare(b.targetId)
    || a.value - b.value
    || a.movingAnchor.localeCompare(b.movingAnchor)
    || a.targetAnchor.localeCompare(b.targetAnchor));
  return candidates[0] || null;
}

function guideFor(match, moving, axis) {
  if (!match) return null;
  return axis === 'x'
    ? {
        axis,
        value: match.value,
        from: Math.min(moving.y, match.target.y),
        to: Math.max(moving.y + moving.height, match.target.y + match.target.height)
      }
    : {
        axis,
        value: match.value,
        from: Math.min(moving.x, match.target.x),
        to: Math.max(moving.x + moving.width, match.target.x + match.target.width)
      };
}

function toleranceInCanvasUnits(zoom, tolerancePx) {
  return tolerancePx / Math.max(Number(zoom) || 1, 0.01);
}

export function resolveMoveGeometry({
  bounds,
  dx,
  dy,
  targets = [],
  snapping = false,
  alignment = false,
  gridSize = CANVAS_GRID_SIZE,
  zoom = 1,
  tolerancePx = ALIGNMENT_TOLERANCE_PX
}) {
  let x = bounds.x + dx;
  let y = bounds.y + dy;
  if (snapping) {
    x = snapValue(x, gridSize);
    y = snapValue(y, gridSize);
  }
  const proposed = { ...bounds, x, y };
  let xMatch = null;
  let yMatch = null;
  if (alignment && targets.length) {
    const tolerance = toleranceInCanvasUnits(zoom, tolerancePx);
    xMatch = bestAlignment(proposed, targets, 'x', tolerance);
    yMatch = bestAlignment(proposed, targets, 'y', tolerance);
    if (xMatch) x += xMatch.adjustment;
    if (yMatch) y += yMatch.adjustment;
  }
  const finalRect = { ...bounds, x, y };
  return {
    dx: x - bounds.x,
    dy: y - bounds.y,
    guides: [guideFor(xMatch, finalRect, 'x'), guideFor(yMatch, finalRect, 'y')].filter(Boolean)
  };
}

export function resolveResizeGeometry({
  rect,
  width,
  height,
  targets = [],
  snapping = false,
  alignment = false,
  gridSize = CANVAS_GRID_SIZE,
  zoom = 1,
  tolerancePx = ALIGNMENT_TOLERANCE_PX,
  axes = ['x', 'y']
}) {
  let right = rect.x + width;
  let bottom = rect.y + height;
  if (snapping) {
    if (axes.includes('x')) right = snapValue(right, gridSize);
    if (axes.includes('y')) bottom = snapValue(bottom, gridSize);
  }
  const proposed = { x: rect.x, y: rect.y, width: right - rect.x, height: bottom - rect.y };
  let xMatch = null;
  let yMatch = null;
  if (alignment && targets.length) {
    const tolerance = toleranceInCanvasUnits(zoom, tolerancePx);
    if (axes.includes('x')) xMatch = bestAlignment(proposed, targets, 'x', tolerance, ['right'], ['left', 'right']);
    if (axes.includes('y')) yMatch = bestAlignment(proposed, targets, 'y', tolerance, ['bottom'], ['top', 'bottom']);
    if (xMatch) right += xMatch.adjustment;
    if (yMatch) bottom += yMatch.adjustment;
  }
  const finalRect = { x: rect.x, y: rect.y, width: right - rect.x, height: bottom - rect.y };
  return {
    width: right - rect.x,
    height: bottom - rect.y,
    guides: [guideFor(xMatch, finalRect, 'x'), guideFor(yMatch, finalRect, 'y')].filter(Boolean)
  };
}
