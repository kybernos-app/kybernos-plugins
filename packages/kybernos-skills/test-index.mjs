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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The saved setting lives under the DSH home: this test gets its own, so it never reads or writes the user's.
const home = mkdtempSync(join(tmpdir(), 'kb-skills-index-'))
process.env.DSH_HOME = home

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
  assert.match(src, /const INDEX_API_DEFAULT = 'https:\/\/skills\.kybernos\.app\/v1'/)
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

  // 8. A relay that answers without end is cut, not read to the end (a faulty relay or a proxy page used to fill the memory of DSH).
  {
    process.env.KYBERNOS_SKILLS_INDEX_URL = base
    mod.resetDiscoverCache()
    let closedEarly = false
    let sentMb = 0
    const endless = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"data":["')
      const piece = 'x'.repeat(1 << 20)
      res.on('close', () => { if (sentMb < 200) closedEarly = true })
      const pump = () => {
        while (sentMb < 200 && !res.destroyed) { sentMb += 1; if (res.write(piece) === false) { res.once('drain', pump); return } }
        if (!res.destroyed) res.end('"]}')
      }
      pump()
    })
    await new Promise((resolve) => endless.listen(0, '127.0.0.1', resolve))
    process.env.KYBERNOS_SKILLS_INDEX_URL = 'http://127.0.0.1:' + endless.address().port + '/v1'
    const rss0 = process.memoryUsage().rss
    const flood = await mod.indexSkills({ view: 'all-time', page: '0', perPage: '5' })
    const grownMb = (process.memoryUsage().rss - rss0) / (1 << 20)
    await new Promise((resolve) => setTimeout(resolve, 200))
    endless.close()
    assert.equal(flood.ok, false, 'a 200 MB answer is not a ranking')
    assert.equal(closedEarly, true, 'the client must drop the connection (read ' + sentMb + ' MB)')
    assert.ok(sentMb < 150, 'the client read ' + sentMb + ' MB')
    assert.ok(grownMb < 250, 'memory grew by ' + Math.round(grownMb) + ' MB')
    process.env.KYBERNOS_SKILLS_INDEX_URL = base
    ok('an endless relay answer is cut after a few MB and reported as a failure (memory +' + Math.round(grownMb) + ' MB)')
  }

  // 9. The address is also a setting of the page: same validation as the variable, the variable wins, nothing falls back.
  {
    delete process.env.KYBERNOS_SKILLS_INDEX_URL
    mod.resetDiscoverCache()
    const cfg = mod.configOf()
    const settingFile = join(home, 'kybernos', 'skills-index.json')
    assert.equal(mod.describeIndexSource(cfg).origin, 'default')
    assert.equal(mod.describeIndexSource(cfg).url, 'https://skills.kybernos.app/v1')
    assert.equal(mod.describeIndexSource(cfg).editable, true)

    // a bad address is refused with the same words as the variable, writes nothing, and sends nothing
    for (const bad of ['http://example.com/v1', 'ftp://127.0.0.1/v1', 'https://user:pw@example.com/v1', 'https://example.com/v1?x=1', 'https://example.com/v1#frag', 'not a url']) {
      const before = seen.length
      const r = mod.setIndexSource(cfg, bad)
      assert.deepEqual([r.ok, r.error], [false, 'index_url_refused'], bad)
      assert.equal(existsSync(settingFile), false, bad + ' must not be saved')
      assert.equal(seen.length, before)
      assert.equal(mod.checkIndexUrl(bad), null, 'the variable and the setting share one validator: ' + bad)
    }
    // a good one is saved (private file), reported, and used
    const saved = mod.setIndexSource(cfg, base + '/')
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.source.origin, 'setting')
    assert.equal(saved.source.url, base, 'normalised: no trailing slash')
    assert.equal(saved.source.host, '127.0.0.1:' + server.address().port)
    assert.equal(JSON.parse(readFileSync(settingFile, 'utf8')).url, base)
    assert.equal(statSync(settingFile).mode & 0o077, 0, 'the setting is private to the user')
    answer = () => ({ status: 200, body: { data: [hit('viaSetting', 1)], pagination: { total: 1, hasMore: false } } })
    const used = await mod.indexSkills({ view: 'all-time', page: '0', perPage: '1' })
    assert.equal(used.ok, true, JSON.stringify(used))
    assert.equal(used.skills[0].name, 'viaSetting')
    assert.equal(seen.at(-1).url, '/v1/skills?view=all-time&page=0&per_page=1')
    assert.equal(seen.at(-1).headers.authorization, undefined, 'a custom relay gets no credential either')
    ok('the page can name another relay: same validation as the variable, saved privately, used at once, no credential sent')

    // the variable wins over the setting, and the page may not change it while it is set
    process.env.KYBERNOS_SKILLS_INDEX_URL = 'http://127.0.0.1:1/never'
    const viaEnv = mod.describeIndexSource(cfg)
    assert.deepEqual([viaEnv.origin, viaEnv.editable], ['env', false])
    assert.equal(mod.setIndexSource(cfg, base).error, 'index_url_env')
    assert.equal(mod.setIndexSource(cfg, '').error, 'index_url_env')
    assert.equal(JSON.parse(readFileSync(settingFile, 'utf8')).url, base, 'the file is untouched while the variable decides')
    process.env.KYBERNOS_SKILLS_INDEX_URL = 'https://user:pw@example.com/v1'
    const bad = mod.describeIndexSource(cfg)
    assert.deepEqual([bad.origin, bad.refused, bad.url, bad.host], ['env', true, null, null], 'a refused address is never echoed back (it may hold a password)')
    delete process.env.KYBERNOS_SKILLS_INDEX_URL
    ok('the variable wins, the page is told it is not editable, and a refused address is not repeated to the screen')

    // an answer from one relay is never served for another
    mod.resetDiscoverCache()
    answer = () => ({ status: 200, body: { data: [hit('relay-A', 1)], pagination: { total: 1, hasMore: false } } })
    assert.equal((await mod.indexSkills({ view: 'hot', page: '0', perPage: '1' })).skills[0].name, 'relay-A')
    answer = () => ({ status: 200, body: { data: [hit('relay-B', 1)], pagination: { total: 1, hasMore: false } } })
    const other = createServer((req, res) => { seen.push({ url: req.url, headers: req.headers, method: req.method }); const a = answer(req.url); res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body)) })
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve))
    assert.equal(mod.setIndexSource(cfg, 'http://127.0.0.1:' + other.address().port + '/v1').ok, true)
    assert.equal((await mod.indexSkills({ view: 'hot', page: '0', perPage: '1' })).skills[0].name, 'relay-B', 'the cache was dropped with the address')
    other.close()
    ok('changing the relay drops what the previous one answered')

    // a file that cannot be read is a value that was set: refused, never replaced by the default; an empty address recovers
    writeFileSync(settingFile, '{ not json')
    mod.resetDiscoverCache()
    const before = seen.length
    const broken = await mod.indexSkills({ view: 'all-time', page: '0', perPage: '1' })
    assert.deepEqual([broken.ok, broken.error], [false, 'index_url_refused'])
    assert.equal(seen.length, before)
    assert.equal(mod.describeIndexSource(cfg).refused, true)
    assert.equal(mod.setIndexSource(cfg, '').ok, true)
    assert.equal(existsSync(settingFile), false)
    assert.equal(mod.describeIndexSource(cfg).origin, 'default')
    ok('a damaged setting is refused (no silent fallback) and an empty address puts the default back')
  }

  console.log('\n' + pass + ' verifications OK')
} finally {
  server.close()
  try { rmSync(home, { recursive: true, force: true }) } catch (e) { /* temp folder */ }
}
