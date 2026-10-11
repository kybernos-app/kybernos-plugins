#!/usr/bin/env node
// Checks the phone layout against the REAL GUI: a 390 px phone is emulated in a headless Chrome signed in to the DSH
// at KB_HOST (default 127.0.0.1:3080), then a desktop-width viewport proves nothing changed above 700 px.
//
//   node scripts/check-mobile-live.mjs [--shots <dir>]
//
// It only emulates a viewport and taps DSH's own sidebar toggle: nothing is written. Exit code: 0 all green, 1 a check
// failed, 3 inconclusive (GUI down, or the bundle is not loaded in that DSH).
import { mkdirSync } from 'node:fs'
import { openLivePage, openSettings } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 15000); return r.err ? null : r.val }
const tap = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const center = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
const snapshot = () => ev(`(() => {
  const f = document.querySelector('[data-slot="root"] > div')
  const side = document.querySelector('[data-slot="sidebar"]')
  const col = side ? side.parentElement.getBoundingClientRect() : null
  const menu = document.querySelector('[data-kb="mobile-menu"]')
  return JSON.stringify({
    frame: !!f, collapsed: f ? f.hasAttribute('data-sidebar-collapsed') : null, cols: f ? getComputedStyle(f).gridTemplateColumns : null,
    sheet: !!document.getElementById('kbmob-sheet'), menu: menu ? getComputedStyle(menu).display : null,
    drawerLeft: col ? Math.round(col.left) : null, drawerRight: col ? Math.round(col.right) : null, scrollW: document.documentElement.scrollWidth, vw: innerWidth
  })
})()`).then((j) => (j === null ? null : JSON.parse(j)))

try {
  await sleep(2500)
  const desktop = await snapshot()
  if (desktop === null || desktop.frame !== true) { console.error('○ inconclusive: the DSH shell is not on the page'); process.exit(3) }
  if (desktop.sheet !== true) { console.error('○ inconclusive: the kybernos-mobile stylesheet is not in the page (bundle not loaded in this DSH, or the host not restarted)'); process.exit(3) }

  console.log('desktop width: nothing changes')
  check('the menu button exists but is not displayed', desktop.menu === 'none', desktop)
  check('the sidebar is not turned into a drawer (its column is in the grid)', typeof desktop.cols === 'string' && desktop.cols.split(' ').length >= 2, desktop.cols)

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await page.send('Page.reload', {})
  await sleep(5000)

  console.log('phone, 390 px')
  const home = await snapshot()
  if (shotsDir !== null) await page.shot(shotsDir + '/phone-home.png')
  check('the page is exactly the screen wide (no sideways scroll)', home.scrollW === home.vw, home)
  check('the stylesheet came with the page (index-inject)', home.sheet === true)
  check('the frame is one column', typeof home.cols === 'string' && home.cols.split(' ').length === 1, home.cols)
  check('the sidebar is off-screen (collapsed drawer)', home.collapsed === true && home.drawerRight <= 0, home)
  check('the menu button is displayed', home.menu !== null && home.menu !== 'none', home.menu)

  const menu = await center('[data-kb="mobile-menu"]')
  check('the menu button is on screen', menu !== null && menu[0] > 0 && menu[0] < 390 && menu[1] > 0 && menu[1] < 100, menu)
  if (menu !== null) {
    await tap(menu[0], menu[1]); await sleep(1200)
    const opened = await snapshot()
    if (shotsDir !== null) await page.shot(shotsDir + '/phone-drawer.png')
    check('a tap on it opens the drawer over the chat', opened.collapsed === false && opened.drawerLeft >= 0 && opened.drawerRight > 200 && opened.drawerRight <= 390, opened)
    check('the chat keeps the whole width under the drawer', typeof opened.cols === 'string' && opened.cols.split(' ').length === 1, opened.cols)
    check('the menu button steps aside while the drawer is open', opened.menu === 'none', opened.menu)

    await tap(380, 500); await sleep(1000)
    const closed = await snapshot()
    check('a tap on the dimmed chat closes it', closed.collapsed === true && closed.drawerRight <= 0, closed)

    await tap(menu[0], menu[1]); await sleep(1000)
    const row = await center('[data-row-key^="session:"]')
    if (row !== null) {
      await tap(row[0], row[1]); await sleep(2500)
      const picked = await snapshot()
      check('picking a session closes the drawer', picked.collapsed === true && picked.drawerRight <= 0, picked)
    } else {
      console.log('  ○ no session row in this DSH: the pick-to-close check is skipped')
      await tap(380, 500); await sleep(800)
    }
  }

  console.log('settings')
  await page.send('Page.reload', {}); await sleep(4500)
  const opened = await openSettings(page, { minCells: 3 })
  check('Settings opens', opened === true)
  if (opened === true) {
    await sleep(1200)
    const s = JSON.parse(await ev(`(() => {
      const p = document.querySelector('[data-shortcut-modal="settings"]'); const n = p.querySelector('nav'); const c = n.nextElementSibling
      const a = n.getBoundingClientRect(); const b = c.getBoundingClientRect()
      const list = n.lastElementChild
      return JSON.stringify({ navW: Math.round(a.width), navH: Math.round(a.height), contentTop: Math.round(b.top), contentW: Math.round(b.width), stripScrolls: list.scrollWidth > list.clientWidth, scrollW: document.documentElement.scrollWidth, vw: innerWidth })
    })()`))
    if (shotsDir !== null) await page.shot(shotsDir + '/phone-settings.png')
    check('the navigation is a strip above the page, not a column beside it', s.navW >= 360 && s.navH < 300 && s.contentTop >= s.navH - 2, s)
    check('the page has the whole width', s.contentW >= 340, s)
    check('the strip scrolls sideways (every page stays reachable)', s.stripScrolls === true, s)
    check('nothing makes the dialog wider than the screen', s.scrollW === s.vw, s)
  }
} finally {
  try { await page.send('Emulation.clearDeviceMetricsOverride', {}); await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }) } catch (e) { /* the browser is closing */ }
  await live.close()
}

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
