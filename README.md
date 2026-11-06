# Overlook

*Codename. The real name is not decided.*

A Mac git client for parallel work. Every branch you or an agent is working on gets a **lane**: a git worktree on its own branch, plus the way to run it. Overlook shows all lanes measured against the team branch, starts and stops them on their own ports, and hands the same controls to any agent over a local MCP.

![The board: lanes panel with a Running section, the selected lane's header with Run, Test, URLs and shared-data badge, and the commit graph with authorship pills](planning/assets/board-dark.png)

## The problem

Worktrees are the right way to run several changes at once, and almost nobody uses them. Spinning one up means a second `pnpm install`, a port clash, a database the other checkout is already writing to, and a `.env` file that did not come along. So people work on one branch at a time, and agents that create their own worktrees leave them behind unrun and untested.

Git clients show worktrees and stop. Agent runners run their own workspaces and stop. Nothing shows the whole picture and makes every lane runnable.

## The idea

**A git client first.** Commit, push, pull, rebase, merge, resolve conflicts. Real git, plain repo. What is different is that every verb is per lane, and the board tells you what each lane needs before you ask: Commit when there is uncommitted work, Rebase on main when behind, Merge and Push when ahead.

**See.** One board per repository. The protected checkout first, never touched by Overlook, red the moment something lands on it. Every lane with three facts: readiness, how far behind the team branch, and who wrote the tip (human, assisted, agent).

**Then run (phase two).** A file in the repo, `.overlook/lane.yaml`, says how a lane starts, tests and which services are shared. Overlook does not run your app. It calls your command (Aspire, docker compose, three shell scripts, `make dev`) with the lane's folder, a port offset and its env. Shared data is the visible default; migration drift against the shared database is the only thing that stops a Run.

**Then hand off (phase two).** `overlook mcp` serves the lane verbs to any agent, IDE or script: `repo.doctor`, `lane.create`, `lane.up`, `lane.down`, `lane.test`, `lane.status`, `lane.remove`. The same names exist as a CLI. Overlook never runs an agent and has no opinion about the model.

```yaml
# .overlook/lane.yaml, proposed by the doctor, checked in with the repo (phase two)
setup:  pnpm install
run:    pnpm nx run aspire-apphost:start   # yours; Overlook calls it
test:   pnpm nx affected -t test
ports:
  offset: 100                              # lane 1: 5101, lane 2: 5201
services:
  ravendb:  shared
  postgres: shared                         # snapshot available
```

## Order of work

1. **The client.** Board, graph, lanes as worktrees, protected main, behind, authorship, git verbs per lane. A Mac app to use every day.
2. **Dogfood** on the team repo.
3. **Running lanes.** Manifest, CLI, MCP, the strip under the lane header. The bigger job; it starts once the client is in daily use.
4. **Shared data.** Drift, snapshots, the Run sheet.

## What it will not do

Run an agent, or commit, push and merge on an agent's behalf; agents get lane verbs, git stays with whoever is in the lane. Interpret or replace the repo's own commands. Start anything in the protected checkout. Hide the fact that data is shared behind a dialog.

## Status

Nothing is built yet. This repository holds the planning work:

| Where | What |
|---|---|
| [planning/index.html](planning/index.html) | The pitch deck, 12 slides. Open it in a browser. |
| [planning/PRODUCT.md](planning/PRODUCT.md) | The full product memo: idea, vocabulary, must and must not, manifest schema, MCP and CLI, evidence from real repos, competitor audit, pre-mortem, decision notes and the ask. |
| [planning/DESIGN.md](planning/DESIGN.md) | The visual contract: tokens, icons, layout rules, motion, do and don't. |
| [planning/mocks/](planning/mocks/) | Clickable HTML mocks of the board, lane setup, settings and the agents page. Work from disk, no build. |
| [planning/examples/mobaro.lane.yaml](planning/examples/mobaro.lane.yaml) | A worked manifest for a real monorepo. |
| [planning/scripts/](planning/scripts/) | The git and PR mining that produced the numbers in the memo. |

The next step, from the memo: build the git client and use it daily, then make lanes runnable. Details and the kill criteria are in [planning/PRODUCT.md](planning/PRODUCT.md#decision-notes).
