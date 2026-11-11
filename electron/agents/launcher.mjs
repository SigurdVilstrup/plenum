import fs from 'node:fs';
import path from 'node:path';
import { agentsHome } from './settings.mjs';

const LINK = '/usr/local/bin/plenum';
const LINKS = [LINK, '/opt/homebrew/bin/plenum'];

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const launcherPath = (home = agentsHome()) => path.join(home, 'bin', 'plenum');

export const launcherScript = ({ execPath, cliPath }) =>
  `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(execPath)} ${q(cliPath)} "$@"\n`;

export function ensureLauncher({ packaged, execPath, cliPath, home = agentsHome() }) {
  const p = launcherPath(home);
  if (!packaged && fs.existsSync(p)) return { path: p, written: false };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, launcherScript({ execPath, cliPath }), { mode: 0o755 });
  fs.chmodSync(p, 0o755);
  return { path: p, written: true };
}

export function pathStatus(home = agentsHome(), links = LINKS) {
  const target = launcherPath(home);
  const onPath = links.some((l) => {
    try { return fs.realpathSync(l) === fs.realpathSync(target); } catch { return false; }
  });
  return { onPath, linkPath: LINK };
}

export function linkOnPath(home = agentsHome(), link = LINK) {
  const target = launcherPath(home);
  try {
    try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.symlinkSync(target, link);
    return { ok: true };
  } catch {
    return { ok: false, command: `sudo mkdir -p ${q(path.dirname(link))} && sudo ln -sf ${q(target)} ${q(link)}` };
  }
}
