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
/** #161 hard ceiling was 600 (~half a tall window). Prefer the open-body budget. */
export const SECTION_HEIGHT_MAX = 10_000;

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

function isElement(node) {
  return Boolean(node) && typeof node === 'object' && typeof node.offsetHeight === 'number';
}

/**
 * Space left for open `[data-section]` bodies inside `.panel-scroll`.
 * Chrome = headers, search, resize handles, closed rows — everything except open bodies.
 */
export function measureOpenBodyBudget(scrollEl) {
  if (!scrollEl || typeof scrollEl.clientHeight !== 'number') return 0;
  let chrome = 0;
  for (const section of scrollEl.children || []) {
    if (!isElement(section)) continue;
    for (const child of section.children || []) {
      if (!isElement(child)) continue;
      const has = typeof child.hasAttribute === 'function' ? child.hasAttribute.bind(child) : () => false;
      if (has('data-section') && !has('hidden')) continue;
      chrome += child.offsetHeight;
    }
  }
  const accordions = scrollEl.querySelectorAll?.(':scope > .section-accordion') || [];
  const accordionCount = accordions.length ?? 0;
  if (accordionCount > 1) chrome += accordionCount - 1; // hairline borders
  return Math.max(0, Math.round(scrollEl.clientHeight - chrome));
}

/** Open body keys currently visible under root. */
export function openSectionKeys(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll('[data-section]:not([hidden])')]
    .map((el) => el.dataset.section)
    .filter((key) => key && SECTION_HEIGHT_KEYS.includes(key));
}

/**
 * Shrink preferred heights so open bodies fit `budget` (proportional, floor at min).
 */
export function fitHeightsToBudget(heights, openKeys, budget, { min = SECTION_HEIGHT_MIN } = {}) {
  const base = normalizeSectionHeights(heights);
  const keys = (openKeys || []).filter((k) => base[k] != null);
  if (!keys.length) return base;
  const out = { ...base };
  const floorBudget = Math.max(0, Math.round(Number(budget) || 0));
  let sum = keys.reduce((s, k) => s + out[k], 0);
  if (sum <= floorBudget) return out;

  let guard = 0;
  while (sum > floorBudget && guard++ < 24) {
    const flexible = keys.filter((k) => out[k] > min);
    if (!flexible.length) break;
    const flexibleSum = flexible.reduce((s, k) => s + out[k], 0);
    const need = sum - floorBudget;
    let shaved = 0;
    for (let i = 0; i < flexible.length; i++) {
      const k = flexible[i];
      const share = i === flexible.length - 1
        ? need - shaved
        : Math.floor(need * (out[k] / flexibleSum));
      const next = Math.max(min, out[k] - Math.max(0, share));
      shaved += out[k] - next;
      out[k] = next;
    }
    sum = keys.reduce((s, k) => s + out[k], 0);
  }
  return out;
}

/**
 * Assign open-body heights that exactly fill `budget`.
 * Prefs are honored when they fit; leftover goes to the last open section
 * so it reaches the next header (trailing closed sticks to the bottom naturally).
 */
export function allocateOpenHeights(heights, openKeys, budget, { min = SECTION_HEIGHT_MIN } = {}) {
  const base = normalizeSectionHeights(heights);
  const keys = (openKeys || []).filter((k) => base[k] != null);
  if (!keys.length) return base;
  const out = { ...base };
  const floorBudget = Math.max(0, Math.round(Number(budget) || 0));
  for (const k of keys) out[k] = Math.max(min, out[k]);

  let sum = keys.reduce((s, k) => s + out[k], 0);
  if (sum > floorBudget) return fitHeightsToBudget(out, keys, floorBudget, { min });

  const leftover = floorBudget - sum;
  if (leftover > 0) {
    const sink = keys[keys.length - 1];
    out[sink] = out[sink] + leftover;
  }
  return out;
}

/**
 * Hard max for one open key if siblings can shrink to min.
 * (Growing steals from siblings — see resizeSectionHeights.)
 */
export function maxHeightForKey(_heights, key, openKeys, budget, { min = SECTION_HEIGHT_MIN } = {}) {
  const keys = (openKeys || []).filter(Boolean);
  if (!keys.includes(key) && keys.length) {
    /* still allow computing against current open set */
  }
  const siblings = Math.max(0, keys.filter((k) => k !== key).length);
  const floorBudget = Math.max(0, Math.round(Number(budget) || 0));
  return Math.max(min, floorBudget - siblings * min);
}

/**
 * Drag-resize one open body: clamp the target, then make siblings exactly fill the rest.
 * Persisted map always sums to ≤ budget for open keys so layout won't undo the drag.
 */
export function resizeSectionHeights(heights, key, nextPx, openKeys, budget, { min = SECTION_HEIGHT_MIN } = {}) {
  const base = normalizeSectionHeights(heights);
  const keys = (openKeys || []).filter((k) => base[k] != null);
  const out = { ...base };
  if (!keys.includes(key)) {
    out[key] = clampSectionHeight(nextPx);
    return out;
  }

  const floorBudget = Math.max(keys.length * min, Math.round(Number(budget) || 0));
  const maxOne = Math.min(SECTION_HEIGHT_MAX, floorBudget - (keys.length - 1) * min);
  out[key] = clampSectionHeight(nextPx, { min, max: maxOne });

  const siblings = keys.filter((k) => k !== key);
  if (!siblings.length) return out;

  const remaining = floorBudget - out[key];
  for (const k of siblings) out[k] = Math.max(min, out[k]);
  let sibSum = siblings.reduce((s, k) => s + out[k], 0);
  if (sibSum > remaining) {
    const shrunk = fitHeightsToBudget(out, siblings, remaining, { min });
    for (const k of siblings) out[k] = shrunk[k];
  } else if (sibSum < remaining) {
    out[siblings[siblings.length - 1]] += remaining - sibSum;
  }
  return out;
}

/**
 * Apply height + max-height so open bodies actually occupy their rail share
 * (last open fills down to the next section — no void between lists).
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

/** Clear any leftover dock margins from older layout. */
export function clearDockMargins(scrollEl) {
  if (!scrollEl?.querySelectorAll) return;
  for (const s of scrollEl.querySelectorAll(':scope > .section-accordion')) {
    if (s?.style) s.style.marginTop = '';
  }
}

/**
 * Fill the rail with open body heights; trailing closed headers sit under the last open body.
 */
export function layoutPanelSections(root, heights = readSectionHeights()) {
  const scroll = root?.querySelector?.('.panel-scroll') || root;
  if (!scroll) return normalizeSectionHeights(heights);
  clearDockMargins(scroll);
  const preferred = normalizeSectionHeights(heights);
  const keys = openSectionKeys(root);
  const budget = measureOpenBodyBudget(scroll);
  const allocated = allocateOpenHeights(preferred, keys, budget);
  applySectionHeights(root, allocated);
  return allocated;
}
