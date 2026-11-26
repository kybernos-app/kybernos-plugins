import AppKit
import UserNotifications
import WebKit

// Kybernos Pulse: the menu-bar half of the « Widget » module. It reads `GET /kybernos-pulse/state` of the local DSH (names and counts of
// runs, nothing else), shows the Kybernos K with a count next to the Wi-Fi icon, posts a system banner when an automation ends, and brings the
// person back to Kybernos. A click on the K opens the panel of the floating window: the host serves that page (`/kybernos-pulse/panel`, drawn
// by the same code as the floating window) and the app only shows it in a web view. The app itself sends no write: the page does, with the
// app's own token (a file only the owner can read), and only for the plugin's two writes (mark read, dismiss, quiet).
//
//   KybernosPulse [--port 3080] [--lang fr|en] [--selftest state.json] [--panelcheck]
//   --panelcheck loads the panel page of the local DSH in the real web view, clicks its first arrow, prints what it saw as JSON and quits (no icon).

// MARK: - Arguments

struct Options {
    var port = Int(ProcessInfo.processInfo.environment["KYBERNOS_PORT"] ?? "") ?? 3080
    var selftest: String?
    var panelcheck = false
}

func parseOptions() -> Options {
    var o = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    while let a = args.first {
        args.removeFirst()
        switch a {
        case "--port": if let v = args.first, let n = Int(v), (1...65535).contains(n) { o.port = n; args.removeFirst() }
        case "--lang": if let v = args.first { Words.forced = v.lowercased().hasPrefix("fr"); args.removeFirst() }
        case "--selftest": if let v = args.first { o.selftest = v; args.removeFirst() }
        case "--panelcheck": o.panelcheck = true
        default: break
        }
    }
    return o
}

let options = parseOptions()

// MARK: - Self-test: the menu a state file would give, as JSON (no window, no network)

if let path = options.selftest {
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let state = try JSONDecoder().decode(PulseState.self, from: data)
        let due = bannersDue(state, shown: [])
        let out: [String: Any] = [
            "headline": headline(state),
            "badge": badgeText(state),
            "tone": worstTone(state).rawValue,
            "rows": rows(state).map { ["id": $0.id, "tone": $0.tone.rawValue, "title": $0.title, "subtitle": $0.subtitle] },
            "banners": due.map { ["id": $0.id, "title": bannerTitle($0), "body": bannerBody($0)] },
            "offline": headline(nil)
        ]
        let json = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
        print(String(data: json, encoding: .utf8) ?? "")
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("selftest failed: \(error)\n".utf8))
        exit(1)
    }
}

// MARK: - The panel: the page of the plugin, in a web view

/// The app's token for the plugin's two writes: a file in the DSH folder that only its owner can read (0600).
func readHelperToken() -> String? {
    let env = ProcessInfo.processInfo.environment
    let home = env["DSH_HOME"] ?? (NSHomeDirectory() + "/.dsh")
    guard let raw = try? String(contentsOfFile: home + "/kybernos/pulse/helper.token", encoding: .utf8) else { return nil }
    let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil ? token : nil
}

final class PanelView: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let controller = NSViewController()
    private let webView: WKWebView
    private let base: URL
    private let onAct: (String) -> Void
    private var loaded = false

    init(base: URL, onAct: @escaping (String) -> Void) {
        self.base = base
        self.onAct = onAct
        let content = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 380, height: 580), configuration: config)
        super.init()
        content.add(self, name: "pulse")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        controller.view = webView
    }

    private var pageURL: URL {
        var c = URLComponents(url: base.appendingPathComponent("kybernos-pulse/panel"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "lang", value: Words.isFrench() ? "fr" : "en")]
        return c.url!
    }

    /// The token goes into the page of this app's own address, and only there (the navigation is held to that address below).
    private func putToken() {
        guard let t = readHelperToken() else { return }
        webView.evaluateJavaScript("window.__PULSE_TOKEN__ = \"\(t)\"; window.__pulseRefresh && window.__pulseRefresh()", completionHandler: nil)
    }

    /// For `--panelcheck`: runs a script in the page and hands back its result.
    func evaluate(_ js: String, _ done: @escaping (Any?) -> Void) { webView.evaluateJavaScript(js) { result, _ in done(result) } }

    func reload() { loaded = false; webView.load(URLRequest(url: pageURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)) }

    func willShow() {
        if loaded { putToken() } else { reload() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded = true; putToken() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loaded = false }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loaded = false }

    /// Only this app's own address is ever shown here; anything else goes to the browser and the token never meets it.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == base.host, url.port == base.port { decisionHandler(.allow); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let act = body["act"] as? String else { return }
        onAct(act)
    }
}

// MARK: - The app

final class PulseApp: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    private let port: Int
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let popover = NSPopover()
    private var panel: PanelView?
    private var state: PulseState?
    private var timer: Timer?
    private var bannersAllowed = false
    private var inFlight = false
    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 3
        c.timeoutIntervalForResource = 5
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()
    /// Banners this app already put up, kept across restarts so that opening the app again does not repeat them.
    private let shownKey = "bannersShown"
    private var shown: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: shownKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue.suffix(300)), forKey: shownKey) }
    }

    init(port: Int) {
        self.port = port
        super.init()
    }

    private var base: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.imagePosition = .imageLeft
        item.button?.toolTip = "Kybernos"
        menu.delegate = self
        menu.autoenablesItems = false
        // A click on the K opens the panel; a right click (or a click while DSH is not running) opens the small menu.
        item.button?.target = self
        item.button?.action = #selector(statusClicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        let view = PanelView(base: base, onAct: { [weak self] act in self?.panelAct(act) })
        panel = view
        popover.contentViewController = view.controller
        popover.contentSize = NSSize(width: 380, height: 580)
        popover.behavior = .transient
        redraw()
        askForBanners()
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refresh() }
    }

    // MARK: Reading the plugin

    private func refresh() {
        guard !inFlight else { return }
        inFlight = true
        var request = URLRequest(url: base.appendingPathComponent("kybernos-pulse/state"))
        request.setValue("v1; banners=\(bannersAllowed ? "ok" : "off")", forHTTPHeaderField: "X-Kybernos-Helper")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { [weak self] data, response, _ in
            var fresh: PulseState?
            if let data = data, let http = response as? HTTPURLResponse, http.statusCode == 200 {
                fresh = try? JSONDecoder().decode(PulseState.self, from: data)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.inFlight = false
                let cameBack = self.state == nil && fresh != nil
                self.state = fresh
                if cameBack { self.panel?.reload() }
                self.redraw()
                if let s = fresh { self.postBanners(s) }
            }
        }.resume()
    }

    // MARK: The icon and the menu

    private func redraw() {
        let tone = worstTone(state)
        item.button?.image = brandImage(height: 17, dim: state == nil, dot: dotColor(tone))
        let badge = badgeText(state)
        item.button?.title = badge.isEmpty ? "" : " " + badge
        buildMenu()
    }

    private func twoLines(_ a: String, _ b: String) -> NSAttributedString {
        let s = NSMutableAttributedString(string: a, attributes: [.font: NSFont.menuFont(ofSize: 0)])
        s.append(NSAttributedString(string: "\n" + b, attributes: [.font: NSFont.menuFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]))
        return s
    }

    private func symbol(_ tone: Tone) -> NSImage? {
        let (name, color): (String, NSColor)
        switch tone {
        case .bad: (name, color) = ("exclamationmark.triangle.fill", .systemRed)
        case .ask: (name, color) = ("hand.raised.fill", .systemOrange)
        case .run: (name, color) = ("arrow.triangle.2.circlepath", .systemBlue)
        case .ok: (name, color) = ("checkmark.circle.fill", .systemGreen)
        case .idle: (name, color) = ("moon.zzz.fill", .secondaryLabelColor)
        }
        let config = NSImage.SymbolConfiguration(paletteColors: [color])
        return NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
    }

    private func buildMenu() {
        menu.removeAllItems()
        let head = NSMenuItem(title: headline(state), action: nil, keyEquivalent: "")
        head.attributedTitle = NSAttributedString(string: headline(state), attributes: [.font: NSFont.boldSystemFont(ofSize: 13)])
        head.isEnabled = false
        menu.addItem(head)
        if let s = state {
            let list = rows(s)
            if !list.isEmpty { menu.addItem(.separator()) }
            for r in list {
                let m = NSMenuItem(title: r.title, action: #selector(openKybernos), keyEquivalent: "")
                m.target = self
                m.attributedTitle = twoLines(r.title, r.subtitle)
                m.image = symbol(r.tone)
                menu.addItem(m)
            }
            if list.isEmpty {
                let m = NSMenuItem(title: Words.t("Rien pour l’instant", "Nothing yet"), action: nil, keyEquivalent: "")
                m.isEnabled = false
                menu.addItem(m)
            }
        } else {
            let m = NSMenuItem(title: Words.t("Lance DSH pour voir tes automations ici.", "Start DSH to see your automations here."), action: nil, keyEquivalent: "")
            m.isEnabled = false
            menu.addItem(m)
        }
        menu.addItem(.separator())
        let open = NSMenuItem(title: Words.t("Ouvrir Kybernos", "Open Kybernos"), action: #selector(openKybernos), keyEquivalent: "o")
        open.target = self
        open.isEnabled = state != nil
        menu.addItem(open)
        let quit = NSMenuItem(title: Words.t("Quitter Kybernos Pulse", "Quit Kybernos Pulse"), action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    func menuWillOpen(_ menu: NSMenu) { refresh() }

    @objc private func statusClicked() {
        let right = NSApp.currentEvent?.type == .rightMouseUp
        guard let button = item.button else { return }
        if right || state == nil {
            popover.performClose(nil)
            buildMenu()
            item.menu = menu
            button.performClick(nil)
            item.menu = nil
            return
        }
        if popover.isShown { popover.performClose(nil); return }
        panel?.willShow()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// What the panel page asks of the app: bring the person to Kybernos, or close the panel. Nothing else is accepted.
    private func panelAct(_ act: String) {
        switch act {
        case "open", "settings": popover.performClose(nil); NSWorkspace.shared.open(base)
        case "close": popover.performClose(nil)
        default: break
        }
    }

    @objc private func openKybernos() { NSWorkspace.shared.open(base) }
    @objc private func quitApp() { NSApp.terminate(nil) }

    // MARK: System banners

    private func askForBanners() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert]) { [weak self] granted, _ in
            DispatchQueue.main.async { self?.bannersAllowed = granted }
        }
    }

    private func postBanners(_ s: PulseState) {
        guard bannersAllowed, s.settings.banners else { return }
        let due = bannersDue(s, shown: shown)
        guard !due.isEmpty else { return }
        var done = shown
        for it in due {
            let content = UNMutableNotificationContent()
            content.title = bannerTitle(it)
            content.body = bannerBody(it)
            let request = UNNotificationRequest(identifier: "kybernos-pulse:" + it.id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { _ in }
            done.insert(it.id)
        }
        shown = done
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        openKybernos()
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner])
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

if options.panelcheck {
    // The page, in the real web view, the way the panel shows it: what it drew, whether its arrow reaches the app, whether it got the token.
    let base = URL(string: "http://127.0.0.1:\(options.port)/")!
    var acts: [String] = []
    let view = PanelView(base: base, onAct: { acts.append($0) })
    view.reload()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        let probe = "JSON.stringify({ title: document.title, cards: document.querySelectorAll('[data-kb=\"pulse-card\"]').length, hero: (document.querySelector('.kbpu-hero h2') || {}).innerText || null, tabs: document.querySelectorAll('.kbpu-tab').length, text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240), token: typeof window.__PULSE_TOKEN__ === 'string' && window.__PULSE_TOKEN__.length === 64 })"
        view.evaluate(probe) { first in
            view.evaluate("(function () { var b = document.querySelector('[data-act=\"open\"]'); if (b) { b.click(); return true } return false })()") { clicked in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    let page = (first as? String).flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? NSNull()
                    let out: [String: Any] = ["page": page, "clicked": (clicked as? Bool) ?? false, "acts": acts]
                    if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) { print(String(data: data, encoding: .utf8) ?? "") }
                    exit(0)
                }
            }
        }
    }
    app.run()
} else {
    let delegate = PulseApp(port: options.port)
    app.delegate = delegate
    app.run()
}
