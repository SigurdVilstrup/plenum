import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen, formatWhenUtc } from './board.mjs';

const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d, h = 12, min = 0) => Math.floor(new Date(y, m, d, h, min).getTime() / 1000);

test('formatWhen: date and time to the minute on one line', () => {
  const label = formatWhen(sec(2026, 10, 9, 14, 22), NOW);
  assert.match(label, /Nov/);
  assert.match(label, /9/);
  assert.match(label, /14:22/);
  assert.doesNotMatch(label, /\n|ago|yesterday|just now/);
});

test('formatWhen: same year omits year', () => {
  const label = formatWhen(sec(2026, 10, 1, 9, 5), NOW);
  assert.doesNotMatch(label, /2026/);
  assert.match(label, /09:05|9:05/);
});

test('formatWhen: other year keeps year', () => {
  assert.match(formatWhen(sec(2025, 5, 1, 8, 30), NOW), /2025/);
});

test('formatWhenUtc: ISO Z', () => {
  assert.match(formatWhenUtc(sec(2026, 10, 9)), /Z$/);
});
