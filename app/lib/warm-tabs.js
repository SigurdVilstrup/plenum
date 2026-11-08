// ponytail: warm board JSON only; escalate to hide/show DOM if paint dominates switch cost

export const WARM_MAX = 4;
export const WARM_REFRESH_MS = 20_000;

export function shouldFreeze(leftAt, now, ttlMs) {
  return now - leftAt >= ttlMs;
}

/** @param {Map|Record<string, {leftAt:number}>} entries */
export function evictOldest(entries, max = WARM_MAX) {
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries || {}));
  while (map.size > max) {
    let oldestId = null;
    let oldestAt = Infinity;
    for (const [id, e] of map) {
      const t = e?.leftAt ?? 0;
      if (t < oldestAt) {
        oldestAt = t;
        oldestId = id;
      }
    }
    if (oldestId == null) break;
    map.delete(oldestId);
  }
  return map;
}

export function markFrozen(entry) {
  if (!entry) return entry;
  if (entry.timerId) {
    clearInterval(entry.timerId);
    entry.timerId = null;
  }
  entry.frozen = true;
  return entry;
}
