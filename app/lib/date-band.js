/** Local calendar day start (ms). */
function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Soft date band for the first row of each calendar day.
 * @param {number|null|undefined} at unix seconds
 * @param {number|null|undefined} prevAt unix seconds of previous dated row
 * @param {number} [now] ms
 * @returns {string|null}
 */
export function dateBandLabel(at, prevAt, now = Date.now()) {
  const sec = Number(at);
  if (!Number.isFinite(sec) || sec <= 0) return null;

  const prev = Number(prevAt);
  if (Number.isFinite(prev) && prev > 0 && dayStart(sec * 1000) === dayStart(prev * 1000)) {
    return null;
  }

  const days = Math.round((dayStart(now) - dayStart(sec * 1000)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
