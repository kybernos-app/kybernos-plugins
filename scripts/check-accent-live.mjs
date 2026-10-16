#!/usr/bin/env node
// Does a theme preset recolour the Suite and Workers pages? (audit A1-01)
//
//   source scripts/sandbox/env.sh && node scripts/check-accent-live.mjs [--shots <dir>]
//
// The Suite and Workers drew their switches, kicker lines, active-tab border and accent buttons in a literal orange (#ff7a1a), so « Neutral
// violet » left them orange next to violet Connectors buttons. This check picks the preset on the Theme page, opens Settings › Kybernos Suite
// and Settings › Workers, and compares the computed colour of each accent control with the theme's brand token (--dsw-alias-brand-primary,
// resolved by the browser). It then does the same with « DSH default ». It reads and clicks nothing that installs, saves or sends: it only
// changes the THEME of the instance it is pointed at, so it refuses :3080. Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check changes the theme; use a sandbox instance (KB_HOST), not :3080.'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
/** Real click on the first visible element matching `css` whose text starts with `text`. */
const press = async (css, text) => {
  const at = await val(`(() => { const e = Array.from(document.querySelectorAll(${JSON.stringify(css)})).find((x) => x.getBoundingClientRect().width > 4 && (x.innerText || '').trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!at) return false
  await click(at.x, at.y)
  return true
}
const cell = (name) => press('button[class*="navCell"]', name)

/** The browser's own rgb() for the brand token, and the computed colours of the accent controls on the open page. */
const READ = `(() => {
  const probe = document.createElement('i'); probe.style.cssText = 'position:fixed;left:-99px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)'
  document.body.appendChild(probe); const brand = getComputedStyle(probe).backgroundColor; probe.remove()
  const one = (sel, prop) => { const e = document.querySelector(sel); return e === null ? null : getComputedStyle(e)[prop] }
  return JSON.stringify({ brand,
    suite: { sw: one('.kbsu-sw.on', 'backgroundColor'), tabBorder: one('.kbsu-tabs button[aria-selected="true"]', 'borderBottomColor'), tag: one('.kbsu-tag', 'color'), accent: one('.kbsu-btn.accent', 'backgroundColor') },
    workers: { sw: one('.kbwk-sw.on', 'backgroundColor'), accent: one('.kbwk-btn.accent', 'backgroundColor'), prog: one('.kbwk-prog i', 'backgroundColor'), cur: one('.kbwk-todo>li.cur .kbwk-n', 'backgroundColor') } })
})()`
const ORANGE = 'rgb(255, 122, 26)'

try {
  await sleep(2500)
  check('Settings open', await openSettings(page, { tries: 4 }))
  for (const skin of ['Neutral violet', 'DSH default']) {
    console.log('— ' + skin)
    check('the Theme page opens', await cell('Theme') && (await waitFor(page, `document.querySelector('.kbth-skin') !== null`, 10000)) !== null)
    check('the preset is picked', await press('.kbth-skin', skin))
    await sleep(1500)
    check('the Suite page opens', await cell('Kybernos Suite') && (await waitFor(page, `document.querySelector('[data-kb="suite-card"] .kbsu-sw.on') !== null`, 15000)) !== null)
    // the kicker line is on the featured cards
    check('the Featured tab opens', await press('button', 'Featured') && (await waitFor(page, `document.querySelector('.kbsu-tag') !== null`, 8000)) !== null)
    await sleep(600)
    const suite = JSON.parse(await val(READ))
    await shot('suite-' + skin.replace(/\W+/g, '-').toLowerCase())
    // the selected tab lives in a module's detail drawer
    check('a module detail opens', await press('[data-kb="suite-fiche-btn"]', 'Details') && (await waitFor(page, `document.querySelector('.kbsu-tabs') !== null`, 8000)) !== null)
    suite.suite.tabBorder = JSON.parse(await val(READ)).suite.tabBorder
    await shot('suite-detail-' + skin.replace(/\W+/g, '-').toLowerCase())
    check('a module switch is ON and carries the brand token', suite.suite.sw === suite.brand, suite)
    check('the selected tab underline carries the brand token', suite.suite.tabBorder === suite.brand, suite)
    check('a kicker line is drawn and is not the literal orange', suite.suite.tag !== null && suite.suite.tag !== ORANGE, suite)
    if (suite.suite.accent !== null) check('the accent button carries the brand token', suite.suite.accent === suite.brand, suite)
    check('the Workers page opens', await cell('Workers') && (await waitFor(page, `document.querySelector('.kbwk') !== null`, 12000)) !== null)
    await sleep(1200)
    const workers = JSON.parse(await val(READ))
    await shot('workers-' + skin.replace(/\W+/g, '-').toLowerCase())
    const seen = Object.entries(workers.workers).filter(([, v]) => v !== null)
    check('Workers shows at least one accent control', seen.length > 0, workers)
    check('every accent control of Workers carries the brand token', seen.every(([, v]) => v === workers.brand), workers)
    if (skin === 'Neutral violet') check('the brand token is not the orange here (the preset is applied)', suite.brand !== ORANGE && suite.brand !== 'rgb(249, 250, 251)', suite.brand)
  }
} catch (e) {
  console.log('  ✗ the check threw — ' + String(e && e.message || e).slice(0, 200)); fail += 1
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
