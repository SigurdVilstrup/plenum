import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  launcherPath,
  manPagePath,
  launcherScript,
  ensureLauncher,
  ensureManPage,
  pathStatus,
  linkOnPath,
} from './launcher.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-launcher-'));
const unix = process.platform !== 'win32';

test('script quotes paths with spaces and quotes', () => {
  const s = launcherScript({ execPath: "/Applications/Plenum Beta.app/Contents/MacOS/Plenum", cliPath: "/Users/o'neil/app/bin/plenum.mjs", platform: 'darwin' });
  assert.equal(s, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Applications/Plenum Beta.app/Contents/MacOS/Plenum' '/Users/o'\\''neil/app/bin/plenum.mjs' "$@"\n`);
});

test('windows launcher is a .cmd that sets ELECTRON_RUN_AS_NODE', () => {
  const s = launcherScript({
    execPath: 'C:\\Program Files\\Plenum\\Plenum.exe',
    cliPath: 'C:\\Program Files\\Plenum\\resources\\app.asar\\bin\\plenum.mjs',
    platform: 'win32',
  });
  assert.match(s, /@echo off/);
  assert.match(s, /set ELECTRON_RUN_AS_NODE=1/);
  assert.match(s, /"C:\\Program Files\\Plenum\\Plenum\.exe"/);
  assert.equal(launcherPath('/tmp/home', 'win32'), path.join('/tmp/home', 'bin', 'plenum.cmd'));
});

test('the written launcher actually runs, from a folder with a space', () => {
  if (!unix) return; // Windows .cmd + execFileSync EINVAL with spaces; covered by script unit test.
  const dir = tmp();
  const home = path.join(dir, 'has space');
  const cliPath = path.join(dir, 'cli.mjs');
  fs.writeFileSync(cliPath, "console.log(process.argv.slice(2).join(','));\n");
  ensureLauncher({ packaged: true, execPath: process.execPath, cliPath, home, platform: 'darwin' });
  const p = launcherPath(home, 'darwin');
  assert.equal(execFileSync(p, ['a b', 'c'], { encoding: 'utf8' }).trim(), 'a b,c');
  assert.ok(fs.statSync(p).mode & 0o111);
});

test('dev run does not overwrite an existing launcher; packaged does', () => {
  const home = tmp();
  const args = { execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home, platform: 'darwin' };
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(launcherPath(home, 'darwin'), 'OLD');
  assert.equal(ensureLauncher({ ...args, packaged: false }).written, false);
  assert.equal(fs.readFileSync(launcherPath(home, 'darwin'), 'utf8'), 'OLD');
  assert.equal(ensureLauncher({ ...args, packaged: true }).written, true);
  assert.ok(fs.readFileSync(launcherPath(home, 'darwin'), 'utf8').startsWith('#!/bin/sh'));
});

test('dev run writes a launcher when none exists', () => {
  const home = tmp();
  const r = ensureLauncher({ packaged: false, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home, platform: 'darwin' });
  assert.equal(r.written, true);
  assert.equal(r.path, launcherPath(home, 'darwin'));
  assert.ok(fs.existsSync(r.path));
});

test('pathStatus: false when nothing is linked, true when a symlink resolves to the launcher', () => {
  if (!unix) return;
  const home = tmp();
  const bin = tmp();
  const link = path.join(bin, 'plenum');
  ensureLauncher({ packaged: true, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home, platform: 'darwin' });
  assert.equal(pathStatus(home, [link], 'darwin').onPath, false);
  fs.symlinkSync(launcherPath(home, 'darwin'), link);
  assert.equal(pathStatus(home, [link], 'darwin').onPath, true);
  assert.equal(pathStatus(home, undefined, 'darwin').linkPath, '/usr/local/bin/plenum');
});

test('pathStatus: a symlink to something else is not on path', () => {
  if (!unix) return;
  const home = tmp();
  const bin = tmp();
  const other = path.join(bin, 'other');
  fs.writeFileSync(other, 'x');
  fs.symlinkSync(other, path.join(bin, 'plenum'));
  assert.equal(pathStatus(home, [path.join(bin, 'plenum')], 'darwin').onPath, false);
});

test('ensureManPage writes under share/man; skipped on Windows', () => {
  const home = tmp();
  assert.deepEqual(ensureManPage({ packaged: true, home, platform: 'win32' }), { path: null, written: false });
  const r = ensureManPage({ packaged: true, home, platform: 'darwin' });
  assert.equal(r.written, true);
  assert.equal(r.path, manPagePath(home));
  assert.ok(fs.readFileSync(r.path, 'utf8').includes('.TH PLENUM'));
  assert.equal(ensureManPage({ packaged: false, home, platform: 'darwin' }).written, false);
});

test('linkOnPath links when writable, installs man page, and returns sudo when not', () => {
  if (!unix) return;
  const home = tmp();
  ensureLauncher({ packaged: true, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home, platform: 'darwin' });
  ensureManPage({ packaged: true, home, platform: 'darwin' });
  const link = path.join(tmp(), 'plenum');
  const systemMan = path.join(tmp(), 'share', 'man', 'man1', 'plenum.1');
  assert.deepEqual(linkOnPath(home, link, 'darwin', systemMan), { ok: true });
  assert.equal(fs.realpathSync(link), fs.realpathSync(launcherPath(home, 'darwin')));
  assert.ok(fs.existsSync(systemMan));
  assert.equal(fs.readFileSync(systemMan, 'utf8'), fs.readFileSync(manPagePath(home), 'utf8'));

  const bad = path.join(tmp(), 'missing-dir', 'plenum');
  const r = linkOnPath(home, bad, 'darwin', systemMan);
  assert.equal(r.ok, false);
  assert.equal(
    r.command,
    [
      `sudo mkdir -p '${path.dirname(bad)}'`,
      `sudo ln -sf '${launcherPath(home, 'darwin')}' '${bad}'`,
      `sudo mkdir -p '${path.dirname(systemMan)}'`,
      `sudo cp '${manPagePath(home)}' '${systemMan}'`,
    ].join(' && '),
  );
});

test('linkOnPath command quotes the launcher path', () => {
  if (!unix) {
    const home = path.join(tmp(), "o'neil");
    const r = linkOnPath(home, undefined, 'win32');
    assert.equal(r.ok, false);
    assert.match(r.command, /PATH/i);
    return;
  }
  const home = path.join(tmp(), "o'neil");
  ensureLauncher({ packaged: true, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home, platform: 'darwin' });
  ensureManPage({ packaged: true, home, platform: 'darwin' });
  const r = linkOnPath(home, path.join(tmp(), 'nope', 'plenum'), 'darwin');
  assert.ok(r.command.includes(`'${home.replace(/'/g, `'\\''`)}/bin/plenum'`));
  assert.ok(r.command.includes('plenum.1'));
});

test('windows linkOnPath asks to add ~/.plenum/bin to PATH', () => {
  const home = tmp();
  ensureLauncher({ packaged: true, execPath: 'C:\\Plenum\\Plenum.exe', cliPath: 'C:\\Plenum\\cli.mjs', home, platform: 'win32' });
  const r = linkOnPath(home, undefined, 'win32');
  assert.equal(r.ok, false);
  assert.equal(r.windows, true);
  assert.match(r.command, /PATH/i);
});
