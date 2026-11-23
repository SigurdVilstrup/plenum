#!/usr/bin/env node
/*
 * Create a feature lane, drop a PLAN.md from the template, print the checklist.
 *
 *   node scripts/feature-start.mjs <name> [--path <repo>] [--no-create]
 *
 * --no-create: only write PLAN.md into an existing lane named <name> (or cwd).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFERENCES,
  die,
  featureSlug,
  findLane,
  plenum,
  repoRootFrom,
} from './_lib.mjs';

const USAGE = `Usage: node feature-start.mjs <name> [--path <repo>] [--no-create]
`;

function parseArgs(argv) {
  const out = { name: null, path: null, noCreate: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.path = argv[++i];
    else if (a === '--no-create') out.noCreate = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.name = rest[0] || null;
  return out;
}

function fillTemplate(raw, name) {
  return raw.replaceAll('{{NAME}}', name);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.name) {
    process.stdout.write(USAGE);
    process.exit(opts.help ? 0 : 2);
  }

  const slug = featureSlug(opts.name);
  const repoRoot = repoRootFrom(opts.path || process.cwd());
  const templatePath = path.join(REFERENCES, 'plan-template.md');
  if (!fs.existsSync(templatePath)) die(`Missing plan template: ${templatePath}`);

  let board;
  if (!opts.noCreate) {
    console.log(`Creating lane "${slug}" in ${repoRoot}…`);
    board = plenum(repoRoot, ['create', slug, repoRoot], { json: true });
  } else {
    board = plenum(repoRoot, ['status', repoRoot], { json: true });
  }

  const lane = findLane(board, slug);
  if (lane.isPrimary) die('Refusing to write a feature plan on the protected lane.');

  const planDir = path.join(lane.path, '.plenum');
  fs.mkdirSync(planDir, { recursive: true });
  const planPath = path.join(planDir, 'PLAN.md');
  if (!fs.existsSync(planPath)) {
    fs.writeFileSync(planPath, fillTemplate(fs.readFileSync(templatePath, 'utf8'), slug), 'utf8');
    console.log(`Wrote ${planPath}`);
  } else {
    console.log(`Plan already exists: ${planPath}`);
  }

  console.log('');
  console.log(`Lane [${lane.index}] ${lane.name}  branch=${lane.branch}  ${lane.path}`);
  console.log('');
  console.log('Feature progress:');
  console.log('- [x] 1. Create lane');
  console.log('- [ ] 2. Comprehensive plan  → edit .plenum/PLAN.md');
  console.log('- [ ] 3. Plan review (UI / UX / technical)');
  console.log('         node …/scripts/… then subagents with references/review-*.md');
  console.log('- [ ] 4. Implement');
  console.log('- [ ] 5. Subagent tests (UI / UX / technical)');
  console.log('- [ ] 6. Visual pass');
  console.log('- [ ] 7. Implement all review changes');
  console.log('- [ ] 8. Ask: squash-merge into main now, or wait?');
  console.log('');
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  console.log(`cd ${lane.path}`);
  console.log(`npm run plenum -- status`);
  console.log(`node ${path.join(scripts, 'feature-check.mjs')} ${lane.index}`);
}

try {
  main();
} catch (err) {
  die(err.message || err, err.exitCode || 1);
}
