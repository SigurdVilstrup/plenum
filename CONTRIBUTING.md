# Contributing

Thanks for helping with Plenum. This is a Mac Electron app (Vite renderer + Node main process).

## Setup

```bash
npm install
npm test
npm run smoke:init          # disposable multi-worktree fixture at tmp/smoke-repo
PLENUM_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Node 20+ recommended. Packaging (`npm run pack` / `dist`) needs macOS tools (`sips`, `iconutil`).

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Vite HMR + Electron |
| `npm test` | Board, lane supervisor, doctor, CLI, MCP, agents |
| `npm run smoke:init` | Fresh fixture with a local bare remote |
| `npm start` | Production build + Electron |
| `npm run pack` | Unsigned `Plenum.app` under `release/mac*` |
| `npm run dist` | Same + `.dmg` + updater artifacts |
| `npm run icons` | Rebuild `build/icon.icns` from `branding/app-icon-1024.png` |
| `npm run plenum -- …` | CLI (`doctor`, `status`, `up`, `down`, `test`, `create`, `remove`, `mcp`) |

Bump the app version with `npm run version:patch` (or `minor` / `major`) before a release tag. GitHub Releases are Developer ID–signed and notarized; local pack stays unsigned. Update feed details: [`docs/updates-feed.md`](docs/updates-feed.md).

## Pull requests

- Keep changes focused. Prefer small PRs over mixed refactors.
- Run `npm test` before pushing.
- Do not commit `.env`, signing material, or machine-local paths under `tmp/` / `release/`.
- UI work should respect the visual contract in [`docs/design.md`](docs/design.md). The `avoid-ai-design` skill under `.agents/skills/` helps catch generic AI UI patterns.

## Manual QA (short walk)

1. `npm run smoke:init` then open `tmp/smoke-repo` in Plenum.
2. On a feature lane: dirty → Commit → Push; create another lane from ⌘K.
3. Advance `main` outside the app, confirm behind count, Rebase (or Merge). Walk a conflict if you can.
4. With a `.plenum/lane.yaml` present: Start / Test / Stop on a prepared lane (and on Protected). Unprepared checkouts stay under Worktrees until Open as lane.
5. Settings → Agents: wire a client and confirm MCP verbs (`doctor`, `create`, `up`, `status`, `test`, `down`) against a temp repo.

## Agents

See [`AGENTS.md`](AGENTS.md) for tool-agnostic guidance. Skills live only under [`.agents/`](.agents/).
