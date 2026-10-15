#!/usr/bin/env node
// The Kyber tab (packages/kybernos-kyber), in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-kyber-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
//
// What it checks, in a real page: the tab opens in the right sidebar; with the cloud plugin's two answers fed in (a sandbox has no
// account), the Telegram card (name, date, the bot's link, the account link), the computer card (asleep, image, network) and the
// approvals line; then the states a person meets before that (signed out, door off, not connected, no computer).
//
// SAFETY: the sandbox has its own DSH_HOME; nothing is written outside it. The two answers are fed by replacing the page's `fetch`
// for those two paths only; nothing is sent to any server. Exit code 0 / 1 / 3.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const paneText = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-pane"]'); return p ? p.innerText : null })()`)
const hrefOf = (kb) => val(`(() => { const a = document.querySelector('[data-kb="${kb}"]'); return a ? a.getAttribute('href') : null })()`)

// What the cloud plugin answers a signed-in person on a server (the page's fetch is replaced for these two paths only).
const feed = (kyber, server) => val(`(() => {
  if (!window.__kbRealFetch) window.__kbRealFetch = window.fetch.bind(window)
  window.__kbKyber = ${JSON.stringify(kyber)}
  window.__kbServer = ${JSON.stringify(server)}
  window.fetch = (url, init) => {
    const u = String(url)
    const json = (v) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } }))
    if (u.indexOf('/kybernos-cloud/kyber') >= 0) return json(window.__kbKyber)
    if (u.indexOf('/kybernos-cloud/server') >= 0) return json(window.__kbServer)
    return window.__kbRealFetch(url, init)
  }
  return true
})()`)
const SERVER = { ok: true, server: { id: 'dev', api: 'https://server-dev-7831.up.railway.app', web: 'https://dev.kybernos.app' } }
const LINKED = {
  ok: true,
  connected: true,
  telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: { display: 'Miled @milede', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } },
  home: { state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-14T22:50:00.000Z', version: 'p12', network: 'public' },
}

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }
  console.log('── 1. the tab ──')
  // a session must be mounted for the right sidebar: write a first message from the empty composer (no model here, the turn fails, that is fine)
  const composer = await poll(() => val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`), 15000)
  if (typeof composer === 'string') {
    const { x, y } = JSON.parse(composer)
    await mouse(x, y)
    await sleep(300)
    await page.send('Input.insertText', { text: 'Kyber check' })
    await sleep(300)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(2500)
  }
  check('the plugin exposes its diagnostics hook', (await poll(() => val(`typeof (window.__KB_KYBER__ && window.__KB_KYBER__.open) === 'function'`), 10000)) === true)
  await feed(LINKED, SERVER)
  check('open() reaches the sidebar', (await val(`window.__KB_KYBER__.open()`)) === true)
  const pane = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-pane"]'); return !!p && p.getClientRects().length > 0 })()`), 15000)
  check('the Kyber tab opens in the right sidebar', pane === true)
  // the page was loaded before the fed answers: the refresh button reads them again
  await poll(async () => (await paneText()) !== null && /Telegram/.test(await paneText()), 8000)
  await val(`(() => { const b = document.querySelector('[data-kb="kybernos-kyber-refresh"]'); if (b) b.click(); return true })()`)
  await sleep(800)

  console.log('\n── 2. a person connected, with a Home computer ──')
  const t = (await paneText()) || ''
  check('the Telegram card names the person', /Miled @milede/.test(t), t.slice(0, 200))
  check('the card says since when', /depuis le|since/.test(t))
  check('the computer card says it is asleep, with its image', /En veille|Asleep/.test(t) && /p12/.test(t), t.slice(0, 300))
  check('it says what the computer may reach', /toutes les adresses publiques|any public address/.test(t))
  check('it says the computer asks for approval in Telegram', /Autoriser|Allow/.test(t) && /Telegram/.test(t))
  check('the bot link goes to Telegram', (await hrefOf('kybernos-kyber-bot')) === 'https://t.me/kybernos_bot', await hrefOf('kybernos-kyber-bot'))
  check('the account link goes to the server\'s account page', (await hrefOf('kybernos-kyber-account')) === 'https://server-dev-7831.up.railway.app/account', await hrefOf('kybernos-kyber-account'))
  check('the links open in a new tab, without opener', (await val(`(() => { const a = document.querySelector('[data-kb="kybernos-kyber-bot"]'); return !!a && a.target === '_blank' && /noopener/.test(a.rel) })()`)) === true)
  await shot('1-linked')

  console.log('\n── 2b. the menu row and its page ──')
  const rowPos = await val(`(() => { const e = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')).filter((x) => (x.innerText || '').trim() === 'Kyber' && x.getClientRects().length > 0 && x.getBoundingClientRect().x < 300)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  check('the sidebar has a Kyber row in its menu', typeof rowPos === 'string', rowPos)
  if (typeof rowPos === 'string') {
    const { x, y } = JSON.parse(rowPos)
    await mouse(x, y)
    const page2 = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-page"]'); return !!p && p.getClientRects().length > 0 })()`), 15000)
    check('the row opens the Kyber page', page2 === true)
    await val(`(() => { const b = document.querySelector('[data-kb="kybernos-kyber-page"] [data-kb="kybernos-kyber-refresh"]'); if (b) b.click(); return true })()`)
    await sleep(900)
    const pt = (await val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-page"]'); return p ? p.innerText : null })()`)) || ''
    check('the page shows the two cards', /Miled @milede/.test(pt) && /En veille|Asleep/.test(pt), pt.slice(0, 200))
    await shot('1b-page')
  }

  console.log('\n── 3. the states before that ──')
  await feed({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, home: null }, SERVER)
  await val(`document.querySelector('[data-kb="kybernos-kyber-refresh"]').click()`)
  await sleep(800)
  let s = (await paneText()) || ''
  check('not connected: it says to write /start, and that no computer exists yet', /\/start/.test(s) && /Pas encore d|No computer yet/.test(s), s.slice(0, 260))
  await shot('2-unlinked')
  await feed({ ok: true, connected: true, telegram: { configured: false, enabled: false, bot: null, linked: null }, home: null }, SERVER)
  await val(`document.querySelector('[data-kb="kybernos-kyber-refresh"]').click()`)
  await sleep(800)
  s = (await paneText()) || ''
  check('a door that is off says so and shows no bot button at all', /pas activée|not turned on/.test(s) && (await val(`document.querySelector('[data-kb="kybernos-kyber-bot"]') === null`)) === true, s.slice(0, 200))
  await feed({ ok: true, connected: false }, SERVER)
  await val(`document.querySelector('[data-kb="kybernos-kyber-refresh"]').click()`)
  await sleep(800)
  s = (await paneText()) || ''
  check('signed out: it says to sign in', /Connectez-vous|Sign in/.test(s), s.slice(0, 200))
  await shot('3-signed-out')

  console.log('\n── 4. layout ──')
  const overflow = await val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-pane"]'); return !!p && p.scrollWidth > p.clientWidth + 1 })()`)
  check('the pane does not overflow sideways', overflow === false)
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed: ' + (e && e.message ? e.message : String(e)))
} finally {
  await live.close().catch(() => {})
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
