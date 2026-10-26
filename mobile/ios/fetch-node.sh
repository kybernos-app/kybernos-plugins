#!/bin/bash
# Downloads the embeddable Node for iOS (fogtape/nodejs-mobile, Node 24.22.1), checks its SHA-256 against the pinned value and unpacks it into .deps/.
# The framework is 180 MB: it is a build input, never committed.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=24.22.1-0
ZIP=nodejs-mobile-ios-$VERSION.zip
SHA256=3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e   # from the release's SHA256SUMS
mkdir -p .deps/dl
if [ ! -f ".deps/dl/$ZIP" ]; then curl -fL --retry 3 -sS -o ".deps/dl/$ZIP" "https://github.com/fogtape/nodejs-mobile/releases/download/v$VERSION/$ZIP"; fi
GOT=$(shasum -a 256 ".deps/dl/$ZIP" | cut -d' ' -f1)
[ "$GOT" = "$SHA256" ] || { echo "SHA-256 mismatch for $ZIP: $GOT"; exit 1; }
if unzip -l ".deps/dl/$ZIP" | awk '{print $4}' | grep -qE '(^/|\.\./)'; then echo "unsafe path in the archive"; exit 1; fi
rm -rf .deps/node-mobile && mkdir -p .deps/node-mobile && unzip -q ".deps/dl/$ZIP" -d .deps/node-mobile
echo "Node for iOS $VERSION ready in mobile/ios/.deps/node-mobile (checked: $SHA256)"
