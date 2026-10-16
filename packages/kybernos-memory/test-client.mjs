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
check('the switch reason points to Customize', /Customize/.test(T.meaningWhy('sens_desactive')))
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
check('an agent team filter is a chip too', T.activeFilters('lessons', { ...T.defaultFilters(), kyber: 'audit' }).some((c) => c.key === 'kyber' && c.text === 'Agent Team: audit' && c.def === ''))
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
check('registers one settings section (its drawn place is the shell menu grouping\'s: scripts/test-live-checks.mjs)',calls.slot.length === 1 && calls.slot[0].meta.name === 'settings.section' && calls.slot[0].meta.id === 'kybernos-memory' && calls.slot[0].meta.order === 3 && calls.slot[0].meta.label === 'Memory & Lessons')
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
// bottom, under the last header (seen on the real GUI). Ours is one of the essentials, the first section, after AI Provider & Models.
console.log('settings nav')
{
  // The nav label is the page's own title, said in the language in use (English at the base).
  const label = /id: 'kybernos-memory', order: 3, label: pageTitle\(\) \}/.test(SOURCE) && /const PAGE_TITLE = 'Memory & Lessons'/.test(SOURCE) ? 'Memory & Lessons' : undefined
  const nav = readFileSync(join(HERE, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const row = /const GROUPES = \[\s*\{ titre: null, mots: \[([^\]]*)\]/.exec(nav)
  const words = row === null ? [] : row[1].split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter((w) => w !== '')
  const at = words.indexOf((label || '').toLowerCase())
  check('the nav label is the one the page registers', label === 'Memory & Lessons')
  check('the essentials list it right after AI Provider & Models', at > 0 && /^ai providers? & models$/.test(words[at - 1]), words)
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
  const Ba = T.tidyBrain({ mem: null, les: vw({ brain: { model: 'kybernos/auto', llm: true, auto: true, none: false } }) })
  check('a Study model picked automatically is reported as such', Ba.model === 'kybernos/auto' && Ba.auto === true && Ba.none === false, Ba)
  const Bn = T.tidyBrain({ mem: vw({ brain: { model: '', llm: true, auto: false, none: true } }), les: vw({ brain: { model: '', llm: true, auto: false, none: true } }) })
  check('« None » is told apart from « nothing found yet »', Bn.none === true && Bn.model === '' && T.tidyBrain({ mem: null, les: vw({ brain: { model: '', llm: true, auto: false, none: false } }) }).none === false, Bn)
  const Bo = T.tidyBrain({ mem: vw({ brain: { model: 'a/b', llm: true } }), les: null })
  check('a host that says nothing of automatic or none (an older build) gives neither', Bo.auto === false && Bo.none === false && Bo.model === 'a/b', Bo)
  const W1 = T.studyWords({ model: 'kybernos/auto', auto: true, none: false, llm: true })
  check('automatic: the row says which model it uses and that it was picked for you; nothing blocks it', W1.why === null && /kybernos\/auto/.test(W1.using) && /automatically/.test(W1.using), W1)
  const W2 = T.studyWords({ model: 'zai/GLM', auto: false, none: false, llm: true })
  check('your own pick: named, not called automatic', W2.why === null && /zai\/GLM/.test(W2.using) && !/automatically/.test(W2.using), W2)
  const W3 = T.studyWords({ model: '', auto: false, none: true, llm: true })
  check('None says it is set to None, not that nothing is set', W3.using === null && /set to None/.test(W3.why) && !/pick one/.test(W3.why), W3)
  const W4 = T.studyWords({ model: '', auto: false, none: false, llm: true })
  check('nothing found yet: it says it picks one by itself once a model is connected, not « pick one in Kybernos Settings »', W4.using === null && /by itself/.test(W4.why) && !/No Study model is set/.test(W4.why), W4)
  const W5 = T.studyWords({ model: 'a/b', auto: true, none: false, llm: false })
  check('a model with no model service: the service is the problem', /model service is not available/.test(W5.why), W5)
  check('the words are English, whatever the state', [W1, W2, W3, W4, W5].every((w) => !/[éèêàùç]|\b(le|la|les|des|une?)\b/i.test(String(w.using) + String(w.why))))
  check('the scan error « no Study model » no longer tells to pick one in the Settings', !/pick one in Kybernos Settings/.test(T.friendlyError('pas_de_modele_detude')) && /None|connect/.test(T.friendlyError('pas_de_modele_detude')), T.friendlyError('pas_de_modele_detude'))
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
  // The map
  const MN = (extra) => Object.assign({ id: 1, kind: 'fact', content: 'Les préférences de l’utilisateur : réponses courtes', x: 0.5, y: 0.5, cl: 0 }, extra)
  check('map: « light up what matches » needs every word, ignoring case and accents, and nothing typed matches everything', T.mapMatches(MN(), 'REPONSES courtes') && T.mapMatches(MN(), 'preferences utilisateur') && !T.mapMatches(MN(), 'reponses longues') && T.mapMatches(MN(), '') && T.mapMatches(MN(), '   ') && !T.mapMatches(MN({ content: '' }), 'a'))
  const fit = T.MAP_FIT
  const z2 = T.mapZoom(fit, 2)
  check('map: zooming in halves the view around its centre, keeping the drawing\'s proportions', z2[2] === 500 && z2[3] === 270 && z2[0] === 250 && z2[1] === 135)
  check('map: zooming around the pointer keeps what is under it in place', (() => { const left = T.mapZoom(fit, 2, 0, 0); const right = T.mapZoom(fit, 2, 1, 1); return left[0] === 0 && left[1] === 0 && right[0] === 500 && right[1] === 270 })())
  check('map: zooming out of the whole map stays on the whole map; zooming in stops at a readable size', T.mapZoom(fit, 0.5).join() === fit.join() && T.mapZoom(T.mapZoom(fit, 100), 100)[2] === 150 && Math.abs(T.mapZoom(fit, 100)[3] - 150 * 0.54) < 1e-9)
  check('map: panning never leaves the drawing', T.mapPan(z2, -9999, -9999).slice(0, 2).join() === '0,0' && T.mapPan(z2, 9999, 9999).slice(0, 2).join() === '500,270' && T.mapPan(z2, 10, 20).slice(0, 2).join() === '260,155' && T.mapClamp([900, 500, 500, 270]).slice(0, 2).join() === '500,270')
  check('map: the names of the clusters go above their highest dot, never over each other, a dot, the search field, the legend or the zoom buttons; no room means no name', (() => {
    const A = [MN({ x: 0.3, y: 0.5, cl: 0 }), MN({ x: 0.5, y: 0.5, cl: 0 }), MN({ x: 0.52, y: 0.52, cl: 1 }), MN({ x: 0.5, y: 0.95, cl: 2 }), MN({ x: 0.05, y: 0.05, cl: 3 })]
    const C = [{ id: 0, label: 'database · files', size: 2 }, { id: 1, label: 'expo · simulator', size: 1 }, { id: 2, label: 'stripe', size: 1 }, { id: 3, label: 'top left', size: 1 }, { id: 4, label: 'ghost', size: 0 }, { id: 5, label: '', size: 1 }]
    const at = T.mapLabelSpots(A, C)
    const box = (id) => { const w = C[id].label.length * 8.4 + 10; return [at[id].x - w / 2, at[id].y - 12, at[id].x + w / 2, at[id].y + 4] }
    const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]
    const placed = [0, 1, 2, 3].filter((i) => at[i] !== undefined)
    const pairs = placed.every((i) => placed.every((j) => i === j || apart(box(i), box(j))))
    const free = placed.every((i) => apart(box(i), [0, 0, 290, 58]) && apart(box(i), [0, 490, 400, 540]) && apart(box(i), [930, 390, 1000, 540]) && box(i)[0] >= 6 && box(i)[2] <= 994 && box(i)[1] >= 4 && box(i)[3] <= 536)
    const clear = placed.every((i) => A.every((n) => { const d = [n.x * 1000 - 9, n.y * 540 - 9, n.x * 1000 + 9, n.y * 540 + 9]; return apart(box(i), d) }))
    return at[0] !== undefined && Math.abs(at[0].y - (0.5 * 540 - 16)) < 1e-9 && pairs && free && clear && at[4] === undefined && at[5] === undefined && at[2] !== undefined && T.mapLabelSpots([], C)[0] === undefined
  })())
  check('map: what the map says when it cannot be drawn (switch off, plan, credits, signed out, anything else)', T.mapWords('sens_desactive')[0] === 'The map needs Search by meaning' && /Kybernos embedding model/.test(T.mapWords('sens_desactive')[1]) && T.mapWords('offre_requise', 'solo')[0] === 'The map needs the Solo plan' && T.mapWords('offre_requise')[0] === 'The map needs the Solo plan' && T.mapWords('credits_epuises')[0] === 'You are out of credits' && T.mapWords('non connecte')[0] === 'Not connected' && T.mapWords('embedding_invalide')[0] === 'The map could not be drawn' && T.mapWords('indisponible')[0] === 'The map needs a restart' && T.mapWords('reconnexion_requise')[1] === 'Your Kybernos session has expired: reconnect.' && T.mapWords('quelque_chose_d_inconnu')[0] === 'The map could not be drawn')
  check('map: the page has its pieces and talks only to the plugin\'s own route, which the host serves (GET, same-origin guarded)', /const MapPane/.test(SOURCE) && /'\/kybernos-cloud\/memory\/meaning-map'/.test(SOURCE) && (() => { const host = readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8'); return /path: '\/kybernos-cloud\/memory\/meaning-map', method: 'GET', guarded: true/.test(host) })() && !/fetch\('https?:/.test(SOURCE))
  check('map: the choice is kept only once a map was really drawn, and the lessons never offer it', /onReady: \(\) => writeLayout\('map'\)/.test(SOURCE) && /if \(v === 'list'\) writeLayout\('list'\)/.test(SOURCE) && /const mapOn = mems && layout === 'map'/.test(SOURCE) && /disabled: !mems/.test(SOURCE))
  check('who merged: automatic or you', T.logWho({ by: 'auto' }) === 'Automatic · 80 %+' && T.logWho({ by: 'you' }) === 'You' && T.logWho({}) === 'You')
  const tidyHost = readFileSync(join(HERE, '..', 'kybernos-cloud', 'tidy.mjs'), 'utf8')
  const listOf = (name) => JSON.parse((new RegExp('export const ' + name + " = (\\[[^\\]]*\\])").exec(tidyHost)[1]).replace(/'/g, '"'))
  check('the modes and schedules offered are exactly the ones the hosts accept', JSON.stringify(T.TIDY_MODES.map((x) => x[0])) === JSON.stringify(listOf('TIDY_MODES')) && JSON.stringify(T.TIDY_SCHEDULES.map((x) => x[0])) === JSON.stringify(listOf('TIDY_SCHEDULES')))
  check('the host codes of the Study model have words', ['deja_en_cours', 'pas_de_modele_detude', 'llm_indisponible', 'delai_depasse', 'modele_en_erreur', 'valeur_invalide'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  check('the limits agree with the host sources', /const TIDY_MAX_REMOVALS = 50/.test(readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8')) && /const TIDY_MAX_REMOVALS = 50/.test(readFileSync(join(HERE, 'index.js'), 'utf8')) && /MEMORY_MAX_CONTENT = 2000/.test(readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8')) && /LESSON_MAX_CHARS = 500/.test(readFileSync(join(HERE, 'lessons-store.mjs'), 'utf8')))
}

// ── « Memory looks after itself »: the one-line status, the account step, the cap note (WP-10: N-04, N-05)
console.log('looks after itself')
{
  const now = Date.parse('2026-10-16T12:00:00.000Z')
  const ago = (min) => new Date(now - min * 60000).toISOString()
  const connected = (yes) => ({ loaded: true, connected: yes, plan: 'free', raw: null })
  const MEM = { memories: true, context: true, capture: true, relevant: true, meaning: false }
  const LES = { lessons: true, context: true, relevant: true }
  const sw = (memory, lessons) => ({ loaded: true, memory, lessons, capture: null })
  const cfg = (extra) => Object.assign({ mode: 'auto', schedule: 'weekly', brain: false }, extra)
  const view = (settings, last) => ({ ok: true, groups: [], saves: 0, scannedAt: null, total: 0, log: [], settings, last: last === undefined ? null : last })
  const tidyOf = (settings, last) => ({ loaded: true, mem: null, les: view(settings, last) })
  const S = (c, s, t) => T.selfStatus({ status: c, settings: s, tidy: t, now })

  check('while anything is still loading, the line is empty and never says Off', ['status', 'settings', 'tidy'].every((k) => {
    const all = { status: connected(true), settings: sw(MEM, LES), tidy: tidyOf(cfg()) }
    all[k] = Object.assign({}, all[k], { loaded: false })
    const r = T.selfStatus(Object.assign(all, { now }))
    return r.tone === 'wait' && r.text === ''
  }))
  const happy = S(connected(true), sw(MEM, LES), tidyOf(cfg(), { at: ago(3 * 1440), trigger: 'schedule', autoGroups: 0, found: 0 }))
  check('the defaults working: one line, what is on and when it last tidied', happy.tone === 'ok' && happy.text === 'Memories and lessons are on · Last tidied 3 days ago' && happy.connect === false, happy)
  check('never tidied yet: it says it tidies itself, and how often', S(connected(true), sw(MEM, LES), tidyOf(cfg())).text === 'Memories and lessons are on · Tidies itself every week'
    && S(connected(true), sw(MEM, LES), tidyOf(cfg({ schedule: 'daily' }))).text.endsWith('Tidies itself every day')
    && S(connected(true), sw(MEM, LES), tidyOf(cfg({ schedule: 'start' }))).text.endsWith('Tidies itself when DSH starts')
    && S(connected(true), sw(MEM, LES), tidyOf(cfg({ schedule: 'n50' }))).text.endsWith('Tidies itself every 50 new items'))
  check('automatic tidy-up switched off by the person: the line says so, still not « Off »', S(connected(true), sw(MEM, LES), tidyOf(cfg({ schedule: 'off' }))).text === 'Memories and lessons are on · Automatic tidy-up is off')

  // The audit's state (N-04): no account, nothing else touched. Lessons work; the one step is the account.
  const bare = S(connected(false), sw(MEM, LES), tidyOf(cfg()))
  check('no account: lessons still work and the line says so, the one step is connecting, and the chip is never Off', bare.tone === 'step' && bare.connect === true
    && bare.text === 'Lessons are on and stay on this computer · Memories need your account · Tidies itself every week' && !/\bOff\b/i.test(bare.text), bare)
  check('no account, the cloud plugin silent (memory null): lessons on is still the line', S(connected(false), sw(null, LES), tidyOf(cfg())).text.startsWith('Lessons are on and stay on this computer'))

  check('one half switched off by the person: it is named, the other half is still on', S(connected(true), sw(MEM, Object.assign({}, LES, { lessons: false })), tidyOf(cfg())).text === 'Memories are on · Lessons are off · Tidies itself every week'
    && S(connected(true), sw(Object.assign({}, MEM, { memories: false }), LES), tidyOf(cfg())).text === 'Lessons are on · Memories are off · Tidies itself every week')
  check('kept but not sent to the model is said, per half', /Saved memories are not sent to the model/.test(S(connected(true), sw(Object.assign({}, MEM, { context: false }), LES), tidyOf(cfg())).text)
    && /Lessons are not sent to the model/.test(S(connected(true), sw(MEM, Object.assign({}, LES, { context: false })), tidyOf(cfg())).text))
  const dead = S(connected(true), sw(Object.assign({}, MEM, { memories: false }), Object.assign({}, LES, { lessons: false })), tidyOf(cfg()))
  check('everything switched off by the person is the only « off » state', dead.tone === 'off' && dead.text === 'Memory is off' && dead.connect === false, dead)
  check('…and with no account as well, the step is still there', S(connected(false), sw(MEM, Object.assign({}, LES, { lessons: false })), tidyOf(cfg())).connect === true)
  check('hosts that say nothing about the tidy-up: no tidy part, no crash', S(connected(true), sw(MEM, LES), { loaded: true, mem: null, les: null }).text === 'Memories and lessons are on')
  check('garbage in, a line out (never throws)', (() => { try { return typeof T.selfStatus({}).text === 'string' && typeof T.selfStatus(null).text === 'string' && typeof T.selfStatus({ status: connected(true), settings: sw(MEM, LES), tidy: { loaded: true, mem: 5, les: { last: 'x' } }, now }).text === 'string' } catch (e) { return false } })())
  check('the chip is only « Off » when nothing works, for every combination of the switches', (() => {
    for (const c of [true, false]) for (const m of [true, false]) for (const l of [true, false]) {
      const r = S(connected(c), sw(Object.assign({}, MEM, { memories: m }), Object.assign({}, LES, { lessons: l })), tidyOf(cfg()))
      const works = (c && m) || l
      if (works && (r.tone === 'off' || /\bOff\b/.test(r.text))) return false
      if (!works && r.tone !== 'off') return false
    }
    return true
  })())

  // Connecting is the host page's own event (the Models page uses it too): never a hard failure when the card is not mounted.
  {
    const sent = []
    const saved = globalThis.window.dispatchEvent
    globalThis.window.dispatchEvent = (e) => { sent.push(e.type) }
    globalThis.CustomEvent = function (type) { this.type = type }
    T.connectAccount()
    globalThis.window.dispatchEvent = () => { throw new Error('no card') }
    let threw = false
    try { T.connectAccount() } catch (e) { threw = true }
    globalThis.window.dispatchEvent = saved
    check('« Connect your account » opens the cloud card through the shared window event, and never throws', sent.join() === 'kybernos-cloud:open' && threw === false, sent)
  }

  // The cap (N-05): a team nearing 50 lessons is tidied by itself; the page says why and what happens at 50.
  const K = (id, count) => ({ id, count })
  check('the cap and the near-cap line agree with the host store', T.LESSONS_CAP === 50 && T.LESSONS_NEAR === 40 && /LESSONS_MAX_COUNT = 50/.test(readFileSync(join(HERE, 'lessons-store.mjs'), 'utf8')) && /LESSONS_NEAR_COUNT = 40/.test(readFileSync(join(HERE, 'lessons-store.mjs'), 'utf8')))
  check('no note while every agent team is under 40 lessons (39 is not near)', T.capNote([K('default', 12), K('dev-team', 39)], cfg()) === null && T.capNote([], cfg()) === null && T.capNote(null, cfg()) === null)
  check('40 is near: the fullest team is named with its count, and what happens by itself', T.capNote([K('default', 12), K('dev-team', 40)], cfg()) === 'dev-team holds 40 of 50 lessons. Close matches are merged by themselves; when it is full, the least useful lesson goes to the archive, never deleted.')
  check('two teams near: the fullest first, the other one counted', /^dev-team holds 47 of 50 lessons \(1 other agent team is close\)\./.test(T.capNote([K('default', 41), K('dev-team', 47)], cfg())) && /\(2 other agent teams are close\)/.test(T.capNote([K('a', 41), K('b', 47), K('c', 44)], cfg())))
  check('a full team says it is full', /^default holds 50 of 50 lessons/.test(T.capNote([K('default', 50)], cfg())) && /when it is full/.test(T.capNote([K('default', 50)], cfg())))
  check('« Ask me first »: the close matches wait for the person; automatic tidy-up off: the note says where to do it', /Close matches wait for your review\./.test(T.capNote([K('default', 44)], cfg({ mode: 'ask' }))) && /Automatic tidy-up is off: use Clean up now in Customize\./.test(T.capNote([K('default', 44)], cfg({ schedule: 'off' }))))
  const capView = (trigger, autoGroups) => ({ mem: null, les: view(cfg(), { at: ago(3), trigger, autoGroups, autoRemoved: 3, found: 2 }) })
  const capLog = [{ id: 'a', at: ago(3), by: 'auto', canUndo: true, src: 'les' }]
  const capRan = (trigger) => { const v = capView(trigger, 2); v.les.log = capLog; return T.tidyRanNotice(v, '') }
  check('a run started because a team was nearly full is announced like a scheduled one, with its Undo', capRan('cap') !== null && capRan('cap').groups === 2 && capRan('cap').entries.length === 1 && capRan('manual') === null)
  check('the last run in words names the reason', T.lastWords({ at: ago(120), trigger: 'cap', autoGroups: 1, found: 1 }, now) === 'Last run 2 hours ago (an agent team was nearly full): merged 1 group by itself.')

  // The stylesheet (A3-21): at a phone width DSH's mobile layer grows every button to a finger's height. A pill with a fixed height
  // then lets its buttons run out of it onto the next row. The pills grow with their buttons, the search field wraps its modes.
  const rule = (selector) => { const m = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.\[\]]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm').exec(T.css); return m === null ? null : m[1] }
  const seg = rule('.kbmem-seg'), segSm = rule('.kbmem-seg.sm'), field = rule('.kbmem-field'), modes = rule('.kbmem-modes')
  check('the segmented pills have a minimum height, never a fixed one', seg !== null && /min-height:38px/.test(seg) && !/(^|;)height:/.test(seg) && segSm !== null && /min-height:32px/.test(segSm) && !/(^|;)height:/.test(segSm), { seg, segSm })
  check('the search field has a minimum height, never a fixed one, and its modes wrap under the input instead of over the next control', field !== null && /min-height:36px/.test(field) && !/(^|;)height:/.test(field) && /flex-wrap:wrap/.test(field) && modes !== null, { field })
  check('the search field asks for room (a flex basis) so the toolbar wraps instead of squeezing it', /flex:1 1 \d+px/.test(field || ''), field)
}

console.error = realError
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
