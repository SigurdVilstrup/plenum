# Security

## Reporting a vulnerability

Email the maintainer via the address on the [GitHub profile](https://github.com/SigurdVilstrup), or open a **private** GitHub security advisory on [SigurdVilstrup/plenum](https://github.com/SigurdVilstrup/plenum/security/advisories/new).

Please do **not** file ordinary public issues for undisclosed vulnerabilities, and do not put secrets, tokens, or private keys in issues or pull requests.

## What this project is

Plenum is a local Mac desktop app. It runs git and lane processes on your machine. Packaged builds pull updates from the public feed at `https://plenum.sh/updates/`.

## Feedback relay

When the GitHub CLI (`gh`) is available, in-app feedback creates the public issue as that signed-in user and does not use the relay. Otherwise it posts to a public Supabase Edge Function (see `.env.example`). That endpoint is intentionally reachable without a user JWT; treat anything you type in feedback as potentially visible to maintainers via GitHub issues. Do not paste credentials or private keys into feedback.

## Local secrets

- Copy `.env.example` to `.env` for local overrides. `.env` is gitignored.
- Never commit signing certificates, FTP credentials, or API keys. CI uses GitHub Actions secrets (see [`docs/updates-feed.md`](docs/updates-feed.md)).
