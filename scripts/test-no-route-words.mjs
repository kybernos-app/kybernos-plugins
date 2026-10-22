// ── No sentence a person reads talks about « routes » ─────────────────────────────────────────────────────────────────
//
// When a part of Kybernos is not loaded (DSH was not restarted after an update) several pages said « route missing », « host routes only mount at startup »,
// « route /kybernos/voice/config unavailable »: words of the code, with a path, for something the person fixes by restarting DSH once. They now say what is
// not available and what to do. This guard keeps the words out of the clients, line by line (the sentences handed to `kt(fr, en)` and `kbe(en)`, the
// `{ fr, en }` entries of a bundle's own table and the KB_FR_EN translation table). A route is still a word of the code and of the model routes (« the model it uses, {route} » is the
// person's own provider/model pair): only the phrases below, which name an HTTP route, are refused.
//
//   node scripts/test-no-route-words.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BAD = /\broutes?\s+(?:\/|absente|absent|missing|unreachable|injoignable|indisponible|unavailable|not mounted)|\bhost routes?\b|\broutes? de l[’']hôte|\broutes? d[’']appel|\bcall routes?\b|\broutes? des réglages|\bsettings route\b/i
// Lines that carry a MACHINE code the page matches on (never shown): the language client's ROUTE_ABSENT / UNREACHABLE.
const MACHINE = /ROUTE_ABSENT|UNREACHABLE|'HTTP_' \+/

const hits = []
let lines = 0
for (const pkg of readdirSync(join(root, 'packages')).sort()) {
  const file = join(root, 'packages', pkg, 'client.js')
  if (!existsSync(file)) continue
  let inBlock = false
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    lines += 1
    if (inBlock) { if (line.includes('*/')) inBlock = false; return }
    if (/^\s*\/\*/.test(line)) { if (!line.includes('*/')) inBlock = true; return }
    if (/^\s*(\/\/|\*)/.test(line) || MACHINE.test(line)) return
    // The whole line, trailing comment cut: the translation tables (KB_FR_EN) are plain `'fr': 'en'` lines no kt()/kbe() call frames, and a regex over quotes
    // loses a literal that follows another quote on a long line.
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/\s.*$/, '')
    const m = BAD.exec(code)
    if (m !== null) hits.push(pkg + '/client.js:' + String(i + 1) + '  ' + code.trim().slice(Math.max(0, m.index - 30), m.index + 80))
  })
}
let failed = 0
console.log((hits.length === 0 ? '  ✓ ' : '  ✗ ') + 'no sentence of a client names an HTTP route (' + lines + ' lines read)' + (hits.length === 0 ? '' : '\n    ' + hits.join('\n    ')))
if (hits.length > 0) failed += 1
// The guard sees what it is meant to see (a faulty sentence of each family is refused, a person's model route is not).
for (const bad of ['route /kybernos/voice/config unavailable', 'les routes d’appel ne sont pas chargées', 'Host routes only mount at startup', 'Settings route unreachable', 'route missing (HTTP 404)']) {
  if (!BAD.test(bad)) { console.log('  ✗ the guard misses « ' + bad + ' »'); failed += 1 }
}
if (BAD.test('The model it uses, {route}, has no API key.')) { console.log('  ✗ the guard refuses the person’s own model route'); failed += 1 }
console.log(failed === 0 ? '\nNO ROUTE WORDS — 0 échec' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
