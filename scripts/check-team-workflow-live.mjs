#!/usr/bin/env node
// The Workflow tab of an Agent Team is drawn by the shared canvas (the one every graph uses), on the real GUI, in a throw-away signed-in Chrome.
//
//   node scripts/check-team-workflow-live.mjs [--shots <dir>]
//
// READ ONLY: it opens the first Agent Team whose Workflow tab has steps and writes nothing to the DSH. The browser half is this checkout's client.js (lib-bundle-swap.mjs);
// each scheme is forced in the throw-away page only (never through the app's theme toggle, which would save the person's theme).
// Exit code 0 / 1 / 3 (3 = inconclusive: no team of this DSH has a workflow to draw).
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
let code = 0
try {
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', {})
  await sleep(3500)
  check('this checkout\'s client is the one on the page', swap.report().every((r) => r.replaced === true), JSON.stringify(swap.report()))

  await clickText(page, 'Agent Teams')
  await waitFor(page, `document.querySelectorAll('[data-kb="kyber-card"], [data-kb="kyber-row"]').length > 0`, 12000)
  const count = Number(await q(`document.querySelectorAll('[data-kb="kyber-card"], [data-kb="kyber-row"]').length`)) || 0
  let found = false
  for (let i = 0; i < Math.min(count, 8) && !found; i += 1) {
    if (i > 0) { await clickText(page, 'Agent Teams'); await waitFor(page, `document.querySelectorAll('[data-kb="kyber-card"], [data-kb="kyber-row"]').length > 0`, 8000) }
    await q(`(() => { const e = document.querySelectorAll('[data-kb="kyber-card"], [data-kb="kyber-row"]')[${i}]; if (e) e.click() })()`)
    await sleep(900)
    await clickText(page, 'Workflow')
    found = (await waitFor(page, `document.querySelectorAll('[data-kb="flow-canvas"] .kbfc-nd').length > 0`, 6000)) === true
  }
  if (!found) { console.log('inconclusive: no Agent Team of this DSH has a workflow with steps'); code = 3 } else {
    const first = (await q(`document.documentElement.getAttribute('data-kb-theme')`)) === 'dark' ? 'dark' : 'light'
    const scheme = (dark) => q(`(() => { document.documentElement.setAttribute('data-kb-theme', ${JSON.stringify(dark ? 'dark' : 'light')}); if (${dark}) document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') })()`)
    const lum = (js) => q(`(() => { const lum = (c) => { const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); if (!m) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]) }; ${js} })()`)
    check('the steps are cards of the shared canvas (no React Flow on the page)', (await q(`document.querySelectorAll('.react-flow').length`)) === 0 && (await q(`document.querySelectorAll('[data-kb="flow-canvas"] .kbfc-nd').length`)) >= 1)
    check('the legend of the step kinds is under the graph', (await q(`document.querySelectorAll('[data-kb="flow-canvas"] ~ div .kbfc-k-ai, [data-kb="flow-canvas"] ~ div .kbfc-k-conn, [data-kb="flow-canvas"] ~ div .kbfc-k-act').length`)) >= 1)
    check('zoom in, zoom out are offered', (await q(`document.querySelectorAll('[data-kb="flow-zoom-in"], [data-kb="flow-zoom-out"]').length`)) === 2)
    await shot('team-workflow-' + first)
    const sel = await q(`(() => { const n = document.querySelector('[data-kb="flow-canvas"] .kbfc-nd'); if (!n) return false; n.click(); return true })()`)
    await sleep(500)
    check('a click on a step selects it', sel === true && (await q(`document.querySelectorAll('[data-kb="flow-canvas"] .kbfc-nd.sel').length`)) === 1)
    const before = await q(`(() => { const c = document.querySelector('[data-kb="flow-canvas"] .kbfc-vp'); return c ? c.getAttribute('style') : null })()`)
    await q(`document.querySelector('[data-kb="flow-zoom-in"]').click()`)
    await sleep(300)
    const after = await q(`(() => { const c = document.querySelector('[data-kb="flow-canvas"] .kbfc-vp'); return c ? c.getAttribute('style') : null })()`)
    check('zoom in changes the scale', before !== null && after !== null && before !== after, JSON.stringify([before, after]))
    check('« fit » puts the graph back to the size of the window', (await q(`(() => { const b = document.querySelector('[data-kb="flow-zoom-fit"]'); if (!b) return false; b.click(); return true })()`)) === true)
    await sleep(300)
    for (const dark of [true, false]) {
      await scheme(dark)
      await sleep(700)
      const name = dark ? 'dark' : 'light'
      const v = await lum(`const n = document.querySelector('[data-kb="flow-canvas"] .kbfc-nd'); if (!n) return null; const cs = getComputedStyle(n); const t = n.querySelector('.kbfc-tt'); return { bg: lum(cs.backgroundColor), ink: t ? lum(getComputedStyle(t).color) : null }`)
      check('in the ' + name + ' scheme a step is ' + name + ' and its title reads', v !== null && v !== undefined && v.bg !== null && v.ink !== null && (dark ? v.bg < 0.25 && v.ink > 0.4 : v.bg > 0.6 && v.ink < 0.3), JSON.stringify(v))
      await shot('team-workflow-' + name + '-forced')
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
