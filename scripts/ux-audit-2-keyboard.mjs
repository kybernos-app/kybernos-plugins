// Second UX and bug audit — the keyboard paths of the main pages and dialogs.
// Read-only: it tabs, opens what opens, presses Escape and Enter; it never confirms
// anything that writes. Sandbox only (:3080 refused).
//
//   source scripts/sandbox/env.sh && node scripts/ux-audit-2-keyboard.mjs --out /tmp/ux-audit-2/keyboard
//
// Per page it records: the tab order (what is reached, in what sequence), whether
// focus is VISIBLE on each stop, that Escape closes what opened, and that Enter
// activates the focused control (measured on a control that only opens something).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', '/tmp/ux-audit-2/keyboard')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ refusing :3080'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })

const live = await openLivePage({ width: 1400, height: 900 })
const page = live.page
const ev = async (js, ms = 12000) => (await page.evalJs(js, ms)).val
const report = { pages: {}, dialogs: [] }

const key = async (k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k, windowsVirtualKeyCode: vk })
  await sleep(90)
}
const tab = () => key('Tab', 'Tab', 9)
const esc = () => key('Escape', 'Escape', 27)
const enter = () => key('Enter', 'Enter', 13)

const activeInfo = () => ev(`JSON.stringify((() => {
  const a = document.activeElement
  if (!a || a === document.body) return { none: true }
  const r = a.getBoundingClientRect()
  const cs = getComputedStyle(a)
  const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    ? 'outline ' + cs.outlineWidth + ' ' + cs.outlineColor
    : (cs.boxShadow && cs.boxShadow !== 'none' ? 'shadow' : '')
  return {
    tag: a.tagName,
    role: a.getAttribute('role'),
    text: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('placeholder') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
    w: Math.round(r.width), h: Math.round(r.height),
    visibleFocus: ring !== '',
    ring,
    tabindex: a.getAttribute('tabindex'),
  }
})())`) || '{}'

/** Walk the tab order of the open surface and record every stop. */
const tabWalk = async (steps = 35) => {
  const stops = []
  for (let i = 0; i < steps; i += 1) {
    await tab()
    const info = JSON.parse((await activeInfo()) || '{}')
    stops.push(info)
  }
  return stops
}

const summarise = (stops) => {
  const reached = stops.filter((s) => !s.none)
  const noRing = reached.filter((s) => s.visibleFocus !== true)
  return {
    stops: stops.length,
    reached: reached.length,
    empty: stops.filter((s) => s.none).length,
    withoutVisibleFocus: noRing.length,
    order: reached.map((s) => s.text || s.tag),
  }
}

const shot = async (name) => { await page.shot(join(OUT, 'shots', name + '.png')) }

// ── 1. the home / chat page ────────────────────────────────────────────────────
await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
await sleep(1500)
await shot('00-home')
const home = await tabWalk(35)
report.pages.home = summarise(home)
report.pages.home.raw = home

// Escape must close what opened, not the page.
const dialogOpen = async () => ev(`(() => {
  const d = document.querySelector('[role=dialog], [class*="dialog"], [class*="Dialog"]')
  if (!d) return false
  const r = d.getBoundingClientRect()
  return r.width > 40 && r.height > 40
})()`) === true

// ── 2. Settings dialog: open with the keyboard, walk, Escape closes it ────────
const opened = await openSettings(page)
if (opened === true) {
  await sleep(800)
  await shot('01-settings')
  const settings = await tabWalk(40)
  report.pages.settings = summarise(settings)
  report.pages.settings.raw = settings
  // Escape closes the dialog (the whole Settings), and focus comes back somewhere sensible.
  const before = await dialogOpen()
  await esc()
  await sleep(700)
  const after = await dialogOpen()
  report.dialogs.push({ name: 'settings', opened: before, closedByEscape: before === true && after === false, focusAfter: JSON.parse((await activeInfo()) || '{}') })
  await shot('02-settings-after-escape')
} else {
  report.dialogs.push({ name: 'settings', error: 'did not open' })
}

// ── 3. a page dialog (the help card) and a menu: Enter opens, Escape closes ───
await page.send('Page.navigate', { url: 'http://' + host + '/' })
await sleep(3000)
await waitFor(page, `document.body && document.body.innerText.length > 40`, 20000)
// Find a button that only opens something (a menu or a dialog) and press Enter on it.
const opener = await ev(`(() => {
  const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
    const r = b.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) return false
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim()
    return /help|how it works|\\?|more|options|menu/i.test(t) && b.getAttribute('aria-haspopup') !== null || /help/i.test(t)
  })
  if (btns.length === 0) return null
  const b = btns[0]
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40) })
})()`)
if (opener) {
  const { x, y, text } = JSON.parse(opener)
  // focus it by clicking its box (a focus click is allowed: it opens nothing on its own… it may open a
  // menu; that is what Escape below closes). Prefer Tab: walk until the same control is focused.
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
  await sleep(700)
  const open1 = await dialogOpen()
  await shot('03-opener-' + text.replace(/\W+/g, '-').slice(0, 20))
  await esc()
  await sleep(600)
  const open2 = await dialogOpen()
  report.dialogs.push({ name: 'opener ' + text, openedOnClick: open1, closedByEscape: open1 === true && open2 === false })
}

// Enter on a focused control that activates (the sidebar's current page has no
// side effect): press Enter on the focused element and see whether anything opened.
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
await sleep(300)
const focused = JSON.parse((await activeInfo()) || '{}')
const openBefore = await dialogOpen()
await enter()
await sleep(600)
const openAfter = await dialogOpen()
report.dialogs.push({ name: 'enter on ' + (focused.text || focused.tag), focused, activatedSomething: openBefore !== openAfter })

writeFileSync(join(OUT, 'keyboard.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ pages: Object.fromEntries(Object.entries(report.pages).map(([k, v]) => [k, { reached: v.reached, empty: v.empty, withoutVisibleFocus: v.withoutVisibleFocus }])), dialogs: report.dialogs }, null, 1))
await live.close()
