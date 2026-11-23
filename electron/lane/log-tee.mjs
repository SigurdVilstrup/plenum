#!/usr/bin/env node
/**
 * Prefix each stdout/stderr line with a local HH:mm:ss stamp and append to a log file.
 * Spawned as the supervised process so logging survives CLI `up` exit.
 *
 * Usage: node log-tee.mjs <logPath> <shell-command>
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const logPath = process.argv[2];
const command = process.argv[3];
if (!logPath || command == null || command === '') {
  process.stderr.write('usage: log-tee <logPath> <shell-command>\n');
  process.exit(2);
}

const out = fs.createWriteStream(logPath, { flags: 'a' });

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function attach(stream) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      // Preserve CR-only noise as plain text; drop lone empty trailing handled by split.
      out.write(`${stamp()} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf) {
      out.write(`${stamp()} ${buf}\n`);
      buf = '';
    }
  });
}

const child = spawn(String(command), {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
  cwd: process.cwd(),
});

attach(child.stdout);
attach(child.stderr);

child.on('error', (err) => {
  try { out.write(`${stamp()} [plenum] ${err.message}\n`); } catch { /* */ }
  out.end(() => process.exit(1));
});

child.on('exit', (code, signal) => {
  const exit = () => process.exit(code == null ? (signal ? 1 : 0) : code);
  if (!out.writable || out.writableFinished) exit();
  else out.end(exit);
});
