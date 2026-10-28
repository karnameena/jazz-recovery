package com.gunakarna.jazzrecovery

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID

/**
 * Small BLE transport for short-lived Jazz Recovery beacon tokens.
 * It never derives a target's exact coordinates; scans only report token + RSSI.
 */
class LocationHelperBle(private val context: Context) {
    companion object {
        val SERVICE_UUID: UUID = UUID.fromString("9a6b2f40-3e21-4d65-8c9a-54a2f0b173e1")
    }

    private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanner: android.bluetooth.le.BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null

    fun startAdvertising(token: ByteArray): Boolean {
        if (token.size != 10) return false
        if (android.os.Build.VERSION.SDK_INT >= 31 &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) return false
        stopAdvertising()
        val adapter = adapter() ?: return false
        val target = runCatching { adapter.bluetoothLeAdvertiser }.getOrNull() ?: return false
        val uuid = ParcelUuid(SERVICE_UUID)
        val data = runCatching {
            AdvertiseData.Builder().addServiceData(uuid, token).setIncludeDeviceName(false).build()
        }.getOrNull() ?: return false
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_LOW)
            .setConnectable(false)
            .build()
        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                Log.i("JazzRecoveryBLE", "Short-lived location beacon advertising started")
            }
            override fun onStartFailure(errorCode: Int) {
                Log.w("JazzRecoveryBLE", "Beacon advertising unavailable code=" + errorCode)
            }
        }
        return try {
            target.startAdvertising(settings, data, callback)
            advertiser = target
            advertiseCallback = callback
            true
        } catch (_: SecurityException) { false }
        catch (_: Exception) { false }
    }

    fun stopAdvertising() {
        val a = advertiser
        val cb = advertiseCallback
        if (a != null && cb != null) runCatching { a.stopAdvertising(cb) }
        advertiser = null
        advertiseCallback = null
    }

    fun startScanning(onBeacon: (ByteArray, Int) -> Unit): Boolean {
        if (scanCallback != null) return true
        if (android.os.Build.VERSION.SDK_INT >= 31 &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) return false
        val target = runCatching { adapter()?.bluetoothLeScanner }.getOrNull() ?: return false
        val uuid = ParcelUuid(SERVICE_UUID)
        val filter = ScanFilter.Builder().setServiceData(uuid, byteArrayOf()).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val token = result.scanRecord?.getServiceData(uuid) ?: return
                if (token.size == 10) onBeacon(token.clone(), result.rssi)
            }
            override fun onScanFailed(errorCode: Int) {
                Log.w("JazzRecoveryBLE", "Helper scan unavailable code=" + errorCode)
            }
        }
        return try {
            target.startScan(listOf(filter), settings, callback)
            scanner = target
            scanCallback = callback
            true
        } catch (_: SecurityException) { false }
        catch (_: Exception) { false }
    }

    fun stopScanning() {
        val s = scanner
        val cb = scanCallback
        if (s != null && cb != null) runCatching { s.stopScan(cb) }
        scanner = null
        scanCallback = null
    }

    private fun adapter(): BluetoothAdapter? =
        runCatching { (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter }
            .getOrNull()?.takeIf { it.isEnabled }
}
