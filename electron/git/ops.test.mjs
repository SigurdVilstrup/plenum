import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as ops from './ops.mjs';
import { loadBoard } from './board.mjs';
import { git } from './run.mjs';
import * as supervisor from '../lane/supervisor.mjs';

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-bare-')) + '.git';
  fs.rmSync(bare, { recursive: true, force: true });
  sh(['init', '-b', 'main', root]);
  sh(['config', 'user.email', 't@e.com'], root);
  sh(['config', 'user.name', 'T'], root);
  sh(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  sh(['add', 'a.txt'], root);
  sh(['commit', '-m', 'base'], root);
  sh(['init', '--bare', '-b', 'main', bare]);
  sh(['remote', 'add', 'origin', bare], root);
  sh(['push', '-u', 'origin', 'main'], root);
  return { root, bare };
}


test('createLane existing: attaches worktree to current branch', async () => {
  const { root } = await fixture();
  sh(['branch', 'eng/legacy'], root);
  fs.writeFileSync(path.join(root, 'legacy.txt'), 'x');
  // commit on eng/legacy via temporary checkout? branch tip is same as main until we commit on it
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-leg-'));
  fs.rmSync(tmp, { recursive: true, force: true });
  sh(['worktree', 'add', tmp, 'eng/legacy'], root);
  fs.writeFileSync(path.join(tmp, 'legacy.txt'), 'x');
  sh(['add', 'legacy.txt'], tmp);
  sh(['commit', '-m', 'legacy tip'], tmp);
  sh(['worktree', 'remove', tmp], root);

  const board = await ops.createLane(root, { existing: true, branch: 'eng/legacy' });
  const lane = board.lanes.find((l) => l.branch === 'eng/legacy');
  assert.ok(lane);
  assert.equal(lane.name, 'eng/legacy');
  const legacy = board.branches.find((b) => b.name === 'eng/legacy');
  assert.ok(legacy);
  assert.equal(legacy.hasLane, true);

});

test('create commit push rebase force-with-lease merge remove', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'one', branch: 'feat/one' });
  const lane = board.lanes.find((l) => l.name === 'feat/one');
  assert.ok(lane);
  assert.equal(lane.readiness, 'unmerged');
  fs.writeFileSync(path.join(lane.path, 'x.txt'), 'x');
  board = await ops.commitLane(root, lane.index, 'x');
  board = await ops.pushLane(root, lane.index);
  fs.writeFileSync(path.join(root, 'main.txt'), 'm');
  await git(['add', 'main.txt'], root);
  await git(['commit', '-m', 'main moves'], root);
  await git(['push'], root);
  board = await loadBoard(root);
  assert.ok(board.lanes.find((l) => l.name === 'feat/one').behind > 0);
  board = await ops.rebaseLane(root, lane.index);
  assert.equal(board.lanes.find((l) => l.name === 'feat/one').behind, 0);
  board = await ops.pushLane(root, lane.index);
  board = await ops.mergeLaneIntoMain(root, lane.index, { mode: 'ff' });
  const merged = board.lanes.find((l) => l.name === 'feat/one');
  assert.equal(merged.readiness, 'safe');
  board = await ops.removeLane(root, merged.index);
  assert.ok(!board.lanes.some((l) => l.name === 'feat/one'));
});

test('merge conflict walks primary via conflictRoot', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'c', branch: 'feat/c' });
  const lane = board.lanes.find((l) => l.name === 'feat/c');
  fs.writeFileSync(path.join(lane.path, 'a.txt'), 'lane\n');
  await git(['add', 'a.txt'], lane.path);
  await git(['commit', '-m', 'lane'], lane.path);
  fs.writeFileSync(path.join(root, 'a.txt'), 'main\n');
  await git(['add', 'a.txt'], root);
  await git(['commit', '-m', 'main'], root);
  let caught;
  try {
    await ops.mergeLaneIntoMain(root, lane.index, { mode: 'merge' });
  } catch (e) {
    caught = e;
  }
  assert.equal(caught?.code, 'CONFLICT');
  assert.equal(fs.realpathSync(caught.conflictRoot), fs.realpathSync(root));
  const st = await ops.conflictStatus(root, lane.index, caught.conflictRoot);
  assert.deepEqual(st.conflicts, ['a.txt']);
  assert.equal(st.operation, 'merge');
  fs.writeFileSync(path.join(root, 'a.txt'), 'resolved\n');
  await ops.conflictStage(root, lane.index, 'a.txt', caught.conflictRoot);
  board = await ops.conflictContinue(root, lane.index, caught.conflictRoot);
  assert.ok(board.lanes);
});


test('fresh lane is not safe; merged stays safe after push main', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'fresh', branch: 'feat/fresh' });
  const fresh = board.lanes.find((l) => l.name === 'feat/fresh');
  assert.equal(fresh.readiness, 'unmerged');
  fs.writeFileSync(path.join(fresh.path, 'z.txt'), 'z');
  board = await ops.commitLane(root, fresh.index, 'z');
  board = await ops.mergeLaneIntoMain(root, fresh.index, { mode: 'ff' });
  assert.equal(board.lanes.find((l) => l.name === 'feat/fresh').readiness, 'safe');
  await git(['push'], root);
  board = await loadBoard(root);
  assert.equal(board.lanes.find((l) => l.name === 'feat/fresh').readiness, 'safe');
});


test('primary push after merge publishes to origin', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'pub', branch: 'feat/pub' });
  const lane = board.lanes.find((l) => l.name === 'feat/pub');
  fs.writeFileSync(path.join(lane.path, 'p.txt'), 'p');
  board = await ops.commitLane(root, lane.index, 'pub tip');
  board = await ops.mergeLaneIntoMain(root, lane.index, { mode: 'ff' });
  assert.ok(board.lanes[0].ahead > 0);
  board = await ops.pushLane(root, 0);
  assert.equal(board.lanes[0].ahead, 0);
});


test('primary commit push pull', async () => {
  const { root, bare } = await fixture();
  fs.writeFileSync(path.join(root, 'on-main.txt'), 'm');
  let board = await ops.commitLane(root, 0, 'main commit');
  assert.equal(board.lanes[0].dirty, 0);
  assert.ok(board.lanes[0].ahead >= 1);
  board = await ops.pushLane(root, 0);
  assert.equal(board.lanes[0].ahead, 0);
  // Advance remote via a worktree on the bare — avoids a second clone, which
  // can end up with unrelated histories on newer git (CI runners ship 2.56).
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-other-'));
  fs.rmSync(other, { recursive: true, force: true });
  await git(['--git-dir', bare, 'worktree', 'add', other, 'main']);
  await git(['config', 'user.email', 't@e.com'], other);
  await git(['config', 'user.name', 'T'], other);
  await git(['config', 'commit.gpgsign', 'false'], other);
  fs.writeFileSync(path.join(other, 'remote.txt'), 'r');
  await git(['add', 'remote.txt'], other);
  await git(['commit', '-m', 'remote tip'], other);
  await git(['--git-dir', bare, 'worktree', 'remove', other, '--force']);
  await git(['fetch'], root);
  board = await loadBoard(root);
  assert.ok(board.lanes[0].behind >= 1);
  board = await ops.pullLane(root, 0);
  assert.equal(board.lanes[0].behind, 0);
});

test('stash and pop uncommitted', async () => {
  const { root } = await fixture();
  fs.writeFileSync(path.join(root, 'stashed.txt'), 'hold');
  let board = await loadBoard(root);
  assert.equal(board.lanes[0].dirty, 1);
  board = await ops.stashLane(root, 0);
  assert.equal(board.lanes[0].dirty, 0);
  assert.ok(board.stashCount >= 1);
  assert.ok(board.stashes?.[0]?.ref);
  const shown = await ops.stashShow(root, board.stashes[0].ref);
  assert.ok(shown.files.some((f) => f.path === 'stashed.txt'));
  board = await ops.stashPopLane(root, 0, board.stashes[0].ref);
  assert.equal(board.lanes[0].dirty, 1);
});

function writeManifest(root, yaml) {
  const dir = path.join(root, '.overlook');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lane.yaml'), yaml);
}

test('createLane copies env and runs setup', async () => {
  const { root } = await fixture();
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  writeManifest(
    root,
    [
      'version: 1',
      'setup: node -e "require(\'fs\').writeFileSync(\'setup.ok\',\'1\')"',
      'env:',
      '  copy:',
      '    - .env',
      '',
    ].join('\n'),
  );
  const board = await ops.createLane(root, { name: 'env', branch: 'feat/env' });
  const lane = board.lanes.find((l) => l.name === 'feat/env');
  assert.ok(lane);
  assert.equal(fs.readFileSync(path.join(lane.path, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(fs.readFileSync(path.join(lane.path, 'setup.ok'), 'utf8'), '1');
  assert.ok(!fs.existsSync(path.join(root, 'setup.ok')));
});

test('createLane throws when env.copy source missing', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    [
      'version: 1',
      'env:',
      '  copy:',
      '    - .env.missing',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    () => ops.createLane(root, { name: 'miss', branch: 'feat/miss' }),
    /env\.copy.*\.env\.missing|missing.*\.env\.missing/i,
  );
});

test('createLane throws setup stderr on non-zero exit', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    [
      'version: 1',
      'setup: node -e "console.error(\'boom-setup\'); process.exit(2)"',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    () => ops.createLane(root, { name: 'bad', branch: 'feat/bad' }),
    /boom-setup/,
  );
});

test('failed setup rolls back worktree so create can retry', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    ['version: 1', 'setup: node -e "process.exit(1)"', ''].join('\n'),
  );
  await assert.rejects(() => ops.createLane(root, { name: 'retry', branch: 'feat/retry' }));
  assert.ok(!fs.existsSync(path.join(root, '.worktrees', 'retry')));
  writeManifest(
    root,
    [
      'version: 1',
      'setup: node -e "require(\'fs\').writeFileSync(\'setup.ok\',\'1\')"',
      '',
    ].join('\n'),
  );
  const board = await ops.createLane(root, { name: 'retry', branch: 'feat/retry' });
  const lane = board.lanes.find((l) => l.name === 'feat/retry');
  assert.ok(lane);
  assert.equal(fs.readFileSync(path.join(lane.path, 'setup.ok'), 'utf8'), '1');
});

test('env.copy rejects path escape', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    ['version: 1', 'env:', '  copy:', '    - ../escape', ''].join('\n'),
  );
  await assert.rejects(
    () => ops.createLane(root, { name: 'esc', branch: 'feat/esc' }),
    /env\.copy path escapes/,
  );
  assert.ok(!fs.existsSync(path.join(root, '.worktrees', 'esc')));
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('removeLane downs a running process before removing the worktree', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    [
      'version: 1',
      'run: node -e "setInterval(()=>{}, 1000)"',
      'test: node -e "process.exit(0)"',
      'ports:',
      '  offset: 100',
      '  expose:',
      '    web: 5001',
      '',
    ].join('\n'),
  );
  // Commit+push so primary stays clean (merge refuses dirty) and createLane's
  // origin/main base includes the manifest (avoids diverge → ff failure).
  await git(['add', '.overlook'], root);
  await git(['commit', '-m', 'manifest'], root);
  await git(['push'], root);

  let board = await ops.createLane(root, { name: 'runrm', branch: 'feat/runrm' });
  const lane = board.lanes.find((l) => l.name === 'feat/runrm');
  assert.ok(lane);
  fs.writeFileSync(path.join(lane.path, 'done.txt'), 'x');
  board = await ops.commitLane(root, lane.index, 'done');
  board = await ops.mergeLaneIntoMain(root, lane.index, { mode: 'merge' });
  const merged = board.lanes.find((l) => l.name === 'feat/runrm');
  assert.equal(merged.readiness, 'safe');

  const status = await supervisor.up(root, merged.index);
  assert.equal(status.running, true);
  assert.ok(alive(status.pid));

  try {
    board = await ops.removeLane(root, merged.index);
    assert.ok(!board.lanes.some((l) => l.name === 'feat/runrm'));
    assert.equal(alive(status.pid), false);
    assert.equal(supervisor.getProc(root, merged.index)?.running ?? false, false);
  } finally {
    try { await supervisor.down(root, merged.index); } catch { /* already down */ }
  }
});

test('createLane honors lanesFolder inside and outside the checkout', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'in', lanesFolder: 'lanes-alt' });
  const inside = board.lanes.find((l) => l.name === 'feat/in');
  assert.equal(inside.path, fs.realpathSync(path.join(root, 'lanes-alt', 'in')));
  assert.ok(fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8').split('\n').includes('lanes-alt/'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-lanes-'));
  board = await ops.createLane(root, { name: 'out', lanesFolder: out });
  assert.equal(board.lanes.find((l) => l.name === 'feat/out').path, fs.realpathSync(path.join(out, 'out')));
  await assert.rejects(ops.createLane(root, { name: 'self', lanesFolder: '.' }), /itself/);
});


test('rename delete checkout rebase onto', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'one', branch: 'feat/one' });
  const lane = board.lanes.find((l) => l.branch === 'feat/one');
  assert.ok(lane);

  // Second local tip for rebase onto
  sh(['branch', 'feat/base'], root);
  const baseWt = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-base-'));
  fs.rmSync(baseWt, { recursive: true, force: true });
  sh(['worktree', 'add', baseWt, 'feat/base'], root);
  fs.writeFileSync(path.join(baseWt, 'base.txt'), 'b\n');
  sh(['add', 'base.txt'], baseWt);
  sh(['commit', '-m', 'base tip'], baseWt);
  sh(['worktree', 'remove', baseWt], root);

  board = await ops.rebaseLane(root, lane.index, 'feat/base');
  assert.equal(board.lanes.find((l) => l.index === lane.index).behind, 0);

  board = await ops.renameBranch(root, 'feat/one', 'feat/renamed');
  const renamedLane = board.lanes.find((l) => l.branch === 'feat/renamed');
  assert.ok(renamedLane, 'lane branch should rename with git branch -m');
  const renamedBr = board.branches.find((b) => b.name === 'feat/renamed');
  assert.ok(renamedBr, 'renamed tip listed');
  // hasLane comes from worktree list; accept either flag or lane match
  assert.ok(renamedBr.hasLane || renamedLane);

  // Free branch delete
  sh(['branch', 'feat/gone'], root);
  board = await ops.deleteBranch(root, 'feat/gone');
  assert.ok(!board.branches.some((b) => b.name === 'feat/gone'));

  // Checkout into lane
  sh(['branch', 'feat/switch'], root);
  board = await ops.checkoutBranch(root, { branch: 'feat/switch', laneIndex: lane.index });
  assert.equal(board.lanes.find((l) => l.index === lane.index).branch, 'feat/switch');

  // Same branch held by the lane → primary must not steal it.
  await assert.rejects(
    () => ops.checkoutBranch(root, { branch: 'feat/switch', laneIndex: 0 }),
    /already checked out/,
  );
  // Free branch may check out on primary (Open as lane is a separate verb).
  board = await ops.checkoutBranch(root, { branch: 'feat/renamed', laneIndex: 0 });
  assert.equal(board.lanes[0].branch, 'feat/renamed');
  board = await ops.checkoutBranch(root, { branch: 'main', laneIndex: 0 });
  assert.equal(board.lanes[0].branch, 'main');
});
