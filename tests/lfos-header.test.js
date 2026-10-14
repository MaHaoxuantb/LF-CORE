import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLFOSHeader } from '../src/lfos-header.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const changes = [], classes = new Set();
  const header = {
    clientWidth: 900, clientHeight: 55, scrollWidth: 900, style: {},
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) }
  };
  let notify, resize;
  const geometry = { canIntegrate: true, mode: 'titlebar', headerHeight: 48, leadingInset: 108, trailingInset: 64 };
  const cleanup = [];
  const integration = {
    connect: async () => {}, has: () => true,
    lfos: { windowChrome: {
      bindDragRegion: (element) => { assert.equal(element, header); return () => cleanup.push('drag'); },
      subscribe: (listener) => { notify = listener; listener(geometry); return () => cleanup.push('subscribe'); },
      setIntegrated: async (active) => { changes.push(active); geometry.mode = active ? 'overlay' : 'titlebar'; return { ...geometry }; }
    } }
  };
  class Observer {
    constructor(callback) { resize = callback; }
    observe(element) { assert.equal(element, header); }
    disconnect() { cleanup.push('observer'); }
  }
  const dispose = attachLFOSHeader(header, integration, { ResizeObserverRef: Observer, onError: assert.fail });
  return { header, changes, cleanup, geometry, dispose, notify: () => notify({ ...geometry }), resize: () => resize() };
}

test('adaptive header reserves SDK insets, responds to zoom, and restores titlebar when too narrow', async () => {
  const f = fixture();
  await tick();
  assert.deepEqual(f.changes, [true]);
  assert.equal(f.header.style.paddingLeft, '116px');
  assert.equal(f.header.style.paddingRight, '72px');
  f.geometry.leadingInset = 216; f.geometry.trailingInset = 128; f.geometry.headerHeight = 96;
  f.header.clientHeight = 100;
  f.notify(); await tick();
  assert.equal(f.header.style.paddingLeft, '224px');
  assert.equal(f.header.style.minHeight, '96px');
  f.header.clientWidth = 300; f.resize(); await tick();
  assert.equal(f.changes.at(-1), false);
  assert.equal(f.header.style.paddingLeft, '8px');
  f.header.clientWidth = 900; f.resize(); await tick();
  assert.equal(f.changes.at(-1), true);
  f.dispose(); await tick();
  assert.deepEqual(f.cleanup, ['observer', 'subscribe', 'drag']);
  assert.equal(f.changes.at(-1), false);
});

test('overflowing actions keep the system titlebar', async () => {
  const f = fixture();
  await tick();
  f.header.scrollWidth = 1100;
  f.resize(); await tick();
  assert.equal(f.changes.at(-1), false);
  f.dispose();
});

test('overflow inside a shrinking toolbar group restores the system titlebar', async () => {
  const f = fixture();
  await tick();
  f.header.children = [{ clientWidth: 86, scrollWidth: 216 }];
  f.resize(); await tick();
  assert.equal(f.changes.at(-1), false);
  assert.equal(f.header.style.paddingRight, '8px');
  f.dispose();
});

test('a standalone app never attaches LFOS header controls', async () => {
  const dispose = attachLFOSHeader({}, { connect: async () => null, has: () => false }, { onError: assert.fail });
  await tick();
  dispose();
});
