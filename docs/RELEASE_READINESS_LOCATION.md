# Jazz Recovery Location and Production Release Plan

Status: staging work in progress. This document is a checklist, not evidence that any gate has passed.

## Non-negotiable safety boundaries
- Preserve all existing local working-tree changes and user-created backups.
- Keep implementation on isolated staging branches; do not merge, deploy, or switch production users without explicit approval.
- PostgreSQL/Neon only for persistent runtime data. Never silently fall back to SQLite.
- Do not run destructive tests or migrations against production.
- Location changes only until location acceptance tests pass. Do not change authentication, sessions, passkeys, registration, pairing/ownership, subscriptions/billing, photos, ring commands, global location toggle, navigation, layout, or unrelated APIs/schema.

## Location behavior acceptance criteria
1. GPS/GNSS fresh fix.
2. Android Fused Location Provider fresh fix.
3. Cellular positioning only when real cell measurements and a supported positioning service are available.
4. Nearby authorized Jazz Recovery BLE helper report; clearly label as helper/proximity estimate, never exact lost-phone location.
5. Last known valid location, labelled cached/old with source, timestamp, and age.
6. Explicit location unavailable when no valid result exists.

- Validate latitude/longitude ranges, timestamp, accuracy, and freshness.
- Bound provider/network timeouts; handle permission denial, location services off, missing Google Play services, offline device, and unsupported cell APIs.
- Never let a late, older result overwrite a newer valid result.
- `locate` / `locate all`: return fused and cellular results when genuinely available.
- `locate gps`, `locate fused`, `locate cell`, and `locate last` must each honor their defined meaning. `locate last` must not start a new provider lookup.
- Existing website Get Location button and UI remain unchanged and use the authenticated recovery-command flow.

## Test gates
- Unit tests for priority, timeout, validation, stale/cached labeling, late-result ordering, and unavailable states.
- Android device tests: permissions, GPS off, airplane/offline, background service, reboot, battery restrictions, missing Google Play services.
- Cell/BLE tests: unavailable cell data, no helper, unauthorized helper, replay, duplicate and delayed reports.
- End-to-end website/API/Android command tests, owner isolation, and device authorization.
- Regression tests for login, registration, sessions, passkeys, pairing, photos, ring, location toggle, subscriptions, and billing.
- PostgreSQL-only runtime verification, migrations on isolated staging, concurrency/load tests, backup and restore rehearsal.
- Clean website build, server test suite, Android release build, signed artifact checks, and real-device install/upgrade tests.

## Environment and release gates
- Local development: synthetic data.
- Neon staging project: `jazz-recovery-backend-test-20261023`, database `jazz_recovery_test`; never use this as production.
- Production: separate Neon project, credentials, deployment environment, and backup/restore policy.
- Configure hosted web/server HTTPS, DNS/TLS, CORS/cookies, health checks, logs, monitoring, rate limits, secret management, and rollback procedure.
- No production cutover until all required tests pass and the user explicitly approves release.

## Current staging implementation status (2026-10-28)
- Added bounded fresh GPS/GNSS and Android Fused Location Provider attempts, source labels, coordinate/timestamp/accuracy validation, and last-known fallback.
- Added explicit server command modes for GPS, fused, cellular, last-known, and all-provider requests.
- Added multi-provider result metadata to the device API response.
- Added server validation for coordinates/timestamps and a conditional update so an older location cannot overwrite a newer stored location.
- PostgreSQL migration verification and web/API compatibility checks have passed in GitHub Actions for the commits checked during this work.
- Android build is still being checked; do not distribute until the latest staging build succeeds.
- Cellular positioning is NOT implemented yet: the current Android code returns CELLULAR_POSITIONING_NOT_CONFIGURED. A production provider choice, privacy review, service configuration, and device-side cell-information mapping are still required.
- BLE helper recovery is NOT implemented yet: the current Android code returns BLE_HELPER NOT_CONFIGURED. It needs an enrolled helper protocol, authenticated/replay-resistant reports, opt-in/privacy controls, offline queueing, and end-to-end tests.
- Real-device testing, full regression testing, production hosting, Neon production provisioning, backup/restore rehearsal, and release approval remain outstanding.
