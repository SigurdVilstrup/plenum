import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Join with the target platform's separators — host `path.join` breaks cross-OS unit tests. */
function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export const PLENUM_GITHUB = {
  owner: 'SigurdVilstrup',
  repo: 'plenum',
  url: 'https://github.com/SigurdVilstrup/plenum',
};

/** Candidate `gh` paths. Dock-launched Electron often misses Homebrew on PATH. */
export function ghCandidates(home = process.env.HOME || process.env.USERPROFILE || '', platform = process.platform) {
  const join = pathFor(platform).join;
  if (platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const local = process.env.LOCALAPPDATA || '';
    return [
      'gh.exe',
      'gh',
      join(pf, 'GitHub CLI', 'gh.exe'),
      local ? join(local, 'Programs', 'GitHub CLI', 'gh.exe') : null,
    ].filter(Boolean);
  }
  return [
    'gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    home ? join(home, '.local/bin/gh') : null,
  ].filter(Boolean);
}

/**
 * Resolve a usable `gh` binary. Bare `gh` is only accepted when PATH actually
 * contains it — Dock-launched Electron often has a slim PATH, so we fall through
 * to Homebrew / ~/.local absolute candidates instead of returning `gh` and
 * dying with spawn ENOENT later.
 */
export function resolveGhBin({
  home = process.env.HOME || process.env.USERPROFILE || '',
  existsSync = fs.existsSync,
  pathEnv = process.env.PATH || '',
  bins = null,
  platform = process.platform,
} = {}) {
  const list = bins || ghCandidates(home, platform);
  const join = pathFor(platform).join;
  const ghName = platform === 'win32' ? 'gh.exe' : 'gh';
  // Prefer the platform under test (tests pass Unix PATH on a Windows runner).
  const delim = platform === 'win32' ? ';' : ':';
  for (const b of list) {
    if (b === 'gh' || b === 'gh.exe') {
      for (const dir of String(pathEnv).split(delim)) {
        if (!dir) continue;
        const abs = join(dir, ghName);
        if (existsSync(abs)) return abs;
      }
      continue;
    }
    if (existsSync(b)) return b;
  }
  return null;
}

async function starWithGh(bin, execFileImpl) {
  await execFileImpl(bin, [
    'api',
    '-X', 'PUT',
    `/user/starred/${PLENUM_GITHUB.owner}/${PLENUM_GITHUB.repo}`,
  ], { timeout: 12_000, maxBuffer: 256 * 1024 });
}

/**
 * Star SigurdVilstrup/plenum: try `gh api`, else open the repo in the browser.
 * Returns `{ via: 'gh' | 'browser' }`.
 */
export async function starPlenumRepo({
  home = process.env.HOME || process.env.USERPROFILE || '',
  existsSync = fs.existsSync,
  execFileImpl = execFileAsync,
  openExternal,
  bins = null,
} = {}) {
  if (typeof openExternal !== 'function') throw new Error('openExternal required');
  // Prefer a resolved absolute path; if the caller injects `bins`, try each in order
  // (tests / overrides) and keep ENOENT fallthrough for missing stubs.
  const list = bins || [resolveGhBin({ home, existsSync })].filter(Boolean);
  for (const bin of list) {
    try {
      await starWithGh(bin, execFileImpl);
      return { via: 'gh' };
    } catch (err) {
      if (err?.code === 'ENOENT') continue; // missing binary → try next path
      break; // gh ran but failed (auth / scopes / network) → browser
    }
  }
  await openExternal(PLENUM_GITHUB.url);
  return { via: 'browser' };
}
