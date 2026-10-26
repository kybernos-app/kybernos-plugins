// ── The Kybernos icon, drawn without any library ────────────────────────────
//
// The launcher put on a person's computer needs the red K with three dots, and the repo keeps no picture (AGENTS.md rule 4: no media in git).
// So the icon is drawn here from the same shapes as `kbBrandArt` (packages/kybernos-plugin/client.js, block KB-BRAND-CORE: a stem, an arm and a
// leg in #f2372a, three white dots on the stem; the dots are a little larger at icon size, as in the favicon) and written as a PNG with Node's
// own zlib. A white rounded plate behind the K keeps it readable on a dark Dock.
import { deflateSync } from 'node:zlib'

const ROUGE = [0xf2, 0x37, 0x2a]
const BLANC = [0xff, 0xff, 0xff]
// The K's shapes in its own 32.5 x 36 units.
const RECT = [0, 0, 13, 36]
const BRAS = [[21, 0], [31, 0], [13, 28.3], [13, 12.6]]
const JAMBE = [[13, 22], [22, 36], [32.5, 36], [20.3, 16.8], [13, 16.8]]
const POINTS = [[6.5, 7.5], [6.5, 18], [6.5, 28.5]]
const RAYON_POINT = 3.3

const dansPolygone = (x, y, p) => {
  let dedans = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) dedans = !dedans
  }
  return dedans
}

/** Colour of the point (x, y) of a `taille` square, in the plate's frame: [r, g, b, a] with a in 0..1. */
const couleurEn = (x, y, taille) => {
  const rayon = taille * 0.2237 // the macOS « squircle » radius, as a rounded square
  const cx = Math.min(Math.max(x, rayon), taille - rayon); const cy = Math.min(Math.max(y, rayon), taille - rayon)
  if ((x - cx) ** 2 + (y - cy) ** 2 > rayon ** 2) return [0, 0, 0, 0]
  const echelle = (taille * 0.56) / 36
  const kx = (x - (taille - 32.5 * echelle) / 2) / echelle; const ky = (y - (taille - 36 * echelle) / 2) / echelle
  for (const [px, py] of POINTS) if ((kx - px) ** 2 + (ky - py) ** 2 <= RAYON_POINT ** 2) return [...BLANC, 1]
  if ((kx >= RECT[0] && kx <= RECT[0] + RECT[2] && ky >= RECT[1] && ky <= RECT[1] + RECT[3]) || dansPolygone(kx, ky, BRAS) || dansPolygone(kx, ky, JAMBE)) return [...ROUGE, 1]
  return [...BLANC, 1]
}

/** RGBA bytes (taille x taille x 4), anti-aliased by supersampling. */
export const peindreK = (taille, sur = taille >= 512 ? 3 : 4) => {
  const out = new Uint8Array(taille * taille * 4)
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0
      for (let sy = 0; sy < sur; sy++) {
        for (let sx = 0; sx < sur; sx++) {
          const c = couleurEn(x + (sx + 0.5) / sur, y + (sy + 0.5) / sur, taille)
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]
        }
      }
      const i = (y * taille + x) * 4
      if (a > 0) { out[i] = Math.round(r / a); out[i + 1] = Math.round(g / a); out[i + 2] = Math.round(b / a) }
      out[i + 3] = Math.round((a / (sur * sur)) * 255)
    }
  }
  return out
}

const TABLE_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (buf) => { let c = 0xffffffff; for (const o of buf) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const bloc = (type, data) => {
  const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

/** A PNG (8-bit RGBA) from `peindreK`'s bytes. */
export const encoderPng = (rgba, taille) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4); ihdr[8] = 8; ihdr[9] = 6
  const brut = Buffer.alloc(taille * (taille * 4 + 1))
  for (let y = 0; y < taille; y++) { brut[y * (taille * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * taille * 4, taille * 4).copy(brut, y * (taille * 4 + 1) + 1) }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0))])
}

export const pngK = (taille) => encoderPng(peindreK(taille), taille)

/** The ten files of a macOS `.iconset` (iconutil turns the folder into an .icns): five sizes, each also at twice its size. Each size is painted once. */
export const NOMS_ICONSET = [16, 32, 128, 256, 512].flatMap((px) => [['icon_' + px + 'x' + px + '.png', px], ['icon_' + px + 'x' + px + '@' + '2x.png', px * 2]])
