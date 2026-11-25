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
  fitHeightsToBudget,
  allocateOpenHeights,
  maxHeightForKey,
  measureOpenBodyBudget,
  resizeSectionHeights,
  openSectionKeys,
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

test('applySectionHeights sets height and max-height', () => {
  const nodes = [
    { dataset: { section: 'lanes' }, style: {} },
    { dataset: { section: 'local' }, style: {} },
  ];
  const root = { querySelectorAll: () => nodes };
  applySectionHeights(root, { lanes: 96, local: 220 });
  assert.equal(nodes[0].style.height, '96px');
  assert.equal(nodes[0].style.maxHeight, '96px');
  assert.equal(nodes[1].style.height, '220px');
  assert.equal(nodes[1].style.maxHeight, '220px');
});

test('fitHeightsToBudget shrinks proportionally and floors at min', () => {
  const fitted = fitHeightsToBudget(
    { lanes: 200, worktrees: 200, local: 200, remote: 200 },
    ['lanes', 'local'],
    200,
  );
  assert.equal(fitted.lanes + fitted.local, 200);
  assert.ok(fitted.lanes >= SECTION_HEIGHT_MIN);
  assert.ok(fitted.local >= SECTION_HEIGHT_MIN);
});

test('allocateOpenHeights gives leftover to the last open section', () => {
  const allocated = allocateOpenHeights(
    { lanes: 100, local: 100, remote: 100 },
    ['lanes', 'local'],
    400,
  );
  assert.equal(allocated.lanes, 100);
  assert.equal(allocated.local, 300); // last open absorbs leftover
  assert.equal(allocated.lanes + allocated.local, 400);
});

test('allocateOpenHeights shrinks when prefs exceed budget', () => {
  const allocated = allocateOpenHeights(
    { lanes: 200, local: 200 },
    ['lanes', 'local'],
    200,
  );
  assert.equal(allocated.lanes + allocated.local, 200);
});

test('maxHeightForKey allows stealing down to sibling mins', () => {
  assert.equal(
    maxHeightForKey({ lanes: 120, local: 200 }, 'local', ['lanes', 'local'], 400),
    400 - SECTION_HEIGHT_MIN,
  );
});

test('resizeSectionHeights grows one and shrinks siblings to fit', () => {
  const next = resizeSectionHeights(
    { lanes: 120, worktrees: 120, local: 200, remote: 160 },
    'local',
    300,
    ['lanes', 'worktrees', 'local'],
    500,
  );
  assert.equal(next.local, 300);
  assert.equal(next.lanes + next.worktrees + next.local, 500);
  assert.ok(next.lanes >= SECTION_HEIGHT_MIN);
  assert.ok(next.worktrees >= SECTION_HEIGHT_MIN);
});

test('resizeSectionHeights can shrink the dragged section', () => {
  const next = resizeSectionHeights(
    { lanes: 120, local: 280 },
    'local',
    100,
    ['lanes', 'local'],
    400,
  );
  assert.equal(next.local, 100);
  assert.equal(next.lanes + next.local, 400); // sibling absorbs freed space
});

test('measureOpenBodyBudget subtracts chrome and skips open bodies', () => {
  const header = { offsetHeight: 34, hasAttribute: () => false };
  const body = {
    offsetHeight: 200,
    hasAttribute: (n) => n === 'data-section',
  };
  const searchChild = { offsetHeight: 40, hasAttribute: () => false };
  const scroll = {
    clientHeight: 500,
    children: [
      { offsetHeight: 40, children: [searchChild] },
      { offsetHeight: 234, children: [header, body] },
      { offsetHeight: 34, children: [header] },
    ],
    querySelectorAll: () => [{}, {}],
  };
  assert.equal(measureOpenBodyBudget(scroll), 500 - (40 + 34 + 34 + 1));
});

test('openSectionKeys lists visible data-section keys', () => {
  const root = {
    querySelectorAll: (sel) => {
      assert.equal(sel, '[data-section]:not([hidden])');
      return [{ dataset: { section: 'local' } }];
    },
  };
  assert.deepEqual(openSectionKeys(root), ['local']);
});
