import Cocoa
import WebKit

// MiniApp — wrapper générique d'application widget Kybernos.
// Charge Contents/Resources/index.html dans une petite fenêtre flottante
// toujours au-dessus, sans navigateur, indépendante de DSH.
// Config dans Info.plist : KBWindowWidth, KBWindowHeight, KBTitle.

final class MiniAppPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(contentRect: contentRect,
                   styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        titlebarAppearsTransparent = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .stationary]
        isMovableByWindowBackground = true
        hasShadow = true
        hidesOnDeactivate = false
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
    }
    override var canBecomeKey: Bool { true }
}

final class RoundedView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 0.07, alpha: 0.96).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 16, yRadius: 16).fill()
    }
}

final class HeaderView: NSView {
    var titre: String = "" { didSet { label.stringValue = titre } }
    var onClose: (() -> Void)?
    private let label = NSTextField(labelWithString: "")
    private var clic: NSPoint?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.12, alpha: 1).cgColor
        layer?.cornerRadius = 16
        layer?.maskedCorners = [.layerMaxXMinYCorner, .layerMinXMinYCorner]

        let fermer = NSButton(title: "✕", target: self, action: #selector(fermerApp))
        fermer.isBordered = false
        fermer.font = .systemFont(ofSize: 12, weight: .semibold)
        fermer.contentTintColor = NSColor(white: 0.75, alpha: 1)
        fermer.frame = NSRect(x: 4, y: 4, width: 20, height: 20)
        addSubview(fermer)

        label.font = .systemFont(ofSize: 11, weight: .medium)
        label.textColor = NSColor(white: 0.8, alpha: 1)
        label.alignment = .center
        label.frame = NSRect(x: 28, y: 7, width: frame.width - 56, height: 15)
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    @objc private func fermerApp() { onClose?() }

    override func mouseDown(with e: NSEvent) { clic = e.locationInWindow }
    override func mouseDragged(with e: NSEvent) {
        guard let fenetre = window, let depart = clic else { return }
        let ecran = e.locationInWindow
        fenetre.setFrameOrigin(NSPoint(x: fenetre.frame.origin.x + ecran.x - depart.x,
                                       y: fenetre.frame.origin.y + ecran.y - depart.y))
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var panel: MiniAppPanel!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ n: Notification) {
        let bundle = Bundle.main
        let w = bundle.object(forInfoDictionaryKey: "KBWindowWidth") as? Int ?? 260
        let h = bundle.object(forInfoDictionaryKey: "KBWindowHeight") as? Int ?? 340
        let size = NSSize(width: w, height: h + 28) // + la hauteur de la barre native

        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main ?? NSScreen.screens.first
        let vf = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let rect = NSRect(x: max(vf.minX, vf.maxX - size.width - 24),
                          y: max(vf.minY, vf.maxY - size.height - 60),
                          width: size.width, height: size.height)
        panel = MiniAppPanel(contentRect: rect)
        panel.title = (bundle.object(forInfoDictionaryKey: "KBTitle") as? String) ?? "MiniApp"
        panel.delegate = self

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(white: 0.07, alpha: 0.96).cgColor

        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(
            source: "document.body.style.background='transparent';",
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        // remplir tout le contentView : la barre native se pose au-dessus
        web = WKWebView(frame: container.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")

        if let html = bundle.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
        } else {
            web.loadHTMLString("<p style='font-family:-apple-system;color:#fff;padding:20px'>index.html introuvable</p>", baseURL: nil)
        }

        container.addSubview(web)
        panel.contentView = container
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.title = (bundle.object(forInfoDictionaryKey: "KBTitle") as? String) ?? "MiniApp"
        let menu = NSMenu()
        menu.addItem(withTitle: "Recharger", action: #selector(reload), keyEquivalent: "r")
        menu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
    }

    // fermer la fenêtre (bouton rouge natif) quitte l'app widget
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return true
    }

    @objc func reload() {
        if let html = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
