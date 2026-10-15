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
// a person with no Telegram on the Free plan (QR, steps, upsell, no wake button), the pairing going waiting -> scanned -> connected by
// itself (the strip folds), the choice of the computer linked to Kaby, a paid plan (wake and sleep), the strip folding and remembered, a server
// with no Telegram bot (folded, one line), a phone width,
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
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const LINK = 'https://t.me/kybernos_bot?start=pair_0123456789abcdefghij0123'
const PAIR = '33333333-3333-4333-8333-333333333333'
const qr = encodeQr(LINK, { ecc: 'M' })
const SERVER = { ok: true, server: { id: 'dev', api: 'https://server-dev-7831.up.railway.app', web: 'https://dev.kybernos.app' } }
const KYBER = (over) => Object.assign({
  ok: true,
  connected: true,
  telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null },
  computers: [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }],
  home: { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-15T09:50:00.000Z', version: 'p12', network: 'public', paused_reason: null, manual_control: false },
}, over || {})

// Installed before any script of the page: the answers the page gets for the Kaby routes. `window.__kbMock` is what the check drives.
const MOCK = `(() => {
  const m = window.__kbMock = { kyber: ${JSON.stringify(KYBER())}, server: ${JSON.stringify(SERVER)}, pairingState: { ok: true, state: 'waiting', reason: null, sender: '', expires_at: '' },
    calls: [], qr: ${JSON.stringify({ size: qr.size, modules: qr.modules })},
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
    if (p === '/kybernos-cloud/telegram/pairing' && method === 'POST') { rec(); return json({ ok: true, id: ${JSON.stringify(PAIR)}, link: ${JSON.stringify(LINK)}, bot: 'kybernos_bot', expires_at: new Date(Date.now() + 300000).toISOString(), qr: m.qr }) }
    if (p === '/kybernos-cloud/telegram/pairing/state') return json(Object.assign({}, m.pairingState, { expires_at: new Date(Date.now() + 200000).toISOString() }))
    if (p === '/kybernos-cloud/telegram/pairing/cancel') { rec(); return json({ ok: true }) }
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

  console.log('── 3. not connected, Free plan (in the strip) ──')
  check('the strip is open with the Channels title, because there is a code to scan', (await val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); return !!s && s.classList.contains('open') && /Canaux|Channels/.test(s.innerText) })()`)) === true)
  check('its line holds two chips only: Kaby\'s computer and Telegram', (await val(`(() => { const t = document.querySelector('[data-kb="kybernos-kyber-strip-toggle"]'); return !!t && t.querySelectorAll('.kbky-chip').length === 2 && /Kaby/.test(t.innerText) && /Telegram/.test(t.innerText) && !/WhatsApp|WeChat/.test(t.innerText) })()`)) === true)
  check('a QR code is drawn from the pairing', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-qr"] svg path')`))) === true)
  check('the strip asked for exactly one pairing', (await calls('/kybernos-cloud/telegram/pairing')).length === 1, await calls('/kybernos-cloud/telegram/pairing'))
  check('« Open Telegram » goes to the bot\'s link, in a new tab', (await val(`(() => { const a = document.querySelector('[data-kb="kybernos-kyber-open"]'); return !!a && a.getAttribute('href') === ${JSON.stringify(LINK)} && a.target === '_blank' && /noopener/.test(a.rel) })()`)) === true)
  check('the three steps are listed', (await val(`document.querySelectorAll('[data-kb="kybernos-kyber-telegram"] ol li').length`)) === 3)
  const comp = (await text('kybernos-kyber-computer')) || ''
  check('Kaby\'s computer is there from the start: its name, asleep, and the Free plan says it cannot be woken by hand', /Home/.test(comp) && /En veille|Asleep/.test(comp) && (await has('kybernos-kyber-upsell')) === true && (await has('kybernos-kyber-wake')) === false, comp.slice(0, 200))
  check('WhatsApp and WeChat are one muted line, with their mark and « Soon »', (await val(`(() => { const l = document.querySelector('[data-kb="kybernos-kyber-others"]'); return !!l && /Bientôt|Soon/.test(l.innerText) && ['whatsapp', 'wechat'].every((c) => { const e = document.querySelector('[data-kb="kybernos-kyber-chan-' + c + '"]'); return !!e && !!e.querySelector('svg path') }) })()`)) === true)
  check('calm: no radio, no settings, no « where it runs »', (await val(`document.querySelectorAll('[data-kb="kybernos-kyber-strip"] input[type="radio"]').length === 0 && !document.querySelector('[data-kb="kybernos-kyber-settings"]')`)) === true)
  await shot('2-strip-unlinked')

  console.log('── 4. the pairing goes by itself ──')
  await setMock(`window.__kbMock.pairingState = { ok: true, state: 'scanned', reason: null, sender: 'Miled (@milede)', expires_at: '' }`)
  check('after the scan the card names who Telegram says it is', (await poll(() => val(`/Miled \\(@milede\\)/.test((document.querySelector('[data-kb="kybernos-kyber-telegram"]') || {}).innerText || '')`), 8000)) === true)
  await setMock(`window.__kbMock.kyber.telegram.linked = { display: 'Miled (@milede)', linked_at: '2026-10-15T10:00:00.000Z', paused: false, blocked: false }; window.__kbMock.pairingState = { ok: true, state: 'done', reason: null, sender: 'Miled (@milede)', expires_at: '' }`)
  check('on the tap the status becomes connected by itself', (await poll(() => val(`/connecté|connected/i.test((document.querySelector('[data-kb="kybernos-kyber-status"]') || {}).innerText || '') && !/non connect|not connected/i.test((document.querySelector('[data-kb="kybernos-kyber-status"]') || {}).innerText || '')`), 9000)) === true)
  check('the strip folds itself once connected, so the chat is in view', (await val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]')`)) === true)
  await click('kybernos-kyber-strip-toggle')
  check('opened, the Telegram card is the connected one', (await poll(() => val(`/Connecté : Miled|Connected: Miled/.test((document.querySelector('[data-kb="kybernos-kyber-telegram"]') || {}).innerText || '')`), 5000)) === true)
  check('the Telegram card is one line, with Open and Disconnect', (await val(`!!document.querySelector('[data-kb="kybernos-kyber-bot"]') && !!document.querySelector('[data-kb="kybernos-kyber-unlink"]')`)) === true)
  await shot('3-connected')

  console.log('── 5. the computer linked to Kaby ──')
  check('with one computer there is nothing to choose', (await has('kybernos-kyber-pick')) === false)
  await setMock(`window.__kbMock.kyber.computers = [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }, { id: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Atelier', state: 'running' }]`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('with several, a plain choice appears', (await poll(() => has('kybernos-kyber-pick'), 6000)) === true)
  await val(`(() => { const sel = document.querySelector('[data-kb="kybernos-kyber-pick"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  check('the choice is sent to the host', (await poll(async () => (await calls('/kybernos-cloud/kyby/computer')).some((c) => c.body && c.body.computer_id === '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 5000)) === true)
  check('and read again: the strip line names the new computer\'s state', (await poll(() => val(`/Atelier|Éveillé|Awake/.test(document.querySelector('[data-kb="kybernos-kyber-computer"]').innerText)`), 6000)) === true)
  await setMock(`window.__kbMock.kyber.computers = [{ id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' }]; window.__kbMock.kyber.home = Object.assign({}, window.__kbMock.kyber.home, { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Home', state: 'suspended' })`)
  await val(`window.__KB_KYBER__.refresh()`)
  await sleep(600)

  console.log('── 6. a paid plan: the computer can be driven ──')
  await setMock(`window.__kbMock.kyber.home.manual_control = true`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the wake button appears and the upsell goes', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-wake"]') && !document.querySelector('[data-kb="kybernos-kyber-upsell"]')`), 8000)) === true)
  await click('kybernos-kyber-wake')
  check('a wake is asked of the host', (await poll(async () => (await calls('/kybernos-cloud/computer/resume')).length === 1, 5000)) === true)
  check('the card then offers to put it to sleep and to open it', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-sleep"]') && !!document.querySelector('[data-kb="kybernos-kyber-pcopen"]')`), 8000)) === true)

  console.log('── 7. the strip folds, and is remembered ──')
  await click('kybernos-kyber-strip-toggle')
  check('folded: the panel is gone, the two chips stay', (await val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]') && /Telegram/.test(document.querySelector('[data-kb="kybernos-kyber-strip"]').innerText) && /Kaby/.test(document.querySelector('[data-kb="kybernos-kyber-strip"]').innerText)`)) === true)
  check('the choice is remembered for the next visit', (await val(`window.localStorage.getItem('kybernos-kyber.strip')`)) === '0')
  await val(`window.localStorage.removeItem('kybernos-kyber.strip')`)
  await shot('4-folded')

  console.log('── 8. disconnecting ──')
  await click('kybernos-kyber-strip-toggle')
  await click('kybernos-kyber-unlink')
  check('disconnect asks to confirm first', (await has('kybernos-kyber-unlink-yes')) === true && (await calls('/kybernos-cloud/telegram/unlink')).length === 0)
  await click('kybernos-kyber-unlink-yes')
  check('confirmed: it is sent and the card goes back to the connection', (await poll(async () => (await calls('/kybernos-cloud/telegram/unlink')).length === 1 && (await val(`/Connecter Telegram|Connect Telegram/.test((document.querySelector('[data-kb="kybernos-kyber-telegram"]') || {}).innerText || '')`)) === true, 9000)) === true)

  console.log('── 8b. a server with no Telegram bot ──')
  await val(`window.__KB_KYBER__.resetStrip()`)
  await setMock(`window.__kbMock.kyber.telegram = { configured: false, enabled: false, bot: null, linked: null }`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the chip says Telegram is unavailable', (await poll(() => val(`/indisponible|unavailable/i.test(document.querySelector('[data-kb="kybernos-kyber-status"]').innerText)`), 6000)) === true)
  check('the strip is folded by itself: there is nothing to do in it', (await val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]')`)) === true)
  await click('kybernos-kyber-strip-toggle')
  check('opened, it is one muted line, not a card', (await val(`(() => { const e = document.querySelector('[data-kb="kybernos-kyber-telegram"]'); return !!e && e.tagName === 'P' && e.getAttribute('data-state') === 'off' && /server|serveur/.test(e.innerText) })()`)) === true)
  await shot('4b-no-bot')
  await val(`window.__KB_KYBER__.resetStrip()`)
  await setMock(`window.__kbMock.kyber.telegram = { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }`)
  await val(`window.__KB_KYBER__.refresh()`)
  await sleep(500)

  console.log('── 9. a phone ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  check('no sideways scroll', (await val(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true)
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
  check('it says what Kaby is and offers the way into the chat', /dans votre poche|in your pocket/.test((await text('kybernos-kyber-page')) || '') && (await has('kybernos-kyber-openchat')) === true)
  await shot('6-page')
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed: ' + (e && e.message ? e.message : String(e)))
} finally {
  await live.close().catch(() => {})
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
