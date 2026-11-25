/** Persisted accordion body heights (Lanes / Worktrees / Local / Remote). */

export const SECTION_HEIGHTS_KEY = 'plenum.sectionHeights';

export const SECTION_HEIGHT_DEFAULTS = Object.freeze({
  lanes: 120,
  worktrees: 120,
  local: 200,
  remote: 160,
});

/** Min ≥ ~2 row heights so “Lane setup first” never clips. */
export const SECTION_HEIGHT_MIN = 56;
export const SECTION_HEIGHT_MAX = 600;

export const SECTION_HEIGHT_KEYS = Object.freeze(Object.keys(SECTION_HEIGHT_DEFAULTS));

export function clampSectionHeight(value, { min = SECTION_HEIGHT_MIN, max = SECTION_HEIGHT_MAX } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SECTION_HEIGHT_DEFAULTS.lanes;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export function normalizeSectionHeights(raw) {
  const out = { ...SECTION_HEIGHT_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of SECTION_HEIGHT_KEYS) {
    if (raw[key] != null) out[key] = clampSectionHeight(raw[key]);
  }
  return out;
}

export function readSectionHeights(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SECTION_HEIGHTS_KEY);
    return normalizeSectionHeights(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...SECTION_HEIGHT_DEFAULTS };
  }
}

export function writeSectionHeights(heights, storage = globalThis.localStorage) {
  const next = normalizeSectionHeights(heights);
  try {
    storage?.setItem?.(SECTION_HEIGHTS_KEY, JSON.stringify(next));
  } catch { /* session only */ }
  return next;
}

/**
 * Apply height + max-height caps to `[data-section]` bodies inside root.
 * Caps replace #134 equal flex share (bodies stay `flex: 0 0 auto` in CSS).
 */
export function applySectionHeights(root, heights) {
  const h = normalizeSectionHeights(heights);
  if (!root?.querySelectorAll) return h;
  for (const el of root.querySelectorAll('[data-section]')) {
    const key = el.dataset.section;
    if (!key || h[key] == null) continue;
    const px = `${h[key]}px`;
    el.style.height = px;
    el.style.maxHeight = px;
  }
  return h;
}
