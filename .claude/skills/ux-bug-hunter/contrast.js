// Text contrast of what is on screen (WCAG AA), for the ux-bug-hunter skill. Read-only: it measures, it changes nothing.
//
// Evaluate it in a page with `page.evalJs(contrast)`: the value is `{ scanned, worst, bad }`, `bad` being the visible text below the AA ratio
// (4.5:1, or 3:1 for large text: 24 px, or 18.66 px bold), worst first. Colours go through a canvas, so `color-mix()`, `color()` and named colours read
// as numbers; the background of a text is every translucent layer up to the first opaque one, composited; an ancestor's `opacity` dims the text.
//
// What it does NOT judge, so that a hit is a real hit:
//   - text in an `aria-hidden` subtree (a drawing of a screen, a decorative glyph);
//   - a disabled control or one inside `aria-disabled` (WCAG exempts it), and `:disabled` buttons;
//   - an element with a running animation or transition, or inside one (a caption that fades in and out is measured half-way);
//   - text with no opacity left (revealed on hover or focus: it is not on screen until then);
//   - text over a gradient or an image (the real background is unknown: look at it).
// A hit says where, the text, both colours and the ratio; whether the colour comes from DSH's own tokens (the engine's pages) or ours is read from `where`.
(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1]
  const bgOf = (el) => {
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 0.999) break
    }
    let base = rgba(getComputedStyle(document.body).backgroundColor)
    if (base[3] < 0.999) base = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
    return base
  }
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o }
  const exempt = (el) => {
    for (let e = el; e; e = e.parentElement) {
      if (e.getAttribute && (e.getAttribute('aria-hidden') === 'true' || e.getAttribute('aria-disabled') === 'true')) return true
      if (e.disabled === true) return true
      if (typeof e.getAnimations === 'function' && e.getAnimations().length > 0) return true
    }
    return false
  }
  const root = document.querySelector('[role="dialog"]') || document.body
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  const bad = []
  let scanned = 0
  let worst = 99
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.nodeValue || '').trim()
    if (t.length < 2) continue
    const el = n.parentElement
    if (!el || seen.has(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const range = document.createRange(); range.selectNodeContents(n)
    const tr = range.getBoundingClientRect()
    if (tr.width < 2 || tr.height < 2 || tr.bottom < 0 || tr.top > innerHeight) continue
    seen.add(el)
    if (exempt(el)) continue
    const dim = opacityOf(el)
    if (dim < 0.05) continue
    const bg = bgOf(el)
    if (bg === null) continue
    const fg = rgba(cs.color); fg[3] *= dim
    const eff = over(fg, bg)
    const size = parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    const got = ratio(eff, bg)
    scanned += 1
    if (got < worst) worst = got
    if (got + 0.005 < need) {
      const cls = typeof el.className === 'string' && el.className.trim() !== '' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      bad.push({ text: t.slice(0, 60), ratio: Math.round(got * 100) / 100, need, size, fg: eff.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(','), where: el.tagName.toLowerCase() + cls })
    }
  }
  bad.sort((a, b) => a.ratio - b.ratio)
  return { scanned, worst: Math.round(worst * 100) / 100, bad }
})()
