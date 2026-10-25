#!/usr/bin/env node
// One frame for the pages of Settings (UX audit 2026-10-20): switching page must not move the title. Every page's box starts at x 272 and is
// 720 px wide (the three wide pages say so), and its title sits at y 54, give or take the 3 px of a help button taller than the title
// it shares a row with. Measured on the real GUI, for the title of every page of the menu.
//
//   node scripts/check-settings-frame-live.mjs [--worktree] [--width 1400]
//
// --worktree: serve this checkout's clients in the throw-away browser (scripts/lib-bundle-swap.mjs), so a change is checked before it is
// merged. READ-ONLY: it opens each page and measures; nothing is pressed, saved or installed. Exit code 0 / 1 / 3 (GUI down).
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const args = process.argv.slice(2)
const WIDTH = args.indexOf('--width') >= 0 ? Number(args[args.indexOf('--width') + 1]) : 1400
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
// Wide by design: a map, a provider grid, a card grid of modules.
const WIDE = new Set(['Atlas', 'AI provider and models', 'Kybernos Suite'])
// The title of this page follows a 44 px icon, the icon starts at the frame's left edge.
const AFTER_ICON = new Set(['Phone and channels'])
// DSH's own page (its title is the engine's, not ours) and a page whose title is not a heading.
const SKIP = new Set(['IM bots', 'Connectors'])
const BUNDLES = ['kybernos-hub', 'kybernos-usage', 'kybernos-modeles-locaux', 'kybernos-free-llms', 'kybernos-mobile', 'kybernos-plugin', 'kybernos-sessions', 'kybernos-skills', 'kybernos-slash', 'kybernos-theme', 'kybernos-kaby-customisation']

const live = await openLivePage({ width: WIDTH, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 20000)).val
try {
  if (args.includes('--worktree')) {
    const swap = await swapBundles(page, BUNDLES.map((name) => ({ name })))
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(6000)
    if (swap.report().some((r) => r.replaced !== true)) console.log('○ a served client is not the checked-out one: running on what is deployed for it')
  }
  await sleep(2500)
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  await sleep(1200)
  const cells = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map((b) => (b.innerText || '').trim().split('\\n')[0]))`))
  check('the menu lists the pages', cells.length >= 25, cells.length)
  const rows = []
  for (const c of cells) {
    if ((await goToSettingsPage(page, c, { settleMs: 1300 })) !== true) { check('page « ' + c + ' » opens', false); continue }
    await sleep(800)
    const r = JSON.parse(await ev(`JSON.stringify((() => {
      const nav = document.querySelector('button[class*="navCell"]'); const nr = nav.closest('nav, [class*="nav"]').getBoundingClientRect()
      let root = nav; while (root && root.parentElement && !(root.getAttribute('role') === 'dialog' || /panel/i.test(root.className.toString()))) root = root.parentElement
      const els = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.left >= nr.right - 1 && r.width > 0 && r.height > 0 && r.top > 30 && r.top < 260 })
      const big = els.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 1) && parseFloat(getComputedStyle(e).fontSize) >= 17).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]
      const box = els.filter((e) => Math.round(e.getBoundingClientRect().left) === 272).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      return { x: big ? Math.round(big.getBoundingClientRect().left) : null, y: big ? Math.round(big.getBoundingClientRect().top) : null, boxX: box ? Math.round(box.getBoundingClientRect().left) : null, boxW: box ? Math.round(box.getBoundingClientRect().width) : null }
    })())`))
    rows.push([c, r])
  }
  const measured = rows.filter(([c, r]) => !SKIP.has(c) && r.x !== null)
  check('a title is found on most pages', measured.length >= 24, measured.length)
  const offX = measured.filter(([c, r]) => !AFTER_ICON.has(c) && r.x !== 272)
  check('every title starts at x 272', offX.length === 0, offX.map(([c, r]) => c + ' x ' + r.x))
  const offIcon = measured.filter(([c, r]) => AFTER_ICON.has(c) && r.x !== 328)
  check('a title after the 44 px icon starts at x 328 (the icon at 272)', offIcon.length === 0, offIcon.map(([c, r]) => c + ' x ' + r.x))
  const offY = measured.filter(([c, r]) => r.y < 54 || r.y > 57)
  check('every title sits at y 54, or up to 57 beside a taller help button', offY.length === 0, offY.map(([c, r]) => c + ' y ' + r.y))
  const offBox = rows.filter(([c, r]) => !SKIP.has(c) && r.boxX !== null && r.boxX !== 272)
  check('every page box starts at x 272', offBox.length === 0, offBox.map(([c, r]) => c + ' ' + r.boxX))
  const offW = rows.filter(([c, r]) => !SKIP.has(c) && r.boxW !== null && (WIDE.has(c) ? r.boxW <= 720 : r.boxW !== 720))
  check('every page box is 720 px wide, the three wide pages are wider', offW.length === 0, offW.map(([c, r]) => c + ' w ' + r.boxW))
} finally { await live.close() }
console.log(fail === 0 ? '\nOK' : '\n' + fail + ' check(s) failed')
process.exit(fail === 0 ? 0 : 1)
