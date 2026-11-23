import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_DEFAULTS,
  LAYOUT_KEY,
  clampWidth,
  normalizeLayout,
  readLayout,
  writeLayout,
  applyLayout,
  syncSvgCanvas,
  COL_TO_RESIZE,
} from './layout-widths.js';

test('clampWidth respects per-key limits', () => {
  assert.equal(clampWidth('rail', 50), 180);
  assert.equal(clampWidth('rail', 9999), 520);
  assert.equal(clampWidth('labels', 148), 148);
  assert.equal(clampWidth('svg', 200), 200);
  assert.equal(clampWidth('svg', 10), 72);
  assert.equal(clampWidth('who', 100), 48);
});

test('normalizeLayout fills defaults and clamps', () => {
  assert.deepEqual(normalizeLayout(null), { ...LAYOUT_DEFAULTS });
  assert.deepEqual(normalizeLayout({ rail: 400, labels: 10, svg: 180 }), {
    ...LAYOUT_DEFAULTS,
    rail: 400,
    labels: 72,
    svg: 180,
  });
});

test('graph column is resizable; commit is flex', () => {
  assert.equal(COL_TO_RESIZE.graph, 'svg');
  assert.equal(COL_TO_RESIZE.commit, undefined);
});

test('read/write round-trip through storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  const saved = writeLayout({ rail: 320, sha: 80, svg: 160 }, storage);
  assert.equal(saved.rail, 320);
  assert.equal(saved.sha, 80);
  assert.equal(saved.svg, 160);
  assert.equal(JSON.parse(store.get(LAYOUT_KEY)).svg, 160);
  assert.deepEqual(readLayout(storage).svg, 160);
});

test('applyLayout sets CSS variables', () => {
  const style = new Map();
  const root = { style: { setProperty: (k, v) => style.set(`root:${k}`, v) } };
  const graph = { style: { setProperty: (k, v) => style.set(`graph:${k}`, v) }, querySelector: () => null };
  applyLayout({ rail: 280, labels: 160, svg: 140, who: 24, sha: 72, when: 120 }, { root, graph });
  assert.equal(style.get('root:--rail-w'), '280px');
  assert.equal(style.get('graph:--graph-labels-w'), '160px');
  assert.equal(style.get('graph:--graph-svg-w'), '140px');
  assert.equal(style.get('graph:--graph-who-w'), '24px');
  assert.equal(style.get('graph:--graph-sha-w'), '72px');
  assert.equal(style.get('graph:--graph-when-w'), '120px');
});

test('syncSvgCanvas updates width and viewBox without changing height', () => {
  const attrs = { width: '136', height: '300', viewBox: '0 0 136 300' };
  const svg = {
    viewBox: { baseVal: { width: 136, height: 300 } },
    getAttribute: (k) => attrs[k],
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  const graph = { querySelector: () => svg };
  syncSvgCanvas(graph, 200);
  assert.equal(attrs.width, '200');
  assert.equal(attrs.viewBox, '0 0 200 300');
  assert.equal(attrs.height, '300');
});
