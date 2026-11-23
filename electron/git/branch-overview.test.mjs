import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBranchOverview } from './branch-overview.mjs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-overview-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 't@example.com'], root);
  git(['config', 'user.name', 'Tester'], root);
  git(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'README'), 'hello');
  git(['add', 'README'], root);
  git(['commit', '-m', 'init'], root);
  return root;
}

test('loadBranchOverview: ahead commits and file stats vs main', async () => {
  const root = repo();
  try {
    git(['checkout', '-b', 'feat/overview'], root);
    fs.writeFileSync(path.join(root, 'a.js'), 'one\n');
    git(['add', 'a.js'], root);
    git(['commit', '-m', 'add a'], root);
    fs.writeFileSync(path.join(root, 'a.js'), 'one\ntwo\n');
    git(['add', 'a.js'], root);
    git(['commit', '-m', 'extend a'], root);

    // Move main forward so the tip is also behind.
    git(['checkout', 'main'], root);
    fs.writeFileSync(path.join(root, 'main.txt'), 'm');
    git(['add', 'main.txt'], root);
    git(['commit', '-m', 'main moves'], root);
    git(['checkout', 'feat/overview'], root);

    const o = await loadBranchOverview(root, {
      branch: 'feat/overview',
      vs: 'main',
      team: 'main',
      primaryBranch: 'main',
    });
    assert.equal(o.branch, 'feat/overview');
    assert.equal(o.vs, 'main');
    assert.ok(o.mergeBase);
    assert.equal(o.ahead, 2);
    assert.equal(o.behind, 1);
    assert.equal(o.commits.length, 2);
    assert.equal(o.commits[0].subject, 'extend a');
    assert.equal(o.commits[0].isTip, true);
    assert.equal(o.commits[1].subject, 'add a');
    assert.ok(o.commits[0].when);
    assert.ok(o.commits[0].avatarHash);
    assert.ok(o.files.some((f) => f.path === 'a.js' && f.added >= 1));
    assert.ok(o.totals.added >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadBranchOverview: same tip yields empty unique range', async () => {
  const root = repo();
  try {
    const o = await loadBranchOverview(root, { branch: 'main', vs: 'main', team: 'main' });
    assert.equal(o.ahead, 0);
    assert.equal(o.behind, 0);
    assert.equal(o.commits.length, 0);
    assert.equal(o.files.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadBranchOverview: unknown branch throws', async () => {
  const root = repo();
  try {
    await assert.rejects(() => loadBranchOverview(root, { branch: 'nope', vs: 'main' }), /Unknown branch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
