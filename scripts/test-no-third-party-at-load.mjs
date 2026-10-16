// A page of DSH with the Kybernos plugins loaded asks no third party for anything the person did not ask for.
//   node scripts/test-no-third-party-at-load.mjs
//
// A6-13: every page load asked fonts.googleapis.com for a stylesheet (IBM Plex Mono, for a console nobody could open): Google got the
// IP, the user agent and a Referer of 127.0.0.1:<port> each time, from a product that says « nothing leaves your machine », and a hosted
// instance behind a strict CSP stalled on it. The provider logos of the Models page asked cdn.simpleicons.org in the same way.
//
// 1. No shipped file names a font, icon or stylesheet host, or `@import`s an address: fonts and icons are local or system ones.
// 2. The only third-party script hosts left are fallbacks that run on demand, when a local copy answers 404 (a map, a flow diagram):
//    each is listed with how many times it appears and why, so a new one has to be argued here, and one that goes away fails too.
//
// Tests, documents and third-party data are not shipped code and are skipped, as in test-no-legacy-hosts.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'vendor' && name !== '.git') walk(path); continue }
    files.push(path)
  }
}
walk(join(ROOT, 'packages'))
const skipped = (rel) => /(^|\/)(test[^/]*|lib-test[^/]*|lib-proxy-env[^/]*|check-[^/]*)\.mjs$/.test(rel) || /\.md$/.test(rel) || /provider-catalog\.json$/.test(rel) || /\.(svg|png|jpg|jpeg|webp|woff2?|ttf|otf|gz|zst|tgz)$/.test(rel)
const shipped = []
for (const path of files) {
  const rel = relative(ROOT, path)
  if (skipped(rel)) continue
  let text = null
  try { text = readFileSync(path, 'utf8') } catch (e) { continue }
  if (text.indexOf('\u0000') >= 0) continue
  shipped.push({ rel, text })
}

console.log('no font, icon or stylesheet host in shipped code')
{
  const FORBIDDEN = [
    { re: /fonts\.googleapis\.com/g, what: 'Google Fonts stylesheet' },
    { re: /fonts\.gstatic\.com/g, what: 'Google Fonts files' },
    { re: /cdn\.simpleicons\.org/g, what: 'simple-icons CDN' },
    { re: /@import\s+(?:url\(\s*)?['"]?https?:/g, what: 'a CSS @import of an address' },
    { re: /<link[^>]+rel=["']?(?:stylesheet|preload|preconnect)[^>]+href=["']?https?:/gi, what: 'a <link> to a stylesheet, preload or preconnect on another host' },
  ]
  check('there is shipped code to look at', shipped.length > 100, shipped.length)
  const hits = []
  for (const f of shipped) for (const rule of FORBIDDEN) {
    rule.re.lastIndex = 0
    const m = f.text.match(rule.re)
    if (m !== null) hits.push(f.rel + ' — ' + rule.what + ' (' + m.length + ')')
  }
  check('none of: Google Fonts, the simple-icons CDN, an @import or a <link> to another host', hits.length === 0, hits.join('; '))
}

console.log('the third-party script hosts that are left run on demand, behind a local copy')
{
  const CDN = /https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|ajax\.googleapis\.com|code\.jquery\.com)[^\s'"`)<>]*/g
  const ALLOWED = [
    { file: 'packages/kybernos-plugin/client.js', host: 'https://unpkg.com/@xyflow', count: 2, why: 'React Flow: tried only when the host\'s own /kybernos/vendor/xyflow.* answers 404 (an older host), when a diagram opens' },
    { file: 'packages/kybernos-plugin/kb-places.js', host: 'https://cdn.jsdelivr.net/npm/leaflet', count: 2, why: 'Leaflet: tried only when /kybernos/vendor/leaflet.* answers 404, when a map opens' },
  ]
  const found = new Map()
  for (const f of shipped) {
    for (const m of f.text.match(CDN) || []) {
      const allowed = ALLOWED.find((a) => a.file === f.rel && m.startsWith(a.host))
      const key = allowed ? allowed.file + ' ' + allowed.host : f.rel + ' ' + m
      found.set(key, (found.get(key) || 0) + 1)
    }
  }
  const unlisted = [...found.keys()].filter((k) => !ALLOWED.some((a) => a.file + ' ' + a.host === k))
  check('no other CDN is named (a new one has to be argued in this list)', unlisted.length === 0, unlisted.join('; '))
  for (const a of ALLOWED) {
    const n = found.get(a.file + ' ' + a.host) || 0
    check(a.file + ' · ' + a.host + ' appears ' + a.count + ' times (' + a.why + ')', n === a.count, n)
  }
}

console.log('\n' + (failed === 0 ? 'ALL GREEN' : String(failed) + ' FAILED'))
process.exit(failed === 0 ? 0 : 1)
