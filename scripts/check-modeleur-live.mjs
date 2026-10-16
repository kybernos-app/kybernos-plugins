#!/usr/bin/env node
// The Modeleur's Text annotation tool in a real GUI (audit A4-07).
//
//   source scripts/sandbox/env.sh && node scripts/check-modeleur-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// It plays the panel's own demo (« Maison »), draws one text annotation with real mouse and keyboard events, and clears
// the annotations again. Nothing else is read or written beyond the sandbox's own Modeleur state.
//
// What it proves: pressing the canvas with the Text tool opens the field and the field KEEPS the focus (it was removed again
// within 100 ms by the focus move that ends the press), typing goes into it, and Enter files the text as an annotation.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

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

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const press = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const centre = async (js) => { const p = await val(`(() => { const e = (${js}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`); return typeof p === 'string' ? JSON.parse(p) : null }
const click = async (js) => { const c = await centre(js); if (c === null) return false; await press(c.x, c.y); await sleep(300); return true }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const dismissGetStarted = () => val(`(() => { const b = Array.from(document.querySelectorAll('button[aria-label="Close"]')).find((x) => /Get started/.test(((x.closest('[class*="_root_"]') || x.parentElement || {}).innerText) || '')); if (!b) return false; b.click(); return true })()`)
const count = () => val(`(() => { const n = document.querySelector('.kbmo .kbm-note'); const m = n ? /(\\d+) trait\\(s\\)/.exec(n.innerText) : null; return m ? Number(m[1]) : 0 })()`)

try {
  await sleep(2500)
  await dismissGetStarted()
  await sleep(500)
  await val(`(() => { const b = document.querySelector('button[aria-label="Open right sidebar"]'); if (b) b.click() })()`)
  await sleep(1200)
  const openTab = () => val(`(() => { const all = Array.from(document.querySelectorAll('button')); const i = all.findIndex((b) => b.getAttribute('aria-label') === 'Collapse right sidebar'); const b = all.slice(i).find((x) => x.innerText.trim() === 'Modeleur'); if (!b) return false; b.click(); return true })()`)
  if ((await q('.kbmo')) === 0 && (await openTab()) !== true) {
    // Another panel is already open in the sandbox's right pane (it keeps its layout between runs): a new tab shows the start list.
    await val(`(() => { const b = document.querySelector('button[aria-label="New tab"]'); if (b) b.click() })()`)
    await sleep(1000)
    await openTab()
  }
  check('the Modeleur panel is open', (await poll(() => q('.kbmo'))) !== null)
  if ((await q('.kbmo .kbm-tools')) === 0) await click(`Array.from(document.querySelectorAll('.kbmo .kbm-chip')).find((b) => /Maison/.test(b.innerText))`)
  check('the demo model is there (the drawing tools appear)', (await poll(() => q('.kbmo .kbm-tools'), 20000)) !== null)
  await sleep(3000)

  console.log('\n── A4-07 · the Text tool ──')
  const before = await count()
  check('the pen opens its tools', (await click(`Array.from(document.querySelectorAll('.kbmo .kbm-tool')).find((b) => /Dessiner par-dessus/.test(b.title))`)) === true && (await q('.kbmo .kbm-tool[title="Texte"]')) === 1)
  check('the A (Texte) tool is chosen', (await click(`document.querySelector('.kbmo .kbm-tool[title="Texte"]')`)) === true)
  // Pressing the model with the real mouse is what moves the focus off the new field.
  check('a click on the model opens the text field', (await click(`document.querySelector('.kbmo canvas')`)) === true && (await q('.kbmo input.kbm-saisie')) === 1)
  await sleep(700)
  check('the field is still there 700 ms later (it was removed within 100 ms)', (await q('.kbmo input.kbm-saisie')) === 1)
  check('...and it has the focus', (await val(`document.activeElement && document.activeElement.classList.contains('kbm-saisie')`)) === true)
  await shot('modeleur-text-field')
  await page.send('Input.insertText', { text: 'toit' })
  await sleep(200)
  await key('Enter', 'Enter', 13)
  await sleep(700)
  check('Enter closes the field', (await q('.kbmo input.kbm-saisie')) === 0)
  check('...and the text is filed as an annotation', (await count()) === before + 1, { before, after: await count() })
  await shot('modeleur-text-filed')
  // Leave the sandbox as it was: « Effacer tous mes traits ».
  await click(`document.querySelector('.kbmo .kbm-tool[title="Effacer tous mes traits"]')`)
  check('the annotations are cleared again', (await poll(async () => (await count()) === 0, 5000)) !== null)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
