#!/usr/bin/env node
// Every Settings page has the SAME title (family, size, weight, colour, line height, letter spacing), and the « ? How it works » of the page
// sits right after the title's text, on the same line, whatever the width: measured on the real GUI, page by page, then each « ? » is pressed.
//
//   source scripts/sandbox/env.sh && node scripts/check-page-titles-live.mjs [--width 1400] [--scheme dark|light] [--lang en|fr] [--shots <dir>] [--no-click] [--only <label,label>]
//
// It opens each page of the Settings menu and measures; the only presses are the « ? » of the page (a card opens, Escape closes it), and, for `--scheme light`, the
// « Clean light » skin of the Theme page: DSH takes its mode from the skin, not from the browser's colour scheme, so the run picks it and puts « DSH default » back. That is
// a change of the GUI's own settings: the script refuses it on port 3080 (the real DSH), use the sandbox (scripts/sandbox).
// French is forced in the page only (the language resolver, as scripts/check-help-live.mjs does): DSH's stored language is never touched.
// A width under 700 px is a phone (mobile emulation). Exit code 0 / 1 / 3 (3 = inconclusive: no Chrome, GUI down).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings } from './live-page.mjs'

const args = process.argv.slice(2)
const opt = (name, dflt) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : dflt)
const WIDTH = Number(opt('--width', 1400))
const SCHEME = opt('--scheme', 'dark')
const LANG = opt('--lang', 'en')
const SHOTS = opt('--shots', null)
const ONLY = opt('--only', null) === null ? null : opt('--only', '').split(',')
const CLICK = !args.includes('--no-click')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) }
}
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true })

const live = await openLivePage({ width: WIDTH, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const press = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code }) }

// What a page's title and its button look like, measured in the page.
const MEASURE = `(() => {
  const sec = document.querySelector('[data-slot="settings.section"]')
  if (sec === null) return { none: 'no section' }
  const title = sec.querySelector('.kbhp-title') || sec.querySelector('h2[class*="_title"], h2[class*="_heading"]')
  if (title === null) return { none: 'no title' }
  const cs = getComputedStyle(title)
  const scope = title.closest('.kbhp-head') || title
  const btn = scope.querySelector('[data-kb="help-button"]') || title.querySelector('[data-kb="help-button"]')
  const own = [...title.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim() !== '')
  let lines = []
  if (own.length > 0) { const r = document.createRange(); r.setStart(own[0], 0); r.setEnd(own[own.length - 1], own[own.length - 1].nodeValue.length); lines = [...r.getClientRects()].filter((q) => q.width > 0) }
  const last = lines.length > 0 ? lines[lines.length - 1] : null
  const rtl = getComputedStyle(title).direction === 'rtl'
  const b = btn === null ? null : btn.getBoundingClientRect()
  return {
    text: (own.map((n) => n.nodeValue.trim()).join(' ') || title.textContent || '').trim().slice(0, 40),
    tag: title.tagName.toLowerCase(), cls: String(title.className).slice(0, 50),
    style: { family: cs.fontFamily.split(',')[0].trim(), size: cs.fontSize, weight: cs.fontWeight, color: cs.color, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform },
    nLines: lines.length,
    last: last === null ? null : { l: Math.round(last.left), r: Math.round(last.right), t: Math.round(last.top), b: Math.round(last.bottom) },
    btn: b === null ? null : { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), x: b.left + b.width / 2, y: b.top + b.height / 2 },
    gap: b === null || last === null ? null : Math.round(rtl ? last.left - b.right : b.left - last.right),
    dy: b === null || last === null ? null : Math.round(Math.abs((b.top + b.bottom) / 2 - (last.top + last.bottom) / 2)),
    inside: b === null ? null : (b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight),
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    titleRight: last === null ? null : Math.round(last.right), vw: window.innerWidth,
    standalone: !!document.querySelector('.kbhp-row'),
  }
})()`

try {
  if (WIDTH < 700) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 844, deviceScaleFactor: 1, mobile: true })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  }
  await sleep(3000)
  if (WIDTH < 700) { await page.send('Page.reload', {}); await sleep(5500) }
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  await sleep(1200)
  const cells = await ev(`[...document.querySelectorAll('button[class*="navCell"]')].map((b) => (b.innerText || '').trim().split('\\n')[0])`)
  if (!Array.isArray(cells) || cells.length < 20) { console.error('○ inconclusive: the menu lists ' + (Array.isArray(cells) ? cells.length : '?') + ' pages'); process.exit(3) }
  const pickSkin = async (label) => {
    const i = cells.indexOf('Theme')
    await ev(`(() => { const b = document.querySelectorAll('button[class*="navCell"]')[${i}]; if (b) { b.scrollIntoView({ block: 'center' }); b.click() } return true })()`)
    for (let t = 0; t < 8; t += 1) {
      await sleep(1000)
      if (await ev(`(() => { const b = [...document.querySelectorAll('[data-slot="settings.section"] button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true })()`) === true) return true
    }
    return false
  }
  if (SCHEME === 'light') {
    if (await ev('location.port') === '3080') { console.error('○ inconclusive: light mode changes the GUI theme; not on the real DSH (port 3080), use the sandbox'); process.exit(3) }
    if (await pickSkin('Clean light') !== true) { console.error('○ inconclusive: the « Clean light » skin is not on the Theme page'); process.exit(3) }
    await sleep(1500)
    const bg = await ev(`getComputedStyle(document.body).backgroundColor`)
    const lum = String(bg).match(/\d+/g)
    if (lum === null || (Number(lum[0]) + Number(lum[1]) + Number(lum[2])) / 3 < 200) { console.error('○ inconclusive: the page is not light after the skin was picked (' + bg + ')'); process.exit(3) }
  }
  // French last: the skins of the Theme page are named in English until then.
  if (LANG === 'fr') await ev(`window.__KB_LANG_RESOLVE__ = () => 'kybernos'; document.documentElement.lang = 'fr'; true`)
  console.log(`${cells.length} pages · ${WIDTH} px · ${SCHEME} · ${LANG}`)

  const rows = []
  for (let i = 0; i < cells.length; i += 1) {
    if (ONLY !== null && !ONLY.includes(cells[i])) continue
    await ev(`(() => { const b = document.querySelectorAll('button[class*="navCell"]')[${i}]; if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
    await sleep(1700)
    let m = await ev(MEASURE)
    for (let t = 0; t < 3 && m && m.none !== undefined; t += 1) { await sleep(1200); m = await ev(MEASURE) }
    const label = cells[i]
    if (SHOTS !== null) await page.shot(join(SHOTS, `${String(i + 1).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`)).catch(() => {})
    rows.push({ label, m })
  }

  console.log('\nthe title of every page')
  const SKIP = new Set(['IM bots'])
  const measured = rows.filter((r) => r.m && r.m.none === undefined)
  const unmeasured = rows.filter((r) => !r.m || r.m.none !== undefined)
  for (const r of unmeasured) console.log('  ○ ' + r.label + ': ' + (r.m && r.m.none) + ' (not a page that draws a title of its own)')
  const sig = (m) => JSON.stringify(m.style)
  const counts = new Map()
  for (const r of measured) counts.set(sig(r.m), (counts.get(sig(r.m)) || 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (top !== undefined) console.log('  the common look (' + top[1] + ' of ' + measured.length + '): ' + top[0])
  check('a title is found on most pages', measured.length >= 20, measured.length)
  check('every page title has the same family, size, weight, colour, line height and letter spacing', measured.filter((r) => sig(r.m) !== (top && top[0])).length === 0,
    measured.filter((r) => sig(r.m) !== (top && top[0])).map((r) => r.label + ' ' + sig(r.m)))
  // A phone gets Chrome's text boosting (a common factor on every text, 18 px -> 21.24 px): the size is the Settings scale at 18 px, and on a phone one size for all pages (checked above).
  const topSize = top === undefined ? 0 : parseFloat(JSON.parse(top[0]).size)
  check('the size is 18 px (a phone: the same size on every page, never under 18) and the weight 600 (the Settings scale)', top !== undefined && (WIDTH < 700 ? topSize >= 18 && topSize <= 24 : topSize === 18) && JSON.parse(top[0]).weight === '600', top && top[0])
  check('no page puts its button on a row of its own any more (.kbhp-row)', measured.every((r) => r.m.standalone === false))

  console.log('\nthe « ? » of every page')
  const withBtn = measured.filter((r) => r.m.btn !== null)
  const without = measured.filter((r) => r.m.btn === null).map((r) => r.label)
  console.log('  pages with no « ? » next to the title: ' + (without.length === 0 ? 'none' : without.join(', ')))
  check('most pages carry a « ? »', withBtn.length >= 18, withBtn.length)
  const apart = withBtn.filter((r) => r.m.gap === null || r.m.gap < 2 || r.m.gap > 14)
  check('the « ? » follows the last word of the title (2 to 14 px after it)', apart.length === 0, apart.map((r) => r.label + ' gap ' + r.m.gap))
  const off = withBtn.filter((r) => r.m.dy === null || r.m.dy > 5)
  check('...on the same line (its centre within 5 px of the line’s centre)', off.length === 0, off.map((r) => r.label + ' dy ' + r.m.dy))
  const out = withBtn.filter((r) => r.m.inside !== true)
  check('...fully inside the window', out.length === 0, out.map((r) => r.label + ' ' + JSON.stringify(r.m.btn)))
  const wide = measured.filter((r) => r.m.sideways === true)
  check('no page scrolls sideways', wide.length === 0, wide.map((r) => r.label))
  const wraps = measured.filter((r) => r.m.nLines > 1)
  console.log('  titles on more than one line: ' + (wraps.length === 0 ? 'none' : wraps.map((r) => r.label + ' (' + r.m.nLines + ')').join(', ')))

  if (CLICK) {
    console.log('\npressing every « ? »')
    for (const r of withBtn) {
      const i = cells.indexOf(r.label)
      await ev(`(() => { const b = document.querySelectorAll('button[class*="navCell"]')[${i}]; if (b) { b.scrollIntoView({ block: 'center' }); b.click() } return true })()`)
      await sleep(1500)
      const m = await ev(MEASURE)
      if (!m || m.btn === null || m.btn === undefined) { check(r.label + ': the button is there again', false); continue }
      await press(m.btn.x, m.btn.y)
      await sleep(1200)
      // Opening the card must not move the head: the phone's fit script (kybernos-mobile) tags a box that the card overflows and re-lays it out.
      const m2 = await ev(MEASURE)
      const still = m2 && m2.btn && m2.nLines === m.nLines && Math.abs(m2.btn.l - m.btn.l) <= 2 && Math.abs(m2.btn.t - m.btn.t) <= 2
      const card = await ev(`(() => { const p = document.querySelector('.kbhp-pop'); if (!p) return null; const q = p.getBoundingClientRect(); const bt = document.querySelector('[data-kb="help-button"][aria-expanded="true"]'); return { l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom), vw: window.innerWidth, vh: window.innerHeight, dock: p.classList.contains('dock'), expanded: !!bt, text: (p.querySelector('.kbhp-lead') || p.querySelector('p') || { textContent: '' }).textContent.trim().length } })()`)
      const opened = card !== null && card.expanded === true
      const inside = card !== null && card.l >= 0 && card.r <= card.vw && card.t >= 0
      if (SHOTS !== null && opened) await page.shot(join(SHOTS, `card-${String(i + 1).padStart(2, '0')}-${r.label.replace(/[^a-z0-9]+/gi, '_')}.png`)).catch(() => {})
      await key('Escape', 27)
      await sleep(400)
      const after = await ev(`(() => ({ open: !!document.querySelector('.kbhp-pop'), settings: document.querySelectorAll('button[class*="navCell"]').length > 3, focus: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-kb') === 'help-button' }))()`)
      check(r.label + ': the card opens (with its text), stays in the window and leaves the head where it was, Escape closes it and leaves Settings open, the focus is on the button', opened && card.text > 0 && inside && still === true && after.open === false && after.settings === true && after.focus === true, { card, after, still, before: m.btn, now: m2 && m2.btn, lines: [m.nLines, m2 && m2.nLines] })
    }
  }
} finally {
  if (SCHEME === 'light') { try { await ev(`(() => { const i = [...document.querySelectorAll('button[class*="navCell"]')].findIndex((b) => /^Theme/.test((b.innerText || '').trim())); const b = document.querySelectorAll('button[class*="navCell"]')[i]; if (b) b.click(); return true })()`); await sleep(2000); await ev(`(() => { const b = [...document.querySelectorAll('[data-slot="settings.section"] button')].find((x) => (x.getAttribute('aria-label') || '').startsWith('DSH default')); if (b) b.click(); return true })()`); await sleep(800) } catch (e) { /* the sandbox is thrown away */ } }
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
