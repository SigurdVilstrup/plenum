import { git } from './run.mjs';

/** Parse owner/repo from a GitHub remote URL (https or ssh). */
export function parseGithubRemote(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let m = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  m = raw.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  m = raw.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  return null;
}

function displayUrl(url) {
  const gh = parseGithubRemote(url);
  if (gh) return `github.com/${gh.owner}/${gh.repo}`;
  return String(url || '').replace(/\.git$/i, '');
}

/**
 * Read origin and, for GitHub remotes, probe whether the repo page still exists.
 * Renames that 404 the old name (common after owner/repo moves) show as `missing`.
 * Network blips stay `unknown` so we never block the board.
 */
export async function probeOrigin(cwd, { fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  let url = '';
  try {
    url = (await git(['remote', 'get-url', 'origin'], cwd)).trim();
  } catch {
    return {
      name: null,
      url: '',
      display: '',
      status: 'none',
      detail: 'No origin remote configured.',
    };
  }
  if (!url) {
    return {
      name: 'origin',
      url: '',
      display: '',
      status: 'none',
      detail: 'origin has no URL.',
    };
  }

  const gh = parseGithubRemote(url);
  const base = {
    name: 'origin',
    url,
    display: displayUrl(url),
    owner: gh?.owner || null,
    repo: gh?.repo || null,
  };
  if (!gh || typeof fetchImpl !== 'function') {
    return { ...base, status: 'ok', detail: '' };
  }

  const page = `https://github.com/${gh.owner}/${gh.repo}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(page, {
      method: 'HEAD',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'text/html' },
    });
    clearTimeout(t);
    if (res.status === 404) {
      return {
        ...base,
        status: 'missing',
        detail: `GitHub has no ${gh.owner}/${gh.repo}. origin is stale (renamed or deleted) — update the remote URL.`,
      };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      const next = parseGithubRemote(loc);
      if (next && (next.owner !== gh.owner || next.repo !== gh.repo)) {
        return {
          ...base,
          status: 'renamed',
          effectiveUrl: loc,
          effectiveDisplay: displayUrl(loc),
          detail: `origin still points at ${gh.owner}/${gh.repo}; GitHub moved it to ${next.owner}/${next.repo}.`,
        };
      }
    }
    return { ...base, status: 'ok', detail: '' };
  } catch {
    return { ...base, status: 'unknown', detail: '' };
  }
}
