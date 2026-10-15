// The sidebar footer on a REAL page: ONE button (the profile row, or « Sign in / Sign up »), the menu it opens in both states, the links,
// the Upgrade dialog with every state of « Subscribe », and DSH's account popover never showing.
//
//   source scripts/sandbox/env.sh && node scripts/check-footer-live.mjs [--shots /tmp/shots]
//
// Background: the settings seat of DSH's sidebar renders the ACCOUNT launcher (slot `settings.launcher`); its trigger opens a popover
// « Settings / Feedback / Sign in ». The footer used to click that trigger to reach Settings. Now the core plugin owns the seam
// (`window.__kbOpenDshSettings`, plus a capture-phase guard on the launcher) and the footer is ours: packages/kybernos-plugin/client.js
// (<kb-open-settings>) and packages/kybernos-cloud/client.js (CloudFoot, OffMenu, UserMenu, UpgradeDialog).
//
// What is real: the DSH page, the sidebar footer, our menus, DSH's Settings dialog, its account launcher and popover, every click (CDP mouse
// events), and for the not-connected scenes the host's status route. What is answered in the page (nothing leaves the machine, the device
// token is never involved): the cloud status of the connected scenes, the pairing start/poll, the catalogue, the quote, the payment and
// portal calls of the Upgrade dialog (the host routes themselves are proven by packages/kybernos-cloud/test-billing-proxy.mjs), the console
// link, and `window.open` (recorded, never followed).
//
// The embedded console (Team settings, Account, Referral) is checked against REAL servers: small HTTP stand-ins on loopback ports that the
// sandbox's own registry (<DSH home>/kybernos/servers.json, put back at the end) names as the active server, so the address comes from the
// host's route and the frame really loads. The frame's own stand-in page posts the message the real console posts (« open in browser »).
//
// Sandbox only: it refuses :3080 (exit 3). It presses DSH's light/dark switch of the sandbox's own profile and puts it back.
// Exit 0 all good, 1 a check failed, 3 not run.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host.endsWith(':3080')) { console.error('○ not run: this check must run against the sandbox (source scripts/sandbox/env.sh), never the real DSH on :3080'); process.exit(3) }
const DSH_HOME = process.env.DSH_HOME || ''
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '): source scripts/sandbox/env.sh'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const W_PERSONAL = '11111111-1111-4111-8111-111111111111'
const W_TEAM = '22222222-2222-4222-8222-222222222222'
const CLOUD = (active = W_PERSONAL, planKey = 'free') => ({ ok: true, connected: true, state: {
  user: { email: 'dev@example.test', name: 'Dev Person', plan: planKey },
  workspaces: [{ id: W_PERSONAL, name: 'Personal', personal: true, role: 'owner' }, { id: W_TEAM, name: 'Studio', personal: false, role: 'owner' }],
  active_workspace_id: active, space_plan: { key: planKey, label: planKey === 'free' ? 'Free' : 'Plus', workspace_id: active }, web_url: 'https://dev.kybernos.app', device_label: 'This computer' } })
const PAIRING = { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1', expires_at: '2099-01-01T00:00:00Z' } }
const price = (cur, amount, interval) => ({ currency: cur, amount, mode: 'unit', interval })
const PLANS = { ok: true, credits_per_usd: 3680, tax_basis: 'exclusive', plans: [
  { key: 'free', kind: 'free', name: 'Free', currencies: [], intervals: [], components: [{ key: 'free', name: 'Free', features: ['byok'], allowances: [], prices: [] }] },
  { key: 'solo', kind: 'individual', name: 'Individual', currencies: ['EUR', 'USD'], intervals: ['year', 'month'], monthly_premium_pct: 26, components: [
    { key: 'solo', name: 'Plus', display: { usage_multiple: 1 }, features: ['byok', 'connections', 'hosted_runs', 'computers'], allowances: [{ window_seconds: 2592000, member_credits: 18400 }], prices: [price('USD', '19.00', 'year'), price('USD', '24.00', 'month'), price('EUR', '17.00', 'year'), price('EUR', '21.00', 'month')] },
    { key: 'studio', name: 'Pro', display: { usage_multiple: 2.5 }, features: ['byok', 'connections', 'hosted_runs', 'computers', 'computers.always_on'], allowances: [{ window_seconds: 2592000, member_credits: 46000 }], prices: [price('USD', '39.00', 'year'), price('USD', '49.00', 'month'), price('EUR', '35.00', 'year'), price('EUR', '44.00', 'month')] },
  ] },
  { key: 'team', kind: 'team', name: 'Team', currencies: ['EUR', 'USD'], intervals: ['year', 'month'], min_seats: 2, max_seats: 999, components: [
    { key: 'band:0', name: 'Per seat', display: { usage_multiple: 2, label: 'per seat' }, features: ['team.members', 'team.lessons', 'byok'], allowances: [{ window_seconds: 2592000, member_credits: 36800 }], prices: [price('USD', '39.00', 'year'), price('USD', '49.00', 'month'), price('EUR', '35.00', 'year'), price('EUR', '44.00', 'month')] },
  ] },
  { key: 'topup', kind: 'topup', name: 'Top-up', currencies: ['EUR', 'USD'], intervals: [], pack: { grant_usd: '3.75', grant_credits: 13800, min_qty: 1, max_qty: 10, expires_months: 12 }, components: [
    { key: 'pack', name: 'Top-up', features: [], allowances: [], prices: [price('USD', '15.00', 'month'), price('EUR', '14.00', 'month')] },
  ] },
] }
// The phone link's own status route (kybernos-mobile): offered, with two phones already linked, unless a scene says otherwise.
const REMOTE_OFFERED = { ok: true, available: true, running: true, connected: true, configured: true, entitled: true, relay: 'idle', pairing: null, max_devices: 5,
  devices: [{ id: 'd1', label: 'Pixel 9', online: true, state: 'serving' }, { id: 'd2', label: 'iPhone', online: false, state: 'offline' }] }
const fake = { status: null, calls: [], bodies: [], plans: null, plansDelay: 0, checkout: null, portal: null, quote: null, link: null, pairingPending: false, remote: REMOTE_OFFERED }
const body64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')

// A console of its own, on its own loopback port: it counts what is asked of it and, when the frame is clicked, posts the message the real console posts.
const consoles = []
const startConsole = async () => {
  const hits = []
  const srv = createServer((req, res) => {
    hits.push(req.url)
    if (req.url.startsWith('/workspace-console')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>console stand-in</title><body style="margin:0;height:100vh;background:#fff" onclick="parent.postMessage({kbOpenBrowser:{id:\'' + W_PERSONAL + '\'}},\'*\')"><p>console stand-in</p>')
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const c = { origin: 'http://127.0.0.1:' + srv.address().port, hits, server: srv, close: () => new Promise((r) => { try { srv.closeAllConnections() } catch (e) { /* none */ } srv.close(() => r()) }) }
  consoles.push(c)
  return c
}
const REGISTRY = join(DSH_HOME, 'kybernos', 'servers.json')
const registryBefore = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : null
const setRegistry = (active, list) => { mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true }); writeFileSync(REGISTRY, JSON.stringify({ active, servers: list.map((c, i) => ({ id: 'stub-' + (i + 1), name: 'Stand-in ' + (i + 1), api: c.origin })) })) }
const restoreRegistry = () => { try { if (registryBefore === null) rmSync(REGISTRY, { force: true }); else writeFileSync(REGISTRY, registryBefore) } catch (e) { /* the sandbox is throw-away */ } }

const live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 }) }
const centre = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const press = async (sel) => { const c = await centre(sel); if (c === null || c === undefined || c.err !== undefined) return false; await mouse(c.x, c.y); return true }
const exists = async (sel) => (await val(`document.querySelector(${JSON.stringify(sel)}) !== null`)) === true
const text = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : null })()`)
const rect = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`)
const shot = async (name) => { if (shotsAt !== null) await page.shot(join(shotsAt, name + '.png')) }
const opened = async () => (await val('window.__kbOpened || []')) || []

// Any popover of DSH's account launcher that becomes VISIBLE, whatever the scene (recorded in the page, read at the end of each).
const WATCH = `(() => {
  window.__kbNative = []
  window.__kbOpened = []
  window.open = (u) => { window.__kbOpened.push(String(u)); return null }
  const seen = () => {
    for (const m of document.querySelectorAll('[role="menu"]')) {
      if (m.matches('[data-kb="off-menu"], .kbfp-menu, .kbfp-sub')) continue
      const r = m.getBoundingClientRect(); const cs = getComputedStyle(m)
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') window.__kbNative.push((m.innerText || '').replace(/\\s+/g, ' ').slice(0, 80))
    }
  }
  new MutationObserver(seen).observe(document, { childList: true, subtree: true, attributes: true })
})()`
const nativeSeen = async () => (await val('window.__kbNative || []')) || []

const answerFor = (path, req) => {
  const sent = () => { try { return JSON.parse(req.postData || '{}') } catch (e) { return {} } }
  if (path === '/kybernos-cloud/status') {
    if (fake.pairingPending === true) return { body: { ok: true, connected: false, status: 'pending' } }
    return fake.status !== null ? { body: fake.status } : null
  }
  if (path === '/kybernos-cloud/start') { fake.calls.push('start'); return { body: PAIRING } }
  if (path === '/kybernos-cloud/poll') { fake.calls.push('poll'); return { body: { ok: true, connected: false, status: 'pending' } } }
  if (path === '/kybernos-cloud/console/link') { fake.bodies.push({ path, body: sent() }); return { body: fake.link || { ok: true, opened: true, expires_in: 60 } } }
  if (path === '/kybernos-cloud/plans' && fake.plans !== null) return { body: fake.plans, delay: fake.plansDelay }
  if (path === '/kybernos-cloud/plans/quote' && fake.quote !== null) { const u = new URL(req.url); fake.calls.push('quote:' + u.search); return { body: fake.quote(u.searchParams) } }
  if (path === '/kybernos-cloud/billing/checkout' && fake.checkout !== null) { fake.bodies.push({ path, body: sent() }); return { body: typeof fake.checkout === 'function' ? fake.checkout() : fake.checkout } }
  if (path === '/kybernos-cloud/billing/portal' && fake.portal !== null) { fake.bodies.push({ path, body: sent() }); return { body: typeof fake.portal === 'function' ? fake.portal() : fake.portal } }
  if (path === '/kybernos-cloud/refresh') { fake.calls.push('refresh'); return { body: { ok: true } } }
  if (path === '/kybernos-mobile/remote/status' && fake.remote !== null) { fake.calls.push('remote-status'); return { body: fake.remote } }
  return null
}
const interceptor = async () => {
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-cloud/*' }, { urlPattern: '*kybernos-mobile/remote/*' }] })
  page.on('Fetch.requestPaused', (p) => {
    const path = new URL(p.request.url).pathname
    const a = answerFor(path, p.request)
    if (a === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    const go = () => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: body64(a.body) })
    if (a.delay > 0) setTimeout(go, a.delay); else go()
  })
}

// A fresh instance (the sandbox) opens DSH's « Get started » dialog on every load; it swallows every click: closed by its own close button.
const dismissGetStarted = () => val(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /get started/i.test(x.innerText || '')); if (!d) return false; const c = Array.from(d.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); return !!c })()`)
const reload = async () => {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, `document.querySelector('[data-kb="foot-signin"], [data-kb="workspace-card"]') !== null`, 30000)
  await sleep(700)
  for (let i = 0; i < 6; i += 1) { if ((await dismissGetStarted()) === true) break; await sleep(300) }
  await sleep(300)
}
const settingsOpen = async () => (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 6000)) !== null
// The cells of DSH's Settings navigation: the title drawn and the React key each cell is rendered with (the id of its section, the same in every language).
const navCells = async () => (await val(`Array.from(document.querySelectorAll('[class*="navCell"]')).map((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); const key = n === undefined ? null : e[n].key; return { t: (e.textContent || '').trim(), key: typeof key === 'string' ? key : null } })`)) || []
const clean = async () => { await key('Escape', 'Escape'); await sleep(200); await reload() }
const entries = async (menuSel) => (await val(`Array.from(document.querySelectorAll(${JSON.stringify(menuSel)} + ' [data-kb^="menu-"]')).map((e) => e.getAttribute('data-kb').replace('menu-', '')).filter((k) => k.indexOf('block-') !== 0)`)) || []
const openProfileMenu = async () => { await press('[data-kb="workspace-card"] .kbfp-cardmain'); await sleep(450) }
const openUpgrade = async (want = 'upgrade-plan-solo') => {
  await openProfileMenu()
  await press('[data-kb="menu-plan-cta"]')
  if ((await waitFor(page, `document.querySelector('[data-kb="upgrade-dialog"]') !== null`, 4000)) === null) return false
  return (await waitFor(page, `document.querySelector('[data-kb="${want}"], [data-kb="upgrade-load-error"], [data-kb="upgrade-none"]') !== null`, 6000)) !== null
}

let notRun = null
let offCard = null
try {
  await page.send('Runtime.enable', {})
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH })
  await interceptor()
  await reload()

  // ── 1. Signed out: ONE button, its menu ──────────────────────────────────────────────────────────────────────
  console.log('Signed out — one button and its menu')
  const row = await val(`(() => { const b = document.querySelector('[data-kb="foot-signin"]'); const c = document.querySelector('[data-kb="signin-card"]'); return { has: !!b, label: b ? (b.innerText || '').replace(/\\s+/g, ' ').trim() : null, buttons: c ? c.querySelectorAll('button').length : -1, expanded: b ? b.getAttribute('aria-expanded') : null, haspopup: b ? b.getAttribute('aria-haspopup') : null, chev: c ? !!c.querySelector('.kbfp-chev') : false, gear: !!document.querySelector('.kbf-gear') } })()`)
  if (row.has !== true) notRun = 'the signed-out footer is not there (the sandbox is connected to an account?)'
  else {
    check('the footer is ONE button: « Sign in / Sign up », with the chevron', /Sign in \/ Sign up/.test(row.label || '') && row.buttons === 1 && row.chev === true && row.gear === false, row)
    check('it announces a menu, closed', row.haspopup === 'menu' && row.expanded === 'false', row)
    check('DSH\'s own launcher is not drawn (no size, whatever its classes are called)', (await val(`(() => { const l = document.querySelector('[data-slot="settings.launcher"]'); if (!l) return true; return getComputedStyle(l).display === 'none' || Array.from(l.querySelectorAll('button')).every((b) => { const r = b.getBoundingClientRect(); return r.width <= 8 || getComputedStyle(b).visibility === 'hidden' }) })()`)) === true)
    offCard = await rect('[data-kb="signin-card"] .kbfp-card')
    await shot('1-signed-out-row-light')

    check('a real click on the button opens our menu', await press('[data-kb="foot-signin"]') && (await waitFor(page, `document.querySelector('[data-kb="off-menu"]') !== null`, 4000)) !== null)
    const list = await entries('[data-kb="off-menu"]')
    check('the menu: Sign in, Create an account, Appearance, Settings, Website, Help, Send feedback — in that order', JSON.stringify(list) === JSON.stringify(['connect', 'signup', 'appearance', 'settings', 'website', 'help', 'feedback']), list)
    check('no plan row, team, account, referral, remote control or log out', (await val(`!document.querySelector('[data-kb="off-menu"] [data-kb="menu-plan-cta"], [data-kb="off-menu"] [data-kb="menu-switch"], [data-kb="off-menu"] [data-kb="menu-account"], [data-kb="off-menu"] [data-kb="menu-referral"], [data-kb="off-menu"] [data-kb="menu-logout"], [data-kb="off-menu"] [data-kb="menu-space-settings"], [data-kb="off-menu"] [data-kb="menu-remote"]')`)) === true)
    const fits = await val(`(() => { const m = document.querySelector('[data-kb="off-menu"]'); const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`)
    check('it fits the window and the button says it is open', fits === true && (await val(`document.querySelector('[data-kb="foot-signin"]').getAttribute('aria-expanded')`)) === 'true')
    check('no native popover (Settings ⌥⌘, / Feedback / Sign in) is on screen', (await nativeSeen()).length === 0, await nativeSeen())
    await sleep(300)
    await shot('2-signed-out-menu-light')

    await key('Escape', 'Escape'); await sleep(250)
    check('Escape closes it', !(await exists('[data-kb="off-menu"]')))
    await press('[data-kb="foot-signin"]'); await sleep(250)
    await mouse(700, 300); await sleep(250)
    check('a click outside closes it', !(await exists('[data-kb="off-menu"]')))
    await press('[data-kb="foot-signin"]'); await sleep(250)
    await press('[data-kb="foot-signin"]'); await sleep(250)
    check('the button toggles it', !(await exists('[data-kb="off-menu"]')))

    // Links: Website, Help (in DSH's language), Create an account (the server's own account page).
    for (const entry of ['website', 'help', 'signup']) {
      await press('[data-kb="foot-signin"]'); await sleep(300)
      await press('[data-kb="menu-' + entry + '"]'); await sleep(200)
    }
    const server = await val(`fetch('/kybernos-cloud/server').then((r) => r.json()).then((j) => (j.server && (j.server.web || j.server.api)) || null)`)
    const o = await opened()
    check('Website opens the constant https://kybernos.app', o[0] === 'https://kybernos.app', o)
    check('Help opens https://help.kybernos.app/<DSH language>/ (English here)', o[1] === 'https://help.kybernos.app/en/', o)
    check('Create an account opens the server\'s own /account page', typeof server === 'string' && o[2] === server.replace(/\/+$/, '') + '/account', { o, server })

    // The Settings entry reaches DSH's own dialog.
    await press('[data-kb="foot-signin"]'); await sleep(300)
    await press('[data-kb="menu-settings"]')
    check('the Settings entry opens DSH\'s Settings (its navigation is there)', await settingsOpen())
    check('and closes our menu', !(await exists('[data-kb="off-menu"]')))
    check('no native popover appeared on the way', (await nativeSeen()).length === 0, await nativeSeen())
    await shot('3-settings-from-menu')
    await clean()

    // ── 2. What the other plugins do: click the old trigger from a script ───────────────────────────────────
    console.log('A script clicks DSH\'s account launcher (what language, sessions, call and the onboarding did)')
    await val(`(() => { const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]') || document.querySelector('[data-slot="settings.launcher"] button'); if (b) b.click() })()`)
    check('Settings opens, not the account popover', await settingsOpen())
    check('the popover never showed', (await nativeSeen()).length === 0, await nativeSeen())
    await clean()

    // ── 3. A real click on the launcher, were it shown (a shell that renamed its classes) ───────────────────
    console.log('A real click on DSH\'s account launcher (its hiding failed)')
    await val(`(() => { const s = document.createElement('style'); s.id = 'kb-show-launcher'; s.textContent = '[data-slot="settings.launcher"]{display:block !important} [class*="settingsArea"]{width:auto !important;height:auto !important;visibility:visible !important;pointer-events:auto !important;overflow:visible !important} [data-slot="settings.launcher"] button{visibility:visible !important;pointer-events:auto !important;width:80px !important;height:32px !important}'; document.head.appendChild(s) })()`)
    await sleep(300)
    const shown = await centre('[data-slot="settings.launcher"] button')
    check('(the launcher is forced visible for this scene)', shown !== null && shown !== undefined, shown)
    if (shown !== null && shown !== undefined) {
      await mouse(shown.x, shown.y)
      check('the click lands in OUR menu', (await waitFor(page, `document.querySelector('[data-kb="off-menu"]') !== null`, 4000)) !== null)
      check('and DSH\'s popover does not open', (await nativeSeen()).length === 0, await nativeSeen())
    }
    await clean()

    // ── 4. The React seam lost: the popover route, kept invisible ───────────────────────────────────────────
    console.log('React\'s fiber fields unreadable: the fallback')
    await val(`(() => { window.__kbKeys = Object.keys; Object.keys = (o) => window.__kbKeys(o).filter((k) => k.indexOf('__reactFiber$') !== 0) })()`)
    await val(`window.__kbOpenDshSettings()`)
    check('Settings still opens', await settingsOpen())
    await val(`Object.keys = window.__kbKeys`)
    check('the popover it went through was never visible', (await nativeSeen()).length === 0, await nativeSeen())
    await clean()

    // ── 5. Connect: our flow, from the button's menu ────────────────────────────────────────────────────────
    console.log('Connect — the device-code card, ours')
    await press('[data-kb="foot-signin"]'); await sleep(300)
    await press('[data-kb="menu-connect"]')
    const card = await waitFor(page, `document.body.innerText.indexOf('KB4-7QX2') !== -1 ? 'KB4-7QX2' : null`, 8000)
    check('« Sign in » of the menu shows OUR pairing code', card === 'KB4-7QX2', card)
    check('it asked the host to start the pairing', fake.calls.includes('start'), fake.calls)
    await shot('4-pairing-card')
    // While a pairing waits the same button says so, and its menu leads back to the code.
    await key('Escape', 'Escape'); await sleep(300)
    fake.pairingPending = true
    await reload()
    check('while a pairing waits the button says so (same button, same place)', /Pairing in progress/.test((await text('[data-kb="foot-signin"]')) || ''), await text('[data-kb="foot-signin"]'))
    await press('[data-kb="foot-signin"]'); await sleep(300)
    check('and its first entry brings the code back', /Show code/.test((await text('[data-kb="menu-connect"]')) || ''), await text('[data-kb="menu-connect"]'))
    fake.pairingPending = false
    await clean()

    // ── 6. Appearance, both schemes, and back ───────────────────────────────────────────────────────────────
    console.log('Appearance')
    const scheme = async () => (await val(`document.documentElement.getAttribute('data-kb-theme')`))
    const before = await scheme()
    await press('[data-kb="foot-signin"]'); await sleep(300)
    const other = before === 'dark' ? 'Light' : 'Dark'
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${other}"]'); if (b) b.click() })()`)
    await sleep(700)
    check('the sun/moon segment switches the scheme and leaves the menu open', (await scheme()) === other.toLowerCase() && (await exists('[data-kb="off-menu"]')), { before, now: await scheme() })
    await sleep(300)
    await shot('5-signed-out-menu-' + other.toLowerCase())
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${before === 'dark' ? 'Dark' : 'Light'}"]'); if (b) b.click() })()`)
    await sleep(700)
    check('and puts the scheme back', (await scheme()) === before, { before, now: await scheme() })
    await clean()
  }

  // ── 7. Connected: the profile row, the menu, the links, Team settings ──────────────────────────────────────────
  if (notRun === null) {
    console.log('Connected — the profile row and its menu')
    fake.status = CLOUD(W_PERSONAL)
    fake.server = { ok: true, server: { name: 'Active server', api: 'http://active.example.test', web: 'http://active.example.test', console: 'http://active.example.test/workspace-console' }, servers: [] }
    await reload()
    check('the profile row replaces the button, with the same chevron', (await val(`document.querySelector('[data-kb="workspace-card"]') !== null && document.querySelector('[data-kb="foot-signin"]') === null && !!document.querySelector('[data-kb="workspace-card"] .kbfp-chev')`)) === true)
    const profile = await rect('[data-kb="workspace-card"] .kbfp-card')
    check('the signed-out button is the profile row\'s place and size (same left edge, same width, same bottom, same height)', offCard !== null && profile !== null && offCard.x === profile.x && offCard.w === profile.w && offCard.y + offCard.h === profile.y + profile.h && Math.abs(offCard.h - profile.h) <= 4, { offCard, profile })
    await shot('6-connected-row')
    await openProfileMenu()
    const list = await entries('.kbfp-menu')
    check('the menu keeps its skeleton: header, plan, Team settings, Account, Referral, Remote control, Appearance, Settings, Website, Help, Feedback, Log out',
      JSON.stringify(list.filter((k) => k !== 'update')) === JSON.stringify(['switch', 'plan-cta', 'space-settings', 'account', 'referral', 'remote', 'appearance', 'settings', 'website', 'help', 'feedback', 'logout']), list)
    check('the plan row shows « Free » and Upgrade', /Free/.test((await text('.kbfp-mplan')) || '') && (await exists('[data-kb="menu-plan-cta"]')))
    await sleep(300)
    await shot('7-connected-menu')

    // Remote control: the phone link's own panel, from the menu — and the footer's separate phone button is gone.
    check('the footer has no phone button and no bell: the profile row is the card\'s only button (the bell is hidden behind one flag, not deleted)', (await val(`document.querySelectorAll('[data-kb="workspace-card"] .kbfp-card > button').length`)) === 1 && !(await exists('.kbfp-bellwrap')) && !(await exists('[data-kb="workspace-card"] [title="Notifications"]')))
    check('the entry shows how many phones are already linked', /Remote control\s*2/.test((await text('[data-kb="menu-remote"]')) || ''), await text('[data-kb="menu-remote"]'))
    await press('[data-kb="menu-remote"]')
    check('Remote control opens the phone link\'s own panel (kybernos-mobile\'s), and closes the menu', (await waitFor(page, `document.querySelector('[data-kb="mobile-panel"]') !== null`, 5000)) !== null && !(await exists('.kbfp-menu')))
    check('the panel is the bundle\'s (its « Add a phone » button), not the preview', (await waitFor(page, `document.querySelector('[data-kb="mobile-panel"] [data-kb="mobile-pair"], [data-kb="mobile-panel"] [data-kb="mobile-qr"]') !== null`, 5000)) !== null && (await text('.kbf-qrnote')) === null)
    await shot('7b-remote-panel')
    await key('Escape', 'Escape'); await sleep(300)
    // Not offered: the entry is absent, not dead.
    for (const [label, remote] of [
      ['the server does not offer the phone link (configured: false)', Object.assign({}, REMOTE_OFFERED, { configured: false })],
      ['the plan does not include it (entitled: false)', Object.assign({}, REMOTE_OFFERED, { entitled: false })],
      ['this DSH cannot (available: false)', Object.assign({}, REMOTE_OFFERED, { available: false })],
      ['the status cannot be read (a refusal)', { ok: false, error: 'network' }],
    ]) {
      fake.remote = remote
      await reload()
      await openProfileMenu()
      check(label + ': no « Remote control » entry', !(await exists('[data-kb="menu-remote"]')) && (await exists('[data-kb="menu-account"]')), await entries('.kbfp-menu'))
    }
    fake.remote = REMOTE_OFFERED
    await reload()
    await openProfileMenu()

    // Account and Referral are read-only pages of the active server's console, in DSH's content zone (`#account`, `#referral`) — the same frame as Team
    // settings. The registry names a console stand-in as the active server, so the address really comes from the host and the frame really loads.
    console.log('Account, Referral and Team settings — the ACTIVE server\'s console, embedded')
    const A = await startConsole()
    setRegistry('stub-1', [A])
    await reload()
    const frame = async () => val(`(() => { const f = document.querySelector('[data-kb="ws-console"]'); const a = document.querySelector('[data-kb="ws-open-browser"]'); return f ? { kind: 'iframe', url: f.src } : a ? { kind: 'link', url: a.href } : null })()`)
    const frameUrl = async () => { const f = await frame(); return f === null ? null : new URL(f.url) }
    const waitFrame = async () => waitFor(page, `document.querySelector('[data-kb="ws-console"], [data-kb="ws-open-browser"]') !== null`, 8000)
    const openPage = async (entry) => { await openProfileMenu(); await press('[data-kb="menu-' + entry + '"]'); await waitFrame(); await sleep(400) }

    await openPage('space-settings')
    let u = await frameUrl()
    check('Team settings: the frame is the active server\'s console (origin of the registry\'s server, /workspace-console)', u !== null && u.origin === A.origin && u.pathname === '/workspace-console', u && u.href)
    check('with the workspace, the theme and the language, and no page', u !== null && u.searchParams.get('ws') === W_PERSONAL && ['light', 'dark'].indexOf(u.searchParams.get('theme')) >= 0 && u.searchParams.get('lang') === 'en' && u.hash === '', u && u.href)
    check('and the frame really loaded it from that server', A.hits.some((h) => h.startsWith('/workspace-console')), A.hits)
    await shot('13-team-settings-embedded')

    await openPage('account')
    u = await frameUrl()
    check('Account: the same console, on #account, with the same parameters', u !== null && u.origin === A.origin && u.pathname === '/workspace-console' && u.hash === '#account' && u.searchParams.get('ws') === W_PERSONAL && ['light', 'dark'].indexOf(u.searchParams.get('theme')) >= 0 && u.searchParams.get('lang') === 'en', u && u.href)
    check('nothing opened a browser', fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link').length === 0 && (await opened()).length === 0, fake.bodies)
    // The frame's « Open in browser » (its stand-in page posts what the real one posts): the host is asked for the link on the account's overview.
    fake.bodies.length = 0
    const box = await rect('[data-kb="ws-console"]')
    await mouse(box.x + box.w / 2, box.y + box.h / 2); await sleep(700)
    const link = fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
    check('its « Open in browser » asks the host for a console link on section overview, opened by the host', link.length === 1 && link[0].body.section === 'overview' && link[0].body.open === true && link[0].body.workspace_id === W_PERSONAL, link)
    await shot('14-account-embedded')

    await openPage('referral')
    u = await frameUrl()
    check('Referral: #referral', u !== null && u.origin === A.origin && u.hash === '#referral', u && u.href)
    await mouse(box.x + box.w / 2, box.y + box.h / 2); await sleep(700)
    check('and its « Open in browser » is on the overview too', fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link').length === 2 && fake.bodies[fake.bodies.length - 1].body.section === 'overview', fake.bodies)
    await openPage('space-settings')
    u = await frameUrl()
    check('Team settings after Referral is the console\'s first page again', u !== null && u.hash === '' && u.origin === A.origin, u && u.href)
    fake.bodies.length = 0

    // A server that has no #account page yet shows its console, never an error: the frame is the same document, whose own code ignores the fragment.
    // The server's address follows the registry when it changes while the page is up (no reload).
    const B = await startConsole()
    setRegistry('stub-2', [A, B])
    await val(`window.dispatchEvent(new Event('focus'))`)
    await waitFor(page, `(() => { const f = document.querySelector('[data-kb="ws-console"]'); return f !== null && f.src.indexOf(${JSON.stringify(B.origin)}) === 0 })()`, 8000)
    u = await frameUrl()
    check('another server selected while the page is up: the frame follows it (no reload of DSH)', u !== null && u.origin === B.origin, u && u.href)
    check('and loaded from it', B.hits.some((h) => h.startsWith('/workspace-console')), B.hits)

    // The same address is the fallback's: when the console does not answer, « Open in browser » goes to the SAME origin.
    await B.close()
    await reload()
    await openPage('space-settings')
    const down = await frame()
    const du = down === null ? null : new URL(down.url)
    check('a console that does not answer: the card says so and its « Open in browser » link is on the SAME origin', down !== null && down.kind === 'link' && du.origin === B.origin && du.pathname === '/workspace-console', down)
    check('and it names that host', (await text('.kbwsif-down')) !== null && String(await text('.kbwsif-down')).indexOf(new URL(B.origin).host) >= 0, await text('.kbwsif-down'))
    await shot('15-console-down')

    // The registry back on A; a console URL left in localStorage no longer wins, but with the developer flag it does.
    setRegistry('stub-1', [A])
    await val(`localStorage.setItem('kybernos.ws.console.url', 'http://override.example.test/old-test')`)
    await reload()
    await openPage('space-settings')
    u = await frameUrl()
    check('a console URL left in localStorage does not win over the active server', u !== null && u.origin === A.origin, u && u.href)
    await val(`localStorage.setItem('kybernos.dev', '1')`)
    await reload()
    await openPage('space-settings')
    u = await frameUrl()
    check('behind the developer flag the stored override wins again', u !== null && u.origin === 'http://override.example.test', u && u.href)
    await val(`localStorage.removeItem('kybernos.dev'); localStorage.removeItem('kybernos.ws.console.url')`)
    await reload()

    // Without the core plugin's bridge (an older core) Account falls back to the account page in the system browser, through the console link.
    await reload()
    await val(`delete window.__kbOpenWsConsole`)
    fake.bodies.length = 0
    await openProfileMenu()
    await press('[data-kb="menu-account"]'); await sleep(500)
    const acc = fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
    check('no bridge: Account asks the host for a console link on the overview, opened by the host', acc.length === 1 && acc[0].body.section === 'overview' && acc[0].body.open === true && acc[0].body.workspace_id === W_PERSONAL, acc)
    // A refused link says so, in a line above the footer.
    fake.link = { ok: false, status: 403, error: 'email_not_verified' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]'); await sleep(600)
    check('a refused link (e-mail not confirmed) is said above the footer', /Confirm your e-mail/.test((await text('[data-kb="foot-flash"]')) || ''), await text('[data-kb="foot-flash"]'))
    fake.link = { ok: false, status: 0, error: 'injoignable' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]'); await sleep(600)
    check('a server that does not answer is said too', /could not be opened/.test((await text('[data-kb="foot-flash"]')) || ''), await text('[data-kb="foot-flash"]'))
    fake.link = { ok: true, opened: false, url: 'https://active.example.test/api/auth/magic-link/verify?token=x' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]'); await sleep(600)
    check('a host that could not open a browser hands the address back, and the page opens it', (await opened()).includes('https://active.example.test/api/auth/magic-link/verify?token=x'), await opened())
    fake.link = null
    await reload()

    // Website, Help and the others are unchanged.
    await openProfileMenu()
    await press('[data-kb="menu-website"]'); await sleep(200)
    await openProfileMenu()
    await press('[data-kb="menu-help"]'); await sleep(200)
    const o = await opened()
    check('Website and Help are the same links as signed out', o[o.length - 2] === 'https://kybernos.app' && o[o.length - 1] === 'https://help.kybernos.app/en/', o)
    fake.link = null

    // Settings and Appearance are unchanged.
    await openProfileMenu()
    check('Appearance is still the sun/moon segment', (await val(`document.querySelectorAll('.kbfp-menu [data-kb="menu-appearance"] .kbfp-seg button').length`)) === 2)
    await press('[data-kb="menu-settings"]')
    check('Settings opens DSH\'s Settings, with no native popover', (await settingsOpen()) && (await nativeSeen()).length === 0, await nativeSeen())

    // The five account entries of ours (Account, Referral, Account security, Account data, Support & legal) are not in DSH's Settings any more: the
    // account's pages are the footer menu's embedded ones. Matched by the React key a cell is rendered with (not by its title: DSH has an Account
    // section of its own), and by title for the four that have no namesake in DSH.
    console.log('DSH\'s Settings does not list the five account entries of ours')
    const cells = await navCells()
    const REMOVED = ['kybernos-account', 'kbac-referral', 'kbac-security', 'kybernos-data', 'kbac-support']
    check('the navigation is drawn (more than three cells)', cells.length > 3, cells)
    check('no cell is rendered with the key of a removed section', !cells.some((c) => REMOVED.includes(c.key)), cells.filter((c) => REMOVED.includes(c.key)))
    check('none is titled Referral, Account security, Account data or Support & legal', !cells.some((c) => /^(referral|account security|account data|support (&|and|&amp;) legal)$/i.test(c.t)), cells.map((c) => c.t))
    check('DSH\'s own entries and the other bundles\' are still listed (General, Appearance, Remote Control)',
      cells.some((c) => c.key === 'general') && cells.some((c) => c.key === 'kbac-appearance') && cells.some((c) => c.key === 'kybernos-mobile'), cells.map((c) => c.key))
    await shot('11-settings-without-account-entries')
    // Each of the remaining ones still opens: pick General and Remote Control by key and read the page that comes up.
    const openCell = async (cellKey) => {
      await val(`(() => { const c = Array.from(document.querySelectorAll('[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n !== undefined && e[n].key === ${JSON.stringify(cellKey)} }); if (c) c.click() })()`)
      await sleep(700)
      return (await val(`(document.querySelector('[data-slot="settings.section"]') || document.querySelector('[class*="settingsContent"]') || { innerText: '' }).innerText`)) || ''
    }
    const general = await openCell('general')
    check('General still opens', general.length > 20, general.slice(0, 120))
    const remote = await openCell('kybernos-mobile')
    check('Remote Control still opens, with its own page', /remote control|phone/i.test(remote) && remote.length > 20, remote.slice(0, 160))
    const appearance = await openCell('kbac-appearance')
    check('Appearance still opens (the shortcut to Theme)', /theme|appearance/i.test(appearance), appearance.slice(0, 160))
    await clean()

    // ── 8. The Upgrade dialog ─────────────────────────────────────────────────────────────────────────────────
    console.log('Upgrade — the pricing table and Subscribe')
    fake.plans = PLANS
    fake.quote = (q) => ({ ok: true, quote: { currency: q.get('currency'), interval: q.get('interval'), total: String(Number(q.get('quantity')) * (q.get('interval') === 'year' ? 468 : 49)) + '.00', monthly_total: String(Number(q.get('quantity')) * 39) + '.00', tax_basis: 'exclusive', lines: [] } })

    fake.plansDelay = 1500
    const before = (await opened()).length
    await openProfileMenu()
    await press('[data-kb="menu-plan-cta"]')
    check('the Upgrade button opens a dialog of ours', (await waitFor(page, `document.querySelector('[data-kb="upgrade-dialog"]') !== null`, 4000)) !== null && (await opened()).length === before)
    check('while the catalogue loads it says so', await exists('[data-kb="upgrade-loading"]'))
    await waitFor(page, `document.querySelector('[data-kb="upgrade-plan-solo"]') !== null`, 6000)
    fake.plansDelay = 0
    const cards = await val(`Array.from(document.querySelectorAll('[data-kb^="upgrade-plan-"]')).map((e) => e.getAttribute('data-kb').replace('upgrade-plan-', ''))`)
    check('a personal workspace sees the individual levels, from the server\'s catalogue', JSON.stringify(cards) === JSON.stringify(['solo', 'studio']), cards)
    const plus = (await text('[data-kb="upgrade-plan-solo"]')) || ''
    check('a level shows its price per month, how it is billed, its usage and its credits', /Plus/.test(plus) && /\$19/.test(plus) && /billed yearly/.test(plus) && /Usage ×1/.test(plus) && /18,400 credits/.test(plus), plus)
    check('the yearly/monthly switch and the currency switch are there; the dialog says prices exclude tax', (await exists('[data-kb="upgrade-interval"]')) && (await exists('[data-kb="upgrade-currency"]')) && /exclude tax/.test((await text('[data-kb="upgrade-dialog"]')) || ''))
    await shot('8-upgrade-dialog')
    await val(`(() => { const b = document.querySelector('[data-kb="upgrade-interval"] button:not(.on)'); if (b) b.click() })()`)
    await sleep(300)
    check('monthly switches the prices (and does not pretend to be yearly)', /\$24/.test((await text('[data-kb="upgrade-plan-solo"]')) || '') && /billed monthly/.test((await text('[data-kb="upgrade-plan-solo"]')) || ''))
    await val(`(() => { const b = document.querySelector('[data-kb="upgrade-interval"] button:not(.on)'); if (b) b.click() })()`)

    // Subscribe: success
    fake.checkout = { ok: true, opened: true }
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-studio"]'); await sleep(600)
    const sub = fake.bodies.filter((b) => b.path === '/kybernos-cloud/billing/checkout')
    check('Subscribe asks the host for that level\'s checkout, for the active workspace, in the system browser', sub.length === 1 && sub[0].body.plan === 'solo' && sub[0].body.component === 'studio' && sub[0].body.quantity === 1 && sub[0].body.interval === 'year' && sub[0].body.currency === 'USD' && sub[0].body.workspace_id === W_PERSONAL && sub[0].body.open === true, sub)
    check('the dialog says the payment page is open, and offers to refresh the plan', (await exists('[data-kb="upgrade-opened"]')) && (await exists('[data-kb="upgrade-refresh"]')))
    check('no token anywhere in what the page sent', JSON.stringify(sub).indexOf('kys-') < 0)
    await shot('9-upgrade-opened')
    fake.calls.length = 0
    await press('[data-kb="upgrade-refresh"]'); await sleep(700)
    check('« I have paid » reads the account again and closes the dialog', fake.calls.includes('refresh') && !(await exists('[data-kb="upgrade-dialog"]')), fake.calls)

    // Subscribe: every refusal says what happened and what to do.
    const refuse = async (status, code, say, re, buttons) => {
      fake.checkout = { ok: false, status, error: code }
      await openUpgrade()
      await press('[data-kb="upgrade-subscribe-solo"]'); await sleep(500)
      const err = await text('[data-kb="upgrade-error"]')
      const portal = await exists('[data-kb="upgrade-portal"]')
      const retry = await exists('[data-kb="upgrade-retry"]')
      check(status + ' ' + code + ': ' + say, new RegExp(re).test(err || '') && portal === (buttons === 'portal') && retry === (buttons === 'retry'), { err, portal, retry })
    }
    await refuse(501, 'billing_disabled', '« payments are not available on this server », no button', 'not available on this server', 'none')
    check('no payment provider: no Subscribe button can be pressed any more', (await val(`Array.from(document.querySelectorAll('[data-kb^="upgrade-subscribe-"]')).every((b) => b.disabled === true)`)) === true)
    await shot('10-upgrade-501')
    await clean()
    await refuse(403, 'forbidden', 'an owner or admin must do it, no button', 'owner or admin', 'none')
    await clean()
    await refuse(409, 'already_subscribed', 'already subscribed or another currency: the billing portal is offered', 'already has a subscription', 'portal')
    fake.portal = { ok: true, opened: true }
    fake.bodies.length = 0
    await press('[data-kb="upgrade-portal"]'); await sleep(500)
    check('the portal button asks the host for the workspace\'s billing portal, in the system browser', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/portal' && b.body.workspace_id === W_PERSONAL && b.body.open === true), fake.bodies)
    check('and the dialog says it is open', await exists('[data-kb="upgrade-opened"]'))
    await clean()
    await refuse(422, 'interval_not_sold', 'not possible, with a retry', 'not possible', 'retry')
    await clean()
    let n = 0
    fake.checkout = () => { n += 1; return n === 1 ? { ok: false, status: 502, error: 'bad_gateway' } : { ok: true, opened: true } }
    await openUpgrade()
    await press('[data-kb="upgrade-subscribe-solo"]'); await sleep(500)
    check('502: « nothing was charged » and a retry', /Nothing was charged/.test((await text('[data-kb="upgrade-error"]')) || '') && (await exists('[data-kb="upgrade-retry"]')), await text('[data-kb="upgrade-error"]'))
    await press('[data-kb="upgrade-retry"]'); await sleep(500)
    check('the retry goes through', await exists('[data-kb="upgrade-opened"]'))
    await clean()
    fake.checkout = { ok: false, status: 0, error: 'injoignable' }
    await openUpgrade()
    await press('[data-kb="upgrade-subscribe-solo"]'); await sleep(500)
    check('a server that does not answer: said, with a retry', /did not answer/.test((await text('[data-kb="upgrade-error"]')) || '') && (await exists('[data-kb="upgrade-retry"]')), await text('[data-kb="upgrade-error"]'))
    await clean()

    // The catalogue itself failing.
    fake.plans = { ok: false, status: 0, error: 'injoignable' }
    await openUpgrade()
    check('a catalogue that cannot be read says so and offers to try again', (await exists('[data-kb="upgrade-load-error"]')) && /could not be loaded/.test((await text('[data-kb="upgrade-load-error"]')) || ''))
    fake.plans = PLANS
    await press('[data-kb="upgrade-load-error"] button'); await sleep(700)
    check('the retry loads it', await exists('[data-kb="upgrade-plan-solo"]'))
    await key('Escape', 'Escape'); await sleep(300)
    check('Escape closes the dialog', !(await exists('[data-kb="upgrade-dialog"]')))
    await reload()

    // A team workspace buys seats, priced by the server's quote.
    fake.status = CLOUD(W_TEAM)
    await reload()
    check('(a team workspace opens the dialog)', await openUpgrade('upgrade-plan-team'))
    check('it sees the team plan with a seat stepper, not the individual levels', (await exists('[data-kb="upgrade-plan-team"]')) && !(await exists('[data-kb="upgrade-plan-solo"]')))
    await val(`document.querySelector('[data-kb="upgrade-seats-more"]').click()`)
    await val(`document.querySelector('[data-kb="upgrade-seats-more"]').click()`)
    await sleep(900)
    check('the total is the server\'s quote for the seats chosen (graduated prices are never computed here)', /Total\s*\$1,872(\.00)? per year/.test((await text('[data-kb="upgrade-total"]')) || '') && fake.calls.some((c) => /quantity=4/.test(c) && /interval=year/.test(c)), { total: await text('[data-kb="upgrade-total"]'), calls: fake.calls.slice(-3) })
    fake.checkout = { ok: true, opened: true }
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-team"]'); await sleep(500)
    check('Subscribe sends the seats', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout' && b.body.plan === 'team' && b.body.quantity === 4 && b.body.workspace_id === W_TEAM), fake.bodies)
    await shot('11-upgrade-team')
    await clean()

    // Top-up credits are a pack bought once.
    fake.status = CLOUD(W_PERSONAL)
    await reload()
    await openUpgrade()
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-topup"]'); await sleep(500)
    check('top-up credits are bought as packs, with no interval', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout' && b.body.plan === 'topup' && b.body.quantity === 1 && b.body.interval === undefined), fake.bodies)
    check('and no native popover showed in any of these scenes', (await nativeSeen()).length === 0, await nativeSeen())

    // The dialog follows DSH's tokens: once in the other scheme (then put back).
    await clean()
    const schemeNow = async () => val(`document.documentElement.getAttribute('data-kb-theme')`)
    const startScheme = await schemeNow()
    const flip = startScheme === 'dark' ? 'Light' : 'Dark'
    await openProfileMenu()
    await val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${flip}"]'); if (b) b.click() })()`)
    await sleep(600)
    await press('[data-kb="menu-plan-cta"]')
    await waitFor(page, `document.querySelector('[data-kb="upgrade-plan-solo"]') !== null`, 6000)
    await sleep(300)
    await shot('12-upgrade-' + flip.toLowerCase())
    const surface = await val(`(() => { const d = document.querySelector('.kbup'); const cs = getComputedStyle(d); return { bg: cs.backgroundColor, fg: cs.color } })()`)
    check('the dialog is drawn in the DSH scheme (its surface and text colours differ)', surface !== null && surface.bg !== surface.fg, surface)
    await key('Escape', 'Escape'); await sleep(300)
    await openProfileMenu()
    await val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${startScheme === 'dark' ? 'Dark' : 'Light'}"]'); if (b) b.click() })()`)
    await sleep(600)
    check('and the scheme is put back', (await schemeNow()) === startScheme, { startScheme, now: await schemeNow() })
  }
} finally {
  restoreRegistry()
  for (const c of consoles) { try { await c.close() } catch (e) { /* closed */ } }
  await live.close()
}
if (notRun !== null) { console.error('○ not run: ' + notRun); process.exit(3) }
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)
