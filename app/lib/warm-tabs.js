// Warm board JSON + per-tab chrome. Escalate to hide/show DOM if paint dominates switch cost.

export const WARM_MAX = 8;
export const WARM_REFRESH_MS = 8_000; // #99 notice local commits / dirty sooner

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
    markFrozen(map.get(oldestId));
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

/** Default chrome for a cold tab (no cached view). */
export function emptyViewChrome() {
  return {
    selectedLane: 0,
    changes: null,
    filePane: null,
    collapsedDirs: [],
    commitDraft: '',
    historyLimit: 120,
    branchesOpen: true,
    conflictRoot: null,
    graphScrollTop: 0,
  };
}

/**
 * Snapshot UI chrome that must stay per-tab (board itself is stored separately).
 * @param {object} s renderer state slice
 * @param {number} [graphScrollTop]
 */
export function captureViewChrome(s, graphScrollTop = 0) {
  return {
    selectedLane: s.selectedLane ?? 0,
    changes: s.changes ? { ...s.changes } : null,
    filePane: s.filePane ? { ...s.filePane } : null,
    collapsedDirs: [...(s.collapsedDirs instanceof Set ? s.collapsedDirs : s.collapsedDirs || [])],
    commitDraft: s.commitDraft || '',
    historyLimit: s.historyLimit || 120,
    branchesOpen: s.branchesOpen !== false,
    conflictRoot: s.conflictRoot || null,
    graphScrollTop: Number(graphScrollTop) || 0,
  };
}

/** Merge chrome fields onto a warm entry (mutates entry). */
export function applyChromeToEntry(entry, chrome) {
  if (!entry || !chrome) return entry;
  Object.assign(entry, {
    selectedLane: chrome.selectedLane,
    changes: chrome.changes ? { ...chrome.changes } : null,
    filePane: chrome.filePane ? { ...chrome.filePane } : null,
    collapsedDirs: [...(chrome.collapsedDirs || [])],
    commitDraft: chrome.commitDraft || '',
    historyLimit: chrome.historyLimit || 120,
    branchesOpen: chrome.branchesOpen !== false,
    conflictRoot: chrome.conflictRoot || null,
    graphScrollTop: chrome.graphScrollTop || 0,
  });
  return entry;
}
