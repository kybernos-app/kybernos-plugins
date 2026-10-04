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
console.log('\n── langues : liste ISO 639-1 ──')
{
  const iso = T.ISO_639_1
  check('liste ISO 639-1 complète (184 codes)', iso.length === 184, iso.length)
  check('tous les codes sont sur deux lettres, sans doublon', iso.every((c) => /^[a-z]{2}$/.test(c)) && new Set(iso).size === iso.length)
  check('contient les langues courantes', ['es', 'de', 'ar', 'zh', 'ja', 'hi', 'pt', 'ru', 'he', 'fa'].every((c) => iso.includes(c)))
  check('les « courantes » sont toutes dans la liste ISO', T.POPULAR.every((c) => iso.includes(c)))
  const es = T.langInfo('es')
  check('nom natif et nom anglais (Intl.DisplayNames)', es.native === 'Español' && es.english === 'Spanish', es)
  const ja = T.langInfo('ja')
  check('nom natif non latin', ja.native === '日本語' && ja.english === 'Japanese', ja)
  check('« Français » reste le nom de la langue source', T.langInfo('kybernos').native === 'Français')
  check('noms anglais ISO officiels, indépendants du navigateur (« Afar », « Haitian Creole », « Western Frisian »)', T.langInfo('aa').english === 'Afar' && T.langInfo('ht').english === 'Haitian Creole' && T.langInfo('fy').english === 'Western Frisian' && T.langInfo('tw').english === 'Twi', ['aa', 'ht', 'fy', 'tw'].map((c) => T.langInfo(c).english))
  check('aucune entrée ne se réduit à son code (« Aa aa »)', iso.every((c) => T.langInfo(c).english.toLowerCase() !== c && T.langInfo(c).english.length > 2), iso.filter((c) => T.langInfo(c).english.length <= 2))
  check('noms anglais tous distincts (sauf variantes volontaires)', new Set(iso.map((c) => T.langInfo(c).english)).size === iso.length)
  check('droite-à-gauche : ar, he, fa, ur', ['ar', 'he', 'fa', 'ur'].every((c) => T.langInfo(c).rtl === true) && T.langInfo('es').rtl === false)
  check('chaque code de la liste donne un nom exploitable', iso.every((c) => { const i = T.langInfo(c); return typeof i.native === 'string' && i.native.length > 0 && typeof i.english === 'string' }))
}

// ── languages: registry ───────────────────────────────────────────────────
console.log('\n── langues : registre ──')
{
  reset()
  T.registryAdd('es'); T.registryAdd('es'); T.registryAdd('de')
  check('ajouter une langue la mémorise, sans doublon', JSON.stringify(T.registryRead()) === '["es","de"]', T.registryRead())
  localStorage.setItem('kybernos.i18n.ar', JSON.stringify({ a: 'b' }))
  localStorage.setItem('kybernos.i18n.meta.ar', '{}')
  localStorage.setItem('kybernos.i18n.dsh.ar', '{}')
  localStorage.setItem('kybernos.i18n.provider', 'x/y')
  const ids = T.managedIds()
  check('un cache ancien (sans registre) est retrouvé', ids.includes('ar') && ids.includes('es') && ids.includes('de'), ids)
  check('les clés méta / dsh / provider ne sont PAS des langues', !ids.some((i) => /meta|dsh|provider|live/.test(i)), ids)
  T.dropLanguage('es')
  check('supprimer : registre et caches effacés', !T.registryRead().includes('es') && !T.managedIds().includes('es'))
}

// ── sources ───────────────────────────────────────────────────────────────
console.log('\n── sources ──')
reset()
check('sans window.__KB_T__ : null (pas de grattage du source du plugin)', T.kbSources() === null)
setSource()
{
  const s = T.kbSources()
  const byId = (id) => s.find((x) => x.id === id)
  check('clés de KB_T + phrases kbf, préfixe « kb: » sur le fil', byId('k0').text === 'Texte français numéro 0' && byId('k0').wire === 'kb:k0' && byId('Une phrase kbf').area === 'phrases')
  check('clé sans texte français : la clé tient lieu de source', byId('sansFr').text === 'sansFr')
  check('clés trop longues écartées (l’hôte les refuserait : elles resteraient « manquantes » à jamais)', s.every((x) => x.wire.length <= 200))
  check('phrase kbf déjà clé de KB_T : pas écrasée', byId('k1').text === 'Texte français numéro 1' && byId('k1').area === 'core')
  check('les textes de la page elle-même sont des sources', byId('Démarrer la traduction') !== undefined && byId('Démarrer la traduction').area === 'core')
  check('aucun doublon', new Set(s.map((x) => x.wire)).size === s.length)
}
{
  const d = T.dshSources()
  check('DSH : les dictionnaires anglais sont lus', d !== null && d.some((x) => x.wire === 'dsh:conversation::send' && x.text === 'Send message'), d && d.length)
  check('DSH : zones — l’essentiel (chat, réglages, commun) avant le reste', d.find((x) => x.id === 'conversation::send').area === 'core' && d.find((x) => x.id === 'settings.models::add').area === 'core' && d.find((x) => x.id === 'pluginManager::install').area === 'more' && d.find((x) => x.id === 'trajectory::replay').area === 'more')
  check('DSH : un texte sans lettre (« • ») est écarté', !d.some((x) => x.id === 'sidebarRight::hint'))
  check('DSH : les variables {count} restent dans la source', d.find((x) => x.id === 'common::files').text === '{count} files')
  check('DSH : lecture mémoïsée tant que le registre ne change pas', T.dshSources() === d)
  loc._addDict('late', { x: 'Late namespace' })
  check('DSH : un espace de noms enregistré plus tard est vu', T.dshSources().some((x) => x.id === 'late::x'))
}
{
  T.setLocale({ getLocale: () => ({ locales: [], revision: 1 }), dicts: {} })
  check('DSH : forme de registre inconnue → null (dégradation, jamais une exception)', T.dshSources() === null)
  T.setLocale(null)
  check('DSH : service absent → null', T.dshSources() === null)
  reset()
}

console.log('\n── plan ──')
reset(); setSource()
{
  const plan = T.buildPlan('es')
  const kb = T.kbSources().length
  check('le plan réunit Kybernos et DSH', plan.dshAvailable === true && plan.total === kb + T.dshSources().length, plan.total)
  check('zones comptées', plan.areas.core.total + plan.areas.more.total + plan.areas.phrases.total === plan.total && plan.areas.more.total === 3)
  const zh = T.buildPlan('zh')
  check('zh : DSH le traduit déjà → seules les chaînes Kybernos', zh.dshNative === true && zh.dshAvailable === false && zh.total === kb, zh.total)
  reset(false); setSource()
  const none = T.buildPlan('es')
  check('sans service de locale : Kybernos seul, et le plan le dit', none.dshAvailable === false && none.dshNative === false && none.total === T.kbSources().length)
  reset(); setSource()
}

// ── an older installation: a dictionary and no bilan ──────────────────────
console.log('\n── ancienne installation (dictionnaire sans bilan) ──')
{
  reset(); setSource()
  const plan = T.buildPlan('ar')
  const kbItems = plan.items.filter((i) => i.store === 'kb')
  // What the previous engine left: Kybernos' tables only — no meta, no registry, no DSH half.
  const legacy = {}
  for (const it of kbItems) legacy[it.id] = 'AR:' + it.text
  localStorage.setItem('kybernos.i18n.ar', JSON.stringify(legacy))
  const held = T.heldBy('ar', plan)
  check('la traduction n’a pas disparu : on compte ce que le stockage contient réellement', held.done === kbItems.length && held.done > 0, held)
  check('… sans bilan, la ligne ne dit plus « 0 % » : environ la moitié est faite (Kybernos oui, DSH non)', held.done / plan.total > 0.4 && held.done / plan.total < 0.99, held.done / plan.total)
  check('… la langue est repérée par son cache seul (aucun registre)', T.managedIds().includes('ar') && T.metaRead('ar').done === undefined)
  check('l’essentiel n’est PAS annoncé tant que l’essentiel de DSH manque', held.essentials === false)
  check('mémoïsé tant que le stockage ne bouge pas', T.heldBy('ar', plan) === held)
  const dshCore = plan.items.filter((i) => i.store === 'dsh' && i.area === 'core')
  const dshDict = {}
  for (const it of dshCore) dshDict[it.id] = 'AR:' + it.text
  localStorage.setItem('kybernos.i18n.dsh.ar', JSON.stringify(dshDict))
  const held2 = T.heldBy('ar', plan)
  check('dès que le cœur de DSH est traduit aussi, l’essentiel est prêt (bouton « Use now »)', held2.essentials === true && held2.done === held.done + dshCore.length, held2)
  check('un plan absent (source indisponible) ne plante pas', T.heldBy('ar', null) === null)
}
check('une langue en cours d’usage mais incomplète garde un bouton pour la terminer', /if \(inUse\) \{[\s\S]{0,400}if \(!complete && !running\) acts\.push\(goButton\(\)\)/.test(SOURCE))
check('une langue qui contient des traductions peut être utilisée telle quelle (« Use anyway »)', /else if \(done > 0\) acts\.push\(h\('button', \{ key: 'any'/.test(SOURCE))

// ── engine: success ───────────────────────────────────────────────────────
console.log('\n── moteur : succès ──')
{
  reset(); setSource()
  const host = installHost(translateAll)
  const seen = []
  const plan = T.buildPlan('es')
  const r = await T.runTranslation('es', opts({ onProgress: (p) => seen.push(p) }))
  check('ok, tout traduit', r.ok === true && r.done === plan.total && r.total === plan.total && r.missing === 0, r)
  check('cache Kybernos et cache DSH écrits à part', Object.keys(T.i18nRead('es')).length === T.kbSources().length && Object.keys(T.dshRead('es')).length === T.dshSources().length)
  check('clés DSH stockées sous « ns::clé »', T.dshRead('es')['conversation::send'] === 'AR:Send message')
  check('méta « complete » avec le total et l’heure', T.metaRead('es').complete === true && T.metaRead('es').total === plan.total && T.metaRead('es').essentials === true && T.metaRead('es').at > 0, T.metaRead('es'))
  check('progression monotone, finit au total', seen.every((p, i) => i === 0 || p.done >= seen[i - 1].done) && seen[seen.length - 1].done === plan.total)
  check('progression PAR ZONE', seen[seen.length - 1].areas.core.done === plan.areas.core.total && seen[seen.length - 1].areas.more.done === plan.areas.more.total)
  check('le modèle réellement utilisé remonte', seen[seen.length - 1].model === 'p/m')
  check('seule la route hôte est appelée (jamais un provider depuis le navigateur)', host.urls.every((u) => u === '/kybernos/i18n-translate'), [...new Set(host.urls)])
  check('lots de 40 clés au plus', host.calls.every((c) => Object.keys(c.batch).length <= 40))
  check('le nom de la langue part avec chaque lot (qualité pour les langues rares)', host.calls.every((c) => c.lang === 'es' && c.langName === 'Spanish' && c.source === 'fr'), host.calls[0] && { l: host.calls[0].lang, n: host.calls[0].langName })
  check('plusieurs appels en parallèle (3)', host.peak.n === 3, host.peak.n)
  check('isComplete : oui', T.isComplete('es') === true)
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
  check('ordre d’envoi : tout l’essentiel, puis les écrans avancés, puis les messages', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]) && ranks[0] === 0 && ranks[ranks.length - 1] === 2, ranks.join('').slice(0, 40))
  }

// ── engine: failures ──────────────────────────────────────────────────────
console.log('\n── moteur : échec de l’hôte ──')
{
  reset(); setSource()
  const host = installHost(() => ({ json: { ok: false, error: 'ollama-cloud/x : MISSING_CREDENTIAL — OLLAMA_CLOUD_API_KEY is not set' } }))
  const r = await T.runTranslation('es', opts())
  check('ok:false, et c’est l’erreur de l’HÔTE qui remonte', r.ok === false && /MISSING_CREDENTIAL/.test(r.error), r)
  check('aucune chaîne comptée comme traduite', r.done === 0)
  check('arrêt rapide après 3 échecs d’affilée (pas tous les lots)', host.calls.length <= 6, host.calls.length)
  check('rien n’est caché', Object.keys(T.i18nRead('es')).length === 0 && T.metaRead('es').complete !== true)
  check('l’erreur se traduit en cause lisible', T.friendlyError(r.error) === 'errKey')
}
{
  reset(); setSource()
  installHost(() => ({ status: 404, json: {} }))
  const r = await T.runTranslation('es', opts())
  check('route absente (404) : cause lisible « mettez à jour »', r.ok === false && T.friendlyError(r.error) === 'errOld', r)
}
{
  reset(); setSource()
  installHost(() => 'throw')
  const r = await T.runTranslation('es', opts())
  check('hôte injoignable : cause lisible', r.ok === false && T.friendlyError(r.error) === 'errHost', r)
}
{
  reset(); setSource()
  let n = 0
  installHost((body) => (++n === 2 ? { json: { ok: false, error: 'RATE_LIMIT' } } : translateAll(body)))
  const r = await T.runTranslation('es', opts())
  check('un lot raté isolé : la 2e passe le rejoue, tout finit traduit', r.ok === true && r.done === r.total && r.missing === 0, r)
}
{
  const m = { MISSING_CREDENTIAL: 'errKey', INVALID_CREDENTIAL: 'errKey', AUTH: 'errAuth', ACCOUNT_QUOTA: 'errAuth', NO_ADAPTER: 'errNoModel', RATE_LIMIT: 'errRate', TIMEOUT: 'errSlow', UNREACHABLE: 'errHost', STORAGE_FULL: 'errStore' }
  check('chaque cause connue a son message', Object.keys(m).every((c) => T.friendlyError('x : ' + c + ' — y') === m[c]), Object.keys(m).filter((c) => T.friendlyError('x : ' + c) !== m[c]))
  check('cause inconnue : message générique', T.friendlyError('boum') === 'errTitle' && T.friendlyError(undefined) === 'errTitle')
}

// ── engine: partial, variables, resume ────────────────────────────────────
console.log('\n── moteur : partiel et reprise ──')
{
  reset(); setSource()
  // The model skips every key ending in 7.
  const host = installHost((body) => ({ json: { ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(body.batch).filter((k) => !k.endsWith('7')).map((k) => [k, 'AR:' + body.batch[k]])) } }))
  const r = await T.runTranslation('es', opts())
  check('ok mais missing > 0 : le manque est DIT', r.ok === true && r.missing > 0 && r.done + r.missing === r.total, r)
  check('la 2e passe ne renvoie que ce qui manque', Object.keys(host.calls[host.calls.length - 1].batch).every((k) => k.endsWith('7')))
  check('méta NON « complete » → langue pas donnée pour finie', T.isComplete('es') === false && T.metaRead('es').complete === false)
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
  check('ne renvoie PAS ce qui est déjà traduit', sent.every((w) => half[w.slice(3)] === undefined || !w.startsWith('kb:')) && sent.length === plan.total - 50, sent.length)
  check('la barre repart du point acquis, pas de 0', seen[0].done === 50 && seen[0].startedWith === 50, seen[0])
  check('les traductions déjà là sont conservées', T.i18nRead('es')[first[0].id] === 'AR:déjà' && r.done === plan.total)
}
{
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.es', JSON.stringify({ k0: 'AR:x' }))
  check('un cache PARTIEL n’est pas « complet » (l’ancien défaut : il activait une langue à moitié vide)', T.isComplete('es') === false)
  check('langues natives : toujours utilisables', T.isComplete('kybernos') === true && T.isComplete('en') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: 50 }))
  check('méta « complete » mais le plan a grandi depuis : à compléter', T.isComplete('es') === false)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total }))
  check('méta « complete » à jour : utilisable', T.isComplete('es') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total - 3 }))
  check('3 textes de plus (espace de noms DSH enregistré tard) : toujours « prête », pas de « 99 % » alarmant', T.isComplete('es') === true)
  localStorage.setItem('kybernos.i18n.meta.es', JSON.stringify({ complete: true, total: T.buildPlan('es').total - 40 }))
  check('40 textes de plus (mise à jour d’un plugin) : à compléter', T.isComplete('es') === false)
}

// ── engine: fallback route, pause, storage ────────────────────────────────
console.log('\n── moteur : modèle de repli, pause, stockage ──')
{
  reset(); setSource()
  const host = installHost((body) => ({ json: { ok: true, provider: 'groq', model: 'llama', translations: Object.fromEntries(Object.keys(body.batch).map((k) => [k, 'AR'])) } }))
  await T.runTranslation('es', opts({ route: { provider: 'ollama-cloud', model: 'dead' } }))
  check('premiers lots : la route demandée', host.calls[0].provider === 'ollama-cloud' && host.calls[0].model === 'dead')
  check('lots suivants : la route que l’hôte a réellement utilisée', host.calls.slice(3).every((c) => c.provider === 'groq' && c.model === 'llama'), host.calls.slice(3, 5).map((c) => c.provider))
}
{
  reset(); setSource()
  const control = new AbortController()
  let n = 0
  installHost((body) => { if (++n === 1) control.abort(); return translateAll(body) })
  const r = await T.runTranslation('es', opts({ signal: control.signal }))
  check('pause : « paused », progression gardée', r.ok === false && r.paused === true && r.done > 0 && r.done < r.total, r)
  check('pause : ce qui est traduit est ENREGISTRÉ (écriture forcée), reprise possible', Object.keys(T.i18nRead('es')).length + Object.keys(T.dshRead('es')).length === r.done && T.metaRead('es').done === r.done, { r: r.done, meta: T.metaRead('es') })
  check('pause : le « essentiel prêt » n’est annoncé qu’à 100 % de la zone', T.metaRead('es').essentials === false)
  installHost(translateAll)
  const r2 = await T.runTranslation('es', opts())
  check('reprise : finit le travail sans refaire l’acquis', r2.ok === true && r2.done === r2.total)
}
{
  reset(); setSource()
  installHost(translateAll)
  quotaFull = true
  const r = await T.runTranslation('es', opts())
  check('stockage plein : arrêt net avec la cause', r.ok === false && T.friendlyError(r.error) === 'errStore', r)
  check('stockage plein : AUCUN faux progrès (done = ce qui est réellement gardé)', r.done === 0, r)
}
{
  reset()
  const r = await T.runTranslation('es', opts())
  check('source absente : erreur lisible', r.ok === false && T.friendlyError(r.error) === 'errOld', r)
}
{
  reset(); setSource()
  T.setLocale(null)
  installHost(translateAll)
  const r = await T.runTranslation('es', opts())
  check('sans DSH lisible : Kybernos se traduit quand même, complet', r.ok === true && r.missing === 0 && r.total === T.kbSources().length, r)
  check('… et rien n’est écrit côté DSH', Object.keys(T.dshRead('es')).length === 0)
}
check('estimation de durée : plausible et jamais nulle', T.estimateMinutes(5000) >= 3 && T.estimateMinutes(5000) <= 30 && T.estimateMinutes(1) >= 1, T.estimateMinutes(5000))
{
  const base = { done: 100, total: 1000, startedWith: 0, elapsedMs: 20000 }
  check('temps restant : inconnu au début (échantillon trop mince)', T.minutesLeft({ done: 10, total: 1000, startedWith: 0, elapsedMs: 2000 }) === null)
  check('temps restant : calculé sur la vitesse mesurée', T.minutesLeft(base) === 3, T.minutesLeft(base))
  check('temps restant : ne compte pas ce qui était déjà acquis', T.minutesLeft({ done: 500, total: 1000, startedWith: 460, elapsedMs: 20000 }) === 4, T.minutesLeft({ done: 500, total: 1000, startedWith: 460, elapsedMs: 20000 }))
}

// ── the run (outlives the page) ───────────────────────────────────────────
console.log('\n── l’exécution (survit à la page) ──')
const settle = async (...states) => { for (let i = 0; i < 400 && states.includes(T.getRun().state); i += 1) await new Promise((r) => setTimeout(r, 5)) }
{
  reset(); setSource()
  let release
  const gate = new Promise((r) => { release = r })
  installHost(async (body) => { await gate; return translateAll(body) })
  const states = []
  const off = T.subscribeRun((s) => states.push(s.state))
  check('démarre', T.startRun('es', null) === true && T.getRun().state === 'running')
  check('démarrer une langue l’ajoute au registre', T.registryRead().includes('es'))
  check('un 2e démarrage est REFUSÉ pendant l’exécution (deux exécutions se marcheraient dessus)', T.startRun('de', null) === false && T.startRun('es', null) === false)
  release()
  await settle('running')
  check('terminée : « done », tout traduit', T.getRun().state === 'done' && T.getRun().done === T.getRun().total && T.getRun().total > 0, T.getRun())
  check('terminée : AUCUNE activation ni rechargement (c’est l’utilisateur qui décide)', reloads === 0)
  check('les abonnés ont suivi les états', states.includes('running') && states[states.length - 1] === 'done', states)
  off()
}
{
  reset(); setSource()
  installHost(() => ({ json: { ok: false, error: 'AUTH — bad key' } }))
  T.startRun('es', null)
  await settle('running')
  check('échec : « failed » avec la cause, aucune activation', T.getRun().state === 'failed' && /AUTH — bad key/.test(T.getRun().error) && reloads === 0, T.getRun())
}
{
  reset(); setSource()
  let release
  const gate = new Promise((r) => { release = r })
  installHost(async (body) => { await gate; return translateAll(body) })
  T.startRun('es', null)
  T.pauseRun()
  check('pause : l’état passe par « pausing » (retour immédiat à l’utilisateur)', T.getRun().state === 'pausing')
  check('pause : pas de redémarrage pendant « pausing »', T.startRun('es', null) === false)
  release()
  await settle('running', 'pausing')
  check('pause : « paused », rien d’activé', T.getRun().state === 'paused' && reloads === 0, T.getRun())
}
{
  reset(); setSource()
  const half = {}
  installHost((body) => ({ json: { ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(body.batch).filter((k) => !k.endsWith('7')).map((k) => [k, 'AR'])) } }))
  T.startRun('es', null)
  await settle('running')
  check('terminée avec des trous : « partial » + nombre manquant', T.getRun().state === 'partial' && T.getRun().missing > 0, T.getRun())
}

// ── activation + DSH language pack ────────────────────────────────────────
console.log('\n── activation et langue DSH ──')
{
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  T.activateLanguage('es')
  check('activer une langue traduite PENDANT cette session : elle est d’abord enregistrée dans DSH (sinon DSH ne peut pas basculer)', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].id === 'es' && loc.calls.register.length === 1, loc.calls)
  check('activer : mémorisé, DSH basculé sur CETTE langue, page rechargée', localStorage.getItem('kybernos.theme.lang') === 'es' && loc.calls.setLocale[0] === 'es' && reloads === 1, { lang: localStorage.getItem('kybernos.theme.lang'), set: loc.calls.setLocale, reloads })
  T.activateLanguage('es')
  check('activer deux fois : pas de second enregistrement (addLanguage lèverait)', loc.calls.addLanguage.length === 1)
  RT().ours.clear(); loc.calls.setLocale.length = 0
  T.activateLanguage('en')
  check('activer l’anglais : DSH repasse en en', loc.calls.setLocale[0] === 'en')
  T.activateLanguage('kybernos')
  check('activer le français : DSH repasse en en (il n’a pas de fr)', loc.calls.setLocale[1] === 'en' && localStorage.getItem('kybernos.theme.lang') === 'kybernos')
  loc.getLocale().locales.push({ id: 'kybernos' })
  T.activateLanguage('kybernos')
  check('même si DSH connaît une langue « kybernos » (plugin principal), le français garde DSH en en', loc.calls.setLocale[loc.calls.setLocale.length - 1] === 'en')
  loc.calls.setLocale.length = 0
  RT().ours.clear()
  T.activateLanguage('de')
  check('langue que DSH ne connaît pas (pas de dict DSH) : DSH reste en en', loc.calls.setLocale[0] === 'en')
  T.setLocale(null)
  let threw = false
  try { T.activateLanguage('es') } catch (e) { threw = true }
  check('sans service de locale : activer ne lève pas', threw === false)
  T.setLocale(loc)
}
{
  // Boot-time registration and following DSH's selector are the RUNTIME's job (see
  // test-lang-runtime.mjs); here, only that this plugin hands over to it.
  reset(); setSource()
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  check('le plugin demande l’enregistrement au runtime (une seule langue, une seule fois)', typeof T.registerDshPack('es') === 'function' && loc.calls.addLanguage.length === 1 && T.registerDshPack('es') === null && loc.calls.addLanguage.length === 1)
  check('… et le runtime la marque « à nous » (le plugin ne tient aucune liste à lui)', RT().ours.has('es'))
}
{
  reset(); setSource()
  delete globalThis.window.__KB_LANG_RUNTIME__
  const plan = T.buildPlan('es')
  check('sans runtime (cœur plus ancien) : la moitié DSH n’est pas proposée — elle ne pourrait pas être enregistrée', plan.dshAvailable === false && plan.dshNative === false && plan.total === T.kbSources().length, plan.total)
  check('… et la page peut le dire (« DSH ne peut pas être traduit avec cette version »)', plan.dshAvailable === false)
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  check('sans runtime : enregistrer ne lève pas et ne fait rien', T.registerDshPack('es') === null && loc.calls.addLanguage.length === 0)
  let threw = false
  try { T.activateLanguage('es') } catch (e) { threw = true }
  check('sans runtime : activer ne lève pas (DSH reste en en, Kybernos seul suit)', threw === false && loc.calls.setLocale[loc.calls.setLocale.length - 1] === 'en')
}
{
  reset(); setSource()
  T.registryAdd('es'); T.registryAdd('ja'); T.registryAdd('es')
  const labels = JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}')
  check('ajouter une langue enregistre son nom natif (le runtime en a besoin pour le sélecteur de DSH, plugin éteint)', labels.es === 'Español' && labels.ja === '日本語', labels)
  localStorage.setItem('kybernos.i18n.dsh.es', JSON.stringify({ 'common::cancel': 'Cancelar' }))
  T.registerDshPack('es')
  check('… et DSH liste la langue sous ce nom', loc.calls.addLanguage.length === 1 && loc.calls.addLanguage[0].label === 'Español', loc.calls.addLanguage)
  T.dropLanguage('es')
  check('supprimer une langue efface aussi son nom', JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}').es === undefined && JSON.parse(localStorage.getItem('kybernos.i18n.labels') || '{}').ja === '日本語')
  check('les clés « labels » et « langs » ne sont pas prises pour des langues', !T.managedIds().some((i) => i === 'labels' || i === 'langs'), T.managedIds())
}

// ── live translation ──────────────────────────────────────────────────────
console.log('\n── traduction à la volée : quels textes ──')
{
  const yes = ['Appliquer au profil', 'Simple', 'Enregistrer', 'Délégation par le lead', 'Les agents de code externes que DSH peut piloter.', 'Commandes slash · 9', 'Tout vérifier', 'Maintenance', 'Open configuration file']
  const no = ['kybernos-plugins', 'DeepSeek', 'API', 'glm-5.3-flash', '/Users/x/y', 'https://example.com/a', 'name@company.com', 'v0.2.0-rc.2', '12', '•', 'x', '⟦déjà⟧', 'mcp__horloge__*', 'settings.yaml', 'OLLAMA_CLOUD_API_KEY', 'العربية', '日本語', '   ', 'a'.repeat(401)]
  check('textes d’interface retenus', yes.every((t) => T.isLiveCandidate(t) === true), yes.filter((t) => T.isLiveCandidate(t) !== true))
  check('identifiants, chemins, versions, e-mails, noms de marque, texte déjà traduit : écartés', no.every((t) => T.isLiveCandidate(t) === false), no.filter((t) => T.isLiveCandidate(t) !== false))
}

// ── guards on the source ──────────────────────────────────────────────────
console.log('\n── garde-fous sur le source ──')
// ── help and tooltips ─────────────────────────────────────────────────────
console.log('\n── aide et infobulles ──')
{
  const used = [...SOURCE.matchAll(/\bL\('(\w+)'/g)].map((m) => m[1])
  const defined = new Set([...SOURCE.matchAll(/^\s{8}(\w+): \[/gm)].map((m) => m[1]))
  const missing = [...new Set(used)].filter((k) => !defined.has(k))
  check('chaque clé L(\'…\') utilisée dans la page existe dans le catalogue de textes', used.length > 80 && missing.length === 0, missing)
  check('une clé inconnue s’affiche telle quelle au lieu de vider la page', T.L('cle_qui_nexiste_pas') === 'cle_qui_nexiste_pas')
  check('le texte français ET anglais sont renseignés partout (jamais une paire vide)', (() => { const pairs = [...SOURCE.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)]; return pairs.length > 80 && pairs.every((m) => m[2].trim() !== '' && m[3].trim() !== '') })())
  check('les variables {x} d’un texte se retrouvent dans sa version anglaise (rien ne se perd à la traduction)', (() => { const v = (x) => (x.match(/\{\w+\}/g) || []).sort().join(); return [...SOURCE.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)].every((m) => v(m[2]) === v(m[3])) })())
  const css = SOURCE.slice(SOURCE.indexOf('const css = `'), SOURCE.indexOf('\n`', SOURCE.indexOf('const css = `')))
  const used2 = [...new Set([...css.matchAll(/animation:(kbth-k-[\w-]+)/g)].map((m) => m[1]))]
  const keyframes = new Set([...css.matchAll(/@keyframes (kbth-k-[\w-]+)/g)].map((m) => m[1]))
  check('chaque animation de la maquette a ses @keyframes (une faute de frappe la figerait sans erreur)', used2.length >= 15 && used2.every((n) => keyframes.has(n)), used2.filter((n) => !keyframes.has(n)))
  check('toutes les animations de la maquette durent 12 s (les étapes restent synchrones avec la maquette)', [...css.matchAll(/animation:kbth-k-[\w-]+ (\d+)s/g)].every((m) => m[1] === '12'))
  check('mouvement réduit : les animations s’arrêtent et la maquette montre l’état final', /prefers-reduced-motion:reduce\)\{[^}]*animation:none !important/.test(css))
  check('la feuille de style ne contient AUCUN accent grave (il fermerait le gabarit et casserait tout le plugin)', !css.slice(css.indexOf('`') + 1).includes('`'))
  check('la maquette est cachée aux lecteurs d’écran derrière sa légende, et ne capte aucun clic', /\.kbth-mm\{[^}]*pointer-events:none/.test(css) && /role: 'img', 'aria-label': L\('mockCaption'\)/.test(SOURCE))
  check('la maquette n’utilise aucun attribut data-lang (elle ne doit pas passer pour une vraie ligne)', !/kbth-mm[^\n]*'data-lang'/.test(SOURCE))
  check('le bouton d’aide est un vrai bouton replié/déplié (aria-expanded, aria-controls)', /'data-act': 'help', 'aria-expanded'[^\n]*'aria-controls': 'kbth-help'/.test(SOURCE))
  check('l’aide s’ouvre d’elle-même seulement tant que rien n’est traduit, puis respecte le choix', /managedIds\(\)\.length === 0/.test(SOURCE) && /I18N_HELP_KEY/.test(SOURCE))
  const titled = ['tipHelp', 'tipStart', 'tipResume', 'tipRetry', 'tipPause', 'tipUse', 'tipUseNow', 'tipInUse', 'tipRtl', 'tipProgress', 'tipAreaCore', 'tipAreaMore', 'tipAreaPhrases', 'tipEstimate', 'tipAdd', 'tipAddLang', 'tipModel', 'tipAdvanced', 'tipAgain', 'tipRemove', 'tipChooseModel', 'tipDetails']
  const code = SOURCE.replace(/^\s{8}\w+: \[.*$/gm, '') // the code, without the text catalogue
  check('chaque infobulle définie est réellement posée sur une commande', titled.every((k) => code.includes("'" + k + "'")), titled.filter((k) => !code.includes("'" + k + "'")))
}

check('plus aucun appel à un provider depuis le navigateur', !/api\.groq\.com|ollama\.com|api\.openai\.com|api\.deepseek\.com|dashscope|openrouter\.ai|api\.anthropic\.com|chat\/completions/.test(SOURCE))
check('plus de saisie de clé API par prompt()', !/\bprompt\(/.test(SOURCE) && !/apikey/i.test(SOURCE))
check('plus de grattage du source du plugin principal', !/performance\.getEntriesByType|new Function\(/.test(SOURCE))
check('inject : slots + locale seulement', JSON.stringify(modele.inject) === JSON.stringify(['slots', 'locale']), modele.inject)
check('le plugin ne tient plus de registre DSH à lui : tout passe par le runtime du cœur', !/loc\.addLanguage|loc\.register\(/.test(SOURCE) && !/\bfollowDshSelector\b/.test(SOURCE) && /__KB_LANG_RUNTIME__/.test(SOURCE))
check('le lien sous General › Language est un item de slot (ordre 1, entre Language=0 et Appearance=10)', /id: 'kybernos-language-link', order: 1/.test(SOURCE) && /settings\.general\.item/.test(SOURCE))
check('aucun émoji drapeau (une langue n’est pas un pays)', !/[\u{1F1E6}-\u{1F1FF}]/u.test(SOURCE))
check('la lecture interne de DSH (dicts) est gardée par un test de forme', /instanceof Map/.test(SOURCE))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
