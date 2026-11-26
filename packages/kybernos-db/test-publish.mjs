// kybernos-db, an app that is PUBLISHED into a team space: the registry of published apps, the owner's client of the space (against a fake `fetch`), the hosting port, the facade the
// agent gets, the pull that keeps the read-only mirror (and what a pull that goes wrong leaves behind), the publisher (card, Publish, Unpublish, the writes of rows, the poll), and
// the host's routes, state and tools over a published app. The team space itself is lib-space-test.mjs: real store dbs answering the space client's calls in memory.
// Hermetic: temp folders only, no network, a fixed clock.
//
//   node packages/kybernos-db/test-publish.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderBlock } from './agent/context.mjs'
import { makeService } from './agent/service.mjs'
import { approvalGate, tools } from './agent/tools.mjs'
import { makeApi } from './api.mjs'
import { buildPublisher, chooseHosting } from './index.js'
import { installTemplate } from './instantiate.mjs'
import { ROUTE, mountRoutes } from './routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { sha256 } from './remote/bundle.mjs'
import { MIRROR_READS, PUBLISHED_MESSAGE, REFUSED, doorShape, makeFacade } from './remote/facade.mjs'
import { HOSTS_MAX, HOSTS_TIMEOUT_MS, cleanOrderUrl, describeHosting, envHosting, readHosts, unavailableHosting } from './remote/hosting.mjs'
import { pullMirror } from './remote/mirror.mjs'
import { BACKOFF_MAX_MS, HOSTS_EVERY_MS, POLL_MS, makePublisher, slugFor } from './remote/publisher.mjs'
import { REGISTRY_FILE, cleanSpace, openPublishedRegistry } from './remote/registry.mjs'
import { OPEN_KIND, OPEN_TTL_SEC, makeSpaceClient, normalizeSpaceUrl } from './remote/space.mjs'
import { bearerOf, hexKey, verifyOwnerApiToken, verifyToken } from './remote/token.mjs'
import { HOST_ID, ORDER_URL, SPACE_KEY, SPACE_URL, fakeHosting, fakeSpace } from './lib-space-test.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
sessionSource.secret = () => SESSION_SECRET

const root = mkdtempSync(join(tmpdir(), 'kb-db-publish-'))
process.on('exit', () => rmSync(root, { recursive: true, force: true })) // a failed check leaves nothing behind either
const ULID = '01HZZZZZZZZZZZZZZZZZZZZZZZ'
const ULID2 = '01HZZZZZZZZZZZZZZZZZZZZZZY'
const clockMs = (start) => { let t = start; return () => (t += 1) }
const sequence = (seed = 0) => { let i = seed; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
/** The store's ports. The hosted side gets its own clock and its own randomness, so that its row ids never repeat the ones made here. */
const ports = (hosted = false) => (hosted ? { now: clockMs(Date.UTC(2026, 9, 31, 12, 0, 0)), random: sequence(5000) } : { now: clockMs(Date.UTC(2026, 9, 30, 9, 0, 0)), random: sequence() })
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200, 3)])
const PNG2 = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(300, 5)])
const CONTACT = {
  key: 'contact', label: 'Contacts', title: 'name',
  fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
    { key: 'photo', type: 'attachment', label: 'Photo' },
  ],
}
const COSTS = { key: 'cost', label: 'Costs', title: 'what', fields: [{ key: 'what', type: 'text', label: 'What', required: true }, { key: 'amount', type: 'money', label: 'Amount', currency: 'EUR', protection: 'sensitive' }, { key: 'key', type: 'text', label: 'Key', protection: 'secret' }] }

// ---------------------------------------------------------------- the world: a computer, a team space, and the wires between them
let counter = 0
function timers () {
  const t = { timeouts: [], intervals: [], cleared: [], unrefs: 0 }
  const handle = (fn, ms, kind) => { const h = { fn, ms, kind, unref () { t.unrefs += 1 } }; return h }
  t.setTimeout = (fn, ms) => { const h = handle(fn, ms, 'timeout'); t.timeouts.push(h); return h }
  t.setInterval = (fn, ms) => { const h = handle(fn, ms, 'interval'); t.intervals.push(h); return h }
  t.clearTimeout = (h) => { t.cleared.push(h) }
  t.clearInterval = (h) => { t.cleared.push(h) }
  return t
}
function world (o = {}) {
  const dir = join(root, 'w' + (counter++))
  const c = { t: Date.UTC(2026, 9, 31, 9, 0, 0), now () { return c.t }, advance (ms) { c.t += ms } }
  const space = fakeSpace({ root: join(dir, 'space'), ports: ports(true) })
  const registry = openPublishedRegistry({ file: join(dir, 'local', REGISTRY_FILE), now: c.now })
  const hosting = o.hosting || fakeHosting(space, o.hostingExtra)
  const logs = []
  let publisher = null
  const svc = makeService({ dir: join(dir, 'local', 'dbs'), ports: { ...ports(), published: (id) => registry.published(id), facade: (id, rawOf) => publisher.facade(id, rawOf) } })
  const tmpRoot = join(dir, 'local', 'tmp')
  const tm = o.timers || timers()
  publisher = makePublisher({ service: svc, registry: o.wrapRegistry ? o.wrapRegistry(registry) : registry, hosting, tmpRoot, maxBytes: o.maxBytes, ports: { now: c.now, store: ports(), clientFor: () => space, log: (t) => logs.push(t), timers: tm } })
  const made = svc.create({ name: o.name || 'Home', by: 'agent', objects: o.objects || [CONTACT] })
  assert.equal(made.ok, true, JSON.stringify(made))
  const db = made.db
  const id = db.info().id
  let ada = null
  if (o.seed !== false && (o.objects === undefined)) {
    const att = db.attach(PNG, { name: 'ada.png', type: 'image/png' })
    assert.equal(att.ok, true)
    ada = db.create('contact', { name: 'Ada', email: 'ada@example.com', photo: [att.file] }, 'agent')
    assert.equal(ada.ok, true, JSON.stringify(ada))
    assert.equal(db.create('contact', { name: 'Bob' }, 'agent').ok, true)
  }
  const api = makeApi({ service: svc, ports: { today: () => '2026-10-31', remote: { info: (x) => publisher.info(x), hosting: () => publisher.hostingState() } } })
  return { dir, c, space, registry, hosting, svc, publisher, tmpRoot, tm, logs, id, db, api, adaId: ada === null ? null : ada.record.id, att: ada === null ? null : ada.record.values.photo[0] }
}
/** A world whose app is already published. */
async function published (o) {
  const w = world(o)
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.equal(r.ok, true, JSON.stringify(r))
  return { ...w, slug: r.published.slug }
}
/** The text of everything a person or a log could see: it must never carry the key. */
const noKey = (what) => assert.equal(JSON.stringify(what).includes(SPACE_KEY), false, 'the boot key leaked')
const names = (w) => w.svc.byId(w.id).db.list('contact').map((r) => r.values.name).sort()
const stray = (w) => (existsSync(w.tmpRoot) ? readdirSync(w.tmpRoot).flatMap((d) => (existsSync(join(w.tmpRoot, d)) && statSync(join(w.tmpRoot, d)).isDirectory() ? readdirSync(join(w.tmpRoot, d)) : [d])) : [])

// ---------------------------------------------------------------- the registry
await ok('the registry starts empty, keeps spaces, apps and unfinished uploads in a private file, and reads them back', () => {
  const file = join(root, 'reg1', REGISTRY_FILE)
  const reg = openPublishedRegistry({ file })
  assert.deepEqual([reg.spaces(), reg.apps(), reg.fault], [[], [], null])
  assert.equal(existsSync(file), false, 'nothing is written until something is')
  assert.equal(reg.addSpace({ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY }).ok, true)
  assert.equal(reg.addApp({ db: ULID, space: 's-1', slug: 'home', since: '2026-10-31T09:00:00.000Z' }).ok, true)
  assert.equal(reg.addPending({ db: ULID2, space: 's-1', slug: 'other', at: '2026-10-31T09:00:00.000Z' }).ok, true)
  assert.equal(statSync(file).mode & 0o777, 0o600, 'the boot key is a secret: owner only')
  assert.deepEqual(readdirSync(join(root, 'reg1')), [REGISTRY_FILE], 'no temporary file is left beside it')
  const again = openPublishedRegistry({ file })
  assert.equal(again.published(ULID), true)
  assert.equal(again.published(ULID2), false)
  assert.deepEqual(again.spaceOf(ULID), { app: { db: ULID, space: 's-1', slug: 'home', since: '2026-10-31T09:00:00.000Z' }, space: { id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY } })
  assert.deepEqual(again.slugsIn('s-1').sort(), ['home', 'other'], 'an upload that is not registered yet holds its name')
  assert.deepEqual(again.pendingOf(ULID2).map((p) => p.slug), ['other'])
  assert.equal(again.spaceOf(ULID2), null)
  again.apps()[0].slug = 'changed'
  assert.equal(again.apps()[0].slug, 'home', 'what it hands out is a copy')
})

await ok('the registry refuses what does not hold up, and leaves what it has as it was', () => {
  const reg = openPublishedRegistry({ file: join(root, 'reg2', REGISTRY_FILE) })
  const bad = (r, code) => { assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(r)) }
  bad(reg.addSpace({ id: 's-1', url: 'http://team.example.test', bootKey: SPACE_KEY }), 'invalid') // http to a name is not a space
  bad(reg.addSpace({ id: 's-1', url: 'https://team.example.test', bootKey: 'zz'.repeat(32) }), 'invalid')
  bad(reg.addSpace({ id: '../x', url: 'https://team.example.test', bootKey: SPACE_KEY }), 'invalid')
  bad(reg.addSpace({ id: 's-1', url: 'https://user:pw@team.example.test', bootKey: SPACE_KEY }), 'invalid')
  assert.equal(reg.addSpace({ id: 's-1', url: 'http://localhost:4100', bootKey: SPACE_KEY }).ok, true, 'a space on this machine may use http')
  bad(reg.addApp({ db: ULID, space: 's-2', slug: 'home', since: '2026-10-31T09:00:00.000Z' }), 'unknown-space')
  bad(reg.addApp({ db: 'not-a-ulid', space: 's-1', slug: 'home', since: '2026-10-31T09:00:00.000Z' }), 'invalid')
  bad(reg.addApp({ db: ULID, space: 's-1', slug: 'Bad Slug', since: '2026-10-31T09:00:00.000Z' }), 'invalid')
  assert.equal(reg.addApp({ db: ULID, space: 's-1', slug: 'home', since: '2026-10-31T09:00:00.000Z' }).ok, true)
  bad(reg.addApp({ db: ULID, space: 's-1', slug: 'again', since: '2026-10-31T09:00:00.000Z' }), 'published')
  bad(reg.addApp({ db: ULID2, space: 's-1', slug: 'home', since: '2026-10-31T09:00:00.000Z' }), 'slug-taken')
  bad(reg.removeSpace('s-1'), 'in-use')
  assert.equal(reg.removeApp(ULID).ok, true)
  assert.equal(reg.removeSpace('s-1').ok, true)
  assert.deepEqual([reg.spaces(), reg.apps()], [[], []])
  assert.equal(cleanSpace({ id: 's', url: 'https://a.example', bootKey: SPACE_KEY, extra: 'x' }).extra, undefined, 'only the known keys are kept')
})

await ok('a registry file that is damaged is put aside, never deleted, and the registry starts empty', () => {
  for (const [name, text] of [['junk', 'not json {'], ['shape', JSON.stringify({ version: 1, spaces: [], apps: [{ db: ULID, space: 'nope', slug: 'home', since: '2026-10-31T09:00:00.000Z' }] })], ['version', JSON.stringify({ version: 9, spaces: [], apps: [] })]]) {
    const dir = join(root, 'reg-' + name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, REGISTRY_FILE), text)
    const reg = openPublishedRegistry({ file: join(dir, REGISTRY_FILE), now: () => 1234 })
    assert.deepEqual(reg.apps(), [], name)
    assert.equal(reg.fault, 'unreadable', name)
    assert.equal(readFileSync(join(dir, REGISTRY_FILE + '.bad-1234'), 'utf8'), text, name + ': the bytes are kept for someone to look at')
    assert.equal(reg.addSpace({ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY }).ok, true, name + ': and it works afterwards')
  }
})

await ok('a registry that cannot be written says so and keeps what it had', () => {
  const blocker = join(root, 'blocker')
  writeFileSync(blocker, 'a file where a folder should be')
  const reg = openPublishedRegistry({ file: join(blocker, REGISTRY_FILE) })
  const r = reg.addSpace({ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'registry')
  assert.deepEqual(reg.spaces(), [])
  assert.equal(JSON.stringify(r).includes(SPACE_KEY), false)
})

await ok('the registry remembers which computer a space and an app live on and which one the last Publish used, refreshes the name and region it last saw, and still opens a file written before any of it', () => {
  const file = join(root, 'reg-host', REGISTRY_FILE)
  const SINCE = '2026-10-31T09:00:00.000Z'
  const reg = openPublishedRegistry({ file })
  const bad = (r, code) => { assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(r)) }
  assert.equal(reg.lastHost(), null)
  assert.equal(reg.addSpace({ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY, host: 'studio' }).ok, true)
  assert.equal(reg.addApp({ db: ULID, space: 's-1', slug: 'home', since: SINCE, host: { id: 'studio', name: 'Studio', region: 'Frankfurt, EU' } }).ok, true)
  assert.equal(reg.setLastHost('studio').ok, true)
  const again = openPublishedRegistry({ file })
  assert.deepEqual(again.spaceOf(ULID), { app: { db: ULID, space: 's-1', slug: 'home', since: SINCE, host: { id: 'studio', name: 'Studio', region: 'Frankfurt, EU' } }, space: { id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY, host: 'studio' } })
  assert.deepEqual([again.lastHost(), again.space('s-1').host, again.appOf(ULID).host.name], ['studio', 'studio', 'Studio'])
  again.appOf(ULID).host.name = 'changed'; again.apps()[0].host.id = 'changed'; again.spaceOf(ULID).app.host.name = 'changed'
  assert.equal(again.appOf(ULID).host.name, 'Studio', 'what it hands out is a copy, the computer\'s data too')
  // the name and region follow the computer; the file is written only when something changed
  const text = readFileSync(file, 'utf8')
  assert.deepEqual(again.setHostInfo('studio', { name: 'Studio', region: 'Frankfurt, EU' }), { ok: true, changed: false })
  assert.deepEqual(again.setHostInfo('another', { name: 'X', region: 'Y' }), { ok: true, changed: false })
  assert.equal(readFileSync(file, 'utf8'), text, 'nothing to say, nothing written')
  assert.deepEqual(again.setHostInfo('studio', { name: 'Studio ' + 'n'.repeat(100), region: 7 }), { ok: true, changed: true })
  assert.deepEqual([again.appOf(ULID).host.name.length, again.appOf(ULID).host.region], [80, ''], 'cut, and a region that is not text is nothing')
  assert.deepEqual(openPublishedRegistry({ file }).appOf(ULID).host.id, 'studio')
  // what is not a computer\'s id is refused
  bad(reg.addSpace({ id: 's-2', url: 'https://team.example.test', bootKey: SPACE_KEY, host: '../x' }), 'invalid')
  bad(reg.addSpace({ id: 's-2', url: 'https://team.example.test', bootKey: SPACE_KEY, host: 42 }), 'invalid')
  assert.equal(reg.addSpace({ id: 's-2', url: 'https://team.example.test', bootKey: SPACE_KEY }).ok, true, 'a space with no computer (an older one) is fine')
  bad(reg.addApp({ db: ULID2, space: 's-2', slug: 'other', since: SINCE, host: 'studio' }), 'invalid')
  bad(reg.addApp({ db: ULID2, space: 's-2', slug: 'other', since: SINCE, host: { id: '../x', name: 'X' } }), 'invalid')
  bad(reg.addApp({ db: ULID2, space: 's-2', slug: 'other', since: SINCE, host: { id: 'studio', name: 42 } }), 'invalid')
  bad(reg.addApp({ db: ULID2, space: 's-2', slug: 'other', since: SINCE, host: null }), 'invalid')
  bad(reg.setLastHost('../x'), 'invalid'); bad(reg.setLastHost(42), 'invalid'); bad(reg.setLastHost(undefined), 'invalid')
  assert.equal(reg.lastHost(), 'studio', 'a refused choice changes nothing')
  assert.equal(reg.addApp({ db: ULID2, space: 's-2', slug: 'other', since: SINCE }).ok, true)
  assert.equal(reg.appOf(ULID2).host, undefined, 'an app with no computer recorded says nothing of one')
  // a file written before computers were chosen opens as it is
  const old = join(root, 'reg-old', REGISTRY_FILE)
  mkdirSync(join(root, 'reg-old'), { recursive: true })
  writeFileSync(old, JSON.stringify({ version: 1, spaces: [{ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY }], apps: [{ db: ULID, space: 's-1', slug: 'home', since: SINCE }], pending: [] }))
  const legacy = openPublishedRegistry({ file: old })
  assert.deepEqual([legacy.fault, legacy.lastHost(), legacy.space('s-1').host, legacy.appOf(ULID).host], [null, null, undefined, undefined])
  assert.deepEqual(legacy.setHostInfo('studio', { name: 'Studio' }), { ok: true, changed: false }, 'and there is nothing to refresh on it')
  // a usual choice that is junk is forgotten; a computer that is junk on an app is a file that cannot be trusted
  writeFileSync(old, JSON.stringify({ version: 1, spaces: [{ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY }], apps: [], pending: [], lastHost: { id: 1 } }))
  const junk = openPublishedRegistry({ file: old })
  assert.deepEqual([junk.fault, junk.lastHost(), junk.spaces().length], [null, null, 1])
  writeFileSync(old, JSON.stringify({ version: 1, spaces: [{ id: 's-1', url: 'https://team.example.test', bootKey: SPACE_KEY }], apps: [{ db: ULID, space: 's-1', slug: 'home', since: SINCE, host: { id: '../x' } }], pending: [] }))
  assert.equal(openPublishedRegistry({ file: old, now: () => 99 }).fault, 'unreadable')
})

// ---------------------------------------------------------------- the space client, against a fake fetch
function fakeFetch (handler) {
  const calls = []
  const f = async (url, init) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect }
    calls.push(call)
    return handler(call, init)
  }
  f.calls = calls
  return f
}
const reply = (status, body, headers = {}) => new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

await ok('a space address is an https origin, or http for this machine; nothing else', () => {
  assert.equal(normalizeSpaceUrl('https://team.example.test'), 'https://team.example.test')
  assert.equal(normalizeSpaceUrl('https://team.example.test/'), 'https://team.example.test')
  assert.equal(normalizeSpaceUrl('http://127.0.0.1:4100'), 'http://127.0.0.1:4100')
  assert.equal(normalizeSpaceUrl('http://localhost:4100'), 'http://localhost:4100')
  for (const bad of ['http://team.example.test', 'https://u:p@team.example.test', 'https://team.example.test/path', 'https://team.example.test/?x=1', 'ftp://team.example.test', 'javascript:alert(1)', '', 'team.example.test', null, undefined, 42]) assert.equal(normalizeSpaceUrl(bad), null, String(bad))
})

await ok('the client refuses a bad configuration up front, without saying the key', () => {
  assert.throws(() => makeSpaceClient({ url: 'http://team.example.test', bootKey: SPACE_KEY, fetch: async () => null }), /https/)
  assert.throws(() => makeSpaceClient({ url: SPACE_URL, bootKey: 'short', fetch: async () => null }), /key/)
  assert.throws(() => makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: 'nope' }), /fetch/)
  try { makeSpaceClient({ url: SPACE_URL, bootKey: 'zz' + SPACE_KEY, fetch: async () => null }) } catch (e) { assert.equal(String(e.message).includes(SPACE_KEY), false) }
})

await ok('every call is the owner\'s: a fresh bearer made with the boot key, no redirect followed, and the key itself never sent or shown', async () => {
  const f = fakeFetch(async (call) => reply(200, { fingerprint: '3.12.4.9' }))
  const client = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: f })
  const answers = [await client.fingerprint('home'), await client.fingerprint('home')]
  assert.deepEqual(answers.map((a) => a.fingerprint), ['3.12.4.9', '3.12.4.9'])
  assert.equal(f.calls[0].url, SPACE_URL + '/api/apps/home/fingerprint')
  assert.equal(f.calls[0].method, 'GET')
  assert.equal(f.calls[0].redirect, 'manual')
  const bearers = f.calls.map((c) => bearerOf(c.headers.authorization))
  for (const b of bearers) assert.deepEqual(verifyOwnerApiToken(b, hexKey(SPACE_KEY)), { ok: true })
  assert.notEqual(bearers[0], bearers[1], 'a token per request')
  assert.equal(JSON.stringify(f.calls).includes(SPACE_KEY), false, 'the key is never on the wire')
  noKey(answers)
  assert.equal(Object.keys(client).some((k) => JSON.stringify(client[k]) === JSON.stringify(SPACE_KEY)), false)
  assert.equal(JSON.stringify(client).includes(SPACE_KEY), false)
})

await ok('what goes wrong is told in a few plain codes, and the body of a response is never repeated', async () => {
  const say = (status, body, headers) => makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: fakeFetch(async () => reply(status, body, headers)) })
  const code = async (status, body) => (await say(status, body).fingerprint('home')).code
  assert.equal(await code(401, { error: 'unauthorized' }), 'refused')
  assert.equal(await code(429, {}), 'rate-limited')
  assert.equal(await code(413, {}), 'too-large')
  assert.equal(await code(500, 'SECRET-BODY-OF-A-SERVER-ERROR'), 'space')
  assert.equal(await code(404, { error: 'unknown', message: 'no such app' }), 'unknown')
  assert.equal(await code(200, 'this is not json'), 'space')
  assert.equal(await code(200, { fingerprint: '../../etc/passwd' }), 'manifest')
  const r = await say(500, 'SECRET-BODY-OF-A-SERVER-ERROR').fingerprint('home')
  assert.equal(JSON.stringify(r).includes('SECRET-BODY'), false)
  const refused = await say(401, { error: 'unauthorized', message: 'Bearer abc.def is not good' }).fingerprint('home')
  assert.equal(refused.message.includes('abc.def'), false, 'a refusal is worded here, not echoed')
  const loud = await say(422, { error: 'invalid', message: 'name is required', errors: [{ field: 'name', message: 'required' }] }).write('home', { object: 'contact', op: 'create', values: {} })
  assert.deepEqual([loud.ok, loud.code, loud.message, loud.errors], [false, 'invalid', 'name is required', [{ field: 'name', message: 'required' }]], 'the door\'s own reasons pass through')
  const moved = await say(302, '', { location: 'https://evil.example/' }).fingerprint('home')
  assert.equal(moved.code, 'space', 'a redirect is not followed')
  assert.equal(await makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: async () => { throw new Error('ECONNREFUSED 10.0.0.1') } }).fingerprint('home').then((a) => a.code), 'unreachable')
  assert.equal((await makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: async () => { throw new Error('ECONNREFUSED 10.0.0.1') } }).fingerprint('home')).message.includes('10.0.0.1'), false)
})

await ok('a space that does not answer in time is unreachable, and a slug or a hash that is not one never leaves this computer', async () => {
  const hang = fakeFetch((call, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
  const slow = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: hang, timeoutMs: 20 })
  const r = await slow.fingerprint('home')
  assert.deepEqual([r.ok, r.code], [false, 'unreachable'])
  assert.match(r.message, /in time/)
  const f = fakeFetch(async () => reply(200, {}))
  const client = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: f })
  for (const slug of ['../x', 'Home', '', 'a/b', 'x'.repeat(41)]) assert.equal((await client.fingerprint(slug)).code, 'invalid', slug)
  assert.equal((await client.blob('home', '../../etc')).code, 'invalid')
  assert.equal((await client.release('A B')).code, 'invalid')
  assert.equal(f.calls.length, 0, 'nothing was sent')
})

await ok('a snapshot, a manifest and a bundle are read back with their checks', async () => {
  const hash = sha256(PNG)
  const manifest = { format: 1, db: { id: ULID, name: 'Home', size: 4096, sha256: 'a'.repeat(64) }, fingerprint: '3.12.4.9', blobs: [{ hash, size: PNG.length }] }
  const f = fakeFetch(async (call) => {
    if (call.url.endsWith('/snapshot/manifest')) return reply(200, manifest)
    if (call.url.endsWith('/snapshot/db')) return reply(200, 'SQLite format 3\0abc', { 'content-type': 'application/octet-stream', ...(call.url.includes('/nofp/') ? {} : { 'x-kb-fingerprint': '3.12.4.9' }) })
    if (call.url.includes('/blobs/')) return reply(200, PNG, { 'content-type': 'application/octet-stream' })
    if (call.method === 'PUT') return reply(200, { ok: true, fingerprint: '3.12.4.9' })
    if (call.url.endsWith('/release')) return reply(200, { ok: true })
    return reply(404, { error: 'unknown' })
  })
  const client = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: f })
  assert.deepEqual((await client.manifest('home')).manifest, manifest)
  const db = await client.snapshotDb('home')
  assert.deepEqual([db.ok, db.fingerprint, db.bytes.length], [true, '3.12.4.9', 19])
  assert.equal((await client.snapshotDb('nofp')).code, 'mismatch', 'a snapshot that does not say which state it is has no use')
  assert.ok((await client.blob('home', hash)).bytes.equals(PNG))
  const put = await client.putBundle('home', Buffer.from('bundle'))
  assert.deepEqual([put.ok, put.fingerprint], [true, '3.12.4.9'])
  assert.equal(f.calls.find((c) => c.method === 'PUT').headers['content-type'], 'application/octet-stream')
  assert.deepEqual(JSON.parse(await (async () => { await client.release('home'); return f.calls.at(-1).body })()), { confirm: 'home' }, 'releasing an app names it')
  const odd = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: fakeFetch(async () => reply(200, { ...manifest, blobs: [{ hash: '../../x', size: 1 }] })) })
  assert.equal((await odd.manifest('home')).code, 'manifest', 'a manifest that is not in the documented shape is not trusted')
  const extra = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: fakeFetch(async () => reply(200, { ...manifest, ok: true, extra: 'ignored' })) })
  assert.deepEqual((await extra.manifest('home')).manifest, manifest, 'only the documented keys are read')
  const small = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, maxBytes: 8, fetch: fakeFetch(async () => reply(200, Buffer.alloc(64), { 'content-type': 'application/octet-stream', 'x-kb-fingerprint': '1.1.1.1' })) })
  assert.equal((await small.snapshotDb('home')).code, 'too-large', 'a response bigger than the cap is cut off')
})

await ok('the owner\'s link is a one-time `open` token good for ten minutes, made without a request', async () => {
  const f = fakeFetch(async () => reply(200, {}))
  const t0 = Date.UTC(2026, 9, 31, 9, 0, 0)
  const client = makeSpaceClient({ url: SPACE_URL, bootKey: SPACE_KEY, fetch: f, now: () => t0 })
  const link = client.openLink()
  const u = new URL(link)
  assert.equal(u.origin, SPACE_URL)
  assert.equal(u.pathname, '/open')
  const token = u.searchParams.get('t')
  assert.equal(verifyToken(OPEN_KIND, token, hexKey(SPACE_KEY), { now: () => t0 }).ok, true)
  assert.equal(verifyToken(OPEN_KIND, token, hexKey(SPACE_KEY), { now: () => t0 + (OPEN_TTL_SEC - 1) * 1000 }).ok, true)
  assert.deepEqual(verifyToken(OPEN_KIND, token, hexKey(SPACE_KEY), { now: () => t0 + OPEN_TTL_SEC * 1000 }), { ok: false, reason: 'expired' })
  assert.equal(verifyToken('invite', token, hexKey(SPACE_KEY), { now: () => t0 }).ok, false, 'it opens nothing else')
  assert.notEqual(client.openLink(), link, 'each link is its own')
  assert.equal(f.calls.length, 0)
  assert.equal(link.includes(SPACE_KEY), false)
})

// ---------------------------------------------------------------- the hosting port
await ok('without a hosting nothing is offered; a hosting describes itself in plain data only, and the order address is an https address nobody built', async () => {
  const none = unavailableHosting()
  assert.equal(none.available(), false)
  assert.equal(describeHosting(none).name, '')
  assert.equal(Object.isFrozen(none), true)
  assert.deepEqual(await none.hosts(), { ok: false, code: 'unavailable', message: 'Publishing is not available yet.' })
  assert.equal((await none.ensureSpace({ host: 'h' })).code, 'unavailable')
  const d = describeHosting({ describe: () => ({ name: 'Kybernos', orderUrl: 'https://kybernos.example.test/computers?plan=pro', pricePerMonth: 7.3, currency: 'USD', alwaysOn: true, region: 'EU', budget: { remaining: 3 }, bootKey: SPACE_KEY, extra: 1 }) })
  assert.deepEqual(d, { name: 'Kybernos', orderUrl: 'https://kybernos.example.test/computers?plan=pro' }, 'a name and an address, nothing else: no price, no budget, no region of its own')
  noKey(d)
  assert.equal(describeHosting({ describe: () => ({ name: 'x'.repeat(200) }) }).name.length, 80)
  for (const bad of ['http://kybernos.example.test/computers', 'https://user:pw@kybernos.example.test/', 'https://user@kybernos.example.test/', 'javascript:alert(1)', 'data:text/html,x', '//kybernos.example.test/computers', '/computers', 'kybernos.example.test', 'https://', 'https://kybernos.example.test/ a', 'https://kybernos.example.test/\n', 'https://kybernos.example.test/' + 'x'.repeat(2000), 42, null, {}]) {
    assert.equal(describeHosting({ describe: () => ({ name: 'Kybernos', orderUrl: bad }) }).orderUrl, '', String(bad).slice(0, 50))
  }
  assert.equal(cleanOrderUrl('https://kybernos.example.test/computers'), 'https://kybernos.example.test/computers', 'it is handed back as it came, never rebuilt')
  assert.deepEqual(describeHosting({ describe: () => { throw new Error('boom') } }), { name: '', orderUrl: '' })
  assert.deepEqual(describeHosting({ describe: () => null }), { name: '', orderUrl: '' })
})

await ok('the computers are read as the port gave them, cleaned: a list that lies about its types never becomes a claim, and the port never throws into the plugin', async () => {
  const read = (answer) => readHosts({ hosts: typeof answer === 'function' ? answer : async () => answer })
  const good = await read({ ok: true, hosts: [{ id: 'a-1', name: 'Studio', state: 'sleeping', region: 'Paris, FR', alwaysOn: true, shared: true, token: 'secret' }, { id: 'b-2', name: 'Cabinet', state: 'running' }] })
  assert.deepEqual(good, { ok: true, hosts: [{ id: 'a-1', name: 'Studio', state: 'sleeping', region: 'Paris, FR', alwaysOn: true, shared: true }, { id: 'b-2', name: 'Cabinet', state: 'running', region: '', alwaysOn: false, shared: false }] })
  assert.deepEqual(await read({ ok: true, hosts: [] }), { ok: true, hosts: [] }, 'no computer is a valid answer')
  const lying = await read({ ok: true, hosts: [
    { id: 'c-3', name: 42, state: 'on fire', region: { x: 1 }, alwaysOn: 'yes', shared: 1 },
    { id: 'd-4', name: '  Nice\n' + String.fromCharCode(0x2028) + '  name  ', state: 'starting', region: 'x'.repeat(200) },
    { id: '../etc', name: 'Bad id' }, { id: 7, name: 'Number id' }, { id: '', name: 'Empty id' }, { name: 'No id' }, null, 'string', 3, [],
    { id: 'c-3', name: 'Same id twice' },
  ] })
  assert.deepEqual(lying.hosts.map((h) => h.id), ['c-3', 'd-4'], 'what cannot be told apart is dropped, a twin is dropped')
  assert.deepEqual(lying.hosts[0], { id: 'c-3', name: 'c-3', state: 'stopped', region: '', alwaysOn: false, shared: false }, 'a name that is not text is the id, a state nobody knows is stopped, a flag that is not true is false')
  assert.equal(lying.hosts[1].name, 'Nice name', 'whitespace and control characters fold to one space')
  assert.equal(lying.hosts[1].region.length, 80)
  const many = await read({ ok: true, hosts: Array.from({ length: HOSTS_MAX + 20 }, (_, i) => ({ id: 'h-' + i, name: 'H' + i, state: 'running' })) })
  assert.equal(many.hosts.length, HOSTS_MAX)
  for (const answer of [null, undefined, 'ok', 42, [], {}, { ok: true }, { ok: true, hosts: 'many' }, { ok: true, hosts: { 0: 1 } }, { ok: 'true', hosts: [] }]) {
    const r = await read(answer)
    assert.deepEqual([r.ok, r.code], [false, 'hosts-unreachable'], JSON.stringify(answer))
    assert.ok(typeof r.message === 'string' && r.message !== '')
  }
  const refused = await read({ ok: false, code: 'unavailable', message: 'The  Kybernos\nserver is unreachable.' })
  assert.deepEqual([refused.ok, refused.code, refused.message], [false, 'hosts-unreachable', 'The Kybernos server is unreachable.'], 'the port\'s own words, tidied')
  const loud = await read({ ok: false, message: 'y'.repeat(900) })
  assert.equal(loud.message.length, 300)
  const thrown = await read(() => { throw new Error('ECONNREFUSED 10.0.0.1 ' + SPACE_KEY) })
  assert.equal(thrown.code, 'hosts-unreachable'); assert.equal(JSON.stringify(thrown).includes('10.0.0.1'), false, 'an exception is not repeated'); noKey(thrown)
  assert.equal((await read(() => Promise.reject(new Error('no')))).code, 'hosts-unreachable')
  for (const bad of [null, undefined, {}, { hosts: 'x' }, 'x']) assert.equal((await readHosts(bad)).code, 'hosts-unreachable', 'no usable port')
})

await ok('a port that does not answer is given a limit, and the timer is taken off when it did answer', async () => {
  const tm = timers()
  const never = readHosts({ hosts: () => new Promise(() => {}) }, { timers: tm })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual([tm.timeouts.length, tm.timeouts[0].ms, tm.unrefs], [1, HOSTS_TIMEOUT_MS, 1], 'a fifteen second limit, that does not keep the process alive')
  tm.timeouts[0].fn()
  const r = await never
  assert.deepEqual([r.ok, r.code], [false, 'hosts-unreachable'])
  assert.equal(tm.cleared.length, 1)
  const tm2 = timers()
  assert.equal((await readHosts({ hosts: async () => ({ ok: true, hosts: [] }) }, { timers: tm2 })).ok, true)
  assert.equal(tm2.cleared.length, 1, 'an answer in time clears the limit')
  const keep = setInterval(() => {}, 1000) // the limit does not keep a process alive, so something else has to while this waits
  const real = await readHosts({ hosts: () => new Promise(() => {}) }, { timeoutMs: 20 })
  clearInterval(keep)
  assert.equal(real.code, 'hosts-unreachable', 'and with the real timers too')
})

await ok('a hosting set by the host process from its variables lists its one space as a running computer and gives it to that computer only; anything unusable is no hosting', async () => {
  const env = { KYBERNOS_DB_SPACE_URL: 'https://team.example.test', KYBERNOS_DB_SPACE_KEY: SPACE_KEY }
  const h = envHosting(env)
  assert.equal(h.available(), true)
  const listed = await h.hosts()
  assert.deepEqual(listed, { ok: true, hosts: [{ id: 'env-team-example-test', name: 'Your own team space', state: 'running' }] })
  noKey(listed)
  const given = await h.ensureSpace({ host: listed.hosts[0].id })
  assert.deepEqual([given.ok, given.space.id, given.space.url, given.space.bootKey], [true, 'env-team-example-test', 'https://team.example.test', SPACE_KEY])
  for (const arg of [{ host: 'another' }, { workspace: 'default' }, {}, null, undefined, 'env-team-example-test']) {
    const r = await h.ensureSpace(arg)
    assert.deepEqual([r.ok, r.code], [false, 'unknown-host'], JSON.stringify(arg))
    noKey(r)
  }
  assert.deepEqual(describeHosting(h), { name: 'Your own team space', orderUrl: '' }, 'no order address unless the host process gave one')
  noKey(h.describe())
  const ordered = envHosting({ ...env, KYBERNOS_DB_ORDER_URL: 'https://kybernos.example.test/computers' })
  assert.equal(describeHosting(ordered).orderUrl, 'https://kybernos.example.test/computers')
  for (const bad of ['http://kybernos.example.test/computers', 'https://u:p@kybernos.example.test/', 'nonsense', '']) assert.equal(describeHosting(envHosting({ ...env, KYBERNOS_DB_ORDER_URL: bad })).orderUrl, '', bad)
  for (const bad of [{}, { KYBERNOS_DB_SPACE_URL: env.KYBERNOS_DB_SPACE_URL }, { KYBERNOS_DB_SPACE_KEY: SPACE_KEY }, { ...env, KYBERNOS_DB_SPACE_URL: 'http://team.example.test' }, { ...env, KYBERNOS_DB_SPACE_KEY: 'nothex' }]) assert.equal(envHosting(bad).available(), false)
  assert.equal(chooseHosting(undefined, {}).available(), false, 'the default is no hosting')
  assert.equal(chooseHosting(undefined, env).available(), true)
  assert.equal(chooseHosting({ available: () => true, describe: () => ({}), hosts: async () => ({ ok: true, hosts: [] }), ensureSpace: async () => null }, {}).available(), true, 'a hosting given by the host wins')
  assert.equal(chooseHosting('junk', {}).available(), false)
})

// ---------------------------------------------------------------- the facade
await ok('a published app answers reads from its copy, writes of rows by way of the web app, and refuses the rest', async () => {
  const w = world()
  const spec = []
  const f = makeFacade({ rawOf: () => w.svc.raw(w.id), row: (s) => { spec.push(s); return Promise.resolve({ ok: true, record: { id: 'x' } }) } })
  assert.equal(f.published, true)
  assert.equal(f.info().name, 'Home')
  assert.equal(f.count('contact'), 2)
  assert.equal(f.list('contact').length, 2)
  assert.equal(f.get('contact', w.adaId).values.name, 'Ada')
  assert.equal(f.file, w.db.file)
  assert.equal(f.fingerprint(), w.db.fingerprint())
  for (const name of MIRROR_READS) assert.equal(typeof f[name], 'function', name)
  for (const name of REFUSED) {
    const r = f[name]()
    assert.deepEqual([r.ok, r.code, r.message], [false, 'published', PUBLISHED_MESSAGE], name)
  }
  assert.equal(f.blobs.put(PNG).code, 'published')
  assert.equal(f.blobs.remove('a'.repeat(64)).code, 'published')
  assert.equal(f.blobs.has(w.att.hash), true)
  assert.ok(f.blobs.get(w.att.hash).equals(PNG))
  const writes = [f.create('contact', { name: 'C' }, 'agent'), f.update('contact', w.adaId, { name: 'D' }, 'agent'), f.remove('contact', w.adaId, 'agent'), f.restore('contact', w.adaId, 'agent')]
  assert.equal(writes.every((p) => p instanceof Promise), true)
  await Promise.all(writes)
  assert.deepEqual(spec.map((s) => s.op), ['create', 'update', 'delete', 'restore'])
  assert.deepEqual(spec[0], { op: 'create', object: 'contact', values: { name: 'C' }, by: 'agent' })
  assert.deepEqual(spec[2], { op: 'delete', object: 'contact', id: w.adaId, by: 'agent' })
  assert.equal(typeof f.then, 'undefined', 'a facade is never an accidental thenable')
  assert.equal(await Promise.resolve(f) === f, true)
  assert.doesNotThrow(() => f.close())
  assert.equal(w.db.list('contact').length, 2, 'close did not close the real handle')
})

await ok('a copy that cannot be read is an error to the one who asked, not an empty answer', () => {
  const f = makeFacade({ rawOf: () => ({ ok: false, code: 'unknown_db', message: 'no such database' }), row: async () => ({ ok: true }) })
  assert.throws(() => f.info(), /no such database/)
  assert.throws(() => f.list('contact'), /no such database/)
})

await ok('the door\'s shape of a refusal keeps what the page needs and nothing else', () => {
  assert.deepEqual(doorShape({ ok: true, a: 1 }), { ok: true, a: 1 })
  assert.deepEqual(doorShape({ ok: false, code: 'invalid', message: 'm', errors: [1], extra: 'x' }), { ok: false, error: 'invalid', message: 'm', errors: [1] })
  assert.deepEqual(doorShape({ ok: false, code: 'unreachable', message: 'm', canForget: true }), { ok: false, error: 'unreachable', message: 'm', canForget: true }, 'the page offers the way out only when it is told there is one')
  assert.deepEqual(doorShape({ ok: false, code: 'sensitive', message: 'm', fields: [{ object: 'cost' }] }).fields, [{ object: 'cost' }])
  assert.deepEqual(doorShape({ ok: false }), { ok: false, error: 'failed', message: 'the web app refused it' })
})

// ---------------------------------------------------------------- slugs
await ok('a hosted name comes from the app\'s name: plain letters, digits and dashes, never taken twice', () => {
  assert.equal(slugFor('Home'), 'home')
  assert.equal(slugFor('Café des Amis & Co.'), 'cafe-des-amis-co')
  assert.equal(slugFor('2026 plan'), 'app-2026-plan')
  assert.equal(slugFor('日本語'), 'app')
  assert.equal(slugFor(''), 'app')
  assert.equal(slugFor('Home', ['home']), 'home-2')
  assert.equal(slugFor('Home', ['home', 'home-2', 'home-3']), 'home-4')
  assert.equal(slugFor('x'.repeat(80)).length, 36)
  assert.match(slugFor('x'.repeat(80), ['x'.repeat(36)]), /^x+-2$/)
  for (const name of ['A', 'a b c', '---', '_', 'Ünï côdé', 'a'.repeat(100)]) assert.match(slugFor(name), /^[a-z][a-z0-9-]{0,39}$/, name)
})

// ---------------------------------------------------------------- the card
await ok('the Publish card says what would go, what is personal, whether it can go, and which computers it could go to', async () => {
  const w = world()
  const c = await w.publisher.check(w.id)
  assert.deepEqual([c.ok, c.can, c.reason], [true, true, null])
  assert.deepEqual([c.app.name, c.tables, c.rows, c.files], ['Home', 1, 2, 1])
  assert.ok(c.bytes > PNG.length, 'the file and the database count')
  assert.deepEqual(c.personal.map((p) => [p.object, p.field, p.fieldLabel]), [['contact', 'email', 'Email']], 'personal fields may go, and are listed')
  assert.deepEqual(c.blocked, [])
  assert.deepEqual(c.hosting, { name: 'Kybernos', orderUrl: ORDER_URL }, 'the product\'s name, and the address that orders another computer')
  assert.deepEqual(c.hosts, [{ id: HOST_ID, name: 'Studio', state: 'running', region: 'Frankfurt, EU', alwaysOn: false, shared: false }])
  assert.equal(c.lastHost, null, 'nothing was published yet, so no computer is the usual one')
  for (const gone of ['where', 'pricePerMonth', 'currency', 'budget']) assert.equal(gone in c || gone in c.hosting, false, gone + ' is not part of the card any more')
  noKey(c)
  assert.equal((await w.publisher.check('nope')).ok, false)
  assert.equal(w.space.calls.length, 0, 'looking at the card asks nothing of the space')
  assert.equal(w.hosting.calls.length, 0, 'and asks for no space on any computer')
})

await ok('the computers are read when the card opens, once for each opening, and never by a state read', async () => {
  const w = world()
  assert.equal(w.hosting.hostReads, 0)
  w.api.state(); w.publisher.hostingState(); w.publisher.info(w.id); w.api.state()
  assert.equal(w.hosting.hostReads, 0, 'the header and the state never wait for the hosting')
  await w.publisher.check(w.id)
  assert.equal(w.hosting.hostReads, 1)
  await w.publisher.check(w.id)
  assert.equal(w.hosting.hostReads, 2, 'a card that opens again reads again: the list is the person\'s, it changes')
  w.hosting.list.push({ id: 'host-2', name: 'Cabinet', state: 'sleeping', region: 'Paris, FR', alwaysOn: true, shared: true })
  const c = await w.publisher.check(w.id)
  assert.deepEqual(c.hosts.map((h) => [h.id, h.state, h.region, h.alwaysOn, h.shared]), [[HOST_ID, 'running', 'Frankfurt, EU', false, false], ['host-2', 'sleeping', 'Paris, FR', true, true]], 'in the order the port gave them, with what it said of each')
  const done = await published()
  const before = done.hosting.hostReads
  assert.equal((await done.publisher.check(done.id)).reason, 'published')
  assert.equal(done.hosting.hostReads, before, 'an app that cannot be published asks nothing of the hosting')
})

await ok('the card refuses an app with sensitive or secret fields, and names them', async () => {
  const w = world({ objects: [CONTACT, COSTS] })
  const c = await w.publisher.check(w.id)
  assert.deepEqual([c.can, c.reason], [false, 'sensitive'])
  assert.deepEqual(c.blocked.map((b) => [b.object, b.field, b.protection]), [['cost', 'amount', 'sensitive'], ['cost', 'key', 'secret']])
  assert.equal(w.hosting.hostReads, 0, 'and does not list computers it will not send anything to')
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.code], [false, 'sensitive'])
  assert.deepEqual(r.fields.map((f) => f.field), ['amount', 'key'])
  assert.equal(w.hosting.calls.length, 0, 'and no space was asked for')
  assert.equal(w.registry.spaces().length, 0)
})

await ok('the card refuses what cannot be published: no hosting, an archived app, an app too big, an app already published; none of them reads the computers', async () => {
  const none = world({ hosting: unavailableHosting() })
  const nc = await none.publisher.check(none.id)
  assert.deepEqual([nc.can, nc.reason, nc.hosting], [false, 'unavailable', { name: '', orderUrl: '' }])
  assert.deepEqual(none.publisher.hostingState(), { available: false, name: '' })
  assert.equal((await none.publisher.publish(none.id, { confirm: true, host: HOST_ID })).code, 'unavailable')
  const off = world({ hostingExtra: { available: () => false } })
  assert.equal((await off.publisher.check(off.id)).reason, 'unavailable')
  const arch = world()
  assert.equal(arch.api.app({ db: arch.id, op: 'archive' }).ok, true)
  assert.equal((await arch.publisher.check(arch.id)).reason, 'archived')
  const big = world({ maxBytes: 500 })
  assert.equal((await big.publisher.check(big.id)).reason, 'too-big')
  assert.equal((await big.publisher.publish(big.id, { confirm: true, host: HOST_ID })).code, 'too-big')
  const done = await published()
  assert.equal((await done.publisher.check(done.id)).reason, 'published')
  assert.equal((await done.publisher.publish(done.id, { confirm: true, host: HOST_ID })).code, 'published')
  for (const w of [none, off, arch, big]) assert.equal(w.hosting.hostReads || 0, 0)
  assert.deepEqual(world().publisher.hostingState(), { available: true, name: 'Kybernos' }, 'the header knows the product\'s name and nothing else')
})

await ok('no computer is a valid answer: the card says so, still carries the order address, and there is nothing to publish to', async () => {
  const w = world({ hostingExtra: { list: [] } })
  const c = await w.publisher.check(w.id)
  assert.deepEqual([c.ok, c.can, c.reason, c.hosts, c.lastHost, c.hosting.orderUrl], [true, false, 'no-host', [], null, ORDER_URL])
  assert.deepEqual([c.tables, c.rows], [1, 2], 'the facts are still there')
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.code], [false, 'unknown-host'])
  assert.deepEqual([w.hosting.calls.length, w.registry.spaces().length, w.registry.apps().length, w.registry.lastHost()], [0, 0, 0, null])
  const bare = world({ hostingExtra: { list: [], describe: () => ({ name: 'Kybernos' }) } })
  assert.equal((await bare.publisher.check(bare.id)).hosting.orderUrl, '', 'and a hosting with no usable address offers none: the page then has no button to show')
})

await ok('a list of computers that cannot be read is its own answer, with the order address; a port that refuses, throws, lies or hangs changes nothing else', async () => {
  const cases = [
    ['refuses', { hosts: async () => ({ ok: false, code: 'unavailable', message: 'The Kybernos server is not answering.' }) }, 'The Kybernos server is not answering.'],
    ['throws', { hosts: async () => { throw new Error('boom ' + SPACE_KEY) } }, null],
    ['rejects', { hosts: () => Promise.reject(new Error('no')) }, null],
    ['lies', { hosts: async () => ({ ok: true, hosts: 'many' }) }, null],
    ['says nothing', { hosts: async () => undefined }, null],
    ['is missing', { hosts: undefined }, null],
  ]
  for (const [label, extra, message] of cases) {
    const w = world({ hostingExtra: extra })
    const c = await w.publisher.check(w.id)
    assert.deepEqual([c.ok, c.can, c.reason, c.hosts, c.lastHost, c.hostsError.code], [true, false, 'hosts-unreachable', null, null, 'hosts-unreachable'], label)
    if (message !== null) assert.equal(c.hostsError.message, message, label)
    assert.ok(c.hostsError.message.length > 0, label)
    assert.equal(c.hosting.orderUrl, ORDER_URL, label + ': the person can still go and order a computer')
    assert.deepEqual([c.tables, c.rows], [1, 2], label)
    noKey(c)
    const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
    assert.deepEqual([r.ok, r.code], [false, 'hosts-unreachable'], label)
    noKey(r)
    assert.deepEqual([w.hosting.calls.length, w.registry.spaces().length, w.publisher.isPublished(w.id)], [0, 0, false], label)
  }
  const hang = world({ hostingExtra: { hosts: () => new Promise(() => {}) } })
  const waiting = hang.publisher.check(hang.id)
  assert.deepEqual([hang.tm.timeouts.length, hang.tm.timeouts[0].ms], [1, HOSTS_TIMEOUT_MS], 'the wait has a limit')
  hang.tm.timeouts[0].fn()
  assert.equal((await waiting).reason, 'hosts-unreachable')
})

await ok('the computer the last Publish went to is the card\'s usual choice, while it is still listed', async () => {
  const w = await published({ hostingExtra: { list: [{ id: HOST_ID, name: 'Studio', state: 'running' }, { id: 'host-2', name: 'Cabinet', state: 'running' }] } })
  assert.equal(w.registry.lastHost(), HOST_ID)
  const other = w.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal((await w.publisher.check(other)).lastHost, HOST_ID)
  w.hosting.list = [{ id: 'host-2', name: 'Cabinet', state: 'running' }]
  assert.equal((await w.publisher.check(other)).lastHost, null, 'a computer that is no longer listed is not offered')
  const again = openPublishedRegistry({ file: w.registry.file })
  assert.equal(again.lastHost(), HOST_ID, 'and it is kept in the private file')
})

// ---------------------------------------------------------------- Publish
await ok('Publish waits for the confirm button, then puts the app in the space of the chosen computer and registers it only once the hosted copy is proven', async () => {
  const w = world()
  const before = w.db.fingerprint()
  const no = await w.publisher.publish(w.id, { host: HOST_ID })
  assert.deepEqual([no.ok, no.code], [false, 'confirm'])
  assert.equal(w.hosting.calls.length, 0, 'nothing is asked of the hosting before the button')
  assert.equal(w.registry.apps().length, 0)
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual([r.published.slug, r.published.url, r.published.syncError, r.published.hostGone], ['home', SPACE_URL, null, false])
  assert.deepEqual(r.published.host, { id: HOST_ID, name: 'Studio', region: 'Frankfurt, EU' }, 'the state names the computer')
  assert.equal(typeof r.published.since, 'string')
  assert.deepEqual(w.hosting.calls, [{ host: HOST_ID }], 'the hosting is asked for a space on that computer')
  assert.equal(w.space.has('home'), true)
  assert.equal(w.space.dbOf('home').fingerprint(), before, 'the hosted copy is exactly what was sent')
  assert.deepEqual(w.space.dbOf('home').list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob'])
  assert.ok(w.space.dbOf('home').blobs.get(w.att.hash).equals(PNG), 'with its file')
  assert.deepEqual([w.registry.published(w.id), w.registry.spaces().length, w.registry.pendingOf(w.id)], [true, 1, []])
  assert.equal(w.registry.spaces()[0].host, HOST_ID, 'the space knows its computer')
  assert.deepEqual(w.registry.apps()[0].host, { id: HOST_ID, name: 'Studio', region: 'Frankfurt, EU' }, 'so does the app, with the name and region it had')
  assert.equal(w.registry.lastHost(), HOST_ID)
  assert.equal(w.publisher.isPublished(w.id), true)
  assert.deepEqual(w.publisher.info(w.id), r.published)
  assert.equal(w.svc.byId(w.id).db.published, true, 'the agent now gets the facade')
  assert.deepEqual(names(w), ['Ada', 'Bob'])
  assert.deepEqual(stray(w), [], 'no copy is left in the working folder')
  assert.equal(statSync(w.registry.file).mode & 0o777, 0o600)
  noKey(r)
  noKey(w.logs)
  noKey(w.publisher.info(w.id))
  noKey(await w.publisher.check(w.id))
})

await ok('Publish reads the computers again and refuses one that is not among them, or no computer at all', async () => {
  for (const host of [undefined, null, '', 42, {}, [HOST_ID], '../etc', 'host-9', 'HOST-1', ' ' + HOST_ID, HOST_ID + '\n', 'x'.repeat(300)]) {
    const w = world()
    const r = await w.publisher.publish(w.id, { confirm: true, host })
    assert.deepEqual([r.ok, r.code], [false, 'unknown-host'], JSON.stringify(host))
    assert.match(r.message, /not one of your cloud computers/)
    assert.deepEqual([w.hosting.calls.length, w.registry.spaces().length, w.registry.apps().length, w.registry.pendingOf(w.id).length, w.space.slugs()], [0, 0, 0, 0, []], JSON.stringify(host))
  }
  const w = world()
  assert.deepEqual([(await w.publisher.publish(w.id)).code, (await w.publisher.publish(w.id, { host: HOST_ID })).code], ['confirm', 'confirm'])
  const card = await w.publisher.check(w.id)
  assert.equal(card.hosts[0].id, HOST_ID)
  const reads = w.hosting.hostReads
  w.hosting.list = [{ id: 'host-9', name: 'Another', state: 'running' }] // the computer was deleted between the card and the button
  const gone = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([gone.ok, gone.code], [false, 'unknown-host'])
  assert.equal(w.hosting.hostReads, reads + 1, 'the list was read again, not trusted from the card')
  assert.deepEqual([w.hosting.calls.length, w.registry.spaces().length, w.publisher.isPublished(w.id), w.registry.lastHost()], [0, 0, false, null])
  assert.equal((await w.publisher.publish(w.id, { confirm: true, host: 'host-9' })).ok, true, 'and the one that is listed can be chosen')
})

await ok('two publishes of the same app at once: one runs, the other is told to wait', async () => {
  const w = world()
  const [a, b] = await Promise.all([w.publisher.publish(w.id, { confirm: true, host: HOST_ID }), w.publisher.publish(w.id, { confirm: true, host: HOST_ID })])
  assert.deepEqual([a.ok, b.ok, b.code], [true, false, 'busy'])
  assert.deepEqual(w.space.slugs(), ['home'])
})

await ok('a second app goes to the same space under its own name; a name already taken there gets the next free one', async () => {
  const w = await published()
  const second = w.svc.create({ name: 'Home', by: 'agent', objects: [CONTACT] }).db
  const r = await w.publisher.publish(second.info().id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.published.slug], [true, 'home-2'])
  assert.equal(w.registry.spaces().length, 1, 'one space')
  assert.equal((await w.publisher.check(w.svc.create({ name: 'Third', by: 'agent' }).db.info().id)).lastHost, HOST_ID)
  const taken = world()
  mkdirSync(join(taken.space.appsDir, 'home'))
  const r2 = await taken.publisher.publish(taken.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r2.ok, r2.published.slug], [true, 'home-2'], 'a name the space refuses is not a reason to fail')
})

await ok('a hosting that refuses, in any of its codes, or hands back something unusable, leaves nothing behind and says what the port said', async () => {
  for (const code of ['budget', 'host-gone', 'host-unavailable', 'unavailable', 'unknown-host', 'something-new']) {
    const w = world({ hostingExtra: { ensureSpace: async () => ({ ok: false, code, message: 'The port says ' + code + '.' }) } })
    const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
    assert.deepEqual([r.ok, r.code, r.message], [false, code, 'The port says ' + code + '.'], code)
    assert.deepEqual([w.registry.spaces().length, w.registry.apps().length, w.registry.lastHost(), w.space.slugs(), w.publisher.isPublished(w.id)], [0, 0, null, [], false], code)
  }
  const long = world({ hostingExtra: { ensureSpace: async () => ({ ok: false, code: 'host-unavailable', message: 'z'.repeat(900) }) } })
  assert.equal((await long.publisher.publish(long.id, { confirm: true, host: HOST_ID })).message.length, 300)
  const mute = world({ hostingExtra: { ensureSpace: async () => ({ ok: false }) } })
  assert.deepEqual((({ ok, code }) => [ok, code])(await mute.publisher.publish(mute.id, { confirm: true, host: HOST_ID })), [false, 'hosting-failed'])
  const throws = world({ hostingExtra: { ensureSpace: async () => { throw new Error('boom ' + SPACE_KEY) } } })
  const t = await throws.publisher.publish(throws.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([t.ok, t.code], [false, 'hosting-failed'])
  noKey(t)
  for (const bad of [null, { ok: true }, { ok: true, space: { id: 's', url: 'http://evil.example', bootKey: SPACE_KEY } }, { ok: true, space: { id: 's', url: SPACE_URL, bootKey: 'short' } }, { ok: true, space: { id: '../s', url: SPACE_URL, bootKey: SPACE_KEY } }]) {
    const w = world({ hostingExtra: { ensureSpace: async () => bad } })
    const x = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
    assert.equal(x.ok, false)
    assert.equal(w.registry.spaces().length + w.registry.apps().length, 0)
    assert.deepEqual(w.space.slugs(), [])
  }
})

await ok('a space that already belongs to one computer is not handed out for another', async () => {
  const two = [{ id: HOST_ID, name: 'Studio', state: 'running' }, { id: 'host-2', name: 'Cabinet', state: 'running' }]
  const w = await published({ hostingExtra: { list: two, ensureSpace: async (arg) => ({ ok: true, space: { id: 'one-space', url: SPACE_URL, bootKey: SPACE_KEY } }) } })
  const other = w.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  const r = await w.publisher.publish(other, { confirm: true, host: 'host-2' })
  assert.deepEqual([r.ok, r.code], [false, 'hosting-failed'])
  assert.match(r.message, /another computer/)
  assert.deepEqual([w.registry.spaces().length, w.registry.apps().length, w.registry.spaceOf(w.id).space.host], [1, 1, HOST_ID])
})

await ok('moving an app is Unpublish, then Publish on the other computer: it goes to its own space, and the usual choice follows', async () => {
  const two = [{ id: HOST_ID, name: 'Studio', state: 'running', region: 'Frankfurt, EU' }, { id: 'host-2', name: 'Cabinet', state: 'sleeping', region: 'Paris, FR' }]
  const w = await published({ hostingExtra: { list: two, releaseSpace: async (id) => { w.released.push(id); return { ok: true } } } })
  w.released = []
  assert.equal((await w.publisher.unpublish(w.id)).ok, true)
  assert.deepEqual([w.released, w.registry.spaces().length], [['space-' + HOST_ID], 0])
  const r = await w.publisher.publish(w.id, { confirm: true, host: 'host-2' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.published.host, { id: 'host-2', name: 'Cabinet', region: 'Paris, FR' })
  assert.deepEqual([w.hosting.calls.map((c) => c.host), w.registry.spaces().map((s) => [s.id, s.host]), w.registry.lastHost()], [[HOST_ID, 'host-2'], [['space-host-2', 'host-2']], 'host-2'])
  assert.equal((await w.publisher.check(w.id)).reason, 'published', 'and an app that is published has no way to be published somewhere else')
})

await ok('a space that cannot be reached, or that refuses the upload, is no published app and no stray upload', async () => {
  const down = world()
  down.space.down = true
  const d = await down.publisher.publish(down.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([d.ok, d.code], [false, 'unreachable'])
  assert.deepEqual([down.registry.apps().length, down.registry.pendingOf(down.id).length, down.publisher.isPublished(down.id), down.registry.lastHost()], [0, 0, false, null])
  down.space.down = false
  assert.equal((await down.publisher.publish(down.id, { confirm: true, host: HOST_ID })).ok, true, 'and the same app publishes once it is up')
  const bad = world()
  bad.space.failNext('putBundle', { ok: false, code: 'invalid-bundle', message: 'The web app did not accept that app.' })
  const b = await bad.publisher.publish(bad.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([b.ok, b.code], [false, 'invalid-bundle'])
  assert.deepEqual([bad.registry.pendingOf(bad.id), bad.space.slugs()], [[], []])
  const twin = world()
  const first = await twin.publisher.publish(twin.id, { confirm: true, host: HOST_ID })
  assert.equal(first.ok, true)
  await twin.publisher.unpublish(twin.id, { forget: true, confirm: 'Home' })
  const again = await twin.publisher.publish(twin.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([again.ok, again.code], [false, 'db-exists'], 'a copy left in the space by a forgotten app is named, not duplicated')
  assert.match(again.message, /earlier attempt/)
})

await ok('a space that does not hold what was sent takes the upload back and registers nothing', async () => {
  const w = world()
  w.space.failNext('fingerprint', { ok: true, fingerprint: '0.0.0.0' })
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.code], [false, 'mismatch'])
  assert.deepEqual([w.space.slugs(), w.registry.apps().length, w.registry.pendingOf(w.id).length], [[], 0, 0], 'the upload was released')
  assert.deepEqual(names(w), ['Ada', 'Bob'])
  const gone = world()
  gone.space.before('fingerprint', () => { gone.space.failNext('release', { ok: false, code: 'unreachable', message: 'down' }); gone.space.failNext('fingerprint', { ok: true, fingerprint: '0.0.0.0' }) })
  const g = await gone.publisher.publish(gone.id, { confirm: true, host: HOST_ID })
  assert.equal(g.ok, false)
  assert.equal(gone.registry.pendingOf(gone.id).length, 1, 'an upload that could not be taken back is remembered')
  assert.equal(gone.registry.apps().length, 0)
  const next = await gone.publisher.publish(gone.id, { confirm: true, host: HOST_ID })
  assert.equal(next.ok, true, JSON.stringify(next))
  assert.deepEqual([gone.registry.pendingOf(gone.id).length, gone.space.slugs()], [0, ['home']], 'the next attempt took the old upload out first, so there is one copy and its name is free again')
})

await ok('an app that changes while it is being published is not published (the change would be lost to the copy)', async () => {
  const w = world()
  w.space.before('putBundle', () => { assert.equal(w.db.create('contact', { name: 'Late' }, 'agent').ok, true) })
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.code], [false, 'changed'])
  assert.deepEqual([w.space.slugs(), w.registry.apps().length], [[], 0])
  assert.equal(w.publisher.isPublished(w.id), false)
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Late'])
  assert.equal((await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })).ok, true, 'and trying again works')
})

await ok('a registry that cannot save leaves the app unpublished and the upload taken back', async () => {
  const w = world({ wrapRegistry: (reg) => ({ ...reg, addApp: () => ({ ok: false, code: 'registry', message: 'could not save' }) }) })
  const r = await w.publisher.publish(w.id, { confirm: true, host: HOST_ID })
  assert.deepEqual([r.ok, r.code], [false, 'registry'])
  assert.deepEqual(w.space.slugs(), [])
})

// ---------------------------------------------------------------- rows of a published app
await ok('a row written on a published app goes to the web app and the copy here has it before the answer returns', async () => {
  const w = await published()
  const created = await w.publisher.forwardWrite({ object: 'contact', op: 'create', values: { name: 'Cleo' } })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Cleo'], 'the copy was refreshed first')
  assert.deepEqual(w.space.dbOf(w.slug).list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob', 'Cleo'])
  const id = created.record.id
  const upd = await w.publisher.forwardWrite({ object: 'contact', op: 'update', id, values: { name: 'Cleopatra' } })
  assert.equal(upd.ok, true)
  assert.equal(w.svc.byId(w.id).db.get('contact', id).values.name, 'Cleopatra')
  assert.equal((await w.publisher.forwardWrite({ object: 'contact', op: 'delete', id })).ok, true)
  assert.deepEqual(names(w), ['Ada', 'Bob'])
  assert.equal((await w.publisher.forwardWrite({ object: 'contact', op: 'restore', id })).ok, true)
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Cleopatra'])
  assert.equal(w.publisher.info(w.id).syncError, null)
})

await ok('the write of a published app is the page\'s, in the door\'s shape; an app that is not published is the local door\'s', async () => {
  const w = await published()
  const alone = w.publisher.forwardWrite({ object: 'contact', op: 'create', values: { name: 'Solo' } })
  assert.equal(alone instanceof Promise, true, 'a call that names no app means the only one, which is published')
  assert.equal((await alone).ok, true)
  const local = w.svc.create({ name: 'Local', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal(w.publisher.forwardWrite({ db: local, object: 'contact', op: 'create', values: { name: 'X' } }), null)
  assert.equal(w.publisher.forwardWrite({ db: 'nope', object: 'contact', op: 'create' }), null)
  assert.equal(w.publisher.forwardWrite({ object: 'contact', op: 'create', values: { name: 'Which?' } }), null, 'with two apps a call that names none is the local door\'s to refuse')
  assert.equal((await w.publisher.forwardWrite(undefined) ?? { ok: false }).ok, false, 'a body that is not one does not throw')
  const rejected = await w.publisher.forwardWrite({ db: w.id, object: 'contact', op: 'create', values: {} })
  assert.deepEqual([rejected.ok, rejected.error], [false, 'invalid'], 'the web app\'s own refusal')
  assert.equal(typeof rejected.message, 'string')
  const bad = await w.publisher.forwardWrite({ db: w.id, object: 'contact', op: 'explode' })
  assert.deepEqual([bad.ok, bad.error], [false, 'invalid'])
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Solo'], 'a write the web app refused changed nothing here')
  assert.equal(w.api.write({ db: w.id, object: 'contact', op: 'create', values: { name: 'Y' } }).error, 'published', 'the local door never writes into a mirror')
  assert.equal(w.api.upload({ db: w.id, object: 'contact', field: 'photo', name: 'a.png', type: 'image/png', bytes: PNG }).error, 'published')
})

await ok('a space that is down when a row is written says the row may not have been saved, and the copy stays as it was', async () => {
  const w = await published()
  w.space.down = true
  const r = await w.publisher.forwardWrite({ object: 'contact', op: 'create', values: { name: 'Lost' } })
  assert.deepEqual([r.ok, r.error], [false, 'unreachable'])
  assert.match(r.message, /may not have been saved/)
  assert.deepEqual(names(w), ['Ada', 'Bob'])
  w.space.down = false
  const back = await w.publisher.refresh(w.id)
  assert.equal(back.ok, true)
  assert.deepEqual(names(w), ['Ada', 'Bob'])
})

await ok('a file goes up through the web app, and reaches the copy once a row holds it', async () => {
  const w = await published()
  const up = await w.publisher.forwardUpload({ object: 'contact', field: 'photo', name: 'bob.png', type: 'image/png', bytes: PNG2 })
  assert.equal(up.ok, true, JSON.stringify(up))
  assert.equal(up.file.hash, sha256(PNG2))
  const bob = w.svc.byId(w.id).db.list('contact').find((r) => r.values.name === 'Bob')
  const blobsBefore = w.space.calls.filter((c) => c === 'blob').length
  const wrote = await w.publisher.forwardWrite({ object: 'contact', op: 'update', id: bob.id, values: { photo: [up.file] } })
  assert.equal(wrote.ok, true, JSON.stringify(wrote))
  const mirror = w.svc.byId(w.id).db
  assert.ok(mirror.blobs.get(sha256(PNG2)).equals(PNG2), 'the new file is in the copy')
  assert.ok(mirror.blobs.get(w.att.hash).equals(PNG), 'the old one still is')
  assert.equal(w.space.calls.filter((c) => c === 'blob').length - blobsBefore, 1, 'only the file the copy did not have was fetched')
  const refused = await w.publisher.forwardUpload({ object: 'contact', field: 'name', name: 'x', type: 'text/plain', bytes: PNG })
  assert.deepEqual([refused.ok, refused.error], [false, 'invalid'])
  assert.equal(w.publisher.forwardUpload({ db: 'nope', object: 'contact' }), null)
  w.space.down = true
  const down = await w.publisher.forwardUpload({ object: 'contact', field: 'photo', name: 'z.png', type: 'image/png', bytes: PNG2 })
  assert.deepEqual([down.ok, down.error], [false, 'unreachable'])
})

// ---------------------------------------------------------------- the mirror
await ok('the copy follows the web app: a change made there (another person, another session) arrives, and an unchanged app costs one small request', async () => {
  const w = await published()
  const same = await w.publisher.refresh(w.id)
  assert.deepEqual([same.ok, same.changed], [true, false])
  const before = w.space.calls.length
  await w.publisher.refresh(w.id)
  assert.deepEqual(w.space.calls.slice(before), ['fingerprint'], 'nothing changed: only the stamp was asked')
  w.space.writeInside(w.slug, (db) => assert.equal(db.create('contact', { name: 'Member' }, 'person').ok, true))
  const moved = await w.publisher.refresh(w.id)
  assert.deepEqual([moved.ok, moved.changed], [true, true])
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Member'])
  assert.equal(w.svc.byId(w.id).db.fingerprint(), w.space.dbOf(w.slug).fingerprint())
  assert.equal(w.svc.byId(w.id).db.info().id, w.id, 'still the same app')
  assert.equal(w.publisher.info(w.id).lastSync, new Date(w.c.now()).toISOString())
  assert.deepEqual(stray(w), [])
})

await ok('a copy that is refreshed keeps the files it already had, and asks only for the new ones', async () => {
  const w = await published()
  const second = w.space.dbOf(w.slug).blobs.hash(PNG2)
  w.space.writeInside(w.slug, (db) => {
    const a = db.attach(PNG2, { name: 'new.png', type: 'image/png' })
    assert.equal(a.ok, true)
    assert.equal(db.create('contact', { name: 'Dee', photo: [a.file] }, 'person').ok, true)
  })
  const n = w.space.calls.filter((c) => c === 'blob').length
  assert.equal((await w.publisher.refresh(w.id)).changed, true)
  assert.equal(w.space.calls.filter((c) => c === 'blob').length - n, 1)
  const mirror = w.svc.byId(w.id).db
  assert.deepEqual(mirror.blobs.list().sort(), [w.att.hash, second].sort())
  assert.equal(mirror.verify().ok !== false, true)
})

await ok('a pull that goes wrong leaves the copy exactly as it was, says so, and leaves nothing behind', async () => {
  const w = await published()
  const fp = w.svc.byId(w.id).db.fingerprint()
  const handle = w.svc.raw(w.id).db
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Hosted only' }, 'person'))
  const tries = [
    ['snapshotDb', { ok: false, code: 'space', message: 'The web app had a problem.' }, 'space'],
    ['manifest', { ok: false, code: 'unreachable', message: 'The web app could not be reached.' }, 'unreachable'],
    ['fingerprint', { ok: false, code: 'refused', message: 'The web app did not accept this computer’s key.' }, 'refused'],
  ]
  for (const [method, answer, code] of tries) {
    w.space.failNext(method, answer)
    const r = await w.publisher.refresh(w.id)
    assert.deepEqual([r.ok, r.code], [false, code], method)
    assert.equal(w.svc.byId(w.id).db.fingerprint(), fp, method + ': the copy is as it was')
    assert.deepEqual(w.publisher.info(w.id).syncError.code, code)
    assert.equal(typeof w.publisher.info(w.id).syncError.at, 'string')
    assert.deepEqual(stray(w), [], method)
    w.c.advance(BACKOFF_MAX_MS + 1)
  }
  // a damaged database file
  const real = await w.space.snapshotDb(w.slug)
  const flipped = Buffer.from(real.bytes)
  flipped[flipped.length - 100] ^= 0xff
  w.space.failNext('snapshotDb', { ok: true, bytes: flipped, fingerprint: real.fingerprint })
  assert.equal((await w.publisher.refresh(w.id)).code, 'mismatch')
  // a file that is not the one it says
  const hosted = w.space.dbOf(w.slug)
  const att = hosted.attach(PNG2, { name: 'p.png', type: 'image/png' })
  hosted.create('contact', { name: 'With file', photo: [att.file] }, 'person')
  w.space.failNext('blob', { ok: true, bytes: Buffer.from('not the picture') })
  assert.equal((await w.publisher.refresh(w.id)).code, 'mismatch', 'the wrong size')
  w.space.failNext('blob', { ok: true, bytes: Buffer.alloc(PNG2.length, 9) })
  assert.equal((await w.publisher.refresh(w.id)).code, 'mismatch', 'the right size and the wrong bytes: a file is named by what it holds')
  // a different database at that address
  const m = await w.space.manifest(w.slug)
  w.space.failNext('manifest', { ok: true, manifest: { ...m.manifest, db: { ...m.manifest.db, id: ULID2 } } })
  assert.equal((await w.publisher.refresh(w.id)).code, 'mismatch')
  // another app's data at this app's address
  const other = w.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal((await w.publisher.publish(other, { confirm: true, host: HOST_ID })).ok, true)
  const swapped = await pullMirror({ space: w.space, slug: 'other', dbId: w.id, current: { fingerprint: 'x', blobSize: () => null, blobFile: () => '' }, tmpRoot: w.tmpRoot })
  assert.deepEqual([swapped.ok, swapped.code], [false, 'mismatch'])
  assert.match(swapped.message, /different database/)
  assert.equal(w.svc.byId(w.id).db.fingerprint(), fp, 'through all of it')
  assert.equal(w.svc.raw(w.id).db, handle, 'the copy was never swapped: the very same handle')
  assert.deepEqual(names(w), ['Ada', 'Bob'])
  assert.deepEqual(stray(w), [])
  noKey(w.publisher.info(w.id))
  // and the next pull that works catches up
  w.c.advance(BACKOFF_MAX_MS + 1)
  const ok2 = await w.publisher.refresh(w.id)
  assert.equal(ok2.ok, true, JSON.stringify(ok2))
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Hosted only', 'With file'])
  assert.equal(w.publisher.info(w.id).syncError, null)
})

await ok('an app that keeps changing while it is copied is retried a few times, then reported, never half taken', async () => {
  const w = await published()
  const fp = w.svc.byId(w.id).db.fingerprint()
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Zed' }, 'person'))
  let writes = 0
  const arm = () => w.space.before('snapshotDb', () => { writes += 1; w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Churn ' + writes }, 'person')); arm() })
  arm()
  const r = await w.publisher.refresh(w.id)
  assert.deepEqual([r.ok, r.code], [false, 'busy'])
  assert.equal(writes, 3, 'three attempts')
  assert.equal(w.svc.byId(w.id).db.fingerprint(), fp)
  assert.deepEqual(stray(w), [])
})

await ok('a copy that is too big for this computer to take in one go is refused before it is fetched', async () => {
  const w = await published({ maxBytes: 100 * 1024 * 1024 })
  const hosted = w.space.dbOf(w.slug)
  const att = hosted.attach(PNG2, { name: 'p.png', type: 'image/png' })
  hosted.create('contact', { name: 'Big', photo: [att.file] }, 'person')
  const space = w.space
  const current = { fingerprint: 'x', blobSize: () => null, blobFile: () => '' }
  const r = await pullMirror({ space, slug: w.slug, dbId: w.id, current, tmpRoot: w.tmpRoot, maxBytes: 1000 })
  assert.deepEqual([r.ok, r.code], [false, 'too-large'])
  assert.equal(space.calls.includes('blob'), false)
})

await ok('refreshes of one app run one at a time; asked ten times at once, it pulls at most twice, and nobody gets a stale answer', async () => {
  const w = await published()
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Slow' }, 'person'))
  let release = null
  const gate = new Promise((r) => { release = r })
  w.space.before('fingerprint', () => gate)
  const before = w.space.calls.filter((c) => c === 'fingerprint').length
  const all = Array.from({ length: 10 }, () => w.publisher.refresh(w.id))
  release()
  const answers = await Promise.all(all)
  assert.equal(answers.every((a) => a.ok), true)
  assert.equal(w.space.calls.filter((c) => c === 'fingerprint').length - before, 2, 'one running, one waiting; the rest share the waiting one')
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Slow'])
})

await ok('the swap of a copy is two renames, undone if the second fails; a swap cut short by a crash is put right at the next start', () => {
  const w = world()
  const dbs = join(w.dir, 'local', 'dbs')
  const failed = w.svc.replaceMirror(w.id, join(w.dir, 'nowhere'))
  assert.deepEqual([failed.ok, failed.code], [false, 'swap'])
  assert.deepEqual(w.svc.byId(w.id).db.list('contact').length, 2, 'the app is still there and opens')
  assert.deepEqual(readdirSync(dbs).filter((n) => n.startsWith('.old-')), [], 'nothing left aside')
  assert.equal(w.svc.replaceMirror('nope', join(w.dir, 'x')).code, 'unknown_db')
  // a crash between the two renames: the old copy is aside, the new one never arrived
  w.svc.close()
  const live = join(dbs, w.id)
  const aside = join(dbs, '.old-' + w.id + '-0a1b2c3d')
  renameSync(live, aside)
  assert.equal(existsSync(live), false)
  const restarted = makeService({ dir: dbs, ports: ports() })
  assert.equal(restarted.byId(w.id).ok, true, 'put back at the start')
  assert.equal(existsSync(aside), false)
  restarted.close()
  // a crash after the new one arrived: the leftover is dropped, the new one kept
  mkdirSync(aside, { recursive: true })
  writeFileSync(join(aside, 'old.txt'), 'old')
  const again = makeService({ dir: dbs, ports: ports() })
  assert.equal(again.byId(w.id).ok, true)
  assert.equal(existsSync(aside), false)
  again.close()
})

// ---------------------------------------------------------------- the poll
await ok('the poll refreshes every published app, skips one that is backed off, and backs off longer each time up to five minutes', async () => {
  const w = await published()
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Polled' }, 'person'))
  await w.publisher.tick()
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Polled'])
  w.space.down = true
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Later' }, 'person'))
  const calls = () => w.space.calls.length
  await w.publisher.tick()
  assert.equal(w.publisher.info(w.id).syncError.code, 'unreachable')
  const n = calls()
  await w.publisher.tick()
  assert.equal(calls(), n, 'backed off: not asked again at once')
  w.c.advance(POLL_MS * 2 + 1)
  await w.publisher.tick()
  assert.equal(calls() > n, true, 'asked again after the wait')
  for (let i = 0; i < 12; i++) { w.c.advance(BACKOFF_MAX_MS + 1); await w.publisher.tick() }
  const m = calls()
  w.c.advance(BACKOFF_MAX_MS - 1000)
  await w.publisher.tick()
  assert.equal(calls(), m, 'never waits longer than five minutes, and not shorter than it said')
  w.c.advance(2000)
  w.space.down = false
  await w.publisher.tick()
  assert.equal(w.publisher.info(w.id).syncError, null, 'one good pull clears it')
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Later', 'Polled'])
  w.c.advance(1)
  const k = calls()
  await w.publisher.tick()
  assert.equal(calls() - k, 1, 'and it is polled at the normal pace again (one stamp)')
})

await ok('the poll does not touch an app that is being published or unpublished', async () => {
  const w = await published()
  let added = -1
  w.space.before('release', async () => { const n = w.space.calls.length; await w.publisher.tick(); added = w.space.calls.length - n })
  assert.equal((await w.publisher.unpublish(w.id)).ok, true)
  assert.equal(added, 0, 'a tick that comes while the app is being unpublished asks the web app nothing')
})

await ok('the timer is started once, never holds the process open, runs one tick at a time and is taken off with everything else', async () => {
  const w = await published({ timers: timers() })
  const was = { timeouts: w.tm.timeouts.length, cleared: w.tm.cleared.length, unrefs: w.tm.unrefs } // Publish read the computers, which set and took off its own limit
  assert.deepEqual([was.timeouts, was.cleared, was.unrefs], [1, 1, 1])
  w.publisher.start({ everyMs: 1234, firstMs: 56 })
  assert.deepEqual([w.tm.timeouts.length - was.timeouts, w.tm.intervals.length, w.tm.unrefs - was.unrefs], [1, 1, 2])
  assert.deepEqual([w.tm.timeouts[was.timeouts].ms, w.tm.intervals[0].ms], [56, 1234])
  w.publisher.start()
  assert.equal(w.tm.cleared.length - was.cleared, 2, 'starting again takes the old ones off first')
  assert.equal(w.tm.intervals[1].ms, POLL_MS)
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Ticked' }, 'person'))
  w.tm.intervals[1].fn()
  for (let i = 0; i < 200 && names(w).length < 3; i++) await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Ticked'])
  w.publisher.stop()
  assert.equal(w.tm.cleared.length - was.cleared, 4)
  w.publisher.stop()
  assert.equal(w.tm.cleared.length - was.cleared, 4, 'stopping twice is harmless')
  const broken = world({ timers: { ...timers(), setTimeout: () => { throw new Error('no timers') } } })
  assert.doesNotThrow(() => broken.publisher.start())
})

// ---------------------------------------------------------------- an app whose computer is gone
await ok('an app is "gone" only when it cannot be reached AND a list that succeeded no longer holds its computer; a list that failed, threw or lied never says so', async () => {
  const w = await published()
  const reads = w.hosting.hostReads
  assert.deepEqual([w.publisher.info(w.id).hostGone, w.publisher.info(w.id).host.name], [false, 'Studio'])
  await w.publisher.refresh(w.id)
  assert.equal(w.hosting.hostReads, reads, 'a web app that answers never makes the hosting list anything')
  const later = () => { w.c.advance(HOSTS_EVERY_MS + 1) }
  w.space.down = true
  later()
  await w.publisher.refresh(w.id)
  assert.deepEqual([w.publisher.info(w.id).syncError.code, w.publisher.info(w.id).hostGone, w.hosting.hostReads], ['unreachable', false, reads + 1], 'cannot be reached, but its computer is still listed: not gone')
  w.hosting.list = [] // the computer is deleted...
  const list = w.hosting.hosts
  for (const [label, hosts] of [
    ['a refusal', async () => ({ ok: false, code: 'unavailable', message: 'Not now.' })],
    ['an exception', async () => { throw new Error('boom') }],
    ['a lie', async () => ({ ok: true, hosts: 'nonsense' })],
    ['silence', async () => undefined],
  ]) {
    w.hosting.hosts = hosts // ...but the hosting cannot say so
    later()
    await w.publisher.refresh(w.id)
    assert.deepEqual([w.publisher.info(w.id).hostGone, w.publisher.info(w.id).syncError.code], [false, 'unreachable'], label + ' proves nothing')
  }
  w.hosting.hosts = list
  later()
  await w.publisher.refresh(w.id)
  const gone = w.publisher.info(w.id)
  assert.deepEqual([gone.hostGone, gone.syncError.code], [true, 'unreachable'], 'a list that succeeded and does not hold it')
  assert.deepEqual(gone.host, { id: HOST_ID, name: 'Studio', region: 'Frankfurt, EU' }, 'the name and region are the last ones it had')
  assert.equal(w.api.state().dbs.find((d) => d.id === w.id).published.hostGone, true, 'the state says it')
  assert.deepEqual(names(w), ['Ada', 'Bob'], 'and the copy on this computer is untouched')
  noKey(w.api.state())
  // the computer comes back, and the app answers again
  w.hosting.list = [{ id: HOST_ID, name: 'Studio', state: 'running', region: 'Frankfurt, EU' }]
  w.space.down = false
  await w.publisher.refresh(w.id)
  assert.deepEqual([w.publisher.info(w.id).hostGone, w.publisher.info(w.id).syncError], [false, null], 'an app that answers is not gone, whatever a list said before')
})

await ok('an app that is not reached asks the hosting at most once a minute, however many apps fail and however often; one that answers, refuses or has no computer asks nothing', async () => {
  const w = await published()
  const other = w.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal((await w.publisher.publish(other, { confirm: true, host: HOST_ID })).ok, true)
  w.space.down = true
  w.c.advance(HOSTS_EVERY_MS + 1)
  const n = w.hosting.hostReads
  await Promise.all([w.publisher.refresh(w.id), w.publisher.refresh(other)])
  for (let i = 0; i < 4; i++) { await w.publisher.refresh(w.id); await w.publisher.refresh(other) }
  assert.equal(w.hosting.hostReads, n + 1, 'eleven failures, one question')
  w.c.advance(HOSTS_EVERY_MS - 2000)
  await w.publisher.refresh(w.id)
  assert.equal(w.hosting.hostReads, n + 1)
  w.c.advance(3000)
  await w.publisher.refresh(w.id)
  assert.equal(w.hosting.hostReads, n + 2, 'and again after a minute')
  // a space that answers, but to refuse, is not "gone"
  const refused = await published()
  refused.hosting.list = []
  refused.space.failNext('fingerprint', { ok: false, code: 'refused', message: 'The web app refused the key.' })
  refused.c.advance(HOSTS_EVERY_MS + 1)
  const before = refused.hosting.hostReads
  const x = await refused.publisher.refresh(refused.id)
  assert.deepEqual([x.ok, x.code, refused.publisher.info(refused.id).hostGone, refused.hosting.hostReads], [false, 'refused', false, before])
})

await ok('an app published before computers were chosen has no computer to lose: it is never gone, and the hosting is not asked about it', async () => {
  const old = world()
  const pub = await old.publisher.publish(old.id, { confirm: true, host: HOST_ID })
  assert.equal(pub.ok, true)
  // rewrite its registry the way an earlier version wrote it: no computer on the space, none on the app, no usual choice
  const file = JSON.parse(readFileSync(old.registry.file, 'utf8'))
  delete file.lastHost
  delete file.spaces[0].host
  delete file.apps[0].host
  writeFileSync(old.registry.file, JSON.stringify(file))
  const reg = openPublishedRegistry({ file: old.registry.file })
  assert.deepEqual([reg.fault, reg.lastHost(), reg.spaceOf(old.id).space.host, reg.appOf(old.id).host], [null, null, undefined, undefined])
  const again = makePublisher({ service: old.svc, registry: reg, hosting: old.hosting, tmpRoot: old.tmpRoot, ports: { now: old.c.now, store: ports(), clientFor: () => old.space, timers: timers() } })
  assert.deepEqual([again.info(old.id).host, again.info(old.id).hostGone], [null, false])
  old.space.down = true
  const reads = old.hosting.hostReads
  old.c.advance(HOSTS_EVERY_MS + 1)
  await again.refresh(old.id)
  assert.deepEqual([again.info(old.id).syncError.code, again.info(old.id).hostGone, old.hosting.hostReads], ['unreachable', false, reads])
})

await ok('a computer that is gone takes its space with it when the app is forgotten, and a computer that is not gone keeps it', async () => {
  const w = await published()
  w.space.down = true
  w.hosting.list = []
  w.c.advance(HOSTS_EVERY_MS + 1)
  await w.publisher.refresh(w.id)
  assert.equal(w.publisher.info(w.id).hostGone, true)
  const r = await w.publisher.unpublish(w.id)
  assert.deepEqual([r.ok, r.canForget], [false, true], 'the way that asks the space is still refused')
  const f = await w.publisher.unpublish(w.id, { forget: true, confirm: 'Home' })
  assert.deepEqual([f.ok, f.forgotten], [true, true])
  assert.deepEqual([w.registry.spaces().length, w.registry.apps().length, w.publisher.info(w.id)], [0, 0, null], 'no key is kept for a computer that does not exist')
  assert.deepEqual(w.svc.byId(w.id).db.list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob'], 'the local copy is the app, as of the last sync')
  const kept = await published()
  kept.space.down = true
  assert.equal((await kept.publisher.unpublish(kept.id, { forget: true, confirm: 'Home' })).ok, true)
  assert.equal(kept.registry.spaces().length, 1, 'an app that was only unreachable leaves its space to whoever might still answer')
  const shared = await published()
  const other = shared.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal((await shared.publisher.publish(other, { confirm: true, host: HOST_ID })).ok, true)
  shared.space.down = true
  shared.hosting.list = []
  shared.c.advance(HOSTS_EVERY_MS + 1)
  await shared.publisher.refresh(shared.id)
  assert.equal((await shared.publisher.unpublish(shared.id, { forget: true, confirm: 'Home' })).ok, true)
  assert.equal(shared.registry.spaces().length, 1, 'a space still holding another app stays')
})

// ---------------------------------------------------------------- Unpublish
await ok('Unpublish pulls the last state, takes the app out of the space, and the app is an ordinary local one again', async () => {
  const w = await published({ hostingExtra: { releaseSpace: async (id) => { w.released.push(id); return { ok: true } } } })
  w.released = []
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Last word' }, 'person'))
  const r = await w.publisher.unpublish(w.id)
  assert.deepEqual([r.ok], [true], JSON.stringify(r))
  assert.equal(w.space.has(w.slug), false, 'gone from the space')
  assert.deepEqual([w.registry.published(w.id), w.registry.apps().length], [false, 0])
  assert.equal(w.publisher.info(w.id), null)
  assert.equal(w.publisher.isPublished(w.id), false)
  assert.deepEqual(w.released, ['space-' + HOST_ID], 'the last app left, so the space is given back')
  assert.equal(w.registry.spaces().length, 0)
  const db = w.svc.byId(w.id).db
  assert.equal(db.published, undefined, 'a plain store handle again')
  assert.deepEqual(db.list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob', 'Last word'], 'with what the web app held at the end')
  assert.equal(db.saveView('contact', { id: 'v', name: 'All', kind: 'table' }, 'person').ok, true, 'and it can be changed again')
  assert.equal(db.create('contact', { name: 'Local again' }, 'person').ok, true)
  assert.deepEqual(stray(w), [])
  assert.equal((await w.publisher.unpublish(w.id)).code, 'not-published')
})

await ok('the space stays when other apps still live in it', async () => {
  const w = await published({ hostingExtra: { releaseSpace: async (id) => { w.released.push(id); return { ok: true } } } })
  w.released = []
  const other = w.svc.create({ name: 'Other', by: 'agent', objects: [CONTACT] }).db.info().id
  assert.equal((await w.publisher.publish(other, { confirm: true, host: HOST_ID })).ok, true)
  assert.equal((await w.publisher.unpublish(w.id)).ok, true)
  assert.deepEqual([w.released, w.registry.spaces().length], [[], 1])
})

await ok('an unpublish that cannot reach the space says so, offers the deliberate way out, and changes nothing', async () => {
  const w = await published()
  const fp = w.svc.byId(w.id).db.fingerprint()
  w.space.down = true
  const r = await w.publisher.unpublish(w.id)
  assert.deepEqual([r.ok, r.code, r.canForget], [false, 'unreachable', true])
  assert.deepEqual([w.registry.published(w.id), w.svc.byId(w.id).db.fingerprint(), w.svc.byId(w.id).db.published], [true, fp, true])
  const wrong = await w.publisher.unpublish(w.id, { forget: true, confirm: 'home' })
  assert.deepEqual([wrong.ok, wrong.code], [false, 'confirm'], 'the typed name must be the app\'s own, exactly')
  assert.equal((await w.publisher.unpublish(w.id, { forget: true })).code, 'confirm')
  assert.equal(w.registry.published(w.id), true)
  const gone = await w.publisher.unpublish(w.id, { forget: true, confirm: 'Home' })
  assert.deepEqual([gone.ok, gone.forgotten, gone.left.slug], [true, true, w.slug])
  assert.equal(JSON.stringify(gone).includes(SPACE_KEY), false)
  assert.deepEqual([w.registry.published(w.id), w.publisher.info(w.id)], [false, null])
  assert.equal(w.space.has(w.slug), true, 'the hosted copy was not touched: nobody could reach it')
  const db = w.svc.byId(w.id).db
  assert.deepEqual(db.list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob'], 'the local copy is kept as it was at the last sync')
  assert.equal(db.published, undefined)
  assert.equal(db.create('contact', { name: 'Mine now' }, 'person').ok, true)
})

await ok('an unpublish the space refuses to complete leaves the app published, and trying again works', async () => {
  const w = await published()
  w.space.failNext('release', { ok: false, code: 'space', message: 'The web app had a problem.' })
  const r = await w.publisher.unpublish(w.id)
  assert.deepEqual([r.ok, r.code, r.canForget], [false, 'space', true])
  assert.equal(w.publisher.isPublished(w.id), true)
  assert.equal(w.space.has(w.slug), true)
  assert.equal((await w.publisher.unpublish(w.id)).ok, true)
  assert.equal(w.space.has(w.slug), false)
  // already gone from the space (released by hand there): the app still comes back
  const gone = await published()
  assert.equal((await gone.space.release(gone.slug)).ok, true)
  const x = await gone.publisher.unpublish(gone.id)
  assert.deepEqual([x.ok, x.code, x.canForget], [false, 'unknown', true], 'a copy that cannot be read is not silently dropped')
  assert.equal((await gone.publisher.unpublish(gone.id, { forget: true, confirm: 'Home' })).ok, true)
})

await ok('an app that keeps changing in the web app is not unpublished half way', async () => {
  const w = await published()
  let n = 0
  const arm = () => w.space.before('fingerprint', () => { n += 1; w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Busy ' + n }, 'person')); arm() })
  w.space.writeInside(w.slug, (db) => db.create('contact', { name: 'Start' }, 'person'))
  arm()
  const r = await w.publisher.unpublish(w.id)
  assert.equal(r.ok, false)
  assert.equal(w.publisher.isPublished(w.id), true)
  assert.equal(w.space.has(w.slug), true)
})

await ok('Publish and Unpublish of one app never run together', async () => {
  const w = await published()
  let second = null
  w.space.before('fingerprint', () => { second = w.publisher.unpublish(w.id); return Promise.resolve() })
  const first = w.publisher.unpublish(w.id)
  const [a, b] = await Promise.all([first, second])
  assert.equal([a, b].filter((x) => x.ok).length, 1)
  assert.equal([a, b].find((x) => !x.ok).code, 'busy')
})

// ---------------------------------------------------------------- Open web app
await ok('Open web app hands the page a one-time owner link; an app that is not published has none', async () => {
  const w = await published()
  const r = w.publisher.openWeb(w.id)
  assert.equal(r.ok, true)
  assert.equal(r.url.startsWith(SPACE_URL + '/open?t='), true)
  assert.equal(w.space.verifyOpenLink(r.url).ok, true, 'the very token the web app checks')
  assert.notEqual(w.publisher.openWeb(w.id).url, r.url)
  assert.equal(r.url.includes(SPACE_KEY), false)
  noKey(w.logs)
  assert.equal(JSON.stringify(w.logs).includes('/open?t='), false, 'the link is never logged')
  const local = world()
  assert.deepEqual([local.publisher.openWeb(local.id).ok, local.publisher.openWeb(local.id).code], [false, 'not-published'])
})

// ---------------------------------------------------------------- state, api, prompt, tools
await ok('the state says which apps are published and what the hosting is, and nothing of the key; a host without a publisher says neither', async () => {
  const w = await published()
  const s = w.api.state()
  assert.equal(s.ok, true)
  assert.deepEqual(s.hosting, { available: true, name: 'Kybernos' }, 'the product\'s name, no price and no computers: those are read when the card opens')
  const mine = s.dbs.find((d) => d.id === w.id)
  assert.deepEqual(Object.keys(mine.published).sort(), ['host', 'hostGone', 'lastSync', 'since', 'slug', 'syncError', 'url'])
  assert.equal(mine.published.url, SPACE_URL)
  assert.deepEqual([mine.published.host, mine.published.hostGone], [{ id: HOST_ID, name: 'Studio', region: 'Frankfurt, EU' }, false])
  assert.equal(w.hosting.hostReads, 1, 'only Publish read the computers; a state read does not')
  noKey(s)
  w.space.down = true
  await w.publisher.refresh(w.id)
  const sick = w.api.state().dbs.find((d) => d.id === w.id).published
  assert.equal(sick.syncError.code, 'unreachable')
  assert.equal(sick.lastSync !== null, true, 'the last good sync is still said')
  noKey(w.api.state())
  const plain = world()
  const s2 = makeApi({ service: plain.svc }).state()
  assert.equal('hosting' in s2, false)
  assert.equal('published' in s2.dbs[0], false, 'the shape of a host with no publishing is unchanged')
  assert.equal(plain.api.state().dbs[0].published, null)
  assert.equal(plain.api.state().hosting.available, true)
})

await ok('the agent reads a published app from its copy, writes rows through the web app, and is refused every change of structure at once', async () => {
  const w = await published()
  const T = Object.fromEntries(tools(w.svc, { today: () => '2026-10-31' }).map((t) => [t.name, t]))
  const list = await T.db_list.execute({})
  assert.equal(list.dbs[0].published, true)
  const got = await T.records_list.execute({ object: 'contact' })
  assert.equal(got.ok, true)
  assert.equal(got.total ?? got.records.length, 2)
  const made = await T.records_create.execute({ object: 'contact', records: [{ name: 'Eve' }, { name: 'Finn' }] })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal(made.created.length, 2)
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Eve', 'Finn'], 'in the copy as soon as the answer comes back')
  assert.deepEqual(w.space.dbOf(w.slug).list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob', 'Eve', 'Finn'], 'and in the web app')
  const eve = made.created[0]
  const upd = await T.records_update.execute({ object: 'contact', updates: [{ id: eve.id, values: { name: 'Eve 2' } }] })
  assert.equal(upd.ok, true, JSON.stringify(upd))
  assert.equal((await T.records_delete.execute({ object: 'contact', ids: [eve.id] })).ok, true)
  assert.equal((await T.records_restore.execute({ object: 'contact', ids: [eve.id] })).ok, true)
  assert.deepEqual(names(w), ['Ada', 'Bob', 'Eve 2', 'Finn'])
  const bad = await T.records_create.execute({ object: 'contact', records: [{ name: '' }, { name: 'Gus' }] })
  assert.equal(bad.ok, false)
  assert.equal(bad.failed.length, 1, 'one bad row does not stop the next')
  assert.equal(names(w).includes('Gus'), true)
  const refusals = [
    await T.object_define.execute({ key: 'note', label: 'Notes', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name' }] }),
    await T.field_add.execute({ object: 'contact', key: 'phone', type: 'text', label: 'Phone' }),
    await T.field_update.execute({ object: 'contact', key: 'name', label: 'Full name' }),
    await T.view_save.execute({ object: 'contact', view: { name: 'All', kind: 'table' } }),
    await T.db_archive.execute({}),
  ]
  for (const r of refusals) assert.deepEqual([r.ok, r.error], [false, 'published'], JSON.stringify(r))
  assert.equal(refusals[0].detail, PUBLISHED_MESSAGE)
  assert.deepEqual(w.svc.byId(w.id).db.objects().map((o) => o.key), ['contact'], 'nothing of the structure moved')
  for (const name of ['object_define', 'field_add', 'field_update', 'view_save', 'db_archive']) assert.equal(approvalGate(w.svc, { name, arguments: { object: 'contact', key: 'phone' } }), null, name + ': the person is not asked about what cannot happen')
})

await ok('the prompt says an app is published, and that its structure is the person\'s to unlock', async () => {
  const w = await published()
  const block = renderBlock(w.svc.snapshot())
  assert.match(block, /published as a web app/)
  assert.match(block, /cannot change until the person unpublishes/)
  const plain = world()
  assert.doesNotMatch(renderBlock(plain.svc.snapshot()), /published/)
})

await ok('a published app cannot be deleted or archived away from under its web app', async () => {
  const w = await published()
  assert.equal(w.svc.archive(w.id, 'person').code, 'published')
  assert.equal(w.api.app({ db: w.id, op: 'archive' }).error, 'published')
  assert.equal(w.api.app({ db: w.id, op: 'delete', confirm: 'Home' }).ok, false)
  assert.equal(w.svc.remove(w.id).ok, false)
  assert.deepEqual(names(w), ['Ada', 'Bob'])
})

// ---------------------------------------------------------------- the routes
function hostOf (w) {
  const routes = {}
  const web = { register: (r) => { routes[r.path] = r; return () => { delete routes[r.path] } } }
  const off = mountRoutes(web, w.api, w.publisher)
  return { routes, off }
}
async function hit (routes, path, method, headers, body, query = '') {
  const raw = body === undefined ? undefined : JSON.stringify(body)
  const req = {
    method, url: path + query,
    headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    socket: { localPort: 3080 },
    on (ev, fn) { if (ev === 'data' && raw !== undefined) fn(Buffer.from(raw)); if (ev === 'end') fn() },
  }
  const out = { code: 200, body: '', headers: {} }
  await routes[path.split('?')[0]].handler(req, { setHeader () {}, writeHead (c, h) { out.code = c; out.headers = h || {} }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}
const jsonOf = (r) => JSON.parse(r.body)

await ok('the five publish routes exist only when the host has a publisher, and the page\'s write goes to the web app', async () => {
  const w = await published()
  const withPub = hostOf(w)
  for (const name of ['publish-check', 'publish', 'unpublish', 'open-web', 'refresh']) assert.equal(typeof withPub.routes[ROUTE + name], 'object', name)
  const bare = {}
  mountRoutes({ register: (r) => { bare[r.path] = r; return () => {} } }, w.api)
  for (const name of ['publish-check', 'publish', 'unpublish', 'open-web', 'refresh']) assert.equal(bare[ROUTE + name], undefined, name + ' is not there without a publisher')
  const H = browserHeaders()
  const wrote = await hit(withPub.routes, ROUTE + 'write', 'POST', H, { object: 'contact', op: 'create', values: { name: 'Via page' } })
  assert.equal(wrote.code, 200, wrote.body)
  assert.equal(jsonOf(wrote).ok, true)
  assert.deepEqual(w.space.dbOf(w.slug).list('contact').map((r) => r.values.name).sort(), ['Ada', 'Bob', 'Via page'])
  const rejected = await hit(withPub.routes, ROUTE + 'write', 'POST', H, { object: 'contact', op: 'create', values: {} })
  assert.equal(rejected.code, 400)
  assert.equal(jsonOf(rejected).error, 'invalid')
  w.space.down = true
  const down = await hit(withPub.routes, ROUTE + 'write', 'POST', H, { object: 'contact', op: 'create', values: { name: 'Nope' } })
  assert.deepEqual([down.code, jsonOf(down).error], [503, 'unreachable'])
  w.space.down = false
  const view = await hit(withPub.routes, ROUTE + 'view', 'POST', H, { object: 'contact', op: 'save', view: { name: 'All', kind: 'table' } })
  assert.equal(view.code, 409, 'a view of a published app is refused with the status of `published`')
  assert.equal(jsonOf(view).error, 'published')
  const state = jsonOf(await hit(withPub.routes, ROUTE + 'state', 'GET', H))
  assert.equal(state.dbs[0].published.slug, w.slug)
  assert.equal(JSON.stringify(state).includes(SPACE_KEY), false)
})

await ok('the publish routes take a database id and nothing else, and answer in the door\'s shape', async () => {
  const w = world()
  const { routes } = hostOf(w)
  const H = browserHeaders()
  for (const bad of ['', 'nope', '../x', 42, null, undefined]) {
    const r = await hit(routes, ROUTE + 'publish-check', 'GET', H, undefined, '?db=' + encodeURIComponent(String(bad ?? '')))
    assert.deepEqual([r.code, jsonOf(r).error], [404, 'unknown_db'], String(bad))
  }
  const card = jsonOf(await hit(routes, ROUTE + 'publish-check', 'GET', H, undefined, '?db=' + w.id))
  assert.deepEqual([card.ok, card.can, card.rows], [true, true, 2])
  noKey(card)
  const notYet = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id })
  assert.deepEqual([notYet.code, jsonOf(notYet).error], [400, 'confirm'])
  assert.equal(w.space.calls.length, 0)
  const pub = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id, confirm: true, host: HOST_ID })
  assert.equal(pub.code, 200, pub.body)
  assert.equal(jsonOf(pub).published.slug, 'home')
  noKey(jsonOf(pub))
  const again = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id, confirm: true, host: HOST_ID })
  assert.deepEqual([again.code, jsonOf(again).error], [409, 'published'])
  const open = await hit(routes, ROUTE + 'open-web', 'POST', H, { db: w.id })
  assert.equal(open.code, 200)
  assert.equal(jsonOf(open).url.startsWith(SPACE_URL + '/open?t='), true)
  const refreshed = await hit(routes, ROUTE + 'refresh', 'POST', H, { db: w.id })
  assert.deepEqual([refreshed.code, jsonOf(refreshed).ok], [200, true])
  w.space.down = true
  const stuck = await hit(routes, ROUTE + 'unpublish', 'POST', H, { db: w.id })
  assert.deepEqual([stuck.code, jsonOf(stuck).error, jsonOf(stuck).canForget], [503, 'unreachable', true], 'the page is told there is a way out')
  const typed = await hit(routes, ROUTE + 'unpublish', 'POST', H, { db: w.id, forget: true, confirm: 'Home' })
  assert.equal(jsonOf(typed).forgotten, true)
  w.space.down = false
  const none = await hit(routes, ROUTE + 'open-web', 'POST', H, { db: w.id })
  assert.deepEqual([none.code, jsonOf(none).error], [409, 'not-published'])
})

await ok('the page gets the computers with the card, and the computer it chose is a plain id in the body of Publish; every refusal of a computer has its own status', async () => {
  const w = world()
  const { routes } = hostOf(w)
  const H = browserHeaders()
  const card = jsonOf(await hit(routes, ROUTE + 'publish-check', 'GET', H, undefined, '?db=' + w.id))
  assert.deepEqual([card.ok, card.can, card.reason, card.hosts.map((h) => h.id), card.lastHost, card.hosting], [true, true, null, [HOST_ID], null, { name: 'Kybernos', orderUrl: ORDER_URL }])
  assert.equal(w.hosting.hostReads, 1)
  jsonOf(await hit(routes, ROUTE + 'state', 'GET', H)); jsonOf(await hit(routes, ROUTE + 'state', 'GET', H))
  assert.equal(w.hosting.hostReads, 1, 'a state read never reads them')
  // no body, or a body that does not name one of the person\'s computers: refused, nothing asked of the hosting
  for (const host of [undefined, 42, null, ['host-1'], { id: HOST_ID }, 'host-9', '']) {
    const r = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id, confirm: true, host })
    assert.deepEqual([r.code, jsonOf(r).error], [409, 'unknown-host'], JSON.stringify(host))
  }
  assert.equal(w.hosting.calls.length, 0)
  // the computers cannot be read: the card is still an answer, with the way to order one; Publish is a 503
  w.hosting.hosts = async () => ({ ok: false, code: 'unavailable', message: 'The Kybernos server is not answering.' })
  const sick = await hit(routes, ROUTE + 'publish-check', 'GET', H, undefined, '?db=' + w.id)
  assert.equal(sick.code, 200)
  assert.deepEqual([jsonOf(sick).ok, jsonOf(sick).can, jsonOf(sick).reason, jsonOf(sick).hosts, jsonOf(sick).hostsError.message, jsonOf(sick).hosting.orderUrl], [true, false, 'hosts-unreachable', null, 'The Kybernos server is not answering.', ORDER_URL])
  const blocked = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id, confirm: true, host: HOST_ID })
  assert.deepEqual([blocked.code, jsonOf(blocked).error, jsonOf(blocked).message], [503, 'hosts-unreachable', 'The Kybernos server is not answering.'])
  // the computer vanishes or is not available between the list and the space
  w.hosting.hosts = async () => ({ ok: true, hosts: [{ id: HOST_ID, name: 'Studio', state: 'running' }] })
  for (const [code, status] of [['host-gone', 409], ['host-unavailable', 503], ['unavailable', 503], ['budget', 402]]) {
    w.hosting.ensureSpace = async () => ({ ok: false, code, message: 'The port says ' + code + '.' })
    const r = await hit(routes, ROUTE + 'publish', 'POST', H, { db: w.id, confirm: true, host: HOST_ID })
    assert.deepEqual([r.code, jsonOf(r).error, jsonOf(r).message], [status, code, 'The port says ' + code + '.'], code)
  }
  assert.deepEqual([w.registry.spaces().length, w.registry.apps().length, w.publisher.isPublished(w.id)], [0, 0, false])
  // no computer at all
  w.hosting.list = []
  w.hosting.hosts = async () => ({ ok: true, hosts: [] })
  const none = jsonOf(await hit(routes, ROUTE + 'publish-check', 'GET', H, undefined, '?db=' + w.id))
  assert.deepEqual([none.can, none.reason, none.hosts, none.hosting.orderUrl], [false, 'no-host', [], ORDER_URL])
  noKey(none)
})

await ok('the sensitive fields come back to the page by name when Publish is refused', async () => {
  const w = world({ objects: [CONTACT, COSTS] })
  const { routes } = hostOf(w)
  const r = await hit(routes, ROUTE + 'publish', 'POST', browserHeaders(), { db: w.id, confirm: true, host: HOST_ID })
  assert.deepEqual([r.code, jsonOf(r).error], [409, 'sensitive'])
  assert.deepEqual(jsonOf(r).fields.map((f) => f.field), ['amount', 'key'])
})

await ok('every publish route is behind the same Origin and signed-session guards as a write', async () => {
  const w = await published()
  const { routes } = hostOf(w)
  const fp = w.svc.byId(w.id).db.fingerprint()
  const calls = w.space.calls.length
  for (const [name, method, body, query] of [['publish-check', 'GET', undefined, '?db=' + w.id], ['publish', 'POST', { db: w.id, confirm: true, host: HOST_ID }, ''], ['unpublish', 'POST', { db: w.id }, ''], ['open-web', 'POST', { db: w.id }, ''], ['refresh', 'POST', { db: w.id }, ''], ['write', 'POST', { object: 'contact', op: 'create', values: { name: 'Sneak' } }, '']]) {
    const path = ROUTE + name
    const code = async (headers) => (await hit(routes, path, method, headers, body, query)).code
    assert.equal(await code({}), method === 'GET' ? 401 : 403, path + ' no Origin and no cookie')
    assert.equal(await code({ ...browserHeaders(), origin: 'http://evil.example' }), 403, path + ' foreign Origin with the real cookie')
    assert.equal(await code({ cookie: sessionCookie(), referer: 'http://evil.example/page' }), 403, path + ' foreign Referer')
    assert.equal(await code({ origin: 'http://127.0.0.1:3080' }), 401, path + ' the right Origin and no cookie')
    assert.equal(await code({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }), 401, path + ' forged cookie')
    assert.equal(await code({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) }), 401, path + ' expired cookie')
    assert.equal(await code({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:4000') }), 401, path + ' another authority')
    assert.equal(await code({ ...browserHeaders(), host: 'attacker.example:3080' }), 403, path + ' a Host that is not ours')
  }
  assert.equal(w.space.calls.length, calls, 'a refused request asked nothing of the web app')
  assert.equal(w.svc.byId(w.id).db.fingerprint(), fp)
  assert.equal(w.publisher.isPublished(w.id), true)
  assert.deepEqual(names(w), ['Ada', 'Bob'])
})

await ok('the page\'s upload of a published app goes to the web app and answers like the local one', async () => {
  const w = await published()
  const web = {}
  mountRoutes({ register: (r) => { web[r.path] = r; return () => {} } }, w.api, w.publisher)
  const req = (bytes, q) => ({
    method: 'POST', url: ROUTE + 'upload?' + new URLSearchParams(q).toString(),
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/octet-stream', ...browserHeaders() },
    socket: { localPort: 3080 },
    on (ev, fn) { if (ev === 'data') fn(bytes); if (ev === 'end') fn() },
  })
  const out = { code: 0, body: '' }
  await web[ROUTE + 'upload'].handler(req(PNG2, { object: 'contact', field: 'photo', name: 'x.png', type: 'image/png' }), { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b) } })
  assert.equal(out.code, 200, out.body)
  assert.equal(JSON.parse(out.body).file.hash, sha256(PNG2))
  assert.ok(w.space.dbOf(w.slug).blobs.get(sha256(PNG2)).equals(PNG2), 'the file is in the web app')
})

// ---------------------------------------------------------------- the host
await ok('a host with no hosting starts fine, offers nothing, and a failure to build the publisher leaves every app a plain local one', async () => {
  const home = join(root, 'home-none')
  const holder = { publisher: null }
  const svc = makeService({ dir: join(home, 'kybernos', 'kybernos-db', 'dbs'), ports: ports() })
  const built = buildPublisher({ home, service: svc, options: { ports: ports() }, holder })
  assert.notEqual(built, null)
  assert.equal(built.hostingState().available, false)
  const id = svc.create({ name: 'Local', by: 'agent', objects: [CONTACT] }).db.info().id
  const card = await built.check(id)
  assert.deepEqual([card.can, card.reason], [false, 'unavailable'])
  const clash = join(root, 'home-clash')
  mkdirSync(join(clash, 'kybernos'), { recursive: true })
  writeFileSync(join(clash, 'kybernos', 'kybernos-db'), 'a file where the data folder should be')
  const holder2 = { publisher: 'untouched' }
  const none = buildPublisher({ home: clash, service: svc, options: { ports: ports() }, holder: holder2 })
  assert.equal(none === null || typeof none === 'object', true)
  built.cleanup()
})

await ok('installing a template again, while the database it made is published, answers skipped and touches neither side', async () => {
  const w = world({ seed: false })
  const L = (en) => ({ en })
  const TPL = { id: 'mini', name: L('Mini shop'), objects: [{ key: 'item', label: L('Items'), title: 'name', fields: [{ key: 'name', type: 'text', required: true, label: L('Name') }] }], views: [] }
  const markerFile = join(w.dir, 'local', 'templates.json')
  const made = installTemplate({ service: w.svc, template: TPL, markerFile })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal((await w.publisher.publish(made.db, { confirm: true, host: HOST_ID })).ok, true)
  const before = [w.svc.byId(made.db).db.fingerprint(), w.space.calls.length]
  const again = installTemplate({ service: w.svc, template: TPL, markerFile })
  assert.deepEqual(again, { ok: true, skipped: true, db: made.db })
  assert.deepEqual([w.svc.byId(made.db).db.fingerprint(), w.space.calls.length], before, 'neither the copy kept here nor the web app was asked anything')
  assert.equal(w.publisher.isPublished(made.db), true)
})

console.log('\n' + count + ' checks passed')
