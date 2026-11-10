import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolNames, handleMessage, callTool } from './server.mjs';

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

    const direct = await callTool('repo.doctor', { path: root });
    assert.equal(direct.content[0].type, 'text');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
