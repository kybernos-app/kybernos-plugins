// kybernos-db, the shared dashboard: sealing with a password, and the snapshot of a dashboard over a Tables object (what is in it, what is left out and why).
//
//   node packages/kybernos-db/test-share.mjs
import assert from 'node:assert/strict'
import { SEAL_ITERATIONS_MIN, SealError, fromB64u, isSealed, newPassword, openSealed, sealText, toB64u } from './share/seal.mjs'
import { SNAPSHOT_MAX_BYTES, buildSnapshot } from './share/snapshot.mjs'
import { formatNumber } from './share/vendor/dashboards-model.mjs'
import { DASHBOARD, ORDER, PRODUCTS, salesWorld } from './lib-share-test.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const fails = async (fn, code) => { try { await fn() } catch (e) { assert.ok(e instanceof SealError, String(e)); assert.equal(e.code, code, e.message); return } assert.fail('it did not throw') }

// ---------------------------------------------------------------- the seal
await ok('a text sealed under a password opens with it, and only with it', async () => {
  const env = await sealText('{"a":"é ☃"}', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  assert.equal(isSealed(env), true)
  assert.equal(await openSealed(env, 'a long enough password'), '{"a":"é ☃"}')
  await fails(() => openSealed(env, 'a long enough passwore'), 'password')
  await fails(() => openSealed(env, ''), 'password')
  await fails(() => openSealed(env, undefined), 'password')
})

await ok('the envelope shows nothing of the text, and two seals of one text differ (a new salt and a new iv)', async () => {
  const a = await sealText('the same text', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  const b = await sealText('the same text', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  assert.notEqual(a.data, b.data)
  assert.notEqual(a.kdf.salt, b.kdf.salt)
  assert.deepEqual(Object.keys(a).sort(), ['cipher', 'data', 'kdf', 'kind', 'sealed', 'version'])
  assert.equal(JSON.stringify(a).includes('same text'), false)
  assert.equal(fromB64u(a.kdf.salt).length, 16)
  assert.equal(fromB64u(a.cipher.iv).length, 12)
})

await ok('a changed byte, a swapped iv or salt, or a changed round count is refused like a wrong password', async () => {
  const env = await sealText('payload', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  const raw = fromB64u(env.data)
  raw[3] ^= 1
  await fails(() => openSealed({ ...env, data: toB64u(raw) }, 'a long enough password'), 'password')
  const other = await sealText('payload', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  await fails(() => openSealed({ ...env, cipher: other.cipher }, 'a long enough password'), 'password')
  await fails(() => openSealed({ ...env, kdf: other.kdf }, 'a long enough password'), 'password')
  await fails(() => openSealed({ ...env, kdf: { ...env.kdf, iterations: SEAL_ITERATIONS_MIN + 1 } }, 'a long enough password'), 'password')
})

await ok('an envelope the page does not know is a format error, never a long computation', async () => {
  const env = await sealText('payload', 'a long enough password', { iterations: SEAL_ITERATIONS_MIN })
  for (const bad of [null, {}, { ...env, version: 2 }, { ...env, kdf: { ...env.kdf, iterations: 2000001 } }, { ...env, kdf: { ...env.kdf, iterations: 1000 } }, { ...env, kdf: { ...env.kdf, hash: 'SHA-1' } },
    { ...env, cipher: { name: 'AES-CBC', iv: env.cipher.iv } }, { ...env, data: '!!' }, { ...env, data: 'AAAA' }, { ...env, kdf: { ...env.kdf, salt: 'AAAA' } }, { ...env, sealed: false }]) {
    await fails(() => openSealed(bad, 'a long enough password'), 'format')
  }
})

await ok('a password needs 12 characters, the generated one has 100 bits and no look-alike sign', async () => {
  await fails(() => sealText('x', 'short pass'), 'weak')
  await fails(() => sealText('x', 12345678901234), 'weak')
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    const p = newPassword()
    assert.match(p, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/)
    seen.add(p)
    assert.equal((await openSealed(await sealText('t', p, { iterations: SEAL_ITERATIONS_MIN }), p)), 't')
  }
  assert.equal(seen.size, 40)
})

// ---------------------------------------------------------------- the snapshot
const world = salesWorld()
const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0)

await ok('a dashboard over a table becomes a snapshot of its results: numbers equal the table, nothing of the table itself', () => {
  const r = buildSnapshot({ dashboard: DASHBOARD, api: world.api, now: Date.UTC(2026, 10, 2) })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual([r.doc.kind, r.doc.version, r.doc.title, r.doc.made], ['kybernos-snapshot', 1, 'Sales', '2026-11-02'])
  assert.deepEqual(r.doc.widgets.map((w) => w.id), ['revenue', 'orders', 'by-product', 'daily', 'mix', 'stacked', 'big', 'latest', 'note'])
  const byId = Object.fromEntries(r.doc.widgets.map((w) => [w.id, w]))
  const total = sum(world.rows, 'amount')
  assert.equal(byId.revenue.data.text, formatNumber(total, 'compact') + ' EUR')
  assert.equal(byId.revenue.data.sub, '60 orders')
  assert.equal(byId.orders.data.text, '60')
  assert.equal(byId.revenue.data.spark.length > 5, true)
  assert.equal(Math.round(sum(byId.revenue.data.spark, 0) === undefined ? 0 : byId.revenue.data.spark.reduce((a, b) => a + b, 0)), total, 'the sparkline sums to the total')
  const bars = byId['by-product'].data
  assert.equal(bars.kind, 'bars')
  for (const [key, label] of PRODUCTS) {
    const i = bars.labels.findIndex((l) => l.label === label)
    assert.equal(bars.series[0].values[i], sum(world.rows.filter((x) => x.product === key), 'amount'), label)
  }
  assert.equal(byId.daily.data.totals.reduce((a, b) => a + b, 0), total)
  assert.equal(byId.mix.data.totals.reduce((a, b) => a + b, 0), 60)
  assert.equal(byId.stacked.data.series.length, 3)
  const big = byId.big.data
  assert.deepEqual([big.total, big.rows.length], [60, 5])
  assert.equal(big.rows[0][2].s, formatNumber(Math.max(...world.rows.map((x) => x.amount)), 'number'))
  assert.equal(big.rows[0][2].bar, 1)
  assert.equal(byId.latest.data.rows.length, 6)
  assert.equal(byId.note.data.text, 'Orders of the shop, in euros.')
  // a number of the document is a result: the rows of the table are not in it, only the five the table widget lists and the six of the list
  const refs = JSON.stringify(r.doc).match(/A-1\d{3}/g) || []
  assert.ok(refs.length >= 5 && refs.length <= 11, 'refs in the document: ' + refs.length)
})

await ok('what is not shared is said, with the reason: other sources, widgets the page does not draw, personal fields', () => {
  const r = buildSnapshot({ dashboard: DASHBOARD, api: world.api, now: Date.UTC(2026, 10, 2) })
  assert.deepEqual(r.left.map((w) => w.id).sort(), ['board', 'usage'])
  assert.match(r.left.find((w) => w.id === 'usage').why, /usage\.totals.*about this computer/)
  assert.match(r.left.find((w) => w.id === 'board').why, /kanban/)
  assert.deepEqual(r.withheld.map((w) => [w.id, w.fields]).sort(), [['by-customer', ['customer']], ['who', ['customer']]])
  const text = JSON.stringify(r.doc)
  for (const name of ['Ada', 'Turing', 'Hopper', '@example.com', 'FR76']) assert.equal(text.includes(name), false, name + ' is in the snapshot')
})

await ok('the person may say that personal fields can show: the chart by customer is then there, and only then', () => {
  const r = buildSnapshot({ dashboard: DASHBOARD, api: world.api, now: Date.UTC(2026, 10, 2), includePersonal: true })
  assert.deepEqual(r.withheld, [])
  assert.equal(r.doc.widgets.some((w) => w.id === 'by-customer'), true)
  assert.equal(JSON.stringify(r.doc).includes('Ada Lovelace'), true)
  assert.equal(JSON.stringify(r.doc).includes('FR76'), false, 'a sensitive field is never in, whatever was said')
})

await ok('a dashboard with nothing to share, a bad one and a too big one are refused with a reason', () => {
  const none = buildSnapshot({ dashboard: { name: 'Mine', widgets: [DASHBOARD.widgets.find((w) => w.id === 'usage')] }, api: world.api })
  assert.deepEqual([none.ok, none.error], [false, 'nothing_to_share'])
  assert.equal(none.left.length, 1)
  assert.equal(buildSnapshot({ dashboard: 7, api: world.api }).error, 'invalid_dashboard')
  const huge = buildSnapshot({ dashboard: { name: 'Notes', widgets: Array.from({ length: 24 }, (_, i) => ({ id: 'n' + i, type: 'note', text: 'x'.repeat(4000) })) }, api: world.api, maxBytes: 50000 })
  assert.deepEqual([huge.ok, huge.error], [false, 'too_big'])
  assert.equal(buildSnapshot({ dashboard: { name: 'Notes', widgets: [{ id: 'n', type: 'note', text: 'x'.repeat(4000) }] }, api: world.api, maxBytes: SNAPSHOT_MAX_BYTES }).ok, true)
})

await ok('a table that does not exist leaves its widgets out with the model\'s own words', () => {
  const r = buildSnapshot({ dashboard: { name: 'Ghost', widgets: [{ id: 'g', type: 'card', title: 'G', source: { provider: 'db.rows', params: { object: 'nope' } }, metric: { agg: 'count' } }, { id: 'n', type: 'note', text: 'hello' }] }, api: world.api })
  assert.equal(r.ok, true)
  assert.deepEqual(r.included.map((w) => w.id), ['n'])
  assert.match(r.left[0].why, /No such table/)
})

console.log('\nkybernos-db share: ' + count + ' checks passed')
