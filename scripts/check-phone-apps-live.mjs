// Live check of the phone page's two installable apps (« Kybernos à distance » at /__kb/, « Kaby » at /__kb/kaby/), on the REAL GUI of an isolated DSH
// and phones that are headless Chromes with touch, a phone user agent and, where it matters, an iPhone's `navigator.standalone`. The relay is the bundle's
// stand-in; nothing here touches the real DSH.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh        # an isolated instance serving this checkout
//   node scripts/check-phone-apps-live.mjs [--shots <dir>]
//
// What it plays:
//   Android  pair → the offer (two cards, the native prompt, the other app's own page) → Kaby's page resumes the SAME pairing and opens Kaby's chat
//   iPhone   the link in Safari offers to install first and copies the link → an app (standalone, empty storage) pastes it and links → revoked: paste again
// The host half only loads when the instance starts; this check changes no host code.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'
import { startBackend } from './lib-mobile-remote-backend.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
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

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const backend = await startBackend({ real: false, log: (m) => console.log('  . ' + m) }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const ORIGIN = backend.phoneOrigin

const phones = []
/** A phone: its own headless Chrome (so its own storage), touch, a user agent, French, and a clipboard the check can read and fill. */
async function openPhone ({ ua, port, standalone = false }) {
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const profile = mkdtempSync(join(tmpdir(), 'kb-phone-'))
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let target = null
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(500)
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') || null } catch (e) { /* starting */ }
  }
  if (target === null) { chrome.kill(); throw new Error('the phone browser did not start') }
  const page = await connect(target)
  await page.send('Runtime.enable', {})
  await page.send('Page.enable', {})
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'fr-FR', platform: ua.includes('iPhone') ? 'iPhone' : 'Linux armv8l' })
  // Chrome cannot emulate `display-mode`: an iPhone's own flag stands for "running as an app" (the page reads both)
  if (standalone) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })` })
  // the clipboard: what the page writes is kept in window.__clip, what it reads is window.__clipIn
  // Chrome's own install event is not what this check plays (a headless desktop Chrome may fire it): only the ones the check makes reach the page
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.addEventListener('beforeinstallprompt', (e) => { if (e.isTrusted) e.stopImmediatePropagation() }, true)` })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = String(t) }, readText: async () => String(window.__clipIn || '') } })` })
  const phone = { page, close: async () => { try { page.close() } catch (e) { /* gone */ } try { chrome.kill() } catch (e) { /* gone */ } await sleep(300); try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ } } }
  phones.push(phone)
  return phone
}

let desktop = null
try {
  desktop = await openLivePage({ width: 1300, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const D = desktop.page
  const ev = async (page, js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { __err: r.err } : r.val }
  const shot = async (page, name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
  const q = (sel) => JSON.stringify(sel)
  const exists = async (page, sel) => (await ev(page, `!!document.querySelector(${q(sel)})`)) === true
  const text = async (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null })()`)
  const click = async (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const clickText = async (page, sel, re) => ev(page, `(() => { const e = Array.from(document.querySelectorAll(${q(sel)})).find((x) => ${re}.test(x.textContent)); if (!e) return false; e.click(); return true })()`)
  const until = async (page, js, ms = 15000) => (await waitFor(page, js, ms)) !== null
  const state = (page) => ev(page, `window.__kb ? window.__kb.state : null`)

  await until(D, `document.readyState === 'complete'`, 20000)
  await sleep(2500)
  await ev(D, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
  await sleep(500)

  // The pairing link the account menu's window shows (decoded from its QR code by Chrome), as many times as the check needs one.
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
  async function newLink () {
    if (await exists(D, '[data-kb="phone-channels"]')) { await click(D, '[data-kb="phone-channels-close"]'); await until(D, `!document.querySelector('[data-kb="phone-channels"]')`, 8000) }
    await ev(D, `(() => { const b = document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain'); if (!b) return false; b.click(); return true })()`)
    await sleep(600)
    await ev(D, `(() => { const e = document.querySelector('[data-kb="menu-phone"]'); if (!e) return false; e.click(); return true })()`)
    await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="mobile-pair"]')`, 20000)
    await click(D, '[data-kb="phone-channels"] [data-kb="mobile-pair"]')
    await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="mobile-qr"] svg')`, 20000)
    await sleep(400)
    return ev(D, decode, 15000)
  }
  const approve = async (P) => {
    const sas = await ev(P, `window.__kb && window.__kb.sas`)
    await until(D, `!!document.querySelector('[data-kb="mobile-sas"]')`, 15000)
    const same = (await text(D, '[data-kb="mobile-sas"]')) === sas
    await click(D, '[data-kb="mobile-approve"]')
    return same
  }
  const fireInstallPrompt = (P) => ev(P, `(() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1 }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); return true })()`)

  // ═══ Android: Chrome, one browser for both apps ═══════════════════════════════════════════════════════════════════
  console.log('Android: the pairing, then the offer')
  const link = await newLink()
  check('the computer shows a pairing link', typeof link === 'string' && link.startsWith(ORIGIN + '/__kb/#'), link)
  const A = await openPhone({ ua: ANDROID_UA, port: 9411 })
  const P = A.page
  await P.send('Page.navigate', { url: link })
  check('the phone reaches the 4-digit check', await until(P, `window.__kb && window.__kb.state === 'verify'`, 20000))
  check('the computer shows the same 4 digits', await approve(P) === true)
  check('after approval the phone offers the install, it does not run DSH yet', await until(P, `window.__kb.state === 'install'`, 20000), await state(P))
  const cards = await ev(P, `Array.from(document.querySelectorAll('#apps .app')).map((c) => ({ name: c.querySelector('b').textContent, icon: c.querySelector('img').getAttribute('src'), button: (c.querySelector('button') || {}).textContent || null }))`)
  check('two cards: the remote and Kaby, each with the server-drawn icon and an install button', Array.isArray(cards) && cards.length === 2 && cards[0].icon === '/__kb/icon-192.png' && cards[1].icon === '/__kb/kaby-192.png' && /nstall/u.test(cards[0].button) && cards[1].name === 'Kaby', cards)
  check('the page title says the phone is linked, in the phone\'s language', /relié|linked/iu.test(String(await text(P, '#title'))), await text(P, '#title'))
  check('the install screen is the gate, DSH is hidden behind it', (await ev(P, `document.getElementById('app').hidden && !document.getElementById('gate').hidden`)) === true)
  await shot(P, 'a1-offer')
  check('no manifest event yet: the install button shows Chrome\'s menu instead', await (async () => { await click(P, '#apps .app:nth-child(1) button'); return until(P, `!document.getElementById('steps').hidden && document.querySelectorAll('#steps li').length === 1`, 4000) })())
  await fireInstallPrompt(P)
  await click(P, '#apps .app:nth-child(1) button')
  check('with the browser\'s prompt it is used, and the card says it is installed', await until(P, `window.__prompted === 1 && !!document.querySelector('#apps .app:nth-child(1) .done')`, 6000), await ev(P, `window.__prompted`))
  check('the way on is now « continue »', /Continu|Continue/u.test(String(await text(P, '#actions button.primary'))), await text(P, '#actions button'))
  await shot(P, 'a2-installed')

  // The other app is another page with its own manifest: it opens its own offer, without connecting.
  await click(P, '#apps .app:nth-child(2) button')
  check('Kaby\'s card opens Kaby\'s own page', await until(P, `location.pathname === '/__kb/kaby/' && window.__kb && window.__kb.state === 'install'`, 15000), await ev(P, `location.href`))
  check('that page has its own manifest and its own name', (await ev(P, `document.querySelector('link[rel=manifest]').getAttribute('href')`)) === '/__kb/kaby.webmanifest' && (await ev(P, `document.title`)) === 'Kaby' && (await ev(P, `document.querySelector('link[rel=apple-touch-icon]').getAttribute('href')`)) === '/__kb/kaby-180.png')
  check('the address is clean (no ?install=1 left)', (await ev(P, `location.search === ''`)) === true)
  await fireInstallPrompt(P)
  await click(P, '#apps .app:nth-child(2) button')
  check('Kaby installs from its own page', await until(P, `window.__prompted === 1 && !!document.querySelector('#apps .app:nth-child(2) .done')`, 6000))
  await shot(P, 'a3-kaby-offer')
  await clickText(P, '#actions button', '/Continu|Continue/u')
  check('Kaby\'s page resumes the SAME pairing (the storage is the browser\'s), without a new code', await until(P, `window.__kb.state === 'running'`, 30000), await state(P))
  await sleep(6000)

  // Kaby's page opens Kaby's conversation: DSH has no address for it, the bridge in kybernos-kyber does it.
  console.log('Android: Kaby\'s app opens Kaby\'s conversation')
  const t0 = Date.now()
  const onKaby = `(() => { const d = document.getElementById('app').contentDocument; return !!d.querySelector('[data-kb="kybernos-kyber-dock"]') && !!d.querySelector('textarea, [contenteditable="true"], [role="textbox"]') })()`
  const bridged = await until(P, onKaby, 90000)
  console.log('  . Kaby\'s chat was on screen ' + ((Date.now() - t0) / 1000 + 6).toFixed(1) + ' s after the page started running')
  const kyby = await ev(P, `(() => { const w = document.getElementById('app').contentWindow; try { return { sid: w.__KB_KYBER__.state().kybySid, failed: w.__KB_KYBER__.state().openFailed, cur: w.localStorage.getItem('dsh.sessions.current'), path: w.parent.location.pathname } } catch (e) { return String(e) } })()`)
  check('DSH shows Kaby\'s own chat (its strip sits above the composer of that chat and no other), and it is the session the host remembers', bridged === true && kyby !== null && typeof kyby === 'object' && typeof kyby.cur === 'string' && kyby.cur.includes(kyby.sid), kyby)
  // The strip is ONE line in the app, never open by itself: the conversation is what the person came for.
  const folded = await ev(P, `(() => { const d = document.getElementById('app').contentDocument; return !!d.querySelector('[data-kb="kybernos-kyber-dock"]') && !d.querySelector('[data-kb="kybernos-kyber-strip"].open') })()`)
  check('the strip above the composer is one line, nothing open', folded === true)
  await shot(P, 'a4-kaby-chat')

  // The remote's page does not take that decision: it is the whole computer.
  await P.send('Page.navigate', { url: ORIGIN + '/__kb/' })
  check('the remote page also resumes the same pairing', await until(P, `window.__kb && window.__kb.state === 'running'`, 30000), await state(P))
  check('and offers nothing again (the offer is for a new pairing)', (await ev(P, `document.getElementById('gate').hidden`)) === true)

  // ═══ iPhone: an app keeps its own storage ═══════════════════════════════════════════════════════════════════════
  console.log('iPhone: install first, then link by pasting')
  const link2 = await newLink()
  check('the computer shows a second pairing link', typeof link2 === 'string' && link2 !== link, link2)
  const S = await openPhone({ ua: IPHONE_UA, port: 9412 })
  await S.page.send('Page.navigate', { url: link2 })
  check('in Safari the link offers to install first (nothing is paired yet)', await until(S.page, `window.__kb && window.__kb.state === 'install'`, 20000), await state(S.page))
  check('the secrets left the address bar', (await ev(S.page, `location.hash === '' && !location.href.includes('#')`)) === true)
  const acts = await ev(S.page, `Array.from(document.querySelectorAll('#actions button')).map((b) => b.textContent)`)
  check('it offers « copy the link » and « link here instead »', Array.isArray(acts) && acts.length === 2, acts)
  await clickText(S.page, '#apps .app button', '/Comment faire|How to/u')
  check('« how to » lists the three steps (Share, Add to Home Screen, paste)', await until(S.page, `!document.getElementById('steps').hidden && document.querySelectorAll('#steps li').length === 3`, 4000), await ev(S.page, `document.querySelectorAll('#steps li').length`))
  await shot(S.page, 'i1-ios-steps')
  await click(S.page, '#actions button.primary')
  const copied = await until(S.page, `typeof window.__clip === 'string' && window.__clip.length > 100`, 6000)
  check('the full pairing link (with its secrets) went to the clipboard', copied === true && (await ev(S.page, `window.__clip`)) === link2, await ev(S.page, `window.__clip`))

  // The app: a fresh storage, standalone. It pastes the link it was given and links itself.
  const App = await openPhone({ ua: IPHONE_UA, port: 9413, standalone: true })
  await App.page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__clipIn = ${JSON.stringify(link2)}` })
  await App.page.send('Page.navigate', { url: ORIGIN + '/__kb/' })
  check('the app starts on « paste the link » (it has no pairing, and the camera cannot reach it)', await until(App.page, `window.__kb && window.__kb.state === 'scan'`, 20000), await state(App.page))
  check('with a paste button, and the words for it', /Coller|Paste/u.test(String(await text(App.page, '#actions button'))) && /Colle|Paste/u.test(String(await text(App.page, '#sub'))), await text(App.page, '#sub'))
  await shot(App.page, 'i2-app-paste')
  await click(App.page, '#actions button.primary')
  check('pasting the link starts the pairing', await until(App.page, `window.__kb.state === 'verify'`, 20000), await state(App.page))
  check('the computer shows the same 4 digits', await approve(App.page) === true)
  check('the app runs the computer\'s page and offers no install (it is the app)', await until(App.page, `window.__kb.state === 'running'`, 30000), await state(App.page))
  check('the computer lists it as an app, not as a browser', await until(D, `Array.from(document.querySelectorAll('[data-kb="mobile-device"]')).some((e) => /iPhone/u.test(e.textContent) && /app/iu.test(e.textContent))`, 25000), await ev(D, `Array.from(document.querySelectorAll('[data-kb="mobile-device"]')).map((e) => e.textContent)`))
  await sleep(4000)
  await shot(App.page, 'i3-app-running')

  // Revoked: the key goes, and the app can link again by pasting.
  console.log('iPhone: revoked')
  await ev(D, `(() => { const rows = Array.from(document.querySelectorAll('[data-kb="mobile-device"]')); const row = rows.find((e) => /iPhone/u.test(e.textContent)); const b = row && row.querySelector('[data-kb="mobile-revoke"]'); if (b) b.click(); return !!b })()`)
  await sleep(300)
  await click(D, '[data-kb="mobile-revoke-confirm"]')
  check('revoking cuts the app off', await until(App.page, `window.__kb.state === 'revoked'`, 20000), await state(App.page))
  check('it offers to paste a new link', /Coller|Paste/u.test(String(await text(App.page, '#actions button'))) && /colle|paste/iu.test(String(await text(App.page, '#sub'))), await text(App.page, '#sub'))
  await shot(App.page, 'i4-app-revoked')
  // Not a link: the app says so, it does not try to pair.
  await App.page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__clipIn = 'https://example.com/#not-a-link'` })
  await ev(App.page, `window.__clipIn = 'https://example.com/#not-a-link'`)
  await click(App.page, '#actions button.primary')
  check('a pasted text that is not a pairing link is refused, with a field to type in', await until(App.page, `!document.getElementById('pasteBox').hidden && !document.getElementById('veil').hidden`, 6000), await text(App.page, '#veil'))
} catch (e) {
  fail += 1
  console.log('  ✗ exception — ' + (e && e.stack ? e.stack : e))
} finally {
  for (const p of phones) await p.close()
  if (desktop !== null) await desktop.close()
  await backend.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
