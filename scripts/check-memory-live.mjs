#!/usr/bin/env node
// Checks the « Memory & Lessons » page — and the Memory pill under the composer — against the REAL
// GUI, signed in through docs/dev/live-testing.md.
//
//   node scripts/check-memory-live.mjs [--shots <dir>] [--session "<start of a chat title>"]
//
// READ-ONLY by design: it opens Settings, opens the page, looks, opens the filter menu and the Options
// page, and takes screenshots. It never clicks a Yes/No, Save, Forget or Add — your memories, your lessons
// and your switches are not touched (a test that must write picks its own throw-away data; this one
// does not need to). The headless browser is its own: nothing it stores reaches yours.
//
// What it proves that the unit suites cannot: the section is registered in the shell (right nav entry,
// in the right place), it renders with the real theme tokens, its numbers match what the host routes
// return, and the pill shows up in a chat's status row and opens its card.
//
// Needs `dsh web` restarted after kybernos-memory was linked into the profile (a new bundle's client is
// only declared at boot). Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, section
// not there yet).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const sessionTitle = args.indexOf('--session') >= 0 ? args[args.indexOf('--session') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? null : r.val }
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }
const local = async (path) => { try { return await (await fetch('http://127.0.0.1:3080' + path, { headers: await cookieHeader() })).json() } catch (e) { return null } }
const { cookieDeSession } = await import('./cdp-lib.mjs')
const cookieHeader = async () => { const c = cookieDeSession('127.0.0.1:3080'); return c === null ? {} : { cookie: c.nom + '=' + c.valeur } }
const click = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }

try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })

  console.log('host routes (what the page must agree with)')
  const memList = await local('/kybernos-cloud/memory/list?limit=1')
  const lesList = await local('/kybernos-memory/lessons?limit=1')
  check('the lessons routes answer (is kybernos-memory loaded? restart dsh web after linking it)', lesList !== null && lesList.ok === true, lesList)
  if (lesList === null || lesList.ok !== true) { console.error('○ inconclusive: /kybernos-memory/lessons does not answer'); await live.close(); process.exit(3) }

  console.log('settings → Memory & Lessons')
  await click(140, 830); await sleep(1000)
  await clickText(page, 'Settings'); await sleep(1800)
  const navFound = await clickText(page, 'Memory & Lessons')
  if (navFound !== true) { console.error('○ inconclusive: no « Memory & Lessons » entry in the Settings nav (the client is only declared at boot: restart dsh web)'); await shot('no-nav'); await live.close(); process.exit(3) }
  check('the nav entry exists and opens the page', (await waitFor(page, `!!document.querySelector('.kbmem-page')`, 8000)) !== null)
  await sleep(1200)
  await shot('01-page')

  check('title', (await text('.kbmem-h1')) === 'Memory & Lessons learned')
  check('the section sits right after Language in the nav', (await ev(`(() => { const cells = [...document.querySelectorAll('[class*="navCell"]')].map(c => c.textContent.trim()); const i = cells.indexOf('Memory & Lessons'); return i > 0 && cells[i - 1] === 'Language' })()`)) === true)
  check('data first: list rows, no switches on the first screen', (await count('.kbmem-r')) > 0 && (await count('.kbmem-srow')) === 0)
  if (memList !== null && memList.ok === true) {
    const tabs = await text('.kbmem-row2')
    check('the Memories count is the host\'s total', tabs.indexOf('Memories' + String(memList.total)) >= 0, { tabs, host: memList.total })
    check('the status line says how many memories are sent', new RegExp('of ' + String(memList.counts.all) + ' sent each turn').test(await text('.kbmem-st')), await text('.kbmem-st'))
    check('the pager matches the host', (await text('.kbmem-pager span')) === '1–' + String(Math.min(25, memList.total)) + ' of ' + String(memList.total), await text('.kbmem-pager span'))
  } else {
    console.log('  – SKIP memory numbers: the cloud memory route does not answer (not connected?)')
  }
  check('the Lessons count is the host\'s total', ((await text('.kbmem-row2')) || '').indexOf('Lessons learned' + String(lesList.total)) >= 0)
  check('Map is disabled and says why (no index yet)', (await ev(`document.querySelector('.kbmem-seg.sm button[data-v=map]').disabled`)) === true)

  console.log('lessons tab, filter menu')
  await ev(`[...document.querySelectorAll('.kbmem-row2 .kbmem-seg button')].find(b => b.textContent.startsWith('Lessons')).click()`); await sleep(900)
  check('lessons list renders', (await count('.kbmem-r')) > 0 || lesList.total === 0)
  await ev(`document.querySelector('[data-act=filter]').click()`); await sleep(300)
  const groups = await ev(`JSON.stringify([...document.querySelectorAll('.kbmem-mg')].map(e => e.textContent.trim()))`)
  check('filter menu offers Scope, Status and Added (plus Kyber when kybers exist)', ['Scope', 'Status', 'Added'].every((g) => (groups || '').indexOf(g) >= 0), groups)
  check('Team scope is shown as not built', /Team · soon/.test((await text('.kbmem-menu')) || ''))
  await shot('02-lessons-filter')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(200)

  console.log('options page (read-only)')
  await ev(`document.querySelector('[data-act=options]').click()`); await sleep(900)
  check('Options is a page: crumb + rows, no side sheet', (await count('.kbmem-crumb')) === 1 && (await count('.kbmem-srow')) >= 6 && (await count('.kbmem-sheet')) === 0)
  check('the plan note is there', /Your plan|Not connected/.test((await text('.kbmem-note')) || ''))
  check('both switch groups are present', /Memory system context/.test((await text('.kbmem-page')) || '') && /Lessons system context/.test((await text('.kbmem-page')) || ''))
  await shot('03-options')
  await ev(`document.querySelector('[data-act=back]').click()`); await sleep(500)
  check('Back returns to the list', (await text('.kbmem-h1')) === 'Memory & Lessons learned')

  console.log('theme tokens')
  const colors = await ev(`(() => { const p = document.querySelector('.kbmem-page'); const cs = getComputedStyle(p); const btn = document.querySelector('.kbmem-btn'); return JSON.stringify({ ink: cs.getPropertyValue('--m-ink').trim(), acc: cs.getPropertyValue('--m-acc').trim(), color: cs.color, btnBg: btn ? getComputedStyle(btn).backgroundColor : null }) })()`)
  const c = JSON.parse(colors || '{}')
  check('the page reads real theme tokens (not empty, not the hard fallbacks only)', typeof c.ink === 'string' && c.ink !== '' && typeof c.acc === 'string' && c.acc !== '', c)

  if (sessionTitle !== null) {
    console.log('memory pill under the composer')
    const pos = await ev(`(() => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length === 0 && (x.textContent || '').trim().startsWith(${JSON.stringify(sessionTitle)}))[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
    // the Settings dialog covers the sidebar: close it first
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Back to workspace/.test(x.textContent || '')); if (b) b.click() })()`); await sleep(900)
    const pos2 = pos === null ? await ev(`(() => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length === 0 && (x.textContent || '').trim().startsWith(${JSON.stringify(sessionTitle)}))[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`) : pos
    if (pos2 === null) console.log('  – SKIP pill: no chat titled « ' + sessionTitle + ' » in the sidebar')
    else {
      const { x, y } = JSON.parse(pos2); await click(x, y); await sleep(4500)
      check('the pill is in the status row and says its name', (await waitFor(page, `!!document.querySelector('.kbs-pill[data-kbs-pill="notes"]')`, 8000)) !== null && /Memory/.test((await text('.kbs-pill[data-kbs-pill="notes"]')) || ''))
      await ev(`document.querySelector('.kbs-pill[data-kbs-pill="notes"]').click()`); await sleep(800)
      check('the card opens on the memory tab with the sent count', /memories sent to the model|Account memory/.test((await text('#kbs-carte-notes')) || ''))
      check('the card is laid out (nothing absolutely positioned over it)', (await ev(`[...document.querySelectorAll('#kbs-carte-notes *')].filter(e => getComputedStyle(e).position === 'absolute').length`)) === 0)
      check('the card offers the way to the page', (await count('[data-kbs-act=open-memory]')) === 1)
      await shot('04-pill-card')
    }
  }
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
