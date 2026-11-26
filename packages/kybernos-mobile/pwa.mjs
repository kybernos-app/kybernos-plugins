// kybernos-mobile: the installable face of the phone layer ("Add to Home Screen" on iOS, "Install app" on Android).
//
// DSH ships a manifest of its own (name "DeepSeek Harness", display "fullscreen", one SVG icon) and no iOS tags at all: a
// home-screen icon made from it would carry the engine's name and a generic page thumbnail. This file gives the page the
// product's own identity without touching the engine: the manifest, the icons and the head tags below are served and
// injected through the plugin seams (index-inject, the web server's routes), exactly like the stylesheet.
//
// The icons are drawn here, not shipped: the repository tracks no media (scripts/garde-depot.mjs), and the K is five
// shapes. `renderIcon` rasterises them with 4x4 supersampling and `encodePng` writes a PNG with node's zlib; the result
// is computed on the first request of each icon and kept in memory.
//
// Rules this file keeps: pure functions (no DOM, no DSH service), nothing at import time that can throw, every
// failure answered with a status and never raised to the caller.
import { deflateSync } from 'node:zlib'

export const PWA_PREFIX = '/kybernos-mobile/pwa/'
export const PRODUCT_NAME = 'Kybernos'
export const PRODUCT_TAGLINE = 'A team of AI agents in one workspace.'
// The dark shell colour of the app (the status bar and the splash screen of an installed copy).
export const BACKGROUND = '#151517'
const RED = [0xf2, 0x37, 0x2a]
const WHITE = [0xff, 0xff, 0xff]
const BG = [0x15, 0x15, 0x17]

// The K of the product: the geometry kybernos-plugin/client.js (KB_BRAND_*), kybernos-gate/core/page.mjs and the app share
// (a stem 13 wide, an arm and a leg from x = 13, three white dots on the stem), in a 32.5 x 36 box.
const K_W = 32.5
const K_H = 36
const K_RECT = [0, 0, 13, 36]
const K_POLYGONS = [
  [[21, 0], [31, 0], [13, 28.3], [13, 12.6]],
  [[13, 22], [22, 36], [32.5, 36], [20.3, 16.8], [13, 16.8]]
]
const K_DOTS = [[6.5, 7.5], [6.5, 18], [6.5, 28.5]]
const DOT_R = 3.1

/** The icons: file name -> side in pixels and the K's height as a share of it. The maskable one keeps the K inside the
 *  central 80 % (the safe zone launchers crop to); the others let it breathe a little less. */
export const ICONS = Object.freeze({
  'icon-192.png': { size: 192, share: 0.58, purpose: 'any' },
  'icon-512.png': { size: 512, share: 0.58, purpose: 'any' },
  'icon-maskable-512.png': { size: 512, share: 0.46, purpose: 'maskable' },
  'apple-touch-icon.png': { size: 180, share: 0.58, purpose: 'any' }
})
export const MANIFEST_FILE = 'manifest.webmanifest'
export const FILES = Object.freeze([MANIFEST_FILE, ...Object.keys(ICONS)])

// ── The manifest ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `start_url`, `scope` and `id` are relative to the manifest's own address (/kybernos-mobile/pwa/…): '../../' is the page
// root, and it stays right if DSH is served under a path prefix. `display: standalone` (iOS does not know "fullscreen").
export function manifest () {
  return {
    id: '../../',
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: PRODUCT_TAGLINE,
    start_url: '../../',
    scope: '../../',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }
}
export const manifestJson = () => JSON.stringify(manifest())

// ── The head rows ────────────────────────────────────────────────────────────────────────────────────────────────────
// Relative hrefs, like DSH's own: they follow the page wherever it is mounted. The manifest link comes before the engine's
// own (the first one in the document is the one a browser reads). The status bar is opaque black: the app is dark by
// default and an opaque bar needs no padding at the top (the bottom safe area is mobile.css's, with viewport-fit=cover
// that client.js adds).
const tags = () => [
  '<link rel="manifest" href="./kybernos-mobile/pwa/' + MANIFEST_FILE + '">',
  '<link rel="apple-touch-icon" href="./kybernos-mobile/pwa/apple-touch-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="' + PRODUCT_NAME + '">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
  '<meta name="theme-color" content="' + BACKGROUND + '" media="(prefers-color-scheme: dark)">',
  '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">'
]
/** One head row per index render (the same shape the stylesheet's row has). */
export const pwaRows = () => [{ kind: 'html', placement: 'head', html: tags().join('') }]

// ── The icons ────────────────────────────────────────────────────────────────────────────────────────────────────────
const inPolygon = (x, y, pts) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const inK = (x, y) =>
  (x >= K_RECT[0] && x <= K_RECT[0] + K_RECT[2] && y >= K_RECT[1] && y <= K_RECT[1] + K_RECT[3]) ||
  K_POLYGONS.some((p) => inPolygon(x, y, p))
const inDot = (x, y) => K_DOTS.some(([cx, cy]) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= DOT_R * DOT_R)

const SAMPLES = 4
/** `size` x `size` RGB pixels (a Buffer, 3 bytes each): the K centred on the dark shell colour, edges anti-aliased. */
export function renderIcon (size, share) {
  const scale = (size * share) / K_H
  const left = (size - K_W * scale) / 2
  const top = (size - K_H * scale) / 2
  const out = Buffer.alloc(size * size * 3)
  const boxX0 = Math.floor(left) - 1
  const boxX1 = Math.ceil(left + K_W * scale) + 1
  const boxY0 = Math.floor(top) - 1
  const boxY1 = Math.ceil(top + K_H * scale) + 1
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const at = (py * size + px) * 3
      if (px < boxX0 || px > boxX1 || py < boxY0 || py > boxY1) { out[at] = BG[0]; out[at + 1] = BG[1]; out[at + 2] = BG[2]; continue }
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const kx = (px + (sx + 0.5) / SAMPLES - left) / scale
          const ky = (py + (sy + 0.5) / SAMPLES - top) / scale
          const c = inK(kx, ky) ? (inDot(kx, ky) ? WHITE : RED) : BG
          r += c[0]; g += c[1]; b += c[2]
        }
      }
      const n = SAMPLES * SAMPLES
      out[at] = Math.round(r / n); out[at + 1] = Math.round(g / n); out[at + 2] = Math.round(b / n)
    }
  }
  return out
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, body, tail])
}
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** A PNG (8-bit RGB, no interlace) from `width` x `height` RGB pixels. */
export function encodePng (width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const iconCache = new Map()
export const resetIcons = () => iconCache.clear()
/** The PNG of one icon file (`null` for a name that is not an icon). */
export function iconPng (name) {
  const spec = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null
  if (spec === null) return null
  if (!iconCache.has(name)) iconCache.set(name, encodePng(spec.size, spec.size, renderIcon(spec.size, spec.share)))
  return iconCache.get(name)
}

// ── The route ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Answers GET /kybernos-mobile/pwa/<name>. `fence(req)` is the caller's Host and Origin check: false = refused. */
export function servePwa (name, req, res, fence) {
  try {
    if (typeof fence === 'function' && fence(req) !== true) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('origin refused'); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }); res.end('GET expected'); return }
    const manifestRequested = name === MANIFEST_FILE
    const body = manifestRequested ? Buffer.from(manifestJson(), 'utf8') : iconPng(name)
    if (body === null) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
    res.writeHead(200, {
      'content-type': manifestRequested ? 'application/manifest+json; charset=utf-8' : 'image/png',
      'content-length': String(body.length),
      'cache-control': manifestRequested ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (e) { try { res.writeHead(500); res.end('') } catch (e2) { /* socket closed */ } }
}
