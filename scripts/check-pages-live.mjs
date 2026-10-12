#!/usr/bin/env node
// Checks the display fixes of the Creations, Kybers and Skills pages, and the skeleton screens, against a REAL DSH GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-pages-live.mjs [--shots <dir>]
//
// What it plays (isolated instance: the Skills steps write the index-source setting and the Featured list of that
// instance's DSH home, and put both back):
//   creations : « Customize » is a small control at the end of the hint line, not a tile; the type tiles stay on one row;
//               a row opens with a click (no « View » or « expand » button), its quick actions show on hover and on keyboard
//               focus, always on a device with no hover, and the name keeps its width at 400 px; a Data creation says what it
//               holds (no « { » or « [ »), opens as a table or a tree with its source one button away;
//   kybers    : the sidebar entry and the page say « Kybers »; the tab row does not move when you switch tabs (1400 and 640 px);
//   skills    : the relay answers 502 → a clear message, an automatic second attempt, « Try again » and « Change » (the other
//               tabs are untouched); the source is shown, a bad address is refused with the variable's rule, a good one is used;
//               the Featured list and the ranking are the same rows (same columns, same height);
//   skeleton  : with the host's answer held back, each list draws bones in the box of its real rows (the first row sits where
//               the real one will), announces « loading » once, and shimmers — and not under prefers-reduced-motion.
//
// It REFUSES to run against 127.0.0.1:3080 (the real DSH) unless --allow-real. Named check-*, not test-*: CI runs every
// test-*.mjs with no DSH. Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / a page did not open).
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const ALLOW_REAL = args.includes('--allow-real')
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (HOST === '127.0.0.1:3080' && !ALLOW_REAL) {
  console.error('✗ this check changes settings of the DSH it talks to (the Skills source, the Featured list), and that is the real one (127.0.0.1:3080).')
  console.error('  Start an isolated instance (scripts/sandbox/start.sh, then `source scripts/sandbox/env.sh`), or pass --allow-real if you mean it.')
  process.exit(2)
}
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
const q = (s) => JSON.stringify(s)
const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 900, deviceScaleFactor: 1, mobile: false }); await sleep(600) }
const center = (sel, idx = 0) => ev(`(() => { const e = document.querySelectorAll(${q(sel)})[${idx}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
const click = async (sel, idx = 0) => {
  const c = await center(sel, idx)
  if (c === null || c.__err) return false
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: c.x, y: c.y, button: 'left', clickCount: 1 })
  await sleep(700)
  return true
}
const hoverAt = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(350) }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const typeInto = async (sel, text) => {
  await ev(`(() => { const e = document.querySelector(${q(sel)}); e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)
}
const top = (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); return e ? Math.round(e.getBoundingClientRect().top) : null })()`)
const rect = (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) } })()`)

// ── a hand on the host's answers: hold a route, release it, or make it fail ──────────────────────────────────────────
const held = []
let intercept = null // { pattern, mode: 'hold' | 'pass' }
page.on('Fetch.requestPaused', async (p) => {
  if (intercept !== null && intercept.mode === 'hold') { held.push(p.requestId); return }
  try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e) { /* gone */ }
})
const holdRoute = async (pattern) => { held.length = 0; intercept = { pattern, mode: 'hold' }; await page.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Request' }] }) }
const releaseRoute = async () => { if (intercept !== null) intercept.mode = 'pass'; for (const id of held.splice(0)) { try { await page.send('Fetch.continueRequest', { requestId: id }) } catch (e) { /* gone */ } } }
const stopHolding = async () => { intercept = null; held.length = 0; await page.send('Fetch.disable', {}) }
const reload = async (ms = 5500) => { await page.send('Page.reload', {}); await sleep(ms) }
const goCreations = async () => { await clickText(page, 'Creations'); await waitFor(page, `!!document.querySelector('.kb6-title')`, 10000); await sleep(1200) }
const listView = async () => { await click('.kb6-tb-vbtn', 1); await sleep(900) }
const cardsView = async () => { await click('.kb6-tb-vbtn', 0); await sleep(900) }

// the stand-in relay of the Skills checks: answers 502 until `up`, then a ranking
let relayUp = false
const relayHits = []
const relay = createServer((req, res) => {
  relayHits.push(req.url)
  const hit = (n, i) => ({ id: 'o/r/' + n, slug: n, name: n, source: 'o/r', installs: 100 - i, sourceType: 'github', installUrl: 'https://github.com/o/r', url: 'https://skills.sh/o/r/' + n })
  if (relayUp !== true) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'index unavailable' })); return }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: ['alpha', 'beta', 'gamma', 'delta'].map(hit), pagination: { page: 0, perPage: 50, total: 4, hasMore: false } }))
})
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
const RELAY_URL = 'http://127.0.0.1:' + relay.address().port + '/v1'

const cleanup = async () => {
  try { await stopHolding() } catch (e) { /* closed */ }
  try {
    // put the Skills source back to the default, and un-feature what this run featured
    await ev(`fetch('/kybernos-skills/index-source/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: '' }) }).then((r) => r.json())`)
    for (const n of featuredByUs) await ev(`fetch('/kybernos-skills/featured/toggle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: ${q(n)}, action: 'remove' }) }).then((r) => r.json())`)
  } catch (e) { /* the page is gone */ }
  relay.close()
}
const featuredByUs = []

try {
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)
  if ((await waitFor(page, `document.body.innerText.length > 200`, 15000)) === null) { console.error('○ inconclusive: the GUI did not render'); process.exit(3) }

  // ═══ Creations ═══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('creations')
  await goCreations()
  if ((await waitFor(page, `!!document.querySelector('[data-kb=type-tiles]')`, 15000)) === null) { console.error('○ inconclusive: the Creations page did not open'); process.exit(3) }
  const cust = await ev(`(() => { const b = document.querySelector('[data-kb=type-customize]'); if (!b) return null; const r = b.getBoundingClientRect(); const tiles = Array.from(document.querySelectorAll('[data-kb=type-tiles] > button')); return { h: Math.round(r.height), inTiles: !!b.closest('[data-kb=type-tiles]'), text: b.innerText.trim(), rows: new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size, tiles: tiles.length, tileTop: Math.round(tiles[0].getBoundingClientRect().top), btnBottom: Math.round(r.bottom) } })()`)
  check('« Customize » is a small control, not one of the type tiles', cust !== null && cust.inTiles === false && cust.h <= 34, cust)
  check('it sits above the tiles, on the hint line', cust !== null && cust.btnBottom <= cust.tileTop, cust)
  check('the type tiles share one row at 1400 px (« Customize » no longer wraps to a second one)', cust !== null && cust.rows === 1 && cust.tiles >= 3, cust)
  check('no dashed « add » tile is left', (await ev(`document.querySelectorAll('.kb-type-add').length`)) === 0)
  await click('[data-kb=type-customize]')
  const panel = await ev(`(() => { const p = document.querySelector('[data-kb=type-panel]'); const b = document.querySelector('[data-kb=type-customize]'); if (!p) return null; const pr = p.getBoundingClientRect(); const br = b.getBoundingClientRect(); return { below: pr.top >= br.bottom - 1, endAligned: Math.abs(pr.right - br.right) < 6, expanded: b.getAttribute('aria-expanded') } })()`)
  check('its panel hangs under the button, end-aligned, and the button says it is expanded', panel !== null && panel.below === true && panel.endAligned === true && panel.expanded === 'true', panel)
  await shot('creations-customize')
  await key('Escape', 'Escape', 27)
  await sleep(400)
  check('Escape closes the panel', (await ev(`!document.querySelector('[data-kb=type-panel]')`)) === true)

  await listView()
  await hoverAt(5, 5)
  const row = await ev(`(() => { const r = document.querySelector('[data-kb=art-row]'); if (!r) return null; const b = Array.from(r.querySelectorAll('button')); return { buttons: b.map((x) => x.getAttribute('data-kb') || 'menu'), labels: b.map((x) => x.innerText.trim()).filter((t) => t.length > 0), op: b.map((x) => parseFloat(getComputedStyle(x).opacity)), h: Math.round(r.getBoundingClientRect().height) } })()`)
  if (row === null) { console.error('○ inconclusive: no creation in this instance to show as a row'); process.exit(3) }
  check('a row has no « View » and no « expand » button: only locate, pin and the menu', JSON.stringify(row.buttons) === JSON.stringify(['art-locate', 'art-pin', 'menu']) && row.labels.length === 0, row)
  check('at rest those quick actions are hidden', row.op.every((o) => o === 0), row.op)
  const rc = await center('[data-kb=art-row]')
  await hoverAt(rc.x, rc.y)
  check('on hover they show', (await ev(`Array.from(document.querySelector('[data-kb=art-row]').querySelectorAll('button')).every((x) => parseFloat(getComputedStyle(x).opacity) === 1)`)) === true)
  await shot('creations-list-hover')
  await hoverAt(5, 5)
  await ev(`document.querySelector('[data-kb=art-row]').focus()`)
  await key('Tab', 'Tab', 9)
  await sleep(250)
  const focus = await ev(`(() => { const a = document.activeElement; const r = a && a.closest('[data-kb=art-row]'); return { onLocate: !!a && a.getAttribute('data-kb') === 'art-locate', visible: !!r && parseFloat(getComputedStyle(a).opacity) === 1 } })()`)
  check('they are reachable by keyboard, and visible once focused', focus.onLocate === true && focus.visible === true, focus)
  await ev(`document.querySelector('[data-kb=art-row]').focus()`)
  await key('Enter', 'Enter', 13)
  await sleep(1200)
  check('Enter on the row opens the creation (the one way to open)', (await ev(`document.querySelectorAll('[role=dialog], [class*="kb6-pop"]').length > 0 || /Preview|Aperçu|View source|Voir la source/.test(document.body.innerText)`)) === true)
  await key('Escape', 'Escape', 27)
  await sleep(500)
  await size(400, 800)
  const narrow = await ev(`(() => { const r = document.querySelector('[data-kb=art-row]'); const n = r.querySelector('.kb6-lrowname'); return { name: Math.round(n.getBoundingClientRect().width), full: n.scrollWidth, over: document.documentElement.scrollWidth > innerWidth } })()`)
  check('at 400 px the name keeps its width (the buttons used to squeeze it to nothing) and the page does not scroll sideways', narrow.name > 40 && narrow.over === false, narrow)
  await shot('creations-list-400')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await sleep(700)
  const touch = await ev(`(() => { const r = document.querySelector('[data-kb=art-row]'); return Array.from(r.querySelectorAll('button')).filter((b) => getComputedStyle(b).display !== 'none').map((b) => parseFloat(getComputedStyle(b).opacity)) })()`)
  check('with no hover (touch) the actions that are shown are visible', Array.isArray(touch) && touch.length >= 1 && touch.every((o) => o === 1), touch)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await size(1400, 900)

  // Data: say what is in it
  const dataRow = await ev(`(() => { const r = Array.from(document.querySelectorAll('[data-kb=art-row]')).find((x) => /\\bData\\b/.test(x.querySelector('.kb6-type') ? x.querySelector('.kb6-type').innerText : '')); return r ? { text: r.innerText } : null })()`)
  if (dataRow === null) console.log('  ○ no Data creation in this instance: the Data checks are skipped')
  else {
    const snips = await ev(`Array.from(document.querySelectorAll('[data-kb=art-row]')).filter((x) => /\\bData\\b/.test(x.querySelector('.kb6-type') ? x.querySelector('.kb6-type').innerText : '')).map((x) => x.querySelector('.kb6-snip') ? x.querySelector('.kb6-snip').innerText : null).filter((t) => t !== null)`)
    check('a Data row says what it holds, never a bare « { » or « [ »', Array.isArray(snips) && snips.length > 0 && snips.every((t) => /^[{[\]}]/.test(t) === false && t.length > 1), snips)
    await cardsView()
    const dcard = await ev(`(() => { const c = Array.from(document.querySelectorAll('.kb6-card')).find((x) => /\\bData\\b/.test(x.innerText)); if (!c) return null; return { sheet: !!c.querySelector('.kb6-sheet'), code: c.querySelectorAll('.kbc-attr, .kbc-str, .kbc-kw, .kbc-num, .kbc-tag, .kb6-codeln').length } })()`)
    check('a Data card is a small table or a few fields, not coloured code', dcard === null || (dcard.sheet === true && dcard.code === 0), dcard)
    await shot('creations-data-card')
    await listView()
    const rp = await ev(`(() => { const r = Array.from(document.querySelectorAll('[data-kb=art-row]')).find((x) => /\\bData\\b/.test(x.querySelector('.kb6-type') ? x.querySelector('.kb6-type').innerText : '')); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + 150, y: b.y + b.height / 2 } })()`)
    if (rp !== null) {
      for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: rp.x, y: rp.y, button: 'left', clickCount: 1 })
      await sleep(1500)
      const view = await ev(`(() => { const v = document.querySelector('[data-kb=data-view]'); return v ? { table: !!v.querySelector('table'), tree: !!v.querySelector('[data-kb=data-tree]') , toggle: !!v.querySelector('[data-kb=data-source-toggle]'), pre: !!document.querySelector('[data-kb=data-source]') } : null })()`)
      check('an opened Data creation shows its rows or fields, with « View source » one click away (and no raw text by default)', view !== null && (view.table === true || view.tree === true) && view.toggle === true && view.pre === false, view)
      await shot('creations-data-open')
      await click('[data-kb=data-source-toggle]')
      check('« View source » shows the file text', (await ev(`!!document.querySelector('[data-kb=data-source]')`)) === true)
      await key('Escape', 'Escape', 27)
      await sleep(400)
    }
  }

  // ═══ Kybers ═════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('kybers')
  const navKybers = await clickText(page, 'Kybers')
  check('the sidebar entry that opens the Kybers page says « Kybers »', navKybers === true)
  await sleep(2500)
  for (const w of [1400, 640]) {
    await size(w, 900)
    await click('.kb6-utab', 0)
    const a = await ev(`({ title: document.querySelector('.kb6-title') && document.querySelector('.kb6-title').innerText, tabs: Math.round(document.querySelector('.kb6-utabs').getBoundingClientRect().top) })`)
    await click('.kb6-utab', 1)
    const b = await ev(`({ title: document.querySelector('.kb6-title') && document.querySelector('.kb6-title').innerText, tabs: Math.round(document.querySelector('.kb6-utabs').getBoundingClientRect().top) })`)
    check('switching Kybers → Marketplace at ' + w + ' px moves nothing (title « Kybers » on both, tab row at ' + a.tabs + ' px)', a.tabs === b.tabs && a.title === 'Kybers' && b.title === 'Kybers', { a, b })
    await shot('kybers-marketplace-' + w)
  }
  await size(1400, 900)
  await click('.kb6-utab', 0)

  // ═══ Skills ═════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('skills')
  await clickText(page, 'Skills')
  await waitFor(page, `!!document.querySelector('.kbs-root')`, 15000)
  await sleep(2000)
  // a skill of the user's own to feature: the first card's star
  const hadStar = await ev(`document.querySelectorAll('.kb8-card.static .kbs-star-btn.on').length`)
  if (hadStar === 0 && (await ev(`document.querySelectorAll('.kb8-card.static').length`)) > 0) {
    const nm = await ev(`document.querySelector('.kb8-card.static .kb8-name').innerText`)
    await click('.kb8-card.static .kbs-star-btn', 0)
    featuredByUs.push(nm)
  }
  // the relay answers 502
  relayUp = false
  const set = await ev(`fetch('/kybernos-skills/index-source/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: ${q(RELAY_URL)} }) }).then((r) => r.json())`)
  if (set === null || set.ok !== true) {
    console.error('○ inconclusive: this DSH has no /kybernos-skills/index-source route (restart it so the host half is current): ' + JSON.stringify(set).slice(0, 200))
    await cleanup(); process.exit(3)
  }
  await reload(5000)
  await clickText(page, 'Skills')
  await sleep(1800)
  await clickText(page, 'Discover')
  const err = await waitFor(page, `!!document.querySelector('[data-kb=disc-error]')`, 15000)
  check('a relay that answers 502 gives a clear message with « Try again » and « Change » (not a bare error line)', err !== null && (await ev(`!!document.querySelector('[data-kb=disc-retry]') && !!document.querySelector('[data-kb=disc-change-source]')`)) === true)
  const errText = await ev(`document.querySelector('[data-kb=disc-error]') ? document.querySelector('[data-kb=disc-error]').innerText : ''`)
  check('the message says what happened once (no « Index unavailable (HTTP 502). — index unavailable »)', /HTTP 502/.test(errText) && !/unavailable \(HTTP 502\)\. — index unavailable/i.test(errText) && (errText.match(/index unavailable/gi) || []).length <= 1, errText)
  check('the page asked the relay twice by itself (a 502 is often over a moment later)', relayHits.filter((u) => /\/skills\?view=/.test(u)).length >= 2, relayHits.length)
  await shot('skills-discover-error')
  await clickText(page, 'Yours')
  await sleep(900)
  check('the other tabs are untouched while the index is down (Yours still lists the skills)', (await ev(`document.querySelector('.kbs-root') !== null && !document.querySelector('[data-kb=disc-error]')`)) === true)
  await clickText(page, 'Discover')
  await sleep(800)
  relayUp = true
  await click('[data-kb=disc-retry]')
  const back = await waitFor(page, `document.querySelectorAll('.kbs-row').length >= 4 && !document.querySelector('[data-kb=disc-error]')`, 15000)
  check('« Try again » reads the index once more and the ranking is back', back !== null)
  const src = await ev(`document.querySelector('[data-kb=index-source]') ? document.querySelector('[data-kb=index-source]').innerText.replace(/\\s+/g, ' ') : null`)
  check('the page says which source is in use (the address, and that it is a custom one)', typeof src === 'string' && src.indexOf('127.0.0.1:' + relay.address().port) >= 0 && /custom|personnalis/i.test(src), src)

  // the window: same rule as the variable
  await click('[data-kb=index-source-change]')
  await typeInto('[data-kb=index-source-input]', 'http://example.com/v1')
  await click('[data-kb=index-source-save]')
  await sleep(600)
  const refused = await ev(`document.querySelector('[data-kb=index-source-modal] .kbs-err') ? document.querySelector('[data-kb=index-source-modal] .kbs-err').innerText : null`)
  check('an address that is not https (or loopback) is refused in words, and nothing is saved', typeof refused === 'string' && /https/i.test(refused), refused)
  await typeInto('[data-kb=index-source-input]', 'https://user:pw@example.com/v1')
  await click('[data-kb=index-source-save]')
  await sleep(600)
  check('so is an address that carries a password', (await ev(`!!document.querySelector('[data-kb=index-source-modal] .kbs-err')`)) === true)
  await click('[data-kb=index-source-reset]')
  await sleep(1500)
  const dflt = await ev(`document.querySelector('[data-kb=index-source]') ? document.querySelector('[data-kb=index-source]').innerText.replace(/\\s+/g, ' ') : null`)
  check('« Use the Kybernos relay » puts the default back', typeof dflt === 'string' && /skills\.kybernos\.app/.test(dflt) && /default|défaut/i.test(dflt), dflt)

  // Featured and the ranking: the same rows
  if ((await waitFor(page, `document.querySelectorAll('.kbs-row:not(.feat)').length > 3`, 25000)) === null) console.log('  ○ the default relay did not answer in time: the Featured comparison is skipped')
  else {
    const f = await ev(`(() => { const fr = document.querySelector('[data-kb=feat-row]'); const rr = Array.from(document.querySelectorAll('.kbs-row')).find((x) => !x.classList.contains('feat')); if (!fr || !rr) return null; return { featCols: getComputedStyle(fr).gridTemplateColumns, rankCols: getComputedStyle(rr).gridTemplateColumns, featH: Math.round(fr.getBoundingClientRect().height), rankH: Math.round(rr.getBoundingClientRect().height), cards: document.querySelectorAll('.kbs-feat-card').length } })()`)
    if (f === null) console.log('  ○ nothing is featured in this instance: the Featured comparison is skipped')
    else check('the Featured list is rows with the ranking’s own columns and height (no cards)', f.featCols === f.rankCols && Math.abs(f.featH - f.rankH) <= 3 && f.cards === 0, f)
    await shot('skills-discover')
    await size(640, 900)
    const wide = await ev(`(() => { return { clipped: Array.from(document.querySelectorAll('.kbs-table')).some((t) => t.scrollWidth > t.clientWidth + 1), over: document.documentElement.scrollWidth > innerWidth } })()`)
    check('at 640 px the ranking and the Featured list fit their column (nothing is cut off at the right)', wide.clipped === false && wide.over === false, wide)
    await shot('skills-discover-640')
    await size(1400, 900)
  }

  // ═══ Skeletons ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('skeletons')
  const lists = [
    { name: 'Creations (cards)', pattern: '*kybernos/load*', go: async () => { await clickText(page, 'Creations'); await sleep(500); await cardsView() }, first: '.kb6-grid > :first-child' },
    { name: 'Creations (list)', pattern: '*kybernos/load*', go: async () => { await clickText(page, 'Creations'); await sleep(500); await listView() }, first: '.kb6-lrows > :first-child' },
    { name: 'Kybers', pattern: '*kybernos/load*', go: async () => { await clickText(page, 'Kybers') }, first: '.kb8-grid > :first-child, .kb8-rows > :first-child' },
    { name: 'Skills › Yours', pattern: '*kybernos-skills/skills*', go: async () => { await clickText(page, 'Skills') }, first: '.kb8-card.static' },
    { name: 'Skills › Discover', pattern: '*kybernos-skills/index?view*', go: async () => { await clickText(page, 'Skills'); await sleep(2500); await clickText(page, 'Discover') }, first: '.kbs-table:not([data-kb=feat-table]) .kbs-row' },
  ]
  for (const L of lists) {
    await holdRoute(L.pattern)
    await reload(5500)
    await L.go()
    await sleep(1300)
    const sk = await ev(`(() => { const w = document.querySelector('[data-kb=skeleton]'); if (!w) return null; const b = w.querySelector('.kb-sk-bone'); return { label: w.getAttribute('aria-label'), live: w.getAttribute('role'), bones: w.querySelectorAll('.kb-sk-bone').length, anim: b ? getComputedStyle(b).animationName : null } })()`)
    const during = await top(L.first)
    await shot('skeleton-' + L.name.replace(/[^a-z]+/gi, '-').toLowerCase())
    await releaseRoute()
    await waitFor(page, `!document.querySelector('[data-kb=skeleton]')`, 25000)
    await sleep(500)
    const after = await top(L.first)
    const gone = (await ev(`!document.querySelector('[data-kb=skeleton]')`)) === true
    if (sk === null) { check(L.name + ': bones are drawn while the host has not answered', false, sk); await stopHolding(); continue }
    check(L.name + ': bones while the answer is held (announced once, shimmering), replaced by the rows when it arrives',
      sk.bones >= 6 && sk.live === 'status' && typeof sk.label === 'string' && sk.anim === 'kb-sk-shimmer' && gone === true, sk)
    if (after === null) console.log('  ○ ' + L.name + ': this instance has nothing to list, so there is no real row to compare the bones with')
    else check(L.name + ': the first row sits where the real one lands (shift ' + (during === null ? '?' : after - during) + ' px)', during !== null && Math.abs(after - during) <= 6, { during, after })
    await stopHolding()
  }
  // reduced motion: no shimmer, no movement
  await holdRoute('*kybernos/load*')
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await reload(5500)
  await clickText(page, 'Creations')
  await sleep(1200)
  await cardsView()
  const still = await ev(`(() => { const b = document.querySelector('.kb-sk-bone'); return b ? getComputedStyle(b).animationName : 'no bone' })()`)
  check('under prefers-reduced-motion the bones do not shimmer', still === 'none', still)
  await releaseRoute()
  await sleep(2500)
  const rows = await ev(`Array.from(document.querySelectorAll('.kb6-grid > *')).slice(0, 4).map((e) => getComputedStyle(e).animationName)`)
  check('…and the rows just appear (no movement)', Array.isArray(rows) && rows.length >= 2 && rows.every((n) => n === 'none'), rows)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await stopHolding()
  await reload(5000)
  await clickText(page, 'Creations')
  await sleep(1500)
  await listView()
  // « Show N more » reveals twelve at a time: ask for a second batch so that there are more than twelve rows to look at
  await click('[data-kb=art-more]')
  await sleep(150)
  const motion = await ev(`Array.from(document.querySelectorAll('[data-kb=art-row]')).map((e) => getComputedStyle(e).animationName)`)
  check('with motion allowed the first rows fade in, and the rows past the twelfth do not (a long list does not animate for seconds)',
    Array.isArray(motion) && motion.length > 12 && motion.slice(0, 6).every((n) => n === 'kb-in') && motion.slice(12).every((n) => n === 'none'), motion)
} finally {
  await cleanup()
  await live.close()
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
