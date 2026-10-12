// Live check of the phone link, on the REAL GUI of an isolated DSH and a 390 px phone: the QR code the sidebar's phone
// button shows is decoded by Chrome, scanned by a second browser, approved on the computer, and the computer's own DSH
// page then runs on the phone, end to end encrypted through a stand-in relay.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh        # an isolated instance serving this checkout
//   node scripts/check-mobile-remote-live.mjs [--shots <dir>]
//   KYBERNOS_SERVER_DIR=<kybernos-server checkout> node scripts/check-mobile-remote-live.mjs --real [--shots <dir>]
//
// Without --real the relay is the stand-in of the bundle. With --real it is the REAL Kybernos server (the application on an
// embedded Postgres, scripts/replica.ts there) behind a public https tunnel (ngrok): the phone page is served from a real https
// origin, the plan that lists the phone link is published through the server's own admin API, and the DSH is connected the way a
// person's is (device approval). The relay's side of the conversation is then only what the server itself answers.
//
// It writes a server entry and a connection into the isolated instance (and puts them back), never into the real DSH.
// The host half only loads when that instance starts: restart it (scripts/sandbox/stop.sh, then start.sh) after a host edit.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  await sleep(500)

  // 1. the sidebar's phone button
  console.log('the sidebar\'s phone panel')
  const phoneButton = `(() => { const bs = Array.from(document.querySelectorAll('button.kbfp-ico')); return bs.length ? bs[0] : null })()`
  const opened = await ev(D, `(() => { const b = ${phoneButton}; if (!b) return false; b.click(); return true })()`)
  check('the footer has the phone button (the account card is there: the stand-in server signed this DSH in)', opened === true)
  const panelUp = await until(D, `!!document.querySelector('[data-kb="mobile-panel"] [data-kb="mobile-qr"] svg')`, 20000)
  check('opening it shows a real QR code, not the preview', panelUp === true)
  check('the preview note is gone', (await text(D, '.kbf-qrnote')) === null)
  await shot(D, '1-panel')

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

  // 2. the settings page, reached from the panel
  console.log('Settings › Mobile')
  check('the panel offers « Manage phones »', await exists(D, '[data-kb="mobile-manage"]'))
  await click(D, '[data-kb="mobile-manage"]')
  const pageUp = await until(D, `!!document.querySelector('[data-kb="mobile-page"]')`, 15000)
  check('it opens Settings › Mobile', pageUp === true)
  check('the page shows the pairing in progress (same QR, the person did not start another)', await exists(D, '[data-kb="mobile-page"] [data-kb="mobile-qr"] svg'))
  await sleep(600)
  await shot(D, '2-settings')
  const link2 = await ev(D, decode, 15000)
  check('and it is the same code (one pairing at a time)', link2 === link)

  // 3. the phone scans it
  console.log('the phone')
  phone = await openPhone()
  const P = phone.page
  await P.send('Page.navigate', { url: link })
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
  const running = await until(P, `window.__kb.state === 'running'`, 20000)
  check('after approval the phone runs the computer\'s page', running === true, await ev(P, `JSON.stringify(window.__kb)`))
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

  // 3b. the phone is locked for a few seconds: its connection to the relay drops, the PAGE STAYS OPEN (nothing reloads it).
  //     The tunnelled sockets of DSH's page must be told, or the page believes they are still open and never reconnects:
  //     the chat then no longer answers (measured on a real Android phone, 2026-10-12).
  console.log('the phone is locked, then woken')
  const beforeLock = JSON.parse(await ev(P, `JSON.stringify(window.__kb)`))
  const cut = await backend.dropPhoneLink()
  if (cut === null) console.log('  ○ not played: the relay is the real server (one phone socket cannot be cut from here)')
  else {
    check('the relay cut the phone\'s connection', cut >= 1, cut)
    const back3 = await until(P, `window.__kb.state === 'running' && (document.getElementById('veil').hidden === true)`, 30000)
    check('the phone resumes by itself (no new code, no approval) and the veil goes', back3 === true, await ev(P, `JSON.stringify({ state: window.__kb.state, veil: document.getElementById('veil').textContent, log: window.__kb.log })`))
    const reopened = await until(P, `window.__kb.wsOpen > ${beforeLock.wsOpen}`, 25000)
    check('DSH\'s own streaming socket opens again by itself', reopened === true, await ev(P, `JSON.stringify({ wsOpen: window.__kb.wsOpen, was: ${beforeLock.wsOpen}, wsMsgs: window.__kb.wsMsgs, log: window.__kb.log })`))
    const probe = await ev(P, `(async () => {
      const w = document.getElementById('app').contentWindow
      const http = await w.fetch('/', { cache: 'no-store' }).then((r) => r.status, () => 0)
      const sock = await new Promise((resolve) => {
        let done = false
        const s = new w.WebSocket('/api/remote.mux')
        const fin = (v) => { if (!done) { done = true; try { s.close() } catch (e) { /* gone */ } resolve(v) } }
        s.addEventListener('open', () => fin('open'))
        s.addEventListener('close', (e) => fin('closed:' + e.code))
        setTimeout(() => fin('timeout'), 10000)
      })
      return { http, sock }
    })()`, 25000)
    check('a request goes through the resumed tunnel', probe !== null && probe.http === 200, probe)
    check('and so does a new streaming socket', probe !== null && probe.sock === 'open', probe)
    await shot(P, '3b-after-lock')
  }

  // 4. the phone page is reloaded: no QR code any more, the paired phone resumes by itself
  console.log('the phone comes back')
  const firstLoadBytes = kb.bytes
  await P.send('Page.navigate', { url: ORIGIN + '/__kb/' })
  const back = await until(P, `window.__kb && window.__kb.state === 'running'`, 30000)
  check('reloading the phone page resumes with no new code and no approval', back === true, await ev(P, `JSON.stringify(window.__kb || null)`))
  await sleep(4000)
  const kb2 = JSON.parse(await ev(P, `JSON.stringify(window.__kb)`))
  const dom2 = await ev(P, `(() => { const f = document.getElementById('app'); const d = f && f.contentDocument; return d ? { title: d.title, slots: d.querySelectorAll('[data-slot]').length } : null })()`)
  check('DSH is there again', dom2 !== null && dom2.title === 'Kybernos' && dom2.slots > 10, dom2)
  check('the hashed files came from the phone\'s cache (the second load is much lighter)', kb2.bytes < firstLoadBytes * 0.5, { first: firstLoadBytes, second: kb2.bytes })
  check('the computer still lists one phone, and it is the same', (await ev(D, `document.querySelectorAll('[data-kb="mobile-device"]').length`)) === 1)
  await shot(P, '4b-resumed-phone')

  // 5. the computer's list, then revoking
  console.log('the paired phone')
  const listed = await until(D, `document.querySelectorAll('[data-kb="mobile-device"]').length === 1`, 15000)
  check('the computer lists the paired phone', listed === true)
  check('it shows as connected', /Connect|onnected/u.test(String(await text(D, '[data-kb="mobile-device"]'))), await text(D, '[data-kb="mobile-device"]'))
  await shot(D, '5-devices')
  await click(D, '[data-kb="mobile-revoke"]')
  await sleep(200)
  await click(D, '[data-kb="mobile-revoke-confirm"]')
  const revoked = await until(P, `window.__kb.state === 'revoked'`, 20000)
  check('revoking cuts the phone off', revoked === true, await ev(P, `JSON.stringify(window.__kb.state)`))
  check('the server forgot the device', (await backend.serverDevices()) === 0)
  check('the list is empty again', await until(D, `document.querySelectorAll('[data-kb="mobile-device"]').length === 0`, 10000))
  await shot(P, '6-revoked-phone')

  // 6. a plan without the feature
  console.log('a plan without the phone link')
  await backend.setPhoneLink(false)
  await click(D, '[data-kb="mobile-new-code"]')
  await sleep(300)
  await ev(D, `(() => { const b = document.querySelector('[data-kb="mobile-pair"]'); if (b) b.click(); return !!b })()`)
  const wall = await until(D, `!!document.querySelector('[data-kb="mobile-paywall"]')`, 15000)
  check('the page says « Included in paid plans »', wall === true)
  check('and no QR code is offered', !(await exists(D, '[data-kb="mobile-page"] [data-kb="mobile-qr"]')))
  await shot(D, '7-paywall')
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
