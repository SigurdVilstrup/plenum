import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { asarFileKey, normalizeAsarEntry, relativeSpecifiers } from './_lib.mjs';

test('normalizeAsarEntry strips host separators and leading slash', () => {
  assert.equal(normalizeAsarEntry('\\electron\\git\\stats.mjs'), 'electron/git/stats.mjs');
  assert.equal(normalizeAsarEntry('/electron/main.mjs'), 'electron/main.mjs');
});

// Host-agnostic: proves nested keys use win32 seps so asar getFile won't
// path.win32.dirname('a/b/c') → 'a/b' (single broken segment) on Windows CI.
test('asarFileKey uses platform separators for nested asar paths', () => {
  assert.equal(asarFileKey('electron/git/stats.mjs', path.posix), 'electron/git/stats.mjs');
  assert.equal(asarFileKey('/electron/git/stats.mjs', path.win32), 'electron\\git\\stats.mjs');
  assert.equal(path.win32.dirname(asarFileKey('electron/git/stats.mjs', path.win32)), 'electron\\git');
});

test('relativeSpecifiers catches import and re-export', () => {
  const src = `
    import { a } from './a.mjs';
    import b from '../b.js';
    export { c } from './c.mjs';
    const d = await import('./d.mjs');
    import fs from 'node:fs';
    import electron from 'electron';
  `;
  assert.deepEqual(relativeSpecifiers(src).sort(), ['./a.mjs', '../b.js', './c.mjs', './d.mjs'].sort());
});

test('relativeSpecifiers ignores bare and absolute', () => {
  assert.deepEqual(relativeSpecifiers(`import x from 'lodash';\nimport y from '/abs.js';`), []);
});
