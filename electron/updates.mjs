/**
 * T3-style desktop updates via electron-updater.
 * Check in the background; never auto-download or auto-install — the UI advances
 * available → download → install & restart.
 *
 * Default feed is the public generic URL on plenum.sh (no GitHub token).
 * Override with PLENUM_UPDATE_FEED_URL, or PLENUM_UPDATE_REPOSITORY=owner/repo for GitHub.
 * Dogfood UI without files: ~/.plenum/mock-update containing a semver (e.g. `0.2.7`).
 *
 * Releases are Developer ID–signed + notarized so Squirrel.Mac can install the zip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { env, RUN_HOME } from './paths.mjs';

const require = createRequire(import.meta.url);

/** Lazy — importing electron-updater's autoUpdater touches `app` and breaks node:test. */
function defaultAutoUpdater() {
  return require('electron-updater').autoUpdater;
}

/** Public update channel — anyone can check/download without a GitHub token. */
export const DEFAULT_UPDATE_FEED_URL = 'https://plenum.sh/updates/';

const DEFAULT_FEED = { provider: 'generic', url: DEFAULT_UPDATE_FEED_URL };

/** Resolve feed from env overrides, else public plenum.sh. */
export function resolveUpdateFeed(envGet = env) {
  const feedUrl = String(envGet('UPDATE_FEED_URL', '') || '').trim();
  if (feedUrl) return { provider: 'generic', url: feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/` };

  const repo = String(envGet('UPDATE_REPOSITORY', '') || '').trim();
  if (repo) {
    const [owner, name, ...rest] = repo.split('/');
    if (owner && name && rest.length === 0) {
      return { provider: 'github', owner, repo: name, private: true };
    }
  }
  return { ...DEFAULT_FEED };
}

function readFirstLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const line = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || '';
  } catch {
    return '';
  }
}

/** Optional dogfood override: force “update available” without hitting GitHub. */
export function readMockUpdateVersion(dir = RUN_HOME) {
  const fromEnv = String(env('MOCK_UPDATE', '') || '').trim();
  if (fromEnv) return fromEnv.replace(/^v/i, '');
  const fromFile = readFirstLine(path.join(dir, 'mock-update'));
  return fromFile ? fromFile.replace(/^v/i, '') : '';
}

function readUpdateGithubToken(dir = RUN_HOME) {
  return (
    String(env('UPDATE_GITHUB_TOKEN', '') || '').trim()
    || String(process.env.GH_TOKEN || '').trim()
    || String(process.env.GITHUB_TOKEN || '').trim()
    || readFirstLine(path.join(dir, 'update-github-token'))
  );
}

function isNewerVersion(candidate, current) {
  try {
    const semver = require('semver');
    return Boolean(semver.valid(candidate) && semver.valid(current) && semver.gt(candidate, current));
  } catch {
    return candidate !== current && candidate > current;
  }
}

export const STARTUP_DELAY_MS = 15_000;
export const POLL_INTERVAL_MS = 4 * 60_000;

/** @typedef {'disabled'|'idle'|'checking'|'up-to-date'|'available'|'downloading'|'downloaded'|'error'} UpdateStatus */

/**
 * @param {{
 *   enabled?: boolean,
 *   status?: UpdateStatus,
 *   currentVersion?: string,
 *   availableVersion?: string|null,
 *   downloadedVersion?: string|null,
 *   downloadPercent?: number|null,
 *   checkedAt?: string|null,
 *   message?: string|null,
 *   canRetry?: boolean,
 * }} [partial]
 */
export function initialState(partial = {}) {
  return {
    enabled: false,
    status: /** @type {UpdateStatus} */ ('disabled'),
    currentVersion: '',
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    /** Commit headers since the installed version (from latest-mac.yml releaseNotes). */
    releaseNotes: '',
    checkedAt: null,
    message: null,
    canRetry: false,
    ...partial,
  };
}

export function reduceOnCheckStart(state, checkedAt) {
  const keepDownloaded = state.downloadedVersion != null;
  return {
    ...state,
    status: 'checking',
    checkedAt,
    message: null,
    downloadPercent: keepDownloaded ? 100 : null,
    canRetry: false,
  };
}

export function reduceOnCheckFailure(state, message, checkedAt) {
  if (state.downloadedVersion != null) {
    return {
      ...state,
      status: 'downloaded',
      message: null,
      checkedAt,
      downloadPercent: 100,
      canRetry: true,
    };
  }
  return {
    ...state,
    status: 'error',
    message,
    checkedAt,
    downloadPercent: null,
    canRetry: true,
  };
}

/** electron-updater gives a string (generic feed) or [{version, note}] (GitHub). */
export function notesText(raw) {
  if (Array.isArray(raw)) return raw.map((r) => r?.note || '').filter(Boolean).join('\n');
  return typeof raw === 'string' ? raw.trim() : '';
}

export function reduceOnUpdateAvailable(state, version, checkedAt, releaseNotes = '') {
  const already = state.downloadedVersion === version;
  return {
    ...state,
    releaseNotes,
    status: already ? 'downloaded' : 'available',
    availableVersion: version,
    downloadedVersion: already ? version : null,
    downloadPercent: already ? 100 : null,
    checkedAt,
    message: null,
    canRetry: already,
  };
}

export function reduceOnNoUpdate(state, checkedAt) {
  if (state.downloadedVersion != null) {
    return {
      ...state,
      status: 'downloaded',
      availableVersion: state.downloadedVersion,
      downloadPercent: 100,
      checkedAt,
      message: null,
      canRetry: true,
    };
  }
  return {
    ...state,
    status: 'up-to-date',
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt,
    message: null,
    canRetry: false,
  };
}

export function reduceOnDownloadStart(state) {
  return {
    ...state,
    status: 'downloading',
    downloadPercent: 0,
    message: null,
    canRetry: false,
  };
}

export function reduceOnDownloadProgress(state, percent) {
  return {
    ...state,
    status: 'downloading',
    downloadPercent: percent,
    message: null,
    canRetry: false,
  };
}

export function reduceOnDownloadComplete(state, version) {
  return {
    ...state,
    status: 'downloaded',
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    message: null,
    canRetry: true,
  };
}

export function reduceOnDownloadFailure(state, message) {
  return {
    ...state,
    status: state.availableVersion ? 'available' : 'error',
    message,
    downloadPercent: null,
    canRetry: Boolean(state.availableVersion),
  };
}

export function reduceOnInstallFailure(state, message) {
  return {
    ...state,
    status: 'downloaded',
    message,
    canRetry: true,
  };
}

/** Primary button label for the current status (T3 rocket UX). */
export function actionLabel(state) {
  const v = state.availableVersion || state.downloadedVersion;
  switch (state.status) {
    case 'available':
      return v ? `Download ${v}` : 'Download update';
    case 'downloading': {
      const pct = state.downloadPercent;
      return pct != null ? `Downloading ${Math.round(pct)}%` : 'Downloading…';
    }
    case 'downloaded':
      return 'Close & update';
    case 'checking':
      return 'Checking…';
    case 'error':
      return state.canRetry ? 'Retry' : 'Update unavailable';
    case 'up-to-date':
      return 'Check for updates';
    case 'idle':
      return 'Check for updates';
    default:
      return null;
  }
}

/** Next IPC action for the primary button, or null if disabled. */
export function actionKind(state) {
  switch (state.status) {
    case 'available':
      return 'download';
    case 'downloaded':
      return 'install';
    case 'error':
      return state.canRetry ? (state.availableVersion ? 'download' : 'check') : null;
    case 'idle':
    case 'up-to-date':
      return 'check';
    default:
      return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function errMessage(err) {
  if (!err) return 'Update failed';
  if (typeof err === 'string') return err;
  return String(err.message || err).replace(/^Error:\s*/, '') || 'Update failed';
}

/**
 * @param {{
 *   getVersion: () => string,
 *   isPackaged: boolean,
 *   platform: NodeJS.Platform,
 *   send: (state: ReturnType<typeof initialState>) => void,
 *   updater?: object,
 *   envGet?: (name: string, fallback?: string) => string|undefined,
 * }} opts
 */
export function createUpdater(opts) {
  const updater = opts.updater || defaultAutoUpdater();
  const envGet = opts.envGet || env;
  const runHome = opts.runHome || RUN_HOME;
  let state = initialState({ currentVersion: opts.getVersion() });
  let timers = [];
  let busy = null;
  let started = false;

  function publish(next) {
    state = next;
    try { opts.send(snapshot()); } catch { /* renderer may be gone */ }
    return state;
  }

  function snapshot() {
    return { ...state };
  }

  function disabledReason() {
    if (String(envGet('DISABLE_AUTO_UPDATE', '') || '').trim() === '1') {
      return 'Automatic updates are disabled by PLENUM_DISABLE_AUTO_UPDATE.';
    }
    // A mock-update file/env lets dev builds dogfood the update UI.
    if (!opts.isPackaged && !readMockUpdateVersion(runHome)) {
      return 'Automatic updates are only available in packaged builds.';
    }
    return null;
  }

  function configure() {
    const reason = disabledReason();
    if (reason) {
      return publish(initialState({
        enabled: false,
        status: 'disabled',
        currentVersion: opts.getVersion(),
        message: reason,
      }));
    }

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.fullChangelog = false;

    const feed = resolveUpdateFeed(envGet);
    if (feed.provider === 'github') {
      const token = readUpdateGithubToken(runHome);
      if (token) {
        updater.requestHeaders = {
          ...(updater.requestHeaders || {}),
          Authorization: `Bearer ${token}`,
        };
      }
    }

    // Always set an explicit feed — `npm run pack --dir` does not embed app-update.yml.
    try {
      updater.setFeedURL(feed);
    } catch { /* keep electron-updater defaults if setFeedURL unavailable in tests */ }

    updater.removeAllListeners?.('update-available');
    updater.removeAllListeners?.('update-not-available');
    updater.removeAllListeners?.('download-progress');
    updater.removeAllListeners?.('update-downloaded');
    updater.removeAllListeners?.('error');

    updater.on('update-available', (info) => {
      publish(reduceOnUpdateAvailable(state, String(info?.version || ''), nowIso(), notesText(info?.releaseNotes)));
    });
    updater.on('update-not-available', () => {
      publish(reduceOnNoUpdate(state, nowIso()));
    });
    updater.on('download-progress', (p) => {
      const pct = Number(p?.percent);
      publish(reduceOnDownloadProgress(state, Number.isFinite(pct) ? pct : 0));
    });
    updater.on('update-downloaded', (info) => {
      publish(reduceOnDownloadComplete(state, String(info?.version || state.availableVersion || '')));
    });
    updater.on('error', (err) => {
      if (busy === 'download' || state.status === 'downloading') {
        publish(reduceOnDownloadFailure(state, errMessage(err)));
      } else if (busy === 'install') {
        publish(reduceOnInstallFailure(state, errMessage(err)));
      } else {
        publish(reduceOnCheckFailure(state, errMessage(err), nowIso()));
      }
      busy = null;
    });

    return publish(initialState({
      enabled: true,
      status: 'idle',
      currentVersion: opts.getVersion(),
    }));
  }

  async function check(reason = 'manual') {
    if (!state.enabled) return snapshot();
    if (busy) return snapshot();
    busy = 'check';
    publish(reduceOnCheckStart(state, nowIso()));
    try {
      const mock = envGet('MOCK_UPDATE') != null && String(envGet('MOCK_UPDATE')).trim() !== ''
        ? String(envGet('MOCK_UPDATE')).trim().replace(/^v/i, '')
        : readMockUpdateVersion(runHome);
      if (mock) {
        const cur = opts.getVersion();
        if (isNewerVersion(mock, cur)) {
          publish(reduceOnUpdateAvailable(state, mock, nowIso(), '- Mock release note one\n- Mock release note two'));
        } else {
          publish(reduceOnNoUpdate(state, nowIso()));
        }
        return snapshot();
      }
      const feed = resolveUpdateFeed(envGet);
      if (feed.provider === 'github' && !readUpdateGithubToken(runHome)) {
        publish(reduceOnCheckFailure(
          state,
          'GitHub update feed needs ~/.plenum/update-github-token (private repo). Prefer the public https://plenum.sh/updates/ feed.',
          nowIso(),
        ));
        return snapshot();
      }
      await updater.checkForUpdates();
    } catch (err) {
      publish(reduceOnCheckFailure(state, errMessage(err), nowIso()));
    } finally {
      if (busy === 'check') busy = null;
    }
    return snapshot();
  }

  async function download() {
    if (!state.enabled) return snapshot();
    if (busy) return snapshot();
    if (state.status !== 'available' && !(state.status === 'error' && state.availableVersion)) {
      return snapshot();
    }
    busy = 'download';
    publish(reduceOnDownloadStart(state));
    try {
      const mock = readMockUpdateVersion(runHome) || String(envGet('MOCK_UPDATE', '') || '').trim().replace(/^v/i, '');
      if (mock) {
        // UI dogfood only — no real package to swap in.
        publish(reduceOnDownloadProgress(state, 100));
        publish(reduceOnDownloadComplete(state, mock));
        return snapshot();
      }
      await updater.downloadUpdate();
      if (state.status === 'downloading') {
        publish(reduceOnDownloadComplete(state, state.availableVersion || ''));
      }
    } catch (err) {
      publish(reduceOnDownloadFailure(state, errMessage(err)));
    } finally {
      if (busy === 'download') busy = null;
    }
    return snapshot();
  }

  async function install() {
    if (!state.enabled) return snapshot();
    if (state.status !== 'downloaded' && state.downloadedVersion == null) return snapshot();
    busy = 'install';
    try {
      if (readMockUpdateVersion(runHome) || String(envGet('MOCK_UPDATE', '') || '').trim()) {
        publish(reduceOnInstallFailure(
          state,
          'Mock update only — publish zip + latest-mac.yml to https://plenum.sh/updates/ to install for real.',
        ));
        busy = null;
        return snapshot();
      }
      // isSilent=false, isForceRunAfter=true — same as T3 quitAndInstall options.
      // Requires Developer ID–signed (+ notarized) releases for Squirrel.Mac on macOS.
      updater.quitAndInstall(false, true);
    } catch (err) {
      publish(reduceOnInstallFailure(state, errMessage(err)));
      busy = null;
    }
    return snapshot();
  }

  /** One-click advance used by the rocket / Settings button. */
  async function act() {
    const kind = actionKind(state);
    if (kind === 'check') return check('manual');
    if (kind === 'download') return download();
    if (kind === 'install') return install();
    return snapshot();
  }

  function startBackground() {
    if (started || !state.enabled) return;
    started = true;
    const startup = setTimeout(() => { check('startup').catch(() => {}); }, STARTUP_DELAY_MS);
    const poll = setInterval(() => { check('poll').catch(() => {}); }, POLL_INTERVAL_MS);
    timers.push(startup, poll);
  }

  function stop() {
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    timers = [];
    started = false;
  }

  return {
    configure,
    startBackground,
    stop,
    getState: snapshot,
    check,
    download,
    install,
    act,
  };
}
