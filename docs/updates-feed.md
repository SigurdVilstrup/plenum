# Public update feed (plenum.sh)

Anyone should be able to update Plenum without a GitHub account. The desktop app
reads a **generic** electron-updater feed:

**Base URL:** `https://plenum.sh/updates/`

## Release automation

On each `v*` tag, [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Builds Mac `.dmg` + updater `.zip` / `.blockmap` + `latest-mac.yml`
2. Publishes a GitHub Release (archive / notes)
3. FTPs the public feed into `FTP_UPDATES_DIR` on your host

### GitHub Actions secrets

| Secret | Example | Notes |
| --- | --- | --- |
| `FTP_SERVER` | `ftp.example.com` | Host only |
| `FTP_USERNAME` | `…` | |
| `FTP_PASSWORD` | `…` | |
| `FTP_UPDATES_DIR` | `public_html/updates/` | Remote folder served as `https://plenum.sh/updates/` (trailing slash) |

Add them under **Repo → Settings → Secrets and variables → Actions**.

### Files landed on the server

| File | Role |
| --- | --- |
| `latest-mac.yml` | Manifest electron-updater reads |
| `Plenum-*-mac.zip` (+ `*.blockmap`) | In-app update payload |
| `Plenum.dmg` | Stable first-install link for the landing page |
| `Plenum-<ver>*.dmg` | Versioned DMG copy |

## Landing page vs updates

- **plenum.sh/** — marketing + “Download” → `https://plenum.sh/updates/Plenum.dmg`
- **plenum.sh/updates/** — feed the app polls (`latest-mac.yml` + zip)

## App config

Default in `electron/updates.mjs`:

```js
{ provider: 'generic', url: 'https://plenum.sh/updates/' }
```

`package.json` → `build.publish` uses the same generic URL so `latest-mac.yml` paths resolve correctly.

Override with `PLENUM_UPDATE_FEED_URL` if needed.
