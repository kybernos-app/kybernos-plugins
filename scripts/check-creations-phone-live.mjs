#!/usr/bin/env node
// Creations at a phone width (case J15-13): at 390 x 844, open one of each type (a document, a sheet, a deck, a mockup, a PDF) from the Creations page, edit it where
// the editor allows it, press Share (and look: nothing is confirmed, nothing leaves the machine), and say what a person sees: where each control sits, what does not fit.
// It measures; the lead decides what is a defect. The phone APP (the native one) is not played here, only the page at that width.
//
//   source scripts/sandbox/env.sh && node scripts/check-creations-phone-live.mjs --folder <a folder that is a workspace of the sandbox> --out <dir>
//
// Needs the editors built into the sandbox (node packages/kybernos-office/build-editors.mjs --home "$DSH_HOME"), the Maquettes plugin on, and a folder the sandbox lists in Creations (a
// workspace of its own). It writes its own small files there (a document, a workbook, a PDF, a deck, a mockup folder) and registers the mockup folder with the Maquettes plugin of
// the sandbox, which it takes out again. Refuses :3080 and any home that is not a sandbox's. Exit code 0 (it measures), 3 = wrong environment.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openLivePage, clickText, waitFor } from './live-page.mjs'
import { connect } from './cdp-lib.mjs'
import { docx, pdf as miniPdf } from '../packages/kybernos-office/lib-test-files.mjs'
import { createHost } from '../packages/kybernos-office/office-host.mjs'
import { buildDeck, normalize } from '../packages/kybernos-office/deck-build.mjs'
import { fixtures } from '../packages/kybernos-maquettes/lib-fixtures.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const folder = argOf('--folder', null)
const OUT = argOf('--out', null)
const W = Number(argOf('--width', '390')); const H = Number(argOf('--height', '844'))
const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080' || home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }
if (folder === null || OUT === null) { console.error('usage: --folder <workspace folder> --out <dir>'); process.exit(3) }
if (!existsSync(join(home, 'kybernos', 'kybernos-office', 'editors', 'manifest.json'))) { console.error('○ inconclusive: build the editors first'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
mkdirSync(folder, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the files ────────────────────────────────────────────────────────────────────────────────────────────────────
const engineDir = join(home, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@ironcalc', 'wasm-xlsx')
const engine = await import(pathToFileURL(join(engineDir, 'wasm.js')).href)
engine.initSync({ module: readFileSync(join(engineDir, 'wasm_bg.wasm')) })
const book = () => { const m = new engine.Model('book', 'en', 'UTC', 'en'); m.setUserInput(0, 1, 1, 'Total'); m.setUserInput(0, 1, 2, '42'); m.setUserInput(0, 2, 1, 'Double'); m.setUserInput(0, 2, 2, '=B1*2'); return Buffer.from(m.toXlsx()) }
const oh = createHost({ fs: fsp, home })
const assets = await oh.deckAssets()
if (!assets.ok) { console.error('○ inconclusive: the deck editor is not installed'); process.exit(3) }
const seen = normalize({ title: 'Phone deck', language: 'en', slides: [
  { layout: 'cover', title: 'Phone deck', subtitle: 'Made for the phone check' },
  { layout: 'bullets', title: 'Three points', bullets: ['First point', 'Second point', 'Third point'] },
] })
if (!seen.ok) { console.error('○ inconclusive: ' + seen.error); process.exit(3) }
const deck = buildDeck(seen.deck, { css: assets.css, js: assets.js })
if (!deck.ok) { console.error('○ inconclusive: ' + deck.error); process.exit(3) }
const pdfSource = join(home, 'kybernos', 'kybernos-office', 'build', 'node_modules', '@embedpdf', 'snippet', 'dist', 'demo.pdf')
const names = { doc: 'phone-report.docx', sheet: 'phone-budget.xlsx', deck: 'phone-deck.deck.html', pdf: 'phone-manual.pdf', note: 'phone-notes.md' }
writeFileSync(join(folder, names.doc), docx({ text: 'Quarterly report for the phone check' }))
writeFileSync(join(folder, names.sheet), book())
writeFileSync(join(folder, names.deck), deck.html)
writeFileSync(join(folder, names.pdf), existsSync(pdfSource) ? readFileSync(pdfSource) : miniPdf({ text: 'Phone manual' }))
writeFileSync(join(folder, names.note), '# Phone notes\n\nA short note.\n\n- one\n- two\n')
const mockDir = join(folder, 'phone-mockup')
mkdirSync(mockDir, { recursive: true })
for (const [n, t] of Object.entries(fixtures().creator)) writeFileSync(join(mockDir, n), t)

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: W, height: H }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true })
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
const jsErrors = []
page.on('Runtime.exceptionThrown', (p) => jsErrors.push('page: ' + String((p.exceptionDetails && ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)) || '').slice(0, 200)))
await page.send('Runtime.enable', {})
const tap = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const typeKeys = async (text) => { for (const ch of text) { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(25) } }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: vk || 0 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k, windowsVirtualKeyCode: vk || 0 }) }
const debugBase = 'http://' + new URL(page.info.webSocketDebuggerUrl.replace(/^ws/, 'http')).host
let frameConn = null; let frameId = ''
const frameTarget = async (re) => {
  try {
    const list = await (await fetch(debugBase + '/json/list')).json()
    const t = list.find((x) => re.test(x.url) && x.type !== 'page' && x.type !== 'service_worker')
    if (!t) return null
    if (frameConn === null || frameId !== t.id) { try { if (frameConn) frameConn.close() } catch (e) { /* gone */ } frameConn = await connect(t); frameId = t.id; await frameConn.send('Runtime.enable', {}) }
    return frameConn
  } catch (e) { return null }
}
const fq = async (re, js, ms = 8000) => { const c = await frameTarget(re); if (c === null) return { __err: 'no frame target' }; const r = await c.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }

/** The geometry of what a person has on screen: the viewer popup, its header buttons, the editor's bar and frame, and whatever falls outside the window. */
const GEOM = `(() => {
  const vw = innerWidth; const vh = innerHeight
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.hidden }
  const lab = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('data-kb') || '').replace(/\\s+/g, ' ').trim().slice(0, 28)
  const pop = document.querySelector('[data-kb="art-popup"]')
  const buttons = pop ? [...pop.querySelectorAll('button, a[href], [role=button], select, input')].filter(vis).map((b) => ({ n: lab(b), r: rect(b), kb: b.getAttribute('data-kb') })) : []
  const outside = buttons.filter((b) => b.r[0] < -1 || b.r[0] + b.r[2] > vw + 1 || b.r[1] < -1 || b.r[1] + b.r[3] > vh + 1)
  const small = buttons.filter((b) => b.r[2] < 24 || b.r[3] < 24)
  const status = document.querySelector('[data-kb="office-status"]')
  const frame = document.querySelector('[data-kb="office-frame"], [data-kb="maquettes-frame"]')
  const at = (x, y) => { let e = document.elementFromPoint(x, y); while (e && pop && e.parentElement !== pop && e !== pop) e = e.parentElement; return e }
  const cardEl = pop ? at(24, Math.round(vh / 2)) : null
  const cs = cardEl && cardEl !== pop ? getComputedStyle(cardEl) : null
  const behind = pop ? document.elementFromPoint(vw - 8, Math.round(vh / 2)) : null
  const card = cardEl && cardEl !== pop ? { rect: rect(cardEl), width: cs.width, maxWidth: cs.maxWidth, minWidth: cs.minWidth, position: cs.position, sharePct: Math.round(cardEl.getBoundingClientRect().width / vw * 100), rightEdgeInCard: !!(behind && cardEl.contains(behind)), rightEdgeEl: behind ? behind.tagName + '.' + String(behind.className).slice(0, 30) : null } : null
  return JSON.stringify({ vw, vh, card, docW: document.scrollingElement.scrollWidth, hOverflow: document.scrollingElement.scrollWidth > vw + 1, popup: rect(pop), frame: rect(frame), status: status ? status.innerText.trim() : null, statusRect: rect(status), buttons: buttons.length, outside, small: small.length, smallest: small.slice(0, 6), buttonList: buttons.map((b) => b.n + ' ' + b.r.join('x')).slice(0, 14) })
})()`
const geom = async () => { const r = await val(GEOM); return typeof r === 'string' ? JSON.parse(r) : { error: JSON.stringify(r) } }
const shot = async (name) => { try { await page.shot(join(OUT, 'shots', name + '.png')) } catch (e) { /* no shot */ } }

const results = {}
const search = async (text) => {
  for (let i = 0; i < 3; i += 1) {
    await val(`(() => { const b = document.querySelector('[data-kb="toggle-search"]'); if (b) b.click() })()`)
    await sleep(400)
    await val(`(() => { const i = document.querySelector('.kb6-tb-search input'); if (i) { i.focus(); i.select() } })()`)
    await page.send('Input.insertText', { text })
    await sleep(900)
    if ((await val(`(document.querySelector('.kb6-tb-search input') || {}).value`)) === text) return true
  }
  return false
}
const cardPoint = (name) => val(`(() => { const c = [...document.querySelectorAll('.kb6-card, .kb6-row, [data-art-id]')].find((x) => (x.innerText || '').indexOf(${JSON.stringify(name)}) >= 0); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height * 0.65, w: Math.round(r.width), h: Math.round(r.height) }) })()`)
const status = () => val(`(document.querySelector('[data-kb="office-status"]') || {}).textContent || ''`)
const closePopup = async () => { await val(`(() => { const b = document.querySelector('[data-kb="art-popup-close"]'); if (b) b.click() })()`); await sleep(500); const discard = await val(`(() => { const d = document.querySelector('[data-kb="office-discard"]'); if (!d) return false; d.querySelector('.kyo-row').children[1].click(); return true })()`); if (discard === true) await sleep(500) }

const openCard = async (key, name) => {
  const rec = { file: name, steps: [] }
  results[key] = rec
  if ((await val(`!!document.querySelector('[data-kb="toggle-search"]')`)) !== true) { rec.listLostBefore = true; await drawer() }
  await search(name)
  let p0 = await cardPoint(name)
  for (let i = 0; i < 8 && typeof p0 !== 'string'; i += 1) { await sleep(1000); p0 = await cardPoint(name) }
  if (typeof p0 !== 'string') { rec.error = 'no card for ' + name; return rec }
  const p = JSON.parse(p0)
  rec.card = { w: p.w, h: p.h }
  await tap(p.x, p.y)
  for (let i = 0; i < 20; i += 1) { await sleep(700); if ((await val(`!!document.querySelector('[data-kb="art-popup"]')`)) === true) break }
  await sleep(3500)
  rec.opened = await geom()
  await shot(key + '-1-opened')
  return rec
}

let editFrameRe = /\/kybernos-office\/v\//
const edit = async (key, how) => {
  const rec = results[key]
  const hasEdit = await val(`(() => { const b = document.querySelector('[data-kb="office-edit"]'); return !!b && !b.hidden && !b.disabled })()`)
  rec.editOffered = hasEdit === true
  if (hasEdit !== true) return
  await val(`document.querySelector('[data-kb="office-edit"]').click()`)
  await sleep(4500)
  const box = JSON.parse((await val(`(() => { const r = document.querySelector('[data-kb="office-frame"]').getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }) })()`)))
  let at = null
  if (how === 'doc') at = { x: box.x + box.w / 2, y: box.y + box.h * 0.45 }
  if (how === 'sheet') at = { x: box.x + 75, y: box.y + 121 }
  if (how === 'deck') { const c = await fq(editFrameRe, "(() => { const e = document.querySelector('.cell.cur h1'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()"); if (c && typeof c.x === 'number') at = { x: box.x + c.x, y: box.y + c.y } }
  rec.afterEdit = await geom()
  await shot(key + '-2-edit-mode')
  if (at === null) { rec.typing = 'no place to click found in the frame'; return }
  await tap(at.x, at.y); await sleep(500)
  if (how === 'deck') { await key_('End', 35) }
  await typeKeys(how === 'sheet' ? 'Phone' : ' EDITED'); if (how === 'sheet') await key_('Enter', 13)
  await sleep(1200)
  rec.statusAfterTyping = await status()
  rec.saveEnabled = await val(`!!document.querySelector('[data-kb="office-save"]') && !document.querySelector('[data-kb="office-save"]').disabled`)
  rec.afterTyping = await geom()
  await shot(key + '-3-typed')
  if (rec.saveEnabled === true) {
    await val(`document.querySelector('[data-kb="office-save"]').click()`)
    for (let i = 0; i < 20; i += 1) { await sleep(700); const s = await status(); if (/Saved|changed|problem|did not/i.test(s)) break }
    rec.statusAfterSave = await status()
    await shot(key + '-4-saved')
  }
}
const key_ = (k, vk) => key(k, k, vk)
// « Full page » (the expand icon of the popup): what the phone gets once the viewer takes the whole window
const fullPage = async (key) => {
  const rec = results[key]
  const present = await val(`!!document.querySelector('[data-kb="art-popup-full"]')`)
  rec.fullOffered = present === true
  if (present !== true) return
  rec.fullButtonBefore = await val(`(() => { const b = document.querySelector('[data-kb="art-popup-full"]'); const s = getComputedStyle(b); const svg = b.querySelector('svg'); return JSON.stringify({ pressed: b.getAttribute('aria-pressed'), bg: s.backgroundColor, color: s.color, svgStroke: svg ? getComputedStyle(svg).stroke : null }) })()`)
  await val(`document.querySelector('[data-kb="art-popup-full"]').click()`)
  await sleep(2500)
  rec.full = await geom()
  rec.fullButtonAfter = await val(`(() => { const b = document.querySelector('[data-kb="art-popup-full"]'); if (!b) return null; const s = getComputedStyle(b); const svg = b.querySelector('svg'); const r = b.getBoundingClientRect(); return JSON.stringify({ pressed: b.getAttribute('aria-pressed'), bg: s.backgroundColor, color: s.color, svgStroke: svg ? getComputedStyle(svg).stroke : null, svgFill: svg ? getComputedStyle(svg).fill : null, hasSvg: !!svg, text: (b.innerText || '').trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }) })()`)
  rec.fullTitle = await val(`(() => { const p = document.querySelector('[data-kb="art-popup"]'); const t = p && [...p.querySelectorAll('*')].find((e) => e.children.length === 0 && /^phone-/.test((e.textContent || '').trim().replace('…', '')) ); return t ? JSON.stringify({ text: t.textContent, w: Math.round(t.getBoundingClientRect().width), scrollW: t.scrollWidth, clientW: t.clientWidth }) : null })()`)
  await shot(key + '-6-full')
  // back to the list: the close button of the popup (what a person presses), then the list must be there
  await val(`(() => { const b = document.querySelector('[data-kb="art-popup-close"]'); if (b) b.click() })()`); await sleep(900)
  rec.afterFullClose = await val(`JSON.stringify({ popup: !!document.querySelector('[data-kb="art-popup"]'), list: !!document.querySelector('[data-kb="toggle-search"]'), search: !!document.querySelector('.kb6-tb-search input'), head: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) })`)
}
const share = async (key) => {
  const rec = results[key]
  const present = await val(`!!document.querySelector('[data-kb="art-popup-share"]')`)
  rec.shareOffered = present === true
  if (present !== true) return
  await val(`document.querySelector('[data-kb="art-popup-share"]').click()`)
  await sleep(1500)
  rec.share = await val(`(() => {
    const vw = innerWidth; const vh = innerHeight
    const cand = [...document.querySelectorAll('[role="dialog"], [role="menu"], [class*="popover"], [class*="share"], [data-kb*="share"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20 && getComputedStyle(e).visibility !== 'hidden' })
    const top = cand.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]
    if (!top) return JSON.stringify({ opened: false })
    const r = top.getBoundingClientRect()
    return JSON.stringify({ opened: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], insideWindow: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1, text: (top.innerText || '').replace(/\\s+/g, ' ').slice(0, 400), buttons: [...top.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 30)) })
  })()`)
  try { rec.share = JSON.parse(rec.share) } catch (e) { /* as is */ }
  await shot(key + '-5-share')
  // nothing is confirmed: Escape, then check the popup is still the file's
  await key_('Escape', 27); await sleep(500)
}

const drawer = async () => {
  if ((await clickText(page, 'Creations')) !== true) { await val(`(() => { const b = document.querySelector('button[aria-label*="sidebar" i]'); if (b) b.click() })()`); await sleep(700); await clickText(page, 'Creations') }
  await waitFor(page, `!!document.querySelector('[data-kb="toggle-search"]')`, 20000)
  await sleep(1500)
}

let registered = false
try {
  await sleep(4000)
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
  results.viewport = { innerWidth: await val('innerWidth'), innerHeight: await val('innerHeight'), dpr: await val('devicePixelRatio'), maxTouch: await val('navigator.maxTouchPoints') }
  // the mockup folder goes to the Maquettes plugin of the sandbox, from the page itself (same origin, the session cookie)
  const add = await val(`fetch('/kybernos-maquettes/folders/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(mockDir)} }) }).then((r) => r.status + ' ' + r.statusText)`)
  results.mockupFolderAdded = add
  registered = /^200/.test(String(add))
  await drawer()
  await shot('0-creations-list')
  results.list = await geom()

  await openCard('document', names.doc); await edit('document', 'doc'); await share('document'); await fullPage('document'); await closePopup()
  await openCard('sheet', names.sheet); await edit('sheet', 'sheet'); await share('sheet'); await fullPage('sheet'); await closePopup()
  await openCard('deck', names.deck); await edit('deck', 'deck'); await share('deck'); await fullPage('deck'); await closePopup()
  await openCard('pdf', names.pdf); await edit('pdf', 'pdf'); await share('pdf'); await fullPage('pdf'); await closePopup()
  await openCard('note', names.note); await edit('note', 'doc'); await share('note'); await fullPage('note'); await closePopup()
  // the mockup is a source of its own: its tile (the type strip scrolls sideways at this width, so the tile is brought into view first), its card, its page, its editor
  await search('')
  results.mockup = { steps: [] }
  const tilePoint = () => val(`(() => { const t = [...document.querySelectorAll('[data-kb="type-tiles"] .kb-type-lab')].find((x) => /^(Mockups|Maquettes)$/.test(x.textContent)); if (!t) return null; const r = t.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, inWindow: r.left >= 0 && r.right <= innerWidth }) })()`)
  const first = await tilePoint()
  if (typeof first === 'string') {
    results.mockup.tileFirstPoint = JSON.parse(first)
    await val(`(() => { const t = [...document.querySelectorAll('[data-kb="type-tiles"] .kb-type-lab')].find((x) => /^(Mockups|Maquettes)$/.test(x.textContent)); t.scrollIntoView({ inline: 'center', block: 'nearest' }) })()`)
    await sleep(700)
    const t = JSON.parse(await tilePoint())
    await tap(t.x, t.y); await sleep(1800)
    results.mockup.tile = await val(`(() => { const t = [...document.querySelectorAll('[data-kb="type-tiles"] .kb-type-lab')].find((x) => /^(Mockups|Maquettes)$/.test(x.textContent)); return t ? t.parentElement.innerText.replace(/\\s+/g, ' ') : null })()`)
    results.mockup.cards = await val(`JSON.stringify([...document.querySelectorAll('.kb6-card, .kb6-row')].map((c) => (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 60)))`)
    await shot('mockup-1-tile')
    const pageBtn = await val(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => /Open the (Mockups|Maquettes) page/i.test(x.innerText || '')); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }) })()`)
    results.mockup.pageButton = typeof pageBtn === 'string' ? JSON.parse(pageBtn) : null
    // 1. the card itself
    const c = await val(`(() => { const c = [...document.querySelectorAll('.kb6-card, .kb6-row, [data-art-id]')].find((x) => /phone-mockup/.test(x.innerText || '')); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height * 0.65 }) })()`)
    results.mockup.cardFound = typeof c === 'string'
    if (typeof c === 'string') {
      const cc = JSON.parse(c); await tap(cc.x, cc.y); await sleep(3500)
      results.mockup.afterCardText = await val(`(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)`)
      results.mockup.afterCardUrl = await val(`location.href`)
      results.mockup.afterCard = await geom()
      results.mockup.afterCardPage = await val(`!!document.querySelector('[data-kb="maquettes-page"]')`)
      await shot('mockup-2-card-opened')
    }
    // 2. its page, from the button of the tile (or from where the card led)
    if ((await val(`!!document.querySelector('[data-kb="maquettes-page"]')`)) !== true) {
      await val(`(() => { const b = document.querySelector('[data-kb="art-popup-close"]'); if (b) b.click() })()`); await sleep(600)
      const pb = await val(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => /Open the (Mockups|Maquettes) page/i.test(x.innerText || '')); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
      if (typeof pb === 'string') { const p = JSON.parse(pb); await tap(p.x, p.y); await sleep(2500) }
    }
    const MQ = `(() => { const vw = innerWidth; const vh = innerHeight; const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }; const root = document.querySelector('[data-kb="maquettes-page"]'); if (!root) return JSON.stringify({ page: false }); const ctl = [...root.querySelectorAll('button, a[href], input, select')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('data-act') || e.getAttribute('data-kb') || e.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 30), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] } }); const r = root.getBoundingClientRect(); return JSON.stringify({ page: true, h1: (root.querySelector('h1') || {}).textContent, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], docW: document.scrollingElement.scrollWidth, hOverflow: document.scrollingElement.scrollWidth > vw + 1, controls: ctl.length, outside: ctl.filter((c) => c.r[0] < -1 || c.r[0] + c.r[2] > vw + 1).map((c) => c.n + ' ' + c.r.join('x')), small: ctl.filter((c) => c.r[2] < 32 || c.r[3] < 32).map((c) => c.n + ' ' + c.r.join('x')), list: ctl.map((c) => c.n + ' ' + c.r.join('x')).slice(0, 14) }) })()`
    results.mockup.page = JSON.parse(await val(MQ))
    await shot('mockup-3-page')
    if (results.mockup.page.page === true) {
      // 3. Open: the page in its editor frame
      const openBtn = await val(`(() => { const b = document.querySelector('[data-act="open"]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
      if (typeof openBtn === 'string') {
        const o = JSON.parse(openBtn); await tap(o.x, o.y)
        const MQF = /\/kybernos-maquettes\/v\//
        let ready = false
        for (let i = 0; i < 30 && !ready; i += 1) { await sleep(700); ready = (await fq(MQF, `!!(document.querySelector('div[data-ky-ui]') || {}).shadowRoot && !!document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#pill')`)) === true }
        results.mockup.editorReady = ready
        results.mockup.frameBox = await val(`(() => { const f = document.querySelector('[data-kb="maquettes-frame"]'); if (!f) return null; const r = f.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, inWindow: r.left >= -1 && r.right <= innerWidth + 1, docW: document.scrollingElement.scrollWidth }) })()`)
        results.mockup.editorPill = await fq(MQF, `(() => { const e = document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#pill'); const r = e.getBoundingClientRect(); return JSON.stringify({ text: e.textContent.trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight }) })()`)
        await shot('mockup-4-editor')
        if (ready) {
          const inFrame = async (js) => { const fb = JSON.parse(await val(`(() => { const r = document.querySelector('[data-kb="maquettes-frame"]').getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top }) })()`)); const c = await fq(MQF, js); return c && typeof c.x === 'number' ? { x: fb.x + c.x, y: fb.y + c.y } : null }
          const pillAt = await inFrame(`(() => { const r = document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#pill').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
          if (pillAt) { await tap(pillAt.x, pillAt.y); await sleep(900) }
          results.mockup.barVisible = await fq(MQF, `(() => { const b = document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#bar'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ hidden: !!b.hidden, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight, buttons: [...b.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return (x.getAttribute('aria-label') || x.title || x.textContent || '').trim().slice(0, 14) + ' ' + Math.round(q.left) + ',' + Math.round(q.top) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) }) }) })()`)
          await shot('mockup-5-edit-bar')
          const titleAt = await inFrame(`(() => { const e = document.querySelector('h1.kb-title'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 } })()`)
          results.mockup.titleFound = !!titleAt
          if (titleAt) {
            await tap(titleAt.x, titleAt.y); await sleep(600)
            const fsend = (m, pr) => (frameConn || page).send(m, pr)
            await fsend('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] })
            await fsend('Input.insertText', { text: 'Phone edit title' }); await sleep(700)
            results.mockup.typedTitle = await fq(MQF, `document.querySelector('h1.kb-title').textContent`)
            results.mockup.count = await fq(MQF, `(document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#cnt') || {}).textContent`)
            await shot('mockup-6-typed')
            const saveAt = await inFrame(`(() => { const e = document.querySelector('div[data-ky-ui]').shadowRoot.querySelector('#save'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
            results.mockup.saveFound = !!saveAt
            if (saveAt) {
              await tap(saveAt.x, saveAt.y)
              for (let i = 0; i < 30; i += 1) { await sleep(500); if (readFileSync(join(mockDir, 'index.html'), 'utf8').includes('Phone edit title')) break }
              results.mockup.onDisk = readFileSync(join(mockDir, 'index.html'), 'utf8').includes('<h1 class="kb-title">Phone edit title</h1>')
              await sleep(2500)
              await shot('mockup-7-saved')
            }
          }
        }
      } else results.mockup.editor = 'no Open button on the mockup page'
    }
  } else results.mockup.tile = 'no Mockups tile in Creations'
} catch (e) {
  results.error = String(e && e.stack ? e.stack : e).slice(0, 600)
} finally {
  results.jsErrors = jsErrors
  if (registered) await val(`fetch('/kybernos-maquettes/folders/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(mockDir)} }) }).then((r) => r.status)`).catch(() => {})
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1))
  await live.close()
  for (const n of Object.values(names)) rmSync(join(folder, n), { force: true })
  rmSync(mockDir, { recursive: true, force: true })
}
const line = (k) => { const r = results[k]; if (!r) return k + ': -'; const g = r.opened || {}; return `${k.padEnd(9)} card ${r.card ? r.card.w + 'x' + r.card.h : '-'} | popup ${g.popup} frame ${g.frame} | outside ${g.outside ? g.outside.length : '?'} small ${g.small} hOverflow ${g.hOverflow} | edit offered ${r.editOffered} typed -> ${JSON.stringify(r.statusAfterTyping)} saved -> ${JSON.stringify(r.statusAfterSave)} | share ${r.shareOffered} ${r.share && r.share.opened !== undefined ? 'opened ' + r.share.opened + ' inside ' + r.share.insideWindow : ''}` }
for (const k of ['document', 'sheet', 'deck', 'pdf', 'note']) console.log(line(k))
console.log('mockup:', JSON.stringify(results.mockup).slice(0, 400))
console.log('report: ' + join(OUT, 'report.json'))
process.exit(0)
