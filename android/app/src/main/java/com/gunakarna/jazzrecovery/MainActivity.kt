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
    private val deviceId by lazy {
        prefs.getString("device_id", null) ?: ("jazz-recovery-" + UUID.randomUUID()).also {
            prefs.edit().putString("device_id", it).apply()
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        label("Pair this app from the Jazz Recovery website")
        label("Copy both values below into the website registration form. The token is stored encrypted with Android Keystore.")
        label("Device ID")
        val idDisplay = field("Device ID", deviceId)
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
                prefs.edit().putBoolean("auto_start", true).apply()
                val intent = Intent(this, RecoveryAgentService::class.java).putExtra("owner_start", true)
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
                show(if (Build.VERSION.SDK_INT >= 29 &&
                    checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    "Recovery readiness started. For location after reboot, tap Allow Background Location and choose Allow all the time."
                } else {
                    "Recovery readiness started. Keep the ongoing notification enabled."
                })
            }
        }
        action("Stop Recovery Readiness") {
            prefs.edit().putBoolean("auto_start", false).apply()
            stopService(Intent(this, RecoveryAgentService::class.java))
            show("Recovery readiness stopped; automatic restart disabled")
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
        action("Allow Background Location (needed after reboot)") {
            if (Build.VERSION.SDK_INT >= 29 &&
                checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                show("In App info, open Permissions > Location and choose Allow all the time, then return to Jazz Recovery.")
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(android.net.Uri.parse("package:$packageName")))
            } else {
                show("Background location permission is already granted")
            }
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
