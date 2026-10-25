import ExpoModulesCore
import UIKit

/// JavaScript sees a thin surface: start the engine, read its progress, its log tail and its exit code. Everything that needs the app lifecycle lives here, not in JavaScript,
/// because iOS suspends the app soon after it leaves the screen and the JavaScript thread may already be stopped by then.
public class KybernosHostModule: Module {
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    public func definition() -> ModuleDefinition {
        Name("KybernosHost")

        Constants {
            [
                "selfTestDelay": SelfTestSupport.delaySeconds as Any,
                "selfTestHasKey": SelfTestSupport.hasKey,
                "platform": "ios",
            ]
        }

        Function("start") { (port: Int) -> Bool in NodeHost.shared.start(port: port) }
        Function("status") { () -> [String: Any] in NodeHost.shared.unpackStatus() }
        Function("exitCode") { () -> Int? in NodeHost.shared.currentExitCode().map { Int($0) } }
        Function("logTail") { (maxBytes: Int) -> String in NodeHost.shared.logTail(maxBytes: maxBytes) }
        Function("writeSelfTestResult") { (text: String) in
            try? FileManager.default.createDirectory(at: NodeHost.shared.paths.support, withIntermediateDirectories: true)
            try? text.write(to: NodeHost.shared.paths.selfTestResult, atomically: true, encoding: .utf8)
        }

        // iOS gives a few seconds of extra time when the app leaves the screen: ask for them, and give them back on the way in
        OnAppEntersBackground { [weak self] in
            guard let self else { return }
            self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "kybernos-finish") { [weak self] in
                guard let self else { return }
                UIApplication.shared.endBackgroundTask(self.backgroundTask); self.backgroundTask = .invalid
            }
        }
        OnAppEntersForeground { [weak self] in
            guard let self, self.backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(self.backgroundTask); self.backgroundTask = .invalid
        }
    }
}
