#!/usr/bin/env node
// Kaby (packages/kybernos-kyber + the Kaby routes and hooks of packages/kybernos-cloud), in a real GUI.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh
//   source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]
//
// It needs the sandbox instance (docs/dev/live-testing.md): opening Kaby makes a REAL DSH chat and the host writes its pointer file, so
// it refuses to run against the user's own :3080 (exit 3). What is real: the DSH page, its sessions service, the row, the native chat
// it opens, the host's pointer route, the dock above the composer. What is faked, by replacing the page's `fetch` for those paths only,
// before any script runs: the account's answers (`/kybernos-cloud/kyber`, `/server`, the Telegram pairing, the computer and its choice);
// nothing is sent to any server.
//
// It plays: the row opens a native chat, once (a second click opens the same one); the strip sits above ITS composer and no other chat's;
// a person with no Telegram on the Free plan (two equal tiles: Telegram as a state and one button, no code asked for on open; the button opens the
// « Phone and channels » window, where the switch turns it on: QR and steps under Telegram's row, the same switch cancelling), the pairing going waiting -> scanned -> connected by itself (the strip folds), the choice of the
// computer linked to Kaby, a paid plan (wake and sleep), a computer being set up that turns into an asleep one by itself, the strip folding
// and remembered, disconnecting (asked first), a server with no Telegram bot (folded, a disabled switch), a phone width,
// and the page (what Kaby is, the way into the chat). Exit code 0 / 1 / 3 (not run).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { encodeQr } from '../packages/kybernos-cloud/qr.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
// How many Telegram pairings the page has asked for so far (the renewals of section 3c make it more than the switch presses).
let tgPairs = 2
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const LINK = 'https://t.me/kybernos_bot?start=pair_0123456789abcdefghij0123'
const PAIR = '33333333-3333-4333-8333-333333333333'
const qr = encodeQr(LINK, { ecc: 'M' })
const WA_LINK = 'https://wa.me/33600000012?text=pair_0123456789abcdefghij0123'
const WA_PAIR = '44444444-4444-4444-8444-444444444444'
const waQr = encodeQr(WA_LINK, { ecc: 'M' })
const SERVER = { ok: true, server: { id: 'dev', api: 'https://server-dev-7831.up.railway.app', web: 'https://dev.kybernos.app' } }
const KYBER = (over) => Object.assign({
  ok: true,
  connected: true,
  telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null },
  pairing: 'supported',
  server: { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: true },
  computers: [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }],
  home: { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-15T09:50:00.000Z', version: 'p12', network: 'public', paused_reason: null, manual_control: false },
}, over || {})

// Installed before any script of the page: the answers the page gets for the Kaby routes. `window.__kbMock` is what the check drives.
const MOCK = `(() => {
  const m = window.__kbMock = { kyber: ${JSON.stringify(KYBER())}, server: ${JSON.stringify(SERVER)}, pairingState: { ok: true, state: 'waiting', reason: null, sender: '', expires_at: '' },
    calls: [], qr: ${JSON.stringify({ size: qr.size, modules: qr.modules })},
    waPairingState: { ok: true, state: 'waiting', reason: null, sender: '', expires_at: '' }, waQr: ${JSON.stringify({ size: waQr.size, modules: waQr.modules })},
  }
  const real = window.fetch.bind(window)
  const json = (v) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } }))
  window.fetch = (url, init) => {
    const u = new URL(String(url), location.origin)
    const p = u.pathname
    const method = ((init && init.method) || 'GET').toUpperCase()
    if (p.indexOf('/kybernos-cloud/') !== 0) return real(url, init)
    let body = null
    try { body = init && init.body ? JSON.parse(init.body) : null } catch (e) { body = null }
    const rec = (extra) => m.calls.push(Object.assign({ path: p, method, body }, extra || {}))
    if (p === '/kybernos-cloud/kyber') return json(m.kyber)
    if (p === '/kybernos-cloud/server') return json(m.server)
    if (p === '/kybernos-cloud/telegram/pairing' && method === 'POST') { rec(); return json({ ok: true, id: ${JSON.stringify(PAIR)}, link: ${JSON.stringify(LINK)}, bot: 'kybernos_bot', expires_at: new Date(Date.now() + (m.pairTtl || 300000)).toISOString(), qr: m.qr }) }
    if (p === '/kybernos-cloud/telegram/pairing/state') return json(Object.assign({}, m.pairingState, { expires_at: new Date(Date.now() + 200000).toISOString() }))
    if (p === '/kybernos-cloud/telegram/pairing/cancel') { rec(); return json({ ok: true }) }
    if (p === '/kybernos-cloud/whatsapp/pairing' && method === 'POST') { rec(); return json({ ok: true, id: ${JSON.stringify(WA_PAIR)}, link: ${JSON.stringify(WA_LINK)}, number: '33600000012', expires_at: new Date(Date.now() + 300000).toISOString(), qr: m.waQr }) }
    if (p === '/kybernos-cloud/whatsapp/pairing/state') return json(Object.assign({}, m.waPairingState, { expires_at: new Date(Date.now() + 200000).toISOString() }))
    if (p === '/kybernos-cloud/whatsapp/pairing/cancel') { rec(); return json({ ok: true }) }
    if (p === '/kybernos-cloud/whatsapp/unlink') { rec(); m.kyber.whatsapp.linked = null; return json({ ok: true }) }
    if (p === '/kybernos-cloud/kyby/computer') { rec(); const c = m.kyber.computers.find((x) => x.id === body.computer_id) || m.kyber.computers[0]; m.kyber.home.id = c.id; m.kyber.home.name = c.name; m.kyber.home.state = c.state; return json({ ok: true, computer_id: body.computer_id }) }
    if (p === '/kybernos-cloud/telegram/unlink') { rec(); m.kyber.telegram.linked = null; return json({ ok: true }) }
    if (p === '/kybernos-cloud/computer/resume') { rec(); m.kyber.home.state = 'running'; return json({ ok: true, state: 'running', desired: 'running' }) }
    if (p === '/kybernos-cloud/computer/suspend') { rec(); m.kyber.home.state = 'suspended'; return json({ ok: true, state: 'suspended', desired: 'suspended' }) }
    if (p === '/kybernos-cloud/computer/open') { rec(); return json({ ok: true, url: 'https://example.invalid/computer' }) }
    if (p === '/kybernos-cloud/console/link') { rec(); return json({ ok: true, opened: true }) }
    return real(url, init)
  }
})()`

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check makes a real chat and writes a pointer file; run it against the sandbox (scripts/sandbox/*.sh, then `source scripts/sandbox/env.sh`), never the user\'s own DSH.'); process.exit(3) }
const live = await openLivePage({ width: 1400, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const click = (kb) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); if (!e) return false; e.click(); return true })()`)
const has = (kb) => val(`!!document.querySelector('[data-kb="${kb}"]')`)
const text = (kb) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); return e ? e.innerText : null })()`)
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const calls = (path) => val(`window.__kbMock.calls.filter((c) => c.path === ${JSON.stringify(path)})`)
const setMock = (expr) => val(`(() => { ${expr}; return true })()`)
const typeIn = (words) => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-draft"]'); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(words)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

try {
  await page.send('Runtime.enable', {})
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  console.log('Kaby — ' + host + ' (the sandbox serves this checkout; the account\'s answers are faked)')

  // The sandbox has no sign-in: its « Get started » dialog sits over the page and hides it in the screenshots. Escape closes it.
  const closeDialog = async () => {
    for (let i = 0; i < 3; i++) {
      if ((await val(`!document.querySelector('[role="dialog"]')`)) === true) return
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(400)
    }
  }
  const sessionCount = () => val(`(() => { try { return String(document.querySelectorAll('[data-row-key^="session:"]').length) } catch (e) { return '0' } })()`)
  const pointer = () => val(`fetch('/kybernos-cloud/kyby/native', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.sessionId || null)`)
  const kybyRow = `Array.from(document.querySelectorAll('button, a, [role="button"]')).filter((x) => (x.innerText || '').trim().split('\\n')[0] === 'Kaby' && x.getClientRects().length > 0)[0]`
  const rowPos = () => val(`(() => { const e = ${kybyRow}; if (!e) return null; return 'row' })()`)
  // A DOM click: the sandbox's first-run dialog can sit over the page and swallow a pointer event, which says nothing of the row.
  const clickRow = () => val(`(() => { const e = ${kybyRow}; if (!e) return false; e.click(); return true })()`)
  const composerThere = () => val(`!!document.querySelector('[contenteditable="true"], textarea[placeholder], [data-slot="conversation.composer"], [data-slot^="conversation.input"]')`)

  // A clean start: a pointer left by an earlier run would hide whether the first click makes the chat.
  await val(`fetch('/kybernos-cloud/kyby/native/set', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: null }) }).then((r) => r.json())`)

  console.log('── 1. the row opens a native DSH chat ──')
  const row = await poll(rowPos, 25000)
  check('the sidebar has a Kaby row', typeof row === 'string', row)
  if (typeof row !== 'string') throw new Error('no Kaby row')
  check('there is no Cloud Computer row any more', (await val(`!Array.from(document.querySelectorAll('button, a, [role="button"]')).some((x) => (x.innerText || '').trim().split('\\n')[0] === 'Cloud Computer' && x.getBoundingClientRect().x < 300)`)) === true)
  check('no Kaby chat is remembered yet', (await pointer()) === null)
  await clickRow()
  const dock = await poll(() => has('kybernos-kyber-dock'), 20000)
  check('the strip appears above the composer of the chat the row opened', dock === true)
  const first = await poll(pointer, 10000)
  check('the host remembered that chat as Kaby\'s', typeof first === 'string' && first.length > 8, first)
  check('it is DSH\'s own composer, not a box of this page', (await composerThere()) === true && (await has('kybernos-kyber-draft')) === false)
  check('a folder is already chosen: the person is not asked for one', (await val(`!/Choose workspace|Choose a workspace to start|Choisir un espace|Choisissez un espace/.test(document.body.innerText)`)) === true)
  check('the chat\'s workspace is called Kaby, in the list', (await val(`Array.from(document.querySelectorAll('[data-row-key], [class*="workspace"]')).some((e) => (e.innerText || '').trim() === 'Kaby') || /\\bKyby\\b/.test(document.body.innerText)`)) === true)
  check('the new-chat cards (Build, Create, Slides…) are not in Kaby\'s chat', (await has('newchat')) === false)
  check('the page that opened is not the one drawn by the bundle', (await has('kybernos-kyber-page')) === false)
  await shot('1-native-chat')

  console.log('── 2. once, and only there ──')
  await clickRow()
  await sleep(1500)
  check('a second click opens the same chat, no new one', (await pointer()) === first && (await has('kybernos-kyber-dock')) === true)

  // The « Phone and channels » window (kybernos-mobile draws it, in a root of its own on <body>): Telegram is set up there, not in the strip.
  const openWin = async () => { if ((await has('phone-channels')) === true) return true; await click('kybernos-kyber-open-phone'); return (await poll(() => has('phone-channels'), 8000)) === true }
  const closeWin = async () => { if ((await has('phone-channels')) !== true) return true; await click('phone-channels-close'); return (await poll(async () => (await has('phone-channels')) === false, 5000)) === true }
  const attr = (kb, name) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); return e ? e.getAttribute(${JSON.stringify(name)}) : null })()`)
  const box = (kb) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom } })()`)

  console.log('── 2a. the sidebar marks the row of what is on screen (V-01) ──')
  const onRows = () => val(`Array.from(document.querySelectorAll('.kb4-item.on')).map((e) => e.innerText.trim().split('\\n')[0])`)
  const clickSide = (label) => val(`(() => { const e = Array.from(document.querySelectorAll('.kb4-item')).find((x) => x.innerText.trim().split('\\n')[0] === ${JSON.stringify(label)}); if (!e) return false; e.click(); return true })()`)
  const onIs = async (names, ms) => (await poll(async () => JSON.stringify(await onRows()) === JSON.stringify(names), ms || 8000)) === true
  check('on Kaby\'s chat the Kaby row is the selected one and no other', await onIs(['Kaby']), await onRows())
  if ((await clickSide('Dashboards')) === true) {
    check('on the Dashboards page Dashboards is selected and Kaby is not', await onIs(['Dashboards']), await onRows())
    await clickRow()
    check('back on Kaby, Dashboards is back to the normal style and Kaby is marked', await onIs(['Kaby'], 15000), await onRows())
    await poll(() => has('kybernos-kyber-dock'), 20000)
  } else check('the Dashboards row is there to leave', false)
  if ((await clickSide('Skills')) === true) {
    check('on another page (Skills) only that row is selected', await onIs(['Skills']), await onRows())
    await clickRow()
    await onIs(['Kaby'], 15000)
    await poll(() => has('kybernos-kyber-dock'), 20000)
  }

  console.log('── 2b. a reload with Kaby\'s chat on screen: nothing to build, lined up with the composer ──')
  // The new-chat cards are drawn before the Kaby bundle has read which chat is Kaby's: on a page load they used to stay, above the strip.
  for (let i = 0; i < 2; i++) {
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(1200)
    await closeDialog()
    await poll(() => has('kybernos-kyber-dock'), 25000)
    let sawCards = false
    for (const end = Date.now() + 3500; Date.now() < end;) { if ((await has('newchat')) || (await has('newchat-visuals'))) sawCards = true; await sleep(200) }
    check('reload ' + (i + 1) + ': the new-chat cards and the templates row never show in Kaby\'s chat', sawCards === false && (await has('kybernos-kyber-strip')) === true)
  }
  const geo = await val(`(() => { const ed = document.querySelector('[contenteditable="true"], textarea'); let card = null; for (let e = ed; e; e = e.parentElement) { if (parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 20) { card = e; break } } const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); if (!card || !s) return null; const a = card.getBoundingClientRect(); const b = s.getBoundingClientRect(); return { cx: a.x, cw: a.width, sx: b.x, sw: b.width, cr: getComputedStyle(card).borderTopLeftRadius, sr: getComputedStyle(s).borderTopLeftRadius } })()`)
  check('the strip starts and ends where the composer\'s card does', geo !== null && Math.abs(geo.cx - geo.sx) <= 1 && Math.abs(geo.cw - geo.sw) <= 1, geo)
  check('and has its radius', geo !== null && geo.cr === geo.sr, geo)
  await shot('2a-reloaded')

  await closeDialog()
  console.log('── 3. not connected, Free plan: ONE line above the composer ──')
  check('the strip is ONE line headed with the assistant\'s name: no fold button, no tiles, and nothing open by itself', (await val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); return !!s && /^Kaby/.test(s.innerText.trim()) && !s.classList.contains('open') && !document.querySelector('[data-kb="kybernos-kyber-strip-toggle"]') && !document.querySelector('[data-kb="kybernos-kyber-tile-channels"]') && !document.querySelector('[data-kb="kybernos-kyber-pop"]') && !document.querySelector('[data-kb="kybernos-kyber-intro"]') })()`)) === true)
  check('three chips say how things stand: the remote control, Telegram (not connected), the computer (asleep)', (await has('kybernos-kyber-remote-chip')) === true && /Telegram/.test((await text('kybernos-kyber-status')) || '') && /inactif|off/i.test((await text('kybernos-kyber-status')) || '') && /Home/.test((await text('kybernos-kyber-computer-chip')) || '') && /En veille|Asleep/.test((await text('kybernos-kyber-computer-chip')) || ''))
  // at the width of a real chat window (the check's own page is 1400 px with a sidebar, which leaves the strip about 750 px: it wraps there, by design, below ~800)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const sb = await box('kybernos-kyber-strip')
  check('on a wide chat it is ONE line high (under 56 px)', sb !== null && sb.h < 56, sb)
  // The strip is as wide as the composer's card and centred like it, also when the chat is wide (the card has a maximum width, the dock used to run the full column).
  const wideGeo = await val(`(() => { const ed = document.querySelector('[contenteditable="true"], textarea'); let card = null; for (let e = ed; e; e = e.parentElement) { if (parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 20) { card = e; break } } const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); if (!card || !s) return null; const a = card.getBoundingClientRect(); const b = s.getBoundingClientRect(); return { cx: a.x, cw: a.width, sx: b.x, sw: b.width } })()`)
  check('on a wide chat the strip starts and ends where the composer\'s card does (same width, same centre)', wideGeo !== null && Math.abs(wideGeo.cx - wideGeo.sx) <= 1.5 && Math.abs(wideGeo.cw - wideGeo.sw) <= 1.5, wideGeo)
  await shot('2-strip-wide')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)
  console.log('── 3a. the help pill, the button, the list the chips open ──')
  check('the strip carries the Suite\'s « ? How it works » pill, on its line and not inside a chip', (await poll(() => val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); const b = s && s.querySelector('[data-kb="help-button"][data-id="kybernos-kyber"]'); return !!b && !b.closest('.kbky-chip') })()`), 8000)) === true)
  await val(`document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="help-button"]').click()`)
  const card = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="help-panel"]'); const b = document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="help-button"]'); if (!p || !b) return null; const r = p.getBoundingClientRect(); const q = b.getBoundingClientRect(); return { text: p.innerText, onscreen: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, clear: r.bottom <= q.top + 1 || r.top >= q.bottom - 1 } })()`), 6000)
  check('the card opens on the side that has room, wholly on screen and clear of the pill, and is Kaby\'s', !!card && card.clear === true && card.onscreen === true && /Kaby/.test(card.text), card)
  await shot('2c-help-card')
  await val(`document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="help-button"]').click()`)
  check('the line has exactly one button besides the chips: « Set up… »', (await val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); const b = Array.from(s.querySelectorAll('button, a')).filter((e) => !e.closest('.kbky-chip') && !e.closest('[data-kb="help-button"]') && !e.closest('.kbky-pillwrap')); return b.length === 1 && b[0].getAttribute('data-kb') === 'kybernos-kyber-open-phone' && /Régler|Set up/.test(b[0].innerText) })()`)) === true)
  await click('kybernos-kyber-status')
  check('a chip opens a small list of the same three: remote control, Telegram, the computer', (await poll(() => has('kybernos-kyber-pop'), 4000)) === true && (await val(`['kybernos-kyber-row-remote', 'kybernos-kyber-tg-row', 'kybernos-kyber-row-computer'].every((k) => !!document.querySelector('[data-kb="kybernos-kyber-pop"] [data-kb="' + k + '"]'))`)) === true)
  check('Telegram is ONE row in it that says where it stands (not connected): no switch, no code, no WhatsApp or WeChat row', /Pas connecté|Not connected/.test((await val(`document.querySelector('[data-kb="kybernos-kyber-pop"] [data-kb="kybernos-kyber-tg-row"]').innerText`)) || '') && (await has('kybernos-kyber-tg-switch')) === false && (await has('kybernos-kyber-chan-whatsapp')) === false && (await has('kybernos-kyber-chan-wechat')) === false)
  check('opening the list asked for no code: no pairing, no QR', (await calls('/kybernos-cloud/telegram/pairing')).length === 0 && (await has('kybernos-kyber-qr')) === false && (await has('kybernos-kyber-telegram')) === false)
  await shot('2-strip-list')
  await val(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check('Escape closes the list', (await poll(async () => (await has('kybernos-kyber-pop')) === false, 4000)) === true)
  check('there is no « Other channels » group, no radio, no settings, no « where it runs »', (await val(`!/Autres canaux|Other channels/.test(document.querySelector('[data-kb="kybernos-kyber-strip"]').innerText) && document.querySelectorAll('[data-kb="kybernos-kyber-strip"] input[type="radio"]').length === 0 && !document.querySelector('[data-kb="kybernos-kyber-settings"]')`)) === true)

  console.log('── 3b. the button opens the Phone and channels window; Telegram is turned on there: the code ──')
  check('the strip\'s button opens the window (kybernos-mobile draws it, in a root of its own)', (await openWin()) === true)
  check('the window holds Kaby\'s column: Telegram with its switch, off, then WhatsApp, WeChat, iMessage', (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'false' && (await val(`['whatsapp', 'wechat', 'imessage'].every((c) => !!document.querySelector('[data-kb="phone-channels"] [data-kb="kybernos-kyber-chan-' + c + '"]'))`)) === true)
  check('opening the window asked for no code either', (await calls('/kybernos-cloud/telegram/pairing')).length === 0 && (await has('kybernos-kyber-qr')) === false)
  const comp = (await text('kybernos-kyber-computer')) || ''
  check('the window\'s « Kaby\'s computer »: its name, asleep, the Free plan says it cannot be woken by hand, an upgrade button and no wake button', /Home/.test(comp) && /En veille|Asleep/.test(comp) && /Ordinateur de Kaby|Kaby’s computer/.test(comp) && (await has('kybernos-kyber-upsell')) === true && (await has('kybernos-kyber-upgrade')) === true && (await has('kybernos-kyber-wake')) === false, comp.slice(0, 200))
  check('and one short line under its title, not the long explanation', /La machine sur laquelle Kaby travaille|The machine Kaby works on/.test((await text('kybernos-kyber-computer-help')) || '') && !/À la demande|On request/.test((await text('kybernos-kyber-computer-help')) || ''))
  await shot('2a-window-idle')
  await click('kybernos-kyber-tg-switch')
  check('the switch asked for exactly one pairing', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing')).length === 1, 6000)) === true, await calls('/kybernos-cloud/telegram/pairing'))
  check('a QR code is drawn from the pairing', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-qr"] svg path')`))) === true)
  check('the switch is on and the row says there is a code to scan', (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'true' && /Code à scanner|Code to scan/.test((await text('kybernos-kyber-tg-row')) || ''))
  check('the panel sits under Telegram\'s row and above WhatsApp, inside the window', (await val(`(() => { const w = document.querySelector('[data-kb="phone-channels"]'); const p = w.querySelector('[data-kb="kybernos-kyber-telegram"]'); const t = w.querySelector('[data-kb="kybernos-kyber-tg-row"]'); const x = w.querySelector('[data-kb="kybernos-kyber-chan-whatsapp"]'); return !!p && !!t && !!x && (t.compareDocumentPosition(p) & 4) !== 0 && (p.compareDocumentPosition(x) & 4) !== 0 })()`)) === true)
  check('the strip and its list draw none of the code', (await val(`!document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="kybernos-kyber-telegram"]') && !document.querySelector('[data-kb="kybernos-kyber-strip"] [data-kb="kybernos-kyber-qr"]')`)) === true)
  check('« Open Telegram » goes to the bot\'s link, in a new tab', (await val(`(() => { const a = document.querySelector('[data-kb="kybernos-kyber-open"]'); return !!a && a.getAttribute('href') === ${JSON.stringify(LINK)} && a.target === '_blank' && /noopener/.test(a.rel) })()`)) === true)
  check('the three steps are listed, with the time left', (await val(`document.querySelectorAll('[data-kb="kybernos-kyber-telegram"] ol li').length`)) === 3 && /\d:\d\d/.test((await text('kybernos-kyber-left')) || ''))
  await click('kybernos-kyber-code')
  check('« write a code instead » opens, in DSH, the command to write to the bot with the token of this code', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-code-text"]'); const a = document.querySelector('[data-kb="kybernos-kyber-open"]'); if (!t || !a) return false; const m = /pair_([a-z0-9]+)$/.exec(a.getAttribute('href')); return !!m && t.innerText.trim() === '/start pair_' + m[1] && /@kybernos_bot/.test(document.querySelector('[data-kb="kybernos-kyber-code-box"]').innerText) })()`), 5000)) === true)
  check('and it did not send the person to the console', (await calls('/kybernos-cloud/console/link')).length === 0)
  await click('kybernos-kyber-code')
  await shot('2b-code-in-window')
  await click('kybernos-kyber-tg-switch')
  check('the same switch cancels: the host is told and the panel goes', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing/cancel')).length === 1 && (await has('kybernos-kyber-telegram')) === false, 6000)) === true)
  check('and the switch is off again', (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'false')
  await click('kybernos-kyber-tg-switch')
  check('turned on again: a new code', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing')).length === 2 && (await has('kybernos-kyber-qr')) === true, 6000)) === true)

  console.log('── 3c. nothing arrives: the page says what to do, and the code renews by itself ──')
  // Measured on dev, 2026-10-20: two real phone rounds, no Start ever reached the server. On a bot the person already used, the link only opens the chat and the Start (or Restart) must be pressed.
  check('the second step says Start, or Restart for a bot already used', /Redémarrer|Restart/.test(await val(`document.querySelectorAll('[data-kb="kybernos-kyber-telegram"] ol li')[1].innerText`)))
  check('the app link opens Telegram itself on this computer (tg://), beside the web link', (await attr('kybernos-kyber-open-app', 'href')) === 'tg://resolve?domain=kybernos_bot&start=pair_0123456789abcdefghij0123' && (await attr('kybernos-kyber-open', 'href')) === LINK)
  check('a fresh code has no help yet and keeps the message to send folded', (await has('kybernos-kyber-stuck')) === false && (await has('kybernos-kyber-code-box')) === false)
  check('after 20 s with no Start the help appears: Start or Restart in the chat, or send the message', (await poll(() => has('kybernos-kyber-stuck'), 32000)) === true && /Redémarrer|Restart/.test((await text('kybernos-kyber-stuck')) || '') && /@kybernos_bot/.test((await text('kybernos-kyber-stuck')) || ''), await text('kybernos-kyber-stuck'))
  check('and the message to send is already shown, with its copy button, without a click', (await has('kybernos-kyber-code-box')) === true && /^\/start pair_[a-z0-9]+$/.test(((await text('kybernos-kyber-code-text')) || '').trim()) && (await has('kybernos-kyber-code-copy')) === true)
  await shot('2c-stuck-help')
  const cancelsBefore = (await calls('/kybernos-cloud/telegram/pairing/cancel')).length
  await click('kybernos-kyber-tg-switch')
  check('cancelled by the switch', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing/cancel')).length === cancelsBefore + 1 && (await has('kybernos-kyber-telegram')) === false, 6000)) === true)
  // A code that lives 3.5 s (the mock's): the page cancels it and makes a new one by itself, three times, then stops and offers the button.
  await setMock(`window.__kbMock.pairTtl = 3500`)
  const madeBefore = (await calls('/kybernos-cloud/telegram/pairing')).length
  await click('kybernos-kyber-tg-switch')
  check('turned on: one code, then the page renews it by itself when it runs out (the old one cancelled)', (await poll(async () => (await calls('/kybernos-cloud/telegram/pairing')).length >= madeBefore + 2 && (await calls('/kybernos-cloud/telegram/pairing/cancel')).length >= cancelsBefore + 2, 20000)) === true, { made: (await calls('/kybernos-cloud/telegram/pairing')).length - madeBefore })
  check('after three renewals it stops: the code is shown as expired with the button for a new one', (await poll(() => val(`(() => { const p = document.querySelector('[data-kb="kybernos-kyber-telegram"]'); return !!p && p.getAttribute('data-state') === 'expired' && !!document.querySelector('[data-kb="kybernos-kyber-retry"]') })()`), 45000)) === true)
  check('exactly three renewals were made, no more', (await calls('/kybernos-cloud/telegram/pairing')).length === madeBefore + 4, (await calls('/kybernos-cloud/telegram/pairing')).length - madeBefore)
  await shot('2d-expired-after-renewals')
  await setMock(`window.__kbMock.pairTtl = 300000`)
  await click('kybernos-kyber-retry')
  check('the button makes a fresh code that lasts', (await poll(async () => (await has('kybernos-kyber-qr')) === true && (await attr('kybernos-kyber-telegram', 'data-state')) === 'waiting', 8000)) === true)
  tgPairs = (await calls('/kybernos-cloud/telegram/pairing')).length

  console.log('── 4. the pairing goes by itself ──')
  await setMock(`window.__kbMock.pairingState = { ok: true, state: 'scanned', reason: null, sender: 'Amina (@alex)', expires_at: '' }`)
  check('after the scan the panel names who Telegram says it is', (await poll(() => val(`/Amina \\(@alex\\)/.test((document.querySelector('[data-kb="kybernos-kyber-telegram"]') || {}).innerText || '')`), 8000)) === true)
  check('and the QR is gone, the row waits for the person\'s OK', (await has('kybernos-kyber-qr')) === false && /En attente|Waiting/.test((await text('kybernos-kyber-tg-row')) || ''))
  await setMock(`window.__kbMock.kyber.telegram.linked = { display: 'Amina (@alex)', linked_at: '2026-10-15T10:00:00.000Z', paused: false, blocked: false }; window.__kbMock.pairingState = { ok: true, state: 'done', reason: null, sender: 'Amina (@alex)', expires_at: '' }`)
  check('on the tap the status becomes connected by itself', (await poll(() => val(`/^Telegram · (actif|on)$/i.test(((document.querySelector('[data-kb="kybernos-kyber-status"]') || {}).innerText || '').trim())`), 9000)) === true)
  check('the Telegram chip is green once connected', (await val(`/ok/.test((document.querySelector('[data-kb="kybernos-kyber-status"]') || { className: '' }).className)`)) === true)
  await openWin()
  check('in the window, Telegram\'s row names the chat, the switch is on, the bot has its link, and no panel is left', (await poll(() => val(`/Amina \\(@alex\\)/.test((document.querySelector('[data-kb="kybernos-kyber-tg-row"]') || {}).innerText || '')`), 5000)) === true && (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'true' && (await has('kybernos-kyber-bot')) === true && (await has('kybernos-kyber-telegram')) === false)
  await shot('3-connected')

  console.log('── 5. the computer linked to Kaby ──')
  await openWin()
  check('with one cloud computer the select offers this computer and that one', (await val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-pick"]'); return !!s && s.tagName === 'SELECT' && s.options.length === 2 && /Cet ordinateur|This computer/.test(s.options[0].text) && /Home/.test(s.options[1].text) && !s.disabled })()`)) === true)
  await setMock(`window.__kbMock.kyber.computers = [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }, { id: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Atelier', state: 'running' }]`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('with several, the field is a real select', (await poll(() => has('kybernos-kyber-pick'), 6000)) === true && (await val(`document.querySelector('[data-kb="kybernos-kyber-pick"]').tagName`)) === 'SELECT')
  await val(`(() => { const sel = document.querySelector('[data-kb="kybernos-kyber-pick"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  check('the choice is sent to the host', (await poll(async () => (await calls('/kybernos-cloud/kyby/computer')).some((c) => c.body && c.body.computer_id === '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 5000)) === true)
  check('and read again: the computer block shows the new computer and its state', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-computer"]'); const s = t.querySelector('select'); return !!s && s.value === '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb' && /Éveillé|Awake/.test(t.innerText) })()`), 6000)) === true)
  await setMock(`window.__kbMock.kyber.computers = [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }]; window.__kbMock.kyber.home = Object.assign({}, window.__kbMock.kyber.home, { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' })`)
  await val(`window.__KB_KYBER__.refresh()`)
  await sleep(600)

  console.log('── 5b. this computer, next to the cloud one (V-04) ──')
  const pick = (value) => val(`(() => { const sel = document.querySelector('[data-kb="kybernos-kyber-pick"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(value)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const before = (await calls('/kybernos-cloud/kyby/computer')).length
  await pick('local')
  check('choosing this computer: the block names it, ready, with what it means', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-computer"]'); const s = t.querySelector('select'); return !!s && s.value === 'local' && /Prêt|Ready/.test(t.innerText) && /travaille sur cet ordinateur|works on this computer/.test(t.innerText) })()`), 5000)) === true)
  check('no server was asked: the choice needs none', (await calls('/kybernos-cloud/kyby/computer')).length === before)
  check('no wake, sleep or open for this computer, and no Free-plan note', (await val(`['wake', 'sleep', 'pcopen', 'upsell', 'upgrade'].every((k) => !document.querySelector('[data-kb="kybernos-kyber-' + k + '"]'))`)) === true)
  check('it is remembered by this browser', (await val(`window.localStorage.getItem('kybernos-kyber.where')`)) === 'local')
  await shot('3d-this-computer')
  await pick('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  check('back to the cloud computer: the host is asked and the block shows its state again', (await poll(async () => (await calls('/kybernos-cloud/kyby/computer')).length > before && (await val(`/En veille|Asleep/.test(document.querySelector('[data-kb="kybernos-kyber-computer"]').innerText)`)) === true, 6000)) === true)
  console.log('   with no account and no server')
  await setMock(`window.__kbKeep = JSON.parse(JSON.stringify(window.__kbMock.kyber)); window.__kbMock.kyber = { ok: true, connected: false }`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('signed out: the note, and the computer block with this computer only, which needs no sign-in', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-computer"]'); const s = t && t.querySelector('select'); return !!s && s.options.length === 1 && s.value === 'local' && /Prêt|Ready/.test(t.innerText) && !document.querySelector('[data-kb="kybernos-kyber-tile-channels"]') })()`), 6000)) === true)
  await shot('3e-signed-out')
  await setMock(`window.__kbMock.kyber = window.__kbKeep`)
  await val(`window.__KB_KYBER__.refresh()`)
  await val(`window.localStorage.removeItem('kybernos-kyber.where')`)
  await sleep(600)

  console.log('── 6. a paid plan: the computer can be driven ──')
  await setMock(`window.__kbMock.kyber.home.manual_control = true`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the wake button appears and the Free note goes', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-wake"]') && !document.querySelector('[data-kb="kybernos-kyber-upsell"]') && !document.querySelector('[data-kb="kybernos-kyber-upgrade"]')`), 8000)) === true)
  await click('kybernos-kyber-wake')
  check('a wake is asked of the host', (await poll(async () => (await calls('/kybernos-cloud/computer/resume')).length === 1, 5000)) === true)
  check('the block then offers to put it to sleep and to open it', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-sleep"]') && !!document.querySelector('[data-kb="kybernos-kyber-pcopen"]')`), 8000)) === true)

  console.log('── 6b. a computer being set up turns into a computer by itself ──')
  await setMock(`window.__kbMock.kyber.home.state = 'creating'; window.__kbMock.kyber.computers = [Object.assign({}, window.__kbMock.kyber.computers[0], { state: 'creating' })]`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the chip says it is being set up, with the sentence for a machine dedicated to the person', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-computer"]'); return !!t && /Initialisation|Setting up/.test(t.innerText) && /machine dédiée pour vous|machine dedicated to you/.test(t.innerText) && !!t.querySelector('.kbky-spin') })()`), 6000)) === true)
  await shot('3c-setting-up')
  await setMock(`window.__kbMock.kyber.home.state = 'suspended'; window.__kbMock.kyber.computers = [Object.assign({}, window.__kbMock.kyber.computers[0], { state: 'suspended' })]`)
  check('with no refresh from the check, it reads again and becomes « Asleep »', (await poll(() => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-computer"]'); return !!t && /En veille|Asleep/.test(t.innerText) && !/Initialisation|Setting up/.test(t.innerText) })()`), 10000)) === true)

  console.log('── 7. the list the chips open, once Telegram is connected ──')
  await closeWin()
  await click('kybernos-kyber-computer-chip')
  check('a chip opens the list: the three lines in words (remote control ready, Telegram connected, the computer)', (await poll(() => has('kybernos-kyber-pop'), 4000)) === true && /Amina \(@alex\)/.test((await val(`document.querySelector('[data-kb="kybernos-kyber-pop"] [data-kb="kybernos-kyber-tg-row"]').innerText`)) || '') && /prêt à relier|ready to pair|relié|linked/i.test((await text('kybernos-kyber-row-remote')) || ''))  // the sandbox may hold a phone linked by check-phone-apps-live: the line says so then
  check('each line has one button to the Phone and channels screen', (await val(`document.querySelectorAll('[data-kb="kybernos-kyber-pop"] button').length`)) === 3)
  await click('kybernos-kyber-set-telegram')
  check('a line\'s button opens the window', (await poll(() => has('phone-channels'), 6000)) === true)
  await shot('4-list-and-window')

  console.log('── 8. disconnecting asks first ──')
  await openWin()
  await click('kybernos-kyber-tg-switch')
  check('turning the switch off does not disconnect: a question appears and nothing is sent', (await has('kybernos-kyber-unlink-yes')) === true && (await calls('/kybernos-cloud/telegram/unlink')).length === 0)
  await click('kybernos-kyber-unlink-no')
  check('« Cancel » closes the question, still connected', (await has('kybernos-kyber-unlink-yes')) === false && (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'true')
  await click('kybernos-kyber-tg-switch')
  await click('kybernos-kyber-unlink-yes')
  check('confirmed: it is sent once and the row goes back to « not connected », the switch off', (await poll(async () => (await calls('/kybernos-cloud/telegram/unlink')).length === 1 && (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'false' && /Pas connecté|Not connected/.test((await text('kybernos-kyber-tg-row')) || ''), 9000)) === true)
  check('and no new code is asked for by itself', (await calls('/kybernos-cloud/telegram/pairing')).length === tgPairs)

  console.log('── 8b. the three states of the Telegram door, said in the window: a bot, no bot on this server, a server too old (the active server is a stand-in that answers each) ──')
  // The stand-in is the page's own answer to /kybernos-cloud/kyber (what the host would say for such a server): nothing here reaches a real server.
  const door = (telegram, pairing, can) => setMock(`window.__kbMock.kyber.telegram = ${telegram}; window.__kbMock.kyber.pairing = ${JSON.stringify(pairing)}; window.__kbMock.kyber.server = { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: ${can} }`)
  const NOBOT = '{ configured: false, enabled: false, bot: null, linked: null }'
  // Telegram's row IN THE WINDOW (the strip has a row of its own, which only says where Telegram stands), and the strip's row apart.
  const rowFacts = () => val(`(() => { const w = document.querySelector('[data-kb="phone-channels"]'); const r = w && w.querySelector('[data-kb="kybernos-kyber-tg-row"]'); const sw = w && w.querySelector('[data-kb="kybernos-kyber-tg-switch"]'); const b = w && w.querySelector('[data-kb="kybernos-kyber-tg-switch-server"]'); return r ? { text: r.innerText.replace(/\\s+/g, ' '), state: r.getAttribute('data-state'), disabled: !!sw && sw.disabled, button: b ? b.innerText.trim() : null, strip: !!document.querySelector('[data-kb="kybernos-kyber-channels"]') } : null })()`)
  const stripRow = () => val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-pop"] [data-kb="kybernos-kyber-tg-row"]'); return t ? t.innerText.replace(/\\s+/g, ' ') : null })()`)
  const settingsOnServers = () => val(`(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`)

  // 1. no bot, and another server is registered: the way out is on the window's row; the strip stays folded (nothing there to do)
  await door(NOBOT, 'supported', true)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the chip says Telegram is unavailable', (await poll(() => val(`/indisponible|unavailable/i.test(document.querySelector('[data-kb="kybernos-kyber-status"]') ? document.querySelector('[data-kb="kybernos-kyber-status"]').innerText : '') || !!document.querySelector('[data-kb="kybernos-kyber-channels"]')`), 6000)) === true)
  const nb = await poll(async () => { const r = await rowFacts(); return r !== null && r.state === 'off' ? r : null }, 8000)
  check('no bot, a server to go to: the strip stays folded (the way out is one button away, in the window)', nb !== null && nb !== false && nb.strip === false, nb)
  check('the window\'s row says in one sentence why and what to do', nb && ((/no Telegram bot/i.test(nb.text) && /Switch to a server that has one, such as Kybernos Cloud/i.test(nb.text)) || /pas de bot Telegram/.test(nb.text)), nb && nb.text)
  check('the switch stays greyed, and « Switch server » is offered', nb && nb.disabled === true && /Switch server|Changer de serveur/.test(nb.button || ''), nb)
  await shot('4b-no-bot')
  await click('kybernos-kyber-tg-switch')
  check('pressing the greyed switch asks for no code', (await calls('/kybernos-cloud/telegram/pairing')).length === tgPairs && (await has('kybernos-kyber-telegram')) === false)
  await click('kybernos-kyber-tg-switch-server')
  check('« Switch server » opens Settings on the Servers page, and the window gets out of the way', (await poll(async () => (await settingsOnServers()) === 'Servers', 10000)) === true && (await has('phone-channels')) === false, await settingsOnServers())
  await shot('4b-switch-server-opens-settings')
  await closeDialog()
  await sleep(500)

  // 2. no bot and nowhere to go: the strip is folded, the window says the sentence and offers no button
  await door(NOBOT, 'supported', false)
  await val(`window.__KB_KYBER__.refresh()`)
  check('no bot and no other server: the strip stays folded', (await poll(() => val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]')`), 6000)) === true)
  await closeWin()
  await click('kybernos-kyber-status')
  await poll(() => has('kybernos-kyber-pop'), 4000)
  check('opened by hand: the list\'s Telegram row says there is no bot here', /no Telegram bot|pas de bot Telegram/i.test((await stripRow()) || ''))
  await val(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await openWin()
  const alone = await rowFacts()
  check('the window: the sentence is there, no button, the switch greyed', alone !== null && /no Telegram bot|pas de bot Telegram/i.test(alone.text) && alone.button === null && alone.disabled === true, alone)

  // 3. a server too old for the pairing routes (404 on them): said, not failed silently
  await door('null', 'unsupported', true)
  await val(`window.__KB_KYBER__.refresh()`)
  const old = await poll(async () => { const r = await rowFacts(); return r !== null && r.state === 'old' ? r : null }, 8000)
  check('a server too old: the row says it does not support linking Telegram yet', old && /does not support linking Telegram yet|ne sait pas encore relier Telegram/.test(old.text), old)
  check('...with the switch greyed and the way out offered', old && old.disabled === true && /Switch server|Changer de serveur/.test(old.button || ''), old)
  check('the chip says unavailable here too', (await val(`(() => { const c = document.querySelector('[data-kb="kybernos-kyber-status"]'); return !c || /indisponible|unavailable/i.test(c.innerText) })()`)) === true)
  await shot('4c-server-too-old')

  // 4. at a phone's width: the sentence and the button fit the window, nothing scrolls sideways
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  await openWin()
  const fits = await val(`(() => { const b = document.querySelector('[data-kb="phone-channels"] [data-kb="kybernos-kyber-tg-switch-server"]'); const t = document.querySelector('[data-kb="phone-channels-card"]'); if (!b || !t) return null; const r = b.getBoundingClientRect(); const q = t.getBoundingClientRect(); return { inside: r.left >= q.left && r.right <= q.right, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 } })()`)
  check('390 px: the button is inside the card and nothing scrolls sideways', fits !== null && fits.inside === true && fits.sideways === false, fits)
  await shot('4c-server-too-old-390')
  await door(NOBOT, 'supported', true)
  await val(`window.__KB_KYBER__.refresh()`)
  await sleep(700)
  await shot('4b-no-bot-390')
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  // 5. a bot there: the switch works again
  await door("{ configured: true, enabled: true, bot: 'kybernos_bot', linked: null }", 'supported', true)
  await val(`window.__KB_KYBER__.refresh()`)
  await openWin()
  const bot = await poll(async () => { const r = await rowFacts(); return r !== null && r.state !== 'off' && r.state !== 'old' ? r : null }, 8000)
  check('a bot there: the switch is on offer, with no sentence and no server button in the way', bot && bot.disabled === false && bot.button === null && !/does not support|no Telegram bot|pas de bot/i.test(bot.text), bot)
  await sleep(300)

  console.log('── 9. a phone ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  await openWin()
  await click('kybernos-kyber-tg-switch')
  await poll(() => has('kybernos-kyber-open'), 6000)
  check('no sideways scroll', (await val(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true)
  check('Kaby\'s sub-blocks (messaging apps, computer) are one under the other', await (async () => { const x = await box('kybernos-kyber-messaging'); const y = await box('kybernos-kyber-computer'); return x !== null && y !== null && y.y >= x.b - 1 && Math.abs(x.w - y.w) <= 1 })())
  check('the window\'s cards are one under the other', await (async () => { const x = await box('phone-remote'); const y = await box('phone-channels-card'); return x !== null && y !== null && y.y >= x.b - 1 })())
  check('the QR is hidden (nobody scans their own screen), the Telegram button stays', (await val(`(() => { const q = document.querySelector('[data-kb="kybernos-kyber-qr"]'); const o = document.querySelector('[data-kb="kybernos-kyber-open"]'); return (!q || q.getClientRects().length === 0) && !!o && o.getClientRects().length > 0 })()`)) === true)
  await shot('5-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  console.log('── 10. the strip is above no other chat ──')
  // « New chat » starts in the workspace you are in, and Kaby's chat has its own: before its first message it is the blank that a new chat
  // there takes back (it is still Kaby's chat), so another chat is checked by what decides the strip, not by a click.
  const kybySid = await pointer()
  check('only the remembered chat is Kaby\'s: any other session id is not', (await val(`window.__KB_KYBER__.isKybySession(${JSON.stringify(kybySid)}) === true && window.__KB_KYBER__.isKybySession('session-00000000-0000-0000-0000-000000000000') === false && window.__KB_KYBER__.isKybySession('') === false`)) === true)

  console.log('── 11. the page ──')
  const opened = await val(`(async () => { try { return String(await window.__KB_OPEN__({ view: 'kyber' })) } catch (e) { return 'err' } })()`)
  check('the page opens (the new-chat card and the right tab use it)', (await poll(() => has('kybernos-kyber-page'), 12000)) === true, opened)
  check('it says what Kaby is and offers the way into the chat', /dans votre poche|in your pocket/.test((await text('kybernos-kyber-page')) || '') && /téléphone avec télécommande|phone with a remote control/.test((await text('kybernos-kyber-page')) || '') && (await has('kybernos-kyber-openchat')) === true)
  await shot('6-page')

  console.log('── 12. the choice of the computer survives a page load ──')
  await val(`window.localStorage.setItem('kybernos-kyber.where', 'local')`)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(1200)
  await closeDialog()
  await poll(() => has('kybernos-kyber-dock'), 25000)
  await openWin()
  check('after a reload this computer is still the one chosen', (await poll(() => val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-pick"]'); return !!s && s.value === 'local' })()`), 8000)) === true)
  await val(`window.localStorage.removeItem('kybernos-kyber.where')`)

  console.log('── 13. WhatsApp: a beta row that turns on like Telegram, on its own routes ──')
  const wa = (expr) => val(`(() => { const e = document.querySelector('[data-kb="kybernos-kyber-whatsapp"]'); return ${expr} })()`)
  const waRow = async () => (await text('kybernos-kyber-chan-whatsapp')) || ''
  check('the window opens', (await openWin()) === true)
  check('no server has the door: the row says it is not available, the switch is greyed, nothing is asked', /Pas encore disponible|Not available/.test(await waRow()) && (await val(`document.querySelector('[data-kb="kybernos-kyber-whatsapp-switch"]').disabled`)) === true && (await calls('/kybernos-cloud/whatsapp/pairing')).length === 0)
  await setMock(`window.__kbMock.kyber.whatsapp = { configured: true, enabled: true, available: false, linked: null }`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('a door whose bridge is not open: the number is said to be unreachable, the switch stays greyed', (await poll(async () => /joignable|reachable/.test(await waRow()), 6000)) === true && (await val(`document.querySelector('[data-kb="kybernos-kyber-whatsapp-switch"]').disabled`)) === true)
  await setMock(`window.__kbMock.kyber.whatsapp = { configured: true, enabled: true, available: true, linked: null }`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('with a bridge open the switch is on offer and nothing was asked yet', (await poll(() => val(`document.querySelector('[data-kb="kybernos-kyber-whatsapp-switch"]').disabled === false`), 6000)) === true && (await calls('/kybernos-cloud/whatsapp/pairing')).length === 0 && /Pas connecté|Not connected/.test(await waRow()))
  await shot('7a-whatsapp-idle')
  await click('kybernos-kyber-whatsapp-switch')
  check('the switch asked for exactly one WhatsApp pairing, and none for Telegram', (await poll(async () => (await calls('/kybernos-cloud/whatsapp/pairing')).length === 1, 6000)) === true && (await calls('/kybernos-cloud/telegram/pairing')).length === 0)
  check('a QR code is drawn, the switch is on and the row says there is a code to scan', (await poll(() => wa(`!!e && !!e.querySelector('[data-kb="kybernos-kyber-qr"] svg path')`), 6000)) === true && (await attr('kybernos-kyber-whatsapp-switch', 'aria-checked')) === 'true' && /Code à scanner|Code to scan/.test(await waRow()))
  check('the panel sits under WhatsApp\'s row and above WeChat, and Telegram shows no panel', (await val(`(() => { const w = document.querySelector('[data-kb="phone-channels"]'); const p = w.querySelector('[data-kb="kybernos-kyber-whatsapp"]'); const a = w.querySelector('[data-kb="kybernos-kyber-chan-whatsapp"]'); const b = w.querySelector('[data-kb="kybernos-kyber-chan-wechat"]'); if (!p || !a || !b) return false; const rp = p.getBoundingClientRect(); return rp.top >= a.getBoundingClientRect().bottom - 1 && rp.bottom <= b.getBoundingClientRect().top + 1 && !w.querySelector('[data-kb="kybernos-kyber-telegram"]') })()`)) === true)
  check('« Open WhatsApp » goes to the number\'s own link, in a new tab', (await val(`(() => { const a = document.querySelector('[data-kb="kybernos-kyber-wa-open"]'); return !!a && a.getAttribute('href') === ${JSON.stringify(WA_LINK)} && a.target === '_blank' && /noopener/.test(a.rel) && /WhatsApp/.test(a.innerText) })()`)) === true)
  check('three steps in WhatsApp\'s words (send the typed message, answer 1), and the time left', (await wa(`e.querySelectorAll('ol li').length === 3 && /message déjà écrit|already typed/.test(e.innerText) && /Réponds 1|Answer 1/.test(e.innerText) && !/Telegram/.test(e.innerText)`)) === true && /\d:\d\d/.test((await text('kybernos-kyber-wa-left')) || ''))
  await click('kybernos-kyber-wa-code')
  check('« write a code instead » shows the number and the message of THIS pairing, in DSH', (await poll(() => wa(`!!e && /\\+33600000012/.test(e.innerText) && !!e.querySelector('[data-kb="kybernos-kyber-wa-code-text"]') && e.querySelector('[data-kb="kybernos-kyber-wa-code-text"]').innerText === 'pair_0123456789abcdefghij0123'`), 5000)) === true && (await calls('/kybernos-cloud/console/link')).length === 0)
  await shot('7b-whatsapp-code')
  await setMock(`window.__kbMock.waPairingState = { ok: true, state: 'scanned', reason: null, sender: 'Amina', expires_at: '' }`)
  check('after the first message the panel names who WhatsApp says it is and asks for the answer', (await poll(() => wa(`!!e && /Amina/.test(e.innerText) && /Réponds 1|Answer 1/.test(e.innerText) && !e.querySelector('[data-kb="kybernos-kyber-qr"]')`), 8000)) === true)
  await setMock(`window.__kbMock.kyber.whatsapp.linked = { display: 'Amina', linked_at: '2026-10-20T10:00:00.000Z', paused: false }; window.__kbMock.waPairingState = { ok: true, state: 'done', reason: null, sender: 'Amina', expires_at: '' }`)
  check('on the answer the row becomes connected by itself: who, and the 24-hour rule; no panel is left', (await poll(async () => /Amina/.test(await waRow()) && /24 h/.test(await waRow()) && (await has('kybernos-kyber-whatsapp')) === false, 8000)) === true && (await attr('kybernos-kyber-whatsapp-switch', 'aria-checked')) === 'true')
  await shot('7c-whatsapp-connected')
  await click('kybernos-kyber-whatsapp-switch')
  check('turning it off asks first, and nothing is sent', (await poll(() => wa(`!!e && /Déconnecter WhatsApp|Disconnect WhatsApp/.test(e.innerText)`), 4000)) === true && (await calls('/kybernos-cloud/whatsapp/unlink')).length === 0)
  await click('kybernos-kyber-wa-unlink-yes')
  check('confirming disconnects on WhatsApp\'s route, and the row is « not connected » again', (await poll(async () => (await calls('/kybernos-cloud/whatsapp/unlink')).length === 1 && /Pas connecté|Not connected/.test(await waRow()), 8000)) === true)
  await click('kybernos-kyber-whatsapp-switch')
  await poll(() => has('kybernos-kyber-wa-open'), 6000)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  check('390 px with the code shown: no sideways scroll, and the panel is inside the screen', (await val(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true && (await wa(`!!e && e.getBoundingClientRect().right <= window.innerWidth + 1 && e.getBoundingClientRect().left >= -1`)) === true)
  await shot('7d-whatsapp-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed: ' + (e && e.message ? e.message : String(e)))
} finally {
  await live.close().catch(() => {})
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
