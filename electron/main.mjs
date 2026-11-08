import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadBoard, displayPath } from './git/board.mjs';
import * as ops from './git/ops.mjs';
import * as tabs from './tabs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#010102',
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

ipcMain.handle('board.get', async (_e, root) => loadBoard(root || activePath()));
ipcMain.handle('repo.refresh', async () => {
  const p = activePath();
  if (!p) return null;
  return loadBoard(p);
});

ipcMain.handle('os.pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Open Repository',
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

ipcMain.handle('os.openCursor', (_e, target) => {
  const abs = assertPath(target);
  const cli = ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor', path.join(process.env.HOME || '', '.local/bin/cursor')]
    .find((p) => fs.existsSync(p));
  if (cli) {
    spawn(cli, ['-r', '--', abs], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('open', ['-b', 'com.todesktop.230313mzl4w4u92', abs], { detached: true, stdio: 'ignore' }).unref();
  }
});

ipcMain.handle('os.displayPath', (_e, p) => displayPath(p));

async function withRoot(fn, ...args) {
  const root = activePath();
  if (!root) throw new Error('No repository open.');
  return fn(root, ...args);
}

ipcMain.handle('lane.create', (_e, payload) => withRoot(ops.createLane, payload));
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
