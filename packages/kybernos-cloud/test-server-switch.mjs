// Tests of switching servers in the cloud plugin: the active server decides where DSH talks, each server keeps its own
// connection, and the « kybernos » model route never outlives the server it came from.   node packages/kybernos-cloud/test-server-switch.mjs
//
// Four fake servers (a, b: ordinary; c: no Kybernos LLM; e: an LLM service of its own) and a registry that names them. No
// real network, no DSH: settings and credentials are stand-ins. What is proven: the address chat is sent to, whose token is
// sent where, what is left behind (and cleaned) when the user leaves a server.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const fake = async (modelId) => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || null })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url.startsWith('/v1/models') ? { data: [{ id: modelId }, { id: 'raw-backend-model' }] } : { ok: true }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { seen, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) }
}
const A = await fake('kybernos/alpha')
const B = await fake('kybernos/beta')
const C = await fake('kybernos/gamma')
const L = await fake('kybernos/llm-only')
const E = await fake('kybernos/never-asked')

const home = mkdtempSync(join(tmpdir(), 'kb-switch-'))
process.env.DSH_HOME = home
delete process.env.KYBERNOS_CLOUD_STATE
delete process.env.KYBERNOS_CLOUD_API
delete process.env.KYBERNOS_SERVERS_FILE
const registryFile = join(home, 'kybernos', 'servers.json')
const stateOf = (id) => join(home, id === 'kybernos-cloud' ? 'kybernos-cloud.json' : 'kybernos-cloud-' + id + '.json')
const writeRegistry = (active) => {
  mkdirSync(join(home, 'kybernos'), { recursive: true })
  writeFileSync(registryFile, JSON.stringify({ active, servers: [
    { id: 'a', name: 'Server A', api: A.url },
    { id: 'b', name: 'Server B', api: B.url },
    { id: 'c', name: 'Server C (no LLM)', api: C.url, services: { llm: false } },
    { id: 'e', name: 'Server E (own LLM)', api: E.url, services: { llm: L.url } },
    { id: 'd', name: 'Server D (never connected)', api: B.url },
  ] }))
}
const connect = (id, token) => writeFileSync(stateOf(id), JSON.stringify({ token, user: { id: 'u-' + id, plan: 'studio' }, workspaces: [{ id: 'w-' + id, name: id }], active_workspace_id: 'w-' + id }))
for (const [id, token] of [['a', 'tok-a'], ['b', 'tok-b'], ['c', 'tok-c'], ['e', 'tok-e']]) connect(id, token)
writeRegistry('a')

// Stand-ins for DSH's settings and credentials services.
const settingsStore = {}
const credentialStore = new Map()
const ctx = {
  get: (name) => {
    if (name === 'settings') return { async mutate (ns, ops) { for (const op of ops) { settingsStore[ns] = settingsStore[ns] || {}; let node = settingsStore[ns]; for (let i = 0; i < op.path.length - 1; i += 1) { node[op.path[i]] = node[op.path[i]] || {}; node = node[op.path[i]] } if (op.op === 'unset') delete node[op.path[op.path.length - 1]]; else node[op.path[op.path.length - 1]] = op.value } return { ok: true } } }
    if (name === 'credentials') return { async set (ref, value) { credentialStore.set(ref, value) }, async unset (ref) { credentialStore.delete(ref) } }
    return undefined
  },
  inject: (_list, cb) => cb(ctx),
  effect: () => {},
  on: () => {},
}
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
const route = (path, method = 'GET') => mod.ROUTES.find((r) => r.path === path && r.method === method)
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)) } return false }
const providerRoute = () => (settingsStore['llm-pi-ai'] && settingsStore['llm-pi-ai'].providers && settingsStore['llm-pi-ai'].providers.kybernos) || null
const seenBy = (srv, auth) => srv.seen.filter((x) => x.auth === 'Bearer ' + auth).length

mod.apply(ctx)

console.log('the active server at boot')
{
  check('both routes exist, GET and a guarded POST', route('/kybernos-cloud/server') !== undefined && route('/kybernos-cloud/server/apply', 'POST') !== undefined && route('/kybernos-cloud/server/apply', 'POST').guarded === true)
  const s = await route('/kybernos-cloud/server').run({})
  check('GET /server names the active server and every server of the registry, the built-in one first', s.server.id === 'a' && s.source === 'registry' && s.servers.map((x) => x.id).join() === 'kybernos-cloud,a,b,c,e,d' && s.servers.find((x) => x.id === 'a').active === true && s.servers.filter((x) => x.active).length === 1, JSON.stringify(s.servers.map((x) => [x.id, x.active])))
  check('the answer carries no token', JSON.stringify(s).indexOf('tok-') < 0)
  check('each server says whether this DSH is signed in to it (its own connection file), the others\' sign-ins included', s.servers.find((x) => x.id === 'a').connected === true && s.servers.find((x) => x.id === 'b').connected === true && s.servers.find((x) => x.id === 'd').connected === false && s.servers.find((x) => x.id === 'kybernos-cloud').connected === false, JSON.stringify(s.servers.map((x) => [x.id, x.connected])))
  check('this DSH reads the connection file of THAT server', mod.stateFile() === stateOf('a'), mod.stateFile())
  check('the boot import ran against server A: chat is sent to A, with A\'s token', await until(() => providerRoute() !== null) && providerRoute().baseURL === A.url + '/v1' && credentialStore.get(mod.CRED_REF) === 'tok-a', JSON.stringify(providerRoute()))
  check('only the product routes of A\'s catalogue were imported', JSON.stringify(providerRoute().models.map((m) => m.id)) === JSON.stringify(['kybernos/alpha']))
  check('no other server was called', B.seen.length === 0 && C.seen.length === 0 && L.seen.length === 0 && E.seen.length === 0)
  check('the status carries the server, so the page can say which one it shows', mod.publicState(JSON.parse(readFileSync(stateOf('a'), 'utf8'))).server.id === 'a' && mod.publicState(JSON.parse(readFileSync(stateOf('a'), 'utf8'))).web_url === A.url)
}

console.log('switching to another server')
{
  writeRegistry('b')
  const out = await route('/kybernos-cloud/server/apply', 'POST').run({})
  check('apply answers with the new server and the new catalogue', out.ok === true && out.server.id === 'b' && out.connected === true && out.models.ids.join() === 'kybernos/beta', JSON.stringify(out))
  check('chat now goes to B with B\'s token; the route and the credential are B\'s', providerRoute().baseURL === B.url + '/v1' && credentialStore.get(mod.CRED_REF) === 'tok-b' && providerRoute().models[0].id === 'kybernos/beta')
  check('A\'s connection file is untouched (nobody was signed out) and B\'s is the one read now', existsSync(stateOf('a')) && JSON.parse(readFileSync(stateOf('a'), 'utf8')).token === 'tok-a' && mod.stateFile() === stateOf('b'))
  check('B\'s token went to B only, A\'s token never to B', seenBy(B, 'tok-b') >= 1 && seenBy(B, 'tok-a') === 0)
  const again = await route('/kybernos-cloud/server/apply', 'POST').run({})
  check('apply is idempotent', again.ok === true && again.server.id === 'b' && providerRoute().baseURL === B.url + '/v1')
}

console.log('a server with no Kybernos LLM')
{
  const callsBefore = C.seen.length
  writeRegistry('c')
  const out = await route('/kybernos-cloud/server/apply', 'POST').run({})
  check('apply says there is no LLM here', out.ok === true && out.server.id === 'c' && out.no_llm === true && out.server.llm === 'none', JSON.stringify(out))
  check('the previous server\'s « kybernos » route and credential are gone: chat can no longer reach a server the user left', providerRoute() === null && credentialStore.has(mod.CRED_REF) === false)
  check('no catalogue was requested from a server that has no LLM', C.seen.length === callsBefore)
  const status = JSON.parse(readFileSync(stateOf('c'), 'utf8'))
  check('its connection file keeps the sign-in and records no import', status.token === 'tok-c' && status.models === undefined)
  const sync = await mod.importCatalog('manual', { force: true })
  check('a manual sync on this server also imports nothing', sync.no_llm === true && providerRoute() === null)
}

console.log('a server whose LLM is a separate service')
{
  writeRegistry('e')
  const out = await route('/kybernos-cloud/server/apply', 'POST').run({})
  check('the catalogue is read from the LLM service, not from the account address', out.ok === true && out.models.ids.join() === 'kybernos/llm-only' && L.seen.some((x) => x.url.startsWith('/v1/models')) && E.seen.length === 0, JSON.stringify(out) + ' E=' + JSON.stringify(E.seen))
  check('chat is sent to the LLM service the profile names, never to a host deduced from the account', providerRoute().baseURL === L.url + '/v1' && providerRoute().baseURL !== E.url + '/v1')
}

console.log('leaving a server for one this DSH is not connected to')
{
  writeRegistry('d')
  const out = await route('/kybernos-cloud/server/apply', 'POST').run({})
  check('the route left behind by the previous server is removed', out.ok === true && out.server.id === 'd' && out.connected === false && out.cleaned === true && providerRoute() === null && credentialStore.has(mod.CRED_REF) === false, JSON.stringify(out))
  const status = await route('/kybernos-cloud/status').run({})
  check('the status says not connected, for THIS server', status.connected === false, JSON.stringify(status))
  check('the other servers\' connections are still on disk', [ 'a', 'b', 'c', 'e' ].every((id) => existsSync(stateOf(id))))
}

console.log('a registry that cannot be honoured')
{
  writeRegistry('ghost')
  const s = await route('/kybernos-cloud/server').run({})
  check('an unknown active server falls back to the built-in one and says why', s.server.id === 'kybernos-cloud' && s.error === 'active_unknown' && mod.stateFile() === stateOf('kybernos-cloud'), JSON.stringify([s.server.id, s.error]))
  writeFileSync(registryFile, '{ broken')
  const t = await route('/kybernos-cloud/server').run({})
  check('a broken file is the built-in server, never a crash', t.ok === true && t.server.id === 'kybernos-cloud')
}

console.log('the shipped code')
{
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  check('no server address is hard-coded in the host any more (it lives in the profile)', !/api\.dev\.kybernos\.app/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
}

for (const srv of [A, B, C, L, E]) await srv.close()
rmSync(home, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
