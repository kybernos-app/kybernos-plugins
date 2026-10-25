import UIKit
import WebKit

/// One screen: a first-launch / start-up view that turns into the DSH interface (a web view on the local server) once the server answers.
final class RootViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let supervisor = Supervisor()
    private let webView: WKWebView
    private let statusLabel = UILabel()
    private let progress = UIProgressView(progressViewStyle: .default)
    private let logButton = UIButton(type: .system)
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var loadedURL: URL?

    init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.09, alpha: 1)

        statusLabel.textColor = .white
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.text = "Starting Kybernos…"
        progress.progressTintColor = .white
        logButton.setTitle("Show log", for: .normal)
        logButton.addTarget(self, action: #selector(showLog), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [statusLabel, progress, logButton])
        stack.axis = .vertical; stack.spacing = 16; stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -16),
        ])

        webView.isHidden = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // the DSH page does not know the notch or the home bar: keep it inside the safe area
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        supervisor.onChange = { [weak self] in self?.render($0) }
        supervisor.begin()
        NodeHost.shared.start(port: Int(ProcessInfo.processInfo.environment["KB_PORT"] ?? "") ?? 0)

        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    private func render(_ state: Supervisor.State) {
        switch state {
        case .starting:
            statusLabel.text = "Starting Kybernos…"; progress.isHidden = true
        case .unpacking(let done, let total):
            statusLabel.text = "First launch: preparing the runtime (\(done) of \(total) files)"
            progress.isHidden = false; progress.progress = total > 0 ? Float(done) / Float(total) : 0
        case .booting:
            statusLabel.text = "Starting the engine…"; progress.isHidden = true
        case .ready(let url):
            guard loadedURL == nil else { return }
            loadedURL = url
            webView.isHidden = false
            webView.load(URLRequest(url: url))
            NSLog("kybernos: interface loaded")
        case .failed(let message):
            statusLabel.text = message; progress.isHidden = true; webView.isHidden = true
        }
    }

    @objc private func showLog() {
        let text = UITextView()
        text.isEditable = false; text.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        text.text = NodeHost.shared.logTail(maxBytes: 20000).replacingOccurrences(of: #"token=[^\s&]+"#, with: "token=…", options: .regularExpression)
        let vc = UIViewController(); vc.view = text; vc.title = "Engine log"
        present(UINavigationController(rootViewController: vc), animated: true)
        vc.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak vc] _ in vc?.dismiss(animated: true) })
    }

    // MARK: lifecycle. iOS suspends the app soon after it leaves the screen: ask for the little extra time it grants, and check the server on the way back.
    @objc private func didEnterBackground() {
        NSLog("kybernos: didEnterBackground")
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "kybernos-finish") { [weak self] in
            guard let self else { return }
            UIApplication.shared.endBackgroundTask(self.backgroundTask); self.backgroundTask = .invalid
        }
    }
    @objc private func willEnterForeground() {
        NSLog("kybernos: willEnterForeground")
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
        supervisor.healthCheck { ok in NSLog("kybernos: server answers after foreground: \(ok)") }
    }

    // MARK: web view. Only the local server is shown in the app; anything else opens in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.host == "127.0.0.1" || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { if url.host == "127.0.0.1" { webView.load(action.request) } else { UIApplication.shared.open(url) } }
        return nil
    }
}
