package expo.modules.kybernoshost

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
      mapOf<String, Any?>("selfTestDelay" to config.selfTestDelay, "selfTestHasKey" to config.modelKey.isNotEmpty(), "platform" to "android")
    }

    Function("start") { port: Int -> host.start(port) }
    Function("status") { host.status() }
    Function("exitCode") { host.exitCode() }
    Function("logTail") { maxBytes: Int -> host.logTail(maxBytes) }
    Function("writeSelfTestResult") { text: String -> host.writeSelfTestResult(text) }
  }
}
