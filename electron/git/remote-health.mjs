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

function looksNotFound(err) {
  const msg = String(err?.message || err || '');
  return /not found|does not exist|could not read from remote|repository.?not.?found|404/i.test(msg);
}

async function defaultLsRemote(cwd) {
  return git(['ls-remote', '--heads', 'origin'], cwd);
}

/**
 * Read origin and check whether git can still talk to it (uses credentials).
 * A bare HTTP HEAD of github.com/… 404s private repos and false-alarms - don't.
 * After git says the URL is gone, HTTP redirects can still show a rename.
 */
export async function probeOrigin(cwd, {
  fetchImpl = globalThis.fetch,
  lsRemote = defaultLsRemote,
  timeoutMs = 2000,
} = {}) {
  let url = '';
  try {
    url = (await git(['remote', 'get-url', 'origin'], cwd)).trim();
  } catch {
    return {
      name: null,
      url: '',
      display: '',
      status: 'none',
      detail: 'No origin remote set.',
    };
  }
  if (!url) {
    return {
      name: 'origin',
      url: '',
      display: '',
      status: 'none',
      detail: 'origin has no URL set.',
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

  try {
    await lsRemote(cwd);
    return { ...base, status: 'ok', detail: '' };
  } catch (err) {
    if (!looksNotFound(err)) {
      return { ...base, status: 'unknown', detail: '' };
    }
  }

  // Git couldn't find the repo. For GitHub, see if the page redirects (rename).
  if (gh && typeof fetchImpl === 'function') {
    try {
      const page = `https://github.com/${gh.owner}/${gh.repo}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(page, {
        method: 'HEAD',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { Accept: 'text/html' },
      });
      clearTimeout(t);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location') || '';
        const next = parseGithubRemote(loc);
        if (next && (next.owner !== gh.owner || next.repo !== gh.repo)) {
          return {
            ...base,
            status: 'renamed',
            effectiveUrl: loc,
            effectiveDisplay: displayUrl(loc),
            detail: `origin still points at ${gh.owner}/${gh.repo}. GitHub moved it to ${next.owner}/${next.repo}.`,
          };
        }
      }
    } catch {
      /* fall through to stale */
    }
  }

  return {
    ...base,
    status: 'missing',
    detail: gh
      ? `Git can’t find ${gh.owner}/${gh.repo}. The origin URL is stale. Update it if the repo moved or was deleted.`
      : 'Git can’t find origin. The remote URL is stale. Update it.',
  };
}
