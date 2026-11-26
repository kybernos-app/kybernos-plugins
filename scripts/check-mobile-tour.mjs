#!/usr/bin/env node
// A tour of every screen of the real DSH GUI on a phone: the new-chat page, a conversation, each page of the
// sidebar (Kybers, Workspaces, Creations, Automations, Skills, Connectors), Settings (the list and
// a page), the right bar, and the composer's menus. On each screen it measures what a person would trip on:
//
//   - the page scrolling sideways, or a control leaving the screen;
//   - a control a finger cannot hit (under 36 px);
//   - a control cut by the box that holds it (overflow hidden);
//   - a page title under the menu button; the drawer that must close by a tap, a swipe and a pick;
//   - text under 11 px.
//
//   node scripts/check-mobile-tour.mjs [--device 360x800] [--css <file>] [--client <file>] [--deployed] [--shots <dir>] [--light] [--mac]
//
// Like check-mobile-visual.mjs, a throw-away headless Chrome signs in to the DSH at KB_HOST (default
// 127.0.0.1:3080) and replaces `#kbmob-sheet` with the working tree's stylesheet, and the plugin's browser half with
// the working tree's client.js, unless --deployed. Nothing is
// written to the user's DSH: pages are opened, never edited. Exit code: 0 every screen is clean, 1 something was
// found (the list is printed), 3 inconclusive (GUI down).
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, swapPluginClient, ensureConversation } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, def) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : def)
const [W, H] = String(arg('--device', '360x800')).split('x').map(Number)
const cssFile = arg('--css', join(here, '..', 'packages', 'kybernos-mobile', 'mobile.css'))
const clientFile = arg('--client', join(here, '..', 'packages', 'kybernos-mobile', 'client.js'))
const shotsDir = arg('--shots', null)
const deployed = args.indexOf('--deployed') >= 0
const light = args.indexOf('--light') >= 0
if (arg('--host', null) !== null) process.env.KB_HOST = arg('--host', null)
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const CSS = readFileSync(cssFile, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? null : r.val }
const tap = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }

// the working tree's browser half too (swapped into the page's bundle in this throw-away browser), unless --deployed
const swap = deployed ? { swapped: 0 } : await swapPluginClient(page, '@local/kybernos-mobile', clientFile)
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2.5, mobile: true })
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
// An Android phone, unless --mac: DSH draws no keyboard shortcut (aria-keyshortcuts) there, which the drawer's buttons
// must not depend on (measured on a real phone, 2026-10-13: a tap on the dimmed chat did nothing).
if (args.indexOf('--mac') < 0) {
  await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', userAgentMetadata: { platform: 'Android', platformVersion: '14', architecture: '', model: 'Pixel 8', mobile: true, brands: [{ brand: 'Chromium', version: '130' }], fullVersionList: [{ brand: 'Chromium', version: '130.0.0.0' }] } })
}
const boot = async () => {
  await page.send('Page.reload', {})
  await sleep(6500)
  if (!deployed) {
    await ev(`(() => { let s = document.getElementById('kbmob-sheet'); if (!s) { s = document.createElement('style'); s.id = 'kbmob-sheet'; document.head.insertBefore(s, document.head.firstChild) } s.textContent = ${JSON.stringify(CSS)}; return true })()`)
    await sleep(400)
  }
  if (light) await ev(`document.body.removeAttribute('data-ds-dark-theme'); true`)
}

// What a person would trip on, on the screen as it is now.
const audit = () => ev(`(() => {
  const vw = innerWidth, vh = innerHeight
  const shown = (e) => {
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false
    for (let p = e, i = 0; p && i < 12; p = p.parentElement, i += 1) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0') return false }
    return true
  }
  const inView = (r) => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
  // under another layer (the drawer, a dialog, a mask): not what the person is looking at
  const covered = (e) => { const r = e.getBoundingClientRect(); const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)); const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2)); const hit = document.elementFromPoint(x, y); return hit !== null && !e.contains(hit) && !hit.contains(e) }
  const label = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.innerText || '').replace(/\\s+/g, ' ').trim() || e.tagName.toLowerCase()).slice(0, 28)
  // a scroller on purpose (a strip, a code block) may hold things beyond its edge
  const scrolls = (e) => { for (let p = e.parentElement, i = 0; p && i < 8; p = p.parentElement, i += 1) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowX) && p.scrollWidth > p.clientWidth + 2) return true } return false }
  // cut by a box that hides its overflow (a control wider than the row that holds it): not a scroller, a clipped control
  const clipped = (e, r) => { for (let p = e.parentElement, i = 0; p && i < 8; p = p.parentElement, i += 1) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowX)) return false; if (/(hidden|clip)/.test(c.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.width > 2 && (r.right > pr.right + 2 || r.left < pr.left - 2)) return true } } return false }
  const out = { vw, vh, sideways: document.documentElement.scrollWidth > vw + 1, leaves: [], small: [], tiny: [], cut: [], title: null }
  // a page's title must not start under the menu button (fixed in the corner)
  const menu = document.querySelector('[data-kb="mobile-menu"]')
  const h1 = document.querySelector('[data-slot="main"] h1') || (() => { let best = null; let size = 0; for (const e of Array.from(document.querySelectorAll('[data-slot="main"] *')).slice(0, 600)) { if (e.children.length > 0) continue; const r = e.getBoundingClientRect(); if (r.width < 1 || r.top > 110 || r.bottom < 0 || !(e.textContent || '').trim()) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs >= 22 && fs > size) { best = e; size = fs } } return best })()
  if (menu && h1 && !document.querySelector('[data-composer-card]')) {
    const m = menu.getBoundingClientRect(); const t = h1.getBoundingClientRect()
    const overlapX = t.left < m.right && t.right > m.left; const gap = t.top - m.bottom
    if (m.width > 0 && t.width > 0 && overlapX && gap < 6) out.title = 'title at ' + Math.round(t.top) + ' px, the menu button ends at ' + Math.round(m.bottom)
  }
  const seen = {}
  for (const e of document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], [role=option], a[href], input:not([type=hidden]), textarea, select, [role=switch]')) {
    if (!shown(e)) continue
    const r = e.getBoundingClientRect(); if (!inView(r) || covered(e)) continue
    const k = label(e) + '@' + Math.round(r.left) + ',' + Math.round(r.top); if (seen[k]) continue; seen[k] = 1
    if ((r.right > vw + 1 || r.left < -1) && !scrolls(e)) out.leaves.push(label(e) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    if (clipped(e, r)) out.cut.push(label(e) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    if ((r.width < 36 || r.height < 36) && !scrolls(e)) out.small.push(label(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const fonts = {}
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.nodeValue || '').trim(); if (t.length < 2) continue
    const p = n.parentElement; if (!p || !shown(p)) continue
    const r = p.getBoundingClientRect(); if (!inView(r) || covered(p)) continue
    const fs = parseFloat(getComputedStyle(p).fontSize)
    // a badge (EXP, NEW, BETA) is a chip, not a sentence: left out
    if (fs < 11 && !/^[A-Z0-9 ·+]{1,5}$/.test(t)) { const k = t.slice(0, 22) + ' ' + fs + 'px'; if (!fonts[k]) { fonts[k] = 1; out.tiny.push(k) } }
  }
  return JSON.stringify(out)
})()`).then((j) => (j === null ? null : JSON.parse(j)))

let problems = 0
const report = async (name, extra) => {
  await sleep(500)
  if (shotsDir !== null) await page.shot(join(shotsDir, 'tour-' + W + 'x' + H + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png'))
  const a = await audit()
  if (a === null) { console.log('  ? ' + name + ': audit unavailable'); return }
  const bad = a.sideways || a.leaves.length > 0 || a.small.length > 0 || a.tiny.length > 0 || a.cut.length > 0 || a.title !== null
  if (bad) problems += 1
  console.log((bad ? '  ✗ ' : '  ✓ ') + name)
  if (a.sideways) console.log('      the page scrolls sideways')
  if (a.leaves.length) console.log('      leaves the screen: ' + a.leaves.slice(0, 6).join(' | '))
  if (a.title !== null) console.log('      the title is under the menu button: ' + a.title)
  if (a.cut.length) console.log('      cut by its container: ' + a.cut.slice(0, 6).join(' | '))
  if (a.small.length) console.log('      under 36 px: ' + a.small.slice(0, 8).join(' | ') + (a.small.length > 8 ? ' (+' + (a.small.length - 8) + ')' : ''))
  if (a.tiny.length) console.log('      text under 11 px: ' + a.tiny.slice(0, 6).join(' | ') + (a.tiny.length > 6 ? ' (+' + (a.tiny.length - 6) + ')' : ''))
}
const drawerOpen = () => ev(`!document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)
const openDrawer = async () => { if (!(await drawerOpen())) { await ev(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (b) b.click(); return !!b })()`); await sleep(900) } }
const closeDrawer = async () => {
  if (await drawerOpen()) { await ev(`(() => { const b = document.querySelector('button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])'); if (b) b.click(); return !!b })()`); await sleep(800) }
}
const clickText = (txt) => ev(`(() => {
  const want = ${JSON.stringify(txt.toLowerCase())}
  const list = Array.from(document.querySelectorAll('button, [role=button], a, [role=menuitem]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
  const e = list.find((x) => (x.innerText || x.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(want))
  if (!e) return false
  e.scrollIntoView({ block: 'center' }); e.click(); return true
})()`)
const rowCenter = (txt) => ev(`(() => {
  const want = ${JSON.stringify(txt.toLowerCase())}
  const list = Array.from(document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] a, [data-slot="sidebar"] [role=button]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
  const e = list.find((x) => (x.innerText || x.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(want))
  if (!e) return null
  e.scrollIntoView({ block: 'center' })
  const r = e.getBoundingClientRect()
  return [Math.round(r.left + Math.min(60, r.width / 2)), Math.round(r.top + r.height / 2)]
})()`)
const swipeLeft = async (x1, y, x2) => {
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] })
  for (let k = 1; k <= 6; k += 1) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / 6, y }] })
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const escape = () => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }))

try {
  console.log('device ' + W + 'x' + H + (light ? ' (light)' : '') + (deployed ? ' (deployed)' : ' (working-tree stylesheet)'))
  // A fresh sandbox holds no conversation: send a first message from the empty composer (never on the user's own DSH), so that the tour has one to open.
  if (await ensureConversation(page) !== true) console.log('  ○ no conversation to open on this DSH (and none could be created): the conversation screens will report it')
  await boot()

  if (!deployed) console.log(swap.swapped > 0 ? '  (the working tree\'s client.js is in the page)' : '  ○ the working tree\'s client.js was NOT swapped in: this tour ran on the deployed one')
  console.log('new chat and conversation')
  await closeDrawer()
  await report('home (new chat)')
  await openDrawer()
  await report('drawer')
  // the drawer goes without the person having to find its own icon: a tap on the dimmed chat, then a swipe to the left
  await tap(W - 8, Math.round(H / 2)); await sleep(900)
  if (await drawerOpen()) { problems += 1; console.log('  ✗ drawer: a tap on the dimmed chat did not close it'); await closeDrawer() } else console.log('  ✓ drawer closes by a tap on the dimmed chat')
  await openDrawer()
  await swipeLeft(Math.round(W * 0.7), Math.round(H / 2), Math.round(W * 0.15)); await sleep(900)
  if (await drawerOpen()) { problems += 1; console.log('  ✗ drawer: a swipe to the left did not close it'); await closeDrawer() } else console.log('  ✓ drawer closes by a swipe to the left')
  await openDrawer()
  // The list of sessions arrives a moment after the page, and a click on a row can land while it is still being drawn:
  // try again until a conversation is on screen (its composer has the model slot). A tour that opened no conversation
  // has not seen its screens, and says so below.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await openDrawer()
    for (let i = 0; i < 24; i += 1) { if ((await ev(`document.querySelectorAll('[data-row-key^="session:"]').length`)) > 0) break; await sleep(500) }
    await ev(`(() => { const list = Array.from(document.querySelectorAll('[data-row-key^="session:"]')); const e = list.find((x) => /Greeting/.test(x.innerText || '')) || list.find((x) => !/New Session/i.test(x.innerText || '')) || list[0]; if (e) { e.scrollIntoView({ block: 'center' }); e.click() } return !!e })()`)
    await sleep(3000); await closeDrawer()
    if ((await ev(`!!document.querySelector('[data-slot="conversation.input.model"] button, [data-slot="conversation.input.permission"] button')`)) === true) break
  }
  await report('conversation')

  console.log('composer menus')
  for (const [name, sel] of [['model picker', '[data-slot="conversation.input.model"] button'], ['"+" menu', '[data-composer-card] [data-model-compact] button, [data-composer-card] button'], ['access mode', '[data-slot="conversation.input.permission"] button']]) {
    const hit = await ev(`(() => { const e = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find((x) => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2 }); if (!e) return false; e.click(); return true })()`)
    if (hit) { await sleep(800); await report(name); await escape(); await sleep(400); await ev(`document.body.click(); true`); await sleep(300) } else { problems += 1; console.log('  ✗ ' + name + ': no such control here (no conversation open?)') }
  }

  console.log('right bar')
  await ev(`(() => { const b = document.querySelector('button[data-sidebar-right-expand]'); if (b) b.click(); return !!b })()`)
  await sleep(1500)
  await report('right bar (Start)')
  // closed by its own collapse button (DSH draws no shortcut on a phone), the shortcut button on a desktop UA
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button[data-sidebar-right-toggle], button[aria-keyshortcuts*="Shift"]')).find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 }); if (b) b.click(); return !!b })()`)
  await sleep(900)

  console.log('pages of the sidebar')
  // (the first entry is "Kybers" or "Agent Teams", after the profile's wording)
  // (DSH's own « Automation tasks » row is gone: the Kybernos Automations page replaces it and hides DSH's list, so the drawer has no such row to tap.)
  for (const label of ['Kybers', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']) {
    await openDrawer()
    // a finger: the row is tapped where it is, and the drawer must go by itself (the page is then the whole screen)
    const at = await rowCenter(label) || (label === 'Kybers' ? await rowCenter('Agent Teams') : null)
    if (at === null) { problems += 1; console.log('  ✗ ' + label + ': not in the drawer'); continue }
    await tap(at[0], at[1])
    await sleep(1600)
    if (await drawerOpen()) { problems += 1; console.log('  ✗ ' + label + ': picking it left the drawer open over the page'); await closeDrawer() }
    await sleep(1000)
    await report(label)
  }

  console.log('settings')
  let opened = false
  for (let attempt = 0; attempt < 3 && opened !== true; attempt += 1) {
    await boot()
    await openDrawer()
    opened = await openSettings(page, { minCells: 3 })
  }
  if (opened === true) {
    await sleep(1200)
    await report('settings (list of pages)')
    // what the client does on a pick: the page replaces the list under a "back" bar
    await ev(`(() => { const m = document.querySelector('[data-shortcut-modal="settings"]'); if (!m) return false; m.setAttribute('data-kbmob-page', '1'); m.children[1].setAttribute('data-kbmob-back', 'Settings'); return true })()`)
    await sleep(700)
    await report('settings (a page)')
  } else { problems += 1; console.log('  ✗ settings: could not be opened (three tries)') }
} finally {
  await live.close()
}
console.log('\n' + (problems === 0 ? 'every screen is clean' : problems + ' screen(s) with something to fix'))
process.exit(problems === 0 ? 0 : 1)
