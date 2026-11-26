# Vendored libraries

Three libraries, none modified. `scripts/vendor.mjs` rebuilds them from npm packages
(`DSH_MOTION_DEPS=<folder> node scripts/vendor.mjs`, then `node scripts/build.mjs`); never edit the files in this folder by hand.

## Mediabunny 1.61.3 (MPL-2.0)

- What it does here: writes the exported MP4 and WebM files in the browser, through WebCodecs.
- Upstream: https://github.com/Vanilagy/mediabunny (npm `mediabunny@1.61.3`), homepage https://mediabunny.dev/
- Licence: Mozilla Public License 2.0, full text in `LICENSE-mediabunny-MPL-2.0.txt`.
- How it is included: tree-shaken to the entry points the exporter uses and minified into `mediabunny.iife.js`
  (esbuild, global `Mediabunny`), pasted into `client.js`.
- MPL-2.0 is a file-level copyleft: Mediabunny's own files stay under MPL-2.0 and their source is available at the
  upstream address above, at the tag of the version named here. The rest of this bundle is Apache-2.0.

## three.js 0.186.1 (MIT)

- What it does here: draws the `scene3d` layers (shapes, glTF models and their animation clips). Includes `GLTFLoader` and
  `SkeletonUtils` from the three.js examples.
- Upstream: https://github.com/mrdoob/three.js (npm `three@0.186.1`), licence text in `LICENSE-three-MIT.txt`.
- How it is included: tree-shaken and minified into `three.iife.js` (esbuild, global `KbMotionThree`, so it never replaces another bundle's `THREE`). It is NOT pasted into
  `client.js`: the host serves it on demand at `/kybernos-motion/vendor/three.js`, so only an animation with a 3D layer loads it.

## lottie-web 5.13.0 (MIT)

- What it does here: plays the `lottie` layers (for instance a character) frame by frame on a canvas.
- Upstream: https://github.com/airbnb/lottie-web (npm `lottie-web@5.13.0`), licence text in `LICENSE-lottie-web-MIT.md`.
- How it is included: the `lottie_light_canvas.min.js` build, copied as `lottie-canvas.min.js` inside a three-line wrapper that keeps
  it out of the `window.lottie` global (another bundle uses that one). The library text itself is untouched. This build has no expression
  engine: expressions are code stored in the file, and no scene file may carry code. `scripts/vendor.mjs` refuses a build that
  contains `eval(` or `new Function`, and `test-host.mjs` checks the shipped file again.
- Served on demand at `/kybernos-motion/vendor/lottie.js`.
