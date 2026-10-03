// ─────────────────────────────────────────────────────────────────────────────
// compile.js — le compilateur Kyberos · Theme.
//
// Idée directrice : ne PAS recopier 165 valeurs écrites à la main. On dérive les
// 73 primitifs `--dsw-static-*`, puis on conserve la feuille officielle TELLE
// QUELLE pour les alias — dont la majorité sont des `var(--dsw-static-*)` qui se
// recoloreront tout seuls. Seuls les alias à valeur littérale sont recalculés.
//
// Conséquence : la couverture est de 165/165 PAR CONSTRUCTION, pas par
// énumération. Un jeton oublié est impossible — il n'y a pas de liste à tenir.
//
// Ce fichier est la source unique : les deux maquettes l'injectent, et le plugin
// l'importera. Il ne dépend que de `color-core.js` et reçoit `TOKENS` en
// paramètre, donc il ne présume rien du mécanisme d'injection.
// ─────────────────────────────────────────────────────────────────────────────

import {
  clamp, contrast, oklabToRgb, parseHex, repare, rgba, rgbToOklab, toHex,
} from './color-core.js'

/** Marches par famille, lues dans la feuille officielle au chargement. */
export function staticSteps(map) {
  const fams = {}
  for (const name of Object.keys(map)) {
    if (!name.startsWith('--dsw-static-')) continue
    const rest = name.replace('--dsw-static-', '')
    const parts = rest.split('-')
    const isBluish = parts[0] === 'neutral' && parts[1] === 'bluish'
    const fam = isBluish ? 'neutral-bluish' : parts[0]
    const step = parts.slice(isBluish ? 2 : 1).join('-')
    ;(fams[fam] = fams[fam] || []).push(step)
  }
  return fams
}

export const FAMILY_OF_COLOR = {
  blue: 'accent', deepseek: 'accent', amber: 'warn', green: 'success', red: 'error',
}

/** Position sur l'axe absolu de clarté (0 = le plus clair, 1 = le plus sombre). */
export function stepPosition(step) {
  if (step === '50p') return 0.025
  if (step.includes('-')) step = step.split('-')[0] // `700-delete` → 700
  return clamp(parseInt(step, 10) / 1000, 0, 1)
}

/**
 * Compile une palette en ses 165 jetons.
 * @param {Record<string, Record<string,string>>} TOKENS feuille officielle `{light, dark}`
 * @param {object} p palette (`colors` + `scheme`)
 * @param {{chroma:number, tint:number, brandAccent:boolean}} opt réglages du compilateur
 * @returns {Record<string,string>} les jetons, alias `var()` conservés
 */
export function compile(TOKENS, p, opt) {
  const base = TOKENS[p.scheme]
  const c = p.colors
  const dark = p.scheme === 'dark'

  // L'axe absolu : 0 = extrémité claire, 1 = extrémité sombre. Il est le MÊME
  // dans les deux schémas — c'est ce qui permet de garder les alias officiels
  // (`bg-base` → `neutral-bluish-00` en clair, `-950` en sombre) sans les toucher.
  const lightEnd = dark ? c.fg : c.bg
  const darkEnd = dark ? c.bg : c.fg
  const labA = rgbToOklab(parseHex(lightEnd))
  const labB = rgbToOklab(parseHex(darkEnd))
  const accentLab = rgbToOklab(parseHex(c.accent))

  const neutralAt = (t, tintAmount) => {
    const lab = {
      L: labA.L + (labB.L - labA.L) * t,
      a: labA.a + (labB.a - labA.a) * t,
      b: labA.b + (labB.b - labA.b) * t,
    }
    if (tintAmount > 0) { // teinte des neutres vers l'accent, sans toucher à la clarté
      lab.a += (accentLab.a - lab.a) * tintAmount * 0.5
      lab.b += (accentLab.b - lab.b) * tintAmount * 0.5
    }
    return toHex(oklabToRgb(lab))
  }
  // Rampe colorée : la teinte est conservée, la clarté balayée, le chroma fondu
  // aux extrémités (c'est ce que font les vraies rampes, et ça évite les néons).
  const colorAt = (anchorHex, t) => {
    const lab = rgbToOklab(parseHex(anchorHex))
    const L = clamp(lab.L + (0.5 - t) * 1.55 * opt.chroma, 0.12, 0.98)
    const k = (1 - Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.55) * opt.chroma
    return toHex(oklabToRgb({ L, a: lab.a * k, b: lab.b * k }))
  }

  const steps = staticSteps(base)
  const statics = {}
  for (const [family, list] of Object.entries(steps)) {
    for (const step of list) {
      const t = stepPosition(step)
      const name = `--dsw-static-${family}-${step}`
      if (family === 'neutral') statics[name] = neutralAt(t, opt.tint)
      else if (family === 'neutral-bluish') statics[name] = neutralAt(t, 0.35 + opt.tint)
      else {
        const role = FAMILY_OF_COLOR[family]
        statics[name] = colorAt(c[role] || c.accent, t)
      }
    }
  }

  // Les alias à valeur littérale : eux ne peuvent PAS suivre la rampe. C'est
  // précisément ce que rate un thème qui ne repeint que les primitifs.
  const literals = {
    '--dsw-alias-bg-mask-1': dark ? 'rgba(0, 0, 0, 0.50)' : 'rgba(0, 0, 0, 0.24)',
    '--dsw-alias-bg-mask-2': dark ? 'rgba(0, 0, 0, 0.20)' : 'rgba(0, 0, 0, 0.12)',
    '--dsw-alias-bg-mask-3': dark ? 'rgba(0, 0, 0, 0.62)' : 'rgba(0, 0, 0, 0.48)',
    '--dsw-alias-bg-mask-photo': dark ? 'rgba(0, 0, 0, 0.88)' : 'rgba(0, 0, 0, 0.88)',
    '--dsw-alias-bg-mask-drop': dark ? rgba(c.surfaceAlt, 0.70) : 'rgba(255, 255, 255, 0.70)',
    '--dsw-alias-bg-skeleton': rgba(c.fg, dark ? 0.07 : 0.04),
    '--dsw-alias-border-inverted': 'transparent',
    '--dsw-alias-border-inverted2': 'transparent',
    '--dsw-alias-border-l1': rgba(c.fg, dark ? 0.06 : 0.04),
    '--dsw-alias-border-l2': rgba(c.fg, dark ? 0.12 : 0.10),
    '--dsw-alias-border-l2-darkmode-thin': rgba(c.fg, 0.10),
    '--dsw-alias-border-l3': rgba(c.fg, dark ? 0.16 : 0.12),
    '--dsw-alias-border-l4': rgba(c.fg, dark ? 0.22 : 0.16),
    '--dsw-alias-brand-primary-new-colorprimary-new-color': c.accent,
    '--dsw-alias-button-primary-fill': 'var(--dsw-alias-brand-primary)',
    '--dsw-alias-button-tool-bar-fill': rgba(c.fgDim, dark ? 0.36 : 0.10),
    '--dsw-alias-button-tool-bar-fill-invisible': rgba(c.fgDim, dark ? 0.20 : 0.08),
    '--dsw-alias-button-tool-bar-hover': rgba(c.fgDim, dark ? 0.48 : 0.16),
    '--dsw-alias-interactive-bg-active': rgba(c.accent, dark ? 0.24 : 0.10),
    '--dsw-alias-interactive-bg-hover': rgba(c.accent, dark ? 0.14 : 0.06),
    '--dsw-alias-interactive-bg-hover-accent': rgba(c.accent, dark ? 0.22 : 0.14),
    '--dsw-alias-interactive-bg-hover-danger': rgba(c.error, 0.10),
    '--dsw-specific-menu': 'var(--dsw-alias-bg-layer-3)',
  }
  // Réglage « marque » : par défaut DSH garde une marque monochrome
  // (`brand-primary` = le neutre extrême). L'option la teinte par l'accent.
  if (opt.brandAccent) {
    literals['--dsw-alias-brand-primary'] = c.accent
    literals['--dsw-alias-brand-text'] = c.accent
    literals['--dsw-alias-button-primary-hover'] = toHex(oklabToRgb({
      ...rgbToOklab(parseHex(c.accent)),
      L: clamp(rgbToOklab(parseHex(c.accent)).L + (dark ? 0.08 : -0.08), 0.1, 0.95),
    }))
  }

  const out = {}
  for (const [name, value] of Object.entries(base)) {
    out[name] = name.startsWith('--dsw-static-')
      ? (statics[name] || value)   // primitif : dérivé
      : (literals[name] !== undefined ? literals[name] : value) // alias : officiel conservé, littéraux recalculés
  }
  return out
}

/** Résout les `var(--dsw-*)` d'un jeu compilé (2 passes suffisent ici). */
export function resolve(map) {
  const out = { ...map }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [k, v] of Object.entries(out)) {
      const m = /^var\((--dsw-[a-z0-9-]+)\)$/.exec(v)
      if (m && out[m[1]] !== undefined) out[k] = out[m[1]]
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// L'AUDIT. On mesure les paires que l'utilisateur regarde vraiment.
// ─────────────────────────────────────────────────────────────────────────────
export const AUDIT_PAIRS = [
  ['label-primary', '--dsw-alias-label-primary', '--dsw-alias-bg-base', 4.5],
  ['label-secondary', '--dsw-alias-label-secondary', '--dsw-alias-bg-base', 4.5],
  ['label-tertiary', '--dsw-alias-label-tertiary', '--dsw-alias-bg-base', 4.5],
  ['label sur panneau', '--dsw-alias-label-primary', '--dsw-alias-bg-layer-2', 4.5],
  ['brand-primary', '--dsw-alias-brand-primary', '--dsw-alias-bg-base', 3],
  ['link', '--dsw-alias-link', '--dsw-alias-bg-base', 4.5],
  ['état succès', '--dsw-alias-state-success-primary', '--dsw-alias-bg-base', 4.5],
  ['état alerte', '--dsw-alias-state-warn-primary', '--dsw-alias-bg-base', 4.5],
  ['état erreur', '--dsw-alias-state-error-primary', '--dsw-alias-bg-base', 4.5],
  ['texte sur bouton', '--dsw-alias-label-primary-foreground', '--dsw-alias-button-primary-fill', 4.5],
  // `markdown-code-block` est un JETON DE FOND (c'est le fond du bloc de code),
  // pas une encre. Le comparer à `bg-layer-1` mesurait deux fonds entre eux et
  // produisait un faux échec à 1,07:1. La paire utile est l'encre SUR ce fond.
  ['texte sur bloc de code', '--dsw-alias-label-primary', '--dsw-alias-markdown-code-block', 4.5],
  // Distinguabilité de deux FONDS : informative, mais NON réparable — on ne
  // corrige pas un fond en ajustant une encre. Le 5e champ le dit explicitement,
  // sans quoi la passe de réparation assombrissait le fond du bloc de code et
  // faisait chuter la lisibilité de la syntaxe mesurée juste après.
  ['code inline', '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-inline-code', 1.2, false],
  ['sidebar', '--dsw-alias-label-secondary', '--dsw-specific-sidebar-fill', 4.5],
]
export const SYNTAX_KEYS = ['keyword', 'string', 'comment', 'func', 'number', 'type', 'const']

/**
 * Mesure les paires d'un jeu compilé.
 * @param {{colors: object}} p palette
 * @param {Record<string,string>} resolved jetons déjà résolus
 * @returns {Array<{label:string, fg:string, bg:string, ratio:number, min:number, repairable:boolean}>}
 */
export function audit(p, resolved) {
  const rows = []
  for (const [label, fgTok, bgTok, min, repairable] of AUDIT_PAIRS) {
    const fg = resolved[fgTok], bg = resolved[bgTok]
    if (!fg || !bg || fg.startsWith('var(') || bg.startsWith('var(')) continue
    // `repairable === false` = paire INFORMATIVE : deux fonds à distinguer.
    // Elle est mesurée et affichée, mais elle n'entre ni dans le seuil WCAG
    // (qui ne juge que des encres) ni dans la passe de réparation.
    rows.push({ label, fg, bg, ratio: contrast(fg, bg), min, repairable: repairable !== false })
  }
  const codeBg = resolved['--dsw-alias-markdown-code-block']
  if (codeBg && !codeBg.startsWith('var(')) {
    for (const key of SYNTAX_KEYS) {
      const fg = p.colors.syn[key]
      rows.push({ label: 'syntaxe · ' + key, fg, bg: codeBg, ratio: contrast(fg, codeBg), min: 4.5, repairable: true })
    }
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// LA RÉPARATION.
// L'audit ne sert à rien s'il ne débouche sur rien. On corrige la CLARTÉ en
// OKLab — jamais la teinte : une palette réparée doit rester reconnaissable.
// On ne touche jamais au fond (le fond est le repère de l'utilisateur) : c'est
// toujours l'encre qui bouge, et seulement vers le côté qui augmente le
// contraste, jusqu'à dépasser le seuil avec une petite marge.
// `repare()` vit dans color-core.js : une correction de contraste ne doit pas
// exister en deux versions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applique la réparation au jeu compilé : chaque paire en échec voit son encre
 * remplacée par une valeur littérale réparée (les `var()` ne peuvent pas être
 * ajustés à la volée).
 * @param {Record<string,string>} compiled jetons compilés
 * @param {Array} [pairs] paires à examiner (défaut : les paires mesurables)
 * @param {Record<string,string>} syn couleurs de syntaxe — COPIE, mutée en place
 * @returns {{tokens: Record<string,string>, repaired: Array, failures: Array, syn: object}}
 */
export function repairTokens(compiled, pairs, syn) {
  const out = { ...compiled }
  const repaired = []
  const failures = []
  const list = pairs || AUDIT_PAIRS

  // 1. Les encres d'alias d'abord. Un FOND n'est jamais « réparé » : corriger un
  //    fond en bougeant une encre n'a pas de sens, et surtout cela décale les
  //    mesures suivantes. C'était le bug : le fond du bloc de code se faisait
  //    assombrir, puis la syntaxe était mesurée contre ce nouveau fond et
  //    paraissait encore pire après réparation qu'avant.
  let resolved = resolve(out)
  for (const [label, fgTok, bgTok, min, repairable] of list) {
    if (repairable === false) continue
    const fg = resolved[fgTok], bg = resolved[bgTok]
    if (!fg || !bg || fg.startsWith('var(') || bg.startsWith('var(')) continue
    if (contrast(fg, bg) >= min) continue
    const r = repare(fg, bg, min + 0.4)
    out[fgTok] = r.hex
    resolved[fgTok] = r.hex
    repaired.push({ label, from: fg, to: r.hex, ratio: contrast(r.hex, bg) })
    if (!r.reached) failures.push({ label, ratio: contrast(r.hex, bg), min })
  }

  // 2. La syntaxe ensuite, contre le fond de code TEL QU'IL EST APRÈS l'étape 1.
  //    `syn` est une COPIE : une palette du catalogue ne doit jamais être abîmée
  //    par un rendu (un aller-retour sur la case « réparer » la corromprait).
  resolved = resolve(out)
  const codeBg = resolved['--dsw-alias-markdown-code-block']
  if (codeBg && !codeBg.startsWith('var(')) {
    for (const key of SYNTAX_KEYS) {
      const fg = syn[key]
      if (contrast(fg, codeBg) >= 4.5) continue
      const r = repare(fg, codeBg, 4.9)
      syn[key] = r.hex
      repaired.push({ label: 'syntaxe · ' + key, from: fg, to: r.hex, ratio: contrast(r.hex, codeBg) })
      if (!r.reached) failures.push({ label: 'syntaxe · ' + key, ratio: contrast(r.hex, codeBg), min: 4.5 })
    }
  }
  return { tokens: out, repaired, failures, syn }
}

/**
 * Compte ce que le compilateur a réellement fait sur un schéma donné : combien
 * d'alias suivent la rampe (leur valeur officielle est un `var(--dsw-static-*)`)
 * et combien devaient être recalculés. Les chiffres DIFFÈRENT entre clair et
 * sombre — un seul jeton de la feuille DSH change de nature.
 */
export function coverage(TOKENS, scheme, compiled) {
  const official = TOKENS[scheme]
  const nonStatic = Object.keys(compiled).filter((k) => !k.startsWith('--dsw-static-'))
  const isVar = (k) => (official[k] || '').startsWith('var(')
  return {
    derived: Object.keys(compiled).filter((k) => k.startsWith('--dsw-static-')).length,
    follow: nonStatic.filter((k) => (official[k] || '').startsWith('var(--dsw-static-')).length,
    indirect: nonStatic.filter((k) => isVar(k) && !(official[k] || '').startsWith('var(--dsw-static-')).length,
    literals: nonStatic.filter((k) => !isVar(k)).length,
    total: Object.keys(compiled).length,
  }
}
