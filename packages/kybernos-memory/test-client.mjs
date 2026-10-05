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
check('the Scope (Mine | Team) is a segmented control of the Lessons tab, no longer a filter group', !T.GROUPS.lessons.some((g) => g.key === 'scope') && T.defaultFilters().scope === 'mine' && /label: 'Scope'/.test(SOURCE))

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
check('the lessons have their own « Pick by relevance » row, locked with a reason when its parents are off or the plugin is stale', /LessonsRelevantRow/.test(SOURCE) && /act: 'lessons-relevant'/.test(SOURCE) && /Pick lessons by relevance/.test(SOURCE) && /typeof les\.relevant !== 'boolean'/.test(SOURCE))
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

// ── Tidy up: the pure pieces
console.log('tidy up')
{
  const now = Date.parse('2026-10-05T12:00:00.000Z')
  const ago = (min) => new Date(now - min * 60000).toISOString()
  check('when: just now / minutes / hours / days, singular and plural', T.whenLabel(ago(0), now) === 'just now' && T.whenLabel(ago(1), now) === '1 minute ago' && T.whenLabel(ago(45), now) === '45 minutes ago' && T.whenLabel(ago(60), now) === '1 hour ago' && T.whenLabel(ago(150), now) === '3 hours ago' && T.whenLabel(ago(1440), now) === '1 day ago' && T.whenLabel(ago(60 * 24 * 12), now) === '12 days ago')
  check('when: unknown or future dates never say NaN', T.whenLabel('garbage', now) === '' && T.whenLabel(null, now) === '' && T.whenLabel(new Date(now + 60000).toISOString(), now) === 'just now')
  check('plural: regular and irregular', T.plural(1, 'lesson') === '1 lesson' && T.plural(2, 'lesson') === '2 lessons' && T.plural(1, 'memory', 'memories') === '1 memory' && T.plural(3, 'memory', 'memories') === '3 memories' && T.plural(0, 'item') === '0 items')

  const G = (id, n, extra) => Object.assign({ id, keeperId: id + '-0', items: Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i), content: 'text ' + String(i), pinned: false })), saves: n - 1, score: 90 }, extra)
  check('removals of a group are all but the kept one', T.groupRemovals(G('a', 3)) === 2 && T.groupRemovals(G('a', 2)) === 1 && T.groupRemovals({ items: [] }) === 0)
  const sizes = (chunks) => chunks.map((c) => c.map((g) => T.groupRemovals(g)).reduce((a, b) => a + b, 0))
  const many = [G('a', 31), G('b', 21), G('c', 11), G('d', 11), G('e', 3)]   // 30, 20, 10, 10, 2 removals
  const chunks = T.tidyChunks(many, 50)
  check('chunks hold at most 50 removals each, in order, and lose no group', sizes(chunks).every((n) => n <= 50) && chunks.flat().map((g) => g.id).join('') === 'abcde' && chunks.length === 2, sizes(chunks))
  check('a group over the limit goes alone (the host then refuses it, loudly)', JSON.stringify(sizes(T.tidyChunks([G('a', 5), G('big', 60), G('c', 5)], 50))) === '[4,59,4]')
  check('no groups, no chunks', T.tidyChunks([], 50).length === 0)
  const ids = (list) => list.map((i) => i.id).join(',')
  check('a card shows at most 4 items, but never hides a pair or a small group', T.visibleItems(G('a', 6), 'a-0', false).length === 4 && T.visibleItems(G('a', 5), 'a-0', false).length === 5 && T.visibleItems(G('a', 2), 'a-0', false).length === 2)
  check('a kept item further down stays visible, in order; expanded shows all', ids(T.visibleItems(G('a', 8), 'a-6', false)) === 'a-0,a-1,a-2,a-3,a-6' && T.visibleItems(G('a', 8), 'a-0', true).length === 8)

  const g = G('g1', 3)
  check('the keeper is the proposal until the user picks, and a pick outside the group is ignored', T.keeperOf(g, {}) === 'g1-0' && T.keeperOf(g, { g1: { keep: 'g1-2' } }) === 'g1-2' && T.keeperOf(g, { g1: { keep: 'zzz' } }) === 'g1-0' && T.keeperOf(g, { g1: {} }) === 'g1-0')
  const body = T.tidyBody([g, G('g2', 2)], { g1: { keep: 'g1-2', edit: '  my text  ' }, g2: { edit: '   ' } })
  check('the body sends confirm, and only what differs from the proposal', body.confirm === true && JSON.stringify(body.groups) === JSON.stringify([{ id: 'g1', keep: 'g1-2', edit: '  my text  ' }, { id: 'g2' }]), body)
  check('an untouched group is just its id', JSON.stringify(T.tidyBody([g], {}).groups) === '[{"id":"g1"}]')

  check('a view is only a view when ok and with groups', T.asTidyView({ ok: true, groups: [] }) !== null && T.asTidyView({ ok: false, error: 'x' }) === null && T.asTidyView({ ok: true }) === null && T.asTidyView(null) === null && T.asTidyView('x') === null)
  const view = (saves, at, log) => ({ ok: true, groups: [], saves, scannedAt: at, total: 10, log: log || [] })
  check('saves add up across both sides, a missing side counts 0', T.tidySaves({ mem: view(3), les: view(2) }) === 5 && T.tidySaves({ mem: null, les: view(2) }) === 2 && T.tidySaves({ mem: null, les: null }) === 0)
  check('the banner is hidden per scan: a new scan changes the key', T.scanKey({ mem: view(1, 'A'), les: view(1, 'B') }) !== T.scanKey({ mem: view(1, 'A2'), les: view(1, 'B') }) && T.scanKey({ mem: null, les: null }) === '|')
  check('a log line says what happened, in the side\'s own words', T.logWords('mem', { removed: 2 }) === 'Merged 3 memories into 1' && T.logWords('les', { removed: 1, kyber: 'dev-team' }) === 'Merged 2 lessons into 1 · dev-team' && T.logWords('les', { removed: 1, partial: true }) === 'Merged 2 lessons into 1 (partly)')
  const merged = T.tidyLog({ mem: view(0, 'A', [{ id: 'm1', at: ago(10) }]), les: view(0, 'B', [{ id: 'l1', at: ago(5) }, { id: 'l2', at: ago(60) }]) })
  check('both logs are merged newest first and tagged with their side', merged.map((l) => l.id + l.src).join(',') === 'l1les,m1mem,l2les', merged)
  check('the limits and endpoints match the hosts', T.TIDY_MAX_REMOVALS === 50 && T.TIDY_SOURCES.mem.base === '/kybernos-cloud/memory/tidy' && T.TIDY_SOURCES.les.base === '/kybernos-memory/tidy' && T.TIDY_SOURCES.les.max === 500)
  check('the host codes of a tidy-up have words', ['a_change', 'groupe_inconnu', 'garde_invalide', 'epingle_protege', 'trop_de_suppressions', 'kyber_plein', 'archive_perimee', 'deja_annule', 'aucun_scan'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  const NOW2 = Date.parse('2026-10-05T12:00:00.000Z')
  const inMin = (m) => new Date(NOW2 + m * 60000).toISOString()
  check('ahead: now / minutes / hours / days', T.whenAhead(inMin(0), NOW2) === 'now' && T.whenAhead(inMin(30), NOW2) === 'in 30 minutes' && T.whenAhead(inMin(120), NOW2) === 'in 2 hours' && T.whenAhead(inMin(1440 * 3), NOW2) === 'in 3 days' && T.whenAhead('garbage', NOW2) === '' && T.whenAhead(inMin(-5), NOW2) === 'now')
  check('the next run is said in words', T.nextWords({ kind: 'off' }, NOW2) === 'Not scheduled.' && /next start of DSH.*3 days/.test(T.nextWords({ kind: 'start' }, NOW2)) && T.nextWords({ kind: 'at', at: inMin(1440) }, NOW2) === 'Next: in 1 day, if DSH is running.' && /next check/.test(T.nextWords({ kind: 'now' }, NOW2)) && T.nextWords({ kind: 'count', remaining: 30 }, NOW2) === 'Next: after 30 more new items.' && /50 new items are in/.test(T.nextWords({ kind: 'count', remaining: 0 }, NOW2)) && T.nextWords({ kind: 'count', remaining: null }, NOW2) === 'Next: after 50 new items.' && T.nextWords(null, NOW2) === 'Not scheduled.')
  const vw = (extra) => ({ ok: true, groups: [], saves: 0, scannedAt: 'A', total: 5, log: [], ...extra })
  check('the settings shown are the lessons host\'s, else the memories\', else the defaults', T.tidySettingsOf({ mem: vw({ settings: { mode: 'ask', schedule: 'off', brain: false } }), les: vw({ settings: { mode: 'auto', schedule: 'daily', brain: true } }) }).schedule === 'daily' && T.tidySettingsOf({ mem: vw({ settings: { mode: 'ask', schedule: 'off', brain: false } }), les: null }).mode === 'ask' && T.tidySettingsOf({ mem: vw(), les: vw() }).mode === 'auto' && T.tidySettingsOf({ mem: null, les: null }).schedule === 'weekly')
  check('a host that predates the settings gives the defaults, never a crash', T.tidyNextOf({ mem: vw(), les: vw() }) === null && T.tidyBrain({ mem: vw(), les: vw() }).model === '')
  const ago2 = (m) => new Date(NOW2 - m * 60000).toISOString()
  const L1 = T.tidyLast({ mem: vw({ last: { at: ago2(5), trigger: 'manual', autoGroups: 2, autoRemoved: 3, found: 4, brainAsked: 1 } }), les: vw({ last: { at: ago2(4), trigger: 'manual', autoGroups: 1, autoRemoved: 1, found: 2, brainAsked: 0 } }) })
  check('the last run sums the two hosts when they ran together', L1.autoGroups === 3 && L1.found === 6 && L1.brainAsked === 1 && L1.at === ago2(4), L1)
  const L2 = T.tidyLast({ mem: vw({ last: { at: ago2(60 * 24 * 3), trigger: 'schedule', autoGroups: 9, found: 9 } }), les: vw({ last: { at: ago2(5), trigger: 'manual', autoGroups: 1, found: 2 } }) })
  check('…but not a run of days ago', L2.autoGroups === 1 && L2.trigger === 'manual', L2)
  check('no run yet', T.tidyLast({ mem: null, les: vw() }) === null && T.lastWords(null, NOW2) === 'Not run yet.')
  check('the last run in words: merged by itself, left for you, scheduled', T.lastWords({ at: ago2(120), trigger: 'schedule', autoGroups: 3, found: 5 }, NOW2) === 'Last run 2 hours ago (scheduled): merged 3 groups by itself, 2 left for you.' && T.lastWords({ at: ago2(1), trigger: 'manual', autoGroups: 0, found: 0 }, NOW2) === 'Last run 1 minute ago: nothing merged by itself.' && T.lastWords({ at: ago2(1), trigger: 'manual', autoGroups: 1, found: 1 }, NOW2) === 'Last run 1 minute ago: merged 1 group by itself.')
  const B = T.tidyBrain({ mem: vw({ brain: { model: 'zai/GLM', llm: true }, unclear: 2 }), les: vw({ brain: { model: 'zai/GLM', llm: false }, unclear: 3 }) })
  check('the Study model: its name, whether a model service exists anywhere, the unclear pairs of both sides', B.model === 'zai/GLM' && B.llm === true && B.unclear === 5 && T.tidyBrain({ mem: null, les: vw({ brain: { model: '', llm: false } }) }).llm === false)
  const LOGS = [{ id: 'a', at: ago2(3), by: 'auto', canUndo: true }, { id: 'b', at: ago2(3), by: 'auto', canUndo: false }, { id: 'c', at: ago2(60 * 24), by: 'auto', canUndo: true }, { id: 'd', at: ago2(3), by: 'you', canUndo: true }]
  const ranView = (trigger, autoGroups) => ({ mem: vw({ last: { at: ago2(3), trigger, autoGroups, autoRemoved: 5, found: 5 }, log: LOGS }), les: null })
  const RN = T.tidyRanNotice(ranView('schedule', 2), '')
  check('a scheduled run that merged something is announced, with the automatic runs it can undo', RN !== null && RN.groups === 2 && RN.removed === 5 && RN.entries.map((e) => e.id).join() === 'a', RN)
  check('…once: not again after it was seen', T.tidyRanNotice(ranView('schedule', 2), ago2(3)) === null)
  check('…not when the user pressed the button (they saw the result), nor when nothing was merged, nor with no run', T.tidyRanNotice(ranView('manual', 2), '') === null && T.tidyRanNotice(ranView('schedule', 0), '') === null && T.tidyRanNotice({ mem: null, les: null }, '') === null)
  // ── team lessons
  const nowT = Date.parse('2026-10-05T12:00:00.000Z')
  check('team: why Team is not offered when the host did not say (loading, signed out, a host that predates the routes, a network error)',
    T.teamReasonOf({ loaded: false, ok: false, connected: false }) === 'chargement'
    && T.teamReasonOf({ loaded: true, ok: false, connected: false, error: 'non connecte' }) === 'non_connecte'
    && T.teamReasonOf({ loaded: true, ok: false, connected: false, error: 'indisponible' }) === 'hote_ancien'
    && T.teamLockedWords('hote_ancien')[0] === 'Restart DSH'
    && T.teamReasonOf({ loaded: true, ok: false, connected: false, error: 'reseau' }) === 'indisponible'
    && T.teamReasonOf({ loaded: true, ok: false, connected: false, error: 'refus_500' }) === 'indisponible'
    && T.teamReasonOf({ loaded: true, ok: true, team: { available: false, reason: 'offre_requise' } }) === 'offre_requise'
    && T.teamReasonOf({ loaded: true, ok: true, team: { available: true, reason: null } }) === 'indisponible'
    && T.teamReasonOf(undefined) === 'indisponible')
  check('team: why the Team scope is locked, in words (plan, workspace, sign-in, unknown)', T.teamLockedWords('offre_requise')[0] === 'Team plan' && /Team workspace/.test(T.teamLockedWords('offre_requise')[1]) && T.teamLockedWords('aucun_espace')[0] === 'No team workspace' && T.teamLockedWords('non_connecte')[0] === 'Sign in' && T.teamLockedWords('???')[0] === 'Unavailable')
  check('team: owners and admins are the ones who decide', T.isTeamAdmin('owner') && T.isTeamAdmin('admin') && !T.isTeamAdmin('member') && !T.isTeamAdmin(null) && !T.isTeamAdmin(undefined))
  check('team: minutes since a date, never NaN', T.minutesSince('2026-10-05T11:00:00.000Z', nowT) === 60 && T.minutesSince('2026-10-05T12:30:00.000Z', nowT) === 0 && T.minutesSince('garbage', nowT) === null && T.minutesSince(null, nowT) === null)
  check('team: the status chip says what the proposer sees', JSON.stringify(T.teamStatusChip({ status: 'proposed' })) === '["Waiting for review","warn"]' && T.teamStatusChip({ status: 'approved' })[1] === 'ok' && T.teamStatusChip({ status: 'rejected' })[0] === 'Rejected' && T.teamStatusChip({ status: 'retired' })[0] === 'Retired' && T.teamStatusChip({ status: 'weird' })[0] === 'weird')
  const TL = (o) => Object.assign({ id: 1, text: 'expo start with CI=1 serves a frozen bundle', tags: ['expo'], kyber: 'app-mobile', status: 'approved', proposedName: 'Sara M.', reviewedName: 'Alex R.', createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z' }, o)
  check('team: the search needs every word, anywhere (text, tag, kyber, names), case-insensitive', T.teamMatches(TL(), 'FROZEN bundle') && T.teamMatches(TL(), 'expo app-mobile') && T.teamMatches(TL(), 'sara alex') && T.teamMatches(TL(), '') && T.teamMatches(TL(), null) && !T.teamMatches(TL(), 'frozen nonsense') && T.teamMatches(TL({ kyber: null }), 'general') && T.teamMatches(TL({ kyber: null, proposedName: null, reviewedName: null }), 'frozen'))
  check('team: the line under a lesson (who proposed, who approved, how long ago)', T.teamMeta(TL(), nowT).join(' | ') === 'Proposed by Sara M. | approved by Alex R. | 2h ago' && T.teamMeta(TL({ status: 'rejected' }), nowT).includes('rejected by Alex R.') && T.teamMeta(TL({ status: 'proposed', reviewedName: null, updatedAt: '2026-10-05T11:59:50.000Z' }), nowT).join(' | ') === 'Proposed by Sara M. | just now' && T.teamMeta(TL({ proposedName: null, reviewedName: null, status: 'proposed', updatedAt: null, createdAt: null }), nowT).length === 0)
  check('team: the page has its pieces (tab, sheets, review queue, options, status hook) and talks only to the plugin\'s own routes', /const TeamPane/.test(SOURCE) && /const TeamReviewView/.test(SOURCE) && /const ProposeSheet/.test(SOURCE) && /const TeamOpenSheet/.test(SOURCE) && /const TeamRows/.test(SOURCE) && /const useTeam/.test(SOURCE) && ['/kybernos-cloud/team/status', '/kybernos-cloud/team/lessons/add', '/kybernos-cloud/team/lessons/review', "'/kybernos-cloud/team/lessons/' + path"].every((u) => SOURCE.indexOf(u) >= 0) && /act\('retire'/.test(SOURCE) && /act\('delete'/.test(SOURCE) && !/v1\/workspaces/.test(SOURCE))
  check('team: the routes the page calls exist on the host', (() => { const host = readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8'); return ['/team/status', '/team/lessons', '/team/lessons/add', '/team/lessons/review', '/team/lessons/retire', '/team/lessons/delete'].every((r) => host.indexOf("path: '/kybernos-cloud" + r + "'") >= 0) })())
  check('team: the host codes have words', ['doublon', 'equipe_pleine', 'trop_de_propositions', 'admin_requis', 'deja_decidee', 'non_approuvee', 'espace_introuvable', 'offre_requise', 'aucun_espace', 'partage_desactive', 'texte_invalide', 'requete_invalide'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  check('who merged: automatic or you', T.logWho({ by: 'auto' }) === 'Automatic · 80 %+' && T.logWho({ by: 'you' }) === 'You' && T.logWho({}) === 'You')
  const tidyHost = readFileSync(join(HERE, '..', 'kybernos-cloud', 'tidy.mjs'), 'utf8')
  const listOf = (name) => JSON.parse((new RegExp('export const ' + name + " = (\\[[^\\]]*\\])").exec(tidyHost)[1]).replace(/'/g, '"'))
  check('the modes and schedules offered are exactly the ones the hosts accept', JSON.stringify(T.TIDY_MODES.map((x) => x[0])) === JSON.stringify(listOf('TIDY_MODES')) && JSON.stringify(T.TIDY_SCHEDULES.map((x) => x[0])) === JSON.stringify(listOf('TIDY_SCHEDULES')))
  check('the host codes of the Study model have words', ['deja_en_cours', 'pas_de_modele_detude', 'llm_indisponible', 'delai_depasse', 'modele_en_erreur', 'valeur_invalide'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  check('the limits agree with the host sources', /const TIDY_MAX_REMOVALS = 50/.test(readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8')) && /const TIDY_MAX_REMOVALS = 50/.test(readFileSync(join(HERE, 'index.js'), 'utf8')) && /MEMORY_MAX_CONTENT = 2000/.test(readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8')) && /LESSON_MAX_CHARS = 500/.test(readFileSync(join(HERE, 'lessons-store.mjs'), 'utf8')))
}

console.error = realError
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
