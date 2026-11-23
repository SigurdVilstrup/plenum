#!/usr/bin/env node
/*
 * Launch the packaged Plenum.app briefly and fail on main-process module errors.
 *
 *   node pack-launch-smoke.mjs [--path <repo>] [--app <Plenum.app>] [--ms 8000] [--json]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { die, findPlenumApp, repoRootFrom } from './_lib.mjs';

const USAGE = `Usage: node pack-launch-smoke.mjs [--path <repo>] [--app <Plenum.app>] [--ms 8000] [--json]
`;

const FATAL_RE =
  /ERR_MODULE_NOT_FOUND|Cannot find module|Uncaught Exception|Error: Cannot find package/i;

function parseArgs(argv) {
  const out = { path: null, app: null, ms: 8000, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--ms') out.ms = Number(argv[++i]) || 8000;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else die(`Unknown arg: ${a}\n${USAGE}`);
  }
  return out;
}

function macBinary(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'Plenum');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (process.platform !== 'darwin') {
    die('pack-launch-smoke only runs on macOS');
  }

  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const appPath = opts.app || findPlenumApp(repoRoot);
  if (!appPath || !fs.existsSync(appPath)) {
    die('No Plenum.app under release/ — run npm run pack first (or pass --app)');
  }
  const bin = macBinary(appPath);
  if (!fs.existsSync(bin)) die(`Missing binary: ${bin}`);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-smoke-'));
  const log = { stdout: '', stderr: '' };
  let exited = null;

  const child = spawn(bin, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      // Point updater at a black hole so smoke never phones home.
      PLENUM_UPDATE_FEED_URL: 'http://127.0.0.1:9/plenum-smoke/',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (buf) => {
    log.stdout += buf.toString('utf8');
  });
  child.stderr.on('data', (buf) => {
    log.stderr += buf.toString('utf8');
  });
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  const started = Date.now();
  const timer = setInterval(() => {
    const combined = `${log.stdout}\n${log.stderr}`;
    if (FATAL_RE.test(combined)) {
      clearInterval(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(false, `Fatal main-process log while launching:\n${combined.trim().slice(-1200)}`);
      return;
    }
    if (exited) {
      clearInterval(timer);
      const early = Date.now() - started < opts.ms;
      finish(
        !early && exited.code === 0,
        early
          ? `Packaged app exited after ${Date.now() - started}ms (code=${exited.code}, signal=${exited.signal})`
          : `Exited after smoke window (code=${exited.code})`,
      );
      return;
    }
    if (Date.now() - started >= opts.ms) {
      clearInterval(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        finish(true, `Stayed up ≥${opts.ms}ms without module errors`);
      }, 500);
    }
  }, 200);

  function finish(ok, detail) {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const report = { ok, app: appPath, detail, ms: opts.ms };
    if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else console.log(`${ok ? '✓' : '✗'} pack-launch-smoke: ${detail}`);
    process.exit(ok ? 0 : 2);
  }
}

main();
