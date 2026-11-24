/** Hall of fame category catalog + prefs helpers (#106). Keep ids stable. */

export const FAME_CATEGORIES = Object.freeze([
  { id: 'ai', title: 'Most AI-assisted', scope: 'person' },
  { id: 'lines', title: 'Line machine', scope: 'person' },
  { id: 'night', title: 'Night owl', scope: 'person' },
  { id: 'early', title: 'Early bird', scope: 'person' },
  { id: 'weekend', title: 'Weekend warrior', scope: 'person' },
  { id: 'deleted', title: 'Demolition crew', scope: 'person' },
  { id: 'fixes', title: 'Fix-it', scope: 'person' },
  { id: 'human', title: 'Artisanal', scope: 'person' },
  { id: 'biggest', title: 'Biggest bang', scope: 'repo' },
  { id: 'fav', title: 'Favourite agent', scope: 'repo' },
  { id: 'day', title: 'Busiest day', scope: 'repo' },
  { id: 'streak', title: 'Longest streak', scope: 'repo' },
  { id: 'file', title: 'Most reworked file', scope: 'repo' },
]);

/** Default five “important” categories. */
export const DEFAULT_FAME_CATEGORIES = Object.freeze([
  'ai', 'lines', 'biggest', 'fav', 'streak',
]);

const FAME_IDS = new Set(FAME_CATEGORIES.map((c) => c.id));

/** Unique known ids; empty → default five. */
export function normalizeFameCategories(raw) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id !== 'string' || !FAME_IDS.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out.length ? out : [...DEFAULT_FAME_CATEGORIES];
}

export function filterAwardsByCategories(awardsList, categories) {
  const allow = new Set(normalizeFameCategories(categories));
  return (awardsList || []).filter((a) => allow.has(a.id));
}
