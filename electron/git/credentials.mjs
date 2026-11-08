import { spawn, execFile } from 'node:child_process';
import { git } from './run.mjs';

const HOST = /^(?!-)[a-z0-9-]+(?:\.(?!-)[a-z0-9-]+)*(?::\d{1,5})?$/;

/** `https://Dev.Azure.com/org` or `dev.azure.com` -> `dev.azure.com`. Throws on anything that could smuggle protocol lines. */
export function sanitizeHost(input) {
  let h = String(input ?? '').trim().toLowerCase();
  if (/^http:\/\//.test(h)) throw new Error('Only https hosts are supported.');
  h = h.replace(/^https:\/\//, '').split(/[/?#]/)[0];
  if (!HOST.test(h)) throw new Error('Invalid host.');
  return h;
}

function clean(v, label) {
  const s = String(v ?? '');
  if (!s.trim() || /[\r\n\0]/.test(s)) throw new Error(`Invalid ${label}.`);
  return s;
}

/** Input for `git credential approve|reject`. Pure so the quoting rules are testable. */
export function credentialInput({ host, username, password }) {
  const lines = ['protocol=https', `host=${sanitizeHost(host)}`, `username=${clean(username, 'username')}`];
  if (password !== undefined) lines.push(`password=${clean(password, 'token')}`);
  return `${lines.join('\n')}\n\n`;
}

function credential(verb, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', verb], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `git credential ${verb} failed`))));
    child.stdin.end(input);
  });
}

export const approve = (entry) => credential('approve', credentialInput(entry));
export const reject = ({ host, username }) => credential('reject', credentialInput({ host, username }));

/** Prefs keep only host + username; the secret lives in the credential helper. */
export function upsertHost(list, { host, username, kind }) {
  const rest = (list || []).filter((e) => !(e.host === host && e.username === username));
  return [...rest, { host, username, kind: kind === 'github' ? 'github' : 'https' }];
}

export const removeHost = (list, host, username) =>
  (list || []).filter((e) => !(e.host === host && e.username === username));

export async function credentialHelper() {
  try {
    return (await git(['config', '--get-all', 'credential.helper'])).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Status only: Overlook never reads or writes keys. */
export function sshStatus() {
  return new Promise((resolve) => {
    execFile('ssh-add', ['-l'], { timeout: 3000 }, (err, stdout) => {
      if (!err) return resolve({ state: 'keys', count: stdout.trim().split('\n').filter(Boolean).length });
      resolve({ state: err.code === 1 ? 'none' : 'no-agent', count: 0 });
    });
  });
}
