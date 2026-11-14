# Design

Visual contract for the Plenum Mac app. Near-black canvas, charcoal panels, hairline borders, one lavender accent for real actions, focus, and the selected lane — never decoration. Four surface looks: dark/light × muted/vibrant (Appearance → Surfaces).

## Colors (roles)

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| Canvas | `#010102` | `#f5f6f8` | Window ground |
| Surface 1–3 | `#0f1011` → `#18191a` | `#eef0f4` → `#dce1e9` | Panel, hover, selection |
| Hairline / strong | `#23252a` / `#34343a` | `#d2d7e1` / `#bcc3d0` | Separation (no inner shadows) |
| Ink → tertiary | `#f7f8f8` → `#62666d` | `#0c0d12` → `#858d9b` | Four reading levels |
| Primary | `#5e6ad2` | `#5e6ad2` | Buttons, focus, selected lane, `main` pill |
| Success / warning / danger | green / amber / red | same roles | Ready, drift, destructive |
| Human / assisted / agent | blue / amber / coral | same roles | Authorship on tips |

Lane 0 (primary) stays neutral in the graph; the selected lane takes primary; others cycle secondary lane hues.

## Typography and icons

System UI stack. Display at 600 with slight negative tracking for the selected lane name and page titles. Body 13px. Mono 11px for refs, SHAs, paths, WIP counts.

Icons: Phosphor Regular, 16px, `currentColor`, vendored in `app/icons.svg`. No tiles behind icons.

## Layout

- Window ~1280×800, hairline-strong border, soft desk shadow only.
- Title bar (~52px): traffic lights, mark, tab strip; live sync + ⌘K on the right.
- Lanes panel (~260px): Protected, Lanes, Branches without a lane; Settings at the bottom. Selected runnable lane expands Run / Stop / Test / services.
- Board toolbar above panel + graph: lane facts left; Commit / Stash / Pop / Pull / Push, then Finder and Open in editor.
- Graph owns the rest of the window: column header, 30px rows, SVG edges/nodes. Signature detail: the WIP row — dashed node above a tip with change count and Open.

Nothing is a card. Structure is list + full-height graph; Plenum facts (behind team branch, protected primary, authorship, running) are marks and pills on that structure.

## Agent UI work

Prefer this contract over generic “AI default” layouts. The `avoid-ai-design` skill under `.agents/skills/` flags purple gradients, Inter-everywhere, three-card heroes, and the common “tasteful” replacements.
