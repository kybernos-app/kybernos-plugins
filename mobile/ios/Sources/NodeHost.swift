import Foundation
import NodeMobile

/// Runs the embedded Node once per process. `node_start` can only be called a single time, so a Node that stops stays stopped until the app is relaunched.
/// Everything the engine needs is handed over by environment variables (see mobile/payload/bootstrap.mjs); its console goes to `logFile`.
final class NodeHost {
    static let shared = NodeHost()
    static let exited = Notification.Name("NodeHostExited")

    struct Paths {
        let support: URL      // Application Support/Kybernos
        let runtime: URL      // the unpacked runtime (rebuildable, kept out of backups)
        let home: URL         // HOME of the engine: its data folder (sessions, settings)
        let workspace: URL    // Documents/Kybernos, visible in the Files app
        var log: URL { support.appendingPathComponent("node.log") }
        var status: URL { runtime.appendingPathComponent("status.json") }
    }

    let paths: Paths
    private(set) var started = false
    private(set) var exitCode: Int32? = nil

    private init() {
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Kybernos", isDirectory: true)
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Kybernos", isDirectory: true)
        paths = Paths(support: support, runtime: support.appendingPathComponent("runtime", isDirectory: true), home: support.appendingPathComponent("data", isDirectory: true), workspace: docs)
    }

    /// Starts Node on a thread with a large stack. Returns false when the bundle lacks its files or Node already runs.
    @discardableResult
    func start(port: Int = 0) -> Bool {
        guard !started else { return false }
        let fm = FileManager.default
        guard let payload = Bundle.main.path(forResource: "payload", ofType: "kbpack"),
              let manifest = Bundle.main.path(forResource: "payload", ofType: "json"),
              let bootstrap = Bundle.main.path(forResource: "bootstrap", ofType: "mjs") else { return false }
        for dir in [paths.support, paths.runtime, paths.home, paths.workspace] { try? fm.createDirectory(at: dir, withIntermediateDirectories: true) }
        SelfTest.prepareProvider(home: paths.home)
        var runtimeURL = paths.runtime
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? runtimeURL.setResourceValues(values)

        // the engine's console becomes the log file: the host reads the sign-in address from it
        let fd = open(paths.log.path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
        if fd >= 0 { dup2(fd, STDOUT_FILENO); dup2(fd, STDERR_FILENO); close(fd) }

        let env: [String: String] = [
            "KB_PAYLOAD": payload, "KB_MANIFEST": manifest, "KB_ROOT": paths.runtime.path, "KB_HOME": paths.home.path,
            "KB_WORKSPACE": paths.workspace.path, "KB_PORT": String(port), "TMPDIR": NSTemporaryDirectory(),
        ]
        for (k, v) in env { setenv(k, v, 1) }
        // a simulator, unlike a phone, lets processes run: this switch refuses them to rehearse the phone
        if let deny = ProcessInfo.processInfo.environment["KYBERNOS_DENY_SPAWN"] { setenv("KYBERNOS_DENY_SPAWN", deny, 1) }
        fm.changeCurrentDirectoryPath(paths.workspace.path)

        started = true
        let thread = Thread { [weak self] in
            // node_start wants one contiguous argv buffer
            let args = ["node", "--expose-internals", bootstrap]
            let total = args.reduce(0) { $0 + $1.utf8.count + 1 }
            let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: total)
            var argv = [UnsafeMutablePointer<CChar>?]()
            var cursor = buffer
            for a in args {
                a.withCString { src in strcpy(cursor, src) }
                argv.append(cursor)
                cursor += a.utf8.count + 1
            }
            argv.append(nil)
            let code = node_start(Int32(args.count), &argv)
            self?.exitCode = code
            DispatchQueue.main.async { NotificationCenter.default.post(name: NodeHost.exited, object: nil, userInfo: ["code": code]) }
        }
        thread.name = "node"
        thread.stackSize = 16 * 1024 * 1024
        thread.start()
        return true
    }

    /// The last bytes of the engine's console.
    func logTail(maxBytes: Int = 65536) -> String {
        guard let h = try? FileHandle(forReadingFrom: paths.log) else { return "" }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        try? h.seek(toOffset: size > UInt64(maxBytes) ? size - UInt64(maxBytes) : 0)
        return String(decoding: (try? h.readToEnd()) ?? Data(), as: UTF8.self)
    }

    /// First-launch progress written by bootstrap.mjs.
    func unpackStatus() -> (phase: String, done: Int, total: Int)? {
        guard let data = try? Data(contentsOf: paths.status), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let phase = o["phase"] as? String else { return nil }
        return (phase, (o["done"] as? Int) ?? 0, (o["total"] as? Int) ?? 0)
    }
}
