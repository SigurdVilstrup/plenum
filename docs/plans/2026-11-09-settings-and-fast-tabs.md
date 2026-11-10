# Plenum: Settings + Fast Tabs + Authorship + Quick Start

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task in this session.
> After each task: (1) implementer subagent, (2) **spec + UI/UX review** subagent, (3) **tech/code-quality review** subagent. Loop fix → re-review until both reviews approve before starting the next task.
> Final task uses `/hallmark` (audit then fix) against Plenum's locked `planning/DESIGN.md` — do not invent a new visual system; correct floor/reflex issues inside the existing mock language.

**Goal:** Ship an in-window Settings page (Lane setup leaves the dialog), snappy warm tab switching, quieter AI authorship pills, and an on-demand Quick start sheet — without first-run tours or multi-window boards.

**Architecture:**
- Settings = renderer view swap (`#settings`); prefs in `userData/prefs.json`.
- Warm tabs = renderer-side board JSON cache keyed by tab id; one painted board; background `board.get(path)` while warm.
- Authorship = shared pill helper; classification unchanged in `electron/git/board.mjs`.
- Quick start = existing sheet-layer pattern; palette only; never auto-opens.

**Tech Stack:** Electron + Vite + vanilla JS, `node --test`, no new deps. Git credential helper for Accounts. CSS tokens for Appearance font packs.

**Sources of truth:**
- This plan
- Settings mocks: [`planning/mocks/settings.html`](planning/mocks/settings.html), [`planning/mocks/setup.html`](planning/mocks/setup.html)
- Product/design: [`planning/PRODUCT.md`](planning/PRODUCT.md), [`planning/DESIGN.md`](planning/DESIGN.md)
- Fast-tabs / authorship / quick-start: design approved 9 Nov 2026 (included below as locked decisions; saved to `docs/plans/` in Task 0)

**Merge note:** The 9 Nov fast-tabs design said “no full Settings app” and put TTL only in a palette sheet. **Superseded:** Settings ships in this plan. `warmTabTtlMs` lives in **General** and also via palette **“Tab warm time…”** (same prefs field).

---

## Locked product decisions

### Settings
- Nav: General · Appearance · Accounts · Repositories · Agents (no Integrations)
- Lane setup = per repository under Repositories (not a dialog)
- Diff/Merge: **Internal (coming soon)** + external
- Accounts v1: GitHub PAT + generic HTTPS via `git credential`; SSH status-only; OAuth later
- Appearance: System/Light/Dark, zoom steps, three font packs
- Default lanes folder in General; per-repo override on Repositories

### Authorship pill
| Kind | Visible | `title` |
| --- | --- | --- |
| assisted + tool | sparkle + tool name | Assisted by Cursor |
| agent + tool | robot + tool name | Agent: Cursor |
| mixed + tool | git-merge + tool name | Mixed authorship (Cursor) |
| kind, no tool | icon + kind label | kind word |
| human | no pill | — |

Author column unchanged. Prefer tool name over `Assisted, Cursor`.

### Warm tab cache
- One window, one painted board; renderer cache only (no BrowserView / hidden DOM)
- Snapshot on leave; interval refresh ~15–30s while warm; TTL default 2 min then `frozen`
- Frozen: keep last board for one instant switch, then thaw with full refresh
- Cap 4 entries; drop on tab close; evict oldest `leftAt`
- Prefs: `warmTabTtlMs` default `120000`, clamp `30000…600000`
- Success: hop-back within TTL = no loading screen, board in one frame when cache hit
- Escalation (not now): hide/show DOM — mark `// ponytail: warm board JSON only; escalate to hide/show DOM if paint dominates`

### Quick start
- Never auto-opens
- Palette: “Quick start” / “What are lanes?”
- One sheet: Plenum vs normal client, Lane, Protected main, Behind, Authorship, one line on phase-two runnable lanes
- Plain PRODUCT.md voice; Esc / backdrop / Done

---

## Execution protocol (every task)

```text
1. Implementer: only this task; TDD where specified; commit when green
2. UI/UX review: mocks/PRODUCT/DESIGN + this plan's tables; FAIL → fix loop
3. Tech review: IPC, secrets, tests, ponytail; FAIL → fix loop
4. Mark complete only when both approve
5. Do not start N+1 until N approved
```

**Smoke:** `PLENUM_OPEN="$PWD/tmp/smoke-repo" npm run dev`

---

## Prefs schema (canonical)

`{userData}/prefs.json`:

```json
{
  "version": 1,
  "theme": "system",
  "zoom": 1,
  "fontPack": "system",
  "editor": "cursor",
  "editorPath": "",
  "openLaneInEditor": true,
  "terminal": "terminal",
  "terminalPath": "",
  "diffTool": "internal",
  "diffToolPath": "",
  "mergeTool": "internal",
  "mergeToolPath": "",
  "cloneDefaultPath": "",
  "defaultLanesFolder": ".worktrees",
  "reopenTabs": true,
  "warmTabTtlMs": 120000,
  "credentialHosts": [],
  "repoOverrides": {}
}
```

---

### Task 0: Persist designs + plan in repo

**Files:**
- Create: `docs/plans/2026-11-09-settings-page-design.md`
- Create: `docs/plans/2026-11-09-fast-tabs-authorship-quickstart-design.md` (full approved 9 Nov design text)
- Create: `docs/plans/2026-11-09-settings-and-fast-tabs.md` (this implementation plan body)

**Commit:** `docs: settings, fast tabs, authorship, quick start plans`

**Review:** Spec only.

---

### Task 1: Prefs store + IPC (TDD)

**Files:** Create `electron/prefs.mjs`, `electron/prefs.test.mjs`; wire `prefs.get` / `prefs.set` in `electron/main.mjs`; extend `package.json` test glob.

**Include** `warmTabTtlMs` in `defaultPrefs()` with clamp on set (30s–10m).

**Tests:** defaults when missing; merge persist; clamp TTL.

**Commit:** `feat: add prefs store and IPC`

---

### Task 2: Authorship pill (tool name)

**Files:**
- Create: `app/lib/authorship-pill.js` (+ `app/lib/authorship-pill.test.js` if Node can import; else colocate tiny test under `app/lib/*.test.js` and add to test script)
- Modify: `app/main.js`, `app/lib/graph-live.js` — use `authorshipPillHTML(kind, tool)`
- Detection unchanged in `electron/git/board.mjs`

**Helper behavior:** match the table above; reuse existing `authorIcon` / kind CSS classes (`.pill.assisted` etc.).

**Tests:** assisted+Cursor → visible “Cursor”, title “Assisted by Cursor”; no tool → kind label; human → empty.

**Commit:** `feat: authorship pill prefers tool name`

**Reviews:** UI — tip + lane header both updated; Tech — one helper, no classification churn.

---

### Task 3: Warm tab cache

**Files:**
- Create: `app/lib/warm-tabs.js` — pure helpers: `shouldFreeze(leftAt, now, ttlMs)`, `evictOldest(entries, max=4)`, maybe `createEntry` / `markFrozen`
- Create: `app/lib/warm-tabs.test.js`
- Modify: `app/main.js` — `selectTab`, tab close, snapshot on leave, intervals
- Confirm `board.get` IPC accepts path (already in main); use it for background refresh, not `repo.refresh`

**Lifecycle (implement exactly):**
1. Leave A→B: snapshot A (`board`, `selectedLane`, `leftAt`, start interval); paint B from warm if present (no loading); else cold `tabs.select` + board
2. Background: every 15–30s while `!frozen`, `board.get(path)` → update cache only; errors silent
3. TTL: freeze (clear interval, keep board); frozen hit → paint cache then `refresh()` thaw
4. Close tab / new tab id → drop entry; max 4
5. Active tab: keep existing focus/`refresh()` 

**Optimistic selectTab flow:** as in design (paintTabs → warm apply → await tabs.select → cold or thaw).

**ponytail comment** at cache module top for DOM escalation ceiling.

**Commit:** `feat: warm tab board cache`

**Reviews:**
- UX: hop-back within TTL no loading screen; freeze then thaw feels intentional
- Tech: no toast spam; timers cleared; tests for freeze/evict math

---

### Task 4: Quick start sheet

**Files:** Modify `app/main.js` — `openQuickStartSheet()`; palette entries matching “Quick start” and “What are lanes?”; light CSS only if needed.

**Content:** six short blocks per locked list; PRODUCT voice; Done button.

**Manual:** palette opens; Esc/backdrop closes; no auto-show on boot.

**Commit:** `feat: on-demand quick start sheet`

---

### Task 5: Settings shell

**Files:** `app/index.html` (`#settings`), `app/main.js` (`state.settings`, open/close/render, `⌘,`, Esc→Board for now, sidebar Settings row, palette Settings…), CSS only if mock gaps.

**Nav:** Board · General · Appearance · Accounts · Repositories · Agents. Placeholder page bodies OK.

**Do not delete doctor dialog yet** (Task 10).

**Commit:** `feat: in-window Settings shell`

---

### Task 6: Appearance

Theme System/Light/Dark; zoom 0.8–1.25; font packs `system` | `inter-jetbrains` | `ibm-plex` via `data-font` + CSS tokens. Load prefs on boot.

**Commit:** `feat: settings Appearance`

---

### Task 7: General (+ warm TTL UI)

**Controls:** editor, open-lane-in-editor, terminal, diff/merge (Internal coming soon), clone path, default lanes folder, reopen tabs, git name/email (± this repo only), **Tab warm time** presets (30s / 2m / 5m / 10m) bound to `warmTabTtlMs`.

**Also:** palette **“Tab warm time…”** → small sheet with same presets (writes prefs; renderer reloads TTL). Per 9 Nov design for fast access.

**Wire:** createLane / open editor / terminal / reopenTabs / lanes folder (generalize `.worktrees` in `electron/git/ops.mjs`).

**Files:** `electron/git/identity.mjs` (+ test), IPC, `app/main.js`, ops createLane path.

**Commit:** `feat: settings General and warm TTL UI`

---

### Task 8: Accounts

GitHub username+PAT and generic HTTPS via `git credential approve/reject`; prefs `credentialHosts` index only (no secrets); SSH status-only; host sanitization tests.

**Commit:** `feat: settings Accounts HTTPS credentials`

---

### Task 9: Repositories page

One group per open tab; team branch display; lanes folder override; runnable status; Lane setup… → `page: 'setup'`.

**Commit:** `feat: settings Repositories page`

---

### Task 10: Lane setup page + delete doctor dialog

Doctor as Settings subpage; optional `root` on `repo.doctor` / `repo.acceptManifest`; delete `openDoctorSheet` + `.doctor-sheet`; Esc: setup→Repositories→Board; retarget env/palette/drift links.

**Commit:** `feat: lane setup in Settings; remove doctor dialog`

---

### Task 11: Agents stub

Mock layout, disabled controls, honest “later” lede note.

**Commit:** `feat: settings Agents stub`

---

### Task 12: Entry points + docs

README, DOGFOOD, palette labels; confirm create-lane + warm TTL + quick start + Settings paths. Align PRODUCT wording Integrations→Accounts if needed (minimal).

**Commit:** `docs: settings and fast-tabs dogfood paths`

---

### Task 13: Full-stack review gate

`npm test`; manual: authorship hover titles, warm hop-back, TTL freeze, Quick start, Settings General→Appearance→Accounts form→Repositories→Lane setup Write/Esc, Agents stub. Fix until UX + tech approve whole diff.

---

### Task 14: Hallmark pass

`/hallmark` audit then fix on Settings + Quick start + new sheets — locked to `planning/DESIGN.md` / mock tokens. No new marketing theme. Commit `fix: hallmark pass on Settings and onboarding UI`.

---

## Out of scope

- GitHub OAuth / Integrations providers
- Built-in diff/merge UI (option only)
- Agents MCP permission enforcement
- Hidden DOM / multi BrowserView boards
- Auto first-run tour
- Background fetch/webhooks

---

## Execution handoff

**Subagent-driven in this session:** implementer → UI/UX review → tech review per task; Hallmark at the end.

Say **go** to start Task 0.
