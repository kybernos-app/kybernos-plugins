#!/usr/bin/env node
// Draws the placeholder app icons into assets/ (git-ignored: the repository carries no image files, see garde-depot). A plain letter K on a dark square, written as PNG with Node's zlib only.
// Runs after `npm install`; the real artwork replaces it later by a build step that downloads or renders it, never by a committed binary.
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
mkdirSync(out, { recursive: true })
const N = 1024

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
const seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
// the K, in the middle 60 % of the canvas so an adaptive icon's mask never cuts it
const inK = (x, y) => (x >= 340 && x <= 430 && y >= 300 && y <= 724) || seg(x, y, 430, 512, 700, 300) <= 45 || seg(x, y, 430, 512, 700, 724) <= 45
const draw = ({ bg, fg }) => {
  const b = Buffer.alloc(N * N * 4)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = fg && inK(x, y) ? fg : bg
    b.set(c, (y * N + x) * 4)
  }
  return png(b)
}
const NAVY = [11, 16, 32, 255]; const WHITE = [255, 255, 255, 255]; const CLEAR = [0, 0, 0, 0]
const files = {
  'icon.png': draw({ bg: NAVY, fg: WHITE }),
  'splash-icon.png': draw({ bg: CLEAR, fg: WHITE }),
  'android-icon-background.png': draw({ bg: NAVY, fg: null }),
  'android-icon-foreground.png': draw({ bg: CLEAR, fg: WHITE }),
  'android-icon-monochrome.png': draw({ bg: CLEAR, fg: [0, 0, 0, 255] }),
}
for (const [name, data] of Object.entries(files)) writeFileSync(join(out, name), data)
console.log('assets: wrote ' + Object.keys(files).length + ' placeholder icons')
