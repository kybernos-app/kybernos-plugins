// swift-tools-version:5.9
import PackageDescription

// The Kybernos Pulse menu-bar app: one small executable, no dependency. `build.sh` wraps it into an .app.
let package = Package(
    name: "KybernosPulse",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "KybernosPulse", path: "Sources/KybernosPulse")
    ]
)
