// ═════════════════════════════════════════════════════════════════════
// The routes of this bundle that WRITE (the Composio key, the connectors, their folders, the provider choice, the API connectors) need
// DSH's signed session as well as the right Origin. DSH serves plugin routes before its own login and an Origin header is forgeable by
// any local program: before this rule `curl -X DELETE http://127.0.0.1:<port>/kybernos/composio/key` removed the key, with no header at all.
//
// For each write, in this order: no Origin and no cookie · a foreign Origin (even with a valid cookie) · the right Origin and no cookie
// (what a local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the person's own page).
// The reads (GET) are left as they were. Composio is a stand-in (lib-test.mjs composioStub): no network.
//
//   node packages/kybernos-composio/test-write-guard.mjs
// ═════════════════════════════════════════════════════════════════════
import { readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { suite, startHost, composioStub } from './lib-test.mjs'
import { OTHER_SECRET, sessionCookie, browserHeaders } from './lib-session-test.mjs'

const { ok, done } = suite()
const comp = composioStub()
delete process.env.COMPOSIO_API_KEY

const WRITES = [
  { name: 'connectors: save', path: '/kybernos/composio/connecteurs', method: 'POST', body: { nom: 'poc' } },
  { name: 'connectors: delete', path: '/kybernos/composio/connecteurs?nom=poc', method: 'DELETE' },
  { name: 'connectors: test (starts the connector\'s command)', path: '/kybernos/composio/connecteurs/test', method: 'POST', body: { nom: 'poc' } },
  { name: 'connector folders: add', path: '/kybernos/composio/connecteurs/commande', method: 'POST', body: { dir: '/nowhere' } },
  { name: 'connector folders: forget', path: '/kybernos/composio/connecteurs/commande?dir=/nowhere', method: 'DELETE' },
  { name: 'key: save', path: '/kybernos/composio/key', method: 'POST', body: { key: 'ck_good' } },
  { name: 'key: delete', path: '/kybernos/composio/key', method: 'DELETE' },
  { name: 'accounts: add or remove', path: '/kybernos/composio/accounts', method: 'POST', body: { action: 'add', toolkit: 'gmail' } },
  { name: 'provider: choose', path: '/kybernos/composio/provider', method: 'POST', body: { provider: 'composio' } },
  { name: 'API connectors: read, add, test, remove', path: '/kybernos/composio/openapi', method: 'POST', body: { action: 'remove', name: 'nothing' } },
]
const refused = (r) => r.code === 401 || r.code === 403

const h = await startHost()
/** Every file under the DSH folder with its size: what a refused write must leave exactly as it was. */
const tree = (dir = h.dsh) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(dir, e.name)) : [join(dir, e.name) + ':' + statSync(join(dir, e.name)).size])).sort().join('|')
let calls = comp.state.calls.length

for (const w of WRITES) {
  const send = (headers) => h.call(w.path, { method: w.method, body: w.body, headers, bare: true })
  const before = tree()
  let r = await send({})
  ok(w.name + ': no Origin and no cookie -> 403', r.code === 403, String(r.code))
  r = await send({ ...browserHeaders(), origin: 'http://evil.example' })
  ok(w.name + ': a foreign Origin -> 403, even with the real cookie', r.code === 403, String(r.code))
  r = await send({ origin: 'http://127.0.0.1:3080' })
  ok(w.name + ': the right Origin and no cookie -> 401', r.code === 401, String(r.code))
  r = await send({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) })
  ok(w.name + ': the right Origin and a forged cookie -> 401', r.code === 401, String(r.code))
  ok(w.name + ': ...and nothing was written, nothing called out', tree() === before && comp.state.calls.length === calls)
  r = await send(browserHeaders())
  ok(w.name + ': the right Origin and the real cookie -> the route answers (' + r.code + ')', !refused(r) && r.code !== null, String(r.code))
  // Put the fixtures back so the next write starts from nothing.
  for (const f of ['env', 'patch', 'sidecar']) rmSync(h.files[f], { force: true })
  rmSync(join(h.dsh, 'kybernos', 'provider.json'), { force: true })
  calls = comp.state.calls.length
}

// The reads keep answering as before: no header needed for a GET from the page, and a foreign Origin is still refused.
{
  const get = (path, headers) => h.call(path, { headers, bare: true })
  ok('reads: GET key answers with no header', (await get('/kybernos/composio/key', {})).code === 200)
  ok('reads: GET connectors answers with no header', (await get('/kybernos/composio/connecteurs', {})).code === 200)
  ok('reads: GET key from a foreign Origin -> 403', (await get('/kybernos/composio/key', { origin: 'http://evil.example' })).code === 403)
}
h.stop()
done('test-write-guard')
