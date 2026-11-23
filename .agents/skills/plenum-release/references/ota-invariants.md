# OTA invariants (do not ship if broken)

Plenum heals itself only if an installed build can still **run**, **reach the feed**, **download a newer zip**, and **quitAndInstall**. Anything that breaks that loop leaves users stuck until they reinstall.

## The loop

```
installed app launches
  → updater enabled (not DISABLE_AUTO_UPDATE)
  → polls https://plenum.sh/updates/latest-mac.yml
  → sees newer version + sha512 + zip path
  → downloads Plenum-*-mac.zip (+ blockmap)
  → quitAndInstall (Developer ID + notarized)
  → new build launches (and can update again)
```

## Ways to kill OTA (non-exhaustive)

| Failure | Why users cannot self-heal |
| --- | --- |
| Main process crash on open (missing asar module, bad import) | Never reaches updater |
| Updater hard-disabled / wrong default feed / GitHub-only without token | Check never finds a public update |
| `electron-updater` missing from packaged deps | Check/download throws |
| Feed missing `latest-mac.yml`, zip, or blockmap | Clients cannot resolve/download |
| Feed version ≤ installed version | Clients ignore the “fix” |
| Unsigned / un-notarized zip | Squirrel.Mac install fails on macOS |
| Publish succeeds but FTP feed stale/wrong | Fleet stays on broken build |

Launch crash is only one class. Treat every release as **an OTA node**, not a one-shot installer.

## What we gate

- **Source:** public feed URL, `build.publish`, mac `zip` target, updater wired in `main`, disable only via env.
- **Packaged app:** launches; asar import graph complete; `updates.mjs` + `electron-updater` present; feed URL still baked in.
- **Artifacts (CI):** `latest-mac.yml` complete; zip + blockmap exist; version not older than the live feed before publish.
- **After publish:** live `latest-mac.yml` matches the tag.

Scripts: `ota-health-check.mjs`, `pack-imports-check.mjs`, `pack-launch-smoke.mjs`, orchestrated by `release-check.mjs`.
