import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateBandLabel, shortDateLabel } from './date-band.js';

// Fixed: 2026-11-09 14:00 local — tests use local calendar days.
const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

test('first row of a day returns a label', () => {
  assert.equal(dateBandLabel(sec(2026, 10, 9), null, NOW), 'Today');
  assert.equal(dateBandLabel(sec(2026, 10, 8), null, NOW), 'Yesterday');
  assert.equal(dateBandLabel(sec(2026, 10, 7), null, NOW), shortDateLabel(sec(2026, 10, 7) * 1000, NOW));
});

test('same calendar day as prev returns null', () => {
  const a = sec(2026, 10, 8, 9);
  const b = sec(2026, 10, 8, 18);
  assert.equal(dateBandLabel(b, a, NOW), null);
});

test('day change returns a new label', () => {
  const yesterday = sec(2026, 10, 8);
  const twoDays = sec(2026, 10, 7);
  assert.equal(dateBandLabel(twoDays, yesterday, NOW), shortDateLabel(twoDays * 1000, NOW));
});

test('out-of-order newer day after older does not reopen a band', () => {
  const older = sec(2026, 10, 6);
  const yesterday = sec(2026, 10, 8);
  assert.equal(dateBandLabel(yesterday, older, NOW), null);
});

test('missing at skips the band', () => {
  assert.equal(dateBandLabel(null, null, NOW), null);
  assert.equal(dateBandLabel(undefined, null, NOW), null);
  assert.equal(dateBandLabel(0, null, NOW), null);
});

test('same-year bands omit the year', () => {
  assert.equal(dateBandLabel(sec(2026, 9, 26), null, NOW), shortDateLabel(sec(2026, 9, 26) * 1000, NOW));
  assert.doesNotMatch(dateBandLabel(sec(2026, 9, 26), null, NOW), /2026/);
});

test('other-year bands keep the year', () => {
  assert.match(dateBandLabel(sec(2025, 8, 9), null, NOW), /2025/);
});
