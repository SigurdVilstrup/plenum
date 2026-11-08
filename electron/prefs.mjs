import fs from 'node:fs';
import path from 'node:path';

const TTL_MIN = 30_000;
const TTL_MAX = 600_000;

export function defaultPrefs() {
  return {
    version: 1,
    theme: 'system',
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
    warmTabTtlMs: 120_000,
    credentialHosts: [],
    repoOverrides: {},
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

export function getPrefs(userDataDir) {
  const raw = read(userDataDir);
  if (!raw || typeof raw !== 'object') return defaultPrefs();
  return { ...defaultPrefs(), ...raw, warmTabTtlMs: clampTtl(raw.warmTabTtlMs ?? 120_000) };
}

const ENUMS = {
  theme: ['system', 'light', 'dark'],
  fontPack: ['system', 'inter-jetbrains', 'ibm-plex'],
  editor: ['cursor', 'vscode', 'zed', 'custom'],
  terminal: ['terminal', 'iterm', 'custom'],
  diffTool: ['internal', 'opendiff', 'vscode', 'cursor'],
  mergeTool: ['internal', 'opendiff', 'vscode', 'cursor'],
};
const ABS_PATHS = ['editorPath', 'terminalPath', 'cloneDefaultPath', 'diffToolPath', 'mergeToolPath'];
const BOOLS = ['openLaneInEditor', 'reopenTabs'];

/** Keep only known keys with valid values; drop the rest silently. */
function sanitize(partial) {
  const out = {};
  for (const [k, v] of Object.entries(partial && typeof partial === 'object' ? partial : {})) {
    if (k in ENUMS) { if (ENUMS[k].includes(v)) out[k] = v; }
    else if (ABS_PATHS.includes(k)) {
      if (typeof v === 'string' && (v === '' || v === '~' || v.startsWith('~/') || path.isAbsolute(v))) out[k] = v.trim();
    } else if (BOOLS.includes(k)) out[k] = Boolean(v);
    else if (k === 'defaultLanesFolder') { if (typeof v === 'string') out[k] = v.trim(); }
    else if (k === 'credentialHosts') { if (Array.isArray(v)) out[k] = v; }
    else if (k === 'repoOverrides') {
      if (!v || typeof v !== 'object') continue;
      out[k] = {};
      for (const [root, o] of Object.entries(v)) {
        if (typeof o?.lanesFolder === 'string' && o.lanesFolder.trim()) out[k][root] = { lanesFolder: o.lanesFolder.trim() };
      }
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
  next.version = 1;
  write(next, userDataDir);
  return next;
}
