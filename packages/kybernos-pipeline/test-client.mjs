// kybernos-pipeline, the browser half, without a browser: the factory returns a plugin whatever happens; `apply` declares the menu row and mounts the page
// and gives everything back; the pure helpers behave; the page is rendered by a tiny stand-in for React (hooks seeded from outside) in each of its states,
// and the keyboard path is driven through the real handler. A real drag, the pixels and the screen reader are measured by scripts/check-pipeline-live.mjs.
//
//   node packages/kybernos-pipeline/test-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = fileURLToPath(new URL('.', import.meta.url))
const SRC = readFileSync(here + 'client.js', 'utf8')
let count = 0
const plain = (v) => JSON.parse(JSON.stringify(v)) // values made inside the sandbox come from another realm
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

// ── a stand-in for React: elements are plain objects, components are called, hooks are seeded by call order (page only) ─────────────────────────────
const Fragment = Symbol('fragment')
const makeReact = () => {
  const state = { seeds: {}, index: 0, seeding: false, rootSeen: false }
  const React = {
    Fragment,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }),
    useState: (init) => {
      const i = state.index++
      const seeded = state.seeding && Object.prototype.hasOwnProperty.call(state.seeds, i)
      return [seeded ? state.seeds[i] : (typeof init === 'function' ? init() : init), () => {}]
    },
    useRef: (v) => ({ current: v === undefined ? null : v }),
    useEffect: () => {},
    useCallback: (f) => f,
  }
  /** Expands components down to host elements. `seeds` = the states of the page by call order: flows, flowId, board, fail, dialog, live, toast, archived, dragId. */
  const render = (node, seeds = {}) => {
    state.seeds = seeds
    state.rootSeen = false
    const walk = (n) => {
      if (n === null || n === undefined || typeof n !== 'object') return n
      if (typeof n.type === 'function') {
        state.seeding = !state.rootSeen // only the page itself (the first component) is seeded
        state.rootSeen = true
        state.index = 0
        let out
        try { out = n.type({ ...n.props, children: n.children }) } finally { state.seeding = false }
        return walk(out)
      }
      return { type: n.type === Fragment ? 'fragment' : n.type, props: n.props, children: n.children.map(walk) }
    }
    return walk(node)
  }
  return { React, render }
}
const all = (tree, test, out = []) => { if (tree === null || typeof tree !== 'object') return out; if (test(tree)) out.push(tree); for (const c of tree.children || []) all(c, test, out); return out }
const byKb = (tree, kb) => all(tree, (n) => n.props && n.props['data-kb'] === kb)
const byAct = (tree, act) => all(tree, (n) => n.props && n.props['data-act'] === act)
const textOf = (tree) => (tree === null || tree === undefined ? '' : typeof tree !== 'object' ? String(tree) : (tree.children || []).map(textOf).join(' '))

// ── loading client.js in a sandbox ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sandbox = (over = {}) => {
  const loaded = []
  const added = []
  const fetches = []
  const window = {
    __ModuleLoader__: { load: (entry) => loaded.push(entry) },
    __KB_LANG_RESOLVE__: () => 'en',
    localStorage: { getItem: () => null, setItem: () => {} },
    getComputedStyle: () => ({ direction: 'ltr' }),
    ...over.window,
  }
  const document = {
    documentElement: {},
    head: { appendChild: (el) => added.push(el) },
    getElementById: (id) => added.find((e) => e.id === id) || null,
    createElement: () => { const el = { attrs: {}, setAttribute (k, v) { this.attrs[k] = v }, remove () { added.splice(added.indexOf(this), 1) } }; return el },
    hidden: false,
  }
  const ctx = {
    window, document, console: { warn () {}, log () {}, error () {} }, Intl, Date, JSON, Promise, Number, Math, Array, Object, String, Symbol, Set, Map,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: over.fetch || ((url, init) => { fetches.push({ url, init }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, card: {}, flows: [], columns: [] }) }) }),
  }
  vm.runInNewContext(SRC, ctx)
  return { loaded, added, fetches, window, document, ctx }
}
const boot = (react, over) => {
  const sb = sandbox(over)
  const plugin = sb.loaded[0].factory((name) => { if (name === 'react') return react; throw new Error('unexpected require ' + name) })
  return { ...sb, plugin }
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const L = (en, fr) => ({ en, fr })
const FLOW = { id: 'orders', label: L('Orders', 'Commandes'), newLabel: L('New order', 'Nouvelle commande'), stages: [{ key: 'new', label: L('New', 'Nouveau') }, { key: 'paid', label: L('Paid', 'Payé') }, { key: 'shipped', label: L('Shipped', 'Expédié') }], value: { format: 'money', currency: 'EUR' }, links: { contact: true, item: false }, source: 'theme', theme: 'acme/shop' }
const card = (id, stage, extra = {}) => ({ id, flow: 'orders', stage, title: 'Order #' + id, subtitle: '2 items', value: 10, position: id, since: new Date().toISOString(), demo: false, archived: false, contact_id: null, item_id: null, contact: null, item: null, ...extra })
const col = (stage, cards) => ({ stage, label: FLOW.stages.find((s) => s.key === stage).label, unknown: false, count: cards.length, total: cards.reduce((a, c) => a + (c.value || 0), 0), cards })
const BOARD = () => ({ ok: true, flow: FLOW, columns: [col('new', [card(1, 'new', { contact: { id: 7, name: 'Jonas Weber' }, contact_id: 7, demo: true }), card(2, 'new', { value: 5.5 })]), col('paid', [card(3, 'paid', { value: null })]), col('shipped', [])], count: 3, total: 25.5, demoCards: 1, truncated: false })
const FLOWS = { ok: true, flows: [{ ...FLOW, cards: 3 }], theme: true, demo: 1 }

const { React, render } = makeReact()

await ok('the factory hands the loader a plugin that never throws, whatever it is given', async () => {
  const sb = sandbox()
  assert.equal(sb.loaded.length, 1)
  assert.equal(sb.loaded[0].id, '@local/kybernos-pipeline')
  const plugin = sb.loaded[0].factory(() => React)
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plain(plugin.inject), ['slots'])
  assert.equal(plugin.name, 'kybernos-pipeline')
  const broken = sb.loaded[0].factory(() => { throw new Error('no react here') })
  assert.equal(typeof broken.apply, 'function', 'a page that cannot start is a disabled plugin, not a broken entry')
  assert.equal(broken.apply({}), undefined)
})

await ok('apply: the style, the menu row (declared inside apply, given back), and the page on the keyed slot', async () => {
  const declared = []
  let offs = 0
  const menu = { register: (entry) => { declared.push(entry); return () => { offs += 1 } } }
  const { plugin, added } = boot(React, { window: { __KB_MENU__: menu } })
  assert.equal(declared.length, 0, 'nothing is declared before apply')
  const effects = []
  const slots = { injected: [], inject (name, fn) { this.injected.push(name); return fn() }, register (spec, component) { this.registered = { spec, component }; return () => { this.unregistered = true } } }
  plugin.apply({ slots, effect: (fn, label) => effects.push({ cleanup: fn(), label }) })
  assert.deepEqual(effects.map((e) => e.label), ['kybernos-pipeline: styles', 'kybernos-pipeline: menu row', 'kybernos-pipeline: page'])
  assert.deepEqual(plain(declared), [{ id: 'pipeline', group: 'business', icon: 'columns', labelKey: 'business.pipeline', label: { en: 'Pipeline', fr: 'Pipeline' }, order: 30 }])
  assert.deepEqual(slots.injected, ['main.kybernos-business'])
  assert.deepEqual(plain(slots.registered.spec), { name: 'main.kybernos-business', key: 'pipeline' })
  assert.equal(typeof slots.registered.component, 'function')
  assert.equal(added.length, 1)
  assert.equal(added[0].attrs['data-plugin'], '@local/kybernos-pipeline')
  assert.ok(added[0].textContent.includes('.kbpi-board'))
  for (const e of effects) assert.equal(typeof e.cleanup, 'function', e.label + ' gives its cleanup back')
  for (const e of effects) e.cleanup()
  assert.equal(offs, 1, 'switching the plugin off takes the row back')
  assert.equal(slots.unregistered, true)
  assert.equal(added.length, 0, 'and the style')
})

await ok('apply: a core that makes its menu registry AFTER this plugin applied still gets the row, and a plugin switched off first leaves nothing behind', async () => {
  const declared = []
  const { plugin, window } = boot(React)
  const slots = { inject: (n, fn) => fn(), register: () => () => {} }
  const effects = []
  plugin.apply({ slots, effect: (fn) => effects.push(fn()) })
  assert.equal(declared.length, 0)
  let offs = 0
  window.__KB_MENU__ = { register: (entry) => { declared.push(entry.id); return () => { offs += 1 } } }
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert.deepEqual(declared, ['pipeline'], 'declared once the registry exists')
  for (const cleanup of effects) cleanup()
  assert.equal(offs, 1)
  // switched off before the registry ever came: no row, no timer left to declare it later
  const late = boot(React)
  const more = []
  late.plugin.apply({ slots, effect: (fn) => more.push(fn()) })
  for (const cleanup of more) cleanup()
  const later = []
  late.window.__KB_MENU__ = { register: (entry) => { later.push(entry.id); return () => {} } }
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert.deepEqual(later, [], 'a plugin that was switched off declares nothing')
})

await ok('apply never throws: no menu registry, a registry that refuses or throws, a slot service that fails, a context with no effect', async () => {
  const run = (over, ctx) => { const { plugin } = boot(React, over); plugin.apply(ctx) }
  const slots = { inject: (n, fn) => fn(), register: () => () => {} }
  const effect = (fn) => fn()
  run({}, { slots, effect })
  run({ window: { __KB_MENU__: { register: () => null } } }, { slots, effect })
  run({ window: { __KB_MENU__: { register: () => { throw new Error('refused') } } } }, { slots, effect })
  run({ window: { __KB_MENU__: {} } }, { slots, effect })
  run({}, { slots: { inject: () => { throw new Error('no slot') }, register: () => {} }, effect })
  run({}, {})
  run({}, null)
})

await ok('helpers: labels follow the language, values follow the theme, ages read like a person', async () => {
  const { plugin, window } = boot(React)
  const t = plugin.__test
  assert.equal(t.pickLabel({ en: 'Paid', fr: 'Payé' }), 'Paid')
  window.__KB_LANG_RESOLVE__ = () => 'fr-FR'
  assert.equal(t.pickLabel({ en: 'Paid', fr: 'Payé' }), 'Payé')
  assert.equal(t.pickLabel({ en: 'Paid' }), 'Paid', 'a theme that does not translate falls back to English')
  assert.equal(t.pickLabel(null), '')
  window.__KB_LANG_RESOLVE__ = () => 'en'
  assert.match(t.fmtValue(1234.5, { format: 'money', currency: 'EUR' }), /€\s?1,234\.50/)
  assert.match(t.fmtValue(63, { format: 'money', currency: 'EUR' }), /€\s?63$/)
  assert.equal(t.fmtValue(1234.5, { format: 'number' }), '1,234.5')
  assert.equal(t.fmtValue(7, null), '7')
  assert.equal(t.fmtValue(null, { format: 'number' }), '')
  assert.equal(t.fmtValue(Number.NaN, null), '')
  assert.match(t.fmtValue(5, { format: 'money', currency: 'XXXX' }), /5/, 'a currency the browser does not know still shows the number')
  const now = Date.parse('2026-10-29T12:00:00Z')
  assert.equal(t.ageOf('2026-10-29T08:00:00Z', now), 'today')
  assert.equal(t.ageOf('2026-10-26T08:00:00Z', now), '3d')
  assert.equal(t.ageOf('2026-10-01T08:00:00Z', now), '4w')
  assert.equal(t.ageOf('not a date', now), '')
  assert.equal(t.initials('Jonas Weber'), 'JW')
  assert.equal(t.initials('Cafe Bleu Paris'), 'CP')
  assert.equal(t.initials('Ada'), 'A')
  assert.equal(t.initials(''), '')
  assert.equal(t.round2(0.1 + 0.2), 0.3)
  assert.match(t.errText('base_missing'), /not available/)
  assert.match(t.errText('http_401'), /session has expired/)
  assert.match(t.errText('network'), /does not answer/)
  assert.match(t.errText('something_else', 'because'), /Refused: because/)
})

await ok('moving a card on screen: the card goes to the end of the other column, both counts and totals follow, the rest is untouched', async () => {
  const { plugin } = boot(React)
  const { moveInBoard, neighbour } = plugin.__test
  const board = BOARD()
  const moved = moveInBoard(board, 1, 'paid', '2026-10-29T10:00:00.000Z')
  assert.deepEqual(plain(moved.columns.map((c) => [c.stage, c.count, c.total])), [['new', 1, 5.5], ['paid', 2, 10], ['shipped', 0, 0]])
  assert.deepEqual(plain(moved.columns[1].cards.map((c) => c.id)), [3, 1], 'at the end')
  assert.deepEqual(plain([moved.columns[1].cards[1].stage, moved.columns[1].cards[1].since]), ['paid', '2026-10-29T10:00:00.000Z'])
  assert.equal(board.columns[0].cards.length, 2, 'the board it was given is not changed')
  assert.equal(moveInBoard(board, 99, 'paid', 'x'), board, 'a card that is not there changes nothing')
  assert.equal(moveInBoard(board, 1, 'nowhere', 'x'), board, 'a column that is not there changes nothing')
  assert.deepEqual([neighbour(board.columns, 'new', 1), neighbour(board.columns, 'new', -1), neighbour(board.columns, 'shipped', 1), neighbour(board.columns, 'paid', -1), neighbour(board.columns, 'ghost', 1)], ['paid', null, null, 'new', null])
})

await ok('the page, loading: a labelled skeleton, the title, the new-card button not yet usable', async () => {
  const { plugin } = boot(React)
  const tree = render(React.createElement(plugin.__test.PipelinePage))
  assert.equal(byKb(tree, 'pipeline-loading').length, 1)
  assert.match(textOf(tree), /Loading the board/)
  assert.equal(byKb(tree, 'pipeline-col').length, 0)
  assert.equal(byAct(tree, 'new-card')[0].props.disabled, true)
  assert.equal(byKb(tree, 'pipeline-title').length, 1)
})

await ok('the page, failed: the reason in words and a way to try again', async () => {
  const { plugin } = boot(React)
  const tree = render(React.createElement(plugin.__test.PipelinePage), { 3: 'base_missing' })
  assert.equal(byKb(tree, 'pipeline-error').length, 1)
  assert.match(textOf(byKb(tree, 'pipeline-error')[0]), /business data is not available/)
  assert.equal(byAct(tree, 'retry').length, 1)
  assert.equal(byKb(tree, 'pipeline-loading').length, 0)
})

await ok('the page, loaded: one column per stage with its count and total in the theme format, cards with their hooks, the demo badge, the contact', async () => {
  const { plugin } = boot(React)
  const tree = render(React.createElement(plugin.__test.PipelinePage), { 0: FLOWS, 1: 'orders', 2: BOARD() })
  const cols = byKb(tree, 'pipeline-col')
  assert.deepEqual(cols.map((c) => [c.props['data-stage'], c.props['data-count'], c.props['data-total']]), [['new', 2, 15.5], ['paid', 1, 0], ['shipped', 0, 0]])
  assert.match(textOf(byKb(tree, 'pipeline-col-total')[0]), /€\s?15\.50/)
  assert.equal(byKb(tree, 'pipeline-col-total').length, 1, 'a column with nothing to add up shows no total')
  const cards = byKb(tree, 'pipeline-card')
  assert.deepEqual(cards.map((c) => c.props['data-id']), [1, 2, 3])
  assert.ok(cards.every((c) => c.props.tabIndex === 0 && typeof c.props.onPointerDown === 'function' && typeof c.props.onKeyDown === 'function'), 'every card can be focused, dragged and driven by keys')
  assert.equal(byKb(tree, 'pipeline-demo').length, 1)
  assert.equal(cards[0].props['data-demo'], '1')
  assert.match(cards[0].props['aria-label'], /Order #1.*€10.*sample/)
  assert.equal(byKb(tree, 'pipeline-card-contact')[0].props.title, 'Jonas Weber')
  assert.equal(byKb(tree, 'pipeline-empty').length, 0)
  assert.equal(byKb(tree, 'pipeline-live').length, 1)
  assert.equal(byAct(tree, 'clear-demo').length, 1, 'there are sample rows: the action is offered')
  assert.equal(byAct(tree, 'next-stage').filter((b) => b.props.hidden !== true).length, 3, 'every card has its arrow (none is in the last column)')
  assert.equal(byKb(tree, 'pipeline-tab').length, 0, 'one board: no switcher')
  assert.match(textOf(byKb(tree, 'pipeline-title')[0]), /Orders/)
  assert.match(textOf(byAct(tree, 'new-card')[0]), /New order/)
  assert.equal(byAct(tree, 'new-card')[0].props.disabled, false)
})

await ok('the page, empty and with several boards: the empty message, the empty-column hint, the switcher; no clear-demo without sample rows', async () => {
  const { plugin } = boot(React)
  const empty = { ...BOARD(), columns: [col('new', []), col('paid', []), col('shipped', [])], count: 0, total: 0, demoCards: 0 }
  const two = { ok: true, flows: [{ ...FLOW, cards: 0 }, { ...FLOW, id: 'deals', label: L('Deals'), cards: 4 }], theme: true, demo: 0 }
  const tree = render(React.createElement(plugin.__test.PipelinePage), { 0: two, 1: 'orders', 2: empty })
  assert.equal(byKb(tree, 'pipeline-empty').length, 1)
  assert.match(textOf(byKb(tree, 'pipeline-empty')[0]), /No card yet/)
  assert.match(textOf(tree), /Drop a card here/)
  const tabs = byKb(tree, 'pipeline-tab')
  assert.deepEqual(tabs.map((t) => [t.props['data-flow'], t.props['aria-selected']]), [['orders', true], ['deals', false]])
  assert.equal(byAct(tree, 'clear-demo').length, 0)
})

await ok('the page, an extra column for a stage the theme no longer knows is drawn dashed and keeps its cards', async () => {
  const { plugin } = boot(React)
  const b = BOARD()
  b.columns.push({ stage: 'refunded', label: { en: 'refunded' }, unknown: true, count: 1, total: 3, cards: [card(9, 'refunded', { value: 3 })] })
  const tree = render(React.createElement(plugin.__test.PipelinePage), { 0: FLOWS, 1: 'orders', 2: b })
  const cols = byKb(tree, 'pipeline-col')
  assert.equal(cols.length, 4)
  assert.match(cols[3].props.className, /unknown/)
  assert.equal(byKb(tree, 'pipeline-card').length, 4)
})

await ok('the dialog: a new card asks for the fields its board takes (value and links only when the theme says so)', async () => {
  const { plugin } = boot(React)
  const page = (flow, dialog) => render(React.createElement(plugin.__test.PipelinePage), { 0: FLOWS, 1: 'orders', 2: { ...BOARD(), flow }, 4: dialog })
  const withAll = page({ ...FLOW, links: { contact: true, item: true } }, { kind: 'new', stage: 'paid' })
  const fields = (tree) => byKb(tree, 'pipeline-field').map((f) => f.props['data-field'])
  assert.deepEqual(fields(withAll), ['title', 'subtitle', 'value', 'stage'])
  assert.equal(byKb(withAll, 'pipeline-link-input').length, 2)
  assert.equal(byKb(withAll, 'pipeline-field').find((f) => f.props['data-field'] === 'stage').props.value, 'paid', 'opened on the column it was asked from')
  const plain = page({ ...FLOW, value: null, links: { contact: false, item: false } }, { kind: 'new', stage: 'new' })
  assert.deepEqual(fields(plain), ['title', 'subtitle', 'stage'])
  assert.equal(byKb(plain, 'pipeline-link-input').length, 0)
  const edit = page(FLOW, { kind: 'edit', card: card(1, 'new', { contact: { id: 7, name: 'Jonas Weber' }, contact_id: 7 }) })
  assert.deepEqual(fields(edit), ['title', 'subtitle', 'value'], 'a stage changes by moving, not by editing')
  assert.equal(byKb(edit, 'pipeline-link-chip').length, 1)
  assert.equal(byAct(edit, 'archive').length, 1)
  assert.equal(byAct(page(FLOW, { kind: 'new', stage: 'new' }), 'archive').length, 0)
  const clear = page(FLOW, { kind: 'clear' })
  assert.equal(byAct(clear, 'confirm-clear').length, 1)
  assert.match(textOf(clear), /Contacts, Catalog and Pipeline/)
})

await ok('the keyboard: right arrow on a card asks the host to move it to the next stage, left to the previous one, and nothing at the ends', async () => {
  const fetches = []
  const { plugin, ctx } = boot(React, { fetch: (url, init) => { fetches.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, card: {}, flows: [], columns: [], flow: FLOW }) }) } })
  const tree = render(React.createElement(plugin.__test.PipelinePage), { 0: FLOWS, 1: 'orders', 2: BOARD() })
  const cards = byKb(tree, 'pipeline-card')
  const key = (c, k) => { const calls = []; c.props.onKeyDown({ key: k, target: 'self', currentTarget: 'self', preventDefault: () => calls.push('prevented') }); return calls }
  assert.deepEqual(key(cards[0], 'ArrowRight'), ['prevented'])
  assert.deepEqual(fetches.map((f) => [f.url, f.body]), [['/kybernos-pipeline/move', { id: 1, stage: 'paid' }]])
  assert.deepEqual(key(cards[2], 'ArrowLeft'), ['prevented'])
  assert.deepEqual(fetches[1].body, { id: 3, stage: 'new' })
  fetches.length = 0
  key(cards[0], 'ArrowLeft') // the first column has nothing before it
  assert.equal(fetches.length, 0)
  key(cards[0], 'a')
  assert.equal(fetches.length, 0, 'other keys do nothing')
  void ctx
  // the arrow button of the card moves it to the next stage too
  const go = byAct(tree, 'next-stage')[0]
  go.props.onClick({ stopPropagation () {} })
  assert.deepEqual(fetches.map((f) => f.body), [{ id: 1, stage: 'paid' }])
  // a key that comes from a control inside the card (the arrow button) is not the card's
  fetches.length = 0
  cards[0].props.onKeyDown({ key: 'ArrowRight', target: 'inner', currentTarget: 'self', preventDefault () {} })
  assert.equal(fetches.length, 0)
})

await ok('the contract of the source: hooks for the tests, words in two languages, DSH tokens only, the help gated, nothing unsafe', async () => {
  for (const hook of ['pipeline-page', 'pipeline-title', 'pipeline-board', 'pipeline-col', 'pipeline-card', 'pipeline-live', 'pipeline-loading', 'pipeline-error', 'pipeline-empty', 'pipeline-dialog', 'pipeline-demo', 'pipeline-field', 'pipeline-toast', 'pipeline-tab', 'pipeline-archived']) assert.ok(SRC.includes("'data-kb': '" + hook + "'") || SRC.includes('data-kb="' + hook + '"') || SRC.includes("'data-kb': '" + hook), hook)
  for (const act of ['new-card', 'next-stage', 'save', 'cancel', 'archive', 'restore', 'toggle-archived', 'clear-demo', 'confirm-clear', 'retry']) assert.ok(SRC.includes("'data-act': '" + act + "'"), act)
  assert.doesNotMatch(SRC, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no colour of its own')
  assert.match(SRC, /var\(--dsw-alias-/)
  assert.match(SRC, /typeof window !== 'undefined' && window\.__KB_HELP__ && window\.__KB_HELP__\.Help \? h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-pipeline' \}\)/, 'the help pill, gated')
  assert.doesNotMatch(SRC, /innerHTML|dangerouslySetInnerHTML|\beval\(|new Function|document\.write/)
  const urls = [...SRC.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1])
  assert.ok(urls.every((u) => u.startsWith("'/kybernos-pipeline/'")), 'the page talks to its own host half and nothing else: ' + urls.join(' | '))
  assert.match(SRC, /role: 'status', 'aria-live': 'polite'/, 'moves are announced')
  assert.match(SRC, /aria-keyshortcuts/)
  assert.match(SRC, /kb6-headrow/, 'the same page header as the other pages')
  // Every sentence the person reads goes through kt(fr, en): none of the common props takes a bare English string.
  const bare = [...SRC.matchAll(/(?:'aria-label'|title|placeholder|label): '([^']{3,})'/g)].map((m) => m[1]).filter((s) => !/^(Pipeline|kbpi-|business\.)/.test(s))
  assert.deepEqual(bare, [], 'a visible word outside kt()')
})

await ok('with no board remembered, the page opens on the first board that holds cards (a template\'s boards come after the empty default one)', () => {
  assert.match(SRC, /find\(\(f\) => f\.cards > 0\) \|\| r\.data\.flows\[0\]/)
})

console.log('\n' + count + ' checks passed')
