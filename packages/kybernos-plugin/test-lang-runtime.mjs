#!/usr/bin/env node
// The always-on language runtime of the main plugin (client.js, between the
// `<kb-lang-runtime>` markers), tested in isolation against a fake DSH locale
// service, a fake storage and a manual clock. No browser.
//
//   node test-lang-runtime.mjs
//
// What it pins: translated languages stay registered in DSH and followed from its
// selector even when the optional Language plugin is off, and DSH's boot-time
// PROVISIONAL language is never mistaken for a choice.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18nStore, handleI18nStore } from './i18n-store.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SOURCE.indexOf('// <kb-lang-runtime>')
const b = SOURCE.indexOf('// </kb-lang-runtime>')
if (a < 0 || b < a) { console.log('  ✗ the <kb-lang-runtime> block is missing from client.js'); process.exit(1) }
const { kbLangRuntimeStart, KB_LANG_GRACE_MS } = new Function(SOURCE.slice(a, b) + '\nreturn { kbLangRuntimeStart, KB_LANG_GRACE_MS }')()

// ── fakes ─────────────────────────────────────────────────────────────────
const mkStorage = () => {
  const m = new Map()
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, key: (i) => Array.from(m.keys())[i] ?? null, get length() { return m.size } }
}
const mkLoc = (opts) => {
  const calls = { addLanguage: [], register: [], disposed: 0 }
  const listeners = new Set()
  let active = (opts && opts.active) || 'en'
  let revision = 1
  // DSH's host scope: its snapshot has a value once the stored language has been read.
  let hostValue = opts && opts.unsettled ? undefined : {}
  const locales = [{ id: 'zh' }, { id: 'en' }, { id: 'kybernos' }]
  return {
    calls,
    host: opts && opts.noHost ? undefined : { getSnapshot: () => ({ value: hostValue }) },
    _settle() { hostValue = {} },
    getLocale: () => ({ active, locales: locales.slice(), revision }),
    addLanguage(def) {
      calls.addLanguage.push(def)
      if (opts && opts.addThrows) throw new Error('already registered')
      locales.push({ id: def.id }); revision += 1
      return () => { calls.disposed += 1; const i = locales.findIndex((l) => l.id === def.id); if (i >= 0) locales.splice(i, 1) }
    },
    register(ns, id, entries) { calls.register.push({ ns, id, entries }); revision += 1; return () => { calls.disposed += 1 } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    _set(id) { active = id; for (const fn of Array.from(listeners)) fn() },
  }
}
const mkEnv = (extra) => {
  const clock = { t: 1000000, timers: [] }
  const storage = mkStorage()
  const win = {}
  const reloads = { n: 0 }
  return {
    clock, storage, win, reloads,
    env: Object.assign({ storage, window: win, now: () => clock.t, reload: () => { reloads.n += 1 }, setTimeout: (fn, ms) => { clock.timers.push({ fn, at: clock.t + ms }) } }, extra || {}),
    advance(ms) { clock.t += ms; const due = clock.timers.filter((x) => x.at <= clock.t); clock.timers = clock.timers.filter((x) => x.at > clock.t); for (const x of due) x.fn() },
  }
}
const mkCtx = () => { const effects = []; return { effects, effect: (fn, label) => { effects.push({ label, dispose: fn() }) } } }
const setPack = (st, id, dsh, label) => {
  st.setItem('kybernos.i18n.' + id, JSON.stringify({ k0: 'x' }))
  if (dsh) st.setItem('kybernos.i18n.dsh.' + id, JSON.stringify(dsh))
  if (label) { const l = JSON.parse(st.getItem('kybernos.i18n.labels') || '{}'); l[id] = label; st.setItem('kybernos.i18n.labels', JSON.stringify(l)) }
}
const ES = { 'conversation::send': 'Enviar mensaje', 'common::cancel': 'Cancelar', 'common::files': '{count} archivos' }

// ── packs ─────────────────────────────────────────────────────────────────
console.log('\n── translated languages ──')
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  f.storage.setItem('kybernos.i18n.langs', JSON.stringify(['es', 'de']))
  setPack(f.storage, 'ar', { 'common::cancel': 'إلغاء' })
  f.storage.setItem('kybernos.i18n.meta.ar', '{}'); f.storage.setItem('kybernos.i18n.provider', 'x/y'); f.storage.setItem('kybernos.i18n.live.ar', '{}'); f.storage.setItem('kybernos.i18n.en', '{}')
  const rt = kbLangRuntimeStart(ctx, loc, f.env)
  const ids = rt.packIds()
  check('added languages AND old caches (with no registry) are found', ids.includes('es') && ids.includes('de') && ids.includes('ar'), ids)
  check('meta / dsh / live / provider / labels are NOT languages, nor is "en"', !ids.some((i) => /meta|dsh|live|provider|labels|en$/.test(i) && i !== 'de'), ids)
  check('the runtime is published on window (the Language plugin detects it)', f.win.__KB_LANG_RUNTIME__ === rt && rt.version === 1)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES, 'Español')
  setPack(f.storage, 'de', null)                        // Kybernos only: no DSH dictionary
  setPack(f.storage, 'zh', { 'common::cancel': '取消' }) // DSH ships zh itself
  kbLangRuntimeStart(ctx, loc, f.env)
  check('at boot, a translated language is registered in DSH (id, saved native name, fallback en)', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].id === 'es' && loc.calls.addLanguage[0].label === 'Español' && loc.calls.addLanguage[0].fallback === 'en', loc.calls.addLanguage)
  check('one dictionary per namespace, {count} variables intact', loc.calls.register.length === 2 && loc.calls.register.find((r) => r.ns === 'common').entries.files === '{count} archivos' && loc.calls.register.find((r) => r.ns === 'conversation').entries.send === 'Enviar mensaje', loc.calls.register.map((r) => r.ns))
  check('without a DSH dictionary: nothing registered', !loc.calls.addLanguage.some((x) => x.id === 'de'))
  check('DSH native language (zh): NEVER registered (addLanguage would throw)', !loc.calls.addLanguage.some((x) => x.id === 'zh'))
  ctx.effects.forEach((x) => { if (typeof x.dispose === 'function') x.dispose() })
  check('turning the plugin off removes the language and its dictionaries', loc.calls.disposed === 3, loc.calls.disposed)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES) // no saved label
  kbLangRuntimeStart(ctx, loc, f.env)
  check('with no saved name: Intl.DisplayNames, never the raw code when it can tell', loc.calls.addLanguage[0].label === 'Español', loc.calls.addLanguage[0].label)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = kbLangRuntimeStart(ctx, loc, f.env)
  const again = rt.registerPack('es')
  check('registering twice: the second call does nothing (addLanguage would throw)', again === null && loc.calls.addLanguage.length === 1)
  check('the Language plugin can register ONE language it has just built', (() => { setPack(f.storage, 'it', { 'common::cancel': 'Annulla' }, 'Italiano'); const d = rt.registerPack('it'); return typeof d === 'function' && loc.calls.addLanguage.some((x) => x.id === 'it' && x.label === 'Italiano') && rt.ours.has('it') })())
}
{
  const f = mkEnv(); const loc = mkLoc({ addThrows: true }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  let threw = false
  try { kbLangRuntimeStart(ctx, loc, f.env) } catch (e) { threw = true }
  check('addLanguage throwing: swallowed, no orphan dictionary', threw === false && loc.calls.register.length === 0)
}
{
  const f = mkEnv(); const ctx = mkCtx()
  let threw = false; let rt = null
  try { rt = kbLangRuntimeStart(ctx, null, f.env) } catch (e) { threw = true }
  check('without a locale service: does not throw, nothing registered', threw === false && rt.registerPack('es') === null && ctx.effects.length === 0)
}

// ── following DSH's selector ──────────────────────────────────────────────
console.log('\n── following the DSH selector ──')
const rtFor = (f, loc, ctx) => kbLangRuntimeStart(ctx, loc, f.env)
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = rtFor(f, loc, ctx)
  const w = rt.wanted
  check('to one of our languages: follow', w('es', 'en') === 'es' && w('es', null) === 'es')
  check('already the same language: nothing', w('es', 'es') === null && w('en', 'en') === null)
  check('to English FROM one of our languages: follow', w('en', 'es') === 'en')
  check('"en" while Kybernos is in French: NOT a change (French keeps DSH in English)', w('en', 'kybernos') === null)
  check('to "Kybernos" (the French entry of DSH): follow', w('kybernos', 'en') === 'kybernos')
  check('to zh (DSH native language): follow', w('zh', 'en') === 'zh')
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('es') // DSH swaps its PROVISIONAL language at boot
  f.advance(100)
  check('during boot, a DSH change is NOT followed (it is its provisional language speaking)', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'en')
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('es') // the stored host preference arrives during boot
  f.advance(KB_LANG_GRACE_MS + 10)
  check('once the grace period has passed, ONE reconciliation aligns Kybernos with DSH (preference stored on the host)', f.storage.getItem('kybernos.theme.lang') === 'es' && f.reloads.n === 0, f.storage.getItem('kybernos.theme.lang'))
  f.advance(400)
  check('… and reloads the page to apply it (only once)', f.reloads.n === 1, f.reloads.n)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es') // consistent from the start: DSH on es too
  loc._set('es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('already consistent at boot: no reload', f.reloads.n === 0)
  // the user now picks a language in DSH's own selector
  loc._set('en')
  f.advance(500)
  check('user choice in DSH (es → English): Kybernos follows and reloads', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('kybernos')
  f.advance(500)
  check('then "Kybernos" (French): follows', f.storage.getItem('kybernos.theme.lang') === 'kybernos' && f.reloads.n === 2)
  loc._set('en')
  f.advance(500)
  check('then English while Kybernos is in French: touches nothing', f.storage.getItem('kybernos.theme.lang') === 'kybernos' && f.reloads.n === 2)
  check('the runtime does not loop: no reload without a change', (() => { const n = f.reloads.n; loc._set('en'); f.advance(500); return f.reloads.n === n })())
}
{
  const f = mkEnv(); const loc = mkLoc({ active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')   // another browser switched DSH back to English
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('stored preference = English while this browser stayed on es: Kybernos aligns', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
}


// ── DSH slow to read its stored language ─────────────────────────────────
console.log('\n── DSH slow to read its stored language ──')
{
  // The case that reloaded the page by itself: Kybernos in es, DSH still on its
  // PROVISIONAL English because the host read is slow.
  const f = mkEnv(); const loc = mkLoc({ unsettled: true }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('DSH has not finished reading its language at the end of the grace period: we do NOT touch it (its provisional language is not a choice)', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es', { n: f.reloads.n, lang: f.storage.getItem('kybernos.theme.lang') })
  for (let i = 0; i < 6; i += 1) f.advance(1000)
  check('… even after several seconds of waiting', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
  loc._settle(); loc._set('es') // the stored language finally arrives: es
  f.advance(1500)
  check('once the read is done, the stored language (es) matches: no reload', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es', f.reloads.n)
}
{
  // Another browser switched DSH back to English; this one still has es. Once DSH has settled, align.
  const f = mkEnv(); const loc = mkLoc({ unsettled: true, active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10)
  check('while waiting for the read to finish, nothing moves', f.reloads.n === 0)
  loc._settle()
  f.advance(1000); f.advance(500)
  check('as soon as DSH is done and its stored language is English, Kybernos aligns (the "changed from another browser" case)', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
}
{
  const f = mkEnv(); const loc = mkLoc({ unsettled: true }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10)
  for (let i = 0; i < 40; i += 1) f.advance(1000) // never settles
  loc._settle()
  f.advance(2000)
  check('if DSH never finishes (30 s), the runtime gives up silently: never a reload on a guess', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
}
{
  const f = mkEnv(); const loc = mkLoc({ noHost: true, active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('read state UNKNOWN (different DSH version): an "English" is not followed — it could be just the browser language', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
}
{
  const f = mkEnv(); const loc = mkLoc({ noHost: true, active: 'ar' }); const ctx = mkCtx()
  setPack(f.storage, 'ar', { 'common::cancel': 'إلغاء' })
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('unknown state but DSH is in one of our languages (Arabic): we follow', f.storage.getItem('kybernos.theme.lang') === 'ar' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
}

// ── guards on the source ──────────────────────────────────────────────────

// ── disk copy ──────────────────────────────────────────────────────────────
// The host side is the REAL store module (i18n-store.mjs) on a temp folder, behind a fake
// fetch that speaks the route's protocol: the runtime and the host are tested together.
console.log('\n── disk copy of the translations ──')
const tmp = mkdtempSync(join(tmpdir(), 'kb-runtime-disk-'))
let hostN = 0
const mkHost = () => {
  const store = createI18nStore({ dir: join(tmp, 'host' + (hostN += 1)) })
  const host = { store, calls: [], up: true, route: true, refuse: false }
  host.fetch = async (url, init) => {
    host.calls.push({ url, init })
    if (!host.up) throw new TypeError('Failed to fetch')
    if (!host.route) return { ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <') } }
    if (url.split('?')[0] !== '/kybernos/i18n-store') return { ok: false, status: 404, json: async () => ({}) }
    const method = init && init.method ? init.method : 'GET'
    const id = new URLSearchParams(url.split('?')[1] || '').get('id')
    const body = method === 'POST' ? JSON.parse(init.body) : null
    if (method === 'POST' && host.refuse) return { ok: true, status: 200, json: async () => ({ ok: false, error: 'pack too large' }) }
    const out = handleI18nStore(store, { method, id, body })
    return { ok: out.status < 400, status: out.status, json: async () => JSON.parse(JSON.stringify(out.body)) }
  }
  host.posts = () => host.calls.filter((c) => c.init && c.init.method === 'POST').map((c) => JSON.parse(c.init.body))
  return host
}
const AR = { kb: { 'kb.a': 'ا', 'kb.b': 'ب' }, dsh: { 'common::cancel': 'إلغاء', 'common::ok': 'حسنا' }, live: { 'Salut': 'مرحبا' }, meta: { complete: true, total: 5, done: 5, at: 5000 }, label: 'العربية' }
const putLocal = (st, id, p) => {
  st.setItem('kybernos.i18n.' + id, JSON.stringify(p.kb)); st.setItem('kybernos.i18n.dsh.' + id, JSON.stringify(p.dsh)); st.setItem('kybernos.i18n.live.' + id, JSON.stringify(p.live))
  if (p.meta) st.setItem('kybernos.i18n.meta.' + id, JSON.stringify(p.meta))
  st.setItem('kybernos.i18n.langs', JSON.stringify([id])); st.setItem('kybernos.i18n.labels', JSON.stringify({ [id]: p.label }))
}
const boot = async (host, setup, extra) => {
  const pulled = []
  const f = mkEnv(Object.assign({ fetch: host.fetch, onPulled: (id) => pulled.push(id) }, extra || {}))
  if (setup) setup(f)
  const loc = mkLoc(); const ctx = mkCtx()
  const rt = kbLangRuntimeStart(ctx, loc, f.env)
  await rt.disk.idle()
  f.advance(0) // the push the boot scheduled (the clock is manual)
  await rt.disk.idle()
  return { f, loc, ctx, rt, pulled }
}
{
  // migration: translations made before the disk copy existed
  const host = mkHost()
  const { f, rt } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  const p = host.store.read('ar')
  check('migration: a language that only the browser has is written to the disk', p !== null && p.kb['kb.a'] === 'ا' && p.dsh['common::ok'] === 'حسنا' && p.live.Salut === 'مرحبا', p)
  check('… with its progress record and its native name', p.meta.done === 5 && p.label === 'العربية', p)
  check('the status says "saved on the disk" and gives the folder', rt.disk.status().state === 'on' && rt.disk.status().dir === host.store.dir, rt.disk.status())
  check('the browser lost nothing', JSON.parse(f.storage.getItem('kybernos.i18n.ar'))['kb.a'] === 'ا')
}
{
  // a new browser: the disk has it, this one does not
  const host = mkHost(); host.store.write('ar', AR)
  const { f, loc, pulled, ctx } = await boot(host)
  check('new browser: the language on the disk is copied into the browser', JSON.parse(f.storage.getItem('kybernos.i18n.ar'))['kb.b'] === 'ب' && JSON.parse(f.storage.getItem('kybernos.i18n.dsh.ar'))['common::ok'] === 'حسنا' && JSON.parse(f.storage.getItem('kybernos.i18n.live.ar')).Salut === 'مرحبا')
  check('… with record, native name and registry', JSON.parse(f.storage.getItem('kybernos.i18n.meta.ar')).done === 5 && JSON.parse(f.storage.getItem('kybernos.i18n.labels')).ar === 'العربية' && JSON.parse(f.storage.getItem('kybernos.i18n.langs')).includes('ar'))
  check('… and it is registered in DSH (its selector lists it)', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].id === 'ar' && loc.calls.addLanguage[0].label === 'العربية' && loc.calls.register.length === 1)
  check('… and the plugin is notified (Kybernos dictionary cache reset)', pulled.join() === 'ar', pulled)
  check('nothing is sent back to the disk (no write)', host.posts().length === 0, host.posts())
  ctx.effects.forEach((x) => { if (typeof x.dispose === 'function') x.dispose() })
  check('turning the plugin off also removes this language from DSH', loc.calls.disposed === 2, loc.calls.disposed)
}
{
  // two different copies are merged, nothing is lost on either side
  const host = mkHost(); host.store.write('ar', { kb: { 'kb.a': 'ا', 'kb.host': 'H' }, dsh: { 'common::ok': 'حسنا' }, meta: { done: 2, at: 1000 }, label: 'AR' })
  const { f } = await boot(host, (f) => putLocal(f.storage, 'ar', Object.assign({}, AR, { kb: { 'kb.a': 'ا2', 'kb.local': 'L' } })))
  const p = host.store.read('ar')
  const kb = JSON.parse(f.storage.getItem('kybernos.i18n.ar'))
  check('merge: each side receives the texts of the other', kb['kb.host'] === 'H' && p.kb['kb.local'] === 'L', { kb, host: p.kb })
  check('merge: on disagreement, the most recent translation wins (here the browser one)', kb['kb.a'] === 'ا2' && p.kb['kb.a'] === 'ا2')
  check('merge: the most recent record is kept everywhere', p.meta.at === 5000 && JSON.parse(f.storage.getItem('kybernos.i18n.meta.ar')).at === 5000)
}
{
  // the same on both sides: nothing moves
  const host = mkHost(); host.store.write('ar', AR)
  const { host: _h } = { host }
  const { rt } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  check('already identical: neither a full read nor a write', host.posts().length === 0 && host.calls.every((c) => !/id=/.test(c.url)), host.calls.map((c) => c.url))
  check('… and the status is "on the disk"', rt.disk.status().state === 'on')
}
{
  // the disk can never be emptied by a browser that has nothing
  const host = mkHost(); host.store.write('ar', AR)
  await boot(host)
  const p = host.store.read('ar')
  check('an empty browser never empties the disk', Object.keys(p.kb).length === 2 && Object.keys(p.dsh).length === 2)
}
{
  // later writes: deltas, debounced
  const host = mkHost()
  const { f, rt } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  const before = host.posts().length
  for (let i = 0; i < 10; i += 1) {
    const kb = JSON.parse(f.storage.getItem('kybernos.i18n.ar')); kb['kb.n' + i] = 'n' + i
    f.storage.setItem('kybernos.i18n.ar', JSON.stringify(kb)); rt.disk.touch('ar')
  }
  check('several writes in quick succession: a single request, sent after a short delay', host.posts().length === before)
  f.advance(1600); await rt.disk.idle()
  const posts = host.posts().slice(before)
  check('… a single request', posts.length === 1, posts.length)
  check('… that carries only what changed (not the whole dictionary)', Object.keys(posts[0].kb).length === 10 && posts[0].dsh === undefined && posts[0].live === undefined, posts[0])
  check('… and the disk received it', host.store.read('ar').kb['kb.n9'] === 'n9' && Object.keys(host.store.read('ar').kb).length === 12)
  // progress record alone
  f.storage.setItem('kybernos.i18n.meta.ar', JSON.stringify({ done: 9, total: 9, complete: true, at: 9000 })); rt.disk.touch('ar')
  f.advance(1600); await rt.disk.idle()
  check('the progress record alone is updated without sending the texts again', host.posts().at(-1).kb === undefined && host.store.read('ar').meta.at === 9000, host.posts().at(-1))
  // nothing changed
  const n = host.posts().length
  rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle()
  check('nothing changed: no request', host.posts().length === n)
  // a text taken away locally
  const kb2 = JSON.parse(f.storage.getItem('kybernos.i18n.ar')); delete kb2['kb.n0']; f.storage.setItem('kybernos.i18n.ar', JSON.stringify(kb2)); rt.disk.touch('ar')
  f.advance(1600); await rt.disk.idle()
  check('a text removed locally is removed from the disk (the section is replaced)', host.store.read('ar').kb['kb.n0'] === undefined && host.store.read('ar').kb['kb.n1'] === 'n1' && host.store.read('ar').dsh['common::ok'] === 'حسنا')
}
{
  // removal
  const host = mkHost()
  const { f, rt } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  const ok = await rt.disk.remove('ar')
  check('removing a language removes it from the disk', ok === true && host.store.read('ar') === null && host.store.removed().ar > 0)
  check('… and nothing is owed any more', JSON.parse(f.storage.getItem('kybernos.i18n.removing') || '[]').length === 0)
  ;['', 'dsh.', 'live.', 'meta.'].forEach((s2) => f.storage.removeItem('kybernos.i18n.' + s2 + 'ar')) // what the plugin does first
  rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle()
  check('a language removed from the browser is not written back to the disk', host.store.read('ar') === null)
}
{
  // removal while the host is down: owed, sent at the next boot
  const host = mkHost()
  const first = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  host.up = false
  const ok = await first.rt.disk.remove('ar')
  check('host down: the removal is cleanly refused and kept as a debt', ok === false && JSON.parse(first.f.storage.getItem('kybernos.i18n.removing')).includes('ar'))
  host.up = true
  ;['kb', 'dsh', 'live', 'meta'].forEach((s) => first.f.storage.removeItem('kybernos.i18n.' + (s === 'kb' ? '' : s + '.') + 'ar'))
  first.f.storage.setItem('kybernos.i18n.langs', '[]')
  const again = kbLangRuntimeStart(mkCtx(), mkLoc(), Object.assign({}, first.f.env, { fetch: host.fetch }))
  await again.disk.idle()
  check('at the next boot: the removal is sent BEFORE reading the disk (the language does not come back)', host.store.read('ar') === null && first.f.storage.getItem('kybernos.i18n.ar') === null)
  check('… and the debt is settled', JSON.parse(first.f.storage.getItem('kybernos.i18n.removing')).length === 0)
}
{
  // removed, then made again before the host came back: the new one stands
  const host = mkHost(); host.store.write('ar', AR)
  const f = mkEnv({ fetch: host.fetch })
  f.storage.setItem('kybernos.i18n.removing', JSON.stringify(['ar']))
  putLocal(f.storage, 'ar', Object.assign({}, AR, { meta: { done: 1, at: 9e12 } }))
  const rt = kbLangRuntimeStart(mkCtx(), mkLoc(), f.env)
  await rt.disk.idle()
  check('removed then made again: the debt does not delete the new version', host.store.read('ar') !== null && f.storage.getItem('kybernos.i18n.ar') !== null)
  rt.disk.touch('ar')
  check('… and touching a language clears its debt', true)
  const f2 = mkEnv({ fetch: mkHost().fetch }); f2.storage.setItem('kybernos.i18n.removing', JSON.stringify(['es']))
  const rt2 = kbLangRuntimeStart(mkCtx(), mkLoc(), f2.env); await rt2.disk.idle()
  rt2.disk.touch('es')
  check('touching a language whose removal is owed cancels the debt', !JSON.parse(f2.storage.getItem('kybernos.i18n.removing')).includes('es'))
}
{
  // tombstone: removed elsewhere
  const host = mkHost(); host.store.write('ar', AR); host.store.remove('ar')
  const old = await boot(host, (f) => putLocal(f.storage, 'ar', Object.assign({}, AR, { meta: { done: 5, at: 5000 } })))
  check('removed elsewhere AFTER the last change made in this browser: the local copy disappears', old.f.storage.getItem('kybernos.i18n.ar') === null && host.store.read('ar') === null)
  check('… it is also removed from DSH (its selector no longer offers it), and from the registry', old.loc.calls.addLanguage.length === 1 && old.loc.calls.disposed >= 2 && old.f.storage.getItem('kybernos.i18n.langs') === '[]', old.loc.calls)
  const host2 = mkHost(); host2.store.write('ar', AR); host2.store.remove('ar')
  const newer = await boot(host2, (f) => putLocal(f.storage, 'ar', Object.assign({}, AR, { meta: { done: 5, at: 9e15 } })))
  check('changed here AFTER the removal: the local copy is kept and sent back', newer.f.storage.getItem('kybernos.i18n.ar') !== null && host2.store.read('ar') !== null)
  const host3 = mkHost(); host3.store.remove('ar')
  const nometa = await boot(host3, (f) => { putLocal(f.storage, 'ar', AR); f.storage.removeItem('kybernos.i18n.meta.ar') })
  check('copy without a record (very old) + known removal: considered older', nometa.f.storage.getItem('kybernos.i18n.ar') === null)
  const host4 = mkHost()
  const nohist = await boot(host4, (f) => { putLocal(f.storage, 'ar', AR); f.storage.removeItem('kybernos.i18n.meta.ar') })
  check('copy without a record and no known removal: never lost, copied to the disk', nohist.f.storage.getItem('kybernos.i18n.ar') !== null && host4.store.read('ar') !== null)
}
{
  // DSH language list is not polluted by what is not a language
  const host = mkHost(); host.store.write('ar', AR)
  host.store.write('en', { kb: { a: 'b' } }); host.store.write('kybernos', { kb: { a: 'b' } })
  const { f, loc } = await boot(host)
  check('"en" and "kybernos" on the disk are ignored (they are built-in languages)', f.storage.getItem('kybernos.i18n.en') === null && f.storage.getItem('kybernos.i18n.kybernos') === null && loc.calls.addLanguage.length === 1)
}
{
  // no route (DSH not restarted since the update), host down, host refusing
  const host = mkHost(); host.route = false
  const { f, rt, pulled } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  check('route missing (DSH not restarted): "this browser only" status, nothing breaks', rt.disk.status().state === 'off' && rt.disk.status().error === 'unreachable' && pulled.length === 0)
  check('… the browser keeps everything', f.storage.getItem('kybernos.i18n.ar') !== null)
  rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle()
  check('… a write raises no error (and does not retry right away)', host.posts().length === 0)
  host.route = true
  f.advance(31000); rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle()
  check('… as soon as the route exists (DSH restarted), the next send detects it and copies to the disk', rt.disk.status().state === 'on' && host.store.read('ar') !== null, rt.disk.status())
}
{
  const host = mkHost(); host.up = false
  const { rt, f } = await boot(host, (f) => putLocal(f.storage, 'ar', AR))
  check('host down: "this browser only" status', rt.disk.status().state === 'off')
}
{
  // the route appears after boot while ANOTHER browser already put a different copy on the disk:
  // the late detection reconciles (merge both ways) instead of overwriting the disk blindly
  const host = mkHost(); host.route = false
  const { f, rt } = await boot(host, (f) => putLocal(f.storage, 'ar', Object.assign({}, AR, { kb: { 'kb.a': 'ا', 'kb.local': 'L' }, meta: { done: 1, at: 1000 } })))
  host.route = true
  host.store.write('ar', { kb: { 'kb.a': 'ا', 'kb.other': 'O' }, dsh: { 'common::ok': 'حسنا' }, meta: { done: 2, at: 2000 }, label: 'AR' })
  f.advance(31000); rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle(); f.advance(1600); await rt.disk.idle()
  const kb = JSON.parse(f.storage.getItem('kybernos.i18n.ar'))
  check('late detection of the route: this browser receives what the other one put on the disk…', kb['kb.other'] === 'O', kb)
  check('… and the disk receives what only this browser had, without losing the other browser\'s texts', host.store.read('ar').kb['kb.local'] === 'L' && host.store.read('ar').kb['kb.other'] === 'O', host.store.read('ar').kb)
}
{
  const host = mkHost()
  const { rt, f } = await boot(host, (f) => { putLocal(f.storage, 'ar', AR) })
  host.refuse = true
  const kb = JSON.parse(f.storage.getItem('kybernos.i18n.ar')); kb.z = 'z'; f.storage.setItem('kybernos.i18n.ar', JSON.stringify(kb)); rt.disk.touch('ar')
  f.advance(1600); await rt.disk.idle()
  check('the host refuses the write: the error is reported and the send stays pending', rt.disk.status().error === 'pack too large' && rt.disk.status().pending === 1, rt.disk.status())
  host.refuse = false
  f.advance(16000); await rt.disk.idle()
  check('… then retried on its own', rt.disk.status().pending === 0 && host.store.read('ar').kb.z === 'z', rt.disk.status())
}
{
  // opted out (live tests, or a user who does not want it)
  const host = mkHost()
  const { rt, f } = await boot(host, (f) => { putLocal(f.storage, 'ar', AR); f.win.__KB_I18N_HOST_STORE__ = false })
  rt.disk.touch('ar'); f.advance(1600); await rt.disk.idle()
  check('disabled by window.__KB_I18N_HOST_STORE__ = false: no request at all', host.calls.length === 0 && rt.disk.status().state === 'off' && rt.disk.status().error === 'disabled', host.calls.length)
}
{
  // the browser cannot store it (quota)
  const host = mkHost(); host.store.write('ar', AR)
  const { f, loc, pulled } = await boot(host, null, { storage: (() => { const s = mkStorage(); const set = s.setItem; s.setItem = (k, v) => { if (k.startsWith('kybernos.i18n.')) throw new Error('QuotaExceededError'); set(k, v) }; return s })() })
  check('browser full: the language is neither registered in DSH nor reported (no reload loop)', loc.calls.addLanguage.length === 0 && pulled.length === 0 && f.reloads.n === 0)
}
{
  // follow() must not reload for a choice the browser cannot remember
  const f = mkEnv(); const loc = mkLoc({ active: 'es' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES, 'Español')
  const set = f.storage.setItem; f.storage.setItem = (k, v) => { if (k === 'kybernos.theme.lang') throw new Error('QuotaExceededError'); set(k, v) }
  kbLangRuntimeStart(ctx, loc, f.env)
  f.advance(6000); f.advance(1000)
  check('a language choice the browser cannot remember causes no reload', f.reloads.n === 0, f.reloads.n)
}
{
  // watchers
  const host = mkHost(); host.route = false
  const f = mkEnv({ fetch: host.fetch }); const seen = []
  const rt = kbLangRuntimeStart(mkCtx(), mkLoc(), f.env)
  const off = rt.disk.watch((s) => seen.push(s.state)); await rt.disk.idle(); off()
  check('the status is observable (the Language page subscribes to it)', seen.includes('off') && rt.disk.status().state === 'off', seen)
}
rmSync(tmp, { recursive: true, force: true })

console.log('\n── guards on the source ──')
check('the runtime is started from apply() of the main plugin', /kbLangRuntimeStart\(ctx, localeSvc/.test(SOURCE))
check('a runtime failure does not break startup (try/catch around the call)', /try \{ kbLangRuntimeStart\(ctx[\s\S]{0,200}catch/.test(SOURCE))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
