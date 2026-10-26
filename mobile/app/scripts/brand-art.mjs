// The Kybernos K for the phone app's icon and splash, drawn from the SAME code as the web app, the wizard and the favicon:
// the block marked KB-BRAND-CORE in packages/kybernos-plugin/client.js (a red K, three white dots on its stem). Nothing is copied
// here: the geometry is read from that block, so the icon cannot drift from the logo. The pictures are drawn with 4 x 4 samples per
// pixel (smooth edges) and are never committed (the repository carries no images, see scripts/garde-depot.mjs).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BRAND_SOURCE = join(here, '..', '..', '..', 'packages', 'kybernos-plugin', 'client.js')

/** The app's own background (App.tsx `fill`, the consent and boot screens): the icon, the splash and every screen after it share it, so nothing flashes. */
export const APP_BACKGROUND = '#121217'

const rgba = (hex, a = 255) => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16), a]
}

/** Reads kbBrandArt() and the K's box out of the web client, and turns the SVG into shapes in paint order. */
export const loadBrand = async (source = BRAND_SOURCE) => {
  const src = readFileSync(source, 'utf8')
  const m = src.match(/\/\/ KB-BRAND-CORE-BEGIN([\s\S]*?)\/\/ KB-BRAND-CORE-END/)
  if (m === null) throw new Error('block KB-BRAND-CORE not found in ' + source)
  const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { KB_BRAND_RED, KB_BRAND_VIEWBOX, kbBrandArt }'))
  const [, , width, height] = mod.KB_BRAND_VIEWBOX.split(' ').map(Number)
  const shapesOf = (dot) => {
    const out = []
    for (const g of mod.kbBrandArt(dot).matchAll(/<g fill="(#[0-9a-fA-F]{3,6})">([\s\S]*?)<\/g>/g)) {
      const fill = rgba(g[1])
      for (const t of g[2].matchAll(/<(rect|polygon|circle)\s([^>]*)\/>/g)) {
        const a = Object.fromEntries([...t[2].matchAll(/([a-z]+)="([^"]*)"/g)].map((p) => [p[1], p[2]]))
        if (t[1] === 'rect') out.push({ type: 'rect', fill, x: +a.x, y: +a.y, w: +a.width, h: +a.height })
        else if (t[1] === 'circle') out.push({ type: 'circle', fill, cx: +a.cx, cy: +a.cy, r: +a.r })
        else out.push({ type: 'polygon', fill, pts: a.points.trim().split(/\s+/).map((p) => p.split(',').map(Number)) })
      }
    }
    return out
  }
  return { red: mod.KB_BRAND_RED, width, height, shapesOf }
}

const inside = (s, x, y) => {
  if (s.type === 'rect') return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h
  if (s.type === 'circle') return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r
  let c = false
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    const [xi, yi] = s.pts[i]; const [xj, yj] = s.pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const SAMPLES = 4

/** Draws the K centred on a square canvas: `shapes` in K units, `box` = the K's width and height in K units, `height` = the K's height in pixels,
 *  `bg` = RGBA of the canvas, `fillOf(shape)` = RGBA override (the one-colour icon). Returns RGBA bytes, N x N x 4. */
export const draw = ({ size, shapes, box, height, bg, fillOf = (s) => s.fill }) => {
  const scale = height / box.height
  const ox = (size - box.width * scale) / 2
  const oy = (size - box.height * scale) / 2
  const out = Buffer.alloc(size * size * 4)
  const x0 = Math.max(0, Math.floor(ox) - 1); const x1 = Math.min(size, Math.ceil(ox + box.width * scale) + 1)
  const y0 = Math.max(0, Math.floor(oy) - 1); const y1 = Math.min(size, Math.ceil(oy + box.height * scale) + 1)
  const fills = shapes.map(fillOf)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) { out.set(bg, (y * size + x) * 4); continue }
    let r = 0; let g = 0; let b = 0; let a = 0
    for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) {
      const u = (x + (sx + 0.5) / SAMPLES - ox) / scale
      const v = (y + (sy + 0.5) / SAMPLES - oy) / scale
      let c = bg
      for (let i = shapes.length - 1; i >= 0; i--) if (inside(shapes[i], u, v)) { c = fills[i]; break }
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]
    }
    const o = (y * size + x) * 4
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round(a / (SAMPLES * SAMPLES)) }
  }
  return out
}

/** What each file of assets/ is. Sizes are fractions of the canvas so the same plan draws a 1024 px icon and a small test picture.
 *  - icon: the K on the app background, opaque (iOS refuses transparency); dots a little bigger than on the big logo, like the favicon, so they survive at 60 pt.
 *  - android foreground / monochrome: the K inside the middle 66 % that any launcher mask keeps; the one-colour version has the dots cut out.
 *  - splash: the K alone, on a transparent canvas; the colour behind it is the splash plugin's backgroundColor (app.json). */
export const ASSETS = {
  'icon.png': { dot: 3.3, height: 0.55, bg: 'app' },
  'android-icon-background.png': { dot: null, height: 0, bg: 'app' },
  'android-icon-foreground.png': { dot: 3.3, height: 0.43, bg: 'clear' },
  'android-icon-monochrome.png': { dot: 3.3, height: 0.43, bg: 'clear', mono: true },
  'splash-icon.png': { dot: 2.8, height: 0.62, bg: 'clear' },
}

export const renderAsset = async (name, { size = 1024, brand } = {}) => {
  const spec = ASSETS[name]
  if (spec === undefined) throw new Error('unknown asset ' + name)
  const b = brand ?? (await loadBrand())
  const bg = spec.bg === 'app' ? rgba(APP_BACKGROUND) : [0, 0, 0, 0]
  if (spec.dot === null) return draw({ size, shapes: [], box: { width: b.width, height: b.height }, height: 1, bg })
  const shapes = b.shapesOf(spec.dot)
  // one colour for the whole K, the dots cut out of it (Android paints the silhouette in the wallpaper's colour)
  const fillOf = spec.mono === true ? (s) => (s.type === 'circle' ? [0, 0, 0, 0] : [0, 0, 0, 255]) : undefined
  return draw({ size, shapes, box: { width: b.width, height: b.height }, height: spec.height * size, bg, fillOf })
}
