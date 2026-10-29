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
    useMemo: (f) => f(),
  }
  /** Expands components down to host elements. `seeds` = the states of the page by call order: flows, flowId, board, fail, dialog, live, toast, archived, dragId, then (the page's own
   *  bar, when the core hands none) the toolbar state, favourites, landing, settle, month. A toolbar handed over by the core brings its own hook, which takes no seed. */
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
  assert.doesNotMatch(SRC, /#(?!fff\b)[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\((?!var\(--kz-h\))/, 'no colour of its own: tokens, or the kit\'s soft hues (hsl of --kz-h)')
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

// ── the product's bar, the kit, the views, the cards' extras (a fake bar and a fake kit, never the core's). A bar handed over by the core brings its own hook, so the page's own states
// (favourites, landing, settle, month) are seeded from index 9 on in these tests, not 10 on. ─────────────────────────────────────────────────────────────
const isoDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const RICH = () => {
  const b = BOARD()
  b.columns[0].cards[0] = { ...b.columns[0].cards[0], fields: { source: 'Referral', priority: 'high', due: isoDay(1), tags: ['vip', 'urgent', 'a', 'b', 'c'] }, item: { id: 3, title: 'Family house with garden', subtitle: '4 Elm Court', archived: false }, item_id: 3 }
  b.columns[0].cards[1] = { ...b.columns[0].cards[1], fields: { source: 'Website', priority: 'low', due: isoDay(-2), tags: [] }, since: new Date(Date.now() - 20 * 86400000).toISOString() }
  b.columns[1].cards[0] = { ...b.columns[1].cards[0], fields: {} }
  return b
}
const TB = (over = {}) => ({ query: '', sort: 'position', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'columns', ...over })
/** A bar like the core's: a component that records what it is given, and a hook that hands back a state. */
const fakeToolbar = (state) => { const seen = { props: [], updates: [] }; return { seen, toolbar: { KbToolbar: (props) => { seen.props.push(props); return React.createElement('div', { 'data-kb': 'toolbar' }) }, useToolbarState: () => [state, (patch) => seen.updates.push(patch)] } } }
const FAKE_KIT = () => {
  const calls = { Tag: [], Avatar: [], Art: [], Icon: [] }
  return { calls, kit: { v: 1, tint: () => 146, Tag: (p) => { calls.Tag.push(p); return React.createElement('span', { 'data-kb': 'kit-tag', className: 'kz-tag' }, p.text) }, Avatar: (p) => { calls.Avatar.push(p); return React.createElement('span', { 'data-kb': 'kit-avatar' }, p.name) }, Art: (p) => { calls.Art.push(p); return React.createElement('svg', { 'data-kb': 'kit-art' }) }, Icon: (name) => { calls.Icon.push(name); return React.createElement('svg', { 'data-kb': 'kit-icon', 'data-name': name }) } } }
}
const pageOf = (plugin, toolbar, seeds) => render(React.createElement(plugin.__test.PipelinePage, toolbar === null ? undefined : { toolbar }), seeds)

await ok('the extras a card may carry (source, priority, due date, tags) are read with care, and nothing is drawn for what is not there', async () => {
  const { plugin } = boot(React)
  const t = plugin.__test
  assert.deepEqual(plain(t.extrasOf({})), { source: '', priority: '', due: '', tags: [] })
  assert.deepEqual(plain(t.extrasOf({ fields: null })), { source: '', priority: '', due: '', tags: [] })
  assert.deepEqual(plain(t.extrasOf({ fields: { source: '  Web  ', priority: 'urgent', due: '2026-02-30', tags: ['a', 'a', '', 7, 'b'] } })), { source: 'Web', priority: '', due: '', tags: ['a', 'b'] }, 'a priority that is not one of the three, a date that does not exist, doubles and non-texts are dropped')
  assert.deepEqual(plain(t.extrasOf({ fields: { priority: 'normal', due: '2026-10-29' } })), { source: '', priority: 'normal', due: '2026-10-29', tags: [] })
  assert.equal(t.extrasOf({ fields: { tags: ['1', '2', '3', '4', '5', '6', '7', '8'] } }).tags.length, 6, 'at most six tags')
  assert.equal(t.parseDue('2026-10-29').getDate(), 29)
  assert.equal(t.parseDue('29/10/2026'), null)
  const now = new Date(2026, 9, 29, 15, 0).getTime()
  assert.deepEqual(['2026-10-29', '2026-10-30', '2026-10-26', '2026-11-05', 'x'].map((d) => t.dueIn(d, now)), [0, 1, -3, 7, null], 'whole days from today, whatever the hour')
  assert.deepEqual([0, 1, -1, 3].map((n) => t.dueLabel(n, '2026-10-29')), ['today', 'tomorrow', 'yesterday', 'in 3d'])
  assert.match(t.dueLabel(9, '2026-11-07'), /Nov/)
})

await ok('a drawing is chosen from the item\'s own words, and no drawing is better than a wrong one', async () => {
  const { plugin } = boot(React)
  const t = plugin.__test
  const kinds = ['3-room apartment, Willow Lane', 'Family house with garden, Elm Court', 'Loft, Old Mill', 'Attic flat, Church Square', 'Commercial unit, Market Street', 'Beeswax taper candles', 'Cotton tote bag', 'Spring gift box', 'Senior Data Engineer', 'Stoneware mug, set of 2', 'Maison de ville', 'Appartement T3'].map(t.artKindOf)
  assert.deepEqual(kinds, ['apartment', 'house', 'loft', 'loft', 'shop', 'bottle', 'bag', 'box', 'desk', '', 'house', 'apartment'])
  assert.equal(t.artSpec('house', 'Family house, 4 Elm Court & co'), 'art:house/Family-house-4-Elm-Court-co', 'the kit\'s seed takes letters, digits, dot, dash and underscore: a title is folded into that')
  assert.ok(/^art:house\/[A-Za-z0-9._-]{0,40}$/.test(t.artSpec('house', 'é'.repeat(80) + ' x y')))
  assert.deepEqual([t.stageHue(0, 4), t.stageHue(3, 4), t.stageHue(0, 1), t.stageHue(1, 3)], [236, 146, 212, 192], 'indigo at the start of a board, green at its end')
})

await ok('what the bar asks for is what is shown: search without accents, stage and tag filters (or inside a group, and across groups), the period, the favourites, the sort', async () => {
  const { plugin } = boot(React)
  const t = plugin.__test
  const board = RICH()
  const ids = (v) => plain(v.columns.map((c) => c.cards.map((x) => x.id)))
  const show = (tb, favs = new Set(), b = board) => t.visibleColumns(b, tb, favs, Date.now())
  assert.deepEqual(ids(show(TB())), [[1, 2], [3], []])
  assert.deepEqual(ids(show(TB({ query: 'jonas' }))), [[1], [], []], 'the contact\'s name is searched too')
  assert.deepEqual(ids(show(TB({ query: 'ORDER #2' }))), [[2], [], []], 'every word, any case')
  assert.deepEqual(ids(show(TB({ query: 'referral' }))), [[1], [], []], 'and the source and the tags')
  assert.deepEqual(ids(show(TB({ query: 'elm court' }))), [[1], [], []], 'and the linked item')
  assert.deepEqual(plain(show(TB({ types: ['stage:paid'] })).columns.map((c) => c.stage)), ['paid'], 'a stage filter keeps that column only')
  assert.deepEqual(ids(show(TB({ types: ['src:Website'] }))), [[2], [], []])
  assert.deepEqual(ids(show(TB({ types: ['src:Website', 'src:Referral'] }))), [[1, 2], [], []], 'two values of one group: either')
  assert.deepEqual(ids(show(TB({ types: ['src:Website', 'prio:high'] }))), [[], [], []], 'two groups: both')
  assert.deepEqual(ids(show(TB({ period: '7' }))), [[1], [3], []], 'moved in the last seven days (card 2 has been there for twenty)')
  assert.deepEqual(ids(show(TB({ fav: true }), new Set([2]))), [[2], [], []])
  const two = { columns: [{ ...board.columns[0], cards: [board.columns[0].cards[1], board.columns[0].cards[0]] }] }
  const sorted = (sort, dir) => plain(show(TB({ sort, dir }), new Set(), two).columns[0].cards.map((c) => c.id))
  assert.deepEqual([sorted('position', 'desc'), sorted('position', 'asc'), sorted('value', 'desc'), sorted('name', 'asc'), sorted('since', 'asc'), sorted('nonsense', 'desc')], [[2, 1], [1, 2], [1, 2], [1, 2], [2, 1], [2, 1]], 'board order as the host gave it; the other sorts by value, name, date; an unknown sort is the board order')
  const view = show(TB({ query: 'order #2' }))
  assert.deepEqual([view.shown, view.all, view.columns[0].count, view.columns[0].total], [1, 3, 1, 5.5], 'counts and totals are those of what is shown')
  assert.equal(t.filtersOn(TB()), false)
  assert.equal(t.filtersOn(TB({ types: ['stage:new'] })) && t.filtersOn(TB({ query: ' x ' })) && t.filtersOn(TB({ period: '30' })) && t.filtersOn(TB({ fav: true })), true)
})

await ok('the facets are the stages with their counts, then the priorities, sources and tags the cards carry; the views are the board and the list, and the calendar only with due dates', async () => {
  const { plugin } = boot(React)
  const t = plugin.__test
  assert.deepEqual(plain(t.facetOptions(BOARD()).map((o) => [o.id, o.count])), [['stage:new', 2], ['stage:paid', 1], ['stage:shipped', 0]], 'no extras on the cards: the stages only')
  const rich = t.facetOptions(RICH())
  assert.deepEqual(plain(rich.slice(0, 3).map((o) => o.label)), ['New', 'Paid', 'Shipped'])
  assert.deepEqual(plain(rich.filter((o) => o.id.startsWith('prio:')).map((o) => o.id)), ['prio:high', 'prio:low'])
  assert.deepEqual(plain(rich.filter((o) => o.id.startsWith('src:')).map((o) => [o.label, o.count])), [['Source: Referral', 1], ['Source: Website', 1]])
  assert.ok(rich.some((o) => o.id === 'tag:vip' && o.label === 'Tag: vip' && o.count === 1))
  assert.deepEqual(plain(t.viewsOf(BOARD())), ['columns', 'list'], 'no due date on any card: no calendar to offer')
  assert.deepEqual(plain(t.viewsOf(RICH())), ['columns', 'list', 'calendar'])
  assert.deepEqual(plain(t.viewsOf(null)), ['columns', 'list'])
  assert.equal(t.cardMatchesTypes(RICH().columns[0].cards[0], []), true)
})

await ok('the product\'s bar: handed over by the core it is drawn in the header row with the documented props; the page\'s own state hook stands in for it', async () => {
  const { plugin } = boot(React)
  const fake = fakeToolbar(TB({ query: 'x', viewMode: 'calendar' }))
  const tree = pageOf(plugin, fake.toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(tree, 'toolbar').length, 1, 'the product\'s bar is drawn')
  assert.equal(byKb(tree, 'pipeline-own-bar').length, 0, 'and not a lookalike')
  const head = all(tree, (n) => n.type === 'header' && /kb6-headrow/.test(n.props.className))[0]
  assert.ok(head !== undefined && byKb(head, 'toolbar').length === 1, 'in the header row, right of the title')
  const p = fake.seen.props.pop()
  assert.deepEqual(plain(p.views), ['columns', 'list'], 'a board without due dates offers no calendar (and the saved calendar choice falls back to the board)')
  assert.equal(p.state.viewMode, 'columns')
  assert.equal(p.viewLabels, true, 'the views carry their names')
  assert.deepEqual(plain(p.sortOptions.map((o) => o.id)), ['position', 'since', 'value', 'name'])
  assert.equal(p.facets.period, true)
  assert.deepEqual(plain(p.facets.type.options.map((o) => o.id)), ['stage:new', 'stage:paid', 'stage:shipped'])
  assert.equal(typeof p.onUpdate, 'function')
  assert.notEqual(p.showFav, false, 'the star is there: it filters to the cards the person starred')
  assert.match(textOf(p.trailing), /New order/, 'the primary action goes in the bar')
  assert.equal(p.trailing.props['data-act'], 'new-card')
  p.onUpdate({ viewMode: 'calendar', query: 'abc' })
  assert.deepEqual(plain(fake.seen.updates.pop()), { query: 'abc' }, 'a view the data cannot fill is refused, the rest goes to the state')
  p.onUpdate({ viewMode: 'list' })
  assert.deepEqual(plain(fake.seen.updates.pop()), { viewMode: 'list' })
  const withDue = fakeToolbar(TB())
  pageOf(plugin, withDue.toolbar, { 0: FLOWS, 1: 'orders', 2: RICH() })
  assert.deepEqual(plain(withDue.seen.props.pop().views), ['columns', 'list', 'calendar'])
  // a core whose hook throws (another React): the page keeps working with its own state
  const broken = { KbToolbar: fake.toolbar.KbToolbar, useToolbarState: () => { throw new Error('Invalid hook call') } }
  assert.equal(byKb(pageOf(plugin, broken, { 0: FLOWS, 1: 'orders', 2: BOARD() }), 'pipeline-card').length, 3)
  // no bar from the core (a test, an older core): a plain one with the same pieces
  const own = pageOf(plugin, null, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(own, 'pipeline-own-bar').length, 1)
  assert.deepEqual(byKb(own, 'pipeline-view').map((b) => b.props['data-view']), ['columns', 'list'])
  assert.deepEqual(byKb(own, 'pipeline-view').map((b) => textOf(b).trim()), ['Columns', 'List'], 'with their names')
  assert.equal(byAct(own, 'new-card').length, 1)
})

await ok('filters: the strip says how many cards are shown, one button brings them all back; a search that finds nothing says so', async () => {
  const { plugin } = boot(React)
  const fake = fakeToolbar(TB({ query: 'jonas' }))
  const tree = pageOf(plugin, fake.toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.match(textOf(byKb(tree, 'pipeline-filter-strip')[0]), /Showing\s+1\s+\/ 3 card\(s\)/)
  assert.equal(byKb(tree, 'pipeline-card').length, 1)
  byAct(tree, 'clear-filters')[0].props.onClick()
  assert.deepEqual(plain(fake.seen.updates.pop()), { query: '', types: [], period: 'all', fav: false })
  const none = pageOf(plugin, fakeToolbar(TB({ query: 'zzz' })).toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(none, 'pipeline-nomatch').length, 1)
  assert.equal(byKb(none, 'pipeline-col').length, 3, 'the columns stay: they are where a card can still be dropped')
  const quiet = pageOf(plugin, fakeToolbar(TB()).toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(quiet, 'pipeline-filter-strip').length, 0)
  assert.equal(byKb(quiet, 'pipeline-nomatch').length, 0)
})

await ok('the cards, with the kit: avatar of the contact, the item\'s drawing, coloured chips, a priority dot, a due chip that turns warm, age, progress; none of it when the data is not there', async () => {
  const { kit, calls } = FAKE_KIT()
  const { plugin } = boot(React, { window: { __KB_BIZ_KIT__: kit } })
  const tree = pageOf(plugin, fakeToolbar(TB()).toolbar, { 0: FLOWS, 1: 'orders', 2: RICH() })
  const first = byKb(tree, 'pipeline-card')[0]
  assert.equal(byKb(first, 'kit-avatar').length, 1, 'the contact is an avatar of the kit')
  assert.equal(calls.Avatar[0].name, 'Jonas Weber')
  assert.ok(calls.Art.some((c) => c.spec === 'art:house/Family-house-with-garden'), 'the item is drawn (a house, said by its title)')
  assert.equal(byKb(first, 'pipeline-cover').length, 1, 'a place has a picture on top of its card')
  const dueTag = calls.Tag.find((c) => c.icon === 'clock')
  assert.equal(dueTag.text, 'tomorrow')
  assert.equal(dueTag.hue, 24, 'a due date within three days is warm')
  assert.ok(calls.Tag.some((c) => c.text === 'Referral' && c.icon === 'tag'), 'the source is a chip')
  assert.ok(['vip', 'urgent', 'a'].every((x) => calls.Tag.some((c) => c.text === x)) && !calls.Tag.some((c) => c.text === 'b'), 'three tags and a counter for the rest')
  assert.match(textOf(first), /\+2/)
  const dot = byKb(first, 'pipeline-priority')[0]
  assert.deepEqual([dot.props['data-priority'], dot.props.style['--kz-h']], ['high', 8])
  assert.match(first.props['aria-label'], /priority high/)
  assert.match(first.props['aria-label'], /stage 1 of 3: New/)
  const second = byKb(tree, 'pipeline-card')[1]
  assert.equal(calls.Tag.filter((c) => c.icon === 'clock' && c.hue === 8).length, 1, 'an overdue date is the warmest')
  const age = byKb(second, 'pipeline-age')[0]
  assert.equal(age.props.style['--kz-h'], 8, 'twenty days in the same column, and not the last one: hot')
  assert.doesNotMatch(age.props.className, /calm/)
  assert.equal(byKb(first, 'pipeline-value')[0].props.style['--kz-h'], 236, 'the value takes the hue of its stage')
  assert.equal(byKb(tree, 'pipeline-cover').length, 1, 'only the card whose item is a place')
  // the same page with the plain board data: nothing of the extras is drawn
  const bare = pageOf(plugin, fakeToolbar(TB()).toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(bare, 'pipeline-priority').length, 0)
  assert.equal(byKb(bare, 'pipeline-cover').length, 0)
  assert.equal(byKb(bare, 'pipeline-card-item').length, 0)
  assert.equal(all(bare, (n) => n.props && n.props['data-kb'] === 'kit-tag').length, 0, 'no chip but the ones the data asks for')
})

await ok('without the kit the cards still read: initials for the contact, calm pills for the chips', async () => {
  const { plugin } = boot(React)
  const tree = pageOf(plugin, fakeToolbar(TB()).toolbar, { 0: FLOWS, 1: 'orders', 2: RICH() })
  const first = byKb(tree, 'pipeline-card')[0]
  assert.match(textOf(byKb(first, 'pipeline-card-contact')[0]), /JW/)
  assert.match(textOf(first), /Referral/)
  assert.match(textOf(first), /tomorrow/)
  assert.equal(byKb(tree, 'pipeline-col').length, 3)
})

await ok('the list view: a row per card with its stage as a chip that can be changed, its value and its age; a row takes the same keys as a card', async () => {
  const fetches = []
  const { plugin } = boot(React, { fetch: (url, init) => { fetches.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, card: {}, flows: [], columns: [], flow: FLOW }) }) } })
  const tree = pageOf(plugin, fakeToolbar(TB({ viewMode: 'list', sort: 'value', dir: 'desc' })).toolbar, { 0: FLOWS, 1: 'orders', 2: BOARD() })
  assert.equal(byKb(tree, 'pipeline-board').length, 0)
  const rows = byKb(tree, 'pipeline-row')
  assert.deepEqual(rows.map((r) => r.props['data-id']), [1, 2, 3], 'sorted by value, the biggest first (the card with no value last)')
  assert.ok(rows.every((r) => r.props.tabIndex === 0 && typeof r.props.onKeyDown === 'function'))
  const select = byKb(rows[0], 'pipeline-stage-select')[0]
  assert.deepEqual(select.children.map((o) => o.props.value), ['new', 'paid', 'shipped'])
  select.props.onChange({ target: { value: 'shipped' } })
  assert.deepEqual(fetches.map((f) => f.body), [{ id: 1, stage: 'shipped' }], 'a stage chosen in the row moves the card')
  assert.equal(byKb(rows[0], 'pipeline-value').length, 1)
  assert.equal(byKb(rows[2], 'pipeline-value').length, 0)
  fetches.length = 0
  rows[0].props.onKeyDown({ key: 'ArrowRight', target: 'row', currentTarget: 'row', preventDefault () {} })
  assert.deepEqual(fetches.map((f) => f.body), [{ id: 1, stage: 'paid' }], 'the right arrow moves a row too')
  assert.equal(byAct(rows[0], 'next-stage').length, 1)
  assert.equal(byAct(rows[0], 'toggle-fav').length, 1)
})

await ok('the calendar view: a month grid, a chip on the day each card is due, the cards with no date counted below', async () => {
  const { plugin } = boot(React)
  const seeds = { 0: FLOWS, 1: 'orders', 2: RICH() }
  const tree = pageOf(plugin, fakeToolbar(TB({ viewMode: 'calendar' })).toolbar, seeds)
  assert.equal(byKb(tree, 'pipeline-calendar').length, 1)
  assert.equal(byAct(tree, 'cal-prev').length + byAct(tree, 'cal-next').length + byAct(tree, 'cal-today').length, 3)
  const days = byKb(tree, 'pipeline-day')
  assert.ok(days.length >= 28 && days.length % 7 === 0)
  const chips = byKb(tree, 'pipeline-cal-card')
  for (const c of chips) {
    const cell = days.find((d) => byKb(d, 'pipeline-cal-card').includes(c))
    const due = RICH().columns.flatMap((col) => col.cards).find((x) => x.id === c.props['data-id']).fields.due
    assert.equal(cell.props['data-day'], due, 'a chip sits on the day of its due date')
  }
  assert.ok(chips.length >= 1, 'the card due tomorrow is on the month that opens (today\'s, or the next one when it is the last day)')
  assert.match(textOf(byKb(tree, 'pipeline-undated')[0]), /^1 card\(s\) with no due date/, 'the one card with no date is counted, not lost')
  const another = pageOf(plugin, fakeToolbar(TB({ viewMode: 'calendar' })).toolbar, { ...seeds, 12: { y: 2030, m: 0 } })
  assert.equal(byKb(another, 'pipeline-cal-card').length, 0, 'another month, no chip')
})

await ok('motion: the kit\'s classes, the settle and the drop slot, all stopped under reduced motion; the keyboard path has no flight', async () => {
  for (const cls of ['kz-lift', 'kz-in', 'kz-press', 'kz-pop', 'kz-img']) assert.ok(SRC.includes(cls), cls)
  assert.match(SRC, /@media \(prefers-reduced-motion: reduce\)/)
  const block = SRC.slice(SRC.indexOf('@media (prefers-reduced-motion: reduce)'), SRC.indexOf('@media (max-width: 560px)'))
  for (const sel of ['.kbpi-card.settle', '.kbpi-col.over .kbpi-cards::after', '.kbpi-card.kz-lift', '.kbpi-ghost', '.kbpi-bone']) assert.ok(block.includes(sel), sel + ' stops under reduced motion')
  assert.match(SRC, /const reduced = \(\) =>[^\n]*prefers-reduced-motion: reduce/, 'and the script asks too (the ghost, the counting total)')
  assert.match(SRC, /const flyTo = \(ghost, rect, done\) =>/)
  assert.doesNotMatch(SRC, /transition:\s*all/, 'no transition on all')
  assert.doesNotMatch(SRC, /text-transform/, 'no uppercase labels')
  assert.doesNotMatch(SRC, /font-size:\s*(?!11px|12px|13px|14px|16px|20px)\d+px/, 'font sizes from the scale only')
  // the hover lift sits on the card, the entry animation on its list item: an animation would hold the card's transform and hide the lift
  assert.match(SRC, /className: 'kbpi-cardli' \+ \(enter \? ' kz-in' : ''\)/)
  assert.match(SRC, /className: 'kbpi-card kz-lift'/)
})

console.log('\n' + count + ' checks passed')
