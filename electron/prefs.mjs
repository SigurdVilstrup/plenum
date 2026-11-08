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

export function setPrefs(partial, userDataDir) {
  const cur = getPrefs(userDataDir);
  const next = { ...cur, ...(partial && typeof partial === 'object' ? partial : {}) };
  if ('warmTabTtlMs' in (partial || {})) next.warmTabTtlMs = clampTtl(partial.warmTabTtlMs);
  next.version = 1;
  write(next, userDataDir);
  return next;
}
