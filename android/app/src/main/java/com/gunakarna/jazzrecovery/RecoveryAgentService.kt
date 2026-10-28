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
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicReference
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
            val hasForegroundLocation =
                checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val hasBackgroundLocation = Build.VERSION.SDK_INT < 29 ||
                checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
            val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                (if (hasForegroundLocation && hasBackgroundLocation) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
            startForeground(42, notification, types)
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
                "device_location" -> getLocation(args.optString("mode", "auto"))
                "recovery_photo" -> capturePhoto(if (args.optString("camera") == "rear") "rear" else "front")
                "ring_device" -> ring(args.optLong("durationMs", 10000L))
                "set_recovery_mode" -> {
                    val enabled = args.optBoolean("enabled", true)
                    prefs.edit().putBoolean("lost_mode", enabled).apply()
                    JSONObject().put("ok", true).put("mode", if (enabled) "LOST_MODE" else "NORMAL_MODE")
                }
                "location_status" -> JSONObject().put("ok", true).put("locationServices", locationState()).put("timestamp", System.currentTimeMillis())
                "location_enable" -> GlobalLocationController.setEnabled(this, true).put("timestamp", System.currentTimeMillis())
                "location_disable" -> GlobalLocationController.setEnabled(this, false).put("timestamp", System.currentTimeMillis())
                else -> JSONObject().put("ok", false).put("error", "UNSUPPORTED_COMMAND")
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.javaClass.simpleName)
        }
        post(base, "/android/device/commands/$id/result", token, deviceId, JSONObject().put("result", result))
    }

    private fun locationState(): String {
        return runCatching { if (GlobalLocationController.isEnabled(this)) "ON" else "OFF" }.getOrDefault("UNKNOWN")
    }

    /**
     * Requests fresh fixes first. Cached data is used only after bounded fresh-provider
     * attempts fail, and is explicitly labelled so callers never present it as live.
     * Cellular and BLE helper positioning are reported as unavailable until their
     * separately authenticated provider/service integrations are configured.
     */
    private fun getLocation(mode: String = "auto"): JSONObject {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return JSONObject().put("ok", false).put("error", "LOCATION_PERMISSION_REQUIRED")
        }
        val normalized = mode.lowercase().ifBlank { "auto" }
        val attempts = org.json.JSONArray()

        if (normalized == "last") {
            val cached = lastKnownLocation()
                ?: return JSONObject().put("ok", false).put("error", "NO_CACHED_LOCATION")
                    .put("source", "NONE").put("fresh", false).put("locations", attempts)
            attempts.put(locationJson(cached, "LAST_KNOWN", false))
            return locationEnvelope(cached, "LAST_KNOWN", false, attempts)
        }
        if (normalized == "cell") {
            return JSONObject().put("ok", false).put("error", "CELLULAR_POSITIONING_NOT_CONFIGURED")
                .put("source", "CELLULAR").put("fresh", false)
        }
        if (normalized == "gps") {
            val gps = runCatching { requestFreshGps() }.getOrNull()
            if (gps != null && validFreshLocation(gps)) {
                attempts.put(locationJson(gps, "GPS_GNSS", true))
                return locationEnvelope(gps, "GPS_GNSS", true, attempts)
            }
            return JSONObject().put("ok", false).put("error", "FRESH_GPS_UNAVAILABLE")
                .put("source", "GPS_GNSS").put("fresh", false).put("locations", attempts)
        }
        if (normalized == "fused") {
            val fused = runCatching { requestFreshFused() }.getOrNull()
            if (fused != null && validFreshLocation(fused)) {
                attempts.put(locationJson(fused, "FUSED", true))
                return locationEnvelope(fused, "FUSED", true, attempts)
            }
            return JSONObject().put("ok", false).put("error", "FRESH_FUSED_LOCATION_UNAVAILABLE")
                .put("source", "FUSED").put("fresh", false).put("locations", attempts)
        }

        // "all" gathers independent fresh providers; "auto" follows the priority
        // sequence and stops at the first validated fresh fix.
        val gps = runCatching { requestFreshGps() }.getOrNull()?.takeIf { validFreshLocation(it) }
        if (gps != null) {
            attempts.put(locationJson(gps, "GPS_GNSS", true))
            if (normalized != "all") return locationEnvelope(gps, "GPS_GNSS", true, attempts)
        } else {
            attempts.put(JSONObject().put("source", "GPS_GNSS").put("status", "UNAVAILABLE"))
        }

        val fused = runCatching { requestFreshFused() }.getOrNull()?.takeIf { validFreshLocation(it) }
        if (fused != null) {
            attempts.put(locationJson(fused, "FUSED", true))
            if (gps == null && normalized != "all") return locationEnvelope(fused, "FUSED", true, attempts)
        } else {
            attempts.put(JSONObject().put("source", "FUSED").put("status", "UNAVAILABLE"))
        }

        // No cellular positioning service or authenticated BLE-helper report endpoint is
        // implemented in this staging branch yet. Report that honestly; never fabricate fixes.
        attempts.put(JSONObject().put("source", "CELLULAR").put("status", "NOT_CONFIGURED"))
        attempts.put(JSONObject().put("source", "BLE_HELPER").put("status", "NOT_CONFIGURED"))

        val cached = lastKnownLocation()
        if (cached != null) attempts.put(locationJson(cached, "LAST_KNOWN", false))
        val chosen = gps ?: fused ?: cached
        return if (chosen != null) {
            val source = when {
                gps != null -> "GPS_GNSS"
                fused != null -> "FUSED"
                else -> "LAST_KNOWN"
            }
            locationEnvelope(chosen, source, source != "LAST_KNOWN", attempts)
        } else {
            JSONObject().put("ok", false).put("error", "LOCATION_UNAVAILABLE")
                .put("source", "NONE").put("fresh", false).put("locations", attempts)
        }
    }

    private fun lastKnownLocation(): android.location.Location? {
        val manager = getSystemService(LOCATION_SERVICE) as LocationManager
        return runCatching {
            manager.getProviders(true).mapNotNull { provider ->
                runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
            }.filter { validCoordinates(it.latitude, it.longitude) && it.time > 0L }
                .maxByOrNull { it.time }
        }.getOrNull()
    }

    private fun requestFreshGps(): android.location.Location? {
        val manager = getSystemService(LOCATION_SERVICE) as LocationManager
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) return null
        val latch = CountDownLatch(1)
        val result = AtomicReference<android.location.Location?>()
        val listener = object : android.location.LocationListener {
            override fun onLocationChanged(location: android.location.Location) {
                result.set(location)
                latch.countDown()
            }
            @Deprecated("Deprecated by Android")
            override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) { latch.countDown() }
        }
        return try {
            manager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper())
            latch.await(10, TimeUnit.SECONDS)
            result.get()?.takeIf { validFreshLocation(it) }
        } finally {
            runCatching { manager.removeUpdates(listener) }
        }
    }

    private fun requestFreshFused(): android.location.Location? {
        val cancellation = com.google.android.gms.tasks.CancellationTokenSource()
        val latch = CountDownLatch(1)
        val result = AtomicReference<android.location.Location?>()
        try {
            com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(this)
                .getCurrentLocation(
                    com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
                    cancellation.token
                )
                .addOnSuccessListener { location -> result.set(location); latch.countDown() }
                .addOnFailureListener { latch.countDown() }
            latch.await(10, TimeUnit.SECONDS)
            return result.get()?.takeIf { validFreshLocation(it) }
        } finally {
            cancellation.cancel()
        }
    }

    private fun validCoordinates(latitude: Double, longitude: Double): Boolean =
        latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0

    private fun validFreshLocation(location: android.location.Location): Boolean {
        val age = System.currentTimeMillis() - location.time
        return validCoordinates(location.latitude, location.longitude) &&
            location.time > 0L && age in 0L..30_000L &&
            location.hasAccuracy() && location.accuracy.isFinite() && location.accuracy >= 0f
    }

    private fun locationJson(location: android.location.Location, source: String, fresh: Boolean) =
        JSONObject().put("source", source).put("status", if (fresh) "SUCCESS" else "CACHED")
            .put("latitude", location.latitude).put("longitude", location.longitude)
            .put("accuracyMeters", if (location.hasAccuracy()) location.accuracy else JSONObject.NULL)
            .put("timestamp", location.time).put("fresh", fresh)

    private fun locationEnvelope(
        location: android.location.Location,
        source: String,
        fresh: Boolean,
        attempts: org.json.JSONArray
    ) = JSONObject().put("ok", true).put("latitude", location.latitude)
        .put("longitude", location.longitude)
        .put("accuracyMeters", if (location.hasAccuracy()) location.accuracy else JSONObject.NULL)
        .put("timestamp", location.time).put("source", source).put("fresh", fresh)
        .put("locations", attempts)


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
        // Capture one frame at a time. The queue lets us discard unsettled 3A frames
        // without accidentally treating a stale ImageReader buffer as the final photo.
        val imageQueue = LinkedBlockingQueue<ByteArray>(2)
        var cameraDevice: CameraDevice? = null
        var session: CameraCaptureSession? = null
        var openError: String? = null
        var sessionError = false
        reader.setOnImageAvailableListener({ source ->
            source.acquireLatestImage()?.use { image ->
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
                if (!imageQueue.offer(bytes)) {
                    imageQueue.poll()
                    imageQueue.offer(bytes)
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
            val aeModes = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)?.toSet().orEmpty()
            val afModes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toSet().orEmpty()
            val awbModes = characteristics.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)?.toSet().orEmpty()
            val flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            val aeMode: Int? = when {
                flashAvailable && aeModes.contains(CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH) ->
                    CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH
                aeModes.contains(CaptureRequest.CONTROL_AE_MODE_ON) -> CaptureRequest.CONTROL_AE_MODE_ON
                else -> aeModes.firstOrNull()
            }
            val afMode: Int? = when {
                afModes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) ->
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                afModes.contains(CaptureRequest.CONTROL_AF_MODE_AUTO) ->
                    CaptureRequest.CONTROL_AF_MODE_AUTO
                else -> null
            }

            var selectedBytes: ByteArray? = null
            var selectedResult: TotalCaptureResult? = null
            var threeASettled = false
            // Camera2 needs time to meter and focus. The old single immediate still
            // request could save a frame before auto-exposure had converged, producing
            // very dark photos on devices without a preview stream. Retry at most twice
            // after the initial metering frame; only the last selected frame is uploaded.
            for (attempt in 0 until 3) {
                val resultLatch = CountDownLatch(1)
                val resultRef = AtomicReference<TotalCaptureResult?>()
                val request = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                    addTarget(reader.surface)
                    set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                    if (aeMode != null) set(CaptureRequest.CONTROL_AE_MODE, aeMode)
                    if (afMode != null) set(CaptureRequest.CONTROL_AF_MODE, afMode)
                    if (awbModes.contains(CaptureRequest.CONTROL_AWB_MODE_AUTO)) {
                        set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                    }
                    set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER,
                        if (attempt == 0) CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_START
                        else CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_IDLE)
                    if (afMode != null) {
                        set(CaptureRequest.CONTROL_AF_TRIGGER,
                            if (attempt == 0) CaptureRequest.CONTROL_AF_TRIGGER_START
                            else CaptureRequest.CONTROL_AF_TRIGGER_IDLE)
                    }
                    set(CaptureRequest.JPEG_ORIENTATION, 0)
                }.build()

                session!!.capture(request, object : CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(
                        session: CameraCaptureSession,
                        request: CaptureRequest,
                        result: TotalCaptureResult
                    ) {
                        resultRef.set(result)
                        resultLatch.countDown()
                    }

                    override fun onCaptureFailed(
                        session: CameraCaptureSession,
                        request: CaptureRequest,
                        failure: CaptureFailure
                    ) {
                        Log.w("JazzRecoveryPhoto", "Camera frame failed attempt=" + (attempt + 1) +
                            " reason=" + failure.reason)
                        resultLatch.countDown()
                    }
                }, handler)

                if (!resultLatch.await(5, TimeUnit.SECONDS)) {
                    return photoFailure("CAMERA_CAPTURE_RESULT_TIMEOUT", camera, captureStartedAt)
                }
                val frameResult = resultRef.get()
                    ?: return photoFailure("CAMERA_CAPTURE_RESULT_FAILED", camera, captureStartedAt)
                val frameBytes = imageQueue.poll(5, TimeUnit.SECONDS)
                    ?: return photoFailure("CAMERA_IMAGE_TIMEOUT", camera, captureStartedAt)

                selectedBytes = frameBytes
                selectedResult = frameResult
                val aeState = frameResult.get(CaptureResult.CONTROL_AE_STATE)
                val afState = frameResult.get(CaptureResult.CONTROL_AF_STATE)
                val aeReady = aeState == null ||
                    aeState == CaptureResult.CONTROL_AE_STATE_CONVERGED ||
                    aeState == CaptureResult.CONTROL_AE_STATE_LOCKED ||
                    aeState == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED
                val afReady = afMode == null || afState == null ||
                    afState == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED ||
                    afState == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED ||
                    afState == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED ||
                    afState == CaptureResult.CONTROL_AF_STATE_PASSIVE_UNFOCUSED

                Log.i("JazzRecoveryPhoto", "Camera metering camera=" + camera +
                    " attempt=" + (attempt + 1) + "/3 aeState=" + aeState +
                    " afState=" + afState +
                    " exposureNs=" + frameResult.get(CaptureResult.SENSOR_EXPOSURE_TIME) +
                    " iso=" + frameResult.get(CaptureResult.SENSOR_SENSITIVITY) +
                    " dimensions=" + size.width + "x" + size.height)

                if (aeReady && afReady) {
                    threeASettled = true
                    break
                }
            }

            val sourceBytes = selectedBytes
                ?: return photoFailure("CAMERA_CAPTURE_EMPTY", camera, captureStartedAt)
            if (!threeASettled) {
                Log.w("JazzRecoveryPhoto", "Auto-exposure/focus did not fully converge after 3 frames; using latest frame camera=" + camera)
            }
            val compressed = compressJpegWithinLimit(sourceBytes)
                ?: return photoFailure("PHOTO_COMPRESSION_FAILED_OR_TOO_LARGE", camera, captureStartedAt)
            Log.i("JazzRecoveryPhoto", "Capture ready camera=" + camera + " bytes=" + compressed.size +
                " sourceBytes=" + sourceBytes.size +
                " aeState=" + selectedResult?.get(CaptureResult.CONTROL_AE_STATE) +
                " exposureNs=" + selectedResult?.get(CaptureResult.SENSOR_EXPOSURE_TIME) +
                " iso=" + selectedResult?.get(CaptureResult.SENSOR_SENSITIVITY) +
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
        // Use a power-of-two sample that does not undershoot the target edge.
        // Rounding the ratio up here halved images just above 2560 px (for example 2700 px -> 1350 px).
        val sample = Integer.highestOneBit(maxOf(1, largest / jpegLongEdge)).coerceAtLeast(1)
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
            conn.connectTimeout = if (isPhotoResult) 10000 else 5000
            conn.readTimeout = if (isPhotoResult) 60000 else 8000
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
