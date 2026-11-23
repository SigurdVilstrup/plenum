import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../git/run.mjs';
import { loadManifest, resolvePorts, renderTemplate } from './manifest.mjs';
import { driftError, listPendingMigrations, usesSharedData } from './drift.mjs';
import { manifestPath, runDir } from '../paths.mjs';

const LOG_TEE = fileURLToPath(new URL('./log-tee.mjs', import.meta.url));

const LOG_LINES = 200;
const DISPLAY_LOG_LINES = 500;
const LOG_TAIL_BYTES = 512 * 1024;
const TEST_LOG_LINES = 50;
const TEST_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_DIR = runDir();

/** In-process child handles (run logs live on disk — survive CLI exit). */
/** @type {Map<string, { child: import('node:child_process').ChildProcess, logs: { stdout: string[], stderr: string[] }, pid: number, root: string, laneIndex: number, command?: string }>} */
const children = new Map();
/** @type {Map<string, { ok: boolean, code: number|null, at: number, log: string[] }>} */
const lastTests = new Map();
/** @type {Map<string, Promise<{ ok: boolean, code: number|null, at: number, log: string[] }>>} */
const inflightTests = new Map();

function absRoot(root) {
  let abs = path.resolve(root);
  try { abs = fs.realpathSync(abs); } catch { /* keep resolved */ }
  return abs;
}

function procKey(root, laneIndex) {
  return `${absRoot(root)}#${laneIndex}`;
}

function rootHash(root) {
  return crypto.createHash('sha256').update(absRoot(root)).digest('hex').slice(0, 16);
}

/** Shared pid registry path for a repo root (CLI + Electron). */
export function registryPathFor(root) {
  return path.join(RUN_DIR, `${rootHash(root)}.json`);
}

/** Per-lane run log path (stdout+stderr merged; survives CLI exit via inherited FD). */
export function logPathFor(root, laneIndex) {
  return path.join(RUN_DIR, `${rootHash(root)}-${Number(laneIndex)}.log`);
}

function logMetaPath(root, laneIndex) {
  return path.join(RUN_DIR, `${rootHash(root)}-${Number(laneIndex)}.meta.json`);
}

function writeLogMeta(root, laneIndex, meta) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(logMetaPath(root, laneIndex), JSON.stringify(meta));
}

function readLogMeta(root, laneIndex) {
  try {
    const raw = JSON.parse(fs.readFileSync(logMetaPath(root, laneIndex), 'utf8'));
    if (raw && typeof raw === 'object') return raw;
  } catch { /* missing */ }
  return null;
}

/**
 * Tail last N lines from a log file without loading the whole file.
 * @param {string} file
 * @param {number} maxLines
 */
function tailLogLines(file, maxLines = DISPLAY_LOG_LINES) {
  if (!fs.existsSync(file)) return { lines: [], truncated: false };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { lines: [], truncated: false };
  }
  if (!stat.size) return { lines: [], truncated: false };

  const readBytes = Math.min(stat.size, LOG_TAIL_BYTES);
  const buf = Buffer.alloc(readBytes);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
  } finally {
    fs.closeSync(fd);
  }

  let text = buf.toString('utf8');
  if (stat.size > readBytes) {
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }
  const all = text.split(/\r?\n/);
  if (all.length && all.at(-1) === '') all.pop();
  const truncated = all.length > maxLines || stat.size > readBytes;
  return { lines: all.slice(-maxLines), truncated };
}

function readReg(root) {
  try {
    const data = JSON.parse(fs.readFileSync(registryPathFor(root), 'utf8'));
    if (data && data.lanes && typeof data.lanes === 'object') return data;
  } catch { /* missing / corrupt */ }
  return { root: absRoot(root), lanes: {} };
}

function writeReg(root, data) {
  // ponytail: rename for atomicity; flock if concurrent writers collide
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const file = registryPathFor(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ root: absRoot(root), lanes: data.lanes }, null, 0));
  fs.renameSync(tmp, file);
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

function snapshot(stored, local, { running } = {}) {
  if (!stored) return null;
  const isRunning = running ?? alive(stored.pid);
  return {
    root: stored.root,
    laneIndex: stored.laneIndex,
    pid: stored.pid,
    startedAt: stored.startedAt,
    urls: stored.urls ?? {},
    command: stored.command || local?.command || '',
    running: isRunning,
    // Run output lives in logPathFor; keep empty rings so board payloads stay light.
    logs: {
      stdout: local?.logs?.stdout?.slice() ?? [],
      stderr: local?.logs?.stderr?.slice() ?? [],
    },
  };
}

function getStored(root, laneIndex) {
  const data = readReg(root);
  const raw = data.lanes[String(laneIndex)];
  if (!raw?.pid) return { data, stored: null };
  return {
    data,
    stored: {
      root: data.root ?? absRoot(root),
      laneIndex: Number(laneIndex),
      pid: raw.pid,
      startedAt: raw.startedAt,
      urls: raw.urls ?? {},
      command: raw.command ?? '',
    },
  };
}

function setStored(root, laneIndex, entry) {
  const data = readReg(root);
  data.lanes[String(laneIndex)] = {
    pid: entry.pid,
    startedAt: entry.startedAt,
    urls: entry.urls ?? {},
    command: entry.command ?? '',
  };
  writeReg(root, data);
}

function clearStored(root, laneIndex) {
  const data = readReg(root);
  if (!(String(laneIndex) in data.lanes)) return;
  delete data.lanes[String(laneIndex)];
  writeReg(root, data);
}

/** Process lookup for board / IPC / CLI. File registry is source of truth. */
export function getProc(root, laneIndex) {
  const key = procKey(root, laneIndex);
  const { data, stored } = getStored(root, laneIndex);
  if (!stored) {
    children.delete(key);
    return null;
  }
  const local = children.get(key);
  if (!alive(stored.pid)) {
    delete data.lanes[String(laneIndex)];
    writeReg(root, data);
    children.delete(key);
    return snapshot(stored, local, { running: false });
  }
  return snapshot(stored, local, { running: true });
}

/** Last one-shot test result for board / IPC. */
export function getLastTest(root, laneIndex) {
  return lastTests.get(procKey(root, laneIndex)) ?? null;
}

/**
 * Read the durable run log for a lane (file-backed; works after CLI `up` exits).
 * @param {string} root
 * @param {number} laneIndex
 * @param {{ maxLines?: number }} [opts]
 */
export function readLogs(root, laneIndex, { maxLines = DISPLAY_LOG_LINES } = {}) {
  const top = absRoot(root);
  const file = logPathFor(top, laneIndex);
  const { lines, truncated } = tailLogLines(file, maxLines);
  const proc = getProc(top, laneIndex);
  const meta = readLogMeta(top, laneIndex);
  return {
    running: proc?.running ?? false,
    pid: proc?.pid ?? meta?.pid ?? null,
    startedAt: proc?.startedAt ?? meta?.startedAt ?? null,
    command: proc?.command || meta?.command || '',
    lines,
    truncated,
  };
}

/**
 * Truncate the durable log in place (running child keeps writing to the same inode).
 * Meta (command / pid) is kept.
 * @param {string} root
 * @param {number} laneIndex
 */
export function clearLogs(root, laneIndex) {
  const top = absRoot(root);
  const file = logPathFor(top, laneIndex);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  try {
    if (fs.existsSync(file)) fs.truncateSync(file, 0);
    else fs.writeFileSync(file, '');
  } catch (err) {
    throw new Error(`Couldn’t clear log: ${err.message || err}`);
  }
  return readLogs(top, laneIndex);
}

async function prepareLane(root, laneIndex) {
  const { top, paths } = await resolveLanes(root);
  const cwd = paths[laneIndex];
  if (!cwd) throw new Error(`lane ${laneIndex} not found`);

  const manifest = await loadManifest(manifestPath(paths[0]));
  const ports = resolvePorts(manifest ?? { ports: { offset: 0, expose: {} } }, laneIndex);
  const offset = (manifest?.ports?.offset ?? 0) * laneIndex;
  const urls = Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]),
  );
  const ctx = { offset, lane: laneIndex, port: ports, ports };
  const env = {
    ...process.env,
    PLENUM_LANE: String(laneIndex),
    PLENUM_OFFSET: String(offset),
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

/** One-shot shell command; rejects with stderr on non-zero exit. */
function runOnce(command, cwd, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (exit ${code}): ${stderr.trim() || '(no stderr)'}`));
    });
  });
}

/** For each snapshot service, run services.<name>.snapshot or data.snapshot once. */
async function runSnapshots(manifest, cwd, ctx, env) {
  for (const [name, svc] of Object.entries(manifest?.services ?? {})) {
    if (svc?.mode !== 'snapshot') continue;
    const cmd = svc.snapshot ?? manifest.data?.snapshot;
    if (!cmd) throw new Error(`snapshot service "${name}" has no snapshot command`);
    await runOnce(renderTemplate(String(cmd), ctx), cwd, env, `snapshot(${name})`);
  }
}

/**
 * Start the lane's `run` command. Idempotent if already running.
 * Throws Error with `code: 'DRIFT'` and `pending` when shared migrations are unapplied.
 * @param {string} root
 * @param {number} laneIndex
 * @param {{ force?: boolean }} [opts]  `force: true` skips the drift gate ("start anyway")
 */
export async function up(root, laneIndex, { force = false } = {}) {
  const { top, cwd, manifest, urls, ctx, env } = await prepareLane(root, laneIndex);
  const existing = getProc(top, laneIndex);
  if (existing?.running) return existing;
  if (!manifest?.run) throw new Error('lane.yaml has no run command');

  if (!force && manifest.data?.migrations && usesSharedData(manifest)) {
    const pending = await listPendingMigrations({
      laneRoot: cwd,
      markerRoot: top,
      manifest,
    });
    if (pending.length) throw driftError(pending);
  }

  await runSnapshots(manifest, cwd, ctx, env);

  // Durable timestamped log via log-tee (survives CLI `up` exit). Truncate only on new spawn.
  const command = renderTemplate(String(manifest.run), ctx);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const logFile = logPathFor(top, laneIndex);
  fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, [LOG_TEE, logFile, command], {
    shell: false,
    detached: true,
    cwd,
    env,
    stdio: 'ignore',
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
  const startedAt = Date.now();
  const local = {
    child,
    logs: { stdout: [], stderr: [] },
    pid: child.pid,
    root: top,
    laneIndex,
    command,
  };
  child.on('error', () => {
    if (children.get(key) === local) children.delete(key);
    clearStored(top, laneIndex);
  });
  child.on('exit', () => {
    if (children.get(key) === local) children.delete(key);
    clearStored(top, laneIndex);
  });

  children.set(key, local);
  setStored(top, laneIndex, { pid: child.pid, startedAt, urls, command });
  writeLogMeta(top, laneIndex, { pid: child.pid, startedAt, command });
  // CLI must exit after up; unref so the child does not pin the event loop.
  child.unref();
  return snapshot({ root: top, laneIndex, pid: child.pid, startedAt, urls, command }, local, { running: true });
}

/**
 * Stop a running lane: SIGTERM, then SIGKILL after 5s.
 * Works cross-process via pid in the shared registry file.
 * @param {string} root
 * @param {number} laneIndex
 */
export async function down(root, laneIndex) {
  const { top } = await resolveLanes(root);
  const key = procKey(top, laneIndex);
  const { stored } = getStored(top, laneIndex);
  if (!stored) {
    children.delete(key);
    return null;
  }

  const local = children.get(key);
  const { pid } = stored;
  if (!alive(pid)) {
    clearStored(top, laneIndex);
    children.delete(key);
    return snapshot(stored, local, { running: false });
  }

  killGroup(pid, 'SIGTERM');

  await new Promise((resolve) => {
    const child = local?.child;
    const done = () => resolve();
    const t = setTimeout(() => {
      if (alive(pid)) killGroup(pid, 'SIGKILL');
      done();
    }, 5000);

    if (child) {
      if (child.exitCode != null || child.signalCode != null || child.killed || !alive(pid)) {
        clearTimeout(t);
        done();
        return;
      }
      child.once('exit', () => {
        clearTimeout(t);
        done();
      });
      if (child.exitCode != null || child.signalCode != null || child.killed || !alive(pid)) {
        clearTimeout(t);
        done();
      }
      return;
    }

    // Cross-process: no child handle - poll until dead or timeout fires
    const iv = setInterval(() => {
      if (!alive(pid)) {
        clearInterval(iv);
        clearTimeout(t);
        done();
      }
    }, 50);
  });

  clearStored(top, laneIndex);
  children.delete(key);
  return snapshot(stored, local, { running: false });
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
    if (!manifest?.test) throw new Error('lane.yaml has no test command');

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

/** Force-stop every process this runtime spawned (app quit). */
export function stopAll() {
  for (const local of children.values()) {
    if (alive(local.pid)) killGroup(local.pid, 'SIGKILL');
    clearStored(local.root, local.laneIndex);
  }
  children.clear();
}
