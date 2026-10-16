#!/usr/bin/env node
// Kaby against a REAL kybernos-server, in a real DSH page, with Telegram played by HTTP (ADR 0053 of kybernos-server).
//
// Nothing is faked on this side (the page, the host's routes, the account's token) and nothing is faked on the server side except Telegram itself: the server
// is the built one, and Telegram is a small HTTP server of ours that answers the Bot API calls and keeps them (kybernos-server/scripts/telegram-live.ts --serve).
// This script plays the person's phone: it posts the webhook updates Telegram would post (a « /start pair_<token> », then a tap on the bot's own button),
// and the page must follow by itself: code, scanned (and who), connected, then disconnected.
//
//   # 1. the server, in the server repository (needs `pnpm build` once):
//   node scripts/telegram-live.ts --serve /tmp/kaby-serve.json &
//   # 2. here, with the sandbox's shell (scripts/sandbox/setup.sh once):
//   source scripts/sandbox/env.sh && node scripts/check-kyby-http.mjs /tmp/kaby-serve.json [--shots <dir>]
//   # 3. end the server:  touch /tmp/kaby-serve.json.stop
//
// It writes a connected state for the person the server made, (re)starts the sandbox instance with KYBERNOS_CLOUD_API and KYBERNOS_CLOUD_STATE pointing at it, and
// stops it again at the end. It refuses the user's own :3080 (exit 3), as check-kyby-live.mjs does. Exit code 0 / 1 / 3 (not run).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const serveFile = args.find((a) => !a.startsWith('--') && a !== (args[args.indexOf('--shots') + 1]))
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
if (serveFile === undefined || !existsSync(serveFile)) { console.error('○ inconclusive: give the file written by `node scripts/telegram-live.ts --serve <file.json>` (and keep that process running).'); process.exit(3) }
if ((process.env.KB_HOST || '127.0.0.1:3080') === '127.0.0.1:3080') { console.error('○ inconclusive: run it from the sandbox shell (`source scripts/sandbox/env.sh`), never against the user\'s own DSH.'); process.exit(3) }
const srv = JSON.parse(readFileSync(serveFile, 'utf8'))
const stateFile = serveFile.replace(/\.json$/, '') + '.cloud-state.json'
writeFileSync(stateFile, JSON.stringify({ token: srv.token, user: srv.me, expires_at: null, connected_at: new Date().toISOString(), api: srv.base, device_label: 'DSH sandbox' }), { mode: 0o600 })
const sandbox = (verb, env) => execFileSync('bash', [join(here, 'sandbox', verb + '.sh')], { env: Object.assign({}, process.env, env || {}), stdio: 'pipe' })
sandbox('stop')
sandbox('start', { KYBERNOS_CLOUD_API: srv.base, KYBERNOS_CLOUD_STATE: stateFile })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (n, ok, d) => { if (ok === true) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 300))) } }
const ADA = { id: 777001, is_bot: false, first_name: 'Ada', username: 'ada_tg', language_code: 'en' }
let n = 50000
const webhook = (update) => fetch(srv.base + '/v1/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': srv.secret }, body: JSON.stringify(update) })
const say = (text) => webhook({ update_id: ++n, message: { message_id: n, date: 1700000000, chat: { id: ADA.id, type: 'private' }, from: ADA, text } })
const tap = (data) => webhook({ update_id: ++n, callback_query: { id: 'cb' + n, from: ADA, message: { message_id: 7, date: 1700000000, chat: { id: ADA.id, type: 'private' } }, data } })
const botSaid = async () => (await (await fetch(srv.telegram + '/__calls')).json())
const live = await openLivePage({ width: 1400, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms)).val
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const has = (kb) => val(`!!document.querySelector('[data-kb="${kb}"]')`)
const text = (kb) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); return e ? e.innerText : null })()`)
const click = (kb) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); if (!e) return false; e.click(); return true })()`)
const attr = (kb, a) => val(`(() => { const e = document.querySelector('[data-kb="${kb}"]'); return e ? e.getAttribute(${JSON.stringify(a)}) : null })()`)
const closeDialog = async () => { for (let i = 0; i < 3; i++) { if ((await val(`!document.querySelector('[role="dialog"]')`)) === true) return; await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400) } }
try {
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  await sleep(1500)
  await closeDialog()
  console.log('Kaby against a REAL server (' + srv.base + '), Telegram played by HTTP')
  await val(`fetch('/kybernos-cloud/kyby/native/set', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: null }) }).then((r) => r.json())`)
  await val(`(() => { const e = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter((x) => (x.innerText || '').trim().split('\\n')[0] === 'Kaby' && x.getClientRects().length > 0)[0]; if (e) e.click(); return !!e })()`)
  check('Kaby\'s chat opens with the strip above its composer', (await poll(() => has('kybernos-kyber-dock'), 25000)) === true)
  await closeDialog()
  await poll(() => has('kybernos-kyber-tg-switch'), 15000)
  const row0 = (await text('kybernos-kyber-tg-row')) || ''
  check('the real server answered: Telegram is there, not connected', /Telegram/.test(row0) && /Pas connecté|Not connected/.test(row0), row0)
  check('the switch is usable (this server has a bot)', (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'false' && (await val(`!document.querySelector('[data-kb="kybernos-kyber-tg-switch"]').disabled`)) === true)
  const comp0 = (await text('kybernos-kyber-computer')) || ''
  check('the computer tile: Home, on request, made at the first request that needs one', /Home/.test(comp0) && /À la demande|On request/.test(comp0) && /première demande|first request/.test(comp0), comp0.slice(0, 160))
  check('no code was asked for by opening the strip', (await has('kybernos-kyber-qr')) === false)

  await click('kybernos-kyber-tg-switch')
  check('the switch asks the real server for a code: a QR and the bot\'s link appear', (await poll(() => has('kybernos-kyber-qr'), 10000)) === true)
  const href = (await attr('kybernos-kyber-open', 'href')) || ''
  const token = /pair_([a-z0-9]{24})$/.exec(href)
  check('the link is the bot\'s, with a single-use token', /^https:\/\/t\.me\/kybernos_bot\?start=pair_[a-z0-9]{24}$/.test(href), href)

  const r1 = await say('/start pair_' + (token ? token[1] : 'x'))
  check('Telegram posts « /start pair_<token> » (HTTP): the server answers 200', r1.status === 200, r1.status)
  check('the page shows it was scanned, and who Telegram says it is, by itself', (await poll(async () => /Ada/.test((await text('kybernos-kyber-telegram')) || '') && (await attr('kybernos-kyber-telegram', 'data-state')) === 'scanned', 12000)) === true, await text('kybernos-kyber-telegram'))
  const calls = await botSaid()
  const ask = calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(ADA.id)).at(-1)
  const yes = ((ask && ask.body.reply_markup && ask.body.reply_markup.inline_keyboard) || []).flat().find((b) => /^pr:y:/.test(b.callback_data))
  check('the bot asked in the chat, with a « yes » button of its own', !!yes, ask && ask.body.text)
  await tap(yes ? yes.callback_data : 'pr:y:none')
  check('after the tap the page is connected by itself: the strip folds and says Telegram is connected', (await poll(async () => /connecté|connected/i.test((await text('kybernos-kyber-status')) || '') && !/non connect|not connected/i.test((await text('kybernos-kyber-status')) || ''), 12000)) === true, await text('kybernos-kyber-status'))
  await click('kybernos-kyber-strip-toggle')
  await poll(() => has('kybernos-kyber-tg-row'), 5000)
  const row1 = (await text('kybernos-kyber-tg-row')) || ''
  check('opened: Telegram\'s row names the chat Telegram gave, the switch is on, the bot has its link', /Ada/.test(row1) && (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'true' && (await has('kybernos-kyber-bot')) === true, row1)
  const me = await (await fetch(srv.base + '/v1/me/telegram', { headers: { authorization: 'Bearer ' + srv.token } })).json()
  check('and the server agrees: this account has that Telegram linked', me.linked && /Ada/.test(me.linked.display), me)

  await click('kybernos-kyber-tg-switch')
  check('turning the switch off asks first', (await has('kybernos-kyber-unlink-yes')) === true)
  await click('kybernos-kyber-unlink-yes')
  check('confirmed: the row goes back to not connected, the switch off', (await poll(async () => (await attr('kybernos-kyber-tg-switch', 'aria-checked')) === 'false' && /Pas connecté|Not connected/.test((await text('kybernos-kyber-tg-row')) || ''), 10000)) === true)
  const me2 = await (await fetch(srv.base + '/v1/me/telegram', { headers: { authorization: 'Bearer ' + srv.token } })).json()
  check('and the server agrees: nothing is linked', me2.linked === null, me2)
  if (shotDir !== null) { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, 'http-final.png')).catch(() => {}) }
} catch (e) { fail++; console.log('  ✗ the check itself failed: ' + (e && e.message ? e.message : e)) } finally { await live.close().catch(() => {}); try { sandbox('stop') } catch (e) { /* already stopped */ } }
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
