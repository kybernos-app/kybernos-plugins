#!/usr/bin/env node
// Checks the REAL MAP of the Catalog page (docs/dev/business-visuals.md) in a real browser against the SANDBOX: the real-estate template's sample on real Paris streets, the
// Map view opened for real, real tiles from OpenFreeMap, the price pills (hover, choose, cluster, keyboard), the buttons, the attribution, both schemes, a phone width, reduced
// motion, and the ways it must fail well (the tile host blocked, the tiles alone blocked, offline, no WebGL) without ever leaving a blank or broken box.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-catalog-map-live.mjs [--shots <dir>] [--offline-tiles]
//
// It needs the INTERNET (OpenFreeMap): without it the run says so and exits 3 (the fallbacks are then all that could be measured). Apart from that, SANDBOX ONLY: it refuses the DSH
// on :3080 or a shell without a sandbox DSH_HOME, because it writes the sandbox's business base (the sample rows, seeded the way a template install does, then removed), accepts the
// real-estate template in the sandbox's registry, and presses DSH's Light and Dark cards of the sandbox profile (the mode it found is put back).
//  - The sandbox is a clone of the owner's profile, which carries the sector templates as RELATIVE links that do not resolve once the home is the sandbox's: the real-estate link is
//    pointed at THIS checkout's folder (an absolute link, in the sandbox profile only), so the sample that is measured is this checkout's.
//  - --shots <dir>: one PNG per state, kept outside git (media never go in the repository).
//  - What the page asks of the network is recorded from the browser (Network domain): no request to OpenFreeMap or for the library before the Map view is opened; after it, only the
//    sandbox and tiles.openfreemap.org; and no cookie and no referrer on what goes to OpenFreeMap.
// Exit code: 0 all green, 1 a check failed, 3 not run (no sandbox, no GUI, no internet).
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { goToSettingsPage, openLivePage, openSettings, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST "' + host + '", DSH_HOME "' + dshHome + '")'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}

// ── the internet, the sandbox's data and its profile ─────────────────────────────────────────────────────
const online = await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false)
if (!online) { console.error('○ not run: tiles.openfreemap.org does not answer (the map needs the internet)'); process.exit(3) }
const THEME_ID = 'kybernos-themes/real-estate'
const themeLink = join(dshHome, 'profiles', 'web', 'node_modules', '@kybernos-themes', 'real-estate')
const themeDir = join(repo, 'packages', 'kybernos-plugin', 'themes', 'real-estate')
const linkedHere = () => { try { return realpathSync(themeLink) === realpathSync(themeDir) } catch (e) { return false } }
if (!existsSync(join(dshHome, 'profiles', 'web', 'package.json')) || !readFileSync(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8').includes('@kybernos-themes/real-estate')) {
  console.error('○ not run: the sandbox profile does not have the real-estate template (install it from Settings › Templates in the sandbox first)'); process.exit(3)
}
if (!linkedHere()) {
  try { if (lstatSync(themeLink)) rmSync(themeLink, { force: true, recursive: true }) } catch (e) { /* no link yet */ }
  symlinkSync(themeDir, themeLink)
  console.log('  (the sandbox\'s real-estate link now points at this checkout: ' + readlinkSync(themeLink).replace(process.env.KB_REAL_HOME || '~', '~') + ')')
}
const baseFile = join(dshHome, 'kybernos', 'business', 'donnees.sqlite')
const base = createBusinessBase({ file: baseFile })
const sample = JSON.parse(readFileSync(join(themeDir, 'demo', 'sample.json'), 'utf8'))
const properties = sample.items.filter((i) => i.type === 'property')

// ── the browser ──────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const shotOf = async (name, sel, scale = 1.5) => {
  if (shotsDir === null) return
  const r = await rect(sel)
  if (r === null) return
  const res = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.w, height: r.h, scale } })
  if (res.result && res.result.data) (await import('node:fs')).writeFileSync(join(shotsDir, name + '.png'), Buffer.from(res.result.data, 'base64'))
}
const SEL = (kb, extra) => '[data-kb="' + kb + '"]' + (extra || '')
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const attr = (sel, a, i = 0) => ev(`(document.querySelectorAll(${JSON.stringify(sel)})[${i}] || { getAttribute () { return null } }).getAttribute(${JSON.stringify(a)})`)
const rect = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height } })()`)
const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
const scrollTo = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
/** A real mouse click at the centre of the element, after checking that the element is what is under the pointer (nothing covers it). */
const click = async (sel, i = 0) => {
  const r = await rect(sel, i)
  if (r === null) return false
  const top = await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; const t = document.elementFromPoint(${r.x}, ${r.y}); return t === e || e.contains(t) })()`)
  if (top !== true) { console.log('     (the click on ' + sel + ' did not land: under the pointer there is ' + (await ev(`(() => { const t = document.elementFromPoint(${r.x}, ${r.y}); return t === null ? 'nothing (outside the window: ' + innerWidth + 'x' + innerHeight + ' at ' + ${r.x} + ',' + ${r.y} + ')' : t.tagName + '.' + String(t.className).slice(0, 60) })()`)) + ')'); return false }
  await mouse('mouseMoved', r.x, r.y); await mouse('mousePressed', r.x, r.y); await mouse('mouseReleased', r.x, r.y)
  await sleep(450)
  return true
}
/** A click on something of the map's box: the box (sticky) is brought into view first, and the click must have landed. */
const onMap = async (sel, i = 0) => { await ev(`document.querySelector('[data-kb="catalog-map-box"]').scrollIntoView({ block: 'center' })`); await sleep(250); return click(sel, i) }
const hover = async (sel, i = 0) => { const r = await rect(sel, i); if (r === null) return false; await mouse('mouseMoved', r.x, r.y); await sleep(350); return true }
const key = async (k, code, vk, extra = {}) => {
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, extra))
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(300)
}
const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
const zoom = async () => Number(await attr('.kbcg-gl', 'data-zoom'))
const mapState = () => attr(SEL('catalog-map-box'), 'data-map')
const pinsOf = () => ev(`(() => { const out = { pins: 0, clusters: 0, total: 0 }; for (const e of document.querySelectorAll('.kbcg-rp')) { if (e.getAttribute('data-kb') === 'catalog-pin') { out.pins += 1; out.total += 1 } else { out.clusters += 1; out.total += Number(e.innerText) } } return out })()`)
const rgb = (css) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css) || /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css)
  if (m === null) return null
  const v = [m[1], m[2], m[3]].map(Number)
  return v.some((x) => x <= 1.0001) && /^color\(/.test(css) ? v.map((x) => x * 255) : v
}
const luminance = (c) => { const f = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] }
/** The contrast of an element's text against the first opaque background above it (the element's own box first). */
const contrastOf = async (sel, i = 0) => {
  const r = await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return null; const fg = getComputedStyle(e).color; let n = e; let bg = 'rgba(0, 0, 0, 0)'; while (n !== null) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\\(.*,\\s*0\\)$/.test(c) && c !== 'transparent') { bg = c; break } n = n.parentElement } return { fg, bg } })()`)
  if (r === null || r.err) return null
  const a = rgb(r.fg); const b = rgb(r.bg)
  if (a === null || b === null) return { unreadable: r }
  const la = luminance(a); const lb = luminance(b)
  return { ratio: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), fg: r.fg, bg: r.bg }
}

// what the page asks of the network, from the browser itself
const requests = []
await page.send('Network.enable', {})
page.on('Network.requestWillBeSent', (p) => { requests.push({ id: p.requestId, url: p.request.url, headers: p.request.headers || {}, at: Date.now(), extra: {} }) })
page.on('Network.loadingFailed', (p) => { const r = requests.find((x) => x.id === p.requestId); if (r !== undefined) r.failed = p.errorText + (p.blockedReason ? ' ' + p.blockedReason : '') + (p.canceled ? ' canceled' : '') })
page.on('Network.requestWillBeSentExtraInfo', (p) => { const r = requests.find((x) => x.id === p.requestId); if (r !== undefined) r.extra = p.headers || {} })
// The tiles are fetched by the library's WORKER, which the page's own Network domain does not see: a second connection to the same page attaches to its workers (the way the
// browser's developer tools do) and records theirs into the same list.
const watchWorkers = async () => {
  const ws = new WebSocket(page.info.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  let seq = 0
  const sessions = []
  let blocked = []
  const send = (method, params, sessionId) => ws.send(JSON.stringify(Object.assign({ id: ++seq, method, params: params || {} }, sessionId === undefined ? {} : { sessionId })))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Target.attachedToTarget') { sessions.push(m.params.sessionId); send('Network.enable', {}, m.params.sessionId); send('Network.setBlockedURLs', { urls: blocked }, m.params.sessionId); send('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId); return }
    if (m.method === 'Network.requestWillBeSent') requests.push({ id: m.sessionId + m.params.requestId, url: m.params.request.url, headers: m.params.request.headers || {}, at: Date.now(), extra: {}, worker: true })
    if (m.method === 'Network.requestWillBeSentExtraInfo') { const r = requests.find((x) => x.id === m.sessionId + m.params.requestId); if (r !== undefined) r.extra = m.params.headers || {} }
  })
  // not paused at start: a worker that waited for this watcher would stall the map if the watcher were ever late (the attach is a few milliseconds, the first tile is asked for after the style and the TileJSON)
  const arm = () => send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
  arm()
  return {
    stop: () => { try { ws.close() } catch (e) { /* closed */ } },
    arm,
    /** What the library's workers may not fetch (page-level blocking does not reach them). */
    block: (urls) => { blocked = urls; for (const sid of sessions) send('Network.setBlockedURLs', { urls }, sid) },
  }
}
const workers = await watchWorkers()
const front = async () => { await page.send('Page.bringToFront', {}); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }) }
await front()
const hostOf = (u) => { try { return new URL(u).host } catch (e) { return '' } }
const sent = (r, name) => [r.headers, r.extra].some((h) => Object.keys(h).some((k) => k.toLowerCase() === name && String(h[k]) !== ''))
const MAPHOST = 'tiles.openfreemap.org'
const errors = []
page.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 200)) })
await page.send('Runtime.enable', {})

const ROWS = `[...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')]`
const openCatalog = async () => {
  await waitFor(page, `window.__KB_MENU__ && window.__KB_MENU__.ids().indexOf('catalog') >= 0 && ${ROWS}.length >= 3`, 25000)
  await sleep(500)
  const idx = await ev(`${ROWS}.findIndex((e) => /catalog|catalogue|propert|bien/i.test(e.getAttribute('aria-label') || ''))`)
  if (!(typeof idx === 'number' && idx >= 0)) return false
  const ok = await click('[data-kb="menu-business"] .kb4-item:nth-of-type(' + (idx + 1) + ')')
  await waitFor(page, `!!document.querySelector('[data-kb="catalog-page"]')`, 8000)
  await sleep(900)
  return ok
}
/** The view buttons are the core's toolbar (a `kb6-tb-vbtn` with the name beside the icon). */
const pressView = async (re) => {
  await ev(`(() => { document.querySelectorAll('[data-probe="view"]').forEach((b) => b.removeAttribute('data-probe')); const re = ${re.toString()}; const b = [...document.querySelectorAll('.kb6-tb-vbtn')].find((e) => re.test((e.getAttribute('aria-label') || '') + ' ' + e.innerText)); if (b) b.setAttribute('data-probe', 'view') })()`)
  await ev(`document.querySelector('[data-probe="view"]').scrollIntoView({ block: 'center' })`)
  await sleep(200)
  return click('[data-probe="view"]')
}
const openMap = async () => {
  await pressView(/map|carte/i)
  return waitFor(page, `!!document.querySelector('[data-kb="catalog-map-box"]')`, 8000)
}
const darkNow = () => ev(`document.body.hasAttribute('data-ds-dark-theme')`)
/** DSH's own mode (Settings › Theme, the Light and Dark cards); the sandbox profile keeps the choice. */
const setScheme = async (to) => {
  if (((await darkNow()) === true ? 'dark' : 'light') === to) return true
  if (!(await openSettings(page))) return false
  await goToSettingsPage(page, /^theme/i, { marker: `!!document.querySelector('.kbth-mode')` })
  await ev(`(() => { const c = document.querySelector('.kbth-mode[data-mode="${to}"]'); if (c) c.click() })()`)
  await sleep(1500)
  for (let i = 0; i < 3; i += 1) await key('Escape', 'Escape', 27)
  await waitFor(page, `document.body.hasAttribute('data-ds-dark-theme') === ${to === 'dark'}`, 5000)
  return ((await darkNow()) === true ? 'dark' : 'light') === to
}
const startScheme = (await darkNow()) === true ? 'dark' : 'light'

try {
  // ── the template and its sample ───────────────────────────────────────────────────────────────────────
  console.log('The real-estate template and its sample, placed on real streets')
  base.deleteAll({ confirm: true, actor: 'person' })
  const consent = await ev(`fetch('/kybernos-registry/consent', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(THEME_ID)}, accepted: true }) }).then((r) => r.status)`)
  check('the sandbox accepts the real-estate template (its instruction data)', consent === 200, consent)
  check('the catalogue then speaks the theme\'s « property » type', (await waitFor(page, `fetch('/kybernos-catalog/types', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.source === 'theme' && j.types.some((t) => t.id === 'property' && t.map && t.views.includes('map')))`, 25000)) === true)
  const seeded = base.seed({ items: properties }, { theme: THEME_ID })
  check('the sixteen sample properties are seeded the way a template install does', seeded.ok === true && seeded.counts.items === 16, seeded)
  const rows = await ev(`fetch('/kybernos-catalog/list?limit=100', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j.rows.map((r) => [r.fields.lat, r.fields.lng])))`)
  const places = JSON.parse(rows)
  check('every one stands in Paris, on its own spot (not the made-up coordinates of an invented town)', places.length === 16 && places.every(([lat, lng]) => lat > 48.8 && lat < 48.92 && lng > 2.2 && lng < 2.5) && new Set(places.map((p) => p.join())).size === 16, places)

  // ── nothing is asked until the Map view is opened ─────────────────────────────────────────────────────
  console.log('Nothing is fetched until the Map view is opened')
  await page.send('Page.reload', {})
  workers.arm()
  await front()
  await sleep(2500)
  requests.length = 0
  check('the page opens from the menu', (await openCatalog()) === true && (await count(SEL('catalog-page'))) === 1)
  check('the cards are there, with no map (the default view)', (await count(SEL('catalog-card'))) === 16 && (await count(SEL('catalog-map-box'))) === 0)
  await pressView(/list|liste/i)
  await sleep(600)
  await pressView(/cards|cartes/i)
  await sleep(600)
  const early = requests.filter((r) => /openfreemap|maplibre/i.test(r.url))
  check('cards and list asked for nothing of the map: no OpenFreeMap request, no library file', early.length === 0, early.map((r) => r.url))
  check('and the library is not in the page', (await ev(`typeof window.maplibregl`)) === 'undefined' && (await count('script[src*="maplibre"], link[href*="maplibre"]')) === 0)

  // ── the Map view, for real ────────────────────────────────────────────────────────────────────────────
  console.log('The Map view')
  const mark = requests.length
  check('the Map button opens the view', (await openMap()) !== null)
  check('the map comes up: real, not the drawing (tiles from OpenFreeMap within 8 s)', (await waitFor(page, `document.querySelector('[data-kb="catalog-map-box"]').getAttribute('data-map') === 'real'`, 12000)) === true, await mapState())
  await sleep(2500)
  const asked = requests.slice(mark)
  const hosts = [...new Set(asked.map((r) => hostOf(r.url)).filter((h) => h !== ''))]
  check('what it asked for: the two files of the library from this plugin, and the style, fonts and tiles (the tiles are asked by the library\'s worker) from OpenFreeMap', asked.some((r) => /\/kybernos-catalog\/vendor\/maplibre-gl\.js/.test(r.url)) && asked.some((r) => /\/kybernos-catalog\/vendor\/maplibre-gl\.css/.test(r.url)) && asked.some((r) => r.url === 'https://tiles.openfreemap.org/styles/positron') && asked.some((r) => /tiles\.openfreemap\.org\/planet\/.+\.pbf/.test(r.url) && r.worker === true) && asked.some((r) => /tiles\.openfreemap\.org\/fonts\//.test(r.url)), hosts)
  check('…and from nobody else (no analytics, no second tile server, no sprite)', hosts.every((h) => h === host || h === MAPHOST || h === '') && !asked.some((r) => /sprites\//.test(r.url)), hosts)
  const remote = asked.filter((r) => hostOf(r.url) === MAPHOST)
  check('what goes to OpenFreeMap (the style, the fonts, the tiles: ' + remote.length + ' requests) carries no cookie and no referrer', remote.length > 5 && remote.every((r) => !sent(r, 'cookie') && !sent(r, 'referer')), remote.filter((r) => sent(r, 'cookie') || sent(r, 'referer')).slice(0, 2).map((r) => [r.url, r.headers, r.extra]))
  const z0 = await zoom()
  check('the map is a real WebGL canvas that fills its box', (await ev(`(() => { const c = document.querySelector('.maplibregl-canvas'); const b = document.querySelector('[data-kb="catalog-map-box"]').getBoundingClientRect(); const r = c.getBoundingClientRect(); return !!c.getContext && r.width >= b.width - 3 && r.height >= b.height - 3 && r.width > 300 && r.height > 300 })()`)) === true)
  const count0 = await pinsOf()
  check('all sixteen properties are on it, as pins and clusters (the counts add up to 16)', count0.total === 16 && count0.pins + count0.clusters > 1, count0)
  check('at the start the whole set is in view, at a city zoom', z0 > 9 && z0 < 14, z0)
  check('pins and clusters are buttons the keyboard reaches, each named for a screen reader', (await ev(`[...document.querySelectorAll('.kbcg-rp')].every((e) => e.tagName === 'BUTTON' && e.tabIndex >= 0 && (e.getAttribute('aria-label') || '').length > 3)`)) === true)
  const box = await rect(SEL('catalog-map-box'))
  const cards = await rect(SEL('catalog-cards'))
  check('the map sits beside the cards, never over them', box !== null && cards !== null && !overlaps(box, cards) && box.left > cards.left)
  const attrib = await rect(SEL('catalog-map-attribution'))
  check('the attribution is on the map, bottom-right, and inside the screen', attrib !== null && attrib.right <= box.right + 1 && attrib.bottom <= box.bottom + 1 && attrib.left > box.left + box.w / 3 && attrib.top > box.top + box.h * 0.6 && attrib.bottom < 900, { attrib, box })
  const credit = await ev(`document.querySelector('[data-kb="catalog-map-attribution"]').innerText.replace(/\\s+/g, ' ')`)
  check('it names OpenFreeMap, OpenMapTiles and the OpenStreetMap contributors, each a link that opens apart', /OpenFreeMap/.test(credit) && /OpenMapTiles/.test(credit) && /OpenStreetMap contributors/.test(credit) && (await ev(`[...document.querySelectorAll('[data-kb="catalog-map-attribution"] a')].map((a) => a.target + a.rel + new URL(a.href).host).join()`)) === '_blanknoopener noreferreropenfreemap.org,_blanknoopener noreferrerwww.openmaptiles.org,_blanknoopener noreferrerwww.openstreetmap.org', credit)
  const noteBox = await rect(SEL('catalog-map-note'))
  check('the caption (« 16 places ») and the attribution do not overlap', noteBox !== null && !overlaps(noteBox, attrib) && /16 places/.test(await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText`)) && !/chematic/.test(await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText`)))
  const ctl = await rect('.kbcg-mapctl')
  check('the three buttons are inside the map, top-right, and do not touch the caption', ctl !== null && ctl.right <= box.right && ctl.top >= box.top && !overlaps(ctl, noteBox) && (await count(SEL('catalog-map-zoom-in'))) === 1 && (await count(SEL('catalog-map-zoom-out'))) === 1 && (await count(SEL('catalog-map-fit'))) === 1)
  const pill = await contrastOf('.kbcg-rp[data-kb="catalog-pin"] .p')
  const credits = await contrastOf(SEL('catalog-map-attribution'))
  check('a price is readable on its pill (4.5:1), and so is the attribution (4.5:1)', pill !== null && pill.ratio >= 4.5 && credits !== null && credits.ratio >= 4.5, [pill, credits])
  check('no script error so far', errors.length === 0, errors)
  await shot('01-map-page')
  await shotOf('02-map-' + startScheme, SEL('catalog-map-box'))

  // ── hover, choose, cluster ────────────────────────────────────────────────────────────────────────────
  console.log('Pins, cards, clusters')
  await scrollTo(SEL('catalog-card'), 0)
  await sleep(300)
  const firstId = await attr(SEL('catalog-card'), 'data-id', 0)
  await hover(SEL('catalog-card'), 0)
  check('the pointer on a card lights its pin or its cluster', (await ev(`[...document.querySelectorAll('.kbcg-rp.hot')].some((e) => (e.getAttribute('data-id') === ${JSON.stringify(firstId)}) || (e.getAttribute('data-kb') === 'catalog-cluster'))`)) === true, firstId)
  await mouse('mouseMoved', 5, 5)
  await sleep(300)
  check('and it goes out with the pointer', (await count('.kbcg-rp.hot')) === 0)
  const pinId = await attr(SEL('catalog-pin'), 'data-id', 0)
  await scrollTo(SEL('catalog-map-box'))
  await hover(SEL('catalog-pin'), 0)
  check('the pointer on a pin lights its card', (await ev(`document.querySelector('[data-kb="catalog-card"][data-id="${pinId}"]').className.includes('hot')`)) === true)
  const lift = await ev(`getComputedStyle(document.querySelector('.kbcg-rp[data-id="${pinId}"] .b')).transform`)
  check('the hovered pin lifts and is filled with the ink colour, as the page\'s cards are ringed', lift !== 'none' && (await ev(`getComputedStyle(document.querySelector('.kbcg-rp[data-id="${pinId}"] .p')).backgroundColor`)) !== (await ev(`getComputedStyle(document.querySelector('.kbcg-rp:not(.hot):not(.cluster) .p')).backgroundColor`)), lift)
  await shotOf('03-hover-pin', SEL('catalog-map-box'))
  const zBefore = await zoom()
  check('a real click on the pin opens the item', (await click(SEL('catalog-pin'), 0)) === true && (await waitFor(page, `!!document.querySelector('[data-kb="catalog-panel"]')`, 4000)) === true)
  await sleep(1500)
  const panel = await rect(SEL('catalog-panel'))
  const box2 = await rect(SEL('catalog-map-box'))
  const cardsNow = await rect(SEL('catalog-cards'))
  check('its details are a panel ABOVE the cards, in the left column, never over the map', panel !== null && box2 !== null && cardsNow !== null && !overlaps(panel, box2) && panel.top < cardsNow.top + 4 && /inline/.test(await attr(SEL('catalog-panel'), 'class')))
  const sel = await ev(`(() => { const e = document.querySelector('.kbcg-rp.sel'); if (!e) return null; const cs = getComputedStyle(e.querySelector('.p')); const acc = getComputedStyle(document.querySelector('.kbcg')).getPropertyValue('--kbcg-accent').trim(); return { id: e.getAttribute('data-id'), pressed: e.getAttribute('aria-pressed'), bg: cs.backgroundColor, accent: acc } })()`)
  check('the chosen pin is the filled one (the accent colour) and says it is pressed', sel !== null && sel.pressed === 'true' && String(sel.id) === String(pinId), sel)
  const selContrast = await contrastOf('.kbcg-rp.sel .p')
  check('and its price stays readable on the accent (4.5:1)', selContrast !== null && selContrast.ratio >= 4.5, selContrast)
  await shot('04-chosen')
  await shotOf('05-chosen-map', SEL('catalog-map-box'))
  check('choosing a pin did not zoom the map out, and left it with the pin in view', (await zoom()) >= zBefore - 0.01 && (await ev(`(() => { const p = document.querySelector('.kbcg-rp.sel').getBoundingClientRect(); const b = document.querySelector('[data-kb="catalog-map-box"]').getBoundingClientRect(); return p.left > b.left && p.right < b.right && p.top > b.top && p.bottom < b.bottom })()`)) === true)
  // close the panel, then a card opens an item that was inside a cluster: the map flies in until it stands alone
  await click(SEL('catalog-close'))
  await sleep(500)
  await click('[data-kb="catalog-map-fit"]')
  await sleep(1500)
  const zFit = await zoom()
  const inCluster = await ev(`(() => { const cs = [...document.querySelectorAll('[data-kb="catalog-cluster"]')]; return cs.length })()`)
  check('« show everything » brings the whole set back in view (clusters again)', inCluster > 0 && (await pinsOf()).total === 16, { zFit, inCluster })
  const zc = await zoom()
  const pins1 = await pinsOf()
  await scrollTo(SEL('catalog-map-box'))
  check('a real click on a cluster zooms in on its members', (await click(SEL('catalog-cluster'), 0)) === true)
  await sleep(1800)
  const pins2 = await pinsOf()
  check('…the map is closer, the cluster has come apart into more pins, and nothing was lost', (await zoom()) > zc + 0.9 && pins2.pins > pins1.pins && pins2.total === 16, { zc, z: await zoom(), pins1, pins2 })
  await shotOf('06-after-cluster', SEL('catalog-map-box'))
  await click('[data-kb="catalog-map-zoom-out"]')
  await sleep(900)
  const zOut = await zoom()
  await click('[data-kb="catalog-map-zoom-in"]')
  await sleep(900)
  check('the zoom buttons move the zoom, out then in', zOut < (await zoom()) && zOut < zc + 3)
  await click('[data-kb="catalog-map-fit"]')
  await sleep(1600)
  check('« show everything » returns to the first view', Math.abs((await zoom()) - z0) < 0.8 && (await pinsOf()).total === 16, { z0, z: await zoom() })
  // a card that is hidden in a cluster: choosing it flies the map in until it stands alone
  const hidden = await ev(`(() => { const inPin = new Set([...document.querySelectorAll('[data-kb="catalog-pin"]')].map((e) => e.getAttribute('data-id'))); const c = [...document.querySelectorAll('[data-kb="catalog-card"]')].find((e) => !inPin.has(e.getAttribute('data-id'))); return c ? c.getAttribute('data-id') : null })()`)
  if (hidden !== null) {
    const zBeforeCard = await zoom()
    await scrollTo(SEL('catalog-card', '[data-id="' + hidden + '"]'))
    await click(SEL('catalog-card', '[data-id="' + hidden + '"]') + ' ' + SEL('catalog-card-open'))
    await sleep(2200)
    check('choosing, from the cards, an item that was inside a cluster flies the map in until its own pin shows (and lights)', (await zoom()) > zBeforeCard + 0.5 && (await count('.kbcg-rp.sel[data-kb="catalog-pin"][data-id="' + hidden + '"]')) === 1, { hidden, zBeforeCard, z: await zoom() })
    await shotOf('07-flown-to-card', SEL('catalog-map-box'))
    await click(SEL('catalog-close'))
  } else check('(every pin was alone: no card to fly to)', true)
  await click('[data-kb="catalog-map-fit"]')
  await sleep(1500)

  // ── the keyboard ──────────────────────────────────────────────────────────────────────────────────────
  console.log('The keyboard')
  await scrollTo(SEL('catalog-map-box'))
  await ev(`document.querySelector('.maplibregl-canvas').focus()`)
  await key('Tab', 'Tab', 9)
  const first = await ev(`document.activeElement.getAttribute('data-kb') || document.activeElement.tagName`)
  check('Tab from the map goes to the first pin or cluster, which is a button with a visible ring', (first === 'catalog-pin' || first === 'catalog-cluster') && (await ev(`getComputedStyle(document.activeElement.querySelector('.p')).outlineStyle`)) === 'solid', first)
  await shotOf('08-focus-ring', SEL('catalog-map-box'))
  if (first === 'catalog-cluster') {
    const zk = await zoom()
    await key('Enter', 'Enter', 13, { text: '\r' })
    await sleep(1800)
    check('Enter on a cluster zooms in, and the keyboard stays on the map (the focus goes to its first member)', (await zoom()) > zk + 0.5 && (await ev(`document.activeElement.classList.contains('kbcg-rp')`)) === true, { zk, z: await zoom() })
  }
  await ev(`document.querySelector('.maplibregl-canvas').focus()`)
  for (let i = 0; i < 16 && (await ev(`document.activeElement.getAttribute('data-kb')`)) !== 'catalog-pin'; i += 1) await key('Tab', 'Tab', 9)
  const focused = await attr('.kbcg-rp:focus', 'data-id')
  check('a pin is reached by Tab, and lights its card while it has the focus', focused !== null && (await ev(`document.querySelector('[data-kb="catalog-card"][data-id="${focused}"]').className.includes('hot')`)) === true, focused)
  await key('Enter', 'Enter', 13, { text: '\r' })
  await sleep(1200)
  check('Enter on it opens the item, as the panel above the cards', (await count(SEL('catalog-panel'))) === 1 && (await attr(SEL('catalog-panel'), 'data-id')) === focused)
  await key('Escape', 'Escape', 27)
  await sleep(500)
  check('Escape closes the panel', (await count(SEL('catalog-panel'))) === 0)

  // ── the filter ────────────────────────────────────────────────────────────────────────────────────────
  console.log('A filter changes the pins')
  await scrollTo(SEL('catalog-chip'), 1)
  await click(SEL('catalog-chip'), 1)
  await sleep(1800)
  const chipText = await ev(`document.querySelectorAll('[data-kb="catalog-chip"]')[1].innerText.replace(/\\s+/g, ' ')`)
  const cardsLeft = await count(SEL('catalog-card'))
  const filtered = await pinsOf()
  check('a status chip (« ' + chipText + ' »): the pins are those of the cards left, no more, and the caption counts them', filtered.total === cardsLeft && cardsLeft < 16 && cardsLeft > 0 && new RegExp(cardsLeft + ' places?').test(await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText`)), { cardsLeft, filtered })
  await click(SEL('catalog-chip'), 0)
  await sleep(1500)
  check('« All » brings the sixteen back', (await pinsOf()).total === 16)

  // ── the schemes ───────────────────────────────────────────────────────────────────────────────────────
  console.log('Light and dark')
  const other = startScheme === 'dark' ? 'light' : 'dark'
  await scrollTo(SEL('catalog-map-box'))
  const schemeNow = await attr('.kbcg-gl', 'data-scheme')
  check('the map says which page it was drawn for (' + startScheme + ')', schemeNow === startScheme, schemeNow)
  const bg1 = await ev(`getComputedStyle(document.querySelector('.kbcg-rp:not(.cluster) .p')).backgroundColor`)
  check('the other mode is reached from Settings › Theme', (await setScheme(other)) === true)
  await waitFor(page, `document.querySelector('.kbcg-gl') && document.querySelector('.kbcg-gl').getAttribute('data-scheme') === ${JSON.stringify(other)}`, 8000)
  await sleep(2500)
  check('the open map follows the page: its scheme changes by itself, its pins are drawn for it', (await attr('.kbcg-gl', 'data-scheme')) === other && (await ev(`getComputedStyle(document.querySelector('.kbcg-rp:not(.cluster) .p')).backgroundColor`)) !== bg1)
  const pill2 = await contrastOf('.kbcg-rp[data-kb="catalog-pin"] .p')
  const credits2 = await contrastOf(SEL('catalog-map-attribution'))
  check('prices and the attribution are readable in the ' + other + ' page too (4.5:1)', pill2 !== null && pill2.ratio >= 4.5 && credits2 !== null && credits2.ratio >= 4.5, [pill2, credits2])
  check('and the pins are still all there', (await pinsOf()).total === 16)
  await shotOf('09-map-' + other, SEL('catalog-map-box'))
  await shot('09-page-' + other)
  await hover(SEL('catalog-pin'), 0)
  await shotOf('10-hover-' + other, SEL('catalog-map-box'))
  await click(SEL('catalog-pin'), 0)
  await sleep(1500)
  await shotOf('11-chosen-' + other, SEL('catalog-map-box'))
  check('in the ' + other + ' page the chosen pin keeps its readable fill (4.5:1)', ((await contrastOf('.kbcg-rp.sel .p')) || { ratio: 0 }).ratio >= 4.5)
  await click(SEL('catalog-close'))
  await sleep(400)

  // ── a phone ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('A phone')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 880, deviceScaleFactor: 2, mobile: true })
  await sleep(1500)
  await ev(`window.scrollTo(0, 0)`)
  const phoneBox = await rect(SEL('catalog-map-box'))
  const phoneCards = await rect(SEL('catalog-cards'))
  check('at 420 px the map is stacked above the cards, 300 px high, inside the screen, and the page does not scroll sideways', phoneBox !== null && phoneCards !== null && phoneBox.bottom <= phoneCards.top + 2 && Math.abs(phoneBox.h - 300) < 3 && phoneBox.left >= 0 && phoneBox.right <= 421 && (await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, { phoneBox, phoneCards })
  const pn = await rect(SEL('catalog-map-note'))
  const pa = await rect(SEL('catalog-map-attribution'))
  const pc = await rect('.kbcg-mapctl')
  check('on the phone the whole attribution is on the map: its text is not cut (it wraps instead), and it names the three credits', pa !== null && (await ev(`(() => { const a = document.querySelector('[data-kb="catalog-map-attribution"]'); return a.scrollWidth <= a.clientWidth + 1 && a.getBoundingClientRect().height < 60 && /OpenFreeMap/.test(a.innerText) && /OpenStreetMap contributors/.test(a.innerText) })()`)) === true, pa)
  check('on the phone the caption, the attribution and the buttons are inside the map and do not overlap one another', pn !== null && pa !== null && pc !== null && !overlaps(pn, pa) && !overlaps(pc, pa) && !overlaps(pc, pn) && pa.left >= phoneBox.left && pa.right <= phoneBox.right && pa.bottom <= phoneBox.bottom && pn.bottom <= phoneBox.bottom, { pn, pa, pc, phoneBox })
  check('the pins are there and the pills are big enough for a finger (at least 32 px high)', (await pinsOf()).total === 16 && (await ev(`[...document.querySelectorAll('.kbcg-rp')].every((e) => e.getBoundingClientRect().height >= 32)`)) === true)
  await shotOf('12-phone-map', SEL('catalog-map-box'), 2)
  await shot('12-phone-page')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(1200)

  // ── reduced motion ────────────────────────────────────────────────────────────────────────────────────
  console.log('Reduced motion')
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(500)
  check('a pin stops moving: no transition on the pill, the lift or the tail', (await ev(`(() => { const e = document.querySelector('.kbcg-rp'); return ['.b', '.p', '.t'].every((s) => { const n = e.querySelector(s); return n === null || getComputedStyle(n).transitionDuration.split(',').every((d) => parseFloat(d) === 0) }) })()`)) === true)
  await click('[data-kb="catalog-map-fit"]')
  await sleep(500)
  const zFar = await zoom()
  await scrollTo(SEL('catalog-card'), 5)
  await click(SEL('catalog-card', ':nth-of-type(6)') + ' ' + SEL('catalog-card-open'))
  await sleep(250)
  const zJump = await zoom()
  await sleep(1500)
  check('and the map jumps to a chosen item instead of flying (the zoom is already final 250 ms after the click)', Math.abs((await zoom()) - zJump) < 0.01, { zFar, zJump, zEnd: await zoom() })
  await click(SEL('catalog-close'))
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

  // ── when the real map cannot be had ───────────────────────────────────────────────────────────────────
  console.log('When the real map cannot be had: never a blank or broken box')
  await page.send('Network.setCacheDisabled', { cacheDisabled: true })
  const drawnOk = async (why) => {
    const state = await waitFor(page, `document.querySelector('[data-kb="catalog-map-box"]') && document.querySelector('[data-kb="catalog-map-box"]').getAttribute('data-map') === 'drawn'`, 14000)
    const b = await rect(SEL('catalog-map-box'))
    const svg = await rect('svg[data-kb="catalog-map"]')
    const note = await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText.replace(/\\s+/g, ' ')`)
    return state === true && b !== null && b.w > 300 && b.h > 300 && svg !== null && svg.w > 300 && (await count('svg[data-kb="catalog-map"] .block')) > 50 && (await count(SEL('catalog-pin'))) === 16 && /Schematic map/.test(note) && (why === undefined || why.test(note))
  }
  const reopenMap = async () => { await pressView(/cards|cartes/i); await sleep(500); return openMap() }
  const freshPage = async () => { await page.send('Page.reload', {}); workers.arm(); await front(); await sleep(3000); return openCatalog() } // a new page: the style and the library are not remembered
  const whyNot = async () => (await mapState()) + ' [' + (await attr(SEL('catalog-map-why'), 'data-why')) + '] | ' + (await ev(`(document.querySelector('[data-kb="catalog-map-note"]') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`)) + ' | page: ' + (await ev(`document.visibilityState`)) + ' | page errors: ' + JSON.stringify(errors.slice(-2)) + ' | last OpenFreeMap requests: ' + JSON.stringify(requests.filter((r) => hostOf(r.url) === MAPHOST).slice(-3).map((r) => r.url.slice(-30) + ' ' + (r.failed || 'ok?')))
  const realAgain = () => waitFor(page, `document.querySelector('[data-kb="catalog-map-box"]') && document.querySelector('[data-kb="catalog-map-box"]').getAttribute('data-map') === 'real'`, 14000)
  // 1. the tile host blocked (the style cannot be had)
  await page.send('Network.setBlockedURLs', { urls: ['https://tiles.openfreemap.org/*'] })
  await freshPage()
  const t0 = Date.now()
  await openMap()
  check('the OpenFreeMap host blocked (style): the drawn map comes by itself, its caption says it is a drawing and why, with a button', (await drawnOk(/unavailable/)) && (await count(SEL('catalog-map-retry'))) === 1)
  check('…and it comes fast (the style fails at once; the timeout is for slow networks)', Date.now() - t0 < 6000, Date.now() - t0)
  await shotOf('13-fallback-style-blocked', SEL('catalog-map-box'))
  check('the drawn map keeps what the real one had: sixteen pins that take the keyboard, and the three buttons', (await count('.kbcg-pin[tabindex="0"]')) === 16 && (await count(SEL('catalog-map-zoom-in'))) === 1 && (await count(SEL('catalog-map-fit'))) === 1)
  await scrollTo(SEL('catalog-map-box'))
  const topPin = (await count('.kbcg-pin:not(.ghost)')) - 1 // the last one is drawn on top: the others may lie under it on the drawing
  await hover('.kbcg-pin:not(.ghost)', topPin)
  check('…the pointer on a pin still lights a card', (await count('.kbcg-card.hot')) === 1)
  await onMap('.kbcg-pin:not(.ghost)', topPin)
  check('…and a click on a pin still opens the item, as a panel above the cards', (await count(SEL('catalog-panel'))) === 1)
  check('the panel\'s close button is on top of its picture (it was hidden under the photograph) and a real click closes the panel', (await click(SEL('catalog-close'))) === true && (await count(SEL('catalog-panel'))) === 0)
  check('the drawn map does not carry the OpenStreetMap credit (it is not their map)', (await count(SEL('catalog-map-attribution'))) === 0)
  // a minute of calm: going away and coming back asks nothing and shows the drawing at once
  const before = requests.length
  await reopenMap()
  await sleep(600)
  check('going away and back within the minute shows the drawing at once and asks OpenFreeMap for nothing', (await mapState()) === 'drawn' && requests.slice(before).filter((r) => hostOf(r.url) === MAPHOST).length === 0)
  // the button asks again: still blocked, so the drawing again
  check('the « Try again » button is pressed, and asks again at once (still blocked: the drawing comes back, saying so)', (await onMap(SEL('catalog-map-retry'))) === true && (await drawnOk()) === true)
  // unblocked: the button brings the real map
  await page.send('Network.setBlockedURLs', { urls: [] })
  check('unblocked, the button brings the real map back', (await onMap(SEL('catalog-map-retry'))) === true && (await realAgain()) === true, await whyNot())
  check('…with every property on it', (await pinsOf()).total === 16)
  // 2. the style comes but no tile does (the worker's requests are the ones blocked)
  workers.block(['https://tiles.openfreemap.org/planet/*'])
  await reopenMap()
  const t1 = Date.now()
  await waitFor(page, `document.querySelector('[data-kb="catalog-map-box"]').getAttribute('data-map') !== 'loading'`, 14000)
  check('the style comes but no tile does: the drawing takes over within the budget (8 s), saying the real map is unavailable', (await mapState()) === 'drawn' && (await drawnOk(/unavailable/)) && Date.now() - t1 < 12000, { state: await mapState(), ms: Date.now() - t1 })
  await shotOf('14-tiles-blocked', SEL('catalog-map-box'))
  workers.block([])
  check('the tiles back, the button brings the real map', (await onMap(SEL('catalog-map-retry'))) === true && (await realAgain()) === true, await whyNot())
  // 3. offline
  await reopenMap()
  await pressView(/cards|cartes/i)
  await sleep(500)
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await sleep(500)
  const off0 = requests.length
  await openMap()
  await sleep(700)
  check('offline: the drawing at once, saying « Offline », nothing asked of OpenFreeMap', (await mapState()) === 'drawn' && /Offline/.test(await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText`)) && requests.slice(off0).filter((r) => hostOf(r.url) === MAPHOST).length === 0)
  await shotOf('15-offline', SEL('catalog-map-box'))
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  check('back online the real map is tried again by itself', (await realAgain()) === true, await whyNot())
  await page.send('Network.setCacheDisabled', { cacheDisabled: false })
  // 4. no WebGL
  const noGl = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...r) { return /webgl/i.test(String(kind)) ? null : g.call(this, kind, ...r) } })()` })).result
  await page.send('Page.reload', {})
  workers.arm()
  await front()
  await sleep(3000)
  await openCatalog()
  const gl0 = requests.length
  await openMap()
  await sleep(800)
  check('no WebGL: the drawing at once with « WebGL unavailable », no button (it would not help), nothing asked of OpenFreeMap', (await mapState()) === 'drawn' && /WebGL/.test(await ev(`document.querySelector('[data-kb="catalog-map-note"]').innerText`)) && (await count(SEL('catalog-map-retry'))) === 0 && requests.slice(gl0).filter((r) => hostOf(r.url) === MAPHOST).length === 0)
  await shotOf('16-no-webgl', SEL('catalog-map-box'))
  if (noGl && noGl.identifier) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noGl.identifier })
  await page.send('Page.reload', {})
  workers.arm()
  await front()
  await sleep(3000)
  await openCatalog()
  await openMap()
  check('and with WebGL back, the real map', (await realAgain()) === true, await whyNot())

  const expected = /ERR_BLOCKED|ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource|net::ERR|AbortError|NetworkError|\/styles\/positron|tiles\.openfreemap|unavailable|could not|Failed to initialize WebGL|WebGL/i
  const noise = errors.filter((e) => !expected.test(e))
  const consoleNoise = page.errs.filter((e) => !expected.test(e))
  check('no script error from the page the whole way (blocked, offline and no-WebGL requests are expected, and nothing else)', noise.length === 0, noise)
  check('and nothing on the console either (no warning from the library about a style or an image it cannot find)', consoleNoise.length === 0, consoleNoise)
} finally {
  try { base.deleteAll({ confirm: true, actor: 'person' }) } catch (e) { /* nothing to clean */ }
  try { await page.send('Network.setBlockedURLs', { urls: [] }); await page.send('Emulation.clearDeviceMetricsOverride', {}) } catch (e) { /* the browser is closing */ }
  try { await setScheme(startScheme) } catch (e) { /* closing */ }
  const back = (await darkNow()) === true ? 'dark' : 'light'
  if (back !== startScheme) console.log('\n  !!! NOT RESTORED — the sandbox\'s mode was ' + startScheme + ' and is ' + back + '. Put it back in Settings › Theme of the SANDBOX.')
  workers.stop()
  await live.close()
}
console.log('\n' + pass + ' passed, ' + failures.length + ' failed' + (shotsDir !== null ? ' (shots in ' + shotsDir + ')' : ''))
for (const f of failures) console.log('  ✗ ' + f)
process.exit(failures.length === 0 ? 0 : 1)
