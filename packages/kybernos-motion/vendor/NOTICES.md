# Vendored library

## Mediabunny 1.61.3 (MPL-2.0)

- What it does here: writes the exported MP4 and WebM files in the browser, through WebCodecs.
- Upstream: https://github.com/Vanilagy/mediabunny (npm package `mediabunny@1.61.3`), homepage https://mediabunny.dev/
- Licence: Mozilla Public License 2.0, full text in `LICENSE-mediabunny-MPL-2.0.txt`.
- How it is included: unmodified, tree-shaken to the entry points the exporter uses and minified into
  `vendor/mediabunny.iife.js` by `scripts/vendor.mjs` (esbuild, global name `Mediabunny`). Do not edit that file by hand.
- MPL-2.0 is a file-level copyleft: Mediabunny's own files stay under MPL-2.0 and their source is available at the
  upstream address above, at the tag of the version named here. The rest of this bundle is Apache-2.0.

To change the version: `npm install mediabunny@<version> esbuild --ignore-scripts` in an empty folder, then
`DSH_MOTION_DEPS=<that folder> node scripts/vendor.mjs`, then `node scripts/build.mjs`, and update this file.
