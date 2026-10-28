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


## Cellular provider comparison and staging choice
- BeaconDB: open-data/public-domain wireless geolocation database with an MLS/Ichnaea-compatible endpoint. Its published site says it is experimental and may be inaccurate/unreliable; current coverage and result quality in Chennai are not verified. Staging uses only `https://api.beacondb.net/v1/geolocate` for cell-tower lookup with IP fallback disabled. The hosted endpoint is donation-supported and currently documented as freely usable, but has no project-controlled uptime or coverage guarantee. A future fully self-hosted deployment depends on available data dumps; BeaconDB currently says public dumps are not available.
- Google Geolocation API: technically supports cell tower measurements, but requires a Google API key and enabled billing. It is excluded from Jazz Recovery implementation because the project requirement is fully open-source and zero-cost. No Google Geolocation API key or paid-provider fallback is used by the current staging implementation.
- Privacy: only cell identity and signal measurements needed for coarse positioning are sent; no IMEI, phone number, account password, or Wi-Fi MAC addresses are included by this implementation. Requests go to the public BeaconDB service, so cellular positioning should be explicitly explained to users and only run as part of a user-requested location lookup. Provider disclosure, retention review, user consent, and real coverage tests remain release gates.

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
- PostgreSQL migration verification passed on latest server commit `269ce77362a6dcb3402dca47fda648dde7473596` (run `40690483074`). Web/API compatibility passed on the latest Android commit. The PostgreSQL integration test also passed the new helper opt-in, authorization, token registration, report, replay rejection, and owner-visible proximity result checks (run `40690399142`).
- Latest Android debug build PASSED on commit `2db0343a679ee417443052724c86abcbfb1546fe` (GitHub Actions run `40690250425`); artifact `jazz-recovery-debug-apk` was uploaded successfully. This is a debug APK, not a signed production release.
- Cellular positioning has an initial open-data-only staging implementation: Android collects supported GSM/WCDMA/LTE/NR cell identifiers and signal levels (never IMEI), and the PostgreSQL server queries BeaconDB with IP fallback disabled. No Google API, paid provider, API key, or billing-dependent fallback is used. Provider results are validated and cached locations can be superseded only by a successful cell estimate. This is NOT yet end-to-end verified. BeaconDB is experimental and may be inaccurate/unreliable; its cell fallback uses the final MLS data dump. Android `READ_PHONE_STATE` and location permissions may be needed, and denied/missing permissions must return unavailable rather than fabricate a location.
- BLE helper recovery now has a staging implementation across server and Android code: opt-in/helper authorization controls, short-lived random beacon tokens stored as hashes, BLE advertising/scanning, fresh helper-location capture, authenticated report submission, freshness checks, latest-only reports, token replay tracking, bounded offline queue/retry, and a website result entry labelled as a proximity estimate. Target-coordinate accuracy is deliberately not claimed. This is NOT yet verified end-to-end on real phones; Android/OEM background behavior, Bluetooth permission denial, offline queue expiry, concurrent/replayed reports, and the owner/helper two-device flow still require device tests.
- Cellular end-to-end tests remain outstanding, including real SIM/device checks, BeaconDB coverage, permission-denied paths, accuracy/freshness and provider timeouts. The BLE server integration test passed in PostgreSQL CI, but real two-phone Android testing and background behavior remain outstanding as listed above.
- Real-device testing, full regression testing, production hosting, separate Neon production provisioning, backup/restore rehearsal, signed release checks, and explicit release approval remain outstanding. These gates cannot honestly be marked complete from CI-only checks; do not cut over or distribute the debug APK as a production release.
