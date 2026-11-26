#!/usr/bin/env node
// The Apps page (kybernos-db) on the REAL GUI of a SANDBOX, over real databases: the gallery of cards, an app opening on its tables, the Relations tab, the view bar,
// the template cards of « New app » (read through window.__KB_TEMPLATES__, one added), and the archive / restore / delete-forever round trip (each step read back from /kybernos-db/state). The page edits nothing by hand: every data change here is Kaby's, made through the
// service the host uses.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-apps-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME). --shots <dir>: one PNG per state (kept outside git: media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { seedHome, seedShop } from './lib-tables-seed.mjs'
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

const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const headers = { cookie: cookie.nom + '=' + cookie.valeur }
const get = async (path) => (await fetch('http://' + host + path, { headers })).json()
const state = () => get('/kybernos-db/state')
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150) } return last }

const seeded = await state().catch(() => null)
if (seeded === null || seeded.ok !== true) { console.error('○ not run: the sandbox does not answer on ' + host + ' (scripts/sandbox/start.sh)'); process.exit(3) }
const home = seedHome({ dshHome, today: seeded.today }); if (home.db) home.db.close()
const shop = seedShop({ dshHome }); if (shop.db) shop.db.close()
const appOf = async (id) => (await state()).dbs.find((d) => d.id === id)
const awayOf = async (id) => (await state()).archived.find((d) => d.id === id)

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
await page.send('Runtime.enable', {})
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const exists = async (sel) => (await count(sel)) > 0
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel, wait = 350) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(150)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(wait)
  return true
}
const type = async (sel, s) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await page.send('Input.insertText', { text: s }); await sleep(200) }
const bodyText = () => ev('document.body.innerText')
const overflow = () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
await ev(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason))); 1`)

try {
  console.log('── the gallery ──')
  await sleep(2500)
  check('the Apps page opens the gallery (reached from Creations: its menu row is folded into it)', (await page.evalJs("window.__KB_OPEN__({ view: 'tables' }) === true", 8000)).val === true && (await until(() => exists(kb('apps-gallery')), 8000)) === true)
  await sleep(600)
  await shot('01-gallery')
  const cards = await ev(`[...document.querySelectorAll('[data-kb="apps-card"]')].map((e) => ({ id: e.getAttribute('data-db'), t: e.innerText.replace(/\\s+/g, ' ') }))`)
  check('one card per app, with its tables and rows', Array.isArray(cards) && cards.some((c) => c.id === home.id && /Home/.test(c.t) && /tables?/.test(c.t) && /rows?/.test(c.t)) && cards.some((c) => c.id === shop.id), cards)
  check('no hand-editing control anywhere on the page', (await count('textarea')) === 0 && !(await exists(kb('tables-new'))) && !(await exists(kb('tables-share'))))
  check('the page does not scroll sideways', (await overflow()) <= 0)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  await shot('01b-gallery-narrow')
  check('narrow (640 px): no sideways scroll and the cards are still all there', (await overflow()) <= 0 && (await count(kb('apps-card'))) === (cards || []).length)
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(300)

  console.log('── an app ──')
  check('a card opens its app on its first table', (await click(`${kb('apps-card')}[data-db="${shop.id}"] ${kb('apps-open')}`)) && (await until(() => exists(kb('tables-tab')), 6000)) === true)
  await sleep(500)
  await shot('02-app')
  const tabs = await ev(`[...document.querySelectorAll('[data-kb="tables-tab"]')].map((e) => e.getAttribute('data-object'))`)
  check('the tabs are the tables of the app, with Relations after them', Array.isArray(tabs) && tabs.length >= 3 && (await exists(kb('tables-tab-relations'))), tabs)
  check('a table shows its rows, read-only (no add-row button)', (await exists(kb('tables-row'))) && !(await exists(kb('tables-add'))) && !(await exists(kb('tables-row-edit'))))
  check('Ask Kaby is offered in the header', await exists(kb('tables-ask-kaby')))
  check('Relations draws the map of the links', (await click(kb('tables-tab-relations'))) && (await until(() => exists(kb('tables-relations')), 5000)) === true)
  await shot('03-relations')

  console.log('── archive and back ──')
  check('the app menu opens the archive dialog, which says what is kept and asks nothing to be typed', (await click(kb('apps-menu'))) && (await click(kb('apps-menu-archive'))) && (await until(() => exists(kb('apps-dialog')), 4000)) === true && !(await exists(kb('apps-typed'))))
  await shot('04-archive-dialog')
  check('Cancel changes nothing', (await click(kb('apps-cancel'))) && (await until(async () => !(await exists(kb('apps-dialog'))), 3000)) === true && (await appOf(shop.id)) !== undefined)
  check('Archive puts the app away: out of the apps, in the archived list, rows kept', (await click(kb('apps-menu'))) && (await click(kb('apps-menu-archive'))) && (await click(kb('apps-confirm'))) && (await until(async () => (await awayOf(shop.id)) !== undefined, 6000)) !== undefined && (await appOf(shop.id)) === undefined)
  await sleep(500)
  check('back on the gallery, the app is under « Archived »', (await until(() => exists(kb('apps-gallery')), 4000)) === true && (await exists(kb('apps-fold'))))
  await click(kb('apps-fold'))
  await shot('05-archived')
  check('an archived app has Restore and Delete forever, and no open', (await exists(`${kb('apps-archived')}[data-db="${shop.id}"] ${kb('apps-restore')}`)) && !(await exists(`${kb('apps-archived')}[data-db="${shop.id}"] ${kb('apps-open')}`)))
  check('Delete forever waits for the facts and for the exact name', (await click(`${kb('apps-archived')}[data-db="${shop.id}"] ${kb('apps-delete')}`)) && (await until(() => exists(kb('apps-typed')), 4000)) === true && (await ev(`document.querySelector('[data-kb="apps-confirm"]').disabled`)) === true)
  await type(kb('apps-typed'), 'nope')
  check('a wrong name keeps the button disabled', (await ev(`document.querySelector('[data-kb="apps-confirm"]').disabled`)) === true)
  await shot('06-delete-dialog')
  await click(kb('apps-cancel'))
  check('Restore brings it back with its tables', (await click(`${kb('apps-archived')}[data-db="${shop.id}"] ${kb('apps-restore')}`)) && (await until(async () => (await appOf(shop.id)) !== undefined, 6000)) !== undefined && (await appOf(shop.id)).objects.length >= 3)

  console.log('── a new app ──')
  check('New app opens the screen where Kaby is asked', (await click(kb('apps-new'))) && (await until(() => exists(kb('tables-build-input')), 4000)) === true)
  await shot('07-new-app')
  check('the starting shapes are offered', (await count(kb('apps-start'))) === 3)

  console.log('── a template ──')
  const tpls = await ev(`[...document.querySelectorAll('[data-kb="apps-template"]')].map((e) => ({ id: e.getAttribute('data-id'), t: e.innerText.replace(/\\s+/g, ' ') }))`)
  const seamIds = await ev(`window.__KB_TEMPLATES__.list().then((l) => l.map((t) => t.id))`)
  check('Start from a template draws one card per template the door lists, each with its tables and a button', Array.isArray(tpls) && tpls.length >= 1 && JSON.stringify(tpls.map((c) => c.id)) === JSON.stringify(seamIds) && tpls.every((c) => /Use template|In your apps/.test(c.t)), { tpls, seamIds })
  await shot('08-templates')
  const tpl = (tpls || []).find((c) => /Use template/.test(c.t))
  if (tpl === undefined) console.log('  ○ every template is already one of this sandbox\'s apps: the add steps are skipped (each run adds one; start a fresh sandbox to repeat them)')
  else {
    const marker = tpl.id.split('/').pop()
    check('a card opens the dialog, with the sample rows and the kit offered', (await click(`${kb('apps-template')}[data-id="${tpl.id}"] button`)) && (await until(() => exists(kb('apps-opt-sample')), 4000)) === true)
    await shot('09-template-dialog')
    check('Add app makes the app: its database carries the template marker, its page opens on its tables', (await click(kb('apps-confirm'))) && (await until(async () => (await state()).dbs.some((d) => d.template === marker), 40000)) === true && (await until(() => exists(kb('tables-tab')), 10000)) === true)
    await sleep(500)
    await shot('10-template-app')
    const made = (await state()).dbs.find((d) => d.template === marker)
    const twice = await ev(`window.__KB_TEMPLATES__.add(${JSON.stringify(tpl.id)}, { sample: true, kit: false })`, 40000)
    check('adding it again through the door finds the same app and makes no second one', twice !== null && twice.ok === true && made !== undefined && twice.appId === made.id && (await state()).dbs.filter((d) => d.template === marker).length === 1, { twice, made: made && made.id })
    const refusal = await ev(`window.__KB_TEMPLATES__.add('nobody/nothing', {})`)
    check('an unknown template is refused with a sentence, not thrown', refusal !== null && refusal.ok === false && typeof refusal.message === 'string' && refusal.message !== '', refusal)
    check('back on the gallery, New app shows that template as « In your apps »', (await click(kb('apps-back'))) && (await until(() => exists(kb('apps-gallery')), 6000)) === true && (await click(kb('apps-new'))) && (await until(async () => /In your apps/.test((await ev(`(document.querySelector('[data-kb="apps-template"][data-id="${tpl.id}"]') || { innerText: '' }).innerText`)) || ''), 6000)) === true)
  }
  const errs = await ev('window.__errs')
  check('no uncaught error on the page', Array.isArray(errs) && errs.length === 0, errs)
  check('the page text is free of leftovers (no raw keys, no undefined)', !/undefined|\[object|NaN/.test(await bodyText()))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'Apps page: all ' + pass + ' checks passed' : 'Apps page: ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
