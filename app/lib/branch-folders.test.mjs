import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBranchesByPrefix } from './branch-folders.js';

test('folders any branch with a slash, even singletons', () => {
  const { singles, folders } = groupBranchesByPrefix([
    { name: 'main', short: 'main' },
    { name: 'cursor/rebrand', short: 'cursor/rebrand' },
    { name: 'eng/a', short: 'eng/a' },
    { name: 'eng/b', short: 'eng/b' },
  ]);
  assert.deepEqual(singles.map((s) => s.label), ['main']);
  assert.equal(folders.get('cursor').length, 1);
  assert.equal(folders.get('eng').length, 2);
  assert.equal(folders.get('cursor')[0].label, 'rebrand');
});

test('remote short names strip origin/ before grouping', () => {
  const { folders } = groupBranchesByPrefix([
    { name: 'origin/feat/x', short: 'feat/x', remote: true },
  ]);
  assert.equal(folders.get('feat')[0].label, 'x');
});
