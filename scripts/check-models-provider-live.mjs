#!/usr/bin/env node
// Settings › AI Provider & Models, the Add provider form and the provider drawer, in a real GUI (audit A3-01, A3-07, A3-09).
//
//   source scripts/sandbox/env.sh && node scripts/check-models-provider-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// It CREATES then DELETES one custom provider (« audit-test ») in the sandbox's profile and leaves nothing else behind.
//
// What it proves:
//   - Custom API: « Create provider » is off until a model has an ID, and the form SAYS why (it said nothing before);
//   - the drawer's enable row reads as the state it is in (« Enabled », switch on) and the switch is named by the provider;
//   - Escape in the « Delete provider? » confirmation closes the confirmation only, the drawer stays.
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
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const click = async (sel) => {
  const p = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  if (typeof p !== 'string') return false
  const { x, y } = JSON.parse(p)
  await mouse(x, y)
  await sleep(300)
  return true
}
// React keeps the value of a controlled input: the native setter plus an input event is what a keystroke does.
const type = (sel, v) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => val(`(document.querySelector(${JSON.stringify(sel)}) || { innerText: '' }).innerText`)
const createState = () => val(`(() => { const b = document.querySelector('[data-kbm="prov-ok"]'); return b ? JSON.stringify({ disabled: b.disabled, title: b.getAttribute('title') || '' }) : null })()`)

// Delete the provider of this check through the page (a run that stopped half way, or an old client, can leave it behind).
const dropAuditProvider = async () => {
  if ((await q('[data-kbm="prov-card"][data-prov="audit-test"]')) === 0) return true
  if ((await q('[data-kbm="pv-drawer"]')) > 0) { await key('Escape', 'Escape', 27); await sleep(400) }
  if ((await click('[data-kbm="prov-card"][data-prov="audit-test"] [data-kbm="prov-more"]')) !== true || (await poll(() => q('[data-kbm="prov-delete"]'))) === null) return false
  if ((await click('[data-kbm="prov-delete"]')) !== true || (await poll(() => q('[data-kbm="prov-del-type"]'))) === null) return false
  await type('[data-kbm="prov-del-type"]', 'audit-test')
  await sleep(300)
  return (await click('[data-kbm="prov-del-ok"]')) === true && (await poll(() => val(`!document.querySelector('[data-kbm="prov-card"][data-prov="audit-test"]')`), 15000)) === true
}

try {
  await sleep(2500)
  check('Settings open', (await openSettings(page)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI Provider & Models'); if (!b) return false; b.click(); return true })()`)
  check('the AI Provider & Models entry is in the Settings menu', went === true)
  check('the provider list mounts', (await poll(() => q('[data-kbm="prov-add"]'))) !== null)
  await sleep(800)
  await dropAuditProvider()

  console.log('\n── A3-01 · Add provider › Custom API ──')
  check('Add provider opens the drawer', (await click('[data-kbm="prov-add"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  check('the Custom API tab opens', (await click('[data-kbm="prov-mode-perso"]')) === true && (await poll(() => q('#pv-slug'))) !== null)
  await type('#pv-slug', 'audit-test')
  await type('#pv-name', 'Audit test')
  await type('#pv-url', 'https://gateway.example/v1')
  await type('#pv-key', 'sk-test-not-a-real-key')
  await sleep(300)
  let st = JSON.parse(await createState())
  check('Create provider is off while no model is listed', st.disabled === true, st)
  const hint0 = await text('[data-kbm="pv-models-required"]')
  check('...and the Models block says why (not « No models will be shown »)', /Add at least one model/.test(hint0) && !/No models will be shown/.test(await text('[data-kbm="pv-models"]')), hint0)
  check('...the disabled button carries the same reason as its tooltip', /Add at least one model/.test(st.title), st.title)
  await shot('models-custom-no-model')
  check('Add model adds an empty row', (await click('[data-kbm="pv-model-add"]')) === true && (await q('[data-kbm="pv-model-row"]')) === 1)
  st = JSON.parse(await createState())
  check('with a row but no model ID Create is still off, and the reason is still on screen', st.disabled === true && /Add at least one model/.test(await text('[data-kbm="pv-models-required"]')), st)
  await type('[data-kbm="pv-model-row"] input', 'audit-model-1')
  await sleep(300)
  st = JSON.parse(await createState())
  check('a model ID enables Create, and the reason goes away', st.disabled === false && (await q('[data-kbm="pv-models-required"]')) === 0, st)
  await shot('models-custom-with-model')
  check('Create provider creates it', (await click('[data-kbm="prov-ok"]')) === true && (await poll(() => val(`!!document.querySelector('[data-kbm="prov-card"][data-prov="audit-test"]')`), 15000)) === true)

  console.log('\n── A3-07 · the drawer\'s enable row ──')
  check('the pencil of the provider opens its drawer', (await click('[data-kbm="prov-card"][data-prov="audit-test"] [data-kbm="prov-edit"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  await sleep(500)
  const row = JSON.parse(await val(`(() => { const z = document.querySelector('.kbpv-zone .kbpv-z'); const sw = z ? z.querySelector('[data-kbm="prov-switch"]') : null; return JSON.stringify({ label: z ? z.querySelector('b').innerText : null, on: sw ? sw.getAttribute('aria-checked') : null, aria: sw ? sw.getAttribute('aria-label') : null }) })()`))
  check('the row is labelled « Enabled » and its switch is on while the provider is enabled', row.label === 'Enabled' && row.on === 'true', row)
  check('the switch is named after the provider, not after the action (« Disable audit-test, switch, on » was wrong)', row.aria === 'audit-test enabled', row)
  await shot('models-drawer-enabled')

  console.log('\n── A3-09 · Escape in the delete confirmation ──')
  check('Delete… opens the confirmation', (await click('[data-kbm="pv-delete"]')) === true && (await poll(() => q('[data-kbm="prov-del-dialog"]'))) !== null)
  await key('Escape', 'Escape', 27)
  await sleep(500)
  check('one Escape closes the confirmation', (await q('[data-kbm="prov-del-dialog"]')) === 0)
  check('...and the drawer behind it stays open', (await q('[data-kbm="pv-drawer"]')) === 1)
  await key('Escape', 'Escape', 27)
  await sleep(500)
  check('a second Escape closes the drawer', (await q('[data-kbm="pv-drawer"]')) === 0)

  console.log('\n── clean up: delete the provider this check made ──')
  check('the provider of this check is deleted again (card menu › Delete… › its id typed)', (await dropAuditProvider()) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
