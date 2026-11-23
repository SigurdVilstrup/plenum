#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function repoRootFrom(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'electron', 'main.mjs'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    cwd: opts.cwd,
    env: opts.env || process.env,
  });
}

export function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

export function findPlenumApp(repoRoot) {
  const release = path.join(repoRoot, 'release');
  if (!fs.existsSync(release)) return null;
  const hits = [];
  function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name === 'Plenum.app') hits.push(full);
      else if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'Plenum.app') walk(full, depth + 1);
    }
  }
  walk(release);
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || null;
}

export function asarPathForApp(appPath) {
  return path.join(appPath, 'Contents', 'Resources', 'app.asar');
}

/** Relative ESM import/export sources: './x', '../y.mjs'. */
export function relativeSpecifiers(source) {
  const out = [];
  const re =
    /(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(source))) {
    out.push(m[1] || m[2]);
  }
  return out;
}

export function normalizeAsarEntry(rel) {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}
