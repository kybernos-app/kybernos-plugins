#!/usr/bin/env node
// Connectors › Yours, on the real GUI, in a throw-away signed-in Chrome: a first visit shows skeleton cards (never « no app connected » before the host and the
// cloud half have answered), and the next visit draws the list kept last time at once, then refreshes behind it.
//
//   node scripts/check-connectors-yours-live.mjs
//
// READ ONLY: it opens the page and reads it; it connects nothing and changes nothing in the DSH. The browser half is this checkout's client.js (lib-bundle-swap.mjs).
// Exit code 0 / 1.
import { openLivePage, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }

const live = await openLivePage({ width: 1500, height: 900 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
// What the Yours panel shows right now: skeleton cards, app cards (own or Kybernos rows), the « nothing connected » box.
const NOW = `(() => ({ skel: document.querySelectorAll('.kb-sk-row').length, cards: document.querySelectorAll('.kb7-panel .kb7-card:not(.kb-sk-row)').length + document.querySelectorAll('.kbcp-mlist > *').length, empty: !!document.querySelector('.kb7-panel .kb7-emptybox'), tab: !!document.querySelector('[data-kb="subtab-yours"]') }))()`
// The first paint: sampled every 8 ms for 160 ms after the page was opened; gives what the very first frames showed.
const firstFrames = async () => {
  const seen = []
  for (let i = 0; i < 20; i += 1) { const v = await q(NOW); if (v !== null && v.tab === true) seen.push(v); await sleep(8) }
  return seen
}
const settled = async () => {
  for (let i = 0; i < 60; i += 1) { const v = await q(NOW); if (v !== null && v.tab === true && v.skel === 0 && (v.cards > 0 || v.empty === true)) return v; await sleep(200) }
  return await q(NOW)
}
try {
  const swap = await swapBundles(page, [{ name: 'kybernos-composio' }])
  await page.send('Page.reload', {})
  await sleep(3500)
  check('this checkout\'s client is the one on the page', swap.report().every((r) => r.replaced === true), JSON.stringify(swap.report()))
  await q(`try { localStorage.removeItem('kbcp.yours.v1') } catch (e) {}`)

  await clickText(page, 'Connectors')
  const first = await firstFrames()
  check('first visit: the first frames are skeleton cards, never an empty list', first.length > 0 && first[0].skel > 0 && first.every((v) => v.empty === false || v.skel > 0), JSON.stringify(first.slice(0, 3)))
  const done1 = await settled()
  check('first visit: it settles on the list, or on « nothing connected » when that is true', done1 !== null && done1.skel === 0 && (done1.cards > 0 || done1.empty === true), JSON.stringify(done1))
  await sleep(600)
  const kept = await q(`(() => { try { const j = JSON.parse(localStorage.getItem('kbcp.yours.v1') || 'null'); return j === null ? null : { v: j.v, conns: Object.keys(j.conns || {}).length, kc: j.kc === null ? null : j.kc.offered } } catch (e) { return 'unreadable' } })()`)
  check('the list is kept for the next visit', kept !== null && kept !== 'unreadable' && kept.v === 1, JSON.stringify(kept))

  await page.send('Page.reload', {})
  await sleep(3500)
  await clickText(page, 'Connectors')
  const second = await firstFrames()
  check('next visit: no skeleton and no blank list on the first frames', second.length > 0 && second.every((v) => v.skel === 0), JSON.stringify(second.slice(0, 3)))
  if (done1 !== null && done1.cards > 0) check('next visit: the kept list is already there on the first frame', second.length > 0 && second[0].cards > 0 && second[0].empty === false, JSON.stringify(second.slice(0, 3)))
  else console.log('skip  nothing was connected on the first visit: no list to keep and draw')
  const done2 = await settled()
  check('next visit: the refresh behind it ends on the same kind of answer', done2 !== null && done2.skel === 0 && ((done1.cards > 0) === (done2.cards > 0)), JSON.stringify([done1, done2]))
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
