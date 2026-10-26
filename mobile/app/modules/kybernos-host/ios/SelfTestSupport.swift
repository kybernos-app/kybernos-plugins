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

    /// A test build can carry a model key (Info.plist KBSelfTestAnthropicKey, or ANTHROPIC_API_KEY in the environment on a simulator). It becomes the engine's ANTHROPIC_API_KEY, and the
    /// payload's bootstrap seeds the Claude provider from it (mobile/payload/seed.mjs), so the automation can finish with a real answer.
    static func environment() -> [String: String] { delaySeconds != nil && hasKey ? ["ANTHROPIC_API_KEY": modelKey] : [:] }
}
