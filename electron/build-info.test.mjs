import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeBuildInfo, readBuildInfo } from './build-info.mjs';

test('writeBuildInfo uses git deps and readBuildInfo loads it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  const out = path.join(dir, 'build-info.json');
  writeBuildInfo(out, {
    shortHash: () => 'a1b2c3d',
    commitIso: () => '2026-11-09T01:37:00+01:00',
  });
  assert.deepEqual(readBuildInfo(out), {
    commit: 'a1b2c3d',
    committedAt: '2026-11-09T01:37:00+01:00',
  });
});

test('writeBuildInfo empties fields when git fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  const out = path.join(dir, 'build-info.json');
  writeBuildInfo(out, {
    shortHash: () => { throw new Error('no git'); },
    commitIso: () => { throw new Error('no git'); },
  });
  assert.deepEqual(readBuildInfo(out), { commit: '', committedAt: '' });
});

test('readBuildInfo returns empty on missing file', () => {
  assert.deepEqual(readBuildInfo('/tmp/definitely-missing-build-info.json'), {
    commit: '',
    committedAt: '',
  });
});
