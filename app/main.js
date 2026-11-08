import './lib/icons.js';
import { renderGraph } from './lib/graph-live.js';

const api = window.overlook;
const icon = (n, c = '') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${c}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${n}`);
  svg.appendChild(use);
  return svg;
};
const iconHTML = (n, c = '') => {
  // Trusted static icon names only — never pass user input as n.
  const safe = String(n).replace(/[^a-z0-9-]/g, '');
  return `<svg class="icon ${c}" aria-hidden="true"><use href="#i-${safe}"></use></svg>`;
};

const TAB_ICONS = [
  'folder-simple', 'tree-structure', 'git-branch', 'git-commit',
  'sparkle', 'robot', 'shield-check', 'files', 'flask', 'database',
  'gear-six', 'command',
];

const authorIcon = { human: 'user', assisted: 'sparkle', agent: 'robot', mixed: 'git-merge' };
const authorLabel = { human: 'Human', assisted: 'Assisted', agent: 'Agent', mixed: 'Mixed' };

const pathCache = new Map();
async function prettyPath(p) {
  if (!p) return '';
  if (pathCache.has(p)) return pathCache.get(p);
  try {
    const d = await invoke('os.displayPath', p);
    pathCache.set(p, d);
    return d;
  } catch { return p; }
}

const state = {
  store: { tabs: [], activeId: null },
  board: null,
  selectedLane: 0,
  loading: false,
  enteringLanes: new Set(),
  flashMarks: new Set(),
  busy: false,
  conflictRoot: null,
  branchesOpen: false,
};

const el = {
  tabstrip: document.getElementById('tabstrip'),
  loading: document.getElementById('loading'),
  loadingTitle: document.getElementById('loading-title'),
  loadingPath: document.getElementById('loading-path'),
  empty: document.getElementById('empty'),
  openRepo: document.getElementById('open-repo'),
  panel: document.getElementById('panel'),
  main: document.getElementById('main'),
  laneHead: document.getElementById('lane-head'),
  graph: document.querySelector('.graph'),
  paletteLayer: document.getElementById('palette-layer'),
  paletteInput: document.getElementById('palette-input'),
  paletteResults: document.getElementById('palette-results'),
  sheetLayer: document.getElementById('sheet-layer'),
  toast: document.getElementById('toast'),
};

function applyTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function toast(msg, kind = '') {
  el.toast.hidden = false;
  el.toast.className = `toast ${kind}`.trim();
  el.toast.setAttribute('role', 'status');
  el.toast.textContent = String(msg).replace(/^Error:\s*/i, '').split('\n')[0];
  clearTimeout(toast._t);
  const ms = kind === 'bad' ? 6000 : 2800;
  toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

let loadingTimer = null;
function setLoading(on, title = 'Opening repository…', path = '') {
  state.loading = on;
  clearTimeout(loadingTimer);
  if (on) {
    el.loadingTitle.textContent = title;
    el.loadingPath.textContent = path;
    el.empty.hidden = true;
    loadingTimer = setTimeout(() => {
      if (!state.loading) return;
      el.loading.hidden = false;
      el.panel.hidden = true;
      el.main.hidden = true;
    }, 150);
  } else {
    el.loading.hidden = true;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function activeTab() {
  return state.store.tabs.find((t) => t.id === state.store.activeId) ?? null;
}

function laneByIndex(i) {
  return state.board?.lanes.find((l) => l.index === i) ?? null;
}

async function invoke(channel, ...args) {
  try {
    return await api.invoke(channel, ...args);
  } catch (e) {
    const msg = e?.message || String(e);
    toast(msg.replace(/^Error invoking remote method [^:]+:\s*/, ''), 'bad');
    throw e;
  }
}

function applyStore(store) {
  if (store) state.store = store;
}

async function applyBoard(board, { selectLane, enterLane } = {}) {
  const prev = state.board;
  state.board = board;
  if (board) {
    board.displayRoot = await prettyPath(board.root);
    for (const l of board.lanes) l.displayPath = await prettyPath(l.path);
    if (enterLane != null) state.enteringLanes.add(enterLane);
    if (selectLane != null) state.selectedLane = selectLane;
    else if (!board.lanes.some((l) => l.index === state.selectedLane)) {
      state.selectedLane = board.lanes[1]?.index ?? 0;
    }
    if (prev) {
      const prevIds = new Set(prev.lanes.map((l) => l.path));
      for (const l of board.lanes) {
        if (!l.isPrimary && !prevIds.has(l.path)) state.enteringLanes.add(l.index);
      }
    }
  }
  paint();
  requestAnimationFrame(() => {
    state.enteringLanes.clear();
    state.flashMarks.clear();
  });
}


function paint() {
  paintTabs();
  const tab = activeTab();
  if (!tab || !state.board) {
      el.empty.hidden = false;
    el.panel.hidden = true;
    el.main.hidden = true;
    if (!state.loading) el.loading.hidden = true;
    return;
  }
  el.empty.hidden = true;
  el.loading.hidden = true;
  el.panel.hidden = false;
  el.main.hidden = false;
  paintPanel();
  paintHeader();
  renderGraph(el.graph, { commits: state.board.commits, selectedLane: state.selectedLane });
}

function paintTabs() {
  const frag = document.createDocumentFragment();
  for (const t of state.store.tabs) {
    const btn = document.createElement('button');
    btn.className = `tab${t.id === state.store.activeId ? ' active' : ''}`;
    btn.type = 'button';
    btn.dataset.id = t.id;
    if (t.id === state.store.activeId) btn.setAttribute('aria-current', 'page');
    btn.appendChild(icon(t.icon || 'folder-simple', 'sm'));
    btn.appendChild(document.createTextNode(` ${t.title}`));
    btn.addEventListener('click', () => selectTab(t.id));
    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openRename(t, btn);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, t);
    });
    const iconHit = btn.querySelector('svg');
    iconHit?.addEventListener('click', (e) => {
      e.stopPropagation();
      openIconPicker(t, btn);
    });
    frag.appendChild(btn);
  }
  const add = document.createElement('button');
  add.className = 'tab add';
  add.type = 'button';
  add.setAttribute('aria-label', 'Add repository');
  add.appendChild(icon('plus'));
  add.addEventListener('click', openRepo);
  frag.appendChild(add);
  el.tabstrip.replaceChildren(frag);
}

function openCtxMenu(x, y, tab) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'danger';
  close.textContent = 'Close Tab';
  close.addEventListener('click', async () => {
    menu.remove();
    const res = await invoke('tabs.close', tab.id);
    applyStore(res.store);
    applyBoard(res.board);
  });
  menu.appendChild(close);
  document.body.appendChild(menu);
  const off = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('mousedown', off);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function openRename(tab, anchor) {
  document.querySelector('.rename-pop')?.remove();
  document.querySelector('.icon-grid')?.remove();
  const pop = document.createElement('div');
  pop.className = 'rename-pop';
  const input = document.createElement('input');
  input.value = tab.title;
  input.setAttribute('aria-label', 'Rename tab');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'iconbtn';
  save.setAttribute('aria-label', 'Save');
  save.appendChild(icon('check-circle'));
  const doSave = async () => {
    const store = await invoke('tabs.rename', tab.id, input.value);
    applyStore(store);
    pop.remove();
    paintTabs();
  };
  save.addEventListener('click', doSave);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') pop.remove();
  });
  pop.append(input, save);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.zIndex = '40';
  input.focus();
  input.select();
  const off = (ev) => {
    if (!pop.contains(ev.target)) {
      pop.remove();
      document.removeEventListener('mousedown', off);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function openIconPicker(tab, anchor) {
  document.querySelector('.icon-grid')?.remove();
  document.querySelector('.rename-pop')?.remove();
  const grid = document.createElement('div');
  grid.className = 'icon-grid';
  for (const name of TAB_ICONS) {
    const b = document.createElement('button');
    b.type = 'button';
    if (name === tab.icon) b.classList.add('on');
    b.appendChild(icon(name, 'sm'));
    b.addEventListener('click', async () => {
      const store = await invoke('tabs.setIcon', tab.id, name);
      applyStore(store);
      grid.remove();
      paintTabs();
    });
    grid.appendChild(b);
  }
  document.body.appendChild(grid);
  const r = anchor.getBoundingClientRect();
  grid.style.position = 'fixed';
  grid.style.left = `${r.left}px`;
  grid.style.top = `${r.bottom + 6}px`;
  grid.style.zIndex = '40';
  const off = (ev) => {
    if (!grid.contains(ev.target)) {
      grid.remove();
      document.removeEventListener('mousedown', off);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function paintPanel() {
  const b = state.board;
  const selected = state.selectedLane;
  const primary = b.lanes[0];
  const lanes = b.lanes.slice(1);
  const markPrimary = primary.alert
    ? `${iconHTML('warning-circle')}`
    : `${iconHTML('shield-check')}`;
  let html = `<div class="section">
    <div class="section-head" title="The checkout on the team branch. Overlook watches it and never works in it.">Protected</div>
    <button class="lane-row ${selected === 0 ? 'selected' : ''}" type="button" data-lane="0">
      <span class="mark protected ${primary.alert ? 'alert' : ''}">${markPrimary}</span>
      <span class="name">${esc(primary.name)}</span>
      <span class="meta ${primary.dirty ? 'bad' : 'ok'}">${primary.dirty ? `${primary.dirty} dirty` : 'clean'}</span>
    </button>
  </div>`;

  const rows = lanes.map((l) => {
    const enter = state.enteringLanes.has(l.index) ? ' enter' : '';
    const flash = state.flashMarks.has(l.index) ? ' flash' : '';
    let mark;
    if (l.readiness === 'working') mark = `<span class="mark working${flash}" title="Working: uncommitted changes."><i></i></span>`;
    else if (l.readiness === 'safe') mark = `<span class="mark safe${flash}" title="Safe to remove: merged, tree clean.">${iconHTML('check-circle')}</span>`;
    else mark = `<span class="mark unmerged${flash}" title="Not merged."><i></i></span>`;
    const meta = l.readiness === 'safe'
      ? `<span class="meta ok">merged</span>`
      : l.behind > 0
        ? `<span class="meta ${l.behind >= 5 ? 'bad' : 'warn'}" title="${l.behind} commits behind ${esc(b.teamRef)}">${iconHTML('cloud-arrow-down', 'sm')}${l.behind}</span>`
        : `<span class="meta"></span>`;
    const folder = l.folder ? `<span class="folder">${esc(l.folder)}</span>` : '';
    return `<button class="lane-row${enter}${l.index === selected ? ' selected' : ''}" type="button" data-lane="${l.index}" aria-pressed="${l.index === selected}">
      ${mark}<span class="name">${esc(l.name)}</span>${meta}${folder}
    </button>`;
  }).join('');

  html += `<div class="section">
    <div class="section-head">
      <span title="A lane is a git worktree on its own branch.">Lanes <span class="count">${lanes.length}</span></span>
      <button class="iconbtn" type="button" data-new-lane aria-label="New lane from main">${iconHTML('plus')}</button>
    </div>
    ${rows}
  </div>`;

  const branches = b.branches || [];
  const branchBody = branches.length
    ? branches.map((br) => `<div class="lane-row static"><span class="name">${esc(br.name)}</span></div>`).join('')
    : `<div class="empty-note">None</div>`;
  html += `<div class="section">
    <button class="lane-row" type="button" data-branches aria-expanded="${state.branchesOpen}">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="name" style="color: var(--ink-subtle)">Branches without a lane</span>
      <span class="meta">${branches.length}</span>
    </button>
    <div class="branch-list"${state.branchesOpen ? '' : ' hidden'}>${branchBody}</div>
  </div>`;

  el.panel.innerHTML = html;
  el.panel.querySelectorAll('[data-lane]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedLane = Number(btn.dataset.lane);
      paint();
    });
  });
  el.panel.querySelector('[data-new-lane]')?.addEventListener('click', openCreateLane);
  el.panel.querySelector('[data-branches]')?.addEventListener('click', () => {
    state.branchesOpen = !state.branchesOpen;
    paint();
  });
}

function gitActionsHTML(l) {
  const a = [];
  if (state.conflictRoot) a.push(`<button class="btn" type="button" data-act="conflicts" title="Resume conflict walk">${iconHTML('warning-circle', 'sm')}Resolve conflicts</button>`);
  if (l.isPrimary) {
    if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit on ${esc(l.name)}">${iconHTML('git-commit', 'sm')}Commit</button>`);
    if (l.ahead) a.push(`<button class="btn" type="button" data-act="push" title="Push ${esc(l.name)} to origin">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.ahead}</span></button>`);
    a.push(`<button class="btn" type="button" data-act="pull" title="Pull ${esc(l.name)} (ff-only)">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
    return a.join('');
  }
  if (l.readiness === 'safe' && !state.conflictRoot) return a.join('');
  if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit in this lane">${iconHTML('git-commit', 'sm')}Commit</button>`);
  if (l.behind) a.push(`<button class="btn" type="button" data-act="rebase" title="Rebase this lane onto ${esc(state.board.teamRef)}">${iconHTML('arrow-counter-clockwise', 'sm')}Rebase on main</button>`);
  else if (l.ahead && !l.dirty) a.push(`<button class="btn" type="button" data-act="merge" title="Merge this lane into main">${iconHTML('git-merge', 'sm')}Merge into main</button>`);
  if (l.ahead) a.push(`<button class="btn" type="button" data-act="push" title="Push (force-with-lease after rebase)">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.ahead}</span></button>`);
  a.push(`<button class="btn" type="button" data-act="pull" title="Pull ff-only">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
  return a.join('');
}

function paintHeader() {
  const b = state.board;
  const l = laneByIndex(state.selectedLane) || b.lanes[0];
  let html = '';
  if (l.isPrimary) {
    const dirty = l.dirty > 0;
    html = `<div class="head-row">
      <div class="title">
        ${iconHTML(l.alert ? 'warning-circle' : 'shield-check')}
        <div><h1>${esc(l.name)}</h1><div class="path">${esc(l.displayPath || l.path)}, primary checkout</div></div>
      </div>
      <div class="facts">
        ${dirty
          ? `<span class="fact bad">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty} file${l.dirty === 1 ? '' : 's'}</strong> uncommitted</span>`
          : `<span class="fact">${iconHTML('shield-check', 'sm')}<strong>${l.onTeamBranch ? 'on' : 'not on'}</strong> ${esc(b.teamBranch)}</span>
             <span class="fact">${iconHTML('circle-dashed', 'sm')}<strong>clean</strong> tree</span>`}
        ${l.ahead ? `<span class="fact bad">${iconHTML('git-commit', 'sm')}<strong>${l.ahead}</strong> ahead of ${esc(b.teamRef)}</span>` : ''}
        ${l.authorship && authorLabel[l.authorship] && l.authorship !== 'human' ? `<span class="pill ${esc(l.authorship)}">${iconHTML(authorIcon[l.authorship])}${authorLabel[l.authorship]}${l.tool ? `, ${esc(l.tool)}` : ''}</span>` : ''}
      </div>
      <div class="actions">
        ${gitActionsHTML(l)}
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        <button class="btn primary" type="button" data-act="cursor">${iconHTML('arrow-square-out', 'sm')}Open in Cursor</button>
      </div>
    </div>
    <div class="env-row">
      <span class="env-note">${iconHTML('shield-check', 'sm')}Team checkout — prefer lanes for feature work; Commit / Push / Pull work here too.</span>
    </div>`;
  } else {
    const behind = l.readiness === 'safe'
      ? `<span class="fact ok">${iconHTML('check-circle', 'sm')}<strong>merged</strong> into ${esc(b.teamBranch)}</span>`
      : l.behind > 0
        ? `<span class="fact ${l.behind >= 5 ? 'bad' : 'warn'}">${iconHTML('cloud-arrow-down', 'sm')}<strong>${l.behind} behind</strong> ${esc(b.teamBranch)}${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`
        : `<span class="fact">${iconHTML('cloud-arrow-down', 'sm')}<strong>up to date</strong>${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`;
    const dirty = l.dirty
      ? `<span class="fact warn">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty} file${l.dirty === 1 ? '' : 's'}</strong> uncommitted</span>`
      : '';
    const pill = l.authorship && l.authorship !== 'human'
      ? `<span class="pill ${esc(l.authorship)}">${iconHTML(authorIcon[l.authorship])}${authorLabel[l.authorship]}${l.tool ? `, ${esc(l.tool)}` : ''}</span>`
      : '';
    const remove = l.readiness === 'safe'
      ? `<button class="btn ghost-danger" type="button" data-act="remove">${iconHTML('x', 'sm')}Remove lane</button>`
      : '';
    html = `<div class="head-row">
      <div class="title">
        ${iconHTML('tree-structure')}
        <div><h1>${esc(l.name)}</h1><div class="path">${esc(l.folder || l.displayPath || l.path)}</div></div>
      </div>
      <div class="facts">${behind}${dirty}${pill}</div>
      <div class="actions">
        ${remove}${gitActionsHTML(l)}
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        <button class="btn primary" type="button" data-act="cursor">${iconHTML('arrow-square-out', 'sm')}Open in Cursor</button>
      </div>
    </div>
    <div class="env-row" aria-hidden="true"></div>`;
  }
  el.laneHead.innerHTML = html;
  el.laneHead.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.act, l));
  });
}

async function handleAction(act, lane) {
  try {
    if (act === 'reveal') return invoke('os.reveal', lane.path);
    if (act === 'cursor') return invoke('os.openCursor', lane.path);
    if (act === 'commit') return openCommitSheet(lane);
    if (act === 'push') {
      return runGit('lane.push', lane.index, `Pushed ${lane.name} to origin`, 'push');
    }
    if (act === 'pull') {
      return runGit('lane.pull', lane.index, `Pulled ${lane.name} from origin`, 'pull');
    }
    if (act === 'rebase') {
      const team = state.board?.teamRef || 'main';
      return runConflictable('lane.rebase', lane, undefined, 'rebase',
        `Rebased ${lane.name} onto ${team}`);
    }
    if (act === 'merge') return openMergeSheet(lane);
    if (act === 'remove') return openRemoveSheet(lane);
    if (act === 'conflicts') return openConflictSheet(lane);
  } catch { /* toasted */ }
}

function setActionBusy(act, on) {
  document.querySelectorAll(`[data-act="${act}"]`).forEach((btn) => {
    btn.classList.toggle('busy', on);
    btn.disabled = on;
    const spin = btn.querySelector(':scope > .btn-spin');
    if (on && !spin) {
      const i = document.createElement('i');
      i.className = 'spinner btn-spin';
      i.setAttribute('aria-hidden', 'true');
      btn.prepend(i);
    } else if (!on && spin) {
      spin.remove();
    }
  });
}

async function runGit(channel, laneIndex, okMsg, act) {
  if (state.busy) return;
  state.busy = true;
  if (act) setActionBusy(act, true);
  try {
    const board = await invoke(channel, laneIndex);
    state.flashMarks.add(laneIndex);
    applyBoard(board);
    toast(okMsg, 'ok');
  } finally {
    state.busy = false;
    if (act) setActionBusy(act, false);
  }
}

async function runConflictable(channel, lane, extra, act, okMsg) {
  if (state.busy) return;
  state.busy = true;
  if (act) setActionBusy(act, true);
  try {
    const res = await invoke(channel, lane.index, extra);
    if (res?.conflict) {
      state.conflictRoot = res.conflictRoot || null;
      openConflictSheet(lane, res);
      return;
    }
    state.flashMarks.add(lane.index);
    applyBoard(res);
    const team = state.board?.teamBranch || 'main';
    toast(okMsg || (channel.includes('rebase')
      ? `Rebased ${lane.name} onto ${team}`
      : `Merged ${lane.name} into ${team}`), 'ok');
  } finally {
    state.busy = false;
    if (act) setActionBusy(act, false);
  }
}

function openSheet(html) {
  el.sheetLayer.innerHTML = html;
  el.sheetLayer.classList.add('open');
  el.sheetLayer.querySelector('[data-close]')?.addEventListener('click', closeSheet);
  const form = el.sheetLayer.querySelector('form');
  form?.addEventListener('submit', (e) => e.preventDefault());
}

function closeSheet() {
  el.sheetLayer.classList.remove('open');
  el.sheetLayer.innerHTML = '';
}

el.sheetLayer.addEventListener('click', (e) => {
  if (e.target === el.sheetLayer) closeSheet();
});

function openCreateLane() {
  const team = state.board.teamRef;
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="new-lane-title">
      <div class="eyebrow">${iconHTML('tree-structure', 'sm')}New lane</div>
      <h1 id="new-lane-title">From latest ${esc(state.board.teamBranch)}</h1>
      <p>A linked worktree on its own branch. Primary <span class="mono">${esc(state.board.teamBranch)}</span> is not touched.</p>
      <label class="field">Feature name<input name="name" placeholder="invoice-pdf" required autofocus /></label>
      <label class="field">Branch<input name="branch" placeholder="feat/invoice-pdf" /></label>
      <label class="field">Base<select name="base" disabled><option>${esc(team)}</option></select></label>
      <div class="check">
        ${iconHTML('shield-check')}
        <div><strong>Team step.</strong> Base is current <span class="mono">${esc(team)}</span>. If main moves later, this lane shows as behind on the board.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('arrow-square-out', 'sm')}Create and open in Cursor</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const nameInput = form.querySelector('[name=name]');
  const branchInput = form.querySelector('[name=branch]');
  nameInput.addEventListener('input', () => {
    if (!branchInput.dataset.touched) {
      const slug = nameInput.value.trim().replace(/\s+/g, '-');
      branchInput.value = slug ? `feat/${slug}` : '';
    }
  });
  branchInput.addEventListener('input', () => { branchInput.dataset.touched = '1'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const branch = branchInput.value.trim();
    try {
      const board = await invoke('lane.create', { name, branch });
      const created = board.lanes.find((l) => l.branch === branch || l.name.includes(name))
        || board.lanes[board.lanes.length - 1];
      closeSheet();
      applyBoard(board, { selectLane: created?.index, enterLane: created?.index });
      toast(`Lane ${created?.name || name} created`, 'ok');
      if (created) invoke('os.openCursor', created.path).catch(() => {});
    } catch { /* toasted */ }
  });
  nameInput.focus();
}

function openRemoveSheet(lane) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="remove-title">
      <div class="eyebrow">${iconHTML('check-circle', 'sm')}Safe to remove</div>
      <h1 id="remove-title">Remove lane ${esc(lane.name)}</h1>
      <p>The branch is merged into ${esc(state.board.teamBranch)} and the tree is clean. This removes the folder only.</p>
      <div class="list">
        <div class="list-row compact">
          ${iconHTML('folder-simple')}
          <div class="name">Folder<small class="mono">${esc(lane.folder || lane.path)}</small></div>
          <div class="detail">Deleted from disk</div>
        </div>
        <div class="list-row compact">
          ${iconHTML('git-branch')}
          <div class="name">Branch<small class="mono">${esc(lane.name)}</small></div>
          <div class="detail">Kept</div>
        </div>
      </div>
      <div class="check">
        ${iconHTML('shield-check')}
        <div>One lane at a time. Overlook never removes a lane with uncommitted work or unmerged commits.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit">${iconHTML('x', 'sm')}Remove folder</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const board = await invoke('lane.remove', lane.index);
      closeSheet();
      applyBoard(board, { selectLane: 0 });
      toast(`Removed worktree for ${lane.name}`, 'ok');
    } catch { /* toasted */ }
  });
}

function openCommitSheet(lane) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="commit-title">
      <div class="eyebrow">${iconHTML('git-commit', 'sm')}Commit</div>
      <h1 id="commit-title">Commit on ${esc(lane.name)}</h1>
      <p>${lane.dirty} uncommitted file${lane.dirty === 1 ? '' : 's'} will be staged and committed${lane.isPrimary ? '' : ' in this lane'}.</p>
      <label class="field">Message<textarea name="message" rows="3" required autofocus placeholder="Describe the change"></textarea></label>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('git-commit', 'sm')}Commit</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const ta = form.querySelector('textarea');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const board = await invoke('lane.commit', lane.index, ta.value);
      closeSheet();
      state.flashMarks.add(lane.index);
      applyBoard(board);
      toast(`Committed on ${lane.name}`, 'ok');
    } catch { /* toasted */ }
  });
  ta.focus();
}

function openMergeSheet(lane) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="merge-title">
      <div class="eyebrow">${iconHTML('git-merge', 'sm')}Merge into ${esc(state.board.teamBranch)}</div>
      <h1 id="merge-title">Merge ${esc(lane.name)}</h1>
      <p>Primary must be clean and on ${esc(state.board.teamBranch)}. Choose how to land the commits.</p>
      <div class="list">
        <label class="list-row compact choice"><input type="radio" name="mode" value="ff" checked /><div class="name">Fast-forward<small>Only if history is linear.</small></div></label>
        <label class="list-row compact choice"><input type="radio" name="mode" value="merge" /><div class="name">Merge commit<small>Always creates a merge commit.</small></div></label>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('git-merge', 'sm')}Merge</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = el.sheetLayer.querySelector('input[name=mode]:checked')?.value || 'ff';
    closeSheet();
    const team = state.board?.teamBranch || 'main';
    const how = mode === 'ff' ? 'fast-forward' : 'merge commit';
    await runConflictable(
      'lane.merge',
      lane,
      { mode },
      'merge',
      `Merged ${lane.name} into ${team} (${how})`,
    );
  });
}

async function openConflictSheet(lane, snapshot) {
  let status = snapshot;
  const rootArg = status?.conflictRoot || status?.path || state.conflictRoot || null;
  if (!status?.conflicts && status?.operation == null) {
    status = await invoke('lane.conflicts', lane.index, rootArg);
  }
  if (status?.path || status?.conflictRoot) state.conflictRoot = status.conflictRoot || status.path;
  const files = status.conflicts || [];
  const op = status.operation || 'conflict';
  const work = status.path || state.conflictRoot || lane.path;
  openSheet(`
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div class="eyebrow warn">${iconHTML('warning-circle', 'sm')}${esc(op)}</div>
      <h1 id="conflict-title">Resolve conflicts</h1>
      <p>Open each file in Cursor, fix it, then stage. Continue when every file is staged.</p>
      <div class="list conflict-list">
        ${files.length ? files.map((f) => `
          <div class="list-row compact" data-file="${esc(f)}">
            ${iconHTML('files')}
            <div class="name"><span class="mono">${esc(f)}</span></div>
            <button class="btn" type="button" data-open-file>Open</button>
            <button class="btn" type="button" data-stage-file>Stage</button>
          </div>`).join('') : `<div class="list-row compact"><div class="name">All conflicts staged</div></div>`}
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-abort>Abort</button>
        <button class="btn" type="button" data-close>Close</button>
        <button class="btn primary" type="button" data-continue ${files.length ? 'disabled' : ''}>${iconHTML('check-circle', 'sm')}Continue</button>
      </div>
    </form>`);
  const modal = el.sheetLayer.querySelector('.modal');
  const croot = state.conflictRoot;
  modal.querySelectorAll('[data-open-file]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const file = btn.closest('[data-file]').dataset.file;
      invoke('os.openCursor', `${work}/${file}`);
    });
  });
  modal.querySelectorAll('[data-stage-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const file = btn.closest('[data-file]').dataset.file;
      try {
        const next = await invoke('lane.conflictStage', lane.index, file, croot);
        openConflictSheet(lane, next);
      } catch { /* toasted */ }
    });
  });
  modal.querySelector('[data-continue]')?.addEventListener('click', async () => {
    try {
      const res = await invoke('lane.conflictContinue', lane.index, croot);
      if (res?.conflict) {
        openConflictSheet(lane, res);
        return;
      }
      state.conflictRoot = null;
      closeSheet();
      applyBoard(res);
      toast('Conflicts resolved — continued', 'ok');
    } catch { /* toasted */ }
  });
  modal.querySelector('[data-abort]')?.addEventListener('click', async () => {
    try {
      const board = await invoke('lane.conflictAbort', lane.index, croot);
      state.conflictRoot = null;
      closeSheet();
      applyBoard(board);
      toast('Aborted — branch restored', 'ok');
    } catch { /* toasted */ }
  });
}

/* Palette */
function paletteCommands() {
  const lane = laneByIndex(state.selectedLane);
  const cmds = [
    { id: 'open', label: 'Open Repository…', run: openRepo },
    { id: 'new', label: 'New lane…', run: openCreateLane, when: !!state.board },
    { id: 'commit', label: 'Commit…', run: () => openCommitSheet(lane), when: lane && lane.dirty },
    { id: 'push', label: `Push ${lane?.name || ''} to origin`.trim(), run: () => handleAction('push', lane), when: lane && lane.ahead },
    { id: 'pull', label: `Pull ${lane?.name || ''} (ff-only)`.trim(), run: () => handleAction('pull', lane), when: !!lane },
    { id: 'rebase', label: 'Rebase on main', run: () => handleAction('rebase', lane), when: lane && !lane.isPrimary && lane.behind },
    { id: 'merge', label: 'Merge into main…', run: () => handleAction('merge', lane), when: lane && !lane.isPrimary && lane.ahead && !lane.dirty },
    { id: 'conflicts', label: 'Resolve conflicts…', run: () => handleAction('conflicts', lane), when: !!lane },
    { id: 'reveal', label: 'Reveal in Finder', run: () => handleAction('reveal', lane), when: !!lane },
    { id: 'cursor', label: 'Open in Cursor', run: () => handleAction('cursor', lane), when: !!lane },
    { id: 'refresh', label: 'Refresh board', run: refresh, when: !!state.board },
  ];
  if (state.board) {
    for (const l of state.board.lanes) {
      cmds.push({ id: `lane-${l.index}`, label: `Go to ${l.name}`, run: () => { state.selectedLane = l.index; paint(); closePalette(); } });
    }
  }
  return cmds.filter((c) => c.when !== false);
}

let paletteActive = 0;

function openPalette() {
  el.paletteLayer.hidden = false;
  el.paletteLayer.classList.add('open');
  el.paletteInput.value = '';
  paletteActive = 0;
  renderPalette('');
  el.paletteInput.focus();
}

function closePalette() {
  el.paletteLayer.hidden = true;
  el.paletteLayer.classList.remove('open');
}

function renderPalette(q) {
  const needle = q.trim().toLowerCase();
  const items = paletteCommands().filter((c) => !needle || c.label.toLowerCase().includes(needle));
  if (paletteActive >= items.length) paletteActive = Math.max(0, items.length - 1);
  el.paletteResults.innerHTML = items.map((c, i) =>
    `<button class="item${i === paletteActive ? ' active' : ''}" type="button" data-i="${i}">${iconHTML('command', 'sm')}<span>${esc(c.label)}</span></button>`).join('') || '<div class="empty">No matches</div>';
  el.paletteResults._items = items;
  el.paletteResults.querySelectorAll('[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.i)];
      closePalette();
      item?.run();
    });
  });
}

el.paletteInput.addEventListener('input', () => { paletteActive = 0; renderPalette(el.paletteInput.value); });
el.paletteInput.addEventListener('keydown', (e) => {
  const items = el.paletteResults._items || [];
  if (e.key === 'Escape') { closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteActive = Math.min(items.length - 1, paletteActive + 1); renderPalette(el.paletteInput.value); }
  if (e.key === 'ArrowUp') { e.preventDefault(); paletteActive = Math.max(0, paletteActive - 1); renderPalette(el.paletteInput.value); }
  if (e.key === 'Enter') {
    closePalette();
    items[paletteActive]?.run();
  }
});
el.paletteLayer.addEventListener('click', (e) => {
  if (e.target === el.paletteLayer) closePalette();
});
document.querySelectorAll('[data-palette-open]').forEach((b) => b.addEventListener('click', openPalette));

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'k')) {
    e.preventDefault();
    if (el.paletteLayer.hidden) openPalette();
    else closePalette();
  }
  if (e.key === 'Escape') {
    if (!el.paletteLayer.hidden) closePalette();
    else if (el.sheetLayer.classList.contains('open')) closeSheet();
  }
});

async function openRepo() {
  const path = await invoke('os.pickFolder');
  if (!path) return;
  setLoading(true, 'Opening repository…', path);
  try {
    const res = await invoke('tabs.open', path);
    applyStore(res.store);
    applyBoard(res.board, { selectLane: res.board.lanes[1]?.index ?? 0 });
  } catch {
    setLoading(false);
    paint();
  }
}

async function selectTab(id) {
  if (id === state.store.activeId) return;
  state.store = { ...state.store, activeId: id };
  paintTabs();
  try {
    const res = await invoke('tabs.select', id);
    applyStore(res.store);
    if (res.board) applyBoard(res.board, { selectLane: res.board.lanes[1]?.index ?? 0 });
    else {
      state.board = null;
      paint();
    }
  } catch {
    paint();
  }
}

async function refresh() {
  if (!state.board) return;
  try {
    const board = await invoke('repo.refresh');
    if (board) applyBoard(board);
  } catch { /* toasted */ }
}

window.addEventListener('focus', () => { refresh(); });

async function boot() {
  const store = await invoke('tabs.list');
  applyStore(store);
  if (store.activeId) {
    const tab = store.tabs.find((t) => t.id === store.activeId);
    setLoading(true, 'Opening repository…', tab?.path || '');
    try {
      const board = await invoke('board.get', tab.path);
      applyBoard(board, { selectLane: board.lanes[1]?.index ?? 0 });
    } catch {
      setLoading(false);
      paint();
    }
  } else {
    paint();
  }
}

el.openRepo.addEventListener('click', openRepo);
boot();
