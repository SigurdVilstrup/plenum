import { execFile } from 'node:child_process';
import path from 'node:path';

// #89 which agent CLIs are working in a lane: agent processes whose cwd sits inside the worktree.
// ponytail: CLI agents only; in-editor agents (Cursor chat, Copilot) share the editor's cwd and stay invisible.
const AGENT_BINS = {
  claude: 'Claude',
  codex: 'Codex',
  'cursor-agent': 'Cursor',
  gemini: 'Gemini',
  aider: 'Aider',
  opencode: 'OpenCode',
};
const BIN_RE = new RegExp(`(?:^|/)(${Object.keys(AGENT_BINS).join('|')})$`);

/** Agent label for a `ps -o args=` line, or null. Looks only at the command before its first flag. */
export function agentFromArgs(args) {
  // Cursor's editor keeps a cursor-agent worker alive per open project: that's "editor open", not "agent working".
  if (String(args || '').includes('cursor-agent-worker')) return null;
  const cmd = String(args || '').split(' -')[0].trim();
  // `node /path/to/codex` → check the script too; `claude` / `/…/bin/cursor-agent` → the binary.
  for (const part of [cmd, cmd.replace(/^\S*\bnode\s+/, '')]) {
    const m = part.match(BIN_RE);
    if (m) return AGENT_BINS[m[1]];
  }
  return null;
}

/** `lsof -Fpn` output → Map(pid → cwd). */
export function parseLsofCwd(out) {
  const cwds = new Map();
  let pid = null;
  for (const line of String(out || '').split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** Agent labels whose cwd is the lane path or below it. Nested lanes (.worktrees/x) don't count for the parent. */
export function agentsInLane(lanePath, agents, lanePaths = []) {
  const root = path.resolve(lanePath);
  const nested = lanePaths.map((p) => path.resolve(p)).filter((p) => p !== root && p.startsWith(root + path.sep));
  const within = (dir, base) => dir === base || dir.startsWith(base + path.sep);
  const names = agents
    .filter(({ cwd }) => {
      const dir = path.resolve(cwd);
      return within(dir, root) && !nested.some((n) => within(dir, n));
    })
    .map(({ name }) => name);
  return [...new Set(names)].sort();
}

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err && !out ? '' : String(out || '')));
});

let cache = { at: 0, agents: Promise.resolve([]) };

/** Running agent CLIs with their cwd. Shared across tabs for 3s (every warm tab polls the board). */
export function runningAgents(now = Date.now()) {
  if (now - cache.at < 3000) return cache.agents;
  cache = {
    at: now,
    agents: (async () => {
      if (process.platform === 'win32') return [];
      const byPid = new Map();
      for (const line of (await run('ps', ['-axo', 'pid=,args='])).split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/);
        const name = m && agentFromArgs(m[2]);
        if (name) byPid.set(Number(m[1]), name);
      }
      if (!byPid.size) return [];
      const cwds = parseLsofCwd(await run('lsof', ['-nP', '-a', '-p', [...byPid.keys()].join(','), '-d', 'cwd', '-Fpn']));
      return [...cwds].map(([pid, cwd]) => ({ pid, name: byPid.get(pid), cwd }));
    })().catch(() => []),
  };
  return cache.agents;
}
