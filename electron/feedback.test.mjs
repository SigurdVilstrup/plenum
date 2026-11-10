import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMeta, collectFeedbackEnv, writeFeedbackReport } from './feedback.mjs';

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

test('buildMeta passes through env fields', () => {
  const meta = buildMeta({
    comment: 'x',
    appVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    screens: [{ width: 1512, height: 982, scaleFactor: 2, primary: true }],
    windowSize: { width: 1280, height: 800 },
    repoPath: null,
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.arch, 'arm64');
  assert.equal(meta.osVersion, '25.3.0');
  assert.equal(meta.electronVersion, '39.0.0');
  assert.equal(meta.locale, 'en-US');
  assert.deepEqual(meta.screens, [{ width: 1512, height: 982, scaleFactor: 2, primary: true }]);
  assert.deepEqual(meta.windowSize, { width: 1280, height: 800 });
});

test('collectFeedbackEnv shapes display + window facts', () => {
  const env = collectFeedbackEnv({
    getVersion: () => '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    getSystemVersion: () => '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    getAllDisplays: () => [
      { bounds: { width: 1512, height: 982 }, scaleFactor: 2, id: 1 },
      { bounds: { width: 1920, height: 1080 }, scaleFactor: 1, id: 2 },
    ],
    primaryDisplayId: 1,
    getContentSize: () => [1280, 800],
  });
  assert.equal(env.appVersion, '0.1.0');
  assert.equal(env.platform, 'darwin');
  assert.equal(env.arch, 'arm64');
  assert.equal(env.osVersion, '25.3.0');
  assert.equal(env.screens[0].primary, true);
  assert.equal(env.screens[1].primary, false);
  assert.deepEqual(env.windowSize, { width: 1280, height: 800 });
});

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('writeFeedbackReport writes meta.json and window.png', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png: tinyPng,
  });
  assert.ok(path.isAbsolute(out));
  assert.equal(out, path.resolve(out));
  assert.ok(out.startsWith(path.resolve(dir, 'feedback') + path.sep));
  assert.ok(fs.existsSync(path.join(out, 'meta.json')));
  assert.ok(fs.existsSync(path.join(out, 'window.png')));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.comment, 'hi');
  assert.equal(meta.target, null);
  assert.deepEqual(fs.readFileSync(path.join(out, 'window.png')), tinyPng);
});

test('writeFeedbackReport dirs are unique under baseDir/feedback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const opts = {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png: tinyPng,
    createdAt: '2026-11-09T00:00:00.000Z',
  };
  const a = await writeFeedbackReport(dir, opts);
  const b = await writeFeedbackReport(dir, opts);
  const root = path.resolve(dir, 'feedback') + path.sep;
  assert.ok(a.startsWith(root));
  assert.ok(b.startsWith(root));
  assert.notEqual(a, b);
  const metaA = JSON.parse(fs.readFileSync(path.join(a, 'meta.json'), 'utf8'));
  assert.equal(metaA.createdAt, '2026-11-09T00:00:00.000Z');
  assert.notEqual(path.basename(a), '2026-11-09T00-00-00.000Z');
});
