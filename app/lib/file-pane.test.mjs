import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLineMark, renderDiffBody, renderHistoryList, renderBlameBody } from './file-pane.js';

test('diffLineMark: add/del/ctx', () => {
  assert.equal(diffLineMark('add'), '+');
  assert.equal(diffLineMark('del'), '-');
  assert.equal(diffLineMark('ctx'), ' ');
});

test('renderDiffBody: empty', () => {
  assert.match(renderDiffBody([]), /No textual changes/);
  assert.match(renderDiffBody(null), /No textual changes/);
});

test('renderDiffBody: escapes and colors lines', () => {
  const html = renderDiffBody([{
    header: '@@ -1 +1 @@',
    lines: [
      { type: 'del', text: '<old>' },
      { type: 'add', text: 'a&b' },
      { type: 'ctx', text: 'keep' },
    ],
  }]);
  assert.match(html, /diff-hunk-head/);
  assert.match(html, /diff-line del/);
  assert.match(html, /diff-line add/);
  assert.match(html, /diff-line ctx/);
  assert.match(html, /&lt;old&gt;/);
  assert.match(html, /a&amp;b/);
  assert.doesNotMatch(html, /<old>/);
});

test('renderHistoryList: empty + escapes + active', () => {
  assert.match(renderHistoryList([]), /No history/);
  const html = renderHistoryList([
    { sha: 'abc1234dead', short: 'abc1234', author: 'A<B>', at: 0, subject: 'fix & more' },
  ], 'abc1234dead');
  assert.match(html, /file-history-row on/);
  assert.match(html, /data-jump-sha="abc1234dead"/);
  assert.match(html, /A&lt;B&gt;/);
  assert.match(html, /fix &amp; more/);
});

test('renderBlameBody: grouped gutter, not per-line spam', () => {
  const text = 'one\ntwo\nthree\n';
  const html = renderBlameBody(text, [
    { sha: 'aaa', short: 'aaa0000', author: 'Ann', subject: 'first <x>', startLine: 1, endLine: 2 },
    { sha: 'bbb', short: 'bbb0000', author: 'Bob', subject: 'add three', startLine: 3, endLine: 3 },
  ]);
  assert.equal((html.match(/blame-block/g) || []).length, 2);
  assert.equal((html.match(/blame-meta/g) || []).length, 2);
  assert.match(html, /first &lt;x&gt;/);
  assert.match(html, /data-jump-sha="aaa"/);
  assert.match(html, />1</);
  assert.match(html, />2</);
  assert.match(html, />3</);
});
