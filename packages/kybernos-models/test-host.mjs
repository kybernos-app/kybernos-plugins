#!/usr/bin/env node
/** Host harness for kybernos-models, parked providers: the routes on a fake
 *  webServer, a temporary store, no network and nothing written outside it. */
import { mkdtempSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kbm-host-'))
process.env.DSH_HOME = home
const { kbPkMount, kbPkRead, kbPkPublic, kbPkPark, kbPkTake, kbPkForget, kbSameOriginStrict, PARKED_VERSION } = await import('./index.js')

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 200) : '')) }
}

const file = join(home, 'parked.json')
const routes = {}
kbPkMount((r) => { routes[r.path] = r.handler }, file)

const PORT = 3080
const request = (method, path, body, headers) => {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method, url: path, socket: { localPort: PORT },
    headers: headers === undefined ? { origin: 'http://127.0.0.1:' + PORT } : headers,
    on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() },
  }
}
const response = () => {
  const r = { status: 0, body: null }
  r.writeHead = (s) => { r.status = s }
  r.end = (s) => { try { r.body = JSON.parse(s) } catch (e) { r.body = s } }
  return r
}
const call = async (path, method, body, headers) => { const r = response(); await routes[path](request(method, path, body, headers), r); return r }

const PROFILE = { displayName: 'Acme', api: 'openai-completions', baseURL: 'https://api.acme.example/v1', apiKeyEnv: 'ACME_KEY', headers: { 'x-secret': 'tok' }, models: [{ id: 'a-1' }, { id: 'a-2' }] }

console.log('\n── empty store ──')
let r = await call('/kybernos-models/providers/parked', 'GET')
ok('nothing parked reads as an empty list', r.status === 200 && r.body.ok === true && r.body.version === PARKED_VERSION && r.body.parked.length === 0, r.body)
ok('an unreadable file reads as empty, never throws', kbPkRead(join(home, 'absent.json')).providers !== undefined)

console.log('\n── park ──')
r = await call('/kybernos-models/providers/park', 'POST', { slug: 'acme', profile: PROFILE, models: ['a-1', 'a-2'] })
ok('park stores the profile', r.status === 200 && r.body.ok === true && r.body.slug === 'acme', r.body)
ok('the store file is 0600', (statSync(file).mode & 0o777) === 0o600, (statSync(file).mode & 0o777).toString(8))
r = await call('/kybernos-models/providers/park', 'POST', { slug: 'acme', profile: { ...PROFILE, baseURL: 'https://other.example' }, models: [] })
ok('parking a slug twice is refused (409) and keeps the saved profile', r.status === 409 && r.body.error === 'already-parked' && kbPkTake('acme', file).profile.baseURL === PROFILE.baseURL, r.body)
ok('bad slug refused', (await call('/kybernos-models/providers/park', 'POST', { slug: '../x', profile: PROFILE })).status === 400)
ok('slug with a slash refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'a/b', profile: PROFILE })).status === 400)
ok('non-object profile refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'x1', profile: 'nope' })).status === 400)
ok('array profile refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'x2', profile: [] })).status === 400)
ok('oversized profile refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'x3', profile: { blob: 'x'.repeat(300000) } })).status === 400)

console.log('\n── list never leaks the profile ──')
r = await call('/kybernos-models/providers/parked', 'GET')
const text = JSON.stringify(r.body)
ok('the list names the provider with its models', r.body.parked.length === 1 && r.body.parked[0].slug === 'acme' && r.body.parked[0].displayName === 'Acme' && r.body.parked[0].models.length === 2, r.body)
ok('the list carries no header, no key variable, no profile', text.indexOf('tok') < 0 && text.indexOf('ACME_KEY') < 0 && text.indexOf('profile') < 0, text)

console.log('\n── take / forget ──')
r = await call('/kybernos-models/providers/take', 'POST', { slug: 'acme' })
ok('take returns the exact saved profile', r.status === 200 && JSON.stringify(r.body.profile) === JSON.stringify(PROFILE), r.body)
ok('take leaves it in place (forget comes after the settings write)', kbPkRead(file).providers.acme !== undefined)
ok('take of an unknown slug is a 404', (await call('/kybernos-models/providers/take', 'POST', { slug: 'ghost' })).status === 404)
r = await call('/kybernos-models/providers/forget', 'POST', { slug: 'acme' })
ok('forget removes it', r.status === 200 && r.body.removed === true && kbPkRead(file).providers.acme === undefined, r.body)
r = await call('/kybernos-models/providers/forget', 'POST', { slug: 'acme' })
ok('forget twice is harmless', r.status === 200 && r.body.removed === false, r.body)

console.log('\n── guards ──')
ok('POST without Origin or Referer is refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'g1', profile: PROFILE }, {})).status === 403)
ok('POST from a foreign origin is refused', (await call('/kybernos-models/providers/park', 'POST', { slug: 'g1', profile: PROFILE }, { origin: 'http://evil.example' })).status === 403)
ok('a forged Host header does not help', (await call('/kybernos-models/providers/park', 'POST', { slug: 'g1', profile: PROFILE }, { origin: 'http://evil.example', host: 'evil.example' })).status === 403)
ok('the Referer is accepted when Origin is absent', (await call('/kybernos-models/providers/park', 'POST', { slug: 'g1', profile: PROFILE }, { referer: 'http://localhost:' + PORT + '/x' })).status === 200)
ok('take from a foreign origin is refused', (await call('/kybernos-models/providers/take', 'POST', { slug: 'g1' }, { origin: 'http://evil.example' })).status === 403)
ok('forget without Origin is refused', (await call('/kybernos-models/providers/forget', 'POST', { slug: 'g1' }, {})).status === 403)
ok('GET list from a foreign origin is refused', (await call('/kybernos-models/providers/parked', 'GET', undefined, { origin: 'http://evil.example' })).status === 403)
ok('GET list with no Origin passes (direct navigation)', (await call('/kybernos-models/providers/parked', 'GET', undefined, {})).status === 200)
ok('wrong method is a 405', (await call('/kybernos-models/providers/park', 'GET')).status === 405)
ok('wrong port in the Origin is refused', kbSameOriginStrict({ headers: { origin: 'http://127.0.0.1:9999' }, socket: { localPort: PORT } }) === false)
ok('IPv6 loopback is accepted', kbSameOriginStrict({ headers: { origin: 'http://[::1]:' + PORT }, socket: { localPort: PORT } }) === true)
r = response()
await routes['/kybernos-models/providers/park']({ method: 'POST', url: '/', socket: { localPort: PORT }, headers: { origin: 'http://127.0.0.1:' + PORT }, on (ev, cb) { if (ev === 'data') cb('{not json'); if (ev === 'end') cb() } }, r)
ok('malformed JSON is a 400, never a crash', r.status === 400, r.body)

console.log('\n── a corrupt store reads as empty and recovers ──')
const bad = join(home, 'bad.json')
writeFileSync(bad, '{"providers": {"ok1": {"profile": {"api": "x"}}, "bad slug": {"profile": {}}, "noprofile": {"parkedAt": "x"}}')
ok('truncated JSON reads as empty', Object.keys(kbPkRead(bad).providers).length === 0)
writeFileSync(bad, JSON.stringify({ providers: { ok1: { profile: { api: 'x' }, models: ['m', 3, null] }, 'bad slug': { profile: {} }, noprofile: { parkedAt: 'x' } } }))
const store = kbPkRead(bad)
ok('only well-formed entries survive, models filtered to strings', Object.keys(store.providers).join() === 'ok1' && store.providers.ok1.models.join() === 'm', store)
ok('a parked entry can be added on top of a recovered store', kbPkPark('new1', { api: 'y' }, ['z'], bad).ok === true && Object.keys(kbPkRead(bad).providers).sort().join() === 'new1,ok1')
ok('kbPkPublic never exposes the profile', JSON.stringify(kbPkPublic(kbPkRead(bad))).indexOf('"api"') < 0)
ok('no temp file is left behind', existsSync(bad + '.tmp-' + process.pid) === false)
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
