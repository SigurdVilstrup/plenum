import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentsHome } from './settings.mjs';

const LINK = '/usr/local/bin/plenum';
const LINKS = [LINK, '/opt/homebrew/bin/plenum'];

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const qCmd = (s) => `"${String(s).replace(/"/g, '""')}"`;

export const isWindows = (platform = process.platform) => platform === 'win32';

export const launcherPath = (home = agentsHome(), platform = process.platform) =>
  path.join(home, 'bin', isWindows(platform) ? 'plenum.cmd' : 'plenum');

export const launcherScript = ({ execPath, cliPath, platform = process.platform }) => {
  if (isWindows(platform)) {
    // ELECTRON_RUN_AS_NODE makes the packaged exe run the CLI like node.
    return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${qCmd(execPath)} ${qCmd(cliPath)} %*\r\n`;
  }
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(execPath)} ${q(cliPath)} "$@"\n`;
};

export function ensureLauncher({ packaged, execPath, cliPath, home = agentsHome(), platform = process.platform }) {
  const p = launcherPath(home, platform);
  if (!packaged && fs.existsSync(p)) return { path: p, written: false };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const mode = isWindows(platform) ? undefined : 0o755;
  fs.writeFileSync(p, launcherScript({ execPath, cliPath, platform }), mode != null ? { mode } : undefined);
  if (!isWindows(platform)) fs.chmodSync(p, 0o755);
  return { path: p, written: true };
}

function pathDirs() {
  return String(process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
}

export function pathStatus(home = agentsHome(), links = LINKS, platform = process.platform) {
  const target = launcherPath(home, platform);
  if (isWindows(platform)) {
    const bin = path.dirname(target);
    const onPath = pathDirs().some((d) => {
      try {
        return path.resolve(d).toLowerCase() === path.resolve(bin).toLowerCase();
      } catch {
        return false;
      }
    });
    return { onPath, linkPath: bin, windows: true };
  }
  const onPath = links.some((l) => {
    try { return fs.realpathSync(l) === fs.realpathSync(target); } catch { return false; }
  });
  return { onPath, linkPath: LINK, windows: false };
}

export function linkOnPath(home = agentsHome(), link = LINK, platform = process.platform) {
  const target = launcherPath(home, platform);
  if (isWindows(platform)) {
    const bin = path.dirname(target);
    const status = pathStatus(home, [], platform);
    if (status.onPath) return { ok: true, windows: true };
    // User must add ~/.plenum/bin to PATH; we cannot reliably edit user PATH from the app.
    return {
      ok: false,
      windows: true,
      command: `Add ${bin} to your user PATH (Settings → System → About → Advanced system settings → Environment Variables), then reopen the terminal.`,
    };
  }
  try {
    try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.symlinkSync(target, link);
    return { ok: true };
  } catch {
    return { ok: false, command: `sudo mkdir -p ${q(path.dirname(link))} && sudo ln -sf ${q(target)} ${q(link)}` };
  }
}

/** Home dir for display hints (tests can stub). */
export function displayHome() {
  return os.homedir();
}
