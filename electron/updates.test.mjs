import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  actionKind,
  actionLabel,
  createUpdater,
  DEFAULT_UPDATE_FEED_URL,
  initialState,
  reduceOnCheckFailure,
  reduceOnCheckStart,
  reduceOnDownloadComplete,
  reduceOnDownloadFailure,
  reduceOnDownloadProgress,
  reduceOnDownloadStart,
  reduceOnInstallFailure,
  reduceOnNoUpdate,
  reduceOnUpdateAvailable,
  resolveUpdateFeed,
} from './updates.mjs';

test('resolveUpdateFeed defaults to public plenum.sh generic URL', () => {
  assert.deepEqual(resolveUpdateFeed(() => undefined), {
    provider: 'generic',
    url: DEFAULT_UPDATE_FEED_URL,
  });
  assert.deepEqual(
    resolveUpdateFeed((name) => (name === 'UPDATE_FEED_URL' ? 'https://cdn.example/upd' : undefined)),
    { provider: 'generic', url: 'https://cdn.example/upd/' },
  );
});

test('actionLabel and actionKind follow T3 available → download → install', () => {
  assert.equal(actionKind(initialState({ status: 'idle', enabled: true })), 'check');
  assert.equal(actionLabel(initialState({ status: 'available', availableVersion: '0.3.0' })), 'Download 0.3.0');
  assert.equal(actionKind(initialState({ status: 'available', availableVersion: '0.3.0' })), 'download');
  assert.equal(actionLabel(initialState({ status: 'downloading', downloadPercent: 41.2 })), 'Downloading 41%');
  assert.equal(actionKind(initialState({ status: 'downloading' })), null);
  assert.equal(actionLabel(initialState({ status: 'downloaded' })), 'Close & update');
  assert.equal(actionKind(initialState({ status: 'downloaded' })), 'install');
  assert.equal(actionKind(initialState({ status: 'disabled' })), null);
});

test('reducers preserve a downloaded package across a failed re-check', () => {
  let s = initialState({ enabled: true, status: 'idle', currentVersion: '0.2.5' });
  s = reduceOnCheckStart(s, 't1');
  s = reduceOnUpdateAvailable(s, '0.3.0', 't1');
  assert.equal(s.status, 'available');
  s = reduceOnDownloadStart(s);
  s = reduceOnDownloadProgress(s, 50);
  s = reduceOnDownloadComplete(s, '0.3.0');
  assert.equal(s.status, 'downloaded');
  s = reduceOnCheckStart(s, 't2');
  s = reduceOnCheckFailure(s, 'offline', 't2');
  assert.equal(s.status, 'downloaded');
  assert.equal(s.downloadedVersion, '0.3.0');
  assert.equal(s.canRetry, true);
});

test('download failure returns to available when a version is known', () => {
  let s = initialState({
    enabled: true,
    status: 'available',
    availableVersion: '0.3.0',
    currentVersion: '0.2.5',
  });
  s = reduceOnDownloadStart(s);
  s = reduceOnDownloadFailure(s, 'network');
  assert.equal(s.status, 'available');
  assert.equal(s.message, 'network');
  assert.equal(s.canRetry, true);
});

test('no-update clears available unless something is already downloaded', () => {
  let s = reduceOnNoUpdate(initialState({
    status: 'checking',
    availableVersion: '0.3.0',
  }), 't');
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.availableVersion, null);

  s = reduceOnNoUpdate(initialState({
    status: 'checking',
    downloadedVersion: '0.3.0',
  }), 't');
  assert.equal(s.status, 'downloaded');
  assert.equal(s.availableVersion, '0.3.0');
});

test('install failure keeps the downloaded package', () => {
  const s = reduceOnInstallFailure(initialState({
    status: 'downloaded',
    downloadedVersion: '0.3.0',
  }), 'swap failed');
  assert.equal(s.status, 'downloaded');
  assert.equal(s.message, 'swap failed');
  assert.equal(s.canRetry, true);
});

test('createUpdater stays disabled outside packaged builds', async () => {
  const sent = [];
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    fullChangelog: true,
    verifyUpdateCodeSignature: true,
    removeAllListeners() {},
    on() {},
    checkForUpdates: async () => { throw new Error('should not run'); },
  };
  const u = createUpdater({
    getVersion: () => '0.2.5',
    isPackaged: false,
    platform: 'darwin',
    send: (s) => sent.push(s),
    updater: fake,
    envGet: () => undefined,
  });
  const s = u.configure();
  assert.equal(s.enabled, false);
  assert.equal(s.status, 'disabled');
  assert.match(s.message, /packaged/);
  assert.equal(fake.autoDownload, true); // never configured
  await u.check();
  assert.equal(u.getState().status, 'disabled');
});

test('createUpdater configures no-auto download/install and runs check', async () => {
  const sent = [];
  let checked = 0;
  const listeners = new Map();
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    fullChangelog: true,
    verifyUpdateCodeSignature: true,
    removeAllListeners(ev) { listeners.delete(ev); },
    on(ev, fn) { listeners.set(ev, fn); },
    setFeedURL() {},
    async checkForUpdates() {
      checked += 1;
      listeners.get('update-available')?.({ version: '0.3.0' });
    },
    async downloadUpdate() {
      listeners.get('download-progress')?.({ percent: 80 });
      listeners.get('update-downloaded')?.({ version: '0.3.0' });
    },
    quitAndInstall() { fake._installed = true; },
  };
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-upd-home-'));
  const u = createUpdater({
    getVersion: () => '0.2.5',
    isPackaged: true,
    platform: 'darwin',
    send: (s) => sent.push(s),
    updater: fake,
    envGet: () => undefined,
    runHome: emptyHome,
  });
  u.configure();
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  assert.equal(u.getState().status, 'idle');

  await u.act();
  assert.equal(checked, 1);
  assert.equal(u.getState().status, 'available');
  assert.equal(u.getState().availableVersion, '0.3.0');

  await u.act();
  assert.equal(u.getState().status, 'downloaded');
  assert.equal(u.getState().downloadPercent, 100);

  await u.act();
  assert.equal(fake._installed, true);
});

test('mock-update file forces available without calling GitHub', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-upd-'));
  fs.writeFileSync(path.join(dir, 'mock-update'), '0.3.0\n');
  const prev = process.env.PLENUM_MOCK_UPDATE;
  process.env.PLENUM_MOCK_UPDATE = '0.3.0';
  try {
    const u = createUpdater({
      getVersion: () => '0.2.6',
      isPackaged: true,
      platform: 'darwin',
      send: () => {},
      updater: {
        removeAllListeners() {},
        on() {},
        setFeedURL() {},
        async checkForUpdates() { throw new Error('should not hit network'); },
      },
      envGet: () => undefined,
    });
    u.configure();
    await u.check();
    assert.equal(u.getState().status, 'available');
    assert.equal(u.getState().availableVersion, '0.3.0');
  } finally {
    if (prev == null) delete process.env.PLENUM_MOCK_UPDATE;
    else process.env.PLENUM_MOCK_UPDATE = prev;
  }
});

test('a mock-update file enables the updater in unpackaged dev builds, with notes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-upd-'));
  fs.writeFileSync(path.join(dir, 'mock-update'), '0.3.0\n');
  const mk = (runHome) => createUpdater({
    getVersion: () => '0.2.6', isPackaged: false, platform: 'darwin', send: () => {}, runHome,
    updater: { removeAllListeners() {}, on() {}, setFeedURL() {} },
    envGet: () => undefined,
  });
  const noMock = mk(fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-upd-')));
  noMock.configure();
  assert.equal(noMock.getState().enabled, false);
  const u = mk(dir);
  u.configure();
  await u.check();
  assert.equal(u.getState().status, 'available');
  assert.ok(u.getState().releaseNotes.includes('Mock release note'));
});

test('PLENUM_DISABLE_AUTO_UPDATE disables the updater', () => {
  const u = createUpdater({
    getVersion: () => '0.2.5',
    isPackaged: true,
    platform: 'darwin',
    send: () => {},
    updater: {
      removeAllListeners() {},
      on() {},
      setFeedURL() {},
    },
    envGet: (name) => (name === 'DISABLE_AUTO_UPDATE' ? '1' : undefined),
  });
  const s = u.configure();
  assert.equal(s.enabled, false);
  assert.equal(s.status, 'disabled');
});
