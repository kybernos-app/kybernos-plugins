#!/usr/bin/env node
// Checks the « Kybernos connections » mode of the Connectors page against a REAL DSH GUI, with a stand-in server that speaks
// ADR 0008 of the Kybernos server (the real one is not built yet).
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-connections-live.mjs [--shots <dir>]
//
// It writes into the isolated instance only: a server entry whose `services.connections` points at the stand-in, and a connection
// file with a made-up token. Both are put back as they were at the end. It REFUSES to run against the real DSH (127.0.0.1:3080) or
// without an isolated DSH_HOME. The host half (the /kybernos-cloud/connections* routes) must be the current code: restart the
// sandbox after a host edit (scripts/sandbox/stop.sh, then start.sh).
//
// What it plays: the mode switch only when the server offers connections; the list with its states and the quota; row actions
// hidden until hover; a pending connection that turns active by itself (the page asks about it every 5 s); adding an OAuth app
// (what the stand-in receives, and nothing else); adding an app with an API key (the key reaches the stand-in once and appears
// nowhere on the page or in the browser's storage); a refused add that may have gone through (one call, then « check the list »);
// removing; the quota; the sign-in shown when the account is not connected; and the mode gone when the server stops offering it.
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
// Named check-*, not test-*: CI runs every test-*.mjs with no DSH, and this one needs one.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('✗ this check writes a server entry and a connection into the DSH it talks to, and that is the real one (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('✗ DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(2) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

// ── the stand-in server: ADR 0008, just enough ────────────────────────────────────────────────────────────────────────
const TOKEN = 'kyd-live-stand-in-token'
const NEW_TOKEN = 'kyd-live-claimed-token'
const KEY = 'sk-live-THE-API-KEY-1234567890'
const calls = []
const st = { limit: 4, seq: 0, failNextLink: false, claimed: false, polls: 0, conns: [] }
const uuid = () => { st.seq += 1; return '00000000-0000-4000-8000-' + String(st.seq).padStart(12, '0') }
const mk = (toolkit, status, extra) => Object.assign({ id: uuid(), toolkit, status, account_type: 'oauth', alias: null, is_default: false, created_at: new Date().toISOString(), _polls: 0 }, extra || {})
const pub = (c) => ({ id: c.id, toolkit: c.toolkit, status: c.status, account_type: c.account_type, alias: c.alias, is_default: c.is_default, created_at: c.created_at, ...(c.failure ? { failure: c.failure } : {}) })
const APPS = [
  { slug: 'gmail', name: 'Gmail', categories: ['email'], description: 'Mail', needs_api_key: false },
  { slug: 'github', name: 'GitHub', categories: ['developer tools'], description: 'Code', needs_api_key: false },
  { slug: 'slack', name: 'Slack', categories: ['chat'], description: 'Messages', needs_api_key: false },
  { slug: 'linear', name: 'Linear', categories: ['tickets'], description: 'Tickets', needs_api_key: false },
  { slug: 'notion', name: 'Notion', categories: ['docs'], description: 'Pages', needs_api_key: true },
]
// A catalogue of about a thousand apps in real life: a hundred more here so the add window has to page.
for (let i = 1; i <= 100; i += 1) APPS.push({ slug: 'zeta-app-' + String(i).padStart(3, '0'), name: 'Zeta App ' + String(i).padStart(3, '0'), categories: ['filler'], description: 'Filler', needs_api_key: false })
const reseed = () => {
  st.seq = 0; st.failNextLink = false; st.claimed = false; st.polls = 0
  st.conns = [mk('gmail', 'active', { alias: 'pro', is_default: true }), mk('github', 'active', { is_default: true }), mk('slack', 'pending')]
}
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === null ? '' : JSON.stringify(body)) }
const stub = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = '<<not json>>' }
    const url = new URL(req.url, 'http://x')
    calls.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || null, body, raw })
    if (url.pathname === '/v1/device/start') return json(res, 200, { device_id: 'dev1', device_secret: 'sec1', user_code: 'ABCD-1234', activation_url: 'https://auth.example.test/activate', expires_in: 600 })
    if (url.pathname === '/v1/device/poll') { st.polls += 1; return st.polls >= 2 ? json(res, 200, { status: 'claimed', token: NEW_TOKEN, user: { id: 'u1', name: 'Live Tester', plan: 'studio' } }) : json(res, 200, { status: 'pending' }) }
    const auth = req.headers.authorization
    if (auth !== 'Bearer ' + TOKEN && auth !== 'Bearer ' + NEW_TOKEN) return json(res, 401, { error: 'unauthorized' })
    const one = /^\/v1\/connections\/([0-9a-f-]{36})$/.exec(url.pathname)
    if (url.pathname === '/v1/connections' && req.method === 'GET') return json(res, 200, { configured: true, connections: st.conns.map(pub), limit: st.limit, count: st.conns.length })
    if (url.pathname === '/v1/connections/apps') return json(res, 200, { configured: true, apps: APPS })
    if (one && req.method === 'GET') {
      const c = st.conns.find((x) => x.id === one[1])
      if (!c) return json(res, 404, { error: 'not_found' })
      if (c.status === 'pending') { c._polls += 1; if (c._polls >= 1) c.status = 'active' }
      return json(res, 200, pub(c))
    }
    if (one && req.method === 'DELETE') {
      const i = st.conns.findIndex((x) => x.id === one[1])
      if (i < 0) return json(res, 404, { error: 'not_found' })
      st.conns.splice(i, 1)
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/v1/connections/link' && req.method === 'POST') {
      const b = body || {}
      if (st.failNextLink) { st.failNextLink = false; return json(res, 502, { error: 'upstream_unavailable', retry: 'check_first', message: 'SECRET Composio said ' + KEY }) }
      if (st.conns.length >= st.limit) return json(res, 409, { error: 'connection_limit', limit: st.limit, count: st.conns.length })
      const app = APPS.find((a) => a.slug === b.toolkit)
      if (!app) return json(res, 404, { error: 'not_found' })
      if (st.conns.some((c) => c.toolkit === b.toolkit && c.status === 'pending')) { const e = st.conns.find((c) => c.toolkit === b.toolkit && c.status === 'pending'); return json(res, 409, { error: 'pending_exists', existing: { id: e.id, toolkit: e.toolkit, status: e.status } }) }
      if (app.needs_api_key && !b.api_key) return json(res, 422, { error: 'no_managed_credentials' })
      const c = mk(b.toolkit, app.needs_api_key ? 'active' : 'pending', { alias: typeof b.alias === 'string' ? b.alias : null, account_type: app.needs_api_key ? 'api_key' : 'oauth' })
      st.conns.push(c)
      return json(res, 201, { id: c.id, status: c.status, redirect_url: app.needs_api_key ? null : 'https://auth.example.test/go/' + c.id })
    }
    return json(res, 404, { error: 'not_found', message: 'No such route.' })
  })
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const ORIGIN = 'http://127.0.0.1:' + stub.address().port
const SERVERS = join(DSH_HOME, 'kybernos', 'servers.json')
const STATE = join(DSH_HOME, 'kybernos-cloud-live-conn.json')
const keep = (file) => { if (existsSync(file)) { const bak = file + '.live-conn-bak'; renameSync(file, bak); return bak } return null }
const unkeep = (file, bak) => { rmSync(file, { force: true }); if (bak !== null) renameSync(bak, file) }
const registry = (connections) => {
  mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true })
  writeFileSync(SERVERS, JSON.stringify({ active: 'live-conn', servers: [{ id: 'live-conn', name: 'Live stand-in', api: ORIGIN, services: { llm: false, ...(connections === undefined ? {} : { connections }) } }] }))
}
const signedIn = () => writeFileSync(STATE, JSON.stringify({ token: TOKEN, user: { id: 'u1', name: 'Live Tester', plan: 'studio' }, workspaces: [] }))
const bakServers = keep(SERVERS)
const bakState = keep(STATE)
reseed()
registry(ORIGIN + '/v1/mcp/connections')
signedIn()

let live = null
try {
  live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const { page } = live
  const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { __err: r.err } : r.val }
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
  const q = (sel) => JSON.stringify(sel)
  const exists = async (sel) => (await ev(`!!document.querySelector(${q(sel)})`)) === true
  const text = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null })()`)
  const clickJs = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const opacityOf = (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); return e ? parseFloat(getComputedStyle(e).opacity) : null })()`)
  const hover = async (sel) => {
    const r = await ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
    if (r === null || r.__err) return false
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await sleep(350)
    return true
  }
  const typeInto = async (sel, value) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const rows = async () => (await ev(`Array.from(document.querySelectorAll('[data-kb-conn]')).map((r) => ({ id: r.getAttribute('data-kb-conn'), status: r.getAttribute('data-kb-status'), name: (r.querySelector('.kbcp-mname') || {}).textContent }))`)) || []
  const openPage = async () => {
    await waitFor(page, `document.readyState === 'complete'`, 15000)
    await sleep(2000)
    await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
    await sleep(400)
    await ev(`window.dispatchEvent(new CustomEvent('kb-open-resources', { detail: { tab: 'composio' } })); 1`)
    return (await waitFor(page, `!!document.querySelector('[data-kb="subtab-yours"]')`, 15000)) !== null
  }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  if ((await openPage()) !== true) { console.error('○ inconclusive: the Connections page did not open (is this DSH serving the current client? restart the sandbox after a host edit)'); process.exit(3) }
  await sleep(1500)

  console.log('the mode')
  const offered = await waitFor(page, `!!document.querySelector('[data-kb="mode-kybernos"]')`, 10000)
  check('the server offers connections: the switch is there, next to the person\'s own key', offered !== null && (await exists('[data-kb="mode-personal"]')))
  await shot('01-mode')
  check('the personal key is the mode until the person chooses', (await ev(`document.querySelector('[data-kb="mode-personal"]').getAttribute('aria-pressed')`)) === 'true')
  await clickJs('[data-kb="mode-kybernos"]')
  const listed = await waitFor(page, `document.querySelectorAll('[data-kb-conn]').length >= 3`, 10000)
  check('Kybernos connections: the account\'s three connections are listed', listed !== null, await rows())
  const first = await rows()
  check('each row has its state: two active, one pending', first.filter((r) => r.status === 'active').length === 2 && first.filter((r) => r.status === 'pending').length === 1, first)
  check('the quota is shown: 3 of 4', /3\D+4/.test(String(await text('.kbcp-kcmeter'))), await text('.kbcp-kcmeter'))
  check('the stand-in saw the account\'s own token and nothing else of the person', calls.filter((c) => c.path.startsWith('/v1/connections')).every((c) => c.auth === 'Bearer ' + TOKEN))
  await shot('02-list')

  console.log('row actions')
  const rowSel = `[data-kb-conn="${first.find((r) => r.status === 'active').id}"]`
  await ev(`window.scrollTo(0, 0); 1`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await sleep(300)
  check('the actions are hidden until the row is hovered', (await opacityOf(rowSel + ' .kbcp-macts')) === 0, await opacityOf(rowSel + ' .kbcp-macts'))
  await hover(rowSel + ' .kbcp-mname')
  check('...and appear on hover', (await opacityOf(rowSel + ' .kbcp-macts')) === 1, await opacityOf(rowSel + ' .kbcp-macts'))

  console.log('a pending connection finishes by itself')
  const pendingId = first.find((r) => r.status === 'pending').id
  check('the pending row says what to do and keeps its state chip', /Slack/.test(String(await text(`[data-kb-conn="${pendingId}"] .kbcp-detail`))), await text(`[data-kb-conn="${pendingId}"] .kbcp-detail`))
  const turned = await waitFor(page, `(document.querySelector('[data-kb-conn="${pendingId}"]') || { getAttribute: () => '' }).getAttribute('data-kb-status') === 'active'`, 20000)
  check('within a poll or two (5 s each) the page asks the server and the row turns active, with no click', turned !== null, await rows())
  check('it asked that ONE connection, not the whole list', calls.some((c) => c.method === 'GET' && c.path === '/v1/connections/' + pendingId))

  console.log('connect an app (OAuth)')
  await clickJs('[data-kb="kc-add"]')
  check('the add window opens with the server\'s catalogue', (await waitFor(page, `!!document.querySelector('[data-kb-app="linear"]')`, 10000)) !== null)
  check('the link button waits for an app', (await ev(`document.querySelector('[data-kb="kc-link"]').disabled`)) === true)
  const apps1 = await ev(`document.querySelectorAll('[data-kb-app]').length`)
  check('the window shows 48 apps of the 105, and offers the rest', apps1 === 48 && /57/.test(String(await text('[data-kb="kc-more"]'))), { apps1, more: await text('[data-kb="kc-more"]') })
  await clickJs('[data-kb="kc-more"]')
  await sleep(300)
  check('"show more" adds the next 48', (await ev(`document.querySelectorAll('[data-kb-app]').length`)) === 96 && /9/.test(String(await text('[data-kb="kc-more"]'))))
  await clickJs('[data-kb="kc-more"]')
  await sleep(300)
  check('...and the button goes when nothing is left', (await ev(`document.querySelectorAll('[data-kb-app]').length`)) === 105 && !(await exists('[data-kb="kc-more"]')))
  await typeInto('#kbcp-kc-q', 'notion')
  await sleep(300)
  check('a search narrows the list (and starts from the first page again)', (await ev(`document.querySelectorAll('[data-kb-app]').length`)) === 1 && !(await exists('[data-kb="kc-more"]')))
  await typeInto('#kbcp-kc-q', '')
  await sleep(300)
  await clickJs('[data-kb-app="linear"]')
  await sleep(300)
  await typeInto('#kbcp-kc-alias', 'team')
  await shot('03-add')
  const before = calls.length
  await clickJs('[data-kb="kc-link"]')
  const added = await waitFor(page, `Array.from(document.querySelectorAll('[data-kb-conn]')).some((r) => /Linear/.test(r.textContent))`, 10000)
  check('the new connection is in the list at once', added !== null, await rows())
  const link = calls.slice(before).find((c) => c.method === 'POST' && c.path === '/v1/connections/link')
  check('the stand-in got the toolkit and the label, and nothing else (no redirect address, no user id)', link !== undefined && JSON.stringify(link.body) === JSON.stringify({ toolkit: 'linear', alias: 'team' }), link && link.body)
  check('the add window closed', !(await exists('[data-kb="kc-link"]')))
  const linearTurned = await waitFor(page, `Array.from(document.querySelectorAll('[data-kb-conn]')).some((r) => /Linear/.test(r.textContent) && r.getAttribute('data-kb-status') === 'active')`, 20000)
  check('and it turns active once the person has agreed at the app', linearTurned !== null, await rows())

  console.log('the quota')
  check('4 of 4: the add button is disabled and says why', (await ev(`document.querySelector('[data-kb="kc-add"]').disabled`)) === true && /4/.test(String(await text('.kbcp-kc'))))
  await shot('04-full')

  console.log('remove')
  const linearId = (await rows()).find((r) => /Linear/.test(r.name)).id
  await hover(`[data-kb-conn="${linearId}"] .kbcp-mname`)
  await ev(`document.querySelector('[data-kb-conn="${linearId}"] .kbcp-macts button[aria-label^="Remove"], [data-kb-conn="${linearId}"] .kbcp-macts button[aria-label^="Retirer"]').click()`)
  await sleep(300)
  check('removing asks first, and says what it means', /Composio/.test(String(await text(`[data-kb-conn="${linearId}"] .kbcp-confirm`))), await text(`[data-kb-conn="${linearId}"] .kbcp-confirm`))
  await shot('05-confirm')
  const delBefore = calls.length
  await ev(`Array.from(document.querySelectorAll('[data-kb-conn="${linearId}"] .kbcp-confirm button')).find((b) => /Remove|Retirer/.test(b.textContent)).click()`)
  const gone = await waitFor(page, `!document.querySelector('[data-kb-conn="${linearId}"]')`, 10000)
  check('the row goes', gone !== null)
  check('the stand-in got one DELETE of that id', calls.slice(delBefore).filter((c) => c.method === 'DELETE' && c.path === '/v1/connections/' + linearId).length === 1)
  check('its place is free again: the add button is back', (await ev(`document.querySelector('[data-kb="kc-add"]').disabled`)) === false)

  console.log('connect an app with an API key')
  await clickJs('[data-kb="kc-add"]')
  await waitFor(page, `!!document.querySelector('[data-kb-app="notion"]')`, 10000)
  await clickJs('[data-kb-app="notion"]')
  await sleep(300)
  check('an app that needs a key asks for it, in a password field the browser does not remember', (await ev(`(() => { const e = document.querySelector('#kbcp-kc-key'); return !!e && e.type === 'password' && e.autocomplete === 'off' })()`)) === true)
  await typeInto('#kbcp-kc-key', KEY)
  const beforeKey = calls.length
  await clickJs('[data-kb="kc-link"]')
  const notion = await waitFor(page, `Array.from(document.querySelectorAll('[data-kb-conn]')).some((r) => /Notion/.test(r.textContent) && r.getAttribute('data-kb-status') === 'active')`, 10000)
  check('the connection is active at once (no tab to go to)', notion !== null, await rows())
  const keyed = calls.slice(beforeKey).filter((c) => c.path === '/v1/connections/link')
  check('the key went to the stand-in once, in the body of the one link call', keyed.length === 1 && keyed[0].body.api_key === KEY && keyed[0].path.indexOf(KEY) < 0 && String(keyed[0].auth).indexOf(KEY) < 0)
  check('...and it is on no later call', calls.slice(beforeKey).filter((c) => c !== keyed[0]).every((c) => c.raw.indexOf(KEY) < 0 && c.path.indexOf(KEY) < 0))
  check('...and nowhere on the page', (await ev(`document.documentElement.outerHTML.indexOf(${JSON.stringify(KEY)}) < 0`)) === true)
  check('...nor in the browser\'s storage', (await ev(`(() => { try { return JSON.stringify(localStorage).indexOf(${JSON.stringify(KEY)}) < 0 && JSON.stringify(sessionStorage).indexOf(${JSON.stringify(KEY)}) < 0 } catch (e) { return false } })()`)) === true)
  await shot('06-notion')

  console.log('a refused add that may have gone through')
  const notionId = (await rows()).find((r) => /Notion/.test(r.name)).id
  await hover(`[data-kb-conn="${notionId}"] .kbcp-mname`)
  await ev(`document.querySelector('[data-kb-conn="${notionId}"] .kbcp-macts button[aria-label^="Remove"], [data-kb-conn="${notionId}"] .kbcp-macts button[aria-label^="Retirer"]').click()`)
  await sleep(200)
  await ev(`Array.from(document.querySelectorAll('[data-kb-conn="${notionId}"] .kbcp-confirm button')).find((b) => /Remove|Retirer/.test(b.textContent)).click()`)
  await waitFor(page, `!document.querySelector('[data-kb-conn="${notionId}"]')`, 10000)
  st.failNextLink = true
  await clickJs('[data-kb="kc-add"]')
  await waitFor(page, `!!document.querySelector('[data-kb-app="gmail"]')`, 10000)
  await clickJs('[data-kb-app="gmail"]')
  await sleep(300)
  const beforeFail = calls.length
  await clickJs('[data-kb="kc-link"]')
  const warned = await waitFor(page, `Array.from(document.querySelectorAll('.kb7-modal [role="alert"]')).some((e) => /list|liste/i.test(e.textContent))`, 10000)
  check('the page tells the person to check the list before trying again', warned !== null)
  check('...and sent that add once only', calls.slice(beforeFail).filter((c) => c.path === '/v1/connections/link').length === 1)
  check('...without showing what the server said in its own words', (await ev(`document.documentElement.innerText.indexOf('SECRET') < 0`)) === true)
  await shot('07-uncertain')
  await clickJs('.kb7-modal .kbcp-kcrow button')
  await sleep(1200)
  check('"check the list" asks the server for the list again', calls.slice(beforeFail).some((c) => c.method === 'GET' && c.path === '/v1/connections?refresh=1'))

  console.log('a connection that is already waiting')
  // a place is free (GitHub goes), and another Slack request is already waiting at the server
  st.conns = st.conns.filter((c) => c.toolkit !== 'github')
  st.conns.push(mk('slack', 'pending'))
  await clickJs('[data-kb="kc-add"]')
  await waitFor(page, `!!document.querySelector('[data-kb-app="slack"]')`, 10000)
  await clickJs('[data-kb-app="slack"]')
  await sleep(300)
  await clickJs('[data-kb="kc-link"]')
  const dup = await waitFor(page, `Array.from(document.querySelectorAll('.kb7-modal [role="alert"]')).some((e) => /Slack/.test(e.textContent) && !!e.querySelector('.kbcp-kcrow button'))`, 10000)
  check('a second Slack request is refused with the existing one named, and the person may cancel that one', dup !== null)
  await shot('08-pending-exists')
  await clickJs('.kb7-modal .kb7-mhead button')

  console.log('the account is not connected')
  rmSync(STATE, { force: true })
  await page.send('Page.reload', {})
  if ((await openPage()) !== true) { check('the page reopens', false); throw new Error('page did not reopen') }
  await waitFor(page, `!!document.querySelector('[data-kb="mode-kybernos"]')`, 10000)
  await clickJs('[data-kb="mode-kybernos"]')
  const signin = await waitFor(page, `!!document.querySelector('[data-kb="kc-signin"]')`, 10000)
  check('the mode is still offered, and asks the person to connect their Kybernos account here', signin !== null)
  await shot('09-signin')
  const callsBefore = calls.length
  await ev(`document.querySelector('[data-kb="kc-signin"] button').click()`)
  const paired = await waitFor(page, `/ABCD-1234/.test(document.body.innerText)`, 10000)
  check('the pairing code is shown while the person approves in the other tab', paired !== null)
  const back = await waitFor(page, `!!document.querySelector('[data-kb-conn]') && !document.querySelector('[data-kb="kc-signin"]')`, 25000)
  check('once approved the connections appear, with no click', back !== null, await rows())
  check('...and the new token is the one used from then on', calls.slice(callsBefore).some((c) => c.path.startsWith('/v1/connections') && c.auth === 'Bearer ' + NEW_TOKEN))

  console.log('the server stops offering connections')
  registry(undefined)
  await page.send('Page.reload', {})
  if ((await openPage()) !== true) { check('the page reopens', false); throw new Error('page did not reopen') }
  await sleep(2500)
  check('no switch, no panel: the page is what it was', !(await exists('[data-kb="mode-kybernos"]')) && !(await exists('.kbcp-kc')))
  const connCalls = () => calls.filter((c) => c.path.startsWith('/v1/connections') || c.path.startsWith('/v1/mcp')).length
  const asked = connCalls()
  await sleep(2500)
  check('and the stand-in is no longer asked about connections', connCalls() === asked, calls.slice(-3))
  await shot('10-not-offered')
} catch (e) {
  console.error('✗ the check crashed: ' + (e && e.stack ? e.stack : e))
  fail += 1
} finally {
  if (live !== null) await live.close()
  stub.close()
  unkeep(SERVERS, bakServers)
  unkeep(STATE, bakState)
}
console.log('\n' + (fail === 0 ? '✓ ' + pass + ' checks, all green' : '✗ ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
