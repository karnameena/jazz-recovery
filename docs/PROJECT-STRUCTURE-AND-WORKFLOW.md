# Jazz Recovery Website — Folder Structure and Workflow

This document describes the current website source only. The Node.js server and Android application are separate projects.

## 1. Architecture in plain language

- **React website (`src/`)**: screens, forms, dashboard components and browser interactions.
- **API service (`src/services/api.ts`)**: sends authenticated HTTP requests to the server.
- **Node.js server (separate project)**: validates sessions and permissions, processes commands and reads/writes PostgreSQL.
- **PostgreSQL (server-side)**: persistent accounts, devices, recovery records and billing data.
- **Android companion (separate project)**: receives authorized device commands and reports device results.

The browser must never connect directly to PostgreSQL. It calls the API; the server performs authorization and database operations.

## 2. Website source tree

```text
website/
├── index.html                       # Browser HTML entry point
├── package.json                     # Dependencies and npm scripts
├── package-lock.json                # Reproducible dependency versions
├── vite.config.ts                   # Vite and local /api proxy configuration
├── README.md                        # Setup and development notes
├── docs/
│   ├── WORKFLOW-OVERVIEW.md         # Billing and access rules
│   └── PROJECT-STRUCTURE-AND-WORKFLOW.md
└── src/
    ├── main.tsx                     # Mounts React into #root
    ├── App.tsx                      # Authenticated app state and page orchestration
    ├── styles.css                   # Main visual styles
    ├── responsive-fixes.css         # Responsive layout adjustments
    ├── vite-env.d.ts                # Vite and static asset type declarations
    ├── Logo-jazz.webp               # Optimized local brand image
    ├── components/
    │   ├── auth/
    │   │   └── Login.tsx            # Login, registration and password recovery UI
    │   ├── billing/
    │   │   ├── BillingPage.tsx      # Customer billing and admin billing UI
    │   │   └── billing.css          # Billing-specific styles
    │   └── dashboard/
    │       ├── DashboardHeader.tsx  # Dashboard header and account actions
    │       ├── DeviceSidebar.tsx    # Registered device list and selection
    │       ├── DeviceHero.tsx       # Selected device summary
    │       ├── RecoveryActionGrid.tsx # Device recovery command buttons
    │       ├── GetIMEI.tsx          # Explicit, on-demand IMEI reveal/copy UI
    │       ├── LocationServicesCard.tsx # Location-services state and controls
    │       ├── LocationCard.tsx     # Last-known location and map
    │       └── RecoveryPhotoCard.tsx # Latest recovery photo
    ├── services/
    │   ├── api.ts                   # Shared authenticated HTTP client
    │   └── passkeys.ts              # Browser WebAuthn byte/credential serialization
    └── types/
        └── device.ts                # Shared TypeScript device/location/photo shapes
```

## 3. Startup flow

1. `index.html` provides the root element.
2. `src/main.tsx` imports the global styles and mounts `<App />`.
3. `App.tsx` checks `/api/auth/session`.
4. When authenticated, it obtains billing access from `/api/billing/status`.
5. It loads `/api/devices`, selects an authorized device and fetches its detail.
6. Dashboard components render the data passed by `App.tsx`.
7. User interactions call `api.ts`; the server authorizes and processes them.
8. Device results are refreshed from the server. A queued command is not presented as completed until the server/device confirms the relevant result.

## 4. Component responsibilities

- `Login.tsx`: collects credentials and registration/recovery information. The server remains authoritative for authentication.
- `DashboardHeader.tsx`: refresh, passkey registration, Recovery PIN setup, billing-admin navigation and logout.
- `DeviceSidebar.tsx`: shows only the current user's device list and selects a device.
- `DeviceHero.tsx`: presents device name/identifier, online state, battery, network and last-seen details.
- `RecoveryActionGrid.tsx`: presents the existing allowlisted recovery actions and the Get IMEI control.
- `GetIMEI.tsx`: fetches IMEI only after the user explicitly requests it, displays it temporarily and supports copying.
- `LocationServicesCard.tsx`: requests location-services changes and displays device-confirmed status.
- `LocationCard.tsx`: shows the last-known location and its timestamp; it must not imply cached data is live.
- `RecoveryPhotoCard.tsx`: displays the latest available recovery photo.
- `BillingPage.tsx`: customer plan/checkout UI and administrator billing tools.

## 5. Important state and safety rules

- `App.tsx` clears account-specific state when the session changes and uses request epochs to prevent older in-flight responses from repopulating a new account's UI.
- Device polling remains at its existing cadence. This cleanup does not change the recovery protocol or command allowlist.
- IMEI is not rendered in the fleet list or device summary. It is requested through the dedicated authenticated endpoint only after Get IMEI is clicked. The server must independently verify ownership.
- Location timestamps and server-provided state are displayed as reported. A last-known location is not proof of current location.
- Command submission is not command completion. Only a confirmed device/server result should be described as completed.
- Billing access comes from the server. The browser does not grant subscriptions or determine payment success.
- The browser communicates with the API; it does not connect directly to PostgreSQL.

## 6. Local development

Requirements: Node.js 22+ and npm.

1. Start the Node.js server in its own terminal with its PostgreSQL environment configured.
2. In this website directory run `npm ci`.
3. If the backend is not at `http://127.0.0.1:8891`, set `LOST_MODE_API_URL` in a local `.env.local` file to the backend URL. Do not commit secrets.
4. Run `npm run dev`.
5. Open `http://localhost:5190`.

For a hosted build, set `VITE_API_BASE_URL` to the public HTTPS backend origin before running `npm run build`.

## 7. Files intentionally removed as unused

The old `src/voice/` directory (`VoiceInput.tsx`, `recording.ts`, and `voice-input.css`) had no imports from the active application. The Voice Input UI had already been removed from the dashboard, so these orphaned files were removed.

The unused `src/logo.jpeg` was removed. The active brand logo is now a locally imported optimized WebP asset rather than a GitHub raw-content URL, avoiding a runtime dependency on a branch URL and reducing the logo asset from about 1.49 MB to about 86 KB.

Generated `dist/`, installed `node_modules/`, local `.env` files and the generated npm audit report are not source deliverables and are excluded from the cleaned ZIP.
