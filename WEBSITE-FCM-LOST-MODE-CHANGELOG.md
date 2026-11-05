# Jazz Recovery Website — FCM / Lost Mode branch

- Branch created: `feature/fcm-lost-mode-cloudflare-workers-20261105-0000`
- Created: 2026-11-05 00:00 Asia/Kolkata (timestamp encoded in branch name; rounded branch label)
- Source package: `JazzRecovery-FCM-LostMode-Final-Source-04-1-26-19-26-PM.zip`
- Baseline: existing `main`; this branch adds the website project from the supplied ZIP under `website/`.

## What is added in this branch

- React/Vite website project, source components, styles, package manifests and lockfile.
- Cloudflare Pages Functions API proxy at `website/functions/api/[[path]].js`.
- Same-origin browser API helper with JSON/error handling and Pages-to-Worker proxy expectations.
- Dashboard recovery action UI, including the Enable Lost Mode action mapped to `SET_RECOVERY_MODE` with `enabled: true`.
- Recovery cache / UI support and the supplied workflow documentation and public assets.

## Relationship to FCM / Lost Mode

The website UI submits allowlisted recovery actions through its API service. The Worker is responsible for authenticating, queuing the Android command, and optionally sending an FCM wake-up hint. The Android application must then fetch and acknowledge the command. A UI click alone is not proof that the phone received or applied Lost Mode.

## Verification / limitations

The supplied package documents local proxy tests and a Vite build command. Its handoff notes state that real Google OAuth/FCM delivery, live Worker deployment, remote D1 migration, and end-to-end physical-device Lost Mode confirmation were not verified. No live deployment or remote database change was done in this Git update.

## Safety / configuration

Do not commit Firebase service-account JSON, private keys, keystores, or live tokens. Configure secrets outside Git. Keep user-facing photo/location flows and their cache behavior unchanged unless a separately reviewed change explicitly requires it.

## Previous vs current

Previous tracked repo contained the earlier partial frontend snapshot. This branch preserves that base and adds the website project from the supplied ZIP in a separate `website/` directory; it does not overwrite existing root files.
