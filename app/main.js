import './lib/icons.js';
import { renderGraph } from './lib/graph-live.js';
import { authorshipPillHTML, authorIcon, authorLabel } from './lib/authorship-pill.js';
import {
  shouldFreeze,
  evictOldest,
  markFrozen,
  WARM_MAX,
  WARM_REFRESH_MS,
  emptyViewChrome,
  captureViewChrome,
  applyChromeToEntry,
} from './lib/warm-tabs.js';
import { renderDiffBody, renderHistoryList, renderBlameBody } from './lib/file-pane.js';
import { groupBranchesByPrefix } from './lib/branch-folders.js';

const api = window.plenum;
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
  /** @type {Map<string, { act?: string }>} in-flight git/lane ops keyed by tab id */
  opsByTab: new Map(),
  conflictRoot: null,
  branchesOpen: true,
  /** Remotes fold-out — collapsed by default; locals are the active work. */
  remotesOpen: false,
  /** Session expand/collapse for branch path folders (#21). */
  collapsedBranchFolders: new Set(),
  changes: null, // { kind:'wip', laneIndex } | { kind:'commit', sha }
  filePane: null, // { sha, path, mode: 'diff'|'blame'|'history' } | null
  collapsedDirs: new Set(),
  changesPaintKey: '',
  changesCache: null,
  commitDraft: '',
  warmTabs: new Map(),
  prefs: {},
  identity: null,
  accounts: null,
  repoBoards: new Map(),
  setup: null,
  identityScope: 'global',
  warmTtlMs: 120000,
  settings: { open: false, page: 'general', setupRoot: null, repoPath: null },
  appInfo: { version: '', commit: '', committedAt: '' },
  historyLimit: 120,
  editors: [],
  loadingOlder: false,
  /** Bumped on every tab switch so superseded select/load work stops painting. */
  switchSeq: 0,
  pendingGraphScroll: null,
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
  fileStage: document.getElementById('file-stage'),
  settings: document.getElementById('settings'),
  settingsNav: document.getElementById('settings-nav'),
  settingsBody: document.getElementById('settings-body'),
  body: document.getElementById('body'),
  laneHead: document.getElementById('lane-head'),
  graph: document.querySelector('.graph'),
  paletteLayer: document.getElementById('palette-layer'),
  paletteInput: document.getElementById('palette-input'),
  paletteResults: document.getElementById('palette-results'),
  sheetLayer: document.getElementById('sheet-layer'),
  toast: document.getElementById('toast'),
  appVersion: document.getElementById('app-version'),
  searchbtn: document.querySelector('.titlebar .searchbtn'),
  titlebar: document.querySelector('.titlebar'),
};

function applyTheme() {
  const t = state.prefs.theme || 'system';
  const dark = t === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function applyPrefs() {
  applyTheme();
  const pack = state.prefs.fontPack || 'system';
  if (pack === 'system') delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = pack;
  api.setZoom(state.prefs.zoom || 1);
  if (state.prefs.warmTabTtlMs) state.warmTtlMs = state.prefs.warmTabTtlMs;
}

async function setPref(partial, render = true) {
  state.prefs = await invoke('prefs.set', partial);
  applyPrefs();
  // Debounce so rapid field edits coalesce to one acknowledgment.
  clearTimeout(setPref._toast);
  setPref._toast = setTimeout(() => toast('Saved', 'ok'), 320);
  if (!render) return;
  const top = el.settingsBody.scrollTop;
  renderSettings();
  el.settingsBody.scrollTop = top;
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
function setLoading(on, title = 'Opening repository…', path = '', { immediate = false } = {}) {
  state.loading = on;
  clearTimeout(loadingTimer);
  if (on) {
    el.loadingTitle.textContent = title;
    el.loadingPath.textContent = path;
    el.empty.hidden = true;
    const show = () => {
      if (!state.loading || state.settings.open) return;
      el.loading.hidden = false;
      el.panel.hidden = true;
      el.main.hidden = true;
    };
    if (immediate) show();
    else loadingTimer = setTimeout(show, 150);
  } else {
    el.loading.hidden = true;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatCommitAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function versionDetailHTML() {
  const { version, commit, committedAt } = state.appInfo;
  const ver = esc(version || '…');
  if (!commit) return `<span class="mono">${ver}</span>`;
  const when = formatCommitAt(committedAt);
  const line2 = when ? `${esc(commit)} · ${esc(when)}` : esc(commit);
  return `<span class="mono">${ver}<br>${line2}</span>`;
}

function paintVersion() {
  const { version, commit, committedAt } = state.appInfo;
  if (!version) {
    el.appVersion.hidden = true;
    el.appVersion.textContent = '';
    el.appVersion.removeAttribute('title');
    return;
  }
  el.appVersion.hidden = false;
  el.appVersion.textContent = version;
  const when = formatCommitAt(committedAt);
  el.appVersion.title = commit
    ? (when ? `${commit} · ${when}` : commit)
    : '';
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

function dropWarm(id) {
  const e = state.warmTabs.get(id);
  if (!e) return;
  markFrozen(e);
  state.warmTabs.delete(id);
}

function graphScrollTop() {
  return el.graph?.querySelector('.rows')?.scrollTop ?? 0;
}

function snapshotWarm(id) {
  if (!id || !state.board) return;
  const tab = state.store.tabs.find((t) => t.id === id);
  const prev = state.warmTabs.get(id);
  if (prev?.timerId) clearInterval(prev.timerId);
  const chrome = captureViewChrome(state, graphScrollTop());
  const entry = {
    path: tab?.path || state.board.root,
    board: state.board,
    leftAt: Date.now(),
    timerId: null,
    frozen: false,
    ...chrome,
  };
  entry.timerId = setInterval(() => warmRefresh(id), WARM_REFRESH_MS);
  state.warmTabs.set(id, entry);
  evictOldest(state.warmTabs, WARM_MAX);
  for (const [k, v] of [...state.warmTabs]) {
    if (k === id) continue;
    if (shouldFreeze(v.leftAt, Date.now(), state.warmTtlMs) && !v.frozen) markFrozen(v);
  }
  setTimeout(() => {
    const e = state.warmTabs.get(id);
    if (!e || e.frozen) return;
    if (shouldFreeze(e.leftAt, Date.now(), state.warmTtlMs)) markFrozen(e);
  }, state.warmTtlMs + 50);
}

function resetViewChrome() {
  const chrome = emptyViewChrome();
  state.selectedLane = chrome.selectedLane;
  state.changes = null;
  state.filePane = null;
  state.collapsedDirs = new Set();
  state.commitDraft = '';
  state.historyLimit = chrome.historyLimit;
  state.branchesOpen = chrome.branchesOpen;
  state.conflictRoot = null;
  state.changesPaintKey = '';
  state.changesCache = null;
  state.pendingGraphScroll = null;
  el.changes.hidden = true;
  el.changes.innerHTML = '';
  el.body.classList.remove('with-changes');
  el.fileStage.hidden = true;
  el.fileStage.innerHTML = '';
  el.body.classList.remove('with-file-pane');
}

function restoreViewChrome(entry) {
  const chrome = entry
    ? captureViewChrome(entry, entry.graphScrollTop || 0)
    : emptyViewChrome();
  state.selectedLane = chrome.selectedLane;
  state.changes = chrome.changes;
  state.filePane = chrome.filePane;
  state.collapsedDirs = new Set(chrome.collapsedDirs || []);
  state.commitDraft = chrome.commitDraft || '';
  state.historyLimit = chrome.historyLimit || 120;
  state.branchesOpen = chrome.branchesOpen !== false;
  state.conflictRoot = chrome.conflictRoot || null;
  state.changesPaintKey = '';
  state.changesCache = null;
  state.pendingGraphScroll = chrome.graphScrollTop || 0;
  if (!state.changes) {
    el.changes.hidden = true;
    el.changes.innerHTML = '';
    el.body.classList.remove('with-changes');
  }
  if (!state.filePane) {
    el.fileStage.hidden = true;
    el.fileStage.innerHTML = '';
    el.body.classList.remove('with-file-pane');
  }
}

/** Apply a board only if this tab is still visible; otherwise refresh its warm cache. */
function settleBoard(tabId, root, board, opts) {
  if (!board) return false;
  if (state.store.activeId === tabId) {
    applyBoard(board, opts);
    return true;
  }
  const w = state.warmTabs.get(tabId);
  if (w && (!root || w.path === root || board.root === w.path)) {
    w.board = board;
    if (board.historyLimit) w.historyLimit = board.historyLimit;
  }
  return false;
}

const OP_LABELS = {
  checkout: 'Checking out…',
  'branch-update': 'Updating from remote…',
  push: 'Pushing…',
  pull: 'Pulling…',
  rebase: 'Rebasing…',
  merge: 'Merging…',
  commit: 'Committing…',
  stash: 'Stashing…',
  stashPop: 'Popping stash…',
  up: 'Starting lane…',
  down: 'Stopping lane…',
  test: 'Running tests…',
  remove: 'Removing lane…',
};

function beginOp(act, detail) {
  const id = state.store.activeId;
  if (!id || state.opsByTab.has(id)) return null;
  state.opsByTab.set(id, { act, detail: detail || '' });
  state.busy = true;
  if (act) setActionBusy(act, true);
  paintOpBusy();
  return id;
}

function endOp(tabId, act) {
  if (tabId) state.opsByTab.delete(tabId);
  state.busy = state.opsByTab.has(state.store.activeId);
  if (act && state.store.activeId === tabId) setActionBusy(act, false);
  paintOpBusy();
}

function paintOpBusy() {
  const host = el.graph || el.main || document.body;
  let bar = document.getElementById('op-busy');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'op-busy';
    bar.className = 'op-busy';
    bar.hidden = true;
    bar.setAttribute('aria-live', 'polite');
    host.appendChild(bar);
  } else if (bar.parentElement !== host) {
    host.appendChild(bar);
  }
  const op = state.opsByTab.get(state.store.activeId);
  if (!op?.act) {
    bar.hidden = true;
    bar.innerHTML = '';
    el.body?.classList.remove('is-busy');
    return;
  }
  el.body?.classList.add('is-busy');
  bar.hidden = false;
  const label = OP_LABELS[op.act] || 'Working…';
  const detail = op.detail ? `<span class="detail">${esc(op.detail)}</span>` : '';
  bar.innerHTML = `<i class="spinner btn-spin" aria-hidden="true"></i><span>${esc(label)}</span>${detail}`;
}

/** Pin IPC to the repo root that started the call (survives tab switches). */
function pin(...args) {
  const root = state.board?.root;
  return root ? [...args, { __root: root }] : args;
}

async function warmRefresh(id) {
  const e = state.warmTabs.get(id);
  if (!e || e.frozen) return;
  if (shouldFreeze(e.leftAt, Date.now(), state.warmTtlMs)) {
    markFrozen(e);
    return;
  }
  try {
    const board = await invoke('board.get', e.path, { historyLimit: e.historyLimit || 120 });
    if (!board) return;
    const cur = state.warmTabs.get(id);
    if (!cur || cur.frozen) return;
    cur.board = board;
    if (board.historyLimit) cur.historyLimit = board.historyLimit;
    if (state.store.activeId === id) applyBoard(board);
  } catch { /* silent */ }
}


async function applyBoard(board, { selectLane, enterLane } = {}) {
  const prev = state.board;
  state.board = board;
  if (board) {
    if (board.historyLimit) state.historyLimit = board.historyLimit;
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
    if (state.pendingGraphScroll != null) {
      const rows = el.graph?.querySelector('.rows');
      if (rows) rows.scrollTop = state.pendingGraphScroll;
      state.pendingGraphScroll = null;
    }
    const op = state.opsByTab.get(state.store.activeId);
    if (op?.act) setActionBusy(op.act, true);
  });
}


function paint() {
  paintTabs();
  el.settings.hidden = !state.settings.open;
  el.body.classList.toggle('settings-open', state.settings.open);
  if (state.settings.open) {
    // Settings owns the body; the board repaints on close.
    for (const n of [el.empty, el.loading, el.panel, el.main, el.changes]) n.hidden = true;
    return;
  }
  const tab = activeTab();
  // Empty state is only for "no tabs". A selected tab without a board yet is loading —
  // never the "Open a repository" marketing empty (that was the dogfood bug).
  if (!tab) {
    el.empty.hidden = false;
    el.loading.hidden = true;
    el.panel.hidden = true;
    el.main.hidden = true;
    closeChanges();
    return;
  }
  if (!state.board) {
    el.empty.hidden = true;
    el.panel.hidden = true;
    el.main.hidden = true;
    closeChanges();
    el.loading.hidden = false;
    if (!state.loading) {
      el.loadingTitle.textContent = 'Opening repository…';
      el.loadingPath.textContent = tab.path || '';
    }
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
    currentBranch: laneByIndex(state.selectedLane)?.branch || null,
  });
  attachOlderSentinel(el.graph.querySelector('.rows'));
  if (state.changes) paintChanges();
}

let olderObserver = null;

function attachOlderSentinel(rowsEl) {
  if (olderObserver) {
    olderObserver.disconnect();
    olderObserver = null;
  }
  if (!rowsEl || !state.board?.historyHasMore) return;
  const foot = document.createElement('div');
  foot.className = 'load-older';
  foot.dataset.loadOlder = '1';
  foot.setAttribute('aria-live', 'polite');
  foot.innerHTML = state.loadingOlder
    ? `<i class="spinner btn-spin" aria-hidden="true"></i><span>Loading older…</span>`
    : '';
  rowsEl.appendChild(foot);
  olderObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadOlderHistory();
  }, { root: rowsEl });
  olderObserver.observe(foot);
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

function tabstripOverflows() {
  return el.tabstrip.scrollWidth > el.tabstrip.clientWidth + 1;
}

/** Collapse the palette label when open tabs need the room; expand when they don't. */
function syncSearchCollapse() {
  const btn = el.searchbtn;
  if (!btn) return;
  if (tabstripOverflows()) {
    btn.classList.add('compact');
    return;
  }
  if (!btn.classList.contains('compact')) return;
  btn.classList.remove('compact');
  if (tabstripOverflows()) btn.classList.add('compact');
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
  requestAnimationFrame(syncSearchCollapse);
}

function openCtxMenu(x, y, tab, anchor) {
  dismissCtxMenus();
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
    const wasActive = tab.id === state.store.activeId;
    if (wasActive) snapshotWarm(tab.id);
    dropWarm(tab.id);
    state.opsByTab.delete(tab.id);
    const res = await invoke('tabs.close', tab.id);
    applyStore(res.store);
    if (!wasActive) {
      paintTabs();
      return;
    }
    const nextId = res.store.activeId;
    const warm = nextId ? state.warmTabs.get(nextId) : null;
    if (warm?.board) {
      restoreViewChrome(warm);
      if (warm.timerId) { clearInterval(warm.timerId); warm.timerId = null; }
      applyBoard(warm.board, { selectLane: warm.selectedLane });
      refresh().catch(() => {});
    } else if (res.board) {
      resetViewChrome();
      applyBoard(res.board, { selectLane: res.board.lanes[1]?.index ?? 0 });
    } else {
      resetViewChrome();
      state.board = null;
      paint();
    }
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
  // Rebuild this tab as an inline rename field (mock: .tab.renaming).
  const btn = el.tabstrip.querySelector(`.tab[data-id="${CSS.escape(tab.id)}"]`);
  if (!btn) return;
  let chosen = tab.icon || 'folder-simple';
  let saving = false;
  const wrap = document.createElement('div');
  wrap.className = 'tab renaming';
  wrap.setAttribute('aria-label', 'Renaming repository tab');
  wrap.dataset.id = tab.id;
  wrap.appendChild(icon(chosen, 'sm'));
  const input = document.createElement('input');
  input.value = tab.title;
  input.setAttribute('aria-label', 'Repository display name');
  wrap.appendChild(input);

  const pop = document.createElement('div');
  pop.className = 'rename-pop';
  const grid = document.createElement('div');
  grid.className = 'icon-grid inline';
  const paintIcons = () => {
    grid.replaceChildren();
    for (const name of TAB_ICONS) {
      const b = document.createElement('button');
      b.type = 'button';
      if (name === chosen) b.classList.add('on');
      b.appendChild(icon(name, 'sm'));
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on input
      b.addEventListener('click', () => {
        chosen = name;
        wrap.replaceChildren(icon(chosen, 'sm'), input);
        paintIcons();
        input.focus();
      });
      grid.appendChild(b);
    }
  };
  paintIcons();
  pop.appendChild(grid);
  document.body.appendChild(pop);
  const placePop = () => {
    const r = wrap.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.zIndex = '40';
  };

  const finish = async (commit) => {
    if (saving) return;
    saving = true;
    document.removeEventListener('mousedown', off);
    pop.remove();
    if (!commit) {
      paintTabs();
      return;
    }
    try {
      const iconArg = chosen !== (tab.icon || 'folder-simple') ? chosen : undefined;
      const store = await invoke('tabs.rename', tab.id, input.value, iconArg);
      applyStore(store);
    } catch { /* toasted */ }
    paintTabs();
  };
  const off = (ev) => {
    if (wrap.contains(ev.target) || pop.contains(ev.target)) return;
    finish(true);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  btn.replaceWith(wrap);
  placePop();
  input.focus();
  input.select();
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
    <div class="section-head" title="The checkout on the team branch. Plenum watches it and never works in it.">Protected</div>
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
        ? `<span class="meta ${l.behind >= 3 ? 'bad' : 'warn'}" title="${l.behind} commits behind ${esc(b.teamRef)}">${iconHTML('cloud-arrow-down', 'sm')}${l.behind} behind</span>`
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

  const allBranches = b.branches || [];
  const locals = allBranches.filter((br) => !br.remote);
  const remotes = allBranches.filter((br) => br.remote);
  const localBody = locals.length
    ? renderBranchListHTML(locals, b, selected)
    : `<div class="empty-note">None</div>`;
  const remoteBody = remotes.length
    ? renderBranchListHTML(remotes, b, selected)
    : `<div class="empty-note">None</div>`;
  html += `<div class="section section-branches">
    <button class="lane-row branch-toggle" type="button" data-branches aria-expanded="${state.branchesOpen}" title="Local tips — ↓↑ only when drifted from upstream (origin/…). Vs protected tip stays on the lane header.">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="name" style="color: var(--ink-subtle)">Branches</span>
      <span class="meta">${locals.length}</span>
    </button>
    <div class="branch-list"${state.branchesOpen ? '' : ' hidden'}>${localBody}</div>
  </div>`;
  html += `<div class="section section-branches">
    <button class="lane-row branch-toggle" type="button" data-remotes aria-expanded="${state.remotesOpen}" title="Remote-only tips on origin. Check out or open as lane when you need one.">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="name" style="color: var(--ink-subtle)">Remotes</span>
      <span class="meta">${remotes.length}</span>
    </button>
    <div class="branch-list"${state.remotesOpen ? '' : ' hidden'}>${remoteBody}</div>
  </div>`;

  const foot = `<div class="panel-foot">
    <button class="lane-row" type="button" data-settings>${iconHTML('gear-six')}<span class="name">Settings</span><kbd>⌘,</kbd></button>
    <button class="lane-row" type="button" data-feedback>${iconHTML('pencil-simple')}<span class="name">Feedback</span></button>
  </div>`;

  el.panel.innerHTML = `<div class="panel-scroll">${html}</div>${foot}`;
  el.panel.querySelector('[data-settings]')?.addEventListener('click', () => openSettings());
  el.panel.querySelector('[data-feedback]')?.addEventListener('click', () => openFeedbackSheet());
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
  el.panel.querySelector('[data-remotes]')?.addEventListener('click', () => {
    state.remotesOpen = !state.remotesOpen;
    paint();
  });
  el.panel.querySelectorAll('[data-branch-folder]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.branchFolder;
      if (state.collapsedBranchFolders.has(key)) state.collapsedBranchFolders.delete(key);
      else state.collapsedBranchFolders.add(key);
      paint();
    });
  });
  el.panel.querySelectorAll('[data-branch-name]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      checkoutBranchRow(btn.dataset.branchName);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBranchCtxMenu(e.clientX, e.clientY, btn.dataset.branchName);
    });
  });
}

function branchMetaHTML(br) {
  // Branch list: vs upstream only (pull/push). No “team” badge — protected tip is Settings / lane header.
  if (!br.upstream) return `<span class="metas"></span>`;
  const bits = [];
  if (br.upstreamBehind) bits.push(`${br.upstreamBehind}↓`);
  if (br.upstreamAhead) bits.push(`${br.upstreamAhead}↑`);
  if (!bits.length) return `<span class="metas"></span>`;
  const cls = br.upstreamBehind >= 3 ? 'bad' : br.upstreamBehind ? 'warn' : '';
  return `<span class="metas"><span class="meta ${cls}" title="vs ${esc(br.upstream)}">${esc(bits.join(' '))}</span></span>`;
}

function branchRowHTML(br, label, board, selectedLane) {
  const where = br.isPrimary
    ? 'primary'
    : br.hasLane
      ? 'lane'
      : br.remote
        ? 'remote-only'
        : 'local';
  const current = laneByIndex(selectedLane);
  const isCurrent = (br.hasLane && br.laneIndex === selectedLane)
    || (!br.hasLane && current && (current.branch === br.name || current.branch === br.short));
  const title = [
    br.name,
    isCurrent ? 'checked out here' : where,
    isCurrent ? '' : 'Click to check out in the selected worktree · right-click for more',
    br.upstream ? `tracks ${br.upstream}` : 'no upstream',
    br.upstreamBehind || br.upstreamAhead
      ? `vs ${br.upstream}: ${br.upstreamBehind || 0} behind, ${br.upstreamAhead || 0} ahead`
      : (br.upstream ? 'in sync with upstream' : ''),
  ].filter(Boolean).join(' · ');
  const mark = isCurrent
    ? iconHTML('check-circle', 'sm current')
    : iconHTML(br.remote ? 'cloud-arrow-down' : 'git-branch', 'sm');
  return `<button class="lane-row branch-row${isCurrent ? ' selected current' : ''}" type="button" title="${esc(title)}" data-branch-name="${esc(br.name)}" aria-current="${isCurrent ? 'true' : 'false'}">
    ${mark}
    <span class="name">${esc(label)}</span>
    ${branchMetaHTML(br)}
  </button>`;
}

function renderBranchListHTML(branches, board, selectedLane) {
  const { singles, folders } = groupBranchesByPrefix(branches);
  const entries = [
    ...singles.map((s) => ({ kind: 'single', sort: s.label, ...s })),
    ...[...folders.keys()].map((key) => ({ kind: 'folder', sort: key, key, items: folders.get(key) })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));
  const parts = [];
  for (const entry of entries) {
    if (entry.kind === 'single') {
      parts.push(branchRowHTML(entry.br, entry.label, board, selectedLane));
      continue;
    }
    const open = !state.collapsedBranchFolders.has(entry.key);
    parts.push(`<button class="lane-row branch-folder" type="button" data-branch-folder="${esc(entry.key)}" aria-expanded="${open}">
      <span class="mark">${iconHTML('caret-right', 'sm')}</span>
      <span class="name">${esc(entry.key)}/</span>
    </button>`);
    if (open) {
      parts.push(`<div class="branch-folder-kids">${entry.items.map(({ br, label }) => branchRowHTML(br, label, board, selectedLane)).join('')}</div>`);
    }
  }
  return parts.join('');
}

function gitActionsHTML(l) {
  const a = [];
  const stashes = state.board?.stashCount || 0;
  if (state.conflictRoot) a.push(`<button class="btn" type="button" data-act="conflicts" title="Resume conflict walk">${iconHTML('warning-circle', 'sm')}Resolve conflicts</button>`);
  if (l.isPrimary) {
    if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit on ${esc(l.name)}">${iconHTML('git-commit', 'sm')}Commit</button>`);
    if (l.dirty) a.push(`<button class="btn" type="button" data-act="stash" title="Stash uncommitted changes">${iconHTML('stack', 'sm')}Stash</button>`);
    if (stashes) a.push(`<button class="btn" type="button" data-act="stashPop" title="Pop latest stash">${iconHTML('stack', 'sm')}Pop latest stash${stashes > 1 ? ` · ${stashes}` : ''}</button>`);
    if (l.unpushed) a.push(`<button class="btn" type="button" data-act="push" title="Push ${esc(l.name)} to origin">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.unpushed}</span></button>`);
    a.push(`<button class="btn" type="button" data-act="pull" title="Pull ${esc(l.name)} (ff-only)">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
    return a.join('');
  }
  if (l.readiness === 'safe' && !state.conflictRoot && !stashes) return a.join('');
  if (l.dirty) a.push(`<button class="btn" type="button" data-act="commit" title="Commit in this lane">${iconHTML('git-commit', 'sm')}Commit</button>`);
  if (l.dirty) a.push(`<button class="btn" type="button" data-act="stash" title="Stash uncommitted changes">${iconHTML('stack', 'sm')}Stash</button>`);
  if (stashes) a.push(`<button class="btn" type="button" data-act="stashPop" title="Pop latest stash">${iconHTML('stack', 'sm')}Pop latest stash${stashes > 1 ? ` · ${stashes}` : ''}</button>`);
  if (l.readiness === 'safe' && !state.conflictRoot) return a.join('');
  if (l.behind) a.push(`<button class="btn" type="button" data-act="rebase" title="Rebase this lane onto a chosen tip (default ${esc(state.board.teamRef)})">${iconHTML('arrow-counter-clockwise', 'sm')}Rebase onto…</button>`);
  else if (l.ahead && !l.dirty) a.push(`<button class="btn" type="button" data-act="merge" title="Merge this lane into main">${iconHTML('git-merge', 'sm')}Merge into main</button>`);
  if (l.unpushed) a.push(`<button class="btn" type="button" data-act="push" title="Push (force-with-lease after rebase)">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.unpushed}</span></button>`);
  a.push(`<button class="btn" type="button" data-act="pull" title="Pull ff-only">${iconHTML('cloud-arrow-down', 'sm')}Pull</button>`);
  return a.join('');
}

const editorName = () => ({ cursor: 'Cursor', vscode: 'VS Code', zed: 'Zed' }[state.prefs.editor] || 'editor');

function editorBtnHTML() {
  const n = editorName();
  const ic = !state.prefs.editor || state.prefs.editor === 'cursor' ? 'cursor' : 'arrow-square-out';
  return `<button class="iconbtn framed primary" type="button" data-act="editor" title="Open in ${n}" aria-label="Open in ${n}">${iconHTML(ic)}</button>`;
}

function laneSetupLink() {
  return `<button class="env-link" type="button" data-act="doctor">${iconHTML('gear-six', 'sm')}Lane setup</button>`;
}

function runActionsHTML(l) {
  // Primary never runs the stack — keep lane setup in Settings, not a permanent banner (#27).
  if (l.isPrimary) return '';
  if (l.readiness === 'safe' && !l.running) {
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
    ? `<span class="badge data" title="Databases shared across lanes. Switch a service to snapshot in .plenum/lane.yaml for an isolated copy.">${iconHTML('database', 'sm')}shared data</span>`
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
        <div><h1>${esc(l.name)}</h1><div class="path">Checked out · ${esc(l.displayPath || l.path)} · primary</div></div>
      </div>
      <div class="facts">
        ${dirty
          ? `<span class="fact bad">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>`
          : `<span class="fact">${iconHTML('shield-check', 'sm')}<strong>${l.onTeamBranch ? 'on' : 'not on'}</strong> ${esc(b.teamBranch)}</span>
             <span class="fact">${iconHTML('circle-dashed', 'sm')}<strong>clean</strong></span>`}
        ${l.ahead ? `<span class="fact bad">${iconHTML('git-commit', 'sm')}<strong>${l.ahead}</strong> ahead of ${esc(b.teamRef)}</span>` : ''}
        ${authorshipPillHTML(l.authorship, l.tool, iconHTML)}
      </div>
      <div class="actions">
        ${gitActionsHTML(l)}
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        ${editorBtnHTML()}
      </div>
    </div>`;
    const primaryEnv = runActionsHTML(l);
    if (primaryEnv) html += `<div class="env-row">${primaryEnv}</div>`;
  } else {
    const behind = l.readiness === 'safe'
      ? `<span class="fact ok">${iconHTML('check-circle', 'sm')}<strong>merged</strong> into ${esc(b.teamBranch)}</span>`
      : l.behind > 0
        ? `<span class="fact ${l.behind >= 5 ? 'bad' : 'warn'}">${iconHTML('cloud-arrow-down', 'sm')}<strong>${l.behind} behind</strong> ${esc(b.teamBranch)}${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`
        : `<span class="fact">${iconHTML('cloud-arrow-down', 'sm')}<strong>up to date</strong>${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`;
    const dirty = l.dirty
      ? `<span class="fact warn">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>`
      : '';
    const pill = authorshipPillHTML(l.authorship, l.tool, iconHTML);
    const remove = l.readiness === 'safe'
      ? `<button class="btn ghost-danger" type="button" data-act="remove">${iconHTML('x', 'sm')}Remove lane</button>`
      : '';
    html = `<div class="head-row">
      <div class="title">
        ${iconHTML('tree-structure')}
        <div><h1>${esc(l.name)}</h1><div class="path">Checked out · ${esc(l.folder || l.displayPath || l.path)}</div></div>
      </div>
      <div class="facts">${behind}${dirty}${pill}</div>
      <div class="actions">
        ${remove}${gitActionsHTML(l)}
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        ${editorBtnHTML()}
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
    if (act === 'editor') return invoke('os.openEditor', lane.path);
    if (act === 'openUrl') return invoke('os.openExternal', url);
    if (act === 'commit') return openCommitSheet(lane);
    if (act === 'push') {
      return runGit('lane.push', lane.index, `Pushed ${lane.name} to origin`, 'push');
    }
    if (act === 'pull') {
      return runGit('lane.pull', lane.index, `Pulled ${lane.name} from origin`, 'pull');
    }
    if (act === 'rebase') {
      return openRebaseOntoSheet(lane);
    }
    if (act === 'merge') return openMergeSheet(lane);
    if (act === 'remove') return openRemoveSheet(lane);
    if (act === 'doctor') return openLaneSetup();
    if (act === 'conflicts') return openConflictSheet(lane);
    if (act === 'stash') {
      return runGit('lane.stash', lane.index, `Stashed uncommitted changes on ${lane.name}`, 'stash');
    }
    if (act === 'stashPop') {
      return openStashPopSheet(lane);
    }
    if (act === 'up') {
      return runUp(lane);
    }
    if (act === 'down') {
      return runGit('lane.down', lane.index, `Stopped ${lane.name}`, 'down');
    }
    if (act === 'test') {
      const tabId = beginOp('test');
      if (!tabId) return;
      const root = state.board?.root;
      try {
        const board = await invoke('lane.test', ...pin(lane.index));
        if (settleBoard(tabId, root, board)) {
          state.flashMarks.add(lane.index);
          const ok = board?.lanes?.find((x) => x.index === lane.index)?.lastTest?.ok;
          toast(ok ? `Tests passed for ${lane.name}` : `Tests failed for ${lane.name}`, ok ? 'ok' : 'bad');
        }
      } finally {
        endOp(tabId, 'test');
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
  const tabId = beginOp(act);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await invoke(channel, ...pin(laneIndex));
    if (settleBoard(tabId, root, board)) {
      state.flashMarks.add(laneIndex);
      toast(okMsg, 'ok');
    }
  } finally {
    endOp(tabId, act);
  }
}

async function runUp(lane, { force = false } = {}) {
  const tabId = beginOp('up');
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const res = await invoke('lane.up', ...pin(lane.index, force ? { force: true } : undefined));
    if (res?.drift) {
      if (state.store.activeId === tabId) openDriftSheet(lane, res.pending || []);
      return;
    }
    if (settleBoard(tabId, root, res)) {
      state.flashMarks.add(lane.index);
      toast(`Started ${lane.name}`, 'ok');
    }
  } finally {
    endOp(tabId, 'up');
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
          <div class="name">Switch service to snapshot<small>Open Lane setup to set <span class="mono">mode: snapshot</span> plus a <span class="mono">snapshot:</span> command in <span class="mono">.plenum/lane.yaml</span>. Next Run seeds that copy on the offset ports.</small></div>
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
      openLaneSetup();
      return;
    }
    if (choice === 'force') await runUp(lane, { force: true });
  });
}

async function runConflictable(channel, lane, extra, act, okMsg) {
  const tabId = beginOp(act);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const res = await invoke(channel, ...pin(lane.index, extra));
    if (res?.conflict) {
      if (state.store.activeId === tabId) {
        state.conflictRoot = res.conflictRoot || null;
        openConflictSheet(lane, res);
      }
      return;
    }
    if (settleBoard(tabId, root, res)) {
      state.flashMarks.add(lane.index);
      const team = state.board?.teamBranch || 'main';
      toast(okMsg || (channel.includes('rebase')
        ? `Rebased ${lane.name} onto ${team}`
        : `Merged ${lane.name} into ${team}`), 'ok');
    }
  } finally {
    endOp(tabId, act);
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

function openQuickStartSheet() {
  const rows = [
    ['git-branch', 'Plenum, not a normal client', 'Git underneath, plain repo. The board shows every worktree against the team at once, with the verbs per lane.'],
    ['tree-structure', 'Lane', 'A git worktree on its own branch. Several features in progress, side by side.'],
    ['shield-check', 'Protected main', 'The checkout on the team branch. Plenum watches it and never works in it.'],
    ['cloud-arrow-down', 'Behind', 'Commits the team branch has that this lane does not.'],
    ['sparkle', 'Authorship', 'Who wrote the newest commit, read from the author and agent trailers. Human gets no pill.'],
    ['play', 'Runnable lanes', 'Phase two: a lane starts on its own ports from .plenum/lane.yaml. Without that file it still shows on the board.'],
    ['pencil-simple', 'Feedback', '⌘K → Feedback…, or the row under Settings. Point at UI optional; saved on this Mac.'],
  ].map(([i, t, d]) => `<div class="list-row compact">${iconHTML(i)}<div class="name">${t}<small>${d}</small></div></div>`).join('');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="qs-title">
      <h1 id="qs-title">Quick start: what are lanes?</h1>
      <div class="list">${rows}</div>
      <div class="row-end"><button class="btn primary" type="button" data-close>Done</button></div>
    </form>`);
}

const WARM_PRESETS = [[30000, '30 seconds'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes']];

function openWarmSheet() {
  const cur = state.prefs.warmTabTtlMs || state.warmTtlMs;
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="warm-title">
      <h1 id="warm-title">Tab warm time</h1>
      <p>How long a tab you left keeps refreshing in the background. Coming back inside that time shows the board at once.</p>
      <div class="list">
        ${WARM_PRESETS.map(([ms, t]) => `<label class="list-row compact choice"><input type="radio" name="ttl" value="${ms}"${ms === cur ? ' checked' : ''} /><div class="name">${t}</div></label>`).join('')}
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ms = Number(el.sheetLayer.querySelector('input[name=ttl]:checked')?.value);
    closeSheet();
    try { await setPref({ warmTabTtlMs: ms }); } catch { /* toasted */ }
  });
}

let feedbackDraft = { comment: '', target: null };

function stopFeedbackPick() {
  document.getElementById('feedback-pick-layer')?.remove();
}

function feedbackPickLabel(node) {
  const aria = node.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, 40);
  const title = node.getAttribute('title')?.trim();
  if (title) return title.slice(0, 40);
  const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 40 ? text.slice(0, 40) : text;
  return node.tagName.toLowerCase();
}

function startFeedbackPick() {
  stopFeedbackPick();
  const layer = document.createElement('div');
  layer.id = 'feedback-pick-layer';
  layer.setAttribute('data-feedback-ignore', '');
  const box = document.createElement('div');
  box.className = 'feedback-pick-box';
  layer.appendChild(box);
  (document.querySelector('.window.app') || document.body).appendChild(layer);

  const hitAt = (x, y) => {
    layer.style.pointerEvents = 'none';
    let n = document.elementFromPoint(x, y);
    layer.style.pointerEvents = '';
    while (n && n.closest?.('[data-feedback-ignore]')) {
      n = n.closest('[data-feedback-ignore]').parentElement;
    }
    return n && n !== document.documentElement && n !== document.body ? n : null;
  };

  const placeBox = (node) => {
    if (!node) {
      box.style.display = 'none';
      return;
    }
    const r = node.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.x}px`;
    box.style.top = `${r.y}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  };

  layer.addEventListener('mousemove', (e) => placeBox(hitAt(e.clientX, e.clientY)));
  layer.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = hitAt(e.clientX, e.clientY);
    stopFeedbackPick();
    if (!node) {
      openFeedbackSheet({ comment: feedbackDraft.comment, target: feedbackDraft.target });
      return;
    }
    const r = node.getBoundingClientRect();
    openFeedbackSheet({
      comment: feedbackDraft.comment,
      target: { label: feedbackPickLabel(node), rect: { x: r.x, y: r.y, w: r.width, h: r.height } },
    });
  });
}

function openFeedbackSheet(seed = {}) {
  const target = seed.target || null;
  const comment = seed.comment ?? '';
  const chip = target?.label
    ? `<span class="feedback-target-chip">${esc(target.label)}</span>`
    : `<span class="feedback-target-chip muted">No element selected</span>`;
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="feedback-title" data-feedback-ignore>
      <div class="eyebrow">${iconHTML('pencil-simple', 'sm')}Feedback</div>
      <h1 id="feedback-title">What’s not working?</h1>
      <label class="field">Comment<textarea name="comment" rows="4" required autofocus placeholder="What went wrong or felt off?">${esc(comment)}</textarea></label>
      <div class="field">
        <span>Target</span>
        <div class="feedback-target-row">
          ${chip}
          <button class="btn" type="button" data-pick>Point at something</button>
          ${target ? '<button class="btn" type="button" data-clear-target>Clear</button>' : ''}
        </div>
      </div>
      <p class="feedback-warn">${iconHTML('warning-circle', 'sm')}<span>A full-window screenshot of what is visible right now will be saved on this Mac. Nothing is uploaded.</span></p>
      <div class="row-end">
        <span class="hint-text">⌘↩</span>
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">Send feedback</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const ta = form.querySelector('[name=comment]');
  const send = async () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    const draft = { comment: text, target };
    closeSheet();
    stopFeedbackPick();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const { dir } = await invoke('feedback.save', { comment: text, target });
      const pretty = await prettyPath(dir).catch(() => dir);
      toast(`Feedback saved locally · ${pretty}`, 'ok');
    } catch (e) {
      toast(e.message || 'Could not save feedback', 'bad');
      openFeedbackSheet(draft);
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  bindCommitChord(ta, send);
  form.querySelector('[data-pick]')?.addEventListener('click', () => {
    feedbackDraft = { comment: ta.value, target };
    closeSheet();
    startFeedbackPick();
  });
  form.querySelector('[data-clear-target]')?.addEventListener('click', () => {
    openFeedbackSheet({ comment: ta.value, target: null });
  });
  ta.focus();
  if (comment) ta.setSelectionRange(comment.length, comment.length);
}



async function openStashPopSheet(lane) {
  const list = state.board?.stashes?.length
    ? state.board.stashes
    : Array.from({ length: state.board?.stashCount || 0 }, (_, i) => ({ ref: `stash@{${i}}`, age: '', subject: '' }));
  if (!list.length) {
    toast('No stash to pop', 'bad');
    return;
  }
  let selected = list[0].ref;
  const renderFiles = (files) => files.length
    ? `<ul class="stash-files">${files.map((f) => `<li><span class="mono">${esc(f.code)}</span> ${esc(f.path)}</li>`).join('')}</ul>`
    : '<p class="lede">No file list for this stash.</p>';
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="stash-pop-title">
      <div class="eyebrow">${iconHTML('stack', 'sm')}Pop stash</div>
      <h1 id="stash-pop-title">Choose a stash for ${esc(lane.name)}</h1>
      <p>Plenum pops the selected entry onto this lane. Latest is selected by default.</p>
      <div class="list" data-stash-list>
        ${list.map((s, i) => `
          <label class="list-row compact choice">
            <input type="radio" name="stash" value="${esc(s.ref)}"${i === 0 ? ' checked' : ''} />
            <div class="name"><span class="mono">${esc(s.ref)}</span>${s.age ? ` · ${esc(s.age)}` : ''}<small>${esc(s.subject || '')}</small></div>
          </label>`).join('')}
      </div>
      <div class="group-head">Files in stash</div>
      <div data-stash-files><p class="lede">Loading…</p></div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('stack', 'sm')}Pop selected</button>
      </div>
    </form>`);
  const modal = el.sheetLayer.querySelector('.modal');
  const filesEl = modal.querySelector('[data-stash-files]');
  const loadPreview = async (ref) => {
    filesEl.innerHTML = '<p class="lede">Loading…</p>';
    try {
      const data = await invoke('lane.stashShow', ...pin(ref));
      filesEl.innerHTML = renderFiles(data.files || []);
    } catch (e) {
      filesEl.innerHTML = `<p class="lede">${esc(e.message || 'Could not load stash')}</p>`;
    }
  };
  loadPreview(selected);
  modal.querySelectorAll('input[name=stash]').forEach((input) => {
    input.addEventListener('change', () => {
      selected = input.value;
      loadPreview(selected);
    });
  });
  modal.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      const board = await invoke('lane.stashPop', ...pin(lane.index, selected));
      closeSheet();
      if (settleBoard(tabId, root, board)) toast(`Popped ${selected} onto ${lane.name}`, 'ok');
    } catch { /* toasted */ }
  });
}

function branchByName(name) {
  return (state.board?.branches || []).find((b) => b.name === name || b.short === name);
}

function dismissCtxMenus() {
  document.querySelector('.ctx-menu')?.remove();
}

async function updateBranchRow(name) {
  const br = branchByName(name);
  if (!br) return;
  const tabId = beginOp('branch-update', br.short || br.name);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await invoke('branch.update', ...pin({ branch: br.name }));
    if (settleBoard(tabId, root, board)) {
      toast(br.remote ? `Fetched ${br.name}` : `Updated ${br.short || br.name} from origin`, 'ok');
    }
  } catch { /* toasted */ }
  finally { endOp(tabId, 'branch-update'); }
}

async function checkoutBranchRow(name) {
  const br = branchByName(name);
  if (!br) return;
  // Already checked out somewhere → select that worktree (no second checkout).
  if (br.hasLane) {
    state.selectedLane = br.laneIndex;
    paint();
    const holder = laneByIndex(br.laneIndex);
    toast(holder?.isPrimary ? `Selected primary (${br.short || br.name})` : `Selected lane ${holder?.name || br.short || br.name}`, 'ok');
    return;
  }
  let lane = laneByIndex(state.selectedLane) || state.board?.lanes?.[0];
  if (!lane) return;
  // Primary stays on the protected tip — feature tips check out in a lane (#23).
  const team = state.board?.teamBranch;
  const isTeam = br.isTeam || br.short === team || br.name === team;
  if (lane.isPrimary && !isTeam) {
    const alt = (state.board?.lanes || []).find((l) => !l.isPrimary);
    if (alt) {
      lane = alt;
      state.selectedLane = alt.index;
    } else {
      toast('Opening as a lane — primary stays protected', 'ok');
      return openLaneFromBranch(br.name);
    }
  }
  const tabId = beginOp('checkout', br.short || br.name);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await invoke('branch.checkout', ...pin({ branch: br.name, laneIndex: lane.index }));
    if (settleBoard(tabId, root, board, { selectLane: lane.index })) {
      toast(`Checked out ${br.short || br.name}${lane.isPrimary ? '' : ` in ${lane.name}`}`, 'ok');
    }
  } catch { /* toasted */ }
  finally { endOp(tabId, 'checkout'); }
}

function openBranchCtxMenu(x, y, name) {
  const br = branchByName(name);
  if (!br) return;
  const lane = laneByIndex(state.selectedLane);
  const canRename = !br.remote && !br.isTeam && !br.isPrimary;
  const canDelete = !br.isTeam && !br.isPrimary && !(br.hasLane && br.laneIndex === 0);
  dismissCtxMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const add = (label, run, danger = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (danger) btn.className = 'danger';
    btn.addEventListener('click', () => {
      menu.remove();
      run();
    });
    menu.appendChild(btn);
  };
  add('Check out', () => checkoutBranchRow(br.name));
  if (!br.hasLane) {
    add(br.remote ? 'Fetch tip' : 'Update from remote', () => updateBranchRow(br.name));
  }
  if (!br.hasLane && !br.isTeam) add('Open as lane', () => openLaneFromBranch(br.name));
  if (canRename) add('Rename…', () => openRenameBranchSheet(br));
  if (canDelete) add('Delete…', () => openDeleteBranchSheet(br), true);
  if (lane && !lane.isPrimary) {
    add(`Rebase ${lane.name} onto this`, () => runConflictable('lane.rebase', lane, br.name, 'rebase',
      `Rebased ${lane.name} onto ${br.name}`));
  }
  document.body.appendChild(menu);
  const off = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('mousedown', off);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function openRenameBranchSheet(br) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="rename-br-title">
      <div class="eyebrow">${iconHTML('git-branch', 'sm')}Rename branch</div>
      <h1 id="rename-br-title">${esc(br.name)}</h1>
      <label class="field">New name<input name="to" class="input mono" value="${esc(br.name)}" required autofocus /></label>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">Rename</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = form.querySelector('[name=to]').value.trim();
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      const board = await invoke('branch.rename', ...pin(br.name, to));
      closeSheet();
      if (settleBoard(tabId, root, board)) toast(`Renamed ${br.name} → ${to}`, 'ok');
    } catch { /* toasted */ }
  });
}

function openDeleteBranchSheet(br) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="del-br-title">
      <div class="eyebrow warn">${iconHTML('warning-circle', 'sm')}Delete branch</div>
      <h1 id="del-br-title">${esc(br.name)}</h1>
      <p>Removes the ${br.remote ? 'remote' : 'local'} ref. Checked-out branches and the team branch stay blocked.</p>
      ${!br.remote ? `<label class="check"><input type="checkbox" name="force" /> Force delete even if not merged</label>` : ''}
      ${!br.remote && br.hasRemote ? `<label class="check"><input type="checkbox" name="remote" /> Also delete origin/${esc(br.short || br.name)}</label>` : ''}
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit">Delete</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const force = Boolean(form.querySelector('[name=force]')?.checked);
    const alsoRemote = Boolean(form.querySelector('[name=remote]')?.checked);
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      let board = await invoke('branch.delete', ...pin(br.name, { force, remote: br.remote }));
      if (alsoRemote && !br.remote) {
        board = await invoke('branch.delete', ...pin(`origin/${br.short || br.name}`, { remote: true }));
      }
      closeSheet();
      if (settleBoard(tabId, root, board)) toast(`Deleted ${br.name}`, 'ok');
    } catch { /* toasted */ }
  });
}

function openRebaseOntoSheet(lane) {
  const team = state.board?.teamRef || 'main';
  const opts = (state.board?.branches || [])
    .filter((br) => !br.remote || true)
    .map((br) => `<option value="${esc(br.name)}"${br.name === team || br.isTeam ? ' selected' : ''}>${esc(br.name)}${br.isTeam ? ' (team)' : ''}</option>`)
    .join('');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="rebase-onto-title">
      <div class="eyebrow">${iconHTML('arrow-counter-clockwise', 'sm')}Rebase onto…</div>
      <h1 id="rebase-onto-title">${esc(lane.name)}</h1>
      <p>Default is the team tip. Pick any local or remote tip as the new base.</p>
      <label class="field">Onto<select name="onto" class="input">${opts}</select></label>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">Rebase</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const onto = form.querySelector('[name=onto]').value;
    closeSheet();
    await runConflictable('lane.rebase', lane, onto, 'rebase', `Rebased ${lane.name} onto ${onto}`);
  });
}

async function openLaneFromBranch(branch) {
  const name = String(branch || '').trim();
  if (!name) return;
  const tabId = state.store.activeId;
  const root = state.board?.root;
  try {
    const board = await invoke('lane.create', ...pin({ existing: true, branch: name }));
    const created = board.lanes.find((l) => l.branch === name) || board.lanes[board.lanes.length - 1];
    if (settleBoard(tabId, root, board, { selectLane: created?.index, enterLane: created?.index })) {
      toast(`Lane ${created?.name || name} opened`, 'ok');
      if (created && state.prefs.openLaneInEditor !== false) invoke('os.openEditor', created.path).catch(() => {});
    }
  } catch { /* toasted */ }
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
      <p class="lede" style="margin:0">Already have a branch? Click it to check out, or right-click → <strong>Open as lane</strong>.</p>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('arrow-square-out', 'sm')}${state.prefs.openLaneInEditor === false ? 'Create' : `Create and open in ${editorName()}`}</button>
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
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      const board = await invoke('lane.create', ...pin({ name, branch }));
      const created = board.lanes.find((l) => l.branch === branch || l.name.includes(name))
        || board.lanes[board.lanes.length - 1];
      closeSheet();
      if (settleBoard(tabId, root, board, { selectLane: created?.index, enterLane: created?.index })) {
        toast(`Lane ${created?.name || name} created`, 'ok');
        if (created && state.prefs.openLaneInEditor !== false) invoke('os.openEditor', created.path).catch(() => {});
      }
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
        <div>One lane at a time. Plenum never removes a lane with uncommitted work or unmerged commits.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit">${iconHTML('x', 'sm')}Remove folder</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      const board = await invoke('lane.remove', ...pin(lane.index));
      closeSheet();
      if (settleBoard(tabId, root, board, { selectLane: 0 })) {
        toast(`Removed worktree for ${lane.name}`, 'ok');
      }
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

function sumStats(files) {
  let added = 0;
  let deleted = 0;
  for (const f of files || []) {
    added += Number(f.added) || 0;
    deleted += Number(f.deleted) || 0;
  }
  return { added, deleted };
}

function formatStat(f) {
  const a = Number(f.added) || 0;
  const d = Number(f.deleted) || 0;
  if (!a && !d) return '';
  const fmt = (n) => n.toLocaleString('en-US');
  return `<span class="stat">${a ? `<span class="add">+${fmt(a)}</span>` : ''}${d ? `<span class="del">−${fmt(d)}</span>` : ''}</span>`;
}

function sumTreeStats(node) {
  let added = 0;
  let deleted = 0;
  for (const f of node.files) {
    added += Number(f.added) || 0;
    deleted += Number(f.deleted) || 0;
  }
  for (const child of node.dirs.values()) {
    const s = sumTreeStats(child);
    added += s.added;
    deleted += s.deleted;
  }
  return { added, deleted };
}

function renderDirtyTree(node, depth = 0, prefix = '') {
  const pad = `padding-left:${6 + depth * 12}px`;
  let html = '';
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = prefix ? `${prefix}/${name}` : name;
    const collapsed = state.collapsedDirs.has(key);
    html += `<button class="fx-folder${collapsed ? ' collapsed' : ''}" type="button" style="${pad}" data-dir="${esc(key)}">
      ${iconHTML('caret-down', 'sm caret')}${iconHTML('folder-simple', 'sm')}<span class="name">${esc(name)}</span>${collapsed ? formatStat(sumTreeStats(child)) : ''}
    </button>`;
    if (!collapsed) html += renderDirtyTree(child, depth + 1, key);
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    const kind = dirtyKind(f.code);
    const on = state.filePane?.path === f.path ? ' on' : '';
    html += `<button class="fx-file${on}" type="button" style="${pad}" data-file="${esc(f.path)}" title="${esc(f.path)}"${on ? ' aria-current="true"' : ''}>
      ${iconHTML('files', 'sm')}<span class="name">${esc(f.name)}</span>${formatStat(f)}<span class="mark ${kind}">${dirtyMark(f.code)}</span>
    </button>`;
  }
  return html;
}

function changesKey(view) {
  if (!view) return '';
  const fold = [...state.collapsedDirs].join(',');
  const pane = state.filePane;
  const paneKey = pane ? `${pane.sha}:${pane.path}` : '';
  if (view.kind === 'wip') {
    const lane = laneByIndex(view.laneIndex);
    const files = lane?.dirtyFiles || [];
    return `wip:${view.laneIndex}:${files.map((f) => `${f.path}:${f.code}:${f.added}:${f.deleted}`).join(';')}:${fold}:${paneKey}`;
  }
  return `c:${view.sha}:${fold}:${paneKey}`;
}

function clearFileStage() {
  state.filePane = null;
  el.fileStage.hidden = true;
  el.fileStage.innerHTML = '';
  el.body.classList.remove('with-file-pane');
}

function activeFilePane() {
  const view = state.changes;
  const pane = state.filePane;
  if (!view || !pane) return null;
  if (view.kind === 'commit' && pane.sha === view.sha) return pane;
  if (view.kind === 'wip' && pane.sha === 'WORKTREE') return pane;
  return null;
}

function closeChanges() {
  state.changes = null;
  state.changesPaintKey = '';
  state.changesCache = null;
  el.changes.hidden = true;
  el.changes.innerHTML = '';
  el.body.classList.remove('with-changes');
  clearFileStage();
}

function jumpToCommitOnGraph(sha) {
  if (!sha) return;
  const hit = state.board?.commits?.find((c) => c.id === sha || c.id.startsWith(sha));
  if (hit) state.selectedLane = hit.lane;
  clearFileStage();
  state.changes = { kind: 'commit', sha: hit?.id || sha };
  state.changesPaintKey = '';
  paint();
  requestAnimationFrame(() => {
    el.graph.querySelector('.active-commit')?.scrollIntoView({ block: 'nearest' });
  });
}

function bindFilePaneChrome() {
  el.fileStage.querySelector('[data-file-pane-back]')?.addEventListener('click', () => {
    clearFileStage();
    state.changesPaintKey = '';
    paintChanges();
  });
  el.fileStage.querySelectorAll('[data-file-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.fileMode;
      if (!mode || mode === state.filePane?.mode) return;
      state.filePane = { ...state.filePane, mode };
      paintFilePane(state.filePane);
    });
  });
  // Editor button also bound in paintFilePane when present
}

function bindFilePaneJumps() {
  el.fileStage.querySelectorAll('[data-jump-sha]').forEach((node) => {
    const go = () => jumpToCommitOnGraph(node.dataset.jumpSha);
    node.addEventListener('click', go);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

function filePaneStill(pane) {
  return state.filePane?.sha === pane.sha
    && state.filePane?.path === pane.path
    && state.filePane?.mode === pane.mode
    && state.filePane?.cwd === pane.cwd;
}

async function paintFilePane(pane) {
  const wip = pane.sha === 'WORKTREE';
  const mode = wip
    ? (pane.mode === 'read' ? 'read' : 'diff')
    : (pane.mode === 'blame' || pane.mode === 'history' ? pane.mode : 'diff');
  const title = mode === 'blame' ? 'Blame' : mode === 'history' ? 'History' : mode === 'read' ? 'File' : 'Diff View';
  const modeBtn = (id, label) =>
    `<button type="button" class="file-mode-btn${mode === id ? ' on' : ''}" data-file-mode="${id}" aria-pressed="${mode === id ? 'true' : 'false'}">${label}</button>`;
  const modes = wip
    ? `${modeBtn('diff', 'Diff')}${modeBtn('read', 'Read')}`
    : `${modeBtn('diff', 'Diff')}${modeBtn('blame', 'Blame')}${modeBtn('history', 'History')}`;
  const openPath = pane.cwd ? `${pane.cwd}/${pane.path}` : pane.path;
  el.body.classList.add('with-file-pane');
  el.fileStage.hidden = false;
  el.fileStage.innerHTML = `
    <div class="changes-head file-pane-head">
      <button class="iconbtn file-pane-back" type="button" data-file-pane-back title="Back to graph" aria-label="Back to graph">${iconHTML('caret-right')}</button>
      <div class="title">${title}<small>${esc(pane.path)}</small></div>
      <div class="file-pane-modes" role="group" aria-label="File view mode">
        ${modes}
      </div>
      <button class="btn" type="button" data-open-external title="Open in ${esc(editorName())}">${iconHTML('arrow-square-out', 'sm')}Editor</button>
    </div>
    <div class="file-pane-body" role="region" aria-label="${esc(title)}"><div class="fx-empty">Loading…</div></div>`;
  bindFilePaneChrome();
  el.fileStage.querySelector('[data-open-external]')?.addEventListener('click', () => {
    invoke('os.openEditor', openPath).catch(() => {});
  });
  const body = el.fileStage.querySelector('.file-pane-body');
  try {
    if (wip && mode === 'diff') {
      const data = await invoke('file.workingDiff', ...pin(pane.path, pane.cwd));
      if (!filePaneStill(pane) || !body) return;
      if (data.binary || data.tooLarge) {
        body.innerHTML = `<div class="fx-empty">${data.binary ? 'Binary file' : 'File too large'} — use Editor.</div>`;
      } else if (data.empty && !data.hunks?.length) {
        body.innerHTML = '<div class="fx-empty">No textual changes vs HEAD</div>';
      } else {
        body.innerHTML = `<div class="file-pane-diff">${renderDiffBody(data.hunks)}</div>`;
      }
    } else if (wip && mode === 'read') {
      const shown = await invoke('file.workingShow', ...pin(pane.path, pane.cwd));
      if (!filePaneStill(pane) || !body) return;
      if (shown.binary || shown.tooLarge || shown.missing) {
        body.innerHTML = `<div class="fx-empty">${shown.missing ? 'Missing on disk' : shown.binary ? 'Binary file' : 'File too large'} — use Editor.</div>`;
      } else {
        body.innerHTML = `<pre class="file-read mono">${esc(shown.text)}</pre>`;
      }
    } else if (mode === 'diff') {
      const data = await invoke('file.diff', ...pin(pane.sha, pane.path));
      if (!filePaneStill(pane) || !body) return;
      body.innerHTML = `<div class="file-pane-diff">${renderDiffBody(data.hunks)}</div>`;
    } else if (mode === 'history') {
      const history = await invoke('file.history', ...pin(pane.path));
      if (!filePaneStill(pane) || !body) return;
      body.innerHTML = `<div class="file-history">${renderHistoryList(history, pane.sha)}</div>`;
      bindFilePaneJumps();
    } else {
      const [history, blame, shown] = await Promise.all([
        invoke('file.history', ...pin(pane.path)),
        invoke('file.blame', ...pin(pane.sha, pane.path)),
        invoke('file.show', ...pin(pane.sha, pane.path)),
      ]);
      if (!filePaneStill(pane) || !body) return;
      body.innerHTML = `
        <div class="file-pane-split">
          <div class="file-history">${renderHistoryList(history, pane.sha)}</div>
          ${renderBlameBody(shown.text, blame.blocks)}
        </div>`;
      bindFilePaneJumps();
    }
  } catch {
    if (filePaneStill(pane) && body) {
      body.innerHTML = `<div class="fx-empty">Could not load ${esc(title.toLowerCase())}</div>`;
    }
  }
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
  const tabId = state.store.activeId;
  const root = state.board?.root;
  const board = await invoke('lane.commit', ...pin(lane.index, msg));
  if (!settleBoard(tabId, root, board)) return true;
  state.flashMarks.add(lane.index);
  state.commitDraft = '';
  if (state.changes?.kind === 'wip') closeChanges();
  toast(`Committed on ${lane.name}`, 'ok');
  return true;
}

function bindChangesTree(basePath, { onFile } = {}) {
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
    btn.addEventListener('click', () => {
      const filePath = btn.dataset.file;
      if (onFile) onFile(filePath);
      else invoke('os.openEditor', `${basePath}/${filePath}`);
    });
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
  if (!activeFilePane()) clearFileStage();

  if (view.kind === 'wip') {
    const lane = laneByIndex(view.laneIndex);
    if (!lane?.dirty) {
      closeChanges();
      return;
    }
    const files = lane.dirtyFiles || [];
    const tree = nestDirty(files);
    const totals = sumStats(files);
    const fileLabel = `${files.length} file${files.length === 1 ? '' : 's'}`;
    el.changes.innerHTML = `
      <div class="changes-head">
        <div class="title">Uncommitted<small>${esc(lane.name)} · ${fileLabel}</small></div>
        ${formatStat(totals)}
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
    bindChangesTree(lane.path, {
      onFile: (filePath) => {
        state.filePane = { sha: 'WORKTREE', cwd: lane.path, path: filePath, mode: 'diff' };
        paintChanges();
      },
    });
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
    const pane = activeFilePane();
    if (pane) await paintFilePane(pane);
    else clearFileStage();
    return;
  }

  if (view.kind === 'commit') {
    const token = view.sha;
    const renderCommit = (data) => {
      const files = data.files || [];
      const tree = nestDirty(files);
      const totals = sumStats(files);
      const fileLabel = `${files.length} file${files.length === 1 ? '' : 's'}`;
      const rootPath = state.board?.root || '';
      el.changes.innerHTML = `
        <div class="changes-head">
          <div class="title">${esc(data.subject || 'Commit')}<small>${esc(data.short)} · ${fileLabel} · ${esc(data.author || '')}${data.authoredAtUtc ? ` · ${esc(data.authoredAtUtc)}` : ''}</small></div>
          ${formatStat(totals)}
          <button class="iconbtn" type="button" data-close-changes title="Close" aria-label="Close">${iconHTML('x')}</button>
        </div>
        <div class="changes-tree" role="tree">
          ${files.length ? renderDirtyTree(tree) : '<div class="fx-empty">No file changes</div>'}
        </div>`;
      bindChangesTree(rootPath, {
        onFile: (filePath) => {
          state.filePane = { sha: token, path: filePath, mode: 'diff' };
          paintChanges();
        },
      });
    };
    if (state.changesCache?.sha === token) {
      renderCommit(state.changesCache.data);
      const pane = activeFilePane();
      if (pane) await paintFilePane(pane);
      else clearFileStage();
      return;
    }
    el.changes.innerHTML = `
      <div class="changes-head">
        <div class="title">Commit<small>Loading…</small></div>
        <button class="iconbtn" type="button" data-close-changes title="Close" aria-label="Close">${iconHTML('x')}</button>
      </div>
      <div class="changes-tree"><div class="fx-empty">Loading changes…</div></div>`;
    el.changes.querySelector('[data-close-changes]')?.addEventListener('click', () => { closeChanges(); paint(); });
    const tabId = state.store.activeId;
    try {
      const data = await invoke('commit.changes', ...pin(token));
      if (state.store.activeId !== tabId) return;
      if (state.changes?.kind !== 'commit' || state.changes.sha !== token) return;
      state.changesCache = { sha: token, data };
      // Key may match before render finished; force tree paint after load.
      state.changesPaintKey = '';
      renderCommit(data);
      state.changesPaintKey = changesKey(state.changes);
      const pane = activeFilePane();
      if (pane) await paintFilePane(pane);
      else clearFileStage();
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
  const tabId = state.store.activeId;
  const root = state.board?.root;
  if (!status?.conflicts && status?.operation == null) {
    status = await invoke('lane.conflicts', ...pin(lane.index, rootArg));
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
      invoke('os.openEditor', `${work}/${file}`);
    });
  });
  modal.querySelectorAll('[data-stage-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const file = btn.closest('[data-file]').dataset.file;
      try {
        const next = await invoke('lane.conflictStage', ...pin(lane.index, file, croot));
        openConflictSheet(lane, next);
      } catch { /* toasted */ }
    });
  });
  modal.querySelector('[data-continue]')?.addEventListener('click', async () => {
    try {
      const res = await invoke('lane.conflictContinue', ...pin(lane.index, croot));
      if (res?.conflict) {
        openConflictSheet(lane, res);
        return;
      }
      state.conflictRoot = null;
      closeSheet();
      if (settleBoard(tabId, root, res)) toast('Conflicts resolved — continued', 'ok');
    } catch { /* toasted */ }
  });
  modal.querySelector('[data-abort]')?.addEventListener('click', async () => {
    try {
      const board = await invoke('lane.conflictAbort', ...pin(lane.index, croot));
      state.conflictRoot = null;
      closeSheet();
      if (settleBoard(tabId, root, board)) toast('Aborted — branch restored', 'ok');
    } catch { /* toasted */ }
  });
}

/* Settings: a page in the same window, not a sheet */
const SETTINGS_NAV = [
  ['general', 'list', 'General'],
  ['appearance', 'sun', 'Appearance'],
  ['accounts', 'key', 'Accounts'],
  ['repositories', 'folder-simple', 'Repositories'],
  ['agents', 'robot', 'Agents'],
];

const optionGroup = (key, options, cur, { num = false, label = key } = {}) =>
  `<div class="option-row" role="group" aria-label="${esc(label)}" data-pref="${key}"${num ? ' data-num' : ''}>${options.map(([v, text]) =>
    `<button class="option${String(v) === String(cur) ? ' on' : ''}" type="button" aria-pressed="${String(v) === String(cur)}" data-v="${esc(v)}">${text}</button>`).join('')}</div>`;

const selectHTML = (key, options, cur, label) =>
  `<select class="select" data-pref="${key}" aria-label="${esc(label)}">${options.map(([v, t]) =>
    `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;

const switchHTML = (key, on, label) =>
  `<button class="switch${on ? ' on' : ''}" type="button" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-pref="${key}"></button>`;

const settingsRow = (ic, name, small, detail, control = '', tip = '') =>
  `<div class="list-row"${tip ? ` title="${esc(tip)}"` : ''}>${iconHTML(ic)}<div class="name">${name}${small ? `<small>${small}</small>` : ''}</div><div class="detail">${detail || ''}</div>${control}<span></span></div>`;

const settingsPlaceholder = (title, lede) => `<h1>${title}</h1><p class="lede">${lede}</p>`;

const SETTINGS_PAGES = {
  general: () => {
    const p = state.prefs;
    const custom = (key, ph) => `<input class="input mono" data-pref="${key}" value="${esc(p[key])}" placeholder="${ph}" aria-label="${ph}" />`;
    const EDITOR_ICON = { cursor: 'cursor', vscode: 'vscode', zed: 'zed', custom: 'folder-simple' };
    const editorOpts = (state.editors.length ? state.editors : [
      { id: 'cursor', label: 'Cursor', available: true },
      { id: 'vscode', label: 'VS Code', available: true },
      { id: 'zed', label: 'Zed', available: true },
      { id: 'custom', label: 'Other app…', available: true },
    ]).filter((e) => e.available || e.id === p.editor)
      .map((e) => [e.id, e.label]);
    const editorIcon = EDITOR_ICON[p.editor] || 'cursor';

    const external = [['internal', 'Internal (coming soon)']];
    return `<h1>General</h1><p class="lede">How Plenum opens tools and folders on this Mac.</p>
      <div class="group-head">About</div>
      <div class="list">
        ${settingsRow(
          'stack',
          'Version',
          '',
          versionDetailHTML(),
          '',
          'From package.json. Bump with npm run version:patch (or minor/major) before pack.',
        )}
      </div>
      <div class="group-head">Open with</div>
      <div class="list">
        ${settingsRow(editorIcon, 'Editor', '', 'Only apps found on this Mac', selectHTML('editor', editorOpts, p.editor, 'Editor'), 'App used for Open in editor and after you create a lane. Missing installs are hidden.')}
        ${p.editor === 'custom' ? settingsRow('folder-simple', 'Editor path', '', 'Path to an .app or binary', custom('editorPath', '/Applications/Zed.app'), 'Full path Plenum launches when Editor is Other app.') : ''}
        ${settingsRow('tree-structure', 'Open new lanes in editor', '', 'Right after Create', switchHTML('openLaneInEditor', p.openLaneInEditor, 'Open new lanes in editor'), 'When on, Create lane also opens that worktree in your editor.')}
        ${settingsRow('terminal-window', 'Terminal', '', 'Palette → Open in terminal', selectHTML('terminal', [['terminal', 'Terminal'], ['iterm', 'iTerm'], ['custom', 'Other app…']], p.terminal, 'Terminal'), 'Which terminal app opens a lane folder from the palette.')}
        ${p.terminal === 'custom' ? settingsRow('folder-simple', 'Terminal path', '', 'Path to an .app or binary', custom('terminalPath', '/Applications/Ghostty.app'), 'Full path Plenum launches when Terminal is Other app.') : ''}
      </div>
      <div class="group-head">Diff and merge<small>Built-in view is not ready. These picks wait for it.</small></div>
      <div class="list">
        ${settingsRow('files', 'Diff tool', '', '', selectHTML('diffTool', external, p.diffTool, 'Diff tool'), 'Where file diffs will open once Plenum has a diff view. External tools come later.')}
        ${settingsRow('git-merge', 'Merge tool', '', '', selectHTML('mergeTool', external, p.mergeTool, 'Merge tool'), 'Where conflict merges will open once Plenum has a merge view. External tools come later.')}
      </div>
      <div class="group-head">Folders</div>
      <div class="list">
        ${settingsRow('folder-simple', 'Clone path', 'Open Repository starts here', '', custom('cloneDefaultPath', '~/Dev'), 'Folder the Open Repository picker jumps to first. Use ~/… or an absolute path.')}
        ${settingsRow('tree-structure', 'Lanes folder', 'Default for new repos', 'Override per repo under Repositories', custom('defaultLanesFolder', '.worktrees'), 'Where Create lane puts worktrees when a repo has no override. Relative paths sit inside the checkout.')}
      </div>
      <div class="group-head">Tabs</div>
      <div class="list">
        ${settingsRow('arrows-clockwise', 'Reopen tabs', '', 'Restore open repos on launch', switchHTML('reopenTabs', p.reopenTabs, 'Reopen tabs'), 'Off clears the saved tab list when Plenum starts, so you begin empty.')}
        ${settingsRow('clock', 'Tab warm time', '', 'How long a left tab stays hot', optionGroup('warmTabTtlMs', WARM_PRESETS.map(([ms, t]) => [ms, t.replace('seconds', 's').replace('minutes', 'min')]), p.warmTabTtlMs, { num: true, label: 'Tab warm time' }), 'Within this window, switching back to a tab paints the last board instantly while git refreshes in the background. After it freezes you still get one instant paint, then a full reload.')}
      </div>
`;
  },
  appearance: () => {
    const p = state.prefs;
    return `<h1>Appearance</h1><p class="lede">Theme, size, and type. Lives on this Mac only.</p>
      <div class="list">
        ${settingsRow('sun', 'Theme', '', 'System tracks macOS', optionGroup('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], p.theme, { label: 'Theme' }), 'System follows light/dark from macOS. Light and Dark stay put.')}
        ${settingsRow('magnifying-glass', 'Zoom', '', '', optionGroup('zoom', [[0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%']], p.zoom, { num: true, label: 'Zoom' }), 'Scales the whole Plenum window. 100% is the design size.')}
        ${settingsRow('list', 'Font', '', 'Bundled packs; System is SF / UI fonts', optionGroup('fontPack', [['system', 'System'], ['inter-jetbrains', 'Inter + JetBrains Mono'], ['ibm-plex', 'IBM Plex']], p.fontPack, { label: 'Font' }), 'UI text and mono (SHAs, paths). Inter / Plex ship inside Plenum. Switch and the window should change immediately.')}
      </div>`;
  },
  accounts: () => {
    const a = state.accounts;
    const id = state.identity;
    const local = state.identityScope === 'local' && id?.local;
    const shown = (local ? id.local : id?.global) || { name: '', email: '' };
    const fallback = local ? id.global : { name: '', email: '' };
    const helper = a?.helper?.length ? a.helper.join(', ') : '';
    const where = /osxkeychain/.test(helper) ? 'Keychain' : helper ? `credential helper (${esc(helper)})` : '';
    const saved = (a?.hosts || []).map((h) => `<div class="list-row" title="Host and username Plenum remembers. The token itself stays in ${where || 'your git credential helper'}.">${iconHTML(h.kind === 'github' ? 'github-logo' : 'key')}<div class="name">${esc(h.host)}<small>${esc(h.username)}</small></div><div class="detail">Token in ${where || 'git credential helper'}</div><span class="status on"><i></i>Saved</span><button class="btn" type="button" data-remove-host="${esc(h.host)}" data-user="${esc(h.username)}">Remove</button></div>`).join('')
      || `<div class="list-row" title="Add a host below so https push/pull can use a token without prompting every time.">${iconHTML('key')}<div class="name">None yet</div><div class="detail">https remotes will keep asking until you save one.</div><span></span><span></span></div>`;
    const field = (name, ph, type = 'text') => `<input class="input" name="${name}" type="${type}" placeholder="${ph}" aria-label="${ph}" autocomplete="off" required />`;
    const ssh = !a ? '' : a.ssh.state === 'keys' ? `${a.ssh.count} key${a.ssh.count === 1 ? '' : 's'} in ssh-agent` : a.ssh.state === 'none' ? 'ssh-agent has no keys' : 'No ssh-agent running';
    return `<h1>Accounts</h1><p class="lede">Who commits as, and how https remotes authenticate. Tokens go to git’s helper${where ? ` (${where})` : ''}. Host + username only are remembered here.</p>
      <div class="group-head">Git identity<small>Writes user.name / user.email in git config. Not app prefs.</small></div>
      <div class="list">
        ${settingsRow('user', 'Applies to', '', state.board ? '' : 'Open a repo to set a local identity', optionGroup('identityScope', [['global', 'All repositories'], ...(state.board ? [['local', 'This repository']] : [])], state.identityScope, { label: 'Identity scope' }), 'Global hits ~/.gitconfig. This repository writes only the open repo’s local config.')}
        ${settingsRow('user', 'Name', '', '', `<input class="input" data-identity="name" value="${esc(shown.name)}" placeholder="${esc(fallback.name || 'Your name')}" aria-label="Git name" />`, 'Author name on commits git creates.')}
        ${settingsRow('user', 'Email', '', '', `<input class="input" data-identity="email" value="${esc(shown.email)}" placeholder="${esc(fallback.email || 'you@example.com')}" aria-label="Git email" />`, 'Author email on commits. Matches what remotes and hosting expect.')}
      </div>
      <div class="group-head">HTTPS</div>
      <div class="list">${saved}</div>
      <div class="group-head">Add<small>Use a personal access token with repo scope, not your password.</small></div>
      <div class="list">
        <form class="list-row acct" data-acct="github" title="Saves github.com credentials through git credential approve.">${iconHTML('github-logo')}<div class="name">GitHub<small>github.com</small></div><div class="acct-fields">${field('username', 'Username')}${field('token', 'Personal access token', 'password')}</div><button class="btn primary" type="submit">Save</button><span></span></form>
        <form class="list-row acct" data-acct="https" title="Any https git host. Host is the hostname only, no https://.">${iconHTML('link-simple')}<div class="name">Other host<small>Any https remote</small></div><div class="acct-fields">${field('host', 'git.example.com')}${field('username', 'Username')}${field('token', 'Token', 'password')}</div><button class="btn primary" type="submit">Save</button><span></span></form>
      </div>
      <div class="group-head">SSH<small>Plenum does not manage keys. Git uses ssh-agent and ~/.ssh/config.</small></div>
      <div class="list">${settingsRow('terminal-window', 'ssh-agent', '', '', `<span class="status${a?.ssh.state === 'keys' ? ' on' : ' warn'}"><i></i>${ssh || 'Checking…'}</span>`, 'Status only. Add or unlock keys outside Plenum.')}</div>`;
  },
  repositories: () => {
    const tabs = state.store.tabs;
    const head = `<h1>Repositories</h1><p class="lede">One open tab at a time. Team branch, lanes folder, and whether the repo can run.</p>`;
    if (!tabs.length) return `${head}<div class="list">${settingsRow('folder-simple', 'No repositories open', '', 'Open one from the empty state or ⌘P.', '', 'Settings here are per open tab. Close a tab and it leaves this list.')}</div>`;
    const activePath = state.settings.repoPath
      && tabs.some((t) => t.path === state.settings.repoPath)
      ? state.settings.repoPath
      : (tabs.find((t) => t.id === state.store.activeId)?.path || tabs[0].path);
    state.settings.repoPath = activePath;
    const t = tabs.find((x) => x.path === activePath) || tabs[0];
    const b = state.repoBoards.get(t.path);
    const root = b?.root || t.path;
    const folder = state.prefs.repoOverrides?.[root]?.lanesFolder || '';
    const m = b?.manifestSummary;
    const setupStatus = !b ? '<span class="status"><i></i>Loading…</span>'
      : b.hasManifest ? '<span class="status on"><i></i>Runnable</span>' : '<span class="status warn"><i></i>Not runnable</span>';
    const runDetail = m?.run
      ? `run <span class="mono">${esc(m.run)}</span>${m.test ? ` · test <span class="mono">${esc(m.test)}</span>` : ''} · ports <span class="mono">+${esc(m.offset)}</span>`
      : (b?.hasManifest ? 'Manifest present.' : 'No .plenum/lane.yaml yet — lanes show on the board but cannot start.');
    const svc = (m?.services || []).map((s) => `${esc(s.name)} (${esc(s.mode)})`).join(', ');
    const picker = `<div class="repo-picker" role="tablist" aria-label="Open repositories">${tabs.map((tab) => {
      const on = tab.path === activePath;
      const bb = state.repoBoards.get(tab.path);
      const tip = bb?.hasManifest ? 'Has lane.yaml' : bb ? 'No lane.yaml yet' : 'Loading board…';
      return `<button class="option${on ? ' on' : ''}" type="button" role="tab" aria-selected="${on}" data-repo-path="${esc(tab.path)}" title="${esc(tip)}"><span>${esc(tab.title)}</span><span class="mono">${esc(bb?.displayRoot || tab.path)}</span></button>`;
    }).join('')}</div>`;
    const edit = b?.hasManifest
      ? `<button class="btn" type="button" data-edit-manifest="${esc(root)}" title="Open .plenum/lane.yaml in your editor">${iconHTML('pencil-simple', 'sm')}Edit file</button>`
      : '';
    return `${head}${picker}
      <div class="group-head">${esc(t.title)}<small class="mono">${esc(b?.displayRoot || t.path)}</small></div>
      <div class="list">
        ${settingsRow('shield-check', 'Protected / team branch', b?.teamBranchSource === 'override' ? 'Override (local git config)' : 'Behind counts against this', b ? `<span class="mono">${esc(b.teamRef)}</span>` : '…', b ? teamBranchControlHTML(b, root, t.title) : '', 'Pick the integration tip for ↓↑ / create lane / merge. Auto re-detects from origin/HEAD. Stored as local git config plenum.teamBranch.')}
        ${settingsRow('tree-structure', 'Lanes folder', 'Where Create lane puts worktrees', `Blank → <span class="mono">${esc(state.prefs.defaultLanesFolder || '.worktrees')}</span> from General`, `<input class="input" data-lanes-root="${esc(root)}" value="${esc(folder)}" placeholder="${esc(state.prefs.defaultLanesFolder || '.worktrees')}" aria-label="Lanes folder for ${esc(t.title)}" />`, 'Override only for this repo. Relative paths are under the checkout; absolute paths are allowed.')}
        ${settingsRow(b && !b.hasManifest ? 'stethoscope' : 'play', 'Lane setup', b?.hasManifest ? '.plenum/lane.yaml' : 'Missing lane.yaml', runDetail, `<span class="row-actions">${setupStatus}${edit}<button class="btn${b && !b.hasManifest ? ' primary' : ''}" type="button" data-setup-root="${esc(root)}" title="Run the doctor and review a proposed lane.yaml">${iconHTML('stethoscope', 'sm')}${b?.hasManifest ? 'Re-run setup' : 'Lane setup…'}</button></span>`, 'Doctor reads the repo and proposes .plenum/lane.yaml. Write from the setup page. Edit file opens the yaml in your editor.')}
        ${settingsRow('database', 'Services', 'Shared unless the file says otherwise', svc || (b?.hasManifest ? 'No named services in the manifest.' : 'Set up a manifest to declare services.'), '', 'From lane.yaml services.*. shared means one instance for every lane; snapshot seeds a copy before Run.')}
      </div>`;
  },
  setup: () => {
    const s = state.setup;
    const tab = state.store.tabs.find((t) => t.path === s?.root);
    const findings = !s || s.loading
      ? '<div class="finding">' + iconHTML('terminal-window', 'sm') + '<div>Reading the repo…</div></div>'
      : s.findings.length
        ? s.findings.map((f) => `<div class="finding">${iconHTML('terminal-window', 'sm')}<div>${esc(f)}</div></div>`).join('')
        : `<div class="finding">${iconHTML('warning-circle', 'sm')}<div>Nothing obvious turned up.</div></div>`;
    return `<nav class="crumbs" aria-label="Breadcrumb"><a href="#" data-crumb>Repositories</a>${iconHTML('caret-right', 'sm')}<span>${esc(tab?.title || s?.root || '')}</span></nav>
      <h1>Lane setup</h1>
      <p class="lede">Why a second checkout cannot start, and the <span class="mono">.plenum/lane.yaml</span> that fixes it. Nothing is written until you hit Write.</p>
      <div class="cols">
        <div><div class="col-head">What the repo does today</div>${findings}</div>
        <div><div class="col-head">Proposed <span class="mono">.plenum/lane.yaml</span></div><pre>${esc(s?.proposedYaml || '')}</pre></div>
      </div>
      <div class="foot">${iconHTML('plugs-connected', 'sm')}<span>Same proposal from <span class="mono">plenum doctor</span> or MCP <span class="mono">repo.doctor</span>.</span>
        <div class="row-end">
          <button class="btn" type="button" data-copy-doctor title="Copy an plenum doctor command for this repo">Copy CLI</button>
          <button class="btn primary" type="button" data-write${s?.canAccept ? '' : ' disabled title="Needs a run command in the proposal"'}>${iconHTML('files', 'sm')}Write <span class="mono">.plenum/lane.yaml</span></button>
        </div>
      </div>`;
  },
  agents: () => {
    const sw = (label, on = true) => `<button class="switch${on ? ' on' : ''}" type="button" role="switch" aria-checked="${on}" aria-label="${label}" disabled title="Not wired yet — preview only."></button>`;
    const ask = (label) => `<select class="select" aria-label="${label}" disabled title="Not wired yet — preview only."><option>Ask me</option><option>Allow</option><option>Never</option></select>`;
    return `<h1>Agents</h1>
      <p class="lede">Preview. Agents already reach lanes through <span class="mono">plenum mcp</span> (stdio) and the <span class="mono">plenum</span> CLI. These switches do nothing yet.</p>
      <div class="agents-stub">
        <div class="group-head">Local MCP</div>
        <div class="list">
          ${settingsRow('broadcast', 'Server', 'stdio for now', '<span class="mono">plenum mcp</span>', `<span class="row-actions"><span class="status"><i></i>Not managed here</span>${sw('Local MCP server', false)}</span>`, 'Point Cursor / Claude Code / Codex at plenum mcp. Plenum does not host an HTTP MCP port yet.')}
          ${settingsRow('terminal-window', 'CLI', 'Same verbs', '<span class="mono">doctor, create, up, down, test, status, remove, mcp</span>', `<span class="status"><i></i>${esc(state.appInfo.version || '…')}</span>`, 'Install the plenum binary on your PATH for shells and scripts.')}
        </div>
        <div class="group-head">Clients<small>Later: detect each tool’s MCP config and write the two lines for you.</small></div>
        <div class="list">
          ${['Cursor', 'Claude Code', 'Codex'].map((n) => settingsRow('plugs-connected', n, '', 'Not detected yet', `<span class="status"><i></i>Later</span><button class="btn" type="button" disabled title="Coming later">Add</button>`, `Will read and write this client’s MCP config when the Agents page ships for real.`)).join('')}
        </div>
        <div class="group-head">What agents may do<small>Reads stay open. Commit / push / merge stay with whoever is in the lane.</small></div>
        <div class="list">
          ${settingsRow('play', 'Start and stop lanes', '<span class="mono">lane.up, lane.down, lane.test</span>', '', sw('Agents may start and stop lanes'), 'Allow agents to run the repo’s own start/stop/test commands with lane ports.')}
          ${settingsRow('tree-structure', 'Create lanes', '<span class="mono">lane.create</span>', '', sw('Agents may create lanes'), 'Allow agents to create worktrees from the team branch.')}
          ${settingsRow('warning-circle', 'Remove lanes', '<span class="mono">lane.remove</span>', '', ask('Remove lanes'), 'Same safety guard as the app: refuse when work would be lost.')}
          ${settingsRow('files', 'Write lane setup', '<span class="mono">repo.doctor --write</span>', '', ask('Write lane setup'), 'Writing .plenum/lane.yaml is a team decision — keep this on Ask until you trust it.')}
        </div>
      </div>`;
  },
};

function openLaneSetup(root = state.board?.root) {
  state.settings.setupRoot = root;
  openSettings('setup');
}

async function loadSetup(root) {
  state.setup = { root, loading: true, findings: [], proposedYaml: '', canAccept: false };
  renderSettings();
  try {
    const res = await invoke('repo.doctor', root);
    if (state.setup?.root !== root) return;
    state.setup = { root, loading: false, findings: res.findings || [], proposedYaml: res.proposedYaml || '', canAccept: !!res.canAccept };
  } catch {
    state.setup = { ...state.setup, loading: false };
  }
  if (state.settings.open && state.settings.page === 'setup') renderSettings();
}

function bindSetup(root) {
  const s = state.setup;
  root.querySelector('[data-crumb]')?.addEventListener('click', (e) => { e.preventDefault(); openSettings('repositories'); });
  root.querySelector('[data-copy-doctor]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(`plenum doctor '${String(s.root).replace(/'/g, `'\\''`)}'`).then(() => toast('Copied', 'ok'), () => {});
  });
  root.querySelector('[data-write]')?.addEventListener('click', async () => {
    try {
      const board = await invoke('repo.acceptManifest', s.proposedYaml, s.root);
      state.repoBoards.delete(s.root);
      if (board.root === state.board?.root) applyBoard(board);
      toast('Wrote .plenum/lane.yaml', 'ok');
      openSettings('repositories');
    } catch { /* toasted */ }
  });
}

async function loadRepos() {
  await Promise.all(state.store.tabs.map(async (t) => {
    try {
      const b = await api.invoke('board.get', t.path);
      b.displayRoot = await prettyPath(b.root);
      state.repoBoards.set(t.path, b);
    } catch { /* leave as Checking… */ }
  }));
  if (state.settings.open && state.settings.page === 'repositories') renderSettings();
}

/** Select of local short names + Auto (re-detect) for #43. */
function teamBranchControlHTML(board, root, title) {
  const cur = board.teamBranch || '';
  const names = new Set();
  for (const br of board.branches || []) {
    const short = br.short || String(br.name || '').replace(/^origin\//, '');
    if (short) names.add(short);
  }
  if (cur) names.add(cur);
  const opts = [`<option value="">Auto (detect)</option>`]
    .concat([...names].sort((a, b) => a.localeCompare(b)).map((n) => (
      `<option value="${esc(n)}"${n === cur && board.teamBranchSource === 'override' ? ' selected' : ''}>${esc(n)}</option>`
    )));
  // When detected (not override), show current as selected visual via Auto label — keep Auto selected.
  if (board.teamBranchSource !== 'override') {
    opts[0] = `<option value="" selected>Auto · ${esc(cur || 'detect')}</option>`;
  }
  return `<select class="select mono" data-team-root="${esc(root)}" aria-label="Protected branch for ${esc(title)}">${opts.join('')}</select>`;
}

function bindRepos(root) {
  root.querySelectorAll('[data-repo-path]').forEach((b) => b.addEventListener('click', () => {
    state.settings.repoPath = b.dataset.repoPath;
    renderSettings();
  }));
  root.querySelectorAll('[data-setup-root]').forEach((b) => b.addEventListener('click', () => {
    openLaneSetup(b.dataset.setupRoot);
  }));
  root.querySelectorAll('[data-edit-manifest]').forEach((b) => b.addEventListener('click', () => {
    const file = `${b.dataset.editManifest}/.plenum/lane.yaml`;
    invoke('os.openEditor', file).catch(() => {});
  }));
  root.querySelectorAll('[data-lanes-root]').forEach((n) => n.addEventListener('change', () => {
    const ov = { ...state.prefs.repoOverrides };
    const v = n.value.trim();
    if (v) ov[n.dataset.lanesRoot] = { ...ov[n.dataset.lanesRoot], lanesFolder: v };
    else delete ov[n.dataset.lanesRoot];
    setPref({ repoOverrides: ov }, false).catch(() => {});
  }));
  root.querySelectorAll('[data-team-root]').forEach((n) => n.addEventListener('change', async () => {
    const rootPath = n.dataset.teamRoot;
    try {
      const board = await invoke('repo.setTeamBranch', n.value.trim(), rootPath);
      board.displayRoot = await prettyPath(board.root);
      state.repoBoards.set(rootPath, board);
      if (board.root === state.board?.root) applyBoard(board);
      toast(n.value.trim() ? `Protected branch → ${board.teamBranch}` : 'Protected branch re-detected', 'ok');
      renderSettings();
    } catch { /* toasted */ }
  }));
}

async function loadAccounts() {
  try { state.accounts = await invoke('accounts.list'); } catch { return; }
  if (state.settings.open && state.settings.page === 'accounts') renderSettings();
}

function bindAccounts(root) {
  const apply = (a) => { state.accounts = a; renderSettings(); };
  root.querySelectorAll('form[data-acct]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n) => f.elements[n]?.value ?? '';
    const kind = f.dataset.acct;
    try {
      apply(await invoke('accounts.setHttps', { kind, host: v('host'), username: v('username'), token: v('token') }));
      toast('Saved. The token is in your credential helper.', 'ok');
    } catch { /* toasted */ }
  }));
  root.querySelectorAll('[data-remove-host]').forEach((b) => b.addEventListener('click', async () => {
    try { apply(await invoke('accounts.removeHttps', { host: b.dataset.removeHost, username: b.dataset.user })); } catch { /* toasted */ }
  }));
}

async function loadIdentity() {
  try { state.identity = await invoke('git.identity.get'); } catch { return; }
  if (state.settings.open && state.settings.page === 'accounts') renderSettings();
}

function bindIdentity(root) {
  root.querySelectorAll('.option-row[data-pref=identityScope] .option').forEach((b) => b.addEventListener('click', () => {
    state.identityScope = b.dataset.v;
    renderSettings();
  }));
  root.querySelectorAll('[data-identity]').forEach((n) => n.addEventListener('change', async () => {
    const v = (k) => root.querySelector(`[data-identity=${k}]`).value;
    try {
      state.identity = await invoke('git.identity.set', { scope: state.identityScope, name: v('name'), email: v('email') });
      toast('Saved git identity', 'ok');
    } catch { /* toasted */ }
    renderSettings();
  }));
}

function bindPrefs(root) {
  const set = (key, v, render) => setPref({ [key]: v }, render).catch(() => {});
  root.querySelectorAll('.option-row[data-pref]:not([data-pref=identityScope])').forEach((g) =>
    g.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () =>
      set(g.dataset.pref, 'num' in g.dataset ? Number(b.dataset.v) : b.dataset.v))));
  root.querySelectorAll('select[data-pref]').forEach((n) =>
    n.addEventListener('change', () => set(n.dataset.pref, 'num' in n.dataset ? Number(n.value) : n.value)));
  // Text fields save without re-rendering, so Tab to the next field keeps focus.
  root.querySelectorAll('input[data-pref]:not([type=checkbox])').forEach((n) =>
    n.addEventListener('change', () => set(n.dataset.pref, n.value.trim(), false)));
  root.querySelectorAll('.switch[data-pref]').forEach((n) =>
    n.addEventListener('click', () => set(n.dataset.pref, n.getAttribute('aria-checked') !== 'true')));
}

function openSettings(page = state.settings.page) {
  state.settings.open = true;
  state.settings.page = page;
  paint();
  renderSettings();
  if (page === 'accounts') { loadIdentity(); loadAccounts(); }
  if (page === 'repositories') loadRepos();
  if (page === 'setup') loadSetup(state.settings.setupRoot || state.board?.root);
}

function closeSettings() {
  state.settings.open = false;
  paint();
}

function renderSettings() {
  const { page } = state.settings;
  const lit = page === 'setup' ? 'repositories' : page; // Lane setup lives under Repositories
  const nav = SETTINGS_NAV.map(([id, ic, label]) =>
    `<button class="navitem${id === lit ? ' active' : ''}" type="button" data-page="${id}"${id === lit ? ' aria-current="page"' : ''}>${iconHTML(ic)}${label}</button>`).join('');
  el.settingsNav.innerHTML = `<button class="navitem back" type="button" data-board>${iconHTML('caret-right')}Board<kbd>esc</kbd></button>
    <div class="heading">Settings</div>${nav}`;
  el.settingsBody.className = `settings-body${page === 'setup' ? ' setup' : ''}`;
  el.settingsBody.innerHTML = (SETTINGS_PAGES[page] || SETTINGS_PAGES.general)();
  if (page === 'accounts') { bindIdentity(el.settingsBody); bindAccounts(el.settingsBody); }
  if (page === 'repositories') bindRepos(el.settingsBody);
  if (page === 'setup') bindSetup(el.settingsBody);
  bindPrefs(el.settingsBody);
  el.settingsNav.querySelector('[data-board]').addEventListener('click', closeSettings);
  el.settingsNav.querySelectorAll('[data-page]').forEach((b) =>
    b.addEventListener('click', () => openSettings(b.dataset.page)));
}

/* Palette */
function paletteCommands() {
  const lane = laneByIndex(state.selectedLane);
  const cmds = [
    { id: 'open', label: 'Open Repository…', run: openRepo },
    { id: 'quickstart', label: 'Quick start: what are lanes?', run: openQuickStartSheet },
    { id: 'feedback', label: 'Feedback…', run: () => { closePalette(); openFeedbackSheet(); }, match: ['tell me', 'report', 'feedback'] },
    { id: 'settings', label: 'Settings…', run: () => openSettings() },
    { id: 'new', label: 'New lane…', run: openCreateLane, when: !!state.board },
    { id: 'doctor', label: 'Lane setup…', run: () => openLaneSetup(), when: !!state.board },
    { id: 'commit', label: 'Commit…', run: () => openCommitSheet(lane), when: lane && lane.dirty },
    { id: 'stash', label: 'Stash uncommitted', run: () => handleAction('stash', lane), when: lane && lane.dirty },
    { id: 'stashPop', label: 'Pop stash', run: () => handleAction('stashPop', lane), when: lane && state.board?.stashCount },
    { id: 'push', label: `Push ${lane?.name || ''} to origin`.trim(), run: () => handleAction('push', lane), when: lane && lane.unpushed },
    { id: 'pull', label: `Pull ${lane?.name || ''} (ff-only)`.trim(), run: () => handleAction('pull', lane), when: !!lane },
    { id: 'rebase', label: 'Rebase on main', run: () => handleAction('rebase', lane), when: lane && !lane.isPrimary && lane.behind },
    { id: 'merge', label: 'Merge into main…', run: () => handleAction('merge', lane), when: lane && !lane.isPrimary && lane.ahead && !lane.dirty },
    { id: 'conflicts', label: 'Resolve conflicts…', run: () => handleAction('conflicts', lane), when: !!lane },
    { id: 'up', label: 'Run lane', run: () => handleAction('up', lane), when: lane && !lane.isPrimary && lane.runnable && !lane.running && lane.readiness !== 'safe' },
    { id: 'down', label: 'Stop lane', run: () => handleAction('down', lane), when: lane && lane.running },
    { id: 'test', label: 'Test lane', run: () => handleAction('test', lane), when: lane && !lane.isPrimary && lane.runnable && lane.readiness !== 'safe' },
    { id: 'reveal', label: 'Reveal in Finder', run: () => handleAction('reveal', lane), when: !!lane },
    { id: 'editor', label: `Open in ${editorName()}`, run: () => handleAction('editor', lane), when: !!lane },
    { id: 'terminal', label: 'Open in terminal', run: () => invoke('os.openTerminal', lane.path).catch(() => {}), when: !!lane },
    { id: 'warm', label: 'Tab warm time…', run: openWarmSheet },
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
  const items = paletteCommands().filter((c) => {
    if (!needle) return true;
    if (c.label.toLowerCase().includes(needle)) return true;
    return (c.match || []).some((m) => m.toLowerCase().includes(needle) || needle.includes(m.toLowerCase()));
  });
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
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
  if (e.key === 'Escape') {
    if (document.getElementById('feedback-pick-layer')) {
      stopFeedbackPick();
      openFeedbackSheet({ comment: feedbackDraft.comment, target: feedbackDraft.target });
      return;
    }
    if (!el.paletteLayer.hidden) closePalette();
    else if (el.sheetLayer.classList.contains('open')) closeSheet();
    else if (state.settings.open) {
      if (state.settings.page === 'setup') openSettings('repositories');
      else closeSettings();
    }
    else if (state.filePane) {
      clearFileStage();
      state.changesPaintKey = '';
      paintChanges();
    }
    else if (state.changes) { closeChanges(); paint(); }
  }
});

async function openRepo() {
  const path = await invoke('os.pickFolder');
  if (!path) return;
  setLoading(true, 'Opening repository…', path);
  try {
    state.settings.open = false;
    if (state.store.activeId && state.board) snapshotWarm(state.store.activeId);
    const res = await invoke('tabs.open', path);
    applyStore(res.store);
    // Re-selecting an already-open tab should restore its warm chrome.
    const warm = state.warmTabs.get(res.store.activeId);
    if (warm?.board && warm.path === res.board?.root) {
      restoreViewChrome(warm);
      applyBoard(res.board || warm.board, { selectLane: warm.selectedLane });
    } else {
      resetViewChrome();
      applyBoard(res.board, { selectLane: res.board.lanes[1]?.index ?? 0 });
    }
  } catch {
    setLoading(false);
    paint();
  }
}

async function selectTab(id) {
  if (id === state.store.activeId) { if (state.settings.open) closeSettings(); return; }
  const prevId = state.store.activeId;
  state.settings.open = false;
  // Cancel any prior cold-load chrome so a late timer cannot cover the new tab.
  setLoading(false);
  snapshotWarm(prevId);
  const seq = ++state.switchSeq;
  state.store = { ...state.store, activeId: id };
  state.busy = state.opsByTab.has(id);
  paintTabs();
  const warm = state.warmTabs.get(id);
  const tab = state.store.tabs.find((t) => t.id === id);
  let usedWarm = false;
  if (warm?.board) {
    usedWarm = true;
    restoreViewChrome(warm);
    applyBoard(warm.board, { selectLane: warm.selectedLane });
    if (warm.timerId) { clearInterval(warm.timerId); warm.timerId = null; }
  } else {
    // Cold tab: clear previous chrome; show loading (not the empty "Open a repository" state).
    resetViewChrome();
    state.board = null;
    setLoading(true, 'Opening repository…', tab?.path || '', { immediate: true });
    paint();
  }
  try {
    const res = await invoke('tabs.select', id);
    if (seq !== state.switchSeq || state.store.activeId !== id) return;
    applyStore(res.store);
    if (!usedWarm) {
      const root = tab?.path || res.store.tabs.find((t) => t.id === id)?.path;
      let board = null;
      try {
        board = root
          ? await invoke('board.get', root, { historyLimit: state.historyLimit || 120 })
          : null;
      } catch { /* toasted */ }
      if (seq !== state.switchSeq || state.store.activeId !== id) return;
      setLoading(false);
      if (board) applyBoard(board, { selectLane: board.lanes[1]?.index ?? 0 });
      else {
        state.board = null;
        paint();
      }
    } else if (warm.frozen) {
      warm.frozen = false;
      warm.leftAt = Date.now();
      await refresh();
      if (seq !== state.switchSeq || state.store.activeId !== id) return;
      const e = state.warmTabs.get(id);
      if (e) {
        applyChromeToEntry(e, captureViewChrome(state, graphScrollTop()));
        e.board = state.board;
        e.path = state.board?.root || e.path;
        e.leftAt = Date.now();
        e.frozen = false;
        if (e.timerId) clearInterval(e.timerId);
        e.timerId = setInterval(() => warmRefresh(id), WARM_REFRESH_MS);
      }
    } else {
      refresh().catch(() => {});
    }
  } catch {
    if (seq === state.switchSeq && !usedWarm) {
      setLoading(false);
      paint();
    }
  }
}

async function refresh() {
  const tabId = state.store.activeId;
  const root = state.board?.root;
  if (!root || !tabId) return;
  const limit = state.historyLimit || 120;
  try {
    const board = await invoke('board.get', root, { historyLimit: limit });
    settleBoard(tabId, root, board);
  } catch { /* toasted */ }
}

async function loadOlderHistory() {
  if (!state.board?.historyHasMore || state.loadingOlder) return;
  const tabId = state.store.activeId;
  const root = state.board.root;
  const next = Math.min(5000, (state.historyLimit || 120) + 120);
  state.historyLimit = next;
  state.loadingOlder = true;
  const foot = el.graph.querySelector('[data-load-older]');
  if (foot) foot.innerHTML = `<i class="spinner btn-spin" aria-hidden="true"></i><span>Loading older…</span>`;
  let board = null;
  try {
    board = await invoke('board.get', root, { historyLimit: next });
  } catch { /* toasted */ }
  if (state.store.activeId !== tabId) {
    state.loadingOlder = false;
    const w = state.warmTabs.get(tabId);
    if (w && board) {
      w.board = board;
      w.historyLimit = next;
    }
    return;
  }
  state.loadingOlder = false;
  if (board) applyBoard(board);
  else {
    const idle = el.graph.querySelector('[data-load-older]');
    if (idle) idle.innerHTML = '';
  }
}

window.addEventListener('focus', () => { refresh(); });

async function boot() {
  try {
    state.prefs = await invoke('prefs.get');
    applyPrefs();
  } catch { /* defaults */ }
  try {
    const v = await invoke('app.version');
    state.appInfo = (v && typeof v === 'object')
      ? {
          version: String(v.version || ''),
          commit: String(v.commit || ''),
          committedAt: String(v.committedAt || ''),
        }
      : { version: String(v || ''), commit: '', committedAt: '' };
  } catch {
    state.appInfo = { version: '', commit: '', committedAt: '' };
  }
  paintVersion();
  if (typeof ResizeObserver !== 'undefined' && el.titlebar) {
    const ro = new ResizeObserver(() => syncSearchCollapse());
    ro.observe(el.titlebar);
    ro.observe(el.tabstrip);
  } else {
    window.addEventListener('resize', syncSearchCollapse);
  }
  try {
    state.editors = await invoke('os.editors');
  } catch { state.editors = []; }
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
    clearFileStage();
    if (closing) closeChanges();
    else state.changes = { kind: 'wip', laneIndex: lane.index };
    paint();
    return;
  }
  const commit = e.target.closest('[data-commit]');
  if (commit && el.graph.contains(commit)) {
    const sha = commit.dataset.commit;
    const closing = state.changes?.kind === 'commit' && state.changes.sha === sha;
    clearFileStage();
    if (closing) closeChanges();
    else state.changes = { kind: 'commit', sha };
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
