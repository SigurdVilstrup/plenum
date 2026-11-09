import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLineMark, renderDiffBody } from './file-pane.js';

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
