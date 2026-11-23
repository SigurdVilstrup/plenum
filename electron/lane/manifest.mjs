import fs from 'node:fs/promises';
import { manifestPath } from '../paths.mjs';

/** Tiny YAML subset: maps, string lists, scalars, `#` comments. Enough for lane.yaml. */
function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (let raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const hash = commentStart(raw);
    if (hash >= 0) raw = raw.slice(0, hash);
    if (!raw.trim()) continue;

    const indent = raw.search(/\S/);
    const trimmed = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const frame = stack.at(-1);

    if (trimmed.startsWith('- ')) {
      const val = parseScalar(trimmed.slice(2).trim());
      if (frame.arr) {
        frame.arr.push(val);
      } else if (frame.parentObj && frame.parentKey) {
        frame.arr = [];
        frame.parentObj[frame.parentKey] = frame.arr;
        frame.arr.push(val);
      }
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();

    if (rest === '') {
      const child = {};
      frame.obj[key] = child;
      stack.push({ indent, obj: child, parentObj: frame.obj, parentKey: key });
    } else {
      frame.obj[key] = parseScalar(rest);
    }
  }

  return root;
}

function commentStart(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return i;
  }
  return -1;
}

function parseScalar(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * Load a lane manifest. Missing file → null. Unknown version → throws.
 * @param {string} filePath
 */
export async function loadManifest(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }

  const raw = parseYaml(text);
  if (raw.version !== 1) {
    throw new Error(`unsupported lane manifest version: ${raw.version}`);
  }

  return {
    version: 1,
    setup: raw.setup ?? undefined,
    run: raw.run ?? undefined,
    test: raw.test ?? undefined,
    env: {
      copy: Array.isArray(raw.env?.copy) ? raw.env.copy : [],
      set: raw.env?.set && typeof raw.env.set === 'object' && !Array.isArray(raw.env.set) ? raw.env.set : {},
    },
    ports: {
      offset: Number(raw.ports?.offset ?? 0),
      expose: raw.ports?.expose && typeof raw.ports.expose === 'object' && !Array.isArray(raw.ports.expose)
        ? raw.ports.expose
        : {},
    },
    services: normalizeServices(raw.services),
    data: {
      migrations: raw.data?.migrations ?? undefined,
      snapshot: raw.data?.snapshot ?? undefined,
    },
  };
}

function normalizeServices(services) {
  if (!services || typeof services !== 'object') return {};
  const out = {};
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') continue;
    out[name] = {
      mode: svc.mode,
      snapshot: svc.snapshot ?? undefined,
      teardown: svc.teardown ?? undefined,
    };
  }
  return out;
}

/** `{ name: base + offset * laneIndex }` for each ports.expose entry. */
export function resolvePorts(manifest, laneIndex) {
  const offset = manifest.ports?.offset ?? 0;
  const expose = manifest.ports?.expose ?? {};
  const out = {};
  for (const [name, base] of Object.entries(expose)) {
    out[name] = Number(base) + offset * laneIndex;
  }
  return out;
}

/** Stub: replace `{offset}`, `{port.<name>}`, `{lane}` in env.set values. */
export function renderTemplate(str, ctx) {
  if (typeof str !== 'string') return str;
  return str
    .replaceAll('{offset}', String(ctx.offset ?? ''))
    .replaceAll('{lane}', String(ctx.lane ?? ''))
    .replace(/\{port\.([^}]+)\}/g, (_, name) => String(ctx.port?.[name] ?? ctx.ports?.[name] ?? ''));
}

/**
 * Serialize a normalized (or doctor-proposed) manifest to the tiny YAML subset.
 * Omits empty services / data so doctor proposedYaml stays stable.
 * @param {object} m
 * @returns {string}
 */
export function dumpManifest(m) {
  const lines = [`version: ${m.version ?? 1}`];
  if (m.setup) lines.push(`setup: ${yamlScalar(m.setup)}`);
  if (m.run) lines.push(`run: ${yamlScalar(m.run)}`);
  if (m.test) lines.push(`test: ${yamlScalar(m.test)}`);
  const copy = m.env?.copy || [];
  const set = m.env?.set && typeof m.env.set === 'object' && !Array.isArray(m.env.set) ? m.env.set : {};
  if (copy.length || Object.keys(set).length) lines.push('env:');
  if (copy.length) {
    lines.push('  copy:');
    for (const p of copy) lines.push(`    - ${yamlScalar(p)}`);
  }
  if (Object.keys(set).length) {
    lines.push('  set:');
    for (const [k, v] of Object.entries(set)) {
      lines.push(`    ${k}: ${yamlScalar(v)}`);
    }
  }
  lines.push('ports:');
  lines.push(`  offset: ${m.ports?.offset ?? 100}`);
  lines.push('  expose:');
  for (const [k, v] of Object.entries(m.ports?.expose || {})) {
    lines.push(`    ${k}: ${v}`);
  }
  const services = m.services && typeof m.services === 'object' ? m.services : {};
  const svcNames = Object.keys(services);
  if (svcNames.length) {
    lines.push('services:');
    for (const name of svcNames) {
      const svc = services[name] || {};
      lines.push(`  ${name}:`);
      if (svc.mode) lines.push(`    mode: ${yamlScalar(svc.mode)}`);
      if (svc.snapshot) lines.push(`    snapshot: ${yamlScalar(svc.snapshot)}`);
      if (svc.teardown) lines.push(`    teardown: ${yamlScalar(svc.teardown)}`);
    }
  }
  const migrations = m.data?.migrations;
  const dataSnap = m.data?.snapshot;
  if (migrations || dataSnap) {
    lines.push('data:');
    if (migrations) lines.push(`  migrations: ${yamlScalar(migrations)}`);
    if (dataSnap) lines.push(`  snapshot: ${yamlScalar(dataSnap)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Quote when the scalar would break our tiny YAML subset (colon, #, whitespace edges, quotes, newlines). */
export function yamlScalar(s) {
  const str = String(s);
  if (/[\n\r]/.test(str)) throw new Error('yaml scalar cannot contain newlines');
  if (/[:#"'\\\s]/.test(str) || str === '' || /[{}\[\],&*!|>%@`]/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * Read the repo lane.yaml for Settings → Lane.
 * Always returns text when the file exists; parse/version errors set error + manifest null.
 * @param {string} repoPath
 */
export async function getManifest(repoPath) {
  const file = manifestPath(repoPath);
  let text = null;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { hasManifest: false, path: file, text: null, manifest: null, error: null };
    }
    throw err;
  }
  try {
    const manifest = await loadManifest(file);
    return { hasManifest: true, path: file, text, manifest, error: null };
  } catch (err) {
    return {
      hasManifest: true,
      path: file,
      text,
      manifest: null,
      error: String(err?.message || err),
    };
  }
}

/**
 * Normalize a form/API object into loadManifest shape, then dump + validate via acceptManifest.
 * @param {string} repoPath
 * @param {object} obj
 * @param {(repoPath: string, yaml: string, opts?: object) => Promise<string>} accept
 */
export function normalizeManifestInput(obj) {
  const raw = obj && typeof obj === 'object' ? obj : {};
  const envIn = raw.env && typeof raw.env === 'object' ? raw.env : {};
  const portsIn = raw.ports && typeof raw.ports === 'object' ? raw.ports : {};
  const servicesIn = normalizeServices(raw.services);
  const dataIn = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return {
    version: 1,
    setup: raw.setup || undefined,
    run: raw.run || undefined,
    test: raw.test || undefined,
    env: {
      copy: Array.isArray(envIn.copy) ? envIn.copy.map(String).filter(Boolean) : [],
      set: envIn.set && typeof envIn.set === 'object' && !Array.isArray(envIn.set)
        ? Object.fromEntries(Object.entries(envIn.set).filter(([k]) => k))
        : {},
    },
    ports: {
      offset: Number(portsIn.offset ?? 100),
      expose: portsIn.expose && typeof portsIn.expose === 'object' && !Array.isArray(portsIn.expose)
        ? Object.fromEntries(
          Object.entries(portsIn.expose)
            .filter(([k, v]) => k && v != null && v !== '')
            .map(([k, v]) => [k, Number(v)]),
        )
        : {},
    },
    services: servicesIn,
    data: {
      migrations: dataIn.migrations || undefined,
      snapshot: dataIn.snapshot || undefined,
    },
  };
}
