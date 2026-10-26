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
import android.content.ClipData
import android.content.ClipboardManager
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
    private lateinit var tokenDisplay: EditText
    private lateinit var idDisplay: EditText
    private lateinit var deviceIdSummary: TextView
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
        deviceIdSummary = TextView(this).apply {
            text = "Current device ID: $deviceId"
            textSize = 17f
            setTextColor(Color.WHITE)
            setPadding(0, 12, 0, 12)
        }
        root.addView(deviceIdSummary)
        label("Server setup")
        server = field("https://server.example.com", prefs.getString("server", "") ?: "")
        action("Save HTTPS URL") {
            val value = server.text.toString().trim().trimEnd('/')
            if (!value.startsWith("https://") || runCatching { URL(value).host.isBlank() }.getOrDefault(true))
                show("Enter a valid HTTPS server URL")
            else { prefs.edit().putString("server", value).apply(); show("Server URL saved") }
        }
        action("Test /health") { request("GET", "/health", null, false) }

        label("Restore an existing account and device")
        label("Use your existing Jazz Recovery username, password, and the original Device ID shown on the website. This keeps the same device record and recovery history.")
        val existingUsername = field("Existing account username", "")
        val existingPassword = field("Existing account password", "").apply { inputType = 129 }
        val existingDeviceId = field("Original registered Device ID", "")
        action("Sign In to Existing Account") {
            loginAccount(existingUsername.text.toString().trim(), existingPassword.text.toString())
        }
        action("Restore Existing Device") {
            repairExistingDevice(
                existingUsername.text.toString().trim(),
                existingPassword.text.toString(),
                existingDeviceId.text.toString().trim()
            ) {
                existingUsername.text.clear()
                existingPassword.text.clear()
                existingDeviceId.text.clear()
            }
        }

        label("Pair a new device from the Jazz Recovery website")
        label("Copy both values below into the website registration form. The token is stored encrypted with Android Keystore.")
        label("Device ID")
        idDisplay = field("Device ID", deviceId)
        idDisplay.isFocusable = false
        action("Copy Device ID") { copyText(deviceId); show("Device ID copied") }
        label("One-time device token")
        tokenDisplay = field("Generate a token before website registration", "")
        tokenDisplay.inputType = 129
        tokenDisplay.isFocusable = false
        action("Generate / Show Device Token") {
            try {
                val existing = prefs.getString("secret", null)
                val token = if (!existing.isNullOrBlank()) decrypt(existing) else {
                    val bytes = ByteArray(32)
                    java.security.SecureRandom().nextBytes(bytes)
                    android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
                        .also { prefs.edit().putString("secret", encrypt(it)).apply() }
                }
                tokenDisplay.setText(token)
                show("Token ready. Register this exact token on the website; do not regenerate after pairing.")
            } catch (e: Exception) { show("Token generation or secure storage failed") }
        }
        action("Copy Device Token") {
            val token = tokenDisplay.text.toString()
            if (token.isBlank()) show("Generate / show the token first")
            else { copyText(token); show("Device token copied. Keep it private.") }
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
        action("Enable Recovery Readiness") {
            val savedToken = prefs.getString("secret", null)
            val savedServer = prefs.getString("server", "") ?: ""
            if (!savedServer.startsWith("https://") || savedToken.isNullOrBlank()) show("Save HTTPS server URL and generate the device token first")
            else if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) show("Grant Camera Permission first")
            else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 103)
                show("Allow notifications, then tap Enable Recovery Readiness again")
            } else {
                val intent = Intent(this, RecoveryAgentService::class.java)
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
                show("Recovery readiness started. Keep the ongoing notification enabled.")
            }
        }
        action("Stop Recovery Readiness") {
            stopService(Intent(this, RecoveryAgentService::class.java))
            show("Recovery readiness stopped")
        }
        label("Device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}")
        action("Grant Camera Permission") {
            if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.CAMERA), 101)
            } else show("Camera permission is already granted")
        }
        action("Grant Location Permission") {
            if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 100)
            } else show("Location permission is already granted")
        }
        action("Grant Bluetooth Permission / Setup") {
            if (Build.VERSION.SDK_INT >= 31) {
                val needed = arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
                    .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.toTypedArray()
                if (needed.isNotEmpty()) requestPermissions(needed, 102)
                else startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            } else startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
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
    private fun copyText(value: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Jazz Recovery", value))
    }
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
    private fun loginAccount(username: String, password: String) {
        val base = (prefs.getString("server", "") ?: "").trim().trimEnd('/')
        if (!base.startsWith("https://") || runCatching { URL(base).host.isBlank() }.getOrDefault(true)) {
            show("Save a valid HTTPS recovery server URL first")
            return
        }
        if (username.isBlank() || username.length > 64 || password.isBlank() || password.length > 512) {
            show("Enter your existing username and password")
            return
        }
        show("Signing in to your existing account…")
        Thread {
            var message: String
            var signedIn = false
            try {
                val conn = URL("$base/api/auth/login").openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 10000
                    conn.readTimeout = 15000
                    conn.instanceFollowRedirects = false
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.doOutput = true
                    val body = JSONObject().put("username", username).put("password", password)
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    val code = conn.responseCode
                    val responseText = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(1600) } ?: ""
                    val response = runCatching { JSONObject(responseText) }.getOrNull()
                    if (code in 200..299 && response?.optBoolean("ok", false) == true) {
                        val cookieHeader = conn.getHeaderField("Set-Cookie")
                            ?: conn.headerFields.entries.firstOrNull { it.key?.equals("Set-Cookie", true) == true }?.value?.firstOrNull()
                        val cookiePair = cookieHeader?.substringBefore(';')?.trim()
                        if (!cookiePair.isNullOrBlank() && cookiePair.contains('=')) {
                            val saved = prefs.edit()
                                .putString("account_username", response.optString("username", username))
                                .putString("account_session_cookie", encrypt(cookiePair))
                                .commit()
                            if (saved) {
                                signedIn = true
                                message = "Account sign-in successful. Existing account verified; no new account was created."
                            } else {
                                message = "Account credentials verified, but the session could not be saved securely on this device."
                            }
                        } else {
                            message = "Server accepted the credentials but did not return a session cookie. Check the deployed server response headers."
                        }
                    } else {
                        val detail = response?.optString("error")?.takeIf { it.isNotBlank() }
                            ?: "Check the account username, password, and saved server URL."
                        message = when (code) {
                            401 -> "Sign-in failed: username or password was rejected by the server."
                            429 -> "Too many sign-in attempts. Wait before trying again."
                            else -> "Sign-in failed (HTTP $code): $detail"
                        }
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (failure: Exception) {
                message = "Account sign-in connection failed (${failure.javaClass.simpleName}). Check the HTTPS server URL and connection."
            }
            runOnUiThread { show(message) }
        }.start()
    }

    private fun repairExistingDevice(
        username: String,
        password: String,
        originalDeviceId: String,
        clearFields: () -> Unit
    ) {
        val base = (prefs.getString("server", "") ?: "").trim().trimEnd('/')
        if (!base.startsWith("https://") || runCatching { URL(base).host.isBlank() }.getOrDefault(true)) {
            show("Save a valid HTTPS recovery server URL first")
            return
        }
        if (username.isBlank() || username.length > 64 || password.isBlank() || password.length > 512 ||
            originalDeviceId.length !in 3..128) {
            show("Enter your existing username, password, and original registered Device ID")
            return
        }

        // Reuse a pending token after a network timeout. The server may have rotated
        // the credential even if the response was lost; reusing the same token makes
        // the retry safe and prevents the device from being stranded with an unknown token.
        val pendingDeviceId = prefs.getString("pending_repair_device_id", "") ?: ""
        val pendingEncrypted = prefs.getString("pending_repair_token", "") ?: ""
        val reusedToken = if (pendingDeviceId == originalDeviceId && pendingEncrypted.isNotBlank()) {
            runCatching { decrypt(pendingEncrypted) }.getOrNull()
        } else null
        val token = reusedToken ?: Base64.encodeToString(
            ByteArray(32).also { java.security.SecureRandom().nextBytes(it) },
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        val encryptedToken = try { encrypt(token) } catch (_: Exception) {
            show("Secure token storage failed; no repair request was sent")
            return
        }
        if (!prefs.edit()
                .putString("pending_repair_device_id", originalDeviceId)
                .putString("pending_repair_token", encryptedToken)
                .commit()) {
            show("Could not safely save the pending device token; no repair request was sent")
            return
        }

        show("Verifying account and restoring the existing device…")
        Thread {
            var message: String
            var canonicalDeviceId = originalDeviceId
            var repaired = false
            try {
                val conn = URL("$base/api/auth/device-repair").openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 10000
                    conn.readTimeout = 20000
                    conn.instanceFollowRedirects = false
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.doOutput = true
                    val body = JSONObject()
                        .put("username", username)
                        .put("password", password)
                        .put("deviceId", originalDeviceId)
                        .put("deviceToken", token)
                        .put("deviceName", Build.MODEL.take(80))
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    val code = conn.responseCode
                    val responseText = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(2000) } ?: ""
                    val response = runCatching { JSONObject(responseText) }.getOrNull()
                    if (code in 200..299 && response?.optBoolean("ok", false) == true) {
                        canonicalDeviceId = response.optString("deviceId", originalDeviceId).trim().ifBlank { originalDeviceId }
                        repaired = true
                        message = "Existing account verified. Device restored; recovery history preserved."
                    } else {
                        val serverError = response?.optString("error")?.takeIf { it.isNotBlank() }
                        message = when (code) {
                            401 -> "Login failed: username or password was rejected by the server."
                            404 -> "Device not found under this account. Copy the original Device ID from the website, not the new installation ID."
                            409 -> serverError ?: "This Device ID is ambiguous. Copy the exact original ID from the website."
                            429 -> "Too many attempts. Wait before trying again."
                            else -> serverError ?: "Device restore failed (HTTP $code). Check the server URL and try again."
                        }
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (failure: Exception) {
                message = "Could not confirm device restore (${failure.javaClass.simpleName}). The pending token is saved; retry with the same account and Device ID."
            }

            runOnUiThread {
                if (repaired) {
                    val saved = prefs.edit()
                        .putString("device_id", canonicalDeviceId)
                        .putString("secret", encryptedToken)
                        .remove("pending_repair_device_id")
                        .remove("pending_repair_token")
                        .commit()
                    if (saved) {
                        deviceId = canonicalDeviceId
                        deviceIdSummary.text = "Current device ID: $canonicalDeviceId"
                        idDisplay.setText(canonicalDeviceId)
                        clearFields()
                        show("Existing device restored. ID and recovery history preserved. You can now send a heartbeat or enable Recovery Readiness.")
                    } else {
                        show("Server restored the device, but local token save needs retry. Tap Restore Existing Device again with the same credentials and ID.")
                    }
                } else {
                    show(message)
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
                    val responseText = (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.use { it.readText().take(1200) } ?: ""
                    val response = runCatching { JSONObject(responseText) }.getOrNull()
                    if (code in 200..299 && response?.optBoolean("ok", false) == true) {
                        when {
                            path == "/health" -> "Server connection successful."
                            path == "/android/device/heartbeat" -> "Device connected. Server accepted the heartbeat."
                            else -> response.optString("message").takeIf { it.isNotBlank() }
                                ?: "Request completed successfully."
                        }
                    } else {
                        val detail = response?.optString("error")?.takeIf { it.isNotBlank() }
                            ?: response?.optString("message")?.takeIf { it.isNotBlank() }
                            ?: "The server rejected the request."
                        when (code) {
                            401 -> "Device authentication failed. Restore the existing device with your account credentials."
                            404 -> "Device or API endpoint not found. Check the registered Device ID and server URL."
                            429 -> "Too many requests. Wait and try again."
                            else -> "Request failed (HTTP $code): $detail"
                        }
                    }
                } finally { conn.disconnect() }
            } catch (e: Exception) { "Connection failed: ${e.javaClass.simpleName}" }
            runOnUiThread { show(message) }
        }.start()
    }
}
