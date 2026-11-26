// The tiles and the Settings links of the Suite panel (client.js): what is data there is checked here, because the art
// is injected as HTML and the links point at sections that other bundles register.
//   node test-suite-art.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HUB = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(HUB, 'client.js'), 'utf8')
const catalogue = JSON.parse(readFileSync(join(HUB, 'catalog.json'), 'utf8'))
const ids = new Set(catalogue.modules.map((m) => m.id))

let fails = 0
let total = 0
const ok = (name, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + name); else { fails += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

// The two tables are object literals of the client: read them as the client does, without running the client.
const literal = (name, stop) => {
  const a = client.indexOf('    const ' + name + ' = {')
  const b = client.indexOf(stop, a)
  if (a < 0 || b < 0) return null
  // eslint-disable-next-line no-new-func
  return new Function('return ' + client.slice(a + ('    const ' + name + ' = ').length, b))()
}
const ART = literal('ART', '    const TUILE')
const REGLAGES = literal('REGLAGES', '    const ICONES')

console.log('the plugin tiles')
ok('the table is there', ART !== null && Object.keys(ART).length > 20, ART === null ? null : Object.keys(ART).length)
const bad = Object.entries(ART).filter(([id, v]) => !ids.has(id) || !Array.isArray(v) || v.length !== 3 || !/^#[0-9a-f]{6}$/i.test(v[0]) || !/^#[0-9a-f]{6}$/i.test(v[1]) || !/^<g>[\s\S]*<\/g>$/.test(v[2])).map(([id]) => id)
ok('every entry is a module of the catalogue, two hex colours and a <g> fragment', bad.length === 0, bad)
// The fragment is put in the page as HTML: only drawing elements and their geometry, nothing that runs or loads.
const ALLOWED_TAGS = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'])
const ALLOWED_ATTRS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'opacity', 'transform', 'stroke-dasharray', 'fill-rule'])
const unsafe = []
for (const [id, v] of Object.entries(ART)) {
  for (const m of v[2].matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (!ALLOWED_TAGS.has(m[1])) unsafe.push(id + ': <' + m[1] + '>')
    for (const a of m[2].matchAll(/\s([\w:-]+)\s*=/g)) if (!ALLOWED_ATTRS.has(a[1])) unsafe.push(id + ': ' + a[1])
  }
  if (/url\(|javascript:|<script|<style|<image|<use|&#|\bon\w+\s*=/i.test(v[2].replace(/rgba?\([^)]*\)/g, ''))) unsafe.push(id + ': a reference or a script')
}
ok('only drawing elements and their geometry: nothing that runs, loads or references', unsafe.length === 0, unsafe.slice(0, 5))
const without = [...ids].filter((id) => ART[id] === undefined)
ok('a module with no illustration keeps its glyph (the fallback exists for each one named in the catalogue)', without.every((id) => catalogue.modules.find((m) => m.id === id).glyphe !== undefined), without)

console.log('the Settings links')
ok('the table is there', REGLAGES !== null && Object.keys(REGLAGES).length > 5)
ok('every key is a module of the catalogue', Object.keys(REGLAGES).every((id) => ids.has(id)), Object.keys(REGLAGES).filter((id) => !ids.has(id)))
// A section id must be one a bundle registers (`settings.section`), or the link would never find its cell.
const PACKAGES = join(HUB, '..')
const registered = new Set()
for (const d of readdirSync(PACKAGES)) {
  const f = join(PACKAGES, d, 'client.js')
  if (!existsSync(f) || d === 'kybernos-hub') continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/name: *'settings\.section', *id: *'([^']+)'/g)) registered.add(m[1])
  for (const m of src.matchAll(/(?:SURFACE_ID|const \w*SECTION\w*) *= *'([^']+)'/g)) registered.add(m[1])
}
const missing = Object.entries(REGLAGES).filter(([, section]) => !registered.has(section)).map(([id, section]) => id + ' → ' + section)
ok('every section id is registered by a bundle of this repository', missing.length === 0, missing)

console.log('\n' + (fails === 0 ? '✓ ' + total + ' checks' : '✗ ' + fails + ' of ' + total + ' failed'))
process.exit(fails === 0 ? 0 : 1)
