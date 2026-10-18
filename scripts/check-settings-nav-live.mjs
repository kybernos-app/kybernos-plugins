#!/usr/bin/env node
// Checks the Settings menu against the REAL GUI: General alone, then eight folds (an accordion: one group open at a time), the group of
// the page you are on opens by itself, the choice is remembered, a header never takes a tap for « a page was picked », About closes the
// list, and tab names are one notch smaller than the shell's.
//
//   node scripts/check-settings-nav-live.mjs [--worktree] [--shots <dir>]
//
// --worktree: serve this checkout's core plugin client in the throw-away browser (scripts/lib-bundle-swap.mjs) before the check, so a change
// can be checked before it is merged. Without it the check runs on what `dsh web` serves.
// READ-ONLY: it opens Settings, presses menu rows, measures and takes screenshots. Nothing that changes data is pressed.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / Settings did not open).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, openSettings } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? null : r.val }
const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const GROUPS = ['Models & routing', 'Agents', 'Skills & tools', 'Memory & context', 'Voice & calls', 'Interface', 'Devices & cloud', 'System']
// The menu as drawn: rows that have a height, top to bottom. Headers carry their open state, cells their page.
const SEE = `(() => {
  const list = [...document.querySelectorAll('[class*="navList"]')].find((l) => l.querySelector('[class*="navCell"]'))
  const rows = [...list.children].map((c) => ({ t: (c.textContent || '').replace(/\\d+$/, '').trim(), head: c.dataset.kb === 'settings-group', open: c.getAttribute('aria-expanded') === 'true', here: c.hasAttribute('data-kb-here'), cur: c.getAttribute('aria-current') === 'true', y: c.getBoundingClientRect().top, h: c.getBoundingClientRect().height, tag: c.tagName, role: c.getAttribute('role') })).filter((x) => x.h > 0).sort((a, b) => a.y - b.y)
  return JSON.stringify({ rows, open: list.dataset.kbOpen === undefined ? null : list.dataset.kbOpen })
})()`
const see = async () => JSON.parse(await ev(SEE))
const press = async (text, head) => {
  const at = JSON.parse(await ev(`(() => { const e = [...document.querySelectorAll('[class*="navList"] > *')].find((c) => (c.textContent || '').replace(/\\d+$/, '').trim() === ${JSON.stringify(text)} && ${head ? "c.dataset.kb === 'settings-group'" : "c.dataset.kb !== 'settings-group'"} && c.getBoundingClientRect().height > 0); if (!e) return 'null'; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`) || 'null')
  if (at === null) return false
  await click(at.x, at.y)
  await sleep(700)
  return true
}

try {
  if (args.indexOf('--worktree') >= 0) { const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }]); await page.send('Page.reload', { ignoreCache: true }); await sleep(4000); if (swap.report()[0].replaced !== true) console.log('○ the served client is not the checked-out one: running on what is deployed') }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  if (await openSettings(page, { minCells: 3, fold: 'keep' }) !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); process.exit(3) }
  await waitFor(page, `document.querySelectorAll('[data-kb="settings-group"]').length >= 8`, 12000)
  await sleep(1200)

  console.log('the groups')
  let m = await see()
  const heads = m.rows.filter((r) => r.head).map((r) => r.t)
  check('General is the first row, then the eight folds in order', m.rows[0].t === 'General' && heads.join('|') === GROUPS.join('|'), m.rows.map((r) => r.t))
  check('nothing is open at first: no group row has a page under it (the page you are on is General)', m.rows.filter((r) => !r.head).length === 1 && m.open === '', m.rows.filter((r) => !r.head).map((r) => r.t))
  check('a header is a div with role="button" (a <button> is taken for « a page was picked » on a phone)', m.rows.filter((r) => r.head).every((r) => r.tag === 'DIV' && r.role === 'button'))
  check('a header is a 40px row at least, like a page', m.rows.every((r) => r.h >= 38), m.rows.filter((r) => r.h < 38).map((r) => r.t))
  const sizes = await ev(`JSON.stringify([...new Set([...document.querySelectorAll('[class*="navList"][data-kb-settings] > *')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => getComputedStyle(c).fontSize))])`)
  check('names are 13px, one notch under the shell\'s 14px', sizes === '["13px"]', sizes)
  if (shotsDir !== null) await page.shot(shotsDir + '/nav-1-shut.png')

  console.log('open, switch, shut')
  await press('Interface', true)
  m = await see()
  const iface = m.rows.findIndex((r) => r.head && r.t === 'Interface')
  check('pressing a header opens its group: Appearance, Theme and Language are under it', m.rows[iface].open === true && m.rows.slice(iface + 1, iface + 4).map((r) => r.t).join('|') === 'Appearance|Theme|Language', m.rows.map((r) => r.t))
  check('the group is remembered as the open one', m.open === 'look', m.open)
  await press('System', true)
  m = await see()
  check('opening another group shuts the first (one at a time)', m.rows.filter((r) => r.head && r.open).map((r) => r.t).join() === 'System' && !m.rows.some((r) => r.t === 'Theme'), m.rows.filter((r) => r.head && r.open).map((r) => r.t))
  const sys = m.rows.findIndex((r) => r.head && r.t === 'System')
  check('System holds the Suite and Built-in plugins, and About closes the list', m.rows.slice(sys + 1).map((r) => r.t).join('|').startsWith('Kybernos Suite') && m.rows[m.rows.length - 1].t === 'About', m.rows.slice(sys).map((r) => r.t))
  const gap = await ev(`(() => { const l = [...document.querySelectorAll('[class*="navList"]')].find((x) => x.querySelector('[class*="navCell"]')); let sc = l; while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement } const last = [...l.querySelectorAll('[class*="navCell"]')].filter((c) => c.getBoundingClientRect().height > 0).reduce((a, c) => c.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? c : a); if (sc) sc.scrollTop = sc.scrollHeight; return sc ? Math.round(sc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : 999 })()`)
  check('there is room under the last tab (24px or more)', Number(gap) >= 24, gap)
  await press('System', true)
  m = await see()
  check('pressing the open header shuts it: all nine rows again', m.rows.length === 9 && m.open === '', m.rows.map((r) => r.t))

  console.log('the page you are on, and where you land')
  await press('Interface', true)
  await press('Theme', false)
  await sleep(600)
  m = await see()
  check('pressing a page opens it (it is the current row) and its group stays open and drawn stronger', m.rows.some((r) => r.cur && r.t === 'Theme') && m.rows.find((r) => r.head && r.t === 'Interface').here === true)
  const sty = JSON.parse(await ev(`(() => { const c = document.querySelector('[class*="navList"] [aria-current="true"]'); const h = [...document.querySelectorAll('[data-kb="settings-group"]')].find((x) => x.getAttribute('aria-expanded') === 'true'); const cs = getComputedStyle(c); const hs = h ? getComputedStyle(h) : null; return JSON.stringify({ shadow: cs.boxShadow, weight: cs.fontWeight, bg: cs.backgroundColor, hbg: hs && hs.backgroundColor, hw: hs && hs.fontWeight, turned: h ? getComputedStyle(h.querySelector('.kb-cz-chev')).transform : null }) })()`))
  check('the open page is a soft pill (a fill, weight 600, no bar on the edge) and the open group has no fill, a heavier name and its chevron turned down', sty.shadow === 'none' && sty.weight === '600' && sty.bg !== 'rgba(0, 0, 0, 0)' && sty.hbg === 'rgba(0, 0, 0, 0)' && sty.hw === '600' && sty.turned !== 'none', sty)
  if (shotsDir !== null) await page.shot(shotsDir + '/nav-2-active.png')
  await press('Interface', true)
  m = await see()
  check('shutting the group of the page you are on hides its pages but keeps the header drawn stronger: you still see where you are', m.rows.length === 9 && m.rows.find((r) => r.head && r.t === 'Interface').here === true && m.rows.find((r) => r.head && r.t === 'Interface').open === false)
  await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find((e) => (e.textContent || '').trim() === 'Usage'); if (c) c.click() })()`)
  await sleep(900)
  m = await see()
  check('landing on a page of a shut group (a deep link, a help pointer: its cell is pressed while hidden) opens that group', m.rows.some((r) => r.cur && r.t === 'Usage') && m.rows.find((r) => r.head && r.t === 'Models & routing').open === true, m.rows.map((r) => r.t))
  if (shotsDir !== null) await page.shot(shotsDir + '/nav-2-landed.png')
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  if (await openSettings(page, { minCells: 3, fold: 'keep' }) !== true) { console.error('○ inconclusive: the dialog did not reopen after the reload'); process.exit(3) }
  await waitFor(page, `document.querySelectorAll('[data-kb="settings-group"]').length >= 8`, 12000)
  await sleep(1200)
  m = await see()
  check('the open group survives a reload (the browser remembers it)', m.rows.find((r) => r.head && r.t === 'Models & routing').open === true || m.open === 'models', m.open)
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
