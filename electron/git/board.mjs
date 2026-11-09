import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { git, gitOk } from './run.mjs';
import { loadManifest } from '../lane/manifest.mjs';
import { laneStatus } from '../lane/status.mjs';
import { getProc, getLastTest } from '../lane/supervisor.mjs';
import { assignColumns } from './graph-columns.mjs';

const AGENT_TOOLS = [
  ['claude', 'Claude'],
  ['cursor', 'Cursor'],
  ['copilot', 'Copilot'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Gemini'],
  ['codex', 'Codex'],
  ['devin', 'Devin'],
  ['aider', 'Aider'],
  ['gpt', 'GPT'],
];

function toolName(text) {
  const hay = String(text || '').toLowerCase();
  return AGENT_TOOLS.find(([k]) => hay.includes(k))?.[1] ?? null;
}

export function classifyAuthorship(name, email, body) {
  const keys = ['co-authored-by:', 'made-with:', 'generated-with:', 'assisted-by:'];
  const trailers = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => keys.some((k) => l.toLowerCase().startsWith(k)))
    .map((l) => {
      const lower = l.toLowerCase();
      const key = keys.find((k) => lower.startsWith(k));
      return l.slice(key.length).trim();
    });
  const authorTool = toolName(name) || toolName(email);
  const agentTrailer = trailers.map(toolName).find(Boolean);
  const humanTrailer = trailers.some((t) => !toolName(t));
  if (authorTool && humanTrailer) return { kind: 'mixed', tool: authorTool };
  if (authorTool) return { kind: 'agent', tool: authorTool };
  if (agentTrailer) return { kind: 'assisted', tool: agentTrailer };
  return { kind: 'human', tool: null };
}

function parseWorktrees(text) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur?.path) out.push(cur);
    cur = null;
  };
  for (const line of text.split('\n')) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      cur = { path: line.slice(9), head: '', branch: null };
    } else if (line.startsWith('HEAD ') && cur) {
      cur.head = line.slice(5);
    } else if (line.startsWith('branch ') && cur) {
      const ref = line.slice(7);
      cur.branch = ref.startsWith('refs/heads/') ? ref.slice(11) : ref;
    } else if (line === 'detached' && cur) {
      cur.branch = null;
    }
  }
  flush();
  return out;
}

async function teamBranch(cwd) {
  try {
    const raw = (await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd)).trim();
    if (raw) return raw.startsWith('origin/') ? raw.slice(7) : raw;
  } catch { /* fall through */ }
  for (const c of ['main', 'master', 'develop']) {
    if (await gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${c}`], cwd)
      || await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${c}`], cwd)) {
      return c;
    }
  }
  try {
    const h = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
    return h === 'HEAD' ? 'main' : h;
  } catch {
    return 'main';
  }
}

async function resolveTeamRef(branch, cwd) {
  if (await gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], cwd)) {
    return `origin/${branch}`;
  }
  return branch;
}

async function countRange(range, cwd) {
  try {
    return parseInt((await git(['rev-list', '--count', range], cwd)).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Parse `git status --porcelain` into path + XY code. */
export function parseDirty(text) {
  if (!text) return [];
  return text.split(/\n/).flatMap((line) => {
    const m = /^(..)\s(.*)$/.exec(line);
    if (!m) return [];
    let file = m[2];
    if (file.includes(' -> ')) file = file.slice(file.lastIndexOf(' -> ') + 4);
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    return file ? [{ path: file, code: m[1] }] : [];
  });
}

export function parseNumstat(text) {
  const out = new Map();
  if (!text?.trim()) return out;
  for (const line of text.split(/\n/).filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t');
    if (!rest.length) continue;
    let file = rest.join('\t');
    if (file.includes(' => ')) {
      const right = file.split(' => ').pop();
      file = right.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '');
    }
    const added = a === '-' ? 0 : Number(a) || 0;
    const deleted = d === '-' ? 0 : Number(d) || 0;
    out.set(file, { added, deleted });
  }
  return out;
}

async function enrichDirtyFiles(cwd, files) {
  if (!files.length) return files;
  let stats = new Map();
  try {
    stats = parseNumstat(await git(['diff', '--numstat', 'HEAD'], cwd));
  } catch { /* empty or no HEAD */ }
  return files.map((f) => {
    let s = stats.get(f.path);
    if (!s && f.code === '??') {
      try {
        const raw = fs.readFileSync(path.join(cwd, f.path), 'utf8');
        s = { added: raw.length ? raw.split(/\n/).length : 0, deleted: 0 };
      } catch {
        s = { added: 0, deleted: 0 };
      }
    }
    return { ...f, added: s?.added ?? 0, deleted: s?.deleted ?? 0 };
  });
}

/** Files changed in a commit, with +/- counts. */
export async function loadCommitChanges(repoPath, sha) {
  const cwd = path.resolve(repoPath);
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(id)) throw new Error('Invalid commit.');
  const metaRaw = (await git(['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an', id], cwd)).trim();
  const [full, short, subject, author] = metaRaw.split('\x1f');
  let statusMap = new Map();
  try {
    const ns = await git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-m', '--root', full], cwd);
    for (const line of ns.split(/\n/).filter(Boolean)) {
      const [code, ...paths] = line.split('\t');
      let file = paths[paths.length - 1] || '';
      statusMap.set(file, code.startsWith('R') || code.startsWith('C') ? code[0] : code);
    }
  } catch { /* empty */ }
  let stats = new Map();
  try {
    stats = parseNumstat(await git(['diff-tree', '--no-commit-id', '--numstat', '-r', '-m', '--root', full], cwd));
  } catch { /* empty */ }
  const paths = new Set([...statusMap.keys(), ...stats.keys()]);
  const files = [...paths].filter(Boolean).sort().map((file) => {
    const code = statusMap.get(file) || 'M';
    const s = stats.get(file) || { added: 0, deleted: 0 };
    return { path: file, code, added: s.added, deleted: s.deleted };
  });
  return { sha: full, short, subject, author, files };
}

/** ponytail: cherry misses rewritten squash; upgrade is host PR API.
 *  Empty cherry means "no unique commits" — that is both a fresh lane and a
 *  fully-merged one. Reflog must show real work before we call it merged. */
async function isPatchMerged(branch, teamRef, cwd) {
  try {
    const raw = await git(['cherry', teamRef, branch], cwd);
    const lines = raw.split(/\n/).filter(Boolean);
    if (!lines.every((l) => l.startsWith('-'))) return false;
    if (lines.length > 0) return true;
    const reflog = await git(['reflog', 'show', branch, '--format=%gs'], cwd);
    return reflog.split(/\n/).some((l) => /^(commit|rebase|merge|pull|cherry-pick|reset)/i.test(l));
  } catch {
    return false;
  }
}

async function tipInfo(cwd) {
  try {
    const raw = await git(['log', '-1', '--format=%an%x1f%ae%x1f%b'], cwd);
    const [name, email, body = ''] = raw.split('\x1f');
    const who = classifyAuthorship(name, email, body);
    return { name, ...who };
  } catch {
    return null;
  }
}

async function shaSet(args, cwd) {
  try {
    const raw = await git(args, cwd);
    return new Set(raw.split(/\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}

function ago(unix) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const days = Math.floor(seconds / 86400);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function displayPath(p) {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

function folderLabel(treePath, primary, branch) {
  if (!branch) return displayPath(treePath);
  const primaryDir = path.dirname(primary);
  const obvious = [
    path.join(primary, '.worktrees', branch),
    path.join(primary, branch),
    path.join(primaryDir, branch),
  ];
  if (obvious.includes(treePath)) return null;
  if (treePath.startsWith(primaryDir + path.sep)) return treePath.slice(primaryDir.length + 1);
  return displayPath(treePath);
}

function pills(decoration, team, primaryBranch, laneBranches) {
  if (!decoration?.trim()) return [];
  const parsed = [];
  for (const raw of decoration.split(',')) {
    let name = raw.trim();
    let tag = false;
    if (!name || name === 'HEAD' || name.endsWith('/HEAD')) continue;
    if (name.startsWith('HEAD -> ')) name = name.slice(8);
    if (name === 'HEAD' || name.endsWith('/HEAD')) continue;
    if (name.startsWith('tag: ')) {
      tag = true;
      name = name.slice(5);
    }
    const remote = name.startsWith('origin/');
    const local = !remote && !tag;
    parsed.push({
      name,
      primary: local && (name === team || name === primaryBranch),
      remote,
      tag,
      worktree: local && laneBranches.has(name) && name !== primaryBranch,
    });
  }
  // If local `main` is here, skip `origin/main` — same tip, one label is enough.
  const locals = new Set(parsed.filter((r) => !r.remote && !r.tag).map((r) => r.name));
  return parsed.filter((r) => {
    if (!r.remote) return true;
    const short = r.name.replace(/^origin\//, '');
    return !locals.has(short);
  });
}

async function history(cwd, lanes, team, teamRef) {
  const format = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b';
  let raw;
  try {
    raw = await git(['log', '--date-order', '-n', '120', '--all', `--pretty=format:${format}`], cwd);
  } catch {
    return [];
  }
  const teamSet = await shaSet(['rev-list', teamRef], cwd);
  const laneSets = new Map();
  for (const lane of lanes) {
    if (lane.index > 0 && lane.branch) {
      laneSets.set(lane.index, await shaSet(['rev-list', lane.branch, '--not', teamRef], cwd));
    }
  }
  let primaryOnly = new Set();
  if (lanes[0]?.branch && lanes[0].branch !== team) {
    primaryOnly = await shaSet(['rev-list', lanes[0].branch, '--not', teamRef], cwd);
  }

  // Membership only: which commits appear. Visual columns come from assignColumns below.
  // Window is 120 until paint proves larger is fine.
  function belongs(sha) {
    if (teamSet.has(sha)) return true;
    for (const lane of lanes) {
      if (lane.index > 0 && laneSets.get(lane.index)?.has(sha)) return true;
    }
    if (primaryOnly.has(sha)) return true;
    return false;
  }

  const heads = new Set(lanes.map((l) => l.head).filter(Boolean));
  const laneBranches = new Set(lanes.map((l) => l.branch).filter(Boolean));
  const primaryBranch = lanes[0]?.branch;
  const rows = [];

  for (const record of raw.split('\x1e').filter(Boolean)) {
    const parts = record.split('\x1f');
    if (parts.length < 7) continue;
    const [sha, parentsRaw, name, email, when, decoration, subject, body = ''] = parts;
    if (!belongs(sha)) continue;
    const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [];
    const who = classifyAuthorship(name, email, body);
    const refs = pills(decoration, team, primaryBranch, laneBranches);
    const tip = heads.has(sha) || refs.some((r) => !r.tag);
    const at = parseInt(when, 10) || 0;
    rows.push({
      id: sha,
      lane: 0,
      subject,
      author: name,
      kind: who.kind,
      tool: who.tool,
      when: ago(at),
      at,
      parents,
      isWIP: false,
      isMerge: parents.length > 1,
      isTip: tip,
      danger: false,
      refs,
    });
  }

  // ponytail: packing cols are topology slots, not worktree indices. Tips usually
  // left-pack onto 0..k matching panel colors; remap packing→worktree if they diverge.
  const cols = assignColumns(rows.map((r) => ({ id: r.id, parents: r.parents })));
  for (const row of rows) row.lane = cols.get(row.id) ?? row.lane;

  for (const lane of lanes) {
    if (lane.dirty > 0 && lane.head) {
      const wip = {
        id: `wip-${lane.index}`,
        lane: lane.index,
        subject: `${lane.dirty} uncommitted`,
        author: '',
        kind: 'human',
        tool: null,
        when: '',
        at: 0,
        parents: [lane.head],
        isWIP: true,
        isMerge: false,
        isTip: false,
        danger: lane.isPrimary,
        refs: [],
      };
      const at = rows.findIndex((r) => r.id === lane.head);
      if (at >= 0) rows.splice(at, 0, wip);
      else rows.unshift(wip);
    }
  }
  return rows;
}

export async function loadBoard(repoPath) {
  const opened = path.resolve(repoPath);
  const inside = (await git(['rev-parse', '--is-inside-work-tree'], opened)).trim();
  if (inside !== 'true') throw new Error(`${opened} is not a git repository.`);
  const top = (await git(['rev-parse', '--show-toplevel'], opened)).trim();
  const trees = parseWorktrees(await git(['worktree', 'list', '--porcelain'], top));
  if (!trees.length) throw new Error(`${opened} is not a git repository.`);

  const team = await teamBranch(top);
  const teamRef = await resolveTeamRef(team, top);
  const hasCommit = await gitOk(['rev-parse', '--verify', '--quiet', 'HEAD'], top);
  let manifest = null;
  try {
    manifest = await loadManifest(path.join(trees[0].path, '.overlook', 'lane.yaml'));
  } catch { /* bad lane.yaml → not runnable */ }

  const lanes = [];
  for (let index = 0; index < trees.length; index++) {
    const tree = trees[index];
    const branch = tree.branch;
    const onTeam = branch === team;
    let dirtyFiles = [];
    try {
      dirtyFiles = await enrichDirtyFiles(tree.path, parseDirty(await git(['status', '--porcelain'], tree.path)));
    } catch { /* empty */ }
    const dirty = dirtyFiles.length;
    const behind = hasCommit && tree.head ? await countRange(`HEAD..${teamRef}`, tree.path) : 0;
    const ahead = hasCommit && tree.head ? await countRange(`${teamRef}..HEAD`, tree.path) : 0;
    const tip = tree.head ? await tipInfo(tree.path) : null;
    const clean = dirty === 0;
    // Local or origin team tip for "merged"; origin for behind/ahead.
    const merged = clean && branch && branch !== team
      && (await isPatchMerged(branch, team, tree.path) || await isPatchMerged(branch, teamRef, tree.path));
    const readiness = index === 0
      ? 'protected'
      : dirty > 0
        ? 'working'
        : merged
          ? 'safe'
          : 'unmerged';
    const alert = index === 0 && (dirty > 0 || !onTeam || ahead > 0);
    lanes.push({
      index,
      name: branch ?? '(detached)',
      path: tree.path,
      folder: index === 0 ? null : folderLabel(tree.path, trees[0].path, branch),
      branch,
      isPrimary: index === 0,
      behind,
      ahead,
      dirty,
      dirtyFiles,
      onTeamBranch: onTeam,
      readiness,
      authorship: tip?.kind ?? 'human',
      tool: tip?.tool ?? null,
      authorName: tip?.name ?? '',
      head: tree.head,
      alert,
      ...laneStatus(manifest, index, getProc(top, index), getLastTest(top, index)),
    });
  }

  const checked = new Set(lanes.map((l) => l.branch).filter(Boolean));
  let branches = [];
  try {
    const names = await git(['for-each-ref', 'refs/heads', '--format=%(refname:short)'], top);
    branches = names
      .split(/\n/)
      .filter(Boolean)
      .filter((n) => !checked.has(n))
      .sort()
      .map((name) => ({ name }));
  } catch { /* empty */ }

  const commits = hasCommit ? await history(top, lanes, team, teamRef) : [];

  let stashCount = 0;
  try {
    stashCount = (await git(['stash', 'list'], top)).split(/\n/).filter(Boolean).length;
  } catch { /* empty */ }

  const services = manifest?.services
    ? Object.entries(manifest.services).map(([name, s]) => ({
      name,
      mode: s?.mode || 'shared',
    }))
    : [];

  return {
    repoName: path.basename(trees[0].path),
    root: trees[0].path,
    teamBranch: team,
    teamRef,
    hasManifest: Boolean(manifest),
    manifestSummary: manifest
      ? {
        run: manifest.run || '',
        test: manifest.test || '',
        offset: manifest.ports?.offset ?? 0,
        services,
      }
      : null,
    readAt: Date.now(),
    stashCount,
    lanes,
    branches,
    commits,
  };
}
