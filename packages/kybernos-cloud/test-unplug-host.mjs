// The old stack is unplugged: what the cloud host does against the NEW server where the old one answered differently.
//   node packages/kybernos-cloud/test-unplug-host.mjs
//
// A fake server that speaks the new server's contract (its 404 for an unknown route, its invitations route, its public legal
// document) and a fake DSH context. What is proven:
//   - a connection recorded against ANOTHER server's address (an install from before the new server became the default) is never used:
//     the « kybernos » model route and its credential it imported are removed, the file is moved aside under its own host's name
//     (kept, not read for this server) and the token reaches nobody;
//   - inviting by e-mail goes to /invitations (the new server answers 400 to {email} on /members), a user id stays on /members;
//   - public links and hosted chats, which the new server does not have, are reported as « not on this server », not as a raw not_found;
//   - the terms and privacy addresses come from GET /v1/public/legal, https only.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const WS = '01a11cce-434d-7264-86d5-8335899c833f'
const NEW_TOKEN = 'kyd_' + 'n'.repeat(40)
const OLD_TOKEN = 'kys-' + 'o'.repeat(43)
const seen = []
let legal = { terms: { version: '2026-10', url: 'https://example.test/terms' }, privacy: null }
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw === '' ? null : JSON.parse(raw)
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body })
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
    const url = req.url.split('?')[0]
    if (url === '/v1/public/legal') return send(200, legal)
    if (url === '/v1/models') return send(200, { data: [] })
    if (url === `/v1/workspaces/${WS}/invitations` && req.method === 'POST') return send(201, { id: 'inv-1' })
    if (url === `/v1/workspaces/${WS}/members` && req.method === 'POST') {
      if (typeof body.user_id !== 'string') return send(400, { error: 'invalid_request', message: 'user_id required' })
      return send(200, { ok: true })
    }
    return send(404, { error: 'not_found', message: 'No such route.' }) // the new server's answer to a path it does not have (/v1/shares, /v1/chats)
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const API = 'http://127.0.0.1:' + api.address().port

const home = mkdtempSync(join(tmpdir(), 'kb-unplug-'))
const stateFile = join(home, 'kybernos-cloud.json')
process.env.DSH_HOME = home
process.env.KYBERNOS_CLOUD_API = API
delete process.env.KYBERNOS_CLOUD_STATE
delete process.env.KYBERNOS_SERVERS_FILE
process.env.KYBERNOS_CLOUD_KYBERS = mkdtempSync(join(tmpdir(), 'kb-unplug-kybers-'))

// ── a connection left by the OLD stack, and the model route it imported ──
const OLD_API = 'http://127.0.0.1:9' // another origin: nothing listens there, and nothing should be sent
writeFileSync(stateFile, JSON.stringify({
  token: OLD_TOKEN, api: OLD_API, user: { id: 'u-old', plan: 'solo' }, workspaces: [{ id: WS, name: 'Old' }],
  models: { provider: 'kybernos', base_url: OLD_API + '/v1', count: 1, ids: ['kybernos/x'], settings: true, credential: true },
}), { mode: 0o600 })
const settingsStore = { 'llm-pi-ai': { providers: { kybernos: { baseURL: OLD_API + '/v1', apiKeyEnv: 'KYBERNOS_API_KEY', models: [{ id: 'kybernos/x' }] } } } }
const credentialStore = new Map([['KYBERNOS_API_KEY', OLD_TOKEN]])
const fakeSettings = { async mutate(ns, ops) { for (const op of ops) if (op.op === 'unset') { let n = settingsStore[ns]; for (const k of op.path.slice(0, -1)) n = n === undefined ? undefined : n[k]; if (n !== undefined) delete n[op.path[op.path.length - 1]] } return { ok: true } } }
const fakeCredentials = { async set(ref, v) { credentialStore.set(ref, v) }, async unset(ref) { credentialStore.delete(ref) }, async resolve(ref) { return credentialStore.has(ref) ? { value: credentialStore.get(ref) } : undefined } }
const routes = new Map()
const fakeTools = { register: () => () => {} }
const fakePrompt = { context: () => {} }
const ctx = {
  systemPrompt: fakePrompt,
  tools: fakeTools,
  get: (name) => (name === 'webServer' ? { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } } : name === 'settings' ? fakeSettings : name === 'credentials' ? fakeCredentials : name === 'tools' ? fakeTools : name === 'systemPrompt' ? fakePrompt : undefined),
  inject: (_l, cb) => cb(ctx),
  effect: (fn) => { fn() },
  on: () => {},
}

const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
mod.apply(ctx)

const fakeRes = () => ({ status: 0, body: null, writeHead(s) { this.status = s }, end(p) { this.body = p === undefined || p === '' ? null : JSON.parse(p) } })
const hit = async (path, method, body) => {
  const handler = routes.get(path.split('?')[0])
  assert.ok(handler !== undefined, 'route missing: ' + path)
  const res = fakeRes()
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } }
  await handler(req, res)
  return res
}

console.log('a connection left by the old stack')
{
  // The file is set aside at once (before anything can use the token); the model route and credential follow when the services are there.
  for (let i = 0; i < 60 && (existsSync(stateFile) || credentialStore.has('KYBERNOS_API_KEY')); i += 1) await sleep(50)
  check('the file is no longer where this server looks for its connection', existsSync(stateFile) === false)
  const aside = readdirSync(home).filter((f) => /^kybernos-cloud-.+\.json$/.test(f))
  check('it was MOVED aside (kept, under the name of its own host), not deleted', aside.length === 1 && JSON.parse(readFileSync(join(home, aside[0]), 'utf8')).token === OLD_TOKEN, JSON.stringify(aside))
  check('the file kept its 0600 mode', aside.length === 1 && (statSync(join(home, aside[0])).mode & 0o777) === 0o600)
  check('the model route it imported is gone, so chat never goes to the old address', settingsStore['llm-pi-ai'].providers.kybernos === undefined)
  check('and so is its credential (the old token is not left for the model route)', credentialStore.has('KYBERNOS_API_KEY') === false)
  check('the status says not connected', (await hit('/kybernos-cloud/status', 'GET')).body.connected === false)
  check('the new server never saw the old token', seen.every((c) => c.auth !== 'Bearer ' + OLD_TOKEN), JSON.stringify(seen.map((c) => c.url)))
}

console.log('a connection of THIS server is left alone')
{
  writeFileSync(stateFile, JSON.stringify({ token: NEW_TOKEN, api: API, user: { id: 'u-1', plan: 'solo' }, workspaces: [{ id: WS, name: 'Mine' }], active_workspace_id: WS }), { mode: 0o600 })
  check('its state is read as connected', (await hit('/kybernos-cloud/status', 'GET')).body.connected === true)
}

console.log('inviting people')
{
  seen.length = 0
  const mail = await hit('/kybernos-cloud/members/invite', 'POST', { email: 'Someone@Example.test', role: 'member' })
  const call = seen.find((c) => c.method === 'POST')
  check('an e-mail address is an INVITATION (the new server answers 400 to it on /members)', mail.body.ok === true && call !== undefined && call.url === `/v1/workspaces/${WS}/invitations` && JSON.stringify(call.body) === JSON.stringify({ email: 'someone@example.test', role: 'member' }), JSON.stringify([mail.body, call]))
  check('with the account token and nothing else', call !== undefined && call.auth === 'Bearer ' + NEW_TOKEN)
  seen.length = 0
  const user = await hit('/kybernos-cloud/members/invite', 'POST', { user_id: '01a11cce-0000-7000-8000-000000000001', role: 'admin' })
  const call2 = seen.find((c) => c.method === 'POST')
  check('a user id stays an upsert of the role on /members', user.body.ok === true && call2 !== undefined && call2.url === `/v1/workspaces/${WS}/members` && call2.body.user_id === '01a11cce-0000-7000-8000-000000000001' && call2.body.role === 'admin')
}

console.log('public links and hosted chats (paused on the new server)')
{
  const get = await hit('/kybernos-cloud/shares?resource_type=artifact&resource_id=abc', 'GET')
  const set = await hit('/kybernos-cloud/shares/set', 'POST', { resource_type: 'artifact', resource_id: 'abc', audience: 'link' })
  const rev = await hit('/kybernos-cloud/shares/revoke', 'POST', { resource_type: 'artifact', resource_id: 'abc' })
  const chat = await hit('/kybernos-cloud/chat/ensure', 'POST', { external_ref: 'chat-1', title: 'T' })
  for (const [name, r] of [['reading a link', get], ['making a link', set], ['taking a link back', rev], ['hosting a chat', chat]]) {
    check(name + ': « not on this server », a word the page can say plainly (never a raw not_found)', r.body.ok === false && r.body.error === 'not_on_this_server', JSON.stringify(r.body))
  }
}

console.log('terms and privacy')
{
  const ok = await hit('/kybernos-cloud/legal', 'GET')
  check('the addresses come from the server\'s public legal document, null for one it does not configure', ok.body.ok === true && ok.body.terms.url === 'https://example.test/terms' && ok.body.privacy === null, JSON.stringify(ok.body))
  legal = { terms: { version: '1', url: 'javascript:alert(1)' }, privacy: { version: '1', url: 'http://remote.example/privacy' } }
  const bad = await hit('/kybernos-cloud/legal', 'GET')
  check('a link that is not https (javascript:, http to a remote host) is never handed to the page', bad.body.ok === true && bad.body.terms === null && bad.body.privacy === null, JSON.stringify(bad.body))
  legal = { terms: { version: '2', url: 'http://127.0.0.1:8080/terms' }, privacy: null }
  check('http is accepted for a loopback server only', (await hit('/kybernos-cloud/legal', 'GET')).body.terms.url === 'http://127.0.0.1:8080/terms')
  check('it needs no sign-in (a person reads the terms before an account)', seen.filter((c) => c.url === '/v1/public/legal').every((c) => c.auth === null))
}

await new Promise((r) => api.close(r))
rmSync(home, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
