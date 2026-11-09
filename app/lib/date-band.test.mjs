import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateBandLabel } from './date-band.js';

// Fixed: 2026-11-09 14:00 local — tests use local calendar days.
const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

test('first row of a day returns a label', () => {
  assert.equal(dateBandLabel(sec(2026, 10, 9), null, NOW), 'today');
  assert.equal(dateBandLabel(sec(2026, 10, 8), null, NOW), 'yesterday');
  const older = dateBandLabel(sec(2026, 10, 7), null, NOW);
  assert.match(older, /2026/);
  assert.doesNotMatch(older, /ago/);
});

test('same calendar day as prev returns null', () => {
  const a = sec(2026, 10, 8, 9);
  const b = sec(2026, 10, 8, 18);
  assert.equal(dateBandLabel(b, a, NOW), null);
});

test('day change returns a new label', () => {
  const yesterday = sec(2026, 10, 8);
  const twoDays = sec(2026, 10, 7);
  const label = dateBandLabel(twoDays, yesterday, NOW);
  assert.match(label, /2026/);
});

test('missing at skips the band', () => {
  assert.equal(dateBandLabel(null, null, NOW), null);
  assert.equal(dateBandLabel(undefined, null, NOW), null);
  assert.equal(dateBandLabel(0, null, NOW), null);
});

test('older bands use calendar dates', () => {
  assert.match(dateBandLabel(sec(2026, 9, 26), null, NOW), /2026/);
  assert.match(dateBandLabel(sec(2026, 8, 9), null, NOW), /2026/);
});
