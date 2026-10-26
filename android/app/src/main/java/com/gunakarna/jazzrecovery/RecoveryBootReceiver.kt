package com.gunakarna.jazzrecovery

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

/**
 * Restarts the owner's opted-in recovery agent after boot when required
 * permissions and saved server/device credentials are available. Camera consent
 * is retained and camera commands are attempted after restart, but Android may
 * still reject background camera access; command results must report that failure.
 */
class RecoveryBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences("jazz_recovery_standalone", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("auto_start", false)) return

        val server = (prefs.getString("server", "") ?: "").trimEnd('/')
        val deviceId = prefs.getString("device_id", "") ?: ""
        val encryptedSecret = prefs.getString("secret", "") ?: ""
        if (!server.startsWith("https://") || deviceId.isBlank() || encryptedSecret.isBlank()) {
            Log.w("JazzRecoveryBoot", "Automatic start skipped: setup is incomplete")
            return
        }

        if (Build.VERSION.SDK_INT >= 29) {
            val backgroundLocationGranted = context.checkSelfPermission(
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            if (!backgroundLocationGranted) {
                Log.w("JazzRecoveryBoot", "Automatic location start skipped: Allow all the time permission is required")
                return
            }
        }

        try {
            val serviceIntent = Intent(context, RecoveryAgentService::class.java)
                .putExtra("boot_start", true)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(serviceIntent)
            else context.startService(serviceIntent)
        } catch (failure: Exception) {
            Log.e("JazzRecoveryBoot", "Automatic recovery start failed: " + failure.javaClass.simpleName)
        }
    }
}
