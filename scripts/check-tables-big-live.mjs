#!/usr/bin/env node
// A table bigger than one page on the Tables page, on the REAL GUI of a SANDBOX: the real-estate template's Properties table is filled past 5,000 rows, then the page is
// searched, sorted and filtered the way a person does it. The page holds the first 5,000 rows that match and the host searches the whole table; the count says so.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-tables-big-live.mjs [--shots <dir>]
//
// What it checks, in a real page:
//   1. a table of 5,100+ rows is counted whole (« 5,1xx rows · the first 5,000 ») and drawn 200 rows at a time;
//   2. a search for a row the first 5,000 do not hold (the last one made) finds it, and the count says « 1 of 5,1xx »;
//   3. typing asks the host once the person pauses, not at every key;
//   4. clearing the search puts the table back; a sort made on the column header is made by the host, whole (the first row is the host's own first row);
//   5. a small table of the same app is still searched in the page, with no request to the host;
//   6. no console error.
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME): it seeds the real-estate template and adds ~5,100 rows to its Properties table (kept; a later run adds
// only what is missing). The Tables bundle must be on in the sandbox profile. Nothing is sent to a model. Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not a sandbox\'s (' + dshHome + ')'); process.exit(3) }

const WANT = 5100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}
const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const get = async (path) => (await fetch('http://' + host + path, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })).json()

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name) => `[data-kb="${name}"]`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const until = async (fn, ms = 9000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(250) } return last }
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`)
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(150)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(400)
  return true
}
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`, 30000)
// what the page asked the host for, from the browser's own resource timing
const asked = () => ev(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/kybernos-db/records')).map((n) => new URL(n).search)`)
const find = '.kbtb-find input, [data-kb="tables-bar"] input[type="search"], input[type="search"]'
// the search box is React's: set the value the way the browser does and tell it, one key at a time
const setSearch = (value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(find)}); if (e === null) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const typeInto = async (value, gap = 45) => { for (let k = 1; k <= value.length; k += 1) { await setSearch(value.slice(0, k)); await sleep(gap) } }
const clearSearch = () => setSearch('')

try {
  await page.send('Runtime.enable', {})
  await sleep(2500)
  const seeded = await post('/kybernos/themes', { action: 'seed', id: 'kybernos-themes/real-estate', lang: 'en' })
  const dbId = seeded.json && seeded.json.db
  check('the real-estate database exists (made now or by an earlier run)', seeded.status === 200 && typeof dbId === 'string', seeded)
  let state = await get('/kybernos-db/state')
  const db = state.dbs.find((d) => d.id === dbId)
  const obj = db && db.objects.find((o) => o.key === 'property')
  check('it has a Properties table', obj !== undefined && obj !== null, db && db.objects.map((o) => o.key))
  const titleKey = obj.title
  const required = obj.fields.filter((f) => f.required === true || f.key === titleKey)
  const valueFor = (f, i) => (f.type === 'number' || f.type === 'money' ? i : f.type === 'choice' ? f.options[0].key : f.type === 'date' ? '2026-01-01' : f.type === 'email' ? 'p' + i + '@example.com' : 'Zeta lot ' + i)
  const make = (i) => { const v = {}; for (const f of required) v[f.key] = f.key === titleKey ? 'Zeta lot ' + i : valueFor(f, i); return v }
  const probe = await post('/kybernos-db/write', { db: dbId, object: 'property', op: 'create', values: make(0) })
  check('a row can be made with the required fields only', probe.json && probe.json.ok === true, probe)

  // fill the table past a page: batches of 25 writes at a time, only what is missing
  state = await get('/kybernos-db/state')
  let have = state.dbs.find((d) => d.id === dbId).objects.find((o) => o.key === 'property').count
  const t0 = Date.now()
  for (let i = have; have < WANT && Date.now() - t0 < 240000; i += 25) {
    const rows = Array.from({ length: 25 }, (_, k) => make(i + k))
    const r = await ev(`(async () => { let ok = 0; await Promise.all(${JSON.stringify(rows)}.map((values) => fetch('/kybernos-db/write', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ db: ${JSON.stringify(dbId)}, object: 'property', op: 'create', values }) }).then((x) => x.json()).then((j) => { if (j.ok) ok += 1 }))); return ok })()`, 60000)
    have += typeof r === 'number' ? r : 0
    if (typeof r !== 'number') { console.log('     (batch stopped: ' + JSON.stringify(r).slice(0, 200) + ')'); break }
  }
  state = await get('/kybernos-db/state')
  const total = state.dbs.find((d) => d.id === dbId).objects.find((o) => o.key === 'property').count
  check('the Properties table holds more than one page of rows (' + total + ')', total > 5000, total)
  const last = (await get('/kybernos-db/records?db=' + dbId + '&object=property&limit=50000')).records.map((r) => r.values[titleKey]).filter((t) => /^Zeta lot \d+$/.test(t)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))[0]
  check('a row exists that the first 5,000 do not hold', typeof last === 'string' && Number(last.slice(9)) > 5000 - 20, last)

  // the page
  check('the Apps page opens the gallery (reached from Creations: its menu row is folded into it)', (await ev(`window.__KB_OPEN__({ view: 'tables' }) === true`)) === true && (await until(() => ev(`document.querySelector('[data-kb="apps-gallery"]') !== null`))) === true)
  check('the real-estate app\'s card opens its tables', (await click(`${kb('apps-card')}[data-db="${dbId}"] ${kb('apps-open')}`)) === true && (await until(() => count(kb('tables-tab')).then((n) => n > 0))) === true)
  await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === 'property'); if (t) t.setAttribute('data-chk', 'tab'); return 1 })()`)
  check('the Properties tab opens', (await click('[data-chk="tab"]')) === true && (await until(() => count(kb('tables-row') + ', ' + kb('tables-card')).then((n) => n > 0))) === true)
  await sleep(1500)
  // a view is a button in the bar when it is a favourite, else a line of the Views menu
  const openView = async (name) => {
    const mark = (sel) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim() === ${JSON.stringify(name)}); if (b) b.setAttribute('data-chk', 'view'); return b !== undefined })()`)
    if ((await mark(kb('tables-view'))) !== true) {
      await click(kb('tables-menu-views'))
      if ((await mark(kb('tables-view-pick'))) !== true) return false
    }
    const ok = await click('[data-chk="view"]')
    await ev(`(() => { const b = document.querySelector('[data-chk="view"]'); if (b) b.removeAttribute('data-chk'); return 1 })()`)
    return ok
  }
  check('the List view opens', (await openView('List')) === true && (await until(() => count(kb('tables-row')).then((n) => n > 0))) === true)
  await sleep(600)
  const fmt = (n) => n.toLocaleString('en')

  const c0 = await text(kb('tables-count'))
  check('the whole table is counted and the page says how many it holds', new RegExp('^' + fmt(total) + ' rows · the first 5,000').test(c0), c0)
  check('the table is drawn 200 rows at a time', (await count(kb('tables-row'))) === 200, await count(kb('tables-row')))
  await shot('big-table')

  // a search for a row that only the host can find
  const before = (await asked()).length
  await typeInto(last)
  const found = await until(async () => { const c = await text(kb('tables-count')); return /^1 of /.test(c) ? c : false }, 12000)
  check('searching for the last row made finds it and counts « 1 of ' + fmt(total) + ' »', found === '1 of ' + fmt(total), found || await text(kb('tables-count')))
  check('that row is the one drawn', (await until(() => ev(`[...document.querySelectorAll('[data-kb="tables-open"]')].some((e) => e.title === ${JSON.stringify(last)})`))) === true)
  const mine = (await asked()).slice(before)
  check('typing ' + last.length + ' keys asked the host once or twice, not at every key', mine.filter((s) => s.includes('q=')).length >= 1 && mine.filter((s) => s.includes('q=')).length <= 2, mine)
  await shot('big-table-search')

  // back to the whole table
  await clearSearch()
  const back = await until(async () => { const c = await text(kb('tables-count')); return new RegExp('^' + fmt(total) + ' rows').test(c) ? c : false }, 12000)
  check('clearing the search puts the whole table back', typeof back === 'string' && back.includes('the first 5,000'), back || await text(kb('tables-count')))

  // a sort on the column header is made by the host, whole
  const headers = await count(kb('tables-th-sort'))
  check('the column headers sort', headers > 0, headers)
  const titleTh = await ev(`(() => { const b = [...document.querySelectorAll('[data-kb="tables-th-sort"]')][0]; if (b) b.setAttribute('data-chk', 'sort'); return b !== undefined })()`)
  check('the first column header is found', titleTh === true)
  await click('[data-chk="sort"]')
  await click('[data-chk="sort"]')
  const dir = await until(async () => { const t = await ev(`(() => { const th = document.querySelector('[data-chk="sort"]'); return th === null ? '' : th.closest('th').getAttribute('aria-sort') })()`); return t !== 'none' && t !== '' ? t : false }, 8000)
  const sorts = JSON.stringify([{ k: titleKey, dir: dir === 'descending' ? 'desc' : 'asc' }])
  await sleep(1500)
  const hostFirst = (await get('/kybernos-db/records?db=' + dbId + '&object=property&limit=1&sorts=' + encodeURIComponent(sorts))).records[0].values[titleKey]
  const pageFirst = await until(() => ev(`(document.querySelector('[data-kb="tables-open"]') || {}).title || ''`).then((t) => (t === hostFirst ? t : false)), 12000)
  check('after the sort (' + dir + ') the first row is the first of the WHOLE table, not of the first 5,000', pageFirst === hostFirst, { hostFirst, page: await ev(`(document.querySelector('[data-kb="tables-open"]') || {}).title || ''`) })
  await shot('big-table-sorted')

  // every other view of the big table draws what the page holds, and the page stays alive
  for (const [name, sel] of [['Gallery', kb('tables-card')], ['By status', kb('tables-card')], ['Map', kb('tables-map-box')]]) {
    await click('[data-kb="tables-tab"][data-object="property"]')
    const t1 = Date.now()
    const opened = await openView(name)
    const drawn = await until(() => count(sel).then((n) => (n > 0 ? n : 0)), 30000)
    const took = Date.now() - t1
    const alive = await Promise.race([ev('1+1'), sleep(4000).then(() => 'stuck')])
    check(name + ' view draws the table (' + drawn + ' elements in ' + took + ' ms) and the page answers', opened === true && drawn > 0 && alive === 2, { opened, drawn, took, alive })
    await shot('big-' + name.toLowerCase().replace(/ /g, '-'))
  }

  // a small table of the same app is searched in the page
  const small = db.objects.find((o) => o.key !== 'property' && o.count > 0 && o.count <= 5000)
  if (small === undefined) check('the app has a small table to try', false, db.objects.map((o) => [o.key, o.count]))
  else {
    await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === ${JSON.stringify(small.key)}); if (t) t.setAttribute('data-chk', 'small'); return 1 })()`)
    check('a small table opens', (await click('[data-chk="small"]')) === true && (await until(() => count(kb('tables-row')).then((n) => n > 0))) === true)
    await sleep(800)
    const b2 = (await asked()).length
    const some = await ev(`(document.querySelector('[data-kb="tables-open"]') || {}).title || ''`)
    await typeInto(some.slice(0, 4))
    await sleep(900)
    check('it is searched in the page: no request to the host for the search', (await asked()).slice(b2).filter((s) => s.includes('q=')).length === 0, (await asked()).slice(b2))
    check('and the count follows', /\d+ of \d+|\d+ rows?/.test(await text(kb('tables-count'))), await text(kb('tables-count')))
  }
  check('no console error', page.errs.length === 0, page.errs.slice(0, 3))
} catch (e) {
  fail += 1
  console.log('  ✗ the run stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close().catch(() => {})
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
