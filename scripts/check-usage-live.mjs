#!/usr/bin/env node
// The Usage plugin (packages/kybernos-usage), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-usage-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
//
// What it checks, in a real page:
//   1. the host routes of this checkout answer through the page's own origin, and they book what the page reports
//      (a first sight is a baseline, the next report is a delta on today, a model on the plan is kept apart);
//   2. the Settings page (Settings › Usage) draws that ledger: the plan block (not signed in here), the own-keys block,
//      the by-model and by-session lists, the period switch, the folded budget that saves through the real route;
//   3. a narrow window does not overflow;
//   4. the chip: with no model key the chat has no counters, so the chip must stay absent and break nothing.
//
// NOT covered here (no key, no turn in a sandbox): the chip drawn from a real turn's `tokenUsage`. That path is covered by
// the unit tests on the helpers and has to be seen once on a keyed machine.
//
// SAFETY: the sandbox has its own DSH_HOME; the only thing written is its own usage ledger. Exit code 0 / 1 / 3.
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
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const clickAct = (act) => val(`(() => { const b = document.querySelector('[data-act="${act}"]'); if (!b || b.disabled) return false; b.click(); return true })()`)
const api = (path, body) => val(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => JSON.stringify({ status: r.status, body: await r.json().catch(() => null) }))`).then((s) => JSON.parse(s))
const U = (u, o, cr) => ({ uncachedInputTokens: u, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: 0 })

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }

  console.log('── 1. the host, through the page ──')
  const before = await api('/kybernos-usage/summary?days=7')
  check('summary answers on the page\'s own origin, seven days, oldest first', before.status === 200 && before.body.ok === true && before.body.daily.length === 7, before)
  const stamp = Date.now()
  const sa = 'chk-a-' + stamp; const sb = 'chk-b-' + stamp; const sc = 'chk-c-' + stamp
  const seed = [
    [sa, 'deepseek', 'deepseek-chat', 'Check A', U(100000, 5000, 900000)], [sa, 'deepseek', 'deepseek-chat', 'Check A', U(150000, 9000, 1500000)],
    [sb, 'ollama', 'qwen3', 'Check B', U(20000, 1000, 0)], [sb, 'ollama', 'qwen3', 'Check B', U(30000, 2500, 0)],
    [sc, 'kybernos', 'kybernos-pro', 'Check C', U(40000, 2000, 300000)], [sc, 'kybernos', 'kybernos-pro', 'Check C', U(60000, 3000, 500000)],
  ]
  let allOk = true
  for (const [sessionId, provider, model, title, usage] of seed) { const r = await api('/kybernos-usage/observe', { sessionId, provider, model, title, usage }); if (r.status !== 200) allOk = false }
  check('six reports are accepted', allOk)
  const after = await api('/kybernos-usage/summary?days=7')
  const day = after.body.daily[6].models
  check('a first sight is a baseline, the next one is a delta on today', day['deepseek/deepseek-chat'] !== undefined && day['deepseek/deepseek-chat'].cr === 600000 && day['deepseek/deepseek-chat'].u === 50000, day)
  check('the plan model is booked apart from the own keys (same ledger, its own key)', day['kybernos/kybernos-pro'] !== undefined && day['kybernos/kybernos-pro'].cr === 200000)
  check('what a session had used before the first report is kept undated', after.body.before['deepseek/deepseek-chat'] !== undefined && after.body.before['deepseek/deepseek-chat'].cr >= 900000)
  const refused = await val(`fetch('/kybernos-usage/observe', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }).then((r) => r.status)`)
  check('a body that is not JSON is refused', refused === 415, refused)
  const price = await api('/kybernos-models/modelsdev?route=deepseek&id=deepseek-chat')
  const priced = price.body !== null && price.body.ok === true && price.body.match !== null && price.body.match !== undefined
  console.log('  ○ models.dev price for deepseek/deepseek-chat: ' + (priced ? 'found' : 'not available here (offline or absent): the priced path is not exercised'))

  console.log('\n── 2. Settings › Usage ──')
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  check('Settings open', (await poll(() => val(`/Back to workspace/.test(document.body.innerText)`), 8000)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Usage'); if (!b) return false; b.click(); return true })()`)
  check('the Usage entry is in the Settings menu and opens', went === true)
  const pageUp = await poll(() => val(`document.querySelector('[data-kb="kybernos-usage-page"]') !== null`), 10000)
  check('the page mounts', pageUp === true)
  await sleep(1500)
  const text = await val(`document.querySelector('[data-kb="kybernos-usage-page"]').innerText`)
  check('the plan block says so when no account is signed in (and does not break)', /Connectez un compte|Sign in to a Kybernos account/.test(text), text.slice(0, 300))
  const rows = await val(`document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length`)
  check('the by-model list has the three seeded models', rows >= 3, rows)
  const listText = await val(`document.querySelector('[data-kb="kybernos-usage-list"]').innerText`)
  check('the plan model is shown as being on the plan, never priced', /via le plan|on the plan/.test(listText), listText)
  check('the local model is shown as free', /gratuit|free/i.test(listText), listText)
  check(priced ? 'the priced model shows an amount' : 'the model without a price says so', priced ? /\d[,.]\d\d\s*\$/.test(listText) : /prix inconnu|price unknown/.test(listText), listText)
  await shot('usage-page')

  await clickAct('period-30')
  await sleep(300)
  check('switching to 30 days redraws without a request error', (await val(`document.querySelector('[data-kb="kybernos-usage-page"]') !== null && document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length >= 3`)) === true)
  await clickAct('period-today')
  await sleep(300)
  check('today still shows the seeded day', (await val(`document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length >= 3`)) === true)
  await clickAct('tab-sessions')
  await sleep(300)
  const sessText = await val(`document.querySelector('[data-kb="kybernos-usage-list"]').innerText`)
  check('the by-session list names the sessions it saw', /Check A/.test(sessText) && /Check B/.test(sessText), sessText)

  console.log('\n── budget ──')
  await val(`(() => { const d = document.querySelector('[data-kb="kybernos-usage-budget"]'); if (d) d.open = true; return true })()`)
  await sleep(300)
  await val(`(() => { const i = document.getElementById('kbus-budget'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '12'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(200)
  await clickAct('save-budget')
  await sleep(600)
  const sum = await api('/kybernos-usage/summary?days=7')
  check('the budget is saved through the real route', sum.body.budget.usd === 12, sum.body.budget)
  const bad = await api('/kybernos-usage/budget', { usd: -5 })
  check('a negative budget is refused', bad.status === 400, bad)

  console.log('\n── 3. a narrow window ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
  await sleep(700)
  const overflow = await val(`(() => { const p = document.querySelector('[data-kb="kybernos-usage-page"]'); if (!p) return 'no page'; return p.scrollWidth - p.clientWidth })()`)
  check('the page does not overflow at 390 px', typeof overflow === 'number' && overflow <= 1, overflow)
  await shot('usage-page-narrow')
  await page.send('Emulation.clearDeviceMetricsOverride')

  console.log('\n── 4. the chip ──')
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (b) b.click(); return true })()`)
  await sleep(1500)
  const chip = await val(`document.querySelectorAll('[data-kb="kybernos-usage-pill"]').length`)
  check('with no counters yet the chip stays absent instead of showing an empty pill', chip === 0, chip)
  const errs = (page.errs || []).filter((e) => /kybernos-usage/.test(JSON.stringify(e)))
  check('no console error from the plugin', errs.length === 0, errs.slice(0, 3))
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed — ' + String(e && e.message ? e.message : e))
}
await live.close()
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
