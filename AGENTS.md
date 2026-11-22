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

- `avoid-ai-design` — audit/rewrite frontend that reads as generic AI UI. See `.agents/skills/avoid-ai-design/SKILL.md`.

## Design

Visual contract: [`docs/design.md`](docs/design.md). Product docs for humans: [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md).
