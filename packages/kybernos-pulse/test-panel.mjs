// The page of the Mac menu-bar app: built from the pure block of client.js, served by the host, writes through the app's own token.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { cleanItem, defaults, inboxPut, publicView } from './pulse-core.mjs'
import { helperTokenOk, mountRoutes } from './pulse-host.mjs'
import { brandMarkFrom, buildPanelPage, extractCore, PANEL_CSP } from './panel-page.mjs'
import { ensureHelperToken, readPanelPage, tokenFile } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
let n = 0
const ok = (name) => { n += 1; console.log('  ✓ ' + name) }
const client = readFileSync(join(here, 'client.js'), 'utf8')

// ── the shared block ─────────────────────────────────────────────────────────
console.log('the shared block')
const core = extractCore(client)
assert.ok(typeof core === 'string' && core.length > 5000)
ok('client.js has its PANEL-CORE block and it can be taken out')
assert.equal(extractCore('no markers here'), null)
assert.equal(extractCore('// PANEL-CORE-END then // PANEL-CORE-BEGIN'), null)
ok('without both markers (in order) there is no block')
assert.ok(!core.includes('PANEL-CORE'))
assert.ok(core.trimStart().startsWith('//') || core.trimStart().startsWith('const'))
ok('what is taken out is code, not the rest of the marker line')

// The block must be pure: it runs with nothing but a `window` for the language, and has no DOM, no fetch, no storage.
const run = (lang) => {
  const win = { __KB_LANG_RESOLVE__: () => lang }
  const fn = new Function('window', core + '\nreturn { panelHTML, hero, esc, PANEL_CSS, itemText }')
  return fn(win)
}
const NOW = 1790000000000
const sid = (c) => 'session-' + c.repeat(8) + '-aaaa-bbbb-cccc-' + c.repeat(12)
let inbox = []
inbox = inboxPut(inbox, cleanItem({ id: 'a', kind: 'waiting', task: 'Invoice follow-ups', at: NOW - 60000, unread: true, tool: 'send_email', sessionId: sid('1') }))
inbox = inboxPut(inbox, cleanItem({ id: 'b', kind: 'done', task: 'Weekly scout', at: NOW - 900000, unread: true, durMs: 72000, calls: 14, sessionId: sid('2') }))
const snap = { ok: true, ...publicView({ settings: defaults(), state: { inbox }, running: [{ sessionId: sid('3'), taskId: 't', task: 'Audit', phase: 'running', calls: 4, startedAt: NOW - 20000 }], now: NOW }) }
const fr = run('kybernos')
const en = run('en')
const htmlFr = fr.panelHTML({ snap, tab: 'inbox', filter: 'todo', now: NOW, mark: '' })
const htmlEn = en.panelHTML({ snap, tab: 'inbox', filter: 'todo', now: NOW, mark: '' })
assert.ok(htmlEn.includes('Invoice follow-ups needs you') && htmlEn.includes('Open Kybernos') && htmlEn.includes('data-act="open"'))
assert.ok(htmlFr.includes('Invoice follow-ups a besoin de toi') && htmlFr.includes('Ouvrir Kybernos'))
ok('on its own, with only a language, the block draws the panel in French and in English')
assert.ok(Array.isArray(en.PANEL_CSS) && en.PANEL_CSS.join('').includes('.kbpu-card') && en.PANEL_CSS.join('').includes('.kbpu-cta'))
ok('it carries the sheet of the panel')
assert.ok(!/\b(document|fetch|localStorage|sessionStorage|XMLHttpRequest|getComputedStyle)\b/.test(core.replace(/\/\/.*$/gm, '')))
ok('and nothing that touches a page, the network or a store')

// ── the page ─────────────────────────────────────────────────────────────────
console.log('the page')
const mark = brandMarkFrom(readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8'))
assert.ok(mark.startsWith('data:image/svg+xml,'))
assert.equal(brandMarkFrom('nothing'), '')
ok('the brand mark comes from the brand code, and is empty without it')
const page = buildPanelPage({ core, mark })
assert.ok(typeof page === 'string' && page.startsWith('<!doctype html>'))
assert.equal(buildPanelPage({ core: '', mark }), null)
assert.equal(buildPanelPage({ core: 'x</script><script>alert(1)', mark }), null)
ok('the page is built; no block, or a block that could close the script, gives no page')
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'))
assert.doesNotThrow(() => new Function(script))
ok('its script is valid code')
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(page.replace(/%[0-9A-F]{2}/g, '')), 'no address in the page')
assert.ok(!/<(link|img|iframe|script)[^>]+src=/i.test(page.replace(/<img class="kbpu-mark" src=/g, '')))
ok('the page loads nothing from anywhere: no address, no external script, style or frame')
assert.ok(/connect-src 'self'/.test(PANEL_CSP) && /default-src 'none'/.test(PANEL_CSP) && /frame-ancestors 'none'/.test(PANEL_CSP) && !/unsafe-eval/.test(PANEL_CSP))
ok('the policy it is served under allows its own scripts and its own host only, no eval')

// The page, run on a stand-in of a browser: it draws, polls, answers the clicks and writes only with a token.
const runPage = async ({ token, state, down }) => {
  const calls = []
  const handlers = {}
  const posted = []
  const nodes = { root: { innerHTML: '' }, 'kbpu-body': null, 'kbpu-sheet': { textContent: '' } }
  const document = {
    getElementById: (id) => (nodes[id] === undefined ? null : nodes[id]),
    addEventListener: (type, fn) => { handlers[type] = fn },
    visibilityState: 'visible'
  }
  const fetchLog = []
  const fakeFetch = async (url, opts = {}) => {
    fetchLog.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body })
    if (down) throw new Error('refused')
    return { ok: true, json: async () => state }
  }
  const window = { open: (u) => calls.push('open:' + u) }
  if (token !== undefined) window.__PULSE_TOKEN__ = token
  window.webkit = { messageHandlers: { pulse: { postMessage: (m) => posted.push(m) } } }
  const intervals = []
  const ctx = { window, document, location: { search: '?lang=en' }, URLSearchParams, fetch: fakeFetch, setInterval: (fn, ms) => { intervals.push(ms); return 1 }, Date, JSON, Array, String, Math, Promise }
  vm.runInNewContext(script, ctx)
  await new Promise((r) => setTimeout(r, 20))
  const click = (attrs) => {
    const el = { getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]), closest: () => el }
    handlers.click({ target: el })
  }
  return { nodes, fetchLog, posted, calls, click, intervals, handlers }
}
const state = { ...snap, now: Date.now() }
state.inbox = state.inbox.map((x) => ({ ...x, at: Date.now() - 60000 }))
let p = await runPage({ token: 'a'.repeat(64), state })
assert.ok(p.nodes.root.innerHTML.includes('Invoice follow-ups needs you') && p.nodes['kbpu-sheet'].textContent.includes('.kbpu-card'))
assert.equal(p.fetchLog[0].url, '/kybernos-pulse/state')
assert.ok(p.intervals.includes(4000))
ok('it draws the panel from the state, with the sheet, and polls every four seconds')
p.click({ 'data-act': 'tab', 'data-v': 'now' })
assert.ok(p.nodes.root.innerHTML.includes('Audit'))
p.click({ 'data-act': 'tab', 'data-v': 'inbox' })
p.click({ 'data-act': 'filter', 'data-v': 'results' })
assert.ok(p.nodes.root.innerHTML.includes('Weekly scout'))
ok('the tabs and the filters work on the page itself')
p.click({ 'data-act': 'open', 'data-id': 'a' })
await new Promise((r) => setTimeout(r, 20))
assert.equal(JSON.stringify(p.posted.at(-1)), '{"act":"open"}')
const readPost = p.fetchLog.find((f) => f.method === 'POST')
assert.ok(readPost && readPost.url === '/kybernos-pulse/inbox' && JSON.parse(readPost.body).action === 'read' && readPost.headers['x-kybernos-helper-token'] === 'a'.repeat(64))
ok('an arrow tells the app to open Kybernos and marks the item read, with the token')
p.click({ 'data-act': 'gear' })
assert.equal(JSON.stringify(p.posted.at(-1)), '{"act":"settings"}')
p.click({ 'data-act': 'kyb' })
assert.equal(JSON.stringify(p.posted.at(-1)), '{"act":"open"}')
ok('the gear and the big button reach the app too')
p.click({ 'data-act': 'dismiss', 'data-id': 'b' })
p.click({ 'data-act': 'mute', 'data-id': 'b' })
p.click({ 'data-act': 'readall' })
await new Promise((r) => setTimeout(r, 20))
const bodies = p.fetchLog.filter((f) => f.method === 'POST').map((f) => f.url + ' ' + f.body)
assert.ok(bodies.some((b) => b === '/kybernos-pulse/inbox {"action":"dismiss","id":"b"}'))
assert.ok(bodies.some((b) => b === '/kybernos-pulse/settings {"mute":"Weekly scout"}'))
assert.ok(bodies.some((b) => b === '/kybernos-pulse/inbox {"action":"read-all"}'))
ok('dismiss, quiet and read-all are the plugin\'s own writes')
p = await runPage({ token: undefined, state })
p.click({ 'data-act': 'dismiss', 'data-id': 'a' })
p.click({ 'data-act': 'readall' })
await new Promise((r) => setTimeout(r, 20))
assert.equal(p.fetchLog.filter((f) => f.method === 'POST').length, 0)
ok('without a token the page only reads')
p = await runPage({ token: 'a'.repeat(64), state, down: true })
assert.ok(p.nodes.root.innerHTML.includes('Kybernos is not running'))
ok('with DSH down it says so, in words, instead of an error')

// ── the route and the token ──────────────────────────────────────────────────
console.log('the route')
const routes = new Map()
const web = { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) } }
const fakePulse = { view: () => state, patchSettings: () => ({ ok: true }), inbox: () => ({ ok: true }) }
mountRoutes(web, fakePulse, () => null, { panelPage: page, panelCsp: PANEL_CSP })
const hit = async (path, { method = 'GET', headers = {} } = {}) => {
  const out = { status: 0, headers: {}, body: '' }
  const res = { writeHead (s, h) { out.status = s; out.headers = h || {} }, end (t) { out.body = t || '' } }
  await routes.get(path)({ method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 } }, res)
  return out
}
let r = await hit('/kybernos-pulse/panel')
assert.equal(r.status, 200)
assert.ok(r.headers['content-type'].startsWith('text/html') && r.headers['content-security-policy'] === PANEL_CSP && r.headers['cache-control'] === 'no-store' && r.headers['x-content-type-options'] === 'nosniff')
assert.equal(r.body, page)
ok('the route serves the page with its policy, uncached')
assert.equal((await hit('/kybernos-pulse/panel', { headers: { host: 'evil.example:3080' } })).status, 403)
assert.equal((await hit('/kybernos-pulse/panel', { headers: { origin: 'http://evil.example' } })).status, 403)
assert.equal((await hit('/kybernos-pulse/panel', { method: 'POST' })).status, 405)
ok('a foreign Host or Origin, or another method, is refused')
const routes2 = new Map()
mountRoutes({ register: ({ path, handler }) => { routes2.set(path, handler); return () => {} } }, fakePulse, () => null, {})
assert.ok(!routes2.has('/kybernos-pulse/panel'))
ok('with no page there is no route')

const T = 'ab'.repeat(32)
const req = (headers, extra = {}) => ({ method: 'POST', headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, ...extra })
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T }), T), true)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T, origin: 'http://127.0.0.1:3080' }), T), true)
ok('the right token passes, from the app (no Origin) or from its own page (same Origin)')
assert.equal(helperTokenOk(req({}), T), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': 'cd'.repeat(32) }), T), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T.slice(0, 63) }), T), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T.toUpperCase() }), T), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T }), null), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T }), 'short'), false)
ok('no token, a wrong one, a short or upper-case one, or no token on the host side never passes')
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T, origin: 'http://evil.example' }), T), false)
assert.equal(helperTokenOk(req({ 'x-kybernos-helper-token': T, host: 'evil.example:3080' }), T), false)
ok('the right token from a foreign page or a rebound host is still refused')

// ── the token file and the real page ─────────────────────────────────────────
console.log('the files')
const home = mkdtempSync(join(tmpdir(), 'kb-pulse-panel-'))
try {
  const t1 = ensureHelperToken(home)
  assert.match(t1, /^[0-9a-f]{64}$/)
  assert.equal(ensureHelperToken(home), t1)
  assert.equal((statSync(tokenFile(home)).mode & 0o777), 0o600)
  assert.equal((statSync(dirname(tokenFile(home))).mode & 0o777), 0o700)
  ok('the token is made once, kept, and readable by its owner only')
  writeFileSync(tokenFile(home), 'not a token\n')
  const t2 = ensureHelperToken(home)
  assert.match(t2, /^[0-9a-f]{64}$/)
  assert.notEqual(t2, 'not a token')
  ok('a damaged token file is replaced')
} finally { rmSync(home, { recursive: true, force: true }) }
const real = readPanelPage()
assert.ok(typeof real === 'string' && real.includes('PANEL_CSS') && real.includes('data:image/svg+xml,'))
assert.equal(readPanelPage(join(tmpdir(), 'kb-nowhere-' + process.pid)), null)
ok('the page of this checkout is built, with the mark; with no client.js there is none')

console.log('\n' + n + ' checks passed')
