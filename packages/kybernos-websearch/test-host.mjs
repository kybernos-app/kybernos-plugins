#!/usr/bin/env node
// kybernos-websearch: host half. The service, the four routes on a fake web server, and apply() with a fake DSH context.
// No network, no real disk (a temp DSH_HOME), no DSH.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The four POST routes need the signed session as well as the Origin (L3-20): the Settings page's own request carries both.
sessionSource.secret = () => SESSION_SECRET

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-websearch-'))
process.env.DSH_HOME = home

const { createWebSearch, mountRoutes, ROUTES, PROVIDER_ID, sameOriginStrict, pinnedProvider } = await import('./host.mjs')
const { apply, settingsFile } = await import('./index.js')

let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 220) : '')) }
}

const SECRET = 'tvly-super-secret-123456'
const store = new Map()
let doc = null
const calls = []
const makeIo = (over = {}) => ({
  read: () => doc,
  write: (d) => { doc = JSON.parse(JSON.stringify(d)) },
  resolveKey: async (ref) => store.get(ref) || null,
  describeKey: async (ref) => ({ configured: store.has(ref), source: store.has(ref) ? 'file' : null }),
  setKey: async (ref, value) => { store.set(ref, value) },
  unsetKey: async (ref) => { store.delete(ref) },
  http: async (url, init) => {
    calls.push({ url, init })
    if (url.includes('tavily')) return { status: 200, ok: true, text: JSON.stringify({ results: [{ url: 'https://t.example/', title: 'T', content: 'c' }] }) }
    return { status: 200, ok: true, text: '<html><title>Brave Search</title></html>' }
  },
  seam: () => ({ registered: true, pinned: PROVIDER_ID }),
  ...over
})

console.log('— service')
const svc = createWebSearch(makeIo())
ok('the provider has the id the profile patch pins', svc.provider.id === PROVIDER_ID && PROVIDER_ID === 'kybernos-search')
ok('the provider is usable out of the box (free engines on)', svc.provider.available() === true)
let st = await svc.state()
ok('state lists the 15 engines in the default order, free ones configured', st.engines.length === 15 && st.engines[0].id === 'searxng' && st.engines.find((e) => e.id === 'brave-web').configured === true)
ok('state: keyed engines are not configured until a key is there; the encyclopedia is off', st.engines.find((e) => e.id === 'tavily').configured === false && st.engines.find((e) => e.id === 'wikipedia').enabled === false)
ok('state says whether DSH is pinned to this provider', st.pinned === PROVIDER_ID && st.registered === true)

let r = await svc.setKey('TAVILY_API_KEY', SECRET)
ok('a key for an engine\'s own credential name is stored', r.ok === true && store.get('TAVILY_API_KEY') === SECRET)
ok('any other credential name is refused (the store is not a general write channel)', (await svc.setKey('PATH', 'aaaaaaaaaaaa')).ok === false && (await svc.setKey('DEEPSEEK_API_KEY ', 'aaaaaaaaaaaa')).ok === false && !store.has('PATH'))
ok('a key that is too short, too long or has whitespace is refused', (await svc.setKey('TAVILY_API_KEY', 'short')).ok === false && (await svc.setKey('TAVILY_API_KEY', 'a b c d e f g h')).ok === false && (await svc.setKey('TAVILY_API_KEY', 'x'.repeat(301))).ok === false)
st = await svc.state()
ok('state shows the key as configured and never contains it', st.engines.find((e) => e.id === 'tavily').configured === true && JSON.stringify(st).indexOf(SECRET) === -1)

const found = await svc.provider.search({ query: 'kybernos', maxResults: 5 })
ok('the provider searches through the keyed engine first and returns the seam\'s shape', found.sources.length === 1 && found.sources[0].url === 'https://t.example/' && found.truncated === false && Object.keys(found).sort().join() === 'sources,truncated')
ok('the key reached the request (header), not the page', calls.some((c) => c.init.headers && JSON.stringify(c.init.headers).includes(SECRET)))

svc.update({ order: ['wikipedia', 'tavily'], enabled: { wikipedia: false }, domains: 'example.org' })
ok('update persists through io.write and keeps the full engine list', doc.order[0] === 'wikipedia' && doc.order.length === 15 && doc.domains === 'example.org')
const filtered = await svc.provider.search({ query: 'another query', maxResults: 5 }).catch((e) => e)
ok('the domain filter now removes the only result: every engine "found nothing", that is an error, not a silent empty answer', filtered instanceof Error && filtered.code === 'WEB_PROVIDER_ERROR')

r = await svc.clearKey('TAVILY_API_KEY')
ok('a key can be removed', r.ok === true && !store.has('TAVILY_API_KEY'))
const t = await svc.test('brave-web', 'hello')
ok('the test action returns a result and never throws', t.ok === false && typeof t.kind === 'string')
ok('available() follows the switches', createWebSearch(makeIo({ read: () => ({ enabled: Object.fromEntries(['searxng', 'custom', 'brave-api', 'tavily', 'serper', 'exa', 'kagi', 'google-pse', 'jina', 'perplexity', 'deepseek', 'brave-web', 'exa-free', 'duckduckgo', 'wikipedia'].map((id) => [id, false])) }) })).provider.available() === false)
ok('a settings file that is garbage gives the defaults, not an exception', createWebSearch(makeIo({ read: () => { throw new Error('boom') } })).provider.available() === true)

console.log('— routes')
const routes = []
const web = { register: (r) => { routes.push(r); return () => {} } }
const effects = []
mountRoutes(web, createWebSearch(makeIo()), (fn, label) => { effects.push(label); return fn() })
ok('five routes, each registered through the effect wrapper', routes.length === 5 && effects.length === 5 && routes.every((x) => x.kind === 'exact'))
const route = (p) => routes.find((x) => x.path === p)
const fakeReq = (method, headers = {}, body = null, port = 3080) => {
  const stream = Readable.from(body === null ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  return Object.assign(stream, { method, headers, socket: { localPort: port } })
}
const fakeRes = () => {
  const res = { status: 0, headers: {}, body: '' }
  res.writeHead = (s, h) => { res.status = s; res.headers = h || {} }
  res.end = (b) => { res.body = b === undefined ? '' : String(b) }
  return res
}
const call = async (path, req) => { const res = fakeRes(); await route(path).handler(req, res); return { status: res.status, json: res.body ? JSON.parse(res.body) : null } }
const SAME = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:3080') }

let out = await call(ROUTES.state, fakeReq('GET', { host: '127.0.0.1:3080' }))
ok('GET state answers the state', out.status === 200 && out.json.ok === true && out.json.engines.length === 15)
out = await call(ROUTES.state, fakeReq('GET', { host: 'attacker.example:3080' }))
ok('a foreign Host is refused on a read too (DNS rebinding)', out.status === 403)
out = await call(ROUTES.state, fakeReq('POST', { host: '127.0.0.1:3080' }))
ok('GET routes refuse a POST (405)', out.status === 405)
out = await call(ROUTES.settings, fakeReq('POST', { host: '127.0.0.1:3080' }, { domains: 'x.org' }))
ok('a write with no Origin is refused', out.status === 403)
out = await call(ROUTES.settings, fakeReq('POST', { host: 'attacker.example:3080', origin: 'http://attacker.example:3080' }, { domains: 'x.org' }))
ok('a write whose Host and Origin are the same foreign authority is refused', out.status === 403)
out = await call(ROUTES.settings, fakeReq('POST', SAME, { domains: 'x.org', order: ['brave-web'] }))
ok('a same-origin write is applied and the new state returned', out.status === 200 && out.json.settings.domains === 'x.org' && out.json.engines[0].id === 'brave-web')
out = await call(ROUTES.key, fakeReq('POST', SAME, { ref: 'SERPER_API_KEY', value: 'serper-key-123456' }))
ok('the key route stores a key and the answer does not echo it', out.status === 200 && store.get('SERPER_API_KEY') === 'serper-key-123456' && JSON.stringify(out.json).indexOf('serper-key-123456') === -1)
out = await call(ROUTES.key, fakeReq('POST', SAME, { ref: 'HOME', value: 'aaaaaaaaaaaaaaa' }))
ok('the key route refuses a name no engine declares', out.status === 400 && out.json.error === 'unknown-key')
out = await call(ROUTES.key, fakeReq('POST', SAME, { ref: 'SERPER_API_KEY', clear: true }))
ok('the key route clears a key', out.status === 200 && !store.has('SERPER_API_KEY'))
out = await call(ROUTES.test, fakeReq('POST', SAME, { id: 'tavily' }))
ok('the test route answers a result for the engine, with the state', out.status === 200 && out.json.result.ok === false && out.json.result.kind === 'missing' && Array.isArray(out.json.state.engines))
out = await call(ROUTES.test, fakeReq('POST', SAME, {}))
ok('the test route wants an engine id', out.status === 400)
out = await call(ROUTES.seam, fakeReq('POST', SAME, {}))
ok('the seam route says plainly when DSH\'s web seam is not there', out.status === 200 && out.json.result.ok === false && out.json.result.code === 'NO_SEAM')
{
  const viaSeam = await createWebSearch(makeIo({ seamSearch: async () => ({ sources: [{ title: 'T', url: 'https://x.example/' }], truncated: false }) })).seamTest('anything')
  ok('seamTest reports what came back through the seam', viaSeam.ok === true && viaSeam.count === 1 && viaSeam.sample[0].url === 'https://x.example/' && 'engine' in viaSeam, JSON.stringify(viaSeam))
  const failing = createWebSearch(makeIo({ seamSearch: async () => { throw Object.assign(new Error('configured web provider "deepseek-official" is registered but unavailable'), { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }) } }))
  const bad = await failing.seamTest('q')
  ok('a seam failure keeps its code (this is how a missing or wrong pin shows)', bad.ok === false && bad.code === 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' && /unavailable/.test(bad.message))
}
out = await call(ROUTES.settings, fakeReq('POST', SAME, 'x'.repeat(40000)))
ok('an oversized body is an error, not a crash', out.status === 500)
ok('sameOriginStrict: Referer is the fallback, a foreign Origin is refused', sameOriginStrict(fakeReq('POST', { referer: 'http://localhost:3080/page' })) === true && sameOriginStrict(fakeReq('POST', { origin: 'http://evil.example:3080' })) === false && sameOriginStrict(fakeReq('POST', { origin: 'ftp://127.0.0.1:3080' })) === false)

console.log('— apply()')
const logs = []
const origLog = console.log
const origErr = console.error
console.log = (...a) => logs.push(a.join(' '))
console.error = (...a) => logs.push(a.join(' '))
const registered = []
const effectLog = []
const makeCtx = (services) => {
  // Like DSH: a service is readable through get(); a property read of a service this plugin did not inject THROWS.
  const ctx = new Proxy({
    get: (n) => services[n],
    pending: [],
    inject: (deps, cb) => {
      const run = () => cb(new Proxy({ get: ctx.get }, { get: (target, key) => (deps.includes(key) ? services[key] : target[key]) }))
      if (!deps.every((d) => services[d] !== undefined)) { ctx.pending.push({ deps, run }); return }
      run()
    },
    flush: () => { for (const p of ctx.pending.splice(0)) if (p.deps.every((d) => services[d] !== undefined)) p.run() },
    effect: (fn, label) => { effectLog.push(label); return fn() }
  }, {
    get: (target, key) => {
      if (key in target) return target[key]
      if (typeof key === 'string' && services[key] !== undefined) throw new Error('cannot get property "' + key + '" without inject')
      return undefined
    }
  })
  return ctx
}
let threw = null
try {
  apply(makeCtx({}))
  apply({})
  apply(null)
} catch (e) { threw = e }
ok('apply() with no service, an empty context or nothing at all never throws', threw === null, threw && threw.message)
apply(makeCtx({ web: { registerSearchProvider: (p) => { registered.push(p); return () => {} }, searchProviderId: 'deepseek-official' }, webServer: web }))
ok('apply() registers the provider with the web seam and mounts the routes, with the web server already there (a hot activation)', registered.length === 1 && registered[0].id === PROVIDER_ID && effectLog.length === 5, effectLog.length)
const before = routes.length
effectLog.length = 0
const lateServices = {}
const lateCtx = makeCtx(lateServices)
apply(lateCtx)
const mountedEarly = effectLog.length
lateServices.webServer = web
lateCtx.flush()
ok('apply() with no web server yet mounts nothing, then mounts the routes when it is injected', mountedEarly === 0 && effectLog.length === 5 && routes.length === before + 5, [mountedEarly, effectLog.length, routes.length - before])
apply(makeCtx({ web: { registerSearchProvider: () => { throw new Error('WEB_DUPLICATE_PROVIDER') } } }))
console.log = origLog
console.error = origErr
ok('a duplicate registration is logged, not thrown', logs.some((l) => /not registered/.test(l)))
ok('settings live under DSH_HOME/kybernos/websearch/', settingsFile() === join(home, 'kybernos', 'websearch', 'settings.json'))

console.log('— the profile patch')
const patch = readFileSync(join(HERE, 'cordis.patch.yml'), 'utf8')
ok('the bundle patch inserts the plugin and pins the seam to its provider, restating fetchProvider', /- insert:/.test(patch) && /id: kybernos-websearch/.test(patch) && /- id: web\n\s+config:\n\s+searchProvider: kybernos-search\n\s+fetchProvider: http/.test(patch))
ok('the pin value is the provider id the code registers', new RegExp('searchProvider: ' + PROVIDER_ID).test(patch))
ok('the host code imports nothing from @deepseek-ai/*', !/from '@deepseek-ai\//.test(['index.js', 'host.mjs', 'router.mjs', 'engines.mjs', 'parse.mjs', 'net.mjs', 'settings.mjs'].map((f) => readFileSync(join(HERE, f), 'utf8')).join('\n')))
ok('no personal path in the sources', !/\/Users\/[a-z]/i.test(['index.js', 'host.mjs', 'router.mjs', 'engines.mjs', 'parse.mjs', 'net.mjs', 'settings.mjs', 'client.js'].filter((f) => existsSync(join(HERE, f))).map((f) => readFileSync(join(HERE, f), 'utf8')).join('\n')))

// The provider DSH's web seam is set to, in both shapes of the seam: a string fixed at construction (0.2.1-alpha.4) and a live config value (0.2.1-rc.2).
ok('pinnedProvider: no seam, nothing pinned', pinnedProvider(undefined) === null && pinnedProvider(null) === null && pinnedProvider({}) === null)
ok('pinnedProvider reads the alpha.4 string `searchProviderId`', pinnedProvider({ searchProviderId: 'deepseek-official' }) === 'deepseek-official')
ok('pinnedProvider reads the rc.2 live value `config.searchProvider.get()`', pinnedProvider({ config: { searchProvider: { get: () => PROVIDER_ID } } }) === PROVIDER_ID)
ok('the live value wins over the env fallback', pinnedProvider({ config: { searchProvider: { get: () => 'deepseek-search-api' } }, searchProviderEnv: 'http' }) === 'deepseek-search-api')
ok('rc.2 with nothing configured falls back to the env value', pinnedProvider({ config: { searchProvider: { get: () => undefined } }, searchProviderEnv: 'brave' }) === 'brave')
ok('an empty or non-string value is not a pin', pinnedProvider({ config: { searchProvider: { get: () => '' } }, searchProviderId: 42 }) === null)
ok('a config accessor that throws reads as « not set »', pinnedProvider({ config: { searchProvider: { get: () => { throw new Error('gone') } } }, searchProviderEnv: 'x' }) === 'x')
ok('index.js reads the pin through pinnedProvider (not the removed property)', /pinnedProvider\(ctx\.get\('web'\)\)/.test(readFileSync(join(HERE, 'index.js'), 'utf8')) && !/web\.searchProviderId/.test(readFileSync(join(HERE, 'index.js'), 'utf8')))

console.log('\n' + (fail === 0 ? 'ALL CHECKS OK' : fail + ' check(s) FAILED'))
process.exit(fail === 0 ? 0 : 1)
