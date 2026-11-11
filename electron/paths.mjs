import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** On-disk + config names. Legacy `overlook` kept for dual-read only. */
export const MANIFEST_DIR = '.plenum';
export const LEGACY_MANIFEST_DIR = '.overlook';
export const TEAM_BRANCH_KEY = 'plenum.teamBranch';
export const LEGACY_TEAM_BRANCH_KEY = 'overlook.teamBranch';
/** Multi-valued: extra comparison tips for branch ahead/behind (#46). */
export const BASELINE_KEY = 'plenum.baseline';
export const RUN_HOME = path.join(os.homedir(), '.plenum');
export const LEGACY_RUN_HOME = path.join(os.homedir(), '.overlook');

/** Dir that holds lane.yaml - prefer `.plenum`, fall back to `.overlook`. */
export function manifestDir(repoRoot) {
  const root = path.resolve(repoRoot);
  const neu = path.join(root, MANIFEST_DIR);
  const old = path.join(root, LEGACY_MANIFEST_DIR);
  if (fs.existsSync(path.join(neu, 'lane.yaml'))) return neu;
  if (fs.existsSync(path.join(old, 'lane.yaml'))) return old;
  return neu;
}

export function manifestPath(repoRoot) {
  return path.join(manifestDir(repoRoot), 'lane.yaml');
}

/** Always write new manifests under `.plenum`. */
export function writeManifestDir(repoRoot) {
  return path.join(path.resolve(repoRoot), MANIFEST_DIR);
}

/** `~/.plenum/run`, migrating from `~/.overlook/run` once if needed. */
export function runDir() {
  const neu = path.join(RUN_HOME, 'run');
  const old = path.join(LEGACY_RUN_HOME, 'run');
  if (!fs.existsSync(neu) && fs.existsSync(old)) {
    try {
      fs.mkdirSync(RUN_HOME, { recursive: true });
      fs.renameSync(old, neu);
    } catch {
      return old;
    }
  }
  return neu;
}

/** Prefer PLENUM_*; accept OVERLOOK_* for one release. */
export function env(name, fallback) {
  const neu = process.env[`PLENUM_${name}`];
  if (neu != null && neu !== '') return neu;
  const old = process.env[`OVERLOOK_${name}`];
  if (old != null && old !== '') return old;
  return fallback;
}
