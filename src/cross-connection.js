const SIDES = ['left', 'top', 'right', 'bottom'];

export function connectionPort(rect, side, gap = 0) {
  const middleX = rect.x + rect.width / 2;
  const middleY = rect.y + rect.height / 2;
  switch (side) {
    case 'left': return { x: rect.x - gap, y: middleY, nx: -1, ny: 0 };
    case 'right': return { x: rect.x + rect.width + gap, y: middleY, nx: 1, ny: 0 };
    case 'top': return { x: middleX, y: rect.y - gap, nx: 0, ny: -1 };
    case 'bottom': return { x: middleX, y: rect.y + rect.height + gap, nx: 0, ny: 1 };
    default: throw new Error(`Unknown connection side: ${side}`);
  }
}

export function nearestConnectionSide(rect, x, y) {
  return SIDES.reduce((nearest, side) => {
    const port = connectionPort(rect, side);
    const distance = (port.x - x) ** 2 + (port.y - y) ** 2;
    return distance < nearest.distance ? { side, distance } : nearest;
  }, { side: 'left', distance: Infinity }).side;
}

export function crossConnectionRoute(from, to, fromSide = 'auto', toSide = 'auto') {
  const fromMiddle = from.x + from.width / 2;
  const toMiddle = to.x + to.width / 2;
  const startSide = fromSide === 'auto' ? (toMiddle >= fromMiddle ? 'right' : 'left') : fromSide;
  const endSide = toSide === 'auto' ? (toMiddle >= fromMiddle ? 'left' : 'right') : toSide;
  // Keep both arrowheads just outside the cards so neither is hidden by a card.
  const start = connectionPort(from, startSide, 8);
  const end = connectionPort(to, endSide, 8);
  const bend = Math.min(140, Math.max(48, Math.hypot(end.x - start.x, end.y - start.y) * .38));
  const c1x = start.x + start.nx * bend;
  const c1y = start.y + start.ny * bend;
  const c2x = end.x + end.nx * bend;
  const c2y = end.y + end.ny * bend;
  return {
    d: `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`,
    x1: start.x, y1: start.y, x2: end.x, y2: end.y,
    fromSide: startSide, toSide: endSide,
  };
}
