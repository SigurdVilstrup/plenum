import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen, formatWhenUtc } from './board.mjs';

const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

test('formatWhen: relative today and yesterday', () => {
  assert.equal(formatWhen(Math.floor(NOW / 1000) - 120, NOW), '2m');
  assert.equal(formatWhen(sec(2026, 10, 8), NOW), 'yesterday');
});

test('formatWhen: calendar date after yesterday', () => {
  const label = formatWhen(sec(2026, 10, 1), NOW);
  assert.match(label, /2026/);
  assert.doesNotMatch(label, /ago|d$|w$|mo$/);
});

test('formatWhenUtc: ISO Z', () => {
  assert.match(formatWhenUtc(sec(2026, 10, 9)), /Z$/);
});
