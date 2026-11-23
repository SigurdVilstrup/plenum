#!/usr/bin/env node
/*
 * OTA survival gates for Plenum.
 *
 * Invariant: every shipped build must still be able to discover, download, and
 * install a *later* build from https://plenum.sh/updates/. If that loop breaks,
 * we cannot fix users over the air — they must reinstall. That must never ship.
 *
 * Checks (layers):
 *   source  — default feed URL, package.json publish, electron-updater dep, updater wiring
 *   asar    — updates module + electron-updater present in the packaged app
 *   feed    — local latest-mac.yml + zip (+ optional live feed compare)
 *
 *   node ota-health-check.mjs [--path <repo>] [--app <Plenum.app>] [--artifacts <dir>]
 *                             [--live-feed] [--skip-source] [--skip-asar] [--skip-feed] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import {
  asarPathForApp,
  die,
  findPlenumApp,
  normalizeAsarEntry,
  repoRootFrom,
} from './_lib.mjs';

export const PUBLIC_FEED_URL = 'https://plenum.sh/updates/';

const USAGE = `Usage: node ota-health-check.mjs [--path <repo>] [--app <Plenum.app>] [--artifacts <dir>] [--live-feed] [--skip-source] [--skip-asar] [--skip-feed] [--json]
`;

function parseArgs(argv) {
  const out = {
    path: null,
    app: null,
    artifacts: null,
    liveFeed: false,
    skipSource: false,
    skipAsar: false,
    skipFeed: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--artifacts') out.artifacts = argv[++i];
    else if (a === '--live-feed') out.liveFeed = true;
    else if (a === '--skip-source') out.skipSource = true;
    else if (a === '--skip-asar') out.skipAsar = true;
    else if (a === '--skip-feed') out.skipFeed = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else die(`Unknown arg: ${a}\n${USAGE}`);
  }
  return out;
}

function parseSemver(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function cmpSemver(a, b) {
  const aa = parseSemver(a);
  const bb = parseSemver(b);
  if (!aa || !bb) return null;
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

/** Minimal YAML subset for electron-builder latest-mac.yml (version/path/sha512/files). */
export function parseLatestMacYml(text) {
  const out = { version: null, path: null, sha512: null, files: [] };
  const lines = String(text || '').split(/\r?\n/);
  let inFiles = false;
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      const fileUrl = line.match(/^\s+-\s+url:\s+(\S+)\s*$/);
      if (fileUrl) {
        cur = { url: fileUrl[1] };
        out.files.push(cur);
        continue;
      }
      const sha = line.match(/^\s+sha512:\s+(\S+)\s*$/);
      if (sha && cur) {
        cur.sha512 = sha[1];
        continue;
      }
      const size = line.match(/^\s+size:\s+(\d+)\s*$/);
      if (size && cur) {
        cur.size = Number(size[1]);
        continue;
      }
      if (/^[^\s]/.test(line)) inFiles = false;
    }
    const ver = line.match(/^version:\s+['"]?([^'"]+)['"]?\s*$/);
    if (ver) out.version = ver[1].trim();
    const p = line.match(/^path:\s+['"]?([^'"]+)['"]?\s*$/);
    if (p) out.path = p[1].trim();
    const sha = line.match(/^sha512:\s+(\S+)\s*$/);
    if (sha && !inFiles) out.sha512 = sha[1];
  }
  return out;
}

function asarHas(asarFile, rel) {
  const want = normalizeAsarEntry(rel);
  const listed = asar.listPackage(asarFile).map((p) => normalizeAsarEntry(String(p).replace(/^\//, '')));
  const set = new Set(listed);
  return set.has(want) || listed.some((p) => p === want || p.startsWith(`${want}/`));
}

function checkSource(repoRoot) {
  const gates = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  const dep = pkg.dependencies?.['electron-updater'];
  gates.push({
    id: 'ota-dep-electron-updater',
    ok: Boolean(dep),
    detail: dep ? `dependencies.electron-updater = ${dep}` : 'electron-updater missing from dependencies (OTA dead)',
  });

  const publish = pkg.build?.publish;
  const pub = Array.isArray(publish) ? publish[0] : publish;
  const pubOk = pub?.provider === 'generic' && String(pub?.url || '') === PUBLIC_FEED_URL;
  gates.push({
    id: 'ota-package-publish-url',
    ok: pubOk,
    detail: pubOk
      ? `build.publish → generic ${PUBLIC_FEED_URL}`
      : `build.publish must be generic ${PUBLIC_FEED_URL} (got ${JSON.stringify(pub)})`,
  });

  const targets = pkg.build?.mac?.target;
  const targetList = Array.isArray(targets) ? targets : [targets];
  const hasZip = targetList.some((t) => t === 'zip' || t?.target === 'zip');
  gates.push({
    id: 'ota-mac-zip-target',
    ok: hasZip,
    detail: hasZip ? 'mac.target includes zip (Squirrel.Mac / electron-updater payload)' : 'mac.target must include zip for OTA',
  });

  const updatesSrc = fs.readFileSync(path.join(repoRoot, 'electron', 'updates.mjs'), 'utf8');
  const hasDefault = updatesSrc.includes(`'${PUBLIC_FEED_URL}'`) || updatesSrc.includes(`"${PUBLIC_FEED_URL}"`);
  gates.push({
    id: 'ota-default-feed-constant',
    ok: hasDefault,
    detail: hasDefault
      ? `DEFAULT feed is ${PUBLIC_FEED_URL}`
      : `electron/updates.mjs must default to ${PUBLIC_FEED_URL}`,
  });

  // configure() must enable updates unless DISABLE_AUTO_UPDATE=1 — catch accidental always-off.
  const alwaysDisabled =
    /enabled:\s*false/.test(updatesSrc) &&
    !/DISABLE_AUTO_UPDATE/.test(updatesSrc);
  gates.push({
    id: 'ota-not-hard-disabled',
    ok: !alwaysDisabled && /DISABLE_AUTO_UPDATE/.test(updatesSrc),
    detail: alwaysDisabled
      ? 'Updater looks hard-disabled in source'
      : 'Updater disable path is env-gated (PLENUM_DISABLE_AUTO_UPDATE)',
  });

  const mainSrc = fs.readFileSync(path.join(repoRoot, 'electron', 'main.mjs'), 'utf8');
  const wired =
    /createUpdater/.test(mainSrc) &&
    /updates\?\.configure|updates\.configure/.test(mainSrc) &&
    /startBackground/.test(mainSrc);
  gates.push({
    id: 'ota-main-wires-updater',
    ok: wired,
    detail: wired
      ? 'electron/main.mjs configures updater + startBackground'
      : 'main process must createUpdater().configure() and startBackground()',
  });

  return gates;
}

function checkAsar(asarFile) {
  const gates = [];
  const need = [
    'electron/updates.mjs',
    'electron/main.mjs',
    'node_modules/electron-updater/package.json',
  ];
  const missing = need.filter((n) => !asarHas(asarFile, n));
  gates.push({
    id: 'ota-asar-updater-present',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? 'asar contains updates.mjs + electron-updater'
        : `asar missing OTA pieces: ${missing.join(', ')}`,
  });

  // Feed URL still baked into packaged module (guards against a bad rewrite at build time).
  try {
    const packed = asar.extractFile(asarFile, 'electron/updates.mjs').toString('utf8');
    const ok = packed.includes(PUBLIC_FEED_URL);
    gates.push({
      id: 'ota-asar-feed-url',
      ok,
      detail: ok
        ? `packaged updates.mjs still points at ${PUBLIC_FEED_URL}`
        : `packaged updates.mjs lost default feed ${PUBLIC_FEED_URL}`,
    });
  } catch (err) {
    gates.push({
      id: 'ota-asar-feed-url',
      ok: false,
      detail: `cannot read packaged updates.mjs: ${err.message || err}`,
    });
  }
  return gates;
}

function checkArtifacts(dir, { liveYml = null, requireNotOlderThanLive = false } = {}) {
  const gates = [];
  const ymlPath = path.join(dir, 'latest-mac.yml');
  if (!fs.existsSync(ymlPath)) {
    gates.push({
      id: 'ota-feed-yml',
      ok: false,
      detail: `No latest-mac.yml in ${dir}`,
    });
    return gates;
  }
  const yml = parseLatestMacYml(fs.readFileSync(ymlPath, 'utf8'));
  const fieldsOk = Boolean(yml.version && yml.path && yml.sha512 && yml.files.length);
  gates.push({
    id: 'ota-feed-yml',
    ok: fieldsOk,
    detail: fieldsOk
      ? `latest-mac.yml version=${yml.version} path=${yml.path} files=${yml.files.length}`
      : `latest-mac.yml incomplete: ${JSON.stringify(yml)}`,
    yml,
  });
  if (!fieldsOk) return gates;

  const zipName = yml.path;
  const zipPath = path.join(dir, zipName);
  const zipOk = fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0;
  gates.push({
    id: 'ota-feed-zip',
    ok: zipOk,
    detail: zipOk
      ? `OTA zip present (${fs.statSync(zipPath).size} bytes): ${zipName}`
      : `Missing OTA zip named by latest-mac.yml path: ${zipName}`,
  });

  const blockmap = `${zipName}.blockmap`;
  const bmPath = path.join(dir, blockmap);
  gates.push({
    id: 'ota-feed-blockmap',
    ok: fs.existsSync(bmPath),
    detail: fs.existsSync(bmPath)
      ? `blockmap present: ${blockmap}`
      : `Missing ${blockmap} (delta updates / electron-updater expect it)`,
  });

  if (liveYml?.version) {
    const cmp = cmpSemver(yml.version, liveYml.version);
    if (requireNotOlderThanLive) {
      // Equal is OK (workflow re-run after FTP). Older must never publish — OTA clients would ignore a “fix”.
      const ok = cmp === null ? false : cmp >= 0;
      gates.push({
        id: 'ota-feed-not-older-than-live',
        ok,
        detail: ok
          ? `${yml.version} ${cmp === 0 ? '==' : '>'} live ${liveYml.version}`
          : `Artifact ${yml.version} is older than live feed ${liveYml.version} — publishing it would strand OTA clients`,
      });
    } else {
      gates.push({
        id: 'ota-feed-vs-live',
        ok: true,
        detail: `Live feed is ${liveYml.version}; artifact is ${yml.version}`,
      });
    }
  }

  return gates;
}

async function fetchLiveYml() {
  const url = `${PUBLIC_FEED_URL}latest-mac.yml`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return parseLatestMacYml(await res.text());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const report = { repoRoot, publicFeed: PUBLIC_FEED_URL, gates: [] };
  let failed = false;

  if (!opts.skipSource) {
    for (const g of checkSource(repoRoot)) report.gates.push(g);
  }

  if (!opts.skipAsar) {
    const appPath = opts.app || findPlenumApp(repoRoot);
    const asarFile = appPath ? asarPathForApp(appPath) : null;
    if (!asarFile || !fs.existsSync(asarFile)) {
      report.gates.push({
        id: 'ota-asar-updater-present',
        ok: false,
        detail: 'No app.asar — pack first or pass --app (OTA cannot be verified without the packaged app)',
      });
    } else {
      for (const g of checkAsar(asarFile)) report.gates.push(g);
    }
  }

  if (!opts.skipFeed) {
    const artDir = opts.artifacts || path.join(repoRoot, 'release');
    const hasYml = fs.existsSync(path.join(artDir, 'latest-mac.yml'));
    if (!hasYml && !opts.artifacts) {
      report.gates.push({
        id: 'ota-feed-yml',
        ok: true,
        detail: 'No local latest-mac.yml yet (dir pack only) — CI dist artifacts are checked before publish',
      });
    } else {
      let live = null;
      if (opts.liveFeed) {
        try {
          live = await fetchLiveYml();
        } catch (err) {
          report.gates.push({
            id: 'ota-live-feed-fetch',
            ok: false,
            detail: String(err.message || err),
          });
        }
      }
      for (const g of checkArtifacts(artDir, {
        liveYml: live,
        requireNotOlderThanLive: Boolean(opts.liveFeed && live?.version),
      })) {
        report.gates.push(g);
      }
    }
  }

  for (const g of report.gates) {
    if (!g.ok) failed = true;
    if (!opts.json) console.log(`${g.ok ? '✓' : '✗'} ${g.id}: ${g.detail}`);
  }
  if (opts.json) process.stdout.write(`${JSON.stringify({ ...report, ok: !failed }, null, 2)}\n`);
  else {
    console.log(
      failed
        ? '\nota-health-check FAILED — this build must not ship (OTA self-heal at risk).'
        : '\nota-health-check OK — OTA loop invariants hold.',
    );
  }
  process.exit(failed ? 2 : 0);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
