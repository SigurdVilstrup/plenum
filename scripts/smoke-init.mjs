#!/usr/bin/env node
/** Disposable multi-worktree repo for smoke tests. No remotes required for local verbs;
 *  a local bare remote is added so push/pull work offline. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('tmp/smoke-repo');
const bare = path.resolve('tmp/smoke-remote.git');
const wt = path.resolve('tmp/smoke-repo-lane');

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(bare, { recursive: true, force: true });
fs.rmSync(wt, { recursive: true, force: true });
fs.mkdirSync(path.dirname(root), { recursive: true });

git(['init', '-b', 'main', root]);
git(['config', 'user.email', 'smoke@overlook.local'], root);
git(['config', 'user.name', 'Overlook Smoke'], root);
git(['config', 'commit.gpgsign', 'false'], root);
fs.writeFileSync(path.join(root, 'README.md'), '# smoke\n');
git(['add', 'README.md'], root);
git(['commit', '-m', 'init'], root);

git(['init', '--bare', bare]);
git(['remote', 'add', 'origin', bare], root);
git(['push', '-u', 'origin', 'main'], root);

git(['worktree', 'add', '-b', 'feat/alpha', wt], root);
fs.writeFileSync(path.join(wt, 'alpha.txt'), 'alpha\n');
git(['add', 'alpha.txt'], wt);
git(['commit', '-m', 'alpha tip\n\nCo-authored-by: Cursor <cursor@cursor.com>'], wt);

console.log(root);
