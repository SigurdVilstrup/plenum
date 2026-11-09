# Decoupled brand book design

**Date:** 2026-11-09  
**Status:** Approved

## Decision

Name and mark are independent shortlists. Pairing happens last. Per-name design kits (palette/type/icon pack) are deferred until a name and a mark are chosen.

## Tracks

1. **Marks** — 10 favicon-safe B&W geometries (6 abstract + 4 product). Working IDs only. Rubric: `planning/brand-logos/FAVICON-REVIEW-AGENT.md`.
2. **Names** — existing 15 candidates (meaning, domains, CLI, collision, tone). No logo attached.
3. **Pairing** — optional lockup preview: pick one name × one mark.

## Mark set (harvest + fill)

| ID | Type | Source |
|---|---|---|
| parallel-bands | abstract | Abreast iterate |
| split-rail | product (fork) | Splitrail iterate |
| dual-bend | abstract | Dualtrack iterate |
| offset-bar | product (outboard) | Outboard reshape |
| trunk-step | product (trunkside) | Trunkside reshape |
| turnout | product (diverge) | Turnout reshape |
| slit-row | abstract | new |
| feed-bars | abstract | new |
| ref-stack | abstract | new |
| cross-two | abstract | new |

## Constraints

- Solid B&W; one stroke weight; min stroke/gap ≥ 1.5/10 mark width
- No letterforms, mascots, OpenAI-knot, media `>>>`
- Glyph alone (no app-tile chrome)
- Source of truth: crisp SVG (not raster gen) so 16px is intentional

## Deliverable

Rewrite `planning/brand-book.html` around `MARKS[]` + `NAMES[]` + pairing strip. Archive coupled v3 marks stay in `planning/brand-logos/` for reference.
