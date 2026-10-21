package com.gunakarna.jazzrecovery

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules a persistent, network-constrained heartbeat fallback.
 * The owner-enabled foreground recovery agent is still required for fast polling.
 */
class JazzRecoveryApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<RecoveryHeartbeatWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "jazz-recovery-heartbeat-fallback",
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }
}
