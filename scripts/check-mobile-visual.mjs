#!/usr/bin/env node
// Visual and measured check of the phone layout on the REAL GUI's DOM, for the stylesheet in the working tree.
//
//   node scripts/check-mobile-visual.mjs [--css <file>] [--client <file>] [--deployed] [--shots <dir>] [--only <WxH>] [--host <host:port>]
//
// A throw-away headless Chrome opens the DSH at KB_HOST (default 127.0.0.1:3080, signed in by cookie), emulates each
// device, replaces the page's `#kbmob-sheet` with the stylesheet you are working on (default
// packages/kybernos-mobile/mobile.css) and serves the working tree's client.js in place of the deployed one, opens a conversation and the drawer, takes screenshots and measures:
// no sideways scroll, a one-row composer of 44 px targets with a readable model name, a title that is not squeezed
// to nothing, rows of 44 px in the drawer, a 16 px field, and, above 700 px, that the sheet changed nothing.
// With --deployed nothing is injected: the page runs what this DSH serves (stylesheet AND client half), which also
// proves the "..." sheet. Nothing is written to the user's DSH: only a view is emulated and sessions are opened, never sent to.
// On a sandbox with no conversation yet, a first message is sent to create one (the turn fails without a key: fine); the user's own DSH is never written to.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down).
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, swapPluginClient, ensureConversation } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, def) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : def)
const cssFile = arg('--css', join(here, '..', 'packages', 'kybernos-mobile', 'mobile.css'))
const clientFile = arg('--client', join(here, '..', 'packages', 'kybernos-mobile', 'client.js'))
const shotsDir = arg('--shots', null)
const only = arg('--only', null)
const deployed = args.indexOf('--deployed') >= 0
if (arg('--host', null) !== null) process.env.KB_HOST = arg('--host', null)
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const CSS = readFileSync(cssFile, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// name, width, height, phone? (the sheet must act), mobile emulation, scale
const DEVICES = [
  ['iphone-390x844', 390, 844, true],
  ['android-360x740', 360, 740, true],
  ['small-320x568', 320, 568, true],
  ['large-430x932', 430, 932, true],
  ['landscape-844x390', 844, 390, true],
  ['tablet-768x1024', 768, 1024, false],
  ['desktop-1280x760', 1280, 760, false],
].filter((d) => only === null || only === d[1] + 'x' + d[2])

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
// the working tree's browser half too (swapped into the page's bundle, in this throw-away browser), unless --deployed
const swap = deployed ? { swapped: 0 } : await swapPluginClient(page, '@local/kybernos-mobile', clientFile)
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? null : r.val }
const tap = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const center = (sel, text) => ev(`(() => {
  const list = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  const e = ${text === undefined ? 'list[0]' : 'list.find((x) => new RegExp(' + JSON.stringify(text) + ').test(x.innerText || ""))'}
  if (!e) return null
  e.scrollIntoView({ block: 'nearest' })
  const r = e.getBoundingClientRect()
  return [r.left + Math.min(60, r.width / 2), r.top + r.height / 2]
})()`)
const injectCss = () => deployed ? Promise.resolve(true) : ev(`(() => {
  let s = document.getElementById('kbmob-sheet')
  if (!s) { s = document.createElement('style'); s.id = 'kbmob-sheet'; document.head.insertBefore(s, document.head.firstChild) }
  s.textContent = ${JSON.stringify(CSS)}
  return true
})()`)

// DSH remembers the right bar in the throw-away profile: a full-screen layer on a phone would cover the next device
const closeRightBar = async () => {
  // DSH's phone state is "collapsed" AND "fullscreen" at once: a bar is open when either says so
  const open = await ev(`(() => { const f = document.querySelector('[data-slot="root"] > div'); return !f.hasAttribute('data-rightbar-collapsed') || f.hasAttribute('data-rightbar-fullscreen') })()`)
  if (!open) return
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button[aria-keyshortcuts*="Shift"]')).find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !x.hasAttribute('data-sidebar-right-expand') }) || document.querySelector('button[data-sidebar-right-expand]'); if (b) b.click(); return !!b })()`)
  await sleep(900)
}
const measure = () => ev(`(() => {
  // parked actions (the "..." sheet lists them) are rendered but invisible and one pixel wide: they are not on screen
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); let p = e; let parked = false; for (let i = 0; i < 5 && p; i++) { const c = getComputedStyle(p); if (c.position === 'fixed' && c.opacity === '0') parked = true; p = p.parentElement } return r.width > 2 && r.height > 2 && !parked && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const buttons = Array.from(document.querySelectorAll('[data-composer-card] button')).filter(vis)
  const tops = buttons.map((b) => b.getBoundingClientRect().top)
  const model = document.querySelector('[data-composer-card] [data-slot="conversation.input.model"] button')
  const modelLabel = model ? model.querySelector('span') : null
  const inputEl = document.querySelector('[data-composer-input]')
  const dock = document.querySelector('[data-composer-dock]')
  const hdr = document.querySelector('[data-slot="conversation.session.header"] nav[aria-label]')
  const frame = document.querySelector('[data-slot="root"] > div')
  const menu = document.querySelector('[data-kb="mobile-menu"]')
  const rating = document.querySelector('.kbq-rating')
  const tabs = document.querySelector('[role="tablist"][data-conversation-tabs]')
  const hdr2 = document.querySelector('[data-slot="conversation.header"] > header')
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth,
    coarse: matchMedia('(pointer: coarse)').matches,
    composerButtons: buttons.length,
    composerRowSpread: tops.length ? Math.round(Math.max(...tops) - Math.min(...tops)) : null,
    smallestTarget: buttons.length ? Math.round(Math.min(...buttons.map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)))) : null,
    modelLabelW: modelLabel ? Math.round(modelLabel.getBoundingClientRect().width) : null,
    modelLabelText: modelLabel ? modelLabel.textContent.slice(0, 40) : null,
    inputFont: inputEl ? parseFloat(getComputedStyle(inputEl).fontSize) : null,
    dockDisplay: dock ? getComputedStyle(dock).display : null,
    titleW: hdr ? Math.round(hdr.getBoundingClientRect().width) : null,
    cols: frame ? getComputedStyle(frame).gridTemplateColumns.split(' ').length : null,
    menuDisplay: menu ? getComputedStyle(menu).display : null,
    ratingW: rating ? Math.round(rating.getBoundingClientRect().width) : null,
    tabsVisible: tabs ? (() => { const r = tabs.getBoundingClientRect(); return r.width > 4 && r.height > 4 })() : null,
    headerBottom: hdr2 ? Math.round(hdr2.getBoundingClientRect().bottom) : null,
    header: Array.from(document.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < 60 && r.left >= 0 }).map((b) => (b.getAttribute('aria-label') || b.getAttribute('data-act') || 'btn').slice(0, 18) + '@' + Math.round(b.getBoundingClientRect().left) + '+' + Math.round(b.getBoundingClientRect().width)),
  })
})()`).then((j) => (j === null ? null : JSON.parse(j)))

try {
  if (await ensureConversation(page) !== true) console.log('  ○ no conversation to open on this DSH (and none could be created): a phone then reports « inconclusive »')
  for (const [name, w, h, phone] of DEVICES) {
    console.log('\n' + name)
    if (!deployed && swap.swapped === 0 && name === DEVICES[0][0]) console.log('  ○ the working tree\'s client.js is NOT in the page yet (swapped on the first reload)')
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w <= 900 })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: w <= 900 })
    await page.send('Page.reload', {})
    await sleep(6000)
    await injectCss()
    await sleep(500)
    await closeRightBar()

    // The page still runs the CLIENT half deployed on this DSH (not the working tree's). The working tree's client
    // closes an open sidebar on a phone lying down (DSH leaves it open above its own breakpoint): do the same click.
    if (phone && await ev(`!document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)) {
      await ev(`(() => { const b = document.querySelector('button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])'); if (b) b.click(); return !!b })()`)
      await sleep(700)
    }
    // open a short conversation through the drawer (or the sidebar on a wide screen)
    if (phone) {
      const menu = await center('[data-kb="mobile-menu"]')
      if (process.env.KB_VERBOSE) console.log('  menu button at', JSON.stringify(menu), 'collapsed', await ev(`document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`))
      if (menu !== null) { await tap(menu[0], menu[1]); await sleep(900) }
      if (process.env.KB_VERBOSE) console.log('  after the tap: collapsed', await ev(`document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`), 'rows', await ev(`document.querySelectorAll('[data-row-key^="session:"]').length`))
    }
    let rows = await ev(`document.querySelectorAll('[data-row-key^="session:"]').length`)
    if (!rows) {
      // a short screen (landscape) fills the drawer with the page list: scroll the sessions into view
      await ev(`(() => { for (const e of document.querySelectorAll('[data-slot="sidebar"] *')) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20) e.scrollTop = e.scrollHeight } return true })()`)
      await sleep(700)
      rows = await ev(`document.querySelectorAll('[data-row-key^="session:"]').length`)
    }
    if (!rows && phone) {
      const diag = await measure()
      console.error('○ inconclusive: no conversation in the sidebar ' + JSON.stringify(diag))
      process.exit(3)
    }
    // (a tablet shows a rail of icons, with no list of conversations: the home page is measured there)
    if (shotsDir !== null && phone) await page.shot(join(shotsDir, name + '-1-drawer.png'))
    const drawerRow = await ev(`(() => { const e = document.querySelector('[data-row-key^="session:"]'); if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.height) })()`)
    // open it with a DOM click: a short screen keeps the row below the fold of the drawer
    await ev(`(() => { const list = Array.from(document.querySelectorAll('[data-row-key^="session:"]')); const e = list.find((x) => /Greeting/.test(x.innerText || '')) || list.find((x) => !/New Session/i.test(x.innerText || '')) || list[0]; if (e) { e.scrollIntoView({ block: 'nearest' }); e.click() } return !!e })()`)
    await sleep(3500)
    // a phone's drawer closes by itself after a pick (client half); the deployed client does not know a phone lying
    // down yet, so close it the way the working tree's client would: DSH's own toggle
    if (phone && await ev(`!document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)) {
      await ev(`(() => { const b = document.querySelector('button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])'); if (b) b.click(); return !!b })()`)
      await sleep(900)
    }
    if (shotsDir !== null) await page.shot(join(shotsDir, name + '-2-chat.png'))
    // Above 700 px the chat fold (kybernos-plugin) keeps the chat's tab row behind its « Show chat tools » toggle. Where the sheet must change nothing, the toggle is
    // opened the way a person does, so that the row can be measured: a row hidden by that feature is not a row the mobile sheet touched.
    if (!phone && await ev(`(() => { const t = document.querySelector('[data-kb="chat-fold"] [data-act="toggle"]'); if (t && t.getAttribute('aria-pressed') !== 'true') { t.click(); return true } return false })()`)) await sleep(700)
    const m = await measure()
    if (m === null) { console.error('○ inconclusive: measures unavailable'); process.exit(3) }

    if (process.env.KB_VERBOSE) console.log('  header buttons:', m.header.join(' '))
    check('no sideways scroll', m.scrollW <= m.vw, { scrollW: m.scrollW, vw: m.vw })
    if (phone) {
      check('the coarse pointer is emulated (the landscape rule needs it)', m.coarse === true || w <= 700, m.coarse)
      check('one column (the sidebar left the grid)', m.cols === 1, m.cols)
      check('the menu button is shown', m.menuDisplay !== null && m.menuDisplay !== 'none', m.menuDisplay)
      check('composer: one row (buttons within 12 px of each other)', m.composerRowSpread !== null && m.composerRowSpread <= 12, m.composerRowSpread)
      check('composer: 3 to 6 controls', m.composerButtons >= 3 && m.composerButtons <= 6, m.composerButtons)
      check('composer: every target is at least 40 px', m.smallestTarget !== null && m.smallestTarget >= 40, m.smallestTarget)
      check('composer: the model name is readable', m.modelLabelW !== null && m.modelLabelW >= 40 && (m.modelLabelText || '').length > 2, { w: m.modelLabelW, t: m.modelLabelText })
      check('composer: the field is 16 px', m.inputFont !== null && m.inputFont >= 16, m.inputFont)
      check('composer: the stats strip is gone', m.dockDisplay === null || m.dockDisplay === 'none', m.dockDisplay)
      check('the rating card is one star (44 px) until it is tapped', m.ratingW === null || m.ratingW <= 48, m.ratingW)
      check('the tab row is out of the header on the Chat view', m.tabsVisible === null || m.tabsVisible === false, m.tabsVisible)
      check('the header is one row (56 px) with its tab row parked', m.headerBottom === null || m.headerBottom <= 60, m.headerBottom)
      check('the title keeps room (not squeezed behind the actions)', m.titleW === null || m.titleW >= 60, m.titleW)
      check('drawer rows are at least 44 px', drawerRow !== null && drawerRow >= 44, drawerRow)
    } else {
      check('nothing changes: the menu button stays hidden', m.menuDisplay === null || m.menuDisplay === 'none', m.menuDisplay)
      check('nothing changes: the sidebar column is in the grid', m.cols !== null && m.cols >= 2, m.cols)
      check('nothing changes: the tab row stays', m.tabsVisible === null || m.tabsVisible === true, m.tabsVisible)
      check('nothing changes: the stats strip is not hidden', m.dockDisplay === null || m.dockDisplay !== 'none', m.dockDisplay)
    }

    // the "..." sheet (client half): only when this DSH serves the client that builds it
    if (phone && deployed && w <= 700) {
      const more = await ev(`(() => { const b = Array.from(document.querySelectorAll('[data-slot="conversation.session.header.utilities"] button')).find((x) => !x.closest('[data-open-target]') && x.getBoundingClientRect().width > 2); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
      check('the header has a visible "More actions" button', more !== null, more)
      if (more !== null) {
        await tap(more[0], more[1]); await sleep(900)
        const sheet = await ev(`(() => { const p = document.querySelector('.kbmob-sheet'); if (!p) return null; const rows = Array.from(p.querySelectorAll('.kbmob-sheet-row')).map((r) => (r.textContent || '').trim()); const b = p.getBoundingClientRect(); return JSON.stringify({ rows, bottom: Math.round(b.bottom), vh: innerHeight, left: Math.round(b.left), right: Math.round(b.right) }) })()`)
        if (shotsDir !== null) await page.shot(join(shotsDir, name + '-4-sheet.png'))
        const info = sheet === null ? null : JSON.parse(sheet)
        check('a tap on it opens the sheet', info !== null)
        if (info !== null) {
          check('the sheet lists the parked actions and DSH\'s own menu last (3 rows or more)', info.rows.length >= 3, info.rows)
          check('the sheet sits at the bottom edge of the screen', Math.abs(info.bottom - info.vh) <= 2 && info.left === 0, info)
          await tap(Math.round(w / 2), 60); await sleep(600)
          check('a tap on the dimmed page closes it', await ev(`!document.querySelector('.kbmob-sheet')`) === true)
        }
      }
    }

    // the right bar, full screen on a phone
    if (phone && shotsDir !== null) {
      const rb = await center('button[data-sidebar-right-expand="true"]')
      if (rb !== null) { await tap(rb[0], rb[1]); await sleep(1500); await page.shot(join(shotsDir, name + '-3-rightbar.png')); await closeRightBar() }
    }
  }

  // light theme: DSH marks its dark theme with an attribute on <body>; the page here is throw-away
  if (shotsDir !== null && (only === null || only === '390x844')) {
    console.log('\nlight theme (390x844)')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await page.send('Page.reload', {})
    await sleep(6000)
    await injectCss()
    await ev(`document.body.removeAttribute('data-ds-dark-theme'); true`)
    const row = await center('[data-row-key^="session:"]')
    const menu = await center('[data-kb="mobile-menu"]')
    if (menu !== null) { await tap(menu[0], menu[1]); await sleep(900) }
    const r2 = await center('[data-row-key^="session:"]', 'Greeting') || await center('[data-row-key^="session:"]')
    if (r2 !== null) { await tap(r2[0], r2[1]); await sleep(3500) }
    await ev(`document.body.removeAttribute('data-ds-dark-theme'); true`)
    await sleep(500)
    await page.shot(join(shotsDir, 'iphone-390x844-light-chat.png'))
    void row
  }
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
