// A display sweep of the real GUI: contrast, clipping, cut labels, layout jumps, in dark, light and the Neutral
// violet theme, on a desktop window and at 390 px (the width kybernos-mobile lays out for).
//
//   source scripts/sandbox/env.sh && node scripts/check-display-live.mjs --out /tmp/display-audit
//   node scripts/check-display-live.mjs --out /tmp/da --sizes narrow --schemes dark,neutre --only home,settings
//   node scripts/check-display-live.mjs --out /tmp/da --only settings --cells "AI Provider,Tools"   (just those Settings sections)
//
// What is measured, on every page, popover and drawer it can reach (by real clicks):
//  - contrast: the WCAG ratio of each visible text, input value, placeholder and small icon against its effective
//    background (every ancestor layer composited, opacity groups included, gradients taken at their worst stop);
//    4.5:1 (3:1 for large text and icons);
//  - clipping: a visible box that leaves the box that really contains it (containing-block chain, so an absolutely
//    positioned popover is not blamed on a static overflow:hidden parent), or the viewport, with no scrolling to
//    reach it;
//  - cut labels: text that overflows its own overflow:hidden box with no title or aria-label to read it in full;
//  - layout jumps: layout-shift entries not caused by the person's own click.
// Every offender is outlined on a screenshot and written to <out>/report.json with a selector.
//
// It refuses to run against :3080: it clicks, it switches DSH's theme mode and it fakes an account answer inside the
// page. Use the isolated instance (scripts/sandbox, docs/dev/live-testing.md). The account, the phone link and the
// notification states are answered INSIDE the page (CDP Fetch), so no server is ever called. Not run by CI.
// Exit 0 (it measures), 1 with --strict when something fails or a view was skipped, 3 when it could not run. Every view it could not reach is listed as
// « SKIPPED: <size/scheme/scenario> — <why> » at the end.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const OUT = argOf('--out', join(tmpdir(), 'kb-display-audit-' + Date.now()))
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
const SIZES = list(argOf('--sizes', 'desktop,narrow'))
const SCHEMES = list(argOf('--schemes', 'dark,light,neutre'))
const ONLY = argOf('--only', null) === null ? null : list(argOf('--only', ''))
const CELLS = argOf('--cells', null) === null ? null : list(argOf('--cells', '')).map((x) => x.toLowerCase()) // only these Settings sections (substring)
const STRICT = args.includes('--strict')
const DIMENSIONS = { desktop: { w: 1400, h: 900 }, narrow: { w: 390, h: 844 } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ not run: refusing :3080 — this check clicks and fakes answers; use scripts/sandbox (KB_HOST)'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })

// ── the in-page audit (runs inside DSH; no outer scope) ─────────────────────────────────────────────────────────
function auditInPage(opts) {
  const out = { contrast: [], clipped: [], truncated: [], samples: 0, unknownBg: 0, boxes: 0, doc: null }
  const csCache = new Map()
  const cs = (el) => { let c = csCache.get(el); if (c === undefined) { c = getComputedStyle(el); csCache.set(el, c) } return c }
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const colCache = new Map()
  const toRgba = (s) => {
    if (colCache.has(s)) return colCache.get(s)
    let r = null
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
    const al = (v) => (v === undefined ? 1 : (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)))
    if (m) r = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), al(m[4])]
    if (r === null) { m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s); if (m) r = [parseFloat(m[1]) * 255, parseFloat(m[2]) * 255, parseFloat(m[3]) * 255, al(m[4])] }
    if (r === null) { // another colour space: paint over white and over black, solve for alpha
      const paint = (bg) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = bg; cx.fillRect(0, 0, 1, 1); cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data }
      const w = paint('#fff'), b = paint('#000')
      const a = Math.min(1, Math.max(0, 1 - (w[0] - b[0]) / 255))
      r = a === 0 ? [0, 0, 0, 0] : [b[0] / a, b[1] / a, b[2] / a, a]
    }
    colCache.set(s, r)
    return r
  }
  const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a).concat([a]) }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('') + (c[3] < 0.995 ? '/' + c[3].toFixed(2) : '')
  const VW = window.innerWidth, VH = window.innerHeight
  const breaksOut = (st) => st.transform !== 'none' || st.filter !== 'none' || st.perspective !== 'none' || (st.backdropFilter && st.backdropFilter !== 'none') || /paint|layout|strict|content/.test(st.contain) || /transform|filter/.test(st.willChange)
  const containing = (el) => {
    const pos = cs(el).position
    if (pos === 'fixed') { for (let a = el.parentElement; a; a = a.parentElement) { if (breaksOut(cs(a))) return a } return null }
    if (pos === 'absolute') { for (let a = el.parentElement; a; a = a.parentElement) { const s = cs(a); if (s.position !== 'static' || breaksOut(s)) return a } return null }
    return el.parentElement
  }
  const sel = (el) => {
    const parts = []
    let n = el
    for (let i = 0; n && i < 3 && n !== document.body && n.nodeType === 1; i += 1, n = n.parentElement) {
      let s = n.tagName.toLowerCase()
      const kb = n.getAttribute('data-kb') || n.getAttribute('data-slot')
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
      if (kb) s += '[data-kb="' + kb + '"]'; else if (n.id) s += '#' + n.id; else if (cls) s += '.' + cls
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  const INTERACTIVE = 'button,a[href],input,select,textarea,summary,[role=button],[role=menuitem],[role=tab],[role=option],[role=switch],[role=checkbox],[role=radio],[tabindex]'
  const cumOpacity = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(cs(n).opacity); return o }
  // Colour seen at an element: composited from the outermost ancestor inward; an opacity group is blended as a whole.
  const stack = (chain, j, top, sub) => {
    const n = chain[j], s = cs(n)
    let own = toRgba(s.backgroundColor)
    if (sub !== null && sub.node === n) own = sub.col
    let c = over(j + 1 < chain.length ? stack(chain, j + 1, top, sub) : top, own)
    const op = parseFloat(s.opacity)
    if (op < 1) c = [c[0], c[1], c[2], c[3] * op]
    return c
  }
  const stops = (n) => {
    const bi = cs(n).backgroundImage
    if (!bi || bi === 'none') return null
    if (/url\(/.test(bi) && !/gradient/.test(bi)) return 'image'
    const f = bi.match(/rgba?\([^)]*\)|color\([^)]*\)/g)
    return f && f.length > 0 ? f.slice(0, 8) : 'image'
  }
  const measure = (el, fgs, masked) => { // the best of several candidate foregrounds, at the worst background stop
    const chain = []
    for (let n = el; n; n = n.parentElement) chain.unshift(n)
    let variants = [null]
    for (const n of chain) { const g = n === el && masked === true ? null : stops(n); if (g === 'image') return { unknown: true }; if (g !== null) { variants = g.map((c) => ({ node: n, col: toRgba(c) })); break } }
    if (masked === true && variants[0] === null) variants = [{ node: el, col: [0, 0, 0, 0] }] // a CSS-mask glyph: its own fill is the ink, not a background
    let best = null
    for (const fg of fgs) {
      let worst = null
      for (const v of variants) {
        const bg = over(stack(chain, 0, [0, 0, 0, 0], v), [255, 255, 255, 1])
        const wt = over(stack(chain, 0, fg, v), [255, 255, 255, 1])
        const r = ratio(wt, bg)
        if (worst === null || r < worst.r) worst = { r, fg: wt, bg, grad: v !== null }
      }
      if (best === null || worst.r > best.r) best = worst
    }
    return best
  }
  const measureBg = (el) => { // the plain background seen behind an element (null with an image or a gradient)
    const chain = []
    for (let n = el; n; n = n.parentElement) chain.unshift(n)
    for (const n of chain) if (stops(n) !== null) return null
    return over(stack(chain, 0, [0, 0, 0, 0], null), [255, 255, 255, 1])
  }
  const topAt = (el, r) => {
    if (r.right < 0 || r.bottom < 0 || r.left > VW || r.top > VH) return true
    const t = document.elementFromPoint(Math.min(VW - 1, Math.max(0, r.left + r.width / 2)), Math.min(VH - 1, Math.max(0, r.top + r.height / 2)))
    return !t || t === el || el.contains(t) || t.contains(el)
  }
  const isLarge = (s) => { const px = parseFloat(s.fontSize), w = parseInt(s.fontWeight, 10) || 400; return px >= 24 || (px >= 18.66 && w >= 700) }
  const seen = new Set()
  const rectOf = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
  const push = (el, text, fgs, kind, need, masked) => {
    const r = el.getBoundingClientRect()
    const s = cs(el)
    if (s.visibility !== 'visible' || cumOpacity(el) < 0.06 || !topAt(el, r)) return
    out.samples += 1
    const m = measure(el, fgs, masked)
    if (m.unknown === true) { out.unknownBg += 1; return }
    if (m.r >= need) return
    const key = kind + '|' + sel(el) + '|' + text.slice(0, 30)
    if (seen.has(key)) return
    seen.add(key)
    out.contrast.push({ kind, sel: sel(el), text: text.slice(0, 60), ratio: Math.round(m.r * 100) / 100, need, fg: hex(m.fg), bg: hex(m.bg), size: s.fontSize, rect: rectOf(r), grad: m.grad === true, disabled: !!el.closest('[disabled],[aria-disabled="true"]') })
  }
  const hitsMap = new Map()
  const all = Array.from(document.body.querySelectorAll('*'))
  out.boxes = all.length
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|OPTGROUP|BR|WBR)$/
  for (const el of all.slice(0, 14000)) {
    if (SKIP.test(el.tagName)) continue
    const isSvg = el.tagName.toLowerCase() === 'svg'
    if (!isSvg && el.closest('svg') !== null) continue
    if (el.parentElement !== null && el.parentElement.closest('[role="img"]') !== null) continue // an illustration, not copy
    const s = cs(el)
    if (s.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    let own = ''
    for (const nd of el.childNodes) if (nd.nodeType === 3) own += nd.textContent
    own = own.replace(/\s+/g, ' ').trim()
    if (own !== '' && !/^[⟦⟧\s]+$/.test(own)) {
      const fg = toRgba(s.getPropertyValue('-webkit-text-fill-color') || s.color)
      if (fg[3] > 0) push(el, own, [fg], 'text', isLarge(s) ? 3 : 4.5)
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (!/^(checkbox|radio|range|color|file|hidden|image)$/.test(type)) {
        if (el.value) push(el, String(el.value), [toRgba(s.color)], 'value', isLarge(s) ? 3 : 4.5)
        else if (el.placeholder) push(el, el.placeholder, [toRgba(getComputedStyle(el, '::placeholder').color)], 'placeholder', isLarge(s) ? 3 : 4.5)
      }
    }
    const maskImg = s.getPropertyValue('mask-image') || s.getPropertyValue('-webkit-mask-image')
    if (maskImg && maskImg !== 'none' && r.width <= 48 && r.height <= 48) { // a CSS-mask glyph: the ink is its background colour
      const ink = toRgba(s.backgroundColor)
      if (ink[3] > 0) push(el, 'icon (mask) ' + (el.getAttribute('aria-label') || ''), [ink], 'icon', 3, true)
    } else if (isSvg && r.width <= 48 && r.height <= 48 && !(toRgba(s.backgroundColor)[3] > 0 && s.getPropertyValue('-webkit-mask-image') !== 'none')) { // an icon: its shapes' paint, 3:1 (the best paint of the icon)
      const paints = []
      const take = (st) => { for (const p of [st.stroke, st.fill]) { if (p && p !== 'none' && !/url\(/.test(p)) { const c = toRgba(p); if (c[3] > 0) paints.push(c) } } }
      const shapes = Array.from(el.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse')).slice(0, 6)
      if (shapes.length === 0) take(s); else shapes.forEach((k) => take(cs(k)))
      if (paints.length > 0) push(el, 'icon ' + (el.getAttribute('aria-label') || el.parentElement.getAttribute('aria-label') || ''), paints, 'icon', 3)
    }
    // Clipping: against the boxes that really contain it.
    const meaningful = own !== '' || el.matches(INTERACTIVE) || isSvg || /^(IMG|CANVAS|VIDEO)$/.test(el.tagName) || toRgba(s.backgroundColor)[3] > 0.05 || (parseFloat(s.borderTopWidth) > 0 && toRgba(s.borderTopColor)[3] > 0.05)
    if (meaningful && r.width > 2 && r.height > 2 && s.visibility === 'visible' && cumOpacity(el) > 0.06) {
      let fixed = s.position === 'fixed', bx = false, by = false
      const vis = { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(VW, r.right), b: Math.min(VH, r.bottom) } // what is left to see
      const hits = []
      let a = containing(el), guard = 0
      while (a !== null && guard++ < 60) {
        if (a === document.body || a === document.documentElement) break
        const as = cs(a)
        if (as.position === 'fixed') fixed = true
        const ox = as.overflowX, oy = as.overflowY
        if (ox !== 'visible' || oy !== 'visible') {
          const ar = a.getBoundingClientRect()
          const L = ar.left + a.clientLeft, T = ar.top + a.clientTop, R = L + a.clientWidth, B = T + a.clientHeight
          if (ox !== 'visible') { vis.l = Math.max(vis.l, L); vis.r = Math.min(vis.r, R) }
          if (oy !== 'visible') { vis.t = Math.max(vis.t, T); vis.b = Math.min(vis.b, B) }
          if (ox !== 'visible' && !bx) {
            if (ox === 'auto' || ox === 'scroll') bx = true
            else {
              if (r.left < L - 1 && r.right > L) hits.push({ side: 'left', by: Math.round(L - r.left), clip: a })
              if (r.right > R + 1 && r.left < R) hits.push({ side: 'right', by: Math.round(r.right - R), clip: a })
            }
          }
          if (oy !== 'visible' && !by) {
            if (oy === 'auto' || oy === 'scroll') by = true
            else {
              if (r.top < T - 1 && r.bottom > T) hits.push({ side: 'top', by: Math.round(T - r.top), clip: a })
              if (r.bottom > B + 1 && r.top < B) hits.push({ side: 'bottom', by: Math.round(r.bottom - B), clip: a })
            }
          }
        }
        a = containing(a)
        if (a !== null && cs(a).position === 'fixed') fixed = true
      }
      if (!bx) {
        if (r.left < -1 && r.right > 0) hits.push({ side: 'left', by: Math.round(-r.left), clip: null })
        if (r.right > VW + 1 && r.left < VW) hits.push({ side: 'right', by: Math.round(r.right - VW), clip: null })
      }
      if (!by && fixed) {
        if (r.top < -1 && r.bottom > 0) hits.push({ side: 'top', by: Math.round(-r.top), clip: null })
        if (r.bottom > VH + 1 && r.top < VH) hits.push({ side: 'bottom', by: Math.round(r.bottom - VH), clip: null })
      }
      // Only what can be seen: a box fully hidden is a collapsed panel, one under a dialog is not on screen.
      // A deliberate crop is not a defect: a thumbnail or preview, and inline text under an ellipsis that says it was cut.
      const crop = /thumb|prev(iew)?\b|snippet|poster|skeleton|shimmer/i
      const cropped = (n) => crop.test(typeof n.className === 'string' ? n.className : '') || crop.test(n.getAttribute('data-kb') || '')
      const intentional = (h) => {
        for (let n = h.clip || el; n && n !== document.body; n = n.parentElement) { if (cropped(n)) return true }
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (cropped(n)) return true }
        return h.clip !== null && (h.side === 'left' || h.side === 'right') && cs(h.clip).textOverflow === 'ellipsis' && s.display.startsWith('inline')
      }
      for (let i = hits.length - 1; i >= 0; i -= 1) { if (intentional(hits[i])) hits.splice(i, 1) }
      if (hits.length > 0 && vis.r - vis.l >= 1 && vis.b - vis.t >= 1 && topAt(el, { left: vis.l, top: vis.t, right: vis.r, bottom: vis.b, width: vis.r - vis.l, height: vis.b - vis.t })) hitsMap.set(el, hits)
    }
    // A switch or checkbox: its knob (or tick) must stand out from its track, or the state is only a position.
    if (el.matches('[role="switch"],[role="checkbox"],[aria-checked],[class*="switch" i],[class*="toggle" i],[class*="-sw" i]') && r.width >= 14 && r.width <= 90 && r.height >= 10 && r.height <= 40 && s.visibility === 'visible' && cumOpacity(el) > 0.06 && topAt(el, r)) {
      const track = measureBg(el)
      const parts = []
      for (const k of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 4)]) {
        for (const ps of [null, '::before', '::after']) {
          const ks = ps === null ? cs(k) : getComputedStyle(k, ps)
          if (ps !== null && (ks.content === 'none' || ks.content === 'normal')) continue
          if (k === el && ps === null) continue
          const c = toRgba(ks.backgroundColor)
          if (c[3] >= 0.5 && (parseFloat(ks.borderRadius) > 2 || /%/.test(ks.borderRadius))) parts.push(c)
        }
      }
      if (track !== null && parts.length > 0) {
        const knob = over(parts[0], track)
        const q = ratio(knob, track)
        if (q < 2) out.contrast.push({ kind: 'switch', sel: sel(el), text: 'knob on ' + (el.getAttribute('aria-checked') || '?'), ratio: Math.round(q * 100) / 100, need: 3, fg: hex(knob), bg: hex(track), size: '', rect: rectOf(r), grad: false, disabled: !!el.closest('[disabled],[aria-disabled="true"]') })
      }
    }
    // A label cut with no way to read it.
    if (own !== '' && (s.overflowX === 'hidden' || s.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.visibility === 'visible') {
      let titled = false
      for (let n = el, i = 0; n && i < 4; n = n.parentElement, i += 1) if (n.getAttribute('title') || n.getAttribute('aria-label')) { titled = true; break }
      out.truncated.push({ sel: sel(el), text: own.slice(0, 60), need: el.scrollWidth, have: el.clientWidth, titled, rect: rectOf(r) })
    }
  }
  for (const [el, hits] of hitsMap) { // the outermost cut box only: its children are cut by the same amount
    const ph = el.parentElement ? hitsMap.get(el.parentElement) : undefined
    if (ph && ph.some((p) => hits.some((h) => h.clip === p.clip && h.side === p.side))) continue
    const r = el.getBoundingClientRect()
    for (const h of hits) out.clipped.push({ sel: sel(el), side: h.side, by: h.by, clip: h.clip === null ? 'viewport' : sel(h.clip), text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50), rect: rectOf(r) })
  }
  const de = document.documentElement
  out.doc = { scrollW: de.scrollWidth, clientW: de.clientWidth, vw: VW, vh: VH }
  return out
}

// ── driving the page ────────────────────────────────────────────────────────────────────────────────────────────
const fake = { cloud: null, remote: null, onboarding: false }
const jsonBody = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const CLOUD = { ok: true, connected: true, state: { user: { email: 'dev@example.test', name: 'Dev Person', plan: 'plus' }, plan: 'plus', workspaces: [{ id: 'ws-1', name: 'Personal', kyber_count: 2 }, { id: 'ws-2', name: 'Studio team with a rather long name', kyber_count: 5 }], active_workspace_id: 'ws-1', web_url: 'https://dev.kybernos.app', device_label: 'This computer' } }
const QR = { size: 21, modules: Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x * 7 + y * 13 + x * y) % 3 === 0 ? '1' : '0')).join('')) }
const REMOTE = {
  idle: { ok: true, available: true, configured: true, connected: true, entitled: true, pairing: null, devices: [] },
  qr: () => ({ ok: true, available: true, configured: true, connected: true, entitled: true, pairing: { state: 'qr', expires_at: Date.now() + 240000, qr: QR, url: 'https://phone.example.test/p/abc' }, devices: [] }),
  verify: () => ({ ok: true, available: true, configured: true, connected: true, entitled: true, pairing: { state: 'verify', sas: '4821', phone_label: 'Pixel 9', verify_until: Date.now() + 90000 }, devices: [] }),
  devices: { ok: true, available: true, configured: true, connected: true, entitled: true, relay: 'up', pairing: null, refused: 2, devices: [{ id: 'd1', label: 'Pixel 9 (a long phone name that has to wrap somewhere)', online: true }, { id: 'd2', label: 'iPhone', online: false, last_seen_at: Date.now() - 7200000 }, { id: 'd3', label: 'Old tablet', state: 'locked' }] },
  paywall: { ok: true, available: true, configured: true, connected: true, entitled: false, pairing: null, devices: [] },
}

async function interceptor(page) {
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-cloud/status*' }, { urlPattern: '*kybernos-mobile/remote/*' }, { urlPattern: '*kybernos/onboarding*' }] })
  page.on('Fetch.requestPaused', (p) => {
    const url = p.request.url
    let body = null
    if (/kybernos\/onboarding/.test(url) && fake.onboarding === true) body = p.request.method === 'GET' ? { ok: true, completed: false, version: 1, installedAt: null, completedAt: null, profil: null, uiMode: null, model: null, lang: null } : { ok: true }
    if (body !== null) { /* the onboarding answer above */ }
    else if (/kybernos-cloud\/status/.test(url) && fake.cloud !== null) body = fake.cloud
    else if (/kybernos-mobile\/remote\//.test(url) && fake.remote !== null) body = typeof fake.remote === 'function' ? fake.remote() : fake.remote
    if (body === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: jsonBody(body) })
  })
}

const RECORD_SHIFTS = `(() => { window.__kbShifts = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__kbShifts.push({ v: Math.round(e.value * 1000) / 1000, input: e.hadRecentInput, src: (e.sources || []).slice(0, 2).map((s) => { const n = s.node; return n && n.nodeType === 1 ? n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : '?' }) }) } }).observe({ type: 'layout-shift', buffered: true }) } catch (e) {} })()`

const results = []
const missing = []
let current = null

async function run() {
  for (const size of SIZES) {
    for (const scheme of SCHEMES) {
      const { w, h } = DIMENSIONS[size]
      const live = await openLivePage({ width: w, height: h })
      const { page } = live
      try {
        await page.send('Runtime.enable', {})
        // A "Leave site?" dialog (a panel with an unsaved edit) would hold every later reload for ever: it is answered at once.
        await page.send('Page.enable', {})
        page.on('Page.javascriptDialogOpening', () => { page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) })
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD_SHIFTS })
        if (size === 'narrow') await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
        await interceptor(page)
        const ctx = makeCtx(page, size, scheme)
        await reload(page)
        await setScheme(ctx, scheme)
        await reload(page)
        const state = (await page.evalJs(`document.documentElement.getAttribute('data-ds-theme-source') + '|' + getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary')`)).val
        console.log('== ' + size + ' / ' + scheme + '  (' + state + ')')
        for (const sc of SCENARIOS) {
          if (ONLY !== null && !ONLY.some((o) => sc.id === o || sc.id.startsWith(o + '.'))) continue
          current = sc.id
          try { await sc.run(ctx) } catch (e) { missing.push({ size, scheme, scenario: sc.id, why: 'threw: ' + String(e.message || e).slice(0, 160) }) }
          await ensureClean(ctx)
        }
      } finally { await live.close() }
    }
  }
}

async function reload(page) {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(1500)
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await sleep(2200)
}

const mouse = async (page, x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }

function makeCtx(page, size, scheme) {
  const ctx = {
    page, size, scheme, sleep,
    /** Click the first visible element matching {css, text, label, nth}; false when none (and it is listed as missing). */
    async click(spec, opts = {}) {
      // An element that is about to be drawn (a card after a reload, a cell a plugin renames) is waited for: `patience` ms (2.5 s unless the click is `quiet`,
      // i.e. for a control that may legitimately be absent) before the step is listed as one that could not be done.
      const patience = opts.patience !== undefined ? opts.patience : (opts.quiet === true ? 0 : 2500)
      const deadline = Date.now() + patience
      const lookup = `(() => {
        const sp = ${JSON.stringify(spec)}
        const norm = (s) => String(s || '').replace(/[⟦⟧]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase()
        const els = Array.from(document.querySelectorAll(sp.css || '*')).filter((e) => {
          const r = e.getBoundingClientRect()
          if (r.width < 4 || r.height < 4 || getComputedStyle(e).visibility !== 'visible') return false
          if (sp.label !== undefined && !norm(e.getAttribute('aria-label') || e.getAttribute('title')).startsWith(norm(sp.label))) return false
          if (sp.minLeft !== undefined && r.left < sp.minLeft) return false // the right pane's rows, not the same word in the middle of the page
          if (sp.text !== undefined) {
            const own = norm(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))
            const first = norm(String(e.innerText || '').split('\\n')[0])
            if (!(own === norm(sp.text) || (e.children.length <= 6 && first === norm(sp.text)))) return false
          }
          return true
        })
        const e = els[sp.nth || 0]
        if (!e) return null
        e.scrollIntoView({ block: 'nearest' })
        const r = e.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`
      let r = await page.evalJs(lookup, 8000)
      while (!r.val && Date.now() < deadline) { await sleep(250); r = await page.evalJs(lookup, 8000) }
      if (!r.val) {
        if (opts.quiet !== true) {
          // A step that cannot be done keeps a picture of the page it met, so the reason is read from the page and not guessed.
          const at = join('shots', ('missing-' + size + '-' + scheme + '-' + current + '-' + (missing.length + 1)).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.png')
          try { await page.shot(join(OUT, at)) } catch (e) { /* no picture */ }
          // and the names of the controls in the top bar of the page, which is where a pane that covers the sidebar shows its way out
          const bar = (await page.evalJs(`Array.from(document.querySelectorAll('button, [role=button]')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 4 && r.top >= 0 && r.top < 60 }).map((b) => b.getAttribute('aria-label') || (b.innerText || '').trim().slice(0, 20)).filter(Boolean).slice(0, 12).join(' | ')`, 4000)).val
          missing.push({ size, scheme, scenario: current, why: 'not found: ' + JSON.stringify(spec) + (typeof bar === 'string' && bar !== '' ? ' (top bar: ' + bar + ')' : ''), shot: at })
        }
        return false
      }
      await mouse(page, r.val.x, r.val.y)
      await sleep(opts.wait === undefined ? 700 : opts.wait)
      return true
    },
    /** Move the mouse over the first visible element matching {css, text, startsWith} (reveals hover-only controls). */
    async hover(spec) {
      const r = await page.evalJs(`(() => {
        const sp = ${JSON.stringify(spec)}
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const e = Array.from(document.querySelectorAll(sp.css || '*')).find((x) => { const r = x.getBoundingClientRect(); const t = norm(String(x.innerText || '').split('\n')[0]); return r.width > 4 && r.height > 4 && (sp.startsWith ? t.startsWith(norm(sp.text)) : t === norm(sp.text)) })
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`, 6000)
      if (!r.val) return false
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.val.x, y: r.val.y })
      await sleep(400)
      return true
    },
    async key(name) {
      const code = { Escape: 27, Enter: 13, Tab: 9 }[name]
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code })
      await sleep(350)
    },
    /** At 390 px the sidebar is a drawer. `ready` (a CSS selector inside it, e.g. the profile card) must be ON SCREEN once the drawer is open: the shell
     *  redraws its footer a moment after a load (the account answer arrives), which can close a drawer that was opened too early. When it is not there the
     *  page is reloaded and the drawer opened again (three tries), so the views that live in the drawer are measured or reported, never skipped for a timing. */
    async drawer(ready) {
      if (size !== 'narrow') return true
      const openNow = `document.querySelector('[data-sidebar-collapsed]') === null && document.querySelector('[data-shell-overlay]') !== null`
      const isOpen = async () => (await page.evalJs(openNow)).val === true
      const onScreen = ready === undefined ? null : `(() => { const e = document.querySelector(${JSON.stringify(ready)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 4 && r.left >= 0 && r.right <= innerWidth + 1 && getComputedStyle(e).visibility === 'visible' })()`
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // A right pane that a reload brought back covers the page at 390 px (a full-screen sheet over the menu button): it is put away first.
        await putPaneAway(ctx)
        // Right after a load the menu button may not be drawn yet and the shell has no state to read: wait for the button before deciding.
        await waitFor(page, `document.querySelector('[data-kb="mobile-menu"]') !== null`, 8000)
        // What the drawer will hold is drawn before it is opened (an account card that arrives later would be drawn into a drawer that closed).
        if (ready !== undefined) await waitFor(page, `document.querySelector(${JSON.stringify(ready)}) !== null`, 15000)
        if (!(await isOpen())) {
          await ctx.click({ css: '[data-kb="mobile-menu"]' }, { wait: 300, quiet: attempt < 2 })
          await waitFor(page, openNow, 4000)
        }
        if (onScreen === null || (await waitFor(page, onScreen, 3000)) !== null) return true
        if (attempt < 2) await reload(page)
      }
      return false
    },
    /** Measure the page as it is now, outline the offenders on a screenshot. */
    async audit(label, opts = {}) {
      const id = current + (label ? ':' + label : '')
      if (opts.settle !== false) await sleep(opts.wait || 600)
      const shifts = (await page.evalJs('(window.__kbShifts || []).filter((s) => !s.input && s.v >= 0.02)')).val || []
      await page.evalJs('window.__kbShifts = []')
      const r = await page.evalJs('(' + auditInPage.toString() + ')({})', 40000)
      if (r.err !== undefined || r.val === undefined) { missing.push({ size, scheme, scenario: id, why: 'audit failed: ' + String(r.err).slice(0, 120) }); return null }
      const o = r.val
      const bad = [...o.contrast.filter((c) => !c.disabled).map((c) => ({ ...c, cat: 'contrast' })), ...o.clipped.map((c) => ({ ...c, cat: 'clipped' })), ...o.truncated.filter((t) => !t.titled).map((c) => ({ ...c, cat: 'truncated' }))]
      let shot = null
      if (bad.length > 0 || shifts.length > 0 || opts.shot === true) {
        shot = join('shots', (size + '-' + scheme + '-' + id).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.png')
        await page.evalJs(`(() => { const items = ${JSON.stringify(bad.map((b) => b.rect))}; const d = document.createElement('div'); d.id = '__kbaudit'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'; items.forEach((r, i) => { const b = document.createElement('div'); b.style.cssText = 'position:fixed;left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px;outline:2px solid #ff2d55;outline-offset:1px'; const n = document.createElement('span'); n.textContent = String(i + 1); n.style.cssText = 'position:absolute;left:-1px;top:-14px;background:#ff2d55;color:#fff;font:700 10px/12px sans-serif;padding:0 3px'; b.appendChild(n); d.appendChild(b) }); document.body.appendChild(d) })()`)
        await page.shot(join(OUT, shot))
        await page.evalJs(`document.getElementById('__kbaudit') && document.getElementById('__kbaudit').remove()`)
      }
      const rec = { size, scheme, scenario: id, shot, samples: o.samples, unknownBg: o.unknownBg, contrast: o.contrast, clipped: o.clipped, truncated: o.truncated, shifts, doc: o.doc }
      results.push(rec)
      const flag = o.doc.scrollW > o.doc.clientW + 1 ? ' PAGE-SCROLLS-X' : ''
      console.log('  ' + id.padEnd(46) + ' text ' + String(o.samples).padStart(4) + '  contrast ' + o.contrast.filter((c) => !c.disabled).length + '  clipped ' + o.clipped.length + '  cut ' + o.truncated.filter((t) => !t.titled).length + '  jumps ' + shifts.length + flag)
      return rec
    },
  }
  return ctx
}

// A scenario leaves no popover behind: Escape, then a reload when something is still floating.
async function ensureClean(ctx) {
  await ctx.key('Escape')
  const open = (await ctx.page.evalJs(`!!document.querySelector('[role="menu"],[role="dialog"],[class*="kbf-pop"],.kbf-pop,[data-radix-popper-content-wrapper],[class*="navList"]')`)).val
  if (open === true || ctx.dirty === true) { ctx.dirty = false; await reload(ctx.page) }
}

async function setScheme(ctx, scheme) {
  const { page } = ctx
  const ok = await openSettings(page, { tries: 3 })
  if (!ok) { missing.push({ size: ctx.size, scheme, scenario: 'scheme', why: 'settings did not open' }); return }
  await ctx.drawer()
  await ctx.click({ css: '[class*="navCell"]', text: 'Theme' })
  await sleep(1200)
  // The mode is set on the Appearance page only (V1-24): go there, press the card, come back to the Theme page (the look is picked on it).
  const seg = async (name) => {
    await ctx.click({ css: '[class*="navCell"]', text: 'Appearance' })
    await sleep(900)
    await ctx.click({ css: '.kbac-theme', text: name })
    await sleep(900)
    await ctx.click({ css: '[class*="navCell"]', text: 'Theme' })
    await sleep(900)
  }
  const skin = (name) => ctx.click({ css: '.kbth-skin', text: name })
  if (scheme === 'dark') { await skin('DSH default'); await seg('Dark') }
  else if (scheme === 'light') { await skin('DSH default'); await seg('Light') }
  else if (scheme === 'neutre') { await skin('Neutral violet') }
  else if (scheme === 'neutre-dark') { await skin('Neutral violet'); await seg('Dark') }
  await sleep(1200)
}

// ── what is walked ──────────────────────────────────────────────────────────────────────────────────────────────
// (DSH's own « Automation tasks » list is hidden by the Kybernos Automations page: the sidebar has no such row any more, so it is not walked.)
// The profile card of the sidebar footer (signed in): at 390 px it lives in the drawer.
const CARD = '[data-kb="workspace-card"] .kbfp-cardmain'
const SIDEBAR_PAGES = ['Agent Teams', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']
const COMPOSER = [
  { label: 'Add files or run commands' }, { label: 'Commands: browse' }, { label: 'Access mode' }, { label: 'Execution environment' },
  { label: 'Select model' }, { label: 'Create an artifact' }, { label: 'Input device' }, { label: 'Choose workspace' },
]
const slug = (t, n = 22) => String(t).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n)
const hasNav = (c) => c.page.evalJs(`!!Array.from(document.querySelectorAll('button[class*="navCell"]')).find((b) => b.getBoundingClientRect().width > 4)`).then((r) => r.val === true)
async function ensureSettings(c) { if (!(await hasNav(c))) { await reload(c.page); await openSettings(c.page, { tries: 3 }) } }

// The right pane stays open across reloads, and at 390 px it is a full-screen sheet over the whole page, drawer button included. A person leaves it with « Exit
// fullscreen », then « Collapse right sidebar », or by closing its tabs: the same is done here until the page's own menu button can be reached again (narrow), or once (desktop).
const menuButtonReachable = (c) => c.page.evalJs(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (!b) return false; const r = b.getBoundingClientRect(); if (r.width < 4) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === b || b.contains(t) })()`).then((r) => r.val === true)
async function putPaneAway(c) {
  // Nothing to do (and no « Close » to press: it could be the one of a dialog) when no pane is on the page.
  const paneShown = () => c.page.evalJs(`(() => { const e = document.querySelector('[data-sidebar-right-panel]'); return !!e && e.getBoundingClientRect().width > 4 })()`).then((r) => r.val === true)
  if (!(await paneShown())) return true
  for (let i = 0; i < 6; i += 1) {
    if (c.size === 'narrow' && await menuButtonReachable(c)) return true
    for (const label of ['Exit fullscreen', 'Collapse right sidebar']) await c.click({ css: 'button', label }, { quiet: true, wait: 700 })
    if (c.size !== 'narrow') return true
    if (await menuButtonReachable(c)) return true
    await c.click({ css: 'button', label: 'Close' }, { quiet: true, wait: 700 }) // a tab of the pane, one at a time
  }
  return c.size !== 'narrow' || await menuButtonReachable(c)
}

const SCENARIOS = [
  {
    id: 'home',
    async run(c) {
      await c.audit('', { shot: true, wait: 1500 })
      if (c.size === 'narrow') { await c.drawer(); await c.audit('drawer', { shot: true }) }
    },
  },
  {
    id: 'home.menus',
    async run(c) {
      for (const spec of COMPOSER) {
        if (await c.click({ css: 'button', ...spec }, { quiet: true })) { await c.audit(slug(spec.label)); await c.key('Escape'); await c.key('Escape') }
      }
      for (const spec of [{ label: 'Start this chat with' }, { label: 'Search sessions' }, { label: 'View options' }, { label: 'Add workspace' }]) {
        await c.drawer()
        if (await c.click({ css: 'button', ...spec }, { quiet: spec.label === 'Add workspace' })) { await c.audit(slug(spec.label)); await c.key('Escape'); await c.key('Escape') }
      }
      // Controls that only show on hover: the workspace row's actions and the session row's.
      await c.drawer()
      await c.hover({ css: 'button, [role="button"], a', text: 'agent-', startsWith: true })
      if (await c.click({ css: 'button', label: 'Workspace actions for' }, { quiet: true })) { await c.audit('workspace-actions'); await c.key('Escape') }
    },
  },
  {
    id: 'page',
    async run(c) {
      for (const name of SIDEBAR_PAGES) {
        await c.drawer()
        if (!(await c.click({ css: 'button, a, [role="button"]', text: name }))) continue
        await c.audit(slug(name), { wait: 2600 })
        const tabs = (await c.page.evalJs(`Array.from(document.querySelectorAll('[role="tab"]')).filter((e) => e.getBoundingClientRect().width > 4 && getComputedStyle(e).visibility === 'visible').map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 8)`)).val || []
        for (const t of tabs.slice(1)) { if (await c.click({ css: '[role="tab"]', text: t }, { quiet: true })) await c.audit(slug(name) + '.' + slug(t, 18), { wait: 1500 }) }
        await c.key('Escape')
      }
      await reload(c.page)
    },
  },
  {
    id: 'settings',
    async run(c) {
      if (!(await openSettings(c.page, { tries: 3 }))) { missing.push({ size: c.size, scheme: c.scheme, scenario: 'settings', why: 'did not open' }); return }
      await c.drawer()
      // Only the cells a person can see: DSH's own « Models » cell is hidden by the Kybernos « AI provider and models » page that replaces it (there is nothing to click).
      const readCells = async () => (await c.page.evalJs(`Array.from(document.querySelectorAll('button[class*="navCell"]')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(b).visibility === 'visible' }).map((b) => (b.innerText || '').trim())`)).val || []
      // Plugins retitle some cells a moment after the dialog opens (« Models » becomes « AI provider and models »): take the list once it has stopped moving.
      let cells = await readCells()
      for (let i = 0; i < 12; i += 1) { await sleep(500); const again = await readCells(); if (JSON.stringify(again) === JSON.stringify(cells)) break; cells = again }
      for (const name of cells) {
        if (CELLS !== null && !CELLS.some((x) => name.toLowerCase().includes(x))) continue
        await ensureSettings(c)
        await c.drawer()
        // After a reload the cell may carry its final title: look for the name as read, then for the cell that contains it.
        if (!(await c.click({ css: 'button[class*="navCell"]', text: name }, { wait: 1200, quiet: true }))) {
          const now = await readCells()
          const alias = now.find((t) => t.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.toLowerCase()))
          if (alias === undefined || !(await c.click({ css: 'button[class*="navCell"]', text: alias }, { wait: 1200 }))) { missing.push({ size: c.size, scheme: c.scheme, scenario: 'settings.' + slug(name), why: 'the cell « ' + name + ' » was not found again (cells now: ' + now.join(' | ').slice(0, 120) + ')' }); continue }
        }
        await c.audit(slug(name), { wait: 1500 })
        // The page's own tabs (role=tab, or the theme page's vertical tabs).
        const tabs = (await c.page.evalJs(`Array.from(document.querySelectorAll('[role="tab"], .kbth-adv-tab')).filter((e) => !e.closest('[class*="navList"]') && e.getBoundingClientRect().width > 4 && getComputedStyle(e).visibility === 'visible').map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 10)`)).val || []
        for (const t of tabs) { if (await c.click({ css: '[role="tab"], .kbth-adv-tab', text: t }, { quiet: true, wait: 900 })) await c.audit(slug(name) + '.' + slug(t, 18), { wait: 900 }) }
        // The « How it works » card of the pages that have one.
        if (await c.click({ css: 'button', text: 'How it works' }, { quiet: true })) { await c.audit(slug(name) + '.help', { wait: 700 }); await c.key('Escape') }
      }
      c.dirty = true
    },
  },
  {
    // The right pane's own panels. Their stage is a fixed light paper in every scheme while their head, bars and notes follow the theme, so a pair of inks
    // chosen for one of the two reads wrong in the other (audit A4-01, A4-13, A4-24). Slides is also played with its demo deck and the text editor over it.
    id: 'panels',
    async run(c) {
      const { page } = c
      const dbl = async (x, y) => { for (const [type, n] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: n }) }
      const present = (sel) => page.evalJs(`!!document.querySelector(${JSON.stringify(sel)})`).then((r) => r.val === true)
      // The host keeps the pane and its tabs from one page to the next: a panel may already be open, or be a tab behind the active one.
      const openPanel = async (name, probe) => {
        if (await present(probe)) return true
        // The panel's tabs are in the right pane, right of 700 px on a desktop window; at 390 px the pane takes the whole page.
        const minLeft = c.size === 'narrow' ? 0 : 700
        if (await c.click({ css: '[role="tab"], button', text: name, minLeft }, { wait: 1800, quiet: true })) return true
        return (await c.click({ css: 'button[aria-label="New tab"]' }, { wait: 900, quiet: true })) && (await c.click({ css: '[role="tab"], button', text: name, minLeft }, { wait: 1800 }))
      }
      await c.click({ css: 'button[aria-label="Open right sidebar"]' }, { wait: 1500, quiet: true })
      if (await openPanel('Slides', '.kbsd-root')) {
        if (await present('.kbsd-demo')) { await c.audit('slides-empty', { shot: true, wait: 1200 }); await c.click({ css: '.kbsd-demo' }); await sleep(11000) } // the demo writes its five slides in about nine seconds
        else await sleep(1200)
        await c.audit('slides-deck', { shot: true })
        const title = (await page.evalJs(`(() => { const e = Array.from(document.querySelectorAll('.kbsd-slide .kbsd-champ')).find((x) => x.innerText.trim() !== ''); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)).val
        if (title) { await dbl(title.x, title.y); await sleep(700); await c.audit('slides-editor', { shot: true }); await c.key('Escape') }
        else missing.push({ size: c.size, scheme: c.scheme, scenario: 'panels', why: 'no field to edit on the demo deck' })
      }
      // The panels' tab names as the English UI draws them (« Bricks » was « Briques », « 3D modeller » was « Modeleur »): a name that is not found is listed as SKIPPED.
      for (const [name, probe] of [['Bricks', '.kbb-root'], ['3D modeller', '.kbmo']]) {
        if (await openPanel(name, probe)) await c.audit(slug(name) + '-empty', { shot: true, wait: 1200 })
      }
      // The pane stays open across reloads, and at 390 px it is a full-screen sheet that covers the whole page (the drawer and its card with it): it is put away, as a
      // person would, so the next scenario starts from the page a person sees.
      await putPaneAway(c)
      c.dirty = true
    },
  },
  {
    id: 'account',
    async run(c) {
      fake.cloud = CLOUD
      fake.remote = REMOTE.idle
      await reload(c.page)
      // Whatever an earlier scenario left open in the right pane is put away first (at 390 px it covers the drawer).
      await putPaneAway(c)
      // The card sits in the closed drawer at 390 px: the drawer is opened with the card on screen, or the view is reported as not reached.
      if (!(await c.drawer(CARD))) missing.push({ size: c.size, scheme: c.scheme, scenario: 'account', why: 'the profile card did not come on screen in the drawer (' + CARD + ')' })
      await c.audit('card', { shot: true, wait: 1200 })
      // The reminder that an update is waiting (kybernos-maintenance announces it; here it is announced by hand).
      await c.page.evalJs(`window.__kbUpdate = { cible: '1.0.0-beta.9', kind: 'suite', version: '1.0.0-beta.9' }; window.dispatchEvent(new Event('kybernos:update'))`)
      await c.audit('update-reminder', { shot: true, wait: 900 })
      for (const lab of ['Light theme', 'Send feedback', 'Help & docs', 'Share Kybernos', 'Notifications']) {
        await c.drawer()
        if (await c.click({ css: 'button', label: lab }, { quiet: true })) { await c.audit('footer-' + slug(lab)); await c.key('Escape') }
      }
      await reload(c.page)
      await c.drawer(CARD)
      if (await c.click({ css: CARD }, { patience: 8000 })) {
        await c.audit('menu', { shot: true })
        // The account has two workspaces: the switcher entry is there, and its absence is a finding (not a silent skip).
        if (await c.click({ css: '[data-kb="menu-switch"]' }, { patience: 3000 })) await c.audit('switcher', { shot: true })
      }
      await reload(c.page)
      // The « Phone and channels » window, in each state the host can answer.
      for (const [name, remote] of [['idle', REMOTE.idle], ['qr', REMOTE.qr], ['verify', REMOTE.verify], ['devices', REMOTE.devices], ['paywall', REMOTE.paywall]]) {
        fake.remote = remote
        await reload(c.page)
        await c.drawer(CARD)
        // The phone link and Kaby's messaging apps are the « Phone and channels » entry of the profile menu (the footer's own phone button is gone). The entry is there
        // whatever the plan says: the window itself says « Not included in your plan » in its left column.
        const opened = await c.click({ css: CARD }, { patience: 8000 })
        if (opened && await c.click({ css: '[data-kb="menu-phone"]' }, { patience: 3000 })) await c.audit('phone-' + name, { shot: true, wait: 1500 })
        else missing.push({ size: c.size, scheme: c.scheme, scenario: 'account:phone-' + name, why: 'the profile menu has no Phone and channels entry' })
      }
      // The same screen as a Settings page: Settings › Phone and channels.
      fake.remote = REMOTE.paywall
      await reload(c.page)
      await c.drawer() // at 390 px the Settings trigger is in the drawer
      if (await openSettings(c.page, { tries: 3 })) {
        await c.drawer()
        if (await c.click({ css: 'button[class*="navCell"]', text: 'Phone and channels' })) await c.audit('settings-mobile-paywall', { shot: true, wait: 1500 })
      } else missing.push({ size: c.size, scheme: c.scheme, scenario: 'account:settings-mobile-paywall', why: 'settings did not open' })
      fake.remote = REMOTE.devices
      await reload(c.page)
      await c.drawer()
      if (await openSettings(c.page, { tries: 3 })) {
        await c.drawer()
        if (await c.click({ css: 'button[class*="navCell"]', text: 'Phone and channels' })) await c.audit('settings-mobile', { shot: true, wait: 1500 })
      } else missing.push({ size: c.size, scheme: c.scheme, scenario: 'account:settings-mobile', why: 'settings did not open' })
      fake.cloud = null
      fake.remote = null
      c.dirty = true
    },
  },
  {
    id: 'onboarding',
    async run(c) {
      fake.onboarding = true
      await reload(c.page)
      let last = ''
      for (let i = 0; i < 5; i += 1) {
        const step = (await c.page.evalJs(`(() => { const o = document.querySelector('.kb-ob'); if (!o) return null; const h = o.querySelector('h1'); return { title: h ? h.innerText.trim() : '' } })()`)).val
        if (step === null || step === undefined) { if (i === 0) missing.push({ size: c.size, scheme: c.scheme, scenario: 'onboarding', why: 'the wizard did not open' }); break }
        if (step.title === last) break
        last = step.title
        await c.audit('step' + (i + 1), { shot: true, wait: 700 })
        if (i === 0 && await c.click({ css: '.kb-ob-lang-btn' }, { quiet: true })) { await c.audit('language-menu'); await c.click({ css: '.kb-ob-lang-btn' }, { quiet: true }) }
        // Stop before the step that asks how to power the agents: its buttons start a sign-in.
        if (/model|work with|power|key/i.test(step.title)) break
        const primary = await c.click({ css: '[data-kb-ob-primary]:not([disabled])' }, { quiet: true })
        if (!primary) { await c.click({ css: '.kb-ob-row' }, { quiet: true }); await c.click({ css: '[data-kb-ob-primary]:not([disabled])' }, { quiet: true }) }
        await sleep(600)
      }
      fake.onboarding = false
      c.dirty = true
    },
  },
]

// ── run and report ──────────────────────────────────────────────────────────────────────────────────────────────
try { await run() } catch (e) { console.error('○ not run: ' + (e && e.message ? e.message : e)); process.exit(3) }

const sigOf = (cat, f) => cat + '|' + (f.sel || '') + '|' + (cat === 'clipped' ? f.side + '|' + f.clip : (f.text || '').slice(0, 24))
const groups = new Map()
for (const r of results) {
  for (const [cat, items] of [['contrast', r.contrast.filter((c) => !c.disabled)], ['clipped', r.clipped], ['truncated', r.truncated.filter((t) => !t.titled)], ['jump', r.shifts.map((s) => ({ sel: s.src.join(' + '), text: String(s.v) }))]]) {
    for (const f of items) {
      const k = sigOf(cat, f)
      if (!groups.has(k)) groups.set(k, { cat, first: f, where: [], worst: f.ratio !== undefined ? f.ratio : f.by })
      const g = groups.get(k)
      g.where.push(r.size + '/' + r.scheme + '/' + r.scenario)
      if (f.ratio !== undefined && f.ratio < g.worst) g.worst = f.ratio
      if (f.by !== undefined && f.by > g.worst) g.worst = f.by
      g.shot = g.shot || r.shot
    }
  }
}
const findings = [...groups.values()].sort((a, b) => (a.cat === b.cat ? (a.cat === 'contrast' ? a.worst - b.worst : b.worst - a.worst) : a.cat.localeCompare(b.cat)))
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ host, sizes: SIZES, schemes: SCHEMES, missing, findings: findings.map((g) => ({ cat: g.cat, worst: g.worst, ...g.first, seen: g.where.length, where: g.where.slice(0, 6), shot: g.shot })), results }, null, 1))
console.log('\n' + results.length + ' views measured, ' + findings.length + ' distinct findings, ' + missing.length + ' step(s) SKIPPED (a view that was not measured is not a view that passed)')
for (const m of missing) console.log('SKIPPED: ' + m.size + '/' + m.scheme + '/' + m.scenario + ' — ' + m.why)
console.log('report: ' + join(OUT, 'report.json'))
// --strict turns a finding AND a skipped view into a failure: a sweep that quietly measured less than it was asked to is not green.
process.exit(STRICT && (findings.length > 0 || missing.length > 0) ? 1 : 0)
