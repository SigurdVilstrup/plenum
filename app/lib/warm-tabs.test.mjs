import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFreeze, evictOldest, markFrozen, WARM_MAX } from './warm-tabs.js';

test('shouldFreeze after ttl', () => {
  assert.equal(shouldFreeze(0, 119_999, 120_000), false);
  assert.equal(shouldFreeze(0, 120_000, 120_000), true);
});

test('evictOldest keeps newest leftAt up to max', () => {
  const m = new Map([
    ['a', { leftAt: 1 }],
    ['b', { leftAt: 3 }],
    ['c', { leftAt: 2 }],
    ['d', { leftAt: 4 }],
    ['e', { leftAt: 0 }],
  ]);
  const out = evictOldest(m, 4);
  assert.equal(out.size, 4);
  assert.equal(out.has('e'), false);
  assert.equal(out.has('d'), true);
});

test('markFrozen clears timer and sets frozen', () => {
  const entry = { frozen: false, timerId: setInterval(() => {}, 99999) };
  markFrozen(entry);
  assert.equal(entry.frozen, true);
  assert.equal(entry.timerId, null);
});

test('WARM_MAX is 4', () => {
  assert.equal(WARM_MAX, 4);
});

test('evictOldest clears the evicted entry timer', () => {
  const e = { leftAt: 1, timerId: setInterval(() => {}, 1e6), frozen: false };
  evictOldest(new Map([['a', e], ['b', { leftAt: 2 }]]), 1);
  assert.equal(e.timerId, null);
  assert.equal(e.frozen, true);
});
