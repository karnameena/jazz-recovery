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
- BeaconDB: public-domain wireless geolocation database and MLS/Ichnaea-compatible endpoint. Its published site says it is experimental and may be inaccurate/unreliable; it may fall back to approximate cell-tower data from the final MLS dump. Staging uses `fallbacks: { lacf: true, ipf: false } to reject IP-based estimates. This is the no-key/low-cost first attempt, not a guarantee of useful coverage in Chennai or any other area.
- Google Geolocation API: accepts real cell-tower measurements and returns coordinates plus an accuracy radius. It requires a configured API key and billing; current published pricing should be rechecked before production and quotas/budget alerts set. Staging reads only the server environment variable `JAZZ_GOOGLE_GEOLOCATION_API_KEY`; never put the key in Android or website code. Requests disable IP fallback and group cells by radio type.
- Privacy: only cell identity and signal measurements needed for coarse positioning are sent; no IMEI, phone number, account password, or Wi-Fi MAC addresses are included by this implementation. Provider disclosure, retention review, user consent, and real coverage tests remain release gates.

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
- Android debug build verification PASSED on 2026-10-28. GitHub Actions run `40685814181` completed successfully and uploaded `jazz-recovery-debug-apk`; this is a debug artifact, not a signed production release.
- Cellular positioning now has an initial staging implementation: Android collects supported GSM/WCDMA/LTE/NR cell identifiers and signal levels (never IMEI), and the PostgreSQL server tries BeaconDB with IP fallback disabled; if `JAZZ_GOOGLE_GEOLOCATION_API_KEY` is configured, it can try Google's Geolocation API by radio type. Provider results are validated and cached locations can be superseded only by a successful cell estimate. This is NOT yet end-to-end verified. BeaconDB states its service is experimental and may be inaccurate/unreliable; its cell fallback uses the final MLS data dump. Google requires a key and billing, so it remains opt-in via server environment configuration. Android `READ_PHONE_STATE` and location permissions may be needed, and denied/missing permissions must return unavailable rather than fabricate a location.
- BLE helper recovery is PARTIALLY implemented on the server staging branch: PostgreSQL tables support helper consent, target-owner authorization, hashed short-lived beacon tokens, latest-only reports, freshness checks, and token replay tracking; authenticated endpoints reject unauthorized helpers and label accepted reports as proximity estimates. Android advertising/scanning, rotating-token generation/registration, helper location capture, offline queue/retry, user-facing opt-in/authorization UI, and end-to-end BLE tests are NOT yet complete. Do not enable or represent BLE recovery as working until those client pieces are implemented and tested.
- Full end-to-end cellular and BLE implementation remains outstanding. Cellular requires a selected provider, secure server-side API-key configuration, runtime permission handling, and real cell-measurement tests. BLE requires an opt-in helper enrollment/advertising/scanning design, authenticated reports, anti-replay and deduplication, retention/privacy controls, offline queue/retry, and multi-device tests.
- Real-device testing, full regression testing, production hosting, separate Neon production provisioning, backup/restore rehearsal, signed release checks, and explicit release approval remain outstanding. These gates cannot honestly be marked complete from CI-only checks; do not cut over or distribute the debug APK as a production release.
