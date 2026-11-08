import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './overlook.mjs';
import * as supervisor from '../electron/lane/supervisor.mjs';

test('parseArgs extracts command, rest, and --json', () => {
  assert.deepEqual(parseArgs(['node', 'overlook', 'doctor']), {
    cmd: 'doctor', rest: [], json: false,
  });
  assert.deepEqual(parseArgs(['node', 'overlook', '--json', 'status', '/tmp/r']), {
    cmd: 'status', rest: ['/tmp/r'], json: true,
  });
  assert.deepEqual(parseArgs(['node', 'overlook', 'up', '2', '--json']), {
    cmd: 'up', rest: ['2'], json: true,
  });
  assert.deepEqual(parseArgs(['node', 'overlook', 'create', 'feat-x']), {
    cmd: 'create', rest: ['feat-x'], json: false,
  });
});

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('registry file roundtrip: up writes, getProc reads, down clears', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-reg-'));
  const wt = path.join(os.tmpdir(), `ovl-reg-wt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    sh(['init', '-b', 'main', root]);
    sh(['config', 'user.email', 't@e.com'], root);
    sh(['config', 'user.name', 'T'], root);
    sh(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'x\n');
    sh(['add', 'README'], root);
    sh(['commit', '-m', 'init'], root);
    sh(['worktree', 'add', '-b', 'feat/one', wt], root);
    fs.mkdirSync(path.join(root, '.overlook'));
    fs.writeFileSync(
      path.join(root, '.overlook', 'lane.yaml'),
      'version: 1\nrun: node -e "setInterval(()=>{}, 1000)"\ntest: node -e "process.exit(0)"\nports:\n  offset: 100\n  expose:\n    web: 5001\n',
    );

    const status = await supervisor.up(root, 1);
    const regPath = supervisor.registryPathFor(root);
    assert.ok(fs.existsSync(regPath));
    const raw = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.equal(raw.lanes['1'].pid, status.pid);
    assert.ok(raw.lanes['1'].startedAt);
    assert.equal(raw.lanes['1'].urls.web, 'http://127.0.0.1:5101');
    assert.equal(supervisor.getProc(root, 1)?.pid, status.pid);

    const abs = fs.realpathSync(root);
    const hash = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 16);
    assert.ok(regPath.endsWith(`${hash}.json`));

    await supervisor.down(root, 1);
    const after = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.equal(after.lanes['1'], undefined);
    assert.equal(alive(status.pid), false);
    assert.equal(supervisor.getProc(root, 1)?.running ?? false, false);
  } finally {
    try { await supervisor.down(root, 1); } catch { /* */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
