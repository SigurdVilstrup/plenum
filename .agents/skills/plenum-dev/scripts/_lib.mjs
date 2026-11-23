#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REFERENCES = path.join(SKILL_DIR, 'references');

export function repoRootFrom(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'bin', 'plenum.mjs'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function findPlenumEntry(repoRoot) {
  const local = path.join(repoRoot, 'bin', 'plenum.mjs');
  if (fs.existsSync(local)) return { cmd: process.execPath, argsPrefix: [local] };
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const shim = path.join(home, '.plenum', 'bin', 'plenum');
  if (fs.existsSync(shim)) return { cmd: shim, argsPrefix: [] };
  throw new Error('plenum CLI not found (expected bin/plenum.mjs or ~/.plenum/bin/plenum)');
}

export function plenum(repoRoot, args, { json = false } = {}) {
  const { cmd, argsPrefix } = findPlenumEntry(repoRoot);
  const full = [...argsPrefix, ...args, ...(json ? ['--json'] : [])];
  const r = spawnSync(cmd, full, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const err = new Error((r.stderr || r.stdout || `plenum exited ${r.status}`).trim());
    err.exitCode = r.status || 1;
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  if (!json) return r.stdout;
  const text = (r.stdout || '').trim();
  if (!text) return null;
  return JSON.parse(text);
}

export function featureSlug(name) {
  const feature = String(name || '').trim().replace(/\s+/g, '-');
  if (!feature) throw new Error('Feature name required.');
  if (/[/\\]/.test(feature) || feature.includes('..') || feature.startsWith('-')) {
    throw new Error('Feature name cannot contain path separators or "..".');
  }
  return feature;
}

export function findLane(board, selector) {
  if (!board?.lanes?.length) throw new Error('No lanes on board.');
  if (selector == null || selector === '') {
    const cwd = path.resolve(process.cwd());
    const hit = board.lanes.find((l) => cwd === path.resolve(l.path) || cwd.startsWith(path.resolve(l.path) + path.sep));
    if (hit) return hit;
    throw new Error('No lane selector and cwd is not inside a lane; pass a lane index or name.');
  }
  if (/^\d+$/.test(String(selector))) {
    const idx = Number(selector);
    const hit = board.lanes.find((l) => l.index === idx);
    if (!hit) throw new Error(`No lane with index ${idx}`);
    return hit;
  }
  const want = String(selector).toLowerCase();
  const hit = board.lanes.find(
    (l) =>
      String(l.name).toLowerCase() === want ||
      String(l.branch || '').toLowerCase() === want ||
      String(l.branch || '').toLowerCase() === `feat/${want}` ||
      String(l.folder || '').toLowerCase() === want,
  );
  if (!hit) throw new Error(`No lane matching ${selector}`);
  return hit;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    cwd: opts.cwd,
    env: opts.env || process.env,
  });
  return r;
}

export function git(cwd, args) {
  const r = run('git', args, { cwd });
  if (r.status !== 0) {
    const err = new Error((r.stderr || r.stdout || `git ${args.join(' ')} failed`).trim());
    err.exitCode = r.status || 1;
    throw err;
  }
  return (r.stdout || '').trim();
}

export function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}
