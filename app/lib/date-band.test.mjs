import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateBandLabel } from './date-band.js';

// Fixed: 2026-11-09 14:00 local — tests use local calendar days.
const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

test('first row of a day returns a label', () => {
  assert.equal(dateBandLabel(sec(2026, 10, 9), null, NOW), 'today');
  assert.equal(dateBandLabel(sec(2026, 10, 8), null, NOW), 'yesterday');
  assert.equal(dateBandLabel(sec(2026, 10, 7), null, NOW), '2 days ago');
});

test('same calendar day as prev returns null', () => {
  const a = sec(2026, 10, 8, 9);
  const b = sec(2026, 10, 8, 18);
  assert.equal(dateBandLabel(b, a, NOW), null);
});

test('day change returns a new label', () => {
  const yesterday = sec(2026, 10, 8);
  const twoDays = sec(2026, 10, 7);
  assert.equal(dateBandLabel(twoDays, yesterday, NOW), '2 days ago');
});

test('missing at skips the band', () => {
  assert.equal(dateBandLabel(null, null, NOW), null);
  assert.equal(dateBandLabel(undefined, null, NOW), null);
  assert.equal(dateBandLabel(0, null, NOW), null);
});

test('week and month style match board ago roughly', () => {
  assert.equal(dateBandLabel(sec(2026, 9, 26), null, NOW), '2w'); // 14 days
  assert.equal(dateBandLabel(sec(2026, 8, 9), null, NOW), '2mo'); // ~61 days
});
