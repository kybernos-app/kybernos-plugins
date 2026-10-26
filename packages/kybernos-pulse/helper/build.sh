#!/usr/bin/env bash
# Builds "Kybernos Pulse.app", the menu-bar half of the Widget module, from the Swift sources next to this file.
#   bash build.sh              -> build/Kybernos Pulse.app (needs Xcode or the Command Line Tools, macOS 13+)
#   bash build.sh --run        -> the same, then opens it
# The app is signed ad hoc: enough to run on the Mac that built it. A copy for other Macs needs a Developer ID signature.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

if [ "$(uname -s)" != "Darwin" ]; then echo "Kybernos Pulse is a macOS app: nothing to build on $(uname -s)." >&2; exit 2; fi
if ! command -v swift >/dev/null 2>&1; then echo "swift not found: install Xcode or the Command Line Tools (xcode-select --install)." >&2; exit 2; fi

swift build -c release >&2
bin="$(swift build -c release --show-bin-path)/KybernosPulse"

app="$here/build/Kybernos Pulse.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/KybernosPulse"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>app.kybernos.pulse</string>
  <key>CFBundleName</key><string>Kybernos Pulse</string>
  <key>CFBundleDisplayName</key><string>Kybernos Pulse</string>
  <key>CFBundleExecutable</key><string>KybernosPulse</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$app" >&2

echo "$app"
if [ "${1:-}" = "--run" ]; then open "$app"; fi
