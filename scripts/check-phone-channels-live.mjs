#!/usr/bin/env node
// « Phone and channels » (packages/kybernos-mobile draws the screen, packages/kybernos-kyber its right-hand column, packages/kybernos-cloud
// the account-menu entry), in a real GUI.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh
//   source scripts/sandbox/env.sh && node scripts/check-phone-channels-live.mjs [--shots <dir>]
//
// Run it against the sandbox (docs/dev/live-testing.md), never the user's own :3080 (exit 3). What is real: the DSH page, the account menu
// and its entry, the window, the Settings page and its nav cell. What is faked, by replacing the page's `fetch` for `/kybernos-cloud/*` and
// `/kybernos-mobile/remote/*` before any script runs: the account (signed in), what the phone link and Kaby's doors say, and the pairing
// gestures; nothing is sent to any server and nothing is paired.
//
// It plays: the entry sits in the account menu just before Settings and opens the window; the two blocks (Remote control, and Kaby with its messaging apps and its computer) in every state of the phone
// link, its on/off switch (nothing linked, a code to scan, a phone asking for the check, a code that ran out, a phone connected, not in the plan, a server
// without the feature) and of Telegram (not linked, a code, linked, no bot on this server); WhatsApp that says it is not available on this
// server, WeChat and iMessage « soon »; Escape and a click on the dim close the window; the Settings page shows the same screen; a phone
// width stacks the columns; light and dark. Exit code 0 / 1 / 3 (not run).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { encodeQr } from '../packages/kybernos-cloud/qr.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const W = '11111111-1111-4111-8111-111111111111'
const CLOUD = { ok: true, connected: true, state: {
  user: { email: 'dev@example.test', name: 'Dev Person', plan: 'free' },
  workspaces: [{ id: W, name: 'Personal', personal: true, role: 'owner' }],
  active_workspace_id: W, space_plan: { key: 'free', label: 'Free', workspace_id: W }, web_url: 'https://dev.kybernos.app', device_label: 'This computer' } }
const LINK = 'https://t.me/kybernos_bot?start=pair_0123456789abcdefghij0123'
const PAIR = '33333333-3333-4333-8333-333333333333'
const tgQr = encodeQr(LINK, { ecc: 'M' })
const phoneUrl = 'https://remote.example.test/p/7KQ2M9XA'
const phoneQr = encodeQr(phoneUrl, { ecc: 'M' })
const SERVER = { ok: true, server: { id: 'dev', api: 'https://server-dev.example.test', web: 'https://dev.kybernos.app' } }
const KYBER = {
  ok: true, connected: true,
  telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null },
  pairing: 'supported', server: { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: true },
  computers: [], home: null,
}
const REMOTE = { ok: true, available: true, running: true, enabled: true, connected: true, configured: true, entitled: true, computer: 'MacBook-de-test', max_devices: 3, relay: 'up', refused: 0, error: null, pairing: null, devices: [] }

// Installed before any script of the page. `window.__pcMock` is what the check drives.
const MOCK = `(() => {
  const m = window.__pcMock = { cloud: ${JSON.stringify(CLOUD)}, kyber: ${JSON.stringify(KYBER)}, server: ${JSON.stringify(SERVER)}, remote: ${JSON.stringify(REMOTE)},
    tgState: { ok: true, state: 'waiting', reason: null, sender: '' }, calls: [],
    tgQr: ${JSON.stringify({ size: tgQr.size, modules: tgQr.modules })}, phoneQr: ${JSON.stringify({ size: phoneQr.size, modules: phoneQr.modules })} }
  const real = window.fetch.bind(window)
  const json = (v) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } }))
  window.fetch = (url, init) => {
    const u = new URL(String(url), location.origin)
    const p = u.pathname
    const method = ((init && init.method) || 'GET').toUpperCase()
    let body = null
    try { body = init && init.body ? JSON.parse(init.body) : null } catch (e) { body = null }
    const rec = () => m.calls.push({ path: p, method, body })
    if (p === '/kybernos-cloud/status') return json(m.cloud)
    if (p === '/kybernos-cloud/kyber') return json(m.kyber)
    if (p === '/kybernos-cloud/server') return json(m.server)
    if (p === '/kybernos-cloud/telegram/pairing' && method === 'POST') { rec(); return json({ ok: true, id: ${JSON.stringify(PAIR)}, link: ${JSON.stringify(LINK)}, bot: 'kybernos_bot', expires_at: new Date(Date.now() + 300000).toISOString(), qr: m.tgQr }) }
    if (p === '/kybernos-cloud/telegram/pairing/state') return json(Object.assign({}, m.tgState, { expires_at: new Date(Date.now() + 200000).toISOString() }))
    if (p === '/kybernos-cloud/telegram/pairing/cancel') { rec(); return json({ ok: true }) }
    if (p === '/kybernos-cloud/telegram/unlink') { rec(); m.kyber.telegram.linked = null; return json({ ok: true }) }
    if (p === '/kybernos-cloud/console/link') { rec(); return json({ ok: true, opened: true }) }
    if (p === '/kybernos-mobile/remote/status') return json(m.remote)
    if (p.indexOf('/kybernos-mobile/remote/') === 0 && method === 'POST') {
      rec()
      const name = p.slice('/kybernos-mobile/remote/'.length)
      if (name === 'pair') m.remote.pairing = { state: 'waiting', expires_at: Date.now() + 300000, qr: m.phoneQr, url: ${JSON.stringify(phoneUrl)}, sas: null, phone_label: null, verify_until: null }
      if (name === 'pair/cancel') m.remote.pairing = null
      if (name === 'pair/approve') { m.remote.pairing = null; m.remote.devices = [{ id: 'd1', label: 'iPhone de test', created_at: Date.now(), last_seen_at: Date.now(), online: true, state: 'serving' }] }
      if (name === 'pair/deny') m.remote.pairing = null
      if (name === 'enable') { m.remote.enabled = body.on === true; if (!m.remote.enabled) m.remote.pairing = null; return json({ ok: true, enabled: m.remote.enabled }) }
      if (name === 'devices/revoke') m.remote.devices = m.remote.devices.filter((d) => d.id !== body.id)
      if (name === 'devices/revoke-all') m.remote.devices = []
      return json({ ok: true })
    }
    return real(url, init)
  }
})()`

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: run this check against the sandbox (scripts/sandbox/*.sh, then `source scripts/sandbox/env.sh`), never the user\'s own DSH.'); process.exit(3) }
const live = await openLivePage({ width: 1400, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const has = (sel) => val(`!!document.querySelector(${JSON.stringify(sel)})`)
const text = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const setMock = (expr) => val(`(() => { const m = window.__pcMock; ${expr}; return true })()`)
const calls = (path) => val(`window.__pcMock.calls.filter((c) => c.path === ${JSON.stringify(path)})`)
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const box = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } })()`)
const setTheme = async (to) => { await val(`window.dispatchEvent(new CustomEvent('kybernos:menu:theme', { detail: { to: ${JSON.stringify(to)} } }))`); await sleep(400) }
const viewport = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(500) }

const openMenu = async () => {
  if ((await has('.kbfp-menu')) === true) return true
  await click('[data-kb="workspace-card"] .kbfp-cardmain')
  return (await poll(() => has('.kbfp-menu'), 6000)) === true
}
const openWindow = async () => {
  if ((await has('[data-kb="phone-channels"]')) === true) return true
  if ((await openMenu()) !== true) return false
  await click('[data-kb="menu-phone"]')
  return (await poll(() => has('[data-kb="phone-channels"]'), 8000)) === true
}
const closeWindow = async () => { await click('[data-kb="phone-channels-close"]'); return (await poll(async () => !(await has('[data-kb="phone-channels"]')), 4000)) === true }

try {
  await page.send('Runtime.enable', {})
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  console.log('Phone and channels — ' + host + ' (the sandbox serves this checkout; the account and the doors are faked)')
  await poll(() => has('[data-kb="workspace-card"]'), 30000)
  // The sandbox\'s first-run dialog sits over the page: Escape closes it.
  for (let i = 0; i < 3 && (await val(`!!document.querySelector('[role="dialog"]')`)) === true; i++) { await key('Escape', 'Escape', 27); await sleep(400) }

  await setTheme('light')
  console.log('── 1. the entry in the account menu ──')
  check('the signed-in card is there', (await has('[data-kb="workspace-card"]')) === true)
  check('the menu opens', (await openMenu()) === true)
  const labels = await val(`Array.from(document.querySelectorAll('.kbfp-menu [role="menuitem"], .kbfp-menu [data-kb="menu-appearance"]')).map((e) => (e.innerText || '').trim().split('\\n')[0])`)
  const order = await val(`Array.from(document.querySelectorAll('.kbfp-menu [data-kb^="menu-"]')).map((e) => e.getAttribute('data-kb'))`)
  check('there is one « Phone and channels » entry', (await val(`document.querySelectorAll('[data-kb="menu-phone"]').length`)) === 1 && (await text('[data-kb="menu-phone"]')) === 'Phone and channels', labels)
  check('it sits just before Settings, after Appearance', order.indexOf('menu-phone') > -1 && order.indexOf('menu-settings') === order.indexOf('menu-phone') + 1, order)
  check('there is no « Remote control » entry any more', (await has('[data-kb="menu-remote"]')) === false && !labels.some((l) => /remote control/i.test(l)), labels)
  await shot('1-menu')
  await click('[data-kb="menu-phone"]')
  check('the entry opens the window and the menu closes', (await poll(() => has('[data-kb="phone-channels"]'), 8000)) === true && (await has('.kbfp-menu')) === false)
  check('the window is a dialog with a title, labelled by it', (await val(`(() => { const d = document.querySelector('[data-kb="phone-channels"]'); const t = document.getElementById(d.getAttribute('aria-labelledby')); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!t && t.innerText === 'Phone and channels' })()`)) === true)
  check('one sentence under the title', /Open this computer from your phone, and reach Kaby from your messaging apps\./.test(await text('[data-kb="phone-channels"]')))
  const lum = (kb) => val(`(() => { const d = document.querySelector('[data-kb="${kb}"]'); const m = getComputedStyle(d).backgroundColor.match(/[\\d.]+/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000 })()`)
  check('light: the window is light', (await lum('phone-channels')) > 200, await lum('phone-channels'))

  console.log('── 2. two blocks, each one saying what it gives ──')
  const left = await text('[data-kb="phone-remote"]')
  const right = await text('[data-kb="phone-channels-card"]')
  check('left: Remote control, tagged Full control, with what it does, what it needs and what to be careful about', /Remote control/.test(left) && (await has('[data-kb="phone-remote-tag"]')) === true && /It does Shows this computer’s Kybernos on your phone/.test(left) && /It needs This computer switched on and online\./.test(left) && /Be careful Full control of this computer \(MacBook-de-test\)\. Use it only on a phone that is yours\./.test(left), left)
  check('right: Kaby, tagged « Always asks first », with its messaging apps (what they do, what they never do) and its computer', /Kaby/.test(right) && /Always asks first/.test(right) && /Messaging apps/.test(right) && /even when this computer is off/.test(right) && /never controls this computer/.test(right) && /Kaby’s computer/.test(right) && (await has('[data-kb="kybernos-kyber-messaging"]')) === true && (await has('[data-kb="kybernos-kyber-computer"]')) === true, right)
  const lb = await box('[data-kb="phone-remote"]')
  const rb = await box('[data-kb="phone-channels-card"]')
  check('on a desktop width the cards sit side by side', lb !== null && rb !== null && Math.abs(lb.y - rb.y) < 4 && rb.x > lb.r - 2 && lb.w > 300 && rb.w > 300, [lb, rb])
  check('nothing asks for a code just by opening the window', (await calls('/kybernos-mobile/remote/pair')).length === 0 && (await calls('/kybernos-cloud/telegram/pairing')).length === 0)
  await shot('2-window-idle-light')

  console.log('── 2b. the « ? How it works » card ──')
  await click('[data-kb="phone-channels"] [data-kb="help-button"][data-id="kybernos-mobile"]')
  check('the pill opens the card of help.json', (await poll(() => has('[data-kb="phone-channels"] [data-kb="help-panel"]'), 5000)) === true)
  const hc = await text('[data-kb="phone-channels"] [data-kb="help-panel"]')
  // The words come from the catalogue the Suite shows: the signed online one wins over the shipped help.json, so until a release publishes the new words this
  // card may still say « Remote Control ». What is asserted is that it has a body (packages/kybernos-mobile/test-help.mjs checks what help.json says).
  check('the card has its text (what it is, the steps, where to find it)', typeof hc === 'string' && hc.length > 120 && /web app/.test(hc) && (await val(`document.querySelectorAll('[data-kb="phone-channels"] [data-kb="help-panel"] ol li').length`)) >= 2, hc)
  const seen = await val(`(() => { const e = document.querySelector('[data-kb="phone-channels"] [data-kb="help-panel"]'); if (!e) return null; const r = e.getBoundingClientRect(); const at = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && e.contains(t) }; return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, topLeft: at(r.left + 8, r.top + 8), right: at(r.right - 8, r.top + r.height / 2), bottomRight: at(r.right - 8, r.bottom - 8) } })()`)
  check('it is wholly on screen, and nothing cuts or covers it', seen !== null && seen.inside === true && seen.topLeft === true && seen.right === true && seen.bottomRight === true, seen)
  await shot('2b-help-card')
  await click('[data-kb="phone-channels"] .kbhp-x')
  check('its cross closes the card and leaves the window', (await has('[data-kb="help-panel"]')) === false && (await has('[data-kb="phone-channels"]')) === true)

  console.log('── 3. the phone link, state by state ──')
  check('nothing linked: the chip says it is ready to pair, the card says nothing can reach this computer, one button adds a phone', /Ready to pair/.test(await text('[data-kb="mobile-chip"]')) && /so nothing can reach this computer/.test(await text('[data-kb="phone-remote"]')) && (await has('[data-kb="mobile-pair"]')) === true)
  await click('[data-kb="mobile-pair"]')
  check('« Add a phone » asks the host for a code (one POST) and shows the QR', (await poll(() => has('[data-kb="mobile-qr"]'), 6000)) === true && (await calls('/kybernos-mobile/remote/pair')).length === 1)
  check('the chip says it is waiting for the phone', /Waiting for the phone/.test(await text('[data-kb="mobile-chip"]')))
  check('three steps, the check of the 4 digits among them', (await val(`document.querySelectorAll('[data-kb="mobile-pairing"] ol li').length`)) === 3 && /4-digit code is the same/.test(await text('[data-kb="mobile-pairing"]')))
  check('Refresh, Copy and Stop are offered', (await has('[data-kb="mobile-new-code"]')) === true && (await has('[data-kb="mobile-copy"]')) === true && (await has('[data-kb="mobile-stop"]')) === true)
  check('the QR is black on white whatever the theme', (await val(`(() => { const s = document.querySelector('[data-kb="mobile-qr"]'); return !!s && getComputedStyle(s).backgroundColor === 'rgb(255, 255, 255)' })()`)) === true)
  await shot('3a-phone-waiting-light')
  await click('[data-kb="mobile-stop"]')
  check('Stop withdraws the code', (await poll(async () => !(await has('[data-kb="mobile-qr"]')), 6000)) === true && (await calls('/kybernos-mobile/remote/pair/cancel')).length === 1)

  await setMock(`m.remote.pairing = { state: 'verify', expires_at: Date.now() + 120000, qr: null, url: null, sas: '4821', phone_label: 'iPhone de test', verify_until: Date.now() + 120000 }`)
  check('a phone asks for the check: the 4 digits, Refuse, Allow', (await poll(() => has('[data-kb="mobile-sas"]'), 6000)) === true && (await text('[data-kb="mobile-sas"]')) === '4821' && /Waiting for your OK/.test(await text('[data-kb="mobile-chip"]')) && /A phone asks for access/.test(await text('[data-kb="mobile-verify"]')) && (await has('[data-kb="mobile-approve"]')) === true && (await has('[data-kb="mobile-deny"]')) === true)
  await shot('3b-phone-verify-light')
  await click('[data-kb="mobile-approve"]')
  check('Allow links the phone: the chip says it is connected, the phone is in the list with a way to disconnect it', (await poll(async () => /Phone connected/.test((await text('[data-kb="mobile-chip"]')) || ''), 6000)) === true && /iPhone de test/.test(await text('[data-kb="mobile-devices"]')) && (await has('[data-kb="mobile-revoke"]')) === true)
  await shot('3c-phone-connected-light')
  await click('[data-kb="mobile-revoke"]')
  await click('[data-kb="mobile-revoke-confirm"]')
  check('Disconnect asks to confirm, then the phone is gone', (await poll(async () => /Ready to pair/.test((await text('[data-kb="mobile-chip"]')) || ''), 6000)) === true)

  // the switch: on by default, off cuts everything
  check('the switch is on by default, and named', (await val(`(() => { const e = document.querySelector('[data-kb="phone-remote-switch"]'); return !!e && e.getAttribute('role') === 'switch' && e.getAttribute('aria-checked') === 'true' && !!e.getAttribute('aria-label') })()`)) === true)
  await click('[data-kb="phone-remote-switch"]')
  check('turning it off asks the host (on: false) and the card says no phone can connect, with a button to turn it on and no way to pair', (await poll(() => has('[data-kb="phone-remote-off"]'), 6000)) === true && /Off\. No phone can connect to this computer\./.test(await text('[data-kb="phone-remote"]')) && (await has('[data-kb="mobile-pair"]')) === false && (await has('[data-kb="phone-remote-turn-on"]')) === true && (await calls('/kybernos-mobile/remote/enable')).some((c) => c.body && c.body.on === false))
  await shot('3f-remote-off-light')
  await click('[data-kb="phone-remote-turn-on"]')
  check('« Turn on » brings the pairing button back', (await poll(() => has('[data-kb="mobile-pair"]'), 6000)) === true && (await calls('/kybernos-mobile/remote/enable')).some((c) => c.body && c.body.on === true))

  await setMock(`m.remote.pairing = { state: 'waiting', expires_at: Date.now() + 1500, qr: m.phoneQr, url: ${JSON.stringify(phoneUrl)}, sas: null, phone_label: null, verify_until: null }`)
  check('a code that runs out says so, and offers a new one', (await poll(async () => /Code expired/.test((await text('[data-kb="mobile-chip"]')) || ''), 8000)) === true && /no longer valid/.test(await text('[data-kb="mobile-pairing"]')) && (await has('[data-kb="mobile-new-code"]')) === true && (await has('[data-kb="mobile-qr"]')) === false)
  await shot('3d-phone-expired-light')
  await setMock(`m.remote.pairing = null`)

  await setMock(`m.remote.entitled = false`)
  check('a plan without the phone link: the left column says so, the right one is still there', (await poll(() => has('[data-kb="mobile-paywall"]'), 6000)) === true && (await has('[data-kb="phone-channels-card"]')) === true && /Messaging apps/.test(await text('[data-kb="phone-channels-card"]')))
  await shot('3e-phone-paywall-light')
  await setMock(`m.remote.entitled = true; m.remote.configured = false`)
  check('a server without the phone link: the left column says so, honestly', (await poll(() => has('[data-kb="mobile-not-offered"]'), 6000)) === true)
  await setMock(`m.remote.configured = true`)
  await poll(() => has('[data-kb="mobile-pair"]'), 6000)

  console.log('── 4. Kaby\'s messaging apps, state by state ──')
  check('four rows in this order: Telegram, WhatsApp, WeChat, iMessage', JSON.stringify(await val(`Array.from(document.querySelectorAll('[data-kb="phone-channels-card"] .kbky-crow b')).map((e) => e.firstChild.textContent)`)) === JSON.stringify(['Telegram', 'WhatsApp', 'WeChat', 'iMessage']), await val(`Array.from(document.querySelectorAll('[data-kb="phone-channels-card"] .kbky-crow b')).map((e) => e.innerText)`))
  check('Telegram: not linked, its switch is off and works', /Not connected/.test(await text('[data-kb="kybernos-kyber-tg-row"]')) && (await val(`document.querySelector('[data-kb="kybernos-kyber-tg-switch"]').getAttribute('aria-checked')`)) === 'false' && (await val(`document.querySelector('[data-kb="kybernos-kyber-tg-switch"]').disabled`)) === false)
  const wa = await text('[data-kb="kybernos-kyber-chan-whatsapp"]')
  check('WhatsApp: a beta that says it is not available on this server', /Beta/.test(wa) && /Not available on this server yet/.test(wa), wa)
  check('WhatsApp, WeChat and iMessage have a switch that is off and cannot be pressed', (await val(`['whatsapp','wechat','imessage'].every((id) => { const s = document.querySelector('[data-kb="kybernos-kyber-' + id + '-switch"]'); return !!s && s.disabled && s.getAttribute('aria-checked') === 'false' })`)) === true)
  check('WeChat and iMessage say « Soon »; iMessage says it is for Macs', /Soon/.test(await text('[data-kb="kybernos-kyber-chan-wechat"]')) && /Soon/.test(await text('[data-kb="kybernos-kyber-chan-imessage"]')) && /Mac only/.test(await text('[data-kb="kybernos-kyber-chan-imessage"]')))
  await shot('4a-channels-idle-light')
  await click('[data-kb="kybernos-kyber-tg-switch"]')
  check('the Telegram switch asks the host for a code (one POST)', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing')).length === 1, 6000)) === true)
  check('the code (QR, three steps, Open Telegram) shows under the Telegram row, above WhatsApp', (await poll(() => has('[data-kb="kybernos-kyber-qr"]'), 6000)) === true && (await val(`(() => { const rows = document.querySelector('[data-kb="phone-channels-card"]'); const p = rows.querySelector('[data-kb="kybernos-kyber-telegram"]'); const t = rows.querySelector('[data-kb="kybernos-kyber-tg-row"]'); const w = rows.querySelector('[data-kb="kybernos-kyber-chan-whatsapp"]'); return !!p && !!t && !!w && (t.compareDocumentPosition(p) & 4) !== 0 && (p.compareDocumentPosition(w) & 4) !== 0 })()`)) === true)
  await shot('4b-telegram-code-light')
  await setMock(`m.tgState = { ok: true, state: 'scanned', reason: null, sender: 'Dev (@dev)' }`)
  check('scanned: the panel names who Telegram says it is, and waits', (await poll(async () => /Dev \(@dev\)/.test((await text('[data-kb="kybernos-kyber-telegram"]')) || ''), 8000)) === true)
  await setMock(`m.kyber.telegram.linked = { display: 'Dev (@dev)', linked_at: '2026-10-19T12:00:00.000Z', paused: false, blocked: false }; m.tgState = { ok: true, state: 'done', reason: null, sender: '' }`)
  check('connected: the row says who it is, the switch is on, the code is gone', (await poll(async () => /Dev \(@dev\)/.test((await text('[data-kb="kybernos-kyber-tg-row"]')) || ''), 10000)) === true && (await val(`document.querySelector('[data-kb="kybernos-kyber-tg-switch"]').getAttribute('aria-checked')`)) === 'true' && (await has('[data-kb="kybernos-kyber-qr"]')) === false)
  await shot('4c-telegram-linked-light')
  await click('[data-kb="kybernos-kyber-tg-switch"]')
  check('turning it off asks first', (await poll(() => has('[data-kb="kybernos-kyber-unlink-yes"]'), 4000)) === true)
  await click('[data-kb="kybernos-kyber-unlink-no"]')
  await setMock(`m.kyber.telegram = { configured: false, enabled: false, bot: null, linked: null }`)
  check('a server with no Telegram bot says why, on the row, and the switch is greyed', (await poll(async () => { await val('window.__KB_KYBER__.refresh()'); return /no Telegram bot/.test((await text('[data-kb="kybernos-kyber-tg-row"]')) || '') }, 8000)) === true && (await val(`document.querySelector('[data-kb="kybernos-kyber-tg-switch"]').disabled`)) === true)
  await shot('4d-telegram-no-bot-light')
  await setMock(`m.kyber.telegram = { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }`)
  await val('window.__KB_KYBER__.refresh()')

  console.log('── 5. dark, and a phone width ──')
  await setTheme('dark')
  await shot('5a-window-dark')
  check('dark: the window is dark', (await lum('phone-channels')) < 90, await lum('phone-channels'))
  check('dark: the cards are not the colour of the window (they read as cards)', (await val(`getComputedStyle(document.querySelector('[data-kb="phone-remote"]')).backgroundColor !== getComputedStyle(document.querySelector('[data-kb="phone-channels"]')).backgroundColor`)) === true)
  await closeWindow()
  // A phone: the sidebar is a drawer; the account menu is in it, and the window opens over it.
  await viewport(390, 844)
  await sleep(800)
  await val(`(() => { const b = document.querySelector('.kbmob-menu'); if (b && !document.querySelector('[data-kb="workspace-card"]')) b.click() })()`)
  await poll(() => has('[data-kb="workspace-card"]'), 6000)
  check('at 390 px the window opens from the account menu in the drawer', (await openWindow()) === true)
  await sleep(500)
  const pl = await box('[data-kb="phone-remote"]')
  const pr = await box('[data-kb="phone-channels-card"]')
  const pw = await box('[data-kb="phone-channels"]')
  check('at 390 px the cards are stacked and fit the screen', pl !== null && pr !== null && pr.y > pl.b - 2 && pw.x >= 0 && pw.r <= 390 && pl.r <= 390 && pr.r <= 390 && (await val(`document.documentElement.scrollWidth <= 390`)) === true, [pl, pr, pw])
  check('at 390 px the title row keeps its close button on screen', (await box('[data-kb="phone-channels-close"]')).r <= 390)
  await shot('5b-window-phone-dark-top')
  await click('[data-kb="mobile-pair"]')
  await poll(() => has('[data-kb="mobile-qr"]'), 6000)
  await val(`document.querySelector('[data-kb="phone-channels-scrim"]').scrollTo(0, 400)`)
  await shot('5c-window-phone-dark-scrolled')
  await setTheme('light')
  await shot('5d-window-phone-light-scrolled')
  await val(`document.querySelector('[data-kb="phone-channels-scrim"]').scrollTo(0, 0)`)
  await shot('5e-window-phone-light-top')
  check('at 390 px the QR code is not cropped', (await box('[data-kb="mobile-qr"]')).r <= 390)
  await click('[data-kb="mobile-stop"]')
  await closeWindow()
  await viewport(1400, 950)
  await sleep(600)

  console.log('── 5f. right to left (Arabic) ──')
  await openWindow()
  await val(`document.documentElement.setAttribute('dir', 'rtl')`)
  await sleep(400)
  const xr = await box('[data-kb="phone-channels-close"]')
  const tr = await box('.kbpc-title')
  const cr = await box('[data-kb="phone-remote"]')
  const cc = await box('[data-kb="phone-channels-card"]')
  check('right to left: the window does not overflow, the cross moves to the left of the title, the two cards swap sides', (await val(`document.documentElement.scrollWidth <= innerWidth`)) === true && xr.x < tr.x && cr.x > cc.x, [xr, tr, cr, cc])
  await shot('5f-window-rtl')
  await val(`document.documentElement.setAttribute('dir', 'ltr')`)
  await closeWindow()

  console.log('── 5g. a phone with its drawer closed: Kaby\'s strip can still open the window ──')
  // The account footer lives in the drawer, which slides off the screen with a transform when it is closed (a window drawn inside it would slide away with it): the window does
  // not depend on it, it draws itself in a root of its own on <body>.
  await viewport(390, 844)
  await sleep(1200)
  let cardBox = await box('[data-kb="workspace-card"]')
  for (let i = 0; i < 3 && cardBox !== null && cardBox.r > 1; i++) {
    // the phone layout's menu button toggles the drawer: pressed for real, at its centre
    const mb = await box('.kbmob-menu')
    if (mb !== null) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: mb.x + mb.w / 2, y: mb.y + mb.h / 2, button: 'left', clickCount: 1 }) }
    await sleep(900)
    cardBox = await box('[data-kb="workspace-card"]')
  }
  check('the drawer is closed: the account card is off the screen', cardBox === null || cardBox.r <= 1, cardBox)
  check('window.__KB_MOBILE__.open() (what the strip\'s button calls) opens it anyway', (await val(`window.__KB_MOBILE__.open()`)) === true && (await poll(() => has('[data-kb="phone-channels"]'), 6000)) === true)
  const dw = await box('[data-kb="phone-channels"]')
  check('it is on screen, whole', dw !== null && dw.x >= 0 && dw.r <= 390 && dw.y >= 0, dw)
  await shot('5g-window-drawer-closed')
  check('and a second call does not make a second window', (await val(`window.__KB_MOBILE__.open()`)) === true && (await val(`document.querySelectorAll('[data-kb="phone-channels"]').length`)) === 1)
  await closeWindow()
  check('closing takes its node out of the page', (await has('[data-kb="phone-channels-root"]')) === false)
  await viewport(1400, 950)
  await sleep(800)

  console.log('── 6. closing ──')
  await key('Escape', 'Escape', 27)
  check('Escape closes the window', (await poll(async () => !(await has('[data-kb="phone-channels"]')), 4000)) === true)
  await openWindow()
  await val(`(() => { const s = document.querySelector('[data-kb="phone-channels-scrim"]'); const r = s.getBoundingClientRect(); s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 4, clientY: r.y + 4 })) })()`)
  check('a click on the dim closes it', (await poll(async () => !(await has('[data-kb="phone-channels"]')), 4000)) === true)
  await openWindow()
  await click('[data-kb="mobile-pair"]')
  await poll(() => has('[data-kb="mobile-qr"]'), 6000)
  const before = (await calls('/kybernos-mobile/remote/pair/cancel')).length
  check('the close button closes it', (await closeWindow()) === true)
  check('closing withdraws a code nobody scanned', (await poll(async () => (await calls('/kybernos-mobile/remote/pair/cancel')).length === before + 1, 4000)) === true)

  console.log('── 7. Settings › Phone and channels ──')
  await val(`window.__kbOpenDshSettings && window.__kbOpenDshSettings()`)
  await poll(() => val(`document.querySelectorAll('[class*="navCell"]').length > 3`), 10000)
  await val(`document.documentElement.setAttribute('data-kb-all-pages', '1')`)
  const cells = await val(`Array.from(document.querySelectorAll('button[class*="navCell"]')).map((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return { key: n ? e[n].key : null, t: (e.innerText || '').trim().split('\\n')[0] } })`)
  const mine = cells.find((c) => c.key === 'kybernos-mobile')
  check('the Settings nav has « Phone and channels » and no « Remote Control »', !!mine && mine.t === 'Phone and channels' && !cells.some((c) => /remote control/i.test(c.t)), cells.map((c) => c.t))
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n && e[n].key === 'kybernos-mobile' }); if (b) b.click() })()`)
  check('the page is the same screen: title, two cards, no close button', (await poll(() => has('[data-kb="mobile-page"]'), 8000)) === true && (await text('[data-kb="mobile-page"] .kbpc-title')) === 'Phone and channels' && (await has('[data-kb="mobile-page"] [data-kb="phone-remote"]')) === true && (await has('[data-kb="mobile-page"] [data-kb="phone-channels-card"]')) === true && (await has('[data-kb="phone-channels-close"]')) === false)
  const pb = await box('[data-kb="mobile-page"]')
  const pc = await box('[data-kb="mobile-page"] [data-kb="phone-remote"]')
  const pd = await box('[data-kb="mobile-page"] [data-kb="phone-channels-card"]')
  check('on the page the cards sit side by side when there is room', pc !== null && pd !== null && pb !== null && (pd.x > pc.r - 2 || pd.y > pc.b - 2), [pb, pc, pd])
  await shot('7-settings-page')
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + String(e && e.stack ? e.stack : e).slice(0, 600))
} finally {
  await live.close()
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
