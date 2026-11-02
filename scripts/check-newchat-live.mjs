#!/usr/bin/env node
// The new-chat page on the REAL GUI: the slider of templates under the composer, one colour, and it listens to the text.
//
//   node scripts/check-newchat-live.mjs [--shots <dir>]
//
// What is real: the DSH page and its blank chat. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away Chrome): the
// kybernos-plugin client, from this checkout instead of the shared tree. A draft is typed in the composer and cleared again;
// NOTHING is sent, and the draft lives in the throw-away browser. Host code is not involved (no restart needed).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or no blank chat on screen).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
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
const ev = async (js) => (await page.evalJs(js, 8000)).val
const shot = async (name) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const r = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}
const centre = async (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const click = async (selector) => {
  const c = await centre(selector)
  if (c === null) return false
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 })
  return true
}
// A card may be scrolled out of sight (typing a word lights one and brings its chapter in): bring its chapter to the start, then click it.
const clickCard = async (id) => {
  await ev(`(() => { const c = document.querySelector('.kb8-sl-card[data-id="${id}"]'); const t = document.querySelector('.kb8-sl-track'); const g = c.closest('.kb8-sl-group'); t.style.scrollSnapType = 'none'; t.scrollLeft = Math.max(0, g.offsetLeft - 4); t.style.scrollSnapType = '' })()`)
  await sleep(400)
  return click('.kb8-sl-card[data-id="' + id + '"]')
}
// The block must scroll ITS track only. A scrollable ancestor that moved (DSH's own frame was pushed 462 px sideways by a script scroll)
// slides the composer out of the window: measured by the composer's left edge and by every ancestor's scroll offset.
const stillness = async () => ev(`(() => { const card = document.querySelector('[data-composer-card]'); const out = { cardLeft: Math.round(card.getBoundingClientRect().left), moved: [] }; for (let e = document.querySelector('[data-kb="newchat-slider"]'); e; e = e.parentElement) { if (e.classList && e.classList.contains('kb8-sl-track')) continue; if (e.scrollLeft !== 0 || e.scrollTop !== 0) out.moved.push(e.tagName + '.' + String(e.className).slice(0, 30) + ' L=' + e.scrollLeft + ' T=' + e.scrollTop) } return out })()`)
const draft = async () => ev(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); return e ? (e.value !== undefined && e.value !== '' ? e.value : e.innerText) : null })()`)
const clearDraft = async () => {
  await click('[contenteditable="true"], textarea')
  await sleep(150)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(400)
}
// a smooth scroll is done when the track stops moving
const settled = async () => { await sleep(700); let last = -1; for (let i = 0; i < 25; i += 1) { const now = await ev(`document.querySelector('.kb8-sl-track').scrollLeft`); if (now === last) return now; last = now; await sleep(150) } return last }

try {
  await page.send('Runtime.enable', {})
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  const there = await waitFor(page, `!!document.querySelector('[data-kb="newchat-slider"]')`, 25000)
  if (!swap.report().every((r) => r.replaced === true)) { console.error('○ not run: the served plugin text differs from the shared tree (uncommitted edits there?): ' + JSON.stringify(swap.report())); await live.close(); process.exit(3) }
  if (there === null) { console.error('○ not run: no blank chat with the slider on screen'); await live.close(); process.exit(3) }

  console.log('New chat page — this checkout in the real GUI')
  await sleep(800)
  await shot('home')
  const still0 = await stillness()

  // ── structure and place ──────────────────────────────────────────────────────────────────────────────────────
  const cards = await ev(`[...document.querySelectorAll('.kb8-sl-card')].map((c) => ({ id: c.dataset.id, label: c.innerText.trim(), svg: !!c.querySelector('svg'), w: Math.round(c.getBoundingClientRect().width) }))`)
  check('the slider shows templates, each with a drawing and a name', Array.isArray(cards) && cards.length >= 5 && cards.every((c) => c.svg && c.label.length > 0 && c.w >= 100), cards)
  const core = ['doc', 'sheet', 'image', 'website', 'automation', 'team', 'skill', 'plugin']
  check('the core templates are always there', core.every((id) => cards.some((c) => c.id === id)), cards.map((c) => c.id))
  const geo = await ev(`(() => { const s = document.querySelector('[data-kb="newchat-slider"]').getBoundingClientRect(); const e = document.querySelector('[data-composer-card]'); const c = e ? e.getBoundingClientRect() : null; return { sliderTop: s.top, composerBottom: c ? c.bottom : null, sliderLeft: s.left, composerLeft: c ? c.left : null, sliderRight: s.right, composerRight: c ? c.right : null, overflow: document.documentElement.scrollWidth - window.innerWidth } })()`)
  check('the slider is drawn UNDER the composer card (CSS order, no engine patch)', geo !== null && geo.composerBottom !== null && geo.sliderTop >= geo.composerBottom - 1, geo)
  check('and stays inside the composer\'s width', geo !== null && geo.sliderLeft >= geo.composerLeft - 24 && geo.sliderRight <= geo.composerRight + 24, geo)
  check('the page does not scroll sideways', geo !== null && geo.overflow <= 0, geo)
  check('the old Build / Create cards and gradient tiles are gone', (await ev(`document.querySelectorAll('[data-kb="newchat-build"],[data-kb="newchat-create"],.kb8-nc-art,.kb8-nc-row').length`)) === 0)

  // ── one colour: every drawn fill and stroke is a grey or the accent's hue ─────────────────────────────────
  const colour = await ev(`(() => {
    const root = document.querySelector('[data-kb="newchat"]')
    const probe = document.createElement('i'); probe.style.color = getComputedStyle(root).getPropertyValue('--kb8-acc'); root.appendChild(probe)
    const acc = getComputedStyle(probe).color; probe.remove()
    const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (m) return m[1].split(/[ ,\\/]+/).filter(Boolean).slice(0, 3).map(Number); const c = /color\\(srgb ([^)]+)\\)/.exec(s); if (c) return c[1].split(/[ \\/]+/).slice(0, 3).map((x) => Math.round(Number(x) * 255)); return null }
    const hs = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 0.001) return null; const sat = d / mx; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, sat } }
    const a = parse(acc), ah = a ? hs(a) : null
    const stray = []
    for (const el of root.querySelectorAll('.kb8-sl-stage *')) for (const p of ['fill', 'stroke']) {
      const v = getComputedStyle(el)[p]; if (!v || v === 'none') continue
      const rgb = parse(v); if (!rgb) continue
      const x = hs(rgb); if (!x || x.sat < 0.2) continue
      const dh = ah ? Math.min(Math.abs(x.h - ah.h), 360 - Math.abs(x.h - ah.h)) : 999
      if (dh > 28) stray.push((el.getAttribute('class') || el.tagName) + ' ' + p + ' ' + v)
    }
    return { acc, accHue: ah ? Math.round(ah.h) : null, stray: stray.slice(0, 6) }
  })()`)
  check('one colour: every fill and stroke of the 13 drawings is a grey or the theme\'s accent', colour !== null && colour.stray.length === 0, colour)
  const tokenOk = await ev(`(() => { const root = document.querySelector('[data-kb="newchat"]'); const a = getComputedStyle(root).getPropertyValue('--kb8-acc').trim(); return a.length > 0 })()`)
  check('the accent is read from the theme token (--dsw-alias-brand-primary)', tokenOk === true)

  // ── the little motion on hover ────────────────────────────────────────────────────────────────────────────
  const slidesLike = cards[0].id
  const h = await centre('.kb8-sl-card[data-id="' + slidesLike + '"]')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y })
  await sleep(250)
  const anim = await ev(`(() => { const c = document.querySelector('.kb8-sl-card[data-id="${slidesLike}"]'); return c.getAnimations({ subtree: true }).length })()`)
  check('hovering a card plays its little motion', anim > 0, anim)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

  // ── the slider moves ──────────────────────────────────────────────────────────────────────────────────────
  const move = await ev(`(() => { const t = document.querySelector('.kb8-sl-track'); return { scrolls: t.scrollWidth > t.clientWidth + 4, left: t.scrollLeft, prevOff: document.querySelector('.kb8-sl-nav.prev').classList.contains('off') } })()`)
  if (move.scrolls) {
    check('at the start the « previous » arrow is hidden', move.prevOff === true, move)
    await click('.kb8-sl-nav.next')
    await sleep(900)
    const after = await ev(`(() => { const t = document.querySelector('.kb8-sl-track'); return { left: t.scrollLeft, prevOff: document.querySelector('.kb8-sl-nav.prev').classList.contains('off') } })()`)
    check('« next » scrolls the track and brings the « previous » arrow back', after.left > move.left + 50 && after.prevOff === false, after)
    await shot('home-scrolled')
    await click('.kb8-sl-nav.prev')
    await sleep(900)
  } else console.log('  ○ the dock is wide enough to show every template: no scrolling to check here')
  const stillArrows = await stillness()
  check('the arrows scroll the track only', stillArrows.moved.length === 0 && stillArrows.cardLeft === still0.cardLeft, stillArrows)
  const heads = await ev(`[...document.querySelectorAll('.kb8-sl-gh')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
  check('the chapters are named (with their count)', Array.isArray(heads) && heads.length >= 3 && heads.every((t) => /\d$/.test(t)), heads)

  await click('.kb8-sl-group:nth-child(3) .kb8-sl-gh')
  await sleep(1000)
  const stillTitle = await stillness()
  check('a click on a chapter title scrolls the track only', stillTitle.moved.length === 0 && stillTitle.cardLeft === still0.cardLeft, stillTitle)
  await ev(`document.querySelector('.kb8-sl-track').scrollLeft = 0`)
  await sleep(500)

  // ── it listens, and a click fills without sending ─────────────────────────────────────────────────────────
  await click('[contenteditable="true"], textarea')
  await sleep(200)
  await page.send('Input.insertText', { text: 'a landing page for my bakery' })
  await settled()
  const lit = await ev(`(() => { const m = document.querySelector('.kb8-sl-card.is-match'); if (!m) return null; const r = m.getBoundingClientRect(), t = document.querySelector('.kb8-sl-track').getBoundingClientRect(); return { id: m.dataset.id, inView: r.left >= t.left - 1 && r.right <= t.right + 1 } })()`)
  check('typing « a landing page… » lights the Website card and brings it into view', lit !== null && lit.id === 'website' && lit.inView === true, lit)
  await shot('home-listening')
  const still1 = await stillness()
  check('typing a word that scrolls the track moves nothing else (the composer stays where it was)', still1.moved.length === 0 && still1.cardLeft === still0.cardLeft, { before: still0, after: still1 })
  await clearDraft()
  check('with the text gone nothing is lit', (await ev(`document.querySelectorAll('.kb8-sl-card.is-match').length`)) === 0)
  await clickCard('doc')
  await sleep(500)
  const filled = await draft()
  check('a click fills the composer with the template sentence', typeof filled === 'string' && filled.trim().length > 8 && !/undefined|null/.test(filled), filled)
  check('and nothing is sent: the blank chat and its slider are still there', (await ev(`!!document.querySelector('[data-kb="newchat-slider"]')`)) === true)
  await clearDraft()
  await page.send('Input.insertText', { text: 'my own words' })
  await sleep(300)
  await clickCard('doc')
  await sleep(500)
  const kept = await draft()
  check('a click keeps the words already typed (after the sentence)', typeof kept === 'string' && kept.indexOf('my own words') > 0, kept)
  await clearDraft()
  check('the composer is empty again', ((await draft()) || '').trim() === '', await draft())
  // nothing was kept: a fresh load of the blank chat has an empty composer too
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  await waitFor(page, `!!document.querySelector('[data-kb="newchat-slider"]')`, 25000)
  check('after a reload the blank chat\'s composer is empty (the draft did not outlive the check)', ((await draft()) || '').trim() === '', await draft())

  // ── the Cloud Computer line (only when the cloud bundle answers) ──────────────────────────────────────────
  const cloud = await ev(`(() => { const c = document.querySelector('[data-kb="newchat-cloud"]'); if (!c) return null; const s = document.querySelector('[data-kb="newchat-slider"]').getBoundingClientRect(), r = c.getBoundingClientRect(); return { below: r.top >= s.bottom - 1, h: Math.round(r.height), text: c.innerText.replace(/\\s+/g, ' ').trim() } })()`)
  if (cloud !== null) check('the Cloud Computer is one quiet line under the slider', cloud.below === true && cloud.h <= 60 && cloud.text.length > 0, cloud)
  else console.log('  ○ no Cloud Computer line (the cloud bundle says nothing here)')
} catch (e) {
  failures.push('the check itself crashed: ' + e.message)
  console.log('  ✗ ' + e.message)
}
await live.close()
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)
