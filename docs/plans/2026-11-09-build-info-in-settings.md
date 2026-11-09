# Build commit in Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bake git commit + commit time into `electron/build-info.json` at build, expose them with semver over `app.version`, and show them on Settings → General.

**Architecture:** A tiny stamp script writes JSON from git; `readBuildInfo()` loads it in main; IPC returns `{ version, commit, committedAt }`; renderer formats the Version row. No runtime git. Stamp runs on Vite build and at the start of `dev.mjs`.

**Tech Stack:** Node `child_process` / `fs`, Electron IPC, existing Settings `settingsRow` HTML in `app/main.js`.

**Source of truth:** `docs/plans/2026-11-09-build-info-in-settings-design.md`

---

### Task 1: Stamp script + unit tests

**Files:**
- Create: `electron/build-info.mjs`
- Create: `electron/build-info.test.mjs`
- Create: `scripts/stamp-build-info.mjs`
- Modify: `package.json` (add test file to `test` script)

**Step 1: Write the failing test**

```js
// electron/build-info.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeBuildInfo, readBuildInfo } from './build-info.mjs';

test('writeBuildInfo uses git deps and readBuildInfo loads it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  const out = path.join(dir, 'build-info.json');
  writeBuildInfo(out, {
    shortHash: () => 'a1b2c3d',
    commitIso: () => '2026-11-09T01:37:00+01:00',
  });
  assert.deepEqual(readBuildInfo(out), {
    commit: 'a1b2c3d',
    committedAt: '2026-11-09T01:37:00+01:00',
  });
});

test('writeBuildInfo empties fields when git fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  const out = path.join(dir, 'build-info.json');
  writeBuildInfo(out, {
    shortHash: () => { throw new Error('no git'); },
    commitIso: () => { throw new Error('no git'); },
  });
  assert.deepEqual(readBuildInfo(out), { commit: '', committedAt: '' });
});

test('readBuildInfo returns empty on missing file', () => {
  assert.deepEqual(readBuildInfo('/tmp/definitely-missing-build-info.json'), {
    commit: '',
    committedAt: '',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test electron/build-info.test.mjs`

Expected: FAIL (module not found)

**Step 3: Minimal implementation**

```js
// electron/build-info.mjs
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
```

```js
// scripts/stamp-build-info.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from '../electron/build-info.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
writeBuildInfo(path.join(root, 'electron', 'build-info.json'));
```

**Step 4: Wire tests + run stamp once**

In `package.json` `test` script, add `electron/build-info.test.mjs` next to the other electron tests.

Run:

```bash
node --test electron/build-info.test.mjs
node scripts/stamp-build-info.mjs
cat electron/build-info.json
```

Expected: tests PASS; JSON has real short hash + ISO time.

**Step 5: Commit**

```bash
git add electron/build-info.mjs electron/build-info.test.mjs electron/build-info.json scripts/stamp-build-info.mjs package.json
git commit -m "feat: stamp build commit into electron/build-info.json"
```

---

### Task 2: Hook stamp into build + dev

**Files:**
- Modify: `package.json` (`build` script)
- Modify: `scripts/dev.mjs`

**Step 1: Prefixed build**

Change:

```json
"build": "node scripts/stamp-build-info.mjs && vite build"
```

(`prestart` already calls `vite build` via `npm run build` only if you point it — currently `"prestart": "vite build"`. Change `prestart` to `"npm run build"` OR keep `prestart` as `node scripts/stamp-build-info.mjs && vite build`. Prefer:

```json
"prestart": "npm run build",
"build": "node scripts/stamp-build-info.mjs && vite build",
"pack": "npm run build && electron-builder --mac --dir",
"dist": "npm run build && electron-builder --mac"
```

so pack/dist/start all stamp once via `build`.

**Step 2: Stamp in dev**

At the top of `scripts/dev.mjs` (before Vite server):

```js
import { spawnSync } from 'node:child_process';
spawnSync(process.execPath, ['scripts/stamp-build-info.mjs'], { stdio: 'inherit' });
```

**Step 3: Verify**

```bash
node scripts/stamp-build-info.mjs
npm run build
```

Expected: stamp refreshes; Vite succeeds.

**Step 4: Commit**

```bash
git add package.json scripts/dev.mjs
git commit -m "chore: stamp build-info on build and dev"
```

---

### Task 3: IPC returns version + build info

**Files:**
- Modify: `electron/main.mjs` (`app.version` handler ~line 134)

**Step 1: Change handler**

```js
import { readBuildInfo } from './build-info.mjs';
// near other imports / __dirname usage:
const buildInfoPath = path.join(__dirname, 'build-info.json');

ipcMain.handle('app.version', () => {
  const info = readBuildInfo(buildInfoPath);
  return {
    version: app.getVersion(),
    commit: info.commit,
    committedAt: info.committedAt,
  };
});
```

Preload already allows `app.version`; return shape change only — no allowlist edit.

**Step 2: Smoke from node (optional assert)**

No Electron unit harness required. Manual in Task 4.

**Step 3: Commit**

```bash
git add electron/main.mjs
git commit -m "feat: expose commit in app.version IPC"
```

---

### Task 4: Settings → General shows hash + time

**Files:**
- Modify: `app/main.js` (state, load, Version row, Agents badge)

**Step 1: State**

Replace `appVersion: ''` with:

```js
appInfo: { version: '', commit: '', committedAt: '' },
```

**Step 2: Load**

Where `state.appVersion = await invoke('app.version')` runs (~2055):

```js
try {
  const v = await invoke('app.version');
  state.appInfo = (v && typeof v === 'object')
    ? {
        version: String(v.version || ''),
        commit: String(v.commit || ''),
        committedAt: String(v.committedAt || ''),
      }
    : { version: String(v || ''), commit: '', committedAt: '' };
} catch {
  state.appInfo = { version: '', commit: '', committedAt: '' };
}
```

**Step 3: Format helper (same file, near other small helpers)**

```js
function formatCommitAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function versionDetailHTML() {
  const { version, commit, committedAt } = state.appInfo;
  const ver = esc(version || '…');
  if (!commit) return `<span class="mono">${ver}</span>`;
  const when = formatCommitAt(committedAt);
  const line2 = when ? `${esc(commit)} · ${esc(when)}` : esc(commit);
  return `<span class="mono">${ver}<br>${line2}</span>`;
}
```

**Step 4: Version row + Agents badge**

General Version row detail → `versionDetailHTML()` (keep bump hover text).

Agents CLI badge: `esc(state.appInfo.version || '…')` only.

Grep for any remaining `state.appVersion` and replace.

**Step 5: Manual check**

```bash
npm start
# or npm run pack and open the .app
```

Open Settings → General: see `0.1.0` plus short hash · local time. Agents badge: semver only.

**Step 6: Commit**

```bash
git add app/main.js
git commit -m "feat(settings): show build commit on Version row"
```

---

### Task 5: End-to-end verification

**Step 1:** `node --test electron/build-info.test.mjs` — PASS

**Step 2:** `npm test` — existing suite still green

**Step 3:** Confirm `electron/build-info.json` is tracked (not gitignored) so a fresh clone has a last-known stamp until the next build refreshes it

**Step 4:** No README change required unless you want one line under the version bump note — optional, skip unless asked

---

## Done when

- Stamp script + tests exist and pass
- `build` / `dev` refresh the stamp
- Packaged and unpackaged Settings → General show version + commit + commit time
- Semver bump habit unchanged (no bump-on-commit rule)
