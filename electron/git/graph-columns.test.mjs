import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignColumns } from './graph-columns.mjs';

// Newest-first (matches board history: git log --date-order).
// Diamond:
//   A
//   |\
//   B C
//   |/
//   D
test('diamond merge: distinct side columns then rejoin', () => {
  const commits = [
    { id: 'A', parents: ['B', 'C'] },
    { id: 'B', parents: ['D'] },
    { id: 'C', parents: ['D'] },
    { id: 'D', parents: [] },
  ];
  const cols = assignColumns(commits);

  assert.equal(cols.get('A'), 0);
  assert.equal(cols.get('B'), 0); // first-parent stays on A's column
  assert.equal(cols.get('C'), 1); // second parent gets its own column
  assert.equal(cols.get('D'), 0); // rejoin leftmost
  assert.notEqual(cols.get('B'), cols.get('C'));
});
