import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STEPS, visibleSteps, placeCard } from './tour.js';

test('steps with a hidden target are dropped, anchorless ones stay', () => {
  const shown = visibleSteps(TOUR_STEPS, (sel) => sel === '.searchbtn');
  assert.deepEqual(shown.map((s) => s.sel), [undefined, '.searchbtn', undefined]);
});

test('every anchored step is shown on a full board', () => {
  assert.equal(visibleSteps(TOUR_STEPS, () => true).length, TOUR_STEPS.length);
});

test('placeCard: below a titlebar button, right of a full-height panel, centered over a huge target', () => {
  const card = { w: 340, h: 200 };
  const bar = { left: 500, top: 6, width: 200, height: 28, right: 700, bottom: 34 };
  assert.deepEqual(placeCard(bar, card, 1200, 900), { left: 430, top: 48 });
  const panel = { left: 0, top: 40, width: 300, height: 860, right: 300, bottom: 900 };
  assert.deepEqual(placeCard(panel, card, 1200, 900), { left: 314, top: 40 });
  const graph = { left: 300, top: 40, width: 900, height: 860, right: 1200, bottom: 900 };
  assert.deepEqual(placeCard(graph, card, 1200, 900), { left: 580, top: 370 });
});
