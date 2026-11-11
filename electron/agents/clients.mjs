import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launcherPath } from './launcher.mjs';

export const CLIENTS = [
  { id: 'cursor', label: 'Cursor', file: '.cursor/mcp.json', format: 'json' },
  { id: 'claude-code', label: 'Claude Code', file: '.claude.json', format: 'json' },
  { id: 'codex', label: 'Codex', file: '.codex/config.toml', format: 'toml' },
];

const INSTALLED = {
  cursor: (h) => [h('.cursor'), '/Applications/Cursor.app'],
  'claude-code': (h) => [h('.claude'), h('.claude.json')],
  codex: (h) => [h('.codex')],
};

const ctx = (id, { userHome = os.homedir(), launcher = launcherPath() } = {}) => {
  const c = CLIENTS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown client: ${id}`);
  const h = (rel) => path.join(userHome, rel);
  return { ...c, path: h(c.file), launcher, installed: INSTALLED[id](h).some((p) => fs.existsSync(p)) };
};

const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tomlBlock = (launcher) => `[mcp_servers.plenum]\ncommand = ${tomlStr(launcher)}\nargs = ["mcp"]\n`;
const HEADER = /^\[mcp_servers\.plenum(\.[^\]]+)?\]\s*$/;

// Line range [start, end) of the plenum block in TOML text, or null.
function tomlRange(lines) {
  const start = lines.findIndex((l) => HEADER.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (!lines[end].startsWith('[') || HEADER.test(lines[end]))) end++;
  while (end > start + 1 && lines[end - 1].trim() === '') end--; // blank lines belong to what follows
  return [start, end];
}

// Undo TOML basic-string escaping for the one value we compare.
const tomlUnstr = (s) => s.replace(/\\(["\\])/g, '$1');

function tomlEntryOk(lines, [s, e], launcher) {
  const body = lines.slice(s, e);
  const cmd = body.map((l) => l.match(/^command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/)).find(Boolean);
  const args = body.some((l) => /^args\s*=\s*\[\s*"mcp"\s*\]\s*$/.test(l));
  return !!cmd && tomlUnstr(cmd[1]) === launcher && args;
}

function inspect(c) {
  if (!c.installed) return { state: 'not-installed' };
  let text;
  try { text = fs.readFileSync(c.path, 'utf8'); } catch (e) {
    return e.code === 'ENOENT' ? { state: 'missing', text: null } : { state: 'unreadable', reason: e.message };
  }
  if (c.format === 'toml') {
    const lines = text.replace(/\n$/, '').split('\n');
    const r = tomlRange(lines);
    if (!r) return { state: 'missing', text, lines };
    return { state: tomlEntryOk(lines, r, c.launcher) ? 'ok' : 'stale', text, lines, range: r };
  }
  let json;
  try { json = JSON.parse(text); } catch (e) { return { state: 'unreadable', reason: e.message }; }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { state: 'unreadable', reason: 'top level is not a JSON object' };
  const e = json.mcpServers?.plenum;
  if (e === undefined) return { state: 'missing', text, json };
  const ok = e && e.command === c.launcher && Array.isArray(e.args) && e.args.length === 1 && e.args[0] === 'mcp';
  return { state: ok ? 'ok' : 'stale', text, json };
}

const status = (c) => {
  const { state, reason } = inspect(c);
  return { id: c.id, label: c.label, file: c.path, state, ...(reason ? { reason } : {}) };
};

function writeAtomic(file, text) {
  let real = file;
  let mode = 0o600;
  try { real = fs.realpathSync(file); mode = fs.statSync(real).mode & 0o777; } catch { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  const tmp = `${real}.plenum-tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, real);
}

const jsonEntry = (launcher) => ({ command: launcher, args: ['mcp'] });

export const listClients = (opts) => CLIENTS.map((c) => status(ctx(c.id, opts)));

export function previewAdd(id, opts) {
  const c = ctx(id, opts);
  const lines = c.format === 'toml'
    ? tomlBlock(c.launcher)
    : `"plenum": ${JSON.stringify(jsonEntry(c.launcher), null, 2)}`;
  return { file: c.path, lines };
}

function editable(id, opts) {
  const c = ctx(id, opts);
  const i = inspect(c);
  if (i.state === 'not-installed') throw new Error(`${c.label} is not installed`);
  if (i.state === 'unreadable') throw new Error(`${c.label} config is unreadable: ${i.reason}`);
  return { c, i };
}

export function addClient(id, opts) {
  const { c, i } = editable(id, opts);
  if (c.format === 'toml') {
    const block = tomlBlock(c.launcher).replace(/\n$/, '').split('\n');
    let out;
    if (i.range) out = [...i.lines.slice(0, i.range[0]), ...block, ...i.lines.slice(i.range[1])];
    else out = i.text ? [...i.lines, '', ...block] : block;
    writeAtomic(c.path, `${out.join('\n')}\n`);
  } else {
    const json = i.json ?? {};
    json.mcpServers = { ...(json.mcpServers ?? {}) };
    json.mcpServers.plenum = jsonEntry(c.launcher);
    writeAtomic(c.path, `${JSON.stringify(json, null, 2)}\n`);
  }
  return status(c);
}

export function removeClient(id, opts) {
  const { c, i } = editable(id, opts);
  if (i.state === 'missing') return status(c);
  if (c.format === 'toml') {
    const [s, e] = i.range;
    let from = s;
    // drop the blank line that add put before the block
    if (from > 0 && i.lines[from - 1] === '') from--;
    const rest = [...i.lines.slice(0, from), ...i.lines.slice(e)];
    writeAtomic(c.path, rest.length ? `${rest.join('\n')}\n` : '');
  } else {
    delete i.json.mcpServers.plenum;
    writeAtomic(c.path, `${JSON.stringify(i.json, null, 2)}\n`);
  }
  return status(c);
}
