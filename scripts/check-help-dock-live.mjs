#!/usr/bin/env node
// « How it works » docked in the margin, in a real GUI (audit V1-23).
//
//   node scripts/check-help-dock-live.mjs
//
// The card used to hang under its button and lie on the controls it explains. On a Settings page, in a window of 1400 px or more, with room beside the page's column, it is
// now docked in the margin: 28 px beyond the 720 px column, level with the button, 340 px wide, flat, nothing covered and nothing moving; a click on the page leaves it open
// (the point is to read it while using the page); Esc, ✕ and the button close it. Narrower than 1400 px, or on a page of the main views, it hangs from its button as before.
// Reads and presses only the button of the card (never a control of the page), so it also runs on :3080. Exit 0 / 1 / 3 (inconclusive: no Chrome, GUI down).
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 260))) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 15000) => (await page.evalJs(js, ms)).val
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code }) }
const size = (w) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
const card = () => ev(`(() => { const p = document.querySelector('[data-kb="help-panel"]'); if (!p) return null; const r = p.getBoundingClientRect(); const col = document.querySelector('[data-slot="settings.section"]'); const root = col && col.firstElementChild ? col.firstElementChild.getBoundingClientRect() : null; return JSON.stringify({ cls: p.className, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), colRight: root ? Math.round(root.right) : null, shadow: getComputedStyle(p).boxShadow, scrollW: document.querySelector('[class*="_options"]') ? document.querySelector('[class*="_options"]').scrollWidth - document.querySelector('[class*="_options"]').clientWidth : null }) })()`).then((j) => (j === null ? null : JSON.parse(j)))
const pill = () => ev(`(() => { const b = document.querySelector('[data-kb="help-button"]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`).then((j) => (j === null ? null : JSON.parse(j)))
const openCard = async () => { const at = await pill(); if (at === null) return false; await click(at.x, at.y); await sleep(700); return true }

try {
  await sleep(3500)
  check('Settings open', await openSettings(page, { tries: 4 }))
  await goToSettingsPage(page, 'Usage', { settleMs: 2000 })
  check('the Usage page carries the button', (await pill()) !== null)

  check('the card opens', await openCard())
  const wide = await card()
  check('at 1400 px the card is docked', wide !== null && /\bdock\b/.test(wide.cls), wide)
  check('...28 px beyond the page column, 340 px wide, level with the button, flat', wide !== null && wide.colRight !== null && Math.abs(wide.left - (wide.colRight + 28)) <= 1 && wide.w === 340 && wide.shadow === 'none', wide)
  check('...nothing is covered: the page controls are reachable at their place, and no horizontal scrollbar appeared', (await ev(`(() => { const c = document.querySelector('[data-kb="help-panel"]').getBoundingClientRect(); const els = Array.from(document.querySelectorAll('[class*="kbus-"] button, [class*="kbus-"] input')).filter((e) => { if (e.closest('[data-kb="help-panel"]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > c.left - 1 && r.left < c.right && r.bottom > c.top && r.top < c.bottom }); return els.length })()`)) === 0 && wide !== null && wide.scrollW === 0, wide)
  await click(500, 640); await sleep(400)
  check('a click on the page leaves a docked card open', (await card()) !== null)

  await size(1280); await sleep(900)
  const narrow = await card()
  check('narrowing the window to 1280 px hangs the card from its button again', narrow !== null && !/\bdock\b/.test(narrow.cls), narrow)
  await click(500, 700); await sleep(400)
  check('...and a click on the page closes a hanging card, as it always did', (await card()) === null)

  await size(1500); await sleep(900)
  await openCard()
  check('at 1500 px it is docked again', /\bdock\b/.test(((await card()) || { cls: '' }).cls))
  await key('Escape', 27); await sleep(400)
  check('Escape closes the card and leaves Settings open', (await card()) === null && (await ev(`!!document.querySelector('[role="dialog"]')`)) === true)
  await openCard()
  await ev(`document.querySelector('.kbhp-x').click()`); await sleep(300)
  check('the ✕ closes it', (await card()) === null)
  await openCard()
  const at = await pill(); await click(at.x, at.y); await sleep(400)
  check('the button closes it', (await card()) === null)

  // The main views have no Settings column: their card hangs from its button, as before.
  await size(1500)
  await key('Escape', 27); await sleep(500)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
