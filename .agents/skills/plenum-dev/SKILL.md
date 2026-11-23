---
name: plenum-dev
description: >-
  Plenum feature and fix development workflow: lanes vs protected, plan →
  multi-perspective review → implement → subagent UI/UX/tech tests → visual
  pass → squash ask. Use when starting a feature, fixing a bug, creating a
  lane, merging a lane, writing commits that double as updates, or when the
  user says "new feature", "small fix", "squash and merge", or "develop this".
license: MIT
compatibility: Works in any agent that reads agentskills.io SKILL.md. Prefer Plenum MCP (lane.create, lane.up, lane.test, lane.status) when available. Node 18+ for scripts/.
metadata:
  author: plenum
  version: "1.1.0"
  tags: plenum lanes git workflow features commits opensource
  agentskills_spec: "1.0"
---

# Plenum development

How to build in this repo: lanes for features, protected for small fixes, commits as public updates.

## Choose the surface

| Work | Where | Commit |
| --- | --- | --- |
| **New feature** | Always a **new lane** (`feature-start` / `lane.create` / board). Never invent a worktree by hand if MCP/CLI can create the lane. | On the feature lane as you go |
| **Small fix** | **Protected** lane is fine | Commit **right away** once the fix is done |

If unsure whether something is a feature or a small fix, ask once. Default: anything with new UX surface or multi-file design → feature lane.

## Commits = updates (open source)

Every commit message can ship as a user-facing update note. Write for outsiders reading the repo and release history:

- Prefer clear, complete sentences: what changed and why it matters to a user or contributor.
- No private jokes, WIP noise, secrets, machine paths, or “temp / fixup / asap”.
- Feature squash message should read as **a feature that has been added** (see Merge).
- Keep tone fit for a public Mac git client: direct, honest, no marketing fluff.
- Gate drafts with `scripts/commit-msg-check.mjs`.

## Scripts

Skill dir = `.agents/skills/plenum-dev`. Run with Node 18+:

```bash
node <skill>/scripts/feature-start.mjs <name>          # create lane + .plenum/PLAN.md + checklist
node <skill>/scripts/feature-check.mjs [lane]          # status surface + npm test + lane test + avoid-ai-design
node <skill>/scripts/commit-msg-check.mjs --stdin      # reject WIP / vague / secretish messages
node <skill>/scripts/squash-draft.mjs [lane] [--check] # draft squash message only (never merges)
```

`feature-check` is mechanical only. It does **not** replace UI/UX/tech subagent reviews or the visual pass.

## Templates

- Plan: [references/plan-template.md](references/plan-template.md) (copied to the lane as `.plenum/PLAN.md` by `feature-start`)
- Subagent review prompts: [references/review-ui.md](references/review-ui.md), [references/review-ux.md](references/review-ux.md), [references/review-tech.md](references/review-tech.md)

## Feature workflow

Copy and track:

```
Feature progress:
- [ ] 1. Create lane
- [ ] 2. Comprehensive plan
- [ ] 3. Plan review (UI / UX / technical)
- [ ] 4. Implement
- [ ] 5. Subagent tests (UI / UX / technical)
- [ ] 6. Visual pass (actually look at the UI)
- [ ] 7. Implement all review changes
- [ ] 8. Ask: squash-merge into main now, or wait?
```

### 1. Create lane

```bash
node <skill>/scripts/feature-start.mjs <name>
```

Or MCP `lane.create` / `plenum create`, then write the plan from `references/plan-template.md` into `.plenum/PLAN.md`. Work only in that lane’s checkout.

### 2. Comprehensive plan

Fill `.plenum/PLAN.md`: goal, user-visible behavior, files/areas touched, risks, verify steps. Concrete enough that someone else could implement it.

### 3. Review the plan (three lenses)

Before coding, run three reviews (subagents when available) using the prompts in `references/review-*.md`:

1. **UI** — layout, hierarchy, density, `docs/design.md`, `avoid-ai-design`.
2. **User experience** — flow, empty/error states, keyboard/shortcuts, daily Plenum user path.
3. **Technical** — git/Electron/MCP seams, tests, regressions, lane vs protected.

Revise the plan until those three pass. Pause for the user only if a decision is blocked.

### 4. Implement

Implement against the reviewed plan. Stay on the feature lane. Commit in public-ready messages; optionally pipe subjects through `commit-msg-check.mjs --stdin`.

### 5. Test with subagents

Again use `references/review-*.md` on the implementation. Also run:

```bash
node <skill>/scripts/feature-check.mjs <lane>
```

### 6. Visual pass

Actually go through the feature in the running UI. Code review alone is not enough for UI work.

### 7. Implement all review changes

Land every agreed finding from steps 5–6. Re-check the visual path if UI changed again. Re-run `feature-check` if useful.

### 8. Ask before merge

Ask the user: **squash and merge into main now, or wait?**

Do not merge until they choose. If they wait, leave the lane ready and summarize what is left.

## Merge (when they say go)

```bash
node <skill>/scripts/squash-draft.mjs <lane> --check
```

1. **Squash** the lane into one commit (or one PR squash) using a message that marks a **feature that has been added**.
2. Prefer the `squash-draft` subject/body (edit as needed); do not dump every WIP subject as the final message.
3. Follow normal git safety (no force on main, no secrets).

## Small-fix path

1. Work on protected (or current protected checkout).
2. Fix narrowly.
3. Commit immediately with an updates-ready message (`commit-msg-check` if unsure).
4. No feature plan / subagent gauntlet unless the fix grows into a feature — then stop, `feature-start`, and switch to the feature workflow.

## Anti-patterns

- Building a feature on protected “just this once”.
- Treating `feature-check` green as “done” without UI/UX/tech + visual pass.
- Squash messages that list every WIP commit instead of stating the added feature.
- Commit messages that would embarrass the project on a public changelog.
- Merging without asking now-or-wait.
- Cutting a desktop release without `.agents/skills/plenum-release` / `npm run release:check` (OTA must stay alive — a broken update cannot be fixed over the air).
