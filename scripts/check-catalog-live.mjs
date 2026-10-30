#!/usr/bin/env node
// Checks the Catalog page of kybernos-catalog against the REAL GUI of the SANDBOX: the row in the Business group, the empty page, a new item typed with the keyboard,
// a sheet, an edit, sample rows (seeded through the shared base) with their « demo » badge, the status filter, the search, cards and list, archive / undo / restore,
// clearing the sample data, the error and loading states, and the page at a narrow width. Then the same page under a theme that defines a type (Plants: tones,
// fields, the « Only 3 left » flag), with rows of the old type drawn as generic rows. Everything is measured (rectangles, contrast), nothing is taken on trust.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-catalog-live.mjs [--shots <dir>]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080 or without a sandbox DSH_HOME, because it writes the sandbox's business base and its profile.
//  - Rows are seeded with the same base module the DSH process runs (`createBusinessBase`, pointed at the sandbox's own file; WAL lets two processes share it), the
//    way a theme's sample rows are (`seed`, `demo = 1`). Everything else is done on the page with a real mouse and keyboard; the one exception is a `<select>`, whose
//    native popup a headless browser cannot drive: its value is set and a `change` event sent.
//  - The theme of the second half is the repository's starter (`docs/dev/templates/acme-garden-shop`), copied into the SANDBOX profile where the registry reads
//    installed plugins, and taken out again at the end (the Themes page does not take a business-only theme yet: its installer is a later lot).
//  - The sandbox is a clone of the owner's own profile, which carries the sector templates (`@kybernos-themes/*`). The first half is about the DEFAULT type and the
//    second about one theme of its own, so the templates are taken out of the sandbox profile for the run and put back at the end (the registry notices within seconds).
//  - --shots <dir>: one PNG per state, kept outside git (media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run (no sandbox, no GUI).
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { takeTemplatesOut as takeTemplatesOutOf } from './lib-sandbox-templates.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST "' + host + '", DSH_HOME "' + dshHome + '")'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}

// ── the sandbox's data and its profile ────────────────────────────────────────────────────────────────────
const baseFile = join(dshHome, 'kybernos', 'business', 'donnees.sqlite')
// This process is not DSH: it writes the way the page does while no template is active, rows of NO template (scope ''), which the host's active template adopts at its
// next question (docs/dev/business-visuals.md), and its own questions are about every row. Left to itself it would take the scope the sandbox last chose.
const base = createBusinessBase({ file: baseFile, scope: () => null })
const profileDir = join(dshHome, 'profiles', 'web')
const profilePackage = join(profileDir, 'package.json')
const THEME = '@acme/kybernos-garden-shop'
const themeDir = join(profileDir, 'node_modules', '@acme', 'kybernos-garden-shop')
let profileBefore = null
const putTheme = () => {
  profileBefore = readFileSync(profilePackage, 'utf8')
  const pkg = JSON.parse(profileBefore)
  mkdirSync(dirname(themeDir), { recursive: true })
  rmSync(themeDir, { recursive: true, force: true }) // a link left by an earlier attempt would make the copy fail
  cpSync(join(here, '..', 'docs', 'dev', 'templates', 'acme-garden-shop'), themeDir, { recursive: true })
  rmSync(join(themeDir, 'broken'), { recursive: true, force: true })
  pkg.dependencies = Object.assign({}, pkg.dependencies, { [THEME]: 'file:' + themeDir })
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== THEME).concat([THEME])
  writeFileSync(profilePackage + '.tmp', JSON.stringify(pkg, null, 2) + '\n')
  renameSync(profilePackage + '.tmp', profilePackage)
}
const takeThemeOut = () => {
  try { if (profileBefore !== null) { writeFileSync(profilePackage + '.tmp', profileBefore); renameSync(profilePackage + '.tmp', profilePackage); profileBefore = null } } catch (e) { /* the sandbox is throw-away */ }
  try { rmSync(join(profileDir, 'node_modules', '@acme'), { recursive: true, force: true }) } catch (e) { /* gone */ }
}
process.on('exit', takeThemeOut)
// The sector templates the clone carries (data-only packages) are out for the run and back at the end (scripts/lib-sandbox-templates.mjs).
const takeTemplatesOut = () => takeTemplatesOutOf(profileDir).count

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const SEL = (kb, extra) => '[data-kb="' + kb + '"]' + (extra || '')
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel, i = 0) => ev(`(document.querySelectorAll(${JSON.stringify(sel)})[${i}] || {}).innerText || null`)
const attr = (sel, a, i = 0) => ev(`(document.querySelectorAll(${JSON.stringify(sel)})[${i}] || { getAttribute () { return null } }).getAttribute(${JSON.stringify(a)})`)
const rect = (sel, i = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
/** A real mouse click at the centre of the element, after checking that the element is what is under the pointer (nothing covers it). */
const click = async (sel, i = 0) => {
  const r = await rect(sel, i)
  if (r === null || r.err || r.shown !== true) return false
  const top = await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; const t = document.elementFromPoint(${r.x}, ${r.y}); return t === e || e.contains(t) })()`)
  if (top !== true) return false
  await mouse('mouseMoved', r.x, r.y); await mouse('mousePressed', r.x, r.y); await mouse('mouseReleased', r.x, r.y)
  await sleep(350)
  return true
}
const key = async (k, code, vk, extra = {}) => {
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, extra))
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(250)
}
const ENTER = () => key('Enter', 'Enter', 13, { text: '\r' })
const ESCAPE = () => key('Escape', 'Escape', 27)
/** Types into a field the way a person does: click it, select what is there, type. */
const typeInto = async (sel, value, i = 0) => {
  if (!(await click(sel, i))) return false
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  if (value === '') await key('Backspace', 'Backspace', 8)
  else await page.send('Input.insertText', { text: value })
  await sleep(300)
  return true
}
const chooseOption = (sel, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return false; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value === ${JSON.stringify(value)} })()`)
const settle = async (ms = 700) => { await sleep(ms) }
/** Waits (at most 6 s) until `sel` matches exactly `n` elements; the page asks the host again after a pause, so a fixed sleep is a guess. */
const waitCount = async (sel, n) => { await waitFor(page, `document.querySelectorAll(${JSON.stringify(sel)}).length === ${n}`, 6000); await sleep(150); return (await count(sel)) === n }
const rgb = (css) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css) || /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css)
  if (m === null) return null
  const v = [m[1], m[2], m[3]].map(Number)
  return v.some((x) => x <= 1.0001) && /^color\(/.test(css) ? v.map((x) => x * 255) : v
}
const luminance = (c) => { const f = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] }
/** The contrast ratio between an element's text colour and the first opaque background above it. */
const contrastOf = async (sel, i = 0) => {
  const r = await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (e === undefined) return null; const fg = getComputedStyle(e).color; let n = e; let bg = 'rgba(0, 0, 0, 0)'; while (n !== null) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\\(.*, 0\\)$|transparent/.test(c)) { bg = c; break } n = n.parentElement } return { fg, bg } })()`)
  if (r === null || r.err) return null
  const a = rgb(r.fg); const b = rgb(r.bg)
  if (a === null || b === null) return { unreadable: r }
  const la = luminance(a); const lb = luminance(b)
  return { ratio: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), fg: r.fg, bg: r.bg }
}
const overflowX = () => ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
const allRects = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height } })`)
const ROWS = `[...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')]`
const openCatalog = async () => {
  const idx = await ev(`${ROWS}.findIndex((e) => /catalog|catalogue|plants|plantes|products|produits/i.test(e.getAttribute('aria-label') || ''))`)
  if (!(typeof idx === 'number' && idx >= 0)) return false
  const ok = await click('[data-kb="menu-business"] .kb4-item:nth-of-type(' + (idx + 1) + ')')
  await waitFor(page, `!!document.querySelector('[data-kb="catalog-page"]')`, 8000)
  await settle(900)
  return ok
}
const leaveAndComeBack = async () => {
  const skills = await ev(`[...document.querySelectorAll('.kb4-menu .kb4-item')].findIndex((e) => e.getAttribute('aria-label') === 'Skills')`)
  if (typeof skills === 'number' && skills >= 0) { await click('.kb4-menu .kb4-item:nth-of-type(' + (skills + 1) + ')'); await sleep(900) }
  return openCatalog()
}
const reloadPage = async () => {
  await page.send('Page.reload')
  await sleep(2500)
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await waitFor(page, `window.__KB_MENU__ && window.__KB_MENU__.ids().indexOf('catalog') >= 0`, 25000)
  await sleep(500)
  return openCatalog()
}
const demoRows = (n) => [{ title: 'Sample chair', subtitle: 'Oak', status: 'live', price_text: '€120' }, { title: 'Sample desk', subtitle: 'Walnut', status: 'draft', price_text: '€340' }, { title: 'Sample lamp', subtitle: 'Brass', status: 'live', price_text: '€59' }, { title: 'Sample shelf', subtitle: 'Pine', status: 'draft', price_text: '€85' }].slice(0, n).map((r) => Object.assign({ type: 'item' }, r))

const errors = []
page.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; const t = ((d.exception && d.exception.description) || d.text || '').slice(0, 200); if (/catalog/i.test(t) || /kbcg/.test(t)) errors.push(t) })
await page.send('Runtime.enable', {})

try {
  // ── a clean base, the page opened from the menu ─────────────────────────────────────────────────────────
  console.log('Start: an empty base, no theme')
  const wiped = base.deleteAll({ confirm: true, actor: 'person' })
  check('the sandbox base is emptied (and only the sandbox\'s: ' + baseFile.replace(process.env.HOME || '~', '~') + ')', wiped.ok === true, wiped)
  const templatesOut = takeTemplatesOut()
  const onDefault = `fetch('/kybernos-catalog/types', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.source === 'default')`
  check('the catalogue is on its default type (' + templatesOut + ' sector template(s) of the cloned profile are out for this run)', (await waitFor(page, onDefault, 20000)) === true)
  // what the Templates page does once a template has gone: the page reads the choice again, and the rows go back to their plain words
  await ev(`window.__KB_BIZ_SCOPE__ ? window.__KB_BIZ_SCOPE__.reload().then(() => 1) : 1`)
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await waitFor(page, `window.__KB_MENU__ && window.__KB_MENU__.ids().indexOf('catalog') >= 0`, 25000)
  check('the plugin declares its row once the core\'s registry exists (the row waits for it)', (await ev(`window.__KB_MENU__.ids().filter((i) => i === 'catalog').length`)) === 1)
  check('the row is in the Business group, labelled « Catalog », with an icon', (await ev(`${ROWS}.map((e) => e.getAttribute('aria-label'))`)).includes('Catalog') && (await ev(`!!document.querySelector('[data-kb="menu-business"] .kb4-item svg')`)) === true)
  check('a real click on the row opens the page and the row is the selected one', (await openCatalog()) === true && (await count(SEL('catalog-page'))) === 1 && (await ev(`${ROWS}.filter((e) => e.classList.contains('on')).map((e) => e.getAttribute('aria-label'))`)).includes('Catalog'))
  check('the title is « Catalog » and the « ? How it works » pill is next to it', (await text(SEL('catalog-title'))) === 'Catalog' && (await count('.kb6-titlerow .kbhp-btn, .kb6-titlerow [data-kb="help-pill"], .kb6-titlerow button')) >= 1)
  check('no script error on the way', errors.length === 0, errors)

  console.log('The empty page')
  check('an empty catalog says so and offers to add (not an error, not a blank)', (await attr(SEL('catalog-empty'), 'data-why')) === 'empty' && (await count(SEL('catalog-empty-new'))) === 1)
  check('no status chips to filter nothing, the archive still reachable', (await count(SEL('catalog-chip'))) === 0 && (await count(SEL('catalog-archived'))) === 1)
  const newBtn = await rect(SEL('catalog-new'))
  const contrast = await contrastOf(SEL('catalog-new'))
  check('the primary action is drawn at a readable size, in the header row', newBtn !== null && newBtn.w >= 80 && newBtn.h >= 30 && newBtn.top < 140, newBtn)
  check('its label can be read: contrast against its own background at least 4.5', contrast !== null && contrast.ratio >= 4.5, contrast)
  const titleRect = await rect(SEL('catalog-title'))
  const emptyRect = await rect(SEL('catalog-empty'))
  check('the empty block sits under the header, not over it', titleRect !== null && emptyRect !== null && emptyRect.top > titleRect.top + titleRect.h)
  await shot('01-empty')

  console.log('A first item, typed with the keyboard')
  check('« New item » opens the dialog with a real click', (await click(SEL('catalog-new'))) && (await count(SEL('catalog-dialog'))) === 1)
  check('the focus is in the dialog (the title field)', (await ev(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'catalog-field-title')
  const dlgRect = await rect(SEL('catalog-dialog'))
  check('the dialog fits the window', dlgRect !== null && dlgRect.left >= 0 && dlgRect.right <= 1500 && dlgRect.top >= 0 && dlgRect.bottom <= 950, dlgRect)
  await shot('02-dialog')
  await ENTER()
  check('Enter with no title is refused in the form: an alert, the field marked, nothing created', (await count(SEL('catalog-title-error'))) === 1 && (await attr(SEL('catalog-field-title'), 'aria-invalid')) === 'true' && (await count(SEL('catalog-dialog'))) === 1)
  check('and nothing was written', (await base.list('item', {})).total === 0)
  await typeInto(SEL('catalog-field-title'), 'Linen apron')
  await typeInto(SEL('catalog-field-subtitle'), 'Natural, one size')
  await typeInto(SEL('catalog-field-price_text'), '€39')
  check('the status select offers the default type\'s statuses, the first one selected', (await ev(`[...document.querySelectorAll('[data-kb="catalog-field-status"] option')].map((o) => o.value).join()`)) === 'draft,live,archived' && (await ev(`document.querySelector('[data-kb="catalog-field-status"]').value`)) === 'draft')
  check('a status is chosen', (await chooseOption(SEL('catalog-field-status'), 'live')) === true)
  check('Save is pressed with the mouse', await click(SEL('catalog-save')))
  await settle(900)
  check('the dialog closes, the new item is a card and its sheet is open', (await count(SEL('catalog-dialog'))) === 0 && (await count(SEL('catalog-card'))) === 1 && (await count(SEL('catalog-panel'))) === 1)
  check('the toast says it was added', /Added/.test((await text(SEL('catalog-toast'))) || ''))
  const stored = await base.list('item', {})
  check('the base holds it, typed as a person: title, subtitle, price, status, the default type', stored.total === 1 && stored.rows[0].title === 'Linen apron' && stored.rows[0].price_text === '€39' && stored.rows[0].status === 'live' && stored.rows[0].type === 'item', stored.rows)
  check('and the journal says person', base.exportAll({ actor: 'person' }).tables.changes.some((c) => c.tbl === 'item' && c.action === 'create' && c.actor === 'person'))
  check('the card shows the title, the subtitle, the price and a status tag, and a neutral picture (no photo, no network)', (await text(SEL('catalog-card'))).includes('Linen apron') && (await text(SEL('catalog-card'))).includes('€39') && (await count(SEL('catalog-picture'))) >= 1 && (await ev(`document.querySelectorAll('[data-kb="catalog-card"] img').length`)) === 0)
  await shot('03-created')

  console.log('The sheet: edit')
  check('the sheet has Edit and Archive', (await count(SEL('catalog-edit'))) === 1 && (await count(SEL('catalog-archive'))) === 1)
  check('Edit opens the form with the stored values', (await click(SEL('catalog-edit'))) && (await ev(`document.querySelector('[data-kb="catalog-field-title"]').value`)) === 'Linen apron' && (await ev(`document.querySelector('[data-kb="catalog-field-price_text"]').value`)) === '€39')
  await typeInto(SEL('catalog-field-title'), 'Linen apron, large')
  await key('Tab', 'Tab', 9)
  check('Escape closes the form without saving, and the title is unchanged', await (async () => { await ESCAPE(); await settle(500); return (await count(SEL('catalog-dialog'))) === 0 && (await base.list('item', {})).rows[0].title === 'Linen apron' })())
  check('the keyboard is given back to the sheet\'s button that opened the form (or the sheet stays open)', (await count(SEL('catalog-panel'))) === 1)
  check('Edit again, type, Save with Enter: the sheet and the card change', (await click(SEL('catalog-edit'))) && (await typeInto(SEL('catalog-field-title'), 'Linen apron, large')) && (await (async () => { await ENTER(); await settle(900); return true })()) && (await text(SEL('catalog-panel'))).includes('Linen apron, large') && (await text(SEL('catalog-card'))).includes('large'))
  check('the base holds the change, journalled as an update by a person', (await base.list('item', {})).rows[0].title === 'Linen apron, large' && base.exportAll({ actor: 'person' }).tables.changes.some((c) => c.tbl === 'item' && c.action === 'update' && c.actor === 'person'))
  check('Escape on the sheet closes it and the card has the focus back', await (async () => { await ESCAPE(); await settle(400); return (await count(SEL('catalog-panel'))) === 0 && (await ev(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'catalog-card-open' })())

  console.log('Sample rows, filters and search')
  const seeded = base.seed({ items: demoRows(4) }, { theme: 'check/live' })
  check('four sample rows are seeded through the base (demo = 1)', seeded.ok === true && base.counts().demo.item === 4, seeded)
  check('the page after a reload shows five cards, four with the « demo » badge', (await reloadPage()) && (await count(SEL('catalog-card'))) === 5 && (await count(SEL('catalog-demo-badge'))) === 4)
  check('the sample-data banner is there with its button', (await count(SEL('catalog-demo-banner'))) === 1 && (await count(SEL('catalog-demo-clear'))) === 1)
  check('status chips with counts: All 5, Draft 2, Live 3, Archived 0', (await text(SEL('catalog-chip'), 0)).replace(/\s+/g, '') === 'All5' && (await text(SEL('catalog-chip'), 1)).replace(/\s+/g, '') === 'Draft2' && (await text(SEL('catalog-chip'), 2)).replace(/\s+/g, '') === 'Live3', await ev(`[...document.querySelectorAll('[data-kb="catalog-chip"]')].map((e) => e.innerText)`))
  const tones = await ev(`[...document.querySelectorAll('[data-kb="catalog-status"]')].map((e) => e.className)`)
  check('the tags carry the tones of the type (Draft warns, Live is ok)', tones.some((c) => /warn/.test(c)) && tones.some((c) => /\bok\b/.test(c)), tones)
  const cards = await allRects(SEL('catalog-card'))
  check('five cards in a grid: same size, none over another, all inside the window', cards.length === 5 && cards.every((c) => Math.abs(c.w - cards[0].w) < 2 && Math.abs(c.h - cards[0].h) < 2) && cards.every((a, i) => cards.every((b, j) => i === j || !overlaps(a, b))) && cards.every((c) => c.left >= 0 && c.right <= 1500), cards)
  check('no horizontal overflow of the page', (await overflowX()) <= 0, await overflowX())
  await shot('04-cards')
  check('the Draft chip filters on the host and is pressed', (await click(SEL('catalog-chip', '[data-status="draft"]'))) && (await waitCount(SEL('catalog-card'), 2)) && (await attr(SEL('catalog-chip', '[data-status="draft"]'), 'aria-pressed')) === 'true')
  check('the counts of the other statuses stay (the chips do not shrink to the filter)', (await text(SEL('catalog-chip', '[data-status="live"]'))).replace(/\s+/g, '') === 'Live3')
  await shot('05-filtered')
  check('the chip pressed again lifts the filter', (await click(SEL('catalog-chip', '[data-status="draft"]'))) && (await waitCount(SEL('catalog-card'), 5)))
  check('the magnifier of the product\'s bar opens the search field with a real click, and it takes the focus', (await click(SEL('toggle-search'))) && (await ev(`!!document.activeElement && document.activeElement.matches('.kb6-tb-search input')`)) === true)
  await page.send('Input.insertText', { text: 'apron' })
  check('typing « apron » narrows to the one item', (await waitCount(SEL('catalog-card'), 1)) && (await text(SEL('catalog-card'))).includes('apron'))
  // the browser's own clear glyph of a type=search input lives in a shadow tree a script cannot read: it is hidden by the page's CSS and checked on the screenshot (06-search)
  check('the search pill has our one clear button', (await count('.kb6-search-inline .kb6-tb-clear')) === 1)
  await shot('06-search')
  await typeInto('.kb6-tb-search input', 'nothing like this')
  await waitCount(SEL('catalog-card'), 0)
  check('a search that finds nothing says « No match », offers to clear, and does not say the catalog is empty', (await attr(SEL('catalog-empty'), 'data-why')) === 'filter' && (await count(SEL('catalog-clear-filters'))) === 1 && !/yet/.test((await text(SEL('catalog-empty'))) || ''))
  await shot('07-no-match')
  check('Clear brings everything back', (await click(SEL('catalog-clear-filters'))) && (await waitCount(SEL('catalog-card'), 5)))

  console.log('Cards and list')
  check('the list button (a real click) shows a table with a row per item', (await click(SEL('view-list'))) && (await count(SEL('catalog-row'))) === 5 && (await count(SEL('catalog-card'))) === 0)
  check('the list has no Note column while no row has a note', (await count('[data-kb="catalog-list"] th')) === 3)
  const rows = await allRects(SEL('catalog-row'))
  check('the rows are stacked, none over another, as wide as the table', rows.length === 5 && rows.every((a, i) => rows.every((b, j) => i === j || !overlaps(a, b))) && rows.every((r) => r.w > 400), rows)
  check('the view survives a reload (kept in this browser)', (await reloadPage()) && (await count(SEL('catalog-row'))) === 5)
  await shot('08-list')
  check('a row has the keyboard: focus it and Enter opens its sheet', (await ev(`document.querySelectorAll('[data-kb="catalog-row"]')[1].focus(), document.activeElement.getAttribute('data-kb')`)) === 'catalog-row' && (await (async () => { await ENTER(); await settle(500); return true })()) && (await count(SEL('catalog-panel'))) === 1 && (await attr(SEL('catalog-row', '[aria-current="true"]'), 'data-id')) !== null)
  const sheet = await rect(SEL('catalog-panel'))
  const table = await rect(SEL('catalog-list'))
  check('the sheet sits beside the list, not over it (1500 px)', sheet !== null && table !== null && sheet.left >= table.right - 1, { sheet, table })
  await shot('09-list-sheet')
  await ESCAPE(); await settle(400)
  check('back to cards', await click(SEL('view-cards')) && (await count(SEL('catalog-card'))) === 5)

  console.log('Archive, undo, restore')
  check('a click on a card opens its sheet', (await click(SEL('catalog-card'), 1)) && (await count(SEL('catalog-panel'))) === 1)
  const victim = await text(SEL('catalog-panel') + ' h3')
  check('Archive removes it from the list and offers Undo', (await click(SEL('catalog-archive'))) && (await (async () => { await settle(800); return true })()) && (await count(SEL('catalog-card'))) === 4 && (await count(SEL('catalog-undo'))) === 1 && (await count(SEL('catalog-panel'))) === 0)
  check('the base kept the row, archived (never deleted)', (await base.list('item', { includeArchived: true })).rows.filter((r) => r.archived_at !== null).length === 1)
  check('Undo puts it back', (await click(SEL('catalog-undo'))) && (await (async () => { await settle(800); return true })()) && (await count(SEL('catalog-card'))) === 5)
  await click(SEL('catalog-card'), 1)
  await click(SEL('catalog-archive')); await settle(800)
  check('« Show archived » lists the archived item', (await click(SEL('catalog-archived'))) && (await (async () => { await settle(800); return true })()) && (await count(SEL('catalog-card'))) === 1 && (await text(SEL('catalog-card'))).includes(victim))
  await shot('10-archived')
  check('its sheet offers Restore and no Edit', (await click(SEL('catalog-card'))) && (await count(SEL('catalog-restore'))) === 1 && (await count(SEL('catalog-edit'))) === 0)
  check('Restore brings it back', (await click(SEL('catalog-restore'))) && (await (async () => { await settle(800); return true })()) && (await count(SEL('catalog-card'))) === 0 && (await attr(SEL('catalog-empty'), 'data-why')) === 'archived')
  check('and leaving the archive shows five cards again', (await click(SEL('catalog-archived'))) && (await (async () => { await settle(800); return true })()) && (await count(SEL('catalog-card'))) === 5)

  console.log('The two ways a page fails')
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-catalog/list*', requestStage: 'Request' }] })
  let mode = 'fail' // what the list request meets: 'fail' (503), 'hold' (kept until released), 'pass'
  const held = []
  page.on('Fetch.requestPaused', async (p) => {
    try {
      if (mode === 'fail') await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 503, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":false,"error":"x"}').toString('base64') })
      else if (mode === 'hold') held.push(p.requestId)
      else await page.send('Fetch.continueRequest', { requestId: p.requestId })
    } catch (e) { /* the page moved on */ }
  })
  await leaveAndComeBack()
  check('a signed-out answer (503) is said in words, in an alert, with a retry; not an empty page', (await count(SEL('catalog-error'))) === 1 && (await attr(SEL('catalog-error'), 'role')) === 'alert' && /session/i.test((await text(SEL('catalog-error'))) || '') && (await count(SEL('catalog-retry'))) === 1 && (await count(SEL('catalog-empty'))) === 0)
  await shot('11-error')
  mode = 'pass'
  check('Try again recovers once the server answers', (await click(SEL('catalog-retry'))) && (await (async () => { await settle(900); return true })()) && (await count(SEL('catalog-error'))) === 0 && (await count(SEL('catalog-card'))) === 5)

  // the loading state: hold the list for a moment and look at the page meanwhile
  mode = 'hold'
  await leaveAndComeBack()
  check('while the list is on its way the page says it is loading (a status and grey cards), not empty', (await count(SEL('catalog-loading'))) === 1 && (await count(SEL('catalog-empty'))) === 0 && (await ev(`!!document.querySelector('[data-kb="catalog-loading"] [role="status"]')`)) === true)
  await shot('12-loading')
  mode = 'pass'
  for (const id of held.splice(0)) { try { await page.send('Fetch.continueRequest', { requestId: id }) } catch (e) { /* done */ } }
  await settle(1200)
  await page.send('Fetch.disable', {})
  check('and the cards arrive', (await count(SEL('catalog-card'))) === 5 && (await count(SEL('catalog-loading'))) === 0)

  console.log('Clear the sample data')
  check('the banner button asks first, in an alert dialog with the focus inside', (await click(SEL('catalog-demo-clear'))) && (await count(SEL('catalog-confirm'))) === 1 && (await attr(SEL('catalog-confirm'), 'role')) === 'alertdialog')
  await shot('13-confirm')
  await ESCAPE(); await settle(400)
  check('Escape cancels: nothing removed, the keyboard is back on the button', (await count(SEL('catalog-confirm'))) === 0 && base.counts().demo.item === 4 && (await ev(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'catalog-demo-clear')
  check('confirming removes the four sample rows and keeps mine', (await click(SEL('catalog-demo-clear'))) && (await click(SEL('catalog-confirm-ok'))) && (await (async () => { await settle(1000); return true })()) && (await count(SEL('catalog-card'))) === 1 && (await count(SEL('catalog-demo-banner'))) === 0 && base.counts().demo.item === 0 && (await base.list('item', {})).total === 1)
  check('the journal says clear-demo', base.exportAll({ actor: 'person' }).tables.changes.some((c) => c.action === 'clear-demo'))

  // ── narrow widths ────────────────────────────────────────────────────────────────────────────────────────
  console.log('Narrow windows')
  base.seed({ items: demoRows(4) }, { theme: 'check/live' })
  await reloadPage()
  for (const [w, h, name] of [[900, 800, 'tablet'], [600, 800, 'narrow'], [420, 800, 'phone']]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    // a window that is narrow when the page opens starts with the shell's sidebar folded; one that is resized under an open page keeps it as a drawer over the page
    if (w <= 600) {
      await reloadPage()
      // the sidebar is folded behind the menu button, so the row is not on screen: the page is opened by the shell's own way in
      if ((await count(SEL('catalog-page'))) === 0) await ev(`window.__KB_OPEN__({ view: 'catalog' })`)
      await waitFor(page, `!!document.querySelector('[data-kb="catalog-page"]')`, 8000)
      await sleep(600)
    }
    const over = await overflowX()
    const hd = await rect(SEL('catalog-new'))
    const grid = await allRects(SEL('catalog-card'))
    check(name + ' (' + w + ' px): no horizontal scroll, the primary action and the cards inside the window', over <= 0 && hd !== null && hd.right <= w + 1 && grid.length > 0 && grid.every((c) => c.right <= w + 1 && c.left >= -1), { over, hd, first: grid[0] })
    if (w <= 600) {
      const opened = await click(SEL('catalog-card'), 0)
      const under = opened ? null : await ev(`(() => { const e = document.querySelector('[data-kb="catalog-card"]'); if (!e) return 'no card'; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], at: t ? t.tagName + '.' + String(t.className).slice(0, 50) + ' ' + String(t.getAttribute('data-kb')) : null } })()`)
      await sleep(500)
      const p = await rect(SEL('catalog-panel'))
      check(name + ': the sheet is a sheet at the foot of the window, fully inside it, with its buttons reachable', p !== null && p.left >= 0 && p.right <= w + 1 && p.bottom <= h + 1 && p.top >= 0 && (await rect(SEL('catalog-archive'))).shown === true, { p, opened, under })
      await shot('14-' + name + '-sheet')
      await ESCAPE(); await sleep(300)
    }
    await shot('14-' + name)
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(600)

  // ── a theme that defines a type ──────────────────────────────────────────────────────────────────────────
  console.log('A theme that defines a type (the starter garden shop: Plants)')
  putTheme()
  await sleep(2600)
  const state = await ev(`fetch('/kybernos-registry/state?fresh=1', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify((j.plugins || []).filter((p) => /garden/.test(p.id)).map((p) => ({ id: p.id, status: p.status }))))`, 12000)
  check('the registry reads the theme as ok (its three owners are installed and have told their points)', /"status":"ok"/.test(String(state)), state)
  const types = await ev(`fetch('/kybernos-catalog/types', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify({ source: j.source, ids: j.types.map((t) => t.id) }))`)
  check('the types route serves the theme\'s type instead of the default one', types === '{"source":"theme","ids":["plant"]}', types)
  const plants = [
    { type: 'plant', title: 'Monstera', status: 'low', fields: { sku: 'PL-001', stock: 3, price: 24 } },
    { type: 'plant', title: 'Olive tree', status: 'in-stock', fields: { sku: 'PL-002', stock: 14, price: 89.5 } },
    { type: 'plant', title: 'Fern', status: 'sold-out', fields: { sku: 'PL-003', stock: 0, price: 12 } },
    { type: 'plant', title: 'Basil', status: 'in-stock', fields: { sku: 'PL-004', stock: 5, price: 3.5 } },
  ]
  const sampleSeed = base.seed({ items: plants.slice(0, 2) }, { theme: 'acme/garden-shop' })
  for (const p of plants.slice(2)) base.create('item', p, { actor: 'person' })
  check('plants are written (two as the theme\'s sample rows, two by hand) next to the five rows of the default type', sampleSeed.ok === true && (await base.list('item', {})).total === 9)
  check('the four samples of the default type belong to a theme that is not installed, the fifth row was typed by hand', (await base.list('item', { scope: 'check/live' })).total === 4 && (await base.list('item', { scope: '*' })).total === 9)
  await reloadPage()
  check('the page is called « Plants » and the button names the type', (await text(SEL('catalog-title'))) === 'Plants' && /New plant/i.test((await text(SEL('catalog-new'))) || ''), await text(SEL('catalog-new')))
  const sev = await ev(`[...document.querySelectorAll('[data-kb="catalog-chip"]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
  check('the chips are the theme\'s statuses: In stock, Low stock, Sold out', ['In stock', 'Low stock', 'Sold out'].every((s) => sev.some((c) => c.startsWith(s))), sev)
  // One template at a time: the garden shop adopts what the person typed before any template was there (drawn as a generic card), and the four sample rows of a theme that is
  // not installed stay in the base, dormant, until that theme is back (they are not on the page: nothing of another template is).
  check('five cards: four plants and the one row of the old type the garden shop adopted; the four samples of the uninstalled theme are dormant', (await count(SEL('catalog-card'))) === 5 && (await count(SEL('catalog-card', '[data-known="no"]'))) === 1 && (await count(SEL('catalog-card', '[data-known="yes"]'))) === 4 && (await base.list('item', { scope: '*' })).total === 9 && (await base.list('item', { scope: 'check/live' })).total === 4)
  const flags = await ev(`[...document.querySelectorAll('[data-kb="catalog-flag"]')].map((e) => e.innerText)`)
  check('the card flag follows the type: « Only 3 left » and « Only 0 left » (stock at 5 or under)', flags.includes('Only 3 left') && flags.includes('Only 0 left') && !flags.some((f) => /14/.test(f)), flags)
  const prices = await ev(`[...document.querySelectorAll('[data-kb="catalog-price"]')].map((e) => e.innerText)`)
  check('the price field is shown formatted as money (€89.50 for the olive tree)', prices.some((p) => /89[.,]50/.test(p)) && prices.every((p) => p.includes('€') || p.length > 0), prices)
  const kinds = await ev(`[...document.querySelectorAll('[data-kb="catalog-status"]')].map((e) => e.innerText + ':' + e.className.replace('kbcg-tag', '').trim())`)
  check('tones: Low stock warns, Sold out is bad, In stock is ok', kinds.some((k) => /^Low stock:\s*warn/.test(k)) && kinds.some((k) => /^Sold out:\s*bad/.test(k)) && kinds.some((k) => /^In stock:\s*ok/.test(k)), kinds)
  check('the pictures and the tags are readable: a tag is a pill with its own background on the picture', (await ev(`(() => { const t = document.querySelector('[data-kb="catalog-card"] [data-kb="catalog-status"]'); const c = getComputedStyle(t).backgroundColor; return !/rgba\\(.*, 0\\)$|transparent/.test(c) })()`)) === true)
  await shot('15-theme-cards')
  check('the list of a theme with flags has a Note column with the flags in it', (await click(SEL('view-list'))) && (await count('[data-kb="catalog-list"] th')) === 4 && (await count(SEL('catalog-row') + ' ' + SEL('catalog-flag'))) === 3)
  await shot('15b-theme-list')
  await click(SEL('view-cards'))
  check('a click on a plant opens its sheet', (await click(SEL('catalog-card', '[data-known="yes"]'))) && (await count(SEL('catalog-panel'))) === 1)
  const sheetText = (await text(SEL('catalog-panel'))) || ''
  check('the sheet lists its fields with the theme\'s labels (Reference, Stock, Price) and their values, the price as money', ['Reference', 'Stock', 'Price'].every((l) => sheetText.includes(l)) && /PL-00\d/.test(sheetText) && /€\s?\d/.test(sheetText), sheetText)
  await shot('16-theme-sheet')
  check('editing a plant shows its fields as inputs of the right kind (number for the stock)', (await click(SEL('catalog-edit'))) && (await count(SEL('catalog-field-price_text'))) === 0 && (await count(SEL('catalog-field-subtitle'))) === 0 && (await attr(SEL('catalog-field-stock'), 'type')) === 'number' && (await attr(SEL('catalog-field-sku'), 'type')) === 'text' && (await ev(`document.querySelector('label[for="kbcg-f-sku"]').innerText`)) === 'Reference' && (await ev(`document.querySelector('[data-kb="catalog-field-status"]').options.length`)) === 3)
  await shot('17-theme-edit')
  check('a stock typed as 2 and Saved: the flag follows', (await typeInto(SEL('catalog-field-stock'), '2')) && (await click(SEL('catalog-save'))) && (await (async () => { await settle(1000); return true })()) && (await base.list('item', { q: 'Olive' })).rows.concat((await base.list('item', {})).rows).some((r) => r.fields && r.fields.stock === 2))
  await ESCAPE(); await settle(300)
  check('a row of the old type is a generic card: its own lines, its raw status as a neutral tag', (await text(SEL('catalog-card', '[data-known="no"]'))).length > 0 && (await ev(`document.querySelector('[data-kb="catalog-card"][data-known="no"] [data-kb="catalog-status"]').className`)).trim() === 'kbcg-tag')
  check('opening it and pressing Edit offers only its own lines and says why', (await click(SEL('catalog-card', '[data-known="no"]'))) && (await click(SEL('catalog-edit'))) && (await count(SEL('catalog-generic-note'))) === 1 && (await count(SEL('catalog-field-status'))) === 0)
  await shot('18-theme-generic-edit')
  await ESCAPE(); await settle(300)
  const bad = await ev(`fetch('/kybernos-catalog/create', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', type: 'plant', status: 'open' }) }).then((r) => r.json())`)
  check('the host refuses a status the theme\'s type does not have (a written value must name a known key)', bad !== null && bad.ok === false && bad.error === 'unknown_status', bad)

  console.log('In French (the page asks the app\'s language at each render; here it is switched from the page)')
  await ev(`window.__kbcgLang = window.__KB_LANG_RESOLVE__; window.__KB_LANG_RESOLVE__ = () => 'fr'`)
  await leaveAndComeBack()
  check('the title and the button are the theme\'s French words (« Plantes », « Ajouter · Plante »)', (await text(SEL('catalog-title'))) === 'Plantes' && /Ajouter · Plante/.test((await text(SEL('catalog-new'))) || ''), await text(SEL('catalog-new')))
  const fr = await ev(`[...document.querySelectorAll('[data-kb="catalog-chip"]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
  check('the chips are « Tous », « En stock », « Stock bas », « Épuisé »', ['Tous', 'En stock', 'Stock bas', 'Épuisé'].every((w) => fr.some((c) => c.startsWith(w))), fr)
  check('the flag and the banner are in French', (await ev(`[...document.querySelectorAll('[data-kb="catalog-flag"]')].map((e) => e.innerText).some((t) => /^Plus que \\d/.test(t))`)) === true && /exemple/.test((await text(SEL('catalog-demo-banner'))) || ''))
  await shot('19-french')
  await ev(`window.__KB_LANG_RESOLVE__ = window.__kbcgLang`)

  console.log('Closing')
  check('no script error from this plugin during the whole run', errors.length === 0, errors)
} catch (e) {
  failures.push('the check itself: ' + e.message)
  console.log('  ✗ the check stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  try { await page.send('Emulation.clearDeviceMetricsOverride', {}) } catch (e) { /* closing */ }
  takeThemeOut()
  try { base.deleteAll({ confirm: true, actor: 'person' }) } catch (e) { /* the sandbox is throw-away */ }
  try { base.close() } catch (e) { /* closed */ }
  try { await live.close() } catch (e) { /* gone */ }
}
console.log('\n' + pass + ' passed, ' + failures.length + ' failed')
process.exit(failures.length === 0 ? 0 : 1)
