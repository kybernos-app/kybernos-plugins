// ── What belongs to the account is not served by a team's own DSH ─────────────────────────────────────────────────────
//
// Kaby, its Telegram and WhatsApp doors and the Home computer belong to the account, not to a team (docs/dev/team-profiles-cadrage.md, step 3b). The
// pages that draw them are left out of a team's profile; this plays the other half, on a REAL HTTP server so the route wrapper itself is the thing tried:
// a team's DSH answers 403 `personal_only` on those routes (the new-chat card of the Home computer reads `/kybernos-cloud/kyber` and goes quiet on a
// refusal), the personal DSH answers as before, the phone link's seam is closed in a team's DSH, and everything else is served the same.
//
//   node kybernos-cloud/test-team-personal-only.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'kys-' + 'o'.repeat(43)
const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-personal-only-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:9' // nothing listens: the routes answer from the local state
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
delete process.env.KYBERNOS_TEAM_ID
delete process.env.KYBERNOS_PERSONAL_HOME
writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [{ id: 'w-personal', name: 'Personal', personal: true }, { id: 't1', name: 'Acme', personal: false }] }), { mode: 0o600 })

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = { get: (name) => (name === 'webServer' ? webServer : undefined), inject: (_l, cb) => cb(ctx), effect: (fn) => { fn() }, on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} } }
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000 }
mod.apply(ctx)

const server = http.createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://x').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { res.writeHead(500); res.end('{}') })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = { host: '127.0.0.1:' + port, origin: 'http://127.0.0.1:' + port }

const send = (method, path) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { ...own, ...(method === 'POST' ? { 'content-type': 'application/json', 'content-length': 2 } : {}) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', () => resolve({ status: 0, text: '' }))
  if (method === 'POST') req.write('{}')
  req.end()
})
const refused = (r) => r.status === 403 && r.text.includes('personal_only')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// Every route of the table that the rule names, read from the table itself: a new route under these prefixes is refused without anyone remembering to.
const named = [...routes.keys()].filter((path) => mod.ROUTES.some((r) => r.path === path))
const personalOnly = named.filter((path) => /^\/kybernos-cloud\/(?:kyber$|kyby\/|telegram\/|whatsapp\/|computer\/)/u.test(path))

try {
  console.log('Kybernos Cloud — what belongs to the account stays out of a team\'s DSH')
  assert.ok(personalOnly.length >= 15, 'the table holds the routes of Kaby, the doors and the Home computer (' + personalOnly.length + ')')

  // The personal DSH serves them as it always did (a route that needs a session or a server answers its own way: never `personal_only`).
  for (const path of personalOnly) {
    const route = mod.ROUTES.find((r) => r.path === path)
    const r = await send(route.method, path)
    assert.equal(refused(r), false, 'the personal DSH serves ' + path + ' (' + r.status + ' ' + r.text.slice(0, 80) + ')')
  }
  const phoneOpen = await globalThis[Symbol.for('kybernos.cloud')].call('/v1/remote/devices', { method: 'GET' })
  assert.notEqual(phoneOpen.error, 'personal_only', 'the personal DSH reaches the phone link')
  ok('the personal DSH serves all ' + personalOnly.length + ' routes of Kaby, the Telegram and WhatsApp doors and the Home computer, and the phone link\'s seam')

  process.env.KYBERNOS_TEAM_ID = 't1'
  for (const path of personalOnly) {
    const route = mod.ROUTES.find((r) => r.path === path)
    const r = await send(route.method, path)
    assert.equal(refused(r), true, 'a team DSH refuses ' + path + ' (' + r.status + ' ' + r.text.slice(0, 80) + ')')
  }
  ok('a team\'s DSH answers 403 personal_only on every one of them')

  assert.equal((await globalThis[Symbol.for('kybernos.cloud')].call('/v1/remote/devices', { method: 'GET' })).error, 'personal_only')
  assert.equal((await globalThis[Symbol.for('kybernos.cloud')].call('/v1/remote/pair', { method: 'POST', body: {} })).error, 'personal_only')
  ok('and its seam to the phone link is closed')

  // Everything else is served exactly as before: the status the page reads, the folders, the cloud computers of the agents, the team routes.
  for (const path of ['/kybernos-cloud/status', '/kybernos-cloud/computers', '/kybernos-cloud/team-dsh/list', '/kybernos-cloud/memory/list', '/kybernos-cloud/referral']) {
    const r = await send('GET', path)
    assert.equal(refused(r), false, path + ' is not the account\'s alone (' + r.status + ')')
    assert.equal(r.status === 403 || r.status === 404, false, path + ' still answers (' + r.status + ')')
  }
  ok('the status, the agents\' computers, the team routes and the memory are served in a team\'s DSH as before')

  delete process.env.KYBERNOS_TEAM_ID
  const back = await send('GET', '/kybernos-cloud/kyber')
  assert.equal(refused(back), false, 'nothing is remembered: the personal DSH is served again')
  ok('the rule follows the DSH, not the process: no team, no refusal')
  console.log('\n' + pass + ' checks passed')
} finally {
  server.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(0)
