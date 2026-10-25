import Foundation

/// Watches the engine from the app: first-launch progress, the sign-in address the server prints, readiness, and a health check when the app comes back.
final class Supervisor {
    enum State: Equatable {
        case starting
        case unpacking(done: Int, total: Int)
        case booting
        case ready(URL)
        case failed(String)
    }

    private let host: NodeHost
    private var timer: Timer?
    private var probing = false
    private(set) var state: State = .starting { didSet { if state != oldValue { onChange?(state) } } }
    var onChange: ((State) -> Void)?

    init(host: NodeHost = .shared) { self.host = host }

    func begin() {
        NotificationCenter.default.addObserver(forName: NodeHost.exited, object: nil, queue: .main) { [weak self] n in
            guard let self else { return }
            let code = (n.userInfo?["code"] as? Int32) ?? -1
            self.timer?.invalidate()
            self.state = .failed("The engine stopped (exit \(code)). Close and reopen the app to start it again.")
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func tick() {
        if case .ready = state { return }
        if case .failed = state { return }
        if let url = signInURL() { probe(url) ; return }
        if let s = host.unpackStatus(), s.phase == "unpacking" { state = .unpacking(done: s.done, total: s.total) } else if host.unpackStatus() != nil { state = .booting }
    }

    /// `dsh web: http://127.0.0.1:PORT/?token=…` is printed once the server listens.
    private func signInURL() -> URL? {
        let tail = host.logTail()
        guard let r = tail.range(of: #"dsh web: (http://127\.0\.0\.1:\d+/[^\s]*)"#, options: .regularExpression) else { return nil }
        let line = String(tail[r]).replacingOccurrences(of: "dsh web: ", with: "")
        return URL(string: line)
    }

    private func probe(_ url: URL) {
        guard !probing else { return }
        probing = true
        var base = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        base.path = "/"; base.query = nil
        var req = URLRequest(url: base.url!); req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.probing = false
                // 401 is the server answering: it wants the sign-in address
                if let http = response as? HTTPURLResponse, [200, 401, 302].contains(http.statusCode) { self.timer?.invalidate(); self.state = .ready(url) }
            }
        }.resume()
    }

    /// When the app returns to the foreground: is the server still answering?
    func healthCheck(completion: @escaping (Bool) -> Void) {
        guard case .ready(let url) = state else { completion(false); return }
        var base = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        base.path = "/"; base.query = nil
        var req = URLRequest(url: base.url!); req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { _, response, _ in
            DispatchQueue.main.async { completion((response as? HTTPURLResponse) != nil) }
        }.resume()
    }
}
