/**
 * Build a paste-ready agent brief from a doctor scan.
 * Plenum never edits the app; this tells an agent how to wire ports safely.
 *
 * @param {{
 *   proposed: object,
 *   findings?: string[],
 *   hits?: Array<{ path: string, line: number, snippet: string, kind?: string }>,
 *   wiring?: { unused?: string[], proposedWires?: Record<string, string>, unreferencedHits?: number },
 *   canAccept?: boolean,
 *   hasManifest?: boolean,
 * }} ctx
 * @returns {string}
 */
export function buildAgentPrompt(ctx = {}) {
  const proposed = ctx.proposed && typeof ctx.proposed === 'object' ? ctx.proposed : {};
  const hits = Array.isArray(ctx.hits) ? ctx.hits : [];
  const wiring = ctx.wiring && typeof ctx.wiring === 'object' ? ctx.wiring : {};
  const unused = Array.isArray(wiring.unused) ? wiring.unused : [];
  const proposedWires = wiring.proposedWires && typeof wiring.proposedWires === 'object'
    ? wiring.proposedWires
    : {};
  const expose = proposed.ports?.expose && typeof proposed.ports.expose === 'object'
    ? proposed.ports.expose
    : {};
  const envSet = proposed.env?.set && typeof proposed.env.set === 'object'
    ? proposed.env.set
    : {};
  const findings = Array.isArray(ctx.findings) ? ctx.findings : [];

  const lines = [];
  lines.push('# Plenum lane wiring');
  lines.push('');
  lines.push('You are wiring this repo so Plenum lanes can run in parallel. A `.plenum/lane.yaml` recipe alone is not enough: the app must honor the ports Plenum injects.');
  lines.push('');
  lines.push('## Rules (non-negotiable)');
  lines.push('');
  lines.push('- Prefer **environment variables** with **fallbacks to today\'s hard-coded values** so `npm run dev` / the usual start still works without Plenum.');
  lines.push('- Do **not** require Plenum to boot the app.');
  lines.push('- Do **not** delete hard-coded ports without an env-or-default path.');
  lines.push('- Match `env.set` in `.plenum/lane.yaml` to the env names the code reads. Use `{port.<name>}`, `{offset}`, `{lane}` templates where needed.');
  lines.push('- Plenum Start sets `PLENUM_LANE`, `PLENUM_OFFSET`, plus `env.set`, then runs the recipe `run` command as-is (placeholders in that string are substituted). It does not rewrite package.json, Aspire, or compose.');
  lines.push('- If a hit is intentional and must stay fixed, allowlist it under `.plenum/port-allowlist` instead of fighting it.');
  lines.push('');
  lines.push('## Recipe snapshot');
  lines.push('');
  if (ctx.hasManifest) {
    lines.push('- This repo already has `.plenum/lane.yaml` — edit that file; do not replace it blindly. Numbers below are the **doctor proposal**, not necessarily what is on disk.');
  } else if (ctx.canAccept) {
    lines.push('- No recipe yet. Write `.plenum/lane.yaml` from the proposal below (or MCP `repo.doctor` with `write: true` when allowed), then wire the app.');
  } else {
    lines.push('- No acceptable `run` yet. Add a start command to the recipe before wiring ports.');
  }
  if (proposed.run) lines.push(`- \`run\`: \`${proposed.run}\``);
  if (proposed.setup) lines.push(`- \`setup\`: \`${proposed.setup}\``);
  if (proposed.test) lines.push(`- \`test\`: \`${proposed.test}\``);
  const offset = proposed.ports?.offset ?? 100;
  lines.push(`- \`ports.offset\`: ${offset} (lane N gets base + offset × N)`);
  const exposeNames = Object.keys(expose);
  if (exposeNames.length) {
    lines.push('- \`ports.expose\`:');
    for (const [name, base] of Object.entries(expose)) {
      lines.push(`  - \`${name}\`: ${base} → lane 1 = ${Number(base) + Number(offset)}`);
    }
  } else {
    lines.push('- \`ports.expose\`: empty — name every listener the stack needs (web, api, …) with base ports.');
    const suggested = suggestedExposeFromHits(hits);
    if (Object.keys(suggested).length) {
      lines.push('- Suggested \`ports.expose\` from open hits (edit names to match the stack):');
      for (const [name, base] of Object.entries(suggested)) {
        lines.push(`  - \`${name}\`: ${base}`);
      }
    }
  }
  const setKeys = Object.keys(envSet);
  if (setKeys.length) {
    lines.push('- \`env.set\` (proposed):');
    for (const [k, v] of Object.entries(envSet)) {
      lines.push(`  - \`${k}\`: \`${v}\``);
    }
  } else {
    lines.push('- \`env.set\`: empty — add wires so the process receives `{port.*}` values.');
  }
  const wireKeys = Object.keys(proposedWires);
  if (wireKeys.length) {
    lines.push('- Suggested wires to add:');
    for (const [k, v] of Object.entries(proposedWires)) {
      lines.push(`  - \`${k}\`: \`${v}\``);
    }
  }
  if (unused.length) {
    lines.push(`- Exposed but unused in run/env.set: ${unused.map((n) => `\`${n}\``).join(', ')}`);
  }
  lines.push('');
  lines.push('## Port hits to fix or allowlist');
  lines.push('');
  if (!hits.length) {
    lines.push('No open hard-coded localhost/bind hits in the scan window. Still verify the start path reads the env names above.');
  } else {
    lines.push(`Found ${hits.length} hit${hits.length === 1 ? '' : 's'} (path:line — snippet):`);
    for (const h of hits.slice(0, 40)) {
      const snip = String(h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      lines.push(`- \`${h.path}:${h.line}\` — \`${snip}\``);
    }
    if (hits.length > 40) lines.push(`- …and ${hits.length - 40} more`);
  }
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push('1. Ensure `.plenum/lane.yaml` has `run`, named `ports.expose`, and `env.set` entries that inject those ports.');
  lines.push('2. For each hit (or each service that listens/calls a port), teach the code to read the matching env var with the current hard-coded value as default.');
  lines.push('3. Keep frontends pointing at backends via env (e.g. `VITE_API_URL` → `http://127.0.0.1:{port.api}`), not fixed localhost ports.');
  lines.push('4. Aspire / docker-compose: pin host ports from the same env names; do not leave free-port allocation that ignores the recipe.');
  lines.push('5. Confirm without Plenum: usual start still works. Confirm with Plenum: lane 0 uses base ports; lane 1 uses base + offset.');
  lines.push('');
  lines.push('## Done when');
  lines.push('');
  lines.push('- Parallel lanes do not collide on web/api (and any other exposed) ports.');
  lines.push('- Non-Plenum developers can still start the stack with the existing scripts.');
  lines.push('- Remaining hard-coded ports are either env-backed or intentionally allowlisted.');
  if (findings.some((f) => /apphost|aspire|docker-compose|compose\./i.test(f))) {
    lines.push('');
    lines.push('## Note');
    lines.push('');
    lines.push('Doctor found Aspire and/or compose files. It does not invent their start command or rewrite host ports — you must pin listeners to the recipe env yourself.');
    lines.push('For multi-frontend / multi-backend / DB / Superset stacks: expose every **app** listener that must differ per lane; shared DBs can stay on fixed ports if `services:` mode is shared. Prefer pinning Aspire/compose host ports from `env.set` rather than free-port allocation.');
  }
  lines.push('');
  return lines.join('\n');
}

/** @param {Array<{ snippet?: string }>} hits */
function suggestedExposeFromHits(hits) {
  const nums = [];
  const seen = new Set();
  for (const h of hits || []) {
    for (const m of String(h?.snippet || '').matchAll(/\b(\d{2,5})\b/g)) {
      const n = Number(m[1]);
      if (n >= 1024 && n <= 65535 && !seen.has(n)) {
        seen.add(n);
        nums.push(n);
      }
    }
  }
  const names = ['web', 'api', 'app'];
  const out = {};
  nums.slice(0, 6).forEach((n, i) => {
    out[names[i] || `port${i + 1}`] = n;
  });
  return out;
}
