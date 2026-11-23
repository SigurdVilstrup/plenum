import { git, gitOk } from './run.mjs';
import {
  classifyAuthorship,
  emailAvatarHash,
  formatWhen,
  parseNumstat,
  pills,
} from './board.mjs';

const DEFAULT_LIMIT = 500;

async function resolveRef(cwd, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (await gitOk(['rev-parse', '--verify', '--quiet', `${n}^{commit}`], cwd)) return n;
  if (!n.startsWith('origin/') && await gitOk(['rev-parse', '--verify', '--quiet', `origin/${n}^{commit}`], cwd)) {
    return `origin/${n}`;
  }
  return null;
}

async function worktreeDirtyForBranch(cwd, branch) {
  const short = String(branch || '').replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  let text = '';
  try {
    text = await git(['worktree', 'list', '--porcelain'], cwd);
  } catch {
    return null;
  }
  let path = null;
  let curPath = null;
  let curBranch = null;
  const flush = () => {
    if (curPath && curBranch === short) path = curPath;
    curPath = null;
    curBranch = null;
  };
  for (const line of text.split('\n')) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      curPath = line.slice(9);
    } else if (line.startsWith('branch ') && curPath) {
      const ref = line.slice(7);
      curBranch = ref.startsWith('refs/heads/') ? ref.slice(11) : ref;
    }
  }
  flush();
  if (!path) return null;
  try {
    const porcelain = await git(['status', '--porcelain', '-uall'], path);
    const lines = porcelain.split('\n').filter(Boolean);
    return { dirty: lines.length, path };
  } catch {
    return null;
  }
}

/**
 * Range overview for one tip vs a base (merge-base, ahead/behind, commits, files).
 * @param {string} cwd
 * @param {{ branch: string, vs: string, limit?: number, team?: string, primaryBranch?: string, laneBranches?: string[] }} opts
 */
export async function loadBranchOverview(cwd, opts = {}) {
  const branchIn = String(opts.branch || '').trim();
  const vsIn = String(opts.vs || '').trim();
  const limit = Math.min(Math.max(Number(opts.limit) || DEFAULT_LIMIT, 1), 2000);
  if (!branchIn) throw new Error('Branch required.');
  if (!vsIn) throw new Error('Compare ref required.');

  const tip = await resolveRef(cwd, branchIn);
  if (!tip) throw new Error(`Unknown branch: ${branchIn}`);
  const base = await resolveRef(cwd, vsIn);
  if (!base) throw new Error(`Unknown compare ref: ${vsIn}`);

  const tipSha = (await git(['rev-parse', tip], cwd)).trim();
  const baseSha = (await git(['rev-parse', base], cwd)).trim();

  let mergeBase = '';
  try {
    mergeBase = (await git(['merge-base', base, tip], cwd)).trim();
  } catch {
    mergeBase = '';
  }

  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await git(['rev-list', '--left-right', '--count', `${base}...${tip}`], cwd)).trim();
    const [left, right] = counts.split(/\s+/).map((n) => Number(n) || 0);
    behind = left;
    ahead = right;
  } catch (e) {
    throw new Error(`Could not count commits vs ${vsIn}: ${e.message || e}`);
  }

  const team = opts.team || '';
  const primaryBranch = opts.primaryBranch || team;
  const laneBranches = new Set(opts.laneBranches || []);

  const fmt = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s', '%b'].join('%x1f') + '%x1e';
  let raw = '';
  try {
    raw = await git([
      'log',
      '--date-order',
      `--max-count=${limit + 1}`,
      `--format=${fmt}`,
      `${base}..${tip}`,
    ], cwd);
  } catch (e) {
    throw new Error(`Could not list commits: ${e.message || e}`);
  }

  const records = raw.split('\x1e').filter(Boolean);
  const truncatedCommits = records.length > limit;
  const slice = truncatedCommits ? records.slice(0, limit) : records;
  const commits = [];
  for (const record of slice) {
    const parts = record.split('\x1f');
    if (parts.length < 7) continue;
    const [sha, parentsRaw, name, email, when, decoration, subject, body = ''] = parts;
    const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [];
    const who = classifyAuthorship(name, email, body);
    const at = parseInt(when, 10) || 0;
    const refs = pills(decoration, team, primaryBranch, laneBranches);
    commits.push({
      id: sha,
      lane: 0,
      subject,
      author: name,
      email,
      avatarHash: emailAvatarHash(email),
      kind: who.kind,
      tool: who.tool,
      when: formatWhen(at),
      at,
      parents,
      isWIP: false,
      isMerge: parents.length > 1,
      isTip: sha === tipSha,
      danger: false,
      refs,
      unpushed: false,
    });
  }

  let files = [];
  let added = 0;
  let deleted = 0;
  let truncatedFiles = false;
  try {
    const numstat = await git(['diff', '--numstat', `${base}...${tip}`], cwd);
    const map = parseNumstat(numstat);
    const all = [...map.entries()].map(([path, s]) => ({
      path,
      added: s.added || 0,
      deleted: s.deleted || 0,
    }));
    all.sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted) || a.path.localeCompare(b.path));
    for (const f of all) {
      added += f.added;
      deleted += f.deleted;
    }
    truncatedFiles = all.length > limit;
    files = truncatedFiles ? all.slice(0, limit) : all;
  } catch (e) {
    throw new Error(`Could not list changed files: ${e.message || e}`);
  }

  const dirty = await worktreeDirtyForBranch(cwd, tip);

  return {
    branch: tip,
    vs: base,
    tipSha,
    baseSha,
    mergeBase,
    ahead,
    behind,
    commits,
    files,
    totals: { files: files.length, added, deleted },
    truncated: truncatedCommits || truncatedFiles,
    truncatedCommits,
    truncatedFiles,
    dirty,
  };
}
