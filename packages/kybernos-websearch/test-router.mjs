#!/usr/bin/env node
// kybernos-websearch: the chain. Fake engines, a fake clock, no network, no disk.
import { createRouter, explain, PAUSE_MS } from './router.mjs'
import { EngineError } from './engines.mjs'
import { normalizeSettings, applyPatch } from './settings.mjs'

let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 220) : '')) }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a))

const item = (n) => ({ url: 'https://r' + n + '.example/p', title: 'R' + n, snippet: 's' + n })
/** A scripted engine: `script` is a list of outcomes consumed one per call, the last one repeating. */
const engine = (id, access, script, extra = {}) => {
  const calls = []
  let i = 0
  return {
    id, access, refs: access === 'key' ? [{ ref: id.toUpperCase() + '_KEY' }] : [], calls,
    async run (arg) {
      calls.push(arg.query)
      const step = script[Math.min(i, script.length - 1)]
      i += 1
      if (step instanceof Error) throw step
      if (typeof step === 'function') return step(arg)
      return step
    },
    ...extra
  }
}
const clock = () => { const c = { t: 1_000_000, now: () => c.t, slept: [], async sleep (ms) { c.slept.push(ms); c.t += ms } }; return c }
const make = (engines, { settings = {}, keys = {}, c = clock() } = {}) => {
  const base = { order: engines.map((e) => e.id), enabled: Object.fromEntries(engines.map((e) => [e.id, true])), searxngUrl: '', customUrl: '', googleCx: '', wikiLang: 'en', domains: '', cacheMinutes: 0, timeoutS: 12 }
  const s = { ...base, ...settings, enabled: { ...base.enabled, ...(settings.enabled || {}) } }
  const router = createRouter({ engines, readSettings: () => s, key: async (ref) => keys[ref] || null, http: async () => ({}), now: c.now, sleep: c.sleep })
  return { router, c }
}
const rejects = async (p) => { try { await p; return null } catch (e) { return e } }

console.log('— the chain')
{
  const a = engine('a', 'free', [[item(1), item(2)]])
  const b = engine('b', 'free', [[item(9)]])
  const { router } = make([a, b])
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('the first engine that answers wins and the others are not asked', r.engine === 'a' && r.sources.length === 2 && b.calls.length === 0)
}
{
  const a = engine('a', 'free', [new EngineError('blocked', 'captcha')])
  const b = engine('b', 'free', [[item(1)]])
  const { router } = make([a, b])
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('a failing engine is skipped for the next one', r.engine === 'b' && a.calls.length === 1)
  await router.search({ query: 'q2', maxResults: 5 })
  ok('and not asked again while its pause lasts', a.calls.length === 1)
  const h = router.health('a')
  ok('the pause and its cause are reported', h.kind === 'blocked' && h.pausedUntil > 0 && h.failures === 1)
}
{
  const a = engine('a', 'free', [[]])
  const b = engine('b', 'free', [[item(1)]])
  const { router } = make([a, b])
  const r = await router.search({ query: 'q', maxResults: 5 })
  await router.search({ query: 'q2', maxResults: 5 })
  ok('an empty answer moves on to the next engine without pausing this one', r.engine === 'b' && a.calls.length === 2 && router.health('a').pausedUntil === null)
}
{
  const a = engine('a', 'free', [new EngineError('timeout', 'slow')])
  const c = clock()
  const { router } = make([a], { c })
  await rejects(router.search({ query: 'q', maxResults: 5 }))
  c.t += PAUSE_MS.timeout + 1
  const err = await rejects(router.search({ query: 'q', maxResults: 5 }))
  ok('a pause ends: the engine is asked again after it', a.calls.length === 2 && err !== null)
}
{
  const a = engine('a', 'free', [new EngineError('blocked', 'captcha')])
  const b = engine('b', 'free', [new EngineError('quota', 'slow down')])
  const { router } = make([a, b])
  const err = await rejects(router.search({ query: 'the secret query', maxResults: 5 }))
  ok('every engine failing is ONE provider error, with a code the seam knows', err !== null && err.code === 'WEB_PROVIDER_ERROR' && err.name === 'WebError')
  ok('the message says what each engine did and what to do, and not what was asked', /a: it asked for a challenge/.test(err.message) && /b: it is rate limited/.test(err.message) && /Settings > Web search/.test(err.message) && !/secret query/.test(err.message))
}

console.log('— which engines are asked')
{
  const keyed = engine('k', 'key', [[item(1)]])
  const free = engine('f', 'free', [[item(2)]])
  const { router } = make([keyed, free])
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('a keyed engine with no key is passed over, the free one answers', r.engine === 'f' && keyed.calls.length === 0)
}
{
  const keyed = engine('k', 'key', [[item(1)]])
  const free = engine('f', 'free', [[item(2)]])
  const { router } = make([keyed, free], { keys: { K_KEY: 'k-123456789' } })
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('with its key it answers first (order is the person\'s)', r.engine === 'k' && free.calls.length === 0)
}
{
  const a = engine('a', 'free', [[item(1)]])
  const b = engine('b', 'free', [[item(2)]])
  const { router } = make([a, b], { settings: { enabled: { a: false, b: true } } })
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('a switched-off engine is never asked', r.engine === 'b' && a.calls.length === 0)
}
{
  const a = engine('a', 'url', [[item(1)]], { field: 'searxngUrl' })
  const b = engine('b', 'free', [[item(2)]])
  const { router } = make([a, b])
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('an engine that needs an address nobody gave is passed over', r.engine === 'b' && a.calls.length === 0)
}
{
  const a = engine('a', 'free', [[item(1)]])
  const { router } = make([a], { settings: { enabled: { a: false } } })
  const err = await rejects(router.search({ query: 'q', maxResults: 5 }))
  ok('everything switched off: a clear error, and available() says so', err !== null && /switched off/.test(err.message) && router.available() === false)
}
ok('available() is true as soon as one engine is on', make([engine('a', 'free', [[]])]).router.available() === true)

console.log('— hygiene')
{
  const a = engine('a', 'free', [[
    { url: 'https://spam.example/x', title: 'spam' }, { url: 'https://good.example/1', title: 'good' }, { url: 'https://good.example/1?utm_source=z', title: 'dup' }, { url: 'javascript:alert(1)', title: 'bad' }
  ]])
  const { router } = make([a], { settings: { domains: '!spam.example' } })
  const r = await router.search({ query: 'q', maxResults: 5 })
  eq('the domain filter, the de-duplication and the URL check run on any engine\'s answer', r.sources.map((x) => x.url), ['https://good.example/1'])
}
{
  const a = engine('a', 'free', [Array.from({ length: 12 }, (_, i) => item(i))])
  const { router } = make([a])
  const r = await router.search({ query: 'q', maxResults: 3 })
  ok('no more than maxResults come back', r.sources.length === 3)
}
{
  const a = engine('a', 'free', [[item(1)]])
  const { router } = make([a])
  const err = await rejects(router.search({ query: '   ', maxResults: 5 }))
  ok('an empty query is refused before any engine is asked', err !== null && a.calls.length === 0)
}

console.log('— cache and spacing')
{
  const a = engine('a', 'free', [[item(1)], [item(2)]])
  const c = clock()
  const { router } = make([a], { settings: { cacheMinutes: 5 }, c })
  const r1 = await router.search({ query: 'Same Question', maxResults: 5 })
  const r2 = await router.search({ query: 'same question ', maxResults: 5 })
  ok('the same question within the cache time is answered from memory', a.calls.length === 1 && r2.cached === true && r2.sources[0].url === r1.sources[0].url)
  c.t += 6 * 60_000
  const r3 = await router.search({ query: 'same question', maxResults: 5 })
  ok('and asked again after it', a.calls.length === 2 && r3.sources[0].url === 'https://r2.example/p')
  const err = await rejects(make([engine('z', 'free', [new EngineError('server', 'x')])], { settings: { cacheMinutes: 5 } }).router.search({ query: 'q', maxResults: 5 }))
  ok('a failure is not cached', err !== null)
}
{
  const a = engine('a', 'free', [[item(1)]], { minIntervalMs: 1500 })
  const c = clock()
  const { router } = make([a], { c })
  await Promise.all([1, 2, 3].map((n) => router.search({ query: 'q' + n, maxResults: 5 })))
  ok('three queries fired at once are spaced by the engine\'s interval', a.calls.length === 3 && c.slept.filter((ms) => ms > 0).length === 2 && c.slept.every((ms) => ms <= 1500), JSON.stringify(c.slept))
}

console.log('— abort, forget, probe')
{
  const ctrl = new AbortController()
  const a = engine('a', 'free', [() => { ctrl.abort(); throw Object.assign(new Error('x'), { name: 'AbortError' }) }])
  const b = engine('b', 'free', [[item(1)]])
  const { router } = make([a, b])
  const err = await rejects(router.search({ query: 'q', maxResults: 5 }, ctrl.signal))
  ok('an aborted search is WEB_ABORTED, the next engine is not tried and nothing is paused', err !== null && err.code === 'WEB_ABORTED' && b.calls.length === 0 && router.health('a').pausedUntil === null)
}
{
  const a = engine('a', 'key', [new EngineError('auth', 'refused'), [item(1)]])
  const { router } = make([a], { keys: { A_KEY: 'a-123456789' } })
  await rejects(router.search({ query: 'q', maxResults: 5 }))
  ok('a refused key pauses the engine for an hour', router.health('a').pausedUntil > 0 && router.health('a').kind === 'auth')
  router.forget('a')
  const r = await router.search({ query: 'q', maxResults: 5 })
  ok('forget() (the key changed) lifts the pause', r.engine === 'a')
}
{
  const a = engine('a', 'free', [new EngineError('blocked', 'captcha'), [item(1), item(2)]])
  const { router } = make([a], { settings: { enabled: { a: false } } })
  const bad = await router.probe('a', 'hello')
  ok('probe reports the failure kind and does not throw', bad.ok === false && bad.kind === 'blocked')
  const good = await router.probe('a', 'hello')
  ok('probe asks an engine that is switched off, and returns a sample', good.ok === true && good.count === 2 && good.sample.length === 2)
  eq('probe of an unknown engine', (await router.probe('nope', 'x')).ok, false)
  const nokey = await make([engine('k', 'key', [[item(1)]])]).router.probe('k', 'x')
  ok('probe of a keyed engine with no key says it is missing', nokey.ok === false && nokey.kind === 'missing')
}
ok('explain(): only engine ids and fixed phrases', !/https?:/.test(explain([{ id: 'a', result: 'blocked' }, { id: 'b', result: 'paused' }])))

console.log('— settings')
{
  const s = normalizeSettings({ order: ['tavily', 'nope', 'tavily', 'brave-web'], enabled: { tavily: false, 'brave-web': 'yes' }, searxngUrl: 'ftp://x', customUrl: 'https://u.example/q', googleCx: 'bad cx!', wikiLang: 'FR', domains: 'a.com, !b.com', cacheMinutes: 999, timeoutS: 0 })
  ok('order keeps the known ids once, then appends the missing ones in default order', s.order[0] === 'tavily' && s.order[1] === 'brave-web' && s.order.length === 15 && new Set(s.order).size === 15)
  ok('enabled is a boolean per engine; unknown values fall back to the default', s.enabled.tavily === false && s.enabled['brave-web'] === true && s.enabled.wikipedia === false)
  ok('addresses must be http(s), ids and languages must look like ids and languages', s.searxngUrl === '' && s.customUrl === 'https://u.example/q' && s.googleCx === '' && s.wikiLang === 'en')
  ok('numbers are clamped', s.cacheMinutes === 60 && s.timeoutS === 3 && s.domains === 'a.com, !b.com')
  const p = applyPatch(s, { enabled: { wikipedia: true }, evil: 1, version: 7, searxngUrl: 'http://127.0.0.1:8080' })
  ok('a patch changes only the editable fields, and `enabled` merges key by key', p.enabled.wikipedia === true && p.enabled.tavily === false && p.searxngUrl === 'http://127.0.0.1:8080/' && p.version === 1 && p.evil === undefined)
}

console.log('\n' + (fail === 0 ? 'ALL CHECKS OK' : fail + ' check(s) FAILED'))
process.exit(fail === 0 ? 0 : 1)
