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
  assert.equal(p.gravatar, true);
  assert.equal(p.tabFavicons, true);
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
