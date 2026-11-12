# Landing craft study (issue #34)

12 Nov 2026. Seven live pages, desktop 1440×900, first viewport only. Type, size and colour come from computed styles; the rest is what the screenshots show. I did not look at mobile, scroll behaviour or motion, and every capture is a still. Screenshots are in `assets/landing-study/`.

Scope: what to borrow for a **one-page download site**. Category and message stay in `landing-positioning.md`.

## What each page does

| Site | Hero | Type | CTA | Product shown | Takeaway |
| --- | --- | --- | --- | --- | --- |
| [Cursor](assets/landing-study/cursor.png) | One sentence, left-aligned: "Cursor is your coding agent for building ambitious software." | System-like grotesk, **26px regular**, warm off-white page (`#f7f7f4`) | **Download for macOS ↓** (dark pill) + "Request a demo" (grey) | Window-framed app UI on a painted backdrop, starts at ~y=350 | Small, calm headline. The screenshot does the selling. |
| [Linear](assets/landing-study/linear.png) | "The product development system for teams and agents" + one subline | Inter Variable, **64px / 510 weight / −1.4px tracking**, near-black `#08090a` | Small "Sign up" in the nav; no big hero button | Real UI, cropped so it runs off the bottom of the first screen | Heavy type, one subline, UI bleeding off the fold. |
| [Zed](assets/landing-study/zed.png) | "Your last next editor", centred | **Serif italic** display (Plex Serif, 48px, weight 340), mono body | **Download now** with a `D` key hint, plus "Clone source". Under it: "Available for macOS, Linux, and Windows" | Three one-line claims (Fast / Agentic / Collaborative), then the app | Keycap hints on buttons. Platform line under the CTA. Three-up claims straight under the hero. |
| [Ghostty](assets/landing-study/ghostty.png) | **The whole site is one screen** (page height = 900px). Window frame with the mark drawn in coloured ASCII, one sentence, two buttons | Mono art, plain sans for the sentence | **Download** / Documentation | The mark, in a window frame | The closest match to "very simple one-pager". Also the best model for the animated mark in #50. |
| [Raycast](assets/landing-study/raycast.png) | "Your shortcut to everything." centred | Inter 64px / 600, near-black `#07080a` | **Download for Mac**, then a mono line: "macOS Tahoe and Apple Silicon required" and "Install via Homebrew \| Download V1" | Big red generative gradient art behind the headline; UI comes later | States the hardware requirement right at the button. |
| [Xcode](assets/landing-study/apple-xcode.png) | App icon, name, one paragraph, centred | SF Pro 48px / 600, white | "Download" in a sub-nav, not in the hero | Laptop-framed screenshot | Icon above the name works when you have a good icon. |
| [OpenAI](assets/landing-study/openai.png) | An interactive prompt box ("What can I help with?") | Sans, white | "Try ChatGPT" in the nav | The product is the hero | Not transferable. Consumer, and the hero is the product. |

## What repeats

1. **Short, plain headline.** Seven to ten words, says what the thing is. No "reimagine" or "supercharge". Cursor, Linear, Raycast and Zed all do this.
2. **The Download button is visible without scrolling and says the platform** ("Download for macOS"). Raycast and Zed add a one-line requirement under it.
3. **A real screenshot within the first 1–1.5 screens**, in window chrome or bleeding off the fold. None use illustrations of the product.
4. **Almost no navigation.** Five or six items at most. Ghostty has none.
5. **One accent colour, one typeface.** Linear and Raycast use a single sans (Inter), Cursor a single grotesk. Only Zed gets away with a serif and mono mix, and it is the one that looks hand-made.
6. **Cookie banners cover the product shot** on Cursor, Zed and OpenAI. Plenum has no analytics, so it needs no banner.

## What to take for plenum.sh

- **Structure:** Ghostty's economy, Zed's three-up. Icon and wordmark, headline, one subline, **Download for macOS** button, a requirement line, framed `board-dark.png`, three one-line claims taken from the positioning doc, footer. Two to three screens, no nav.
- **Requirement line:** "macOS · Apple Silicon · v0.2.x". The release workflow builds arm64 only, so say it here (Raycast does the same).
- **Keycap hint on the button** (Zed's `D`). Plenum is keyboard-first (`⌘K`), so it fits the product.
- **Type:** the system font stack already in `DESIGN.md`. One weight for the headline, tight negative tracking, around 48–64px. No web font to load.
- **Motion (#50):** Ghostty's approach. The mark rendered in dots inside a window frame, with a static first paint and `prefers-reduced-motion` honoured. Only one thing on the page moves.

## What to leave out

- Generative gradient art behind the hero (Raycast). It's the "AI glow" that #50 rules out.
- An interactive hero (OpenAI) and logo or social-proof walls. There are no customers to show yet.
- Pricing, enterprise, or "contact sales" in the nav.
- Anything that makes the page look like Linear. `DESIGN.md` is near-black with a `#5e6ad2` accent, which is already very close to Linear's palette. A framed screenshot and a different headline treatment will separate them more than any colour change.

## Still open

- `landing-positioning.md` says #36 (the cold ICP test) must pass before any page is built. This study doesn't change that. If a plain download page ships before the test, the headline should be treated as provisional.
- Mobile layout and real motion weren't looked at. Both need a second pass once there is a draft to compare against.
