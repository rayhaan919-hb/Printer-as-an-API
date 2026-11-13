package com.printerapi.agent.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.printerapi.agent.MainActivity
import com.printerapi.agent.R

/**
 * Android Foreground Service (`foregroundServiceType="connectedDevice"`) maintaining the
 * persistent thermal relay WebSocket connection, notification bar status, and offline queue flush.
 */
class PrintAgentForegroundService : Service() {

    companion object {
        const val ACTION_START = "com.printerapi.agent.action.START"
        const val ACTION_STOP = "com.printerapi.agent.action.STOP"
        const val ACTION_FLUSH_QUEUE = "com.printerapi.agent.action.FLUSH_QUEUE"
        const val ACTION_TEST_PRINT = "com.printerapi.agent.action.TEST_PRINT"
        private const val NOTIFICATION_ID = 1042

        fun startService(context: Context) {
            val intent = Intent(context, PrintAgentForegroundService::class.java).apply {
                action = ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, PrintAgentForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        fun flushQueue(context: Context) {
            val intent = Intent(context, PrintAgentForegroundService::class.java).apply {
                action = ACTION_FLUSH_QUEUE
            }
            context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        AgentRuntimeController.ensureInitialized(applicationContext)
        createNotificationChannelIfNeeded()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                AgentRuntimeController.disconnectRelay()
                AgentRuntimeController.setServiceRunning(false)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_FLUSH_QUEUE -> {
                promoteToForeground()
                AgentRuntimeController.flushPendingQueue()
                return START_STICKY
            }
            ACTION_TEST_PRINT -> {
                promoteToForeground()
                AgentRuntimeController.triggerTestPrint()
                return START_STICKY
            }
            else -> {
                if (promoteToForeground()) {
                    AgentRuntimeController.setServiceRunning(true)
                    AgentRuntimeController.connectRelay()
                    AgentRuntimeController.flushPendingQueue()
                }
                return START_STICKY
            }
        }
    }

    override fun onDestroy() {
        AgentRuntimeController.disconnectRelay()
        AgentRuntimeController.setServiceRunning(false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun promoteToForeground(): Boolean {
        val notification = buildNotification()
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            true
        } catch (sec: SecurityException) {
            AgentRuntimeController.reportServiceError(
                sec.message ?: "Bluetooth / Connected Device permission required for Foreground Service"
            )
            stopSelf()
            false
        }
    }

    private fun createNotificationChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                getString(R.string.service_channel_id),
                getString(R.string.service_channel_name),
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    @Suppress("DEPRECATION")
    private fun buildNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val isOnline = AgentRuntimeController.currentState().isWsConnected
        val contentText = if (isOnline) {
            getString(R.string.service_notification_connected)
        } else {
            getString(R.string.service_notification_offline)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, getString(R.string.service_channel_id))
        } else {
            Notification.Builder(this)
        }
        return builder
            .setContentTitle(getString(R.string.service_notification_title))
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
