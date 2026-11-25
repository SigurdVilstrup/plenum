# Agents

Plenum is a Mac git client for parallel work. A **lane** is a worktree with Plenum’s runner set up (`.plenum/lane.yaml` + Open as lane / create); plain worktrees sit under Worktrees until then. One board for Protected / Lanes / Worktrees, commit / push / pull / rebase / merge with a conflict walk, plus CLI and a local MCP server.

## Layout

- `app/` — renderer
- `electron/` — main process, git ops, lane supervisor, tabs, MCP, agent wiring
- `bin/plenum.mjs` — CLI and `plenum mcp` (stdio)
- `branding/` — icon masters (`npm run icons`)
- `site/` — landing page for plenum.sh
- `.agents/skills/` — shared skills (any agent that reads agentskills.io `SKILL.md`)

## Commands

```bash
npm install
npm test
npm run smoke:init
PLENUM_OPEN="$PWD/tmp/smoke-repo" npm run dev
npm run plenum -- doctor .
```

Do not commit secrets (`.env`, certs, tokens). Prefer `fixtures/` and `tmp/smoke-repo` over real customer repos in examples.

## Development

Applies to every agent working in this repo (not Cursor-only). Full feature checklist: `.agents/skills/plenum-dev/SKILL.md`.

### Lanes

- **New feature** → always create a **new lane** and work there (`lane.create` / board / `plenum create`). Do not build features on protected.
- **Small fix** → protected is fine; **commit right away** when done.
- Unsure feature vs fix? Ask once. New UX surface or multi-file design → feature lane.

### Commits are public updates

This project is open source. Commit messages double as update notes:

- Write for outsiders: what changed and why it matters.
- No WIP noise, secrets, local paths, or private shorthand.
- When squash-merging a lane, the message must mark a **feature that has been added**, not a dump of intermediate commits.

### Feature work

Plan → review the plan (UI, UX, technical) → implement → test UI/UX/technical with subagents → actually look at the UI → land review fixes → **ask** whether to squash-merge into main now or wait. Never merge a feature lane without that ask.

Helpers (Node 18+): `.agents/skills/plenum-dev/scripts/` — `feature-start.mjs`, `feature-check.mjs`, `commit-msg-check.mjs`, `squash-draft.mjs`. Plan + review stubs under `.agents/skills/plenum-dev/references/`.

## MCP

The desktop app writes `~/.plenum/bin/plenum` on launch. Any MCP client can use:

```json
{
  "mcpServers": {
    "plenum": {
      "command": "/Users/you/.plenum/bin/plenum",
      "args": ["mcp"]
    }
  }
}
```

Tools: `repo.doctor`, `lane.create`, `lane.up`, `lane.down`, `lane.test`, `lane.status`, `lane.remove`. Defaults (Settings → Agents → What agents may do) allow start/stop/test/create; remove is Allow; writing `.plenum/lane.yaml` is Never. Agents never get `force`, and only write a manifest in a repo that has none.

## Skills

- `plenum-dev` — feature vs small-fix lanes, commits-as-updates, plan → review → implement → subagent tests → squash ask. See `.agents/skills/plenum-dev/SKILL.md`.
- `plenum-release` — ship desktop updates without breaking OTA self-heal: `npm run release:check` (pack + launch + updater/feed invariants) before any version tag; CI blocks publish if the loop is broken; verify https://plenum.sh/updates/. See `.agents/skills/plenum-release/SKILL.md`.
- `avoid-ai-design` — audit/rewrite frontend that reads as generic AI UI. See `.agents/skills/avoid-ai-design/SKILL.md`.

## Design

Visual contract: [`docs/design.md`](docs/design.md). Action → icon lexicon: [`docs/icons.md`](docs/icons.md). Product docs for humans: [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
