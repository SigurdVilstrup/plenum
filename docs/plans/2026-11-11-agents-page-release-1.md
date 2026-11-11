# Agents Page Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings → Agents true: one-click client setup, a `plenum` launcher that works from a packaged app, a Repositories readiness block, and permissions the MCP server enforces.

**Architecture:** A new `electron/agents/` folder holds four small modules (settings store, permission gate, launcher, client configs). The MCP server calls the gate before every tool. The app talks to these modules over new `agents.*` IPC channels, and the `agents:` settings page in `app/main.js` is rewritten on top of them. Agent settings live in `~/.plenum/agents.json` because the MCP process runs outside Electron.

**Tech Stack:** Electron 39, plain ES modules, `node --test`. No new dependencies.

**Spec:** `docs/plans/2026-11-11-agents-page-design.md` (release 1 section; read it first).

## Global Constraints

- No new npm dependencies. The MCP server stays hand-rolled JSON-RPC.
- Permissions apply to the MCP path only. `bin/plenum.mjs` CLI verbs are not gated.
- Reads (`repo.doctor` without `write`, `lane.status`) are always allowed.
- A tool that is switched off stays in `tools/list`.
- Settings are read from disk on every tool call. No caching.
- A config write must never leave a client's file half-written: parse, change one entry, write a temp file beside it, rename.
- Nothing on the finished page is `disabled` as a preview. No "Server" switch. No "Preview only" lede.
- Page copy says "agents", not "MCP", except tool names shown in mono as secondary text.
- Every refusal message ends with: `The user can change this in Plenum → Settings → Agents.` (except the two that no setting can change, given in Task 2).
- Tests are `*.test.mjs` beside the module, run by `npm test`.
- Commits use Conventional Commits and end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- The main checkout has someone else's uncommitted work in `app/main.js`, `electron/main.mjs` and `electron/preload.cjs`. Work in a separate worktree and touch only the regions each task names.

## Review Focus

1. **A client config that is not valid JSON** (comments, trailing commas, half-written). Expected: the row says the file could not be read and why, Add refuses, the file's bytes are unchanged. Pinned in Task 5.
2. **Paths with spaces or quotes** (`/Applications/Plenum Beta.app`, a home folder with a space). Expected: the launcher script and the TOML entry still work. Pinned in Tasks 4 and 5.
3. **A broken or hand-edited `agents.json`** (empty, not JSON, unknown values such as `"remove": "ask"`). Expected: defaults for the bad keys, never a crash, never more permissive than the defaults. Pinned in Task 1.
4. **A `plenum` entry the user wrote by hand** (e.g. `"command": "plenum"`). Expected: shown as "Out of date"; Fix replaces only that entry and every other server in the file survives. Pinned in Task 5.
5. **A config file that is a symlink** (dotfile managers). Expected: the write goes through to the real file and the symlink is still a symlink afterwards. Pinned in Task 5.

---

### Task 1: Agent settings store

**Files:**
- Create: `electron/agents/settings.mjs`
- Test: `electron/agents/settings.test.mjs`
- Modify: `package.json` (`scripts.test`: add `electron/agents/*.test.mjs` after `electron/mcp/*.test.mjs`)

**Interfaces:**
- Consumes: `RUN_HOME`, `env` from `electron/paths.mjs`.
- Produces:
  - `agentsHome(): string` — `env('HOME', RUN_HOME)`, so `PLENUM_HOME` redirects everything in tests.
  - `defaultAgentSettings(): { version: 1, run: true, create: true, remove: 'allow', writeSetup: 'never' }`
  - `getAgentSettings(home = agentsHome()): AgentSettings` — reads `<home>/agents.json`.
  - `setAgentSettings(partial, home = agentsHome()): AgentSettings` — merges, sanitizes, writes atomically, returns the result.
  - Allowed values: `run`, `create` booleans; `remove`, `writeSetup` one of `'allow' | 'never'`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAgentSettings, getAgentSettings, setAgentSettings } from './settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-agents-'));

test('missing file gives defaults', () => {
  assert.deepEqual(getAgentSettings(tmp()), { version: 1, run: true, create: true, remove: 'allow', writeSetup: 'never' });
});

test('set then get round-trips and creates the folder', () => {
  const home = path.join(tmp(), 'nested');
  setAgentSettings({ create: false, writeSetup: 'allow' }, home);
  assert.deepEqual(getAgentSettings(home), { ...defaultAgentSettings(), create: false, writeSetup: 'allow' });
});

test('bad file content falls back to defaults per key', () => {
  const home = tmp();
  for (const body of ['', '{not json', '[]', '{"remove":"ask","run":"yes","writeSetup":"allow","extra":1}']) {
    fs.writeFileSync(path.join(home, 'agents.json'), body);
    const s = getAgentSettings(home);
    assert.equal(s.remove, 'allow');
    assert.equal(s.run, true);
    assert.equal('extra' in s, false);
  }
  assert.equal(getAgentSettings(home).writeSetup, 'allow'); // the valid key in the last body is kept
});

test('set ignores unknown keys and invalid values', () => {
  const home = tmp();
  const s = setAgentSettings({ remove: 'ask', run: 0, nope: true }, home);
  assert.deepEqual(s, { ...defaultAgentSettings(), run: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test electron/agents/settings.test.mjs`
Expected: FAIL, cannot find module `./settings.mjs`.

- [ ] **Step 3: Implement `electron/agents/settings.mjs`** with the interface above. Booleans are coerced with `Boolean()` on set and must be real booleans on read (anything else reads as the default). Write to `agents.json.tmp` then `fs.renameSync`.

- [ ] **Step 4: Add the glob to `package.json` and run**

Run: `npm test`
Expected: all pass, including the 4 new tests.

- [ ] **Step 5: Commit** — `feat(agents): settings store in ~/.plenum/agents.json`

---

### Task 2: Permission gate in the MCP server

**Files:**
- Create: `electron/agents/gate.mjs`
- Test: `electron/agents/gate.test.mjs`
- Modify: `electron/mcp/server.mjs` (`callTool`)
- Modify: `electron/mcp/server.test.mjs` (add cases)

**Interfaces:**
- Consumes: `getAgentSettings()` from Task 1.
- Produces: `refusal(name: string, args: object, settings: AgentSettings): string | null` — `null` means allowed, a string is the message to return to the agent.

Rules and exact messages (`TAIL` = ` The user can change this in Plenum → Settings → Agents.`):

| Call | Refused when | Message |
|---|---|---|
| `lane.up` with truthy `force` | always | `Refused: agents can't start a lane with force, because that skips the migration check. Ask the user to start this lane from the Plenum board.` |
| `lane.up`, `lane.down`, `lane.test` | `run` is false | `Refused: starting, stopping and testing lanes is turned off for agents.` + TAIL |
| `lane.create` | `create` is false | `Refused: creating lanes is turned off for agents.` + TAIL |
| `lane.remove` | `remove !== 'allow'` | `Refused: removing lanes is turned off for agents.` + TAIL |
| `repo.doctor` with truthy `write` | `writeSetup !== 'allow'` | `Refused: writing lane setup is turned off for agents.` + TAIL |
| anything else | never | — |

The force check comes before the `run` check.

- [ ] **Step 1: Write the failing gate tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal } from './gate.mjs';
import { defaultAgentSettings } from './settings.mjs';

const d = defaultAgentSettings();
const TAIL = ' The user can change this in Plenum → Settings → Agents.';

test('defaults allow run, create, remove and reads; refuse write', () => {
  for (const n of ['lane.up', 'lane.down', 'lane.test', 'lane.create', 'lane.remove', 'lane.status', 'repo.doctor']) {
    assert.equal(refusal(n, {}, d), null, n);
  }
  assert.equal(refusal('repo.doctor', { write: true }, d), 'Refused: writing lane setup is turned off for agents.' + TAIL);
});

test('switches off refuse with a message naming the setting', () => {
  const off = { ...d, run: false, create: false, remove: 'never' };
  assert.equal(refusal('lane.test', {}, off), 'Refused: starting, stopping and testing lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.create', { name: 'x' }, off), 'Refused: creating lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.remove', { lane: 1 }, off), 'Refused: removing lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.status', {}, off), null);
  assert.equal(refusal('repo.doctor', {}, off), null);
});

test('forced start is refused whatever the settings, for any truthy force', () => {
  for (const force of [true, 'true', 1]) {
    assert.match(refusal('lane.up', { lane: 1, force }, d), /can't start a lane with force/);
  }
  assert.equal(refusal('lane.up', { lane: 1, force: false }, d), null);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test electron/agents/gate.test.mjs`, expect module not found.

- [ ] **Step 3: Implement `refusal` in `electron/agents/gate.mjs`.**

- [ ] **Step 4: Add failing server tests** to `electron/mcp/server.test.mjs`. Each sets `process.env.PLENUM_HOME` to a temp dir and restores it in `finally`:

```js
test('tools/call returns isError with the refusal when a setting is off', async () => {
  // PLENUM_HOME=<tmp>, setAgentSettings({ create: false }, tmp)
  const res = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lane.create', arguments: { name: 'x', path: '/nonexistent' } } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /^Refused: creating lanes is turned off for agents\./);
});

test('a flipped setting applies to the next call without a restart', async () => {
  // same process: create:false → refused; then setAgentSettings({ create: true }) → the error is no longer a "Refused:" one
});

test('switched-off tools stay in tools/list', async () => {
  // setAgentSettings({ run: false, create: false, remove: 'never' }) → toolNames() still has all 7
});
```

- [ ] **Step 5: Wire the gate into `callTool`**: first lines read `getAgentSettings()` and `throw new Error(msg)` when `refusal(...)` returns a string (the existing `tools/call` handler already turns a throw into an `isError` result).

- [ ] **Step 6: Run** — `npm test`, all pass.

- [ ] **Step 7: Commit** — `feat(mcp): enforce agent permissions on tool calls`

---

### Task 3: `repo.doctor` can write lane setup

**Files:**
- Modify: `electron/mcp/server.mjs` (`TOOLS` entry and `callTool` case for `repo.doctor`)
- Modify: `electron/mcp/server.test.mjs`

**Interfaces:**
- Consumes: `doctor(root)` → `{ findings, proposedYaml, canAccept }` and `acceptManifest(root, yaml)` from `electron/lane/doctor.mjs`; `manifestPath(root)` from `electron/paths.mjs`; the gate from Task 2 (already refuses when `writeSetup` is not `'allow'`).
- Produces: `repo.doctor` accepts `write: boolean`. With `write`, the result is the doctor output plus `written: <absolute path of lane.yaml>`.

Behaviour with `write: true` and the setting on `allow`:
- A `lane.yaml` already exists (check `fs.existsSync(manifestPath(root))`): throw `Refused: this repo already has lane setup. Agents can create it but not replace it; the user edits .plenum/lane.yaml themselves.`
- `canAccept` is false: throw `Can't write lane setup yet:` followed by the findings, one per line.
- Otherwise call `acceptManifest(root, proposedYaml)`.

Update the tool description to: `Read the repo and propose a lane manifest. Writes nothing unless write is true, and then only when the repo has no lane.yaml yet.`

- [ ] **Step 1: Write failing tests** using the same temp-git-repo fixture style as the existing `repo.doctor` test, with `PLENUM_HOME` pointing at a temp dir:

```js
test('repo.doctor write is refused by default', async () => { /* default settings → text starts "Refused: writing lane setup is turned off" and no .plenum/lane.yaml exists */ });
test('repo.doctor write creates lane.yaml when allowed and none exists', async () => { /* writeSetup:'allow', fixture where doctor canAccept → result JSON has written ending in ".plenum/lane.yaml" and the file exists */ });
test('repo.doctor write never replaces an existing lane.yaml', async () => { /* writeSetup:'allow', pre-write a lane.yaml with marker text → refused, file content unchanged */ });
```

For the "allowed" fixture, reuse whatever repo shape an existing `doctor.test.mjs` case uses to get `canAccept: true`.

- [ ] **Step 2: Run to verify they fail** — `node --test electron/mcp/server.test.mjs`.
- [ ] **Step 3: Implement** the `write` property in the schema and the branch in `callTool`.
- [ ] **Step 4: Run** — `npm test`, all pass.
- [ ] **Step 5: Commit** — `feat(mcp): let repo.doctor write lane setup when allowed`

---

### Task 4: The `plenum` launcher

**Files:**
- Create: `electron/agents/launcher.mjs`
- Test: `electron/agents/launcher.test.mjs`
- Modify: `electron/main.mjs` (inside `app.whenReady()`), possibly `package.json` (`build.asarUnpack`)

**Interfaces:**
- Consumes: `agentsHome()` from Task 1.
- Produces:
  - `launcherPath(home = agentsHome()): string` — `<home>/bin/plenum`.
  - `launcherScript({ execPath, cliPath }): string` — exactly `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec <q(execPath)> <q(cliPath)> "$@"\n`, where `q` single-quotes for sh (a `'` inside becomes `'\''`). The same form is used in dev and packaged: Electron runs the CLI as node, so no system `node` is needed.
  - `ensureLauncher({ packaged, execPath, cliPath, home }): { path, written: boolean }` — writes (mode `0o755`) when `packaged` is true or the file does not exist; otherwise leaves the existing file alone.
  - `pathStatus(home): { onPath: boolean, linkPath: '/usr/local/bin/plenum' }` — `onPath` is true when `/usr/local/bin/plenum` or `/opt/homebrew/bin/plenum` resolves (`fs.realpathSync`) to `launcherPath(home)`.
  - `linkOnPath(home): { ok: true } | { ok: false, command: string }` — symlinks `/usr/local/bin/plenum` to the launcher; on any error returns the command for the user to run: `sudo ln -sf '<launcher>' /usr/local/bin/plenum`.

- [ ] **Step 1: Prove the packaged path first.** Run `npm run pack`. Then by hand run `ELECTRON_RUN_AS_NODE=1 release/mac*/Plenum.app/Contents/MacOS/Plenum release/mac*/Plenum.app/Contents/Resources/app.asar/bin/plenum.mjs --help` and expect the usage text, and pipe `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` into the same command with `mcp` and expect 7 tools. If either fails, add `"asarUnpack": ["bin/**", "electron/**"]` under `build` in `package.json`, re-pack, and use the `app.asar.unpacked` path; record which path worked in the commit message. `cliPath` in Step 5 follows from this.

- [ ] **Step 2: Write the failing tests**

```js
test('script quotes paths with spaces and quotes', () => {
  const s = launcherScript({ execPath: "/Applications/Plenum Beta.app/Contents/MacOS/Plenum", cliPath: "/Users/o'neil/app/bin/plenum.mjs" });
  assert.equal(s, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Applications/Plenum Beta.app/Contents/MacOS/Plenum' '/Users/o'\\''neil/app/bin/plenum.mjs' "$@"\n`);
});

test('the written launcher actually runs, from a folder with a space', () => {
  // home = <tmp>/has space; cliPath = a temp .mjs that prints process.argv.slice(2).join(',')
  // ensureLauncher({ packaged: true, execPath: process.execPath, cliPath, home })
  // execFileSync(launcherPath(home), ['a b', 'c']) → 'a b,c'  (node ignores ELECTRON_RUN_AS_NODE)
  // mode & 0o111 is non-zero
});

test('dev run does not overwrite an existing launcher; packaged does', () => {
  // write "OLD" to launcherPath(home); ensureLauncher({ packaged:false, ... }).written === false and content is "OLD"
  // ensureLauncher({ packaged:true, ... }).written === true and content starts "#!/bin/sh"
});

test('dev run writes a launcher when none exists', () => { /* written === true */ });
```

- [ ] **Step 3: Run to verify they fail** — `node --test electron/agents/launcher.test.mjs`.
- [ ] **Step 4: Implement `electron/agents/launcher.mjs`.**
- [ ] **Step 5: Call it at startup.** In `electron/main.mjs` inside `app.whenReady()`, call `ensureLauncher({ packaged: app.isPackaged, execPath: process.execPath, cliPath, home: agentsHome() })` in a try/catch that logs and continues; a failed launcher write must not stop the app opening.
- [ ] **Step 6: Run** — `npm test`; then `npm run dev`, quit, and check `~/.plenum/bin/plenum --help` prints usage (only if no launcher existed before).
- [ ] **Step 7: Commit** — `feat(agents): write a plenum launcher to ~/.plenum/bin`

---

### Task 5: Client detection and config writes

**Files:**
- Create: `electron/agents/clients.mjs`
- Test: `electron/agents/clients.test.mjs`

**Interfaces:**
- Consumes: `launcherPath()` from Task 4.
- Produces (every function takes `opts = { userHome = os.homedir(), launcher = launcherPath() }` so tests use a temp home):
  - `CLIENTS`: `[{ id: 'cursor', label: 'Cursor', file: '.cursor/mcp.json', format: 'json' }, { id: 'claude-code', label: 'Claude Code', file: '.claude.json', format: 'json' }, { id: 'codex', label: 'Codex', file: '.codex/config.toml', format: 'toml' }]` (paths relative to `userHome`).
  - `listClients(opts): ClientStatus[]` where `ClientStatus = { id, label, file: <absolute>, state: 'not-installed' | 'missing' | 'ok' | 'stale' | 'unreadable', reason?: string }`.
  - `previewAdd(id, opts): { file: string, lines: string }` — the exact text that will be added.
  - `addClient(id, opts): ClientStatus` — also the "Fix" action for `stale`.
  - `removeClient(id, opts): ClientStatus`.

Decisions:
- **Installed** means: Cursor — `<userHome>/.cursor` exists or `/Applications/Cursor.app` exists; Claude Code — `<userHome>/.claude` or `<userHome>/.claude.json` exists; Codex — `<userHome>/.codex` exists.
- **The entry**: JSON clients get `mcpServers.plenum = { "command": <launcher>, "args": ["mcp"] }`. Codex gets a table `[mcp_servers.plenum]` with `command = "<launcher>"` and `args = ["mcp"]` (TOML basic string: escape `\` and `"`).
- **State**: `ok` when the entry's command equals `launcher` and args equal `["mcp"]`; `stale` when an entry named `plenum` exists but differs; `missing` when installed with no entry (including no config file yet); `unreadable` when the file exists but does not parse, with `reason` set to the parser's message.
- **JSON writes**: `JSON.parse`, set or delete the one key, `JSON.stringify(..., null, 2)` plus a trailing newline. Other keys keep their order. A missing file is created containing only `mcpServers`.
- **TOML writes** (no parser): the plenum block is the header line matching `^\[mcp_servers\.plenum(\.[^\]]+)?\]\s*$` and every line after it up to the next line starting with `[` that is not a `mcp_servers.plenum` header, or end of file. Add replaces the block if present, else appends it after a blank line. Remove deletes the block. Everything outside the block is kept byte for byte.
- **All writes**: resolve the target with `fs.realpathSync` when it exists (so a symlinked config is written through, not replaced), write `<real>.plenum-tmp`, rename over `<real>`.
- **`unreadable` or `not-installed`**: `addClient` and `removeClient` throw with the reason and write nothing.
- **Client-owned CLIs** (spec: prefer them): before coding, check the current docs for `claude mcp add` / `claude mcp remove` (user scope) and `codex mcp add` / `codex mcp remove`, and for the three file locations above. If a client's CLI is confirmed and its binary is found at a known absolute path (`~/.claude/local/claude`, `~/.local/bin/claude`, `/opt/homebrew/bin/<name>`, `/usr/local/bin/<name>`), `addClient`/`removeClient` run it with `execFile` instead of editing the file, and fall back to the file edit when the binary is not found or exits non-zero. Status is always read from the file. If the docs contradict a location or key name above, follow the docs and note it in the commit message.

- [ ] **Step 1: Write the failing tests** (each builds a temp `userHome`; `launcher` is a fixed fake path such as `/tmp/pl home/bin/plenum`):

```js
test('nothing installed → all three not-installed', ...);
test('installed without entry → missing; previewAdd shows the exact lines and file', ...);   // json and toml
test('add then list → ok; remove then list → missing; other servers and top-level keys survive in order', ...); // json: file had {"a":1,"mcpServers":{"other":{"command":"x"}},"z":2}
test('hand-written entry {"command":"plenum"} → stale; addClient fixes only that entry', ...);
test('invalid JSON (comment, trailing comma, truncated) → unreadable with reason; add throws; bytes unchanged', ...);
test('toml: add appends a block; second add does not duplicate; remove restores the original bytes', ...); // original has [model] and [mcp_servers.other] tables before and after
test('toml: remove also drops [mcp_servers.plenum.env]', ...);
test('toml: launcher path with a space and a quote is escaped and read back as ok', ...);
test('symlinked config: write lands in the target and the link is still a symlink', ...); // fs.lstatSync(link).isSymbolicLink()
test('missing config file but client installed → add creates it', ...);
```

- [ ] **Step 2: Run to verify they fail** — `node --test electron/agents/clients.test.mjs`.
- [ ] **Step 3: Verify locations and CLI syntax against current docs** as described under Decisions.
- [ ] **Step 4: Implement `electron/agents/clients.mjs`.** If a client CLI path is added, add one test that puts a fake executable script in the temp home's `.local/bin` and asserts it was invoked with the expected arguments.
- [ ] **Step 5: Run** — `npm test`, all pass.
- [ ] **Step 6: Commit** — `feat(agents): detect clients and write their Plenum entry`

---

### Task 6: IPC channels

**Files:**
- Modify: `electron/main.mjs` (beside the other `ipcMain.handle` blocks)
- Modify: `electron/preload.cjs` (`ALLOWED`)

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces, all through the existing `invoke(channel, ...args)`:
  - `agents.get` → `{ settings: AgentSettings, launcher: { path, onPath, linkPath }, clients: ClientStatus[] }`
  - `agents.setSettings(partial)` → `AgentSettings`
  - `agents.preview(id)` → `{ file, lines }`
  - `agents.add(id)` → `ClientStatus`
  - `agents.remove(id)` → `ClientStatus`
  - `agents.linkOnPath()` → `{ ok: true } | { ok: false, command }`

- [ ] **Step 1: Add the six handlers** in `electron/main.mjs`, each a one-line delegation.
- [ ] **Step 2: Add the six channel names** to `ALLOWED` in `electron/preload.cjs`.
- [ ] **Step 3: Verify** — `npm run dev`, open DevTools, run `await window.plenum.invoke('agents.get')` and expect an object with the three keys and three clients.
- [ ] **Step 4: Commit** — `feat(agents): expose agent setup and settings over IPC`

---

### Task 7: The real Agents page

**Files:**
- Modify: `app/main.js` — replace the `agents:` entry in `SETTINGS_PAGES`; add `bindAgents(root)` and call it from `renderSettings()` when `page === 'agents'`; load data when the page opens.
- Modify: `app/styles/mock.css` — delete the two `.agents-stub` rules; add only what the new rows need.
- Modify: `planning/mocks/settings.html` (`?page=agents`) to match the shipped page.

**Interfaces:**
- Consumes: the `agents.*` channels from Task 6; `settingsRow(ic, name, small, detail, control, tip)`, `state.repoBoards`, `openLaneSetup(root)`, `toast()`, `esc()`, `iconHTML()`, `state.appInfo.version` already in `app/main.js`.
- Produces: `state.agents` (the last `agents.get` result, or `null` while loading).

Page content, top to bottom. Follow the Repositories page (`bindRepos`) for how a settings page fetches, re-renders and binds.

1. **Heading** `Agents`, lede: `Let Cursor, Claude Code and Codex create, start and test lanes through Plenum.`
2. **Group "Command"** — one row: name `plenum`, small text the app version, detail the launcher path in mono. Control: status `On your PATH` when `launcher.onPath`, otherwise a button `Add to PATH`. On `{ ok: false }`, show the returned command in a mono block under the row with the line `Run this in Terminal:`. Tip: `Agents don't need this. It's for using plenum in your own shell.`
3. **Group "Clients"**, small: `What each tool needs to reach Plenum.` One row per client by `state`:

   | state | detail | control |
   |---|---|---|
   | `not-installed` | `Not installed on this Mac.` | none; row muted |
   | `missing` | `Doesn't know about Plenum yet.` | status `Missing` (warn) + buttons `Show lines`, `Add` (primary) |
   | `ok` | the file path, mono | status `Set up` (on) + button `Remove` |
   | `stale` | `Points at an old Plenum.` | status `Out of date` (warn) + buttons `Show lines`, `Fix` (primary) |
   | `unreadable` | `Couldn't read <file>: <reason>` | status `Can't read` (warn), no buttons |

   `Show lines` toggles a mono block under the row with `Adds to <file>:` and the `lines` from `agents.preview`. Add / Fix / Remove call the channel, replace that client in `state.agents`, re-render, and toast `Added Plenum to <label>` / `Updated <label>` / `Removed Plenum from <label>`. After a successful Add or Fix also show under the row: `Restart <label> to pick it up.`
4. **Group "Repositories"**, small: `Agents can only start lanes where the repo has lane setup.` One row per open tab, using `state.repoBoards.get(tab.path)` the way the Repositories page does. `hasManifest` true: status `Ready for agents` (on). False: detail `No lane setup yet. Agents can create lanes but not start them.` and a button `Lane setup…` calling `openLaneSetup(root)`. No open tabs: one line, `Open a repository to see whether agents can run it.`
5. **Group "What agents may do"**, small: `Applies to agents using Plenum's tools. Commit, push and merge stay with whoever is in the lane.`

   | name | small (mono) | control |
   |---|---|---|
   | `Start, stop and test lanes` | `lane.up, lane.down, lane.test` | switch bound to `run` |
   | `Create lanes` | `lane.create` | switch bound to `create` |
   | `Remove lanes` | `lane.remove` | select `Allow` / `Never` bound to `remove` |
   | `Write lane setup` | `repo.doctor` | select `Allow` / `Never` bound to `writeSetup` |

   A change calls `agents.setSettings({ key: value })`, stores the returned settings, and toasts `Saved`. These controls do not go through `setPref`/`bindPrefs`, which write `prefs.json`.

- [ ] **Step 1: Replace the `agents:` template and add `bindAgents`.** While `state.agents` is `null`, render the heading and one line `Loading…`, fetch `agents.get`, then re-render.
- [ ] **Step 2: Remove the `.agents-stub` CSS** and style the under-row mono block and the muted row with existing tokens.
- [ ] **Step 3: Verify in the running app** — `npm run dev`, open Settings → Agents, and check each of:
  - no control is disabled; no "Preview only" text; no Server row;
  - flipping `Create lanes` off changes `~/.plenum/agents.json` and survives closing and reopening Settings;
  - with a temp copy of your own `~/.cursor/mcp.json` backed up first: Remove then Add round-trips and other servers in the file are intact;
  - `Show lines` shows the same text that ends up in the file;
  - a repo tab without `.plenum/lane.yaml` shows the `Lane setup…` button and it opens the setup page for that repo.
- [ ] **Step 4: Update `planning/mocks/settings.html`'s agents page** to the same groups and copy.
- [ ] **Step 5: Run** — `npm test`, all pass.
- [ ] **Step 6: Commit** — `feat(ui): make Settings → Agents real`

---

### Task 8: Prove it from a packaged build

**Files:**
- Modify: `README.md` and `DOGFOOD.md` (replace hand-wiring instructions for `plenum mcp` with "Settings → Agents → Add"; keep the manual entry as a fallback, using the launcher path)

- [ ] **Step 1: Pack and run** — `npm run pack`, launch `release/mac*/Plenum.app`. Expect `~/.plenum/bin/plenum` to be rewritten to point inside that app, and `~/.plenum/bin/plenum --help` to print usage.
- [ ] **Step 2: End to end with a real client.** In Settings → Agents click Add for Claude Code, start a new Claude Code session in a repo, and ask it to list Plenum's lanes. Expect a `lane.status` result. Repeat for Cursor and Codex if installed.
- [ ] **Step 3: Permission check with a real client.** Turn `Create lanes` off, ask the agent to create a lane, expect it to report the refusal naming Settings → Agents. Turn it back on and expect the next attempt to work without restarting the client.
- [ ] **Step 4: Update `README.md` and `DOGFOOD.md`.**
- [ ] **Step 5: Commit** — `docs: set agents up from Settings → Agents`
