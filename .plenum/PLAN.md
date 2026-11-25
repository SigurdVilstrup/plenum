# Feature plan: Doctor agent wiring prompt

## Goal

`repo.doctor` / `plenum doctor` already propose a lane recipe and scour hard-coded ports. That is not enough: parallel lanes only work when the **app** honors Plenum’s injected env. This feature returns a ready-to-run **`agentPrompt`** from each scan so MCP/AI callers (and humans via Copy) know exactly how to wire the repo without breaking people who never use Plenum.

## User-visible behavior

- Happy path: Open Lane setup or call `repo.doctor` → result includes `agentPrompt` (markdown). Agents follow it after (or instead of only) writing `lane.yaml`. Setup wizard “Port hits & wires” shows the prompt with Copy.
- Empty / first-run: Even with no hits, prompt still states dual-use rules and how `env.set` / `{port.*}` work.
- Errors / conflicts: Unchanged; doctor still refuses Accept without `run`. Prompt notes when Aspire/compose was found but not auto-wired.
- Keyboard / shortcuts: none new; Copy via button.

## Scope

| In | Out |
| --- | --- |
| `buildAgentPrompt` from doctor scan context | Auto-patching app source from Plenum |
| `agentPrompt` on doctor / MCP / IPC / CLI JSON | Changing port formula or multi-process model |
| MCP tool description steers agents to follow it | Aspire-specific adapters |
| Setup wizard show + Copy | New settings toggles |

## Touch list

- `electron/lane/agent-prompt.mjs` — builder
- `electron/lane/doctor.mjs` — attach field
- `electron/mcp/server.mjs` — tool description + return (already returns full doctor result)
- `electron/main.mjs` — IPC pass-through
- `app/main.js` — Port hits step UI
- tests: `doctor.test.mjs`, `mcp/server.test.mjs`
- `README.md` / `AGENTS.md` — one sentence each

## Risks

- Regressions: doctor return shape grows; UI/CLI must tolerate missing field during transition (always set).
- Lane / protected: prompt must insist on env **defaults** so non-Plenum `npm run dev` still works.
- MCP / CLI: longer JSON; agents must read `agentPrompt` — description is the steer.

## Verify

- [ ] Manual: Settings → Lane setup → Port hits shows prompt; Copy works
- [ ] `npm test` / doctor + MCP tests on fixture with hard-coded localhost
- [ ] Prompt mentions dual-use defaults and concrete hit paths
- [ ] MCP description mentions following `agentPrompt`

## Open questions

- None — confirmed approach: prompt + steer, not auto-edit.
