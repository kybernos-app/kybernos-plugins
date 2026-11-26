#!/usr/bin/env node
// The new-chat page and Settings under the conditions a display sweep at two sizes does not cover (case J18-10): page zoom 200 percent, reduced motion, a 2560 px window and a very small
// window (320 x 480). For every page it walks, in every condition, it measures (no opinion):
//   - hOverflow     the page scrolls sideways (document wider than the window);
//   - unreachable   a control that sits outside the window or is cut by a box that does not scroll, so a person can neither see nor press all of it;
//   - covered       a control whose centre is covered by another element (it cannot be pressed there);
//   - cut           text that overflows its own box with no ellipsis and no way to read it in full (no title);
//   - ellipsis      text shortened with an ellipsis and no title or label to read it in full;
//   - overlaps      two controls that cover each other over more than a fifth of the smaller one;
//   - animations    animations still running, with the media query reported back by the page (under reduced motion every infinite one is a finding).
//
//   source scripts/sandbox/env.sh && node scripts/check-display-conditions-live.mjs --out <dir> [--only base,zoom200] [--pages 40]
//
// Conditions: base (1400 x 900), zoom200 (a 1440 x 900 window at 200 percent: a 720 x 450 layout window at device scale 2, which is what the browser does), reduced (1400 x 900 with
// prefers-reduced-motion: reduce), wide (2560 x 1440), tiny (320 x 480). The window is emulated over CDP in a throw-away browser; nothing of the DSH changes.
// Refuses :3080 and any home that is not a sandbox's. Exit code 0 (it measures), 3 = wrong environment.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', null)
const ONLY = argOf('--only', null) === null ? null : argOf('--only', '').split(',')
const MAX_PAGES = Number(argOf('--pages', '60'))
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080' || (process.env.DSH_HOME || '').indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }
if (OUT === null) { console.error('usage: --out <dir>'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CONDITIONS = [
  { id: 'base', w: 1400, h: 900, scale: 1, motion: 'no-preference' },
  { id: 'zoom200', w: 720, h: 450, scale: 2, motion: 'no-preference', note: 'a 1440 x 900 window at 200 percent zoom' },
  { id: 'reduced', w: 1400, h: 900, scale: 1, motion: 'reduce' },
  { id: 'wide', w: 2560, h: 1440, scale: 1, motion: 'no-preference' },
  { id: 'tiny', w: 320, h: 480, scale: 1, motion: 'no-preference' },
].filter((c) => ONLY === null || ONLY.includes(c.id))

// ── the in-page measure ─────────────────────────────────────────────────────────────────────────────────────────
function measure (rootHint) {
  const vw = window.innerWidth; const vh = window.innerHeight
  let root = document.body
  if (rootHint === 'settings') {
    // Settings is a layer over the whole window: measure that layer, not the page behind it (whose controls it covers on purpose).
    const cell = document.querySelector('button[class*="navCell"]')
    for (let e = cell; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const r = e.getBoundingClientRect()
      if (r.width >= vw * 0.95 && r.height >= vh * 0.9) { root = e; break }
    }
  }
  const label = (el) => {
    const c = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return el.tagName.toLowerCase() + (el.getAttribute('data-kb') ? '[' + el.getAttribute('data-kb') + ']' : '') + (c ? '.' + c : '') + (t ? ' "' + t + '"' : '')
  }
  const cs = (el) => getComputedStyle(el)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = cs(e)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false
      if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('inert') || e.hidden) return false
    }
    return true
  }
  const docX = document.scrollingElement.scrollWidth > vw + 1
  const docY = document.scrollingElement.scrollHeight > vh + 1
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=option], [contenteditable=true]'
  const ctl = [...root.querySelectorAll(INTERACTIVE)].filter(visible)
  const out = { vw, vh, controls: ctl.length, hOverflow: docX, docW: document.scrollingElement.scrollWidth, unreachable: [], covered: [], cut: [], ellipsis: [], overlaps: [], animations: [], reducedMatches: matchMedia('(prefers-reduced-motion: reduce)').matches, dpr: window.devicePixelRatio }
  const clipped = (el) => {
    // What a person can see of this control: the window and every ancestor that hides what leaves it without letting it scroll.
    const r = el.getBoundingClientRect()
    let x0 = r.left; let x1 = r.right; let y0 = r.top; let y1 = r.bottom
    const area = r.width * r.height
    const clip = (b, ox, oy) => { if (ox) { x0 = Math.max(x0, b.left); x1 = Math.min(x1, b.right) } if (oy) { y0 = Math.max(y0, b.top); y1 = Math.min(y1, b.bottom) } }
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const s = cs(e); const b = e.getBoundingClientRect()
      const hid = (v) => v === 'hidden' || v === 'clip'
      clip(b, hid(s.overflowX), hid(s.overflowY))
      // an ancestor that scrolls can bring the control into view: from there on only the horizontal/vertical axis that does not scroll counts
      const sx = (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1
      const sy = (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1
      if (sx || sy) return { scrolls: true, shown: 1 }
    }
    if (!docX) { x0 = Math.max(x0, 0); x1 = Math.min(x1, vw) }
    if (!docY) { y0 = Math.max(y0, 0); y1 = Math.min(y1, vh) }
    const shown = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
    return { scrolls: false, shown: area === 0 ? 1 : shown / area }
  }
  for (const el of ctl) {
    const c = clipped(el)
    if (c.shown < 0.6) out.unreachable.push({ el: label(el), shown: Math.round(c.shown * 100) + '%', rect: (({ left, top, width, height }) => [left, top, width, height].map(Math.round))(el.getBoundingClientRect()) })
    const r = el.getBoundingClientRect()
    if (c.shown >= 0.6 && r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(top)))) out.covered.push({ el: label(el), by: label(top) })
    }
  }
  // overlaps between controls (neither inside the other)
  const rects = ctl.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.right > 0 && x.r.left < vw && x.r.bottom > 0 && x.r.top < vh)
  for (let i = 0; i < rects.length && out.overlaps.length < 12; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (w <= 1 || h <= 1) continue
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
      if (w * h > small * 0.2) out.overlaps.push({ a: label(a.el), b: label(b.el), share: Math.round(w * h / small * 100) + '%' })
    }
  }
  // cut and shortened text
  const texty = [...root.querySelectorAll('*')].filter((el) => el.children.length <= 3 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '') && visible(el))
  for (const el of texty) {
    const s = cs(el)
    const over = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2
    if (!over) continue
    const hidden = (v) => v === 'hidden' || v === 'clip'
    if (!(hidden(s.overflowX) || hidden(s.overflowY))) continue
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') continue
    const readable = el.getAttribute('title') || el.getAttribute('aria-label') || (el.closest('[title]') !== null)
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || (s.display === '-webkit-box')) { if (!readable) out.ellipsis.push(label(el)) } else if (!readable) out.cut.push({ el: label(el), scroll: [el.scrollWidth, el.scrollHeight], box: [el.clientWidth, el.clientHeight] })
  }
  out.cut = out.cut.slice(0, 12); out.ellipsis = out.ellipsis.slice(0, 12); out.unreachable = out.unreachable.slice(0, 15); out.covered = out.covered.slice(0, 12)
  out.counts = { unreachable: out.unreachable.length, covered: out.covered.length, cut: out.cut.length, ellipsis: out.ellipsis.length, overlaps: out.overlaps.length }
  // animations that are running now
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}
    const tg = a.effect && a.effect.target
    out.animations.push({ name: a.animationName || a.transitionProperty || a.constructor.name, kind: a.constructor.name, duration: t.duration, iterations: t.iterations === Infinity ? 'infinite' : t.iterations, target: tg ? label(tg) : null })
  }
  out.animations = out.animations.slice(0, 20)
  const videos = [...document.querySelectorAll('video')].filter((v) => !v.paused && visible(v)).length
  out.playingVideos = videos
  return out
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const apply = async (c) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: c.w, height: c.h, deviceScaleFactor: c.scale, mobile: false })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: c.motion }] })
}
const measureHere = async (rootHint) => {
  const r = await val(`(${measure.toString()})(${JSON.stringify(rootHint || null)})`, 30000)
  return r && r.__err ? { error: r.__err } : r
}
const report = { when: new Date().toISOString(), host, conditions: {} }
const SETTINGS_ROOT = '[class*="navCell"]'
for (const c of CONDITIONS) {
  console.log('\n── ' + c.id + ' ' + c.w + 'x' + c.h + (c.scale !== 1 ? ' @' + c.scale + 'x' : '') + (c.motion === 'reduce' ? ' reduced motion' : '') + ' ──')
  const rec = { cond: c, pages: {} }
  report.conditions[c.id] = rec
  try {
    await apply(c)
    await page.send('Page.navigate', { url: 'http://' + host + '/' })
    await sleep(6000)
    await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
    await sleep(2500)
    // new chat page
    const chat = await measureHere(null)
    rec.pages['new-chat'] = chat
    await page.shot(join(OUT, 'shots', c.id + '-new-chat.png')).catch(() => {})
    console.log('new chat'.padEnd(34), line(chat))
    // settings
    const ok = await openSettings(page, { tries: 3 })
    if (!ok) { rec.pages.settings = { error: 'Settings did not open' }; console.log('settings did not open'); continue }
    await sleep(1200)
    const cells = await val(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map((b) => (b.innerText || '').trim().split('\\n')[0]).filter(Boolean))`)
    const names = typeof cells === 'string' ? JSON.parse(cells) : []
    rec.settingsPages = names.length
    const hub = await measureHere('settings')
    rec.pages['settings (menu)'] = hub
    await page.shot(join(OUT, 'shots', c.id + '-settings.png')).catch(() => {})
    console.log('settings (menu, ' + names.length + ' cells)'.padEnd(34), line(hub))
    for (const name of names.slice(0, MAX_PAGES)) {
      const there = await goToSettingsPage(page, name, { settleMs: 900, tries: 2 })
      if (!there) { rec.pages['settings: ' + name] = { error: 'cell not pressable' }; console.log(('settings: ' + name).padEnd(34).slice(0, 34), 'cell not pressable'); continue }
      await sleep(500)
      const m = await measureHere('settings')
      rec.pages['settings: ' + name] = m
      console.log(('settings: ' + name).padEnd(34).slice(0, 34), line(m))
    }
  } catch (e) {
    rec.error = String(e && e.message || e)
    console.log('the condition stopped: ' + rec.error)
  }
}
function line (m) {
  if (!m || m.error) return 'ERROR ' + (m && m.error)
  const run = m.animations.filter((a) => a.iterations === 'infinite').length
  return `vw ${m.vw} controls ${m.controls} | hOverflow ${m.hOverflow ? 'YES (' + m.docW + ')' : 'no'} | unreachable ${m.counts.unreachable} covered ${m.counts.covered} cut ${m.counts.cut} ellipsis ${m.counts.ellipsis} overlaps ${m.counts.overlaps} | running animations ${m.animations.length} (infinite ${run}) | reduce matches ${m.reducedMatches}`
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
await live.close()
console.log('\nreport: ' + join(OUT, 'report.json'))
process.exit(0)
