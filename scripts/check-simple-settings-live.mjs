#!/usr/bin/env node
// Simple mode (Kaby mode, the phone) is the FULL app's own screens filtered by the locked « Simple » preset, at the width of a phone (390 px). No screen of its own.
//
//   source scripts/sandbox/env.sh && node scripts/check-simple-settings-live.mjs [--shots <dir>]
//
// What it plays, on the sandbox (never :3080), with the phone's user agent (`KabyMode/1` and `KybernosCaps/…`) and a stub of the shell's `ReactNativeWebView`:
//   A  the real drawer opens with the burger and lists the preset's three rows (Kaby, Reminders = the real Automations page, Apps = the real Connectors page); the avatar opens the REAL
//      account menu, filtered; Settings is the real dialog with the five pages of the preset (no group header without a page, the search offers nothing of a hidden page); About carries the
//      phone's own sections (what the shell does goes out as messages; « The Kybernos app » was a page until item 28) and « Need more? » is the way out; Back and the close button work; no Kaby bar, menu or sheet.
//   B  the fallback: a preset that cannot be read (a seam of another version, defined before the Theme plugin) leaves the drawer, the account menu and Settings UNFILTERED.
//   C  the full app on the same phone (no `KabyMode` token): the same drawer shows every row; a Settings page a person hid in the Menu panel stays hidden in the flat list.
//   D  the full app on a desktop browser: no phone layer at all, the whole sidebar.
//   E  step 6, the composer and the phone's own page: the web's own model picker is drawn (Kaby's chip is gone), the web's « + » list is whole and its sheet rises above the soft keyboard (a
//      visual viewport of 513 px), the page's « On this phone » pill is drawn on a cloud connection only, the « Clé du modèle » card is not drawn in Simple (and still is in the full app).
//   F  step 6, teams on the phone: the preset draws no team path (rows, switcher, create, join: the phone's engine has no DSH to start, `dsh_not_found`), and a team tapped anyway (the filter
//      switched off) is told by a toast that outlives the account sheet.
//   G  step 6 part 2: the touch layer is on (`data-kb-touch`), DSH speaks French from top to bottom when Kybernos is French (its own `fr`, once per start) and stays English when the person
//      picked English on the Language page, « this computer » reads « this phone » on the Settings pages, General is hidden only in the phone layout (it stays at a tablet width), the Kaby page's
//      tabs are a column, and the app's own page lists what it holds (printed, for the report).
//   H  step 6 part 2, Back: an in-page screen is the lowest layer (`layers top: "page"`): the shell's `close-layer` (the system Back) closes the drawer first, then leaves the page for the chat with the
//      drawer over it, and inside Settings a page goes back to the list before the dialog closes.
//   I  step 6 part 3 (S3), the phone with NO account: the Reminders and Apps rows the preset lists (`options.padlock`) carry a padlock and a tap opens a one-sentence sheet (Sign in / Not now) instead of
//      the page; « Sign in » (the sheet, the account menu's row, the model picker's line) calls the shell's door `kybernos://signin` ONLY when the user agent lists `signin`, else it keeps the device-code
//      card; Sign up and Plans are not in the signed-out account menu; the line under the picker says « Sign in for more models » when the door is listed; a connected account sees none of it (no padlock,
//      no attribute, the real pages). French pairs. The account is a stub of the footer's own status route (and of the pairing start: nothing leaves the sandbox).
// Exit 0: every check passed, 1: a check failed, 3: not run (no GUI, or not the sandbox).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST)) {
  console.error('○ not run: this check opens Settings and writes a menu arrangement in the page storage. Run it on the sandbox: source scripts/sandbox/env.sh && node scripts/check-simple-settings-live.mjs')
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
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { console.log('  (no screenshot: ' + e.message + ')') }
}
const rect = (sel, nth = 0, block = 'center') => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return null; e.scrollIntoView({ block: ${JSON.stringify(block)} }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } })()`)
/** A real mouse click at the centre of the nth element that matches (the scroll that brought it into view may be smooth: read where it came to rest). */
const click = async (sel, nth = 0, block = 'center') => {
  let r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await sleep(320)
  r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(300)
  return true
}
const clickAt = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(300)
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' })()`)
const DIALOG = '[data-shortcut-modal="settings"]'
const BURGER = '[data-kb="mobile-menu"]'
const COMPOSER = '[data-composer-input]'
const AVATAR = '[data-kb="mobile-avatar"]'
const typeSearch = async (q) => {
  await ev(`(() => { const i = document.querySelector('.kbs-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(1100)
}
/** The Settings pages that are drawn (by the hook of their cell, never by a label). */
const shownPages = () => ev(`[...document.querySelectorAll('${DIALOG} [class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getAttribute('data-kb-t'))`)
const out = () => ev(`(window.__kbOut || [])`)
/** The drawer is the engine's own sidebar: it is open when the root's first child has no `data-sidebar-collapsed`. */
const drawerOpen = () => ev(`(() => { const r = document.querySelector('[data-slot="root"] > div'); return r ? !r.hasAttribute('data-sidebar-collapsed') : null })()`)
const openDrawer = async () => { if ((await drawerOpen()) !== true) { await click(BURGER); await sleep(500) } return (await drawerOpen()) === true }
/** The main rows drawn in the drawer, by the hook the Kybernos plugin gives each (`data-kb-row`), with the name each carries. */
const drawerRows = () => ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' }).map((e) => [e.getAttribute('data-kb-row'), (e.getAttribute('aria-label') || '').trim()])`)
/** The entries of the account menu that are drawn. */
const menuItems = () => ev(`[...document.querySelectorAll('[data-kb^="menu-"]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' }).map((e) => e.getAttribute('data-kb'))`)

// The six pages of the locked Simple preset (`locked-simple` of the Theme plugin), by the hook of their cell. General, Usage and Connectors are hidden (step 6 part 2): a person's own
// arrangement can never hide General, only this preset can.
const ALLOWED = ['theme', 'language', 'memory & lessons', 'about', 'kaby']
const KABY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios) KabyMode/1 KybernosCaps/account,plans,referral,where,signout'
const FULL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios) KybernosCaps/account,plans,referral,where,signout,mode'
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(JSON.parse(s)) } catch (e) { window.__kbOut.push({ raw: String(s) }) } } };'
// A seam of another version, defined before the Theme plugin runs (it only defines its own when none is there): the preset cannot be read.
const BROKEN_SEAM_JS = "Object.defineProperty(window, '__KB_THEME_LOCKED__', { value: Object.freeze({ v: 2 }), writable: false, configurable: false });"
const SHELL_STATE = "window.__KB_APP__ && window.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, mode: true, screens: ['account', 'plan', 'help', 'where'] }, notifications: 'undetermined', connection: 'cloud' })"
// The footer's view of the account, answered in the page (nothing leaves the sandbox): the status route, and the pairing start that « Sign in » asks for when the shell has no door of its own. `__kbPairStarts`
// counts the starts, `__kbNav` is filled by the check from `Page.frameRequestedNavigation` (the shell's links).
const CLOUD_USER = { user: { email: 'dev@example.test', name: 'Dev Person', plan: 'free' }, workspaces: [{ id: 'W0', name: 'Personal', personal: true, role: 'owner' }], active_workspace_id: 'W0', space_plan: { key: 'free', label: 'Free', workspace_id: 'W0' }, web_url: 'https://dev.kybernos.app', device_label: 'This phone' }
const PAIRING_STUB = { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1', expires_at: '2099-01-01T00:00:00Z' } }
const cloudStub = (connected) => `(function () { var real = window.fetch.bind(window); window.__kbPairStarts = 0; var json = function (b) { return Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })) }; window.fetch = function (u, o) { var s = typeof u === 'string' ? u : ((u && u.url) || ''); if (s.indexOf('/kybernos-cloud/status') >= 0) return json(${JSON.stringify(connected ? { ok: true, connected: true, state: CLOUD_USER } : { ok: true, connected: false, status: 'none' })}); if (s.indexOf('/kybernos-cloud/start') >= 0) { window.__kbPairStarts += 1; return json(${JSON.stringify(PAIRING_STUB)}) } return real(u, o) } })();`
const MENU = 'kybernos.theme.menu.v1'
const STORE = 'kybernos.theme.v1'
const LIB = 'kybernos.theme.presets.v1'

const errors = []
let scriptId = null
const phone = async (ua, { shell = true, pre = '', width = 390 } = {}) => {
  if (width === 390) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  else await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: width === 390 ? 'iPhone' : 'MacIntel' })
  if (scriptId !== null) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => {}); scriptId = null }
  const source = (shell ? SHELL_JS : '') + pre
  if (source !== '') { const r = await page.send('Page.addScriptToEvaluateOnNewDocument', { source }); scriptId = r.identifier || (r.result && r.result.identifier) || null }
  await ev(`['${STORE}', '${LIB}', '${MENU}'].forEach((k) => localStorage.removeItem(k))`)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(4000)
}
let filteredMenu = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => { errors.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 300)) })

  section('A. Simple mode: the real drawer, the real account menu and the real Settings, filtered by the locked preset (a connected account: with none, Reminders and Apps are padlocked, I checks that)')
  await phone(KABY_UA, { pre: cloudStub(true) })
  const inKaby = await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
  check('the page is in Kaby mode and the phone\'s own burger is drawn', inKaby !== null)
  await ev(SHELL_STATE)
  const old = await ev(`['kaby-bar', 'kaby-menu', 'kaby-settings', 'kaby-chats', 'kaby-reminders', 'kaby-apps'].filter((k) => !!document.querySelector('[data-kb="' + k + '"]'))`)
  check('Simple draws no bar, no menu of its own, no Kaby settings sheet and no pages of its own', Array.isArray(old) && old.length === 0, old)
  const ready = await waitFor(page, `document.documentElement.getAttribute('data-kb-surfaces') === 'on' && typeof window.__kbOpenDshSettings === 'function' && !!window.__KB_THEME_LOCKED__`, 20000)
  check('the Theme plugin has the filter on (`data-kb-surfaces`) and the locked preset is published', ready !== null)
  check('a chat is on the screen: the composer is drawn', (await visible(COMPOSER)) === true)
  check('the engine\'s own hiding stays in the chat (the right bar is not drawn); the model picker is drawn (E checks it)', (await visible('[data-kb="model-seat"]')) === true && (await visible('[data-rightbar-col]')) === false)
  check('before the burger: no Settings dialog on the page', (await exists(DIALOG)) === false)
  await shot('01-chat')

  // the drawer
  check('the burger opens the engine\'s own sidebar as the phone\'s drawer', (await openDrawer()) === true)
  await sleep(500)
  const rows = await drawerRows()
  const ids = Array.isArray(rows) ? rows.map((r) => r[0]).sort().join() : null
  check('the drawer lists the preset\'s three rows and no other main row: Kaby, Reminders (tasks), Apps (connectors)', ids === 'connectors,kyber,tasks', rows)
  check('...under the names the preset gives them (Reminders, Apps); Kaby keeps its own', Array.isArray(rows) && /Reminders/.test((rows.find((r) => r[0] === 'tasks') || [])[1] || '') && /Apps/.test((rows.find((r) => r[0] === 'connectors') || [])[1] || ''), rows)
  const order = await ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getAttribute('data-kb-row')).join()`)
  check('...in the preset\'s order', order === 'kyber,tasks,connectors', order)
  check('every row of the drawer is a thumb\'s height (44 px or more)', (await ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).every((e) => e.getBoundingClientRect().height >= 44)`)) === true)
  check('no sideways scroll with the drawer open', (await ev(`document.documentElement.scrollWidth <= 392`)) === true)
  await shot('02-drawer')

  // Reminders = the real Automations page, Apps = the real Connectors page
  await click('[data-kb-row="tasks"]')
  await sleep(1500)
  const rem = await ev(`({ view: document.documentElement.getAttribute('data-kbmob-view'), text: document.body.innerText.slice(0, 4000), drawer: !!document.querySelector('[data-slot="root"] > div:not([data-sidebar-collapsed])') })`)
  check('« Reminders » opens the real Automations page (the drawer closes behind it)', !!rem && /Automations?/i.test(rem.text) && rem.drawer === false, rem && { view: rem.view, drawer: rem.drawer, text: rem.text.slice(0, 160) })
  await shot('03-reminders')
  check('the burger brings the drawer back over the page', (await openDrawer()) === true)
  await click('[data-kb-row="connectors"]')
  await sleep(1500)
  const apps = await ev(`document.body.innerText.slice(0, 4000)`)
  check('« Apps » opens the real Connectors page', typeof apps === 'string' && /Connectors?/i.test(apps), typeof apps === 'string' ? apps.slice(0, 160) : apps)
  await shot('04-apps')
  check('the burger brings the drawer back again', (await openDrawer()) === true)
  await click('[data-kb-row="kyber"]')
  await sleep(1200)
  check('« Kaby » brings the conversation back (the drawer closes, the composer is there)', (await visible(COMPOSER)) === true && (await drawerOpen()) === false)

  // the account door: the avatar of the phone's dock opens the web's own account menu, filtered
  check('the drawer\'s dock has its avatar (the account door of the mockup): a tap on the burger shows it', (await openDrawer()) === true && (await visible(AVATAR)) === true)
  await click(AVATAR)
  await sleep(700)
  filteredMenu = await menuItems()
  const has = (id) => Array.isArray(filteredMenu) && filteredMenu.indexOf(id) >= 0
  check('the avatar opens the real account menu: Settings, Help, Send feedback and Appearance are there', ['menu-settings', 'menu-help', 'menu-feedback', 'menu-appearance'].every(has), filteredMenu)
  check('...and what the preset hides is not: Upgrade, Phone and channels, Team settings, Website, Create or Join a team', ['menu-upgrade', 'menu-phone', 'menu-team-settings', 'menu-website', 'menu-create-team', 'menu-join-team'].every((id) => !has(id)), filteredMenu)
  await shot('05-account-menu')

  // Settings (the real dialog), from the account menu
  await click('[data-kb="menu-settings"]')
  const opened = await waitFor(page, `!!document.querySelector('${DIALOG}')`, 8000)
  check('« Settings » of the account menu opens DSH\'s own Settings dialog', opened !== null)
  await sleep(1200)
  const box = await ev(`(() => { const d = document.querySelector('${DIALOG}'); if (!d) return null; const b = d.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, display: getComputedStyle(d).display } })()`)
  check('it is drawn, the whole phone screen wide', !!box && box.display !== 'none' && box.w >= 388 && box.h >= 780, box)
  await shot('06-settings-list')
  const pages = await shownPages()
  check('the list shows the five pages of the preset and nothing else (« The Kybernos app » is no page any more: item 28)', Array.isArray(pages) && pages.length === ALLOWED.length && ALLOWED.every((p) => pages.indexOf(p) >= 0), pages)
  const cells = await ev(`document.querySelectorAll('${DIALOG} [class*="navList"] [data-kb-t]').length`)
  check('(the other pages are there but hidden: the engine has ' + cells + ' cells)', typeof cells === 'number' && cells > ALLOWED.length)
  const heads = await ev(`(() => { const list = document.querySelector('${DIALOG} [class*="navList"]'); const vis = (e) => getComputedStyle(e).display !== 'none'; const cellG = new Set([...list.querySelectorAll('[data-kb-t][data-kb-g]')].filter(vis).map((c) => c.getAttribute('data-kb-g'))); const heads = [...list.querySelectorAll('[data-kb="settings-group"]')].filter(vis).map((h) => h.getAttribute('data-kb-g')); return { heads, orphans: heads.filter((g) => g !== 'general' && !cellG.has(g)) } })()`)
  check('no group header is left without a page under it', !!heads && Array.isArray(heads.orphans) && heads.orphans.length === 0 && heads.heads.indexOf('voice') < 0, heads)
  const kb = await ev(`(() => { const d = document.querySelector('${DIALOG}'); const e = [...d.querySelectorAll('[data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none'); return { overflowX: document.documentElement.scrollWidth > 392, small: e.filter((c) => c.getBoundingClientRect().height < 44).map((c) => c.getAttribute('data-kb-t')) } })()`)
  check('every row is a thumb\'s height (44 px or more) and the page does not scroll sideways', !!kb && kb.small.length === 0 && kb.overflowX === false, kb)
  const backBtn = await ev(`(() => { const e = document.querySelector('${DIALOG} .kbsb'); if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e), s = e.querySelector('svg').getBoundingClientRect(); return { h: Math.round(b.height), fs: parseFloat(cs.fontSize), arrow: Math.round(s.width), right: Math.round(b.right) } })()`)
  check('« Back to workspace » is as big as a row\'s title (18 px text, a 24 px arrow) with a tap zone 48 px high, inside the screen', !!backBtn && backBtn.h >= 48 && backBtn.fs >= 18 && backBtn.arrow >= 24 && backBtn.right <= 390, backBtn)

  // the search
  await typeSearch('model')
  const found = await ev(`[...document.querySelectorAll('.kbs-rr .kbs-rp')].map((e) => e.textContent.trim())`)
  const labels = await ev(`[...document.querySelectorAll('${DIALOG} [class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.textContent.trim())`)
  await shot('07-search-model')
  check('a search for « model » finds results, and every one is in a page of the preset', Array.isArray(found) && found.length > 0 && Array.isArray(labels) && found.every((p) => labels.some((l) => p.indexOf(l) === 0)), { found, labels })
  await typeSearch('skills')
  const found2 = await ev(`[...document.querySelectorAll('.kbs-rr .kbs-rp')].map((e) => e.textContent.trim())`)
  check('a search for « skills » (a page the preset hides) offers none of its pages', Array.isArray(found2) && Array.isArray(labels) && found2.every((p) => labels.some((l) => p.indexOf(l) === 0)), found2)
  await typeSearch('usage')
  const found3 = await ev(`[...document.querySelectorAll('.kbs-rr .kbs-rp')].map((e) => e.textContent.trim())`)
  check('a search for « usage » (a page the preset now hides) offers none of its pages', Array.isArray(found3) && Array.isArray(labels) && found3.every((p) => labels.some((l) => p.indexOf(l) === 0)), found3)
  await typeSearch('theme')
  const found4 = await ev(`[...document.querySelectorAll('.kbs-rr .kbs-rp')].map((e) => e.textContent.trim())`)
  check('a search for « theme » (a page the preset keeps) finds it', Array.isArray(found4) && found4.some((p) => /^Theme/.test(p)), found4)
  await typeSearch('')

  // the phone's own sections + the app's own parts: inside About since item 28 (« The Kybernos app » is no longer a page)
  check('« The Kybernos app » is not in the list any more', (await exists(`${DIALOG} [data-kb-t="phone and channels"]`)) === false)
  await click(`${DIALOG} [data-kb-t="about"]`)
  await sleep(1500)
  const onPage = await ev(`(() => { const d = document.querySelector('${DIALOG}'); return d ? d.hasAttribute('data-kbmob-page') : null })()`)
  check('a tap on About opens its page (one page at a time, the list is behind), with the app\'s parts inside it', onPage === true && (await exists(`${DIALOG} [data-kb="about-extras"] [data-kb="mobile-app-about"]`)) === true)
  const lead = {}
  for (const k of ['kaby-notifications', 'kaby-computer', 'kaby-account', 'kaby-help', 'kaby-mode-switch', 'mobile-app-log']) lead[k] = await visible(`${DIALOG} [data-kb="${k}"]`)
  // step 6 part 3: the preset's `appPage` option: no engine-log card in Simple, and the computer card only when a computer is linked (the sandbox's engine is its own: nothing is linked, so no card)
  check('it starts with Notifications, Account and plan, Help and report and « Need more? »; the engine log is not drawn and the computer card is not drawn while no computer is linked (the preset\'s `appPage`); and no card for a model key of the person\'s own (the models come from Kybernos Models)', lead['kaby-notifications'] === true && lead['kaby-account'] === true && lead['kaby-help'] === true && lead['kaby-mode-switch'] === true && lead['mobile-app-log'] === false && lead['kaby-computer'] === false && (await exists(`${DIALOG} [data-kb="mobile-app-key"]`)) === false, lead)
  check('the card that says « Switch to Simple » (the full app\'s) is not drawn in Simple', (await exists(`${DIALOG} [data-kb="mobile-mode-switch"]`)) === false)
  const refer = await visible(`${DIALOG} [data-act="kaby-open-referral"]`)
  check('Account and plan carries Referral (the user agent lists `referral`), My account, My plan and Where Kybernos runs', refer === true && (await visible(`${DIALOG} [data-act="kaby-open-account"]`)) === true && (await visible(`${DIALOG} [data-act="kaby-open-plan"]`)) === true && (await visible(`${DIALOG} [data-act="kaby-open-where"]`)) === true)
  await shot('08-about-with-the-app-parts')
  await click(`${DIALOG} [data-act="kaby-open-account"]`)
  const sent = await out()
  check('« My account » asks the shell for the native screen (`open-screen`, `account`)', Array.isArray(sent) && sent.some((m) => m.kybernos === 'open-screen' && m.screen === 'account'), sent)
  await click(`${DIALOG} [data-act="kaby-mode-advanced"]`)
  const sent2 = await out()
  check('« Switch to Advanced » (Need more?) asks the shell for Advanced mode (`set-mode`): the way out of Simple is two taps from the chat (avatar, Settings)', Array.isArray(sent2) && sent2.some((m) => m.kybernos === 'set-mode' && m.mode === 'advanced'), sent2)
  check('the shell was told what it needs: the handshake and the old app-entry are in the messages', Array.isArray(sent2) && ['kaby-ready', 'app-entry'].every((k) => sent2.some((m) => m.kybernos === k)), Array.isArray(sent2) ? sent2.map((m) => m.kybernos) : sent2)

  // back to the list (the "back" bar of the phone page), then a page of the engine
  const back = await ev(`(() => { const d = document.querySelector('${DIALOG}'); const e = d && d.querySelector('[data-kbmob-back]'); const t = e || (d && d.querySelector(':scope > nav + div:last-child')); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.x + 40, y: b.y + 28, has: !!e } })()`)
  if (back !== null && back.err === undefined) await clickAt(back.x, back.y)
  await sleep(700)
  const listAgain = await ev(`(() => { const d = document.querySelector('${DIALOG}'); return d ? !d.hasAttribute('data-kbmob-page') : null })()`)
  check('the back bar of the page brings the list back', listAgain === true, back)
  await click(`${DIALOG} [data-kb-t="memory & lessons"]`)
  await sleep(900)
  check('a page of the engine opens in the same phone layout (Memory & Lessons)', (await ev(`document.querySelector('${DIALOG}').hasAttribute('data-kbmob-page')`)) === true)
  check('and nothing scrolls sideways', (await ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('${DIALOG}').scrollWidth <= 392`)) === true)
  await shot('09-memory-page')
  const back2 = await ev(`(() => { const d = document.querySelector('${DIALOG}'); const t = d.querySelector('[data-kbmob-back]') || d.querySelector(':scope > nav + div:last-child'); const b = t.getBoundingClientRect(); return { x: b.x + 40, y: b.y + 28 } })()`)
  await clickAt(back2.x, back2.y)
  await sleep(600)
  // close the dialog: « Back to workspace »
  await click(`${DIALOG} .kbsb`)
  await sleep(900)
  check('« Back to workspace » closes the dialog onto the chat, and the burger is there again', (await exists(DIALOG)) === false && (await visible(BURGER)) === true)
  await openDrawer()
  await click(AVATAR)
  await sleep(600)
  await click('[data-kb="menu-settings"]')
  const again = await waitFor(page, `!!document.querySelector('${DIALOG}') && document.querySelectorAll('${DIALOG} [data-kb-t]').length > 8`, 8000)
  check('the avatar opens Settings again, with the same five pages', again !== null && ((await shownPages()) || []).length === ALLOWED.length)
  await click(`${DIALOG} .kbsb`)
  await sleep(700)

  section('B. The fallback: a preset that cannot be read leaves the drawer, the account menu and Settings unfiltered')
  await phone(KABY_UA, { pre: BROKEN_SEAM_JS + cloudStub(true) })
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
  await ev(SHELL_STATE)
  await sleep(1500)
  check('the seam is the broken one (version 2) and the filter is not on', (await ev(`window.__KB_THEME_LOCKED__ && window.__KB_THEME_LOCKED__.v`)) === 2 && (await ev(`document.documentElement.getAttribute('data-kb-surfaces')`)) !== 'on')
  await openDrawer()
  await sleep(500)
  const fbRows = await drawerRows()
  check('the drawer shows every main row of the full app (Kaby, Reminders and Apps are there, and more)', Array.isArray(fbRows) && fbRows.length > 3 && ['kyber', 'tasks', 'connectors'].every((id) => fbRows.some((r) => r[0] === id)), fbRows)
  await shot('10-fallback-drawer')
  await click(AVATAR)
  await sleep(700)
  const fbMenu = await menuItems()
  check('the account menu shows at least as many entries as the filtered one, and Settings is one of them', Array.isArray(fbMenu) && Array.isArray(filteredMenu) && fbMenu.length >= filteredMenu.length && fbMenu.indexOf('menu-settings') >= 0, { fbMenu, filteredMenu })
  await shot('11-fallback-account-menu')
  await click('[data-kb="menu-settings"]')
  const fbOpen = await waitFor(page, `!!document.querySelector('${DIALOG}') && document.querySelectorAll('${DIALOG} [data-kb-t]').length > 8`, 10000)
  check('Settings opens, and shows far more than six pages', fbOpen !== null && ((await shownPages()) || []).length > 20, await shownPages())
  await shot('12-fallback-settings')
  check('the chat-level hiding is still Kaby mode\'s own (no right bar in the fallback either)', (await visible('[data-rightbar-col]')) === false)
  await click(`${DIALOG} .kbsb`)
  await sleep(600)

  section('C. The full app on the same phone: nothing of Kaby mode, a Settings page hidden in the Menu panel stays hidden in the flat list')
  await phone(FULL_UA)
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
  await ev(SHELL_STATE)
  check('no Kaby class, no Kaby bar', (await ev(`document.documentElement.classList.contains('kb-kaby')`)) === false && (await exists('[data-kb="kaby-bar"]')) === false)
  await openDrawer()
  await sleep(500)
  const fullRows = await drawerRows()
  check('the same drawer shows every main row, as before', Array.isArray(fullRows) && fullRows.length > 3, fullRows)
  await shot('13-full-app-drawer')
  await ev(`localStorage.setItem('${MENU}', JSON.stringify({ v: 1, updatedAt: Date.now(), menu: { entries: [], unlisted: 'show', locked: false, surfaces: { settings: { entries: [{ id: 'about', shown: false, order: 0 }, { id: 'servers', shown: false, order: 1 }], unlisted: 'show' } } } }))`)
  await ev(`window.dispatchEvent(new Event('kb-menu-prefs-change'))`)
  await sleep(800)
  await ev(`window.__kbOpenDshSettings && window.__kbOpenDshSettings()`)
  const fullOpen = await waitFor(page, `!!document.querySelector('${DIALOG}') && document.querySelectorAll('${DIALOG} [data-kb-t]').length > 8`, 10000)
  check('Settings opens on the phone in the full app', fullOpen !== null)
  await sleep(800)
  const full = await shownPages()
  check('the two pages the person hid (About, Servers) are not in the phone\'s flat list, the others are', Array.isArray(full) && full.indexOf('about') < 0 && full.indexOf('servers') < 0 && full.indexOf('theme') >= 0 && full.indexOf('models') >= 0 && full.length > 20, full)
  await shot('14-full-app-list')
  await click(`${DIALOG} [data-kb-t="phone and channels"]`)
  await sleep(900)
  check('the full app on the same phone keeps the « Clé du modèle » card on « The Kybernos app » (only Simple drops it)', (await exists(`${DIALOG} [data-kb="mobile-app-key"]`)) === true)
  check('...and its engine-log card (the preset\'s `appPage` is read in Simple only)', (await exists(`${DIALOG} [data-kb="mobile-app-log"]`)) === true)

  section('D. The full app on a desktop browser: no phone layer, the whole sidebar')
  await phone(DESKTOP_UA, { shell: false, width: 1400 })
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
  const desk = await ev(`({ app: document.documentElement.classList.contains('kb-app'), kaby: document.documentElement.classList.contains('kb-kaby'), burger: (() => { const e = document.querySelector('${BURGER}'); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' })(), avatar: (() => { const e = document.querySelector('${AVATAR}'); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' })(), rows: [...document.querySelectorAll('[data-kb-row]')].filter((e) => e.getBoundingClientRect().height > 0).length, surfaces: document.documentElement.getAttribute('data-kb-surfaces') })`)
  check('no phone class, no burger or phone avatar drawn, no filter, and the sidebar lists every main row', !!desk && desk.app === false && desk.kaby === false && desk.burger === false && desk.avatar === false && desk.surfaces !== 'on' && desk.rows > 3, desk)
  await shot('15-desktop')

  section('E. Step 6: the web\'s model picker and « + » list are the phone\'s; the « + » sheet rises above the soft keyboard; no page pill on the phone\'s own connection')
  const keyEsc = async () => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) }
  await phone(KABY_UA + ' KybernosPlace/local')
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${COMPOSER}')`, 30000)
  await sleep(1500)
  check('Kaby\'s own answer chip is gone (the picker is no longer replaced by a frozen chip)', (await exists('[data-kb="kaby-chip"]')) === false)
  const seat = await ev(`(() => { const e = document.querySelector('[data-kb="model-seat"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, label: e.getAttribute('aria-label') || '' } })()`)
  check('the web\'s own model picker is drawn in the composer: a thumb high, on the screen, and it names the model in use', !!seat && seat.h >= 44 && seat.x >= 0 && seat.x + seat.w <= 390 && seat.y >= 0 && seat.y + seat.h <= 844 && /Select model|Choisir un modèle/.test(seat.label), seat)
  await shot('20-chat-picker')
  await click('[data-kb="model-seat"]')
  const menu = await waitFor(page, `!!document.querySelector('.kbmsl-menu')`, 5000)
  const mbox = await ev(`(() => { const m = document.querySelector('.kbmsl-menu'); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, search: !!m.querySelector('[data-kb="model-seat-search"]'), rows: m.querySelectorAll('[data-kbmsl-row]').length, band: !!m.querySelector('[data-kb="model-seat-band"]'), text: m.innerText.slice(0, 120) } })()`)
  check('a tap on it opens the catalogue as a sheet inside the screen, with its search box and either models or the sign-in note (the sandbox is not signed in to Kybernos Cloud)', menu !== null && !!mbox && mbox.search === true && mbox.x >= 0 && mbox.x + mbox.w <= 391 && mbox.y >= 0 && mbox.y + mbox.h <= 845 && (mbox.rows > 0 || mbox.band === true), mbox)
  await shot('21-model-menu')
  await keyEsc()
  if (await exists('.kbmsl-menu')) await clickAt(200, 120)
  await sleep(300)
  // the « + » list is the web's whole list
  const plusSel = '[data-composer-card] button[aria-haspopup="listbox"]'
  await click(plusSel)
  const listed = await waitFor(page, `!!document.querySelector('[data-slot="conversation.input.overlay"] [role="listbox"]')`, 5000)
  const sheetInfo = () => ev(`(() => { const lb = document.querySelector('[data-slot="conversation.input.overlay"] [role="listbox"]'); if (!lb) return null; let sheet = lb; while (sheet.parentElement && getComputedStyle(sheet).position !== 'fixed') sheet = sheet.parentElement; const r = sheet.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), vv: Math.round(visualViewport.height), text: sheet.innerText.replace(/\\n+/g, ' | ') } })()`)
  const sh1 = await sheetInfo()
  check('the « + » opens the web\'s list: Add > File, Feedback and the commands (nothing the preset used to hide is missing)', listed !== null && !!sh1 && /File/.test(sh1.text) && /Feedback/.test(sh1.text) && /Commands/.test(sh1.text) && /Compact/.test(sh1.text), sh1)
  await shot('22-plus-list')
  check('...and its sheet is full width and ends at the bottom of the screen', !!sh1 && sh1.w >= 388 && sh1.bottom <= 844 && sh1.top >= 0, sh1)
  // the soft keyboard of an iPhone shrinks the VISUAL viewport only: the sheet must come up with it (simulated: 513 px of 844)
  await ev(`Object.defineProperty(window.visualViewport, 'height', { value: 513, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'))`)
  await sleep(500)
  const sh2 = await sheetInfo()
  check('with the soft keyboard up (visual viewport of 513 px) the sheet is not under it: it ends at or above 513 px and does not leave the top of the screen', !!sh2 && sh2.bottom <= 514 && sh2.top >= 0, sh2)
  await shot('23-plus-list-keyboard')
  await ev(`delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize'))`)
  await keyEsc()
  // « On this phone »: the page's own pill is for a cloud connection (where several places exist), not for the phone's own page
  check('on the phone\'s own connection (`KybernosPlace/local`) there is no « On this phone » pill (the cloud connection\'s pill needs an open chat: scripts/check-kaby-mode-live.mjs plays it)', (await exists('[data-kb="mobile-where"]')) === false)

  section('F. Step 6: a team tapped on the phone says out loud that teams are not there yet (the phone\'s engine has no DSH to start)')
  const W1 = '11111111-1111-4111-8111-111111111111'
  const W2 = '22222222-2222-4222-8222-222222222222'
  const STATUS = { ok: true, connected: true, state: { user: { email: 'dev@example.test', name: 'Dev Person', plan: 'free' }, workspaces: [{ id: W1, name: 'Personal', personal: true, role: 'owner' }, { id: W2, name: 'Studio', personal: false, role: 'owner' }], active_workspace_id: W1, space_plan: { key: 'free', label: 'Free', workspace_id: W1 }, web_url: 'https://dev.kybernos.app', device_label: 'This phone' } }
  const asked = []
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-cloud/*' }] })
  page.on('Fetch.requestPaused', (p) => {
    const path = new URL(p.request.url).pathname
    let body = null
    if (path === '/kybernos-cloud/status') body = STATUS
    if (path === '/kybernos-cloud/team-dsh/open') { asked.push(p.request.postData || ''); body = { ok: false, error: 'dsh_not_found' } }
    if (body === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
  })
  await phone(KABY_UA + ' KybernosPlace/local')
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
  await sleep(1500)
  await openDrawer()
  await click(AVATAR)
  const row = `[data-kb="space-row"][data-space="${W2}"]`
  // the preset hides every team path of the phone (the embedded engine cannot start a team's engine): the rows exist in the page, nothing of them is drawn
  await waitFor(page, `!!document.querySelector('[data-kb="menu-settings"]') && !!document.querySelector('${row}')`, 8000)
  const teamPaths = await ev(`(() => { const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }); const blk = document.querySelector('[data-kb="menu-block-teams"]'); const bb = blk ? blk.getBoundingClientRect() : null; return { rows: shown('[data-kb="space-row"]'), switcher: shown('[data-kb="menu-switch"]'), create: shown('[data-kb="space-create"]'), join: shown('[data-kb="space-join"]'), block: bb ? Math.round(bb.height) : null, blockOther: blk ? [...blk.children].some((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(c).display !== 'none' && !c.matches('[data-kb="menu-plan-card"]') && !c.querySelector('[data-kb="menu-plan-card"]') }) : false, text: /Studio|Personal/.test(document.querySelector('[role="menu"]').innerText) } })()`)
  check('the signed-in account sheet draws no team path at all: no row (Personal or Studio), no switcher, no « Create a team », no « Join », and nothing left in their block but the plan card the preset keeps', !!teamPaths && teamPaths.rows === false && teamPaths.switcher === false && teamPaths.create === false && teamPaths.join === false && teamPaths.text === false && teamPaths.blockOther === false, teamPaths)
  await shot('30-account-sheet-no-teams')
  // the fallback for a path that would still open a team (a build whose preset forgot one): put the rows back by switching the filter's stylesheet off, and tap one
  await ev(`(() => { const st = document.getElementById('kb-surfaces-css'); if (st) st.disabled = true; document.documentElement.removeAttribute('data-kb-surfaces') })()`)
  const teamSeen = await waitFor(page, `(() => { const e = document.querySelector('${row}'); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 })()`, 5000)
  check('with the filter off the team (Studio) is in the sheet beside Personal (the fallback below is reached through a real row)', teamSeen !== null)
  await click(row)
  const toast = await waitFor(page, `!!document.querySelector('[data-kb="kc-toast"]')`, 6000)
  const tinfo = await ev(`(() => { const t = document.querySelector('[data-kb="kc-toast"]'); if (!t) return null; const b = t.getBoundingClientRect(); return { text: t.innerText, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), onScreen: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, sheet: [...document.querySelectorAll('[data-kb^="menu-"]')].some((e) => e.getBoundingClientRect().height > 0) } })()`)
  check('the phone\'s engine was asked to open the team, once, and answered it has no DSH to start', asked.length === 1 && /"workspace_id":"22222222/.test(asked[0]), asked)
  check('the fallback: a toast says « Teams are not available on the phone yet. », on the screen, although the account sheet has already closed behind the tap', toast !== null && !!tinfo && /Teams are not available on the phone yet\./.test(tinfo.text) && tinfo.onScreen === true && tinfo.sheet === false, tinfo)
  await shot('31-team-toast')
  await page.send('Fetch.disable').catch(() => {})
  await ev(`(() => { const t = document.querySelector('[data-kb="kc-toast"]'); if (t) t.remove() })()`)

  section('G. Step 6 part 2: touch layer, French end to end, the phone\'s words, General only hidden in the phone layout, tabs in a column')
  const seedLang = (lang) => `try { if (localStorage.getItem('kb_live_seeded') === null) { localStorage.setItem('kybernos.theme.lang', '${lang}'); localStorage.setItem('kb_live_seeded', '1') } } catch (e) {}`
  const drawerText = () => ev(`((document.querySelector('[data-slot="sidebar"]') || document.body).innerText || '').replace(/\\s+/g, ' ')`)
  const pageText = () => ev(`((document.querySelector('[data-slot="settings.section"]') || document.body).innerText || '').replace(/\\s+/g, ' ')`)
  const openSettingsPage = async (key) => {
    await openDrawer()
    await click(AVATAR)
    await waitFor(page, `!!document.querySelector('[data-kb="menu-settings"]')`, 5000)
    await click('[data-kb="menu-settings"]')
    await waitFor(page, `!!document.querySelector('${DIALOG}')`, 8000)
    await sleep(900)
    await click(`${DIALOG} [data-kb-t="${key}"]`)
    await sleep(1600)
  }
  /** The phone's Settings shows ONE page at a time: back to the list by the page's bar, before the next page. */
  const toList = async () => { await click(`${DIALOG} [data-kbmob-back]`); await sleep(1100) }
  /** A real choice on the Language page (the row that is not the active one), then the reload the choice makes and the start-up delay of the language runtime. */
  const chooseOtherLanguage = async (onPage = false) => {
    if (!onPage) { await click(`${DIALOG} [data-kb-t="language"]`); await sleep(1500) }
    await click('.kbln-lang:not(.on) button')
    await sleep(3500)
    await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
    await sleep(9000)
  }
  await ev(`localStorage.removeItem('kb_live_seeded')`)
  await phone(KABY_UA + ' KybernosPlace/local', { pre: seedLang('kybernos') })
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await sleep(1500)
  check('the touch layer is on in Kaby mode (the Theme plugin reads the locked preset): `data-kb-touch="on"`', (await ev(`document.documentElement.getAttribute('data-kb-touch')`)) === 'on')
  await openDrawer()
  const frenchDrawer = await waitFor(page, `/Espaces de travail/.test((document.querySelector('[data-slot="sidebar"]') || document.body).innerText)`, 25000)
  const dtFr = await drawerText()
  check('Kybernos French: the engine\'s own drawer rows are French too (« Espaces de travail », not « Workspaces »), no English left of the drawer', frenchDrawer !== null && !/Workspaces|New chat|New session|Reminders|Automation tasks/.test(dtFr), dtFr)
  await shot('40-french-drawer')
  await openSettingsPage('memory & lessons')
  const memFr = await pageText()
  check('Settings › Memory, in French on the phone: « ce téléphone », never « cet ordinateur » / « cette machine »', /ce téléphone/.test(memFr) && !/cet ordinateur|cette machine/i.test(memFr), memFr.slice(0, 300))
  await shot('41-memory-fr')
  await toList()
  await click(`${DIALOG} [data-kb-t="kaby"]`)
  await sleep(1500)
  const tabs = await ev(`(() => { const l = document.querySelector('.kbkc-tabs'); if (!l) return null; const r = l.getBoundingClientRect(); return { dir: getComputedStyle(l).flexDirection, w: Math.round(r.width), tabs: [...l.children].map((t) => Math.round(t.getBoundingClientRect().height)) } })()`)
  check('the Kaby page\'s tabs are a column of full-width rows a thumb high', !!tabs && tabs.dir === 'column' && tabs.w >= 300 && tabs.tabs.every((h) => h >= 44), tabs)
  await shot('42-kaby-tabs')
  await toList()
  await click(`${DIALOG} [data-kb-t="about"]`)
  await sleep(1800)
  const appPage = await ev(`(() => { const p = document.querySelector('[data-kb="mobile-app-about"]'); if (!p) return null; return { title: (p.querySelector('.kbapp-title') || {}).innerText, cards: [...p.querySelectorAll('h3')].map((h) => h.innerText.replace(/\\s+/g, ' ')), keyCard: !!p.querySelector('[data-kb="mobile-app-key"]') } })()`)
  console.log('    « ' + (appPage ? appPage.title : '?') + ' » holds: ' + JSON.stringify(appPage ? appPage.cards : null))
  check('the app\'s parts are drawn inside About (no title of their own) with their cards, and no key card in Simple', !!appPage && appPage.cards.length >= 4 && appPage.keyCard === false && !appPage.title, appPage)
  await shot('43-about-app-parts')
  // the Language page: a real choice of English is kept (DSH is not sent back to French), a real choice of French reaches DSH
  await toList()
  await chooseOtherLanguage()
  await openDrawer()
  const dtEn = await drawerText()
  check('English chosen on the Language page: the drawer is English and stays English after the start-up delay (nothing puts French back)', /Workspaces|Reminders|New chat|New session/.test(dtEn) && !/Espaces de travail|Rappels/.test(dtEn) && (await ev(`document.documentElement.lang`)) === 'en', dtEn)
  await openSettingsPage('memory & lessons')
  const memEn = await pageText()
  check('Settings › Memory, in English on the phone: « this phone », never « this computer »', /this phone/.test(memEn) && !/this computer|this machine/i.test(memEn), memEn.slice(0, 300))
  await toList()
  await chooseOtherLanguage()
  await openDrawer()
  const dtFr2 = await drawerText()
  check('French chosen again: the drawer is French again (DSH is put on its own French at the next start)', /Espaces de travail/.test(dtFr2) && !/Workspaces|New chat/.test(dtFr2), dtFr2)
  // leave the sandbox as it was found (the language DSH keeps on the host is English), so that this script can be played again
  await openSettingsPage('language')
  await chooseOtherLanguage(true)
  check('left as found: English again (the next run of this script starts from the same state)', (await ev(`document.documentElement.lang`)) === 'en')
  // a tablet width in Kaby mode: General is kept (Settings opens on it), only the phone layout hides it
  await ev(`localStorage.removeItem('kb_live_seeded')`)
  await phone(KABY_UA + ' KybernosPlace/local', { width: 820 })
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && typeof window.__kbOpenDshSettings === 'function'`, 30000)
  await sleep(1500)
  await ev(`window.__kbOpenDshSettings && window.__kbOpenDshSettings()`)
  await waitFor(page, `!!document.querySelector('${DIALOG}')`, 8000)
  await sleep(900)
  const wide = await shownPages()
  check('at a tablet width (820 px) General stays in the list of pages: only the phone layout hides it', Array.isArray(wide) && wide.indexOf('general') >= 0 && wide.indexOf('usage') < 0 && wide.indexOf('connectors') < 0, wide)
  await shot('44-tablet-settings')
  await ev(`localStorage.removeItem('kb_live_seeded')`)

  section('H. Step 6 part 2: Back on a page (the shell\'s close-layer), one level at a time')
  await phone(KABY_UA + ' KybernosPlace/local', { pre: cloudStub(true) })
  await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await sleep(1500)
  const lastLayers = () => ev(`(() => { const l = (window.__kbOut || []).filter((m) => m.kybernos === 'layers'); const m = l[l.length - 1]; return m ? { depth: m.depth, top: m.top || null } : null })()`)
  const closeLayer = async () => { await ev(`window.__KB_APP__ && window.__KB_APP__.receive({ kybernos: 'close-layer', version: 1 })`); await sleep(1200) }
  const same = (a, d, t) => !!a && a.depth === d && (a.top || null) === t
  await openDrawer()
  await click('[data-kb-row="tasks"]')
  await sleep(1500)
  const pageLayers = await lastLayers()
  check('a page (Reminders) is open: the page says one layer, `top: "page"`, and the drawer is closed behind it', same(pageLayers, 1, 'page') && (await drawerOpen()) === false && (await visible(COMPOSER)) === false, pageLayers)
  await openDrawer()
  check('the drawer over the page is two layers, the menu on top', same(await lastLayers(), 2, 'menu'))
  await closeLayer()
  const backOne = await lastLayers()
  check('Back #1 closes the drawer and keeps the page (the lowest layer is the last to go)', same(backOne, 1, 'page') && (await drawerOpen()) === false && (await visible(COMPOSER)) === false, backOne)
  await closeLayer()
  const backTwo = await lastLayers()
  check('Back #2 leaves the page for the chat, the drawer over it (the way the page was reached), not the app', (await visible(COMPOSER)) === true && same(backTwo, 1, 'menu') && (await drawerOpen()) === true, backTwo)
  await closeLayer()
  check('Back #3 closes the drawer: no layer is left, so the next Back is the shell\'s own (it leaves the app)', same(await lastLayers(), 0, null) && (await drawerOpen()) === false)
  await openDrawer()
  await click(AVATAR)
  await waitFor(page, `!!document.querySelector('[data-kb="menu-settings"]')`, 5000)
  await click('[data-kb="menu-settings"]')
  await waitFor(page, `!!document.querySelector('${DIALOG}')`, 8000)
  await sleep(900)
  await click(`${DIALOG} [data-kb-t="memory & lessons"]`)
  await sleep(1500)
  await closeLayer()
  check('inside Settings, Back leaves the page for the list first: the dialog is still open', (await exists(DIALOG)) === true && same(await lastLayers(), 1, 'settings'), await lastLayers())
  await closeLayer()
  check('...and the next Back closes the dialog', (await exists(DIALOG)) === false && same(await lastLayers(), 0, null) && (await visible(COMPOSER)) === true)

  section('I. Step 6 part 3 (S3): the phone with no account: padlocks, the shell\'s sign-in door only when it is listed, a connected account sees none of it')
  await page.send('Page.enable', {})
  const nav = []
  page.on('Page.frameRequestedNavigation', (p) => { if (typeof p.url === 'string' && p.url.indexOf('kybernos://') === 0) nav.push(p.url) })
  const sheetOf = () => ev(`(() => { const e = document.querySelector('[data-kb="padlock-sheet"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { row: e.getAttribute('data-row'), title: (e.querySelector('.kbc-title') || {}).textContent, text: (e.querySelector('[data-kb="padlock-text"]') || {}).textContent, signin: (e.querySelector('[data-kb="padlock-signin"]') || {}).textContent, later: (e.querySelector('[data-kb="padlock-later"]') || {}).textContent, w: b.width, h: b.height, bottom: b.bottom } })()`)
  const padlockBadge = () => ev(`['kyber', 'tasks', 'connectors'].map((id) => { const e = document.querySelector('[data-kb-row="' + id + '"]'); return [id, e ? getComputedStyle(e, '::after').content : null] })`)
  const pairStarts = () => ev(`window.__kbPairStarts`)
  const intoPhone = async (ua, pre) => {
    await phone(ua, { pre })
    await waitFor(page, `document.documentElement.classList.contains('kb-kaby') && !!document.querySelector('${BURGER}')`, 30000)
    await ev(SHELL_STATE)
    await sleep(1500)
  }

  // I1: nobody is signed in, the shell lists no `signin` (an older build): padlocks, and « Sign in » is the device-code card as ever
  await intoPhone(KABY_UA, cloudStub(false))
  const mark = await waitFor(page, `document.documentElement.getAttribute('data-kb-padlock') === 'tasks connectors'`, 20000)
  check('signed out in Simple: the page marks the two rows the preset lists (`data-kb-padlock="tasks connectors"`), no other', mark !== null, await ev(`document.documentElement.getAttribute('data-kb-padlock')`))
  await openDrawer()
  const rowsI = await drawerRows()
  check('the drawer still lists the three rows of the preset (a padlock is a mark on a row, not a missing row)', Array.isArray(rowsI) && rowsI.map((r) => r[0]).sort().join() === 'connectors,kyber,tasks', rowsI)
  const badges = await padlockBadge()
  check('Reminders and Apps carry the padlock mark; Kaby carries none', Array.isArray(badges) && badges.every(([id, c]) => (id === 'kyber') === (c === 'none')), badges)
  await shot('50-padlock-drawer')
  await click('[data-kb-row="tasks"]')
  await sleep(700)
  const s1 = await sheetOf()
  check('a tap on « Reminders » opens the sheet: one title, one sentence, Sign in and Not now, a bottom sheet the phone\'s width', !!s1 && s1.row === 'tasks' && /Reminders/.test(s1.title) && /reminders/i.test(s1.text) && s1.signin === 'Sign in' && s1.later === 'Not now' && s1.w >= 300 && s1.w <= 392, s1)
  check('...and the real Automations page was NOT opened under it', !/Automations?/i.test(await ev(`document.body.innerText.slice(0, 4000)`)) && (await visible(COMPOSER)) === true)
  await shot('51-padlock-sheet')
  await click('[data-kb="padlock-later"]')
  await sleep(400)
  check('« Not now » closes the sheet, nothing else happens (no sign-in link, no pairing)', (await sheetOf()) === null && nav.length === 0 && (await pairStarts()) === 0, { nav, starts: await pairStarts() })
  await openDrawer()
  await click('[data-kb-row="connectors"]')
  await sleep(700)
  const s2 = await sheetOf()
  check('a tap on « Apps » opens the same sheet with its own sentence', !!s2 && s2.row === 'connectors' && /Apps/.test(s2.title) && /apps/i.test(s2.text), s2)
  await click('[data-kb="padlock-signin"]')
  await sleep(1200)
  check('« Sign in » with NO `signin` in the user agent: no shell link, the device-code card as ever (the pairing was asked for once)', nav.length === 0 && (await pairStarts()) === 1 && (await sheetOf()) === null, { nav, starts: await pairStarts() })
  await shot('52-signin-card-no-door')
  // the account menu of a signed-out person: Sign in, Settings, the help rows; no Sign up, no Plans
  await intoPhone(KABY_UA, cloudStub(false))
  await openDrawer()
  await click(AVATAR)
  await sleep(700)
  const offMenu = await menuItems()
  check('the signed-out account menu keeps Sign in, Settings, Help and Feedback', Array.isArray(offMenu) && ['menu-connect', 'menu-settings', 'menu-help', 'menu-feedback'].every((id) => offMenu.indexOf(id) >= 0), offMenu)
  check('...and shows neither « Sign up » nor « Plans » (the preset hides them on the phone)', Array.isArray(offMenu) && offMenu.indexOf('menu-signup') < 0 && offMenu.indexOf('menu-plans') < 0, offMenu)
  await shot('53-offmenu')
  await click('[data-kb="menu-connect"]')
  await sleep(1200)
  check('« Sign in » of the menu with NO `signin`: no shell link, the device-code card (a second pairing start)', nav.length === 0 && (await pairStarts()) === 1, { nav, starts: await pairStarts() })
  // the line under the model picker, the same
  await intoPhone(KABY_UA, cloudStub(false))
  await click('[data-kb="model-seat"]')
  await sleep(900)
  const band0 = await ev(`(() => { const b = document.querySelector('[data-kb="model-seat-band"]'); return b ? { text: b.innerText, door: b.getAttribute('data-door'), kind: b.getAttribute('data-kind') } : null })()`)
  check('the picker\'s band, no `signin` listed: the web\'s own line (« Kybernos Cloud models… »), no shell door', !!band0 && band0.kind === 'signin' && band0.door === null && /Kybernos Cloud models/.test(band0.text), band0)

  // I2: the shell lists `signin` (the new build): the same three places call its door, once each, and never start a pairing
  nav.length = 0
  await intoPhone(KABY_UA + ',signin', cloudStub(false))
  await openDrawer()
  await click('[data-kb-row="tasks"]')
  await sleep(600)
  await click('[data-kb="padlock-signin"]')
  await sleep(900)
  check('the sheet\'s « Sign in » with `signin` listed asks the shell for `kybernos://signin` (once) and starts no pairing', nav.length === 1 && nav[0] === 'kybernos://signin' && (await pairStarts()) === 0 && (await sheetOf()) === null, { nav, starts: await pairStarts() })
  check('...and the page is still there, where the person was (the shell\'s screen opens over it)', (await visible(COMPOSER)) === true && (await ev(`location.href`)).indexOf('kybernos://') < 0)
  await openDrawer()
  await click(AVATAR)
  await sleep(600)
  await click('[data-kb="menu-connect"]')
  await sleep(900)
  check('the account menu\'s « Sign in » with `signin` listed asks the shell for the same door and starts no pairing', nav.length === 2 && nav[1] === 'kybernos://signin' && (await pairStarts()) === 0, { nav, starts: await pairStarts() })
  await intoPhone(KABY_UA + ',signin', cloudStub(false))
  await click('[data-kb="model-seat"]')
  await sleep(900)
  const band1 = await ev(`(() => { const b = document.querySelector('[data-kb="model-seat-band"]'); return b ? { text: b.innerText, door: b.getAttribute('data-door') } : null })()`)
  check('the picker\'s line becomes « Sign in for more models » (one line, a button), marked as the shell\'s door', !!band1 && band1.door === 'shell' && /Sign in for more models/.test(band1.text) && !/membership/.test(band1.text), band1)
  await shot('54-picker-line')
  const before = nav.length
  await click('[data-kb="model-seat-signin"]')
  await sleep(800)
  check('...and its button asks the shell for `kybernos://signin`', nav.length === before + 1 && nav[nav.length - 1] === 'kybernos://signin' && (await pairStarts()) === 0, { nav, starts: await pairStarts() })

  // I3: a connected account: nothing of the above (the drawer, the menu and the picker are the full app's)
  nav.length = 0
  await intoPhone(KABY_UA + ',signin', cloudStub(true))
  await openDrawer()
  const connectedBadges = await padlockBadge()
  check('a connected account: no padlock attribute on the page and no mark on any row', (await ev(`document.documentElement.hasAttribute('data-kb-padlock')`)) === false && Array.isArray(connectedBadges) && connectedBadges.every(([, c]) => c === 'none'), connectedBadges)
  await click('[data-kb-row="connectors"]')
  await sleep(1500)
  check('...and « Apps » opens the real Connectors page, no sheet', (await sheetOf()) === null && /Connectors?/i.test(await ev(`document.body.innerText.slice(0, 4000)`)))
  await openDrawer()
  await click(AVATAR)
  await sleep(700)
  const onMenu = await menuItems()
  check('...and the account menu has no « Sign in » row (it is the connected menu)', Array.isArray(onMenu) && onMenu.indexOf('menu-connect') < 0 && onMenu.indexOf('menu-settings') >= 0, onMenu)
  check('no link was asked of the shell by any of this', nav.length === 0, nav)

  // I4: French pairs (the sheet and the picker line)
  await intoPhone(KABY_UA + ',signin', seedLang('kybernos') + cloudStub(false))
  await openDrawer()
  await click('[data-kb-row="tasks"]')
  await sleep(700)
  const f1 = await sheetOf()
  check('in French the sheet says it in French', !!f1 && /rappels/i.test(f1.title) && f1.signin === 'Se connecter' && f1.later === 'Pas maintenant', f1)
  await shot('55-padlock-sheet-fr')
  await click('[data-kb="padlock-later"]')
  await intoPhone(KABY_UA + ',signin', seedLang('kybernos') + cloudStub(false))
  await click('[data-kb="model-seat"]')
  await sleep(900)
  const bandFr = await ev(`(() => { const b = document.querySelector('[data-kb="model-seat-band"]'); return b ? b.innerText : null })()`)
  check('...and so does the picker\'s line (« Connecte-toi pour plus de modèles »)', typeof bandFr === 'string' && /Connecte-toi pour plus de mod/.test(bandFr), bandFr)
  // leave the sandbox as it was found (DSH keeps its language on the host: the French seed above put it on `fr`), so that this script can be played again
  await ev(`localStorage.removeItem('kb_live_seeded')`)
  await intoPhone(KABY_UA + ',signin', cloudStub(false))
  await openSettingsPage('language')
  await chooseOtherLanguage(true)
  check('left as found: English again (the French seed of this section did not stay on the host)', (await ev(`document.documentElement.lang`)) === 'en')

  section('No script error')
  check('no exception during the whole run', errors.length === 0, errors)
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
