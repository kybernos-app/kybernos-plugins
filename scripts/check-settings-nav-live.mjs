#!/usr/bin/env node
// Checks the layout of the Settings nav against the REAL GUI: About closes the list, there is room under
// the last tab, tab names are one notch smaller, and a plugin's page (Memory & Lessons) still sits under Language.
//
//   node scripts/check-settings-nav-live.mjs [--shots <dir>]
//
// READ-ONLY: it opens Settings, measures, scrolls the nav and takes a screenshot. Nothing is clicked that
// changes data. Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / Settings did not open).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

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

try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  const chipJs = `(() => { const e = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'My workspace' || /Switch workspace|^MW/.test((x.textContent || '').trim())); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`
  let open = false
  for (let attempt = 1; attempt <= 4 && open !== true; attempt += 1) {
    if ((await waitFor(page, `${chipJs} !== null`, 15000)) === null) break
    const chip = JSON.parse(await ev(chipJs))
    await click(chip.x, chip.y); await sleep(1000)
    await clickText(page, 'Settings')
    open = (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 6000)) !== null
    if (open !== true) { await page.send('Page.reload', { ignoreCache: true }); await sleep(3500) }
  }
  if (open !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); process.exit(3) }
  await waitFor(page, `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'About')`, 12000)
  await sleep(1200)

  console.log('settings nav')
  const m = JSON.parse(await ev(`(() => {
    const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
    const cells = [...list.querySelectorAll('[class*="navCell"]')].map(c => ({ t: c.textContent.trim(), y: c.getBoundingClientRect().top, fs: parseFloat(getComputedStyle(c).fontSize) })).sort((a, b) => a.y - b.y)
    let sc = list; while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement }
    const last = [...list.querySelectorAll('[class*="navCell"]')].reduce((a, c) => c.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? c : a)
    if (sc) sc.scrollTop = sc.scrollHeight
    return JSON.stringify({ order: cells.map(c => c.t), sizes: [...new Set(cells.map(c => c.fs))], gap: sc ? Math.round(sc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : null, marked: list.hasAttribute('data-kb-settings') })
  })()`))
  await sleep(400)
  if (shotsDir !== null) await page.shot(shotsDir + '/nav-bottom.png')
  check('About is the last tab, as drawn', m.order[m.order.length - 1] === 'About', m.order.slice(-4))
  check('every other tab sits before it (plugin pages included)', m.order.indexOf('About') === m.order.length - 1 && m.order.length > 10)
  check('there is room under the last tab (24px or more)', m.gap !== null && m.gap >= 24, m.gap)
  check('tab names are 13px, one notch under the shell\'s 14px', m.sizes.length === 1 && m.sizes[0] === 13, m.sizes)
  check('the list is marked as the Settings nav (the styles are scoped by it)', m.marked === true)
  const lang = m.order.indexOf('Language')
  check('Memory & Lessons still sits right under Language', lang >= 0 && m.order[lang + 1] === 'Memory & Lessons', m.order.slice(lang, lang + 3))
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
