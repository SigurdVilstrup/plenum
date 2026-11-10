# Plenum landing — positioning one-pager

Drafted 10 Nov 2026 from raw material only: `PRODUCT.md` (mining + Mom Test kill criteria), dogfood GitHub issues (#5–#28), live competitor URLs (same rubric). No landing mockups.

Brand name on the site: **Plenum**. Domain direction: **plenum.sh**. Repo code name Overlook remains internal.

---

## Competitive teardown (live pages, same rubric)

Rubric: category claim · audience · proof · CTA · job of the page.

| Site | Category claim | Audience | Proof | CTA | Job of the page |
| --- | --- | --- | --- | --- | --- |
| [gitkraken.com](https://www.gitkraken.com/) | “Code flow” / plan→main; Desktop + GitLens + Kepler ADE + Insights | Devs + eng leaders; AI-era control | Logos, quotes, product family | Download / plans | Own “git + agents + leaders” as a suite |
| [git-fork.com](https://git-fork.com/) | Fast friendly git client | Individual Mac/Win devs | Feature list, craft story | Download ($59.99) | Sell a sharp classical git GUI |
| [conductor.build](https://conductor.build/) | Parallel coding agents on your Mac | Agent-heavy builders | Product demo framing | Docs / changelog | Sell agent orchestration, not git overview |
| [teebe.io](https://teebe.io/) | Worktree manager beside the terminal | Terminal + Claude/Codex/Cursor users | Live badges, merge marks, brew | brew install | Sell “see agent worktrees / clean up” — not full git verbs |
| [cursor.com](https://cursor.com/) | Coding agent for ambitious software | Builders / enterprises adopting AI | Logos, interactive demos | Try Cursor | Sell writing code with agents |
| [linear.app](https://linear.app/) | Product development system for teams + agents | Product/eng teams | Live product UI, stories | Get started / sales | Sell planning+build system, craft + speed |

**Learning for us:** Git clients sell *control of history*; orchestrators sell *running agents*; Cursor sells *writing*. Plenum must not sound like Cursor or Conductor on the hero. Closest traps: GitKraken’s “agents in view” (suite) and teebe’s worktree marks (narrow). Our wedge is **lanes on a real git board measured against the team**, with CLI/MCP as the agent handoff — humans keep the git verbs.

---

## Dunford-style positioning

### Competitive alternatives (what people do today)

1. **GitKraken / Fork / Tower** — serious git GUI; worktrees secondary; no protected-team story; weak “behind team per worktree” as the headline.
2. **Terminal + lazygit / git status** — full power; no board; agent chaos across folders.
3. **teebe** — see/clean agent worktrees; not commit/push/rebase/merge as daily driver.
4. **Conductor / IDE worktrees** — parallel agents in isolated workspaces; not a team git overview; not “any worktree you already have.”
5. **One primary checkout** — what Mobaro data shows people actually do when a second checkout won’t start.

### Unique attributes (only Plenum, if we ship them)

- **Lanes as the product unit** on a full git client (graph + verbs per lane), not a bolt-on worktree dialog.
- **Protected team checkout** — watch, don’t work/run there.
- **Behind the team branch** per lane as a first-class fact (not only upstream ahead/behind).
- **Authorship from the commit** (human / assisted / agent).
- **Same lane verbs on board + CLI + local MCP** — agents don’t get silent git writes; they get lane ops.
- Phase two (later proof, not required for v1 hero honesty): runnable lanes + shared-data drift.

### Value

Keep your head cool when humans and agents fan out across branches: see where each lane stands against the team, keep primary clean, do real git without losing the plot.

### Best-fit ICP

Mac engineers (and tech leads) on **multi-author product repos** where agents already write a large share of commits, parallel features are normal, and a second checkout is painful — so work collapses onto primary. Buyer is the person who still owns merge quality, not the person shopping “AI IDE.”

### Market category

**Mac git client for parallel work (lanes).**  
Not: AI IDE. Not: agent orchestrator. Not: “GitKraken but purple.”

### Single job of plenum.sh

In ten seconds, a cold ICP reader can say: *“It’s the git app for keeping parallel lanes clear against the team — and agents still use the CLI.”*

---

## Honest constraint (dogfood)

Basics must catch up (#24). Landing copy for **phase one** should promise overview + lanes + git verbs + CLI/MCP — not lead with runnable stacks until dogfood proves the client is daily-driver trustworthy. Phase two is a later proof block, not the only headline.

### Strongest product moment to capture (proof asset)

Board with several lanes: protected primary, behind marks, authorship pills, graph tips — Mobaro-scale, calm scan. Secondary: CLI/`overlook mcp` next to the board (CLI → interface without dropping agents).

---

## Recommended epic split (≤4 children, dependency order)

| Order | Issue | Does | Replaces |
| --- | --- | --- | --- |
| 1 | **Positioning locked** | This one-pager + cold test pass (# below). Edit until ICP restatement works. | #33 (merge into this) |
| 2 | **Proof assets** | Record the overview moment + optional CLI/MCP still; short caption list tied to attributes above. No brand studies yet. | New; inputs for page |
| 3 | **Narrative: CLI → interface** | One story beat for plenum.sh: humans get the board; agents keep CLI/MCP. Domain/name only after (1). | Slim #31 |
| 4 | **Page build** | Hero + proof + CTA from locked message; craft references (Cursor/Linear density) only here. | New; absorbs useful bits of #34 |

**Kill / merge**

- **#32** — close as done-enough for now; teardown table lives in this doc. Reopen only if category claim changes.
- **#34** — close as premature; fold “modern site craft” into child 4 after message locks.
- **#31** — close or retarget as child 3 (narrative only, not a free-floating domain ticket).
- **#33** — close as superseded by child 1 + this file.

Do **not** add more “study X’s website” children until child 1 passes the cold test.

---

## Pass/fail: 5 cold ICP readers

### Who

Five people who match ICP (Mac, multi-dev product repo, some agent use). Not founders of Plenum. Not people who already know Overlook.

### Protocol

1. Show **only** a static hero (headline + one subline + one screenshot caption). 5 seconds, then hide.
2. Ask, without prompting the answers:
   - What is this product?
   - Who is it for?
   - How is it different from GitKraken?
   - How is it different from Cursor / an AI IDE?
3. Optionally show a **generic control** hero (“AI-powered git for teams”) and ask which they’d open first (preference).

### Rubric (score 0–2 each; pass = mean ≥1.5 and no hard fail)

| Criterion | 2 | 1 | 0 (hard fail if majority) |
| --- | --- | --- | --- |
| Category | Names a git client / parallel work overview | Vague “dev tool” but not AI IDE | Calls it an AI IDE or agent runner |
| Buyer | Engineer / lead who owns branches & merges | “Developers” vague | Exec buying “AI transformation” only |
| vs GitKraken | Lanes / team-behind / protected primary / agent handoff via CLI | “Looks nicer” only | “Same as GitKraken” or “GitKraken for AI” |
| vs AI IDE | Explicitly not where you write code; git overview + CLI for agents | Unclear but not Cursor | “Like Cursor for git” |

**Pass:** ≥4 of 5 readers score category ≠ 0 and vs AI IDE ≠ 0; mean across criteria ≥1.5.  
**Fail:** Rewrite headline/subline; do not start page build.

Other than us: the five readers’ scored sheets are the gate.
