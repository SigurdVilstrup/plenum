import fs from 'node:fs';
import path from 'node:path';

/** Common repo-root (and one-level) favicon locations — first hit wins. */
const CANDIDATES = [
  'favicon.ico',
  'favicon.svg',
  'favicon.png',
  'favicon.webp',
  'apple-touch-icon.png',
  'apple-touch-icon.ico',
  'public/favicon.ico',
  'public/favicon.svg',
  'public/favicon.png',
  'public/favicon.webp',
  'app/favicon.ico',
  'app/favicon.svg',
  'app/favicon.png',
  'static/favicon.ico',
  'static/favicon.svg',
  'static/favicon.png',
  'assets/favicon.ico',
  'assets/favicon.svg',
  'assets/favicon.png',
  'src/favicon.ico',
  'src/favicon.svg',
  'src/favicon.png',
  'web/favicon.ico',
  'client/public/favicon.ico',
  'client/public/favicon.svg',
  'client/public/favicon.png',
];

const MIME = {
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Auto-detect favicons stay small in tabs.json. */
const MAX_BYTES = 64 * 1024;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  'coverage', 'vendor', 'target', 'Pods', 'DerivedData', '.turbo', '.cache',
  'tmp', 'temp', '.venv', 'venv', '__pycache__',
]);

const PICK_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const PICK_MAX = 300;
const PICK_DEPTH = 5;

/** Name tokens that bump a file into “Suggested”. */
const SUGGEST_RE = /icon|logo|glyph|favicon|mark|brand|symbol|app[-_]?icon/i;

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function underRoot(abs, root) {
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readSafeFile(abs, root, maxBytes = MAX_BYTES) {
  const link = fs.lstatSync(abs);
  if (link.isSymbolicLink()) {
    const real = fs.realpathSync(abs);
    if (!underRoot(real, root)) return null;
  } else if (!link.isFile()) {
    return null;
  }
  const st = fs.statSync(abs);
  if (!st.isFile() || st.size <= 0 || st.size > maxBytes) return null;
  return fs.readFileSync(abs);
}

function toDataUrl(abs, buf) {
  return `data:${mimeFor(abs)};base64,${buf.toString('base64')}`;
}

/** Fuzzy score — higher = more likely a tab glyph. */
export function imageNameScore(relPath) {
  const base = path.basename(relPath, path.extname(relPath));
  const full = relPath.replace(/\\/g, '/').toLowerCase();
  let score = 0;
  if (/favicon/i.test(base) || /favicon/i.test(full)) score += 80;
  if (/logo/i.test(base)) score += 50;
  if (/glyph/i.test(base)) score += 45;
  if (/icon/i.test(base)) score += 40;
  if (/mark|brand|symbol/i.test(base)) score += 25;
  if (/app[-_]?icon/i.test(base)) score += 35;
  // Path hints (assets/icons/…)
  if (/\/(icons?|logo|brand|favicons?)\//i.test(full)) score += 20;
  if (/^favicon\./i.test(path.basename(relPath))) score += 30;
  // Prefer shallower files slightly
  const depth = full.split('/').length - 1;
  score -= Math.min(depth, 6);
  return score;
}

export function isSuggestedImage(relPath) {
  return SUGGEST_RE.test(path.basename(relPath)) || SUGGEST_RE.test(relPath);
}

/** Return a data-URL for the first favicon found under repoRoot, or null. */
export function readRepoFaviconDataUrl(repoRoot) {
  const root = path.resolve(repoRoot);
  for (const rel of CANDIDATES) {
    const abs = path.join(root, rel);
    try {
      const buf = readSafeFile(abs, root);
      if (!buf) continue;
      return toDataUrl(abs, buf);
    } catch {
      /* missing or unreadable — try next */
    }
  }
  return null;
}

/** Custom protocol URL so the sandboxed renderer can show local repo images. */
export function toPlenumImgUrl(absPath) {
  return `plenum-img://local/?p=${encodeURIComponent(absPath)}`;
}

/** Resolve a repo-relative image to a plenum-img: URL for the renderer. */
export function repoImageFileUrl(repoRoot, relPath) {
  const root = path.resolve(repoRoot);
  const rel = String(relPath || '').replace(/^[/\\]+/, '');
  if (!rel || rel.includes('..')) return null;
  const abs = path.resolve(root, rel);
  if (!underRoot(abs, root)) return null;
  const ext = path.extname(abs).toLowerCase();
  if (!PICK_EXTS.has(ext)) return null;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size <= 0) return null;
    if (fs.lstatSync(abs).isSymbolicLink()) {
      const real = fs.realpathSync(abs);
      if (!underRoot(real, root)) return null;
    }
    return toPlenumImgUrl(abs);
  } catch {
    return null;
  }
}

/** True if absPath is under one of the given repo roots (symlink-safe). */
export function isPathUnderRepos(absPath, repoRoots) {
  const abs = path.resolve(absPath);
  for (const root of repoRoots) {
    const r = path.resolve(root);
    if (!underRoot(abs, r) && abs !== r) continue;
    try {
      if (fs.lstatSync(abs).isSymbolicLink()) {
        const real = fs.realpathSync(abs);
        if (!underRoot(real, r)) continue;
      }
      return true;
    } catch { /* try next root */ }
  }
  return false;
}

/**
 * Scan the checkout for PNG / JPEG / SVG the user can pick.
 * Returns [{ rel, fileUrl, score, suggested }] sorted suggested-first.
 */
export function listRepoImages(repoRoot) {
  const root = path.resolve(repoRoot);
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= PICK_MAX || depth > PICK_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (out.length >= PICK_MAX) return;
      const name = ent.name;
      if (name.startsWith('.') && name !== '.') continue;
      const abs = path.join(dir, name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      const ext = path.extname(name).toLowerCase();
      if (!PICK_EXTS.has(ext)) continue;
      try {
        if (ent.isSymbolicLink()) {
          const real = fs.realpathSync(abs);
          if (!underRoot(real, root)) continue;
        }
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size <= 0) continue;
        const rel = path.relative(root, abs).split(path.sep).join('/');
        const score = imageNameScore(rel);
        out.push({
          rel,
          fileUrl: toPlenumImgUrl(abs),
          score,
          suggested: isSuggestedImage(rel) || score >= 35,
        });
      } catch { /* skip */ }
    }
  };
  walk(root, 0);
  out.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return out;
}

export {
  CANDIDATES as FAVICON_CANDIDATES,
  MAX_BYTES as FAVICON_MAX_BYTES,
  PICK_MAX as FAVICON_PICK_MAX,
};
