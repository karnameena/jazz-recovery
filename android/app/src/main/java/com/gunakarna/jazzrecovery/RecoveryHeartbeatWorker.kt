package com.gunakarna.jazzrecovery

import android.content.Context
import android.os.BatteryManager
import android.util.Base64
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Best-effort periodic heartbeat fallback. The foreground recovery agent remains
 * the fast path; WorkManager provides a network-constrained check after process
 * death/reboot when Android schedules background work. Android does not promise
 * exact timing for periodic work.
 */
class RecoveryHeartbeatWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {
    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("jazz_recovery_standalone", Context.MODE_PRIVATE)
        val base = (prefs.getString("server", "") ?: "").trim().trimEnd('/')
        val deviceId = prefs.getString("device_id", "") ?: ""
        val encryptedToken = prefs.getString("secret", "") ?: ""

        // Configuration can be completed later; the next periodic run will check again.
        if (!base.startsWith("https://") || deviceId.isBlank() || encryptedToken.isBlank()) return Result.success()

        val token = runCatching { decrypt(encryptedToken) }.getOrElse { return Result.failure() }
        if (token.length < 32) return Result.failure()

        return try {
            val battery = applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val payload = JSONObject()
                .put("deviceId", deviceId)
                .put("deviceName", android.os.Build.MODEL)
                .put("mode", if (prefs.getBoolean("lost_mode", false)) "LOST_MODE" else "NORMAL_MODE")
                .put("status", JSONObject()
                    .put("online", true)
                    .put("battery", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                    .put("charging", battery.isCharging)
                    .put("network", "CONNECTED")
                    .put("source", "workmanager_fallback"))

            val connection = (URL("$base/android/device/heartbeat").openConnection() as HttpURLConnection)
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 5000
                connection.readTimeout = 8000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                val code = connection.responseCode
                when {
                    code in 200..299 -> Result.success()
                    code == 408 || code == 429 || code >= 500 -> Result.retry()
                    else -> Result.failure()
                }
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > 12) { "Invalid encrypted token" }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey("jazz_recovery_key_v1", null) as? SecretKey
            ?: error("Recovery key unavailable")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}
