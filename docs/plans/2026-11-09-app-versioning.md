# App versioning + feedback env — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Show the live app version on Settings → General, bump it via thin `npm version` scripts, and stamp richer machine/env facts into every feedback `meta.json`.

**Architecture:** `package.json` remains the only version source. Main exposes `app.version` and fills feedback env in `feedback.save`. Renderer caches the version string and renders it on General + Agents. No new deps.

**Tech Stack:** Electron (`app.getVersion()`, `screen`, `BrowserWindow`), Node `os` / `process`, existing `settingsRow` UI, `node:test`.

**Source of truth:** `docs/plans/2026-11-09-app-versioning-design.md`

**Non-goals:** About window, title-bar badge, changelog, CI auto-bump, hostname/username in meta, schema bump of `meta.version` (stay at `1`).

---

### Task 1: Enrich feedback meta + env helper (TDD)

**Files:**
- Modify: `electron/feedback.mjs`
- Modify: `electron/feedback.test.mjs`
- Modify: `electron/main.mjs` (wire `feedback.save` + import `screen` if needed)
- Modify: `package.json` only if the test script needs an explicit path (already includes `electron/feedback.test.mjs`)

**Step 1: Extend failing assertions in `electron/feedback.test.mjs`**

```js
test('buildMeta passes through env fields', () => {
  const meta = buildMeta({
    comment: 'x',
    appVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    screens: [{ width: 1512, height: 982, scaleFactor: 2, primary: true }],
    windowSize: { width: 1280, height: 800 },
    repoPath: null,
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.arch, 'arm64');
  assert.equal(meta.osVersion, '25.3.0');
  assert.equal(meta.electronVersion, '39.0.0');
  assert.equal(meta.locale, 'en-US');
  assert.deepEqual(meta.screens, [{ width: 1512, height: 982, scaleFactor: 2, primary: true }]);
  assert.deepEqual(meta.windowSize, { width: 1280, height: 800 });
});

test('collectFeedbackEnv shapes display + window facts', () => {
  const env = collectFeedbackEnv({
    getVersion: () => '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    getSystemVersion: () => '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    getAllDisplays: () => [
      { bounds: { width: 1512, height: 982 }, scaleFactor: 2, id: 1 },
      { bounds: { width: 1920, height: 1080 }, scaleFactor: 1, id: 2 },
    ],
    primaryDisplayId: 1,
    getContentSize: () => [1280, 800],
  });
  assert.equal(env.appVersion, '0.1.0');
  assert.equal(env.platform, 'darwin');
  assert.equal(env.arch, 'arm64');
  assert.equal(env.osVersion, '25.3.0');
  assert.equal(env.screens[0].primary, true);
  assert.equal(env.screens[1].primary, false);
  assert.deepEqual(env.windowSize, { width: 1280, height: 800 });
});
```

**Step 2: Run to verify fail**

```bash
node --test electron/feedback.test.mjs
```

Expected: FAIL (`collectFeedbackEnv` missing and/or env keys absent from `buildMeta`).

**Step 3: Minimal implementation in `electron/feedback.mjs`**

- Extend `buildMeta` to pass through: `arch`, `osVersion`, `electronVersion`, `locale`, `screens`, `windowSize` (alongside existing fields).
- Export `collectFeedbackEnv(deps)` that returns that object from the injected deps bag (no Electron import inside the helper — main builds the bag).

```js
export function collectFeedbackEnv(deps) {
  const primaryId = deps.primaryDisplayId;
  return {
    appVersion: String(deps.getVersion()),
    platform: deps.platform,
    arch: deps.arch,
    osVersion: String(deps.getSystemVersion()),
    electronVersion: String(deps.electronVersion),
    locale: String(deps.locale || ''),
    screens: (deps.getAllDisplays() || []).map((d) => ({
      width: Number(d.bounds?.width) || 0,
      height: Number(d.bounds?.height) || 0,
      scaleFactor: Number(d.scaleFactor) || 1,
      primary: d.id === primaryId,
    })),
    windowSize: {
      width: Number(deps.getContentSize()?.[0]) || 0,
      height: Number(deps.getContentSize()?.[1]) || 0,
    },
  };
}
```

**Step 4: Wire `feedback.save` in `electron/main.mjs`**

```js
import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron';
import { paintHighlight, writeFeedbackReport, collectFeedbackEnv } from './feedback.mjs';
// inside handler, merge:
const env = collectFeedbackEnv({
  getVersion: () => app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  getSystemVersion: () => process.getSystemVersion(),
  electronVersion: process.versions.electron,
  locale: app.getLocale(),
  getAllDisplays: () => screen.getAllDisplays(),
  primaryDisplayId: screen.getPrimaryDisplay().id,
  getContentSize: () => win.getContentSize(),
});
const dir = await writeFeedbackReport(prefsDir(), {
  comment,
  target: /* existing */,
  ...env,
  repoPath: activePath(),
  png,
});
```

**Step 5: Run tests**

```bash
node --test electron/feedback.test.mjs
```

Expected: PASS. Also update existing `buildMeta` / `writeFeedbackReport` fixtures if they must supply new optional fields (prefer optional passthrough so old calls still work).

**Step 6: Commit**

```bash
git add electron/feedback.mjs electron/feedback.test.mjs electron/main.mjs
git commit -m "$(cat <<'EOF'
feat(feedback): stamp app version and machine env into meta

EOF
)"
```

---

### Task 2: Expose `app.version` to the renderer

**Files:**
- Modify: `electron/main.mjs`
- Modify: `electron/preload.cjs`

**Step 1: Add handler + allowlist**

```js
// main.mjs
ipcMain.handle('app.version', () => app.getVersion());
```

```js
// preload.cjs — add to ALLOWED
'app.version',
```

**Step 2: Smoke from a one-liner (optional)** — no unit test required for a one-line IPC; verified in Task 3 UI.

**Step 3: Commit**

```bash
git add electron/main.mjs electron/preload.cjs
git commit -m "$(cat <<'EOF'
feat: expose app.version over IPC

EOF
)"
```

---

### Task 3: Settings → General version row + Agents badge

**Files:**
- Modify: `app/main.js` — `state`, `boot`, `SETTINGS_PAGES.general`, `SETTINGS_PAGES.agents`

**Step 1: State + boot fetch**

```js
// state
appVersion: '',

// boot(), after prefs.get
try {
  state.appVersion = await invoke('app.version');
} catch { state.appVersion = ''; }
```

**Step 2: General — first list after lede**

Insert before the “Open with” group:

```js
<div class="group-head">About</div>
<div class="list">
  ${settingsRow(
    'stack',
    'Version',
    '',
    `<span class="mono">${esc(state.appVersion || '…')}</span>`,
    '',
    'From package.json. Bump with npm run version:patch (or minor/major) before pack.',
  )}
</div>
```

**Step 3: Agents CLI badge** — replace hardcoded `0.1.0` with `esc(state.appVersion || '…')`.

**Step 4: Manual check**

```bash
npm run dev
```

Open Settings → General: version matches `package.json`. Agents → CLI badge matches.

**Step 5: Commit**

```bash
git add app/main.js
git commit -m "$(cat <<'EOF'
feat(settings): show live app version on General

EOF
)"
```

---

### Task 4: Bump scripts + README

**Files:**
- Modify: `package.json` — scripts
- Modify: `README.md` — Mac app section

**Step 1: Scripts**

```json
"version:patch": "npm version patch",
"version:minor": "npm version minor",
"version:major": "npm version major"
```

**Step 2: README** (under Mac app / Scripts)

One line: before `npm run pack`, bump with `npm run version:patch` (or `minor` / `major`). That updates `package.json` and tags `v*`.

**Step 3: Do not run `npm version` in this task** (would dirty the tree / create a tag). Verify scripts exist:

```bash
node -e "const p=require('./package.json'); console.log(p.scripts['version:patch'])"
```

Expected: `npm version patch`

**Step 4: Commit**

```bash
git add package.json README.md
git commit -m "$(cat <<'EOF'
chore: add version bump scripts and README note

EOF
)"
```

---

### Task 5: Verify end-to-end

**Step 1:** `npm test` — all green.

**Step 2:** `npm run pack` (optional if time) — confirm General still shows the packaged version.

**Step 3:** Send one feedback report; open `meta.json` under `~/Library/Application Support/Overlook/feedback/…` and confirm `appVersion`, `arch`, `osVersion`, `screens`, `windowSize` present.

**Step 4:** No commit unless verification found fixes — then fix + commit those.

---

## Done when

- Settings → General shows live version from `app.getVersion()`.
- Agents CLI badge is not hardcoded.
- Feedback `meta.json` includes the approved env block.
- `npm run version:patch|minor|major` exist and README mentions them.
