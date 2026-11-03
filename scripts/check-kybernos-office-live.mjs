// The Office editors on a real GUI: open a workbook and a document in their sandboxed frames, type into each with real key events, save, see the file on disk change
// by that edit only, meet a conflict, undo, and look at what the frame can and cannot reach. Run it against the SANDBOX (scripts/sandbox/setup.sh && start.sh, then
// `source scripts/sandbox/env.sh`) after `node scripts/build-office-editors.mjs --home "$DSH_HOME"`: it works on copies in a temp folder it removes again, but it writes in the
// plugin's own storage of the DSH it talks to.
//
// Named check-* on purpose: it needs a running DSH, the built editors and Chrome, so CI must not run it.
//   node scripts/check-kybernos-office-live.mjs     (KB_HOST of the sandbox; KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'
import { connect } from './cdp-lib.mjs'
import { docx } from '../packages/kybernos-office/lib-test-files.mjs'
import { listParts, readText } from '../packages/kybernos-office/zip-lite.mjs'

const authority = process.env.KB_HOST
if (!authority || authority === '127.0.0.1:3080') { console.log('Run this against the sandbox (source scripts/sandbox/env.sh): it will not touch the real :3080.'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-office-live')
mkdirSync(shotDir, { recursive: true })

// ── the files: a workbook made by the spreadsheet engine itself (so it is a real one), a document from the test generator ──
const dshHome = process.env.DSH_HOME
if (!dshHome || !existsSync(join(dshHome, 'kybernos', 'kybernos-office', 'editors', 'manifest.json'))) { console.log('Build the editors first: node scripts/build-office-editors.mjs --home "$DSH_HOME"'); process.exit(2) }
const engine = await import(pathToFileURL(join(dshHome, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@ironcalc', 'wasm-xlsx', 'wasm.js')).href)
engine.initSync({ module: readFileSync(join(dshHome, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@ironcalc', 'wasm-xlsx', 'wasm_bg.wasm')) })
const makeBook = () => {
  const m = new engine.Model('book', 'en', 'UTC', 'en')
  m.setUserInput(0, 1, 1, 'Total'); m.setUserInput(0, 1, 2, '42'); m.setUserInput(0, 2, 1, 'Double'); m.setUserInput(0, 2, 2, '=B1*2')
  return Buffer.from(m.toXlsx())
}
const cellOf = (bytes, row, col) => { const m = engine.Model.fromXlsx(new Uint8Array(bytes), 'b', 'en', 'UTC', 'en'); m.evaluate(); return m.getFormattedCellValue(0, row, col) }
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kb-office-live-')))
const book = join(dir, 'budget.xlsx')
const report = join(dir, 'report.docx')
const BOOK0 = makeBook()
writeFileSync(book, BOOK0)
writeFileSync(report, docx({ text: 'Quarterly report' }))
const DOC0 = readFileSync(report)
const textOfDoc = (bytes) => { const p = listParts(bytes); return readText(bytes, p, 'word/document.xml') }

const live = await openLivePage({ width: 1360, height: 1000 })
const { page } = live
const q = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const until = async (js, ms = 15000, inFrame = false) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = inFrame ? await fq(js) : await q(js); if (v && !v.__err) return v; await sleep(250) } return false }

// The frame of an editor is a sandboxed page that Chrome keeps in a process of its own: a target of its own, driven through its own connection.
const debugBase = 'http://' + new URL(page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
let frameConn = null
let frameTargetId = ''
const frameTarget = async () => {
  try {
    const list = await (await fetch(debugBase + '/json/list')).json()
    const t = list.find((x) => /\/kybernos-office\/v\//.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
    if (!t) return null
    if (frameConn === null || frameTargetId !== t.id) {
      try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
      frameConn = await connect(t)
      frameTargetId = t.id
      await frameConn.send('Runtime.enable', {})
      await frameConn.send('Log.enable', {})
      frameConn.logs = []
      frameConn.on('Log.entryAdded', (p) => { if (p.entry && p.entry.level !== 'verbose') frameConn.logs.push(p.entry.level + ': ' + String(p.entry.text).slice(0, 200) + ' ' + String(p.entry.url || '').slice(0, 80)) })
      frameConn.on('Runtime.exceptionThrown', (p) => frameConn.logs.push('exception: ' + String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || '').slice(0, 300)))
    }
    return frameConn
  } catch (e) { return null }
}
const fq = async (js, ms = 15000) => {
  const c = await frameTarget()
  if (c === null) return { __err: 'no frame target' }
  const r = await c.evalJs(js, ms)
  return r.err ? { __err: r.err } : r.val
}
const frameLogs = () => (frameConn ? frameConn.logs.slice() : [])
const frameBox = () => q(`(() => { const r = document.querySelector('[data-kb="office-frame"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
const mouse = async (p, clickCount = 1) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount })
}
const typeKeys = async (text) => {
  for (const ch of text) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(25)
  }
}
const key = async (k, code) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: ({ Enter: 13, Escape: 27, Tab: 9 })[k] || 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k }) }
const hook = (h) => `document.querySelector('[data-kb="${h}"]')`
const status = () => q(`(${hook('office-status')} || {}).textContent || ''`)
const saveEnabled = () => q(`!!${hook('office-save')} && !${hook('office-save')}.disabled`)
const pressWindow = async (h) => q(`${hook(h)}.click()`)
const closeWindow = async () => { await q(`(() => { const b = ${hook('office-close')}; if (b) b.click(); const c = document.querySelector('[data-kb="office-discard"]'); if (c) c.querySelector('.kyo-row').children[1].click() })()`); await sleep(400) }

let failedHard = false
try {
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await sleep(9000)

  // ── declared to the core
  const reg = await q(`(() => { const e = window.__KB_EDITORS__ && window.__KB_EDITORS__.forName('budget.xlsx'); return e ? e.id : null })()`)
  check('the plugin declared its editor to the core (window.__KB_EDITORS__ takes .xlsx)', reg === 'office', JSON.stringify(reg))
  check('and the core does not hand .pptx or a lock file to it', (await q(`!window.__KB_EDITORS__.forName('deck.pptx') && !window.__KB_EDITORS__.forName('~$budget.xlsx')`)) === true)
  const st = await q(`fetch('/kybernos-office/status').then((r) => r.json())`)
  check('the host says both editors are installed', st && st.ok && st.installed && st.installed.sheet === true && st.installed.doc === true, JSON.stringify(st))

  // ── the workbook
  await q(`window.__KB_EDITORS__.forName('budget.xlsx').open(${JSON.stringify(book)}, 'budget.xlsx')`)
  check('the window opens with a sandboxed frame (no allow-same-origin)', (await until(`!!${hook('office-frame')}`, 10000)) === true)
  const sbx = await q(`${hook('office-frame')}.getAttribute('sandbox')`)
  check('the frame is sandboxed without allow-same-origin', sbx === 'allow-scripts', JSON.stringify(sbx))
  await frameTarget()
  await fq('location.reload()')
  await sleep(2500)
  const sheetUp = await until(`document.querySelector('canvas') !== null`, 30000, true)
  check('the spreadsheet editor draws its grid in the frame', sheetUp === true, JSON.stringify(frameLogs()))
  await sleep(1500)
  check('the frame logged no error or CSP violation while loading', frameLogs().filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(frameLogs()))
  check('opened clean: status says no changes, Save is off', /No changes/.test(await status()) && (await saveEnabled()) === false, await status())
  await page.shot(join(shotDir, '1-sheet.png'))

  const wall = await fq(`(async () => { const out = {}; try { parent.document.title; out.parent = 'reached' } catch (e) { out.parent = 'blocked' } try { out.cookie = document.cookie } catch (e) { out.cookie = 'blocked' } try { localStorage.getItem('x'); out.storage = 'reached' } catch (e) { out.storage = 'blocked' }
    try { await fetch('https://example.com/', { mode: 'no-cors' }); out.outside = 'reached' } catch (e) { out.outside = 'blocked' }
    try { const r = await fetch('/kybernos-office/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(report)} }) }); out.open = r.status } catch (e) { out.open = 'blocked' }
    try { const r = await fetch('/kybernos-office/status'); out.status = r.status } catch (e) { out.status = 'blocked' }
    return out })()`)
  check('the frame cannot reach the DSH page, cookies, storage or the internet', wall && wall.parent === 'blocked' && (wall.cookie === 'blocked' || wall.cookie === '') && wall.storage === 'blocked' && wall.outside === 'blocked', JSON.stringify(wall))
  check('and from the frame the write routes answer 401/403 and even a read is refused (no cookie, Origin: null)', wall && (wall.open === 401 || wall.open === 403 || wall.open === 'blocked') && (wall.status === 403 || wall.status === 'blocked'), JSON.stringify(wall))

  // type into A1 (the first cell of the first row, read off the first screenshot): Total -> Hello
  const box = await frameBox()
  await mouse({ x: box.x + 75, y: box.y + 121 })
  await sleep(300)
  await typeKeys('Hello')
  await key('Enter')
  await sleep(1200)
  check('a real edit in the grid turns Save on and says so', (await saveEnabled()) === true && /Unsaved/.test(await status()), await status())
  await page.shot(join(shotDir, '2-sheet-edited.png'))
  check('nothing was written to disk by editing', readFileSync(book).equals(BOOK0))

  await pressWindow('office-save')
  const saved = await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
  check('Save writes the file and says Saved', saved === true, await status())
  const BOOK1 = readFileSync(book)
  check('the file on disk changed and is still a workbook', !BOOK1.equals(BOOK0) && BOOK1.subarray(0, 2).toString() === 'PK')
  let a1 = null; let b2 = null
  try { a1 = cellOf(BOOK1, 1, 1); b2 = cellOf(BOOK1, 2, 2) } catch (e) { a1 = String(e) }
  check('A1 now says what was typed and the formula in B2 still works (84)', a1 === 'Hello' && b2 === '84', JSON.stringify([a1, b2]))
  check('Save is off again and Undo is on', (await saveEnabled()) === false && (await q(`!${hook('office-undo')}.disabled`)) === true)
  check('the folder holds nothing but the two files (no temp file, no snapshot beside them)', readdirSync(dir).sort().join() === 'budget.xlsx,report.docx', readdirSync(dir).join())

  // a conflict: the file changes under the editor, then the person saves
  await mouse({ x: box.x + 75, y: box.y + 121 })
  await typeKeys('Again'); await key('Enter'); await sleep(1000)
  const OTHER = makeBook()
  writeFileSync(book, OTHER)
  await pressWindow('office-save')
  const conflict = await until(`!!${hook('office-conflict')} && !${hook('office-layer')}.hidden`, 10000)
  check('a file changed meanwhile is a conflict card, not an overwrite', conflict === true && readFileSync(book).equals(OTHER))
  await page.shot(join(shotDir, '3-conflict.png'))
  await q(`${hook('office-conflict')}.querySelector('.kyo-row').children[0].click()`)
  const copied = await until(`/Copy saved/.test((${hook('office-status')} || {}).textContent || '')`, 10000)
  const files = readdirSync(dir).sort()
  check('« Save a copy » writes next to it and leaves the other writer\'s file alone', copied === true && files.includes('budget (edited).xlsx') && readFileSync(book).equals(OTHER), JSON.stringify(files))
  await closeWindow()
  check('closing with unsaved changes asked first, then closed', (await q(`!${hook('office-window')}`)) === true)

  // undo, through a fresh window
  writeFileSync(book, BOOK1)
  await q(`window.__KB_EDITORS__.forName('budget.xlsx').open(${JSON.stringify(book)}, 'budget.xlsx')`)
  await until(`!!${hook('office-frame')}`, 10000)
  await frameTarget(); await fq('location.reload()'); await sleep(2500)
  await until(`document.querySelector('canvas') !== null`, 30000, true)
  await sleep(1500)
  const box2 = await frameBox()
  await mouse({ x: box2.x + 75, y: box2.y + 121 }); await typeKeys('Second'); await key('Enter'); await sleep(1000)
  await pressWindow('office-save')
  await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
  const afterSecond = readFileSync(book)
  check('a second save also goes through', !afterSecond.equals(BOOK1))
  await pressWindow('office-undo')
  await until(`/put back/.test((${hook('office-status')} || {}).textContent || '')`, 10000)
  check('Undo puts the file back exactly as it was before that save', readFileSync(book).equals(BOOK1))
  await closeWindow()

  // ── the document
  await q(`window.__KB_EDITORS__.forName('report.docx').open(${JSON.stringify(report)}, 'report.docx')`)
  check('the document window opens', (await until(`!!${hook('office-frame')}`, 10000)) === true)
  await frameTarget(); await fq('location.reload()'); await sleep(3000)
  const docUp = await until(`!!document.querySelector('[contenteditable="true"], .ProseMirror')`, 40000, true)
  check('the document editor draws the page in the frame', docUp === true, JSON.stringify(frameLogs()))
  await sleep(2500)
  check('the frame logged no error or CSP violation while loading the document', frameLogs().filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(frameLogs()))
  check('opened clean: no changes, Save off (the editor\'s own tidy-up on load is not a change)', /No changes/.test(await status()) && (await saveEnabled()) === false, await status())
  await page.shot(join(shotDir, '4-doc.png'))
  const dbox = await frameBox()
  const at = await fq(`(() => { const e = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]'); const r = e.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 30 } })()`)
  await mouse({ x: dbox.x + (at && at.x ? at.x : 300), y: dbox.y + (at && at.y ? at.y : 200) })
  await sleep(300)
  await typeKeys(' EDITED')
  await sleep(1200)
  check('typing in the document turns Save on', (await saveEnabled()) === true, await status())
  await pressWindow('office-save')
  await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 20000)
  const DOC1 = readFileSync(report)
  const body = textOfDoc(DOC1) || ''
  check('the document on disk changed, is still a .docx, and holds the typed text', !DOC1.equals(DOC0) && DOC1.subarray(0, 2).toString() === 'PK' && /EDITED/.test(body) && /Quarterly report/.test(body), body.slice(0, 300))
  await page.shot(join(shotDir, '5-doc-saved.png'))
  await closeWindow()

  // ── the way in a person takes: Creations, the file's viewer, the pencil. The sandbox's workspace is this checkout, so a sample dropped in its root is listed.
  const sample = join(fileURLToPath(new URL('..', import.meta.url)), 'office-live-sample.xlsx')
  writeFileSync(sample, BOOK1)
  try {
    await q(`[...document.querySelectorAll('.kb4-menu .kb4-item')].find((x) => x.textContent.trim().startsWith('Creations')).click()`)
    await sleep(3500)
    const listed = await until(`[...document.querySelectorAll('.kb6-card')].some((c) => /office-live-sample\\.xlsx/.test(c.textContent))`, 20000)
    check('Creations lists the workbook as a card', listed === true)
    await q(`[...document.querySelectorAll('.kb6-card')].find((c) => /office-live-sample\\.xlsx/.test(c.textContent)).querySelector('[data-kb="art-prev"]').click()`)
    check('the card opens the file\'s viewer', (await until(`!!${hook('art-popup')}`, 10000)) === true)
    check('and the viewer has the pencil (an editor declared itself for this name)', (await q(`!!${hook('art-popup-edit')}`)) === true)
    await page.shot(join(shotDir, '6-viewer-pencil.png'))
    await q(`${hook('art-popup-edit')}.click()`)
    check('the pencil opens the editing window on that file', (await until(`!!${hook('office-frame')} && /office-live-sample/.test((${hook('office-title')} || {}).textContent || '')`, 10000)) === true)
    check('the window sits above the viewer', (await q(`(() => { const w = ${hook('office-window')}; const v = ${hook('art-popup')}; return Number(getComputedStyle(w).zIndex) > Number(getComputedStyle(v.parentElement.classList.contains('kb6-popwrap') ? v : v).zIndex || 0) })()`)) === true)
    await q(`(() => { const c = ${hook('office-close')}; if (c) c.click() })()`)
    await sleep(400)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)
    check('closing the window leaves the viewer, Esc then closes the viewer', (await q(`!${hook('office-window')}`)) === true && (await q(`!${hook('art-popup')}`)) === true)
  } finally { try { rmSync(sample) } catch (e) { /* gone */ } }

  // ── French
  await q(`window.__KB_EDITORS__.forName('budget.xlsx').open(${JSON.stringify(book)}, 'budget.xlsx')`)
  await until(`!!${hook('office-frame')}`, 10000)
  const src = await q(`${hook('office-frame')}.getAttribute('src')`)
  const appLang = await q(`(window.__KB_LANG_RESOLVE__ && (window.__KB_LANG_RESOLVE__() === 'kybernos' || String(window.__KB_LANG_RESOLVE__()).split(/[-_]/)[0] === 'fr')) ? 'fr' : 'en'`)
  check('the frame is asked in the language of the app', typeof src === 'string' && src.includes('lang=' + appLang), src + ' / ' + appLang)
  await closeWindow()
} catch (e) {
  failedHard = true
  console.log('FAIL the check stopped: ' + String(e && e.stack ? e.stack : e))
}
try { await live.close() } catch (e) { /* gone */ }
try { rmSync(dir, { recursive: true, force: true }) } catch (e) { /* busy */ }
console.log('\nscreenshots in ' + shotDir)
console.log(fails === 0 && !failedHard ? 'OFFICE LIVE — all ok' : 'OFFICE LIVE — ' + fails + ' failure(s)')
process.exit(fails === 0 && !failedHard ? 0 : 1)
