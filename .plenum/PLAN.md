# Feature plan: landing-polish

## Goal

Land the stacked-hero plenum.sh layout (shot under title, one-viewport fade, Why expand) and clear the review pass: fresh board shot, four equal USPs, mobile product image, tighter copy, mark/fade/CTA/a11y polish, and a quiet docs exit.

## User-visible behavior

- Happy path (desktop ≥960): copy + CTA; board shot under it fading into canvas; no page scroll. Why Plenum expands four USP columns between CTA and shot, unlocks scroll, lifts fade.
- Happy path (mobile): centered copy, Send download link, cropped board shot under CTA (no longer shot-less).
- Empty / first-run: n/a (static site).
- Errors: version feed still silent on failure; Windows SmartScreen note one quiet line under the button.
- Keyboard: Enter downloads (desktop); Escape closes platform menu and Why; split menu arrow/Home/End; lavender focus rings on primary buttons; brand is a home link.

## Scope

| In | Out |
| --- | --- |
| `site/index.html` layout, copy, a11y, motion | FAQ question phrasing (#8) |
| Fresh `site/board.jpg` from current app | Chasing avoid-ai purple scanner |
| Optional quiet Docs/README link | New marketing sections / footer redesign |

## Touch list

- `site/index.html` — composition, Why (4 USPs), mobile shot, mark field, fade, typing/CTA order, keyboard, focus, brand link, Windows note, docs link
- `site/board.jpg` — recapture
- `.plenum/PLAN.md` — this plan

## Risks

- Recapture needs a runnable Plenum + interesting board; fall back to best available smoke/demo repo.
- `:has(.panel.open)` scroll lock — modern browsers only; older browsers keep scroll (acceptable).
- DOM reorder of Why vs shot must match visual + SR.

## Verify

- [ ] Desktop closed: no scroll, soft bottom fade, CTA visible before typing finishes
- [ ] Why open: four equal columns, scroll unlocked, fade off, Escape closes
- [ ] Mobile width: shot visible under CTA
- [ ] Split menu keyboard + focus rings
- [ ] Visual pass screenshots shown to user
- [ ] `feature-check` / avoid-ai on site (ignore known brand purple if needed)

## Decisions (pinned)

- Four USPs (drop “More than one repo”); keep claim-style headings, not questions.
- Collapse gloss + sub into one supporting line where possible.
- CTA / foot visible immediately; type only the headline.
- Docs: GitHub README link next to GH icon (quiet).
