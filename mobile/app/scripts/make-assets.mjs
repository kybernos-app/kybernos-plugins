#!/usr/bin/env node
// Draws the app icon, the Android adaptive-icon layers and the splash picture into assets/ (git-ignored: the repository carries no image files, see garde-depot).
// The artwork is the Kybernos K itself, read from the web client's brand block by brand-art.mjs, so it can never drift from the logo; the PNGs are written with Node's zlib only.
// Runs after `npm install`. `--out <dir>` writes somewhere else (the test uses it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSETS, loadBrand, renderAsset } from './brand-art.mjs'

const N = 1024
const arg = process.argv.indexOf('--out')
const out = arg > 0 ? resolve(process.argv[arg + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
mkdirSync(out, { recursive: true })

const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
  return Buffer.concat([head, data, crc])
}
const png = (rgba) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc((N * 4 + 1) * N)
  for (let y = 0; y < N; y++) rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const brand = await loadBrand()
for (const name of Object.keys(ASSETS)) writeFileSync(join(out, name), png(await renderAsset(name, { size: N, brand })))
console.log('assets: wrote ' + Object.keys(ASSETS).length + ' pictures of the Kybernos K to ' + out)
