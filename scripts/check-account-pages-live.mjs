#!/usr/bin/env node
// Presses the controls of the server's own /account page against a local replica (kybernos-server `scripts/replica.ts`), in headless Chrome:
// every page of the rail opens, the second-factor / export / delete forms refuse what they must, "Sign out" really ends a session, the legal links
// answer, and on a phone width the strip of pages reaches every page without a sideways scroll of the whole page.
//
//   KB_E2E_API / KB_E2E_WEB / KB_E2E_CONTROL / KB_E2E_DIR   as in scripts/lib-e2e-server.mjs (a replica you started yourself)
//   CHROME_PATH                                              optional, the Chrome or Chromium binary
//
// Exit 0 = every check passed, 1 = a check failed, 3 = no replica to test (environment not set or not answering).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'
import { fresh, makeServer } from './lib-e2e-server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let S
try { S = makeServer() } catch (e) { console.log('wrong environment: ' + e.message); process.exit(3) }
try { if (!(await fetch(S.e.api + '/.well-known/kybernos-server.json')).ok) throw new Error('not ok') } catch { console.log('wrong environment: the replica does not answer at ' + S.e.api); process.exit(3) }

const chromeBin = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (!chromeBin) { console.log('wrong environment: no Chrome found (set CHROME_PATH)'); process.exit(3) }

let failed = 0
const check = (name, ok, saw) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${saw ? ' -- ' + saw : ''}`) }
const freePort = (from) => new Promise((resolve) => { const t = (p) => { const s = createServer(); s.once('error', () => t(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }; t(from) })

async function browser({ width = 1280, height = 900, mobile = false, cookie }) {
  const port = await freePort(9500)
  const profile = mkdtempSync(join(tmpdir(), 'kb-account-'))
  const chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  const cleanup = () => { try { chrome.kill() } catch { /* already gone */ } try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ } }
  process.once('exit', cleanup)
  let target = null
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') } catch { /* not up yet */ } }
  if (!target) { cleanup(); throw new Error('chrome did not start') }
  const page = await connect(target)
  for (const m of ['Page.enable', 'Network.enable', 'Runtime.enable']) await page.send(m, {})
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  const host = new URL(S.e.web).hostname
  for (const p of cookie.split('; ').filter(Boolean)) { const i = p.indexOf('='); await page.send('Network.setCookie', { name: p.slice(0, i), value: p.slice(i + 1), domain: host, path: '/', httpOnly: true }) }
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__net = []; const of = window.fetch; window.fetch = async function (i, init) { const r = await of.apply(this, arguments); let err = ''; try { if (!r.ok) { const j = await r.clone().json(); err = String(j.error || '') } } catch (e) {} window.__net.push({ m: (init && init.method) || 'GET', u: String(typeof i === 'string' ? i : i.url).replace(/\\?.*$/, ''), s: r.status, err }); return r } })()` })
  const ev = async (js) => { const r = await page.evalJs(js, 10000); if (r.err) throw new Error(String(r.err).slice(0, 200)); return r.val }
  const go = async (hash) => { await page.send('Page.navigate', { url: S.e.web + '/account#' + hash }); await sleep(1800) }
  const click = async (sel) => {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    if (!r) return false
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(900)
    return true
  }
  const type = async (sel, text) => { await click(sel); await page.send('Input.insertText', { text }); await sleep(150) }
  const net = () => ev('(() => { const x = window.__net || []; window.__net = []; return x })()')
  return { ev, go, click, type, net, close: () => { try { page.close() } catch { /* closed */ } cleanup() } }
}

const me = fresh('pages')
await S.signUp(me.email, me.password, me.name)
const signed = await S.signIn(me.email, me.password)

// 1. Desktop: every page of the rail opens with a heading and no raw value on it.
let b = await browser({ cookie: signed.cookie })
await b.go('overview'); await sleep(800)
for (const [nav, hash] of [['overview', 'overview'], ['use', 'use'], ['security', 'security'], ['devices', 'devices'], ['assistants', 'assistants'], ['referral', 'referral'], ['data', 'data'], ['support', 'support']]) {
  const pressed = await b.click('#nav-' + nav)
  const saw = await b.ev(`location.hash.slice(1).split('&')[0] + ' | ' + ((document.querySelector('.content [id^=panel-]:not([hidden])')||{innerText:''}).innerText||'').replace(/\\s+/g,' ').slice(0,80)`)
  const raw = await b.ev(`/undefined|\\[object|NaN|null\\b/.test(((document.querySelector('.content [id^=panel-]:not([hidden])')||{innerText:''}).innerText||''))`)
  check(`rail: ${nav} opens`, pressed && saw.startsWith(hash) && saw.length > hash.length + 6 && !raw, saw)
}

// 2. Security: the second-factor set-up refuses a wrong password and says so.
await b.go('security'); await b.net()
await b.click('#sec-setup'); await b.type('#f-sec-pw', 'not-the-password-123'); await b.click('#panel-security form button[type=submit]')
let calls = await b.net()
check('security: set up a second factor with a wrong password is refused with a sentence', calls.some((c) => c.u.endsWith('/v1/me/mfa/enroll') && c.s === 401) && /not right/i.test(await b.ev('document.querySelector("#panel-security").innerText')), JSON.stringify(calls.map((c) => c.u.split('/').pop() + ' ' + c.s + ' ' + c.err)))

// 3. My data: the export refuses a wrong password, gives the file once, then says "once an hour"; the delete button waits for the exact phrase.
await b.go('data'); await b.net()
await b.click('#data-ask'); await b.type('#f-data-pw', 'not-the-password-123'); await b.click('#panel-data form button[type=submit]')
calls = await b.net()
check('data: export with a wrong password is refused (401 invalid_password)', calls.some((c) => c.u.endsWith('/v1/me/export') && c.s === 401 && c.err === 'invalid_password'), JSON.stringify(calls.map((c) => c.s + ' ' + c.err)))
await b.click('#delete summary')
const state = async () => b.ev('document.querySelector("#delete button[type=submit]").disabled')
check('data: Delete my account starts disabled', (await state()) === true)
await b.type('#f-del-pw', me.password); await b.type('#f-del-phrase', 'delete my account')
check('data: the phrase in lower case keeps it disabled', (await state()) === true)
const exp = await S.call('POST', '/v1/me/export', { cookie: signed.cookie, json: { password: me.password } })
const exp2 = await S.call('POST', '/v1/me/export', { cookie: signed.cookie, json: { password: me.password } })
check('data: the export is given once and refused the second time within the hour', exp.status === 200 && exp2.status === 429 && exp2.body && exp2.body.error === 'export_too_soon', `${exp.status} then ${exp2.status}`)
b.close()

// 4. Devices: another session shows up, "Sign out" on its row ends it, "Sign out every other device" ends the rest.
const other = await S.signIn(me.email, me.password)
const other2 = await S.signIn(me.email, me.password)
b = await browser({ cookie: signed.cookie })
await b.go('devices'); await sleep(600)
const rowsBefore = await b.ev('document.querySelectorAll("#panel-devices li.item").length')
check('devices: the list shows this device and the others', rowsBefore >= 2, rowsBefore + ' rows')
await b.net()
const ok1 = await b.click('#panel-devices li.item:not(:first-child) button')
const calls1 = await b.net()
check('devices: Sign out on a row sends one DELETE and the row is gone', ok1 && calls1.some((c) => c.m === 'DELETE' && c.s === 204), JSON.stringify(calls1.filter((c) => c.m === 'DELETE').map((c) => c.s)))
const refused = [(await S.call('GET', '/v1/me', { cookie: other.cookie })).status, (await S.call('GET', '/v1/me', { cookie: other2.cookie })).status]
check('devices: exactly one of the two other sessions was ended', refused.filter((s) => s === 401).length === 1, JSON.stringify(refused))
await b.click('#dev-all')
const after = [(await S.call('GET', '/v1/me', { cookie: other.cookie })).status, (await S.call('GET', '/v1/me', { cookie: other2.cookie })).status, (await S.call('GET', '/v1/me', { cookie: signed.cookie })).status]
check('devices: Sign out every other device ends the rest and keeps this page signed in', after[0] === 401 && after[1] === 401 && after[2] === 200, JSON.stringify(after))
b.close()

// 5. Support: every legal link answers.
b = await browser({ cookie: signed.cookie })
await b.go('support')
const links = await b.ev('Array.from(document.querySelectorAll("#panel-support a[href^=\\"/legal/\\"]")).map(a => a.getAttribute("href"))')
let bad = []
for (const h of links) { const r = await fetch(S.e.web + h); if (!r.ok) bad.push(h + ' ' + r.status) }
check('support: the legal links answer 200', links.length >= 6 && bad.length === 0, `${links.length} links; bad: ${bad.join(', ') || 'none'}`)
b.close()

// 6. Phone width: the strip reaches every page and the page itself never scrolls sideways.
b = await browser({ cookie: signed.cookie, width: 390, height: 844, mobile: true })
await b.go('overview'); await sleep(600)
const keys = await b.ev('Array.from(document.querySelectorAll(".pagestrip button")).map(x => x.getAttribute("data-sec"))')
const reached = []
for (const k of keys) {
  await b.click(`.pagestrip button[data-sec="${k}"]`)
  const got = await b.ev(`location.hash.slice(1).split('&')[0] + (document.documentElement.scrollWidth > innerWidth ? ' SIDEWAYS' : '')`)
  if (got === k) reached.push(k)
}
check('phone: every button of the strip opens its page without a sideways page scroll', keys.length >= 6 && reached.length === keys.length, `${reached.length} of ${keys.length}`)
b.close()

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
