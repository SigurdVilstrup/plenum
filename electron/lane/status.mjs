import { resolvePorts } from './manifest.mjs';

/**
 * Pure UI fields for a board lane from manifest + index (+ optional process / lastTest).
 * @param {object|null} manifest
 * @param {number} laneIndex
 * @param {object|null} [proc]
 * @param {object|null} [lastTest]
 */
export function laneStatus(manifest, laneIndex, proc = null, lastTest = null) {
  const runnable = Boolean(manifest) && laneIndex !== 0;
  if (!runnable) {
    return {
      runnable: false,
      running: Boolean(proc?.running),
      ...(lastTest ? { lastTest } : {}),
    };
  }

  const ports = resolvePorts(manifest, laneIndex);
  const urls = Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]),
  );
  const modes = Object.values(manifest.services ?? {}).map((s) => s?.mode);
  // ponytail: any snapshot wins the badge; mixed shared+snapshot needs a richer label later
  const dataMode = modes.some((m) => m === 'snapshot')
    ? 'snapshot'
    : modes.length === 0 || modes.some((m) => m === 'shared' || m == null)
      ? 'shared'
      : 'isolated';

  return {
    runnable: true,
    offset: manifest.ports?.offset ?? 0,
    ports,
    urls,
    dataMode,
    running: Boolean(proc?.running),
    ...(lastTest ? { lastTest } : {}),
  };
}
