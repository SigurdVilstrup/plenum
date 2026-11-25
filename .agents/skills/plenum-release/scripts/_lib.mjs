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
    shell: opts.shell || false,
  });
}

export function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/** Packaged Mac app bundle under release/. */
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

/** Packaged Windows executable under release/ (prefer win-unpacked). */
export function findPlenumExe(repoRoot) {
  const release = path.join(repoRoot, 'release');
  if (!fs.existsSync(release)) return null;
  const preferred = path.join(release, 'win-unpacked', 'Plenum.exe');
  if (fs.existsSync(preferred)) return preferred;
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
      if (ent.isFile() && ent.name === 'Plenum.exe') hits.push(full);
      else if (ent.isDirectory() && !ent.name.startsWith('.')) walk(full, depth + 1);
    }
  }
  walk(release);
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || null;
}

/** Host-aware packaged app path (bundle, exe, or absolute --app override). */
export function findPackagedApp(repoRoot, platform = process.platform) {
  if (platform === 'win32') return findPlenumExe(repoRoot);
  return findPlenumApp(repoRoot);
}

export function asarPathForApp(appPath) {
  if (!appPath) return null;
  if (appPath.endsWith('.exe') || appPath.toLowerCase().endsWith('plenum.exe')) {
    // win-unpacked/Plenum.exe → win-unpacked/resources/app.asar
    return path.join(path.dirname(appPath), 'resources', 'app.asar');
  }
  if (appPath.endsWith('.app')) {
    return path.join(appPath, 'Contents', 'Resources', 'app.asar');
  }
  // Directory that already points at unpacked contents
  const winAsar = path.join(appPath, 'resources', 'app.asar');
  if (fs.existsSync(winAsar)) return winAsar;
  const macAsar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (fs.existsSync(macAsar)) return macAsar;
  return path.join(appPath, 'Contents', 'Resources', 'app.asar');
}

/** Launch binary for a packaged app path. */
export function binaryForApp(appPath) {
  if (!appPath) return null;
  if (appPath.endsWith('.exe')) return appPath;
  if (appPath.endsWith('.app')) return path.join(appPath, 'Contents', 'MacOS', 'Plenum');
  const win = path.join(appPath, 'Plenum.exe');
  if (fs.existsSync(win)) return win;
  return path.join(appPath, 'Contents', 'MacOS', 'Plenum');
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
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Key for asar.extractFile / getFile.
 * @electron/asar walks with path.dirname/basename, so nested forward-slash
 * paths break on Windows (`dirname('a/b/c')` → `'a/b'`). Always pass
 * platform separators.
 */
export function asarFileKey(rel, pathApi = path) {
  return normalizeAsarEntry(rel).split('/').filter(Boolean).join(pathApi.sep);
}
