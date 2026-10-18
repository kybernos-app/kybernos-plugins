#!/usr/bin/env node
// The face of the Workspaces and Agent Teams cards on the REAL GUI: a pale tile whose glyph keeps the project's colour, a still watermark that
// only shows on hover, a quiet foot (icon + number, the word on hover, the actions on the right), no line for an empty description.
//
//   node scripts/check-cardface-live.mjs [--shots <dir>]
//
// What is real: the DSH page and its Workspaces / Agent Teams pages. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away Chrome):
// the kybernos-plugin client, from this checkout instead of the shared tree. Nothing is written or clicked: pages are opened and a card is
// hovered. Host code is not involved (no restart needed).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or no cards on screen).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 10000)).val
const shot = async (name) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const r = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}
const move = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(450) }
const centre = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)

// One page of cards: the same promises for Workspaces and Agent Teams.
async function face (kind, sel, maxHeight) {
  const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  if (!n) { console.log('  ○ no ' + kind + ' card on screen: skipped'); return }
  await move(5, 5)
  const rest = await ev(`(() => {
    const cards = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const hex = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); return m ? m[1].split(/[ ,\\/]+/).filter(Boolean).slice(0, 3).map(Number) : null }
    const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx }
    const out = { n: cards.length, h: Math.max(...cards.map((c) => Math.round(c.getBoundingClientRect().height))), noFace: [], emptyLines: 0, outlines: [], tiles: [], bad: [] }
    for (const c of cards) {
      if (!c.classList.contains('kb8-cf') || !c.querySelector('.kb8-cf-foot') || !c.querySelector('.kb8-cf-wm') || c.querySelectorAll('.kb8-cf-st').length < 2) out.noFace.push(c.innerText.slice(0, 30))
      out.emptyLines += c.querySelectorAll('.kb8-none').length
      const t = c.querySelector('.kb8-cf-ic')
      if (t) { const cs = getComputedStyle(t); if (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) out.outlines.push(c.innerText.slice(0, 20)); out.tiles.push({ col: t.classList.contains('col'), glyph: hex(getComputedStyle(t).color), bg: hex(cs.backgroundColor) }) }
      const wm = c.querySelector('.kb8-cf-wm'); if (wm && getComputedStyle(wm).opacity !== '0') out.bad.push('watermark visible at rest')
      const a = c.querySelector('.kb8-cardacts'); if (a && getComputedStyle(a).opacity !== '0') out.bad.push('actions visible at rest')
    }
    const coloured = out.tiles.filter((t) => t.col && t.glyph)
    out.colouredCount = coloured.length
    out.glyphColourful = coloured.every((t) => sat(t.glyph) > 0.18)
    out.neutralOk = out.tiles.filter((t) => !t.col && t.bg).every((t) => Math.max(...t.bg) > 20)
    return out
  })()`)
  check(kind + ': every card has the new face (tile, watermark, foot with two figures)', rest.noFace.length === 0, rest.noFace)
  check(kind + ': a card is ' + maxHeight + ' px or less (it was 231 / 214)', rest.h <= maxHeight, rest.h)
  check(kind + ': no empty-description line (nothing is written when there is nothing to say)', rest.emptyLines === 0, rest.emptyLines)
  check(kind + ': the tile has no outline and no border', rest.outlines.length === 0, rest.outlines)
  if (rest.colouredCount > 0) check(kind + ': the glyph of a coloured project keeps a colour (never near-black)', rest.glyphColourful === true, rest.tiles)
  else console.log('  ○ no coloured ' + kind + ' here: the glyph colour is not measured')
  check(kind + ': a project without colour keeps a neutral grey tile, not a black one', rest.neutralOk === true, rest.tiles)
  check(kind + ': at rest the watermark and the actions are invisible', rest.bad.length === 0, rest.bad)

  // hover: the watermark appears, STILL; the word of a figure appears; the actions appear in the foot
  const c = await centre(sel)
  await move(c.x, c.y)
  const h1 = await ev(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); const w = c.querySelector('.kb8-cf-wm'); const a = c.querySelector('.kb8-cardacts'); const f = c.querySelector('.kb8-cf-foot').getBoundingClientRect(); const ar = a.getBoundingClientRect(); return { wm: getComputedStyle(w).opacity, t: getComputedStyle(w).transform, acts: getComputedStyle(a).opacity, inFoot: ar.top >= f.top - 1 && ar.bottom <= f.bottom + 1, right: ar.right <= c.getBoundingClientRect().right } })()`)
  await sleep(350)
  const h2 = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}).querySelector('.kb8-cf-wm')).transform`)
  check(kind + ': on hover the watermark appears', h1.wm === '1', h1)
  check(kind + ': and it does not move (same transform 350 ms later)', h1.t === h2, { a: h1.t, b: h2 })
  check(kind + ': the actions show on hover, inside the foot, on the right', h1.acts === '1' && h1.inFoot === true && h1.right === true, h1)
  const fig = await centre(sel + ' .kb8-cf-st')
  await move(fig.x, fig.y)
  const lbl = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)} + ' .kb8-cf-st .kb8-cf-lbl'); return { w: Math.round(e.getBoundingClientRect().width), op: getComputedStyle(e).opacity, text: e.textContent } })()`)
  check(kind + ': hovering a figure says its word', lbl.w > 20 && lbl.op === '1' && lbl.text.length > 2, lbl)
  const names = await ev(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' .kb8-cf-st')].every((s) => s.getAttribute('aria-label') && s.title)`)
  check(kind + ': every figure carries its word as a tooltip and an accessible name', names === true)
  await shot('cardface-' + kind.toLowerCase().replace(/\s+/g, '-'))
  await move(5, 5)
}

try {
  await page.send('Runtime.enable', {})
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  if (!swap.report().every((r) => r.replaced === true)) { console.error('○ not run: the served plugin text differs from the shared tree (uncommitted edits there?): ' + JSON.stringify(swap.report())); await live.close(); process.exit(3) }

  console.log('Workspaces')
  await clickText(page, 'Workspaces')
  await waitFor(page, `!!document.querySelector('[data-kb="project-card"]')`, 15000)
  await sleep(800)
  const ws = await ev(`document.querySelectorAll('[data-kb="project-card"]').length`)
  if (!ws) { console.error('○ not run: no Workspaces card on screen'); await live.close(); process.exit(3) }
  check('the toolbar (search, sort) is still there, untouched', (await ev(`!!document.querySelector('.kb6-toolbar')`)) === true)
  await face('Workspaces', '[data-kb="project-card"]', 140)
  const cnt = await ev(`[...document.querySelectorAll('[data-kb="project-counts"]')[0].querySelectorAll('.kb8-cf-n')].map((e) => e.textContent)`)
  check('the Workspaces counters are two plain numbers (the words wait for a hover), not a mono caps sentence', Array.isArray(cnt) && cnt.length === 2 && cnt.every((x) => /^\d+$/.test(x)), cnt)

  console.log('Agent Teams')
  await clickText(page, 'Agent Teams')
  await waitFor(page, `!!document.querySelector('[data-kb="kyber-card"]')`, 15000).catch(() => null)
  await sleep(800)
  await face('Agent Teams', '[data-kb="kyber-card"]', 150)
  const kyber = await ev(`(() => { const c = document.querySelector('[data-kb="kyber-card"]'); if (!c) return null; const host = c.querySelector('[data-kb="kyber-card-host"]'); return { host: !!host && (host.getAttribute('data-hosted') === 'yes' || host.getAttribute('data-hosted') === 'no'), noMission: /no mission declared|aucune mission/i.test(c.innerText), pills: c.querySelectorAll('.kb8-pill').length, count: c.querySelector('.kb8-cf-st .kb8-cf-n') ? c.querySelector('.kb8-cf-st .kb8-cf-n').textContent : null } })()`)
  if (kyber !== null) {
    check('Agent Teams: the hosting figure keeps its hook (kyber-card-host, data-hosted)', kyber.host === true, kyber)
    check('Agent Teams: no mission-declared placeholder, and no pill row left', kyber.noMission === false && kyber.pills === 0, kyber)
    check('Agent Teams: the first figure is the number of agents', /^\d+$/.test(String(kyber.count)), kyber)
  }
} catch (e) {
  failures.push('the check itself crashed: ' + e.message)
  console.log('  ✗ ' + e.message)
}
await live.close()
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)
