import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launcherPath, launcherScript, ensureLauncher, pathStatus, linkOnPath } from './launcher.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-launcher-'));

test('script quotes paths with spaces and quotes', () => {
  const s = launcherScript({ execPath: "/Applications/Plenum Beta.app/Contents/MacOS/Plenum", cliPath: "/Users/o'neil/app/bin/plenum.mjs" });
  assert.equal(s, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Applications/Plenum Beta.app/Contents/MacOS/Plenum' '/Users/o'\\''neil/app/bin/plenum.mjs' "$@"\n`);
});

test('the written launcher actually runs, from a folder with a space', () => {
  const dir = tmp();
  const home = path.join(dir, 'has space');
  const cliPath = path.join(dir, 'cli.mjs');
  fs.writeFileSync(cliPath, "console.log(process.argv.slice(2).join(','));\n");
  ensureLauncher({ packaged: true, execPath: process.execPath, cliPath, home });
  const p = launcherPath(home);
  assert.equal(execFileSync(p, ['a b', 'c'], { encoding: 'utf8' }).trim(), 'a b,c');
  assert.ok(fs.statSync(p).mode & 0o111);
});

test('dev run does not overwrite an existing launcher; packaged does', () => {
  const home = tmp();
  const args = { execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home };
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(launcherPath(home), 'OLD');
  assert.equal(ensureLauncher({ ...args, packaged: false }).written, false);
  assert.equal(fs.readFileSync(launcherPath(home), 'utf8'), 'OLD');
  assert.equal(ensureLauncher({ ...args, packaged: true }).written, true);
  assert.ok(fs.readFileSync(launcherPath(home), 'utf8').startsWith('#!/bin/sh'));
});

test('dev run writes a launcher when none exists', () => {
  const home = tmp();
  const r = ensureLauncher({ packaged: false, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home });
  assert.equal(r.written, true);
  assert.equal(r.path, launcherPath(home));
  assert.ok(fs.existsSync(r.path));
});

test('pathStatus: false when nothing is linked, true when a symlink resolves to the launcher', () => {
  const home = tmp();
  const bin = tmp();
  const link = path.join(bin, 'plenum');
  ensureLauncher({ packaged: true, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home });
  assert.equal(pathStatus(home, [link]).onPath, false);
  fs.symlinkSync(launcherPath(home), link);
  assert.equal(pathStatus(home, [link]).onPath, true);
  assert.equal(pathStatus(home).linkPath, '/usr/local/bin/plenum');
});

test('pathStatus: a symlink to something else is not on path', () => {
  const home = tmp();
  const bin = tmp();
  const other = path.join(bin, 'other');
  fs.writeFileSync(other, 'x');
  fs.symlinkSync(other, path.join(bin, 'plenum'));
  assert.equal(pathStatus(home, [path.join(bin, 'plenum')]).onPath, false);
});

test('linkOnPath links when writable, and returns the sudo command when not', () => {
  const home = tmp();
  ensureLauncher({ packaged: true, execPath: '/x/Plenum', cliPath: '/x/plenum.mjs', home });
  const link = path.join(tmp(), 'plenum');
  assert.deepEqual(linkOnPath(home, link), { ok: true });
  assert.equal(fs.realpathSync(link), fs.realpathSync(launcherPath(home)));

  const bad = path.join(tmp(), 'missing-dir', 'plenum');
  const r = linkOnPath(home, bad);
  assert.equal(r.ok, false);
  assert.equal(r.command, `sudo mkdir -p '${path.dirname(bad)}' && sudo ln -sf '${launcherPath(home)}' '${bad}'`);
});

test('linkOnPath command quotes the launcher path', () => {
  const home = path.join(tmp(), "o'neil");
  const r = linkOnPath(home, path.join(tmp(), 'nope', 'plenum'));
  assert.ok(r.command.includes(`'${home.replace(/'/g, `'\\''`)}/bin/plenum'`));
});
