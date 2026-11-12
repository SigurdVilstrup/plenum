// When to ask for feedback. Pure: the caller owns the DOM, the clock and the prefs write.
// Every rule here exists to keep the prompt out of the way of real work.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const NUDGE = {
  idleMs: 15_000,          // no key / click / scroll for this long
  afterUpdateMs: 10 * MIN, // app open this long before the post-update ask
  checkinSessionMs: 20 * MIN,
  pathSessionMs: 2 * MIN,  // app open this long before the one-time PATH hint
  gapMs: 3 * DAY,          // between any two prompts
  checkinAfterMs: 5 * DAY, // first check-in, from first launch
  checkinEveryMs: 30 * DAY,
  pendingMs: 7 * DAY,      // an unanswered post-update ask expires
};

/** Called once per launch. Returns the next `nudge` pref (same object when nothing changed). */
export function noteLaunch(nudge, version, now) {
  const n = nudge || {};
  if (!n.firstSeenAt) return { ...n, firstSeenAt: now, seenVersion: version };
  if (n.seenVersion !== version) return { ...n, seenVersion: version, updatedAt: now };
  return n;
}

/**
 * 'path' | 'update' | 'checkin' | null. `busy` is anything on screen that means "the user is in the middle
 * of something" (sheet, palette, settings, tour, focused field, another toast / prompt).
 */
export function pickNudge({ prefs, now, sessionMs, idleMs, busy, pathMissing = false }) {
  if (!prefs.tourDone || busy) return null;
  if (idleMs < NUDGE.idleMs) return null;
  const n = prefs.nudge || {};
  // One-time setup hint, not feedback: it ignores the feedback switch and the gap.
  if (pathMissing && !n.pathAskedAt && sessionMs >= NUDGE.pathSessionMs) return 'path';
  if (prefs.feedbackPrompts === false) return null;
  if (n.lastShownAt && now - n.lastShownAt < NUDGE.gapMs) return null;
  if (n.updatedAt && now - n.updatedAt < NUDGE.pendingMs && sessionMs >= NUDGE.afterUpdateMs) return 'update';
  if (n.firstSeenAt && now - n.firstSeenAt >= NUDGE.checkinAfterMs
    && (!n.checkinAt || now - n.checkinAt >= NUDGE.checkinEveryMs)
    && sessionMs >= NUDGE.checkinSessionMs) return 'checkin';
  return null;
}

/** Showing consumes the prompt: ignoring it counts as an answer, so nothing nags twice. */
export function markShown(nudge, kind, now) {
  if (kind === 'path') return { ...nudge, pathAskedAt: now };
  const n = { ...nudge, lastShownAt: now };
  if (kind === 'update') n.updatedAt = null;
  else n.checkinAt = now;
  return n;
}
