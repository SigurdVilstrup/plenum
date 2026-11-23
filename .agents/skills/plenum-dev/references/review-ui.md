# UI plan / implementation review

You are reviewing Plenum UI work (plan or code). Be concrete; cite files or plan sections.

## Check

1. Fit with `docs/design.md` and the existing app chrome (board, graph, settings) — not a new visual system.
2. Hierarchy and density: one clear job per surface; no dashboard clutter on a focused flow.
3. AI-slop tells (run `avoid-ai-design` detect when code exists): purple/indigo defaults, Inter-everywhere, three-card heroes, cream+terracotta, acid-green-on-near-black, decorative 01/02/03.
4. Empty, loading, and error states look intentional.
5. Motion only if it clarifies hierarchy; respect reduced-motion.

## Output

- **Blockers** (must fix before implement / merge)
- **Suggestions**
- **Pass** — one line if clean

Do not rewrite the feature. Review only.
