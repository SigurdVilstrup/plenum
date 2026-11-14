import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUDGE, noteLaunch, pickNudge, markShown } from './nudge.js';

const DAY = 86_400_000;
const T = 1_000 * DAY;
const base = (nudge, extra = {}) => ({
  prefs: { tourDone: true, nudge }, now: T, sessionMs: 30 * 60_000, idleMs: 60_000, busy: false, ...extra,
});

test('first launch only records; a new version marks an update pending', () => {
  const a = noteLaunch(undefined, '1.0.0', T);
  assert.deepEqual(a, { firstSeenAt: T, seenVersion: '1.0.0' });
  assert.equal(noteLaunch(a, '1.0.0', T + 1), a);
  assert.equal(noteLaunch(a, '1.0.1', T + 5).updatedAt, T + 5);
});

test('after an update: waits for a long session and idle, never while busy or switched off', () => {
  const n = { firstSeenAt: T - DAY, seenVersion: '1', updatedAt: T - 1000 };
  assert.equal(pickNudge(base(n)), 'update');
  assert.equal(pickNudge(base(n, { sessionMs: 2 * 60_000 })), null);
  assert.equal(pickNudge(base(n, { idleMs: 5_000 })), null);
  assert.equal(pickNudge(base(n, { busy: true })), null);
  assert.equal(pickNudge({ ...base(n), prefs: { tourDone: true, nudge: n, feedbackPrompts: false } }), null);
  assert.equal(pickNudge({ ...base(n), prefs: { tourDone: false, nudge: n } }), null);
});

test('pending update ask expires', () => {
  const n = { firstSeenAt: T - 20 * DAY, updatedAt: T - NUDGE.pendingMs - 1, checkinAt: T - DAY };
  assert.equal(pickNudge(base(n)), null);
});

test('check-in: not in the first week, then roughly monthly, and prompts keep a gap', () => {
  assert.equal(pickNudge(base({ firstSeenAt: T - 2 * DAY })), null);
  assert.equal(pickNudge(base({ firstSeenAt: T - 6 * DAY })), null);
  assert.equal(pickNudge(base({ firstSeenAt: T - 8 * DAY })), 'checkin');
  assert.equal(pickNudge(base({ firstSeenAt: T - 90 * DAY, checkinAt: T - 10 * DAY })), null);
  assert.equal(pickNudge(base({ firstSeenAt: T - 90 * DAY, checkinAt: T - 31 * DAY })), 'checkin');
  assert.equal(pickNudge(base({ firstSeenAt: T - 90 * DAY, lastShownAt: T - DAY })), null);
});

test('markShown consumes the prompt', () => {
  const u = markShown({ updatedAt: T - 5 }, 'update', T);
  assert.equal(u.updatedAt, null);
  assert.equal(u.lastShownAt, T);
  assert.equal(markShown({}, 'checkin', T).checkinAt, T);
});

test('PATH hint: once, after a short session, independent of the feedback switch', () => {
  const p = (nudge, extra) => pickNudge({ ...base(nudge, { pathMissing: true }), ...extra });
  assert.equal(p({}), 'path');
  assert.equal(p({}, { sessionMs: 30_000 }), null);
  assert.equal(p({ pathAskedAt: T - 1 }), null);
  assert.equal(p({}, { prefs: { tourDone: true, nudge: {}, feedbackPrompts: false } }), 'path');
  assert.equal(pickNudge(base({})), null); // not missing -> no hint
  assert.equal(markShown({ lastShownAt: 5 }, 'path', T).pathAskedAt, T);
  assert.equal(markShown({ lastShownAt: 5 }, 'path', T).lastShownAt, 5);
});
