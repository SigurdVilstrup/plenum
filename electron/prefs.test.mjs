import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPrefs, setPrefs, defaultPrefs } from './prefs.mjs';

test('getPrefs returns defaults when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.deepEqual(getPrefs(dir), defaultPrefs());
});

test('setPrefs merges and persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  setPrefs({ theme: 'dark', zoom: 1.1 }, dir);
  const p = getPrefs(dir);
  assert.equal(p.theme, 'dark');
  assert.equal(p.zoom, 1.1);
  assert.equal(p.fontPack, 'system');
  assert.equal(p.chroma, 'muted');
  assert.equal(p.gravatar, true);
  assert.equal(p.tabFavicons, true);
  assert.equal('accent' in p, false);
  assert.equal('lightPalette' in p, false);
});

test('setPrefs accepts chroma', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ chroma: 'vibrant' }, dir).chroma, 'vibrant');
  assert.equal(getPrefs(dir).chroma, 'vibrant');
  assert.equal(setPrefs({ chroma: 'neon' }, dir).chroma, 'vibrant');
  // #108 looks
  for (const look of ['arcade', 'fairytale', 'studio', 'retro', 'bricks']) assert.equal(setPrefs({ chroma: look }, dir).chroma, look);
});

test('getPrefs strips retired accent and lightPalette', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({
    version: 1,
    accent: 'teal',
    lightPalette: 'neutral',
    theme: 'light',
  }));
  const p = getPrefs(dir);
  assert.equal(p.theme, 'light');
  assert.equal(p.chroma, 'muted');
  assert.equal('accent' in p, false);
  assert.equal('lightPalette' in p, false);
});

test('setPrefs toggles gravatar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ gravatar: false }, dir).gravatar, false);
  assert.equal(setPrefs({ gravatar: true }, dir).gravatar, true);
});

test('setPrefs toggles tabFavicons', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ tabFavicons: false }, dir).tabFavicons, false);
  assert.equal(setPrefs({ tabFavicons: true }, dir).tabFavicons, true);
});

test('setPrefs accepts statsFame mine|all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(getPrefs(dir).statsFame, 'mine');
  assert.equal(setPrefs({ statsFame: 'all' }, dir).statsFame, 'all');
  assert.equal(setPrefs({ statsFame: 'nope' }, dir).statsFame, 'all');
});

test('statsFameCategories defaults to five and sanitizes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.deepEqual(getPrefs(dir).statsFameCategories, ['ai', 'lines', 'biggest', 'fav', 'streak']);
  const p = setPrefs({ statsFameCategories: ['night', 'nope', 'night', 'file'] }, dir);
  assert.deepEqual(p.statsFameCategories, ['night', 'file']);
  assert.deepEqual(setPrefs({ statsFameCategories: [] }, dir).statsFameCategories, ['ai', 'lines', 'biggest', 'fav', 'streak']);
});

test('setPrefs clamps warmTabTtlMs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ warmTabTtlMs: 1000 }, dir).warmTabTtlMs, 30_000);
  assert.equal(setPrefs({ warmTabTtlMs: 999_999 }, dir).warmTabTtlMs, 600_000);
  assert.equal(setPrefs({ warmTabTtlMs: 180_000 }, dir).warmTabTtlMs, 180_000);
});

test('setPrefs clamps zoom', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ zoom: 3 }, dir).zoom, 1.25);
  assert.equal(setPrefs({ zoom: 0.1 }, dir).zoom, 0.8);
});

test('setPrefs drops unknown keys, bad enums and relative paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  const p = setPrefs({ evil: 1, theme: 'neon', editor: 'zed', editorPath: 'rel/bin', cloneDefaultPath: '~/Dev', terminalPath: '' }, dir);
  assert.equal('evil' in p, false);
  assert.equal(p.theme, 'system');
  assert.equal(p.editor, 'zed');
  assert.equal(p.editorPath, '');
  assert.equal(p.cloneDefaultPath, '~/Dev');
});

test('setPrefs accepts diff and merge tool enums', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  const p = setPrefs({ diffTool: 'vscode', mergeTool: 'opendiff' }, dir);
  assert.equal(p.diffTool, 'vscode');
  assert.equal(p.mergeTool, 'opendiff');
  assert.equal(setPrefs({ diffTool: 'beyondcompare' }, dir).diffTool, 'vscode');
  assert.equal(setPrefs({ mergeTool: 'kaleidoscope' }, dir).mergeTool, 'opendiff');
});

test('setPrefs stores tourDone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(getPrefs(dir).tourDone, false);
  assert.equal(setPrefs({ tourDone: true }, dir).tourDone, true);
});

test('feedback prompts default on; nudge state keeps only known fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(getPrefs(dir).feedbackPrompts, true);
  setPrefs({ feedbackPrompts: false, nudge: { firstSeenAt: 5, lastShownAt: 'x', seenVersion: '1.0.0', starAskedAt: 9, evil: 1 } }, dir);
  const p = getPrefs(dir);
  assert.equal(p.feedbackPrompts, false);
  assert.deepEqual(p.nudge, { firstSeenAt: 5, seenVersion: '1.0.0', starAskedAt: 9 });
});

test('graphColumns default hides author+sha; sanitize order, junk, and last-on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  const d = getPrefs(dir).graphColumns;
  assert.deepEqual(d.map((c) => c.id), ['labels', 'graph', 'author', 'commit', 'sha', 'when']);
  assert.equal(d.find((c) => c.id === 'author').on, false);
  assert.equal(d.find((c) => c.id === 'sha').on, false);
  assert.ok(['labels', 'graph', 'commit', 'when'].every((id) => d.find((c) => c.id === id).on));

  const p = setPrefs({
    graphColumns: [
      { id: 'sha', on: false },
      { id: 'commit', on: true },
      { id: 'nope', on: true },
      { id: 'sha', on: true },
      { id: 'when', on: false },
    ],
  }, dir);
  assert.deepEqual(p.graphColumns.map((c) => [c.id, c.on]), [
    ['sha', false],
    ['commit', true],
    ['when', false],
    ['labels', true],
    ['graph', true],
    ['author', true],
  ]);

  const allOff = setPrefs({
    graphColumns: p.graphColumns.map((c) => ({ ...c, on: false })),
  }, dir);
  assert.ok(allOff.graphColumns.some((c) => c.on));
  assert.equal(allOff.graphColumns.find((c) => c.id === 'commit').on, true);
});

test('getPrefs migrates legacy all-on graph columns once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({
    version: 1,
    graphColumns: ['labels', 'graph', 'author', 'commit', 'sha', 'when'].map((id) => ({ id, on: true })),
  }));
  const p = getPrefs(dir);
  assert.equal(p.graphColumns.find((c) => c.id === 'author').on, false);
  assert.equal(p.graphColumns.find((c) => c.id === 'sha').on, false);
  assert.equal(p.version, 2);
  assert.deepEqual(p.statsFameCategories, ['ai', 'lines', 'biggest', 'fav', 'streak']);
});
