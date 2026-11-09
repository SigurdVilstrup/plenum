import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadFileDiff, loadFileHistory, loadFileBlame } from './file.mjs';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-file-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 't@example.com'], root);
  git(['config', 'user.name', 'Tester'], root);
  git(['config', 'commit.gpgsign', 'false'], root);
  return root;
}

test('loadFileDiff: unified hunks for a line add', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'hello\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'init'], root);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'hello\nworld\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'add world'], root);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const diff = await loadFileDiff(root, sha, 'notes.txt');
    assert.equal(diff.sha, sha);
    assert.equal(diff.path, 'notes.txt');
    assert.ok(diff.hunks.length >= 1);
    const lines = diff.hunks.flatMap((h) => h.lines);
    assert.ok(lines.some((l) => l.type === 'add' && l.text === 'world'));
    assert.ok(lines.some((l) => l.type === 'ctx' && l.text === 'hello'));
    assert.ok(diff.hunks[0].header.startsWith('@@'));
    assert.equal(lines.at(-1)?.type === 'ctx' && lines.at(-1)?.text === '', false,
      'no phantom trailing empty ctx from split(/\\n/)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadFileDiff: rejects path traversal', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'x\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'init'], root);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    await assert.rejects(() => loadFileDiff(root, sha, '../notes.txt'), /path/i);
    await assert.rejects(() => loadFileDiff(root, sha, '/etc/passwd'), /path/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadFileHistory: returns commits for a path', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'a\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'init notes'], root);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'a\nb\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'add b'], root);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const rootSha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: root, encoding: 'utf8' }).trim();

    const history = await loadFileHistory(root, 'notes.txt');
    assert.equal(history.length, 2);
    assert.equal(history[0].sha, head);
    assert.equal(history[0].subject, 'add b');
    assert.equal(history[0].author, 'Tester');
    assert.ok(history[0].short);
    assert.equal(typeof history[0].at, 'number');
    assert.equal(history[1].sha, rootSha);
    assert.equal(history[1].subject, 'init notes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadFileBlame: groups contiguous same-sha lines into one block', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'one\ntwo\nthree\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'three lines'], root);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const blame = await loadFileBlame(root, sha, 'notes.txt');
    assert.equal(blame.sha, sha);
    assert.equal(blame.path, 'notes.txt');
    assert.equal(blame.blocks.length, 1);
    const [block] = blame.blocks;
    assert.equal(block.sha, sha);
    assert.ok(block.short);
    assert.equal(block.author, 'Tester');
    assert.equal(block.subject, 'three lines');
    assert.equal(block.startLine, 1);
    assert.equal(block.endLine, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadFileBlame: splits blocks across commits', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'one\ntwo\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'first two'], root);
    const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(root, 'notes.txt'), 'one\ntwo\nthree\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'add three'], root);
    const second = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const blame = await loadFileBlame(root, second, 'notes.txt');
    assert.equal(blame.blocks.length, 2);
    assert.equal(blame.blocks[0].sha, first);
    assert.equal(blame.blocks[0].startLine, 1);
    assert.equal(blame.blocks[0].endLine, 2);
    assert.equal(blame.blocks[0].subject, 'first two');
    assert.equal(blame.blocks[1].sha, second);
    assert.equal(blame.blocks[1].startLine, 3);
    assert.equal(blame.blocks[1].endLine, 3);
    assert.equal(blame.blocks[1].subject, 'add three');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadFileHistory/loadFileBlame: reject path traversal', async () => {
  const root = tempRepo();
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'x\n');
    git(['add', 'notes.txt'], root);
    git(['commit', '-m', 'init'], root);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    await assert.rejects(() => loadFileHistory(root, '../notes.txt'), /path/i);
    await assert.rejects(() => loadFileBlame(root, sha, '/etc/passwd'), /path/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
