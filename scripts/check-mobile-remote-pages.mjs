// Live check of the PAGES on a paired phone (an Android phone: no keyboard shortcut in DSH's DOM), through the phone link:
// the Skills data routes answer through the tunnel, the drawer closes by a tap on the dimmed chat, by a swipe and by a
// pick, and the Skills page loads. The pairing is the one of check-mobile-remote-live.mjs (same stand-in relay).
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh        # an isolated instance serving this checkout
//   node scripts/check-mobile-remote-pages.mjs [--shots <dir>]
//
// Without --real the relay is the stand-in of the bundle. With --real it is the REAL Kybernos server (the application on an
// embedded Postgres, scripts/replica.ts there) behind a public https tunnel (ngrok): the phone page is served from a real https
// origin, the plan that lists the phone link is published through the server's own admin API, and the DSH is connected the way a
// person's is (device approval). The relay's side of the conversation is then only what the server itself answers.
//
// It writes a server entry and a connection into the isolated instance (and puts them back), never into the real DSH.
// The host half only loads when that instance starts: restart it (scripts/sandbox/stop.sh, then start.sh) after a host edit.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'
import { startBackend } from './lib-mobile-remote-backend.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const REAL = args.includes('--real')
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('✗ this check pairs a phone with the DSH it talks to, and that is the real one (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('✗ DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(2) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

// ── what the phone link talks to, and the isolated DSH pointed at it ────────────────────────────────────────────
const backend = await startBackend({ real: REAL, serverDir: process.env.KYBERNOS_SERVER_DIR, log: (m) => console.log('  . ' + m) }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const ORIGIN = backend.phoneOrigin

// ── a second, signed-out browser: the phone ──────────────────────────────────────────────────────────────────────
async function openPhone () {
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const profile = mkdtempSync(join(tmpdir(), 'kb-phone-'))
  const port = 9411
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let target = null
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(500)
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') || null } catch (e) { /* starting */ }
  }
  if (target === null) { chrome.kill(); throw new Error('the phone browser did not start') }
  const page = await connect(target)
  await page.send('Runtime.enable', {})
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  // an Android phone: DSH draws no keyboard shortcut there (no aria-keyshortcuts), which the drawer must not depend on
  await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', userAgentMetadata: { platform: 'Android', platformVersion: '14', architecture: '', model: 'Pixel 8', mobile: true, brands: [{ brand: 'Chromium', version: '130' }], fullVersionList: [{ brand: 'Chromium', version: '130.0.0.0' }] } })
  // ngrok's free plan puts a one-time warning page in front of what looks like a browser's first visit (a person taps through it once).
  // This check says what it is instead, so the page under test is the one that answers.
  if (REAL) {
    await page.send('Network.enable', {})
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'KybernosPhoneCheck/1.0 (iPhone; headless)' })
    await page.send('Network.setExtraHTTPHeaders', { headers: { 'ngrok-skip-browser-warning': '1' } })
  }
  return { page, close: async () => { try { page.close() } catch (e) { /* gone */ } try { chrome.kill() } catch (e) { /* gone */ } await sleep(300); try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ } } }
}

let desktop = null
let phone = null
try {
  if (REAL) {
    // What a stranger finds at the public address: the phone page and the relay, nothing of the API behind them.
    console.log('the public address')
    const get = async (base, path) => { try { return await fetch(base + path, { headers: { 'ngrok-skip-browser-warning': '1' }, redirect: 'manual' }) } catch (e) { return null } }
    const pagePublic = await get(ORIGIN, '/__kb/')
    check('it is https', ORIGIN.startsWith('https://'), ORIGIN)
    check('it serves the phone page', pagePublic !== null && pagePublic.status === 200 && /html/u.test(pagePublic.headers.get('content-type') || ''))
    check('and it is not cached anywhere', pagePublic !== null && /no-store/u.test(pagePublic.headers.get('cache-control') || ''))
    for (const path of ['/healthz', '/v1/me', '/v1/remote/devices', '/api/auth/get-session', '/admin']) {
      const r = await get(ORIGIN, path)
      check('it serves nothing else: ' + path + ' is 404', r !== null && r.status === 404, r === null ? null : r.status)
    }
    const apiPage = await get(backend.api, '/__kb/')
    check('the API\'s own address does not serve the phone page', apiPage !== null && apiPage.status === 404, apiPage === null ? null : apiPage.status)
    const lim = await backend.remoteStatus()
    check('the server says the link is configured and the plan has it', lim.configured === true && lim.entitled === true, lim)
  }
  desktop = await openLivePage({ width: 1300, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const D = desktop.page
  const ev = async (page, js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { __err: r.err } : r.val }
  const shot = async (page, name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
  const q = (sel) => JSON.stringify(sel)
  const exists = async (page, sel) => (await ev(page, `!!document.querySelector(${q(sel)})`)) === true
  const text = async (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null })()`)
  const click = async (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const until = async (page, js, ms = 15000) => (await waitFor(page, js, ms)) !== null

  await until(D, `document.readyState === 'complete'`, 20000)
  await sleep(2500)
  // the sandbox has no model key: DSH asks for one on first load, which is not what this check is about
  await ev(D, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
  // ...and the « Get started » dialog of a profile with no key keeps a scrim over the whole window, which would hide what is tested below (a hit test answers to the scrim): close it by its ✕
  await ev(D, `(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /Get started/i.test(x.textContent)); if (!d) return false; const b = Array.from(d.querySelectorAll('button')).find((x) => x.textContent.trim() === '' || /close/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return !!b })()`)
  await sleep(500)

  // 1. the profile menu's « Phone and channels » entry (the footer's own phone button is gone)
  console.log('the account menu\'s Phone and channels window')
  const profileRow = await ev(D, `(() => { const b = document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain'); if (!b) return false; b.click(); return true })()`)
  await sleep(600)
  const opened = profileRow === true && await ev(D, `(() => { const e = document.querySelector('[data-kb="menu-phone"]'); if (!e) return false; e.click(); return true })()`)
  check('the profile menu has the « Phone and channels » entry (the account card is there: the stand-in server signed this DSH in)', opened === true)
  check('the window opens with « Add a phone » and has asked for no code by itself', await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="mobile-pair"]')`, 20000) && !(await exists(D, '[data-kb="phone-channels"] [data-kb="mobile-qr"]')))
  await click(D, '[data-kb="phone-channels"] [data-kb="mobile-pair"]')
  const panelUp = await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="mobile-qr"] svg')`, 20000)
  check('« Add a phone » shows a real QR code', panelUp === true)
  await shot(D, '1-window')

  // the « ? How it works » button on the window's title row opens the card of help.json, wholly inside the window, and closing it leaves the QR code
  console.log('the window\'s « ? How it works » card')
  const helpButton = '[data-kb="phone-channels"] [data-kb="help-button"][data-id="kybernos-mobile"]'
  check('the title row carries the button', await until(D, `!!document.querySelector(${q(helpButton)})`, 15000))
  await click(D, helpButton)
  check('it opens the card', await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="help-panel"]')`, 5000))
  // The words come from the catalogue the Suite shows (the signed online one wins over the shipped help.json): what they say is packages/kybernos-mobile/test-help.mjs's, here it is that the card has a body.
  const card = await text(D, '[data-kb="phone-channels"] [data-kb="help-panel"]')
  check('the card has its text (what it is, the steps, where to find it)', typeof card === 'string' && card.length > 120 && (await ev(D, `document.querySelectorAll('[data-kb="phone-channels"] [data-kb="help-panel"] ol li').length`)) >= 2, card)
  const box = await ev(D, `(() => { const e = document.querySelector('[data-kb="phone-channels"] [data-kb="help-panel"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, scrolls: e.scrollHeight > e.clientHeight + 1 } })()`)
  check('the card is wholly inside the window', box !== null && box.left >= 0 && box.top >= 0 && box.right <= box.w && box.bottom <= box.h, box)
  // Inside the window is not visible: three points of the card must hit the card (nothing clips or covers it).
  const seen = await ev(D, `(() => { const e = document.querySelector('[data-kb="phone-channels"] [data-kb="help-panel"]'); if (!e) return null; const r = e.getBoundingClientRect(); const at = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && e.contains(t) }; return { topLeft: at(r.left + 8, r.top + 8), right: at(r.right - 8, r.top + r.height / 2), bottomRight: at(r.right - 8, r.bottom - 8) } })()`)
  check('and none of it is cut or covered (its top-left, right edge and bottom-right corner answer to it)', seen !== null && seen.topLeft === true && seen.right === true && seen.bottomRight === true, seen)
  await shot(D, '1b-window-help')
  await click(D, '[data-kb="phone-channels"] .kbhp-x')
  check('its ✕ closes the card and the QR code stays', (await exists(D, '[data-kb="phone-channels"] [data-kb="mobile-qr"] svg')) && !(await exists(D, '[data-kb="help-panel"]')))

  const decode = `(async () => {
    const svg = document.querySelector('[data-kb="mobile-qr"] svg')
    const clone = svg.cloneNode(true); clone.setAttribute('width', '600'); clone.setAttribute('height', '600'); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
    await img.decode()
    const c = document.createElement('canvas'); c.width = 600; c.height = 600
    const g = c.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 600, 600); g.drawImage(img, 0, 0, 600, 600)
    const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c)
    return r.length ? r[0].rawValue : null
  })()`
  const link = await ev(D, decode, 15000)
  check('Chrome decodes the QR code into the pairing link', typeof link === 'string' && new RegExp('^' + ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/__kb/#[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{80,}$').test(link), typeof link === 'string' ? link.slice(0, 80) : link)
  if (backend.pairingsAsked() !== null) check('the server was asked for exactly one pairing', backend.pairingsAsked() === 1, backend.pairingsAsked())

  // 2. the window is closed (that withdraws the code nobody scanned: the server is told), and the Settings page makes the pairing the rest of this check
  //    plays; it is the same screen, so it gives the same QR code, from « Add a phone ».
  console.log('Settings › Phone and channels')
  const before = backend.pairingsAsked()
  await click(D, '[data-kb="phone-channels-close"]')
  check('the cross closes the window', await until(D, `!document.querySelector('[data-kb="phone-channels"]')`, 8000))
  await ev(D, `window.__kbOpenDshSettings && window.__kbOpenDshSettings()`)
  await until(D, `document.querySelectorAll('[class*="navCell"]').length > 3`, 15000)
  await ev(D, `(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n && e[n].key === 'kybernos-mobile' }); if (b) b.click(); return !!b })()`)
  const pageUp = await until(D, `!!document.querySelector('[data-kb="mobile-page"]')`, 15000)
  check('Settings › Phone and channels opens', pageUp === true)
  check('the page has both columns and asks for no code by itself', await exists(D, '[data-kb="mobile-page"] [data-kb="phone-remote"]') && (await exists(D, '[data-kb="mobile-page"] [data-kb="phone-channels-card"]') || await exists(D, '[data-kb="mobile-page"] [data-kb="phone-channels-off"]')) && !(await exists(D, '[data-kb="mobile-page"] [data-kb="mobile-qr"]')))
  // The page draws « Loading… » until the first status poll answers: the button is awaited, not assumed.
  await until(D, `!!document.querySelector('[data-kb="mobile-page"] [data-kb="mobile-pair"]')`, 15000)
  await click(D, '[data-kb="mobile-page"] [data-kb="mobile-pair"]')
  check('« Add a phone » on the page shows a QR code', await until(D, `!!document.querySelector('[data-kb="mobile-page"] [data-kb="mobile-qr"] svg')`, 20000))
  await sleep(600)
  await shot(D, '2-settings')
  const link2 = await ev(D, decode, 15000)
  check('and it is a pairing link of its own, which Chrome decodes', typeof link2 === 'string' && link2.startsWith(ORIGIN + '/__kb/#') && link2 !== link)
  if (before !== null) check('the server was asked for a second pairing, not more', backend.pairingsAsked() === before + 1, backend.pairingsAsked())

  // 3. the phone scans it
  console.log('the phone')
  phone = await openPhone()
  const P = phone.page
  await P.send('Page.navigate', { url: link2 })
  const verifying = await until(P, `window.__kb && window.__kb.state === 'verify'`, 20000)
  check('the phone page reaches the 4-digit check', verifying === true, await ev(P, `JSON.stringify(window.__kb || null)`))
  const phoneSas = await ev(P, `window.__kb && window.__kb.sas`)
  check('the address bar no longer carries the secrets', (await ev(P, `location.hash === '' && !location.href.includes('#')`)) === true)
  const deskSasUp = await until(D, `!!document.querySelector('[data-kb="mobile-sas"]')`, 15000)
  check('the computer shows the same 4 digits', deskSasUp === true && (await text(D, '[data-kb="mobile-sas"]')) === phoneSas, { phoneSas, desk: await text(D, '[data-kb="mobile-sas"]') })
  await shot(D, '3-verify-desktop')
  await shot(P, '3-verify-phone')
  check('nothing is served to the phone before approval', (await ev(P, `document.getElementById('app').hidden`)) === true)

  await click(D, '[data-kb="mobile-approve"]')
  // Since the two installable apps (19/10) the phone offers the install first, DSH runs behind that screen only after « Later » (what the install itself does is check-phone-apps-live's).
  check('after approval the phone offers to install the apps first', await until(P, `window.__kb.state === 'install'`, 20000), await ev(P, `JSON.stringify(window.__kb || null)`))
  await click(P, '#actions button')
  const running = await until(P, `window.__kb.state === 'running'`, 20000)
  check('after approval the phone runs the computer\'s page', running === true, await ev(P, `JSON.stringify(window.__kb)`))
  // while the page is still being downloaded (megabytes of bundles share the one connection with the small answers), a
  // small data route is asked for: that is what a person on a real uplink meets when they open a page right away
  const firstData = await ev(P, `(async () => { const t0 = Date.now(); try { const r = await fetch('/kybernos-skills/status', { cache: 'no-store' }); await r.text(); return { status: r.status, ms: Date.now() - t0 } } catch (e) { return { err: String(e), ms: Date.now() - t0 } } })()`, 120000)
  console.log('  . a small route asked for while the page loads: ' + JSON.stringify(firstData) + ' (relay uplink limit: ' + (Number(process.env.KB_RELAY_UPLINK_BPS) || 'none') + ' B/s)')
  await sleep(5000)
  const dom = await ev(P, `(() => {
    const f = document.getElementById('app'); const d = f && f.contentDocument
    if (!d) return null
    return { title: d.title, slots: d.querySelectorAll('[data-slot]').length, composer: !!d.querySelector('textarea, [contenteditable="true"], [role="textbox"]'), sheet: !!d.getElementById('kbmob-sheet'), width: d.documentElement.clientWidth, menu: !!d.querySelector('.kbmob-menu') }
  })()`)
  check('it is DSH, at phone width, with the phone layout', dom !== null && dom.title === 'Kybernos' && dom.slots > 10 && dom.sheet === true && dom.width <= 390, dom)
  check('its composer is there', dom !== null && dom.composer === true)
  const kb = JSON.parse(await ev(P, `JSON.stringify(window.__kb)`))
  check('requests and the streaming socket went through the tunnel', kb.req > 20 && kb.wsOpen >= 1 && kb.wsMsgs >= 1, kb)
  if (backend.ciphertextOnly() !== null) check('the relay saw only ciphertext after the handshake', backend.ciphertextOnly() === true)
  await shot(P, '4-running-phone')

  // 4. the pages, through the tunnel (measured on a real Android phone, 2026-10-13: the Skills page never loaded, and the
  //    drawer could only be closed with its own icon)
  console.log('the pages, on the phone')
  const FW = `document.getElementById('app').contentWindow`
  const FD = `document.getElementById('app').contentDocument`
  const nodeJs = (expr) => ev(P, `(() => { const d = ${FD}; const w = ${FW}; return ${expr} })()`)
  const drawerCollapsed = () => nodeJs(`d.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)
  const noShortcuts = await nodeJs(`d.querySelectorAll('[aria-keyshortcuts]').length`)
  check('on this phone DSH draws no keyboard shortcut (the drawer must not depend on one)', noShortcuts === 0, noShortcuts)
  // the DSH page sits in an iframe of the phone page: its coordinates are the iframe's, the events are the page's
  const off = await ev(P, `(() => { const r = document.getElementById('app').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
  console.log('  . iframe at ' + JSON.stringify(off))
  const tapAt = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await P.send('Input.dispatchMouseEvent', { type: t, x: x + off.x, y: y + off.y, button: 'left', clickCount: 1 }) }
  const swipe = async (x1, y1, x2, y2) => {
    await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1 + off.x, y: y1 + off.y }] })
    for (let k = 1; k <= 6; k += 1) await P.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + off.x + (x2 - x1) * k / 6, y: y1 + off.y + (y2 - y1) * k / 6 }] })
    await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const hitAt = (x, y) => nodeJs(`(() => { const e = d.elementFromPoint(${x}, ${y}); const f = d.querySelector('[data-slot="root"] > div'); if (!e) return null; const cs = d.defaultView.getComputedStyle(e); const attrs = Array.from(e.attributes).map((a) => a.name + '=' + String(a.value).slice(0, 20)).join(' '); return e.tagName.toLowerCase() + (e === f ? '(FRAME)' : '') + ' ' + String(e.className).slice(0, 30) + ' | ' + attrs + ' | parent=' + (e.parentElement === f ? 'FRAME' : e.parentElement.tagName) + ' pos=' + cs.position + ' z=' + cs.zIndex + ' pe=' + cs.pointerEvents + ' rect=' + JSON.stringify(e.getBoundingClientRect()).slice(0, 90) })()`)
  const openDrawer = async () => { await nodeJs(`(() => { const b = d.querySelector('[data-kb="mobile-menu"]'); if (b) b.click(); return !!b })()`); await sleep(900) }

  // the sandbox has no model key: the phone's DSH page asks for one too, behind a dialog that covers the page
  await nodeJs(`(() => { const b = Array.from(d.querySelectorAll('button')).find((x) => /^Configure later$/i.test((x.textContent || '').trim())); if (b) b.click(); return !!b })()`)
  await sleep(700)

  // 4a. what the Skills page asks for, called by the page's own window through the tunnel
  const probe = await ev(P, `(async () => { const w = ${FW}; const out = []; for (const p of ['/kybernos-skills/skills', '/kybernos-skills/status', '/kybernos-skills/featured']) { const t0 = Date.now(); try { const r = await w.fetch(p, { headers: { accept: 'application/json' } }); const b = await r.text(); out.push({ p, status: r.status, bytes: b.length, ms: Date.now() - t0 }) } catch (e) { out.push({ p, err: String(e), ms: Date.now() - t0 }) } } return out })()`, 90000)
  check('the Skills data routes answer through the tunnel', Array.isArray(probe) && probe.every((x) => x.status === 200 && x.bytes > 2), probe)

  // 4b. the drawer: a tap on the dimmed chat closes it
  await openDrawer()
  check('the menu button opens the drawer', (await drawerCollapsed()) === false)
  await shot(P, '5-drawer-open')
  console.log('  . element under (378, 420): ' + (await hitAt(378, 420)))
  await tapAt(378, 420)
  await sleep(900)
  check('a tap on the dimmed chat closes it', (await drawerCollapsed()) === true)
  // 4c. a swipe to the left closes it
  await openDrawer()
  await swipe(250, 500, 80, 505)
  await sleep(900)
  check('a swipe to the left closes it', (await drawerCollapsed()) === true)
  // 4d. a pick closes it by itself, and the page is the whole screen
  await openDrawer()
  const skillsRow = await nodeJs(`(() => { const e = Array.from(d.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] a')).find((x) => /^Skills/i.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  check('the drawer lists Skills', Array.isArray(skillsRow), skillsRow)
  if (Array.isArray(skillsRow)) await tapAt(skillsRow[0], skillsRow[1])
  await sleep(1500)
  check('picking Skills closes the drawer by itself', (await drawerCollapsed()) === true)
  // 4e. the page loads (no skeleton left after a while)
  // The page has two faces: « N of M active » on Yours, and, since the Skills page was redone, the Featured landing (« Picked by Kybernos… »): either one means it has loaded.
  const loaded = await until(P, `(() => { const d = ${FD}; const t = d.body ? d.body.innerText : ''; const m = /(\\d+) of (\\d+) active/.exec(t); return (!!m && Number(m[2]) > 0) || /Picked by Kybernos/.test(t) })()`, 30000)
  const skillsText = await nodeJs(`d.body.innerText.replace(/\\s+/g, ' ').slice(0, 260)`)
  await shot(P, '6-skills-phone')
  check('the Skills page loads', loaded === true, skillsText)
  // what the page's requests met on the way: nothing may be refused for being too many, nothing may be slow
  const net = await nodeJs(`(() => { const es = w.performance.getEntriesByType('resource'); const by = {}; for (const e of es) { const k = String(e.responseStatus || 0); by[k] = (by[k] || 0) + 1 } const slow = es.filter((e) => e.duration > 4000).map((e) => e.name.replace(/^https?:\\/\\/[^/]+/, '').slice(0, 60) + ' ' + Math.round(e.duration) + 'ms').slice(0, 6); return { n: es.length, by, slow } })()`)
  console.log('  . requests of the page: ' + JSON.stringify(net))
  check('no request was refused for being too many (429)', net !== null && net.by !== undefined && !net.by['429'], net)
  const cardCount = await nodeJs(`d.querySelectorAll('[data-slot="main"] button').length`)
  check('and it lists its skills', typeof cardCount === 'number' && cardCount > 8, cardCount)

  // 5. the computer's DSH is restarted while the phone is open (a person updates a plugin, or DSH is relaunched): the
  //    phone resumes by itself, and the next page it opens loads. (Reported 2026-10-13: Skills stayed a skeleton.)
  console.log('the computer restarts DSH while the phone is open')
  const beforeRestart = JSON.parse(await ev(P, `JSON.stringify(window.__kb)`))
  const here = dirname(fileURLToPath(import.meta.url))
  const restart = spawnSync('bash', ['-c', 'bash "' + join(here, 'sandbox', 'stop.sh') + '" >/dev/null 2>&1; bash "' + join(here, 'sandbox', 'start.sh') + '" 2>&1 | tail -2'], { encoding: 'utf8', env: process.env, timeout: 120000 })
  console.log('  . ' + String(restart.stdout || '').trim().split('\n').pop())
  const resumed = await until(P, `window.__kb.state === 'running' && document.getElementById('veil').hidden === true`, 60000)
  check('the phone resumes by itself after the computer\'s DSH restarted', resumed === true, await ev(P, `JSON.stringify({ state: window.__kb.state, veil: document.getElementById('veil').textContent, log: window.__kb.log })`))
  await sleep(2500)
  // the page that was open before the restart: a request from it goes through
  const afterProbe = await ev(P, `(async () => { const w = ${FW}; const t0 = Date.now(); try { const r = await w.fetch('/kybernos-skills/skills', { headers: { accept: 'application/json' }, cache: 'no-store' }); const b = await r.text(); return { status: r.status, bytes: b.length, ms: Date.now() - t0 } } catch (e) { return { err: String(e), ms: Date.now() - t0 } } })()`, 60000)
  check('a request of the page that was open goes through the resumed tunnel', afterProbe !== null && afterProbe.status === 200 && afterProbe.bytes > 1000, afterProbe)
  await openDrawer()
  const row2 = await nodeJs(`(() => { const e = Array.from(d.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] a')).find((x) => /^Automations/i.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  if (Array.isArray(row2)) await tapAt(row2[0], row2[1])
  await sleep(1500)
  await openDrawer()
  const row3 = await nodeJs(`(() => { const e = Array.from(d.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] a')).find((x) => /^Skills/i.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  if (Array.isArray(row3)) await tapAt(row3[0], row3[1])
  const loaded2 = await until(P, `(() => { const d = ${FD}; const t = d.body ? d.body.innerText : ''; const m = /(\\d+) of (\\d+) active/.exec(t); return (!!m && Number(m[2]) > 0) || /Picked by Kybernos/.test(t) })()`, 30000)
  await shot(P, '7-skills-after-restart')
  check('and the Skills page loads after it', loaded2 === true, await nodeJs(`d.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)`))
  void beforeRestart
} catch (e) {
  fail += 1
  console.log('  ✗ exception — ' + (e && e.stack ? e.stack : e))
} finally {
  if (phone !== null) await phone.close()
  if (desktop !== null) await desktop.close()
  await backend.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
