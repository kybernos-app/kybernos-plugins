#!/usr/bin/env node
// Settings › Free LLMs in a real GUI, with the free tier LOCKED (audit A3-14).
//
//   source scripts/sandbox/env.sh && node scripts/check-free-llms-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// Nothing leaves the machine: the page's two host calls (/free-llms/status and /free-llms/health) are answered by this script
// through the browser's request interception, as OpenCode Zen answered on 2026-10-16 (13 free models listed, then
// 403 free_tier_locked). It writes nothing: Connect is only checked to be OFF.
//
// What it proves: the page asks for the tier on open (the cached form), says in a sentence that the tier is unavailable,
// draws no green dot, keeps « Connect to DSH » off even after the retention notice is acknowledged, and « Probe a model »
// answers in words (not « Gate refused: free_tier_locked »). Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
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
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const click = async (sel) => {
  const p = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  if (typeof p !== 'string') return false
  const { x, y } = JSON.parse(p)
  await mouse(x, y)
  await sleep(400)
  return true
}
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)

// The host's answers, as of 2026-10-16.
const MODELS = Array.from({ length: 13 }, (_, i) => 'free-model-' + (i + 1))
const asked = []
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*free-llms/*', requestStage: 'Request' }] })
page.on('Fetch.requestPaused', async (p) => {
  const url = new URL(p.request.url)
  let body = null
  if (url.pathname === '/free-llms/status') body = { ok: true, models: MODELS, catalogOk: true, state: { wired: false, acknowledged: false, autoEnabled: false } }
  else if (url.pathname === '/free-llms/health') { asked.push(url.search); body = { ok: false, model: MODELS[0], code: 'free_tier_locked', status: 403 } }
  try {
    if (body === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
    else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
  } catch (e) { /* the page moved on */ }
})

try {
  await sleep(2500)
  check('Settings open', (await openSettings(page)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Free LLMs'); if (!b) return false; b.click(); return true })()`)
  check('the Free LLMs entry is in the Settings menu', went === true)
  check('the page mounts and lists the 13 models', (await poll(() => q('[data-kfl="panneau"] .kfl-mod').then((n) => n === 13))) !== null)
  await sleep(1200)
  check('on open it asks the host for the tier (the cached form)', asked.includes('?cached=1'), asked)
  const text = await val(`document.querySelector('[data-kfl="panneau"]').innerText`)
  check('it says in a sentence that the free tier is unavailable', /The free tier is unavailable right now/.test(text), text.slice(0, 400))
  check('...no model is drawn with a green dot', (await q('[data-kfl="panneau"] .kfl-mod .kbm-dot[data-state="done"]')) === 0 && (await q('[data-kfl="panneau"] .kfl-mod .kbm-dot[data-state="error"]')) === 13)
  await shot('free-llms-locked')
  check('the retention notice can still be ticked', (await click('[data-kfl="panneau"] .kfl-accuse input')) === true)
  check('Connect to DSH stays off, with the reason as its tooltip', await val(`(() => { const b = document.querySelector('[data-kfl="connecter"]'); return !!b && b.disabled === true && /locked it/.test(b.title) })()`) === true)
  const probeClicked = await val(`(() => { const b = Array.from(document.querySelectorAll('[data-kfl="panneau"] button')).find((x) => /Probe a model/.test(x.innerText)); if (!b) return false; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  check('« Probe a model » is there', typeof probeClicked === 'string')
  if (typeof probeClicked === 'string') { const { x, y } = JSON.parse(probeClicked); await mouse(x, y); await sleep(900) }
  check('the probe asks for a fresh answer (no cached form)', asked.includes(''), asked)
  const after = await val(`document.querySelector('[data-kfl="panneau"]').innerText`)
  check('its result is a sentence, not « Gate refused: free_tier_locked »', !/Gate refused|free_tier_locked/.test(after) && /The free tier is unavailable right now/.test(after), after.slice(-300))
  await shot('free-llms-probed')
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
