# Dogfood checklist (phase one)

Snapshot mode (minimal): set `services.<name>.mode: snapshot` and a `snapshot:` command (or `data.snapshot`); Run seeds before `run`. Full walk in Task 13.

Fixture:

```bash
npm run smoke:init
OVERLOOK_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Walk:

1. Window opens on `tmp/smoke-repo` with Protected + `feat/alpha` lane.
2. Select `feat/alpha`. Dirty WIP row shows above the tip. Authorship pill is Assisted / Cursor.
3. Commit → sheet → message → settle toast. Graph updates.
4. Push (force-with-lease). Toast ok.
5. ⌘K → New lane → feature `gamma` → create. Lane row animates in. Cursor may open.
6. Dirty gamma, commit, Push.
7. Advance main in Terminal (`echo x >> README.md && git commit -am move && git push`), focus Overlook → behind count updates after refresh.
8. Rebase on main. If conflict: Open → edit → Stage → Continue (multi-commit reopens sheet).
9. Merge into main (ff or merge commit). Primary may show ahead of origin; that is expected until you push main outside Overlook.
10. Safe lane → Remove lane sheet → folder gone, branch kept.
11. Tabs: open second repo, rename (dblclick), change icon, right-click Close Tab.
12. Primary: no Commit / Push / Rebase / Merge. Alert copy if dirty or off team branch.

Done when daily dogfood uses this loop without leaving Electron.
