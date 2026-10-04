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
import { readFileSync } from 'node:fs'

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
const mkEnv = () => {
  const clock = { t: 1000000, timers: [] }
  const storage = mkStorage()
  const win = {}
  const reloads = { n: 0 }
  return {
    clock, storage, win, reloads,
    env: { storage, window: win, now: () => clock.t, reload: () => { reloads.n += 1 }, setTimeout: (fn, ms) => { clock.timers.push({ fn, at: clock.t + ms }) } },
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
console.log('\n── langues traduites ──')
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  f.storage.setItem('kybernos.i18n.langs', JSON.stringify(['es', 'de']))
  setPack(f.storage, 'ar', { 'common::cancel': 'إلغاء' })
  f.storage.setItem('kybernos.i18n.meta.ar', '{}'); f.storage.setItem('kybernos.i18n.provider', 'x/y'); f.storage.setItem('kybernos.i18n.live.ar', '{}'); f.storage.setItem('kybernos.i18n.en', '{}')
  const rt = kbLangRuntimeStart(ctx, loc, f.env)
  const ids = rt.packIds()
  check('les langues ajoutées ET les caches anciens (sans registre) sont retrouvés', ids.includes('es') && ids.includes('de') && ids.includes('ar'), ids)
  check('méta / dsh / live / provider / labels ne sont PAS des langues, ni « en »', !ids.some((i) => /meta|dsh|live|provider|labels|en$/.test(i) && i !== 'de'), ids)
  check('le runtime est publié sur window (le plugin Langue le détecte)', f.win.__KB_LANG_RUNTIME__ === rt && rt.version === 1)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES, 'Español')
  setPack(f.storage, 'de', null)                        // Kybernos only: no DSH dictionary
  setPack(f.storage, 'zh', { 'common::cancel': '取消' }) // DSH ships zh itself
  kbLangRuntimeStart(ctx, loc, f.env)
  check('au démarrage, une langue traduite est enregistrée dans DSH (id, nom natif enregistré, repli en)', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].id === 'es' && loc.calls.addLanguage[0].label === 'Español' && loc.calls.addLanguage[0].fallback === 'en', loc.calls.addLanguage)
  check('un dictionnaire par espace de noms, variables {count} intactes', loc.calls.register.length === 2 && loc.calls.register.find((r) => r.ns === 'common').entries.files === '{count} archivos' && loc.calls.register.find((r) => r.ns === 'conversation').entries.send === 'Enviar mensaje', loc.calls.register.map((r) => r.ns))
  check('sans dictionnaire DSH : rien enregistré', !loc.calls.addLanguage.some((x) => x.id === 'de'))
  check('langue native de DSH (zh) : JAMAIS enregistrée (addLanguage lèverait)', !loc.calls.addLanguage.some((x) => x.id === 'zh'))
  ctx.effects.forEach((x) => { if (typeof x.dispose === 'function') x.dispose() })
  check('désactiver le plugin retire langue et dictionnaires', loc.calls.disposed === 3, loc.calls.disposed)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES) // no saved label
  kbLangRuntimeStart(ctx, loc, f.env)
  check('sans nom enregistré : Intl.DisplayNames, jamais le code brut quand il sait', loc.calls.addLanguage[0].label === 'Español', loc.calls.addLanguage[0].label)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = kbLangRuntimeStart(ctx, loc, f.env)
  const again = rt.registerPack('es')
  check('enregistrer deux fois : le second appel ne fait rien (addLanguage lèverait)', again === null && loc.calls.addLanguage.length === 1)
  check('le plugin Langue peut enregistrer UNE langue qu’il vient de construire', (() => { setPack(f.storage, 'it', { 'common::cancel': 'Annulla' }, 'Italiano'); const d = rt.registerPack('it'); return typeof d === 'function' && loc.calls.addLanguage.some((x) => x.id === 'it' && x.label === 'Italiano') && rt.ours.has('it') })())
}
{
  const f = mkEnv(); const loc = mkLoc({ addThrows: true }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  let threw = false
  try { kbLangRuntimeStart(ctx, loc, f.env) } catch (e) { threw = true }
  check('addLanguage qui lève : avalé, aucun dictionnaire orphelin', threw === false && loc.calls.register.length === 0)
}
{
  const f = mkEnv(); const ctx = mkCtx()
  let threw = false; let rt = null
  try { rt = kbLangRuntimeStart(ctx, null, f.env) } catch (e) { threw = true }
  check('sans service de locale : ne lève pas, rien enregistré', threw === false && rt.registerPack('es') === null && ctx.effects.length === 0)
}

// ── following DSH's selector ──────────────────────────────────────────────
console.log('\n── suivre le sélecteur de DSH ──')
const rtFor = (f, loc, ctx) => kbLangRuntimeStart(ctx, loc, f.env)
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = rtFor(f, loc, ctx)
  const w = rt.wanted
  check('vers une de nos langues : suivre', w('es', 'en') === 'es' && w('es', null) === 'es')
  check('déjà la même langue : rien', w('es', 'es') === null && w('en', 'en') === null)
  check('vers l’anglais DEPUIS une de nos langues : suivre', w('en', 'es') === 'en')
  check('« en » alors que Kybernos est en français : PAS un changement (le français garde DSH en anglais)', w('en', 'kybernos') === null)
  check('vers « Kybernos » (l’entrée française de DSH) : suivre', w('kybernos', 'en') === 'kybernos')
  check('vers zh (langue native de DSH) : suivre', w('zh', 'en') === 'zh')
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('es') // DSH swaps its PROVISIONAL language at boot
  f.advance(100)
  check('pendant le démarrage, un changement de DSH n’est PAS suivi (c’est sa langue provisoire qui parle)', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'en')
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('es') // the stored host preference arrives during boot
  f.advance(KB_LANG_GRACE_MS + 10)
  check('la période de grâce passée, UNE réconciliation aligne Kybernos sur DSH (préférence stockée sur l’hôte)', f.storage.getItem('kybernos.theme.lang') === 'es' && f.reloads.n === 0, f.storage.getItem('kybernos.theme.lang'))
  f.advance(400)
  check('… et recharge la page pour appliquer (une seule fois)', f.reloads.n === 1, f.reloads.n)
}
{
  const f = mkEnv(); const loc = mkLoc(); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  const rt = rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es') // consistent from the start: DSH on es too
  loc._set('es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('déjà cohérent au démarrage : aucun rechargement', f.reloads.n === 0)
  // the user now picks a language in DSH's own selector
  loc._set('en')
  f.advance(500)
  check('choix de l’utilisateur dans DSH (es → English) : Kybernos suit et recharge', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
  f.storage.setItem('kybernos.theme.lang', 'en')
  loc._set('kybernos')
  f.advance(500)
  check('puis « Kybernos » (français) : suit', f.storage.getItem('kybernos.theme.lang') === 'kybernos' && f.reloads.n === 2)
  loc._set('en')
  f.advance(500)
  check('puis English alors que Kybernos est en français : ne touche à rien', f.storage.getItem('kybernos.theme.lang') === 'kybernos' && f.reloads.n === 2)
  check('le runtime ne boucle pas : aucun rechargement sans changement', (() => { const n = f.reloads.n; loc._set('en'); f.advance(500); return f.reloads.n === n })())
}
{
  const f = mkEnv(); const loc = mkLoc({ active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')   // another browser switched DSH back to English
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('préférence stockée = English alors que ce navigateur est resté en es : Kybernos s’aligne', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
}


// ── DSH slow to read its stored language ─────────────────────────────────
console.log('\n── lecture lente de la langue stockée par DSH ──')
{
  // The case that reloaded the page by itself: Kybernos in es, DSH still on its
  // PROVISIONAL English because the host read is slow.
  const f = mkEnv(); const loc = mkLoc({ unsettled: true }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('DSH n’a pas fini de lire sa langue à la fin de la période de grâce : on n’y touche PAS (sa langue provisoire n’est pas un choix)', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es', { n: f.reloads.n, lang: f.storage.getItem('kybernos.theme.lang') })
  for (let i = 0; i < 6; i += 1) f.advance(1000)
  check('… même après plusieurs secondes d’attente', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
  loc._settle(); loc._set('es') // the stored language finally arrives: es
  f.advance(1500)
  check('la lecture finie, la langue stockée (es) concorde : aucun rechargement', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es', f.reloads.n)
}
{
  // Another browser switched DSH back to English; this one still has es. Once DSH has settled, align.
  const f = mkEnv(); const loc = mkLoc({ unsettled: true, active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10)
  check('en attendant la fin de la lecture, rien ne bouge', f.reloads.n === 0)
  loc._settle()
  f.advance(1000); f.advance(500)
  check('dès que DSH a fini et que sa langue stockée est English, Kybernos s’aligne (cas « changé depuis un autre navigateur »)', f.storage.getItem('kybernos.theme.lang') === 'en' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
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
  check('si DSH ne finit jamais (30 s), le runtime abandonne en silence : jamais de rechargement sur une supposition', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
}
{
  const f = mkEnv(); const loc = mkLoc({ noHost: true, active: 'en' }); const ctx = mkCtx()
  setPack(f.storage, 'es', ES)
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'es')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('état de la lecture INCONNU (version de DSH différente) : un « English » n’est pas suivi — il pourrait n’être que la langue du navigateur', f.reloads.n === 0 && f.storage.getItem('kybernos.theme.lang') === 'es')
}
{
  const f = mkEnv(); const loc = mkLoc({ noHost: true, active: 'ar' }); const ctx = mkCtx()
  setPack(f.storage, 'ar', { 'common::cancel': 'إلغاء' })
  rtFor(f, loc, ctx)
  f.storage.setItem('kybernos.theme.lang', 'en')
  f.advance(KB_LANG_GRACE_MS + 10); f.advance(500)
  check('état inconnu mais DSH est dans une de nos langues (arabe) : on suit', f.storage.getItem('kybernos.theme.lang') === 'ar' && f.reloads.n === 1, { lang: f.storage.getItem('kybernos.theme.lang'), n: f.reloads.n })
}

// ── guards on the source ──────────────────────────────────────────────────
console.log('\n── garde-fous sur le source ──')
check('le runtime est démarré depuis apply() du plugin principal', /kbLangRuntimeStart\(ctx, localeSvc/.test(SOURCE))
check('un échec du runtime ne casse pas le démarrage (try/catch autour de l’appel)', /try \{ kbLangRuntimeStart\(ctx[\s\S]{0,200}catch/.test(SOURCE))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
