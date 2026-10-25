package expo.modules.kybernoshost

import java.io.File

internal object SelfTestSupport {
  /** A test build with a model key gets a `claude` provider in the user patch layer of a fresh profile, so the automation can finish with a real answer. Called before Node starts. */
  fun prepareProvider(config: LaunchConfig, home: File) {
    if (config.selfTestDelay == null || config.modelKey.isEmpty()) return
    val profile = File(home, ".dsh/profiles/web").apply { mkdirs() }
    val patch = File(profile, "cordis.patch.yml")
    if (patch.exists()) return
    patch.writeText(
      """
      - id: agent-default-model
        config:
          provider: claude
          model: claude-haiku-5-5
      - id: llm-pi-ai
        config:
          providers:
            claude:
              displayName: Claude
              api: anthropic-messages
              baseURL: https://api.anthropic.com
              apiKeyEnv: ANTHROPIC_API_KEY
              models:
                - id: claude-haiku-5-5
                  name: Claude Haiku 5.5
                  contextWindow: 200000
                  maxTokens: 1024
                  input:
                    - text

      """.trimIndent()
    )
  }
}
