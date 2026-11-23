import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultGraphColumns,
  normalizeGraphColumns,
  graphTracks,
  graphSvgLeftCalc,
  graphSvgLeftPx,
  headerCellsHTML,
  moveColumn,
  setColumnOn,
  svgLeftIsFixed,
  visibleColumns,
} from './graph-columns-pref.js';

test('normalize fills missing ids and drops junk', () => {
  const n = normalizeGraphColumns([{ id: 'sha', on: false }, { id: 'x' }, 'nope']);
  assert.equal(n[0].id, 'sha');
  assert.equal(n[0].on, false);
  assert.deepEqual(n.map((c) => c.id).sort(), [
    'author', 'commit', 'graph', 'labels', 'sha', 'when',
  ].sort());
  assert.ok(n.filter((c) => c.id !== 'sha').every((c) => c.on));
});

test('normalize forces at least one column on', () => {
  const n = normalizeGraphColumns(defaultGraphColumns().map((c) => ({ ...c, on: false })));
  assert.equal(n.find((c) => c.id === 'commit').on, true);
});

test('graphTracks follows visible order', () => {
  const cols = [
    { id: 'sha', on: true },
    { id: 'graph', on: true },
    { id: 'labels', on: false },
    { id: 'author', on: true },
    { id: 'commit', on: true },
    { id: 'when', on: true },
  ];
  const tracks = graphTracks(cols);
  assert.match(tracks, /^var\(--graph-sha-w\) /);
  assert.ok(tracks.includes('1fr'));
  assert.equal(tracks.includes(','), false, 'track list must stay comma-free for CSS var()');
  assert.equal(visibleColumns(cols).map((c) => c.id).join(','), 'sha,graph,author,commit,when');
});

test('svg left calc for default order and when labels hidden', () => {
  const def = defaultGraphColumns();
  assert.equal(svgLeftIsFixed(def), true);
  assert.match(graphSvgLeftCalc(def), /--graph-labels-w/);
  const noLabels = setColumnOn(def, 'labels', false);
  assert.equal(graphSvgLeftCalc(noLabels), '12px');
});

test('headerCellsHTML includes every visible column (incl. empty Author)', () => {
  const html = headerCellsHTML(setColumnOn(defaultGraphColumns(), 'sha', false));
  assert.match(html, /data-col="labels"/);
  assert.match(html, /data-col="graph"/);
  assert.match(html, /data-col="author"/);
  assert.match(html, /data-col="commit"/);
  assert.equal(/data-col="sha"/.test(html), false);
  assert.match(html, /data-col="when"/);
});

test('svg left falls back when commit precedes graph', () => {
  // Default: labels graph author commit sha when — move commit left thrice → before graph
  let c = defaultGraphColumns();
  c = moveColumn(c, 'commit', -1);
  c = moveColumn(c, 'commit', -1);
  c = moveColumn(c, 'commit', -1); // commit, labels, graph, ...
  assert.equal(c[0].id, 'commit');
  assert.equal(svgLeftIsFixed(c), false);
  assert.equal(graphSvgLeftCalc(c), null);
  // commit (0 flex) + gap + labels (148) + gap → 12+0+8+148+8
  assert.equal(graphSvgLeftPx(c, { labels: 148, svg: 136 }), 176);
});

test('moveColumn and setColumnOn', () => {
  const a = moveColumn(defaultGraphColumns(), 'sha', -1);
  assert.equal(a.map((c) => c.id).indexOf('sha'), 3); // was 5; swap with commit
  const b = setColumnOn(a, 'sha', false);
  assert.equal(b.find((c) => c.id === 'sha').on, false);
  const stuck = setColumnOn(
    defaultGraphColumns().map((c) => ({ ...c, on: c.id === 'sha' })),
    'sha',
    false,
  );
  assert.equal(stuck.find((c) => c.id === 'sha').on, true);
});
