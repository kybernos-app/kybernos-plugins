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

// ── URLs
console.log('urls')
const base = (over) => ({ size: 25, page: 1, q: '', f: T.defaultFilters(), ...over })
check('defaults leave every filter out', T.listUrl('memories', base()) === '/kybernos-cloud/memory/list?limit=25&offset=0')
check('page 3 of 50 → offset 100', T.listUrl('memories', base({ size: 50, page: 3 })) === '/kybernos-cloud/memory/list?limit=50&offset=100')
check('memory filters and the search are sent, trimmed', T.listUrl('memories', base({ q: '  deploy  ', f: { ...T.defaultFilters(), show: 'pinned', src: 'agent', added: '1h' } })) === '/kybernos-cloud/memory/list?limit=25&offset=0&added=1h&q=deploy&show=pinned&src=agent')
check('lessons go to the lessons host, kyber/used/added/q', T.listUrl('lessons', base({ q: 'x y', f: { ...T.defaultFilters(), kyber: 'dev-team', status: 'used', added: 'today' } })) === '/kybernos-memory/lessons?limit=25&offset=0&added=today&q=x+y&kyber=dev-team&used=1')
check('a memory-only filter never leaks into a lessons URL', !/show=|src=/.test(T.listUrl('lessons', base({ f: { ...T.defaultFilters(), show: 'pinned', src: 'agent' } }))))
check('the page never asks for a search by meaning: no `mode` goes to the list route, whatever the state says', !/mode=/.test(T.listUrl('memories', base({ q: 'cafe', mode: 'meaning' }))) && !/mode=/.test(T.listUrl('lessons', base({ q: 'cafe', mode: 'meaning' }))))

console.log('search by meaning')
{
  const store = new Map()
  globalThis.window.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } }
  store.set('kbmem.searchMode', 'garbage')
  globalThis.window.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  delete globalThis.window.localStorage
}
check('a hostile search is encoded, not concatenated', T.listUrl('memories', base({ q: 'a&limit=9999#x' })).includes('q=a%26limit%3D9999%23x'))

// ── filters
console.log('filters')

// ── words
console.log('words')
const fe = T.friendlyError
check('known codes are sentences, unknown ones keep the code', fe('non connecte') === 'Not connected to Kybernos Cloud.' && fe('reconnexion_requise').includes('expired') && fe('reseau').includes('cannot be reached') && fe('refus_503') === 'The server refused the request (503).' && fe('weird_code') === 'Something went wrong (weird_code).' && fe(undefined) === 'Something went wrong.')
check('input errors are said as input errors', fe('contenu_vide') === 'Write something first.' && fe('contenu_trop_long').includes('2 000') && fe('memoire_desactivee') === 'Memory is switched off.' && fe('lecon_introuvable') === 'That lesson no longer exists.')
const cw = T.captureWords

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

// ── the « Noted » line in the chat
console.log('noted line')
{
  const find = (tree, pred, out = []) => { if (Array.isArray(tree)) { if ((typeof tree[0] === 'string' || typeof tree[0] === 'function') && pred(tree)) out.push(tree); tree.forEach((c) => find(c, pred, out)) } return out }
  const text = (tree) => (Array.isArray(tree) ? (typeof tree[0] === 'string' || typeof tree[0] === 'function' ? tree.slice(2) : tree).map(text).join('') : (typeof tree === 'string' ? tree : ''))
  const noteOf = (id, content) => ({ id, at: 1, item: { id, content, kind: 'fact', origin: 'capture', createdAt: '2026-11-20 10:00:00+00:00' } })
  check('a line shows the note\'s name: whitespace folded, a long one cut on a word with an ellipsis', T.notedLine('  You live\n in  Lyon. ') === 'You live in Lyon.' && T.notedLine('') === '' && T.notedLine(undefined) === '' && T.notedLine('word '.repeat(60)).length <= 111 && T.notedLine('word '.repeat(60)).endsWith('…') && !/\s…$/.test(T.notedLine('word '.repeat(60))))
  check('the turn\'s number is read as the closing sequence, then as `turn`, and is absent when neither is a number', T.notedSeq({ seq: 4 }) === 4 && T.notedSeq({ turn: 7 }) === 7 && T.notedSeq({ seq: 4, turn: 7 }) === 4 && T.notedSeq({ turn: {} }) === undefined && T.notedSeq(null) === undefined)
  {
    const store = { claims: new Map() }
    const a = T.notedClaim(store, 's1', 1, [10, 11])
    const b = T.notedClaim(store, 's1', 2, [10, 11, 12])
    check('a note is claimed by the first turn that sees it: the next turn does not repeat it', a.join() === '10,11' && b.join() === '12')
    check('the same turn sees its notes again (a re-draw), another chat has its own', T.notedClaim(store, 's1', 1, [10, 11]).join() === '10,11' && T.notedClaim(store, 's2', 5, [10]).join() === '10')
    const loose = { claims: new Map() }
    check('with no turn number it fails open: every note is shown, nothing is claimed away', T.notedClaim(loose, 's1', undefined, [1, 2]).join() === '1,2' && T.notedClaim(loose, 's1', undefined, [1, 2]).join() === '1,2')
    const big = { claims: new Map() }
    for (let i = 0; i < 600; i += 1) T.notedClaim(big, 's', i, [i])
    check('the claims are bounded', big.claims.size <= 400)
  }
  check('Undo: ok → undone; the note already gone (404) → gone; any other refusal → failed (the button stays)', T.notedUndoState({ ok: true }) === 'undone' && T.notedUndoState({ ok: false, error: 'refus_404' }) === 'gone' && T.notedUndoState({ ok: false, error: 'reseau' }) === 'failed' && T.notedUndoState({ ok: false, error: 'non connecte' }) === 'failed' && T.notedUndoState(undefined) === 'failed')
  fetchImpl = async (url, init) => { seen.url = url; seen.init = init; return { status: 200, json: async () => ({ ok: true, run: 'dx1' }) } }
  check('Undo is the delete the page uses (its 30 days of « Recently removed » come with it)', (await T.undoNoted(42)) === 'undone' && seen.url === '/kybernos-cloud/memory/delete' && seen.init.body === '{"id":42}')
  fetchImpl = async () => { throw new Error('offline') }
  check('Undo with the server away says failed, never throws', (await T.undoNoted(42)) === 'failed')
  const lines = (notes, status) => T.NotedLines({ notes, status: status === undefined ? {} : status, onOpen: () => {}, onUndo: () => {} })
  check('nothing noted draws nothing', lines([]) === null)
  const one = lines([noteOf(7, 'You live in Lyon. The shop is in Paris.')])
  check('one line: « Noted: » and the name only, one Open and one Undo, quiet (no role=alert, no card)', text(find(one, (n) => n[1] && n[1]['data-kbmem'] === 'noted-line')[0]).startsWith('Noted: You live in Lyon') && !text(one).includes('The shop is in Paris') && find(one, (n) => n[1] && n[1]['data-act'] === 'noted-open').length === 1 && find(one, (n) => n[1] && n[1]['data-act'] === 'noted-undo').length === 1 && JSON.stringify(one).indexOf('"role":"alert"') < 0)
  check('the buttons say Open and Undo, and are real buttons', find(one, (n) => n[0] === 'button').every((b) => b[1].type === 'button') && text(find(one, (n) => n[1] && n[1]['data-act'] === 'noted-open')[0]) === 'Open' && text(find(one, (n) => n[1] && n[1]['data-act'] === 'noted-undo')[0]) === 'Undo')
  const five = lines([1, 2, 3, 4, 5].map((i) => noteOf(i, 'Note number ' + String(i) + '.')))
  check('at most three lines under one answer', find(five, (n) => n[1] && n[1]['data-kbmem'] === 'noted-line').length === T.NOTED_SHOWN && T.NOTED_SHOWN === 3)
  const done = lines([noteOf(7, 'You live in Lyon.')], { 7: 'undone' })
  check('undone: « Undone: » and the name, no buttons left', text(done).startsWith('Undone: You live in Lyon') && find(done, (n) => n[0] === 'button').length === 0)
  const gone = lines([noteOf(7, 'You live in Lyon.')], { 7: 'gone' })
  check('already removed: it says so, no buttons', text(gone).startsWith('Already removed: You live in Lyon') && find(gone, (n) => n[0] === 'button').length === 0)
  const failed = lines([noteOf(7, 'You live in Lyon.')], { 7: 'failed' })
  check('a failed Undo says so in words and keeps the buttons to try again', /could not|couldn.t/i.test(text(failed)) && find(failed, (n) => n[1] && n[1]['data-act'] === 'noted-undo').length === 1 && find(failed, (n) => n[1] && n[1]['data-act'] === 'noted-undo')[0][1].disabled !== true)
  const busy = lines([noteOf(7, 'You live in Lyon.')], { 7: 'busy' })
  check('while Undo runs the buttons are off (no second tap)', find(busy, (n) => n[0] === 'button').every((b) => b[1].disabled === true))
  const calls2 = []
  const wired = T.NotedLines({ notes: [noteOf(7, 'You live in Lyon.')], status: {}, onOpen: (n) => calls2.push(['open', n.id]), onUndo: (n) => calls2.push(['undo', n.id]) })
  find(wired, (n) => n[1] && n[1]['data-act'] === 'noted-open')[0][1].onClick()
  find(wired, (n) => n[1] && n[1]['data-act'] === 'noted-undo')[0][1].onClick()
  check('Open and Undo hand the note to their handlers', JSON.stringify(calls2) === '[["open",7],["undo",7]]')
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
  const frLine = lines([noteOf(7, 'Tu habites à Lyon.')])
  check('in French: « Noté : » with Ouvrir and Défaire (the page\'s own word for Undo)', text(find(frLine, (n) => n[1] && n[1]['data-kbmem'] === 'noted-line')[0]).startsWith('Noté : Tu habites à Lyon') && text(find(frLine, (n) => n[1] && n[1]['data-act'] === 'noted-open')[0]) === 'Ouvrir' && text(find(frLine, (n) => n[1] && n[1]['data-act'] === 'noted-undo')[0]) === 'Défaire')
  delete globalThis.window.__KB_LANG_RESOLVE__
  // Open: the note travels to the page in a hand-over that expires, and is taken once.
  T.notedOpen.pending = null
  T.notedOpen.give({ id: 9, content: 'x' })
  check('the hand-over is taken once, and only while fresh', T.notedOpen.take().id === 9 && T.notedOpen.take() === null && (() => { T.notedOpen.give({ id: 9 }); T.notedOpen.pending.at = Date.now() - 20000; return T.notedOpen.take() === null })())
  check('the page asks the hand-over when it opens', /notedOpen\.take\(\)/.test(SOURCE) && /notedOpen\.subs\.add/.test(SOURCE))
  check('the tail asks only its own chat, from the host, and reads nothing else', /\/kybernos-cloud\/memory\/noted\?sessionId=/.test(SOURCE))
  check('the line has its own prefixed styles, quiet in both themes (tokens, no fixed colour but the fallbacks of the page\'s own chain)', /\.kbmem-noted\{/.test(SOURCE) && /\.kbmem-noted button\{[^}]*color:var\(--m-acc\)/.test(SOURCE))
}

// ── mounting
console.log('mounting')
const calls = { slot: [], effects: [] }
const ctx = { slots: { inject: (name, cb) => { cb(); return () => {} }, register: (meta, comp) => { calls.slot.push({ meta, comp }); return () => {} } }, effect: (fn, label) => { const d = fn(); calls.effects.push({ label, d }) } }
mod.apply(ctx)
check('registers one settings section (its drawn place is the shell menu grouping\'s: scripts/test-live-checks.mjs)',calls.slot.length === 2 && calls.slot[0].meta.name === 'settings.section' && calls.slot[0].meta.name === 'settings.section' && calls.slot[0].meta.id === 'kybernos-memory' && calls.slot[0].meta.order === 3 && calls.slot[0].meta.label === 'Memory & Lessons')
check('the section renders the page component', typeof calls.slot[0].comp === 'function')
check('styles are inserted once, tagged with the plugin, and can be removed', tags.length === 1 && tags[0].dataset.plugin === '@local/kybernos-memory' && typeof calls.effects[0].d === 'function')
check('the « Noted » line is registered at the end of an answer (conversation.chat.turnTail)', calls.slot.length === 2 && calls.slot[1].meta.name === 'conversation.chat.turnTail' && calls.slot[1].meta.id === 'kybernos-memory-noted' && typeof calls.slot[1].comp === 'function')
check('every effect is labelled (cordis disposers)', calls.effects.length === 3 && calls.effects.every((e) => /^kybernos-memory:/.test(e.label)))
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
const others = ['kybernos-plugin', 'kybernos-cloud', 'kybernos-sessions', 'kybernos-language', 'kybernos-theme', 'kybernos-models', 'kybernos-auto', 'kybernos-hub', 'kybernos-flow'].filter((d) => { try { return /kbmem-/.test(readFileSync(join(HERE, '..', d, 'client.js'), 'utf8').replace(/\/\/ kb-pres:begin[\s\S]*?\/\/ kb-pres:end/g, '')) } catch (e) { return false } })
// The one exception: the Theme's presentation block (between its `kb-pres:begin` / `kb-pres:end` lines) styles the Settings pages from outside, so it names the balisage of the page (it declares no class of this prefix).
check('no other bundle uses the kbmem- prefix', others.length === 0, others)
check('the page never calls a cloud URL directly: only same-origin local routes', !/https?:\/\//.test(SOURCE.replace(/\/\/.*$/gm, '').replace(/<path[^>]*>/g, '')) )

// ── nav placement: DSH's Settings nav is grouped by label (kybernos-plugin); a label it does not know falls to the
// bottom, under the last header (seen on the real GUI). The menu is General + eight folds (GROUPES): ours is the first row of the « Memory & context »
// fold. The order of the folds and of the rows after it is test-settings-nav.mjs's; this one only keeps the page out of the tail and in the fold it leads.
console.log('settings nav')
{
  // The nav label is the page's own title, said in the language in use (English at the base).
  const label = /id: 'kybernos-memory', order: 3, label: pageTitle\(\) \}/.test(SOURCE) && /const PAGE_TITLE = 'Memory & Lessons'/.test(SOURCE) ? 'Memory & Lessons' : undefined
  const nav = readFileSync(join(HERE, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const at0 = nav.indexOf('const GROUPES = [')
  const groups = [...nav.slice(at0, at0 + 4000).matchAll(/\{ id: '([a-z]+)', titre: (?:null|kbt\('[^']+'\))[^\n]*?mots: \[([^\]]*)\]/g)]
    .map((m) => ({ id: m[1], words: m[2].split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter((w) => w !== '') }))
  const mine = groups.find((g) => g.words.indexOf((label || '').toLowerCase()) >= 0)
  check('the nav label is the one the page registers', label === 'Memory & Lessons')
  check('a fold of the Settings menu holds it (else it falls to the tail, under the last header)', mine !== undefined, groups.map((g) => g.id))
  check('it is the Memory & context fold, and the page leads it', mine !== undefined && mine.id === 'memory' && mine.words[0] === 'memory & lessons', mine)
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
  check('the limits and endpoints match the hosts', T.TIDY_MAX_REMOVALS === 50 && T.TIDY_SOURCES.mem.base === '/kybernos-cloud/memory/tidy' && T.TIDY_SOURCES.les.base === '/kybernos-memory/tidy' && T.TIDY_SOURCES.les.max === 500)
  check('the host codes of a tidy-up have words', ['a_change', 'groupe_inconnu', 'garde_invalide', 'epingle_protege', 'trop_de_suppressions', 'kyber_plein', 'archive_perimee', 'deja_annule', 'aucun_scan'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  const NOW2 = Date.parse('2026-10-05T12:00:00.000Z')
  const inMin = (m) => new Date(NOW2 + m * 60000).toISOString()
  const vw = (extra) => ({ ok: true, groups: [], saves: 0, scannedAt: 'A', total: 5, log: [], ...extra })
  check('the settings shown are the lessons host\'s, else the memories\', else the defaults', T.tidySettingsOf({ mem: vw({ settings: { mode: 'ask', schedule: 'off', brain: false } }), les: vw({ settings: { mode: 'auto', schedule: 'daily', brain: true } }) }).schedule === 'daily' && T.tidySettingsOf({ mem: vw({ settings: { mode: 'ask', schedule: 'off', brain: false } }), les: null }).mode === 'ask' && T.tidySettingsOf({ mem: vw(), les: vw() }).mode === 'auto' && T.tidySettingsOf({ mem: null, les: null }).schedule === 'weekly')
  const ago2 = (m) => new Date(NOW2 - m * 60000).toISOString()
  const B = T.tidyBrain({ mem: vw({ brain: { model: 'zai/GLM', llm: true }, unclear: 2 }), les: vw({ brain: { model: 'zai/GLM', llm: false }, unclear: 3 }) })
  check('the Study model: its name, whether a model service exists anywhere, the unclear pairs of both sides', B.model === 'zai/GLM' && B.llm === true && B.unclear === 5 && T.tidyBrain({ mem: null, les: vw({ brain: { model: '', llm: false } }) }).llm === false)
  const Ba = T.tidyBrain({ mem: null, les: vw({ brain: { model: 'kybernos/auto', llm: true, auto: true, none: false } }) })
  check('a Study model picked automatically is reported as such', Ba.model === 'kybernos/auto' && Ba.auto === true && Ba.none === false, Ba)
  const Bn = T.tidyBrain({ mem: vw({ brain: { model: '', llm: true, auto: false, none: true } }), les: vw({ brain: { model: '', llm: true, auto: false, none: true } }) })
  check('« None » is told apart from « nothing found yet »', Bn.none === true && Bn.model === '' && T.tidyBrain({ mem: null, les: vw({ brain: { model: '', llm: true, auto: false, none: false } }) }).none === false, Bn)
  const Bo = T.tidyBrain({ mem: vw({ brain: { model: 'a/b', llm: true } }), les: null })
  check('a host that says nothing of automatic or none (an older build) gives neither', Bo.auto === false && Bo.none === false && Bo.model === 'a/b', Bo)
  check('the scan error « no Study model » no longer tells to pick one in the Settings', !/pick one in Kybernos Settings/.test(T.friendlyError('pas_de_modele_detude')) && /None|connect/.test(T.friendlyError('pas_de_modele_detude')), T.friendlyError('pas_de_modele_detude'))
  const LOGS = [{ id: 'a', at: ago2(3), by: 'auto', canUndo: true }, { id: 'b', at: ago2(3), by: 'auto', canUndo: false }, { id: 'c', at: ago2(60 * 24), by: 'auto', canUndo: true }, { id: 'd', at: ago2(3), by: 'you', canUndo: true }]
  const ranView = (trigger, autoGroups) => ({ mem: vw({ last: { at: ago2(3), trigger, autoGroups, autoRemoved: 5, found: 5 }, log: LOGS }), les: null })
  // ── team lessons
  const nowT = Date.parse('2026-10-05T12:00:00.000Z')
  check('team: owners and admins are the ones who decide', T.isTeamAdmin('owner') && T.isTeamAdmin('admin') && !T.isTeamAdmin('member') && !T.isTeamAdmin(null) && !T.isTeamAdmin(undefined))
  check('team: minutes since a date, never NaN', T.minutesSince('2026-10-05T11:00:00.000Z', nowT) === 60 && T.minutesSince('2026-10-05T12:30:00.000Z', nowT) === 0 && T.minutesSince('garbage', nowT) === null && T.minutesSince(null, nowT) === null)
  check('team: the status chip says what the proposer sees', JSON.stringify(T.teamStatusChip({ status: 'proposed' })) === '["Waiting for review","warn"]' && T.teamStatusChip({ status: 'approved' })[1] === 'ok' && T.teamStatusChip({ status: 'rejected' })[0] === 'Rejected' && T.teamStatusChip({ status: 'retired' })[0] === 'Retired' && T.teamStatusChip({ status: 'weird' })[0] === 'weird')
  const TL = (o) => Object.assign({ id: 1, text: 'expo start with CI=1 serves a frozen bundle', tags: ['expo'], kyber: 'app-mobile', status: 'approved', proposedName: 'Sara M.', reviewedName: 'Alex R.', createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z' }, o)
  check('team: the search needs every word, anywhere (text, tag, kyber, names), case-insensitive', T.teamMatches(TL(), 'FROZEN bundle') && T.teamMatches(TL(), 'expo app-mobile') && T.teamMatches(TL(), 'sara alex') && T.teamMatches(TL(), '') && T.teamMatches(TL(), null) && !T.teamMatches(TL(), 'frozen nonsense') && T.teamMatches(TL({ kyber: null }), 'general') && T.teamMatches(TL({ kyber: null, proposedName: null, reviewedName: null }), 'frozen'))
  check('team: the line under a lesson (who proposed, who approved, how long ago)', T.teamMeta(TL(), nowT).join(' | ') === 'Proposed by Sara M. | approved by Alex R. | 2h ago' && T.teamMeta(TL({ status: 'rejected' }), nowT).includes('rejected by Alex R.') && T.teamMeta(TL({ status: 'proposed', reviewedName: null, updatedAt: '2026-10-05T11:59:50.000Z' }), nowT).join(' | ') === 'Proposed by Sara M. | just now' && T.teamMeta(TL({ proposedName: null, reviewedName: null, status: 'proposed', updatedAt: null, createdAt: null }), nowT).length === 0)
  check('team: the page has its pieces (tab, sheets, review queue, status hook) and talks only to the plugin\'s own routes', /const TeamPane/.test(SOURCE) && /const TeamReviewView/.test(SOURCE) && /const ProposeSheet/.test(SOURCE) && /const TeamOpenSheet/.test(SOURCE) && /const useTeam/.test(SOURCE) && ['/kybernos-cloud/team/status', '/kybernos-cloud/team/lessons/add', '/kybernos-cloud/team/lessons/review', "'/kybernos-cloud/team/lessons/' + path"].every((u) => SOURCE.indexOf(u) >= 0) && /act\('retire'/.test(SOURCE) && /act\('delete'/.test(SOURCE) && !/v1\/workspaces/.test(SOURCE))
  check('team: the routes the page calls exist on the host', (() => { const host = readFileSync(join(HERE, '..', 'kybernos-cloud', 'index.js'), 'utf8'); return ['/team/status', '/team/lessons', '/team/lessons/add', '/team/lessons/review', '/team/lessons/retire', '/team/lessons/delete'].every((r) => host.indexOf("path: '/kybernos-cloud" + r + "'") >= 0) })())
  check('team: the host codes have words', ['doublon', 'equipe_pleine', 'trop_de_propositions', 'admin_requis', 'deja_decidee', 'non_approuvee', 'espace_introuvable', 'offre_requise', 'aucun_espace', 'partage_desactive', 'texte_invalide', 'requete_invalide'].every((c) => T.friendlyError(c).indexOf('Something went wrong') < 0))
  check('the map is gone: nothing draws it and the page never calls its route', !/MapPane|meaning-map|memory\/map/.test(SOURCE))
  const tidyHost = readFileSync(join(HERE, '..', 'kybernos-cloud', 'tidy.mjs'), 'utf8')
  const listOf = (name) => JSON.parse((new RegExp('export const ' + name + " = (\\[[^\\]]*\\])").exec(tidyHost)[1]).replace(/'/g, '"'))
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


  // The stylesheet (A3-21): at a phone width DSH's mobile layer grows every button to a finger's height. A pill with a fixed height
  // then lets its buttons run out of it onto the next row. The pills grow with their buttons, the search field wraps its modes.
  const rule = (selector) => { const m = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.\[\]]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm').exec(T.css); return m === null ? null : m[1] }
  const seg = rule('.kbmem-seg'), segSm = rule('.kbmem-seg.sm'), field = rule('.kbmem-field')
  check('the segmented pills have a minimum height, never a fixed one', seg !== null && /min-height:38px/.test(seg) && !/(^|;)height:/.test(seg) && segSm !== null && /min-height:32px/.test(segSm) && !/(^|;)height:/.test(segSm), { seg, segSm })
  check('the team search field has a minimum height, never a fixed one, and wraps its input instead of squeezing it', field !== null && /min-height:36px/.test(field) && !/(^|;)height:/.test(field) && /flex-wrap:wrap/.test(field), field)
  check('the search field asks for room (a flex basis) so the toolbar wraps instead of squeezing it', /flex:1 1 \d+px/.test(field || ''), field)

}

// ── « Make a skill » (a lesson page hands the lesson to the Skills page)
console.log('skills from lessons')
{
  const now = Date.parse('2026-10-21T12:00:00Z')
  const base = { status: { loaded: true, connected: true }, settings: { loaded: true, memory: { memories: true, context: true }, lessons: { lessons: true, context: true } }, tidy: { loaded: true, mem: null, les: null }, now }
  const L = (id, tags) => ({ id, text: 'Lesson ' + id, tags, kyber: 'default' })
  const sent = []
  fetchImpl = async (url, init) => { sent.push({ url, init }); return { status: 200, json: async () => ({ ok: true, proposal: { name: 'i18n-checklist' } }) } }
  let refreshed = 0
  globalThis.window.__KB_LEARNED__ = { refresh: () => { refreshed += 1 } }
  const r = await T.suggestSkill([L(1, ['i18n']), L(2, ['i18n'])])
  check('« Make a skill » posts the lessons to the Skills page (text, tags, agent team), and nothing else', r.ok === true && sent.length === 1 && sent[0].url === '/kybernos-skills/learned/from-lessons' && sent[0].init.method === 'POST' && JSON.parse(sent[0].init.body).lessons.length === 2 && JSON.parse(sent[0].init.body).lessons[0].kyber === 'default', sent)
  check('and tells the menu dot to look again', refreshed === 1)
  fetchImpl = async () => ({ status: 404, json: async () => { throw new Error('not json') } })
  check('a host without the Skills page answers « unavailable », in words', (await T.suggestSkill([L(1, ['i18n'])])).error === 'indisponible' && T.friendlyError('indisponible').length > 10)
  check('the refusals of the Skills page have a sentence in both languages', ['already_proposed', 'too_many_pending', 'no_free_name', 'no_lessons'].every((k) => T.friendlyError(k) !== k && T.friendlyError(k).length > 10))
  check('the lesson sheet carries the button, next to « Propose to team »', SOURCE.includes("'data-act': 'make-skill'") && SOURCE.indexOf("'data-act': 'make-skill'") > SOURCE.indexOf("'data-act': 'propose-team'"))
  delete globalThis.window.__KB_LEARNED__
}

// ── Kaby's suggested memories (the ledger of the core plugin, kind « memory »)
console.log('suggested memories')
{
  check('the page asks the ledger for the memory kind and draws a dashed block above the list, after the notes', SOURCE.includes("'/kybernos/suggestions?kind=memory'") && SOURCE.includes("'data-sug': 'block'") && SOURCE.indexOf('h(MemSuggest,') > SOURCE.indexOf('const ManageView') && SOURCE.indexOf('h(MemSuggest,') < SOURCE.indexOf("className: 'kbmem-nsearch'"))
  check('the block shows on « Your memory » only, never on the Team tab', /tab === 'team' && teamAvail \? h\(TeamPane[^\n]*: mine/.test(SOURCE) && /const mine = \[[\s\S]*?h\(MemSuggest,/.test(SOURCE))
  check('Add keeps the text through the ordinary add route (a fact, not pinned, taught), then tells the ledger and the list', SOURCE.includes("api('/kybernos-cloud/memory/add', { content: it.text, kind: 'fact', pinned: false, source: 'taught' })") && SOURCE.includes("await resolve(it.id); drop(it.id); onChanged()"))
  check('without an account Add and Edit wait (disabled) and the block says why, in both languages', SOURCE.includes("disabled: busy !== '' || connected !== true") && SOURCE.includes("'data-sug': 'account'") && SOURCE.includes('Connect your account to keep them') && SOURCE.includes('Connecte ton compte pour les garder'))
  check('Discard asks nothing of the account: it only resolves the suggestion', /discard = async \(it\) => \{ drop\(it\.id\); await resolve\(it\.id\) \}/.test(SOURCE))
  check('Edit puts the text in the box of Manage, and the ledger is told only once the note is added', SOURCE.includes('onEdit: (it, done) => { setSay(it.text); pending.current = done;') && SOURCE.includes('if (pending.current !== null) { pending.current(); pending.current = null }'))
}

console.log('the page title has no style of its own')
{
  check('the Memory & Lessons head is one pageHead: the h1, then the Suite\'s « ? »', /pageHead\(\{ id: 'kybernos-memory', title: pageTitle\(\), as: 'h1', className: 'kbmem-h1' \}\)/.test(SOURCE))
  check('its sub-views with a head of their own (proposals, tidy-up) take the same title through pageHead', ['Propositions de leçons d’équipe', 'Suggestions de rangement'].every((fr) => new RegExp("pageHead\\(\\{ title: kt\\('" + fr + "'").test(SOURCE)))
  check('no heading of the page is built by hand any more (every kbmem-h1 goes through pageHead)', (SOURCE.match(/className: 'kbmem-h1'/g) || []).length === 3 && !/h\('h1', \{ className: 'kbmem-h1'/.test(SOURCE))
  check('no rule of the bundle sizes or weighs the title (.kbmem-h1): the Settings frame sets it', !/\.kbmem-h1\s*[{,]/.test(SOURCE))
  check('the old Help call beside the title is gone', !/id: 'kybernos-memory' \}\) : null/.test(SOURCE))
}

// ── The new Memory page (slice 2): its pure pieces
console.log('the new page: names, import, switches, recently removed, export')
{
  check('a note\'s name is its first sentence, capitalised, with no final full stop; the rest is what follows', T.noteName('you live in Paris.') === 'You live in Paris' && T.noteName('You want to see a mockup before anything is built.') === 'You want to see a mockup before anything is built' && T.noteName('Time zone: Europe/Paris!') === 'Time zone: Europe/Paris' && T.noteName('') === '' && T.noteName('   ') === '')
  const two = T.noteParts('You write in French and use “tu”. You like short answers: the result first.')
  check('a note of two sentences is a name and a rest; one sentence has no rest; a number with a point does not end a sentence', two.name === 'You write in French and use “tu”' && two.rest === 'You like short answers: the result first.' && T.noteParts('Your time zone is Europe/Paris.').rest === '' && T.noteParts('Delivery takes 3.5 days on average here.').name === 'Delivery takes 3.5 days on average here')
  const longOne = T.noteParts('word '.repeat(20))
  check('a name is never longer than 60 characters (+ the ellipsis), and then the rest is the whole text', longOne.name.length <= 61 && longOne.name.endsWith('…') && longOne.rest === 'word '.repeat(20).trim() && T.noteName('x'.repeat(100)).length <= 61)

  const pasted = T.parseImport('1. You live in Paris.\r\n- You like short answers.\n\n* ab\n• you like short answers.\n  3) Your shop sells candles\n## Heading line here\n')
  check('an import is read line by line: bullets and numbers go, short lines go, a repeat in the paste goes', JSON.stringify(pasted) === JSON.stringify(['You live in Paris.', 'You like short answers.', 'Your shop sells candles', 'Heading line here']), pasted)
  check('an empty or blank paste gives nothing; a paste is cut at 300 lines', T.parseImport('').length === 0 && T.parseImport('  \n \n').length === 0 && T.parseImport(Array.from({ length: 400 }, (_, i) => 'Note number ' + i + ' is here').join('\n')).length === 300)
  check('a very long line is cut to the 2,000 characters the account accepts', T.parseImport('a'.repeat(5000))[0].length === 2000)
  check('the import result says what was added, what was already there and what failed', T.importResult({ added: 3, same: 2, failed: 0 }) === 'Added 3 notes. 2 already in your memory.' && T.importResult({ added: 1, same: 0, failed: 0 }) === 'Added 1 note.' && T.importResult({ added: 0, same: 4, failed: 0 }) === 'Nothing added: all 4 are already in your memory.' && T.importResult({ added: 2, same: 0, failed: 1 }) === 'Added 2 notes. 1 could not be added.' && T.importResult({ added: 0, same: 0, failed: 2 }) === '2 could not be added.')

  const mem = { memories: true, context: true, capture: true, sensitive: false }
  const les = { lessons: true, context: true }
  check('the three switches read both halves: on when either half does the thing', JSON.stringify(T.switchState(mem, les)) === JSON.stringify({ use: true, learn: true, sensitive: false })
    && T.switchState({ ...mem, context: false }, { ...les, context: false }).use === false && T.switchState({ ...mem, context: false }, les).use === true
    && T.switchState(null, les).use === true && T.switchState(null, null).use === false && T.switchState(null, null).learn === false
    && T.switchState({ ...mem, capture: false }, { ...les, lessons: false }).learn === false && T.switchState({ ...mem, memories: false }, null).learn === false
    && T.switchState({ ...mem, sensitive: true }, les).sensitive === true && T.switchState(null, les).sensitive === false)
  check('lessons count only when recording is on: context alone sends nothing', T.switchState(null, { lessons: false, context: true }).use === false)
  check('turning « Use memory » off cuts what is sent on both halves and nothing else', JSON.stringify(T.switchPatches('use', false, mem, les)) === JSON.stringify({ cloud: { context: false }, lessons: { context: false } }))
  check('turning it on puts the account notes back in too', JSON.stringify(T.switchPatches('use', true, { ...mem, memories: false, context: false }, { ...les, context: false })) === JSON.stringify({ cloud: { memories: true, context: true }, lessons: { context: true } }))
  check('« Learn from chats » is the capture of notes and the recording of lessons', JSON.stringify(T.switchPatches('learn', false, mem, les)) === JSON.stringify({ cloud: { capture: false }, lessons: { lessons: false } }) && JSON.stringify(T.switchPatches('learn', true, mem, les)) === JSON.stringify({ cloud: { memories: true, capture: true }, lessons: { lessons: true } }))
  check('« Include sensitive topics » is only the capture prompt of the account notes', JSON.stringify(T.switchPatches('sensitive', true, mem, les)) === JSON.stringify({ cloud: { sensitive: true }, lessons: null }))
  check('a half that cannot be reached gets no patch (no account: the lessons side still works)', T.switchPatches('use', false, null, les).cloud === null && T.switchPatches('use', false, mem, null).lessons === null && T.switchPatches('sensitive', true, null, les).cloud === null)

  const NOW = Date.parse('2026-11-20T12:00:00Z')
  const ago = (min) => new Date(NOW - min * 60000).toISOString()
  const removed = T.recentlyRemoved({ mem: { log: [
    { id: 'a', at: ago(30), by: 'you', kind: 'delete', removed: 1, undone: false, canUndo: true, label: 'Quotes as PDF' },
    { id: 'b', at: ago(60), by: 'auto', removed: 5, undone: false, canUndo: true, label: 'Time zone' },
    { id: 'c', at: ago(90), by: 'auto', removed: 2, undone: true, canUndo: false, label: 'Already back' },
    { id: 'd', at: ago(95), by: 'you', removed: 3, undone: false, canUndo: false, label: 'Too old to undo' },
  ] }, les: { log: [
    { id: 'e', at: ago(10), by: 'you', kind: 'delete', kyber: 'dev-team', removed: 1, undone: false, canUndo: true, label: 'Check the port' },
    { id: 'f', at: ago(20), by: 'brain', kind: 'compact', kyber: 'dev-team', removed: 0, undone: false, canUndo: true },
    { id: 'g', at: ago(120), by: 'brain', removed: 1, kyber: 'ops', undone: false, canUndo: true },
  ] } }, NOW)
  check('Recently removed lists what can still be brought back, newest first, from both halves; shortened or retitled lessons are not removals', removed.map((r) => r.id).join() === 'e,a,b,g', removed.map((r) => r.id))
  check('each line has its name, a plain reason and the button that fits (Restore for a delete, Undo for a merge)', removed[0].name === 'Check the port' && /You deleted it/.test(removed[0].why) && removed[0].button === 'Restore' && removed[0].src === 'les'
    && removed[2].name === 'Time zone' && /6 notes combined into one/.test(removed[2].why) && removed[2].button === 'Undo' && removed[2].src === 'mem')
  check('a merge written before names were kept still has a name', removed[3].name.length > 0 && removed[3].button === 'Undo')
  check('nothing to bring back is an empty list, and a host that cannot be reached is not an error', T.recentlyRemoved({ mem: null, les: null }, NOW).length === 0 && T.recentlyRemoved({ mem: { log: [] }, les: null }, NOW).length === 0)

  const groups = T.groupLessons([{ id: 1, kyber: 'dev-team' }, { id: 2, kyber: 'ops' }, { id: 3, kyber: 'dev-team' }])
  check('lessons are grouped by team in the order they first appear', groups.length === 2 && groups[0].kyber === 'dev-team' && groups[0].items.length === 2 && groups[1].kyber === 'ops' && T.groupLessons([]).length === 0)

  const T0 = Date.parse('2026-11-20T12:00:00Z')
  check('a note\'s date is a short day and month, the year only when it is not this one; an unknown age is blank', T.noteDate(60 * 24 * 3, T0) === 'Nov 17' && T.noteDate(0, T0) === 'Nov 20' && /2025/.test(T.noteDate(60 * 24 * 400, T0)) && T.noteDate(null, T0) === '' && T.noteDate(NaN, T0) === '')
  check('CRC32 matches the standard check value', T.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926 && T.crc32(new Uint8Array(0)) === 0)
  const zip = T.zipFiles([{ name: 'about-you.txt', text: 'You live in Paris.\nÉté\n' }, { name: 'teams/dev-team.txt', text: 'Check the port.\n' }])
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const sig = (at) => dv.getUint32(at, true)
  check('the export is a real zip: local headers, a central directory, an end record counting both files', sig(0) === 0x04034b50 && sig(zip.length - 22) === 0x06054b50 && dv.getUint16(zip.length - 22 + 10, true) === 2)
  const dir = dv.getUint32(zip.length - 22 + 16, true)
  check('the central directory starts where the end record says, and names the files in UTF-8', sig(dir) === 0x02014b50 && new TextDecoder().decode(zip.slice(dir + 46, dir + 46 + 13)) === 'about-you.txt' && (dv.getUint16(dir + 8, true) & 0x0800) !== 0)
  check('the stored size and CRC of a file are those of its text', dv.getUint32(14, true) === T.crc32(new TextEncoder().encode('You live in Paris.\nÉté\n')) && dv.getUint32(18, true) === dv.getUint32(22, true) && dv.getUint32(22, true) === new TextEncoder().encode('You live in Paris.\nÉté\n').length)

  const files = T.exportFiles({ about: [{ content: 'You live in Paris.' }, { content: 'Line one\nline two' }], teams: [{ kyber: 'Dev Team', lessons: [{ text: 'Check the port.' }] }, { kyber: 'dev-team', lessons: [{ text: 'Second.' }] }, { kyber: '???', lessons: [{ text: 'Odd.' }] }, { kyber: 'empty', lessons: [] }] })
  check('the export is plain text: one note per line, one file about you, one per team', files[0].name === 'about-you.txt' && files[0].text === 'You live in Paris.\nLine one line two\n' && files.length === 4)
  check('team file names are safe and never collide; an empty team gets no file', files.slice(1).map((f) => f.name).join() === 'teams/dev-team.txt,teams/dev-team-2.txt,teams/team.txt')
  check('nothing to export is an empty list', T.exportFiles({ about: [], teams: [] }).length === 0)
}

console.error = realError
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
