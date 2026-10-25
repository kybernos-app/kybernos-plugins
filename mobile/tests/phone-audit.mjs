#!/usr/bin/env node
// Walks the pages of the interface in the app's web view on a phone or an emulator (DevTools into the WebView, nothing installed, nothing written) and measures what makes a page poor on a small
// screen: sideways overflow, text cut by its box, controls under 32 px, a header that eats the first screen, the menu button sitting on top of something. One screenshot per page.
//   ANDROID_SERIAL / PHONE=<adb serial> node mobile/tests/phone-audit.mjs [--out <dir>] [--only "Skills,Connectors"] [--wait <ms>] [--settings]
// With --settings it walks the Settings dialog instead: each group of its list (look, memory, system, devices, models, tools, agents, voice, and General) and, when a group folds several pages, each page of it. It opens the dialog from the drawer's account card each time and closes it after.
// The app must be running in front (a self-test launch skips the consent screen and the key). Pages are opened with a script click on the drawer's own entries, so the drawer itself is not drawn.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from '../../scripts/cdp-lib.mjs'

const SDK = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools'
const SERIAL = process.env.PHONE || process.env.ANDROID_SERIAL
if (!SERIAL) { console.error('set PHONE=<adb serial>'); process.exit(2) }
const adb = (...a) => execFileSync(join(SDK, 'platform-tools', 'adb'), ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const adbBin = (...a) => execFileSync(join(SDK, 'platform-tools', 'adb'), ['-s', SERIAL, ...a], { maxBuffer: 64 * 1024 * 1024 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined }
const out = arg('out') || join(process.env.TMPDIR || '/tmp', 'kb-phone-audit')
mkdirSync(out, { recursive: true })
const WAIT = Number(arg('wait') || 2800)
const SETTINGS = process.argv.includes('--settings')
const PAGES = (arg('only') ? arg('only').split(',').map((s) => s.trim()) : (SETTINGS ? ['general', 'look', 'memory', 'system', 'devices', 'models', 'tools', 'agents', 'voice'] : ['New chat', 'Kaby', 'Dashboards', 'Agent Teams', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']))

const pid = adb('shell', 'pidof', 'app.kybernos.host').trim().split(/\s+/)[0]
adb('forward', 'tcp:9445', 'localabstract:webview_devtools_remote_' + pid)
const targets = await (await fetch('http://127.0.0.1:9445/json')).json()
const page = await connect(targets.find((x) => x.type === 'page' && /127\.0\.0\.1/.test(x.url)))
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 20000); if (r.err) throw new Error(r.err); return r.val }

// open an entry of the drawer by its name (aria-label, title or own text), the way a tap would
const OPEN = (label) => `(() => {
  const want = ${JSON.stringify(label)}.toLowerCase()
  const cands = [...document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] [role="button"], [data-slot="sidebar"] a, [data-slot="sidebar"] [data-row-key]')]
  const name = (e) => ((e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().toLowerCase())
  const hit = cands.find((e) => name(e) === want) || cands.find((e) => name(e).startsWith(want + ' ') || name(e).startsWith(want))
  if (!hit) return 'not found'
  hit.click(); return 'ok'
})()`

const MEASURE = (SETTINGS_ROOT) => `(() => {
  const vw = innerWidth, vh = innerHeight
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 }
  const main = (${SETTINGS_ROOT} && document.querySelector('[data-shortcut-modal="settings"]')) || document.querySelector('[data-slot="main"]') || document.body
  const label = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0].slice(0, 22) : '')
  const text = (e) => (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
  const all = [...main.querySelectorAll('*')].filter(vis)
  // sideways overflow: the page scrolls sideways, or something sticks out of the viewport on the right
  // inside a strip that scrolls sideways on purpose (a carousel of cards), sticking out is the design
  const inStrip = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 2) return true; return false }
  const sticks = all.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 2 && !e.closest('[aria-hidden="true"]') && getComputedStyle(e).position !== 'fixed' && !inStrip(e) }).slice(0, 6).map((e) => label(e) + ' right=' + Math.round(e.getBoundingClientRect().right) + ' "' + text(e) + '"')
  const sideways = document.scrollingElement.scrollWidth - vw
  // text cut by its own box
  const cut = all.filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 && /(hidden|clip)/.test(getComputedStyle(e).overflowX) && e.textContent.trim().length > 2).slice(0, 8).map((e) => '"' + text(e) + '"')
  // controls too small for a finger
  const ctl = all.filter((e) => e.matches('button, a[href], [role="button"], [role="tab"], input:not([type=hidden]), select, [role="switch"], [role="checkbox"], [role="radio"]'))
  // a control drawn small keeps a touch area when an absolutely positioned ::before grows it (the phone layout and several plugins do that): it is not counted
  const extended = (e) => { const b = getComputedStyle(e, '::before'); return b.content !== 'none' && b.position === 'absolute' && (parseFloat(b.width) >= 32 || parseFloat(b.height) >= 32 || /-\\d/.test(b.top + b.left + b.right + b.bottom)) }
  const small = ctl.filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 32 || r.height < 32) && !e.closest('[aria-hidden="true"]') && !extended(e) && !(e.matches('a') && e.textContent.trim().length > 3 && r.height >= 18) })
  // the first screen: where the title and the first content start, and what the fixed menu button covers
  const h1 = main.querySelector('h1, h2, [role="heading"]')
  const hb = document.querySelector('[data-slot="sidebar"] button[aria-label], [data-slot="sidebar"] button')
  const menu = [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.top < 90 && r.left < 70 && r.width > 0 && getComputedStyle(b).visibility !== 'hidden' })
  let overlap = []
  if (menu) { const m = menu.getBoundingClientRect(); overlap = all.filter((e) => e.children.length === 0 && e.textContent.trim().length > 1 && !menu.contains(e)).filter((e) => { const r = e.getBoundingClientRect(); return r.left < m.right - 4 && r.right > m.left + 4 && r.top < m.bottom - 4 && r.bottom > m.top + 4 }).slice(0, 3).map((e) => '"' + text(e) + '"') }
  const heights = { titleTop: h1 ? Math.round(h1.getBoundingClientRect().top) : null, menuTop: menu ? Math.round(menu.getBoundingClientRect().top) : null, menuBottom: menu ? Math.round(menu.getBoundingClientRect().bottom) : null }
  // how much of the first screen is chrome before the first card or row of the page: first element that looks like content (img, svg card, list item, table)
  const first = all.find((e) => e.matches('li, tr, article, [role="listitem"], [role="row"], img, canvas, video') && e.getBoundingClientRect().top > 0)
  heights.firstContentTop = first ? Math.round(first.getBoundingClientRect().top) : null
  // content that starts above the top edge of its scroll area while the area is not scrolled: unreachable, cut (a centred flex column taller than its box does this)
  const clippedTop = [...document.querySelectorAll('*')].filter((c) => /(auto|scroll)/.test(getComputedStyle(c).overflowY) && c.scrollTop === 0 && c.clientHeight > 100 && c.children.length > 0 && (c.scrollHeight > c.clientHeight || getComputedStyle(c).display === 'flex')).flatMap((c) => { const top = c.getBoundingClientRect().top; return [...c.children].filter((k) => { const r = k.getBoundingClientRect(); return r.height > 20 && r.top < top - 4 && r.bottom > top }).map((k) => label(k) + ' starts ' + Math.round(top - k.getBoundingClientRect().top) + ' px above its area') }).slice(0, 4)
  const imgs = [...document.images].filter((i) => vis(i) && i.complete && i.naturalWidth === 0).length
  return { vw, vh, title: h1 ? text(h1) : null, sideways, sticks, cut, smallCount: small.length, small: small.slice(0, 6).map((e) => label(e) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + ' "' + text(e) + '"'), overlap, clippedTop, heights, brokenImages: imgs, docHeight: document.scrollingElement.scrollHeight }
})()`

const OPEN_SETTINGS = `(() => { if (document.querySelector('[data-shortcut-modal="settings"]')) return 'already'; const c = document.querySelector('[data-kb="foot-signin"]'); if (!c) return 'no account card'; c.click(); return 'card' })()`
const CLICK_MENU_SETTINGS = `(() => { const b = document.querySelector('[data-kb="menu-settings"]'); if (!b) return 'no menu entry'; b.click(); return 'ok' })()`
const OPEN_GROUP = (g) => `(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); if (!d) return 'no dialog'; const b = d.querySelector('[data-kb-g="' + ${JSON.stringify(g)} + '"]') || [...d.querySelectorAll('nav button')].find((e) => e.getAttribute('data-kb-g') === ${JSON.stringify(g)}); if (!b) return 'not found'; b.click(); return 'ok' })()`
const LIST_PAGES = `(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const nav = d && d.querySelector('nav'); if (!nav) return '[]'; return JSON.stringify([...nav.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().height > 0 && !/^back to workspace/i.test(e.textContent.trim())).map((e) => e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40))) })()`
const OPEN_PAGE = (t) => `(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const nav = d && d.querySelector('nav'); const b = nav && [...nav.querySelectorAll('button')].find((e) => e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) === ${JSON.stringify(t)}); if (!b) return 'not found'; b.click(); return 'ok' })()`
const CLOSE_SETTINGS = `(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); if (!d) return 'closed'; const b = [...d.querySelectorAll('button, a')].find((e) => /^back to workspace/i.test((e.getAttribute('aria-label') || e.textContent || '').trim())); if (!b) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'escape' } b.click(); return 'back' })()`

const results = []
async function visit (label, pageText) {
  let opened = 'ok'
  if (SETTINGS) {
    await ev(CLOSE_SETTINGS); await sleep(700)
    await ev(OPEN_SETTINGS); await sleep(900)
    await ev(CLICK_MENU_SETTINGS); await sleep(1500)
    opened = await ev(OPEN_GROUP(label))
    if (pageText) { await sleep(900); opened = await ev(OPEN_PAGE(pageText)) }
  } else opened = await ev(OPEN(label))
  await sleep(WAIT)
  let m = null
  try { m = JSON.parse(await ev('JSON.stringify(' + MEASURE(SETTINGS) + ')', 30000)) } catch (e) { m = { error: String(e.message || e) } }
  const name = pageText ? label + ' > ' + pageText : label
  const file = join(out, name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png')
  try { writeFileSync(file, adbBin('exec-out', 'screencap', '-p')) } catch (e) { /* no screenshot */ }
  results.push({ page: name, opened, ...m, screenshot: file })
  const flags = []
  if (opened !== 'ok') flags.push('NOT OPENED')
  if (m && m.sideways > 0) flags.push('scrolls sideways +' + m.sideways)
  if (m && m.sticks && m.sticks.length) flags.push('sticks out: ' + m.sticks.length)
  if (m && m.cut && m.cut.length) flags.push('text cut: ' + m.cut.length + ' ' + m.cut.slice(0, 3).join(' '))
  if (m && m.smallCount) flags.push('small targets: ' + m.smallCount)
  if (m && m.overlap && m.overlap.length) flags.push('under the menu button: ' + m.overlap.join(' '))
  if (m && m.clippedTop && m.clippedTop.length) flags.push('CUT AT THE TOP: ' + m.clippedTop.join(' | '))
  console.log(name.slice(0, 30).padEnd(30), (m && m.title ? '[' + m.title + '] ' : '') + (flags.length ? flags.join(' | ') : 'clean'))
}
for (const label of PAGES) {
  await visit(label, null)
  if (SETTINGS) {
    // a group that folds several pages lists them in the dialog's nav: visit each
    let pages = []
    try { pages = JSON.parse(await ev(LIST_PAGES)) } catch (e) { pages = [] }
    if (pages.length > 1) for (const t of pages) await visit(label, t)
  }
}
writeFileSync(join(out, 'audit.json'), JSON.stringify(results, null, 1))
console.log('details:', join(out, 'audit.json'))
if (SETTINGS) { try { await ev(CLOSE_SETTINGS) } catch (e) { /* closed */ } }
page.close()
try { adb('forward', '--remove', 'tcp:9445') } catch (e) { /* gone */ }
