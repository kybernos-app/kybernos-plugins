// Guards that stop the visual sprawl of the bundles from growing (audit WP-15, read from the source, no browser).
//
//   node scripts/test-consistency-guards.mjs            # the checks
//   node scripts/test-consistency-guards.mjs --update   # rewrite scripts/consistency-baseline.json from the tree as it is
//
// Decision D2 (2026-10-16): no shared component library yet, the owner has not chosen the recipe. Until then these checks keep today's
// numbers from getting worse, and only that:
//  - A1-15  a bundle that animates anything has a prefers-reduced-motion rule, and the three that had none name every animated class in it;
//  - A1-04  two bundles do not declare the same class selector differently (the stylesheet is global: the later bundle restyles the other's
//           page), and no class prefix is shared by a bundle that did not share it yesterday;
//  - A1-13  no bundle adds a literal status colour (a green, amber or red hex in a colour declaration, outside var(--x, #fallback));
//  - A1-14  no bundle adds a font-size value that is not already in use somewhere;
//  - A1-16  no bundle shouts a label with text-transform: uppercase (a short list of design exceptions).
// The last three compare with scripts/consistency-baseline.json, the numbers of the day it was written. A value that goes away is fine (the test
// says so; --update lowers the ceiling). A value that appears fails, and the way out is a token, or a value already in the baseline, or a baseline
// update that the reviewer sees in the diff. Nothing here is a style guide: the day the owner picks the recipe, these become the ratchet of it.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keyframesByBundle, prefixOf, prefixUsers, shared, sourceFiles } from './audit-css-prefixes.mjs'

// KB_GUARDS_ROOT points the scan at another packages folder (to prove a check fails on a tree that has the defect).
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.KB_GUARDS_ROOT || join(HERE, '..', 'packages')
const BASELINE = join(HERE, 'consistency-baseline.json')
let count = 0
const failed = []
const ok = (label, fn) => {
  try { fn(); count += 1; console.log('ok  ', label) } catch (e) { if (!process.env.KB_GUARDS_KEEP_GOING) throw e; failed.push(label); console.log('FAIL', label, '-', String(e.message).split('\n')[0].slice(0, 200)) }
}

const bundles = readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory()).sort()
const clientOf = (b) => { try { return readFileSync(join(ROOT, b, 'client.js'), 'utf8') } catch (e) { return null } }

// ── the numbers of the day ────────────────────────────────────────────────────────────────────────────────────────────────────
/** `var(--x, #fallback)`: the fallback is not a literal colour of the bundle, the token is. Hex digits inside any var( ... ) are dropped. */
const withoutVarFallbacks = (text) => {
  let out = ''
  let i = 0
  while (i < text.length) {
    const j = text.indexOf('var(', i)
    if (j < 0) { out += text.slice(i); break }
    out += text.slice(i, j)
    let depth = 1
    let k = j + 4
    for (; k < text.length && depth > 0; k += 1) { if (text[k] === '(') depth += 1; else if (text[k] === ')') depth -= 1 }
    out += 'var(' + text.slice(j + 4, k - 1).replace(/#[0-9a-fA-F]{3,8}\b/g, '') + ')'
    i = k
  }
  return out
}
const hsl = (hex) => {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const hh = mx === r ? ((g - b) / d) % 6 : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4)
  return { h: (hh * 60 + 360) % 360, s, l }
}
/** `green`, `amber` or `red` for a saturated mid-tone hex, else null (greys, blues, near-black and near-white are not status colours). */
const statusKind = (hex) => {
  const { h, s, l } = hsl(hex)
  if (s < 0.4 || l < 0.25 || l > 0.82) return null
  if (h >= 345 || h <= 14) return 'red'
  if (h >= 15 && h <= 64) return 'amber'
  if (h >= 78 && h <= 165) return 'green'
  return null
}
const COLOUR_DECL = /(?<![\w-])(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color)\s*:\s*([^;{}\n]*)/g
/** Bundle -> sorted distinct status hexes written in a colour declaration (the generated shared-ui.css is not ours). */
const statusColours = () => {
  const out = {}
  for (const b of bundles) {
    const found = new Set()
    for (const file of sourceFiles(join(ROOT, b))) {
      const text = withoutVarFallbacks(readFileSync(file, 'utf8'))
      for (const d of text.matchAll(COLOUR_DECL)) {
        for (const m of d[1].matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) { if (statusKind(m[0]) !== null) found.add(m[0].toLowerCase()) }
      }
    }
    if (found.size > 0) out[b] = [...found].sort()
  }
  return out
}
/** Sorted distinct values written after `font-size:` across the bundles (a value that is computed with ${} is not a value). */
const fontSizes = () => {
  const found = new Set()
  for (const b of bundles) {
    for (const file of sourceFiles(join(ROOT, b))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/font-size\s*:\s*([^;}'"`\n]+)/g)) {
        const v = m[1].replace(/\s*!important\s*$/, '').replace(/\s+/g, ' ').trim()
        if (v !== '' && !v.includes('${')) found.add(v)
      }
    }
  }
  return [...found].sort()
}
/** Prefix -> sorted bundles, for the class prefixes used by more than one bundle. */
const sharedPrefixes = () => {
  const out = {}
  for (const [prefix, per] of [...prefixUsers(ROOT)].sort()) { if (per.size > 1) out[prefix] = [...per.keys()].sort() }
  return out
}
const today = () => ({ cssPrefixes: sharedPrefixes(), statusColours: statusColours(), fontSizes: fontSizes() })

if (process.argv.includes('--update')) {
  const next = { note: 'Written by scripts/test-consistency-guards.mjs --update. A value may leave this file at any time; it may only enter it in a reviewed diff.', ...today() }
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n')
  console.log('baseline written: ' + Object.keys(next.cssPrefixes).length + ' shared prefixes, ' + Object.values(next.statusColours).flat().length + ' status colour literals in ' + Object.keys(next.statusColours).length + ' bundles, ' + next.fontSizes.length + ' font sizes')
  process.exit(0)
}

// ── A1-15 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The text of every `@media (prefers-reduced-motion: reduce) { … }` block of a source. */
const reducedBlocks = (text) => {
  const out = []
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let m
  while ((m = re.exec(text)) !== null) {
    let depth = 1, i = m.index + m[0].length
    for (; i < text.length && depth > 0; i += 1) { if (text[i] === '{') depth += 1; else if (text[i] === '}') depth -= 1 }
    out.push(text.slice(m.index, i))
  }
  return out
}
/** The rules `selector{…animation: <name>…}` of a source: every class that is animated. */
const animatedClasses = (text) => {
  const found = new Set()
  for (const r of text.matchAll(/([^{}]{1,400})\{([^{}]{1,1500})\}/g)) {
    const a = /(?:^|[;\s])animation(?:-name)?\s*:\s*([^;]+)/.exec(r[2])
    if (a === null || /^\s*(none|inherit|initial|unset)\b/.test(a[1])) continue
    const sel = r[1].split(/[\n`]/).pop()
    for (const c of sel.matchAll(/\.([A-Za-z_][\w-]*)/g)) found.add(c[1])
  }
  return found
}

ok('A1-15: every bundle that declares an @keyframes or an animation has a prefers-reduced-motion rule', () => {
  const bad = bundles.filter((b) => {
    const text = clientOf(b)
    return text !== null && (/@keyframes\s/.test(text) || animatedClasses(text).size > 0) && reducedBlocks(text).length === 0
  })
  assert.deepEqual(bad, [])
})
// These three had none (kbsl-blink, kbsl-livedot, kbsl-pulse, kbsl-spin, kbsl-rise; the Slides cursor, its correction flash and its caret; the Ollama spinner):
// the rule must name every class they animate, and switch the animation off.
for (const [bundle, classes] of [
  ['kybernos-slash', ['kbsl-anim', 'kbsl-flash', 'kbsl-fbody']],
  ['kybernos-slides', ['ProseMirror-gapcursor', 'kbsd-cor', 'kbsd-caret']],
  ['kybernos-modeles-locaux', ['kml-spin']],
]) {
  ok('A1-15: ' + bundle + ' stops every animation it declares under reduced motion', () => {
    const text = clientOf(bundle)
    assert.ok(text !== null, bundle + ' has a client.js')
    const reduced = reducedBlocks(text).join('\n')
    assert.ok(reduced !== '', 'a reduced-motion block exists')
    assert.match(reduced, /animation\s*:\s*none/, 'it switches the animation off')
    const animated = animatedClasses(text)
    for (const c of classes) {
      assert.ok(animated.has(c), c + ' is an animated class (the list in this test is stale otherwise)')
      assert.match(reduced, new RegExp('\\.' + c.replace(/-/g, '\\-') + '\\b'), c + ' is named in the reduced-motion block')
    }
  })
}

// ── A1-04 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DSH's stylesheet is global. The same selector declared differently by two bundles means the page of one is drawn with the other's rules, and which wins
// depends on who injected last (on the Language page .kbth-btn computed to the Theme page's values). Identical copies are harmless (the DSH primitives are
// inlined in three bundles). A selector that one bundle restyles ON PURPOSE from another's class is listed here with its reason; the list must stay true.
const BY_DESIGN = [
  { prefix: 'kbf', bundles: ['kybernos-cloud', 'kybernos-plugin'], why: 'the core lays the sidebar footer out as a grid (display:contents on .kbf-root, rows and columns of .kbf-wsrow / .kbf-idrow) over the Cloud footer it does not draw' },
  { prefix: 'kbsl', bundles: ['kybernos-mobile', 'kybernos-slash'], why: 'the phone layout (mobile.css) re-lays out the Slash actions row' },
]
const byDesign = (f) => BY_DESIGN.some((a) => prefixOf(f.selector) === a.prefix && f.bundles.every((b) => a.bundles.includes(b.bundle)))
const collisions = () => shared(ROOT).filter((f) => !f.identical)
ok('A1-04: no class selector is declared differently by two bundles (a prefix belongs to one bundle)', () => {
  const bad = collisions().filter((f) => !byDesign(f))
  assert.deepEqual(bad.map((f) => f.selector + '  <-  ' + f.bundles.map((b) => b.at).join('  |  ')), [])
})
ok('A1-04: every by-design override above is still a live collision (the list does not go stale)', () => {
  const live = collisions()
  for (const a of BY_DESIGN) assert.ok(live.some((f) => prefixOf(f.selector) === a.prefix && f.bundles.every((b) => a.bundles.includes(b.bundle))), a.prefix + ' no longer collides: drop it from BY_DESIGN')
})
ok('A1-04: a @keyframes name defined by two bundles has the same body in both (the names are global too)', () => {
  const bad = [...keyframesByBundle(ROOT)].filter(([, per]) => new Set(per.values()).size > 1).map(([name, per]) => name + ' in ' + [...per.keys()].join(', '))
  assert.deepEqual(bad, [])
})

// ── A4-26 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The playback panels draw their transport bar one by one. Until one component exists (the owner's recipe), the vocabulary at least agrees:
// the speeds are 0.5x 1x 2x 4x, written « 0.5× », the number first, in Slides, the Modeleur and Bricks. (Motion has a time scrubber and a Loop
// switch and no speeds: nothing to align there.)
ok('A4-26: Slides, the Modeleur and Bricks offer the same speeds, written the same way (0.5× 1× 2× 4×)', () => {
  const slides = clientOf('kybernos-slides')
  assert.match(slides, /const vitesses = \[0\.5, 1, 2, 4\]/, 'Slides speeds')
  assert.match(slides, /\}, `\$\{v\}×`\)\)/, 'Slides writes the number first')
  assert.doesNotMatch(slides, /`×\$\{v\}`/, 'Slides no longer writes × before the number')
  for (const [bundle, p] of [['kybernos-modeleur', 'kbmo'], ['kybernos-bricks', 'kbb']]) {
    const text = clientOf(bundle)
    const labels = [...text.matchAll(new RegExp("className: '" + p + "-sp' \\+ \\(VITESSE === ([\\d.]+) \\? ' on' : ''\\), onClick: [^}]*\\} \\}, '([^']+)'\\)", 'g'))].map((m) => m[1] + '=' + m[2])
    assert.deepEqual(labels, ['0.5=0.5\\u00D7', '1=1\\u00D7', '2=2\\u00D7', '4=4\\u00D7'], bundle)
  }
})

// ── the ratchets: A1-04 (prefixes), A1-13, A1-14 ──────────────────────────────────────────────────────────────────────────────
const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
const nowShared = sharedPrefixes()
ok('A1-04: no class prefix is used by a bundle that did not use it yesterday (a new bundle takes a new prefix, or the baseline shows the sharing in a diff)', () => {
  const grew = []
  for (const [prefix, list] of Object.entries(nowShared)) {
    const before = base.cssPrefixes[prefix] || []
    const added = list.filter((b) => !before.includes(b))
    if (added.length > 0) grew.push('.' + prefix + '-*: ' + added.join(', ') + (before.length === 0 ? ' (a prefix nobody shared)' : ' joins ' + before.join(', ')))
  }
  assert.deepEqual(grew, [], 'run with --update only when the sharing is intended')
})
ok('A1-13: no bundle adds a literal green, amber or red hex in a colour declaration (use var(--dsw-alias-state-{success,warn,error}-primary))', () => {
  const now = statusColours()
  const added = []
  for (const [b, list] of Object.entries(now)) {
    const before = base.statusColours[b] || []
    const fresh = list.filter((x) => !before.includes(x))
    if (fresh.length > 0) added.push(b + ': ' + fresh.join(' '))
  }
  assert.deepEqual(added, [])
})
ok('A1-14: no bundle introduces a font-size value that is not already in use (the scale is 11 / 12 / 13 / 14 / 16 / 20; half pixels are the sprawl)', () => {
  const fresh = fontSizes().filter((v) => !base.fontSizes.includes(v))
  assert.deepEqual(fresh, [])
})
// A1-16 (UX audit 2026-10-20): titles, labels, column headers and badges are written in sentence case, so no stylesheet shouts them with
// text-transform: uppercase. The few that stay are design, not labels: the Beta pill (pinned by test-newchat), the initials of an avatar,
// the kicker and footer of a slide, the tiny labels drawn inside a dashboard thumbnail. A new one is a label: write it in sentence case.
const SHOUTING_ALLOWED = { 'kybernos-plugin': 1, 'kybernos-refs': 1, 'kybernos-slides': 2, 'kybernos-dashboards': 2 }
ok('A1-16: no bundle shouts a label with text-transform: uppercase (the Beta pill, avatar initials, slide kicker and dashboard thumbnails are the only ones)', () => {
  const over = []
  for (const b of bundles) {
    const src = clientOf(b)
    if (src === null) continue
    const n = (src.match(/text-transform:\s*uppercase|textTransform:\s*'uppercase'/g) || []).length
    if (n > (SHOUTING_ALLOWED[b] || 0)) over.push(b + ' ' + n + ' (allowed ' + (SHOUTING_ALLOWED[b] || 0) + ')')
  }
  assert.deepEqual(over, [])
})
{
  // not a check: what the baseline could shed today, said once so that the ceiling gets lowered
  const spare = []
  const sc = statusColours()
  for (const [b, list] of Object.entries(base.statusColours)) { const gone = list.filter((x) => !(sc[b] || []).includes(x)); if (gone.length > 0) spare.push(b + ' ' + gone.length + ' colour') }
  const fs = new Set(fontSizes())
  const goneSizes = base.fontSizes.filter((v) => !fs.has(v))
  if (goneSizes.length > 0) spare.push(goneSizes.length + ' font sizes')
  const goneShared = Object.keys(base.cssPrefixes).filter((p) => nowShared[p] === undefined)
  if (goneShared.length > 0) spare.push(goneShared.length + ' shared prefixes')
  if (spare.length > 0) console.log('note: the baseline holds what is gone (' + spare.join(', ') + '): node scripts/test-consistency-guards.mjs --update lowers it')
}

console.log('\n' + count + ' tests passed' + (failed.length > 0 ? ', ' + failed.length + ' failed' : ''))
if (failed.length > 0) process.exit(1)
