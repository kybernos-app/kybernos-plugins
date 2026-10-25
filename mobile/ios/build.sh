#!/bin/bash
# Builds KybernosHost.app without an Xcode project: swiftc + a hand-assembled bundle, ad-hoc signed.
#   mobile/ios/build.sh <payload dir (output of mobile/payload/build-payload.mjs)> [path to NodeMobile.xcframework]
#   TARGET=device mobile/ios/build.sh ...   builds for a real iPhone (ios-arm64 slice) and also writes build/KybernosHost.ipa
# The ad-hoc signature is enough for a device cloud that re-signs the app with its own profile (LambdaTest says it does); installing on your own iPhone needs
# `codesign --sign "<Apple Development identity>"` and a provisioning profile embedded as embedded.mobileprovision.
set -euo pipefail
cd "$(dirname "$0")"
PAYLOAD=${1:?usage: build.sh <payload dir> [NodeMobile.xcframework]}
XCF=${2:-.deps/node-mobile/NodeMobile.xcframework}
TARGET=${TARGET:-simulator}
if [ "$TARGET" = device ]; then SDK=iphoneos; SLICE=$XCF/ios-arm64; TRIPLE=arm64-apple-ios16.0; APP=build/device/KybernosHost.app
else SDK=iphonesimulator; SLICE=$XCF/ios-arm64-simulator; TRIPLE=arm64-apple-ios16.0-simulator; APP=build/KybernosHost.app; fi
[ -d "$SLICE/NodeMobile.framework" ] || { echo "no framework at $SLICE (run fetch-node.sh)"; exit 1; }
for f in payload.kbpack payload.json bootstrap.mjs kbpack.mjs; do [ -f "$PAYLOAD/$f" ] || { echo "missing $PAYLOAD/$f"; exit 1; }; done
rm -rf "$APP"; mkdir -p "$APP/Frameworks"
xcrun --sdk $SDK swiftc -swift-version 5 -parse-as-library -O \
  -target $TRIPLE -F "$SLICE" -framework NodeMobile \
  -Xlinker -rpath -Xlinker @executable_path/Frameworks \
  Sources/*.swift -module-name KybernosHost -o "$APP/KybernosHost"
cp -R "$SLICE/NodeMobile.framework" "$APP/Frameworks/"
sed 's/\$(PRODUCT_MODULE_NAME)/KybernosHost/' Info.plist > "$APP/Info.plist"
if [ "$TARGET" = device ]; then /usr/libexec/PlistBuddy -c "Add :CFBundleSupportedPlatforms array" -c "Add :CFBundleSupportedPlatforms:0 string iPhoneOS" "$APP/Info.plist" 2>/dev/null || true; fi
cp "$PAYLOAD"/{payload.kbpack,payload.json,bootstrap.mjs,kbpack.mjs} "$APP/"
codesign --force --sign - --timestamp=none "$APP/Frameworks/NodeMobile.framework"
codesign --force --sign - --timestamp=none "$APP"
echo "built $APP ($(du -sm "$APP" | cut -f1) MB)"
if [ "$TARGET" = device ]; then
  rm -rf build/ipa build/KybernosHost.ipa; mkdir -p build/ipa/Payload; cp -R "$APP" build/ipa/Payload/
  (cd build/ipa && zip -qry ../KybernosHost.ipa Payload)
  echo "wrote build/KybernosHost.ipa ($(du -sm build/KybernosHost.ipa | cut -f1) MB)"
fi
