// ═════════════════════════════════════════════════════════════════════
// Tests for the key and accounts routes: the page no longer holds the Composio key. The host checks it,
// writes it where the agents read it, and adds and removes accounts with it. Composio is a stand-in
// (lib-test.mjs composioStub): no network.
//
//   node test-key.mjs
// ═════════════════════════════════════════════════════════════════════
import { statSync, writeFileSync } from 'node:fs'
import { suite, startHost, composioStub } from './lib-test.mjs'

const { ok, done } = suite()
const K = '/kybernos/composio/key'
const A = '/kybernos/composio/accounts'
const C = '/kybernos/composio/connections'
const comp = composioStub()
delete process.env.COMPOSIO_API_KEY

{
  const h = await startHost()
  let r = await h.call(K)
  ok('key: nothing configured at first', r.code === 200 && r.json.configured === false && r.json.agents === 'none' && r.json.source === null)
  r = await h.call(K, { method: 'POST', body: { key: 'not a key' } })
  ok('key: a value that is not a Composio key is refused before anything else', r.code === 400 && r.json.code === 'invalid-key' && comp.state.calls.length === 0)
  r = await h.call(K, { method: 'POST', body: { key: 'ck_wrong' } })
  ok('key: a key Composio rejects is refused and NOT saved', r.code === 400 && r.json.code === '401' && h.files.read('env') === null, r.text.slice(0, 100))
  r = await h.call(K, { method: 'POST', body: { key: 'ck_good' } })
  ok('key: a good key is verified and saved', r.code === 200 && r.json.verified === true && r.json.needRestart === true, r.text.slice(0, 120))
  ok('key: it is in the .env the agents read, privately, and the answer never returns it', h.files.read('env') === 'COMPOSIO_API_KEY=ck_good\n' && (statSync(h.files.env).mode & 0o077) === 0 && !r.text.includes('ck_good'))
  r = await h.call(K)
  ok('key: GET now says configured, from the file, and that the running agents do not hold it yet', r.json.configured === true && r.json.source === 'env-file' && r.json.agents === 'none' && !r.text.includes('ck_good'))
  r = await h.call(C + '?toolkits=gmail')
  ok('key: the connections route sees the new key at once (no restart for the page)', r.json.configured === true && r.json.error === null, r.text.slice(0, 100))
  process.env.COMPOSIO_API_KEY = 'ck_good'
  r = await h.call(K)
  ok('key: when the agents\' environment holds the same key, it says so', r.json.agents === 'same')
  process.env.COMPOSIO_API_KEY = 'ck_other'
  ok('key: ...or another one', (await h.call(K)).json.agents === 'different')
  r = await h.call(K, { method: 'POST', body: { key: 'ck_good' } })
  ok('key: saving the key the agents do not have yet says a restart is needed; saving the same one does not', r.json.needRestart === true)
  process.env.COMPOSIO_API_KEY = 'ck_good'
  ok('key: ...(same key: no restart)', (await h.call(K, { method: 'POST', body: { key: 'ck_good' } })).json.needRestart === false)
  delete process.env.COMPOSIO_API_KEY

  // other variables of the .env are not touched
  h.files.write('env', 'OTHER=1\n# a comment\nCOMPOSIO_API_KEY=ck_good\nLAST=x\n')
  await h.call(K, { method: 'POST', body: { key: 'ck_good' } })
  ok('key: saving keeps the other variables and comments', h.files.read('env') === 'OTHER=1\n# a comment\nCOMPOSIO_API_KEY=ck_good\nLAST=x\n', JSON.stringify(h.files.read('env')))
  r = await h.call(K, { method: 'DELETE' })
  ok('key: DELETE removes only that line', r.code === 200 && h.files.read('env') === 'OTHER=1\n# a comment\nLAST=x\n', JSON.stringify(h.files.read('env')))
  ok('key: ...and the page then says there is no key', (await h.call(K)).json.configured === false)

  // guards
  ok('key: hostile origin -> 403', (await h.call(K, { method: 'POST', body: { key: 'ck_good' }, headers: { origin: 'http://evil.example' } })).code === 403)
  ok('key: text/plain -> 415', (await h.call(K, { method: 'POST', body: { key: 'ck_good' }, headers: { 'content-type': 'text/plain' } })).code === 415)
  ok('key: a body that is not JSON -> 400', (await h.call(K, { method: 'POST', raw: '{no' })).code === 400)
  ok('key: GET from a hostile origin -> 403', (await h.call(K, { headers: { origin: 'http://evil.example' } })).code === 403)
  h.stop()
}
{
  // Composio unreachable: the key is saved (it is not the key's fault), and the answer says it was not verified
  const h = await startHost()
  comp.state.down = true
  const r = await h.call(K, { method: 'POST', body: { key: 'ck_good' } })
  comp.state.down = false
  ok('key: with Composio unreachable the key is still saved, flagged unverified', r.code === 200 && r.json.verified === false && r.json.code === 'offline' && h.files.read('env') === 'COMPOSIO_API_KEY=ck_good\n', r.text.slice(0, 120))
  h.stop()
}
{
  // a key DSH was launched with cannot be changed from here
  const h = await startHost({ services: { credentials: { describe: async () => ({ configured: true, source: 'env', writable: false }), resolve: async () => ({ value: 'ck_good', source: 'env' }) } } })
  let r = await h.call(K, { method: 'POST', body: { key: 'ck_good' } })
  ok('key: a key from the launching environment is not overwritten (409, says why)', r.code === 409 && r.json.code === 'inherited' && h.files.read('env') === null)
  ok('key: ...nor deleted', (await h.call(K, { method: 'DELETE' })).code === 409)
  r = await h.call(K)
  ok('key: ...and GET reports its source as the credentials service says', r.json.configured === true && r.json.source === 'env')
  h.stop()
}
{
  // the credentials service resolves a value from the .env as it was at launch: a key saved since wins
  let launch = 'ck_old'
  const h = await startHost({ services: { credentials: { describe: async () => ({ configured: true, source: 'user-env', writable: true }), resolve: async () => ({ value: launch, source: 'user-env' }) } } })
  comp.state.keys.add('ck_old'); comp.state.keys.add('ck_new')
  h.files.write('env', 'COMPOSIO_API_KEY=ck_new\n')
  comp.state.calls.length = 0
  await h.call(C + '?toolkits=gmail')
  ok('key: a value the credentials service read from a .env at launch yields to the file as it is now', comp.state.calls.some((c) => c.headers['x-consumer-api-key'] === 'ck_new') && !comp.state.calls.some((c) => c.headers['x-consumer-api-key'] === 'ck_old'))
  h.stop()
}

// ── accounts ────────────────────────────────────────────────────────────────
{
  const h = await startHost({ before: ({ env }) => { writeFileSync(env, 'COMPOSIO_API_KEY=ck_good\n') } })
  const post = (body, headers) => h.call(A, { method: 'POST', body, headers })
  let r = await post({ action: 'add', toolkit: 'gmail' })
  ok('accounts: add gives the address to authorize at, and the pending account', r.code === 200 && r.json.redirectUrl === 'https://connect.composio.dev/link/abc123' && r.json.connection.accounts.length === 1 && r.json.connection.accounts[0].status === 'initiated', r.text.slice(0, 200))
  ok('accounts: ...and never the person\'s e-mail from user_info', !r.text.includes('person@example.org'))
  comp.state.linkUrl = 'javascript:alert(1)'
  r = await post({ action: 'add', toolkit: 'gmail' })
  ok('accounts: a link that is not http(s) is dropped, not passed to the page', r.code === 200 && r.json.redirectUrl === null, r.text.slice(0, 120))
  comp.state.linkUrl = 'https://connect.composio.dev/link/abc123'
  const id = r.json.connection.accounts[0].id
  r = await post({ action: 'remove', toolkit: 'gmail', accountId: id })
  ok('accounts: remove drops that account and answers with the rest', r.code === 200 && !r.json.connection.accounts.some((a) => a.id === id) && r.json.connection.accounts.length === 1, r.text.slice(0, 160))
  comp.state.calls.length = 0
  await h.call(C + '?toolkits=slack'); await h.call(C + '?toolkits=slack')
  const cached = comp.state.calls.filter((c) => c.body && c.body.method === 'tools/call').length
  await h.call(C + '?toolkits=slack&fresh=1')
  ok('connections: fresh=1 skips the cache (the page polls while an account is authorized)', cached === 1 && comp.state.calls.filter((c) => c.body && c.body.method === 'tools/call').length === 2, String(cached))
  ok('accounts: invalid toolkit -> 400', (await post({ action: 'add', toolkit: 'Not A Slug!' })).code === 400)
  ok('accounts: invalid action -> 400', (await post({ action: 'wipe', toolkit: 'gmail' })).code === 400)
  ok('accounts: remove without a valid account id -> 400', (await post({ action: 'remove', toolkit: 'gmail', accountId: '../x' })).code === 400)
  ok('accounts: hostile origin -> 403, text/plain -> 415, GET -> 405', (await post({ action: 'add', toolkit: 'gmail' }, { origin: 'http://evil.example' })).code === 403 && (await post({ action: 'add', toolkit: 'gmail' }, { 'content-type': 'text/plain' })).code === 415 && (await h.call(A)).code === 405)
  comp.state.keys.delete('ck_good')
  r = await post({ action: 'add', toolkit: 'gmail' })
  ok('accounts: a key Composio now rejects is a 502 with the code the page knows', r.code === 502 && r.json.code === '401', r.text.slice(0, 100))
  comp.state.keys.add('ck_good')
  h.stop()
  const bare = await startHost()
  r = await bare.call(A, { method: 'POST', body: { action: 'add', toolkit: 'gmail' } })
  ok('accounts: no key at all -> 409 no-credential', r.code === 409 && r.json.code === 'no-credential')
  bare.stop()
}
comp.restore()
done('Key and accounts')
