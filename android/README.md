# Jazz Recovery Android — initial scaffold (NOT a release)

This directory is a new independent Android app. Existing React/Vite Lost Mode website files in this repository are unchanged. Existing Android Companion and Lost Mode backend repositories are unchanged.

## Current features
- Independent application ID `com.gunakarna.jazzrecovery`, version 1.0.0.
- HTTPS server URL save and public `GET /health` test.
- Unique local installation/device ID.
- Manually provisioned device credential, encrypted using Android Keystore.
- Authenticated `POST /android/device/heartbeat`.
- Device model and Android version.
- Location permission request, Android Location Settings shortcut, cached location display.

## Pairing to the existing server
The existing server has **no public device-registration endpoint**. From the separate `jazz-recovery-server` repository run `node src/scripts/create-device.mjs`. Enter your owner username and paste the app's installation ID at the Device ID prompt. Enter a distinct device name. The script shows a credential once; paste it into the new app. Do not reuse Android Companion's ID or token.

## Build
Open `android/` in Android Studio, install Android SDK 35 and JDK 17, sync Gradle, then Build > Build APK(s). Android Gradle Plugin 8.7.3 and Kotlin plugin 2.0.21 are declared. No Gradle wrapper has been committed and no APK has been compiled or tested in this environment.

## Not implemented / not verified
The screenshot supplied in this conversation shows a browser Lost Mode page, **not** the required dark-navy cyan location-pin launcher icon. No substitute icon was created. The app is a scaffold, not the full requested release. Remote command polling/execution, ring, Lost Mode, camera, upload, fresh location, history, foreground service, and adaptive icon are pending. No device install or backend integration test has been run.

## Backward compatibility
No existing source files were edited. Backend provisioning creates a new device record and must be performed by the authorized server operator. Never copy existing Companion credentials.
