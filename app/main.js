import './lib/icons.js';
import { renderGraph, renderLinearHistory } from './lib/graph-live.js';
import { authorshipPillHTML } from './lib/authorship-pill.js';
import { authorshipBadgeLegendHTML, aiToolPillIconHTML } from './lib/ai-tool-badge.js';
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
import { startTour } from './lib/tour.js';
import { noteLaunch, pickNudge, markShown } from './lib/nudge.js';
import { bindLayoutResizers } from './lib/layout-widths.js';
import { enhanceSelects, closeSelectMenus } from './lib/select.js';
import {
  applyGraphColumnLayout,
  defaultGraphColumns,
  GRAPH_COLUMN_META,
  headersMatchColumns,
  moveColumn,
  normalizeGraphColumns,
  setColumnOn,
} from './lib/graph-columns-pref.js';

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
  // Trusted static icon names only - never pass user input as n.
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
  /** Remotes fold-out - collapsed by default; locals are the active work. */
  remotesOpen: false,
  /** Lanes / Worktrees accordion - open by default so the board reads full. */
  lanesOpen: true,
  worktreesOpen: true,
  /** Session expand/collapse for branch path folders (#21). */
  collapsedBranchFolders: new Set(),
  /** Remote path folders start collapsed (#62); keys here are the ones the user opened. */
  openRemoteFolders: new Set(),
  changes: null, // { kind:'wip', laneIndex } | { kind:'commit', sha }
  runLog: null, // { laneIndex } | null — bottom drawer; independent of changes
  runLogStick: true, // auto-scroll to bottom unless user scrolled up
  branchFilter: '', // #69 panel filter across lanes, worktrees, local + remote
  filePane: null, // { sha, path, mode: 'diff'|'blame'|'history' } | null
  collapsedDirs: new Set(),
  changesPaintKey: '',
  changesCache: null,
  commitDraft: '',
  selectedWipEntries: new Map(),
  wipSelectionAnchor: new Map(),
  warmTabs: new Map(),
  prefs: {},
  identity: null,
  accounts: null,
  repoBoards: new Map(),
  setup: null,
  /** Settings → Lane: live .plenum/lane.yaml editor (keyed by board.root). */
  lane: null,
  laneByRoot: new Map(),
  identityScope: 'global',
  warmTtlMs: 120000,
  settings: { open: false, page: 'general', setupRoot: null, setupTabId: null },
  /** Full-window branch compare page (see docs/branch-overview.md). */
  branchOverview: {
    open: false,
    branch: null,
    vs: null,
    tab: 'commits',
    query: '',
    data: null,
    loading: false,
    error: null,
    selectedSha: null,
  },
  appInfo: { version: '', commit: '', committedAt: '' },
  /** electron-updater state from main (`app.update.state` / `onUpdate`). */
  update: null,
  historyLimit: 120,
  editors: [],
  diffMergeTools: [],
  loadingOlder: false,
  /** Tab ids with a quiet board/branch refresh in flight (#47). */
  refreshingByTab: new Set(),
  loudRefreshByTab: new Set(), // #116 only an asked-for refresh shows spinners / blocks rows
  /** Bumped on every tab switch so superseded select/load work stops painting. */
  switchSeq: 0,
  pendingGraphScroll: null,
  /** ⌘Z stack: { label, tabId|null, run, opts } - newest last. */
  undoStack: [],
};

const el = {
  tabstrip: document.getElementById('tabstrip'),
  tabstripScroll: document.getElementById('tabstrip-scroll'),
  tabstripEdgeLeft: document.getElementById('tabstrip-edge-left'),
  tabstripEdgeRight: document.getElementById('tabstrip-edge-right'),
  tabScrollPrev: document.getElementById('tab-scroll-prev'),
  tabScrollNext: document.getElementById('tab-scroll-next'),
  tabAdd: document.getElementById('tab-add'),
  loading: document.getElementById('loading'),
  loadingTitle: document.getElementById('loading-title'),
  loadingPath: document.getElementById('loading-path'),
  empty: document.getElementById('empty'),
  openRepo: document.getElementById('open-repo'),
  panel: document.getElementById('panel'),
  main: document.getElementById('main'),
  changes: document.getElementById('changes'),
  runLog: document.getElementById('run-log'),
  fileStage: document.getElementById('file-stage'),
  settings: document.getElementById('settings'),
  settingsNav: document.getElementById('settings-nav'),
  settingsBody: document.getElementById('settings-body'),
  branchOverview: document.getElementById('branch-overview'),
  branchOverviewBody: document.getElementById('branch-overview-body'),
  body: document.getElementById('body'),
  laneHead: document.getElementById('lane-head'),
  graph: document.querySelector('.graph'),
  paletteLayer: document.getElementById('palette-layer'),
  paletteInput: document.getElementById('palette-input'),
  paletteResults: document.getElementById('palette-results'),
  sheetLayer: document.getElementById('sheet-layer'),
  toast: document.getElementById('toast'),
  appVersion: document.getElementById('app-version'),
  appBeta: document.getElementById('app-beta'),
  searchbtn: document.querySelector('.titlebar .searchbtn'),
  titlebar: document.querySelector('.titlebar'),
};

/** Panel + graph column widths (localStorage). Remount rails after panel/settings paint. */
function graphColumnPrefs() {
  return normalizeGraphColumns(state.prefs?.graphColumns);
}

/** Signature of order + visibility — skip header rebuild when unchanged. */
function graphColumnsSig(cols = graphColumnPrefs()) {
  return normalizeGraphColumns(cols).map((c) => `${c.id}:${c.on ? 1 : 0}`).join(',');
}
let lastGraphColsSig = '';

/**
 * Headers + CSS tracks / SVG left.
 * `headers` rebuilds header cells; `remount` re-attaches board resize handles.
 * Measure-only passes must not rebuild headers (that wipes the handles).
 */
function syncGraphColumnChrome(graphEl = el.graph, {
  remount = true,
  measure = false,
  headers = remount,
} = {}) {
  if (!graphEl) return;
  applyGraphColumnLayout(graphEl, graphColumnPrefs(), {
    widths: layout.widths,
    measure,
    headers,
  });
  if (remount && graphEl === el.graph) layout.remountGraphCols();
}

function paintBoardGraph() {
  if (!state.board || !el.graph) return;
  const cols = graphColumnPrefs();
  const head = el.graph.querySelector('.graph-cols');
  // Rebuild headers whenever prefs diverge from the DOM — skipping caused drift
  // (e.g. hide SHA → titles sat on the wrong tracks).
  const needHeaders = !headersMatchColumns(head, cols) || graphColumnsSig(cols) !== lastGraphColsSig;
  lastGraphColsSig = graphColumnsSig(cols);
  syncGraphColumnChrome(el.graph, { remount: needHeaders, headers: needHeaders, measure: false });
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
    gravatar: state.prefs.gravatar !== false,
    columns: cols,
    historyHasMore: !!state.board.historyHasMore,
  });
  // Remeasure SVG left when a flex column sits before Graph — keep header/handles.
  syncGraphColumnChrome(el.graph, { remount: false, headers: false, measure: true });
  // Guarantee header cells still match row cells after paint.
  if (!headersMatchColumns(el.graph.querySelector('.graph-cols'), cols)) {
    syncGraphColumnChrome(el.graph, { remount: true, headers: true, measure: true });
  }
  layout.refresh(); // re-sync SVG canvas width/viewBox after paint
  bindWipCommitFields();
  const rowsEl = el.graph.querySelector('.rows');
  bindGraphScrollReveal(rowsEl);
  attachOlderSentinel(rowsEl);
}

const layout = bindLayoutResizers({
  panel: el.panel,
  settingsNav: el.settingsNav,
  graph: el.graph,
  onChange: () => {
    syncGraphColumnChrome(el.graph, { remount: false, measure: true });
  },
});

function applyTheme() {
  const t = state.prefs.theme || 'system';
  const dark = t === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  delete root.dataset.accent;
  delete root.dataset.lightPalette;
  const chroma = state.prefs.chroma || 'muted';
  if (chroma === 'muted') delete root.dataset.chroma;
  else root.dataset.chroma = chroma;
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
  if ('gravatar' in partial || 'graphColumns' in partial) paint();
  // Editor chrome lives on the board / file pane — refresh even while Settings is open
  // so closing Settings (or a later paint) never keeps a stale Cursor/VS Code glyph.
  if ('editor' in partial || 'editorPath' in partial || 'openLaneInEditor' in partial) {
    if (!state.settings.open && !state.branchOverview.open) {
      if (state.board) paintHeader();
      if (state.filePane) paintFilePane(state.filePane);
    }
  }
  if ('tabFavicons' in partial) {
    applyStore(await invoke('tabs.list'));
    paintTabs();
  }
  if (!render) return;
  const top = el.settingsBody.scrollTop;
  renderSettings();
  el.settingsBody.scrollTop = top;
}

/** Glyph for a repo tab: custom/auto favicon when present, else preset SVG. */
function tabGlyph(tab) {
  if (state.prefs.tabFavicons !== false && tab.favicon) {
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.alt = '';
    img.draggable = false;
    img.src = tab.favicon;
    img.addEventListener('error', () => {
      img.replaceWith(icon(tab.icon || 'folder-simple', 'sm'));
    });
    return img;
  }
  return icon(tab.icon || 'folder-simple', 'sm');
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function toast(msg, kind = '', { undo = false, link = null, action = null } = {}) {
  el.toast.hidden = false;
  el.toast.className = `toast ${kind}`.trim();
  el.toast.setAttribute('role', 'status');
  el.toast.replaceChildren();
  const text = String(msg).replace(/^Error:\s*/i, '').split('\n')[0] + (undo ? ' · ⌘Z to undo' : '');
  el.toast.append(document.createTextNode(text));
  if (link?.url && link?.label) {
    el.toast.append(document.createTextNode(' · '));
    const a = document.createElement('a');
    a.href = link.url;
    a.textContent = link.label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      invoke('os.openExternal', link.url).catch(() => {});
    });
    el.toast.append(a);
  }
  if (action) {
    el.toast.append(document.createTextNode(' · '));
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = action.label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      el.toast.hidden = true;
      action.run();
    });
    el.toast.append(a);
  }
  clearTimeout(toast._t);
  const ms = action ? 8000 : kind === 'bad' ? 6000 : undo ? 5000 : link ? 6000 : 2800;
  toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

let loadingTimer = null;
let loadingShownAt = 0;
const LOADING_MIN_MS = 900; // #86 hold skeleton briefly so cold switches don't flash
function setLoading(on, title = 'Opening repository…', path = '', { immediate = false } = {}) {
  state.loading = on;
  clearTimeout(loadingTimer);
  if (on) {
    el.loadingTitle.textContent = title;
    el.loadingPath.textContent = path;
    el.empty.hidden = true;
    const show = () => {
      if (!state.loading || state.settings.open) return;
      loadingShownAt = Date.now();
      el.loading.hidden = false;
      el.panel.hidden = true;
      el.main.hidden = true;
      el.laneHead.hidden = true;
      el.changes.hidden = true;
    };
    if (immediate) show();
    else loadingTimer = setTimeout(show, 150);
  } else {
    const hide = () => {
      if (state.loading) return;
      el.loading.hidden = true;
    };
    const shownFor = loadingShownAt ? Date.now() - loadingShownAt : LOADING_MIN_MS;
    if (!el.loading.hidden && shownFor < LOADING_MIN_MS) {
      loadingTimer = setTimeout(hide, LOADING_MIN_MS - shownFor);
    } else {
      hide();
    }
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

function betaMarkHTML(inline = false) {
  return `<span class="beta-mark${inline ? ' inline' : ''}" title="Plenum is in beta">BETA</span>`;
}

function versionDetailHTML() {
  const { version, commit, committedAt } = state.appInfo;
  const ver = esc(version || '…');
  const beta = betaMarkHTML(true);
  if (!commit) return `<span class="mono version-line">${ver}${beta}</span>`;
  const when = formatCommitAt(committedAt);
  const rest = when ? `${esc(commit)} · ${esc(when)}` : esc(commit);
  return `<span class="mono version-line">${ver}${beta} · ${rest}</span>`;
}

/** Release notes are one commit header per line ("- subject"). */
function updateNotes(u = state.update) {
  return String(u?.releaseNotes || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}

function updateNotesHTML(u = state.update) {
  const items = updateNotes(u);
  if (!u || !items.length || !(u.status === 'available' || u.status === 'downloaded')) return '';
  return `<div class="update-notes"><div class="update-notes-head">What’s new in ${esc(updateTargetVersion(u) || 'this update')}</div><ul>${items.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

function updateTargetVersion(u = state.update) {
  return u?.availableVersion || u?.downloadedVersion || null;
}

/** Mirror of electron/updates.mjs actionLabel for the Settings text button. */
function updateActionLabel(u = state.update) {
  if (!u || !u.enabled) return null;
  const v = updateTargetVersion(u);
  switch (u.status) {
    case 'available': return v ? `Download ${v}` : 'Download update';
    case 'downloading': {
      const pct = u.downloadPercent;
      return pct != null ? `Downloading ${Math.round(pct)}%` : 'Downloading…';
    }
    case 'downloaded': return 'Close & update';
    case 'checking': return 'Checking…';
    case 'error': return u.canRetry ? 'Try again' : 'Update unavailable';
    case 'up-to-date':
    case 'idle': return 'Check for updates';
    default: return null;
  }
}

/** Glyph for both foot icon + Settings text leading icon. */
function updateActionIcon(u = state.update) {
  if (u?.status === 'available') return 'cloud-arrow-down';
  return 'arrows-clockwise';
}

/** Hover / aria: icon must name the version when one is in play. */
function updateHoverTip(u = state.update) {
  if (!u) return '';
  if (u.status === 'disabled') return u.message || 'Updates unavailable';
  if (u.status === 'error') return u.message || 'Update failed — try again';
  const cur = u.currentVersion || state.appInfo.version || '?';
  const next = updateTargetVersion(u);
  switch (u.status) {
    case 'available':
      return next ? `Download ${next}` : 'Download update';
    case 'downloading': {
      const pct = u.downloadPercent != null ? ` (${Math.round(u.downloadPercent)}%)` : '';
      return next ? `Downloading ${next}${pct}` : `Downloading update${pct}`;
    }
    case 'downloaded':
      return next ? `Close & update to ${next}` : 'Close & update';
    case 'checking':
      return `Checking for updates… (installed ${cur})`;
    case 'up-to-date':
      return `You’re on ${cur} — check again`;
    case 'idle':
      return `Installed ${cur}. Check for updates`;
    default:
      return next || `Installed ${cur}`;
  }
}

const RING_C = 2 * Math.PI * 12;
const ringOffset = (pct) => RING_C * (1 - Math.min(100, Math.max(0, Number(pct) || 0)) / 100);

function updateRingHTML(u = state.update) {
  if (u?.status !== 'downloading') return '';
  return `<svg class="foot-update-ring" viewBox="0 0 28 28" aria-hidden="true"><circle class="ring-track" cx="14" cy="14" r="12"/><circle class="ring-bar" cx="14" cy="14" r="12" style="stroke-dasharray:${RING_C};stroke-dashoffset:${ringOffset(u.downloadPercent)}"/></svg>`;
}

function updateStatusClass(u = state.update) {
  const s = u?.status;
  if (!s || s === 'disabled') return '';
  return s;
}

function updateNotifyDot(u = state.update) {
  return u?.status === 'available' || u?.status === 'downloaded'
    ? '<span class="foot-update-dot" aria-hidden="true"></span>'
    : '';
}

function updateControlHTML() {
  const u = state.update;
  if (!u) return '';
  if (!u.enabled) {
    return `<span class="status" title="${esc(u.message || 'Updates unavailable')}"><i></i>Dev</span>`;
  }
  const label = updateActionLabel(u);
  if (!label) return '';
  const tip = updateHoverTip(u);
  const status = updateStatusClass(u);
  const checking = u.status === 'checking';
  const downloading = u.status === 'downloading';
  const icon = downloading
    ? updateRingHTML(u)
    : iconHTML(updateActionIcon(u), checking ? 'spin' : '');
  return `<button class="btn update-act ${esc(status)}" type="button" data-update-act title="${esc(tip)}">${icon}<span class="update-act-label">${esc(label)}</span>${updateNotifyDot(u)}</button>`;
}

function applyUpdateState(next) {
  if (!next || typeof next !== 'object') return;
  const prev = state.update;
  state.update = next;
  const statusChanged = !prev
    || prev.status !== next.status
    || prev.availableVersion !== next.availableVersion
    || prev.downloadedVersion !== next.downloadedVersion
    || prev.message !== next.message
    || Boolean(prev?.enabled) !== Boolean(next.enabled);
  const progressChanged = prev?.downloadPercent !== next.downloadPercent;
  if (!statusChanged && !progressChanged) return;
  if (state.settings.open) {
    renderSettings();
    return;
  }
  if (statusChanged) {
    paint();
    return;
  }
  // Progress-only: keep the ring + tip in sync without a full paint.
  const tip = updateHoverTip(next);
  document.querySelectorAll('[data-update-act]').forEach((btn) => {
    btn.title = tip;
    btn.setAttribute('aria-label', tip.replace(/\n/g, ' — '));
    const bar = btn.querySelector('.ring-bar');
    if (bar) bar.style.strokeDashoffset = ringOffset(next.downloadPercent);
    const label = btn.querySelector('.update-act-label');
    if (label) label.textContent = updateActionLabel(next) || '';
  });
}

function paintVersion() {
  const { version, commit, committedAt } = state.appInfo;
  if (!version) {
    el.appVersion.hidden = true;
    el.appVersion.textContent = '';
    el.appVersion.removeAttribute('title');
    if (el.appBeta) el.appBeta.hidden = true;
    return;
  }
  el.appVersion.hidden = false;
  el.appVersion.textContent = version;
  if (el.appBeta) el.appBeta.hidden = false;
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
    const msg = (e?.message || String(e)).replace(/^Error invoking remote method [^:]+:\s*/, '');
    // One tap from an error to a pre-filled report. The feedback and updater channels
    // are excluded so a failed send can't offer to report itself.
    const reportable = state.prefs?.feedbackPrompts !== false && !/^(feedback|app\.update)\./.test(channel);
    toast(msg, 'bad', reportable
      ? { action: { label: 'Report', run: () => openFeedbackSheet({ comment: `${msg.split('\n')[0]}\n\nWhat I was doing: ` }) } }
      : {});
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
  closeRunLog();
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

/* ---- Undo (⌘Z) and copy/paste ---- */
const UNDO_MAX = 20;

/** `run` re-applies the inverse and returns a board to settle (or nothing). tabId null = tab-strip action. */
function pushUndo(label, tabId, run, opts) {
  state.undoStack.push({ label, tabId, run, opts });
  if (state.undoStack.length > UNDO_MAX) state.undoStack.shift();
}

async function undoLast() {
  if (el.sheetLayer.classList.contains('open') || !el.paletteLayer.hidden) return;
  if (state.busy) { toast('Wait for the current operation to finish'); return; }
  const active = state.store.activeId;
  const i = state.undoStack.findLastIndex((u) => u.tabId == null || u.tabId === active);
  if (i < 0) { toast('Nothing to undo'); return; }
  const [entry] = state.undoStack.splice(i, 1);
  const root = state.board?.root;
  try {
    const board = await entry.run();
    if (board) settleBoard(active, root, board, entry.opts);
    toast(`Undid: ${entry.label}`, 'ok');
  } catch (e) {
    toast(String(e?.message || e).replace(/^Error invoking remote method [^:]+:\s*/, ''), 'bad');
  }
}

/* plenum.sh headline reads "Work in plenum.sh with <from>" when the link has ?from=. Name is the git author's first name. */
async function shareLink() {
  closePalette();
  let first = '';
  try {
    const id = await invoke('git.identity.get');
    first = ((id.local?.name || id.global?.name || '').trim().split(/\s+/)[0] || '').slice(0, 40);
  } catch { /* no name: plain link */ }
  copyText('https://plenum.sh/' + (first ? `?from=${encodeURIComponent(first)}` : ''), first ? `link (headline says “with ${first}”)` : 'link');
}

async function copyText(text, what) {
  try {
    await api.invoke('clipboard.write', text);
    toast(`Copied ${what}`, 'ok');
  } catch { toast('Couldn’t copy', 'bad'); }
}

/** ⌘C with no text selected: selected changed files, else the open commit's SHA, else the lane's branch. */
function copyFocused() {
  const rows = [...el.changes.querySelectorAll('[data-select-file][aria-selected="true"], [data-select-dir][aria-selected="true"]')];
  if (!el.changes.hidden && rows.length) {
    const paths = rows.map((r) => r.dataset.selectFile || r.dataset.selectDir);
    return copyText(paths.join('\n'), paths.length === 1 ? 'path' : `${paths.length} paths`);
  }
  if (state.changes?.kind === 'commit') return copyText(state.changes.sha, 'SHA');
  const lane = laneByIndex(state.selectedLane);
  if (lane?.branch) return copyText(lane.branch, 'branch name');
}

/** ⌘V outside a text field: a repo path opens that repo, anything else goes to the palette search. */
async function pasteIntoApp(clip) {
  if (el.sheetLayer.classList.contains('open') || state.settings.open || state.branchOverview.open) return;
  const text = String(clip ?? '').trim();
  if (!text || text.includes('\n')) return;
  if (/^(\/|~\/)/.test(text)) return openRepoPath(text);
  openPalette();
  el.paletteInput.value = text;
  renderPalette(text);
}

const isEditable = (n) => Boolean(n?.matches?.('textarea, select, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=button])'));
api?.onEdit((cmd, text) => {
  const editable = isEditable(document.activeElement);
  if (cmd === 'undo') return editable ? api.invoke('edit.native', 'undo') : undoLast();
  if (cmd === 'copy') return editable || window.getSelection()?.toString() ? api.invoke('edit.native', 'copy') : copyFocused();
  if (cmd === 'paste') return editable ? api.invoke('edit.native', 'paste') : pasteIntoApp(text);
});

/** Undo for create lane: remove the new worktree (and its branch when we made it) if still untouched. */
function pushCreateLaneUndo(tabId, created, { newBranch }) {
  if (!created) return;
  pushUndo(`create lane ${created.name}`, tabId, async () => {
    const cur = state.board?.lanes.find((l) => l.path === created.path);
    if (!cur) return null;
    if (cur.dirty) throw new Error('That lane has uncommitted changes now. Remove it from the lane menu.');
    let board = await invoke('lane.remove', ...pin(cur.index, { force: true }));
    if (newBranch && created.branch) board = (await api.invoke('branch.delete', ...pin(created.branch)).catch(() => null)) || board;
    return board;
  }, { selectLane: 0 });
}

/** Undo for tab rename / icon / close: put the stored tab back as it was. */
function pushTabRestoreUndo(before, label) {
  const index = state.store.tabs.findIndex((t) => t.id === before.id);
  pushUndo(label, null, async () => {
    applyStore(await invoke('tabs.restore', before, index));
    if (label.startsWith('close')) await selectTab(before.id);
    else paintTabs();
  });
}
const tabLook = (t) => JSON.stringify([t?.title, t?.icon, t?.iconManual, t?.favicon, t?.faviconRel]);

const OP_LABELS = {
  checkout: 'Checkout',
  'branch-update': 'Pull',
  'branch-push': 'Push',
  push: 'Push',
  forcePush: 'Force push',
  pull: 'Pull',
  rebase: 'Rebase',
  merge: 'Merge',
  finish: 'Finish',
  commit: 'Commit',
  stash: 'Stash',
  stashPop: 'Pop stash',
  up: 'Starting',
  down: 'Stopping',
  test: 'Testing',
  remove: 'Removing',
  history: 'Loading history',
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

/** These acts show busy on the action button itself — no floating graph bar. */
const INLINE_BUSY_ACTS = new Set(['up', 'down', 'test', 'stash', 'stashPop', 'commit', 'pull', 'push', 'forcePush']);

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
  if (!op?.act || INLINE_BUSY_ACTS.has(op.act)) {
    bar.hidden = true;
    bar.innerHTML = '';
    el.body?.classList.remove('is-busy');
    return;
  }
  el.body?.classList.add('is-busy');
  bar.hidden = false;
  const label = OP_LABELS[op.act] || 'Working';
  const detail = op.detail
    ? `<span class="detail" title="${esc(op.detail)}">${esc(op.detail)}</span>`
    : '';
  bar.innerHTML = `<i class="spinner" aria-hidden="true"></i><span class="label">${esc(label)}</span>${detail}`;
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
  maybeStartTour();
  maybePromptProtected(board);
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

/** First open: explain Protected and confirm (or change) the team branch. */
function maybePromptProtected(board) {
  if (!board?.root || state.settings.open || state.branchOverview.open || el.sheetLayer?.childElementCount) return;
  const ov = state.prefs.repoOverrides?.[board.root] || {};
  if (ov.protectedPicked || board.teamBranchSource === 'override') return;
  if (state._protectedPromptRoot === board.root) return;
  state._protectedPromptRoot = board.root;
  openProtectedPicker(board);
}

async function markProtectedPicked(root) {
  const next = { ...(state.prefs.repoOverrides || {}) };
  next[root] = { ...(next[root] || {}), protectedPicked: true };
  await invoke('prefs.set', { repoOverrides: next });
  state.prefs.repoOverrides = next;
}

function openProtectedPicker(board) {
  const locals = (board.branches || []).filter((b) => !b.remote).map((b) => b.short || b.name);
  const names = [...new Set([board.teamBranch, ...locals].filter(Boolean))];
  const opts = names.map((n) => `<option value="${esc(n)}"${n === board.teamBranch ? ' selected' : ''}>${esc(n)}</option>`).join('');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="prot-title">
      <div class="eyebrow">${iconHTML('shield-check', 'sm')}Protected branch</div>
      <h1 id="prot-title">Which branch do you integrate into?</h1>
      <p>Protected is a role, not a lock. You still commit and push on it. Behind counts default to this tip. Lanes Start on their own ports once you write a recipe.</p>
      <label class="field">Branch<select name="branch" class="select mono" required>${opts}</select></label>
      <div class="row-end">
        <button class="btn" type="button" data-prot-later>Not now</button>
        <button class="btn primary" type="submit">${iconHTML('check-circle', 'sm')}Continue</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  form.querySelector('[data-prot-later]')?.addEventListener('click', async () => {
    try {
      await markProtectedPicked(board.root);
      closeSheet();
    } catch { /* toasted */ }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const branch = form.querySelector('[name=branch]').value.trim();
    const root = board.root;
    try {
      if (branch && branch !== board.teamBranch) {
        await invoke('repo.setTeamBranch', branch, root);
      }
      await markProtectedPicked(root);
      closeSheet();
      await refresh({ loud: false });
      toast(`Protected → ${branch || board.teamBranch}`, 'ok');
    } catch { /* toasted */ }
  });
}


function paint() {
  paintTabs();
  const overviewOpen = state.branchOverview.open;
  el.settings.hidden = !state.settings.open;
  if (el.branchOverview) el.branchOverview.hidden = !overviewOpen;
  el.body.classList.toggle('settings-open', state.settings.open);
  el.body.classList.toggle('branch-overview-open', overviewOpen);
  if (state.settings.open) {
    // Settings owns the body; the board repaints on close.
    closeRunLog();
    for (const n of [el.empty, el.loading, el.laneHead, el.panel, el.main, el.changes]) n.hidden = true;
    if (el.branchOverview) el.branchOverview.hidden = true;
    return;
  }
  if (overviewOpen) {
    closeRunLog();
    for (const n of [el.empty, el.loading, el.laneHead, el.panel, el.main, el.changes]) n.hidden = true;
    renderBranchOverview();
    return;
  }
  const tab = activeTab();
  // Empty state is only for "no tabs". A selected tab without a board yet is loading -
  // never the "Open a repository" marketing empty (that was the dogfood bug).
  if (!tab) {
    el.empty.hidden = false;
    el.loading.hidden = true;
    el.laneHead.hidden = true;
    el.panel.hidden = true;
    el.main.hidden = true;
    closeChanges();
    closeRunLog();
    return;
  }
  if (!state.board) {
    el.empty.hidden = true;
    el.laneHead.hidden = true;
    el.panel.hidden = true;
    el.main.hidden = true;
    closeChanges();
    closeRunLog();
    el.loading.hidden = false;
    if (!state.loading) {
      el.loadingTitle.textContent = 'Opening repository…';
      el.loadingPath.textContent = tab.path || '';
    }
    return;
  }
  el.empty.hidden = true;
  el.loading.hidden = true;
  el.laneHead.hidden = false;
  el.panel.hidden = false;
  el.main.hidden = false;
  paintPanel();
  paintHeader();
  paintBoardGraph();
  if (state.changes) paintChanges();
  // Drawer picks its own lane via the header select — do not snap to board selection.
  if (state.runLog) paintRunLog().catch(() => {});
  const op = state.opsByTab.get(state.store.activeId);
  if (op?.act) setActionBusy(op.act, true);
}

let olderObserver = null;
let olderScrollBound = null;
let olderRetryTimer = null;
let olderFailStreak = 0;
/** Overlay a thin scrollbar — no reserved gutter; only while scrolling. */
function bindOverlayScrollThumb(scroller, host, thumbClass) {
  if (!scroller || !host) return;
  let thumb = host.querySelector(`:scope > .${thumbClass}`);
  if (!thumb) {
    thumb = document.createElement('div');
    thumb.className = thumbClass;
    thumb.setAttribute('aria-hidden', 'true');
    host.appendChild(thumb);
  }
  // Rows persist across paints; panel-scroll is recreated — skip only when already bound.
  if (scroller.dataset.overlayScrollBound === thumbClass) return;
  scroller.dataset.overlayScrollBound = thumbClass;

  let hideTimer = null;
  const syncThumb = () => {
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    if (scrollHeight <= clientHeight + 1) {
      thumb.classList.remove('is-visible');
      return;
    }
    const topOffset = scroller.offsetTop;
    const trackH = clientHeight;
    const thumbH = Math.max(20, Math.round(trackH * (clientHeight / scrollHeight)));
    const maxTop = Math.max(0, trackH - thumbH);
    const range = scrollHeight - clientHeight;
    const top = topOffset + (range > 0 ? (scrollTop / range) * maxTop : 0);
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
    thumb.classList.add('is-visible');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      thumb.classList.remove('is-visible');
      hideTimer = null;
    }, 900);
  };

  scroller.addEventListener('scroll', syncThumb, { passive: true });
}

function bindGraphScrollReveal(rowsEl) {
  const graph = rowsEl?.closest('.graph') || el.graph;
  bindOverlayScrollThumb(rowsEl, graph, 'graph-scroll-thumb');
}

function bindPanelScrollReveal(scrollEl) {
  bindOverlayScrollThumb(scrollEl, el.panel, 'panel-scroll-thumb');
}

/** True when the graph scroller is within `px` of the bottom (load-older trigger). */
function nearOlderBottom(rowsEl, px = 96) {
  if (!rowsEl) return false;
  return rowsEl.scrollHeight - rowsEl.scrollTop - rowsEl.clientHeight < px;
}

function detachOlderSentinel() {
  if (olderObserver) {
    olderObserver.disconnect();
    olderObserver = null;
  }
  if (olderScrollBound) {
    olderScrollBound.el.removeEventListener('scroll', olderScrollBound.fn);
    olderScrollBound = null;
  }
  if (olderRetryTimer) {
    clearTimeout(olderRetryTimer);
    olderRetryTimer = null;
  }
}

function scheduleOlderRetry(ms = 250, { afterFail = false } = {}) {
  if (olderRetryTimer) return;
  if (afterFail && olderFailStreak >= 5) return;
  olderRetryTimer = setTimeout(() => {
    olderRetryTimer = null;
    loadOlderHistory();
  }, ms);
}

function attachOlderSentinel(rowsEl) {
  detachOlderSentinel();
  olderFailStreak = 0;
  if (!rowsEl || !state.board?.commits?.length) return;

  // End of local history — say so clearly instead of a silent dead stop.
  if (!state.board.historyHasMore) {
    const end = document.createElement('div');
    end.className = 'load-older history-end';
    end.dataset.historyEnd = '1';
    end.setAttribute('role', 'status');
    end.innerHTML = '<span>End of history</span>';
    rowsEl.appendChild(end);
    return;
  }

  const foot = document.createElement('div');
  foot.className = 'load-older';
  foot.dataset.loadOlder = '1';
  foot.setAttribute('aria-live', 'polite');
  // Keep a real node so the sentinel has layout; empty flex boxes can miss IO in Electron.
  foot.innerHTML = state.loadingOlder
    ? `<i class="spinner btn-spin" aria-hidden="true"></i><span>Loading older…</span>`
    : '<span class="sr-only">Load older commits</span>';
  rowsEl.appendChild(foot);

  const tryLoad = () => {
    if (nearOlderBottom(rowsEl)) loadOlderHistory();
  };

  // rootMargin pulls the trigger early so the last rows aren't a dead zone.
  olderObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadOlderHistory();
  }, { root: rowsEl, rootMargin: '0px 0px 96px 0px', threshold: 0 });
  olderObserver.observe(foot);

  // Backup: IO does not re-fire if the foot stays intersecting after a failed/busy attempt.
  const onScroll = () => tryLoad();
  rowsEl.addEventListener('scroll', onScroll, { passive: true });
  olderScrollBound = { el: rowsEl, fn: onScroll };

  requestAnimationFrame(tryLoad);
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
  const oldIds = state.store.tabs.map((t) => t.id);
  const store = await invoke('tabs.reorder', tabs.map((t) => t.id));
  applyStore(store);
  paintTabs();
  pushUndo('move tab', null, async () => {
    applyStore(await invoke('tabs.reorder', oldIds));
    paintTabs();
  });
  toast('Moved tab', 'ok', { undo: true });
}

/** Spare room tabs should keep before we reclaim the search label. */
const SEARCH_COLLAPSE_CUSHION = 48;
let searchLabelWidth = 0;

function tabsPreferredWidth() {
  const scroller = el.tabstripScroll;
  if (!scroller) return 0;
  const gap = parseFloat(getComputedStyle(scroller).gap) || 0;
  const tabs = scroller.querySelectorAll('.tab');
  let need = 0;
  for (const n of tabs) need += n.offsetWidth;
  if (tabs.length > 1) need += gap * (tabs.length - 1);
  if (el.tabAdd) {
    const stripGap = el.tabstrip ? (parseFloat(getComputedStyle(el.tabstrip).gap) || 0) : gap;
    need += el.tabAdd.offsetWidth + stripGap;
  }
  return need;
}

/** Collapse the palette label when open tabs need the room; expand when they don't. */
function syncSearchCollapse() {
  const btn = el.searchbtn;
  if (!btn) return;
  const label = btn.querySelector('span');
  if (label && !btn.classList.contains('compact')) {
    const gap = parseFloat(getComputedStyle(btn).gap) || 0;
    searchLabelWidth = label.offsetWidth + gap;
  }
  const labelW = searchLabelWidth || 160;
  const need = tabsPreferredWidth();
  const avail = el.tabstrip.clientWidth;
  if (btn.classList.contains('compact')) {
    if (need + SEARCH_COLLAPSE_CUSHION <= avail - labelW) btn.classList.remove('compact');
  } else if (need + SEARCH_COLLAPSE_CUSHION > avail) {
    btn.classList.add('compact');
  }
  syncTabScrollFades();
}

/**
 * Max scroll from tab boxes only. Active-tab ear ::before/::after are absolute and
 * inflate scrollWidth, which used to flash the left arrow on the rightmost tab.
 */
function tabStripScrollMax(scroller = el.tabstripScroll) {
  if (!scroller) return 0;
  const tabs = scroller.querySelectorAll('.tab');
  if (!tabs.length) return 0;
  const last = tabs[tabs.length - 1];
  const padRight = parseFloat(getComputedStyle(scroller).paddingRight) || 0;
  return Math.max(0, last.offsetLeft + last.offsetWidth + padRight - scroller.clientWidth);
}

function syncTabScrollFades() {
  const scroller = el.tabstripScroll;
  if (!scroller) return;
  const max = tabStripScrollMax(scroller);
  // Pin to start when tabs fit; ear overhang can leave a stray scrollLeft.
  if (max <= 2 && scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
  const canLeft = max > 2 && scroller.scrollLeft > 2;
  const canRight = max > 2 && scroller.scrollLeft < max - 2;
  if (el.tabScrollPrev) el.tabScrollPrev.hidden = !canLeft;
  if (el.tabScrollNext) el.tabScrollNext.hidden = !canRight;
  if (el.tabstripEdgeLeft) el.tabstripEdgeLeft.hidden = !canLeft;
  if (el.tabstripEdgeRight) el.tabstripEdgeRight.hidden = !canRight;
  el.tabstrip?.classList.toggle('has-scroll', canLeft || canRight);
}

function scrollTabsBy(dir) {
  const scroller = el.tabstripScroll;
  if (!scroller) return;
  const step = Math.max(120, Math.round(scroller.clientWidth * 0.7));
  scroller.scrollBy({ left: dir * step, behavior: 'smooth' });
}

function scrollActiveTabIntoView() {
  const scroller = el.tabstripScroll;
  const active = scroller?.querySelector('.tab.active');
  if (!scroller || !active) {
    syncTabScrollFades();
    return;
  }
  const max = tabStripScrollMax(scroller);
  if (max <= 2) {
    if (scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
    syncTabScrollFades();
    return;
  }
  // Manual nearest-inline scroll so absolute ears / scroll-padding don't nudge.
  const sRect = scroller.getBoundingClientRect();
  const tRect = active.getBoundingClientRect();
  const pad = 8;
  if (tRect.left < sRect.left + pad) {
    scroller.scrollLeft -= (sRect.left + pad) - tRect.left;
  } else if (tRect.right > sRect.right - pad) {
    scroller.scrollLeft += tRect.right - (sRect.right - pad);
  }
  syncTabScrollFades();
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
    btn.appendChild(tabGlyph(t));
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = t.title;
    btn.appendChild(title);
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
      el.tabstripScroll.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach((n) => {
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
      el.tabstripScroll.querySelectorAll('.tab').forEach((n) => {
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
  el.tabstripScroll.replaceChildren(frag);

  requestAnimationFrame(() => {
    syncSearchCollapse();
    scrollActiveTabIntoView();
  });
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
    if (wasActive) {
      snapshotWarm(tab.id);
      state.switchSeq += 1;
    }
    dropWarm(tab.id);
    state.opsByTab.delete(tab.id);
    state.refreshingByTab.delete(tab.id);
    state.loudRefreshByTab.delete(tab.id);
    const before = { ...tab };
    pushTabRestoreUndo(before, `close ${tab.title}`);
    const res = await invoke('tabs.close', tab.id);
    applyStore(res.store);
    toast(`Closed ${tab.title}`, 'ok', { undo: true });
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
    if (state.settings.open) syncSettingsAfterTabSwitch();
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
  const autoOn = state.prefs.tabFavicons !== false;
  // 'auto' | 'image' | preset name
  let chosen = tab.iconManual
    ? (tab.favicon && autoOn ? 'image' : (tab.icon || 'folder-simple'))
    : (autoOn ? 'auto' : (tab.icon || 'folder-simple'));
  let saving = false;
  let pickingImage = false;
  const wrap = document.createElement('div');
  wrap.className = 'tab renaming';
  wrap.setAttribute('aria-label', 'Renaming repository tab');
  wrap.dataset.id = tab.id;
  const imgGlyph = (src) => {
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.alt = '';
    img.draggable = false;
    img.src = src;
    return img;
  };
  const autoGlyph = () => {
    if (tab.favicon && autoOn) return imgGlyph(tab.favicon);
    return icon(tab.icon || 'folder-simple', 'sm');
  };
  const previewGlyph = () => {
    if (chosen === 'auto') return autoGlyph();
    if (chosen === 'image' && tab.favicon) return imgGlyph(tab.favicon);
    return icon(chosen, 'sm');
  };
  const syncPreview = () => {
    wrap.replaceChildren(previewGlyph(), input);
    paintIcons();
  };
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = tab.title;
  input.setAttribute('aria-label', 'Repository display name');
  input.spellcheck = false;
  wrap.appendChild(previewGlyph());
  wrap.appendChild(input);

  const pop = document.createElement('div');
  pop.className = 'rename-pop';
  const grid = document.createElement('div');
  grid.className = 'icon-grid inline';
  const paintIcons = () => {
    grid.replaceChildren();
    if (autoOn) {
      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = 'icon-auto';
      autoBtn.title = 'Auto: use repo favicon when found';
      autoBtn.setAttribute('aria-label', 'Auto: use repo favicon when found');
      if (chosen === 'auto') autoBtn.classList.add('on');
      autoBtn.appendChild(autoGlyph());
      const tag = document.createElement('span');
      tag.className = 'icon-auto-tag';
      tag.textContent = 'A';
      autoBtn.appendChild(tag);
      autoBtn.addEventListener('mousedown', (e) => e.preventDefault());
      autoBtn.addEventListener('click', () => {
        chosen = 'auto';
        syncPreview();
        input.focus();
      });
      grid.appendChild(autoBtn);
      if (chosen === 'image' && tab.favicon) {
        const imgBtn = document.createElement('button');
        imgBtn.type = 'button';
        imgBtn.className = 'icon-auto';
        imgBtn.title = 'Custom image from repo';
        imgBtn.setAttribute('aria-label', 'Custom image from repo');
        imgBtn.classList.add('on');
        imgBtn.appendChild(imgGlyph(tab.favicon));
        imgBtn.addEventListener('mousedown', (e) => e.preventDefault());
        grid.appendChild(imgBtn);
      }
    }
    for (const name of TAB_ICONS) {
      const b = document.createElement('button');
      b.type = 'button';
      if (name === chosen) b.classList.add('on');
      b.appendChild(icon(name, 'sm'));
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on input
      b.addEventListener('click', () => {
        chosen = name;
        syncPreview();
        input.focus();
      });
      grid.appendChild(b);
    }
  };
  paintIcons();
  pop.appendChild(grid);
  if (autoOn) {
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'rename-pick-image';
    pick.textContent = 'Choose image from repo…';
    pick.addEventListener('mousedown', (e) => e.preventDefault());
    pick.addEventListener('click', async () => {
      pickingImage = true;
      document.removeEventListener('mousedown', off);
      pop.remove();
      const title = input.value.trim() || tab.title;
      wrap.replaceWith(btn);
      try {
        if (title !== tab.title) applyStore(await invoke('tabs.rename', tab.id, title));
      } catch { /* toasted */ }
      paintTabs();
      const fresh = state.store.tabs.find((t) => t.id === tab.id) || tab;
      await openTabImageSheet(fresh);
    });
    pop.appendChild(pick);
  }
  document.body.appendChild(pop);
  const placePop = () => {
    const r = wrap.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.zIndex = '40';
  };

  const finish = async (commit) => {
    if (saving || pickingImage) return;
    saving = true;
    document.removeEventListener('mousedown', off);
    pop.remove();
    if (!commit) {
      wrap.replaceWith(btn);
      return;
    }
    const nextTitle = input.value.trim() || tab.title;
    // Optimistic: put the real tab back immediately so rename doesn't stutter (#85).
    const titleNode = btn.querySelector('.tab-title');
    if (titleNode) titleNode.textContent = nextTitle;
    wrap.replaceWith(btn);
    try {
      let iconArg;
      if (chosen === 'image') iconArg = undefined; // already applied via tabs.setImage
      else if (chosen === 'auto') iconArg = tab.iconManual ? 'auto' : undefined;
      else if (chosen !== (tab.icon || 'folder-simple') || !tab.iconManual || tab.favicon) iconArg = chosen;
      const store = await invoke('tabs.rename', tab.id, nextTitle, iconArg);
      applyStore(store);
      if (tabLook(store.tabs.find((t) => t.id === tab.id)) !== tabLook(tab)) {
        pushTabRestoreUndo({ ...tab }, 'rename tab');
        toast('Renamed tab', 'ok', { undo: true });
      }
      // Rebuild only when glyph/look changed; title already matches the strip.
      if (iconArg != null) paintTabs();
    } catch {
      paintTabs();
    }
  };
  const off = (ev) => {
    if (wrap.contains(ev.target) || pop.contains(ev.target)) return;
    if (el.sheetLayer?.classList.contains('open')) return;
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

/** Modal: pick a PNG / JPEG / SVG from the checkout as the tab icon. */
async function openTabImageSheet(tab) {
  openSheet(`
    <form class="modal wide" role="dialog" aria-labelledby="tab-img-title">
      <div class="eyebrow">${iconHTML('globe-simple', 'sm')}Tab icon</div>
      <h1 id="tab-img-title">Choose an image</h1>
      <p>PNG, JPEG, or SVG in this repo. Names with icon / logo / glyph rise to the top. Skips node_modules and build folders.</p>
      <div class="tab-image-scroll" data-tab-images>
        <div class="muted">Scanning…</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
      </div>
    </form>`);
  const root = el.sheetLayer.querySelector('[data-tab-images]');
  let images = [];
  try {
    images = await invoke('tabs.listImages', tab.id);
  } catch {
    root.innerHTML = `<div class="muted">Couldn’t scan the repo.</div>`;
    return;
  }
  if (!images.length) {
    root.innerHTML = `<div class="muted">No PNG, JPEG, or SVG found. Drop a logo.png or favicon.svg in the project.</div>`;
    return;
  }
  const suggested = images.filter((x) => x.suggested);
  const rest = images.filter((x) => !x.suggested);
  const mountSection = (title, items) => {
    if (!items.length) return;
    const head = document.createElement('div');
    head.className = 'tab-image-section';
    head.textContent = title;
    root.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'tab-image-grid';
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-image-opt';
      b.title = item.rel;
      b.setAttribute('aria-label', item.rel);
      const img = document.createElement('img');
      img.src = item.fileUrl;
      img.alt = '';
      b.appendChild(img);
      const cap = document.createElement('span');
      cap.textContent = item.rel;
      b.appendChild(cap);
      b.addEventListener('click', async () => {
        try {
          const before = { ...(state.store.tabs.find((t) => t.id === tab.id) || tab) };
          applyStore(await invoke('tabs.setImage', tab.id, item.rel));
          closeSheet();
          paintTabs();
          pushTabRestoreUndo(before, 'tab icon');
          toast('Tab icon updated', 'ok', { undo: true });
        } catch { /* toasted */ }
      });
      grid.appendChild(b);
    }
    root.appendChild(grid);
  };
  root.replaceChildren();
  mountSection('Suggested', suggested);
  if (rest.length) mountSection(suggested.length ? 'All' : 'Images', rest);
  else if (!suggested.length) mountSection('Images', images);
}


function laneRowHTML(l, b, selected) {
  const enter = state.enteringLanes.has(l.index) ? ' enter' : '';
  const flash = state.flashMarks.has(l.index) ? ' flash' : '';
  const run = l.running ? ' running' : '';
  const runTitle = l.running ? ' Running.' : '';
  let mark;
  if (l.readiness === 'working') mark = `<span class="mark working${flash}${run}" title="Working: uncommitted changes.${runTitle}"><i></i></span>`;
  else if (l.readiness === 'safe') mark = `<span class="mark safe${flash}${run}" title="Safe to remove: merged, tree clean.${runTitle}">${iconHTML('check-circle')}</span>`;
  else mark = `<span class="mark unmerged${flash}${run}" title="Not merged yet.${runTitle}"><i></i></span>`;
  const meta = l.readiness === 'safe'
    ? `<span class="meta ok">merged</span>`
    : l.behind > 0
      ? `<span class="meta ${l.behind >= 2 ? 'bad' : 'warn'}" title="${l.behind} commits behind ${esc(b.teamRef)}">${iconHTML('cloud-arrow-down', 'sm')}${l.behind} behind</span>`
      : `<span class="meta"></span>`;
  const folder = l.folder ? `<span class="folder">${esc(l.folder)}</span>` : '';
  const isSelected = l.index === selected;
  return `<div class="lane-block${isSelected ? ' selected' : ''}">
    <button class="lane-row${enter}${isSelected ? ' selected' : ''}" type="button" data-lane="${l.index}" aria-pressed="${isSelected}" title="${esc(l.name)}">
      ${mark}<span class="lane-main"><span class="name">${esc(l.name)}</span>${meta}${laneAgentsHTML(l)}</span>${folder}
    </button>
    ${isSelected ? laneRunHTML(l) : ''}
  </div>`;
}

function paintPanel() {
  const b = state.board;
  const selected = state.selectedLane;
  const primary = b.lanes[0];
  const rest = b.lanes.slice(1);
  const hasManifest = Boolean(b.hasManifest);
  // Lanes = prepared worktrees (recipe applied). Worktrees = not opened as lane yet.
  const laneList = hasManifest ? rest.filter((l) => l.prepared) : [];
  const worktrees = hasManifest
    ? rest.filter((l) => !l.prepared)
    : rest;
  const markPrimary = primary.alert
    ? `${iconHTML('warning-circle')}`
    : `${iconHTML('shield-check')}`;
  const primarySelected = selected === 0;
  const q = state.branchFilter.trim().toLowerCase();
  const matchLane = (l) => !q
    || String(l.name || '').toLowerCase().includes(q)
    || String(l.branch || '').toLowerCase().includes(q)
    || String(l.folder || '').toLowerCase().includes(q);
  const visibleLanes = laneList.filter(matchLane);
  const visibleWorktrees = worktrees.filter(matchLane);
  const lanesOpen = state.lanesOpen || !!q;
  const worktreesOpen = state.worktreesOpen || !!q;
  let html = `<div class="section section-protected">
    <div class="lane-block${primarySelected ? ' selected' : ''}">
      <button class="lane-row ${primarySelected ? 'selected' : ''}" type="button" data-lane="0" title="Protected · Integration branch. You still commit and push here; Start works when the repo has a lane recipe.">
        <span class="mark protected ${primary.alert ? 'alert' : ''}">${markPrimary}</span>
        <span class="lane-main"><span class="name" title="${esc(primary.name)}">${esc(primary.name)}</span><span class="meta ${primary.dirty ? 'bad' : 'ok'}">${primary.dirty ? `${primary.dirty} uncommitted` : 'clean'}</span>${laneAgentsHTML(primary)}</span>
      </button>
      ${primarySelected ? laneRunHTML(primary) : ''}
    </div>
  </div>`;

  html += `<div class="section branch-search">
    <label class="branch-search-box">${iconHTML('magnifying-glass', 'sm')}<input type="search" data-branch-filter value="${esc(state.branchFilter)}" placeholder="Filter" aria-label="Filter lanes, worktrees, and branches" spellcheck="false" autocomplete="off" /></label>
  </div>`;

  // Count already says 0 — skip the redundant "None" label; keep real CTAs / filter misses.
  const emptyNote = (msg) => (msg ? `<div class="empty-note">${msg}</div>` : '');
  const lanesEmpty = q
    ? 'No match'
    : (hasManifest
      ? ''
      : `<button class="env-link" type="button" data-act="doctor">${iconHTML('gear-six', 'sm')}Lane setup first</button>`);
  const lanesBody = visibleLanes.length
    ? visibleLanes.map((l) => laneRowHTML(l, b, selected)).join('')
    : emptyNote(lanesEmpty);
  html += `<div class="section section-accordion">
    <div class="branch-head">
      <button class="lane-row branch-toggle" type="button" data-lanes aria-expanded="${lanesOpen}" title="Worktrees with Plenum runner setup.">
        <span class="mark">${iconHTML('caret-right')}</span>
        <span class="section-icon">${iconHTML('stack', 'sm')}</span>
        <span class="name">Lanes</span>
        <span class="meta">${visibleLanes.length}</span>
      </button>
      <button class="iconbtn add" type="button" data-new-lane aria-label="New lane from main">${iconHTML('plus', 'sm')}</button>
    </div>
    <div class="section-body"${lanesOpen ? '' : ' hidden'}>${lanesBody}</div>
  </div>`;

  const worktreesBody = visibleWorktrees.length
    ? visibleWorktrees.map((l) => {
      const isSelected = l.index === selected;
      const cta = hasManifest
        ? `<button class="btn primary" type="button" data-act="openAsLane">${iconHTML('play', 'sm')}Open as lane</button>`
        : laneSetupLink();
      return `<div class="lane-block${isSelected ? ' selected' : ''}">
        <button class="lane-row${isSelected ? ' selected' : ''}" type="button" data-lane="${l.index}" aria-pressed="${isSelected}" title="${esc(l.name)}">
          <span class="mark">${iconHTML('git-branch')}</span>
          <span class="lane-main"><span class="name">${esc(l.name)}</span><span class="meta">not a lane</span></span>
          ${l.folder ? `<span class="folder">${esc(l.folder)}</span>` : ''}
        </button>
        ${isSelected ? `<div class="lane-run">${cta}</div>` : ''}
      </div>`;
    }).join('')
    : emptyNote(q ? 'No match' : '');
  html += `<div class="section section-accordion">
    <button class="lane-row branch-toggle" type="button" data-worktrees aria-expanded="${worktreesOpen}" title="Worktrees without runner setup yet.">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="section-icon">${iconHTML('tree-structure', 'sm')}</span>
      <span class="name">Worktrees</span>
      <span class="meta">${visibleWorktrees.length}</span>
    </button>
    <div class="section-body"${worktreesOpen ? '' : ' hidden'}>${worktreesBody}</div>
  </div>`;

  const allBranches = b.branches || [];
  const matches = (br) => !q || br.name.toLowerCase().includes(q);
  const locals = allBranches.filter((br) => !br.remote && matches(br));
  const remotes = allBranches.filter((br) => br.remote && matches(br));
  const refreshing = state.loudRefreshByTab.has(state.store.activeId);
  const localBody = locals.length
    ? renderBranchListHTML(locals, b, selected, refreshing)
    : emptyNote(q ? 'No match' : '');
  const remoteBody = remotes.length
    ? renderBranchListHTML(remotes, b, selected, refreshing, true)
    : emptyNote(q ? 'No match' : '');
  const vsRef = branchVsRef(b);
  const branchMeta = refreshing
    ? `<i class="spinner btn-spin" aria-hidden="true"></i><span class="sr-only">Refreshing</span>`
    : `${locals.length}`;
  const remoteMeta = refreshing
    ? `<i class="spinner btn-spin" aria-hidden="true"></i><span class="sr-only">Refreshing</span>`
    : `${remotes.length}`;
  const origin = b.origin;
  if (origin && (origin.status === 'missing' || origin.status === 'renamed' || origin.status === 'none')) {
    const label = origin.status === 'none'
      ? 'No origin remote set'
      : origin.status === 'renamed'
        ? `Origin moved: ${esc(origin.display)}${origin.effectiveDisplay ? ` → ${esc(origin.effectiveDisplay)}` : ''}`
        : `Origin URL is stale: ${esc(origin.display || 'unknown')}`;
    html += `<div class="section">
      <div class="remote-alert" title="${esc(origin.detail || label)}">${iconHTML('warning-circle', 'sm')}<span>${label}</span></div>
    </div>`;
  }
  html += `<div class="section section-accordion section-branches${refreshing ? ' is-refreshing' : ''}">
    <div class="branch-head">
    <button class="lane-row branch-toggle" type="button" data-branches aria-expanded="${state.branchesOpen || !!q}" title="Local tips. ↓↑ ${vsRef ? `vs ${esc(vsRef)}` : 'only when drifted from upstream (origin/…)'}. Vs protected tip stays on the lane header.">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="section-icon">${iconHTML('desktop', 'sm')}</span>
      <span class="name">Local</span>
      <span class="meta">${branchMeta}</span>
    </button>
    ${branchVsSelectHTML(b)}
    </div>
    <div class="branch-list${refreshing ? ' is-refreshing' : ''}"${state.branchesOpen || q ? '' : ' hidden'} aria-busy="${refreshing ? 'true' : 'false'}">${localBody}</div>
  </div>`;
  html += `<div class="section section-accordion section-branches${refreshing ? ' is-refreshing' : ''}">
    <button class="lane-row branch-toggle" type="button" data-remotes aria-expanded="${state.remotesOpen || !!q}" title="Tips that exist only on the remote. Tracking remotes like origin/${esc(b.teamBranch || 'main')} live under Local once you have a local tip.">
      <span class="mark">${iconHTML('caret-right')}</span>
      <span class="section-icon">${iconHTML('cloud', 'sm')}</span>
      <span class="name">Remote</span>
      <span class="meta">${remoteMeta}</span>
    </button>
    <div class="branch-list${refreshing ? ' is-refreshing' : ''}"${state.remotesOpen || q ? '' : ' hidden'} aria-busy="${refreshing ? 'true' : 'false'}">${remoteBody}</div>
  </div>`;

  closeSelectMenus();
  el.panel.innerHTML = `<div class="panel-scroll">${html}</div>${panelFootHTML()}`;
  el.panel.classList.toggle('is-refreshing', refreshing);
  enhanceSelects(el.panel);
  el.panel.querySelector('[data-settings]')?.addEventListener('click', () => openSettings());
  el.panel.querySelector('[data-feedback]')?.addEventListener('click', () => openFeedbackSheet());
  bindUpdateAct(el.panel);
  el.panel.querySelectorAll('[data-lane]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedLane = Number(btn.dataset.lane);
      paint();
    });
    btn.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-act]')) return;
      e.preventDefault();
      e.stopPropagation();
      const lane = laneByIndex(Number(btn.dataset.lane));
      if (lane) openLaneCtxMenu(e.clientX, e.clientY, lane);
    });
  });
  el.panel.querySelectorAll('.lane-run [data-act], .empty-note [data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.act === 'doctor') {
        openLaneSetup();
        return;
      }
      const lane = laneByIndex(state.selectedLane);
      if (!lane) return;
      if (btn.dataset.act === 'servicesMenu') {
        openServicesMenu(btn, lane);
        return;
      }
      handleAction(btn.dataset.act, lane, btn.dataset.url);
    });
  });
  el.panel.querySelector('[data-new-lane]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateLane();
  });
  el.panel.querySelector('[data-lanes]')?.addEventListener('click', () => {
    state.lanesOpen = !state.lanesOpen;
    paint();
  });
  el.panel.querySelector('[data-worktrees]')?.addEventListener('click', () => {
    state.worktreesOpen = !state.worktreesOpen;
    paint();
  });
  el.panel.querySelector('[data-branches]')?.addEventListener('click', () => {
    state.branchesOpen = !state.branchesOpen;
    paint();
  });
  el.panel.querySelector('[data-branch-filter]')?.addEventListener('input', (e) => {
    state.branchFilter = e.target.value;
    const pos = e.target.selectionStart;
    paint();
    const inp = el.panel.querySelector('[data-branch-filter]');
    inp?.focus();
    inp?.setSelectionRange(pos, pos);
  });
  el.panel.querySelector('[data-branch-vs]')?.addEventListener('change', (e) => {
    setBranchVs(b.root, e.target.value);
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
      const set = key.startsWith('r:') ? state.openRemoteFolders : state.collapsedBranchFolders;
      if (set.has(key)) set.delete(key);
      else set.add(key);
      paint();
    });
  });
  el.panel.querySelectorAll('[data-branch-name]').forEach((btn) => {
    // Left-click is inert — switch / check out / open as lane live on the context menu (#126).
    btn.addEventListener('click', (e) => { e.stopPropagation(); });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBranchCtxMenu(e.clientX, e.clientY, btn.dataset.branchName);
    });
  });
  layout.remountRails();
  bindPanelScrollReveal(el.panel.querySelector('.panel-scroll'));
}

// #117 pinned branches per repo (right-click → Pin to top). Per-viewer convenience, like the baseline pick.
const BRANCH_PINS_KEY = 'plenum.branchPins';

function branchPins(root) {
  try { return JSON.parse(localStorage.getItem(BRANCH_PINS_KEY) || '{}')?.[root] || []; } catch { return []; }
}

function toggleBranchPin(root, name) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(BRANCH_PINS_KEY) || '{}') || {}; } catch { /* fresh */ }
  const cur = all[root] || [];
  all[root] = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
  if (!all[root].length) delete all[root];
  try { localStorage.setItem(BRANCH_PINS_KEY, JSON.stringify(all)); } catch { /* session only */ }
}

// #46 - which tip the branch list counts against. '' = each branch's upstream (default).
const BRANCH_VS_KEY = 'plenum.branchVs';

function readBranchVs() {
  try { return JSON.parse(localStorage.getItem(BRANCH_VS_KEY) || '{}') || {}; } catch { return {}; }
}

function setBranchVs(root, name) {
  const all = readBranchVs();
  if (name) all[root] = name;
  else delete all[root];
  try { localStorage.setItem(BRANCH_VS_KEY, JSON.stringify(all)); } catch { /* session only */ }
}

/** Chosen baseline name for this repo, or '' for upstream. Only offered once an extra baseline is configured. */
function branchVs(board) {
  if (!board?.baselines?.length) return '';
  const v = readBranchVs()[board.root] || '';
  return v === board.teamBranch || board.baselines.some((x) => x.name === v) ? v : '';
}

/** Resolved ref (origin/demo) for the chosen baseline, or '' for upstream. */
function branchVsRef(board) {
  const v = branchVs(board);
  if (!v) return '';
  return v === board.teamBranch ? board.teamRef : board.baselines.find((x) => x.name === v).ref;
}

function branchVsSelectHTML(board) {
  if (!board?.baselines?.length) return '';
  const cur = branchVs(board);
  const opt = (value, label) => `<option value="${esc(value)}"${value === cur ? ' selected' : ''}>${esc(label)}</option>`;
  // #79/#80 clear label + body face; baselines also listed under Settings (#101)
  // #107 icon button over a native select: compact header, still keyboard/VoiceOver friendly.
  return `<label class="branch-vs-wrap${cur ? ' is-set' : ''}" title="↓↑ compare against: ${esc(cur || 'upstream')}. Add baselines in Settings → Repository.">
    ${iconHTML('arrows-left-right', 'sm')}${cur ? `<span class="branch-vs-label">${esc(cur)}</span>` : ''}
    <select class="branch-vs" data-branch-vs aria-label="Count branches ahead and behind against">
      ${opt('', 'upstream')}${opt(board.teamBranch, board.teamBranch)}${board.baselines.map((x) => opt(x.name, x.name)).join('')}
    </select>
  </label>`;
}

/** { behind, ahead, ref } vs the chosen baseline (or upstream); null when there is nothing to compare to. */
function branchDrift(br, board) {
  const vs = branchVs(board);
  if (!vs) {
    return br.upstream ? { behind: br.upstreamBehind || 0, ahead: br.upstreamAhead || 0, ref: br.upstream } : null;
  }
  if (br.remote) return null; // counts are only read for local tips
  const c = vs === board.teamBranch ? br : br.vs?.[vs];
  return c ? { behind: c.behind || 0, ahead: c.ahead || 0, ref: branchVsRef(board) } : null;
}

function branchMetaHTML(br, board) {
  // Branch list: vs upstream by default (pull/push); a named baseline when one is picked in the header (#46).
  const d = branchDrift(br, board);
  const bits = [];
  if (d?.behind) bits.push(`${d.behind}↓`);
  if (d?.ahead) bits.push(`${d.ahead}↑`);
  if (!bits.length) return `<span class="metas"></span>`;
  const cls = d.behind >= 3 ? 'bad' : d.behind ? 'warn' : '';
  return `<span class="metas"><span class="meta ${cls}" title="vs ${esc(d.ref)}">${esc(bits.join(' '))}</span></span>`;
}

function branchRowHTML(br, label, board, selectedLane, refreshing = false, pinned = false) {
  const where = br.isPrimary
    ? 'primary'
    : br.hasLane
      ? 'lane'
      : br.remote
        ? 'remote'
        : 'local';
  const current = laneByIndex(selectedLane);
  const isCurrent = (br.hasLane && br.laneIndex === selectedLane)
    || (!br.hasLane && current && (current.branch === br.name || current.branch === br.short));
  const drift = branchDrift(br, board);
  const title = [
    br.name,
    refreshing ? 'list refreshing' : null,
    isCurrent ? 'checked out here' : where,
    'Right-click to switch, check out, or open as lane',
    br.upstream ? `tracks ${br.upstream}` : 'no upstream',
    drift && (drift.behind || drift.ahead)
      ? `vs ${drift.ref}: ${drift.behind} behind, ${drift.ahead} ahead`
      : (drift ? `in sync with ${drift.ref}` : ''),
  ].filter(Boolean).join(' · ');
  const mark = isCurrent
    ? iconHTML('check-circle', 'sm current')
    : iconHTML(pinned ? 'push-pin' : br.remote ? 'cloud-arrow-down' : 'git-branch', 'sm');
  const kind = br.remote ? 'remote' : 'local';
  // #126 actions are right-click only (context menu); kind stays on the wrap for styling/copy
  return `<div class="branch-row-wrap${isCurrent ? ' current' : ''}${refreshing ? ' refreshing' : ''}${pinned ? ' pinned' : ''}" data-branch-kind="${kind}">
    <button class="lane-row branch-row${isCurrent ? ' selected current' : ''}${refreshing ? ' refreshing' : ''}" type="button" title="${esc(title)}" data-branch-name="${esc(br.name)}" aria-current="${isCurrent ? 'true' : 'false'}">
      ${mark}
      <span class="lane-main"><span class="name">${esc(label)}</span>${branchMetaHTML(br, board)}</span>
    </button>
  </div>`;
}

function renderBranchListHTML(branches, board, selectedLane, refreshing = false, remote = false) {
  // #117 pinned tips sit on top with their full name; the rest keep folders.
  const pins = branchPins(board.root);
  const pinned = branches.filter((br) => pins.includes(br.name)).sort((a, b) => pins.indexOf(a.name) - pins.indexOf(b.name));
  const { singles, folders } = groupBranchesByPrefix(branches.filter((br) => !pins.includes(br.name)));
  // #117 local: standalone tips first, then folders. Remote: folders first (#63), then tips.
  const foldersFirst = remote;
  const entries = [
    ...singles.map((s) => ({ kind: 'single', sort: s.label, ...s })),
    ...[...folders.keys()].map((key) => ({ kind: 'folder', sort: key, key, items: folders.get(key) })),
  ].sort((a, b) => (a.kind === b.kind ? a.sort.localeCompare(b.sort) : (a.kind === 'folder') === foldersFirst ? -1 : 1));
  const parts = pinned.map((br) => branchRowHTML(br, br.short || br.name.replace(/^origin\//, ''), board, selectedLane, refreshing, true));
  for (const entry of entries) {
    if (entry.kind === 'single') {
      parts.push(branchRowHTML(entry.br, entry.label, board, selectedLane, refreshing));
      continue;
    }
    const key = remote ? `r:${entry.key}` : entry.key;
    const open = state.branchFilter.trim() || (remote ? state.openRemoteFolders.has(key) : !state.collapsedBranchFolders.has(key));
    parts.push(`<button class="lane-row branch-folder" type="button" data-branch-folder="${esc(key)}" aria-expanded="${open}">
      <span class="mark">${iconHTML('folder-simple', 'sm')}</span>
      <span class="name">${esc(entry.key)}/</span>
      <span class="meta">${entry.items.length}</span>
    </button>`);
    if (open) {
      const kids = [...entry.items].sort((a, b) => a.label.localeCompare(b.label));
      parts.push(`<div class="branch-folder-kids">${kids.map(({ br, label }) => branchRowHTML(br, label, board, selectedLane, refreshing)).join('')}</div>`);
    }
  }
  return parts.join('');
}

/** Local branch tip for a lane (ahead/behind vs its upstream). */
function laneBranchTip(l) {
  return (state.board?.branches || []).find((x) => !x.remote && (x.name === l.branch || x.short === l.branch)) || null;
}

/** Local and upstream have diverged (typical after rebase) — needs an explicit force push. */
function laneDivergedFromUpstream(l) {
  const br = laneBranchTip(l);
  return Boolean(br && (br.upstreamAhead || 0) > 0 && (br.upstreamBehind || 0) > 0);
}

function gitActionsHTML(l) {
  // Fixed slots: Commit · Stash · Pop · Pull · Push (or Force push when diverged).
  const stashes = state.board?.stashCount || 0;
  const a = [];
  if (state.conflictRoot) {
    a.push(`<button class="btn" type="button" data-act="conflicts" title="Pick up the conflict walk">${iconHTML('warning-circle', 'sm')}Resolve conflicts</button>`);
  }
  // Keep data-act even when muted so busy overlays can reattach after paint.
  a.push(l.dirty
    ? `<button class="btn" type="button" data-act="commit" title="Commit on ${esc(l.name)}">${iconHTML('git-commit', 'sm')}Commit</button>`
    : `<button class="btn" type="button" data-act="commit" disabled title="Working tree clean">${iconHTML('git-commit', 'sm')}Commit</button>`);
  a.push(l.dirty
    ? `<button class="btn" type="button" data-act="stash" title="Stash uncommitted changes">${iconHTML('stack', 'sm')}Stash</button>`
    : `<button class="btn" type="button" data-act="stash" disabled title="Nothing to stash">${iconHTML('stack', 'sm')}Stash</button>`);
  a.push(stashes
    ? `<button class="btn" type="button" data-act="stashPop" title="Pop latest stash">${iconHTML('stack', 'sm')}Pop${stashes > 1 ? ` · ${stashes}` : ''}</button>`
    : `<button class="btn" type="button" data-act="stashPop" disabled title="No stash">${iconHTML('stack', 'sm')}Pop</button>`);
  const tip = laneBranchTip(l);
  const pullBehind = tip?.upstreamBehind || 0;
  const diverged = !l.isPrimary && laneDivergedFromUpstream(l);
  // When diverged (typical after rebase), Force push is the one next step — don't also light Pull.
  const pullTitle = diverged
    ? `Diverged from ${esc(tip?.upstream || 'upstream')}. Pull would re-merge the old remote tip — Force push is usually right after a rebase.`
    : `${pullBehind ? `${pullBehind} behind ${esc(tip.upstream)}. ` : ''}Pull ${esc(l.name)} (ff-only)`;
  a.push(`<button class="btn${pullBehind && !diverged ? ' primary' : ''}" type="button" data-act="pull" title="${pullTitle}">${iconHTML('cloud-arrow-down', 'sm')}Pull${pullBehind ? ` <span class="mono">${pullBehind}↓</span>` : ''}</button>`);
  if (diverged) {
    const up = tip?.upstream || 'upstream';
    const ahead = tip?.upstreamAhead || 0;
    const behind = tip?.upstreamBehind || 0;
    a.push(`<button class="btn danger" type="button" data-act="forcePush" title="Recommended after a rebase. Diverged from ${esc(up)} (${ahead}↑ ${behind}↓). Opens a confirm, then force-with-lease.">${iconHTML('warning-circle', 'sm')}Force push</button>`);
  } else {
    a.push(l.unpushed
      ? `<button class="btn" type="button" data-act="push" title="Push ${esc(l.name)} to origin">${iconHTML('arrow-up', 'sm')}Push <span class="mono">${l.unpushed}</span></button>`
      : `<button class="btn" type="button" data-act="push" disabled title="Nothing to push">${iconHTML('arrow-up', 'sm')}Push</button>`);
  }
  if (!l.isPrimary && l.readiness !== 'safe') {
    if (l.behind) {
      a.push(`<button class="btn" type="button" data-act="rebase" title="Rebase onto a tip (default ${esc(state.board.teamRef)})">${iconHTML('arrow-counter-clockwise', 'sm')}Rebase onto…</button>`);
    } else if (l.ahead && !l.dirty) {
      a.push(`<button class="btn" type="button" data-act="finish" title="Finish this lane: pick merge target, stop, remove">${iconHTML('git-merge', 'sm')}Finish…</button>`);
    }
  }
  return a.join('');
}

const EDITOR_ICON = { cursor: 'cursor', vscode: 'vscode', zed: 'zed', windsurf: 'windsurf', custom: 'arrow-square-out' };
const EDITOR_LABEL = { cursor: 'Cursor', vscode: 'VS Code', zed: 'Zed', windsurf: 'Windsurf' };
/** Saved editor, or the first installed one when it isn't on this Mac (mirrors os.openEditor). */
const effectiveEditor = () => {
  const p = state.prefs.editor;
  if (p === 'custom' || !state.editors.length || state.editors.find((e) => e.id === p)?.available) return p;
  return state.editors.find((e) => e.available && e.id !== 'custom')?.id || p;
};
const editorLabelOf = (id) => EDITOR_LABEL[id] || (id === 'custom' ? 'editor' : 'editor');
/** What Open actually launches (may fall back when the saved app is missing). */
const editorName = () => editorLabelOf(effectiveEditor());
const editorIcon = () => EDITOR_ICON[effectiveEditor()] || 'arrow-square-out';
/** Icon for the Settings → Editor row: always the saved choice, not the fallback. */
const savedEditorIcon = () => {
  const p = state.prefs.editor;
  if (p === 'custom') return 'folder-simple';
  return EDITOR_ICON[p] || 'arrow-square-out';
};

function editorBtnHTML() {
  const n = editorName();
  const saved = state.prefs.editor;
  const eff = effectiveEditor();
  const tip = saved !== eff && saved !== 'custom'
    ? `Open in ${n} (${editorLabelOf(saved)} isn’t installed — using ${n})`
    : `Open in ${n}`;
  return `<button class="iconbtn framed primary" type="button" data-act="editor" title="${esc(tip)}" aria-label="${esc(tip)}">${iconHTML(editorIcon())}</button>`;
}

/** #89 agent CLIs with a session open in this lane (from board.lanes[].agents). */
function laneAgentsHTML(l) {
  const names = l.agents || [];
  if (!names.length) return '';
  const who = names.join(', ');
  const icons = names.map((n) => aiToolPillIconHTML(n) || iconHTML('robot', 'sm')).join('');
  return `<span class="lane-agents" title="${esc(who)} ${names.length > 1 ? 'are' : 'is'} open in this lane">${icons}</span>`;
}

function laneSetupLink() {
  return `<button class="env-link" type="button" data-act="doctor">${iconHTML('gear-six', 'sm')}Lane setup</button>`;
}

/** Run controls on the selected lane in the panel: play/stop · Test · services · shared-data icon. */
function laneRunHTML(l) {
  if (!l.runnable) {
    return `<div class="lane-run"><span class="hint">${iconHTML('warning-circle', 'sm')}no lane.yaml</span>${laneSetupLink()}</div>`;
  }
  if (l.prepared === false && !l.isPrimary) {
    return `<div class="lane-run"><span class="hint">${iconHTML('warning-circle', 'sm')}setup incomplete</span><button class="btn" type="button" data-act="repair">${iconHTML('gear-six', 'sm')}Repair</button></div>`;
  }
  const runToggle = l.running
    ? `<button class="iconbtn danger" type="button" data-act="down" title="Stop" aria-label="Stop">${iconHTML('stop')}</button>`
    : `<button class="iconbtn primary" type="button" data-act="up" title="Start" aria-label="Start">${iconHTML('play')}</button>`;
  const testTitle = l.lastTest
    ? `Test · last ${l.lastTest.ok ? 'passed' : 'failed'}`
    : 'Run tests';
  const services = `<button class="iconbtn" type="button" data-act="servicesMenu" aria-haspopup="menu" title="Open a service">${iconHTML('globe-simple')}${iconHTML('caret-down', 'sm')}</button>`;
  const logOpen = state.runLog?.laneIndex === l.index;
  const logs = `<button class="iconbtn${logOpen ? ' log-open' : ''}" type="button" data-act="logs" title="Run log" aria-label="Run log" aria-pressed="${logOpen ? 'true' : 'false'}">${iconHTML('terminal-window')}</button>`;
  const dataTitle = l.dataMode === 'snapshot'
    ? 'Snapshot data: seeds its own copy via services.*.snapshot before Start.'
    : 'Shared data: local throwaway DBs shared across lanes — not staging or production.';
  const dataIcon = l.dataMode === 'snapshot' || l.dataMode === 'shared' || !l.dataMode
    ? `<span class="lane-fact data" title="${esc(dataTitle)}" aria-label="${l.dataMode === 'snapshot' ? 'Snapshot data' : 'Shared data'}">${iconHTML('database')}</span>`
    : '';
  const finish = !l.isPrimary && l.ahead && !l.dirty
    ? `<button class="btn" type="button" data-act="finish" title="Finish: merge, stop, remove">${iconHTML('git-merge', 'sm')}Finish</button>`
    : '';
  return `<div class="lane-run">
    ${runToggle}
    <button class="iconbtn" type="button" data-act="test" title="${esc(testTitle)}" aria-label="Test">${iconHTML('flask')}</button>
    ${services}
    ${logs}
    ${dataIcon}
    ${finish}
  </div>`;
}

function paintHeader() {
  const b = state.board;
  const l = laneByIndex(state.selectedLane) || b.lanes[0];
  let html = '';
  if (l.isPrimary) {
    const dirty = l.dirty > 0;
    const br = (b.branches || []).find((x) => !x.remote && (x.name === l.branch || x.short === l.branch));
    const upBehind = br?.upstreamBehind || 0;
    const pullBlocked = dirty && upBehind > 0;
    html = `<div class="head-row">
      <div class="title" title="Primary checkout · ${esc(l.displayPath || l.path)}">
        ${iconHTML(l.alert ? 'warning-circle' : 'shield-check')}
        <h1 title="${esc(l.name)}">${esc(l.name)}</h1>
      </div>
      <div class="facts">
        ${l.onTeamBranch ? '' : `<span class="fact bad">${iconHTML('shield-check', 'sm')}<strong>not on</strong> ${esc(b.teamBranch)}</span>`}
        ${dirty ? `<span class="fact bad">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>` : ''}
        ${upBehind
          ? `<span class="fact ${pullBlocked ? 'bad' : 'warn'}" title="${pullBlocked ? 'Commit or stash before pull' : `vs ${br.upstream || 'upstream'}`}">${iconHTML('cloud-arrow-down', 'sm')}<strong>${upBehind}↓</strong>${pullBlocked ? ' · pull blocked' : ` ${esc(br.upstream || 'upstream')}`}</span>`
          : ''}
        ${l.ahead ? `<span class="fact bad">${iconHTML('git-commit', 'sm')}<strong>${l.ahead}</strong> ahead of ${esc(b.teamRef)}</span>` : ''}
        ${authorshipPillHTML(l.authorship, l.tool, iconHTML)}
      </div>
      <div class="actions">
        ${gitActionsHTML(l)}
        <span class="env-sep"></span>
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        ${editorBtnHTML()}
      </div>
    </div>`;
  } else {
    // #94 skip behind/up-to-date direction chrome on lanes — keep dirty + authorship only
    const merged = l.readiness === 'safe'
      ? `<span class="fact ok">${iconHTML('check-circle', 'sm')}<strong>merged</strong> into ${esc(b.teamBranch)}</span>`
      : '';
    const dirty = l.dirty
      ? `<span class="fact warn">${iconHTML('circle-dashed', 'sm')}<strong>${l.dirty}</strong> uncommitted</span>`
      : '';
    const pill = authorshipPillHTML(l.authorship, l.tool, iconHTML);
    const remove = l.readiness === 'safe'
      ? `<button class="btn ghost-danger" type="button" data-act="remove">${iconHTML('x', 'sm')}Remove lane</button>`
      : `<button class="btn ghost-danger" type="button" data-act="remove" title="Not safe: opens a guided remove">${iconHTML('warning-circle', 'sm')}Remove lane !</button>`;
    html = `<div class="head-row">
      <div class="title">
        ${iconHTML('tree-structure')}
        <div><h1 title="${esc(l.name)}">${esc(l.name)}</h1><div class="path" title="${esc(l.folder || l.displayPath || l.path)}">${esc(l.folder || l.displayPath || l.path)}</div></div>
      </div>
      <div class="facts">${merged}${dirty}${pill}</div>
      <div class="actions">
        ${remove}${gitActionsHTML(l)}
        <span class="env-sep"></span>
        <button class="iconbtn framed" type="button" data-act="reveal" title="Reveal in Finder" aria-label="Reveal in Finder">${iconHTML('folder-simple')}</button>
        ${editorBtnHTML()}
      </div>
    </div>`;
  }
  el.laneHead.innerHTML = html;
  el.laneHead.querySelector('.title')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openLaneCtxMenu(e.clientX, e.clientY, l);
  });
  el.laneHead.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(btn.dataset.act, l, btn.dataset.url);
    });
  });
}

function openServicesMenu(anchor, lane) {
  const entries = Object.entries(lane.urls || {});
  const rect = anchor.getBoundingClientRect();
  dismissCtxMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu services-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  if (!entries.length) {
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'services-menu-empty';
    empty.textContent = 'Add ports.expose in lane.yaml';
    empty.addEventListener('click', () => {
      menu.remove();
      openLaneSetup(state.board?.root);
    });
    menu.appendChild(empty);
  } else {
    for (const [name, url] of entries) {
      let port = '';
      try { port = new URL(url).port; } catch { /* ignore */ }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.title = url;
      btn.innerHTML = `<span class="service-name">${esc(name)}</span><span class="mono">:${esc(port)}</span>${iconHTML('arrow-square-out', 'sm')}`;
      btn.addEventListener('click', () => {
        menu.remove();
        invoke('os.openExternal', url).catch(() => {});
      });
      menu.appendChild(btn);
    }
  }
  attachCtxMenu(menu);
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - menuRect.width - 8)}px`;
  }
}

async function handleAction(act, lane, url) {
  try {
    if (act === 'reveal') return invoke('os.reveal', lane.path);
    if (act === 'editor') return invoke('os.openEditor', lane.path);
    if (act === 'openUrl') return invoke('os.openExternal', url);
    if (act === 'commit') return openCommitSheet(lane);
    if (act === 'push') {
      return pushLaneTip(lane);
    }
    if (act === 'forcePush') {
      return openForcePushSheet({ kind: 'lane', lane });
    }
    if (act === 'pull') {
      return runGit('lane.pull', lane.index, `Pulled ${lane.name} from origin`, 'pull');
    }
    if (act === 'rebase') {
      return openRebaseOntoSheet(lane);
    }
    if (act === 'merge' || act === 'finish') return openFinishSheet(lane);
    if (act === 'remove') return openRemoveSheet(lane);
    if (act === 'doctor') return openLaneSetup();
    if (act === 'repair') return repairSelectedLane(lane);
    if (act === 'openAsLane') return openAsLaneSheet(lane);
    if (act === 'conflicts') return openConflictSheet(lane);
    if (act === 'stash') {
      return runGit('lane.stash', lane.index, `Stashed changes on ${lane.name}`, 'stash', {
        label: `stash on ${lane.name}`,
        run: () => invoke('lane.stashPop', ...pin(lane.index, 'stash@{0}')),
      });
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
    if (act === 'logs') {
      // Select first so paint() retarget does not snap back to the prior lane.
      state.selectedLane = lane.index;
      toggleRunLog(lane.index);
      paint();
      return;
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
    // CSS ::after draws the spinner — never inject a node (that was widening flex buttons).
    btn.querySelectorAll(':scope > .btn-spin').forEach((n) => n.remove());
    if (on) {
      if (btn.dataset.busyDisable == null) btn.dataset.busyDisable = btn.disabled ? '1' : '0';
      btn.disabled = true;
    } else if (btn.dataset.busyDisable != null) {
      btn.disabled = btn.dataset.busyDisable === '1';
      delete btn.dataset.busyDisable;
    }
  });
}

async function runGit(channel, laneIndex, okMsg, act, undo, extra) {
  const tabId = beginOp(act);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await invoke(channel, ...pin(laneIndex, ...(extra === undefined ? [] : [extra])));
    if (undo) pushUndo(undo.label, tabId, undo.run);
    if (settleBoard(tabId, root, board)) {
      state.flashMarks.add(laneIndex);
      toast(okMsg, 'ok', { undo: Boolean(undo) });
    }
  } finally {
    endOp(tabId, act);
  }
}

function isPushRejected(err) {
  const msg = err?.message || String(err || '');
  return err?.code === 'PUSH_REJECTED' || /non-fast-forward|rejected by origin|Force push/i.test(msg);
}

/** Strip git chatter ("To /path.git") so toasts stay human. */
function cleanGitMessage(err) {
  return String(err?.message || err || '')
    .replace(/^Error invoking remote method [^:]+:\s*/i, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l
      && !/^To\s+\S/i.test(l)
      && !/^Everything up-to-date\.?$/i.test(l)
      && !/^error:\s*failed to push some refs/i.test(l))
    .join('\n')
    .replace(/^Error:\s*/i, '')
    .trim();
}

function humanForcePushError(err) {
  const raw = String(err?.message || err || '');
  const msg = cleanGitMessage(err) || raw;
  if (/uncommitted|local changes|overwritten|index|working tree/i.test(msg + raw)) {
    return 'Commit or stash before force-pushing.';
  }
  if (/lease|stale info|remote.*(contain|have).*(work|commits)|fetch first/i.test(msg + raw)) {
    return 'Force push aborted — the remote moved. Fetch, then decide again.';
  }
  if (/protected|never force/i.test(msg)) return msg;
  return msg.split('\n')[0] || 'Force push failed.';
}

async function pushLaneTip(lane, { force } = {}) {
  const act = force ? 'forcePush' : 'push';
  const tabId = beginOp(act);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await api.invoke('lane.push', ...pin(lane.index, force ? { force } : undefined));
    if (settleBoard(tabId, root, board)) {
      state.flashMarks.add(lane.index);
      toast(
        force === 'force'
          ? `Force-pushed ${lane.name} to origin`
          : force === 'lease'
            ? `Force-pushed ${lane.name} (with lease)`
            : `Pushed ${lane.name} to origin`,
        'ok',
      );
    }
  } catch (e) {
    if (!force && isPushRejected(e)) {
      toast('Push rejected — local and remote diverged. Force push if you meant to rewrite the remote.', 'bad', {
        action: { label: 'Force push…', run: () => openForcePushSheet({ kind: 'lane', lane }) },
      });
    } else if (force) {
      toast(humanForcePushError(e), 'bad');
    } else {
      toast(cleanGitMessage(e) || String(e?.message || e), 'bad');
    }
  } finally {
    endOp(tabId, act);
  }
}

/** Always confirm before rewriting a remote tip. Defaults to --force-with-lease. */
function openForcePushSheet({ kind, lane, branch }) {
  if (kind === 'lane' && lane?.isPrimary) {
    toast('Protected primary never force-pushes', 'bad');
    return;
  }
  const label = kind === 'branch' ? (branch?.short || branch?.name) : lane?.name;
  const tip = kind === 'lane' && lane ? laneBranchTip(lane) : null;
  const up = tip?.upstream || (kind === 'branch' ? `origin/${branch?.short || branch?.name}` : null);
  const ahead = tip?.upstreamAhead || 0;
  const behind = tip?.upstreamBehind || 0;
  const counts = tip && (ahead || behind)
    ? `<p class="lede mono">${ahead}↑ ahead · ${behind}↓ behind ${esc(up)}</p>`
    : (up ? `<p class="lede">Remote tip: <span class="mono">${esc(up)}</span></p>` : '');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="force-push-title">
      <div class="eyebrow warn">${iconHTML('warning-circle', 'sm')}Force push</div>
      <h1 id="force-push-title">${esc(label || 'origin')}</h1>
      <p>Rewrites the remote tip to match this side. Prefer lease after a rebase; plain force overwrites whatever is on origin.</p>
      ${counts}
      <div class="list">
        <label class="list-row compact choice">
          <input type="radio" name="force" value="lease" checked />
          <div class="name">Force with lease<small><span class="mono">--force-with-lease</span> — refuses if someone else moved the remote tip.</small></div>
        </label>
        <label class="list-row compact choice">
          <input type="radio" name="force" value="force" />
          <div class="name">Force<small><span class="mono">--force</span> — overwrites the remote tip. Destructive.</small></div>
        </label>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit">${iconHTML('warning-circle', 'sm')}Force push</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = el.sheetLayer.querySelector('input[name=force]:checked')?.value || 'lease';
    closeSheet();
    if (kind === 'branch') await pushBranchRow(branch.name, { force: mode });
    else if (lane) await pushLaneTip(lane, { force: mode });
  });
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
      <p>${n} migration${n === 1 ? '' : 's'} missing from the shared database. Every lane uses it${others.length ? `, including ${others.map(esc).join(' and ')}` : ''}.</p>
      ${list}
      <div class="list">
        <label class="list-row compact choice">
          <input type="radio" name="up" value="force" checked />
          <div class="name">Start without them<small>App boots; this lane’s code may not match the schema.</small></div>
        </label>
        <label class="list-row compact choice">
          <input type="radio" name="up" value="snapshot" />
          <div class="name">Switch service to snapshot<small>Open Lane setup: set <span class="mono">mode: snapshot</span> and a <span class="mono">snapshot:</span> command in <span class="mono">.plenum/lane.yaml</span>. Next Run seeds that copy on the offset ports.</small></div>
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
  if (!tabId) return false;
  const root = state.board?.root;
  try {
    const res = await invoke(channel, ...pin(lane.index, extra));
    if (res?.conflict) {
      if (state.store.activeId === tabId) {
        state.conflictRoot = res.conflictRoot || null;
        openConflictSheet(lane, res);
      }
      return false;
    }
    if (settleBoard(tabId, root, res)) {
      state.flashMarks.add(lane.index);
      const team = state.board?.teamBranch || 'main';
      toast(okMsg || (channel.includes('rebase')
        ? `Rebased ${lane.name} onto ${team}`
        : `Merged ${lane.name} into ${team}`), 'ok');
    }
    return true;
  } finally {
    endOp(tabId, act);
  }
}

function openSheet(html) {
  closeSelectMenus();
  el.sheetLayer.innerHTML = html;
  el.sheetLayer.classList.add('open');
  enhanceSelects(el.sheetLayer);
  el.sheetLayer.querySelector('[data-close]')?.addEventListener('click', () => {
    if (el.sheetLayer.querySelector('form[data-sending="1"]')) return;
    closeSheet();
  });
  const form = el.sheetLayer.querySelector('form');
  form?.addEventListener('submit', (e) => e.preventDefault());
}

function closeSheet() {
  closeSelectMenus();
  el.sheetLayer.classList.remove('open');
  el.sheetLayer.innerHTML = '';
}

el.sheetLayer.addEventListener('click', (e) => {
  if (e.target !== el.sheetLayer) return;
  if (el.sheetLayer.querySelector('form[data-sending="1"]')) return;
  closeSheet();
});

function openQuickStart() {
  closePalette();
  startTour({ onEnd: () => { if (state.board && !state.prefs.tourDone) setPref({ tourDone: true }, false); } });
}

// First board of a fresh install: walk through it once.
function maybeStartTour() {
  if (state.prefs.tourDone || !state.board || state.settings.open || state.branchOverview.open) return;
  if (el.sheetLayer.classList.contains('open')) return;
  requestAnimationFrame(openQuickStart);
}
document.querySelector('[data-tour]')?.addEventListener('click', openQuickStart);

const WARM_PRESETS = [[30000, '30 seconds'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes']];

function openWarmSheet() {
  const cur = state.prefs.warmTabTtlMs || state.warmTtlMs;
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="warm-title">
      <h1 id="warm-title">Tab warm time</h1>
      <p>How long a tab you left keeps refreshing in the background. Come back inside that window and the board paints immediately.</p>
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

let feedbackDraft = { comment: '', target: null, credit: false, viaGh: false };

/** Effective git email for optional feedback credit (local override, else global). */
function feedbackCreditEmail() {
  const id = state.identity;
  if (!id) return '';
  return String(id.local?.email || id.global?.email || '').trim();
}

async function ensureFeedbackIdentity() {
  if (feedbackCreditEmail()) return feedbackCreditEmail();
  try {
    state.identity = await invoke('git.identity.get');
  } catch { /* leave prior */ }
  return feedbackCreditEmail();
}

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
    const creditSeed = { credit: !!feedbackDraft.credit, viaGh: !!feedbackDraft.viaGh };
    if (!node) {
      openFeedbackSheet({ comment: feedbackDraft.comment, target: feedbackDraft.target, ...creditSeed });
      return;
    }
    const r = node.getBoundingClientRect();
    openFeedbackSheet({
      comment: feedbackDraft.comment,
      target: { label: feedbackPickLabel(node), rect: { x: r.x, y: r.y, w: r.width, h: r.height } },
      ...creditSeed,
    });
  });
}

/** Footer shared by the board sidebar and the Settings sidebar so both look identical. */
function panelFootHTML(settingsActive = false) {
  const u = state.update;
  const showUpdate = Boolean(u?.enabled);
  const tip = updateHoverTip(u);
  const tipAttr = esc(tip);
  const aria = esc(tip.replace(/\n/g, ' — '));
  const status = updateStatusClass(u);
  const checking = u?.status === 'checking';
  const downloading = u?.status === 'downloading';
  const icon = downloading
    ? updateRingHTML(u)
    : iconHTML(updateActionIcon(u), checking ? 'spin' : '');
  const updateBtn = showUpdate
    ? `<button class="foot-update ${esc(status)}" type="button" data-update-act title="${tipAttr}" aria-label="${aria}">
        ${icon}${updateNotifyDot(u)}
      </button>`
    : '';
  return `<div class="panel-foot">
    <div class="foot-start">
      <button class="iconbtn${settingsActive ? ' active' : ''}" type="button" data-settings title="Settings ⌘," aria-label="Settings"${settingsActive ? ' aria-pressed="true"' : ''}>${iconHTML('gear-six')}</button>
      <button class="iconbtn" type="button" disabled title="Account (coming soon)" aria-label="Account (coming soon)">${iconHTML('user')}</button>
      ${updateBtn}
    </div>
    <button class="foot-link" type="button" data-feedback title="Feedback" aria-label="Feedback">${iconHTML('pencil-simple')}<span>Feedback</span></button>
  </div>`;
}

/** Ask before quitting — lanes and their services stop when Plenum closes. */
function confirmCloseAndUpdate() {
  const v = updateTargetVersion();
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="upd-title">
      <div class="eyebrow">${iconHTML('arrows-clockwise', 'sm')}Update ready</div>
      <h1 id="upd-title">Close Plenum and update${v ? ` to ${esc(v)}` : ''}?</h1>
      <p>Plenum will close and reopen by itself on the new version. Anything running in your lanes (dev servers, services) stops when it closes.</p>
      ${updateNotesHTML()}
      <div class="row-end">
        <button class="btn" type="button" data-close>Not now</button>
        <button class="btn primary" type="submit">Close &amp; update</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    closeSheet();
    runUpdateAct(true);
  });
  form.querySelector('[type=submit]').focus();
}

async function runUpdateAct(confirmed = false) {
  try {
    const prev = state.update;
    if (prev?.status === 'downloaded' && !confirmed) return confirmCloseAndUpdate();
    if (prev?.status === 'downloaded') toast('Closing Plenum to finish the update — it will reopen on its own.', 'ok');
    const next = await invoke('app.update.act');
    if (next) applyUpdateState(next);
    // Surface mock / install failures — the foot label often stays “Close & update”.
    if (next?.message && next.message !== prev?.message) {
      const kind = next.status === 'downloaded' || next.status === 'available' || next.status === 'error'
        ? 'bad'
        : '';
      toast(next.message, kind);
    } else if (next?.status === 'downloaded' && prev?.status === 'downloading') {
      toast(`Update${next.downloadedVersion ? ` ${next.downloadedVersion}` : ''} downloaded. Click “Close & update” to finish.`, 'ok');
    } else if (next?.status === 'available' && prev?.status === 'checking') {
      toast(next.availableVersion ? `Update ${next.availableVersion} available` : 'Update available', 'ok');
    }
  } catch { /* toasted */ }
}

function bindUpdateAct(root) {
  root.querySelectorAll('[data-update-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runUpdateAct();
    });
  });
}

let feedbackPreviewPng = null;

function setFeedbackRedact(on) {
  document.documentElement.classList.toggle('feedback-redact', !!on);
}

async function captureFeedbackPreview(target) {
  const sheet = el.sheetLayer;
  const sheetOpen = sheet.classList.contains('open');
  const prevVis = sheet.style.visibility;
  const host = document.querySelector('.window.app') || document.body;
  // Paint redact under the open sheet scrim when possible (user still sees the modal).
  setFeedbackRedact(true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (sheetOpen) sheet.style.visibility = 'hidden';
  // One paint of the redacted board is required for capturePage.
  await new Promise((r) => requestAnimationFrame(r));
  try {
    const { pngBase64 } = await invoke('feedback.capture', { target: target || null });
    feedbackPreviewPng = pngBase64;
    return pngBase64;
  } finally {
    // Opaque cover while tearing down redact so the board doesn't "un-skeleton" in view.
    const cover = document.createElement('div');
    cover.className = 'feedback-capture-cover';
    cover.setAttribute('data-feedback-ignore', '');
    host.appendChild(cover);
    setFeedbackRedact(false);
    if (sheetOpen) sheet.style.visibility = prevVis;
    requestAnimationFrame(() => cover.remove());
  }
}

async function openFeedbackSheet(seed = {}) {
  const email = await ensureFeedbackIdentity();
  let ghAvailable = false;
  try { ghAvailable = !!(await invoke('feedback.ghAvailable')); } catch { ghAvailable = false; }
  const target = seed.target || null;
  const comment = seed.comment ?? '';
  const creditOn = !!seed.credit && !!email;
  // Prefer the signed-in `gh` path whenever the CLI is on disk; hide the relay option.
  const viaGh = ghAvailable;
  const chip = target?.label
    ? `<span class="feedback-target-chip">${esc(target.label)}</span>`
    : `<span class="feedback-target-chip muted">No element selected</span>`;
  const previewSrc = seed.pngBase64 || feedbackPreviewPng;
  const creditLabel = email
    ? `<strong>Credit me</strong> (${esc(email)}). We may ask follow-up questions.`
    : `<strong>Credit me</strong>. We may ask follow-up questions.`;
  const creditHint = email
    ? ''
    : `<p class="feedback-credit-hint">Add an email in Settings → Accounts first.</p>`;
  const pathNote = viaGh
    ? `<p class="feedback-credit-hint">Posts as you with your GitHub CLI (<code>gh</code>). The screenshot stays on this Mac.</p>`
    : '';
  openSheet(`
    <form class="modal feedback-modal" role="dialog" aria-labelledby="feedback-title" data-feedback-ignore data-via="${viaGh ? 'gh' : 'relay'}">
      <div class="eyebrow">${iconHTML('pencil-simple', 'sm')}Feedback</div>
      <h1 id="feedback-title">What’s broken?</h1>
      <label class="field">Comment<textarea name="comment" rows="3" required autofocus placeholder="What happened?">${esc(comment)}</textarea></label>
      <div class="field">
        <span>Target</span>
        <div class="feedback-target-row">
          ${chip}
          <button class="btn" type="button" data-pick>Point at UI</button>
          ${target ? '<button class="btn" type="button" data-clear-target>Clear</button>' : ''}
        </div>
      </div>
      <div class="feedback-preview">
        <span>Screenshot</span>
        <figure>
          ${previewSrc
            ? `<img alt="Blurred window preview" src="data:image/png;base64,${previewSrc}" />`
            : '<div class="feedback-preview-pending">Grabbing a blurred preview…</div>'}
          <figcaption>Branch names and faces are blanked. Say what was on screen if it matters.</figcaption>
        </figure>
      </div>
      <div class="feedback-credit">
        <label class="feedback-credit-row">
          <input type="checkbox" name="credit" ${creditOn ? 'checked' : ''} ${email ? '' : 'disabled'} />
          <span>${creditLabel}</span>
        </label>
        ${creditHint}
      </div>
      ${pathNote}
      <p class="feedback-warn">${iconHTML('warning-circle', 'sm')}<span>Opens a public GitHub issue on <code>SigurdVilstrup/plenum</code>. Your <code>repoPath</code> stays on this Mac.</span></p>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel <kbd>esc</kbd></button>
        <button class="btn primary" type="submit" data-feedback-send>Send feedback <kbd>⌘↩</kbd></button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const ta = form.querySelector('[name=comment]');
  const credit = form.querySelector('[name=credit]');
  const sendBtn = form.querySelector('[data-feedback-send]');

  const paintSendLabel = (busy) => {
    sendBtn.replaceChildren();
    sendBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    const kbd = document.createElement('kbd');
    kbd.textContent = '⌘↩';
    sendBtn.append(document.createTextNode('Send feedback '), kbd);
  };

  const setSendBusy = (on) => {
    form.dataset.sending = on ? '1' : '';
    sendBtn.classList.toggle('busy', on);
    sendBtn.disabled = on;
    form.querySelectorAll('button, textarea, input').forEach((node) => {
      if (node === sendBtn) return;
      if (node === credit && !email) return;
      node.disabled = on;
    });
    paintSendLabel(on);
  };

  const refreshPreview = async () => {
    try {
      const b64 = await captureFeedbackPreview(target);
      const fig = form.querySelector('.feedback-preview figure');
      if (!fig || !form.isConnected) return;
      fig.querySelector('img, .feedback-preview-pending')?.remove();
      const img = document.createElement('img');
      img.alt = 'Redacted window preview';
      img.src = `data:image/png;base64,${b64}`;
      fig.insertBefore(img, fig.querySelector('figcaption'));
    } catch (e) {
      const pending = form.querySelector('.feedback-preview-pending');
      if (pending) pending.textContent = e.message || 'Couldn’t capture preview';
    }
  };
  if (!previewSrc) refreshPreview();
  else feedbackPreviewPng = previewSrc;

  const toastSent = (sent) => {
    const link = sent?.issueUrl
      ? { url: sent.issueUrl, label: sent.issueNumber != null ? `#${sent.issueNumber}` : 'Open issue' }
      : null;
    if (sent?.via === 'gh') {
      toast('Opened as a public GitHub issue. Thanks.', 'ok', { link });
      return;
    }
    if (sent?.screenshot === false) {
      toast('Sent, but the screenshot didn’t upload. Thanks.', 'ok', { link });
      return;
    }
    toast('Sent. Thanks.', 'ok', { link });
  };

  const send = async () => {
    if (sendBtn.disabled) return;
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    const wantCredit = !!credit?.checked && !!email;
    if (credit?.checked && !email) {
      toast('Add an email in Settings → Accounts, or leave credit off.', 'bad');
      return;
    }
    const useGh = form.dataset.via === 'gh';
    const draft = {
      comment: text,
      target,
      credit: wantCredit,
      pngBase64: feedbackPreviewPng,
      viaGh: useGh,
    };
    setSendBusy(true);
    try {
      let pngBase64 = feedbackPreviewPng;
      if (!pngBase64) pngBase64 = await captureFeedbackPreview(target);
      const { dir } = await invoke('feedback.save', {
        comment: text,
        target,
        reporterEmail: wantCredit ? email : null,
        pngBase64,
      });
      try {
        const sent = await invoke(useGh ? 'feedback.sendViaGh' : 'feedback.send', dir);
        feedbackPreviewPng = null;
        closeSheet();
        stopFeedbackPick();
        toastSent(sent);
      } catch (e) {
        feedbackPreviewPng = null;
        closeSheet();
        stopFeedbackPick();
        if (useGh) {
          toast(e.message || 'Couldn’t create the GitHub issue. Check `gh auth status`.', 'bad');
        } else {
          // Saved locally; main retries unsent reports on launch and every 15 min.
          toast('Couldn’t reach the feedback server. Saved, will retry automatically.', 'bad');
        }
      }
    } catch (e) {
      setSendBusy(false);
      toast(e.message || 'Couldn’t save', 'bad');
      if (!form.isConnected) openFeedbackSheet(draft);
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  bindCommitChord(ta, send);
  form.querySelector('[data-pick]')?.addEventListener('click', () => {
    feedbackDraft = {
      comment: ta.value,
      target,
      credit: !!credit?.checked,
      viaGh,
    };
    feedbackPreviewPng = null;
    closeSheet();
    startFeedbackPick();
  });
  form.querySelector('[data-clear-target]')?.addEventListener('click', () => {
    feedbackPreviewPng = null;
    openFeedbackSheet({
      comment: ta.value,
      target: null,
      credit: !!credit?.checked,
      viaGh,
    });
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
      <h1 id="stash-pop-title">Pop a stash onto ${esc(lane.name)}</h1>
      <p>Latest is selected. Pick another if you need an older one.</p>
      <div class="list" data-stash-list>
        ${list.map((s, i) => `
          <label class="list-row compact choice">
            <input type="radio" name="stash" value="${esc(s.ref)}"${i === 0 ? ' checked' : ''} />
            <div class="name"><span class="mono">${esc(s.ref)}</span>${s.age ? ` · ${esc(s.age)}` : ''}<small>${esc(s.subject || '')}</small></div>
          </label>`).join('')}
      </div>
      <div class="group-head">Files in stash</div>
      <div data-stash-files class="stash-files-pane is-loading" aria-busy="true">
        <p class="lede"><i class="btn-spin" aria-hidden="true"></i> Loading files…</p>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit" data-stash-pop-submit>${iconHTML('stack', 'sm')}Pop selected</button>
      </div>
    </form>`);
  const modal = el.sheetLayer.querySelector('.modal');
  const filesEl = modal.querySelector('[data-stash-files]');
  const submitBtn = modal.querySelector('[data-stash-pop-submit]');
  const setPopBusy = (on) => {
    submitBtn.classList.toggle('busy', on);
    submitBtn.disabled = on;
    modal.querySelectorAll('input[name=stash], [data-close]').forEach((n) => { n.disabled = on; });
    submitBtn.querySelectorAll(':scope > .btn-spin').forEach((n) => n.remove());
  };
  const loadPreview = async (ref) => {
    filesEl.classList.add('is-loading');
    filesEl.setAttribute('aria-busy', 'true');
    filesEl.innerHTML = '<p class="lede"><i class="btn-spin" aria-hidden="true"></i> Loading files…</p>';
    try {
      const data = await invoke('lane.stashShow', ...pin(ref));
      filesEl.classList.remove('is-loading');
      filesEl.removeAttribute('aria-busy');
      filesEl.innerHTML = renderFiles(data.files || []);
    } catch (e) {
      filesEl.classList.remove('is-loading');
      filesEl.removeAttribute('aria-busy');
      filesEl.innerHTML = `<p class="lede">${esc(e.message || 'Couldn’t load stash')}</p>`;
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
    if (submitBtn.disabled) return;
    const tabId = beginOp('stashPop');
    if (!tabId) return;
    const root = state.board?.root;
    setPopBusy(true);
    try {
      const board = await invoke('lane.stashPop', ...pin(lane.index, selected));
      closeSheet();
      if (settleBoard(tabId, root, board)) toast(`Popped ${selected} onto ${lane.name}`, 'ok');
    } catch { /* toasted */ }
    finally {
      endOp(tabId, 'stashPop');
      if (modal.isConnected) setPopBusy(false);
    }
  });
}

function branchByName(name) {
  return (state.board?.branches || []).find((b) => b.name === name || b.short === name);
}

function dismissCtxMenus() {
  document.querySelector('.ctx-menu')?.remove();
  closeSelectMenus();
}

async function updateBranchRow(name) {
  if (state.loudRefreshByTab.has(state.store.activeId)) return;
  const br = branchByName(name);
  if (!br) return;
  const tabId = beginOp('branch-update', br.short || br.name);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const board = await invoke('branch.update', ...pin({ branch: br.name }));
    if (settleBoard(tabId, root, board)) {
      toast(br.remote ? `Fetched ${br.name}` : `Pulled ${br.short || br.name} from origin`, 'ok');
    }
  } catch { /* toasted */ }
  finally { endOp(tabId, 'branch-update'); }
}

async function pushBranchRow(name, { force } = {}) {
  if (state.loudRefreshByTab.has(state.store.activeId)) return;
  const br = branchByName(name);
  if (!br || br.remote) return;
  const tabId = beginOp('branch-push', br.short || br.name);
  if (!tabId) return;
  const root = state.board?.root;
  try {
    const payload = force ? { branch: br.name, force } : { branch: br.name };
    const board = await invoke('branch.push', ...pin(payload));
    if (settleBoard(tabId, root, board)) {
      const tip = br.short || br.name;
      toast(
        force === 'force' ? `Force-pushed ${tip} to origin`
          : force === 'lease' ? `Force-pushed ${tip} (with lease) to origin`
            : `Pushed ${tip} to origin`,
        'ok',
      );
    }
  } catch (e) {
    if (!force && isPushRejected(e)) openForcePushSheet({ kind: 'branch', branch: br });
  } finally { endOp(tabId, 'branch-push'); }
}

async function checkoutBranchRow(name) {
  if (state.loudRefreshByTab.has(state.store.activeId)) return;
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
  // Switch the selected worktree onto this tip — including Protected/primary.
  // Open as lane stays a separate verb (right-click / Worktrees).
  const lane = laneByIndex(state.selectedLane) || state.board?.lanes?.[0];
  if (!lane) return;
  const tabId = beginOp('checkout', br.short || br.name);
  if (!tabId) return;
  const root = state.board?.root;
  const prev = lane.branch;
  try {
    const board = await invoke('branch.checkout', ...pin({ branch: br.name, laneIndex: lane.index }));
    if (prev && prev !== br.name) {
      pushUndo(`switch to ${br.short || br.name}`, tabId, () => invoke('branch.checkout', ...pin({ branch: prev, laneIndex: lane.index })), { selectLane: lane.index });
    }
    if (settleBoard(tabId, root, board, { selectLane: lane.index })) {
      toast(`Checked out ${br.short || br.name}${lane.isPrimary ? '' : ` in ${lane.name}`}`, 'ok', { undo: Boolean(prev && prev !== br.name) });
    }
  } catch { /* toasted */ }
  finally { endOp(tabId, 'checkout'); }
}

function attachCtxMenu(menu) {
  document.body.appendChild(menu);
  const off = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('mousedown', off);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function ctxMenuAt(x, y) {
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
  return { menu, add };
}

function openLaneCtxMenu(x, y, lane) {
  if (!lane) return;
  const { menu, add } = ctxMenuAt(x, y);
  if (lane.index !== state.selectedLane) {
    add('Select', () => {
      state.selectedLane = lane.index;
      paint();
    });
  }
  add('Reveal in Finder', () => handleAction('reveal', lane));
  add(`Open in ${editorName()}`, () => handleAction('editor', lane));
  add('Copy path', () => copyText(lane.path, 'path'));
  if (lane.branch) add('Copy branch name', () => copyText(lane.branch, 'branch name'));
  add('Pull from remote', () => handleAction('pull', lane));
  if (lane.unpushed) add('Push to remote', () => handleAction('push', lane));
  add('Force push…', () => openForcePushSheet({ kind: 'lane', lane }));
  if (lane.runnable && (lane.prepared !== false || lane.isPrimary)) {
    if (lane.running) add('Stop', () => handleAction('down', lane));
    else add('Start', () => handleAction('up', lane));
    add('Run log', () => handleAction('logs', lane));
  }
  if (!lane.isPrimary) {
    if (lane.prepared === false && lane.runnable) add('Repair', () => handleAction('repair', lane));
    if (lane.ahead && !lane.dirty) add('Finish…', () => handleAction('finish', lane));
    const removeLabel = lane.readiness === 'safe' ? 'Remove lane…' : 'Remove lane… !';
    add(removeLabel, () => handleAction('remove', lane), true);
  }
  attachCtxMenu(menu);
}

function openBranchCtxMenu(x, y, name) {
  if (state.loudRefreshByTab.has(state.store.activeId)) return;
  const br = branchByName(name);
  if (!br) return;
  const lane = laneByIndex(state.selectedLane);
  const canRename = !br.remote && !br.isTeam && !br.isPrimary;
  const canDelete = !br.isTeam && !br.isPrimary && !(br.hasLane && br.laneIndex === 0);
  const { menu, add } = ctxMenuAt(x, y);
  add(
    br.hasLane ? 'Select worktree' : (br.remote ? 'Check out' : 'Switch branch'),
    () => checkoutBranchRow(br.name),
  );
  add('Overview…', () => openBranchOverview(br.name));
  add('Copy name', () => copyText(br.name, 'branch name'));
  const root = state.board?.root;
  add(branchPins(root).includes(br.name) ? 'Unpin' : 'Pin to top', () => { toggleBranchPin(root, br.name); paint(); });
  if (br.remote) {
    add('Fetch', () => updateBranchRow(br.name));
  } else {
    add('Pull from remote', () => {
      if (br.hasLane) {
        const holder = laneByIndex(br.laneIndex);
        if (holder) handleAction('pull', holder);
        return;
      }
      updateBranchRow(br.name);
    });
    if (!br.hasLane) {
      add('Push to remote', () => pushBranchRow(br.name));
      add('Force push…', () => openForcePushSheet({ kind: 'branch', branch: br }));
    }
  }
  if (!br.hasLane && !br.isTeam) add('Open as lane', () => openLaneFromBranch(br.name));
  if (canRename) add('Rename…', () => openRenameBranchSheet(br));
  if (canDelete) add('Delete…', () => openDeleteBranchSheet(br), true);
  if (lane && !lane.isPrimary) {
    add(`Rebase ${lane.name} onto this`, () => runConflictable('lane.rebase', lane, br.name, 'rebase',
      `Rebased ${lane.name} onto ${br.name}`));
  }
  attachCtxMenu(menu);
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
      if (to !== br.name) pushUndo(`rename ${br.name}`, tabId, () => invoke('branch.rename', ...pin(to, br.name)));
      if (settleBoard(tabId, root, board)) toast(`Renamed ${br.name} → ${to}`, 'ok', { undo: to !== br.name });
    } catch { /* toasted */ }
  });
}

function openDeleteBranchSheet(br) {
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="del-br-title">
      <div class="eyebrow warn">${iconHTML('warning-circle', 'sm')}Delete branch</div>
      <h1 id="del-br-title">${esc(br.name)}</h1>
      <p>Deletes the ${br.remote ? 'remote' : 'local'} ref. Won’t touch a checked-out tip or the team branch.</p>
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
    // Remote deletes hit the network: keep the sheet open with a spinner until it settles.
    const controls = form.querySelectorAll('button, input');
    const setBusy = (on) => {
      controls.forEach((c) => { c.disabled = on; });
      form.querySelector('[type=submit]').classList.toggle('busy', on);
    };
    setBusy(true);
    try {
      let board = await invoke('branch.delete', ...pin(br.name, { force, remote: br.remote }));
      if (alsoRemote && !br.remote) {
        board = await invoke('branch.delete', ...pin(`origin/${br.short || br.name}`, { remote: true }));
      }
      closeSheet();
      // Only a local-only delete can be undone; a deleted remote ref is gone for good.
      const undoable = !br.remote && !alsoRemote && Boolean(br.head);
      if (undoable) pushUndo(`delete ${br.name}`, tabId, () => invoke('undo.restoreBranch', ...pin(br.name, br.head)));
      if (settleBoard(tabId, root, board)) toast(`Deleted ${br.name}`, 'ok', { undo: undoable });
    } catch {
      setBusy(false); // toasted; let the user retry or cancel
    }
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
      <p>Defaults to the team tip. Any local or remote tip works as the new base.</p>
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
  if (!state.board?.hasManifest) {
    toast('Lane setup first — write .plenum/lane.yaml', 'warn');
    return openLaneSetup();
  }
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="open-br-lane-title">
      <div class="eyebrow">${iconHTML('play', 'sm')}Open as lane</div>
      <h1 id="open-br-lane-title">${esc(name)}</h1>
      <p>Creates a worktree if needed and applies the repo recipe so it can Start on its own ports.</p>
      <div class="check">
        ${iconHTML('database')}
        <div><strong>Shared data.</strong> Lanes share one local throwaway database by default — not staging or production.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('play', 'sm')}Open as lane</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    closeSheet();
    const tabId = state.store.activeId;
    const root = state.board?.root;
    try {
      const board = await invoke('lane.create', ...pin({ existing: true, branch: name }));
      const created = board.lanes.find((l) => l.branch === name) || board.lanes[board.lanes.length - 1];
      pushCreateLaneUndo(tabId, created, { newBranch: false });
      if (settleBoard(tabId, root, board, { selectLane: created?.index, enterLane: created?.index })) {
        toast(`Lane ${created?.name || name} opened`, 'ok', { undo: Boolean(created) });
        if (created && state.prefs.openLaneInEditor !== false) invoke('os.openEditor', created.path).catch(() => {});
      }
    } catch { /* toasted */ }
  });
}

function openCreateLane() {
  const team = state.board.teamRef;
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="new-lane-title">
      <div class="eyebrow">${iconHTML('tree-structure', 'sm')}New lane</div>
      <h1 id="new-lane-title">From latest ${esc(state.board.teamBranch)}</h1>
      <p>Makes a linked worktree on its own branch. Leaves primary <span class="mono">${esc(state.board.teamBranch)}</span> alone.</p>
      <label class="field">Feature name<input name="name" placeholder="invoice-pdf" required autofocus /></label>
      <label class="field">Branch<input name="branch" placeholder="feat/invoice-pdf" /></label>
      <label class="field">Base<select name="base" disabled><option>${esc(team)}</option></select></label>
      <div class="check">
        ${iconHTML('shield-check')}
        <div><strong>Team step.</strong> Base is current <span class="mono">${esc(team)}</span>. When that tip moves, this lane shows as behind.</div>
      </div>
      <p class="lede" style="margin:0">Already have a branch? Right-click it → <strong>Switch branch</strong> or <strong>Open as lane</strong>.</p>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML(state.prefs.openLaneInEditor === false ? 'tree-structure' : editorIcon(), 'sm')}${state.prefs.openLaneInEditor === false ? 'Create' : `Create and open in ${editorName()}`}</button>
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
      pushCreateLaneUndo(tabId, created, { newBranch: true });
      if (settleBoard(tabId, root, board, { selectLane: created?.index, enterLane: created?.index })) {
        toast(`Lane ${created?.name || name} created`, 'ok', { undo: Boolean(created) });
        if (created && state.prefs.openLaneInEditor !== false) invoke('os.openEditor', created.path).catch(() => {});
      }
    } catch { /* toasted */ }
  });
  nameInput.focus();
}

function laneRemoveRisks(lane) {
  const team = state.board?.teamBranch || 'main';
  const risks = [];
  if (lane.dirty) {
    risks.push(`${lane.dirty} uncommitted file${lane.dirty === 1 ? '' : 's'} will be discarded from disk`);
  }
  if (lane.readiness === 'unmerged') {
    risks.push(`Not merged into ${team}. The worktree goes away; branch ${lane.name} is kept`);
  } else if (lane.readiness === 'working' && lane.ahead > 0) {
    risks.push(`${lane.ahead} commit${lane.ahead === 1 ? '' : 's'} ahead of ${team} stay on the branch`);
  }
  if (lane.running) risks.push('Running process will be stopped');
  if (!risks.length && lane.readiness !== 'safe') {
    risks.push('Lane is not marked safe to remove');
  }
  return risks;
}

function openRemoveSheet(lane) {
  const safe = lane.readiness === 'safe';
  const risks = laneRemoveRisks(lane);
  const riskList = risks.map((r) => `
    <div class="list-row compact">
      ${iconHTML('warning-circle')}
      <div class="name">${esc(r)}</div>
    </div>`).join('');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="remove-title">
      <div class="eyebrow${safe ? '' : ' warn'}">${iconHTML(safe ? 'check-circle' : 'warning-circle', 'sm')}${safe ? 'Safe to remove' : 'Not safe: remove anyway'}</div>
      <h1 id="remove-title">Remove lane ${esc(lane.name)}</h1>
      <p>${safe
        ? `Merged into ${esc(state.board.teamBranch)} and clean. This only deletes the folder.`
        : `Not safe yet. You can still delete the worktree folder. The branch ref stays.`}</p>
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
        ${riskList}
      </div>
      ${safe
        ? `<div class="check">${iconHTML('shield-check')}<div>One lane at a time. Merge + clean first when you can.</div></div>`
        : `<label class="check"><input type="checkbox" name="confirm" /> I get it. Remove the folder anyway</label>`}
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit"${safe ? '' : ' disabled'}>${iconHTML('x', 'sm')}${safe ? 'Remove folder' : 'Remove anyway'}</button>
      </div>
    </form>`);
  const form = el.sheetLayer.querySelector('form');
  const submit = form.querySelector('[type=submit]');
  const confirm = form.querySelector('[name=confirm]');
  confirm?.addEventListener('change', () => {
    submit.disabled = !confirm.checked;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!safe && !confirm?.checked) return;
    const tabId = state.store.activeId;
    const root = state.board?.root;
    const force = !safe;
    submit.disabled = true;
    closeSheet();
    const step = (title, path = '') => setLoading(true, title, path, { immediate: true });
    step('Removing lane…', lane.name);
    const opTab = beginOp('remove', lane.name);
    try {
      if (lane.running) {
        step('Stopping lane…', lane.name);
        if (opTab) {
          state.opsByTab.set(opTab, { act: 'remove', detail: `Stopping ${lane.name}` });
          paintOpBusy();
        }
        await invoke('lane.down', ...pin(lane.index)).catch(() => {});
      }
      step(force ? 'Force-removing worktree…' : 'Removing worktree…', lane.folder || lane.path);
      if (opTab) {
        state.opsByTab.set(opTab, {
          act: 'remove',
          detail: force ? `Force-removing ${lane.name}` : lane.name,
        });
        paintOpBusy();
      }
      // Uncommitted files get a private snapshot so ⌘Z can bring the lane back whole.
      const snap = lane.dirty ? await api.invoke('undo.snapshot', ...pin(lane.index)).catch(() => null) : null;
      const board = await invoke(
        'lane.remove',
        ...pin(...(force ? [lane.index, { force: true }] : [lane.index])),
      );
      step('Refreshing board…');
      setLoading(false);
      const undoable = Boolean(lane.head) && (!lane.dirty || Boolean(snap));
      if (undoable) {
        pushUndo(`remove lane ${lane.name}`, tabId, () => invoke('undo.restoreLane', ...pin({
          path: lane.path, sha: snap?.sha,
        })), { selectLane: lane.index });
      }
      if (settleBoard(tabId, root, board, { selectLane: 0 })) {
        toast(`Removed worktree for ${lane.name}`, 'ok', { undo: undoable });
      }
    } catch {
      setLoading(false);
      paint();
    } finally {
      endOp(opTab, 'remove');
    }
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

function renderDirtyTree(node, depth = 0, prefix = '', selectable = false, selected = new Set()) {
  const pad = `padding-left:${6 + depth * 12}px`;
  let html = '';
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = prefix ? `${prefix}/${name}` : name;
    const collapsed = state.collapsedDirs.has(key);
    const selectedFolder = selected.has(`d:${key}`);
    html += `<div class="fx-folder-row${selectedFolder ? ' selected' : ''}"${selectable ? ` data-select-dir="${esc(key)}" tabindex="0" role="treeitem" aria-selected="${selectedFolder}"` : ''} style="${pad}">
      <button class="fx-folder-toggle${collapsed ? ' collapsed' : ''}" type="button" data-dir="${esc(key)}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(name)}">${iconHTML('caret-down', 'sm caret')}</button>
      ${iconHTML('folder-simple', 'sm')}<span class="name">${esc(name)}</span>${collapsed ? formatStat(sumTreeStats(child)) : ''}
    </div>`;
    if (!collapsed) html += renderDirtyTree(child, depth + 1, key, selectable, selected);
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    const kind = dirtyKind(f.code);
    const on = state.filePane?.path === f.path ? ' on' : '';
    const marked = selected.has(`f:${f.path}`);
    html += `<div class="fx-file-row${marked ? ' selected' : ''}"${selectable ? ` data-select-file="${esc(f.path)}" tabindex="0" role="treeitem" aria-selected="${marked}"` : ''} style="${pad}"><button class="fx-file${on}" type="button" data-file="${esc(f.path)}" title="${esc(f.path)}"${on ? ' aria-current="true"' : ''}>
      ${iconHTML('files', 'sm')}<span class="name">${esc(f.name)}</span>${formatStat(f)}<span class="mark ${kind}">${dirtyMark(f.code)}</span>
    </button></div>`;
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
    const selected = [...(state.selectedWipEntries.get(view.laneIndex) || [])].sort().join(',');
    return `wip:${view.laneIndex}:${files.map((f) => `${f.path}:${f.code}:${f.added}:${f.deleted}`).join(';')}:${fold}:${paneKey}:${selected}`;
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

/** @type {ReturnType<typeof setInterval> | null} */
let runLogTimer = null;
let runLogPaintGen = 0;
const RUN_LOG_H_KEY = 'plenum.runLogHeight';
const RUN_LOG_H_DEFAULT = 180;
const RUN_LOG_H_MIN = 100;

function runLogHeightMax() {
  return Math.max(RUN_LOG_H_MIN + 40, Math.round(window.innerHeight * 0.7));
}

function clampRunLogHeight(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return RUN_LOG_H_DEFAULT;
  return Math.round(Math.min(runLogHeightMax(), Math.max(RUN_LOG_H_MIN, v)));
}

function readRunLogHeight() {
  try {
    return clampRunLogHeight(localStorage.getItem(RUN_LOG_H_KEY) || RUN_LOG_H_DEFAULT);
  } catch {
    return RUN_LOG_H_DEFAULT;
  }
}

function applyRunLogHeight(px = readRunLogHeight()) {
  const h = clampRunLogHeight(px);
  document.documentElement.style.setProperty('--run-log-h', `${h}px`);
  return h;
}

function persistRunLogHeight(px) {
  const h = applyRunLogHeight(px);
  try { localStorage.setItem(RUN_LOG_H_KEY, String(h)); } catch { /* session only */ }
  return h;
}

function closeRunLog() {
  state.runLog = null;
  state.runLogStick = true;
  runLogPaintGen += 1;
  if (runLogTimer) {
    clearInterval(runLogTimer);
    runLogTimer = null;
  }
  if (el.runLog) {
    el.runLog.hidden = true;
    el.runLog.innerHTML = '';
  }
  el.body?.classList.remove('with-run-log');
}

function openRunLog(laneIndex) {
  const idx = Number(laneIndex);
  const retarget = state.runLog && state.runLog.laneIndex !== idx;
  state.runLog = { laneIndex: idx };
  state.runLogStick = true;
  applyRunLogHeight();
  el.body.classList.add('with-run-log');
  if (el.runLog) el.runLog.hidden = false;
  if (runLogTimer) clearInterval(runLogTimer);
  runLogTimer = setInterval(() => { paintRunLog().catch(() => {}); }, 750);
  paintRunLog({ loading: true, force: retarget || !el.runLog?.querySelector('.run-log-body') }).catch(() => {});
}

function toggleRunLog(laneIndex) {
  if (state.runLog && state.runLog.laneIndex === Number(laneIndex)) {
    closeRunLog();
    return;
  }
  openRunLog(laneIndex);
}

function runLogNearBottom(node, px = 24) {
  if (!node) return true;
  return node.scrollHeight - node.scrollTop - node.clientHeight < px;
}

function runLogLaneOptions(cur) {
  const lanes = (state.board?.lanes || []).filter((l) => l.runnable && (l.prepared !== false || l.isPrimary));
  const list = lanes.length ? lanes : (state.board?.lanes || []);
  return list.map((l) =>
    `<option value="${l.index}"${Number(l.index) === Number(cur) ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
}

/** Start/Stop · Test · services — same as the lane panel row, for the drawer header. */
function runLogActsHTML(l) {
  if (!l?.runnable) return '';
  if (l.prepared === false && !l.isPrimary) {
    return `<div class="run-log-acts lane-run"><button class="btn" type="button" data-act="repair" title="Repair">${iconHTML('gear-six', 'sm')}Repair</button></div>`;
  }
  const runToggle = l.running
    ? `<button class="iconbtn danger" type="button" data-act="down" title="Stop" aria-label="Stop">${iconHTML('stop')}</button>`
    : `<button class="iconbtn primary" type="button" data-act="up" title="Start" aria-label="Start">${iconHTML('play')}</button>`;
  const testTitle = l.lastTest
    ? `Test · last ${l.lastTest.ok ? 'passed' : 'failed'}`
    : 'Run tests';
  const services = `<button class="iconbtn" type="button" data-act="servicesMenu" aria-haspopup="menu" title="Open a service">${iconHTML('globe-simple')}${iconHTML('caret-down', 'sm')}</button>`;
  return `<div class="run-log-acts lane-run">${runToggle}<button class="iconbtn" type="button" data-act="test" title="${esc(testTitle)}" aria-label="Test">${iconHTML('flask')}</button>${services}</div>`;
}

function bindRunLogActs() {
  const lane = laneByIndex(state.runLog?.laneIndex);
  if (!lane || !el.runLog) return;
  el.runLog.querySelectorAll('.run-log-acts [data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.act === 'servicesMenu') {
        openServicesMenu(btn, lane);
        return;
      }
      handleAction(btn.dataset.act, lane, btn.dataset.url);
    });
  });
}

function bindRunLogResize(handle) {
  if (!handle || handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = readRunLogHeight();
    handle.classList.add('is-active');
    document.body.classList.add('is-row-resizing');
    const onMove = (ev) => {
      // Dragging the top edge up grows the drawer.
      persistRunLogHeight(startH + (startY - ev.clientY));
    };
    const onUp = () => {
      handle.classList.remove('is-active');
      document.body.classList.remove('is-row-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    persistRunLogHeight(RUN_LOG_H_DEFAULT);
  });
}

async function paintRunLog({ loading = false, force = false } = {}) {
  if (!state.runLog || !el.runLog) return;
  const gen = ++runLogPaintGen;
  const laneIndex = state.runLog.laneIndex;

  const shell = (bodyHtml, metaHtml = '', actsHtml = '') => `
    <i class="run-log-resize" data-run-log-resize title="Drag to resize · double-click to reset" aria-hidden="true"></i>
    <div class="run-log-head">
      <div class="title">Run log</div>
      <label class="run-log-lane">
        <select class="select mono" data-run-log-lane aria-label="Lane">${runLogLaneOptions(laneIndex)}</select>
      </label>
      ${metaHtml}
      <span class="spacer"></span>
      ${actsHtml}
      <button class="btn" type="button" data-clear-run-log title="Clear log">Clear</button>
      <button class="iconbtn" type="button" data-close-run-log title="Close" aria-label="Close">${iconHTML('x')}</button>
    </div>
    ${bodyHtml}`;

  const bindChrome = () => {
    bindRunLogResize(el.runLog.querySelector('[data-run-log-resize]'));
    enhanceSelects(el.runLog);
    bindRunLogActs();
    el.runLog.querySelector('[data-close-run-log]')?.addEventListener('click', () => {
      closeRunLog();
      paint();
    });
    el.runLog.querySelector('[data-clear-run-log]')?.addEventListener('click', async () => {
      try {
        await invoke('lane.clearLogs', ...pin(state.runLog.laneIndex));
        state.runLogStick = true;
        await paintRunLog({ force: true });
      } catch (err) {
        toast(String(err?.message || err || 'Couldn’t clear log'), 'bad');
      }
    });
    el.runLog.querySelector('[data-run-log-lane]')?.addEventListener('change', (e) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next) || next === state.runLog?.laneIndex) return;
      openRunLog(next);
      paint();
    });
  };

  const lane = laneByIndex(laneIndex);
  const actsHtml = () => runLogActsHTML(laneByIndex(state.runLog?.laneIndex) || lane);

  if (loading || force) {
    el.runLog.innerHTML = shell(`<div class="run-log-body is-empty">Loading…</div>`, '', actsHtml());
    bindChrome();
  }

  let data;
  try {
    data = await invoke('lane.logs', ...pin(laneIndex));
  } catch (err) {
    if (gen !== runLogPaintGen || !state.runLog) return;
    toast(String(err?.message || err || 'Couldn’t read log file'), 'bad');
    el.runLog.innerHTML = shell(`<div class="run-log-body is-empty">Couldn’t read log file.</div>`, '', actsHtml());
    bindChrome();
    return;
  }
  if (gen !== runLogPaintGen || !state.runLog || state.runLog.laneIndex !== laneIndex) return;

  const lines = data?.lines || [];
  const boardLane = laneByIndex(laneIndex);
  const running = !!(boardLane?.running ?? data?.running);
  const truncated = !!data?.truncated;
  const cmd = data?.command ? String(data.command) : '';
  const pid = data?.pid != null ? `pid ${data.pid}` : '';
  const status = running ? 'running' : (lines.length || cmd ? 'stopped' : '');
  const metaBits = [
    status || pid || cmd || truncated
      ? `<span class="dot${running ? ' on' : ''}" aria-hidden="true"></span>`
      : '',
    status,
    pid,
    cmd,
    truncated ? 'Last 500 lines' : '',
  ].filter(Boolean);
  const metaHtml = metaBits.length
    ? `<span class="run-log-meta" title="${esc([pid, cmd].filter(Boolean).join(' · '))}">${metaBits.map((b, i) => (i === 0 ? b : esc(b))).join(' · ')}</span>`
    : '';
  const acts = runLogActsHTML(boardLane);

  const body = el.runLog.querySelector('.run-log-body');
  const stick = state.runLogStick || runLogNearBottom(body);
  const jump = !stick && lines.length
    ? `<button class="btn run-log-jump" type="button" data-jump-log>Jump to latest</button>`
    : '';

  const formatLogLine = (l) => {
    const m = String(l).match(/^(\d{2}:\d{2}:\d{2}) (.*)$/s);
    if (!m) return esc(l);
    return `<span class="ts">${esc(m[1])}</span> ${esc(m[2])}`;
  };
  let bodyHtml;
  if (!lines.length) {
    bodyHtml = `<div class="run-log-body is-empty">No output yet.<br/>Start the lane to capture the run log.</div>${jump}`;
  } else {
    bodyHtml = `<div class="run-log-body">${lines.map(formatLogLine).join('\n')}</div>${jump}`;
  }

  const prev = body?.textContent || '';
  const nextText = lines.length ? lines.join('\n') : 'No output yet.\nStart the lane to capture the run log.';
  const needShell = !el.runLog.querySelector('.run-log-head');
  const laneSel = el.runLog.querySelector('[data-run-log-lane]');
  const laneSelOk = laneSel && Number(laneSel.value) === Number(laneIndex);
  const actsNode = el.runLog.querySelector('.run-log-acts');
  const wantDown = !!boardLane?.running;
  const haveDown = !!el.runLog.querySelector('.run-log-acts [data-act="down"]');
  const runToggleStale = !!acts && (!actsNode || wantDown !== haveDown);

  if (needShell || !laneSelOk || prev !== nextText || !!el.runLog.querySelector('[data-jump-log]') !== !!jump || runToggleStale) {
    el.runLog.innerHTML = shell(bodyHtml, metaHtml, acts);
    const nextBody = el.runLog.querySelector('.run-log-body');
    nextBody?.addEventListener('scroll', () => {
      state.runLogStick = runLogNearBottom(nextBody);
    }, { passive: true });
    bindChrome();
    el.runLog.querySelector('[data-jump-log]')?.addEventListener('click', () => {
      state.runLogStick = true;
      const b = el.runLog.querySelector('.run-log-body');
      if (b) b.scrollTop = b.scrollHeight;
      paintRunLog().catch(() => {});
    });
    if (stick && nextBody && !nextBody.classList.contains('is-empty')) {
      nextBody.scrollTop = nextBody.scrollHeight;
    } else if (!stick && body && nextBody && !nextBody.classList.contains('is-empty')) {
      nextBody.scrollTop = body.scrollTop;
    }
  } else {
    const headMeta = el.runLog.querySelector('.run-log-meta');
    const afterLane = el.runLog.querySelector('.run-log-lane');
    if (metaHtml) {
      if (headMeta) headMeta.outerHTML = metaHtml;
      else afterLane?.insertAdjacentHTML('afterend', metaHtml);
    } else if (headMeta) {
      headMeta.remove();
    }
    if (actsNode) {
      actsNode.outerHTML = acts;
      bindRunLogActs();
    }
    if (stick && body) body.scrollTop = body.scrollHeight;
  }
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
    // #77 a drag-select across blame text must not jump away
    node.addEventListener('click', () => { if (!window.getSelection()?.toString()) go(); });
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
  // #103 commit files have no cwd: a bare relative path resolved against / in the packaged app.
  const openPath = `${pane.cwd || state.board?.root}/${pane.path}`;
  el.body.classList.add('with-file-pane');
  el.fileStage.hidden = false;
  el.fileStage.innerHTML = `
    <div class="changes-head file-pane-head">
      <div class="title">${title}<small>${esc(pane.path)}</small></div>
      <div class="file-pane-modes" role="group" aria-label="File view mode">
        ${modes}
      </div>
      <button class="btn" type="button" data-open-external title="Open in ${esc(editorName())}">${iconHTML(editorIcon(), 'sm')}${esc(editorName())}</button>
      <button class="iconbtn file-pane-back" type="button" data-file-pane-back title="Close (back to graph)" aria-label="Close file view">${iconHTML('x')}</button>
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
        body.innerHTML = `<div class="fx-empty">${data.binary ? 'Binary file' : 'File too large'}. Use Editor.</div>`;
      } else if (data.empty && !data.hunks?.length) {
        body.innerHTML = '<div class="fx-empty">No textual changes vs HEAD</div>';
      } else {
        body.innerHTML = `<div class="file-pane-diff">${renderDiffBody(data.hunks)}</div>`;
      }
    } else if (wip && mode === 'read') {
      const shown = await invoke('file.workingShow', ...pin(pane.path, pane.cwd));
      if (!filePaneStill(pane) || !body) return;
      if (shown.binary || shown.tooLarge || shown.missing) {
        body.innerHTML = `<div class="fx-empty">${shown.missing ? 'Missing on disk' : shown.binary ? 'Binary file' : 'File too large'}. Use Editor.</div>`;
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

function bindCommitChord(textarea, onCommit, { enterCommits = false } = {}) {
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if ((e.metaKey || e.ctrlKey) || (enterCommits && !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      onCommit();
    }
  });
}

function bindWipCommitFields() {
  el.graph.querySelectorAll('[data-wip-msg]').forEach((input) => {
    const lane = laneByIndex(Number(input.dataset.wipMsg));
    if (!lane) return;
    input.value = state.commitDraft;
    const openWip = () => {
      if (state.changes?.kind === 'wip' && state.changes.laneIndex === lane.index) return;
      state.selectedLane = lane.index;
      clearFileStage();
      state.changes = { kind: 'wip', laneIndex: lane.index };
      paint();
      el.graph.querySelector(`[data-wip-msg="${lane.index}"]`)?.focus();
    };
    const doCommit = async () => {
      try { await commitLaneMessage(lane, input.value); } catch { /* toasted */ }
    };
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      openWip();
    });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      state.commitDraft = input.value;
      const ta = el.changes.querySelector('.commit-msg');
      if (ta && state.changes?.kind === 'wip' && state.changes.laneIndex === lane.index) {
        ta.value = input.value;
      }
    });
    bindCommitChord(input, doCommit, { enterCommits: true });
  });
}

async function commitLaneMessage(lane, message, paths = []) {
  const msg = String(message || '').trim();
  if (!msg) {
    toast('Commit message required', 'bad');
    return false;
  }
  const tabId = state.store.activeId;
  const root = state.board?.root;
  const board = await invoke('lane.commit', ...pin(lane.index, msg, paths));
  if (!settleBoard(tabId, root, board)) return true;
  state.flashMarks.add(lane.index);
  state.commitDraft = '';
  if (state.changes?.kind === 'wip') closeChanges();
  const tip = board.lanes.find((l) => l.index === lane.index)?.head;
  if (tip) {
    pushUndo(`commit on ${lane.name}`, tabId, async () => {
      const back = await invoke('undo.uncommit', ...pin(lane.index, tip));
      state.commitDraft = msg;
      return back;
    });
  }
  toast(`Committed on ${lane.name}`, 'ok', { undo: Boolean(tip) });
  return true;
}

async function revertWorkingFiles(lane, paths) {
  const names = paths.length === 1 ? paths[0] : `${paths.length} files`;
  if (!window.confirm(`Revert uncommitted changes to ${names}?`)) return;
  const tabId = state.store.activeId;
  const root = state.board?.root;
  try {
    // Private snapshot first: it is what ⌘Z restores from.
    const snap = await api.invoke('undo.snapshot', ...pin(lane.index, paths)).catch(() => null);
    const board = await invoke('lane.revert', ...pin(lane.index, paths));
    if (snap) pushUndo(`revert ${names}`, tabId, () => invoke('undo.restorePaths', ...pin(lane.index, { sha: snap.sha, paths })));
    if (!settleBoard(tabId, root, board)) return;
    state.selectedWipEntries.delete(lane.index);
    state.filePane = null;
    toast(paths.length === 1 ? `Reverted ${paths[0]}` : `Reverted ${paths.length} files`, 'ok', { undo: Boolean(snap) });
    if (state.changes?.kind === 'wip' && state.changes.laneIndex === lane.index) paintChanges();
  } catch { /* toasted */ }
}

function wipSelectedPaths(lane, selected) {
  const files = lane?.dirtyFiles || [];
  if (!selected?.size) return files.map((f) => f.path);
  const paths = new Set();
  for (const entry of selected) {
    if (entry.startsWith('f:')) paths.add(entry.slice(2));
    if (entry.startsWith('d:')) {
      const dir = entry.slice(2);
      for (const file of files) if (file.path.startsWith(`${dir}/`)) paths.add(file.path);
    }
  }
  return [...paths];
}

function bindChangesTree(basePath, { onFile, onRevert, onTreeRevert } = {}) {
  el.changes.querySelector('[data-close-changes]')?.addEventListener('click', () => {
    closeChanges();
    paint();
  });
  el.changes.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const laneIndex = state.changes?.laneIndex;
      if (laneIndex != null) state.wipSelectionAnchor.set(laneIndex, null);
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
  const rows = [...el.changes.querySelectorAll('[data-select-file], [data-select-dir]')];
  const keyOf = (row) => row.dataset.selectFile ? `f:${row.dataset.selectFile}` : `d:${row.dataset.selectDir}`;
  const select = (row, e) => {
    const laneIndex = state.changes?.laneIndex;
    if (laneIndex == null) return;
    const key = keyOf(row);
    let selected = new Set(state.selectedWipEntries.get(laneIndex) || []);
    if (e.shiftKey) {
      const anchorKey = state.wipSelectionAnchor.get(laneIndex) || key;
      const start = rows.findIndex((item) => keyOf(item) === anchorKey);
      const end = rows.indexOf(row);
      if (!e.metaKey && !e.ctrlKey) selected.clear();
      rows.slice(Math.min(start < 0 ? end : start, end), Math.max(start < 0 ? end : start, end) + 1).forEach((item) => selected.add(keyOf(item)));
    } else if (e.metaKey || e.ctrlKey) {
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      state.wipSelectionAnchor.set(laneIndex, key);
    } else {
      selected = new Set([key]);
      state.wipSelectionAnchor.set(laneIndex, key);
    }
    state.selectedWipEntries.set(laneIndex, selected);
    paintChanges();
  };
  rows.forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-dir]')) return;
      select(row, e);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      select(row, e);
    });
  });
  // Read-only trees (commit view) have no select rows: Copy path on the file button.
  el.changes.querySelectorAll('[data-file]').forEach((btn) => {
    if (btn.closest('[data-select-file]')) return;
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { menu, add } = ctxMenuAt(e.clientX, e.clientY);
      add('Copy path', () => copyText(btn.dataset.file, 'path'));
      attachCtxMenu(menu);
    });
  });
  if (onRevert) rows.forEach((row) => row.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    const key = keyOf(row);
    let selected = state.selectedWipEntries.get(state.changes?.laneIndex) || new Set();
    if (!selected.has(key)) {
      selected = new Set([key]);
      state.selectedWipEntries.set(state.changes?.laneIndex, selected);
      state.wipSelectionAnchor.set(state.changes?.laneIndex, key);
      row.classList.add('selected');
      row.setAttribute('aria-selected', 'true');
    }
    const paths = wipSelectedPaths(laneByIndex(state.changes?.laneIndex), selected.has(key) ? selected : new Set([key]));
    const { menu, add } = ctxMenuAt(e.clientX, e.clientY);
    add(paths.length > 1 ? `Copy ${paths.length} paths` : 'Copy path', () => copyText(paths.join('\n'), paths.length > 1 ? `${paths.length} paths` : 'path'));
    const folderName = key.startsWith('d:') ? key.slice(2).split('/').pop() : '';
    const label = selected.size === 1 && folderName
      ? `Revert folder “${folderName}”…`
      : paths.length > 1 ? `Revert ${paths.length} selected files…` : 'Revert changes…';
    add(label, () => onRevert(paths), true);
    attachCtxMenu(menu);
  }));
  if (onTreeRevert) el.changes.querySelector('.changes-tree')?.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-select-file], [data-select-dir]')) return;
    e.preventDefault();
    const { menu, add } = ctxMenuAt(e.clientX, e.clientY);
    add('Revert all changes…', onTreeRevert, true);
    attachCtxMenu(menu);
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
    const selected = state.selectedWipEntries.get(lane.index) || new Set();
    state.selectedWipEntries.set(lane.index, selected);
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
          ${files.length ? renderDirtyTree(tree, 0, '', true, selected) : '<div class="fx-empty">No uncommitted files</div>'}
      </div>
      <div class="changes-foot">
        ${files.length ? `
          <textarea class="commit-msg" name="message" rows="2" placeholder="Commit message" aria-label="Commit message"></textarea>
          <div class="foot-actions">
            <button class="btn" type="button" data-stash>${iconHTML('stack', 'sm')}Stash</button>
            <button class="btn primary" type="button" data-commit>${iconHTML('git-commit', 'sm')}Commit ${selected.size ? wipSelectedPaths(lane, selected).length : 'all'}</button>
            <span class="hint">⌘⏎</span>
          </div>` : ''}
      </div>`;
    bindChangesTree(lane.path, {
      onFile: (filePath) => {
        state.filePane = { sha: 'WORKTREE', cwd: lane.path, path: filePath, mode: 'diff' };
        paintChanges();
      },
      onRevert: (paths) => revertWorkingFiles(lane, paths),
      onTreeRevert: () => revertWorkingFiles(lane, files.map((f) => f.path)),
    });
    const ta = el.changes.querySelector('.commit-msg');
    const doCommit = async () => {
      const paths = selected.size ? wipSelectedPaths(lane, selected) : undefined;
      try { await commitLaneMessage(lane, ta?.value, paths); } catch { /* toasted */ }
    };
    el.changes.querySelector('[data-commit]')?.addEventListener('click', doCommit);
    el.changes.querySelector('[data-stash]')?.addEventListener('click', () => handleAction('stash', lane));
    if (ta) {
      ta.value = state.commitDraft;
      ta.addEventListener('input', () => {
        state.commitDraft = ta.value;
        const wip = el.graph.querySelector(`[data-wip-msg="${lane.index}"]`);
        if (wip) wip.value = ta.value;
      });
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
      <p>${lane.dirty} uncommitted file${lane.dirty === 1 ? '' : 's'} get staged and committed${lane.isPrimary ? '' : ' in this lane'}.</p>
      <label class="field">Message<textarea name="message" rows="3" required autofocus placeholder="What changed?"></textarea></label>
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

function openFinishSheet(lane) {
  const board = state.board;
  const targets = board.lanes
    .filter((l) => l.index !== lane.index)
    .map((l) => {
      const label = l.isPrimary ? `${l.name} (Protected)` : l.name;
      const sel = l.isPrimary || l.branch === board.teamBranch ? ' selected' : '';
      return `<option value="${esc(l.branch || l.name)}"${sel}>${esc(label)}</option>`;
    })
    .join('');
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="finish-title">
      <div class="eyebrow">${iconHTML('git-merge', 'sm')}Finish lane</div>
      <h1 id="finish-title">Finish ${esc(lane.name)}</h1>
      <p>Merge into a checkout that is already open, then stop this lane’s services and remove its worktree. Target does not have to be Protected.</p>
      <label class="field">Merge into<select name="into" class="select mono" required>${targets}</select></label>
      <div class="list">
        <label class="list-row compact choice"><input type="radio" name="mode" value="merge" checked /><div class="name">Merge commit<small>Always writes a merge commit.</small></div></label>
        <label class="list-row compact choice"><input type="radio" name="mode" value="ff" /><div class="name">Fast-forward<small>Only when history is linear.</small></div></label>
      </div>
      <label class="check"><input type="checkbox" name="remove" checked /> Remove worktree after merge</label>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('git-merge', 'sm')}Finish</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const mode = form.querySelector('input[name=mode]:checked')?.value || 'merge';
    const into = form.querySelector('[name=into]').value;
    const remove = form.querySelector('[name=remove]')?.checked !== false;
    closeSheet();
    const how = mode === 'ff' ? 'fast-forward' : 'merge commit';
    state.pendingFinish = { lanePath: lane.path, branch: lane.branch, into, remove, how };
    const ok = await runConflictable(
      'lane.finish',
      lane,
      { mode, into, remove },
      'finish',
      `Finished ${lane.name} → ${into} (${how})`,
    );
    if (ok) state.pendingFinish = null;
  });
}

async function finalizePendingFinish(tabId, root) {
  const pending = state.pendingFinish;
  if (!pending?.remove) {
    state.pendingFinish = null;
    return;
  }
  try {
    const board = state.board;
    const still = board?.lanes?.find((l) =>
      pathResolveEq(l.path, pending.lanePath) || l.branch === pending.branch);
    if (still && !still.isPrimary) {
      if (still.running) await invoke('lane.down', ...pin(still.index));
      const next = await invoke('lane.remove', ...pin(still.index, { force: true }));
      if (settleBoard(tabId, root, next)) {
        toast(`Finished ${pending.branch} → ${pending.into} (${pending.how})`, 'ok');
      }
    }
  } catch { /* toasted */ }
  state.pendingFinish = null;
}

function pathResolveEq(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).replace(/\/+$/, '');
  return norm(a) === norm(b);
}

/** Kept for callers that still say Merge; Finish is the end-of-life path. */
function openMergeSheet(lane) {
  return openFinishSheet(lane);
}

function openAsLaneSheet(lane) {
  const hasManifest = Boolean(state.board?.hasManifest);
  if (!hasManifest) {
    toast('Lane setup first — write .plenum/lane.yaml', 'warn');
    return openLaneSetup();
  }
  openSheet(`
    <form class="modal" role="dialog" aria-labelledby="open-lane-title">
      <div class="eyebrow">${iconHTML('play', 'sm')}Open as lane</div>
      <h1 id="open-lane-title">${esc(lane.name)}</h1>
      <p>Applies the repo recipe (env copy + setup) so this worktree can Start on its own ports. Shared data is the default: one local throwaway database across lanes — not staging or production. Isolation needs a snapshot seed in lane.yaml.</p>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${iconHTML('play', 'sm')}Open as lane</button>
      </div>
    </form>`);
  el.sheetLayer.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    closeSheet();
    await repairSelectedLane(lane, { opened: true });
  });
}

async function repairSelectedLane(lane, { opened = false } = {}) {
  const tabId = state.store.activeId;
  const root = state.board?.root;
  try {
    const board = await invoke('lane.repair', ...pin(lane.index));
    if (settleBoard(tabId, root, board, { selectLane: lane.index })) {
      toast(opened ? `Opened ${lane.name} as a lane` : `Repaired ${lane.name}`, 'ok');
    }
  } catch { /* toasted */ }
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
      <p>Open each file, fix it, stage it. Continue when they’re all staged.</p>
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
      if (settleBoard(tabId, root, res)) {
        if (state.pendingFinish) await finalizePendingFinish(tabId, root);
        else toast('Conflicts resolved. Continued.', 'ok');
      }
    } catch { /* toasted */ }
  });
  modal.querySelector('[data-abort]')?.addEventListener('click', async () => {
    try {
      const board = await invoke('lane.conflictAbort', ...pin(lane.index, croot));
      state.conflictRoot = null;
      state.pendingFinish = null;
      closeSheet();
      if (settleBoard(tabId, root, board)) toast('Aborted. Branch restored.', 'ok');
    } catch { /* toasted */ }
  });
}

/* Settings: a page in the same window, not a sheet */
const SETTINGS_NAV = [
  ['general', 'list', 'General'],
  ['appearance', 'sun', 'Appearance'],
  ['graph', 'tree-structure', 'Graph'],
  ['accounts', 'key', 'Accounts'],
  ['repositories', 'folder-simple', 'Repository'],
  ['lane', 'stack', 'Lane'],
  ['agents', 'robot', 'Agents'],
  ['statistics', 'git-commit', 'Statistics'],
];

const optionGroup = (key, options, cur, { num = false, label = key } = {}) =>
  `<div class="option-row" role="group" aria-label="${esc(label)}" data-pref="${key}"${num ? ' data-num' : ''}>${options.map(([v, text]) =>
    `<button class="option${String(v) === String(cur) ? ' on' : ''}" type="button" aria-pressed="${String(v) === String(cur)}" data-v="${esc(v)}">${text}</button>`).join('')}</div>`;

// #108 looks on the chroma axis. Inspired by familiar styles, named as our own.
const LOOKS = [
  ['muted', 'Muted'], ['vibrant', 'Vibrant'], ['arcade', 'Arcade'], ['fairytale', 'Fairytale'],
  ['studio', 'Studio'], ['retro', 'Retro'], ['bricks', 'Bricks'],
];
const themeGridHTML = (cur) => {
  const mode = document.documentElement.dataset.theme || 'dark';
  return `<div class="option-row theme-grid" role="group" aria-label="Look" data-pref="chroma">${LOOKS.map(([v, name]) =>
    `<button class="option theme-card${v === cur ? ' on' : ''}" type="button" aria-pressed="${v === cur}" data-v="${v}" data-theme="${mode}"${v === 'muted' ? '' : ` data-chroma="${v}"`}>
      <span class="dots"><i style="background:var(--primary)"></i><i style="background:var(--lane-2)"></i><i style="background:var(--lane-3)"></i><i style="background:var(--surface-3)"></i></span>
      ${name}</button>`).join('')}</div>`;
};

const selectHTML = (key, options, cur, label) =>
  `<select class="select" data-pref="${key}" aria-label="${esc(label)}">${options.map(([v, t]) =>
    `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;

const switchHTML = (key, on, label) =>
  `<button class="switch${on ? ' on' : ''}" type="button" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-pref="${key}"></button>`;

const settingsRow = (ic, name, small, detail, control = '', tip = '') =>
  `<div class="list-row"${tip ? ` title="${esc(tip)}"` : ''}>${iconHTML(ic)}<div class="name">${name}${small ? `<small>${small}</small>` : ''}</div><div class="detail">${detail || ''}</div>${control}<span></span></div>`;

const settingsPlaceholder = (title, lede) => `<h1>${title}</h1><p class="lede">${lede}</p>`;

// Sample data for the Appearance preview (rendered by the real graph/diff code).
const PREVIEW_COMMITS = [
  { id: 'a1b2c3d', parents: ['b2c3d4e'], lane: 1, subject: 'Tint row hover from lane color', author: 'Ada', email: 'ada@example.com', kind: 'assisted', tool: 'Claude', when: '2m', refs: [{ name: 'feat/hover', worktree: true }], isTip: true, unpushed: true },
  { id: 'b2c3d4e', parents: ['c3d4e5f'], lane: 1, subject: 'Split graph row renderer', author: 'Ada', email: 'ada@example.com', kind: 'human', when: '1h', refs: [] },
  { id: 'e5f6a7b', parents: ['c3d4e5f'], lane: 0, subject: 'Fix lane color on merge', author: 'Lin', email: 'lin@example.com', kind: 'human', when: '3h', refs: [{ name: 'main', primary: true }], isTip: true },
  { id: 'c3d4e5f', parents: ['d4e5f6a'], lane: 0, subject: 'Add file history pane', author: 'Lin', email: 'lin@example.com', kind: 'human', when: '1d', refs: [] },
  { id: 'd4e5f6a', parents: [], lane: 0, subject: 'Initial commit', author: 'Lin', email: 'lin@example.com', kind: 'human', when: '2d', refs: [{ name: 'v0.1', tag: true }] },
];
const PREVIEW_HUNKS = [{
  header: '@@ -12,5 +12,6 @@ function paintRow(row)',
  lines: [
    { type: 'ctx', text: '  const lane = row.lane;' },
    { type: 'del', text: '  row.style.background = surface;' },
    { type: 'add', text: '  row.style.background = tint(lane, 12);' },
    { type: 'add', text: '  row.classList.toggle("dim", lane !== active);' },
    { type: 'ctx', text: '  return row;' },
  ],
}];

const SETTINGS_PAGES = {
  general: () => {
    const p = state.prefs;
    const custom = (key, ph) => `<input class="input mono" data-pref="${key}" value="${esc(p[key])}" placeholder="${ph}" aria-label="${ph}" />`;
    const editorOpts = (state.editors.length ? state.editors : [
      { id: 'cursor', label: 'Cursor', available: true },
      { id: 'vscode', label: 'VS Code', available: true },
      { id: 'zed', label: 'Zed', available: true },
      { id: 'windsurf', label: 'Windsurf', available: true },
      { id: 'custom', label: 'Other app…', available: true },
    ]).filter((e) => e.available || e.id === p.editor)
      .map((e) => [e.id, e.label]);
    // Bind the select to the *saved* pref — never effectiveEditor(). Using the fallback
    // as the selected value made VS Code snap back to Cursor in the UI after save when
    // detection disagreed, while prefs still held vscode (or the glyph stayed Cursor).
    const eff = effectiveEditor();
    const editorDetail = p.editor !== 'custom' && p.editor !== eff
      ? `Saved ${editorLabelOf(p.editor)} isn’t available — Open uses ${editorLabelOf(eff)}`
      : 'Only apps found on this Mac';

    const tools = state.diffMergeTools.length ? state.diffMergeTools : [
      { id: 'internal', label: 'Built-in', available: true },
      { id: 'opendiff', label: 'FileMerge', available: true },
      { id: 'vscode', label: 'VS Code', available: true },
      { id: 'cursor', label: 'Cursor', available: true },
      { id: 'windsurf', label: 'Windsurf', available: true },
    ];
    const diffOpts = tools.filter((t) => t.available || t.id === p.diffTool).map((t) => [t.id, t.label]);
    const mergeOpts = tools.filter((t) => t.available || t.id === p.mergeTool).map((t) => [t.id, t.label]);
    return `<h1>General</h1><p class="lede">Where Plenum opens editors, terminals, and folders on this Mac.</p>
      <div class="group-head">About</div>
      <div class="list">
        ${settingsRow(
          'plenum',
          'Version',
          '',
          versionDetailHTML(),
          updateControlHTML(),
          'Check, download, then Close & update. Plenum quits and reopens on the new version.',
        )}
        ${updateNotesHTML()}
      </div>
      <div class="group-head">Open with</div>
      <div class="list">
        ${settingsRow(savedEditorIcon(), 'Editor', '', editorDetail, selectHTML('editor', editorOpts, p.editor, 'Editor'), 'Used for Open in editor and after Create lane. Missing installs stay hidden; Open falls back to another installed editor.')}
        ${p.editor === 'custom' ? settingsRow('folder-simple', 'Editor path', '', 'Path to an .app or binary', custom('editorPath', '/Applications/Zed.app'), 'Full path Plenum launches when Editor is Other app.') : ''}
        ${settingsRow('tree-structure', 'Open new lanes in editor', '', 'Right after Create', switchHTML('openLaneInEditor', p.openLaneInEditor, 'Open new lanes in editor'), 'When on, Create also opens that worktree in your editor.')}
        ${settingsRow('terminal-window', 'Terminal', '', 'Palette → Open in terminal', selectHTML('terminal', [['terminal', 'Terminal'], ['iterm', 'iTerm'], ['custom', 'Other app…']], p.terminal, 'Terminal'), 'Which terminal opens a lane folder from the palette.')}
        ${p.terminal === 'custom' ? settingsRow('folder-simple', 'Terminal path', '', 'Path to an .app or binary', custom('terminalPath', '/Applications/Ghostty.app'), 'Full path Plenum launches when Terminal is Other app.') : ''}
      </div>
      <div class="group-head">Diff and merge<span class="soon-tag">Coming soon</span><small>Compare changes and resolve conflicts in the tool you pick.</small></div>
      <div class="list">
        ${settingsRow('files', 'Diff tool', '', 'Compares file changes in a lane', selectHTML('diffTool', diffOpts, p.diffTool, 'Diff tool'), 'Installed tools on this Mac.')}
        ${settingsRow('git-merge', 'Merge tool', '', 'Resolves conflicts when merging lanes', selectHTML('mergeTool', mergeOpts, p.mergeTool, 'Merge tool'), 'Installed tools on this Mac.')}
      </div>
      <div class="group-head">Folders</div>
      <div class="list">
        ${settingsRow('folder-simple', 'Clone path', 'Open Repository starts here', '', custom('cloneDefaultPath', '~/Dev'), 'Folder the Open Repository picker jumps to first. ~/… or an absolute path.')}
        ${settingsRow('tree-structure', 'Lanes folder', 'Default for new repos', 'Override per repo under Repository', custom('defaultLanesFolder', '.worktrees'), 'Where Create lane puts worktrees when a repo has no override. Relative paths sit inside the checkout.')}
      </div>
      <div class="group-head">Tabs</div>
      <div class="list">
        ${settingsRow('arrows-clockwise', 'Reopen tabs', '', 'Restore open repos on launch', switchHTML('reopenTabs', p.reopenTabs, 'Reopen tabs'), 'Off clears the saved tab list on launch so you start empty.')}
        ${settingsRow('globe-simple', 'Repo favicons', '', 'Auto-detect, or rename a tab → Choose image from repo', switchHTML('tabFavicons', p.tabFavicons !== false, 'Repo favicons'), 'Looks for favicon.ico / .svg / .png. Rename a tab to pick a preset or any PNG / JPEG / SVG from the checkout. Off always uses the presets.')}
        ${settingsRow('clock', 'Tab warm time', '', 'How long a left tab stays hot', optionGroup('warmTabTtlMs', WARM_PRESETS.map(([ms, t]) => [ms, t.replace('seconds', 's').replace('minutes', 'min')]), p.warmTabTtlMs, { num: true, label: 'Tab warm time' }), 'Inside this window, switching back paints the last board instantly while git refreshes. After it freezes you still get one instant paint, then a full reload.')}
      </div>
      <div class="group-head">Feedback</div>
      <div class="list">
        ${settingsRow('pencil-simple', 'Feedback prompts', '', 'A rare check-in, and Report on errors', switchHTML('feedbackPrompts', p.feedbackPrompts !== false, 'Feedback prompts'), 'After about a week, then roughly monthly and once after an update, a small card asks how Plenum is going. Good may ask for a GitHub star once; Not great asks what is off. It waits until you have been idle, never covers your work, and fades by itself. Off also hides the Report link on errors. Feedback in the palette always works.')}
        <div data-feedback-queue style="display: contents"></div>
      </div>
`;
  },
  appearance: () => {
    const p = state.prefs;
    const chroma = p.chroma || 'muted';
    return `<h1>Appearance</h1><p class="lede">Theme, surfaces, size, type. Stays on this Mac.</p>
      <div class="group-head">Theme</div>
      <div class="list">
        ${settingsRow('sun', 'Mode', '', 'System follows macOS', optionGroup('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], p.theme, { label: 'Mode' }), 'System tracks light/dark from macOS. Light and Dark stay put.')}
      </div>
      <div class="group-head">Look<small>Every look has a light and a dark side; Mode picks which.</small></div>
      ${themeGridHTML(chroma)}
      <div class="group-head">Preview<small>Sample data. Theme and look only — column layout is under Graph.</small></div>
      <div class="theme-preview" inert aria-hidden="true">
        <div class="graph"><div class="graph-cols" aria-hidden="true"></div><div class="rows"></div></div>
        <div class="file-pane-diff">${renderDiffBody(PREVIEW_HUNKS)}</div>
      </div>
      <div class="group-head">Display</div>
      <div class="list">
        ${settingsRow('magnifying-glass', 'Zoom', '', '', optionGroup('zoom', [[0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%']], p.zoom, { num: true, label: 'Zoom' }), 'Scales the whole window. 100% is the design size.')}
        ${settingsRow('list', 'Font', '', 'Bundled packs; System is SF / UI fonts', optionGroup('fontPack', [['system', 'System'], ['inter-jetbrains', 'Inter + JetBrains Mono'], ['ibm-plex', 'IBM Plex']], p.fontPack, { label: 'Font' }), 'UI text and mono (SHAs, paths). Inter / Plex ship inside Plenum. Switch and it should change right away.')}
        ${settingsRow('user', 'Gravatar avatars', '', 'From commit email', switchHTML('gravatar', p.gravatar !== false, 'Gravatar avatars'), 'Face from a hash of the commit email. No account. Off keeps letter marks only.')}
      </div>
      <div class="group-head">Authorship<small>Read from the commit: Co-authored-by, Made-with, Generated-with, Assisted-by.</small></div>
      <p class="lede ab-lede">When a trailer names a known tool, the graph avatar gets a corner mark. Humans stay plain. The lane tip pill uses the same mark.</p>
      ${authorshipBadgeLegendHTML(iconHTML)}`;
  },
  graph: () => {
    const cols = graphColumnPrefs();
    const onCount = cols.filter((c) => c.on).length;
    const labels = {
      labels: 'Branch / Tag',
      graph: 'Graph',
      author: 'Author',
      commit: 'Commit',
      sha: 'SHA',
      when: 'When',
    };
    const tips = {
      labels: 'Ref pills for the tip commit.',
      graph: 'Lane edges and nodes.',
      author: 'Avatar (Gravatar still under Appearance).',
      commit: 'Subject line.',
      sha: 'Short hash.',
      when: 'Relative time.',
    };
    const rows = cols.map((c, i) => {
      const name = labels[c.id] || GRAPH_COLUMN_META[c.id]?.label || c.id;
      const up = i === 0 ? ' disabled' : '';
      const down = i === cols.length - 1 ? ' disabled' : '';
      const move = `<span class="col-order" role="group" aria-label="Order for ${esc(name)}">
          <button class="iconbtn" type="button" data-col-move="${c.id}" data-dir="-1" title="Move up" aria-label="Move ${esc(name)} up"${up}>${iconHTML('arrow-up', 'sm')}</button>
          <button class="iconbtn" type="button" data-col-move="${c.id}" data-dir="1" title="Move down" aria-label="Move ${esc(name)} down"${down}>${iconHTML('caret-down', 'sm')}</button>
        </span>`;
      const sole = c.on && onCount === 1;
      // Switches use data-graph-col (not data-pref) so we keep order + ≥1-on rules.
      const sw = `<button class="switch${c.on ? ' on' : ''}" type="button" role="switch" aria-checked="${c.on}" aria-label="Show ${esc(name)}" data-graph-col="${c.id}"${sole ? ' aria-disabled="true" title="Keep at least one column on"' : ''}></button>`;
      return settingsRow('list', name, '', `${i + 1} of ${cols.length}`, `${move}${sw}`, tips[c.id] || '');
    }).join('');
    return `<h1>Graph</h1><p class="lede">Show, hide, and reorder columns on the commit table. Stays on this Mac.</p>
      <div class="group-head">Columns<small>At least one stays on. Hidden columns keep their place when you show them again.</small></div>
      <div class="list col-pref-list">${rows}</div>
      <div class="group-head">Preview<small>Sample data — same layout as the board when you go back.</small></div>
      <div class="theme-preview graph-col-preview" inert aria-hidden="true">
        <div class="graph"><div class="graph-cols" aria-hidden="true"></div><div class="rows"></div></div>
      </div>
      <div class="group-head">Reset</div>
      <div class="list">
        ${settingsRow('arrow-counter-clockwise', 'Default columns', '', 'Branch / Tag, Graph, Author, Commit, SHA, When — all on', '<button class="btn" type="button" data-graph-cols-reset>Reset</button>', 'Restores the shipping order and turns every column back on.')}
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
    const saved = (a?.hosts || []).map((h) => `<div class="list-row" title="Host + username Plenum remembers. The token stays in ${where || 'your git credential helper'}.">${iconHTML(h.kind === 'github' ? 'github-logo' : 'key')}<div class="name">${esc(h.host)}<small>${esc(h.username)}</small></div><div class="detail">Token in ${where || 'git credential helper'}</div><span class="status on"><i></i>Saved</span><button class="btn" type="button" data-remove-host="${esc(h.host)}" data-user="${esc(h.username)}">Remove</button></div>`).join('')
      || `<div class="list-row" title="Add a host below so https push/pull can use a token without asking every time.">${iconHTML('key')}<div class="name">None yet</div><div class="detail">https remotes keep asking until you save one.</div><span></span><span></span></div>`;
    const field = (name, ph, type = 'text') => `<input class="input" name="${name}" type="${type}" placeholder="${ph}" aria-label="${ph}" autocomplete="off" required />`;
    const ssh = !a ? '' : a.ssh.state === 'keys' ? `${a.ssh.count} key${a.ssh.count === 1 ? '' : 's'} in ssh-agent` : a.ssh.state === 'none' ? 'ssh-agent has no keys' : 'No ssh-agent running';
    const tab = activeTab();
    const scopeDetail = state.board
      ? (tab ? esc(tab.title) : '')
      : 'Open a repo to set a local identity';
    return `<h1>Accounts</h1><p class="lede">Commit author, and how https remotes log in. Tokens go to git’s helper${where ? ` (${where})` : ''}. Plenum only remembers host + username.</p>
      <div class="group-head">Git identity<small>Writes user.name / user.email in git config, not app prefs.</small></div>
      <div class="list">
        ${settingsRow('user', 'Applies to', '', scopeDetail, optionGroup('identityScope', [['global', 'All repositories'], ...(state.board ? [['local', 'Current repository']] : [])], state.identityScope, { label: 'Identity scope' }), 'All repositories → ~/.gitconfig. Current repository → only the open tab’s local config.')}
        ${settingsRow('user', 'Name', '', '', `<input class="input" data-identity="name" value="${esc(shown.name)}" placeholder="${esc(fallback.name || 'Your name')}" aria-label="Git name" />`, 'Author name on new commits.')}
        ${settingsRow('user', 'Email', '', '', `<input class="input" data-identity="email" value="${esc(shown.email)}" placeholder="${esc(fallback.email || 'you@example.com')}" aria-label="Git email" />`, 'Author email. Same one remotes and hosting expect.')}
      </div>
      <div class="group-head">HTTPS</div>
      <div class="list">${saved}</div>
      <div class="group-head">Add<small>Personal access token with repo scope, not your password.</small></div>
      <div class="list">
        <form class="list-row acct" data-acct="github" title="Saves github.com via git credential approve.">${iconHTML('github-logo')}<div class="name">GitHub<small>github.com</small></div><div class="acct-fields">${field('username', 'Username')}${field('token', 'Personal access token', 'password')}</div><button class="btn primary" type="submit">Save</button><span></span></form>
        <form class="list-row acct" data-acct="https" title="Any https git host. Hostname only, no https://.">${iconHTML('link-simple')}<div class="name">Other host<small>Any https remote</small></div><div class="acct-fields">${field('host', 'git.example.com')}${field('username', 'Username')}${field('token', 'Token', 'password')}</div><button class="btn primary" type="submit">Save</button><span></span></form>
      </div>
      <div class="group-head">SSH<small>Plenum doesn’t manage keys. Git uses ssh-agent and ~/.ssh/config.</small></div>
      <div class="list">${settingsRow('terminal-window', 'ssh-agent', '', '', `<span class="status${a?.ssh.state === 'keys' ? ' on' : ' warn'}"><i></i>${ssh || 'Checking…'}</span>`, 'Status only. Add or unlock keys outside Plenum.')}</div>`;
  },
  repositories: () => {
    const tabs = state.store.tabs;
    if (!tabs.length) {
      return `<h1>Repository</h1><p class="lede">Team branch and lanes folder for the open tab.</p>
      <div class="list">${settingsRow('folder-simple', 'No repository open', '', 'Open one from the empty screen or ⌘P.', '', 'These settings follow the open tab.')}</div>`;
    }
    const head = `<h1>Repository</h1><p class="lede">Team branch and lanes folder for the tab you’re on. Switch tabs to configure another checkout. Start / Test commands live under Lane.</p>`;
    const t = tabs.find((x) => x.id === state.store.activeId) || tabs[0];
    const b = state.repoBoards.get(t.path);
    const root = b?.root || t.path;
    const folder = state.prefs.repoOverrides?.[root]?.lanesFolder || '';
    const laneDetail = !b ? '…'
      : b.hasManifest
        ? `<span class="mono">.plenum/lane.yaml</span>${b.manifestSummary?.run ? ` · run <span class="mono">${esc(b.manifestSummary.run)}</span>` : ''}`
        : 'No lane.yaml yet — open Lane to run setup.';
    return `${head}
      <div class="group-head">${esc(t.title)}<small class="mono">${esc(b?.displayRoot || t.path)}</small></div>
      <div class="list">
        ${settingsRow('shield-check', 'Protected / team branch', b?.teamBranchSource === 'override' ? 'Override (local git config)' : 'Behind counts against this', b ? `<span class="mono">${esc(b.teamRef)}</span>` : '…', b ? teamBranchControlHTML(b, root, t.title) : '', 'Integration tip for ↓↑, Create lane, and merge. Auto re-reads origin/HEAD. Stored as local git config plenum.teamBranch.')}
        ${settingsRow('git-fork', 'Comparison baselines', 'Extra tips to count ↓↑ against', b ? baselinesControlHTML(b, root, t.title) : 'Open a repository first.', '', 'Long-lived tips like demo or staging. Comparison only: they are not protected. Pick one in the Local header. Stored as local git config plenum.baseline.')}
        ${settingsRow('tree-structure', 'Lanes folder', 'Where Create lane puts worktrees', `Blank → <span class="mono">${esc(state.prefs.defaultLanesFolder || '.worktrees')}</span> from General`, `<input class="input" data-lanes-root="${esc(root)}" value="${esc(folder)}" placeholder="${esc(state.prefs.defaultLanesFolder || '.worktrees')}" aria-label="Lanes folder for ${esc(t.title)}" />`, 'This repo only. Relative paths sit under the checkout; absolute paths are fine.')}
        ${settingsRow('stack', 'Lane recipe', 'Start, Test, ports, services', laneDetail, '<button class="btn" type="button" data-open-lane>Open Lane</button>', 'Opens Settings → Lane to edit .plenum/lane.yaml as a form, or run Lane setup when the file is missing.')}
      </div>`;
  },
  lane: () => lanePageHTML(),
  setup: () => setupWizardHTML(),
  statistics: () => statsPageHTML(),
  agents: () => {
    const a = state.agents;
    const head = `<h1>Agents</h1><p class="lede">Let Cursor, Claude Code and Codex create, start and test lanes through Plenum.</p>`;
    if (!a) return `${head}<p class="lede">Loading…</p>`;
    const status = (kind, text) => `<span class="status${kind ? ` ${kind}` : ''}"><i></i>${text}</span>`;
    const btn = (label, attr, primary = false) => `<button class="btn${primary ? ' primary' : ''}" type="button" ${attr}>${label}</button>`;
    const note = (body) => `<div class="agents-note">${body}</div>`;
    const { launcher } = a;
    const cmd = settingsRow('terminal-window', 'plenum', `${esc(state.appInfo.version || '…')} ${betaMarkHTML(true)}`, `<span class="mono">${esc(launcher.shown || launcher.path)}</span>`,
      launcher.onPath ? status('on', 'On your PATH') : btn('Add to PATH', 'data-agent-link'),
      "Lets you type plenum in your own terminal. Agents don't need this.")
      + (!launcher.onPath && agentsView.linkCmd
        ? note(`Plenum can't write to ${esc(launcher.linkPath)} itself. Paste this in Terminal, then check again:<pre>${esc(agentsView.linkCmd)}</pre><div class="row-end">${btn('Copy', 'data-link-copy')}${btn('Check again', 'data-link-recheck', true)}</div>`)
        : '');
    const clientRow = (c) => {
      const id = `data-client="${esc(c.id)}"`;
      const file = esc(c.shown || c.file);
      const row = {
        'not-installed': ['Not installed on this Mac.', ''],
        missing: ["Doesn't know about Plenum yet.", status('warn', 'Missing') + btn('Show lines', `data-agent-lines ${id}`) + btn('Add', `data-agent-add ${id}`, true)],
        ok: [`<span class="mono">${file}</span>`, status('on', 'Set up') + btn('Remove', `data-agent-remove ${id}`)],
        stale: ['Points at an old Plenum.', status('warn', 'Out of date') + btn('Show lines', `data-agent-lines ${id}`) + btn('Fix', `data-agent-add ${id}`, true)],
        unreadable: [`<span class="mono">${file}</span>: ${esc(c.reason)}`, status('warn', "Can't edit")],
      }[c.state] || ['', ''];
      const html = settingsRow('plugs-connected', esc(c.label), '', row[0], row[1] && `<span class="row-actions">${row[1]}</span>`);
      const lines = agentsView.lines[c.id];
      return (c.state === 'not-installed' ? html.replace('class="list-row"', 'class="list-row off"') : html)
        + ((c.state === 'missing' || c.state === 'stale') && lines ? note(`Adds to <span class="mono">${esc(c.shown || lines.file)}</span>:<pre>${esc(lines.lines)}</pre>`) : '')
        + (c.state === 'ok' && agentsView.restart[c.id] ? note(`Restart ${esc(c.label)} to pick it up.`) : '');
    };
    const tabs = state.store.tabs;
    const repos = !tabs.length
      ? `<p class="lede">Open a repository to see whether agents can run it.</p>`
      : `<div class="list">${tabs.map((t) => {
        const b = state.repoBoards.get(t.path);
        const root = b?.root || t.path;
        return settingsRow('folder-simple', esc(t.title), '', b && !b.hasManifest ? 'No lane setup yet. Agents can create lanes but not start them.' : '',
          !b ? status('', 'Loading…') : b.hasManifest ? status('on', 'Ready for agents') : btn('Lane setup…', `data-setup-root="${esc(root)}"`));
      }).join('')}</div>`;
    const s = a.settings;
    const sw = (key, label) => `<button class="switch${s[key] ? ' on' : ''}" type="button" role="switch" aria-checked="${!!s[key]}" aria-label="${label}" data-agent-set="${key}"></button>`;
    const sel = (key, label) => `<select class="select" aria-label="${label}" data-agent-set="${key}">${[['allow', 'Allow'], ['never', 'Never']].map(([v, t]) => `<option value="${v}"${s[key] === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    return `${head}
      <div class="group-head">Command</div>
      <div class="list">${cmd}</div>
      <div class="group-head">Clients<small>What each tool needs to reach Plenum.</small></div>
      <div class="list">${a.clients.map(clientRow).join('')}</div>
      <div class="group-head">Repositories<small>Agents can only start lanes where the repo has lane setup.</small></div>
      ${repos}
      <div class="group-head">What agents may do<small>Applies to Plenum's agent tools, not the <span class="mono">plenum</span> command in a shell. Commit, push and merge stay with whoever is in the lane.</small></div>
      <div class="list">
        ${settingsRow('play', 'Start, stop and test lanes', '<span class="mono">lane.up, lane.down, lane.test</span>', '', sw('run', 'Start, stop and test lanes'), "Lets agents run the repo's start, stop and test commands on lane ports. Starting past the migration check stays with you.")}
        ${settingsRow('tree-structure', 'Create lanes', '<span class="mono">lane.create</span>', '', sw('create', 'Create lanes'), 'Lets agents create worktrees from the team branch.')}
        ${settingsRow('warning-circle', 'Remove lanes', '<span class="mono">lane.remove</span>', '', sel('remove', 'Remove lanes'), 'Agents can remove lanes that are safe to remove. Unsafe ones stay with you on the board.')}
        ${settingsRow('files', 'Write lane setup', '<span class="mono">repo.doctor</span>', '', sel('writeSetup', 'Write lane setup'), 'Lets an agent create .plenum/lane.yaml in a repo that has none. It never replaces one.')}
      </div>`;
  },
};

function openLaneSetup(root = state.board?.root) {
  state.settings.setupRoot = root;
  state.settings.setupTabId = state.store.activeId;
  openSettings('setup');
}

function manifestToDraft(m) {
  const services = m?.services && typeof m.services === 'object' ? m.services : {};
  return {
    setup: m?.setup || '',
    run: m?.run || '',
    test: m?.test || '',
    env: {
      copy: [...(m?.env?.copy || [])],
      set: { ...(m?.env?.set || {}) },
    },
    ports: {
      offset: m?.ports?.offset ?? 100,
      expose: { ...(m?.ports?.expose || {}) },
    },
    services: Object.entries(services).map(([name, svc]) => ({
      name,
      mode: svc?.mode || 'shared',
      snapshot: svc?.snapshot || '',
      teardown: svc?.teardown || '',
    })),
    data: {
      migrations: m?.data?.migrations || '',
      snapshot: m?.data?.snapshot || '',
    },
  };
}

function draftToWritePayload(d) {
  const services = {};
  for (const svc of d.services || []) {
    const name = String(svc.name || '').trim();
    if (!name) continue;
    services[name] = {
      mode: svc.mode || 'shared',
      snapshot: svc.snapshot || undefined,
      teardown: svc.teardown || undefined,
    };
  }
  return {
    version: 1,
    setup: d.setup || undefined,
    run: d.run || undefined,
    test: d.test || undefined,
    env: {
      copy: [...(d.env?.copy || [])].map(String).filter(Boolean),
      set: { ...(d.env?.set || {}) },
    },
    ports: {
      offset: Number(d.ports?.offset ?? 100),
      expose: { ...(d.ports?.expose || {}) },
    },
    services,
    data: {
      migrations: d.data?.migrations || undefined,
      snapshot: d.data?.snapshot || undefined,
    },
  };
}

function laneDraftDirty(lane = state.lane) {
  if (!lane?.draft || !lane.lastLoadedDraft) return false;
  return JSON.stringify(lane.draft) !== JSON.stringify(lane.lastLoadedDraft);
}

function rememberLaneDraft(lane = state.lane) {
  if (!lane?.root) return;
  state.laneByRoot.set(lane.root, {
    draft: lane.draft ? structuredClone(lane.draft) : null,
    lastLoadedText: lane.lastLoadedText,
    lastLoadedDraft: lane.lastLoadedDraft ? structuredClone(lane.lastLoadedDraft) : null,
  });
}

function activeLaneRoot() {
  const t = activeTab();
  if (!t) return null;
  const b = state.repoBoards.get(t.path);
  if (b?.root) return b.root;
  if (state.board?.root) return state.board.root;
  return t.path;
}

async function loadLane({ force = false } = {}) {
  seedActiveRepoBoard();
  const t = activeTab();
  if (!t) {
    state.lane = null;
    if (state.settings.open && state.settings.page === 'lane') renderSettings();
    return;
  }
  const root = activeLaneRoot();
  const cached = state.laneByRoot.get(root);
  const keepDirty = !force && cached?.draft && cached.lastLoadedDraft
    && JSON.stringify(cached.draft) !== JSON.stringify(cached.lastLoadedDraft);
  state.lane = {
    root,
    loading: true,
    path: null,
    text: null,
    error: null,
    diskChanged: false,
    draft: keepDirty ? structuredClone(cached.draft) : null,
    lastLoadedText: cached?.lastLoadedText ?? null,
    lastLoadedDraft: keepDirty ? structuredClone(cached.lastLoadedDraft) : null,
  };
  if (state.settings.open && state.settings.page === 'lane') renderSettings();
  const seq = state.switchSeq;
  try {
    const res = await invoke('repo.getManifest', root);
    if (seq !== state.switchSeq || activeLaneRoot() !== root) return;
    const nextDraft = res.manifest ? manifestToDraft(res.manifest) : null;
    if (keepDirty && state.lane.draft) {
      state.lane = {
        ...state.lane,
        loading: false,
        path: res.path,
        text: res.text,
        error: res.error,
        diskChanged: !!(res.text != null && state.lane.lastLoadedText != null && res.text !== state.lane.lastLoadedText),
      };
    } else {
      state.lane = {
        root,
        loading: false,
        path: res.path,
        text: res.text,
        error: res.error,
        diskChanged: false,
        draft: nextDraft,
        lastLoadedText: res.text,
        lastLoadedDraft: nextDraft ? structuredClone(nextDraft) : null,
      };
      rememberLaneDraft(state.lane);
    }
  } catch {
    if (seq !== state.switchSeq || activeLaneRoot() !== root) return;
    state.lane = { ...state.lane, loading: false, error: 'Could not read lane.yaml' };
  }
  if (state.settings.open && state.settings.page === 'lane' && activeLaneRoot() === root) renderSettings();
}

function lanePageHTML() {
  const tabs = state.store.tabs;
  if (!tabs.length) {
    return `<h1>Lane</h1><p class="lede">Edit <span class="mono">.plenum/lane.yaml</span> for the open repository — Start, Test, ports, env, and services.</p>
      <div class="list">${settingsRow('folder-simple', 'No repository open', '', 'Open one from the empty screen or ⌘P.', '', 'Lane settings follow the open tab’s primary checkout.')}</div>`;
  }
  const t = tabs.find((x) => x.id === state.store.activeId) || tabs[0];
  const b = state.repoBoards.get(t.path);
  const lane = state.lane;
  const head = `<h1>Lane</h1><p class="lede">Recipe for Start / Stop / Test on this repo (<span class="mono">.plenum/lane.yaml</span>). Edits apply to every worktree.</p>
    <div class="group-head">${esc(t.title)}<small class="mono">${esc(b?.displayRoot || lane?.root || t.path)}</small></div>`;
  if (!lane || lane.loading) {
    return `${head}<div class="list">${settingsRow('stack', 'Lane recipe', '', '', '<span class="status"><i></i>Loading…</span>', 'Reads the live manifest from the primary checkout.')}</div>`;
  }
  if (!lane.text && !lane.error) {
    return `${head}<div class="list">${settingsRow('stethoscope', 'Lane recipe', 'No .plenum/lane.yaml yet', 'Lanes still show; they just can’t start until you write a recipe.', `<span class="row-actions"><span class="status warn"><i></i>Not runnable</span><button class="btn primary" type="button" data-setup-root="${esc(lane.root)}" title="Doctor the repo and review a proposed lane.yaml">${iconHTML('stethoscope', 'sm')}Lane setup…</button></span>`, 'Doctor reads the repo and proposes a manifest. Write from the setup page.')}</div>`;
  }
  if (lane.error || !lane.draft) {
    return `${head}
      <div class="list">${settingsRow('warning-circle', 'Can’t parse lane.yaml', '', esc(lane.error || 'Invalid manifest'), `<span class="row-actions"><span class="status warn"><i></i>Not runnable</span><button class="btn" type="button" data-edit-manifest="${esc(lane.root)}" title="Open .plenum/lane.yaml in your editor">${iconHTML('pencil-simple', 'sm')}Edit file</button><button class="btn" type="button" data-lane-reload>Reload</button></span>`, 'Fix the file in your editor, then Reload. This page only form-edits a parseable v1 manifest.')}</div>
      <div class="group-head">Raw file</div>
      <pre class="setup-yaml mono" tabindex="0">${esc(lane.text || '')}</pre>`;
  }
  const d = lane.draft;
  const dirty = laneDraftDirty(lane);
  const status = `<span class="status on"><i></i>Runnable</span>`;
  const disk = lane.diskChanged
    ? settingsRow('arrows-clockwise', 'File changed on disk', '', 'Your form has unsaved edits. Reload drops them and takes the file.', '<button class="btn" type="button" data-lane-reload>Reload</button>', 'Someone (or Edit file) changed .plenum/lane.yaml while this form was open.')
    : '';
  const exposeEntries = Object.entries(d.ports.expose || {});
  const exposeRows = (exposeEntries.length ? exposeEntries : [['', '']]).map(([name, port], i) =>
    `<div class="setup-port-row port"><input class="input mono" data-lane-expose-name="${i}" value="${esc(name)}" placeholder="web" aria-label="Port name ${i + 1}" /><input class="input mono" data-lane-expose-port="${i}" value="${esc(port)}" placeholder="5173" aria-label="Base port ${i + 1}" /><button class="iconbtn" type="button" data-lane-row-remove title="Remove" aria-label="Remove ${i + 1}">${iconHTML('x', 'sm')}</button></div>`).join('');
  const copyList = (d.env.copy || []).length
    ? (d.env.copy || []).map((p, i) =>
      `<div class="setup-port-row"><input class="input mono" data-lane-copy="${i}" value="${esc(p)}" placeholder=".env" aria-label="Env copy ${i + 1}" /><button class="iconbtn" type="button" data-lane-copy-remove="${i}" title="Remove" aria-label="Remove env copy">${iconHTML('x', 'sm')}</button></div>`).join('')
    : `<div class="lane-empty">None yet — copy untracked env files into each lane on prepare.</div>`;
  const setEntries = Object.entries(d.env.set || {});
  const setRows = (setEntries.length ? setEntries : [['', '']]).map(([k, v], i) =>
    `<div class="setup-port-row pair"><input class="input mono" data-lane-set-key="${i}" value="${esc(k)}" placeholder="VITE_API_URL" aria-label="Env key ${i + 1}" /><input class="input mono" data-lane-set-val="${i}" value="${esc(v)}" placeholder="http://127.0.0.1:{port.api}" aria-label="Env value ${i + 1}" /><button class="iconbtn" type="button" data-lane-row-remove title="Remove" aria-label="Remove ${i + 1}">${iconHTML('x', 'sm')}</button></div>`).join('');
  const svcRows = (d.services || []).map((svc, i) => {
    const mode = svc.mode || 'shared';
    const modeSel = `<select class="select" data-lane-svc-mode="${i}" aria-label="Mode for ${esc(svc.name || `service ${i + 1}`)}">${[['shared', 'shared'], ['snapshot', 'snapshot'], ['isolated', 'isolated']].map(([v, t]) => `<option value="${v}"${mode === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    return `${settingsRow('database', esc(svc.name || `Service ${i + 1}`), 'Name + mode', '', `<span class="row-actions"><input class="input mono" data-lane-svc-name="${i}" value="${esc(svc.name || '')}" placeholder="db" aria-label="Service name" />${modeSel}<button class="iconbtn" type="button" data-lane-svc-remove="${i}" title="Remove service" aria-label="Remove service">${iconHTML('x', 'sm')}</button></span>`, 'shared = one instance for every lane; snapshot seeds a copy before Start; isolated is reserved for future per-lane data.')}
      ${settingsRow('database', 'Snapshot', 'Command before Start', '', `<input class="input mono" data-lane-svc-snap="${i}" value="${esc(svc.snapshot || '')}" placeholder="pg_dump …" aria-label="Snapshot command" />`, 'Required when mode is snapshot (or set data.snapshot below).')}
      ${settingsRow('arrow-counter-clockwise', 'Teardown', 'Optional', '', `<input class="input mono" data-lane-svc-tear="${i}" value="${esc(svc.teardown || '')}" placeholder="dropdb …" aria-label="Teardown command" />`, 'Parsed today; not run automatically yet.')}`;
  }).join('');
  const foot = `<div class="foot lane-foot"${dirty ? '' : ' hidden'}><div class="row-end"><button class="btn" type="button" data-lane-revert>Revert</button><button class="btn primary" type="button" data-lane-save>${iconHTML('files', 'sm')}Save</button></div></div>`;
  return `${head}
    <div class="list">
      ${settingsRow('stack', 'Lane recipe', '<span class="mono">.plenum/lane.yaml</span>', `<span data-lane-state>${dirty ? 'Unsaved changes' : 'Saved'}</span>`, `<span class="row-actions">${status}<button class="btn" type="button" data-edit-manifest="${esc(lane.root)}" title="Open .plenum/lane.yaml in your editor">${iconHTML('pencil-simple', 'sm')}Edit file</button><button class="btn" type="button" data-setup-root="${esc(lane.root)}" title="Doctor the repo and review a proposed lane.yaml">${iconHTML('stethoscope', 'sm')}Re-run setup</button></span>`, 'Save writes the form to disk. Re-run setup replaces the file from a doctor proposal (comments in the yaml are lost).')}
      ${disk}
    </div>
    <div class="group-head">Commands</div>
    <div class="list">
      ${settingsRow('play', 'run', 'Required — Start', '', `<input class="input mono" data-lane-field="run" value="${esc(d.run || '')}" placeholder="npm run dev -- --port {port.web}" aria-label="run" />`, 'What Plenum runs when you press Start. Use {port.web} for the lane port.')}
      ${settingsRow('check-circle', 'test', 'Optional', '', `<input class="input mono" data-lane-field="test" value="${esc(d.test || '')}" placeholder="npm test" aria-label="test" />`, 'Lane Test button / lane.test.')}
      ${settingsRow('gear-six', 'setup', 'On create / Open as lane', '', `<input class="input mono" data-lane-field="setup" value="${esc(d.setup || '')}" placeholder="npm install" aria-label="setup" />`, 'Runs once when preparing a worktree.')}
    </div>
    <div class="group-head">Ports<small>Base + offset × lane index. Protected is index 0.</small></div>
    <div class="list">
      ${settingsRow('plugs-connected', 'Offset', '', '', `<input class="input mono" data-lane-field="offset" type="number" min="0" value="${esc(d.ports.offset ?? 100)}" aria-label="Port offset" />`, 'Each lane adds offset × index to every exposed base port.')}
    </div>
    <div class="col-head">Expose</div>
    <div class="setup-ports" data-lane-expose-list>${exposeRows}</div>
    <button class="btn" type="button" data-lane-add-port>${iconHTML('plus', 'sm')}Add port</button>
    <div class="group-head">Environment<small>Don’t put secrets in env.set — prefer env.copy of untracked files.</small></div>
    <div class="col-head">env.copy</div>
    <div class="setup-ports">${copyList}</div>
    <button class="btn" type="button" data-lane-add-copy>${iconHTML('plus', 'sm')}Add path</button>
    <div class="col-head">env.set</div>
    <div class="setup-ports">${setRows}</div>
    <button class="btn" type="button" data-lane-add-set>${iconHTML('plus', 'sm')}Add variable</button>
    <div class="group-head">Services<small>shared by default; snapshot seeds before Start.</small></div>
    <div class="list">${svcRows || settingsRow('database', 'No named services', '', 'Add one if you need snapshot isolation.', '', 'Without services, data is shared across lanes.')}</div>
    <button class="btn" type="button" data-lane-add-svc>${iconHTML('plus', 'sm')}Add service</button>
    <div class="group-head">Data</div>
    <div class="list">
      ${settingsRow('files', 'Migrations', 'Relative path', '', `<input class="input mono" data-lane-field="migrations" value="${esc(d.data.migrations || '')}" placeholder="db/migrations" aria-label="Migrations path" />`, 'When set with shared services, Start gates on pending migrations.')}
      ${settingsRow('database', 'Default snapshot', 'Fallback seed', '', `<input class="input mono" data-lane-field="dataSnapshot" value="${esc(d.data.snapshot || '')}" placeholder="echo seed" aria-label="Data snapshot command" />`, 'Used when a snapshot service has no per-service snapshot command.')}
    </div>
    ${foot}`;
}

function syncLaneDraftFromDom(root) {
  const lane = state.lane;
  if (!lane?.draft) return;
  const d = lane.draft;
  const field = (key) => root.querySelector(`[data-lane-field="${key}"]`);
  if (field('run')) d.run = field('run').value;
  if (field('test')) d.test = field('test').value;
  if (field('setup')) d.setup = field('setup').value;
  if (field('offset')) d.ports.offset = Number(field('offset').value) || 0;
  if (field('migrations')) d.data.migrations = field('migrations').value;
  if (field('dataSnapshot')) d.data.snapshot = field('dataSnapshot').value;
  const expose = {};
  root.querySelectorAll('[data-lane-expose-name]').forEach((n) => {
    const i = n.dataset.laneExposeName;
    const port = root.querySelector(`[data-lane-expose-port="${i}"]`)?.value;
    const name = n.value.trim();
    if (name && port !== '' && port != null) expose[name] = Number(port);
  });
  d.ports.expose = expose;
  const copy = [];
  root.querySelectorAll('[data-lane-copy]').forEach((n) => {
    const v = n.value.trim();
    if (v) copy.push(v);
  });
  d.env.copy = copy;
  const set = {};
  root.querySelectorAll('[data-lane-set-key]').forEach((n) => {
    const i = n.dataset.laneSetKey;
    const key = n.value.trim();
    const val = root.querySelector(`[data-lane-set-val="${i}"]`)?.value ?? '';
    if (key) set[key] = val;
  });
  d.env.set = set;
  root.querySelectorAll('[data-lane-svc-name]').forEach((n) => {
    const i = Number(n.dataset.laneSvcName);
    if (!d.services[i]) return;
    d.services[i].name = n.value;
    d.services[i].mode = root.querySelector(`[data-lane-svc-mode="${i}"]`)?.value || 'shared';
    d.services[i].snapshot = root.querySelector(`[data-lane-svc-snap="${i}"]`)?.value || '';
    d.services[i].teardown = root.querySelector(`[data-lane-svc-tear="${i}"]`)?.value || '';
  });
  rememberLaneDraft(lane);
}

function bindLane(root) {
  const rerender = () => {
    rememberLaneDraft();
    renderSettings();
  };
  const bump = () => {
    syncLaneDraftFromDom(root);
    rememberLaneDraft();
    // Toggle in place: a remount here would steal focus from the field being typed in.
    const dirty = laneDraftDirty();
    const foot = root.querySelector('.lane-foot');
    if (foot) foot.hidden = !dirty;
    const label = root.querySelector('[data-lane-state]');
    if (label) label.textContent = dirty ? 'Unsaved changes' : 'Saved';
  };
  root.querySelectorAll('[data-open-lane]').forEach((b) => b.addEventListener('click', () => openSettings('lane')));
  root.querySelectorAll('[data-setup-root]').forEach((b) => b.addEventListener('click', () => openLaneSetup(b.dataset.setupRoot)));
  root.querySelectorAll('[data-edit-manifest]').forEach((b) => b.addEventListener('click', () => {
    const file = `${b.dataset.editManifest}/.plenum/lane.yaml`;
    invoke('os.openEditor', file).catch(() => {});
  }));
  root.querySelector('[data-lane-reload]')?.addEventListener('click', () => {
    state.laneByRoot.delete(state.lane?.root);
    loadLane({ force: true });
  });
  root.querySelector('[data-lane-revert]')?.addEventListener('click', () => {
    if (!state.lane?.lastLoadedDraft) return;
    state.lane.draft = structuredClone(state.lane.lastLoadedDraft);
    state.lane.diskChanged = false;
    rememberLaneDraft();
    renderSettings();
    toast('Reverted', 'ok');
  });
  root.querySelector('[data-lane-save]')?.addEventListener('click', async () => {
    syncLaneDraftFromDom(root);
    const d = state.lane?.draft;
    if (!d?.run?.trim()) {
      toast('Needs a run command', 'warn');
      return;
    }
    try {
      const board = await invoke('repo.writeManifest', draftToWritePayload(d), state.lane.root);
      state.repoBoards.delete(state.lane.root);
      if (board.root === state.board?.root) applyBoard(board);
      else {
        board.displayRoot = await prettyPath(board.root);
        state.repoBoards.set(activeTab()?.path || state.lane.root, board);
      }
      const next = manifestToDraft(draftToWritePayload(d));
      state.lane = {
        ...state.lane,
        draft: next,
        lastLoadedDraft: structuredClone(next),
        lastLoadedText: null,
        diskChanged: false,
        error: null,
      };
      // Refresh text from disk for future disk-change detection.
      try {
        const res = await invoke('repo.getManifest', state.lane.root);
        state.lane.lastLoadedText = res.text;
        state.lane.text = res.text;
        state.lane.path = res.path;
      } catch { /* keep form */ }
      rememberLaneDraft();
      toast('Saved .plenum/lane.yaml', 'ok');
      renderSettings();
    } catch { /* toasted */ }
  });
  root.querySelector('[data-lane-add-port]')?.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    const expose = state.lane.draft.ports.expose;
    let n = 1;
    while (expose[`port${n}`]) n += 1;
    expose[`port${n}`] = 3000;
    rerender();
  });
  root.querySelector('[data-lane-add-copy]')?.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    state.lane.draft.env.copy.push('.env');
    rerender();
  });
  root.querySelectorAll('[data-lane-copy-remove]').forEach((b) => b.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    state.lane.draft.env.copy.splice(Number(b.dataset.laneCopyRemove), 1);
    rerender();
  }));
  root.querySelectorAll('[data-lane-row-remove]').forEach((b) => b.addEventListener('click', () => {
    b.closest('.setup-port-row').remove(); // sync rebuilds expose / env.set from the rows left in the DOM
    syncLaneDraftFromDom(root);
    rerender();
  }));
  root.querySelector('[data-lane-add-set]')?.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    const set = state.lane.draft.env.set;
    let k = 'VAR';
    let n = 1;
    while (set[k]) { k = `VAR${n}`; n += 1; }
    set[k] = '';
    rerender();
  });
  root.querySelector('[data-lane-add-svc]')?.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    state.lane.draft.services.push({ name: 'db', mode: 'shared', snapshot: '', teardown: '' });
    rerender();
  });
  root.querySelectorAll('[data-lane-svc-remove]').forEach((b) => b.addEventListener('click', () => {
    syncLaneDraftFromDom(root);
    state.lane.draft.services.splice(Number(b.dataset.laneSvcRemove), 1);
    rerender();
  }));
  root.querySelectorAll('input, select').forEach((n) => {
    n.addEventListener('input', bump);
    n.addEventListener('change', bump);
  });
}

/** Seed Repository settings from the live board so controls never stay on the previous tab. */
function seedActiveRepoBoard() {
  const t = activeTab();
  if (!t || !state.board) return;
  state.repoBoards.set(t.path, state.board);
}

async function loadSetup(root) {
  state.setup = {
    root,
    loading: true,
    step: state.setup?.root === root ? (state.setup.step || 0) : 0,
    findings: [],
    proposedYaml: '',
    proposed: null,
    hits: [],
    wiring: null,
    canAccept: false,
    draft: state.setup?.root === root ? state.setup.draft : null,
    sharedAck: false,
  };
  renderSettings();
  try {
    const res = await invoke('repo.doctor', root);
    if (state.setup?.root !== root) return;
    const proposed = res.proposed || {};
    state.setup = {
      ...state.setup,
      loading: false,
      findings: res.findings || [],
      proposedYaml: res.proposedYaml || '',
      proposed,
      hits: res.hits || [],
      wiring: res.wiring || null,
      canAccept: !!res.canAccept,
      draft: state.setup.draft || {
        run: proposed.run || '',
        test: proposed.test || '',
        setup: proposed.setup || '',
        offset: proposed.ports?.offset ?? 100,
        expose: { ...(proposed.ports?.expose || {}) },
        envCopy: [...(proposed.env?.copy || [])],
        envSet: { ...(proposed.env?.set || {}) },
      },
    };
  } catch {
    state.setup = { ...state.setup, loading: false };
  }
  if (state.settings.open && state.settings.page === 'setup') renderSettings();
}

function setupYamlHasRun(text) {
  return /^run:\s*\S+/m.test(String(text || ''));
}

function draftToYaml(d) {
  const lines = ['version: 1'];
  if (d.setup) lines.push(`setup: ${JSON.stringify(d.setup)}`);
  if (d.run) lines.push(`run: ${JSON.stringify(d.run)}`);
  if (d.test) lines.push(`test: ${JSON.stringify(d.test)}`);
  lines.push('env:', '  copy:');
  for (const p of d.envCopy || []) lines.push(`    - ${JSON.stringify(p)}`);
  const set = d.envSet || {};
  if (Object.keys(set).length) {
    lines.push('  set:');
    for (const [k, v] of Object.entries(set)) lines.push(`    ${k}: ${JSON.stringify(v)}`);
  }
  lines.push('ports:', `  offset: ${Number(d.offset) || 100}`, '  expose:');
  for (const [k, v] of Object.entries(d.expose || {})) {
    if (k && v != null && v !== '') lines.push(`    ${k}: ${Number(v)}`);
  }
  return `${lines.join('\n')}\n`;
}

const SETUP_STEPS = [
  'What setup does',
  'Start command',
  'Named ports',
  'Port hits & wires',
  'Prepare',
  'Review & write',
];

function setupWizardHTML() {
  const s = state.setup;
  const tab = state.store.tabs.find((t) => t.path === s?.root);
  const step = Math.max(0, Math.min(SETUP_STEPS.length - 1, s?.step || 0));
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#" data-crumb>Lane</a>${iconHTML('caret-right', 'sm')}<span>${esc(tab?.title || s?.root || '')}</span></nav>`;
  if (!s || s.loading) {
    return `${crumbs}<h1>Lane setup</h1><p class="lede">Reading the repo…</p>`;
  }
  const bar = `<div class="setup-steps" role="tablist" aria-label="Setup steps">${SETUP_STEPS.map((label, i) =>
    `<button type="button" class="setup-step${i === step ? ' current' : ''}${i < step ? ' done' : ''}" data-goto-step="${i}" role="tab" aria-selected="${i === step}">${esc(label)}</button>`).join('')}</div>`;
  const d = s.draft || {};
  let body = '';
  if (step === 0) {
    body = `<h1>What setup does</h1>
      <p class="lede">Writes one recipe (<span class="mono">.plenum/lane.yaml</span>) so Plenum can Start, Stop, and Test each worktree on its own ports — without switching Protected’s checkout.</p>
      <p class="lede">Worktrees with the recipe applied show under Lanes; the rest stay under Worktrees until you Open as lane. Data is shared by default (local throwaway DBs only); isolation needs a snapshot seed.</p>`;
  } else if (step === 1) {
    body = `<h1>Start command</h1>
      <p class="lede">What Plenum runs when you press Start. Use <span class="mono">{'{port.web}'}</span> if the process should bind the lane’s port.</p>
      <label class="field">run<input class="input mono" data-draft="run" value="${esc(d.run || '')}" placeholder="npm run dev -- --port {port.web}" /></label>
      <label class="field">test <span class="muted">(optional)</span><input class="input mono" data-draft="test" value="${esc(d.test || '')}" placeholder="npm test" /></label>`;
  } else if (step === 2) {
    const exposeRows = Object.entries(d.expose || {}).map(([name, port], i) =>
      `<div class="setup-port-row"><input class="input mono" data-expose-name="${i}" value="${esc(name)}" placeholder="web" /><input class="input mono" data-expose-port="${i}" value="${esc(port)}" placeholder="5173" /></div>`).join('')
      || `<div class="setup-port-row"><input class="input mono" data-expose-name="0" value="web" placeholder="web" /><input class="input mono" data-expose-port="0" value="5173" placeholder="5173" /></div>`;
    body = `<h1>Named ports</h1>
      <p class="lede">Base ports plus an offset × lane index so each worktree stays unique. Protected uses index 0 (base ports).</p>
      <label class="field">Offset<input class="input mono" data-draft="offset" type="number" min="0" value="${esc(d.offset ?? 100)}" /></label>
      <div class="col-head">Expose</div>
      <div class="setup-ports" data-expose-list>${exposeRows}</div>
      <button class="btn" type="button" data-add-port>${iconHTML('plus', 'sm')}Add port</button>`;
  } else if (step === 3) {
    const hits = s.hits || [];
    const hitRows = hits.length
      ? hits.slice(0, 24).map((h) => `<div class="list-row compact" data-hit-hash="${esc(h.hash)}" data-hit-path="${esc(h.path)}" data-hit-line="${esc(h.line)}">
          ${iconHTML('warning-circle')}
          <div class="name"><span class="mono">${esc(h.path)}:${h.line}</span><small class="mono">${esc(h.snippet)}</small></div>
          <button class="btn" type="button" data-allow-hit>Allowlist</button>
        </div>`).join('')
      : `<div class="list-row compact"><div class="name">No open port hits</div></div>`;
    const wires = Object.entries(d.envSet || {}).map(([k, v]) =>
      `<div class="setup-port-row"><input class="input mono" data-wire-key value="${esc(k)}" /><input class="input mono" data-wire-val value="${esc(v)}" /></div>`).join('');
    const proposed = s.wiring?.proposedWires || {};
    body = `<h1>Port hits & wires</h1>
      <p class="lede">Hard-coded localhost ports break per-lane listeners. Wire them with <span class="mono">env.set</span> and <span class="mono">{'{port.*}'}</span>, or allowlist intentional ones.</p>
      <div class="col-head">Open hits</div>
      <div class="list">${hitRows}</div>
      <div class="col-head">env.set wires</div>
      <div class="setup-ports" data-wire-list>${wires || `<div class="setup-port-row"><input class="input mono" data-wire-key placeholder="VITE_API_URL" /><input class="input mono" data-wire-val placeholder="http://127.0.0.1:{port.api}" /></div>`}</div>
      <div class="row-end">
        ${Object.keys(proposed).length ? `<button class="btn" type="button" data-apply-wires>Apply proposed wires</button>` : ''}
        <button class="btn" type="button" data-add-wire>${iconHTML('plus', 'sm')}Add wire</button>
      </div>`;
  } else if (step === 4) {
    body = `<h1>Prepare</h1>
      <p class="lede">Runs once when a lane is created or repaired. Copy local secrets from Protected; never commit them.</p>
      <label class="field">setup<input class="input mono" data-draft="setup" value="${esc(d.setup || '')}" placeholder="npm install" /></label>
      <label class="field">env.copy <span class="muted">(one path per line)</span>
        <textarea class="setup-yaml mono" data-draft-copy rows="4" spellcheck="false">${esc((d.envCopy || []).join('\n'))}</textarea>
      </label>`;
  } else {
    const yaml = s.proposedYaml || draftToYaml(d);
    body = `<h1>Review & write</h1>
      <p class="lede">Shared data is the default. Confirm you understand, then write the recipe.</p>
      <label class="check"><input type="checkbox" data-shared-ack${s.sharedAck ? ' checked' : ''} /> I understand lanes share one local throwaway database by default — not staging or production.</label>
      <details class="setup-advanced"${s.showYaml ? ' open' : ''}>
        <summary>Advanced YAML</summary>
        <textarea class="setup-yaml mono" data-setup-yaml spellcheck="false" aria-label="Proposed lane.yaml">${esc(yaml)}</textarea>
      </details>
      <div class="finding">${iconHTML('plugs-connected', 'sm')}<div>Same proposal from <span class="mono">plenum doctor</span> / MCP <span class="mono">repo.doctor</span>.</div></div>`;
  }
  const back = step > 0 ? `<button class="btn" type="button" data-setup-back>Back</button>` : `<button class="btn" type="button" data-crumb>Cancel</button>`;
  const next = step < SETUP_STEPS.length - 1
    ? `<button class="btn primary" type="button" data-setup-next>Continue</button>`
    : `<button class="btn primary" type="button" data-write${s.sharedAck && setupYamlHasRun(s.proposedYaml || draftToYaml(d)) ? '' : ' disabled'}>${iconHTML('files', 'sm')}Write <span class="mono">.plenum/lane.yaml</span></button>`;
  return `${crumbs}${bar}${body}<div class="foot"><div class="row-end">${back}${next}</div></div>`;
}

function syncSetupDraft(root) {
  const s = state.setup;
  if (!s?.draft) return;
  const d = s.draft;
  root.querySelectorAll('[data-draft]').forEach((inp) => {
    const key = inp.dataset.draft;
    d[key] = inp.type === 'number' ? Number(inp.value) : inp.value;
  });
  const copy = root.querySelector('[data-draft-copy]');
  if (copy) d.envCopy = copy.value.split(/\n/).map((x) => x.trim()).filter(Boolean);
  const expose = {};
  root.querySelectorAll('[data-expose-name]').forEach((inp) => {
    const i = inp.dataset.exposeName;
    const name = inp.value.trim();
    const port = root.querySelector(`[data-expose-port="${i}"]`)?.value;
    if (name && port) expose[name] = Number(port);
  });
  if (root.querySelector('[data-expose-list]')) d.expose = expose;
  const envSet = {};
  const keys = [...root.querySelectorAll('[data-wire-key]')];
  const vals = [...root.querySelectorAll('[data-wire-val]')];
  keys.forEach((inp, i) => {
    const k = inp.value.trim();
    const v = vals[i]?.value ?? '';
    if (k) envSet[k] = v;
  });
  if (keys.length) d.envSet = envSet;
  s.proposedYaml = draftToYaml(d);
  s.canAccept = setupYamlHasRun(s.proposedYaml);
}

function bindSetup(root) {
  const s = state.setup;
  root.querySelectorAll('[data-crumb]').forEach((n) => n.addEventListener('click', (e) => { e.preventDefault(); openSettings('lane'); }));
  root.querySelectorAll('[data-goto-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncSetupDraft(root);
      s.step = Number(btn.dataset.gotoStep);
      renderSettings();
    });
  });
  root.querySelector('[data-setup-back]')?.addEventListener('click', () => {
    syncSetupDraft(root);
    s.step = Math.max(0, (s.step || 0) - 1);
    renderSettings();
  });
  root.querySelector('[data-setup-next]')?.addEventListener('click', () => {
    syncSetupDraft(root);
    s.step = Math.min(SETUP_STEPS.length - 1, (s.step || 0) + 1);
    renderSettings();
  });
  root.querySelector('[data-add-port]')?.addEventListener('click', () => {
    syncSetupDraft(root);
    const keys = Object.keys(s.draft.expose || {});
    s.draft.expose = { ...s.draft.expose, [`port${keys.length + 1}`]: 3000 + keys.length };
    renderSettings();
  });
  root.querySelector('[data-add-wire]')?.addEventListener('click', () => {
    syncSetupDraft(root);
    s.draft.envSet = { ...s.draft.envSet, '': '' };
    renderSettings();
  });
  root.querySelector('[data-apply-wires]')?.addEventListener('click', () => {
    syncSetupDraft(root);
    s.draft.envSet = { ...s.draft.envSet, ...(s.wiring?.proposedWires || {}) };
    renderSettings();
  });
  root.querySelectorAll('[data-allow-hit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-hit-hash]');
      if (!row) return;
      try {
        const res = await invoke('repo.allowlistPort', {
          path: row.dataset.hitPath,
          line: Number(row.dataset.hitLine),
          snippetHash: row.dataset.hitHash,
          note: 'allowlisted from Lane setup',
        }, s.root);
        s.hits = res.hits || [];
        s.findings = res.findings || s.findings;
        toast('Allowlisted', 'ok');
        renderSettings();
      } catch { /* toasted */ }
    });
  });
  root.querySelector('[data-shared-ack]')?.addEventListener('change', (e) => {
    s.sharedAck = e.target.checked;
    renderSettings();
  });
  const yaml = root.querySelector('[data-setup-yaml]');
  yaml?.addEventListener('input', () => {
    s.proposedYaml = yaml.value;
    s.canAccept = setupYamlHasRun(yaml.value);
    s.showYaml = true;
  });
  root.querySelector('[data-write]')?.addEventListener('click', async () => {
    syncSetupDraft(root);
    if (yaml) s.proposedYaml = yaml.value;
    else s.proposedYaml = draftToYaml(s.draft);
    if (!s.sharedAck) {
      toast('Confirm shared-data default first', 'warn');
      return;
    }
    if (!setupYamlHasRun(s.proposedYaml)) {
      toast('Needs a run: line', 'warn');
      return;
    }
    try {
      const board = await invoke('repo.acceptManifest', s.proposedYaml, s.root);
      state.repoBoards.delete(s.root);
      if (board.root === state.board?.root) applyBoard(board);
      state.laneByRoot.delete(s.root);
      toast('Wrote .plenum/lane.yaml', 'ok');
      openSettings('lane');
    } catch { /* toasted */ }
  });
}

async function loadRepos() {
  const t = activeTab();
  if (!t) {
    if (state.settings.open && state.settings.page === 'repositories') renderSettings();
    return;
  }
  const seq = state.switchSeq;
  const path = t.path;
  try {
    const b = await api.invoke('board.get', path);
    if (seq !== state.switchSeq || activeTab()?.path !== path) return;
    b.displayRoot = await prettyPath(b.root);
    if (seq !== state.switchSeq || activeTab()?.path !== path) return;
    state.repoBoards.set(path, b);
  } catch { /* leave seeded / Loading… */ }
  if (state.settings.open && state.settings.page === 'repositories' && activeTab()?.path === path) {
    renderSettings();
  }
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
  // When detected (not override), show current as selected visual via Auto label - keep Auto selected.
  if (board.teamBranchSource !== 'override') {
    opts[0] = `<option value="" selected>Auto · ${esc(cur || 'detect')}</option>`;
  }
  return `<select class="select mono" data-team-root="${esc(root)}" aria-label="Protected branch for ${esc(title)}">${opts.join('')}</select>`;
}

/** Removable baselines as a one-per-line list + Add select (#46, #101). */
function baselinesControlHTML(board, root, title) {
  const cur = (board.baselines || []).map((x) => x.name);
  const names = new Set();
  for (const br of board.branches || []) {
    const short = br.short || String(br.name || '').replace(/^origin\//, '');
    if (short && short !== board.teamBranch && !cur.includes(short)) names.add(short);
  }
  const rows = cur.length
    ? `<ul class="baseline-list">${cur.map((n) => (
      `<li class="baseline-row">
        <span class="mono">${esc(n)}</span>
        <button class="iconbtn" type="button" data-baseline-remove="${esc(n)}" data-baseline-root="${esc(root)}" title="Stop comparing against ${esc(n)}" aria-label="Remove baseline ${esc(n)}">${iconHTML('x', 'sm')}</button>
      </li>`
    )).join('')}</ul>`
    : `<div class="baseline-empty">No comparison tips yet. Add long-lived tips like demo or staging.</div>`;
  const opts = [...names].sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  return `<div class="baseline-control">
    ${rows}
    <select class="select mono" data-baseline-add="${esc(root)}" aria-label="Add comparison baseline for ${esc(title)}"${opts ? '' : ' disabled'}><option value="">Add comparable branch…</option>${opts}</select>
  </div>`;
}

function bindRepos(root) {
  root.querySelectorAll('[data-open-lane]').forEach((b) => b.addEventListener('click', () => openSettings('lane')));
  const saveBaselines = async (rootPath, change, msg) => {
    try {
      const cur = (state.repoBoards.get(rootPath)?.baselines || []).map((x) => x.name);
      const board = await invoke('repo.setBaselines', change(cur), rootPath);
      board.displayRoot = await prettyPath(board.root);
      state.repoBoards.set(rootPath, board);
      if (board.root === state.board?.root) applyBoard(board);
      toast(msg, 'ok');
      renderSettings();
    } catch { /* toasted */ }
  };
  root.querySelectorAll('[data-baseline-add]').forEach((n) => n.addEventListener('change', () => {
    if (n.value) saveBaselines(n.dataset.baselineAdd, (cur) => [...cur, n.value], `Comparing against ${n.value}`);
  }));
  root.querySelectorAll('[data-baseline-remove]').forEach((n) => n.addEventListener('click', () => {
    const name = n.dataset.baselineRemove;
    saveBaselines(n.dataset.baselineRoot, (cur) => cur.filter((x) => x !== name), `Baseline ${name} removed`);
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

/** Agents page view-only bits: preview lines and restart notes per client, and the PATH command. */
const agentsView = { lines: {}, restart: {}, linkCmd: '' };

/* Statistics: read-only numbers from git history (electron/git/stats.mjs). */
const statsView = { scope: 'protected', data: null, root: null, loading: false };

async function loadStats() {
  const tab = activeTab();
  if (!tab) return;
  statsView.root = tab.path;
  statsView.loading = true;
  if (statsView.data?.root !== tab.path) statsView.data = null;
  if (!state.identity) {
    try { state.identity = await invoke('git.identity.get'); } catch { /* leave prior */ }
  }
  rerenderStats();
  try {
    const data = await invoke('stats.get', tab.path, statsView.scope);
    if (statsView.root === tab.path) statsView.data = { ...data, root: tab.path };
  } catch { statsView.data = null; /* toasted */ }
  statsView.loading = false;
  rerenderStats();
}

function rerenderStats() {
  if (!(state.settings.open && state.settings.page === 'statistics')) return;
  const top = el.settingsBody.scrollTop;
  renderSettings();
  el.settingsBody.scrollTop = top;
}

function bindStats(root) {
  root.querySelectorAll('[data-stats-scope]').forEach((b) => b.addEventListener('click', () => {
    if (statsView.scope === b.dataset.statsScope) return;
    statsView.scope = b.dataset.statsScope;
    loadStats();
  }));
  root.querySelectorAll('[data-stats-fame]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.statsFame;
    if ((state.prefs.statsFame || 'mine') === v) return;
    setPref({ statsFame: v });
    rerenderStats();
  }));
}

// Award id -> [icon, token colour]. Only design-system colours: agent, human, lane 2-4.
const AWARD_LOOK = {
  ai: ['robot', '--agent'], fav: ['heart', '--agent'], human: ['hand-heart', '--human'],
  lines: ['keyboard', '--lane-2'], weekend: ['coffee', '--lane-2'], fixes: ['bandaids', '--lane-2'], streak: ['calendar-check', '--lane-2'],
  night: ['moon-stars', '--lane-4'], day: ['fire', '--lane-4'], file: ['files', '--lane-4'],
  early: ['sun-horizon', '--lane-3'], deleted: ['hammer', '--lane-3'], biggest: ['bomb', '--lane-3'],
};

// Human is the app's human blue, agents follow in order, so a tool keeps its colour on every chart.
const STAT_COLORS = ['var(--human)', 'var(--agent)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)', 'var(--ink-tertiary)', 'var(--ink-subtle)'];

function statsIdentity() {
  const id = state.identity;
  if (!id) return { name: '', email: '' };
  const local = id.local?.email || id.local?.name ? id.local : null;
  const pick = local || id.global || {};
  return { name: String(pick.name || '').trim(), email: String(pick.email || '').trim().toLowerCase() };
}

function awardIsMine(a, me) {
  if (a.scope === 'repo') return false;
  const email = String(a.email || '').trim().toLowerCase();
  if (me.email && email && email === me.email) return true;
  if (me.name && a.who && a.who === me.name) return true;
  return false;
}

function awardRowHTML(a) {
  const [ic, col] = AWARD_LOOK[a.id] || ['sparkle', '--ink-subtle'];
  const row = settingsRow(ic, esc(a.title), a.who ? esc(a.who) : '', `${esc(a.stat)}<small class="quip">${esc(a.quip)}</small>`);
  return row.replace('<svg class="icon "', `<svg class="icon" style="color:var(${col})"`);
}

function statsPageHTML() {
  const s = statsView.data;
  const scope = `<div class="option-row" role="group" aria-label="Scope">${[['protected', 'Protected branch'], ['all', 'All branches']].map(([v, t]) =>
    `<button class="option${statsView.scope === v ? ' on' : ''}" type="button" aria-pressed="${statsView.scope === v}" data-stats-scope="${v}">${t}</button>`).join('')}</div>`;
  const head = `<h1>Statistics</h1><p class="lede">${s ? `${s.scope === 'all' ? 'Every local and remote branch' : `Commits on <span class="mono">${esc(s.teamRef)}</span>, the protected branch`} in ${esc(activeTab()?.title || 'this repository')}.${s.truncated ? ' Newest 20,000 commits only.' : ''}` : 'Reading history…'}</p>${scope}`;
  if (!s) return head;
  if (!s.commits) return `${head}<p class="lede" style="margin-top:18px">No commits here yet.</p>`;

  const n = (x) => Number(x).toLocaleString();
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const date = (unix) => new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const color = (tool) => STAT_COLORS[Math.max(0, s.weekly.tools.indexOf(tool))] || STAT_COLORS.at(-1);
  const agentCommits = s.kinds.assisted + s.kinds.agent + s.kinds.mixed;

  // Hero: how much of this history had an AI hand in it, split by tool.
  const totals = s.weekly.tools.map((t) => [t, s.weekly.totals[t] || 0]);
  const hero = `<section class="stat-hero">
    <div class="big">${pct(agentCommits, s.commits)}<small>%</small></div>
    <div class="what">of ${n(s.commits)} commits had an AI hand in them
      <small>${agentCommits === s.commits ? 'Every single one. Respect.' : agentCommits === 0 ? 'Pure human. Suspiciously pure.' : `${n(s.commits - agentCommits)} were typed by humans alone.`}</small></div>
    <div class="split" role="img" aria-label="Commits by tool">${totals.map(([t, v]) => `<i style="width:${(v / s.commits) * 100}%;background:${color(t)}" title="${esc(t)}: ${n(v)}"></i>`).join('')}</div>
    <div class="legend">${totals.map(([t, v]) => `<span><i style="background:${color(t)}"></i>${t === 'Human' ? '' : aiToolPillIconHTML(t)}${esc(t === 'Human' ? 'No AI' : t)} <b>${n(v)}</b> · ${pct(v, s.commits)}%</span>`).join('')}</div>
  </section>`;

  const facts = `<div class="list stat-facts">${[
    settingsRow('git-commit', 'Commits', '', `${n(s.merges)} merges · since ${date(s.first)}`, `<span class="stat-num"><b>${n(s.commits)}</b></span>`),
    settingsRow('plus', 'Lines', '', `−${n(s.deleted)} removed`, `<span class="stat-num"><b>+${n(s.added)}</b></span>`),
    settingsRow('user', 'Contributors', '', '', `<span class="stat-num"><b>${n(s.people.length)}</b></span>`),
    settingsRow('clock', 'Per active day', '', `${n(s.activeDays)} active day${s.activeDays === 1 ? '' : 's'}`, `<span class="stat-num"><b>${s.perActiveDay.toFixed(1)}</b></span>`),
  ].join('')}</div>`;

  // Hall of fame: yours + repo by default; everyone is opt-in (#106).
  const fameMode = state.prefs.statsFame === 'all' ? 'all' : 'mine';
  const me = statsIdentity();
  const mine = s.awards.filter((a) => awardIsMine(a, me));
  const repoAwards = s.awards.filter((a) => a.scope === 'repo');
  const others = s.awards.filter((a) => a.scope === 'person' && !awardIsMine(a, me));
  const fameToggle = `<div class="option-row" role="group" aria-label="Hall of fame">${[['mine', 'Yours + repo'], ['all', 'Everyone']].map(([v, t]) =>
    `<button class="option${fameMode === v ? ' on' : ''}" type="button" aria-pressed="${fameMode === v}" data-stats-fame="${v}">${t}</button>`).join('')}</div>`;
  const block = (title, detail, list) => list.length
    ? `<div class="group-head">${title}<small>${detail}</small></div><div class="list">${list.map(awardRowHTML).join('')}</div>`
    : '';
  const awards = (mine.length || repoAwards.length || (fameMode === 'all' && others.length))
    ? `${fameToggle}
      ${block('Your titles', me.email || me.name ? `Matched to ${esc(me.email || me.name)}.` : 'Set a git email in Accounts to claim titles.', mine)}
      ${block('The repo', 'About the history, not a person.', repoAwards)}
      ${fameMode === 'all' ? block('Everyone else', 'Competitive titles across contributors.', others) : ''}`
    : `<div class="group-head">Hall of fame<small>Nothing earned yet on this history.</small></div>${fameToggle}`;

  // Agents over time: one stacked bar per week, last 52 weeks.
  const wk = s.weekly.weeks;
  const wmax = Math.max(1, ...wk.map((w) => Object.values(w.counts).reduce((x, y) => x + y, 0)));
  const ww = 10;
  const stacked = wk.map((w, i) => {
    let y = 70;
    return s.weekly.tools.map((t) => {
      const v = w.counts[t] || 0;
      if (!v) return '';
      const h = (v / wmax) * 68;
      y -= h;
      return `<rect x="${i * ww}" y="${y.toFixed(1)}" width="${ww - 2}" height="${h.toFixed(1)}" style="fill:${color(t)}"><title>${s.weekly.unit === 'day' ? '' : 'Week of '}${w.week}: ${esc(t)} ${v}</title></rect>`;
    }).join('');
  }).join('');
  const over = s.weekly.tools.length < 2 ? '' : `<div class="stat-chart"><svg viewBox="0 0 ${wk.length * ww} 70" preserveAspectRatio="none" role="img" aria-label="Commits per ${s.weekly.unit} by tool, last ${wk.length} ${s.weekly.unit}s">${stacked}</svg>
    <div class="axis"><span>${esc(wk[0].week)}</span><span>busiest ${s.weekly.unit} ${wmax}</span><span>${s.weekly.unit === 'day' ? 'today' : 'this week'}</span></div>
    <div class="legend">${s.weekly.tools.map((t) => `<span><i style="background:${color(t)}"></i>${esc(t === 'Human' ? 'No AI' : t)}</span>`).join('')}</div></div>`;

  const max = Math.max(1, ...s.series.map((d) => d.n));
  const bw = 6;
  const bars = s.series.map((d, i) => {
    const h = d.n ? Math.max(2, Math.round((d.n / max) * 60)) : 1;
    return `<rect x="${i * bw}" y="${62 - h}" width="${bw - 1.5}" height="${h}" rx="1" class="${d.n ? '' : 'zero'}"><title>${d.day}: ${d.n} commit${d.n === 1 ? '' : 's'}</title></rect>`;
  }).join('');
  const daily = `<div class="stat-chart"><svg viewBox="0 0 ${s.series.length * bw} 64" preserveAspectRatio="none" role="img" aria-label="Commits per day, last ${s.series.length} days">${bars}</svg>
    <div class="axis"><span>${esc(s.series[0].day)}</span><span>busiest day ${max}</span><span>today</span></div></div>`;

  const bar = (v, of) => `<span class="bar"><i style="width:${of ? Math.max(1, Math.round((v / of) * 100)) : 0}%"></i></span>`;
  const topLines = Math.max(1, ...s.people.map((p) => p.added));
  const people = s.people.map((p) => settingsRow('user', esc(p.name), `${n(p.commits)} commit${p.commits === 1 ? '' : 's'}${p.withAgent ? ` · ${pct(p.withAgent, p.commits)}% with an agent` : ''}`,
    bar(p.added, topLines), `<span class="stat-num"><b>+${n(p.added)}</b> −${n(p.deleted)}</span>`)).join('');

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hot = Math.max(1, ...s.heat.flat());
  const peak = s.heatPeak;
  const peakLabel = peak
    ? `${days[peak.day]} ${String(peak.hour).padStart(2, '0')}:00`
    : '';
  const heatRead = peak
    ? `<p class="stat-heat-read">Peak slot <b>${peakLabel}</b> · ${n(peak.n)} commit${peak.n === 1 ? '' : 's'}. Darker cells are busier; outlined cell is the peak.</p>`
    : `<p class="stat-heat-read">No commits on this history yet.</p>`;
  const heatGrid = `<div class="stat-heat" role="img" aria-label="Commits by weekday and hour${peak ? `, peak ${peakLabel}` : ''}">${s.heat.map((row, d) =>
    `<span class="d">${days[d]}</span>${row.map((v, h) => {
      const isPeak = peak && peak.day === d && peak.hour === h;
      return `<i class="${isPeak ? 'peak' : ''}" style="--a:${(v / hot).toFixed(2)}" title="${days[d]} ${String(h).padStart(2, '0')}:00, ${v} commit${v === 1 ? '' : 's'}${isPeak ? ' · peak' : ''}"></i>`;
    }).join('')}`).join('')}
    <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('')}</div>`;
  const heatLegend = `<div class="stat-heat-legend" aria-hidden="true"><span>Quiet</span><span class="scale">${[0.05, 0.25, 0.5, 0.75, 1].map((a) => `<i style="--a:${a}"></i>`).join('')}</span><span>Busy</span></div>`;
  const heat = `<div class="stat-heat-wrap">${heatRead}${heatGrid}${heatLegend}</div>`;

  return `${head}
    ${hero}${facts}
    ${awards}
    ${over ? `<div class="group-head">Agents over time<small>Commits per ${s.weekly.unit}, last ${wk.length} ${s.weekly.unit}s.</small></div>${over}` : ''}
    <div class="group-head">Commits per day<small>Last ${s.series.length} days.</small></div>${daily}
    <div class="group-head">Who writes the most code<small>Lines added, merges left out. Two git identities for one person? Merge them with a <span class="mono">.mailmap</span>.</small></div><div class="list">${people}</div>
    <div class="group-head">When it happens<small>Weekday × hour in your local time — denser cells mean more commits.</small></div>${heat}`;
}

function rerenderAgents() {
  if (!(state.settings.open && state.settings.page === 'agents')) return;
  const top = el.settingsBody.scrollTop;
  renderSettings();
  el.settingsBody.scrollTop = top;
}

// Configs change outside Plenum, so refetch on every open; the old data stays up meanwhile.
async function loadAgents() {
  seedActiveRepoBoard();
  // Vite-only: enough stub to render the Command row (version + BETA).
  if (!api) {
    if (!state.agents) {
      state.agents = {
        settings: { version: 1, run: true, create: true, remove: 'allow', writeSetup: 'never' },
        launcher: { path: '~/.plenum/bin/plenum', shown: '~/.plenum/bin/plenum', onPath: true, linkPath: '/usr/local/bin/plenum' },
        clients: [],
      };
    }
    rerenderAgents();
    return;
  }
  for (const t of state.store.tabs) {
    api.invoke('board.get', t.path).then((b) => { state.repoBoards.set(t.path, b); rerenderAgents(); }, () => {});
  }
  try {
    const a = await invoke('agents.get');
    a.launcher.shown = await prettyPath(a.launcher.path);
    for (const c of a.clients) c.shown = await prettyPath(c.file);
    state.agents = a;
  } catch { /* toasted; keep what was there */ }
  rerenderAgents();
}

function bindAgents(root) {
  root.querySelector('[data-agent-link]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const res = await invoke('agents.linkOnPath');
      if (res.ok) {
        agentsView.linkCmd = '';
        state.agents.launcher.onPath = true;
        toast('Added plenum to your PATH', 'ok');
      } else agentsView.linkCmd = res.command;
    } catch { /* toasted */ }
    rerenderAgents();
  });
  root.querySelector('[data-link-copy]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(agentsView.linkCmd).then(() => toast('Copied', 'ok'), () => {});
  });
  root.querySelector('[data-link-recheck]')?.addEventListener('click', async () => {
    await loadAgents();
    if (state.agents?.launcher.onPath) { agentsView.linkCmd = ''; toast('plenum is on your PATH', 'ok'); rerenderAgents(); }
    else toast("Still not on your PATH. Run the command above, then check again.", 'bad');
  });
  root.querySelectorAll('[data-agent-lines]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.client;
    if (agentsView.lines[id]) delete agentsView.lines[id];
    else try { agentsView.lines[id] = await invoke('agents.preview', id); } catch { return; }
    rerenderAgents();
  }));
  const change = (channel) => async (e) => {
    const id = e.currentTarget.dataset.client;
    const was = state.agents.clients.find((x) => x.id === id)?.state;
    e.currentTarget.closest('.list-row').querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try {
      const c = await invoke(channel, id);
      c.shown = await prettyPath(c.file);
      state.agents.clients = state.agents.clients.map((x) => (x.id === id ? c : x));
      delete agentsView.lines[id];
      agentsView.restart[id] = channel === 'agents.add';
      const l = c.label;
      toast(channel === 'agents.remove' ? `Removed Plenum from ${l}` : was === 'stale' ? `Updated ${l}` : `Added Plenum to ${l}`, 'ok');
    } catch { /* toasted; re-render puts the row back as it was */ }
    rerenderAgents();
  };
  root.querySelectorAll('[data-agent-add]').forEach((b) => b.addEventListener('click', change('agents.add')));
  root.querySelectorAll('[data-agent-remove]').forEach((b) => b.addEventListener('click', change('agents.remove')));
  root.querySelectorAll('[data-setup-root]').forEach((b) => b.addEventListener('click', () => openLaneSetup(b.dataset.setupRoot)));
  const save = async (key, v) => {
    try {
      state.agents.settings = await invoke('agents.setSettings', { [key]: v });
      toast('Saved', 'ok');
    } catch { /* toasted */ }
    rerenderAgents();
  };
  root.querySelectorAll('.switch[data-agent-set]').forEach((n) => n.addEventListener('click', () =>
    save(n.dataset.agentSet, n.getAttribute('aria-checked') !== 'true')));
  root.querySelectorAll('select[data-agent-set]').forEach((n) => n.addEventListener('change', () => save(n.dataset.agentSet, n.value)));
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
  const seq = state.switchSeq;
  const path = activeTab()?.path || null;
  try {
    const identity = await invoke('git.identity.get');
    if (seq !== state.switchSeq) return;
    if ((activeTab()?.path || null) !== path) return;
    if (!(state.settings.open && state.settings.page === 'accounts')) return;
    state.identity = identity;
    renderSettings();
  } catch { /* toasted / leave prior */ }
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

/** Default compare ref: sidebar branch-vs when set; else this tip's upstream; else team. */
function defaultOverviewVs(board, br = null) {
  if (!board) return '';
  const vsName = branchVs(board);
  if (vsName) {
    if (vsName === board.teamBranch) return board.teamRef || board.teamBranch;
    const base = board.baselines?.find((x) => x.name === vsName);
    if (base?.ref) return base.ref;
  }
  if (br?.upstream) return br.upstream;
  return board.teamRef || board.teamBranch || 'main';
}

function overviewCompareOptions(board, br) {
  const opts = [];
  const seen = new Set();
  const add = (value, label) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    opts.push({ value, label: label || value });
  };
  if (board?.teamRef || board?.teamBranch) {
    add(board.teamRef || board.teamBranch, board.teamBranch || board.teamRef);
  }
  if (br?.upstream) add(br.upstream, `upstream (${br.upstream})`);
  for (const b of board?.baselines || []) add(b.ref || b.name, b.name);
  for (const x of board?.branches || []) {
    if (x.name === br?.name) continue;
    add(x.name, x.short || x.name);
  }
  return opts;
}

function buildOverviewPrompt(o, br) {
  if (!o) return '';
  const lines = [
    `Branch ${o.branch} vs ${o.vs} (${o.ahead} ahead, ${o.behind} behind).`,
  ];
  if (o.mergeBase) lines.push(`Merge-base ${o.mergeBase.slice(0, 7)}.`);
  const commits = o.commits || [];
  if (commits.length) {
    lines.push('Unique commits:');
    const show = commits.slice(0, 15);
    for (const c of show) lines.push(`- ${String(c.id).slice(0, 7)} ${c.subject}`);
    if (commits.length > show.length) lines.push(`- … and ${commits.length - show.length} more`);
  } else {
    lines.push('No unique commits vs the compare base.');
  }
  const t = o.totals || { files: 0, added: 0, deleted: 0 };
  lines.push(`Files: ${t.files} changed, +${t.added} −${t.deleted}.`);
  if (o.truncatedCommits || o.truncatedFiles) {
    lines.push(`Note: list capped${o.truncatedCommits ? ' (commits)' : ''}${o.truncatedFiles ? ' (files)' : ''}; ask for more SHAs if needed.`);
  }
  const topFiles = (o.files || []).slice(0, 10);
  if (topFiles.length) {
    lines.push('Top changed paths:');
    for (const f of topFiles) lines.push(`- ${f.path} (+${f.added}/−${f.deleted})`);
  }
  if (o.dirty?.dirty) lines.push(`Working tree dirty (${o.dirty.dirty} path${o.dirty.dirty === 1 ? '' : 's'}) on a worktree for this branch.`);
  else if (br?.hasLane) lines.push('Working tree clean on the lane for this branch.');
  lines.push(`Summarize what this branch does and risk vs ${o.vs}.`);
  return lines.join('\n');
}

async function loadBranchOverviewData() {
  const ov = state.branchOverview;
  const board = state.board;
  if (!ov.open || !ov.branch || !board) return;
  const br = branchByName(ov.branch);
  const vs = ov.vs || defaultOverviewVs(board, br);
  ov.vs = vs;
  const seq = (ov.loadSeq = (ov.loadSeq || 0) + 1);
  const branch = ov.branch;
  ov.loading = true;
  ov.error = null;
  paint();
  try {
    const data = await invoke('branch.overview', ...pin({
      branch,
      vs,
      team: board.teamBranch,
      primaryBranch: board.lanes?.[0]?.branch || board.teamBranch,
      laneBranches: (board.lanes || []).map((l) => l.branch).filter(Boolean),
    }));
    if (!state.branchOverview.open
      || state.branchOverview.branch !== branch
      || state.branchOverview.vs !== vs
      || state.branchOverview.loadSeq !== seq) return;
    state.branchOverview.data = data;
    state.branchOverview.vs = data.vs || vs;
    state.branchOverview.loading = false;
    state.branchOverview.error = null;
    paint();
  } catch (e) {
    if (!state.branchOverview.open
      || state.branchOverview.branch !== branch
      || state.branchOverview.vs !== vs
      || state.branchOverview.loadSeq !== seq) return;
    state.branchOverview.loading = false;
    state.branchOverview.error = (e?.message || String(e)).replace(/^Error invoking remote method [^:]+:\s*/, '');
    paint();
  }
}

function openBranchOverview(branchName) {
  const br = branchByName(branchName);
  if (!br || !state.board) return;
  if (state.settings.open) {
    state.settings.open = false;
  }
  state.branchOverview = {
    open: true,
    branch: br.name,
    vs: defaultOverviewVs(state.board, br),
    tab: 'commits',
    query: '',
    data: null,
    loading: true,
    error: null,
    selectedSha: null,
    loadSeq: 0,
  };
  paint();
  loadBranchOverviewData();
}

function closeBranchOverview({ repaint = true } = {}) {
  state.branchOverview.open = false;
  state.branchOverview.data = null;
  state.branchOverview.error = null;
  state.branchOverview.loading = false;
  state.branchOverview.selectedSha = null;
  if (repaint) paint();
}

function renderBranchOverview() {
  const root = el.branchOverviewBody;
  if (!root) return;
  const ov = state.branchOverview;
  const board = state.board;
  const br = branchByName(ov.branch);
  const short = br?.short || String(ov.branch || '').replace(/^origin\//, '');
  const o = ov.data;
  const vs = ov.vs || defaultOverviewVs(board, br);
  const opts = overviewCompareOptions(board, br);
  const compare = `<label class="bo-compare">Compare to
    <select class="mono is-select" data-overview-vs aria-label="Compare branch against">
      ${opts.map((x) => `<option value="${esc(x.value)}"${x.value === vs ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
    </select>
  </label>`;

  const where = br?.remote ? 'Remote tip' : br?.hasLane ? `Lane · ${esc(board.lanes.find((l) => l.index === br.laneIndex)?.name || '')}` : 'Local tip';
  const up = br?.upstream ? ` · tracks <span class="mono">${esc(br.upstream)}</span>` : '';
  const vsLabel = opts.find((x) => x.value === vs)?.label || vs;
  const pills = o
    ? `<div class="bo-pills">
        <span class="bo-pill"><strong>${o.ahead}</strong> ahead of <span class="mono">${esc(vsLabel)}</span></span>
        <span class="bo-pill"><strong>${o.behind}</strong> behind</span>
        ${o.mergeBase ? `<span class="bo-pill">merge-base <span class="mono">${esc(o.mergeBase.slice(0, 7))}</span></span>` : ''}
      </div>`
    : '';

  let body = '';
  if (ov.loading && !o) {
    body = `<p class="lede">Reading ${esc(short)} vs ${esc(vsLabel)}…</p>`;
  } else if (ov.error) {
    body = `<p class="lede bad">${esc(ov.error)}</p>
      <p class="row-end"><button class="btn" type="button" data-overview-retry>Try again</button></p>`;
  } else if (o) {
    const q = (ov.query || '').trim().toLowerCase();
    const commits = (o.commits || []).filter((c) => {
      if (!q) return true;
      return [c.subject, c.author, c.email, c.id, ...(c.refs || []).map((r) => r.name)]
        .join(' ').toLowerCase().includes(q);
    });
    const files = (o.files || []).filter((f) => !q || f.path.toLowerCase().includes(q));
    const prompt = buildOverviewPrompt(o, br);
    const tabs = `<div class="bo-tabs" role="tablist">
      <button class="bo-tab${ov.tab === 'commits' ? ' on' : ''}" type="button" role="tab" aria-selected="${ov.tab === 'commits'}" data-overview-tab="commits">Commits · ${(o.commits || []).length}</button>
      <button class="bo-tab${ov.tab === 'files' ? ' on' : ''}" type="button" role="tab" aria-selected="${ov.tab === 'files'}" data-overview-tab="files">Files · ${(o.files || []).length}</button>
    </div>`;
    const search = `<div class="bo-toolbar">
      <label class="bo-search">${iconHTML('magnifying-glass', 'sm')}<input type="search" data-overview-query placeholder="${ov.tab === 'files' ? 'Filter paths…' : 'Search commits, authors, SHAs…'}" value="${esc(ov.query || '')}" /></label>
      <span class="bo-count">${ov.tab === 'files' ? `${files.length} path${files.length === 1 ? '' : 's'}` : `Showing ${commits.length} of ${(o.commits || []).length}`}</span>
    </div>`;
    const promptBox = `<section class="bo-prompt">
      <div class="bo-prompt-top"><span class="bo-prompt-label">Agent prompt</span>
        <button class="btn primary" type="button" data-overview-copy>Copy</button>
      </div>
      <pre data-overview-prompt>${esc(prompt)}</pre>
    </section>`;
    let list = '';
    if (ov.tab === 'files') {
      list = files.length
        ? `<div class="bo-files list">${files.map((f) =>
          `<button class="list-row bo-file" type="button" data-overview-file="${esc(f.path)}" title="Open at tip commit (range list is vs compare base)">
            <span class="mono path">${esc(f.path)}</span>
            <span class="stat mono"><span class="add">+${f.added}</span><span class="del">−${f.deleted}</span></span>
          </button>`).join('')}</div>`
        : `<p class="lede">${q ? 'No paths match.' : 'No file changes in this range.'}</p>`;
    } else if (!commits.length) {
      list = `<p class="lede">${q ? 'No commits match.' : (o.ahead === 0 && o.behind === 0 ? 'Tip matches the compare ref — pick another base.' : 'No unique commits vs the compare base.')}</p>`;
    } else {
      list = `<div class="graph bo-graph" data-overview-graph>
        <div class="graph-cols" aria-hidden="true"></div>
        <div class="rows" role="table" aria-label="Commits on this branch vs compare base"></div>
      </div>`;
    }
    const trunc = o.truncated ? `<p class="lede">Showing a capped slice of this range.</p>` : '';
    body = `${promptBox}${tabs}${search}${trunc}${list}`;
  }

  root.innerHTML = `
    <div class="bo-head">
      <div class="bo-title-row">
        <div>
          <h1>${esc(short)}</h1>
          <p class="lede">${where}${up} · compared to <span class="mono">${esc(vsLabel)}</span></p>
          ${pills}
        </div>
        ${compare}
      </div>
    </div>
    ${body}`;

  root.querySelector('[data-overview-vs]')?.addEventListener('change', (e) => {
    state.branchOverview.vs = e.target.value;
    state.branchOverview.data = null;
    loadBranchOverviewData();
  });
  root.querySelector('[data-overview-retry]')?.addEventListener('click', () => loadBranchOverviewData());
  root.querySelectorAll('[data-overview-tab]').forEach((b) => b.addEventListener('click', () => {
    state.branchOverview.tab = b.dataset.overviewTab;
    state.branchOverview.query = '';
    paint();
  }));
  const qInput = root.querySelector('[data-overview-query]');
  qInput?.addEventListener('input', () => {
    state.branchOverview.query = qInput.value;
    refreshOverviewList();
  });
  root.querySelector('[data-overview-copy]')?.addEventListener('click', () => {
    const text = root.querySelector('[data-overview-prompt]')?.textContent || '';
    copyText(text, 'prompt');
  });

  bindOverviewList(root);
  enhanceSelects(root);
}

function overviewFilteredCommits() {
  const o = state.branchOverview.data;
  if (!o) return [];
  const q = (state.branchOverview.query || '').trim().toLowerCase();
  return (o.commits || []).filter((c) => {
    if (!q) return true;
    return [c.subject, c.author, c.email, c.id, ...(c.refs || []).map((r) => r.name)]
      .join(' ').toLowerCase().includes(q);
  });
}

function overviewFilteredFiles() {
  const o = state.branchOverview.data;
  if (!o) return [];
  const q = (state.branchOverview.query || '').trim().toLowerCase();
  return (o.files || []).filter((f) => !q || f.path.toLowerCase().includes(q));
}

function bindOverviewList(root = el.branchOverviewBody) {
  if (!root) return;
  const ov = state.branchOverview;
  const o = ov.data;
  const board = state.board;
  const graph = root.querySelector('[data-overview-graph]');
  if (graph && o && ov.tab === 'commits') {
    const commits = overviewFilteredCommits();
    syncGraphColumnChrome(graph, { remount: false, headers: true, measure: false });
    renderLinearHistory(graph, {
      commits,
      selectedCommit: ov.selectedSha,
      currentBranch: laneByIndex(state.selectedLane)?.branch || null,
      runningLanes: new Set((board?.lanes || []).filter((l) => l.running).map((l) => l.index)),
      gravatar: state.prefs.gravatar !== false,
      columns: graphColumnPrefs(),
    });
    syncGraphColumnChrome(graph, { remount: false, headers: false, measure: true });
    graph.querySelectorAll('[data-overview-commit]').forEach((row) => {
      row.addEventListener('click', () => {
        const sha = row.dataset.overviewCommit;
        closeBranchOverview({ repaint: false });
        jumpToCommitOnGraph(sha);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });
    });
  }

  root.querySelectorAll('[data-overview-file]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filePath = btn.dataset.overviewFile;
      const tip = o?.tipSha || o?.commits?.find((c) => c.isTip)?.id || o?.commits?.[0]?.id;
      closeBranchOverview({ repaint: false });
      if (tip) {
        state.changes = { kind: 'commit', sha: tip };
        state.filePane = { sha: tip, path: filePath, mode: 'diff' };
        state.changesPaintKey = '';
        toast('Opened at tip commit (file list is the full range vs compare)', '');
      }
      paint();
    });
  });
}

/** Re-filter commits/files without rebuilding the whole overview shell. */
function refreshOverviewList() {
  const root = el.branchOverviewBody;
  if (!root || !state.branchOverview.data) return;
  const ov = state.branchOverview;
  const o = ov.data;
  const q = (ov.query || '').trim().toLowerCase();
  const count = root.querySelector('.bo-count');
  if (ov.tab === 'files') {
    const files = overviewFilteredFiles();
    if (count) count.textContent = `${files.length} path${files.length === 1 ? '' : 's'}`;
    const host = root.querySelector('.bo-files') || root.querySelector('[data-overview-list]');
    const html = files.length
      ? files.map((f) =>
        `<button class="list-row bo-file" type="button" data-overview-file="${esc(f.path)}" title="Open at tip commit (range list is vs compare base)">
            <span class="mono path">${esc(f.path)}</span>
            <span class="stat mono"><span class="add">+${f.added}</span><span class="del">−${f.deleted}</span></span>
          </button>`).join('')
      : '';
    if (host && host.classList.contains('bo-files')) {
      host.innerHTML = html || `<p class="lede" style="padding:12px">${q ? 'No paths match.' : 'No file changes in this range.'}</p>`;
      bindOverviewList(root);
    } else {
      paint();
    }
    return;
  }
  const commits = overviewFilteredCommits();
  if (count) count.textContent = `Showing ${commits.length} of ${(o.commits || []).length}`;
  const graph = root.querySelector('[data-overview-graph]');
  if (!graph) {
    paint();
    return;
  }
  bindOverviewList(root);
}

function paintSettingsGraphPreview(root = el.settingsBody) {
  const preview = root?.querySelector('.theme-preview');
  const graph = preview?.querySelector('.graph');
  if (!graph) return;
  // Appearance preview stays on the shipping column layout; Graph page uses prefs.
  const cols = state.settings.page === 'appearance' ? defaultGraphColumns() : graphColumnPrefs();
  const gravatar = state.settings.page === 'appearance' ? false : state.prefs.gravatar !== false;
  applyGraphColumnLayout(graph, cols, { widths: layout.widths, measure: false, headers: true });
  renderGraph(preview, {
    commits: PREVIEW_COMMITS,
    selectedLane: 1,
    selectedCommit: 'a1b2c3d',
    currentBranch: 'feat/hover',
    gravatar,
    columns: cols,
  });
  applyGraphColumnLayout(graph, cols, { widths: layout.widths, measure: true, headers: false });
}

function bindGraphColumns(root) {
  const save = async (next) => {
    const normalized = normalizeGraphColumns(next);
    if (graphColumnsSig(normalized) === graphColumnsSig()) return;
    lastGraphColsSig = ''; // force board header rebuild on next paint
    const top = el.settingsBody.scrollTop;
    await setPref({ graphColumns: normalized }, false);
    if (state.settings.open && state.settings.page === 'graph') {
      renderSettings();
      el.settingsBody.scrollTop = top;
    }
  };
  root.querySelectorAll('[data-graph-col]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') {
        toast('Keep at least one column on', 'warn');
        return;
      }
      const id = btn.dataset.graphCol;
      const on = btn.getAttribute('aria-checked') !== 'true';
      const cur = graphColumnPrefs();
      const next = setColumnOn(cur, id, on);
      if (graphColumnsSig(next) === graphColumnsSig(cur)) {
        toast('Keep at least one column on', 'warn');
        return;
      }
      save(next).catch(() => {});
    });
  });
  root.querySelectorAll('[data-col-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const id = btn.dataset.colMove;
      const dir = Number(btn.dataset.dir) || 0;
      const cur = graphColumnPrefs();
      const next = moveColumn(cur, id, dir);
      if (graphColumnsSig(next) === graphColumnsSig(cur)) return;
      save(next).catch(() => {});
    });
  });
  root.querySelector('[data-graph-cols-reset]')?.addEventListener('click', () => {
    save(defaultGraphColumns()).catch(() => {});
  });
}

function openSettings(page = state.settings.page) {
  if (state.branchOverview.open) closeBranchOverview({ repaint: false });
  state.settings.open = true;
  state.settings.page = page;
  if (page === 'repositories' || page === 'lane') seedActiveRepoBoard();
  paint();
  renderSettings();
  if (page === 'accounts') { loadIdentity(); loadAccounts(); }
  if (page === 'repositories') loadRepos();
  if (page === 'lane') loadLane();
  if (page === 'agents') loadAgents();
  if (page === 'statistics') loadStats();
  if (page === 'setup') loadSetup(state.settings.setupRoot || state.board?.root);
}

function closeSettings() {
  state.settings.open = false;
  paint();
}

function renderSettings() {
  const { page } = state.settings;
  const lit = page === 'setup' ? 'lane' : page; // Lane setup wizard lives under Lane
  const nav = SETTINGS_NAV.map(([id, ic, label]) =>
    `<button class="navitem${id === lit ? ' active' : ''}" type="button" data-page="${id}"${id === lit ? ' aria-current="page"' : ''}>${iconHTML(ic)}${label}</button>`).join('');
  el.settingsNav.innerHTML = `<div class="settings-nav-list"><button class="navitem back" type="button" data-board>${iconHTML('caret-right')}Board<kbd>esc</kbd></button>
    <div class="heading">Settings</div>${nav}</div>${panelFootHTML(true)}`;
  closeSelectMenus();
  el.settingsBody.className = `settings-body${page === 'setup' ? ' setup' : page === 'lane' ? ' setup lane' : ''}`;
  el.settingsBody.innerHTML = (SETTINGS_PAGES[page] || SETTINGS_PAGES.general)();
  enhanceSelects(el.settingsBody);
  if (page === 'appearance' || page === 'graph') paintSettingsGraphPreview(el.settingsBody);
  if (page === 'graph') bindGraphColumns(el.settingsBody);
  if (page === 'accounts') { bindIdentity(el.settingsBody); bindAccounts(el.settingsBody); }
  if (page === 'repositories') bindRepos(el.settingsBody);
  if (page === 'lane') bindLane(el.settingsBody);
  if (page === 'agents' && state.agents) bindAgents(el.settingsBody);
  if (page === 'statistics') bindStats(el.settingsBody);
  if (page === 'setup') bindSetup(el.settingsBody);
  if (page === 'general') paintFeedbackQueue(el.settingsBody.querySelector('[data-feedback-queue]'));
  bindPrefs(el.settingsBody);
  bindUpdateAct(el.settingsBody);
  bindUpdateAct(el.settingsNav);
  el.settingsNav.querySelector('[data-board]').addEventListener('click', closeSettings);
  el.settingsNav.querySelector('[data-feedback]')?.addEventListener('click', () => openFeedbackSheet());
  el.settingsNav.querySelector('[data-settings]')?.addEventListener('click', closeSettings);
  el.settingsNav.querySelectorAll('[data-page]').forEach((b) =>
    b.addEventListener('click', () => openSettings(b.dataset.page)));
  layout.remountRails();
}

/** #104 unsent feedback (the local outbox main retries on launch and every 15 min). */
async function paintFeedbackQueue(box) {
  if (!box) return;
  let items = [];
  try { items = await invoke('feedback.queue'); } catch { return; }
  if (!box.isConnected) return;
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const live = items.filter((x) => !x.expired).length;
  const head = settingsRow('stack', 'Unsent reports', '', items.length
    ? `${items.length} waiting${live < items.length ? ` · ${items.length - live} too old to resend` : ''}`
    : 'Nothing waiting. Everything you sent reached us.',
  live ? `<button class="btn" type="button" data-feedback-retry>${iconHTML('arrows-clockwise', 'sm')}Send now</button>` : '',
  'Reports that could not reach the server stay on this Mac and retry on launch and every 15 minutes, for up to 14 days.');
  const rows = items.map((x) => `<div class="list-row compact feedback-queue-row" title="${esc(x.error || '')}">
      ${iconHTML(x.expired ? 'clock' : x.status === 'failed' ? 'warning-circle' : 'circle-dashed', 'sm')}
      <div class="name">${esc(x.comment.split('\n')[0] || '(no text)')}<small>${esc(when(x.createdAt))}${x.expired ? ' · too old to resend' : x.error ? ` · ${esc(x.error)}` : ''}</small></div>
    </div>`).join('');
  box.innerHTML = head + rows;
  box.querySelector('[data-feedback-retry]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { sent, left } = await invoke('feedback.retry');
      toast(sent ? `Sent ${sent} report${sent === 1 ? '' : 's'}${left ? `, ${left} still waiting` : ''}.` : 'Still can’t reach the feedback server.', sent ? 'ok' : 'bad');
    } catch { /* toasted */ }
    paintFeedbackQueue(box);
  });
}

/**
 * After a tab switch while Settings is open, keep the page in sync with the active tab.
 * Call optimistically as soon as activeId (and warm board) update; pass afterSelect:true
 * once main’s active path is updated so identity/repo fetches hit the right checkout.
 */
function syncSettingsAfterTabSwitch({ afterSelect = true } = {}) {
  if (!state.settings.open) return;
  const { page } = state.settings;
  if (page === 'setup') {
    const setupTabId = state.settings.setupTabId;
    if (!activeTab() || (setupTabId && state.store.activeId !== setupTabId)) {
      state.settings.setupRoot = null;
      state.settings.setupTabId = null;
      openSettings('lane');
      toast('Lane setup closed. Switched repository.');
      return;
    }
  }
  if (page === 'accounts') {
    renderSettings();
    if (afterSelect) { loadIdentity(); loadAccounts(); }
    return;
  }
  if (page === 'repositories') {
    seedActiveRepoBoard();
    renderSettings();
    if (afterSelect) loadRepos();
    return;
  }
  if (page === 'lane') {
    seedActiveRepoBoard();
    renderSettings();
    if (afterSelect) loadLane();
    return;
  }
  if (page === 'statistics') { renderSettings(); if (afterSelect) loadStats(); return; }
  if (page === 'setup') renderSettings();
}

/* Palette */
function paletteCommands() {
  const lane = laneByIndex(state.selectedLane);
  const cmds = [
    { id: 'open', label: 'Open Repository…', run: openRepo },
    { id: 'quickstart', label: 'Quick start: what are lanes?', run: openQuickStart },
    { id: 'share', label: 'Share Plenum: copy a link for a friend', run: shareLink, match: ['invite', 'friend', 'colleague', 'recommend'] },
    { id: 'feedback', label: 'Feedback…', run: () => { closePalette(); openFeedbackSheet(); }, match: ['tell me', 'report', 'feedback'] },
    { id: 'settings', label: 'Settings…', run: () => openSettings() },
    { id: 'lane-settings', label: 'Lane: edit lane.yaml…', run: () => openSettings('lane'), when: !!state.board, match: ['manifest', 'lane.yaml', 'run command', 'ports'] },
    { id: 'graph-cols', label: 'Graph columns…', run: () => openSettings('graph'), match: ['columns', 'sha', 'author', 'hide', 'reorder'] },
    { id: 'stats', label: 'Statistics: commits, authors, agents', run: () => openSettings('statistics'), when: !!state.board, match: ['stats', 'insights', 'contributors', 'activity'] },
    {
      id: 'overview',
      label: lane?.branch ? `Branch overview: ${lane.branch}` : 'Branch overview…',
      run: () => {
        closePalette();
        if (lane?.branch) openBranchOverview(lane.branch);
        else toast('Select a lane or right-click a branch → Overview…', 'bad');
      },
      when: !!state.board && !!lane?.branch,
      match: ['overview', 'investigate', 'compare branch', 'branch overview'],
    },
    { id: 'new', label: 'New lane…', run: openCreateLane, when: !!state.board },
    { id: 'doctor', label: 'Lane setup…', run: () => openLaneSetup(), when: !!state.board },
    { id: 'commit', label: 'Commit…', run: () => openCommitSheet(lane), when: lane && lane.dirty },
    { id: 'stash', label: 'Stash uncommitted', run: () => handleAction('stash', lane), when: lane && lane.dirty },
    { id: 'stashPop', label: 'Pop stash', run: () => handleAction('stashPop', lane), when: lane && state.board?.stashCount },
    { id: 'push', label: `Push ${lane?.name || ''} to origin`.trim(), run: () => handleAction('push', lane), when: lane && lane.unpushed && !laneDivergedFromUpstream(lane) },
    { id: 'forcePush', label: `Force push ${lane?.name || ''} (with lease)…`.trim(), run: () => handleAction('forcePush', lane), when: lane && !lane.isPrimary && laneDivergedFromUpstream(lane), match: ['force', 'lease'] },
    { id: 'pull', label: `Pull ${lane?.name || ''} (ff-only)`.trim(), run: () => handleAction('pull', lane), when: !!lane },
    { id: 'rebase', label: 'Rebase on main', run: () => handleAction('rebase', lane), when: lane && !lane.isPrimary && lane.behind },
    { id: 'finish', label: 'Finish lane…', run: () => handleAction('finish', lane), when: lane && !lane.isPrimary && lane.ahead && !lane.dirty },
    { id: 'conflicts', label: 'Resolve conflicts…', run: () => handleAction('conflicts', lane), when: !!lane },
    { id: 'up', label: 'Start lane', run: () => handleAction('up', lane), when: lane && lane.runnable && !lane.running && (lane.prepared !== false || lane.isPrimary) },
    { id: 'down', label: 'Stop lane', run: () => handleAction('down', lane), when: lane && lane.running },
    { id: 'logs', label: 'Run log', run: () => handleAction('logs', lane), when: lane && lane.runnable && (lane.prepared !== false || lane.isPrimary) },
    { id: 'test', label: 'Test lane', run: () => handleAction('test', lane), when: lane && lane.runnable && (lane.prepared !== false || lane.isPrimary) },
    { id: 'repair', label: 'Repair lane', run: () => handleAction('repair', lane), when: lane && !lane.isPrimary && lane.runnable && lane.prepared === false },
    { id: 'reveal', label: 'Reveal in Finder', run: () => handleAction('reveal', lane), when: !!lane },
    { id: 'editor', label: `Open in ${editorName()}`, run: () => handleAction('editor', lane), when: !!lane },
    { id: 'terminal', label: 'Open in terminal', run: () => invoke('os.openTerminal', lane.path).catch(() => {}), when: !!lane },
    { id: 'warm', label: 'Tab warm time…', run: openWarmSheet },
    { id: 'refresh', label: 'Refresh board', run: () => refresh({ loud: true }), when: !!state.board },
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
    // Swallow the key: a sheet opened by the command autofocuses before the default action runs (#78).
    e.preventDefault();
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
      openFeedbackSheet({
        comment: feedbackDraft.comment,
        target: feedbackDraft.target,
        credit: !!feedbackDraft.credit,
        viaGh: !!feedbackDraft.viaGh,
      });
      return;
    }
    if (!el.paletteLayer.hidden) closePalette();
    else if (el.sheetLayer.classList.contains('open')) {
      if (el.sheetLayer.querySelector('form[data-sending="1"]')) return;
      closeSheet();
    }
    else if (state.branchOverview.open) closeBranchOverview();
    else if (state.settings.open) {
      if (state.settings.page === 'setup') openSettings('lane');
      else closeSettings();
    }
    else if (state.filePane) {
      clearFileStage();
      state.changesPaintKey = '';
      paintChanges();
    }
    else if (state.changes) { closeChanges(); paint(); }
    else if (state.runLog) { closeRunLog(); paint(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && state.settings.open && state.settings.page === 'lane') {
    e.preventDefault();
    el.settingsBody.querySelector('[data-lane-save]')?.click();
  }
});

async function openRepo() {
  const path = await invoke('os.pickFolder');
  if (path) return openRepoPath(path);
}

async function openRepoPath(path) {
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
  if (id === state.store.activeId) {
    if (state.branchOverview.open) closeBranchOverview();
    else if (state.settings.open) closeSettings();
    return;
  }
  const prevId = state.store.activeId;
  if (state.branchOverview.open) closeBranchOverview({ repaint: false });
  const keepSettings = state.settings.open;
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
  // Optimistic: Settings body follows the tab strip immediately (don’t wait on cold board.get).
  if (keepSettings) syncSettingsAfterTabSwitch({ afterSelect: false });
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
  // After main active path is updated: identity/repo fetches + seed from the loaded board.
  if (seq === state.switchSeq && keepSettings) syncSettingsAfterTabSwitch({ afterSelect: true });
}

const lastFetchAt = new Map(); // root → ms
/** #116 background by default (focus, .git watch, tab switch): no spinners, rows stay usable. */
async function refresh({ loud = false } = {}) {
  const tabId = state.store.activeId;
  const root = state.board?.root;
  if (!root || !tabId) return;
  if (state.refreshingByTab.has(tabId)) return;
  const limit = state.historyLimit || 120;
  state.refreshingByTab.add(tabId);
  if (loud) {
    state.loudRefreshByTab.add(tabId);
    if (state.store.activeId === tabId) paintPanel();
  }
  let board = null;
  try {
    // #81 / #99 fetch origin at most every 15s so ↓ pull counts track the real remote
    const fetch = Date.now() - (lastFetchAt.get(root) || 0) > 15000;
    if (fetch) lastFetchAt.set(root, Date.now());
    board = await invoke('board.get', root, { historyLimit: limit, fetch });
  } catch { /* toasted */ }
  finally {
    state.refreshingByTab.delete(tabId);
    state.loudRefreshByTab.delete(tabId);
  }
  if (board) settleBoard(tabId, root, board);
  else if (loud && state.store.activeId === tabId) paintPanel();
}

async function loadOlderHistory() {
  if (!state.board?.historyHasMore || state.loadingOlder) return;
  const tabId = beginOp('history');
  if (!tabId) {
    // Tab busy with another op — IO won't re-fire while the foot stays on screen.
    scheduleOlderRetry(250);
    return;
  }
  const root = state.board.root;
  const next = Math.min(5000, (state.historyLimit || 120) + 120);
  state.historyLimit = next;
  state.loadingOlder = true;
  if (olderRetryTimer) {
    clearTimeout(olderRetryTimer);
    olderRetryTimer = null;
  }
  const foot = el.graph.querySelector('[data-load-older]');
  if (foot) {
    foot.setAttribute('aria-busy', 'true');
    foot.innerHTML = `<i class="spinner btn-spin" aria-hidden="true"></i><span>Loading older…</span>`;
  }
  let board = null;
  try {
    board = await invoke('board.get', root, { historyLimit: next });
  } catch { /* toasted */ }
  finally {
    state.loadingOlder = false;
    endOp(tabId, 'history');
  }
  if (state.store.activeId !== tabId) {
    const w = state.warmTabs.get(tabId);
    if (w && board) {
      w.board = board;
      w.historyLimit = next;
    }
    return;
  }
  if (board) {
    olderFailStreak = 0;
    applyBoard(board);
  } else {
    olderFailStreak += 1;
    // Revert optimistic bump so the next attempt asks for the same window.
    state.historyLimit = Math.max(120, next - 120);
    const idle = el.graph.querySelector('[data-load-older]');
    if (idle) {
      idle.removeAttribute('aria-busy');
      idle.innerHTML = '<span class="sr-only">Load older commits</span>';
    }
    scheduleOlderRetry(600, { afterFail: true });
  }
}

window.addEventListener('focus', () => { refresh(); });

// ── Feedback nudges ─────────────────────────────────────────────────────────
// Rules live in lib/nudge.js. Here: a small non-modal card, never focused on its own,
// shown only when the user has gone quiet, and gone for good once it has been shown.
const nudgeBootAt = Date.now();
let nudgeLastInputAt = Date.now();
let nudgeFade = null;
let nudgePathMissing = false;
for (const t of ['keydown', 'pointerdown', 'wheel']) {
  window.addEventListener(t, () => { nudgeLastInputAt = Date.now(); }, { capture: true, passive: true });
}

/** Write prefs without the "Saved" toast that setPref raises. */
async function saveQuietPrefs(partial) {
  try { state.prefs = await invoke('prefs.set', partial); } catch { /* best effort */ }
}

function nudgeBusy() {
  const a = document.activeElement;
  return !document.hasFocus() || document.hidden || !state.board || state.loading || state.settings.open
    || state.branchOverview.open
    || el.sheetLayer.classList.contains('open') || !el.paletteLayer.hidden || !el.toast.hidden
    || !!document.querySelector('.tour-layer, #nudge')
    || !!a?.matches?.('input, textarea, select, [contenteditable]');
}

function hideNudge() {
  clearTimeout(nudgeFade);
  document.getElementById('nudge')?.remove();
}

function showPathNudge() {
  const card = document.createElement('div');
  card.id = 'nudge';
  card.className = 'nudge';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Set up the plenum command');
  card.setAttribute('data-feedback-ignore', '');
  card.innerHTML = `
    <div class="nudge-head"><strong>Use <span class="mono">plenum</span> from your terminal?</strong>
      <button class="iconbtn" type="button" data-nudge-x aria-label="Dismiss" title="Dismiss">${iconHTML('x', 'sm')}</button></div>
    <div class="nudge-body">
      <button class="btn primary" type="button" data-path-go>Set up</button>
      <button class="btn" type="button" data-nudge-x>Not now</button>
      <span class="nudge-off">Settings → Agents any time</span>
    </div>`;
  (document.querySelector('.window.app') || document.body).appendChild(card);
  card.querySelectorAll('[data-nudge-x]').forEach((b) => b.addEventListener('click', hideNudge));
  card.querySelector('[data-path-go]').addEventListener('click', () => { hideNudge(); openSettings('agents'); });
  nudgeFade = setTimeout(hideNudge, 30_000);
}

async function markStarAsked() {
  const now = Date.now();
  await saveQuietPrefs({ nudge: { ...(state.prefs.nudge || {}), starAskedAt: now } });
}

function armNudgeFade(card, onFade) {
  clearTimeout(nudgeFade);
  nudgeFade = setTimeout(() => {
    hideNudge();
    onFade?.();
  }, 30_000);
  card.querySelector('[data-nudge-x]')?.addEventListener('click', () => {
    hideNudge();
    onFade?.();
  }, { once: true });
}

function showStarAsk(card, title = 'Glad it’s working.') {
  const head = card.querySelector('.nudge-head');
  head.innerHTML = `<div><strong>${esc(title)}</strong>
      <p class="nudge-sub">A star on GitHub helps a lot.</p></div>
      <button class="iconbtn" type="button" data-nudge-x aria-label="Dismiss" title="Dismiss">${iconHTML('x', 'sm')}</button>`;
  const body = card.querySelector('.nudge-body');
  body.innerHTML = `<button class="btn primary" type="button" data-nudge-star>${iconHTML('github-logo', 'sm')} Star on GitHub</button>
      <button class="nudge-off" type="button" data-nudge-later>Not now</button>`;
  const done = () => { markStarAsked().catch(() => {}); };
  armNudgeFade(card, done);
  card.querySelector('[data-nudge-later]').addEventListener('click', () => { hideNudge(); done(); });
  card.querySelector('[data-nudge-star]').addEventListener('click', async () => {
    const btn = card.querySelector('[data-nudge-star]');
    btn.disabled = true;
    clearTimeout(nudgeFade);
    try {
      const res = await invoke('github.star');
      await markStarAsked();
      hideNudge();
      toast(res?.via === 'gh' ? 'Starred. Thanks.' : 'Opened GitHub. Thanks if you star it.', 'ok');
    } catch {
      btn.disabled = false;
      armNudgeFade(card, done);
    }
  });
}

function showDownAsk(card, kind) {
  const head = card.querySelector('.nudge-head');
  head.innerHTML = `<strong>Sorry about that. What’s off?</strong>
      <button class="iconbtn" type="button" data-nudge-x aria-label="Dismiss" title="Dismiss">${iconHTML('x', 'sm')}</button>`;
  const body = card.querySelector('.nudge-body');
  body.innerHTML = `<input class="input" type="text" maxlength="500" placeholder="What’s not working?" aria-label="What’s not working" />
      <button class="btn primary" type="button" data-nudge-send>Send</button>`;
  armNudgeFade(card);
  const input = body.querySelector('input');
  const send = async (comment) => {
    const btn = body.querySelector('[data-nudge-send]');
    btn.disabled = true;
    try {
      await invoke('feedback.checkin', { rating: 'down', context: kind, comment });
      hideNudge();
      toast('Thanks.', 'ok');
    } catch { btn.disabled = false; /* invoke already toasted */ }
  };
  body.querySelector('[data-nudge-send]').addEventListener('click', () => send(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(input.value); } });
  input.focus();
}

function showNudge(kind) {
  if (kind === 'path') return showPathNudge();
  const v = state.appInfo?.version;
  const title = kind === 'update' && v ? `You’re on ${v}. How is it so far?` : 'How’s Plenum treating you?';
  const card = document.createElement('div');
  card.id = 'nudge';
  card.className = 'nudge';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Quick feedback');
  card.setAttribute('data-feedback-ignore', '');
  card.innerHTML = `
    <div class="nudge-head"><strong>${esc(title)}</strong>
      <button class="iconbtn" type="button" data-nudge-x aria-label="Dismiss" title="Dismiss">${iconHTML('x', 'sm')}</button></div>
    <div class="nudge-body">
      <button class="btn" type="button" data-rate="up">Good</button>
      <button class="btn" type="button" data-rate="down">Not great</button>
      <button class="nudge-off" type="button" data-nudge-off title="Settings → General turns them back on">Stop asking</button>
    </div>`;
  (document.querySelector('.window.app') || document.body).appendChild(card);
  // First post-update ask goes straight to the star; once asked, updates get the rating instead.
  if (kind === 'update' && !state.prefs.nudge?.starAskedAt) {
    card.setAttribute('aria-label', 'Star Plenum on GitHub');
    return showStarAsk(card, 'Enjoying Plenum?');
  }
  armNudgeFade(card);
  card.querySelector('[data-nudge-off]').addEventListener('click', async () => {
    hideNudge();
    await saveQuietPrefs({ feedbackPrompts: false });
    toast('Prompts off. Settings → General turns them back on.');
  });
  card.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', async () => {
    clearTimeout(nudgeFade);
    const rating = b.dataset.rate;
    card.querySelectorAll('[data-rate], [data-nudge-off]').forEach((el) => { el.disabled = true; });
    if (rating === 'up') {
      try {
        await invoke('feedback.checkin', { rating: 'up', context: kind, comment: '' });
      } catch {
        card.querySelectorAll('[data-rate], [data-nudge-off]').forEach((el) => { el.disabled = false; });
        armNudgeFade(card);
        return;
      }
      if (state.prefs.nudge?.starAskedAt) {
        hideNudge();
        toast('Thanks.', 'ok');
        return;
      }
      showStarAsk(card);
      return;
    }
    showDownAsk(card, kind);
  }));
}

function nudgeTick() {
  const now = Date.now();
  const kind = pickNudge({
    prefs: state.prefs, now, sessionMs: now - nudgeBootAt, idleMs: now - nudgeLastInputAt, busy: nudgeBusy(), pathMissing: nudgePathMissing,
  });
  if (!kind) return;
  saveQuietPrefs({ nudge: markShown(state.prefs.nudge, kind, now) });
  showNudge(kind);
}

async function startNudges() {
  const version = state.appInfo?.version;
  if (!version || !api) return; // Electron-only; Vite preview has no nudge bridge
  const next = noteLaunch(state.prefs.nudge, version, Date.now());
  if (next !== state.prefs.nudge) await saveQuietPrefs({ nudge: next });
  if (!state.prefs.nudge?.pathAskedAt) {
    api.invoke('agents.get').then((a) => { nudgePathMissing = !a.launcher.onPath; }, () => {});
  }
  setInterval(nudgeTick, 30_000);
}

async function boot() {
  applyRunLogHeight();
  if (api) {
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
  } else {
    // Vite-only: keep a version so BETA never stands alone in the title bar.
    state.appInfo = { version: '0.2.14', commit: '', committedAt: '' };
  }
  paintVersion();
  try {
    await startNudges();
  } catch { /* preview has no prefs / agents bridge */ }
  if (api) try {
    const u = await invoke('app.update.state');
    if (u) state.update = u;
  } catch { /* updater optional */ }
  if (typeof api?.onUpdate === 'function') {
    api.onUpdate((u) => applyUpdateState(u));
  }
  // #99 refresh as soon as .git changes under the open repo
  if (typeof api?.onRepoChanged === 'function') {
    api.onRepoChanged((payload) => {
      if (!payload?.root || payload.root !== state.board?.root) return;
      refresh().catch(() => {});
    });
  }
  if (typeof ResizeObserver !== 'undefined' && el.titlebar) {
    const ro = new ResizeObserver(() => syncSearchCollapse());
    ro.observe(el.titlebar);
    ro.observe(el.tabstrip);
  } else {
    window.addEventListener('resize', syncSearchCollapse);
  }
  el.tabstripScroll?.addEventListener('scroll', syncTabScrollFades, { passive: true });
  el.tabstripScroll?.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if (tabStripScrollMax(el.tabstripScroll) <= 2) return;
    e.preventDefault();
    el.tabstripScroll.scrollLeft += e.deltaY;
  }, { passive: false });
  el.tabScrollPrev?.addEventListener('click', () => scrollTabsBy(-1));
  el.tabScrollNext?.addEventListener('click', () => scrollTabsBy(1));
  el.tabAdd?.addEventListener('click', openRepo);
  try {
    state.editors = await invoke('os.editors');
  } catch { state.editors = []; }
  try {
    state.diffMergeTools = await invoke('os.diffMergeTools');
  } catch { state.diffMergeTools = []; }
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
  if (e.target.closest('[data-wip-msg]')) return;
  // Branch pills (incl. overflow menu): checkout / switch is right-click only.
  if (e.target.closest('[data-branch-name]')) return;
  // Clicking the +N chrome itself shouldn’t open the commit.
  if (e.target.closest('.ref-more')) return;
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
el.graph.addEventListener('contextmenu', (e) => {
  const ref = e.target.closest('[data-branch-name]');
  if (ref && el.graph.contains(ref)) {
    e.preventDefault();
    e.stopPropagation();
    openBranchCtxMenu(e.clientX, e.clientY, ref.dataset.branchName);
    return;
  }
  // Right-click on +N chrome (not a branch pill) — ignore.
  if (e.target.closest('.ref-more')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const row = e.target.closest('[data-commit]');
  if (!row || !el.graph.contains(row)) return;
  e.preventDefault();
  const sha = row.dataset.commit;
  const subject = state.board?.commits?.find((c) => c.id === sha)?.subject;
  const { menu, add } = ctxMenuAt(e.clientX, e.clientY);
  add('Copy SHA', () => copyText(sha, 'SHA'));
  if (subject) add('Copy message', () => copyText(subject, 'message'));
  attachCtxMenu(menu);
});
el.graph.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('[data-branch-name], [data-wip-msg], input, textarea')) return;
  const row = e.target.closest('[data-wip-lane], [data-commit]');
  if (!row || !el.graph.contains(row)) return;
  e.preventDefault();
  row.click();
});

el.openRepo.addEventListener('click', openRepo);
el.branchOverview?.querySelector('[data-overview-back]')?.addEventListener('click', () => closeBranchOverview());
boot();
