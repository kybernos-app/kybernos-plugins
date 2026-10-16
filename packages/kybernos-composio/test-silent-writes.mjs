// A3-29: a request that says nothing about where it comes from (no Origin, no Referer: a script, another local user) may read,
// it may not write. Plugin routes are served before DSH's own sign-in, so this is the only door. Composio's routes write a secret
// (the key), a file (the connectors, the choice of provider) or start a process (a stdio connector).
//
//   node test-silent-writes.mjs
import { suite, startHost } from './lib-test.mjs'

const { ok, done } = suite()
delete process.env.COMPOSIO_API_KEY
const SILENT = { origin: '' }
const REFERER_OK = { origin: '', referer: 'http://127.0.0.1:3080/settings' }
const REFERER_BAD = { origin: '', referer: 'https://evil.example/page' }

const h = await startHost()
const K = '/kybernos/composio/key'
const P = '/kybernos/composio/provider'
const C = '/kybernos/composio/connecteurs'
const O = '/kybernos/composio/openapi'

// the writes that were open
for (const [label, path, method, body] of [
  ['delete the key', K, 'DELETE', undefined],
  ['replace the key', K, 'POST', { key: 'ck_good' }],
  ['choose the provider', P, 'POST', { provider: 'composio' }],
  ['add a connector', C, 'POST', { nom: 'silent', transport: 'streamable-http', url: 'https://ex.example/mcp', headers: [], env: [], secrets: [] }],
  ['remove a connector', C + '?nom=silent', 'DELETE', undefined],
  ['change the API connectors', O, 'POST', { action: 'remove', name: 'silent' }],
]) {
  const r = await h.call(path, { method, body, headers: SILENT })
  ok('a silent request cannot ' + label + ' (403, and nothing ran)', r.code === 403 && r.json !== null && r.json.ok === false, r.code + ' ' + r.text.slice(0, 80))
}
ok('...and the choice was not written', (await h.call(P)).json.provider === null)

// what must keep working
ok('a silent read still reads (a page sends no Origin on a same-origin GET)', (await h.call(P, { headers: SILENT })).code === 200 && (await h.call(K, { headers: SILENT })).code === 200)
ok('a page of this DSH writes as before (Origin)', (await h.call(P, { method: 'POST', body: { provider: 'composio' } })).code === 200)
ok('a write that only sends a Referer of this DSH is accepted', (await h.call(P, { method: 'POST', body: { provider: 'kybernos' }, headers: REFERER_OK })).code === 200)
ok('a Referer of another site is refused', (await h.call(P, { method: 'POST', body: { provider: 'composio' }, headers: REFERER_BAD })).code === 403)
ok('another origin is still refused', (await h.call(P, { method: 'POST', body: { provider: 'composio' }, headers: { origin: 'https://evil.example', host: 'localhost:3080' } })).code === 403)
h.stop()
done()
