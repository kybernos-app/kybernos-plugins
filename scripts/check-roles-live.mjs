#!/usr/bin/env node
// The Roles tab of an Agent Team, on the REAL GUI (read-only on your machine).
//
//   node scripts/check-roles-live.mjs [--team <name>] [--shots <dir>]
//
// What is real: the DSH page, its theme and CSS, the team you name (default « Dev-Team »: it needs more than six roles to show the pager) and the model
// catalogue of your profile. What is swapped: the client of kybernos-plugin (this checkout's client.js replaces the one `dsh web` serves). Nothing is
// written: the checks only open, search, fold and page; the one write path they exercise (the review of unreachable roles) is run on a LOCAL role the
// tab keeps in the throw-away browser, and every non-GET request of the page is recorded and checked to hold no save, no portrait call.
//
// What it checks: Team faces on three lines (mode on the title line, Re-crop under the scene), Model management behind a gear (no section in the middle of
// the page), the members drawn with the app's own toolbar, cards, rows and pager (a card opens its role, details on hover), the four sections of a role (Voice
// is hidden, the Requirements icons are there), the model field (opens on the current value, groups with plans first, keyboard, search, fallback rules), a
// narrow column (no overflow), and the review of unreachable roles.
// Never named test-*.mjs: CI has no `dsh web` (see docs/dev/live-testing.md). Exit 0 all good, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const TEAM = arg('--team') || 'Dev-Team'
const shotsDir = arg('--shots')
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const pass = (name) => console.log('  ✓ ' + name)
const fail = (name, detail) => { failures += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : '  — ' + detail)) }
const check = (name, ok, detail) => (ok === true ? pass(name) : fail(name, detail))
const inconclusive = (why) => { console.log('\nInconclusive: ' + why); process.exit(3) }

let live = null
try { live = await openLivePage() } catch (e) { inconclusive(String(e && e.message ? e.message : e)) }
const { page } = live
const ev = async (expr) => { const r = await page.evalJs(expr); if (r.err !== undefined) throw new Error('page: ' + r.err + ' in ' + String(expr).slice(0, 140)); return r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { /* a missing screenshot never fails a check */ } } }
const code = { ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13 }
const key = async (k) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code[k] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code[k] })
}
// Presses again when the press was lost to a redraw (a busy machine moves the page under a click).
const step = async (label, expr, ms) => {
  for (let i = 0; i < 6; i += 1) {
    if (label !== null) { try { await clickText(page, label) } catch (e) { /* not drawn yet */ } }
    if ((await waitFor(page, expr, ms)) !== null) return true
  }
  return false
}
const js = (fn, ...a) => '(' + fn.toString() + ')(' + a.map((x) => JSON.stringify(x)).join(',') + ')'
// Elements of the tab whose box leaves the tab sideways and that no clipping parent hides.
const overflowing = () => ev(js(() => {
  const root = document.querySelector('.kbm-root')
  const r = root.getBoundingClientRect()
  const out = []
  for (const e of root.querySelectorAll('*')) {
    const b = e.getBoundingClientRect()
    if (b.width <= 0 || b.right <= r.right + 2) continue
    let p = e.parentElement; let clipped = false
    while (p && p !== root) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break } p = p.parentElement }
    if (clipped === false) out.push(e.tagName + '.' + String(e.className || '') + ' "' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 24) + '"')
  }
  return out.slice(0, 5).join(' | ')
}))
const optionText = () => ev(js(() => {
  const input = document.querySelector('.kbm-mf .kbm-cb-input')
  const id = input && input.getAttribute('aria-activedescendant')
  const el = id ? document.getElementById(id) : null
  return el ? el.innerText.replace(/\s+/g, ' ') : '-'
}))

try {
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', {})
  await sleep(2500)
  if ((await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)) === null) inconclusive('the GUI did not render')
  if (swap.report().every((x) => x.replaced === true) !== true) inconclusive('this checkout\'s client could not be swapped in (the shared tree has uncommitted edits of it)')
  await sleep(2000)
  const errors = []
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String(p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description).slice(0, 200)))
  if (await step('Agent Teams', 'document.body.innerText.indexOf(' + JSON.stringify(TEAM) + ') >= 0', 5000) !== true) inconclusive('no team named ' + TEAM + ' (use --team)')
  if (await step(TEAM, 'document.body.innerText.indexOf("Danger Zone") >= 0', 7000) !== true) inconclusive('the team page did not open')
  if (await step('Roles', '!!document.querySelector(".kbm-members .kbm-art")', 9000) !== true) inconclusive('the Roles tab did not draw')
  await ev('window.__writes = []; (() => { const of = window.fetch; window.fetch = function (u, o) { try { if (o && o.method && o.method !== "GET") window.__writes.push(String(u)) } catch (e) { /* none */ } return of.apply(this, arguments) } })(); 1')
  await shot('roles-top')

  console.log('Team faces')
  const imgField = await ev('!!document.querySelector(".kbm-faces .kbm-cb-input")')
  check('the image model is one searchable line (no radio list)', imgField === true && (await ev('document.querySelectorAll(".kbm-faces [role=radio], .kbm-faces input[type=radio]").length')) === 0)
  await ev('document.querySelector(".kbm-faces .kbm-cb-input").focus()')
  // the image models are fetched once the tab is up: give them a moment
  check('it opens a listbox with the image models', (await waitFor(page, 'document.querySelectorAll(".kbm-faces .kbm-cb-opt").length > 0', 8000)) !== null)
  // no data, nothing said: no « no price data », « price unknown », « Probe none » (the owner's rule, 2026-10-29)
  const noData = await ev(js(() => Array.from(document.querySelectorAll('.kbm-root *')).filter((e) => e.children.length === 0 && /no price data|price unknown|probe none|no probe|no benchmark/i.test(e.textContent)).map((e) => e.textContent.trim()).join(' | ')))
  check('a model with no data says nothing about it (no « no price data », « Probe none »)', noData === '', noData)
  await shot('roles-faces-open')
  await key('Escape'); await sleep(250)
  check('Esc closes it', (await ev('!document.querySelector(".kbm-cb-pop")')) === true)
  check('the mode sits on the title line and carries no call count', (await ev(js(() => { const m = document.querySelector('.kbm-facehead .kbm-mode'); return m !== null && !/call/i.test(m.innerText) && m.querySelectorAll('button').length === 2 }))) === true)
  const facesText = await ev('document.querySelector(".kbm-faces").innerText')
  check('the number of image calls reads beside Generate', /\d+ image calls?/.test(facesText), facesText.slice(0, 80))
  const haveFaces = Number((/(\d+)\/\d+ faces/.exec(facesText) || [0, 0])[1]) > 0
  check('Re-crop is a link under the scene, and only when faces exist', (await ev('!!document.querySelector(".kbm-faces .kbm-lnk")')) === haveFaces)

  console.log('Model management')
  check('no Model management section in the middle of the page', (await ev('!document.querySelector(".kbm-mm")')) === true)
  check('a gear in the toolbar is the way in', (await ev('!!document.querySelector(".kbm-mhead [data-kb=model-management]")')) === true)
  await ev('document.querySelector("[data-kb=model-management]").click()'); await sleep(400)
  const mmText = await ev('(document.querySelector(".kbm-gear-pop") || { innerText: "" }).innerText')
  check('it opens mode and priority, the route counts, no « coming soon » placeholder', /Mode/.test(mmText) && /Priority/.test(mmText) && /on your|on Kybernos|local|own keys/.test(mmText) && !/coming soon/i.test(mmText), mmText.slice(0, 120))
  await shot('roles-gear')
  await key('Escape'); await sleep(250)
  check('Esc closes it', (await ev('!document.querySelector(".kbm-gear-pop")')) === true)

  console.log('Team members')
  check('the toolbar is the app\'s own: search, cards and list, filters, Add a role', (await ev(js(() => { const t = document.querySelector('.kbm-mhead .kb6-toolbar'); return t !== null && t.querySelectorAll('.kb6-tb-vbtn').length === 2 && /Add a role/.test(t.innerText) && t.querySelector('[data-kb=toggle-search]') !== null }))) === true)
  const cards = Number(await ev('document.querySelectorAll(".kbm-cwrap").length'))
  const pager = await ev('(document.querySelector(".kb6-pager .kb6-pglabel") || { innerText: "" }).innerText')
  const pages = Number((/\/(\d+)/.exec(pager) || [0, 1])[1])
  if (pages > 1) {
    check('six cards on page 1 and the app\'s pager', cards === 6 && /Page 1\/\d+/.test(pager), cards + ' ' + pager)
    await ev('document.querySelectorAll(".kb6-pager .kb6-pgbtn")[1].click()'); await sleep(500)
    check('page 2 holds the others', /Page 2\//.test(await ev('document.querySelector(".kb6-pager .kb6-pglabel").innerText')) && Number(await ev('document.querySelectorAll(".kbm-cwrap").length')) > 0)
    await ev('document.querySelectorAll(".kb6-pager .kb6-pgbtn")[0].click()'); await sleep(400)
  } else pass('one page of roles: no pager (' + String(cards) + ' cards)')
  check('no custom bar, no carousel: the old controls are gone', (await ev('!document.querySelector(".kbm-bar") && !document.querySelector(".kbm-pg")')) === true)
  for (const view of ['list', 'cards']) {
    await ev('document.querySelector("[data-kb=view-' + view + ']").click()'); await sleep(500)
    check(view + ' view is drawn', (await ev('document.querySelectorAll(".' + (view === 'list' ? 'kbm-lwrap' : 'kbm-cwrap') + '").length')) > 0)
    check(view + ' has no sideways scroll', (await ev('(() => { const m = document.querySelector(".kbm-members"); return m.scrollWidth <= m.clientWidth + 1 })()')) === true)
  }
  await ev('document.querySelector(".kbm-mhead").scrollIntoView({ block: "start" })'); await sleep(300)
  const c0 = JSON.parse(await ev('JSON.stringify((() => { const r = document.querySelector(".kbm-cwrap .kb8-card").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())'))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c0.x, y: c0.y }); await sleep(500)
  check('hovering a card shows its details (primary, fallback, needs)', (await ev(js(() => { const t = document.querySelector('.kbm-cwrap .kbm-rtip'); return t !== null && getComputedStyle(t).display !== 'none' && /Primary/.test(t.innerText) && /Fallback/.test(t.innerText) && /Needs/.test(t.innerText) }))) === true)
  await shot('roles-members')

  console.log('A role')
  await ev('document.querySelector(".kbm-cwrap .kb8-card").click()'); await sleep(1000)
  check('a click anywhere on the card opens the role', (await ev('!!document.querySelector(".kbm-cwrap.open")')) === true)
  const heads = await ev('Array.from(document.querySelectorAll(".kbm-cwrap.open .kbm-rsec-h")).map((h) => h.querySelector(".kbm-rsec-t").innerText).join(",")')
  check('the editor has four sections, Voice is hidden', heads.toLowerCase() === 'identity,system prompt,requirements,models', heads)
  check('Requirements and Models are open, the others folded', (await ev('Array.from(document.querySelectorAll(".kbm-cwrap.open .kbm-rsec")).map((s) => s.classList.contains("open") ? 1 : 0).join("")')) === '0011')
  check('Requirements keeps its icons (type, tier, requires)', (await ev('document.querySelectorAll(".kbm-cwrap.open [aria-label=\\"Model type\\"] button").length')) >= 5 && (await ev('document.querySelectorAll(".kbm-cwrap.open [aria-label=\\"Tier\\"] button").length')) >= 2)
  await ev(js(() => { Array.from(document.querySelectorAll('.kbm-cwrap.open .kbm-rsec-h')).find((h) => /models/i.test(h.innerText)).click() })); await sleep(300)
  check('a section folds', (await ev('!document.querySelector(".kbm-cwrap.open .kbm-mf")')) === true)
  await ev(js(() => { Array.from(document.querySelectorAll('.kbm-cwrap.open .kbm-rsec-h')).find((h) => /models/i.test(h.innerText)).click() })); await sleep(300)

  console.log('Model field')
  await ev('document.querySelector(".kbm-mf").scrollIntoView({ block: "center" })')
  const current = await ev('(document.querySelector(".kbm-mf .kbm-cb-cur .kbm-cb-id") || { innerText: "" }).innerText')
  await ev('document.querySelector(".kbm-mf .kbm-cb-input").focus()'); await sleep(500)
  const groups = await ev('Array.from(document.querySelectorAll(".kbm-cb-grp")).map((g) => g.innerText.split("\\n")[0]).join("|")')
  check('the list is grouped by route, plans first when there are plans', groups.length > 0 && (!/your plans/i.test(groups) || /^your plans/i.test(groups)), groups)
  if (current !== '') check('it opens on the current value', (await optionText()).startsWith(current), current + ' vs ' + (await optionText()))
  // two providers can serve the same model id: only the role's own route is marked, never both
  if (current !== '') check('exactly one row is marked as the current model', Number(await ev('document.querySelectorAll(".kbm-cb-opt.sel").length')) === 1)
  const before = await optionText()
  await key('ArrowDown'); await sleep(250)
  check('ArrowDown moves the highlight', (await optionText()) !== before)
  await key('Escape'); await sleep(250)
  check('Esc closes and keeps the value', (await ev('!document.querySelector(".kbm-cb-pop")')) === true && (current === '' || (await ev('document.querySelector(".kbm-mf .kbm-cb-cur .kbm-cb-id").innerText')) === current))
  await ev('document.querySelector(".kbm-mf .kbm-cb-input").focus()'); await sleep(300)
  await page.send('Input.insertText', { text: 'zzzz-no-such-model' }); await sleep(400)
  check('a search with no hit says so', (await ev('(document.querySelector(".kbm-cb-empty") || { innerText: "" }).innerText')).includes('No model matches'))
  await key('Escape'); await sleep(250)
  await ev('document.querySelectorAll(".kbm-mf .kbm-cb-input")[1].focus()'); await sleep(400)
  check('the fallback field starts with "No fallback"', (await ev('document.querySelector(".kbm-cb-opt").innerText')).includes('No fallback'))
  if (current !== '') check('the primary cannot be its own fallback', (await ev('Array.from(document.querySelectorAll(".kbm-cb-opt.dis")).some((o) => o.innerText.includes("is the primary"))')) === true)
  await key('Escape'); await sleep(250)
  await shot('roles-role')

  console.log('Review of unreachable roles')
  await ev(js(() => { Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Add a role').click() })); await sleep(900)
  check('a role without a model puts a dot on the gear', (await ev('!!document.querySelector("[data-kb=model-management] .kbm-gear-dot")')) === true)
  await ev('document.querySelector("[data-kb=model-management]").click()'); await sleep(400)
  check('the gear says how many roles cannot reach their model', /cannot reach/.test(await ev('(document.querySelector(".kbm-gear-pop") || { innerText: "" }).innerText')))
  await ev(js(() => { Array.from(document.querySelectorAll('.kbm-gear-pop button')).find((b) => /Review replacements/.test(b.innerText)).click() })); await sleep(600)
  const rows = Number(await ev('document.querySelectorAll(".kbm-dlg .kbm-upd-row").length'))
  check('the review opens as a dialog and lists it with a replacement', rows > 0 && (await ev('(() => { const r = document.querySelectorAll(".kbm-dlg .kbm-upd-row"); return r[r.length - 1].querySelector(".kbm-cb-cur .kbm-cb-id") !== null })()')) === true)
  // only the local role is applied: the real roles of the team are left out
  await ev(js(() => { for (const r of document.querySelectorAll('.kbm-dlg .kbm-upd-row')) { const c = r.querySelector('input[type=checkbox]'); if (!/New role/.test(r.innerText) && c.checked) c.click() } })); await sleep(400)
  await shot('roles-review')
  await ev('document.querySelector(".kbm-dlg .kbm-upd-apply").click()'); await sleep(800)
  check('applying it closes the dialog and takes it off the list', (await ev('!document.querySelector(".kbm-dlg")')) === true)

  console.log('Narrow column')
  await ev('(() => { const st = document.createElement("style"); st.id = "kbm-narrow"; st.textContent = ".kbm-root{max-width:380px !important}"; document.head.appendChild(st) })()'); await sleep(500)
  const wide = await overflowing()
  check('nothing leaves a 380 px column sideways', wide === '', wide)
  await ev('document.getElementById("kbm-narrow").remove()')

  console.log('Writes')
  const writes = await ev('window.__writes')
  const bad = writes.filter((u) => /\/(save|team-portraits|member-portrait|voice-sample|create)(\?|$)/.test(u))
  check('no save, no portrait call, no voice upload was sent', bad.length === 0, bad.join(', '))
  check('no script error', errors.length === 0, errors.join(' | '))
} catch (e) {
  fail('the run', String(e && e.stack ? e.stack : e).slice(0, 400))
} finally {
  if (live !== null) await live.close()
}
console.log(failures === 0 ? '\nAll checks passed.' : '\n' + String(failures) + ' check(s) failed.')
process.exit(failures === 0 ? 0 : 1)
