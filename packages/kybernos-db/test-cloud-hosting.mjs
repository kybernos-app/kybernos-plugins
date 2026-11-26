// test-cloud-hosting.mjs — the real hosting port (remote/cloud-hosting.mjs): the person's cloud computers reached through the cloud bundle's seam, with a fake seam standing for the
// server. What is proven: nothing is offered without a seam, an account or an active workspace; `available()` believes only a read that worked and asks again later; the computers are
// told in the port's words; `ensureSpace` asks again while the server says "starting", gives up after a while, and turns each refusal into one of the codes the page knows with a message
// of our own; a frozen space is not handed out; `releaseSpace` forgets nothing it is not sure of; and the seam is only ever called for the three team-space routes.
import assert from 'node:assert/strict'
import { VERDICT_NO_MS, VERDICT_OK_MS, VERDICT_RETRY_MS, cloudHosting, refusalOf } from './remote/cloud-hosting.mjs'
import { chooseHosting } from './index.js'
import { describeHosting, readHosts } from './remote/hosting.mjs'
import { makePublisher } from './remote/publisher.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const KEY = 'ab'.repeat(32)
const WS = 'ws_main'
const ORDER = 'https://kybernos.example.test/console/computers'
const clock = { t: Date.UTC(2026, 9, 31, 12, 0, 0) }
const now = () => clock.t

/** A seam in the shape the cloud bundle publishes, over a table of answers: `calls` is every call it received. */
function fakeSeam (answer, { workspace = WS } = {}) {
  const calls = []
  const state = { workspace }
  return {
    calls,
    state,
    seam: Object.freeze({
      version: 1,
      workspace: () => state.workspace,
      call: async (path, options) => {
        calls.push({ path, method: options?.method, body: options?.body })
        return typeof answer === 'function' ? answer(path, options, calls.length) : answer
      },
    }),
  }
}
const hostRow = (o = {}) => ({ id: 'srv_1', name: 'Studio', state: 'running', region: 'fra', region_label: 'Frankfurt, EU', always_on: false, shared: true, space: null, ...o })
const hostsAnswer = (hosts = [hostRow()], order = ORDER) => ({ status: 200, body: { hosts, order_url: order } })
const space = (o = {}) => ({ id: 'sp_1', url: 'https://sp1.kaby.test', boot_key: KEY, name: 'Team space', region: 'fra', region_label: null, always_on: false, host_id: 'srv_1', ...o })
const ready = (o = {}) => ({ status: 200, body: { ready: true, state: 'active', frozen: false, retry_after_seconds: null, space: space(), ...o } })
const starting = (secs = 3) => ({ status: 202, body: { ready: false, state: 'creating', frozen: false, retry_after_seconds: secs } })
const make = (answer, opts = {}) => {
  const f = fakeSeam(answer, opts)
  const waits = []
  const h = cloudHosting({ seam: () => f.seam, now, wait: async (ms) => { waits.push(ms); clock.t += ms }, ensureMaxMs: opts.ensureMaxMs })
  return { ...f, h, waits }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

await ok('without a seam, with a seam that is not the cloud bundle\'s, or signed out: nothing is offered and nothing is asked', async () => {
  const none = cloudHosting({ seam: () => undefined, now })
  assert.equal(none.available(), false)
  assert.deepEqual(await none.hosts(), { ok: false, code: 'unavailable', message: 'Sign in to your Kybernos account to publish.' })
  assert.equal((await none.ensureSpace({ host: 'srv_1' })).code, 'unavailable')
  assert.deepEqual(await none.releaseSpace('sp_1'), { ok: false })
  const old = cloudHosting({ seam: () => ({ version: 1, call: async () => ({ status: 200, body: {} }) }), now })
  assert.equal(old.available(), false, 'a seam from before workspace() has no active workspace to name')
  const out = make(hostsAnswer(), { workspace: null })
  assert.equal(out.h.available(), false)
  assert.equal((await out.h.hosts()).code, 'unavailable')
  assert.equal(out.calls.length, 0, 'signed out: no call is made')
  const thrower = cloudHosting({ seam: () => { throw new Error('boom') }, now })
  assert.equal(thrower.available(), false)
  for (const bad of ['', 'a b', '../x', 'x'.repeat(65), 12, null]) assert.equal(make(hostsAnswer(), { workspace: bad }).h.available(), false, String(bad))
})

await ok('available(): "no" at first, a read starts in the background, "yes" once it worked, and the verdict is believed for a while', async () => {
  const t = make(hostsAnswer())
  assert.equal(t.h.available(), false, 'a first look cannot know')
  await tick()
  assert.deepEqual(t.calls.map((c) => [c.method, c.path]), [['GET', '/v1/workspaces/ws_main/team-space/hosts']])
  assert.equal(t.h.available(), true)
  assert.equal(t.h.available(), true)
  assert.equal(t.calls.length, 1, 'asked once, believed after')
  clock.t += VERDICT_OK_MS + 1
  assert.equal(t.h.available(), true, 'an aged yes is still a yes while it is asked again')
  await tick()
  assert.equal(t.calls.length, 2)
})

await ok('available(): a server without the routes, with hosting switched off, or a member who may not publish is "no" for a while, then asked again', async () => {
  for (const [status, body] of [[404, { error: 'not_found' }], [403, { error: 'forbidden' }], [503, { error: 'teamspace_disabled' }]]) {
    const t = make({ status, body })
    t.h.available()
    await tick()
    assert.equal(t.h.available(), false, String(status))
    t.h.available()
    await tick()
    assert.equal(t.calls.length, 1, 'believed for ' + VERDICT_NO_MS + ' ms: ' + status)
    clock.t += VERDICT_NO_MS + 1
    t.h.available()
    await tick()
    assert.equal(t.calls.length, 2, 'asked again later: ' + status)
  }
})

await ok('available(): an answer that proves nothing (network, busy, signed-out account) keeps what was known and asks again after a minute', async () => {
  let up = true
  const t = make(() => (up ? hostsAnswer() : { status: 0, body: null, error: 'fetch failed' }))
  t.h.available()
  await tick()
  assert.equal(t.h.available(), true)
  clock.t += VERDICT_OK_MS + 1
  up = false
  t.h.available()
  await tick()
  assert.equal(t.h.available(), true, 'one failed read does not take Publish away')
  assert.equal(t.calls.length, 2)
  t.h.available()
  await tick()
  assert.equal(t.calls.length, 2, 'not again before a minute')
  clock.t += VERDICT_RETRY_MS + 1
  t.h.available()
  await tick()
  assert.equal(t.calls.length, 3)
  const down = make({ status: 0, body: null, error: 'fetch failed' })
  down.h.available()
  await tick()
  assert.equal(down.h.available(), false, 'never known: no')
})

await ok('available(): a verdict belongs to one workspace; switching workspace starts again', async () => {
  const t = make(hostsAnswer())
  t.h.available()
  await tick()
  assert.equal(t.h.available(), true)
  t.state.workspace = 'ws_other'
  assert.equal(t.h.available(), false, 'what the server said of another team says nothing of this one')
  await tick()
  assert.equal(t.calls.at(-1).path, '/v1/workspaces/ws_other/team-space/hosts')
  assert.equal(t.h.available(), true)
})

await ok('only one background read runs at a time', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const t = make(async () => { await gate; return hostsAnswer() })
  for (let i = 0; i < 5; i++) t.h.available()
  await tick()
  assert.equal(t.calls.length, 1)
  release()
  await tick()
  await tick()
  assert.equal(t.h.available(), true)
})

await ok('hosts(): the computers in the port\'s words, the region as the server labels it, and the order address kept for describe()', async () => {
  const t = make(hostsAnswer([
    hostRow(),
    hostRow({ id: 'srv_2', name: 'Always on', state: 'sleeping', region: 'ams', region_label: null, always_on: true, shared: true }),
    hostRow({ id: 'srv_3', state: 'starting', always_on: 'yes', shared: 1 }),
  ]))
  const r = await readHosts(t.h)
  assert.equal(r.ok, true)
  assert.deepEqual(r.hosts.map((h) => [h.id, h.name, h.state, h.region, h.alwaysOn, h.shared]), [
    ['srv_1', 'Studio', 'running', 'Frankfurt, EU', false, true],
    ['srv_2', 'Always on', 'sleeping', 'ams', true, true],
    ['srv_3', 'Studio', 'starting', 'Frankfurt, EU', false, false],
  ], 'alwaysOn and shared are true only when the server said true')
  assert.equal(describeHosting(t.h).name, 'Kybernos')
  assert.equal(describeHosting(t.h).orderUrl, ORDER)
  assert.equal(JSON.stringify(r).includes('space'), false, 'the space a computer holds is not part of the port\'s Host')
})

await ok('hosts(): an empty list is an answer; an order address that is not https is no address; describe() of another workspace shows none', async () => {
  const t = make(hostsAnswer([], 'http://kybernos.example.test/computers'))
  assert.deepEqual(await t.h.hosts(), { ok: true, hosts: [] })
  assert.equal(describeHosting(t.h).orderUrl, '')
  const u = make(hostsAnswer([], null))
  await u.h.hosts()
  assert.equal(describeHosting(u.h).orderUrl, '')
  const v = make(hostsAnswer())
  await v.h.hosts()
  assert.equal(describeHosting(v.h).orderUrl, ORDER)
  v.state.workspace = 'ws_other'
  assert.equal(describeHosting(v.h).orderUrl, '')
})

await ok('hosts(): a refusal is told in our words, never the server\'s', async () => {
  const cases = [
    [{ status: 0, body: null, error: 'not_connected' }, 'unavailable', /Sign in/],
    [{ status: 0, body: null, error: 'fetch failed', server: { name: 'x', host: 'h' } }, 'hosting-failed', /connection/],
    [{ status: 401, body: { error: 'unauthorized', message: 'SECRET SERVER WORDS' } }, 'unavailable', /session ended/],
    [{ status: 403, body: { error: 'forbidden', message: 'SECRET SERVER WORDS' } }, 'forbidden', /owner or an admin/],
    [{ status: 404, body: { error: 'not_found' } }, 'unavailable', /does not host/],
    [{ status: 503, body: { error: 'teamspace_disabled' } }, 'unavailable', /switched off/],
    [{ status: 429, body: { error: 'rate_limited' } }, 'hosting-failed', /busy/],
    [{ status: 500, body: { error: 'internal', message: 'SECRET SERVER WORDS' } }, 'hosting-failed', /Try again later/],
    [{ status: 200, body: { hosts: 'nope' } }, 'hosting-failed', /Try again later/],
    [null, 'hosting-failed', /connection/],
  ]
  for (const [answer, code, message] of cases) {
    const t = make(answer)
    const r = await t.h.hosts()
    assert.equal(r.ok, false)
    assert.equal(r.code, code, JSON.stringify(answer))
    assert.match(r.message, message)
    assert.equal(r.message.includes('SECRET'), false)
    assert.ok(r.message.length <= 300)
    const read = await readHosts(t.h)
    assert.equal(read.code, 'hosts-unreachable', 'the plugin folds any refusal of the list into one code and keeps the message')
    assert.equal(read.message, r.message)
  }
})

await ok('ensureSpace(): a ready space is handed over as { id, url, bootKey }, after one POST naming the computer', async () => {
  const t = make(ready())
  const r = await t.h.ensureSpace({ host: 'srv_1' })
  assert.deepEqual(r, { ok: true, space: { id: 'sp_1', url: 'https://sp1.kaby.test', bootKey: KEY } })
  assert.deepEqual(t.calls, [{ path: '/v1/workspaces/ws_main/team-space', method: 'POST', body: { host: 'srv_1' } }])
  assert.equal(t.waits.length, 0)
  assert.equal(JSON.stringify(Object.keys(r.space)), '["id","url","bootKey"]', 'nothing else of the server\'s answer travels on')
})

await ok('ensureSpace(): while the server says "starting" it asks again after the time it names (bounded), then hands the space over', async () => {
  let n = 0
  const asked = [3, null, 500]
  const t = make(() => (++n < 4 ? starting(asked[n - 1]) : ready()))
  const r = await t.h.ensureSpace({ host: 'srv_1' })
  assert.equal(r.ok, true)
  assert.equal(t.calls.length, 4)
  assert.deepEqual(t.waits, [3000, 5000, 30000], '3 s as told, 5 s when it did not say, 30 s at most (500 s asked)')
  assert.equal(clock.t > 0, true)
  const quick = make((() => { let k = 0; return () => (++k < 2 ? starting(0) : ready()) })())
  await quick.h.ensureSpace({ host: 'srv_1' })
  assert.deepEqual(quick.waits, [2000], 'zero seconds is two: the server is not hammered')
})

await ok('ensureSpace(): it gives up after the time it was given, with a message that says to try again', async () => {
  const t = make(starting(10), { ensureMaxMs: 25 * 1000 })
  const r = await t.h.ensureSpace({ host: 'srv_1' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'host-unavailable')
  assert.match(r.message, /taking too long/)
  assert.equal(t.calls.length, 3, '0 s, 10 s, 20 s; the next wait would pass the limit')
})

await ok('ensureSpace(): a ready answer that is not usable is a failure, and a frozen space is not handed out', async () => {
  for (const body of [{ ready: true, space: null }, { ready: true, space: { id: 'sp_1', url: 'https://x.test' } }, { ready: true, space: { id: 4, url: 'u', boot_key: 'k' } }, null]) {
    const r = await make({ status: 200, body }).h.ensureSpace({ host: 'srv_1' })
    assert.equal(r.ok, false, JSON.stringify(body))
    assert.equal(r.code, 'hosting-failed')
  }
  const f = await make(ready({ frozen: true })).h.ensureSpace({ host: 'srv_1' })
  assert.deepEqual([f.ok, f.code], [false, 'host-unavailable'])
  assert.match(f.message, /read-only/)
  assert.equal(JSON.stringify(f).includes(KEY), false, 'the key is not in a refusal')
})

await ok('ensureSpace(): each refusal of the server is one of the codes the page knows, with our own message', async () => {
  const cases = [
    [{ status: 404, body: { error: 'unknown_host', message: 'SECRET' } }, 'unknown-host'],
    [{ status: 409, body: { error: 'host_gone' } }, 'host-gone'],
    [{ status: 409, body: { error: 'host_unavailable' } }, 'host-unavailable'],
    [{ status: 409, body: { error: 'budget_exhausted' } }, 'budget'],
    [{ status: 409, body: { error: 'host_required' } }, 'unknown-host'],
    [{ status: 409, body: { error: 'something_new' } }, 'hosting-failed'],
    [{ status: 503, body: { error: 'teamspace_disabled' } }, 'unavailable'],
    [{ status: 503, body: { error: 'keys_unreadable' } }, 'hosting-failed'],
    [{ status: 403, body: { error: 'forbidden' } }, 'forbidden'],
    [{ status: 0, body: null, error: 'workspace_refused' }, 'hosting-failed'],
  ]
  for (const [answer, code] of cases) {
    const r = await make(answer).h.ensureSpace({ host: 'srv_1' })
    assert.deepEqual([r.ok, r.code], [false, code], JSON.stringify(answer))
    assert.equal(r.message.includes('SECRET'), false)
    assert.equal(typeof r.message, 'string')
  }
  assert.match((await make({ status: 0, body: null, error: 'workspace_refused' }).h.ensureSpace({ host: 'srv_1' })).message, /workspace changed/)
})

await ok('ensureSpace(): a refusal while it was asking again ends the wait at once; a seam that throws is a failure, not a throw', async () => {
  let n = 0
  const t = make(() => (++n === 1 ? starting(3) : { status: 409, body: { error: 'host_unavailable' } }))
  const r = await t.h.ensureSpace({ host: 'srv_1' })
  assert.deepEqual([r.ok, r.code, t.calls.length], [false, 'host-unavailable', 2])
  const boom = cloudHosting({ seam: () => ({ workspace: () => WS, call: async () => { throw new Error('boom') } }), now })
  assert.deepEqual((await boom.ensureSpace({ host: 'srv_1' })).code, 'hosting-failed')
  assert.deepEqual((await boom.hosts()).ok, false)
  assert.deepEqual(await boom.releaseSpace('sp_1'), { ok: false })
})

await ok('ensureSpace(): a computer id that is not an id is refused before anything is asked', async () => {
  const t = make(ready())
  for (const bad of [undefined, null, {}, { host: '' }, { host: 'a b' }, { host: '../x' }, { host: 7 }, { host: 'x'.repeat(65) }]) {
    const r = await t.h.ensureSpace(bad)
    assert.deepEqual([r.ok, r.code], [false, 'unknown-host'])
  }
  assert.equal(t.calls.length, 0)
})

await ok('releaseSpace(): DELETE with the space named; yes only when the server said it was released', async () => {
  const t = make({ status: 200, body: { released: true, state: 'released' } })
  assert.deepEqual(await t.h.releaseSpace('sp_1'), { ok: true })
  assert.deepEqual(t.calls, [{ path: '/v1/workspaces/ws_main/team-space?space=sp_1', method: 'DELETE', body: undefined }])
  for (const answer of [
    { status: 409, body: { error: 'apps_remain' } },
    { status: 404, body: { error: 'no_team_space' } },
    { status: 403, body: { error: 'forbidden' } },
    { status: 200, body: { released: false, state: 'gone' } },
    { status: 200, body: {} },
    { status: 0, body: null, error: 'fetch failed' },
    null,
  ]) assert.deepEqual(await make(answer).h.releaseSpace('sp_1'), { ok: false }, JSON.stringify(answer))
  const u = make({ status: 200, body: { released: true } })
  for (const bad of [undefined, '', 'a b', 'sp_1&x=1', 'sp_1/../x', 5]) assert.deepEqual(await u.h.releaseSpace(bad), { ok: false })
  assert.equal(u.calls.length, 0, 'an id that is not an id is never put in a path')
})

await ok('the seam is only called for the three team-space routes of the active workspace', async () => {
  const t = make((path) => (path.endsWith('/hosts') ? hostsAnswer() : path.includes('?space=') ? { status: 200, body: { released: true } } : ready()))
  await t.h.hosts()
  await t.h.ensureSpace({ host: 'srv_1' })
  await t.h.releaseSpace('sp_1')
  t.h.available()
  await tick()
  const shapes = new Set(t.calls.map((c) => c.method + ' ' + c.path.replace('ws_main', '<ws>').replace(/sp_1$/, '<space>')))
  assert.deepEqual([...shapes].sort(), ['DELETE /v1/workspaces/<ws>/team-space?space=<space>', 'GET /v1/workspaces/<ws>/team-space/hosts', 'POST /v1/workspaces/<ws>/team-space'])
})

await ok('refusalOf(): anything that is not an answer is a failure with a generic message', () => {
  for (const x of [undefined, null, 'x', 5, [], {}, { status: 'x' }, { status: 418, body: 'tea' }]) {
    const r = refusalOf(x)
    assert.equal(r.ok, false)
    assert.equal(typeof r.code, 'string')
    assert.equal(typeof r.message, 'string')
  }
})

await ok('chooseHosting(): given wins, then an environment pointed at one space, then the account\'s computers; it never throws', () => {
  const given = { available: () => true, describe: () => ({}), hosts: async () => ({ ok: true, hosts: [] }), ensureSpace: async () => null }
  assert.equal(chooseHosting(given, {}), given)
  const env = { KYBERNOS_DB_SPACE_URL: 'http://127.0.0.1:4100', KYBERNOS_DB_SPACE_KEY: KEY }
  assert.equal(chooseHosting(undefined, env, () => { throw new Error('the account hosting must not be built when the environment decides') }).available(), true)
  const fromCloud = { available: () => false }
  assert.equal(chooseHosting(undefined, {}, () => fromCloud), fromCloud, 'no environment: the account\'s computers')
  assert.equal(chooseHosting(undefined, {}, () => { throw new Error('boom') }).available(), false, 'a hosting that cannot be built is none')
  assert.equal(typeof chooseHosting(undefined, {}).hosts, 'function')
  assert.equal(chooseHosting(undefined, {}).available(), false, 'in a process with no cloud bundle nothing is offered')
})

await ok('the publisher uses it as any other hosting: no button until the server said yes, then the card, the computers and a publish up to the space', async () => {
  const t = make((path, o) => {
    if (path.endsWith('/hosts')) return hostsAnswer()
    if (o.method === 'POST') return ready()
    return { status: 200, body: { released: true } }
  })
  const seen = []
  const pub = makePublisher({ service: { raw: () => null }, registry: { published: () => false, space: () => null }, hosting: t.h, tmpRoot: '/nonexistent-never-written', ports: { now, store: {}, log: (m) => seen.push(m) } })
  assert.equal(pub.hostingState().available, false)
  await tick()
  assert.deepEqual(pub.hostingState(), { available: true, name: 'Kybernos' })
  assert.equal(describeHosting(t.h).orderUrl, ORDER)
})

console.log('\ncloud hosting: ' + count + ' checks passed')
