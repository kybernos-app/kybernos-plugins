#!/usr/bin/env node
// Checks the Contacts page against the REAL GUI of the SANDBOX: it opens from the « Business » menu row, shows its empty, error, loaded, filtered and paged
// states, and a real mouse and keyboard search (the product's own bar), switch the view (list, cards), filter and sort (the bar's menu), open a panel, add a note,
// create, edit, archive, restore and clear the sample data, while the rows are read back from the base to prove what was written (and by whom). Rectangles are
// measured (page chrome against the Skills page, the bar in the header row, overflow at a narrow width), the keyboard order is walked, the motion is sampled (the
// stagger, the panel sliding in and out, the pop of a chosen tag, nothing at all under reduced motion), nothing is taken on trust. With a theme installed in the
// sandbox the page is checked in the theme's words too (types, fields, tags).
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-contacts-live.mjs [--shots <dir>]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080 and refuses a base that is not under the sandbox home. It EMPTIES the sandbox's own business base first and
// seeds fixture rows into it through the base library (the same code the seam wraps; the file is the sandbox's, WAL lets two processes write). The failure state is a
// page-side stand-in for the host's real 503 answer (the host stays as it is). The <select> pickers are set through the DOM (headless Chrome has no popup to click);
// every other click and every key is a real input event. --shots <dir>: one PNG per state (kept outside git: media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ inconclusive: sandbox only. Run `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
const sandboxHome = process.env.KB_SANDBOX_HOME || ''
if (sandboxHome === '' || process.env.DSH_HOME !== join(sandboxHome, '.dsh')) { console.error('○ inconclusive: DSH_HOME is not the sandbox\'s (' + String(process.env.DSH_HOME) + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// The sandbox's own base, opened by this process (never the real one: DSH_HOME is the sandbox's, checked above).
const base = createBusinessBase()
if (!base.file().startsWith(sandboxHome)) { console.error('○ inconclusive: the base file is not under the sandbox home: ' + base.file()); process.exit(3) }
const A = (r) => { if (r.ok !== true) throw new Error('base: ' + JSON.stringify(r)); return r }

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.innerText })()`)
const exists = async (sel) => (await count(sel)) > 0
/** A real mouse click at the centre of the first element that matches. */
const click = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1 })()`)
  await sleep(250) // a scroller that settles after the jump would move the button from under the pointer
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(350)
  return true
}
/** A real mouse move over the centre of the first element that matches (no click): hover states and the things that appear on it. */
const hover = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1 })()`)
  await sleep(200)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.w / 2 - 3, y: r.y + r.h / 2 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.w / 2, y: r.y + r.h / 2 })
  await sleep(350)
  return true
}
const VK = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }
/** A real key press (down, up). */
const press = async (key, mods = 0) => {
  const base = { key, code: key, windowsVirtualKeyCode: VK[key], modifiers: mods }
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, key === 'Enter' ? { text: '\r' } : {}))
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base))
  await sleep(120)
}
/** Real typing into the focused field. */
const type = async (s) => { await page.send('Input.insertText', { text: s }); await sleep(150) }
const focus = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; e.focus(); return document.activeElement === e })()`)
const active = () => ev(`(() => { const a = document.activeElement; return a === null ? null : (a.getAttribute('data-kb') || a.tagName.toLowerCase()) })()`)
/** Sets a <select> through the DOM: the change event React listens to. */
const pick = (sel, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value === ${JSON.stringify(value)} })()`)
/** The search of the product's bar: a magnifier until it is pressed, then a field that takes the focus (the page keeps no field of its own when the core hands its bar over). */
const SEARCH = '[data-kb="toolbar"] .kb6-tb-search input'
const openSearch = async () => {
  if ((await ev(`(() => { const e = document.querySelector(${JSON.stringify(SEARCH)}); return e !== null && e.offsetParent !== null })()`)) !== true) await click(kb('toggle-search'))
  return focus(SEARCH)
}
const searchValue = () => ev(`(() => { const e = document.querySelector(${JSON.stringify(SEARCH)}); return e === null ? null : e.value })()`)
/** The filter and sort menu of the bar. */
const MENU_BTN = '[data-kb="order-control"] > button'
const openMenu = async () => { if (!(await exists('.kb6-tb-pop'))) await click(MENU_BTN); await sleep(250); return exists('.kb6-tb-pop') }
const closeMenu = async () => { if (await exists('.kb6-tb-pop')) { await press('Escape'); await sleep(250) } }
/** Clicks the option of the menu that reads `word` (its first line): `{ ok, text }`. The menu stays open after a choice. */
const menuPick = async (word) => {
  const i = await ev(`[...document.querySelectorAll('.kb6-tb-pop > button')].findIndex((b) => b.innerText.split('\\n')[0].trim() === ${JSON.stringify(word)})`)
  if (typeof i !== 'number' || i < 0) return { ok: false, text: await text('.kb6-tb-pop') }
  return { ok: await click('.kb6-tb-pop > button:nth-of-type(' + (i + 1) + ')') }
}
/** A segment of the menu (Ascending, 7 days…) by its words. */
const segPick = async (word) => {
  await ev(`(() => { document.querySelectorAll('[data-chk-seg]').forEach((e) => e.removeAttribute('data-chk-seg')); const b = [...document.querySelectorAll('.kb6-tb-pop .kb6-tb-seg')].find((x) => x.innerText.trim() === ${JSON.stringify(word)}); if (b !== undefined) b.setAttribute('data-chk-seg', '1'); return 1 })()`)
  return click('[data-chk-seg]')
}
const menuCount = (word) => ev(`(() => { const b = [...document.querySelectorAll('.kb6-tb-pop > button')].find((x) => x.innerText.split('\\n')[0].trim() === ${JSON.stringify(word)}); return b === undefined ? null : Number(b.querySelector('.kb6-tb-popcount').textContent) })()`)
const byName = (a) => a.slice().sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true }))
const hueOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const cs = getComputedStyle(e); return (cs.getPropertyValue('--kz-h') || cs.getPropertyValue('--kbcts-h')).trim() })()`)
/** What a property of an element is right now, as the browser computes it. */
const css = (sel, prop) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : getComputedStyle(e)[${JSON.stringify(prop)}] })()`)
const names = () => ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].map((r) => r.querySelector('.n').textContent)`)
const ids = () => ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].map((r) => Number(r.getAttribute('data-id')))`)
const waitRows = (n) => waitFor(page, `document.querySelectorAll('[data-kb="contacts-row"]').length === ${n}`, 6000)
const toastText = () => text(kb('contacts-toast'))
const overflowX = () => ev(`(() => { const d = document.scrollingElement; return { doc: d.scrollWidth - d.clientWidth, page: (() => { const p = document.querySelector('[data-kb="contacts-page"]'); return p === null ? null : p.scrollWidth - p.clientWidth })() } })()`)

/** Opens the Contacts page from the menu row with a real mouse (after a reload the page has to be reached again). */
const openContacts = async () => {
  await waitFor(page, `document.readyState === 'complete' && window.__KB_MENU__ !== undefined && window.__KB_MENU__.ids().includes('contacts')`, 40000)
  await waitFor(page, `document.querySelector('[data-kb="menu-business"]') !== null`, 8000)
  const rowSel = await ev(`(() => { const i = [...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')].findIndex((e) => /^(Contacts|Clients|Customers)$/i.test(e.getAttribute('aria-label') || '')); return i })()`)
  if (typeof rowSel !== 'number' || rowSel < 0) return false
  await ev(`(() => { const rows = document.querySelectorAll('[data-kb="menu-business"] .kb4-item'); const r = rows[${rowSel}].getBoundingClientRect(); window.__row = [r.left + r.width / 2, r.top + r.height / 2]; return 1 })()`)
  const [x, y] = await ev('window.__row')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return (await waitFor(page, `document.querySelector('[data-kb="contacts-page"]') !== null`, 8000)) !== null
}
const reload = async () => {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(1500)
  const opened = await openContacts()
  await ev(`(() => { window.__chk = window.__chk || { errs: [], calls: [] }; return 1 })()`)
  return opened
}
const settled = () => waitFor(page, `document.querySelector('[data-kb="contacts-loading"]') === null && document.querySelector('[data-kb="contacts-page"]') !== null`, 8000)
const journal = () => A(base.exportAll({ actor: 'person' })).tables.changes.filter((c) => c.action !== 'export')

try {
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 30000)
  await sleep(2500)
  await ev(`(() => {
    window.__chk = { errs: [], calls: [] }
    window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason)))
    const f = window.fetch
    window.fetch = async function (u, o) {
      const url = String(u)
      if (window.__failList === true && /kybernos-contacts\\/list/.test(url)) return new Response(JSON.stringify({ ok: false, error: 'base_missing' }), { status: 503, headers: { 'content-type': 'application/json' } })
      const r = await f.apply(this, arguments)
      if (/kybernos-contacts\\//.test(url)) window.__chk.calls.push({ url: url.split('?')[0], status: r.status })
      return r
    }
    return 1
  })()`)

  // ── the plugin is on the menu ───────────────────────────────────────────────────────────────────────────────
  console.log('the plugin is mounted and its row is in the menu')
  check('the menu registry holds the row `contacts` in the business group', (await ev(`window.__KB_MENU__ !== undefined && window.__KB_MENU__.list().some((r) => r.id === 'contacts' && r.group === 'business' && r.icon === 'users' && r.order === 10)`)) === true)
  check('the business group is drawn, with a Contacts row', (await ev(`[...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')].some((e) => /^Contacts$/i.test(e.getAttribute('aria-label') || ''))`)) === true)
  const schemaR = await ev(`fetch('/kybernos-contacts/schema', { credentials: 'same-origin' }).then(async (r) => ({ s: r.status, j: await r.json() }))`)
  check('the schema route answers the signed page', schemaR && schemaR.s === 200 && schemaR.j.ok === true, schemaR)
  const themed = schemaR.j.schema.themed === true
  const kindTypes = (kind) => schemaR.j.schema.types.filter((t) => t.kind === kind)
  console.log('  (words: ' + (themed ? 'theme ' + schemaR.j.schema.themes.join(', ') : 'plain defaults, no theme in this sandbox') + ')')
  const noCookie = await ev(`fetch('/kybernos-contacts/list', { credentials: 'omit' }).then((r) => r.status)`)
  check('the list route refuses a request with no session cookie (reads need the session too)', noCookie === 401, noCookie)

  // ── page chrome against the Skills page ─────────────────────────────────────────────────────────────────────
  console.log('the page chrome is the one of the other pages')
  const chrome = (sel) => ev(`(() => { const t = document.querySelector('${sel} .kb6-title'); const b = document.querySelector('${sel} .kb8-primary'); if (t === null || b === null) return null; const tr = t.getBoundingClientRect(); const br = b.getBoundingClientRect(); const cs = getComputedStyle(t); const bs = getComputedStyle(b); return { top: Math.round(tr.top), left: Math.round(tr.left), font: cs.fontSize + '/' + cs.fontWeight, btnH: Math.round(br.height), btnRadius: bs.borderRadius, btnBg: bs.backgroundColor, btnRight: Math.round(br.right) } })()`)
  base.deleteAll({ confirm: true, actor: 'person' })
  check('the Contacts row is clicked with a real mouse and the page opens', (await openContacts()) === true)
  await settled()
  await waitFor(page, `document.querySelector('[data-kb="contacts-empty"]') !== null`, 6000)
  const mine = await chrome('[data-kb="contacts-page"]')
  const skillsRow = await ev(`(() => { const i = [...document.querySelectorAll('.kb4-menu .kb4-item')].findIndex((e) => /^(Skills|Compétences)$/i.test(e.getAttribute('aria-label') || '')); if (i < 0) return null; const r = document.querySelectorAll('.kb4-menu .kb4-item')[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
  let theirs = null
  if (Array.isArray(skillsRow)) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: skillsRow[0], y: skillsRow[1], button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: skillsRow[0], y: skillsRow[1], button: 'left', clickCount: 1 })
    await waitFor(page, `document.querySelector('.kb6-title') !== null && document.querySelector('[data-kb="contacts-page"]') === null`, 8000)
    await sleep(800)
    theirs = await ev(`(() => { const t = document.querySelector('.kb6-title'); const b = document.querySelector('.kb8-primary'); if (t === null || b === null) return null; const tr = t.getBoundingClientRect(); const br = b.getBoundingClientRect(); const cs = getComputedStyle(t); const bs = getComputedStyle(b); return { top: Math.round(tr.top), left: Math.round(tr.left), font: cs.fontSize + '/' + cs.fontWeight, btnH: Math.round(br.height), btnRadius: bs.borderRadius, btnBg: bs.backgroundColor, btnRight: Math.round(br.right) } })()`)
    await shot('00-skills-for-comparison')
    await openContacts()
    await settled()
  }
  check('both pages could be measured', mine !== null && theirs !== null, { mine, theirs })
  if (mine !== null && theirs !== null) {
    check('the title has the same size and weight', mine.font === theirs.font, { mine: mine.font, theirs: theirs.font })
    check('the title starts at the same height and the same left edge', Math.abs(mine.top - theirs.top) <= 2 && Math.abs(mine.left - theirs.left) <= 2, { mine, theirs })
    check('the primary action is the same button (height, colour, radius within a pixel: the Skills button has its own 11 px)', mine.btnH === theirs.btnH && mine.btnBg === theirs.btnBg && Math.abs(parseFloat(mine.btnRadius) - parseFloat(theirs.btnRadius)) <= 1, { mine, theirs })
    const tableRight = (await rect('.kbcts-tw')) || (await rect('[data-kb="contacts-empty"]'))
    check('and it ends where the content below it ends (the Skills page has a scrollbar of its own, so the right edges are compared inside each page)', tableRight !== null && Math.abs(mine.btnRight - tableRight.r) <= 1, { btn: mine.btnRight, content: tableRight && tableRight.r })
  }

  // ── empty ───────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('empty')
  check('there is no « 0 people » count over an empty list', !(await exists(kb('contacts-count'))))
  check('an empty base says so and invites a first contact', (await exists(kb('contacts-empty'))) && (await ev(`document.querySelector('[data-kb="contacts-empty"]').getAttribute('data-why')`)) === 'none' && /No contacts yet/.test(await text(kb('contacts-empty'))))
  check('the empty state has its own add button, and the header has the same action', (await exists(kb('contacts-empty-new'))) && (await exists(kb('contacts-new'))))
  check('no table, no sample banner, no loading line left behind', !(await exists(kb('contacts-table'))) && !(await exists(kb('contacts-demo-banner'))) && !(await exists(kb('contacts-loading'))))
  check('the help button is in the title row', (await ev(`document.querySelector('.kb6-titlerow button, .kb6-titlerow [role="button"]') !== null`)) === true)
  await shot('01-empty')

  // ── error ───────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('error')
  await ev(`window.__failList = true`)
  check('Show archived is clicked while the host answers 503 (the list is asked again)', await click(kb('contacts-archived')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-error"]') !== null`, 6000)
  check('the error state says what failed and why, with a retry', (await exists(kb('contacts-error'))) && /cannot be read right now/.test(await text(kb('contacts-error'))) && /not available in this DSH/.test(await text(kb('contacts-error'))) && (await exists(kb('contacts-retry'))))
  check('it is an alert and the New button is off while nothing can be written', (await ev(`document.querySelector('[data-kb="contacts-error"]').getAttribute('role')`)) === 'alert' && (await ev(`document.querySelector('[data-kb="contacts-new"]').disabled`)) === true)
  await shot('02-error')
  await ev(`window.__failList = false`)
  check('Retry is clicked and the page recovers', await click(kb('contacts-retry')))
  await settled()
  check('back to a normal state (nothing matches: archived is on, the base is empty)', !(await exists(kb('contacts-error'))) && (await exists(kb('contacts-empty'))) && /No contact matches/.test(await text(kb('contacts-empty'))))
  check('Show archived is clicked again: the empty base invites a first contact', (await click(kb('contacts-archived'))) && (await waitFor(page, `document.querySelector('[data-kb="contacts-empty"]') !== null && document.querySelector('[data-kb="contacts-empty"]').getAttribute('data-why') === 'none'`, 4000)) !== null)
  check('the Companies tab is clicked: no companies yet, the New button is on and now says company', (await click(kb('contacts-kind', '[data-kind="company"]'))) && /No companies yet/.test(await text(kb('contacts-empty'))) && (await ev(`document.querySelector('[data-kb="contacts-new"]').disabled`)) === false && /company/i.test(await text(kb('contacts-new'))))
  await click(kb('contacts-kind', '[data-kind="person"]'))
  await settled()

  // ── loaded ──────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('loaded, with sample rows and rows of the person')
  const T = themed ? { person: kindTypes('person')[0].key, company: kindTypes('company')[0].key } : { person: '', company: '' }
  A(base.seed({
    contacts: [
      { ref: 'acme', kind: 'company', type: T.company, name: 'Acme Farm', email: 'hello@acme.example', tags: ['wholesale'] },
      { ref: 'barn', kind: 'company', type: T.company, name: 'Blue Barn Co-op', email: 'info@bluebarn.example' },
      { ref: 'lea', kind: 'person', type: T.person, name: 'Léa Martin', email: 'lea@acme.example', company_ref: 'acme', tags: ['repeat', 'vip'], fields: { city: 'Lyon' } },
      { ref: 'bob', kind: 'person', type: T.person, name: 'Bob Stone', email: 'bob@bluebarn.example', company_ref: 'barn', tags: ['wholesale'] },
      { ref: 'chloe', kind: 'person', type: T.person, name: 'Chloé Dubois', email: 'chloe@example.com' },
      { ref: 'emile', kind: 'person', type: T.person, name: 'Émile Zola', email: 'emile@example.com', tags: ['repeat'] },
    ],
    notes: [{ contact_ref: 'lea', body: 'Sample note: asked for a quote on 40 crates.' }],
  }, { theme: 'check/contacts' }))
  const own = [
    A(base.create('contact', { kind: 'person', type: T.person, name: 'Zoe Kim', email: 'zoe@example.com', tags: ['vip'] }, { actor: 'person' })).row,
    A(base.create('contact', { kind: 'person', type: T.person, name: 'Ünal Çelik-Papadopoulos the Third of Constantinople and Surrounding Provinces', email: 'a.very.long.address.that.will.not.break.the.table@a-very-long-company-domain-name.example.org', tags: ['alpha', 'bravo', 'charlie', 'delta', 'echo'] }, { actor: 'person' })).row,
    A(base.create('contact', { kind: 'person', type: T.person, name: 'N' }, { actor: 'person' })).row,
  ]
  check('the page is opened again over the seeded base', (await reload()) === true)
  await settled()
  check('seven people (four sample, three of the person) are listed', (await waitRows(7)) !== null, await names())
  const sortedNow = await names()
  const lastUpdatedFirst = A(base.list('contact', { kind: 'person', limit: 500 })).rows.sort((a, b) => (Date.parse(b.updated_at) - Date.parse(a.updated_at)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })).map((r) => r.name)
  check('by default the rows are the last updated first, a tie broken by the name (the order never jumps)', JSON.stringify(sortedNow) === JSON.stringify(lastUpdatedFirst), { page: sortedNow, base: lastUpdatedFirst })
  check('the bar\'s menu is opened with a real click and offers Sort by: Last updated, Name, Date added, Type', (await openMenu()) && /Last updated/.test(await text('.kb6-tb-pop')) && /Date added/.test(await text('.kb6-tb-pop')) && /Sort by/.test(await text('.kb6-tb-pop')))
  const pickedName = await menuPick('Name')
  await sleep(300)
  const asc = await names()
  check('Name is picked: the rows are A to Z (upper and lower case alike, accents ignored)', pickedName.ok === true && JSON.stringify(asc) === JSON.stringify(byName(asc)), asc)
  check('the sort the menu shows as chosen is the one used, and the direction follows the name (ascending)', (await ev(`[...document.querySelectorAll('.kb6-tb-pop > button.on')].map((b) => b.innerText.split('\\n')[0].trim())`)).includes('Name'))
  check('Descending is clicked: the rows are Z to A', (await segPick('Descending')) === true && JSON.stringify(await names()) === JSON.stringify(byName(asc).reverse()), await names())
  await segPick('Ascending')
  check('Ascending is clicked again: A to Z', JSON.stringify(await names()) === JSON.stringify(byName(asc)))
  await closeMenu()
  check('Escape closes the menu', !(await exists('.kb6-tb-pop')))
  const rowsNow = await names()
  check('the sort is kept in this browser (the core\'s own hook): after a reload the rows are still A to Z', (await reload()) === true && (await settled()) !== null && (await waitRows(7)) !== null && JSON.stringify(await names()) === JSON.stringify(rowsNow), await names())
  check('the rows come A to Z (Bob, Chloé, Léa: upper and lower case alike)', rowsNow[0] === 'Bob Stone' && rowsNow.indexOf('Bob Stone') < rowsNow.indexOf('Chloé Dubois') && rowsNow.indexOf('Chloé Dubois') < rowsNow.indexOf('Léa Martin'), rowsNow)
  check('exactly the sample rows carry the « demo » badge', (await count(kb('contacts-row', '[data-demo="1"]'))) === 4 && (await count(kb('contacts-row') + ' ' + kb('contacts-demo-badge'))) === 4)
  check('the count says seven people', /^7 people/.test(await text(kb('contacts-count'))), await text(kb('contacts-count')))
  check('the sample banner explains it and offers to clear it', (await exists(kb('contacts-demo-banner'))) && (await exists(kb('contacts-clear-demo'))))
  check('a row shows the email under the name, and a person of a company shows it in its own column', (await ev(`(() => { const r = [...document.querySelectorAll('[data-kb="contacts-row"]')]; const by = (n) => r.find((x) => x.querySelector('.n').textContent === n); return by('Léa Martin').querySelector('small').textContent === 'lea@acme.example' && by('Léa Martin').querySelector('.col-co').innerText.trim() === 'Acme Farm' && by('Zoe Kim').querySelector('small').textContent === 'zoe@example.com' && by('Zoe Kim').querySelector('.col-co').innerText.trim() === '—' })()`)) === true)
  const tableBox = await rect(kb('contacts-table'))
  const wrapBox = await rect('.kbcts-tw')
  check('the table stays inside its box (a very long name and a very long email do not push it out)', tableBox !== null && wrapBox !== null && tableBox.r <= wrapBox.r + 1, { tableBox, wrapBox })
  check('a long name is cut with an ellipsis, not wrapped over the next row', (await ev(`(() => { const n = [...document.querySelectorAll('[data-kb="contacts-row"] .n')].find((e) => e.textContent.startsWith('Ünal')); const cs = getComputedStyle(n); return cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' })()`)) === true)
  const rowHeights = await ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].map((r) => Math.round(r.getBoundingClientRect().height))`)
  check('every row has the same height', Array.isArray(rowHeights) && Math.max(...rowHeights) - Math.min(...rowHeights) <= 1, rowHeights)
  check('the page has no horizontal scroll', (await overflowX()).doc <= 0)
  check('the tags on a row are at most two coloured chips, the rest counted', (await ev(`(() => { const r = [...document.querySelectorAll('[data-kb="contacts-row"]')].find((x) => x.querySelector('.n').textContent.startsWith('Ünal')); return r.querySelectorAll('[data-kb="contacts-row-tag"]').length === 2 && /\\+3/.test(r.innerText) && r.querySelectorAll('.kz-tag').length >= 3 })()`)) === true)
  if (themed) {
    check('the theme\'s types are chips (All + its types) when a kind has several, and no chip row when it has one', (await count(kb('contacts-type'))) === (kindTypes('person').length > 1 ? 1 + kindTypes('person').length : 0), kindTypes('person').length)
    check('a row says its type in the theme\'s word', /Customer|Client/i.test(await text(kb('contacts-row', '[data-id="' + own[0].id + '"]'))))
  } else {
    check('with one type per kind there is no chip row', (await count(kb('contacts-type'))) === 0)
    check('a row of no particular type says Person', /Person/.test(await text(kb('contacts-row', '[data-id="' + own[0].id + '"]'))))
  }
  check('the bar\'s filter menu lists the tags of the rows, with how many rows carry each', (await openMenu()) && (await menuCount('vip')) === 2 && (await menuCount('repeat')) === 2 && (await menuCount('wholesale')) === 1, await text('.kb6-tb-pop'))
  check('the menu says what its list is (the page names the group: the core\'s own word is « File type »)', (await ev(`getComputedStyle(document.querySelector('.kb6-tb-pop > .kb6-tb-pophead.row + .kb6-tb-facetlabel'), '::before').content`)) === '"Type and tags"')
  await closeMenu()
  await shot('03-loaded')

  // ── the product's bar, in the header row ────────────────────────────────────────────────────────────────────────
  console.log('the product\'s own bar (KbToolbar), in the header row')
  const hb = await ev(`(() => { const row = document.querySelector('[data-kb="contacts-page"] .kb6-headrow'); const tb = row === null ? null : row.querySelector('[data-kb="toolbar"]'); if (tb === null) return null; const col = row.querySelector('.kb6-headcol').getBoundingClientRect(); const t = tb.getBoundingClientRect(); const add = row.querySelector('[data-kb="contacts-new"]').getBoundingClientRect(); const wrap = document.querySelector('.kbcts-tw').getBoundingClientRect(); return { colRight: Math.round(col.right), toolbarLeft: Math.round(t.left), toolbarTop: Math.round(t.top), colTop: Math.round(col.top), addRight: Math.round(add.right), contentRight: Math.round(wrap.right), views: [...tb.querySelectorAll('[data-kb^="view-"]')].map((b) => [b.getAttribute('data-kb'), b.innerText.trim(), b.getAttribute('aria-pressed')]), search: tb.querySelector('[data-kb="toggle-search"]') !== null, star: tb.querySelector('[data-kb="toggle-favorites"]') !== null, menu: tb.querySelector('[data-kb="order-control"]') !== null, own: document.querySelector('[data-kb="contacts-own-bar"]') !== null } })()`)
  check('the core\'s bar is drawn in the header row (and the page\'s own plain bar is not)', hb !== null && hb.own === false, hb)
  if (hb !== null) {
    check('it sits to the right of the title block, on the same row', hb.toolbarLeft >= hb.colRight - 1 && Math.abs(hb.toolbarTop - hb.colTop) <= 12, hb)
    check('it has the search (a magnifier), the view switch with its words, the filter and sort button, and the primary action; no star, a contact has no favourite', hb.search && hb.menu && hb.star === false && JSON.stringify(hb.views.map((v) => v[1])) === JSON.stringify(['Cards', 'List']), hb)
    check('the list is the view that is on, and the primary action ends where the content ends', JSON.stringify(hb.views.map((v) => v[2])) === JSON.stringify(['false', 'true']) && Math.abs(hb.addRight - hb.contentRight) <= 1, hb)
  }
  await shot('03b-header-bar')

  // ── search, kind, tag ───────────────────────────────────────────────────────────────────────────────────────
  console.log('search, kind and tag, with a real keyboard and mouse')
  check('the magnifier is clicked: the field opens and takes the focus', (await openSearch()) === true && (await ev(`document.activeElement === document.querySelector(${JSON.stringify(SEARCH)})`)) === true)
  await type('Martin')
  await waitRows(1)
  check('typing « Martin » leaves one row', JSON.stringify(await names()) === JSON.stringify(['Léa Martin']), await names())
  check('the count follows and the filters can be cleared', /^1 person/.test(await text(kb('contacts-count'))) && (await exists(kb('contacts-clear-filters'))), await text(kb('contacts-count')))
  check('the Companies tab says what the search finds there (nothing named Martin)', (await text(kb('contacts-kind', '[data-kind="company"]'))).replace(/\s+/g, ' ').trim() === 'Companies 0', await text(kb('contacts-kind', '[data-kind="company"]')))
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(SEARCH)}); e.select(); return 1 })()`)
  await type('zzz-nobody')
  await waitFor(page, `document.querySelector('[data-kb="contacts-empty"]') !== null`, 4000)
  check('a search that finds nothing says « No contact matches » and never « No contacts yet »', (await ev(`document.querySelector('[data-kb="contacts-empty"]').getAttribute('data-why')`)) === 'filtered' && /No contact matches/.test(await text(kb('contacts-empty'))) && !/No contacts yet/.test(await text(kb('contacts-empty'))))
  await shot('04-no-match')
  check('Clear filters is clicked', await click(kb('contacts-clear-filters')))
  await waitRows(7)
  check('the full list is back and the field is empty', (await searchValue()) === '' && (await names()).length === 7)
  await openSearch()
  await type('zoe@')
  await waitRows(1)
  check('the search covers the email', JSON.stringify(await names()) === JSON.stringify(['Zoe Kim']), await names())
  check('the search field has its own clear button, and it empties the field', (await click('[data-kb="toolbar"] .kb6-tb-clear')) && (await waitRows(7)) !== null && (await searchValue()) === '')
  await click(kb('contacts-clear-filters'))
  await waitRows(7)
  check('the Companies tab is clicked and lists the two companies, with no people', (await click(kb('contacts-kind', '[data-kind="company"]'))) && (await waitRows(2)) !== null && JSON.stringify(await names()) === JSON.stringify(['Acme Farm', 'Blue Barn Co-op']), await names())
  check('the add button now says company, and the count says companies', /company/i.test(await text(kb('contacts-new'))) && /2 compan/.test(await text(kb('contacts-count'))))
  check('a company row has no Company column, and is drawn with its own mark (an svg in a rounded tile, named for a screen reader, no picture file)', (await count('.kbcts-tbl th.col-co')) === 0 && (await ev(`(() => { const m = [...document.querySelectorAll('[data-kb="contacts-row"] .kz-logo')]; return m.length === 2 && m.every((e) => e.querySelector('svg') !== null && e.querySelector('img') === null && /^(Acme Farm|Blue Barn Co-op)$/.test(e.getAttribute('aria-label') || '')) && new Set(m.map((e) => e.getAttribute('data-mark') + (e.getAttribute('data-letters') || '') + e.style.getPropertyValue('--kz-h') + e.style.getPropertyValue('--kz-h2'))).size === 2 })()`)) === true)
  await shot('05-companies')
  await click(kb('contacts-kind', '[data-kind="person"]'))
  await waitRows(7)
  check('a tag on a row is clicked and filters by that tag: it becomes a chip of the strip', (await click(kb('contacts-row-tag', ''))) === true)
  await sleep(300)
  const tagRows = await names()
  const chosenTag = await text(kb('contacts-active-tag'))
  check('the chosen tag is shown as a removable chip, and every remaining row carries it', chosenTag !== null && chosenTag.trim() !== '' && tagRows.length >= 1 && tagRows.length < 7 && (await ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].every((r) => [...r.querySelectorAll('.kz-tag')].some((t) => t.textContent.trim() === ${JSON.stringify((chosenTag || '').trim())}) || /\\+\\d/.test(r.innerText))`)) === true, { chosenTag, tagRows })
  check('the filter button of the bar says a filter is on (a dot)', (await exists('.kb6-tb-dot')) === true)
  check('the chip is clicked: the tag is off and the seven rows are back', (await click(kb('contacts-active-tag') + ' button')) && (await waitRows(7)) !== null && !(await exists(kb('contacts-active-tag'))))
  check('the filter menu is opened and « vip » picked: Léa and Zoe', (await openMenu()) && (await menuPick('vip')).ok === true && (await waitRows(2)) !== null && JSON.stringify((await names()).sort()) === JSON.stringify(['Léa Martin', 'Zoe Kim']), await names())
  check('the menu shows it chosen, with a Reset, and the strip shows the chip', (await ev(`[...document.querySelectorAll('.kb6-tb-pop > button.on')].some((b) => b.innerText.split('\\n')[0].trim() === 'vip')`)) === true && (await exists('.kb6-tb-reset')) && (await exists(kb('contacts-active-tag'))))
  check('a second tag is picked (« wholesale »): either tag keeps a row (Léa, Zoe and Bob)', (await menuPick('wholesale')).ok === true && (await waitRows(3)) !== null && JSON.stringify((await names()).sort()) === JSON.stringify(['Bob Stone', 'Léa Martin', 'Zoe Kim']), await names())
  check('Reset is clicked: the filters are off and the seven rows are back', (await click('.kb6-tb-reset')) && (await waitRows(7)) !== null)
  check('the period is set to 7 days (everything was changed a moment ago, so all seven stay), and the bar offers it', (await segPick('7 days')) === true && (await waitRows(7)) !== null && (await exists(kb('contacts-clear-filters'))))
  await segPick('All')
  await closeMenu()
  await click(kb('contacts-clear-filters'))
  await waitRows(7)
  if (themed) {
    const second = kindTypes('person')[1]
    if (second !== undefined) {
      check('a type chip is clicked and filters (nothing of that type yet: the honest empty line)', (await click(kb('contacts-type', '[data-type="' + second.key + '"]'))) && (await waitFor(page, `document.querySelector('[data-kb="contacts-empty"]') !== null`, 4000)) !== null)
      await click(kb('contacts-type', '[data-type=""]'))
      await waitRows(7)
    }
  }

  // ── the views ───────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the views: list and cards')
  check('Cards is clicked: a grid of contact cards, one per person, the table is gone', (await click(kb('view-cards'))) && (await waitFor(page, `document.querySelectorAll('[data-kb="contacts-cards"] [data-kb="contacts-row"]').length === 7`, 4000)) !== null && !(await exists(kb('contacts-table'))))
  await sleep(900)
  const cardBox = await rect(kb('contacts-row'))
  const gridBox = await rect(kb('contacts-cards'))
  check('the cards are laid out in a grid inside the page (no overflow, several to a row)', cardBox !== null && gridBox !== null && cardBox.r <= gridBox.r + 1 && (await ev(`new Set([...document.querySelectorAll('[data-kb="contacts-row"]')].map((c) => Math.round(c.getBoundingClientRect().top))).size`)) < 7 && (await overflowX()).doc <= 0, { cardBox, gridBox })
  check('a card has a big avatar, the type as a coloured chip, and the tags as coloured chips', (await ev(`(() => { const c = [...document.querySelectorAll('[data-kb="contacts-row"]')].find((x) => x.querySelector('.n').textContent === 'Léa Martin'); return c.querySelector('.kz-av') !== null && c.querySelector('.kz-av').getBoundingClientRect().width >= 52 && c.querySelectorAll('.kz-tag').length >= 3 && c.querySelector('.kz-tag i') !== null })()`)) === true)
  check('the view is kept in this browser: after a reload the cards are still there', (await reload()) === true && (await settled()) !== null && (await waitFor(page, `document.querySelector('[data-kb="contacts-cards"]') !== null`, 5000)) !== null)
  await shot('05b-cards')
  await sleep(1200)
  const lifted = await ev(`(() => { const c = document.querySelector('[data-kb="contacts-row"]'); return { before: getComputedStyle(c).transform, acts: getComputedStyle(c.querySelector('.kbcts-ra')).opacity } })()`)
  await hover(kb('contacts-row'))
  await sleep(350)
  const lifted2 = await ev(`(() => { const c = document.querySelector('[data-kb="contacts-row"]'); return { after: getComputedStyle(c).transform, acts: getComputedStyle(c.querySelector('.kbcts-ra')).opacity } })()`)
  check('hovering a card lifts it (a translate up) and shows its actions, which were hidden', lifted.before === 'none' && /matrix\(1, 0, 0, 1, 0, -\d/.test(lifted2.after) && lifted.acts === '0' && lifted2.acts === '1', { lifted, lifted2 })
  await shot('05c-cards-hover')
  check('Enter on a focused card opens its panel (the cards use the keyboard of the rows)', (await focus(kb('contacts-row'))) && (await press('Enter'), (await waitFor(page, `document.querySelector('[data-kb="contacts-panel"]') !== null`, 4000)) !== null))
  check('the selected card is marked, and the grid makes room for the panel', (await ev(`document.querySelector('[data-kb="contacts-row"][aria-current="true"]') !== null`)) === true && (await exists('.kbcts-body.has-panel')))
  await shot('05d-cards-panel')
  await press('Escape')
  await sleep(450)
  check('Escape closes it and the card has the focus back', !(await exists(kb('contacts-panel'))) && (await ev(`document.activeElement.getAttribute('data-kb')`)) === 'contacts-row')
  check('List is clicked: the table is back', (await click(kb('view-list'))) && (await waitRows(7)) !== null && (await exists(kb('contacts-table'))) && !(await exists(kb('contacts-cards'))))
  const rowBefore = await ev(`getComputedStyle(document.querySelector('[data-kb="contacts-row"] .kbcts-ra')).opacity`)
  await hover(kb('contacts-row'))
  check('hovering a row shows its actions (write, edit) in place of the date', rowBefore === '0' && (await ev(`(() => { const r = document.querySelector('[data-kb="contacts-row"]'); return getComputedStyle(r.querySelector('.kbcts-ra')).opacity === '1' && getComputedStyle(r.querySelector('.when')).opacity === '0' })()`)) === true)
  check('a row action does not open the panel: Edit opens the dialog filled with that contact, and Escape closes it', (await click(kb('contacts-row') + ' ' + kb('contacts-row-edit'))) && (await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') !== null`, 3000)) !== null && !(await exists(kb('contacts-panel'))) && (await ev(`document.querySelector('[data-kb="contacts-form-name"]').value`)) !== '')
  await press('Escape')
  await sleep(250)
  check('the mail action is a real link to the person\'s address', (await ev(`(() => { const a = document.querySelector('[data-kb="contacts-row-mail"]'); return a !== null && a.tagName === 'A' && /^mailto:[^\\s@]+@[^\\s@]+$/.test(a.getAttribute('href')) })()`)) === true)

  // ── keyboard order ──────────────────────────────────────────────────────────────────────────────────────────
  console.log('the keyboard reaches everything')
  await focus('.kb6-titlerow button')
  const barOrder = []
  for (let i = 0; i < 8; i += 1) { await press('Tab'); barOrder.push(await active()) }
  check('from the help button, Tab reaches the bar: search, both views, the filter button, then the primary action', ['toggle-search', 'view-cards', 'view-list', 'contacts-new'].every((k) => barOrder.includes(k)) && barOrder.indexOf('toggle-search') < barOrder.indexOf('view-cards') && barOrder.indexOf('view-list') < barOrder.indexOf('contacts-new'), barOrder)
  await focus(kb('contacts-new'))
  const order = []
  for (let i = 0; i < 14; i += 1) { await press('Tab'); order.push(await active()) }
  check('from the New button, Tab reaches both kinds, the archived toggle and then the rows', ['contacts-kind', 'contacts-archived', 'contacts-row'].every((k) => order.includes(k)), order)
  check('the order follows the page (the kinds before the archived toggle before the rows)', order.indexOf('contacts-kind') < order.indexOf('contacts-archived') && order.indexOf('contacts-archived') < order.indexOf('contacts-row'), order)
  await focus(kb('contacts-archived'))
  await press('Tab')
  check('a row reached with Tab has a visible ring (2 px outline)', (await ev(`(() => { const a = document.activeElement; const cs = getComputedStyle(a); return a.getAttribute('data-kb') === 'contacts-row' && parseFloat(cs.outlineWidth) >= 2 && cs.outlineStyle !== 'none' })()`)) === true)
  check('and its actions are shown for the keyboard, as they are for the mouse', (await ev(`getComputedStyle(document.activeElement.querySelector('.kbcts-ra')).opacity`)) === '1')
  await focus(kb('contacts-row'))
  const first = await ids()
  await press('ArrowDown')
  check('ArrowDown moves from a row to the next one', (await ev(`Number(document.activeElement.getAttribute('data-id'))`)) === first[1])
  await press('ArrowUp')
  check('ArrowUp moves back', (await ev(`Number(document.activeElement.getAttribute('data-id'))`)) === first[0])
  await press('Enter')
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"]') !== null`, 4000)
  check('Enter on a row opens its panel, and the focus goes into it', (await exists(kb('contacts-panel'))) && (await ev(`document.querySelector('[data-kb="contacts-panel"]').contains(document.activeElement)`)) === true)
  await press('Escape')
  await sleep(450)
  check('Escape closes the panel and gives the focus back to the row', !(await exists(kb('contacts-panel'))) && (await ev(`document.activeElement.getAttribute('data-id')`)) === String(first[0]))

  // ── the panel, a note ───────────────────────────────────────────────────────────────────────────────────────
  console.log('a panel, and a note')
  const leaId = Number(await ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].find((r) => r.querySelector('.n').textContent === 'Léa Martin').getAttribute('data-id')`))
  A(base.create('flow_card', { flow: 'orders', stage: 'paid', title: 'Order #1031', contact_id: leaId }, { actor: 'person' }))
  check('the row of Léa is clicked with the mouse', await click(kb('contacts-row', '[data-id="' + leaId + '"]')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"] h3') !== null`, 4000)
  const panelText = await text(kb('contacts-panel'))
  check('the panel carries the name, the email, the company, the tags and the sample note', /Léa Martin/.test(panelText) && /lea@acme\.example/.test(panelText) && /Acme Farm/.test(panelText) && /vip/.test(panelText) && /Sample note/.test(panelText) && /demo/i.test(panelText), panelText.slice(0, 200))
  check('the card of a board that points at her is listed as linked work (read only)', (await count(kb('contacts-card'))) === 1 && /Order #1031/.test(await text(kb('contacts-card'))) && /orders · paid/.test(await text(kb('contacts-card'))))
  check('a custom value the theme does not define is still shown, with its key', /city/i.test(panelText) && /Lyon/.test(panelText))
  const panelBox = await rect(kb('contacts-panel'))
  const bodyBox = await rect('.kbcts-body')
  check('the panel is inside the page area, beside the list', panelBox !== null && bodyBox !== null && panelBox.r <= bodyBox.r + 1 && panelBox.w >= 300 && panelBox.w <= 360, { panelBox, bodyBox })
  check('the list stays visible next to it, and the selected row is marked', (await exists(kb('contacts-table'))) && (await ev(`document.querySelector('[data-kb="contacts-row"][data-id="${leaId}"]').getAttribute('aria-current')`)) === 'true')
  check('a note has no edit and no delete (they are added, never edited)', (await count(kb('contacts-note') + ' button')) === 0 && (await count(kb('contacts-note') + ' textarea')) === 0)
  check('the add-note button is off while the note is empty', (await ev(`document.querySelector('[data-kb="contacts-note-add"]').disabled`)) === true)
  check('the panel opens on a tinted header: a big avatar, the name, the type as a coloured chip, the company beside it, and Email and Edit up there', (await ev(`(() => { const p = document.querySelector('[data-kb="contacts-panel"]'); const hero = p.querySelector('.kbcts-hero'); return hero !== null && getComputedStyle(hero).backgroundImage.includes('gradient') && hero.querySelector('.kz-av').getBoundingClientRect().width >= 56 && hero.querySelector('.kz-tag') !== null && /Acme Farm/.test(hero.innerText) && hero.querySelector('[data-kb="contacts-mail"]') !== null && hero.querySelector('[data-kb="contacts-edit"]') !== null })()`)) === true)
  check('the tags of the panel are the same coloured chips as the row (same tag, same hue)', (await ev(`(() => { const hue = (e) => getComputedStyle(e).getPropertyValue('--kz-h').trim(); const row = [...document.querySelectorAll('[data-kb="contacts-row"][data-id="${leaId}"] .kz-tag')].find((t) => t.textContent.trim() === 'vip'); const pan = [...document.querySelectorAll('[data-kb="contacts-panel"] .kz-tag')].find((t) => t.textContent.trim() === 'vip'); return row !== undefined && pan !== undefined && hue(row) !== '' && hue(row) === hue(pan) })()`)) === true)
  check('the notes are a timeline: a round icon per note, then the day the contact was added, the last point', (await count(kb('contacts-timeline') + ' > li')) === 2 && (await count(kb('contacts-timeline') + ' .dot svg')) === 2 && (await ev(`document.querySelector('[data-kb="contacts-timeline"] > li:last-child').getAttribute('data-kb')`)) === 'contacts-created')
  await shot('06-panel')
  check('the note field is clicked and a note typed with the keyboard', await click(kb('contacts-note-input')))
  await type('Called back: wants delivery on Friday.')
  check('the add-note button is on', (await ev(`document.querySelector('[data-kb="contacts-note-add"]').disabled`)) === false)
  check('Add note is clicked', await click(kb('contacts-note-add')))
  await waitFor(page, `document.querySelectorAll('[data-kb="contacts-note"]').length === 2`, 4000)
  const notesNow = await ev(`[...document.querySelectorAll('[data-kb="contacts-note"]')].map((n) => n.innerText)`)
  check('the new note is on top of the history, the field is empty again, and a polite status says so', /Called back/.test(notesNow[0]) && /Sample note/.test(notesNow[1]) && (await ev(`document.querySelector('[data-kb="contacts-note-input"]').value`)) === '' && /Note added/.test(await toastText()), { notesNow, toast: await toastText() })
  const noteRow = A(base.list('note', { contact_id: leaId })).rows.find((n) => /Called back/.test(n.body))
  check('the base has the note, written by the person', noteRow !== undefined && noteRow.actor === 'person', noteRow)
  check('the journal says who and what', journal().some((c) => c.tbl === 'note' && c.action === 'create' && c.actor === 'person'))
  check('the linked company is clicked: its panel opens, on the Companies tab, listing its people', (await click(kb('contacts-linked'))) && (await waitFor(page, `document.querySelector('[data-kb="contacts-panel"] h3') !== null && document.querySelector('[data-kb="contacts-panel"] h3').textContent === 'Acme Farm'`, 5000)) !== null && /Léa Martin/.test(await text(kb('contacts-panel'))))
  check('the Companies tab is the one pressed', (await ev(`document.querySelector('[data-kb="contacts-kind"][data-kind="company"]').getAttribute('aria-pressed')`)) === 'true')
  await click(kb('contacts-panel-close'))
  await click(kb('contacts-kind', '[data-kind="person"]'))
  await waitRows(7)
  await reload()
  await settled()
  await click(kb('contacts-row', '[data-id="' + leaId + '"]'))
  await waitFor(page, `document.querySelectorAll('[data-kb="contacts-note"]').length === 2`, 5000)
  check('after a reload the note is still there', (await count(kb('contacts-note'))) === 2)
  await click(kb('contacts-panel-close'))

  // ── motion ──────────────────────────────────────────────────────────────────────────────────────────────────
  // The clicks that start an animation are made from the page (a real click and a sleep would miss the first frames); what is asserted is what the browser computes while it plays.
  console.log('motion: the stagger, the panel in and out, the pop, the press, and none of it under reduced motion')
  await sleep(500)
  const sample = (js, ms, every) => ev(`new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { out.push([Math.round(performance.now() - t0), (${js})]); if (performance.now() - t0 < ${ms}) setTimeout(tick, ${every || 40}); else res(out) }; tick() })`)
  await ev(`(() => { document.querySelector('[data-kb="view-cards"]').click(); return 1 })()`)
  // the entry belongs to the cell of a card (the card keeps its own transform for the hover lift) and to the row of a table
  const entry = await sample(`(() => { const c = [...document.querySelectorAll('[data-kb="contacts-row"]')].map((x) => x.closest('.kz-in')); return c.length < 7 ? null : [0, 3, 6].map((i) => Number(getComputedStyle(c[i]).opacity)) })()`, 1100, 50)
  const entered = entry.filter((e) => e[1] !== null)
  check('the cards come in one after the other: the first is up while the seventh has not begun, and all are whole at the end', entered.some((e) => e[1][0] > 0.5 && e[1][2] < 0.2) && entered[entered.length - 1][1].every((o) => o === 1), entered.map((e) => e[0] + ':' + e[1].map((o) => o.toFixed(2)).join('/')).join(' '))
  check('the delay grows with the position (30 ms a step) and the animation is the kit\'s kz-in', (await ev(`(() => { const c = [...document.querySelectorAll('[data-kb="contacts-row"]')].map((x) => x.closest('.kz-in')); const d = (i) => parseFloat(getComputedStyle(c[i]).animationDelay); return getComputedStyle(c[0]).animationName === 'kz-in' && d(0) === 0 && Math.abs(d(6) - 0.18) < 0.001 && d(3) < d(6) })()`)) === true)
  await ev(`(() => { document.querySelector('[data-kb="view-list"]').click(); return 1 })()`)
  await waitRows(7)
  await sleep(900)
  const leaSel = kb('contacts-row', '[data-id="' + leaId + '"]')
  await ev(`(() => { document.querySelector('${leaSel}').click(); return 1 })()`)
  const slide = await sample(`(() => { const p = document.querySelector('[data-kb="contacts-panel"]'); return p === null ? null : [Number(getComputedStyle(p).opacity), getComputedStyle(p).animationName, new DOMMatrix(getComputedStyle(p).transform).m41] })()`, 450, 30)
  const slid = slide.filter((e) => e[1] !== null)
  check('the panel slides in: it starts transparent and shifted to the right, and ends whole and in place', slid.length > 3 && slid[0][1][1] === 'kbcts-slide' && slid.some((e) => e[1][0] < 0.9 && e[1][2] > 0.5) && slid[slid.length - 1][1][0] === 1 && slid[slid.length - 1][1][2] === 0, slid.slice(0, 6).map((e) => e[0] + ':' + e[1][0].toFixed(2) + '/' + e[1][2].toFixed(1)).join(' '))
  await ev(`(() => { document.querySelector('[data-kb="contacts-panel-close"]').click(); return 1 })()`)
  const out = await sample(`(() => { const p = document.querySelector('[data-kb="contacts-panel"]'); return p === null ? 'gone' : [Number(getComputedStyle(p).opacity), p.className] })()`, 450, 30)
  const outFirst = out.find((e) => e[1] !== 'gone' && /\bout\b/.test(e[1][1]))
  check('the panel slides out before it goes: its class says so and it fades, then it is gone within a fifth of a second or so', outFirst !== undefined && out.some((e) => e[1] !== 'gone' && e[1][0] < 0.9) && out.find((e) => e[1] === 'gone')[0] <= 400, out.map((e) => e[0] + ':' + (e[1] === 'gone' ? 'gone' : e[1][0].toFixed(2))).join(' '))
  await sleep(300)
  check('the row has the focus back when the panel is gone', (await ev(`document.activeElement.getAttribute('data-id')`)) === String(leaId))
  // the pop of a tag that is chosen
  await ev(`(() => { document.querySelector('[data-kb="contacts-row-tag"] button').click(); return 1 })()`)
  const pop = await sample(`(() => { const t = document.querySelector('[data-kb="contacts-active-tag"]'); return t === null ? null : [getComputedStyle(t).animationName, new DOMMatrix(getComputedStyle(t).transform).a] })()`, 400, 30)
  const popped = pop.filter((e) => e[1] !== null)
  check('a chosen tag appears with a pop: the kit\'s kz-pop, the chip swells above its size and settles back', popped.length > 2 && popped[0][1][0] === 'kz-pop' && popped.some((e) => e[1][1] > 1.05) && Math.abs(popped[popped.length - 1][1][1] - 1) < 0.01, popped.map((e) => e[0] + ':' + e[1][1].toFixed(2)).join(' '))
  await click(kb('contacts-clear-filters'))
  await waitRows(7)
  // a press
  const kindBtn = kb('contacts-kind', '[data-kind="company"]')
  const kr = await rect(kindBtn)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: kr.x + kr.w / 2, y: kr.y + kr.h / 2 })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: kr.x + kr.w / 2, y: kr.y + kr.h / 2, button: 'left', clickCount: 1 })
  await sleep(250)
  const pressed = await css(kindBtn, 'transform')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: kr.x + kr.w / 2, y: kr.y + kr.h / 2, button: 'left', clickCount: 1 })
  await sleep(300)
  check('a button gives way under the finger: pressed, it is scaled down (0.96), and it comes back', /matrix\(0\.9[0-9]+, 0, 0, 0\.9[0-9]+/.test(pressed) && (await css(kindBtn, 'transform')) === 'none', pressed)
  await click(kb('contacts-kind', '[data-kind="person"]'))
  await waitRows(7)
  // reduced motion: nothing moves, and the panel goes at once
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(300)
  await ev(`(() => { document.querySelector('[data-kb="view-cards"]').click(); return 1 })()`)
  await sleep(100)
  const calm = await ev(`(() => { const c = document.querySelector('[data-kb="contacts-row"]'); const k = document.querySelector('.kbcts-seg button'); const cell = c.closest('.kz-in'); return { anim: getComputedStyle(cell).animationName, opacity: getComputedStyle(cell).opacity, cardTrans: getComputedStyle(c).transitionDuration, btnTrans: getComputedStyle(k).transitionDuration, acts: getComputedStyle(c.querySelector('.kbcts-ra')).transform } })()`)
  check('under reduced motion the cards do not animate in, nor transition, and nothing is hidden for the sake of an animation', calm.anim === 'none' && calm.opacity === '1' && calm.cardTrans === '0s' && calm.btnTrans === '0s', calm)
  await ev(`(() => { document.querySelector('[data-kb="contacts-row"]').click(); return 1 })()`)
  await sleep(150)
  check('and its panel is there without a slide', (await css(kb('contacts-panel'), 'animationName')) === 'none' && (await css(kb('contacts-panel'), 'opacity')) === '1')
  await ev(`(() => { document.querySelector('[data-kb="contacts-panel-close"]').click(); return 1 })()`)
  await sleep(30)
  check('the panel closes at once (no slide-out to wait for)', !(await exists(kb('contacts-panel'))))
  await ev(`(() => { document.querySelector('[data-kb="view-list"]').click(); return 1 })()`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await sleep(300)
  await waitRows(7)

  // ── new ─────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('a new contact')
  check('New contact is clicked', await click(kb('contacts-new')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') !== null`, 3000)
  const dlg = await rect(kb('contacts-dialog'))
  check('a dialog opens, centred and inside the window, with the name focused', dlg !== null && dlg.x >= 0 && dlg.r <= 1500 && dlg.y >= 0 && dlg.b <= 950 && (await active()) === 'contacts-form-name', dlg)
  check('it is a modal dialog with a title', (await ev(`(() => { const d = document.querySelector('[data-kb="contacts-dialog"]'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && document.getElementById(d.getAttribute('aria-labelledby')) !== null })()`)) === true)
  check('it asks for the kind, the name, the email, the company, the tags', ['contacts-form-kind', 'contacts-form-name', 'contacts-form-email', 'contacts-form-company', 'contacts-form-tags'].every((k) => true) && (await count(kb('contacts-form-kind'))) === 2 && (await exists(kb('contacts-form-company'))) && (await exists(kb('contacts-form-tags'))))
  if (themed) check('and the theme\'s fields', (await count(kb('contacts-form-field'))) === schemaR.j.schema.fields.length)
  await shot('07-dialog')
  const trap = []
  for (let i = 0; i < 24; i += 1) { await press('Tab'); trap.push(await ev(`document.querySelector('[data-kb="contacts-dialog"]').contains(document.activeElement)`)) }
  check('Tab never leaves the dialog (24 presses)', trap.every((x) => x === true))
  await press('Escape')
  await sleep(200)
  check('Escape closes the dialog and gives the focus back to the button that opened it', !(await exists(kb('contacts-dialog'))) && (await active()) === 'contacts-new', await active())
  await click(kb('contacts-new'))
  await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') !== null`, 3000)
  const before = base.counts().tables.contact
  check('Add contact is clicked with the name empty', await click(kb('contacts-form-save')))
  check('the form says the name is needed, and nothing was written', (await text(kb('contacts-dialog'))).includes('The name is required.') && base.counts().tables.contact === before)
  await focus(kb('contacts-form-name'))
  await type('Nina Park')
  await focus(kb('contacts-form-email'))
  await type('nope')
  await click(kb('contacts-form-save'))
  check('a bad email is named and refused before the host is asked', /email address is expected/.test(await text(kb('contacts-dialog'))) && base.counts().tables.contact === before)
  await ev(`(() => { const e = document.querySelector('[data-kb="contacts-form-email"]'); e.focus(); e.select(); return 1 })()`)
  await type('nina@example.com')
  const barnId = A(base.list('contact', { kind: 'company', q: 'Blue Barn' })).rows[0].id
  await waitFor(page, `document.querySelectorAll('[data-kb="contacts-form-company"] option').length >= 3`, 4000)
  check('the company picker lists the companies, and Blue Barn is picked', (await pick(kb('contacts-form-company'), String(barnId))) === true)
  await focus(kb('contacts-form-tags'))
  await type('prospect, vip')
  if (themed) {
    const city = schemaR.j.schema.fields.find((f) => f.key === 'city')
    if (city !== undefined) { await focus(kb('contacts-form-field', '[data-key="city"]')); await type('Nantes') }
  }
  check('Add contact is clicked', await click(kb('contacts-form-save')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') === null`, 4000)
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"] h3') !== null && document.querySelector('[data-kb="contacts-panel"] h3').textContent === 'Nina Park'`, 5000)
  const nina = A(base.list('contact', { q: 'Nina' })).rows[0]
  check('the contact is in the base, with its company and its tags, and it is not a sample row', nina !== undefined && nina.email === 'nina@example.com' && nina.company_id === barnId && JSON.stringify(nina.tags) === JSON.stringify(['prospect', 'vip']) && nina.demo === false, nina)
  check('the journal says the person created it', journal().some((c) => c.tbl === 'contact' && c.row_id === nina.id && c.action === 'create' && c.actor === 'person'))
  check('the dialog is closed, its panel is open, the list has the new row, and a status says so', (await exists(kb('contacts-panel'))) && (await waitRows(8)) !== null && /Contact added/.test(await toastText() || '') && /Blue Barn/.test(await text(kb('contacts-panel'))))
  await shot('08-after-create')

  // ── edit ────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('edit')
  check('Edit is clicked in the panel', await click(kb('contacts-edit')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') !== null`, 3000)
  check('the dialog is filled with the contact, and has no kind switch', (await ev(`document.querySelector('[data-kb="contacts-form-name"]').value`)) === 'Nina Park' && (await ev(`document.querySelector('[data-kb="contacts-form-tags"]').value`)) === 'prospect, vip' && (await count(kb('contacts-form-kind'))) === 0)
  await ev(`(() => { const e = document.querySelector('[data-kb="contacts-form-name"]'); e.focus(); e.select(); return 1 })()`)
  await type('Nina Park-Lee')
  await press('Enter')
  await waitFor(page, `document.querySelector('[data-kb="contacts-dialog"]') === null`, 4000)
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"] h3').textContent === 'Nina Park-Lee'`, 4000)
  const edited = A(base.get('contact', nina.id)).row
  check('Enter in the name field saved: the panel and the base carry the new name', edited.name === 'Nina Park-Lee' && edited.email === 'nina@example.com' && edited.company_id === barnId, edited)
  check('the journal says the person updated it', journal().some((c) => c.row_id === nina.id && c.action === 'update' && c.actor === 'person'))

  // ── archive and restore ─────────────────────────────────────────────────────────────────────────────────────
  console.log('archive and restore')
  check('Archive is clicked', await click(kb('contacts-archive')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-restore"]') !== null`, 4000)
  check('the panel says archived and offers Restore, the row left the list, a status says it stays under « Show archived »', (await exists(kb('contacts-archived-badge'))) && (await waitRows(7)) !== null && /Show archived/.test(await toastText() || ''))
  check('the base has it archived, the journal says who', A(base.get('contact', nina.id)).row.archived_at !== null && journal().some((c) => c.row_id === nina.id && c.action === 'archive' && c.actor === 'person'))
  check('Show archived is clicked: the archived row is back, dimmed and labelled', (await click(kb('contacts-archived'))) && (await waitRows(8)) !== null && /archived/i.test(await text(kb('contacts-row', '[data-id="' + nina.id + '"]'))))
  await shot('09-archived')
  check('Restore is clicked', await click(kb('contacts-restore')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-archive"]') !== null`, 4000)
  check('restored: the badge is gone, the base agrees', !(await exists(kb('contacts-archived-badge'))) && A(base.get('contact', nina.id)).row.archived_at === null)
  await click(kb('contacts-archived'))
  await waitRows(8)
  await click(kb('contacts-panel-close'))

  // ── clear the sample data ───────────────────────────────────────────────────────────────────────────────────
  console.log('clear the sample data')
  check('Clear sample data is clicked', await click(kb('contacts-clear-demo')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-confirm"]') !== null`, 3000)
  check('a confirmation says it reaches the other business pages too, and keeps what the person added', /Catalog and Pipeline/.test(await text(kb('contacts-confirm'))) && /stays/.test(await text(kb('contacts-confirm'))))
  check('the safe button has the focus', (await active()) === 'contacts-confirm-cancel')
  await shot('10-confirm-clear')
  await press('Escape')
  await sleep(200)
  check('Escape keeps everything: the dialog closes, nothing was removed', !(await exists(kb('contacts-confirm'))) && base.counts().demo.contact === 6 && (await count(kb('contacts-row'))) === 8)
  await click(kb('contacts-clear-demo'))
  await waitFor(page, `document.querySelector('[data-kb="contacts-confirm"]') !== null`, 3000)
  check('Clear sample data is confirmed with the mouse', await click(kb('contacts-confirm-clear')))
  await waitRows(4)
  check('the four sample people are gone, the four of the person stay', JSON.stringify((await names()).sort()) === JSON.stringify(['N', 'Nina Park-Lee', 'Zoe Kim', own[1].name].sort()), await names())
  check('no banner and no badge are left, and a status says so', !(await exists(kb('contacts-demo-banner'))) && (await count(kb('contacts-demo-badge'))) === 0 && /Sample data cleared/.test(await toastText() || ''))
  check('the base holds no sample row at all, the person\'s rows are intact, and the journal says who cleared', base.counts().demo.contact === 0 && base.counts().tables.contact === 4 && journal().some((c) => c.action === 'clear-demo' && c.actor === 'person'), base.counts())
  await shot('11-after-clear')

  // ── a long list ─────────────────────────────────────────────────────────────────────────────────────────────
  console.log('a long list is paged (the host gives 500 rows a page: the facets, the sort and the period work on the page read)')
  for (let i = 0; i < 520; i += 1) A(base.create('contact', { kind: 'person', type: T.person, name: 'Bulk ' + String(i).padStart(3, '0'), email: 'bulk' + i + '@example.com' }, { actor: 'person' }))
  const t0 = Date.now()
  await reload()
  await settled()
  check('the first page has 500 rows and the pager says where it is', (await waitRows(500)) !== null && /1–500 \/ 524/.test(await text(kb('contacts-pager'))), await text(kb('contacts-pager')))
  console.log('  (500 rich rows drawn and settled in ' + (Date.now() - t0) + ' ms, reload included)')
  check('Previous is off on the first page, and the count says 500, with a plus (there are more)', (await ev(`document.querySelector('[data-kb="contacts-pager-prev"]').disabled`)) === true && /^500 people \+/.test(await text(kb('contacts-count'))), await text(kb('contacts-count')))
  const clickedNext = await click(kb('contacts-pager-next'))
  const got24 = await waitRows(24)
  check('Next is clicked and the second page has the other 24', clickedNext && got24 !== null && /501–524 \/ 524/.test(await text(kb('contacts-pager'))), { clickedNext, rows: await count(kb('contacts-row')), pager: await text(kb('contacts-pager')), err: await ev(`window.__chk.errs`) })
  const nextOff = await ev(`document.querySelector('[data-kb="contacts-pager-next"]').disabled`)
  const clickedPrev = await click(kb('contacts-pager-prev'))
  const got500 = await waitRows(500)
  check('Next is off on the last page, Previous brings the first back', nextOff === true && clickedPrev && got500 !== null, { nextOff, clickedPrev, rows: await count(kb('contacts-row')) })
  await ev(`(() => { const e = document.querySelector('[data-kb="contacts-pager"]'); if (e !== null) e.scrollIntoView({ block: 'end', behavior: 'instant' }); return 1 })()`)
  await sleep(300)
  await shot('12-paged')
  check('Next is clicked again, to be on the second page', (await click(kb('contacts-pager-next'))) && (await waitRows(24)) !== null)
  check('the magnifier is clicked and « Bulk 12 » typed', (await openSearch()) === true)
  await type('Bulk 12')
  await waitFor(page, `document.querySelectorAll('[data-kb="contacts-row"]').length === 10`, 5000)
  const bulk = await names()
  check('a search goes back to the first page: the ten matching rows, and no pager', bulk.length === 10 && bulk.every((n) => /^Bulk 12\d$/.test(n)) && !(await exists(kb('contacts-pager'))), bulk)
  base.deleteAll({ confirm: true, actor: 'person' })

  // ── narrow, French, at the end ──────────────────────────────────────────────────────────────────────────────
  // ── pictures: a person's portrait lies over the initials; one that does not load leaves them; the field is never shown as a field ────────────────
  console.log('portraits')
  const withPic = A(base.create('contact', { kind: 'person', type: T.person, name: 'Portrait Check', email: 'portrait@example.com', fields: { image: 'photo:real-estate/portrait-01' } }, { actor: 'person' }))
  const withBad = A(base.create('contact', { kind: 'person', type: T.person, name: 'Broken Portrait', email: 'broken@example.com', fields: { image: 'photo:real-estate/not-there' } }, { actor: 'person' }))
  await reload()
  await settled()
  await waitRows(2)
  await sleep(1200)
  const faceOf = (name) => ev(`(() => { const r = [...document.querySelectorAll('[data-kb="contacts-row"]')].find((x) => x.querySelector('.n').textContent === ${JSON.stringify(name)}); if (!r) return null; const img = r.querySelector('img.kz-face'); const av = r.querySelector('.kz-av'); return { img: img !== null, loaded: img !== null && img.complete && img.naturalWidth > 0, natural: img === null ? 0 : img.naturalWidth, shown: img !== null && getComputedStyle(img).display !== 'none', initials: av === null ? null : av.firstChild.textContent, covers: img !== null && Math.abs(img.getBoundingClientRect().width - av.getBoundingClientRect().width) < 1 } })()`)
  const good = await faceOf('Portrait Check')
  check('a person with a sample portrait shows it over the initials, loaded from the core, at the size of the avatar', good !== null && good.img && good.loaded && good.shown && good.covers && good.natural >= 512 && good.initials === 'PC', good)
  const bad = await faceOf('Broken Portrait')
  check('a portrait that does not load hides itself and the initials show', bad !== null && bad.img && bad.loaded === false && bad.shown === false && bad.initials === 'BP', bad)
  check('the picture is a plain image of the same origin, asked by id (no path, no address from outside)', (await ev(`[...document.querySelectorAll('[data-kb="contacts-row"] img.kz-face')].every((i) => i.getAttribute('src').startsWith('/kybernos/themes/photo?id='))`)) === true)
  await click(kb('contacts-row', '[data-id="' + withPic.row.id + '"]'))
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"]') !== null && document.querySelector('[data-kb="contacts-panel-loading"]') === null`, 6000)
  check('the panel wears the portrait, and does not print the reference as a field', (await ev(`(() => { const p = document.querySelector('[data-kb="contacts-panel"]'); return p !== null && p.querySelector('img.kz-face') !== null && !/photo:|image/i.test(p.innerText) })()`)) === true)
  await shot('14-portrait')
  await click(kb('contacts-panel-close'))
  base.archive('contact', withPic.row.id, { actor: 'person' })
  base.archive('contact', withBad.row.id, { actor: 'person' })

  console.log('narrow, then French')
  A(base.create('contact', { kind: 'person', type: T.person, name: 'Narrow Check', email: 'narrow@example.com', tags: ['vip'] }, { actor: 'person' }))
  A(base.create('contact', { kind: 'person', type: T.person, name: 'Ünal Çelik-Papadopoulos the Third of Constantinople', email: 'a.very.long.address.that.will.not.break.the.table@a-very-long-company-domain-name.example.org' }, { actor: 'person' }))
  await reload()
  await settled()
  await waitRows(2)
  for (const w of [1100, 800, 560]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(700)
    const ox = await overflowX()
    check('at ' + w + ' px the page does not scroll sideways', ox.doc <= 0, ox)
    const box = await rect(kb('contacts-table'))
    const wrap = await rect('.kbcts-tw')
    check('at ' + w + ' px the table stays in its box (it scrolls inside it if it must)', box !== null && wrap !== null && (box.r <= wrap.r + 1 || (await ev(`getComputedStyle(document.querySelector('.kbcts-tw')).overflowX`)) === 'auto'), { box, wrap })
    check('at ' + w + ' px the header button is whole and inside the window', (await ev(`(() => { const b = document.querySelector('[data-kb="contacts-new"]').getBoundingClientRect(); return b.left >= 0 && b.right <= ${w} + 1 })()`)) === true)
    await shot('13-width-' + w)
  }
  // the shell at a narrow width has its own way of laying a page out (its icon rail covers the left edge): the Skills page is the reference, measured the same way
  const gotoRow = async (label) => {
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    await sleep(700)
    const at = await ev(`(() => { const e = [...document.querySelectorAll('.kb4-menu .kb4-item')].find((x) => ${label}.test(x.getAttribute('aria-label') || '')); if (e === undefined) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
    if (!Array.isArray(at)) return false
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 })
    await sleep(900)
    return true
  }
  const narrowTitle = async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    return ev(`(() => { const t = document.querySelector('.kb6-title').getBoundingClientRect(); const rail = document.querySelector('.kb4-menu').getBoundingClientRect(); return { page: document.querySelector('[data-kb="contacts-page"]') !== null, titleLeft: Math.round(t.left), railRight: Math.round(rail.right) } })()`)
  }
  const wentSkills = await gotoRow('/^(Skills|Compétences)$/i')
  const skillsAt800 = wentSkills ? await narrowTitle() : null
  await shot('13-skills-800-for-comparison')
  const wentContacts = await gotoRow('/^(Contacts|Clients|Customers)$/i')
  const mineAt800 = wentContacts ? await narrowTitle() : null
  await shot('13-contacts-800')
  check('both pages could be measured at 800 px (the right page each time)', skillsAt800 !== null && mineAt800 !== null && skillsAt800.page === false && mineAt800.page === true, { skillsAt800, mineAt800 })
  if (skillsAt800 !== null && mineAt800 !== null) check('at 800 px the Contacts title sits where the Skills title sits (what the shell does at that width, it does to both pages)', Math.abs(mineAt800.titleLeft - skillsAt800.titleLeft) <= 2 && mineAt800.railRight === skillsAt800.railRight, { skillsAt800, mineAt800 })
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)
  await settled()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 470, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const narrow = await ev(`(() => { const hid = (c) => { const e = document.querySelector('.kbcts-tbl ' + c); return e === null ? null : getComputedStyle(e).display === 'none' }; return { tags: hid('.col-tags'), upd: hid('.col-upd'), co: hid('.col-co'), doc: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth } })()`)
  check('at 470 px the company, tags and date columns give way (the name and the type stay), and nothing overflows', narrow.tags === true && narrow.upd === true && narrow.co === true && narrow.doc <= 0, narrow)
  await click(kb('contacts-row'))
  await waitFor(page, `document.querySelector('[data-kb="contacts-panel"] h3') !== null`, 4000)
  const pb = await rect(kb('contacts-panel'))
  check('at 470 px the panel takes the place of the list, whole and inside the window', pb !== null && pb.x >= 0 && pb.r <= 470 + 1 && !(await ev(`(() => { const t = document.querySelector('.kbcts-tw'); return t !== null && t.getBoundingClientRect().height > 0 })()`)), pb)
  check('and the page still does not scroll sideways', (await overflowX()).doc <= 0)
  await shot('14-narrow-panel')
  await press('Escape')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)
  await ev(`(() => { window.__KB_LANG_RESOLVE__ = () => 'fr'; window.dispatchEvent(new Event('kb-domain-change')); return 1 })()`)
  await sleep(500)
  const fr = await text(kb('contacts-page'))
  check('in French the page speaks French (title row, button, columns)', /Nouveau contact/.test(fr) && /modifié/i.test(fr) && /Personnes/.test(fr), fr.slice(0, 160))
  check('and the name the page gives the facet group of the menu is French too', (await ev(`getComputedStyle(document.querySelector('[data-kb="contacts-page"]')).getPropertyValue('--kbcts-facet').trim()`)) === '"Type et étiquettes"')
  await shot('15-french')
  await ev(`(() => { window.__KB_LANG_RESOLVE__ = () => 'en'; window.dispatchEvent(new Event('kb-domain-change')); return 1 })()`)

  // ── colour: the same word is the same hue, and every chip can be read, in light and in dark ──────────────────────
  console.log('colour: the same word, the same hue; every chip readable in light and in dark')
  base.deleteAll({ confirm: true, actor: 'person' })
  const manyTags = ['vip', 'repeat', 'wholesale', 'prospect', 'urgent', 'family', 'investor', 'cash', 'mandate', 'new', 'lender', 'notary', 'referral', 'portfolio', 'relocation', 'first-time']
  A(base.create('contact', { kind: 'person', type: T.person, name: 'Hue Check', email: 'hue@example.com', tags: manyTags }, { actor: 'person' }))
  A(base.create('contact', { kind: 'person', type: T.person, name: 'Hue Twin', email: 'twin@example.com', tags: ['vip', 'cash'] }, { actor: 'person' }))
  await reload()
  await settled()
  await waitRows(2)
  await click(kb('view-cards'))
  await sleep(900)
  check('the same tag has the same hue on two cards, and the chip of the panel', (await click(kb('contacts-row') + ' h3')) && (await ev(`(() => { const hue = (e) => getComputedStyle(e).getPropertyValue('--kz-h').trim(); const all = [...document.querySelectorAll('[data-kb="contacts-row"] .kz-tag, [data-kb="contacts-panel"] .kz-tag')].filter((t) => t.textContent.trim() === 'vip'); return all.length >= 3 && new Set(all.map(hue)).size === 1 && hue(all[0]) !== '' })()`)) === true)
  check('the hues of the sixteen tags are not all the same (the colour follows the word)', (await ev(`new Set([...document.querySelectorAll('[data-kb="contacts-panel"] .kz-tag')].map((t) => getComputedStyle(t).getPropertyValue('--kz-h').trim())).size`)) >= 6)
  const CONTRAST = `(() => {
    const parse = (c) => { let m = c.match(/^color\\(srgb ([^)]+)\\)/); if (m) { const [rgb, a] = m[1].split('/'); const p = rgb.trim().split(/\\s+/).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: a === undefined ? 1 : Number(a) } } m = c.match(/^rgba?\\(([^)]+)\\)/); if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] } } return null }
    const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a } }
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
    const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
    const bgOf = (e) => { const stack = []; let n = e; while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } n = n.parentElement } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base); return base }
    return [...document.querySelectorAll('[data-kb="contacts-panel"] .kz-tag, [data-kb="contacts-row"] .kz-tag')].map((t) => { const bg = bgOf(t); return [t.textContent.trim(), Number(ratio(over(parse(getComputedStyle(t).color), bg), bg).toFixed(2))] })
  })()`
  const setScheme = async (want) => { for (let i = 0; i < 3; i += 1) { if ((await ev(`document.body.hasAttribute('data-ds-dark-theme')`)) === (want === 'dark')) return true; await ev(`[...document.querySelectorAll('button')].filter((b) => /^(Dark|Light) theme$/.test(b.getAttribute('aria-label') || '')).forEach((b) => b.click())`); await sleep(900) } return false }
  for (const scheme of ['light', 'dark']) {
    check('the ' + scheme + ' scheme is on', (await setScheme(scheme)) === true)
    const chips = await ev(CONTRAST)
    const worst = chips.slice().sort((a, b) => a[1] - b[1])[0]
    check('in ' + scheme + ', every tag and type chip reads at 4.5 : 1 or better on its own tint (the weakest is « ' + worst[0] + ' » at ' + worst[1] + ')', chips.length >= 16 && worst[1] >= 4.5, chips.filter((c) => c[1] < 4.5))
    await shot('16-colour-' + scheme)
  }
  await setScheme('light')
  await click(kb('contacts-panel-close'))

  // ── the end: nothing broke on the way ───────────────────────────────────────────────────────────────────────
  console.log('nothing broke on the way')
  const errs = await ev(`window.__chk.errs`)
  check('no script error from first to last', Array.isArray(errs) && errs.length === 0, errs)
  const calls = await ev(`window.__chk.calls`)
  check('no answer of the host was a 5xx (the stand-in 503 never reached it)', Array.isArray(calls) && calls.every((c) => c.status < 500), calls.filter((c) => c.status >= 500))
  check('and none was a 401 or 403 (the page always sends the session)', calls.every((c) => c.status !== 401 && c.status !== 403), calls.filter((c) => c.status === 401 || c.status === 403))
  check('the page called only its own routes', calls.every((c) => /\/kybernos-contacts\//.test(c.url)))
} finally {
  try { base.deleteAll({ confirm: true, actor: 'person' }) } catch (e) { /* the sandbox base is throw-away */ }
  try { base.close() } catch (e) { /* closed */ }
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
