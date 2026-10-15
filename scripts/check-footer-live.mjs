// The sidebar footer on DSH ≥ 0.2.1-alpha.4, on a REAL page: the gear and the card open OUR menu, never DSH's account popover.
//
//   source scripts/sandbox/env.sh && node scripts/check-footer-live.mjs [--shots /tmp/shots]
//
// Background: the settings seat of DSH's sidebar renders the ACCOUNT launcher (slot `settings.launcher`); its trigger opens a
// popover « Settings / Feedback / Sign in ». Our footer used to click that trigger to reach Settings and so opened the popover.
// Now the core plugin owns the seam (`window.__kbOpenDshSettings`, plus a capture-phase guard on the launcher) and the footer's
// gear opens our own menu. See packages/kybernos-plugin/client.js (<kb-open-settings>) and packages/kybernos-cloud/client.js.
//
// What is real: the DSH page, the sidebar footer, our menus, DSH's Settings dialog, its account launcher and popover, every
// click (CDP mouse events). What is answered in the page (nothing leaves the machine): the cloud status of the connected scenes
// and the pairing start/poll of the connect scene. The not-connected scenes read the host's real status route.
//
// Sandbox only: it refuses :3080 (exit 3). It presses DSH's light/dark switch of the sandbox's own profile and puts it back.
// Exit 0 all good, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host.endsWith(':3080')) { console.error('○ not run: this check must run against the sandbox (source scripts/sandbox/env.sh), never the real DSH on :3080'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const CLOUD = { ok: true, connected: true, state: { user: { email: 'dev@example.test', name: 'Dev Person', plan: 'plus' }, plan: 'plus', workspaces: [{ id: 'ws-1', name: 'Personal', kyber_count: 2 }], active_workspace_id: 'ws-1', web_url: 'https://dev.kybernos.app', device_label: 'This computer' } }
const PAIRING = { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1', expires_at: '2099-01-01T00:00:00Z' } }
const fake = { status: null, calls: [] }
const body64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')

const live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 }) }
const centre = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const press = async (sel) => { const c = await centre(sel); if (c === null || c.err !== undefined) return false; await mouse(c.x, c.y); return true }
const shot = async (name) => { if (shotsAt !== null) await page.shot(join(shotsAt, name + '.png')) }

// Any popover of DSH's account launcher that becomes VISIBLE, whatever the scene (recorded in the page, read at the end of each).
const WATCH = `(() => {
  window.__kbNative = []
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

const interceptor = async () => {
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-cloud/status*' }, { urlPattern: '*kybernos-cloud/start*' }, { urlPattern: '*kybernos-cloud/poll*' }] })
  page.on('Fetch.requestPaused', (p) => {
    const path = new URL(p.request.url).pathname
    let body = null
    if (path === '/kybernos-cloud/status' && fake.status !== null) body = fake.status
    if (path === '/kybernos-cloud/start') { fake.calls.push('start'); body = PAIRING }
    if (path === '/kybernos-cloud/poll') { fake.calls.push('poll'); body = { ok: true, connected: false, status: 'pending' } }
    if (body === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: body64(body) })
  })
}

// A fresh instance (the sandbox) opens DSH's « Get started » dialog (sign in to a DeepSeek account / add a key) on every load, and it
// swallows every click: closed by its own close button, like a person would.
const dismissGetStarted = () => val(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /get started/i.test(x.innerText || '')); if (!d) return false; const c = Array.from(d.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); return !!c })()`)
const reload = async () => {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, `document.querySelector('.kbf-gear, [data-kb="workspace-card"]') !== null`, 30000)
  await sleep(700)
  for (let i = 0; i < 6; i += 1) { if ((await dismissGetStarted()) === true) break; await sleep(300) }
  await sleep(300)
}
const settingsOpen = async () => (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 6000)) !== null
const clean = async () => { await key('Escape', 'Escape'); await sleep(200); await reload() }

let notRun = null
try {
  await page.send('Runtime.enable', {})
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH })
  await interceptor()
  await reload()

  // ── 1. Signed out: the row, the gear, the menu ───────────────────────────────────────────────────────────────
  console.log('Signed out — the footer row and its menu')
  const row = await val(`(() => { const g = document.querySelector('.kbf-gear'); const off = document.querySelector('.kbf-off'); return { gear: !!g, primary: off ? (off.querySelector('.kbm-btn-primary') || {}).innerText : null, expanded: g ? g.getAttribute('aria-expanded') : null, haspopup: g ? g.getAttribute('aria-haspopup') : null } })()`)
  if (row.gear !== true) notRun = 'the signed-out footer is not there (the sandbox is connected to an account?)'
  else {
    check('the footer row is ours: a « Sign in » button and a gear', /sign in/i.test(row.primary || '') && row.gear === true, row)
    check('DSH\'s own launcher is not drawn (no size, whatever its classes are called)', (await val(`(() => { const l = document.querySelector('[data-slot="settings.launcher"]'); if (!l) return true; return getComputedStyle(l).display === 'none' || Array.from(l.querySelectorAll('button')).every((b) => { const r = b.getBoundingClientRect(); return r.width <= 8 || getComputedStyle(b).visibility === 'hidden' }) })()`)) === true)
    check('the gear announces a menu, closed', row.haspopup === 'menu' && row.expanded === 'false', row)

    await shot('1-signed-out-row')
    check('a real click on the gear opens our menu', await press('.kbf-gear') && (await waitFor(page, `document.querySelector('[data-kb="off-menu"]') !== null`, 4000)) !== null)
    const menu = await val(`(() => { const m = document.querySelector('[data-kb="off-menu"]'); if (!m) return null; const r = m.getBoundingClientRect(); const kb = (n) => !!m.querySelector('[data-kb="' + n + '"]'); return { text: m.innerText.replace(/\\s+/g, ' ').trim(), connect: kb('menu-connect'), appearance: kb('menu-appearance'), settings: kb('menu-settings'), help: kb('menu-help'), feedback: kb('menu-feedback'), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, expanded: document.querySelector('.kbf-gear').getAttribute('aria-expanded') } })()`)
    check('the menu offers Sign in, Appearance, Settings, Help and Feedback', menu !== null && menu.connect && menu.appearance && menu.settings && menu.help && menu.feedback, menu)
    check('it fits the window and the gear says it is open', menu !== null && menu.inView === true && menu.expanded === 'true', menu)
    check('no native popover (Settings ⌥⌘, / Feedback / Sign in) is on screen', (await nativeSeen()).length === 0, await nativeSeen())
    await shot('2-signed-out-menu-light')

    await key('Escape', 'Escape'); await sleep(250)
    check('Escape closes it', (await val(`document.querySelector('[data-kb="off-menu"]') === null`)) === true)
    await press('.kbf-gear'); await sleep(250)
    await mouse(700, 300); await sleep(250)
    check('a click outside closes it', (await val(`document.querySelector('[data-kb="off-menu"]') === null`)) === true)
    await press('.kbf-gear'); await sleep(250)
    await press('.kbf-gear'); await sleep(250)
    check('the gear toggles it', (await val(`document.querySelector('[data-kb="off-menu"]') === null`)) === true)

    // The Settings entry reaches DSH's own dialog.
    await press('.kbf-gear'); await sleep(300)
    await press('[data-kb="menu-settings"]')
    check('the Settings entry opens DSH\'s Settings (its navigation is there)', await settingsOpen())
    check('and closes our menu', (await val(`document.querySelector('[data-kb="off-menu"]') === null`)) === true)
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
    check('(the launcher is forced visible for this scene)', shown !== null, shown)
    if (shown !== null) {
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

    // ── 5. Connect: our flow, from the row and from the menu ────────────────────────────────────────────────
    console.log('Connect — the device-code card, ours')
    await press('.kbf-off .kbm-btn-primary')
    const card = await waitFor(page, `document.body.innerText.indexOf('KB4-7QX2') !== -1 ? 'KB4-7QX2' : null`, 8000)
    check('« Sign in » of the row shows OUR pairing code', card === 'KB4-7QX2', card)
    check('it asked the host to start the pairing', fake.calls.includes('start'), fake.calls)
    await shot('4-pairing-card')
    await clean()
    fake.calls.length = 0
    await press('.kbf-gear'); await sleep(300)
    await press('[data-kb="menu-connect"]')
    const card2 = await waitFor(page, `document.body.innerText.indexOf('KB4-7QX2') !== -1`, 8000)
    check('« Sign in » of the menu leads to the same card', card2 === true && fake.calls.includes('start'), { card2, calls: fake.calls })
    await clean()

    // ── 6. Appearance, both schemes, and back ───────────────────────────────────────────────────────────────
    console.log('Appearance')
    const scheme = async () => (await val(`document.documentElement.getAttribute('data-kb-theme')`))
    const before = await scheme()
    await press('.kbf-gear'); await sleep(300)
    const other = before === 'dark' ? 'Light' : 'Dark'
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${other}"]'); if (b) b.click() })()`)
    await sleep(700)
    check('the segment switches the scheme and leaves the menu open', (await scheme()) === other.toLowerCase() && (await val(`document.querySelector('[data-kb="off-menu"]') !== null`)) === true, { before, now: await scheme() })
    await shot('5-signed-out-menu-' + other.toLowerCase())
    await val(`(() => { const b = document.querySelector('[data-kb="off-menu"] [data-kb="menu-appearance"] button[aria-label="${before === 'dark' ? 'Dark' : 'Light'}"]'); if (b) b.click() })()`)
    await sleep(700)
    check('and puts the scheme back', (await scheme()) === before, { before, now: await scheme() })
    await clean()
  }

  // ── 7. Connected: the card, its menu, Settings and Account ─────────────────────────────────────────────────────
  if (notRun === null) {
    console.log('Connected — the card and its menu')
    fake.status = CLOUD
    await reload()
    check('the card replaces the row', (await val(`document.querySelector('[data-kb="workspace-card"]') !== null && document.querySelector('.kbf-gear') === null`)) === true)
    await press('[data-kb="workspace-card"] .kbfp-cardmain'); await sleep(500)
    check('a click on the card opens our menu', (await val(`document.querySelector('.kbfp-menu [data-kb="menu-settings"]') !== null`)) === true)
    await shot('6-connected-menu')
    await press('[data-kb="menu-settings"]')
    check('its Settings entry opens DSH\'s Settings', await settingsOpen())
    check('no native popover', (await nativeSeen()).length === 0, await nativeSeen())
    await clean()
    await press('[data-kb="workspace-card"] .kbfp-cardmain'); await sleep(400)
    await press('[data-kb="menu-account"]')
    const onAccount = await waitFor(page, `(() => { const c = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((b) => /^account$/i.test(b.innerText.trim())); return !!c && /active|selected/i.test(c.className + ' ' + (c.getAttribute('aria-current') || '')) })()`, 6000)
    check('its Account entry opens Settings on the Account section', onAccount !== null)
    check('no native popover', (await nativeSeen()).length === 0, await nativeSeen())
    await shot('7-connected-account')
  }
} finally {
  await live.close()
}
if (notRun !== null) { console.error('○ not run: ' + notRun); process.exit(3) }
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)
