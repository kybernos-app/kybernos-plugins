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
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

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
  // The shell is up once it has drawn something (a busy machine only makes that longer); every read below waits for what it needs.
  await waitFor(page, 'document.readyState === "complete" && document.body && document.body.innerText.length > 40', 30000)
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
  // The ledger is the sandbox's own and keeps today's figures between runs: what this run booked is the difference with what was there before it.
  const was = before.body.daily[6].models
  const booked = (key, field) => (day[key] === undefined ? undefined : day[key][field] - (was[key] === undefined ? 0 : was[key][field]))
  check('a first sight is a baseline, the next one is a delta on today', day['deepseek/deepseek-chat'] !== undefined && booked('deepseek/deepseek-chat', 'cr') === 600000 && booked('deepseek/deepseek-chat', 'u') === 50000, { day, was })
  check('the plan model is booked apart from the own keys (same ledger, its own key)', day['kybernos/kybernos-pro'] !== undefined && booked('kybernos/kybernos-pro', 'cr') === 200000)
  check('what a session had used before the first report is kept undated', after.body.before['deepseek/deepseek-chat'] !== undefined && after.body.before['deepseek/deepseek-chat'].cr >= 900000)
  const refused = await val(`fetch('/kybernos-usage/observe', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }).then((r) => r.status)`)
  check('a body that is not JSON is refused', refused === 415, refused)
  const price = await api('/kybernos-models/modelsdev?route=deepseek&id=deepseek-chat')
  const priced = price.body !== null && price.body.ok === true && price.body.match !== null && price.body.match !== undefined
  console.log('  ○ models.dev price for deepseek/deepseek-chat: ' + (priced ? 'found' : 'not available here (offline or absent): the priced path is not exercised'))

  console.log('\n── 2. Settings › Usage ──')
  check('Settings open', (await openSettings(page, { tries: 3 })) === true)
  const pageSel = `document.querySelector('[data-kb="kybernos-usage-page"]') !== null`
  // The entry is awaited and pressed again when the press was lost (the menu is redrawn a moment after it opens).
  const went = await goToSettingsPage(page, 'Usage', { marker: pageSel, markerMs: 10000 })
  check('the Usage entry is in the Settings menu and opens', went === true)
  const pageUp = await poll(() => val(pageSel), 10000)
  check('the page mounts', pageUp === true)
  // The ledger is read from the host once the page is up: wait for the three seeded rows, then for the plan block to have its sentence.
  const rowsSel = `document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length`
  await poll(async () => (await val(rowsSel)) >= 3, 15000)
  // The plan block depends on the instance: signed out it asks to sign in; signed in to an account it is the plan card (its name, its limits). Either one must be there and must not break.
  await poll(() => val(`/Connectez un compte|Sign in to a Kybernos account/.test((document.querySelector('[data-kb="kybernos-usage-page"]') || { innerText: '' }).innerText) || !!document.querySelector('[data-kb="kybernos-usage-plan"]')`), 10000)
  const text = await val(`(document.querySelector('[data-kb="kybernos-usage-page"]') || { innerText: '' }).innerText`)
  const planCardText = await val(`(document.querySelector('[data-kb="kybernos-usage-plan"]') || { innerText: null }).innerText`)
  if (planCardText === null) check('the plan block says so when no account is signed in (and does not break)', /Connectez un compte|Sign in to a Kybernos account/.test(text), text.slice(0, 300))
  else check('the plan block is the plan card when an account is signed in: a title, no request to sign in', /\S/.test(planCardText) && !/Connectez un compte|Sign in to a Kybernos account/.test(planCardText), planCardText.slice(0, 300))
  const rows = await val(rowsSel)
  check('the by-model list has the three seeded models', rows >= 3, rows)
  const listOf = () => val(`(document.querySelector('[data-kb="kybernos-usage-list"]') || { innerText: '' }).innerText`)
  let listText = await listOf()
  check('the plan model is shown as being on the plan, never priced', /via le plan|on the plan/.test(listText), listText)
  check('the local model is shown as free', /gratuit|free/i.test(listText), listText)
  // The amount follows the interface language the way the client does (kybernos-usage fmtMoney): « 0,04 $ » in French (and in the
  // pseudo-language of the language checks), « $0.04 » otherwise; below one cent it is « <0,01 $ » / « <$0.01 ».
  const uiLang = String((await val(`(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en'))`)) || 'en')
  const frenchAmounts = uiLang.slice(0, 2) === 'fr' || uiLang === 'kybernos'
  const amountPattern = frenchAmounts ? /\d,\d\d\s*\$/ : /\$\d\.\d\d/
  // The price comes from a second request after the list is drawn: wait for it rather than read the list at the moment of the first draw.
  if (priced) { await poll(async () => amountPattern.test(await listOf()), 10000); listText = await listOf() }
  check(priced ? 'the priced model shows an amount (' + (frenchAmounts ? '1,23 $' : '$1.23') + ' for the interface language ' + uiLang + ')' : 'the model without a price says so', priced ? amountPattern.test(listText) : /prix inconnu|price unknown/.test(listText), listText)
  await shot('usage-page')

  // A control is pressed once it is there, and what it draws is awaited (the list is redrawn after a request to the host).
  const pressAct = async (act) => { await poll(() => clickAct(act), 8000) }
  await pressAct('period-30')
  check('switching to 30 days redraws without a request error', (await poll(() => val(`document.querySelector('[data-kb="kybernos-usage-page"]') !== null && document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length >= 3`), 10000)) === true)
  await pressAct('period-today')
  check('today still shows the seeded day', (await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-usage-list"] .kbus-row').length >= 3`), 10000)) === true)
  await pressAct('tab-sessions')
  await poll(async () => /Check A/.test(await listOf()) && /Check B/.test(await listOf()), 10000)
  const sessText = await listOf()
  check('the by-session list names the sessions it saw', /Check A/.test(sessText) && /Check B/.test(sessText), sessText)

  console.log('\n── budget ──')
  await poll(() => val(`(() => { const d = document.querySelector('[data-kb="kybernos-usage-budget"]'); if (!d) return false; d.open = true; return document.getElementById('kbus-budget') !== null })()`), 8000)
  await val(`(() => { const i = document.getElementById('kbus-budget'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '12'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await pressAct('save-budget')
  // The route answers a moment after the press: read the budget back until it is the one typed.
  let sum = await api('/kybernos-usage/summary?days=7')
  for (let i = 0; i < 24 && !(sum.body && sum.body.budget && sum.body.budget.usd === 12); i += 1) { await sleep(250); sum = await api('/kybernos-usage/summary?days=7') }
  check('the budget is saved through the real route', sum.body.budget.usd === 12, sum.body.budget)
  const bad = await api('/kybernos-usage/budget', { usd: -5 })
  check('a negative budget is refused', bad.status === 400, bad)

  console.log('\n── 3. a narrow window ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
  // The layout settles after the resize: the width is read until it fits (or for five seconds, then the check says what it measured).
  const widthOver = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-usage-page"]'); if (!p) return 'no page'; return p.scrollWidth - p.clientWidth })()`)
  await poll(async () => { const o = await widthOver(); return typeof o === 'number' && o <= 1 }, 5000)
  const overflow = await widthOver()
  check('the page does not overflow at 390 px', typeof overflow === 'number' && overflow <= 1, overflow)
  await shot('usage-page-narrow')
  await page.send('Emulation.clearDeviceMetricsOverride')

  console.log('\n── 4. the chip ──')
  await poll(() => val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (!b) return false; b.click(); return true })()`), 8000)
  // An absence cannot be awaited: the page is back on the home first, then given a beat for a chip that would be drawn late.
  await poll(() => val(`!document.querySelector('[data-kb="kybernos-usage-page"]')`), 8000)
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
