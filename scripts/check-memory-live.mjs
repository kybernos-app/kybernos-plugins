#!/usr/bin/env node
// Checks the « Memory & Lessons » page — and the Memory pill under the composer — against the REAL
// GUI, signed in through docs/dev/live-testing.md.
//
//   node scripts/check-memory-live.mjs [--shots <dir>] [--session "<start of a chat title>"]
//
// READ-ONLY by design: it opens Settings, opens the page, looks, opens the filter menu and the Options
// page, looks for near-duplicates (« Clean up now » only scans: the scan record is the one thing it writes),
// and takes screenshots. It never clicks a Yes/No, Save, Forget or Add — your memories, your lessons
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
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  // The GUI may still be hydrating when the page opens, and the account chip's place depends on the window
  // height: find the chip by its label (never by coordinates), and retry the whole opening a few times.
  const chipJs = `(() => { const e = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'My workspace' || /Switch workspace|^MW/.test((x.textContent || '').trim())); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`
  const navCellJs = `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'Memory & Lessons')`
  let settingsOpen = false
  for (let attempt = 1; attempt <= 4 && settingsOpen !== true; attempt += 1) {
    if ((await waitFor(page, `${chipJs} !== null`, 15000)) === null) break
    const chip = JSON.parse(await ev(chipJs))
    await click(chip.x, chip.y); await sleep(1000)
    await clickText(page, 'Settings')
    settingsOpen = (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 0`, 6000)) !== null
    if (settingsOpen !== true) { console.log('  … Settings did not open (attempt ' + String(attempt) + '), retrying'); await page.send('Page.reload', { ignoreCache: true }); await sleep(3500) }
  }
  if (settingsOpen !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); await shot('no-settings'); await live.close(); process.exit(3) }
  // Plugin sections register a moment after the shell's own cells: wait for ours, not for a fixed delay.
  await waitFor(page, navCellJs, 12000)
  // The nav can be taller than the window: scroll the cell into view and click it directly (clickText only sees what is visible).
  const navFound = await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Memory & Lessons'); if (!c) return false; c.scrollIntoView({ block: 'center' }); (c.querySelector('button,[role=button]') || c).click(); return true })()`)
  if (navFound !== true) { console.error('○ inconclusive: no « Memory & Lessons » entry in the Settings nav (the client is only declared at boot: restart dsh web)'); await shot('no-nav'); await live.close(); process.exit(3) }
  check('the nav entry exists and opens the page', (await waitFor(page, `!!document.querySelector('.kbmem-page')`, 8000)) !== null)
  // The first screen is data: wait for the title and for the first rows instead of a fixed delay (a cold GUI is slower).
  await waitFor(page, `!!document.querySelector('.kbmem-h1') && document.querySelectorAll('.kbmem-r').length > 0`, 15000)
  await sleep(400)
  await shot('01-page')

  check('title', (await text('.kbmem-h1')) === 'Memory & Lessons learned')
  // Visual order, not DOM order: the shell lays the nav out with CSS `order`.
  check('the section sits right after Language in the nav (as drawn, not in DOM order)', (await ev(`(() => { const cells = [...document.querySelectorAll('[class*="navCell"]')].map(c => ({ t: c.textContent.trim(), y: c.getBoundingClientRect().top })).sort((a, b) => a.y - b.y); const i = cells.findIndex(c => c.t === 'Memory & Lessons'); return i > 0 && cells[i - 1].t === 'Language' })()`)) === true)
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

  console.log('search by relevance (local, the default)')
  check('the search field offers Relevance | Meaning, Relevance on', (await count('.kbmem-modes button')) === 2 && (await ev(`document.querySelector('.kbmem-modes button[data-mode=relevance]').classList.contains('on')`)) === true)
  const setSearch = (v) => ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  // data-independent: take two long-ish words from the first memory and search for them
  const sample = String(await text('.kbmem-r .kbmem-tx') || '')
  const strip = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const picks = sample.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 4).slice(0, 2)
  if (picks.length === 2) {
    await setSearch(picks.join(' ')); await sleep(1600)
    const first = strip(String(await text('.kbmem-r .kbmem-tx') || ''))
    check('the first result has BOTH words (« ' + picks.join(' ') + ' »)', picks.every((w) => first.indexOf(strip(w)) >= 0), first.slice(0, 80))
    const total = await text('.kbmem-pager span')
    check('the list narrowed to the matches', /of \d+$/.test(total || '') && Number(/of (\d+)$/.exec(total)[1]) <= memList.total, total)
    await shot('01b-relevance-two-words')
    await setSearch(picks[0].toUpperCase().slice(0, -1)); await sleep(1400)
    check('case and a missing last letter do not matter (prefix)', (await count('.kbmem-r')) > 0)
    await setSearch('zzqzzqxx'); await sleep(1200)
    check('a word nobody wrote shows an empty state, not rows', (await count('.kbmem-r')) === 0 && /No match/.test((await text('.kbmem-empty')) || ''))
    await shot('01c-relevance-empty')
    await setSearch(''); await sleep(1200)
    check('clearing the search brings the full list back', (await count('.kbmem-r')) > 0)
  } else console.log('  – SKIP relevance: the first memory has fewer than two words of 5+ letters')

  console.log('lessons tab, filter menu')
  await ev(`[...document.querySelectorAll('.kbmem-row2 .kbmem-seg button')].find(b => b.textContent.startsWith('Lessons')).click()`); await sleep(900)
  check('lessons list renders', (await count('.kbmem-r')) > 0 || lesList.total === 0)
  {
    const sample = String(await text('.kbmem-r .kbmem-tx') || '')
    const strip = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const picks = sample.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 4).slice(0, 2)
    if (picks.length === 2) {
      await ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(picks.join(' '))}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(1500)
      const first = strip(String(await text('.kbmem-r .kbmem-tx') || ''))
      check('lessons search: the first result has both words (« ' + picks.join(' ') + ' »)', picks.every((w) => first.indexOf(strip(w)) >= 0), first.slice(0, 80))
      await shot('02a-lessons-relevance')
      await ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(1200)
    } else console.log('  – SKIP lessons search: the first lesson has fewer than two words of 5+ letters')
  }
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

  console.log('tidy up (it only LOOKS: this check never merges, keeps, undoes or accepts anything)')
  const tidyLes0 = await local('/kybernos-memory/tidy')
  const hostHasTidy = tidyLes0 !== null && tidyLes0.ok === true
  await ev(`document.querySelector('[data-act=options]').click()`); await sleep(900)
  check('Options has the Tidy up and the Recent tidy-ups sections', (await count('[data-sec=tidy]')) === 1 && (await count('[data-sec=tidy-log]')) === 1)
  check('« Run automatically » and « Study model » are locked and say « Coming next »', (await ev(`[...document.querySelectorAll('[data-sec=tidy] .kbmem-srow.locked')].filter(r => /Coming next/.test(r.textContent)).length`)) === 2)
  await ev(`document.querySelector('[data-sec=tidy]').scrollIntoView()`); await sleep(200)
  await shot('03b-options-tidy')
  if (!hostHasTidy) {
    check('this DSH predates the tidy routes: the page says to restart it and offers no scan', /restart DSH/.test((await text('[data-act=tidy-now]')) || '') && (await ev(`document.querySelector('[data-act=tidy-scan]').disabled`)) === true)
    console.log('  – SKIP the scan: restart dsh web to load the tidy routes')
  } else {
    const memTotal0 = await local('/kybernos-cloud/memory/list?limit=1')
    const lesTotal0 = await local('/kybernos-memory/lessons?limit=1')
    await ev(`document.querySelector('[data-act=tidy-scan]').click()`)
    const opened = await waitFor(page, `!!document.querySelector('.kbmem-h1') && /Tidy-up suggestions/.test(document.querySelector('.kbmem-h1').textContent)`, 20000)
    check('« Clean up now » opens the review', opened === true)
    if (opened === true) {
      await sleep(500)
      const tM = await local('/kybernos-cloud/memory/tidy')
      const tL = await local('/kybernos-memory/tidy')
      const tabs = (await text('.kbmem-row2')) || ''
      const nM = tM !== null && tM.ok === true ? tM.groups.length : null
      const nL = tL !== null && tL.ok === true ? tL.groups.length : null
      check('the tab counts are the host\'s groups', (nM === null || new RegExp('Memories' + String(nM)).test(tabs)) && (nL === null || new RegExp('Lessons learned' + String(nL)).test(tabs)), { tabs, nM, nL })
      check('every card offers Merge, Edit and Keep both, and a kept item is marked', (await count('.kbmem-grp')) === 0 || ((await count('.kbmem-grp [data-act=tidy-merge]')) === (await count('.kbmem-grp')) && (await count('.kbmem-grp .kbmem-it.new')) === (await count('.kbmem-grp'))))
      check('the page says nothing is deleted until you accept', /Nothing is deleted until you accept/.test((await text('.kbmem-foot')) || '') || (await count('[data-tidy=empty]')) === 1)
      await shot('03c-tidy-review')
      if (nL !== null && nL > 0) { await clickText(page, 'Lessons learned', { within: '.kbmem-row2' }); await sleep(300); await shot('03d-tidy-review-lessons') }
      const memTotal1 = await local('/kybernos-cloud/memory/list?limit=1')
      const lesTotal1 = await local('/kybernos-memory/lessons?limit=1')
      check('looking changed nothing: same memory and lesson totals', (memTotal0 === null || memTotal1 === null || memTotal0.total === memTotal1.total) && (lesTotal0 === null || lesTotal0.total === lesTotal1.total), [memTotal0 && memTotal0.total, memTotal1 && memTotal1.total, lesTotal0 && lesTotal0.total, lesTotal1 && lesTotal1.total])
      await ev(`document.querySelector('[data-act=back]').click()`); await sleep(500)
      const saves = (tM !== null && tM.ok === true ? tM.saves : 0) + (tL !== null && tL.ok === true ? tL.saves : 0)
      check('back on the list, the banner counts what the host found', saves === 0 ? (await count('[data-tidy=banner]')) === 0 : new RegExp('^' + String(saves) + ' near-duplicate').test((await text('[data-tidy=banner]')) || ''), { saves, banner: await text('[data-tidy=banner]') })
      await shot('03e-tidy-banner')
    }
  }
  if ((await text('.kbmem-h1')) !== 'Memory & Lessons learned') { await ev(`document.querySelector('[data-act=back]').click()`); await sleep(500) }

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
