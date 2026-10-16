// The memory of the free tier's health probe: a few minutes, shared by pages opened together, bypassed by « Re-check ».
//
//   node packages/kybernos-free-llms/test-probe-cache.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createProbeCache, PROBE_TTL_MS } from './probe-cache.mjs'

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
const clock = (start = Date.parse('2026-10-16T08:00:00Z')) => { let t = start; return { now: () => t, tick: (ms) => { t += ms } } }

{
  const c = clock(); let runs = 0
  const cache = createProbeCache({ run: async () => { runs += 1; return { ok: false, code: 'free_tier_locked', status: 403, model: 'm' } }, now: c.now })
  const a = await cache.get()
  const b = await cache.get()
  assert.equal(runs, 1)
  assert.deepEqual([a.cached, b.cached], [false, true])
  assert.equal(a.code, 'free_tier_locked')
  assert.equal(b.checkedAt, a.checkedAt)
  ok('a verdict is remembered: the second page does not make a second call, and says it is a remembered one')
}
{
  const c = clock(); let runs = 0
  const cache = createProbeCache({ run: async () => { runs += 1; return { ok: true, code: 'ok' } }, now: c.now })
  await cache.get()
  c.tick(PROBE_TTL_MS - 1)
  await cache.get()
  assert.equal(runs, 1)
  c.tick(2)
  const later = await cache.get()
  assert.equal(runs, 2)
  assert.equal(later.cached, false)
  ok('it is remembered for a few minutes, then asked again')
}
{
  const c = clock(); let runs = 0
  const cache = createProbeCache({ run: async () => { runs += 1; return { ok: runs > 1, code: runs > 1 ? 'ok' : 'free_tier_locked' } }, now: c.now })
  const first = await cache.get()
  const forced = await cache.get({ fresh: true })
  assert.equal(runs, 2)
  assert.deepEqual([first.ok, forced.ok], [false, true])
  assert.equal((await cache.get()).ok, true, 'the fresh answer replaces the remembered one')
  ok('« Re-check » asks again and what it learns is what the next page sees')
}
{
  const c = clock(); let runs = 0; let release = null
  const cache = createProbeCache({ run: () => new Promise((resolve) => { runs += 1; release = () => resolve({ ok: true, code: 'ok' }) }), now: c.now })
  const p1 = cache.get(); const p2 = cache.get({ fresh: true })
  await new Promise((r) => setImmediate(r))
  release()
  const [a, b] = await Promise.all([p1, p2])
  assert.equal(runs, 1)
  assert.deepEqual([a.ok, b.ok], [true, true])
  ok('two requests at the same time share one call')
}
{
  const c = clock(); let runs = 0
  const cache = createProbeCache({ run: async () => { runs += 1; return { ok: false, code: 'network' } }, now: c.now })
  await cache.get(); await cache.get()
  assert.equal(runs, 2)
  const none = createProbeCache({ run: async () => { runs += 1; return { ok: false, code: 'no_model' } }, now: c.now })
  await none.get(); await none.get()
  assert.equal(runs, 4)
  ok('a network failure or an empty catalogue says nothing about the tier: it is not remembered')
}
{
  let runs = 0
  const cache = createProbeCache({ run: async () => { runs += 1; if (runs === 1) throw new Error('boom'); return { ok: true, code: 'ok' } } })
  await assert.rejects(() => cache.get())
  assert.equal((await cache.get()).ok, true)
  ok('a probe that throws does not wedge the memory')
}
{
  // The route: the host mounts it with `?cached=1` meaning « a remembered verdict is fine » and nothing meaning « ask again ».
  const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  assert.match(host, /createProbeCache\(\{ run: async \(\) => \{/)
  assert.match(host, /probes\.get\(\{ fresh: q\.get\('cached'\) !== '1' \}\)/)
  ok('the health route answers from the memory only when the page says cached=1')
}
console.log('\n' + n + ' verifications OK')
