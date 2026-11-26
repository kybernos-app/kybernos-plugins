#!/usr/bin/env node
// The compact cards of Workspaces, Agent Teams and the Marketplace, and the Marketplace's hover actions, on a REAL GUI
// (audit 2026-10-16, V-15 and V-16).
//
//   source scripts/sandbox/env.sh && node scripts/check-cards-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's. Nothing is
// written: pages are opened and a card is hovered, never clicked (an Agent Teams card is only measured when one is already there).
//
// What it proves, at 1400 px unless it says otherwise:
//   - a Workspaces card is 140 px or less (it was 231) and four columns fit the page (they were three: 330 px columns);
//   - a Marketplace card is 150 px or less (it was 214) and carries no 43 px buttons at rest;
//   - Install and Preview are in the card's `.kb8-cardacts`: invisible and not clickable at rest, visible on hover and on keyboard focus,
//     and inside the card; the same container as the Agent Teams cards use;
//   - with no hover device (touch emulation at 800 px) and at 390 px they are visible and in the flow, inside the card;
//   - the page does not scroll sideways at 390 px.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }
if (shotDir !== null) mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shotDir !== null) await page.shot(join(shotDir, name + '.png')).catch(() => {}) }
const size = async (w, h, mobile = false) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  await sleep(700)
}
const press = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const move = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(450) }
const acts = (sel, i = 0) => ev(`(() => { const c = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!c) return null; const a = c.querySelector('.kb8-cardacts'); if (!a) return { noActs: true }; const r = c.getBoundingClientRect(); const ar = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { w: Math.round(r.width), h: Math.round(r.height), opacity: Number(cs.opacity), pe: cs.pointerEvents, pos: cs.position, inside: ar.left >= r.left - 1 && ar.right <= r.right + 1 && ar.top >= r.top - 1 && ar.bottom <= r.bottom + 1, btns: Array.from(a.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().height)) } })()`)
const centre = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 30 } })()`)
const drawerGo = async (label) => {
  await ev(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (b) b.click(); return !!b })()`)
  await sleep(900)
  const at = await ev(`(() => { const e = Array.from(document.querySelectorAll('[data-slot="sidebar"] button')).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2 }).find((x) => (x.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 } })()`)
  if (at === null || at.__err) return false
  await press(at.x, at.y)
  await sleep(2500)
  return true
}
const marketTab = async () => {
  const c = await ev(`(() => { const t = Array.from(document.querySelectorAll('.kb6-utab'))[1]; if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (c === null || c.__err) return false
  await press(c.x, c.y)
  await sleep(2500)
  return true
}

try {
  await sleep(3000)
  console.log('Workspaces (1400 px)')
  await clickText(page, 'Workspaces')
  await sleep(2500)
  const ws = await acts('[data-kb=project-card]')
  if (ws === null) console.log('  ○ no workspace in this instance: the Workspaces checks are skipped')
  else {
    check('a Workspaces card is 140 px or less (it was 231)', ws.h <= 140, ws)
    const cols = await ev(`getComputedStyle(document.querySelector('.kb8-grid')).gridTemplateColumns.split(' ').length`)
    check('four columns fit the page at 1400 px (they were three)', cols >= 4, cols)
    check('the counters are two small figures in the card\'s foot, not a pill row (the « Top-level project » line is gone; the face itself is measured by check-cardface-live.mjs)', (await ev(`(() => { const c = document.querySelector('[data-kb=project-card]'); return !!c.querySelector('.kb8-cf-foot [data-kb=project-counts]') && !/Top-level project/.test(c.innerText) && !c.querySelector('.kb8-pills') })()`)) === true)
    await move(5, 5)
    check('its actions are hidden at rest and not clickable', ws.opacity === 0 && ws.pe === 'none', ws)
    const c = await centre('[data-kb=project-card]')
    await move(c.x, c.y)
    const wsHover = await acts('[data-kb=project-card]')
    check('they show on hover, inside the card', wsHover.opacity === 1 && wsHover.pe === 'auto' && wsHover.inside === true, wsHover)
    await shot('cards-workspaces')
  }

  console.log('Agent Teams › Marketplace (1400 px)')
  await clickText(page, 'Agent Teams')
  await sleep(2500)
  const team = await acts('[data-kb=kyber-card]')
  if (team === null) console.log('  ○ no Agent Team installed in this instance: its card is not measured')
  else {
    check('an Agent Teams card is 150 px or less (it was 214-230)', team.h <= 150, team)
    check('its actions are hidden at rest', team.opacity === 0, team)
  }
  if ((await marketTab()) !== true) { console.error('○ inconclusive: the Marketplace tab did not open'); process.exit(3) }
  await move(5, 5)
  const m0 = await acts('[data-kb=market-card]')
  if (m0 === null || m0.noActs) { check('the Marketplace cards carry .kb8-cardacts', false, m0); throw new Error('stop') }
  check('a Marketplace card is 150 px or less (it was 214)', m0.h <= 150, m0)
  check('Install and Preview are no longer 43 px buttons: 30 px or less', m0.btns.length >= 1 && m0.btns.every((h) => h <= 30), m0.btns)
  check('at rest they are invisible and not clickable (the Agent Teams cards\' behaviour)', m0.opacity === 0 && m0.pe === 'none', m0)
  const mc = await centre('[data-kb=market-card]')
  await move(mc.x, mc.y)
  const m1 = await acts('[data-kb=market-card]')
  check('on hover they show, inside the card', m1.opacity === 1 && m1.pe === 'auto' && m1.inside === true, m1)
  await shot('cards-market-hover')
  await move(5, 5)
  await ev(`(() => { const b = document.querySelectorAll('[data-kb=market-card]')[1].querySelector('.kb8-chip'); b.focus(); return true })()`)
  await sleep(400)
  check('on keyboard focus (Tab to Preview) they show', (await ev(`(() => { const a = document.querySelectorAll('[data-kb=market-card]')[1].querySelector('.kb8-cardacts'); return getComputedStyle(a).opacity === '1' })()`)) === true)
  await ev(`document.activeElement.blur(); true`)
  const installed = await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb=market-card]')).find((x) => x.querySelector('[data-kb=market-installed]')); if (!c) return null; const a = c.querySelector('.kb8-cardacts'); const p = c.querySelector('[data-kb=market-installed]'); return { pillVisible: p.getBoundingClientRect().width > 0 && getComputedStyle(p).opacity === '1', installButton: !!a.querySelector('.kb8-primary') } })()`)
  if (installed === null) console.log('  ○ no template is installed in this instance: the « Installed » state is not measured')
  else check('an installed template shows its « Installed » figure at rest and no Install button', installed.pillVisible === true && installed.installButton === false, installed)

  console.log('No hover device (touch emulation, 800 px) and 390 px')
  for (const [w, label] of [[800, 'touch, 800 px'], [390, '390 px']]) {
    await size(w, 844, true)
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' })
    await page.send('Page.reload', {})
    await sleep(6000)
    if (w <= 700) { if (!(await drawerGo('Agent Teams'))) { console.log('  ○ the drawer did not offer Agent Teams'); continue } } else {
      // 800 px: the sidebar is the 44 px icon rail, with no text: the page's icon is found by its name (A5-30)
      const at = await ev(`(() => { const e = document.querySelector('.kb4-item[aria-label="Agent Teams"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      if (at === null || at.__err) { console.log('  ○ no icon named « Agent Teams » in the rail'); continue }
      await press(at.x, at.y)
      await sleep(2500)
    }
    if ((await marketTab()) !== true) { console.log('  ○ the Marketplace tab did not open at ' + label); continue }
    const t = await acts('[data-kb=market-card]')
    check(label + ': Install and Preview are visible, in the flow and inside the card', t !== null && t.opacity === 1 && t.pos === 'static' && t.inside === true, t)
    if (w <= 700) check(label + ': the page does not scroll sideways', (await ev(`document.documentElement.scrollWidth <= innerWidth`)) === true)
    await shot('cards-market-' + w)
  }
} catch (e) {
  if (String(e.message) !== 'stop') { fail += 1; console.log('  ✗ ' + e.message) }
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
