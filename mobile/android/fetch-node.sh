#!/bin/bash
# Downloads the embeddable Node for Android (fogtape/nodejs-mobile, Node 24.22.1, full ICU like the iOS build), checks its SHA-256 against the pinned value and unpacks it into .deps/.
# The library is 108 MB zipped: it is a build input, never committed.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=24.22.1-0
ZIP=nodejs-mobile-android-$VERSION.zip
SHA256=d6fd9f610fe5d81fede8f0d400c5a62723247725a19831835f15abf4f0604250   # from the release's asset digest
mkdir -p .deps/dl
if [ ! -f ".deps/dl/$ZIP" ]; then curl -fL --retry 3 -sS -o ".deps/dl/$ZIP" "https://github.com/fogtape/nodejs-mobile/releases/download/v$VERSION/$ZIP"; fi
GOT=$(shasum -a 256 ".deps/dl/$ZIP" | cut -d' ' -f1)
[ "$GOT" = "$SHA256" ] || { echo "SHA-256 mismatch for $ZIP: $GOT"; exit 1; }
if unzip -l ".deps/dl/$ZIP" | awk '{print $4}' | grep -qE '(^/|\.\./)'; then echo "unsafe path in the archive"; exit 1; fi
rm -rf .deps/node-mobile && mkdir -p .deps/node-mobile && unzip -q ".deps/dl/$ZIP" -d .deps/node-mobile
echo "Node for Android $VERSION ready in mobile/android/.deps/node-mobile (checked: $SHA256)"
