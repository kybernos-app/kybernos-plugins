#!/usr/bin/env node
/** The Discover routes read the skills.sh index THROUGH OUR RELAY (services/skills-index) and send no credential.
 *
 *  A local server stands in for the relay (KYBERNOS_SKILLS_INDEX_URL, loopback http). It records every request, so the test can
 *  say what the plugin asks for, what it never sends, and what the user is told when the relay is down. The default address and
 *  the refusal of an unsafe override are checked without any network.
 *
 *  Usage: node packages/kybernos-skills/test-index.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const here = dirname(fileURLToPath(import.meta.url))
const seen = []
let answer = () => ({ status: 200, body: { data: [] } })
const server = createServer((req, res) => {
  seen.push({ url: req.url, headers: req.headers, method: req.method })
  const a = answer(req.url)
  res.writeHead(a.status, { 'content-type': 'application/json' })
  res.end(typeof a.body === 'string' ? a.body : JSON.stringify(a.body))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port + '/v1'

const hit = (name, i) => ({ id: 'o/r/' + name, slug: name, name, source: 'o/r', installs: i, sourceType: 'github', installUrl: 'https://github.com/o/r', url: 'https://skills.sh/o/r/' + name })

try {
  console.log('kybernos-skills — remote index through the relay')
  process.env.KYBERNOS_SKILLS_INDEX_URL = base
  const mod = await import('./index.js')

  // 1. The ranking.
  answer = () => ({ status: 200, body: { data: [hit('alpha', 9), hit('beta', 3)], pagination: { page: 0, perPage: 2, total: 92851, hasMore: true } } })
  const idx = await mod.indexSkills({ view: 'trending', page: '1', perPage: '2' })
  assert.equal(idx.ok, true, JSON.stringify(idx))
  assert.equal(idx.total, 92851)
  assert.equal(idx.hasMore, true)
  assert.deepEqual(idx.skills.map((s) => s.name), ['alpha', 'beta'])
  assert.equal(idx.skills[0].installable, true)
  assert.equal(seen.at(-1).url, '/v1/skills?view=trending&page=1&per_page=2')
  ok('the ranking asks the relay for the right page and keeps the paging the relay announces')

  // 2. Nothing secret leaves the machine.
  for (const call of seen) {
    assert.equal(call.method, 'GET')
    assert.equal(call.headers.authorization, undefined, 'no credential of any kind')
    assert.equal(call.headers.cookie, undefined)
  }
  ok('every request is a bare GET: no Authorization, no cookie')

  // 3. Search, curated, audits.
  mod.resetDiscoverCache()
  answer = () => ({ status: 200, body: { data: [hit('react-x', 5)], count: 1, durationMs: 4 } })
  const found = await mod.searchSkills('react', 20)
  assert.equal(found.ok, true)
  assert.equal(seen.at(-1).url, '/v1/skills/search?q=react&limit=20')
  assert.equal((await mod.searchSkills('a', 20)).ok, false, 'one character is refused before any request')
  const n = seen.length
  await mod.searchSkills('a', 20)
  assert.equal(seen.length, n)
  ok('search asks the relay once and refuses a one-letter query without a request')

  answer = () => ({ status: 200, body: { data: [{ owner: 'acme', totalInstalls: 4, featuredRepo: 'acme/skills', featuredSkill: 'x', skills: [hit('x', 4)] }], totalOwners: 1, totalSkills: 1 } })
  const cur = await mod.curatedSkills()
  assert.equal(cur.ok, true)
  assert.equal(cur.owners[0].owner, 'acme')
  assert.equal(seen.at(-1).url, '/v1/skills/curated')
  answer = () => ({ status: 200, body: { audits: [{ provider: 'p', slug: 's', status: 'pass', summary: 'fine' }] } })
  const aud = await mod.auditSkill('o/r', 'alpha')
  assert.equal(aud.ok, true)
  assert.equal(aud.audits.length, 1)
  assert.equal(seen.at(-1).url, '/v1/skills/audit/o/r/alpha')
  assert.equal((await mod.auditSkill('not a source', 'alpha')).ok, false)
  ok('curated and audits use the relay; a malformed source never reaches it')

  // 4. A skill with no audit is not an error.
  mod.resetDiscoverCache()
  answer = () => ({ status: 404, body: { message: 'not found' } })
  const none = await mod.auditSkill('o/r', 'gamma')
  assert.equal(none.ok, true)
  assert.deepEqual(none.audits, [])
  ok('a 404 on an audit means "no audit published"')

  // 5. The relay is down: say so, with its wording, and never serve a stale failure from cache.
  mod.resetDiscoverCache()
  answer = () => ({ status: 502, body: { message: 'index unavailable' } })
  const down = await mod.indexSkills({ view: 'hot', page: '0', perPage: '5' })
  assert.equal(down.ok, false)
  assert.deepEqual([down.error, down.http, down.detail], ['index_unavailable', 502, 'index unavailable'], 'a code, the status, and the relay\'s own message')
  answer = () => ({ status: 200, body: { data: [hit('back', 1)], pagination: { total: 1, hasMore: false } } })
  const back = await mod.indexSkills({ view: 'hot', page: '0', perPage: '5' })
  assert.equal(back.ok, true, 'a failure is never cached')
  assert.equal(back.skills[0].name, 'back')
  answer = () => ({ status: 503, body: 'not json' })
  mod.resetDiscoverCache()
  const noJson = await mod.indexSkills({ view: 'all-time', page: '9', perPage: '5' })
  assert.deepEqual([noJson.error, noJson.http, noJson.detail], ['index_unavailable', 503, undefined], 'no JSON body: the code and the status, no message')
  ok('a relay failure is reported in its own words, a non-JSON failure gets a generic one, and neither is cached')

  // 6. The address: default, override, and a refused override.
  delete process.env.KYBERNOS_SKILLS_INDEX_URL
  const src = readFileSync(join(here, 'index.js'), 'utf8')
  assert.match(src, /const INDEX_API_DEFAULT = 'https:\/\/kybernos-skills-index\.vercel\.app\/v1'/)
  for (const bad of ['http://example.com/v1', 'ftp://127.0.0.1/v1', 'https://user:pw@example.com/v1', 'https://example.com/v1?x=1', 'not a url']) {
    process.env.KYBERNOS_SKILLS_INDEX_URL = bad
    mod.resetDiscoverCache()
    const before = seen.length
    const refused = await mod.indexSkills({ view: 'all-time', page: '0', perPage: '1' })
    assert.equal(refused.ok, false, bad)
    assert.equal(refused.error, 'index_url_refused', bad)
    assert.equal(seen.length, before, bad + ' must not send anything')
  }
  ok('an override that is not https (or loopback http), carries credentials or a query, or is not a URL is refused, not replaced by the default')

  // 7. The token machinery is gone.
  for (const word of ['VERCEL_OIDC_TOKEN', 'vercel env pull', 'renewToken', 'readToken', '/kybernos-skills/reconnect']) {
    assert.equal(src.includes(word), false, word + ' is still in index.js')
  }
  ok('index.js no longer reads, renews or mentions a Vercel token, and has no reconnect route')

  console.log('\n' + pass + ' verifications OK')
} finally {
  server.close()
}
