# Design: Settings → Agents, for real

Written 11 November 2026. Direction approved in product chat; items marked **(my call)** were decided by the writer, not Sigurd, and are open to challenge.

## Why

`plenum mcp` and the `plenum` CLI already work: agents can create, start, test and remove lanes. But Settings → Agents is a disabled mock (`agents:` in `app/main.js`). Nothing stores the switches, the MCP server obeys no permissions, the Add buttons do nothing, and wiring a client up is done by hand. The page says so itself ("These switches don't do anything yet").

The goal is a page where you can see which agents are connected and what they are doing, what is missing and where the fix goes, and where every setting is real.

## What Sigurd asked for

- See whether an agent is currently doing something, and what it is connected to.
- See what is missing and what is required where.
- Settings that are clear and ready to set.
- "Are you sure?" questions from agents pop up in Plenum wherever you are. They do not live on the settings page.
- Live agent updates as non-invasive toasts, visible wherever you are in Plenum, through one toast system shared with today's confirmations.
- Which events toast is configurable. The default shows only what you would want to know.

"Doing something" means lane-level activity seen through Plenum ("Claude Code is testing `csv-export`"). Plenum does not watch an agent edit files or think, and does not run agents (PRODUCT.md, "Plenum must not").

## Goals

1. Every control on the page does what it says, or is not on the page.
2. One click takes a client from "installed" to "can call Plenum".
3. Permissions are enforced by the MCP server, not just displayed.
4. You learn about relevant agent actions without opening Settings.

## Non-goals

- Git verbs for agents (commit, push, merge stay with whoever is in the lane).
- Launching, embedding or chatting with agents.
- An HTTP MCP endpoint. stdio only.
- Per-agent permissions. One set for all agents. **(my call)**
- Agent activity on the board's lane rows. Toasts cover "wherever you are" for now. **(my call)**
- Windsurf, Devin, Aider and other clients. The client list is a table so adding one later is a row, but only Cursor, Claude Code and Codex ship.

## Anti-goals

- **"Ask" silently becoming "allow".** If Plenum cannot ask (app closed, no answer), the agent is refused.
- **Toast noise.** Two busy agents must not turn the app into a ticker. Reads never toast.
- **Plenum stealing focus** to ask a question.
- **Corrupting a client's config file.** A failed or partial write must leave the file as it was.
- **Calling this security.** The CLI stays ungated, so an agent with a shell can still run `plenum remove`. Permissions are a guardrail on the MCP path, and the page copy must not claim more. **(my call)**

## Releases

Three releases, each usable on its own. Release 1 is the must-have: it makes the page true. Releases 2 and 3 are what make it good.

### Release 1: setup and real permissions

**The `plenum` launcher.** A packaged Plenum.app has no `plenum` on anyone's PATH, and `bin/plenum.mjs` sits inside the app bundle where system `node` may not exist. Plenum writes a small launcher script to a stable place, `~/.plenum/bin/plenum`, and rewrites it on app launch so it survives the app moving or updating. The launcher runs the bundled CLI with Electron acting as node (`ELECTRON_RUN_AS_NODE=1`); in dev it runs `node bin/plenum.mjs`. Client configs point at this absolute path, so they never depend on PATH. **(my call; the builder must first prove with a packaged build that Electron-as-node can run the CLI from inside the bundle, and unpack `bin/` and `electron/` from the asar if it cannot.)**

Dev and installed must not fight over `~/.plenum/`. Only a packaged app writes `~/.plenum/bin/plenum`; a dev run (`npm run dev`) leaves an existing launcher alone and writes one only if none exists. From release 2, a dev run listens on its own socket name and only MCP processes started from the dev checkout connect to it, so toasts and questions never land in the wrong window. **(my call)**

The page shows one row for the command: the launcher path and version, and whether `plenum` is also on your shell PATH. A button puts a symlink in `/usr/local/bin` for shell use; that is optional and agents do not need it.

**Clients.** For each of Cursor, Claude Code and Codex the page shows one of:

| State | Shown as | Action |
|---|---|---|
| Not installed on this Mac | muted row, "Not installed" | none |
| Installed, no Plenum entry | "Missing", with the file it will touch | **Show lines**, **Add** |
| Entry present and pointing at the current launcher | "Set up" | **Remove** |
| Entry present but pointing somewhere stale | "Out of date" | **Fix** |

Add writes a user-level (global) entry named `plenum` that runs `<launcher> mcp`. "Show lines" shows exactly what will be written and where before anything is written. Remove takes out only the `plenum` entry.

Expected locations, to be verified by the builder against each client's current docs: Cursor `~/.cursor/mcp.json` (`mcpServers`), Claude Code user scope in `~/.claude.json` (`mcpServers`), Codex `~/.codex/config.toml` (`[mcp_servers.plenum]`). Where a client ships its own command for this (`claude mcp add`, `codex mcp add`), prefer it over editing the file, because the client owns that file and rewrites it. Direct edits must parse, change one key, write to a temp file and rename, and refuse (with the reason shown on the row) if the file does not parse.

**Repositories.** One row per open repository: "Ready for agents" when it has a lane manifest, otherwise "agents can create lanes but not start them" with a button to the existing Lane setup page. Read-only; reuses what the doctor and board already know.

**Permissions.** Four settings, saved and enforced:

| Setting | Tools | Values | Default |
|---|---|---|---|
| Start, stop and test lanes | `lane.up`, `lane.down`, `lane.test` | on / off | on |
| Create lanes | `lane.create` | on / off | on |
| Remove lanes | `lane.remove` | Allow / Never | Allow |
| Write lane setup | new: see below | Allow / Never | Never |

Reads (`repo.doctor`, `lane.status`) are always allowed. "Ask me" arrives in release 3 and becomes the default for the last two rows then.

"Remove lanes: Allow" keeps today's behaviour: safe removes go through, unsafe ones still need `force`. Whether a forced remove should be treated more strictly than a safe one is decided in release 3, where it can ask.

Forced starts: `lane.up` with `force` skips the migration-drift check, the point where the app shows a person the three-choice sheet. Over MCP a forced start is refused in releases 1 and 2, whatever the switch says, with a message that the user has to start that lane from the board. In release 3 it becomes a question like a forced remove. Normal starts are unaffected. (Sigurd's decision.)

Write lane setup needs a tool that does not exist yet: `repo.doctor` writes nothing over MCP today. Add a `write` option to `repo.doctor` that accepts the doctor's own proposal through the existing `acceptManifest` path, gated by this setting. **(my call)** It only ever creates a manifest: if the repo already has a `lane.yaml`, the call is refused whatever the setting says, because the doctor's fresh proposal would overwrite a hand-tuned, team-shared file. Editing an existing manifest stays a human job. **(my call)**

Where the settings live: the MCP server runs outside the app and often while the app is closed, so it cannot depend on Electron's user-data folder. Store agent settings in `~/.plenum/agents.json`, written by the app, read by the MCP server on every call (no caching, so a flipped switch applies to the next call). Missing or unreadable file means the defaults above. **(my call)**

A refused call returns a normal tool error an agent can act on: what was refused, that the user turned it off, and where ("Plenum → Settings → Agents"). A tool that is switched off stays in the tool list **(my call)**: hiding it would make agents fall back to the ungated CLI.

Applies to MCP only. The CLI is treated as you.

**The page in release 1** has, top to bottom: the command row, Clients, Repositories, What agents may do. No "Preview only" lede. No "Server" switch: there is no server to switch, each client starts its own `plenum mcp`.

### Release 2: live

**The connection.** While Plenum is open it listens on a local socket in `~/.plenum/run/`. Each `plenum mcp` process connects to it if it is there, and reconnects if the app starts later. Over it the process says who it is (the client name from MCP `initialize`'s `clientInfo`, the repo it was started in, its pid) and reports each tool call as it starts and finishes. The socket's lifetime is the "connected" signal: when the client quits, its `plenum mcp` exits and the row goes away. The MCP server works exactly as before when the app is not running.

**Activity history.** Every tool call that changes something is also appended to a log file under `~/.plenum/`, by the MCP process itself, so actions taken while Plenum was closed are still there when you open it. Keep it bounded (the page shows the last 24 hours). Reads are not logged.

**Page additions**, above the release 1 blocks:

- A status line: "2 connected · 1 working".
- **Right now**: one row per connected agent with its client, repo, and either what it is doing with a running timer ("Running tests in `csv-export` · 14s") or "Idle" plus its last action.
- **Activity**, at the bottom: newest first, one line each ("Cursor started `billing-fix` → localhost:5101").

Empty state: when nothing is connected, "Right now" says so in one line and points at Clients.

**Toasts.** Today's toast is one slot showing one message (`toast()` in `app/main.js`, 33 call sites, all confirmations of your own actions). It becomes a small stack, and both kinds of message go through it:

- Your own actions: unchanged in look and timing. Existing call sites keep working without edits.
- Agent updates: same toast, with the agent's badge (reuse the AI tool badges from the authorship avatars), and the repo name when it is not the repo you are looking at.
- Long-running agent work: one toast that stays while the work runs ("testing `csv-export` · 14s") and then becomes "passed" or "failed" before fading. It does not spawn a second toast.
- A toast with a URL makes the URL clickable.

Stack rules **(my call)**: at most three visible, oldest fades first, errors outlast successes as they do now, an agent toast never displaces an error toast.

**What toasts, by default:**

| Event | Toast by default |
|---|---|
| Something failed (lane would not start, tests failed, call refused by a permission) | yes |
| Tests passed | yes |
| Lane started (with URL) | yes |
| Lane created / removed | yes |
| Lane stopped | no |
| Agent connected / disconnected | no |
| Status checks and doctor reads | never (not offered as a switch) |

Everything in the table except reads lands in Activity regardless. Agent toasts show for any repo, including ones without an open tab.

### Release 3: ask, and tuning

**"Ask me".** Remove lanes and Write lane setup gain a third value, Ask me, and it becomes their default. For existing users who never touched the setting, the default moves with it; an explicit choice is kept. **(my call)**

When an agent calls a tool set to Ask:

1. Its call waits.
2. A toast appears in the stack wherever you are in Plenum: who is asking, what for, what would be lost if it is destructive ("2 uncommitted files would be lost"), and **Allow** / **Deny**. It does not fade.
3. If Plenum is not the front app, a macOS notification fires as well. Plenum does not bring itself forward. Clicking the notification does. Allow / Deny buttons on the notification itself are wanted if macOS allows them for this build (the app is currently unsigned, which may rule them out); if not, click-to-open is enough.
4. Answering either one resolves the call and dismisses the other.
5. No answer in about two minutes: the agent gets a refusal saying the user did not answer.
6. Plenum not running: the agent is refused straight away and told to ask the user to open Plenum. If the process is simply not connected (stale socket, app just started), it makes one fresh connect attempt before refusing, and the refusal says Plenum could not be reached rather than that it is closed. It never falls through to allow. **(my call)**
7. The outcome is recorded in Activity ("You denied Cursor writing lane setup in `plenum`").

Several questions at once each get their own toast. An answer applies to that one call; there is no "always allow" shortcut on the toast, the setting is the place for that. **(my call)**

Forced removes: with Remove set to Ask, every remove asks. With Allow, a forced remove (which discards uncommitted work) still asks. **(my call)** A forced start (`lane.up` with `force`) always asks, naming the pending migrations.

**"Tell me about".** A group on the Agents page with one switch per row of the toast table above (failures, tests passed, lane started, lane created/removed, lane stopped, connected/disconnected), preset to the defaults. Permission questions are listed but locked on.

## Constraints

- Electron app, plain JS, no framework in the renderer; the page is a template string in `app/main.js` using `settingsRow`. Follow what is there.
- No new dependencies expected. The MCP server is hand-rolled JSON-RPC and should stay that way. Codex's TOML is the one place a parser might be wanted; a narrow hand-written edit of one table, or the client's own CLI, is preferred.
- `prefs.json` stays for app preferences. Agent permissions and notification choices live under `~/.plenum/` because two different processes need them.
- Copy follows the app's voice (see commit `f5c75da`): plain, no "MCP" where "agents" will do, tool names in mono as secondary text.
- The mock in the product chat was a layout sketch. Real styling comes from the existing settings pages and `planning/mocks/settings.html?page=agents`, which should be updated to match.
- Tests run with `node --test` (see `package.json`). New main-process modules get a test file beside them like the existing ones.

## Left to the builder

- The wire format on the socket and the shape of the activity log.
- Module boundaries in `electron/` (client detection, permissions, the live connection).
- How "installed" is detected per client (app bundle, config folder, or binary on PATH).
- The exact toast stack markup, motion and timings, within the rules above.
- Log retention mechanics.
- How the two-minute wait interacts with each client's own tool-call timeout; shorten it if a client gives up sooner.

## Done when

- Release 1: on a Mac with Cursor, Claude Code and Codex installed and no Plenum config, clicking Add three times lets each agent list Plenum's tools from a packaged build; turning "Create lanes" off makes `lane.create` fail for an agent with a message that names the setting; nothing on the page is disabled-as-preview.
- Release 2: starting a lane from an agent shows a toast with a clickable URL while you are on the board, the agent appears under Right now within a second of connecting and disappears when its client quits, and an action taken while Plenum was closed shows in Activity on next open.
- Release 3: an agent's remove with Ask set waits, shows the question as a toast on any screen, and resolves on Allow or Deny; with Plenum quit, the same call is refused at once.
