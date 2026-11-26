#!/usr/bin/env node
// Creations › Customize (« Choose which items appear »), on the real GUI, in a throw-away signed-in Chrome: the tiles the person hides are still hidden after a reload.
// Regression (2026-11-06): the choice was saved (`vis` + `visMode: 'hidden'`) but read back without its mode, as an old « shown » list, so it came back inverted.
//
//   node scripts/check-creations-filter-choice-live.mjs
//
// READ ONLY for the DSH: the choice is made in the throw-away browser's own localStorage and goes with it. The browser half is this checkout's client.js (lib-bundle-swap.mjs).
// Exit code 0 / 1.
import { openLivePage, clickText, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const live = await openLivePage({ width: 1500, height: 1000 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
// The toolbar entry of the Creations page is the one that carries the tile choice (`vis`).
const SAVED = `(() => { for (const k of Object.keys(localStorage)) { if (k.indexOf('kybernos.toolbar.') !== 0) continue; try { const j = JSON.parse(localStorage.getItem(k)); if (j && Array.isArray(j.vis)) return j } catch (e) {} } return null })()`
const PANEL = `(() => [...document.querySelectorAll('[data-kb="type-panel"] .kb-typepanel-row')].map((r) => (r.querySelector('input').checked ? '+' : '-') + r.querySelector('.kb-typepanel-lab').textContent.trim()).join(' '))()`
const openPanel = async () => {
  await clickText(page, 'Creations')
  await waitFor(page, `!!document.querySelector('[data-kb="type-customize"]')`, 20000)
  await q(`document.querySelector('[data-kb="type-customize"]').click()`)
  await waitFor(page, `!!document.querySelector('[data-kb="type-panel"] .kb-typepanel-row')`, 8000)
}
try {
  // The interception sometimes misses the very first load on a busy machine: ask again before judging.
  let swap = null
  for (let i = 0; i < 3; i += 1) { swap = await swapBundles(page, [{ name: 'kybernos-plugin' }]); await page.send('Page.reload', {}); await sleep(3500); if (swap.report().every((r) => r.replaced === true)) break }
  check('this checkout\'s client is the one on the page', swap.report().every((r) => r.replaced === true), JSON.stringify(swap.report()))
  await openPanel()
  const start = String(await q(PANEL))
  check('the panel lists the families and the types', start.split(' ').length >= 10, start)
  await q(`(() => { const rows = [...document.querySelectorAll('[data-kb="type-panel"] .kb-typepanel-row input')]; rows[0].click(); rows[1].click() })()`)
  await sleep(500)
  const chosen = String(await q(PANEL))
  check('the first two rows were flipped', chosen !== start, chosen)
  const stored = await q(SAVED)
  const storedView = stored === null ? null : { mode: stored.visMode, n: stored.vis.length }
  check('the choice is saved as a list of hidden tiles', storedView !== null && storedView.mode === 'hidden', JSON.stringify(storedView))
  await page.send('Page.reload', {})
  await sleep(3500)
  await openPanel()
  const back = String(await q(PANEL))
  check('after a reload the same tiles are shown and hidden', back === chosen, JSON.stringify({ chosen, back }))
  await q(`document.querySelector('[data-kb="type-panel-done"]').click()`)
  await sleep(300)
  const again = await q(SAVED)
  check('closing the panel and using the page keeps the mode of the saved list', again !== null && again.visMode === 'hidden' && again.vis.length === stored.vis.length, JSON.stringify(again))
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
