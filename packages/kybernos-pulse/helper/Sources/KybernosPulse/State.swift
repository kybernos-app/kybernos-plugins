import Foundation

// What the plugin answers on `GET /kybernos-pulse/state` (packages/kybernos-pulse/pulse-core.mjs, publicView).
// Only the fields read here are declared. `test-helper.mjs` checks that each one exists in a real answer of the plugin,
// so a rename on the plugin side fails a test instead of silently emptying the menu.
// CONTRACT-BEGIN
struct PulseItem: Decodable {
    let id: String
    let kind: String // done | failed | waiting
    let task: String
    let at: Double // epoch ms
    let unread: Bool
    let quiet: Bool?
    let durMs: Double?
    let calls: Double?
}

struct PulseRun: Decodable {
    let task: String
    let phase: String // running | waiting
    let startedAt: Double?
    let calls: Double?
}

struct PulseSettings: Decodable {
    let level: String
    let banners: Bool
    let badge: Bool
}

struct PulseState: Decodable {
    let settings: PulseSettings
    let inbox: [PulseItem]
    let running: [PulseRun]
    let unread: Int
    let banners: [String]
    let now: Double
}
// CONTRACT-END

// MARK: - Words (French when the Mac is set to French, English otherwise; the plugin's own rule)

enum Words {
    /// Set by `--lang fr|en` (the self-test uses it); nil follows the Mac.
    static var forced: Bool?
    static func isFrench() -> Bool { forced ?? (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("fr") }
    static func t(_ fr: String, _ en: String) -> String { isFrench() ? fr : en }
}

// MARK: - What the menu says

enum Tone: String { case ok, bad, ask, run, idle }

struct Row {
    let id: String
    let tone: Tone
    let title: String
    let subtitle: String
}

/// The sentence at the top of the menu.
func headline(_ state: PulseState?) -> String {
    guard let s = state else { return Words.t("Kybernos n’est pas lancé", "Kybernos is not running") }
    let need = s.inbox.filter { ($0.kind == "failed" || $0.kind == "waiting") && $0.unread }.count
    if need > 0 {
        if Words.isFrench() { return need == 1 ? "1 chose t’attend" : "\(need) choses t’attendent" }
        return need == 1 ? "1 thing needs you" : "\(need) things need you"
    }
    let going = s.running.filter { $0.phase == "running" }.count
    if going > 0 { return Words.isFrench() ? (going == 1 ? "1 en cours" : "\(going) en cours") : "\(going) running" }
    return Words.t("Tout est calme", "All quiet")
}

/// The count next to the icon: what is unread, when the person asked for a count. Empty when there is nothing to say.
func badgeText(_ state: PulseState?) -> String {
    guard let s = state, s.settings.badge, s.unread > 0 else { return "" }
    return s.unread > 99 ? "99+" : String(s.unread)
}

/// The worst thing going on, for the little dot on the icon.
func worstTone(_ state: PulseState?) -> Tone {
    guard let s = state else { return .idle }
    if s.inbox.contains(where: { $0.kind == "failed" && $0.unread }) { return .bad }
    if s.inbox.contains(where: { $0.kind == "waiting" && $0.unread }) { return .ask }
    if s.running.contains(where: { $0.phase == "running" }) { return .run }
    return .ok
}

func ago(_ at: Double, now: Double) -> String {
    let s = max(0, Int((now - at) / 1000))
    if s < 60 { return Words.t("à l’instant", "just now") }
    let m = s / 60
    if m < 60 { return Words.isFrench() ? "il y a \(m) min" : "\(m) min ago" }
    let h = m / 60
    if h < 24 { return Words.isFrench() ? "il y a \(h) h" : "\(h) h ago" }
    let d = h / 24
    return Words.isFrench() ? "il y a \(d) j" : "\(d) d ago"
}

func duration(_ ms: Double) -> String {
    let s = Int((ms / 1000).rounded())
    if s < 60 { return "\(max(1, s)) s" }
    let m = s / 60
    if m < 60 { return s % 60 == 0 ? "\(m) min" : "\(m) min \(s % 60) s" }
    return "\(m / 60) h \(m % 60) min"
}

private func word(_ kind: String) -> String {
    switch kind {
    case "failed": return Words.t("Échec", "Failed")
    case "waiting": return Words.t("Attend ton accord", "Waiting for you")
    default: return Words.t("Terminée", "Done")
    }
}

private func tone(_ kind: String) -> Tone {
    switch kind {
    case "failed": return .bad
    case "waiting": return .ask
    default: return .ok
    }
}

/// The rows of the menu: what is running, then what needs the person, then the results; at most `limit` of the inbox.
func rows(_ state: PulseState, limit: Int = 8) -> [Row] {
    var out: [Row] = []
    for r in state.running where r.phase == "running" {
        var bits = [Words.t("En cours", "Running")]
        if let n = r.calls, n > 0 { bits.append(Words.isFrench() ? "\(Int(n)) appels" : "\(Int(n)) calls") }
        if let t = r.startedAt { bits.append(duration(max(0, state.now - t))) }
        out.append(Row(id: "run:" + r.task, tone: .run, title: r.task, subtitle: bits.joined(separator: " · ")))
    }
    let todo = state.inbox.filter { $0.kind != "done" }.sorted { $0.at > $1.at }
    let done = state.inbox.filter { $0.kind == "done" }.sorted { $0.at > $1.at }
    for it in (todo + done).prefix(limit) {
        var bits = [word(it.kind), ago(it.at, now: state.now)]
        if it.kind == "done" {
            if let d = it.durMs, d > 0 { bits.append(duration(d)) }
            if let n = it.calls, n > 0 { bits.append(Words.isFrench() ? "\(Int(n)) appels" : "\(Int(n)) calls") }
        }
        out.append(Row(id: it.id, tone: tone(it.kind), title: it.task, subtitle: bits.joined(separator: " · ")))
    }
    return out
}

// MARK: - Banners

let freshMs: Double = 10 * 60 * 1000
let maxBanners = 3

/// The items to put in a system banner now: those the plugin says are due, still fresh, not already shown by this app, at most three at once.
func bannersDue(_ state: PulseState, shown: Set<String>) -> [PulseItem] {
    let byId = Dictionary(state.inbox.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    var out: [PulseItem] = []
    for id in state.banners {
        guard let it = byId[id], !shown.contains(id), state.now - it.at <= freshMs else { continue }
        out.append(it)
    }
    return Array(out.sorted { $0.at > $1.at }.prefix(maxBanners))
}

func bannerTitle(_ it: PulseItem) -> String {
    switch it.kind {
    case "failed": return Words.isFrench() ? "« \(it.task) » a échoué" : "“\(it.task)” failed"
    case "waiting": return Words.isFrench() ? "« \(it.task) » attend ton accord" : "“\(it.task)” is waiting for you"
    default: return Words.isFrench() ? "« \(it.task) » est terminée" : "“\(it.task)” finished"
    }
}

func bannerBody(_ it: PulseItem) -> String {
    var bits: [String] = []
    if let d = it.durMs, d > 0 { bits.append(duration(d)) }
    if let n = it.calls, n > 0 { bits.append(Words.isFrench() ? "\(Int(n)) appels" : "\(Int(n)) calls") }
    return bits.isEmpty ? Words.t("Ouvre Kybernos pour voir.", "Open Kybernos to see.") : bits.joined(separator: " · ")
}
