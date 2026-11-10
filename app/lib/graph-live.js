/* Live graph. Escapes all git-sourced strings before innerHTML. */

import { authorLabel } from './authorship-pill.js';
import { authorHue, authorInitial } from './author-avatar.js';
import { visibleRefs } from './graph-refs.js';

const ROW = 30;
const COL_X0 = 14;
const COL_W = 24;
const laneColor = (c) => `var(--lane-${c})`;
const authorColor = {
  human: 'var(--human)',
  assisted: 'var(--assisted)',
  agent: 'var(--agent)',
  mixed: 'var(--assisted)',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const icon = (name, cls = '') => {
  const safe = String(name || 'circle-dashed').replace(/[^a-z0-9-]/g, '');
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${safe}"></use></svg>`;
};

const refPill = (r, { running = false, current = false } = {}) => {
  const cls = [
    'ref',
    r.primary && 'primary',
    r.remote && 'remote',
    r.tag && 'tag',
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
  const body = `${icon(ic)}${esc(r.name)}${dot}`;
  if (r.tag) return `<span class="${cls}">${body}</span>`;
  const title = current
    ? `${esc(r.name)} · checked out here`
    : `${esc(r.name)} · Click to check out · right-click for more`;
  return `<button type="button" class="${cls}" data-branch-name="${esc(r.name)}" title="${title}">${body}</button>`;
};

/** Uniform row centers — no day-divider gaps. */
export function layoutGraphRows(commits) {
  const rows = commits.map((_, i) => ({ cy: i * ROW + ROW / 2 }));
  return { rows, height: Math.max(ROW, commits.length * ROW) };
}

export function renderGraph(root, { commits, selectedLane = 0, selectedCommit = null, runningLanes = new Set(), currentBranch = null }) {
  const rowsEl = root.querySelector('.rows');
  const scrollTop = rowsEl.scrollTop;
  const index = new Map(commits.map((c, i) => [c.id, i]));
  // Fixed canvas width so switching lanes never nudges the grid.
  const width = 136;
  const x = (lane) => COL_X0 + Math.min(lane, 4) * COL_W;
  const { rows: layout, height } = layoutGraphRows(commits);
  const y = (i) => layout[i].cy;
  const tips = new Set(commits.filter((c) => (c.isTip || c.refs?.some((r) => !r.tag))).map((c) => c.id));

  let edges = '';
  commits.forEach((c, i) => {
    c.parents.forEach((pid) => {
      const p = index.get(pid);
      const dash = c.isWIP ? ' stroke-dasharray="3 3"' : '';
      if (p == null) {
        const dim = c.lane !== selectedLane ? ' dim' : '';
        // Continue past the last painted tip so load-older doesn't look cut off.
        edges += `<path class="edge${dim}" d="M${x(c.lane)} ${y(i)} V${height + ROW}" stroke="${laneColor(c.lane)}"/>`;
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

  let nodes = '';
  commits.forEach((c, i) => {
    const cx = x(c.lane);
    const cy = y(i);
    const dim = c.lane !== selectedLane ? ' dim' : '';
    if (c.isWIP) {
      const col = c.danger ? 'var(--danger)' : 'var(--warning)';
      nodes += `<circle class="node wip${dim}" cx="${cx}" cy="${cy}" r="4" fill="var(--surface-1)" stroke="${col}" stroke-dasharray="2 2"/>`;
    } else if (c.isMerge) {
      nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="4" fill="var(--canvas)" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
    } else if (tips.has(c.id)) {
      const fill = authorColor[c.kind] || authorColor.human;
      nodes += `<circle class="node tip${dim}" cx="${cx}" cy="${cy}" r="5.5" fill="${fill}" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
    } else {
      nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="3.5" fill="${laneColor(c.lane)}"/>`;
    }
  });

  const svg = `<svg width="${width}" height="${height + ROW}" viewBox="0 0 ${width} ${height + ROW}" aria-hidden="true">
    <g fill="none" stroke-width="1.5" stroke-linecap="round">${edges}</g>
    <g>${nodes}</g>
  </svg>`;

  const parts = [];
  commits.forEach((c) => {
    const sel = c.lane === selectedLane ? ' selected-lane' : ' dim';
    if (c.isWIP) {
      const on = selectedCommit === `wip-${c.lane}` ? ' active-commit' : '';
      const laneStyle = on ? ` style="--row-lane: ${laneColor(c.lane)}"` : '';
      const n = Number(c.dirtyCount) || 0;
      const count = `${n} file${n === 1 ? '' : 's'}`;
      const hint = c.danger ? 'on primary' : 'Review';
      parts.push(`<div class="row wip${c.danger ? ' danger' : ''}${sel}${on}"${laneStyle} role="button" tabindex="0" data-wip-lane="${c.lane}" title="Show uncommitted changes">
          <span></span>
          <span class="who"></span>
          <span class="msg">
            <span class="wip-label">Working tree</span>
            <span class="wip-count">${esc(count)}</span>
            <span class="wip-hint">${esc(hint)}</span>
          </span>
          <span></span>
          <span class="time">now</span>
        </div>`);
      return;
    }
    const list = c.refs || [];
    const { shown, overflow } = visibleRefs(list, { currentBranch });
    const refs = shown.map((r) => refPill(r, {
      running: r.worktree && !r.primary && runningLanes.has(c.lane),
      current: !!currentBranch && r.name === currentBranch,
    })).join('') + (overflow
      ? `<span class="ref overflow" title="${esc(list.filter((r) => !shown.includes(r)).map((r) => r.name).join(', '))}">+${overflow}</span>`
      : '');
    const tip = tips.has(c.id);
    const kind = authorLabel[c.kind] ? c.kind : 'human';
    const whoTitle = [c.author, tip && (c.tool || authorLabel[kind])].filter(Boolean).join(' · ');
    const hue = authorHue(c.email || c.author);
    const who = `<span class="avatar ${kind}" style="--avatar-hue:${hue}" aria-hidden="true">${esc(authorInitial(c.author))}</span>`;
    const sha = esc(String(c.id || '').slice(0, 7));
    const on = selectedCommit === c.id ? ' active-commit' : '';
    const unpushed = c.unpushed ? ' unpushed' : '';
    const laneStyle = on ? ` style="--row-lane: ${laneColor(c.lane)}"` : '';
    const whenTitle = c.at
      ? `${new Date(c.at * 1000).toISOString()}${c.unpushed ? ' · not on remote' : ''} · Show commit changes`
      : (c.unpushed ? 'Not on remote · Show commit changes' : 'Show commit changes');
    parts.push(`<div class="row clickable${sel}${on}${unpushed}"${laneStyle} role="button" tabindex="0" data-commit="${esc(c.id)}" title="${esc(whenTitle)}">
        <span></span>
        <span class="who" title="${esc(whoTitle)}">${who}</span>
        <span class="msg">${refs}<span class="text">${esc(c.subject)}</span></span>
        <span class="sha">${sha}</span>
        <span class="time">${esc(c.when)}</span>
      </div>`);
  });

  rowsEl.innerHTML = svg + parts.join('');
  rowsEl.scrollTop = scrollTop;
}
