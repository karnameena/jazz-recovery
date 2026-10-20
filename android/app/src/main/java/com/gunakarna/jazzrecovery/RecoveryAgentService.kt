package com.gunakarna.jazzrecovery

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.*
import android.location.LocationManager
import android.Manifest
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Owner-enabled recovery agent. The ongoing notification is intentional and visible.
 * Camera access is attempted only after the owner grants CAMERA permission and starts
 * this foreground service while the app is visible. Android/OEM policy may still block capture.
 */
class RecoveryAgentService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null
    private val prefs by lazy { getSharedPreferences("jazz_recovery_standalone", Context.MODE_PRIVATE) }
    private val channelId = "jazz_recovery_ready"

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notification.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Jazz Recovery is ready")
            .setContentText("Owner-enabled recovery connection is active")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(42, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(42, notification)
        }
        if (!running) {
            running = true
            worker = Thread { loop() }.also { it.name = "JazzRecoveryAgent"; it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        worker = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(channelId, "Recovery readiness", NotificationManager.IMPORTANCE_LOW))
        }
    }

    private fun loop() {
        var lastHeartbeat = 0L
        while (running && !Thread.currentThread().isInterrupted) {
            try {
                val base = (prefs.getString("server", "") ?: "").trimEnd('/')
                val deviceId = prefs.getString("device_id", "") ?: ""
                val token = runCatching { decrypt(prefs.getString("secret", "") ?: "") }.getOrNull().orEmpty()
                if (base.startsWith("https://") && deviceId.isNotBlank() && token.length >= 32) {
                    if (System.currentTimeMillis() - lastHeartbeat >= 30_000) {
                        post(base, "/android/device/heartbeat", token, deviceId, JSONObject()
                            .put("deviceId", deviceId)
                            .put("mode", if (prefs.getBoolean("lost_mode", false)) "LOST_MODE" else "NORMAL_MODE")
                            .put("status", JSONObject()
                                .put("battery", (getSystemService(BATTERY_SERVICE) as android.os.BatteryManager).getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY))
                                .put("charging", false)
                                .put("network", "CONNECTED")
                                .put("locationServices", locationState())))
                        lastHeartbeat = System.currentTimeMillis()
                    }
                    val response = request("GET", base + "/android/device/commands/next", token, deviceId, null)
                    val command = response?.optJSONObject("command")
                    if (command != null) handleCommand(base, token, deviceId, command)
                }
            } catch (_: Exception) { /* Retry on next short poll; do not crash the foreground service. */ }
            try { Thread.sleep(2500) } catch (_: InterruptedException) { break }
        }
    }

    private fun handleCommand(base: String, token: String, deviceId: String, command: JSONObject) {
        val id = command.optString("id")
        val type = command.optString("type")
        val args = command.optJSONObject("args") ?: JSONObject()
        val result = try {
            when (type) {
                "device_status" -> JSONObject().put("ok", true).put("mode", if (prefs.getBoolean("lost_mode", false)) "LOST_MODE" else "NORMAL_MODE")
                    .put("status", JSONObject().put("battery", (getSystemService(BATTERY_SERVICE) as android.os.BatteryManager).getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY))
                        .put("network", "CONNECTED").put("locationServices", locationState()))
                "device_location" -> getLocation()
                "recovery_photo" -> capturePhoto(if (args.optString("camera") == "rear") "rear" else "front")
                "ring_device" -> ring(args.optLong("durationMs", 10000L))
                "set_recovery_mode" -> {
                    val enabled = args.optBoolean("enabled", true)
                    prefs.edit().putBoolean("lost_mode", enabled).apply()
                    JSONObject().put("ok", true).put("mode", if (enabled) "LOST_MODE" else "NORMAL_MODE")
                }
                "location_status" -> JSONObject().put("ok", true).put("locationServices", locationState()).put("timestamp", System.currentTimeMillis())
                "location_enable", "location_disable" -> JSONObject().put("ok", false).put("error", "ANDROID_PERMISSION_OR_DEVICE_OWNER_REQUIRED")
                else -> JSONObject().put("ok", false).put("error", "UNSUPPORTED_COMMAND")
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.javaClass.simpleName)
        }
        post(base, "/android/device/commands/$id/result", token, deviceId, JSONObject().put("result", result))
    }

    private fun locationState(): String {
        return try {
            val lm = getSystemService(LOCATION_SERVICE) as LocationManager
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) "ON" else "OFF"
        } catch (_: Exception) { "UNKNOWN" }
    }

    private fun getLocation(): JSONObject {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return JSONObject().put("ok", false).put("error", "LOCATION_PERMISSION_REQUIRED")
        }
        val lm = getSystemService(LOCATION_SERVICE) as LocationManager
        val loc = lm.getProviders(true).mapNotNull { provider ->
            runCatching { lm.getLastKnownLocation(provider) }.getOrNull()
        }.maxByOrNull { it.time } ?: return JSONObject().put("ok", false).put("error", "NO_CACHED_LOCATION")
        return JSONObject().put("ok", true).put("latitude", loc.latitude).put("longitude", loc.longitude)
            .put("accuracyMeters", loc.accuracy).put("timestamp", loc.time)
    }

    private fun ring(duration: Long): JSONObject {
        val tone = android.media.ToneGenerator(android.media.AudioManager.STREAM_ALARM, 100)
        tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP2)
        Thread.sleep(duration.coerceIn(1000L, 10000L))
        tone.stopTone()
        tone.release()
        return JSONObject().put("ok", true)
    }

    private fun capturePhoto(camera: String): JSONObject {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return JSONObject().put("ok", false).put("error", "CAMERA_PERMISSION_REQUIRED")
        }
        val manager = getSystemService(CAMERA_SERVICE) as CameraManager
        val targetFacing = if (camera == "rear") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
        val cameraId = manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == targetFacing
        } ?: return JSONObject().put("ok", false).put("error", "CAMERA_NOT_AVAILABLE")
        val size = manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(android.graphics.ImageFormat.JPEG)?.minByOrNull { it.width * it.height }
            ?: return JSONObject().put("ok", false).put("error", "JPEG_OUTPUT_UNAVAILABLE")
        val reader = ImageReader.newInstance(size.width, size.height, android.graphics.ImageFormat.JPEG, 2)
        val handlerThread = HandlerThread("JazzRecoveryCamera").apply { start() }
        val handler = Handler(handlerThread.looper)
        val latch = CountDownLatch(1)
        var imageBytes: ByteArray? = null
        var cameraDevice: CameraDevice? = null
        var session: CameraCaptureSession? = null
        reader.setOnImageAvailableListener({ source ->
            source.acquireLatestImage()?.use { image ->
                val buffer = image.planes[0].buffer
                imageBytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
                latch.countDown()
            }
        }, handler)
        try {
            val opened = CountDownLatch(1)
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) { cameraDevice = camera; opened.countDown() }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); opened.countDown() }
                override fun onError(camera: CameraDevice, error: Int) { camera.close(); opened.countDown() }
            }, handler)
            if (!opened.await(5, TimeUnit.SECONDS) || cameraDevice == null) return JSONObject().put("ok", false).put("error", "CAMERA_OPEN_FAILED")
            val configured = CountDownLatch(1)
            cameraDevice!!.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(value: CameraCaptureSession) { session = value; configured.countDown() }
                override fun onConfigureFailed(value: CameraCaptureSession) { configured.countDown() }
            }, handler)
            if (!configured.await(5, TimeUnit.SECONDS) || session == null) return JSONObject().put("ok", false).put("error", "CAMERA_SESSION_FAILED")
            val request = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                addTarget(reader.surface)
                set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                set(CaptureRequest.JPEG_ORIENTATION, 0)
            }.build()
            session!!.capture(request, object : CameraCaptureSession.CaptureCallback() {}, handler)
            if (!latch.await(8, TimeUnit.SECONDS) || imageBytes == null) return JSONObject().put("ok", false).put("error", "CAMERA_CAPTURE_TIMEOUT")
            return JSONObject().put("ok", true).put("camera", camera)
                .put("mimeType", "image/jpeg").put("imageBase64", Base64.encodeToString(imageBytes, Base64.NO_WRAP))
                .put("timestamp", System.currentTimeMillis())
        } finally {
            runCatching { session?.close() }
            runCatching { cameraDevice?.close() }
            reader.close()
            handlerThread.quitSafely()
        }
    }

    private fun post(base: String, path: String, token: String, deviceId: String, body: JSONObject) {
        request("POST", base + path, token, deviceId, body)
    }

    private fun request(method: String, url: String, token: String, deviceId: String, body: JSONObject?): JSONObject? {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 5000
            conn.readTimeout = 8000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return if (code in 200..299 && text.isNotBlank()) JSONObject(text) else null
        } finally { conn.disconnect() }
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey("jazz_recovery_key_v1", null) as? SecretKey ?: error("Recovery key unavailable")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}
