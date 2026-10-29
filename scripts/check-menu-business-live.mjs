#!/usr/bin/env node
// Checks the « Business » group of the main menu against the REAL GUI of the SANDBOX: with two rows declared from the page the group appears under the
// core rows, it folds and opens with a real mouse (and keeps its state across a reload), its folded header carries the badge, a row opens its page and is
// the selected one, and the rows of the core still work. Everything is measured (rectangles), nothing is taken on trust.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-menu-business-live.mjs [--shots <dir>]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080. The rows it declares are fake, live in the throw-away page only, and nothing is written to a
// profile. The page of a declared row has no plugin behind it here, so the honest empty line is what must show (a real page arrives with the plugins' own
// lots). --shots <dir>: one PNG per state (kept outside git: media never go in the repository). Exit code: 0 all green, 1 a check failed,
// 3 inconclusive (no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ inconclusive: sandbox only. Run `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
/** A real mouse click at the centre of the first element that matches. */
const click = async (sel) => {
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(350)
  return true
}
const ROWS = `[...document.querySelectorAll('.kb4-menu .kb4-item')]`
const coreLabels = () => ev(`${ROWS}.filter((e) => e.closest('[data-kb="menu-business"]') === null).map((e) => e.getAttribute('aria-label'))`)
const businessLabels = () => ev(`${ROWS}.filter((e) => e.closest('[data-kb="menu-business"]') !== null).map((e) => e.getAttribute('aria-label'))`)
const selected = () => ev(`${ROWS}.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('aria-label'))`)
const HEAD = '[data-kb="menu-business"] .kb4-grph'
const BODY = '#kb4-biz-rows'
const A = { id: 'checka', group: 'business', icon: 'users', labelKey: 'check.a', label: { en: 'Check Alpha', fr: 'Contrôle Alpha' } }
const B = { id: 'checkb', group: 'business', icon: 'package', labelKey: 'check.b', label: { en: 'Check Beta', fr: 'Contrôle Bêta' } }

try {
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(2500)
  if ((await rect('.kb4-menu')) === null) { console.error('○ inconclusive: the menu is not on the page'); process.exit(3) }
  await ev(`(() => { window.__chk = { errs: [], off: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason))); return 1 })()`)

  console.log('before any plugin declares a row')
  const core0 = await coreLabels()
  check('the registry is on the page, versioned 1, and empty', (await ev(`window.__KB_MENU__ !== undefined && window.__KB_MENU__.v === 1 && window.__KB_MENU__.ids().length === 0`)) === true)
  check('no group is drawn (a profile without business plugins has the menu it had)', (await rect('[data-kb="menu-business"]')) === null)
  check('the menu has its core rows (' + (Array.isArray(core0) ? core0.length : '?') + ')', Array.isArray(core0) && core0.length >= 5, core0)
  const core0Rects = await ev(`${ROWS}.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })`)
  const rowH = core0Rects[0][3]
  const lastCoreBottom = Math.max(...core0Rects.map((r) => r[1] + r[3]))
  await shot('01-before')

  console.log('two rows declared from the page')
  const refused = await ev(`(() => { const r = window.__KB_MENU__.register({ id: 'themes', group: 'business', icon: 'users', labelKey: 'x' }); return r === null && window.__KB_MENU__.ids().length === 0 })()`)
  check('a row that takes the id of a core page is refused and nothing appears', refused === true && (await rect('[data-kb="menu-business"]')) === null)
  const declared = await ev(`(() => { window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(A)})); window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(B)})); return window.__chk.off.every((f) => typeof f === 'function') })()`)
  check('both rows are accepted', declared === true)
  await waitFor(page, `document.querySelector('[data-kb="menu-business"]') !== null`, 6000)
  await sleep(300)
  const head = await rect(HEAD)
  const body = await rect(BODY)
  check('the group appears, with its header and its rows', head !== null && head.shown === true && body !== null && body.shown === true, { head, body })
  check('the core rows are the same as before, in the same places', JSON.stringify(await coreLabels()) === JSON.stringify(core0) && JSON.stringify((await ev(`${ROWS}.filter((e) => e.closest('[data-kb="menu-business"]') === null).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })`))) === JSON.stringify(core0Rects))
  check('the group sits under the last core row, inside the menu', head.y >= lastCoreBottom - 1, { head: head.y, lastCoreBottom })
  const biz = await businessLabels()
  check('its rows carry the plugin\'s own words, in order', JSON.stringify(biz) === JSON.stringify(['Check Alpha', 'Check Beta']) || JSON.stringify(biz) === JSON.stringify(['Contrôle Alpha', 'Contrôle Bêta']), biz)
  const rowRects = await ev(`${ROWS}.filter((e) => e.closest('[data-kb="menu-business"]') !== null).map((e) => { const r = e.getBoundingClientRect(); const i = e.querySelector('.kb4-ico').getBoundingClientRect(); const s = e.querySelector('.kb4-ico svg'); const l = e.querySelector('.kb4-lab'); return { x: r.left, y: r.top, w: r.width, h: r.height, icoX: i.left, svg: s === null ? null : Math.round(s.getBoundingClientRect().width), lab: l.scrollWidth <= l.clientWidth + 1 } })`)
  check('a business row is as tall as a core row', rowRects.every((r) => Math.abs(r.h - rowH) <= 1), { rowH, rows: rowRects.map((r) => r.h) })
  check('and as wide, and its icon is aligned with the core rows\' icons', rowRects.every((r) => Math.abs(r.w - core0Rects[0][2]) <= 1 && Math.abs(r.icoX - (core0Rects[0][0] + (rowRects[0].icoX - rowRects[0].x))) <= 1), rowRects)
  check('each row draws its icon (a svg of the menu\'s size) and its label is not cut', rowRects.every((r) => r.svg !== null && r.svg >= 14 && r.svg <= 18 && r.lab === true), rowRects)
  check('the header is a little shorter than a row, never taller', head.h >= rowH * 0.8 && head.h <= rowH + 1, { head: head.h, rowH })
  check('and as wide as the rows', Math.abs(head.w - core0Rects[0][2]) <= 1, { head: head.w, row: core0Rects[0][2] })
  check('the menu does not scroll sideways', (await ev(`(() => { const m = document.querySelector('.kb4-menu'); return m.scrollWidth <= m.clientWidth + 1 })()`)) === true)
  check('the header says it is open and what it controls', (await ev(`(() => { const h = document.querySelector(${JSON.stringify(HEAD)}); return h.getAttribute('aria-expanded') === 'true' && document.getElementById(h.getAttribute('aria-controls')) !== null })()`)) === true)
  const chev = await ev(`getComputedStyle(document.querySelector('.kb4-grpchev')).transform`)
  check('the chevron points down while open', chev === 'none' || /^matrix\(1, 0, 0, 1,/.test(chev), chev)
  await shot('02-open')

  console.log('folding it with a real mouse')
  check('the header is clicked', (await click(HEAD)) === true)
  const folded = await rect(BODY)
  check('the rows are gone from the page (no height, not drawn)', folded === null || folded.shown === false, folded)
  check('the header says it is folded, and the chevron turned a quarter', (await ev(`(() => { const h = document.querySelector(${JSON.stringify(HEAD)}); const t = getComputedStyle(h.querySelector('.kb4-grpchev')).transform; return h.getAttribute('aria-expanded') === 'false' && /^matrix\\(0, -1, 1, 0,|^matrix\\(6\\.1/.test(t) })()`)) === true)
  check('the core rows did not move', JSON.stringify(await ev(`${ROWS}.filter((e) => e.closest('[data-kb="menu-business"]') === null).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })`)) === JSON.stringify(core0Rects))
  check('nothing waits yet: no badge on the header', (await rect('.kb4-grpcnt')) === null)
  check('the folded state is kept in the browser', (await ev(`localStorage.getItem('kybernos.menu.business.collapsed.v1')`)) === '1')
  await shot('03-folded')

  console.log('the folded header speaks for its rows')
  await ev(`(() => { window.__KB_MENU_STATE__.set('checka', { review: 2 }); window.__KB_MENU_STATE__.set('checkb', { need: 1 }); return 1 })()`)
  await sleep(300)
  const pill = await rect('.kb4-grpcnt')
  const headF = await rect(HEAD)
  check('a badge with the total shows on the header', pill !== null && pill.shown === true && (await ev(`document.querySelector('.kb4-grpcnt').textContent`)) === '3', pill)
  check('it sits at the right end of the header, inside it', pill !== null && pill.r <= headF.r + 0.5 && pill.x > headF.x + headF.w / 2 && pill.y >= headF.y - 0.5 && pill.b <= headF.b + 0.5, { pill, headF })
  check('and says what it counts to a screen reader', (await ev(`/\\d/.test(document.querySelector('.kb4-grpcnt').getAttribute('aria-label') || '')`)) === true)
  await shot('04-folded-badge')
  await ev(`(() => { window.__KB_MENU_STATE__.set('checka', null); window.__KB_MENU_STATE__.set('checkb', { running: true }); return 1 })()`)
  await sleep(300)
  check('with nothing waiting but something working, a ring turns instead of the count', (await rect('.kb4-grpcnt')) === null && ((await rect(HEAD + ' .kb-spin')) || { shown: false }).shown === true)
  await ev(`(() => { window.__KB_MENU_STATE__.set('checkb', null); return 1 })()`)
  await sleep(200)

  console.log('it keeps its state across a reload')
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(2500)
  await ev(`(() => { window.__chk = { errs: [], off: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(A)})); window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(B)})); return 1 })()`)
  await waitFor(page, `document.querySelector('[data-kb="menu-business"]') !== null`, 6000)
  check('declared again after the reload, the group is still folded', (await ev(`document.querySelector(${JSON.stringify(HEAD)}).getAttribute('aria-expanded')`)) === 'false' && ((await rect(BODY)) || { shown: false }).shown === false)

  console.log('opening it again, and opening a page from it')
  check('the header is clicked', (await click(HEAD)) === true)
  const reopened = await rect(BODY)
  check('the rows are back where they were', reopened !== null && reopened.shown === true && Math.abs(reopened.y - body.y) <= 1, { reopened, body })
  check('the kept state follows', (await ev(`localStorage.getItem('kybernos.menu.business.collapsed.v1')`)) === '0')
  check('the first business row is clicked', (await click('[data-kb="menu-business"] .kb4-item')) === true)
  await sleep(500)
  check('its page is on screen (no plugin here, so the honest line)', (await ev(`(() => { const p = document.querySelector('[data-kb-page="checka"]'); return p !== null && /not available|pas disponible/.test(p.textContent) })()`)) === true)
  const sel = await selected()
  check('it is the one selected row, and no core row is', Array.isArray(sel) && sel.length === 1 && /Check Alpha|Contrôle Alpha/.test(sel[0]), sel)
  await shot('05-page')
  check('folded while its page is open, the header shows it holds the selected row', (await click(HEAD)) === true && (await ev(`document.querySelector(${JSON.stringify(HEAD)}).classList.contains('on')`)) === true)
  await shot('06-folded-holding')
  check('and opened again, the header is plain', (await click(HEAD)) === true && (await ev(`document.querySelector(${JSON.stringify(HEAD)}).classList.contains('on')`)) === false)

  console.log('the core rows still work')
  const skills = core0.find((l) => /^(Skills|Compétences)$/i.test(l))
  check('a core row is found (Skills)', typeof skills === 'string', core0)
  check('it is clicked with the mouse', (await click(`.kb4-menu .kb4-item[aria-label="${skills}"]`)) === true)
  await sleep(600)
  const sel2 = await selected()
  check('it becomes the selected row and the business row stops being it', Array.isArray(sel2) && sel2.length === 1 && sel2[0] === skills, sel2)
  check('the page of the business row is gone', (await ev(`document.querySelector('[data-kb-page="checka"]') === null`)) === true)
  check('the second business row opens its own page', (await click('[data-kb="menu-business"] .kb4-item:nth-of-type(2)')) === true && (await ev(`document.querySelector('[data-kb-page="checkb"]') !== null`)) === true)
  check('window.__KB_OPEN__.views lists the declared rows', (await ev(`(() => { const v = window.__KB_OPEN__.views; return v.indexOf('checka') >= 0 && v.indexOf('checkb') >= 0 && v.indexOf('skills') >= 0 })()`)) === true)

  console.log('the icon rail (the shell\'s class is emulated: the CSS keys on it)')
  await ev(`(() => { document.querySelector('.kb4-menu').parentElement.classList.add('zz-collapsed'); return 1 })()`)
  await ev(`(() => { const h = document.querySelector(${JSON.stringify(HEAD)}); if (h.getAttribute('aria-expanded') === 'true') h.click(); return 1 })()`)
  await sleep(300)
  check('the header is not drawn in the rail', ((await rect(HEAD)) || { shown: false }).shown === false)
  check('and the rows show even though the group is folded', ((await rect(BODY)) || { shown: false }).shown === true)
  await shot('07-rail')
  await ev(`(() => { document.querySelector('.kb4-menu').parentElement.classList.remove('zz-collapsed'); const h = document.querySelector(${JSON.stringify(HEAD)}); if (h.getAttribute('aria-expanded') === 'false') h.click(); return 1 })()`)

  console.log('a plugin that goes away takes its rows with it')
  await ev(`(() => { window.__chk.off.forEach((f) => f()); return 1 })()`)
  await sleep(400)
  check('the group is gone', (await rect('[data-kb="menu-business"]')) === null)
  check('the core rows are the ones we started with', JSON.stringify(await coreLabels()) === JSON.stringify(core0))
  check('the page of a row that is gone is no longer on screen', (await ev(`document.querySelector('[data-kb-page="checkb"]') === null`)) === true)
  check('and the area is not left empty (the core\'s own page takes over)', (await ev(`(() => { const m = document.querySelector('.kb4-menu'); const r = m.getBoundingClientRect(); const main = document.elementFromPoint(r.right + 200, 60); return main !== null && main.closest('.kb4-menu') === null && (document.body.innerText || '').length > 200 })()`)) === true)
  await shot('08-after-removal')
  const errs = await ev(`window.__chk.errs`)
  check('no script error from first to last', Array.isArray(errs) && errs.length === 0, errs)
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
