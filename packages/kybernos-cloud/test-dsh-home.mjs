// ── The cloud half honours DSH_HOME, and never touches <HOME>/.dsh when it is set ─
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. This bundle used to hard-code
// <os home>/.dsh, so an isolated instance (DSH_HOME elsewhere) read the user's real
// device token, session list, kybers and renames, and wrote the pairing state and
// installed kybers into the real folder.
//
//   node kybernos-cloud/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
// DSH-HOME-HARNESS-BEGIN
import * as kbAssert from 'node:assert/strict'
import * as kbFs from 'node:fs'
import * as kbOs from 'node:os'
import * as kbPath from 'node:path'

/** Every file under `dir` as { 'rel/path': content } (a directory is a 'rel/dir/' key with null); {} when `dir` is absent. */
const snapshot = (dir) => {
  const out = {}
  const walk = (current) => {
    let entries = []
    try { entries = kbFs.readdirSync(current, { withFileTypes: true }) } catch (e) { return }
    for (const entry of entries) {
      const full = kbPath.join(current, entry.name)
      if (entry.isDirectory()) { out[kbPath.relative(dir, full) + '/'] = null; walk(full) } else out[kbPath.relative(dir, full)] = kbFs.readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

/** What differs between two snapshots, as readable lines ([] when identical). */
const diffSnapshots = (before, after) => {
  const lines = []
  for (const key of Object.keys(after)) {
    if (!(key in before)) lines.push('created ' + key)
    else if (before[key] !== after[key]) lines.push('changed ' + key)
  }
  for (const key of Object.keys(before)) if (!(key in after)) lines.push('removed ' + key)
  return lines.sort()
}

const makeIsolation = (label) => {
  const root = kbFs.mkdtempSync(kbPath.join(kbOs.tmpdir(), 'kybernos-dsh-home-' + label + '-'))
  const home = kbPath.join(root, 'home')
  const decoy = kbPath.join(home, '.dsh')
  const dshHome = kbPath.join(root, 'dsh')
  kbFs.mkdirSync(decoy, { recursive: true })
  kbFs.mkdirSync(dshHome, { recursive: true })
  const savedEnv = {}
  for (const key of ['HOME', 'USERPROFILE', 'DSH_HOME']) savedEnv[key] = process.env[key]
  let frozen = null

  const put = (base, rel, content) => {
    const file = kbPath.join(base, rel)
    kbFs.mkdirSync(kbPath.dirname(file), { recursive: true })
    kbFs.writeFileSync(file, content)
    return file
  }

  const iso = {
    root, home, decoy, dshHome,
    /** Seed a canary under <home>/.dsh. Call before `freezeDecoy()`. */
    seedDecoy: (rel, content) => put(decoy, rel, content),
    /** Seed what the bundle should find under $DSH_HOME. */
    seedDshHome: (rel, content) => put(dshHome, rel, content),
    /** The OS home is `home` and $DSH_HOME is set: the scene of the bug. */
    useDshHome: () => {
      process.env.HOME = home
      process.env.USERPROFILE = home
      process.env.DSH_HOME = dshHome
    },
    /** The OS home is `home` and $DSH_HOME is unset: the default, <home>/.dsh, must still work. */
    useDefaultHome: () => {
      process.env.HOME = home
      process.env.USERPROFILE = home
      delete process.env.DSH_HOME
    },
    /** Remember the decoy's exact content; every later change is a leak. */
    freezeDecoy: () => { frozen = snapshot(decoy) },
    decoyChanges: () => diffSnapshots(frozen === null ? {} : frozen, snapshot(decoy)),
    assertDecoyUntouched: (what = 'nothing') => {
      kbAssert.ok(frozen !== null, 'freezeDecoy() was not called')
      kbAssert.deepEqual(iso.decoyChanges(), [], what + ' must touch <HOME>/.dsh while DSH_HOME is set')
    },
    cleanup: () => {
      for (const key of Object.keys(savedEnv)) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key] }
      try { kbFs.rmSync(root, { recursive: true, force: true }) } catch (e) { /* the OS cleans tmp */ }
    },
  }
  return iso
}
// DSH-HOME-HARNESS-END

const TOKEN = 'kys-' + 'd'.repeat(43)
const SESSION = 'session-' + '1'.repeat(16)
const DECOY_SESSION = 'session-' + '9'.repeat(16)

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// A fake Kybernos API: the marketplace catalogue, and the session directory push (recorded).
const pushed = []
const api = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'invalid session' })
    if (req.url === '/v1/marketplace' && req.method === 'GET') {
      return send(200, { items: [{
        id: '9f0c1e3a-0000-4000-8000-000000000001', slug: 'support-concierge', name: 'Support Concierge',
        cat: 'Support', pitch: 'The support desk.', glyph: 'SC', color: '#2E86AB', version: 2, unlisted: false, published_at: '2026-09-01T10:00:00Z',
        manifest: { name: 'Support Concierge', cat: 'Support', glyph: 'SC', color: '#2E86AB', version: 2, agents: [{ role_key: 'custom:manager', name: 'Manager', does: 'Triage.', model_route: 'kybernos/doer', tools: [] }] },
      }] })
    }
    if (req.url === '/v1/dsh/sessions' && req.method === 'POST') {
      pushed.push(JSON.parse(raw))
      return send(200, { pushed: 1 })
    }
    return send(404, { error: 'not found' })
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
// The two test-only overrides stay UNSET: the point is the default location.
delete process.env.KYBERNOS_CLOUD_STATE
delete process.env.KYBERNOS_CLOUD_KYBERS

const iso = makeIsolation('cloud')

const connectedState = (email) => JSON.stringify({
  token: TOKEN, user: { id: 'u-1', email, name: null, plan: 'free' },
  workspaces: [{ id: 'ws-1', name: 'One' }, { id: 'ws-2', name: 'Two' }], active_workspace_id: 'ws-1',
})
const seedScene = (seed) => {
  seed('kybernos-cloud.json', connectedState(seed === iso.seedDecoy ? 'decoy@example.test' : 'real@example.test'))
  const id = seed === iso.seedDecoy ? DECOY_SESSION : SESSION
  seed('sessions/--proj-' + (seed === iso.seedDecoy ? 'decoy' : 'real') + '--/' + id + '/session.v4.jsonl.zstd', zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', data: { source: { kind: 'user' }, content: 'hello from ' + (seed === iso.seedDecoy ? 'decoy' : 'real') } }) + '\n')))
  seed('kybernos/categories.json', JSON.stringify({ [id]: { titre: seed === iso.seedDecoy ? 'Decoy title' : 'Real title' } }))
  seed('kybers/' + (seed === iso.seedDecoy ? 'decoy-kyber' : 'real-kyber') + '/memory/lessons.jsonl', JSON.stringify({ ts: '2026-09-20T10:00:00Z', text: 'a lesson' }) + '\n')
}

const routes = new Map()
const services = {
  webServer: { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } },
  systemPrompt: { context: () => {} },
  tools: { register: () => () => {} },
}
const ctx = {
  get: (name) => services[name],
  inject: (_list, cb) => cb(ctx),
  effect: (fn) => { fn() },
  on: () => {},
  ...services,
}
const hit = async (path, method, body) => {
  const handler = routes.get(path.split('?')[0])
  assert.ok(handler !== undefined, 'missing route: ' + path)
  const res = { status: 0, body: null, setHeader() {}, writeHead(s) { this.status = s }, end(p) { this.body = p === undefined || p === '' ? null : JSON.parse(p) } }
  await handler({
    method, url: path, headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }, res)
  return res
}

try {
  console.log('Kybernos Cloud — DSH_HOME')

  iso.useDshHome()
  const mod = await import('./index.js')
  mod.MEMORY_TUNING.writeRefreshMs = -1
  mod.MEMORY_TUNING.tickMs = 3600000
  mod.apply(ctx)

  // The resolver itself: blank means unset, a leading ~ is expanded, the value is trimmed.
  assert.equal(mod.dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(mod.dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(mod.dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // 1. DSH_HOME set, HOME elsewhere with a decoy full of canaries.
  seedScene(iso.seedDecoy)
  seedScene(iso.seedDshHome)
  iso.freezeDecoy()

  assert.equal(mod.stateFile(), join(iso.dshHome, 'kybernos-cloud.json'))
  const status = await hit('/kybernos-cloud/status', 'GET')
  assert.equal(status.body.state.user.email, 'real@example.test', 'the pairing state must come from DSH_HOME')
  ok('the device state is read from $DSH_HOME, not from the decoy')

  const picked = await hit('/kybernos-cloud/space/active', 'POST', { workspace_id: 'ws-2' })
  assert.equal(picked.body.ok, true)
  assert.equal(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos-cloud.json'), 'utf8')).active_workspace_id, 'ws-2')
  ok('the device state is written under $DSH_HOME')

  assert.deepEqual(mod.localKybers().sort(), ['real-kyber'])
  assert.equal(mod.localLessons('real-kyber').length, 1)
  assert.equal(mod.localLessons('decoy-kyber').length, 0)
  ok('local kybers and their lessons are read from $DSH_HOME/kybers')

  const push = await hit('/kybernos-cloud/chats/push', 'POST')
  assert.equal(push.body.ok, true, JSON.stringify(push.body))
  assert.equal(pushed.length, 1)
  assert.deepEqual(pushed[0].sessions.map((s) => [s.dsh_id, s.title]), [[SESSION, 'Real title']])
  assert.equal(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos-cloud.json'), 'utf8')).chats_last_push.scanned, 1)
  ok('the session directory comes from $DSH_HOME/sessions, with $DSH_HOME/kybernos/categories.json titles')

  const detail = await hit('/kybernos-cloud/chats/detail?dsh_id=' + SESSION, 'GET')
  assert.equal(detail.body.ok, true, JSON.stringify(detail.body))
  assert.equal(detail.body.title, 'Real title')
  assert.match(detail.body.messages[0].text, /hello from real/)
  const missing = await hit('/kybernos-cloud/chats/detail?dsh_id=' + DECOY_SESSION, 'GET')
  assert.equal(missing.body.ok, false, 'a session that only exists in the decoy must not be found')
  ok('a chat is read from $DSH_HOME/sessions only')

  const install = await hit('/kybernos-cloud/marketplace/install', 'POST', { slug: 'support-concierge' })
  assert.equal(install.body.ok, true, JSON.stringify(install.body))
  assert.equal(install.body.chemin, join(iso.dshHome, 'kybers', 'support-concierge', 'kyber.yml'))
  assert.equal(existsSync(install.body.chemin), true)
  ok('an installed kyber is written under $DSH_HOME/kybers')

  iso.assertDecoyUntouched('the cloud half')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // 2. DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  assert.equal(mod.stateFile(), join(iso.decoy, 'kybernos-cloud.json'))
  const dflt = await hit('/kybernos-cloud/status', 'GET')
  assert.equal(dflt.body.state.user.email, 'decoy@example.test')
  assert.deepEqual(mod.localKybers().sort(), ['decoy-kyber'])
  const picked2 = await hit('/kybernos-cloud/space/active', 'POST', { workspace_id: 'ws-2' })
  assert.equal(picked2.body.ok, true)
  assert.equal(JSON.parse(readFileSync(join(iso.decoy, 'kybernos-cloud.json'), 'utf8')).active_workspace_id, 'ws-2')
  const install2 = await hit('/kybernos-cloud/marketplace/install', 'POST', { slug: 'support-concierge' })
  assert.equal(install2.body.chemin, join(iso.decoy, 'kybers', 'support-concierge', 'kyber.yml'))
  ok('with DSH_HOME unset, state and kybers still live under <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  api.close()
  iso.cleanup()
}
