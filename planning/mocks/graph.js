/* Plenum graph mock. Renders rows plus an SVG overlay from commit data.
   Newer at top. One column per lane. Tip nodes carry the authorship color. */

const ROW = 30;
const COL_X0 = 14;
const COL_W = 24;
const laneColor = (c) => `var(--lane-${c})`;
const authorColor = { human: 'var(--human)', assisted: 'var(--assisted)', agent: 'var(--agent)' };
const authorIcon = { human: 'user', assisted: 'sparkle', agent: 'robot' };
const authorLabel = { human: 'Human', assisted: 'Assisted', agent: 'Agent' };

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const refPill = (r, running) => {
  const cls = ['ref', r.primary && 'primary', r.remote && 'remote', r.tag && 'tag', running && 'running'].filter(Boolean).join(' ');
  const ic = r.tag ? 'git-commit' : r.primary ? 'shield-check' : r.wt ? 'tree-structure' : 'git-branch';
  const dot = running ? `<i class="run-dot" title="Running"></i>` : '';
  return `<span class="${cls}">${icon(ic)}${r.n}${dot}</span>`;
};

function renderGraph(root, { commits, selectedLane = 1, runningLanes = new Set() }) {
  const rowsEl = root.querySelector('.rows');
  const index = new Map(commits.map((c, i) => [c.id, i]));
  const x = (lane) => COL_X0 + lane * COL_W;
  const y = (i) => i * ROW + ROW / 2;
  const height = commits.length * ROW;
  const tips = new Set(commits.filter((c) => c.refs?.some((r) => !r.tag)).map((c) => c.id));

  // Edges: vertical in the child's column, then a curve into the parent's column over the last row.
  // A parent that is not in the list is older than the window; the edge runs off the bottom.
  let edges = '';
  commits.forEach((c, i) => {
    c.parents.forEach((pid) => {
      const p = index.get(pid);
      const dash = c.wip ? ' stroke-dasharray="3 3"' : '';
      if (p == null) {
        const dim = c.lane !== selectedLane ? ' dim' : '';
        edges += `<path class="edge${dim}" d="M${x(c.lane)} ${y(i)} V${height}" stroke="${laneColor(c.lane)}"/>`;
        return;
      }
      const parent = commits[p];
      const dim = c.lane !== selectedLane && parent.lane !== selectedLane ? ' dim' : '';
      const color = laneColor(c.lane === 0 && parent.lane !== 0 ? parent.lane : c.lane);
      let d;
      if (c.lane === parent.lane) {
        d = `M${x(c.lane)} ${y(i)} V${y(p)}`;
      } else {
        const yTurn = y(p - 1);
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
    if (c.wip) {
      const col = c.danger ? 'var(--danger)' : 'var(--warning)';
      nodes += `<circle class="node wip${dim}" cx="${cx}" cy="${cy}" r="4" fill="var(--surface-1)" stroke="${col}" stroke-dasharray="2 2"/>`;
    } else if (c.merge) {
      nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="4" fill="var(--canvas)" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
    } else if (tips.has(c.id)) {
      nodes += `<circle class="node tip${dim}" cx="${cx}" cy="${cy}" r="5.5" fill="${authorColor[c.kind]}" stroke="${laneColor(c.lane)}" stroke-width="1.5"/>`;
    } else {
      nodes += `<circle class="node${dim}" cx="${cx}" cy="${cy}" r="3.5" fill="${laneColor(c.lane)}"/>`;
    }
  });

  const svg = `<svg width="136" height="${height}" viewBox="0 0 136 ${height}" aria-hidden="true">
    <g fill="none" stroke-width="1.5" stroke-linecap="round">${edges}</g>
    <g>${nodes}</g>
  </svg>`;

  const rows = commits
    .map((c) => {
      const sel = c.lane === selectedLane ? ' selected-lane' : ' dim';
      if (c.wip) {
        return `<div class="row wip${c.danger ? ' danger' : ''}${sel}" role="row">
          <span></span>
          <span class="msg">${icon(c.danger ? 'warning-circle' : 'circle-dashed', 'sm')}<span class="text">${c.msg}</span><button class="open" type="button">Open</button></span>
          <span></span><span></span><span></span>
        </div>`;
      }
      const refs = (c.refs || []).map((r) => refPill(r, r.wt && !r.primary && runningLanes.has(c.lane))).join('');
      const tip = tips.has(c.id);
      // Human is the default, so only AI involvement gets a pill, and only on the tip.
      const pill = tip && c.kind !== 'human'
        ? `<span class="pill ${c.kind}">${icon(authorIcon[c.kind])}${authorLabel[c.kind]}${c.tool ? `, ${c.tool}` : ''}</span>`
        : '';
      const who = `${icon(authorIcon[c.kind], c.kind)}<span>${c.who}</span>${pill}`;
      return `<div class="row${sel}" role="row">
        <span></span>
        <span class="msg">${refs}<span class="text">${c.msg}</span></span>
        <span class="who">${who}</span>
        <span class="sha">${c.id}</span>
        <span class="time">${c.time}</span>
      </div>`;
    })
    .join('');

  rowsEl.innerHTML = svg + rows;
}

window.PlenumGraph = { renderGraph };
