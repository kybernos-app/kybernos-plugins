#!/usr/bin/env node
// Browser half of kybernos-memory — the pure pieces (plan, ages, pages, URLs, error words, the
// network wrapper) and the mounting contract, against a stub React. No browser, no dependency.
//
//   node packages/kybernos-memory/test-client.mjs
//
// The page itself (React) is covered against the real GUI by scripts/check-memory-live.mjs, and
// it was driven end to end in a real browser, over the REAL host modules, while it was built.
// This file pins what can break without a browser.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')

// ── environment: a stub React (only the pure pieces run here) and a window that keeps the definition
const React = { createElement: (...a) => a, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f }
let definition = null
const errorsLogged = []
const realError = console.error
console.error = (...a) => { errorsLogged.push(a.join(' ')) }
const listeners = []
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def } },
  addEventListener: (type, fn, capture) => { listeners.push({ type, fn, capture }) },
  removeEventListener: (type, fn, capture) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture); if (i >= 0) listeners.splice(i, 1) },
}
let fetchImpl = async () => { throw new Error('offline') }
globalThis.fetch = (...a) => fetchImpl(...a)
const tags = []
globalThis.document = { createElement: () => ({ dataset: {}, remove() { tags.splice(0, 1) } }), head: { append: (t) => tags.push(t) } }
new Function('window', SOURCE)(globalThis.window)

check('registers one module, with the plugin id', definition !== null && definition.id === '@local/kybernos-memory')
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const T = mod.__test
check('declares the slots service (the ctx guard refuses anything undeclared)', Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === 'slots')

// ── plan
console.log('plan')
const st = (plan) => ({ ok: true, state: { user: { plan } } })
check('no user / empty / free → free', T.planOf(null) === 'free' && T.planOf({}) === 'free' && T.planOf(st('')) === 'free' && T.planOf(st('free')) === 'free' && T.planOf(st('FREE')) === 'free')
check('solo, studio, scale and legacy individual plans → solo', ['solo', 'studio', 'scale', 'pro', 'max'].every((p) => T.planOf(st(p)) === 'solo'))
check('team-* seats → team', T.planOf(st('team-solo')) === 'team' && T.planOf(st('team-studio')) === 'team' && T.planOf(st('team-scale')) === 'team' && T.planOf(st('team')) === 'team')

// ── ages
console.log('ages')
check('now / minutes / hours / days', T.ageLabel(0.4) === 'now' && T.ageLabel(12) === '12m' && T.ageLabel(59.6) === '60m' && T.ageLabel(190) === '3h' && T.ageLabel(1500) === '1d' && T.ageLabel(60 * 24 * 30) === '30d')
check('unknown ages are blank, never "NaN"', T.ageLabel(null) === '' && T.ageLabel(undefined) === '' && T.ageLabel(NaN) === '')

// ── pager
console.log('pager')
const pp = (total, page, size = 25) => T.pagerPages(total, page, size)
check('630 rows, page 1: 1 2 3 … 26, range 1–25', JSON.stringify(pp(630, 1).items) === JSON.stringify([1, 2, 3, '…', 26]) && pp(630, 1).from === 1 && pp(630, 1).to === 25)
check('page 3: 1 2 3 4 … 26', JSON.stringify(pp(630, 3).items) === JSON.stringify([1, 2, 3, 4, '…', 26]))
check('middle page 13: 1 … 12 13 14 … 26', JSON.stringify(pp(630, 13).items) === JSON.stringify([1, '…', 12, 13, 14, '…', 26]))
check('last page is partial: 626–630', pp(630, 26).from === 626 && pp(630, 26).to === 630 && JSON.stringify(pp(630, 26).items) === JSON.stringify([1, '…', 24, 25, 26]))
check('a page beyond the end is clamped; empty list is 0–0 on 1 page', pp(630, 99).page === 26 && pp(0, 1).pages === 1 && pp(0, 1).from === 0 && pp(0, 1).to === 0)
check('exactly one page → just "1"', JSON.stringify(pp(10, 1).items) === JSON.stringify([1]))
check('100 per page → 7 pages', pp(630, 1, 100).pages === 7)

// ── URLs
console.log('urls')
const base = (over) => ({ size: 25, page: 1, q: '', f: T.defaultFilters(), ...over })
check('defaults leave every filter out', T.listUrl('memories', base()) === '/kybernos-cloud/memory/list?limit=25&offset=0')
check('page 3 of 50 → offset 100', T.listUrl('memories', base({ size: 50, page: 3 })) === '/kybernos-cloud/memory/list?limit=50&offset=100')
check('memory filters and the search are sent, trimmed', T.listUrl('memories', base({ q: '  deploy  ', f: { ...T.defaultFilters(), show: 'pinned', src: 'agent', added: '1h' } })) === '/kybernos-cloud/memory/list?limit=25&offset=0&added=1h&q=deploy&show=pinned&src=agent')
check('lessons go to the lessons host, kyber/used/added/q', T.listUrl('lessons', base({ q: 'x y', f: { ...T.defaultFilters(), kyber: 'dev-team', status: 'used', added: 'today' } })) === '/kybernos-memory/lessons?limit=25&offset=0&added=today&q=x+y&kyber=dev-team&used=1')
check('a memory-only filter never leaks into a lessons URL', !/show=|src=/.test(T.listUrl('lessons', base({ f: { ...T.defaultFilters(), show: 'pinned', src: 'agent' } }))))
check('mode=meaning is sent only with a query, only for memories', T.listUrl('memories', base({ q: 'cafe', mode: 'meaning' })) === '/kybernos-cloud/memory/list?limit=25&offset=0&q=cafe&mode=meaning'
  && !/mode=/.test(T.listUrl('memories', base({ mode: 'meaning' }))) && !/mode=/.test(T.listUrl('memories', base({ q: 'cafe', mode: 'relevance' }))) && !/mode=/.test(T.listUrl('lessons', base({ q: 'cafe', mode: 'meaning' }))))

console.log('search by meaning')
check('every fallback reason has its own sentence', ['sens_desactive', 'offre_requise', 'sens_indisponible', 'serveur_ancien', 'credits_epuises', 'embedding_invalide'].every((c) => T.meaningWhy(c).length > 10 && T.meaningWhy(c).indexOf('Something went wrong') < 0))
check('the plan reason names the tier the host sent, Solo by default', /Solo plan/.test(T.meaningWhy('offre_requise')) && /Team plan/.test(T.meaningWhy('offre_requise', 'team')) && /Solo plan/.test(T.meaningWhy('offre_requise', 'unheard-of')))
check('the switch reason points to Options', /Options/.test(T.meaningWhy('sens_desactive')))
check('an unknown code falls back to the generic words, never to undefined', typeof T.meaningWhy('zzz') === 'string' && /zzz/.test(T.meaningWhy('zzz')) && T.meaningWhy(undefined).length > 0)
check('« N of M words » only when some of several words were missing', T.wordsLabel(2, 3) === '2 of 3 words' && T.wordsLabel(1, 2) === '1 of 2 words' && T.wordsLabel(3, 3) === null && T.wordsLabel(1, 1) === null && T.wordsLabel(undefined, undefined) === null && T.wordsLabel(0, 3) === null && T.wordsLabel('2', 3) === null)
check('closeness is « NN% match », clamped, and only for a real number', T.closenessLabel(82) === '82% match' && T.closenessLabel(81.6) === '82% match' && T.closenessLabel(140) === '100% match' && T.closenessLabel(-3) === '0% match'
  && T.closenessLabel(null) === null && T.closenessLabel(undefined) === null && T.closenessLabel(NaN) === null && T.closenessLabel('82') === null)
{
  const store = new Map()
  globalThis.window.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } }
  check('the search mode defaults to relevance, and the saved choice comes back', T.readMode() === 'relevance' && (T.writeMode('meaning'), T.readMode()) === 'meaning' && (T.writeMode('relevance'), T.readMode()) === 'relevance')
  store.set('kbmem.searchMode', 'garbage')
  check('a garbage or legacy saved value is relevance', T.readMode() === 'relevance' && (store.set('kbmem.searchMode', 'words'), T.readMode()) === 'relevance')
  globalThis.window.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  check('blocked storage (private window) never throws', T.readMode() === 'relevance' && T.writeMode('meaning') === undefined)
  delete globalThis.window.localStorage
}
check('a hostile search is encoded, not concatenated', T.listUrl('memories', base({ q: 'a&limit=9999#x' })).includes('q=a%26limit%3D9999%23x'))

// ── filters
console.log('filters')
check('no active filter by default, on either tab', T.activeFilters('memories', T.defaultFilters()).length === 0 && T.activeFilters('lessons', T.defaultFilters()).length === 0)
const act = T.activeFilters('memories', { ...T.defaultFilters(), added: '1h', src: 'capture' })
check('each non-default filter is one chip with its own key and default', act.length === 2 && act.every((c) => typeof c.key === 'string' && c.def !== undefined) && act.some((c) => c.text === 'Added: Last hour') && act.some((c) => c.text === 'Source: Auto-capture'))
check('a kyber filter is a chip too', T.activeFilters('lessons', { ...T.defaultFilters(), kyber: 'audit' }).some((c) => c.key === 'kyber' && c.text === 'Kyber: audit' && c.def === ''))
check('Team scope exists in the menu groups (shown as not built by the page)', T.GROUPS.lessons[0].opts.some((o) => o[0] === 'team'))

// ── words
console.log('words')
const fe = T.friendlyError
check('known codes are sentences, unknown ones keep the code', fe('non connecte') === 'Not connected to Kybernos Cloud.' && fe('reconnexion_requise').includes('expired') && fe('reseau').includes('cannot be reached') && fe('refus_503') === 'The server refused the request (503).' && fe('weird_code') === 'Something went wrong (weird_code).' && fe(undefined) === 'Something went wrong.')
check('input errors are said as input errors', fe('contenu_vide') === 'Write something first.' && fe('contenu_trop_long').includes('2 000') && fe('memoire_desactivee') === 'Memory is switched off.' && fe('lecon_introuvable') === 'That lesson no longer exists.')
const cw = T.captureWords
check('capture outcomes', cw({ status: 'ecrit', facts: 2 }) === 'wrote 2 memories' && cw({ status: 'ecrit', facts: 1 }) === 'wrote 1 memory' && cw({ status: 'rien_a_retenir' }) === 'nothing worth keeping' && cw({ status: 'jamais' }).includes('has not run') && cw({ status: 'desactivee' }) === 'switched off' && cw(null) === 'unknown' && cw({ status: 'inedit' }) === 'inedit')

// ── network wrapper
console.log('network')
check('a network failure is { ok:false, error:"reseau" }, never a throw', JSON.stringify(await T.api('/x')) === '{"ok":false,"error":"reseau"}')
fetchImpl = async () => ({ status: 404, json: async () => { throw new Error('not json') } })
check('a 404 that is not JSON says the plugin is missing', (await T.api('/x')).error === 'indisponible')
fetchImpl = async () => ({ status: 502, json: async () => { throw new Error('not json') } })
check('another non-JSON status keeps its code', (await T.api('/x')).error === 'refus_502')
let seen = null
fetchImpl = async (url, init) => { seen = { url, init }; return { status: 200, json: async () => ({ ok: true, total: 3 }) } }
check('a GET is a plain GET', (await T.api('/a')).total === 3 && seen.init.method === 'GET' && seen.init.body === undefined)
await T.api('/b', { id: 1 })
check('a body makes a JSON POST', seen.init.method === 'POST' && seen.init.headers['content-type'] === 'application/json' && seen.init.body === '{"id":1}')
fetchImpl = async () => ({ status: 200, json: async () => ({ ok: false, error: 'non connecte', connected: false }) })
check('the host\'s own refusal passes through untouched', (await T.api('/c')).error === 'non connecte')

// ── mounting
console.log('mounting')
const calls = { slot: [], effects: [] }
const ctx = { slots: { inject: (name, cb) => { cb(); return () => {} }, register: (meta, comp) => { calls.slot.push({ meta, comp }); return () => {} } }, effect: (fn, label) => { const d = fn(); calls.effects.push({ label, d }) } }
mod.apply(ctx)
check('registers one settings section, right after Language', calls.slot.length === 1 && calls.slot[0].meta.name === 'settings.section' && calls.slot[0].meta.id === 'kybernos-memory' && calls.slot[0].meta.order === 3 && calls.slot[0].meta.label === 'Memory & Lessons')
check('the section renders the page component', typeof calls.slot[0].comp === 'function')
check('styles are inserted once, tagged with the plugin, and can be removed', tags.length === 1 && tags[0].dataset.plugin === '@local/kybernos-memory' && typeof calls.effects[0].d === 'function')
check('every effect is labelled (cordis disposers)', calls.effects.length === 2 && calls.effects.every((e) => /^kybernos-memory:/.test(e.label)))
check('apply with no slots service does not throw', (() => { try { mod.apply({}); mod.apply(null); return true } catch (e) { return false } })())
const broken = definition.factory(() => { throw new Error('react missing') })
check('a load error disables the plugin, leaves the GUI (apply is a no-op) and logs', typeof broken.apply === 'function' && broken.apply() === undefined && errorsLogged.some((l) => l.includes('load failed')))

// ── source guards
console.log('source')
check('the only dangerouslySetInnerHTML is the icon helper, fed by constants', (SOURCE.match(/dangerouslySetInnerHTML/g) || []).length === 1)
check('no eval, no innerHTML assignment, no document.write', !/\beval\(|\.innerHTML\s*=|document\.write/.test(SOURCE.replace(/\/\/.*$/gm, '')))
// Every selector must carry the bundle's prefix: class prefixes are shared across bundles, and a bare
// `.row` or `.btn` here would restyle someone else's page.
const unprefixed = []
for (const m of T.css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
  const head = m[1].trim()
  if (head.startsWith('@') || head === 'to' || head === 'from' || /^\d+%$/.test(head)) continue
  for (const part of head.split(',')) if (part.indexOf('kbmem-') < 0) unprefixed.push(part.trim())
}
check('every selector of the stylesheet carries the kbmem- prefix (prefixes are shared across bundles)', unprefixed.length === 0, unprefixed)
const others = ['kybernos-plugin', 'kybernos-cloud', 'kybernos-sessions', 'kybernos-language', 'kybernos-theme', 'kybernos-models', 'kybernos-auto', 'kybernos-hub', 'kybernos-flow'].filter((d) => { try { return /kbmem-/.test(readFileSync(join(HERE, '..', d, 'client.js'), 'utf8')) } catch (e) { return false } })
check('no other bundle uses the kbmem- prefix', others.length === 0, others)
check('the page never calls a cloud URL directly: only same-origin local routes', !/https?:\/\//.test(SOURCE.replace(/\/\/.*$/gm, '').replace(/<path[^>]*>/g, '')) )

// ── nav placement: DSH's Settings nav is grouped by label (kybernos-plugin); a label it does not know falls to the
// bottom, under "Third Party Plugins" (seen on the real GUI). Ours is designed to sit right under Language.
console.log('settings nav')
{
  const label = (/label: '(Memory & Lessons)'/.exec(SOURCE) || [])[1]
  const nav = readFileSync(join(HERE, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const row = /titre: kbt\('settings\.group\.settings'\), mots: \[([^\]]*)\]/.exec(nav)
  const words = row === null ? [] : row[1].split(',').map((w) => w.trim().replace(/^'|'$/g, ''))
  const at = words.indexOf((label || '').toLowerCase())
  check('the nav label is the one the page registers', label === 'Memory & Lessons')
  check('the Settings group of the shell lists it right after Language', at > 0 && words[at - 1] === 'language', words)
  check('it has its own icon (else it wears the generic gear)', nav.indexOf("'memory & lessons': '<path") >= 0)
}

// ── Escape: the Settings dialog of DSH also closes on Escape, so the page must get there first and stop it
console.log('escape')
{
  let closed = 0
  const off = T.onEscape(() => { closed += 1 })
  const l = listeners[listeners.length - 1]
  let stopped = 0
  l.fn({ key: 'a', stopPropagation: () => { stopped += 1 } })
  check('another key does nothing', closed === 0 && stopped === 0)
  l.fn({ key: 'Escape', stopPropagation: () => { stopped += 1 } })
  check('Escape closes the menu AND is stopped (else DSH closes the whole Settings page)', closed === 1 && stopped === 1)
  check('it listens on window in the capture phase (before the dialog\'s own listener)', l.type === 'keydown' && l.capture === true)
  off()
  check('the unsubscribe removes it (an Escape with nothing open must reach DSH)', listeners.length === 0)
}

console.error = realError
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
