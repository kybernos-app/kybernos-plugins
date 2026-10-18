#!/usr/bin/env node
// Checks the main menu (sidebar) against the REAL GUI: it wastes no room, and its text follows the chat's text size (General › Font size, 12 to 17 px,
// which the engine keeps in --dsh-content-font-size on <body>).
//
//   node scripts/check-menu-density-live.mjs [--worktree] [--shots <dir>]
//
// --worktree: serve this checkout's core and cloud plugin clients in the throw-away browser (scripts/lib-bundle-swap.mjs), so a change is checked
// before it is merged. Without it the check runs on what `dsh web` serves.
// READ-ONLY: it measures, and changes the size variable on the throw-away page (nothing of your DSH changes). Exit code: 0 all green, 1 a check
// failed, 3 inconclusive (GUI down).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'
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
const MEASURE = `(() => {
  const h = (sel) => { const e = document.querySelector(sel); return e === null ? null : Math.round(e.getBoundingClientRect().height * 10) / 10 }
  const item = document.querySelector('.kb4-item')
  const room = document.querySelector('[class*="_footArea"]')
  const rows = [...document.querySelectorAll('[class*="_regionArea"] [data-row-key], [class*="_regionArea"] [class*="_rows"] [class*="_row"]')] // pinned rows, workspaces and sessions
  return JSON.stringify({
    fs: parseFloat(getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size')) || null,
    itemFs: item === null ? null : parseFloat(getComputedStyle(item).fontSize),
    first: item === null ? null : Math.round(item.getBoundingClientRect().top),
    logo: h('[class*="_logoRow"]'), newChat: h('.kb4-split'), item: h('.kb4-item'), project: h('[class*="_projectRow"]'), session: h('[class*="_sessionRow"]'), card: h('.kbfp-card'),
    titleFs: (() => { const t = document.querySelector('[class*="_projectRow"] [class*="_title"]'); return t === null ? null : parseFloat(getComputedStyle(t).fontSize) })(),
    seen: room === null ? null : rows.filter((e) => e.getBoundingClientRect().bottom <= room.getBoundingClientRect().top).length,
    bar: (() => { const m = document.querySelector('.kb4-menu'); return m === null ? null : m.scrollWidth <= m.clientWidth + 1 })()
  })
})()`
const measure = async () => JSON.parse(await ev(MEASURE))

try {
  if (args.indexOf('--worktree') >= 0) { const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }, { name: 'kybernos-cloud' }]); await page.send('Page.reload', { ignoreCache: true }); await sleep(4000); if (swap.report().some((r) => r.replaced !== true)) console.log('○ a served client is not the checked-out one: running on what is deployed for it') }
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 20000)
  await sleep(2500)
  let m = await measure()
  if (m.item === null) { console.error('○ inconclusive: the menu is not on the page'); process.exit(3) }
  const base = m.fs
  console.log('at the chat size of the day (' + String(base) + 'px)')
  check('the menu text is the chat text size, not a fixed 15px', m.itemFs === base && m.titleFs === base, { chat: base, menu: m.itemFs, workspaces: m.titleFs })
  check('a row of the menu is about 2.2 text heights, not 34px', m.item <= base * 2.4 && m.item >= base * 2, m.item)
  check('the logo row is three text heights or so, not 60px', m.logo <= base * 3.4, m.logo)
  check('New chat is one line, not 46px', m.newChat <= base * 3.2, m.newChat)
  check('the first entry of the menu starts within 8 text heights of the top (it was 126px at 13px)', m.first <= base * 8, m.first)
  check('a workspace row and a session row are tighter than the shell\'s 34 and 32px', m.project <= base * 2.5 && m.session <= base * 2.3, [m.project, m.session])
  check('more of the workspace list shows without scrolling (11 of 21 rows at 13px, 8 before)', m.seen >= 10 || base !== 13, m.seen)
  check('nothing scrolls sideways in the menu', m.bar === true)
  if (shotsDir !== null) await page.shot(shotsDir + '/menu-' + String(base) + '.png')

  for (const px of [12, 17]) {
    await ev(`document.body.style.setProperty('--dsh-content-font-size', '${px}px')`)
    await sleep(500)
    m = await measure()
    console.log('at ' + String(px) + 'px (the setting changed)')
    check('the menu text follows at once: ' + String(px) + 'px', m.itemFs === px && m.titleFs === px, { menu: m.itemFs, workspaces: m.titleFs })
    check('the rows follow in height (2.2 text heights)', Math.abs(m.item - px * 2.25) <= 2.5, m.item)
    check('the account card follows', m.card !== null && m.card <= px * 5.2 && m.card >= px * 3.6, m.card)
    if (shotsDir !== null) await page.shot(shotsDir + '/menu-' + String(px) + '.png')
  }
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
