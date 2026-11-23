# Plenum

Mac git client for parallel work. Open a repo, see **Protected**, **Lanes**, and plain **Worktrees** on one board, and move commits with Commit / Push / Pull / Rebase / Finish — including a conflict walk. A **lane** is a worktree with Plenum’s runner: check in a `.plenum/lane.yaml`, then Start / Stop / Test with port offsets (Protected included), or drive the same verbs from the CLI and a local MCP server.

Download signed builds from [plenum.sh](https://plenum.sh). Updates come from the public feed at [plenum.sh/updates](https://plenum.sh/updates/) — no GitHub token required.

## Develop

```bash
npm install
npm run smoke:init          # disposable repo at tmp/smoke-repo
PLENUM_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Or open any repo from the empty screen / ⌘K. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for tests, packing, and a short manual QA walk.

### Lane manifest

Hand-write a minimal manifest, or use **Settings → Lane** to edit the live file as a form (or Lane setup → Write when the repo has none):

```yaml
# .plenum/lane.yaml
version: 1
run: python3 -m http.server {port.web}
test: node -e "process.exit(0)"
ports:
  offset: 100
  expose:
    web: 8000
```

Protected (index 0) uses base ports (`8000`). Lane 1 gets `web` on `8100` (`8000 + 100`). Create / Open as lane copies `env.copy` and runs `setup` when present. Drift gates Start when shared migrations are pending. `plenum doctor` / MCP `repo.doctor` also scour for hard-coded localhost ports and report wiring gaps.

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Vite HMR + Electron |
| `npm test` | Board, lane supervisor, doctor, CLI, MCP |
| `npm run smoke:init` | Fresh multi-worktree fixture with a local bare remote |
| `npm start` | Production build + Electron |
| `npm run pack` | Unsigned `Plenum.app` in `release/mac*` |
| `npm run release:check` | Tests + pack + launch + OTA/updater invariants (required before tagging) |
| `npm run dist` | Same + `.dmg` + updater `.zip` / `latest-mac.yml` |
| `npm run icons` | Rebuild `build/icon.icns` from `branding/app-icon-1024.png` |
| `npm run plenum -- …` | CLI (`doctor`, `status`, `up`, `down`, `test`, `create`, `remove`, `mcp`) |

```bash
npm run pack
open release/mac*/Plenum.app
```

Local pack/dist stay unsigned; GitHub Releases are Developer ID–signed and notarized. Maintainer notes for the update feed: [`docs/updates-feed.md`](docs/updates-feed.md).

- Disable auto-update: `PLENUM_DISABLE_AUTO_UPDATE=1`
- Override feed: `PLENUM_UPDATE_FEED_URL=https://…/updates/`

## CLI and MCP

```bash
plenum doctor [path]
plenum create <name> [path]
plenum up <lane> [path]      # primary (0) is protected
plenum status --json [path]
plenum test <lane> [path]
plenum down <lane> [path]
plenum remove <lane> [path]
```

Settings → Agents → Add wires Cursor, Claude Code, or Codex to Plenum. The app writes `~/.plenum/bin/plenum` on launch (bundled CLI, no Node/`PATH` setup). Any other MCP client:

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

Defaults: agents can start/stop/test and create lanes; remove is Allow; writing `.plenum/lane.yaml` is Never. Change them under What agents may do (`~/.plenum/agents.json`). Agents never get `force`.

## Layout

- `app/` — renderer
- `electron/` — main process, git ops, lane supervisor, tabs, MCP
- `bin/plenum.mjs` — CLI + `plenum mcp` (stdio)
- `branding/` — icon masters
- `site/` — landing page (plenum.sh)
- `.agents/` — shared agent skills ([`AGENTS.md`](AGENTS.md))

## License

[MIT](LICENSE)
