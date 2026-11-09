# Brand name investigation — replacing Overlook

Written 9 November 2026. Meaning-first shortlist with domain probes (DNS + RDAP) and collision checks against adjacent agent/git tooling. Domains marked available are **likely** free as of this date; register before announcing.

**Visual source of truth:** [`planning/brand-book.html`](../../planning/brand-book.html) — decoupled tracks: 10 favicon-safe SVG marks + 15 names + optional pairing. Per-name design kits deferred. See [`2026-11-09-decoupled-brand-book-design.md`](./2026-11-09-decoupled-brand-book-design.md).

## Purpose (what this product is)

**One line.** A Mac git client built around lanes — parallel worktrees you can see against the team — that later makes those lanes runnable and callable by coding agents via a local CLI/MCP. Not an agent composer: agents call in; people still own git.

**End goal.** In a corporate engineering org, parallel agentic work becomes normal without chaos: protected main stays protected, behind/authorship are visible, each lane can run on its own ports, shared data hazards are on the board (not hidden), and the same verbs work for humans and agents.

**Moat.** Enabling agentic work *in a corporate setting* by making the real blockers cheap: runnable worktrees, visible team state, shared-data honesty. Built by developers for developers; sold as infrastructure a security-conscious company will trust on laptops.

**Positioning (locked).** Lead as agent-era team infrastructure; co-claim “excellent git client” hard. Tone: developer-clever with quiet confidence. Meaning in the name should encode **parallel work**, **visibility vs main**, and/or **runnable lanes without chaos** — not “orchestrate agents.”

**Constraints.** Prefer exact `name.io` / `name.sh`; soft fallbacks OK. CLI can be a short alias (mostly for agents).

## Naming scorecard

| Criterion | Weight |
|---|---|
| Encodes A parallel / B visibility / D runnable | high |
| Sayable in a procurement email | high |
| Memorable + spellable after one hearing | high |
| Distinct from Fork / Tower / GitKraken / Conductor / teebe / Berth / Slipway / Spur / Siding | high |
| `.io` or `.sh` available (exact or soft) | high |
| Works as Mac app name + future landing hero | medium |
| Short CLI alias exists | low (alias OK) |

## Competitive whitespace (quick)

| Neighbor | Territory | Avoid sounding like |
|---|---|---|
| Fork, Tower, GitKraken | Classic git GUI brands | Pure “git client” nouns only |
| Conductor | Agent workspace runner (Meta) | Composer / orchestra / conductor |
| Berth, Slipway, Spur, Siding/Sidings | Parallel worktrees / agent envs — **crowded** | Same metaphor already shipping |
| Mainline, Sightline | Agent-era git memory / governance | Overlap on “line” + agent pitch |
| Graphite, GitButler | Stacked / virtual branches | PR-stacking or virtual-branch story |

Killed early for hard collisions: Slipway, Drydock, Berth, Mainline, Sightline, Spur, Siding, Apron, Joist, Towpath, Laneway, Trellis, Quay, Loom, Lattice, Headway.

## Shortlist (15)

Full visual briefs live in the brand book. Summary table:

| # | Name | Domains (probe) | Notes |
|---|---|---|---|
| 1 | **Abreast** (recommended) | `.io` + `.sh` RDAP 404 | Best balance |
| 2 | Hardstand | `.io` + `.sh` RDAP 404 | Strongest A+B+D |
| 3 | Splitrail | `.io` + `.sh` RDAP 404 | Rail/git clever |
| 4 | Plenum | `.sh` likely; `.io` taken | Shared-data metaphor |
| 5 | Outboard | `.io` + `.sh` RDAP 404 | Protected-main story |
| 6 | Flightline | `.sh` likely; `.io` taken | Aviation ready-line |
| 7 | Trunkside | `.io` + `.sh` RDAP 404 | Near Trunk.io in speech |
| 8 | Dualtrack | `.io` + `.sh` RDAP 404 | Clear parallel |
| 9 | Laneboard | `.io` + `.sh` RDAP 404 | Descriptive |
| 10 | Refline | `.sh` likely; `.io` taken | Visibility/datum |
| 11 | Offtrunk | `.io` + `.sh` RDAP 404 | Blunt git compound |
| 12 | Cleartrack | `.sh` likely; `.io` taken | Abandoned 90s TM only |
| 13 | Turnout | `.sh` likely; `.io` taken | Dual meaning (attendance) |
| 14 | Trackside | `.sh` likely; `.io` taken | Visibility beside track |
| 15 | Cordage | `.sh` likely; `.io` taken | Parallel strands |

Also killed in the expansion pass: Readyline (utility product), Wayside (HR SaaS), Abeam (pilot logbook), Branchline (release-rehearsal tool).

### Detail: Abreast — recommended

**Meaning.** Side-by-side. Parallel lanes of work standing *abreast* of each other and of protected main.

**Why it fits.** Encodes A strongly, B as “you can see them all at once,” quiet + clever, not an orchestrator. Corp sentence: “We’re standardizing on Abreast for parallel agent work.” Developer sentence: “Open Abreast — three lanes abreast of main.”

**Risks.** Slightly unusual everyday word; one-beat education on first landing. Not a collision in adjacent tooling.

**Domains.** `abreast.io` and `abreast.sh` — RDAP 404 (likely free). Also `abreast.dev`, `getabreast.io`.

**CLI alias.** `ab` or `abe`.

**Brand kit**

| Piece | Direction |
|---|---|
| Palette | Chart-night navy `#0B1220`, paper `#F4F0E6`, signal copper `#C56A2B`, hairline `#2A3344` — not purple, not cream-serif terracotta |
| Font | Display: **Fraunces** (soft serif, confident). UI: **IBM Plex Sans**. Mono: **IBM Plex Mono** |
| Logo | Wordmark “Abreast”; mark = three vertical ticks of equal height (abreast bars), middle tick slightly taller = protected main |
| Favicon | Three vertical bars on navy square; copper on the main tick |
| Icon pack | Lucide or Phosphor **regular** — sparse, chart-like; prefer line over fill |
| Landing vibe | Hero: brand first, one line — “Parallel work, abreast of main.” Full-bleed abstract “lanes as ticks” motion, not a dashboard collage. Trust strip for local-only / no cloud. Secondary: “Also a damn good git client.” |

---

### 2. Hardstand

**Meaning.** Aviation: paved ground where craft stand ready in parallel — staged, visible, about to move.

**Why it fits.** A + D (ready to run) and B (everything on the hardstand is in view). Ops/aviation tone reads corporate-trustworthy.

**Risks.** Needs a one-line gloss once. Slight EV-charging name-generator noise online; no shipping software product found.

**Domains.** `hardstand.io` and `hardstand.sh` — RDAP 404. Soft: `hardstand.dev`.

**CLI alias.** `hs` or `stand`.

**Brand kit**

| Piece | Direction |
|---|---|
| Palette | Tarmac charcoal `#121417`, taxiway yellow `#E2B100` (sparingly), mist `#D7DCE2`, white ink |
| Font | Display: **Schibsted Grotesk**. UI: **Schibsted Grotesk**. Mono: **JetBrains Mono** |
| Logo | Wordmark; mark = low wide rectangle (pad) with 3 small chevrons / craft silhouettes in a line |
| Favicon | Pad rectangle + one yellow hold-short line |
| Icon pack | **Heroicons outline** — utilitarian, airport-ops |
| Landing vibe | Hero atmosphere = empty hardstand at dawn (real photo or restrained illustration), brand dominant, CTA “Put every lane on the hardstand.” Feels like ops software, not a toy. |

---

### 3. Splitrail

**Meaning.** A rail that splits from the main line — your work leaves trunk without leaving the yard.

**Why it fits.** A + B in railroad/git language developers already speak. Invented compound = ownable. Quiet confidence.

**Risks.** “Split” can sound like fragmentation; landing copy must frame it as intentional parallel, not chaos. No notable product collision found.

**Domains.** `splitrail.io` and `splitrail.sh` — RDAP 404.

**CLI alias.** `sr` or `rail`.

**Brand kit**

| Piece | Direction |
|---|---|
| Palette | Rail iron `#1C1F24`, insulator green `#2F6B4F`, signal red `#B42318` (danger only), light ballast `#E8E4DC` |
| Font | Display: **Space Grotesk**. UI: **Source Sans 3**. Mono: **Source Code Pro** |
| Logo | Wordmark; mark = single line that forks into two equal rails (Y → parallel) |
| Favicon | Minimal fork-to-parallel mark on iron square |
| Icon pack | **Tabler Icons** — technical, dense-OK |
| Landing vibe | Hero: animated single line splitting into parallel rails (2–3 motion beats). Headline: “Split from main. Stay in view.” Corp trust via graph honesty, not buzzwords. |

---

### 4. Plenum

**Meaning.** Shared chamber / common volume. In the product: shared services are the plenum; lanes are bays off it — shared data made visible.

**Why it fits.** Unique encoding of **D** (and your differentiator vs isolation-first tools). Engineering vocabulary → corp trust. Clever for seniors.

**Risks.** Obscure to some developers; HVAC/networking association. Marketing must teach once. `plenum.io` taken; `plenum.sh` likely free.

**Domains.** `plenum.sh` likely free. Soft: `useplenum.sh`. Prefer `.sh` as primary.

**CLI alias.** `pl` or `plenum`.

**Brand kit**

| Piece | Direction |
|---|---|
| Palette | Plenum void `#07090C`, chamber teal `#1F6F6A`, shared amber `#D4A017` (shared-data signal), ink `#EEF2F4` |
| Font | Display: **Instrument Serif** (one hero word only). UI: **Geist** or **Inter** only if forced — prefer **Satoshi**. Mono: **Geist Mono** |
| Logo | Wordmark; mark = rounded chamber with three ports/outlets (lanes off the shared volume) |
| Favicon | Chamber + three ports silhouette |
| Icon pack | **Phosphor duotone** sparingly — shared vs isolated states |
| Landing vibe | Dark, technical, one diagram: shared plenum in the center, lanes as ports. Headline: “Shared data is a fact. Show it.” Sub: “Runnable lanes for people and agents — local MCP, excellent git client.” |

---

### 5. Outboard

**Meaning.** Outboard of the hull — work happens outside the protected primary checkout, on its own power.

**Why it fits.** Elegant for “protected main”: the ship (main) stays intact; lanes run *outboard*. A + D. Both `.io` and `.sh` likely free (RDAP 404).

**Risks.** Soft collisions: Outboard (manufacturing ops site), a PHP framework, an npm package — different spaces, but SEO noise. Boat-motor reading if design goes kitschy.

**Domains.** `outboard.io` and `outboard.sh` — RDAP 404.

**CLI alias.** `ob` or `out`.

**Brand kit**

| Piece | Direction |
|---|---|
| Palette | Hull black `#0E1114`, sea glass `#3A7A6A`, foam `#E7EEF0`, running light `#5B8CFF` (cool blue, not purple brand wash) |
| Font | Display: **Newsreader**. UI: **Public Sans**. Mono: **IBM Plex Mono** |
| Logo | Wordmark; mark = hull silhouette with a small outboard block offset to the side (lane) |
| Favicon | Offset block beside a vertical hull stroke |
| Icon pack | **Lucide** — nautical restraint, no cartoon anchors |
| Landing vibe | Hero: brand + “Work outboard of main.” Motion: primary stays fixed; lane blocks slide out and light up (running). Trust: local process, signed Mac app, no cloud control plane. |

## Comparison

| Name | Parallel (A) | Visibility (B) | Runnable (D) | Clever+quiet | Corp trust | Domain strength | Collision risk | Overall |
|---|---|---|---|---|---|---|---|---|
| **Abreast** | ●●● | ●● | ● | ●●● | ●●● | ●●● `.io`+`.sh` | Low | **1st** |
| Hardstand | ●●● | ●●● | ●●● | ●● | ●●● | ●●● `.io`+`.sh` | Low | 2nd |
| Splitrail | ●●● | ●● | ●● | ●●● | ●●● | ●●● `.io`+`.sh` | Low | 3rd |
| Plenum | ●● | ● | ●●● | ●●● | ●●● | ●● `.sh` | Low–med (obscurity) | 4th |
| Outboard | ●●● | ●● | ●●● | ●●● | ●● | ●●● `.io`+`.sh` | Med (SEO soft) | 5th |

## Recommendation

**Ship Abreast** unless you want the sharper ops metaphor (**Hardstand**) or the railroad-git pun (**Splitrail**).

Abreast wins because: meaning matches the board (lanes abreast of main), both premium TLDs look free, no adjacent-product collision, and the brand can stay quiet while still being clever — the bar you set.

**Next steps if approved**

1. Register `abreast.io` + `abreast.sh` (or chosen name) immediately.
2. Quick USPTO/EUIPO + GitHub org handle check.
3. Lock palette/fonts in `planning/DESIGN.md` and rebuild app icon.
4. Draft landing first viewport from the kit above (separate task).

## Runner-ups (not expanded)

Flightline (`.sh` free; aviation ready-line), Trunkside (both free; near Trunk.io brand), Dualtrack (both free; clear but flatter), Laneboard (both free; descriptive), Refline (`.sh` free; visibility-first).
