/** Local calendar day start (ms). */
function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Compact single-line calendar label — never wraps (e.g. `6 Nov`, not `Nov 6, 2026`). */
export function shortDateLabel(ms, now = Date.now()) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Soft date band for the first row of each calendar day going *older*.
 * Out-of-order newer tips after older ones do not re-open a band (avoids
 * `yesterday` → `6 Nov` → `yesterday` flicker on interleaved history).
 * @param {number|null|undefined} at unix seconds
 * @param {number|null|undefined} prevAt unix seconds of previous dated row
 * @param {number} [now] ms
 * @returns {string|null}
 */
export function dateBandLabel(at, prevAt, now = Date.now()) {
  const sec = Number(at);
  if (!Number.isFinite(sec) || sec <= 0) return null;

  const day = dayStart(sec * 1000);
  const prev = Number(prevAt);
  if (Number.isFinite(prev) && prev > 0) {
    const prevDay = dayStart(prev * 1000);
    if (day === prevDay) return null;
    // Only emit when we move to an older calendar day.
    if (day > prevDay) return null;
  }

  const days = Math.round((dayStart(now) - day) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDateLabel(sec * 1000, now);
}
