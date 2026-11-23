#!/usr/bin/env node
/*
 * Draft a squash commit message for a feature lane. Does not merge.
 *
 *   node scripts/squash-draft.mjs [lane] [--path <repo>] [--check]
 *
 * Prints a suggested subject + body. With --check, also runs commit-msg-check.
 * Always ask the user before squash-merging.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  die,
  findLane,
  git,
  plenum,
  repoRootFrom,
} from './_lib.mjs';

const USAGE = `Usage: node squash-draft.mjs [lane] [--path <repo>] [--check]
`;

function parseArgs(argv) {
  const out = { lane: null, path: null, check: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--check') out.check = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.lane = rest[0] ?? null;
  return out;
}

function featureLabel(lane) {
  const fromBranch = String(lane.branch || '').replace(/^feat\//, '');
  return fromBranch || lane.name || 'feature';
}

function draftMessage(lane, teamBranch, commits) {
  const label = featureLabel(lane);
  const pretty = label.replace(/[-_]/g, ' ');
  const lines = [
    `Add ${pretty}`,
    '',
    `Feature added: ${pretty}.`,
    '',
  ];
  if (commits.length) {
    lines.push('Includes:');
    for (const c of commits.slice(0, 30)) lines.push(`- ${c}`);
    if (commits.length > 30) lines.push(`- …and ${commits.length - 30} more`);
    lines.push('');
  }
  lines.push(`Squashed from lane [${lane.index}] ${lane.name} (${lane.branch}) onto ${teamBranch}.`);
  return lines.join('\n');
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
  if (lane.isPrimary) die('Protected lane has nothing to squash-merge as a feature.');

  const team = board.teamBranch || 'main';
  const range = `${team}..HEAD`;
  let commits = [];
  try {
    const log = git(lane.path, ['log', '--reverse', '--format=%s', range]);
    commits = log ? log.split('\n').filter(Boolean) : [];
  } catch {
    commits = [];
  }

  const message = draftMessage(lane, team, commits);
  process.stdout.write(message.endsWith('\n') ? message : `${message}\n`);
  console.error('');
  console.error(`Draft only — ${commits.length} commit(s) on ${range}. Ask before squash-merging.`);

  if (opts.check) {
    const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commit-msg-check.mjs');
    const checked = spawnSync(process.execPath, [checker, '--stdin'], {
      input: message,
      encoding: 'utf8',
      cwd: repoRoot,
    });
    if (checked.stdout) console.error(checked.stdout.trimEnd());
    if (checked.stderr) console.error(checked.stderr.trimEnd());
    if (checked.status && checked.status !== 0) process.exit(checked.status);
  }
}

try {
  main();
} catch (err) {
  die(err.message || err, err.exitCode || 1);
}
