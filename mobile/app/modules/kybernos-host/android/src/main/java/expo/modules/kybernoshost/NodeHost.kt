package expo.modules.kybernoshost

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile

/** Runs the embedded Node once per process. The payload ships as APK assets; Node reads files, so the assets are copied out once per payload version first.
 *  Everything the engine needs is handed over by environment variables (see mobile/payload/bootstrap.mjs); its console goes to `log`. */
internal class NodeHost(private val context: Context, private val config: LaunchConfig) {
  private val support = File(context.filesDir, "Kybernos")
  private val boot = File(support, "boot")
  private val runtime = File(support, "runtime")
  private val home = File(support, "data")
  private val workspace = context.getExternalFilesDir("Kybernos") ?: File(support, "workspace")
  private val log = File(support, "node.log")
  private val files = listOf("payload.kbpack", "payload.json", "bootstrap.mjs", "kbpack.mjs")
  @Volatile private var started = false
  @Volatile private var failure: Int? = null

  /** True when this call began the start. False when Node already runs or the build has no payload. The copy and the start happen on a thread of their own. */
  @Synchronized
  fun start(port: Int): Boolean {
    if (started) return false
    if (context.assets.list("")?.contains("payload.kbpack") != true) return false
    started = true
    Thread({
      try { launch(port) } catch (e: Throwable) { log.appendText("kybernos: start failed: $e\n"); failure = 1002 }
    }, "node-launch").start()
    return true
  }

  private fun launch(port: Int) {
    for (d in listOf(support, boot, runtime, home, workspace)) d.mkdirs()
    log.writeText("")
    copyAssets()
    SelfTestSupport.prepareProvider(config, home)
    val env = mutableListOf(
      "KB_PAYLOAD=${File(boot, "payload.kbpack")}", "KB_MANIFEST=${File(boot, "payload.json")}", "KB_ROOT=$runtime", "KB_HOME=$home",
      "KB_WORKSPACE=$workspace", "KB_PORT=$port", "TMPDIR=${context.cacheDir}", "HOME=$home",
    )
    // a device that lets processes run can rehearse a phone that does not
    if (config.denySpawn) env.add("KYBERNOS_DENY_SPAWN=1")
    if (config.selfTestDelay != null && config.modelKey.isNotEmpty()) env.add("ANTHROPIC_API_KEY=${config.modelKey}")
    NodeNative.start(log.path, workspace.path, env.toTypedArray(), arrayOf("node", "--expose-internals", File(boot, "bootstrap.mjs").path))
  }

  /** Copies the four payload files out of the APK unless this payload version is already there (the sha256 of payload.json names it). */
  private fun copyAssets() {
    val manifest = context.assets.open("payload.json").use { String(it.readBytes()) }
    val version = JSONObject(manifest).optString("sha256")
    val marker = File(boot, ".version")
    if (marker.exists() && marker.readText() == version && files.all { File(boot, it).exists() }) return
    marker.delete()
    writeStatus("copying", 0, files.size)
    for ((i, name) in files.withIndex()) {
      val tmp = File(boot, "$name.tmp")
      context.assets.open(name).use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
      tmp.renameTo(File(boot, name))
      writeStatus("copying", i + 1, files.size)
    }
    marker.writeText(version)
  }

  private fun writeStatus(phase: String, done: Int, total: Int) {
    runtime.mkdirs()
    File(runtime, "status.json").writeText("""{"phase":"$phase","done":$done,"total":$total}""")
  }

  fun exitCode(): Int? {
    failure?.let { return it }
    val code = NodeNative.exitCode()
    return if (code == NodeNative.RUNNING) null else code
  }

  fun logTail(maxBytes: Int): String {
    if (!log.exists()) return ""
    RandomAccessFile(log, "r").use { f ->
      val size = f.length()
      val start = if (size > maxBytes) size - maxBytes else 0
      f.seek(start)
      val bytes = ByteArray((size - start).toInt())
      f.readFully(bytes)
      return String(bytes, Charsets.UTF_8)
    }
  }

  /** Progress written by bootstrap.mjs (or the copy step above): { phase, done, total }. */
  fun status(): Map<String, Any> {
    return try {
      val o = JSONObject(File(runtime, "status.json").readText())
      mapOf("phase" to o.getString("phase"), "done" to o.optInt("done", 0), "total" to o.optInt("total", 0))
    } catch (_: Exception) { mapOf("phase" to "none", "done" to 0, "total" to 0) }
  }

  /** In the app's external files folder, which `adb shell` can read on a release build (run-as needs a debuggable one): /sdcard/Android/data/<package>/files/selftest-result.json. */
  fun writeSelfTestResult(text: String) {
    val dir = context.getExternalFilesDir(null) ?: support
    dir.mkdirs()
    File(dir, "selftest-result.json").writeText(text)
  }
}
