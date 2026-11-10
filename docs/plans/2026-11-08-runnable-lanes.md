# Runnable Lanes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every Plenum lane startable and testable from the board (and later CLI/MCP) via a checked-in `.plenum/lane.yaml`, without Plenum interpreting the stack.

**Architecture:** Keep git in `electron/git/*`. Add a sibling `electron/lane/*` for manifest parse, doctor, process supervisor, and drift. The Electron main process owns long-lived `run` children and pushes status into `loadBoard`. UI adds a Running section + env strip (already mocked in `planning/mocks/`). CLI/MCP wrap the same functions. Shared-data drift and snapshot modes ship after plain Run/Stop/Test works.

**Tech Stack:** Electron main (Node `child_process`), YAML (`yaml` package — only new dep if needed; prefer hand-parse of the tiny v1 schema first), existing Vite/vanilla renderer, Node test runner, later a thin `bin/plenum` + MCP stdio server.

**Source of truth:** `planning/PRODUCT.md` (Run / Hand off / Lane manifest / MCP table), `planning/examples/mobaro.lane.yaml`, `planning/mocks/board.js` (env strip + Running section).

**Non-goals (this plan):** Starting the protected checkout; agent git verbs; cloud anything; rewriting Aspire/compose; full Settings app (only the doctor page needed to accept a manifest).

---

### Task 1: Manifest schema + loader

**Files:**
- Create: `electron/lane/manifest.mjs`
- Create: `electron/lane/manifest.test.mjs`
- Create: `fixtures/lane/minimal.lane.yaml` (tiny fake for tests)

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, resolvePorts } from './manifest.mjs';

test('loadManifest reads version, commands, ports', async () => {
  const m = await loadManifest('fixtures/lane/minimal.lane.yaml');
  assert.equal(m.version, 1);
  assert.equal(m.run, 'npm start');
  assert.equal(m.ports.offset, 100);
  const ports = resolvePorts(m, 1); // lane index 1 → offset 100
  assert.equal(ports.web, 5101);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test electron/lane/manifest.test.mjs`  
Expected: FAIL (module missing)

**Step 3: Write minimal implementation**

- Support only `version: 1` fields from PRODUCT (`setup`, `run`, `test`, `env.copy`, `env.set`, `ports.offset`, `ports.expose`, `services.*.mode`, `data.migrations`, `data.snapshot`).
- Reject unknown `version`. Missing file → `null` (lane not runnable).
- `resolvePorts(manifest, laneIndex)` → `{ name: base + offset * laneIndex }`.
- Template replace `{offset}`, `{port.<name>}`, `{lane}` in `env.set` values later; stub a `renderTemplate(str, ctx)` now.
- Prefer zero deps: parse the subset we need, or add `yaml` if hand-parse gets ugly — decide in this task, one way only.

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add electron/lane fixtures/lane
git commit -m "feat(lane): load .plenum/lane.yaml and resolve ports"
```

---

### Task 2: Attach runnable state to the board

**Files:**
- Modify: `electron/git/board.mjs` (or import from lane and merge in `loadBoard`)
- Modify: `electron/git/board.test.mjs`
- Create: `electron/lane/status.mjs` (pure: given manifest + lane index + process table → UI fields)

**Step 1: Failing test** — board lane includes `runnable: false` when no manifest; with fixture manifest copied into temp repo, `runnable: true`, `offset`, `urls`, `dataMode: 'shared'`, `running: false`.

**Step 2: Implement** — `loadBoard` reads `<root>/.plenum/lane.yaml` once. Primary (`index === 0`) is never runnable (`runnable: false` even if manifest exists). Feature lanes get computed ports and service mode summary (`shared` if any service is shared).

**Step 3: Commit**

```bash
git commit -am "feat(board): expose runnable ports and data mode per lane"
```

---

### Task 3: Process supervisor (Run / Stop)

**Files:**
- Create: `electron/lane/supervisor.mjs`
- Create: `electron/lane/supervisor.test.mjs`
- Modify: `electron/main.mjs` — own a process-scoped supervisor singleton; on quit, stop all
- Modify: `electron/preload.cjs` — allow `lane.up`, `lane.down`, `lane.test`, `lane.status`

**Step 1: Failing tests**

```js
test('up starts a long-lived command and down stops it', async () => {
  // spawn `node -e "setInterval(()=>{}, 1000)"` as fake run
  // assert pid alive, then down, assert exited
});
test('refuses primary checkout', async () => {
  await assert.rejects(() => supervisor.up(root, 0), /protected/);
});
```

**Step 2: Implement contract**

- `up(root, laneIndex)`: cwd = lane path; env = `process.env` + rendered `env.set` + `PLENUM_LANE`, `PLENUM_OFFSET`; spawn `run` with `shell: true`, detached process group on macOS (`detached: true` + `process.kill(-pid)` on stop).
- Store `{ root, laneIndex, pid, startedAt, urls }` in memory Map keyed by `${root}#${laneIndex}`.
- `down`: SIGTERM, then SIGKILL after 5s.
- Never start if already running (idempotent return current status).
- Log last N lines of stdout/stderr in memory for the board / test UI later.

**Step 3: Wire IPC** `lane.up` / `lane.down` → supervisor + `loadBoard` (board must see `running` from supervisor, not git).

**Step 4: Commit**

```bash
git commit -am "feat(lane): supervisor for run/stop with port env"
```

---

### Task 4: `lane.test`

**Files:**
- Modify: `electron/lane/supervisor.mjs` (or `electron/lane/test.mjs`)
- Modify: tests

**Steps:** Spawn `test` command to completion (timeout e.g. 10m), capture exit code + last 50 lines, store `lastTest: { ok, code, at, log }` on the lane status. Do not use the long-lived supervisor map for tests. Commit: `feat(lane): run test command and keep last result`.

---

### Task 5: Env copy on create + setup

**Files:**
- Modify: `electron/git/ops.mjs` `createLane`
- Modify: `electron/git/ops.test.mjs`

**Steps:** After `worktree add`, if manifest exists: copy each `env.copy` path from primary → lane (mkdir parents); run `setup` once (await exit); failures surface as Error with stderr. Primary still never runs setup for itself. Commit: `feat(lane): copy env and run setup on create`.

---

### Task 6: Board UI — Running section + env strip

**Files:**
- Modify: `app/main.js` (`paintPanel`, `paintHeader`, `gitActionsHTML` / new `runActionsHTML`)
- Modify: `app/styles/mock.css` — lift Running / env-row / mark.running / badge.data / fact.drift rules from `planning/mocks/mock.css` (~1537+)
- Modify: `app/styles/app.css` if needed
- Reference: `planning/mocks/board.js` `envRow` / `runningSection`

**Steps:**

1. Panel: between Lanes and Branches, **Running** section listing running lanes with port + Stop.
2. Lane mark: add `running` ring class when `l.running`.
3. Header env-row for feature lanes: Run|Stop, Test, URL chips (`http://127.0.0.1:${port}`), `shared data` badge when applicable; primary keeps “never started” note.
4. Wire `data-act="up|down|test"` → invoke; busy spinners like push/pull.
5. Palette: Run / Stop / Test with when-guards.
6. Title readout: optional `· N running` if easy; else skip (YAGNI).

**Commit:** `feat(ui): running section and lane env strip`

---

### Task 7: Graph running affordance

**Files:**
- Modify: `app/lib/graph-live.js`
- Modify: `app/styles/mock.css`

**Steps:** When a lane is running, tip/WIP node or lane pill gets a small running dot (mock already plans this). Keep it one CSS class. Commit: `feat(ui): show running on graph lane tips`.

---

### Task 8: Doctor (read-only propose)

**Files:**
- Create: `electron/lane/doctor.mjs`
- Create: `electron/lane/doctor.test.mjs` with a tiny fixture repo (fake `package.json` + `docker-compose.yml`)
- Modify: `electron/main.mjs` — `repo.doctor`
- Create: minimal Settings page OR sheet “Lane setup” that shows findings + proposed YAML + **Accept** (writes `.plenum/lane.yaml`)

**Doctor heuristics (v1, keep dumb):**

- Detect `package.json` scripts (`dev`/`start`/`test`)
- Detect `docker-compose.y*ml`, `**/apphost.mts`, `Makefile`
- List untracked `.env` files via `git status --porcelain`
- Propose `ports.expose` only when numbers are obvious; otherwise empty expose + findings text “wire ports manually”
- **Writes nothing** until user accepts

**Commit:** `feat(lane): doctor proposes manifest; accept writes lane.yaml`

---

### Task 9: CLI binary `plenum`

**Files:**
- Create: `electron/cli/plenum.mjs` (or `bin/plenum.mjs`)
- Modify: `package.json` — `"bin": { "plenum": "./bin/plenum.mjs" }`, script `plenum`
- Reuse lane + git modules (no Electron `app` in CLI path — factor `tabs`/`userData` away from lane code)

**Subcommands (same names as MCP):**

```
plenum doctor [path]
plenum status [path]
plenum up <lane>
plenum down <lane>
plenum test <lane>
plenum create <name>
plenum remove <lane>
```

Print JSON with `--json`, human otherwise. Supervisor state for CLI: **file-backed** pid registry under `userData/run/<hash>.json` so app and CLI see the same processes (required before MCP). Do this registry refactor here if Task 3 was memory-only.

**Commit:** `feat(cli): plenum up/down/test/doctor/status`

---

### Task 10: MCP server

**Files:**
- Create: `electron/mcp/server.mjs`
- Modify: `bin/plenum.mjs` — `plenum mcp` → stdio MCP
- Docs: short block in `README.md` for Cursor MCP config pointing at `plenum mcp`

**Tools:** exactly the PRODUCT table (`repo.doctor`, `lane.create`, `lane.up`, `lane.down`, `lane.test`, `lane.status`, `lane.remove`). No git commit/push tools.

**Commit:** `feat(mcp): local stdio server for lane verbs`

---

### Task 11: Shared-data drift gate

**Files:**
- Create: `electron/lane/drift.mjs` + test
- Modify: supervisor `up` — before start, if any service `mode: shared` and `data.migrations` set, compute drift
- Modify: `app/main.js` — Run sheet (three choices) from mocks when drift > 0

**Drift v1 algorithm (document ceiling):**

```
# ponytail: name-only compare; upgrade is tool-specific migrator introspection
applied = list filenames recorded in a local plenum marker OR parse migrate output if we add adapters later
pending = files in data.migrations not in applied
```

Ship with a **pluggable adapter interface** and one stub adapter that reads an optional `.plenum/applied-migrations` file for tests; for mobaro, add a follow-up note rather than blocking on Aspire/EF internals.

Run sheet choices: (1) run migrations command if manifest gains `data.migrate` later — **or** for v1 only “start anyway” / “cancel” / “switch service to snapshot in yaml”. Match PRODUCT three choices as closely as the adapter allows; if migrate-apply isn’t ready, implement cancel + start-without + open doctor to edit mode.

**Commit:** `feat(lane): drift check gates Run with sheet`

---

### Task 12: Snapshot mode (minimal)

**Files:**
- Modify: `electron/lane/supervisor.mjs`, `electron/lane/manifest.mjs`
- Docs: update DOGFOOD / README

**Steps:** When a service is `snapshot`, before `up` run `services.<name>.snapshot` or `data.snapshot` with env pointing at offset ports; on `lane.remove`, best-effort teardown command if present (`services.<name>.teardown` optional — YAGNI until needed). Don’t build RavenDB/SQL managers inside Plenum.

**Commit:** `feat(lane): snapshot service hook before up`

---

### Task 13: Dogfood + docs

**Files:**
- Modify: `DOGFOOD.md` — runnable walk (doctor → accept → create lane → Run → URL → Test → Stop → Remove)
- Modify: `README.md` — phase two one-pager
- Modify: `package.json` description

**Steps:** Run smoke + one real repo with a hand-written minimal `lane.yaml` (`run: python3 -m http.server {port.web}` style). Confirm primary never starts. Commit: `docs: runnable lanes dogfood`

---

## Sequencing rationale

| Order | Why |
|---|---|
| Manifest → board fields | UI and supervisor need the same shape |
| Supervisor before doctor | You can hand-write yaml and dogfood Run without heuristics |
| UI before CLI/MCP | Prove the loop in the app you already live in |
| File-backed pids at CLI | App + CLI + MCP must share process truth |
| Drift/snapshot last | PRODUCT sequence; hardest; don’t block “Run a static server” |

## Done when

- A lane with a valid manifest shows Run; primary never does.
- Run starts `run` with offset env; Stop kills it; board shows running ring + URLs.
- Test runs `test` and shows last result.
- Create copies env + runs setup when manifest present.
- Doctor can propose + write yaml.
- `plenum` CLI and `plenum mcp` expose the same verbs.
- Drift sheet blocks Run when adapter reports pending migrations (even if adapter is stubbed for non-mobaro repos).

## Out of scope follow-ups (explicit)

- Full Settings IA (`⌘,` multi-page)
- Cross-repo shared service health checks
- Windows process groups
- Auto-detect Aspire port graph without a manifest
