package expo.modules.kybernoshost

import android.app.Activity
import android.content.Context
import org.json.JSONObject

/** The device-cloud self-test and the rehearsal switches. A product build has none of them. Sources, in order: the launch intent's extras (adb: `am start --ei kb_selftest_delay 75 --es kb_deny_spawn 1`),
 *  then the optional asset `kb-selftest.json` ({ "delay": 90, "key": "sk-ant-..." }) that mobile/devicecloud adds to a private copy of the APK for a device-cloud run, where no intent can be sent.
 *  The iOS build reads the same two values from its Info.plist (KBSelfTestTaskDelay, KBSelfTestAnthropicKey). */
internal class LaunchConfig(context: Context, activity: Activity?) {
  private val extras = activity?.intent?.extras
  private val asset: JSONObject? = try { context.assets.open("kb-selftest.json").use { JSONObject(String(it.readBytes())) } } catch (_: Exception) { null }

  val selfTestDelay: Int? = when {
    extras?.containsKey("kb_selftest_delay") == true -> extras.getInt("kb_selftest_delay")
    asset != null && asset.has("delay") -> asset.optInt("delay")
    else -> null
  }
  val modelKey: String = asset?.optString("key") ?: ""
  val denySpawn: Boolean = extras?.getString("kb_deny_spawn") == "1"
}
