# Overlook

Mac git client for parallel work. Phase one: board, lanes (worktrees), commit / push / pull / rebase / merge, conflict walk.

## Run

```bash
npm install
npm run smoke:init          # disposable repo at tmp/smoke-repo
OVERLOOK_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Or open any repo from the empty state / ⌘K.

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Vite HMR + Electron |
| `npm test` | Board reader + create/push/rebase/merge/conflict ops |
| `npm run smoke:init` | Fresh multi-worktree fixture with a local bare remote |
| `npm start` | Production build + Electron |

## Layout

- `app/` — renderer (lifted from `planning/mocks`)
- `electron/` — main process, git ops, tabs
- `planning/` — product, design, mocks

Phase two (Run / MCP) is out of scope.
