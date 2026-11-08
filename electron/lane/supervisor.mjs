import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../git/run.mjs';
import { loadManifest, resolvePorts, renderTemplate } from './manifest.mjs';

const LOG_LINES = 200;
const TEST_LOG_LINES = 50;
const TEST_TIMEOUT_MS = 10 * 60 * 1000;
/** @type {Map<string, { root: string, laneIndex: number, pid: number, startedAt: number, urls: Record<string, string>, logs: { stdout: string[], stderr: string[] }, child: import('node:child_process').ChildProcess }>} */
const procs = new Map();
/** @type {Map<string, { ok: boolean, code: number|null, at: number, log: string[] }>} */
const lastTests = new Map();
/** @type {Map<string, Promise<{ ok: boolean, code: number|null, at: number, log: string[] }>>} */
const inflightTests = new Map();

function procKey(root, laneIndex) {
  let abs = path.resolve(root);
  try { abs = fs.realpathSync(abs); } catch { /* keep resolved */ }
  return `${abs}#${laneIndex}`;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pushLog(lines, chunk, max = LOG_LINES) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line && lines.length && lines.at(-1) === '') continue;
    lines.push(line);
  }
  while (lines.length > max) lines.shift();
}

function snapshot(entry) {
  if (!entry) return null;
  const running = alive(entry.pid);
  return {
    root: entry.root,
    laneIndex: entry.laneIndex,
    pid: entry.pid,
    startedAt: entry.startedAt,
    urls: entry.urls,
    running,
    logs: { stdout: entry.logs.stdout.slice(), stderr: entry.logs.stderr.slice() },
  };
}

/** Process lookup for board / IPC. */
export function getProc(root, laneIndex) {
  const entry = procs.get(procKey(root, laneIndex));
  if (!entry) return null;
  const snap = snapshot(entry);
  if (!snap.running) {
    procs.delete(procKey(root, laneIndex));
    return { ...snap, running: false };
  }
  return snap;
}

/** Last one-shot test result for board / IPC. */
export function getLastTest(root, laneIndex) {
  return lastTests.get(procKey(root, laneIndex)) ?? null;
}

async function prepareLane(root, laneIndex) {
  if (laneIndex === 0) throw new Error('protected: primary checkout cannot be run');

  const { top, paths } = await resolveLanes(root);
  const cwd = paths[laneIndex];
  if (!cwd) throw new Error(`lane ${laneIndex} not found`);

  const manifest = await loadManifest(path.join(paths[0], '.overlook', 'lane.yaml'));
  const ports = resolvePorts(manifest ?? { ports: { offset: 0, expose: {} } }, laneIndex);
  const offset = (manifest?.ports?.offset ?? 0) * laneIndex;
  const urls = Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]),
  );
  const ctx = { offset, lane: laneIndex, port: ports, ports };
  const env = {
    ...process.env,
    OVERLOOK_LANE: String(laneIndex),
    OVERLOOK_OFFSET: String(offset),
  };
  for (const [k, v] of Object.entries(manifest?.env?.set ?? {})) {
    env[k] = renderTemplate(String(v), ctx);
  }
  return { top, cwd, manifest, ports, offset, urls, ctx, env };
}

async function resolveLanes(root) {
  const abs = path.resolve(root);
  const top = path.resolve((await git(['rev-parse', '--show-toplevel'], abs)).trim());
  const text = await git(['worktree', 'list', '--porcelain'], top);
  const paths = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length));
  }
  return { top, paths };
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

/**
 * Start the lane's `run` command. Idempotent if already running.
 * @param {string} root
 * @param {number} laneIndex
 */
export async function up(root, laneIndex) {
  const { top, cwd, manifest, urls, ctx, env } = await prepareLane(root, laneIndex);
  const existing = getProc(top, laneIndex);
  if (existing?.running) return existing;
  if (!manifest?.run) throw new Error('lane manifest has no run command');

  const child = spawn(renderTemplate(String(manifest.run), ctx), {
    shell: true,
    detached: true,
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    child.once('error', onError);
    if (child.pid != null) {
      child.off('error', onError);
      resolve();
      return;
    }
    child.once('spawn', () => {
      child.off('error', onError);
      if (child.pid == null) reject(new Error('spawn produced no pid'));
      else resolve();
    });
  });

  if (child.pid == null) throw new Error('spawn produced no pid');

  const key = procKey(top, laneIndex);
  const entry = {
    root: top,
    laneIndex,
    pid: child.pid,
    startedAt: Date.now(),
    urls,
    logs: { stdout: [], stderr: [] },
    child,
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => pushLog(entry.logs.stdout, d));
  child.stderr.on('data', (d) => pushLog(entry.logs.stderr, d));
  child.on('error', () => {
    if (procs.get(key) === entry) procs.delete(key);
  });
  child.on('exit', () => {
    if (procs.get(key) === entry) procs.delete(key);
  });

  procs.set(key, entry);
  return snapshot(entry);
}

/**
 * Stop a running lane: SIGTERM, then SIGKILL after 5s.
 * @param {string} root
 * @param {number} laneIndex
 */
export async function down(root, laneIndex) {
  const { top } = await resolveLanes(root);
  const key = procKey(top, laneIndex);
  const entry = procs.get(key);
  if (!entry) return null;

  const { pid, child } = entry;
  if (!alive(pid)) {
    procs.delete(key);
    return snapshot({ ...entry, pid });
  }

  killGroup(pid, 'SIGTERM');

  await new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null || child.killed || !alive(pid)) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      if (alive(pid)) killGroup(pid, 'SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    // exit may have fired between the pre-check and once('exit')
    if (child.exitCode != null || child.signalCode != null || child.killed || !alive(pid)) {
      clearTimeout(t);
      resolve();
    }
  });

  procs.delete(key);
  return { ...snapshot(entry), running: false, pid };
}

/**
 * Run the lane's `test` command to completion. Does not touch the long-lived procs map.
 * @param {string} root
 * @param {number} laneIndex
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function test(root, laneIndex, { timeoutMs = TEST_TIMEOUT_MS } = {}) {
  const key = procKey(root, laneIndex);
  if (inflightTests.has(key)) throw new Error('test already in progress for this lane');

  const run = (async () => {
    const { top, cwd, manifest, ctx, env } = await prepareLane(root, laneIndex);
    if (!manifest?.test) throw new Error('lane manifest has no test command');

    const child = spawn(renderTemplate(String(manifest.test), ctx), {
      shell: true,
      detached: true,
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      child.once('error', onError);
      if (child.pid != null) {
        child.off('error', onError);
        resolve();
        return;
      }
      child.once('spawn', () => {
        child.off('error', onError);
        if (child.pid == null) reject(new Error('spawn produced no pid'));
        else resolve();
      });
    });

    if (child.pid == null) throw new Error('spawn produced no pid');

    const log = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => pushLog(log, d, TEST_LOG_LINES));
    child.stderr.on('data', (d) => pushLog(log, d, TEST_LOG_LINES));

    const code = await new Promise((resolve) => {
      let settled = false;
      const finish = (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceDone);
        resolve(exitCode);
      };
      const timer = setTimeout(() => {
        if (alive(child.pid)) killGroup(child.pid, 'SIGKILL');
      }, timeoutMs);
      // ponytail: if kill doesn't reap, don't hang forever
      const forceDone = setTimeout(() => finish(null), timeoutMs + 2000);
      child.once('exit', (exitCode) => finish(exitCode));
      child.once('error', () => finish(null));
    });

    const result = { ok: code === 0, code, at: Date.now(), log: log.slice() };
    lastTests.set(procKey(top, laneIndex), result);
    return result;
  })();

  inflightTests.set(key, run);
  try {
    return await run;
  } finally {
    if (inflightTests.get(key) === run) inflightTests.delete(key);
  }
}

/** Force-stop every supervised process (app quit). */
export function stopAll() {
  for (const entry of procs.values()) {
    if (alive(entry.pid)) killGroup(entry.pid, 'SIGKILL');
  }
  procs.clear();
}
