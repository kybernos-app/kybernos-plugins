#!/usr/bin/env node
// Checks the FIXED main menu against the REAL GUI of the SANDBOX: the seven rows in their order (Dashboards, Automations, Connectors, Skills, Agent Teams, Apps, Creations),
// no « Business » header, no Templates row, no Overview row; rows a plugin declares sit flat after the Apps row, open their page and are the selected one; the core rows
// still work; a row that goes away takes its page with it; Apps opens the gallery. Everything is measured (rectangles), nothing is taken on trust.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-menu-business-live.mjs [--shots <dir>]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080. The rows it declares are fake, live in the throw-away page only, and nothing is written to a profile.
// The page of a declared row has no plugin behind it here, so the honest empty line is what must show. --shots <dir>: one PNG per state (kept outside git: media never
// go in the repository). Exit code: 0 all green, 1 a check failed, 3 inconclusive (no sandbox).
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
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
/** A real mouse click at the centre of the first element that matches. */
const click = async (sel) => {
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(450)
  return true
}
const ROWS = `[...document.querySelectorAll('.kb4-menu .kb4-item')]`
const labels = () => ev(`${ROWS}.map((e) => e.getAttribute('aria-label'))`)
const selected = () => ev(`${ROWS}.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('aria-label'))`)
const row = (label) => `.kb4-menu .kb4-item[aria-label="${label}"]`
// Dashboards and Apps are Creations sources now (docs/dev/creation-sources.md): their rows leave the menu while the sources are declared.
const FIXED = ['Automations', 'Connectors', 'Skills', 'Agent Teams', 'Creations']
const A = { id: 'checka', group: 'business', icon: 'users', labelKey: 'check.a', label: { en: 'Check Alpha', fr: 'Contrôle Alpha' } }
const B = { id: 'checkb', group: 'business', icon: 'package', labelKey: 'check.b', label: { en: 'Check Beta', fr: 'Contrôle Bêta' } }

try {
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(2500)
  if ((await rect('.kb4-menu')) === null) { console.error('○ inconclusive: the menu is not on the page'); process.exit(3) }
  await ev(`(() => { window.__chk = { errs: [], off: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason))); return 1 })()`)

  console.log('the fixed menu')
  const l0 = await labels()
  check('the rows are Automations, Connectors, Skills, Agent Teams, Creations, in that order (Dashboards and Apps are in Creations)', JSON.stringify(l0) === JSON.stringify(FIXED), l0)
  check('no Business header, no fold, no Templates row, no Overview row', (await ev(`document.querySelector('[data-kb="menu-business"], .kb4-grph, #kb4-biz-rows') === null`)) === true && !l0.some((l) => /^(Templates|Overview|Business)$/i.test(l)), l0)
  const rects = await ev(`${ROWS}.map((e) => { const r = e.getBoundingClientRect(); const i = e.querySelector('.kb4-ico').getBoundingClientRect(); const l = e.querySelector('.kb4-lab'); return { y: r.top, w: r.width, h: r.height, icoX: i.left, lab: l.scrollWidth <= l.clientWidth + 1 } })`)
  check('every row is as tall and as wide as its neighbours, its icon is aligned and its label is not cut', rects.every((r) => Math.abs(r.h - rects[0].h) <= 1 && Math.abs(r.w - rects[0].w) <= 1 && Math.abs(r.icoX - rects[0].icoX) <= 1 && r.lab === true), rects)
  check('they are laid one under the other with no gap that would be a header', rects.every((r, i) => i === 0 || r.y - rects[i - 1].y <= rects[0].h + 8), rects.map((r) => r.y))
  check('the registry holds the Apps row, and the menu does not scroll sideways', (await ev(`window.__KB_MENU__.v === 1 && window.__KB_MENU__.ids().indexOf('tables') >= 0 && (() => { const m = document.querySelector('.kb4-menu'); return m.scrollWidth <= m.clientWidth + 1 })()`)) === true)
  await shot('01-fixed-menu')

  console.log('Apps opens the gallery')
  check('the Apps page is opened (it is reached from Creations now)', (await ev(`window.__KB_OPEN__({ view: 'tables' }) === true`)) === true)
  await waitFor(page, `document.querySelector('[data-kb="apps-gallery"]') !== null`, 8000).catch(() => null)
  check('the gallery is on screen and Creations is the one selected row', (await ev(`document.querySelector('[data-kb="apps-gallery"]') !== null`)) === true && JSON.stringify(await selected()) === JSON.stringify(['Creations']), await selected())
  await shot('02-apps')

  console.log('rows a plugin declares sit flat after Agent Teams')
  const refused = await ev(`(() => window.__KB_MENU__.register({ id: 'themes', group: 'business', icon: 'users', labelKey: 'x' }) === null)()`)
  check('a row that takes the id of a core page is refused and nothing appears', refused === true && JSON.stringify(await labels()) === JSON.stringify(FIXED))
  const declared = await ev(`(() => { window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(A)})); window.__chk.off.push(window.__KB_MENU__.register(${JSON.stringify(B)})); return window.__chk.off.every((f) => typeof f === 'function') })()`)
  check('both rows are accepted', declared === true)
  await waitFor(page, `${ROWS}.some((e) => /Alpha/.test(e.getAttribute('aria-label') || ''))`, 6000)
  await sleep(300)
  const l1 = await labels()
  check('they follow Agent Teams, in the order declared, before Creations, and no header came with them', JSON.stringify(l1) === JSON.stringify(['Automations', 'Connectors', 'Skills', 'Agent Teams', 'Check Alpha', 'Check Beta', 'Creations']) && (await ev(`document.querySelector('[data-kb="menu-business"], .kb4-grph') === null`)) === true, l1)
  await shot('03-declared')
  check('the first declared row is clicked', (await click(row('Check Alpha'))) === true)
  check('its page is on screen (no plugin here, so the honest line)', (await ev(`(() => { const p = document.querySelector('[data-kb-page="checka"]'); return p !== null && /not available|pas disponible/.test(p.textContent) })()`)) === true)
  const sel = await selected()
  check('it is the one selected row', Array.isArray(sel) && sel.length === 1 && sel[0] === 'Check Alpha', sel)

  console.log('the core rows still work')
  check('Skills is clicked with the mouse', (await click(row('Skills'))) === true)
  const sel2 = await selected()
  check('it becomes the one selected row and the declared page is gone', JSON.stringify(sel2) === JSON.stringify(['Skills']) && (await ev(`document.querySelector('[data-kb-page="checka"]') === null`)) === true, sel2)
  check('the second declared row opens its own page', (await click(row('Check Beta'))) === true && (await ev(`document.querySelector('[data-kb-page="checkb"]') !== null`)) === true)
  check('window.__KB_OPEN__.views lists the declared rows next to the core\'s', (await ev(`(() => { const v = window.__KB_OPEN__.views; return v.indexOf('checka') >= 0 && v.indexOf('checkb') >= 0 && v.indexOf('skills') >= 0 && v.indexOf('tables') >= 0 })()`)) === true)

  console.log('a plugin that goes away takes its rows with it')
  await ev(`(() => { window.__chk.off.forEach((f) => f()); return 1 })()`)
  await sleep(400)
  check('the declared rows are gone, the fixed menu is back', JSON.stringify(await labels()) === JSON.stringify(FIXED), await labels())
  check('the page of a row that is gone is no longer on screen, and the area is not left empty', (await ev(`document.querySelector('[data-kb-page="checkb"]') === null && (() => { const m = document.querySelector('.kb4-menu'); const r = m.getBoundingClientRect(); const main = document.elementFromPoint(r.right + 200, 60); return main !== null && main.closest('.kb4-menu') === null && (document.body.innerText || '').length > 200 })()`)) === true)
  await shot('04-after-removal')

  console.log('the door the Apps page reads its templates through')
  const door = await ev(`(() => { const t = window.__KB_TEMPLATES__; return t !== undefined && t.v === 1 && Object.isFrozen(t) && typeof t.list === 'function' && typeof t.add === 'function' })()`)
  check('window.__KB_TEMPLATES__ is published, versioned and frozen, with list and add', door === true)
  const errs = await ev(`window.__chk.errs`)
  check('no script error from first to last', Array.isArray(errs) && errs.length === 0, errs)
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
