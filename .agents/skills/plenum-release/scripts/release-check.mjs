#!/usr/bin/env node
/*
 * Pre-release gates for Plenum. Never tag/push a release if this exits non-zero.
 *
 * Invariant: the build must keep OTA self-heal alive (launch + updater + feed
 * wiring). A build that cannot update itself cannot be fixed over the air.
 *
 *   node release-check.mjs [--path <repo>] [--skip-test] [--skip-pack] [--skip-launch] [--json]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, findPlenumApp, repoRootFrom, run } from './_lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `Usage: node release-check.mjs [--path <repo>] [--skip-test] [--skip-pack] [--skip-launch] [--json]
`;

function parseArgs(argv) {
  const out = {
    path: null,
    skipTest: false,
    skipPack: false,
    skipLaunch: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--skip-test') out.skipTest = true;
    else if (a === '--skip-pack') out.skipPack = true;
    else if (a === '--skip-launch') out.skipLaunch = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else die(`Unknown arg: ${a}\n${USAGE}`);
  }
  return out;
}

function gateFromScript(id, script, args, cwd) {
  const r = run(process.execPath, [script, ...args], { cwd });
  const ok = r.status === 0;
  const detail = (r.stdout || r.stderr || `exit ${r.status}`).trim().slice(-800);
  return { id, ok, detail, status: r.status };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const report = { repoRoot, gates: [] };
  let failed = false;

  const push = (g) => {
    report.gates.push(g);
    if (!g.ok) failed = true;
    if (!opts.json) console.log(`${g.ok ? '✓' : '✗'} ${g.id}: ${g.detail.split('\n')[0]}`);
  };

  // Dirty tree is a warning for agents, not a hard fail — release may include a version bump.
  const status = run('git', ['status', '--porcelain'], { cwd: repoRoot });
  push({
    id: 'git-status',
    ok: true,
    detail: (status.stdout || '').trim()
      ? `Working tree has local changes:\n${status.stdout.trim()}`
      : 'Working tree clean',
  });

  if (!opts.skipTest) {
    console.log('… npm test');
    const npm = run('npm', ['test'], { cwd: repoRoot });
    push({
      id: 'npm-test',
      ok: npm.status === 0,
      detail:
        npm.status === 0
          ? 'npm test passed'
          : (npm.stderr || npm.stdout || `exit ${npm.status}`).trim().slice(-500),
    });
    if (npm.status !== 0) {
      finish(report, true, opts.json);
      return;
    }
  }

  if (!opts.skipPack) {
    console.log('… npm run pack (unsigned dir build)');
    const pack = run('npm', ['run', 'pack'], { cwd: repoRoot });
    push({
      id: 'npm-pack',
      ok: pack.status === 0,
      detail:
        pack.status === 0
          ? 'npm run pack succeeded'
          : (pack.stderr || pack.stdout || `exit ${pack.status}`).trim().slice(-500),
    });
    if (pack.status !== 0) {
      finish(report, true, opts.json);
      return;
    }
  }

  const app = findPlenumApp(repoRoot);
  if (!app) {
    push({ id: 'find-app', ok: false, detail: 'No Plenum.app under release/' });
    finish(report, true, opts.json);
    return;
  }
  push({ id: 'find-app', ok: true, detail: app });

  const importsScript = path.join(HERE, 'pack-imports-check.mjs');
  push(gateFromScript('pack-imports', importsScript, ['--app', app], repoRoot));

  if (!opts.skipLaunch && process.platform === 'darwin') {
    console.log('… pack-launch-smoke (OTA requires a living process)');
    const launchScript = path.join(HERE, 'pack-launch-smoke.mjs');
    push(gateFromScript('pack-launch', launchScript, ['--app', app, '--ms', '8000'], repoRoot));
  } else if (!opts.skipLaunch) {
    push({ id: 'pack-launch', ok: true, detail: 'Skipped (not macOS)' });
  }

  console.log('… ota-health-check');
  const otaScript = path.join(HERE, 'ota-health-check.mjs');
  push(gateFromScript('ota-health', otaScript, ['--app', app], repoRoot));

  finish(report, failed, opts.json);
}

function finish(report, failed, json) {
  if (json) process.stdout.write(`${JSON.stringify({ ...report, ok: !failed }, null, 2)}\n`);
  else {
    console.log(
      failed
        ? '\nrelease-check FAILED — do not tag or push (OTA self-heal at risk).'
        : '\nrelease-check OK — OTA loop intact; safe to version + tag.',
    );
  }
  process.exit(failed ? 2 : 0);
}

main();
