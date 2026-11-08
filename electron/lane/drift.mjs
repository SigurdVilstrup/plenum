import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Shared-data drift (v1).
 * # ponytail: name-only compare via .overlook/applied-migrations; upgrade is tool-specific
 * migrator introspection (mobaro: Aspire/EF adapter — not blocking v1).
 */

/** Resolve `rel` under `base`; reject absolute paths and `..` escapes. */
function resolveContained(base, rel, label) {
  if (path.isAbsolute(rel)) throw new Error(`${label} path escapes lane: ${rel}`);
  const root = path.resolve(base);
  const resolved = path.resolve(base, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`${label} path escapes lane: ${rel}`);
  }
  return resolved;
}

/** True when any service is shared (or services omitted → default shared). */
export function usesSharedData(manifest) {
  const modes = Object.values(manifest?.services ?? {}).map((s) => s?.mode);
  return modes.length === 0 || modes.some((m) => m === 'shared' || m == null);
}

/** Stub adapter: newline filenames in `.overlook/applied-migrations` under markerRoot. */
export async function fileAdapter(markerRoot) {
  try {
    const text = await fs.readFile(path.join(markerRoot, '.overlook', 'applied-migrations'), 'utf8');
    return new Set(
      text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    );
  } catch (err) {
    if (err && err.code === 'ENOENT') return new Set();
    throw err;
  }
}

/**
 * Pending migration filenames: files in the lane's `data.migrations` not in the applied set.
 * Scan `laneRoot` for migration files; read the shared applied marker from `markerRoot`
 * (primary checkout). Defaults markerRoot → laneRoot for single-tree callers/tests.
 * @param {{
 *   laneRoot: string,
 *   markerRoot?: string,
 *   manifest: object|null|undefined,
 *   adapter?: (markerRoot: string, manifest: object) => Promise<Set<string>>,
 * }} opts
 * @returns {Promise<string[]>}
 */
export async function listPendingMigrations({
  laneRoot,
  markerRoot = laneRoot,
  manifest,
  adapter = fileAdapter,
}) {
  const rel = manifest?.data?.migrations;
  if (!rel) return [];

  const dir = resolveContained(laneRoot, String(rel), 'data.migrations');
  let names;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const applied = await adapter(markerRoot, manifest);
  return names.filter((n) => !applied.has(n));
}

/** @param {string[]} pending */
export function driftError(pending) {
  const err = new Error(`${pending.length} pending migration(s)`);
  err.code = 'DRIFT';
  err.pending = pending;
  return err;
}
