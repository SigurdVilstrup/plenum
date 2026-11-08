# In-app feedback — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Ship local, UX-directed feedback: palette + panel row + Quick start entry, optional element pick, comment sheet with screenshot warning, ⌘↩ / Send feedback, full-window PNG with highlight + `meta.json` under `userData/feedback/`, toast with path.

**Architecture:** Renderer owns sheet + pick overlay. One IPC `feedback.save`. Main captures the window, composites highlight, writes one folder per report. No upload, no anonymization, no new deps.

**Tech Stack:** Existing Electron main + vanilla renderer (`app/main.js`, `sheet-layer`), `nativeImage` / `capturePage`, `node:test`, Phosphor icons already vendored in `app/lib/icons.js`.

**Source of truth:** `docs/plans/2026-11-09-in-app-feedback-design.md`, `planning/DESIGN.md` (sheets, palette, tokens, lavender primary).

**Non-goals:** GitHub/webhook/insights, redaction, title-bar button, Settings-page footer, analytics SDK.

---

## Process gate (every task)

Do **not** start Task N+1 until Task N has passed this gate.

After the task’s code and its own automated check are green:

1. **Spawn a UX review agent** — Does this step match the approved flow (easy to give feedback, pick optional, warning visible before send, toast with path, panel under Settings, palette + Quick start)? Flag friction, missing copy, wrong defaults.
2. **Spawn a UI review agent** — Does chrome match `planning/DESIGN.md` / existing sheet + panel patterns (tokens only, no new visual language, Phosphor only, quiet panel row, lavender pick highlight, reduced-motion)? Flag slop and token violations.
3. **Spawn a technical review agent** — IPC allowlist, path safety, capture/composite correctness, error handling (sheet stays open on failure), test coverage of the pure bits, no speculative abstractions.
4. **Correct every finding** from those three reviews, re-run the task’s check, then commit.
5. Only then move to the next task.

Use fresh subagents per review (UX / UI / technical). Keep reviews short and actionable; fix in-repo before proceeding.

**Final gate (after Task 6):** run a Hallmark smoke on the live feature (see Task 7). Do not call the feature done until that pass is clean.

---

### Task 0: Plan lock

**Files:**
- Verify: `docs/plans/2026-11-09-in-app-feedback-design.md`
- Verify: `docs/plans/2026-11-09-in-app-feedback.md` (this file)

**Step 1:** Confirm design + this plan are on the branch (already written).

**Step 2: Process gate** — UX/UI/technical agents skim design vs plan for contradictions; fix the plan if needed.

**Step 3: Commit** only if the gate changed files; otherwise skip.

---

### Task 1: Pure save helpers + test

**Files:**
- Create: `electron/feedback.mjs`
- Create: `electron/feedback.test.mjs`
- Modify: `package.json` — add `electron/feedback.test.mjs` to the `test` script if not covered by a glob

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMeta, writeFeedbackReport, paintHighlight } from './feedback.mjs';

test('buildMeta shapes v1 report', () => {
  const meta = buildMeta({
    comment: 'Behind is too quiet',
    target: { label: 'Behind', rect: { x: 1, y: 2, w: 3, h: 4 } },
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: '/tmp/repo',
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.version, 1);
  assert.equal(meta.comment, 'Behind is too quiet');
  assert.deepEqual(meta.target.rect, { x: 1, y: 2, w: 3, h: 4 });
});

test('writeFeedbackReport writes meta.json and window.png', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-fb-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const out = await writeFeedbackReport(dir, {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png,
  });
  assert.ok(fs.existsSync(path.join(out, 'meta.json')));
  assert.ok(fs.existsSync(path.join(out, 'window.png')));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.comment, 'hi');
  assert.equal(meta.target, null);
});

test('paintHighlight returns a PNG buffer', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC',
    'base64',
  );
  const out = await paintHighlight(png, { x: 1, y: 1, w: 4, h: 4 });
  assert.ok(Buffer.isBuffer(out));
  assert.ok(out.length > 0);
});
```

**Step 2: Run — expect FAIL**

```bash
node --test electron/feedback.test.mjs
```

**Step 3: Minimal implementation in `electron/feedback.mjs`**

- `buildMeta(input)` → plain object `version: 1`, trim comment, `target` null or `{ label, rect }`.
- `writeFeedbackReport(baseDir, { …, png })` → mkdir `feedback/<ISO-id>/` under `baseDir` (or accept full parent `feedbackRoot`), write `meta.json` + `window.png`, return absolute folder path.
- `paintHighlight(pngBuffer, rect)` → use Electron `nativeImage` when available; for unit test, either:
  - export a pure path that draws via `nativeImage.createFromBuffer` + re-encode when `electron` loads, **or**
  - keep composite in main and test only `buildMeta` + write with a pre-painted buffer.

Prefer: implement `paintHighlight` with `nativeImage` in the main-side module; if `node --test` cannot load Electron, split:

- `electron/feedback-meta.mjs` — pure meta + filesystem write (tested under plain node)
- composite stays next to the IPC handler and is exercised manually / Hallmark smoke

Ponytail default: **pure meta + write tested; composite in the IPC path with a one-line `ponytail:` note that Hallmark smoke covers the highlight.**

**Step 4: Run — expect PASS**

```bash
node --test electron/feedback.test.mjs
# or electron/feedback-meta.test.mjs if split
```

**Step 5: Process gate** — UX (schema enough for later upload?), UI (n/a for pure module), technical (path escape, id uniqueness, JSON pretty or compact — pick compact).

**Step 6: Commit**

```bash
git add electron/feedback*.mjs package.json
git commit -m "feat(feedback): local report folder helpers"
```

---

### Task 2: IPC `feedback.save` + preload allowlist

**Files:**
- Modify: `electron/main.mjs` — handler using `win.webContents.capturePage()`, optional highlight, `writeFeedbackReport(prefsDir()/…)`
- Modify: `electron/preload.cjs` — add `'feedback.save'` to `ALLOWED`
- Modify: `electron/feedback.mjs` (or sibling) if composite lives here

**Step 1:** Handler contract:

```js
// payload: { comment: string, target?: { label: string, rect: { x,y,w,h } } | null }
// returns: { dir: string }
ipcMain.handle('feedback.save', async (_e, payload) => { /* … */ });
```

- Reject empty/whitespace comment with a thrown Error (renderer toasts).
- `capturePage()` after renderer has closed pick overlay and while sheet may still be open — **design choice:** hide sheet (and pick overlay) immediately before invoke so the screenshot is the product UI, not the modal. Document in code: sheet closes → capture → on failure reopen with comment (or capture under scrim-free board). **Approved UX:** warning is before send; screenshot should be the app surface. So: close sheet → `requestAnimationFrame` / short `setTimeout(0)` → invoke save → toast. If save fails, reopen sheet with comment restored.
- Draw highlight on PNG when `target.rect` present (lavender from design token approx `#5e6ad2` at ~25% fill + stroke — match `--primary` in mock CSS).
- Include `app.getVersion()`, `process.platform`, active repo path if any.

**Step 2: Manual smoke from DevTools later;** no unit test for capture.

**Step 3: Process gate** — UX (capture without dialog chrome), UI (highlight colour = primary token), technical (allowlist, no path traversal from client).

**Step 4: Commit**

```bash
git add electron/main.mjs electron/preload.cjs electron/feedback*.mjs
git commit -m "feat(feedback): save screenshot report over IPC"
```

---

### Task 3: Feedback sheet + pick overlay (renderer)

**Files:**
- Modify: `app/main.js` — `openFeedbackSheet()`, pick mode, ⌘↩ / Send, Point at something
- Modify: `app/index.html` — optional `#feedback-pick-layer` root (or create in JS)
- Modify: `app/styles/app.css` and/or `app/styles/mock.css` — pick overlay + target chip only; reuse `.sheet` / `.modal` / `.btn`
- Modify: `app/lib/icons.js` — add one Phosphor symbol if missing (e.g. `chat-teardrop-text` / `chat-circle`)

**Step 1: Sheet copy (must include warning)**

- Eyebrow / title in existing sheet pattern (product already uses eyebrow on sheets — keep consistency with DESIGN mocks; do not invent a marketing eyebrow on a landing page).
- Comment textarea, autofocus.
- Target row: chip or “None” + button **Point at something** + clear.
- Warning paragraph (plain): saving stores a **full-window screenshot of what is visible right now** on this Mac; nothing is uploaded.
- Footer: Cancel · **Send feedback** (primary). Hint `⌘↩`.

**Step 2: Pick mode**

- Full-window overlay, `pointer-events`, `elementFromPoint` under cursor (elements with `data-feedback-ignore` / overlay itself skipped).
- Hover outline via a single absolutely positioned box (transform/opacity only for motion; no `transition: all`).
- Click → store `{ label, rect: getBoundingClientRect() }` → tear down overlay → reopen sheet with chip.
- Esc → cancel pick, restore sheet.

**Step 3: Submit**

- Validate comment.
- Close sheet → await `invoke('feedback.save', { comment, target })` → `toast(\`Feedback saved locally · ${pretty}\`, 'ok')` using `os.displayPath` when available.
- On error: toast error, `openFeedbackSheet` again with prior comment/target.

**Step 4: Process gate** — UX (warning before send, pick optional, ⌘↩ + button), UI (sheet tokens, focus-visible, reduced-motion), technical (no XSS in chip label — use `esc()`).

**Step 5: Commit**

```bash
git add app/main.js app/index.html app/styles/app.css app/styles/mock.css app/lib/icons.js
git commit -m "feat(feedback): sheet, pick overlay, and send"
```

---

### Task 4: Entry points — palette, panel, Quick start

**Files:**
- Modify: `app/main.js` — `paletteCommands()`, `panel-foot` HTML under Settings, `openQuickStartSheet()` row

**Step 1: Palette**

```js
{ id: 'feedback', label: 'Feedback…', run: openFeedbackSheet, match: ['tell me', 'report', 'feedback'] }
```

Extend `renderPalette` filter so `match` terms count (tiny change to existing includes check).

**Step 2: Panel foot**

```html
<div class="panel-foot">
  <button … data-settings>Settings ⌘,</button>
  <button … data-feedback>Feedback</button>
</div>
```

Bind `data-feedback` → `openFeedbackSheet`.

**Step 3: Quick start**

Add one list row: Feedback — ⌘K → Feedback…, or under Settings. Point at UI optional; saved on this Mac.

**Step 4: Process gate** — UX (discoverable but quiet), UI (panel row not louder than Settings), technical (works with no repo / empty state via palette).

**Step 5: Commit**

```bash
git add app/main.js
git commit -m "feat(feedback): palette, panel row, quick start"
```

---

### Task 5: Wire automated check into `npm test`

**Files:**
- Modify: `package.json` if Task 1 did not already
- Re-run full suite

**Step 1:**

```bash
npm test
```

Expected: all existing tests + feedback helper tests PASS.

**Step 2: Process gate** — technical only (suite green). UX/UI agents: confirm no regressions in entry copy if Quick start changed.

**Step 3: Commit** only if `package.json` still dirty.

---

### Task 6: Manual dogfood pass (pre-Hallmark)

**Steps (human or agent driving the app):**

```bash
OVERLOOK_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Checklist:

1. ⌘K → Feedback… → sheet opens; warning visible; Esc closes.
2. Send with empty comment → blocked.
3. Comment only → Send feedback → toast with path; folder has `meta.json` + `window.png`; PNG has **no** dialog chrome.
4. Point at Behind (or any lane meta) → chip → ⌘↩ → PNG shows highlight on that region.
5. Panel Feedback row under Settings opens the same sheet.
6. Quick start mentions Feedback.
7. Failure injection (optional): chmod deny write → toast error, comment preserved.

**Process gate:** UX + UI + technical agents review the checklist evidence (screenshots of sheet, pick hover, toast, folder listing). Fix before Task 7.

**Commit** any fixes.

---

### Task 7: Hallmark smoke + correct

**Required skill:** `@hallmark` (`/Users/sigurdvilstrup/.agents/skills/hallmark/SKILL.md`).

This is an **existing app screen** inside Overlook’s locked system (`planning/DESIGN.md`). Do **not** deal a new marketing theme. Run Hallmark as **audit → fix in-system**:

1. `/hallmark audit` the feedback sheet, pick overlay, panel foot row, and toast copy against:
   - Floor rules that still apply inside an app (tokens, no `transition: all`, focus-visible, reduced-motion, no purple-blue gradient slop, Phosphor not emoji).
   - `planning/DESIGN.md` sheet / panel / lavender primary rules.
2. Capture the live UI (`scripts/capture.mjs` or Electron screenshots from the running app).
3. Fix every FAIL and unjustified Reflex finding that applies to this chrome.
4. Re-capture; stop when audit is clean for the feedback surfaces.
5. Process gate one last time (UX / UI / technical) on the corrected UI.
6. Commit:

```bash
git commit -m "fix(feedback): hallmark pass on sheet and pick UI"
```

**Done criteria:** design doc behaviors all true in the running app; `npm test` green; Hallmark audit clean on feedback surfaces; three review agents have no open blockers.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-11-09-in-app-feedback.md` (design: `docs/plans/2026-11-09-in-app-feedback-design.md`).

**Two execution options:**

1. **Subagent-Driven (this session)** — fresh subagent per task; mandatory UX + UI + technical reviews between tasks; Hallmark smoke at the end.
2. **Parallel Session (separate)** — new session with executing-plans on this file; same gates.

Which approach?
