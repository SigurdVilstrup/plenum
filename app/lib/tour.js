// First-run / Quick start tour: dim the window, spotlight a real element, explain it.
// Steps whose target is not on screen (no repo open, panel hidden) are skipped.

const MOD = (typeof window !== 'undefined' && window.plenum && window.plenum.isMac === false) ? 'Ctrl+' : '⌘';

export const TOUR_STEPS = [
  {
    title: 'Welcome to Plenum',
    body: 'One board for every worktree of a repo. A lane is a worktree with Plenum’s runner set up so it can Start on its own ports. Plain worktrees sit under Worktrees until you Open as lane.',
  },
  {
    sel: '.searchbtn',
    title: `Lost? Press ${MOD}P`,
    body: 'Search for a lane, branch, file, or an action like New lane, Commit or Feedback. Whenever you do not know what to do next, start here.',
  },
  {
    sel: '#panel',
    title: 'Protected, Lanes, Worktrees',
    body: 'Protected is the root workspace (a lane role) — usually on your team tip; you still commit there. Lanes can Start/Stop/Test. Worktrees are not lanes yet — Open as lane applies the recipe. Behind means commits on the team tip the lane does not have yet.',
  },
  {
    sel: '.graph',
    title: 'History',
    body: 'The commits of the selected lane. When an agent wrote the newest commit, a pill says which one. Humans get no pill.',
  },
  {
    sel: '#lane-head',
    title: 'Act on the lane',
    body: 'Commit, push, pull, rebase and Finish live here. Uncommitted files open a Changes panel on the right. With a .plenum/lane.yaml you also get Start, Stop and Test — including on Protected.',
  },
  {
    title: 'Make it yours',
    body: `Settings (${MOD},) → Agents connects Cursor, Claude Code or Codex. Feedback is one ${MOD}P away. Replay this tour any time: ${MOD}P → Quick start.`,
  },
];

export function visibleSteps(steps, isShown) {
  return steps.filter((s) => !s.sel || isShown(s.sel));
}

/** Where the card goes next to rect r: below, right, left, above; else centered on r. */
export function placeCard(r, card, vw, vh, gap = 14, pad = 12) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const x = clamp(r.left + r.width / 2 - card.w / 2, pad, vw - card.w - pad);
  const y = clamp(r.top + r.height / 2 - card.h / 2, pad, vh - card.h - pad);
  const options = [
    [r.bottom + gap + card.h <= vh - pad, { left: x, top: r.bottom + gap }],
    [r.right + gap + card.w <= vw - pad, { left: r.right + gap, top: clamp(r.top, pad, vh - card.h - pad) }],
    [r.left - gap - card.w >= pad, { left: r.left - gap - card.w, top: clamp(r.top, pad, vh - card.h - pad) }],
    [r.top - gap - card.h >= pad, { left: x, top: r.top - gap - card.h }],
  ];
  return (options.find(([ok]) => ok)?.[1]) || { left: x, top: y };
}

const SPOT_PAD = 4;
const isShown = (sel) => {
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return !!r && r.width > 0 && r.height > 0;
};

export function startTour({ steps = TOUR_STEPS, onEnd } = {}) {
  const list = visibleSteps(steps, isShown);
  if (!list.length || document.querySelector('.tour-layer')) return false;
  let i = 0;

  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = `
    <div class="tour-spot"></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <h2 id="tour-title"></h2>
      <p class="tour-body"></p>
      <p class="tour-lost">Lost? Press <kbd>⌘P</kbd></p>
      <div class="tour-foot">
        <button class="btn" type="button" data-skip>Skip</button>
        <span class="tour-count muted"></span>
        <span class="tour-nav">
          <button class="btn" type="button" data-back>Back</button>
          <button class="btn primary" type="button" data-next></button>
        </span>
      </div>
    </div>`;
  const q = (s) => layer.querySelector(s);
  const spot = q('.tour-spot');
  const card = q('.tour-card');

  function render() {
    const s = list[i];
    q('#tour-title').textContent = s.title;
    q('.tour-body').textContent = s.body;
    q('.tour-lost').hidden = i < 2; // the ⌘P card says it itself; welcome comes first
    q('.tour-count').textContent = `${i + 1} / ${list.length}`;
    q('[data-back]').hidden = i === 0;
    q('[data-next]').textContent = i === list.length - 1 ? 'Done' : 'Next';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = s.sel && document.querySelector(s.sel)?.getBoundingClientRect();
    // No target: a zero-size spot in the middle still dims the whole window via its shadow.
    const box = r || { left: vw / 2, top: vh / 2, width: 0, height: 0, right: vw / 2, bottom: vh / 2 };
    const p = r ? SPOT_PAD : 0;
    Object.assign(spot.style, {
      left: `${box.left - p}px`, top: `${box.top - p}px`,
      width: `${box.width + 2 * p}px`, height: `${box.height + 2 * p}px`,
    });
    const size = { w: card.offsetWidth, h: card.offsetHeight };
    const pos = r
      ? placeCard({ ...box, left: box.left - p, top: box.top - p, right: box.right + p, bottom: box.bottom + p, width: box.width + 2 * p, height: box.height + 2 * p }, size, vw, vh)
      : { left: (vw - size.w) / 2, top: (vh - size.h) / 2 };
    card.style.left = `${pos.left}px`;
    card.style.top = `${pos.top}px`;
  }

  function end() {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', render);
    layer.remove();
    const s = document.querySelector('.searchbtn');
    s?.classList.add('tour-pulse');
    setTimeout(() => s?.classList.remove('tour-pulse'), 2400);
    onEnd?.();
  }
  const next = () => (i === list.length - 1 ? end() : (i++, render(), q('[data-next]').focus()));
  const back = () => { if (i > 0) { i--; render(); q('[data-next]').focus(); } };

  function onKey(e) {
    if (e.metaKey || e.ctrlKey) return; // ⌘P / ⌘K stay live: that is the whole point
    if (!document.getElementById('palette-layer')?.hidden) return; // palette owns the keys while open
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') back();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  q('[data-next]').addEventListener('click', next);
  q('[data-back]').addEventListener('click', back);
  q('[data-skip]').addEventListener('click', end);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', render);
  document.body.appendChild(layer);
  render();
  q('[data-next]').focus();
  return true;
}
