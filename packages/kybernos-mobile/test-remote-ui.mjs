// kybernos-mobile, the « Phone and channels » screen (the window and the Settings page): what it draws when the status poll fails (audit A5-08), and its states.
//   node packages/kybernos-mobile/test-remote-ui.mjs
// A tiny synchronous renderer (useState / useRef / useCallback / useEffect) stands in for React so the real components run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'client.js'), 'utf8')

// ── the renderer ──────────────────────────────────────────────────────────────
const timers = []
globalThis.setInterval = (f) => { timers.push(f); return timers.length }
globalThis.clearInterval = () => {}
const makeRenderer = () => {
  const store = new Map()
  let current = null
  let dirty = false
  const slot = () => { const k = current.i; current.i += 1; if (current.hooks[k] === undefined) current.hooks[k] = {}; return current.hooks[k] }
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
    useState: (init) => {
      const s = slot()
      if (!('v' in s)) s.v = typeof init === 'function' ? init() : init
      return [s.v, (n) => { const nv = typeof n === 'function' ? n(s.v) : n; if (!Object.is(nv, s.v)) { s.v = nv; dirty = true } }]
    },
    useRef: (init) => { const s = slot(); if (!('r' in s)) s.r = { current: init }; return s.r },
    useCallback: (f, deps) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; s.f = f } return s.f },
    useEffect: (f, deps) => { const s = slot(); if (s.deps === undefined || !same(s.deps, deps)) { s.deps = deps; current.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = f() }) } },
  }
  const seen = new Set()
  let portalTo = null
  const expand = (node, path) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (node.portal === true) { portalTo = node.node; return expand(node.tree, path) }
    if (typeof node.type === 'function') {
      const key = path + '/' + node.type.name + (node.props.key !== undefined ? '#' + node.props.key : '')
      seen.add(key)
      let inst = store.get(key)
      if (inst === undefined) { inst = { hooks: [], i: 0, effects: [] }; store.set(key, inst) }
      inst.i = 0; inst.effects = []
      current = inst
      const out = node.type({ ...node.props, children: node.kids })
      const effects = inst.effects
      const tree = expand(out, key)
      for (const e of effects) e()
      return tree
    }
    return { tag: node.type, props: node.props, kids: node.kids.map((k, n) => expand(k, path + '.' + n)).filter((k) => k !== null) }
  }
  const textOf = (t) => (t === null ? '' : typeof t === 'string' ? t : (t.kids || []).map(textOf).join(' '))
  const find = (t, pred) => { if (t === null || typeof t === 'string') return null; if (pred(t)) return t; for (const k of t.kids) { const f = find(k, pred); if (f !== null) return f } return null }
  const mount = (rootEl) => {
    const view = { tree: null }
    const pass = () => { seen.clear(); view.tree = expand(rootEl, 'root'); for (const [k, inst] of store) if (!seen.has(k)) { inst.hooks.forEach((h) => { if (typeof h.cleanup === 'function') h.cleanup() }); store.delete(k) } }
    pass()
    // everything that was scheduled (state changes, fetches) has landed
    view.settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
    view.portalTo = () => portalTo
    view.text = () => textOf(view.tree)
    view.find = (pred) => find(view.tree, pred)
    return view
  }
  return { React, mount }
}

// ── the page under test ───────────────────────────────────────────────────────
const GOOD = { ok: true, available: true, running: true, connected: true, configured: true, entitled: true, pairing: null, devices: [], refused: 0, relay: 'up' }
let answer = null // what the status route says next: an object, or a function that throws
let pairAnswer = { ok: true } // what the pairing route says next
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push(String(url))
  if (String(url).includes('kybernos-cloud/status')) return { json: async () => ({ state: {} }) }
  if (String(url).includes('/remote/status')) {
    if (typeof answer === 'function') return answer()
    return { json: async () => answer }
  }
  if (String(url).endsWith('/remote/pair')) return { json: async () => pairAnswer }
  return { json: async () => ({ ok: true }) } // pair, cancel: nothing to see
}
globalThis.document = { baseURI: 'http://127.0.0.1:3080/', visibilityState: 'visible', body: null, head: { appendChild: (c) => c }, createElement: () => ({ dataset: {}, remove () {} }), addEventListener () {}, querySelector: () => null }
const events = [] // the window events the page dispatched
const listeners = [] // [type, fn, capture] the window was asked to listen to, and not yet told to stop
const load = (renderer, opts = {}) => {
  let def = null
  listeners.length = 0
  globalThis.window = {
    __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: false }), __KB_LANG_RESOLVE__: () => opts.lang || 'en', dispatchEvent: (ev) => { events.push(ev.type); return true },
    addEventListener: (t, f, c) => { listeners.push([t, f, c]) },
    removeEventListener: (t, f) => { const i = listeners.findIndex((l) => l[0] === t && l[1] === f); if (i >= 0) listeners.splice(i, 1) },
  }
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  const reactDom = opts.portal === true ? { createPortal: (tree, node) => ({ portal: true, tree, node }) } : undefined
  const plugin = def.factory((name) => (name === 'react' ? renderer.React : (name === 'react-dom' ? reactDom : undefined)))
  let page = null
  const slots = { inject: (n, fn) => fn(), register: (spec, comp) => { page = comp; return () => {} } }
  plugin.apply({ effect: (fn) => fn(), inject: (names, cb) => cb({ slots }) })
  return { page, dialog: globalThis.window.__KB_MOBILE__.Dialog }
}
const poll = async (view) => { for (const f of [...timers]) f(); await view.settle() }

console.log('Settings › Phone and channels: one failed poll')
for (const [label, make] of [
  ['the network fails', () => { throw new Error('offline') }],
  ['an HTTP 500 with an HTML body', () => ({ json: async () => { throw new SyntaxError('Unexpected token <') } })],
  ['the route answers {}', () => ({ json: async () => ({}) })],
  ['the route answers {ok:false,error:server_unavailable}', () => ({ json: async () => ({ ok: false, error: 'server_unavailable' }) })],
]) {
  const r = makeRenderer()
  timers.length = 0
  const { page } = load(r)
  answer = GOOD
  const view = r.mount(r.React.createElement(page))
  await view.settle()
  check(label + ': the page first shows the pairing start button', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
  answer = make
  let threw = null
  try { await poll(view) } catch (e) { threw = e }
  check(label + ': the render does not throw', threw === null, threw && String(threw.message))
  check(label + ': the page still shows what it had', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
  check(label + ': and says the poll failed', view.find((n) => n.props && n.props['data-kb'] === 'mobile-poll-error') !== null, view.text())
  answer = GOOD
  await poll(view)
  check(label + ': the next good poll clears the message', view.find((n) => n.props && n.props['data-kb'] === 'mobile-poll-error') === null && view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
}

console.log('the very first poll fails')
{
  const r = makeRenderer()
  timers.length = 0
  const { page } = load(r)
  answer = () => { throw new Error('offline') }
  const view = r.mount(r.React.createElement(page))
  await view.settle()
  check('it says it cannot reach DSH instead of loading for ever', /Cannot reach DSH/.test(view.text()), view.text())
  answer = GOOD
  await poll(view)
  check('and recovers on the next good poll', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
}

console.log('the window')
{
  const r = makeRenderer()
  timers.length = 0
  const { dialog } = load(r)
  answer = { ...GOOD, pairing: { state: 'waiting', expires_at: Date.now() + 60000, qr: null, url: 'https://x.example/p' } }
  const view = r.mount(r.React.createElement(dialog, {}))
  await view.settle()
  check('with a code in progress the window shows the pairing', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pairing') !== null, view.text())
  answer = () => { throw new Error('offline') }
  let threw = null
  try { await poll(view) } catch (e) { threw = e }
  check('a failed poll does not crash the window (it would take the account card down with it)', threw === null, threw && String(threw.message))
  check('the code is still there', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pairing') !== null, view.text())
}

// The server does not answer when a code is asked for: the sentence names the server (its label and host) and, when the registry has another one, offers to
// switch (audit V-41). The same words in the window and on the Settings page.
console.log('the server does not answer: it is named, and another one can be chosen')
const press = (view, key) => { const n = view.find((x) => x.props && x.props['data-kb'] === key); if (n !== null) n.props.onClick() }
for (const where of ['window', 'page']) {
  for (const [label, server, wantButton] of [
    ['another server exists', { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true }, true],
    ['it is the only server', { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: false }, false],
  ]) {
    const r = makeRenderer()
    timers.length = 0
    events.length = 0
    const { page, dialog } = load(r)
    answer = GOOD
    pairAnswer = { ok: false, error: 'server_unavailable', server }
    let closed = 0
    const view = r.mount(r.React.createElement(where === 'window' ? dialog : page, where === 'window' ? { onClose: () => { closed += 1 } } : {}))
    await view.settle()
    press(view, 'mobile-pair')
    await view.settle()
    const said = view.text()
    check(where + ' (' + label + '): the sentence names the server: label and host', said.includes(server.name) && said.includes(server.host) && /does not answer/.test(said), said)
    check(where + ' (' + label + '): it is not the sentence that fits any server', !/The Kybernos server does not answer/.test(said), said)
    const sw = view.find((n) => n.props && n.props['data-kb'] === 'mobile-switch-server')
    check(where + ' (' + label + '): « Switch server » ' + (wantButton ? 'is offered' : 'is not (nothing to switch to)'), (sw !== null) === wantButton, said)
    if (wantButton && sw !== null) {
      sw.props.onClick()
      check(where + ': « Switch server » asks the footer to open Settings › Servers', events.includes('kybernos-cloud:servers'), events)
      if (where === 'window') check('the window closes itself first', closed === 1, closed)
    }
  }
  // A seam that named no server: the old sentence, and nothing to switch to.
  const r = makeRenderer()
  timers.length = 0
  const { page, dialog } = load(r)
  answer = GOOD
  pairAnswer = { ok: false, error: 'server_unavailable' }
  const view = r.mount(r.React.createElement(where === 'window' ? dialog : page, {}))
  await view.settle()
  press(view, 'mobile-pair')
  await view.settle()
  check(where + ' (no server named): the sentence stays the generic one, with no switch', /The Kybernos server does not answer/.test(view.text()) && view.find((n) => n.props && n.props['data-kb'] === 'mobile-switch-server') === null, view.text())
}
pairAnswer = { ok: true }

// ── the screen: two columns, and the states of the left one ───────────────────────────────────────────────
const kb = (view, name) => view.find((n) => n.props && n.props['data-kb'] === name)
const kbAll = (view, name) => { const out = []; const walk = (t) => { if (t === null || typeof t === 'string') return; if (t.props && t.props['data-kb'] === name) out.push(t); t.kids.forEach(walk) }; walk(view.tree); return out }
const mountDialog = async (status, opts = {}) => {
  const r = makeRenderer()
  timers.length = 0
  calls.length = 0
  const { dialog, page } = load(r, opts)
  answer = status
  let closed = 0
  const view = r.mount(r.React.createElement(opts.page === true ? page : dialog, { onClose: () => { closed += 1 } }))
  await view.settle()
  view.closed = () => closed
  return view
}
const chipOf = (view) => { const c = kb(view, 'mobile-chip'); return c === null ? null : { kind: c.props.className, face: c.props['data-face'], text: view.text && (function t (n) { return typeof n === 'string' ? n : n.kids.map(t).join(' ') })(c).replace(/\s+/g, ' ').trim() } }

console.log('the screen: the left column says it is full control of THIS computer')
{
  const view = await mountDialog({ ...GOOD, computer: 'DESKTOP-4F2K' })
  const text = view.text().replace(/\s+/g, ' ')
  check('the window is titled « Phone and channels » and says one thing about itself', /Phone and channels/.test(text) && /Reach Kaby from your phone, or open this computer remotely\./.test(text), text.slice(0, 160))
  check('left: « Open my computer on my phone »', /Open my computer on my phone/.test(text))
  check('left: full control of this computer, named, only on a phone that is the person\'s', /Full control of this computer \(DESKTOP-4F2K\)\. Use it only on a phone that is yours\./.test(text), text)
  const noName = await mountDialog(GOOD)
  check('without a computer name the sentence still reads', /Full control of this computer\. Use it only on a phone that is yours\./.test(noName.text().replace(/\s+/g, ' ')))
  check('it asks for no code by itself (a code is a way into this computer)', !calls.some((u) => /\/remote\/pair$/.test(u)) && kb(view, 'mobile-pairing') === null && kb(view, 'mobile-pair') !== null)
  check('the remote column is one card, the messaging column the other', kb(view, 'phone-remote') !== null && (kb(view, 'phone-channels-card') !== null || kb(view, 'phone-channels-off') !== null))
}

console.log('the screen: every state of the phone link has its chip and its way forward')
{
  const waiting = () => ({ state: 'waiting', expires_at: Date.now() + 120000, qr: null, url: 'https://x.example/p' })
  const dev = (o) => ({ id: 'a', label: 'iPhone', online: false, state: 'offline', last_seen_at: Date.now(), ...o })
  const cases = [
    ['nothing linked', GOOD, 'none', /No phone linked/, ['mobile-pair'], ['mobile-pairing', 'mobile-verify']],
    ['a code to scan', { ...GOOD, pairing: waiting() }, 'waiting', /Waiting for the phone/, ['mobile-pairing', 'mobile-new-code', 'mobile-copy', 'mobile-stop'], ['mobile-pair', 'mobile-verify']],
    ['a phone asks for the check', { ...GOOD, pairing: { state: 'verify', expires_at: Date.now() + 60000, qr: null, url: null, sas: '4821', phone_label: 'iPhone', verify_until: Date.now() + 60000 } }, 'verify', /Waiting for your OK/, ['mobile-verify', 'mobile-sas', 'mobile-approve', 'mobile-deny'], ['mobile-pair', 'mobile-pairing']],
    ['a code that ran out', { ...GOOD, pairing: { ...waiting(), expires_at: Date.now() - 1000 } }, 'expired', /Code expired/, ['mobile-pairing', 'mobile-new-code', 'mobile-stop'], ['mobile-copy', 'mobile-qr']],
    ['a phone connected now', { ...GOOD, devices: [dev({ online: true, state: 'serving' })] }, 'connected', /Phone connected/, ['mobile-pair', 'mobile-devices', 'mobile-revoke'], ['mobile-pairing']],
    ['linked phones that are off', { ...GOOD, devices: [dev({})] }, 'offline', /No phone connected/, ['mobile-pair', 'mobile-devices'], ['mobile-pairing']],
  ]
  for (const [label, status, face, words, present, absent] of cases) {
    const view = await mountDialog(status)
    const c = chipOf(view)
    check(label + ': the chip says ' + face, c !== null && c.face === face && words.test(c.text), c)
    check(label + ': ' + present.join(', ') + ' are there', present.every((k) => kb(view, k) !== null), present.filter((k) => kb(view, k) === null))
    check(label + ': ' + absent.join(', ') + ' are not', absent.every((k) => kb(view, k) === null), absent.filter((k) => kb(view, k) !== null))
  }
  const ok = await mountDialog({ ...GOOD, pairing: waiting(), devices: [] })
  check('a code to scan has the three steps, the 4-digit check among them', /same here and on the phone/.test(ok.text()) && kbAll(ok, 'mobile-pairing').length === 1)
  const connected = await mountDialog({ ...GOOD, devices: [dev({ online: true, state: 'serving' })] })
  check('with a phone connected « Add a phone » is not the main button any more (another phone is the exception)', !/kbmr-primary/.test(kb(connected, 'mobile-pair').props.className))
  check('with none it is', /kbmr-primary/.test(kb(await mountDialog(GOOD), 'mobile-pair').props.className))
  const two = await mountDialog({ ...GOOD, devices: [dev({ id: 'a', online: true, state: 'serving' }), dev({ id: 'b', label: 'iPad', online: true, state: 'serving' })] })
  check('two phones connected: the chip says phones, « Disconnect all » is offered', /Phones connected/.test(chipOf(two).text) && kb(two, 'mobile-revoke-all') !== null)
  const stop = await mountDialog({ ...GOOD, pairing: waiting() })
  kb(stop, 'mobile-stop').props.onClick()
  await stop.settle()
  check('« Stop » asks the host to withdraw the code, once', calls.filter((u) => /\/remote\/pair\/cancel$/.test(u)).length === 1, calls)
  const wall = await mountDialog({ ...GOOD, entitled: false })
  check('a plan without the link: the paywall in the left column, the messaging column untouched', kb(wall, 'mobile-paywall') !== null && kb(wall, 'mobile-pair') === null && (kb(wall, 'phone-channels-card') !== null || kb(wall, 'phone-channels-off') !== null))
  const fr = await mountDialog({ ...GOOD, computer: 'MAC' }, { lang: 'kybernos' })
  check('in French: the title, the left column, the full-control sentence', /Téléphone et canaux/.test(fr.text()) && /Ouvrir mon ordinateur sur mon téléphone/.test(fr.text()) && /Contrôle complet de cet ordinateur \(MAC\)\. À utiliser seulement sur un téléphone à toi\./.test(fr.text().replace(/\s+/g, ' ')), fr.text().slice(0, 200))
}

console.log('the screen: the right column is Kaby\'s, and is told honestly when it is not there')
{
  const off = await mountDialog(GOOD)
  check('without the Kaby bundle the card says so, under the same heading', kb(off, 'phone-channels-off') !== null && /Talk to Kaby on a messaging app/.test(off.text()) && /not available: the Kaby module is not active/.test(off.text().replace(/\s+/g, ' ')))
  const Column = function ChannelsColumn () { return { type: 'div', props: { 'data-kb': 'stub-column' }, kids: [] } }
  const r = makeRenderer()
  timers.length = 0
  const { dialog } = load(r)
  globalThis.window.__KB_KYBER__ = { version: 1, ChannelsColumn: Column, name: 'Kaby' }
  answer = GOOD
  const view = r.mount(r.React.createElement(dialog, { onClose () {} }))
  await view.settle()
  check('with it, the card is Kaby\'s column, drawn as it publishes it', kb(view, 'phone-channels-card') !== null && kb(view, 'stub-column') !== null && kb(view, 'phone-channels-off') === null)
  globalThis.window.__KB_KYBER__ = { version: 1, ChannelsColumn: 'not a component' }
  const bad = r.mount(r.React.createElement(dialog, { onClose () {} }))
  await bad.settle()
  check('a seam that is not a component is treated as absent, not as a crash', kb(bad, 'phone-channels-off') !== null)
  globalThis.window.__KB_KYBER__ = { version: 1, ChannelsColumn: Column, name: 'Zed' }
  const named = r.mount(r.React.createElement(dialog, { onClose () {} }))
  await named.settle()
  check('the assistant\'s name is the one the Kaby bundle publishes', /Reach Zed from your phone/.test(named.text()))
}

console.log('the window: closing, and what closing leaves behind')
{
  const r = makeRenderer()
  timers.length = 0
  calls.length = 0
  const { dialog } = load(r)
  answer = { ...GOOD, pairing: { state: 'waiting', expires_at: Date.now() + 120000, qr: null, url: 'https://x.example/p' } }
  let closed = 0
  const view = r.mount(r.React.createElement(dialog, { onClose: () => { closed += 1 } }))
  await view.settle()
  const esc = listeners.find((l) => l[0] === 'keydown')
  check('it listens for Escape, in the capture phase (DSH\'s own dialogs underneath also close on it)', esc !== undefined && esc[2] === true)
  let stopped = 0
  esc[1]({ key: 'Enter', stopPropagation () { stopped += 1 } })
  esc[1]({ key: 'Escape', stopPropagation () { stopped += 1 } })
  check('Escape closes it, once, and nothing else hears it; another key does nothing', closed === 1 && stopped === 1)
  const dim = kb(view, 'phone-channels-scrim')
  dim.props.onMouseDown({ target: 'inside', currentTarget: dim })
  check('a press inside the window does not close it', closed === 1)
  dim.props.onMouseDown({ target: dim, currentTarget: dim })
  check('a press on the dim does', closed === 2)
  check('the cross closes it', (kb(view, 'phone-channels-close').props.onClick(), closed === 3))
  const dlg = kb(view, 'phone-channels')
  check('it is a modal dialog, named by its title, and can take the focus', dlg.props.role === 'dialog' && dlg.props['aria-modal'] === 'true' && dlg.props['aria-labelledby'] === 'kbpc-title' && dlg.props.tabIndex === -1)
  check('the cross has a name', kb(view, 'phone-channels-close').props['aria-label'] === 'Close')
  // unmounting (the menu's owner closed it): a code nobody scanned is withdrawn
  r.mount(r.React.createElement('div', null))
  check('closing withdraws a code nobody scanned', calls.filter((u) => /\/remote\/pair\/cancel$/.test(u)).length === 1 && !listeners.some((l) => l[0] === 'keydown'), [calls, listeners.length])

  const r2 = makeRenderer()
  timers.length = 0
  calls.length = 0
  const again = load(r2)
  answer = { ...GOOD, pairing: { state: 'verify', expires_at: Date.now() + 60000, qr: null, url: null, sas: '4821', phone_label: 'iPhone', verify_until: Date.now() + 60000 } }
  const v2 = r2.mount(r2.React.createElement(again.dialog, { onClose () {} }))
  await v2.settle()
  r2.mount(r2.React.createElement('div', null))
  check('and one a phone is waiting on is NOT withdrawn (the check can still be approved)', calls.filter((u) => /\/remote\/pair\/cancel$/.test(u)).length === 0, calls)

  const r3 = makeRenderer()
  timers.length = 0
  calls.length = 0
  const idle = load(r3)
  answer = GOOD
  const v3 = r3.mount(r3.React.createElement(idle.dialog, { onClose () {} }))
  await v3.settle()
  r3.mount(r3.React.createElement('div', null))
  check('and with no code at all nothing is sent', calls.filter((u) => /\/remote\/pair\/cancel$/.test(u)).length === 0, calls)
}

console.log('the window: drawn on <body> when react-dom is there, in place when it is not')
{
  const r = makeRenderer()
  timers.length = 0
  const { dialog } = load(r, { portal: true })
  globalThis.document.body = { tag: 'body' }
  answer = GOOD
  const view = r.mount(r.React.createElement(dialog, { onClose () {} }))
  await view.settle()
  check('with react-dom the window goes through a portal to the document body (a fixed box in the phone layout\'s sliding drawer sits off-screen)', view.portalTo() !== null && view.portalTo().tag === 'body' && kb(view, 'phone-channels') !== null)
  globalThis.document.body = null
  const r2 = makeRenderer()
  const { dialog: d2 } = load(r2)
  const v2 = r2.mount(r2.React.createElement(d2, { onClose () {} }))
  await v2.settle()
  check('without react-dom it is drawn where it is mounted, and still works', v2.portalTo() === null && kb(v2, 'phone-channels') !== null)
}

console.log('the Settings page is the same screen, under its own title')
{
  const page = await mountDialog({ ...GOOD, entitled: true }, { page: true })
  check('title « Phone and channels », the two cards, no close button', /Phone and channels/.test(page.text()) && kb(page, 'phone-remote') !== null && (kb(page, 'phone-channels-card') !== null || kb(page, 'phone-channels-off') !== null) && kb(page, 'phone-channels-close') === null)
  check('the plan chip says it is included', /Included in your plan/.test(page.text()))
  check('and the page asks for no code either', !calls.some((u) => /\/remote\/pair$/.test(u)))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
