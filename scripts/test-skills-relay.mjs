// ── The skills.sh relay forwards four closed routes and nothing else ─────────────────────────────────────────────
//
// services/skills-index/relay-core.mjs holds the project's OIDC token and serves a cached copy of the skills.sh index to every
// user. The risks are the ones of any open relay: forwarding a path or a parameter nobody planned, leaking the token or
// upstream's own error text, and caching a failure so it looks like an answer. The network and the token are injected here.
//
//   node scripts/test-skills-relay.mjs
import assert from 'node:assert/strict'
import { relay, plan, requestedPath, UPSTREAM } from '../services/skills-index/relay-core.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const TOKEN = 'tok_SECRET_do_not_leak_0123456789'

// A fake upstream that records every call and answers with what the test gives it.
const upstream = (answer) => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const a = typeof answer === 'function' ? answer(url, init) : answer
    if (a instanceof Error) throw a
    return { status: a.status, text: async () => a.text ?? '' }
  }
  return { fetch, calls }
}
const good = (payload) => ({ status: 200, text: JSON.stringify(payload) })
const run = (url, answer, over = {}) => {
  const up = upstream(answer)
  return relay({ method: 'method' in over ? over.method : 'GET', url }, { fetch: up.fetch, getToken: over.getToken ?? (async () => TOKEN) }).then((out) => ({ out, up }))
}
const leaks = (out) => JSON.stringify(out).includes(TOKEN)

// ── what is asked: path and query ──
assert.equal(requestedPath('/v1/skills/search?q=ab'), 'skills/search')
assert.equal(requestedPath('/api/relay?path=skills%2Fsearch&q=ab'), 'skills/search')
assert.equal(requestedPath('/api/relay?path=skills/curated'), 'skills/curated')
ok('the path comes from the rewrite parameter or from the URL itself')

for (const bad of ['/api/relay?path=skills&path=skills/curated', '/v1/', '/v1/skills//search', '/v1/skills/../x', '/v1/skills/./x', '/v1/a%5Cb']) {
  assert.equal(plan(bad).ok === true, false, bad)
}
ok('two path parameters, an empty path, dot segments, doubled slashes and backslashes are refused')

const p1 = plan('/v1/skills?per_page=50&view=hot&page=2')
assert.equal(p1.ok, true)
assert.equal(p1.query, 'page=2&per_page=50&view=hot')
ok('the query is rebuilt in a fixed order, so one question has one cache key')

for (const [url, why] of [
  ['/v1/skills?view=weird', 'view'], ['/v1/skills?per_page=501', 'per_page'], ['/v1/skills?per_page=0', 'per_page'], ['/v1/skills?page=-1', 'page'],
  ['/v1/skills?page=1&page=2', 'page repeated'], ['/v1/skills?x=1', 'unknown'], ['/v1/skills/search?q=a', 'q too short'],
  ['/v1/skills/search?q=' + 'x'.repeat(101), 'q too long'], ['/v1/skills/search?q=ab&limit=101', 'limit'], ['/v1/skills/curated?view=hot', 'no params on curated'],
  ['/v1/skills/search?q=a%00b', 'control character']
]) {
  const p = plan(url)
  assert.equal(p.ok, false, why)
  assert.equal(p.status, 400, why)
}
ok('an unknown parameter, a repeated one and every out-of-range value are refused before any request')

for (const url of ['/v1/skills/other', '/v1/users', '/v1/skills/audit/owner/repo', '/v1/skills/audit/a/b/c/d', '/v1/skills/search/x', '/v1/skills/curated/x']) {
  assert.equal(plan(url).status, 404, url)
}
assert.equal(plan('/v1/skills/audit/vercel-labs/skills/find-skills').ok, true)
ok('only the four routes exist; an audit path needs exactly owner/repo/skill')

// ── what is sent upstream ──
{
  const { out, up } = await run('/api/relay?path=skills%2Fsearch&q=react&limit=20', good({ data: [], count: 0 }))
  assert.equal(out.status, 200)
  assert.equal(up.calls.length, 1)
  assert.equal(up.calls[0].url, UPSTREAM + '/skills/search?limit=20&q=react')
  assert.equal(up.calls[0].init.method, 'GET')
  assert.equal(up.calls[0].init.headers.authorization, 'Bearer ' + TOKEN)
  assert.equal(up.calls[0].init.redirect, 'error')
  ok('one GET to the fixed host, canonical query, our token, redirects refused')
}
{
  const { up } = await run('/v1/skills/audit/vercel-labs/skills/find-skills', good({ audits: [] }))
  assert.equal(up.calls[0].url, UPSTREAM + '/skills/audit/vercel-labs/skills/find-skills')
  ok('an audit path is forwarded as asked')
}

// ── what comes back ──
{
  const { out } = await run('/v1/skills?view=all-time', good({ data: [{ slug: 'x' }], pagination: { total: 1, hasMore: false } }))
  assert.equal(out.status, 200)
  assert.deepEqual(JSON.parse(out.body), { data: [{ slug: 'x' }], pagination: { total: 1, hasMore: false } })
  assert.match(out.headers['cache-control'], /^public, s-maxage=3600, stale-while-revalidate=3600, stale-if-error=3600$/)
  assert.equal(out.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(leaks(out), false)
  const cached = async (url) => (await run(url, good({ data: [] }))).out.headers['cache-control']
  assert.match(await cached('/v1/skills/curated'), /^public, s-maxage=3600,/)
  assert.match(await cached('/v1/skills/search?q=react'), /^public, s-maxage=300, stale-while-revalidate=1500,/)
  assert.match(await cached('/v1/skills/audit/o/r/s'), /^public, s-maxage=3600,/)
  ok('a good answer is passed through and cacheable: an hour to browse and for audits, five minutes for a search')
}
{
  const { out } = await run('/v1/skills/audit/o/r/s', { status: 404, text: '{"message":"secret upstream detail"}' })
  assert.equal(out.status, 404)
  assert.equal(JSON.parse(out.body).message, 'not found')
  assert.equal(out.headers['cache-control'], 'public, s-maxage=60')
  ok('a skill without an audit is a short-lived 404 with our own wording')
}
for (const [status, label] of [[401, 'our token refused'], [403, 'forbidden'], [500, 'upstream down'], [502, 'upstream gateway'], [418, 'anything else']]) {
  const { out } = await run('/v1/skills', { status, text: '{"message":"upstream said: ' + TOKEN + '"}' })
  assert.equal(out.status, 502, label)
  assert.equal(out.headers['cache-control'], 'no-store', label)
  assert.equal(JSON.parse(out.body).message, 'index unavailable', label)
  assert.equal(leaks(out), false, label)
}
ok('an upstream failure is a 502 with our wording, never cached, and upstream text is never relayed')
{
  const { out } = await run('/v1/skills', { status: 429, text: '' })
  assert.equal(out.status, 503)
  assert.equal(out.headers['retry-after'], '30')
  assert.equal(out.headers['cache-control'], 'no-store')
  ok('a quota refusal becomes a 503 with a retry hint, never cached')
}
{
  const t = await run('/v1/skills', new Error('connect ECONNRESET ' + TOKEN))
  assert.equal(t.out.status, 504)
  assert.equal(t.out.headers['cache-control'], 'no-store')
  assert.equal(leaks(t.out), false)
  const bad = await run('/v1/skills', { status: 200, text: '<html>not json</html>' })
  assert.equal(bad.out.status, 502)
  assert.equal(bad.out.headers['cache-control'], 'no-store')
  const big = await run('/v1/skills', { status: 200, text: '[' + '1,'.repeat(3 * 1024 * 1024) + '1]' })
  assert.equal(big.out.status, 502)
  ok('a network error, a body that is not JSON and an oversized body are refused and never cached')
}

// ── what is refused without touching upstream ──
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', '', undefined]) {
  const { out, up } = await run('/v1/skills', good({}), { method })
  assert.equal(out.status, 405, String(method))
  assert.equal(out.headers.allow, 'GET, HEAD')
  assert.equal(up.calls.length, 0)
}
assert.equal((await run('/v1/skills', good({}), { method: 'HEAD' })).out.status, 200)
ok('only GET and HEAD, and a refused method never reaches upstream')
{
  const { out, up } = await run('/v1/skills?x=1', good({}))
  assert.equal(out.status, 400)
  assert.equal(up.calls.length, 0)
  assert.equal(out.headers['cache-control'], 'no-store')
  ok('an invalid request costs no upstream call and is never cached')
}
for (const getToken of [async () => '', async () => { throw new Error('no oidc') }, async () => undefined]) {
  const { out, up } = await run('/v1/skills', good({}), { getToken })
  assert.equal(out.status, 503)
  assert.equal(up.calls.length, 0)
  assert.equal(out.headers['cache-control'], 'no-store')
}
ok('without a token the relay says "unavailable" and sends nothing')

console.log('\n' + pass + ' verifications OK')
