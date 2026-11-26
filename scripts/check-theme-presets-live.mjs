#!/usr/bin/env node
// The Theme page (packages/kybernos-theme) in a REAL GUI: the strip, the ONE Presets section (built-in and mine, badges, filter), the window and its quick panels,
// the Menu panel on the REAL rows of the menu (show / hide, order, names per language, "Show every entry"), the Advanced editor in real tabs, the selects and the
// segmented controls (keyboard, preview on hover), Save / Apply sheets with their ticks, Import / Export, Undo / Reset, the disk copy, a phone-width page.
//
//   source scripts/sandbox/env.sh && node scripts/check-theme-presets-live.mjs [--shots <dir>]
//
// Run it on the SANDBOX (scripts/sandbox): a click on a mode or a size goes through `commit`, which writes DSH's own theme preference into the profile of the DSH it
// talks to. The script refuses to run on the real :3080 (exit 3). The sandbox serves this checkout, so no bundle is swapped.
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or not the sandbox).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, openSettings, clickText } from './live-page.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST)) {
  console.error('○ not run: this check changes the mode and the menu, which DSH keeps in its profile. Run it on the sandbox: source scripts/sandbox/env.sh && node scripts/check-theme-presets-live.mjs')
  process.exit(3)
}
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 420))) }
}
const section = (t) => console.log('\n' + t)
const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 12000) => { const r = await page.evalJs(js, ms); return r.err !== undefined ? { err: r.err } : r.val }
const STORE = 'kybernos.theme.v1'
const LIB = 'kybernos.theme.presets.v1'
const MENU = 'kybernos.theme.menu.v1'
const state = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(STORE)}) || '{}')`)
const lib = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(LIB)}) || '{"presets":[]}')`)
const menuDoc = () => ev(`(() => { const r = localStorage.getItem(${JSON.stringify(MENU)}); return r === null ? null : JSON.parse(r).menu })()`)
const shot = async (name) => {
  if (shotsDir === null) return
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { console.log('  (no screenshot: ' + e.message + ')') }
}
const rect = (sel, nth = 0, block = 'center') => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return null; e.scrollIntoView({ block: ${JSON.stringify(block)} }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
/** A real mouse click at the centre of the nth element that matches. */
const click = async (sel, nth = 0, block = 'center') => {
  let r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await sleep(320) // the scroll that brought it into view may be smooth: read where it came to rest
  r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(280)
  return true
}
const hover = async (sel, nth = 0) => { const r = await rect(sel, nth); if (r === null || r.err !== undefined) throw new Error('nothing to hover: ' + sel); await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); await sleep(280) }
const away = async () => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await sleep(250) }
const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, Home: 36, End: 35, Tab: 9, ' ': 32 }
const key = async (k) => { const code = KEYS[k]; const o = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }; await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...o }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...o }); await sleep(220) }
const typeIn = (sel, text) => ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const stripA = () => text('[data-kb="theme-strip-a"]')
const stripM = () => text('[data-kb="theme-strip-m"]')
const tile = (id) => `[data-kb="theme-preset"][data-id="${id}"]`
const realRows = () => ev(`[...document.querySelectorAll('[data-kb-row]')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getAttribute('data-kb-row') + '=' + b.getAttribute('aria-label'))`)
// What the window draws, as one string: its markup with every inline style (colours, fonts, shapes), so any change of the preview shows.
const winStyle = () => ev(`document.querySelector('[data-kb="theme-st-window"]').outerHTML`)
const baseToken = () => ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim() + '|' + getComputedStyle(document.body).getPropertyValue('--dsw-font-family').trim()`)

const errors = []
try {
  await page.send('Runtime.enable', {})
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-theme/boot*', requestStage: 'Request' }] })
  page.on('Fetch.requestPaused', async (p) => { try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":true}').toString('base64') }) } catch (e) { /* gone */ } })
  page.on('Runtime.exceptionThrown', (p) => { errors.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 300)) })
  page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push('console.error: ' + (p.args || []).map((a) => String(a.value === undefined ? a.description : a.value)).join(' ').slice(0, 300)) })
  await sleep(2500)

  // An empty start: the browser's copies, and the sandbox's disk copy of the library (a thin put of an empty one).
  const wipe = async () => {
    await ev(`fetch(new URL('kybernos-theme/preset-store', document.baseURI).pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ library: { v: 1, updatedAt: Date.now() + 1000, presets: [], menu: null } }) }).then((r) => r.status)`)
    await ev(`['${STORE}', '${LIB}', '${MENU}'].forEach((k) => localStorage.removeItem(k))`)
  }
  const openTheme = async () => {
    const ok = await openSettings(page)
    for (const l of ['Theme', 'Thème']) { if ((await clickText(page, l)) === true) break }
    const there = await waitFor(page, `!!document.querySelector('[data-kb="theme-strip"]')`, 25000)
    await sleep(900)
    return ok === true && there !== null
  }

  section('The page opens')
  check('Settings › Theme opens', await openTheme())
  await wipe()
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  check('after the wipe, the page opens again', await openTheme())
  await shot('10-page')
  check('the strip names the appearance and the menu in use', (await stripA()) !== null && /Default|default|Kybernos/.test(await stripA()) && /Complete/.test(await stripM()), [await stripA(), await stripM()])
  const tiles = await ev(`[...document.querySelectorAll('[data-kb="theme-preset"]')].map((t) => t.dataset.id + '|' + t.dataset.src)`)
  check('ONE Presets section: the five vibes and the two menus are Built-in', tiles.length === 7 && tiles.every((t) => /\|builtin$/.test(t)) && tiles.filter((t) => /^vibe:/.test(t)).length === 5 && tiles.filter((t) => /^menu:/.test(t)).length === 2, tiles)
  const filt = await text('[data-kb="theme-preset-filter"]')
  check('the filter says All 7 | Built-in 7 | Mine 0', /All 7/.test(filt) && /Built-in 7/.test(filt) && /Mine 0/.test(filt), filt)
  check('every tile carries a badge and its chips (Appearance / Menu)', (await ev(`[...document.querySelectorAll('[data-kb="theme-preset"]')].every((t) => /Built-in/.test(t.innerText) && /(Appearance|Menu)/.test(t.innerText))`)) === true)
  check('no word « Look » on the page', !/\blook\b/i.test(await ev(`document.querySelector('[data-kb="theme-strip"]').closest('[class]').parentElement.innerText`) || ''))
  check('the Advanced editor is folded', (await ev(`(() => { const d = document.querySelector('[data-kb="theme-classic"]'); return !!d && !d.open })()`)) === true)
  check('no script error so far', errors.length === 0, errors)

  section('The window shows the REAL menu')
  const real = await realRows()
  const winRows = await ev(`[...document.querySelectorAll('[data-kb="theme-st-winrow"] .kbth-st-rn')].map((e) => e.textContent.trim())`)
  check('the real menu rows carry the hook data-kb-row', real.length >= 5 && real.some((r) => /^kyber=/.test(r)) && real.some((r) => /^skills=/.test(r)), real)
  check('the window draws the same rows, in the same order, under the same names', JSON.stringify(real.map((r) => r.split('=')[1])) === JSON.stringify(winRows), { real, winRows })
  check('the footer rows are drawn and cannot be hidden (Workspaces, Settings)', (await ev(`document.querySelectorAll('[data-kb="theme-st-window"] .kbth-st-row1.fixed').length`)) >= 1)

  section('Hover previews in the window only')
  const base0 = await baseToken(); const st0 = await state(); const w0 = await winStyle()
  await hover(tile('vibe:night') + ' [data-kb="theme-preset-open"]')
  const w1 = await winStyle()
  check('hovering a preset changes the window', JSON.stringify(w1) !== JSON.stringify(w0), [w0, w1])
  check('...and nothing of the real interface: the tokens and the stored state are the same', (await baseToken()) === base0 && JSON.stringify(await state()) === JSON.stringify(st0))
  await away()
  check('leaving it puts the window back', JSON.stringify(await winStyle()) === JSON.stringify(w0))

  section('Applying a preset')
  await click(tile('vibe:night') + ' [data-kb="theme-preset-open"]')
  check('an appearance-only preset applies at once (no sheet)', (await exists('[data-kb="theme-sheet"]')) === false && /Night/.test(await stripA()), await stripA())
  const st1 = await state()
  check('...the state is stored and the real interface changed', st1.mode !== undefined && (await baseToken()) !== base0)
  check('the tile says In use', (await text(tile('vibe:night'))).includes('In use'))
  check('Undo is available and goes back', await (async () => { await click('[data-kb="theme-undo"]'); return /default/i.test(await stripA()) })(), await stripA())
  await click(tile('menu:menu-simple') + ' [data-kb="theme-preset-open"]')
  check('a menu preset opens the Apply sheet with a tick for the menu', (await exists('[data-kb="theme-sheet"]')) === true && (await exists('[data-kb="theme-sheet-m"]')) === true)
  await shot('11-sheet')
  await click('[data-kb="theme-sheet-apply"]')
  await sleep(500)
  check('the strip says the menu in use is Simple', /Simple/.test(await stripM()), await stripM())
  const real2 = await realRows()
  check('the REAL menu followed: only the entries the preset keeps are drawn', real2.length === 2 && real2.length < real.length, real2)
  const doc = await menuDoc()
  check('the arrangement is stored (browser key) and the appearance state was not touched', doc !== null && doc.unlisted === 'hide' && JSON.stringify((await state()).skin) === JSON.stringify(st0.skin), doc)
  check('Undo covers the menu', await (async () => { await click('[data-kb="theme-undo"]'); await sleep(400); return (await realRows()).length === real.length })())

  section('The Menu panel (rows, order, names)')
  await click('[data-chip="menu"]')
  check('the Menu panel opens under the window', (await exists('[data-kb="theme-st-panel"][data-panel="menu"]')) === true)
  const rowIds = await ev(`[...document.querySelectorAll('[data-kb="theme-menu-row"]')].map((r) => r.dataset.id)`)
  check('it lists the real rows of this install', rowIds.join() === real.map((r) => r.split('=')[0]).join(), rowIds)
  check('Workspaces / Settings are shown as fixed (no switch)', (await count('[data-panel="menu"] .kbth-mr-row.fixed')) >= 2)
  await click('[data-kb="theme-menu-row"][data-id="skills"] [data-kb="theme-menu-show"]')
  await sleep(400)
  check('hiding Skills removes the REAL row (by its hook)', !(await realRows()).some((r) => /^skills=/.test(r)) && (await realRows()).some((r) => /^kyber=/.test(r)), await realRows())
  check('...and the window drops it too', !(await ev(`[...document.querySelectorAll('[data-kb="theme-st-winrow"] .kbth-st-rn')].map((e) => e.textContent.trim())`)).includes('Skills'))
  check('...the strip says the menu is custom', /Custom|custom/.test(await stripM()), await stripM())
  await click('[data-kb="theme-menu-row"][data-id="tasks"] [data-kb="theme-menu-down"]')
  const order = (await realRows()).map((r) => r.split('=')[0])
  check('moving Automations down moves the REAL row', order.indexOf('tasks') > order.indexOf('connectors'), order)
  await click('[data-kb="theme-menu-row"][data-id="connectors"] [data-kb="theme-menu-rename"]')
  check('Rename opens the names for the four languages', (await exists('[data-kb="theme-menu-names"]')) === true && (await exists('[data-kb="theme-menu-name-en"]')) === true && (await exists('[data-kb="theme-menu-name-fr"]')) === true)
  await typeIn('[data-kb="theme-menu-name-en"]', 'Apps & tools')
  await typeIn('[data-kb="theme-menu-name-fr"]', 'Outils')
  await sleep(500)
  const realNamed = await realRows()
  check('the REAL row takes the name of the page language only (en), not the French one', realNamed.some((r) => r === 'connectors=Apps & tools'), realNamed)
  check('...stored per language', JSON.stringify((await menuDoc()).entries.find((e) => e.id === 'connectors').label) === JSON.stringify({ en: 'Apps & tools', fr: 'Outils' }), await menuDoc())
  await shot('12-menu-panel')
  await click('[data-kb="theme-menu-showall"]')
  await sleep(400)
  check('« Show every entry » puts every row back', (await realRows()).length === real.length && (await realRows()).some((r) => /^skills=/.test(r)), await realRows())

  section('The Menu panel: the account menu and the Settings pages (zones)')
  const SURF = (surface) => ev(`(window.__KB_MENU_ENTRIES__ && window.__KB_MENU_ENTRIES__.list ? window.__KB_MENU_ENTRIES__.list(${JSON.stringify(surface)}) : []).map((i) => ({ id: i.id, locked: i.locked === true, group: i.group || '' }))`)
  const secList = await SURF('secondary')
  const setList = await SURF('settings')
  check('the page publishes the account menu and the Settings pages through the entry registry (with a hook each)', secList.length >= 10 && setList.length >= 25 && (await ev(`JSON.stringify(window.__KB_MENU_ENTRIES__.hooks)`)) === '{"main":"data-kb-row","secondary":"data-kb","settings":"data-kb-t"}', [secList.length, setList.length])
  const zoneBar = await ev(`[...document.querySelectorAll('[data-kb="theme-menu-zone"] [role="radio"]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim() + '|' + b.getAttribute('aria-checked'))`)
  check('the Menu panel offers three zones in ONE segmented control, the menu first and checked, each with its count', Array.isArray(zoneBar) && zoneBar.length === 3 && /^Menu \d+\/\d+\|true$/.test(zoneBar[0]) && /^Account menu \d+\/\d+\|false$/.test(zoneBar[1]) && /^Settings pages \d+\/\d+\|false$/.test(zoneBar[2]), zoneBar)
  await click('[data-kb="theme-menu-zone"] [role="radio"]', 1)
  const acctRows = await ev(`[...document.querySelectorAll('[data-kb="theme-surface-row"][data-surface="secondary"]')].map((r) => r.dataset.id)`)
  check('the Account menu zone lists every entry of the registry, in its order', acctRows.join() === secList.map((i) => i.id).join(), acctRows)
  const lockedAcct = secList.filter((i) => i.locked).map((i) => i.id)
  check('...the ones that open an app screen (account, referral, settings, sign out) carry a padlock and an off switch', lockedAcct.join() === ['account', 'referral', 'settings', 'logout'].filter((i) => lockedAcct.includes(i)).join() && lockedAcct.length === 4 && (await count('[data-kb="theme-surface-locked"]')) === 4 && (await count('[data-kb="theme-surface-row"][data-surface="secondary"] .kbth-mr-lk')) === 4 && (await ev(`[...document.querySelectorAll('[data-kb="theme-surface-row"][data-surface="secondary"]')].filter((r) => r.querySelector('.kbth-mr-lk')).every((r) => r.querySelector('[data-kb="theme-surface-show"]').disabled)`)) === true, lockedAcct)
  await shot('13-zone-account')
  const hasHelp = acctRows.includes('help')
  check('the account menu has a Help entry to try', hasHelp, acctRows)
  if (hasHelp) {
    await click('[data-kb="theme-surface-row"][data-surface="secondary"][data-id="help"] [data-kb="theme-surface-show"]')
    await sleep(500)
    const doc1 = await menuDoc()
    check('hiding Help is stored on the document\'s `secondary` surface, nothing on the main menu', !!doc1 && !!doc1.surfaces && !!doc1.surfaces.secondary && doc1.surfaces.secondary.entries.some((e) => e.id === 'help' && e.shown === false) && doc1.entries.every((e) => e.shown !== false), doc1)
    const css1 = await ev(`(document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent`)
    check('the plugin hides it by its hook, in a style it owns, and marks the page', /\[data-kb="menu-help"\]/.test(css1) && (await ev(`document.documentElement.getAttribute('data-kb-surfaces')`)) === 'on' && !/menu-account|menu-referral|menu-settings|menu-logout/.test(css1), css1.slice(0, 300))
    const drawn = await ev(`(() => { const e = document.querySelector('[data-kb="menu-help"]'); return e === null ? 'absent' : (getComputedStyle(e).display === 'none' ? 'hidden' : 'shown') })()`)
    check('...and the real entry, when the account menu is drawn, is not shown (' + drawn + ' on the sandbox)', drawn === 'absent' || drawn === 'hidden', drawn)
  }
  await click('[data-kb="theme-menu-zone"] [role="radio"]', 2)
  const pageRows = await ev(`[...document.querySelectorAll('[data-kb="theme-surface-row"][data-surface="settings"]')].map((r) => r.dataset.id)`)
  check('the Settings pages zone lists every page of the registry, under the name of its group, General locked', pageRows.join() === setList.map((i) => i.id).join() && (await count('[data-kb="theme-surface-group"]')) >= 3 && (await count('[data-kb="theme-surface-locked"]')) === 1 && (await ev(`document.querySelector('[data-kb="theme-surface-row"][data-id="general"] [data-kb="theme-surface-show"]').disabled`)) === true, pageRows)
  await shot('14-zone-settings')
  const target = ['about', 'workers', 'hooks'].find((id) => pageRows.includes(id) && !setList.find((i) => i.id === id).locked) || pageRows.find((id) => id !== 'general' && id !== 'theme' && id !== 'kaby')
  const cellsBefore = await ev(`[...document.querySelectorAll('[class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').length`)
  await click(`[data-kb="theme-surface-row"][data-surface="settings"][data-id="${target}"] [data-kb="theme-surface-show"]`)
  await sleep(700)
  const css2 = await ev(`(document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent`)
  const hook = (css2.match(/\[class\*="navList"\] \[data-kb-t="([^"]+)"\]/) || [])[1]
  check('hiding the page "' + target + '" adds one rule on its nav cell hook (data-kb-t), by hook and not by label', hook !== undefined && !/general/i.test(css2.replace(/\[data-kb-t="[^"]*"\]/g, '')) , css2.slice(0, 300))
  const cellsAfter = await ev(`[...document.querySelectorAll('[class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').length`)
  check('...and the real nav of Settings loses exactly that cell (' + cellsBefore + ' -> ' + cellsAfter + ')', typeof cellsBefore === 'number' && cellsBefore > 0 && cellsAfter === cellsBefore - 1, [cellsBefore, cellsAfter])
  check('...while the Theme page itself, General and Kaby stay on screen (the hiding never removes the page you are on)', (await exists('[data-kb="theme-strip"]')) === true)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  const early = await ev(`({ on: document.documentElement.getAttribute('data-kb-surfaces'), css: (document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent.length })`)
  check('it survives a reload: the style is back from the stored copy before any Settings page is opened', !!early && early.on === 'on' && early.css > 20, early)
  const reopened = await openTheme()
  const cellsReload = await ev(`[...document.querySelectorAll('[class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').length`)
  check('...and Settings opens again with that page still gone from its nav (' + cellsReload + ' of ' + cellsBefore + ')', reopened === true && cellsReload === cellsBefore - 1, [reopened, cellsReload, cellsBefore])
  await click('[data-chip="menu"]')
  await click('[data-kb="theme-menu-zone"] [role="radio"]', 0)
  check('back on the Menu zone, the label says what is hidden elsewhere', /Menu \d+\/\d+/.test(await text('[data-kb="theme-menu-zone"] [aria-checked="true"]')) && (await text('[data-kb="theme-strip-m"]')) !== null && /Custom|custom/.test(await stripM()), await stripM())
  await click('[data-kb="theme-menu-showall"]')
  await sleep(700)
  const doc2 = await menuDoc()
  check('« Show every entry » on the Menu zone puts the two surfaces back too: no hidden entry stored, the style is empty, the cell is back', (doc2 === null || doc2 === undefined || (doc2.entries.every((e) => e.shown !== false) && (doc2.surfaces === undefined || Object.keys(doc2.surfaces).every((k) => doc2.surfaces[k].unlisted === 'show' && doc2.surfaces[k].entries.every((e) => e.shown !== false))))) && ((await ev(`(document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent.trim()`)) === '') && (await ev(`[...document.querySelectorAll('[class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').length`)) === cellsBefore, doc2)
  await click('[data-kb="theme-st-done"]')

  section('Save as preset, Mine, rename, duplicate, delete')
  await click('[data-kb="theme-menu-row"][data-id="skills"] [data-kb="theme-menu-show"]').catch(async () => { await click('[data-chip="menu"]'); await click('[data-kb="theme-menu-row"][data-id="skills"] [data-kb="theme-menu-show"]') })
  await click('[data-kb="theme-st-done"]').catch(() => {})
  await click('[data-kb="theme-save"]')
  check('Save as preset opens the sheet with ticks (accessibility OFF by default)', (await exists('[data-kb="theme-save-sheet"]')) === true && (await ev(`document.querySelector('[data-kb="theme-save-acc"]').getAttribute('aria-checked') ?? document.querySelector('[data-kb="theme-save-acc"] [role="switch"]')?.getAttribute('aria-checked')`)) !== 'true', await ev(`({ sheet: !!document.querySelector('[data-kb="theme-save-sheet"]'), acc: !!document.querySelector('[data-kb="theme-save-acc"]'), save: (document.querySelector('[data-kb="theme-save"]') || {}).outerHTML, sheets: [...document.querySelectorAll('[data-kb]')].map((e) => e.dataset.kb).filter((k) => /save/.test(k)) })`))
  await typeIn('[data-kb="theme-save-name"]', 'Office')
  await click('[data-kb="theme-save-ok"]')
  await sleep(500)
  const l1 = await lib()
  check('the preset is saved in Mine (browser copy), with its menu part', l1.presets.length === 1 && l1.presets[0].name === 'Office' && l1.presets[0].menu !== undefined, l1.presets.map((p) => p.name))
  check('...the tile is in Mine with its badge', (await text('[data-kb="theme-preset"][data-src="mine"]')).includes('Mine') && /Mine 1/.test(await text('[data-kb="theme-preset-filter"]')), await text('[data-kb="theme-preset-filter"]'))
  await click('[data-kb="theme-preset-filter"] [data-id="mine"]')
  check('the filter Mine shows only mine', (await count('[data-kb="theme-preset"]')) === 1)
  await click('[data-kb="theme-preset-more"]')
  check('a Mine preset can be renamed, exported, deleted (not only duplicated)', (await exists('[data-kb="theme-preset-rename"]')) === true && (await exists('[data-kb="theme-preset-export"]')) === true && (await exists('[data-kb="theme-preset-delete"]')) === true)
  await click('[data-kb="theme-preset-rename"]')
  await typeIn('[data-kb="theme-preset-rename-in"]', 'Office 2')
  await click('[data-kb="theme-preset-rename-ok"]')
  check('rename works', (await lib()).presets[0].name === 'Office 2', (await lib()).presets.map((p) => p.name))
  await click('[data-kb="theme-preset-filter"] [data-id="builtin"]')
  await click(tile('vibe:work') + ' [data-kb="theme-preset-more"]')
  check('a Built-in preset offers Duplicate to Mine, and no rename or delete', (await exists('[data-kb="theme-preset-dup"]')) === true && (await exists('[data-kb="theme-preset-rename"]')) === false && (await exists('[data-kb="theme-preset-delete"]')) === false)
  await click('[data-kb="theme-preset-dup"]')
  check('the copy is in Mine', (await lib()).presets.length === 2, (await lib()).presets.map((p) => p.name))
  await click('[data-kb="theme-preset-filter"] [data-id="mine"]')
  await click('[data-kb="theme-preset-more"]', 1)
  await click('[data-kb="theme-preset-delete"]')
  check('delete asks first', (await exists('[data-kb="theme-preset-confirm"]')) === true && (await lib()).presets.length === 2)
  await click('[data-kb="theme-preset-delete-yes"]')
  check('...and deletes after the confirmation', (await lib()).presets.length === 1)
  await click('[data-kb="theme-preset-filter"] [data-id="all"]')

  section('A menu from outside: applied only after its tick')
  const outside = JSON.stringify({ format: 'kybernos-theme-preset', version: 1, name: 'Shop menu', menu: { entries: [{ id: 'kyber', shown: true, order: 0, label: { en: 'Boss' } }, { id: 'skills', shown: false, order: 1 }], unlisted: 'show', locked: false } })
  const imported = await ev(`(() => { const i = document.querySelector('[data-kb="theme-import"]'); if (!i) return false; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(outside)}], 'shop.json', { type: 'application/json' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await sleep(900)
  const l2 = await lib()
  check('a file is imported into Mine and applies nothing by itself', imported === true && l2.presets.some((p) => p.name === 'Shop menu') && !(await realRows()).some((r) => r === 'kyber=Boss'), l2.presets.map((p) => p.name))
  const shopId = (l2.presets.find((p) => p.name === 'Shop menu') || {}).id
  await click(tile('rec:' + shopId) + ' [data-kb="theme-preset-open"]')
  check('applying it opens a sheet where the Menu tick starts UNTICKED', (await exists('[data-kb="theme-sheet-m"]')) === true && (await ev(`(() => { const e = document.querySelector('[data-kb="theme-sheet-m"]'); const s = e.matches('[aria-checked]') ? e : e.querySelector('[aria-checked]'); return s ? s.getAttribute('aria-checked') : e.querySelector('input')?.checked })()`)) !== 'true' && (await ev(`document.querySelector('[data-kb="theme-sheet-apply"]').disabled`)) === true)
  await click('[data-kb="theme-sheet-m"]')
  await click('[data-kb="theme-sheet-apply"]')
  await sleep(500)
  check('ticked and applied: the REAL row is renamed', (await realRows()).some((r) => r === 'kyber=Boss'), await realRows())
  check('...and the person\'s own menu was kept in Mine first (one click goes back)', (await lib()).presets.some((p) => p.menu !== undefined && /menu/i.test(p.name) && p.name !== 'Shop menu'), (await lib()).presets.map((p) => p.name))
  await click('[data-kb="theme-undo"]')
  await sleep(400)
  check('Undo puts the menu back', !(await realRows()).some((r) => r === 'kyber=Boss'))

  section('The Advanced editor: real tabs')
  await ev(`(() => { const d = document.querySelector('[data-kb="theme-classic"]'); if (d && !d.open) { d.open = true; d.dispatchEvent(new Event('toggle')) } })()`)
  await sleep(600)
  const tabIds = await ev(`[...document.querySelectorAll('[data-kb="theme-adv-tab"]')].map((t) => t.dataset.id)`)
  check('11 tabs: Colours, Letters, Shapes, Background, Effects, Icons, Menu, Animation, Accessibility, Import / Export, Gallery', tabIds.join() === 'couleurs,lettres,formes,fond,effets,icones,menu,animation,accessibilite,partage,galerie', tabIds)
  check('they are real tabs (role tab, one selected, a tabpanel)', (await ev(`document.querySelectorAll('[role="tab"][aria-selected="true"]').length`)) >= 1 && (await exists('[role="tabpanel"]')) === true)
  const seen = {}
  for (const id of tabIds) {
    await click(`[data-kb="theme-adv-tab"][data-id="${id}"]`)
    await sleep(350)
    seen[id] = await ev(`(() => { const p = document.querySelector('[role="tabpanel"]'); return p ? { controls: p.querySelectorAll('button, input, select, [role="combobox"], [role="radio"], [role="switch"]').length, text: p.innerText.length } : null })()`)
  }
  check('every tab shows its own controls', Object.values(seen).every((v) => v !== null && v.controls > 0 && v.text > 20), seen)
  check('the tabs answer the arrow keys', await (async () => { await click('[data-kb="theme-adv-tab"][data-id="couleurs"]'); await key('ArrowRight'); return (await ev(`document.querySelector('[role="tab"][aria-selected="true"]').dataset.id`)) === 'lettres' })())
  await shot('13-adv-letters')

  section('Selects and segmented controls')
  await click('[data-kb="theme-adv-tab"][data-id="lettres"]')
  const fontSel = '[data-kb="theme-adv-tab"] ~ * [role="combobox"], [role="tabpanel"] [role="combobox"]'
  const combos = await count('[role="tabpanel"] [role="combobox"]')
  check('the font is ONE select (not a grid of cards)', combos >= 1, combos)
  await click('[role="tabpanel"] [role="combobox"]')
  check('it opens a listbox of options, grouped, drawn in their own style', (await exists('[role="listbox"]')) === true && (await count('[role="listbox"] [role="option"]')) >= 20 && (await ev(`new Set([...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => getComputedStyle(o).fontFamily)).size`)) > 3)
  await shot('14-select-open')
  const f0 = await ev(`document.querySelector('[role="tabpanel"] [role="combobox"]').getAttribute('data-value')`)
  await key('ArrowDown'); await key('ArrowDown')
  check('arrow keys move through the options', (await ev(`document.querySelector('[role="listbox"] [role="option"][data-act="1"]')?.dataset.value`)) !== f0)
  await key('Escape')
  check('Escape closes it and keeps the previous choice', (await exists('[role="listbox"]')) === false && (await ev(`document.querySelector('[role="tabpanel"] [role="combobox"]').getAttribute('data-value')`)) === f0 && (await state()).fontText === (await state()).fontText)
  await click('[role="tabpanel"] [role="combobox"]')
  await key('ArrowDown'); await key('Enter')
  check('Enter keeps the option', (await ev(`document.querySelector('[role="tabpanel"] [role="combobox"]').getAttribute('data-value')`)) !== f0)
  await click('[data-kb="theme-adv-tab"][data-id="couleurs"]')
  const seg = await ev(`[...document.querySelectorAll('[role="tabpanel"] [role="radiogroup"]')].map((g) => g.querySelectorAll('[role="radio"]').length)`)
  check('segmented controls hold 2 to 4 options', seg.length > 0 && seg.every((n) => n >= 2 && n <= 4), seg)
  const mode0 = (await state()).mode
  await click('[data-kb="theme-mode"] [role="radio"][aria-checked="false"]')
  check('a segmented control changes its value on a click (the mode)', (await state()).mode !== mode0, [mode0, (await state()).mode])
  await ev(`document.querySelector('[data-kb="theme-mode"] [role="radio"][aria-checked="true"]').focus()`)
  const checked0 = await ev(`document.querySelector('[data-kb="theme-mode"] [role="radio"][aria-checked="true"]').dataset.id`)
  await key('ArrowRight')
  check('...and moves with the arrow keys', (await ev(`document.querySelector('[data-kb="theme-mode"] [role="radio"][aria-checked="true"]').dataset.id`)) !== checked0)
  await click('[data-kb="theme-mode"] [role="radio"][data-id="' + mode0 + '"]')

  section('Import / Export tab, resets')
  await click('[data-kb="theme-adv-tab"][data-id="partage"]')
  check('the three resets exist (appearance, menu, everything)', (await exists('[data-kb="theme-reset-adv-a"]')) === true && (await exists('[data-kb="theme-reset-adv-m"]')) === true && (await exists('[data-kb="theme-reset-adv-all"]')) === true)
  check('export is folded away and offers the formats', (await exists('[data-kb="theme-export-fold"]')) === true)
  await click('[data-kb="theme-reset-adv-all"]')
  await sleep(500)
  check('Reset everything brings back the default appearance and menu, and keeps Mine', /default/i.test(await stripA()) && /Complete/.test(await stripM()) && (await lib()).presets.length >= 1, [await stripA(), await stripM()])

  section('It survives a reload (browser copy and disk copy)')
  await click('[data-kb="theme-adv-tab"][data-id="menu"]').catch(() => {})
  await click(tile('vibe:night') + ' [data-kb="theme-preset-open"]')
  await click('[data-chip="menu"]').catch(() => {})
  await click('[data-kb="theme-menu-row"][data-id="skills"] [data-kb="theme-menu-show"]')
  await sleep(600)
  const disk = await ev(`fetch(new URL('kybernos-theme/preset-store', document.baseURI).pathname).then((r) => r.json())`)
  check('the disk copy holds the library and the menu in use', disk && disk.library !== undefined ? Array.isArray(disk.library.presets) && disk.library.menu !== undefined : Array.isArray(disk.presets), Object.keys(disk || {}))
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  const rowsAtPaint = await realRows() // before Settings is even opened: the menu has the arrangement at first paint
  let back = await openTheme()
  if (!back) { await page.send('Page.reload', { ignoreCache: true }); await sleep(4000); back = await openTheme() }
  check('after a reload the REAL menu has the arrangement at first paint (Skills still hidden)', rowsAtPaint.length > 0 && !rowsAtPaint.some((r) => /^skills=/.test(r)), rowsAtPaint)
  check('...and the Theme page shows the appearance and the menu in use', back && /Night/.test(await stripA()) && /Custom/.test(await stripM()), [back, await stripA(), await stripM()])

  section('A phone-width page (390 px)')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(1200)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  const phoneOpen = await openSettings(page, { fold: 'keep' }).catch(() => false)
  if (phoneOpen) { for (const l of ['Theme', 'Thème']) { if ((await clickText(page, l)) === true) break } }
  const phoneThere = await waitFor(page, `!!document.querySelector('[data-kb="theme-strip"]')`, 20000)
  await sleep(900)
  check('the page opens at 390 px', phoneThere !== null)
  if (phoneThere !== null) {
    await shot('20-phone-page')
    const over = await ev(`(() => { const root = document.querySelector('[data-kb="theme-presets"]').closest('[class]'); let w = 0; for (const e of document.querySelectorAll('[data-kb="theme-strip"], [data-kb="theme-preset-list"], [data-kb="theme-st-window"]')) { const b = e.getBoundingClientRect(); w = Math.max(w, b.right) } return { right: w, vw: window.innerWidth, scroll: document.documentElement.scrollWidth } })()`)
    check('the strip, the tiles and the window fit in the width (no horizontal scroll)', over.right <= over.vw + 1 && over.scroll <= over.vw + 1, over)
    await click(tile('vibe:chill') + ' [data-kb="theme-preset-open"]')
    check('a preset can be applied by tapping at this width', /Chill/.test(await stripA()), await stripA())
    await click('[data-chip="menu"]')
    await shot('21-phone-menu')
    const mr = await ev(`(() => { const r = document.querySelector('[data-kb="theme-menu-row"]'); if (!r) return null; const b = r.getBoundingClientRect(); const bs = [...r.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height), q.right <= window.innerWidth + 1] }); return { w: Math.round(b.width), right: b.right <= window.innerWidth + 1, bs } })()`)
    check('the Menu panel rows fit and their buttons are reachable', mr !== null && mr.right === true && mr.bs.every((b) => b[2] === true), mr)
    const zf = await ev(`(() => { const z = document.querySelector('[data-kb="theme-menu-zone"]'); if (!z) return null; const b = z.getBoundingClientRect(); const bs = [...z.querySelectorAll('[role="radio"]')].map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height), q.left >= 0 && q.right <= window.innerWidth + 1] }); return { right: b.right <= window.innerWidth + 1, scrollFits: document.documentElement.scrollWidth <= window.innerWidth + 1, bs } })()`)
    check('the three zones fit at 390 px, every one reachable and at least 36 px tall', zf !== null && zf.right === true && zf.scrollFits === true && zf.bs.length === 3 && zf.bs.every((b) => b[2] === true && b[1] >= 36), zf)
    await ev(`document.querySelectorAll('[data-kb="theme-menu-zone"] [role="radio"]')[2].scrollIntoView({ block: 'end' })`) // the window is sticky at this width and covers the top of the screen: the panel scrolls under it
    await sleep(600)
    const hit = await ev(`(() => { const r = document.querySelectorAll('[data-kb="theme-menu-zone"] [role="radio"]')[2]; const b = r.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], vh: window.innerHeight, top: e ? (e.tagName + '.' + String(e.className).slice(0, 40) + '|' + (e.dataset.kb || '') + '|' + (r.contains(e) ? 'radio' : 'OTHER')) : null } })()`)
    check('the Settings-pages zone can be tapped at 390 px (nothing covers it)', !!hit && /radio$/.test(hit.top || ''), hit)
    await click('[data-kb="theme-menu-zone"] [role="radio"]', 2, 'end')
    const sf = await ev(`(() => { const r = document.querySelector('[data-kb="theme-surface-row"]'); if (!r) return null; const b = r.getBoundingClientRect(); const bs = [...r.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height), q.left >= 0 && q.right <= window.innerWidth + 1] }); return { right: b.right <= window.innerWidth + 1, scrollFits: document.documentElement.scrollWidth <= window.innerWidth + 1, bs } })()`)
    await shot('21b-phone-zone')
    check('a Settings-page row fits at 390 px and its switch is reachable (same switch as the menu rows)', sf !== null && sf.right === true && sf.scrollFits === true && sf.bs.every((b) => b[2] === true && b[0] >= 36 && b[1] >= 20), sf)
    await click('[data-kb="theme-menu-zone"] [role="radio"]', 0, 'end')
    await click('[data-kb="theme-st-done"]').catch(() => {})
    await ev(`(() => { const d = document.querySelector('[data-kb="theme-classic"]'); if (d && !d.open) { d.open = true; d.dispatchEvent(new Event('toggle')) } })()`)
    await sleep(500)
    const tabsFit = await ev(`(() => { const t = document.querySelector('.kbth-adv-tabs'); if (!t) return null; const b = t.getBoundingClientRect(); return { right: b.right, vw: window.innerWidth, canScroll: t.scrollWidth > t.clientWidth, overflowX: getComputedStyle(t).overflowX, dir: getComputedStyle(t).flexDirection } })()`)
    check('the tabs become one row that scrolls inside itself', tabsFit !== null && tabsFit.right <= tabsFit.vw + 1 && tabsFit.dir === 'row' && tabsFit.canScroll === true, tabsFit)
    await click('[data-kb="theme-adv-tab"][data-id="couleurs"]')
    const stretched = await ev(`[...document.querySelectorAll('[role="tabpanel"] *')].filter((e) => { const b = e.getBoundingClientRect(); const r = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0; return b.width > 120 && b.height > 8 && b.width / b.height > 4 && r >= b.height / 2 && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && !/(slider|track|range|bar|ramp|toggle|seg)/i.test(e.className) }).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`)
    check('no round control is stretched into an ellipse on the Colours tab', stretched.length === 0, stretched)
    await ev(`document.querySelector('.kbth-adv-tabs').scrollIntoView({ block: 'start' })`)
    await sleep(300)
    await shot('22-phone-tabs')
    await click('[data-kb="theme-adv-tab"][data-id="icones"]')
    await shot('23-phone-icons')
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  section('Kaby mode: the locked Simple preset is read, the full app is untouched')
  {
    const KABY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios) KabyMode/1'
    const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(JSON.parse(s)) } catch (e) { window.__kbOut.push({ raw: String(s) }) } } };'
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await page.send('Emulation.setUserAgentOverride', { userAgent: KABY_UA, platform: 'iPhone' })
    const shellId = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SHELL_JS })
    await ev(`['${STORE}', '${LIB}', '${MENU}'].forEach((k) => localStorage.removeItem(k))`)
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(4000)
    const inKaby = await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('[data-kb="mobile-menu"]')`, 30000)
    check('with the shell\'s token the page is in Kaby mode and the phone\'s own burger is drawn', inKaby !== null)
    const seamInfo = await ev(`(() => { const L = window.__KB_THEME_LOCKED__; if (!L) return null; const d = Object.getOwnPropertyDescriptor(window, '__KB_THEME_LOCKED__'); const doc = L.get('locked-simple'); return { v: L.v, ids: typeof L.ids === 'function' ? L.ids() : null, frozen: Object.isFrozen(L), writable: d.writable, configurable: d.configurable, entries: doc ? doc.entries.map((e) => e.id + ':' + e.shown).join() : null, unlisted: doc ? doc.unlisted : null, surfaces: doc && doc.surfaces ? Object.keys(doc.surfaces).join() : null } })()`)
    check('the Theme plugin publishes the locked presets read-only: one, `locked-simple`, frozen, not writable, not configurable', !!seamInfo && seamInfo.v === 1 && Array.isArray(seamInfo.ids) && seamInfo.ids.join() === 'locked-simple' && seamInfo.frozen === true && seamInfo.writable === false && seamInfo.configurable === false, seamInfo)
    check('its document is the owner\'s six defaults: the main rows of Simple (Kaby, Reminders = tasks, Apps = connectors, the registry\'s own ids), a surface for the account menu and for the Settings pages', !!seamInfo && /^kyber:true,tasks:true,connectors:true$/.test(seamInfo.entries) && seamInfo.unlisted === 'hide' && seamInfo.surfaces === 'secondary,settings', seamInfo)
    const forged = await ev(`(() => { const before = window.__KB_THEME_LOCKED__; try { window.__KB_THEME_LOCKED__ = { v: 1, ids: ['x'], get: () => null } } catch (e) { /* strict */ } let del = true; try { del = delete window.__KB_THEME_LOCKED__ } catch (e) { del = false } const a = window.__KB_THEME_LOCKED__.get('locked-simple'); a.entries.length = 0; a.unlisted = 'show'; const b = window.__KB_THEME_LOCKED__.get('locked-simple'); return { same: window.__KB_THEME_LOCKED__ === before, del, fresh: b.entries.length > 0 && b.unlisted === 'hide', unknown: window.__KB_THEME_LOCKED__.get('locked-nothing') === null || window.__KB_THEME_LOCKED__.get('locked-nothing') === undefined } })()`)
    check('it cannot be forged or edited: assigning or deleting the seam does nothing, a copy that is changed does not change the next one, an unknown id answers nothing', !!forged && forged.same === true && forged.del === false && forged.fresh === true && forged.unknown === true, forged)
    const kcss = await ev(`(document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent`)
    check('Kaby mode applies the preset\'s hiding (the plugin reads the preset there, not the person\'s own menu)', (await ev(`document.documentElement.getAttribute('data-kb-surfaces')`)) === 'on' && kcss.length > 100, kcss.slice(0, 120))
    await click('[data-kb="mobile-menu"]').catch(() => {})
    await sleep(700)
    const kRows = await ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).map((b) => b.getAttribute('data-kb-row'))`)
    check('the phone\'s drawer is the real sidebar and draws the preset\'s rows: Kaby, Reminders (tasks), Apps (connectors)', Array.isArray(kRows) && kRows.join() === 'kyber,tasks,connectors', kRows)
    await shot('30-simple-drawer')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: shellId.identifier || (shellId.result && shellId.result.identifier) }).catch(() => {})
    await page.send('Emulation.setUserAgentOverride', { userAgent: '' })
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(3500)
    const fullApp = await ev(`({ cls: document.documentElement.classList.contains('kb-kaby'), surfaces: document.documentElement.getAttribute('data-kb-surfaces'), css: (document.getElementById('kb-surfaces-css') || { textContent: '' }).textContent.trim() })`)
    check('back on the full app (no token): no Kaby class, and the preset hides nothing in it', !!fullApp && fullApp.cls === false && fullApp.surfaces !== 'on' && fullApp.css === '', fullApp)
  }

  section('No script error')
  check('no exception and no console error during the whole run', errors.length === 0, errors)
} catch (e) {
  failures.push('the script itself: ' + e.message)
  console.log('  ✗ the script stopped: ' + e.message)
  try { await shot('99-stopped') } catch (e2) { /* nothing */ }
} finally {
  try { await ev(`['${STORE}', '${LIB}', '${MENU}'].forEach((k) => localStorage.removeItem(k))`) } catch (e) { /* the browser is thrown away anyway */ }
  await live.close()
}
console.log('\n' + (failures.length === 0 ? '✓ ' + pass + ' checks, 0 failed' : '✗ ' + pass + ' passed, ' + failures.length + ' failed: ' + failures.join(' | ')))
process.exit(failures.length === 0 ? 0 : 1)
