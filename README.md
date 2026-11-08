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
- `electron/` — main process, git ops, tabs, MCP
- `bin/overlook.mjs` — CLI + `overlook mcp` (stdio)
- `planning/` — product, design, mocks

## MCP (Cursor)

Point Cursor at the local stdio server (`repo.doctor`, `lane.create|up|down|test|status|remove`):

```json
{
  "mcpServers": {
    "overlook": {
      "command": "node",
      "args": ["/absolute/path/to/overlook/bin/overlook.mjs", "mcp"]
    }
  }
}
```

Or if `overlook` is on your `PATH`: `"command": "overlook", "args": ["mcp"]`.
