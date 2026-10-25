import ExpoModulesCore
import MachO
import UIKit
import os
import UserNotifications
import WebKit

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

        Function("start") { (port: Int, env: [String: String]) -> Bool in NodeHost.shared.start(port: port, extraEnv: env) }
        Function("status") { () -> [String: Any] in NodeHost.shared.unpackStatus() }
        Function("exitCode") { () -> Int? in NodeHost.shared.currentExitCode().map { Int($0) } }
        Function("logTail") { (maxBytes: Int) -> String in NodeHost.shared.logTail(maxBytes: maxBytes) }
        // The engine's session cookie is named after its port, and the port is new at every launch: left alone, one more `dsh-auth-*` cookie piles up for 127.0.0.1 at each start until the
        // header passes the engine's and the guards' size limits (about 35 launches in 24 h) and every signed write is refused. Called before the engine starts (the web view does not exist yet).
        AsyncFunction("clearWebSession") { (promise: Promise) in
            DispatchQueue.main.async {
                HTTPCookieStorage.shared.cookies?.forEach { HTTPCookieStorage.shared.deleteCookie($0) }
                WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: Date(timeIntervalSince1970: 0)) { promise.resolve(nil) }
            }
        }
        // iOS cannot run an automation while the app is suspended: it can tell the person that one is due, so they open the app and it runs (the engine catches up on return)
        AsyncFunction("requestReminderPermission") { (promise: Promise) in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in promise.resolve(granted) }
        }
        AsyncFunction("setReminders") { (items: [[String: Any]], promise: Promise) in
            let center = UNUserNotificationCenter.current()
            center.removeAllPendingNotificationRequests() // every pending notification of this app is one of these
            let now = Date().timeIntervalSince1970 * 1000
            var count = 0
            for item in items.prefix(60) {
                guard let id = item["id"] as? String, let title = item["title"] as? String, let body = item["body"] as? String,
                      let at = (item["at"] as? NSNumber)?.doubleValue, at > now + 1000 else { continue }
                let content = UNMutableNotificationContent()
                content.title = title; content.body = body; content.sound = .default
                center.add(UNNotificationRequest(identifier: "kb-task-" + id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: (at - now) / 1000, repeats: false)))
                count += 1
            }
            promise.resolve(count)
        }
        Function("memory") { () -> [String: Int] in
            // phys_footprint is the figure the system's memory-pressure killer (jetsam) counts against the app
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
            let kr = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) } }
            let footprint = kr == KERN_SUCCESS ? Int(info.phys_footprint / 1_048_576) : -1
            return ["footprintMb": footprint, "availableMb": Int(os_proc_available_memory() / 1_048_576), "totalMb": Int(ProcessInfo.processInfo.physicalMemory / 1_048_576)]
        }
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
