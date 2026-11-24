import fs from 'node:fs';
import path from 'node:path';
import {
  defaultGraphColumns,
  isLegacyAllOnGraphColumns,
  normalizeGraphColumns,
} from './graph-columns-pref.mjs';
import { DEFAULT_FAME_CATEGORIES, normalizeFameCategories } from './fame-categories.mjs';

const TTL_MIN = 30_000;
const TTL_MAX = 600_000;
const PREFS_VERSION = 2;

export function defaultPrefs() {
  return {
    version: PREFS_VERSION,
    theme: 'system',
    chroma: 'muted',
    zoom: 1,
    fontPack: 'system',
    editor: 'cursor',
    editorPath: '',
    openLaneInEditor: true,
    terminal: 'terminal',
    terminalPath: '',
    diffTool: 'internal',
    diffToolPath: '',
    mergeTool: 'internal',
    mergeToolPath: '',
    cloneDefaultPath: '',
    defaultLanesFolder: '.worktrees',
    reopenTabs: true,
    tabFavicons: true,
    gravatar: true,
    tourDone: false,
    feedbackPrompts: true,
    statsFame: 'mine',
    statsFameCategories: [...DEFAULT_FAME_CATEGORIES],
    nudge: {},
    warmTabTtlMs: 120_000,
    credentialHosts: [],
    repoOverrides: {},
    graphColumns: defaultGraphColumns(),
  };
}

function storePath(userDataDir) {
  if (!userDataDir) throw new Error('userDataDir required');
  return path.join(userDataDir, 'prefs.json');
}

function read(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(storePath(userDataDir), 'utf8'));
  } catch {
    return null;
  }
}

function write(data, userDataDir) {
  const file = storePath(userDataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clampTtl(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 120_000;
  return Math.min(TTL_MAX, Math.max(TTL_MIN, Math.round(n)));
}

const ENUMS = {
  theme: ['system', 'light', 'dark'],
  chroma: ['muted', 'vibrant', 'arcade', 'fairytale', 'studio', 'retro', 'bricks'],
  fontPack: ['system', 'inter-jetbrains', 'ibm-plex'],
  editor: ['cursor', 'vscode', 'zed', 'windsurf', 'custom'],
  terminal: ['terminal', 'iterm', 'custom'],
  diffTool: ['internal', 'opendiff', 'vscode', 'cursor', 'windsurf'],
  mergeTool: ['internal', 'opendiff', 'vscode', 'cursor', 'windsurf'],
  statsFame: ['mine', 'all'],
};
const ABS_PATHS = ['editorPath', 'terminalPath', 'cloneDefaultPath', 'diffToolPath', 'mergeToolPath'];
const BOOLS = ['openLaneInEditor', 'reopenTabs', 'tabFavicons', 'gravatar', 'tourDone', 'feedbackPrompts'];

export function getPrefs(userDataDir) {
  const raw = read(userDataDir);
  if (!raw || typeof raw !== 'object') return defaultPrefs();
  const merged = { ...defaultPrefs(), ...raw, warmTabTtlMs: clampTtl(raw.warmTabTtlMs ?? 120_000) };
  // Drop retired Appearance keys (accent picker / cool-vs-neutral light).
  delete merged.accent;
  delete merged.lightPalette;
  if (!ENUMS.chroma.includes(merged.chroma)) merged.chroma = 'muted';
  merged.statsFameCategories = normalizeFameCategories(merged.statsFameCategories);
  // #133: collapse Author + SHA when prefs still look like the old all-on default.
  const legacyGraph = isLegacyAllOnGraphColumns(raw.graphColumns);
  merged.graphColumns = normalizeGraphColumns(
    legacyGraph ? defaultGraphColumns() : merged.graphColumns,
  );
  const ver = Number(raw.version) || 1;
  if (legacyGraph || ver < PREFS_VERSION || !Array.isArray(raw.statsFameCategories)) {
    merged.version = PREFS_VERSION;
    write(merged, userDataDir);
  }
  return merged;
}

/** Keep only known keys with valid values; drop the rest silently. */
function sanitize(partial) {
  const out = {};
  for (const [k, v] of Object.entries(partial && typeof partial === 'object' ? partial : {})) {
    if (k in ENUMS) { if (ENUMS[k].includes(v)) out[k] = v; }
    else if (ABS_PATHS.includes(k)) {
      if (typeof v === 'string' && (v === '' || v === '~' || v.startsWith('~/') || path.isAbsolute(v))) out[k] = v.trim();
    } else if (BOOLS.includes(k)) out[k] = Boolean(v);
    else if (k === 'defaultLanesFolder') { if (typeof v === 'string') out[k] = v.trim(); }
    else if (k === 'nudge') {
      if (!v || typeof v !== 'object') continue;
      const o = {};
      for (const f of ['firstSeenAt', 'lastShownAt', 'checkinAt', 'updatedAt', 'pathAskedAt', 'starAskedAt']) {
        if (v[f] === null || Number.isFinite(v[f])) o[f] = v[f];
      }
      if (typeof v.seenVersion === 'string') o.seenVersion = v.seenVersion.slice(0, 40);
      out[k] = o;
    } else if (k === 'credentialHosts') { if (Array.isArray(v)) out[k] = v; }
    else if (k === 'repoOverrides') {
      if (!v || typeof v !== 'object') continue;
      out[k] = {};
      for (const [root, o] of Object.entries(v)) {
        if (!o || typeof o !== 'object') continue;
        const row = {};
        if (typeof o.lanesFolder === 'string' && o.lanesFolder.trim()) row.lanesFolder = o.lanesFolder.trim();
        if (o.protectedPicked === true) row.protectedPicked = true;
        if (Object.keys(row).length) out[k][root] = row;
      }
    } else if (k === 'graphColumns') {
      if (Array.isArray(v)) out[k] = normalizeGraphColumns(v);
    } else if (k === 'statsFameCategories') {
      if (Array.isArray(v)) out[k] = normalizeFameCategories(v);
    } else if (k === 'warmTabTtlMs' || k === 'zoom') out[k] = v;
  }
  return out;
}

export function setPrefs(raw, userDataDir) {
  const partial = sanitize(raw);
  const cur = getPrefs(userDataDir);
  const next = { ...cur, ...partial };
  if ('warmTabTtlMs' in partial) next.warmTabTtlMs = clampTtl(partial.warmTabTtlMs);
  if ('zoom' in partial) next.zoom = Math.min(1.25, Math.max(0.8, Number(partial.zoom) || 1));
  next.version = PREFS_VERSION;
  write(next, userDataDir);
  return next;
}
