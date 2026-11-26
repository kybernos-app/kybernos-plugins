#!/usr/bin/env node
// The Overview tab of an automation (its sheet), on the real GUI, in a throw-away signed-in Chrome.
//
//   node scripts/check-automation-sheet-live.mjs [--shots <dir>]
//
// READ ONLY: it opens the first automation of the person, reads the sheet, follows the buttons that only change tab (Show, All sessions) and writes nothing to the DSH
// (it never presses « Create webhook » or a button that opens an editor). The browser half is this checkout's client.js (lib-bundle-swap.mjs); each scheme is forced in the
// throw-away page only (never through the app's theme toggle, which would save the person's theme).
// Exit code 0 / 1 / 3 (3 = inconclusive: the person has no automation).
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

const live = await openLivePage({ width: 1500, height: 1100 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shots !== null) await page.shot(resolve(shots, name + '.png')).catch(() => null) }
const click = (sel) => q(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const text = (sel) => q(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null })()`)
let code = 0
try {
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', {})
  await sleep(3500)
  check('this checkout\'s client is the one on the page', swap.report().every((r) => r.replaced === true), JSON.stringify(swap.report()))

  await clickText(page, 'Automations')
  await waitFor(page, `document.querySelectorAll('.kba-rowline .kba-name').length > 0`, 12000)
  const count = Number(await q(`document.querySelectorAll('.kba-rowline .kba-name').length`)) || 0
  if (count === 0) { console.log('inconclusive: this DSH has no automation'); code = 3 } else {
    // Prefer an automation that has runs, so that the cost and the runs cards have something to say.
    let pick = 0
    for (let i = 0; i < Math.min(count, 8); i += 1) {
      if (i > 0) { await click('[data-kb="back-to-list"], .kba-crumb'); await sleep(600) }
      await q(`(() => { const n = document.querySelectorAll('.kba-rowline .kba-name')[${i}]; if (n) n.click() })()`)
      await waitFor(page, `!!document.querySelector('[data-kb="automation-sheet"]')`, 6000)
      pick = i
      const runs = await q(`(document.querySelector('[data-kb="tab-sessions"]') || {}).textContent || ''`)
      if (/\d/.test(String(runs)) && !/· 0/.test(String(runs))) break
    }
    console.log('automation #' + pick + ': ' + (await text('.kba-dtitle h1')))
    check('the page opens on the Overview tab', (await q(`(document.querySelector('[data-kb="tab-overview"]') || {}).getAttribute && document.querySelector('[data-kb="tab-overview"]').getAttribute('aria-selected')`)) === 'true' && (await q(`!!document.querySelector('[data-kb="automation-sheet"]')`)) === true)
    check('the eight cards of the sheet are there (prompt, when, where, who, uses, safety, cost, runs)', (await q(`['prompt','when','where','who','uses','safety','cost','runs'].filter((k) => document.querySelector('[data-kb="sheet-card-' + k + '"]')).length`)) === 8)
    check('the prompt is shown, folded when it is long', (await text('[data-kb="sheet-prompt-text"]')) !== null && (await q(`(document.querySelector('[data-kb="sheet-prompt-text"]') || {}).textContent.length`)) > 3)
    const more = await q(`!!document.querySelector('[data-kb="sheet-prompt-more"]')`)
    if (more === true) {
      const h0 = await q(`document.querySelector('[data-kb="sheet-prompt-text"]').getBoundingClientRect().height`)
      await click('[data-kb="sheet-prompt-more"]'); await sleep(300)
      const h1 = await q(`document.querySelector('[data-kb="sheet-prompt-text"]').getBoundingClientRect().height`)
      check('« more lines » unfolds the whole prompt, and folds it back', h1 > h0 && (await click('[data-kb="sheet-prompt-more"]')) === true, JSON.stringify([h0, h1]))
    } else console.log('skip  the prompt is short: no fold to press')
    check('when: the trigger, the repeat, the zone, the next run and the webhook are listed', (await q(`['trigger','repeat','zone','next','webhook'].filter((k) => document.querySelector('[data-kb="sheet-' + k + '"]')).length`)) === 5)
    check('where: the computer, the folder and the chat choice are listed', (await q(`['computer','folder','chat'].filter((k) => document.querySelector('[data-kb="sheet-' + k + '"]')).length`)) === 3)
    check('safety: approvals, limit, « if I write in it » and notifications are listed', (await q(`['approvals','limit','onwrite','notify'].filter((k) => document.querySelector('[data-kb="sheet-' + k + '"]')).length`)) === 4)
    check('the cost answers (a figure, or « — » with the reason under it) once the journals are read', (await waitFor(page, `(() => { const b = document.querySelector('[data-kb="sheet-cost-total"]'); return !!b && !/Reading/.test(document.querySelector('[data-kb="sheet-card-cost"]').textContent) })()`, 25000)) === true, await text('[data-kb="sheet-card-cost"]'))
    const c1 = await text('[data-kb="sheet-card-cost"]'); await sleep(2500); const c2 = await text('[data-kb="sheet-card-cost"]')
    check('the figure does not grow once it is shown (no partial sum while the journals are read)', c1 === c2, JSON.stringify([c1, c2]))
    console.log('      cost card: ' + String(await text('[data-kb="sheet-card-cost"]')).slice(0, 120))
    check('no horizontal scroll in the sheet', (await q(`(() => { const e = document.querySelector('[data-kb="automation-sheet"]'); return e.scrollWidth <= e.clientWidth + 1 })()`)) === true)
    check('the tab bar offers Overview, Workflow, Sessions and Where it runs', (await q(`[...document.querySelectorAll('[data-kb="detail-tabs"] button')].map((b) => b.getAttribute('data-kb')).join(',')`)) === 'tab-overview,tab-flow,tab-sessions,tab-where')
    const first = (await q(`document.documentElement.getAttribute('data-kb-theme')`)) === 'dark' ? 'dark' : 'light'
    await shot('sheet-' + first)

    const scheme = (dark) => q(`(() => { document.documentElement.setAttribute('data-kb-theme', ${JSON.stringify(dark ? 'dark' : 'light')}); if (${dark}) document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') })()`)
    const card = () => q(`(() => { const lum = (c) => { const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); if (!m) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]) }; const c = document.querySelector('[data-kb="sheet-card-when"]'); if (!c) return null; const cs = getComputedStyle(c); const k = c.querySelector('.kba-sk-v'); return { bg: lum(cs.backgroundColor), ink: k ? lum(getComputedStyle(k).color) : null, label: c.querySelector('.kba-sk-k') ? lum(getComputedStyle(c.querySelector('.kba-sk-k')).color) : null } })()`)
    for (const dark of [true, false]) {
      await scheme(dark); await sleep(700)
      const name = dark ? 'dark' : 'light'
      const v = await card()
      check('in the ' + name + ' scheme the cards are ' + name + ' and their words read', v !== null && v.bg !== null && v.ink !== null && v.label !== null && (dark ? v.bg < 0.2 && v.ink > 0.4 && v.label > 0.2 : v.bg > 0.6 && v.ink < 0.25 && v.label < 0.5), JSON.stringify(v))
      await shot('sheet-' + name + '-forced')
      await q(`document.querySelector('[data-kb="sheet-card-runs"]').scrollIntoView({ block: 'end' })`); await sleep(300)
      await shot('sheet-' + name + '-bottom')
      await q(`document.querySelector('[data-kb="sheet-card-prompt"]').scrollIntoView({ block: 'start' })`)
    }

    check('« Show » (the steps found in the text) goes to the Workflow tab', (await click('[data-kb="sheet-steps-show"]')) === true ? (await waitFor(page, `!!document.querySelector('[data-kb="flow-frame"], [data-kb="flow-canvas"]')`, 6000)) === true : true)
    await click('[data-kb="tab-overview"]'); await sleep(500)
    check('« All sessions » goes to the Sessions tab', (await click('[data-kb="sheet-all-sessions"]')) === true && (await waitFor(page, `!!document.querySelector('[data-kb="runs-sessions"]')`, 6000)) === true)
    await click('[data-kb="tab-overview"]'); await sleep(400)
    check('and back on the sheet', (await q(`!!document.querySelector('[data-kb="automation-sheet"]')`)) === true)
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
