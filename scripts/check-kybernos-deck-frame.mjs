#!/usr/bin/env node
// The deck editor frame, driven for real: a sandboxed iframe (the CSP of the office routes, no allow-same-origin) in headless Chrome, a page around it that speaks the
// office envelope, real key and mouse events. It checks that a deck file opens, draws, edits, adds / duplicates / moves / deletes slides, exports the file with only its
// slides replaced (and byte for byte when nothing changed), refuses a file that is not a deck, runs nothing a hostile file brings, and honours ?ro=1 and ?lang=fr;
// then that the STANDALONE runtime of the same build presents a deck opened on its own.
//
//   node scripts/check-kybernos-deck-frame.mjs [--home <DSH home with the editors built>] [--shots <dir>]
//
// It serves the built frame from a small local server (no DSH, no :3080): the page, `/v/<token>/deck/*`, `/v/<token>/__file` with the CSP read from routes.mjs.
// Named check-* on purpose: it needs Chrome and the built editors (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"), so CI must not run it.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp-lib.mjs'
import { editorHtml } from '../packages/kybernos-office/office-host.mjs'

const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1] }
const home = arg('--home') || process.env.DSH_HOME || null
const shots = arg('--shots') || join(tmpdir(), 'kb-deck-frame')
mkdirSync(shots, { recursive: true })
const built = home === null ? null : join(home, 'kybernos', 'kybernos-office', 'editors', 'deck')
if (built === null || !existsSync(join(built, 'app.js')) || !existsSync(join(built, 'standalone.js'))) {
  console.log('Build the editors first: node packages/kybernos-office/build-editors.mjs --home <DSH home>   (then pass --home or set DSH_HOME)')
  process.exit(3)
}
const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chromePath)) { console.log('Chrome not found: ' + chromePath + ' (set KB_CHROME)'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (!ok && detail !== undefined ? ' | ' + String(detail).slice(0, 400) : '')) }
const sha = (t) => createHash('sha256').update(t).digest('hex')

// ── the decks: the shape the generator writes (head with the base style and a theme block, <main id="deck"> with the slides, one inline runtime at the end) ──
const standaloneCss = readFileSync(join(built, 'standalone.css'), 'utf8')
const standaloneJs = readFileSync(join(built, 'standalone.js'), 'utf8')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const chart = (x, y, w, h, spec, frag) => `<div class="chart${frag ? ' frag' : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" data-w="${w}" data-h="${h}" data-chart="${esc(JSON.stringify(spec))}" role="img" aria-label="${spec.alt}"${frag ? ' data-step="1" data-delay="0"' : ''}></div>`
const cell = (body, { dark = false, trans = 'fade', note = '' } = {}) => `<div class="cell"><section class="slide${dark ? ' dark' : ''}" data-transition="${trans}">${body}<aside class="notes" data-e>${note}</aside></section></div>`
const SLIDES = [
  cell('<h1 style="left:88px;top:150px;width:983px;height:140px;font-size:64px" data-e>Quarterly review</h1><div class="b" style="left:88px;top:320px;width:900px;height:60px;font-size:28px;color:#CADCFC" data-e>Results, product &amp; roadmap</div>', { dark: true, note: 'Open on the headline number.' }),
  cell('<h1 data-e>Three topics</h1><div class="b" style="left:88px;top:200px;width:1000px;height:400px;font-size:32px;color:#333333" data-e><ul class="bul"><li>Results of the quarter</li><li>Product milestones</li><li>Team and risks</li></ul></div>', { trans: 'push' }),
  cell('<h1 data-e>Revenue reaches 4.8 M€</h1>' + [['4.8 M€', 'Revenue', 88], ['+18 %', 'Year on year', 448], ['118 %', 'Net retention', 808]].map(([big, small, x], i) => `<div class="b ctr frag" style="left:${x}px;top:240px;width:340px;height:260px;font-size:24px;color:#333333;background:#F2F5FB" data-step="1" data-delay="${i * 300}" data-e><div class="ln" style="font-size:64px;color:#1E2761;font-weight:700;font-family:Georgia,serif">${big}</div><div class="ln" style="font-size:24px;color:#7A8A94">${small}</div></div>`).join(''), { trans: 'wipe' }),
  cell('<h1 data-e>Revenue grows every quarter</h1>' + chart(88, 180, 1100, 480, { type: 'column', categories: ['Q4', 'Q1', 'Q2', 'Q3'], labels: true, legend: 'bottom', series: [{ name: 'Revenue (M€)', values: [3.9, 4.1, 4.4, 4.8], color: '#1E2761' }, { name: 'Target (M€)', values: [4.0, 4.2, 4.5, 4.6], color: '#D4A843' }], alt: 'Revenue and target over four quarters' }, true)),
  cell('<h1 data-e>Four plans, one base</h1><table class="t" style="left:88px;top:200px;width:1100px;height:300px" data-e-table><tr><th data-e>Plan</th><th data-e>Price</th><th data-e>Seats</th></tr><tr><td data-e>Free</td><td data-e>0 €</td><td data-e>1</td></tr><tr><td data-e>Plus</td><td data-e>19 €</td><td data-e>3</td></tr><tr><td data-e>Team</td><td data-e>49 €</td><td data-e>10</td></tr></table>'),
  cell('<h1 data-e>Plus is the engine</h1>' + chart(88, 180, 760, 480, { type: 'doughnut', categories: ['Plus', 'Team', 'Business', 'Other'], labels: true, legend: 'right', series: [{ name: 'Share (%)', values: [46, 31, 18, 5] }], alt: 'Share of revenue by plan' }), { dark: true }),
]
const deckFile = (slides, { title = 'Quarterly review', extraHead = '', extraBody = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="kybernos-deck" content="1"><title>${title}</title>
<style data-kd="base">${standaloneCss}</style>
<style data-kd="theme">:root{--navy:#1E2761;--gold:#D4A843;--light:#F2F5FB;--grey:#7A8A94}</style>${extraHead}</head>
<body><main id="deck">
${slides.join('\n')}
</main>${extraBody}<script data-kd="runtime">${standaloneJs}</script></body></html>
`
const DECK = deckFile(SLIDES)
const HOSTILE = deckFile([cell('<h1 data-e onclick="window.__pwned=\'click\'">Hostile</h1><img src="x" onerror="window.__pwned=\'onerror\'"><script>window.__pwned=\'script\'</script><a href="javascript:window.__pwned=\'href\'" data-e>link</a><iframe src="https://example.com/"></iframe><div class="b" style="left:88px;top:300px;width:600px;height:80px;font-size:30px;background:url(https://example.com/x.png)" data-e>Still here</div>')])
const NOT_A_DECK = '<!doctype html><html><head><meta charset="utf-8"><title>Not ours</title></head><body><main id="deck"><div class="cell"></div></main></body></html>'
const FILES = { deck: DECK, hostile: HOSTILE, notadeck: NOT_A_DECK }

// ── the local server: the page around the frame, the built frame behind a token, the file ──
const CSP = /const CSP = "([^"]+)"/.exec(readFileSync(fileURLToPath(new URL('../packages/kybernos-office/routes.mjs', import.meta.url)), 'utf8'))[1]
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8' }
const files = new Map() // token -> text (the file as the page opens it; a saved export replaces it)
const topPage = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222"><iframe id="f" sandbox="allow-scripts" style="border:0;width:1280px;height:820px;display:block"></iframe><script>
const p = new URLSearchParams(location.search)
document.getElementById('f').src = '/v/' + p.get('t') + '/deck/index.html?' + (p.get('q') || 'lang=en')
window.__msgs = []
window.addEventListener('message', (e) => {
  if (!e.data || e.data.ky !== 'office') return
  const m = Object.assign({}, e.data)
  if (m.bytes) { m.text = new TextDecoder().decode(m.bytes); delete m.bytes }
  window.__msgs.push(m)
})
window.__send = (msg) => document.getElementById('f').contentWindow.postMessage(Object.assign({ ky: 'office' }, msg), '*')
</script>`
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const fail = (c) => { res.writeHead(c); res.end() }
  if (url.pathname === '/top') { res.writeHead(200, { 'Content-Type': TYPES.html }); return res.end(topPage) }
  let m = /^\/standalone\/(\w+)$/.exec(url.pathname)
  if (m) { res.writeHead(200, { 'Content-Type': TYPES.html }); return res.end(files.get(m[1]) || '') }
  m = /^\/v\/(\w+)\/(.*)$/.exec(url.pathname)
  if (!m || !files.has(m[1])) return fail(404)
  const headers = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Office-Hash' }
  if (m[2] === '__file') { const b = Buffer.from(files.get(m[1])); res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'X-Office-Hash': sha(b) }); return res.end(b) }
  if (m[2] === 'deck/index.html') { res.writeHead(200, { ...headers, 'Content-Type': TYPES.html }); return res.end(editorHtml('deck')) }
  const f = /^deck\/(app\.js|app\.css)$/.exec(m[2])
  if (!f) return fail(404)
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[f[1].split('.')[1]] }); res.end(readFileSync(join(built, f[1])))
})
const freePort = (from) => new Promise((resolve) => { const t = (p) => { const s = netServer(); s.once('error', () => t(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }; t(from) })
const port = await freePort(8700)
await new Promise((r) => server.listen(port, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + port

// ── Chrome ──
const cdpPort = await freePort(9470)
const profile = mkdtempSync(join(tmpdir(), 'kb-deck-chrome-'))
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + cdpPort, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })
const debug = 'http://127.0.0.1:' + cdpPort
let page = null
for (let i = 0; i < 60 && page === null; i += 1) {
  await sleep(400)
  try { const list = await (await fetch(debug + '/json/list')).json(); const t = list.find((x) => x.type === 'page'); if (t) page = await connect(t) } catch (e) { /* starting */ }
}
if (page === null) { console.log('Chrome did not start'); chrome.kill(); server.close(); process.exit(3) }
await page.send('Page.enable', {})
await page.send('Runtime.enable', {})
const topLogs = []
page.on('Runtime.exceptionThrown', (p) => topLogs.push('exception: ' + String((p.exceptionDetails && p.exceptionDetails.text) || '')))

const top = async (js, ms) => { const r = await page.evalJs(js, ms || 15000); return r.err ? { __err: r.err } : r.val }
let frame = null
let logs = []
const frameTarget = async () => {
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(debug + '/json/list')).json()
    const t = list.find((x) => x.type !== 'page' && /\/deck\/index\.html/.test(x.url))
    if (t) {
      if (frame !== null) frame.close()
      frame = await connect(t)
      logs = []
      await frame.send('Runtime.enable', {})
      await frame.send('Log.enable', {})
      frame.on('Log.entryAdded', (p) => { if (p.entry && p.entry.level !== 'verbose' && p.entry.level !== 'info') logs.push(p.entry.level + ': ' + String(p.entry.text).slice(0, 200) + ' ' + String(p.entry.url || '').slice(0, 80)) })
      frame.on('Runtime.exceptionThrown', (p) => logs.push('exception: ' + String((p.exceptionDetails && (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)) || '').slice(0, 300)))
      frame.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') logs.push('console.error: ' + (p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200)) })
      return frame
    }
    await sleep(250)
  }
  return null
}
const fq = async (js, ms) => { if (frame === null) return { __err: 'no frame' }; const r = await frame.evalJs(js, ms || 15000); return r.err ? { __err: r.err } : r.val }
const until = async (js, ms = 15000, inFrame = true) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = inFrame ? await fq(js) : await top(js); if (v && !v.__err) return v; await sleep(200) } return false }

let tokenSeq = 0
/** Opens `name` (a key of FILES, or a raw text) in a fresh frame; resolves when the frame is up. */
const open = async (text, q = 'lang=en') => {
  const tok = 't' + (++tokenSeq).toString(16).padStart(8, '0')
  files.set(tok, text)
  await page.send('Page.navigate', { url: origin + '/top?t=' + tok + '&q=' + encodeURIComponent(q) })
  await sleep(300)
  await frameTarget()
  return tok
}
const msgs = () => top('__msgs.map((m) => ({ op: m.op, id: m.id, value: m.value, hash: m.hash, readOnly: m.readOnly, message: m.message, text: m.text === undefined ? undefined : m.text }))')
let exportId = 0
const exportText = async () => {
  const id = ++exportId
  await top(`__send({ op: 'export', id: ${id} })`)
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    const all = await msgs()
    const m = Array.isArray(all) ? all.find((x) => x.op === 'exported' && x.id === id) : null
    if (m) return m.text !== undefined ? m.text : { error: m.message || 'no text' }
    await sleep(120)
  }
  return { error: 'timeout' }
}
const saved = () => top("__send({ op: 'saved' })")
const mouse = async (x, y, clickCount = 1) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount }) }
const centre = (sel) => fq(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
const click = async (sel) => { const c = await centre(sel); if (!c || c.__err) throw new Error('no ' + sel + ': ' + JSON.stringify(c)); await mouse(c.x, c.y); await sleep(250) }
const typeKeys = async (text) => { for (const ch of text) { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(20) } }
const keyOf = { End: 35, Home: 36, ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }
const press = async (k) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: keyOf[k] || 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: keyOf[k] || 0 }); await sleep(120) }
const cells = () => fq("document.querySelectorAll('#deck .cell').length")
const cellCount = (t) => (t.match(/<div class="cell"/g) || []).length
const mainOpen = '<main id="deck">'
const split = (t) => ({ head: t.slice(0, t.indexOf(mainOpen) + mainOpen.length), tail: t.slice(t.indexOf('</main>')) })

try {
  // ── 1. an unchanged deck: mounts, draws, goes back byte for byte ──
  await open(DECK)
  const up = await until("document.querySelectorAll('#deck .cell').length === " + SLIDES.length + " && !!document.querySelector('#bar')")
  check('the frame mounts the deck (6 slides, the bar, no error card)', up === true, JSON.stringify(logs))
  await sleep(600)
  const state = await fq(`({ editing: document.body.classList.contains('editing'), fmt: getComputedStyle(document.querySelector('#fmt')).display, charts: document.querySelectorAll('.chart svg').length, bar: !!document.querySelector('#b-grid'), pres: !!document.querySelector('#b-pres'), fs: !!document.querySelector('#b-fs'), print: !!document.querySelector('#b-print'), save: !!document.querySelector('#save'), edit: !!document.querySelector('#b-edit'), theme: getComputedStyle(document.documentElement).getPropertyValue('--navy').trim() })`)
  check('it opens in edit mode with the formatting bar', state.editing === true && state.fmt === 'flex', JSON.stringify(state))
  check('both charts are drawn from their JSON', state.charts === 2, JSON.stringify(state))
  check('the frame has no presenter-window, full-screen, print or download button (the sandbox forbids them; the page saves)', !state.pres && !state.fs && !state.print && !state.save && state.edit === true, JSON.stringify(state))
  check('the theme block of the file is applied', state.theme === '#1E2761', JSON.stringify(state))
  let all = await msgs()
  const loaded = all.find((m) => m.op === 'loaded')
  check('it says « loaded » with the hash of the file and not read-only, and nothing is dirty yet', !!loaded && loaded.hash === sha(DECK) && loaded.readOnly === false && !all.some((m) => m.op === 'dirty' && m.value === true), JSON.stringify(all.map((m) => m.op + ':' + m.value)))
  await page.shot(join(shots, 'deck-1-edit.png'))
  const first = await exportText()
  check('an unchanged deck is exported byte for byte', first === DECK, typeof first === 'string' ? 'differs at ' + [...first].findIndex((c, i) => c !== DECK[i]) : JSON.stringify(first))
  // page through every slide in edit mode (Tiptap opens and closes a text editor per box), then export again
  for (let i = 0; i < SLIDES.length; i += 1) { await click('#b-next'); await sleep(150) }
  const afterPaging = await exportText()
  if (typeof afterPaging === 'string' && afterPaging !== DECK) { writeFileSync(join(shots, 'paged.html'), afterPaging); writeFileSync(join(shots, 'original.html'), DECK) }
  check('paging through all slides in edit mode rewrites nothing (still byte for byte)', afterPaging === DECK, typeof afterPaging === 'string' ? 'differs at ' + [...afterPaging].findIndex((c, i) => c !== DECK[i]) + ': ' + afterPaging.slice([...afterPaging].findIndex((c, i) => c !== DECK[i]) - 40, [...afterPaging].findIndex((c, i) => c !== DECK[i]) + 60) : JSON.stringify(afterPaging))
  all = await msgs()
  check('and the page was never told « changed »', !all.some((m) => m.op === 'dirty' && m.value === true), JSON.stringify(all.map((m) => m.op + ':' + m.value)))

  // ── 2. typing with real key events ──
  await fq("document.querySelector('#b-grid') && 0")
  await click('#b-prev') // back towards slide 1: five presses from the last one
  for (let i = 0; i < SLIDES.length; i += 1) await fq("document.querySelector('#b-prev').click()")
  await sleep(300)
  const curTitle = await fq("document.querySelector('.cell.cur h1').textContent")
  check('slide 1 is on screen (its title is the cover)', curTitle === 'Quarterly review', curTitle)
  await click('.cell.cur h1')
  await press('End')
  await typeKeys(' 2026')
  await sleep(500)
  all = await msgs()
  check('typing tells the page « changed »', all.some((m) => m.op === 'dirty' && m.value === true), JSON.stringify(all.map((m) => m.op + ':' + m.value)))
  const edited = await exportText()
  check('the export has the typed text in the title and in no other place', typeof edited === 'string' && edited.includes('Quarterly review 2026</h1>') && split(edited).head.length > 0 && edited.slice(split(edited).head.length, edited.length - split(edited).tail.length).split('2026').length === 2, typeof edited === 'string' ? edited.slice(edited.indexOf('<h1'), edited.indexOf('<h1') + 200) : JSON.stringify(edited))
  const sp = split(DECK), se = typeof edited === 'string' ? split(edited) : { head: '', tail: '' }
  check('only the slides changed: the head (style, theme, meta) and the tail (inline runtime) are byte for byte the same', se.head === sp.head && se.tail === sp.tail, JSON.stringify([se.head.length, sp.head.length, se.tail.length, sp.tail.length]))
  check('the other slides came back as they were (same cell count, charts emptied, no editor residue)', typeof edited === 'string' && cellCount(edited) === SLIDES.length && !/ProseMirror|contenteditable|selbox|class="cell cur|data-n=/.test(edited.slice(se.head.length, edited.length - se.tail.length)), typeof edited === 'string' ? edited.slice(0, 0) : '')
  const again = await exportText()
  check('exporting twice gives the same bytes', again === edited)
  // what the page does after a successful save: the next export is relative to the saved file
  await saved()
  const afterSave = await exportText()
  all = await msgs()
  check('after « saved » the page is told clean again, and the next export is the saved file', afterSave === edited && all.filter((m) => m.op === 'dirty').slice(-1)[0].value === false, JSON.stringify(all.map((m) => m.op + ':' + m.value)))
  await page.shot(join(shots, 'deck-2-typed.png'))

  // ── 3. slides: add, duplicate, move, delete ──
  const n0 = await cells()
  await click('[data-pop="newslide"]')
  await click('[data-layout="text"]')
  check('« Slide ▸ Title and text » adds a slide after the current one', (await cells()) === n0 + 1, await cells())
  await click('#f-dupslide')
  check('« Duplicate » adds a copy', (await cells()) === n0 + 2)
  const titleBefore = await fq("document.querySelector('.cell.cur h1').textContent")
  await click('#f-mvnext')
  const idx = await fq("[...document.querySelectorAll('#deck .cell')].findIndex((c) => c.classList.contains('cur'))")
  check('« Move later » moves the slide down one place', idx === 3, idx)
  await click('#f-delslide')
  check('« Delete » removes the slide', (await cells()) === n0 + 1)
  const structural = await exportText()
  check('the exported file has the slides as they are now (+1) and the same head and tail', typeof structural === 'string' && cellCount(structural) === n0 + 1 && split(structural).head === sp.head && split(structural).tail === sp.tail, typeof structural === 'string' ? cellCount(structural) + ' cells' : JSON.stringify(structural))
  check('the title typed earlier is still there', typeof structural === 'string' && structural.includes('Quarterly review 2026</h1>') && titleBefore !== undefined)
  // a block: add a text box and delete it with Undo
  const blocks0 = await fq("document.querySelectorAll('.cell.cur .b').length")
  await click('#f-addtext')
  await sleep(300)
  check('« Text » adds a text box to the slide', (await fq("document.querySelectorAll('.cell.cur .b').length")) === blocks0 + 1)
  await page.shot(join(shots, 'deck-3-slides.png'))
  check('the frame logged no error or CSP violation across all of this', logs.filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(logs))

  // ── 4. grid view ──
  await fq("document.querySelector('#b-grid').click()")
  await sleep(500)
  const grid = await fq("[...document.querySelectorAll('#deck .cell')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })")
  check('the grid view shows every slide as a thumbnail, the first row on screen under the bars', Array.isArray(grid) && grid.length === n0 + 1 && grid.every((r) => r[2] === 320 && r[3] === 180) && grid[0][1] >= 90 && grid[0][1] < 400 && grid[0][0] < 100, JSON.stringify(grid))
  await page.shot(join(shots, 'deck-4-grid.png'))
  await fq("document.querySelector('#b-grid').click()")

  // ── 5. not a deck, and a hostile one ──
  await open(NOT_A_DECK)
  await sleep(1500)
  all = await msgs()
  const err = all.find((m) => m.op === 'error')
  check('a file without the deck marker is refused with a plain message, nothing is mounted', !!err && /not a Kybernos deck/.test(err.message) && (await fq("document.querySelectorAll('#deck .cell').length")) === 0, JSON.stringify(all.map((m) => m.op + ':' + (m.message || ''))))
  await open(HOSTILE)
  await until("document.querySelectorAll('#deck .cell').length === 1")
  await sleep(800)
  const hostile = await fq("({ pwned: typeof window.__pwned === 'undefined' ? null : window.__pwned, scripts: document.querySelectorAll('#deck script, #deck iframe').length, handlers: [...document.querySelectorAll('#deck *')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length, js: [...document.querySelectorAll('#deck [href], #deck [src]')].filter((e) => /^javascript:/i.test(e.getAttribute('href') || e.getAttribute('src'))).length, bg: [...document.querySelectorAll('#deck [style]')].filter((e) => /example\\.com/.test(e.getAttribute('style'))).length, text: document.querySelector('#deck .b').textContent })")
  check('a script, an onerror/onclick, a javascript: link, an iframe and a remote background in the file run and survive nothing', hostile.pwned === null && hostile.scripts === 0 && hostile.handlers === 0 && hostile.js === 0 && hostile.bg === 0 && hostile.text === 'Still here', JSON.stringify(hostile))
  // an edit on the hostile deck: the file that goes back is clean too
  await click('.cell.cur .b')
  await press('End')
  await typeKeys('!')
  await sleep(300)
  const hostileOut = await exportText()
  check('what is saved from it holds none of the hostile parts', typeof hostileOut === 'string' && !/onerror|onclick|javascript:|<iframe|example\.com|__pwned='script/.test(split(hostileOut).head.slice(split(hostileOut).head.indexOf('<main'))) && /Still here!/.test(hostileOut), typeof hostileOut === 'string' ? hostileOut.slice(hostileOut.indexOf('<main'), hostileOut.indexOf('<main') + 600) : JSON.stringify(hostileOut))

  // ── 6. read only, French ──
  await open(DECK, 'lang=en&ro=1')
  await until("document.querySelectorAll('#deck .cell').length === " + SLIDES.length)
  await sleep(500)
  const ro = await fq(`({ editing: document.body.classList.contains('editing'), edit: !!document.querySelector('#b-edit'), fmt: !!document.querySelector('#fmt'), cnt: document.querySelector('#cnt').textContent })`)
  check('?ro=1: no edit button, no formatting bar, a plain viewer', ro.editing === false && ro.edit === false && ro.fmt === false && ro.cnt === '1 / 6', JSON.stringify(ro))
  await fq("document.querySelector('.cell.cur').click()")
  await sleep(200)
  check('?ro=1: a click on the slide goes to the next step', (await fq("document.querySelector('#cnt').textContent")) === '2 / 6' || (await fq("document.querySelector('#cnt').textContent")) === '1 / 6')
  all = await msgs()
  check('?ro=1: loaded says read-only', all.some((m) => m.op === 'loaded' && m.readOnly === true), JSON.stringify(all.map((m) => m.op)))
  check('?ro=1: the export is the file untouched', (await exportText()) === DECK)
  await page.shot(join(shots, 'deck-5-readonly.png'))
  await open(DECK, 'lang=fr')
  await until("document.querySelectorAll('#deck .cell').length === " + SLIDES.length)
  await sleep(500)
  const fr = await fq(`({ grid: document.querySelector('#b-grid').textContent, prev: document.querySelector('#b-prev').title, bold: document.querySelector('#fmt [data-cmd=bold]').title, edit: document.querySelector('#b-edit').textContent, add: document.querySelector('#f-addtext').title, aria: document.querySelector('#fmt').getAttribute('aria-label'), notes: document.querySelector('#nb b').textContent })`)
  check('?lang=fr: the bar, the titles and the labels are French', fr.grid === 'Grille' && fr.prev === 'Précédent (←)' && fr.bold === 'Gras (Ctrl+B)' && fr.edit === 'Terminer' && fr.add === 'Ajouter une zone de texte' && fr.aria === 'Mise en forme' && fr.notes === 'Notes de la slide :', JSON.stringify(fr))
  await page.shot(join(shots, 'deck-6-french.png'))

  // ── 7. the standalone runtime of the same build, deck opened on its own ──
  const tok = 't' + (++tokenSeq).toString(16).padStart(8, '0')
  files.set(tok, DECK)
  const standaloneLogs = []
  page.on('Log.entryAdded', (p) => { if (p.entry && (p.entry.level === 'error' || p.entry.level === 'warning')) standaloneLogs.push(String(p.entry.text).slice(0, 200)) })
  await page.send('Log.enable', {})
  await page.send('Page.navigate', { url: origin + '/standalone/' + tok })
  await sleep(1200)
  const sa = await top(`({ cells: document.querySelectorAll('#deck .cell').length, cnt: (document.querySelector('#cnt') || {}).textContent, charts: document.querySelectorAll('.chart svg').length, edit: !!document.querySelector('#b-edit'), fmt: !!document.querySelector('#fmt'), pres: !!document.querySelector('#b-pres'), fs: !!document.querySelector('#b-fs'), print: !!document.querySelector('#b-print'), grid: document.querySelector('#b-grid').textContent })`)
  check('standalone: the runtime builds its bar, draws the charts and has presenter, full screen and print but no edit', sa.cells === 6 && sa.cnt === '1 / 6' && sa.charts === 2 && sa.edit === false && sa.fmt === false && sa.pres && sa.fs && sa.print && sa.grid === 'Grid', JSON.stringify(sa))
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await sleep(700)
  check('standalone: the arrow key moves to the next slide', (await top("document.querySelector('#cnt').textContent")) === '2 / 6')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', text: 'e', code: 'KeyE' }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE' })
  await sleep(200)
  check('standalone: the « e » key does not start an editor', (await top("document.body.classList.contains('editing')")) === false)
  await top("document.querySelector('#b-grid').click()")
  await sleep(500)
  await page.shot(join(shots, 'deck-7-standalone-grid.png'))
  await top("document.querySelector('#b-grid').click()")
  await sleep(300)
  await page.shot(join(shots, 'deck-7-standalone.png'))
  check('standalone: no console error', standaloneLogs.length === 0 && topLogs.length === 0, JSON.stringify([standaloneLogs, topLogs]))
} catch (e) {
  fails += 1
  console.log('FAIL the check stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e))
} finally {
  try { await Promise.race([page.send('Browser.close', {}), sleep(2500)]) } catch (e) { /* gone */ }
  try { chrome.kill() } catch (e) { /* gone */ }
  server.close()
  await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ }
}
console.log('screenshots in ' + shots)
console.log(fails === 0 ? 'DECK FRAME — all ok' : 'DECK FRAME — ' + fails + ' failure(s)')
process.exit(fails === 0 ? 0 : 1)
