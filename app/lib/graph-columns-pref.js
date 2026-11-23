/** Git graph table columns: order + visibility prefs. */

export const GRAPH_COLUMN_IDS = Object.freeze([
  'labels', 'graph', 'author', 'commit', 'sha', 'when',
]);

/** Width key in layout-widths.js, or null when the track is flex (Commit). */
export const GRAPH_COLUMN_RESIZE = Object.freeze({
  labels: 'labels',
  graph: 'svg',
  author: 'who',
  commit: null,
  sha: 'sha',
  when: 'when',
});

// Track tokens must stay comma-free: they are stored in --graph-tracks and
// substituted into grid-template-columns. A comma (e.g. minmax(0, 1fr) or
// var(--x, 148px)) makes the whole --graph-tracks value invalid when used
// inside var(--graph-tracks, …), and the grid falls back to auto columns —
// headers and cells then drift apart.
export const GRAPH_COLUMN_META = Object.freeze({
  labels: { label: 'Branch / Tag', track: 'var(--graph-labels-w)' },
  graph: { label: 'Graph', track: 'var(--graph-svg-w)' },
  author: { label: '', title: 'Author', track: 'var(--graph-who-w)' },
  commit: { label: 'Commit', track: '1fr' },
  sha: { label: 'SHA', track: 'var(--graph-sha-w)' },
  when: { label: 'When', track: 'var(--graph-when-w)' },
});

const PAD_L = 12;
const COL_GAP = 8;

export function defaultGraphColumns() {
  return GRAPH_COLUMN_IDS.map((id) => ({ id, on: true }));
}

/** Canonical ordered list: known ids only, unique, missing appended on. ≥1 on. */
export function normalizeGraphColumns(raw) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const id = row && typeof row === 'object' ? row.id : null;
      if (!GRAPH_COLUMN_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, on: row.on !== false });
    }
  }
  for (const id of GRAPH_COLUMN_IDS) {
    if (seen.has(id)) continue;
    out.push({ id, on: true });
  }
  if (!out.some((c) => c.on)) {
    const commit = out.find((c) => c.id === 'commit');
    if (commit) commit.on = true;
    else out[0].on = true;
  }
  return out;
}

export function visibleColumns(cols) {
  return normalizeGraphColumns(cols).filter((c) => c.on);
}

export function graphTracks(cols) {
  return visibleColumns(cols).map((c) => GRAPH_COLUMN_META[c.id].track).join(' ');
}

export function headerCellsHTML(cols, esc = (s) => String(s ?? '')) {
  return visibleColumns(cols).map((c) => {
    const meta = GRAPH_COLUMN_META[c.id];
    const title = meta.title ? ` title="${esc(meta.title)}"` : '';
    // nbsp keeps the Author cell from matching :empty and dropping out of layout.
    const label = meta.label === '' ? '&nbsp;' : esc(meta.label);
    return `<span data-col="${c.id}"${title}>${label}</span>`;
  }).join('');
}

/** True when header data-col order matches the visible pref list. */
export function headersMatchColumns(headEl, cols) {
  if (!headEl) return false;
  const want = visibleColumns(cols).map((c) => c.id);
  const got = [...headEl.querySelectorAll(':scope > [data-col]')].map((n) => n.dataset.col);
  return want.length === got.length && want.every((id, i) => id === got[i]);
}

/** True when every column before Graph has a fixed (non-fr) track — CSS calc works. */
export function svgLeftIsFixed(cols) {
  const list = visibleColumns(cols);
  const gi = list.findIndex((c) => c.id === 'graph');
  if (gi <= 0) return gi === 0;
  return list.slice(0, gi).every((c) => GRAPH_COLUMN_RESIZE[c.id] != null);
}

/**
 * CSS calc for SVG left when preceding columns are fixed-width vars.
 * Returns null when Graph is hidden or a flex column precedes it (measure instead).
 */
export function graphSvgLeftCalc(cols) {
  const list = visibleColumns(cols);
  const gi = list.findIndex((c) => c.id === 'graph');
  if (gi < 0) return null;
  if (!svgLeftIsFixed(cols)) return null;
  if (gi === 0) return `${PAD_L}px`;
  const parts = [`${PAD_L}px`];
  for (let i = 0; i < gi; i++) {
    parts.push(GRAPH_COLUMN_META[list[i].id].track);
    parts.push(`${COL_GAP}px`);
  }
  return `calc(${parts.join(' + ')})`;
}

/** Pixel left from measured layout widths (fallback when calc is unavailable). */
export function graphSvgLeftPx(cols, widths = {}) {
  const list = visibleColumns(cols);
  const gi = list.findIndex((c) => c.id === 'graph');
  if (gi < 0) return null;
  let left = PAD_L;
  for (let i = 0; i < gi; i++) {
    const key = GRAPH_COLUMN_RESIZE[list[i].id];
    const w = key != null && Number.isFinite(widths[key]) ? widths[key] : 0;
    left += w + COL_GAP;
  }
  return left;
}

/** Measure the Graph cell against `.rows` after paint. */
export function measureGraphSvgLeft(graphEl) {
  const rows = graphEl?.querySelector?.('.rows');
  const cell = graphEl?.querySelector?.('.row [data-col="graph"]');
  if (!rows || !cell) return null;
  return cell.getBoundingClientRect().left - rows.getBoundingClientRect().left + rows.scrollLeft;
}

export function moveColumn(cols, id, dir) {
  const list = normalizeGraphColumns(cols);
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return list;
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}

export function setColumnOn(cols, id, on) {
  const list = normalizeGraphColumns(cols).map((c) => (c.id === id ? { ...c, on: !!on } : { ...c }));
  if (!list.some((c) => c.on)) {
    const row = list.find((c) => c.id === id);
    if (row) row.on = true;
  }
  return list;
}

/**
 * Apply tracks + header + SVG left CSS vars on a `.graph` root.
 * Pass `headers: false` when only remeasuring — rebuilding the header wipes resize handles.
 * @returns {{ showSvg: boolean }}
 */
export function applyGraphColumnLayout(graphEl, cols, { widths = null, measure = true, headers = true } = {}) {
  if (!graphEl) return { showSvg: false };
  const normalized = normalizeGraphColumns(cols);
  const visible = visibleColumns(normalized);
  const showSvg = visible.some((c) => c.id === 'graph');
  graphEl.style.setProperty('--graph-tracks', graphTracks(normalized) || '1fr');
  graphEl.classList.toggle('graph-no-svg', !showSvg);

  if (headers) {
    const head = graphEl.querySelector('.graph-cols');
    if (head) head.innerHTML = headerCellsHTML(normalized);
  }

  let left = graphSvgLeftCalc(normalized);
  if (left == null && showSvg) {
    if (measure) {
      const px = measureGraphSvgLeft(graphEl);
      if (px != null) left = `${Math.round(px)}px`;
    }
    if (left == null && widths) {
      const px = graphSvgLeftPx(normalized, widths);
      if (px != null) left = `${px}px`;
    }
  }
  if (showSvg && left != null) graphEl.style.setProperty('--graph-svg-left', left);
  else graphEl.style.removeProperty('--graph-svg-left');

  return { showSvg };
}
