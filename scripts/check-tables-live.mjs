#!/usr/bin/env node
// The Tables page (kybernos-db) on the REAL GUI of a SANDBOX, over a real database: it opens from the « Business » menu row, draws the saved view of a table, and every control of
// the bar does what it says and is SAVED by the host (each change is read back from /kybernos-db/state, with who made it): filter by conditions, sort, visible fields, the
// views (table, board, cards, calendar), the row drawer (edit, secret never shown, create with a required field), and a view that Kaby changes behind the page's back (the
// toast, Undo, the sparkle), the links between tables (an order linked to a customer and products from the drawer, opened both ways, the picker, Back, a deleted
// row, « How it's built »), files (dropped on a cell, chosen in the drawer, taken off with an Undo, refused over the cap; served back byte for byte), and the failure states (the host answering badly), the narrow layout (no overflow, popovers as a sheet) and the console are measured too.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-tables-live.mjs [--shots <dir>]
//   then, after scripts/sandbox/stop.sh and start.sh: node scripts/check-tables-files-after-restart.mjs (the files attached here are found again)
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME): it writes a « Home » db into the sandbox's own home, through the service the host uses. A real mouse
// and keyboard are used where a person would use them; the <select> pickers are set through the DOM (headless Chrome has no popup). Nothing is sent to a model: « Modify view »
// is answered by a stand-in for the chat seam inside the page. --shots <dir>: one PNG per state (kept outside git: media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { cookieDeSession } from './cdp-lib.mjs'
import { FILE_FIXTURES as F, bytesOf, dayFrom, seedHome, seedPapers, seedShop, shaOf as sha } from './lib-tables-seed.mjs'
import { clickText, openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not a sandbox\'s (' + dshHome + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}

// ── the host, read the way the page reads it (GET only: every change in this check comes from the page, or from the service as Kaby) ──────────────────────────────
const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const get = async (path) => (await fetch('http://' + host + path, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })).json()
const state = async () => (await get('/kybernos-db/state'))
const dbOf = async () => (await state()).dbs.find((d) => d.name === 'Home')
const taskOf = async () => (await dbOf()).objects.find((o) => o.key === 'task')
const viewsOf = async () => (await taskOf()).views
const stampOf = async (id) => (await taskOf()).stamps[id]
const rowsOf = async (object, deleted) => (await get('/kybernos-db/records?db=' + (await dbOf()).id + '&object=' + object + (deleted ? '&deleted=1' : ''))).records
/** Waits until `fn` answers something true (the page saves 450 ms after the last change, the host is asked 3 s apart). */
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150) } return last }

const seeded = await state().catch(() => null)
if (seeded === null || seeded.ok !== true) { console.error('○ not run: the sandbox does not answer on ' + host + ' (scripts/sandbox/start.sh)'); process.exit(3) }
const today = seeded.today
const made = seedHome({ dshHome, today })
if (made.db) made.db.close()
const dbId = made.id
const shopMade = seedShop({ dshHome })
if (shopMade.db) shopMade.db.close()
const shopId = shopMade.id
const papersMade = seedPapers({ dshHome })
if (papersMade.db) papersMade.db.close()
const papersId = papersMade.id

// Kaby, as the service: another process writing the db file while the host has it open (WAL lets two processes write).
const asKaby = (fn) => { const svc = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') }); try { const r = svc.byId(dbId); if (r.ok !== true) throw new Error('kaby: ' + JSON.stringify(r)); return fn(r.db) } finally { svc.close() } }

const asKaby2 = (id, fn) => { const svc = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') }); try { const r = svc.byId(id); if (r.ok !== true) throw new Error('kaby: ' + JSON.stringify(r)); return fn(r.db) } finally { svc.close() } }

// A previous run leaves its edits behind (it is the sandbox's own db): put the rows back as the seed made them, so every run starts from the same nine tasks.
{
  const rows = (await get('/kybernos-db/records?db=' + dbId + '&object=task')).records || []
  const stale = rows.filter((r) => / \(edited\)$/.test(String(r.values.name)) || r.values.name === 'A row from the page')
  if (stale.length > 0) asKaby((db) => { for (const r of stale) { if (r.values.name === 'A row from the page') db.remove('task', r.id, 'person'); else db.update('task', r.id, { name: String(r.values.name).replace(/ \(edited\)$/, '') }, 'person') } })
  const views = (await get('/kybernos-db/state')).dbs.find((d) => d.id === dbId).objects.find((o) => o.key === 'task').views
  const extra = views.filter((v) => v.name !== 'Open tasks')
  const open = views.find((v) => v.name === 'Open tasks')
  asKaby((db) => { for (const v of extra) db.removeView('task', v.id, 'person'); if (open === undefined) return; const seedView = { name: 'Open tasks', kind: 'table', fav: true, owner: 'me', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'nin', v: ['done'] }] }, sorts: [{ k: 'due', dir: 'asc' }], hidden: ['token', 'email'] } }; db.saveView('task', Object.assign({ id: open.id }, seedView), 'person') })
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
await page.send('Runtime.enable', {})
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.innerText })()`)
const texts = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
const exists = async (sel) => (await count(sel)) > 0
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel, opts = {}) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(150)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  const modifiers = opts.shift ? 8 : 0
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers })
  await sleep(opts.wait === undefined ? 350 : opts.wait)
  return true
}
const VK = { Enter: 13, Escape: 27, Tab: 9 }
const press = async (key) => {
  const base = { key, code: key, windowsVirtualKeyCode: VK[key] }
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, key === 'Enter' ? { text: '\r' } : {}))
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base))
  await sleep(150)
}
const focus = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; e.focus(); return document.activeElement === e })()`)
/** Real typing, after the field's text is selected: replaces what it held. */
const typeInto = async (sel, s) => {
  if (!(await focus(sel))) return false
  await ev(`document.querySelector(${JSON.stringify(sel)}).select && document.querySelector(${JSON.stringify(sel)}).select()`)
  await page.send('Input.insertText', { text: s })
  await sleep(200)
  return true
}
const pick = (sel, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value === ${JSON.stringify(value)} })()`)
const bodyText = () => ev('document.body.innerText')
const overflow = () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
const ROWS = kb('tables-row')
const rowNames = () => ev(`[...document.querySelectorAll('[data-kb="tables-row"] td.ti')].map((e) => e.innerText.trim())`)
const heads = () => ev(`[...document.querySelectorAll('[data-kb="tables-table"] th')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
const closePop = async () => { if ((await count('[role="dialog"]')) > 0) { await press('Escape'); await sleep(250) } }
const openPop = async (id) => { await closePop(); await click(kb('tables-menu-' + id)); await sleep(200); return (await count('[role="dialog"]')) === 1 }

try {
  console.log('── opening ──')
  await sleep(2500)
  check('the Business group has a « Tables » row, and it opens the page', (await clickText(page, 'Tables')) === true && (await until(() => exists(kb('tables-bar')), 8000)) === true)
  await sleep(600)
  check('the bar has the views, the five menus and the primary action', (await Promise.all(['tables-view', 'tables-menu-views', 'tables-menu-fields', 'tables-menu-filter', 'tables-menu-sort', 'tables-menu-modify', 'tables-new'].map((h) => count(kb(h))))).every((n) => n >= 1))
  check('the page opens on the first table of the db, one tab per table', (await texts(kb('tables-tab'))).join('|') === 'Projects|Tasks', await texts(kb('tables-tab')))
  check('Projects is a plain table: both rows, its two fields, and the count says 2 rows', (await count(ROWS)) === 2 && (await heads()).join('|') === 'Name|Owner' && /^2 rows/.test(String(await text(kb('tables-count')))), { heads: await heads() })
  await shot('01-projects')
  check('the whole bar sits in the header row of the page, on one line', await (async () => { const a = await rect(kb('tables-menu-filter')); const b = await rect(kb('tables-new')); return a !== null && b !== null && Math.abs(a.y - b.y) < 6 })())

  console.log('── a saved view ──')
  await click(kb('tables-tab', '[data-object="task"]'))
  await sleep(500)
  const openView = (await viewsOf()).find((v) => v.name === 'Open tasks')
  check('the saved view « Open tasks » is on screen and pressed in the bar', await ev(`(() => { const b = document.querySelector('[data-kb="tables-view"][data-view=${JSON.stringify(openView.id)}]'); return b !== null && b.getAttribute('aria-pressed') === 'true' })()`))
  const nTasks = (await rowsOf('task')).length
  const expectOpen = (await rowsOf('task')).filter((r) => r.values.status !== 'done')
  check('it draws the rows its filter keeps (everything not done), and the count says so', (await count(ROWS)) === expectOpen.length && new RegExp('^' + expectOpen.length + ' of ' + nTasks + '$').test(String(await text(kb('tables-count')))), { shown: await count(ROWS), count: await text(kb('tables-count')) })
  const names = await rowNames()
  check('in the order of its sort: due date ascending, a row with no date last', names[0] === 'Send the VAT return' && names[names.length - 1] === 'No date, no status', names)
  check('it hides the two fields it hides, and shows the others', !(await heads()).some((h) => /Access code|Contact/.test(h)) && (await heads()).some((h) => /^Budget/.test(h)), await heads())
  check('the chips say what filters and sorts', /Status is none of Done/.test((await texts(kb('tables-chip'))).join(' ')) && /Sort: Due/.test((await texts(kb('tables-chip'))).join(' ')), await texts(kb('tables-chip')))
  check('a secret is nowhere in the page', !/ledger-4471/.test(String(await bodyText())))
  await shot('02-open-tasks')

  console.log('── filter ──')
  check('the Filter menu opens as a dialog and shows the saved condition', (await openPop('filter')) && (await count(kb('tables-cond'))) === 1, await count(kb('tables-cond')))
  await shot('03-filter')
  await click(kb('tables-cond-add'))
  check('adding a condition adds an unfinished row that filters nothing yet', (await count(kb('tables-cond'))) === 2 && (await count(ROWS)) === expectOpen.length)
  check('the new row takes a field and an operator, and a value', await pick(kb('tables-cond') + '[data-path="1"] select[aria-label="Field"]', 'name') && await typeInto(kb('tables-cond') + '[data-path="1"] input', 'the'))
  const withThe = expectOpen.filter((r) => /the/i.test(String(r.values.name)))
  check('the rows narrow down at once to those that match', (await until(async () => (await count(ROWS)) === withThe.length)) === true, { shown: await count(ROWS), expected: withThe.length })
  const filtered = await until(async () => { const v = (await viewsOf()).find((x) => x.id === openView.id); return v.state.flt.items.length === 2 ? v : null })
  check('the host holds the view with the two conditions, saved by the person', filtered && filtered.state.flt.items[1].op === 'contains' && filtered.state.flt.items[1].v === 'the' && (await stampOf(openView.id)).by === 'person', filtered)
  await closePop()
  check('a chip for it appears and removes it; the host follows', await (async () => {
    const chips = await count(kb('tables-chip'))
    await ev(`document.querySelectorAll('[data-kb="tables-chip"] button')[1].click()`)
    await sleep(300)
    const back = await until(async () => (await viewsOf()).find((x) => x.id === openView.id).state.flt.items.length === 1)
    return chips === 3 && back === true && (await count(ROWS)) === expectOpen.length
  })())

  console.log('── sort ──')
  await click(kb('tables-th-sort', ''), { wait: 200 })
  const sortKey = async () => (await viewsOf()).find((x) => x.id === openView.id).state.sorts
  const heading = (label) => ev(`(() => { const i = [...document.querySelectorAll('[data-kb="tables-table"] th')].findIndex((e) => e.innerText.trim().startsWith(${JSON.stringify(label)})); return i })()`)
  const sortBtn = (i) => `[data-kb="tables-table"] th:nth-child(${i + 1}) ${kb('tables-th-sort')}`
  const iBudget = await heading('Budget')
  await click(sortBtn(iBudget))
  check('a click on a heading sorts by it, ascending, and the host saves it', (await until(async () => { const s = await sortKey(); return s.length === 1 && s[0].k === 'amount' && s[0].dir === 'asc' })) === true, await sortKey())
  await click(sortBtn(iBudget))
  check('a second click reverses it', (await until(async () => { const s = await sortKey(); return s.length === 1 && s[0].dir === 'desc' })) === true, await sortKey())
  const iName = await heading('Name')
  await click(sortBtn(iName), { shift: true })
  check('shift-click adds a second sort', (await until(async () => (await sortKey()).length === 2)) === true, await sortKey())
  check('the heading says which way it sorts for assistive technology', await ev(`document.querySelector('[data-kb="tables-table"] th:nth-child(${iBudget + 1})').getAttribute('aria-sort')`) === 'descending')
  check('the Sort menu lists the two sorts and can remove one', (await openPop('sort')) && (await count(kb('tables-sort-row'))) === 2)
  await shot('04-sort')
  await closePop()
  await click(sortBtn(iName))
  await click(sortBtn(iName))
  await click(sortBtn(iName))
  check('the third click on a heading turns its sort off', (await until(async () => (await sortKey()).every((s) => s.k !== 'name'))) === true, await sortKey())

  console.log('── fields ──')
  check('the Fields menu has a switch per field and the title cannot be hidden', (await openPop('fields')) && (await count(kb('tables-field-switch'))) === 9 && (await ev(`document.querySelectorAll('[data-kb="tables-field-switch"]')[0].disabled`)) === true)
  await shot('05-fields')
  await click(kb('tables-field-switch') + ':nth-of-type(1)', { wait: 100 })
  await ev(`[...document.querySelectorAll('[data-kb="tables-field-switch"]')].find((b) => /Budget/.test(b.getAttribute('aria-label'))).click()`)
  await sleep(300)
  check('turning Budget off removes its column, and the host saves it hidden', !(await heads()).some((h) => /^Budget/.test(h)) && (await until(async () => (await viewsOf()).find((x) => x.id === openView.id).state.hidden.includes('amount'))) === true)
  await ev(`[...document.querySelectorAll('[data-kb="tables-field-switch"]')].find((b) => /Budget/.test(b.getAttribute('aria-label'))).click()`)
  await sleep(300)
  check('and on again brings it back', (await heads()).some((h) => /^Budget/.test(h)))
  await closePop()

  console.log('── views ──')
  check('the Views menu lists the views and offers the four kinds', (await openPop('views')) && (await count(kb('tables-view-pick'))) >= 1 && (await Promise.all(['table', 'board', 'cards', 'calendar'].map((k) => count(kb('tables-view-new-' + k))))).every((n) => n === 1))
  await shot('06-views')
  await click(kb('tables-view-new-board'))
  await sleep(700)
  const boardView = await until(async () => (await viewsOf()).find((v) => v.kind === 'board'))
  check('a board is made, named, and saved by the host', !!boardView && /Board/.test(boardView.name) && (await stampOf(boardView.id)).by === 'person', boardView)
  check('it has a column per status and one for no status, with every row on a card', (await count('[data-col]')) === 4 && (await count(kb('tables-card'))) === nTasks, { cols: await count('[data-col]'), cards: await count(kb('tables-card')) })
  await shot('07-board')
  await closePop()
  await openPop('views')
  await click(kb('tables-view-new-cards'))
  await sleep(500)
  check('a cards view draws a card per row', (await until(async () => (await count(kb('tables-card'))) === nTasks)) === true && (await count('[data-col]')) === 0)
  await shot('08-cards')
  await closePop()
  await openPop('views')
  await click(kb('tables-view-new-calendar'))
  await sleep(500)
  check('a calendar draws six weeks of this month, with the rows that have a date on their day', (await count(kb('tables-cal-add'))) === 42 && (await count(kb('tables-event'))) >= 3, { days: await count(kb('tables-cal-add')), events: await count(kb('tables-event')) })
  check('it says how many rows have no date, and moves to the next month and back', /without a date/.test(String(await bodyText())) && await (async () => { const was = await text('.kbtb-calh b'); await click(kb('tables-cal-next')); const next = await text('.kbtb-calh b'); await click(kb('tables-cal-prev')); return was !== next && (await text('.kbtb-calh b')) === was })())
  await shot('09-calendar')
  await closePop()
  const made3 = (await viewsOf()).filter((v) => ['board', 'cards', 'calendar'].includes(v.kind))
  check('the three new views are in the host, each saved by the person', made3.length === 3 && (await Promise.all(made3.map((v) => stampOf(v.id)))).every((s) => s.by === 'person'))
  await openPop('views')
  for (const v of made3) {
    await ev(`document.querySelector('[aria-label="Delete “' + ${JSON.stringify(v.name)} + '”"]').click()`)
    await sleep(250)
  }
  check('deleting them from the menu removes them from the host, and the table keeps its saved view', (await until(async () => (await viewsOf()).every((v) => v.kind === 'table'))) === true && (await viewsOf()).some((v) => v.id === openView.id))
  await closePop()
  await click(kb('tables-view', `[data-view=${JSON.stringify(openView.id)}]`))

  console.log('── the row drawer ──')
  const firstRow = (await rowNames())[0]
  await click(ROWS + ':nth-child(1)')
  check('a click on a row opens its drawer, one editor per field', (await exists(kb('tables-drawer'))) && (await count(kb('tables-drawer') + ' [data-kb^="tables-field-"]')) >= 8, await count(kb('tables-drawer') + ' [data-kb^="tables-field-"]'))
  await shot('10-drawer')
  check('the secret field is a password input and its value is not in the page', await ev(`document.querySelector('[data-kb="tables-field-token"]').type`) === 'password' && !/ledger-4471/.test(String(await bodyText())))
  const target = (await rowsOf('task')).find((r) => r.values.name === firstRow)
  await typeInto(kb('tables-field-name'), firstRow + ' (edited)')
  await ev(`document.querySelector('[data-kb="tables-field-name"]').blur()`)
  const saved = await until(async () => (await rowsOf('task')).find((r) => r.id === target.id && r.values.name === firstRow + ' (edited)'))
  check('editing the name saves on leaving the field, as the person', !!saved && saved.rev === target.rev + 1, saved)
  await click(kb('tables-drawer-close'))
  check('the drawer closes', !(await exists(kb('tables-drawer'))))
  await click(kb('tables-new'))
  check('New row opens an empty drawer with an Add button and no Delete', (await exists(kb('tables-create'))) && !(await exists(kb('tables-delete'))))
  await click(kb('tables-create'))
  check('adding with no name is refused on the page, nothing is written', (await rowsOf('task')).length === nTasks && /Name/.test(String(await text(kb('tables-drawer')))) && (await exists(kb('tables-drawer'))))
  await typeInto(kb('tables-field-name'), 'A row from the page')
  await ev(`document.querySelector('[data-kb="tables-field-name"]').blur()`)
  await pick(kb('tables-field-status'), 'todo')
  await click(kb('tables-create'))
  const created = await until(async () => (await rowsOf('task')).find((r) => r.values.name === 'A row from the page'))
  check('with a name, the row is written (status as chosen) and shows in the table', !!created && created.values.status === 'todo' && (await until(async () => (await rowNames()).includes('A row from the page'))) === true, created)
  check('the toast after an add offers to open the row, and Open does', /Row added/.test(String(await text(kb('tables-toast')))) && (await click(kb('tables-toast-action'))) && (await exists(kb('tables-drawer'))) && (await ev(`document.querySelector('[data-kb="tables-field-name"]').value`)) === 'A row from the page')
  await click(kb('tables-drawer-close'))

  console.log('── Kaby changes a view while the page is open ──')
  await click(kb('tables-view', `[data-view=${JSON.stringify(openView.id)}]`))
  const before = (await viewsOf()).find((v) => v.id === openView.id)
  asKaby((db) => { const r = db.saveView('task', Object.assign({}, before, { name: 'Late and open', owner: 'kaby', state: Object.assign({}, before.state, { flt: { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }, { k: 'due', op: 'before', v: { n: 0 } }] }, sorts: [{ k: 'due', dir: 'asc' }] }) }), 'agent'); if (r.ok !== true) throw new Error('kaby view: ' + JSON.stringify(r)) })
  const toast = await until(async () => { const t = await text(kb('tables-toast')); return t !== null && /Late and open/.test(t) ? t : null }, 9000)
  check('within a few seconds the page says Kaby changed the view, with an Undo', !!toast && (await exists(kb('tables-toast-action'))), toast)
  await shot('11-kaby-toast')
  check('the view on screen is the new one: renamed, filtered to late to-dos, marked as Kaby\'s', (await texts(kb('tables-view'))).some((t) => /Late and open/.test(t)) && /Status is To do/.test((await texts(kb('tables-chip'))).join(' ')) && /before today/.test((await texts(kb('tables-chip'))).join(' ')), await texts(kb('tables-chip')))
  const late = (await rowsOf('task')).filter((r) => r.values.status === 'todo' && r.values.due !== undefined && r.values.due !== null && r.values.due < today)
  check('and its rows are the ones the host\'s data says: the to-dos due before today', (await count(ROWS)) === late.length, { shown: await count(ROWS), expected: late.length })
  await click(kb('tables-toast-action'))
  const undone = await until(async () => { const v = (await viewsOf()).find((x) => x.id === openView.id); return v.name === before.name ? v : null })
  check('Undo puts the view back as it was, and the host records the person\'s hand', !!undone && JSON.stringify(undone.state) === JSON.stringify(before.state) && (await stampOf(openView.id)).by === 'person', undone)
  check('the page shows the restored view again', (await texts(kb('tables-view'))).some((t) => /Open tasks/.test(t)) && (await count(ROWS)) === (await rowsOf('task')).filter((r) => r.values.status !== 'done').length)

  console.log('── Modify view ──')
  await ev(`window.__KB_ASK__ = (t) => { window.__asked = t; return true }; true`)
  check('the Modify view menu opens with a field and examples', (await openPop('modify')) && (await exists(kb('tables-modify-input'))) && (await ev(`document.querySelectorAll('.kbtb-ex').length`)) >= 2)
  await shot('12-modify')
  check('Send is off until something is written', (await ev(`document.querySelector('[data-kb="tables-modify-send"]').disabled`)) === true)
  await typeInto(kb('tables-modify-input'), 'show overdue rows first')
  await click(kb('tables-modify-send'))
  const asked = await ev('window.__asked')
  check('Send hands Kaby a sentence naming the db, the table, the view and the request, and closes the menu', typeof asked === 'string' && asked.includes('show overdue rows first') && asked.includes(openView.id) && asked.includes(dbId) && (await count('[role="dialog"]')) === 0, asked)

  console.log('── links between tables ──')
  const shopRows = async (object) => (await get('/kybernos-db/records?db=' + shopId + '&object=' + object)).records
  const idOf = async (object, field, value) => (await shopRows(object)).find((r) => r.values[field] === value).id
  const orderOf = async (ref) => (await shopRows('order')).find((r) => r.values.ref === ref)
  const inShop = (fn) => asKaby2(shopId, fn)
  // a previous run leaves links behind: start from orders that point at nothing, and a customer that is not deleted
  inShop((db) => { for (const r of db.list('order')) db.update('order', r.id, { customer: null, items: null }, 'person'); for (const r of db.list('customer', { deleted: true })) db.restore('customer', r.id, 'person') })
  const FIELD = (key) => kb('tables-field-' + key)
  const inField = (key, hook, extra = '') => `${FIELD(key)} ${kb(hook, extra)}`
  const drawerTitle = () => text(kb('tables-drawer') + ' .kbtb-dh b')
  const activeTab = () => ev(`(document.querySelector('[data-kb="tables-tab"][aria-selected="true"]') || {}).innerText || null`)
  try {
    await ev(`window.__KB_ASK__ = (t) => { window.__asked = t; return true }; true`)
    await until(() => exists(kb('tables-db')), 9000)
    check('with two databases the page offers a picker, and choosing Shop shows its tables', (await pick(kb('tables-db'), shopId)) === true && (await until(async () => (await texts(kb('tables-tab'))).join('|') === 'Customers|Products|Orders')) === true, await texts(kb('tables-tab')))
    await click(kb('tables-tab', '[data-object="order"]'))
    await sleep(500)
    check('the Orders table draws its two orders, with the link columns empty', (await count(ROWS)) === 2 && (await heads()).join('|') === 'Reference|Customer|Products|Note', { heads: await heads() })
    const o1 = await orderOf('A-1001')
    await click(kb('tables-row', `[data-id="${o1.id}"]`) + ' ' + kb('tables-open'))
    check('an order opens in the drawer; a single link starts with a Choose… button, a many link with Add…', (await exists(kb('tables-drawer'))) && /Choose/.test(String(await text(FIELD('customer')))) && /Add/.test(String(await text(FIELD('items')))), await text(FIELD('customer')))
    // ── link the customer ──
    const ada = await idOf('customer', 'name', 'Ada Lovelace')
    const bob = await idOf('customer', 'name', 'Bob Stone')
    await click(inField('customer', 'tables-link-add'))
    check('Choose… opens a picker over the Customers rows, focus in its search', (await exists(kb('tables-link-picker'))) && (await count(kb('tables-link-option'))) === 2 && (await ev(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'tables-link-find')
    await typeInto(kb('tables-link-find'), 'ada')
    check('typing narrows the picker to what matches', (await count(kb('tables-link-option'))) === 1 && /Ada/.test(String(await text(kb('tables-link-option')))), await texts(kb('tables-link-option')))
    await shot('16-link-picker')
    await press('Escape')
    check('Escape closes the picker only: the drawer stays', !(await exists(kb('tables-link-picker'))) && (await exists(kb('tables-drawer'))))
    await click(inField('customer', 'tables-link-add'))
    await click(kb('tables-link-option', `[data-id="${ada}"]`))
    const linked = await until(async () => { const r = await orderOf('A-1001'); return r.values.customer === ada ? r : null })
    check('picking Ada writes the link on the order (by the person) and the picker closes', !!linked && !(await exists(kb('tables-link-picker'))), linked)
    check('the drawer shows Ada as a chip; the button now says Change…', (await text(inField('customer', 'tables-link', ''))) === 'Ada Lovelace' && /Change/.test(String(await text(FIELD('customer')))))
    // ── link two products: the picker stays open for the second ──
    const pen = await idOf('item', 'name', 'Pen'); const ink = await idOf('item', 'name', 'Ink')
    await click(inField('items', 'tables-link-add'))
    await click(kb('tables-link-option', `[data-id="${pen}"]`))
    check('adding a product keeps the picker open and no longer offers it', (await exists(kb('tables-link-picker'))) && (await count(kb('tables-link-option'))) === 2 && !(await exists(kb('tables-link-option', `[data-id="${pen}"]`))))
    await click(kb('tables-link-option', `[data-id="${ink}"]`))
    const two = await until(async () => { const r = await orderOf('A-1001'); return Array.isArray(r.values.items) && r.values.items.length === 2 ? r : null })
    check('the order holds both products, in the order they were picked', !!two && two.values.items[0] === pen && two.values.items[1] === ink, two)
    await press('Escape')
    // ── opened from the other side ──
    check('the order lists its customer and its products', (await texts(inField('items', 'tables-link'))).join('|') === 'Pen|Ink')
    await click(inField('customer', 'tables-link'))
    check('clicking the customer chip opens Ada, in the Customers table', (await activeTab()) === 'Customers' && (await drawerTitle()) === 'Ada Lovelace', { tab: await activeTab(), title: await drawerTitle() })
    const fromAda = await until(() => exists(kb('tables-linked-group')))
    const groupAda = await texts(kb('tables-linked-group'))
    check('Ada shows her orders under the name the link was given (Purchases), with a count and the order', fromAda === true && groupAda.length === 1 && /^Purchases 1 via Orders › Customer.*A-1001/.test(groupAda[0]), groupAda)
    await shot('17-linked-from')
    check('the drawer dates the row (created and modified), not « Invalid Date »', /Created .*\d{4}/.test(String(await text('.kbtb-stamp'))) && !/Invalid/.test(String(await text('.kbtb-stamp'))), await text('.kbtb-stamp'))
    check('the drawer has a Back button naming where we came from', (await exists(kb('tables-drawer-back'))) && /Back to A-1001/.test(String(await ev(`document.querySelector('[data-kb="tables-drawer-back"]').getAttribute('aria-label')`))))
    await click(kb('tables-drawer-back'))
    check('Back returns to the order, in the Orders table', (await activeTab()) === 'Orders' && (await drawerTitle()) === 'A-1001', { tab: await activeTab(), title: await drawerTitle() })
    await click(inField('items', 'tables-link', `[data-id="${pen}"]`))
    const fromPen = await until(() => exists(kb('tables-linked-group')))
    const groupPen = await texts(kb('tables-linked-group'))
    check('a product shows the orders that include it, under the name of the table they come from', fromPen === true && (await activeTab()) === 'Products' && groupPen.length === 1 && /^Orders 1 via Products.*A-1001/.test(groupPen[0]), groupPen)
    await click(kb('tables-linked-group') + ' ' + kb('tables-link'))
    check('and a row of that list opens the order, with Back going to the product', (await activeTab()) === 'Orders' && (await drawerTitle()) === 'A-1001' && (await exists(kb('tables-drawer-back'))))
    await click(kb('tables-drawer-close'))
    // ── from a cell of the table, no drawer open ──
    const cellChip = kb('tables-row', `[data-id="${o1.id}"]`) + ' ' + kb('tables-link', `[data-id="${ada}"]`)
    check('in the Orders table the Customer cell holds a chip that is a button', (await text(cellChip)) === 'Ada Lovelace')
    await click(cellChip)
    check('clicking it opens Ada (the click does not also open the order)', (await activeTab()) === 'Customers' && (await drawerTitle()) === 'Ada Lovelace')
    await click(kb('tables-drawer-back'))
    check('Back from there goes to the Orders table with no row open', (await activeTab()) === 'Orders' && !(await exists(kb('tables-drawer'))))
    // ── Kaby links another order while Ada is open: the list moves by itself ──
    await click(kb('tables-tab', '[data-object="customer"]'))
    await click(kb('tables-row', `[data-id="${ada}"]`) + ' ' + kb('tables-open'))
    inShop((db) => { const o2 = db.list('order').find((r) => r.values.ref === 'A-1002'); db.update('order', o2.id, { customer: ada }, 'agent') })
    const grown = await until(async () => { const g = await texts(kb('tables-linked-group')); return g.length === 1 && /^Purchases 2 /.test(g[0]) ? g[0] : null }, 9000)
    check('an order that Kaby links to Ada appears in her list within a few seconds', !!grown, await texts(kb('tables-linked-group')))
    await click(kb('tables-drawer-close'))
    // ── a customer with no order, and a deleted row ──
    await click(kb('tables-row', `[data-id="${bob}"]`) + ' ' + kb('tables-open'))
    const none = await until(() => exists(kb('tables-linked-group')))
    check('a customer nobody ordered for still lists the link field, empty', none === true && /None yet/.test(String(await text(kb('tables-linked-group')))) && /^Purchases 0 /.test((await texts(kb('tables-linked-group')))[0]), await texts(kb('tables-linked-group')))
    await click(kb('tables-drawer-close'))
    inShop((db) => db.remove('customer', ada, 'agent'))
    await click(kb('tables-tab', '[data-object="order"]'))
    const gone = await until(async () => (await count(kb('tables-link-gone'))) >= 1, 9000)
    check('a customer deleted behind the page leaves the chip on the order, marked as a removed link', gone === true && /Removed link/.test(String(await text(kb('tables-link-gone')))), await texts(kb('tables-row')))
    await shot('18-removed-link')
    inShop((db) => db.restore('customer', ada, 'agent'))
    const back = await until(async () => (await count(kb('tables-link-gone'))) === 0 && (await count(cellChip)) === 1, 9000)
    check('and when the row is restored the chip is a link again', back === true)
    // ── take a link off ──
    await click(kb('tables-row', `[data-id="${o1.id}"]`) + ' ' + kb('tables-open'))
    await click(inField('items', 'tables-link-remove'))
    const oneLeft = await until(async () => { const r = await orderOf('A-1001'); return Array.isArray(r.values.items) && r.values.items.length === 1 ? r : null })
    check('the × on a product chip takes that link off and keeps the other', !!oneLeft && oneLeft.values.items[0] === ink, oneLeft)
    await click(inField('customer', 'tables-link-remove'))
    const noCustomer = await until(async () => { const r = await orderOf('A-1001'); return r.values.customer === null || r.values.customer === undefined ? r : null })
    check('the × on a single link empties it', !!noCustomer, noCustomer)
    check('the drawer shows it empty again (Choose…)', /Choose/.test(String(await text(FIELD('customer')))))
    await click(kb('tables-drawer-close'))
    // ── a new row with links ──
    await click(kb('tables-new'))
    await typeInto(FIELD('ref') , 'A-2000')
    await click(inField('customer', 'tables-link-add'))
    await click(kb('tables-link-option', `[data-id="${bob}"]`))
    check('in a new row the chip is shown but does not navigate (the row is not saved yet)', (await text(inField('customer', 'tables-link'))) === null && /Bob Stone/.test(String(await text(FIELD('customer')))))
    await click(kb('tables-create'))
    const fresh = await until(async () => (await orderOf('A-2000')) || null)
    check('Add writes the new order with its link', !!fresh && fresh.values.customer === bob, fresh)
    inShop((db) => { const r = db.list('order').find((x) => x.values.ref === 'A-2000'); if (r) db.remove('order', r.id, 'person') })
    await click(kb('tables-drawer-close'))
    // ── the narrow layout ──
    await until(async () => !(await exists(kb('tables-toast'))), 12000) // the « Row added » toast is fixed to the bottom and would sit on the button
    await click(kb('tables-row', `[data-id="${o1.id}"]`) + ' ' + kb('tables-open'))
    await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    // the drawer sits under the table at this width and the page is still settling after the resize: bring the button in, wait, then click where it ended up
    await ev(`document.querySelector('[data-kb="tables-field-items"] [data-kb="tables-link-add"]').scrollIntoView({ block: 'nearest', behavior: 'instant' })`)
    await sleep(400)
    await click(inField('items', 'tables-link-add'))
    check('at 420 px the drawer with its picker open does not overflow the page sideways', (await overflow()) <= 1 && (await exists(kb('tables-link-picker'))), await overflow())
    await shot('19-narrow-picker')
    await press('Escape')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    await click(kb('tables-drawer-close'))

    console.log('── how it is built ──')
    check('the strip has a « How it\'s built » button', (await exists(kb('tables-built'))) && /How it.s built/.test(String(await text(kb('tables-built')))))
    await click(kb('tables-built'))
    const cards = await texts(kb('tables-built-table'))
    check('it opens the fields of every table, the links named with their target and how many', cards.length === 3 && /Link to Customers · one/.test(cards[2]) && /Link to Products · many/.test(cards[2]), cards)
    check('the customers card lists the link as seen from there (Purchases) and the products card the default name (Orders)', /Linked from other tables[\s\S]*Purchases[\s\S]*from Orders › Customer/.test(cards[0]) && /Orders[\s\S]*from Orders › Products/.test(cards[1]), cards)
    await shot('20-built-fields')
    await click(kb('tables-built-tab', '[data-tab="map"]'))
    check('the map draws one box per table and one line per link', (await count(kb('tables-map-node'))) === 3 && (await count(kb('tables-map-link'))) === 2)
    const boxes = await ev(`[...document.querySelectorAll('[data-kb="tables-map-node"]')].map((g) => { const r = g.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] })`)
    const apart = boxes.every((a, i) => boxes.every((b, j) => i === j || a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]))
    const svgBox = await rect(kb('tables-map'))
    check('no two boxes overlap, and the drawing fits its frame', apart && svgBox !== null && svgBox.w > 300 && (await overflow()) <= 1, { boxes, svgBox })
    check('the same links are listed as text below', (await texts(kb('tables-map-list') + ' li')).length === 2)
    await shot('21-built-map')
    await click(kb('tables-map-node', '[data-object="item"]'))
    check('clicking a box on the map opens that table', (await activeTab()) === 'Products')
    await press('Escape')
    check('Escape closes the panel', !(await exists(kb('tables-built-panel'))))
  } finally {
    await closePop()
    if (await exists(kb('tables-drawer'))) await click(kb('tables-drawer-close'))
    await pick(kb('tables-db'), dbId)
    await sleep(500)
    await click(kb('tables-tab', '[data-object="task"]'))
    await sleep(400)
  }


  console.log('── files ──')
  const inPapers = (fn) => asKaby2(papersId, fn)
  // a previous run leaves files on the rows: start from rows that hold none
  inPapers((db) => { for (const r of db.list('doc')) db.update('doc', r.id, { files: null }, 'person') })
  const docRows = async () => (await get('/kybernos-db/records?db=' + papersId + '&object=doc')).records
  const docId = async (name) => (await docRows()).find((r) => r.values.name === name).id
  const filesOf = async (name) => (await docRows()).find((r) => r.values.name === name).values.files || []
  const raw = (path, withCookie = true) => fetch('http://' + host + path, { headers: withCookie ? { cookie: cookie.nom + '=' + cookie.valeur } : {} })
  const blobDir = join(dshHome, 'kybernos', 'kybernos-db', 'dbs', papersId, 'blobs')
  const blobCount = () => { try { return readdirSync(blobDir).length } catch (e) { return 0 } }
  const fileUrl = (id, f) => '/kybernos-db/file?db=' + papersId + '&object=doc&id=' + id + '&field=files&hash=' + sha(f)
  // a drop and a choice the way a browser makes them: real File objects in a real DataTransfer
  const MAKE = `const mk = (f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }); const dt = (list) => { const d = new DataTransfer(); for (const f of list) d.items.add(mk(f)); return d }`
  const dropOn = (sel, list) => ev(`(() => { ${MAKE}; const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; const data = dt(${JSON.stringify(list)}); for (const t of ['dragenter', 'dragover', 'drop']) e.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: data })); return true })()`)
  const chooseIn = (sel, list) => ev(`(() => { ${MAKE}; const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; e.files = dt(${JSON.stringify(list)}).files; e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const decoded = (sel, width) => ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); return i !== null && i.complete && i.naturalWidth === ${width} })()`)

  const picked = await until(() => pick(kb('tables-db'), papersId), 9000) // the page learns of a db the host made a moment ago at its next poll
  const docsTab = await until(async () => (await texts(kb('tables-tab'))).join('|') === 'Docs', 9000)
  check('choosing Papers shows its one table, Docs, with a Files column', picked === true && docsTab === true && (await heads()).join('|') === 'Name|Files', { picked, docsTab, tabs: await texts(kb('tables-tab')), heads: await heads() })
  const contract = await docId('Contract')
  const receipts = await docId('Receipts')
  const cell = kb('tables-row', `[data-id="${contract}"]`) + ' ' + kb('tables-cell-files')
  const chip = (f) => cell + ' ' + kb('tables-file', `[data-hash="${sha(f)}"]`)
  check('a row with no file has an empty Files cell', (await exists(cell)) && (await count(cell + ' ' + kb('tables-file'))) === 0)
  // ── dropped on a cell ──
  const blobsBefore = blobCount()
  await dropOn(cell, [F.png, F.pdf])
  const two = await until(async () => { const l = await filesOf('Contract'); return l.length === 2 ? l : null }, 9000)
  check('dropping an image and a PDF on the cell attaches both: the host holds their names, types, sizes and sha256', !!two && two[0].name === 'logo.png' && two[0].type === 'image/png' && two[0].size === bytesOf(F.png).length && two[0].hash === sha(F.png) && two[1].name === 'contract.pdf' && two[1].type === 'application/pdf' && two[1].hash === sha(F.pdf), two)
  check('and the host keeps the bytes next to the db, once each', blobCount() >= 2 && blobCount() - blobsBefore <= 2, { before: blobsBefore, after: blobCount() })
  check('the toast says two files were added', /2 files added/.test(String(await text(kb('tables-toast')))), await text(kb('tables-toast')))
  check('the cell draws the picture as a thumbnail that decoded, and the PDF by its name', (await until(() => decoded(chip(F.png) + ' img', 12), 6000)) === true && /contract\.pdf/.test(String(await text(chip(F.pdf)))), await text(cell))
  await shot('22-files-cell')
  const rPng = await raw(fileUrl(contract, F.png))
  const bPng = Buffer.from(await rPng.arrayBuffer())
  check('the host serves the image back byte for byte, in place, with nothing for the browser to sniff and a closed content-security-policy', rPng.status === 200 && rPng.headers.get('content-type') === 'image/png' && rPng.headers.get('content-disposition') === null && rPng.headers.get('x-content-type-options') === 'nosniff' && rPng.headers.get('content-security-policy') === "default-src 'none'; sandbox" && bPng.equals(bytesOf(F.png)), { status: rPng.status, type: rPng.headers.get('content-type') })
  const rPdf = await raw(fileUrl(contract, F.pdf))
  check('the PDF is handed over as a download, never as a document of DSH\'s own origin, and it is the very bytes', rPdf.status === 200 && rPdf.headers.get('content-type') === 'application/octet-stream' && rPdf.headers.get('content-disposition') === 'attachment' && Buffer.from(await rPdf.arrayBuffer()).equals(bytesOf(F.pdf)), rPdf.headers.get('content-type'))
  check('a file the row does not hold is not served, and nothing is served without the session', (await raw(fileUrl(contract, F.txt))).status === 404 && (await raw(fileUrl(contract, F.png), false)).status === 401)
  check('the chip of an image opens it in a new tab that cannot reach the page, and the chip of a PDF downloads it under its own name', await ev(`(() => { const a = document.querySelector(${JSON.stringify(chip(F.png) + ' a')}); const b = document.querySelector(${JSON.stringify(chip(F.pdf) + ' a')}); return a !== null && a.target === '_blank' && a.rel.includes('noopener') && a.getAttribute('href').startsWith('/kybernos-db/file?') && b !== null && b.getAttribute('download') === 'contract.pdf' && b.target !== '_blank' })()`))
  // ── a drag that carries no file is left alone; a file twice is said ──
  const noFileDrag = await ev(`(() => { const e = document.querySelector(${JSON.stringify(cell)}); const d = new DataTransfer(); d.setData('text/plain', 'hello'); const o = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: d }); e.dispatchEvent(o); const x = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d }); e.dispatchEvent(x); return [o.defaultPrevented, x.defaultPrevented] })()`)
  await sleep(500)
  check('dragging text over the cell is not a drop of files: the page does not take it', JSON.stringify(noFileDrag) === '[false,false]' && (await filesOf('Contract')).length === 2, noFileDrag)
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  await dropOn(cell, [F.png])
  const same = await until(async () => { const t = await text(kb('tables-toast')); return t !== null && /already there/.test(t) ? t : null }, 6000)
  check('the same file dropped again is said to be already there, and the row is unchanged', !!same && (await filesOf('Contract')).length === 2, same)
  // ── over the cap: refused before a byte is sent ──
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  const sentBefore = blobCount()
  await dropOn(cell, [F.big])
  const refused = await until(async () => { const t = await text(kb('tables-toast')); return t !== null && /over/.test(t) ? t : null }, 6000)
  check('a file over the field\'s cap is refused with its name and the cap', !!refused && /big\.bin/.test(refused) && /20 KB/.test(refused), refused)
  check('and nothing was sent or written for it', blobCount() === sentBefore && (await filesOf('Contract')).length === 2, { blobs: blobCount(), was: sentBefore })
  // ── the drawer ──
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  await click(kb('tables-row', `[data-id="${contract}"]`) + ' ' + kb('tables-open'))
  check('the drawer lists the two files with a picture for the image, the name and the size', (await count(FIELD('files') + ' ' + kb('tables-file'))) === 2 && (await decoded(FIELD('files') + ' img.kbtb-thumb', 12)) === true && /contract\.pdf/.test(String(await text(FIELD('files')))) && /KB|B\b/.test(String(await text(FIELD('files')))), await text(FIELD('files')))
  check('it says the cap before anything is tried', /20 KB/.test(String(await text(FIELD('files') + ' ' + kb('tables-drop')))), await text(FIELD('files') + ' ' + kb('tables-drop')))
  await shot('23-files-drawer')
  await chooseIn(FIELD('files') + ' ' + kb('tables-file-input'), [F.txt])
  const three = await until(async () => { const l = await filesOf('Contract'); return l.length === 3 ? l : null }, 9000)
  check('choosing a text file in the drawer adds it after the others', !!three && three[2].name === 'notes.txt' && three[2].hash === sha(F.txt), three)
  check('a text file has an icon, not a picture, and a link that downloads', (await count(FIELD('files') + ' img.kbtb-thumb')) === 1 && await ev(`(() => { const a = document.querySelector(${JSON.stringify(FIELD('files') + ' ' + kb('tables-file', `[data-hash="${sha(F.txt)}"]`) + ' a')}); return a !== null && a.hasAttribute('download') && a.target !== '_blank' })()`))
  const rTxt = await raw(fileUrl(contract, F.txt))
  check('and the host hands it over as a download, never as a page of its own', rTxt.headers.get('content-type') === 'application/octet-stream' && /^attachment/.test(rTxt.headers.get('content-disposition') || '') && (rTxt.headers.get('content-security-policy') || '').includes('sandbox'), rTxt.headers.get('content-disposition'))
  const blobsKept = blobCount()
  await chooseIn(FIELD('files') + ' ' + kb('tables-file-input'), [F.big])
  const note = await until(async () => { const t = await text(kb('tables-file-error')); return t })
  check('a file over the cap chosen in the drawer is said on the spot, and the row keeps its three files', /big\.bin/.test(String(note)) && /20 KB/.test(String(note)) && (await filesOf('Contract')).length === 3 && blobCount() === blobsKept, note)
  // ── take one off, Undo ──
  await click(FIELD('files') + ' ' + kb('tables-file', `[data-hash="${sha(F.txt)}"]`) + ' ' + kb('tables-file-remove'))
  const removed = await until(async () => { const l = await filesOf('Contract'); return l.length === 2 ? l : null })
  check('the × in the drawer takes that file off and keeps the others', !!removed && removed.every((f) => f.hash !== sha(F.txt)), removed)
  check('the toast says so and offers Undo', /File removed/.test(String(await text(kb('tables-toast')))) && (await exists(kb('tables-toast-action'))))
  await click(kb('tables-toast-action'))
  const back3 = await until(async () => { const l = await filesOf('Contract'); return l.length === 3 ? l : null })
  check('Undo puts the file back where it was, and the file is served again', !!back3 && back3.map((f) => f.hash).join() === [F.png, F.pdf, F.txt].map(sha).join() && (await raw(fileUrl(contract, F.txt))).status === 200, back3)
  await click(kb('tables-drawer-close'))
  // ── take one off from the cell ──
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  check('the cell shows three files, or two and a count', (await count(cell + ' ' + kb('tables-file'))) === 3)
  const over = await rect(chip(F.png))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: over.x + over.w / 2, y: over.y + over.h / 2 })
  await sleep(300)
  check('hovering a chip shows its ×, whole and inside the table', await ev(`(() => { const b = document.querySelector(${JSON.stringify(chip(F.png) + ' ' + kb('tables-file-remove'))}); const w = document.querySelector('.kbtb-tblwrap').getBoundingClientRect(); const r = b.getBoundingClientRect(); return getComputedStyle(b).opacity === '1' && r.left >= w.left && r.right <= w.right && r.top >= w.top && r.bottom <= w.bottom })()`))
  await shot('25-files-hover')
  await click(chip(F.png) + ' ' + kb('tables-file-remove'))
  const cellOff = await until(async () => { const l = await filesOf('Contract'); return l.length === 2 ? l : null })
  check('the × on a chip of the cell takes that file off, without opening the row', !!cellOff && cellOff.every((f) => f.hash !== sha(F.png)) && !(await exists(kb('tables-drawer'))), cellOff)
  await click(kb('tables-toast-action'))
  check('and Undo from there puts it back too', !!(await until(async () => (await filesOf('Contract')).length === 3)))
  // ── a new row with files, and a failed send ──
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  await click(kb('tables-row', `[data-id="${receipts}"]`) + ' ' + kb('tables-open'))
  await ev(`(() => { window.__realFetch2 = window.fetch; window.fetch = (u, o) => (String(u).includes('/kybernos-db/upload') ? Promise.reject(new TypeError('failed')) : window.__realFetch2(u, o)); return 1 })()`)
  await chooseIn(FIELD('files') + ' ' + kb('tables-file-input'), [F.txt])
  const failNote = await until(async () => text(kb('tables-file-error')))
  check('when the host cannot be reached the file is said not to have been added, and the row is untouched', /notes\.txt/.test(String(failNote)) && /does not answer/.test(String(failNote)) && (await filesOf('Receipts')).length === 0, failNote)
  await ev(`window.fetch = window.__realFetch2; true`)
  await click(kb('tables-drawer-close'))
  await click(kb('tables-new'))
  await typeInto(FIELD('name'), 'Taxes')
  await chooseIn(FIELD('files') + ' ' + kb('tables-file-input'), [F.txt, F.png])
  check('in a new row the files are listed by name only (the host serves a file to the row that holds it)', (await until(async () => (await count(FIELD('files') + ' ' + kb('tables-file'))) === 2)) === true && (await count(FIELD('files') + ' img')) === 0 && (await count(FIELD('files') + ' a')) === 0)
  await click(kb('tables-create'))
  const taxes = await until(async () => { const r = (await docRows()).find((x) => x.values.name === 'Taxes'); return r && Array.isArray(r.values.files) && r.values.files.length === 2 ? r : null }, 9000)
  check('Add writes the new row with both files, and they are served', !!taxes && (await raw(fileUrl(taxes.id, F.png))).status === 200, taxes && taxes.values)
  inPapers((db) => { const r = db.list('doc').find((x) => x.values.name === 'Taxes'); if (r) db.remove('doc', r.id, 'person') })
  // ── narrow ──
  await until(async () => !(await exists(kb('tables-toast'))), 12000)
  await click(kb('tables-row', `[data-id="${contract}"]`) + ' ' + kb('tables-open'))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  check('at 420 px the drawer with its files and the box does not overflow the page sideways', (await overflow()) <= 1 && (await exists(FIELD('files') + ' ' + kb('tables-drop'))), await overflow())
  await shot('24-files-narrow')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  await click(kb('tables-drawer-close'))
  await pick(kb('tables-db'), dbId)
  await sleep(500)
  await click(kb('tables-tab', '[data-object="task"]'))
  await sleep(400)

  console.log('── failure states ──')
  await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, o) => (String(u).includes('/kybernos-db/state') ? Promise.reject(new TypeError('failed')) : window.__realFetch(u, o)); return 1 })()`)
  const stale = await until(async () => (await exists(kb('tables-stale'))) || (await exists(kb('tables-error'))), 9000)
  check('when the host stops answering, the page says so and keeps showing what it had', stale === true && (await count(ROWS)) > 0, await bodyText())
  await shot('13-stale')
  await ev(`window.fetch = window.__realFetch; true`)
  check('and recovers by itself when it answers again', (await until(async () => !(await exists(kb('tables-stale'))) && !(await exists(kb('tables-error'))), 9000)) === true)

  console.log('── narrow, dark, console ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  check('at 420 px nothing overflows the page sideways', (await overflow()) <= 1, await overflow())
  check('the Filter menu is a sheet fixed to the bottom of the screen', (await openPop('filter')) && await ev(`(() => { const e = document.querySelector('[role="dialog"]'); const r = e.getBoundingClientRect(); return getComputedStyle(e).position === 'fixed' && innerHeight - r.bottom <= 16 && innerHeight - r.bottom >= 0 && r.left >= 0 && r.right <= innerWidth + 1 })()`))
  await shot('14-narrow-filter')
  await closePop()
  await shot('15-narrow')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const errors = (page.errs || []).filter((e) => !/Failed to load resource|favicon|net::ERR|ResizeObserver/.test(e))
  check('no console error from the page', errors.length === 0, errors)
} catch (e) {
  fail += 1
  console.log('  ✗ the run stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close()
}
console.log('\ncheck-tables-live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
