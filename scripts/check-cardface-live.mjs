#!/usr/bin/env node
// The face of the Workspaces and Agent Teams cards on the REAL GUI, and the same face everywhere else a project or a team is shown: a pale tile
// whose glyph keeps the colour, a still watermark that only shows on hover, a quiet foot (icon + number, the word on hover, the actions on the right),
// no line for an empty description. Then: the list rows of both pages, the page headers and the avatar preview, the Marketplace (cards, rows, Preview).
//
//   node scripts/check-cardface-live.mjs [--shots <dir>]
//
// What is real: the DSH page and its Workspaces / Agent Teams pages. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away Chrome):
// the kybernos-plugin client, from this checkout instead of the shared tree. Nothing is written: pages are opened, a card is hovered, a view toggle
// and a tab are pressed (the toggle writes only to the throw-away browser's own storage). Host code is not involved (no restart needed).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or no cards on screen).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 10000)).val
const shot = async (name) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const r = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}
const move = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(450) }
const centre = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)

// One page of cards: the same promises for Workspaces and Agent Teams.
async function face (kind, sel, maxHeight) {
  const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  if (!n) { console.log('  ○ no ' + kind + ' card on screen: skipped'); return }
  await move(5, 5)
  const rest = await ev(`(() => {
    const cards = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const hex = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); return m ? m[1].split(/[ ,\\/]+/).filter(Boolean).slice(0, 3).map(Number) : null }
    const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx }
    const out = { n: cards.length, h: Math.max(...cards.map((c) => Math.round(c.getBoundingClientRect().height))), noFace: [], emptyLines: 0, outlines: [], tiles: [], bad: [] }
    for (const c of cards) {
      if (!c.classList.contains('kb8-cf') || !c.querySelector('.kb8-cf-foot') || !c.querySelector('.kb8-cf-wm') || c.querySelectorAll('.kb8-cf-st').length < 2) out.noFace.push(c.innerText.slice(0, 30))
      out.emptyLines += c.querySelectorAll('.kb8-none').length
      const t = c.querySelector('.kb8-cf-ic')
      if (t) { const cs = getComputedStyle(t); if (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) out.outlines.push(c.innerText.slice(0, 20)); out.tiles.push({ col: t.classList.contains('col'), glyph: hex(getComputedStyle(t).color), bg: hex(cs.backgroundColor) }) }
      const wm = c.querySelector('.kb8-cf-wm'); if (wm && getComputedStyle(wm).opacity !== '0') out.bad.push('watermark visible at rest')
      const a = c.querySelector('.kb8-cardacts'); if (a && getComputedStyle(a).opacity !== '0') out.bad.push('actions visible at rest')
    }
    const coloured = out.tiles.filter((t) => t.col && t.glyph)
    out.colouredCount = coloured.length
    out.glyphColourful = coloured.every((t) => sat(t.glyph) > 0.18)
    out.neutralOk = out.tiles.filter((t) => !t.col && t.bg).every((t) => Math.max(...t.bg) > 20)
    return out
  })()`)
  check(kind + ': every card has the new face (tile, watermark, foot with two figures)', rest.noFace.length === 0, rest.noFace)
  check(kind + ': a card is ' + maxHeight + ' px or less (it was 231 / 214)', rest.h <= maxHeight, rest.h)
  check(kind + ': no empty-description line (nothing is written when there is nothing to say)', rest.emptyLines === 0, rest.emptyLines)
  check(kind + ': the tile has no outline and no border', rest.outlines.length === 0, rest.outlines)
  if (rest.colouredCount > 0) check(kind + ': the glyph of a coloured project keeps a colour (never near-black)', rest.glyphColourful === true, rest.tiles)
  else console.log('  ○ no coloured ' + kind + ' here: the glyph colour is not measured')
  check(kind + ': a project without colour keeps a neutral grey tile, not a black one', rest.neutralOk === true, rest.tiles)
  check(kind + ': at rest the watermark and the actions are invisible', rest.bad.length === 0, rest.bad)

  // hover: the watermark appears, STILL; the word of a figure appears; the actions appear in the foot
  const c = await centre(sel)
  await move(c.x, c.y)
  const h1 = await ev(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); const w = c.querySelector('.kb8-cf-wm'); const a = c.querySelector('.kb8-cardacts'); const f = c.querySelector('.kb8-cf-foot').getBoundingClientRect(); const ar = a.getBoundingClientRect(); return { wm: getComputedStyle(w).opacity, t: getComputedStyle(w).transform, acts: getComputedStyle(a).opacity, inFoot: ar.top >= f.top - 1 && ar.bottom <= f.bottom + 1, right: ar.right <= c.getBoundingClientRect().right } })()`)
  await sleep(350)
  const h2 = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}).querySelector('.kb8-cf-wm')).transform`)
  check(kind + ': on hover the watermark appears', h1.wm === '1', h1)
  check(kind + ': and it does not move (same transform 350 ms later)', h1.t === h2, { a: h1.t, b: h2 })
  check(kind + ': the actions show on hover, inside the foot, on the right', h1.acts === '1' && h1.inFoot === true && h1.right === true, h1)
  const fig = await centre(sel + ' .kb8-cf-st')
  await move(fig.x, fig.y)
  const lbl = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)} + ' .kb8-cf-st .kb8-cf-lbl'); return { w: Math.round(e.getBoundingClientRect().width), op: getComputedStyle(e).opacity, text: e.textContent } })()`)
  check(kind + ': hovering a figure says its word', lbl.w > 20 && lbl.op === '1' && lbl.text.length > 2, lbl)
  const names = await ev(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' .kb8-cf-st')].every((s) => s.getAttribute('aria-label') && s.title)`)
  check(kind + ': every figure carries its word as a tooltip and an accessible name', names === true)
  await shot('cardface-' + kind.toLowerCase().replace(/\s+/g, '-'))
  await move(5, 5)
}

try {
  await page.send('Runtime.enable', {})
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  // The kybernos.app catalogue answers nothing on this machine (not linked): this browser, and only this browser, is told it holds two entries, so that the
  // catalogue card can be measured. Reading only; Install is never pressed.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = function (u) { try { if (String(u).indexOf('/kybernos-cloud/marketplace') >= 0 && String(u).indexOf('/install') < 0) return Promise.resolve(new Response(JSON.stringify({ ok: true, items: [{ slug: 'legal-intake', name: 'Legal intake', cat: 'Legal', version: '1.2.0', pitch: 'Reads a new contract, lists the risky clauses and drafts the questions for counsel.', color: '#7a3f7a', glyph: 'LI', agents: [{}, {}, {}, {}] }, { slug: 'plain-one', name: 'Plain one', cat: '', version: '0.1.0', pitch: 'No colour, no glyph.', color: '', glyph: '', agents: [{}] }] }), { status: 200, headers: { 'content-type': 'application/json' } })) } catch (e) { /* the real fetch */ } return f.apply(this, arguments) } })()` })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  if (!swap.report().every((r) => r.replaced === true)) { console.error('○ not run: the served plugin text differs from the shared tree (uncommitted edits there?): ' + JSON.stringify(swap.report())); await live.close(); process.exit(3) }

  console.log('Workspaces')
  await clickText(page, 'Workspaces')
  await waitFor(page, `!!document.querySelector('[data-kb="project-card"]')`, 15000)
  await sleep(800)
  const ws = await ev(`document.querySelectorAll('[data-kb="project-card"]').length`)
  if (!ws) { console.error('○ not run: no Workspaces card on screen'); await live.close(); process.exit(3) }
  check('the toolbar (search, sort) is still there, untouched', (await ev(`!!document.querySelector('.kb6-toolbar')`)) === true)
  await face('Workspaces', '[data-kb="project-card"]', 140)
  const cnt = await ev(`[...document.querySelectorAll('[data-kb="project-counts"]')[0].querySelectorAll('.kb8-cf-n')].map((e) => e.textContent)`)
  check('the Workspaces counters are two plain numbers (the words wait for a hover), not a mono caps sentence', Array.isArray(cnt) && cnt.length === 2 && cnt.every((x) => /^\d+$/.test(x)), cnt)

  console.log('Agent Teams')
  await clickText(page, 'Agent Teams')
  await waitFor(page, `!!document.querySelector('[data-kb="kyber-card"]')`, 15000).catch(() => null)
  await sleep(800)
  await face('Agent Teams', '[data-kb="kyber-card"]', 150)
  const kyber = await ev(`(() => { const c = document.querySelector('[data-kb="kyber-card"]'); if (!c) return null; const host = c.querySelector('[data-kb="kyber-card-host"]'); return { host: !!host && (host.getAttribute('data-hosted') === 'yes' || host.getAttribute('data-hosted') === 'no'), noMission: /no mission declared|aucune mission/i.test(c.innerText), pills: c.querySelectorAll('.kb8-pill').length, count: c.querySelector('.kb8-cf-st .kb8-cf-n') ? c.querySelector('.kb8-cf-st .kb8-cf-n').textContent : null } })()`)
  if (kyber !== null) {
    check('Agent Teams: the hosting figure keeps its hook (kyber-card-host, data-hosted)', kyber.host === true, kyber)
    check('Agent Teams: no mission-declared placeholder, and no pill row left', kyber.noMission === false && kyber.pills === 0, kyber)
    check('Agent Teams: the first figure is the number of agents', /^\d+$/.test(String(kyber.count)), kyber)
  }
  // ── the list rows: the face laid flat ──────────────────────────────────────────────────────────────────────────────────────────
  // The same page at phone width (a 400 px window, no device emulation): the rows, cards, tiles and buttons stay inside the window.
  const phoneCheck = async (label, slug) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    const m = await ev(`(() => { const w = window.innerWidth; const out = []; for (const e of document.querySelectorAll('.kb8-page .kb8-row, .kb8-page .kb8-card, .kb8-page .kb8-cf-ic, .kb8-page .kb8-rf-btns, .kb8-page .kb8-hd-txt')) { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1)) out.push((e.className || '').toString().slice(0, 40) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)) } return { w, out: out.slice(0, 5), n: document.querySelectorAll('.kb8-page .kb8-row, .kb8-page .kb8-card').length } })()`)
    check(label + ' at 400 px: every row, card, tile and button stays inside the window', m.out.length === 0, m)
    await shot('phone-' + slug)
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    await sleep(600)
  }
  const clickDom = (sel, nth = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return false; e.click(); return true })()`)
  const rowsFace = async (kind, sel, cols) => {
    const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    if (!n) { console.log('  ○ no ' + kind + ' row on screen: skipped'); return false }
    await move(5, 5)
    const r = await ev(`(() => {
      const rows = [...document.querySelectorAll(${JSON.stringify(sel)})]
      const out = { n: rows.length, h: Math.max(...rows.map((r) => Math.round(r.getBoundingClientRect().height))), bad: [], outline: 0, pills: 0, placeholders: 0, cols: [], figs: 0 }
      for (const r of rows) {
        if (!r.classList.contains('kb8-rf')) out.bad.push('no .kb8-rf')
        const t = r.querySelector('.kb8-cf-ic')
        if (!t || Math.round(t.getBoundingClientRect().width) !== 34) out.bad.push('tile is not 34 px: ' + (t ? Math.round(t.getBoundingClientRect().width) : 'none'))
        else { const cs = getComputedStyle(t); if (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) out.outline += 1 }
        out.pills += r.querySelectorAll('.kb8-pill, .kb8-tile').length
        out.placeholders += /No description yet|No mission|Top-level project|Agent Team ·/i.test(r.innerText) ? 1 : 0
        out.cols.push([...r.querySelectorAll('.kb8-rf-figs > *')].map((e) => Math.round(e.getBoundingClientRect().left)))
        out.figs = Math.max(out.figs, r.querySelectorAll('.kb8-rf-figs .kb8-cf-st').length)
        const a = r.querySelector('.kb8-rf-acts .kb-favbtn:not(.on)'); if (a && getComputedStyle(a).opacity !== '0') out.bad.push('an action is visible at rest')
      }
      return out
    })()`)
    check(kind + ' rows: the flat face (tile 34, figures, actions), nothing else', r.bad.length === 0 && r.figs >= cols - 1, r)
    check(kind + ' rows: no pill, no solid tile, no outline, no placeholder line', r.pills === 0 && r.outline === 0 && r.placeholders === 0, r)
    check(kind + ' rows: ' + r.h + ' px or less', r.h <= 68, r.h)
    check(kind + ' rows: the figure columns start at the same x on every row', r.cols.every((c) => JSON.stringify(c) === JSON.stringify(r.cols[0])), r.cols.slice(0, 4))
    const p = await centre(sel)
    await move(p.x, p.y)
    const h = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); return [...r.querySelectorAll('.kb8-rf-acts .kb-favbtn')].map((b) => getComputedStyle(b).opacity) })()`)
    check(kind + ' rows: the actions show on hover', h.length >= 2 && h.every((o) => o === '1'), h)
    await shot('rows-' + kind.toLowerCase().replace(/\s+/g, '-'))
    await move(5, 5)
    await phoneCheck(kind + ' rows', 'rows-' + kind.toLowerCase().replace(/\s+/g, '-'))
    return true
  }
  const viewToggle = async (id) => { await clickDom('[data-kb="view-' + id + '"]'); await sleep(700) }

  console.log('Agent Teams rows')
  await clickText(page, 'Agent Teams')
  await waitFor(page, `!!document.querySelector('[data-kb="kyber-card"]')`, 15000).catch(() => null)
  await viewToggle('list')
  if (await rowsFace('Agent Teams', '[data-kb="kyber-row"]', 3)) {
    const host = await ev(`(() => { const e = document.querySelector('[data-kb="kyber-row-host"]'); return !!e && (e.getAttribute('data-hosted') === 'yes' || e.getAttribute('data-hosted') === 'no') })()`)
    check('Agent Teams rows: the hosting figure keeps a hook with data-hosted', host === true)
    // the page of a team: header tile 56 with the figures, the avatar preview 96
    await clickDom('[data-kb="kyber-row"]')
    await waitFor(page, `!![...document.querySelectorAll('.kb8-page .kb8-h1')].length`, 15000).catch(() => null)
    await sleep(900)
    const d = await ev(`(() => { const t = document.querySelector('.kb8-page .kb8-cf-ic.s56'); const av = document.querySelector('.kb8-page .kb8-cf-ic.s96'); const cs = t ? getComputedStyle(t) : null; return { head: t ? Math.round(t.getBoundingClientRect().width) : 0, figs: document.querySelectorAll('.kb8-hd-txt .kb8-cf-st').length, av: av ? Math.round(av.getBoundingClientRect().width) : 0, solid: !!document.querySelector('.kb8-page .kb8-tile[style*="44px"]'), outline: cs ? (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) : false } })()`)
    check('Agent Team page: the header tile is the pale tile at 56 px, with the card\'s figures under the name', d.head === 56 && d.figs >= 2 && d.solid === false && d.outline === false, d)
    check('Agent Team page, Identity: the avatar preview is the same tile at 96 px', d.av === 96, d)
    const pk = await ev(`(() => { const t = document.querySelector('.kb8-page .kb8-cf-ic.s56'); const on = document.querySelector('.kb8-page .kb8-iconbtn.on'); return { coloured: !!t && t.classList.contains('col'), on: !!on, onCol: !!on && on.classList.contains('col') } })()`)
    check('Agent Team page, Identity: the chosen icon of the picker takes the team\'s colour (when it has one)', pk.coloured === false || pk.on === false || pk.onCol === true, pk)
    await shot('detail-team')
    await phoneCheck('Agent Team page', 'detail-team')
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Back to Agent Teams/.test(x.innerText)); if (b) b.click() })()`)
    await sleep(700)
  }

  console.log('Workspaces rows')
  await clickText(page, 'Workspaces')
  await waitFor(page, `!!document.querySelector('[data-kb="project-card"], [data-kb="project-row"]')`, 15000)
  await viewToggle('list')
  if (await rowsFace('Workspaces', '[data-kb="project-row"]', 2)) {
    await clickDom('[data-kb="project-row"]')
    await waitFor(page, `!!document.querySelector('.kb8-page .kb8-h1')`, 15000).catch(() => null)
    await sleep(900)
    const p = await ev(`(() => { const t = document.querySelector('.kb8-page > div .kb8-cf-ic.s56'); return { head: t ? Math.round(t.getBoundingClientRect().width) : 0, solid: !!document.querySelector('.kb8-page .kb8-tile[style*="52px"]') } })()`)
    check('Workspace page: the header tile is the pale tile at 56 px (no solid 52 px block)', p.head === 56 && p.solid === false, p)
    await clickDom('[data-kb="project-tab-details"]')
    await sleep(700)
    const dt = await ev(`document.querySelectorAll('.kb8-page .kb8-cf-ic.s56').length`)
    // The Details tab has no preview tile of its own any more (the icon and colour are picked there, the header's tile shows the result): one 56 px tile on the page.
    check('Workspace page, Details: the tile at 56 px is the header\'s alone, the tab draws no second one', dt === 1, dt)
    await shot('detail-project')
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Back to projects/.test(x.innerText)); if (b) b.click() })()`)
    await sleep(700)
  }
  await viewToggle('cards')

  // ── the Marketplace ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('Marketplace')
  await clickText(page, 'Agent Teams')
  await waitFor(page, `!!document.querySelector('.kb6-utabs')`, 15000).catch(() => null)
  await ev(`(() => { const b = document.querySelectorAll('.kb6-utabs .kb6-utab')[1]; if (b) b.click() })()`)
  await waitFor(page, `!!document.querySelector('[data-kb="market-local-label"] ~ * [data-kb="market-card"], [data-kb="market-row"]')`, 15000).catch(() => null)
  await sleep(900)
  await viewToggle('cards')
  const TC = '[data-kb="market-local-label"] ~ .kb8-grid [data-kb="market-card"]'
  const mc = await ev(`document.querySelectorAll(${JSON.stringify(TC)}).length`)
  if (!mc) console.log('  ○ no Marketplace card on screen: skipped')
  else {
    await move(5, 5)
    const m = await ev(`(() => {
      const cards = [...document.querySelectorAll(${JSON.stringify(TC)})]
      const out = { n: cards.length, noFace: 0, pills: 0, outline: 0, caps: 0, installedFigs: 0, installedWord: true, actionsAtRest: 0, agents: 0 }
      for (const c of cards) {
        if (!c.classList.contains('kb8-cf') || !c.querySelector('.kb8-cf-foot') || !c.querySelector('.kb8-cf-ic.s42')) out.noFace += 1
        out.pills += c.querySelectorAll('.kb8-pill, .kb8-tile').length
        const t = c.querySelector('.kb8-cf-ic'); if (t) { const cs = getComputedStyle(t); if (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) out.outline += 1 }
        const sub = c.querySelector('.kb8-cf-sub'); if (sub && sub.textContent === sub.textContent.toUpperCase() && /[A-Z]{4,}/.test(sub.textContent)) out.caps += 1
        const inst = c.querySelector('[data-kb="market-installed"]'); if (inst) { out.installedFigs += 1; if (getComputedStyle(inst.querySelector('.kb8-cf-lbl')).opacity !== '1') out.installedWord = false }
        if (c.querySelector('[data-kb="market-agents"]')) out.agents += 1
        const a = c.querySelector('.kb8-cardacts'); if (a && getComputedStyle(a).opacity !== '0') out.actionsAtRest += 1
      }
      return out
    })()`)
    check('Marketplace cards: every card has the face (tile 42, foot, figures)', m.noFace === 0, m)
    check('Marketplace cards: no pill, no solid tile, no outline, no category in capitals', m.pills === 0 && m.outline === 0 && m.caps === 0, m)
    check('Marketplace cards: the agents figure keeps its hook; an installed card shows its word at rest', m.agents > 0 && m.installedWord === true, m)
    check('Marketplace cards: Install and Preview are hidden at rest', m.actionsAtRest === 0, m)
    const c = await centre(TC)
    await move(c.x, c.y)
    const hv = await ev(`(() => { const a = document.querySelector(${JSON.stringify(TC)} + ' .kb8-cardacts'); const btns = [...a.querySelectorAll('button')].map((b) => b.textContent); return { op: getComputedStyle(a).opacity, btns } })()`)
    check('Marketplace cards: Preview and Install show on hover, Preview first', hv.op === '1' && hv.btns.length >= 1, hv)
    await shot('market-cards')
    await phoneCheck('Marketplace cards', 'market-cards')
    // the Preview dialog
    await ev(`(() => { const b = document.querySelector(${JSON.stringify(TC)} + ' .kb8-cardacts .kb8-chip'); if (b) b.click() })()`)
    await sleep(600)
    const pv = await ev(`(() => { const t = document.querySelector('[style*="position: fixed"] .kb8-cf-ic.s46'); return { tile: t ? Math.round(t.getBoundingClientRect().width) : 0, solid: !!(document.querySelector('[style*="position: fixed"] .kb-scroll > div') || document.body).querySelector('.kb8-tile'), caps: /[A-Z]{4,} · /.test((document.querySelector('[style*="position: fixed"] .kb8-parent') || {}).textContent || '') } })()`)
    check('Preview dialog: the header tile is the pale tile at 46 px, no category in capitals', pv.tile === 46 && pv.solid === false && pv.caps === false, pv)
    await shot('market-preview')
    await ev(`(() => { const b = [...document.querySelectorAll('[style*="position: fixed"] .kb8-chip')].find((x) => /Close|Fermer/.test(x.textContent)); if (b) b.click() })()`)
    await sleep(400)
    // the list
    await viewToggle('list')
    await move(5, 5)
    const rr = await ev(`(() => {
      const rows = [...document.querySelectorAll('[data-kb="market-row"]')]
      const out = { n: rows.length, bad: [], cols: [], btns: [] }
      for (const r of rows) {
        if (!r.classList.contains('kb8-rf') || !r.querySelector('.kb8-cf-ic.s34') || r.querySelector('.kb8-pill, .kb8-tile')) out.bad.push(r.innerText.slice(0, 20))
        out.cols.push(Math.round(r.querySelector('.kb8-rf-btns').getBoundingClientRect().left))
        out.btns.push(r.querySelectorAll('.kb8-rf-btns button').length)
      }
      return out
    })()`)
    check('Marketplace rows: the flat face, Preview (and Install when not installed) in a fixed column', rr.n > 0 && rr.bad.length === 0 && rr.cols.every((x) => x === rr.cols[0]) && rr.btns.every((b) => b >= 1), rr)
    await shot('market-rows')
    await phoneCheck('Marketplace rows', 'market-rows')
    await viewToggle('cards')
  }
  const cloud = await ev(`document.querySelectorAll('[data-kb="market-cloud"] [data-kb="market-card"]').length`)
  if (cloud > 0) {
    await viewToggle('cards')
    const cc = await ev(`(() => [...document.querySelectorAll('[data-kb="market-cloud"] [data-kb="market-card"]')].map((c) => { const t = c.querySelector('.kb8-cf-ic'); return { face: c.classList.contains('kb8-cf'), tile: !!c.querySelector('.kb8-cf-ic.s42'), txt: t ? t.textContent : null, col: t ? t.classList.contains('col') : null, pills: c.querySelectorAll('.kb8-pill, .kb8-tile').length, sub: (c.querySelector('.kb8-cf-sub') || {}).textContent, install: !!c.querySelector('.kb8-cardacts .kb8-primary'), agents: (c.querySelector('.kb8-cf-n') || {}).textContent } }))()`)
    check('kybernos.app catalogue cards: the same face, the glyph in the tile, Install in the foot', cc.length === 2 && cc.every((c) => c.face && c.tile && c.pills === 0 && c.install), cc)
    check('kybernos.app catalogue cards: a colour gives the pale coloured tile, none gives the neutral one; an empty glyph falls back to the name', cc[0].txt === 'LI' && cc[0].col === true && cc[1].col === false && cc[1].txt === 'Pl', cc)
    check('kybernos.app catalogue cards: category and version on the grey line, the number of agents as a figure', cc[0].sub === 'Legal · v1.2.0' && cc[1].sub === 'kybernos.app · v0.1.0' && cc[0].agents === '4', cc)
    await shot('market-catalogue')
  } else console.log('  ○ no kybernos.app catalogue card on screen: not measured')
} catch (e) {
  failures.push('the check itself crashed: ' + e.message)
  console.log('  ✗ ' + e.message)
}
await live.close()
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)
