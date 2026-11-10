import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraphRows } from './graph-live.js';

const ROW = 30;

test('layoutGraphRows spaces commits evenly with no divider gaps', () => {
  const commits = [
    { id: 'a', at: Math.floor(Date.now() / 1000) - 60, isWIP: false, parents: [] },
    { id: 'b', at: Math.floor(Date.now() / 1000) - 86400 * 2, isWIP: false, parents: ['a'] },
  ];
  const { rows, height } = layoutGraphRows(commits);
  assert.equal(rows[0].cy, ROW / 2);
  assert.equal(rows[1].cy - rows[0].cy, ROW);
  assert.equal(height, ROW * 2);
});

test('empty commits still report a row height', () => {
  const { height } = layoutGraphRows([]);
  assert.equal(height, ROW);
});
