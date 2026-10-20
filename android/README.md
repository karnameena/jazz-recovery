# Jazz Recovery Android — recovery-readiness feature branch

This is an independent Android app (com.gunakarna.jazzrecovery). It does not modify the existing Android Companion source or its production workflow.

## Implemented on this branch
- HTTPS server URL configuration and GET /health test.
- Stable per-installation device ID.
- Generate/show/copy a device token; the token is encrypted locally with Android Keystore.
- Website registration can pair the device using the device ID and token.
- Owner-granted camera, location, and Bluetooth setup permissions.
- Explicit start/stop controls for a foreground recovery agent, with a visible ongoing notification.
- Polls existing authenticated device command endpoints and sends heartbeats.
- Best-effort Camera2 still capture for RECOVERY_PHOTO, cached location retrieval, device status, ring alert, recovery-mode state, and location status.
- Reports unsupported Location Services ON/OFF commands as failures instead of falsely claiming success.

## Enrollment flow
1. Install the app on the owner's phone and save the HTTPS server URL.
2. Generate/show the device token and copy the device ID and token.
3. Grant the required camera and location permissions; grant notifications on Android 13+.
4. Start Recovery Readiness while the app is visible. Keep the ongoing notification enabled.
5. On the website, choose Register and enter owner username/password, confirm password, device name, IMEI, device ID and token.
6. Use the website to issue recovery commands. The app contains setup/permission controls, not the remote recovery dashboard.

## Locked-screen camera limits
The service must be started by the owner while the app is visible, after granting camera permission. It uses a visible foreground-service notification and attempts Camera2 capture when a command arrives. Android version, OEM firmware, another app using the camera, battery restrictions, force-stop, reboot, permission changes, and background-camera policy can still prevent capture. Waking the display is not the same as unlocking the device. This branch does not bypass the secure lock screen and cannot guarantee locked-screen capture on every Android 10+ device. Validate on physical devices before relying on it.

## Build
Open android/ in Android Studio with JDK 17 and Android SDK 35 installed, sync Gradle, then run Build > Build APK(s). The project does not currently include a Gradle wrapper. No APK build or real-device integration test has been completed in this environment.

## Important backend note
The server repository has an existing opt-in Neon/PostgreSQL feature branch, but it is still a draft proposal and not the live production configuration. The enrollment server PR targets that PostgreSQL branch. Do not merge or deploy to production until both PRs are reviewed, the Render service is confirmed to run with JAZZ_DB_ENGINE=postgres and a private DATABASE_URL, and the end-to-end enrollment/command flow is tested.

## Existing workflows
All changes are on a feature branch and proposed through a draft pull request. Do not reuse Android Companion credentials. No existing main-branch code has been merged or deployed by this change.
