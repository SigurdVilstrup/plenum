import path from 'node:path';
import { git } from './run.mjs';
import { classifyAuthorship, parseNumstat, teamBranch, resolveTeamRef } from './board.mjs';

const DAY = 86400000;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = (d) => { const m = new Date(d); m.setHours(12, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return dayKey(m); };
const WEEKS = 52;
const DAILY_BELOW = 100; // days of history under which the agents chart buckets by day

/**
 * Pure: commits -> everything the Statistics page draws. Days and hours are local time.
 * commit: { name, email, at (unix s), subject, body, files: Map<path, {added, deleted}> }
 */
export function computeStats(commits, { merges = 0, now = Date.now(), days = 90 } = {}) {
  const people = new Map();
  const tools = new Map();
  const files = new Map();
  const perDay = new Map();
  const weekly = new Map(); // bucket key (day or monday) -> Map<tool, n>
  const youngDays = commits.length ? Math.floor((now - Math.min(...commits.map((c) => c.at)) * 1000) / DAY) + 1 : 0;
  const unit = youngDays <= DAILY_BELOW ? 'day' : 'week';
  const bucket = (d) => (unit === 'day' ? dayKey(d) : monday(d));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const kinds = { human: 0, assisted: 0, agent: 0, mixed: 0 };
  let added = 0;
  let deleted = 0;
  let first = Infinity;
  let last = 0;
  let biggest = null;

  for (const c of commits) {
    let a = 0;
    let d = 0;
    for (const [p, s] of c.files) {
      a += s.added;
      d += s.deleted;
      files.set(p, (files.get(p) || 0) + 1);
    }
    added += a;
    deleted += d;
    const when = new Date(c.at * 1000);
    const hour = when.getHours();
    const dow = when.getDay();
    first = Math.min(first, c.at);
    last = Math.max(last, c.at);
    perDay.set(dayKey(when), (perDay.get(dayKey(when)) || 0) + 1);
    heat[(dow + 6) % 7][hour]++;

    const who = classifyAuthorship(c.name, c.email, c.body);
    kinds[who.kind]++;
    const tool = who.tool || 'Human';
    const wk = weekly.get(bucket(when)) || new Map();
    wk.set(tool, (wk.get(tool) || 0) + 1);
    weekly.set(bucket(when), wk);

    const key = (c.email || c.name).toLowerCase();
    const p = people.get(key) || { name: c.name, email: c.email, commits: 0, added: 0, deleted: 0, withAgent: 0, night: 0, early: 0, weekend: 0, fixes: 0, humanOnly: 0, big: 0 };
    p.commits++; p.added += a; p.deleted += d;
    if (who.kind !== 'human') p.withAgent++; else p.humanOnly++;
    if (hour >= 22 || hour < 5) p.night++;
    else if (hour < 9) p.early++;
    if (dow === 0 || dow === 6) p.weekend++;
    if (/^fix\b/i.test(c.subject)) p.fixes++;
    p.big = Math.max(p.big, a + d);
    people.set(key, p);

    const t = tools.get(tool) || { tool, commits: 0, added: 0, deleted: 0 };
    t.commits++; t.added += a; t.deleted += d;
    tools.set(tool, t);
    if (!biggest || a + d > biggest.lines) biggest = { subject: c.subject, name: c.name, lines: a + d, at: c.at };
  }

  // Last `days` days, today included, zeros filled so the chart has a steady x axis.
  const series = [];
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  for (let i = Math.min(days, Math.max(14, youngDays)) - 1; i >= 0; i--) {
    const k = dayKey(new Date(today.getTime() - i * DAY));
    series.push({ day: k, n: perDay.get(k) || 0 });
  }

  // Longest run of consecutive active days.
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of [...perDay.keys()].sort()) {
    const [y, m, dd] = k.split('-').map(Number);
    const t = new Date(y, m - 1, dd, 12).getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  const span = commits.length ? Math.max(1, Math.round((last - first) / 86400) + 1) : 0;
  const top = (m, n, by) => [...m.values()].sort((x, y) => by(y) - by(x)).slice(0, n);

  // Agents over time: Human first, then the five busiest tools, the rest folded into Other.
  const ranked = [...tools.values()].filter((t) => t.tool !== 'Human').sort((x, y) => y.commits - x.commits);
  const named = new Set(ranked.slice(0, 5).map((t) => t.tool));
  const fold = (tool) => (tool === 'Human' || named.has(tool) ? tool : 'Other');
  const totals = {};
  for (const t of tools.values()) totals[fold(t.tool)] = (totals[fold(t.tool)] || 0) + t.commits;
  const toolOrder = ['Human', ...ranked.slice(0, 5).map((t) => t.tool), ...(totals.Other ? ['Other'] : [])];
  const weekKeys = [];
  if (unit === 'day') {
    for (let i = Math.max(14, youngDays) - 1; i >= 0; i--) weekKeys.push(dayKey(new Date(today.getTime() - i * DAY)));
  } else {
    for (let i = WEEKS - 1; i >= 0; i--) weekKeys.push(monday(new Date(today.getTime() - i * 7 * DAY)));
  }
  const weeks = weekKeys.map((week) => {
    const counts = {};
    for (const [tool, n] of weekly.get(week) || []) counts[fold(tool)] = (counts[fold(tool)] || 0) + n;
    return { week, counts };
  });

  return {
    commits: commits.length,
    merges,
    added,
    deleted,
    activeDays: perDay.size,
    perActiveDay: perDay.size ? commits.length / perDay.size : 0,
    perCalendarDay: span ? commits.length / span : 0,
    longestStreak: longest,
    first: commits.length ? first : null,
    last: commits.length ? last : null,
    series,
    heat,
    heatPeak: heatPeak(heat),
    kinds,
    people: top(people, 12, (p) => p.added + p.deleted),
    tools: top(tools, 12, (t) => t.commits),
    weekly: { unit, tools: toolOrder, totals, weeks },
    awards: awards([...people.values()], { perDay, files, biggest, ranked, commits: commits.length, longest }),
  };
}

/** Busiest weekday×hour cell, or null when the grid is empty. */
export function heatPeak(heat) {
  let day = 0;
  let hour = 0;
  let n = 0;
  for (let d = 0; d < heat.length; d++) {
    for (let h = 0; h < heat[d].length; h++) {
      if (heat[d][h] > n) {
        n = heat[d][h];
        day = d;
        hour = h;
      }
    }
  }
  return n > 0 ? { day, hour, n } : null;
}

/** Minimum to earn a title. Below it nothing shows, so a quiet repo gets no trophies. */
export const AWARD_MIN = { ai: 3, lines: 100, night: 3, early: 3, weekend: 3, deleted: 100, fixes: 3, human: 3, biggest: 500, fav: 3, day: 5, streak: 3, file: 5 };

/**
 * Cheeky titles, each { id, title, who|null, stat, quip, scope: 'person'|'repo' }.
 * Person titles need two people to compete; repo titles need only enough history.
 */
function awards(people, { perDay, files, biggest, ranked, commits, longest }) {
  const out = [];
  const n = (x) => Number(x).toLocaleString();
  const give = (id, title, p, stat, quip, scope = 'person') =>
    out.push({ id, title, who: p?.name ?? null, email: p?.email ?? null, stat, quip, scope });
  const best = (id, by) => {
    const p = people.reduce((b, x) => (!b || by(x) > by(b) ? x : b), null);
    return p && by(p) >= AWARD_MIN[id] ? p : null;
  };

  // Person titles name a winner; repo titles are about the history, not a person.
  if (people.length > 1) {
    let p = best('ai', (x) => x.withAgent);
    if (p) give('ai', 'Most AI-assisted', p, `${n(p.withAgent)} commits with an agent`, 'Has technically met a keyboard.', 'person');
    if ((p = best('lines', (x) => x.added))) give('lines', 'Line machine', p, `+${n(p.added)} lines`, 'Quantity has a quality all its own.', 'person');
    if ((p = best('night', (x) => x.night))) give('night', 'Night owl', p, `${n(p.night)} commits between 22:00 and 05:00`, 'Sleep is just a merge conflict you haven’t resolved.', 'person');
    if ((p = best('early', (x) => x.early))) give('early', 'Early bird', p, `${n(p.early)} commits before 09:00`, 'Pushed before coffee. Brave.', 'person');
    if ((p = best('weekend', (x) => x.weekend))) give('weekend', 'Weekend warrior', p, `${n(p.weekend)} commits on a weekend`, 'The repo does not know what a day off is.', 'person');
    if ((p = best('deleted', (x) => x.deleted))) give('deleted', 'Demolition crew', p, `−${n(p.deleted)} lines`, 'The best code is the code you deleted.', 'person');
    if ((p = best('fixes', (x) => x.fixes))) give('fixes', 'Fix-it', p, `${n(p.fixes)} fix commits`, 'Breaks things, fixes things. Net zero, strong vibes.', 'person');
    if ((p = best('human', (x) => x.humanOnly))) give('human', 'Artisanal', p, `${n(p.humanOnly)} commits with no AI`, 'Small-batch, hand-typed, probably slower.', 'person');
  }
  if (biggest?.lines >= AWARD_MIN.biggest) give('biggest', 'Biggest bang', { name: biggest.name }, `${n(biggest.lines)} lines in one commit`, `“${biggest.subject.slice(0, 48)}” Review requested. Thoughts and prayers.`, 'repo');
  if (ranked[0]?.commits >= AWARD_MIN.fav) give('fav', 'Favourite agent', null, `${ranked[0].tool}, in ${n(ranked[0].commits)} commits`, `${Math.round((ranked[0].commits / commits) * 100)}% of the history. They have a type.`, 'repo');
  const day = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  if (day?.[1] >= AWARD_MIN.day) {
    const [y, m, d] = day[0].split('-').map(Number);
    give('day', 'Busiest day', null, `${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${n(day[1])} commits`, 'Someone had a deadline. Or a fresh coffee.', 'repo');
  }
  if (longest >= AWARD_MIN.streak) give('streak', 'Longest streak', null, `${longest} days in a row`, 'Touch grass. Then come back.', 'repo');
  const file = [...files.entries()].sort((a, b) => b[1] - a[1])[0];
  if (file?.[1] >= AWARD_MIN.file) give('file', 'Most reworked file', null, `${file[0]}, ${n(file[1])} commits`, 'We are not going to talk about it.', 'repo');
  return out;
}

const SEP = '\x1e';
const FIELD = '\x1f';
export const STATS_LIMIT = 20000;

/** Parse `git log --numstat` output produced by loadStats' format. */
export function parseLog(raw) {
  return raw.split(SEP).slice(1).map((chunk) => {
    const [name, email, at, subject, body, numstat = ''] = chunk.split(FIELD);
    return { name, email, at: Number(at), subject, body, files: parseNumstat(numstat) };
  });
}

/**
 * scope 'protected' = history of the team branch; 'all' = every local and remote branch.
 * ponytail: newest STATS_LIMIT commits only; page it or cache by head sha if repos get bigger.
 */
export async function loadStats(repoPath, scope = 'protected') {
  const cwd = path.resolve(repoPath);
  const top = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
  const team = (await teamBranch(top)).name;
  const teamRef = await resolveTeamRef(team, top);
  const revs = scope === 'all' ? ['--branches', '--remotes'] : [teamRef];
  let commits = [];
  let merges = 0;
  try {
    const fmt = `--format=${SEP}%aN${FIELD}%aE${FIELD}%at${FIELD}%s${FIELD}%b${FIELD}`;
    commits = parseLog(await git(['log', '--no-merges', '-n', String(STATS_LIMIT), '--numstat', fmt, ...revs], top));
    merges = parseInt((await git(['rev-list', '--count', '--merges', ...revs], top)).trim(), 10) || 0;
  } catch { /* no commits yet */ }
  return { scope, teamRef, truncated: commits.length >= STATS_LIMIT, ...computeStats(commits, { merges }) };
}
