// The deck builder: a short description of a presentation (titles, bullets, numbers, a chart…) becomes ONE self-contained HTML file, `<name>.deck.html`, that the
// deck editor of this plugin opens in the right-hand tab and in Creations, and that also plays on its own in any browser (arrow keys, grid, presenter view).
//
// Pure: no disk, no DSH. The style sheet and the player come from the installed deck editor (`editors/deck/standalone.css` and `.js`, read by the host) and are handed in.
// The slides use a fixed vocabulary the editor knows how to change (docs/dev/office-editors-open-save-contract-2026-11-03.md, "Slide decks"): a slide is
// `<div class="cell"><section class="slide [dark]" data-transition>` holding an `h1[data-e]`, text blocks `.b[data-e]`, `ul.bul`, a `table.t`, a `.chart[data-chart]`, an
// `img.pic` and an `aside.notes[data-e]`, all placed in pixels on a 1280 × 720 slide.

export const SLIDE_W = 1280
export const SLIDE_H = 720
export const MAX_SLIDES = 60
export const MAX_BULLETS = 8
export const MAX_TABLE_ROWS = 10
export const MAX_TABLE_COLS = 6
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_DECK_BYTES = 24 * 1024 * 1024

export const LAYOUTS = Object.freeze(['cover', 'section', 'bullets', 'two-columns', 'stats', 'chart', 'table', 'quote', 'image', 'text'])
export const CHART_TYPES = Object.freeze(['column', 'bar', 'line', 'doughnut'])
export const TRANSITIONS = Object.freeze(['fade', 'push', 'wipe'])

const DEFAULT_PRIMARY = '#1E2761'
const DEFAULT_ACCENT = '#D4A843'
const MARGIN = 88
const CONTENT_W = SLIDE_W - 2 * MARGIN

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (t) => esc(t).replace(/"/g, '&quot;')
/** `**bold**` in a line of text is bold; everything else is text. */
const rich = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

// ── colours ──────────────────────────────────────────────────────────────────────────────────────────────────────
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const hex6 = (c) => { const h = String(c).toLowerCase(); return h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h }
const rgb = (c) => { const h = hex6(c); return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) }
const toHex = (v) => '#' + v.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
/** `a` mixed with `b`: t = 0 is `a`, t = 1 is `b`. */
const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return toHex(x.map((n, i) => n + (y[i] - n) * t)) }
const luminance = (c) => { const [r, g, b] = rgb(c).map((n) => { const s = n / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
/** Black or white, whichever reads better on `fill`. */
const onColor = (fill) => (luminance(fill) > 0.4 ? '#1a1a1a' : '#ffffff')

/** The colours of a deck from its theme: the dark slides and titles (`primary`), the highlights (`accent`) and what follows from them. */
export const palette = (theme) => {
  const primary = plain(theme) && typeof theme.primary === 'string' && HEX.test(theme.primary) ? hex6(theme.primary) : DEFAULT_PRIMARY
  const accent = plain(theme) && typeof theme.accent === 'string' && HEX.test(theme.accent) ? hex6(theme.accent) : DEFAULT_ACCENT
  return {
    primary,
    accent,
    light: mix(primary, '#ffffff', 0.93),
    pale: mix(primary, '#ffffff', 0.78),
    grey: mix(primary, '#808890', 0.55),
    onAccent: onColor(accent),
    series: [primary, mix(primary, '#3a8fd6', 0.55), accent, '#9aa7b5', mix(accent, primary, 0.5)],
  }
}

// ── the description ──────────────────────────────────────────────────────────────────────────────────────────────
const fail = (error) => ({ ok: false, error })
const strings = (v, max, each) => (Array.isArray(v) ? v.map((x) => text(x, each)).filter((x) => x !== '').slice(0, max) : [])

const numbers = (v, n) => (Array.isArray(v) ? v.slice(0, n).map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number.parseFloat(String(x).replace(',', '.')))).map((x) => (Number.isFinite(x) ? x : 0)) : [])

/** Checks a chart description and returns the clean one, or an error the model can act on. */
const chartOf = (c, where) => {
  if (!plain(c)) return fail(where + ': `chart` is missing: { type, categories, series: [{ name, values }] }.')
  const type = CHART_TYPES.includes(c.type) ? c.type : 'column'
  const categories = strings(c.categories, 12, 40)
  if (categories.length < 2) return fail(where + ': a chart needs at least two `categories`.')
  const series = (Array.isArray(c.series) ? c.series : []).filter(plain).slice(0, type === 'doughnut' ? 1 : 4).map((s) => ({
    name: text(s.name, 40) || 'Series',
    values: numbers(s.values, categories.length),
    color: typeof s.color === 'string' && HEX.test(s.color) ? hex6(s.color) : null,
  }))
  if (series.length === 0 || series.some((s) => s.values.length !== categories.length)) return fail(where + ': every series needs one number in `values` for each of the `categories`.')
  return { ok: true, chart: { type, categories, series, labels: c.labels !== false && categories.length <= 8, alt: text(c.alt, 200) } }
}

/**
 * The description a model gives, checked and cleaned: `{ ok: true, deck }` or `{ ok: false, error }` with a sentence that says what to change. Nothing here throws on
 * wrong types; it never trusts a field.
 */
export function normalize (input) {
  if (!plain(input)) return fail('Give the deck as an object: { title, slides: [...] }.')
  const title = text(input.title, 120)
  if (title === '') return fail('The deck needs a `title`.')
  if (!Array.isArray(input.slides) || input.slides.length === 0) return fail('The deck needs `slides`: a list with at least one slide.')
  if (input.slides.length > MAX_SLIDES) return fail('A deck has at most ' + MAX_SLIDES + ' slides.')
  const slides = []
  for (let i = 0; i < input.slides.length; i++) {
    const s = input.slides[i]
    const where = 'Slide ' + (i + 1)
    if (!plain(s)) return fail(where + ' must be an object { layout, title, ... }.')
    const layout = typeof s.layout === 'string' ? s.layout : ''
    if (!LAYOUTS.includes(layout)) return fail(where + ': `layout` must be one of ' + LAYOUTS.join(', ') + '.')
    const out = { layout, title: text(s.title, 140), subtitle: text(s.subtitle, 200), notes: typeof s.notes === 'string' ? s.notes.trim().slice(0, 2000) : '', transition: TRANSITIONS.includes(s.transition) ? s.transition : 'fade' }
    if (layout !== 'quote' && layout !== 'image' && out.title === '') return fail(where + ' (' + layout + ') needs a `title`.')
    if (layout === 'cover') out.tagline = text(s.tagline, 120)
    if (layout === 'section') out.number = text(s.number, 4)
    if (layout === 'bullets') {
      out.bullets = strings(s.bullets, MAX_BULLETS, 200)
      if (out.bullets.length === 0) return fail(where + ' (bullets) needs `bullets`: a list of short sentences (at most ' + MAX_BULLETS + ').')
    }
    if (layout === 'text') {
      out.paragraphs = strings(s.paragraphs, 6, 700)
      if (out.paragraphs.length === 0) return fail(where + ' (text) needs `paragraphs`.')
    }
    if (layout === 'two-columns') {
      const cols = [s.left, s.right].map((c) => (plain(c) ? { heading: text(c.heading, 60), bullets: strings(c.bullets, 6, 160) } : { heading: '', bullets: [] }))
      if (cols.some((c) => c.bullets.length === 0)) return fail(where + ' (two-columns) needs `left` and `right`, each { heading?, bullets: [...] }.')
      out.columns = cols
    }
    if (layout === 'stats') {
      const stats = (Array.isArray(s.stats) ? s.stats : []).filter(plain).slice(0, 4).map((x) => ({ value: text(x.value, 14), label: text(x.label, 60) })).filter((x) => x.value !== '')
      if (stats.length < 2) return fail(where + ' (stats) needs `stats`: 2 to 4 items { value, label }, e.g. { value: "4.8 M€", label: "Revenue" }.')
      out.stats = stats
    }
    if (layout === 'chart') {
      const c = chartOf(s.chart, where)
      if (!c.ok) return c
      out.chart = c.chart
    }
    if (layout === 'table') {
      const header = strings(s.table && s.table.header, MAX_TABLE_COLS, 60)
      const rows = (plain(s.table) && Array.isArray(s.table.rows) ? s.table.rows : []).filter(Array.isArray).slice(0, MAX_TABLE_ROWS).map((r) => r.slice(0, MAX_TABLE_COLS).map((c) => text(String(c ?? ''), 80)))
      if (header.length === 0 || rows.length === 0) return fail(where + ' (table) needs `table`: { header: [...], rows: [[...], ...] } (at most ' + MAX_TABLE_ROWS + ' rows, ' + MAX_TABLE_COLS + ' columns).')
      out.table = { header, rows: rows.map((r) => header.map((_, k) => r[k] ?? '')) }
    }
    if (layout === 'quote') {
      out.quote = text(plain(s.quote) ? s.quote.text : s.quote, 400)
      out.by = text(plain(s.quote) ? s.quote.by : s.by, 100)
      if (out.quote === '') return fail(where + ' (quote) needs `quote`: the sentence, and optionally `by`.')
    }
    if (layout === 'image') {
      const img = plain(s.image) ? s.image : {}
      out.image = { path: text(img.path, 500), data: typeof img.data === 'string' ? img.data : '', alt: text(img.alt, 200), caption: text(img.caption, 160) }
      if (out.image.path === '' && out.image.data === '') return fail(where + ' (image) needs `image`: { path } of a picture file in the working folder (png, jpg, gif or webp).')
    }
    slides.push(out)
  }
  const theme = plain(input.theme) ? { primary: input.theme.primary, accent: input.theme.accent } : {}
  return { ok: true, deck: { title, language: input.language === 'fr' ? 'fr' : 'en', theme, slides } }
}

// ── the slides ───────────────────────────────────────────────────────────────────────────────────────────────────
const px = (n) => Math.round(n) + 'px'
const pos = (x, y, w, h) => 'left:' + px(x) + ';top:' + px(y) + (w === undefined ? '' : ';width:' + px(w)) + (h === undefined ? '' : ';height:' + px(h)) + ';'

const line = (t, { size, color, bold, font } = {}) => '<div class="ln" style="' + (size ? 'font-size:' + px(size) + ';' : '') + (color ? 'color:' + color + ';' : '') + (bold ? 'font-weight:700;' : '') + (font ? 'font-family:' + font + ';' : '') + '">' + rich(t) + '</div>'

const box = (x, y, w, h, inner, { size = 24, color = '#333333', fill, bold, center = false, step, delay = 0, extra = '' } = {}) => {
  const st = pos(x, y, w, h) + 'font-size:' + px(size) + ';color:' + color + ';' + (fill ? 'background:' + fill + ';' : '') + (bold ? 'font-weight:700;' : '') + extra
  const data = step ? ' data-step="' + step + '" data-delay="' + delay + '"' : ''
  return '<div class="b' + (center ? ' ctr' : '') + (step ? ' frag' : '') + '" style="' + st + '"' + data + ' data-e>' + inner + '</div>'
}

const h1 = (t, style = '') => '<h1' + (style !== '' ? ' style="' + style + '"' : '') + ' data-e>' + rich(t) + '</h1>'
const bullets = (items, gap) => '<ul class="bul' + (gap ? ' gap' : '') + '">' + items.map((t) => '<li>' + rich(t) + '</li>').join('') + '</ul>'

/** A font size that keeps `items` inside a block of `room` pixels of height and `width` pixels of width. */
const fit = (items, width, room, max, min) => {
  for (let size = max; size > min; size -= 2) {
    const perLine = Math.max(8, Math.floor(width / (size * 0.52)))
    const lines = items.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / perLine)), 0)
    if (lines * size * 1.25 + items.length * size * 0.55 <= room) return size
  }
  return min
}

// No aria-label on the slide: the player numbers the slides itself and the editor does not write that label back, so a slide nobody touched is saved as it was written.
const slideHtml = (inner, { dark = false, transition = 'fade', notes = '' }) => '<div class="cell"><section class="slide' + (dark ? ' dark' : '') + '" data-transition="' + transition + '">' + inner
  + '<aside class="notes" data-e>' + esc(notes) + '</aside></section></div>'

const LAYOUT = {
  cover: (s, p) => ({
    dark: true,
    inner: h1(s.title, 'left:' + px(MARGIN) + ';top:190px;width:' + px(CONTENT_W) + ';height:170px;font-size:' + (s.title.length > 48 ? '48px' : '60px') + ';display:flex;align-items:flex-end;')
      + (s.subtitle ? box(MARGIN, 384, CONTENT_W, 60, esc(s.subtitle), { size: 28, color: 'var(--pale)' }) : '')
      + (s.tagline ? box(MARGIN, 480, Math.min(CONTENT_W, 60 + s.tagline.length * 14), 56, esc(s.tagline), { size: 22, color: p.onAccent, fill: 'var(--gold)', bold: true, center: true, extra: 'padding:0 22px;border-radius:6px;' }) : ''),
  }),
  section: (s, p) => ({
    dark: true,
    inner: (s.number ? box(MARGIN, 170, 130, 130, esc(s.number), { size: 48, color: p.onAccent, fill: 'var(--gold)', bold: true, center: true, extra: 'border-radius:50%;font-family:Georgia,serif;' }) : '')
      + h1(s.title, 'left:' + px(MARGIN) + ';top:' + (s.number ? 330 : 260) + 'px;width:' + px(CONTENT_W) + ';height:120px;font-size:52px;display:flex;align-items:flex-end;')
      + (s.subtitle ? box(MARGIN, (s.number ? 330 : 260) + 140, CONTENT_W, 60, esc(s.subtitle), { size: 26, color: 'var(--pale)' }) : ''),
  }),
  bullets: (s) => {
    const size = fit(s.bullets, CONTENT_W - 40, 440, 34, 20)
    return { inner: h1(s.title) + box(MARGIN, 190, CONTENT_W, 470, bullets(s.bullets, s.bullets.length <= 4), { size, color: '#333333' }) }
  },
  text: (s) => {
    const size = fit(s.paragraphs, CONTENT_W, 440, 30, 18)
    return { inner: h1(s.title) + box(MARGIN, 190, CONTENT_W, 470, s.paragraphs.map((t) => '<div class="ln" style="margin:0 0 ' + px(size * 0.6) + ';">' + rich(t) + '</div>').join(''), { size, color: '#333333' }) }
  },
  'two-columns': (s) => {
    const colW = (CONTENT_W - 48) / 2
    const size = fit(s.columns.flatMap((c) => c.bullets), colW - 40, 360, 28, 18)
    const col = (c, x) => box(x, 190, colW, 470, (c.heading ? line(c.heading, { size: size + 4, color: 'var(--navy)', bold: true }) + '<div style="height:' + px(size * 0.5) + '"></div>' : '') + bullets(c.bullets, false), { size, color: '#333333' })
    return { inner: h1(s.title) + col(s.columns[0], MARGIN) + col(s.columns[1], MARGIN + colW + 48) }
  },
  stats: (s) => {
    const n = s.stats.length
    const gap = 32
    const w = (CONTENT_W - gap * (n - 1)) / n
    const big = n >= 4 ? 52 : 64
    return { inner: h1(s.title) + s.stats.map((x, i) => box(MARGIN + i * (w + gap), 230, w, 280, line(x.value, { size: big, color: 'var(--navy)', bold: true, font: 'Georgia,serif' }) + (x.label ? line(x.label, { size: 24, color: 'var(--grey)' }) : ''), { fill: 'var(--light)', center: true, step: 1, delay: i === 0 ? 0 : 500 * i, extra: 'border-radius:8px;' })).join('') }
  },
  chart: (s, p) => {
    const c = s.chart
    const spec = { type: c.type, categories: c.categories, labels: c.labels, legend: c.series.length > 1 ? 'bottom' : (c.type === 'doughnut' ? 'right' : 'none'), alt: c.alt || s.title, series: [] }
    if (c.type === 'doughnut') {
      const total = c.series[0].values.reduce((a, b) => a + Math.max(0, b), 0) || 1
      spec.series = [{ name: c.series[0].name, values: c.series[0].values.map((v) => Math.round(Math.max(0, v) / total * 100)) }]
    } else spec.series = c.series.map((x, i) => ({ name: x.name, values: x.values, color: x.color || p.series[i % p.series.length] }))
    const json = escAttr(JSON.stringify(spec))
    return { inner: h1(s.title) + '<div class="chart" style="' + pos(MARGIN, 180, CONTENT_W, 490) + '" data-w="' + CONTENT_W + '" data-h="490" data-chart="' + json + '" role="img" aria-label="' + escAttr(spec.alt) + '"></div>' }
  },
  table: (s) => {
    const rowH = Math.min(64, Math.floor(440 / (s.table.rows.length + 1)))
    const size = rowH >= 56 ? 28 : rowH >= 44 ? 24 : 20
    const tr = (cells, tag) => '<tr style="height:' + rowH + 'px">' + cells.map((c) => '<' + tag + ' data-e>' + rich(c) + '</' + tag + '>').join('') + '</tr>'
    return { inner: h1(s.title) + '<table class="t" style="' + pos(MARGIN, 190, CONTENT_W, rowH * (s.table.rows.length + 1)) + 'font-size:' + size + 'px;" data-e-table><tbody>' + tr(s.table.header, 'th') + s.table.rows.map((r) => tr(r, 'td')).join('') + '</tbody></table>' }
  },
  quote: (s) => ({
    inner: (s.title ? h1(s.title) : '')
      + box(140, s.title ? 210 : 150, SLIDE_W - 280, 300, rich('“' + s.quote + '”'), { size: s.quote.length > 160 ? 34 : 44, color: 'var(--navy)', center: true, extra: 'font-family:Georgia,serif;font-style:italic;' })
      + (s.by ? box(140, s.title ? 530 : 470, SLIDE_W - 280, 50, esc('— ' + s.by), { size: 24, color: 'var(--grey)', center: true }) : ''),
  }),
}

/** The picture of an `image` slide as a `data:` address (checked: a known picture type, not too big), or null. */
const KINDS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
export const imageKind = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m === null ? null : (KINDS[m[1].toLowerCase()] ?? null) }
export const dataUri = (kind, bytes) => 'data:' + kind + ';base64,' + Buffer.from(bytes).toString('base64')
const DATA_URI = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/

const imageSlide = (s, src) => {
  const alt = s.image.alt || s.image.caption || s.title || ''
  const hasTitle = s.title !== ''
  const top = hasTitle ? 180 : 60
  const h = SLIDE_H - top - (s.image.caption ? 90 : 50)
  return {
    inner: (hasTitle ? h1(s.title) : '')
      + '<img class="pic" style="' + pos(MARGIN, top, CONTENT_W, h) + 'object-fit:contain;" src="' + src + '" alt="' + escAttr(alt) + '">'
      + (s.image.caption ? box(MARGIN, top + h + 12, CONTENT_W, 50, esc(s.image.caption), { size: 22, color: 'var(--grey)', center: true }) : ''),
  }
}

/** `<\/script` and `<\!--` inside a script must not end it or hide it in the parser's eyes. */
const inScript = (js) => String(js).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
const inStyle = (css) => String(css).replace(/<\/(style)/gi, '<\\/$1')

/**
 * The file. `deck` comes from `normalize`; `assets` is `{ css, js }` of the installed deck editor; `pictures` maps an `image` slide's path to its `data:` address (the caller read and
 * checked the files). Returns `{ ok: true, html, slides }` or `{ ok: false, error }`.
 */
export function buildDeck (deck, assets, pictures = new Map()) {
  if (!plain(deck) || !Array.isArray(deck.slides)) return fail('Not a deck: run it through normalize() first.')
  if (!plain(assets) || typeof assets.css !== 'string' || typeof assets.js !== 'string' || assets.css === '' || assets.js === '') return fail('The deck editor is not installed: it provides the player the file carries.')
  const p = palette(deck.theme)
  const cells = []
  for (let i = 0; i < deck.slides.length; i++) {
    const s = deck.slides[i]
    let made
    if (s.layout === 'image') {
      const src = s.image.data !== '' ? s.image.data : pictures.get(s.image.path)
      if (typeof src !== 'string' || !DATA_URI.test(src)) return fail('Slide ' + (i + 1) + ' (image): the picture "' + (s.image.path || 'data') + '" could not be read as a png, jpg, gif or webp file.')
      made = imageSlide(s, src)
    } else made = LAYOUT[s.layout](s, p)
    cells.push(slideHtml(made.inner, { dark: made.dark === true, transition: s.transition, notes: s.notes }))
  }
  const theme = ':root{--navy:' + p.primary + ';--gold:' + p.accent + ';--light:' + p.light + ';--grey:' + p.grey + ';--pale:' + p.pale + ';}'
  const html = '<!doctype html>\n<html lang="' + deck.language + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="kybernos-deck" content="1"><title>' + esc(deck.title) + '</title>\n'
    + '<style data-kd="base">' + inStyle(assets.css) + '</style>\n<style data-kd="theme">' + theme + '</style></head>\n'
    + '<body><main id="deck">\n' + cells.join('\n') + '\n</main><script data-kd="runtime">' + inScript(assets.js) + '</script></body></html>\n'
  if (Buffer.byteLength(html) > MAX_DECK_BYTES) return fail('The deck is larger than ' + MAX_DECK_BYTES / 1048576 + ' MB: use fewer or smaller pictures.')
  return { ok: true, html, slides: deck.slides.length }
}
