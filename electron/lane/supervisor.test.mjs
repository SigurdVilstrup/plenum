import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as supervisor from './supervisor.mjs';

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

async function fixture(run = 'node -e "setInterval(()=>{}, 1000)"') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-sup-'));
  const wt = path.join(os.tmpdir(), `ovl-sup-wt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  sh(['init', '-b', 'main', root]);
  sh(['config', 'user.email', 't@e.com'], root);
  sh(['config', 'user.name', 'T'], root);
  sh(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'README'), 'x\n');
  sh(['add', 'README'], root);
  sh(['commit', '-m', 'init'], root);
  sh(['worktree', 'add', '-b', 'feat/one', wt], root);

  const overlook = path.join(root, '.overlook');
  fs.mkdirSync(overlook);
  fs.writeFileSync(
    path.join(overlook, 'lane.yaml'),
    [
      'version: 1',
      `run: ${run}`,
      'ports:',
      '  offset: 100',
      '  expose:',
      '    web: 5001',
      '',
    ].join('\n'),
  );
  return { root, wt };
}

test('up starts a long-lived command and down stops it', async () => {
  const { root, wt } = await fixture();
  try {
    const status = await supervisor.up(root, 1);
    assert.ok(status.pid);
    assert.equal(status.running, true);
    assert.ok(alive(status.pid));

    await supervisor.down(root, 1);
    assert.equal(alive(status.pid), false);
    assert.equal(supervisor.getProc(root, 1)?.running ?? false, false);
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('refuses primary checkout', async () => {
  const { root, wt } = await fixture();
  try {
    await assert.rejects(() => supervisor.up(root, 0), /protected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up templates {port.*} in run', async () => {
  const run = 'node -e "require(\'fs\').writeFileSync(\'port.txt\',\'{port.web}\'); setInterval(()=>{}, 1000)"';
  const { root, wt } = await fixture(run);
  try {
    await supervisor.up(root, 1);
    const portFile = path.join(wt, 'port.txt');
    let written = '';
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(portFile)) {
        written = fs.readFileSync(portFile, 'utf8');
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(written, '5101');
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
