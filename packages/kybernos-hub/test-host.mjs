// Plays the hub host and client without DSH, a disk or a browser.
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { creerHub, monterRoutes, sameOriginStrict, sameOriginLax } from './hub-host.mjs'
import { apply as appliquer, name as nomHote } from './index.js'

let total = 0; let echecs = 0
const ok = (nom, cond, detail = '') => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

// ── in-memory I/O ──
const memoire = () => {
  let disque = null; let n = 0
  return { lire: () => disque, ecrire: (e) => { disque = JSON.parse(JSON.stringify(e)) }, maintenant: () => '2026-10-03T10:00:00Z', nouvelId: () => 'boot-' + (++n), voir: () => disque }
}

console.log('── hub: one boot ──')
{
  const io = memoire(); const hub = creerHub(io)
  ok('first boot: normal', hub.demarrer().mode === 'normal')
  ok('a boot is written to disk', io.voir().demarrages.length === 1 && io.voir().demarrages[0].gui === 'none')
  ok('beacon before start is refused (503)', creerHub(memoire()).balise({ type: 'loading' }).statut === 503)
  const r1 = hub.balise({ type: 'loading' })
  ok('loading → 200 and returns the boot id', r1.statut === 200 && r1.corps.bootId === 'boot-1')
  ok('alive with a stale boot id → 409', hub.balise({ type: 'alive', bootId: 'boot-0' }).statut === 409)
  ok('alive with the right id → 200', hub.balise({ type: 'alive', bootId: 'boot-1' }).statut === 200)
  ok('disk says alive', io.voir().demarrages[0].gui === 'alive')
  ok('unknown beacon type → 400', hub.balise({ type: 'x' }).statut === 400)
}

console.log('── hub: failing boots lead to a recommendation ──')
{
  const io = memoire()
  for (let i = 0; i < 2; i++) { const h = creerHub(io); h.demarrer(); h.balise({ type: 'loading' }) } // loading, never alive
  const h3 = creerHub(io)
  const v = h3.demarrer()
  ok('third boot sees two failures → safe-recommande', v.mode === 'safe-recommande' && v.echecs === 2, JSON.stringify(v))
  ok('state endpoint reports it', h3.etat().recommendation.mode === 'safe-recommande')
  h3.balise({ type: 'loading' }); h3.balise({ type: 'alive', bootId: h3.bootId() })
  ok('after a healthy boot the next one is normal', creerHub(io).demarrer().mode === 'normal')
}

console.log('── hub: broken disk never throws ──')
{
  const hub = creerHub({ lire: () => { throw new Error('EIO') }, ecrire: () => { throw new Error('EROFS') }, maintenant: () => 'x', nouvelId: () => 'z' })
  let leve = false
  try { hub.demarrer(); hub.balise({ type: 'loading' }); hub.etat() } catch { leve = true }
  ok('read/write failures are swallowed', leve === false)
}

console.log('── routes ──')
const reqFake = ({ method = 'GET', url = '/', origin, referer, host = '127.0.0.1:3080', port = 3080, type = 'application/json', corps } = {}) => {
  const r = new EventEmitter()
  r.method = method; r.url = url; r.socket = { localPort: port }
  r.headers = { host, ...(origin ? { origin } : {}), ...(referer ? { referer } : {}), ...(type ? { 'content-type': type } : {}) }
  r[Symbol.asyncIterator] = async function * () { if (corps !== undefined) yield Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps)) }
  return r
}
const resFake = () => { const r = { statut: null, corps: null, writeHead (s) { r.statut = s }, end (c) { r.corps = JSON.parse(c) } }; return r }
{
  const routes = {}
  const webServer = { register: ({ path, handler }) => { routes[path] = handler } }
  const hub = creerHub(memoire()); hub.demarrer()
  monterRoutes(webServer, hub)
  ok('two routes registered', Object.keys(routes).sort().join() === '/kybernos-hub/beacon,/kybernos-hub/state')
  const appel = async (chemin, req) => { const res = resFake(); await routes[chemin](req, res); return res }
  let r = await appel('/kybernos-hub/state', reqFake())
  ok('GET state without Origin passes (direct navigation)', r.statut === 200 && r.corps.ok === true)
  r = await appel('/kybernos-hub/state', reqFake({ origin: 'http://evil.example' }))
  ok('GET state with a foreign Origin → 403 (DNS rebinding)', r.statut === 403)
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'POST', corps: { type: 'loading' } }))
  ok('POST beacon without Origin → 403', r.statut === 403)
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'POST', origin: 'http://127.0.0.1:3080', corps: { type: 'loading' } }))
  ok('POST beacon same-origin → 200', r.statut === 200 && typeof r.corps.bootId === 'string')
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'POST', origin: 'http://127.0.0.1:3080', type: 'text/plain', corps: '{}' }))
  ok('POST with a non-JSON content type → 415', r.statut === 415)
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'POST', origin: 'http://127.0.0.1:3080', corps: 'pas du json' }))
  ok('POST with a bad body → 400', r.statut === 400)
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'POST', origin: 'http://127.0.0.1:3080', corps: 'x'.repeat(5000) }))
  ok('POST with an oversized body → 400', r.statut === 400)
  r = await appel('/kybernos-hub/beacon', reqFake({ method: 'GET' }))
  ok('GET on the beacon → 405', r.statut === 405)
  ok('forged Host does not help: the socket port decides', sameOriginStrict(reqFake({ origin: 'http://127.0.0.1:9999', port: 3080 })) === false)
  ok('lax passes without headers, strict does not', sameOriginLax(reqFake()) === true && sameOriginStrict(reqFake()) === false)
}

console.log('── index.js: apply() never throws and never blocks DSH ──')
{
  const registered = []
  const ctx = { get: (n) => (n === 'webServer' ? { register: (r) => registered.push(r.path) } : undefined), effect: (fn) => fn(), inject: () => {} }
  let leve = false
  try { appliquer(ctx) } catch { leve = true }
  ok('apply with a normal ctx mounts both routes', leve === false && registered.length === 2, registered.join())
  let leve2 = false
  try { appliquer({ get: () => { throw new Error('boom') }, effect: () => { throw new Error('boom') }, inject: () => { throw new Error('boom') } }) } catch { leve2 = true }
  ok('apply with a hostile ctx does not throw', leve2 === false)
  let leve3 = false
  try { appliquer(undefined) } catch { leve3 = true }
  ok('apply(undefined) does not throw', leve3 === false)
  ok('exports the plugin name', nomHote === 'kybernos-hub')
}

console.log('── client ──')
{
  const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  let def
  const appels = []; const effets = []
  const fenetre = { __ModuleLoader__: { load: (d) => { def = d } } }
  globalThis.document = { visibilityState: 'visible' }
  globalThis.fetch = async (url, init) => { const corps = JSON.parse(init.body); appels.push({ url, corps }); return { json: async () => ({ ok: true, bootId: 'B1' }) } }
  new Function('window', SOURCE)(fenetre)
  const modele = def.factory()
  ok('id is @local/kybernos-hub', def.id === '@local/kybernos-hub')
  ok('injects no DSH service (nothing to break on upgrade)', Array.isArray(modele.inject) && modele.inject.length === 0)
  modele.apply({ effect: (fn, label) => { effets.push({ label, nettoyer: fn() }) } })
  await new Promise((r) => setTimeout(r, 30))
  ok('sends "loading" immediately', appels.length === 1 && appels[0].url === '/kybernos-hub/beacon' && appels[0].corps.type === 'loading')
  ok('registers one effect with a cleanup', effets.length === 1 && typeof effets[0].nettoyer === 'function')
  effets[0].nettoyer()
  let leve = false
  try { modele.apply({ effect: () => { throw new Error('boom') } }) } catch { leve = true }
  ok('a hostile ctx does not throw out of apply()', leve === false)
  globalThis.fetch = async () => { throw new Error('offline') }
  let leve2 = false
  try { modele.apply({ effect: (fn) => fn() }); await new Promise((r) => setTimeout(r, 30)) } catch { leve2 = true }
  ok('an unreachable host never throws', leve2 === false)
}

console.log(`\nHUB — ${total} assertions, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
