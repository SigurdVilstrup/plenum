import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENTS, listClients, previewAdd, addClient, removeClient } from './clients.mjs';

const LAUNCHER = '/tmp/pl home/bin/plenum';

// Every test goes through here: temp home, fake launcher, no client binaries searched.
function setup(extra = {}) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-clients-'));
  const opts = { userHome, launcher: LAUNCHER, binDirs: [], ...extra };
  const p = (rel) => path.join(userHome, rel);
  return { userHome, opts, p };
}
const state = (opts, id) => listClients(opts).find((c) => c.id === id);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('nothing installed → all three not-installed', () => {
  const { opts } = setup();
  const l = listClients(opts);
  // Cursor.app may exist on the machine; only assert the other two strictly and cursor unless app present
  assert.equal(l.length, 3);
  assert.equal(state(opts, 'claude-code').state, 'not-installed');
  assert.equal(state(opts, 'codex').state, 'not-installed');
  if (!fs.existsSync('/Applications/Cursor.app')) assert.equal(state(opts, 'cursor').state, 'not-installed');
  assert.deepEqual(CLIENTS.map((c) => c.id), ['cursor', 'claude-code', 'codex']);
});

test('installed without entry → missing; previewAdd shows the exact lines and file', () => {
  const { opts, p } = setup();
  fs.mkdirSync(p('.cursor'));
  fs.mkdirSync(p('.codex'));
  assert.equal(state(opts, 'cursor').state, 'missing');
  const j = previewAdd('cursor', opts);
  assert.equal(j.file, p('.cursor/mcp.json'));
  assert.equal(j.lines, `"plenum": ${JSON.stringify({ command: LAUNCHER, args: ['mcp'] }, null, 2)}`);
  const t = previewAdd('codex', opts);
  assert.equal(t.file, p('.codex/config.toml'));
  assert.equal(t.lines, `[mcp_servers.plenum]\ncommand = "${LAUNCHER}"\nargs = ["mcp"]\n`);
  addClient('cursor', opts);
  assert.ok(fs.readFileSync(p('.cursor/mcp.json'), 'utf8').includes(j.lines.replace(/\n/g, '\n    ')));
  addClient('codex', opts);
  assert.ok(fs.readFileSync(p('.codex/config.toml'), 'utf8').includes(t.lines));
});

test('add then list → ok; remove then list → missing; other servers and top-level keys survive in order', () => {
  const { opts, p } = setup();
  write(p('.claude.json'), '{"a":1,"mcpServers":{"other":{"command":"x"}},"z":2}');
  assert.equal(addClient('claude-code', opts).state, 'ok');
  const j = JSON.parse(fs.readFileSync(p('.claude.json'), 'utf8'));
  assert.deepEqual(Object.keys(j), ['a', 'mcpServers', 'z']);
  assert.deepEqual(j.mcpServers.other, { command: 'x' });
  assert.deepEqual(j.mcpServers.plenum, { command: LAUNCHER, args: ['mcp'] });
  assert.equal(removeClient('claude-code', opts).state, 'missing');
  const k = JSON.parse(fs.readFileSync(p('.claude.json'), 'utf8'));
  assert.deepEqual(Object.keys(k), ['a', 'mcpServers', 'z']);
  assert.deepEqual(k.mcpServers, { other: { command: 'x' } });
});

test('hand-written entry {"command":"plenum"} → stale; addClient fixes only that entry', () => {
  const { opts, p } = setup();
  write(p('.cursor/mcp.json'), JSON.stringify({ mcpServers: { plenum: { command: 'plenum' }, other: { command: 'x' } } }));
  assert.equal(state(opts, 'cursor').state, 'stale');
  assert.equal(addClient('cursor', opts).state, 'ok');
  const j = JSON.parse(fs.readFileSync(p('.cursor/mcp.json'), 'utf8'));
  assert.deepEqual(j.mcpServers.plenum, { command: LAUNCHER, args: ['mcp'] });
  assert.deepEqual(j.mcpServers.other, { command: 'x' });
});

test('invalid JSON (comment, trailing comma, truncated) → unreadable with reason; add throws; bytes unchanged', () => {
  for (const bad of ['{ // hi\n"mcpServers":{}}', '{"mcpServers":{},}', '{"mcpServers":{']) {
    const { opts, p } = setup();
    write(p('.cursor/mcp.json'), bad);
    const s = state(opts, 'cursor');
    assert.equal(s.state, 'unreadable');
    assert.ok(s.reason);
    assert.throws(() => addClient('cursor', opts));
    assert.throws(() => removeClient('cursor', opts));
    assert.equal(fs.readFileSync(p('.cursor/mcp.json'), 'utf8'), bad);
  }
});

const TOML = '[model]\nname = "x"\n\n[mcp_servers.other]\ncommand = "o"\n\n[tools]\nweb = true\n';

test('toml: add appends a block; second add does not duplicate; remove restores the original bytes', () => {
  const { opts, p } = setup();
  const f = p('.codex/config.toml');
  write(f, TOML);
  assert.equal(addClient('codex', opts).state, 'ok');
  const once = fs.readFileSync(f, 'utf8');
  assert.ok(once.startsWith(TOML));
  assert.equal(addClient('codex', opts).state, 'ok');
  assert.equal(fs.readFileSync(f, 'utf8'), once);
  assert.equal(once.match(/\[mcp_servers\.plenum\]/g).length, 1);
  assert.equal(removeClient('codex', opts).state, 'missing');
  assert.equal(fs.readFileSync(f, 'utf8'), TOML);
});

test('toml: block in the middle is replaced in place and surroundings are kept', () => {
  const { opts, p } = setup();
  const f = p('.codex/config.toml');
  write(f, '[a]\nx = 1\n\n[mcp_servers.plenum]\ncommand = "old"\n\n[b]\ny = 2\n');
  assert.equal(state(opts, 'codex').state, 'stale');
  addClient('codex', opts);
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(t.startsWith('[a]\nx = 1\n\n[mcp_servers.plenum]\ncommand = "/tmp/pl home/bin/plenum"\nargs = ["mcp"]\n'));
  assert.ok(t.endsWith('[b]\ny = 2\n'));
  assert.ok(!t.includes('old'));
});

test('toml: remove also drops [mcp_servers.plenum.env]', () => {
  const { opts, p } = setup();
  const f = p('.codex/config.toml');
  write(f, `${TOML}\n[mcp_servers.plenum]\ncommand = "${LAUNCHER}"\nargs = ["mcp"]\n\n[mcp_servers.plenum.env]\nK = "v"\n`);
  removeClient('codex', opts);
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(!t.includes('plenum'));
  assert.ok(!t.includes('K = "v"'));
  assert.ok(t.includes('[mcp_servers.other]') && t.includes('[tools]'));
});

test('toml: launcher path with a space and a quote is escaped and read back as ok', () => {
  const launcher = '/tmp/pl "q" home\\x/bin/plenum';
  const { opts, p } = setup({ launcher });
  fs.mkdirSync(p('.codex'));
  assert.equal(addClient('codex', opts).state, 'ok');
  assert.ok(fs.readFileSync(p('.codex/config.toml'), 'utf8').includes('command = "/tmp/pl \\"q\\" home\\\\x/bin/plenum"'));
  assert.equal(state(opts, 'codex').state, 'ok');
});

test('symlinked config: write lands in the target and the link is still a symlink', () => {
  const { opts, p } = setup();
  const real = path.join(p('dotfiles'), 'mcp.json');
  write(real, '{"mcpServers":{}}');
  fs.mkdirSync(p('.cursor'));
  fs.symlinkSync(real, p('.cursor/mcp.json'));
  addClient('cursor', opts);
  assert.ok(fs.lstatSync(p('.cursor/mcp.json')).isSymbolicLink());
  assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).mcpServers.plenum);
});

test('missing config file but client installed → add creates it (0600); existing mode is kept', () => {
  const { opts, p } = setup();
  fs.mkdirSync(p('.cursor'));
  assert.equal(addClient('cursor', opts).state, 'ok');
  assert.deepEqual(JSON.parse(fs.readFileSync(p('.cursor/mcp.json'), 'utf8')), { mcpServers: { plenum: { command: LAUNCHER, args: ['mcp'] } } });
  assert.equal(fs.statSync(p('.cursor/mcp.json')).mode & 0o777, 0o600);
  write(p('.claude.json'), '{}');
  fs.chmodSync(p('.claude.json'), 0o640);
  addClient('claude-code', opts);
  assert.equal(fs.statSync(p('.claude.json')).mode & 0o777, 0o640);
});

test('not-installed client: add throws and writes nothing', () => {
  const { opts, p } = setup();
  assert.throws(() => addClient('codex', opts));
  assert.ok(!fs.existsSync(p('.codex')));
});
