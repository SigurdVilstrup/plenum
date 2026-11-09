# GitKraken study notes — left rail & fold-outs

Written 9 November 2026 while shipping #7 / #8.

## What GitKraken does well

1. **Rail width** stays wide enough for branch names + short meta without horizontal clip.
2. **Detail panes** (commit / file / diff) overlay or dock without resizing the graph column — the graph’s scroll position and column geometry stay put.
3. **Row packing** uses calm vertical rhythm; marks are small but hit targets are comfortable.

## What we adopted in Plenum

- `--rail-w: 300px` (was 260).
- Changes / file pane opens as a **right overlay** instead of inserting a third grid track (no graph “lurch”).
- Slightly taller lane rows and clearer section padding.

## Deliberate differences

- Lanes remain first-class in the rail (Overlook mission); GitKraken’s branch list is flatter.
- Protected / team branch stay visually distinct.

## Follow-ups

- Resizable rail (drag handle) if Mobaro-scale names still clip.
- Optional graph dim behind the overlay for stronger focus.
