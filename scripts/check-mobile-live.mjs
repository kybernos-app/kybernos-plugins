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
    // a row the finger can actually reach: the drawer's list scrolls under its footer card, so bring one to the middle
    // of the list and check that the row (not the footer) is what is under that point
    const row = await ev(`(() => {
      const e = Array.from(document.querySelectorAll('[data-row-key^="session:"]')).find((x) => x.getBoundingClientRect().height > 0)
      if (!e) return null
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect(); const x = r.left + 60; const y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      return hit && hit.closest('[data-row-key]') === e ? [x, y] : null
    })()`)
    await sleep(300)
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
  // on a phone the account card lives in the drawer: open it first, like a person does
  const drawerBtn = await center('[data-kb="mobile-menu"]')
  if (drawerBtn !== null) { await tap(drawerBtn[0], drawerBtn[1]); await sleep(1000) }
  const opened = await openSettings(page, { minCells: 3 })
  check('Settings opens', opened === true)
  if (opened === true) {
    await sleep(1200)
    // a phone shows the list of pages first (a column of rows, not a strip), and the page once one is picked
    const list = JSON.parse(await ev(`(() => {
      const p = document.querySelector('[data-shortcut-modal="settings"]'); const n = p.querySelector('nav'); const c = n.nextElementSibling
      const rows = Array.from(n.querySelectorAll('nav > div:last-child > button')).filter((b) => b.getBoundingClientRect().width > 0)
      const a = n.getBoundingClientRect(); const b = c.getBoundingClientRect()
      const tops = rows.slice(0, 12).map((r) => Math.round(r.getBoundingClientRect().top)).sort((x, y) => x - y)
      const lefts = rows.slice(0, 12).map((r) => Math.round(r.getBoundingClientRect().left))
      return JSON.stringify({ navW: Math.round(a.width), rows: rows.length, tops, lefts, pageW: Math.round(b.width), pageShown: b.width > 0 && getComputedStyle(c).display !== 'none', picked: p.hasAttribute('data-kbmob-page'), scrollW: document.documentElement.scrollWidth, vw: innerWidth })
    })()`))
    if (shotsDir !== null) await page.shot(shotsDir + '/phone-settings-list.png')
    check('the list of pages is a column of rows across the whole width', list.navW >= 340 && list.rows >= 3 && list.tops.every((t, k) => k === 0 || t - list.tops[k - 1] >= 36) && new Set(list.lefts).size === 1, list)
    check('the page waits for a pick: it is not squeezed beside the list', list.pageShown === false && list.picked === false, list)
    check('nothing makes the dialog wider than the screen', list.scrollW === list.vw, list)
    const pick = await ev(`(() => { const p = document.querySelector('[data-shortcut-modal="settings"]'); const rows = Array.from(p.querySelectorAll('nav > div:last-child > button')).filter((b) => b.getBoundingClientRect().width > 0); const r = rows[1] || rows[0]; if (!r) return false; r.click(); return true })()`)
    check('a page can be picked from the list', pick === true)
    await sleep(900)
    const page1 = JSON.parse(await ev(`(() => {
      const p = document.querySelector('[data-shortcut-modal="settings"]'); const c = p.children[1]
      const b = c.getBoundingClientRect()
      return JSON.stringify({ picked: p.hasAttribute('data-kbmob-page'), back: c.getAttribute('data-kbmob-back'), pageW: Math.round(b.width), pageH: Math.round(b.height), navShown: p.querySelector('nav').getBoundingClientRect().width > 0 && getComputedStyle(p.querySelector('nav')).display !== 'none', scrollW: document.documentElement.scrollWidth, vw: innerWidth })
    })()`))
    if (shotsDir !== null) await page.shot(shotsDir + '/phone-settings-page.png')
    check('the picked page has the whole width, under a back bar, and the list is out of the way', page1.picked === true && page1.pageW >= 340 && typeof page1.back === 'string' && page1.back.length > 0 && page1.navShown === false, page1)
    check('the page does not scroll the dialog sideways', page1.scrollW === page1.vw, page1)
    // the back bar is the top 56 px of the page
    const bar = await ev(`(() => { const c = document.querySelector('[data-shortcut-modal="settings"]').children[1]; const r = c.getBoundingClientRect(); return [r.left + 40, r.top + 28] })()`)
    await tap(bar[0], bar[1]); await sleep(700)
    const back = await ev(`!document.querySelector('[data-shortcut-modal="settings"]').hasAttribute('data-kbmob-page')`)
    check('a tap on the back bar returns to the list', back === true)
  }
} finally {
  try { await page.send('Emulation.clearDeviceMetricsOverride', {}); await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }) } catch (e) { /* the browser is closing */ }
  await live.close()
}

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
