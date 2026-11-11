import fs from 'node:fs';
import path from 'node:path';
import { RUN_HOME, env } from '../paths.mjs';

export const agentsHome = () => env('HOME', RUN_HOME);

export function defaultAgentSettings() {
  return { version: 1, run: true, create: true, remove: 'allow', writeSetup: 'never' };
}

const BOOLS = ['run', 'create'];
const ENUMS = { remove: ['allow', 'never'], writeSetup: ['allow', 'never'] };

const file = (home) => path.join(home, 'agents.json');

export function getAgentSettings(home = agentsHome()) {
  const out = defaultAgentSettings();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file(home), 'utf8')); } catch { return out; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  for (const k in ENUMS) if (ENUMS[k].includes(raw[k])) out[k] = raw[k];
  return out;
}

export function setAgentSettings(partial, home = agentsHome()) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const next = getAgentSettings(home);
  for (const k of BOOLS) if (k in p) next[k] = Boolean(p[k]);
  for (const k in ENUMS) if (ENUMS[k].includes(p[k])) next[k] = p[k];
  fs.mkdirSync(home, { recursive: true });
  const tmp = file(home) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file(home));
  return next;
}
