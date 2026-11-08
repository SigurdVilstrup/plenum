import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Shared-data drift (v1).
 * # ponytail: name-only compare via .overlook/applied-migrations; upgrade is tool-specific
 * migrator introspection (mobaro: Aspire/EF adapter — not blocking v1).
 */

/** True when any service is shared (or services omitted → default shared). */
export function usesSharedData(manifest) {
  const modes = Object.values(manifest?.services ?? {}).map((s) => s?.mode);
  return modes.length === 0 || modes.some((m) => m === 'shared' || m == null);
}

/** Stub adapter: newline filenames in `.overlook/applied-migrations`. */
export async function fileAdapter(root) {
  try {
    const text = await fs.readFile(path.join(root, '.overlook', 'applied-migrations'), 'utf8');
    return new Set(
      text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    );
  } catch (err) {
    if (err && err.code === 'ENOENT') return new Set();
    throw err;
  }
}

/**
 * Pending migration filenames: files in `data.migrations` not in the applied set.
 * @param {string} root
 * @param {object|null|undefined} manifest
 * @param {{ adapter?: (root: string, manifest: object) => Promise<Set<string>> }} [opts]
 * @returns {Promise<string[]>}
 */
export async function listPendingMigrations(root, manifest, { adapter = fileAdapter } = {}) {
  const rel = manifest?.data?.migrations;
  if (!rel) return [];

  const dir = path.join(root, String(rel));
  let names;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const applied = await adapter(root, manifest);
  return names.filter((n) => !applied.has(n));
}

/** @param {string[]} pending */
export function driftError(pending) {
  const err = new Error(`${pending.length} pending migration(s)`);
  err.code = 'DRIFT';
  err.pending = pending;
  return err;
}
