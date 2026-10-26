package com.gunakarna.jazzrecovery

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.*
import android.location.LocationManager
import android.Manifest
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
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
    private val photoQueueDir by lazy { File(filesDir, "recovery-photo-pending") }
    private val maxPhotoBytes = 5 * 1024 * 1024
    private val jpegLongEdge = 2560
    private val jpegQuality = 90

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
                    retryPendingPhotoResults(base, token, deviceId)
                    val response = request("GET", base + "/android/device/commands/next", token, deviceId, null)
                    val command = response?.optJSONObject("command")
                    if (command != null) handleCommand(base, token, deviceId, command)
                }
            } catch (failure: Exception) {
                Log.w("JazzRecoveryPhoto", "Agent loop recovered from " + failure.javaClass.simpleName)
            }
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
        } catch (failure: Exception) {
            Log.w("JazzRecoveryPhoto", "Command handling failed type=" + type + " error=" + failure.javaClass.simpleName)
            JSONObject().put("ok", false).put("status", "COMMAND_FAILED").put("error", "COMMAND_FAILED")
        }
        val envelope = JSONObject().put("result", result)
        if (type == "recovery_photo") {
            if (!persistPhotoResult(id, envelope)) {
                Log.e("JazzRecoveryPhoto", "Photo result could not be persisted command=" + id + "; upload skipped")
                return
            }
            val startedAt = System.currentTimeMillis()
            val response = runCatching {
                request("POST", base + "/android/device/commands/$id/result", token, deviceId, envelope)
            }.onFailure { failure ->
                Log.w("JazzRecoveryPhoto", "Photo upload deferred command=" + id + " cause=" + failure.javaClass.simpleName)
            }.getOrNull()
            if (response?.optBoolean("ok", false) == true) {
                deleteQueuedPhotoResult(id)
                Log.i("JazzRecoveryPhoto", "Photo acknowledged command=" + id + " durationMs=" + (System.currentTimeMillis() - startedAt))
            } else {
                Log.w("JazzRecoveryPhoto", "Photo remains queued command=" + id)
            }
        } else {
            post(base, "/android/device/commands/$id/result", token, deviceId, envelope)
        }
    }

    private fun persistPhotoResult(commandId: String, envelope: JSONObject): Boolean {
        return try {
            if (!photoQueueDir.exists() && !photoQueueDir.mkdirs()) return false
            val target = File(photoQueueDir, "$commandId.json")
            if (target.isFile && target.length() > 0L) return true
            val temporary = File(photoQueueDir, ".$commandId.${System.nanoTime()}.tmp")
            FileOutputStream(temporary).use { stream ->
                stream.write(envelope.toString().toByteArray(Charsets.UTF_8))
                stream.fd.sync()
            }
            if (!temporary.renameTo(target)) {
                if (!target.exists()) temporary.copyTo(target, overwrite = false)
                temporary.delete()
            }
            target.isFile && target.length() > 0L
        } catch (failure: Exception) {
            Log.e("JazzRecoveryPhoto", "Photo queue write failed command=" + commandId + " cause=" + failure.javaClass.simpleName)
            false
        }
    }

    private fun deleteQueuedPhotoResult(commandId: String) {
        runCatching { File(photoQueueDir, "$commandId.json").delete() }
    }

    private fun retryPendingPhotoResults(base: String, token: String, deviceId: String) {
        if (!photoQueueDir.isDirectory) return
        val pending = photoQueueDir.listFiles { file -> file.isFile && file.extension == "json" }
            ?.sortedBy { it.lastModified() } ?: return
        for (file in pending.take(2)) {
            if (!running || Thread.currentThread().isInterrupted) return
            val commandId = file.nameWithoutExtension
            val envelope = try {
                JSONObject(file.readText(Charsets.UTF_8))
            } catch (failure: Exception) {
                Log.e("JazzRecoveryPhoto", "Photo queue entry unreadable command=" + commandId)
                continue
            }
            val startedAt = System.currentTimeMillis()
            val response = runCatching {
                request("POST", "$base/android/device/commands/$commandId/result", token, deviceId, envelope)
            }.onFailure { failure ->
                Log.w("JazzRecoveryPhoto", "Photo retry deferred command=" + commandId + " cause=" + failure.javaClass.simpleName)
            }.getOrNull()
            if (response?.optBoolean("ok", false) == true) {
                deleteQueuedPhotoResult(commandId)
                Log.i("JazzRecoveryPhoto", "Photo retry acknowledged command=" + commandId + " durationMs=" + (System.currentTimeMillis() - startedAt))
            } else {
                return
            }
        }
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
        val captureStartedAt = System.currentTimeMillis()
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return photoFailure("CAMERA_PERMISSION_REQUIRED", camera, captureStartedAt)
        }
        val manager = getSystemService(CAMERA_SERVICE) as CameraManager
        val targetFacing = if (camera == "rear") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
        val cameraId = try {
            manager.cameraIdList.firstOrNull { id ->
                manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == targetFacing
            }
        } catch (failure: SecurityException) {
            return photoFailure("CAMERA_PERMISSION_REVOKED", camera, captureStartedAt)
        } catch (failure: Exception) {
            return photoFailure("CAMERA_ENUMERATION_FAILED", camera, captureStartedAt, failure)
        } ?: return photoFailure("CAMERA_NOT_AVAILABLE", camera, captureStartedAt)
        val characteristics = try { manager.getCameraCharacteristics(cameraId) } catch (failure: Exception) {
            return photoFailure("CAMERA_CHARACTERISTICS_FAILED", camera, captureStartedAt, failure)
        }
        val sizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(android.graphics.ImageFormat.JPEG)
            ?: return photoFailure("JPEG_OUTPUT_UNAVAILABLE", camera, captureStartedAt)
        val size = sizes.filter { maxOf(it.width, it.height) <= 2560 }
            .maxByOrNull { it.width.toLong() * it.height.toLong() }
            ?: sizes.minByOrNull { it.width.toLong() * it.height.toLong() }
            ?: return photoFailure("JPEG_OUTPUT_UNAVAILABLE", camera, captureStartedAt)
        val reader = ImageReader.newInstance(size.width, size.height, android.graphics.ImageFormat.JPEG, 2)
        val handlerThread = HandlerThread("JazzRecoveryCamera").apply { start() }
        val handler = Handler(handlerThread.looper)
        val latch = CountDownLatch(1)
        var imageBytes: ByteArray? = null
        var cameraDevice: CameraDevice? = null
        var session: CameraCaptureSession? = null
        var openError: String? = null
        var sessionError = false
        val captureFinalImage = java.util.concurrent.atomic.AtomicBoolean(false)
        val meteringImageLatch = java.util.concurrent.atomic.AtomicReference<CountDownLatch?>(null)
        reader.setOnImageAvailableListener({ source ->
            source.acquireLatestImage()?.use { image ->
                if (captureFinalImage.get()) {
                    val buffer = image.planes[0].buffer
                    imageBytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
                    latch.countDown()
                } else {
                    meteringImageLatch.get()?.countDown()
                }
            }
        }, handler)
        try {
            val opened = CountDownLatch(1)
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) { cameraDevice = camera; opened.countDown() }
                override fun onDisconnected(camera: CameraDevice) {
                    openError = "CAMERA_OPEN_DISCONNECTED"
                    camera.close()
                    opened.countDown()
                }
                override fun onError(camera: CameraDevice, error: Int) {
                    openError = "CAMERA_OPEN_ERROR_$error"
                    camera.close()
                    opened.countDown()
                }
            }, handler)
            if (!opened.await(6, TimeUnit.SECONDS)) return photoFailure("CAMERA_OPEN_TIMEOUT", camera, captureStartedAt)
            if (cameraDevice == null) return photoFailure(openError ?: "CAMERA_OPEN_FAILED", camera, captureStartedAt)
            val configured = CountDownLatch(1)
            cameraDevice!!.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(value: CameraCaptureSession) { session = value; configured.countDown() }
                override fun onConfigureFailed(value: CameraCaptureSession) { sessionError = true; configured.countDown() }
            }, handler)
            if (!configured.await(6, TimeUnit.SECONDS)) return photoFailure("CAMERA_SESSION_TIMEOUT", camera, captureStartedAt)
            if (session == null) return photoFailure(if (sessionError) "CAMERA_SESSION_CONFIG_FAILED" else "CAMERA_SESSION_FAILED", camera, captureStartedAt)
            // Give the camera a metering frame before accepting the final photo. The
            // previous one-shot capture could be taken before auto-exposure/white-balance
            // had settled, producing an almost-black or badly exposed image on some devices.
            val requestBuilder = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                addTarget(reader.surface)
                set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                val aeModes = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)
                if (aeModes?.contains(CaptureRequest.CONTROL_AE_MODE_ON) == true) {
                    set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                }
                val awbModes = characteristics.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)
                if (awbModes?.contains(CaptureRequest.CONTROL_AWB_MODE_AUTO) == true) {
                    set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                }
                val afModes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)
                if (afModes?.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) == true) {
                    set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                }
                set(CaptureRequest.JPEG_ORIENTATION, 0)
            }
            var finalAeState: Int? = null
            for (attempt in 0 until 2) {
                val meteringImageReady = CountDownLatch(1)
                val meteringResultReady = CountDownLatch(1)
                var aeState: Int? = null
                meteringImageLatch.set(meteringImageReady)
                session!!.capture(requestBuilder.build(), object : CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(
                        session: CameraCaptureSession,
                        request: CaptureRequest,
                        result: TotalCaptureResult
                    ) {
                        aeState = result.get(CaptureResult.CONTROL_AE_STATE)
                        meteringResultReady.countDown()
                    }
                }, handler)
                val resultArrived = meteringResultReady.await(1200, TimeUnit.MILLISECONDS)
                val imageArrived = meteringImageReady.await(1200, TimeUnit.MILLISECONDS)
                meteringImageLatch.compareAndSet(meteringImageReady, null)
                if (!imageArrived) {
                    return photoFailure("CAMERA_EXPOSURE_METERING_TIMEOUT", camera, captureStartedAt)
                }
                finalAeState = if (resultArrived) aeState else null
                if (!resultArrived || aeState == null ||
                    aeState == CaptureResult.CONTROL_AE_STATE_CONVERGED ||
                    aeState == CaptureResult.CONTROL_AE_STATE_LOCKED ||
                    aeState == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED) {
                    break
                }
            }
            Log.i("JazzRecoveryPhoto", "Exposure metering camera=" + camera + " aeState=" + (finalAeState?.toString() ?: "unknown"))
            captureFinalImage.set(true)
            session!!.capture(requestBuilder.build(), object : CameraCaptureSession.CaptureCallback() {}, handler)
            if (!latch.await(8, TimeUnit.SECONDS) || imageBytes == null) {
                return photoFailure("CAMERA_CAPTURE_TIMEOUT_OR_OS_BLOCKED", camera, captureStartedAt)
            }
            val compressed = compressJpegWithinLimit(imageBytes!!)
                ?: return photoFailure("PHOTO_COMPRESSION_FAILED_OR_TOO_LARGE", camera, captureStartedAt)
            Log.i("JazzRecoveryPhoto", "Capture ready camera=" + camera + " bytes=" + compressed.size +
                " durationMs=" + (System.currentTimeMillis() - captureStartedAt))
            return JSONObject().put("ok", true).put("camera", camera)
                .put("mimeType", "image/jpeg").put("imageBase64", Base64.encodeToString(compressed, Base64.NO_WRAP))
                .put("timestamp", System.currentTimeMillis())
        } catch (failure: SecurityException) {
            return photoFailure("CAMERA_ACCESS_RESTRICTED", camera, captureStartedAt, failure)
        } catch (failure: CameraAccessException) {
            val code = if (failure.reason == CameraAccessException.CAMERA_IN_USE ||
                failure.reason == CameraAccessException.MAX_CAMERAS_IN_USE) "CAMERA_BUSY" else "CAMERA_ACCESS_ERROR"
            return photoFailure(code, camera, captureStartedAt, failure)
        } catch (failure: Exception) {
            return photoFailure("CAMERA_CAPTURE_FAILED", camera, captureStartedAt, failure)
        } finally {
            runCatching { session?.close() }
            runCatching { cameraDevice?.close() }
            runCatching { reader.close() }
            handlerThread.quitSafely()
        }
    }

    private fun photoFailure(code: String, camera: String, startedAt: Long, cause: Throwable? = null): JSONObject {
        Log.w("JazzRecoveryPhoto", "Capture failed camera=" + camera + " code=" + code +
            " durationMs=" + (System.currentTimeMillis() - startedAt) +
            (cause?.let { " exception=" + it.javaClass.simpleName } ?: ""))
        return JSONObject().put("ok", false).put("status", code).put("error", code)
            .put("camera", camera).put("timestamp", System.currentTimeMillis())
    }

    private fun compressJpegWithinLimit(source: ByteArray): ByteArray? {
        if (source.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val largest = maxOf(bounds.outWidth, bounds.outHeight)
        val sample = Integer.highestOneBit(maxOf(1, (largest + jpegLongEdge - 1) / jpegLongEdge)).coerceAtLeast(1)
        val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val decoded = BitmapFactory.decodeByteArray(source, 0, source.size, options) ?: return null
        val bitmap = if (maxOf(decoded.width, decoded.height) > jpegLongEdge) {
            val scale = jpegLongEdge.toFloat() / maxOf(decoded.width, decoded.height)
            Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt().coerceAtLeast(1),
                (decoded.height * scale).toInt().coerceAtLeast(1), true)
        } else decoded
        return try {
            for (quality in listOf(jpegQuality, 86, 82, 78, 74, 70, 66)) {
                val output = java.io.ByteArrayOutputStream()
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) return null
                val bytes = output.toByteArray()
                if (bytes.size <= maxPhotoBytes) return bytes
            }
            null
        } finally {
            if (bitmap !== decoded) bitmap.recycle()
            decoded.recycle()
        }
    }

    private fun post(base: String, path: String, token: String, deviceId: String, body: JSONObject) {
        request("POST", base + path, token, deviceId, body)
    }

    private fun request(method: String, url: String, token: String, deviceId: String, body: JSONObject?): JSONObject? {
        val conn = URL(url).openConnection() as HttpURLConnection
        val isPhotoResult = url.contains("/android/device/commands/") && url.endsWith("/result") &&
            !body?.optJSONObject("result")?.optString("imageBase64").isNullOrBlank()
        try {
            conn.requestMethod = method
            conn.connectTimeout = if (isPhotoResult) 10_000 else 5_000
            conn.readTimeout = if (isPhotoResult) 60_000 else 8_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer " + token)
            conn.setRequestProperty("X-Jazz-Lost-Device-Id", deviceId)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText().take(4096) } ?: ""
            if (code !in 200..299) {
                Log.w("JazzRecoveryPhoto", "Server returned HTTP " + code + " for " + URL(url).path)
                return null
            }
            return if (text.isNotBlank()) JSONObject(text) else JSONObject().put("ok", true)
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
