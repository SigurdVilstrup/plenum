import test from 'node:test';
import assert from 'node:assert/strict';
import { missingGitBashError, shellSpec, resetGitBashCache } from './shell.mjs';

test('shellSpec on unix uses shell:true', () => {
  if (process.platform === 'win32') return;
  const s = shellSpec('npm run dev');
  assert.equal(s.shell, true);
  assert.equal(s.command, 'npm run dev');
});

test('missingGitBashError has a stable code', () => {
  const err = missingGitBashError();
  assert.equal(err.code, 'NO_GIT_BASH');
  assert.match(err.message, /Git Bash/);
});

test('resetGitBashCache is callable', () => {
  resetGitBashCache();
});
