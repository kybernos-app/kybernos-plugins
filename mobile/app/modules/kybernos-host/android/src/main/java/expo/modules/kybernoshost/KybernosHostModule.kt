package expo.modules.kybernoshost

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Same surface as the iOS module (see src/index.ts): start the engine, read its progress, log tail and exit code. */
class KybernosHostModule : Module() {
  private val context get() = appContext.reactContext?.applicationContext ?: throw IllegalStateException("no React context")
  private val config by lazy { LaunchConfig(context, appContext.currentActivity) }
  private val host by lazy { NodeHost(context, config) }

  override fun definition() = ModuleDefinition {
    Name("KybernosHost")

    Constants {
      mapOf<String, Any?>("selfTestDelay" to config.selfTestDelay, "selfTestHasKey" to config.modelKey.isNotEmpty(), "platform" to "android", "keepAliveRequested" to config.keepAlive)
    }

    Function("start") { port: Int, env: Map<String, String> -> host.start(port, env) }
    Function("status") { host.status() }
    Function("exitCode") { host.exitCode() }
    Function("logTail") { maxBytes: Int -> host.logTail(maxBytes) }
    // The engine's session cookie is named after its port, which is new at every launch: clear the old ones before the engine starts so they do not pile up until the header is too long (see the iOS module).
    AsyncFunction("clearWebSession") { promise: expo.modules.kotlin.Promise ->
      try { CookieManager.getInstance().removeAllCookies { promise.resolve(null) } } catch (e: Exception) { promise.resolve(null) }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    Function("startKeepAlive") { KeepAliveService.start(context) }
    Function("stopKeepAlive") { KeepAliveService.stop(context) }
    Function("keepAliveRunning") { KeepAliveService.running }
    Function("memory") {
      val info = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
      mapOf("footprintMb" to (Debug.getPss() / 1024).toInt(), "availableMb" to (info.availMem / 1048576).toInt(), "totalMb" to (info.totalMem / 1048576).toInt())
    }
    Function("writeSelfTestResult") { text: String -> host.writeSelfTestResult(text) }
  }
}
