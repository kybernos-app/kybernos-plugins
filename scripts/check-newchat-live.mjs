#!/usr/bin/env node
// The new-chat page on the REAL GUI: the template shelf under the composer (the types, the examples of the lit one, the dialog), one colour, and it listens to the text.
//
//   node scripts/check-newchat-live.mjs [--shots <dir>] [--pictures <dir>]
//
// What is real: the DSH page and its blank chat. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away Chrome): the kybernos-plugin client, from this checkout instead of
// the shared tree. The two host routes of the shelf (`/kybernos/templates-catalogue`, `/kybernos/templates-image`) only exist once `dsh web` restarts with this checkout, so the browser
// is answered for them by the REAL host module (templates-shelf.mjs) reading a throw-away folder: the catalogue shipped with the plugin and, with --pictures <dir> (a folder holding
// `shelf/<id>.webp` and `shelf/large/<id>.webp`; a `catalogue.json` beside them, as `scripts/templates-lot.mjs` writes it, replaces the shipped text, so the generated examples are checked too), the pictures. Without it every card shows its type's own tile, which is what a machine that has not loaded the pictures shows.
// A draft is typed in the composer and cleared again; NOTHING is sent, no app is created (the « Use template » button is looked at, never pressed), and the draft lives in the
// throw-away browser.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or no blank chat on screen).
import { copyFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
import { createShelf } from '../packages/kybernos-plugin/templates-shelf.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const shotsDir = arg('--shots')
const picsDir = arg('--pictures')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

// ── the host's answers, from the real module ─────────────────────────────────────────────────────────────────────────
const folder = mkdtempSync(join(tmpdir(), 'kb-shelf-live-'))
const released = picsDir === null ? null : join(resolve(picsDir), 'catalogue.json')
copyFileSync(released !== null && existsSync(released) ? released : join(REPO, 'packages/kybernos-plugin/templates-fallback.json'), join(folder, 'catalogue.json'))
if (picsDir !== null) symlinkSync(resolve(picsDir, 'shelf'), join(folder, 'shelf'))
const shelf = createShelf({ dir: () => folder, api: () => '', fetchFn: null })
const asked = { catalogue: 0, images: [] }
const cleanup = () => { try { rmSync(folder, { recursive: true, force: true }) } catch (e) { /* gone */ } }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { cleanup(); console.error('○ not run: ' + e.message); process.exit(3) })
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
const key = async (k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
}
// A card of the shelf may sit below the fold: scroll it into view the way a hand would, then click it.
const clickType = async (id) => {
  await ev(`(() => { const c = document.querySelector('.kb8-sl-card[data-id="${id}"]'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'instant' }) })()`)
  await sleep(600)
  return click('.kb8-sl-card[data-id="' + id + '"]')
}
const clickExample = async (id) => {
  await ev(`(() => { const c = document.querySelector('.kb8-sh-card[data-id="${id}"]'); if (c) c.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
  await sleep(500)
  return click('.kb8-sh-card[data-id="' + id + '"]')
}
// Nothing the shelf does may move a scrollable ancestor sideways (DSH's own frame was once pushed 462 px by a script scroll): measured by the composer's left edge.
const stillness = async () => ev(`(() => { const card = document.querySelector('[data-composer-card]'); const out = { cardLeft: Math.round(card.getBoundingClientRect().left), moved: [] }; for (let e = document.querySelector('[data-kb="newchat-shelf"]'); e; e = e.parentElement) { if (e.scrollLeft !== 0) out.moved.push(e.tagName + '.' + String(e.className).slice(0, 30) + ' L=' + e.scrollLeft) } return out })()`)
const draft = async () => ev(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); return e ? (e.value !== undefined && e.value !== '' ? e.value : e.innerText) : null })()`)
const clearDraft = async () => {
  await ev(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (e) e.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
  await sleep(400)
  await click('[contenteditable="true"], textarea')
  await sleep(150)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await key('Backspace', 'Backspace', 8)
  await sleep(400)
}

try {
  await page.send('Runtime.enable', {})
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }], { extraPatterns: [{ urlPattern: '*kybernos/templates-*', requestStage: 'Request' }] })
  page.on('Fetch.requestPaused', async (p) => {
    if (p.responseStatusCode !== undefined) return
    const url = p.request.url
    const answer = (code, type, body) => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: code, responseHeaders: [{ name: 'content-type', value: type }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(body).toString('base64') })
    try {
      if (url.indexOf('/kybernos/templates-catalogue') >= 0) {
        asked.catalogue += 1
        const c = await shelf.catalogue()
        await answer(c === null ? 404 : 200, 'application/json', JSON.stringify(c === null ? { ok: false } : { ok: true, catalogue: c }))
      } else if (url.indexOf('/kybernos/templates-image') >= 0) {
        const f = new URL(url).searchParams.get('f')
        asked.images.push(f)
        const bytes = await shelf.image(f)
        await answer(bytes === null ? 404 : 200, 'image/webp', bytes === null ? '' : bytes)
      } else await page.send('Fetch.continueRequest', { requestId: p.requestId })
    } catch (e) {
      try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ }
    }
  })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  const there = await waitFor(page, `!!document.querySelector('[data-kb="newchat-shelf"]')`, 25000)
  if (!swap.report().every((r) => r.replaced === true)) { console.error('○ not run: the served plugin text differs from the shared tree (uncommitted edits there?): ' + JSON.stringify(swap.report())); await live.close(); cleanup(); process.exit(3) }
  if (there === null) { console.error('○ not run: no blank chat with the shelf on screen'); await live.close(); cleanup(); process.exit(3) }

  console.log('New chat page — this checkout in the real GUI' + (picsDir === null ? ' (no pictures: every card shows its type tile)' : ' (with pictures)'))
  await sleep(800)
  await shot('01-home')
  const still0 = await stillness()

  // ── the types: all in view, under the composer, one colour ───────────────────────────────────────────────────────────
  const cards = await ev(`[...document.querySelectorAll('.kb8-sl-card')].map((c) => ({ id: c.dataset.id, label: c.innerText.trim(), svg: !!c.querySelector('svg'), w: Math.round(c.getBoundingClientRect().width), vis: c.getBoundingClientRect().width > 0 }))`)
  check('the shelf shows the types, each with a drawing and a name', Array.isArray(cards) && cards.length >= 8 && cards.every((c) => c.svg && c.label.length > 0 && c.vis), cards)
  const core = ['doc', 'sheet', 'image', 'website', 'automation', 'team', 'skill', 'plugin']
  check('the core types are always there', core.every((id) => cards.some((c) => c.id === id)), cards.map((c) => c.id))
  const tagged = await ev(`[...document.querySelectorAll('.kb8-sl-card')].map((c) => { const t = c.querySelector('.kb8-sl-tag'); return { id: c.dataset.id, tag: t === null ? '' : t.textContent.trim() } })`)
  check('the whole range is shown, Audio and Game included', ['slides', 'doc', 'sheet', 'dashboard', 'image', 'video', 'audio', 'model3d', 'app', 'game', 'website', 'miniapp', 'automation', 'team', 'skill', 'plugin'].every((id) => cards.some((c) => c.id === id)), cards.map((c) => c.id))
  check('Audio and Game say they are coming, and a type the install can make carries no tag', ['audio', 'game'].every((id) => (tagged.find((c) => c.id === id) || {}).tag === 'Soon') && core.every((id) => (tagged.find((c) => c.id === id) || {}).tag === ''), tagged)
  const typeGrid = await ev(`(() => { const r = [...document.querySelectorAll('.kb8-sl-card')].map((c) => { const b = c.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top) } }); const rows = {}; r.forEach((p) => { (rows[p.y] = rows[p.y] || []).push(p.x) }); const ys = Object.keys(rows).map(Number).sort((a, b) => a - b); return { rows: ys.map((y) => rows[y].length), columns: new Set(r.map((p) => p.x)).size } })()`)
  check('the type cards sit in an even grid: the same count on every row but the last, one column line each', typeGrid !== null && typeGrid.rows.length >= 1 && typeGrid.rows.slice(0, -1).every((n) => n === typeGrid.rows[0]) && typeGrid.rows[typeGrid.rows.length - 1] <= typeGrid.rows[0] && typeGrid.columns === typeGrid.rows[0], typeGrid)
  check('no slider is left: no track, no arrows, no chapter heads', (await ev(`document.querySelectorAll('.kb8-sl-track,.kb8-sl-nav,.kb8-sl-gh,[data-kb="newchat-slider"]').length`)) === 0)
  const geo = await ev(`(() => { const s = document.querySelector('[data-kb="newchat-shelf"]').getBoundingClientRect(); const e = document.querySelector('[data-composer-card]'); const c = e ? e.getBoundingClientRect() : null; const t = document.querySelector('.kb8-sh-types'); return { top: s.top, composerBottom: c ? c.bottom : null, left: s.left, composerLeft: c ? c.left : null, right: s.right, composerRight: c ? c.right : null, overflow: document.documentElement.scrollWidth - window.innerWidth, typesOverflow: t.scrollWidth - t.clientWidth } })()`)
  check('the shelf is drawn UNDER the composer card (CSS order, no engine patch)', geo !== null && geo.composerBottom !== null && geo.top >= geo.composerBottom - 1, geo)
  check('and stays inside the composer\'s width', geo !== null && geo.left >= geo.composerLeft - 24 && geo.right <= geo.composerRight + 24, geo)
  check('the page does not scroll sideways, and the types do not either', geo !== null && geo.overflow <= 0 && geo.typesOverflow <= 1, geo)
  check('nothing is lit and no example is shown before a type is picked', (await ev(`document.querySelectorAll('.kb8-sl-card.is-on,.kb8-sl-card.is-match,[data-kb="newchat-examples"]').length`)) === 0)
  check('the old Build / Create cards and gradient tiles are gone', (await ev(`document.querySelectorAll('[data-kb="newchat-build"],[data-kb="newchat-create"],.kb8-nc-art,.kb8-nc-row').length`)) === 0)
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
  check('one colour: every fill and stroke of the type drawings is a grey or the theme\'s accent', colour !== null && colour.stray.length === 0, colour)

  // ── the little motion on hover ────────────────────────────────────────────────────────────────────────────────────────
  const h = await centre('.kb8-sl-card[data-id="doc"]')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y })
  await sleep(250)
  check('hovering a type plays its little motion', (await ev(`document.querySelector('.kb8-sl-card[data-id="doc"]').getAnimations({ subtree: true }).length`)) > 0)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

  // ── it listens ───────────────────────────────────────────────────────────────────────────────────────────────────────
  await click('[contenteditable="true"], textarea')
  await sleep(200)
  await page.send('Input.insertText', { text: 'a landing page for my bakery' })
  await sleep(900)
  const lit = await ev(`(() => { const m = document.querySelector('.kb8-sl-card.is-match'); return m ? m.dataset.id : null })()`)
  check('typing « a landing page… » lights the Website type', lit === 'website', lit)
  await shot('02-listening')
  const still1 = await stillness()
  check('and moves nothing else (the composer stays where it was)', still1.moved.length === 0 && still1.cardLeft === still0.cardLeft, { before: still0, after: still1 })
  await clearDraft()
  check('with the text gone nothing is lit', (await ev(`document.querySelectorAll('.kb8-sl-card.is-match').length`)) === 0)

  // ── a type: lit and larger, the others quiet; its examples appear; the composer is filled, never sent ──────────────────
  await clickType('doc')
  await sleep(700)
  const typed = await draft()
  check('a click on a type fills the composer with its sentence', typeof typed === 'string' && typed.trim().length > 8 && !/undefined|null/.test(typed), typed)
  check('and nothing is sent: the blank chat and its shelf are still there', (await ev(`!!document.querySelector('[data-kb="newchat-shelf"]')`)) === true)
  const sizes = await ev(`(() => { const on = document.querySelector('.kb8-sl-card.is-on'); const other = document.querySelector('.kb8-sl-card:not(.is-on)'); if (!on || !other) return null; const a = on.getBoundingClientRect(), b = other.getBoundingClientRect(); return { on: on.dataset.id, onW: Math.round(a.width), otherW: Math.round(b.width), onOpacity: getComputedStyle(on).opacity, otherOpacity: getComputedStyle(other).opacity, pressed: on.getAttribute('aria-pressed') } })()`)
  check('the lit type is larger and the others are dimmed', sizes !== null && sizes.on === 'doc' && sizes.pressed === 'true' && sizes.onW > sizes.otherW && Number(sizes.otherOpacity) < Number(sizes.onOpacity), sizes)
  const grid = await ev(`(() => { const s = document.querySelector('[data-kb="newchat-examples"]'); if (!s) return null; const cs = [...s.querySelectorAll('.kb8-sh-card')]; return { n: cs.length, named: cs.every((c) => c.querySelector('.kb8-sh-name') && c.querySelector('.kb8-sh-name').innerText.trim().length > 0 && c.querySelector('.kb8-sh-line') && c.querySelector('.kb8-sh-line').innerText.trim().length > 0), imgs: s.querySelectorAll('.kb8-sh-thumb img').length, tiles: s.querySelectorAll('.kb8-sh-thumb .kb8-sh-tile').length, below: s.getBoundingClientRect().top >= document.querySelector('.kb8-sh-types').getBoundingClientRect().bottom - 1, head: s.querySelector('.kb8-sh-h h2').innerText } })()`)
  check('the examples of the lit type appear under the types, each with a name and a line', grid !== null && grid.n >= 6 && grid.named === true && grid.below === true, grid)
  if (picsDir === null) check('without pictures every card shows the type\'s own tile (never an empty box)', grid !== null && grid.imgs === 0 && grid.tiles === grid.n, grid)
  else {
    await sleep(1200)
    // A folder of pictures may hold only some examples' (a lot of one type): a card shows its picture where the folder has it, and the type's own tile everywhere else.
    const held = new Set(readdirSync(join(resolve(picsDir), 'shelf')).filter((f) => f.endsWith('.webp')))
    const cards = await ev(`[...document.querySelectorAll('[data-kb="newchat-examples"] .kb8-sh-card')].map((c) => { const i = c.querySelector('.kb8-sh-thumb img'); const r = i ? i.getBoundingClientRect() : null; return { id: c.dataset.id, img: !!i && i.complete && i.naturalWidth > 0, tile: !!c.querySelector('.kb8-sh-tile'), r: r ? Math.round(r.width / Math.max(1, r.height) * 100) / 100 : 0 } })`)
    const want = Array.isArray(cards) ? cards.filter((c) => held.has(c.id + '.webp')) : []
    check('with pictures every card that has one shows it at its own proportion, and the others show the type\'s tile', Array.isArray(cards) && cards.length > 0 && cards.every((c) => (held.has(c.id + '.webp') ? c.img && c.r > 1.2 && c.r < 2 : c.tile && !c.img)), cards)
    check('only the card pictures were asked of the host (the larger ones wait for a click)', want.length === 0 ? asked.images.length === 0 : asked.images.length > 0 && asked.images.every((f) => f.indexOf('large/') !== 0), asked.images.slice(0, 4))
  }
  await shot('03-doc')
  check('picking a type moves nothing else', (await stillness()).moved.length === 0)

  // ── the dialog ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const first = await ev(`document.querySelector('.kb8-sh-card').dataset.id`)
  const before = await draft()
  await clickExample(first)
  await sleep(700)
  const dlg = await ev(`(() => { const d = document.querySelector('[data-kb="newchat-example-dialog"]'); if (!d) return null; const r = d.getBoundingClientRect(); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), title: d.querySelector('h3').innerText, req: d.querySelector('.kb8-sh-req p').innerText, focusOnClose: document.activeElement && document.activeElement.getAttribute('data-kb') === 'newchat-example-close', inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, inBody: d.closest('[data-kb="newchat"]') === null } })()`)
  check('a click on an example opens its dialog (a named modal, in the page body, fully on screen)', dlg !== null && dlg.role === 'dialog' && dlg.modal === 'true' && dlg.title.length > 0 && dlg.inBody === true && dlg.inView === true, dlg)
  check('the dialog shows the request the example starts from, and the focus goes to its close button', dlg !== null && dlg.req.length > 20 && dlg.focusOnClose === true, dlg)
  check('opening it does not touch the composer', (await draft()) === before)
  await shot('04-dialog')
  await key('Tab', 'Tab', 9)
  const inside = await ev(`!!document.activeElement && !!document.activeElement.closest('[data-kb="newchat-example-dialog"]')`)
  check('Tab stays inside the dialog', inside === true)
  await key('Escape', 'Escape', 27)
  await sleep(400)
  check('Escape closes it and the focus goes back to the card', (await ev(`!document.querySelector('[data-kb="newchat-example-dialog"]') && document.activeElement && document.activeElement.getAttribute('data-id') === ${JSON.stringify(first)}`)) === true)
  await clickExample(first)
  await sleep(500)
  await click('[data-kb="newchat-example-use"]')
  await sleep(600)
  const used = await draft()
  check('« Use this request » puts the example\'s request in the composer and closes the dialog', typeof used === 'string' && used !== before && used.trim().length > 20 && (await ev(`!document.querySelector('[data-kb="newchat-example-dialog"]')`)) === true, used)
  check('and still nothing is sent', (await ev(`!!document.querySelector('[data-kb="newchat-shelf"]')`)) === true)

  // ── another type replaces what the page wrote; the person's own words stay ─────────────────────────────────────────────
  await clickType('sheet')
  await sleep(600)
  const doc = await draft()
  check('another type replaces the sentence the page wrote (no pile-up)', typeof doc === 'string' && doc !== used && doc.indexOf(used.slice(0, 30)) < 0, doc)
  await clearDraft()
  await page.send('Input.insertText', { text: 'my own words' })
  await sleep(300)
  await clickType('website')
  await sleep(600)
  const kept = await draft()
  check('a type keeps the words already typed (after the sentence)', typeof kept === 'string' && kept.indexOf('my own words') > 0, kept)
  await clearDraft()
  check('the composer is empty again, and the lit type goes with the text', ((await draft()) || '').trim() === '' && (await ev(`document.querySelectorAll('.kb8-sl-card.is-on').length`)) === 0)

  // ── a generated example: its prompt, the model that made it, « Use this prompt » and « Remix » ───────────────────────────────
  await clickType('image')
  await sleep(700)
  const gen = await ev(`(() => { const c = document.querySelector('[data-kb="newchat-examples"] .kb8-sh-card'); return c ? c.dataset.id : null })()`)
  if (gen === null) console.log('  (no image example here: the generated-example checks are skipped)')
  else {
    await clickExample(gen)
    await sleep(700)
    const g = await ev(`(() => { const d = document.querySelector('[data-kb="newchat-example-dialog"]'); if (!d) return null; const m = d.querySelector('[data-kb="newchat-example-made"]'); return { made: m ? m.innerText : '', model: m ? m.title : '', prompt: d.querySelector('.kb8-sh-req p').innerText, remix: !!d.querySelector('[data-kb="newchat-example-remix"]'), adapt: !!d.querySelector('[data-kb="newchat-example-adapt"]') } })()`)
    if (g === null || g.made === '') { console.log('  (the first image example was not generated here: the generated-example checks are skipped)'); await key('Escape', 'Escape', 27); await sleep(400) }
    else {
      await shot('04b-generated-dialog')
      check('a generated example names its model and size, and offers Remix next to Use (not the App\'s Adapt)', /\d+\u00d7\d+/.test(g.made) && g.model.indexOf('/') > 0 && g.remix === true && g.adapt === false && g.prompt.length > 40, g)
      await click('[data-kb="newchat-example-remix"]')
      await sleep(600)
      const mixed = await draft()
      check('« Remix » puts the example\'s prompt in the composer, with room to say what to change, and closes the dialog', typeof mixed === 'string' && mixed.indexOf(g.prompt) > 0 && mixed.trim().length > g.prompt.length + 10 && (await ev(`!document.querySelector('[data-kb="newchat-example-dialog"]')`)) === true, mixed)
      await clearDraft()
    }
  }
  await clearDraft()

  // ── the App type: only what this install can really start ───────────────────────────────────────────────────────────────
  const hasApp = cards.some((c) => c.id === 'app')
  if (hasApp) {
    await clickType('app')
    await sleep(1200)
    const apps = await ev(`[...document.querySelectorAll('[data-kb="newchat-examples"] .kb8-sh-card')].map((c) => c.dataset.id)`)
    check('the App type lists the simple starts and no idea the product does not ship (restaurant, fitness, salon)', Array.isArray(apps) && apps.length >= 3 && !apps.some((id) => /restaurant|fitness|salon/.test(id)), apps)
    const target = Array.isArray(apps) ? apps[0] : null
    if (target) {
      await clickExample(target)
      await sleep(600)
      const isApp = await ev(`!!document.querySelector('.kb8-sh-tabs')`)
      check('an App example has a Result and a Structure tab', isApp === true)
      await click('.kb8-sh-tab:nth-child(2)')
      await sleep(400)
      const map = await ev(`(() => { const m = document.querySelector('.kb8-sh-map'); if (!m) return null; return { boxes: m.querySelectorAll('rect.box').length, lines: m.querySelectorAll('line.ln').length, inside: [...m.querySelectorAll('rect.box')].every((r) => { const b = r.getBBox(); return b.x >= 0 && b.x + b.width <= 320 && b.y >= 0 && b.y + b.height <= 200 }) } })()`)
      check('the Structure tab draws the tables as boxes inside the frame', map !== null && map.boxes >= 2 && map.inside === true, map)
      await shot('05-app-structure')
      const acts = await ev(`[...document.querySelectorAll('.kb8-sh-acts button')].map((b) => b.innerText.trim())`)
      check('the dialog offers to use the template and to adapt it with Kaby (looked at, not pressed: no app is created here)', Array.isArray(acts) && acts.length === 2, acts)
      await key('Escape', 'Escape', 27)
      await sleep(300)
    }
    await clearDraft()
  } else console.log('  ○ no App type here (the Tables bundle is off): the App checks are skipped')

  // ── the other ends: a phone, the dark look ──────────────────────────────────────────────────────────────────────────────
  await clickType('doc')
  await sleep(500)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await sleep(600)
  await shot('06-dark')
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(900)
  const phone = await ev(`(() => { const t = document.querySelector('.kb8-sh-types'); const g = document.querySelector('.kb8-sh-grid'); return { overflow: document.documentElement.scrollWidth - window.innerWidth, typesOverflow: t ? t.scrollWidth - t.clientWidth : null, gridCols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : null, cardsInView: [...document.querySelectorAll('.kb8-sh-card')].every((c) => { const r = c.getBoundingClientRect(); return r.right <= window.innerWidth + 1 }) } })()`)
  check('on a phone the page does not scroll sideways and the example cards fit', phone !== null && phone.overflow <= 0 && (phone.typesOverflow === null || phone.typesOverflow <= 1) && phone.cardsInView === true, phone)
  await shot('07-phone')
  await clickExample(await ev(`document.querySelector('.kb8-sh-card').dataset.id`))
  await sleep(600)
  const pd = await ev(`(() => { const d = document.querySelector('[data-kb="newchat-example-dialog"]'); if (!d) return null; const r = d.getBoundingClientRect(); const b = document.querySelector('[data-kb="newchat-example-use"]'); const br = b ? b.getBoundingClientRect() : null; return { fits: r.left >= 0 && r.right <= window.innerWidth + 1, left: Math.round(r.left), right: Math.round(r.right), iw: window.innerWidth, sw: document.documentElement.clientWidth, cs: (() => { const c = getComputedStyle(d); return [c.position, c.width, c.marginLeft, c.marginRight, c.left, c.right, c.boxSizing, c.transform, c.maxWidth].join(' ') })(), layer: (() => { const l = d.parentElement.getBoundingClientRect(); return [Math.round(l.left), Math.round(l.right)].join('/') })(), scrolls: d.scrollHeight > d.clientHeight, useVisible: br !== null && br.width > 0 } })()`)
  check('on a phone the dialog fits the width and its main button can be reached', pd !== null && pd.fits === true && pd.useVisible === true, pd)
  await shot('08-phone-dialog')
  await key('Escape', 'Escape', 27)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await clearDraft()

  // ── the host was asked once, and a reload leaves nothing behind ─────────────────────────────────────────────────────────
  check('the catalogue was asked of the host (once per page load, not once per click)', asked.catalogue >= 1 && asked.catalogue <= 3, asked.catalogue)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  await waitFor(page, `!!document.querySelector('[data-kb="newchat-shelf"]')`, 25000)
  check('after a reload the blank chat\'s composer is empty (the draft did not outlive the check)', ((await draft()) || '').trim() === '', await draft())

  // ── the Cloud Computer line (only when the cloud bundle answers) ────────────────────────────────────────────────────────
  const cloud = await ev(`(() => { const c = document.querySelector('[data-kb="newchat-cloud"]'); if (!c) return null; const s = document.querySelector('[data-kb="newchat-shelf"]').getBoundingClientRect(), r = c.getBoundingClientRect(); return { below: r.top >= s.bottom - 1, h: Math.round(r.height), text: c.innerText.replace(/\\s+/g, ' ').trim() } })()`)
  if (cloud !== null) check('the Cloud Computer is one quiet line under the shelf', cloud.below === true && cloud.h <= 60 && cloud.text.length > 0, cloud)
  else console.log('  ○ no Cloud Computer line (the cloud bundle says nothing here)')
} catch (e) {
  failures.push('the check itself crashed: ' + e.message)
  console.log('  ✗ ' + e.message)
}
await live.close()
cleanup()
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)
