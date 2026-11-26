#!/usr/bin/env node
// Hostile files opened from Creations on a real GUI (case J15-10): a corrupt .docx, a 50 MB .xlsx, a password-protected PDF, a .pptx, an empty file.
// For each file it records the message the person reads, and whether the editor and the page survive (a page that went blank, a spinner that never stops,
// a raw stack or an object printed as text are failures).
//
//   source scripts/sandbox/env.sh && node scripts/check-hostile-files-live.mjs --folder <a folder that is a workspace of the sandbox> [--shots <dir>] [--json <file>]
//   node scripts/check-hostile-files-live.mjs --folder <dir> --prepare-only      (only writes the files)
//
// The files are made by this script (nothing is stored); the 50 MB workbook is deleted again at the end (--keep to leave it). Needs the editors built into the
// sandbox (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME") and a folder the sandbox lists in Creations (a workspace of its own).
// Refuses :3080 and any home that is not a sandbox's. Exit code 0 = every file left the page alive, 1 = a file broke the page, 3 = wrong environment.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateRawSync, crc32 } from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as zipLite from '../packages/kybernos-office/zip-lite.mjs'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { docx, xlsx, pdf } from '../packages/kybernos-office/lib-test-files.mjs'

const args = process.argv.slice(2)
const arg = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : null)
const folder = arg('--folder')
const shots = arg('--shots')
const jsonOut = arg('--json')
const keep = args.includes('--keep')
const only = arg('--only')   // run the cases whose label starts with one of these (comma separated), e.g. --only 08,10
const prepareOnly = args.includes('--prepare-only')
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (folder === null) { console.error('usage: --folder <dir> (a workspace of the sandbox)'); process.exit(3) }
if (!prepareOnly && (host === '127.0.0.1:3080' || (process.env.DSH_HOME || '').indexOf('.kybernos-sandbox') < 0)) { console.error('○ inconclusive: this check needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the files ────────────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(folder, { recursive: true })
const put = (name, data) => { writeFileSync(join(folder, name), data); return join(folder, name) }

/** A zip with stored parts only (so the size is what we say it is). */
const zipStored = (parts) => {
  const locals = []; const centrals = []; let offset = 0; let i = 0
  for (const [name, data] of Object.entries(parts)) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    const nameBuf = Buffer.from(name, 'utf8'); const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, raw)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(raw.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42)
    centrals.push(c, nameBuf)
    offset += 30 + nameBuf.length + raw.length; i += 1
  }
  const dir = Buffer.concat(centrals); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(i, 8); end.writeUInt16LE(i, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

// A workbook the sheet editor's own engine wrote (so it is a real one), and the same package with a fat first sheet.
const dshHome = process.env.DSH_HOME || ''
const engineDir = join(dshHome, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@ironcalc', 'wasm-xlsx')
if (!existsSync(join(engineDir, 'wasm.js'))) { console.error('○ inconclusive: build the editors first (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME")'); process.exit(3) }
const engine = await import(pathToFileURL(join(engineDir, 'wasm.js')).href)
engine.initSync({ module: readFileSync(join(engineDir, 'wasm_bg.wasm')) })
const engineBook = () => {
  const m = new engine.Model('book', 'en', 'UTC', 'en')
  m.setUserInput(0, 1, 1, 'Total'); m.setUserInput(0, 1, 2, '42'); m.setUserInput(0, 2, 1, 'Double'); m.setUserInput(0, 2, 2, '=B1*2')
  return Buffer.from(m.toXlsx())
}
/** A valid workbook whose first sheet holds about `bytes` of rows (parts stored, not deflated: the file is as big as asked). */
const bigWorkbook = (bytes) => {
  const real = engineBook()
  const lp = zipLite.listParts(real)
  const parts = {}
  for (const name of lp.keys()) if (!name.endsWith('/')) parts[name] = zipLite.readPart(real, lp, name)
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>'
  const rows = []
  let size = head.length
  let r = 1
  while (size < bytes) {
    const row = `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}"><v>${(r * 37) % 1000}.25</v></c><c r="C${r}" t="s"><v>0</v></c></row>`
    rows.push(row); size += row.length; r += 1
  }
  parts['xl/worksheets/sheet1.xml'] = head + rows.join('') + '</sheetData></worksheet>'
  return { buf: zipStored(parts), rows: r - 1 }
}

/** A real PDF, encrypted with the standard security handler (V1 R2, RC4 40 bit), opened by the user password `secret`. */
const lockedPdf = (userPassword = 'secret') => {
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
  const md5 = (b) => createHash('md5').update(b).digest()
  const rc4 = (key, data) => {
    const s = Array.from({ length: 256 }, (_, i) => i); let j = 0
    for (let i = 0; i < 256; i += 1) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]] }
    const out = Buffer.alloc(data.length); let a = 0; let b = 0
    for (let n = 0; n < data.length; n += 1) { a = (a + 1) & 255; b = (b + s[a]) & 255; [s[a], s[b]] = [s[b], s[a]]; out[n] = data[n] ^ s[(s[a] + s[b]) & 255] }
    return out
  }
  const padded = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32)
  const id = md5(Buffer.from('kybernos-journey-locked'))
  const P = -44
  const pBuf = Buffer.alloc(4); pBuf.writeInt32LE(P)
  const O = rc4(md5(padded('owner-secret')).subarray(0, 5), padded(userPassword))
  const key = md5(Buffer.concat([padded(userPassword), O, pBuf, id])).subarray(0, 5)
  const U = rc4(key, PAD)
  const objKey = (num) => md5(Buffer.concat([key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])])).subarray(0, 10)
  const content = Buffer.from('BT /F1 14 Tf 20 100 Td (Secret page) Tj ET', 'latin1')
  const enc = rc4(objKey(4), content)
  const hex = (b) => '<' + b.toString('hex') + '>'
  const chunks = []
  let length = 0
  const emit = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); length += buf.length }
  const at = []
  const obj = (n, body) => { at[n] = length; emit(`${n} 0 obj\n`); emit(body); emit('\nendobj\n') }
  emit('%PDF-1.4\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')
  obj(4, Buffer.concat([Buffer.from(`<< /Length ${enc.length} >>\nstream\n`, 'latin1'), enc, Buffer.from('\nendstream', 'latin1')]))
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  obj(6, `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${P} /O ${hex(O)} /U ${hex(U)} >>`)
  const xref = length
  let table = 'xref\n0 7\n0000000000 65535 f \n'
  for (let n = 1; n <= 6; n += 1) table += String(at[n]).padStart(10, '0') + ' 00000 n \n'
  emit(table + `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(chunks)
}


/** A minimal but valid .pptx (one slide), written by hand so the check needs no other tool. */
const pptxFile = () => {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const parts = {
    '[Content_Types].xml': `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>`,
    '_rels/.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `${X}<p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${R}/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `${X}<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `${X}<p:sldLayout xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': `${X}<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>Quarterly plan</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  }
  return zipStored(parts)
}

const BIG = 50 * 1024 * 1024
const FILES = {}
const build = () => {
  const good = { docx: docx({ text: 'A readable report' }), xlsx: engineBook(), pdf: pdf({ text: 'Hello PDF' }) }
  FILES.goodDocx = put('control-good.docx', good.docx)
  FILES.goodXlsx = put('control-good.xlsx', good.xlsx)
  FILES.goodPdf = put('control-good.pdf', good.pdf)
  FILES.minimalStyles = put('hostile-minimal-styles.xlsx', xlsx({}))   // valid (officecli validates it) but its stylesheet has no <cellStyles>
  FILES.corruptDocx = put('hostile-corrupt.docx', good.docx.subarray(0, Math.floor(good.docx.length * 0.55)))   // the zip's central directory is gone
  FILES.garbageDocx = put('hostile-garbage.docx', Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) & 255)))
  FILES.emptyDocx = put('hostile-empty.docx', Buffer.alloc(0))
  FILES.emptyXlsx = put('hostile-empty.xlsx', Buffer.alloc(0))
  FILES.emptyPdf = put('hostile-empty.pdf', Buffer.alloc(0))
  FILES.emptyMd = put('hostile-empty.md', Buffer.alloc(0))
  const big = bigWorkbook(BIG)
  FILES.bigXlsx = put('hostile-50mb.xlsx', big.buf)
  FILES.bigRows = big.rows
  FILES.lockedPdf = put('hostile-locked.pdf', lockedPdf())
  FILES.pptx = put('hostile-plan.pptx', pptxFile())
}
build()
console.log('files written in ' + folder + ' (50 MB workbook: ' + statSync(FILES.bigXlsx).size + ' bytes, ' + FILES.bigRows + ' rows)')
if (prepareOnly) process.exit(0)


// ── the GUI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const { connect } = await import('./cdp-lib.mjs')
const live = await openLivePage({ width: 1360, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const jsErrors = []
const exText = (p) => String((p.exceptionDetails && ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)) || '').slice(0, 240)
page.on('Runtime.exceptionThrown', (p) => jsErrors.push('page: ' + exText(p)))
await page.send('Runtime.enable', {})
const debugBase = 'http://' + new URL(page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
let frameConn = null
let frameId = ''
const frameTarget = async () => {
  try {
    const list = await (await fetch(debugBase + '/json/list')).json()
    const t = list.find((x) => /\/kybernos-office\/v\//.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
    if (!t) return null
    if (frameConn === null || frameId !== t.id) {
      try { if (frameConn) frameConn.close() } catch (e) { /* gone */ }
      frameConn = await connect(t); frameId = t.id
      await frameConn.send('Runtime.enable', {})
      frameConn.on('Runtime.exceptionThrown', (p) => jsErrors.push('frame: ' + exText(p)))
    }
    return frameConn
  } catch (e) { return null }
}
/** What the editor's own frame says (its text), or a note that it did not answer: a frozen frame is a finding. */
const frameText = async () => {
  const c = await frameTarget()
  if (c === null) return null
  const r = await Promise.race([c.evalJs('(document.body ? document.body.innerText : "").slice(0, 400)', 4000), sleep(4500).then(() => ({ err: 'the frame did not answer in 4.5 s' }))])
  return r.err ? '(' + r.err + ')' : r.val
}

const search = async (text) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await val(`(() => { const b = document.querySelector('[data-kb="toggle-search"]'); if (b) b.click() })()`)
    await sleep(400)
    await val(`(() => { const i = document.querySelector('.kb6-tb-search input'); if (i) { i.focus(); i.select() } })()`)
    await page.send('Input.insertText', { text })
    await sleep(900)
    if ((await val(`(document.querySelector('.kb6-tb-search input') || {}).value`)) === text) return true
  }
  return false
}
const cardPoint = (name) => val(`(() => { const c = [...document.querySelectorAll('.kb6-card')].find((x) => (x.innerText || '').indexOf(${JSON.stringify(name)}) >= 0); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height * 0.65 }) })()`)
const POPUP = `(() => {
  const q = (k) => document.querySelector('[data-kb="' + k + '"]')
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const pop = q('art-popup'); const note = q('office-notice'); const status = q('office-status'); const frame = q('office-frame')
  const cls = (e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)
  const spin = pop ? [...pop.querySelectorAll('*')].filter((e) => /spin|loader|loading|progress/i.test(cls(e)) && vis(e)).length : 0
  const anim = pop ? pop.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length : 0
  const fr = frame ? frame.getBoundingClientRect() : null
  const buttons = ['office-edit', 'office-save', 'office-copy', 'office-undo'].map((k) => { const b = q(k); return b ? k.replace('office-', '') + (b.hidden ? ':hidden' : (b.disabled ? ':off' : ':on')) : null }).filter(Boolean).join(' ')
  return JSON.stringify({ buttons, popup: !!pop && vis(pop), status: status ? status.innerText.trim() : null, notice: note && vis(note) ? note.innerText.trim() : null,
    pane: pop ? pop.innerText.replace(/\\s+/g, ' ').slice(0, 600) : null, frame: !!frame, frameBox: fr ? [Math.round(fr.width), Math.round(fr.height)] : null,
    spinners: spin, infiniteAnimations: anim, bodyLen: document.body.innerText.length, cards: document.querySelectorAll('.kb6-card').length })
})()`
const popupState = async () => { const r = await val(POPUP, 8000); if (typeof r !== 'string') return { error: JSON.stringify(r) }; return JSON.parse(r) }
const closePopup = async () => { await val(`(() => { const b = document.querySelector('[data-kb="art-popup-close"]'); if (b) b.click() })()`); await sleep(600) }
const RAW = /\bat [\w.<>$ ]+ \(|\bat file:|TypeError|ReferenceError|RangeError|SyntaxError|\[object |\bundefined\b|\bNaN\b|Unexpected token|ENOENT|Error: |\bnull\b/

const results = []
const settledWord = /Opening…|Ouverture…|Loading|Chargement/
/** Opens one file from Creations like a person (search it, press its card) and watches the popup until it settles or `maxMs` pass. */
const play = async (label, name, { maxMs = 30000, then = null } = {}) => {
  if (only !== null && !only.split(',').some((o) => label.startsWith(o))) return null
  const rec = { label, file: name, bytes: statSync(join(folder, name)).size, timeline: [] }
  const errBefore = jsErrors.length
  await search(name)
  let p0 = await cardPoint(name)
  for (let i = 0; i < 8 && typeof p0 !== 'string'; i += 1) { await sleep(1000); p0 = await cardPoint(name) }   // the list of files arrives a moment after the page
  if (typeof p0 !== 'string') {
    rec.error = 'no card for ' + name + ' in Creations; the field holds ' + JSON.stringify(await val(`(document.querySelector('.kb6-tb-search input') || {}).value`)) + ', the cards are ' + (await val(`JSON.stringify([...document.querySelectorAll('.kb6-card')].map((c) => (c.innerText || '').split('\\n')[0]))`))
    console.log(label.padEnd(20), '|', rec.error)
    results.push(rec); return rec
  }
  const p = JSON.parse(p0)
  const t0 = Date.now()
  await mouse(p.x, p.y)
  let prev = ''; let stable = 0
  while (Date.now() - t0 < maxMs) {
    await sleep(Date.now() - t0 < 10000 ? 1000 : 3000)
    const s = await popupState()
    const fingerprint = JSON.stringify([s.status, s.notice, s.frame, s.pane])
    rec.timeline.push({ t: Math.round((Date.now() - t0) / 1000), status: s.status, notice: s.notice, frame: s.frame, spinners: s.spinners, bodyLen: s.bodyLen, error: s.error })
    stable = fingerprint === prev ? stable + 1 : 0
    prev = fingerprint
    if (stable >= 3 && !settledWord.test(String(s.status))) break
  }
  const s = await popupState()
  rec.settledAfterS = Math.round((Date.now() - t0) / 1000)
  rec.final = s
  rec.frameText = await frameText()
  if (then !== null) { try { rec.then = await then(rec) } catch (e) { rec.then = { error: String(e && e.message || e) } } }
  const said = [s.status, s.notice, s.frame ? rec.frameText : null, s.pane].filter((x) => typeof x === 'string').join(' | ')
  rec.rawLooking = RAW.test(said) ? said.match(RAW)[0] : null
  rec.stuck = settledWord.test(String(s.status)) || (s.spinners > 0 && s.infiniteAnimations > 0)
  rec.pageAlive = typeof s.bodyLen === 'number' && s.bodyLen > 200
  if (shots) { try { mkdirSync(shots, { recursive: true }); await page.shot(join(shots, label + '.png')) } catch (e) { /* no shot */ } }
  // the page must still answer, and the popup must close
  await closePopup()
  const after = await popupState()
  rec.afterClose = { popupGone: after.popup === false, cards: after.cards, bodyLen: after.bodyLen }
  rec.newExceptions = jsErrors.slice(errBefore)
  console.log(label.padEnd(20), '| status:', JSON.stringify(s.status), '| buttons:', s.buttons, '| notice:', JSON.stringify(s.notice), '| frame:', s.frame, '| t=' + rec.settledAfterS + 's', '| stuck:', rec.stuck, '| raw:', rec.rawLooking, '| page alive:', rec.pageAlive)
  results.push(rec)
  return rec
}

/** On the 50 MB workbook: press Edit, type into a cell with real key events, Save, and say how long it took and what the file on disk became. */
const key = async (k) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k }) }
const typeKeys = async (text) => { for (const ch of text) { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(25) } }
const hook = (h) => `document.querySelector('[data-kb="${h}"]')`
async function bigEdit () {
  const out = {}
  const sizeBefore = statSync(join(folder, 'hostile-50mb.xlsx')).size
  await val(`${hook('office-edit')}.click()`)
  const t0 = Date.now()
  await sleep(1500)
  // the editor replaces the read-only frame: wait for its status to leave « Read only »
  for (let i = 0; i < 40; i += 1) { const st = await val(`(${hook('office-status')} || {}).textContent`); if (st !== 'Read only') { out.afterEditStatus = st; break }; await sleep(1000) }
  out.editorReadyAfterS = Math.round((Date.now() - t0) / 1000)
  await sleep(4000)
  const box = JSON.parse(await val(`(() => { const r = ${hook('office-frame')}.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top }) })()`))
  await mouse(box.x + 75, box.y + 121); await typeKeys('777'); await key('Enter'); await sleep(1500)
  out.statusAfterTyping = await val(`(${hook('office-status')} || {}).textContent`)
  out.saveEnabled = await val(`!${hook('office-save')}.disabled`)
  const t1 = Date.now()
  await val(`${hook('office-save')}.click()`)
  for (let i = 0; i < 120; i += 1) { const st = await val(`(${hook('office-status')} || {}).textContent`); out.statusAfterSave = st; if (st === 'Saved' || /problem|changed|did not|invalid|larger|expired/i.test(String(st))) break; await sleep(1000) }
  out.saveTookS = Math.round((Date.now() - t1) / 1000)
  out.sizeBefore = sizeBefore
  out.sizeAfter = statSync(join(folder, 'hostile-50mb.xlsx')).size
  if (out.statusAfterSave === 'Saved') { await val(`${hook('office-undo')}.click()`); await sleep(4000); out.sizeAfterUndo = statSync(join(folder, 'hostile-50mb.xlsx')).size; out.statusAfterUndo = await val(`(${hook('office-status')} || {}).textContent`) }
  return out
}

// The PDF viewer draws inside shadow roots: look through them.
const DEEP = `const deepAll = (root, out = []) => { for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) deepAll(e.shadowRoot, out) } return out }; const deepText = () => deepAll(document).filter((e) => e.children.length === 0 && !/^(STYLE|SCRIPT|PATH|SVG)$/i.test(e.tagName) && (e.textContent || '').trim() !== '' && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()).join(' | ').slice(0, 500)`
/** The password-protected PDF: wrong password, then the right one (the password is the one this script wrote into the file, `secret`). */
async function lockedFlow () {
  const out = {}
  const where = async (js) => { const c = await frameTarget(); if (c === null) return null; const r = await c.evalJs(js, 5000); if (r.err || typeof r.val !== 'string') return null; const f = JSON.parse(await val(`(() => { const r = ${hook('office-frame')}.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top }) })()`)); const p = JSON.parse(r.val); return { x: f.x + p.x, y: f.y + p.y } }
  const pt = (sel, text) => `(() => { ${DEEP}; const els = deepAll(document).filter((x) => x.matches(${JSON.stringify(sel)})); const e = ${text === undefined ? 'els[0]' : `els.find((x) => (x.textContent || '').trim() === ${JSON.stringify(text)})`}; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`
  const frameSays = async () => String((await (await frameTarget()).evalJs(`(() => { ${DEEP}; return deepText() })()`, 5000)).val)
  out.dialog = await frameSays()
  const input = await where(pt('input[type="password"], input[placeholder*="assword"]'))
  const open = await where(pt('button', 'Open'))
  if (input === null || open === null) { out.error = 'the dialog has no password field or no Open button'; return out }
  await mouse(input.x, input.y); await typeKeys('nope'); await sleep(300)
  out.openEnabledAfterTyping = (await (await frameTarget()).evalJs(`(() => { ${DEEP}; const b = deepAll(document).find((x) => x.tagName === 'BUTTON' && (x.textContent || '').trim() === 'Open'); return !!b && !b.disabled })()`, 4000)).val
  await mouse(open.x, open.y); await sleep(2500)
  out.afterWrongPassword = await frameSays()
  const input2 = await where(pt('input[type="password"], input[placeholder*="assword"]'))
  if (input2 !== null) {
    await mouse(input2.x, input2.y)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
    await typeKeys('secret'); await sleep(300)
    const open2 = await where(pt('button', 'Open'))
    if (open2 !== null) { await mouse(open2.x, open2.y); await sleep(4000) }
  }
  out.afterRightPassword = await frameSays()
  out.canvas = (await (await frameTarget()).evalJs(`(() => { ${DEEP}; return deepAll(document).filter((x) => x.tagName === 'CANVAS').length })()`, 4000)).val
  return out
}
async function cancelFlow () {
  const out = {}
  const c = await frameTarget()
  const r = (await c.evalJs(`(() => { ${DEEP}; const b = deepAll(document).find((x) => x.tagName === 'BUTTON' && (x.textContent || '').trim() === 'Cancel'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`, 4000)).val
  if (typeof r !== 'string') { out.error = 'no Cancel button'; return out }
  const f = JSON.parse(await val(`(() => { const r = ${hook('office-frame')}.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top }) })()`)); const p = JSON.parse(r)
  await mouse(f.x + p.x, f.y + p.y); await sleep(2000)
  out.afterCancel = String((await c.evalJs(`(() => { ${DEEP}; return deepText() })()`, 5000)).val)
  out.frameBoxAfterCancel = await val(`(() => { const r = ${hook('office-frame')}.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })()`)
  out.statusAfterCancel = await val(`(${hook('office-status')} || {}).textContent`)
  return out
}

let verdictOk = true
try {
  await sleep(3000)
  await clickText(live.page, 'Creations')
  await waitFor(page, `!!document.querySelector('[data-kb="toggle-search"]')`, 20000)
  await sleep(1500)
  await play('00-control-xlsx', 'control-good.xlsx', { maxMs: 20000 })    // the baseline: a good workbook opens before any hostile file
  await play('01-control-docx', 'control-good.docx', { maxMs: 20000 })
  await play('02-corrupt-docx', 'hostile-corrupt.docx')
  await play('03-garbage-docx', 'hostile-garbage.docx')
  await play('04-empty-docx', 'hostile-empty.docx')
  await play('05-empty-xlsx', 'hostile-empty.xlsx')
  await play('06-empty-pdf', 'hostile-empty.pdf')
  await play('07-empty-md', 'hostile-empty.md')
  await play('08-locked-pdf', 'hostile-locked.pdf', { then: lockedFlow })
  await play('08b-locked-pdf-cancel', 'hostile-locked.pdf', { then: cancelFlow })
  await play('09-pptx', 'hostile-plan.pptx')
  await play('09b-minimal-styles-xlsx', 'hostile-minimal-styles.xlsx')
  await play('10-big-xlsx', 'hostile-50mb.xlsx', { maxMs: 150000, then: bigEdit })
  await play('11-control-xlsx-after', 'control-good.xlsx', { maxMs: 20000 })   // does the editor still work after the big one?
  await play('11b-control-docx-after', 'control-good.docx', { maxMs: 20000 })  // and the document editor?
  // a person reloads the page: the workbook editor must be back
  await page.send('Page.reload', {})
  await sleep(6000)
  await clickText(live.page, 'Creations')
  await waitFor(page, `!!document.querySelector('[data-kb="toggle-search"]')`, 20000)
  await sleep(1500)
  await play('12-control-xlsx-reloaded', 'control-good.xlsx', { maxMs: 20000 })
  for (const r of results) if (r.error !== undefined || r.pageAlive === false || r.afterClose.popupGone === false || r.stuck === true) verdictOk = false
  const bad = results.filter((r) => /^(00|01|11|11b|12)-/.test(r.label) && /problem|not a real/i.test(String(r.final && r.final.status)))
  if (bad.length > 0) { verdictOk = false; console.log('a good file did not open: ' + bad.map((r) => r.label + ' (' + r.final.status + ')').join(', ')) }
} catch (e) {
  console.log('the check stopped: ' + (e && e.message ? e.message : e)); verdictOk = false
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ results, jsErrors }, null, 1))
  await live.close()
  if (!keep) rmSync(join(folder, 'hostile-50mb.xlsx'), { force: true })
}
console.log('\n' + (verdictOk ? 'every file left the page alive' : 'a file left the page broken, stuck or without an answer (see above)') + (jsErrors.length ? ' | uncaught exceptions: ' + jsErrors.length : ''))
process.exit(verdictOk ? 0 : 1)
