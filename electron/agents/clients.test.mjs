import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENTS, listClients, previewAdd, addClient, removeClient } from './clients.mjs';

const LAUNCHER = '/tmp/pl home/bin/plenum';

// Every test goes through here: temp home, temp apps dir, fake launcher.
function setup(extra = {}) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-clients-'));
  const opts = { userHome, appsDir: path.join(userHome, 'Applications'), launcher: LAUNCHER, ...extra };
  const p = (rel) => path.join(userHome, rel);
  return { userHome, opts, p };
}
const state = (opts, id) => listClients(opts).find((c) => c.id === id);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('nothing installed → all three not-installed', () => {
  const { opts } = setup();
  const l = listClients(opts);
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((c) => c.state), ['not-installed', 'not-installed', 'not-installed']);
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

test('Cursor.app in appsDir (no .cursor dir) makes Cursor missing', () => {
  const { opts, p } = setup();
  fs.mkdirSync(p('Applications/Cursor.app'), { recursive: true });
  assert.equal(state(opts, 'cursor').state, 'missing');
});

const codexFile = (text) => { const s = setup(); const f = s.p('.codex/config.toml'); write(f, text); return { ...s, f }; };
const countHeaders = (t) => (t.match(/^\[mcp_servers\.plenum\]/gm) || []).length;

test('toml: header with trailing comment / spaces / quoted key is a recognised block', () => {
  for (const h of ['[mcp_servers.plenum] # mine', '[ mcp_servers . plenum ]  ', '[mcp_servers."plenum"]', '  [mcp_servers.plenum]']) {
    const { opts, f } = codexFile(`[a]\nx = 1\n\n${h}\ncommand = "old"\n\n[b]\ny = 2\n`);
    assert.equal(state(opts, 'codex').state, 'stale', h);
    assert.equal(addClient('codex', opts).state, 'ok', h);
    const t = fs.readFileSync(f, 'utf8');
    assert.equal(countHeaders(t), 1, h);
    assert.ok(!t.includes('old') && !t.includes('# mine') && t.endsWith('[b]\ny = 2\n'), h);
    assert.equal(removeClient('codex', opts).state, 'missing', h);
    assert.ok(!fs.readFileSync(f, 'utf8').includes('plenum'), h);
  }
});

test('toml: an indented, correct entry reads ok', () => {
  const { opts } = codexFile(`  [mcp_servers.plenum]\n  command = "${LAUNCHER}"\n  args = ["mcp"]\n`);
  assert.equal(state(opts, 'codex').state, 'ok');
});

test('toml: plenum entry in an uneditable form (inline table / dotted key) → unreadable, nothing written', () => {
  for (const bad of [
    '[mcp_servers]\nplenum = { command = "plenum" }\n',
    'mcp_servers = { plenum = { command = "plenum" } }\n[tools]\nweb = true\n',
    '[mcp_servers]\nplenum.command = "plenum"\n',
    'mcp_servers.plenum.command = "plenum"\n[tools]\nweb = true\n',
  ]) {
    const { opts, f } = codexFile(bad);
    const s = state(opts, 'codex');
    assert.equal(s.state, 'unreadable');
    assert.equal(s.reason, "has a plenum entry in a form Plenum can't edit");
    assert.throws(() => addClient('codex', opts));
    assert.throws(() => removeClient('codex', opts));
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
  }
});

test("toml: comments belonging to the next table survive Fix and Remove", () => {
  const orig = '[mcp_servers.plenum]\ncommand = "plenum"\n\n# tools section\n[tools]\nweb = true\n';
  const { opts, f } = codexFile(orig);
  addClient('codex', opts);
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(t.endsWith('\n\n# tools section\n[tools]\nweb = true\n'));
  assert.equal(countHeaders(t), 1);
  fs.writeFileSync(f, orig);
  removeClient('codex', opts);
  assert.equal(fs.readFileSync(f, 'utf8').trimStart(), '# tools section\n[tools]\nweb = true\n');
});

test('toml: a comment between plenum keys stays part of the block', () => {
  const { opts, f } = codexFile('[mcp_servers.plenum]\ncommand = "old"\n# note\nargs = ["x"]\n\n[b]\ny = 2\n');
  addClient('codex', opts);
  const t = fs.readFileSync(f, 'utf8');
  assert.ok(!t.includes('# note') && !t.includes('"x"') && t.endsWith('\n\n[b]\ny = 2\n'));
});

test('dangling symlink config: write creates the target and the link stays a link', () => {
  const { opts, p } = setup();
  fs.mkdirSync(p('.cursor'));
  fs.mkdirSync(p('dotfiles'));
  fs.symlinkSync('../dotfiles/mcp.json', p('.cursor/mcp.json'));
  addClient('cursor', opts);
  assert.ok(fs.lstatSync(p('.cursor/mcp.json')).isSymbolicLink());
  assert.ok(JSON.parse(fs.readFileSync(p('dotfiles/mcp.json'), 'utf8')).mcpServers.plenum);
});

test('non-object mcpServers → unreadable; add throws; bytes unchanged', () => {
  for (const bad of ['{"mcpServers":"x"}', '{"mcpServers":[]}']) {
    const { opts, p } = setup();
    write(p('.cursor/mcp.json'), bad);
    const s = state(opts, 'cursor');
    assert.equal(s.state, 'unreadable');
    assert.equal(s.reason, 'mcpServers is not an object');
    assert.throws(() => addClient('cursor', opts));
    assert.equal(fs.readFileSync(p('.cursor/mcp.json'), 'utf8'), bad);
  }
});
