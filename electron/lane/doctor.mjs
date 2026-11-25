import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../git/run.mjs';
import { parseDirty } from '../git/board.mjs';
import { writeManifestDir, manifestPath } from '../paths.mjs';
import { loadManifest, dumpManifest, normalizeManifestInput } from './manifest.mjs';
import {
  scourPortHits,
  loadAllowlist,
  filterHits,
  wiringChecks,
} from './port-scour.mjs';
import { buildAgentPrompt } from './agent-prompt.mjs';

/**
 * Read-only lane doctor. Proposes a v1 manifest; writes nothing.
 * @param {string} repoPath
 * @returns {Promise<{ findings: string[], proposed: object, proposedYaml: string, canAccept: boolean, hits: object[], allowlist: object[], wiring: object, agentPrompt: string }>}
 */
export async function doctor(repoPath) {
  const root = path.resolve(repoPath);
  const findings = [];
  const proposed = {
    version: 1,
    ports: { offset: 100, expose: {} },
    env: { copy: [], set: {} },
  };

  const pkg = await readJson(path.join(root, 'package.json'));
  if (pkg) {
    const pm = await detectPm(root);
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const runKey = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
    if (runKey) {
      proposed.run = pmCmd(pm, runKey);
      findings.push(`package.json scripts.${runKey} → run: ${proposed.run}`);
    } else {
      findings.push('package.json has no scripts.dev or scripts.start');
    }
    if (scripts.test) {
      proposed.test = pmCmd(pm, 'test');
      findings.push(`package.json scripts.test → test: ${proposed.test}`);
    }
    proposed.setup = `${pm} install`;
    findings.push(`package manager ${pm} → setup: ${proposed.setup}`);

    // Prefer ports in the chosen run (+ test) bodies; if empty, fall back to other scripts.*
    // (e.g. concurrently "npm:fe:a" where --port lives on fe:a, not on dev).
    let ports = obviousPortsFromBodies(
      runKey ? scripts[runKey] : null,
      scripts.test || null,
    );
    let portSource = 'run/test';
    if (!Object.keys(ports).length) {
      const otherBodies = Object.entries(scripts)
        .filter(([k]) => k !== runKey && k !== 'test')
        .map(([, body]) => body);
      ports = obviousPortsFromBodies(...otherBodies);
      if (Object.keys(ports).length) portSource = 'other scripts.*';
    }
    if (Object.keys(ports).length) {
      proposed.ports.expose = ports;
      findings.push(
        `obvious ports in ${portSource} → expose: ${Object.entries(ports).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
      );
    }
  } else {
    findings.push('no package.json at repo root');
  }

  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    if (await exists(path.join(root, name))) {
      findings.push(`found ${name}`);
      break;
    }
  }

  const hasMakefile = await exists(path.join(root, 'Makefile'));
  if (hasMakefile) {
    findings.push('found Makefile');
    if (!proposed.run) {
      const makeRun = await makefileRunTarget(root);
      if (makeRun) {
        proposed.run = `make ${makeRun}`;
        findings.push(`Makefile ${makeRun}: → run: ${proposed.run}`);
      }
    }
  }

  const apphosts = await findNamed(root, 'apphost.mts', 4);
  for (const rel of apphosts) {
    findings.push(
      proposed.run
        ? `found ${rel}`
        : `found ${rel} — no auto start command; add a run: line in the proposal (or a package.json scripts.dev/start)`,
    );
  }

  const envFiles = await untrackedEnvFiles(root);
  if (envFiles.length) {
    proposed.env.copy = envFiles;
    findings.push(`untracked .env file(s): ${envFiles.join(', ')}`);
  }

  const rawHits = await scourPortHits(root);
  const allowlist = await loadAllowlist(root);
  const hits = filterHits(rawHits, allowlist);
  if (hits.length) {
    findings.push(
      `${hits.length} port hit${hits.length === 1 ? '' : 's'} (localhost/LAN + port) — wire via env.set {port.*} or allowlist`,
    );
    for (const h of hits.slice(0, 8)) {
      findings.push(`  ${h.path}:${h.line}  ${h.snippet}`);
    }
    if (hits.length > 8) findings.push(`  …and ${hits.length - 8} more`);
  } else if (rawHits.length) {
    findings.push(`all ${rawHits.length} port hit${rawHits.length === 1 ? '' : 's'} allowlisted`);
  }

  if (!Object.keys(proposed.ports.expose).length) {
    const fromHits = obviousPortsFromHitSnippets(hits);
    if (Object.keys(fromHits).length) {
      proposed.ports.expose = fromHits;
      findings.push(
        `ports from open hits → expose: ${Object.entries(fromHits).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
      );
    } else {
      findings.push('wire ports manually');
    }
  }

  let existing = null;
  try {
    existing = await loadManifest(manifestPath(root));
  } catch { /* ignore */ }
  const forWiring = existing || proposed;
  // Only propose wires for ports that exist on the proposal we would write.
  const proposeExpose = proposed.ports?.expose || {};
  if (Object.keys(proposeExpose).includes('api') && !proposed.env?.set?.VITE_API_URL) {
    proposed.env = proposed.env || { copy: [], set: {} };
    proposed.env.set = { ...(proposed.env.set || {}), VITE_API_URL: 'http://127.0.0.1:{port.api}' };
    findings.push('proposed wire: VITE_API_URL → http://127.0.0.1:{port.api}');
  }
  const wiring = wiringChecks(forWiring, hits);
  if (wiring.unused.length) {
    findings.push(`exposed ports unused in run/env.set: ${wiring.unused.join(', ')}`);
  }

  const canAccept = typeof proposed.run === 'string' && !!proposed.run.trim();
  if (!canAccept) {
    findings.push(
      'no run command yet — edit the proposal below to add run: … then Write (Accept stays off until a start command is set)',
    );
  }

  const proposedYaml = dumpManifest(proposed);
  const agentPrompt = buildAgentPrompt({
    proposed,
    findings,
    hits,
    wiring,
    canAccept,
    hasManifest: !!existing,
  });

  return {
    findings,
    proposed,
    proposedYaml,
    canAccept,
    hits,
    allowlist,
    wiring,
    agentPrompt,
  };
}

/**
 * Write accepted doctor YAML to `<repo>/.plenum/lane.yaml` only.
 * Validates via loadManifest before replacing the dest file.
 * @param {string} repoPath
 * @param {string} yaml
 */
export async function acceptManifest(repoPath, yaml, opts = {}) {
  if (typeof yaml !== 'string' || !yaml.trim()) {
    throw new Error('yaml must be a non-empty string');
  }
  const root = path.resolve(repoPath);
  const dir = writeManifestDir(root);
  const dest = path.join(dir, 'lane.yaml');
  if (!dest.startsWith(root + path.sep) || !dir.startsWith(root + path.sep)) {
    throw new Error('path escape rejected');
  }

  const text = yaml.endsWith('\n') ? yaml : yaml + '\n';
  const tmp = path.join(os.tmpdir(), `plenum-lane-${process.pid}-${Date.now()}.yaml`);
  await fs.writeFile(tmp, text, 'utf8');
  try {
    const m = await loadManifest(tmp);
    if (!m || m.version !== 1 || typeof m.run !== 'string' || !m.run.trim()) {
      throw new Error('manifest must be version 1 with a run command');
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    if (err && /manifest must be version 1/.test(err.message)) throw err;
    throw new Error(`invalid lane.yaml: ${err.message || err}`);
  }
  await fs.unlink(tmp).catch(() => {});

  // ponytail: fixed single-file write; multi-file accept if doctor ever proposes more
  if (opts.createOnly) {
    for (const p of [dir, dest]) {
      const st = await fs.lstat(p).catch(() => null);
      if (st && st.isSymbolicLink()) throw new Error('Refused: .plenum/lane.yaml must not be a symlink.');
    }
    await fs.mkdir(dir, { recursive: true });
    if ((await fs.realpath(dir)) !== path.join(await fs.realpath(root), '.plenum')) {
      throw new Error('path escape rejected');
    }
    try {
      await fs.writeFile(dest, text, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        throw new Error('Refused: this repo already has lane setup. Agents can create it but not replace it; the user edits .plenum/lane.yaml themselves.');
      }
      throw err;
    }
    return dest;
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dest, text, 'utf8');
  return dest;
}

/**
 * Write a normalized manifest object (Settings → Lane form).
 * Validates snapshot services have a seed command before dump.
 * @param {string} repoPath
 * @param {object} obj
 */
export async function writeManifest(repoPath, obj) {
  const m = normalizeManifestInput(obj);
  if (typeof m.run !== 'string' || !m.run.trim()) {
    throw new Error('manifest must be version 1 with a run command');
  }
  for (const [name, svc] of Object.entries(m.services || {})) {
    if (svc?.mode === 'snapshot' && !(svc.snapshot || m.data?.snapshot)) {
      throw new Error(`service ${name}: mode snapshot needs a snapshot command (or data.snapshot)`);
    }
  }
  return acceptManifest(repoPath, dumpManifest(m));
}

function pmCmd(pm, script) {
  if (script === 'test' && pm === 'npm') return 'npm test';
  if (pm === 'npm') return `npm run ${script}`;
  return `${pm} ${script}`;
}

async function detectPm(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** Scan script bodies for `--port N` / `PORT=N` / `-p N`. First wins as web, then api, then app. */
function obviousPortsFromBodies(...bodies) {
  const nums = [];
  const seen = new Set();
  for (const body of bodies) {
    if (typeof body !== 'string') continue;
    for (const m of body.matchAll(/(?:--port|PORT=|-p)\s*(\d{2,5})\b/gi)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 65535 && !seen.has(n)) {
        seen.add(n);
        nums.push(n);
      }
    }
  }
  return namePorts(nums);
}

/** Unique port numbers from scour hit snippets → web/api/app (then port4…). */
function obviousPortsFromHitSnippets(hits) {
  const nums = [];
  const seen = new Set();
  for (const h of hits || []) {
    const snip = String(h?.snippet || '');
    for (const m of snip.matchAll(/\b(\d{2,5})\b/g)) {
      const n = Number(m[1]);
      if (n >= 1024 && n <= 65535 && !seen.has(n)) {
        seen.add(n);
        nums.push(n);
      }
    }
  }
  return namePorts(nums);
}

function namePorts(nums) {
  const names = ['web', 'api', 'app'];
  const out = {};
  nums.slice(0, 6).forEach((n, i) => {
    out[names[i] || `port${i + 1}`] = n;
  });
  return out;
}

async function untrackedEnvFiles(root) {
  let text = '';
  try {
    text = await git(['status', '--porcelain', '-u'], root);
  } catch {
    return [];
  }
  return parseDirty(text)
    .filter((f) => f.code === '??' && /(^|\/)\.env(\.|$)/.test(f.path) && !/[\n\r]/.test(f.path))
    .map((f) => f.path);
}

/** First Makefile target among run / start / serve / dev (simple `name:` lines only). */
async function makefileRunTarget(root) {
  let text = '';
  try {
    text = await fs.readFile(path.join(root, 'Makefile'), 'utf8');
  } catch {
    return null;
  }
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w.-]*)\s*:/.exec(line);
    if (m) names.add(m[1]);
  }
  for (const want of ['run', 'start', 'serve', 'dev']) {
    if (names.has(want)) return want;
  }
  return null;
}

async function findNamed(root, basename, maxDepth) {
  const out = [];
  async function walk(dir, depth, rel) {
    if (depth > maxDepth || out.length >= 8) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(path.join(dir, ent.name), depth + 1, childRel);
      else if (ent.name === basename) out.push(childRel);
    }
  }
  await walk(root, 0, '');
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
