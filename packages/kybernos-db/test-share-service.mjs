// kybernos-db, sharing a dashboard from an agent: the service (check, file, publish, update, revoke) on a temp folder with a fake `snapshots` port, and the tool and its card.
//
//   node packages/kybernos-db/test-share-service.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NAMES, approvalGate, tools } from './agent/tools.mjs'
import { shareCard } from './agent/cards.mjs'
import { DASHBOARD, salesWorld } from './lib-share-test.mjs'
import { openSealed } from './share/seal.mjs'
import { makeSharing } from './share/service.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const NOW = Date.UTC(2026, 10, 2, 9)

const world = salesWorld()
function home (extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kb-share-home-'))
  const dashboardsDir = join(root, 'dashboards')
  mkdirSync(dashboardsDir, { recursive: true })
  writeFileSync(join(dashboardsDir, 'sales.miniapp.json'), JSON.stringify({ kind: 'dashboard', renderer: 'dashboard', title: 'Sales', data: [DASHBOARD], ...extra }))
  return { root, dashboardsDir, sharesDir: join(root, 'shares') }
}
/** A server that keeps what it is given and makes links: `calls` is what the plugin did. */
function fakeServer (limits) {
  const kept = new Map()
  const calls = []
  let n = 0
  return {
    kept,
    calls,
    limits: limits === undefined ? undefined : () => limits,
    async put (body) {
      calls.push({ op: 'put', ...body })
      if (body.id !== undefined && !kept.has(body.id)) return { ok: false, error: 'not_found', message: 'that link is gone' }
      const id = body.id !== undefined ? body.id : 's' + (++n).toString(36) + 'xyz'
      kept.set(id, body)
      return { ok: true, id, url: 'https://kaby.app/s/' + id, expires: '2027-01-31', bytes: body.text.length }
    },
    async remove (id) { calls.push({ op: 'remove', id }); return kept.delete(id) ? { ok: true } : { ok: false, error: 'not_found', message: 'gone' } },
  }
}
const make = (h, snapshots) => makeSharing({ api: world.api, dashboardsDir: h.dashboardsDir, sharesDir: h.sharesDir, snapshots, now: () => NOW })

await ok('the dashboards on this computer are listed; a missing, ambiguous or unknown one is said with the choices', () => {
  const h = home()
  const s = make(h)
  assert.deepEqual(s.dashboards(), [{ id: 'sales', name: 'Sales' }])
  assert.equal(s.check({}).ok, true, 'the only dashboard is the default')
  const none = makeSharing({ api: world.api, dashboardsDir: join(h.root, 'nothing'), sharesDir: h.sharesDir })
  assert.equal(none.check({}).error, 'no_dashboard')
  writeFileSync(join(h.dashboardsDir, 'other.miniapp.json'), JSON.stringify({ kind: 'dashboard', data: [{ ...DASHBOARD, name: 'Other' }] }))
  writeFileSync(join(h.dashboardsDir, 'broken.miniapp.json'), '{ not json')
  writeFileSync(join(h.dashboardsDir, 'Bad Name.miniapp.json'), JSON.stringify({ kind: 'dashboard', data: [DASHBOARD] }))
  const r = s.check({})
  assert.equal(r.error, 'which_dashboard')
  assert.deepEqual(r.dashboards.map((d) => d.id), ['other', 'sales'], 'a broken file and a name that is no id are not offered')
  assert.equal(s.check({ dashboard: 'nope' }).error, 'unknown_dashboard')
  assert.equal(s.check({ dashboard: '../etc/passwd' }).error, 'unknown_dashboard')
})

await ok('check says what is in, what is left out and why, the size, and whether a link can be made; it writes nothing', () => {
  const h = home()
  const r = make(h).check({ dashboard: 'sales' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.included.map((w) => w.id), ['revenue', 'orders', 'by-product', 'daily', 'mix', 'stacked', 'big', 'latest', 'note'])
  assert.deepEqual(r.withheld.map((w) => w.id), ['who', 'by-customer'])
  assert.deepEqual(r.left.map((w) => w.id), ['usage', 'board'])
  assert.equal(r.title, 'Sales')
  assert.ok(r.bytes > 3000 && r.bytes < 20000)
  assert.equal(r.link, 'unavailable')
  assert.throws(() => statSync(h.sharesDir), /ENOENT/, 'nothing was written')
  const withPort = make(h, fakeServer({ maxBytes: 3000, maxCount: 3, ttlDays: 90 }))
  assert.equal(withPort.check({ dashboard: 'sales' }).error, 'too_big', 'the server\'s own limit counts')
  const personal = make(h).check({ dashboard: 'sales', includePersonal: true })
  assert.deepEqual(personal.withheld, [])
  assert.ok(personal.included.some((w) => w.id === 'by-customer'))
})

await ok('a page to keep: written in the shares folder (mode 600), with the numbers; protected, it holds none of them and the password opens it', async () => {
  const h = home()
  const s = make(h)
  const open = await s.file({ dashboard: 'sales' })
  assert.equal(open.ok, true)
  assert.equal(open.protected, false)
  assert.equal(open.password, undefined)
  assert.ok(open.path.startsWith(h.sharesDir) && open.path.endsWith('sales-2026-11-02.html'))
  const html = readFileSync(open.path, 'utf8')
  assert.ok(html.startsWith('<!doctype html>') && html.includes('2,750'))
  assert.equal(statSync(open.path).mode & 0o777, 0o600)
  const shut = await s.file({ dashboard: 'sales', protect: true })
  assert.equal(shut.protected, true)
  assert.match(shut.password, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/)
  const sealed = readFileSync(shut.path, 'utf8')
  assert.equal(sealed.includes('2,750') || sealed.includes('Sales'), false)
  assert.equal(sealed.includes(shut.password), false, 'the password is not in the file')
  const env = JSON.parse(/id="kv-doc">([\s\S]*?)<\/script>/.exec(sealed)[1])
  assert.equal(JSON.parse(await openSealed(env, shut.password)).title, 'Sales')
  assert.throws(() => readFileSync(join(h.sharesDir, 'index.json'), 'utf8'), /ENOENT/, 'a page to keep is not tracked, so its password is nowhere')
})

await ok('without a port no link is offered and the answer points at the page to keep; nothing is stored', async () => {
  const h = home()
  const r = await make(h).publish({ dashboard: 'sales' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unavailable')
  assert.match(r.message, /file/)
  assert.deepEqual(make(h).list(), { ok: true, link: 'unavailable', shares: [] })
  assert.equal((await make(h).revoke({ share: 'x' })).error, 'unknown_share')
})

await ok('a link: the server gets the snapshot as text and nothing else, the answer gives the link, and the list remembers it without a password', async () => {
  const h = home()
  const server = fakeServer({ maxBytes: 1000000, maxCount: 20, ttlDays: 90 })
  const s = make(h, server)
  const r = await s.publish({ dashboard: 'sales' })
  assert.equal(r.ok, true)
  assert.match(r.url, /^https:\/\/kaby\.app\/s\/s1xyz$/)
  assert.equal(r.protected, false)
  assert.equal(r.password, undefined)
  assert.equal(r.renewed, false)
  assert.deepEqual(Object.keys(server.calls[0]).sort(), ['op', 'sealed', 'text'], 'a first link sends no id')
  const sent = JSON.parse(server.calls[0].text)
  assert.equal(sent.kind, 'kybernos-snapshot')
  assert.equal(server.calls[0].sealed, false)
  assert.equal(sent.widgets.length, 9)
  const list = s.list()
  assert.equal(list.link, 'available')
  assert.deepEqual(list.shares, [{ share: 's1xyz', url: 'https://kaby.app/s/s1xyz', dashboard: 'sales', title: 'Sales', protected: false, includePersonal: false, made: '2026-11-02', updated: '2026-11-02', expires: '2027-01-31' }])
})

await ok('a protected link: the server gets only ciphertext, the password comes once, and an update keeps the same link AND the same password', async () => {
  const h = home()
  const server = fakeServer()
  const s = make(h, server)
  const r = await s.publish({ dashboard: 'sales', protect: true })
  assert.equal(r.ok, true)
  assert.equal(r.protected, true)
  assert.ok(typeof r.password === 'string' && r.password.length === 23)
  const first = server.kept.get(r.share)
  assert.equal(first.sealed, true)
  assert.equal(first.text.includes('Sales') || first.text.includes('2,750'), false, 'the server holds nothing it can read')
  assert.equal(JSON.parse(await openSealed(JSON.parse(first.text), r.password)).title, 'Sales')
  assert.equal(JSON.stringify(s.list()).includes(r.password), false, 'a listing never shows a password')

  const again = await s.publish({ share: r.share })
  assert.equal(again.ok, true)
  assert.equal(again.renewed, true)
  assert.equal(again.share, r.share)
  assert.equal(again.password, undefined, 'the password is shown once, when it is made')
  assert.equal(server.calls[1].id, r.share)
  const second = server.kept.get(r.share)
  assert.notEqual(second.text, first.text, 'a new seal each time')
  assert.equal(JSON.parse(await openSealed(JSON.parse(second.text), r.password)).title, 'Sales', 'the readers\' password still opens it')
  assert.equal(s.list().shares.length, 1)
  assert.equal(statSync(join(h.sharesDir, 'index.json')).mode & 0o777, 0o600)
})

await ok('an update takes today\'s numbers: a new order shows in the link, and an update of a link the server lost says so', async () => {
  const h = home()
  const server = fakeServer()
  const s = make(h, server)
  const r = await s.publish({ dashboard: 'sales' })
  const before = JSON.parse(server.kept.get(r.share).text).widgets.find((w) => w.id === 'orders').data.text
  assert.equal(before, '60')
  const c = world.db.create('order', { ref: 'A-9999', product: 'mug', amount: 12, qty: 1, day: '2026-09-29' }, 'agent')
  assert.equal(c.ok, true)
  await s.publish({ share: r.share })
  assert.equal(JSON.parse(server.kept.get(r.share).text).widgets.find((w) => w.id === 'orders').data.text, '61')
  server.kept.delete(r.share)
  const lost = await s.publish({ share: r.share })
  assert.equal(lost.ok, false)
  assert.equal(lost.error, 'not_found')
  assert.equal((await s.publish({ share: 'unknown' })).error, 'unknown_share')
  await world.db.remove('order', c.record.id, 'agent')
})

await ok('limits: too many links, a snapshot over the server\'s size, a server that refuses or fails; none of these leaves a trace', async () => {
  const h = home()
  const server = fakeServer({ maxBytes: 1000000, maxCount: 1, ttlDays: 90 })
  const s = make(h, server)
  assert.equal((await s.publish({ dashboard: 'sales' })).ok, true)
  const more = await s.publish({ dashboard: 'sales' })
  assert.equal(more.error, 'too_many')
  assert.equal(more.shares.length, 1)
  assert.equal(server.calls.length, 1, 'the server was not asked')
  const small = make(home(), fakeServer({ maxBytes: 3000, maxCount: 5 }))
  assert.equal((await small.publish({ dashboard: 'sales' })).error, 'too_big')
  const refusing = make(home(), { put: async () => ({ ok: false, error: 'quota', message: 'the free plan keeps 3 links' }), remove: async () => ({ ok: true }) })
  const q = await refusing.publish({ dashboard: 'sales' })
  assert.deepEqual([q.ok, q.error, q.message], [false, 'quota', 'the free plan keeps 3 links'])
  assert.deepEqual(refusing.list().shares, [])
  const throwing = make(home(), { put: async () => { throw new Error('offline') }, remove: async () => ({ ok: true }) })
  assert.match((await throwing.publish({ dashboard: 'sales' })).message, /offline/)
  const garbage = make(home(), { put: async () => 'yes', remove: async () => ({ ok: true }) })
  assert.equal((await garbage.publish({ dashboard: 'sales' })).error, 'port_failed')
  const notAPort = make(home(), { put: 1 })
  assert.equal((await notAPort.publish({ dashboard: 'sales' })).error, 'unavailable')
})

await ok('revoke takes the link down and forgets it; a link the server no longer has is forgotten too; a server that fails keeps it', async () => {
  const h = home()
  const server = fakeServer()
  const s = make(h, server)
  const a = await s.publish({ dashboard: 'sales' })
  const b = await s.publish({ dashboard: 'sales', protect: true })
  const r = await s.revoke({ share: a.share })
  assert.equal(r.ok, true)
  assert.equal(r.revoked.url, a.url)
  assert.equal(server.kept.has(a.share), false)
  assert.deepEqual(s.list().shares.map((x) => x.share), [b.share])
  server.kept.delete(b.share)
  assert.equal((await s.revoke({ share: b.share })).ok, true, 'not_found from the server: it is gone either way')
  assert.deepEqual(s.list().shares, [])
  const c = await s.publish({ dashboard: 'sales' })
  const failing = makeSharing({ api: world.api, dashboardsDir: h.dashboardsDir, sharesDir: h.sharesDir, snapshots: { put: server.put, remove: async () => ({ ok: false, error: 'busy', message: 'try later' }) }, now: () => NOW })
  assert.equal((await failing.revoke({ share: c.share })).error, 'busy')
  assert.equal(failing.list().shares.length, 1, 'still on the list: it is still up')
})

// ---------------------------------------------------------------- the tool and its card
const toolOf = (share) => Object.fromEntries(tools(world.svc, { share }).map((t) => [t.name, t]))

await ok('dashboard_share is a registered tool with strict parameters; with no service it says so; its render never throws', async () => {
  assert.ok(NAMES.includes('dashboard_share'))
  const t = toolOf(null).dashboard_share
  assert.equal(t.parameters.additionalProperties, false)
  assert.deepEqual(t.parameters.properties.action.enum, ['check', 'file', 'publish', 'revoke', 'list'])
  assert.ok(t.description.length > 400 && /ONCE/.test(t.description) && /snapshot/i.test(t.description))
  const none = await t.execute({})
  assert.equal(none.error, 'unavailable')
  for (const value of [none, undefined, null, {}, { ok: true }, { ok: true, included: [], left: [], withheld: [] }]) {
    assert.doesNotThrow(() => t.output.render({}, value === undefined ? {} : value || {}))
  }
})

await ok('the tool checks by default, writes a page, publishes, lists and revokes; an unknown action is refused', async () => {
  const h = home()
  const server = fakeServer()
  const t = toolOf(make(h, server)).dashboard_share
  const c = await t.execute({})
  assert.equal(c.ok, true)
  assert.match(t.output.render({}, c)[0].text, /9 widget\(s\) can be shared, 4 left out/)
  const f = await t.execute({ action: 'file', protect: true })
  assert.equal(f.ok, true)
  assert.match(t.output.render({}, f)[0].text, /Page written: .*sales-2026-11-02\.html\nPassword \(shown once\): /)
  const p = await t.execute({ action: 'publish' })
  assert.match(t.output.render({}, p)[0].text, /^Link made: https:\/\/kaby\.app\/s\//)
  const l = await t.execute({ action: 'list' })
  assert.match(t.output.render({}, l)[0].text, /1 link\(s\)/)
  const u = await t.execute({ action: 'publish', share: p.share })
  assert.match(t.output.render({}, u)[0].text, /^Link updated: /)
  const r = await t.execute({ action: 'revoke', share: p.share })
  assert.match(t.output.render({}, r)[0].text, /^Link taken down: /)
  assert.equal((await t.execute({ action: 'explode' })).error, 'invalid')
  assert.match(t.output.render({}, await t.execute({ action: 'publish', dashboard: 'nope' }))[0].text, /^Not shared: unknown_dashboard/)
  const down = toolOf({ check: () => { throw new Error('boom') }, list: () => ({ ok: true, shares: [] }) }).dashboard_share
  assert.equal((await down.execute({ action: 'check' })).error, 'failed')
})

await ok('the person is asked before a link is made or updated, and before personal fields can show on a page; a check, a list and a revoke ask nothing', () => {
  const ask = (args) => approvalGate(world.svc, { name: 'dashboard_share', arguments: args })
  const link = ask({ action: 'publish', dashboard: 'sales', protect: true })
  assert.equal(link.kind, 'ask')
  assert.match(link.displayReason.en, /publish a snapshot of the dashboard “sales”.*Kybernos server/)
  assert.match(link.displayReason.fr, /publier un instantané du tableau de bord “sales”/)
  assert.match(link.displayReason.en, /password/)
  assert.match(ask({ action: 'publish', share: 'abc' }).displayReason.en, /update a link/)
  assert.match(ask({ action: 'publish', includePersonal: true }).displayReason.en, /PERSONAL FIELDS/)
  assert.match(ask({ action: 'file', includePersonal: true }).displayReason.fr, /écrire une page/)
  for (const args of [{}, { action: 'check' }, { action: 'check', includePersonal: true }, { action: 'file' }, { action: 'file', protect: true }, { action: 'list' }, { action: 'revoke', share: 'a' }]) assert.equal(ask(args), null, JSON.stringify(args))
  assert.equal(shareCard(null), null)
  assert.equal(shareCard('x'), null)
})

console.log('\nkybernos-db share service: ' + count + ' checks passed')
