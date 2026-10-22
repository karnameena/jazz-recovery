package com.gunakarna.jazzrecovery

import android.app.Activity
import android.os.Bundle
import android.os.Build
import android.os.BatteryManager
import android.graphics.Color
import android.view.ViewGroup
import android.widget.*
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.Manifest
import android.content.pm.PackageManager
import android.location.LocationManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("jazz_recovery_standalone", Context.MODE_PRIVATE) }
    private lateinit var status: TextView
    private lateinit var server: EditText
    private lateinit var credential: EditText
    private var deviceId: String = ""
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceId = prefs.getString("device_id", null) ?: ("jazz-recovery-" + UUID.randomUUID()).also {
            prefs.edit().putString("device_id", it).apply()
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 30, 28, 30)
            setBackgroundColor(Color.rgb(7, 13, 31))
        }
        setContentView(ScrollView(this).apply { addView(root) })
        fun label(value: String) { root.addView(TextView(this).apply {
            text = value; textSize = 17f; setTextColor(Color.WHITE); setPadding(0, 12, 0, 12)
        }) }
        fun field(hintText: String, initial: String): EditText = EditText(this).also {
            it.hint = hintText; it.setText(initial); it.setTextColor(Color.WHITE)
            it.setHintTextColor(Color.LTGRAY); it.setSingleLine(true)
            root.addView(it, ViewGroup.LayoutParams(-1, -2))
        }
        fun action(name: String, run: () -> Unit) { root.addView(Button(this).apply {
            text = name; setOnClickListener { run() }
        }) }
        label("JAZZ RECOVERY · v1.0.0")
        label("Independent device ID: $deviceId")
        label("Server setup")
        server = field("https://server.example.com", prefs.getString("server", "") ?: "")
        action("Save HTTPS URL") {
            val value = server.text.toString().trim().trimEnd('/')
            if (!value.startsWith("https://") || runCatching { URL(value).host.isBlank() }.getOrDefault(true))
                show("Enter a valid HTTPS server URL")
            else { prefs.edit().putString("server", value).apply(); show("Server URL saved") }
        }
        action("Test /health") { request("GET", "/health", null, false) }
        label("Re-pair after reinstall")
        label("Use the same account username, account password and the EXISTING device ID from your original pairing. Jazz will securely replace the lost device token without deleting the device history.")
        val repairUsername = field("Existing account username", "")
        val repairPassword = field("Existing account password", "")
        repairPassword.inputType = 129
        val repairDeviceId = field("Existing device ID from original pairing", "")
        action("Re-pair existing account/device") {
            repairExistingDevice(
                repairUsername.text.toString().trim(),
                repairPassword.text.toString(),
                repairDeviceId.text.toString().trim()
            ) {
                repairUsername.text.clear()
                repairPassword.text.clear()
                repairDeviceId.text.clear()
            }
        }
        label("Normal pairing: use create-device.mjs with this installation ID, then enter its one-time credential.")
        credential = field("Device credential", "")
        credential.inputType = 129
        action("Save encrypted credential") {
            val value = credential.text.toString().trim()
            if (value.length < 16) show("Credential missing")
            else try {
                prefs.edit().putString("secret", encrypt(value)).apply()
                credential.text.clear(); show("Credential stored using Android Keystore")
            } catch (e: Exception) { show("Credential storage failed") }
        }
        action("Send device heartbeat") {
            val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
            val data = JSONObject().put("deviceId", deviceId).put("deviceName", Build.MODEL)
                .put("mode", "NORMAL_MODE")
                .put("status", JSONObject().put("online", true)
                    .put("battery", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                    .put("charging", bm.isCharging).put("network", "UNKNOWN"))
            request("POST", "/android/device/heartbeat", data, true)
        }
        label("Device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}")
        action("Request location permission") {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 100)
        }
        action("Open location settings") { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
        action("Show cached location") {
            if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) show("Location permission required")
            else {
                val lm = getSystemService(LOCATION_SERVICE) as LocationManager
                val loc = lm.getProviders(true).mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
                show(if (loc == null) "No cached location available" else "${loc.latitude}, ${loc.longitude}, accuracy ${loc.accuracy}m")
            }
        }
        status = TextView(this).apply { text = "Not connected"; textSize = 15f; setTextColor(Color.CYAN) }
        root.addView(status)
    }
    private fun show(value: String) { status.text = value }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("jazz_recovery_key_v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("jazz_recovery_key_v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }
    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }
    private fun repairExistingDevice(username: String, password: String, existingDeviceId: String, clearFields: () -> Unit) {
        val base = (prefs.getString("server", "") ?: "").trim().trimEnd('/')
        if (!base.startsWith("https://") || runCatching { URL(base).host.isBlank() }.getOrDefault(true)) {
            show("Configure a valid HTTPS recovery server URL first")
            return
        }
        if (username.length !in 3..64 || password.isBlank() || existingDeviceId.length !in 3..120) {
            show("Enter your existing account username, password and original device ID")
            return
        }
        val newToken = Base64.encodeToString(
            ByteArray(32).also { java.security.SecureRandom().nextBytes(it) },
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        // Encrypt locally before rotating the server credential. If Keystore storage
        // cannot be prepared, leave the server-side token unchanged.
        val encryptedToken = try { encrypt(newToken) } catch (_: Exception) {
            show("Secure token storage failed; no repair request was sent")
            return
        }
        show("Verifying account and re-pairing the existing device…")
        Thread {
            var failure: String? = null
            try {
                val conn = URL(base + "/api/auth/device-repair").openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 10000
                    conn.readTimeout = 15000
                    conn.instanceFollowRedirects = false
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.doOutput = true
                    val body = JSONObject()
                        .put("username", username)
                        .put("password", password)
                        .put("deviceId", existingDeviceId)
                        .put("deviceToken", newToken)
                        .put("deviceName", Build.MODEL.take(80))
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    val code = conn.responseCode
                    val responseText = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(500) } ?: ""
                    val response = runCatching { JSONObject(responseText) }.getOrNull()
                    if (code !in 200..299 || response?.optBoolean("ok", false) != true) {
                        failure = response?.optString("error")?.takeIf { it.isNotBlank() }
                            ?: "Re-pair failed (HTTP $code). Check the username, password and original device ID."
                    } else {
                        prefs.edit()
                            .putString("device_id", existingDeviceId)
                            .putString("secret", encryptedToken)
                            .apply()
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                failure = "Re-pair connection failed: ${e.javaClass.simpleName}. The server may not have the device-repair endpoint yet."
            }
            runOnUiThread {
                if (failure == null) {
                    deviceId = existingDeviceId
                    clearFields()
                    show("Re-pair successful. Existing device ID and recovery history preserved; new credential stored securely. Tap Send device heartbeat to verify.")
                } else {
                    show(failure!!)
                }
            }
        }.start()
    }

    private fun request(method: String, path: String, data: JSONObject?, auth: Boolean) {
        val base = prefs.getString("server", "") ?: ""
        if (!base.startsWith("https://")) { show("Configure HTTPS server first"); return }
        val secret = if (auth) runCatching { decrypt(prefs.getString("secret", "") ?: "") }.getOrNull() else null
        if (auth && secret.isNullOrBlank()) { show("Provision and save your device credential first"); return }
        show("Connecting...")
        Thread {
            val message = try {
                val conn = URL(base + path).openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = method; conn.connectTimeout = 8000; conn.readTimeout = 12000
                    conn.instanceFollowRedirects = false
                    if (auth) {
                        conn.setRequestProperty("Authorization", "Bearer $secret")
                        conn.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
                    }
                    if (data != null) {
                        conn.doOutput = true
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.outputStream.use { it.write(data.toString().toByteArray()) }
                    }
                    val code = conn.responseCode
                    val response = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(400) } ?: ""
                    "HTTP $code: $response"
                } finally { conn.disconnect() }
            } catch (e: Exception) { "Connection failed: ${e.javaClass.simpleName}" }
            runOnUiThread { show(message) }
        }.start()
    }
}
