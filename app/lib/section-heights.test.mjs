import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_HEIGHT_DEFAULTS,
  SECTION_HEIGHTS_KEY,
  SECTION_HEIGHT_MIN,
  SECTION_HEIGHT_MAX,
  clampSectionHeight,
  normalizeSectionHeights,
  readSectionHeights,
  writeSectionHeights,
  applySectionHeights,
} from './section-heights.js';

test('clampSectionHeight respects min/max', () => {
  assert.equal(clampSectionHeight(10), SECTION_HEIGHT_MIN);
  assert.equal(clampSectionHeight(9999), SECTION_HEIGHT_MAX);
  assert.equal(clampSectionHeight(120), 120);
  assert.equal(clampSectionHeight('nope'), SECTION_HEIGHT_DEFAULTS.lanes);
});

test('normalizeSectionHeights fills defaults and clamps', () => {
  assert.deepEqual(normalizeSectionHeights(null), { ...SECTION_HEIGHT_DEFAULTS });
  assert.deepEqual(normalizeSectionHeights({ lanes: 40, local: 240, remote: 9999 }), {
    ...SECTION_HEIGHT_DEFAULTS,
    lanes: SECTION_HEIGHT_MIN,
    local: 240,
    remote: SECTION_HEIGHT_MAX,
  });
});

test('read/write round-trip through storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  const saved = writeSectionHeights({ lanes: 80, local: 300 }, storage);
  assert.equal(saved.lanes, 80);
  assert.equal(saved.local, 300);
  assert.equal(JSON.parse(store.get(SECTION_HEIGHTS_KEY)).lanes, 80);
  assert.deepEqual(readSectionHeights(storage).local, 300);
});

test('corrupt storage falls back to defaults', () => {
  const storage = {
    getItem: () => '{not json',
    setItem: () => {},
  };
  assert.deepEqual(readSectionHeights(storage), { ...SECTION_HEIGHT_DEFAULTS });
});

test('applySectionHeights sets height and max-height on data-section nodes', () => {
  const nodes = [
    { dataset: { section: 'lanes' }, style: {} },
    { dataset: { section: 'local' }, style: {} },
  ];
  const root = {
    querySelectorAll: () => nodes,
  };
  applySectionHeights(root, { lanes: 96, local: 220 });
  assert.equal(nodes[0].style.height, '96px');
  assert.equal(nodes[0].style.maxHeight, '96px');
  assert.equal(nodes[1].style.height, '220px');
  assert.equal(nodes[1].style.maxHeight, '220px');
});
