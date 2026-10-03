// ─────────────────────────────────────────────────────────────────────────────
// color-core.js — noyau colorimétrique partagé par les maquettes et, plus tard,
// par le compilateur du plugin.
//
// Deux espaces, deux rôles, jamais confondus :
//   · OKLab pour MÉLANGER — perceptuellement uniforme, donc un dégradé entre
//     deux couleurs ne traverse pas de zone boueuse et garde sa teinte.
//   · WCAG pour MESURER — c'est la norme d'accessibilité, pas un espace de
//     travail. Confondre les deux est l'erreur habituelle des thèmes : on
//     « corrige » en HSL et on croit avoir corrigé le contraste.
//
// Ce fichier s'écrit en ESM (il est testable tel quel sous Node) et le
// générateur le copie dans les maquettes en retirant les `export` — une seule
// implémentation, donc aucune divergence possible entre l'outil et l'aperçu.
// ─────────────────────────────────────────────────────────────────────────────

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → `[r, g, b]` (0–255). */
export function parseHex(h) {
  let s = String(h).trim().replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (s.length === 8) s = s.slice(0, 6)
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/** `[r, g, b]` → `#rrggbb`, bornes appliquées. */
export const toHex = (rgb) =>
  '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')

/** `#rrggbb` + alpha → `rgba(...)`, la seule forme admise pour un jeton translucide. */
export const rgba = (h, a) => {
  const [r, g, b] = parseHex(h)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export const srgbToLinear = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
export const linearToSrgb = (c) =>
  255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/** `[r, g, b]` → `{L, a, b}` en OKLab. */
export function rgbToOklab([r, g, b]) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  }
}

/** `{L, a, b}` OKLab → `[r, g, b]`. */
export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ]
}

/** Luminance relative WCAG 2.1 à partir d'un hex. */
export const luminance = (h) => {
  const [r, g, b] = parseHex(h).map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Ratio de contraste WCAG 2.1, de 1 (identiques) à 21 (noir/blanc). */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Mélange deux couleurs en OKLab. `t = 0` → `a`, `t = 1` → `b`. */
export function mixOklab(aHex, bHex, t) {
  const A = rgbToOklab(parseHex(aHex)), B = rgbToOklab(parseHex(bHex))
  return toHex(oklabToRgb({
    L: A.L + (B.L - A.L) * t,
    a: A.a + (B.a - A.a) * t,
    b: A.b + (B.b - A.b) * t,
  }))
}

/** Chroma OKLab (distance à l'axe des gris) — sert à trouver la couleur « la plus colorée ». */
export const chromaOf = (hex) => {
  const l = rgbToOklab(parseHex(hex))
  return Math.hypot(l.a, l.b)
}

/** Teinte OKLab en degrés (0–360). */
export const hueOf = (hex) => {
  const l = rgbToOklab(parseHex(hex))
  return ((Math.atan2(l.b, l.a) * 180) / Math.PI + 360) % 360
}

/** Déplace la clarté OKLab, teinte et chroma conservés. */
export const withLightness = (hex, L) => toHex(oklabToRgb({ ...rgbToOklab(parseHex(hex)), L }))

/**
 * Amène `fgHex` à `target` de contraste WCAG sur `bgHex`, en ne bougeant QUE la
 * clarté OKLab — une couleur réparée doit rester reconnaissable.
 * @param {boolean} [prefer] force le sens (`true` = éclaircir) au lieu de le déduire du fond
 * @returns {{hex: string, steps: number, reached: boolean}}
 */
export function repare(fgHex, bgHex, target, prefer) {
  const sens = prefer === true ? 1 : prefer === false ? -1 : (rgbToOklab(parseHex(bgHex)).L > 0.5 ? -1 : 1)
  const lab = rgbToOklab(parseHex(fgHex))
  let best = toHex(oklabToRgb(lab))
  for (let i = 0; i < 120; i += 1) {
    const cur = toHex(oklabToRgb(lab))
    if (contrast(cur, bgHex) >= target) return { hex: cur, steps: i, reached: true }
    best = cur
    lab.L = clamp(lab.L + sens * 0.008, 0.02, 0.99)
    if (lab.L <= 0.02 || lab.L >= 0.99) break
  }
  const last = toHex(oklabToRgb(lab))
  return { hex: contrast(last, bgHex) > contrast(best, bgHex) ? last : best, steps: 120, reached: false }
}
