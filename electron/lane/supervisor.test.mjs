import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBoard } from '../git/board.mjs';
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

async function fixture({
  run = 'node -e "setInterval(()=>{}, 1000)"',
  testCmd = 'node -e "process.exit(0)"',
} = {}) {
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

  const plenum = path.join(root, '.plenum');
  fs.mkdirSync(plenum);
  fs.writeFileSync(
    path.join(plenum, 'lane.yaml'),
    [
      'version: 1',
      `run: ${run}`,
      `test: ${testCmd}`,
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
    await assert.rejects(() => supervisor.up(root, 0), /protected/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up templates {port.*} in run', async () => {
  const run = 'node -e "require(\'fs\').writeFileSync(\'port.txt\',\'{port.web}\'); setInterval(()=>{}, 1000)"';
  const { root, wt } = await fixture({ run });
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

test('test stores lastTest.ok on exit 0', async () => {
  const { root, wt } = await fixture({ testCmd: 'node -e "console.log(\'pass\'); process.exit(0)"' });
  try {
    const result = await supervisor.test(root, 1);
    assert.equal(result.ok, true);
    assert.equal(result.code, 0);
    assert.ok(typeof result.at === 'number');
    assert.ok(Array.isArray(result.log));
    assert.ok(result.log.some((l) => l.includes('pass')));
    assert.deepEqual(supervisor.getLastTest(root, 1), result);
    assert.equal(supervisor.getProc(root, 1), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('test stores lastTest not ok on non-zero exit', async () => {
  const { root, wt } = await fixture({ testCmd: 'node -e "console.error(\'boom\'); process.exit(2)"' });
  try {
    const result = await supervisor.test(root, 1);
    assert.equal(result.ok, false);
    assert.equal(result.code, 2);
    assert.ok(result.log.some((l) => l.includes('boom')));
    assert.equal(supervisor.getLastTest(root, 1)?.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('test refuses primary checkout', async () => {
  const { root, wt } = await fixture();
  try {
    await assert.rejects(() => supervisor.test(root, 0), /protected/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('test timeout kills hang and stores failure', async () => {
  const hang = 'node -e "require(\'fs\').writeFileSync(\'pid.txt\',String(process.pid));setInterval(()=>{},1000)"';
  const { root, wt } = await fixture({ testCmd: hang });
  try {
    const result = await supervisor.test(root, 1, { timeoutMs: 300 });
    assert.equal(result.ok, false);
    assert.equal(result.code, null);
    assert.deepEqual(supervisor.getLastTest(root, 1), result);

    const pidFile = path.join(wt, 'pid.txt');
    let pid = null;
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(pidFile)) {
        pid = Number(fs.readFileSync(pidFile, 'utf8'));
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(pid);
    assert.equal(alive(pid), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard surfaces lastTest after test', async () => {
  const { root, wt } = await fixture({ testCmd: 'node -e "process.exit(0)"' });
  try {
    await supervisor.test(root, 1);
    const board = await loadBoard(root);
    const lane = board.lanes[1];
    assert.equal(lane.lastTest.ok, true);
    assert.equal(lane.lastTest.code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('test rejects overlapping run for same lane', async () => {
  const { root, wt } = await fixture({
    testCmd: 'node -e "setTimeout(()=>process.exit(0), 800)"',
  });
  try {
    const first = supervisor.test(root, 1, { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(() => supervisor.test(root, 1), /already in progress/);
    const result = await first;
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up throws DRIFT when shared migrations pending', async () => {
  const { root, wt } = await fixture();
  try {
    const mig = path.join(wt, 'migrations');
    fs.mkdirSync(mig);
    fs.writeFileSync(path.join(mig, '20260101_a.sql'), '--\n');
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      ['services:', '  db:', '    mode: shared', 'data:', '  migrations: migrations', ''].join('\n'),
    );
    await assert.rejects(
      () => supervisor.up(root, 1),
      (err) => {
        assert.equal(err.code, 'DRIFT');
        assert.deepEqual(err.pending, ['20260101_a.sql']);
        return true;
      },
    );
    assert.equal(supervisor.getProc(root, 1), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up force: true skips drift gate', async () => {
  const { root, wt } = await fixture();
  try {
    const mig = path.join(wt, 'migrations');
    fs.mkdirSync(mig);
    fs.writeFileSync(path.join(mig, '20260101_a.sql'), '--\n');
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      ['data:', '  migrations: migrations', ''].join('\n'),
    );
    const status = await supervisor.up(root, 1, { force: true });
    assert.equal(status.running, true);
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up DRIFT when migration exists only in lane worktree', async () => {
  const { root, wt } = await fixture();
  try {
    fs.mkdirSync(path.join(root, 'migrations'));
    fs.mkdirSync(path.join(wt, 'migrations'));
    fs.writeFileSync(path.join(wt, 'migrations', '20260104_branch.sql'), '--\n');
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      ['data:', '  migrations: migrations', ''].join('\n'),
    );
    await assert.rejects(
      () => supervisor.up(root, 1),
      (err) => {
        assert.equal(err.code, 'DRIFT');
        assert.deepEqual(err.pending, ['20260104_branch.sql']);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up runs services.*.snapshot before run when mode is snapshot', async () => {
  const { root, wt } = await fixture();
  try {
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      [
        'services:',
        '  db:',
        '    mode: snapshot',
        '    snapshot: node -e "require(\'fs\').writeFileSync(\'snap.ok\',\'1\')"',
        '',
      ].join('\n'),
    );
    const status = await supervisor.up(root, 1);
    assert.equal(status.running, true);
    assert.equal(fs.readFileSync(path.join(wt, 'snap.ok'), 'utf8'), '1');
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up falls back to data.snapshot for snapshot services', async () => {
  const { root, wt } = await fixture();
  try {
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      [
        'services:',
        '  db:',
        '    mode: snapshot',
        'data:',
        '  snapshot: node -e "require(\'fs\').writeFileSync(\'data-snap.ok\',\'1\')"',
        '',
      ].join('\n'),
    );
    await supervisor.up(root, 1);
    assert.equal(fs.readFileSync(path.join(wt, 'data-snap.ok'), 'utf8'), '1');
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up does not start run when snapshot command fails', async () => {
  const { root, wt } = await fixture();
  try {
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      [
        'services:',
        '  db:',
        '    mode: snapshot',
        '    snapshot: node -e "console.error(\'snap-boom\'); process.exit(2)"',
        '',
      ].join('\n'),
    );
    await assert.rejects(() => supervisor.up(root, 1), /snap-boom/);
    assert.equal(supervisor.getProc(root, 1), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('up skips drift gate when all services are snapshot', async () => {
  const { root, wt } = await fixture();
  try {
    const mig = path.join(wt, 'migrations');
    fs.mkdirSync(mig);
    fs.writeFileSync(path.join(mig, '20260101_a.sql'), '--\n');
    fs.appendFileSync(
      path.join(root, '.plenum', 'lane.yaml'),
      [
        'services:',
        '  db:',
        '    mode: snapshot',
        '    snapshot: node -e "require(\'fs\').writeFileSync(\'snap.ok\',\'1\')"',
        'data:',
        '  migrations: migrations',
        '',
      ].join('\n'),
    );
    const status = await supervisor.up(root, 1);
    assert.equal(status.running, true);
    assert.equal(fs.readFileSync(path.join(wt, 'snap.ok'), 'utf8'), '1');
  } finally {
    try { await supervisor.down(root, 1); } catch { /* already down */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
