# Overlook: product

Written 6 November 2026. The deck in `index.html` is the pitch; this document is the full version, including the numbers behind every slide and the decision notes (kill criteria, ask, smoke test) at the end. Numbers come from the scripts in `scripts/` run against the repositories on this machine, from vendor pages fetched on 6 November 2026, and from the Stack Overflow 2026 survey. Where I could not get evidence, the word is "unknown".

## One line

Overlook is a Mac git client built around lanes: a graph and a lane board that show where each worktree stands against the team, with every git verb per lane. Phase two adds the thing no git client does, which is make every lane runnable and testable, with shared data as a fact you can see, through the board, a CLI, and a local MCP any agent can call.

## The problem, short

Half the commits in the team repository are now agent-marked (53% in October). A fifth of what lands on `main` never had a pull request. And on the same machine there are two worktrees across sixteen repositories, because a second checkout of the main repo does not start: fixed ports, three shared Docker volumes, a 1.4 GB install, two untracked `.env` files. The agents run in the primary checkout because that is the only folder that runs. Full numbers below.

## The idea

Overlook is a git client first. Then it makes lanes runnable. In that order, because the second part is the bigger job and only pays off once the client is in daily use.

**Work.** The verbs every client has, per lane: commit, push, pull, rebase onto main, merge into main, resolve conflicts. The lane header shows only the ones that apply right now (Commit when there is uncommitted work, Rebase on main when behind, Merge and Push when ahead); the palette has all of them with keys. Real git underneath, the repo stays plain. This is phase one and the whole of the first Mac app.

**See.** Lanes panel, full-height graph, protected main, behind, authorship. The part that makes it a git client and not a sidecar. Not an addition to GitKraken: the graph and the lanes are the product, running is what makes lanes exist in the first place.

**Run (phase two).** A doctor reads the repo and proposes a lane manifest, `.overlook/lane.yaml`, checked into the repo. Each lane gets a port offset. Run, Stop and Test sit in the lane header. Services are shared by default; the board says so on every lane, lists what is shared, and turns the lane amber when it carries migrations the shared database has not run. That drift is the one thing that gates Run.

**Hand off (phase two).** The lane operations as a local MCP server and a CLI: `repo.doctor`, `lane.create`, `lane.up`, `lane.down`, `lane.test`, `lane.status`, `lane.remove`. Cursor, Claude Code and Codex get runnable lanes without Overlook building into any of them, and whatever they start shows up on the board as running.

**What Overlook does not care about.** Which IDE, which agent, which model, which workflow, or how the stack starts. The manifest holds commands; Overlook sets the folder, the env and the port offset, then calls them. Running through an Aspire AppHost is the same to it as running three shell scripts for backend, frontend and worker, or `docker compose up`, or `make dev`. If the command can take a port from the environment, the lane is runnable. If it cannot, the doctor says so and that is the one change the repo needs. The same holds on the agent side: anything that speaks MCP or can run a CLI gets lanes, and Overlook has no opinion about what it does inside one.

Why shared data is the default and not isolation: isolation is what every "parallel agents" tool reaches for, and it is why nobody uses them on a repo with three databases. Sharing is what a developer does today when they switch branches in one checkout; the hazard is the same, migration drift. Overlook makes that hazard visible and offers `snapshot` per service for the lanes that need their own copy. The cheap default is the one people will keep.

## Vocabulary

Six words. Every screen uses them and nothing else.

**Lane.** A git worktree on its own branch, plus the way to run it: the manifest's commands, a port offset, the env, and a data mode. Several features in progress at once, each one startable. Agents create them; so do people. A worktree without a manifest still shows as a lane; it just cannot be started yet.

**Protected main.** The checkout that sits on the team branch. Overlook watches it, never works in it, never starts it, and shows it first.

**Behind.** How many commits the team branch has that this lane does not. Measured against `origin/main` (or the team's default), not the lane's own upstream.

**Readiness.** One mark per lane. Working: uncommitted changes. Not merged: committed, not in the team branch yet. Safe to remove: merged (squash counts) and the tree is clean.

**Authorship.** Who wrote the newest commit, read from the author and the trailers agents add (`Co-authored-by`, `Made-with`). Human, Assisted, Agent or Mixed. Human gets no badge.

**Running.** The lane's stack is up on its own ports. Shown as a ring around the readiness mark, a row in the Running section, URL chips in the header, and a dot on the lane's pill in the graph. A running lane that uses shared services says `shared data` next to the chips.

## How it fits on screen

Composition rule: a lane row is three facts (mark, name, behind or dirty). Running folds into the mark as a ring, not a fourth column. The lane header grows one row, the environment strip: Run or Stop, Test, URL chips, the `shared data` badge, and the drift fact when there is one. The panel gains one section, Running, between Lanes and Branches without a lane: one row per running lane with its web port and a Stop button on hover. The title bar readout becomes "synced 1s ago · 2 running". Settings (`⌘,`) is a page in the same window, not a second one; Settings > Repositories shows, per repository, the team branch, the lanes folder, whether the repo is runnable and which services are shared; Lane setup (the doctor) is a page under it, not a dialog. Settings > Agents holds the local MCP endpoint and CLI, which clients are wired up, and what agents may write: start and stop, create, remove (ask), write the manifest (ask). Nothing else moves.

Mocks: [`mocks/board.html`](mocks/board.html) (a normal day, two lanes running, one with drift), [`?up=1`](mocks/board.html?up=1) (Run on a drifted lane), [`mocks/setup.html`](mocks/setup.html) (the doctor, under Settings > Repositories), [`?scenario=bad&lane=0`](mocks/board.html?scenario=bad&lane=0) (the primary checkout touched), [`?lane=4&remove=1`](mocks/board.html?lane=4&remove=1) (guarded remove), [`mocks/create-lane.html`](mocks/create-lane.html), [`mocks/settings.html`](mocks/settings.html) ([`?page=agents`](mocks/settings.html?page=agents) for the MCP and permissions). Design rules in `DESIGN.md`.

## Must and must not

Overlook must: show the three facts for every worktree in under ten seconds; create a lane from latest `main`; commit, push, pull, rebase and merge per lane, and walk a conflict file by file inside the lane; remove a lane only when it is safe, and say why when it is not. In phase two: write `.overlook/lane.yaml` when the user accepts the doctor's proposal; start and stop a lane's `run` command with its port offset and env, and keep those processes alive as a supervisor while the app or CLI runs; run a lane's `test` command and keep the last result; refuse to start a lane with migration drift without the sheet; expose the lane operations on a local MCP and a CLI with the same names.

Overlook must not: commit, push, merge or rebase on behalf of an agent (agents get lane verbs over MCP, not git verbs; git stays with whoever is in the lane); open a terminal into an agent or run an agent; interpret, wrap or replace the repo's own start, test or setup commands; start anything in the protected checkout; hide the fact that data is shared behind a dialog or a setting; change a service to `snapshot` or `isolated` without writing it to the manifest where the whole team sees it; run anything that is not in the manifest.

Git writes are the ones every client has. Beyond those, lanes add four (create lane, remove lane, write manifest, start and stop processes) and one standing process.

## Sequence

1. **Phase one, the client.** Board, graph, lanes as worktrees, protected main, behind, authorship, and the git verbs per lane. A Mac app used every day. Eight weeks of evenings.
2. **Dogfood.** The team repo for four weeks. Count lanes per person and whether anyone opens another client.
3. **Phase two, running.** The manifest for mobaro, then `overlook up / test / doctor` and the MCP. The strip under the lane header. Starts only once the client is in daily use.
4. **Shared data.** Drift detection, snapshot per service, the Run sheet. Last, because it is the hardest to get right.

## Lane manifest

`.overlook/lane.yaml`, in the repo, proposed by the doctor and edited by hand. Checked in, so every teammate and every agent gets the same lanes with or without Overlook.

One manifest per git repository, because a worktree is per repository. A monorepo is the easy case: one file, one `run`. When the stack spans repositories, a lane that needs another repo's service names it under `services` as `shared` with a `url`; Overlook shows it as shared and checks that it answers, but does not start it in v1. Settings > Repositories lists these cross-repo services so the dependency is visible.

```yaml
version: 1
setup: <command run once in a new lane>
run: <command that starts the stack; receives {offset} and {port.*}>
test: <command; exit code is the result>
env:
  copy: [<untracked files to copy from the primary checkout>]
  set: { <VAR>: <value, may use {offset}> }
ports:
  offset: <int, added per lane number>
  expose: { <name>: <base port> }       # become URL chips
services:
  <name>:
    mode: shared | snapshot | isolated   # default shared
    snapshot: <command producing a seed>  # required for snapshot
data:
  migrations: <folder compared against the shared database before Run>
  snapshot: <default seed command>
```

Commands. `setup`, `run` and `test` are shell commands, run in the lane folder with the lane's env and port offset. Overlook does not know what they do. `run` is expected to stay in the foreground and to die on SIGTERM, the same contract a terminal gives it; that is all the supervisor relies on.

Modes. `shared`: the lane uses the instance everyone uses; the board shows `shared data`. `snapshot`: the lane gets its own copy seeded from the snapshot command, on an offset port, dropped on remove. `isolated`: its own empty instance. Mode is per service, so Postgres can be a snapshot while RavenDB stays shared.

Drift. Before `lane.up`, Overlook lists migrations in the lane's `data.migrations` folder that the shared database has not applied (by name, the way the migration tool itself does). Zero: start. More than zero: the sheet, with three choices: run them (changes the shared database for every lane; the other lanes keep running on the new schema), start without them, or switch that service to `snapshot` for this lane.

Worked example for mobaro: [`examples/mobaro.lane.yaml`](examples/mobaro.lane.yaml). Every value in it is read from the repo on this machine; mobaro itself is not modified by this project.

## The local MCP and CLI

One binary, `overlook`. `overlook mcp` serves the tools below over stdio; the same names are subcommands.

| Tool | Does | Returns |
|---|---|---|
| `repo.doctor` | Reads the repo: start scripts, ports, compose and Aspire files, volumes, untracked env files, package manager. | Findings and a proposed manifest. Writes nothing. |
| `lane.create {name, base}` | Worktree from `origin/<default>`, runs `setup`, copies env. | Lane number, folder, branch. |
| `lane.up {lane}` | Checks drift, applies env and offset, starts `run` under the supervisor. | URLs, pids, or a drift report with the three choices. |
| `lane.down {lane}` | Stops the lane's processes. | |
| `lane.test {lane}` | Runs `test` in the lane. | Exit code, duration, last lines. |
| `lane.status` | Every worktree: the three facts plus running, ports, data mode, drift. | The board as JSON. |
| `lane.remove {lane}` | Only when safe; otherwise the reasons. | |

What this buys. Claude Code already creates `.claude/worktrees/<name>` and runs setup hooks; Cursor already runs `.cursor/worktrees.json` setup scripts. Neither starts the app, offsets ports, or knows what is shared. Conductor does all three, for the workspaces it creates with the agents it launches, inside its own window. Overlook's manifest is for whichever agent, and whichever worktree, you already have. With the manifest in the repo and `overlook mcp` configured once, an agent asked to "fix the CSV export and show me" creates a lane, starts it, returns a URL, runs the tests, and the lane shows up on the board as running with the shared-data badge like any lane a person made. Nothing of Overlook's runs in the cloud; the MCP is a local process over stdio.

## Problem: what my own repositories show

Source: `scripts/mine.sh` and `scripts/prs.sh`, run 6 November 2026 over `~/Dev/Repositories`, 90 days back (from 8 August). Full output in Appendix A.

### The team repository (MobaroIT/mobaro, GitHub, seven active authors)

| Fact | Number |
|---|---:|
| Commits on all branches, 90 days | 2,203 |
| of which agent-marked (trailer or author names Cursor, Claude or Copilot) | 824 (37%) |
| Agent share by month: Aug / Sep / Oct | 23% / 37% / 53% |
| Non-merge commits on `main`'s first-parent line | 281 |
| of which squash-merged pull requests (PR number in subject) | 143 |
| of which pushed straight to `main`, no pull request | 138 |
| of those 138, agent-marked | 61 |
| of those 138, authored by me | 65 |
| Merged pull requests (GitHub API) | 224 |
| PR cycle time, open to merge: median / p75 / p90 | 19 h / 116 h / 187 h |
| PRs merged under one hour / over seven days | 62 / 37 |
| PRs with at least one force push (sample of 60 most recent) | 30 of 60 |
| Merge commits on `main` with a measurable "behind at merge" | 49 |
| of which more than 20 commits behind `main` when merged | 7 (max 198) |
| Squash-merged PRs: behind at merge | unknown (not recoverable after squash) |
| Revert commits | 5 |
| Reverts of an agent-marked commit within 48 hours | 1 |
| Remote branches not in `main`, with a commit in the last ~90 days | 186 |
| of which agent-tipped | 44 |
| Worktrees on disk for this repository | 2 |
| of which already squash-merged and still on disk | 1 |
| Branch checked out in the primary folder right now | `feature/see-s6-login-hook`, 23 dirty files, 34 behind `main` |

First agent trailer in the repository: Cursor on 9 February 2026, Claude on 8 May 2026.

### The personal repositories (mobaro-switch, weft, vekoma-mobaro-landing, mobaro-checklist-trial)

216 commits in 90 days, 212 agent-marked. 208 pushed straight to `main`; two merge commits. No pull requests. No worktrees.

### Azure DevOps (Mobaro.Core, Mobaro.Web)

Zero completed pull requests returned for either repository. The local clones were last fetched 10 March 2026 and their histories were imported into the GitHub monorepo (the `rideops/*`, `core/*` and `web/*` branches 18,000 commits behind are the seam). Whether the API filter hid anything: unknown. Check in the ADO web UI if it matters; for this decision it does not.

### What this says

Three things the data supports, and one it does not.

**Agent commits on `main` without review are routine, not an accident.** 61 agent-marked commits reached `main` with no pull request in 90 days, and I wrote most of them. The "bad day" mock (an agent slipped onto `main`) is the wrong story. The true story is that half of all commits are now agent-marked and a fifth of what lands on `main` was never reviewed by a second person, and nothing on screen tells those apart from the rest.

**"Behind" is paid for at the end.** Half the sampled pull requests needed a force push before merge, which in this team means a rebase onto `main`. Seven of 49 merge-commit PRs merged more than 20 commits behind. The number exists; nobody sees it until the rebase.

**Branches outlive their merge.** 186 remote branches look unmerged by ancestry; most are squash-merged and never deleted. One of two worktrees on disk is the same: merged yesterday, still there, one dirty file.

**The data does not show the "many lanes" problem, and the cause is in the repo.** Two worktrees across sixteen repositories. The agents here run in the primary checkout, which is why the primary checkout is on a feature branch with 23 dirty files. Making a second checkout of `mobaro` that actually starts means: a second `pnpm install` (1.4 GB of `node_modules`, linked from `.pnpm-store`), the Aspire AppHost in `tools/aspire-apphost/apphost.mts` opening the same seven ports (RavenDB 1338, SQL Edge 1433, Postgres 5432, web 5001, app 5002, api 5055, RideOps 8100), three Docker volumes (`local-db-environment_ravendb_data`, `_sqledge_data`, `_postgres_data`) that every checkout would read and write at once, and two untracked `.env` files (`tools/mobaro-bi/.env`, `tools/mobaro-docs-mcp/mcp/.env`) the new folder does not get. Nobody wrote that down anywhere; you learn it by trying. So nobody tries, and the agent stays in the one folder that works.

The problem the data supports, in one sentence: **a worktree you cannot run is a worktree nobody makes, and the work that should be in lanes lands in the primary checkout instead.** The three facts (behind, protected main, authorship) are still what you need to read once lanes exist. Running is what makes them exist.

## Why existing tools do not solve it

Audit of shipping software, fetched 6 November 2026. "Behind main" means the number of commits the team branch has that this checkout lacks, shown per worktree. "Authorship" means who wrote a commit, from the commit, not which agent process is running. "Runnable per worktree" means the tool can start and stop the project in each worktree with distinct ports. "Data awareness" means the tool has a model of which services are shared between worktrees.

| Tool | Version, date | Behind main per worktree | Protected main | Commit authorship | Runnable per worktree | Data awareness | Last six months of changelog |
|---|---|---|---|---|---|---|---|
| GitKraken Desktop | 12.6.1, Nov 2026 | Partial. Agent Sessions cards show "ahead/behind state" since 12.0 (Apr 2026); relative to what is not documented. Unknown until installed. | No. Any checkout. | No. Live status of agent sessions it launched (Claude Code, Codex, Copilot CLI, Cursor CLI, Gemini, OpenCode), via hooks. | No. Launches agent sessions in a worktree; running the app is up to you. | No | Worktree WIP rows on the graph (12.4), folder name under branch, merged-PR pill, start agent from issue, Kepler "agentic development environment" in all plans. The most active competitor by far. |
| teebe | GitHub repo created 23 Jun 2026; site updated Oct 2026 | No. Merged / not merged / uncommitted. "Ahead/behind counts for the branch" in the Changes view (against upstream, per README). | No | No. Orb while an agent is active. | No | No | Live file badges, inline diff, safe cleanup of merged worktrees (squash counts), notify when agent finishes. Free, GPL, macOS 14+. |
| Conductor | 0.93.0, 4 Nov 2026 | Unknown. Workspace status and "change target branch" exist (Feb 2026, Jan 2026). | No | No. Runs the agents; everything in a workspace is agent work by construction. | Yes, for its own workspaces. `.conductor/settings.toml` with `setup`, `run` (named actions), `archive`; ten ports per workspace via `CONDUCTOR_PORT`; files to copy. Run and Stop in the app. | Partial. `run_mode = nonconcurrent` for "one local database, one Docker stack": a switch that stops the other workspace, not a model of what is shared or whether schemas differ. | 0.93.0 is titled "Conductor is joining Meta". Cloud workspaces (Jul 2026), stacks, iOS app, remote control. |
| Fork | 2.71, 23 Oct 2026 | No. Fixed "ahead/behind not shown for branches with worktrees" in 2.63 (Feb 2026), against upstream. | No | No. Cursor and Codex for commit messages only. | No | No | Create Worktree dialog (2.63), checkout remote branch as worktree (2.68), faster worktree removal (2.71). |
| Tower | 15.0, 2 Nov 2026 (Windows); Mac notes on same page | No | No | No. AI commit messages. | No | No | Repair worktree, crash fixes, branch deletion across worktrees. No agent-era features. |
| lazygit | v0.66.2 | No | No | No | No | No | Worktree fixes only. |
| Cursor | Agents Window, Cursor 3, Apr 2026; CLI `--worktree` | Unknown. Worktrees under `~/.cursor/worktrees/`; `/worktree`, `/best-of-n`, `/apply-worktree`, `/delete-worktree`. | Partial: the agent's "main checkout stays untouched" is the product promise, not a view. | No | Partial. `.cursor/worktrees.json` setup scripts run on worktree creation. No run, test or ports. | No | Worktrees are plumbing for parallel agents; `.cursor/worktrees.json` setup scripts. |
| Claude Code | docs current Nov 2026 | No. Creates `.claude/worktrees/<name>` on branch `worktree-<name>`, from the remote default branch by default. | Partial: `blockWritesOutsideWorkingDirectories` refuses edits to the main checkout from a worktree session. A guard, not a view. | Writes `Co-authored-by: Claude` trailers, which is the signal Overlook reads. | Partial. `WorktreeCreate` hook and setup commands; no run, test or ports. | No | Worktree cleanup prompts, periodic sweep, locks while running, subagent worktrees. |

Sources: help.gitkraken.com (release notes, worktrees page), gitkraken.com/pricing, teebe.io and github.com/klein-t/teebe, conductor.build/changelog and docs.conductor.build/core/scripts, git-fork.com/releasenotes, git-tower.com/release-notes/mac, github.com/jesseduffield/lazygit/releases, cursor.com/docs (worktrees, agents-window, CLI parameters), code.claude.com/docs/en/worktrees.

What the table says. The git clients (GitKraken, Fork, Tower, lazygit, teebe) show worktrees and stop there. Cursor and Claude Code run a setup script in the worktrees they create and stop there. Conductor has the manifest: setup, run, archive, a port block per workspace, files to copy, checked into the repo. What it does not have is the git side (no graph, no behind-main, no protected checkout, no authorship), lanes that anyone else made (Claude Code's `.claude/worktrees`, a worktree you made by hand, a Cursor worktree are invisible to it), or a model of shared data beyond "do not run two at once". Nobody shows a worktree measured against the team branch as the headline number, nobody marks the primary checkout as protected, and nobody reads authorship off the commit. Two caveats against us: GitKraken's agent card already carries an ahead/behind figure, and whether it is against `main` or upstream is one install away from being known; and Conductor, now inside Meta, is one "import existing worktrees" release away from the Run half of this pitch.

What has changed in six months: GitKraken shipped worktree rows on the graph, agent sessions, and a merged-PR pill. Fork shipped worktrees at all. Conductor was acquired by Meta. teebe appeared. Everyone is building the "worktrees exist" layer. Nobody has built the "worktree versus team" layer or the "worktree that runs" layer, and the second is what makes the first worth having.

## Polish

Three details, each shown by a mock state.

1. The first row turns red the moment the primary checkout has uncommitted work or an unpushed commit, and the header says what to do. [Open it.](mocks/board.html?scenario=bad&lane=0)
2. The newest commit of each lane is tinted by who wrote it. Human gets no badge. [Open it.](mocks/board.html)
3. A running lane gets a ring around its mark, a dot on its pill in the graph, and URL chips in the header. Shared data is a badge on the same row, never a dialog. [Open it.](mocks/board.html?lane=2)

## Risks: pre-mortem

It is November 2027 and Overlook failed. The four most likely stories.

**1. Lanes still did not multiply.** The manifest worked for mobaro, the lanes started, and people still ran one agent in one folder because that was enough. The runnable-lane thesis was right about the blocker and wrong about the demand. *Response:* kill criterion 2 measures exactly this, on the team repo, in four weeks, before any app is built.

**2. Conductor imported everyone's worktrees.** It already has setup, run, ports and files-to-copy in a checked-in file, and Meta's budget. A release that shows worktrees it did not create, with a graph beside them, is the Run half of this pitch plus a better-funded See half. *Response:* kill criterion 4. The git side (behind-main, protected main, authorship) is the part a runner does not want to build; ship that first in the CLI so the test measures the whole, not the half Conductor already has.

**3. The doctor could not read real repos.** Mobaro has one AppHost; the next repo has docker-compose, a Makefile, three READMEs and a port hard-coded in a test. The doctor proposed nonsense, people edited YAML by hand, and the "cheap lanes" promise died in setup. *Response:* the doctor proposes, never decides; a manifest written by hand in ten minutes is still the product. Measure time-to-first-running-lane per repo in the smoke test.

**4. The supervisor ate the year.** Process trees, port collisions, orphaned containers, a lane that would not stop, Docker on macOS. Overlook became a worse Foreman with a graph attached, and the Mac app never shipped. *Response:* `lane.up` in version one runs the manifest's `run` command and nothing else. No container orchestration. If the repo's own start script cannot take a port offset, the doctor says so and the lane is not runnable yet.

A fifth, smaller: agents stop writing trailers. The `Co-authored-by` convention is a habit, not a contract. Authorship is the weakest of the three facts and this document treats it that way; behind, protected main and running do not depend on it.

## Decision notes

For the reader who is deciding. These do not appear in the deck.

### Kill criteria

1. **Nobody runs it twice.** The smoke test (Appendix D) goes to the mobaro team and three people outside it. If fewer than four use `lane.up` unprompted in week three, stop.
2. **Lanes do not multiply once they are runnable.** The thesis is that worktrees are rare because they cannot be run. If, four weeks after the mobaro manifest and CLI ship, the median tester still has one or zero lanes per repository, the thesis is wrong and no board will fix it. Re-scope to a `main` watcher or stop. (Today: two worktrees across sixteen repositories. Appendix A.)
3. **Nobody tells the story unprompted.** Eight Mom Test interviews (Appendix C). If fewer than four describe an incident from the last 90 days that behind, protected main, authorship or a second checkout that would not start would have changed, stop.
4. **A vendor ships it.** Conductor already has run-per-workspace with ports for the workspaces it creates. If Conductor adds a graph, behind-main and worktrees it did not create, or if GitKraken, Cursor or Claude Code ship run-per-worktree with ports and a shared-services model, before the smoke test is over, stop.
5. **The app takes longer than the test.** If the Mac app is not usable by me within six weeks of evenings after a go decision, stop and keep the CLI and MCP.

### The ask

Phase one: eight weeks of evenings for a native Mac app that is a real git client with the board on these slides, an Apple developer account (99 USD a year), a signed download and a Homebrew cask. No servers. Provider integration is read-only OAuth from the app. Then four weeks of dogfooding on the team repo and four hours of interviews.

Phase two, only after that: four evenings to write the mobaro manifest by hand and the CLI (`doctor`, `create`, `up`, `down`, `test`, `status`, `remove`) with an MCP wrapper, then the strip in the app. The repository `~/Dev/Repositories/lanes` holds a one-day Electron spike (uncommitted, 5 to 6 November); it is not the starting point.

What phase one buys is one answer: does a git client built around lanes get used every day. What phase two buys is the second: once a lane costs one command and starts on its own port, do people make more of them, and do their agents?

---

## Appendix A: data

Output of `scripts/mine.sh ~/Dev/Repositories 90`, 6 November 2026. Repositories with no commits in the window are kept to show that the worktree count covers all sixteen.

| Repo | Last fetch | Commits 90d | Agent-marked | On main direct | of which agent | Merges into main | Behind at merge (median / max) | Reverts | Reverts of agent work <48h |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| Mobaro.Core | 2026-03-10 | 0 | | | | | | | |
| Mobaro.Web | 2026-03-10 | 0 | | | | | | | |
| lanes | 2026-11-06 | 0 | | | | | | | |
| mobaro-checklist-trial | 2026-11-06 | 9 | 8 | 9 | 8 | 0 | no merge commits | 0 | 0 |
| mobaro (and its worktree) | 2026-11-06 | 2203 | 824 | 281 | 88 | 49 | 1 / 198 (7 over 20)* | 5 | 1 |
| mobaro-switch | 2026-10-22 | 121 | 119 | 119 | 118 | 1 | 0 / 0 | 0 | 0 |
| mobaro.wiki | 2026-11-06 | 1017 | 57 | 976 | 57 | 8 | 1 / 9 | 0 | 0 |
| overlook-pitch | 2026-11-06 | 0 | | | | | | | |
| ps-automation-platform | 2026-04-27 | 0 | | | | | | | |
| superset | 2025-09-09 | 0 | | | | | | | |
| terrane | 2026-07-30 | 0 | | | | | | | |
| unleash | 2026-02-12 | 0 | | | | | | | |
| vekoma-mobaro-landing | 2026-11-06 | 10 | 10 | 10 | 10 | 0 | no merge commits | 0 | 0 |
| weft | 2026-11-06 | 76 | 75 | 70 | 70 | 1 | 18 / 18 | 0 | 0 |
| wing-betting | 2026-03-11 | 0 | | | | | | | |

\* The script reports a maximum of 18,789 for mobaro; that merge (`a36b44f9`, 20 Aug 2026) joins an imported history and is excluded here. The seven over 20 are PRs #320, #271, #60, #193, #196, #81, #84.

"On main direct" counts non-merge commits on `main`'s first-parent line, which locally includes squash merges. For mobaro, `scripts/prs.sh` splits the 281 into 143 squash-merged PRs and 138 commits with no PR number. The "of which agent" column (88) is for all 281; of the 138 direct pushes, 61 are agent-marked.

Worktrees on disk, same run:

| Repo | Worktree | Branch | Dirty | Behind main | Merged into main | Last commit |
|---|---|---|---|---:|---|---|
| mobaro | `~/Dev/Repositories/mobaro` | feature/see-s6-login-hook | 23 files | 34 | no | 21 hours ago |
| mobaro | `~/Dev/Repositories/mobaro-organizational-contacts` | eng/organizational-contacts | 1 file | 0 | yes (squash) | 22 hours ago |
| mobaro-switch | `~/Dev/Repositories/mobaro-switch` | main | 5 files | 0 | yes | 2 weeks ago |
| mobaro.wiki | `~/Dev/Repositories/mobaro.wiki` | master | 0 files | 32 | yes | 2 days ago |
| weft | `~/Dev/Repositories/weft` | main | 0 files | 441 | yes | 9 months ago |
| all other repositories | one worktree each, on `main` or an old branch | | | | | |

Output of `scripts/prs.sh MobaroIT/mobaro 90 ~/Dev/Repositories/mobaro`:

```
merged PRs: 224
cycle time, hours: median 19.4, p75 116.4, p90 187.4, max 1464
merged under 1h: 62, under 24h: 133, over 7d: 37
by author: einarhansson 120, madsnk 42, ja-mobaro 26, SigurdVilstrup 19, chraaroe 12, petemachine 3, github-actions[bot] 1, lbmobaro 1
agent-prefixed branches (cursor/, claude/, copilot/): 16
merge method: squash or rebase 159, merge commit 65
commits on main with no PR number (pushed straight to main): 138
force pushes: 54 events across 60 sampled PRs, 30 PRs with at least one
```

Trailer census for mobaro, 90 days (`git log --all --since='90 days ago' --format=%b | rg -io '^co-authored-by:[^<]*'`): Cursor 965, Cursor Agent 13, Claude Opus 5 / 5.5 / Fable 5.1 (various) 48, Copilot 11, humans 48.

## Appendix B: scripts

`scripts/mine.sh [root] [days]`: read-only git mining across every repository under a folder. Agent detection is by trailer and author name matching Claude, Cursor, Copilot, Codex, GPT, OpenAI, Anthropic, Gemini, Devin or Aider. Prints Markdown.

`scripts/prs.sh owner/repo [days] [local-clone]`: pull request facts via `gh`: cycle time, merge method, agent-prefixed branches, direct pushes, force pushes on the 60 most recent PRs.

Both take about 90 seconds on this machine. Re-run them before the go/no-go so the numbers in this document are not the only ones.

## Appendix C: Mom Test interview

Eight developers who run a coding agent daily, at least three from outside Mobaro. Past tense only. No pitch, no mock, until the last question is answered.

1. "Tell me about the last time something an agent wrote ended up on `main` before anyone looked at it. What happened next?"
2. "When did you last rebase or force-push a branch right before merging it? How far behind was it, and how did you find out?"
3. "How many checkouts or worktrees of your main repository do you have on disk right now? When did you last delete one, and how did you know it was safe?"
4. "Last time you looked at a commit and were not sure whether a person or an agent wrote it, what did you do?"
5. "What did you open, type or run the last time you wanted to know whether your branch was safe to merge? Walk me through it."

Scoring, one row per interviewee:

| Question | 0 | 1 | 2 |
|---|---|---|---|
| 1 Unreviewed agent commit on main | Never happened or cannot recall | Happened, no consequence | Happened in the last 90 days with a consequence (revert, hotfix, confusion) |
| 2 Rebase before merge | Rare | Happens, found out at merge time | Happened in the last 30 days and cost more than ten minutes |
| 3 Worktrees | Zero or one | Two or three, cleaned by hand | Several, and at least one they were unsure about deleting |
| 4 Authorship | Never wondered | Wondered, read the trailer | Wondered and could not tell |
| 5 Pre-merge ritual | Nothing | One command | Several commands or tools, named unprompted |

Pass bar: four of eight score 5 or more, and question 3 scores at least 1 for four of eight. Below that, kill criterion 3 applies. Only after scoring: show the bad-day mock and ask "would you have opened this before that merge?" and "what would you pay per seat?" Record the answers; do not score them.

## Appendix D: smoke test

**What it is.** The manifest in `examples/mobaro.lane.yaml` applied to the real mobaro repo (as `.overlook/lane.yaml`, on a branch, by pull request), plus the `overlook` CLI with `doctor`, `create`, `up`, `down`, `test`, `status`, `remove`, and `overlook mcp` so Claude Code and Cursor can call the same. No UI, no daemon beyond the supervisor while a lane runs, no account.

```
$ overlook status
main    ~/Dev/Repositories/mobaro          feature/see-s6-login-hook   23 dirty  34 behind  Assisted (Cursor)  not on main
lane 1  ../mobaro-organizational-contacts  eng/organizational-contacts  1 dirty   0 behind  Human              merged, safe to remove
$ overlook create search-filters
lane 2  .worktrees/search-filters  feat/search-filters  setup 41 s
$ overlook up 2
drift: 2 migrations not in shared postgres (20261104_facets, 20261105_facet_index)
  [r]un them for every lane  [s]tart without  [p]ostgres snapshot for this lane  > r
web http://localhost:5201  api http://localhost:5255   shared: ravendb sqledge postgres
```

One line per worktree, in this order: the primary checkout, then every lane. `status --json` for scripting; `status` exits 1 if the primary checkout is not on the default branch or has uncommitted work.

**Build.** Go, one binary. Four evenings including the MCP wrapper (the tool list is seven calls over stdio) and a Homebrew tap. The git mining in `scripts/mine.sh` is most of the read logic already. The AppHost needs to read a port offset from the environment; that is a small change in `apphost.mts` and goes in the same pull request as the manifest.

**Distribution for the test.** The manifest pull request to the mobaro team (seven people), plus three outside testers with their own repo and a hand-written manifest. Logging is a local opt-in file (`~/.overlook/runs.log`) the tester sends at the end; no telemetry.

**What is measured.** Per tester, after four weeks: lanes created and lanes running at once (from `status` logs); `up` calls per week; time from `create` to first URL; drift sheets shown and which choice was taken; whether an agent called the MCP (tool name in the log); whether the tester wrote or edited a manifest for a second repo.

**Bars.** Four testers use `up` unprompted in week three (kill criterion 1). Median lanes per repository above one for at least four testers (kill criterion 2). One agent-initiated `lane.up` with a URL returned is the strongest positive signal; one is enough to proceed to the app.

## Appendix E: sources

- Local git repositories under `~/Dev/Repositories`, read 6 Nov 2026, via `scripts/mine.sh`.
- GitHub API for MobaroIT/mobaro via `gh`, 6 Nov 2026, via `scripts/prs.sh`.
- Azure DevOps API (MCP), Mobaro.Core and Mobaro.Web completed pull requests, 6 Nov 2026: empty.
- help.gitkraken.com/gitkraken-desktop/current/ and /worktrees/, fetched 6 Nov 2026 (12.6.1; 12.0 agent cards, 14 Apr 2026).
- gitkraken.com/pricing, fetched 6 Nov 2026.
- teebe.io, teebe.io/compare/git-worktree-gui-mac/ (updated Oct 2026), github.com/klein-t/teebe, fetched 6 Nov 2026.
- conductor.build, /changelog and docs.conductor.build/core/scripts, fetched 6 Nov 2026 (0.93.0, 4 Nov 2026).
- git-fork.com/releasenotes, fetched 6 Nov 2026 (2.71, 23 Oct 2026).
- git-tower.com/release-notes/mac, fetched 6 Nov 2026 (15.0, 2 Nov 2026).
- github.com/jesseduffield/lazygit/releases, fetched 6 Nov 2026 (v0.66.2).
- cursor.com/docs/configuration/worktrees, /agent/agents-window, /cli/reference/parameters, fetched 6 Nov 2026.
- code.claude.com/docs/en/worktrees, fetched 6 Nov 2026.
- survey.stackoverflow.co/2026/ai/data, fetched 6 Nov 2026 (n = 17,464 and 12,255).
- devimprint.com/compare/cursor-vs-claude-code/, snapshot 6 Nov 2026.
