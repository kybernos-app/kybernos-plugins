#!/usr/bin/env node
// Checks the Contacts page against the REAL GUI of the SANDBOX: it opens from the « Business » menu row, shows its empty, error, loaded, filtered and paged
// states, and a real mouse and keyboard search, filter, open a panel, add a note, create, edit, archive, restore and clear the sample data, while the rows are read back
// from the base to prove what was written (and by whom). Rectangles are measured (page chrome against the Skills page, overflow at a narrow width), the keyboard
// order is walked, nothing is taken on trust. With a theme installed in the sandbox the page is checked in the theme's words too (types, fields, tags).
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
  check('a kind switch is clicked while the host answers 503', await click(kb('contacts-kind', '[data-kind="company"]')))
  await waitFor(page, `document.querySelector('[data-kb="contacts-error"]') !== null`, 6000)
  check('the error state says what failed and why, with a retry', (await exists(kb('contacts-error'))) && /cannot be read right now/.test(await text(kb('contacts-error'))) && /not available in this DSH/.test(await text(kb('contacts-error'))) && (await exists(kb('contacts-retry'))))
  check('it is an alert and the New button is off while nothing can be written', (await ev(`document.querySelector('[data-kb="contacts-error"]').getAttribute('role')`)) === 'alert' && (await ev(`document.querySelector('[data-kb="contacts-new"]').disabled`)) === true)
  await shot('02-error')
  await ev(`window.__failList = false`)
  check('Retry is clicked and the page recovers', await click(kb('contacts-retry')))
  await settled()
  check('back to a normal state (the companies tab, empty)', !(await exists(kb('contacts-error'))) && (await exists(kb('contacts-empty'))) && /No companies yet/.test(await text(kb('contacts-empty'))))
  check('the New button is on again and now says company', (await ev(`document.querySelector('[data-kb="contacts-new"]').disabled`)) === false && /company/i.test(await text(kb('contacts-new'))))
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
  const rowsNow = await names()
  check('the rows come in the order the base gives (by name, upper and lower case alike)', Array.isArray(rowsNow) && rowsNow[0] === 'Bob Stone' && rowsNow.indexOf('Bob Stone') < rowsNow.indexOf('Chloé Dubois') && rowsNow.indexOf('Chloé Dubois') < rowsNow.indexOf('Léa Martin'), rowsNow)
  check('exactly the sample rows carry the « demo » badge', (await count(kb('contacts-row', '[data-demo="1"]'))) === 4 && (await count(kb('contacts-row') + ' ' + kb('contacts-demo-badge'))) === 4)
  check('the count says seven people', /^7 people/.test(await text(kb('contacts-count'))), await text(kb('contacts-count')))
  check('the sample banner explains it and offers to clear it', (await exists(kb('contacts-demo-banner'))) && (await exists(kb('contacts-clear-demo'))))
  check('a person of a company shows the company under the name, one without shows the email', (await ev(`(() => { const r = [...document.querySelectorAll('[data-kb="contacts-row"]')]; const by = (n) => r.find((x) => x.querySelector('.n').textContent === n); return by('Léa Martin').querySelector('small').textContent === 'Acme Farm' && by('Zoe Kim').querySelector('small').textContent === 'zoe@example.com' })()`)) === true)
  const tableBox = await rect(kb('contacts-table'))
  const wrapBox = await rect('.kbcts-tw')
  check('the table stays inside its box (a very long name and a very long email do not push it out)', tableBox !== null && wrapBox !== null && tableBox.r <= wrapBox.r + 1, { tableBox, wrapBox })
  check('a long name is cut with an ellipsis, not wrapped over the next row', (await ev(`(() => { const n = [...document.querySelectorAll('[data-kb="contacts-row"] .n')].find((e) => e.textContent.startsWith('Ünal')); const cs = getComputedStyle(n); return cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' })()`)) === true)
  const rowHeights = await ev(`[...document.querySelectorAll('[data-kb="contacts-row"]')].map((r) => Math.round(r.getBoundingClientRect().height))`)
  check('every row has the same height', Array.isArray(rowHeights) && Math.max(...rowHeights) - Math.min(...rowHeights) <= 1, rowHeights)
  check('the page has no horizontal scroll', (await overflowX()).doc <= 0)
  check('the tag pills on a row are at most three, the rest counted', (await ev(`(() => { const r = [...document.querySelectorAll('[data-kb="contacts-row"]')].find((x) => x.querySelector('.n').textContent.startsWith('Ünal')); return r.querySelectorAll('[data-kb="contacts-row-tag"]').length === 3 && /\\+2/.test(r.innerText) })()`)) === true)
  if (themed) {
    check('the theme\'s types are chips (All + its types) when a kind has several, and no chip row when it has one', (await count(kb('contacts-type'))) === (kindTypes('person').length > 1 ? 1 + kindTypes('person').length : 0), kindTypes('person').length)
    check('a row says its type in the theme\'s word', /Customer|Client/i.test(await text(kb('contacts-row', '[data-id="' + own[0].id + '"]'))))
  } else {
    check('with one type per kind there is no chip row', (await count(kb('contacts-type'))) === 0)
    check('a row of no particular type says Person', /Person/.test(await text(kb('contacts-row', '[data-id="' + own[0].id + '"]'))))
  }
  check('the tag filter lists the tags of the rows', (await ev(`[...document.querySelectorAll('[data-kb="contacts-tag"] option')].map((o) => o.value)`)).includes('vip'))
  await shot('03-loaded')

  // ── search, kind, tag ───────────────────────────────────────────────────────────────────────────────────────
  console.log('search, kind and tag, with a real keyboard and mouse')
  check('the search field is focused with a click', await click(kb('contacts-search')))
  await type('Martin')
  await waitRows(1)
  check('typing « Martin » leaves one row', JSON.stringify(await names()) === JSON.stringify(['Léa Martin']), await names())
  check('the count follows and the filters can be cleared', /^1 person/.test(await text(kb('contacts-count'))) && (await exists(kb('contacts-clear-filters'))))
  await ev(`(() => { const e = document.querySelector('[data-kb="contacts-search"]'); e.select(); return 1 })()`)
  await type('zzz-nobody')
  await waitFor(page, `document.querySelector('[data-kb="contacts-empty"]') !== null`, 4000)
  check('a search that finds nothing says « No contact matches » and never « No contacts yet »', (await ev(`document.querySelector('[data-kb="contacts-empty"]').getAttribute('data-why')`)) === 'filtered' && /No contact matches/.test(await text(kb('contacts-empty'))) && !/No contacts yet/.test(await text(kb('contacts-empty'))))
  await shot('04-no-match')
  check('Clear filters is clicked', await click(kb('contacts-clear-filters')))
  await waitRows(7)
  check('the full list is back and the field is empty', (await ev(`document.querySelector('[data-kb="contacts-search"]').value`)) === '' && (await names()).length === 7)
  await click(kb('contacts-search'))
  await type('zoe@')
  await waitRows(1)
  check('the search covers the email', JSON.stringify(await names()) === JSON.stringify(['Zoe Kim']), await names())
  await click(kb('contacts-clear-filters'))
  await waitRows(7)
  check('the Companies tab is clicked and lists the two companies, with no people', (await click(kb('contacts-kind', '[data-kind="company"]'))) && (await waitRows(2)) !== null && JSON.stringify(await names()) === JSON.stringify(['Acme Farm', 'Blue Barn Co-op']), await names())
  check('the add button now says company, and the count says companies', /company/i.test(await text(kb('contacts-new'))) && /2 compan/.test(await text(kb('contacts-count'))))
  await shot('05-companies')
  await click(kb('contacts-kind', '[data-kind="person"]'))
  await waitRows(7)
  check('a tag pill on a row is clicked and filters by that tag', (await click(kb('contacts-row-tag', ''))) === true)
  await settled()
  const tagValue = await ev(`document.querySelector('[data-kb="contacts-tag"]').value`)
  const tagRows = await names()
  check('the tag filter takes the value, and every remaining row carries it', tagValue !== '' && tagRows.length >= 1 && tagRows.length < 7, { tagValue, tagRows })
  await click(kb('contacts-clear-filters'))
  await waitRows(7)
  check('the tag filter is set on « vip »: Léa and Zoe', (await pick(kb('contacts-tag'), 'vip')) === true && (await waitRows(2)) !== null && JSON.stringify((await names()).sort()) === JSON.stringify(['Léa Martin', 'Zoe Kim']), await names())
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

  // ── keyboard order ──────────────────────────────────────────────────────────────────────────────────────────
  console.log('the keyboard reaches everything')
  await focus(kb('contacts-new'))
  const order = []
  for (let i = 0; i < 14; i += 1) { await press('Tab'); order.push(await active()) }
  check('from the New button, Tab reaches the search, both kinds, the archived toggle and then the rows', ['contacts-search', 'contacts-kind', 'contacts-archived', 'contacts-row'].every((k) => order.includes(k)), order)
  check('the order follows the page (search before the kinds before the rows)', order.indexOf('contacts-search') < order.indexOf('contacts-kind') && order.indexOf('contacts-kind') < order.indexOf('contacts-row'), order)
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
  await sleep(200)
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
  console.log('a long list is paged')
  for (let i = 0; i < 130; i += 1) A(base.create('contact', { kind: 'person', type: T.person, name: 'Bulk ' + String(i).padStart(3, '0'), email: 'bulk' + i + '@example.com' }, { actor: 'person' }))
  await reload()
  await settled()
  check('the first page has 100 rows and the pager says where it is', (await waitRows(100)) !== null && /1–100 \/ 134/.test(await text(kb('contacts-pager'))), await text(kb('contacts-pager')))
  check('Previous is off on the first page, and the count says 134', (await ev(`document.querySelector('[data-kb="contacts-pager-prev"]').disabled`)) === true && /^134 people/.test(await text(kb('contacts-count'))))
  const clickedNext = await click(kb('contacts-pager-next'))
  const got34 = await waitRows(34)
  check('Next is clicked and the second page has the other 34', clickedNext && got34 !== null && /101–134 \/ 134/.test(await text(kb('contacts-pager'))), { clickedNext, rows: await count(kb('contacts-row')), pager: await text(kb('contacts-pager')), err: await ev(`window.__chk.errs`) })
  const nextOff = await ev(`document.querySelector('[data-kb="contacts-pager-next"]').disabled`)
  const clickedPrev = await click(kb('contacts-pager-prev'))
  const got100 = await waitRows(100)
  check('Next is off on the last page, Previous brings the first back', nextOff === true && clickedPrev && got100 !== null, { nextOff, clickedPrev, rows: await count(kb('contacts-row')) })
  await ev(`(() => { const e = document.querySelector('[data-kb="contacts-pager"]'); if (e !== null) e.scrollIntoView({ block: 'end', behavior: 'instant' }); return 1 })()`)
  await sleep(300)
  await shot('12-paged')
  check('Next is clicked again, to be on the second page', (await click(kb('contacts-pager-next'))) && (await waitRows(34)) !== null)
  check('the search field is clicked and « Bulk 12 » typed', (await click(kb('contacts-search'))) === true)
  await type('Bulk 12')
  await waitFor(page, `document.querySelectorAll('[data-kb="contacts-row"]').length === 10`, 5000)
  const bulk = await names()
  check('a search goes back to the first page: the ten matching rows, and no pager', bulk.length === 10 && bulk.every((n) => /^Bulk 12\d$/.test(n)) && !(await exists(kb('contacts-pager'))), bulk)
  base.deleteAll({ confirm: true, actor: 'person' })

  // ── narrow, French, at the end ──────────────────────────────────────────────────────────────────────────────
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
  const narrow = await ev(`(() => { const hid = (c) => { const e = document.querySelector('.kbcts-tbl ' + c); return e === null ? null : getComputedStyle(e).display === 'none' }; return { tags: hid('.col-tags'), upd: hid('.col-upd'), doc: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth } })()`)
  check('at 470 px the tags and the date columns give way, and nothing overflows', narrow.tags === true && narrow.upd === true && narrow.doc <= 0, narrow)
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
  await shot('15-french')
  await ev(`(() => { window.__KB_LANG_RESOLVE__ = () => 'en'; window.dispatchEvent(new Event('kb-domain-change')); return 1 })()`)

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
