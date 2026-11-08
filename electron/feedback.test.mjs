import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMeta, writeFeedbackReport } from './feedback.mjs';

test('buildMeta shapes v1 report', () => {
  const meta = buildMeta({
    comment: '  Behind is too quiet  ',
    target: { label: 'Behind', rect: { x: 1, y: 2, w: 3, h: 4 } },
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: '/tmp/repo',
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.version, 1);
  assert.equal(meta.createdAt, '2026-11-09T00:00:00.000Z');
  assert.equal(meta.comment, 'Behind is too quiet');
  assert.deepEqual(meta.target, { label: 'Behind', rect: { x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(meta.appVersion, '0.0.0');
  assert.equal(meta.platform, 'darwin');
  assert.equal(meta.repoPath, '/tmp/repo');

  assert.equal(buildMeta({ comment: '', appVersion: '1', platform: 'darwin' }).target, null);
  assert.equal(buildMeta({ comment: '', target: null, appVersion: '1', platform: 'darwin' }).target, null);
});

test('writeFeedbackReport writes meta.json and window.png', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-fb-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const out = await writeFeedbackReport(dir, {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png,
  });
  assert.ok(path.isAbsolute(out));
  assert.ok(out.startsWith(path.join(dir, 'feedback') + path.sep));
  assert.ok(fs.existsSync(path.join(out, 'meta.json')));
  assert.ok(fs.existsSync(path.join(out, 'window.png')));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.comment, 'hi');
  assert.equal(meta.target, null);
  assert.deepEqual(fs.readFileSync(path.join(out, 'window.png')), png);
});
