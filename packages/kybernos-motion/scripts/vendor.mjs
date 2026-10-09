#!/usr/bin/env node
// scripts/vendor.mjs: rebuilds vendor/mediabunny.iife.js (only needed to change the vendored version or the entry points).
//
//   DSH_MOTION_DEPS=<folder holding node_modules/mediabunny and node_modules/esbuild> node scripts/vendor.mjs
//
// Mediabunny (MPL-2.0, https://mediabunny.dev) writes MP4 and WebM files in the browser through WebCodecs.
// Only what the exporter uses is pulled in (tree-shaken); the bundle is not modified in any other way.
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
const pkg = JSON.parse(readFileSync(join(deps, 'node_modules', 'mediabunny', 'package.json'), 'utf8'))
const entry = `export {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_LOW,
} from 'mediabunny'
`
writeFileSync(join(deps, 'entry.mjs'), entry)
execFileSync(join(deps, 'node_modules', '.bin', 'esbuild'), [join(deps, 'entry.mjs'), '--bundle', '--minify', '--format=iife', '--global-name=Mediabunny', '--target=es2020', `--outfile=${join(root, 'vendor', 'mediabunny.iife.js')}`], { stdio: 'inherit', cwd: deps })
copyFileSync(join(deps, 'node_modules', 'mediabunny', 'LICENSE'), join(root, 'vendor', 'LICENSE-mediabunny-MPL-2.0.txt'))
console.log(`vendor/mediabunny.iife.js built from mediabunny ${pkg.version}`)
