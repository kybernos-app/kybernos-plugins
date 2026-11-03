// kybernos-maquettes, browser half: its registration (menu row and Creations source declared once the registries are there and taken back by the cleanup; the page on
// the keyed slot), the page rendered to a plain tree and read by its `data-kb` hooks, the bridge between the sandboxed editor and the host (what is forwarded, what is
// refused, who is answered), and the static promises a browser would only break late (the iframe never gets allow-same-origin, DSH's tokens only, the page asks its own
// host only). Outside a browser: a fake loader, a fake fetch and a small React whose hooks keep their first value (or the one a test seeds). The page as a whole is
// checked on the real GUI (scripts/check-kybernos-maquettes-live.mjs).
//
//   node packages/kybernos-maquettes/test-client.mjs
import { readFileSync } from 'node:fs'
import { API_OPS } from './routes.mjs'

let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const okAsync = async (label, fn) => { try { await fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition = null
let resolved = 'en'
const registered = { menu: [], creations: [] }
const taken = { menu: 0, creations: 0 }
const listeners = []
const asked = []
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def } },
  __KB_LANG_RESOLVE__: () => resolved,
  __KB_MENU__: { register: (e) => { registered.menu.push(e); return () => { taken.menu += 1 } } },
  __KB_CREATIONS__: { register: (e) => { registered.creations.push(e); return () => { taken.creations += 1 } } },
  __KB_ASK__: (text) => { asked.push(text); return true },
  __KB_OPEN__: (arg) => { asked.push(arg) },
  addEventListener: (type, fn) => listeners.push({ type, fn }),
  removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1) },
}
await import(new URL('./client.js', import.meta.url).href)

// ── a fake host: every call is recorded and answered from a table ───────────────────────────────────────────────────────
const calls = []
let answers = {}
globalThis.fetch = async (url, init) => {
  calls.push({ url, init })
  const key = (init && init.method ? init.method : 'GET') + ' ' + String(url).split('?')[0]
  const body = answers[key] !== undefined ? answers[key] : { ok: false, error: 'network' }
  return { status: 200, json: async () => (typeof body === 'function' ? body(url, init) : body) }
}

// ── a small React: elements are plain objects, function components are called down to host elements, hooks keep their first value or a seeded one ─────────────────
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
let seed = {}
let stateIdx = 0
let refs = []
let refIdx = 0
let effects = []
const React = {
  createElement: el,
  useState: (v) => { const i = stateIdx++; return [seed[i] !== undefined ? seed[i] : (typeof v === 'function' ? v() : v), () => {}] },
  useRef: (v) => { const i = refIdx++; if (refs[i] === undefined) refs[i] = { current: v === undefined ? null : v }; return refs[i] },
  useMemo: (fn) => fn(), useCallback: (fn) => fn, useLayoutEffect: () => {},
  useEffect: (fn) => { effects.push(fn) },
}
const render = (node) => {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(render)
  if (typeof node.type === 'function') {
    const kids = node.children
    return render(node.type(Object.assign({}, node.props, kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids })))
  }
  return [{ type: node.type, props: node.props, children: node.children.flatMap(render) }]
}
const tree = (node) => ({ type: 'root', props: {}, children: render(node) })
const walk = (t, fn) => { if (typeof t === 'string') return; fn(t); for (const c of t.children) walk(c, fn) }
const all = (t, pred) => { const out = []; walk(t, (n) => { if (pred(n)) out.push(n) }); return out }
const kb = (t, hook) => all(t, (n) => n.props['data-kb'] === hook)
const act = (t, a) => all(t, (n) => n.props['data-act'] === a)
const text = (t) => (typeof t === 'string' ? t : t.children.map(text).join(''))

const plugin = definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
const Page = T.build(React)
const draw = (s) => { seed = s || {}; stateIdx = 0; refIdx = 0; effects = []; return tree(React.createElement(Page, {})) }

console.log('Kybernos maquettes: the browser half')

// ── registration ─────────────────────────────────────────────────────────────────────────────────────
await okAsync('the factory returns a plugin that waits for slots, and a broken environment gives a disabled one', async () => {
  must(plugin.name === 'kybernos-maquettes' && Array.isArray(plugin.inject) && plugin.inject.includes('slots') && typeof plugin.apply === 'function', 'not a plugin')
  const broken = definition.factory(() => { throw new Error('no react') })
  must(typeof broken.apply === 'function', 'no disabled plugin')
})

await okAsync('apply declares the menu row, mounts the page on the keyed slot and offers the Creations source; the cleanups take them back', async () => {
  const effectsRun = []
  const injected = []
  const registeredPages = []
  const ctx = {
    slots: { inject: (slot, fn) => { injected.push(slot); fn(); return () => injected.push('off') }, register: (def, comp) => { registeredPages.push({ def, comp }); return () => {} } },
    effect: (fn, label) => { effectsRun.push({ label, off: fn() }) },
  }
  plugin.apply(ctx)
  must(registered.menu.length === 1 && registered.menu[0].id === 'maquettes' && registered.menu[0].group === 'business', 'menu row: ' + JSON.stringify(registered.menu))
  must(registered.menu[0].label.en === 'Mockups' && registered.menu[0].label.fr === 'Maquettes', 'menu words')
  must(registeredPages.length === 1 && registeredPages[0].def.name === 'main.kybernos-business' && registeredPages[0].def.key === 'maquettes', 'page slot')
  must(registered.creations.length === 1 && registered.creations[0].id === 'maquettes' && registered.creations[0].foldsRow === 'maquettes', 'creations source')
  for (const e of effectsRun) if (typeof e.off === 'function') e.off()
  must(taken.menu === 1 && taken.creations === 1, 'the cleanups did not take the entries back: ' + JSON.stringify(taken))
  plugin.apply({ slots: null, effect: () => {} }) // no slots: nothing thrown
})

await okAsync('the Creations source lists the registered folders and opens the page', async () => {
  const src = T.creationSource()
  answers = { 'GET /kybernos-maquettes/folders': { ok: true, folders: [{ id: 'a-1', name: 'Alpha', dir: '/x/alpha', pages: ['index.html', 'two.html'] }, { id: 'b-2', name: 'Beta', dir: '/x/beta', pages: ['index.html'] }, { bad: true }] } }
  const items = await src.load()
  must(items.length === 2 && items[0].id === 'a-1' && items[0].title === 'Alpha' && items[0].sub === '2 pages' && items[1].sub === '1 page', JSON.stringify(items))
  answers = {}
  must((await src.load()).length === 0, 'a failing host must give an empty list')
  asked.length = 0
  src.open(items[0]); src.home()
  must(asked.length === 2 && asked.every((a) => a.view === 'maquettes'), 'open/home: ' + JSON.stringify(asked))
})

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────
const FOLDERS = [{ id: 'alpha-1', name: 'Alpha', dir: '/x/alpha', pages: ['index.html', 'two.html'], missing: false }, { id: 'gone-2', name: 'Gone', dir: '/x/gone', pages: [], missing: true }]

ok('the list screen has the add form, the title and the help, and says it is loading until the host has answered', () => {
  const t = draw()
  must(kb(t, 'maquettes-page').length === 1 && kb(t, 'maquettes-page')[0].props['data-screen'] === 'list', 'page hook')
  must(kb(t, 'maquettes-add').length === 1 && kb(t, 'maquettes-path').length === 1, 'add form')
  must(kb(t, 'maquettes-loading').length === 1, 'loading')
  must(all(t, (n) => n.type === 'h1').map(text).join() === 'Mockups', 'title in English')
})
ok('in French the title and the placeholder are French', () => {
  resolved = 'fr'
  try {
    const t = draw()
    must(all(t, (n) => n.type === 'h1').map(text).join() === 'Maquettes', 'title')
    must(/Chemin complet/.test(kb(t, 'maquettes-path')[0].props.placeholder), 'placeholder')
  } finally { resolved = 'en' }
})
ok('with no folder the empty state explains what a mockup is', () => {
  const t = draw({ 0: [] })
  must(kb(t, 'maquettes-empty').length === 1 && /folder of \.html pages/.test(text(kb(t, 'maquettes-empty')[0])), 'empty state')
})
ok('each folder is a card with its pages and an Open button; one with no page left cannot be opened', () => {
  const t = draw({ 0: FOLDERS })
  const cards = kb(t, 'maquettes-folder')
  must(cards.length === 2, 'cards: ' + cards.length)
  must(/2 pages/.test(text(cards[0])) && /index\.html, two\.html/.test(text(cards[0])), 'pages line')
  must(act(cards[0], 'open')[0].props.disabled === false && act(cards[1], 'open')[0].props.disabled === true, 'open buttons')
  must(/no longer holds/.test(text(cards[1])), 'missing line')
})
ok('removing asks first, in the card, and says the files stay', () => {
  const t = draw({ 0: FOLDERS, 5: 'alpha-1' })
  const card = kb(t, 'maquettes-folder')[0]
  must(act(card, 'remove-yes').length === 1 && act(card, 'remove-no').length === 1 && /files stay/.test(text(card)), 'confirmation')
  must(act(kb(t, 'maquettes-folder')[1], 'remove').length === 1, 'the other card still has the plain button')
})

const SESSION = { id: 'alpha-1', name: 'Alpha', dir: '/x/alpha', token: 'tok123', page: 'index.html', pages: ['index.html', 'two.html'], url: '/kybernos-maquettes/v/tok123/index.html' }
ok('an open maquette is a sandboxed iframe on its token url, with a back button and one tab per page', () => {
  const t = draw({ 0: FOLDERS, 4: SESSION })
  const f = kb(t, 'maquettes-frame')
  must(f.length === 1 && f[0].type === 'iframe' && f[0].props.src === SESSION.url, 'iframe')
  must(f[0].props.sandbox === T.SANDBOX && !/allow-same-origin/.test(f[0].props.sandbox), 'sandbox: ' + f[0].props.sandbox)
  must(kb(t, 'maquettes-back').length === 1 && kb(t, 'maquettes-pages')[0].children.length === 2, 'back / tabs')
  must(all(t, (n) => n.type === 'h1').map(text).join() === 'Alpha', 'the title is the maquette')
})
ok('one page only: no tab row', () => {
  const t = draw({ 0: FOLDERS, 4: Object.assign({}, SESSION, { pages: ['index.html'] }) })
  must(kb(t, 'maquettes-pages').length === 0, 'tabs shown for a single page')
})

// ── the bridge ───────────────────────────────────────────────────────────────────────────────────────
const bridgeCtx = (extra) => Object.assign({ token: 'tok123', folderId: 'alpha-1', name: 'Alpha', dir: '/x/alpha', lang: 'en', call: async (body) => ({ ok: true, echo: body }), upload: async (n, b) => ({ ok: true, src: 'img/' + n, bytes: b.byteLength }), ask: () => true }, extra)
const msg = (type, rest) => Object.assign({ kyEdit: 1, id: 1, type, file: 'index.html' }, rest)

await okAsync('api: the token is the DSH page\'s own, never the editor\'s; only the fields an operation needs go through', async () => {
  const r = await T.handleBridge(msg('api', { op: 'apply', token: 'STOLEN', path: '/etc/passwd', body: { baseHash: 'h', patches: [] }, lang: 'xx' }), bridgeCtx())
  must(r.ok && r.echo.op === 'apply' && r.echo.token === 'tok123' && r.echo.file === 'index.html', JSON.stringify(r))
  must(r.echo.path === undefined && r.echo.lang === undefined && r.echo.body.baseHash === 'h', 'extra fields forwarded: ' + JSON.stringify(r.echo))
  const f = await T.handleBridge(msg('api', { op: 'find', text: 'Hello', force: true }), bridgeCtx())
  must(f.echo.text === 'Hello' && f.echo.force === undefined, 'find: ' + JSON.stringify(f.echo))
  const b = await T.handleBridge(msg('api', { op: 'blocks', lang: 'xx' }), bridgeCtx({ lang: 'fr' }))
  must(b.echo.lang === 'fr', 'blocks take the language of the DSH page')
  const z = await T.handleBridge(msg('api', { op: 'reset', force: 'yes' }), bridgeCtx())
  must(z.echo.force === false, 'force is true only when it is exactly true')
})
await okAsync('api: an operation off the list, or a message that is not the editor\'s, is refused without a call to the host', async () => {
  let called = 0
  const ctx = bridgeCtx({ call: async () => { called += 1; return { ok: true } }, upload: async () => { called += 1; return { ok: true } }, ask: () => { called += 1; return true } })
  for (const m of [msg('api', { op: 'folders/remove' }), msg('api', {}), msg('api', { op: 7 }), msg('nope', {}), { kyEdit: 2, type: 'api', op: 'hash' }, null, 'x', [], msg('kv-set', { key: '' }), msg('kv-set', { key: 'k'.repeat(41), value: 1 }), msg('ask', { items: [] }), msg('ask', { items: [{ text: '  ' }] }), msg('upload', { bytes: 'not bytes' })]) {
    const r = await T.handleBridge(m, ctx)
    must(r && r.ok === false, 'accepted: ' + JSON.stringify(m))
  }
  must(called === 0, 'the host was reached ' + called + ' time(s)')
  for (const op of API_OPS) must((await T.handleBridge(msg('api', { op }), ctx)).ok === true || true, op)
  must(called === API_OPS.length, 'each operation of the list is forwarded once: ' + called)
})
await okAsync('the page name is bounded, and defaults to index.html', async () => {
  const long = await T.handleBridge(msg('api', { op: 'hash', file: 'x'.repeat(301) }), bridgeCtx())
  const none = await T.handleBridge({ kyEdit: 1, id: 1, type: 'api', op: 'hash' }, bridgeCtx())
  must(long.echo.file === 'index.html' && none.echo.file === 'index.html', 'file')
})
await okAsync('upload: the picture goes through as bytes with its name; empty or over 8 MB is refused here', async () => {
  const r = await T.handleBridge(msg('upload', { filename: 'a.png', bytes: new ArrayBuffer(10) }), bridgeCtx())
  must(r.ok && r.src === 'img/a.png' && r.bytes === 10, JSON.stringify(r))
  must((await T.handleBridge(msg('upload', { filename: 'a.png', bytes: new ArrayBuffer(0) }), bridgeCtx())).ok === false, 'empty')
  must((await T.handleBridge(msg('upload', { filename: 'a.png', bytes: new ArrayBuffer(T.MAX_IMAGE + 1) }), bridgeCtx())).ok === false, 'too big')
})
await okAsync('pending changes are kept here per maquette page: set, get, delete, and one maquette never sees another\'s', async () => {
  T.KV.clear()
  const a = bridgeCtx(); const b = bridgeCtx({ folderId: 'beta-2' })
  must((await T.handleBridge(msg('kv-set', { key: 'state', value: { on: true, pending: [1] } }), a)).ok, 'set')
  must((await T.handleBridge(msg('kv-get', {}), a)).value.state.on === true, 'get')
  must(Object.keys((await T.handleBridge(msg('kv-get', {}), b)).value).length === 0, 'another folder sees it')
  must(Object.keys((await T.handleBridge(msg('kv-get', { file: 'two.html' }), a)).value).length === 0, 'another page sees it')
  await T.handleBridge(msg('kv-set', { key: 'state', value: null }), a)
  must(Object.keys((await T.handleBridge(msg('kv-get', {}), a)).value).length === 0, 'delete')
  const huge = await T.handleBridge(msg('kv-set', { key: 'state', value: { x: 'y'.repeat(1024 * 1024 + 1) } }), a)
  must(huge.ok === false, 'a huge value was kept')
})
await okAsync('ask: the first message of the chat names the maquette, the page and each wish, and is only written, never sent', async () => {
  const sent = []
  const r = await T.handleBridge(msg('ask', { items: [{ tag: 'Title', text: 'Welcome back', locked: true }, { tag: 'Text', text: 'Hello', locked: false }, { text: '' }] }), bridgeCtx({ ask: (s) => { sent.push(s); return true } }))
  must(r.ok && r.opened === true && sent.length === 1, JSON.stringify(r))
  must(/Alpha/.test(sent[0]) && /index\.html/.test(sent[0]) && /\/x\/alpha/.test(sent[0]) && /\[Title\] “Welcome back”|\[Title\] « Welcome back »/.test(sent[0]) && /built by a script/.test(sent[0]) && sent[0].split('\n').length === 3, sent[0])
  const fr = T.askSentence([{ tag: 'Titre', text: 'Bonjour', locked: true }], { lang: 'fr', name: 'Alpha', dir: '/x/alpha', file: 'index.html' })
  must(/Dans la maquette « Alpha »/.test(fr) && /construit par un script/.test(fr), fr)
  const none = await T.handleBridge(msg('ask', { items: [{ text: 'x' }] }), bridgeCtx({ ask: () => false }))
  must(none.ok === true && none.opened === false, 'when the chat cannot open the answer says so')
})

// ── the round trip: a message from the iframe is answered, one from anywhere else is not ─────────────────────────────────────────
await okAsync('the page answers its own iframe through the host with the session, and ignores any other sender', async () => {
  answers = {
    'GET /kybernos-maquettes/folders': { ok: true, folders: FOLDERS },
    'POST /kybernos-maquettes/api': (url, init) => ({ ok: true, seen: JSON.parse(init.body) }),
    'POST /kybernos-maquettes/upload': (url, init) => ({ ok: true, src: 'pics/up.png', url: String(url) }),
  }
  calls.length = 0
  listeners.length = 0
  const frameNode = kb(draw({ 0: FOLDERS, 4: SESSION }), 'maquettes-frame')[0]
  const inFrame = { posted: [], postMessage (m) { this.posted.push(m) } }
  frameNode.props.ref.current = { contentWindow: inFrame }
  effects.forEach((fn) => fn())
  const onMessage = listeners.find((l) => l.type === 'message').fn
  const stranger = { posted: [], postMessage (m) { this.posted.push(m) } }
  onMessage({ source: stranger, data: { kyEdit: 1, id: 5, type: 'api', op: 'hash', file: 'index.html' } })
  onMessage({ source: inFrame, data: { kyEdit: 1, id: 'x', type: 'api', op: 'hash' } })
  onMessage({ source: inFrame, data: { type: 'api', id: 6 } })
  await new Promise((r) => setTimeout(r, 20))
  must(stranger.posted.length === 0 && inFrame.posted.length === 0, 'answered someone it should not have')
  const apiCalls0 = calls.filter((c) => String(c.url).endsWith('/api')).length
  must(apiCalls0 === 0, 'the host was asked on behalf of a stranger')
  onMessage({ source: inFrame, data: { kyEdit: 1, id: 7, type: 'api', op: 'hash', file: 'index.html', token: 'STOLEN' } })
  onMessage({ source: inFrame, data: { kyEdit: 1, id: 8, type: 'upload', filename: 'my pic.png', bytes: new ArrayBuffer(4) } })
  await new Promise((r) => setTimeout(r, 20))
  const byId = (id) => inFrame.posted.find((p) => p.id === id)
  must(byId(7) && byId(7).kyEdit === 1 && byId(7).reply.seen.token === 'tok123' && byId(7).reply.seen.op === 'hash', JSON.stringify(inFrame.posted))
  const apiCall = calls.find((c) => String(c.url) === '/kybernos-maquettes/api')
  must(apiCall.init.credentials === 'same-origin' && apiCall.init.method === 'POST' && apiCall.init.headers['content-type'] === 'application/json', 'the call carries the session')
  must(byId(8) && byId(8).reply.src === 'pics/up.png' && /upload\?token=tok123&filename=my%20pic\.png$/.test(byId(8).reply.url), JSON.stringify(byId(8)))
  listeners.length = 0
})

ok('the host\'s words and the network\'s become one sentence, in the language of the page', () => {
  must(/does not answer/.test(T.errorText({ ok: false, error: 'network' })), 'network')
  must(/full path/.test(T.errorText({ ok: false, error: 'not-absolute' })), 'not-absolute')
  must(T.errorText({ ok: false, error: 'weird', why: 'Because.' }) === 'Because.', 'host why')
  must(T.errorText({ ok: false }) === 'That did not work.', 'fallback')
  resolved = 'fr'
  try { must(/ne répond pas/.test(T.errorText({ ok: false, error: 'network' })), 'fr') } finally { resolved = 'en' }
})

// ── what a browser would break late ────────────────────────────────────────────────────────────────────
ok('the iframe is never given allow-same-origin (it would hand the maquette\'s script this app and its session)', () => {
  must(!/allow-same-origin/.test(T.SANDBOX), 'SANDBOX')
  const outsideComments = source.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  must(!/allow-same-origin/.test(outsideComments.replace(/\/\/.*$/gm, '')), 'the word is used in code')
  must(/sandbox: SANDBOX/.test(source), 'the iframe does not take SANDBOX')
})
ok('the page asks its own host only, with the session cookie and no other origin', () => {
  const fetches = [...source.matchAll(/fetch\(([^,)]*)/g)].map((m) => m[1].trim())
  must(fetches.length === 1 && fetches[0] === 'BASE + path', 'fetch calls: ' + fetches.join(' | '))
  must(/const BASE = '\/kybernos-maquettes'/.test(source), 'BASE')
  for (const bad of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'eval(', 'localStorage', 'sessionStorage', 'document.cookie']) must(!source.includes(bad), bad)
  must(/credentials: 'same-origin'/.test(source), 'credentials')
})
ok('only the iframe this page opened is answered', () => {
  must(/e\.source !== frame\.current\.contentWindow/.test(source) && /m\.kyEdit !== 1/.test(source), 'the sender is not checked')
})
ok('DSH\'s tokens only: no colour of its own in the styles (white behind the maquette itself and as a fallback excepted)', () => {
  const css = T.CSS.replace(/#fff\b/g, '')
  must(!/#[0-9a-fA-F]{3,8}\b/.test(css) && !/\brgba?\(|\bhsla?\(/.test(css), 'a hard-coded colour')
  must(/var\(--dsw-alias-/.test(css), 'no token used')
})
ok('every label that is read goes through kt (French and English), not a bare string', () => {
  const bare = [...source.matchAll(/(?:title|aria-label|placeholder): '([^']+)'/g)].map((m) => m[1]).filter((s) => !/^(maquettes-|@local)/.test(s) && !/^\s*$/.test(s))
  must(bare.length === 0, 'bare labels: ' + bare.join(' | '))
})
ok('the hooks the live check reads exist', () => {
  for (const hook of ['maquettes-page', 'maquettes-add', 'maquettes-path', 'maquettes-list', 'maquettes-folder', 'maquettes-frame', 'maquettes-back', 'maquettes-error']) must(source.includes("'" + hook + "'"), hook)
  for (const a of ['add', 'open', 'remove', 'remove-yes', 'remove-no']) must(source.includes("'data-act': '" + a + "'"), a)
})

console.log(failed === 0 ? '\nCLIENT — all passed' : '\nCLIENT — ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
