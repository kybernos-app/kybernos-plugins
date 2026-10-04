#!/usr/bin/env node
// Browser half of kybernos-language: languages, sources, the engine, the run, the
// DSH language pack and live translation — against a fake host and a fake DSH
// locale service. No browser, no dependency.
//
//   node test-client.mjs
//
// The page itself (React) is covered against the real GUI by
// scripts/check-language-live.mjs; this file pins everything that can break
// without a browser. What the first versions got wrong, and what stays pinned:
//  - a failed batch counted as translated (the bar reached 100 % with nothing
//    translated, then the language was activated empty);
//  - the host's error was swallowed;
//  - a partial cache counted as "complete", so a half-translated language could
//    neither be resumed nor finished;
//  - progress the browser refused to store was still reported.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// The always-on runtime lives in the main plugin: load the REAL one (between its
// markers), so both halves are tested together rather than against a stand-in.
const MAIN = readFileSync(new URL('../kybernos-plugin/client.js', import.meta.url), 'utf8')
const { kbLangRuntimeStart } = new Function(MAIN.slice(MAIN.indexOf('// <kb-lang-runtime>'), MAIN.indexOf('// </kb-lang-runtime>')) + '\nreturn { kbLangRuntimeStart }')()

// ── environment ───────────────────────────────────────────────────────────
const store = new Map()
let quotaFull = false
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (quotaFull) throw new Error('QuotaExceededError'); store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
let reloads = 0
globalThis.location = { reload: () => { reloads += 1 } }
let definition
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } }, setTimeout: (fn) => { fn(); return 0 }, clearTimeout: () => {} }
new Function('window', SOURCE)(globalThis.window)
const modele = definition.factory(() => ({ createElement: () => ({}), Fragment: 'F' }))
const T = modele.__test

// KB_T: 100 keys, one without French, one over the limit; plus kbf phrases.
const KB_T = {}
for (let i = 0; i < 100; i += 1) KB_T['k' + i] = { kybernos: 'Texte français numéro ' + i, en: 'English ' + i }
KB_T.sansFr = { en: 'only english' }
KB_T['x'.repeat(250)] = { kybernos: 'clé trop longue', en: 'too long key' }
const KB_FR_EN = { 'Une phrase kbf': 'A kbf phrase', 'k1': 'ignoré : déjà dans KB_T', ['y'.repeat(300)]: 'trop long' }

// A fake DSH locale service: `dicts` is a Map ns → Map locale → entries, as in the engine.
const mkLoc = (extra) => {
  const dicts = new Map()
  const put = (ns, en) => dicts.set(ns, new Map([['en', en], ['zh', {}]]))
  put('common', { cancel: 'Cancel', close: 'Close', files: '{count} files' })
  put('sidebarRight', { title: 'Panels', hint: '•' })
  put('conversation', { send: 'Send message', stop: 'Stop' })
  put('settings.models', { add: 'Add a model' })
  put('pluginManager', { install: 'Install plugin', remove: 'Remove plugin' })
  put('trajectory', { replay: 'Replay the run' })
  const calls = { addLanguage: [], register: [], setLocale: [], disposed: 0 }
  const listeners = new Set()
  let revision = 1
  let active = 'en'
  const locales = [{ id: 'zh' }, { id: 'en' }]
  const loc = {
    dicts, calls,
    getLocale: () => ({ active, locales: locales.slice(), revision }),
    addLanguage(def) {
      calls.addLanguage.push(def)
      if (extra && extra.addLanguageThrows) throw new Error('already registered')
      locales.push({ id: def.id }); revision += 1
      return () => { calls.disposed += 1; const i = locales.findIndex((l) => l.id === def.id); if (i >= 0) locales.splice(i, 1) }
    },
    register(ns, id, entries) { calls.register.push({ ns, id, entries }); revision += 1; return () => { calls.disposed += 1 } },
    setLocale(id) { calls.setLocale.push(id); active = id; for (const fn of Array.from(listeners)) fn() },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    _set(id) { active = id; for (const fn of Array.from(listeners)) fn() },
    _addDict(ns, en) { put(ns, en); revision += 1 },
  }
  return loc
}

const setSource = () => { globalThis.window.__KB_T__ = KB_T; globalThis.window.__KB_FR_EN__ = KB_FR_EN }
let loc = null
const reset = (withDsh) => {
  store.clear(); quotaFull = false; reloads = 0
  delete globalThis.window.__KB_T__; delete globalThis.window.__KB_FR_EN__; delete globalThis.window.__KB_I18N_ACTIVE__; delete globalThis.window.__KB_LANG_RESOLVE__
  loc = withDsh === false ? null : mkLoc()
  T.setLocale(loc)
  delete globalThis.window.__KB_LANG_RUNTIME__
  // The disk copy is opted out here: the fake host of these tests would answer the runtime's
  // store calls as if they were translations. Its tests: test-lang-runtime.mjs, and the section below.
  globalThis.window.__KB_I18N_HOST_STORE__ = false
  startRuntime()
}
// The runtime as the main plugin starts it: no boot timers here (see test-lang-runtime.mjs).
const startRuntime = () => kbLangRuntimeStart({ effect: (fn) => { fn() } }, loc, { storage: localStorage, window: globalThis.window, reload: () => { reloads += 1 }, setTimeout: () => {}, now: () => 0 })
const RT = () => globalThis.window.__KB_LANG_RUNTIME__

// A fake host. `behaviour(body, n)` answers each POST; `calls` keeps the bodies.
const installHost = (behaviour) => {
  const calls = []
  const urls = []
  let inFlight = 0
  const peak = { n: 0 }
  globalThis.fetch = async (url, init) => {
    urls.push(String(url))
    const body = init && init.body ? JSON.parse(init.body) : null
    calls.push(body)
    if (init && init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    inFlight += 1; peak.n = Math.max(peak.n, inFlight)
    try {
      await new Promise((r) => setTimeout(r, 2))
      const out = await behaviour(body, calls.length, init)
      if (out === 'throw') throw new Error('connect ECONNREFUSED')
      return { ok: out.status === undefined || out.status < 400, status: out.status || 200, json: async () => out.json }
    } finally { inFlight -= 1 }
  }
  return { calls, urls, peak }
}
const translateAll = (body) => ({ json: { ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(body.batch).map((k) => [k, 'AR:' + body.batch[k]])) } })
const opts = (extra) => Object.assign({ route: null, signal: new AbortController().signal, onProgress: null }, extra || {})
const kbCount = 102 // 100 + sansFr + 1 phrase … + page strings, computed below
const pageCount = () => T.kbSources().filter((s) => s.id.length > 0).length - 102

// ── languages: ISO list, names, direction ─────────────────────────────────
console.log('\n── languages: ISO 639-1 list ──')
{
  const iso = T.ISO_639_1
  check('complete ISO 639-1 list (184 codes)', iso.length === 184, iso.length)
  check('all codes are two letters long, with no duplicate', iso.every((c) => /^[a-z]{2}$/.test(c)) && new Set(iso).size === iso.length)
  check('contains the common languages', ['es', 'de', 'ar', 'zh', 'ja', 'hi', 'pt', 'ru', 'he', 'fa'].every((c) => iso.includes(c)))
  check('the "popular" ones are all in the ISO list', T.POPULAR.every((c) => iso.includes(c)))
  const es = T.langInfo('es')
  check('native name and English name (Intl.DisplayNames)', es.native === 'Español' && es.english === 'Spanish', es)
  const ja = T.langInfo('ja')
  check('non-Latin native name', ja.native === '日本語' && ja.english === 'Japanese', ja)
  check('"Français" remains the name of the source language', T.langInfo('kybernos').native === 'Français')
  check('official ISO English names, independent of the browser ("Afar", "Haitian Creole", "Western Frisian")', T.langInfo('aa').english === 'Afar' && T.langInfo('ht').english === 'Haitian Creole' && T.langInfo('fy').english === 'Western Frisian' && T.langInfo('tw').english === 'Twi', ['aa', 'ht', 'fy', 'tw'].map((c) => T.langInfo(c).english))
  check('no entry boils down to its code ("Aa aa")', iso.every((c) => T.langInfo(c).english.toLowerCase() !== c && T.langInfo(c).english.length > 2), iso.filter((c) => T.langInfo(c).english.length <= 2))
  check('English names all distinct (except deliberate variants)', new Set(iso.map((c) => T.langInfo(c).english)).size === iso.length)
  check('right-to-left: ar, he, fa, ur', ['ar', 'he', 'fa', 'ur'].every((c) => T.langInfo(c).rtl === true) && T.langInfo('es').rtl === false)
  check('every code in the list gives a usable name', iso.every((c) => { const i = T.langInfo(c); return typeof i.native === 'string' && i.native.length > 0 && typeof i.english === 'string' }))
}

// ── languages: registry ───────────────────────────────────────────────────
console.log('\n── languages: registry ──')
{
  reset()
  T.registryAdd('es'); T.registryAdd('es'); T.registryAdd('de')
  check('adding a language remembers it, with no duplicate', JSON.stringify(T.registryRead()) === '["es","de"]', T.registryRead())
  localStorage.setItem('kybernos.i18n.ar', JSON.stringify({ a: 'b' }))
  localStorage.setItem('kybernos.i18n.meta.ar', '{}')
  localStorage.setItem('kybernos.i18n.dsh.ar', '{}')
  localStorage.setItem('kybernos.i18n.provider', 'x/y')
  const ids = T.managedIds()
  check('an old cache (with no registry) is found', ids.includes('ar') && ids.includes('es') && ids.includes('de'), ids)
  check('the meta / dsh / provider keys are NOT languages', !ids.some((i) => /meta|dsh|provider|live/.test(i)), ids)
  T.dropLanguage('es')
  check('removing: registry and caches erased', !T.registryRead().includes('es') && !T.managedIds().includes('es'))
}

// ── sources ───────────────────────────────────────────────────────────────
console.log('\n── sources ──')
reset()
check('without window.__KB_T__: null (no scraping of the plugin source)', T.kbSources() === null)
setSource()
{
  const s = T.kbSources()
  const byId = (id) => s.find((x) => x.id === id)
  check('KB_T keys + kbf phrases, "kb:" prefix on the wire', byId('k0').text === 'Texte français numéro 0' && byId('k0').wire === 'kb:k0' && byId('Une phrase kbf').area === 'phrases')
  check('key with no French text: the key stands in as the source', byId('sansFr').text === 'sansFr')
  check('keys that are too long are dropped (the host would refuse them: they would stay "missing" forever)', s.every((x) => x.wire.length <= 200))
  check('kbf phrase that is already a KB_T key: not overwritten', byId('k1').text === 'Texte français numéro 1' && byId('k1').area === 'core')
  check('the texts of the page itself are sources', byId('Démarrer la traduction') !== undefined && byId('Démarrer la traduction').area === 'core')
  check('no duplicate', new Set(s.map((x) => x.wire)).size === s.length)
}
{
  const d = T.dshSources()
  check('DSH: the English dictionaries are read', d !== null && d.some((x) => x.wire === 'dsh:conversation::send' && x.text === 'Send message'), d && d.length)
  check('DSH: areas — the essentials (chat, settings, common) before the rest', d.find((x) => x.id === 'conversation::send').area === 'core' && d.find((x) => x.id === 'settings.models::add').area === 'core' && d.find((x) => x.id === 'pluginManager::install').area === 'more' && d.find((x) => x.id === 'trajectory::replay').area === 'more')
  check('DSH: a text with no letter ("•") is dropped', !d.some((x) => x.id === 'sidebarRight::hint'))
  check('DSH: {count} variables stay in the source', d.find((x) => x.id === 'common::files').text === '{count} files')
  check('DSH: read is memoized as long as the registry does not change', T.dshSources() === d)
  loc._addDict('late', { x: 'Late namespace' })
  check('DSH: a namespace registered later is seen', T.dshSources().some((x) => x.id === 'late::x'))
}
{
  T.setLocale({ getLocale: () => ({ locales: [], revision: 1 }), dicts: {} })
  check('DSH: unknown registry shape → null (degrades, never throws)', T.dshSources() === null)
  T.setLocale(null)
  check('DSH: service absent → null', T.dshSources() === null)
  reset()
}

console.log('\n── plan ──')
reset(); setSource()
{
  const plan = T.buildPlan('es')
  const kb = T.kbSources().length
  check('the plan brings Kybernos and DSH together', plan.dshAvailable === true && plan.total === kb + T.dshSources().length, plan.total)
  check('areas counted', plan.areas.core.total + plan.areas.more.total + plan.areas.phrases.total === plan.total && plan.areas.more.total === 3)
  const zh = T.buildPlan('zh')
  check('zh: DSH already translates it → only the Kybernos strings', zh.dshNative === true && zh.dshAvailable === false && zh.total === kb, zh.total)
  reset(false); setSource()
  const none = T.buildPlan('es')
  check('without a locale service: Kybernos alone, and the plan says so', none.dshAvailable === false && none.dshNative === false && none.total === T.kbSources().length)
  reset(); setSource()
}

// ── an older installation: a dictionary and no progress record ──────────────────────
console.log('\n── older installation (dictionary without a progress record) ──')
{
  reset(); setSource()
  const plan = T.buildPlan('ar')
  const kbItems = plan.items.filter((i) => i.store === 'kb')
  // What the previous engine left: Kybernos' tables only — no meta, no registry, no DSH half.
  const legacy = {}
  for (const it of kbItems) legacy[it.id] = 'AR:' + it.text
  localStorage.setItem('kybernos.i18n.ar', JSON.stringify(legacy))
  const held = T.heldBy('ar', plan)
  check('the translation has not disappeared: we count what the storage really holds', held.done === kbItems.length && held.done > 0, held)
  check('… without a progress record, the row no longer says "0 %": about half is done (Kybernos yes, DSH no)', held.done / plan.total > 0.4 && held.done / plan.total < 0.99, held.done / plan.total)
  check('… the language is spotted from its cache alone (no registry)', T.managedIds().includes('ar') && T.metaRead('ar').done === undefined)
  check('the essentials are NOT announced while the DSH essentials are missing', held.essentials === false)
  check('memoized as long as the storage does not change', T.heldBy('ar', plan) === held)
  const dshCore = plan.items.filter((i) => i.store === 'dsh' && i.area === 'core')
  const dshDict = {}
  for (const it of dshCore) dshDict[it.id] = 'AR:' + it.text
  localStorage.setItem('kybernos.i18n.dsh.ar', JSON.stringify(dshDict))
  const held2 = T.heldBy('ar', plan)
  check('as soon as the DSH core is translated too, the essentials are ready ("Use now" button)', held2.essentials === true && held2.done === held.done + dshCore.length, held2)
  check('a missing plan (source unavailable) does not crash', T.heldBy('ar', null) === null)
}
check('a language in use but incomplete keeps a button to finish it', /if \(inUse\) \{[\s\S]{0,400}if \(!complete && !running\) acts\.push\(goButton\(\)\)/.test(SOURCE))
check('a language that holds translations can be used as is ("Use anyway")', /else if \(done > 0\) acts\.push\(h\('button', \{ key: 'any'/.test(SOURCE))

// ── engine: success ───────────────────────────────────────────────────────
console.log('\n── engine: success ──')
{
  reset(); setSource()
  const host = installHost(translateAll)
  const seen = []
  const plan = T.buildPlan('es')
  const r = await T.runTranslation('es', opts({ onProgress: (p) => seen.push(p) }))
  check('ok, everything translated', r.ok === true && r.done === plan.total && r.total === plan.total && r.missing === 0, r)
  check('Kybernos cache and DSH cache written separately', Object.keys(T.i18nRead('es')).length === T.kbSources().length && Object.keys(T.dshRead('es')).length === T.dshSources().length)
  check('DSH keys stored as "ns::key"', T.dshRead('es')['conversation::send'] === 'AR:Send message')
  check('meta "complete" with the total and the time', T.metaRead('es').complete === true && T.metaRead('es').total === plan.total && T.metaRead('es').essentials === true && T.metaRead('es').at > 0, T.metaRead('es'))
  check('monotonic progress, ends at the total', seen.every((p, i) => i === 0 || p.done >= seen[i - 1].done) && seen[seen.length - 1].done === plan.total)
  check('progress PER AREA', seen[seen.length - 1].areas.core.done === plan.areas.core.total && seen[seen.length - 1].areas.more.done === plan.areas.more.total)
  check('the model actually used is reported', seen[seen.length - 1].model === 'p/m')
  check('only the host route is called (never a provider from the browser)', host.urls.every((u) => u === '/kybernos/i18n-translate'), [...new Set(host.urls)])
  check('batches of at most 40 keys', host.calls.every((c) => Object.keys(c.batch).length <= 40))
  check('the language name is sent with every batch (quality for rare languages)', host.calls.every((c) => c.lang === 'es' && c.langName === 'Spanish' && c.source === 'fr'), host.calls[0] && { l: host.calls[0].lang, n: host.calls[0].langName })
  check('several calls in parallel (3)', host.peak.n === 3, host.peak.n)
  check('isComplete: yes', T.isComplete('es') === true)
}
{
  // Order: the essentials first, so a language is usable early.
  reset(); setSource()
  const host = installHost(translateAll)
  await T.runTranslation('es', opts())
  const plan = T.buildPlan('es')
  const areaOf = new Map(plan.items.map((i) => [i.wire, i.area]))
  const rank = { core: 0, more: 1, phrases: 2 }
  // Calls are issued in batch order, so the items concatenated in call order are the run order.
  const ranks = host.calls.flatMap((c) => Object.keys(c.batch)).map((w) => rank[areaOf.get(w)])
  check('send order: all the essentials, then the advanced screens, then the messages', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]) && ranks[0] === 0 && ranks[ranks.length - 1] === 2, ranks.join('').slice(0, 40))
  }

// ── engine: failures ──────────────────────────────────────────────────────
console.log('\n── engine: host failure ──')
{
  reset(); setSource()
  const host = installHost(() => ({ json: { ok: false, error: 'ollama-cloud/x : MISSING_CREDENTIAL — OLLAMA_CLOUD_API_KEY is not set' } }))
  const r = await T.runTranslation('es', opts())
  check('ok:false, and it is the HOST error that comes back', r.ok === false && /MISSING_CREDENTIAL/.test(r.error), r)
  check('no string counted as translated', r.done === 0)
  check('fast stop after 3 failures in a row (not every batch)', host.calls.length <= 6, host.calls.length)
  check('nothing is cached', Object.keys(T.i18nRead('es')).length === 0 && T.metaRead('es').complete !== true)
  check('the error maps to a readable cause', T.friendlyError(r.error) === 'errKey')
}
{
  reset(); setSource()
  installHost(() => ({ status: 404, json: {} }))
  const r = await T.runTranslation('es', opts())
  check('route missing (404): readable "update" cause', r.ok === false && T.friendlyError(r.error) === 'errOld', r)
}
{
  reset(); setSource()
  installHost(() => 'throw')
  const r = await T.runTranslation('es', opts())
  check('host unreachable: readable cause', r.ok === false && T.friendlyError(r.error) === 'errHost', r)
}
{
  reset(); setSource()
  let n = 0
  installHost((body) => (++n === 2 ? { json: { ok: false, error: 'RATE_LIMIT' } } : translateAll(body)))
  const r = await T.runTranslation('es', opts())
  check('a single failed batch: the 2nd pass replays it, everything ends up translated', r.ok === true && r.done === r.total && r.missing === 0, r)
}
{
  const m = { MISSING_CREDENTIAL: 'errKey', INVALID_CREDENTIAL: 'errKey', AUTH: 'errAuth', ACCOUNT_QUOTA: 'errAuth', NO_ADAPTER: 'errNoModel', RATE_LIMIT: 'errRate', TIMEOUT: 'errSlow', UNREACHABLE: 'errHost', STORAGE_FULL: 'errStore' }
  check('each known cause has its message', Object.keys(m).every((c) => T.friendlyError('x : ' + c + ' — y') === m[c]), Object.keys(m).filter((c) => T.friendlyError('x : ' + c) !== m[c]))
  check('unknown cause: generic message', T.friendlyError('boum') === 'errTitle' && T.friendlyError(undefined) === 'errTitle')
}

// ── engine: partial, variables, resume ────────────────────────────────────
console.log('\n── engine: partial and resume ──')
{
  reset(); setSource()
  // The model skips every key ending in 7.
  const host = installHost((body) => ({ json: { ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(body.batch).filter((k) => !k.endsWith('7')).map((k) => [k, 'AR:' + body.batch[k]])) } }))
  const r = await T.runTranslation('es', opts())
  check('ok but missing > 0: the shortfall is REPORTED', r.ok === true && r.missing > 0 && r.done + r.missing === r.total, r)
  check('the 2nd pass sends only what is missing', Object.keys(host.calls[host.calls.length - 1].batch).every((k) => k.endsWith('7')))
  check('meta NOT "complete" → language not given as finished', T.isComplete('es') === false && T.metaRead('es').complete === false)
}
{
  reset(); setSource()
  const plan = T.buildPlan('es')
  const half = {}
  const first = plan.items.filter((i) => i.store === 'kb').slice(0, 50)
  for (const it of first) half[it.id] = 'AR:déjà'
  localStorage.setItem('kybernos.i18n.es', JSON.stringify(half))
  const host = installHost(translateAll)
  const seen = []
  const r = await T.runTranslation('es', opts({ onProgress: (p) => seen.push(p) }))
  const sent = host.calls.flatMap((c) => Object.keys(c.batch))
  check('does NOT send what is already translated', sent.every((w) => half[w.slice(3)] === undefined || !w.startsWith('kb:')) && sent.length === plan.total - 50, sent.length)
  check('the bar restarts from the point reached, not from 0', seen[0].done === 50 && seen[0].startedWith === 50, seen[0])
  check('translations already there are kept', T.i18nRead('es')[first[0].id] === 'AR:déjà' && r.done === plan.total)
}
{
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.es', JSON.stringify({ k0: 'AR:x' }))
  check('a PARTIAL cache is not "complete" (the old bug: it activated a half-empty language)', T.isComplete('es') === false)
  check('native languages: always usable', T.isComplete('kybernos') === true && T.isComplete('en') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: 50 }))
  check('meta "complete" but the plan has grown since: to be completed', T.isComplete('es') === false)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total }))
  check('meta "complete" up to date: usable', T.isComplete('es') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total - 3 }))
  check('3 more texts (DSH namespace registered late): still "ready", no alarming "99 %"', T.isComplete('es') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total - 40 }))
  check('40 more texts (plugin update): to be completed', T.isComplete('es') === false)
}

// ── engine: fallback route, pause, storage ────────────────────────────────
console.log('\n── engine: fallback model, pause, storage ──')
{
  reset(); setSource()
  const host = installHost((body) => ({ json: { ok: true, provider: 'groq', model: 'llama', translations: Object.fromEntries(Object.keys(body.batch).map((k) => [k, 'AR'])) } }))
  await T.runTranslation('es', opts({ route: { provider: 'ollama-cloud', model: 'dead' } }))
  check('first batches: the requested route', host.calls[0].provider === 'ollama-cloud' && host.calls[0].model === 'dead')
  check('following batches: the route the host actually used', host.calls.slice(3).every((c) => c.provider === 'groq' && c.model === 'llama'), host.calls.slice(3, 5).map((c) => c.provider))
}
{
  reset(); setSource()
  const control = new AbortController()
  let n = 0
  installHost((body) => { if (++n === 1) control.abort(); return translateAll(body) })
  const r = await T.runTranslation('es', opts({ signal: control.signal }))
  check('pause: "paused", progress kept', r.ok === false && r.paused === true && r.done > 0 && r.done < r.total, r)
  check('pause: what is translated is SAVED (forced write), resuming possible', Object.keys(T.i18nRead('es')).length + Object.keys(T.dshRead('es')).length === r.done && T.metaRead('es').done === r.done, { r: r.done, meta: T.metaRead('es') })
  check('pause: "essentials ready" is announced only at 100 % of the area', T.metaRead('es').essentials === false)
  installHost(translateAll)
  const r2 = await T.runTranslation('es', opts())
  check('resume: finishes the job without redoing what is already done', r2.ok === true && r2.done === r2.total)
}
{
  reset(); setSource()
  installHost(translateAll)
  quotaFull = true
  const r = await T.runTranslation('es', opts())
  check('storage full: clean stop with the cause', r.ok === false && T.friendlyError(r.error) === 'errStore', r)
  check('storage full: NO false progress (done = what is really kept)', r.done === 0, r)
}
{
  reset()
  const r = await T.runTranslation('es', opts())
  check('source missing: readable error', r.ok === false && T.friendlyError(r.error) === 'errOld', r)
}
{
  reset(); setSource()
  T.setLocale(null)
  installHost(translateAll)
  const r = await T.runTranslation('es', opts())
  check('without a readable DSH: Kybernos is still translated, complete', r.ok === true && r.missing === 0 && r.total === T.kbSources().length, r)
  check('… and nothing is written on the DSH side', Object.keys(T.dshRead('es')).length === 0)
}
check('duration estimate: plausible and never zero', T.estimateMinutes(5000) >= 3 && T.estimateMinutes(5000) <= 30 && T.estimateMinutes(1) >= 1, T.estimateMinutes(5000))
{
  const base = { done: 100, total: 1000, startedWith: 0, elapsedMs: 20000 }
  check('time left: unknown at the start (sample too thin)', T.minutesLeft({ done: 10, total: 1000, startedWith: 0, elapsedMs: 2000 }) === null)
  check('time left: computed from the measured speed', T.minutesLeft(base) === 3, T.minutesLeft(base))
  check('time left: does not count what was already done', T.minutesLeft({ done: 500, total: 1000, startedWith: 460, elapsedMs: 20000 }) === 4, T.minutesLeft({ done: 500, total: 1000, startedWith: 460, elapsedMs: 20000 }))
}

// ── the run (outlives the page) ───────────────────────────────────────────
console.log('\n── the run (outlives the page) ──')
const settle = async (...states) => { for (let i = 0; i < 400 && states.includes(T.getRun().state); i += 1) await new Promise((r) => setTimeout(r, 5)) }
{
  reset(); setSource()
  let release
  const gate = new Promise((r) => { release = r })
  installHost(async (body) => { await gate; return translateAll(body) })
  const states = []
  const off = T.subscribeRun((s) => states.push(s.state))
  check('starts', T.startRun('es', null) === true && T.getRun().state === 'running')
  check('starting a language adds it to the registry', T.registryRead().includes('es'))
  check('a 2nd start is REFUSED while a run is in progress (two runs would trample each other)', T.startRun('de', null) === false && T.startRun('es', null) === false)
  release()
  await settle('running')
  check('finished: "done", everything translated', T.getRun().state === 'done' && T.getRun().done === T.getRun().total && T.getRun().total > 0, T.getRun())
  check('finished: NO activation or reload (the user decides)', reloads === 0)
  check('subscribers followed the states', states.includes('running') && states[states.length - 1] === 'done', states)
  off()
}
{
  reset(); setSource()
  installHost(() => ({ json: { ok: false, error: 'AUTH — bad key' } }))
  T.startRun('es', null)
  await settle('running')
  check('failure: "failed" with the cause, no activation', T.getRun().state === 'failed' && /AUTH — bad key/.test(T.getRun().error) && reloads === 0, T.getRun())
}
{
  reset(); setSource()
  let release
  const gate = new Promise((r) => { release = r })
  installHost(async (body) => { await gate; return translateAll(body) })
  T.startRun('es', null)
  T.pauseRun()
  check('pause: the state goes through "pausing" (immediate feedback to the user)', T.getRun().state === 'pausing')
  check('pause: no restart during "pausing"', T.startRun('es', null) === false)
  release()
  await settle('running', 'pausing')
  check('pause: "paused", nothing activated', T.getRun().state === 'paused' && reloads === 0, T.getRun())
}
{
  reset(); setSource()
  const half = {}
  installHost((body) => ({ json: { ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(body.batch).filter((k) => !k.endsWith('7')).map((k) => [k, 'AR'])) } }))
  T.startRun('es', null)
  await settle('running')
  check('finished with gaps: "partial" + missing count', T.getRun().state === 'partial' && T.getRun().missing > 0, T.getRun())
}

// ── activation + DSH language pack ────────────────────────────────────────
console.log('\n── activation and DSH language ──')
{
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  T.activateLanguage('es')
  check('activating a translated language DURING this session: it is registered in DSH first (otherwise DSH cannot switch)', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].id === 'es' && loc.calls.register.length === 1, loc.calls)
  check('activating: remembered, DSH switched to THIS language, page reloaded', localStorage.getItem('kybernos.theme.lang') === 'es' && loc.calls.setLocale[0] === 'es' && reloads === 1, { lang: localStorage.getItem('kybernos.theme.lang'), set: loc.calls.setLocale, reloads })
  T.activateLanguage('es')
  check('activating twice: no second registration (addLanguage would throw)', loc.calls.addLanguage.length === 1)
  RT().ours.clear(); loc.calls.setLocale.length = 0
  T.activateLanguage('en')
  check('activating English: DSH goes back to en', loc.calls.setLocale[0] === 'en')
  T.activateLanguage('kybernos')
  check('activating French: DSH goes back to en (it has no fr)', loc.calls.setLocale[1] === 'en' && localStorage.getItem('kybernos.theme.lang') === 'kybernos')
  loc.getLocale().locales.push({ id: 'kybernos' })
  T.activateLanguage('kybernos')
  check('even if DSH knows a "kybernos" language (main plugin), French keeps DSH on en', loc.calls.setLocale[loc.calls.setLocale.length - 1] === 'en')
  loc.calls.setLocale.length = 0
  RT().ours.clear()
  T.activateLanguage('de')
  check('language DSH does not know (no DSH dict): DSH stays on en', loc.calls.setLocale[0] === 'en')
  T.setLocale(null)
  let threw = false
  try { T.activateLanguage('es') } catch (e) { threw = true }
  check('without a locale service: activating does not throw', threw === false)
  T.setLocale(loc)
}
{
  // Boot-time registration and following DSH's selector are the RUNTIME's job (see
  // test-lang-runtime.mjs); here, only that this plugin hands over to it.
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  check('the plugin asks the runtime to register (one language, once)', typeof T.registerDshPack('es') === 'function' && loc.calls.addLanguage.length === 1 && T.registerDshPack('es') === null && loc.calls.addLanguage.length === 1)
  check('… and the runtime marks it "ours" (the plugin keeps no list of its own)', RT().ours.has('es'))
}
{
  reset(); setSource()
  delete globalThis.window.__KB_LANG_RUNTIME__
  const plan = T.buildPlan('es')
  check('without the runtime (older core): the DSH half is not offered — it could not be registered', plan.dshAvailable === false && plan.dshNative === false && plan.total === T.kbSources().length, plan.total)
  check('… and the page can say so ("DSH cannot be translated with this version")', plan.dshAvailable === false)
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  check('without the runtime: registering does not throw and does nothing', T.registerDshPack('es') === null && loc.calls.addLanguage.length === 0)
  let threw = false
  try { T.activateLanguage('es') } catch (e) { threw = true }
  check('without the runtime: activating does not throw (DSH stays on en, only Kybernos follows)', threw === false && loc.calls.setLocale[loc.calls.setLocale.length - 1] === 'en')
}
{
  reset(); setSource()
  T.registryAdd('es'); T.registryAdd('ja'); T.registryAdd('es')
  const labels = JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}')
  check('adding a language saves its native name (the runtime needs it for the DSH selector, plugin off)', labels.es === 'Español' && labels.ja === '日本語', labels)
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  T.registerDshPack('es')
  check('… and DSH lists the language under that name', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].label === 'Español', loc.calls.addLanguage)
  T.dropLanguage('es')
  check('removing a language also erases its name', JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}').es === undefined && JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}').ja === '日本語')
  check('the "labels" and "langs" keys are not taken for languages', !T.managedIds().some((i) => i === 'labels' || i === 'langs'), T.managedIds())
}

// ── live translation ──────────────────────────────────────────────────────
console.log('\n── live translation: which texts ──')
{
  const yes = ['Appliquer au profil', 'Simple', 'Enregistrer', 'Délégation par le lead', 'Les agents de code externes que DSH peut piloter.', 'Commandes slash · 9', 'Tout vérifier', 'Maintenance', 'Open configuration file']
  const no = ['kybernos-plugins', 'DeepSeek', 'API', 'glm-5.3-flash', '/Users/x/y', 'https://example.com/a', 'name@company.com', 'v0.2.0-rc.2', '12', '•', 'x', '⟦déjà⟧', 'mcp__horloge__*', 'settings.yaml', 'OLLAMA_CLOUD_API_KEY', 'العربية', '日本語', '   ', 'a'.repeat(401)]
  check('interface texts kept', yes.every((t) => T.isLiveCandidate(t) === true), yes.filter((t) => T.isLiveCandidate(t) !== true))
  check('identifiers, paths, versions, e-mails, brand names, already translated text: dropped', no.every((t) => T.isLiveCandidate(t) === false), no.filter((t) => T.isLiveCandidate(t) !== false))
}

// ── disk copy: what this page tells the runtime ───────────────────────────
console.log('\n── disk copy: the page tells the runtime what changed ──')
{
  reset(); setSource()
  const seen = { touch: [], remove: [] }
  RT().disk = { touch: (id) => seen.touch.push(id), remove: (id) => seen.remove.push(id), watch: () => () => {}, status: () => ({ state: 'on', dir: '/x', error: '', pending: 0 }) }
  localStorage.setItem('kybernos.i18n.es', '{}')
  const w = (k) => { seen.touch.length = 0; T.__writeJson(k, { a: 'b' }); return seen.touch.slice() }
  check('writing a language\'s dictionary, DSH half, live texts or progress record touches that language',
    w('kybernos.i18n.es').join() === 'es' && w('kybernos.i18n.dsh.es').join() === 'es' && w('kybernos.i18n.live.es').join() === 'es' && w('kybernos.i18n.meta.es').join() === 'es' && w('kybernos.i18n.pt-BR').join() === 'pt-BR')
  check('… and a regional id is read whole', w('kybernos.i18n.meta.pt-BR').join() === 'pt-BR')
  check('settings that are not a language (labels, registry, model, help, theme language) touch nothing',
    ['kybernos.i18n.labels', 'kybernos.i18n.langs', 'kybernos.i18n.provider', 'kybernos.i18n.help', 'kybernos.theme.lang', 'kybernos.i18n.removing', 'kybernos.i18n.en.x', 'other'].every((k) => w(k).length === 0))
  seen.touch.length = 0
  T.registryAdd('de')
  check('adding a language touches it (so its name reaches the disk)', seen.touch.includes('de'))
  quotaFull = true
  seen.touch.length = 0
  check('a write the browser refused is not announced', T.__writeJson('kybernos.i18n.es', { a: 'b' }) === false && seen.touch.length === 0)
  quotaFull = false
  T.dropLanguage('es')
  check('removing a language asks the runtime to remove it from the disk too', seen.remove.join() === 'es', seen.remove)
  check('… and the browser\'s copy is gone', localStorage.getItem('kybernos.i18n.es') === null)
  RT().disk = { touch: () => { throw new Error('boom') }, remove: () => { throw new Error('boom') } }
  check('a failing disk copy never breaks the page (write and removal)', T.__writeJson('kybernos.i18n.es', {}) === true && (T.dropLanguage('de'), true))
  delete globalThis.window.__KB_LANG_RUNTIME__
  check('without the runtime nothing breaks either', T.__writeJson('kybernos.i18n.es', {}) === true && (T.dropLanguage('es'), true))
}
{
  reset(); setSource()
  const touched = new Set()
  RT().disk = { touch: (id) => touched.add(id), remove: () => {}, watch: () => () => {}, status: () => ({ state: 'on', dir: '/x', error: '', pending: 0 }) }
  installHost(translateAll)
  T.startRun('es', null)
  await settle('running')
  check('a whole translation run reaches the disk copy for that language only', T.getRun().state === 'done' && touched.size === 1 && touched.has('es'), [...touched])
}

// ── guards on the source ──────────────────────────────────────────────────
console.log('\n── guards on the source ──')
// ── help and tooltips ─────────────────────────────────────────────────────
console.log('\n── help and tooltips ──')
{
  const used = [...SOURCE.matchAll(/\bL\('(\w+)'/g)].map((m) => m[1])
  const defined = new Set([...SOURCE.matchAll(/^\s{8}(\w+): \[/gm)].map((m) => m[1]))
  const missing = [...new Set(used)].filter((k) => !defined.has(k))
  check('every L(\'…\') key used in the page exists in the text catalogue', used.length > 80 && missing.length === 0, missing)
  check('an unknown key is shown as is instead of emptying the page', T.L('cle_qui_nexiste_pas') === 'cle_qui_nexiste_pas')
  check('both the French AND English text are filled in everywhere (never an empty pair)', (() => { const pairs = [...SOURCE.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)]; return pairs.length > 80 && pairs.every((m) => m[2].trim() !== '' && m[3].trim() !== '') })())
  check('the {x} variables of a text are found in its English version (nothing is lost in translation)', (() => { const v = (x) => (x.match(/\{\w+\}/g) || []).sort().join(); return [...SOURCE.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)].every((m) => v(m[2]) === v(m[3])) })())
  const css = SOURCE.slice(SOURCE.indexOf('const css = `'), SOURCE.indexOf('\n`', SOURCE.indexOf('const css = `')))
  const used2 = [...new Set([...css.matchAll(/animation:(kbth-k-[\w-]+)/g)].map((m) => m[1]))]
  const keyframes = new Set([...css.matchAll(/@keyframes (kbth-k-[\w-]+)/g)].map((m) => m[1]))
  check('every animation of the mockup has its @keyframes (a typo would freeze it without an error)', used2.length >= 15 && used2.every((n) => keyframes.has(n)), used2.filter((n) => !keyframes.has(n)))
  check('all the mockup animations last 12 s (the steps stay in sync with the mockup)', [...css.matchAll(/animation:kbth-k-[\w-]+ (\d+)s/g)].every((m) => m[1] === '12'))
  check('reduced motion: animations stop and the mockup shows the final state', /prefers-reduced-motion:reduce\)\{[^}]*animation:none !important/.test(css))
  check('the stylesheet contains NO backtick (it would close the template and break the whole plugin)', !css.slice(css.indexOf('`') + 1).includes('`'))
  check('the mockup is hidden from screen readers behind its caption, and captures no click', /\.kbth-mm\{[^}]*pointer-events:none/.test(css) && /role: 'img', 'aria-label': L\('mockCaption'\)/.test(SOURCE))
  check('the mockup uses no data-lang attribute (it must not pass for a real row)', !/kbth-mm[^\n]*'data-lang'/.test(SOURCE))
  check('the help button is a real collapse/expand button (aria-expanded, aria-controls)', /'data-act': 'help', 'aria-expanded'[^\n]*'aria-controls': 'kbth-help'/.test(SOURCE))
  check('help opens by itself only while nothing is translated, then respects the choice', /managedIds\(\)\.length === 0/.test(SOURCE) && /I18N_HELP_KEY/.test(SOURCE))
  const titled = ['tipHelp', 'tipStart', 'tipResume', 'tipRetry', 'tipPause', 'tipUse', 'tipUseNow', 'tipInUse', 'tipRtl', 'tipProgress', 'tipAreaCore', 'tipAreaMore', 'tipAreaPhrases', 'tipEstimate', 'tipAdd', 'tipAddLang', 'tipModel', 'tipAdvanced', 'tipAgain', 'tipRemove', 'tipChooseModel', 'tipDetails']
  const code = SOURCE.replace(/^\s{8}\w+: \[.*$/gm, '') // the code, without the text catalogue
  check('every defined tooltip is actually set on a control', titled.every((k) => code.includes("'" + k + "'")), titled.filter((k) => !code.includes("'" + k + "'")))
}

check('no more calls to a provider from the browser', !/api\.groq\.com|ollama\.com|api\.openai\.com|api\.deepseek\.com|dashscope|openrouter\.ai|api\.anthropic\.com|chat\/completions/.test(SOURCE))
check('no more API key entry through prompt()', !/\bprompt\(/.test(SOURCE) && !/apikey/i.test(SOURCE))
check('no more scraping of the main plugin source', !/performance\.getEntriesByType|new Function\(/.test(SOURCE))
check('inject: slots + locale only', JSON.stringify(modele.inject) === JSON.stringify(['slots', 'locale']), modele.inject)
check('the plugin no longer keeps its own DSH registry: everything goes through the core runtime', !/loc\.addLanguage|loc\.register\(/.test(SOURCE) && !/\bfollowDshSelector\b/.test(SOURCE) && /__KB_LANG_RUNTIME__/.test(SOURCE))
check('the link under General › Language is a slot item (order 1, between Language=0 and Appearance=10)', /id: 'kybernos-language-link', order: 1/.test(SOURCE) && /settings\.general\.item/.test(SOURCE))
check('no flag emoji (a language is not a country)', !/[\u{1F1E6}-\u{1F1FF}]/u.test(SOURCE))
check('the internal read of DSH (dicts) is guarded by a shape test', /instanceof Map/.test(SOURCE))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
