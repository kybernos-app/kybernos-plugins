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
// The menu's Team settings, Account and Referral open the APP in the browser (the console link, section plan / overview, asked of the host which opens the
// system browser): no frame. The read-only copy of the account pages that DSH used to draw (an iframe of the server's console, with a relay and a key hand-off)
// is gone from the core too, and so are its scenes here (docs/dev/frame-removal.md).
//
// The menus are also driven with the KEYBOARD ONLY (audit A1-29): Enter opens one with the focus on its first item, the arrows walk it round the ends, Home / End jump, Escape and
// Tab close it and give the focus back to the button that opened it. The keys are real key events (CDP Input.dispatchKeyEvent), nothing is focused by the page after the first focus.
//
// « Upgrade » (audit V-40): the menu has an entry for a plan that has something above it (not Free, which keeps its pill and the dialog; not the top level, not a paid
// Team plan; where the page can open) that asks the host for the console link on the PLAN page, like Team settings; signed out, « See plans » opens the server's own
// `/account#plan`. A server that does not answer (audit V-41) is NAMED in the footer's notice and in the phone link's panel, with « Switch server » (Settings › Servers).
// Everything these scenes press is answered in the page (the console link, the pairing, the catalogue): nothing reaches the sandbox's host or a server.
//
// Sandbox only: it refuses :3080 (exit 3). It presses DSH's light/dark switch of the sandbox's own profile and puts it back.
// Exit 0 all good, 1 a check failed, 3 not run.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, openAdvancedFold } from './live-page.mjs'

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
const CLOUD = (active = W_PERSONAL, planKey = 'free', level = null) => ({ ok: true, connected: true, state: {
  user: { email: 'dev@example.test', name: 'Dev Person', plan: planKey },
  workspaces: [{ id: W_PERSONAL, name: 'Personal', personal: true, role: 'owner' }, { id: W_TEAM, name: 'Studio', personal: false, role: 'owner' }],
  active_workspace_id: active, space_plan: { key: planKey, label: planKey === 'free' ? 'Free' : (level !== null ? level : 'Plus'), ...(level !== null ? { level } : {}), workspace_id: active }, web_url: 'https://dev.kybernos.app', device_label: 'This computer' } })
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
const fake = { status: null, calls: [], bodies: [], pair: null, plans: null, plansDelay: 0, checkout: null, portal: null, quote: null, link: null, pairingPending: false, start: null, remote: REMOTE_OFFERED, sync: null, push: null }
const body64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')

const agentsBefore = existsSync(join(DSH_HOME, 'AGENTS.md')) ? readFileSync(join(DSH_HOME, 'AGENTS.md'), 'utf8') : null

const live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 }) }
const centre = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
// Waiting is by event, never by a fixed delay: a busy machine only makes a step take longer. `until` polls a condition every 40 ms and gives its last value
// when the time is up (the check that reads the result then fails, with the state it saw). `press` waits for its target to exist AND to hold still (a menu
// slides in), then clicks it for real.
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(40) } }
const press = async (sel, ms = 3000) => {
  let last = null
  const c = await until(async () => {
    const r = await centre(sel)
    if (r === null || r === undefined || r.err !== undefined) { last = null; return null }
    const still = last !== null && last.x === r.x && last.y === r.y
    last = r
    return still ? r : null
  }, ms)
  if (!c) return false
  await mouse(c.x, c.y)
  return true
}
// A click from the page itself (a button that may sit below the fold of a long Settings page).
const jsClick = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) { e.scrollIntoView({ block: 'center' }); e.click() } })()`)
// The same, once the button is there and enabled (a section that is busy with one action ignores the next click: wait for it to be free).
const jsClickReady = async (sel) => { await until(() => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.disabled })()`), 6000); return jsClick(sel) }
const exists = async (sel) => (await val(`document.querySelector(${JSON.stringify(sel)}) !== null`)) === true
const text = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : null })()`)
const rect = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`)
const shot = async (name) => { if (shotsAt !== null) await page.shot(join(shotsAt, name + '.png')) }
const opened = async () => (await val('window.__kbOpened || []')) || []
const openedCount = async () => (await opened()).length
const gone = (sel) => async () => !(await exists(sel))
const linkAsks = () => fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
// Two frames and a beat: whatever a click set going has been drawn (used after an event was seen, to catch a duplicate that would follow it).
const settle = () => val(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80))))`)

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
  if (path === '/kybernos-cloud/start') { fake.calls.push('start'); return { body: fake.start !== null ? fake.start : PAIRING } }
  if (path === '/kybernos-cloud/poll') { fake.calls.push('poll'); return { body: { ok: true, connected: false, status: 'pending' } } }
  if (path === '/kybernos-cloud/console/link') { fake.bodies.push({ path, body: sent() }); return { body: fake.link || { ok: true, opened: true, expires_in: 60 } } }
  // The catalogue is always answered here (the account menu reads it to know whether a plan is the top one): « cannot be read » unless a scene sets it. The routes that
  // pay or sign someone in never reach the sandbox's host: with no answer set they say « no payment provider ».
  if (path === '/kybernos-cloud/plans') fake.calls.push('plans')
  if (path === '/kybernos-cloud/plans') return { body: fake.plans !== null ? fake.plans : { ok: false, status: 0, error: 'injoignable' }, delay: fake.plans !== null ? fake.plansDelay : 0 }
  if (path === '/kybernos-cloud/billing/checkout' || path === '/kybernos-cloud/billing/portal') {
    const set = path.endsWith('checkout') ? fake.checkout : fake.portal
    fake.bodies.push({ path, body: sent() })
    return { body: set === null ? { ok: false, status: 501, error: 'billing_disabled' } : (typeof set === 'function' ? set() : set) }
  }
  if (path === '/kybernos-cloud/plans/quote' && fake.quote !== null) { const u = new URL(req.url); fake.calls.push('quote:' + u.search); return { body: fake.quote(u.searchParams) } }
  if (path === '/kybernos-cloud/refresh') { fake.calls.push('refresh'); return { body: { ok: true } } }
  if (path === '/kybernos-cloud/models/sync' && fake.sync !== null) { fake.calls.push('models-sync'); return { body: fake.sync } }
  if (path === '/kybernos-cloud/chats/push' && fake.push !== null) { fake.calls.push('chats-push'); return { body: fake.push } }
  if (path === '/kybernos-mobile/remote/status' && fake.remote !== null) { fake.calls.push('remote-status'); return { body: fake.remote } }
  // The phone link's gestures (a code, an approval, a revoke) are the page's to ask and never the host's to do here: answered, refused unless a scene says otherwise.
  if (path.startsWith('/kybernos-mobile/remote/') && req.method === 'POST') { fake.calls.push('remote:' + path.slice('/kybernos-mobile/remote/'.length)); return { body: path.endsWith('/pair') && fake.pair !== null ? fake.pair : { ok: false, error: 'not_connected' } } }
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
  // The old document carries a mark the new one does not: the footer found afterwards is the reloaded page's, never the old one's.
  await val('window.__kbStale = true')
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-kb="foot-signin"], [data-kb="workspace-card"]') !== null`, 30000)
  await dismissGetStarted() // live-page's own observer presses it whenever it shows up; this is the second hand
  await settle()
}
// The section draws its three blocks at once and fills them when the host has answered (the note says « Loading… » until then).
const kySectionLoaded = () => waitFor(page, `['ky-section', 'ky-instructions', 'ky-models', 'ky-advanced', 'ky-instr-field'].every((k) => document.querySelector('[data-kb="' + k + '"]') !== null) && !/Loading/.test((document.querySelector('[data-kb="ky-instr-note"]') || { innerText: 'Loading' }).innerText)`, 8000)
// The core's seam is installed a moment after the page (longer on a busy machine): wait for it, call it, and call it again if the dialog did not come.
const openDshSettings = async () => {
  for (let i = 0; i < 3; i += 1) {
    await until(() => val(`typeof window.__kbOpenDshSettings === 'function'`), 10000)
    await val(`window.__kbOpenDshSettings()`)
    if (await settingsOpen()) return true
  }
  return false
}
const settingsOpen = async () => (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 6000)) !== null
// The cells of DSH's Settings navigation: the title drawn and the React key each cell is rendered with (the id of its section, the same in every language).
const navCells = async () => (await val(`Array.from(document.querySelectorAll('[class*="navCell"]')).map((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); const key = n === undefined ? null : e[n].key; return { t: (e.textContent || '').trim(), key: typeof key === 'string' ? key : null } })`)) || []
const clean = async () => { await key('Escape', 'Escape'); await reload() }
const entriesNow = async (menuSel) => (await val(`Array.from(document.querySelectorAll(${JSON.stringify(menuSel)} + ' [data-kb^="menu-"]')).map((e) => e.getAttribute('data-kb').replace('menu-', '')).filter((k) => k.indexOf('block-') !== 0)`)) || []
// The entries of a menu, once the menu has stopped changing: an entry that depends on an answer (the plans, the remote link) is drawn a moment after the menu opens, and a busy machine
// makes that moment longer. Two reads 150 ms apart that agree (and are not empty) are the menu; after 4 s the last read is what the check reports.
const entries = async (menuSel) => {
  let last = await entriesNow(menuSel)
  const end = Date.now() + 4000
  while (Date.now() < end) {
    await sleep(150)
    const again = await entriesNow(menuSel)
    if (again.length > 0 && JSON.stringify(again) === JSON.stringify(last)) return again
    last = again
  }
  return last
}
const openProfileMenu = async () => { await press('[data-kb="workspace-card"] .kbfp-cardmain'); await until(() => exists('.kbfp-menu'), 4000) }
const closeProfileMenu = async () => { await press('[data-kb="workspace-card"] .kbfp-cardmain'); await until(gone('.kbfp-menu'), 4000) }
// A real key press: the keys of a menu are named keys, not text (Enter alone carries its character, the one a button is activated by).
const KEY_CODES = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 }
const pressKey = async (k) => {
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: k === 'Enter' ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KEY_CODES[k] }, k === 'Enter' ? { text: '\r' } : {}))
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEY_CODES[k] })
  await settle() // two frames and a beat: what the key set going has been drawn (focus moved, menu closed)
}
/** The menu with the keyboard only. `trigger` is the button that opens it, `menu` the menu's own selector. */
const keyboardMenu = async (label, trigger, menu) => {
  const spot = () => val(`(() => { const m = document.querySelector(${JSON.stringify(menu)}); const a = document.activeElement; if (!a || a === document.body) return { at: null, n: m ? m.querySelectorAll('button:not(:disabled)').length : 0 }; const items = m ? Array.from(m.querySelectorAll('button:not(:disabled)')) : []; return { at: m ? items.indexOf(a) : -1, n: items.length, trigger: a.matches(${JSON.stringify(trigger)}), open: !!m } })()`)
  await val(`document.querySelector(${JSON.stringify(trigger)}).focus()`)
  await pressKey('Enter')
  await waitFor(page, `document.querySelector(${JSON.stringify(menu)}) !== null`, 4000)
  await until(async () => (await spot()).at !== null, 3000) // the focus enters the menu a moment after it is drawn
  let s = await spot()
  check(label + ': Enter on the focused button opens the menu and the focus enters it, on its first item', s.open === true && s.at === 0 && s.n >= 6, s)
  const n = s.n
  await pressKey('ArrowDown'); s = await spot()
  check(label + ': ArrowDown moves to the second item', s.at === 1, s)
  await pressKey('End'); s = await spot()
  check(label + ': End goes to the last item', s.at === n - 1, s)
  await pressKey('ArrowDown'); s = await spot()
  check(label + ': ArrowDown on the last item wraps to the first', s.at === 0, s)
  await pressKey('ArrowUp'); s = await spot()
  check(label + ': ArrowUp on the first item wraps to the last', s.at === n - 1, s)
  await pressKey('Home'); s = await spot()
  check(label + ': Home goes to the first item', s.at === 0, s)
  await pressKey('Escape'); await until(gone(menu), 3000)
  s = await spot()
  check(label + ': Escape closes the menu and the focus is back on the button', s.open !== true && s.trigger === true && !(await exists(menu)), s)
  await pressKey('Enter'); await waitFor(page, `document.querySelector(${JSON.stringify(menu)}) !== null`, 4000); await until(async () => (await spot()).at !== null, 3000)
  await pressKey('Tab'); await until(gone(menu), 3000)
  s = await spot()
  check(label + ': Tab closes the menu too and the focus is back on the button (not left on the page behind)', s.open !== true && s.trigger === true && !(await exists(menu)), s)
}
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
    check('the menu: Sign in, Create an account, See plans, Appearance, Settings, Website, Help, Send feedback — in that order', JSON.stringify(list) === JSON.stringify(['connect', 'signup', 'plans', 'appearance', 'settings', 'website', 'help', 'feedback']), list)
    check('no plan row, team, account, referral, remote control or log out', (await val(`!document.querySelector('[data-kb="off-menu"] [data-kb="menu-plan-cta"], [data-kb="off-menu"] [data-kb="menu-switch"], [data-kb="off-menu"] [data-kb="menu-account"], [data-kb="off-menu"] [data-kb="menu-referral"], [data-kb="off-menu"] [data-kb="menu-logout"], [data-kb="off-menu"] [data-kb="menu-space-settings"], [data-kb="off-menu"] [data-kb="menu-remote"]')`)) === true)
    const fits = await val(`(() => { const m = document.querySelector('[data-kb="off-menu"]'); const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`)
    check('it fits the window and the button says it is open', fits === true && (await val(`document.querySelector('[data-kb="foot-signin"]').getAttribute('aria-expanded')`)) === 'true')
    check('no native popover (Settings ⌥⌘, / Feedback / Sign in) is on screen', (await nativeSeen()).length === 0, await nativeSeen())
    await sleep(300)
    await shot('2-signed-out-menu-light')

    await key('Escape', 'Escape'); await until(gone('[data-kb="off-menu"]'), 3000)
    check('Escape closes it', !(await exists('[data-kb="off-menu"]')))
    await press('[data-kb="foot-signin"]'); await until(() => exists('[data-kb="off-menu"]'), 4000)
    await mouse(700, 300); await until(gone('[data-kb="off-menu"]'), 3000)
    check('a click outside closes it', !(await exists('[data-kb="off-menu"]')))
    await press('[data-kb="foot-signin"]'); await until(() => exists('[data-kb="off-menu"]'), 4000)
    await press('[data-kb="foot-signin"]'); await until(gone('[data-kb="off-menu"]'), 3000)
    check('the button toggles it', !(await exists('[data-kb="off-menu"]')))
    await keyboardMenu('Signed out', '[data-kb="foot-signin"]', '[data-kb="off-menu"]')

    // Links: Website, Help (in DSH's language), Create an account (the server's own account page).
    for (const entry of ['website', 'help', 'signup', 'plans']) {
      const n = await openedCount()
      // The menu is shut before it is opened (a press on the button while the previous menu is still going away would close it again and lose the entry's click),
      // and the entry is pressed again if the page recorded no window.open for it (three tries): the record is what the checks below read.
      for (let attempt = 0; attempt < 3 && (await openedCount()) <= n; attempt += 1) {
        await until(gone('[data-kb="off-menu"]'), 3000)
        await press('[data-kb="foot-signin"]')
        await until(() => exists('[data-kb="menu-' + entry + '"]'), 4000)
        await press('[data-kb="menu-' + entry + '"]')
        await until(async () => (await openedCount()) > n, 5000) // window.open is recorded in the page: wait for THIS click's record
      }
    }
    const server = await val(`fetch('/kybernos-cloud/server').then((r) => r.json()).then((j) => (j.server && (j.server.web || j.server.api)) || null)`)
    const o = await opened()
    check('Website opens the constant https://kybernos.app', o[0] === 'https://kybernos.app', o)
    check('Help opens https://help.kybernos.app/<DSH language>/ (English here)', o[1] === 'https://help.kybernos.app/en/', o)
    check('Create an account opens the server\'s own /account page', typeof server === 'string' && o[2] === server.replace(/\/+$/, '') + '/account', { o, server })
    check('See plans opens the server\'s own plan page (/account#plan: the app signs the person in, then shows the plans)', typeof server === 'string' && o[3] === server.replace(/\/+$/, '') + '/account#plan', { o, server })

    // The Settings entry reaches DSH's own dialog.
    await press('[data-kb="foot-signin"]')
    await press('[data-kb="menu-settings"]')
    check('the Settings entry opens DSH\'s Settings (its navigation is there)', await settingsOpen())
    check('and closes our menu', !(await exists('[data-kb="off-menu"]')))
    check('no native popover appeared on the way', (await nativeSeen()).length === 0, await nativeSeen())
    await shot('3-settings-from-menu')
    // The « Kybernos » section of Settings shows whether connected or not: the instructions need no server, the two other actions say so.
    await val(`(() => { const c = Array.from(document.querySelectorAll('[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n !== undefined && e[n].key === 'kybernos-local' }); if (c) c.click() })()`)
    await kySectionLoaded()
    check('signed out: the Kybernos section opens (instructions, models, a folded Advanced: no Re-import and no Send DSH chats on the page)', (await exists('[data-kb="ky-instructions"]')) && (await exists('[data-kb="ky-models"]')) && (await exists('[data-kb="ky-advanced"]')) && !(await exists('[data-kb="ky-chats"]')) && !(await exists('[data-kb="ky-models-run"]')))
    await jsClick('[data-kb="ky-adv-toggle"]'); await until(() => exists('[data-kb="ky-chats-run"]'), 4000)
    check('signed out: the two actions that need a server say so, and cannot be pressed', (await val(`document.querySelectorAll('[data-kb="ky-signed-out"]').length`)) === 2
      && (await val(`document.querySelector('[data-kb="ky-models-run"]').disabled === true && document.querySelector('[data-kb="ky-chats-run"]').disabled === true`)) === true)
    check('signed out: the instructions field is still usable (it is a file of this computer)', (await val(`document.querySelector('[data-kb="ky-instr-field"]').disabled`)) === false && /on this computer/i.test((await text('[data-kb="ky-instr-note"]')) || ''), await text('[data-kb="ky-instr-note"]'))
    await shot('3b-kybernos-section-signed-out')
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
    await until(() => centre('[data-slot="settings.launcher"] button'), 3000)
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
    await press('[data-kb="foot-signin"]')
    await press('[data-kb="menu-connect"]')
    const card = await waitFor(page, `document.body.innerText.indexOf('KB4-7QX2') !== -1 ? 'KB4-7QX2' : null`, 8000)
    check('« Sign in » of the menu shows OUR pairing code', card === 'KB4-7QX2', card)
    check('it asked the host to start the pairing', fake.calls.includes('start'), fake.calls)
    await shot('4-pairing-card')
    // While a pairing waits the same button says so, and its menu leads back to the code.
    await key('Escape', 'Escape')
    fake.pairingPending = true
    await reload()
    check('while a pairing waits the button says so (same button, same place)', /Pairing in progress/.test((await text('[data-kb="foot-signin"]')) || ''), await text('[data-kb="foot-signin"]'))
    await press('[data-kb="foot-signin"]'); await until(() => exists('[data-kb="menu-connect"]'), 4000)
    check('and its first entry brings the code back', /Show code/.test((await text('[data-kb="menu-connect"]')) || ''), await text('[data-kb="menu-connect"]'))
    fake.pairingPending = false
    await clean()

    // ── 5b. Connect, the server does not answer (R-V-06): the card names it and offers another one ──────────────────────────────────────────────
    console.log('Connect — the server does not answer: named, with « Switch server »')
    fake.start = { ok: false, status: 0, error: 'reseau', server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }
    await press('[data-kb="foot-signin"]')
    await press('[data-kb="menu-connect"]')
    await until(() => exists('[data-kb="card-server-down"]'), 8000)
    const downSaid = (await text('[data-kb="card-server-down"]')) || ''
    check('the sign-in card names the server that does not answer: its label and its host', /“Kybernos \(local\)”/.test(downSaid) && /localhost:8791/.test(downSaid) && /does not answer/.test(downSaid), downSaid)
    check('...with « Switch server » and the way to try again', (await exists('[data-kb="card-switch-server"]')) && /Retry|Try again/i.test((await val(`(document.querySelector('.kbc-card') || { innerText: '' }).innerText`)) || ''), downSaid)
    await shot('r-v-06-signin-server-down')
    await press('[data-kb="card-switch-server"]')
    check('« Switch server » closes the card and opens Settings', (await settingsOpen()) && !(await exists('.kbc-card')))
    await clean()
    fake.start = { ok: false, status: 0, error: 'reseau', server: { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: false } }
    await press('[data-kb="foot-signin"]')
    await press('[data-kb="menu-connect"]')
    await until(() => exists('[data-kb="card-server-down"]'), 8000)
    check('the only server: it is named, and there is nothing to switch to (no action)', /“Kybernos Cloud”/.test((await text('[data-kb="card-server-down"]')) || '') && !(await exists('[data-kb="card-switch-server"]')))
    await clean()
    fake.start = { ok: false, status: 0, error: 'reseau' }
    await press('[data-kb="foot-signin"]')
    await press('[data-kb="menu-connect"]')
    await until(() => exists('.kbc-err'), 8000)
    check('an answer that names no server keeps the card\'s own sentence', /cannot reach the Kybernos server/.test((await val(`(document.querySelector('.kbc-card') || { innerText: '' }).innerText`)) || '') && !(await exists('[data-kb="card-server-down"]')))
    fake.start = null
    await clean()

    // ── 6. Appearance, both schemes, and back ───────────────────────────────────────────────────────────────
    console.log('Appearance')
    const scheme = async () => (await val(`document.documentElement.getAttribute('data-kb-theme')`))
    const before = await scheme()
    await press('[data-kb="foot-signin"]')
    const other = before === 'dark' ? 'Light' : 'Dark'
    await until(() => exists('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="' + other + '"]'), 4000)
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${other}"]'); if (b) b.click() })()`)
    await until(async () => (await scheme()) === other.toLowerCase(), 4000)
    check('the sun/moon segment switches the scheme and leaves the menu open', (await scheme()) === other.toLowerCase() && (await exists('[data-kb="off-menu"]')), { before, now: await scheme() })
    await sleep(300)
    await shot('5-signed-out-menu-' + other.toLowerCase())
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${before === 'dark' ? 'Dark' : 'Light'}"]'); if (b) b.click() })()`)
    await until(async () => (await scheme()) === before, 4000)
    check('and puts the scheme back', (await scheme()) === before, { before, now: await scheme() })
    await clean()
  }

  // ── 7. Connected: the profile row, the menu, the links, Team settings ──────────────────────────────────────────
  if (notRun === null) {
    console.log('Connected — the profile row and its menu')
    fake.status = CLOUD(W_PERSONAL)
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
    await pressKey('Escape'); await until(gone('.kbfp-menu'), 3000)
    await keyboardMenu('Connected', '[data-kb="workspace-card"] .kbfp-cardmain', '.kbfp-menu')
    await openProfileMenu()

    // Remote control: the phone link's own panel, from the menu — and the footer's separate phone button is gone.
    check('the footer has no phone button and no bell: the profile row is the card\'s only button (the bell is hidden behind one flag, not deleted)', (await val(`document.querySelectorAll('[data-kb="workspace-card"] .kbfp-card > button').length`)) === 1 && !(await exists('.kbfp-bellwrap')) && !(await exists('[data-kb="workspace-card"] [title="Notifications"]')))
    check('the entry shows how many phones are already linked', /Remote control\s*2/.test((await text('[data-kb="menu-remote"]')) || ''), await text('[data-kb="menu-remote"]'))
    await press('[data-kb="menu-remote"]')
    check('Remote control opens the phone link\'s own panel (kybernos-mobile\'s), and closes the menu', (await waitFor(page, `document.querySelector('[data-kb="mobile-panel"]') !== null`, 5000)) !== null && !(await exists('.kbfp-menu')))
    check('the panel is the bundle\'s (its « Add a phone » button), not the preview', (await waitFor(page, `document.querySelector('[data-kb="mobile-panel"] [data-kb="mobile-pair"], [data-kb="mobile-panel"] [data-kb="mobile-qr"]') !== null`, 5000)) !== null && (await text('.kbf-qrnote')) === null)
    await shot('7b-remote-panel')
    await key('Escape', 'Escape')
    // Not offered: the entry is absent, not dead.
    for (const [label, remote] of [
      ['the server does not offer the phone link (configured: false)', Object.assign({}, REMOTE_OFFERED, { configured: false })],
      ['the plan does not include it (entitled: false)', Object.assign({}, REMOTE_OFFERED, { entitled: false })],
      ['this DSH cannot (available: false)', Object.assign({}, REMOTE_OFFERED, { available: false })],
      ['the status cannot be read (a refusal)', { ok: false, error: 'network' }],
    ]) {
      fake.remote = remote
      const asked = fake.calls.filter((c) => c === 'remote-status').length
      await reload()
      // The footer reads the phone link's status once it is connected: wait until the page has asked (and drawn the answer), or « no entry » would
      // be true for the wrong reason (not read yet) and the menu could still be changing under the check.
      await until(() => fake.calls.filter((c) => c === 'remote-status').length > asked, 8000)
      await settle()
      await openProfileMenu()
      check(label + ': no « Remote control » entry', !(await exists('[data-kb="menu-remote"]')) && (await exists('[data-kb="menu-account"]')), await entries('.kbfp-menu'))
    }
    fake.remote = REMOTE_OFFERED
    await reload()
    await openProfileMenu()

    // Team settings, Account and Referral open the app in the browser: the host is asked for a single-use console link on the active workspace (section plan,
    // overview, overview) and opens the system browser itself; nothing is drawn in DSH's content zone.
    console.log('Team settings, Account and Referral — the app, in the browser')
    // The menu was left open by the scenes above and a press on the card toggles it: start from a closed one.
    if (await exists('.kbfp-menu')) await closeProfileMenu()
    for (const [entry, section] of [['space-settings', 'plan'], ['account', 'overview'], ['referral', 'overview']]) {
      fake.bodies.length = 0
      await openProfileMenu()
      await press('[data-kb="menu-' + entry + '"]')
      await until(() => linkAsks().length >= 1, 5000)
      await settle()
      const asked = fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
      check(entry + ': asks the host for a console link on section ' + section + ', for the active workspace, opened by the host',
        asked.length === 1 && asked[0].body.section === section && asked[0].body.open === true && asked[0].body.workspace_id === W_PERSONAL, asked)
      check(entry + ': nothing is drawn in DSH\'s content zone and the menu is closed', !(await exists('[data-kb="ws-console"]')) && !(await exists('.kbfp-menu')))
    }
    // The workspace the person switched to is the one asked for.
    fake.status = CLOUD(W_TEAM)
    await reload()
    fake.bodies.length = 0
    await openProfileMenu()
    await press('[data-kb="menu-space-settings"]')
    await until(() => linkAsks().length >= 1, 5000)
    await settle()
    const teamLink = fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
    check('Team settings follows the active workspace (the team the person switched to)', teamLink.length === 1 && teamLink[0].body.workspace_id === W_TEAM && teamLink[0].body.section === 'plan', teamLink)
    fake.status = CLOUD(W_PERSONAL)
    fake.bodies.length = 0
    await reload()
    await openProfileMenu()

    // ── Upgrade (V-40): the plan page of the app, in the browser ───────────────────────────────────────────────────────────────────────────────────────────
    // An entry for a plan that has something above it: Plus is offered it, Pro (the top level) and a paid Team plan are not, Free has its pill (and the dialog).
    // It asks the host for the console link on the PLAN page of the active workspace, like Team settings: nothing is bought, nothing is drawn in DSH.
    console.log('Upgrade — an entry for a plan that has something above it; the plan page, in the browser')
    fake.plans = PLANS
    fake.link = null
    for (const [label, status, wantEntry, wantPill] of [
      ['Free', CLOUD(W_PERSONAL), false, true],
      ['Plus (Pro is above it)', CLOUD(W_PERSONAL, 'solo', 'Plus'), true, false],
      ['Pro (the top level)', CLOUD(W_PERSONAL, 'solo', 'Pro'), false, false],
      ['a paid Team plan', CLOUD(W_TEAM, 'team', '1-5 seats'), false, false],
    ]) {
      fake.status = status
      const planReads = fake.calls.filter((c) => c === 'plans').length
      await reload()
      // The footer reads the catalogue once the account is there; the menu is judged after it was read (and drawn), not before.
      await until(() => fake.calls.filter((c) => c === 'plans').length > planReads, 8000)
      await settle()
      await openProfileMenu()
      const list = (await entries('.kbfp-menu')).filter((k) => k !== 'update')
      const at = list.indexOf('upgrade')
      check(label + ': ' + (wantEntry ? 'the menu has « Upgrade », right after the plan and before Team settings' : 'no « Upgrade » entry'),
        (at >= 0) === wantEntry && (!wantEntry || (at === list.indexOf('switch') + 1 && list.indexOf('space-settings') === at + 1)), list)
      check(label + ': the Free pill is ' + (wantPill ? 'there (it opens the dialog)' : 'not there'), (await exists('[data-kb="menu-plan-cta"]')) === wantPill, list)
      if (wantEntry) { await sleep(300); await shot('v40-upgrade-entry') }
    }
    fake.status = CLOUD(W_PERSONAL, 'solo', 'Plus')
    await reload()
    await openProfileMenu()
    check('the entry says Upgrade and carries the arrow that leaves DSH', /Upgrade/.test((await text('[data-kb="menu-upgrade"]')) || '') && (await exists('[data-kb="menu-upgrade"] .kbfp-mext')), await text('[data-kb="menu-upgrade"]'))
    fake.bodies.length = 0
    const openedBefore = await openedCount()
    await press('[data-kb="menu-upgrade"]')
    await until(() => linkAsks().length >= 1, 5000)
    await settle()
    const upLink = linkAsks()
    check('Upgrade asks the host for a console link on the PLAN page of the active workspace, opened by the host (Team settings\' own mechanism)', upLink.length === 1 && upLink[0].body.section === 'plan' && upLink[0].body.open === true && upLink[0].body.workspace_id === W_PERSONAL, upLink)
    check('it opens no dialog, draws nothing in DSH\'s content zone, closes the menu, and the page opened nothing itself (the host did)', !(await exists('[data-kb="upgrade-dialog"]')) && !(await exists('[data-kb="ws-console"]')) && !(await exists('.kbfp-menu')) && (await openedCount()) === openedBefore)
    check('no payment route was asked: nothing is bought from here', !fake.bodies.some((b) => /billing/.test(b.path)), fake.bodies)
    fake.plans = { ok: false, status: 0, error: 'injoignable' }
    fake.status = CLOUD(W_PERSONAL, 'solo', 'Pro')
    const planReads2 = fake.calls.filter((c) => c === 'plans').length
    await reload()
    await until(() => fake.calls.filter((c) => c === 'plans').length > planReads2, 8000)
    await settle()
    await openProfileMenu()
    check('the catalogue cannot be read: nothing proves Pro is the top, the entry stays', await exists('[data-kb="menu-upgrade"]'))
    fake.plans = PLANS

    // ── A server that does not answer (V-41): the notice names it and offers another ────────────────────────────────────────────────────────────────────
    console.log('A server that does not answer — named, with « Switch server »')
    const settingsText = async () => (await val(`(document.querySelector('[data-slot="settings.section"]') || document.querySelector('[class*="settingsContent"]') || { innerText: '' }).innerText`)) || ''
    const serversCell = async () => (await navCells()).some((c) => c.key === 'kybernos-servers')
    fake.status = CLOUD(W_PERSONAL, 'solo', 'Plus')
    fake.link = { ok: false, status: 0, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }
    await reload()
    await openProfileMenu()
    await press('[data-kb="menu-upgrade"]')
    await until(() => exists('[data-kb="foot-flash"]'), 5000)
    let said = (await text('[data-kb="foot-flash"]')) || ''
    check('the notice names the server that does not answer: its label and its host', /“Kybernos \(local\)”/.test(said) && /localhost:8791/.test(said) && /does not answer/.test(said), said)
    check('and offers « Switch server »', (await exists('[data-kb="foot-switch-server"]')) && /Switch server/.test(said), said)
    await sleep(300)
    await shot('v41-server-down-notice')
    await press('[data-kb="foot-switch-server"]')
    check('« Switch server » opens Settings and takes the notice away', (await settingsOpen()) && !(await exists('[data-kb="foot-flash"]')))
    if (await serversCell()) {
      await until(async () => /where your account/i.test(await settingsText()), 15000)
      check('on the Servers page (Settings › Servers)', /where your account/i.test(await settingsText()), (await settingsText()).slice(0, 120))
      await shot('v41-switch-server-settings')
    } else console.log('  ○ skipped: this sandbox has no Servers module (cell kybernos-servers): the click was checked up to Settings opening')
    await clean()
    fake.link = { ok: false, status: 0, error: 'injoignable', server: { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: false } }
    await openProfileMenu()
    await press('[data-kb="menu-account"]')
    await until(() => exists('[data-kb="foot-flash"]'), 5000)
    said = (await text('[data-kb="foot-flash"]')) || ''
    check('the only server: it is named, and there is nothing to switch to (no action)', /“Kybernos Cloud”/.test(said) && /api\.kybernos\.app/.test(said) && !(await exists('[data-kb="foot-switch-server"]')), said)
    fake.link = null

    // The phone link's panel says the same words, and its « Switch server » closes the panel and asks the footer for Settings › Servers.
    fake.pair = { ok: false, error: 'server_unavailable', server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }
    await reload()
    await openProfileMenu()
    await press('[data-kb="menu-remote"]')
    await until(() => exists('[data-kb="mobile-panel"] [role="alert"]'), 6000)
    said = (await text('[data-kb="mobile-panel"] [role="alert"]')) || ''
    check('Remote control: the panel names the server that does not answer (label, host)', /“Kybernos \(local\)”/.test(said) && /localhost:8791/.test(said) && /does not answer/.test(said) && !/The Kybernos server does not answer/.test(said), said)
    check('and offers « Switch server »', await exists('[data-kb="mobile-switch-server"]'), said)
    await sleep(300)
    await shot('v41-remote-server-down')
    await press('[data-kb="mobile-switch-server"]')
    check('« Switch server » closes the panel and opens Settings', (await settingsOpen()) && !(await exists('[data-kb="mobile-panel"]')))
    if (await serversCell()) {
      await until(async () => /where your account/i.test(await settingsText()), 15000)
      check('on the Servers page', /where your account/i.test(await settingsText()), (await settingsText()).slice(0, 120))
    }
    fake.pair = null
    await clean()

    // ── At 390 px (a phone): the menu with its new entry, the notice, the signed-out menu ───────────────────────────────────────────────────────────────
    console.log('At 390 px')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    // The drawer holds the footer's card, which is drawn when the account answer arrives: a drawer opened before that is redrawn shut (seen on a busy machine, where the
    // three 390 px checks below found no menu). So the card is awaited BEFORE the drawer is opened, and the drawer is opened again (after a reload) when the card is not on screen.
    const CARD_SEL = '[data-kb="workspace-card"] .kbfp-cardmain, [data-kb="signin-card"] .kbfp-cardmain'
    const openDrawer = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await until(() => exists(CARD_SEL), 15000)
        await press('[data-kb="mobile-menu"]')
        if (await until(async () => { const r = await rect(CARD_SEL); return r !== null && r !== undefined && r.x >= 0 }, 4000)) return true
        await reload()
      }
      return false
    }
    const within = (r) => r !== null && r.x >= 0 && r.y >= 0 && r.x + r.w <= 390 && r.y + r.h <= 844
    fake.status = CLOUD(W_PERSONAL, 'solo', 'Plus')
    fake.link = { ok: false, status: 0, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }
    await reload()
    await openDrawer()
    await openProfileMenu()
    await sleep(300)
    check('390 px: the menu fits the window and « Upgrade » is in it', within(await rect('.kbfp-menu')) && within(await rect('[data-kb="menu-upgrade"]')), { menu: await rect('.kbfp-menu'), entry: await rect('[data-kb="menu-upgrade"]') })
    await shot('v40-upgrade-390')
    await press('[data-kb="menu-upgrade"]')
    await until(() => exists('[data-kb="foot-flash"]'), 5000)
    await sleep(300)
    check('390 px: the notice that names the server fits, « Switch server » with it', within(await rect('[data-kb="foot-flash"]')) && within(await rect('[data-kb="foot-switch-server"]')), { notice: await rect('[data-kb="foot-flash"]'), action: await rect('[data-kb="foot-switch-server"]') })
    await shot('v41-server-down-390')
    fake.link = null
    fake.status = null
    await reload()
    await openDrawer()
    await press('[data-kb="foot-signin"]')
    await until(() => exists('[data-kb="off-menu"]'), 4000)
    await sleep(300)
    check('390 px signed out: the menu fits the window and « See plans » is in it', within(await rect('[data-kb="off-menu"]')) && within(await rect('[data-kb="menu-plans"]')), { menu: await rect('[data-kb="off-menu"]'), entry: await rect('[data-kb="menu-plans"]') })
    await shot('v40-see-plans-390')
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    fake.status = CLOUD(W_PERSONAL)
    fake.plans = null
    fake.bodies.length = 0
    await reload()
    await openProfileMenu()

    // Account asks the host for the console link itself, and a refusal is said above the footer.
    await reload()
    fake.bodies.length = 0
    await openProfileMenu()
    await press('[data-kb="menu-account"]')
    await until(() => linkAsks().length >= 1, 5000)
    await settle()
    const acc = fake.bodies.filter((b) => b.path === '/kybernos-cloud/console/link')
    check('no bridge: Account asks the host for a console link on the overview, opened by the host', acc.length === 1 && acc[0].body.section === 'overview' && acc[0].body.open === true && acc[0].body.workspace_id === W_PERSONAL, acc)
    // A refused link says so, in a line above the footer.
    fake.link = { ok: false, status: 403, error: 'email_not_verified' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]')
    await until(async () => /Confirm your e-mail/.test((await text('[data-kb="foot-flash"]')) || ''), 5000)
    check('a refused link (e-mail not confirmed) is said above the footer', /Confirm your e-mail/.test((await text('[data-kb="foot-flash"]')) || ''), await text('[data-kb="foot-flash"]'))
    fake.link = { ok: false, status: 0, error: 'injoignable' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]')
    await until(async () => /could not be opened/.test((await text('[data-kb="foot-flash"]')) || ''), 5000)
    check('a server that does not answer is said too', /could not be opened/.test((await text('[data-kb="foot-flash"]')) || ''), await text('[data-kb="foot-flash"]'))
    fake.link = { ok: true, opened: false, url: 'https://active.example.test/api/auth/magic-link/verify?token=x' }
    await openProfileMenu()
    await press('[data-kb="menu-account"]')
    await until(async () => (await opened()).includes('https://active.example.test/api/auth/magic-link/verify?token=x'), 5000)
    check('a host that could not open a browser hands the address back, and the page opens it', (await opened()).includes('https://active.example.test/api/auth/magic-link/verify?token=x'), await opened())
    fake.link = null
    await reload()

    // Website, Help and the others are unchanged.
    const o0 = await openedCount()
    await openProfileMenu()
    await press('[data-kb="menu-website"]')
    await until(async () => (await openedCount()) > o0, 5000)
    await openProfileMenu()
    await press('[data-kb="menu-help"]')
    await until(async () => (await openedCount()) > o0 + 1, 5000)
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
    // The first section is the essentials (no header). « Advanced » is a fold, shut at first: opened here with a click, as a person does, its first
    // entries are Servers (kept where it was), the section of what stays on this computer, then the Suite. Read from the layout (the organiser
    // orders by CSS), headers and cells together. The organiser (a debounced observer) draws the headers a moment after the cells: wait for them.
    await waitFor(page, `document.querySelector('[data-kb-fold-toggle]') !== null`, 6000)
    await openAdvancedFold(page) // only if it is shut: an earlier scene may have landed on a page inside it, which opens it
    await waitFor(page, `document.querySelectorAll('[data-kb="settings-group"]').length >= 2`, 6000) // the organiser draws the headers a moment after the cells
    const flow = (await val(`(() => { const list = Array.from(document.querySelectorAll('[class*="navList"]')).find((l) => l.querySelector('[class*="navCell"]')); return Array.from(list.children).map((c) => { const n = Object.keys(c).find((k) => k.indexOf('__reactFiber$') === 0); return { t: (c.textContent || '').trim(), key: n === undefined ? null : c[n].key, y: Math.round(c.getBoundingClientRect().top), head: c.getAttribute('data-kb') === 'settings-group' } }).filter((x) => x.y > 0 || x.head).sort((a, b) => a.y - b.y) })()`)) || []
    const heads = flow.filter((x) => x.head).map((x) => x.t)
    check('the group headers are Advanced and Other settings: no « Account » header any more, and none named like a page (« Kybernos »)', heads.join('|') === 'Advanced|Other settings' && !heads.includes('Account') && !heads.includes('Kybernos'), heads)
    const at = flow.findIndex((x) => x.head && x.t === 'Advanced')
    check('under it: Servers (kept where it was), the Kybernos section, then the Suite', at >= 0 && flow[at + 1] && flow[at + 1].key === 'kybernos-servers' && flow[at + 2] && flow[at + 2].key === 'kybernos-local' && flow[at + 3] && flow[at + 3].key === 'kybernos-suite', flow.slice(at, at + 5))
    // Each of the remaining ones still opens: pick General and Remote Control by key and read the page that comes up.
    const pageText = async () => (await val(`(document.querySelector('[data-slot="settings.section"]') || document.querySelector('[class*="settingsContent"]') || { innerText: '' }).innerText`)) || ''
    const openCell = async (cellKey) => {
      const was = await pageText()
      // The cell is drawn a moment after the dialog opens: it is waited for and pressed once it is there (the press itself answers true).
      await until(() => val(`(() => { const c = Array.from(document.querySelectorAll('[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n !== undefined && e[n].key === ${JSON.stringify(cellKey)} }); if (!c) return false; c.click(); return true })()`), 15000)
      await until(async () => { const t = await pageText(); return t.length > 20 && t !== was }, 5000) // the page that comes up is not the one that was there
      return pageText()
    }
    const general = await openCell('general')
    check('General still opens', general.length > 20, general.slice(0, 120))
    const remote = await openCell('kybernos-mobile')
    check('Remote Control still opens, with its own page', /remote control|phone/i.test(remote) && remote.length > 20, remote.slice(0, 160))
    const appearance = await openCell('kbac-appearance')
    check('Appearance still opens (the shortcut to Theme)', /theme|appearance/i.test(appearance), appearance.slice(0, 160))

    // ── The « Kybernos » section: the custom instructions through the host's file routes, the model re-import, the DSH chats ─────────────────────────────────
    console.log('The Kybernos section of Settings — what stays on this computer')
    await openCell('kybernos-local')
    await kySectionLoaded()
    check('the section opens: instructions and models are there, and a folded Advanced', (await exists('[data-kb="ky-instructions"]')) && (await exists('[data-kb="ky-models"]')) && (await exists('[data-kb="ky-advanced"]')) && !(await exists('[data-kb="ky-chats"]')))
    const AGENTS = join(DSH_HOME, 'AGENTS.md')
    const note = (await text('[data-kb="ky-instr-note"]')) || ''
    check('it says the instructions are kept on this computer, and in which file (the sandbox\'s own AGENTS.md)', /on this computer/i.test(note) && note.includes(AGENTS), note)
    const setField = (value) => val(`(() => { const t = document.querySelector('[data-kb="ky-instr-field"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const field = () => val(`document.querySelector('[data-kb="ky-instr-field"]').value`)
    const INSTR = 'Answer in short sentences. Say what you checked.'
    check('Save is not offered before anything changed', (await val(`document.querySelector('[data-kb="ky-instr-save"]').disabled`)) === true)
    await setField(INSTR)
    check('typing offers Save', (await val(`document.querySelector('[data-kb="ky-instr-save"]').disabled`)) === false)
    await jsClickReady('[data-kb="ky-instr-save"]')
    await waitFor(page, `document.querySelector('[data-kb="ky-instr-saved"]') !== null`, 5000)
    check('Save: the page says Saved', await exists('[data-kb="ky-instr-saved"]'))
    const written = existsSync(AGENTS) ? readFileSync(AGENTS, 'utf8') : ''
    check('and the host wrote the marked section of AGENTS.md (what every agent reads)', written.includes('<!-- kybernos:custom-instructions v1 -->') && written.includes(INSTR), written.slice(0, 200))
    await reload()
    await openDshSettings()
    await openCell('kybernos-local')
    await kySectionLoaded()
    // The field is filled from the file once the host has answered: awaited until it holds the text (20 s), not read at the moment the section is drawn.
    await waitFor(page, `document.querySelector('[data-kb="ky-instr-field"]') !== null && document.querySelector('[data-kb="ky-instr-field"]').value === ${JSON.stringify(INSTR)}`, 20000)
    check('after a reload the field reads it back from the file', (await field()) === INSTR, await field())
    // Emptying the field and saving removes the section (the rest of the file is the person\'s).
    await setField('')
    await jsClickReady('[data-kb="ky-instr-save"]')
    await until(() => !(existsSync(AGENTS) ? readFileSync(AGENTS, 'utf8') : '').includes('kybernos:custom-instructions'), 5000)
    check('an emptied field removes the section from AGENTS.md', !(existsSync(AGENTS) ? readFileSync(AGENTS, 'utf8') : '').includes('kybernos:custom-instructions'))
    // A marker typed in the field is refused with the reason, and nothing is written.
    await setField('x <!-- kybernos:custom-instructions v1 --> y')
    await jsClickReady('[data-kb="ky-instr-save"]')
    await until(() => exists('[data-kb="ky-instr-error"]'), 5000)
    check('a reserved marker in the text is refused, with the reason', /reserved Kybernos marker/.test((await text('[data-kb="ky-instr-error"]')) || ''), await text('[data-kb="ky-instr-error"]'))
    await setField('')

    // Models and chats: the host's routes are answered in the page; the section runs them and says what happened.
    fake.sync = { ok: true, models: { count: 3, plan: 'free', settings: true } }
    fake.push = { ok: true, scanned: 4, pushed: 4 }
    fake.calls.length = 0
    await jsClick('[data-kb="ky-adv-toggle"]'); await until(() => exists('[data-kb="ky-chats-run"]'), 4000)
    check('connected: the two server actions can be pressed and no sign-in note is shown', (await exists('[data-kb="ky-signed-out"]')) === false && (await val(`document.querySelector('[data-kb="ky-models-run"]').disabled === false && document.querySelector('[data-kb="ky-chats-run"]').disabled === false`)) === true)
    await jsClickReady('[data-kb="ky-models-run"]'); await until(() => fake.calls.includes('models-sync'), 5000)
    check('Import models asks the host to re-import the catalogue', fake.calls.includes('models-sync'), fake.calls)
    await jsClickReady('[data-kb="ky-chats-run"]'); await until(() => exists('[data-kb="ky-chats-confirm"]'), 5000)
    check('Send DSH chats asks first, with the sentence that says what is sent and why: nothing is sent yet', !fake.calls.includes('chats-push') && (await exists('[data-kb="ky-chats-confirm"]')) && /never what is said in them/.test((await text('[data-kb="ky-chats-note"]')) || ''), fake.calls)
    await jsClickReady('[data-kb="ky-chats-no"]'); await until(gone('[data-kb="ky-chats-confirm"]'), 4000)
    check('Cancel sends nothing and closes the question', !fake.calls.includes('chats-push') && !(await exists('[data-kb="ky-chats-confirm"]')) && (await exists('[data-kb="ky-chats-run"]')), fake.calls)
    await jsClickReady('[data-kb="ky-chats-run"]'); await until(() => exists('[data-kb="ky-chats-yes"]'), 4000)
    await jsClickReady('[data-kb="ky-chats-yes"]'); await until(() => fake.calls.includes('chats-push'), 5000)
    check('Send DSH chats asks the host to send the directory only after the yes', fake.calls.includes('chats-push'), fake.calls)
    fake.sync = { ok: false, error: 'reseau' }
    await jsClickReady('[data-kb="ky-models-run"]'); await until(() => exists('[data-kb="ky-models-error"]'), 5000)
    check('a refused re-import says so (and offers to try again)', (await exists('[data-kb="ky-models-error"]')) && (await val(`document.querySelector('[data-kb="ky-models-run"]').disabled`)) === false, await text('[data-kb="ky-models"]'))
    fake.sync = null
    fake.push = null
    await shot('11b-kybernos-section')
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
    await until(async () => /\$24/.test((await text('[data-kb="upgrade-plan-solo"]')) || ''), 4000)
    check('monthly switches the prices (and does not pretend to be yearly)', /\$24/.test((await text('[data-kb="upgrade-plan-solo"]')) || '') && /billed monthly/.test((await text('[data-kb="upgrade-plan-solo"]')) || ''))
    await val(`(() => { const b = document.querySelector('[data-kb="upgrade-interval"] button:not(.on)'); if (b) b.click() })()`)

    // Subscribe: success
    fake.checkout = { ok: true, opened: true }
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-studio"]')
    await until(() => fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout'), 5000)
    await until(() => exists('[data-kb="upgrade-opened"]'), 5000)
    const sub = fake.bodies.filter((b) => b.path === '/kybernos-cloud/billing/checkout')
    check('Subscribe asks the host for that level\'s checkout, for the active workspace, in the system browser', sub.length === 1 && sub[0].body.plan === 'solo' && sub[0].body.component === 'studio' && sub[0].body.quantity === 1 && sub[0].body.interval === 'year' && sub[0].body.currency === 'USD' && sub[0].body.workspace_id === W_PERSONAL && sub[0].body.open === true, sub)
    check('the dialog says the payment page is open, and offers to refresh the plan', (await exists('[data-kb="upgrade-opened"]')) && (await exists('[data-kb="upgrade-refresh"]')))
    check('no token anywhere in what the page sent', JSON.stringify(sub).indexOf('kys-') < 0)
    await shot('9-upgrade-opened')
    fake.calls.length = 0
    await press('[data-kb="upgrade-refresh"]')
    await until(async () => fake.calls.includes('refresh') && !(await exists('[data-kb="upgrade-dialog"]')), 5000)
    check('« I have paid » reads the account again and closes the dialog', fake.calls.includes('refresh') && !(await exists('[data-kb="upgrade-dialog"]')), fake.calls)

    // Subscribe: every refusal says what happened and what to do.
    const refuse = async (status, code, say, re, buttons) => {
      fake.checkout = { ok: false, status, error: code }
      await openUpgrade()
      await press('[data-kb="upgrade-subscribe-solo"]')
      await until(async () => (await exists('[data-kb="upgrade-error"]')) && ((await exists('[data-kb="upgrade-portal"]')) || (await exists('[data-kb="upgrade-retry"]')) || buttons === 'none'), 5000)
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
    await press('[data-kb="upgrade-portal"]')
    await until(async () => fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/portal') && (await exists('[data-kb="upgrade-opened"]')), 5000)
    check('the portal button asks the host for the workspace\'s billing portal, in the system browser', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/portal' && b.body.workspace_id === W_PERSONAL && b.body.open === true), fake.bodies)
    check('and the dialog says it is open', await exists('[data-kb="upgrade-opened"]'))
    await clean()
    await refuse(422, 'interval_not_sold', 'not possible, with a retry', 'not possible', 'retry')
    await clean()
    let n = 0
    fake.checkout = () => { n += 1; return n === 1 ? { ok: false, status: 502, error: 'bad_gateway' } : { ok: true, opened: true } }
    await openUpgrade()
    await press('[data-kb="upgrade-subscribe-solo"]')
    await until(async () => (await exists('[data-kb="upgrade-error"]')) && (await exists('[data-kb="upgrade-retry"]')), 5000)
    check('502: « nothing was charged » and a retry', /Nothing was charged/.test((await text('[data-kb="upgrade-error"]')) || '') && (await exists('[data-kb="upgrade-retry"]')), await text('[data-kb="upgrade-error"]'))
    await press('[data-kb="upgrade-retry"]')
    await until(() => exists('[data-kb="upgrade-opened"]'), 5000)
    check('the retry goes through', await exists('[data-kb="upgrade-opened"]'))
    await clean()
    fake.checkout = { ok: false, status: 0, error: 'injoignable' }
    await openUpgrade()
    await press('[data-kb="upgrade-subscribe-solo"]')
    await until(async () => (await exists('[data-kb="upgrade-error"]')) && (await exists('[data-kb="upgrade-retry"]')), 5000)
    check('a server that does not answer: said, with a retry', /did not answer/.test((await text('[data-kb="upgrade-error"]')) || '') && (await exists('[data-kb="upgrade-retry"]')), await text('[data-kb="upgrade-error"]'))
    await clean()

    // The catalogue itself failing.
    fake.plans = { ok: false, status: 0, error: 'injoignable' }
    await openUpgrade()
    check('a catalogue that cannot be read says so and offers to try again', (await exists('[data-kb="upgrade-load-error"]')) && /could not be loaded/.test((await text('[data-kb="upgrade-load-error"]')) || ''))
    fake.plans = PLANS
    await press('[data-kb="upgrade-load-error"] button')
    await until(() => exists('[data-kb="upgrade-plan-solo"]'), 5000)
    check('the retry loads it', await exists('[data-kb="upgrade-plan-solo"]'))
    await key('Escape', 'Escape'); await until(gone('[data-kb="upgrade-dialog"]'), 3000)
    check('Escape closes the dialog', !(await exists('[data-kb="upgrade-dialog"]')))
    await reload()

    // A team workspace buys seats, priced by the server's quote.
    fake.status = CLOUD(W_TEAM)
    await reload()
    check('(a team workspace opens the dialog)', await openUpgrade('upgrade-plan-team'))
    check('it sees the team plan with a seat stepper, not the individual levels', (await exists('[data-kb="upgrade-plan-team"]')) && !(await exists('[data-kb="upgrade-plan-solo"]')))
    await val(`document.querySelector('[data-kb="upgrade-seats-more"]').click()`)
    await val(`document.querySelector('[data-kb="upgrade-seats-more"]').click()`)
    await until(async () => /Total\s*\$1,872(\.00)? per year/.test((await text('[data-kb="upgrade-total"]')) || ''), 6000) // the quote of 4 seats is asked of the server (answered in the page)
    check('the total is the server\'s quote for the seats chosen (graduated prices are never computed here)', /Total\s*\$1,872(\.00)? per year/.test((await text('[data-kb="upgrade-total"]')) || '') && fake.calls.some((c) => /quantity=4/.test(c) && /interval=year/.test(c)), { total: await text('[data-kb="upgrade-total"]'), calls: fake.calls.slice(-3) })
    fake.checkout = { ok: true, opened: true }
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-team"]')
    await until(() => fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout'), 5000)
    check('Subscribe sends the seats', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout' && b.body.plan === 'team' && b.body.quantity === 4 && b.body.workspace_id === W_TEAM), fake.bodies)
    await shot('11-upgrade-team')
    await clean()

    // Top-up credits are a pack bought once.
    fake.status = CLOUD(W_PERSONAL)
    await reload()
    await openUpgrade()
    fake.bodies.length = 0
    await press('[data-kb="upgrade-subscribe-topup"]')
    await until(() => fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout'), 5000)
    check('top-up credits are bought as packs, with no interval', fake.bodies.some((b) => b.path === '/kybernos-cloud/billing/checkout' && b.body.plan === 'topup' && b.body.quantity === 1 && b.body.interval === undefined), fake.bodies)
    check('and no native popover showed in any of these scenes', (await nativeSeen()).length === 0, await nativeSeen())

    // The dialog follows DSH's tokens: once in the other scheme (then put back).
    await clean()
    const schemeNow = async () => val(`document.documentElement.getAttribute('data-kb-theme')`)
    const startScheme = await schemeNow()
    const flip = startScheme === 'dark' ? 'Light' : 'Dark'
    await openProfileMenu()
    await val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${flip}"]'); if (b) b.click() })()`)
    await until(async () => (await schemeNow()) === flip.toLowerCase(), 4000)
    await press('[data-kb="menu-plan-cta"]')
    await waitFor(page, `document.querySelector('[data-kb="upgrade-plan-solo"]') !== null`, 6000)
    await sleep(300)
    await shot('12-upgrade-' + flip.toLowerCase())
    const surface = await val(`(() => { const d = document.querySelector('.kbup'); const cs = getComputedStyle(d); return { bg: cs.backgroundColor, fg: cs.color } })()`)
    check('the dialog is drawn in the DSH scheme (its surface and text colours differ)', surface !== null && surface.bg !== surface.fg, surface)
    await key('Escape', 'Escape'); await until(gone('[data-kb="upgrade-dialog"]'), 3000)
    await openProfileMenu()
    await val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${startScheme === 'dark' ? 'Dark' : 'Light'}"]'); if (b) b.click() })()`)
    await until(async () => (await schemeNow()) === startScheme, 4000)
    check('and the scheme is put back', (await schemeNow()) === startScheme, { startScheme, now: await schemeNow() })
  }
} finally {
  // The Kybernos section writes the sandbox's own AGENTS.md: put it back as it was.
  try { if (agentsBefore === null) rmSync(join(DSH_HOME, 'AGENTS.md'), { force: true }); else writeFileSync(join(DSH_HOME, 'AGENTS.md'), agentsBefore) } catch (e) { /* the sandbox is throw-away */ }
  await live.close()
}
if (notRun !== null) { console.error('○ not run: ' + notRun); process.exit(3) }
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)
