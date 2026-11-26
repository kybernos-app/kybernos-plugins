#!/usr/bin/env node
// The Map view of the Tables page on the REAL GUI of a SANDBOX: the real-estate template's database (seeded through the Themes route, as the check of the templates does) opens on its
// Map view; the real map (MapLibre GL + OpenFreeMap tiles) starts only then, shows a pin per property, a pin opens its record, the open record lights its pin, the buttons work, and
// a table with no place falls back to the schematic map with its caption instead of a blank box.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-db-map-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME). It needs the INTERNET for the tiles (without it the run says so and exits 3: the fallbacks are then all that could
// be measured, and test-map.mjs covers them). The Tables bundle must be on in the sandbox profile. Nothing is sent to a model.
//  - What the page asks of the network is read from the browser's own resource timing: nothing for OpenFreeMap or the library before the Map view is opened.
//  - --shots <dir>: one PNG per state (kept outside git: media never go in the repository). Exit code: 0 all green, 1 a check failed, 3 not run.
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
try { const r = await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status) } catch (e) { console.error('○ not run: no internet to OpenFreeMap (' + e.message + ')'); process.exit(3) }

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
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`, 20000)
const mapState = () => ev(`(() => { const b = document.querySelector('[data-kb="tables-map-box"]'); return b === null ? null : { map: b.getAttribute('data-map'), zoom: b.querySelector('[data-kb="tables-map"]') && b.querySelector('[data-kb="tables-map"]').getAttribute('data-zoom') } })()`)
const remote = () => ev(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /openfreemap|maplibre/i.test(n)).length`)

try {
  await page.send('Runtime.enable', {})
  await sleep(2500)
  const seeded = await post('/kybernos/themes', { action: 'seed', id: 'kybernos-themes/real-estate', lang: 'fr' })
  const dbId = seeded.json && seeded.json.db
  check('the real-estate database exists (made now or by an earlier run)', seeded.status === 200 && typeof dbId === 'string', seeded)
  const state = await get('/kybernos-db/state')
  const db = state.dbs.find((d) => d.id === dbId)
  const views = db && db.objects.find((o) => o.key === 'property').views
  check('its properties have a Map view, placed by their latitude and longitude', Array.isArray(views) && views.some((v) => v.kind === 'map' && v.lat === 'lat' && v.lng === 'lng'), views)

  check('the page opens on the Tables row', (await click('.kb4-menu .kb4-item[aria-label="Tables"]')) === true && (await until(() => ev(`document.querySelector('[data-kb="tables-bar"]') !== null`))) === true)
  await until(() => ev(`(() => { const e = document.querySelector('[data-kb="tables-db"]'); if (e === null || ![...e.options].some((o) => o.value === ${JSON.stringify(dbId)})) return false; e.value = ${JSON.stringify(dbId)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value === ${JSON.stringify(dbId)} })()`))
  await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === 'property'); if (t) t.setAttribute('data-chk', 'tab'); return 1 })()`)
  check('the Properties tab opens', (await click('[data-chk="tab"]')) === true && (await until(() => count(kb('tables-card')).then((n) => n > 0))) === true)
  check('nothing is asked of OpenFreeMap or for the library before the Map view is opened', (await remote()) === 0, await remote())

  const asked = await ev(`(() => { const b = [...document.querySelectorAll('[data-kb="tables-view"]')].find((e) => /Carte/.test(e.innerText)); if (b) b.setAttribute('data-chk', 'map'); return b !== undefined })()`)
  check('the Map view is in the bar, in French', asked === true)
  check('opening it starts the map box', (await click('[data-chk="map"]')) === true && (await until(() => mapState().then((m) => m !== null))) !== null)
  const settled = await until(async () => { const m = await mapState(); return m !== null && m.map !== 'loading' ? m : false }, 30000)
  check('the real map starts with real tiles (and not the schematic one)', settled && settled.map === 'real', settled)
  check('only now the library and the style are asked for, from this host and OpenFreeMap', (await remote()) >= 3, await remote())
  const pins = await until(() => count('[data-kb="tables-pin"], [data-kb="tables-cluster"]').then((n) => (n >= 3 ? n : 0)), 15000)
  check('the properties are pins (or clusters of pins) on the map', pins >= 3, pins)
  const note = await ev(`(document.querySelector('[data-kb="tables-map-note"]') || {}).innerText || ''`)
  check('the caption counts the places', /16/.test(note), note)
  check('the attribution the data licences ask for is there', (await ev(`(document.querySelector('[data-kb="tables-map-attribution"]') || {}).innerText || ''`)).includes('OpenFreeMap') || (await count(kb('tables-map-attribution-i'))) === 1)
  await shot('map-real')

  // the buttons, then a pin that opens its record
  const z0 = (await mapState()).zoom
  check('the zoom button zooms the map in', (await click(kb('tables-map-zoom-in'))) === true && (await until(async () => Number((await mapState()).zoom) > Number(z0), 6000)) !== false, { z0, now: (await mapState()).zoom })
  check('Show everything puts every place back in view', (await click(kb('tables-map-fit'))) === true)
  await until(async () => (await count('[data-kb="tables-pin"]')) > 0, 6000)
  const hasPin = await until(() => count('[data-kb="tables-pin"]').then((n) => n > 0), 12000)
  if (hasPin) {
    check('a pin opens its record in the drawer', (await click('[data-kb="tables-pin"]')) === true && (await until(() => count(kb('tables-drawer')).then((n) => n === 1))) === true)
    check('the open record lights its pin', (await until(() => ev(`document.querySelectorAll('[data-kb="tables-pin"].sel, [data-kb="tables-cluster"].sel').length >= 1`))) === true)
    await shot('map-record')
  } else check('a pin opens its record in the drawer', false, 'no single pin at this zoom')

  // the theme menu
  check('the theme button opens a menu of five themes', (await click(kb('tables-map-theme'))) === true && (await count('[role="menuitemradio"]')) === 5)
  await click(kb('tables-map-theme-dark'))
  check('Dark gives the map its dark style, and the choice is remembered by this browser', (await until(() => ev(`document.querySelector('[data-kb="tables-map-box"] [data-style]') !== null || document.querySelector('[data-style="dark"]') !== null`))) === true && (await ev(`window.localStorage.getItem('kybernos.db.mapstyle.v1')`)) === 'dark')
  await sleep(1500)
  await shot('map-dark')
  await click(kb('tables-map-theme')); await click(kb('tables-map-theme-auto'))

  // a table with no place on any record: the schematic map, never a blank box
  await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === 'contact'); if (t) t.setAttribute('data-chk', 'contacts'); return 1 })()`)
  check('the contacts have no Map view to offer (they have no two number fields)', (await click('[data-chk="contacts"]')) === true && (await until(() => count(kb('tables-bar')).then((n) => n === 1))) === true)
  check('the views menu of the contacts does not offer a map', (await ev(`(() => { const b = document.querySelector('[data-kb="tables-menu-views"]'); if (b) b.click(); return document.querySelectorAll('[data-kb="tables-view-new-map"]').length })()`)) === 0)
} catch (e) {
  fail += 1
  console.log('  ✗ the run stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close()
}
console.log('\ncheck-db-map-live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
