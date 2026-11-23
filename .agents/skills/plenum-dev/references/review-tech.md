# Technical plan / implementation review

You are reviewing Plenum technical design (plan or diff). Prefer deep, small seams over sprawl.

## Check

1. Correct process boundary: renderer (`app/`) vs main (`electron/`) vs CLI (`bin/`) vs MCP.
2. Git / lane assumptions: worktree safety, no `force` for agents, protected vs feature lane.
3. Tests: unit/smoke coverage for the change; fixtures under `fixtures/` or `tmp/smoke-repo`, not customer repos.
4. Secrets and machine paths never committed.
5. Commit messages / squash message would read as a public update.
6. Regressions: board load, supervisor, merge/rebase conflict walk, agent permissions.

## Output

- **Blockers**
- **Suggestions**
- **Pass** — one line if clean

Do not implement. Review only.
