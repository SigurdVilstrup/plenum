import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeSpecifiers } from './_lib.mjs';

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
