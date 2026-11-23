/** Persisted panel + graph column widths. Pure helpers + one DOM binder. */

export const LAYOUT_KEY = 'plenum.layoutWidths';

export const LAYOUT_DEFAULTS = Object.freeze({
  rail: 300,
  labels: 148,
  svg: 136,
  who: 22,
  sha: 64,
  when: 110,
});

export const LAYOUT_LIMITS = Object.freeze({
  rail: [180, 520],
  labels: [72, 420],
  svg: [72, 320],
  who: [18, 48],
  sha: [48, 140],
  when: [72, 220],
});

/** Pref column id → layout-widths resize key (Commit stays 1fr — no handle). */
export const COL_TO_RESIZE = Object.freeze({
  labels: 'labels',
  graph: 'svg',
  author: 'who',
  sha: 'sha',
  when: 'when',
});

export function clampWidth(key, value) {
  const [lo, hi] = LAYOUT_LIMITS[key] || [0, 10_000];
  const n = Number(value);
  if (!Number.isFinite(n)) return LAYOUT_DEFAULTS[key];
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

export function normalizeLayout(raw) {
  const out = { ...LAYOUT_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(LAYOUT_DEFAULTS)) {
    if (raw[key] != null) out[key] = clampWidth(key, raw[key]);
  }
  return out;
}

export function readLayout(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LAYOUT_KEY);
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

export function writeLayout(widths, storage = globalThis.localStorage) {
  const next = normalizeLayout(widths);
  try {
    storage?.setItem?.(LAYOUT_KEY, JSON.stringify(next));
  } catch { /* session only */ }
  return next;
}

function px(n) {
  return `${n}px`;
}

/**
 * Keep SVG width attribute + viewBox in lockstep with the column.
 * Lane x positions stay absolute — wider = slack, narrower = clip. Never scale.
 */
export function syncSvgCanvas(graph, widthPx) {
  const svg = graph?.querySelector?.('.rows > svg');
  if (!svg) return;
  const w = Math.max(1, Math.round(Number(widthPx) || LAYOUT_DEFAULTS.svg));
  const vb = svg.viewBox?.baseVal;
  const h = (vb && vb.height) || Number(svg.getAttribute('height')) || 0;
  if (!h) return;
  svg.setAttribute('width', String(w));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}

/** Apply widths to CSS variables on root + graph. */
export function applyLayout(widths, { root = document.documentElement, graph = null } = {}) {
  const w = normalizeLayout(widths);
  root?.style?.setProperty('--rail-w', px(w.rail));
  if (graph) {
    graph.style.setProperty('--graph-labels-w', px(w.labels));
    graph.style.setProperty('--graph-svg-w', px(w.svg));
    graph.style.setProperty('--graph-who-w', px(w.who));
    graph.style.setProperty('--graph-sha-w', px(w.sha));
    graph.style.setProperty('--graph-when-w', px(w.when));
    syncSvgCanvas(graph, w.svg);
  }
  return w;
}

function resizerEl(key) {
  const el = document.createElement('i');
  el.className = 'layout-resizer';
  el.dataset.resize = key;
  el.title = 'Drag to resize · double-click to reset';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Mount drag handles on the lanes rail, settings nav, and graph column headers.
 * @param {{ panel?: Element|null, settingsNav?: Element|null, graph?: Element|null, onChange?: (w: object, key: string) => void }} opts
 */
export function bindLayoutResizers(opts = {}) {
  const {
    panel = null,
    settingsNav = null,
    graph = null,
    root = document.documentElement,
    storage = globalThis.localStorage,
    onChange = null,
  } = opts;

  let widths = applyLayout(readLayout(storage), { root, graph });

  const persist = (key) => {
    widths = writeLayout(widths, storage);
    applyLayout(widths, { root, graph });
    onChange?.(widths, key);
  };

  const startDrag = (key, event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = widths[key];
    const handle = event.currentTarget;
    handle.classList.add('is-active');
    document.body.classList.add('is-col-resizing');

    const onMove = (e) => {
      const next = clampWidth(key, startW + (e.clientX - startX));
      if (next === widths[key]) return;
      widths = { ...widths, [key]: next };
      applyLayout(widths, { root, graph });
    };
    const onUp = () => {
      handle.classList.remove('is-active');
      document.body.classList.remove('is-col-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      persist(key);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onDblClick = (key, event) => {
    event.preventDefault();
    event.stopPropagation();
    widths = { ...widths, [key]: LAYOUT_DEFAULTS[key] };
    persist(key);
  };

  const mountRail = (host) => {
    if (!host) return;
    host.querySelectorAll(':scope > .layout-resizer[data-resize="rail"]').forEach((n) => n.remove());
    const handle = resizerEl('rail');
    handle.addEventListener('pointerdown', (e) => startDrag('rail', e));
    handle.addEventListener('dblclick', (e) => onDblClick('rail', e));
    host.appendChild(handle);
  };

  const mountGraphCols = () => {
    const cols = graph?.querySelector('.graph-cols');
    if (!cols) return;
    cols.querySelectorAll('.layout-resizer').forEach((n) => n.remove());
    cols.querySelectorAll('.has-resizer').forEach((n) => n.classList.remove('has-resizer'));
    for (const cell of cols.querySelectorAll(':scope > span[data-col]')) {
      const key = COL_TO_RESIZE[cell.dataset.col];
      if (!key) continue;
      cell.classList.add('has-resizer');
      const handle = resizerEl(key);
      handle.addEventListener('pointerdown', (e) => startDrag(key, e));
      handle.addEventListener('dblclick', (e) => onDblClick(key, e));
      cell.appendChild(handle);
    }
  };

  mountRail(panel);
  mountRail(settingsNav);
  mountGraphCols();

  return {
    get widths() { return { ...widths }; },
    remountRails() {
      mountRail(panel);
      mountRail(settingsNav);
    },
    remountGraphCols() {
      mountGraphCols();
    },
    set(partial) {
      widths = writeLayout({ ...widths, ...partial }, storage);
      applyLayout(widths, { root, graph });
      onChange?.(widths, null);
      return widths;
    },
    refresh() {
      widths = applyLayout(readLayout(storage), { root, graph });
      return widths;
    },
  };
}
