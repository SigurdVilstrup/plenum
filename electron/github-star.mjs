import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PLENUM_GITHUB = {
  owner: 'SigurdVilstrup',
  repo: 'plenum',
  url: 'https://github.com/SigurdVilstrup/plenum',
};

/** Candidate `gh` paths. Dock-launched Electron often misses Homebrew on PATH. */
export function ghCandidates(home = process.env.HOME || '') {
  return [
    'gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    home ? path.join(home, '.local/bin/gh') : null,
  ].filter(Boolean);
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
  home = process.env.HOME || '',
  existsSync = fs.existsSync,
  execFileImpl = execFileAsync,
  openExternal,
  bins = null,
} = {}) {
  if (typeof openExternal !== 'function') throw new Error('openExternal required');
  const list = bins || ghCandidates(home).filter((b) => b === 'gh' || existsSync(b));
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
