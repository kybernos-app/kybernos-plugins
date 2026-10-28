#!/usr/bin/env node
// The app icon for "Kybernos Pulse.app", painted from the shared K geometry.
//
// The repository keeps no icon binary in git (AGENTS.md rule 4: no media), so the
// mark is drawn by scripts/icone-kybernos.mjs and turned into a .icns at build
// time. Without this the bundle carries no CFBundleIconFile at all and macOS
// shows its own generic white placeholder — measured on the built app, whose
// Resources folder was empty and whose Info.plist had no icon key.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOMS_ICONSET, pngK } from '../../../scripts/icone-kybernos.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'build')
const iconset = join(out, 'Kybernos.iconset')
const icns = join(out, 'icon.icns')

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
for (const [name, pixels] of NOMS_ICONSET) writeFileSync(join(iconset, name), pngK(pixels))
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'inherit' })
rmSync(iconset, { recursive: true, force: true })

console.log(icns)
