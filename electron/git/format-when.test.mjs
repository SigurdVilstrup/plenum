import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen, formatWhenUtc } from './board.mjs';

const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

test('formatWhen: relative today and yesterday', () => {
  assert.equal(formatWhen(Math.floor(NOW / 1000) - 120, NOW), '2m');
  assert.equal(formatWhen(sec(2026, 10, 8), NOW), 'yesterday');
});

test('formatWhen: calendar date after yesterday is compact (no year same year)', () => {
  const label = formatWhen(sec(2026, 10, 1), NOW);
  assert.doesNotMatch(label, /2026|ago|d$|w$|mo$/);
  assert.match(label, /Nov|1/);
});

test('formatWhen: other year keeps year', () => {
  assert.match(formatWhen(sec(2025, 5, 1), NOW), /2025/);
});

test('formatWhenUtc: ISO Z', () => {
  assert.match(formatWhenUtc(sec(2026, 10, 9)), /Z$/);
});
