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
  changes: null, // { kind:'wip', laneIndex } | { kind:'commit', sha }
  collapsedDirs: new Set(),
  changesPaintKey: '',
  changesCache: null,
  commitDraft: '',
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
  changes: document.getElementById('changes'),
  body: document.getElementById('body'),
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
    closeChanges();
    if (!state.loading) el.loading.hidden = true;
    return;
  }
  el.empty.hidden = true;
  el.loading.hidden = true;
  el.panel.hidden = false;
  el.main.hidden = false;
  paintPanel();
  paintHeader();
  const selectedCommit = state.changes?.kind === 'commit'
    ? state.changes.sha
    : state.changes?.kind === 'wip'
      ? `wip-${state.changes.laneIndex}`
      : null;
  renderGraph(el.graph, {
    commits: state.board.commits,
    selectedLane: state.selectedLane,
    selectedCommit,
    runningLanes: new Set(state.board.lanes.filter((l) => l.running).map((l) => l.index)),
  });
  if (state.changes) paintChanges();
}

let tabDragId = null;
let tabDidDrag = false;

async function applyTabOrder(fromId, overId, after) {
  if (!fromId || !overId || fromId === overId) return;
  const tabs = [...state.store.tabs];
  const from = tabs.findIndex((t) => t.id === fromId);
  if (from < 0) return;
  const [moved] = tabs.splice(from, 1);
  let insert = tabs.findIndex((t) => t.id === overId);
  if (insert < 0) return;
  if (after) insert += 1;
  tabs.splice(insert, 0, moved);
  const store = await invoke('tabs.reorder', tabs.map((t) => t.id));
  applyStore(store);
  paintTabs();
}

function paintTabs() {
  const frag = document.createDocumentFragment();
  for (const t of state.store.tabs) {
    const btn = document.createElement('button');
    btn.className = `tab${t.id === state.store.activeId ? ' active' : ''}`;
    btn.type = 'button';
    btn.dataset.id = t.id;
    btn.draggable = true;
    if (t.id === state.store.activeId) btn.setAttribute('aria-current', 'page');
    btn.appendChild(icon(t.icon || 'folder-simple', 'sm'));
    btn.appendChild(document.createTextNode(` ${t.title}`));
    btn.addEventListener('click', () => {
      if (tabDidDrag) { tabDidDrag = false; return; }
      selectTab(t.id);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, t, btn);
    });
    btn.addEventListener('dragstart', (e) => {
      tabDragId = t.id;
      tabDidDrag = false;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => {
      tabDragId = null;
      btn.classList.remove('dragging');
      el.tabstrip.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach((n) => {
        n.classList.remove('drop-before', 'drop-after');
      });
    });
    btn.addEventListener('dragover', (e) => {
      if (!tabDragId || tabDragId === t.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const mid = btn.getBoundingClientRect().left + btn.offsetWidth / 2;
      const after = e.clientX > mid;
      btn.classList.toggle('drop-after', after);
      btn.classList.toggle('drop-before', !after);
      el.tabstrip.querySelectorAll('.tab').forEach((n) => {
        if (n !== btn) n.classList.remove('drop-before', 'drop-after');
      });
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drop-before', 'drop-after');
    });
    btn.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromId = tabDragId || e.dataTransfer.getData('text/plain');
      const after = btn.classList.contains('drop-after');
      btn.classList.remove('drop-before', 'drop-after');
      if (!fromId || fromId === t.id) return;
      tabDidDrag = true;
      try { await applyTabOrder(fromId, t.id, after); } catch { /* toasted */ }
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

function openCtxMenu(x, y, tab, anchor) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.textContent = 'Rename…';
  rename.addEventListener('click', () => {
    menu.remove();
    openRename(tab, anchor);
  });
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
  menu.append(rename, close);
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
  const pop = document.createElement('div');
  pop.className = 'rename-pop';
  let chosen = tab.icon || 'folder-simple';
  const grid = document.createElement('div');
  grid.className = 'icon-grid inline';
  const paintIcons = () => {
    grid.replaceChildren();
    for (const name of TAB_ICONS) {
      const b = document.createElement('button');
      b.type = 'button';
      if (name === chosen) b.classList.add('on');
      b.appendChild(icon(name, 'sm'));
      b.addEventListener('click', () => {
        chosen = name;
        paintIcons();
      });
      grid.appendChild(b);
    }
  };
  paintIcons();
  const input = document.createElement('input');
  input.value = tab.title;
  input.setAttribute('aria-label', 'Rename tab');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'iconbtn';
  save.setAttribute('aria-label', 'Save');
  save.appendChild(icon('check-circle'));
  const doSave = async () => {
    let store = await invoke('tabs.rename', tab.id, input.value);
    if (chosen !== (tab.icon || 'folder-simple')) {
      store = await invoke('tabs.setIcon', tab.id, chosen);
    }
    applyStore(store);
    pop.remove();
    paintTabs();
  };
  save.addEventListener('click', doSave);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') pop.remove();
  });
  const row = document.createElement('div');
  row.className = 'rename-row';
  row.append(input, save);
  pop.append(grid, row);
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
      <span class="meta ${primary.dirty ? 'bad' : 'ok'}">${primary.dirty ? `${primary.dirty} uncommitted` : 'clean'}</span>
    </button>
  </div>`;

  const rows = lanes.map((l) => {
    const enter = state.enteringLanes.has(l.index) ? ' enter' : '';
    const flash = state.flashMarks.has(l.index) ? ' flash' : '';
    const run = l.running ? ' running' : '';
    const runTitle = l.running ? ' Running.' : '';
    let mark;
    if (l.readiness === 'working') mark = `<span class="mark working${flash}${run}" title="Working: uncommitted changes.${runTitle}"><i></i></span>`;
    else if (l.readiness === 'safe') mark = `<span class="mark safe${flash}${run}" title="Safe to remove: merged, tree clean.${runTitle}">${iconHTML('check-circle')}</span>`;
    else mark = `<span class="mark unmerged${flash}${run}" title="Not merged.${runTitle}"><i></i></span>`;
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

  const running = lanes.filter((l) => l.running);
  if (running.length) {
    const runningRows = running.map((l) => {
      const port = l.ports ? Object.values(l.ports)[0] : null;
      return `<button class="lane-row run-row ${l.index === selected ? 'selected' : ''}" type="button" data-lane="${l.index}">
        <span class="mark live-ring"><i></i></span>
        <span class="name">${esc(l.name)}</span>
        <span class="meta mono">${port != null ? `:${esc(port)}` : ''}</span>
        <span class="stop iconbtn" role="button" data-act="down" title="Stop lane" aria-label="Stop ${esc(l.name)}">${iconHTML('stop')}</span>
      </button>`;
    }).join('');
    html += `<div class="section">
      <div class="section-head"><span title="Lanes with their own copy of the stack running. Ports are offset per lane; data is shared unless the manifest says otherwise.">Running <span class="count">${running.length}</span></span></div>
      ${runningRows}
    </div>`;
  }

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
  el.panel.querySelectorAll('.run-row [data-act="down"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lane = laneByIndex(Number(btn.closest('[data-lane]')?.dataset.lane));
      if (lane) handleAction('down', lane);
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
  const stashes = state.board?.stashCount || 0;
  if (state.conflictRoot) a.push(`<button class="btn" type="button" data-act="conflicts" title="Resume conflict walk">${iconHTML('warning-circle', 'sm')}Resolve conflicts</button>`);
  if (l.isPrimary) {
    if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit on ${esc(l.name)}">${iconHTML('git-commit', 'sm')}Commit</button>`);
    if (l.dirty) a.push(`<button class="btn" type="button" data-act="stash" title="Stash uncommitted changes">${iconHTML('stack', 'sm')}Stash</button>`);
    if (stashes) a.push(`<button class="btn" type="button" data-act="stashPop" title="Pop latest stash">${iconHTML('stack', 'sm')}Pop stash${stashes > 1 ? ` · ${stashes}` : ''}</button>`);
    if (l.ahead) a.push(`<button class="btn" type="button" data-act="push" title="Push ${esc(l.name)} to origin">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.ahead}</span></button>`);
    a.push(`<button class="btn" type="button" data-act="pull" title="Pull ${esc(l.name)} (ff-only)">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
    return a.join('');
  }
  if (l.readiness === 'safe' && !state.conflictRoot && !stashes) return a.join('');
  if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit in this lane">${iconHTML('git-commit', 'sm')}Commit</button>`);
  if (l.dirty) a.push(`<button class="btn" type="button" data-act="stash" title="Stash uncommitted changes">${iconHTML('stack', 'sm')}Stash</button>`);
  if (stashes) a.push(`<button class="btn" type="button" data-act="stashPop" title="Pop latest stash">${iconHTML('stack', 'sm')}Pop stash${stashes > 1 ? ` · ${stashes}` : ''}</button>`);
  if (l.readiness === 'safe' && !state.conflictRoot) return a.join('');
  if (l.behind) a.push(`<button class="btn" type="button" data-act="rebase" title="Rebase this lane onto ${esc(state.board.teamRef)}">${iconHTML('arrow-counter-clockwise', 'sm')}Rebase on main</button>`);
  else if (l.ahead && !l.dirty) a.push(`<button class="btn" type="button" data-act="merge" title="Merge this lane into main">${iconHTML('git-merge', 'sm')}Merge into main</button>`);
  if (l.ahead) a.push(`<button class="btn" type="button" data-act="push" title="Push (force-with-lease after rebase)">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.ahead}</span></button>`);
  a.push(`<button class="btn" type="button" data-act="pull" title="Pull ff-only">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
  return a.join('');
}

function laneSetupLink() {
  return `<button class="env-link" type="button" data-act="doctor">${iconHTML('gear-six', 'sm')}Lane setup</button>`;
}

function runActionsHTML(l) {
  if (l.isPrimary) {
    return `<span class="env-note">${iconHTML('shield-check', 'sm')}Never started by Overlook. Run the stack from a lane.</span>${laneSetupLink()}`;
  }
  if (l.readiness === 'safe') {
    return `<span class="env-note">${iconHTML('stop', 'sm')}Not running. Merged lanes are not started.</span>`;
  }
  if (!l.runnable) {
    return `<span class="env-note">${iconHTML('warning-circle', 'sm')}no lane.yaml</span>${laneSetupLink()}`;
  }
  const runBtn = l.running
    ? `<button class="btn" type="button" data-act="down" title="Stop lane">${iconHTML('stop', 'sm')}Stop</button>`
    : `<button class="btn" type="button" data-act="up" title="Run lane">${iconHTML('play', 'sm')}Run</button>`;
  const urls = Object.entries(l.urls || {}).map(([name, url]) => {
    let port = '';
    try { port = new URL(url).port; } catch { /* ignore */ }
    return `<button class="chip url" type="button" data-act="openUrl" data-url="${esc(url)}" title="${esc(url)}">${iconHTML('globe-simple', 'sm')}${esc(name)} <span class="mono">:${esc(port)}</span></button>`;
  }).join('');
  const badge = l.dataMode === 'shared'
    ? `<span class="badge data" title="Databases shared across lanes. Switch a service to snapshot in .overlook/lane.yaml for an isolated copy.">${iconHTML('database', 'sm')}shared data</span>`
    : l.dataMode === 'snapshot'
      ? `<span class="badge data" title="This lane seeds its own copy via services.*.snapshot (or data.snapshot) before Run.">${iconHTML('database', 'sm')}snapshot data</span>`
      : '';
  const tests = l.lastTest
    ? `<span class="env-note">${iconHTML(l.lastTest.ok ? 'check-circle' : 'warning-circle', 'sm')}tests ${l.lastTest.ok ? 'passed' : 'failed'}</span>`
    : '';
  return `${runBtn}<button class="btn" type="button" data-act="test" title="Run tests">${iconHTML('flask', 'sm')}Test</button><span class="env-sep"></span>${urls}${urls && badge ? '<span class="env-sep"></span>' : ''}${badge}${tests}`;
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
          ? `<span class="fact bad">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>`
          : `<span class="fact">${iconHTML('shield-check', 'sm')}<strong>${l.onTeamBranch ? 'on' : 'not on'}</strong> ${esc(b.teamBranch)}</span>
             <span class="fact">${iconHTML('circle-dashed', 'sm')}<strong>clean</strong></span>`}
        ${l.ahead ? `<span class="fact bad">${iconHTML('git-commit', 'sm')}<strong>${l.ahead}</strong> ahead of ${esc(b.teamRef)}</span>` : ''}
        ${l.authorship && authorLabel[l.authorship] && l.authorship !== 'human' ? `<span class="pill ${esc(l.authorship)}">${iconHTML(authorIcon[l.authorship])}${authorLabel[l.authorship]}${l.tool ? `, ${esc(l.tool)}` : ''}</span>` : ''}
      </div>
      <div class="actions">
        ${gitActionsHTML(l)}
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        <button class="iconbtn framed primary" type="button" data-act="cursor" title="Open in Cursor" aria-label="Open in Cursor">${iconHTML('cursor')}</button>
      </div>
    </div>
    <div class="env-row">${runActionsHTML(l)}</div>`;
  } else {
    const behind = l.readiness === 'safe'
      ? `<span class="fact ok">${iconHTML('check-circle', 'sm')}<strong>merged</strong> into ${esc(b.teamBranch)}</span>`
      : l.behind > 0
        ? `<span class="fact ${l.behind >= 5 ? 'bad' : 'warn'}">${iconHTML('cloud-arrow-down', 'sm')}<strong>${l.behind} behind</strong> ${esc(b.teamBranch)}${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`
        : `<span class="fact">${iconHTML('cloud-arrow-down', 'sm')}<strong>up to date</strong>${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`;
    const dirty = l.dirty
      ? `<span class="fact warn">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>`
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
        <button class="iconbtn framed primary" type="button" data-act="cursor" title="Open in Cursor" aria-label="Open in Cursor">${iconHTML('cursor')}</button>
      </div>
    </div>
    <div class="env-row">${runActionsHTML(l)}</div>`;
  }
  el.laneHead.innerHTML = html;
  el.laneHead.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(btn.dataset.act, l, btn.dataset.url);
    });
  });
}

async function handleAction(act, lane, url) {
  try {
    if (act === 'reveal') return invoke('os.reveal', lane.path);
    if (act === 'cursor') return invoke('os.openCursor', lane.path);
    if (act === 'openUrl') return invoke('os.openExternal', url);
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
    if (act === 'doctor') return openDoctorSheet();
    if (act === 'conflicts') return openConflictSheet(lane);
    if (act === 'stash') {
      return runGit('lane.stash', lane.index, `Stashed uncommitted changes on ${lane.name}`, 'stash');
    }
    if (act === 'stashPop') {
      return runGit('lane.stashPop', lane.index, `Popped stash onto ${lane.name}`, 'stashPop');
    }
    if (act === 'up') {
      return runUp(lane);
    }
    if (act === 'down') {
      return runGit('lane.down', lane.index, `Stopped ${lane.name}`, 'down');
    }
    if (act === 'test') {
      if (state.busy) return;
      state.busy = true;
      setActionBusy('test', true);
      try {
        const board = await invoke('lane.test', lane.index);
        state.flashMarks.add(lane.index);
        applyBoard(board);
        const ok = board?.lanes?.find((x) => x.index === lane.index)?.lastTest?.ok;
        toast(ok ? `Tests passed for ${lane.name}` : `Tests failed for ${lane.name}`, ok ? 'ok' : 'bad');
      } finally {
        state.busy = false;
        setActionBusy('test', false);
      }
      return;
    }
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

async function runUp(lane, { force = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  setActionBusy('up', true);
  try {
    const res = await invoke('lane.up', lane.index, force ? { force: true } : undefined);
    if (res?.drift) {
      openDriftSheet(lane, res.pending || []);
      return;
    }
    state.flashMarks.add(lane.index);
    applyBoard(res);
    toast(`Started ${lane.name}`, 'ok');
  } finally {
    state.busy = false;
    setActionBusy('up', false);
  }
}

function openDriftSheet(lane, pending) {
  const n = pending.length;
  const list = pending.length
    ? `<ul class="mono" style="margin:0;padding-left:1.2em">${pending.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
    : '';
  const others = (state.board?.lanes || [])
    .filter((x) => x.running && x.index !== lane.index)
    .map((x) => x.name);
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="up-title">
      <div class="eyebrow warn">${iconHTML('warning-circle', 'sm')}Shared database</div>
      <h1 id="up-title">Run ${esc(lane.name)}</h1>
      <p>This lane has ${n} migration${n === 1 ? '' : 's'} the shared database has not run. Every lane uses that database${others.length ? `, including ${others.map(esc).join(' and ')}` : ''}.</p>
      ${list}
      <div class="list">
        <label class="list-row compact choice">
          <input type="radio" name="up" value="force" checked />
          <div class="name">Start without them<small>The app starts; the code in this lane may not match the schema.</small></div>
        </label>
        <label class="list-row compact choice">
          <input type="radio" name="up" value="snapshot" />
          <div class="name">Switch service to snapshot<small>Open Lane setup to set <span class="mono">mode: snapshot</span> plus a <span class="mono">snapshot:</span> command in <span class="mono">.overlook/lane.yaml</span>. Next Run seeds that copy on the offset ports.</small></div>
        </label>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('play', 'sm')}Continue</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const choice = el.sheetLayer.querySelector('input[name=up]:checked')?.value;
    closeSheet();
    if (choice === 'snapshot') {
      openDoctorSheet();
      return;
    }
    if (choice === 'force') await runUp(lane, { force: true });
  });
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

async function openDoctorSheet() {
  if (!state.board) return;
  let findings = [];
  let proposedYaml = '';
  let canAccept = false;
  try {
    const res = await invoke('repo.doctor');
    findings = res.findings || [];
    proposedYaml = res.proposedYaml || '';
    canAccept = !!res.canAccept;
  } catch { /* toasted */ return; }

  const findingsHtml = findings.length
    ? findings.map((f) => `<div class="finding">${iconHTML('terminal-window', 'sm')}<div>${esc(f)}</div></div>`).join('')
    : `<div class="finding">${iconHTML('warning-circle', 'sm')}<div>Nothing obvious found in this repo.</div></div>`;

  openSheet(`
    <form class="modal doctor-sheet" role="dialog" aria-labelledby="doctor-title">
      <div class="eyebrow">${iconHTML('gear-six', 'sm')}Lane setup</div>
      <h1 id="doctor-title">Doctor proposal</h1>
      <p>Why a second checkout cannot start today, and the <span class="mono">.overlook/lane.yaml</span> that fixes it. Nothing is written until you accept.</p>
      <div class="setup cols">
        <div>
          <div class="col-head">Findings</div>
          ${findingsHtml}
        </div>
        <div>
          <div class="col-head">Proposed <span class="mono">.overlook/lane.yaml</span></div>
          <pre class="doctor-yaml">${esc(proposedYaml)}</pre>
        </div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit" ${canAccept ? '' : 'disabled title="Needs a run command"'}>${iconHTML('files', 'sm')}Accept</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canAccept) return;
    try {
      const board = await invoke('repo.acceptManifest', proposedYaml);
      closeSheet();
      applyBoard(board);
      toast('Wrote .overlook/lane.yaml', 'ok');
    } catch { /* toasted */ }
  });
}

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

function dirtyKind(code) {
  const c = String(code || '');
  if (c === '??') return 'new';
  if (c.includes('D')) return 'deleted';
  if (c.includes('R') || c.includes('C')) return 'renamed';
  if (c.includes('A')) return 'added';
  return 'modified';
}

function dirtyMark(code) {
  const kind = dirtyKind(code);
  return { new: 'U', deleted: 'D', renamed: 'R', added: 'A', modified: 'M' }[kind] || 'M';
}

function nestDirty(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = String(f.path).split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push({ ...f, name: parts[parts.length - 1] });
  }
  return root;
}

function formatStat(f) {
  const a = Number(f.added) || 0;
  const d = Number(f.deleted) || 0;
  if (!a && !d) return '';
  return `<span class="stat">${a ? `<span class="add">+${a}</span>` : ''}${d ? `<span class="del">−${d}</span>` : ''}</span>`;
}

function renderDirtyTree(node, depth = 0, prefix = '') {
  const pad = `padding-left:${6 + depth * 12}px`;
  let html = '';
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = prefix ? `${prefix}/${name}` : name;
    const collapsed = state.collapsedDirs.has(key);
    html += `<button class="fx-folder${collapsed ? ' collapsed' : ''}" type="button" style="${pad}" data-dir="${esc(key)}">
      ${iconHTML('caret-down', 'sm caret')}${iconHTML('folder-simple', 'sm')}<span class="name">${esc(name)}</span>
    </button>`;
    if (!collapsed) html += renderDirtyTree(child, depth + 1, key);
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    const kind = dirtyKind(f.code);
    html += `<button class="fx-file" type="button" style="${pad}" data-file="${esc(f.path)}" title="${esc(f.path)}">
      ${iconHTML('files', 'sm')}<span class="name">${esc(f.name)}</span>${formatStat(f)}<span class="mark ${kind}">${dirtyMark(f.code)}</span>
    </button>`;
  }
  return html;
}

function changesKey(view) {
  if (!view) return '';
  const fold = [...state.collapsedDirs].join(',');
  if (view.kind === 'wip') {
    const lane = laneByIndex(view.laneIndex);
    const files = lane?.dirtyFiles || [];
    return `wip:${view.laneIndex}:${files.map((f) => `${f.path}:${f.code}:${f.added}:${f.deleted}`).join(';')}:${fold}`;
  }
  return `c:${view.sha}:${fold}`;
}

function closeChanges() {
  state.changes = null;
  state.changesPaintKey = '';
  state.changesCache = null;
  el.changes.hidden = true;
  el.changes.innerHTML = '';
  el.body.classList.remove('with-changes');
}

function bindCommitChord(textarea, onCommit) {
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    }
  });
}

async function commitLaneMessage(lane, message) {
  const msg = String(message || '').trim();
  if (!msg) {
    toast('Commit message required', 'bad');
    return false;
  }
  const board = await invoke('lane.commit', lane.index, msg);
  state.flashMarks.add(lane.index);
  state.commitDraft = '';
  if (state.changes?.kind === 'wip') closeChanges();
  applyBoard(board);
  toast(`Committed on ${lane.name}`, 'ok');
  return true;
}

function bindChangesTree(basePath) {
  el.changes.querySelector('[data-close-changes]')?.addEventListener('click', () => {
    closeChanges();
    paint();
  });
  el.changes.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.dir;
      if (state.collapsedDirs.has(key)) state.collapsedDirs.delete(key);
      else state.collapsedDirs.add(key);
      paintChanges();
    });
  });
  el.changes.querySelectorAll('[data-file]').forEach((btn) => {
    btn.addEventListener('click', () => invoke('os.openCursor', `${basePath}/${btn.dataset.file}`));
  });
}

async function paintChanges() {
  const view = state.changes;
  if (!view) {
    closeChanges();
    return;
  }
  const key = changesKey(view);
  if (key && key === state.changesPaintKey && !el.changes.hidden) return;
  state.changesPaintKey = key;
  el.changes.hidden = false;
  el.body.classList.add('with-changes');

  if (view.kind === 'wip') {
    const lane = laneByIndex(view.laneIndex);
    if (!lane?.dirty) {
      closeChanges();
      return;
    }
    const files = lane.dirtyFiles || [];
    const tree = nestDirty(files);
    el.changes.innerHTML = `
      <div class="changes-head">
        <div class="title">Uncommitted<small>${esc(lane.name)} · ${files.length}</small></div>
        <button class="iconbtn" type="button" data-close-changes title="Close" aria-label="Close">${iconHTML('x')}</button>
      </div>
      <div class="changes-tree" role="tree">
        ${files.length ? renderDirtyTree(tree) : '<div class="fx-empty">No uncommitted files</div>'}
      </div>
      <div class="changes-foot">
        ${files.length ? `
          <textarea class="commit-msg" name="message" rows="2" placeholder="Commit message" aria-label="Commit message"></textarea>
          <div class="foot-actions">
            <button class="btn" type="button" data-stash>${iconHTML('stack', 'sm')}Stash</button>
            <button class="btn primary" type="button" data-commit>${iconHTML('git-commit', 'sm')}Commit</button>
            <span class="hint">⌘⏎</span>
          </div>` : ''}
      </div>`;
    bindChangesTree(lane.path);
    const ta = el.changes.querySelector('.commit-msg');
    const doCommit = async () => {
      try { await commitLaneMessage(lane, ta?.value); } catch { /* toasted */ }
    };
    el.changes.querySelector('[data-commit]')?.addEventListener('click', doCommit);
    el.changes.querySelector('[data-stash]')?.addEventListener('click', () => handleAction('stash', lane));
    if (ta) {
      ta.value = state.commitDraft;
      ta.addEventListener('input', () => { state.commitDraft = ta.value; });
      bindCommitChord(ta, doCommit);
    }
    return;
  }

  if (view.kind === 'commit') {
    const token = view.sha;
    const renderCommit = (data) => {
      const files = data.files || [];
      const tree = nestDirty(files);
      const rootPath = state.board?.root || '';
      el.changes.innerHTML = `
        <div class="changes-head">
          <div class="title">${esc(data.subject || 'Commit')}<small>${esc(data.short)} · ${files.length} · ${esc(data.author || '')}</small></div>
          <button class="iconbtn" type="button" data-close-changes title="Close" aria-label="Close">${iconHTML('x')}</button>
        </div>
        <div class="changes-tree" role="tree">
          ${files.length ? renderDirtyTree(tree) : '<div class="fx-empty">No file changes</div>'}
        </div>`;
      bindChangesTree(rootPath);
    };
    if (state.changesCache?.sha === token) {
      renderCommit(state.changesCache.data);
      return;
    }
    el.changes.innerHTML = `
      <div class="changes-head">
        <div class="title">Commit<small>Loading…</small></div>
        <button class="iconbtn" type="button" data-close-changes title="Close" aria-label="Close">${iconHTML('x')}</button>
      </div>
      <div class="changes-tree"><div class="fx-empty">Loading changes…</div></div>`;
    el.changes.querySelector('[data-close-changes]')?.addEventListener('click', () => { closeChanges(); paint(); });
    try {
      const data = await invoke('commit.changes', token);
      if (state.changes?.kind !== 'commit' || state.changes.sha !== token) return;
      state.changesCache = { sha: token, data };
      // Key may match before render finished; force tree paint after load.
      state.changesPaintKey = '';
      renderCommit(data);
      state.changesPaintKey = changesKey(state.changes);
    } catch {
      if (state.changes?.kind === 'commit' && state.changes.sha === token) {
        el.changes.querySelector('.changes-tree').innerHTML = '<div class="fx-empty">Could not load changes</div>';
      }
    }
  }
}

function openCommitSheet(lane) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="commit-title">
      <div class="eyebrow">${iconHTML('git-commit', 'sm')}Commit</div>
      <h1 id="commit-title">Commit on ${esc(lane.name)}</h1>
      <p>${lane.dirty} uncommitted file${lane.dirty === 1 ? '' : 's'} will be staged and committed${lane.isPrimary ? '' : ' in this lane'}.</p>
      <label class="field">Message<textarea name="message" rows="3" required autofocus placeholder="Describe the change"></textarea></label>
      <div class="row-end">
        <span class="hint-text">⌘⏎</span>
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('git-commit', 'sm')}Commit</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const ta = form.querySelector('textarea');
  const submit = async () => {
    try {
      if (await commitLaneMessage(lane, ta.value)) closeSheet();
    } catch { /* toasted */ }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  bindCommitChord(ta, submit);
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
    { id: 'doctor', label: 'Doctor / Lane setup…', run: () => { closePalette(); openDoctorSheet(); }, when: !!state.board },
    { id: 'commit', label: 'Commit…', run: () => openCommitSheet(lane), when: lane && lane.dirty },
    { id: 'stash', label: 'Stash uncommitted', run: () => handleAction('stash', lane), when: lane && lane.dirty },
    { id: 'stashPop', label: 'Pop stash', run: () => handleAction('stashPop', lane), when: lane && state.board?.stashCount },
    { id: 'push', label: `Push ${lane?.name || ''} to origin`.trim(), run: () => handleAction('push', lane), when: lane && lane.ahead },
    { id: 'pull', label: `Pull ${lane?.name || ''} (ff-only)`.trim(), run: () => handleAction('pull', lane), when: !!lane },
    { id: 'rebase', label: 'Rebase on main', run: () => handleAction('rebase', lane), when: lane && !lane.isPrimary && lane.behind },
    { id: 'merge', label: 'Merge into main…', run: () => handleAction('merge', lane), when: lane && !lane.isPrimary && lane.ahead && !lane.dirty },
    { id: 'conflicts', label: 'Resolve conflicts…', run: () => handleAction('conflicts', lane), when: !!lane },
    { id: 'up', label: 'Run lane', run: () => handleAction('up', lane), when: lane && !lane.isPrimary && lane.runnable && !lane.running && lane.readiness !== 'safe' },
    { id: 'down', label: 'Stop lane', run: () => handleAction('down', lane), when: lane && lane.running },
    { id: 'test', label: 'Test lane', run: () => handleAction('test', lane), when: lane && !lane.isPrimary && lane.runnable && lane.readiness !== 'safe' },
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
    else if (state.changes) { closeChanges(); paint(); }
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

el.graph.addEventListener('click', (e) => {
  const wip = e.target.closest('[data-wip-lane]');
  if (wip && el.graph.contains(wip)) {
    const lane = laneByIndex(Number(wip.dataset.wipLane));
    if (!lane) return;
    const closing = state.changes?.kind === 'wip' && state.changes.laneIndex === lane.index;
    state.selectedLane = lane.index;
    state.changes = closing ? null : { kind: 'wip', laneIndex: lane.index };
    paint();
    return;
  }
  const commit = e.target.closest('[data-commit]');
  if (commit && el.graph.contains(commit)) {
    const sha = commit.dataset.commit;
    const closing = state.changes?.kind === 'commit' && state.changes.sha === sha;
    state.changes = closing ? null : { kind: 'commit', sha };
    paint();
  }
});
el.graph.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-wip-lane], [data-commit]');
  if (!row || !el.graph.contains(row)) return;
  e.preventDefault();
  row.click();
});

el.openRepo.addEventListener('click', openRepo);
boot();
