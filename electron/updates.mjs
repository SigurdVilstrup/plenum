/**
 * T3-style desktop updates: electron-updater against GitHub Releases.
 * Check in the background; never auto-download or auto-install — the UI advances
 * available → download → install & restart.
 */
import { createRequire } from 'node:module';
import { env } from './paths.mjs';

const require = createRequire(import.meta.url);

/** Lazy — importing electron-updater's autoUpdater touches `app` and breaks node:test. */
function defaultAutoUpdater() {
  return require('electron-updater').autoUpdater;
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

export function reduceOnUpdateAvailable(state, version, checkedAt) {
  const already = state.downloadedVersion === version;
  return {
    ...state,
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
      return 'Install & Restart';
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
    if (!opts.isPackaged) {
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
    // Dogfood packs are unsigned (identity: null). Signature checks would block every update.
    if (typeof updater.verifyUpdateCodeSignature === 'boolean') {
      updater.verifyUpdateCodeSignature = false;
    }

    const token = envGet('UPDATE_GITHUB_TOKEN') || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      updater.requestHeaders = {
        ...(updater.requestHeaders || {}),
        Authorization: `Bearer ${token}`,
      };
    }

    const repo = String(envGet('UPDATE_REPOSITORY', '') || '').trim();
    if (repo) {
      const [owner, name, ...rest] = repo.split('/');
      if (owner && name && rest.length === 0) {
        updater.setFeedURL({ provider: 'github', owner, repo: name });
      }
    }

    updater.removeAllListeners?.('update-available');
    updater.removeAllListeners?.('update-not-available');
    updater.removeAllListeners?.('download-progress');
    updater.removeAllListeners?.('update-downloaded');
    updater.removeAllListeners?.('error');

    updater.on('update-available', (info) => {
      publish(reduceOnUpdateAvailable(state, String(info?.version || ''), nowIso()));
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
      // isSilent=false, isForceRunAfter=true — same as T3 quitAndInstall options.
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
