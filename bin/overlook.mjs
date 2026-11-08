#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { doctor } from '../electron/lane/doctor.mjs';
import { up, down, test as runTest, getProc } from '../electron/lane/supervisor.mjs';
import { loadBoard } from '../electron/git/board.mjs';
import { createLane, removeLane } from '../electron/git/ops.mjs';

const USAGE = `Usage:
  overlook doctor [path]
  overlook status [path]
  overlook up <lane> [--force]
  overlook down <lane>
  overlook test <lane>
  overlook create <name>
  overlook remove <lane>
  overlook mcp

Options:
  --json    print JSON
  --force   skip drift gate on up
`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = argv.slice(2);
  let json = false;
  let force = false;
  const positional = [];
  for (const a of args) {
    if (a === '--json') json = true;
    else if (a === '--force') force = true;
    else if (a === '--help' || a === '-h') positional.push('help');
    else positional.push(a);
  }
  const [cmd, ...rest] = positional;
  return { cmd: cmd || null, rest, json, force };
}

function laneIndex(raw) {
  if (raw == null || raw === '') throw new Error('lane index required');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid lane index: ${raw}`);
  return n;
}

function repoPath(raw) {
  return path.resolve(raw || process.cwd());
}

function printHuman(cmd, data) {
  if (cmd === 'doctor') {
    for (const f of data.findings) console.log(`- ${f}`);
    console.log('');
    process.stdout.write(data.proposedYaml);
    console.log(data.canAccept ? '(can accept)' : '(cannot accept yet)');
    return;
  }
  if (cmd === 'status') {
    console.log(`${data.repoName}  team=${data.teamBranch}`);
    for (const lane of data.lanes) {
      const run = lane.runnable
        ? (lane.running ? `running pid=${lane.pid ?? '?'}` : 'stopped')
        : 'protected';
      console.log(`  [${lane.index}] ${lane.name}  ${lane.readiness}  ${run}`);
    }
    return;
  }
  if (cmd === 'up' || cmd === 'down') {
    if (!data) {
      console.log('not running');
      return;
    }
    console.log(`${cmd} lane=${data.laneIndex} pid=${data.pid} running=${data.running}`);
    for (const [name, url] of Object.entries(data.urls || {})) console.log(`  ${name}: ${url}`);
    return;
  }
  if (cmd === 'test') {
    console.log(`ok=${data.ok} code=${data.code}`);
    for (const line of data.log || []) console.log(line);
    return;
  }
  if (cmd === 'create' || cmd === 'remove') {
    console.log(`${data.repoName}: ${data.lanes.length} lane(s)`);
    for (const lane of data.lanes) console.log(`  [${lane.index}] ${lane.name}`);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

/** @param {string[]} argv */
export async function main(argv = process.argv) {
  const { cmd, rest, json, force } = parseArgs(argv);
  if (!cmd || cmd === 'help') {
    process.stdout.write(USAGE);
    if (!cmd) throw Object.assign(new Error('command required'), { exitCode: 2 });
    return null;
  }

  if (cmd === 'mcp') {
    const { startStdio } = await import('../electron/mcp/server.mjs');
    startStdio();
    return null;
  }

  let out;
  switch (cmd) {
    case 'doctor':
      out = await doctor(repoPath(rest[0]));
      break;
    case 'status': {
      const board = await loadBoard(repoPath(rest[0]));
      // attach pid from getProc for human status (board.running is boolean only)
      out = {
        ...board,
        lanes: board.lanes.map((lane) => {
          const proc = getProc(board.root, lane.index);
          return { ...lane, pid: proc?.pid };
        }),
      };
      break;
    }
    case 'up':
      out = await up(repoPath(rest[1]), laneIndex(rest[0]), force ? { force: true } : {});
      break;
    case 'down':
      out = await down(repoPath(rest[1]), laneIndex(rest[0]));
      break;
    case 'test':
      out = await runTest(repoPath(rest[1]), laneIndex(rest[0]));
      break;
    case 'create':
      if (!rest[0]) throw new Error('name required');
      out = await createLane(repoPath(rest[1]), { name: rest[0] });
      break;
    case 'remove':
      out = await removeLane(repoPath(rest[1]), laneIndex(rest[0]));
      break;
    default:
      throw Object.assign(new Error(`unknown command: ${cmd}`), { exitCode: 2 });
  }

  if (json) console.log(JSON.stringify(out));
  else printHuman(cmd, out);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv).catch((err) => {
    console.error(err.message || err);
    process.exit(err.exitCode || 1);
  });
}
