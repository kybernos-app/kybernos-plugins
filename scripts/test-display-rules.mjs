// Display rules of the plugins' own CSS, read from the source (no GUI, no browser).
//
//   node scripts/test-display-rules.mjs
//
// Each rule here comes from a defect measured on the real GUI by scripts/check-display-live.mjs:
//  - a literal white text on a fill that is too light to carry it (the orange #ff7a1a, the success green, an accent
//    variable that may be a pastel): 2.1 to 2.8:1. The ink there is #0f1115;
//  - an error note filled with `state-error-secondary`: that token is a SOLID red, so the error text on it was 1.0:1 (dark)
//    and 1.4:1 (light). The soft fill is a mix of the primary;
//  - a switch knob that is a literal white on a track filled with the brand token, which is near-white in the dark scheme.
//
// Generated copies of DSH's own primitives (kybernos-plugin/shared-ui.css and the strings inlined from it) are not ours to
// edit and are skipped.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// KB_DISPLAY_ROOT points the scan at another packages folder (to prove the test fails on the old rules).
const ROOT = process.env.KB_DISPLAY_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let count = 0
const ok = (label, fn) => { fn(); count += 1; console.log('ok  ', label) }

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name === 'skills') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/(client\.js|\.css)$/.test(name) && name !== 'shared-ui.css') files.push(path)
  }
}
walk(ROOT)

/** One-line rules `selector{declarations}` of every client and stylesheet, with where they are. Lines are scanned one by one;
 *  a very long line is a generated string of DSH's primitives, not ours. */
const rules = []
const RULE = /([^{}]{1,240})\{([^{}]{1,1200})\}/g
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    if (text.length > 3000 || text.indexOf('{') < 0) return
    for (const m of text.matchAll(RULE)) rules.push({ file: relative(ROOT, file), line: i + 1, selector: m[1].trim(), body: m[2] })
  })
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*((?:var\\([^;]*?\\)|color-mix\\([^;]*?\\)|[^;])+)').exec(body)
  return m === null ? null : m[1].trim()
}
const WHITE = /^(#fff(fff)?|white)$/i
const where = (r) => r.file + ':' + r.line + ' ' + r.selector.slice(-60)

ok('the rule scan reads the plugins', () => assert.ok(rules.length > (process.env.KB_DISPLAY_ROOT ? 10 : 1000), String(rules.length)))

ok('no literal white text on the orange #ff7a1a, the success green or an accent variable', () => {
  const bad = rules.filter((r) => {
    const fg = decl(r.body, 'color')
    const bg = decl(r.body, 'background(?:-color)?')
    if (fg === null || bg === null || !WHITE.test(fg)) return false
    return /^#ff7a1a$/i.test(bg) || /^var\(--dsw-alias-state-(success|warn)-primary/.test(bg) || /^var\(--acc\)$/.test(bg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('the success fills carry the dark ink, not the label pair of the brand fill', () => {
  const bad = rules.filter((r) => {
    const fg = decl(r.body, 'color')
    const bg = decl(r.body, 'background(?:-color)?')
    return fg !== null && bg !== null && /^var\(--dsw-alias-state-success-primary/.test(bg) && /^var\(--dsw-alias-label-primary-foreground/.test(fg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('no error note is filled with the solid state-error-secondary token', () => {
  const bad = rules.filter((r) => {
    const bg = decl(r.body, 'background(?:-color)?')
    const fg = decl(r.body, 'color')
    return bg !== null && fg !== null && /^var\(--dsw-alias-state-error-secondary/.test(bg) && /state-error-primary/.test(fg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('a switch knob is not a literal white on a brand-token track (.kbw-sw)', () => {
  const knob = rules.find((r) => /^\.kbw-sw-kn$/.test(r.selector))
  assert.ok(knob, '.kbw-sw-kn is defined')
  assert.doesNotMatch(decl(knob.body, 'background'), WHITE, 'the off knob follows the theme')
  const on = rules.find((r) => /^\.kbw-sw\.on \.kbw-sw-kn$/.test(r.selector))
  assert.ok(on, 'the on knob has its own pair')
  assert.match(decl(on.body, 'background'), /label-primary-foreground/, 'the on knob is the label pair of the brand fill')
})

ok('the off track of the Theme page toggles is not layer-3 (white in the light scheme)', () => {
  const toggle = rules.find((r) => r.file.startsWith('kybernos-theme/') && /^\.kbth-toggle$/.test(r.selector))
  assert.ok(toggle, '.kbth-toggle is defined')
  assert.doesNotMatch(decl(toggle.body, 'background'), /bg-layer-3/)
})

ok('the "+" tile of the New chat button is a tint of the button\'s own label colour, not bg-overlay', () => {
  const tile = rules.find((r) => r.file.startsWith('kybernos-plugin/') && /^\.kb4-plus$/.test(r.selector))
  assert.ok(tile, '.kb4-plus is defined')
  assert.doesNotMatch(decl(tile.body, 'background'), /bg-overlay/)
  assert.match(decl(tile.body, 'background'), /label-primary-foreground/)
})

ok('kybernos-plugin does not define .kbf-hint: kybernos-cloud owns that class name (its 60%-opacity mono leaked onto the account hints)', () => {
  const clash = rules.filter((r) => r.file.startsWith('kybernos-plugin/') && /(^|[\s,>+~])\.kbf-hint\b/.test(r.selector))
  assert.deepEqual(clash.map(where), [])
})

console.log('\n' + count + ' tests passed')
