// kybernos-db, the vendored map library (vendor/): the files are the ones NOTICES.md names, byte for byte (sha256), the licence travels with them, and the routes serve
// those two files and nothing else of the folder.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR_ROUTES, vendorHandler } from './routes.mjs'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'vendor')
let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const sha = (file) => createHash('sha256').update(readFileSync(join(dir, file))).digest('hex')
const notices = readFileSync(join(dir, 'NOTICES.md'), 'utf8')

ok('every file of vendor/ has the sha256 NOTICES.md gives for it', () => {
  for (const file of ['maplibre-gl.js', 'maplibre-gl.css', 'MAPLIBRE-LICENSE']) {
    const m = new RegExp('`' + file.replace(/\./g, '\\.') + '`\\s+`([0-9a-f]{64})`').exec(notices)
    assert.ok(m !== null, file + ' has no hash in NOTICES.md')
    assert.equal(sha(file), m[1], file)
  }
})
ok('the folder holds the library, its stylesheet, its licence and the notice, nothing else', () => {
  assert.deepEqual(readdirSync(dir).sort(), ['MAPLIBRE-LICENSE', 'NOTICES.md', 'maplibre-gl.css', 'maplibre-gl.js'])
  assert.ok(/BSD 3-Clause/.test(notices) && /5\.24\.0/.test(notices))
})
ok('the routes name those two files only', () => {
  assert.deepEqual(Object.keys(VENDOR_ROUTES).sort(), ['vendor/maplibre-gl.css', 'vendor/maplibre-gl.js'])
  for (const [file] of Object.values(VENDOR_ROUTES)) assert.ok(readdirSync(dir).includes(file), file)
})

const reply = () => { const r = { status: 0, headers: {}, body: null, writeHead (s, h) { r.status = s; Object.assign(r.headers, h) }, setHeader (k, v) { r.headers[k] = v }, end (b) { r.body = b === undefined ? null : b } }; return r }
const [jsFile, jsType] = VENDOR_ROUTES['vendor/maplibre-gl.js']
const asked = async (method, extra) => { const r = reply(); await vendorHandler(jsFile, jsType)({ method, url: '/kybernos-db/vendor/maplibre-gl.js', headers: Object.assign({ host: '127.0.0.1:3080' }, extra || {}), socket: { localPort: 3080 } }, r); return r }
const wait = async (fn) => { try { return await fn() } catch (e) { return e } }
await wait(async () => {
  // no session cookie: the guard (session-guard.mjs) refuses, like every data route
  const refused = await asked('GET')
  ok('without DSH’s signed session the library is refused, not served', () => { assert.ok(refused.status === 401 || refused.status === 403, String(refused.status)); assert.equal(refused.body === null || typeof refused.body === 'string', true) })
  const other = await asked('GET', { host: 'evil.example:3080' })
  ok('a Host that is not this listener’s is refused before anything else', () => assert.equal(other.status, 403))
  const post = await asked('POST')
  ok('only GET and HEAD are answered', () => assert.equal(post.status, 405))
})
console.log(failed === 0 ? '\nkybernos-db vendor: all checks passed' : '\nkybernos-db vendor: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
