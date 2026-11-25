# Public update feed (plenum.sh)

Anyone should be able to update Plenum without a GitHub account. The desktop app
reads a **generic** electron-updater feed:

**Base URL:** `https://plenum.sh/updates/`

## Release automation

On each `v*` tag, [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. **Mac** (`macos-latest`): signed + notarized `.dmg` + updater `.zip` / `.blockmap` + `latest-mac.yml`
2. **Windows** (`windows-latest`): **unsigned** NSIS installer + `latest.yml` (+ blockmaps)
3. OTA survival smoke on each runner — packaged launch, updater in asar, platform feed + payload + blockmap — fails the job before publish if self-heal would break
4. A **publish** job collects both artifact sets, creates the GitHub Release, and FTPs the public feed into `FTP_UPDATES_DIR`

Local preflight (required before tagging): `npm run release:check` — see [`.agents/skills/plenum-release/SKILL.md`](../.agents/skills/plenum-release/SKILL.md). The point is not “asar looks fine”; it is **never ship a build that cannot update itself**.

### GitHub Actions secrets

| Secret | Example | Notes |
| --- | --- | --- |
| `FTP_SERVER` | `ftp.example.com` | Host only |
| `FTP_USERNAME` | `…` | |
| `FTP_PASSWORD` | `…` | |
| `FTP_UPDATES_DIR` | `public_html/updates/` | Remote folder served as `https://plenum.sh/updates/` (trailing slash) |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Mac Developer ID | Mac job only |
| `APPLE_API_*` / `APPLE_TEAM_ID` | Notarization | Mac job only |

Windows is intentionally **unsigned** (no SmartScreen cert). Add signing later without changing the feed layout.

Add secrets under **Repo → Settings → Secrets and variables → Actions**.

### Files landed on the server

| File | Role |
| --- | --- |
| `latest-mac.yml` | Mac manifest electron-updater reads |
| `Plenum-*-mac.zip` (+ `*.blockmap`) | Mac in-app update payload |
| `Plenum.dmg` | Stable first-install link for the landing page |
| `Plenum-<ver>*.dmg` | Versioned DMG copy |
| `latest.yml` | Windows manifest electron-updater reads |
| `Plenum-Setup-*.exe` (+ `*.blockmap`) | Windows NSIS update / install payload |
| `Plenum-Setup.exe` | Stable first-install link for the landing page |

## Landing page vs updates

The landing page is `site/index.html`. [`.github/workflows/site.yml`](../.github/workflows/site.yml) FTPs `site/` to the web root whenever `site/**` changes on `main`. It needs one more secret, `FTP_SITE_DIR` (e.g. `public_html/`, the parent of `updates/`, trailing slash). It only syncs files it uploaded, so `updates/` is never touched.

- **plenum.sh/** — marketing + OS-aware Download → `Plenum.dmg` or `Plenum-Setup.exe`
- **plenum.sh/updates/** — feeds the app polls (`latest-mac.yml` / `latest.yml` + payloads)

## App config

Default in `electron/updates.mjs`:

```js
{ provider: 'generic', url: 'https://plenum.sh/updates/' }
```

`package.json` → `build.publish` uses the same generic URL so feed paths resolve correctly on both platforms.

Override with `PLENUM_UPDATE_FEED_URL` if needed.
