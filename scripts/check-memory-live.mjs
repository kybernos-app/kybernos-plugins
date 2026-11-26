#!/usr/bin/env node
// Checks the « Memory & Lessons » page — and the Memory pill under the composer — against the REAL
// GUI, signed in through docs/dev/live-testing.md.
//
//   node scripts/check-memory-live.mjs [--shots <dir>] [--session "<start of a chat title>"]
//
// READ-ONLY by design: it opens Settings, opens the page, Manage, one note, « Recently removed » and the Import
// dialog, looks, and takes screenshots. It never clicks Save, Delete, Add, Merge, Restore, Import or Delete all:
// your notes, your lessons and your switches are not touched. The headless browser is its own: nothing it stores
// reaches yours.
//
// What it proves that the unit suites cannot: the section is registered in the shell (right nav entry, in the
// right place), it renders with the real theme tokens, the Suite's « ? » is on its title, its numbers match what the
// host routes return, nothing sits on anything else at a phone width, and the pill shows up in a chat's status row.
//
// The instance is KB_HOST (127.0.0.1:3080 by default; `source scripts/sandbox/env.sh` points it at a sandbox). The page
// and the host routes it is compared with are always the SAME instance. On an instance with nothing to list (not
// connected to Kybernos Cloud, no lesson yet: a fresh sandbox) the checks that need rows say SKIP and the explanation
// the page gives instead is checked.
//
// Needs `dsh web` restarted after kybernos-memory was linked into the profile (a new bundle's client is only declared
// at boot). Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, section not there yet).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, openSettings } from './live-page.mjs'

// Where the page sits in the Settings nav: first under the « Memory & context » group (GROUPES in packages/kybernos-plugin/client.js), before
// these. scripts/test-live-checks.mjs keeps both in line with GROUPES.
const NAV_GROUP = 'Memory & context'
const NAV_ABOVE = []
const NAV_BELOW = ['Kybernos', 'Atlas']
const PAGE_TITLE = 'Memory & Lessons'
const MEM_STEP = 8   // the notes Manage draws before « Show more »

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
const press = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }
// The host routes are read from the SAME instance the page is opened on (KB_HOST, set by sandbox/env.sh), never from
// a fixed :3080: against a sandbox the page would show the sandbox's numbers and be compared with the real DSH's.
const { cookieDeSession } = await import('./cdp-lib.mjs')
const cookieHeader = async () => { const c = cookieDeSession(live.authority); return c === null ? {} : { cookie: c.nom + '=' + c.valeur } }
const local = async (path) => { try { return await (await fetch('http://' + live.authority + path, { headers: await cookieHeader() })).json() } catch (e) { return null } }
const click = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const escape = () => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
const navCellJs = `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'Memory & Lessons')`
const openMemoryCell = () => ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Memory & Lessons'); if (!c) return false; c.scrollIntoView({ block: 'center' }); (c.querySelector('button') || c).click(); return true })()`)

try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })

  console.log('host routes (what the page must agree with)')
  const memList = await local('/kybernos-cloud/memory/list?limit=1')
  const lesList = await local('/kybernos-memory/lessons?limit=1')
  check('the lessons routes answer (is kybernos-memory loaded? restart dsh web after linking it)', lesList !== null && lesList.ok === true, lesList)
  if (lesList === null || lesList.ok !== true) { console.error('○ inconclusive: /kybernos-memory/lessons does not answer'); await live.close(); process.exit(3) }
  const connectedNow = memList !== null && memList.ok === true

  console.log('settings → Memory & Lessons')
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  const settingsOpen = await openSettings(page, { minCells: 0 })
  if (settingsOpen !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); await shot('no-settings'); await live.close(); process.exit(3) }
  // Plugin sections register a moment after the shell's own cells: wait for ours, not for a fixed delay.
  await waitFor(page, navCellJs, 12000)
  if ((await openMemoryCell()) !== true) { console.error('○ inconclusive: no « Memory & Lessons » entry in the Settings nav (the client is only declared at boot: restart dsh web)'); await shot('no-nav'); await live.close(); process.exit(3) }
  check('the nav entry exists and opens the page', (await waitFor(page, `!!document.querySelector('.kbmem-page')`, 8000)) !== null)
  // The first screen is the rows; wait for the title and for the status to be read (the rows draw only then), not for a fixed delay.
  await waitFor(page, `!!document.querySelector('.kbmem-h1') && document.querySelectorAll('.kbmem-srow').length > 0 && !document.querySelector('.kbmem-spin')`, 15000)
  await sleep(400)
  await shot('01-settings')
  check('title', (await text('.kbmem-h1')) === PAGE_TITLE)
  check('the Suite\'s « ? » is on the title (the page declares its help id)', (await count('.kbhp-head button')) === 1)
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
  check('the section is first under « ' + NAV_GROUP + ' » in the nav, before ' + NAV_BELOW.join(', ') + ' (as drawn, not in DOM order)', navAt !== null && navAt.group === NAV_GROUP && navAt.aboveOk === true && navAt.belowOk === true, navAt)

  console.log('the first screen: plain rows')
  check('three switches (use memory, learn, sensitive topics), each with a state', (await count('.kbmem-srow .kbmem-sw')) === 3 && (await ev(`[...document.querySelectorAll('.kbmem-srow .kbmem-sw')].every(b => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-checked') === 'false')`)) === true)
  check('the three doors are there: Your memory (Manage), Import, Export', (await count('button[data-act=manage]')) === 1 && (await count('button[data-act=import]')) === 1 && (await count('button[data-act=export]')) === 1)
  check('no Customize page, no tabs, no map any more', (await count('[data-act=customize]')) === 0 && (await count('.kbmem-row2')) === 0 && (await count('[data-act=map]')) === 0)
  if (!connectedNow) check('no account: the page says so and offers Connect', (await count('[data-act=connect]')) >= 1)

  console.log('Manage')
  check('Manage opens', (await press('button[data-act=manage]')) === true)
  await waitFor(page, `!!document.querySelector('.kbmem-nsearch') && !document.querySelector('.kbmem-spin')`, 10000); await sleep(500)
  await shot('02-manage')
  const rows = await count('.kbmem-nrow:not(.sub)')
  if (connectedNow && memList.total > 0) check('the notes about you are the host\'s: ' + String(Math.min(MEM_STEP, memList.total)) + ' of ' + String(memList.total) + ' to start with', rows === Math.min(MEM_STEP, memList.total), { rows, host: memList.total })
  else console.log('  – SKIP the note count: this instance has no account memory to list (' + (connectedNow ? 'none yet' : 'not connected to Kybernos Cloud') + ')')
  check('the box to tell Kybernos something is there (disabled without an account)', (await count('.kbmem-nsay input')) === 1 && (connectedNow || (await ev(`document.querySelector('.kbmem-nsay input').disabled`)) === true))
  check('Recently removed and Delete all are offered', (await count('button[data-act=removed]')) === 1 && (await count('button[data-act=wipe]')) === 1)
  if (rows > 0) {
    await press('.kbmem-nrow:not(.sub)'); await sleep(800)
    check('a note opens on its own page, with Edit and a way back', (await count('button[data-act=edit]')) >= 1 && (await count('button[data-act=back]')) >= 1)
    await shot('03-note')
    await press('button[data-act=back]'); await sleep(600)
    check('back returns to Manage', (await count('.kbmem-nsearch')) === 1)
  }
  await press('button[data-act=removed]'); await sleep(700)
  check('« Recently removed » opens as a dialog', (await count('.kbmem-dlg')) === 1)
  await shot('04-removed')
  await escape(); await sleep(400)
  check('Escape closes it', (await count('.kbmem-dlg')) === 0)
  await press('button[data-act=back]'); await sleep(500)
  await press('button[data-act=import]'); await sleep(600)
  check('Import opens as a dialog with a prompt to copy and a box for the answer', (await count('.kbmem-dlg')) === 1 && (await count('.kbmem-dlg textarea')) >= 1)
  await shot('05-import')
  await escape(); await sleep(400)
  check('Escape closes it', (await count('.kbmem-dlg')) === 0)

  console.log('theme tokens')
  const colors = await ev(`(() => { const p = document.querySelector('.kbmem-page'); const cs = getComputedStyle(p); return JSON.stringify({ ink: cs.getPropertyValue('--m-ink').trim(), acc: cs.getPropertyValue('--m-acc').trim() }) })()`)
  const c = JSON.parse(colors || '{}')
  check('the page reads real theme tokens (not empty)', typeof c.ink === 'string' && c.ink !== '' && typeof c.acc === 'string' && c.acc !== '', c)

  if (sessionTitle !== null) {
    console.log('memory pill under the composer')
    const find = `(() => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length === 0 && (x.textContent || '').trim().startsWith(${JSON.stringify(sessionTitle)}))[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`
    // the Settings dialog covers the sidebar: close it first
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Back to workspace/.test(x.textContent || '')); if (b) b.click() })()`); await sleep(900)
    const pos = await ev(find)
    if (pos === null) console.log('  – SKIP pill: no chat titled « ' + sessionTitle + ' » in the sidebar')
    else {
      const { x, y } = JSON.parse(pos); await click(x, y); await sleep(4500)
      check('the pill is in the status row and says its name', (await waitFor(page, `!!document.querySelector('.kbs-pill[data-kbs-pill="notes"]')`, 8000)) !== null && /Memory/.test((await text('.kbs-pill[data-kbs-pill="notes"]')) || ''))
      await press('.kbs-pill[data-kbs-pill="notes"]'); await sleep(800)
      check('the card opens on the memory tab with the sent count', /memories sent to the model|Account memory/.test((await text('#kbs-carte-notes')) || ''))
      check('the card offers the way to the page', (await count('[data-kbs-act=open-memory]')) === 1)
      await shot('06-pill-card')
    }
  }

  // A3-21: at a phone width DSH's mobile layer grows every button to a finger's height. Nothing on the page may then sit on something else.
  console.log('at a phone width (390 px): nothing sits on anything else')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  // DSH's mobile layer decides at load (it is told by the device), so the page is loaded again, in the phone, and the section reopened.
  await page.send('Page.reload', { ignoreCache: true }); await sleep(3500)
  // In a phone the sidebar is a drawer, shut until the menu button opens it.
  await ev(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (b) b.click() })()`)
  await sleep(900)
  const phoneOpen = await openSettings(page, { minCells: 0 })
  await waitFor(page, navCellJs, 12000)
  await openMemoryCell()
  const phoneThere = await waitFor(page, `!!document.querySelector('.kbmem-h1') && document.querySelectorAll('.kbmem-srow').length > 0 && !document.querySelector('.kbmem-spin')`, 15000)
  check('phone: the page opens in a 390 px phone', phoneOpen === true && phoneThere !== null)
  await sleep(1200)
  const overlaps = () => ev(`JSON.stringify((() => {
    const page = document.querySelector('.kbmem-page')
    if (!page) return { missing: true }
    const kids = [...document.querySelectorAll('.kbmem-top > *, .kbmem-srow > *, .kbmem-nsay .box > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    const name = (e) => (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) + ':' + (e.textContent || '').trim().slice(0, 14)
    const hits = []
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 2 && h > 2 && !kids[i].contains(kids[j]) && !kids[j].contains(kids[i])) hits.push(name(kids[i]) + ' on ' + name(kids[j]))
    }
    return { hits, sideways: page.scrollWidth > page.clientWidth + 1 }
  })())`)
  let o = JSON.parse((await overlaps()) || '{"missing":true}')
  check('phone, first screen: no control sits on another one, no sideways scroll', o.missing !== true && o.hits.length === 0 && o.sideways === false, o)
  await shot('07-phone-settings')
  await press('button[data-act=manage]'); await sleep(1200)
  o = JSON.parse((await overlaps()) || '{"missing":true}')
  check('phone, Manage: no control sits on another one, no sideways scroll', o.missing !== true && o.hits.length === 0 && o.sideways === false, o)
  await shot('08-phone-manage')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
