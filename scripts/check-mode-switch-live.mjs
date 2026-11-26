#!/usr/bin/env node
// The display MODE (owner's list items 35, 36, 37 of 2026-11-24): ONE mode, Simple or Complete, with two effects (the navigation preset and the technical view), resolved once per load in
// the order choice > the shell's word > touch > Complete, kept per account, and switched from three places (the drawer's segment, the account menu's Display row, the ⌘K palette).
//
//   source scripts/sandbox/env.sh && node scripts/check-mode-switch-live.mjs [--shots <dir>]
//
// What it plays, on the sandbox (never :3080), at the width of a phone (406 px) unless said:
//   A  inside the Kybernos app (`KybernosHost` + `KabyMode/1`, a stub of the shell's `ReactNativeWebView`): Auto = Simple from the shell; the segment of the drawer's foot (Auto · Simple · Complete);
//      a tap on Complete keeps the choice in the account's store, tells the shell (`set-mode`, « advanced »), and the page then reloads Complete although the shell still says Simple (an explicit
//      choice beats the shell) while the HOST class `kb-kaby` stays: the three axes do not depend on one another; a tap on Auto comes back.
//   B  a touch phone in a browser (no `KybernosHost`): Auto = Simple from touch, no segment (it is the app's), the account menu's Display row opens the sheet, a choice reloads and is kept.
//   C  a computer (1400 px, a mouse): Auto = Complete; the sheet is a centred dialog; choosing Simple reloads Simple with the NAVIGATION preset but not the phone's layout (the web is not a mobile
//      preset); a narrow window with a mouse is still Complete, and resizing never re-resolves.
//   D  the palette: ⌘K lists « Display… » and one command per choice; a command runs after the dialog closed.
//   E  French: the sheet, the row, the segment and the palette speak French; light and dark: the sheet is legible in both.
// Exit 0: every check passed, 1: a check failed, 3: not run (no GUI, or not the sandbox).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST)) {
  console.error('○ not run: this check writes the display choice of the account it opens. Run it on the sandbox: source scripts/sandbox/env.sh && node scripts/check-mode-switch-live.mjs')
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
const shot = async (name) => {
  if (shotsDir === null) return
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { /* no shot */ }
}
const rect = (sel, nth = 0) => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right } })()`)
const click = async (sel, nth = 0) => {
  const r = await rect(sel, nth)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(300)
  return true
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' })()`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : null })()`)
const key = async (k, code, vk, modifiers = 0) => {
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
  await sleep(250)
}

const BURGER = '[data-kb="mobile-menu"]'
const AVATAR = '[data-kb="mobile-avatar"]'
const SEG = '[data-kb="mode-segment"]'
const SHEET = '[data-kb="mode-sheet"]'
const CHROME_MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KybernosHost/0.1.0 (android) KabyMode/1 KybernosCaps/where,account,plans,referral,signout,mode'
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(JSON.parse(s)) } catch (e) { window.__kbOut.push({ raw: String(s) }) } } };'
const SHELL_STATE = "window.__KB_APP__ && window.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, mode: true, screens: ['account', 'plan', 'help', 'where'] }, notifications: 'undetermined', connection: 'local' })"
const MODE_KEY = 'kybernos.mode.v1'
const errors = []
let scriptId = null
/** The page under phone (or computer) conditions: size, touch, user agent, the shell's stub, the language; the account's choice and the page's copy are cleared first (a clean Auto). */
const setup = async ({ ua, width = 406, height = 844, dpr = 2, touch = true, mobile = true, shell = false, lang = null, scheme = null, reset = true }) => {
  if (reset) {
    await ev(`(async () => { try { localStorage.removeItem(${JSON.stringify(MODE_KEY)}) } catch (e) {} try { await fetch('/kybernos-mobile/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pref: 'auto', at: Date.now() }) }) } catch (e) {} return true })()`)
  }
  if (mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 0 })
  } else {
    // a computer: the browser's own window with a mouse. (A device override that was once `mobile` keeps `maxTouchPoints` and `pointer: coarse` until it is cleared, whatever the next override says.)
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: mobile ? 'Linux armv81' : 'MacIntel' })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme === null ? 'light' : scheme }] })
  if (scriptId !== null) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => {}); scriptId = null }
  const source = (shell ? SHELL_JS : '') + (lang !== null ? `try { localStorage.setItem('kybernos.theme.lang', '${lang}') } catch (e) {}` : `try { localStorage.removeItem('kybernos.theme.lang') } catch (e) {}`)
  const r = await page.send('Page.addScriptToEvaluateOnNewDocument', { source })
  scriptId = r.identifier || (r.result && r.result.identifier) || null
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  return waitFor(page, `document.documentElement.hasAttribute('data-kb-mode') && !!window.__KB_MODE__`, 30000)
}
const state = () => ev(`(() => { const r = document.documentElement; return { simple: r.classList.contains('kb-simple'), mode: r.getAttribute('data-kb-mode'), pref: r.getAttribute('data-kb-mode-pref'), source: r.getAttribute('data-kb-mode-source'), kaby: r.classList.contains('kb-kaby'), surfaces: r.getAttribute('data-kb-surfaces'), touch: r.hasAttribute('data-kb-touch'), width: innerWidth, scrollW: r.scrollWidth } })()`)
const stored = () => ev(`fetch('/kybernos-mobile/mode', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null)`)
const kb = (label, s, want) => check(label, !!s && Object.keys(want).every((k) => s[k] === want[k]), s)
/** Waits for the page to come back from a reload it started (the mark is lost with the old document). */
const waitReload = async (mark) => { await waitFor(page, `window.__kbMark !== ${JSON.stringify(mark)}`, 25000); await sleep(800); return waitFor(page, `document.documentElement.hasAttribute('data-kb-mode') && !!window.__KB_MODE__`, 30000) }
const markPage = (m) => ev(`(window.__kbMark = ${JSON.stringify(m)}, true)`)
const drawerIsOpen = () => ev(`(() => { const r = document.querySelector('[data-slot="root"] > div'); return r ? !r.hasAttribute('data-sidebar-collapsed') : null })()`)
/** Opens the drawer with the burger and says it is open: right after a reload the phone layer may not be mounted yet, so it waits for the burger and tries again. */
const openDrawer = async () => {
  await waitFor(page, `!!document.querySelector('${BURGER}') && document.querySelector('${BURGER}').getBoundingClientRect().width > 0`, 15000)
  for (let i = 0; i < 4; i += 1) {
    if ((await drawerIsOpen()) === true) { await sleep(400); return true }
    await click(BURGER)
    await sleep(800)
  }
  return (await drawerIsOpen()) === true
}
/** The account menu: the avatar of the app's dock, or the account card at the foot of the drawer in a browser. */
const openAccountMenu = async () => {
  await openDrawer()
  if ((await visible(AVATAR)) === true) await click(AVATAR); else await click('.kbfp-cardmain')
  await sleep(700)
}
const radios = () => ev(`[...document.querySelectorAll('${SHEET} [role="radio"]')].map((r) => [r.getAttribute('data-act'), r.getAttribute('aria-checked'), r.textContent.slice(0, 60)])`)

try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => { errors.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 300)) })

  section('A. Inside the Kybernos app (KabyMode/1, a stub shell): Auto = Simple from the shell, the drawer\'s segment, an explicit choice beats the shell, the host class stays')
  check('the page loads with the seam and the resolver', (await setup({ ua: APP_UA, shell: true })) !== null)
  await ev(SHELL_STATE)
  let s = await state()
  kb('Auto inside the app is the shell\'s word: Simple, from the shell, the class on <html>', s, { simple: true, mode: 'simple', pref: 'auto', source: 'shell', kaby: true })
  check('the navigation preset follows the mode (the surfaces\' filter is on)', (await waitFor(page, `document.documentElement.getAttribute('data-kb-surfaces') === 'on'`, 20000)) !== null)
  await openDrawer()
  check('the drawer\'s foot has the segment, three buttons, Auto pressed', (await visible(SEG)) === true && JSON.stringify(await ev(`[...document.querySelectorAll('${SEG} button')].map((b) => [b.getAttribute('data-act'), b.getAttribute('aria-pressed')])`)) === JSON.stringify([['mode-auto', 'true'], ['mode-simple', 'false'], ['mode-complete', 'false']]))
  const seg = await rect(SEG)
  const dock = await rect('.kbmob-dock > *')
  const drawerW = dock !== null && dock !== undefined ? ((await rect('.kbmob-dock')) || {}).right || 0 : 0 // the dock spans the drawer's width
  const drawerBox = { right: drawerW }
  check('the segment sits above the dock, inside the drawer, and a thumb high (44 px buttons)', !!seg && !!dock && drawerW > 0 && seg.bottom <= dock.top + 1 && seg.left >= 0 && seg.right <= drawerBox.right + 1 && (await ev(`[...document.querySelectorAll('${SEG} button')].every((b) => b.getBoundingClientRect().height >= 44)`)) === true, { seg, dock, drawerBox })
  check('no sideways scroll with it', (await state()).scrollW <= 408)
  const rows = await ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().bottom)`)
  check('the drawer\'s rows end above the segment (nothing hides behind it)', Array.isArray(rows) && rows.length > 0 && seg !== null && Math.max(...rows) <= seg.top + 1, { rows, segTop: seg && seg.top })
  await shot('A1-drawer-segment-auto')
  await markPage('before-complete')
  await ev('window.__kbOut = []')
  await click(SEG + ' [data-act="mode-complete"]')
  check('busy at once: the buttons are off and the group says so', (await ev(`document.querySelector('${SEG}').getAttribute('aria-busy')`)) === 'true' || (await ev(`document.querySelector('${SEG} [data-act="mode-complete"]').getAttribute('aria-pressed')`)) === 'true')
  await sleep(2200)
  const out = await ev(`window.__kbOut || []`)
  check('the shell is told once, in its own word for Complete: set-mode « advanced »', Array.isArray(out) && out.filter((m) => m.kybernos === 'set-mode').length === 1 && out.find((m) => m.kybernos === 'set-mode').mode === 'advanced', out)
  const st = await stored()
  check('the account\'s store holds the choice (read through the host\'s own route)', !!st && st.ok === true && st.pref === 'complete' && st.at > 0, st)
  await waitReload('before-complete') // the stub shell does not rebuild its WebView: the page reloads itself after 6 s
  s = await state()
  kb('after the reload: Complete, by CHOICE, although the shell\'s user agent still says Simple; the HOST class stays (three axes)', s, { simple: false, mode: 'complete', pref: 'complete', source: 'choice', kaby: true })
  check('the navigation preset is off with it (the person\'s own arrangement)', s !== null && s.surfaces !== 'on', s)
  await ev(SHELL_STATE)
  await openDrawer()
  check('the segment follows: Complete is pressed', (await ev(`document.querySelector('${SEG} [data-act="mode-complete"]').getAttribute('aria-pressed')`)) === 'true')
  await shot('A2-complete')
  await markPage('before-auto')
  await ev('window.__kbOut = []')
  await click(SEG + ' [data-act="mode-auto"]')
  await sleep(2200)
  const out2 = await ev(`window.__kbOut || []`)
  check('back to Auto: the shell is told Simple (what Auto means in the app)', Array.isArray(out2) && out2.some((m) => m.kybernos === 'set-mode' && m.mode === 'simple'), out2)
  await waitReload('before-auto')
  s = await state()
  kb('Auto again: Simple from the shell', s, { simple: true, mode: 'simple', pref: 'auto', source: 'shell' })

  section('B. A touch phone in a browser (no KybernosHost): Auto = Simple from touch; no segment; the account menu\'s Display row; a choice is kept')
  check('the page loads', (await setup({ ua: CHROME_MOBILE })) !== null)
  s = await state()
  kb('Auto on a touch device is Simple, from touch, and it is not the phone shell (no kb-kaby)', s, { simple: true, mode: 'simple', pref: 'auto', source: 'touch', kaby: false })
  await openDrawer()
  check('the segment is the app\'s: a browser has none', (await exists(SEG)) === false)
  await openAccountMenu()
  const menu = await ev(`[...document.querySelectorAll('[data-kb^="menu-"]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getAttribute('data-kb'))`)
  check('the account menu has the Display row next to Appearance', Array.isArray(menu) && menu.indexOf('menu-display') >= 0 && menu.indexOf('menu-appearance') >= 0, menu)
  const tail = await ev(`(() => { const e = document.querySelector('[data-kb="menu-display"]'); return e ? { text: e.textContent, h: e.getBoundingClientRect().height } : null })()`)
  check('its tail says the choice (Auto) and it is a thumb high', !!tail && /Display/.test(tail.text) && /Auto/.test(tail.text) && tail.h >= 44, tail)
  await shot('B1-account-menu')
  await click('[data-kb="menu-display"]')
  await sleep(600)
  check('a tap closes the menu and opens the sheet « Display »', (await visible(SHEET)) === true && (await exists('[data-kb="menu-display"]')) === false)
  const rd = await radios()
  check('three radios, Auto checked, Auto says what it means now', Array.isArray(rd) && rd.map((r) => r[0]).join() === 'mode-auto,mode-simple,mode-complete' && rd[0][1] === 'true' && (await text('[data-kb="mode-now"]')) !== null && /Simple/.test(await text('[data-kb="mode-now"]')), rd)
  const sheetBox = await ev(`(() => { const p = document.querySelector('${SHEET} [role="dialog"]'); const b = p.getBoundingClientRect(); return { left: b.left, right: b.right, bottom: b.bottom, w: b.width, vh: innerHeight, role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), focus: document.activeElement && document.activeElement.getAttribute('role') } })()`)
  check('on a phone it is a bottom sheet: the full width up to 480 px, resting on the bottom edge; focus is on the checked radio', !!sheetBox && sheetBox.w >= 380 && sheetBox.w <= 406 && Math.abs(sheetBox.bottom - sheetBox.vh) < 2 && sheetBox.role === 'dialog' && sheetBox.modal === 'true' && sheetBox.focus === 'radio', sheetBox)
  check('every choice is a thumb high (64 px)', (await ev(`[...document.querySelectorAll('${SHEET} [role="radio"]')].every((b) => b.getBoundingClientRect().height >= 60)`)) === true)
  check('a link to the Theme page is there', (await visible(SHEET + ' [data-act="mode-theme"]')) === true)
  await shot('B2-sheet')
  await key('Escape', 'Escape', 27)
  check('Escape closes the sheet', (await exists(SHEET)) === false)
  await openAccountMenu(); await click('[data-kb="menu-display"]'); await sleep(500)
  await markPage('before-b')
  await click(SHEET + ' [data-act="mode-complete"]')
  await sleep(2200)
  check('the choice is in the account\'s store while the page reloads (no shell here)', (await stored() || {}).pref === 'complete')
  await waitReload('before-b')
  s = await state()
  kb('Complete by choice on the same touch phone: no kb-simple, the preset off', s, { simple: false, mode: 'complete', pref: 'complete', source: 'choice', kaby: false })
  check('the navigation preset is off', s !== null && s.surfaces !== 'on', s)

  section('C. A computer: Auto = Complete; the sheet is a centred dialog; Simple brings the NAVIGATION preset, not the phone\'s layout; width is never read')
  check('the page loads', (await setup({ ua: DESKTOP_UA, touch: false, mobile: false })) !== null)
  s = await state()
  kb('Auto on a computer is Complete, by default', s, { simple: false, mode: 'complete', pref: 'auto', source: 'default', kaby: false, touch: false })
  check('no navigation preset: the sidebar and the account card are the full app\'s', s !== null && s.surfaces !== 'on' && (await exists('.kbmob-dock')) === false, s)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 406, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(1200)
  s = await state()
  kb('a narrow window with a mouse is still Complete, and resizing never re-resolves (the web is not a mobile preset)', s, { simple: false, mode: 'complete', source: 'default' })
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(800)
  await ev(`window.__KB_MODE__.openSheet()`)
  await sleep(500)
  const dbox = await ev(`(() => { const p = document.querySelector('${SHEET} [role="dialog"]'); if (!p) return null; const b = p.getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, vw: innerWidth, vh: innerHeight } })()`)
  check('the seam opens the sheet; on a computer it is a 420 px dialog in the middle of the window', !!dbox && Math.abs(dbox.cx - dbox.vw / 2) < 2 && Math.abs(dbox.cy - dbox.vh / 2) < dbox.vh * 0.2 && dbox.w >= 400 && dbox.w <= 421, dbox)
  await shot('C1-sheet-desktop')
  await markPage('before-c')
  await click(SHEET + ' [data-act="mode-simple"]')
  await sleep(2200)
  await waitReload('before-c')
  s = await state()
  kb('Simple by choice on a computer: Simple, no phone host class', s, { simple: true, mode: 'simple', pref: 'simple', source: 'choice', kaby: false, touch: false })
  check('the navigation preset follows the mode: the filter is on and the main menu lists the preset\'s rows', (await waitFor(page, `document.documentElement.getAttribute('data-kb-surfaces') === 'on'`, 20000)) !== null && JSON.stringify(await ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getAttribute('data-kb-row'))`)) === '["tasks","connectors"]')
  check('...while the phone\'s layout is not: no dock, no burger drawn, the full-width window keeps the computer\'s sidebar', (await exists('.kbmob-dock')) === false && (await visible(BURGER)) === false && (await visible('[data-slot="sidebar"]')) !== undefined && (await state()).width === 1400)
  await shot('C2-simple-desktop')

  section('D. The palette (⌘K): « Display… » and one command per choice')
  await key('k', 'KeyK', 75, 2)
  check('⌘K / Ctrl+K opens the search dialog', (await waitFor(page, `!!document.querySelector('[data-kb="search-dialog"]')`, 5000)) !== null)
  await ev(`(() => { const i = document.querySelector('[data-kb="search-input"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'display'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(900)
  const cmds = await ev(`[...document.querySelectorAll('[data-kb="search-dialog"] [data-act="result"]')].map((b) => b.textContent.slice(0, 40))`)
  check('four commands are found by « display »: the sheet and one per choice', Array.isArray(cmds) && cmds.length >= 4 && cmds.filter((t) => /Display/.test(t)).length >= 4, cmds)
  check('they sit in a group of their own, first', /Commands/.test((await ev(`(document.querySelector('[data-kb="search-dialog"] .kbsr-grp') || {}).textContent || ''`)) || ''))
  await shot('D1-palette')
  await key('Enter', 'Enter', 13)
  check('Enter runs the first one (Display…): the dialog closes and the sheet opens, focus in it', (await waitFor(page, `!!document.querySelector('${SHEET}')`, 4000)) !== null && (await exists('[data-kb="search-dialog"]')) === false && (await ev(`(document.activeElement && document.activeElement.getAttribute('role')) || ''`)) === 'radio')
  await key('Escape', 'Escape', 27)
  await key('k', 'KeyK', 75, 2)
  await waitFor(page, `!!document.querySelector('[data-kb="search-dialog"]')`, 5000)
  await ev(`(() => { const i = document.querySelector('[data-kb="search-input"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'display auto'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(900)
  await markPage('before-d')
  await key('Enter', 'Enter', 13)
  await sleep(2500)
  check('« Display: Auto » sets Auto in the store', (await stored() || {}).pref === 'auto')
  await waitReload('before-d')
  s = await state()
  kb('and the page comes back Complete (a computer under Auto)', s, { simple: false, mode: 'complete', pref: 'auto', source: 'default' })

  section('E. French, light and dark')
  check('the page loads, in French', (await setup({ ua: CHROME_MOBILE, lang: 'fr' })) !== null)
  await openAccountMenu()
  const rowFr = await text('[data-kb="menu-display"]')
  check('the account row is « Affichage », its tail « Auto »', typeof rowFr === 'string' && /Affichage/.test(rowFr) && /Auto/.test(rowFr), rowFr)
  await click('[data-kb="menu-display"]'); await sleep(600)
  const frs = await radios()
  check('the sheet speaks French: title, the three choices (Complet), the note', (await text('#kbmob-mode-title')) === 'Affichage' && Array.isArray(frs) && /Complet/.test(frs[2][2]) && /rien perdre/.test((await text(SHEET)) || ''), frs)
  await shot('E1-sheet-fr')
  await key('Escape', 'Escape', 27)
  for (const scheme of ['dark', 'light']) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    await sleep(400)
    await ev('window.__KB_MODE__.openSheet()')
    await sleep(500)
    const lum = await ev(`(() => { const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return m.length >= 3 ? m : [0, 0, 0] }; const L = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }; const p = document.querySelector('${SHEET} [role="dialog"]'); const cs = getComputedStyle(p); const bg = L(cs.backgroundColor), fg = L(cs.color); const hi = Math.max(bg, fg), lo = Math.min(bg, fg); const opt = document.querySelector('${SHEET} [role="radio"]'); const ob = L(getComputedStyle(opt).backgroundColor), of = L(getComputedStyle(opt).color); return { ratio: (hi + 0.05) / (lo + 0.05), optRatio: (Math.max(ob, of) + 0.05) / (Math.min(ob, of) + 0.05), bg: cs.backgroundColor, fg: cs.color } })()`)
    check(scheme + ': the sheet\'s text is legible (contrast 4.5 or more) on its background and on its option cards', !!lum && lum.ratio >= 4.5 && lum.optRatio >= 4.5, lum)
    await shot('E2-sheet-' + scheme)
    await key('Escape', 'Escape', 27)
  }

  section('F. Housekeeping')
  check('no uncaught exception in the page during the whole run', errors.length === 0, errors.slice(0, 3))
} catch (e) {
  failures.push('the run itself: ' + String(e && e.message ? e.message : e))
  console.log('  ✗ the run stopped: ' + String(e && e.stack ? e.stack : e).slice(0, 600))
} finally {
  // leave the sandbox account on Auto and the page's own copy clean
  try { await ev(`(async () => { try { localStorage.removeItem(${JSON.stringify(MODE_KEY)}) } catch (e) {} try { await fetch('/kybernos-mobile/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pref: 'auto', at: Date.now() }) }) } catch (e) {} return true })()`) } catch (e) { /* closing */ }
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + failures.length + ' ✗')
process.exit(failures.length === 0 ? 0 : 1)
