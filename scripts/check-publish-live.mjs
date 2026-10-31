#!/usr/bin/env node
// The Publish dialog, the pill, the header and the note of a published app on the REAL GUI of a SANDBOX (kybernos-db, « Publish onto one of your own cloud computers »).
//
//   node scripts/sandbox/space.mjs start && source <state>/space.env && scripts/sandbox/start.sh      (a team space on localhost, then the sandbox DSH with the dev hosting adapter)
//   source scripts/sandbox/env.sh && node scripts/check-publish-live.mjs [--shots <dir>]
//
// What it does, on a real app seeded in the sandbox: opens the dialog against the real hosting (the dev adapter lists one computer), measures it at 1400 and 390 px (the dialog inside the
// viewport, rows and button at least 24 px tall, pill and radio centred on their row, the order button on the block's heading line and at its right edge, no sideways scroll), presses the
// order button (window.open is replaced by a recorder in the page, so nothing ever leaves the sandbox: the check answers the button itself), walks the radiogroup with the keyboard, then
// renders the states the dev adapter cannot make (two computers, a sleeping one, always on, none, loading, unreachable, no order address, a failed Publish, a gone computer) by answering
// the page's own `fetch` of /kybernos-db/publish-check, /publish and /state with what a real hosting would say. It then Publishes for real into the local space, reads the pill, the
// header and the note, and Unpublishes for real. Screenshots (--shots) are kept outside git.
//
// SANDBOX ONLY (exit 3 against :3080, without a sandbox DSH_HOME, or when the sandbox was not started with the dev hosting). Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { seedShop } from './lib-tables-seed.mjs'
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
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 600))) }
}
const group = (name) => console.log('── ' + name + ' ──')

const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const headers = { cookie: cookie.nom + '=' + cookie.valeur }
const get = async (path) => (await fetch('http://' + host + path, { headers })).json()
const state = () => get('/kybernos-db/state')
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150) } return last }

const seeded = await state().catch(() => null)
if (seeded === null || seeded.ok !== true) { console.error('○ not run: the sandbox does not answer on ' + host + ' (scripts/sandbox/start.sh)'); process.exit(3) }
if (!seeded.hosting || seeded.hosting.available !== true) { console.error('○ not run: the sandbox DSH has no hosting. Start a local space and the DSH with its variables: node scripts/sandbox/space.mjs start, then source <state>/space.env && scripts/sandbox/start.sh'); process.exit(3) }
const shop = seedShop({ dshHome }); if (shop.db) shop.db.close()
const shopOf = async () => (await state()).dbs.find((d) => d.id === shop.id)
if ((await until(async () => (await shopOf()) !== undefined, 8000)) === undefined) { console.error('○ not run: the seeded app did not show in the state'); process.exit(3) }
if ((await shopOf()).published) { // left published by an earlier run that stopped half way: bring it back, as the page would
  const r = await fetch('http://' + host + '/kybernos-db/unpublish', { method: 'POST', headers: { ...headers, origin: 'http://' + host, 'content-type': 'application/json' }, body: JSON.stringify({ db: shop.id }) }).then((x) => x.json()).catch(() => null)
  if (r === null || r.ok !== true || (await shopOf()).published) { console.error('○ not run: the sandbox\'s Shop app is published and could not be unpublished: ' + JSON.stringify(r)); process.exit(3) }
  console.log('  (the Shop app was left published by an earlier run: unpublished first)')
}

const ORDER = 'https://kybernos.example.test/computers'
// the boot key of the sandbox's own throw-away space, read only to prove it never reaches a state or a page; it is never printed
const spaceKey = (() => { try { return /KYBERNOS_DB_SPACE_KEY=(\S+)/.exec(readFileSync(join(dirname(dirname(dshHome)), 'space.env'), 'utf8'))[1] } catch (e) { return null } })()
const WIDE = { width: 1400, height: 900 }
const NARROW = { width: 390, height: 844 }

const live = await openLivePage({ width: WIDE.width, height: WIDE.height }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
await page.send('Runtime.enable', {})
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const exists = async (sel) => (await count(sel)) > 0
const textOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.innerText.replace(/\\s+/g, ' ').trim() })()`)
const rect = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel, wait = 350, i = 0) => {
  await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e !== undefined) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(120)
  const r = await rect(sel, i)
  if (r === null || r.err || r.shown !== true) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.cx, y: r.cy, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.cx, y: r.cy, button: 'left', clickCount: 1 })
  await sleep(wait)
  return true
}
const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37, Enter: 13, Escape: 27, Tab: 9, ' ': 32 }
const press = async (key, wait = 200) => {
  const code = KEYS[key]
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  await sleep(wait)
}
const focus = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return false; e.focus(); return document.activeElement === e })()`)
const sideways = () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
const bodyText = () => ev('document.body.innerText')
// The shell re-lays itself out when the width changes (a drawer moves, the page is re-measured): a click made before that has settled can land on the drawer. So wait until the header is still.
const settle = async () => {
  let last = ''
  for (let i = 0; i < 40; i++) {
    const now = JSON.stringify(await rect('h1'))
    if (now === last && now !== 'null') return true
    last = now
    await sleep(150)
  }
  return false
}
// Narrower than a tablet the shell keeps its sidebar as a drawer, and it can be left open over the page by a change of width: a real press then lands on the drawer. A press on the strip
// to its right closes it, as a person would do.
const drawerOpen = () => ev(`[...document.querySelectorAll('[class*="sidebarCol"]')].some((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).position === 'fixed' && r.width > 0 && r.right > 100 })`) // closed, it sits just off the left edge (a few pixels of it may show)
const closeDrawer = async () => {
  for (let i = 0; i < 3 && (await drawerOpen()) === true; i++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 380, y: 800, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 380, y: 800, button: 'left', clickCount: 1 })
    await sleep(700)
  }
  return (await drawerOpen()) !== true
}
const viewport = async (v) => { await page.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: false }); await sleep(900); await settle(); if (v.width < 500) { await sleep(900); await closeDrawer(); await sleep(500); await closeDrawer() } }
const desktop = async () => { await page.send('Emulation.clearDeviceMetricsOverride', {}); await sleep(700); await settle() }

await ev(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
  // a headless page reports itself hidden, and the Apps page then pauses its reads of the state: say it is in front
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); Object.defineProperty(document, 'hidden', { get: () => false });
  window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null };
  window.__fake = null; const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const f = window.__fake; const u = String(typeof url === 'string' ? url : (url && url.url) || ''); const path = u.split('?')[0];
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (f !== null && f.check && /\\/kybernos-db\\/publish-check$/.test(path)) { const real = await (await realFetch(url, init)).json(); const out = await f.check(real); return json(200, out) }
    if (f !== null && f.publish && /\\/kybernos-db\\/publish$/.test(path)) { window.__publishBodies = (window.__publishBodies || []).concat([JSON.parse(init.body)]); const out = await f.publish(JSON.parse(init.body)); return json(out.status, out.body) }
    if (f !== null && f.state && /\\/kybernos-db\\/state$/.test(path)) { const real = await (await realFetch(url, init)).json(); return json(200, f.state(real)) }
    return realFetch(url, init)
  }; 1`)
const fake = (src) => ev(`window.__fake = ${src}; 1`)
const unfake = () => ev('window.__fake = null; 1')

// The page-side measures of an open dialog: where everything is, in CSS pixels.
const dialogFacts = () => ev(`(() => {
  const q = (s) => document.querySelector(s); const all = (s) => [...document.querySelectorAll(s)];
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cy: r.top + r.height / 2 } };
  const dlg = q('[data-kb="apps-dialog"]'); if (!dlg) return null;
  const rows = all('[data-kb="apps-host"]').map((b) => ({ row: R(b), radio: R(b.children[0]), pill: R(b.querySelector('[data-kb="apps-host-state"]')), name: b.innerText.replace(/\\s+/g, ' ').trim(), checked: b.getAttribute('aria-checked') }));
  const order = all('[data-kb="apps-order"]').map(R);
  const where = q('[data-kb="apps-where"]');
  const heading = where ? where.querySelector('h4, [data-kb="apps-where-head"], .kbtb-whead') : null;
  const btns = all('[data-kb="apps-dialog"] button').map((b) => ({ t: b.innerText.replace(/\\s+/g, ' ').trim(), h: R(b).h, disabled: b.disabled, kb: b.getAttribute('data-kb') }));
  return { vw: innerWidth, vh: innerHeight, dlg: R(dlg), inner: { sh: dlg.scrollHeight, ch: dlg.clientHeight, sw: dlg.scrollWidth, cw: dlg.clientWidth }, rows, order, heading: R(heading), whereRect: R(where), btns, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, text: dlg.innerText.replace(/\\s+/g, ' ').trim() }
})()`)

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
// What every state of the dialog must satisfy, at any width.
const sane = (label, f) => {
  check(label + ': the dialog is inside the viewport (it scrolls inside itself when it is taller)', f !== null && f.dlg.x >= -0.5 && f.dlg.r <= f.vw + 0.5 && f.dlg.y >= -0.5 && f.dlg.b <= f.vh + 0.5, f && { dlg: f.dlg, vw: f.vw, vh: f.vh })
  check(label + ': no sideways scroll, on the page or inside the dialog', f !== null && f.sideways <= 0 && f.inner.sw <= f.inner.cw + 1, f && { sideways: f.sideways, inner: f.inner })
  check(label + ': every button and every row is at least 24 px tall', f !== null && f.btns.every((b) => b.h >= 24) && f.rows.every((r) => r.row.h >= 24), f && { btns: f.btns.map((b) => [b.t, b.h]), rows: f.rows.map((r) => r.row.h) })
  check(label + ': in every row the radio and the state pill are centred on the row', f !== null && f.rows.every((r) => near(r.radio.cy, r.row.cy, 2.5) && (r.pill === null || near(r.pill.cy, r.row.cy, 3))), f && f.rows.map((r) => [r.row.cy, r.radio.cy, r.pill && r.pill.cy]))
}

const whereState = () => ev(`(() => { const e = document.querySelector('[data-kb="apps-where"]'); return e === null ? null : e.getAttribute('data-state') })()`)
const openDialog = async (expect) => {
  if (!(await click(kb('apps-publish'), 200))) return false
  if (!(await until(() => exists(kb('apps-dialog')), 5000))) return false
  return (await until(async () => (await whereState()) === expect, 8000)) === true
}
const closeDialog = async () => { if (await exists(kb('apps-dialog'))) { await press('Escape', 300); if (await exists(kb('apps-dialog'))) await click(kb('apps-cancel'), 300) } return !(await exists(kb('apps-dialog'))) }

const HOSTS2 = `[{ id: 'studio', name: 'Studio', state: 'running', region: 'Frankfurt, EU', alwaysOn: false, shared: true }, { id: 'backoffice', name: 'Backoffice', state: 'sleeping', region: 'Paris, EU', alwaysOn: false, shared: true }]`
const HOSTS_ALWAYS = `[{ id: 'studio', name: 'Studio', state: 'running', region: 'Frankfurt, EU', alwaysOn: true, shared: false }, { id: 'backoffice', name: 'Backoffice', state: 'sleeping', region: 'Paris, EU', alwaysOn: false, shared: false }]`
const checkWith = (hosts, { last = 'null', order } = {}) => `{ check: (c) => ({ ...c, can: ${hosts !== '[]'}, reason: ${hosts !== '[]' ? 'null' : "'no-host'"}, hosts: ${hosts}, lastHost: ${last}${order === undefined ? '' : ', hosting: { ...c.hosting, orderUrl: ' + JSON.stringify(order) + ' }'} }) }`

try {
  group('the app and its Publish button')
  await sleep(2500)
  check('the fixed menu has an « Apps » row, and it opens the gallery', (await clickText(page, 'Apps')) === true && (await until(() => exists(kb('apps-gallery')), 8000)) === true)
  check('the Shop app opens on its tables', (await click(`${kb('apps-card')}[data-db="${shop.id}"] ${kb('apps-open')}`)) && (await until(() => exists(kb('tables-tab')), 6000)) === true)
  check('the header offers Publish… (the hosting is there)', await exists(kb('apps-publish')))
  await sleep(300)

  group('the dialog against the real hosting: one computer (mockup #one)')
  check('Publish… opens the dialog, and the computers are listed', await openDialog('list'))
  await sleep(400)
  await shot('dlg-one-1400')
  let f = await dialogFacts()
  sane('1400 px', f)
  check('the block is called « Where it runs » and lists the one computer the dev adapter has', f !== null && /Where it runs/.test(f.text) && f.rows.length === 1 && /Your own team space/.test(f.rows[0].name), f && f.rows)
  check('the only computer is already selected (a radio, checked) and says Running', f !== null && f.rows[0].checked === 'true' && /Running/.test(f.rows[0].name), f && f.rows)
  check('Publish is enabled with the computer selected', f !== null && f.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === false && /Publish/.test(b.t)), f && f.btns)
  check('the facts are there: what goes, the personal data line, availability, and what happens while published', f !== null && /What goes/.test(f.text) && /Availability/.test(f.text) && /While published/.test(f.text), f && f.text.slice(0, 400))
  check('no price, no budget, no « new web app is set up »', f !== null && !/\$|€|a month|budget|new web app|estimated/i.test(f.text), f && f.text.slice(0, 300))
  check('no « also run your agents » line for a computer that is not shared', f !== null && !/also run your agents/.test(f.text))
  check('there is one small order button, « Get another cloud computer », on the block\'s heading line at its right edge',
    f !== null && f.order.length === 1 && f.heading !== null && near(f.order[0].cy, f.heading.cy, 8) && near(f.order[0].r, f.rows[0].row.r, 3) && /Get another cloud computer/.test(f.text), f && { order: f.order, heading: f.heading, row: f.rows[0].row })
  check('the order button opens the address through window.open, in a new tab, with no opener (answered here, nothing left the sandbox)',
    (await click(kb('apps-order'), 250)) && JSON.stringify(await ev('window.__opened')) === JSON.stringify([[ORDER, '_blank', 'noopener,noreferrer']]), await ev('window.__opened'))
  check('and the dialog is still open, unchanged', await exists(kb('apps-dialog')))
  check('the first radio shows a focus ring from the keyboard', (await focus(kb('apps-host'))) && (await ev(`(() => { const s = getComputedStyle(document.activeElement); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '') })()`)) === true)
  await press('Escape', 350)
  check('Escape closes the dialog', !(await exists(kb('apps-dialog'))))

  group('the same dialog at 390 px')
  await viewport(NARROW)
  check('390 px: the drawer is closed and Publish… opens the dialog', (await drawerOpen()) !== true && (await openDialog('list')))
  await sleep(400)
  await shot('dlg-one-390')
  f = await dialogFacts()
  sane('390 px', f)
  check('390 px: the order button is still on the block\'s heading and does not push the dialog sideways', f !== null && f.order.length === 1 && f.order[0].r <= f.dlg.r + 0.5 && f.order[0].x >= f.dlg.x - 0.5, f && { order: f.order, dlg: f.dlg })
  check('390 px: the dialog is the width of the screen less its gutters', f !== null && f.dlg.w >= 390 - 40 && f.dlg.w <= 390, f && f.dlg)
  await closeDialog()
  await desktop()

  group('the states the dev adapter cannot make (the page\'s own fetch answered as a real hosting would)')
  const scenario = async (name, setup, expectState, extra) => {
    await setup()
    check(name + ': the dialog opens in the « ' + expectState + ' » state', await openDialog(expectState))
    await sleep(350)
    await shot('dlg-' + name + '-1400')
    const w = await dialogFacts()
    sane(name + ' (1400)', w)
    if (extra) await extra(w)
    await closeDialog()
    await viewport(NARROW)
    await setup()
    check(name + ' (390): the dialog opens in the « ' + expectState + ' » state', await openDialog(expectState))
    await sleep(350)
    await shot('dlg-' + name + '-390')
    sane(name + ' (390)', await dialogFacts())
    await closeDialog()
    await desktop()
  }
  await scenario('two', () => fake(checkWith(HOSTS2)), 'list', async (w) => {
    check('two: both computers, nobody selected, a hint, and Publish disabled', w.rows.length === 2 && w.rows.every((r) => r.checked === 'false') && /Choose the computer/.test(w.text) && w.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === true), w)
    check('two: Running and Sleeping pills', /Running/.test(w.rows[0].name) && /Sleeping/.test(w.rows[1].name), w.rows.map((r) => r.name))
    check('two: the shared-computer line is shown once', (w.text.match(/also run your agents/g) || []).length === 1)
    check('two: the heading counts the computers', /2 computers/.test(w.text), w.text.slice(0, 200))
    check('two: the radio rows have the same height and are stacked without overlap', near(w.rows[0].row.h, w.rows[1].row.h, 1) && w.rows[1].row.y >= w.rows[0].row.b - 0.5, w.rows.map((r) => r.row))
    check('two: the rows are as wide as the block (aligned left and right)', near(w.rows[0].row.x, w.rows[1].row.x, 0.5) && near(w.rows[0].row.r, w.rows[1].row.r, 0.5))
    await focus(kb('apps-host'), 0)
    await press('ArrowDown')
    check('two: ArrowDown selects the next computer and moves the focus with it', (await ev(`[...document.querySelectorAll('[data-kb="apps-host"]')].map((e) => e.getAttribute('aria-checked')).join()`)) === 'false,true' && (await ev(`document.activeElement.getAttribute('data-host')`)) === 'backoffice')
    await press('ArrowUp')
    check('two: ArrowUp comes back', (await ev(`[...document.querySelectorAll('[data-kb="apps-host"]')].map((e) => e.getAttribute('aria-checked')).join()`)) === 'true,false')
    await press('ArrowDown'); await press('ArrowDown')
    check('two: the arrows wrap round the list', (await ev(`[...document.querySelectorAll('[data-kb="apps-host"]')].map((e) => e.getAttribute('aria-checked')).join()`)) === 'true,false')
    await press('ArrowDown')
    const av = await textOf(kb('apps-dialog'))
    check('two: a sleeping computer says it is asleep and that Publish wakes it', /Backoffice/.test(av) && /asleep now/i.test(av), av && av.slice(-420))
  })

  await scenario('lastused', () => fake(checkWith(HOSTS2, { last: "'backoffice'" })), 'list', async (w) => {
    check('last used: the computer the last Publish used is already selected', w.rows[1].checked === 'true' && w.rows[0].checked === 'false' && w.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === false), w.rows.map((r) => r.checked))
  })

  await scenario('always', () => fake(checkWith(HOSTS_ALWAYS, { last: "'studio'" })), 'list', async (w) => {
    check('always on: the pill says Always on and the availability fact promises it', /Always on/.test(w.rows[0].name) && /stays up/.test(w.text), w.text.slice(-300))
    check('always on: no « also run your agents » line when no computer is shared', !/also run your agents/.test(w.text))
  })

  await scenario('none', () => fake(checkWith('[]')), 'none', async (w) => {
    check('none: a dashed box says there is no cloud computer, with one primary « Get a cloud computer »', (await exists(kb('apps-hosts-none'))) && w.order.length === 1 && /No cloud computer yet/.test(w.text) && /Get a cloud computer/.test(w.text), w.text.slice(0, 300))
    check('none: only Close is below, no Publish', w.btns.filter((b) => b.kb === 'apps-confirm').length === 0 && w.btns.some((b) => /Close/.test(b.t)), w.btns)
    const before = (await ev('window.__opened.length'))
    check('none: the primary button asks the same address', (await click(kb('apps-order'), 250)) && (await ev('window.__opened.length')) === before + 1 && (await ev('window.__opened[window.__opened.length - 1][0]')) === ORDER)
    await press('Escape', 350)
    check('none: Escape closes it too', !(await exists(kb('apps-dialog'))))
  })

  await scenario('noaddress', () => fake(checkWith('[]', { order: '' })), 'none', async (w) => {
    check('none and no address: no order button anywhere (a dead button is never drawn)', w.order.length === 0 && w.btns.every((b) => b.kb !== 'apps-order'), w.btns)
  })
  for (const bad of ['http://kybernos.example.test/computers', 'javascript:alert(1)', 'https://user:pw@kybernos.example.test/', 'kybernos.example.test']) {
    await fake(checkWith(HOSTS2, { order: bad }))
    check('an address that is not a plain https one (' + bad.slice(0, 22) + '…) draws no order button', (await openDialog('list')) && (await count(kb('apps-order'))) === 0)
    await closeDialog()
  }

  await scenario('loading', () => fake('{ check: () => new Promise(() => {}) }'), 'loading', async (w) => {
    check('loading: skeleton rows stand in the block, marked busy, and Publish is not available yet', (await ev(`document.querySelector('[data-kb="apps-where"]').getAttribute('aria-busy')`)) === 'true' && w.rows.length === 0 && !w.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === false), w.btns)
    await press('Escape', 350)
    check('loading: Escape closes it (nothing is busy)', !(await exists(kb('apps-dialog'))))
  })

  const OFFLINE = `{ check: (c) => ({ ...c, can: false, reason: 'hosts-unreachable', hosts: null, lastHost: null, hostsError: { code: 'hosts-unreachable', message: 'Check your connection, then try again.' } }) }`
  await scenario('offline', () => fake(OFFLINE), 'unreachable', async (w) => {
    check('offline: a warning says the computers could not be loaded, with Try again and the order button', (await exists(kb('apps-hosts-error'))) && /couldn.t load your cloud computers/i.test(w.text) && (await exists(kb('apps-hosts-retry'))) && w.order.length === 1, w.text.slice(0, 300))
    check('offline: Publish is disabled, the facts are still there', w.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === true) && /What goes/.test(w.text))
    await fake(checkWith(HOSTS2, { last: "'studio'" }))
    check('offline: Try again reads the computers again and the list appears', (await click(kb('apps-hosts-retry'), 500)) && (await until(async () => (await whereState()) === 'list', 6000)) === true)
  })

  group('a Publish that fails, and one that waits (the page\'s fetch of /publish answered)')
  const FAILING = (ms) => `{ check: (c) => ({ ...c, can: true, reason: null, hosts: ${HOSTS2}, lastHost: "backoffice" }), publish: async () => { await new Promise((r) => setTimeout(r, ${ms})); return { status: 503, body: { ok: false, error: 'host-unavailable', message: 'Backoffice can’t be started right now. Try again in a minute, or pick another computer.' } } } }`
  const failing = async (label, w) => {
    await fake(FAILING(2500))
    check(label + ': the dialog opens with Backoffice (sleeping) selected', (await openDialog('list')) && (await ev(`document.querySelector('[data-kb="apps-host"][aria-checked="true"]').getAttribute('data-host')`)) === 'backoffice')
    const sent = (await ev('(window.__publishBodies || []).length'))
    check(label + ': Enter on the Publish button publishes', (await focus(kb('apps-confirm'))) && (await press('Enter', 500), true) && (await exists(kb('apps-publishing'))))
    await shot('dlg-busy-' + w)
    let g = await dialogFacts()
    const line = await textOf(kb('apps-publishing'))
    check(label + ' busy: ONE honest line names the sleeping computer, with « This can take a minute. »', /Waking Backoffice and sending the app/.test(line || '') && /This can take a minute\./.test(line || '') && (await count(kb('apps-publishing-line'))) === 1, line)
    const bodies = await ev('window.__publishBodies')
    check(label + ' busy: Cancel and Publish are disabled, the radios cannot be changed, and the request carried the chosen computer and the confirm',
      g.btns.filter((b) => b.kb === 'apps-confirm' || b.kb === 'apps-cancel').every((b) => b.disabled) && (await ev(`[...document.querySelectorAll('[data-kb="apps-host"]')].every((b) => b.disabled)`)) === true && Array.isArray(bodies) && bodies.length === sent + 1 && bodies[sent].host === 'backoffice' && bodies[sent].confirm === true, bodies)
    await press('Escape', 300)
    check(label + ' busy: Escape does not close the dialog', await exists(kb('apps-dialog')))
    sane(label + ' busy', g)
    await until(() => exists(kb('apps-dialog-error')), 6000)
    await shot('dlg-failed-' + w)
    g = await dialogFacts()
    check(label + ' failed: the dialog stays open with the host\'s own message', (await textOf(kb('apps-dialog-error'))) === 'Backoffice can’t be started right now. Try again in a minute, or pick another computer.', await textOf(kb('apps-dialog-error')))
    check(label + ' failed: the choice is kept (Backoffice still selected), the buttons work again and the busy line is gone', (await ev(`document.querySelector('[data-kb="apps-host"][aria-checked="true"]').getAttribute('data-host')`)) === 'backoffice' && g.btns.filter((b) => b.kb === 'apps-confirm' || b.kb === 'apps-cancel').every((b) => !b.disabled) && !(await exists(kb('apps-publishing'))), g.btns)
    sane(label + ' failed', g)
    return g
  }
  await failing('1400', '1400')
  // a running computer: the line does not say « waking »
  await fake(FAILING(1200))
  await click(kb('apps-host'), 200, 0)
  await focus(kb('apps-confirm')); await press('Enter', 400)
  check('busy on a computer that is running: « Sending the app to Studio », no « waking »', /Sending the app to Studio/.test((await textOf(kb('apps-publishing'))) || '') && !/Waking/.test((await textOf(kb('apps-publishing'))) || ''), await textOf(kb('apps-publishing')))
  await until(() => exists(kb('apps-dialog-error')), 5000)
  check('Cancel closes it after the failure', (await click(kb('apps-cancel'), 300)) && !(await exists(kb('apps-dialog'))))
  await viewport(NARROW)
  await failing('390', '390')
  check('Cancel closes it at 390 px too', (await click(kb('apps-cancel'), 300)) && !(await exists(kb('apps-dialog'))))
  await desktop()
  await unfake()
  check('nothing was published by any of this', (await shopOf()).published === null || (await shopOf()).published === undefined)

  group('Publish for real, into the local space')
  check('the dialog opens against the real hosting again', await openDialog('list'))
  const bodiesBefore = (await ev('(window.__publishBodies || []).length'))
  check('the confirm button publishes (the only computer is selected)', await click(kb('apps-confirm'), 400))
  const pub = await until(async () => { const d = await shopOf(); return d && d.published ? d.published : null }, 40000)
  check('the app is published, on the computer the dev adapter listed, and not gone', !!pub && !!pub.host && /^env-/.test(pub.host.id) && pub.host.name === 'Your own team space' && pub.hostGone === false, pub)
  check('neither the state nor the page carries the space\'s boot key', spaceKey !== null && !JSON.stringify(await state()).includes(spaceKey) && !(await ev('document.documentElement.outerHTML')).includes(spaceKey))
  await until(async () => !(await exists(kb('apps-dialog'))), 8000)
  await sleep(1200)
  void bodiesBefore
  await shot('published-1400')
  const pill = await textOf(kb('apps-published-pill'))
  check('the header pill says « Published · on Your own team space »', pill === 'Published · on Your own team space', pill)
  const note = await textOf(kb('apps-published-note'))
  check('the note says where it is hosted and how fresh the copy is, and why the structure is locked', /Hosted on Your own team space/.test(note || '') && /synced/.test(note || '') && /can.t change while the app is published/.test(note || ''), note)
  check('the note has Update and Unpublish…, and the header has Open web app', (await exists(kb('apps-refresh'))) && (await exists(kb('apps-unpublish'))) && (await exists(kb('apps-open-web'))))
  const hp = await rect(kb('apps-published-pill')); const nt = await rect(kb('apps-published-note'))
  check('the pill and the note are inside the viewport and the page does not scroll sideways', !!hp && !!nt && hp.r <= 1400 && nt.r <= 1400 && (await sideways()) <= 0, { hp, nt })
  await viewport(NARROW); await sleep(450); await shot('published-390')
  const nt2 = await rect(kb('apps-published-note')); const hp2 = await rect(kb('apps-published-pill'))
  check('390 px: the pill and the note fit and nothing scrolls sideways', !!nt2 && !!hp2 && nt2.r <= 390.5 && hp2.r <= 390.5 && (await sideways()) <= 0, { hp2, nt2 })
  await desktop()
  check('back on the gallery the card says « Published · on Your own team space » too', (await click(kb('apps-back'), 600)) && (await until(() => exists(kb('apps-gallery')), 6000)) === true && /Published · on Your own team space/.test((await textOf(`${kb('apps-card')}[data-db="${shop.id}"] ${kb('apps-card-published')}`)) || ''), await textOf(`${kb('apps-card')}[data-db="${shop.id}"] ${kb('apps-card-published')}`))
  await shot('published-card-1400')
  check('the app opens again, still on its tables', (await click(`${kb('apps-card')}[data-db="${shop.id}"] ${kb('apps-open')}`)) && (await until(() => exists(kb('tables-tab')), 6000)) === true)

  group('its computer is gone (the page\'s /state answered as the plugin would after a failed pull and a list without it)')
  await fake(`{ state: (s) => ({ ...s, dbs: s.dbs.map((d) => d.id === ${JSON.stringify(shop.id)} && d.published ? { ...d, published: { ...d.published, hostGone: true, syncError: { code: 'unreachable', message: 'The web app could not be reached.', at: new Date().toISOString() } } } : d) }) }`)
  // Update and « Keep my local copy… » sit at the same spot, and the page polls every 3 s: a mouse click aimed at Update could land on the other button if the poll got there first.
  // So Update is pressed in one step in the page (it reads the state again, or the poll already did: both end on the same screen).
  const pressed = await ev(`(() => { const e = document.querySelector('[data-kb="apps-refresh"]'); if (e === null) return 'poll-first'; e.click(); return 'clicked' })()`)
  check('Update (or the page\'s own read of the state, whichever comes first) is what brings the new state', pressed === 'clicked' || pressed === 'poll-first', pressed)
  const gone = await until(async () => (await exists(kb('apps-published-note') + '[data-gone="true"]')), 8000)
  check('the note is a warning that says the computer no longer exists and the copy here is safe', gone === true && /no longer exists, so the web app can.t be reached/.test((await textOf(kb('apps-published-note'))) || '') && /Your copy here is safe/.test((await textOf(kb('apps-published-note'))) || ''), await textOf(kb('apps-published-note')))
  await sleep(300)
  await shot('gone-1400')
  check('the header pill says « Its computer is gone »', (await textOf(kb('apps-published-pill'))) === 'Its computer is gone', await textOf(kb('apps-published-pill')))
  check('there is no Update and no plain Unpublish, only « Keep my local copy… »', !(await exists(kb('apps-refresh'))) && !(await exists(kb('apps-unpublish'))) && (await exists(kb('apps-keep-local'))))
  await viewport(NARROW); await sleep(450); await shot('gone-390')
  const g2 = await rect(kb('apps-published-note'))
  check('390 px: the warning fits', !!g2 && g2.r <= 390.5 && (await sideways()) <= 0, g2)
  await desktop()
  check('« Keep my local copy… » opens the screen that asks for the app\'s name', (await click(kb('apps-keep-local'), 400)) && (await until(() => exists(kb('apps-typed')), 4000)) === true)
  await shot('gone-forget-dialog')
  const kept = await dialogFacts()
  check('that screen says the local copy is kept, and its button is disabled until the name is typed', kept !== null && /local copy/i.test(kept.text) && kept.btns.some((b) => b.kb === 'apps-confirm' && b.disabled === true), kept && kept.text.slice(0, 300))
  check('Cancel changes nothing (the app is still published)', (await click(kb('apps-cancel'), 300)) && !(await exists(kb('apps-dialog'))) && !!(await shopOf()).published)
  await unfake()
  await ev(`document.dispatchEvent(new Event('visibilitychange')); 1`)
  check('with the state real again, the page reads it and the normal note is back, with Unpublish…', (await until(async () => (await exists(kb('apps-unpublish'))) && !(await exists(kb('apps-published-note') + '[data-gone="true"]')), 8000)) === true)

  group('Unpublish for real')
  check('Unpublish… opens its dialog', (await click(kb('apps-unpublish'), 300)) && (await until(() => exists(kb('apps-dialog')), 4000)) === true)
  check('and it confirms', await click(kb('apps-confirm'), 400))
  check('the app is a plain local one again', (await until(async () => { const d = await shopOf(); return d && !d.published }, 40000)) === true)
  await until(async () => !(await exists(kb('apps-dialog'))), 8000)
  await sleep(800)
  check('the header offers Publish… again and the pill is gone', (await exists(kb('apps-publish'))) && !(await exists(kb('apps-published-pill'))))
  await shot('unpublished-1400')
  const errs = await ev('window.__errs')
  check('no uncaught error on the page', Array.isArray(errs) && errs.length === 0, errs)
  check('the page text is free of leftovers (no raw keys, no undefined)', !/undefined|\[object|NaN/.test(await bodyText()))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'Publish dialog: all ' + pass + ' checks passed' : 'Publish dialog: ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
