# Jazz Recovery — Lost Mode Website

This repository is the **standalone React/Vite web dashboard** for Jazz Lost Mode. It was cross-checked against the latest `apps/lost-mode-web` directory in `karnameena/Jazz-AI-Assistant` (branch `feature/jazz-launcher-icon-repair-20261012`): the complete existing website source matches, including the device map, ring, photo, voice, recovery workflow, and owner-gated Location Services ON/OFF controls.

The **server is not deployed from this repository**. Its separate GitHub repository is [jazz-recovery-server](https://github.com/karnameena/jazz-recovery-server), production deployment branch `render-backend`. A PostgreSQL adaptation is currently being developed on `feature/neon-postgres-migration-20261012` (draft PR #1) and has **not** been deployed.

## Repository structure

```text
jazz-recovery/
├── index.html
├── package.json
├── vite.config.ts
├── .env.example
├── .gitignore
├── render.yaml
├── src/
│   ├── main.tsx
│   ├── styles.css
│   ├── responsive-fixes.css
│   └── voice/
│       ├── VoiceInput.tsx
│       ├── recording.ts
│       └── voice-input.css
└── .github/workflows/render-web-checks.yml
```

No backend code, database, owner passwords, device tokens, local Whisper/Piper assets, or Android APKs belong in this repo.

## Render deployment — Static Site

Use **New → Static Site** in Render, choose your GitHub repository `karnameena/jazz-recovery` and branch `render-web`, with:

| Setting | Value |
|---|---|
| Service type | Static Site |
| Root directory | blank (the frontend is at repository root) |
| Build command | `npm install --no-audit --no-fund && npm run build` |
| Publish directory | `dist` |
| NODE_VERSION | `24` |
| VITE_API_BASE_URL | **blank** (recommended same-origin proxy setup) |

Alternatively create the site from `render.yaml` using Render Blueprints. You only need one Static Site: don't create duplicate services if you already set one up manually.

**Critical: configure API rewrite after provisioning the backend.** In the Render **Static Site** dashboard, select **Redirects/Rewrites** and add a **Rewrite** rule:

```text
Source: /api/*
Destination: https://YOUR-ACTUAL-RECOVERY-BACKEND.onrender.com/api/*
Action: Rewrite
```

Replace the example backend URL with your real Render **Web Service** HTTPS URL (the server repo's deployment), not this frontend website URL. This ensures website JavaScript calls the **same-origin** `/api` while Render proxies requests to your authenticated backend. It avoids cross-site cookie problems. Put this /api rule **before any** `/* → /index.html` SPA fallback. Never redirect your login requests; use Rewrite.

For the backend, ensure `LOST_MODE_PUBLIC_ORIGINS` contains your exact HTTPS website origin, and configure cookies correctly for HTTPS. Sign in to the website only after the backend owns the correct user/device database.

### Missing username or invalid password?

The frontend does not contain accounts and it cannot reset credentials. Accounts and enrolled devices reside exclusively in the **backend database**, never in this React website. The existing backend uses SQLite, while the PostgreSQL feature branch is intended for Render Free + a private persistent Neon PostgreSQL database. If the backend runs with an empty database, correct old credentials still return `Invalid username or password` (HTTP 401). Do not create a second owner account or reset a user's password to work around that: perform a verified, private migration from the authoritative SQLite backup to PostgreSQL and confirm the device credential hashes are preserved. Do not upload either database or the Neon connection URL to GitHub, the frontend, or Render Static Site environment variables.

The previous `jazz-recovery-server` repository's public Git history contained committed SQLite databases. Removing them from the latest branch does not erase historic exposure: make that repository private, clean up its history and rotate affected credentials before activating public lost-device recovery.

### Render Free + Neon PostgreSQL — frontend compatibility

**No frontend API code changes are necessary.** This browser app calls the same authenticated routes and uses the same JSON contracts with the SQLite backend and the proposed PostgreSQL backend:

| Website request | Backend behavior |
|---|---|
| `POST /api/auth/login` | Owner login and HttpOnly session cookie |
| `GET /api/auth/session` | Verify current browser session |
| `GET /api/devices` | List only the signed-in owner's devices |
| `GET /api/devices/:id` | Return state and recovery data |
| `POST /api/devices/:id/actions` | Queue allowed recovery commands |
| `GET /api/devices/:id/commands/:uuid` | Return confirmed/failed Location Services command status |
| `POST /api/auth/logout` | Log out and clear the browser session |

- The browser NEVER connects to Neon. Only the private backend has `DATABASE_URL`. Don't place it in `VITE_API_BASE_URL`.
- For same-origin session cookies, leave `VITE_API_BASE_URL` blank and configure the existing Render Static Site `/api/*` rewrite to the **actual deployed backend** HTTPS URL. Set the backend's `LOST_MODE_PUBLIC_ORIGINS` to the website's exact HTTPS origin.
- This staging documentation branch does not alter `render-web` or production deployments. Switching the backend to the PostgreSQL feature branch must wait for a separate explicit approval and real account migration.
- Render Free may sleep when idle; website requests can be delayed on cold starts. A successful static build does not verify live server availability.

### Verify

- Open your deployed website origin in an incognito tab.
- In browser developer tools → Network, sign in and confirm `/api/auth/login` is requested at the **website** origin.
- `GET /api/auth/session` should succeed after login.
- Registered devices should appear from the authoritative backend, not a new empty server.
- The device's Companion must point to the **backend** HTTPS URL, not the static website.
- Location Services ON/OFF additionally require explicit local device opt-in and provisioned Android Enterprise device-owner rights. The website alone cannot bypass Android permissions.

## Local testing

```powershell
npm install
$env:LOST_MODE_API_URL = "http://127.0.0.1:8890"
$env:VITE_API_BASE_URL = ""
npm run dev
```

Open `http://localhost:5190`. Vite dev proxy maps `/api` to `http://127.0.0.1:8890` by default, or the above custom `LOST_MODE_API_URL`. Start the separately authenticated backend first. For production static builds, `LOST_MODE_API_URL` alone is **not** embedded into browser code; you must use the Render Rewrite or a deliberate `VITE_API_BASE_URL` build-time origin.

```powershell
npm run build
```

Deploys automatically when this repository's `render-web` branch updates, if your Render Static Site is connected to it.

## Source integration and rollback

The existing web source was already identical to the latest monorepo web source at the time of setup, modulo newline encoding. This deployment branch only adds Render configuration, documentation, CI and ignore rules. Existing website behavior and recovered phone workflows are unchanged. The prior `main` branch and the main Jazz project are untouched. This Neon staging documentation update is isolated on its own feature branch and does not alter the existing website behavior.


## Local development (website + PostgreSQL API)

The local one-command launcher is available on this branch; its paired API branch is `feature/per-user-trial-subscription-ledger-latest-20261025` in [jazz-recovery-server](https://github.com/karnameena/jazz-recovery-server).

1. Keep the website checkout and the `jazz-recovery-server` checkout in sibling folders.
2. Switch the API checkout to the paired branch above and pull it. The website branch is already this feature branch.
3. Run `scripts/start-local.ps1` from the website checkout. On first run it creates the API's `.env` from `.env.local.example` and stops so you can configure it. On later runs it starts the API in a separate PowerShell window and the website at `http://localhost:5190`.
4. The API requires Node.js 22.5+ and `JAZZ_DB_ENGINE=postgres` with `DATABASE_URL` set. Use an isolated Neon branch/database for local development; never use the live production database for local development or tests.

The launcher refuses to run if either checkout is on the wrong branch. It does not switch branches, reset files, run tests against Neon, or modify/delete existing project data.
