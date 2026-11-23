#!/usr/bin/env node
/*
 * Mechanical gates for a feature lane: status, npm test, lane test, avoid-ai-design detect.
 *
 *   node scripts/feature-check.mjs [lane] [--path <repo>] [--skip-test] [--skip-detect] [--json]
 *
 * lane: index or name (default: lane containing cwd). Exit 0 only if all selected gates pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  SKILL_DIR,
  die,
  findLane,
  plenum,
  repoRootFrom,
  run,
} from './_lib.mjs';

const USAGE = `Usage: node feature-check.mjs [lane] [--path <repo>] [--skip-test] [--skip-detect] [--json]
`;

function parseArgs(argv) {
  const out = { lane: null, path: null, skipTest: false, skipDetect: false, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--skip-test') out.skipTest = true;
    else if (a === '--skip-detect') out.skipDetect = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.lane = rest[0] ?? null;
  return out;
}

function detectScript() {
  return path.resolve(SKILL_DIR, '..', 'avoid-ai-design', 'scripts', 'detect.mjs');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const board = plenum(repoRoot, ['status', repoRoot], { json: true });
  const lane = findLane(board, opts.lane);

  const report = {
    repoRoot,
    lane: { index: lane.index, name: lane.name, branch: lane.branch, path: lane.path, readiness: lane.readiness },
    gates: [],
  };

  let failed = false;

  // status gate: feature work should not be on protected
  const statusGate = {
    id: 'lane-surface',
    ok: !lane.isPrimary,
    detail: lane.isPrimary
      ? 'On protected lane — features belong on a feature lane'
      : `On feature lane [${lane.index}] ${lane.name}`,
  };
  report.gates.push(statusGate);
  if (!statusGate.ok) failed = true;

  if (!opts.skipTest) {
    const npm = run('npm', ['test'], { cwd: repoRoot });
    const testGate = {
      id: 'npm-test',
      ok: npm.status === 0,
      detail: npm.status === 0 ? 'npm test passed' : (npm.stderr || npm.stdout || `exit ${npm.status}`).trim().slice(-500),
    };
    report.gates.push(testGate);
    if (!testGate.ok) failed = true;

    if (lane.runnable && !lane.isPrimary) {
      try {
        const out = plenum(repoRoot, ['test', String(lane.index), repoRoot], { json: true });
        report.gates.push({
          id: 'lane-test',
          ok: true,
          detail: typeof out === 'object' ? 'lane test ok' : String(out || 'ok'),
        });
      } catch (err) {
        report.gates.push({
          id: 'lane-test',
          ok: false,
          detail: err.message || String(err),
        });
        failed = true;
      }
    } else {
      report.gates.push({
        id: 'lane-test',
        ok: true,
        detail: 'skipped (not runnable or primary)',
        skipped: true,
      });
    }
  }

  if (!opts.skipDetect) {
    const detect = detectScript();
    const uiRoots = ['app', 'site']
      .map((d) => path.join(lane.path, d))
      .filter((p) => fs.existsSync(p));
    if (!fs.existsSync(detect)) {
      report.gates.push({ id: 'avoid-ai-design', ok: true, skipped: true, detail: 'detect.mjs not found' });
    } else if (!uiRoots.length) {
      report.gates.push({ id: 'avoid-ai-design', ok: true, skipped: true, detail: 'no app/ or site/ in lane' });
    } else {
      const r = run(process.execPath, [detect, ...uiRoots], { cwd: lane.path });
      // detect: 0 clean, 2 findings, 1 error
      const ok = r.status === 0;
      report.gates.push({
        id: 'avoid-ai-design',
        ok,
        detail: ok
          ? 'no P0/P1 code-certain tells'
          : (r.stdout || r.stderr || `exit ${r.status}`).trim().slice(0, 800),
      });
      if (!ok && r.status !== 2) failed = true;
      if (r.status === 2) failed = true;
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...report, ok: !failed }, null, 2));
  } else {
    console.log(`feature-check  lane=[${lane.index}] ${lane.name}  ${lane.path}`);
    for (const g of report.gates) {
      const mark = g.skipped ? '·' : g.ok ? '✓' : '✗';
      console.log(`  ${mark} ${g.id}: ${g.detail}`);
    }
    console.log(failed ? 'FAILED (mechanical only — still do UI/UX/tech + visual pass)' : 'OK (mechanical only — still do UI/UX/tech + visual pass)');
  }

  process.exit(failed ? 2 : 0);
}

try {
  main();
} catch (err) {
  die(err.message || err, err.exitCode || 1);
}
