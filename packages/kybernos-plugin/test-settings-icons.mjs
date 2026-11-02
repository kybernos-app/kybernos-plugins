#!/usr/bin/env node
// No two entries of the Settings menu wear the same icon (audit V-25): the icon table of client.js, read without a browser.
//
//   node packages/kybernos-plugin/test-settings-icons.mjs
//
// Born from the audit of 2026-10-16: Appearance and Theme both showed the palette. The menu had TWO icon tables: ICONES (an inline drawing
// per page, put on by the organiser) and a second one (KB_NAV_ICONES) that painted a mask over the first when the icon catalogue had come
// from the server, by the page's drawn label. The second one made Theme a palette again, but only while the server answered and only in
// English: no test could say which picture a page wore. There is one table now (ICONES, keyed by the page's title, the same in every
// language), and this test reads it: a drawing is the same drawing when its geometry is the same, whatever its stroke.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// ── The pages of the menu: the title each key stands for.
const keysBlock = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(SRC)
const PAGES = keysBlock === null ? [] : [...keysBlock[1].matchAll(/'?([A-Za-z0-9_-]+)'?:\s*'([^']+)'/g)].map((m) => ({ key: m[1], title: m[2] }))

// ── The table: `const ICONES = { 'title': '<path …' + trait + '/>', … }`, run with the same `trait` the organiser uses.
const a = SRC.indexOf('const ICONES = {')
const b = SRC.indexOf('\n      }\n', a)
const traitLine = /const trait = ('[^\n]*')\n/.exec(SRC.slice(0, a))
const ICONES = a < 0 || b < 0 || traitLine === null ? {} : new Function('trait', 'return ' + SRC.slice(a + 'const ICONES = '.length, b + 8))(new Function('return ' + traitLine[1])())

const STROKE = new Set(['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'])
const num = (s) => s.replace(/-?\d*\.?\d+/g, (x) => String(Number(x)))
/** The geometry of a drawing, whatever its stroke: one line per element, attributes sorted, numbers normalised (« .5 » is « 0.5 »). */
const geometry = (svg) => [...svg.matchAll(/<(\w+)\s([^>]*?)\s*\/?>/g)].map((m) => {
  const attrs = [...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].filter((x) => !STROKE.has(x[1]) && !(x[1] === 'fill' && x[2] === 'none')).map((x) => x[1] + '=' + num(x[2])).sort()
  return m[1] + ' ' + attrs.join(' ')
}).sort().join('\n')

console.log('the table')
check('the pages of the menu were found (KB_NAV_KEYS)', PAGES.length >= 25, PAGES.length)
check('the icon table was found and holds a drawing per entry', Object.keys(ICONES).length >= 40, Object.keys(ICONES).length)
const missing = PAGES.filter((p) => typeof ICONES[p.title] !== 'string' || ICONES[p.title].indexOf('<') !== 0)
check('every page of the menu has a drawing (none falls back to the shell\'s gear)', missing.length === 0, missing.map((p) => p.title))
const empty = PAGES.filter((p) => typeof ICONES[p.title] === 'string' && geometry(ICONES[p.title]) === '')
check('and every drawing has something in it', empty.length === 0, empty.map((p) => p.title))

console.log('the icons are all different (V-25)')
const byDrawing = new Map()
for (const p of PAGES) {
  if (typeof ICONES[p.title] !== 'string') continue
  const g = geometry(ICONES[p.title])
  if (!byDrawing.has(g)) byDrawing.set(g, [])
  byDrawing.get(g).push(p.title)
}
const twins = [...byDrawing.values()].filter((titles) => titles.length > 1)
check('no two pages of the menu share a drawing', twins.length === 0, twins)
// Appearance and Theme were the pair of the audit: the same palette, one by the table and one by the mask over it.
const palette = geometry(ICONES.appearance || '')
check('Appearance keeps the palette and Theme has a picture of its own', palette !== '' && geometry(ICONES.theme || '') !== '' && geometry(ICONES.theme || '') !== palette)

console.log('one table, not two')
check('no second table paints over the first (the mask pipeline is gone: its picture depended on the server and on the language)', !/KB_NAV_ICONES|kbDecorateSettingsNav|data-kb-nav/.test(SRC))
// The other languages' spellings of a title share the drawing of the English one: the variants loop of the organiser copies it.
const vFrom = SRC.indexOf('for (const [variante, base] of Object.entries({')
const vTo = SRC.indexOf('})) {', vFrom)
const variants = vFrom < 0 || vTo < 0 ? [] : [...SRC.slice(vFrom, vTo).matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]])
check('the Spanish spellings the organiser knows lead to a title that has a drawing', variants.length >= 6 && variants.every(([, base]) => typeof ICONES[base] === 'string'), variants)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
