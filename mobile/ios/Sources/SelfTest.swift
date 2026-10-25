import UIKit

/// A test hook for device clouds, present only in builds made with SELFTEST_DELAY=<seconds> (Info.plist key KBSelfTestTaskDelay; the KB_SELFTEST_TASK_DELAY
/// environment variable does the same on a simulator). Once the server answers, the app signs in with the address the server printed, creates a one-off
/// automation through the same route the interface uses, then shows the automation's state in a small native label ("selftest") that a remote driver can read.
/// A product build has neither the key nor the overlay.
final class SelfTest {
    static var delaySeconds: Int? {
        if let n = Bundle.main.object(forInfoDictionaryKey: "KBSelfTestTaskDelay") as? NSNumber { return n.intValue }
        return Int(ProcessInfo.processInfo.environment["KB_SELFTEST_TASK_DELAY"] ?? "")
    }

    /// Builds with the hook can carry a model key (Info.plist KBSelfTestAnthropicKey, or ANTHROPIC_API_KEY in the environment on a simulator). It goes into the engine's environment and
    /// a `claude` provider is written into the user patch layer of a fresh profile, so the automation can finish with a real answer. Called before Node starts.
    static func prepareProvider(home: URL) {
        guard delaySeconds != nil else { return }
        let key = (Bundle.main.object(forInfoDictionaryKey: "KBSelfTestAnthropicKey") as? String) ?? ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] ?? ""
        guard !key.isEmpty else { return }
        setenv("ANTHROPIC_API_KEY", key, 1)
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

    private static var hasKey: Bool { ((Bundle.main.object(forInfoDictionaryKey: "KBSelfTestAnthropicKey") as? String) ?? ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] ?? "").isEmpty == false }
    /// With a model key the automation asks a question whose answer is not in the prompt, so the answer can be found in the chat afterwards.
    private static let question = "What is the capital of Australia? Reply with the single word."
    private static let answer = "Canberra"

    private let signIn: URL
    private let base: URL
    private let label = UILabel()
    private let session = URLSession(configuration: .default)
    private var taskId: String?
    private var due = ""
    private var timer: Timer?

    init(signIn: URL) {
        self.signIn = signIn
        var c = URLComponents(url: signIn, resolvingAgainstBaseURL: false)!
        c.path = ""; c.query = nil
        self.base = c.url!
    }

    func attach(to view: UIView) {
        label.accessibilityIdentifier = "selftest"
        label.isAccessibilityElement = true
        label.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
        label.textColor = .white
        label.backgroundColor = UIColor.black.withAlphaComponent(0.7)
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        show("selftest: waiting")
    }

    func start(delay: Int) {
        show("selftest: signing in")
        session.dataTask(with: signIn) { [weak self] _, _, _ in self?.create(delay: delay) }.resume()
    }

    private func show(_ text: String) { DispatchQueue.main.async { self.label.text = text } }

    private func post(_ body: [String: Any], done: @escaping ([String: Any]?) -> Void) {
        var req = URLRequest(url: base.appendingPathComponent("kybernos/tasks"))
        req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(base.absoluteString, forHTTPHeaderField: "Origin")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: req) { data, _, _ in
            done(data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        }.resume()
    }

    private func create(delay: Int) {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        let at = f.string(from: Date().addingTimeInterval(TimeInterval(delay)))
        due = String(at.suffix(5))
        let task: [String: Any] = ["name": "selftest", "prompt": SelfTest.hasKey ? SelfTest.question : "Reply with the single word TICKED", "schedule": ["mode": "once", "at": at, "tz": "UTC"], "approvals": "ask"]
        post(["action": "create", "task": task]) { [weak self] r in
            guard let self else { return }
            guard let t = r?["task"] as? [String: Any], let id = t["id"] as? String else { self.show("selftest: create failed " + String(describing: r?["error"])); return }
            self.taskId = id
            self.show("selftest: created, due \(self.due) UTC")
            DispatchQueue.main.async { self.timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in self.poll() } }
        }
    }

    private func poll() {
        guard let id = taskId else { return }
        post(["action": "list"]) { [weak self] r in
            guard let self, let tasks = r?["tasks"] as? [[String: Any]], let t = tasks.first(where: { ($0["id"] as? String) == id }) else { return }
            let hist = (t["history"] as? [[String: Any]]) ?? []
            if let h = hist.last {
                let at = (h["at"] as? String).map { String($0.dropFirst(11).prefix(8)) } ?? "?"
                let err = (h["error"] as? String).map { " | " + String($0.prefix(60)) } ?? ""
                let line = "selftest: due \(self.due) UTC | \(h["status"] as? String ?? "?") at \(at) UTC\(err)"
                self.show(line)
                if SelfTest.hasKey, (h["status"] as? String) == "fired", let sid = h["sessionId"] as? String { self.lookForAnswer(sid: sid, line: line) }
            } else {
                self.show("selftest: created, due \(self.due) UTC | waiting")
            }
        }
    }

    private func lookForAnswer(sid: String, line: String) {
        var c = URLComponents(url: base.appendingPathComponent("kybernos/search-content"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "q", value: SelfTest.answer), URLQueryItem(name: "sessionId", value: sid)]
        var req = URLRequest(url: c.url!); req.timeoutInterval = 20
        req.setValue(base.absoluteString, forHTTPHeaderField: "Origin")
        session.dataTask(with: req) { [weak self] data, _, _ in
            guard let self else { return }
            let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
            let hits = text.lowercased().components(separatedBy: SelfTest.answer.lowercased()).count - 1
            let fromAssistant = text.contains("assistant")
            self.show(line + " | answer check: \"\(SelfTest.answer)\" found \(hits)x\(fromAssistant ? ", from the assistant" : "")")
        }.resume()
    }
}
