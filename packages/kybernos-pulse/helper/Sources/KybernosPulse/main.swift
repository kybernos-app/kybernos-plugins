import AppKit
import UserNotifications

// Kybernos Pulse: the menu-bar half of the « Widget » module. It only READS `GET /kybernos-pulse/state` of the local DSH
// (names and counts of runs, nothing else), shows the Kybernos K with a count next to the Wi-Fi icon, lists what needs the person,
// posts a system banner when an automation ends, and brings the person back to Kybernos. It writes nothing to DSH.
//
//   KybernosPulse [--port 3080] [--lang fr|en] [--selftest state.json]

// MARK: - Arguments

struct Options {
    var port = Int(ProcessInfo.processInfo.environment["KYBERNOS_PORT"] ?? "") ?? 3080
    var selftest: String?
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

// MARK: - The app

final class PulseApp: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    private let port: Int
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
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
        item.menu = menu
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
                self.state = fresh
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
let delegate = PulseApp(port: options.port)
app.delegate = delegate
app.run()
