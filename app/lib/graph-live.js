/* Live graph. Escapes all git-sourced strings before innerHTML. */

import { authorLabel } from './authorship-pill.js';
import { authorHue, authorInitial, gravatarUrl } from './author-avatar.js';
import { aiToolBadgeHTML } from './ai-tool-badge.js';
import { visibleRefs } from './graph-refs.js';
import { defaultGraphColumns, normalizeGraphColumns, visibleColumns } from './graph-columns-pref.js';

const ROW = 30;
const COL_X0 = 14;
const COL_W = 24;
/** Default `--graph-svg-w` on `.graph`. Column is resizable; canvas grows without scaling lanes. */
export const GRAPH_SVG_W = 136;

/** Live Graph column width from CSS. */
export function graphSvgWidth(root) {
  if (!root || typeof getComputedStyle !== 'function') return GRAPH_SVG_W;
  const n = parseFloat(getComputedStyle(root).getPropertyValue('--graph-svg-w'));
  return Number.isFinite(n) && n >= 40 ? n : GRAPH_SVG_W;
}

const laneColor = (c) => `var(--lane-${c})`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const icon = (name, cls = '') => {
  const safe = String(name || 'circle-dashed').replace(/[^a-z0-9-]/g, '');
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${safe}"></use></svg>`;
};

const COL_CLASS = {
  labels: 'labels',
  author: 'who',
  commit: 'msg',
  sha: 'sha',
  when: 'time',
};

const cell = (id, html, title = '') => {
  const cls = COL_CLASS[id];
  const classAttr = cls ? ` class="${cls}"` : '';
  const titleAttr = title ? ` title="${esc(title)}"` : '';
  return `<span data-col="${id}"${classAttr}${titleAttr}>${html}</span>`;
};

function rowCells(cols, cells, titles = {}) {
  return visibleColumns(cols).map((c) => cell(c.id, cells[c.id] ?? '', titles[c.id] || '')).join('');
}

const refPill = (r, { running = false, current = false, readonly = false } = {}) => {
  const cls = [
    'ref',
    r.primary && 'primary',
    r.remote && 'remote',
    r.tag && 'tag',
    r.worktree && 'worktree',
    running && 'running',
    current && 'current',
  ].filter(Boolean).join(' ');
  const ic = current
    ? 'check-circle'
    : r.tag ? 'git-commit'
      : r.primary ? 'shield-check'
        : r.worktree ? 'tree-structure'
          : 'git-branch';
  const dot = running ? '<i class="run-dot" title="Running"></i>' : '';
  const body = `${icon(ic)}<span class="ref-name">${esc(r.name)}</span>${dot}`;
  // Tags stay inert spans; branch pills (incl. overflow menu) are buttons for right-click.
  if (r.tag || readonly) {
    return `<span class="${cls}" title="${esc(r.name)}">${body}</span>`;
  }
  const title = current
    ? `${esc(r.name)} · checked out here`
    : `${esc(r.name)} · Right-click to switch, check out, or open as lane`;
  return `<button type="button" class="${cls}" data-branch-name="${esc(r.name)}" title="${title}">${body}</button>`;
};

/** Keep type order in +N menus: primary → lane → local → remote → tag. */
const refKindRank = (r) => (r.primary ? 0 : r.worktree ? 1 : r.tag ? 4 : r.remote ? 3 : 2);

/** Uniform row centers - no day-divider gaps. */
export function layoutGraphRows(commits) {
  const rows = commits.map((_, i) => ({ cy: i * ROW + ROW / 2 }));
  return { rows, height: Math.max(ROW, commits.length * ROW) };
}

export function renderGraph(root, {
  commits,
  selectedLane = 0,
  selectedCommit = null,
  runningLanes = new Set(),
  currentBranch = null,
  gravatar = true,
  columns = null,
  historyHasMore = false,
} = {}) {
  const rowsEl = root.querySelector('.rows');
  const scrollTop = rowsEl.scrollTop;
  const cols = normalizeGraphColumns(columns ?? defaultGraphColumns());
  const showSvg = visibleColumns(cols).some((c) => c.id === 'graph');
  const index = new Map(commits.map((c, i) => [c.id, i]));
  // Canvas matches column width; lane x stays absolute (wider = slack, never scale).
  const width = graphSvgWidth(root);
  const x = (lane) => COL_X0 + Math.min(lane, 4) * COL_W;
  const { rows: layout, height } = layoutGraphRows(commits);
  const y = (i) => layout[i].cy;
  const tips = new Set(commits.filter((c) => (c.isTip || c.refs?.some((r) => !r.tag))).map((c) => c.id));
  // Extra canvas only while older commits can still load — a dangling stem at the
  // true end of history looked like a broken infinite scroll.
  const svgH = historyHasMore ? height + ROW : height;

  let edges = '';
  let nodes = '';
  if (showSvg) {
    commits.forEach((c, i) => {
      c.parents.forEach((pid) => {
        const p = index.get(pid);
        const dash = c.isWIP || c.unpushed ? ' stroke-dasharray="3 3"' : '';
        if (p == null) {
          const dim = c.lane !== selectedLane ? ' dim' : '';
          if (!historyHasMore) return;
          // Continue past the last painted tip so load-older doesn't look cut off.
          edges += `<path class="edge${dim}" d="M${x(c.lane)} ${y(i)} V${svgH}" stroke="${laneColor(c.lane)}"/>`;
          return;
        }
        const parent = commits[p];
        const dim = c.lane !== selectedLane && parent.lane !== selectedLane ? ' dim' : '';
        const color = laneColor(c.lane === 0 && parent.lane !== 0 ? parent.lane : c.lane);
        let d;
        if (c.lane === parent.lane) {
          d = `M${x(c.lane)} ${y(i)} V${y(p)}`;
        } else {
          const yTurn = y(p) - ROW;
          d = `M${x(c.lane)} ${y(i)} V${yTurn} C${x(c.lane)} ${yTurn + ROW * 0.6}, ${x(parent.lane)} ${y(p) - ROW * 0.6}, ${x(parent.lane)} ${y(p)}`;
        }
        edges += `<path class="edge${dim}" d="${d}" stroke="${color}"${dash}/>`;
      });
    });

    commits.forEach((c, i) => {
      const cx = x(c.lane);
      const cy = y(i);
      const dim = c.lane !== selectedLane ? ' dim' : '';
      if (c.isWIP) {
        const col = c.danger
          ? 'color-mix(in srgb, var(--danger) 65%, var(--ink-muted))'
          : 'color-mix(in srgb, var(--warning) 65%, var(--ink-muted))';
        nodes += `<circle class="node wip${dim}" cx="${cx}" cy="${cy}" r="5" fill="var(--canvas)" stroke="${col}" stroke-width="1.5" stroke-dasharray="2.5 2"/>`;
      } else if (c.isMerge) {
        nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="4" fill="var(--canvas)" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
      } else if (c.unpushed && !tips.has(c.id)) {
        // Not on origin yet: hollow ring, dashed edge below (see edges).
        nodes += `<circle class="node unpushed${dim}" cx="${cx}" cy="${cy}" r="3.5" fill="var(--canvas)" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
      } else if (tips.has(c.id)) {
        nodes += `<circle class="node tip${dim}" cx="${cx}" cy="${cy}" r="5.5" fill="${laneColor(c.lane)}" stroke="var(--canvas)" stroke-width="1.5"/>`;
      } else {
        nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="3.5" fill="${laneColor(c.lane)}"/>`;
      }
    });
  }

  const svg = showSvg
    ? `<svg width="${width}" height="${svgH}" viewBox="0 0 ${width} ${svgH}" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
    <g fill="none" stroke-width="1.5" stroke-linecap="round">${edges}</g>
    <g>${nodes}</g>
  </svg>`
    : '';

  const parts = [];
  commits.forEach((c) => {
    const sel = c.lane === selectedLane ? ' selected-lane' : ' dim';
    if (c.isWIP) {
      const on = selectedCommit === `wip-${c.lane}` ? ' active-commit' : '';
      const laneStyle = ` style="--row-lane: ${laneColor(c.lane)}"`;
      const n = Number(c.dirtyCount) || 0;
      const files = `${n} file${n === 1 ? '' : 's'}`;
      const laneLabel = c.laneName || `lane ${c.lane}`;
      // Protected: blank. Lane: stack. Plain worktree: tree-structure.
      let wipLabel = '';
      if (!c.danger) {
        const wipIc = c.prepared === false ? 'tree-structure' : 'stack';
        wipLabel = `<span class="wip-lane" title="Uncommitted on ${esc(laneLabel)}">${icon(wipIc)}<span class="wip-lane-name mono">${esc(laneLabel)}</span></span>`;
      }
      const msg = `<span class="wip-compose">
              <input class="wip-msg" type="text" data-wip-msg="${c.lane}" placeholder="Work In Progress" aria-label="Commit message for ${esc(laneLabel)}" autocomplete="off" spellcheck="true" />
              <span class="wip-files" title="${esc(files)}">${icon('pencil-simple', 'sm')}<span class="wip-count mono">${esc(String(n))}</span></span>
            </span>`;
      parts.push(`<div class="row wip${c.danger ? ' danger' : ''}${sel}${on}"${laneStyle} role="button" tabindex="0" data-wip-lane="${c.lane}" title="Review uncommitted changes${c.danger ? '' : ` · ${esc(laneLabel)}`}">${rowCells(cols, {
        labels: wipLabel,
        graph: '',
        author: icon('circle-dashed', 'wip-mark'),
        commit: msg,
        sha: '',
        when: 'now',
      }, { author: 'Uncommitted changes' })}</div>`);
      return;
    }
    const list = c.refs || [];
    const { shown, overflow } = visibleRefs(list, { currentBranch });
    const hidden = overflow
      ? list.filter((r) => !shown.includes(r)).slice().sort((a, b) => refKindRank(a) - refKindRank(b) || a.name.localeCompare(b.name))
      : [];
    const pillOpts = (r) => ({
      running: r.worktree && !r.primary && runningLanes.has(c.lane),
      current: !!currentBranch && r.name === currentBranch,
    });
    const refs = shown.map((r) => refPill(r, pillOpts(r))).join('') + (overflow
      ? `<span class="ref-more">
          <span class="ref overflow" aria-label="${overflow} more refs">+${overflow}</span>
          <span class="ref-more-pop" role="menu"><span class="ref-more-pop-inner">${hidden.map((r) => refPill(r, pillOpts(r))).join('')}</span></span>
        </span>`
      : '');
    const tip = tips.has(c.id);
    const kind = authorLabel[c.kind] ? c.kind : 'human';
    const whoName = c.author && c.email
      ? `${c.author} <${c.email}>`
      : (c.author || c.email || '');
    const whoTitle = [whoName, tip && (c.tool || authorLabel[kind])].filter(Boolean).join(' · ');
    const hue = authorHue(c.email || c.author);
    const face = gravatar ? gravatarUrl(c.avatarHash) : '';
    const img = face
      ? `<img src="${esc(face)}" alt="" width="18" height="18" decoding="async" referrerpolicy="no-referrer" />`
      : '';
    const badge = kind !== 'human' ? aiToolBadgeHTML(c.tool) : '';
    const who = `<span class="who-mark" aria-hidden="true"><span class="avatar" style="--avatar-hue:${hue}">${img}${esc(authorInitial(c.author))}</span>${badge}</span>`;
    const sha = esc(String(c.id || '').slice(0, 7));
    const on = selectedCommit === c.id ? ' active-commit' : '';
    const unpushed = c.unpushed ? ' unpushed' : '';
    const laneStyle = on ? ` style="--row-lane: ${laneColor(c.lane)}"` : '';
    const whenTitle = c.at
      ? `${new Date(c.at * 1000).toISOString()}${c.unpushed ? ' · not on remote' : ''} · Show commit changes`
      : (c.unpushed ? 'Not on remote · Show commit changes' : 'Show commit changes');
    // Keep author tooltip on `.who` only - a title on the row steals hover from the avatar.
    // Refs: content-sized pill + optional +N (hover menu of the rest).
    parts.push(`<div class="row clickable${sel}${on}${unpushed}"${laneStyle} role="button" tabindex="0" data-commit="${esc(c.id)}">${rowCells(cols, {
      labels: refs,
      graph: '',
      author: who,
      commit: `<span class="text">${esc(c.subject)}</span>`,
      sha,
      when: esc(c.when),
    }, {
      author: whoTitle,
      commit: whenTitle,
      sha: whenTitle,
      when: whenTitle,
    })}</div>`);
  });

  rowsEl.innerHTML = svg + parts.join('');
  // CSP blocks inline onerror; bind after paint. Cached 404s may already be complete.
  rowsEl.querySelectorAll('.avatar img').forEach((img) => {
    const drop = () => img.remove();
    img.addEventListener('error', drop);
    if (img.complete && !img.naturalWidth) drop();
  });
  rowsEl.scrollTop = scrollTop;
}

/**
 * Linear history (branch overview): same Branch/Tag · Author · Commit · SHA · When
 * chrome as the board graph, with a slim single-lane spine instead of multi-lane SVG.
 */
export function renderLinearHistory(root, {
  commits = [],
  selectedCommit = null,
  currentBranch = null,
  runningLanes = new Set(),
  gravatar = true,
  columns = null,
} = {}) {
  const rowsEl = root.querySelector('.rows') || root;
  const cols = normalizeGraphColumns(columns ?? defaultGraphColumns());
  const showSvg = visibleColumns(cols).some((c) => c.id === 'graph');
  const width = 28;
  const { rows: layout, height } = layoutGraphRows(commits);
  const y = (i) => layout[i].cy;
  const cx = 14;
  const color = 'var(--lane-0, var(--primary))';
  let edges = '';
  let nodes = '';
  if (showSvg) {
    commits.forEach((c, i) => {
      if (i < commits.length - 1) {
        edges += `<path class="edge" d="M${cx} ${y(i)} V${y(i + 1)}" stroke="${color}"/>`;
      } else {
        edges += `<path class="edge" d="M${cx} ${y(i)} V${height + ROW}" stroke="${color}"/>`;
      }
      if (i === 0) {
        nodes += `<circle class="node tip" cx="${cx}" cy="${y(i)}" r="5.5" fill="${color}" stroke="var(--canvas)" stroke-width="1.5"/>`;
      } else {
        nodes += `<circle class="node" cx="${cx}" cy="${y(i)}" r="3.5" fill="${color}"/>`;
      }
    });
  }
  const svg = showSvg && commits.length
    ? `<svg width="${width}" height="${height + ROW}" viewBox="0 0 ${width} ${height + ROW}" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
    <g fill="none" stroke-width="1.5" stroke-linecap="round">${edges}</g>
    <g>${nodes}</g>
  </svg>`
    : '';

  const tips = new Set(commits.filter((c) => c.isTip || c.refs?.some((r) => !r.tag)).map((c) => c.id));
  const parts = commits.map((c) => {
    const list = c.refs || [];
    const { shown, overflow } = visibleRefs(list, { currentBranch });
    const hidden = overflow
      ? list.filter((r) => !shown.includes(r)).slice().sort((a, b) => refKindRank(a) - refKindRank(b) || a.name.localeCompare(b.name))
      : [];
    const pillOpts = (r) => ({
      running: r.worktree && !r.primary && runningLanes.has(c.lane),
      current: !!currentBranch && r.name === currentBranch,
      readonly: true,
    });
    const refs = shown.map((r) => refPill(r, pillOpts(r))).join('') + (overflow
      ? `<span class="ref-more">
          <span class="ref overflow" aria-label="${overflow} more refs">+${overflow}</span>
          <span class="ref-more-pop" role="menu"><span class="ref-more-pop-inner">${hidden.map((r) => refPill(r, pillOpts(r))).join('')}</span></span>
        </span>`
      : '');
    const tip = tips.has(c.id);
    const kind = authorLabel[c.kind] ? c.kind : 'human';
    const whoName = c.author && c.email
      ? `${c.author} <${c.email}>`
      : (c.author || c.email || '');
    const whoTitle = [whoName, tip && (c.tool || authorLabel[kind])].filter(Boolean).join(' · ');
    const hue = authorHue(c.email || c.author);
    const face = gravatar ? gravatarUrl(c.avatarHash) : '';
    const img = face
      ? `<img src="${esc(face)}" alt="" width="18" height="18" decoding="async" referrerpolicy="no-referrer" />`
      : '';
    const badge = kind !== 'human' ? aiToolBadgeHTML(c.tool) : '';
    const who = `<span class="who-mark" aria-hidden="true"><span class="avatar" style="--avatar-hue:${hue}">${img}${esc(authorInitial(c.author))}</span>${badge}</span>`;
    const sha = esc(String(c.id || '').slice(0, 7));
    const on = selectedCommit === c.id ? ' active-commit' : '';
    const laneStyle = on ? ` style="--row-lane: ${color}"` : '';
    const whenTitle = c.at
      ? `${new Date(c.at * 1000).toISOString()} · Show commit on board`
      : 'Show commit on board';
    return `<div class="row clickable selected-lane${on}"${laneStyle} role="button" tabindex="0" data-overview-commit="${esc(c.id)}">${rowCells(cols, {
      labels: refs,
      graph: '',
      author: who,
      commit: `<span class="text">${esc(c.subject)}</span>`,
      sha,
      when: esc(c.when),
    }, {
      author: whoTitle,
      commit: whenTitle,
      sha: whenTitle,
      when: whenTitle,
    })}</div>`;
  });

  rowsEl.innerHTML = svg + parts.join('');
  rowsEl.querySelectorAll('.avatar img').forEach((img) => {
    const drop = () => img.remove();
    img.addEventListener('error', drop);
    if (img.complete && !img.naturalWidth) drop();
  });
}
