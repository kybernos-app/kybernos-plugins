package expo.modules.kybernoshost

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
import androidx.core.content.ContextCompat

/** Keeps the process of the embedded engine alive, with a notification the person sees and can swipe to the app, while the app is in the background. It does nothing else: the engine runs in the
 *  app's own process (a native thread), the service only changes how the system treats that process (not cached, not frozen, not the first one killed when memory runs low).
 *  The person switches it on in the app's settings; the app starts it from the foreground (Android 12+ refuses to start it from the background). */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Automations in the background", NotificationManager.IMPORTANCE_LOW))
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setContentTitle("Kybernos is running")
      .setContentText("Your automations can run while the app is in the background. Open the app's settings to switch this off.")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, notification)
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() { running = false; super.onDestroy() }

  companion object {
    private const val CHANNEL = "kybernos-keepalive"
    private const val ID = 4201
    @Volatile var running = false
      private set

    fun start(context: Context) { ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java)) }
    fun stop(context: Context) { context.stopService(Intent(context, KeepAliveService::class.java)) }
  }
}
