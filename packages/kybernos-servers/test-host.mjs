// Tests of the host half end to end, against the REAL cloud half.   node packages/kybernos-servers/test-host.mjs
//
// A stand-in for DSH's web server serves this plugin's routes (mounted by its own `mount`, so the real handlers and the real origin guard run)
// AND the cloud plugin's /kybernos-cloud/server routes (the real ones, from ../kybernos-cloud). Fake Kybernos servers publish their profile and a
// model list, each one behaving in a different way. What is proven is the seam between the two halves: what this plugin writes, the cloud
// plugin reads and applies; what the cloud plugin refuses, this plugin undoes. No licence, no key, no real network, no DSH.
//   SRV-04 services kept · SRV-05 distinct names and ids · SRV-06 no duplicate · SRV-07 a refused profile is undone · SRV-08 an unreadable
//   registry is never overwritten · SRV-09 add, switch, remove · SRV-10 remove forgets the sign-in · SRV-11 origin and id guards
import { createServer, request as httpRequest } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }

const home = mkdtempSync(join(tmpdir(), 'kb-servers-host-'))
process.env.DSH_HOME = home
for (const k of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_CLOUD_API', 'KYBERNOS_SERVERS_FILE']) delete process.env[k]
mkdirSync(join(home, 'kybernos'), { recursive: true })
const registryFile = join(home, 'kybernos', 'servers.json')
const markerFile = join(home, 'kybernos', 'server-applied.json')
const connectionOf = (id) => join(home, 'kybernos-cloud-' + id + '.json')
const readRegistry = () => JSON.parse(readFileSync(registryFile, 'utf8'))
const registryText = () => (existsSync(registryFile) ? readFileSync(registryFile, 'utf8') : null)

// ── Fake Kybernos servers: each publishes what `doc(url)` says and counts what it is asked. ──
const fakes = []
const fake = async (doc, { status = 200 } = {}) => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push(req.url)
    if (req.url === '/.well-known/kybernos-server.json') {
      if (status >= 300 && status < 400) { res.writeHead(status, { location: 'https://elsewhere.example' }); res.end(); return }
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(doc(url))); return
    }
    if (req.url.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kybernos/test-chat' }] })); return }
    res.writeHead(404); res.end('no')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port
  const out = { url, seen, host: '127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) }
  fakes.push(out)
  return out
}
const profile = (over = {}) => (url) => Object.assign({ schema: 1, name: 'Kybernos', version: '1.0.0', dsh_min: '0.1.0', api: url }, over)
const ACME = await fake((url) => profile({ name: 'Acme Corp', web: url + '/app' })(url))
const PLAIN_1 = await fake(profile())            // answers « Kybernos », as every server does by default
const PLAIN_2 = await fake(profile())            // another one that answers « Kybernos »
const WITH_CONN = await fake((url) => profile({ name: 'Connected Co', services: { llm: false, connections: url + '/v1/mcp/connections' } })(url))
const EVIL_CONN = await fake(profile({ name: 'Evil Co', services: { connections: 'https://evil.example/v1/mcp/connections' } }))
const AS_BUILTIN = await fake(profile({ name: 'Mirror', api: 'https://api.kybernos.app' }))
const OLD_DSH = await fake(profile({ name: 'Future Co', dsh_min: '9.9.9' }))
const REDIRECTING = await fake(profile(), { status: 301 })
const SPARE = await fake(profile({ name: 'Spare' }))
const DEAD = await fake(profile()); await DEAD.close()

// ── The cloud half, as DSH would load it (settings and credentials are stand-ins). ──
const settingsStore = {}; const credentialStore = new Map()
const cloudCtx = {
  get: (n) => {
    if (n === 'settings') return { async mutate (ns, ops) { for (const op of ops) { settingsStore[ns] = settingsStore[ns] || {}; let node = settingsStore[ns]; for (let i = 0; i < op.path.length - 1; i += 1) { node[op.path[i]] = node[op.path[i]] || {}; node = node[op.path[i]] } if (op.op === 'unset') delete node[op.path[op.path.length - 1]]; else node[op.path[op.path.length - 1]] = op.value } return { ok: true } } }
    if (n === 'credentials') return { async set (r, v) { credentialStore.set(r, v) }, async unset (r) { credentialStore.delete(r) } }
    return undefined
  }, inject: (_l, cb) => cb(cloudCtx), effect: () => {}, on: () => {},
}
const cloud = await import('../kybernos-cloud/index.js')
cloud.MEMORY_TUNING.writeRefreshMs = -1; cloud.MEMORY_TUNING.tickMs = 3600000
cloud.apply(cloudCtx)
const mine = await import('./index.js')

// ── The stand-in for DSH's web server: the REAL handlers of this plugin (through its own `mount`) and two routes of the cloud half. ──
const handlers = new Map()
const webServer = { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }
const { mount } = await import('./host.mjs')
mount({ effect: (fn) => { fn() } }, webServer)
const flags = { applyDown: false }
const sendJson = (res, s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
const dsh = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/kybernos-maintenance/state') return sendJson(res, 200, { global: '0.2.1' })
  if (path === '/kybernos-cloud/server/apply' && flags.applyDown) return sendJson(res, 500, { ok: false })
  const open = cloud.ROUTES.find((r) => r.path === path && (path === '/kybernos-cloud/server' || path === '/kybernos-cloud/server/apply'))
  if (open !== undefined) return sendJson(res, 200, await open.run(req, null))
  const h = handlers.get(path)
  if (h === undefined) return sendJson(res, 404, { ok: false })
  return h(req, res)
})
await new Promise((r) => dsh.listen(0, '127.0.0.1', r))
const DSH = 'http://127.0.0.1:' + dsh.address().port
const call = async (method, path, body, headers) => {
  const r = await fetch(DSH + path, { method, headers: Object.assign({ origin: DSH, 'content-type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const post = (path, body, headers) => call('POST', path, body, headers)
const ids = (s) => s.body.cloud.servers.map((x) => x.id)

console.log('before anything is added')
{
  const s = await call('GET', '/kybernos-servers/status')
  check('status lists the built-in server only, read from the cloud half, and asks for nothing', s.body.ok === true && ids(s).join() === 'kybernos-cloud' && s.body.cloud.server.id === 'kybernos-cloud', s.body)
  check('it carries no licence field at all', !('licence' in s.body) && !JSON.stringify(s.body).toLowerCase().includes('licen'))
  const c = await post('/kybernos-servers/check', { address: ACME.url })
  check('checking a server: three steps, its profile, the name to propose; nothing is written', c.body.ok === true && c.body.steps.length === 3 && c.body.profile.api === ACME.url && c.body.suggested === 'Acme Corp' && c.body.host === ACME.host && !existsSync(registryFile), c.body)
  const two = await post('/kybernos-servers/check', { address: PLAIN_1.url })
  check('a server that answers « Kybernos » gets « Kybernos · host » as its proposed name', two.body.suggested === 'Kybernos · ' + PLAIN_1.host, two.body.suggested)
  const e1 = await post('/kybernos-servers/check', { address: DEAD.host })
  const e2 = await post('/kybernos-servers/check', { address: REDIRECTING.url })
  const e3 = await post('/kybernos-servers/check', { address: OLD_DSH.url })
  const e4 = await post('/kybernos-servers/check', { address: 'http://not-loopback.example' })
  const e5 = await post('/kybernos-servers/check', { address: '' })
  check('SRV-02 through the host: unreachable, redirect, newer DSH needed (with the version), insecure, empty', e1.body.error === 'unreachable' && e2.body.error === 'redirect' && e3.body.error === 'incompatible' && e3.body.dsh_min === '9.9.9' && e4.body.error === 'insecure_address' && e5.body.error === 'bad_address', [e1.body.error, e2.body.error, e3.body.error, e4.body.error, e5.body.error])
}

console.log('SRV-07 a profile the cloud half refuses is undone')
{
  const r = await post('/kybernos-servers/add', { address: EVIL_CONN.url })
  check('a connections endpoint on another origin is refused, with the reason', r.body.ok === false && r.body.error === 'profile_refused' && r.body.detail === 'bad_connections', r.body)
  check('and with no registry before, none is left behind', !existsSync(registryFile))
}

console.log('SRV-09 adding: written, judged, switched')
let before
{
  const forged = await post('/kybernos-servers/add', { address: ACME.url, profile: { api: 'https://evil.example', name: 'Forged' } })
  check('add discovers again HERE: the profile sent by the page is ignored', forged.body.ok === true && forged.body.id === 'acme-corp' && readRegistry().servers[0].api === ACME.url && readRegistry().servers[0].name === 'Acme Corp', readRegistry())
  check('it switches to the new server by default (no second step)', forged.body.active === true && readRegistry().active === 'acme-corp' && forged.body.apply.ok === true, forged.body)
  check('the registry file is private to its owner (0600)', (statSync(registryFile).mode & 0o777) === 0o600)
  const s = await call('GET', '/kybernos-servers/status')
  check('the cloud half sees it, active and not signed in; the published web address is carried', ids(s).join() === 'kybernos-cloud,acme-corp' && s.body.cloud.servers[1].active === true && s.body.cloud.servers[1].connected === false && s.body.cloud.servers[1].web === ACME.url + '/app', s.body.cloud.servers)
  check('the cloud half applied it (the marker names it)', JSON.parse(readFileSync(markerFile, 'utf8')).id === 'acme-corp')
  before = registryText()
}

console.log('SRV-06 the same server is never listed twice')
{
  const again = await post('/kybernos-servers/add', { address: ACME.url + '/' })
  const spelled = await post('/kybernos-servers/check', { address: ACME.host })
  const mirror = await post('/kybernos-servers/add', { address: AS_BUILTIN.url })
  check('another spelling of an address already in the list is refused, naming the entry', again.body.ok === false && again.body.error === 'already_listed' && again.body.id === 'acme-corp' && spelled.body.error === 'already_listed', [again.body, spelled.body])
  check('a server that publishes the BUILT-IN address is refused too (the hand-written « production » entry case)', mirror.body.ok === false && mirror.body.error === 'already_listed' && mirror.body.id === 'kybernos-cloud', mirror.body)
  check('none of it wrote anything', registryText() === before)
}

console.log('SRV-05 names and ids never collide')
{
  const named = await post('/kybernos-servers/add', { address: PLAIN_1.url, name: '  Staging  ', activate: false })
  check('a name the person typed is kept; activate:false leaves the active server alone', named.body.ok === true && named.body.active === false && readRegistry().servers[1].name === 'Staging' && readRegistry().active === 'acme-corp', readRegistry())
  const second = await post('/kybernos-servers/add', { address: PLAIN_2.url, activate: false })
  check('another server answering « Kybernos » is « Kybernos · host », and its id follows that name', second.body.ok === true && readRegistry().servers[2].name === 'Kybernos · ' + PLAIN_2.host && /^kybernos-127-0-0-1-\d+$/.test(readRegistry().servers[2].id), readRegistry().servers[2])
  check('the first one\'s id follows the name the person typed, not the name the server published', readRegistry().servers[1].id === 'staging', readRegistry().servers[1])
  const third = await post('/kybernos-servers/add', { address: SPARE.url, name: 'staging', activate: false })
  check('a typed name already taken becomes « (2) »', third.body.ok === true && readRegistry().servers[3].name === 'staging (2)', readRegistry().servers[3])
  const ids3 = readRegistry().servers.map((s) => s.id)
  check('every id is valid, unique and never the built-in one', new Set(ids3).size === ids3.length && ids3.every((i) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(i) && i !== 'kybernos-cloud'), ids3)
}

console.log('SRV-04 services are kept')
{
  const r = await post('/kybernos-servers/add', { address: WITH_CONN.url, activate: false })
  const entry = readRegistry().servers.find((s) => s.name === 'Connected Co')
  check('a connections endpoint on the server\'s own origin and « no Kybernos models » reach the registry', r.body.ok === true && entry.services.llm === false && entry.services.connections === WITH_CONN.url + '/v1/mcp/connections', entry)
  const s = await call('GET', '/kybernos-servers/status')
  const row = s.body.cloud.servers.find((x) => x.name === 'Connected Co')
  check('the cloud half offers the connected apps for it and shows « none » for the LLM', row.connections === true && row.llm === 'none', row)
}

console.log('SRV-09 when the switch cannot be applied')
{
  const text = registryText()
  flags.applyDown = true
  const fail = await post('/kybernos-servers/add', { address: DEAD.host })
  check('(a server that does not answer is refused before anything is written)', fail.body.ok === false && registryText() === text)
  const mid = await fake(profile({ name: 'Midway' }))
  const r = await post('/kybernos-servers/add', { address: mid.url })
  check('the server stays added, only the switch is undone, and the answer says so', r.body.ok === false && r.body.error === 'apply_failed' && r.body.added === true && readRegistry().servers.some((s) => s.name === 'Midway') && readRegistry().active === 'acme-corp', r.body)
  const sw = await post('/kybernos-servers/switch', { id: 'kybernos-cloud' })
  check('a switch that cannot be applied is undone: the active server is what it was', sw.body.ok === false && sw.body.error === 'apply_failed' && readRegistry().active === 'acme-corp', sw.body)
  flags.applyDown = false
}

console.log('switch and the way back')
{
  const sw = await post('/kybernos-servers/switch', { id: 'staging' })
  check('switching writes the registry and the cloud half applies it', sw.body.ok === true && readRegistry().active === 'staging' && JSON.parse(readFileSync(markerFile, 'utf8')).id === 'staging', sw.body)
  const back = await post('/kybernos-servers/switch', { id: 'kybernos-cloud' })
  check('the way back to Kybernos Cloud always works', back.body.ok === true && readRegistry().active === 'kybernos-cloud' && JSON.parse(readFileSync(markerFile, 'utf8')).id === 'kybernos-cloud', back.body)
  const nope = await post('/kybernos-servers/switch', { id: 'no-such-server' })
  check('an unknown server cannot be switched to', nope.body.ok === false && nope.body.error === 'unknown_server')
}

console.log('rename')
{
  const ok = await post('/kybernos-servers/rename', { id: 'acme-corp', name: '  Acme  (prod)  ' })
  check('renaming cleans and stores the name', ok.body.ok === true && ok.body.name === 'Acme (prod)' && readRegistry().servers.find((s) => s.id === 'acme-corp').name === 'Acme (prod)', ok.body)
  const taken = await post('/kybernos-servers/rename', { id: 'acme-corp', name: 'Staging' })
  const cloudName = await post('/kybernos-servers/rename', { id: 'staging', name: 'Kybernos Cloud' })
  check('a name already used (even the built-in one) gets a counter', /^Staging \(\d+\)$/.test(taken.body.name) && cloudName.body.name === 'Kybernos Cloud (2)', [taken.body, cloudName.body])
  const empty = await post('/kybernos-servers/rename', { id: 'acme-corp', name: '  <> ' })
  const builtin = await post('/kybernos-servers/rename', { id: 'kybernos-cloud', name: 'x' })
  const unknown = await post('/kybernos-servers/rename', { id: 'nope', name: 'x' })
  check('an empty name, the built-in server and an unknown one are refused', empty.body.error === 'bad_name' && builtin.body.error === 'bad_id' && unknown.body.error === 'unknown_server', [empty.body, builtin.body, unknown.body])
}

console.log('SRV-10 removing forgets the sign-in, and only that one')
{
  for (const id of ['acme-corp', 'staging']) writeFileSync(connectionOf(id), JSON.stringify({ token: 'tok-' + id, user: { id: 'u-' + id } }))
  const s = await call('GET', '/kybernos-servers/status')
  check('(setup) both servers now show as signed in', s.body.cloud.servers.filter((x) => x.connected).map((x) => x.id).sort().join() === 'acme-corp,staging', s.body.cloud.servers)
  const r = await post('/kybernos-servers/remove', { id: 'staging' })
  check('the entry and its connection file go; the other server\'s sign-in stays', r.body.ok === true && !readRegistry().servers.some((x) => x.id === 'staging') && !existsSync(connectionOf('staging')) && existsSync(connectionOf('acme-corp')), r.body)
  await post('/kybernos-servers/switch', { id: 'acme-corp' })
  const act = await post('/kybernos-servers/remove', { id: 'acme-corp' })
  check('removing the ACTIVE server goes back to Kybernos Cloud first (applied), then forgets it', act.body.ok === true && readRegistry().active === 'kybernos-cloud' && JSON.parse(readFileSync(markerFile, 'utf8')).id === 'kybernos-cloud' && !existsSync(connectionOf('acme-corp')), act.body)
  const again = await post('/kybernos-servers/remove', { id: 'acme-corp' })
  const builtin = await post('/kybernos-servers/remove', { id: 'kybernos-cloud' })
  const trav = await post('/kybernos-servers/remove', { id: '../acme' })
  check('removing an unknown server says so; the built-in server and a traversal are refused', again.body.error === 'unknown_server' && builtin.body.error === 'bad_id' && trav.body.error === 'bad_id', [again.body, builtin.body, trav.body])
}

console.log('SRV-08 a registry that is not ours to overwrite')
{
  const garbage = '{ not json'
  writeFileSync(registryFile, garbage)
  const a = await post('/kybernos-servers/add', { address: SPARE.url })
  const r = await post('/kybernos-servers/rename', { id: 'x', name: 'y' })
  const d = await post('/kybernos-servers/remove', { id: 'x' })
  const s = await post('/kybernos-servers/switch', { id: 'x' })
  check('add, rename, remove and switch all refuse, and the file is byte for byte as it was', a.body.error === 'registry_unreadable' && r.body.error === 'registry_unreadable' && d.body.error === 'registry_unreadable' && s.body.error === 'registry_unreadable' && readFileSync(registryFile, 'utf8') === garbage)
  writeFileSync(registryFile, '[1,2]')
  const arr = await post('/kybernos-servers/add', { address: SPARE.url })
  check('a JSON array is not a registry either', arr.body.error === 'registry_unreadable' && readFileSync(registryFile, 'utf8') === '[1,2]')
  writeFileSync(registryFile, JSON.stringify({ active: 'kybernos-cloud', servers: [] }))
}

console.log('SRV-11 guards')
{
  const noOrigin = await call('POST', '/kybernos-servers/add', { address: SPARE.url }, { origin: '' })
  const other = await call('POST', '/kybernos-servers/add', { address: SPARE.url }, { origin: 'https://evil.example' })
  const noOriginAtAll = await fetch(DSH + '/kybernos-servers/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('a POST with no origin, or from another origin, is refused (403)', noOrigin.status === 403 && other.status === 403 && noOriginAtAll.status === 403, [noOrigin.status, other.status, noOriginAtAll.status])
  const ref = await call('POST', '/kybernos-servers/check', { address: SPARE.url }, { origin: '', referer: DSH + '/settings' })
  check('a same-origin Referer is enough', ref.status === 200 && ref.body.ok === true, ref)
  const get = await call('GET', '/kybernos-servers/add')
  const postStatus = await post('/kybernos-servers/status', {})
  check('GET only on status, POST only on the rest', get.status === 405 && postStatus.status === 405, [get.status, postStatus.status])
  const badBody = await fetch(DSH + '/kybernos-servers/check', { method: 'POST', headers: { origin: DSH, 'content-type': 'application/json' }, body: 'not json' })
  check('a body that is not JSON is a 400', badBody.status === 400)
  const bad = await Promise.all(['', 'A', 'a/b', '../x', 'x'.repeat(41), 5, null].map((id) => post('/kybernos-servers/switch', { id })))
  check('ids with a slash, upper case, a traversal, too long, not a string: bad_id, nothing switched', bad.every((r) => r.body.error === 'bad_id') && readRegistry().active === 'kybernos-cloud', bad.map((r) => r.body.error))
  // A page that rebinds its own name to this machine reaches the routes with its own name as Host (scripts/test-route-hosts.mjs).
  const withHost = (method, path, host, headers = {}) => new Promise((resolve) => {
    const u = new URL(DSH)
    const r = httpRequest({ host: u.hostname, port: u.port, method, path, headers: Object.assign({ host, 'content-type': 'application/json' }, headers) }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: b })) })
    r.end(method === 'POST' ? '{}' : undefined)
  })
  const rebound = await Promise.all([withHost('GET', '/kybernos-servers/status', 'attacker.example:' + new URL(DSH).port), withHost('POST', '/kybernos-servers/check', 'attacker.example:' + new URL(DSH).port, { origin: 'http://attacker.example:' + new URL(DSH).port })])
  check('a request whose Host is not this machine is refused, a read as well as a write (DNS rebinding)', rebound.every((r) => r.status === 403), rebound)
  const home2 = await withHost('GET', '/kybernos-servers/status', '127.0.0.1:' + new URL(DSH).port)
  check('…and the same read with this machine\'s own Host is answered', home2.status === 200)
  const missing = await post('/kybernos-servers/licence', {})
  check('there is no licence route any more', missing.status === 404, missing.status)
}

for (const f of fakes) { try { await f.close() } catch (e) { /* already closed */ } }
await new Promise((r) => dsh.close(r))
console.log(failed === 0 ? '\nall good' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
