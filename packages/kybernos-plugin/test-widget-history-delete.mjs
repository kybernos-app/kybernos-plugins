// ── The widget's visitor can delete their own conversation, and only with its token ────────────────────────────────────
//
// A-15 (audit 2026-10-20): `POST /kybernos/widget/api/history-delete` deleted a conversation FILE with no guard at all — no
// token, no origin, nothing. The widget routes are public by design (a website's widget, CORS `*`), so the fence has to be a
// secret of the visitor's own conversation: the host mints one when it creates the conversation, hands it back ONCE in the
// answer to /message, and this route refuses (403) when the token is absent or wrong — and then nothing on disk moves.
//
//   node packages/kybernos-plugin/test-widget-history-delete.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-widget-delete-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
mkdirSync(process.env.DSH_HOME, { recursive: true })
// The published widget: an enabled door named `alpha`, in the kyber `kyber-alpha` (the store the host reads).
const widgetDir = join(process.env.DSH_HOME, 'kybernos-widget')
mkdirSync(widgetDir, { recursive: true })
writeFileSync(join(widgetDir, 'configs.json'), JSON.stringify({ 'kyber-alpha': { name: 'Alpha', items: [{ slug: 'alpha', enabled: true, label: 'Alpha' }] } }) + '\n')

// ── Mount the bundle's routes, as scripts/test-route-hosts.mjs does ──────────────────────────────────────────────────
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? {} : undefined)),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])
const routeOf = (path) => routes.find((r) => r.path === path && typeof r.handler === 'function')
for (const path of ['/kybernos/widget/api/config', '/kybernos/widget/api/message', '/kybernos/widget/api/history-delete']) {
  assert.ok(routeOf(path) !== undefined, 'route mounted: ' + path)
}

const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port

const call = (method, path, body) => new Promise((resolve) => {
  const payload = body === undefined ? null : JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: own, origin: 'http://' + own, ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch (e) { json = null } resolve({ status: res.statusCode, text, json }) })
  })
  req.on('error', () => resolve({ status: 0, text: '', json: null }))
  if (payload !== null) req.write(payload)
  req.end()
})

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const convFile = (id) => join(process.env.DSH_HOME, 'kybernos-widget', 'conversations', 'kyber-alpha', id + '.jsonl')
const recordFile = (id) => join(process.env.DSH_HOME, 'kybernos-widget', 'conversations', 'kyber-alpha', id + '.json')

try {
  console.log('Kybernos widget: history-delete needs the conversation token')

  const config = await call('GET', '/kybernos/widget/api/config?team=alpha')
  assert.equal(config.status, 200, 'the published door answers: ' + config.text.slice(0, 120))

  // 1. The first message creates the conversation AND mints the token, handed back once.
  const first = await call('POST', '/kybernos/widget/api/message', { team: 'alpha', text: 'hello' })
  assert.equal(first.status, 200, 'a message from the site is delivered: ' + first.text.slice(0, 120))
  const id = first.json.conversationId
  assert.match(String(id), /^c-[a-z0-9]+-[0-9a-f]{8}$/, 'the conversation id keeps its shape: ' + String(id))
  assert.match(String(first.json.token), /^[0-9a-f]{32}$/, 'the creation answer carries the token')
  const token = first.json.token
  assert.ok(existsSync(convFile(id)), 'the conversation file exists on disk')
  assert.equal(JSON.parse(readFileSync(recordFile(id), 'utf8')).token, token, 'the record on disk holds the token')
  ok('first message → conversation created, token minted once and stored beside the JSONL')

  // 2. The GET listing never leaks the token (it is not a message, and no answer echoes it).
  const listing = await call('GET', '/kybernos/widget/api/message?team=alpha&conversation=' + encodeURIComponent(id))
  assert.equal(listing.status, 200, 'the listing answers')
  assert.equal(listing.json.messages.length, 1, 'the visitor message is listed')
  assert.equal(listing.text.includes(token), false, 'the token does not leak in the GET listing')
  ok('GET /message lists the messages and never the token')

  // 3. A later append (same conversation, id only) answers without the token: knowing the id does not reveal the secret.
  const again = await call('POST', '/kybernos/widget/api/message', { team: 'alpha', text: 'second', conversationId: id })
  assert.equal(again.status, 200, 'a later message is delivered')
  assert.equal(again.json.conversationId, id, 'the same conversation is kept')
  assert.equal(again.json.token, undefined, 'a later append does not hand the token again')
  ok('later append on an existing conversation does not return the token')

  // 4. No token → 403, and the file is untouched.
  const noToken = await call('POST', '/kybernos/widget/api/history-delete', { team: 'alpha', conversation: id })
  assert.equal(noToken.status, 403, 'no token → 403, got ' + noToken.status + ' ' + noToken.text.slice(0, 80))
  assert.ok(existsSync(convFile(id)), 'a refused delete left the conversation file on disk')
  ok('delete with no token → 403, nothing deleted')

  // 5. A wrong token → 403, and the file is untouched.
  const wrong = await call('POST', '/kybernos/widget/api/history-delete', { team: 'alpha', conversation: id, token: 'd'.repeat(32) })
  assert.equal(wrong.status, 403, 'a wrong token → 403, got ' + wrong.status + ' ' + wrong.text.slice(0, 80))
  assert.ok(existsSync(convFile(id)), 'a refused delete left the conversation file on disk')
  ok('delete with a wrong token → 403, nothing deleted')

  // 6. An unknown widget stays a 404, whatever the token.
  const unknown = await call('POST', '/kybernos/widget/api/history-delete', { team: 'nope', conversation: id, token: token })
  assert.equal(unknown.status, 404, 'an unknown widget → 404, got ' + unknown.status)
  assert.ok(existsSync(convFile(id)), 'the unknown-team refusal deleted nothing')
  ok('unknown widget → 404, nothing deleted')

  // 7. The right token deletes the conversation and its record.
  const real = await call('POST', '/kybernos/widget/api/history-delete', { team: 'alpha', conversation: id, token: token })
  assert.equal(real.status, 200, 'the right token deletes: ' + real.text.slice(0, 120))
  assert.equal(real.json.ok, true)
  assert.equal(real.json.parti, true, 'the file was there and is gone')
  assert.equal(existsSync(convFile(id)), false, 'the conversation file is gone')
  assert.equal(existsSync(recordFile(id)), false, 'the token record is gone with it')
  ok('delete with the right token → 200, conversation file and record removed')

  // 8. A second delete is refused (the record that held the token is gone): a deleted conversation owns no token.
  const twice = await call('POST', '/kybernos/widget/api/history-delete', { team: 'alpha', conversation: id, token: token })
  assert.equal(twice.status, 403, 'a replay after deletion → 403, got ' + twice.status)
  ok('a replayed delete after deletion → 403')

  console.log('\nWIDGET HISTORY-DELETE — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  // The bundle boots timers and watchers of its own (the host keeps them alive): this test ends when its checks do.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}
