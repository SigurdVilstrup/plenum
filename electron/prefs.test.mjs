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
});

test('setPrefs clamps warmTabTtlMs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-prefs-'));
  assert.equal(setPrefs({ warmTabTtlMs: 1000 }, dir).warmTabTtlMs, 30_000);
  assert.equal(setPrefs({ warmTabTtlMs: 999_999 }, dir).warmTabTtlMs, 600_000);
  assert.equal(setPrefs({ warmTabTtlMs: 180_000 }, dir).warmTabTtlMs, 180_000);
});
