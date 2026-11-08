import fs from 'node:fs/promises';

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
    out[name] = { mode: svc.mode };
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
