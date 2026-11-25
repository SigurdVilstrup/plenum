/** Shared temp dirs for git tests — expand Windows 8.3 TEMP paths when possible. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpBase() {
  const raw = os.tmpdir();
  try {
    return typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(raw)
      : fs.realpathSync(raw);
  } catch {
    return raw;
  }
}

export function tmpDir(prefix = 'plenum-') {
  const dir = fs.mkdtempSync(path.join(tmpBase(), prefix));
  try {
    return typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(dir)
      : fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

/** Compare paths across Windows short/long and slash styles. */
export function samePath(a, b) {
  const norm = (p) => {
    let out = String(p || '');
    try {
      out = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native(out)
        : fs.realpathSync(out);
    } catch {
      out = path.resolve(out);
    }
    return out.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  };
  return norm(a) === norm(b);
}

/** Local git identity + LF for fixtures on Windows runners. */
export function gitIdentity(cwd, sh) {
  sh(['config', 'user.email', 't@e.com'], cwd);
  sh(['config', 'user.name', 'T'], cwd);
  sh(['config', 'commit.gpgsign', 'false'], cwd);
  sh(['config', 'core.autocrlf', 'false'], cwd);
}
