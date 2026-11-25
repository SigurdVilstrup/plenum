/**
 * Platform-aware editor / terminal / custom-tool launchers.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = () => os.homedir() || process.env.USERPROFILE || process.env.HOME || '';

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local');
}

function programFiles() {
  return process.env.ProgramFiles || 'C:\\Program Files';
}

function resolveOnPath(name) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where.exe', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      return out && fs.existsSync(out) ? out : null;
    }
    const out = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

export function editorsForPlatform(platform = process.platform) {
  const h = home();
  if (platform === 'win32') {
    const la = localAppData();
    const pf = programFiles();
    return {
      cursor: {
        label: 'Cursor',
        cli: [
          path.join(la, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
          path.join(la, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
          'cursor.cmd',
          'cursor',
        ],
        apps: [
          path.join(la, 'Programs', 'cursor', 'Cursor.exe'),
          path.join(la, 'Programs', 'Cursor', 'Cursor.exe'),
        ],
        openArgs: null,
      },
      vscode: {
        label: 'VS Code',
        cli: [
          path.join(la, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
          path.join(pf, 'Microsoft VS Code', 'bin', 'code.cmd'),
          'code.cmd',
          'code',
        ],
        apps: [
          path.join(la, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(pf, 'Microsoft VS Code', 'Code.exe'),
        ],
        openArgs: null,
      },
      zed: {
        label: 'Zed',
        cli: [path.join(la, 'Programs', 'Zed', 'zed.exe'), 'zed'],
        apps: [path.join(la, 'Programs', 'Zed', 'Zed.exe')],
        openArgs: null,
      },
      windsurf: {
        label: 'Windsurf',
        cli: [
          path.join(la, 'Programs', 'Windsurf', 'bin', 'windsurf.cmd'),
          'windsurf.cmd',
          'windsurf',
        ],
        apps: [path.join(la, 'Programs', 'Windsurf', 'Windsurf.exe')],
        openArgs: null,
      },
    };
  }
  return {
    cursor: {
      label: 'Cursor',
      cli: ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor', path.join(h, '.local/bin/cursor')],
      apps: [path.join(h, 'Applications/Cursor.app'), '/Applications/Cursor.app'],
      openArgs: ['-b', 'com.todesktop.230313mzl4w4u92'],
    },
    vscode: {
      label: 'VS Code',
      cli: ['/usr/local/bin/code', '/opt/homebrew/bin/code'],
      apps: [path.join(h, 'Applications/Visual Studio Code.app'), '/Applications/Visual Studio Code.app'],
      openArgs: ['-a', 'Visual Studio Code'],
    },
    zed: {
      label: 'Zed',
      cli: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
      apps: [path.join(h, 'Applications/Zed.app'), '/Applications/Zed.app'],
      openArgs: ['-a', 'Zed'],
    },
    windsurf: {
      label: 'Windsurf',
      cli: [
        '/usr/local/bin/windsurf',
        '/opt/homebrew/bin/windsurf',
        path.join(h, '.local/bin/windsurf'),
        '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
        path.join(h, 'Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'),
      ],
      apps: [path.join(h, 'Applications/Windsurf.app'), '/Applications/Windsurf.app'],
      openArgs: ['-b', 'com.exafunction.windsurf'],
    },
  };
}

export function launch(cmd, args) {
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
    .on('error', () => {})
    .unref();
}

/** #109 only trust a CLI that resolves into this editor's own bundle (when .app). */
export function editorCli(e) {
  for (const p of e.cli) {
    let candidate = p;
    if (!path.isAbsolute(p) && !p.includes('/') && !p.includes('\\')) {
      candidate = resolveOnPath(p) || '';
      if (!candidate) continue;
    }
    let real;
    try { real = fs.realpathSync(candidate); } catch { continue; }
    if (!real.includes('.app/') || e.apps.some((a) => real.startsWith(`${a}/`))) return real;
  }
  return undefined;
}

export function editorAvailable(e) {
  return Boolean(editorCli(e)) || e.apps.some((p) => fs.existsSync(p));
}

export function listEditors(platform = process.platform) {
  const EDITORS = editorsForPlatform(platform);
  return [
    ...Object.entries(EDITORS).map(([id, e]) => ({
      id,
      label: e.label,
      available: editorAvailable(e),
    })),
    { id: 'custom', label: 'Other app…', available: true },
  ];
}

export function fileMergeAvailable(platform = process.platform) {
  if (platform !== 'darwin') return false;
  const h = home();
  const apps = [
    '/Applications/Xcode.app/Contents/Applications/FileMerge.app',
    '/Applications/FileMerge.app',
    path.join(h, 'Applications/FileMerge.app'),
  ];
  const bins = [
    '/Applications/Xcode.app/Contents/Developer/usr/bin/opendiff',
    '/Library/Developer/CommandLineTools/usr/bin/opendiff',
  ];
  return apps.some((p) => fs.existsSync(p)) || bins.some((p) => fs.existsSync(p));
}

export function listDiffMergeTools(platform = process.platform) {
  const EDITORS = editorsForPlatform(platform);
  return [
    { id: 'internal', label: 'Built-in', available: true },
    { id: 'opendiff', label: 'FileMerge', available: fileMergeAvailable(platform) },
    { id: 'vscode', label: 'VS Code', available: editorAvailable(EDITORS.vscode) },
    { id: 'cursor', label: 'Cursor', available: editorAvailable(EDITORS.cursor) },
    { id: 'windsurf', label: 'Windsurf', available: editorAvailable(EDITORS.windsurf) },
  ];
}

export function openCustom(tool, abs, platform = process.platform) {
  if (!tool || !path.isAbsolute(tool) || !fs.existsSync(tool)) {
    throw new Error('Set a valid path under Settings → General.');
  }
  if (platform === 'darwin' && tool.endsWith('.app')) launch('open', ['-a', tool, abs]);
  else launch(tool, [abs]);
}

export function resolveEditor(editorId, platform = process.platform) {
  const EDITORS = editorsForPlatform(platform);
  const wanted = EDITORS[editorId];
  if (wanted && editorAvailable(wanted)) return wanted;
  return Object.values(EDITORS).find(editorAvailable) || wanted || EDITORS.cursor;
}

export function openEditor(abs, { editor, editorPath }, platform = process.platform) {
  if (editor === 'custom') return openCustom(editorPath, abs, platform);
  const e = resolveEditor(editor, platform);
  const cli = editorCli(e);
  if (cli) launch(cli, ['-r', '--', abs]);
  else if (platform === 'darwin' && e.openArgs) launch('open', [...e.openArgs, abs]);
  else if (e.apps.find((p) => fs.existsSync(p))) launch(e.apps.find((p) => fs.existsSync(p)), [abs]);
  else throw new Error(`${e.label} is not installed.`);
}

function findWindowsTerminal() {
  const la = localAppData();
  const candidates = [
    path.join(la, 'Microsoft', 'WindowsApps', 'wt.exe'),
    resolveOnPath('wt.exe'),
    resolveOnPath('wt'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export function openTerminal(abs, { terminal, terminalPath }, platform = process.platform) {
  if (terminal === 'custom') return openCustom(terminalPath, abs, platform);
  if (platform === 'win32') {
    if (terminal === 'cmd') {
      launch('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d ${abs}`]);
      return;
    }
    const wt = findWindowsTerminal();
    if (wt) {
      launch(wt, ['-d', abs]);
      return;
    }
    launch('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d ${abs}`]);
    return;
  }
  launch('open', ['-a', terminal === 'iterm' ? 'iTerm' : 'Terminal', abs]);
}

export function terminalOptions(platform = process.platform) {
  if (platform === 'win32') {
    return [
      ['windows-terminal', 'Windows Terminal'],
      ['cmd', 'Command Prompt'],
      ['custom', 'Other app…'],
    ];
  }
  return [
    ['terminal', 'Terminal'],
    ['iterm', 'iTerm'],
    ['custom', 'Other app…'],
  ];
}

export function defaultTerminalId(platform = process.platform) {
  return platform === 'win32' ? 'windows-terminal' : 'terminal';
}
