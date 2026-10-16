#!/usr/bin/env node
// Checks the « Memory & Lessons » page — and the Memory pill under the composer — against the REAL
// GUI, signed in through docs/dev/live-testing.md.
//
//   node scripts/check-memory-live.mjs [--shots <dir>] [--session "<start of a chat title>"]
//
// READ-ONLY by design: it opens Settings, opens the page, looks, opens the filter menu and the Customize
// page, looks for near-duplicates (only when the mode is « Ask me first »: « Clean up now » then only scans),
// and takes screenshots. It never clicks a Yes/No, Save, Forget or Add — your memories, your lessons
// and your switches are not touched (a test that must write picks its own throw-away data; this one
// does not need to). The headless browser is its own: nothing it stores reaches yours.
//
// What it proves that the unit suites cannot: the section is registered in the shell (right nav entry,
// in the right place), it renders with the real theme tokens, its numbers match what the host routes
// return, and the pill shows up in a chat's status row and opens its card.
//
// The instance is KB_HOST (127.0.0.1:3080 by default; `source scripts/sandbox/env.sh` points it at a
// sandbox). The page and the host routes it is compared with are always the SAME instance.
//
// It never invents data: on an instance with nothing to list (not connected to Kybernos Cloud, no lesson yet,
// which is what a fresh sandbox is) the checks that need rows say SKIP, and the empty state is checked instead.
//
// Needs `dsh web` restarted after kybernos-memory was linked into the profile (a new bundle's client is
// only declared at boot). Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, section
// not there yet).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, clickText, openSettings } from './live-page.mjs'

// Where the page sits in the Settings nav: inside the « Kybernos » group (GROUPES in packages/kybernos-plugin/client.js),
// after these and before those. scripts/test-live-checks.mjs keeps both lists in line with GROUPES.
const NAV_ABOVE = ['Kybernos Suite', 'AI Provider & Models', 'Auto Routing']
const NAV_BELOW = ['Workers', 'Language', 'Theme']
// What the page is called, and what it says first (WP-10: it looks after itself, the options are folded under « Customize »).
const PAGE_TITLE = 'Memory looks after itself'

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
// The host routes are read from the SAME instance the page is opened on (KB_HOST, set by sandbox/env.sh), never from
// a fixed :3080: against a sandbox the page would show the sandbox's numbers and be compared with the real DSH's.
const local = async (path) => { try { return await (await fetch('http://' + live.authority + path, { headers: await cookieHeader() })).json() } catch (e) { return null } }
const { cookieDeSession } = await import('./cdp-lib.mjs')
const cookieHeader = async () => { const c = cookieDeSession(live.authority); return c === null ? {} : { cookie: c.nom + '=' + c.valeur } }
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
  // The GUI may still be hydrating and the way in differs between the user's DSH and a fresh one: openSettings finds it.
  const navCellJs = `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'Memory & Lessons')`
  const settingsOpen = await openSettings(page, { minCells: 0 })
  if (settingsOpen !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); await shot('no-settings'); await live.close(); process.exit(3) }
  // Plugin sections register a moment after the shell's own cells: wait for ours, not for a fixed delay.
  await waitFor(page, navCellJs, 12000)
  // The nav can be taller than the window: scroll the cell into view and click it directly (clickText only sees what is visible).
  const navFound = await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Memory & Lessons'); if (!c) return false; c.scrollIntoView({ block: 'center' }); (c.querySelector('button,[role=button]') || c).click(); return true })()`)
  if (navFound !== true) { console.error('○ inconclusive: no « Memory & Lessons » entry in the Settings nav (the client is only declared at boot: restart dsh web)'); await shot('no-nav'); await live.close(); process.exit(3) }
  check('the nav entry exists and opens the page', (await waitFor(page, `!!document.querySelector('.kbmem-page')`, 8000)) !== null)
  // The first screen is data: wait for the title and for the first rows (or, when there is nothing to list, for the empty state
  // that explains why) instead of a fixed delay (a cold GUI is slower).
  await waitFor(page, `!!document.querySelector('.kbmem-h1') && (document.querySelectorAll('.kbmem-r').length > 0 || (!!document.querySelector('.kbmem-empty') && !document.querySelector('.kbmem-spin')))`, 15000)
  await sleep(400)
  await shot('01-page')

  check('title', (await text('.kbmem-h1')) === PAGE_TITLE)
  // Visual order, not DOM order: the shell lays the nav out with CSS `order` and the Kybernos plugin groups the cells under headers
  // (GROUPES). Where the page sits is therefore read from what is drawn: its group header, what is above it, what is below.
  const navAt = JSON.parse((await ev(`JSON.stringify((() => {
    const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
    if (!list) return null
    const items = [...list.children].map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), head: e.dataset.kb === 'settings-group', y: r.top, h: r.height } }).filter(x => x.h > 0).sort((a, b) => a.y - b.y)
    const idx = (t) => items.findIndex(x => !x.head && x.t === t)
    const i = idx('Memory & Lessons')
    if (i < 0) return null
    const head = items.slice(0, i).reverse().find(x => x.head)
    const above = ${JSON.stringify(NAV_ABOVE)}.filter(t => idx(t) >= 0)
    const below = ${JSON.stringify(NAV_BELOW)}.filter(t => idx(t) >= 0)
    return { group: head ? head.t : null, above, below, aboveOk: above.every(t => idx(t) < i), belowOk: below.every(t => idx(t) > i) }
  })())`)) || 'null')
  check('the section sits in the Kybernos group of the nav, after ' + NAV_ABOVE.join(', ') + ' and before ' + NAV_BELOW.join(', ') + ' (as drawn, not in DOM order)', navAt !== null && navAt.group === 'Kybernos' && navAt.aboveOk === true && navAt.belowOk === true, navAt)
  // « Data first » is about what the page offers when it HAS data. An instance with nothing to list (not connected to Kybernos Cloud, no
  // memory yet) legitimately shows no row: the empty state, which says why, is then the first screen — and still no switches.
  const memRows = memList !== null && memList.ok === true && memList.total > 0
  if (memRows) check('data first: list rows, no switches on the first screen', (await count('.kbmem-r')) > 0 && (await count('.kbmem-srow')) === 0)
  else {
    console.log('  – SKIP list rows: this instance has no memory to list (' + (memList !== null && memList.ok === true ? 'none yet' : 'not connected to Kybernos Cloud') + ')')
    check('data first: nothing to list, so the first screen is an empty state that says why, and no switches', (await count('.kbmem-r')) === 0 && (await count('.kbmem-empty')) >= 1 && (await count('.kbmem-srow')) === 0)
  }
  // The one line under the title (N-04): what is on and when it last tidied; never « Off » while something works; the account is the one step.
  const lesSettings = await local('/kybernos-memory/settings')
  const lessonsOn = lesSettings !== null && lesSettings.ok === true && lesSettings.settings.lessons === true
  const statusLine = (await text('.kbmem-st')) || ''
  check('the status line says what is on, and is not « Off » while the lessons work', statusLine !== '' && (!lessonsOn || (!/\bOff\b/.test(statusLine) && /on\b/.test(statusLine))), { statusLine, lessonsOn })
  const connectedNow = memList !== null && memList.ok === true
  check('the account is the one visible step: a Connect button exactly when there is no account', (await count('.kbmem-st [data-act=connect]')) === (connectedNow ? 0 : 1) && (await count('.kbmem-page [data-act=connect]')) <= 1, { connectedNow })
  check('the knobs are folded: one Customize button, no Options button', (await count('[data-act=customize]')) === 1 && (await count('[data-act=options]')) === 0)
  if (memList !== null && memList.ok === true) {
    const tabs = await text('.kbmem-row2')
    check('the Memories count is the host\'s total', tabs.indexOf('Memories' + String(memList.total)) >= 0, { tabs, host: memList.total })
    if (memList.total > 0) check('the pager matches the host', (await text('.kbmem-pager span')) === '1–' + String(Math.min(25, memList.total)) + ' of ' + String(memList.total), await text('.kbmem-pager span'))
  } else {
    console.log('  – SKIP memory numbers: the cloud memory route does not answer (not connected?)')
  }
  check('the Lessons count is the host\'s total', ((await text('.kbmem-row2')) || '').indexOf('Lessons learned' + String(lesList.total)) >= 0)
  if (!connectedNow) {
    // No account: there is nothing to search, filter, add or draw, so the page does not draw a toolbar for it. It says why, and the Lessons tab is one click away.
    check('no account: the memories tab shows the account explanation, not a dead toolbar', (await count('[data-empty=account]')) === 1 && (await count('.kbmem-tools')) === 0 && (await count('.kbmem-seg[aria-label=View]')) === 0)
    console.log('  – SKIP the Map view and the search by relevance of the memories: no account on this instance')
  } else {
    // The Map view is offered for the memories; it is never opened here (with Search by meaning on, opening it would spend embedding credits).
    const mapBtn = JSON.parse((await ev(`JSON.stringify((() => { const b = document.querySelector('.kbmem-seg.sm button[data-v=map]'); return b ? { off: b.disabled, title: b.title, lock: b.querySelectorAll('svg').length > 1 } : null })())`)) || 'null')
    check('Map is offered for the memories: ready when Search by meaning works, else locked and says why', mapBtn !== null && mapBtn.off === false && (mapBtn.lock === false ? /placed by meaning/.test(mapBtn.title) : /Click to see why/.test(mapBtn.title)), mapBtn)

    console.log('search by relevance (local, the default)')
    check('the search field offers Relevance | Meaning, Relevance on', (await count('.kbmem-modes button')) === 2 && (await ev(`document.querySelector('.kbmem-modes button[data-mode=relevance]').classList.contains('on')`)) === true)
    const setSearch = (v) => ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    // data-independent: take two long-ish words from the first memory and search for them
    const sample = String(await text('.kbmem-r .kbmem-tx') || '')
    const strip = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    // the two LONGEST distinct words: a short common word (« cette », « that ») is not a term the ranking has to honour, and the store grows
    const picks = Array.from(new Set(sample.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 4).map((w) => strip(w)))).sort((a, b) => b.length - a.length).slice(0, 2)
    if (picks.length === 2) {
      await setSearch(picks.join(' ')); await sleep(1600)
      const first = strip(String(await text('.kbmem-r .kbmem-tx') || ''))
      check('the first result has BOTH words (« ' + picks.join(' ') + ' »)', picks.every((w) => first.indexOf(strip(w)) >= 0), first.slice(0, 80))
      const total = await text('.kbmem-pager span')
      check('the list narrowed to the matches', /of \d+$/.test(total || '') && (!memRows || Number(/of (\d+)$/.exec(total)[1]) <= memList.total), total)
      await shot('01b-relevance-two-words')
      await setSearch(picks[0].toUpperCase().slice(0, -1)); await sleep(1400)
      check('case and a missing last letter do not matter (prefix)', (await count('.kbmem-r')) > 0)
      await setSearch('zzqzzqxx'); await sleep(1200)
      check('a word nobody wrote shows an empty state, not rows', (await count('.kbmem-r')) === 0 && /No match/.test((await text('.kbmem-empty')) || ''))
      await shot('01c-relevance-empty')
      await setSearch(''); await sleep(1200)
      check('clearing the search brings the full list back', (await count('.kbmem-r')) > 0)
    } else console.log('  – SKIP relevance: the first memory has fewer than two words of 5+ letters')

  }

  console.log('lessons tab, filter menu')
  await ev(`[...document.querySelectorAll('.kbmem-row2 .kbmem-seg button')].find(b => b.textContent.startsWith('Lessons')).click()`); await sleep(900)
  check('lessons list renders', (await count('.kbmem-r')) > 0 || lesList.total === 0)
  {
    const sample = String(await text('.kbmem-r .kbmem-tx') || '')
    const strip = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    // the two LONGEST distinct words: a short common word (« cette », « that ») is not a term the ranking has to honour, and the store grows
  const picks = Array.from(new Set(sample.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 4).map((w) => strip(w)))).sort((a, b) => b.length - a.length).slice(0, 2)
    if (picks.length === 2) {
      await ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(picks.join(' '))}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(1500)
      const first = strip(String(await text('.kbmem-r .kbmem-tx') || ''))
      check('lessons search: the first result has both words (« ' + picks.join(' ') + ' »)', picks.every((w) => first.indexOf(strip(w)) >= 0), first.slice(0, 80))
      await shot('02a-lessons-relevance')
      await ev(`(() => { const i = document.querySelector('.kbmem-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(1200)
    } else console.log('  – SKIP lessons search: the first lesson has fewer than two words of 5+ letters')
  }
  // Mine | Team: Team is live on a Team workspace and otherwise locked, the chip saying why. It is never opened here: that would call the team API.
  const scope = await ev(`JSON.stringify([...document.querySelectorAll('.kbmem-seg[aria-label=Scope] button')].map(b => ({ t: b.textContent.trim(), off: b.disabled, why: b.title })))`)
  const scopeBtns = JSON.parse(scope || '[]')
  check('the Scope control offers Mine and Team', scopeBtns.length === 2 && /^Mine/.test(scopeBtns[0].t) && /^Team/.test(scopeBtns[1].t), scope)
  check('Team is either available, or locked with the reason', scopeBtns.length === 2 && (scopeBtns[1].off === false || (scopeBtns[1].off === true && /Team plan|No team workspace|Sign in|Restart DSH|Checking/.test(scopeBtns[1].t) && scopeBtns[1].why !== '')), scope)
  await ev(`document.querySelector('[data-act=filter]').click()`); await sleep(300)
  const groups = await ev(`JSON.stringify([...document.querySelectorAll('.kbmem-mg')].map(e => e.textContent.trim()))`)
  check('filter menu offers Status and Added (plus Agent Team when agent teams exist)', ['Status', 'Added'].every((g) => (groups || '').indexOf(g) >= 0) && (groups || '').indexOf('Scope') < 0, groups)
  await shot('02-lessons-filter')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(200)

  console.log('options page (read-only)')
  await ev(`document.querySelector('[data-act=customize]').click()`); await sleep(900)
  check('Customize is a page: crumb + rows, no side sheet', (await count('.kbmem-crumb')) === 1 && (await count('.kbmem-srow')) >= 6 && (await count('.kbmem-sheet')) === 0)
  check('the plan note is there', /Your plan|Not connected/.test((await text('.kbmem-note')) || ''))
  check('both switch groups are present, the three lesson switches among them (lessons, context, relevant)', /Memory system context/.test((await text('.kbmem-page')) || '') && /Lessons system context/.test((await text('.kbmem-page')) || '') && (await count('[data-act=lessons-relevant]')) === 1)
  await shot('03-options')
  await ev(`document.querySelector('[data-act=back]').click()`); await sleep(500)
  check('Back returns to the list', (await text('.kbmem-h1')) === PAGE_TITLE)

  console.log('tidy up (it only LOOKS: this check never merges, keeps, undoes or accepts anything)')
  const tidyLes0 = await local('/kybernos-memory/tidy')
  const hostHasTidy = tidyLes0 !== null && tidyLes0.ok === true
  await ev(`document.querySelector('[data-act=customize]').click()`); await sleep(900)
  check('Customize has the Tidy up and the Recent tidy-ups sections', (await count('[data-sec=tidy]')) === 1 && (await count('[data-sec=tidy-log]')) === 1)
  const cfgNow = tidyLes0 !== null && tidyLes0.ok === true && tidyLes0.settings !== undefined ? tidyLes0.settings : null
  check('Customize offers the three settings, and shows what the host has stored', (await count('[data-sec=tidy] [data-act=tidy-mode] button')) === 2 && (await count('[data-sec=tidy] [data-act=tidy-schedule] button')) === 5 && (await count('[data-sec=tidy] [data-act=tidy-brain] button')) === 2 && (cfgNow === null || ((await text('[data-act=tidy-mode] button.on')) === (cfgNow.mode === 'auto' ? 'Merge close matches by itself' : 'Ask me first') && (await text('[data-act=tidy-brain] button.on')) === (cfgNow.brain === true ? 'Yes' : 'No'))), cfgNow)
  await ev(`document.querySelector('[data-sec=tidy]').scrollIntoView()`); await sleep(200)
  await shot('03b-options-tidy')
  if (!hostHasTidy) {
    check('this DSH predates the tidy routes: the page says to restart it and offers no scan', /restart DSH/.test((await text('[data-act=tidy-now]')) || '') && (await ev(`document.querySelector('[data-act=tidy-scan]').disabled`)) === true)
    console.log('  – SKIP the scan: restart dsh web to load the tidy routes')
  } else if (cfgNow === null || cfgNow.mode !== 'ask') {
    console.log('  – SKIP the scan: the mode is not « Ask me first » (or this DSH predates the settings), so a scan could change your data, and this check never does')
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
  if ((await text('.kbmem-h1')) !== PAGE_TITLE) { await ev(`document.querySelector('[data-act=back]').click()`); await sleep(500) }

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
  // A3-21: at a phone width DSH's mobile layer grows every button to a finger's height. Nothing of the page's toolbars may then sit on
  // something else, and every button stays inside the pill that holds it. Looked at on the Memories tab (no account: the explanation) and on
  // the Lessons tab (tabs, scope, view, search, filter), the way a phone meets them.
  console.log('at a phone width (390 px): the toolbars do not sit on each other')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  // DSH's mobile layer decides at load (it is told by the device), so the page is loaded again, in the phone, and the section reopened.
  await page.send('Page.reload', { ignoreCache: true }); await sleep(3500)
  const phoneOpen = await openSettings(page, { minCells: 0 })
  await waitFor(page, navCellJs, 12000)
  await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Memory & Lessons'); if (c) { c.scrollIntoView({ block: 'center' }); (c.querySelector('button,[role=button]') || c).click() } })()`)
  const phoneThere = await waitFor(page, `!!document.querySelector('.kbmem-h1') && !document.querySelector('.kbmem-spin')`, 15000)
  check('phone: the page opens in a 390 px phone', phoneOpen === true && phoneThere !== null)
  await sleep(1200)
  const overlaps = () => ev(`JSON.stringify((() => {
    const page = document.querySelector('.kbmem-page')
    if (!page) return { missing: true }
    const kids = [...document.querySelectorAll('.kbmem-top > *, .kbmem-st > *, .kbmem-row2 > *, .kbmem-tools > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    const name = (e) => (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) + ':' + (e.textContent || '').trim().slice(0, 14)
    const hits = []
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 2 && h > 2 && !kids[i].contains(kids[j]) && !kids[j].contains(kids[i])) hits.push(name(kids[i]) + ' on ' + name(kids[j]))
    }
    const out = []
    for (const pill of document.querySelectorAll('.kbmem-seg, .kbmem-modes, .kbmem-field')) {
      const p = pill.getBoundingClientRect()
      for (const b of pill.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (r.width > 2 && (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1)) out.push(name(b) + ' leaves ' + name(pill)) }
    }
    return { hits, out, sideways: page.scrollWidth > page.clientWidth + 1 }
  })())`)
  for (const tab of ['Memories', 'Lessons']) {
    await ev(`[...document.querySelectorAll('.kbmem-row2 .kbmem-seg button')].find(b => b.textContent.startsWith(${JSON.stringify(tab)})).click()`); await sleep(1000)
    const o = JSON.parse((await overlaps()) || '{"missing":true}')
    const drawn = (await count('.kbmem-row2')) === 1 && (tab === 'Memories' || (await count('.kbmem-tools')) === 1)   // the toolbars this check is about are really there
    check('phone, ' + tab + ' tab: no control sits on another one, every button stays in its pill, no sideways scroll', drawn && o.missing !== true && o.hits.length === 0 && o.out.length === 0 && o.sideways === false, { drawn, o })
    await shot('05-phone-' + tab.toLowerCase())
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
