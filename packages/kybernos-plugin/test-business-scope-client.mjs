// One template at a time, the browser half (block <kb-business-scope> of client.js): what the host's answer is trusted for, the store that reads and
// switches the choice, the selector in the « Business » group and the places where the core uses it (the words of the three rows, the page mounted
// under a key, the reload after an install). The block is cut out of client.js and run on a fake window, a fake fetch and the repo's small React
// (lib-lite-react-test.mjs); the drawn result, with a real mouse and the real keyboard, is measured by scripts/check-one-template-live.mjs.
//
//   node packages/kybernos-plugin/test-business-scope-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLite } from './lib-lite-react-test.mjs'

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-business-scope>')
const b = SRC.indexOf('// </kb-business-scope>', a)
assert.ok(a > 0 && b > a, 'cannot cut the business scope block out of client.js')
const BLOCK = SRC.slice(a, b)

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const SHOP = 'kybernos-themes/ecommerce'
const HOUSE = 'kybernos-themes/real-estate'
const JOBS = 'acme/recruitment'
const shop = { id: SHOP, name: { en: 'E-commerce shop', fr: 'Boutique en ligne' }, icon: 'bag', accent: '#c25e0a', words: { contacts: { en: 'Customers', fr: 'Clients' }, catalog: { en: 'Products', fr: 'Produits' }, pipeline: { en: 'Orders', fr: 'Commandes' } } }
const house = { id: HOUSE, name: { en: 'Real estate agency', fr: 'Agence immobilière' }, icon: 'house', accent: '#b4532a', words: { catalog: { en: 'Properties', fr: 'Biens' } } }
const view = (active, templates) => ({ ok: true, active, stored: active, templates })

/** The block on a fresh fake world: a window that records events, a fetch that answers from `world.routes`, the repo's small React. */
const fresh = (lang = 'en') => {
  const lite = createLite()
  const events = []
  const calls = []
  const timers = []
  const docListeners = new Map()
  const world = {
    lang,
    answer: { status: 200, json: view(SHOP, [shop, house]) },
    post: null, // when set, answers a POST instead
    fail: false,
  }
  const win = { dispatchEvent: (e) => { events.push(e.type) } }
  const fetch = async (url, opt) => {
    calls.push({ url, method: opt.method, body: opt.body === undefined ? undefined : JSON.parse(opt.body), credentials: opt.credentials, cache: opt.cache, ct: opt.headers && opt.headers['content-type'] })
    if (world.fail) throw new Error('network down')
    const r = opt.method === 'POST' && world.post !== null ? world.post(JSON.parse(opt.body)) : world.answer
    return { status: r.status, json: async () => { if (r.json === undefined) throw new Error('not json'); return r.json } }
  }
  const doc = {
    activeElement: null,
    addEventListener: (t, f) => docListeners.set(t, f),
    removeEventListener: (t) => docListeners.delete(t),
  }
  const h = lite.React.createElement
  const Icon = (name, size) => h('svg', { 'data-icon': name, width: size })
  const kbe = (en, fr) => (world.lang === 'fr' ? fr : en)
  const made = new Function('window', 'CustomEvent', 'fetch', 'document', 'setTimeout', 'React', 'h', 'Icon', 'kbe', 'kbfSep', 'kbDomainLang',
    BLOCK + '\nreturn { KB_BIZ_SCOPE_URL, KB_BIZ_PACK_ICONS, kbBizScopeNormalize, kbBizScopeShown, kbBizScopeOwns, kbBizScopeWord, kbBizScopeText, kbBizScope, KbBizScopePicker }')(
    win, class { constructor (type) { this.type = type } }, fetch, doc, (f, ms) => { timers.push({ f, ms }); return timers.length }, lite.React, h, Icon, kbe, () => ': ', () => world.lang)
  return Object.assign(made, { lite, win, events, calls, timers, world, docListeners, doc })
}
const click = (node) => node.props.onClick({ preventDefault () {}, stopPropagation () {} })
const byKb = (m, kb) => m.lite.find(m.root.tree, (n) => n.props['data-kb'] === kb)
const items = (m) => m.lite.find(m.root.tree, (n) => n.props.role === 'menuitemradio')
const mountPicker = async (m) => {
  m.root = m.lite.mount(m.lite.React.createElement(m.KbBizScopePicker, null))
  await m.root.settle()
  return m
}

try {
  // ── what the host's answer is trusted for ────────────────────────────────────────────────────────────────────────────────────
  await ok('the host\'s answer is kept for what it is: known icon, plain accent, ids that are ids, words for the three rows only; anything else is dropped, never trusted', () => {
    const m = fresh()
    const n = m.kbBizScopeNormalize(view(SHOP, [shop, house]))
    assert.deepEqual(n.templates.map((t) => t.id), [SHOP, HOUSE])
    assert.equal(n.active, SHOP)
    assert.deepEqual(Object.keys(n.templates[1].words), ['catalog'])
    const dirty = m.kbBizScopeNormalize({ ok: true, active: 'x/not-listed', templates: [
      { id: 'BAD ID', name: { en: 'a' } }, { id: JOBS, name: { fr: 'sans anglais' }, icon: '<script>', accent: 'red', words: { contacts: { en: 'People' }, dashboards: { en: 'My activity' }, catalog: 'text' } },
      { id: JOBS, name: { en: 'again' } }, null, 'text', 7, { id: SHOP, icon: 'bag' },
    ] })
    assert.deepEqual(dirty.templates.map((t) => t.id), [JOBS, SHOP], 'a bad id is dropped, a repeated id is read once')
    assert.deepEqual([dirty.templates[0].name, dirty.templates[0].icon, dirty.templates[0].accent], [{ en: 'recruitment' }, null, null])
    assert.deepEqual(dirty.templates[0].words, { contacts: { en: 'People' } })
    assert.equal(dirty.active, null, 'an active id that is not in the list is none')
    for (const junk of [null, undefined, 'x', 7, [], {}, { ok: false, templates: [] }, { ok: true }, { ok: true, templates: 'x' }]) assert.equal(m.kbBizScopeNormalize(junk), null, JSON.stringify(junk))
    assert.equal(m.kbBizScopeNormalize({ ok: true, templates: Array.from({ length: 40 }, (_, i) => ({ id: 'a/t' + i, name: { en: 'T' } })) }).templates.length, 24, 'bounded')
    for (const icon of Object.keys(m.KB_BIZ_PACK_ICONS)) assert.ok(m.KB_BIZ_PACK_ICONS[icon].every((d) => /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(d)), icon + ' is drawn from path data only')
  })

  await ok('the selector shows from two templates; the three rows speak the active template\'s words, and never the field\'s, while one is active', () => {
    const m = fresh()
    const st = (active, templates, loaded = true) => ({ loaded, failed: false, busy: false, error: null, active, templates })
    const t2 = m.kbBizScopeNormalize(view(SHOP, [shop, house])).templates
    assert.equal(m.kbBizScopeShown(st(SHOP, t2)), true)
    assert.equal(m.kbBizScopeShown(st(SHOP, [t2[0]])), false, 'with one template that one is simply the active one')
    assert.equal(m.kbBizScopeShown(st(null, [])), false)
    assert.equal(m.kbBizScopeShown(st(SHOP, t2, false)), false, 'nothing is drawn before the host has answered')
    assert.equal(m.kbBizScopeWord(st(SHOP, t2), 'catalog', 'en'), 'Products')
    assert.equal(m.kbBizScopeWord(st(SHOP, t2), 'catalog', 'fr'), 'Produits')
    assert.equal(m.kbBizScopeWord(st(SHOP, t2), 'contacts', 'es'), 'Customers', 'a language it has no words for: English')
    assert.equal(m.kbBizScopeWord(st(HOUSE, t2), 'catalog', 'en'), 'Properties')
    assert.equal(m.kbBizScopeWord(st(HOUSE, t2), 'contacts', 'en'), null, 'a template with no word for a row has none')
    assert.equal(m.kbBizScopeOwns(st(HOUSE, t2), 'contacts'), true, '...and the row then keeps its own default, not the shop\'s « Customers »')
    assert.equal(m.kbBizScopeWord(st(HOUSE, t2), 'tasks', 'en'), null, 'only the three Business rows')
    assert.equal(m.kbBizScopeOwns(st(HOUSE, t2), 'tasks'), false)
    assert.equal(m.kbBizScopeOwns(st(null, t2), 'catalog'), false, 'no template active: the rows follow the field, as they always did')
    assert.equal(m.kbBizScopeOwns(st(SHOP, t2, false), 'catalog'), false, 'and before the host answered')
    assert.equal(m.kbBizScopeText({ en: 'A', fr: 'B' }, 'fr'), 'B')
    assert.equal(m.kbBizScopeText({ en: 'A' }, 'fr'), 'A')
    assert.equal(m.kbBizScopeText('A', 'en'), null)
  })

  // ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the store reads the choice with the cookie and no cache, tells its listeners and the window, and is the one on window.__KB_BIZ_SCOPE__', async () => {
    const m = fresh()
    assert.equal(m.win.__KB_BIZ_SCOPE__, m.kbBizScope)
    assert.equal(m.kbBizScope.v, 1)
    assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.active(), m.kbBizScope.templates().length], [false, null, 0])
    let told = 0
    const stop = m.kbBizScope.subscribe(() => { told += 1 })
    m.kbBizScope.subscribe(() => { throw new Error('a listener that breaks') })
    const one = m.kbBizScope.reload()
    assert.equal(m.kbBizScope.reload(), one, 'a read in flight is shared')
    await one
    assert.equal(m.calls.length, 1)
    assert.deepEqual([m.calls[0].url, m.calls[0].method, m.calls[0].credentials, m.calls[0].cache], ['/kybernos/business/scope', 'GET', 'same-origin', 'no-store'])
    assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.active(), m.kbBizScope.templates().map((t) => t.id)], [true, SHOP, [SHOP, HOUSE]])
    assert.equal(m.kbBizScope.word('catalog'), 'Products')
    assert.equal(told, 1)
    assert.deepEqual(m.events, ['kb-business-scope-change'])
    stop()
    await m.kbBizScope.reload()
    assert.equal(told, 1, 'a listener that left is not called')
  })

  await ok('a host that fails, answers garbage or is not there leaves the pages as they are: no selector, no word, nothing thrown', async () => {
    for (const bad of [{ status: 500, json: { ok: false, error: 'failed' } }, { status: 200, json: { ok: true } }, { status: 401, json: { ok: false } }, { status: 200, json: undefined }]) {
      const m = fresh()
      m.world.answer = bad
      await m.kbBizScope.reload()
      assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.state().failed, m.kbBizScope.active()], [false, true, null], JSON.stringify(bad))
      assert.equal(m.kbBizScopeShown(m.kbBizScope.state()), false)
      assert.equal(m.kbBizScope.word('catalog'), null)
    }
    const m = fresh()
    m.world.fail = true
    await m.kbBizScope.reload()
    assert.equal(m.kbBizScope.state().failed, true)
    m.world.fail = false
    await m.kbBizScope.reload()
    assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.state().failed], [true, false], 'asked again, it recovers')
    m.world.fail = true
    await m.kbBizScope.reload()
    assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.state().failed, m.kbBizScope.active()], [true, false, SHOP], 'a read that fails later keeps what was known')
  })

  await ok('while the host says it is not ready (DSH has just started) the page asks again after a short wait, a few times at most, and takes the answer when it comes', async () => {
    const m = fresh()
    m.world.answer = { status: 200, json: { ok: true, ready: false, active: null, stored: null, templates: [] } }
    await m.kbBizScope.reload()
    assert.deepEqual([m.kbBizScope.state().loaded, m.kbBizScope.state().ready, m.kbBizScopeShown(m.kbBizScope.state())], [true, false, false])
    assert.deepEqual(m.timers.map((t) => t.ms), [1200])
    m.world.answer = { status: 200, json: view(SHOP, [shop, house]) }
    m.timers[0].f(); await m.kbBizScope.reload()
    assert.deepEqual([m.kbBizScope.state().ready, m.kbBizScope.active(), m.kbBizScopeShown(m.kbBizScope.state())], [true, SHOP, true])
    assert.equal(m.timers.length, 1, 'ready: no more asking')
    const n = fresh()
    n.world.answer = { status: 200, json: { ok: true, ready: false, templates: [] } }
    await n.kbBizScope.reload()
    for (let i = 0; i < 8; i += 1) { const t = n.timers.at(-1); if (t === undefined) break; t.f(); await n.kbBizScope.reload() }
    assert.deepEqual(n.timers.map((t) => t.ms), [1200, 3000, 7000, 15000], 'four more tries, growing waits, then it stops: the pages are scoped by the host anyway')
    assert.equal(n.kbBizScope.state().loaded, true)
    assert.equal(n.kbBizScopeNormalize(view(SHOP, [shop])).ready, true, 'a host that says nothing about readiness is ready')
  })

  await ok('switching posts { action: "set", id } as JSON, takes the host\'s answer, and says so when the host refuses (the choice stays what it was)', async () => {
    const m = fresh()
    await m.kbBizScope.reload()
    m.world.post = (body) => ({ status: 200, json: view(body.id, [shop, house]) })
    assert.equal(await m.kbBizScope.set(HOUSE), true)
    const post = m.calls.at(-1)
    assert.deepEqual([post.method, post.body, post.ct, post.credentials], ['POST', { action: 'set', id: HOUSE }, 'application/json', 'same-origin'])
    assert.deepEqual([m.kbBizScope.active(), m.kbBizScope.state().busy, m.kbBizScope.state().error], [HOUSE, false, null])
    assert.equal(m.kbBizScope.word('catalog'), 'Properties')
    for (const refusal of [{ status: 404, json: { ok: false, error: 'unknown_template' } }, { status: 500, json: { ok: false } }, { status: 200, json: { ok: true } }]) {
      m.world.post = () => refusal
      assert.equal(await m.kbBizScope.set(SHOP), false, JSON.stringify(refusal))
      assert.deepEqual([m.kbBizScope.active(), m.kbBizScope.state().busy, m.kbBizScope.state().error], [HOUSE, false, 'switch'])
    }
    m.kbBizScope.dismiss()
    assert.equal(m.kbBizScope.state().error, null)
    m.world.fail = true
    assert.equal(await m.kbBizScope.set(SHOP), false)
    assert.equal(m.kbBizScope.state().error, 'switch')
    assert.equal(m.kbBizScope.active(), HOUSE)
  })

  await ok('one switch at a time; after an install or a removal it reads now and again once the registry has rescanned', async () => {
    const m = fresh()
    await m.kbBizScope.reload()
    m.world.post = (body) => ({ status: 200, json: view(body.id, [shop, house]) })
    const first = m.kbBizScope.set(HOUSE)
    assert.equal(m.kbBizScope.state().busy, true)
    assert.equal(await m.kbBizScope.set(SHOP), false, 'a second switch while one is under way does nothing')
    assert.equal(m.calls.filter((c) => c.method === 'POST').length, 1)
    await first
    const before = m.calls.length
    m.kbBizScope.settle()
    await m.kbBizScope.reload()
    assert.ok(m.calls.length > before, 'a read right away')
    assert.equal(m.timers.length, 1)
    assert.ok(m.timers[0].ms >= 2100, 'and one later than the registry\'s two-second rescan: ' + m.timers[0].ms)
    const n = m.calls.length
    m.timers[0].f()
    await m.kbBizScope.reload()
    assert.ok(m.calls.length > n)
  })

  // ── the selector ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the selector draws nothing before the host answered, nothing with a single template, and the active template\'s name and icon with two', async () => {
    const m = fresh()
    await mountPicker(m)
    assert.equal(byKb(m, 'business-scope').length, 0, 'before')
    m.world.answer = { status: 200, json: view(SHOP, [shop]) }
    await m.kbBizScope.reload(); await m.root.settle()
    assert.equal(byKb(m, 'business-scope').length, 0, 'one template: that one is simply the active one')
    m.world.answer = { status: 200, json: view(SHOP, [shop, house]) }
    await m.kbBizScope.reload(); await m.root.settle()
    assert.equal(byKb(m, 'business-scope').length, 1)
    const name = byKb(m, 'business-scope-name')[0]
    assert.equal(m.lite.textOf(name), 'E-commerce shop')
    const btn = m.lite.find(m.root.tree, (n) => n.props['data-act'] === 'business-scope')[0]
    assert.deepEqual([btn.tag, btn.props.type, btn.props['aria-haspopup'], btn.props['aria-expanded']], ['button', 'button', 'menu', 'false'])
    assert.match(btn.props['aria-label'], /^Template of the Business pages: E-commerce shop$/)
    assert.equal(m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length, 0, 'closed')
    const tile = m.lite.find(m.root.tree, (n) => n.props.className === 'kb4-scopetile')[0]
    assert.equal(tile.props.style.color, '#c25e0a')
    assert.equal(m.lite.find(tile, (n) => n.tag === 'path').length, 2, 'the bag, drawn from its path data')
    m.world.lang = 'fr'
    await m.kbBizScope.reload(); await m.root.settle()
    assert.equal(m.lite.textOf(byKb(m, 'business-scope-name')[0]), 'Boutique en ligne')
    assert.match(m.lite.find(m.root.tree, (n) => n.props['data-act'] === 'business-scope')[0].props['aria-label'], /^Modèle des pages Business: Boutique en ligne$/)
  })

  await ok('opened, it lists the templates as radio items with the active one checked; picking another switches at once and closes; picking the active one asks nothing', async () => {
    const m = fresh()
    m.world.post = (body) => ({ status: 200, json: view(body.id, [shop, house]) })
    await m.kbBizScope.reload()
    await mountPicker(m)
    const btn = () => m.lite.find(m.root.tree, (n) => n.props['data-act'] === 'business-scope')[0]
    click(btn()); await m.root.settle()
    assert.equal(btn().props['aria-expanded'], 'true')
    const menu = m.lite.find(m.root.tree, (n) => n.props.role === 'menu')[0]
    assert.equal(menu.props.id, btn().props['aria-controls'])
    assert.deepEqual(items(m).map((n) => [n.props['data-scope-id'], n.props['aria-checked']]), [[SHOP, 'true'], [HOUSE, 'false']])
    assert.equal(m.docListeners.has('mousedown'), true, 'a click elsewhere closes it')
    const posts = () => m.calls.filter((c) => c.method === 'POST').length
    click(items(m)[0]); await m.root.settle()
    assert.equal(posts(), 0, 'the active one: nothing to ask')
    assert.equal(m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length, 0, 'and the menu closes')
    click(btn()); await m.root.settle()
    click(items(m)[1]); await m.root.settle()
    assert.equal(posts(), 1)
    assert.deepEqual(m.calls.at(-1).body, { action: 'set', id: HOUSE })
    assert.equal(m.lite.textOf(byKb(m, 'business-scope-name')[0]), 'Real estate agency')
    assert.equal(m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length, 0)
    assert.equal(m.docListeners.has('mousedown'), false, 'closed: no listener left on the document')
  })

  await ok('when the host refuses the switch the menu stays open and says so (role alert); the name does not change; closing and opening again forgets the message', async () => {
    const m = fresh()
    m.world.post = () => ({ status: 500, json: { ok: false, error: 'failed' } })
    await m.kbBizScope.reload()
    await mountPicker(m)
    const btn = () => m.lite.find(m.root.tree, (n) => n.props['data-act'] === 'business-scope')[0]
    click(btn()); await m.root.settle()
    click(items(m)[1]); await m.root.settle()
    assert.equal(m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length, 1, 'still open')
    const alert = byKb(m, 'business-scope-error')[0]
    assert.equal(alert.props.role, 'alert')
    assert.match(m.lite.textOf(alert), /Could not switch the template\. Nothing changed\./)
    assert.equal(m.lite.textOf(byKb(m, 'business-scope-name')[0]), 'E-commerce shop')
    click(btn()); await m.root.settle()
    click(btn()); await m.root.settle()
    assert.equal(byKb(m, 'business-scope-error').length, 0)
  })

  await ok('the keyboard: the button opens the menu with the arrows and closes it with Escape; in the menu the arrows, Home and End move the focus, Escape closes and gives it back', async () => {
    const m = fresh()
    await m.kbBizScope.reload()
    await mountPicker(m)
    const btn = () => m.lite.find(m.root.tree, (n) => n.props['data-act'] === 'business-scope')[0]
    const key = (node, k) => { const e = { key: k, prevented: false, stopped: false, preventDefault () { e.prevented = true }, stopPropagation () { e.stopped = true } }; node.props.onKeyDown(e); return e }
    const e1 = key(btn(), 'ArrowDown'); await m.root.settle()
    assert.equal(e1.prevented, true)
    assert.equal(btn().props['aria-expanded'], 'true')
    const e2 = key(btn(), 'Escape'); await m.root.settle()
    assert.deepEqual([e2.prevented, btn().props['aria-expanded']], [true, 'false'])
    key(btn(), 'ArrowUp'); await m.root.settle()
    const menu = () => m.lite.find(m.root.tree, (n) => n.props.role === 'menu')[0]
    // the menu's own handler reads the DOM through its ref: with no DOM in this fake it must not throw, and Escape must still close it (the real focus is measured by the live check)
    const e3 = key(menu(), 'Escape'); await m.root.settle()
    assert.deepEqual([e3.prevented, e3.stopped, m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length], [true, true, 0])
    key(btn(), 'ArrowDown'); await m.root.settle()
    assert.doesNotThrow(() => { key(menu(), 'ArrowDown'); key(menu(), 'ArrowUp'); key(menu(), 'Home'); key(menu(), 'End') })
    key(menu(), 'Tab'); await m.root.settle()
    assert.equal(m.lite.find(m.root.tree, (n) => n.props.role === 'menu').length, 0, 'Tab leaves the menu and closes it')
  })

  await ok('the selector calls the same hooks in the same order whether it draws or not (a switch from one template to two re-renders it)', async () => {
    const m = fresh()
    m.world.answer = { status: 200, json: view(SHOP, [shop]) }
    await mountPicker(m)
    await m.kbBizScope.reload(); await m.root.settle()
    m.world.answer = { status: 200, json: view(SHOP, [shop, house]) }
    await m.kbBizScope.reload(); await m.root.settle()
    assert.equal(byKb(m, 'business-scope').length, 1)
    m.world.answer = { status: 200, json: view(HOUSE, [house]) }
    await m.kbBizScope.reload(); await m.root.settle()
    assert.equal(byKb(m, 'business-scope').length, 0)
    m.root.unmount()
    assert.equal(m.docListeners.size, 0)
  })

  // ── where the core uses it ────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the core uses it in the right places: words of the rows and pages, the group, the page mounted under a key, the reload after an install or a removal, the icon rail', () => {
    assert.match(SRC, /const kbDomainLabel = \(id\) => \{\s*if \(kbBizScopeOwns\(kbBizScope\.state\(\), id\)\) return kbBizScopeWord\(kbBizScope\.state\(\), id, kbDomainLang\(\)\)/, 'the three rows (and the pages that ask __KB_DOMAIN__.label) speak the active template first')
    assert.match(SRC, /h\('div', \{ id: 'kb4-biz-rows'[\s\S]{0,260}h\(KbBizScopePicker, null\)/, 'the selector is the first thing in the rows of the group, so it folds with them')
    assert.match(SRC, /h\(mine\.component, \{ key: props\.id \+ '\|' \+ String\(kbBizScope\.active\(\)\)/, 'a page is mounted under a key that holds the template: a switch starts it afresh')
    assert.match(SRC, /React\.useEffect\(\(\) => kbBizScope\.subscribe\(\(\) => setTick\(\(n\) => n \+ 1\)\), \[\]\)/, 'and the mount follows the choice')
    assert.equal((SRC.match(/kbBizScope\.settle\(\)/g) || []).length, 3, 'the install, the recorded plan and the removal each read the choice again')
    assert.match(SRC, /\[class\*="collapsed"\] \.kb4-menu \.kb4-scope\{display:none\}/, 'no selector in the icon rail')
    assert.match(SRC, /\.kb4-scopebtn:focus-visible/, 'a focus ring')
    assert.match(SRC, /@media \(prefers-reduced-motion:reduce\)\{\.kb4-scopechev\{transition:none\}\}/)
  })

  await ok('the block holds nothing that reaches out by itself at load: one fetch path, no timer at load, no personal path, and the pack icon table is data', () => {
    assert.equal((BLOCK.match(/\bfetch\(/g) || []).length, 1)
    assert.doesNotMatch(BLOCK, /\/Users\//)
    assert.doesNotMatch(BLOCK, /dangerouslySetInnerHTML|innerHTML/)
    assert.doesNotMatch(BLOCK, /localStorage/)
  })
} finally { /* nothing on disk */ }

console.log('\n' + count + ' checks passed')
