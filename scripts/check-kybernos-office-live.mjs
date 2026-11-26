// The Office editors on a real GUI: open a workbook, a document, a Markdown file and a PDF in their sandboxed frames, type into each with real key events, save, see the file on disk change
// by that edit only, meet a conflict, undo, look at what the frame can and cannot reach, and open a .docx and an .xlsx from the right-hand file list of a chat. Run it against the SANDBOX (scripts/sandbox/setup.sh && start.sh, then
// `source scripts/sandbox/env.sh`) after `node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"`: it works on copies in a temp folder it removes again, but it writes in the
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
if (!dshHome || !existsSync(join(dshHome, 'kybernos', 'kybernos-office', 'editors', 'manifest.json'))) { console.log('Build the editors first: node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"'); process.exit(2) }
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
// A Markdown file with a front matter, CRLF line ends and a final newline (what an editor must give back as it found it), one with HTML (what the Editor view would drop),
// and a real PDF: the sample the PDF viewer's package ships, installed by the editors' build.
const NOTES = '---\r\ntitle: Notes\r\n---\r\n\r\n# Notes\r\n\r\nFirst paragraph.\r\n\r\n- one\r\n- two\r\n'
const PAGE = 'Intro\n\n<div align="center">kept as written</div>\n'
const notesMd = join(dir, 'notes.md')
const pageMd = join(dir, 'page.md')
const demoPdf = join(dir, 'demo.pdf')
const pdfSource = join(dshHome, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@embedpdf', 'snippet', 'dist', 'demo.pdf')
if (!existsSync(pdfSource)) { console.log('The PDF sample is missing: build the editors first'); process.exit(2) }
writeFileSync(notesMd, NOTES)
writeFileSync(pageMd, PAGE)
writeFileSync(demoPdf, readFileSync(pdfSource))
const PDF0 = readFileSync(demoPdf)

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
  check('the folder holds nothing but our five files (no temp file, no snapshot beside them)', readdirSync(dir).sort().join() === 'budget.xlsx,demo.pdf,notes.md,page.md,report.docx', readdirSync(dir).join())

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

  // ── Markdown: the Editor view keeps what it does not touch (front matter, CRLF, final newline), the Text view writes nothing but what is typed
  const openIn = async (path, name) => { await q(`window.__KB_EDITORS__.forName(${JSON.stringify(name)}).open(${JSON.stringify(path)}, ${JSON.stringify(name)})`) }
  const frameWord = (re) => fq(`${re}.test(document.body.innerText)`)
  await openIn(notesMd, 'notes.md')
  check('the Markdown window opens straight away: nothing the Editor view would lose', (await until(`!!${hook('office-frame')}`, 10000)) === true && (await q(`!${hook('office-gate')}`)) === true)
  check('and says that the Editor view rewrites the file (bullets, spacing), above the editor', (await q(`!${hook('office-notice')}.hidden && /rewrites the whole file/.test(${hook('office-notice')}.textContent)`)) === true)
  await frameTarget(); await fq('location.reload()'); await sleep(2000)
  check('the Markdown editor draws the document in the frame, the front matter set aside', (await until(`!!document.querySelector('.ProseMirror h1') && !/title: Notes/.test(document.querySelector('.ProseMirror').innerText)`, 20000, true)) === true, JSON.stringify(frameLogs()))
  check('the frame logged no error or CSP violation', frameLogs().filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(frameLogs()))
  check('opened clean: No changes, Save off', /No changes/.test(await status()) && (await saveEnabled()) === false, await status())
  await page.shot(join(shotDir, '8a-md-editor.png'))
  const mbox = await frameBox()
  const endOf = await fq(`(() => { const p = [...document.querySelectorAll('.ProseMirror p')].find((e) => /First paragraph/.test(e.textContent)); const r = p.getBoundingClientRect(); return { x: r.left + Math.min(r.width, 160) - 2, y: r.top + r.height / 2 } })()`)
  await mouse({ x: mbox.x + endOf.x + 400, y: mbox.y + endOf.y })
  await sleep(300)
  await key('End')
  await typeKeys(' EDITED')
  await sleep(800)
  check('typing in the Editor view turns Save on', (await saveEnabled()) === true && /Unsaved/.test(await status()), await status())
  check('nothing was written to disk by typing', readFileSync(notesMd, 'utf8') === NOTES)
  await pressWindow('office-save')
  check('Save says Saved', (await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)) === true, await status())
  const NOTES1 = readFileSync(notesMd, 'utf8')
  check('the file kept its front matter, its CRLF line ends and its final newline, and holds only the typed text more', NOTES1 === NOTES.replace('First paragraph.', 'First paragraph. EDITED'), JSON.stringify(NOTES1))
  // the Text view: what is typed there is what is written
  await fq(`document.getElementById('m-src').click()`)
  await sleep(500)
  check('the Text view shows the file as it is (front matter included)', (await fq(`!document.getElementById('md-text').hidden && /title: Notes/.test(document.getElementById('md-text').value) && !/\\r/.test(document.getElementById('md-text').value)`)) === true)
  await page.shot(join(shotDir, '8b-md-text.png'))
  await fq(`(() => { const t = document.getElementById('md-text'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })()`)
  await typeKeys('Tail')
  await sleep(600)
  check('typing in the Text view turns Save on', (await saveEnabled()) === true, await status())
  await pressWindow('office-save')
  await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
  check('the Text view wrote exactly what was typed, with the file\'s own line ends', readFileSync(notesMd, 'utf8') === NOTES1 + 'Tail', JSON.stringify(readFileSync(notesMd, 'utf8')))
  await pressWindow('office-undo')
  await until(`/put back/.test((${hook('office-status')} || {}).textContent || '')`, 10000)
  check('Undo puts back the file as it was before that save', readFileSync(notesMd, 'utf8') === NOTES1)
  await closeWindow()
  // a file with HTML: the Editor view would drop it, so the person is asked and the text view is the safe way
  await openIn(pageMd, 'page.md')
  check('a Markdown file with HTML asks first, with four choices', (await until(`!!${hook('office-gate')}`, 10000)) === true && (await q(`${hook('office-gate')}.querySelector('.kyo-row').children.length === 4 && /2 HTML tags/.test(${hook('office-gate')}.textContent)`)) === true)
  await page.shot(join(shotDir, '8c-md-gate.png'))
  await q(`${hook('office-gate')}.querySelector('.kyo-row').children[0].click()`)
  await frameTarget(); await fq('location.reload()'); await sleep(2000)
  check('read-only shows the text, so the HTML is not hidden', (await until(`!document.getElementById('md-text').hidden && /kept as written/.test(document.getElementById('md-text').value)`, 15000, true)) === true && /Read only/.test(await status()))
  await closeWindow()
  check('looking at it wrote nothing', readFileSync(pageMd, 'utf8') === PAGE)
  await openIn(pageMd, 'page.md')
  await until(`!!${hook('office-gate')}`, 10000)
  await q(`${hook('office-gate')}.querySelector('.kyo-row').children[1].click()`)
  await frameTarget(); await fq('location.reload()'); await sleep(2000)
  await until(`!document.getElementById('md-text').hidden`, 15000, true)
  await fq(`(() => { const t = document.getElementById('md-text'); t.focus(); t.setSelectionRange(0, 0) })()`)
  await typeKeys('X')
  await sleep(500)
  await pressWindow('office-save')
  await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
  check('« Edit the text » kept the HTML byte for byte and added only the typed letter', readFileSync(pageMd, 'utf8') === 'X' + PAGE, JSON.stringify(readFileSync(pageMd, 'utf8')))
  await closeWindow()

  // ── PDF: read, annotate with the real mouse, save, undo
  await openIn(demoPdf, 'demo.pdf')
  check('the PDF window opens straight away', (await until(`!!${hook('office-frame')}`, 10000)) === true && (await q(`!${hook('office-gate')}`)) === true)
  await frameTarget(); await fq('location.reload()'); await sleep(2500)
  const pdfUp = await until(`(() => { const walk = (r, f) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot, f); f(e) } }; let n = 0; walk(document, (e) => { if (e.tagName === 'IMG' && e.getBoundingClientRect().width > 200) n += 1 }); return n > 0 })()`, 40000, true)
  check('the PDF viewer draws the pages in the frame', pdfUp === true, JSON.stringify(frameLogs()))
  await sleep(1500)
  check('the frame logged no error or CSP violation while loading the PDF', frameLogs().filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(frameLogs()))
  check('opened clean: No changes, Save off', /No changes/.test(await status()) && (await saveEnabled()) === false, await status())
  await page.shot(join(shotDir, '9a-pdf.png'))
  const DEEP = `const walk = (r, f) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot, f); f(e) } };`
  const fclick = (label) => fq(`(() => { ${DEEP} let hit = null; walk(document, (e) => { if (e.tagName === 'BUTTON' && e.getBoundingClientRect().width > 0 && (e.getAttribute('aria-label') === ${JSON.stringify(label)} || (e.textContent || '').trim() === ${JSON.stringify(label)})) hit = e }); if (hit) hit.click(); return !!hit })()`)
  check('the Shapes tab and the Rectangle tool are there', (await fclick('Shapes')) === true && (await sleep(500), await fclick('Rectangle')) === true)
  const pbox = await frameBox()
  const pg = await fq(`(() => { ${DEEP} let r = null; walk(document, (e) => { if (e.tagName === 'IMG' && !r && e.getBoundingClientRect().width > 200) { const b = e.getBoundingClientRect(); r = { x: b.left, y: b.top } } }); return r })()`)
  const drag = async (x1, y1, x2, y2) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 8; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8, button: 'left', buttons: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 })
  }
  await drag(pbox.x + pg.x + 80, pbox.y + pg.y + 330, pbox.x + pg.x + 300, pbox.y + pg.y + 370)
  await sleep(1200)
  check('drawing a rectangle with the mouse turns Save on', (await saveEnabled()) === true && /Unsaved/.test(await status()), await status())
  check('nothing was written to disk by drawing', readFileSync(demoPdf).equals(PDF0))
  await page.shot(join(shotDir, '9b-pdf-annotated.png'))
  await pressWindow('office-save')
  check('Save says Saved', (await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 30000)) === true, await status())
  const PDF1 = readFileSync(demoPdf)
  check('the file on disk is still a PDF, is not the old one, and holds a rectangle annotation', PDF1.subarray(0, 5).toString() === '%PDF-' && !PDF1.equals(PDF0) && /\/Square/.test(PDF1.toString('latin1')), String(PDF1.length))
  await drag(pbox.x + pg.x + 80, pbox.y + pg.y + 430, pbox.x + pg.x + 300, pbox.y + pg.y + 470)
  await sleep(1000)
  check('after a save, the next drawing is a change again', (await saveEnabled()) === true, await status())
  await pressWindow('office-undo')
  await until(`/put back/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
  check('Undo puts the PDF back exactly as it was before that save', readFileSync(demoPdf).equals(PDF0))
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
    // The viewer shows the workbook itself (read-only), in a box of its own, and « Edit » turns that box into the editor.
    const embedded = await until(`!!document.querySelector('[data-kb="art-embed"] [data-kb="office-frame"]')`, 15000)
    check('the viewer draws the workbook itself, not « preview unavailable »', embedded === true && (await q(`!/Preview unavailable|file is binary/.test(${hook('art-popup')}.textContent)`)) === true)
    check('read-only first: the frame asks for ro=1, Edit is offered, Save is not', (await q(`${hook('office-frame')}.getAttribute('src').includes('ro=1') && !!${hook('office-edit')} && !${hook('office-edit')}.hidden && ${hook('office-save')}.disabled`)) === true)
    check('the box has no close button and no name of its own (the viewer has both)', (await q(`!${hook('art-embed')}.querySelector('[data-kb="office-close"], [data-kb="office-title"]')`)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2500)
    check('the read-only frame draws the grid', (await until(`document.querySelector('canvas') !== null`, 30000, true)) === true, JSON.stringify(frameLogs()))
    await sleep(1500)
    check('and says it is read-only; typing there changes nothing (Save stays off)', /Read only/.test(await status()) && (await saveEnabled()) === false, await status())
    await page.shot(join(shotDir, '6a-viewer-embed-readonly.png'))
    await q(`${hook('office-edit')}.click()`)
    check('Edit swaps the frame for the editor in the same box', (await until(`!${hook('office-frame')}.getAttribute('src').includes('ro=1') && ${hook('office-edit')}.hidden`, 10000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2500)
    await until(`document.querySelector('canvas') !== null`, 30000, true)
    await sleep(1500)
    const ebox = await frameBox()
    await mouse({ x: ebox.x + 75, y: ebox.y + 121 }); await typeKeys('Viewer'); await key('Enter'); await sleep(1000)
    check('typing in the embedded editor turns Save on', (await saveEnabled()) === true, await status())
    await q(`window.__confirmAsked = 0; window.confirm = () => { window.__confirmAsked += 1; return false }`)
    await q(`${hook('art-popup-close')}.click()`)
    await sleep(400)
    check('closing the viewer over unsaved changes asks first, and « no » keeps it open', (await q(`window.__confirmAsked === 1 && !!${hook('art-popup')}`)) === true)
    await pressWindow('office-save')
    await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000)
    let viewerA1 = ''
    try { viewerA1 = cellOf(readFileSync(sample), 1, 1) } catch (e) { viewerA1 = String(e) }
    check('saved from the viewer: the file on disk holds what was typed', viewerA1 === 'Viewer', viewerA1)
    await page.shot(join(shotDir, '6b-viewer-embed-saved.png'))
    await q(`${hook('art-popup-close')}.click()`)
    await sleep(400)
    check('once saved, closing the viewer asks nothing', (await q(`window.__confirmAsked === 1 && !${hook('art-popup')}`)) === true)
    await q(`[...document.querySelectorAll('.kb6-card')].find((c) => /office-live-sample\\.xlsx/.test(c.textContent)).querySelector('[data-kb="art-prev"]').click()`)
    check('the viewer opens again', (await until(`!!${hook('art-popup')}`, 10000)) === true)
    check('and has the pencil (an editor declared itself for this name)', (await q(`!!${hook('art-popup-edit')}`)) === true)
    await page.shot(join(shotDir, '6-viewer-pencil.png'))
    await q(`${hook('art-popup-edit')}.click()`)
    check('the pencil opens the editing window on that file', (await until(`!!${hook('office-frame')} && /office-live-sample/.test((${hook('office-title')} || {}).textContent || '')`, 10000)) === true)
    check('the window sits above the viewer', (await q(`(() => { const w = ${hook('office-window')}; const v = ${hook('art-popup')}; return Number(getComputedStyle(w).zIndex) > Number(getComputedStyle(v.parentElement.classList.contains('kb6-popwrap') ? v : v).zIndex || 0) })()`)) === true)
    await q(`(() => { const c = ${hook('office-close')}; if (c) c.click() })()`)
    const windowGone = (await until(`!${hook('office-window')}`, 4000)) === true
    await sleep(400)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    check('closing the window leaves the viewer, Esc then closes the viewer', windowGone === true && (await until(`!${hook('art-popup')}`, 4000)) === true)
  } finally { try { rmSync(sample) } catch (e) { /* gone */ } }

  // ── Creations again: a PDF is drawn by its editor (read-only, nothing to annotate until Edit), Markdown keeps the viewer's own preview and has the pencil
  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const sampleMd = join(rootDir, 'office-live-sample.md')
  const samplePdf = join(rootDir, 'office-live-sample.pdf')
  writeFileSync(sampleMd, '# Sample heading\n\nSome text.\n')
  writeFileSync(samplePdf, PDF0)
  const DEEPQ = `const walk = (r, f) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot, f); f(e) } };`
  const hasButton = (label) => `(() => { ${DEEPQ} let n = 0; walk(document, (e) => { if (e.tagName === 'BUTTON' && e.getBoundingClientRect().width > 0 && ((e.textContent || '').trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)})) n += 1 }); return n > 0 })()`
  try {
    await page.send('Page.navigate', { url: 'http://' + authority + '/' })
    await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
    await sleep(9000)
    await q(`[...document.querySelectorAll('.kb4-menu .kb4-item')].find((x) => x.textContent.trim().startsWith('Creations')).click()`)
    await sleep(3500)
    const card = (n) => `[...document.querySelectorAll('.kb6-card')].find((c) => c.textContent.includes(${JSON.stringify(n)}))`
    check('Creations lists the PDF and the Markdown file', (await until(`!!${card('office-live-sample.pdf')} && !!${card('office-live-sample.md')}`, 20000)) === true)
    await q(`${card('office-live-sample.pdf')}.querySelector('[data-kb="art-prev"]').click()`)
    check('the PDF\'s viewer draws it through the editor, read-only', (await until(`!!document.querySelector('[data-kb="art-embed"] [data-kb="office-frame"]') && ${hook('office-frame')}.getAttribute('src').includes('ro=1')`, 15000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2500)
    check('the pages are drawn', (await until(`(() => { ${DEEPQ} let n = 0; walk(document, (e) => { if (e.tagName === 'IMG' && e.getBoundingClientRect().width > 200) n += 1 }); return n > 0 })()`, 40000, true)) === true, JSON.stringify(frameLogs()))
    await sleep(1000)
    check('read-only: no annotation tab in the viewer, and Edit is offered', (await fq(hasButton('Annotate'))) === false && (await fq(hasButton('Shapes'))) === false && (await q(`!${hook('office-edit')}.hidden && ${hook('office-save')}.disabled`)) === true)
    await page.shot(join(shotDir, '9c-pdf-viewer-readonly.png'))
    await q(`${hook('office-edit')}.click()`)
    await until(`!${hook('office-frame')}.getAttribute('src').includes('ro=1')`, 10000)
    await frameTarget(); await fq('location.reload()'); await sleep(3000)
    check('Edit turns the annotation tools on in the same box', (await until(hasButton('Annotate'), 30000, true)) === true)
    await page.shot(join(shotDir, '9d-pdf-viewer-edit.png'))
    await q(`${hook('art-popup-close')}.click()`)
    await sleep(500)
    await q(`${card('office-live-sample.md')}.querySelector('[data-kb="art-prev"]').click()`)
    // the viewer's own preview of a Markdown file is a frame of its own (srcdoc), not ours (no data-kb="office-frame")
    const mdView = (await until(`(() => { const f = ${hook('art-popup')} && ${hook('art-popup')}.querySelector('iframe.kb6-frame'); return !!f && /Sample heading/.test(f.srcdoc || '') })()`, 15000)) === true
    check('the Markdown file\'s viewer keeps its own preview (no editor frame in it)', mdView === true && (await q(`!${hook('art-popup')}.querySelector('[data-kb="office-frame"]')`)) === true, String(await q(`(${hook('art-popup')} || document.body).innerText.slice(0, 300) + ' | frames=' + document.querySelectorAll('[data-kb="office-frame"]').length`)))
    check('and has the pencil', (await q(`!!${hook('art-popup-edit')}`)) === true)
    await q(`${hook('art-popup-edit')}.click()`)
    check('the pencil opens the Markdown editor on that file', (await until(`!!${hook('office-frame')} && /office-live-sample\\.md/.test((${hook('office-title')} || {}).textContent || '')`, 10000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2000)
    check('the editor draws the heading', (await until(`!!document.querySelector('.ProseMirror h1') && /Sample heading/.test(document.querySelector('.ProseMirror h1').textContent)`, 20000, true)) === true, JSON.stringify(frameLogs()))
    await q(`(() => { const c = ${hook('office-close')}; if (c) c.click() })()`)
    await sleep(400)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)
    check('nothing of these two files was written by looking at them', readFileSync(sampleMd, 'utf8') === '# Sample heading\n\nSome text.\n' && readFileSync(samplePdf).equals(PDF0))
  } finally {
    try { rmSync(sampleMd) } catch (e) { /* gone */ }
    try { rmSync(samplePdf) } catch (e) { /* gone */ }
  }

  // ── the right-hand tab of a chat: the workspace file list, a click on a .docx or .xlsx, the editor in DSH's own right pane (kept mounted when the person goes to another tab)
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const paneDoc = join(repo, 'office-live-sample.docx')
  const paneSheet = join(repo, 'office-live-sample.xlsx')
  const paneMd = join(repo, 'office-live-pane.md')
  const panePdf = join(repo, 'office-live-pane.pdf')
  writeFileSync(paneDoc, DOC0)
  writeFileSync(paneSheet, BOOK1)
  writeFileSync(paneMd, '# Pane heading\n\nBody.\n')
  writeFileSync(panePdf, PDF0)
  try {
    await page.send('Page.navigate', { url: 'http://' + authority + '/' })
    await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
    await sleep(9000)
    const tabNamed = (n) => `[...document.querySelectorAll('[role="tab"]')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(n)}))`
    const leaf = (n) => `[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(n)})`
    await q(`document.querySelector('button[aria-label="Open right sidebar"]').click()`)
    await sleep(1500)
    await q(`${leaf('Workspace files')}.click()`)
    check('the right sidebar lists the workspace files', (await until(`!!${leaf('office-live-sample.docx')} && !!${leaf('office-live-sample.xlsx')}`, 15000)) === true)
    await q(`${leaf('office-live-sample.docx')}.click()`)
    check('a click on the .docx in the file list opens our editor in the tab', (await until(`!!document.querySelector('.kyo-pane [data-kb="office-frame"]')`, 20000)) === true)
    check('the tab is named after the file', (await q(`!!${tabNamed('office-live-sample.docx')}`)) === true)
    check('read-only first: Read only, Edit offered, Save off', (await q(`${hook('office-status')}.textContent === 'Read only' && !${hook('office-edit')}.hidden && ${hook('office-save')}.disabled && ${hook('office-frame')}.getAttribute('src').includes('ro=1')`)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(3000)
    check('the document is drawn in the pane (a page with the sample text)', (await until(`/Quarterly report/.test(document.body.innerText)`, 40000, true)) === true, JSON.stringify(frameLogs()))
    await sleep(1500)
    await page.shot(join(shotDir, '7a-pane-readonly.png'))
    await q(`${hook('office-edit')}.click()`)
    check('Edit turns the pane into the editor', (await until(`!${hook('office-frame')}.getAttribute('src').includes('ro=1') && ${hook('office-edit')}.hidden`, 10000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(3000)
    await until(`!!document.querySelector('[contenteditable="true"], .ProseMirror')`, 40000, true)
    await sleep(2500)
    const pbox = await frameBox()
    const pat = await fq(`(() => { const e = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]'); const r = e.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 30 } })()`)
    await mouse({ x: pbox.x + (pat && pat.x ? pat.x : 300), y: pbox.y + (pat && pat.y ? pat.y : 200) })
    await sleep(300)
    await typeKeys(' PANE')
    await sleep(1200)
    check('typing in the pane turns Save on', (await saveEnabled()) === true && /Unsaved/.test(await status()), await status())
    await q(`${hook('office-frame')}.__probe = 'same'`)
    await q(`${tabNamed('Files')}.click()`)
    await sleep(1500)
    check('on another tab the editor stays mounted (hidden), not thrown away', (await q(`document.querySelectorAll('[data-kb="office-frame"]').length === 1`)) === true)
    await page.shot(join(shotDir, '7b-pane-other-tab.png'))
    await q(`${tabNamed('office-live-sample.docx')}.click()`)
    await sleep(1500)
    check('back on the tab: the very same editor, with what was typed still unsaved', (await q(`${hook('office-frame')}.__probe === 'same' && !${hook('office-save')}.disabled && /Unsaved/.test(${hook('office-status')}.textContent)`)) === true, await status())
    await page.shot(join(shotDir, '7c-pane-back.png'))
    await pressWindow('office-save')
    await until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 20000)
    const PD = readFileSync(paneDoc)
    const pbody = textOfDoc(PD) || ''
    check('saved from the pane: the file on disk is still a .docx and holds the typed text and the old one', !PD.equals(DOC0) && PD.subarray(0, 2).toString() === 'PK' && /PANE/.test(pbody) && /Quarterly report/.test(pbody), pbody.slice(0, 200))
    check('after its own save the pane stays an editor (no reload back to read-only)', (await q(`!${hook('office-frame')}.getAttribute('src').includes('ro=1') && ${hook('office-edit')}.hidden`)) === true)
    await page.shot(join(shotDir, '7d-pane-saved.png'))

    // the workbook: a second tab, in its own right
    await q(`${tabNamed('office-live-sample.docx')}.querySelector('[aria-label="Close"], button').click()`)
    await sleep(800)
    check('closing the tab takes the editor away', (await q(`!document.querySelector('[data-kb="office-frame"]')`)) === true)
    await q(`${tabNamed('Files')}.click()`)
    await sleep(1000)
    await q(`${leaf('office-live-sample.xlsx')}.click()`)
    check('a click on the .xlsx opens the workbook in the tab', (await until(`!!document.querySelector('.kyo-pane [data-kb="office-frame"]')`, 20000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2500)
    check('the grid is drawn in the pane', (await until(`document.querySelector('canvas') !== null`, 30000, true)) === true, JSON.stringify(frameLogs()))
    await sleep(1500)
    check('and says it is read-only', /Read only/.test(await status()) && (await saveEnabled()) === false, await status())
    await page.shot(join(shotDir, '7e-pane-sheet.png'))
    await q(`${tabNamed('office-live-sample.xlsx')}.querySelector('[aria-label="Close"], button').click()`)
    await sleep(600)

    // Markdown and PDF: a click in the list opens each in a tab of its own, read-only first
    await q(`${tabNamed('Files')}.click()`)
    await sleep(1000)
    await q(`${leaf('office-live-pane.md')}.click()`)
    check('a click on the .md opens the Markdown file in the tab, read-only', (await until(`!!document.querySelector('.kyo-pane [data-kb="office-frame"]') && ${hook('office-frame')}.getAttribute('src').includes('ro=1')`, 20000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2000)
    check('its heading is drawn in the pane', (await until(`!!document.querySelector('.ProseMirror h1') && /Pane heading/.test(document.querySelector('.ProseMirror h1').textContent)`, 20000, true)) === true, JSON.stringify(frameLogs()))
    await page.shot(join(shotDir, '7f-pane-md.png'))
    await q(`${tabNamed('office-live-pane.md')}.querySelector('[aria-label="Close"], button').click()`)
    await sleep(600)
    await q(`${tabNamed('Files')}.click()`)
    await sleep(1000)
    await q(`${leaf('office-live-pane.pdf')}.click()`)
    check('a click on the .pdf opens the PDF in the tab', (await until(`!!document.querySelector('.kyo-pane [data-kb="office-frame"]')`, 20000)) === true)
    await frameTarget(); await fq('location.reload()'); await sleep(2500)
    check('its pages are drawn in the pane', (await until(`(() => { ${DEEPQ} let n = 0; walk(document, (e) => { if (e.tagName === 'IMG' && e.getBoundingClientRect().width > 200) n += 1 }); return n > 0 })()`, 40000, true)) === true, JSON.stringify(frameLogs()))
    await page.shot(join(shotDir, '7g-pane-pdf.png'))
    await q(`${tabNamed('office-live-pane.pdf')}.querySelector('[aria-label="Close"], button').click()`)
    await sleep(600)
  } finally {
    try { rmSync(paneDoc) } catch (e) { /* gone */ }
    try { rmSync(paneSheet) } catch (e) { /* gone */ }
    try { rmSync(paneMd) } catch (e) { /* gone */ }
    try { rmSync(panePdf) } catch (e) { /* gone */ }
  }

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
