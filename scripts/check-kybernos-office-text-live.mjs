// The text editor of the Office plugin on a real GUI: a CSV file (table view, with its byte-order mark, CRLF line ends and quoting kept), a JSON file (valid / not valid, Format),
// a plain text file, and a CSV that is not a table. Each is opened in its sandboxed frame, typed into with real key events, saved, compared byte for byte on disk, and undone.
// Run it against the SANDBOX (scripts/sandbox/setup.sh && start.sh, then `source scripts/sandbox/env.sh`) after `node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"`:
// it works on copies in a temp folder it removes again, but it writes in the plugin's own storage of the DSH it talks to.
//
// Named check-* on purpose: it needs a running DSH, the built editors and Chrome, so CI must not run it.
//   node scripts/check-kybernos-office-text-live.mjs     (KB_HOST of the sandbox; KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { connect } from './cdp-lib.mjs'

const authority = process.env.KB_HOST
if (!authority || authority === '127.0.0.1:3080') { console.log('Run this against the sandbox (source scripts/sandbox/env.sh): it will not touch the real :3080.'); process.exit(2) }
const dshHome = process.env.DSH_HOME
if (!dshHome || !existsSync(join(dshHome, 'kybernos', 'kybernos-office', 'editors', 'text', 'app.js'))) { console.log('Build the editors first: node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-office-text-live')
mkdirSync(shotDir, { recursive: true })

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kb-office-text-')))
const ORDERS = '﻿name,qty\r\n"Smith, J",3\r\nJones,5\r\n'
const CONFIG = '{"a":1,"b":[true,false]}\n'
const NOTE = 'hello\n'
const BROKEN = 'name,qty\n"never closed,3\nJones,5\n'
const files = { orders: join(dir, 'orders.csv'), config: join(dir, 'config.json'), note: join(dir, 'note.txt'), broken: join(dir, 'broken.csv') }
writeFileSync(files.orders, ORDERS); writeFileSync(files.config, CONFIG); writeFileSync(files.note, NOTE); writeFileSync(files.broken, BROKEN)
const disk = (p) => readFileSync(p, 'utf8')

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
const typeKeys = async (text) => {
  for (const ch of text) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(25)
  }
}
const hook = (h) => `document.querySelector('[data-kb="${h}"]')`
const status = () => q(`(${hook('office-status')} || {}).textContent || ''`)
const saveEnabled = () => q(`!!${hook('office-save')} && !${hook('office-save')}.disabled`)
const pressWindow = async (h) => q(`${hook(h)}.click()`)
const closeWindow = async () => { await q(`(() => { const b = ${hook('office-close')}; if (b) b.click(); const c = document.querySelector('[data-kb="office-discard"]'); if (c) c.querySelector('.kyo-row').children[1].click() })()`); await sleep(400) }
const openIn = async (path, name) => {
  await q(`window.__KB_EDITORS__.forName(${JSON.stringify(name)}).open(${JSON.stringify(path)}, ${JSON.stringify(name)})`)
  await until(`!!${hook('office-frame')}`, 10000)
  await frameTarget(); await fq('location.reload()'); await sleep(1800)
}
const saved = async () => { await pressWindow('office-save'); return until(`/^Saved$/.test((${hook('office-status')} || {}).textContent || '')`, 15000) }

try {
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await sleep(9000)

  // ── declared to the core
  const reg = await q(`(() => { const r = window.__KB_EDITORS__; const f = (n) => { const e = r && r.forName(n); return e ? e.id + ':' + e.embeds(n) : 'none' }; return ['orders.csv', 'config.json', 'note.txt', 'data.tsv', 'a.yaml', 'notes.md', 'a.docx', 'a.pptx', 'a.rtf'].map(f).join(' ') })()`)
  check('the core hands text, JSON and CSV files to the plugin, and the viewer keeps its own preview of them (embeds false); .rtf and .pptx are still not taken', reg === 'office:false office:false office:false office:false office:false office:false office:true none none', JSON.stringify(reg))
  const st = await q(`fetch('/kybernos-office/status').then((r) => r.json())`)
  check('the host says the text editor is installed', st && st.ok && st.installed && st.installed.text === true, JSON.stringify(st))

  // ── a CSV: byte-order mark, CRLF, a quoted comma
  await openIn(files.orders, 'orders.csv')
  check('the window opens straight away: nothing a text editor would lose, nothing to ask', (await q(`!!${hook('office-frame')} && !${hook('office-gate')}`)) === true)
  check('the frame is sandboxed without allow-same-origin', (await q(`${hook('office-frame')}.getAttribute('sandbox')`)) === 'allow-scripts')
  check('the table is drawn: 3 rows of 2 cells, the quoted comma is one cell', (await until(`(() => { const r = [...document.querySelectorAll('.kytx-grid tr')].map((tr) => [...tr.querySelectorAll('input')].map((i) => i.value).join('|')); return r.join('/') === 'name|qty/Smith, J|3/Jones|5' })()`, 15000, true)) === true)
  check('it says what it is: 3 × 2, comma', /3 × 2/.test(String(await fq(`document.getElementById('tx-info').textContent`))) && /comma|virgule/.test(String(await fq(`document.getElementById('tx-info').textContent`))))
  check('the frame logged no error or CSP violation while loading', frameLogs().filter((l) => !/favicon/.test(l)).length === 0, JSON.stringify(frameLogs()))
  check('opened clean: No changes, Save off', /No changes/.test(await status()) && (await saveEnabled()) === false, await status())
  await page.shot(join(shotDir, '1-csv-table.png'))
  await fq(`(() => { const i = document.querySelector('input[data-r="1"][data-c="1"]'); i.focus(); i.select() })()`)
  await typeKeys('9')
  await sleep(500)
  check('typing in a cell makes Save available and says it is unsaved', (await saveEnabled()) === true && /Unsaved/.test(await status()), await status())
  check('the table says that saving writes the whole table again', /whole table|tout le tableau/.test(String(await fq(`document.getElementById('tx-hint').textContent`))))
  await saved()
  check('the cell changed and nothing else: byte-order mark, CRLF and the quoting are as they were', disk(files.orders) === '﻿name,qty\r\n"Smith, J",9\r\nJones,5\r\n', JSON.stringify(disk(files.orders)))
  await fq(`document.getElementById('tx-add-row').click()`)
  await fq(`(() => { const i = document.querySelector('input[data-r="2"][data-c="0"]'); i.focus(); i.select() })()`)
  await typeKeys('Lee')
  await fq(`(() => { const i = document.querySelector('input[data-r="2"][data-c="1"]'); i.focus(); i.select() })()`)
  await typeKeys('7')
  await sleep(400)
  check('+ Row adds a row under the chosen cell, typed into with the keyboard', (await fq(`[...document.querySelectorAll('.kytx-grid tr')].length`)) === 4 && (await fq(`document.querySelector('input[data-r="2"][data-c="0"]').value`)) === 'Lee')
  await page.shot(join(shotDir, '2-csv-edited.png'))
  await saved()
  check('the new row is in the file, with the same line ends', disk(files.orders) === '﻿name,qty\r\n"Smith, J",9\r\nLee,7\r\nJones,5\r\n', JSON.stringify(disk(files.orders)))
  await fq(`document.getElementById('tx-m-text').click()`)
  check('the Text view shows the file\'s text, nothing rewritten', (await fq(`document.getElementById('tx-text').value`)) === 'name,qty\n"Smith, J",9\nLee,7\nJones,5\n')
  await pressWindow('office-undo')
  await until(`/put back/.test((${hook('office-status')} || {}).textContent || '')`, 10000)
  check('Undo puts back the file as it was before the last save', disk(files.orders) === '﻿name,qty\r\n"Smith, J",9\r\nJones,5\r\n')
  await closeWindow()

  // ── JSON: valid, not valid with its place, Format
  await openIn(files.config, 'config.json')
  check('a JSON file opens as text (no table), saying it is valid', (await until(`!document.getElementById('tx-text').hidden && /Valid JSON|JSON valide/.test(document.getElementById('tx-info').textContent) && document.getElementById('tx-m-table') === null`, 15000, true)) === true)
  await fq(`(() => { const t = document.getElementById('tx-text'); t.focus(); t.setSelectionRange(t.value.length - 1, t.value.length - 1) })()`)
  await typeKeys(',')
  await sleep(500)
  const bad = await fq(`({ t: document.getElementById('tx-info').textContent, bad: document.getElementById('tx-info').classList.contains('bad'), fmt: document.getElementById('tx-format').disabled })`)
  check('a trailing comma makes it say « Not valid JSON », in red, with the line, and Format is off', bad && /Not valid JSON/.test(bad.t) && /line 1/.test(bad.t) && bad.bad === true && bad.fmt === true, JSON.stringify(bad))
  await page.shot(join(shotDir, '3-json-invalid.png'))
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(500)
  check('taking the comma away makes it valid again, and the file is not different from what is on disk: Save is off', /Valid JSON/.test(String(await fq(`document.getElementById('tx-info').textContent`))) && (await saveEnabled()) === false, await status())
  await fq(`document.getElementById('tx-format').click()`)
  await sleep(500)
  const pretty = await fq(`document.getElementById('tx-text').value`)
  check('Format writes the JSON with two-space indents and keeps the final newline', pretty === '{\n  "a": 1,\n  "b": [\n    true,\n    false\n  ]\n}\n', JSON.stringify(pretty))
  await saved()
  check('the file on disk is the formatted text', disk(files.config) === '{\n  "a": 1,\n  "b": [\n    true,\n    false\n  ]\n}\n', JSON.stringify(disk(files.config)))
  await closeWindow()

  // ── a plain text file
  await openIn(files.note, 'note.txt')
  check('a text file opens as text and counts its lines', (await until(`/1 line/.test(document.getElementById('tx-info').textContent)`, 15000, true)) === true)
  await fq(`(() => { const t = document.getElementById('tx-text'); t.focus(); t.setSelectionRange(5, 5) })()`)
  await typeKeys(' world')
  await sleep(400)
  await saved()
  check('only what was typed changed: the final newline is still there', disk(files.note) === 'hello world\n', JSON.stringify(disk(files.note)))
  await closeWindow()

  // ── a CSV that is not a table opens as text, and says why
  await openIn(files.broken, 'broken.csv')
  const why = await until(`!document.getElementById('tx-text').hidden && !document.getElementById('tx-hint').hidden`, 15000, true)
  check('an unclosed quote: the file opens as text, with the reason, and the Table view is off', why === true && /never closed|jamais refermé/.test(String(await fq(`document.getElementById('tx-hint').textContent`))) && (await fq(`document.getElementById('tx-m-table').disabled`)) === true)
  check('looking at it wrote nothing', disk(files.broken) === BROKEN)
  await page.shot(join(shotDir, '4-csv-not-a-table.png'))
  await closeWindow()
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 400))
} finally {
  try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
  await live.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
