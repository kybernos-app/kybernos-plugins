#!/usr/bin/env node
// The Sessions tab of an automation reads a run as the chat's Journal (Story, Flow, Advanced), on the real GUI, in a throw-away signed-in Chrome.
//
//   node scripts/check-sessions-journal-live.mjs [--shots <dir>]
//
// READ ONLY: it opens the first automation of the person that has a run with a chat, presses Sessions, Flow, Advanced, Story and another run, and writes nothing to the DSH.
// The browser half is this checkout's client.js (lib-bundle-swap.mjs), so the page can be seen BEFORE the DSH is restarted on it; the host half (`/kybernos/journal`) is the
// running DSH's own. The dark scheme is set in the throw-away page only (never through the app's toggle, which would save the person's theme).
// Exit code 0 / 1 / 3 (3 = inconclusive: no automation with a run that has a chat).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { openLivePage, clickText, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const argv = process.argv.slice(2)
const shots = argv.indexOf('--shots') >= 0 ? resolve(argv[argv.indexOf('--shots') + 1]) : null
if (shots !== null) mkdirSync(shots, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }

const live = await openLivePage({ width: 1500, height: 1000 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shots !== null) await page.shot(resolve(shots, name + '.png')).catch(() => null) }
const click = (sel) => q(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const clickSeg = (label) => q(`(() => { const b = [...document.querySelectorAll('.wvs-embed .wvs-seg button, .wvs-classic.wvs-embed .wvs-seg button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
let code = 0
try {
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', {})
  await sleep(3500)
  const rep = swap.report()
  check('this checkout\'s client is the one on the page', rep.every((r) => r.replaced === true), JSON.stringify(rep))

  await clickText(page, 'Automations')
  await waitFor(page, `document.querySelectorAll('.kba-rowline .kba-name').length > 0`, 12000)
  const count = await q(`document.querySelectorAll('.kba-rowline .kba-name').length`)
  let found = false
  for (let i = 0; i < Math.min(Number(count) || 0, 10) && !found; i += 1) {
    if (i > 0) { await click('[data-kb="back-to-list"], .kba-crumb'); await sleep(600) }
    await q(`(() => { const n = document.querySelectorAll('.kba-rowline .kba-name')[${i}]; if (n) n.click() })()`)
    await sleep(900)
    await click('[data-kb="tab-sessions"]')
    found = (await waitFor(page, `!!document.querySelector('[data-kb="runs-sessions"] .wvs-embed')`, 6000)) === true
  }
  if (!found) { console.log('inconclusive: no automation of this DSH has a run with a readable chat'); code = 3 } else {
    console.log('\n── Story (the default) ──')
    await sleep(1500)
    // The person's own scheme first, then each one forced in the throw-away page only.
    const first = (await q(`document.documentElement.getAttribute('data-kb-theme')`)) === 'dark' ? 'dark' : 'light'
    const scheme = (dark) => q(`(() => { document.documentElement.setAttribute('data-kb-theme', ${JSON.stringify(dark ? 'dark' : 'light')}); if (${dark}) document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') })()`)
    const panel = () => q(`(() => { const lum = (c) => { const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); if (!m) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]) }; const p = document.querySelector('[data-kb="runs-sessions"] .wv2-panel'); if (!p) return null; const cs = getComputedStyle(p); return { bg: lum(cs.backgroundColor), ink: lum(cs.color) } })()`)
    check('the run is read as the Journal, inside the Sessions pane', (await q(`document.querySelectorAll('[data-kb="runs-sessions"] .wvs-embed').length`)) >= 1)
    check('no big « Journal » title, and the chat\'s input bar is left alone', (await q(`document.querySelectorAll('[data-kb="runs-sessions"] .wv2-h1').length`)) === 0 && (await q(`document.documentElement.classList.contains('wv2-actif')`)) === false)
    check('Story, Flow and Advanced are offered', (await q(`[...document.querySelectorAll('[data-kb="runs-sessions"] .wvs-seg button')].map((b) => b.textContent.trim()).join('|')`)) === 'Story|Flow|Advanced')
    check('the story of the run is there (or says it is empty)', (await waitFor(page, `!!document.querySelector('[data-kb="runs-sessions"] [data-kb="wvs-feed"], [data-kb="runs-sessions"] [data-kb="wvs-empty"]')`, 8000)) === true)
    check('the runs list and the lessons stay with the automation', (await q(`document.querySelectorAll('[data-kb="runs-list"] [data-kb="run-row"]').length`)) >= 1)
    check('no horizontal scroll in the pane', (await q(`(() => { const e = document.querySelector('[data-kb="runs-sessions"]'); return e.scrollWidth <= e.clientWidth + 1 })()`)) === true)
    await shot('sessions-story-' + first)

    console.log('\n── Flow ──')
    check('Flow opens the flow of the run', (await clickSeg('Flow')) === true && (await waitFor(page, `!!document.querySelector('[data-kb="runs-sessions"] .wvs-fstage')`, 6000)) === true)
    await shot('sessions-flow-' + first)

    console.log('\n── Advanced ──')
    check('Advanced is this pane\'s own view: the graph, with the runs\' cards under it', (await clickSeg('Advanced')) === true && (await waitFor(page, `!!document.querySelector('[data-kb="runs-sessions"] [data-kb="flow-canvas"]')`, 6000)) === true)
    await shot('sessions-advanced-' + first)

    console.log('\n── Another run ──')
    const rows = await q(`document.querySelectorAll('[data-kb="runs-list"] [data-kb="run-row"]').length`)
    if (rows >= 2) {
      await clickSeg('Story')
      const before = await q(`(document.querySelector('[data-kb="runs-sessions"] .wvs-chip.btn') || {}).textContent || ''`)
      await click('[data-kb="runs-list"] [data-kb="run-row"]:nth-of-type(2)')
      await sleep(2500)
      const after = await q(`(document.querySelector('[data-kb="runs-sessions"] .wvs-chip.btn') || {}).textContent || ''`)
      check('another run opens its own Journal (the chat id changes)', before !== '' && after !== '' && before !== after, JSON.stringify([before, after]))
    } else console.log('skip  only one run: the switch is not checked')

    console.log('\n── Both schemes ──')
    await clickSeg('Story')
    for (const dark of [true, false]) {
      await scheme(dark)
      await sleep(900)
      const name = dark ? 'dark' : 'light'
      const v = await panel()
      check('in the ' + name + ' scheme the Journal\'s panels are ' + name + ' and their ink reads', v !== null && (dark ? v.bg < 0.2 && v.ink > 0.4 : v.bg > 0.7 && v.ink < 0.25), JSON.stringify(v))
      await shot('sessions-story-' + name + '-forced')
      await clickSeg('Flow'); await sleep(900); await shot('sessions-flow-' + name + '-forced')
      await clickSeg('Story')
    }
  }
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  await live.close()
}
if (code === 3) process.exit(3)
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
