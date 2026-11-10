import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBoard, classifyAuthorship, parseDirty, parseNumstat, loadCommitChanges } from './board.mjs';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('classify assisted trailer', () => {
  const a = classifyAuthorship('Sigurd', 's@x.com', 'Co-authored-by: Claude <c@x.com>');
  assert.equal(a.kind, 'assisted');
  assert.equal(a.tool, 'Claude');
});

test('parseDirty: paths and renames', () => {
  const files = parseDirty([' M notes.txt', '?? new.md', 'R  old.txt -> renamed.txt'].join('\n'));
  assert.deepEqual(files, [
    { path: 'notes.txt', code: ' M' },
    { path: 'new.md', code: '??' },
    { path: 'renamed.txt', code: 'R ' },
  ]);
});

test('parseNumstat', () => {
  const m = parseNumstat('12\t3\tsrc/a.js\n-\t-\tbin/x\n1\t0\told => new\n');
  assert.deepEqual(m.get('src/a.js'), { added: 12, deleted: 3 });
  assert.deepEqual(m.get('bin/x'), { added: 0, deleted: 0 });
  assert.deepEqual(m.get('new'), { added: 1, deleted: 0 });
});

test('loadBoard: worktree ahead dirty assisted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', '-b', 'feat/one', wt], root);
    git(['commit', '--allow-empty', '-m', 'lane tip', '-m', 'Co-authored-by: Claude Opus <noreply@anthropic.com>'], wt);
    fs.writeFileSync(path.join(wt, 'notes.txt'), 'dirty');

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);
    const lane = board.lanes[1];
    assert.equal(lane.name, 'feat/one');
    assert.equal(lane.behind, 0);
    assert.equal(lane.ahead, 1);
    assert.equal(lane.dirty, 1);
    assert.equal(lane.dirtyFiles.length, 1);
    assert.equal(lane.dirtyFiles[0].path, 'notes.txt');
    assert.ok(lane.dirtyFiles[0].added >= 1);
    assert.equal(lane.readiness, 'working');
    const tip = await loadCommitChanges(root, board.lanes[0].head);
    assert.ok(tip.files.some((f) => f.path === 'README'));
    assert.equal(lane.authorship, 'assisted');
    assert.equal(lane.tool, 'Claude');
    assert.equal(board.lanes[0].readiness, 'protected');
    assert.ok(board.commits.some((c) => c.isWIP && c.lane === 1));
    assert.equal(board.commits[0].isWIP, true);
    assert.equal(board.commits[0].lane, 1);
    assert.equal(lane.runnable, false);
    assert.equal(board.lanes[0].runnable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});


test('loadBoard: unpushed tracks origin/branch, not team ahead', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-bare-')) + '.git';
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  fs.rmSync(bare, { recursive: true, force: true });
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['init', '--bare', '-b', 'main', bare]);
    git(['remote', 'add', 'origin', bare], root);
    git(['push', '-u', 'origin', 'main'], root);

    git(['worktree', 'add', '-b', 'feat/push', wt], root);
    git(['commit', '--allow-empty', '-m', 'lane tip'], wt);

    let board = await loadBoard(root);
    let lane = board.lanes[1];
    assert.equal(lane.ahead, 1);
    assert.equal(lane.unpushed, 1, 'never-pushed lane tip counts as unpushed');

    git(['push', '-u', 'origin', 'HEAD'], wt);
    // main moves ahead on remote/local while feature stays put
    fs.writeFileSync(path.join(root, 'main.txt'), 'm');
    git(['add', 'main.txt'], root);
    git(['commit', '-m', 'main moves'], root);

    board = await loadBoard(root);
    lane = board.lanes[1];
    assert.ok(lane.ahead >= 1, 'feature tip still ahead of teamRef');
    assert.equal(lane.unpushed, 0, 'Push must clear after origin/feat matches HEAD');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});


test('loadBoard: overlook.teamBranch git config overrides detection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-bare-')) + '.git';
  fs.rmSync(bare, { recursive: true, force: true });
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['branch', 'develop'], root);
    git(['init', '--bare', '-b', 'main', bare]);
    git(['remote', 'add', 'origin', bare], root);
    git(['push', '-u', 'origin', 'main'], root);
    git(['push', 'origin', 'develop'], root);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], root);

    let board = await loadBoard(root);
    assert.equal(board.teamBranch, 'main');
    assert.equal(board.teamBranchSource, 'detected');

    git(['config', 'overlook.teamBranch', 'develop'], root);
    board = await loadBoard(root);
    assert.equal(board.teamBranch, 'develop');
    assert.equal(board.teamRef, 'origin/develop');
    assert.equal(board.teamBranchSource, 'override');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('loadBoard: feature lane runnable from .overlook/lane.yaml', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', '-b', 'feat/one', wt], root);

    const overlook = path.join(root, '.overlook');
    fs.mkdirSync(overlook);
    fs.copyFileSync(
      path.join(process.cwd(), 'fixtures/lane/minimal.lane.yaml'),
      path.join(overlook, 'lane.yaml'),
    );

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);

    const primary = board.lanes[0];
    assert.equal(primary.runnable, false);
    assert.equal(primary.running, false);

    const lane = board.lanes[1];
    assert.equal(lane.runnable, true);
    assert.equal(lane.offset, 100);
    assert.deepEqual(lane.urls, { web: 'http://127.0.0.1:5101' });
    assert.equal(lane.dataMode, 'shared');
    assert.equal(lane.running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard: merge packs feature tip onto a side column', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', '-b', 'feat/one', wt], root);
    fs.writeFileSync(path.join(wt, 'feat.txt'), 'side');
    git(['add', 'feat.txt'], wt);
    git(['commit', '-m', 'feature tip'], wt);
    fs.writeFileSync(path.join(root, 'main.txt'), 'main-side');
    git(['add', 'main.txt'], root);
    git(['commit', '-m', 'main tip'], root);
    git(['merge', 'feat/one', '--no-ff', '-m', 'merge feature'], root);

    const board = await loadBoard(root);
    const merge = board.commits.find((c) => c.isMerge);
    assert.ok(merge, 'expected a merge commit');
    assert.equal(merge.lane, 0);
    const featHead = board.lanes[1].head;
    const feat = board.commits.find((c) => c.id === featHead);
    assert.ok(feat, 'expected feature tip in history');
    assert.equal(feat.lane, 1);
    assert.notEqual(feat.lane, merge.lane);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard: bad lane.yaml still loads board as not runnable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', '-b', 'feat/one', wt], root);

    const overlook = path.join(root, '.overlook');
    fs.mkdirSync(overlook);
    fs.writeFileSync(path.join(overlook, 'lane.yaml'), 'version: 2\nrun: echo hi\n');

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);
    assert.equal(board.lanes[0].runnable, false);
    assert.equal(board.lanes[1].runnable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});


test('listBranches overview: locals remotes lane flags', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-br-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-bare-')) + '.git';
  fs.rmSync(bare, { recursive: true, force: true });
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'T'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git(['add', 'a.txt'], root);
    git(['commit', '-m', 'base'], root);
    git(['init', '--bare', '-b', 'main', bare]);
    git(['remote', 'add', 'origin', bare], root);
    git(['push', '-u', 'origin', 'main'], root);
    git(['branch', 'feat/solo'], root);
    git(['push', 'origin', 'feat/solo'], root);
    git(['branch', '-d', 'feat/solo'], root); // leave remote-only
    git(['branch', 'feat/local'], root);

    const board = await loadBoard(root);
    const local = board.branches.find((b) => b.name === 'feat/local');
    const remote = board.branches.find((b) => b.name === 'origin/feat/solo');
    const team = board.branches.find((b) => b.name === 'main');
    assert.ok(local && !local.hasLane && !local.remote);
    assert.ok(remote && remote.remote && !remote.hasLane);
    assert.ok(team && team.isTeam && team.hasLane);
    assert.ok(!board.branches.some((b) => b.name === 'origin' || b.short === 'origin'),
      'origin/HEAD must not appear as a branch');

    // Orphan local tip should appear in graph refs
    assert.ok(board.commits.some((c) => (c.refs || []).some((r) => r.name === 'feat/local')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
