import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolNames, handleMessage, callTool } from './server.mjs';
import { setAgentSettings, defaultAgentSettings } from '../agents/settings.mjs';

// Never read the real ~/.plenum/agents.json: whole file runs against a temp home.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-home-'));
process.env.PLENUM_HOME = HOME;
const resetSettings = () => setAgentSettings(defaultAgentSettings(), HOME);

const callMsg = (name, args) =>
  handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });

test('tools/call returns isError with the refusal when a setting is off', async () => {
  try {
    setAgentSettings({ create: false }, HOME);
    const res = await callMsg('lane.create', { name: 'x', path: '/nonexistent' });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /^Refused: creating lanes is turned off for agents\./);
  } finally {
    resetSettings();
  }
});

test('a flipped setting applies to the next call without a restart', async () => {
  try {
    setAgentSettings({ create: false }, HOME);
    const off = await callMsg('lane.create', { name: 'x', path: '/nonexistent' });
    assert.match(off.result.content[0].text, /^Refused:/);

    setAgentSettings({ create: true }, HOME);
    const on = await callMsg('lane.create', { name: 'x', path: '/nonexistent' });
    assert.equal(on.result.isError, true);
    assert.doesNotMatch(on.result.content[0].text, /^Refused:/);
  } finally {
    resetSettings();
  }
});

test('switched-off tools stay in tools/list', async () => {
  try {
    setAgentSettings({ run: false, create: false, remove: 'never' }, HOME);
    const res = await handleMessage({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
    assert.equal(res.result.tools.length, 7);
    assert.deepEqual(res.result.tools.map((t) => t.name), toolNames());
  } finally {
    resetSettings();
  }
});

test('tools/list returns the 7 PRODUCT tool names', async () => {
  const names = toolNames();
  assert.deepEqual(names, [
    'repo.doctor',
    'lane.create',
    'lane.up',
    'lane.down',
    'lane.test',
    'lane.status',
    'lane.remove',
  ]);

  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.error, undefined);
  assert.deepEqual(res.result.tools.map((t) => t.name), names);
});

test('initialize advertises tools capability', async () => {
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  assert.equal(res.result.serverInfo.name, 'plenum');
  assert.ok(res.result.capabilities.tools);
});

test('tools/call repo.doctor on a fixture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-mcp-'));
  try {
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, stdio: 'pipe' });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fix', scripts: { dev: 'vite', test: 'node --test' } }) + '\n',
    );
    fs.writeFileSync(path.join(root, 'README'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'pipe' });

    const res = await handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'repo.doctor', arguments: { path: root } },
    });
    assert.equal(res.error, undefined);
    assert.equal(res.result.isError, undefined);
    const body = JSON.parse(res.result.content[0].text);
    assert.ok(Array.isArray(body.findings));
    assert.ok(typeof body.proposedYaml === 'string');
    assert.match(body.proposedYaml, /run:/);
    assert.ok(typeof body.agentPrompt === 'string');
    assert.match(body.agentPrompt, /Plenum lane wiring/);
    assert.match(body.agentPrompt, /without Plenum/);

    const direct = await callTool('repo.doctor', { path: root });
    assert.equal(direct.content[0].type, 'text');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tools/list repo.doctor description steers agents to agentPrompt', async () => {
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {},
  });
  const doctorTool = res.result.tools.find((t) => t.name === 'repo.doctor');
  assert.ok(doctorTool);
  assert.match(doctorTool.description, /agentPrompt/);
  assert.match(doctorTool.description, /Always read agentPrompt|follow the prompt/i);
});

function doctorFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-mcp-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fix', scripts: { dev: 'vite', test: 'node --test' } }) + '\n',
  );
  fs.writeFileSync(path.join(root, 'README'), 'x\n');
  git('add', '.');
  git('commit', '-m', 'init');
  return root;
}

test('repo.doctor write is refused by default', async () => {
  const root = doctorFixture();
  try {
    const res = await callMsg('repo.doctor', { path: root, write: true });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /^Refused: writing lane setup is turned off/);
    assert.equal(fs.existsSync(path.join(root, '.plenum', 'lane.yaml')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repo.doctor write creates lane.yaml when allowed and none exists', async () => {
  const root = doctorFixture();
  try {
    setAgentSettings({ writeSetup: 'allow' }, HOME);
    const res = await callMsg('repo.doctor', { path: root, write: true });
    assert.equal(res.result.isError, undefined);
    const body = JSON.parse(res.result.content[0].text);
    assert.ok(body.written.endsWith(path.join('.plenum', 'lane.yaml')));
    assert.ok(path.isAbsolute(body.written));
    assert.ok(fs.existsSync(body.written));
  } finally {
    resetSettings();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repo.doctor write never replaces an existing lane.yaml', async () => {
  const root = doctorFixture();
  try {
    setAgentSettings({ writeSetup: 'allow' }, HOME);
    const file = path.join(root, '.plenum', 'lane.yaml');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '# user wrote this\n');
    const res = await callMsg('repo.doctor', { path: root, write: true });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /^Refused: this repo already has lane setup\./);
    assert.equal(fs.readFileSync(file, 'utf8'), '# user wrote this\n');
  } finally {
    resetSettings();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
