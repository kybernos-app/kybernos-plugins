#!/usr/bin/env node
// The search field of the Creations toolbar, in a real GUI (audit A4-27).
//
//   source scripts/sandbox/env.sh && node scripts/check-creations-search-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// Read-only: it opens Creations, presses the magnifier and types.
//
// What it proves, at 1400 px and at 700 px:
//   - pressing the magnifier focuses the field, so what is typed next is in it and filters the list;
//   - the toolbar does not wrap onto a second line when the field opens (the page below it did not move: « Customize » went
//     from y=118 to y=130), and nothing runs out of the window.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'

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

for (const width of [1400, 700]) {
  console.log('\n── ' + width + ' px ──')
  const live = await openLivePage({ width, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const { page } = live
  const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
  const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
  const box = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]) })()`).then((v) => (typeof v === 'string' ? JSON.parse(v) : null))
  try {
    await sleep(2500)
    await val(`(() => { const b = Array.from(document.querySelectorAll('button[aria-label="Close"]')).find((x) => /Get started/.test(((x.closest('[class*="_root_"]') || x.parentElement || {}).innerText) || '')); if (b) b.click() })()`)
    await sleep(500)
    // At 700 px the sidebar is a drawer: the Creations entry may need the menu button first.
    if ((await clickText(page, 'Creations')) !== true) { await val(`(() => { const b = document.querySelector('button[aria-label*="sidebar" i]'); if (b) b.click() })()`); await sleep(600); await clickText(page, 'Creations') }
    check('the Creations page shows its toolbar', (await poll(() => val(`!!document.querySelector('[data-kb="toggle-search"]')`), 20000)) !== null)
    await sleep(1200)
    const before = { head: await box('.kb6-headrow'), toolbar: await box('[data-kb="toolbar"]') }
    const c = await val(`(() => { const e = document.querySelector('[data-kb="toggle-search"]'); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
    const { x, y } = JSON.parse(c)
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
    await sleep(600)
    check('pressing the magnifier focuses the field', (await val(`!!document.activeElement && document.activeElement.type === 'search'`)) === true)
    await page.send('Input.insertText', { text: 'quiz' })
    await sleep(500)
    check('what is typed next is in the field', (await val(`(document.querySelector('.kb6-tb-search input') || {}).value`)) === 'quiz')
    const after = { head: await box('.kb6-headrow'), toolbar: await box('[data-kb="toolbar"]'), tools: await box('.kb6-tb-tools'), search: await box('.kb6-tb-search') }
    check('the header does not grow when the field opens (nothing below it moves)', before.head !== null && after.head !== null && after.head[3] === before.head[3], { before: before.head, after: after.head })
    check('the toolbar stays on one line', before.toolbar !== null && after.toolbar !== null && after.toolbar[3] - after.toolbar[1] === before.toolbar[3] - before.toolbar[1], { before: before.toolbar, after: after.toolbar })
    check('nothing runs out of the window', (await val(`document.scrollingElement.scrollWidth <= window.innerWidth + 1`)) === true && after.tools !== null && after.tools[2] <= width, after)
    if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, 'creations-search-' + width + '.png')) } catch (e) { /* no screenshot */ } }
  } catch (e) {
    fail += 1
    console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
  } finally {
    await live.close()
  }
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
