// The routes: origin fence, validation, persistence through the injected I/O, apply() never throws.
import { createStore, mountRoutes, originOk, hostOk } from './usage-host.mjs'
import { apply } from './index.js'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }

const disk = { value: null, writes: 0 }
const store = createStore({ read: () => disk.value, write: (l) => { disk.value = JSON.parse(JSON.stringify(l)); disk.writes++ }, now: () => new Date(2026, 9, 12, 9, 30) })
const routes = {}
mountRoutes({ register: (r) => { routes[r.path] = r.handler } }, store)

const call = async (path, { method = 'POST', headers = {}, body, url } = {}) => {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = { method, url: url || path, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json', ...headers }, socket: { localPort: 3080 },
    [Symbol.asyncIterator]: async function * () { for (const c of chunks) yield c } }
  let status = 0; let out = ''
  const res = { writeHead: (s) => { status = s }, end: (b) => { out = b } }
  await routes[path](req, res)
  return { status, json: out === '' ? null : JSON.parse(out) }
}
const U = (u, o, cr) => ({ uncachedInputTokens: u, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: 0 })

ok('three routes mounted', Object.keys(routes).sort().join() === '/kybernos-usage/budget,/kybernos-usage/observe,/kybernos-usage/summary')
{
  const foreign = await call('/kybernos-usage/observe', { headers: { origin: 'https://evil.example' }, body: { sessionId: 's', model: 'm', usage: U(1, 1, 1) } })
  ok('observe: foreign origin refused', foreign.status === 403)
  const none = await call('/kybernos-usage/observe', { headers: { origin: '' , referer: '' }, body: { sessionId: 's', model: 'm', usage: U(1, 1, 1) } })
  ok('observe: no Origin and no Referer refused (strict)', none.status === 403)
  const get = await call('/kybernos-usage/observe', { method: 'GET' })
  ok('observe: GET refused', get.status === 405)
  const notJson = await call('/kybernos-usage/observe', { headers: { 'content-type': 'text/plain' }, body: 'x' })
  ok('observe: non-JSON refused', notJson.status === 415)
  const bad = await call('/kybernos-usage/observe', { body: '{not json' })
  ok('observe: bad JSON refused', bad.status === 400)
  const big = await call('/kybernos-usage/observe', { body: JSON.stringify({ sessionId: 's', model: 'm', title: 'x'.repeat(9000), usage: U(1, 1, 1) }) })
  ok('observe: oversized body refused', big.status === 400)
  const invalid = await call('/kybernos-usage/observe', { body: { sessionId: '', model: 'm', usage: U(1, 1, 1) } })
  ok('observe: invalid body 400', invalid.status === 400 && invalid.json.ok === false)
}
{
  const a = await call('/kybernos-usage/observe', { body: { sessionId: 's1', provider: 'deepseek', model: 'pro', title: 'Note', usage: U(100, 10, 1000) } })
  ok('observe: baseline accepted and written', a.status === 200 && disk.writes === 1)
  const b = await call('/kybernos-usage/observe', { body: { sessionId: 's1', provider: 'deepseek', model: 'pro', usage: U(160, 25, 1900) } })
  ok('observe: delta accepted and written', b.status === 200 && disk.writes === 2)
  const c = await call('/kybernos-usage/observe', { body: { sessionId: 's1', provider: 'deepseek', model: 'pro', usage: U(160, 25, 1900) } })
  ok('observe: unchanged counters do not write', c.status === 200 && disk.writes === 2)
}
{
  const s = await call('/kybernos-usage/summary', { method: 'GET', url: '/kybernos-usage/summary?days=7', headers: { origin: '' } })
  ok('summary: lax origin accepts a missing header', s.status === 200 && s.json.ok === true && s.json.daily.length === 7)
  ok('summary: carries the booked delta', s.json.models['deepseek/pro'].cr === 900, JSON.stringify(s.json.models))
  const f = await call('/kybernos-usage/summary', { method: 'GET', headers: { origin: 'https://evil.example' } })
  ok('summary: foreign origin refused', f.status === 403)
  const p = await call('/kybernos-usage/summary', { method: 'POST' })
  ok('summary: POST refused', p.status === 405)
}
{
  const b = await call('/kybernos-usage/budget', { body: { usd: 25, alert: true } })
  ok('budget: saved', b.status === 200 && disk.value.budget.usd === 25)
  const no = await call('/kybernos-usage/budget', { body: { usd: -3 } })
  ok('budget: negative refused', no.status === 400)
}
{ // persistence: a new store over the same disk sees the same ledger
  const again = createStore({ read: () => disk.value, write: () => {}, now: () => new Date(2026, 9, 12, 9, 40) })
  ok('reload: ledger survives', again.summary(7).models['deepseek/pro'].cr === 900)
  const corrupt = createStore({ read: () => { throw new Error('boom') }, write: () => { throw new Error('ro') } })
  ok('corrupt or unreadable disk: empty ledger, observe does not throw', corrupt.observe({ sessionId: 's', model: 'm', usage: U(1, 1, 1) }).ok === true)
}
{ // DNS rebinding: a foreign Host is refused on every route, with or without an Origin, GET or POST
  const rebound = { host: 'attacker.example:3080' }
  const g = await call('/kybernos-usage/summary', { method: 'GET', headers: { ...rebound, origin: '' } })
  ok('summary: foreign Host without Origin refused', g.status === 403)
  const p1 = await call('/kybernos-usage/observe', { headers: { ...rebound, origin: '' }, body: { sessionId: 's', model: 'm', usage: U(1, 1, 1) } })
  ok('observe: foreign Host without Origin refused', p1.status === 403)
  const p2 = await call('/kybernos-usage/budget', { headers: { host: 'attacker.example:3080', origin: 'http://attacker.example:3080' }, body: { usd: 5 } })
  ok('budget: foreign Host AND Origin refused', p2.status === 403)
  ok('hostOk: own authority only', hostOk({ headers: { host: '127.0.0.1:3080' }, socket: { localPort: 3080 } }) === true && hostOk({ headers: { host: 'attacker.example:3080' }, socket: { localPort: 3080 } }) === false)
}
{
  ok('originOk(strict) needs a header', originOk({ headers: {}, socket: { localPort: 3080 } }, true) === false)
  ok('originOk(lax) tolerates none', originOk({ headers: {}, socket: { localPort: 3080 } }, false) === true)
  ok('originOk accepts the page itself via Referer', originOk({ headers: { referer: 'http://localhost:3080/x' }, socket: { localPort: 3080 } }, true) === true)
}
{ // apply never throws, with or without the web server
  let threw = false
  try { apply({ get: () => undefined, inject: () => {} }); apply({ get: () => ({ register: () => { throw new Error('x') } }), inject: () => {} }); apply({}) } catch (e) { threw = true }
  ok('apply never throws', threw === false)
}
process.exit(fail ? 1 : 0)
