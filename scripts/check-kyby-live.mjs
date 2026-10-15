#!/usr/bin/env node
// The Kyby page (packages/kybernos-kyber), in a real GUI.
//
//   node scripts/check-kyby-live.mjs [--shots <dir>]      (KB_HOST=127.0.0.1:3080 by default: the real DSH)
//
// What is real: the DSH page, its sidebar, the Kyby row and the page the row opens. What is swapped, in a throw-away Chrome and only
// there (scripts/lib-bundle-swap.mjs): the kybernos-kyber client, from this checkout. What is faked: the answers of the
// `/kybernos-cloud/*` routes the page reads, by replacing the page's `fetch` for those paths only, before any script runs; nothing
// is sent to any server and nothing is written to the user's disk or account.
//
// It plays: a person with no Telegram on the Free plan (QR, steps, upsell, no wake button), the pairing going waiting -> scanned ->
// connected by itself, the setting where a message runs, the chat (a message, the typing line, the answer, a refusal), a paid plan
// (wake and sleep), the strip folding, and a phone width. Exit code 0 / 1 / 3 (not run).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
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
  telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null, home_target: 'cloud' },
  home: { state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-15T09:50:00.000Z', version: 'p12', network: 'public', paused_reason: null, manual_control: false },
}, over || {})

// Installed before any script of the page: the answers the page gets for the Kyby routes. `window.__kbMock` is what the check drives.
const MOCK = `(() => {
  const m = window.__kbMock = { kyber: ${JSON.stringify(KYBER())}, server: ${JSON.stringify(SERVER)}, pairingState: { ok: true, state: 'waiting', reason: null, sender: '', expires_at: '' },
    messages: [], calls: [], sendError: null, qr: ${JSON.stringify({ size: qr.size, modules: qr.modules })}, nextPosition: 1,
    answer (text) { m.messages.push({ position: m.nextPosition++, role: 'assistant', text, at: new Date().toISOString(), via: null }) } }
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
    if (p === '/kybernos-cloud/telegram/settings') { rec(); m.kyber.telegram.home_target = body.home_target; return json({ ok: true, home_target: body.home_target }) }
    if (p === '/kybernos-cloud/telegram/unlink') { rec(); m.kyber.telegram.linked = null; return json({ ok: true }) }
    if (p === '/kybernos-cloud/kyby' && method === 'GET') return json({ ok: true, thread_id: '22222222-2222-4222-8222-222222222222', model: 'glm-5.3-flash', messages: m.messages.slice(), has_older: false })
    if (p === '/kybernos-cloud/kyby/send') {
      rec()
      if (m.sendError) return json({ ok: false, error: m.sendError })
      const pos = m.nextPosition++
      m.messages.push({ position: pos, role: 'user', text: body.message, at: new Date().toISOString(), via: null })
      return json({ ok: true, deduplicated: false, position: pos })
    }
    if (p === '/kybernos-cloud/computer/resume') { rec(); m.kyber.home.state = 'running'; return json({ ok: true, state: 'running', desired: 'running' }) }
    if (p === '/kybernos-cloud/computer/suspend') { rec(); m.kyber.home.state = 'suspended'; return json({ ok: true, state: 'suspended', desired: 'suspended' }) }
    if (p === '/kybernos-cloud/computer/open') { rec(); return json({ ok: true, url: 'https://example.invalid/computer' }) }
    if (p === '/kybernos-cloud/console/link') { rec(); return json({ ok: true, opened: true }) }
    return real(url, init)
  }
})()`

const host = process.env.KB_HOST || '127.0.0.1:3080'
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
  const swap = await swapBundles(page, [{ name: 'kybernos-kyber' }])
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  console.log('Kyby page — ' + host + ' (this checkout\'s client, faked answers)')
  check('the kybernos-kyber client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  console.log('── 1. the row and the page ──')
  const row = await poll(() => val(`(() => { const e = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter((x) => (x.innerText || '').trim().split('\\n')[0] === 'Kyby' && x.getClientRects().length > 0)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`), 20000)
  check('the sidebar has a Kyby row', typeof row === 'string', row)
  if (typeof row !== 'string') throw new Error('no Kyby row: the account may not load the bundle')
  const rowPos = JSON.parse(row)
  check('there is no Cloud Computer row any more', (await val(`!Array.from(document.querySelectorAll('button, a, [role="button"]')).some((x) => (x.innerText || '').trim().split('\\n')[0] === 'Cloud Computer' && x.getBoundingClientRect().x < 300)`)) === true)
  await mouse(rowPos.x, rowPos.y)
  check('the row opens the Kyby page', (await poll(() => has('kybernos-kyber-page'))) === true)
  await sleep(1200)

  console.log('── 2. not connected, Free plan ──')
  const page0 = (await text('kybernos-kyber-page')) || ''
  check('the intro says what Kyby does', /dans votre poche|in your pocket/.test(page0), page0.slice(0, 200))
  check('the strip is open with the Channels title', (await val(`(() => { const s = document.querySelector('[data-kb="kybernos-kyber-strip"]'); return !!s && s.classList.contains('open') })()`)) === true)
  check('WhatsApp and WeChat are there, with their mark and « Soon »', (await val(`['whatsapp', 'wechat'].every((c) => { const e = document.querySelector('[data-kb="kybernos-kyber-chan-' + c + '"]'); return !!e && !!e.querySelector('svg path') && /Bientôt|Soon/.test(e.innerText) })`)) === true)
  check('a QR code is drawn from the pairing', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-qr"] svg path')`))) === true)
  check('the page asked for exactly one pairing', (await calls('/kybernos-cloud/telegram/pairing')).length === 1, await calls('/kybernos-cloud/telegram/pairing'))
  check('« Open Telegram » goes to the bot\'s link, in a new tab', (await val(`(() => { const a = document.querySelector('[data-kb="kybernos-kyber-open"]'); return !!a && a.getAttribute('href') === ${JSON.stringify(LINK)} && a.target === '_blank' && /noopener/.test(a.rel) })()`)) === true)
  check('the three steps are listed', (await val(`document.querySelectorAll('[data-kb="kybernos-kyber-telegram"] ol li').length`)) === 3)
  check('the countdown is on screen', /4:|3:|2:/.test((await text('kybernos-kyber-telegram')) || ''))
  const comp = (await text('kybernos-kyber-computer')) || ''
  check('the computer is asleep and the Free plan says it cannot be woken by hand', /En veille|Asleep/.test(comp) && (await has('kybernos-kyber-upsell')) === true && (await has('kybernos-kyber-wake')) === false, comp.slice(0, 200))
  check('the where-setting is there but locked until Telegram is connected', (await val(`Array.from(document.querySelectorAll('[data-kb^="kybernos-kyber-where-"] input')).every((i) => i.disabled)`)) === true)
  await click('kybernos-kyber-upgrade')
  await sleep(500)
  check('« upgrade » opens the plan page (no dialog seam in this GUI: the console link is asked)', (await calls('/kybernos-cloud/console/link')).some((c) => c.body && c.body.section === 'plan'), await calls('/kybernos-cloud/console/link'))
  await shot('1-free-unlinked')

  console.log('── 3. the pairing goes by itself ──')
  await setMock(`window.__kbMock.pairingState = { ok: true, state: 'scanned', reason: null, sender: 'Miled (@milede)', expires_at: '' }`)
  check('after the scan the card names who Telegram says it is', (await poll(() => val(`/Miled \\(@milede\\)/.test(document.querySelector('[data-kb="kybernos-kyber-telegram"]').innerText)`), 8000)) === true)
  check('and it waits for the tap in Telegram (no QR to scan any more as a call to action)', (await val(`document.querySelector('[data-kb="kybernos-kyber-telegram"]').getAttribute('data-state')`)) === 'scanned')
  await shot('2-scanned')
  await setMock(`window.__kbMock.kyber.telegram.linked = { display: 'Miled (@milede)', linked_at: '2026-10-15T10:00:00.000Z', paused: false, blocked: false }; window.__kbMock.pairingState = { ok: true, state: 'done', reason: null, sender: 'Miled (@milede)', expires_at: '' }`)
  check('on the tap the status becomes connected by itself, without a click', (await poll(() => val(`/connecté|connected/i.test((document.querySelector('[data-kb="kybernos-kyber-status"]') || {}).innerText || '') && !/non connect|not connected/i.test((document.querySelector('[data-kb="kybernos-kyber-status"]') || {}).innerText || '')`), 9000)) === true)
  check('the strip folds itself once connected, so the chat is in view', (await val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]')`)) === true)
  check('the intro folds into a one-line subtitle', (await val(`!!document.querySelector('[data-kb="kybernos-kyber-page"] details')`)) === true)
  await click('kybernos-kyber-strip-toggle')
  check('opened, the Telegram card is the connected one', (await poll(() => val(`/Connecté : Miled|Connected: Miled/.test((document.querySelector('[data-kb="kybernos-kyber-telegram"]') || {}).innerText || '')`), 5000)) === true)
  check('the where-setting is now open', (await val(`Array.from(document.querySelectorAll('[data-kb="kybernos-kyber-where-cloud"] input, [data-kb="kybernos-kyber-where-ask"] input')).every((i) => !i.disabled)`)) === true)
  check('« My Mac » stays greyed with « Soon »', (await val(`(() => { const e = document.querySelector('[data-kb="kybernos-kyber-where-mac"]'); return !!e && e.querySelector('input').disabled && /Bientôt|Soon/.test(e.innerText) })()`)) === true)
  await shot('3-connected')

  console.log('── 4. where a message runs ──')
  await val(`(() => { const i = document.querySelector('[data-kb="kybernos-kyber-where-ask"] input'); i.click(); return true })()`)
  check('choosing « Ask me » is sent to the server', (await poll(async () => (await calls('/kybernos-cloud/telegram/settings')).some((c) => c.body && c.body.home_target === 'ask'), 5000)) === true)
  check('the strip chip follows', (await poll(() => val(`/Me demander|Ask me/.test(document.querySelector('[data-kb="kybernos-kyber-strip-toggle"]').innerText)`), 5000)) === true)

  console.log('── 5. the chat ──')
  check('the chat greets an empty conversation', (await poll(() => val(`/Bonjour|Hello/.test(document.querySelector('[data-kb="kybernos-kyber-chat"]').innerText)`))) === true)
  check('the draft box is there with a send button', (await has('kybernos-kyber-draft')) === true && (await has('kybernos-kyber-send')) === true)
  await typeIn('Fais-moi un plan pour ma semaine.')
  await sleep(200)
  await click('kybernos-kyber-send')
  check('the message is sent on the person\'s thread', (await poll(async () => (await calls('/kybernos-cloud/kyby/send')).length === 1, 5000)) === true)
  check('its words are in the conversation and Kyby is shown answering', (await poll(() => val(`/Fais-moi un plan pour ma semaine/.test(document.querySelector('[data-kb="kybernos-kyber-chat"]').innerText) && !!document.querySelector('[data-kb="kybernos-kyber-typing"]')`), 6000)) === true)
  await setMock(`window.__kbMock.answer('Voici une première version de votre semaine.')`)
  check('the answer arrives by itself and the typing line goes', (await poll(() => val(`/première version de votre semaine/.test(document.querySelector('[data-kb="kybernos-kyber-chat"]').innerText) && !document.querySelector('[data-kb="kybernos-kyber-typing"]')`), 9000)) === true)
  await shot('4-chat')
  await setMock(`window.__kbMock.sendError = 'insufficient_quota'`)
  await typeIn('Encore une question')
  await sleep(200)
  await click('kybernos-kyber-send')
  check('a used-up allowance is said in words, and the draft is kept', (await poll(() => val(`/allocation|allowance/.test((document.querySelector('[data-kb="kybernos-kyber-error"]') || {}).innerText || '')`), 5000)) === true && (await val(`document.querySelector('[data-kb="kybernos-kyber-draft"]').value`)) === 'Encore une question')
  await setMock(`window.__kbMock.sendError = null`)

  console.log('── 6. a paid plan: the computer can be driven ──')
  await setMock(`window.__kbMock.kyber.home.manual_control = true`)
  await val(`window.__KB_KYBER__.refresh()`)
  check('the wake button appears and the upsell goes', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-wake"]') && !document.querySelector('[data-kb="kybernos-kyber-upsell"]')`), 8000)) === true)
  await click('kybernos-kyber-wake')
  check('a wake is asked of the host', (await poll(async () => (await calls('/kybernos-cloud/computer/resume')).length === 1, 5000)) === true)
  check('the card then offers to put it to sleep and to open it', (await poll(() => val(`!!document.querySelector('[data-kb="kybernos-kyber-sleep"]') && !!document.querySelector('[data-kb="kybernos-kyber-pcopen"]')`), 8000)) === true)
  await shot('5-paid-awake')

  console.log('── 7. the strip folds ──')
  await click('kybernos-kyber-strip-toggle')
  check('folded: the panel is gone, the chips stay', (await val(`!document.querySelector('[data-kb="kybernos-kyber-channels"]') && /WhatsApp/.test(document.querySelector('[data-kb="kybernos-kyber-strip"]').innerText)`)) === true)
  check('the choice is remembered for the next visit', (await val(`window.localStorage.getItem('kybernos-kyber.strip')`)) === '0')
  await val(`window.localStorage.removeItem('kybernos-kyber.strip')`)
  await shot('6-folded')

  console.log('── 8. disconnecting ──')
  await click('kybernos-kyber-strip-toggle')
  await click('kybernos-kyber-unlink')
  check('disconnect asks to confirm first', (await has('kybernos-kyber-unlink-yes')) === true && (await calls('/kybernos-cloud/telegram/unlink')).length === 0)
  await click('kybernos-kyber-unlink-yes')
  check('confirmed: it is sent and the card goes back to the connection', (await poll(async () => (await calls('/kybernos-cloud/telegram/unlink')).length === 1 && (await val(`/Connecter Telegram|Connect Telegram/.test(document.querySelector('[data-kb="kybernos-kyber-telegram"]').innerText)`)) === true, 9000)) === true)

  console.log('── 9. a phone ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  check('no sideways scroll', (await val(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true)
  check('the QR is hidden (nobody scans their own screen), the Telegram button stays', (await val(`(() => { const q = document.querySelector('[data-kb="kybernos-kyber-qr"]'); const o = document.querySelector('[data-kb="kybernos-kyber-open"]'); return (!q || q.getClientRects().length === 0) && !!o && o.getClientRects().length > 0 })()`)) === true)
  await shot('7-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed: ' + (e && e.message ? e.message : String(e)))
} finally {
  await live.close().catch(() => {})
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
