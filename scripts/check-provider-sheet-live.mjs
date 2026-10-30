#!/usr/bin/env node
// Settings › AI provider and models, the provider sheet, in a real GUI: a click on the card opens it, the key is checked on its own, every model is
// listed in the sheet (no popup, no « + N more »), a custom model is checked in the background, and Apply never waits for any of it.
//
//   source scripts/sandbox/env.sh && node scripts/check-provider-sheet-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// It starts a FAKE OpenAI-compatible provider on this machine's loopback (60 models; one good key; unknown models answer 404; a switch makes
// the list public), creates one custom provider « sheet-test » that points at it in the sandbox's profile, and deletes it again.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import http from 'node:http'
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

// ── the fake provider ──
const GOOD = 'sk-sheet-good-key-1234'
const WRONG = 'sk-sheet-wrong-key-9999'
const IDS = Array.from({ length: 60 }, (_, i) => 'fake-model-' + String(i + 1).padStart(2, '0'))
const KNOWN = new Set(IDS.concat(['my-real-model']))
const mode = { public: false }
const fake = http.createServer((req, res) => {
  const good = (req.headers.authorization || '') === 'Bearer ' + GOOD
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/__mode') { try { mode.public = JSON.parse(raw).public === true } catch (e) { /* keep */ } json(200, { ok: true }); return }
    if (req.method === 'GET' && req.url === '/v1/models') { if (good || mode.public) json(200, { object: 'list', data: IDS.map((id) => ({ id, object: 'model' })) }); else json(401, { error: { message: 'bad key' } }); return }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (!good) { json(401, { error: { message: 'bad key' } }); return }
      let model = ''
      try { model = JSON.parse(raw).model } catch (e) { /* no body */ }
      if (KNOWN.has(model)) json(200, { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'length' }] })
      else json(404, { error: { message: 'model not found' } })
      return
    }
    json(404, { error: { message: 'no route' } })
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const fakeUrl = 'http://127.0.0.1:' + fake.address().port + '/v1'
const setPublic = (on) => fetch('http://127.0.0.1:' + fake.address().port + '/__mode', { method: 'POST', body: JSON.stringify({ public: on }) })

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); fake.close(); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const mouse = async (x, y, type = ['mouseMoved', 'mousePressed', 'mouseReleased']) => { for (const t of type) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const center = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
const click = async (sel) => {
  const p = await center(sel)
  if (typeof p !== 'string') return false
  const { x, y } = JSON.parse(p)
  await mouse(x, y)
  await sleep(300)
  return true
}
const hover = async (sel) => { const p = await center(sel); if (typeof p !== 'string') return false; const { x, y } = JSON.parse(p); await mouse(x, y, ['mouseMoved']); await sleep(250); return true }
// React keeps the value of a controlled input: the native setter plus an input event is what a keystroke does.
const type = (sel, v) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => val(`(document.querySelector(${JSON.stringify(sel)}) || { innerText: '' }).innerText`)
const attr = (sel, a) => val(`(document.querySelector(${JSON.stringify(sel)}) || { getAttribute: () => null }).getAttribute(${JSON.stringify(a)})`)
const ckState = () => attr('[data-kbm="pv-ck"]', 'data-kbm-state')
const waitCk = (st, ms = 12000) => poll(async () => (await ckState()) === st, ms)
const applyText = () => text('[data-kbm="pv-apply"]')
const CARD = '[data-kbm="prov-card"][data-prov="sheet-test"]'

const dropTestProvider = async () => {
  if ((await q(CARD)) === 0) return true
  if ((await q('[data-kbm="pv-drawer"]')) > 0) { await key('Escape', 'Escape', 27); await sleep(400) }
  if ((await click(CARD + ' [data-kbm="prov-more"]')) !== true || (await poll(() => q('[data-kbm="prov-delete"]'))) === null) return false
  if ((await click('[data-kbm="prov-delete"]')) !== true || (await poll(() => q('[data-kbm="prov-del-type"]'))) === null) return false
  await type('[data-kbm="prov-del-type"]', 'sheet-test')
  await sleep(300)
  return (await click('[data-kbm="prov-del-ok"]')) === true && (await poll(() => val(`!document.querySelector('${CARD}')`), 15000)) === true
}

try {
  await sleep(2500)
  check('Settings open', (await openSettings(page)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI provider and models'); if (!b) return false; b.click(); return true })()`)
  check('the AI provider and models entry is in the Settings menu', went === true)
  check('the provider list mounts', (await poll(() => q('[data-kbm="prov-add"]'))) !== null)
  await sleep(800)
  await dropTestProvider()

  console.log('\n── set up: a custom provider that points at the fake one, with a good key and one model ──')
  check('Add provider opens the drawer', (await click('[data-kbm="prov-add"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  check('the Custom API tab opens', (await click('[data-kbm="prov-mode-perso"]')) === true && (await poll(() => q('#pv-slug'))) !== null)
  await type('#pv-slug', 'sheet-test')
  await type('#pv-name', 'Sheet test')
  await type('#pv-url', fakeUrl)
  await type('#pv-key', GOOD)
  await click('[data-kbm="pv-model-add"]')
  await type('[data-kbm="pv-model-row"] input', 'fake-model-01')
  await sleep(300)
  check('Create provider creates it', (await click('[data-kbm="prov-ok"]')) === true && (await poll(() => val(`!!document.querySelector('${CARD}')`), 15000)) === true)
  await sleep(600)

  console.log('\n── the card: counts are icons, the words come on hover, a click opens the sheet ──')
  check('the model count and the key count are icons (the number is the only text)', (await text(CARD + ' [data-kbm="prov-count"]')).trim() === '1' && (await text(CARD + ' [data-kbm="prov-keys"]')).trim() === '1')
  check('...they carry their words for assistive tech', /1 model/.test((await attr(CARD + ' [data-kbm="prov-count"]', 'aria-label')) || '') && /1 API key/.test((await attr(CARD + ' [data-kbm="prov-keys"]', 'aria-label')) || ''))
  await hover(CARD + ' [data-kbm="prov-count"]')
  const tip = await val(`getComputedStyle(document.querySelector('${CARD} [data-kbm="prov-count"]'), '::after').content`)
  check('...and the words are drawn on hover', /1 model/.test(String(tip)), tip)
  await shot('sheet-0-card-tooltip')
  check('there is no pencil on the card any more', (await q('[data-kbm="prov-edit"]')) === 0)
  check('a click on the card opens the provider\'s sheet, not the Models tab', (await click(CARD + ' [data-kbm="prov-voir"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null && (await q('[data-kbm="list"]')) === 0)

  console.log('\n── the sheet: the stored key is checked on opening, every model is listed ──')
  check('the key is checked on its own and works', (await waitCk('ok')) !== null, await ckState())
  const found = await text('[data-kbm="pv-ck"]')
  check('...the line says how many models were found', /60 models found/.test(found), found)
  check('every model the provider serves is in the sheet (no cap, no « + N more »)', (await q('[data-kbm="pv-row"]')) === 60 && !/more models|Search to find/.test(await text('[data-kbm="pv-drawer"]')))
  check('...in the sheet itself: there is no popup', (await q('[data-kbm="fetch-dialog"]')) === 0 && (await q('[data-kbm="fetch-open"]')) === 0)
  check('...the model the route serves is ticked, the rest are not', /1 of 60 selected/.test(await text('[data-kbm="pv-sel-count"]')))
  check('...the list says where it came from', (await attr('[data-kbm="fetch-source"]', 'data-kbm-live')) === '1')
  check('Apply says plain Apply while nothing is wrong', (await applyText()).trim() === 'Apply')
  await shot('sheet-1-open')

  console.log('\n── pasting a key: it is checked once the typing stops ──')
  await type('#pv-key', WRONG)
  check('a refused key says so, with the provider\'s status', (await waitCk('refused')) !== null && /401/.test(await text('[data-kbm="pv-ck"]')), await text('[data-kbm="pv-ck"]'))
  check('...the person can still apply: the button says « anyway »', (await applyText()).trim() === 'Apply anyway' && (await val(`!document.querySelector('[data-kbm="pv-apply"]').disabled`)) === true)
  check('...the models the route serves stay on screen', (await q('[data-kbm="pv-row"]')) >= 1)
  await shot('sheet-2-refused')
  await type('#pv-key', GOOD)
  check('the good key is connected, and the whole list is back', (await waitCk('ok')) !== null && (await poll(async () => (await q('[data-kbm="pv-row"]')) === 60, 8000)) !== null)
  check('...Apply is plain again', (await applyText()).trim() === 'Apply')
  await type('#pv-key', '')
  check('emptying the field goes back to the stored key', (await waitCk('ok')) !== null && (await q('[data-kbm="pv-row"]')) === 60)

  console.log('\n── a provider that lists its models to anyone does not prove the key ──')
  await setPublic(true)
  check('Check again says « listed », not « works »', (await click('[data-kbm="pv-recheck"]')) === true && (await waitCk('listed')) !== null && /without a key/.test(await text('[data-kbm="pv-ck"]')), await text('[data-kbm="pv-ck"]'))
  await setPublic(false)
  check('...and is « ok » again once the list needs the key', (await click('[data-kbm="pv-recheck"]')) === true && (await waitCk('ok')) !== null)

  console.log('\n── the models: search, All / None, and ticks ──')
  check('All ticks every model of the list', (await click('[data-kbm="pv-sel-all"]')) === true && /60 of 60 selected/.test(await text('[data-kbm="pv-sel-count"]')))
  check('None clears them', (await click('[data-kbm="pv-sel-none"]')) === true && /0 of 60 selected/.test(await text('[data-kbm="pv-sel-count"]')))
  await type('[data-kbm="pv-search"]', '-07')
  check('the search narrows the list', (await poll(async () => (await q('[data-kbm="pv-row"]')) === 1, 4000)) !== null)
  check('All acts on what the search shows', (await click('[data-kbm="pv-sel-all"]')) === true && /1 of 60 selected/.test(await text('[data-kbm="pv-sel-count"]')))
  await type('[data-kbm="pv-search"]', '')
  await sleep(300)
  check('two more ticks by hand', (await click('[data-kbm="pv-row"][data-kbm-id="fake-model-02"] input')) === true && (await click('[data-kbm="pv-row"][data-kbm-id="fake-model-03"] input')) === true && /3 of 60 selected/.test(await text('[data-kbm="pv-sel-count"]')))
  await shot('sheet-3-ticks')

  console.log('\n── a custom model: checked in the background, never blocking ──')
  await type('[data-kbm="pv-new-id"]', 'ghost-model')
  check('Add puts it under « Your models » at once', (await click('[data-kbm="pv-new-add"]')) === true && (await q('[data-kbm="pv-own-row"][data-kbm-id="ghost-model"]')) === 1)
  check('...Apply is not held while it is checked', (await val(`!document.querySelector('[data-kbm="pv-apply"]').disabled`)) === true)
  check('a model the provider does not know ends up marked as not answering', (await poll(async () => (await attr('[data-kbm="pv-own-row"][data-kbm-id="ghost-model"] [data-kbm="pv-own-state"]', 'data-kbm-state')) === 'fail', 25000)) !== null)
  check('...and Apply says « anyway »', (await applyText()).trim() === 'Apply anyway')
  await type('[data-kbm="pv-new-id"]', 'my-real-model')
  await click('[data-kbm="pv-new-add"]')
  check('a model that answers ends up marked as answering', (await poll(async () => (await attr('[data-kbm="pv-own-row"][data-kbm-id="my-real-model"] [data-kbm="pv-own-state"]', 'data-kbm-state')) === 'ok', 25000)) !== null)
  await shot('sheet-4-custom')
  await type('[data-kbm="pv-new-id"]', 'my-real-model')
  await click('[data-kbm="pv-new-add"]')
  check('adding the same model twice says so', /already in the list/.test(await text('[data-kbm="pv-new-dup"]')))
  await type('[data-kbm="pv-new-id"]', 'fake-model-09')
  await click('[data-kbm="pv-new-add"]')
  check('a model that is already in the provider\'s list is ticked instead of added twice', (await q('[data-kbm="pv-own-row"][data-kbm-id="fake-model-09"]')) === 0 && /6 of 62 selected/.test(await text('[data-kbm="pv-sel-count"]')), await text('[data-kbm="pv-sel-count"]'))
  check('removing the unknown model brings Apply back to plain', (await click('[data-kbm="pv-own-row"][data-kbm-id="ghost-model"] [data-kbm="pv-own-del"]')) === true && (await applyText()).trim() === 'Apply')

  console.log('\n── Apply, then open the sheet again ──')
  check('Apply writes and closes the sheet', (await click('[data-kbm="pv-apply"]')) === true && (await poll(() => val(`!document.querySelector('[data-kbm="pv-drawer"]')`), 15000)) === true)
  await sleep(800)
  check('the card counts what was saved (4 ticked models + the custom one that answers)', (await text(CARD + ' [data-kbm="prov-count"]')).trim() === '5', await text(CARD + ' [data-kbm="prov-count"]'))
  check('a click on the card opens it again', (await click(CARD + ' [data-kbm="prov-voir"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  check('the key is checked again on opening', (await waitCk('ok')) !== null)
  check('the saved custom model is listed under « Your models »', (await q('[data-kbm="pv-own-row"][data-kbm-id="my-real-model"]')) === 1)
  check('the ticks were saved (07, 02, 03 and 09 are ticked among the 60, 01 is not)', (await val(`['fake-model-07','fake-model-02','fake-model-03','fake-model-09'].every((id) => { const r = document.querySelector('[data-kbm="pv-row"][data-kbm-id="' + id + '"] input'); return r && r.checked }) && !document.querySelector('[data-kbm="pv-row"][data-kbm-id="fake-model-01"] input').checked`)) === true)
  check('Escape closes the sheet', (await key('Escape', 'Escape', 27), await sleep(500), (await q('[data-kbm="pv-drawer"]')) === 0))

  console.log('\n── narrow screen: the sheet is opened AT 400 px (Settings changes layout there) ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI provider and models'); if (b) b.click(); return true })()`)
  check('the provider list mounts at 400 px', (await poll(() => q(CARD + ' [data-kbm="prov-voir"]'), 8000)) !== null)
  check('a tap on the card opens the sheet', (await click(CARD + ' [data-kbm="prov-voir"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  await waitCk('ok')
  await sleep(400)
  const over = JSON.parse(await val(`(() => { const b = document.querySelector('.kbpv-body'); const d = document.querySelector('.kbpv-drawer'); const r = d ? d.getBoundingClientRect() : null; return JSON.stringify({ shown: !!b && !!d, body: b ? b.scrollWidth - b.clientWidth : null, drawer: d ? d.scrollWidth - d.clientWidth : null, left: r ? Math.round(r.left) : null, width: r ? Math.round(r.width) : null }) })()`))
  check('the sheet is on screen and has no horizontal scroll at 400 px', over.shown === true && over.body <= 0 && over.drawer <= 0 && over.left >= 0 && over.width <= 400, over)
  await shot('sheet-5-narrow')
  await key('Escape', 'Escape', 27)
  await sleep(400)
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(600)

  console.log('\n── clean up ──')
  check('the provider of this check is deleted again', (await dropTestProvider()) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
  fake.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
