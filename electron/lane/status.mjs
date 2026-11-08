import { resolvePorts } from './manifest.mjs';

/**
 * Pure UI fields for a board lane from manifest + index (+ optional process entry).
 * @param {object|null} manifest
 * @param {number} laneIndex
 * @param {object|null} [proc]
 */
export function laneStatus(manifest, laneIndex, proc = null) {
  const runnable = Boolean(manifest) && laneIndex !== 0;
  if (!runnable) {
    return { runnable: false, running: Boolean(proc?.running) };
  }

  const ports = resolvePorts(manifest, laneIndex);
  const urls = Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]),
  );
  const modes = Object.values(manifest.services ?? {}).map((s) => s?.mode);
  // ponytail: v1 collapses to shared|isolated; multi-mode mix needs richer summary later
  const dataMode = modes.length === 0 || modes.some((m) => m === 'shared' || m == null)
    ? 'shared'
    : 'isolated';

  return {
    runnable: true,
    offset: manifest.ports?.offset ?? 0,
    ports,
    urls,
    dataMode,
    running: Boolean(proc?.running),
  };
}
