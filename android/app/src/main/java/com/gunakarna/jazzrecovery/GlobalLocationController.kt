package com.gunakarna.jazzrecovery

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/**
 * Best-effort global Location switch.
 * Device-owner policy is the supported API on Android 11+. On ordinary devices,
 * the legacy secure-setting write is attempted only when the user has explicitly
 * granted WRITE_SECURE_SETTINGS via ADB/device management. Every write is verified.
 */
object GlobalLocationController {
    fun isEnabled(context: Context): Boolean = runCatching {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.isLocationEnabled
        else manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }.getOrDefault(false)

    fun setEnabled(context: Context, enabled: Boolean): JSONObject {
        val result = JSONObject().put("requestedEnabled", enabled)
        try {
            val policy = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && policy.isDeviceOwnerApp(context.packageName)) {
                policy.setLocationEnabled(context.adminComponentOrNull(), enabled)
            } else {
                val granted = context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!granted) {
                    return result.put("ok", false)
                        .put("locationServices", if (isEnabled(context)) "ON" else "OFF")
                        .put("error", "WRITE_SECURE_SETTINGS_NOT_GRANTED_OR_DEVICE_OWNER_REQUIRED")
                        .put("message", "Android does not allow this app to change the global Location switch. Grant WRITE_SECURE_SETTINGS with ADB where supported, or use a device-owner-managed device.")
                }
                val value = if (enabled) Settings.Secure.LOCATION_MODE_HIGH_ACCURACY else Settings.Secure.LOCATION_MODE_OFF
                val written = Settings.Secure.putInt(context.contentResolver, Settings.Secure.LOCATION_MODE, value)
                if (!written) {
                    return result.put("ok", false)
                        .put("locationServices", if (isEnabled(context)) "ON" else "OFF")
                        .put("error", "SECURE_SETTING_WRITE_REJECTED")
                }
            }
            val actual = isEnabled(context)
            return result.put("ok", actual == enabled)
                .put("locationServices", if (actual) "ON" else "OFF")
                .put("error", if (actual == enabled) JSONObject.NULL else "LOCATION_STATE_NOT_CONFIRMED")
        } catch (e: SecurityException) {
            return result.put("ok", false)
                .put("locationServices", if (isEnabled(context)) "ON" else "OFF")
                .put("error", "SECURITY_EXCEPTION")
                .put("message", e.message ?: "Android denied the Location switch change")
        } catch (e: Exception) {
            return result.put("ok", false)
                .put("locationServices", if (isEnabled(context)) "ON" else "OFF")
                .put("error", e.javaClass.simpleName)
        }
    }

    private fun Context.adminComponentOrNull(): android.content.ComponentName? = null
}
