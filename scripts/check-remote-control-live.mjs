#!/usr/bin/env node
// Settings › Remote Control when one status poll fails, in a real GUI (audit A5-08).
//
//   source scripts/sandbox/env.sh && node scripts/check-remote-control-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// Nothing is paired and nothing is written: the page polls GET /kybernos-mobile/remote/status every 1.5 s, and this script answers
// that route itself (browser request interception): a signed-in account that may use the phone link, then a poll that fails (a
// network error, an HTTP 500 with an HTML body, an empty object, {ok:false}), then a good one again.
//
// What it proves: the page keeps what it showed (the « Add a phone » button) and says it cannot reach DSH, instead of going blank
// with « Cannot read properties of undefined (reading 'state') », and it recovers by itself on the next good poll.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)

const GOOD = { ok: true, available: true, running: true, connected: true, configured: true, entitled: true, computer: 'Test', max_devices: 3, relay: 'up', refused: 0, error: null, pairing: null, devices: [] }
let mode = 'good'
const answers = {
  good: () => ({ code: 200, type: 'application/json', body: JSON.stringify(GOOD) }),
  html: () => ({ code: 500, type: 'text/html', body: '<html><body>Internal Server Error</body></html>' }),
  empty: () => ({ code: 200, type: 'application/json', body: '{}' }),
  notok: () => ({ code: 200, type: 'application/json', body: JSON.stringify({ ok: false, error: 'server_unavailable' }) }),
}
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-mobile/remote/status*', requestStage: 'Request' }] })
page.on('Fetch.requestPaused', async (p) => {
  try {
    if (mode === 'network') { await page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' }); return }
    const a = answers[mode]()
    await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: a.code, responseHeaders: [{ name: 'content-type', value: a.type }], body: Buffer.from(a.body).toString('base64') })
  } catch (e) { /* the page moved on */ }
})
const errors = []
await page.send('Runtime.enable', {})
page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 160)))

try {
  await sleep(2500)
  check('Settings open', (await openSettings(page)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Remote Control'); if (!b) return false; b.click(); return true })()`)
  check('the Remote Control entry is in the Settings menu', went === true)
  check('the page shows « Add a phone » for a signed-in account', (await poll(() => q('[data-kb="mobile-pair"]'))) !== null)
  await shot('remote-control-good')
  for (const kind of ['network', 'html', 'empty', 'notok']) {
    mode = kind
    await sleep(2200) // one or two polls fail
    check(kind + ': the page keeps its content (« Add a phone » is still there)', (await q('[data-kb="mobile-pair"]')) === 1 && (await q('[data-kb="mobile-page"]')) === 1)
    check(kind + ': and says it cannot reach DSH', (await q('[data-kb="mobile-poll-error"]')) === 1)
    if (kind === 'network') await shot('remote-control-poll-failed')
    mode = 'good'
    check(kind + ': it recovers by itself on the next good poll', (await poll(() => val(`document.querySelectorAll('[data-kb="mobile-poll-error"]').length === 0 && document.querySelectorAll('[data-kb="mobile-pair"]').length === 1`), 6000)) !== null)
  }
  check('no « Cannot read properties of undefined » was thrown', errors.every((e) => !/Cannot read properties of undefined/.test(e)), errors)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
