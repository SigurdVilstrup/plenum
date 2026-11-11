import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../git/run.mjs';
import { parseDirty } from '../git/board.mjs';
import { writeManifestDir } from '../paths.mjs';
import { loadManifest } from './manifest.mjs';

/**
 * Read-only lane doctor. Proposes a v1 manifest; writes nothing.
 * @param {string} repoPath
 * @returns {Promise<{ findings: string[], proposed: object, proposedYaml: string, canAccept: boolean }>}
 */
export async function doctor(repoPath) {
  const root = path.resolve(repoPath);
  const findings = [];
  const proposed = {
    version: 1,
    ports: { offset: 100, expose: {} },
    env: { copy: [] },
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

    // ponytail: only the chosen run (+ test) bodies; ignore unused scripts.* ports
    const ports = obviousPortsFromBodies(
      runKey ? scripts[runKey] : null,
      scripts.test || null,
    );
    if (Object.keys(ports).length) {
      proposed.ports.expose = ports;
      findings.push(
        `obvious ports in run/test → expose: ${Object.entries(ports).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
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

  if (await exists(path.join(root, 'Makefile'))) {
    findings.push('found Makefile');
  }

  const apphosts = await findNamed(root, 'apphost.mts', 4);
  for (const rel of apphosts) findings.push(`found ${rel}`);

  const envFiles = await untrackedEnvFiles(root);
  if (envFiles.length) {
    proposed.env.copy = envFiles;
    findings.push(`untracked .env file(s): ${envFiles.join(', ')}`);
  }

  if (!Object.keys(proposed.ports.expose).length) {
    findings.push('wire ports manually');
  }

  const canAccept = typeof proposed.run === 'string' && !!proposed.run.trim();
  if (!canAccept) findings.push('no run command - Accept disabled until the repo has a start script');

  return { findings, proposed, proposedYaml: dumpManifest(proposed), canAccept };
}

/**
 * Write accepted doctor YAML to `<repo>/.plenum/lane.yaml` only.
 * Validates via loadManifest before replacing the dest file.
 * @param {string} repoPath
 * @param {string} yaml
 */
export async function acceptManifest(repoPath, yaml) {
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
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dest, text, 'utf8');
  return dest;
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

/** Scan chosen script bodies for `--port N` / `PORT=N` / `-p N`. First wins as web, then api, then app. */
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
  const names = ['web', 'api', 'app'];
  const out = {};
  nums.slice(0, names.length).forEach((n, i) => { out[names[i]] = n; });
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

function dumpManifest(m) {
  const lines = [`version: ${m.version}`];
  if (m.setup) lines.push(`setup: ${yamlScalar(m.setup)}`);
  if (m.run) lines.push(`run: ${yamlScalar(m.run)}`);
  if (m.test) lines.push(`test: ${yamlScalar(m.test)}`);
  lines.push('env:');
  lines.push('  copy:');
  for (const p of m.env?.copy || []) lines.push(`    - ${yamlScalar(p)}`);
  lines.push('ports:');
  lines.push(`  offset: ${m.ports?.offset ?? 100}`);
  lines.push('  expose:');
  for (const [k, v] of Object.entries(m.ports?.expose || {})) {
    lines.push(`    ${k}: ${v}`);
  }
  return lines.join('\n') + '\n';
}

/** Quote when the scalar would break our tiny YAML subset (colon, #, whitespace edges, quotes, newlines). */
function yamlScalar(s) {
  const str = String(s);
  if (/[\n\r]/.test(str)) throw new Error('yaml scalar cannot contain newlines');
  if (/[:#"'\\\s]/.test(str) || str === '' || /[{}\[\],&*!|>%@`]/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
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
