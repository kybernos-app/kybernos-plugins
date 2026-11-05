// The retouch of a shop photo (shop-stock.mjs `shop_photo`): a picture the person took with their phone becomes a small, square, evened-out JPEG that a shop window can show.
// What it does is deterministic and honest: it turns the picture upright from its own orientation mark, crops a square on the part of the picture that stands out, evens out light and
// contrast, lifts the colours a little, sharpens, drops every metadata block (so the place where the photo was taken never leaves the computer) and shrinks it until it fits the
// shop's limit. It does NOT paint a new picture: a dark or blurred photo stays dark or blurred.
// `sharp` is the cloud computer's own image library. It is loaded here, when a photo arrives and not before: a bundle must never stop DSH from starting, and the Mac's DSH has no use for it.
import { createRequire } from 'node:module'

/** The most a retouched photo may weigh: the shop keeps 250 KB, this leaves room. */
export const MAX_BYTES = 245_000
/** The smallest side the shop accepts. */
export const MIN_SIDE = 100
/** The sides tried, largest first: a window tile is small, so the first that fits the weight wins. */
export const SIDES = [1024, 800, 640, 480]
/** The JPEG qualities tried at each side. */
export const QUALITIES = [84, 72]

/** What each look does to the light and the colours (1 = unchanged). */
export const LOOK_SETTINGS = {
  natural: { brightness: 1, saturation: 1.04 },
  bright: { brightness: 1.1, saturation: 1.08 },
  vivid: { brightness: 1.03, saturation: 1.25 }
}

/** The image library of this computer, or null where there is none. Where it is looked for: the engine's own modules on the cloud image first, then the bundle's. */
export const loadSharp = () => {
  for (const from of ['/home/node/engine/package.json', import.meta.url]) {
    try {
      const mod = createRequire(from)('sharp')
      if (typeof mod === 'function') return mod
    } catch (e) { /* the next place */ }
  }
  return null
}

/**
 * The retouch, made from an image library (`sharp` or a stand-in in the tests). Never throws.
 * @returns `async (bytes, look) => { ok: true, jpeg, width, height } | { ok: false, why }` with `why` one of `unreadable`, `too_small`, `too_heavy`
 */
export const createRetouch = (sharp) => async (bytes, look = 'natural') => {
  if (typeof sharp !== 'function') return { ok: false, why: 'unreadable' }
  const settings = LOOK_SETTINGS[look] !== undefined ? LOOK_SETTINGS[look] : LOOK_SETTINGS.natural
  try {
    const source = sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate()
    const meta = await source.metadata()
    const shortest = Math.min(Number(meta.width) || 0, Number(meta.height) || 0)
    if (shortest < MIN_SIDE) return { ok: false, why: shortest === 0 ? 'unreadable' : 'too_small' }
    // Never enlarge: a picture smaller than a side keeps its own size, and the sides it would repeat are skipped.
    const edges = [...new Set(SIDES.map((side) => Math.min(side, shortest)))]
    for (const edge of edges) {
      for (const quality of QUALITIES) {
        const made = await source.clone()
          .resize({ width: edge, height: edge, fit: 'cover', position: 'attention' })
          .normalise()
          .modulate(settings)
          .sharpen({ sigma: 0.8 })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
        if (made.data.length <= MAX_BYTES) return { ok: true, jpeg: made.data, width: made.info.width, height: made.info.height }
      }
    }
    return { ok: false, why: 'too_heavy' }
  } catch (e) {
    return { ok: false, why: 'unreadable' }
  }
}

/** The retouch of this computer: made from its image library the first time a photo comes, `{ ok: false, why: 'unreadable' }` where there is none. */
export const createLazyRetouch = (load = loadSharp) => {
  let retouch = null
  return async (bytes, look) => {
    if (retouch === null) { try { retouch = createRetouch(load()) } catch (e) { retouch = createRetouch(null) } }
    return retouch(bytes, look)
  }
}
