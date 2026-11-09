import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadFileDiff } from './file.mjs';

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
