import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionKind,
  actionLabel,
  createUpdater,
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
} from './updates.mjs';

test('actionLabel and actionKind follow T3 available → download → install', () => {
  assert.equal(actionKind(initialState({ status: 'idle', enabled: true })), 'check');
  assert.equal(actionLabel(initialState({ status: 'available', availableVersion: '0.3.0' })), 'Download 0.3.0');
  assert.equal(actionKind(initialState({ status: 'available', availableVersion: '0.3.0' })), 'download');
  assert.equal(actionLabel(initialState({ status: 'downloading', downloadPercent: 41.2 })), 'Downloading 41%');
  assert.equal(actionKind(initialState({ status: 'downloading' })), null);
  assert.equal(actionLabel(initialState({ status: 'downloaded' })), 'Install & Restart');
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
  const u = createUpdater({
    getVersion: () => '0.2.5',
    isPackaged: true,
    platform: 'darwin',
    send: (s) => sent.push(s),
    updater: fake,
    envGet: () => undefined,
  });
  u.configure();
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  assert.equal(fake.verifyUpdateCodeSignature, false);
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

test('PLENUM_DISABLE_AUTO_UPDATE disables the updater', () => {
  const u = createUpdater({
    getVersion: () => '0.2.5',
    isPackaged: true,
    platform: 'darwin',
    send: () => {},
    updater: {
      removeAllListeners() {},
      on() {},
    },
    envGet: (name) => (name === 'DISABLE_AUTO_UPDATE' ? '1' : undefined),
  });
  const s = u.configure();
  assert.equal(s.enabled, false);
  assert.match(s.message, /PLENUM_DISABLE_AUTO_UPDATE/);
});
