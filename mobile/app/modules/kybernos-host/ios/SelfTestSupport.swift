import Foundation

/// The native half of the device-cloud self-test (the flow itself is TypeScript, src/selftest.ts). Present only in builds made with the Info.plist key KBSelfTestTaskDelay
/// (the KB_SELFTEST_TASK_DELAY environment variable does the same on a simulator); a product build has neither.
enum SelfTestSupport {
    static var delaySeconds: Int? {
        if let n = Bundle.main.object(forInfoDictionaryKey: "KBSelfTestTaskDelay") as? NSNumber { return n.intValue }
        return Int(ProcessInfo.processInfo.environment["KB_SELFTEST_TASK_DELAY"] ?? "")
    }

    static var hasKey: Bool { modelKey.isEmpty == false }
    private static var modelKey: String { (Bundle.main.object(forInfoDictionaryKey: "KBSelfTestAnthropicKey") as? String) ?? ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] ?? "" }

    /// Builds with the hook can carry a model key (Info.plist KBSelfTestAnthropicKey, or ANTHROPIC_API_KEY in the environment on a simulator). It goes into the engine's environment and
    /// a `claude` provider is written into the user patch layer of a fresh profile, so the automation can finish with a real answer. Called before Node starts.
    static func prepareProvider(home: URL) {
        guard delaySeconds != nil, hasKey else { return }
        setenv("ANTHROPIC_API_KEY", modelKey, 1)
        let profile = home.appendingPathComponent(".dsh/profiles/web", isDirectory: true)
        try? FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
        let patch = profile.appendingPathComponent("cordis.patch.yml")
        guard !FileManager.default.fileExists(atPath: patch.path) else { return }
        let yaml = """
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

        """
        try? yaml.write(to: patch, atomically: true, encoding: .utf8)
    }
}
