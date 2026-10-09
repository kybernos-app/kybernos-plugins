#!/usr/bin/env node
// scripts/vendor.mjs: rebuilds vendor/mediabunny.iife.js (only needed to change the vendored version or the entry points).
//
//   DSH_MOTION_DEPS=<folder holding node_modules/{mediabunny,three,lottie-web,esbuild}> node scripts/vendor.mjs
//
// Three libraries, none of them modified:
//   mediabunny (MPL-2.0)   writes MP4 and WebM in the browser through WebCodecs. Tree-shaken to what the exporter uses and
//                          pasted into client.js (every user needs it).
//   three (MIT)            the 3D scenes, with GLTFLoader and SkeletonUtils. Tree-shaken, global `KbMotionThree`. NOT pasted into
//                          client.js: served on demand by the host (/kybernos-motion/vendor/three.js), so only a scene with a 3D
//                          layer pays for it.
//   lottie-web (MIT)       the `lottie_light_canvas` build: Lottie on a canvas WITHOUT the expression engine (that one runs
//                          code taken from the file; this build contains no eval and no new Function), wrapped so that it lives in
//                          the private global `KbMotionLottie`. Served on demand too.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.DSH_MOTION_DEPS
if (!deps || !existsSync(join(deps, 'node_modules', 'mediabunny')) || !existsSync(join(deps, 'node_modules', '.bin', 'esbuild'))) {
  console.error('Set DSH_MOTION_DEPS to a folder where `npm install mediabunny esbuild --ignore-scripts` was run.')
  process.exit(1)
}
const need = ['mediabunny', 'three', 'lottie-web']
for (const name of need) if (!existsSync(join(deps, 'node_modules', name))) { console.error(`node_modules/${name} is missing in DSH_MOTION_DEPS`); process.exit(1) }
const pkgOf = (name) => JSON.parse(readFileSync(join(deps, 'node_modules', name, 'package.json'), 'utf8'))
const pkg = pkgOf('mediabunny')
const entry = `export {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_LOW,
} from 'mediabunny'
`
writeFileSync(join(deps, 'entry.mjs'), entry)
execFileSync(join(deps, 'node_modules', '.bin', 'esbuild'), [join(deps, 'entry.mjs'), '--bundle', '--minify', '--format=iife', '--global-name=Mediabunny', '--target=es2020', `--outfile=${join(root, 'vendor', 'mediabunny.iife.js')}`], { stdio: 'inherit', cwd: deps })
copyFileSync(join(deps, 'node_modules', 'mediabunny', 'LICENSE'), join(root, 'vendor', 'LICENSE-mediabunny-MPL-2.0.txt'))
console.log(`vendor/mediabunny.iife.js built from mediabunny ${pkg.version}`)

const entry3d = `export {
  WebGLRenderer, Scene, PerspectiveCamera, Color, AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial,
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry, RingGeometry, TorusKnotGeometry, CapsuleGeometry,
  AnimationMixer, LoopRepeat, LoopOnce, DoubleSide, SRGBColorSpace, LoadingManager,
} from 'three'
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
export * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
`
writeFileSync(join(deps, 'entry3d.mjs'), entry3d)
execFileSync(join(deps, 'node_modules', '.bin', 'esbuild'), [join(deps, 'entry3d.mjs'), '--bundle', '--minify', '--format=iife', '--global-name=KbMotionThree', '--target=es2020', `--outfile=${join(root, 'vendor', 'three.iife.js')}`], { stdio: 'inherit', cwd: deps })
copyFileSync(join(deps, 'node_modules', 'three', 'LICENSE'), join(root, 'vendor', 'LICENSE-three-MIT.txt'))
console.log(`vendor/three.iife.js built from three ${pkgOf('three').version}`)

const lottieFile = join(deps, 'node_modules', 'lottie-web', 'build', 'player', 'lottie_light_canvas.min.js')
const lottieText = readFileSync(lottieFile, 'utf8')
if (/new Function|eval\(/.test(lottieText)) { console.error('this lottie build contains eval or new Function: refusing it (expressions would run code from files)'); process.exit(1) }
// Wrapped, not modified: the library's own module branch hands its export to a private global, so it never replaces a
// `window.lottie` that another bundle (the theme's animations) may already have.
writeFileSync(join(root, 'vendor', 'lottie-canvas.min.js'), `var KbMotionLottie = (function () { var module = { exports: {} }; var exports = module.exports; var define;\n${lottieText}\nreturn module.exports; })();\n`)
copyFileSync(join(deps, 'node_modules', 'lottie-web', 'LICENSE.md'), join(root, 'vendor', 'LICENSE-lottie-web-MIT.md'))
console.log(`vendor/lottie-canvas.min.js copied from lottie-web ${pkgOf('lottie-web').version} (lottie_light_canvas)`)
