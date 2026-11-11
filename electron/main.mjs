import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { loadRepoEnv } from './load-env.mjs';
import { isPathUnderRepos } from './repo-favicon.mjs';
import { loadBoard, loadCommitChanges, displayPath, setTeamBranch, setBaselines } from './git/board.mjs';
import { loadFileDiff, loadFileHistory, loadFileBlame, loadFileShow, loadWorkingDiff, loadWorkingShow } from './git/file.mjs';
import * as ops from './git/ops.mjs';
import * as undo from './git/undo.mjs';
import * as tabs from './tabs.mjs';
import * as supervisor from './lane/supervisor.mjs';
import { doctor, acceptManifest } from './lane/doctor.mjs';
import { getPrefs, setPrefs } from './prefs.mjs';
import { getIdentity, setIdentity } from './git/identity.mjs';
import * as creds from './git/credentials.mjs';
import {
  paintHighlight,
  writeFeedbackReport,
  collectFeedbackEnv,
  sanitizeReporterEmail,
  sendFeedbackReport,
} from './feedback.mjs';
import { readBuildInfo } from './build-info.mjs';
import { env as brandEnv } from './paths.mjs';
import { createUpdater } from './updates.mjs';
import { ensureLauncher } from './agents/launcher.mjs';
import { agentsHome } from './agents/settings.mjs';

loadRepoEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const buildInfoPath = path.join(__dirname, 'build-info.json');

// Must run before app ready - lets the sandboxed UI load local repo images.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'plenum-img',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

/** `~` and `~/x` to the home dir; anything else unchanged. */
function expandHome(p) {
  return typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p;
}

function prefsDir() {
  const dir = app.getPath('userData');
  const legacy = path.join(path.dirname(dir), 'overlook');
  if (!fs.existsSync(path.join(dir, 'prefs.json')) && fs.existsSync(path.join(legacy, 'prefs.json'))) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of fs.readdirSync(legacy)) {
        const dest = path.join(dir, name);
        if (!fs.existsSync(dest)) fs.renameSync(path.join(legacy, name), dest);
      }
    } catch { /* keep reading fresh prefs if migrate fails */ }
  }
  return dir;
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
let updates;

function createWindow() {
  const icon = appIcon();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#1a1b1e',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = brandEnv('DEV_URL');
  if (devUrl && !app.isPackaged) win.loadURL(devUrl);
  else win.loadFile(path.join(rootDir, 'dist', 'index.html'));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(async () => {
  try {
    // rootDir is app.asar when packaged, the repo when not; Electron-as-node runs the CLI from either.
    ensureLauncher({ packaged: app.isPackaged, execPath: process.execPath, cliPath: path.join(rootDir, 'bin', 'plenum.mjs'), home: agentsHome() });
  } catch (err) {
    console.error('plenum launcher not written:', err);
  }
  protocol.handle('plenum-img', (request) => {
    try {
      const abs = new URL(request.url).searchParams.get('p');
      if (!abs || !path.isAbsolute(abs)) return new Response('Bad path', { status: 400 });
      const roots = tabs.listTabs().tabs.map((t) => t.path);
      if (!isPathUnderRepos(abs, roots)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(abs).href);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  if (process.platform === 'darwin') {
    app.setName('Plenum');
    const icon = appIcon();
    if (icon && app.dock) app.dock.setIcon(icon);
  }

  if (getPrefs(prefsDir()).reopenTabs === false) {
    for (const t of tabs.listTabs().tabs) tabs.closeTab(t.id);
  }

  // Sync favicon cache with the pref (clear stale data URLs when off).
  tabs.refreshFavicons(getPrefs(prefsDir()).tabFavicons !== false);

  const openPath = brandEnv('OPEN');
  if (openPath && fs.existsSync(openPath)) {
    try {
      const board = await loadBoard(openPath);
      tabs.openTab(board.root, board.repoName, { favicons: getPrefs(prefsDir()).tabFavicons !== false });
    } catch (e) {
      console.error('[plenum] PLENUM_OPEN failed', e.message);
    }
  }
  // Undo / Copy / Paste go to the page first: it decides between a focused text field
  // (native editing) and the app-level action (undo last git op, copy SHA, paste repo path).
  const edit = (cmd) => () => win?.webContents.send('edit', cmd, cmd === 'paste' ? clipboard.readText() : undefined);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: edit('undo') },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: edit('copy') },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: edit('paste') },
      { role: 'selectAll' },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  createWindow();
  updates = createUpdater({
    getVersion: () => app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    send: (state) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('update', state);
      }
    },
  });
  updates.configure();
  updates.startBackground();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  updates?.stop();
  supervisor.stopAll();
});

function activePath() {
  const { tabs: list, activeId } = tabs.listTabs();
  return list.find((t) => t.id === activeId)?.path ?? null;
}

ipcMain.handle('tabs.list', () => tabs.listTabs());
ipcMain.handle('tabs.open', async (_e, repoPath) => {
  const board = await loadBoard(expandHome(repoPath));
  const favicons = getPrefs(prefsDir()).tabFavicons !== false;
  return { store: tabs.openTab(board.root, board.repoName, { favicons }), board };
});
// Select is sync - board loads in the renderer via board.get so rapid switches
// do not pile up loadBoard work against the wrong active tab.
ipcMain.handle('tabs.select', (_e, id) => ({ store: tabs.selectTab(id) }));
ipcMain.handle('tabs.close', async (_e, id) => {
  const store = tabs.closeTab(id);
  const tab = store.tabs.find((t) => t.id === store.activeId);
  const board = tab ? await loadBoard(tab.path) : null;
  return { store, board };
});
ipcMain.handle('tabs.rename', (_e, id, title, icon) => tabs.renameTab(id, title, icon));
ipcMain.handle('tabs.setIcon', (_e, id, icon) => tabs.setIcon(id, icon));
ipcMain.handle('tabs.listImages', (_e, id) => tabs.listTabImages(id));
ipcMain.handle('tabs.setImage', (_e, id, relPath) => tabs.setTabImage(id, relPath));
ipcMain.handle('tabs.reorder', (_e, orderedIds) => tabs.reorderTabs(orderedIds));
ipcMain.handle('tabs.restore', (_e, snap, index) => tabs.restoreTab(snap, index));

ipcMain.handle('undo.snapshot', (_e, ...args) => withRoot(undo.snapshotLane, ...args));
ipcMain.handle('undo.restorePaths', (_e, ...args) => withRoot(undo.restorePaths, ...args));
ipcMain.handle('undo.restoreLane', (_e, ...args) => withRoot(undo.restoreLane, ...args));
ipcMain.handle('undo.uncommit', (_e, ...args) => withRoot(undo.uncommit, ...args));
ipcMain.handle('undo.restoreBranch', (_e, ...args) => withRoot(undo.restoreBranch, ...args));

const NATIVE_EDIT = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
ipcMain.handle('edit.native', (e, cmd) => { if (NATIVE_EDIT.has(cmd)) e.sender[cmd](); });
ipcMain.handle('clipboard.write', (_e, text) => clipboard.writeText(String(text ?? '')));

ipcMain.handle('prefs.get', () => getPrefs(prefsDir()));
ipcMain.handle('prefs.set', (_e, partial) => {
  const next = setPrefs(partial, prefsDir());
  if ('tabFavicons' in (partial || {})) tabs.refreshFavicons(next.tabFavicons !== false);
  return next;
});
ipcMain.handle('app.version', () => {
  const info = readBuildInfo(buildInfoPath);
  return {
    version: app.getVersion(),
    commit: info.commit,
    committedAt: info.committedAt,
  };
});
ipcMain.handle('app.update.state', () => updates?.getState() || null);
ipcMain.handle('app.update.check', () => updates?.check('manual') || null);
ipcMain.handle('app.update.download', () => updates?.download() || null);
ipcMain.handle('app.update.install', () => updates?.install() || null);
ipcMain.handle('app.update.act', () => updates?.act() || null);
ipcMain.handle('os.editors', () => listEditors());
ipcMain.handle('os.diffMergeTools', () => listDiffMergeTools());

function feedbackEnvSnapshot() {
  return collectFeedbackEnv({
    getVersion: () => app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    getSystemVersion: () => process.getSystemVersion(),
    electronVersion: process.versions.electron,
    locale: app.getLocale(),
    getAllDisplays: () => screen.getAllDisplays(),
    primaryDisplayId: screen.getPrimaryDisplay().id,
    getContentSize: () => win.getContentSize(),
  });
}

function parseFeedbackTarget(target) {
  if (!target?.rect) return null;
  const r = target.rect;
  const nums = ['x', 'y', 'w', 'h'].map((k) => Number(r[k]));
  if (nums.some((n) => !Number.isFinite(n))) throw new Error('Invalid target rect.');
  return {
    label: String(target.label || '').slice(0, 200),
    rect: { x: nums[0], y: nums[1], w: nums[2], h: nums[3] },
  };
}

async function captureFeedbackPng(rect) {
  let png = (await win.webContents.capturePage()).toPNG();
  if (rect) {
    const { width: imgW, height: imgH } = nativeImage.createFromBuffer(png).getSize();
    const [cssW, cssH] = win.getContentSize();
    png = paintHighlight(png, rect, { scaleX: imgW / cssW, scaleY: imgH / cssH });
  }
  return png;
}

// Renderer must hide the sheet and apply redaction before capture.
ipcMain.handle('feedback.capture', async (_e, payload) => {
  const parsed = parseFeedbackTarget(payload?.target ?? null);
  const png = await captureFeedbackPng(parsed?.rect || null);
  return { pngBase64: png.toString('base64') };
});

ipcMain.handle('feedback.save', async (_e, payload) => {
  const comment = String(payload?.comment || '').trim();
  if (!comment) throw new Error('Add a comment.');
  const reporterEmail = sanitizeReporterEmail(payload?.reporterEmail);
  const parsed = parseFeedbackTarget(payload?.target ?? null);
  let png;
  if (payload?.pngBase64) {
    png = Buffer.from(String(payload.pngBase64), 'base64');
  } else {
    png = await captureFeedbackPng(parsed?.rect || null);
  }
  const env = feedbackEnvSnapshot();
  const dir = await writeFeedbackReport(prefsDir(), {
    comment,
    target: parsed?.label ? { label: parsed.label, rect: parsed.rect } : null,
    reporterEmail,
    ...env,
    repoPath: activePath(),
    png,
  });
  return { dir };
});

ipcMain.handle('feedback.send', async (_e, dir) => {
  const root = path.resolve(prefsDir(), 'feedback');
  const reportDir = path.resolve(String(dir || ''));
  if (reportDir !== root && !reportDir.startsWith(root + path.sep)) {
    throw new Error('bad report path');
  }
  if (!fs.existsSync(path.join(reportDir, 'meta.json')) || !fs.existsSync(path.join(reportDir, 'window.png'))) {
    throw new Error('bad report path');
  }
  const meta = await sendFeedbackReport(reportDir, {
    endpoint: brandEnv('FEEDBACK_URL'),
    anonKey: brandEnv('SUPABASE_ANON_KEY'),
  });
  return {
    dir: reportDir,
    issueUrl: meta.issueUrl,
    issueNumber: meta.issueNumber,
  };
});

ipcMain.handle('board.get', async (_e, root, opts) => loadBoard(root || activePath(), opts || {}));
ipcMain.handle('repo.setTeamBranch', async (_e, name, rootArg) => {
  const root = tabRoot(rootArg);
  if (!root) throw new Error('No repository open.');
  return setTeamBranch(root, name);
});
ipcMain.handle('repo.setBaselines', async (_e, names, rootArg) => {
  const root = tabRoot(rootArg);
  if (!root) throw new Error('No repository open.');
  return setBaselines(root, names);
});
ipcMain.handle('repo.refresh', async (_e, opts) => {
  const p = activePath();
  if (!p) return null;
  return loadBoard(p, opts || {});
});
/** Active tab, or another open tab's root (Settings > Repository / Lane setup). Never an arbitrary path. */
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
  cursor: {
    label: 'Cursor',
    cli: ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor', path.join(home, '.local/bin/cursor')],
    apps: [path.join(home, 'Applications/Cursor.app'), '/Applications/Cursor.app'],
    open: ['-b', 'com.todesktop.230313mzl4w4u92'],
  },
  vscode: {
    label: 'VS Code',
    cli: ['/usr/local/bin/code', '/opt/homebrew/bin/code'],
    apps: [path.join(home, 'Applications/Visual Studio Code.app'), '/Applications/Visual Studio Code.app'],
    open: ['-a', 'Visual Studio Code'],
  },
  zed: {
    label: 'Zed',
    cli: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
    apps: [path.join(home, 'Applications/Zed.app'), '/Applications/Zed.app'],
    open: ['-a', 'Zed'],
  },
  windsurf: {
    label: 'Windsurf',
    cli: [
      '/usr/local/bin/windsurf',
      '/opt/homebrew/bin/windsurf',
      path.join(home, '.local/bin/windsurf'),
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
      path.join(home, 'Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'),
    ],
    apps: [path.join(home, 'Applications/Windsurf.app'), '/Applications/Windsurf.app'],
    open: ['-b', 'com.exafunction.windsurf'],
  },
};

function editorAvailable(e) {
  return e.cli.some((p) => fs.existsSync(p)) || e.apps.some((p) => fs.existsSync(p));
}

function listEditors() {
  return [
    ...Object.entries(EDITORS).map(([id, e]) => ({
      id,
      label: e.label,
      available: editorAvailable(e),
    })),
    { id: 'custom', label: 'Other app…', available: true },
  ];
}

function fileMergeAvailable() {
  const apps = [
    '/Applications/Xcode.app/Contents/Applications/FileMerge.app',
    '/Applications/FileMerge.app',
    path.join(home, 'Applications/FileMerge.app'),
  ];
  const bins = [
    '/Applications/Xcode.app/Contents/Developer/usr/bin/opendiff',
    '/Library/Developer/CommandLineTools/usr/bin/opendiff',
  ];
  return apps.some((p) => fs.existsSync(p)) || bins.some((p) => fs.existsSync(p));
}

/** Tools allowed by prefs.diffTool / prefs.mergeTool - probe installs like editors. */
function listDiffMergeTools() {
  return [
    { id: 'internal', label: 'Built-in', available: true },
    { id: 'opendiff', label: 'FileMerge', available: fileMergeAvailable() },
    { id: 'vscode', label: 'VS Code', available: editorAvailable(EDITORS.vscode) },
    { id: 'cursor', label: 'Cursor', available: editorAvailable(EDITORS.cursor) },
    { id: 'windsurf', label: 'Windsurf', available: editorAvailable(EDITORS.windsurf) },
  ];
}

function launch(cmd, args) {
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/** Custom tool from Settings: a .app bundle or an executable that takes the folder as its argument. */
function openCustom(tool, abs) {
  if (!tool || !path.isAbsolute(tool) || !fs.existsSync(tool)) throw new Error('Set a valid path under Settings → General.');
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

/** Peel trailing `{ __root }` so ops stay pinned to the tab that started them. */
function takePinnedRoot(args) {
  const last = args[args.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last) && typeof last.__root === 'string') {
    return { root: tabRoot(last.__root), args: args.slice(0, -1) };
  }
  return { root: activePath(), args };
}

async function withRoot(fn, ...args) {
  const { root, args: rest } = takePinnedRoot(args);
  if (!root) throw new Error('No repository open.');
  return fn(root, ...rest);
}

ipcMain.handle('lane.create', (_e, ...args) => withRoot((root, p) => {
  const prefs = getPrefs(prefsDir());
  const lanesFolder = expandHome(prefs.repoOverrides?.[root]?.lanesFolder || prefs.defaultLanesFolder);
  return ops.createLane(root, { ...p, lanesFolder });
}, ...args));
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
    throw new Error('No git credential helper set. Run: git config --global credential.helper osxkeychain');
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
ipcMain.handle('lane.remove', (_e, ...args) => withRoot(async (root, idx, opts) => {
  const lane = (await loadBoard(root)).lanes.find((l) => l.index === idx);
  const board = await ops.removeLane(root, idx, opts);
  if (lane) undo.rememberLane(root, lane);
  return board;
}, ...args));
ipcMain.handle('lane.commit', (_e, ...args) => withRoot(ops.commitLane, ...args));
ipcMain.handle('lane.revert', (_e, ...args) => withRoot(ops.revertLaneChanges, ...args));
ipcMain.handle('lane.push', (_e, ...args) => withRoot(ops.pushLane, ...args));
ipcMain.handle('lane.pull', (_e, ...args) => withRoot(ops.pullLane, ...args));
ipcMain.handle('lane.rebase', async (_e, ...args) => {
  try {
    return await withRoot(ops.rebaseLane, ...args);
  } catch (e) {
    if (e.code === 'CONFLICT') return { conflict: true, conflicts: e.conflicts, operation: e.operation, conflictRoot: e.conflictRoot };
    throw e;
  }
});
ipcMain.handle('branch.checkout', (_e, ...args) => withRoot((root, payload) => ops.checkoutBranch(root, payload || {}), ...args));
ipcMain.handle('branch.update', (_e, ...args) => withRoot((root, payload) => ops.updateBranchFromRemote(root, payload || {}), ...args));
ipcMain.handle('branch.push', (_e, ...args) => withRoot((root, payload) => ops.pushBranchToRemote(root, payload || {}), ...args));
ipcMain.handle('branch.rename', (_e, ...args) => withRoot(ops.renameBranch, ...args));
ipcMain.handle('branch.delete', (_e, ...args) => withRoot(ops.deleteBranch, ...args));
ipcMain.handle('lane.merge', async (_e, ...args) => {
  try {
    return await withRoot(ops.mergeLaneIntoMain, ...args);
  } catch (e) {
    if (e.code === 'CONFLICT') {
      return { conflict: true, conflicts: e.conflicts, operation: e.operation, conflictRoot: e.conflictRoot };
    }
    throw e;
  }
});
ipcMain.handle('lane.conflicts', (_e, ...args) => withRoot(ops.conflictStatus, ...args));
ipcMain.handle('lane.conflictStage', (_e, ...args) => withRoot(ops.conflictStage, ...args));
ipcMain.handle('lane.conflictContinue', (_e, ...args) => withRoot(ops.conflictContinue, ...args));
ipcMain.handle('lane.conflictAbort', (_e, ...args) => withRoot(ops.conflictAbort, ...args));
ipcMain.handle('lane.stash', (_e, ...args) => withRoot(ops.stashLane, ...args));
ipcMain.handle('lane.stashPop', (_e, ...args) => withRoot(ops.stashPopLane, ...args));
ipcMain.handle('lane.stashShow', (_e, ...args) => withRoot(ops.stashShow, ...args));
ipcMain.handle('lane.up', (_e, ...args) => withRoot(async (root, idx, opts) => {
  try {
    await supervisor.up(root, idx, opts);
    return loadBoard(root);
  } catch (e) {
    if (e.code === 'DRIFT') return { drift: true, pending: e.pending ?? [] };
    throw e;
  }
}, ...args));
ipcMain.handle('lane.down', (_e, ...args) => withRoot(async (root, idx) => {
  await supervisor.down(root, idx);
  return loadBoard(root);
}, ...args));
ipcMain.handle('lane.status', (_e, ...args) => withRoot((root, idx) => supervisor.getProc(root, idx), ...args));
ipcMain.handle('lane.test', (_e, ...args) => withRoot(async (root, idx) => {
  await supervisor.test(root, idx);
  return loadBoard(root);
}, ...args));
ipcMain.handle('commit.changes', (_e, ...args) => withRoot(loadCommitChanges, ...args));
ipcMain.handle('file.diff', (_e, ...args) => withRoot(loadFileDiff, ...args));
ipcMain.handle('file.workingDiff', async (_e, filePath, cwdArg, pin) => {
  const root = (pin && pin.__root) ? tabRoot(pin.__root) : activePath();
  if (!root) throw new Error('No repository open.');
  const cwd = path.resolve(String(cwdArg || root));
  const board = await loadBoard(root);
  if (!board.lanes.some((l) => path.resolve(l.path) === cwd) && cwd !== path.resolve(root)) {
    throw new Error('Not an open worktree.');
  }
  return loadWorkingDiff(cwd, filePath);
});
ipcMain.handle('file.workingShow', async (_e, filePath, cwdArg, pin) => {
  const root = (pin && pin.__root) ? tabRoot(pin.__root) : activePath();
  if (!root) throw new Error('No repository open.');
  const cwd = path.resolve(String(cwdArg || root));
  const board = await loadBoard(root);
  if (!board.lanes.some((l) => path.resolve(l.path) === cwd) && cwd !== path.resolve(root)) {
    throw new Error('Not an open worktree.');
  }
  return loadWorkingShow(cwd, filePath);
});
ipcMain.handle('file.history', (_e, ...args) => withRoot(loadFileHistory, ...args));
ipcMain.handle('file.blame', (_e, ...args) => withRoot(loadFileBlame, ...args));
ipcMain.handle('file.show', (_e, ...args) => withRoot(loadFileShow, ...args));
