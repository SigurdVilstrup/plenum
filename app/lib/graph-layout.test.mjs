import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraphRows, DIVIDER_H } from './graph-live.js';

const ROW = 30;
const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const sec = (y, m, d) => Math.floor(new Date(y, m, d, 12).getTime() / 1000);

test('layoutGraphRows adds DIVIDER_H when the calendar day gets older', () => {
  // Freeze "now" by using dates relative to a fixed day — dateBandLabel uses Date.now()
  // so we only assert relative spacing: two days → one divider between them.
  const commits = [
    { id: 'a', at: Math.floor(Date.now() / 1000) - 60, isWIP: false, parents: [] },
    { id: 'b', at: Math.floor(Date.now() / 1000) - 86400 * 2, isWIP: false, parents: ['a'] },
  ];
  const { rows, height } = layoutGraphRows(commits);
  assert.equal(rows[0].band, 'Today');
  assert.ok(rows[1].band);
  assert.equal(rows[1].cy - rows[0].cy, ROW + DIVIDER_H);
  assert.equal(height, ROW * 2 + DIVIDER_H * 2);
});

test('same-day commits share one divider only', () => {
  const t = Math.floor(Date.now() / 1000) - 120;
  const commits = [
    { id: 'a', at: t, isWIP: false, parents: [] },
    { id: 'b', at: t - 30, isWIP: false, parents: ['a'] },
  ];
  const { rows, height } = layoutGraphRows(commits);
  assert.ok(rows[0].band);
  assert.equal(rows[1].band, null);
  assert.equal(height, ROW * 2 + DIVIDER_H);
});

// Keep sec/NOW referenced so timezone helpers stay available if we tighten later.
void NOW;
void sec;
