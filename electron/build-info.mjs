import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function defaultGit() {
  return {
    shortHash: () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    commitIso: () => execFileSync('git', ['log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim(),
  };
}

export function writeBuildInfo(outPath, git = defaultGit()) {
  let commit = '';
  let committedAt = '';
  try {
    commit = String(git.shortHash() || '').trim();
    committedAt = String(git.commitIso() || '').trim();
  } catch {
    commit = '';
    committedAt = '';
  }
  fs.writeFileSync(outPath, `${JSON.stringify({ commit, committedAt }, null, 2)}\n`);
}

export function readBuildInfo(filePath) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      commit: String(j.commit || ''),
      committedAt: String(j.committedAt || ''),
    };
  } catch {
    return { commit: '', committedAt: '' };
  }
}
