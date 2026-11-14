import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load KEY=VALUE pairs from a .env file into process.env (does not override existing). */
export function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = val;
  }
  return true;
}

/** Repo-root `.env` next to package.json (dev + unpackaged start). */
export function loadRepoEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return loadEnvFile(path.join(root, '.env'));
}
