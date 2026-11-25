#!/usr/bin/env node
/**
 * Minimal MCP stdio JSON-RPC server (newline-delimited).
 * Tools: PRODUCT table only - no git commit/push.
 */
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { manifestPath } from '../paths.mjs';
import { doctor, acceptManifest } from '../lane/doctor.mjs';
import { up, down, test as runTest } from '../lane/supervisor.mjs';
import { loadBoard } from '../git/board.mjs';
import { createLane, removeLane } from '../git/ops.mjs';
import { getAgentSettings } from '../agents/settings.mjs';
import { refusal } from '../agents/gate.mjs';

const PROTOCOL = '2024-11-05';
const SERVER_INFO = { name: 'plenum', version: '0.1.0' };

const TOOLS = [
  {
    name: 'repo.doctor',
    description:
      'Scan the repo and propose a lane manifest plus an agentPrompt. Always read agentPrompt after this call — the recipe alone does not make parallel lanes work; follow the prompt to wire the app (env vars with non-Plenum defaults). Writes nothing unless write is true, and then only when the repo has no lane.yaml yet.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo root (default: cwd)' },
        write: { type: 'boolean', description: 'Write the proposed lane.yaml (only if none exists and the user allows it)' },
      },
    },
  },
  {
    name: 'lane.create',
    description: 'Create a feature lane (worktree + setup + env copy).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Feature name' },
        path: { type: 'string', description: 'Repo root (default: cwd)' },
        base: { type: 'string', description: 'Branch name (default: feat/<name>)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lane.up',
    description: 'Start the lane run command under the supervisor.',
    inputSchema: {
      type: 'object',
      properties: {
        lane: { type: ['integer', 'string'], description: 'Lane index' },
        path: { type: 'string', description: 'Repo root (default: cwd)' },
        force: { type: 'boolean', description: 'Not available to agents: a forced start is always refused. Ask the user to start the lane from the Plenum board.' },
      },
      required: ['lane'],
    },
  },
  {
    name: 'lane.down',
    description: 'Stop the lane processes.',
    inputSchema: {
      type: 'object',
      properties: {
        lane: { type: ['integer', 'string'], description: 'Lane index' },
        path: { type: 'string', description: 'Repo root (default: cwd)' },
      },
      required: ['lane'],
    },
  },
  {
    name: 'lane.test',
    description: 'Run the lane test command.',
    inputSchema: {
      type: 'object',
      properties: {
        lane: { type: ['integer', 'string'], description: 'Lane index' },
        path: { type: 'string', description: 'Repo root (default: cwd)' },
      },
      required: ['lane'],
    },
  },
  {
    name: 'lane.status',
    description: 'Board JSON for every worktree.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo root (default: cwd)' } },
    },
  },
  {
    name: 'lane.remove',
    description: 'Remove a lane worktree. Refuses when the lane is not safe to remove.',
    inputSchema: {
      type: 'object',
      properties: {
        lane: { type: ['integer', 'string'], description: 'Lane index' },
        path: { type: 'string', description: 'Repo root (default: cwd)' },
        force: { type: 'boolean', description: 'Not available to agents: a forced remove is always refused. Ask the user to remove an unsafe lane from the Plenum board.' },
      },
      required: ['lane'],
    },
  },
];

export function toolNames() {
  return TOOLS.map((t) => t.name);
}

function repoPath(raw) {
  return path.resolve(raw || process.cwd());
}

function laneIndex(raw) {
  if (raw == null || raw === '') throw new Error('lane required');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid lane: ${raw}`);
  return n;
}

function textResult(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: err?.message || String(err) }],
  };
}

/** @param {string} name @param {Record<string, unknown>} [args] */
export async function callTool(name, args = {}) {
  const refused = refusal(name, args, getAgentSettings());
  if (refused) throw new Error(refused);
  switch (name) {
    case 'repo.doctor': {
      const root = repoPath(args.path);
      const result = await doctor(root);
      if (!args.write) return textResult(result);
      if (fs.existsSync(manifestPath(root))) {
        throw new Error('Refused: this repo already has lane setup. Agents can create it but not replace it; the user edits .plenum/lane.yaml themselves.');
      }
      if (!result.canAccept) {
        throw new Error(`Can't write lane setup yet:\n${result.findings.join('\n')}`);
      }
      await acceptManifest(root, result.proposedYaml, { createOnly: true });
      return textResult({ ...result, written: manifestPath(root) });
    }
    case 'lane.create': {
      if (!args.name) throw new Error('name required');
      return textResult(await createLane(repoPath(args.path), {
        name: String(args.name),
        branch: args.base != null ? String(args.base) : undefined,
      }));
    }
    case 'lane.up':
      return textResult(await up(
        repoPath(args.path),
        laneIndex(args.lane),
        args.force ? { force: true } : {},
      ));
    case 'lane.down':
      return textResult(await down(repoPath(args.path), laneIndex(args.lane)));
    case 'lane.test':
      return textResult(await runTest(repoPath(args.path), laneIndex(args.lane)));
    case 'lane.status':
      return textResult(await loadBoard(repoPath(args.path)));
    case 'lane.remove':
      return textResult(await removeLane(
        repoPath(args.path),
        laneIndex(args.lane),
        args.force ? { force: true } : {},
      ));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/** Handle one JSON-RPC request object. Returns response or null for notifications. */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;

  // notifications have no id
  if (id === undefined) return null;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        const result = await callTool(name, args);
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        return { jsonrpc: '2.0', id, result: errorResult(err) };
      }
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err?.message || String(err) },
    };
  }
}

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** Start newline-delimited JSON-RPC over stdin/stdout. */
export function startStdio() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      write({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      });
      return;
    }
    Promise.resolve(handleMessage(msg))
      .then((res) => { if (res) write(res); })
      .catch((err) => {
        process.stderr.write(`${err?.message || err}\n`);
        if (msg.id !== undefined) {
          write({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: err?.message || String(err) },
          });
        }
      });
  });
}
