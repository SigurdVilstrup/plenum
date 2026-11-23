#!/usr/bin/env node
/*
 * Flag commit messages that are not updates-ready for a public OSS changelog.
 *
 *   node scripts/commit-msg-check.mjs <msg-file>     # git commit-msg hook style
 *   node scripts/commit-msg-check.mjs --stdin
 *   echo "wip" | node scripts/commit-msg-check.mjs --stdin
 *
 * Exit 0 = ok, 2 = rejected, 1 = usage/error.
 */
import fs from 'node:fs';
import { die } from './_lib.mjs';

const USAGE = `Usage: node commit-msg-check.mjs <msg-file> | --stdin
`;

const SUBJECT_BAD = [
  /^(wip|tmp|temp|tempfix|fixup|squash!|amend!|dont\s*commit|dnm)\b/i,
  /^(asdf|test|testing|xxx|yyy|zzz)\s*$/i,
  /^[.]{2,}$/,
];

const BODY_SECRETISH = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/,
  /\b(api[_-]?key\s*[:=]\s*\S+)/i,
  /\/Users\/\S+/,
  /\/home\/\S+/,
];

function parseArgs(argv) {
  const out = { file: null, stdin: false };
  for (const a of argv) {
    if (a === '--stdin') out.stdin = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-') && !out.file) out.file = a;
  }
  return out;
}

function readMessage(opts) {
  if (opts.stdin) return fs.readFileSync(0, 'utf8');
  if (opts.file) return fs.readFileSync(opts.file, 'utf8');
  return null;
}

function stripComments(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

function check(raw) {
  const text = stripComments(raw);
  const findings = [];
  if (!text) {
    findings.push({ severity: 'error', message: 'Empty commit message' });
    return findings;
  }
  const lines = text.split(/\r?\n/);
  const subject = (lines[0] || '').trim();
  if (!subject) findings.push({ severity: 'error', message: 'Empty subject' });
  if (subject.length > 72) {
    findings.push({ severity: 'warn', message: `Subject is ${subject.length} chars (prefer ≤72 for update feeds)` });
  }
  for (const re of SUBJECT_BAD) {
    if (re.test(subject)) {
      findings.push({ severity: 'error', message: `Subject looks like WIP noise: "${subject}"` });
      break;
    }
  }
  if (/^(fix|fixed|update|updated|changes|misc)\b/i.test(subject) && subject.split(/\s+/).length < 4) {
    findings.push({ severity: 'error', message: 'Subject is too vague for a public update note' });
  }
  for (const re of BODY_SECRETISH) {
    if (re.test(text)) {
      findings.push({ severity: 'error', message: `Possible secret or machine path in message (${re})` });
    }
  }
  const isSquashFeature = /\b(feat|feature|add|added)\b/i.test(subject);
  if (isSquashFeature && lines.length === 1) {
    findings.push({
      severity: 'warn',
      message: 'Feature/squash subjects usually need a body that states what was added for users',
    });
  }
  return findings;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const raw = readMessage(opts);
  if (raw == null) {
    process.stdout.write(USAGE);
    process.exit(2);
  }
  const findings = check(raw);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  for (const f of findings) {
    console.log(`${f.severity === 'error' ? '✗' : '!'} ${f.message}`);
  }
  if (!findings.length) console.log('✓ commit message looks updates-ready');
  if (errors.length) process.exit(2);
  if (warns.length) process.exit(0);
}

try {
  main();
} catch (err) {
  die(err.message || err, err.exitCode || 1);
}
