import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { loadBoard, loadCommitChanges, displayPath } from './git/board.mjs';
import * as ops from './git/ops.mjs';
import * as tabs from './tabs.mjs';
import * as supervisor from './lane/supervisor.mjs';
import { doctor, acceptManifest } from './lane/doctor.mjs';
import { getPrefs, setPrefs } from './prefs.mjs';
import { getIdentity, setIdentity } from './git/identity.mjs';
import * as creds from './git/credentials.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/** `~` and `~/x` to the home dir; anything else unchanged. */
function expandHome(p) {
  return typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p;
}

function prefsDir() {
  return app.getPath('userData');
}

function appIcon() {
  const candidates = [
    path.join(rootDir, 'build', 'icon.icns'),
    path.join(rootDir, 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'build', 'icon.icns'),
  ];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  }
  return null;
}

let win;

function createWindow() {
  const icon = appIcon();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#010102',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.OVERLOOK_DEV_URL;
  if (devUrl && !app.isPackaged) win.loadURL(devUrl);
  else win.loadFile(path.join(rootDir, 'dist', 'index.html'));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.setName('Overlook');
    const icon = appIcon();
    if (icon && app.dock) app.dock.setIcon(icon);
  }

  if (getPrefs(prefsDir()).reopenTabs === false) {
    for (const t of tabs.listTabs().tabs) tabs.closeTab(t.id);
  }

  const openPath = process.env.OVERLOOK_OPEN;
  if (openPath && fs.existsSync(openPath)) {
    try {
      const board = await loadBoard(openPath);
      tabs.openTab(board.root, board.repoName);
    } catch (e) {
      console.error('[overlook] OVERLOOK_OPEN failed', e.message);
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  supervisor.stopAll();
});

function activePath() {
  const { tabs: list, activeId } = tabs.listTabs();
  return list.find((t) => t.id === activeId)?.path ?? null;
}

ipcMain.handle('tabs.list', () => tabs.listTabs());
ipcMain.handle('tabs.open', async (_e, repoPath) => {
  const board = await loadBoard(repoPath);
  return { store: tabs.openTab(board.root, board.repoName), board };
});
ipcMain.handle('tabs.select', async (_e, id) => {
  const store = tabs.selectTab(id);
  const tab = store.tabs.find((t) => t.id === store.activeId);
  const board = tab ? await loadBoard(tab.path) : null;
  return { store, board };
});
ipcMain.handle('tabs.close', async (_e, id) => {
  const store = tabs.closeTab(id);
  const tab = store.tabs.find((t) => t.id === store.activeId);
  const board = tab ? await loadBoard(tab.path) : null;
  return { store, board };
});
ipcMain.handle('tabs.rename', (_e, id, title) => tabs.renameTab(id, title));
ipcMain.handle('tabs.setIcon', (_e, id, icon) => tabs.setIcon(id, icon));
ipcMain.handle('tabs.reorder', (_e, orderedIds) => tabs.reorderTabs(orderedIds));

ipcMain.handle('prefs.get', () => getPrefs(prefsDir()));
ipcMain.handle('prefs.set', (_e, partial) => setPrefs(partial, prefsDir()));

ipcMain.handle('board.get', async (_e, root) => loadBoard(root || activePath()));
ipcMain.handle('repo.refresh', async () => {
  const p = activePath();
  if (!p) return null;
  return loadBoard(p);
});
/** Active tab, or another open tab's root (Settings > Repositories). Never an arbitrary path. */
function tabRoot(root) {
  if (!root) return activePath();
  const abs = path.resolve(String(root));
  if (!tabs.listTabs().tabs.some((t) => path.resolve(t.path) === abs)) throw new Error('Not an open repository.');
  return abs;
}

ipcMain.handle('repo.doctor', async (_e, rootArg) => {
  const root = tabRoot(rootArg);
  if (!root) throw new Error('No repository open.');
  const { findings, proposedYaml, canAccept } = await doctor(root);
  return { findings, proposedYaml, canAccept };
});
ipcMain.handle('repo.acceptManifest', async (_e, yaml, rootArg) => {
  const root = tabRoot(rootArg);
  if (!root) throw new Error('No repository open.');
  await acceptManifest(root, yaml);
  return loadBoard(root);
});

ipcMain.handle('os.pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Open Repository',
    defaultPath: [expandHome(getPrefs(prefsDir()).cloneDefaultPath)].find((p) => p && fs.existsSync(p)),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

function assertPath(target) {
  const abs = path.resolve(String(target || ''));
  if (!abs || abs.startsWith('-')) throw new Error('Invalid path.');
  return abs;
}

ipcMain.handle('os.reveal', (_e, target) => {
  shell.showItemInFolder(assertPath(target));
});

ipcMain.handle('os.openExternal', (_e, url) => {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { throw new Error('Invalid URL.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs allowed.');
  }
  return shell.openExternal(parsed.href);
});

const home = process.env.HOME || '';
const EDITORS = {
  cursor: { cli: ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor', path.join(home, '.local/bin/cursor')], open: ['-b', 'com.todesktop.230313mzl4w4u92'] },
  vscode: { cli: ['/usr/local/bin/code', '/opt/homebrew/bin/code'], open: ['-a', 'Visual Studio Code'] },
  zed: { cli: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'], open: ['-a', 'Zed'] },
};

function launch(cmd, args) {
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/** Custom tool from Settings: a .app bundle or an executable that takes the folder as its argument. */
function openCustom(tool, abs) {
  if (!tool || !path.isAbsolute(tool) || !fs.existsSync(tool)) throw new Error('Set a valid path in Settings > General.');
  if (tool.endsWith('.app')) launch('open', ['-a', tool, abs]);
  else launch(tool, [abs]);
}

ipcMain.handle('os.openEditor', (_e, target) => {
  const abs = assertPath(target);
  const { editor, editorPath } = getPrefs(prefsDir());
  if (editor === 'custom') return openCustom(editorPath, abs);
  const e = EDITORS[editor] || EDITORS.cursor;
  const cli = e.cli.find((p) => fs.existsSync(p));
  if (cli) launch(cli, ['-r', '--', abs]);
  else launch('open', [...e.open, abs]);
});

ipcMain.handle('os.openTerminal', (_e, target) => {
  const abs = assertPath(target);
  const { terminal, terminalPath } = getPrefs(prefsDir());
  if (terminal === 'custom') return openCustom(terminalPath, abs);
  launch('open', ['-a', terminal === 'iterm' ? 'iTerm' : 'Terminal', abs]);
});

ipcMain.handle('os.displayPath', (_e, p) => displayPath(p));

async function withRoot(fn, ...args) {
  const root = activePath();
  if (!root) throw new Error('No repository open.');
  return fn(root, ...args);
}

ipcMain.handle('lane.create', (_e, payload) => withRoot((root, p) => {
  const prefs = getPrefs(prefsDir());
  const lanesFolder = expandHome(prefs.repoOverrides?.[root]?.lanesFolder || prefs.defaultLanesFolder);
  return ops.createLane(root, { ...p, lanesFolder });
}, payload));
async function accountsList() {
  return {
    hosts: getPrefs(prefsDir()).credentialHosts,
    helper: await creds.credentialHelper(),
    ssh: await creds.sshStatus(),
  };
}
// The token goes to `git credential approve` and nowhere else: not prefs, not the reply, not a log.
ipcMain.handle('accounts.setHttps', async (_e, { kind, host, username, token }) => {
  const h = creds.sanitizeHost(kind === 'github' ? 'github.com' : host);
  const user = String(username ?? '').trim();
  if (!(await creds.credentialHelper()).length) {
    throw new Error('No git credential helper configured. Run: git config --global credential.helper osxkeychain');
  }
  await creds.approve({ host: h, username: user, password: token });
  const list = creds.upsertHost(getPrefs(prefsDir()).credentialHosts, { host: h, username: user, kind });
  setPrefs({ credentialHosts: list }, prefsDir());
  return accountsList();
});
ipcMain.handle('accounts.removeHttps', async (_e, { host, username }) => {
  const h = creds.sanitizeHost(host);
  await creds.reject({ host: h, username });
  setPrefs({ credentialHosts: creds.removeHost(getPrefs(prefsDir()).credentialHosts, h, username) }, prefsDir());
  return accountsList();
});
ipcMain.handle('accounts.list', accountsList);
ipcMain.handle('git.identity.get', () => getIdentity(activePath()));
ipcMain.handle('git.identity.set', (_e, payload) => setIdentity(activePath(), payload || {}));
ipcMain.handle('lane.remove', (_e, laneIndex) => withRoot(ops.removeLane, laneIndex));
ipcMain.handle('lane.commit', (_e, laneIndex, message) => withRoot(ops.commitLane, laneIndex, message));
ipcMain.handle('lane.push', (_e, laneIndex) => withRoot(ops.pushLane, laneIndex));
ipcMain.handle('lane.pull', (_e, laneIndex) => withRoot(ops.pullLane, laneIndex));
ipcMain.handle('lane.rebase', async (_e, laneIndex) => {
  try {
    return await withRoot(ops.rebaseLane, laneIndex);
  } catch (e) {
    if (e.code === 'CONFLICT') return { conflict: true, conflicts: e.conflicts, operation: e.operation };
    throw e;
  }
});
ipcMain.handle('lane.merge', async (_e, laneIndex, opts) => {
  try {
    return await withRoot(ops.mergeLaneIntoMain, laneIndex, opts);
  } catch (e) {
    if (e.code === 'CONFLICT') {
      return { conflict: true, conflicts: e.conflicts, operation: e.operation, conflictRoot: e.conflictRoot };
    }
    throw e;
  }
});
ipcMain.handle('lane.conflicts', (_e, laneIndex, conflictRoot) => withRoot(ops.conflictStatus, laneIndex, conflictRoot));
ipcMain.handle('lane.conflictStage', (_e, laneIndex, file, conflictRoot) => withRoot(ops.conflictStage, laneIndex, file, conflictRoot));
ipcMain.handle('lane.conflictContinue', (_e, laneIndex, conflictRoot) => withRoot(ops.conflictContinue, laneIndex, conflictRoot));
ipcMain.handle('lane.conflictAbort', (_e, laneIndex, conflictRoot) => withRoot(ops.conflictAbort, laneIndex, conflictRoot));
ipcMain.handle('lane.stash', (_e, laneIndex) => withRoot(ops.stashLane, laneIndex));
ipcMain.handle('lane.stashPop', (_e, laneIndex) => withRoot(ops.stashPopLane, laneIndex));
ipcMain.handle('lane.up', (_e, laneIndex, opts) => withRoot(async (root, idx) => {
  try {
    await supervisor.up(root, idx, opts);
    return loadBoard(root);
  } catch (e) {
    if (e.code === 'DRIFT') return { drift: true, pending: e.pending ?? [] };
    throw e;
  }
}));
ipcMain.handle('lane.down', (_e, laneIndex) => withRoot(async (root, idx) => {
  await supervisor.down(root, idx);
  return loadBoard(root);
}));
ipcMain.handle('lane.status', (_e, laneIndex) => withRoot((root, idx) => supervisor.getProc(root, idx)));
ipcMain.handle('lane.test', (_e, laneIndex) => withRoot(async (root, idx) => {
  await supervisor.test(root, idx);
  return loadBoard(root);
}));
ipcMain.handle('commit.changes', (_e, sha) => withRoot(loadCommitChanges, sha));
