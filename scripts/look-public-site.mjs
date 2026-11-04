#!/usr/bin/env node
// Looks at the public site for case J01-08 of docs/tests/user-journey: five pages (landing, pricing, download, enterprise, legal)
// x three widths (390, 768, 1440 px) x two languages (en, fr) x two schemes (light, dark) = 60 views. Read only: it loads each page in a
// throw-away headless Chrome, sets the language and the theme in that browser's own storage, measures the page in the page and keeps a
// full-height picture of it. It never clicks, never submits, never downloads.
//
//   node scripts/look-public-site.mjs [--out <dir>] [--base https://kybernos.app] [--pages /,/pricing] [--widths 390,768,1440]
//
// Writes <out>/views/<page>-<width>-<lang>-<scheme>.json (the measures), <out>/full/<same>.jpg (the picture) and <out>/summary.json.
// Exit 0 = the run finished (read the summary), 3 = Chrome or the site could not be reached.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openSite, sleep } from './lib-site-browser.mjs'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const BASE = opt('--base', 'https://kybernos.app').replace(/\/$/, '')
const OUT = opt('--out', join(homedir(), 'kybernos-archive', 'user-journey-2026-11-04', 'ev', 'r5-agents', 'vision-site'))
const PAGES = opt('--pages', '/,/pricing,/download,/enterprise,/legal').split(',').map((p) => [p, p === '/' ? 'landing' : p.slice(1)])
const WIDTHS = opt('--widths', '390,768,1440').split(',').map(Number)
const HEIGHT = { 390: 844, 768: 1024, 1440: 900 }
const LANGS = ['en', 'fr']
const SCHEMES = ['light', 'dark']

// Runs inside the page (stringified and evaluated there): everything it returns is a number, a string or a plain object.
function measureView () {
  const W = window.innerWidth
  const r1 = (n) => Math.round(n * 10) / 10
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r1(r.left), y: r1(r.top + window.scrollY), w: r1(r.width), h: r1(r.height), right: r1(r.right) } }
  const label = (el) => String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 70)
  const shown = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const clipper = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        return { el: p, hidden: /hidden|clip/.test(cs.overflowX + cs.overflowY), scroll: /auto|scroll/.test(cs.overflowX + cs.overflowY) }
      }
    }
    return null
  }
  const parseRGBA = (s) => {
    const m = String(s || '').match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (t, b) => {
    const a = t.a + b.a * (1 - t.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    return { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }
  }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const CTRL = 'a[href],button,[role=button],[role=link],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=combobox],[role=option],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'

  // Right edge beyond the window: top-most elements only, each classed by the nearest clipping ancestor.
  const beyond = []
  const beyondSet = new Set()
  for (const el of document.body.querySelectorAll('*')) {
    if (!shown(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right <= W + 0.5) continue
    let anc = el.parentElement
    let inside = false
    while (anc) { if (beyondSet.has(anc)) { inside = true; break } anc = anc.parentElement }
    if (inside) continue
    beyondSet.add(el)
    const c = clipper(el)
    let kind = 'page'
    if (c && c.scroll) kind = 'scrollArea'
    else if (c && c.hidden) kind = c.el.getBoundingClientRect().right <= W + 0.5 ? 'cutByContainer' : 'pastHiddenContainer'
    beyond.push({ kind, tag: el.tagName.toLowerCase(), label: label(el), box: box(el) })
  }

  // Controls: every visible link, button and other interactive element; under 32 px high or wide is listed.
  const ctrls = [...document.querySelectorAll(CTRL)].filter(shown)
  const small = []
  let offscreen = 0
  for (const el of ctrls) {
    const r = el.getBoundingClientRect()
    if (!(r.right > 0 && r.left < W)) { offscreen += 1; continue }
    if (r.height < 32 || r.width < 32) {
      small.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: label(el) || el.getAttribute('aria-label') || '', under: (r.height < 32 ? 'h' : '') + (r.width < 32 ? 'w' : ''), box: box(el) })
    }
  }

  // Text cut by its own box (overflow hidden), skipping 1-2 px visually hidden helpers.
  const clippedText = []
  for (const el of document.body.querySelectorAll('*')) {
    if (!shown(el)) continue
    const cs = getComputedStyle(el)
    const hidX = /hidden|clip/.test(cs.overflowX)
    const hidY = /hidden|clip/.test(cs.overflowY)
    if (!hidX && !hidY) continue
    if (!el.textContent.trim()) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) continue
    const xo = hidX && el.scrollWidth - el.clientWidth > 1
    const yo = hidY && el.scrollHeight - el.clientHeight > 1
    if (!xo && !yo) continue
    clippedText.push({ tag: el.tagName.toLowerCase(), axis: xo ? 'x' : 'y', ellipsis: cs.textOverflow === 'ellipsis', scroll: [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight], label: label(el), box: box(el) })
  }

  // Cards: visible boxes with a background or border, a radius of 8 px or more, at least 120 x 60 px, with words in them.
  const cards = []
  for (const el of document.body.querySelectorAll('div,section,article,li,a,button')) {
    if (!shown(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 120 || r.height < 60) continue
    const cs = getComputedStyle(el)
    const bg = parseRGBA(cs.backgroundColor)
    const bw = parseFloat(cs.borderTopWidth) || 0
    const rad = parseFloat(cs.borderTopLeftRadius) || 0
    if (!((bg && bg.a > 0) || bw > 0) || rad < 8) continue
    const t = label(el)
    if (!t) continue
    cards.push({ label: t.slice(0, 40), box: box(el), pastWindow: r.right > W + 0.5 })
  }

  // Contrast of every element that has its own words: text colour over the composed background, opacity included.
  let checked = 0
  const low = []
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!own || !shown(el)) continue
    const cs = getComputedStyle(el)
    const fg0 = parseRGBA(cs.color)
    if (!fg0) continue
    const layers = []
    let alpha = fg0.a
    for (let p = el; p; p = p.parentElement) {
      const c = parseRGBA(getComputedStyle(p).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      alpha *= parseFloat(getComputedStyle(p).opacity) || 1
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg)
    const fg = over({ r: fg0.r, g: fg0.g, b: fg0.b, a: alpha }, bg)
    const rv = ratio(fg, bg)
    checked += 1
    if (rv < 4.5) low.push({ tag: el.tagName.toLowerCase(), label: label(el).slice(0, 50), fg: hex(fg), bg: hex(bg), ratio: r1(rv * 100) / 100, size: parseFloat(cs.fontSize), weight: cs.fontWeight, box: box(el) })
  }
  low.sort((a, b) => a.ratio - b.ratio)

  // Overlaps between headings and controls that are not nested in one another, both inside the window.
  const pool = [...document.querySelectorAll('h1,h2,h3,' + CTRL)].filter(shown)
  const pairs = []
  for (let i = 0; i < pool.length; i += 1) {
    const a = pool[i].getBoundingClientRect()
    if (!(a.right > 0 && a.left < W)) continue
    for (let j = i + 1; j < pool.length; j += 1) {
      const b = pool[j].getBoundingClientRect()
      if (!(b.right > 0 && b.left < W)) continue
      if (pool[i].contains(pool[j]) || pool[j].contains(pool[i])) continue
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ix > 2 && iy > 2) pairs.push({ a: label(pool[i]).slice(0, 40), b: label(pool[j]).slice(0, 40), overlapPx: [r1(ix), r1(iy)] })
    }
  }

  const headings = [...document.querySelectorAll('h1,h2,h3')].filter(shown).map((el) => ({ tag: el.tagName.toLowerCase(), label: label(el).slice(0, 80), box: box(el), pastWindow: el.getBoundingClientRect().right > W + 0.5 }))
  const rootBg = (() => { let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const el of [document.documentElement, document.body]) { const c = parseRGBA(getComputedStyle(el).backgroundColor); if (c && c.a > 0) bg = over(c, bg) } return bg })()
  const bodyText = document.body.innerText || ''
  const undef = bodyText.match(/undefined|NaN|\[object |\{\{|%s/g) || []
  const de = document.documentElement
  const cut = (k) => beyond.filter((b) => b.kind === k).length
  return {
    url: location.href, title: document.title, lang: de.lang, dir: de.dir,
    innerW: W, innerH: window.innerHeight, clientW: de.clientWidth, docScrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth, docScrollH: de.scrollHeight,
    sidewaysScroll: de.scrollWidth > de.clientWidth + 0.5,
    rootBg: hex(rootBg), rootLum: r1(lum(rootBg) * 1000) / 1000,
    h1: (document.querySelector('h1') || {}).innerText || null,
    headings: { total: headings.length, pastWindow: headings.filter((h) => h.pastWindow).length, items: headings.slice(0, 60) },
    beyondEdge: { total: beyond.length, page: cut('page'), cutByContainer: cut('cutByContainer'), scrollArea: cut('scrollArea'), pastHiddenContainer: cut('pastHiddenContainer'), items: beyond.slice(0, 40) },
    controls: { total: ctrls.length, offscreen, smallTotal: small.length, under32h: small.filter((s) => s.under.includes('h')).length, under32w: small.filter((s) => s.under.includes('w')).length, items: small.slice(0, 120) },
    clippedText: { total: clippedText.length, noEllipsis: clippedText.filter((c) => !c.ellipsis).length, items: clippedText.slice(0, 40) },
    cards: { total: cards.length, pastWindow: cards.filter((c) => c.pastWindow).length, items: cards.slice(0, 60) },
    contrast: { checked, low: low.length, worst: low.slice(0, 25) },
    overlaps: { total: pairs.length, items: pairs.slice(0, 25) },
    undefinedHits: undef.length, undefinedSample: undef.slice(0, 5)
  }
}

async function fullPicture (s, width, height, file) {
  const lm = (await s.page.send('Page.getLayoutMetrics', {})).result || {}
  const size = lm.cssContentSize || lm.contentSize || { height: 900 }
  const h = Math.min(Math.ceil(size.height), 14000)
  const r = (await s.page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } })).result
  if (!r || !r.data) return { ok: false, height: h }
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  return { ok: true, height: h }
}

const pct = (n) => String(n).padStart(3)
async function main () {
  mkdirSync(join(OUT, 'views'), { recursive: true })
  mkdirSync(join(OUT, 'full'), { recursive: true })
  const summary = []
  for (const width of WIDTHS) {
    let s
    try { s = await openSite({ width, height: HEIGHT[width] || 900 }) } catch (e) { console.error('no browser: ' + e.message); process.exit(3) }
    const errs = []
    s.page.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errs.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 200)) })
    try {
      await s.goto(BASE + '/', { quiet: 800 })
    } catch (e) { console.error('site unreachable: ' + e.message); s.close(); process.exit(3) }
    for (const lang of LANGS) {
      for (const scheme of SCHEMES) {
        await s.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
        await s.evalJs(`(() => { localStorage.setItem('kybernos-language-v2', ${JSON.stringify(lang)}); localStorage.setItem('kybernos-theme-mode', ${JSON.stringify(scheme)}); return 1 })()`)
        for (const [path, slug] of PAGES) {
          const name = `${slug}-${width}-${lang}-${scheme}`
          const errStart = errs.length
          const dlStart = s.downloads.length
          let m
          try {
            await s.goto(BASE + path, { quiet: 800, max: 25000 })
            await sleep(500)
            await s.evalJs('document.fonts ? document.fonts.ready.then(() => 1) : 1', 10000).catch(() => 1)
            m = await s.evalJs('(' + measureView.toString() + ')()', 60000)
          } catch (e) {
            m = { error: String(e.message || e).slice(0, 300) }
          }
          const pic = m.error ? { ok: false } : await fullPicture(s, Math.min(Math.max(m.innerW, m.docScrollW), 2000), m.innerH, join(OUT, 'full', name + '.jpg'))
          const doc = { case: 'J01-08', page: path, slug, width, height: HEIGHT[width], lang, scheme, pictureHeight: pic.height || null, console: errs.slice(errStart), downloadsRefused: s.downloads.length - dlStart, measures: m }
          writeFileSync(join(OUT, 'views', name + '.json'), JSON.stringify(doc, null, 2))
          if (m.error) { summary.push({ name, error: m.error }); console.log('ERR   ' + name + ' ' + m.error); continue }
          const schemeApplied = (scheme === 'dark') === (m.rootLum < 0.2)
          const row = {
            name, url: m.url, title: m.title, lang: m.lang, schemeApplied, rootBg: m.rootBg, innerW: m.innerW,
            sidewaysScroll: m.sidewaysScroll, docScrollW: m.docScrollW,
            beyondPage: m.beyondEdge.page, beyondCut: m.beyondEdge.cutByContainer, beyondScrollArea: m.beyondEdge.scrollArea, beyondPastHidden: m.beyondEdge.pastHiddenContainer,
            controls: m.controls.total, under32h: m.controls.under32h, under32w: m.controls.under32w,
            clippedText: m.clippedText.noEllipsis, cardsPastWindow: m.cards.pastWindow, headingsPastWindow: m.headings.pastWindow,
            lowContrast: m.contrast.low, contrastChecked: m.contrast.checked, overlaps: m.overlaps.total, undefinedHits: m.undefinedHits,
            consoleErrors: doc.console.length, downloadsRefused: doc.downloadsRefused
          }
          summary.push(row)
          console.log(`${name.padEnd(28)} side=${m.sidewaysScroll ? 'YES' : 'no '} beyond p${pct(m.beyondEdge.page)}/c${pct(m.beyondEdge.cutByContainer)}/s${pct(m.beyondEdge.scrollArea)} small h${pct(m.controls.under32h)}/w${pct(m.controls.under32w)} of ${pct(m.controls.total)} clip=${pct(m.clippedText.noEllipsis)} lowC=${pct(m.contrast.low)}/${pct(m.contrast.checked)} ovl=${pct(m.overlaps.total)} undef=${m.undefinedHits} err=${doc.console.length} scheme=${schemeApplied ? 'ok' : 'NOT-APPLIED'} root=${m.rootBg}`)
        }
      }
    }
    await s.close()
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ case: 'J01-08', base: BASE, generated: new Date().toISOString(), views: summary }, null, 2))
  console.log('wrote ' + join(OUT, 'summary.json') + ' (' + summary.length + ' views)')
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(3) })
