---
name: triage-issues
description: >-
  Pulls open GitHub issues, dedupes them, ranks by importance (showing who
  reported each), plans a one-shot implementation of the important ones,
  implements with Hallmark for UI work, commits as steps make sense, pushes,
  and lists which reporters’ issues shipped for follow-up thanks. Use when the
  user says triage issues, prioritize the backlog, clear dogfood feedback, or
  ship the issue queue.
---

# Triage Issues

## Goal

We want all running feedback to easily be solved quickly and merged into main. Bigger features are secondary.

## Workflow

Run these steps in order. Do not skip ahead to big features while small dogfood fixes sit open.

### 1. Pull all issues

In-app feedback opens issues on the private app repo (label `feedback`), with optional `Reported by` email in the body for follow-up.

From the repo root:

```bash
gh issue list --state open --limit 100 \
  --json number,title,body,labels,createdAt,updatedAt,author,comments,url
```

Use live `gh` data only. Bias `feedback`-labeled items for dogfood P0/P1.

**Reporter (who sent the feedback):** For each issue, resolve a display name for “From”:

1. Prefer `**Reported by** <email>` in the issue body (in-app credit).
2. Else use the GitHub `author.login` when that person clearly filed it.
3. Else `unknown`.

When deduping (step 2), keep **all** reporters across related issues — not only the primary’s. List them comma-separated in the triage tables.

### 2. Put together and remove duplicates

- Merge overlapping issues into one work item (keep the best primary `#N`, list the rest as related).
- Prefer the issue with the clearest acceptance criteria / screenshot as primary.
- Example pattern: history cap mentioned in `#5` and dedicated `#17` → primary `#17`, note `#5` team-branch part stays separate if still open.

### 3. Categorize in importance

| Rank | Meaning |
|------|---------|
| **P0** | Blocks daily dogfood / broken core loop |
| **P1** | Running feedback — sharp UX pain while using the app |
| **P2** | Product quality / studies; not today’s cut |
| **P3** | Strategic / platform (accounts, OTA, feedback systems) |

Also tag effort **S** / **M** / **L** (one session / few days / multi-PR). Within a rank, smaller effort first.

Bias: dogfood notes and “I’m using this now” → P0/P1. Vision and platform → P2/P3.

### 4. Create a plan to implement the important ones in one-shot

- **Important** = all P0 and P1 after dedupe (S first, then M). Leave P2/P3 out of the one-shot unless the user expands scope.
- Write a short ordered plan: issue → approach → files likely touched → done when.
- One continuous implementation pass; no parking P1/S behind a P2/L redesign.
- Show the plan, then execute it (same session unless the user stops you).

### 5. Finish with /hallmark

When a step changes user-visible UI (layout, chrome, graph chrome, settings surfaces, new screens), apply the **hallmark** skill (`/hallmark`) for that surface before calling the step done. Non-UI backend/IPC-only steps skip Hallmark.

### 6. Commit as the steps make sense

- After each coherent shippable slice (usually one issue or one clear sub-fix), commit.
- Conventional Commits; reference `#N` in the body when useful.
- Do not bundle unrelated issues into one commit.

### 7. And push all the commits

When the one-shot plan’s important items are done (or the user ends the pass):

```bash
git push -u origin HEAD
```

Push the branch that holds the work (usually `main` only if that is already the working branch and the user expects it; otherwise the feature branch). Never force-push unless the user asks.

## Output while working

**After steps 1–3**, print:

```markdown
# Issue triage — <owner/repo> (N open → M after dedupe)

## Next (important — one-shot)
| Primary | Related | From | P | Effort | Title |
|---------|---------|------|---|--------|-------|

## Later
| Primary | Related | From | P | Effort | Title |
|---------|---------|------|---|--------|-------|
```

`From` = reporter(s) from step 1 (email or login). Never omit the column — use `unknown` when missing.

**After step 4**, print the ordered implementation plan, then start step 5–7 execution.

**At the end**, list commits pushed and which issue numbers they close or advance. Close or comment on GitHub issues only if the user asked, or if a commit message uses `Fixes #N` / `Closes #N` intentionally.

Also print a **Who we can thank** section — retention follow-up for dogfood reporters whose items shipped in this pass.

Aggregate by reporter (count of primary issues solved/advanced this pass). Then recommend who to thank:

```markdown
## Who we can thank

| Reporter | Issues shipped | #s | What shipped |
|----------|----------------|----|--------------|
| email@…  | 3              | #12, #17, #19 | short summaries |

**Recommend thanking:** <reporter> (<N> issues) — <one-line why>
(or **Recommend thanking:** none this pass — only colleagues / unknown)
```

- One row per known reporter; skip `unknown`.
- Sort by issue count descending (most feedback shipped first).
- **Deprioritize `@mobaro` emails** for the recommendation — they are close coworkers already in the loop. Still list them in the table (with a note like `colleague`), but pick **Recommend thanking** from non-`@mobaro` reporters first.
- If several non-`@mobaro` people shipped items, recommend the one with the highest count; on a tie, prefer the person who reported a P0, else the one with the clearest dogfood pain.
- If only `@mobaro` / unknown reporters shipped anything, say so and skip naming a thank target.
- Do not email anyone from this skill — only surface who to thank so the user can follow up.

## Rules

- Do not invent issues that are not on GitHub.
- Do not start P3/L work during the one-shot while P0/P1 remain.
- Ask before destructive git (force-push, hard reset, discarding work).
- Hallmark is mandatory for UI steps; skip only for pure non-UI changes.
- Always show who reported feedback in triage tables, and always end with **Who we can thank** (counts + recommendation). Deprioritize `@mobaro` for the thank recommendation.
