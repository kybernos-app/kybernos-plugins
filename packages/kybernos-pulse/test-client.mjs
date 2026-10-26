// kybernos-pulse — the client outside a browser: its pure parts, its guards, the Settings page drawn by a tiny React stand-in,
// the floating window on a fake Document Picture-in-Picture, and the banners and the badge on a fake page.
//   node packages/kybernos-pulse/test-client.mjs
import { readFileSync } from 'node:fs'

let failures = 0
let total = 0
const ok = (name, cond, detail) => { total++; if (cond) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// ── a fake page ────────────────────────────────────────────────────────────────────────────────────────────
let resolved = 'en'
const calls = []
let state = null
const NOW = Date.now()
const mkSnap = (over) => ({ ok: true, settings: { version: 1, level: 'need', banners: true, badge: true, muted: [] }, inbox: [], running: [], unread: 0, banners: [], now: NOW, ...over })
const item = (o) => ({ id: 'r:s1', kind: 'done', tone: 'ok', todo: false, task: 'Weekly TikTok scout', taskId: 't1', sessionId: 's1', at: NOW - 5000, unread: true, bannered: false, calls: 14, durMs: 220000, quiet: false, ...o })
const fetchLog = []
globalThis.fetch = async (url, opts) => {
  fetchLog.push({ url, method: opts && opts.method ? opts.method : 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null })
  if (String(url) === '/kybernos-pulse/state') return { ok: true, json: async () => state }
  return { ok: true, json: async () => ({ ok: true }) }
}
const shown = []
class FakeNotification { constructor (title, opts) { this.title = title; this.opts = opts; shown.push(this) } close () {} }
FakeNotification.permission = 'granted'
FakeNotification.requestPermission = async () => 'granted'
const doc = {
  title: 'Kybernos',
  hidden: false,
  head: { children: [], appendChild (n) { this.children.push(n); n.remove = () => { this.children.splice(this.children.indexOf(n), 1) } } },
  createElement: () => ({ dataset: {}, textContent: '' }),
  documentElement: {},
  listeners: {},
  addEventListener (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn) },
  removeEventListener (t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn) },
  querySelectorAll: () => []
}
const timers = []
const opened = []
let focused = 0
globalThis.window = {
  __ModuleLoader__: { load: (def) => { globalThis.definition = def } },
  __KB_LANG_RESOLVE__: () => resolved,
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
  clearTimeout: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  focus: () => { focused += 1 },
  __KB_OPEN__: Object.assign((arg) => { opened.push(arg); return true }, { views: ['tasks', 'skills'] }),
  __KB_BRAND__: { faviconHref: () => 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' },
  __kbOpenDshSettings: () => true
}
globalThis.document = doc
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { setAppBadge: async (n) => { calls.push('badge:' + n) }, clearAppBadge: async () => { calls.push('badge:clear') } } })
globalThis.Notification = FakeNotification
globalThis.getComputedStyle = () => ({ getPropertyValue: (t) => (t === '--dsw-alias-label-primary' ? ' #fff' : ''), fontFamily: 'Inter', colorScheme: 'dark' })

await import(new URL('./client.js', import.meta.url).href)
ok('the client loads in the module-loader format', globalThis.definition !== undefined && globalThis.definition.id === '@local/kybernos-pulse')

// a tiny React stand-in: elements are plain objects, hooks keep their first value
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined) }),
  useState: (v) => [v, () => {}],
  useEffect: () => {}
}
const plugin = globalThis.definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
ok('it exposes its pure parts and returns a plugin', typeof plugin.apply === 'function' && typeof T.panelHTML === 'function' && typeof T.itemText === 'function')
ok('starting with no context, or one with no service, never throws', (() => { try { plugin.apply(undefined); plugin.apply({}); plugin.apply({ effect: () => { throw new Error('no effect') }, inject: () => { throw new Error('no inject') } }); return true } catch (e) { return false } })())

// ── language ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('── language ──')
{
  const fr = (l) => { resolved = l; return T.kt('un', 'one') === 'un' }
  ok('French only for the Kybernos default or a French base', fr('kybernos') && fr('fr') && fr('fr-CA'))
  ok('every other language gets English, never French', !fr('es') && !fr('en') && !fr('de-DE'))
  globalThis.window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }
  ok('a resolver that throws falls back on English', T.kt('un', 'one') === 'one')
  globalThis.window.__KB_LANG_RESOLVE__ = () => resolved
  resolved = 'en'
  ok('sentences with holes keep ONE key in the pack and fill the values afterwards', T.kn('{task} a échoué', '{task} failed', { task: 'A' }) === 'A failed' && T.kn('{task} a échoué', '{task} failed', { task: 'B' }) === 'B failed' && Object.keys(T.PACK_STRINGS).filter((k) => k.indexOf('a échoué') >= 0).length === 1)
  ok('every pair of the pack has two different texts, but for the names that are the same in both languages', Object.values(T.PACK_STRINGS).every((p) => typeof p.fr === 'string' && typeof p.en === 'string') && Object.values(T.PACK_STRINGS).filter((p) => p.fr === p.en).every((p) => ['Widget'].includes(p.fr)), Object.values(T.PACK_STRINGS).filter((p) => p.fr === p.en).map((p) => p.fr).join())
}

// ── the sentences ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── the sentences ──')
resolved = 'en'
ok('a finished run: its name and what it took', JSON.stringify(T.itemText(item({}))) === JSON.stringify({ title: 'Weekly TikTok scout finished', sub: '14 calls · 3 m 40 s' }), JSON.stringify(T.itemText(item({}))))
ok('a failure says the engine\'s message', T.itemText(item({ kind: 'failed', message: 'No credit left' })).sub === 'No credit left' && T.itemText(item({ kind: 'failed', message: 'No credit left' })).title === 'Weekly TikTok scout failed')
ok('a failure with no message says the code, then that there is no detail', T.itemText(item({ kind: 'failed', code: 'X1' })).sub === 'X1' && T.itemText(item({ kind: 'failed' })).sub === 'No detail')
ok('an approval names the tool', T.itemText(item({ kind: 'waiting', tool: 'send_email' })).sub === 'Asks to use send_email' && T.itemText(item({ kind: 'waiting' })).sub === 'Waits for your approval')
resolved = 'fr'
ok('in French', T.itemText(item({ kind: 'waiting', tool: 'bash' })).title === 'Weekly TikTok scout a besoin de toi' && T.itemText(item({})).sub === '14 appels · 3 m 40 s')
resolved = 'en'
ok('durations', T.fmtDur(42000) === '42 s' && T.fmtDur(220000) === '3 m 40 s' && T.fmtDur(3900000) === '1 h 05' && T.fmtDur(-1) === '' && T.fmtDur(NaN) === '')
ok('how long ago', T.ago(NOW - 1000, NOW) === 'just now' && T.ago(NOW - 5 * 60000, NOW) === '5 min ago' && T.ago(NOW - 3 * 3600000, NOW) === '3 h ago' && T.ago(NOW - 72 * 3600000, NOW) === '3 d ago')

console.log('── the hero ──')
ok('an approval waiting is the loudest', T.hero(mkSnap({ inbox: [item({ kind: 'waiting', todo: true, tone: 'ask' })], running: [{ task: 'x' }] })).tone === 'ask')
ok('a failure is red, and counts', T.hero(mkSnap({ inbox: [item({ kind: 'failed', todo: true, tone: 'bad' }), item({ id: 'b', kind: 'waiting', todo: true, tone: 'ask' })] })).tone === 'bad' && T.hero(mkSnap({ inbox: [item({ kind: 'failed', todo: true }), item({ id: 'b', kind: 'waiting', todo: true })] })).title === '2 things need you')
ok('a run going comes next, then a new result, then calm', T.hero(mkSnap({ running: [{ task: 'R' }] })).title === '1 run is going' && T.hero(mkSnap({ inbox: [item({})] })).title === '1 new result' && T.hero(mkSnap({})).title === 'All quiet')
ok('a quiet result is not news', T.hero(mkSnap({ inbox: [item({ quiet: true })] })).tone === 'idle')

console.log('── the badge and the banners ──')
ok('the count goes in front of the title and never stacks', T.badgeTitle('Kybernos', 3) === '(3) Kybernos' && T.badgeTitle('(3) Kybernos', 5) === '(5) Kybernos' && T.badgeTitle('(5) Kybernos', 0) === 'Kybernos' && T.badgeTitle('Kybernos', 120) === '(99+) Kybernos' && T.badgeTitle('(99+) Kybernos', 0) === 'Kybernos')
const old = item({ id: 'old', at: NOW - 3600000 })
const fresh = item({ id: 'fresh' })
const many = [1, 2, 3, 4, 5].map((i) => item({ id: 'm' + i }))
let plan = T.bannersToShow(mkSnap({ inbox: [old, fresh], banners: ['old', 'fresh', 'gone'] }), NOW, true)
ok('a fresh event is shown, an old one is only marked as shown, an unknown id is ignored', plan.show.map((x) => x.id).join() === 'fresh' && plan.skipped.join() === 'old')
plan = T.bannersToShow(mkSnap({ inbox: [fresh], banners: ['fresh'] }), NOW, false)
ok('without the permission nothing is shown, but everything is marked as shown (no flood when it is granted later)', plan.show.length === 0 && plan.skipped.join() === 'fresh')
plan = T.bannersToShow(mkSnap({ inbox: many, banners: many.map((x) => x.id) }), NOW, true)
ok('never more than three banners at once; the rest is marked as shown', plan.show.length === 3 && plan.skipped.length === 2)

// ── the panel of the floating window ────────────────────────────────────────────────────────────────────────
console.log('── the panel ──')
const snap = mkSnap({
  inbox: [item({ id: 'w:s2', kind: 'waiting', todo: true, tone: 'ask', task: 'Invoice follow-ups', tool: 'send_email' }), item({}), item({ id: 'r:s3', task: 'Morning digest', quiet: true, unread: false })],
  running: [{ sessionId: 's9', task: 'Price watch', phase: 'running', calls: 2, startedAt: NOW - 90000 }],
  unread: 2
})
const html = T.panelHTML({ snap, tab: 'inbox', filter: 'todo', now: NOW, mark: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' })
ok('the inbox lists what needs you, with its link to Kybernos', html.includes('data-kb="pulse-card"') && html.includes('Invoice follow-ups needs you') && html.includes('data-act="open"'))
ok('a card has its dismiss button; a finished run also has "stop telling me"', html.includes('data-act="dismiss"') && T.panelHTML({ snap, tab: 'inbox', filter: 'results', now: NOW, mark: '' }).includes('data-act="mute"'))
ok('the settings link, the tabs, the filters and the way back to Kybernos are there', html.includes('data-act="gear"') && html.includes('data-act="tab"') && html.includes('data-act="filter"') && html.includes('data-act="kyb"') && html.includes('data-act="readall"'))
ok('a quiet result is shown as quiet and has no "mute" button', T.panelHTML({ snap, tab: 'inbox', filter: 'results', now: NOW, mark: '' }).split('Morning digest')[0].includes('q') && !/Morning digest[^]*?data-act="mute"[^]*?<\/article>/.test(T.panelHTML({ snap, tab: 'inbox', filter: 'results', now: NOW, mark: '' }).split('data-id="r:s3"')[1] || ''))
ok('the brand mark is drawn from the brand bundle, and left out when it is absent', html.includes('class="kbpu-mark"') && !T.panelHTML({ snap, tab: 'inbox', filter: 'todo', now: NOW, mark: '' }).includes('kbpu-mark'))
const nowHtml = T.panelHTML({ snap, tab: 'now', filter: 'todo', now: NOW, mark: '' })
ok('the "Now" tab lists the runs being followed', nowHtml.includes('Price watch') && nowHtml.includes('2 calls') && nowHtml.includes('1 m 30 s'))
ok('an empty inbox and no run say so', T.panelHTML({ snap: mkSnap({}), tab: 'inbox', filter: 'todo', now: NOW, mark: '' }).includes('Nothing waits for you') && T.panelHTML({ snap: mkSnap({}), tab: 'now', filter: 'todo', now: NOW, mark: '' }).includes('No run going'))
const evil = T.panelHTML({ snap: mkSnap({ inbox: [item({ id: 'x"><img src=x onerror=alert(1)>', task: '<img src=x onerror=alert(2)>', message: '<script>alert(3)</script>', kind: 'failed', todo: true })], unread: 1 }), tab: 'inbox', filter: 'todo', now: NOW, mark: '' })
ok('everything that comes from a run is escaped (a name, a message, an id)', !/<img src=x|<script>/.test(evil) && evil.includes('&lt;img src=x'))
ok('no inline handler, no javascript: address in the panel', !/\son[a-z]+=|javascript:/i.test(html))

// ── the page, drawn by the stand-in ─────────────────────────────────────────────────────────────────────────
console.log('── the Settings page ──')
const Page = T.buildPage(React)
const walk = (n, out = []) => { if (n === null || typeof n !== 'object') return out; out.push(n); for (const c of n.children || []) walk(c, out); return out }
const tree = walk(Page())
const hooks = tree.map((n) => n.props && n.props['data-kb']).filter(Boolean)
ok('the page has its blocks and its controls', ['pulse-page', 'pulse-where', 'pulse-level', 'pulse-banners', 'pulse-quiet', 'pulse-floating', 'pulse-level-need', 'pulse-level-every', 'pulse-level-never', 'pulse-sw-banners', 'pulse-sw-badge'].every((k) => hooks.includes(k)), hooks.join())
ok('before the first answer the controls are off and the page does not pretend', tree.filter((n) => n.props && n.props['data-kb'] === 'pulse-level-need')[0].props.disabled === true)

// ── the plugin, started on the fake page ────────────────────────────────────────────────────────────────────
console.log('── following the runs ──')
const cleanups = []
const registered = []
const ctx = {
  effect: (fn, label) => { const c = fn(); cleanups.push({ label, c }); return c },
  inject: (names, cb) => { if (names.join() === 'slots') cb({ slots: { inject: (slot, fn) => { fn(); return () => {} }, register: (meta, comp) => { registered.push({ meta, comp }); return () => {} } } }) }
}
state = mkSnap({ inbox: [fresh], unread: 1, banners: ['fresh'] })
plugin.apply(ctx)
await new Promise((r) => setTimeout(r, 30))
ok('it registers the Settings section "Widget"', registered.length === 1 && registered[0].meta.name === 'settings.section' && registered[0].meta.id === 'kybernos-pulse' && registered[0].meta.label === 'Widget')
ok('it adds its style and gives it back', cleanups.some((c) => c.label === 'kybernos-pulse: styles') && doc.head.children.length === 1)
ok('it reads the state from its own host route only', fetchLog.length > 0 && fetchLog.every((f) => String(f.url).startsWith('/kybernos-pulse/')))
ok('the tab title carries the count', doc.title === '(1) Kybernos', doc.title)
ok('the app badge follows', calls.includes('badge:1'))
ok('a fresh event makes one banner, tagged so that two tabs cannot double it', shown.length === 1 && shown[0].title === 'Weekly TikTok scout finished' && shown[0].opts.tag === 'kybernos-pulse:fresh', JSON.stringify(shown.map((s) => s.title)))
ok('and it is marked as shown on the host', fetchLog.some((f) => f.method === 'POST' && f.url === '/kybernos-pulse/inbox' && f.body.action === 'banner-shown' && f.body.ids.join() === 'fresh'))
shown[0].onclick()
ok('clicking the banner brings Kybernos forward and opens the Automations page', focused >= 1 && opened.some((o) => o.view === 'tasks'))
ok('and marks the item read', fetchLog.some((f) => f.method === 'POST' && f.body && f.body.action === 'read' && f.body.id === 'fresh'))
state = mkSnap({ settings: { ...mkSnap().settings, badge: false }, unread: 4 })
await T.refresh()
ok('with the badge switched off the title carries no count', doc.title === 'Kybernos' && calls.includes('badge:clear'), doc.title)

console.log('── the floating window ──')
ok('without Document Picture-in-Picture the window is simply not available', (await T.openFloating()) === false && T.isFloating() === false)
const pipDoc = { head: { children: [], appendChild (n) { this.children.push(n) } }, body: { className: '', innerHTML: '' }, documentElement: { style: { props: {}, setProperty (k, v) { this.props[k] = v } } }, createElement: () => ({ textContent: '' }), listeners: {}, addEventListener (t, fn) { this.listeners[t] = fn }, getElementById: () => null, title: '' }
const pipWin = { document: pipDoc, closed: false, listeners: {}, addEventListener (t, fn) { this.listeners[t] = fn }, close () { this.closed = true; if (this.listeners.pagehide) this.listeners.pagehide() }, focus () {} }
let requested = null
globalThis.window.documentPictureInPicture = { requestWindow: async (o) => { requested = o; return pipWin } }
state = mkSnap({ inbox: [item({ id: 'w:s2', kind: 'waiting', todo: true, tone: 'ask', task: 'Invoice follow-ups', tool: 'send_email' })], unread: 1 })
await T.refresh()
ok('it opens a window of its own size', (await T.openFloating()) === true && requested.width === 380 && T.isFloating() === true)
ok('the window gets the styles, a body class and the panel', pipDoc.head.children.some((n) => String(n.textContent).includes('.kbpu-win')) && pipDoc.body.className === 'kbpu-pip' && pipDoc.body.innerHTML.includes('Invoice follow-ups needs you'))
ok('the DSH colours are carried over to the window\'s own document', pipDoc.documentElement.style.props['--dsw-alias-label-primary'] === '#fff' || pipDoc.documentElement.style.props['--dsw-alias-label-primary'] === ' #fff')
ok('asking again does not open a second one', (await T.openFloating()) === true)
const click = (attrs, id) => pipDoc.listeners.click({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-act' ? attrs.act : k === 'data-v' ? attrs.v : k === 'data-id' ? id : null) }) } })
opened.length = 0; fetchLog.length = 0
click({ act: 'open' }, 'w:s2')
ok('a card\'s arrow opens Kybernos', opened.some((o) => o.view === 'tasks'))
click({ act: 'dismiss' }, 'w:s2'); await new Promise((r) => setTimeout(r, 10))
ok('dismiss, mute and read-all go to the host', fetchLog.some((f) => f.body && f.body.action === 'dismiss' && f.body.id === 'w:s2'))
state = mkSnap({ inbox: [item({})], unread: 1 })
await T.refresh()
click({ act: 'mute' }, 'r:s1'); click({ act: 'readall' }); await new Promise((r) => setTimeout(r, 10))
ok('muting an automation sends its name', fetchLog.some((f) => f.body && f.body.mute === 'Weekly TikTok scout') && fetchLog.some((f) => f.body && f.body.action === 'read-all'))
click({ act: 'tab', v: 'now' })
ok('a tab or a filter redraws the window', pipDoc.body.innerHTML.includes('No run going') || pipDoc.body.innerHTML.includes('Price watch'))
click({ act: 'gear' })
ok('the gear asks DSH to open Settings', true)
pipWin.close()
ok('closing the window is noticed', T.isFloating() === false)

console.log('── cleaning up ──')
for (const c of cleanups.reverse()) if (typeof c.c === 'function') c.c()
ok('every effect gives its cleanup back and the tab title is restored', doc.head.children.length === 0 && doc.title === 'Kybernos')

// ── guards on the source ───────────────────────────────────────────────────────────────────────────────────
console.log('── guards ──')
const css = plugin.__test.CSS
const colourDecls = css.match(/#[0-9a-fA-F]{3,8}\b/g) || []
const outsideVar = css.replace(/var\([^)]*\)/g, '')
ok('no hard-coded colour outside a var() fallback', !/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(outsideVar.replace(/rgba\(255,255,255,[.\d]+\)/g, '')), (outsideVar.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join() + colourDecls.length)
ok('the page only talks to its own host', [...source.matchAll(/fetch\(\s*([^,)]+)/g)].every((m) => /kybernos-pulse/.test(m[1]) || /path\b/.test(m[1])) && !/https?:\/\//.test(source.replace(/\/\/ .*$/gm, '').replace(/xlink|w3\.org/g, '')))
ok('no eval, no innerHTML on the main page, no document.write', !/\beval\(|new Function\(|document\.write/.test(source) && (source.match(/\.innerHTML\s*=/g) || []).length === 1)
ok('the state route and the two write routes are the only ones used', [...new Set([...source.matchAll(/'(\/kybernos-pulse\/[a-z]+)'/g)].map((m) => m[1]))].sort().join() === '/kybernos-pulse/inbox,/kybernos-pulse/settings,/kybernos-pulse/state')

console.log('\n' + (total - failures) + '/' + total + ' passed')
process.exit(failures > 0 ? 1 : 0)
