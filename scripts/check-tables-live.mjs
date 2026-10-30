#!/usr/bin/env node
// The Tables page (kybernos-db) on the REAL GUI of a SANDBOX, over a real database: it opens from the « Business » menu row, draws the saved view of a table, and every control of
// the bar does what it says and is SAVED by the host (each change is read back from /kybernos-db/state, with who made it): filter by conditions, sort, visible fields, the
// views (table, board, cards, calendar), the row drawer (edit, secret never shown, create with a required field), and a view that Kaby changes behind the page's back (the
// toast, Undo, the sparkle). Failure states (the host answering badly), the narrow layout (no overflow, popovers as a sheet) and the console are measured too.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-tables-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME): it writes a « Home » db into the sandbox's own home, through the service the host uses. A real mouse
// and keyboard are used where a person would use them; the <select> pickers are set through the DOM (headless Chrome has no popup). Nothing is sent to a model: « Modify view »
// is answered by a stand-in for the chat seam inside the page. --shots <dir>: one PNG per state (kept outside git: media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { cookieDeSession } from './cdp-lib.mjs'
import { dayFrom, seedHome } from './lib-tables-seed.mjs'
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

// Kaby, as the service: another process writing the db file while the host has it open (WAL lets two processes write).
const asKaby = (fn) => { const svc = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') }); try { const r = svc.byId(dbId); if (r.ok !== true) throw new Error('kaby: ' + JSON.stringify(r)); return fn(r.db) } finally { svc.close() } }

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
