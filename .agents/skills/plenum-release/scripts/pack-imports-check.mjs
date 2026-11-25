#!/usr/bin/env node
/*
 * Packaging import gates for Plenum.
 *
 * 1) Source: electron/ must not import from ../app/ (app/ is not in the asar).
 * 2) Packaged: walk relative ESM imports from package.json main inside app.asar
 *    and fail on any missing module (the 0.2.20 launch killer).
 *
 *   node pack-imports-check.mjs [--path <repo>] [--asar <app.asar>] [--skip-source] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import {
  asarPathForApp,
  die,
  findPackagedApp,
  normalizeAsarEntry,
  relativeSpecifiers,
  repoRootFrom,
} from './_lib.mjs';

const USAGE = `Usage: node pack-imports-check.mjs [--path <repo>] [--asar <app.asar>] [--app <Plenum.app|Plenum.exe>] [--skip-source] [--json]
`;

function parseArgs(argv) {
  const out = { path: null, asar: null, app: null, skipSource: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--asar') out.asar = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--skip-source') out.skipSource = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else die(`Unknown arg: ${a}\n${USAGE}`);
  }
  return out;
}

function walkSourceFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkSourceFiles(full, out);
    } else if (/\.(mjs|js|cjs)$/.test(ent.name) && !ent.name.endsWith('.test.mjs') && !ent.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

function checkSourceForbidden(repoRoot) {
  const electronDir = path.join(repoRoot, 'electron');
  const bad = [];
  const re = /from\s+['"](\.\.\/)+app\//g;
  for (const file of walkSourceFiles(electronDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const hits = [...text.matchAll(/from\s+['"]((?:\.\.\/)+app\/[^'"]+)['"]/g)].map((m) => m[1]);
    if (hits.length) bad.push({ file: path.relative(repoRoot, file), imports: hits });
  }
  return bad;
}

function resolveInAsar(fromEntry, spec) {
  const dir = path.posix.dirname(fromEntry);
  let resolved = normalizeAsarEntry(path.posix.normalize(path.posix.join(dir, spec)));
  const candidates = [resolved];
  if (!path.posix.extname(resolved)) {
    candidates.push(`${resolved}.mjs`, `${resolved}.js`, `${resolved}.cjs`, `${resolved}/index.mjs`, `${resolved}/index.js`);
  }
  return candidates;
}

function checkAsarGraph(asarFile) {
  const pkgRaw = asar.extractFile(asarFile, 'package.json').toString('utf8');
  const pkg = JSON.parse(pkgRaw);
  const entry = normalizeAsarEntry(pkg.main || 'electron/main.mjs');
  const listed = new Set(asar.listPackage(asarFile).map((p) => normalizeAsarEntry(p.replace(/^\//, ''))));
  // listPackage often returns paths like "/electron/main.mjs"
  const has = (rel) => listed.has(rel) || listed.has(`/${rel}`);

  const missing = [];
  const visited = new Set();
  const queue = [entry];

  while (queue.length) {
    const cur = queue.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (!has(cur)) {
      missing.push({ from: null, spec: null, tried: [cur] });
      continue;
    }
    let source;
    try {
      source = asar.extractFile(asarFile, cur).toString('utf8');
    } catch (err) {
      missing.push({ from: null, spec: null, tried: [cur], error: String(err.message || err) });
      continue;
    }
    for (const spec of relativeSpecifiers(source)) {
      const tried = resolveInAsar(cur, spec);
      const hit = tried.find((c) => has(c));
      if (!hit) {
        missing.push({ from: cur, spec, tried });
        continue;
      }
      if (!visited.has(hit)) queue.push(hit);
    }
  }

  return { entry, visited: [...visited].sort(), missing };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const report = { repoRoot, gates: [] };
  let failed = false;

  if (!opts.skipSource) {
    const bad = checkSourceForbidden(repoRoot);
    const gate = {
      id: 'no-electron-app-imports',
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? 'electron/ does not import from app/ (asar exclude)'
          : bad.map((b) => `${b.file}: ${b.imports.join(', ')}`).join('; '),
      bad,
    };
    report.gates.push(gate);
    if (!gate.ok) failed = true;
  }

  let asarFile = opts.asar || null;
  if (!asarFile) {
    const appPath = opts.app || findPackagedApp(repoRoot);
    if (appPath) asarFile = asarPathForApp(appPath);
  }
  if (!asarFile || !fs.existsSync(asarFile)) {
    const gate = {
      id: 'asar-import-graph',
      ok: false,
      detail: 'No app.asar found — run npm run pack (or pass --asar / --app)',
    };
    report.gates.push(gate);
    failed = true;
  } else {
    const graph = checkAsarGraph(asarFile);
    const gate = {
      id: 'asar-import-graph',
      ok: graph.missing.length === 0,
      asar: asarFile,
      entry: graph.entry,
      modules: graph.visited.length,
      detail:
        graph.missing.length === 0
          ? `Resolved ${graph.visited.length} modules from ${graph.entry} in asar`
          : graph.missing
              .map((m) =>
                m.from
                  ? `${m.from} → ${m.spec} (tried ${m.tried.join(', ')})`
                  : `missing entry ${m.tried?.[0] || '?'}`,
              )
              .join('; '),
      missing: graph.missing,
    };
    report.gates.push(gate);
    if (!gate.ok) failed = true;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const g of report.gates) {
      console.log(`${g.ok ? '✓' : '✗'} ${g.id}: ${g.detail}`);
    }
  }
  process.exit(failed ? 2 : 0);
}

main();
