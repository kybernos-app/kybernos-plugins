package expo.modules.kybernoshost

internal object NodeNative {
  const val RUNNING = -1000

  init { System.loadLibrary("kybernos_node") }

  /** Starts Node once per process on a thread with a 16 MB stack. False when it already runs. */
  @JvmStatic external fun start(logPath: String, cwd: String, environment: Array<String>, arguments: Array<String>): Boolean

  /** The exit code of Node, or RUNNING. */
  @JvmStatic external fun exitCode(): Int
}
