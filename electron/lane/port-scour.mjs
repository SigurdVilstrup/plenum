import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeManifestDir } from '../paths.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  '.turbo', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv',
]);
const SKIP_FILES = /\.(lock|min\.js|min\.css|map|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|zip|gz|br|wasm|bin|dylib|so|o|a)$/i;
const SKIP_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock',
]);

/** Loopback / LAN host + port, or common bind forms. */
const HOST_PORT = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|host\.docker\.internal|10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}):(\d{2,5})\b/gi;
const BIND_PORT = /(?:--port|(?<![A-Za-z0-9_])PORT=)\s*(\d{2,5})\b|(?:listen|createServer)\s*\(\s*(\d{2,5})\b/gi;

/**
 * Stable hash for allowlist matching: path + normalized snippet.
 * @param {string} filePath
 * @param {string} snippet
 */
export function snippetHash(filePath, snippet) {
  const norm = String(snippet).replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(`${filePath}\0${norm}`).digest('hex').slice(0, 16);
}

/**
 * @param {string} repoPath
 * @param {{ maxFiles?: number, maxHits?: number }} [opts]
 * @returns {Promise<Array<{ path: string, line: number, snippet: string, kind: string, hash: string }>>}
 */
export async function scourPortHits(repoPath, opts = {}) {
  const root = path.resolve(repoPath);
  const maxFiles = opts.maxFiles ?? 400;
  const maxHits = opts.maxHits ?? 80;
  const hits = [];
  let files = 0;

  async function walk(dir, rel) {
    if (files >= maxFiles || hits.length >= maxHits) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files >= maxFiles || hits.length >= maxHits) return;
      if (ent.name.startsWith('.') && ent.name !== '.env' && !ent.name.startsWith('.env.')) {
        if (ent.name !== '.plenum' && ent.name !== '.overlook') continue;
      }
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(full, childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      if (SKIP_NAMES.has(ent.name) || SKIP_FILES.test(ent.name)) continue;
      files += 1;
      await scanFile(full, childRel, hits, maxHits);
    }
  }

  await walk(root, '');
  return hits;
}

async function scanFile(full, rel, hits, maxHits) {
  let text;
  try {
    const st = await fs.stat(full);
    if (st.size > 512 * 1024) return;
    text = await fs.readFile(full, 'utf8');
  } catch {
    return;
  }
  if (text.includes('\0')) return;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (hits.length >= maxHits) return;
    const line = lines[i];
    if (!/\d{2,5}/.test(line)) continue;
    HOST_PORT.lastIndex = 0;
    BIND_PORT.lastIndex = 0;
    let m;
    let kind = null;
    let snippet = null;
    if ((m = HOST_PORT.exec(line))) {
      kind = 'host-port';
      snippet = m[0];
    } else if ((m = BIND_PORT.exec(line))) {
      kind = 'bind';
      snippet = m[0];
    }
    if (!kind) continue;
    const port = Number(m[1] || m[2]);
    if (!(port >= 1 && port <= 65535)) continue;
    hits.push({
      path: rel,
      line: i + 1,
      snippet: snippet.slice(0, 120),
      kind,
      hash: snippetHash(rel, snippet),
    });
  }
}

/**
 * @param {string} repoPath
 * @returns {Promise<Array<{ path: string, line?: number, snippetHash: string, note?: string }>>}
 */
export async function loadAllowlist(repoPath) {
  const file = path.join(writeManifestDir(repoPath), 'port-allowlist');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row.path === 'string' && typeof row.snippetHash === 'string') {
        out.push({
          path: row.path,
          line: Number.isInteger(row.line) ? row.line : undefined,
          snippetHash: row.snippetHash,
          note: typeof row.note === 'string' ? row.note : undefined,
        });
      }
    } catch { /* skip bad lines */ }
  }
  return out;
}

/**
 * @param {string} repoPath
 * @param {{ path: string, line?: number, snippetHash: string, note?: string }} entry
 */
export async function addAllowlistEntry(repoPath, entry) {
  if (!entry?.path || !entry?.snippetHash) throw new Error('allowlist entry needs path and snippetHash');
  const dir = writeManifestDir(repoPath);
  const file = path.join(dir, 'port-allowlist');
  await fs.mkdir(dir, { recursive: true });
  const list = await loadAllowlist(repoPath);
  if (list.some((x) => x.path === entry.path && x.snippetHash === entry.snippetHash)) {
    return file;
  }
  const row = {
    path: entry.path,
    ...(entry.line != null ? { line: entry.line } : {}),
    snippetHash: entry.snippetHash,
    ...(entry.note ? { note: entry.note } : {}),
  };
  await fs.appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
  return file;
}

/**
 * Filter hits against allowlist (path + snippetHash).
 * @param {Array<{ path: string, hash: string }>} hits
 * @param {Array<{ path: string, snippetHash: string }>} allowlist
 */
export function filterHits(hits, allowlist) {
  const keys = new Set(allowlist.map((a) => `${a.path}\0${a.snippetHash}`));
  return hits.filter((h) => !keys.has(`${h.path}\0${h.hash}`));
}

/**
 * Check that each exposed port name is referenced from run or env.set; propose wires.
 * @param {object|null} manifest
 * @returns {{ unused: string[], unreferencedHits: number, proposedWires: Record<string, string> }}
 */
export function wiringChecks(manifest, openHits = []) {
  const expose = manifest?.ports?.expose && typeof manifest.ports.expose === 'object'
    ? Object.keys(manifest.ports.expose)
    : [];
  const run = String(manifest?.run || '');
  const envSet = manifest?.env?.set && typeof manifest.env.set === 'object' ? manifest.env.set : {};
  const setBlob = Object.values(envSet).map(String).join('\n');
  const blob = `${run}\n${setBlob}`;
  const unused = expose.filter((name) => !blob.includes(`{port.${name}}`) && !blob.includes(`{ports.${name}}`));
  const proposedWires = {};
  const hasApiWire = Object.values(envSet).some((v) => String(v).includes('{port.api}'));
  if (expose.includes('api') && !hasApiWire) {
    proposedWires.VITE_API_URL = 'http://127.0.0.1:{port.api}';
  }
  for (const name of unused) {
    if (name === 'web' && !blob.includes('{port.web}')) {
      proposedWires.PORT = '{port.web}';
    }
  }
  return {
    unused,
    unreferencedHits: openHits.length,
    proposedWires,
  };
}
