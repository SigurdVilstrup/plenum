/**
 * Cross-platform shell helpers for lane run/test commands.
 * Windows uses Git Bash so lane.yaml recipes stay POSIX.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GIT_BASH_CANDIDATES = [
  () => process.env.PLENUM_GIT_BASH,
  () => process.env.GIT_BASH,
  () => 'C:\\Program Files\\Git\\bin\\bash.exe',
  () => 'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  () => {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    return path.join(pf, 'Git', 'bin', 'bash.exe');
  },
  () => {
    const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return path.join(pf, 'Git', 'bin', 'bash.exe');
  },
  () => {
    const local = process.env.LOCALAPPDATA || '';
    return local ? path.join(local, 'Programs', 'Git', 'bin', 'bash.exe') : '';
  },
];

let cachedBash = undefined;

/** Resolve Git Bash on Windows; null on other platforms. */
export function findGitBash() {
  if (process.platform !== 'win32') return null;
  if (cachedBash !== undefined) return cachedBash;
  for (const get of GIT_BASH_CANDIDATES) {
    const p = get();
    if (p && fs.existsSync(p)) {
      cachedBash = p;
      return cachedBash;
    }
  }
  try {
    const out = execFileSync('where.exe', ['bash.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      cachedBash = out;
      return cachedBash;
    }
  } catch {
    /* no bash on PATH */
  }
  cachedBash = null;
  return null;
}

/** Clear cached bash path (tests). */
export function resetGitBashCache() {
  cachedBash = undefined;
}

export function missingGitBashError() {
  const err = new Error(
    'Git Bash not found. Install Git for Windows (https://git-scm.com/download/win) so lane run/test commands can use the same shell as on macOS.',
  );
  err.code = 'NO_GIT_BASH';
  return err;
}

/**
 * How to run a shell command string for lane recipes.
 * @returns {{ shell: true, command: string } | { shell: false, file: string, args: string[] }}
 */
export function shellSpec(command) {
  if (process.platform !== 'win32') {
    return { shell: true, command: String(command) };
  }
  const bash = findGitBash();
  if (!bash) throw missingGitBashError();
  return { shell: false, file: bash, args: ['-lc', String(command)] };
}

/** Async spawn of a shell command string (Unix shell:true; Windows Git Bash -lc). */
export function spawnShellAsync(command, opts = {}) {
  const spec = shellSpec(command);
  if (spec.shell) {
    return spawn(spec.command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env,
      stdio: opts.stdio ?? 'pipe',
      detached: opts.detached,
      windowsHide: true,
    });
  }
  return spawn(spec.file, spec.args, {
    shell: false,
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.stdio ?? 'pipe',
    detached: opts.detached,
    windowsHide: true,
  });
}

/** Sync spawn of a shell command string. */
export function spawnShell(command, opts = {}) {
  const spec = shellSpec(command);
  if (spec.shell) {
    return spawnSync(spec.command, {
      shell: true,
      encoding: opts.encoding,
      cwd: opts.cwd,
      env: opts.env,
      stdio: opts.stdio,
      timeout: opts.timeout,
      windowsHide: true,
    });
  }
  return spawnSync(spec.file, spec.args, {
    shell: false,
    encoding: opts.encoding,
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.stdio,
    timeout: opts.timeout,
    windowsHide: true,
  });
}
