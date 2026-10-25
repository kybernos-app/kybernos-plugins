#!/bin/bash
# Builds KybernosHost.app for the iOS simulator (arm64) without an Xcode project: swiftc + a hand-assembled bundle, ad-hoc signed.
#   mobile/ios/build.sh <payload dir (output of mobile/payload/build-payload.mjs)> [path to NodeMobile.xcframework]
# A device build needs a signing identity and the ios-arm64 slice: same steps, `-target arm64-apple-ios16.0`, `codesign --sign <identity>`, an entitlements file.
set -euo pipefail
cd "$(dirname "$0")"
PAYLOAD=${1:?usage: build.sh <payload dir> [NodeMobile.xcframework]}
XCF=${2:-.deps/node-mobile/NodeMobile.xcframework}
SLICE=$XCF/ios-arm64-simulator
[ -d "$SLICE/NodeMobile.framework" ] || { echo "no framework at $SLICE (run fetch-node.sh)"; exit 1; }
for f in payload.kbpack payload.json bootstrap.mjs kbpack.mjs; do [ -f "$PAYLOAD/$f" ] || { echo "missing $PAYLOAD/$f"; exit 1; }; done
APP=build/KybernosHost.app
rm -rf "$APP"; mkdir -p "$APP/Frameworks"
xcrun --sdk iphonesimulator swiftc -swift-version 5 -parse-as-library -O \
  -target arm64-apple-ios16.0-simulator -F "$SLICE" -framework NodeMobile \
  -Xlinker -rpath -Xlinker @executable_path/Frameworks \
  Sources/*.swift -module-name KybernosHost -o "$APP/KybernosHost"
cp -R "$SLICE/NodeMobile.framework" "$APP/Frameworks/"
sed 's/\$(PRODUCT_MODULE_NAME)/KybernosHost/' Info.plist > "$APP/Info.plist"
cp "$PAYLOAD"/{payload.kbpack,payload.json,bootstrap.mjs,kbpack.mjs} "$APP/"
codesign --force --sign - --timestamp=none "$APP/Frameworks/NodeMobile.framework"
codesign --force --sign - --timestamp=none "$APP"
echo "built $APP ($(du -sm "$APP" | cut -f1) MB)"
