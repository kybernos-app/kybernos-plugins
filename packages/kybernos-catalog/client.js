// kybernos-catalog — browser half: the Catalog page.
//
// What you sell, rent or recruit for, as cards or a list, with the statuses and fields the active theme defines (docs/dev/business-menu.md).
//   - the row « Catalog » in the Business group of the menu: `window.__KB_MENU__.register`, taken back when the plugin goes away;
//   - the page on the keyed slot `main.kybernos-business` (key `catalog`); the core hands it `{ sessionId, toolbar }`;
//   - the header and the bar are the product's own (`kb6-headrow`, `KbToolbar` from `props.toolbar`); without them the page draws a plain bar of its own;
//   - the host half answers under /kybernos-catalog; every request carries the session cookie, and a write names its Origin by being same-origin.
// Colours come from the DSH tokens (`--dsw-alias-*`), never a value of our own. A picture the person has not added is a neutral tile.
// The factory always returns a plugin; whatever goes wrong here turns the page off, never DSH.
window.__ModuleLoader__.load({
  id: '@local/kybernos-catalog',
  factory: (require) => {
    try {
      const React = require('react')
      const h = React.createElement
      const { useState, useEffect, useRef } = React

      const STYLE_ID = 'kybernos-catalog-style'
      const SLOT = 'main.kybernos-business'
      const ROW_ID = 'catalog'
      const VIEW_KEY = 'kybernos.catalog.view.v1'
      const PAGE = 100
      const MENU_ROW = { id: ROW_ID, group: 'business', icon: 'package', labelKey: 'business.catalog', label: { en: 'Catalog', fr: 'Catalogue' }, order: 20 }
      const MENU_TRIES = 100
      const MENU_EVERY = 150

      // ── words ────────────────────────────────────────────────────────────────────────────────────────────
      const lang = () => {
        try {
          const s = String((typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : document.documentElement.lang) || 'en').toLowerCase()
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => lang() === 'fr' ? fr : en
      /** A `{ en, fr, … }` label in the person's language, else English. */
      const pick = (label, fallback) => {
        if (label === null || typeof label !== 'object') return fallback === undefined ? '' : fallback
        const l = lang() === '' ? 'fr' : lang()
        if (typeof label[l] === 'string') return label[l]
        return typeof label.en === 'string' ? label.en : (fallback === undefined ? '' : fallback)
      }
      const humanize = (key) => String(key === null || key === undefined ? '' : key).replace(/[_-]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase())

      // ── pure helpers (exposed as __test) ──────────────────────────────────────────────────────────────────
      const numberText = (n) => { try { return new Intl.NumberFormat(lang() || undefined).format(n) } catch (e) { return String(n) } }
      const moneyText = (n, currency) => {
        try {
          if (typeof currency !== 'string') return numberText(n)
          return new Intl.NumberFormat(lang() || undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)
        } catch (e) { return String(n) + (currency ? ' ' + currency : '') }
      }
      const dateText = (v) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v))
        if (m === null) return String(v)
        try { return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(lang() || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch (e) { return String(v) }
      }
      /** A stored value as the person reads it, by the kind of its field (a field the type no longer defines is shown as it was written). */
      const valueText = (def, value) => {
        if (value === null || value === undefined || value === '') return ''
        const kind = def === null ? (typeof value === 'number' ? 'number' : 'text') : def.type
        if (kind === 'money' && typeof value === 'number') return moneyText(value, def === null ? undefined : def.currency)
        if (kind === 'number' && typeof value === 'number') return numberText(value)
        if (kind === 'date') return dateText(value)
        return String(value)
      }
      const typeOf = (types, row) => (Array.isArray(types) ? types.find((t) => t.id === row.type) || null : null)
      const statusOf = (type, row) => (type === null ? null : type.statuses.find((s) => s.key === row.status) || null)
      const fieldDef = (type, key) => (type === null ? null : type.fields.find((f) => f.key === key) || null)
      /** What a card shows in one slot: `title` / `subtitle` are the item's own, the others name one of the type's fields. */
      const slotText = (type, row, slot) => {
        if (slot === 'title') return row.title
        if (slot === 'subtitle') return row.subtitle
        return valueText(fieldDef(type, slot), row.fields === null || row.fields === undefined ? undefined : row.fields[slot])
      }
      /** The flag of a card (« Only 3 left »), or null: the type's `card.flag` read against the row's own value. */
      const flagText = (type, row) => {
        const flag = type === null || type.card === undefined ? undefined : type.card.flag
        if (flag === undefined || row.fields === null || row.fields === undefined) return null
        const v = row.fields[flag.field]
        if (typeof v !== 'number') return null
        const hit = (typeof flag.lte === 'number' && v <= flag.lte) || (typeof flag.gte === 'number' && v >= flag.gte)
        return hit ? pick(flag.label).replace(/\{n\}/g, numberText(v)) : null
      }
      /** The four lines of a card or a row, whether or not a theme defines the item's type. */
      const cardOf = (type, row) => {
        const card = type === null || type.card === undefined ? {} : type.card
        const title = card.title !== undefined ? slotText(type, row, card.title) : row.title
        const subtitle = card.subtitle !== undefined ? slotText(type, row, card.subtitle) : row.subtitle
        const priced = card.price !== undefined ? slotText(type, row, card.price) : ''
        const company = card.company !== undefined ? slotText(type, row, card.company) : ''
        return { title: title !== '' ? title : row.title, subtitle, company, price: priced !== '' ? priced : row.price_text, flag: flagText(type, row) }
      }
      /** The subtitle line of a card, a row or the panel; led by the company's drawn mark when the type says that line is a company (`card.company`). */
      const SubLine = (props) => {
        const { card, tag } = props
        const K = kitOf()
        if (card.company === '' || card.company !== card.subtitle || K === null || typeof K.Logo !== 'function') return h(tag, props.className === undefined ? null : { className: props.className }, card.subtitle)
        return h(tag, { className: (props.className === undefined ? '' : props.className + ' ') + 'kbcg-co', 'data-kb': 'catalog-company' }, h('span', { className: 'kbcg-comark', 'aria-hidden': 'true' }, h(K.Logo, { name: card.company, size: 18 })), h('span', null, card.subtitle))
      }
      const archivedRow = (row) => row.archived_at !== null && row.archived_at !== undefined
      /** The views the page offers: those of the type in view, or of every type, in the order cards, list. */
      const viewsOf = (types, typeKey) => {
        const chosen = typeKey === '' ? types : types.filter((t) => t.id === typeKey)
        const all = ['cards', 'list', 'map'].filter((v) => chosen.some((t) => t.views.indexOf(v) >= 0))
        return all.length > 0 ? all : ['cards', 'list']
      }
      /** The status chips: the statuses of the type in view (the union by key when every type is in view), with the counts of the same search. */
      const chipsOf = (types, typeKey, counts, partial) => {
        const chosen = typeKey === '' ? types : types.filter((t) => t.id === typeKey)
        const out = []
        for (const t of chosen) for (const s of t.statuses) if (out.every((c) => c.key !== s.key)) out.push({ key: s.key, label: pick(s.label, humanize(s.key)), tone: s.tone, count: partial === true ? null : (counts && typeof counts[s.key] === 'number' ? counts[s.key] : 0) })
        return out
      }
      // ── pictures, chips, the shortlist and the map: pure helpers ──────────────────────────────────────────────────────────
      const ART_OF_ICON = { home: 'house', package: 'box', briefcase: 'desk', tag: 'bag', wrench: 'shop', book: 'desk' }
      const PHOTO_RE = /^photo:([a-z0-9][a-z0-9-]{1,39}\/[a-z0-9][a-z0-9-]{1,59})$/
      const kitOf = () => { try { return typeof window !== 'undefined' && window.__KB_BIZ_KIT__ ? window.__KB_BIZ_KIT__ : null } catch (e) { return null } }
      /** The picture reference an item carries (the field the type names in `card.image`), or ''. */
      const pictureRef = (type, row) => {
        const key = type !== null && type.card !== undefined ? type.card.image : undefined
        const v = key === undefined || row.fields === null || row.fields === undefined ? '' : row.fields[key]
        return typeof v === 'string' ? v : ''
      }
      /** The drawn picture an item falls back to: the kind that goes with its type's icon, seeded by the item. */
      const fallbackArt = (type, row) => 'art:' + (ART_OF_ICON[type === null ? 'package' : type.icon] || 'box') + '/' + String(row.id)
      /** The hue of an energy-class chip (a choice of the letters A to G runs from green to red); undefined for any other field. */
      const energyHue = (def, value) => {
        if (def === null || def.type !== 'choice' || !Array.isArray(def.options) || def.options.length === 0 || !def.options.every((o) => /^[A-G]$/.test(o))) return undefined
        const at = 'ABCDEFG'.indexOf(String(value))
        return at < 0 ? undefined : [146, 118, 90, 56, 36, 20, 4][at]
      }
      const STAT_ICON = { surface: 'ruler', rooms: 'bed', stock: 'layers', price: 'tag' }
      /** A number field as a short stat: « 68 m² » (the unit is the one in the field's label) or « 3 rooms ». */
      const statText = (def, value) => {
        if (def.type === 'money') return moneyText(value, def.currency)
        const label = pick(def.label, humanize(def.key))
        const unit = /\(([^)]{1,8})\)\s*$/.exec(label)
        return numberText(value) + ' ' + (unit !== null ? unit[1] : label.toLowerCase())
      }
      /** What a card shows under its picture, from `card.chips`: coloured tags for choices and text, plain stats for numbers. */
      const cardChips = (type, row) => {
        const keys = type === null || type.card === undefined || !Array.isArray(type.card.chips) ? [] : type.card.chips
        const out = []
        for (const key of keys) {
          const def = fieldDef(type, key)
          const v = row.fields === null || row.fields === undefined ? undefined : row.fields[key]
          if (def === null || v === undefined || v === null || v === '') continue
          if (def.type === 'number' || def.type === 'money') { if (typeof v === 'number') out.push({ key, stat: true, text: statText(def, v), icon: STAT_ICON[key] }) } else out.push({ key, stat: false, text: valueText(def, v), hue: energyHue(def, v) })
        }
        return out
      }
      /** The price on a map pin: « €385k », « €1.45M », « €780 ». */
      const pinPrice = (row) => {
        const n = typeof row.price_num === 'number' ? row.price_num : null
        const sym = (/[€$£]/.exec(String(row.price_text === undefined ? '' : row.price_text)) || [''])[0]
        if (n === null) return row.price_text === undefined || row.price_text === '' ? '…' : String(row.price_text).split(' ')[0]
        if (n >= 1000000) return sym + String(Math.round(n / 10000) / 100).replace(/\.?0+$/, '') + 'M'
        if (n >= 10000) return sym + Math.round(n / 1000) + 'k'
        return sym + numberText(n)
      }
      /** The items that have a place (the two number fields a type names in `map`), as { row, type, lat, lng }. */
      const placedRows = (rows, types) => {
        const out = []
        for (const row of rows) {
          const type = typeOf(types, row)
          if (type === null || type.map === undefined || row.fields === null || row.fields === undefined) continue
          const lat = row.fields[type.map.lat]
          const lng = row.fields[type.map.lng]
          if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push({ row, type, lat, lng })
        }
        return out
      }
      const MAP_W = 1000
      const MAP_H = 720
      /** The screen place of every pin on the 1000 x 720 map: the box around them (a little padded) fills it, north up, east right. */
      const projectPins = (placed, width, height) => {
        const W = width === undefined ? MAP_W : width
        const H = height === undefined ? MAP_H : height
        if (placed.length === 0) return []
        const lats = placed.map((p) => p.lat)
        const lngs = placed.map((p) => p.lng)
        const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
        const lng0 = (Math.min(...lngs) + Math.max(...lngs)) / 2
        const kx = Math.cos(lat0 * Math.PI / 180)
        const dx = Math.max(...lngs.map((v) => Math.abs(v - lng0) * kx), 0.002)
        const dy = Math.max(...lats.map((v) => Math.abs(v - lat0)), 0.002)
        const scale = Math.min((W / 2 - 110) / dx, (H / 2 - 90) / dy)
        return placed.map((p) => Object.assign({}, p, { x: Math.round((W / 2 + (p.lng - lng0) * kx * scale) * 10) / 10, y: Math.round((H / 2 - (p.lat - lat0) * scale) * 10) / 10 }))
      }
      // ── the real map: pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────
      // The Map view draws a REAL map (MapLibre GL, OpenFreeMap tiles) when it can and the drawn one (MapView) when it cannot. Nothing is fetched until the person opens
      // the view: not the library, not the style, not a tile (docs/dev/business-visuals.md says what is asked of whom). Everything below is pure so it can be tested.
      const MAP_LIB_VERSION = '5.24.0'
      const MAP_LIB = { js: '/kybernos-catalog/vendor/maplibre-gl.js?v=' + MAP_LIB_VERSION, css: '/kybernos-catalog/vendor/maplibre-gl.css?v=' + MAP_LIB_VERSION }
      const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
      const MAP_BUDGET_MS = 8000 // library + style + first tiles must be on screen by then, else the drawn map takes over
      const MAP_RETRY_MS = 60000 // after a failure the drawn map shows at once for this long (the button asks again)
      const MAP_MAX_ZOOM = 18
      const MAP_FIT = { padding: { top: 64, bottom: 64, left: 64, right: 72 }, maxZoom: 15.5 }
      const PIN_BOX = { w: 66, h: 30 } // the room a price pill takes on screen, in px: pills closer than this make a cluster
      const ATTRIBUTION = [
        { text: 'OpenFreeMap', href: 'https://openfreemap.org' },
        { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
        { text: 'Data © OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
      ]
      /** Where a place is on the world map at a zoom, in pixels (MapLibre's 512 px tiles): x grows east, y grows south. */
      const worldPx = (lat, lng, zoom) => {
        const size = 512 * Math.pow(2, zoom)
        const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180)
        return { x: (lng + 180) / 360 * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size }
      }
      /**
       * The pins as the screen shows them at a zoom: places whose price pills would overlap (closer than `box` in pixels) make one cluster, with its count and the middle
       * of its members. The answer depends on the zoom only, never on where the map looks, so panning moves nothing. The order of the list is kept.
       */
      const clusterPins = (placed, zoom, box) => {
        const b = box === undefined ? PIN_BOX : box
        const pts = placed.map((p) => Object.assign({ p }, worldPx(p.lat, p.lng, zoom)))
        const taken = pts.map(() => false)
        const out = []
        for (let i = 0; i < pts.length; i += 1) {
          if (taken[i]) continue
          taken[i] = true
          const members = [i]
          for (let j = i + 1; j < pts.length; j += 1) {
            if (!taken[j] && Math.abs(pts[j].x - pts[i].x) < b.w && Math.abs(pts[j].y - pts[i].y) < b.h) { taken[j] = true; members.push(j) }
          }
          const items = members.map((k) => pts[k].p)
          const ids = items.map((q) => q.row.id)
          out.push({ key: items.length === 1 ? 'p' + ids[0] : 'c' + ids.slice().sort((x, y) => x - y).join('-'), lat: items.reduce((n, q) => n + q.lat, 0) / items.length, lng: items.reduce((n, q) => n + q.lng, 0) / items.length, items, count: items.length })
        }
        return out
      }
      /** The smallest zoom from `from` (`from` itself, then half steps up to `max`) at which the item stands alone on the map; `max` when it never does (two items on the same spot). */
      const aloneZoom = (item, placed, from, max) => {
        const alone = (z) => { const c = clusterPins(placed, z).find((k) => k.items.some((q) => q.row.id === item.row.id)); return c !== undefined && c.count === 1 }
        if (alone(from)) return from
        for (let z = Math.ceil(from * 2) / 2; z <= max; z += 0.5) if (z > from && alone(z)) return z
        return max
      }
      /** The box around some places as [[west, south], [east, north]], or null when there are none. */
      const boundsOf = (placed) => {
        if (placed.length === 0) return null
        const lats = placed.map((p) => p.lat)
        const lngs = placed.map((p) => p.lng)
        return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]
      }
      /** What a click on a cluster does: bring its members into view, or, when they stand on one spot that no zoom will ever part, open the first of them. */
      const clusterAction = (items) => {
        const b = boundsOf(items)
        const metres = Math.hypot((b[1][1] - b[0][1]) * 111320, (b[1][0] - b[0][0]) * 111320 * Math.cos((b[0][1] + b[1][1]) / 2 * Math.PI / 180))
        return metres < 3 ? { kind: 'pick', row: items[0].row } : { kind: 'fit', bounds: b }
      }
      /** Whether the real map may start, from what is known before any request: `{ use, why }`, `why` being what the caption of the drawn map says. */
      const mapGate = (env) => {
        if (env.placed === 0) return { use: false, why: 'empty' } // nothing to put on a map: nothing is asked of anyone
        if (env.webgl === false) return { use: false, why: 'webgl' }
        if (env.online === false) return { use: false, why: 'offline' }
        if (env.failure !== null && env.now - env.failure.at < MAP_RETRY_MS) return { use: false, why: env.failure.why }
        return { use: true, why: '' }
      }
      /**
       * What the start of the real map has come to, from what has been seen: `{ state: 'wait' | 'ready' | 'fallback', why }`. A map whose tiles all failed is as useless as
       * one that never came, so it falls back too; a slow map that has drawn something stays.
       */
      const startVerdict = (s) => {
        if (s.loaded && s.ok === 0 && s.errors > 0) return { state: 'fallback', why: 'tiles' }
        if (s.loaded) return { state: 'ready', why: '' }
        if (s.elapsed >= s.budget) return s.ok > 0 ? { state: 'ready', why: '' } : { state: 'fallback', why: s.errors > 0 ? 'tiles' : 'timeout' }
        return { state: 'wait', why: '' }
      }
      let mapFailure = null // { at, why }: the last time the real map could not start (this page load only)

      // colours of the basemap: the style's own colours are replaced by the page's tokens, so a light or dark page gets its own map
      const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
      /** Six hex digits after the hash, or eight when the colour is not opaque: the one form written into the style. */
      const colorHex = (c) => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + (c.length > 3 && c[3] < 1 ? hex2(c[3] * 255) : '')
      const hslToRgb = (h, s, l) => {
        const k = (n) => (n + h / 30) % 12
        const a = s * Math.min(l, 1 - l)
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
        return [f(0) * 255, f(8) * 255, f(4) * 255]
      }
      const rgbToHsl = (c) => {
        const r = c[0] / 255
        const g = c[1] / 255
        const b = c[2] / 255
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const l = (max + min) / 2
        const d = max - min
        if (d === 0) return [0, 0, l]
        const s = d / (1 - Math.abs(2 * l - 1))
        const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : (max === g ? (b - r) / d + 2 : (r - g) / d + 4)
        return [h * 60, s, l]
      }
      /** A colour the style may hold (hex, rgb or hsl notation, with or without alpha) as [r, g, b] or [r, g, b, a]; null for anything else. */
      const parseColor = (text) => {
        const s = String(text).trim().toLowerCase()
        let m = /^#([0-9a-f]{3,8})$/.exec(s)
        if (m !== null) {
          let x = m[1]
          if (x.length === 3 || x.length === 4) x = x.split('').map((ch) => ch + ch).join('')
          if (x.length !== 6 && x.length !== 8) return null
          const out = [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
          return x.length === 8 ? out.concat([parseInt(x.slice(6, 8), 16) / 255]) : out
        }
        m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
        if (m === null) return null
        const parts = m[2].split(/[\s,/]+/).filter((x) => x !== '')
        if (parts.length < 3 || parts.length > 4) return null
        const nums = parts.map((x) => (x.slice(-1) === '%' ? Number(x.slice(0, -1)) / 100 : Number(x)))
        if (nums.some((n) => !Number.isFinite(n))) return null
        const alpha = parts.length === 4 ? [nums[3]] : []
        if (m[1].slice(0, 3) === 'rgb') return [0, 1, 2].map((i) => (parts[i].slice(-1) === '%' ? nums[i] * 255 : nums[i])).concat(alpha)
        return hslToRgb(((nums[0] % 360) + 360) % 360, nums[1], nums[2]).concat(alpha)
      }
      const mixColor = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
      const lumaOf = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
      /** A colour of the light style as the dark page wants it: the lightness turned over, the colour kept (for the layers no role knows). */
      const flipColor = (c) => {
        const [h, s, l] = rgbToHsl(c)
        return hslToRgb(h, s * 0.6, 1 - l).concat(c.length > 3 ? [c[3]] : [])
      }
      const MAP_TOKENS = ['l1', 'l2', 'l3', 't1', 't2', 't3', 'blue', 'ok']
      /**
       * The colours the basemap takes, from the page's tokens as [r, g, b] each. Every grey is a step from the page's own surface toward its ink (`tone`): lighter than the
       * surface in a dark page, darker in a light one (whose three layers are all white, so the layers themselves cannot be the steps). Water and parks are a tint of the
       * product's blue and green over the land. The same recipe gives the light and the dark map: only the tokens differ.
       */
      const paletteFrom = (tok) => {
        const dark = lumaOf(tok.l1) < 0.45
        const tone = (x) => mixColor(tok.l1, tok.t1, x)
        const land = tone(0.045)
        return {
          dark,
          land,
          landSoft: tone(0.06),
          park: mixColor(land, tok.ok, 0.17),
          water: mixColor(land, tok.blue, dark ? 0.3 : 0.26),
          waterLine: mixColor(land, tok.blue, dark ? 0.4 : 0.36),
          building: tone(0.075),
          buildingEdge: tone(0.115),
          roadMajor: dark ? tone(0.15) : tok.l1,
          roadSubtle: tone(0.085),
          roadMinor: tone(0.095),
          roadEdge: dark ? tone(0) : tone(0.115),
          rail: tone(0.12),
          boundary: mixColor(land, tok.t3, 0.5),
          label: tok.t2,
          labelSoft: mixColor(tok.t3, tok.t2, 0.4),
          labelWater: mixColor(tok.blue, tok.t2, dark ? 0.2 : 0.35),
          halo: land,
        }
      }
      /** What the style loses, whatever the page: shields, airports, the dashed lines of districts, tunnels, piers, ice, bridges of motorways, state names. */
      const STYLE_HIDE = /^(highway-shield|road_shield|airport|aeroway|boundary_3|boundary_disputed|railway_(transit|service)|label_state|tunnel_|road_(area_)?pier|landcover_(ice|glacier)|highway_motorway_bridge)/
      /** Fewer street names and district names at a given zoom: the pills are the loudest thing on the map, the names only help to find a place. */
      const STYLE_MINZOOM = { 'highway-name-minor': 16, 'highway-name-path': 17, 'highway-name-major': 13.5, label_other: 13, label_village: 12.5, label_town: 11.5 }
      /** The paint property of a layer id → the palette colour it takes. The first matching line wins. */
      const STYLE_ROLES = [
        [/^background$/, { 'background-color': 'land' }],
        [/^(park|landcover_wood)$/, { 'fill-color': 'park' }],
        [/^landuse_/, { 'fill-color': 'landSoft' }],
        [/^water$/, { 'fill-color': 'water' }],
        [/^waterway$/, { 'line-color': 'waterLine' }],
        [/^building$/, { 'fill-color': 'building', 'fill-outline-color': 'buildingEdge' }],
        [/_casing$/, { 'line-color': 'roadEdge' }],
        [/^highway_(major|motorway)_inner$/, { 'line-color': 'roadMajor' }],
        [/^highway_(major|motorway)_subtle$/, { 'line-color': 'roadSubtle' }],
        [/^highway_(minor|path)$/, { 'line-color': 'roadMinor' }],
        [/^railway/, { 'line-color': 'rail' }],
        [/^boundary/, { 'line-color': 'boundary' }],
        [/^(water_name|waterway_line_label)/, { 'text-color': 'labelWater', 'text-halo-color': 'halo' }],
        [/^highway-name/, { 'text-color': 'labelSoft', 'text-halo-color': 'halo' }],
        [/^label_/, { 'text-color': 'label', 'text-halo-color': 'halo' }],
      ]
      const recolor = (value, fn) => {
        if (typeof value === 'string') { const c = parseColor(value); return c === null ? value : fn(c) }
        return Array.isArray(value) ? value.map((v) => recolor(v, fn)) : value
      }
      const renamed = (value, lang) => (Array.isArray(value)
        ? (value.length === 2 && value[0] === 'get' && value[1] === 'name_en' ? ['get', 'name:' + lang] : value.map((v) => renamed(v, lang)))
        : value)
      /**
       * The basemap style (OpenFreeMap's « positron », as fetched) made quiet and ours: the layers a price map does not need are dropped, street and district names are fewer,
       * the colours come from the palette (a layer no role knows keeps its colour in a light page and has its lightness turned over in a dark one), the dot icons and the
       * sprite are gone (so the sprite is never asked for), and names follow the person's language. Pure: the style it was given is not touched.
       */
      const tweakStyle = (style, palette, options) => {
        const opts = options === undefined ? {} : options
        const out = JSON.parse(JSON.stringify(style))
        out.layers = out.layers.filter((layer) => !STYLE_HIDE.test(layer.id))
        delete out.sprite
        for (const layer of out.layers) {
          if (STYLE_MINZOOM[layer.id] !== undefined) layer.minzoom = STYLE_MINZOOM[layer.id]
          if (layer.type === 'symbol' && layer.layout !== undefined) {
            for (const k of Object.keys(layer.layout)) if (k.indexOf('icon-') === 0) delete layer.layout[k]
            if (opts.lang === 'fr' && layer.layout['text-field'] !== undefined) layer.layout['text-field'] = renamed(layer.layout['text-field'], 'fr')
          }
          if (palette === null || palette === undefined || layer.paint === undefined) continue
          const role = STYLE_ROLES.find((r) => r[0].test(layer.id))
          for (const k of Object.keys(layer.paint)) {
            if (!/color$/.test(k)) continue
            if (role !== undefined && role[1][k] !== undefined) layer.paint[k] = colorHex(palette[role[1][k]])
            else if (palette.dark) layer.paint[k] = recolor(layer.paint[k], (c) => colorHex(flipColor(c)))
          }
        }
        const used = new Set(out.layers.map((l) => l.source).filter((s) => s !== undefined))
        for (const id of Object.keys(out.sources || {})) if (!used.has(id)) delete out.sources[id]
        return out
      }
      const SHORT_KEY = 'kybernos.catalog.shortlist.v1'
      const readShortlist = () => { try { const v = JSON.parse(window.localStorage.getItem(SHORT_KEY)); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)).slice(0, 500) : [] } catch (e) { return [] } }
      const saveShortlist = (list) => { try { window.localStorage.setItem(SHORT_KEY, JSON.stringify(list.slice(0, 500))) } catch (e) { /* no storage: the shortlist lasts for this page */ } }
      const priceOf = (row) => (typeof row.price_num === 'number' ? row.price_num : Number.POSITIVE_INFINITY)
      /** The order the person asked for, on the rows loaded: the host's own order (latest change first) is `modified`. */
      const sortRows = (rows, sort, dir) => {
        if (sort === 'modified' || (sort !== 'price' && sort !== 'name')) return dir === 'asc' ? rows.slice().reverse() : rows
        const out = rows.slice().sort((a, b) => (sort === 'price' ? (priceOf(a) === priceOf(b) ? 0 : priceOf(a) < priceOf(b) ? -1 : 1) : String(a.title).localeCompare(String(b.title), lang() || undefined, { sensitivity: 'base' })))
        return dir === 'desc' ? out.reverse() : out
      }
      const sumCounts = (counts) => Object.keys(counts || {}).reduce((n, k) => n + counts[k], 0)
      const pageTitle = (types, source) => (source === 'theme' && types.length === 1 ? pick(types[0].plural, kt('Catalogue', 'Catalog')) : kt('Catalogue', 'Catalog'))
      /** The words of the « new » button: « New product » for one type, a plain « New » when several. French avoids an article the label could get wrong. */
      const newLabel = (types) => {
        if (types.length !== 1) return kt('Ajouter', 'New')
        const label = pick(types[0].label, '')
        if (types[0].id === 'item' || label === '') return kt('Nouvel élément', 'New item')
        return kt('Ajouter · ' + label, 'New ' + label.toLowerCase())
      }
      const errorText = (code, status) => {
        if (status === 401 || status === 403 || status === 503) return kt('Ta session a expiré. Recharge la page pour te reconnecter.', 'Your session has expired. Reload the page to sign in again.')
        switch (code) {
          case 'base_missing': return kt('Le fichier de données partagé n’est pas disponible dans cette version de Kybernos.', 'The shared data file is not available in this version of Kybernos.')
          case 'sqlite_unavailable': return kt('Cette version de Node ne sait pas ouvrir le fichier de données.', 'This version of Node cannot open the data file.')
          case 'busy': return kt('Le fichier de données est occupé. Réessaie dans un instant.', 'The data file is busy. Try again in a moment.')
          case 'unknown_type': return kt('Ce type n’existe pas dans ton thème.', 'This type does not exist in your theme.')
          case 'unknown_status': return kt('Ce statut n’existe pas pour ce type.', 'This status does not exist for this type.')
          case 'unknown_field': case 'bad_field': return kt('Une valeur n’est pas valide. Vérifie les champs et réessaie.', 'A value is not valid. Check the fields and try again.')
          case 'missing_field': return kt('Il manque un titre.', 'A title is missing.')
          case 'not_found': return kt('Cet élément n’existe plus.', 'This item no longer exists.')
          default: return status === 0 ? kt('Le serveur local ne répond pas. Réessaie dans un instant.', 'The local server is not answering. Try again in a moment.') : kt('Impossible de terminer. Réessaie dans un instant.', 'Could not finish. Try again in a moment.')
        }
      }
      /** The blank form of a type, or the form of a row. Every input is a string; numbers are parsed when the form is sent. */
      const formOf = (type, row) => {
        const f = { title: row ? row.title : '', subtitle: row ? row.subtitle : '', price_text: row ? row.price_text : '', type: type.id, status: row && statusOf(type, row) !== null ? row.status : type.statuses[0].key, fields: {} }
        for (const def of type.fields) { const v = row && row.fields ? row.fields[def.key] : undefined; f.fields[def.key] = v === undefined || v === null ? '' : String(v) }
        return f
      }
      /** The body of a create or an update from a form. A row of an unknown type only edits its own lines (no type, status or fields). */
      const payloadOf = (type, form, editing) => {
        const body = { title: form.title.trim(), subtitle: form.subtitle.trim(), price_text: form.price_text.trim() }
        if (type === null) return { ok: true, body }
        if (!editing) body.type = form.type
        body.status = form.status
        const fields = {}
        for (const def of type.fields) {
          const raw = form.fields[def.key]
          const v = raw === undefined ? '' : String(raw).trim()
          if (v === '') fields[def.key] = null
          else if (def.type === 'number' || def.type === 'money') { const n = Number(v.replace(',', '.')); if (!Number.isFinite(n)) return { ok: false, field: def.key }; fields[def.key] = n } else fields[def.key] = v
        }
        body.fields = fields
        return { ok: true, body }
      }
      const readView = () => { try { const v = window.localStorage.getItem(VIEW_KEY); return v === 'list' || v === 'cards' || v === 'map' ? v : '' } catch (e) { return '' } }
      const saveView = (v) => { try { window.localStorage.setItem(VIEW_KEY, v) } catch (e) { /* no storage: the view is the default next time */ } }

      // ── the host ─────────────────────────────────────────────────────────────────────────────────────────
      /** `{ status, json }`; status 0 when the server did not answer. Never throws. */
      const api = async (method, path, body) => {
        try {
          const res = await fetch('/kybernos-catalog/' + path, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
          let json = null
          try { json = await res.json() } catch (e) { json = null }
          return { status: res.status, json }
        } catch (e) { return { status: 0, json: null } }
      }
      const failed = (r) => (r.status !== 200 || r.json === null || r.json.ok !== true)
      const codeOf = (r) => (r.json !== null && typeof r.json.error === 'string' ? r.json.error : '')

      // ── icons (the pictures the point lets a type choose, and the page's own) ────────────────────────────
      const PATHS = {
        package: 'm7.5 4.3 9 5.2M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7l8.7 5 8.7-5M12 22V12',
        home: 'm3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10',
        briefcase: 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
        tag: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7.5 7.5h.01',
        wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z',
        book: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
        search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.3-4.3',
        plus: 'M5 12h14M12 5v14',
        x: 'M18 6 6 18M6 6l12 12',
        edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
        archive: 'M3 4h18v4H3zM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4',
        undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
        alert: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
        refresh: 'M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M21 21v-5h-5',
        grid: 'M4 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM14 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',
        list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
        heart: 'M12 20.5S3.5 15.4 3.5 9.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.5 1.8c0 6-8.5 11.1-8.5 11.1z',
        minus: 'M5 12h14',
        fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
        map: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20',
      }
      const Ic = (name, size) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, h('path', { d: PATHS[name] === undefined ? PATHS.package : PATHS[name] }))

      // ── the styles: tokens only ──────────────────────────────────────────────────────────────────────────
      const CSS = `
      .kbcg{--kbcg-l1:var(--dsw-alias-bg-layer-1);--kbcg-l2:var(--dsw-alias-bg-layer-2);--kbcg-l3:var(--dsw-alias-bg-layer-3);--kbcg-b1:var(--dsw-alias-border-l1);--kbcg-b2:var(--dsw-alias-border-l2);--kbcg-b3:var(--dsw-alias-border-l3);
        --kbcg-t1:var(--dsw-alias-label-primary);--kbcg-t2:var(--dsw-alias-label-secondary);--kbcg-t3:var(--dsw-alias-label-tertiary);--kbcg-fg:var(--dsw-alias-label-primary-foreground);--kbcg-brand:var(--dsw-alias-brand-primary);--kbcg-accent:var(--dsw-alias-brand-primary-new-color,var(--dsw-alias-state-business-primary));--kbcg-blue:var(--dsw-alias-state-business-primary);
        --kbcg-hover:var(--dsw-alias-interactive-bg-hover);--kbcg-ok:var(--dsw-alias-state-success-primary);--kbcg-warn:var(--dsw-alias-state-warn-primary);--kbcg-bad:var(--dsw-alias-state-error-primary);--kbcg-bone:var(--dsw-alias-bg-skeleton);
        display:flex;flex-direction:column;gap:14px;min-width:0;padding-bottom:48px;color:var(--kbcg-t1);font-size:13px;line-height:1.5;box-sizing:border-box}
      .kbcg *,.kbcg *::before,.kbcg *::after{box-sizing:border-box}
      .kbcg button{font:inherit;color:inherit;cursor:pointer}
      .kbcg button:focus-visible,.kbcg [tabindex]:focus-visible,.kbcg input:focus-visible,.kbcg select:focus-visible,.kbcg textarea:focus-visible{outline:2px solid var(--kbcg-accent);outline-offset:2px}
      .kbcg .kbcg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
      .kbcg .kbcg-sub{margin:0;color:var(--kbcg-t2);max-width:62ch}
      /* the primary action is the core's (kb8-primary): its colours must win over the line above */
      .kbcg .kb8-primary{color:var(--dsw-alias-label-primary-foreground)}
      .kbcg .kb8-primary:disabled{opacity:.5;cursor:default}
      .kbcg .kb6-search input::-webkit-search-cancel-button,.kbcg .kb6-search input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}
      .kbcg .kb6-tb-trailing{display:flex;align-items:center}
      .kbcg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding-inline:14px;border-radius:16px;border:1px solid var(--kbcg-b2);background:transparent;white-space:nowrap;transition:background-color .15s}
      .kbcg-btn:hover:not(:disabled){background:var(--kbcg-hover)}
      .kbcg-btn.primary{background:var(--kbcg-brand);color:var(--kbcg-fg);border-color:transparent}
      .kbcg-btn.primary:hover:not(:disabled){background:var(--kbcg-brand);opacity:.88}
      .kbcg-btn.danger{border-color:color-mix(in srgb,var(--kbcg-bad) 55%,transparent);color:var(--kbcg-bad)}
      .kbcg-btn:disabled{opacity:.5;cursor:default}
      .kbcg-btn.sm{height:28px;padding-inline:11px;font-size:12.5px}
      .kbcg-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .kbcg-chip{border:1px solid var(--kbcg-b2);border-radius:999px;padding:4px 12px;font-size:12.5px;background:transparent;color:var(--kbcg-t2);white-space:nowrap;transition:background-color .15s}
      .kbcg-chip:hover{color:var(--kbcg-t1);background:var(--kbcg-hover)}
      .kbcg-chip[aria-pressed="true"]{background:var(--kbcg-brand);color:var(--kbcg-fg);border-color:transparent;font-weight:600}
      .kbcg-toggle{margin-inline-start:8px}
      .kbcg-chip .n{opacity:.7;margin-inline-start:5px;font-variant-numeric:tabular-nums}
      .kbcg-tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;border-radius:999px;padding:1px 8px;white-space:nowrap;background:var(--kbcg-l3);color:var(--kbcg-t2)}
      .kbcg-tag.ok{background:color-mix(in srgb,var(--kbcg-ok) 16%,var(--kbcg-l1));color:var(--kbcg-ok)}
      .kbcg-tag.warn{background:color-mix(in srgb,var(--kbcg-warn) 18%,var(--kbcg-l1));color:var(--kbcg-warn)}
      .kbcg-tag.bad{background:color-mix(in srgb,var(--kbcg-bad) 16%,var(--kbcg-l1));color:var(--kbcg-bad)}
      .kbcg-tag.demo{background:transparent;border:1px dashed var(--kbcg-b3);color:var(--kbcg-t3);font-weight:500}
      .kbcg-banner{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;border:1px dashed var(--kbcg-b3);border-radius:12px;padding:8px 14px;color:var(--kbcg-t2)}
      .kbcg-banner .sp{flex:1 1 220px}
      .kbcg-banner.err{border-style:solid;border-color:color-mix(in srgb,var(--kbcg-bad) 45%,transparent);background:color-mix(in srgb,var(--kbcg-bad) 7%,transparent);color:var(--kbcg-t1)}
      .kbcg-banner svg{flex:none;color:var(--kbcg-bad)}
      .kbcg-main{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
      .kbcg-main.withpanel{grid-template-columns:minmax(0,1fr) 340px}
      .kbcg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
      .kbcg-card{display:flex;flex-direction:column;text-align:start;padding:0;border:1px solid var(--kbcg-b2);border-radius:12px;background:var(--kbcg-l1);overflow:hidden;min-width:0;transition:box-shadow .15s,transform .15s}
      .kbcg-card:hover{box-shadow:0 8px 22px color-mix(in srgb,var(--kbcg-t1) 12%,transparent)}
      .kbcg-card[aria-current="true"]{box-shadow:0 0 0 2px var(--kbcg-accent)}
      .kbcg-tile{display:grid;place-items:center;position:relative;aspect-ratio:4/3;width:100%;background:color-mix(in srgb,var(--kbcg-accent) calc(var(--tone,8) * 1%),var(--kbcg-l3));color:var(--kbcg-t3);box-shadow:inset 0 -1px 0 var(--kbcg-b1)}
      .kbcg-tile.wide{aspect-ratio:16/9;border-radius:10px}
      .kbcg-tile svg{width:34px;height:34px;stroke-width:1.5}
      .kbcg-tile .kbcg-tag{position:absolute;inset-inline-start:8px;top:8px}
      .kbcg-tile .kbcg-tag:not(.ok):not(.warn):not(.bad){background:var(--kbcg-l1);box-shadow:inset 0 0 0 1px var(--kbcg-b2)}
      .kbcg-tile .kbcg-tag.demo{inset-inline-start:8px;inset-inline-end:auto;top:auto;bottom:8px;background:var(--kbcg-l1)}
      .kbcg-body{display:flex;flex-direction:column;gap:3px;padding:10px 12px 12px;min-width:0}
      .kbcg-body b{font-weight:650;font-size:14px;line-height:1.3;overflow-wrap:anywhere}
      .kbcg-body small{color:var(--kbcg-t3);font-size:12px;overflow-wrap:anywhere}
      .kbcg-co{display:flex;align-items:center;gap:7px;min-width:0}
      .kbcg-comark{display:inline-flex;flex:none;line-height:0}
      .kbcg-price{font-weight:650}
      .kbcg-flag{font-size:11.5px;font-weight:600;color:var(--kbcg-warn)}
      .kbcg-tbl{width:100%;border-collapse:collapse}
      .kbcg-tbl th{font-size:12px;color:var(--kbcg-t3);font-weight:650;text-align:start;padding:8px 10px;border-bottom:1px solid var(--kbcg-b2)}
      .kbcg-tbl td{padding:9px 10px;border-bottom:1px solid var(--kbcg-b1);vertical-align:middle}
      .kbcg-tbl tr.r{cursor:pointer}
      .kbcg-tbl tr.r:hover td{background:var(--kbcg-hover)}
      .kbcg-tbl tr.r[aria-current="true"] td{background:var(--kbcg-l2)}
      .kbcg-tbl .who b{display:block;font-weight:600;overflow-wrap:anywhere}
      .kbcg-tbl .who small{display:block;color:var(--kbcg-t3);font-size:12px}
      .kbcg-tbl .muted{color:var(--kbcg-t3)}
      .kbcg-panel{position:sticky;top:0;display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 48px);overflow:auto;padding:16px 18px 20px;border:1px solid var(--kbcg-b2);border-radius:14px;background:var(--kbcg-l1);box-shadow:0 10px 30px color-mix(in srgb,var(--kbcg-t1) 12%,transparent)}
      .kbcg-panel .x{position:absolute;z-index:3;inset-inline-end:10px;top:10px;width:30px;height:30px;border-radius:8px;border:0;background:color-mix(in srgb,var(--kbcg-l1) 85%,transparent);display:grid;place-items:center;color:var(--kbcg-t2)}
      .kbcg-panel .x:hover{background:var(--kbcg-hover)}
      .kbcg-panel h3{margin:12px 0 0;font-size:19px;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
      .kbcg-panel .sub{margin:2px 0 0;color:var(--kbcg-t2)}
      .kbcg-panel .badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .kbcg-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 14px;margin:14px 0 0;font-size:13px}
      .kbcg-dl dt{color:var(--kbcg-t3)}
      .kbcg-dl dd{margin:0;overflow-wrap:anywhere}
      .kbcg-dl a{color:var(--kbcg-accent)}
      .kbcg-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
      .kbcg-foot{margin:12px 0 0;color:var(--kbcg-t3);font-size:12px}
      .kbcg-empty{display:flex;flex-direction:column;align-items:center;gap:8px;border:1px dashed var(--kbcg-b3);border-radius:12px;padding:32px 20px;text-align:center;color:var(--kbcg-t2)}
      .kbcg-empty b{color:var(--kbcg-t1);font-size:15px}
      .kbcg-more{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;color:var(--kbcg-t3)}
      .kbcg-bone{background:var(--kbcg-bone);border-radius:8px;animation:kbcg-pulse 1.4s ease-in-out infinite}
      @keyframes kbcg-pulse{50%{opacity:.5}}
      .kbcg-veil{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;background:color-mix(in srgb,var(--kbcg-t1) 42%,transparent)}
      .kbcg-dlg{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--kbcg-b2);border-radius:14px;background:var(--kbcg-l1);padding:20px 22px;box-shadow:0 20px 50px color-mix(in srgb,var(--kbcg-t1) 25%,transparent)}
      .kbcg-dlg h3{margin:0 0 12px;font-size:17px;font-weight:700}
      .kbcg-dlg p{margin:0 0 8px;color:var(--kbcg-t2)}
      .kbcg-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
      .kbcg-field label{color:var(--kbcg-t2);font-size:12.5px;font-weight:600}
      .kbcg-in{width:100%;height:36px;border:1px solid var(--kbcg-b2);border-radius:10px;background:var(--kbcg-l1);color:var(--kbcg-t1);font:inherit;padding:0 11px;min-width:0}
      .kbcg-in[aria-invalid="true"]{border-color:var(--kbcg-bad)}
      .kbcg-in::placeholder{color:var(--kbcg-t3)}
      .kbcg-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
      .kbcg-fe{color:var(--kbcg-bad);font-size:12px}
      .kbcg-dlg .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}
      .kbcg-toast{position:fixed;inset-inline:0;bottom:24px;margin-inline:auto;width:max-content;max-width:calc(100vw - 32px);z-index:1100;display:flex;align-items:center;gap:12px;padding:9px 14px;border:1px solid var(--kbcg-b2);border-radius:12px;background:var(--kbcg-l1);box-shadow:0 10px 30px color-mix(in srgb,var(--kbcg-t1) 18%,transparent)}
      .kbcg-open{display:flex;flex:1;flex-direction:column;align-items:stretch;gap:0;width:100%;padding:0;margin:0;border:0;background:transparent;text-align:start;color:inherit;min-width:0;border-radius:inherit}
      .kbcg-card{position:relative;display:flex;flex-direction:column}
      .kbcg-card:focus-within{box-shadow:0 0 0 2px var(--kbcg-accent)}
      .kbcg-card.hot{box-shadow:0 0 0 2px var(--kbcg-t1),0 10px 26px -12px color-mix(in srgb,var(--kbcg-t1) 40%,transparent)}
      .kbcg-tile{aspect-ratio:4/3}
      .kbcg-tile .kbcg-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
      .kbcg-tile.kz-img>svg{position:absolute;inset:0}
      .kbcg-tile .kbcg-tag{z-index:1}
      .kbcg-heart{position:absolute;inset-inline-end:10px;top:10px;z-index:2;width:32px;height:32px;display:grid;place-items:center;border-radius:50%;border:0;background:color-mix(in srgb,var(--kbcg-l1) 78%,transparent);color:var(--kbcg-t2);backdrop-filter:blur(6px);transition:background-color .15s,transform .14s,color .15s}
      .kbcg-heart:hover{background:var(--kbcg-l1);color:var(--kbcg-t1);transform:scale(1.08)}
      .kbcg-heart:active{transform:scale(.92)}
      .kbcg-heart.on{color:var(--kbcg-bad)}
      .kbcg-heart.on svg{fill:currentColor}
      .kbcg-chips{display:flex;flex-wrap:wrap;align-items:center;gap:5px 6px;margin-top:6px}
      .kbcg-stat{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--kbcg-t2);white-space:nowrap}
      .kbcg-stat svg{color:var(--kbcg-t3)}
      .kbcg-body{flex:1}
      .kbcg-price{font-size:15px;display:block;margin-top:auto;padding-top:8px}
      .kbcg-stats{display:flex;flex-wrap:wrap;gap:2px 12px;margin-top:6px}
      .kbcg-price small{font-weight:500}
      .kbcg-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,44%);gap:16px;align-items:start}
      .kbcg-split .kbcg-cards{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
      .kbcg-mapbox{position:sticky;top:8px;height:min(740px,calc(100vh - 250px));min-height:360px;border:1px solid var(--kbcg-b2);border-radius:16px;overflow:hidden;background:var(--kbcg-map-land)}
      .kbcg-map{--kbcg-map-land:color-mix(in srgb,var(--kbcg-l2) 86%,var(--kbcg-warn));--kbcg-map-block:color-mix(in srgb,var(--kbcg-l1) 90%,var(--kbcg-l3));--kbcg-map-street:var(--kbcg-l1);display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}
      .kbcg-map.drag{cursor:grabbing}
      .kbcg-map .land{fill:var(--kbcg-map-land)}
      .kbcg-map .block{fill:var(--kbcg-map-block)}
      .kbcg-map .street{stroke:var(--kbcg-map-street);fill:none;stroke-linecap:round}
      .kbcg-map .park{fill:color-mix(in srgb,var(--kbcg-ok) 34%,var(--kbcg-l2))}
      .kbcg-map .water{fill:color-mix(in srgb,var(--kbcg-blue) 34%,var(--kbcg-l2))}
      .kbcg-map .river{fill:none;stroke:color-mix(in srgb,var(--kbcg-blue) 34%,var(--kbcg-l2));stroke-linecap:round}
      .kbcg-pin{cursor:pointer;outline:none}
      .kbcg-pin .body{transform-origin:0 0;transition:transform .16s cubic-bezier(.2,.8,.2,1)}
      .kbcg-pin .bubble{fill:var(--kbcg-l1);stroke:var(--kbcg-b3);stroke-width:1.2;filter:drop-shadow(0 3px 5px color-mix(in srgb,var(--kbcg-t1) 28%,transparent))}
      .kbcg-pin .tail{fill:var(--kbcg-l1);stroke:var(--kbcg-b3);stroke-width:1.2}
      .kbcg-pin text{fill:var(--kbcg-t1);font-size:13px;font-weight:700;text-anchor:middle;pointer-events:none;font-variant-numeric:tabular-nums}
      .kbcg-pin:hover .body,.kbcg-pin.on .body,.kbcg-pin:focus-visible .body{transform:scale(1.16)}
      .kbcg-pin.on .bubble,.kbcg-pin.on .tail,.kbcg-pin:hover .bubble,.kbcg-pin:hover .tail{fill:var(--kbcg-t1);stroke:var(--kbcg-t1)}
      .kbcg-pin.on text,.kbcg-pin:hover text{fill:var(--kbcg-l1)}
      .kbcg-pin:focus-visible .bubble{stroke:var(--kbcg-accent);stroke-width:2.4}
      .kbcg-pin.sold .bubble,.kbcg-pin.sold .tail{fill:var(--kbcg-l3)}
      .kbcg-pin.sold text{fill:var(--kbcg-t3)}
      .kbcg-mapctl{position:absolute;inset-inline-end:10px;top:10px;display:flex;flex-direction:column;gap:6px;z-index:2}
      .kbcg-mapctl button{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--kbcg-b2);background:color-mix(in srgb,var(--kbcg-l1) 92%,transparent);color:var(--kbcg-t1);transition:background-color .15s,transform .14s}
      .kbcg-mapctl button:hover{background:var(--kbcg-l1);transform:translateY(-1px)}
      .kbcg-mapctl button:active{transform:scale(.94)}
      .kbcg-mapnote{position:absolute;inset-inline-start:10px;bottom:10px;z-index:2;display:flex;gap:8px;align-items:center;max-width:calc(100% - 20px);padding:5px 10px;border-radius:999px;font-size:12px;color:var(--kbcg-t2);background:color-mix(in srgb,var(--kbcg-l1) 90%,transparent);border:1px solid var(--kbcg-b2)}
      .kbcg-thumb{display:block;position:relative;width:64px;height:44px;border-radius:9px;overflow:hidden;background:var(--kbcg-l3);flex:none}
      .kbcg-thumb .kbcg-tile{position:absolute;inset:0;aspect-ratio:auto;border-radius:0;box-shadow:none}
      .kbcg-tbl .who{display:flex;align-items:center;gap:12px}
      .kbcg-tbl .who>div{min-width:0}
      .kbcg-tbl tr.r{transition:background-color .15s}
      .kbcg-tbl .kbcg-chips{margin-top:3px}
      .kbcg-panel.inline{position:relative;top:auto;max-height:none;overflow:visible;margin-bottom:16px;animation:kz-in .28s cubic-bezier(.2,.8,.2,1) both}
      .kbcg-panel.inline .kbcg-tile.wide{aspect-ratio:21/9}
      .kbcg-pin.ghost{pointer-events:none}
      .kbcg-panel .kbcg-tile.wide{aspect-ratio:16/10;margin:-16px -18px 0;width:calc(100% + 36px);border-radius:14px 14px 0 0}
      .kbcg-sortnote{color:var(--kbcg-t3);font-size:12px}
      .kbcg-mapbox[data-map="real"],.kbcg-mapbox[data-map="loading"]{background:var(--kbcg-l2)}
      .kbcg-gl{position:absolute;inset:0;z-index:0}
      .kbcg-gl.maplibregl-map{position:absolute;font:inherit;color:inherit}
      .kbcg-gl .maplibregl-canvas:focus-visible{outline:2px solid var(--kbcg-accent);outline-offset:-2px}
      .kbcg-gl .maplibregl-cooperative-gesture-screen{font:inherit;font-size:14px;background:color-mix(in srgb,var(--kbcg-t1) 55%,transparent);color:var(--kbcg-l1)}
      .kbcg-maploading{position:absolute;inset:0;z-index:1;display:grid;place-items:center}
      .kbcg-maploading .kbcg-bone{position:absolute;inset:0;border-radius:0;opacity:.55}
      .kbcg-maploading-text{position:relative;padding:6px 14px;border-radius:999px;border:1px solid var(--kbcg-b2);background:color-mix(in srgb,var(--kbcg-l1) 92%,transparent);color:var(--kbcg-t2);font-size:12.5px}
      .kbcg-attr{position:absolute;inset-inline-end:8px;bottom:8px;z-index:2;max-width:56%;padding:3px 9px;border-radius:12px;font-size:10.5px;line-height:1.4;text-align:end;color:var(--kbcg-t2);background:color-mix(in srgb,var(--kbcg-l1) 86%,transparent);backdrop-filter:blur(6px)}
      .kbcg-attr a{color:inherit;text-decoration:none}
      .kbcg-attr a:hover{color:var(--kbcg-t1);text-decoration:underline}
      .kbcg-maplink{display:inline-flex;align-items:center;gap:4px;margin-inline-start:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--kbcg-b2);background:transparent;font-size:11.5px;color:var(--kbcg-t1);transition:background-color .15s}
      .kbcg-maplink:hover{background:var(--kbcg-hover)}
      .kbcg-rp{z-index:1;display:block;padding:0;margin:0;border:0;background:transparent;font:inherit;color:var(--kbcg-t1);cursor:pointer;outline:none}
      .kbcg .kbcg-rp:focus-visible{outline:none}
      .kbcg-rp .b{display:flex;flex-direction:column;align-items:center;transform-origin:50% 100%;transition:transform .16s cubic-bezier(.2,.8,.2,1)}
      .kbcg-rp .p{display:block;min-width:46px;height:25px;padding:0 11px;border-radius:13px;border:1px solid var(--kbcg-b3);background:var(--kbcg-l1);color:var(--kbcg-t1);font-size:13px;font-weight:700;line-height:23px;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 3px 8px color-mix(in srgb,var(--kbcg-t1) 22%,transparent);transition:background-color .15s,color .15s,border-color .15s}
      .kbcg-rp .t{display:block;width:9px;height:9px;margin-top:-5px;border-right:1px solid var(--kbcg-b3);border-bottom:1px solid var(--kbcg-b3);background:var(--kbcg-l1);transform:rotate(45deg);transition:background-color .15s,border-color .15s}
      .kbcg-rp:hover,.kbcg-rp.hot,.kbcg-rp:focus-visible{z-index:3}
      .kbcg-rp:hover .b,.kbcg-rp.hot .b,.kbcg-rp.sel .b,.kbcg-rp:focus-visible .b{transform:translateY(-2px) scale(1.08)}
      .kbcg-rp:hover .p,.kbcg-rp.hot .p{background:var(--kbcg-t1);border-color:var(--kbcg-t1);color:var(--kbcg-l1)}
      .kbcg-rp:hover .t,.kbcg-rp.hot .t{background:var(--kbcg-t1);border-color:var(--kbcg-t1)}
      .kbcg-rp.sel{z-index:4}
      .kbcg-rp.sel{--kbcg-pick:color-mix(in srgb,var(--kbcg-accent) 82%,var(--kbcg-t1))}
      .kbcg-rp.sel .p{background:var(--kbcg-pick);border-color:var(--kbcg-pick);color:var(--kbcg-fg)}
      .kbcg-rp.sel .t{background:var(--kbcg-pick);border-color:var(--kbcg-pick)}
      .kbcg-rp:focus-visible .p{outline:2px solid var(--kbcg-accent);outline-offset:2px}
      .kbcg-gl[data-scheme="dark"] .kbcg-rp .p{background:var(--kbcg-l3);box-shadow:0 3px 10px color-mix(in srgb,var(--kbcg-l1) 70%,transparent)}
      .kbcg-gl[data-scheme="dark"] .kbcg-rp .t{background:var(--kbcg-l3)}
      .kbcg-gl[data-scheme="dark"] .kbcg-rp:hover .p,.kbcg-gl[data-scheme="dark"] .kbcg-rp.hot .p{background:var(--kbcg-t1)}
      .kbcg-gl[data-scheme="dark"] .kbcg-rp:hover .t,.kbcg-gl[data-scheme="dark"] .kbcg-rp.hot .t{background:var(--kbcg-t1)}
      .kbcg-gl[data-scheme="dark"] .kbcg-rp.sel .p,.kbcg-gl[data-scheme="dark"] .kbcg-rp.sel .t{background:var(--kbcg-pick)}
      .kbcg-rp.sold .p{background:var(--kbcg-l3);color:var(--kbcg-t3);box-shadow:none}
      .kbcg-rp.sold .t{background:var(--kbcg-l3)}
      .kbcg-rp.cluster .p{min-width:34px;height:34px;padding:0 6px;border-radius:17px;line-height:32px;text-align:center}
      .kbcg-rp.cluster .t{display:none}
      @media (max-width:900px){
        .kbcg-split{grid-template-columns:minmax(0,1fr)}
        .kbcg-mapbox{position:relative;top:0;height:300px;min-height:0;order:-1}
      }
      @media (max-width:1100px){
        .kbcg-main.withpanel{grid-template-columns:minmax(0,1fr)}
        .kbcg-panel{position:fixed;inset-inline:12px;bottom:12px;top:auto;max-height:70vh;z-index:900}
        .kbcg-panel .kbcg-tile{aspect-ratio:auto;height:84px}
      }
      @media (max-width:640px){.kbcg-grid2{grid-template-columns:1fr}.kbcg-attr{inset-inline:8px;max-width:none;padding:2px 8px;font-size:10px;text-align:center}.kbcg-mapbox[data-map="real"] .kbcg-mapnote,.kbcg-mapbox[data-map="loading"] .kbcg-mapnote{top:10px;bottom:auto;max-width:calc(100% - 64px)}}
      @media (prefers-reduced-motion:reduce){.kbcg-rp .b,.kbcg-rp .p,.kbcg-rp .t,.kbcg-maplink{transition:none}.kbcg-rp:hover .b,.kbcg-rp.hot .b,.kbcg-rp.sel .b,.kbcg-rp:focus-visible .b{transform:none}.kbcg-bone{animation:none}.kbcg-card,.kbcg-chip,.kbcg-btn,.kbcg-heart,.kbcg-pin .body,.kbcg-mapctl button,.kbcg-tbl tr.r{transition:none}.kbcg-panel.inline{animation:none}.kbcg-heart:hover,.kbcg-pin:hover .body,.kbcg-pin.on .body{transform:none}}
      `

      // ── small parts ──────────────────────────────────────────────────────────────────────────────────────
      const Tag = (props) => h('span', { className: 'kbcg-tag ' + (props.tone === 'ok' || props.tone === 'warn' || props.tone === 'bad' ? props.tone : '') + (props.cls ? ' ' + props.cls : ''), 'data-kb': props.kb }, props.children)
      const StatusTag = (props) => {
        const s = statusOf(props.type, props.row)
        if (s === null) return props.row.status === '' ? null : h(Tag, { tone: 'neutral', kb: 'catalog-status' }, humanize(props.row.status))
        return h(Tag, { tone: s.tone, kb: 'catalog-status' }, pick(s.label, humanize(s.key)))
      }
      const DemoTag = () => h(Tag, { cls: 'demo', kb: 'catalog-demo-badge' }, kt('démo', 'demo'))
      /**
       * The picture of an item: the photograph its template ships (`photo:<theme>/<name>`, served by the core), else a drawn one (the `art:` of its field, or the kind
       * that goes with its type), else the neutral tile of the page's own tones with the type's icon. A photograph that does not load turns into the drawn one.
       */
      const Picture = (props) => {
        const { type, row } = props
        const ref = row === undefined ? '' : pictureRef(type, row)
        const m = PHOTO_RE.exec(ref)
        const [bad, setBad] = useState(false)
        const K = kitOf()
        const spec = K !== null && K.artOk(ref) ? ref : (row === undefined ? '' : fallbackArt(type, row))
        let inner
        let kind = 'none'
        if (m !== null && !bad) { kind = 'photo'; inner = h('img', { className: 'kbcg-img', src: '/kybernos/themes/photo?id=' + encodeURIComponent(m[1]), alt: '', loading: 'lazy', decoding: 'async', draggable: false, onError: () => setBad(true) }) } else if (K !== null && K.artOk(spec)) { kind = 'art'; inner = K.Art({ spec }) } else inner = Ic(type === null ? 'package' : type.icon, 34)
        return h('span', { className: 'kbcg-tile kz-img' + (props.wide ? ' wide' : ''), style: { '--tone': [8, 13, 18, 23][props.index % 4] }, 'data-kb': 'catalog-picture', 'data-picture': kind, 'aria-hidden': 'true' }, inner, props.children)
      }
      const Heart = (props) => h('button', { type: 'button', className: 'kbcg-heart kz-press' + (props.on ? ' on kz-pop' : ''), 'data-kb': 'catalog-heart', 'aria-pressed': props.on ? 'true' : 'false', 'aria-label': props.on ? kt('Retirer de ta sélection', 'Remove from your shortlist') : kt('Ajouter à ta sélection', 'Add to your shortlist'), title: props.on ? kt('Retirer de ta sélection', 'Remove from your shortlist') : kt('Ajouter à ta sélection', 'Add to your shortlist'), onClick: (e) => { e.stopPropagation(); props.onToggle() } }, Ic('heart', 17))
      /** The coloured chips and the plain stats under a card's title (`card.chips`); the colour of a tag follows its text, an energy class runs from green to red. */
      const ChipRow = (props) => {
        const chips = cardChips(props.type, props.row)
        if (chips.length === 0) return null
        const K = kitOf()
        const tags = chips.filter((c) => !c.stat)
        const stats = chips.filter((c) => c.stat)
        return h(React.Fragment, null,
          tags.length > 0 ? h('span', { className: 'kbcg-chips', 'data-kb': 'catalog-chips' }, tags.map((c) => (K !== null ? h(K.Tag, { key: c.key, text: c.text, hue: c.hue, dot: true }) : h('span', { key: c.key, className: 'kbcg-tag' }, c.text)))) : null,
          stats.length > 0 ? h('span', { className: 'kbcg-stats', 'data-kb': 'catalog-stats' }, stats.map((c) => h('span', { key: c.key, className: 'kbcg-stat', 'data-kb': 'catalog-stat' }, c.icon !== undefined && K !== null ? K.Icon(c.icon, 13) : null, c.text))) : null)
      }
      const mulberry = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
      const seedOf = (text) => { let n = 7; for (const c of String(text)) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0; return n }
      /** The streets, blocks and parks behind the pins: the same for the same seed, drawn wider than the map so any shape of box shows more of the same town. */
      const townBlocks = (seed) => {
        const rand = mulberry(seed)
        const out = []
        for (let gy = -5; gy < 26; gy += 1) for (let gx = -7; gx < 20; gx += 1) out.push({ x: Math.round(gx * 76 + 10 + rand() * 6), y: Math.round(gy * 66 + 8 + rand() * 6), w: Math.round(52 + rand() * 14), h: Math.round(44 + rand() * 12), park: rand() < 0.06 })
        return out
      }
      /**
       * A schematic map: the town is drawn from a seed (blocks, two avenues, a lake and a river), never fetched, and the pins sit where the items' two number fields
       * say. It is a drawing, not a survey: the caption says so. Drag to move it, the buttons (or the wheel) to zoom; a pin is a button and takes the keyboard.
       */
      const MapView = (props) => {
        const [cam, setCam] = useState({ k: 1, tx: 0, ty: 0 })
        const [drag, setDrag] = useState(false)
        const [size, setSize] = useState({ w: 0, h: 0 })
        const box = useRef(null)
        const grab = useRef(null)
        const blocks = React.useMemo(() => townBlocks(props.seed), [props.seed])
        // the canvas has the shape of its box (1000 units wide), so the pins fill it and a pin keeps the size of a finger whatever the box is
        const H = size.w > 0 && size.h > 0 ? Math.max(480, Math.min(1500, Math.round(MAP_W * size.h / size.w))) : MAP_H
        const px = size.w > 0 ? MAP_W / size.w : 1
        const dims = useRef({ H })
        dims.current = { H }
        useEffect(() => {
          const el = box.current
          if (el === null) return undefined
          const measure = () => { const r = el.getBoundingClientRect(); setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height })) }
          measure()
          let watcher = null
          try { watcher = new ResizeObserver(measure); watcher.observe(el) } catch (e) { window.addEventListener('resize', measure) }
          return () => { if (watcher !== null) watcher.disconnect(); else window.removeEventListener('resize', measure) }
        }, [])
        const zoom = (f) => setCam((c) => { const k = Math.min(4, Math.max(0.8, c.k * f)); return { k, tx: MAP_W / 2 - (MAP_W / 2 - c.tx) * (k / c.k), ty: dims.current.H / 2 - (dims.current.H / 2 - c.ty) * (k / c.k) } })
        useEffect(() => {
          const el = box.current
          if (el === null) return undefined
          const wheel = (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15) }
          el.addEventListener('wheel', wheel, { passive: false })
          return () => el.removeEventListener('wheel', wheel)
        }, [])
        const unit = () => px
        const down = (e) => { if (e.target.closest !== undefined && e.target.closest('.kbcg-pin') !== null) return; grab.current = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty }; setDrag(true); try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* no capture: the drag stops at the edge */ } }
        const move = (e) => { const g = grab.current; if (g === null) return; const u = unit(); setCam((c) => Object.assign({}, c, { tx: g.tx + (e.clientX - g.x) * u, ty: g.ty + (e.clientY - g.y) * u })) }
        const up = () => { grab.current = null; setDrag(false) }
        const pins = projectPins(props.placed, MAP_W, H)
        const lit = (pin) => pin.row.id === props.hot || pin.row.id === props.selected
        const pinOf = (pin, ghost) => {
          const row = pin.row
          const label = pinPrice(row)
          const w = Math.max(46, Math.round(label.length * 8.4 + 22))
          const on = lit(pin)
          const x = Math.round((pin.x * cam.k + cam.tx) * 10) / 10
          const y = Math.round((pin.y * cam.k + cam.ty) * 10) / 10
          const pick = () => props.onPick(row)
          if (ghost === true) return h('g', { key: 'g' + row.id, className: 'kbcg-pin on ghost', transform: 'translate(' + x + ' ' + y + ') scale(' + px + ')', 'aria-hidden': 'true', style: { pointerEvents: 'none' } }, h('g', { className: 'body' }, h('path', { className: 'tail', d: 'M-6 -4 L0 7 L6 -4 Z' }), h('rect', { className: 'bubble', x: -w / 2, y: -28, width: w, height: 25, rx: 12.5 }), h('text', { y: -10 }, label)))
          return h('g', { key: row.id, className: 'kbcg-pin' + (on ? ' on' : '') + (row.status === 'sold' ? ' sold' : ''), transform: 'translate(' + x + ' ' + y + ') scale(' + px + ')', tabIndex: 0, role: 'button', 'data-kb': 'catalog-pin', 'data-id': row.id, 'aria-label': row.title + ', ' + (row.price_text === undefined || row.price_text === '' ? label : row.price_text), 'aria-pressed': row.id === props.selected ? 'true' : 'false', onClick: pick, onKeyDown: onActivate(pick), onMouseEnter: () => props.onHover(row.id), onMouseLeave: () => props.onHover(null), onFocus: () => props.onHover(row.id), onBlur: () => props.onHover(null) },
            h('g', { className: 'body' }, h('path', { className: 'tail', d: 'M-6 -4 L0 7 L6 -4 Z' }), h('rect', { className: 'bubble', x: -w / 2, y: -28, width: w, height: 25, rx: 12.5 }), h('text', { y: -10 }, label)))
        }
        const why = props.why === undefined ? '' : props.why
        return h('div', { className: 'kbcg-mapbox', 'data-kb': 'catalog-map-box', 'data-map': 'drawn' },
          h('svg', { ref: box, className: 'kbcg-map' + (drag ? ' drag' : ''), 'data-map': 'drawn', viewBox: '0 0 ' + MAP_W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': kt('Carte schématique des biens', 'Schematic map of the items'), 'data-kb': 'catalog-map', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
            h('g', { transform: 'translate(' + cam.tx + ' ' + cam.ty + ') scale(' + cam.k + ')' },
              h('rect', { className: 'land', x: -2000, y: -1500, width: 5000, height: 4000 }),
              blocks.map((b, i) => h('rect', { key: i, className: b.park ? 'park' : 'block', x: b.x, y: b.y, width: b.w, height: b.h, rx: b.park ? 22 : 7 })),
              h('path', { className: 'street', d: 'M-600 ' + Math.round(H * 0.17) + ' L1700 ' + Math.round(H * 0.72), strokeWidth: 15 }), h('path', { className: 'street', d: 'M330 -400 L610 ' + (H + 400), strokeWidth: 15 }),
              h('path', { className: 'water', d: 'M-900 ' + (H - 30) + ' C -300 ' + (H - 70) + ' 200 ' + (H - 14) + ' 480 ' + (H - 44) + ' S 1000 ' + (H - 12) + ' 1900 ' + (H - 52) + ' L1900 ' + (H + 1200) + ' L-900 ' + (H + 1200) + ' Z' }),
              h('path', { className: 'river', d: 'M1200 -420 C 1000 ' + Math.round(H * 0.03) + ' 900 ' + Math.round(H * 0.24) + ' 790 ' + Math.round(H * 0.42) + ' S 610 ' + Math.round(H * 0.74) + ' 520 ' + (H - 34), strokeWidth: 24 })),
            pins.map((pin) => pinOf(pin, false)), pins.filter(lit).map((pin) => pinOf(pin, true))),
          h(MapControls, { onIn: () => zoom(1.4), onOut: () => zoom(1 / 1.4), onFit: () => setCam({ k: 1, tx: 0, ty: 0 }) }),
          h(MapNote, { lead: kt('Carte schématique', 'Schematic map'), placed: props.placed.length, unplaced: props.unplaced },
            whyText(why) !== '' ? h('span', { 'data-kb': 'catalog-map-why', 'data-why': why }, ' · ' + whyText(why)) : null,
            props.onRetry === undefined ? null : h('button', { type: 'button', className: 'kbcg-maplink', 'data-kb': 'catalog-map-retry', onClick: props.onRetry }, Ic('refresh', 12), kt('Réessayer', 'Try again'))))
      }
      // ── the real map: loading and the page parts ──────────────────────────────────────────────────────────────────────────────────
      let mapLibPromise = null
      /** Loads the map library once, from this plugin's own routes: the stylesheet and the script together. Resolves with `maplibregl`; on any failure it rejects and the next call tries again. */
      const loadMapLib = () => {
        try { if (window.maplibregl !== undefined && window.maplibregl !== null && typeof window.maplibregl.Map === 'function') return Promise.resolve(window.maplibregl) } catch (e) { /* load it */ }
        if (mapLibPromise !== null) return mapLibPromise
        const made = []
        mapLibPromise = new Promise((resolve, reject) => {
          let left = 2
          const done = () => { left -= 1; if (left === 0) { if (window.maplibregl && typeof window.maplibregl.Map === 'function') resolve(window.maplibregl); else reject(new Error('map library')) } }
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = MAP_LIB.css
          const script = document.createElement('script')
          script.src = MAP_LIB.js
          script.async = true
          for (const node of [link, script]) { node.setAttribute('data-plugin', '@local/kybernos-catalog'); node.onload = done; node.onerror = () => reject(new Error('map file')); made.push(node); document.head.appendChild(node) }
        })
        mapLibPromise.catch(() => { mapLibPromise = null; for (const node of made) { try { node.remove() } catch (e) { /* already gone */ } } })
        return mapLibPromise
      }
      let mapStyleCache = null
      /** The basemap style, asked once per page load; no cookie and no referrer go with the request. */
      const loadMapStyle = async (signal) => {
        if (mapStyleCache !== null) return mapStyleCache
        const res = await fetch(MAP_STYLE_URL, { credentials: 'omit', referrerPolicy: 'no-referrer', signal })
        if (!res.ok) throw new Error('map style ' + res.status)
        const json = await res.json()
        if (json === null || typeof json !== 'object' || !Array.isArray(json.layers)) throw new Error('map style shape')
        mapStyleCache = json
        return json
      }
      let webglKnown = null
      const hasWebGL = () => {
        if (webglKnown === null) { try { const c = document.createElement('canvas'); webglKnown = !!(c.getContext('webgl2') || c.getContext('webgl')) } catch (e) { webglKnown = false } }
        return webglKnown
      }
      const inBackground = () => { try { return document.visibilityState === 'hidden' } catch (e) { return false } }
      const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
      const mapDecision = (count) => mapGate({ placed: count, webgl: hasWebGL(), online: typeof navigator === 'undefined' || navigator.onLine !== false, failure: mapFailure, now: Date.now() })
      /** The page's tokens, resolved where the map sits, as [r, g, b] each (a canvas turns any CSS colour into numbers); null when the page cannot say. */
      let tokenCx = null
      const readTokens = (box) => {
        try {
          const style = getComputedStyle(box)
          if (tokenCx === null) {
            const canvas = document.createElement('canvas')
            canvas.width = 1
            canvas.height = 1
            tokenCx = canvas.getContext('2d', { willReadFrequently: true })
          }
          const cx = tokenCx
          const out = {}
          for (const k of MAP_TOKENS) {
            const raw = style.getPropertyValue('--kbcg-' + k).trim()
            if (raw === '') return null
            cx.clearRect(0, 0, 1, 1)
            cx.fillStyle = 'black'
            cx.fillStyle = raw
            cx.fillRect(0, 0, 1, 1)
            const d = cx.getImageData(0, 0, 1, 1).data
            out[k] = [d[0], d[1], d[2]]
          }
          return out
        } catch (e) { return null }
      }
      const tokensSig = (tok) => MAP_TOKENS.map((k) => tok[k].join(',')).join('|')
      const whyText = (why) => (why === 'offline' ? kt('Hors ligne', 'Offline') : (why === 'webgl' ? kt('WebGL indisponible', 'WebGL unavailable') : (why === '' || why === 'empty' ? '' : kt('Carte réelle indisponible', 'Real map unavailable'))))
      const domNode = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n }
      /** The DOM of a pin or a cluster, built by hand: the map library places elements, not React nodes. */
      const buildPin = () => {
        const root = domNode('button', 'kbcg-rp')
        root.type = 'button'
        const body = domNode('span', 'b')
        const pill = domNode('span', 'p')
        body.appendChild(pill)
        body.appendChild(domNode('i', 't'))
        root.appendChild(body)
        return { root, pill }
      }
      /** Writes what a pin or a cluster says now (its text, its name for a screen reader, its look) into its element. */
      const fillPin = (pin, cluster) => {
        const one = cluster.count === 1
        const row = cluster.items[0].row
        pin.cluster = cluster
        pin.root.classList.toggle('cluster', !one)
        pin.root.classList.toggle('sold', one && row.status === 'sold')
        pin.root.setAttribute('data-kb', one ? 'catalog-pin' : 'catalog-cluster')
        if (one) pin.root.setAttribute('data-id', String(row.id)); else pin.root.removeAttribute('data-id')
        pin.pill.textContent = one ? pinPrice(row) : String(cluster.count)
        pin.root.setAttribute('aria-label', one ? row.title + ', ' + (row.price_text === undefined || row.price_text === '' ? pinPrice(row) : row.price_text) : cluster.count + kt(' éléments ici : zoomer', ' items here: zoom in'))
        if (!one) pin.root.removeAttribute('aria-pressed')
      }

      /** The zoom and fit buttons, the same for the real map and the drawn one. */
      const MapControls = (props) => h('div', { className: 'kbcg-mapctl' },
        h('button', { type: 'button', 'data-kb': 'catalog-map-zoom-in', 'aria-label': kt('Zoom avant', 'Zoom in'), title: kt('Zoom avant', 'Zoom in'), onClick: props.onIn }, Ic('plus', 16)),
        h('button', { type: 'button', 'data-kb': 'catalog-map-zoom-out', 'aria-label': kt('Zoom arrière', 'Zoom out'), title: kt('Zoom arrière', 'Zoom out'), onClick: props.onOut }, Ic('minus', 16)),
        h('button', { type: 'button', 'data-kb': 'catalog-map-fit', 'aria-label': kt('Tout voir', 'Show everything'), title: kt('Tout voir', 'Show everything'), onClick: props.onFit }, Ic('fit', 16)))
      /** The caption of a map: what it is (the drawn one says so), how many places, how many items have none. */
      const MapNote = (props) => h('div', { className: 'kbcg-mapnote', 'data-kb': 'catalog-map-note' }, Ic('map', 14),
        h('span', null, props.lead === undefined ? null : props.lead, props.lead === undefined ? null : ' · ', props.placed + (props.placed === 1 ? kt(' lieu', ' place') : kt(' lieux', ' places'))),
        props.unplaced > 0 ? h('span', { 'data-kb': 'catalog-map-unplaced' }, ' · ' + props.unplaced + kt(' sans emplacement', ' without a place')) : null,
        props.children)

      /**
       * The real map. The library, the style and the tiles are asked for when this component mounts and not before; if anything fails or is too slow (MAP_BUDGET_MS) it tells
       * its parent, which draws the drawn map instead. The pins are our own price pills, placed by the library as markers: buttons, so Tab and Enter work as they do on the drawn map.
       */
      const RealMap = (props) => {
        const host = useRef(null)
        const live = useRef(null)
        const latest = useRef(props)
        latest.current = props
        const [ready, setReady] = useState(false)

        useEffect(() => {
          const st = { lib: null, map: null, pins: new Map(), order: '', refocus: null, waiting: false, ready: false, dead: false, loaded: false, ok: 0, errors: 0, t0: Date.now(), down: null, abort: null, timer: null, ticker: null, watcher: null, sig: '', styleSrc: null, sync: () => {}, paint: () => {} }
          live.current = st
          const teardown = () => {
            st.dead = true
            if (st.timer !== null) clearTimeout(st.timer)
            if (st.ticker !== null) clearInterval(st.ticker)
            try { document.removeEventListener('visibilitychange', onVisible) } catch (e) { /* nothing to remove */ }
            if (st.watcher !== null) st.watcher.disconnect()
            if (st.abort !== null) { try { st.abort.abort() } catch (e) { /* already done */ } }
            for (const pin of st.pins.values()) { try { pin.marker.remove() } catch (e) { /* already gone */ } }
            st.pins.clear()
            if (st.map !== null) { try { st.map.remove() } catch (e) { /* already gone */ } st.map = null }
          }
          const fail = (why) => { if (st.dead) return; teardown(); latest.current.onFail(why) }
          const verdict = () => {
            if (st.dead) return
            if (st.ok === 0 && !st.loaded && inBackground()) { st.waiting = true; return } // a tab in the background draws nothing (no animation frames): the clock waits for the person to come back
            const v = startVerdict({ loaded: st.loaded, ok: st.ok, errors: st.errors, elapsed: Date.now() - st.t0, budget: MAP_BUDGET_MS })
            if (v.state === 'fallback') fail(v.why)
            else if (v.state === 'ready' && !st.ready) { st.ready = true; setReady(true); st.sync() }
          }
          const onVisible = () => {
            if (st.dead || !st.waiting || inBackground()) return
            st.waiting = false
            st.t0 = Date.now()
            st.timer = setTimeout(verdict, MAP_BUDGET_MS)
          }
          try { document.addEventListener('visibilitychange', onVisible) } catch (e) { /* no event: the clock runs as it is */ }
          const hoverOf = (pin) => latest.current.onHover(pin.cluster.count === 1 ? pin.cluster.items[0].row.id : null)
          const makePin = (cluster) => {
            const parts = buildPin()
            const pin = { root: parts.root, pill: parts.pill, cluster, marker: null }
            parts.root.addEventListener('pointerdown', (e) => { st.down = { x: e.clientX, y: e.clientY } })
            parts.root.addEventListener('click', (e) => {
              const d = st.down
              st.down = null
              if (d !== null && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return // the click that ends a drag of the map
              if (pin.cluster.count === 1) { latest.current.onPick(pin.cluster.items[0].row); return }
              const action = clusterAction(pin.cluster.items)
              try { if (document.activeElement === pin.root) st.refocus = pin.cluster.items[0].row.id } catch (err) { /* no focus to keep */ } // the cluster is made again at the new zoom: the keyboard follows its first member
              if (action.kind === 'pick') latest.current.onPick(action.row)
              else if (st.map !== null) st.map.fitBounds(action.bounds, { padding: 96, maxZoom: MAP_MAX_ZOOM - 1, duration: reducedMotion() ? 0 : 600 })
            })
            parts.root.addEventListener('mouseenter', () => hoverOf(pin))
            parts.root.addEventListener('mouseleave', () => latest.current.onHover(null))
            parts.root.addEventListener('focus', () => hoverOf(pin))
            parts.root.addEventListener('blur', () => latest.current.onHover(null))
            fillPin(pin, cluster)
            pin.marker = new st.lib.Marker({ element: parts.root, anchor: 'bottom' }).setLngLat([cluster.lng, cluster.lat]).addTo(st.map)
            return pin
          }
          // the pins as the zoom shows them: made again when the zoom ends or the items change, their look kept in step by `paint`
          st.sync = () => {
            if (st.map === null || !st.ready) return
            const clusters = clusterPins(latest.current.placed, st.map.getZoom())
            const keep = new Set(clusters.map((c) => c.key))
            for (const [key, pin] of [...st.pins]) if (!keep.has(key)) { pin.marker.remove(); st.pins.delete(key) }
            for (const c of clusters) {
              const pin = st.pins.get(c.key)
              if (pin === undefined) st.pins.set(c.key, makePin(c))
              else { fillPin(pin, c); pin.marker.setLngLat([c.lng, c.lat]) }
            }
            const order = clusters.map((c) => c.key).join('|')
            if (order !== st.order) { st.order = order; const parent = st.map.getCanvasContainer(); for (const c of clusters) parent.appendChild(st.pins.get(c.key).root) } // Tab follows the order of the cards
            st.paint()
            if (st.refocus !== null) {
              const id = st.refocus
              st.refocus = null
              for (const pin of st.pins.values()) if (pin.cluster.items.some((q) => q.row.id === id)) { try { pin.root.focus({ preventScroll: true }) } catch (err) { /* nothing to focus */ } break }
            }
          }
          st.paint = () => {
            const { hot, selected } = latest.current
            for (const pin of st.pins.values()) {
              const ids = pin.cluster.items.map((q) => q.row.id)
              const isHot = hot !== null && hot !== undefined && ids.indexOf(hot) >= 0
              const isSel = selected !== null && selected !== undefined && ids.indexOf(selected) >= 0
              pin.root.classList.toggle('hot', isHot)
              pin.root.classList.toggle('sel', isSel)
              if (pin.cluster.count === 1) pin.root.setAttribute('aria-pressed', isSel ? 'true' : 'false')
            }
          }
          const start = (lib, style) => {
            const box = host.current
            if (box === null) return
            const tok = readTokens(box)
            st.sig = tok === null ? '' : tokensSig(tok) + '|' + lang()
            st.styleSrc = style
            st.lib = lib
            const palette0 = tok === null ? null : paletteFrom(tok)
            box.setAttribute('data-scheme', palette0 !== null && palette0.dark ? 'dark' : 'light')
            const narrow = (() => { try { return window.matchMedia('(max-width: 900px)').matches } catch (e) { return false } })()
            let map
            try {
              map = new lib.Map({
                container: box,
                style: tweakStyle(style, palette0, { lang: lang() }),
                bounds: boundsOf(latest.current.placed),
                fitBoundsOptions: MAP_FIT,
                maxZoom: MAP_MAX_ZOOM,
                minZoom: 2,
                renderWorldCopies: false,
                attributionControl: false,
                dragRotate: false,
                pitchWithRotate: false,
                touchPitch: false,
                maxPitch: 0,
                fadeDuration: reducedMotion() ? 0 : 200,
                cooperativeGestures: narrow,
                canvasContextAttributes: { antialias: true },
                locale: {
                  'CooperativeGesturesHandler.WindowsHelpText': kt('Ctrl + molette pour zoomer sur la carte', 'Use Ctrl + scroll to zoom the map'),
                  'CooperativeGesturesHandler.MacHelpText': kt('⌘ + molette pour zoomer sur la carte', 'Use ⌘ + scroll to zoom the map'),
                  'CooperativeGesturesHandler.MobileHelpText': kt('Deux doigts pour déplacer la carte', 'Use two fingers to move the map'),
                },
                transformRequest: (url) => ({ url, credentials: 'omit', referrerPolicy: 'no-referrer' }),
              })
            } catch (e) { fail('webgl'); return }
            st.map = map
            try { map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation() } catch (e) { /* the map keeps its other gestures */ }
            map.on('sourcedata', (e) => { if (e.dataType === 'source' && e.tile !== undefined) st.ok += 1 })
            map.on('error', () => { st.errors += 1; verdict() })
            const markZoom = () => { if (st.map !== null) box.setAttribute('data-zoom', st.map.getZoom().toFixed(1)) } // read by the live check
            map.on('load', () => { st.loaded = true; markZoom(); verdict() })
            map.on('zoomend', () => { markZoom(); st.sync() })
            map.on('moveend', markZoom)
            // a light or dark page that changes while the map is open gives the map its colours again
            st.ticker = setInterval(() => {
              const t = readTokens(box)
              if (t === null || st.map === null || !st.ready) return
              const sig = tokensSig(t) + '|' + lang()
              if (sig === st.sig) return
              st.sig = sig
              const next = paletteFrom(t)
              box.setAttribute('data-scheme', next.dark ? 'dark' : 'light')
              st.map.setStyle(tweakStyle(st.styleSrc, next, { lang: lang() }), { diff: true })
            }, 1500)
            try { st.watcher = new ResizeObserver(() => { if (st.map !== null) st.map.resize() }); st.watcher.observe(box) } catch (e) { st.watcher = null }
          }
          st.timer = setTimeout(verdict, MAP_BUDGET_MS)
          st.abort = typeof AbortController === 'function' ? new AbortController() : null
          ;(async () => {
            let step = 'lib'
            try {
              const lib = await loadMapLib()
              if (st.dead) return
              step = 'style'
              const style = await loadMapStyle(st.abort === null ? undefined : st.abort.signal)
              if (st.dead) return
              start(lib, style)
            } catch (e) { fail(step) }
          })()
          return teardown
        }, [])

        // the items changed (a filter, an edit, the next page): the pins are made again, and the map looks at the new set if some of it is out of view
        const idsSig = props.placed.map((q) => q.row.id).join(',')
        const itemsSig = props.placed.map((q) => q.row.id + ':' + q.lat + ':' + q.lng + ':' + q.row.status + ':' + pinPrice(q.row) + ':' + q.row.title).join('|')
        const lastIds = useRef(idsSig)
        useEffect(() => {
          const st = live.current
          if (st === null || st.map === null || !st.ready) return
          st.sync()
          if (lastIds.current === idsSig) return
          lastIds.current = idsSig
          const b = boundsOf(props.placed)
          if (b === null) return
          const view = st.map.getBounds()
          if (props.placed.some((q) => !view.contains([q.lng, q.lat]))) st.map.fitBounds(b, Object.assign({ duration: reducedMotion() ? 0 : 600 }, MAP_FIT))
        }, [itemsSig, ready])

        // a card or a pin is hovered or chosen: the pin lights (and the card does, in the page)
        useEffect(() => { const st = live.current; if (st !== null && st.ready) st.paint() }, [props.hot, props.selected, ready])

        // an item is chosen: the map flies to it, far enough in that it stands out of any cluster
        useEffect(() => {
          const st = live.current
          const id = props.selected
          if (st === null || !st.ready || st.map === null || id === null || id === undefined) return
          const item = props.placed.find((q) => q.row.id === id)
          if (item === undefined) return
          const here = st.map.getZoom()
          const zoom = Math.min(MAP_MAX_ZOOM, Math.max(here, aloneZoom(item, props.placed, here, 17)))
          if (reducedMotion()) st.map.jumpTo({ center: [item.lng, item.lat], zoom })
          else st.map.flyTo({ center: [item.lng, item.lat], zoom, duration: 800, essential: false })
        }, [props.selected, ready])

        const go = (fn) => () => { const st = live.current; if (st !== null && st.map !== null && st.ready) fn(st.map, reducedMotion() ? 0 : 280) }
        const placed = props.placed.length
        return h('div', { className: 'kbcg-mapbox', 'data-kb': 'catalog-map-box', 'data-map': ready ? 'real' : 'loading' },
          h('div', { ref: host, className: 'kbcg-gl', 'data-kb': 'catalog-map', 'data-map': 'real', role: 'group', 'aria-label': kt('Carte des biens', 'Map of the items') }),
          ready ? null : h('div', { className: 'kbcg-maploading', 'data-kb': 'catalog-map-loading', role: 'status' }, h('span', { className: 'kbcg-bone' }), h('span', { className: 'kbcg-maploading-text' }, kt('Chargement de la carte…', 'Loading the map…'))),
          h(MapControls, {
            onIn: go((map, ms) => map.zoomIn({ duration: ms })),
            onOut: go((map, ms) => map.zoomOut({ duration: ms })),
            onFit: go((map, ms) => { const b = boundsOf(latest.current.placed); if (b !== null) map.fitBounds(b, Object.assign({ duration: ms * 2 }, MAP_FIT)) }),
          }),
          h(MapNote, { placed, unplaced: props.unplaced }),
          h('div', { className: 'kbcg-attr', 'data-kb': 'catalog-map-attribution' }, ATTRIBUTION.map((a, i) => h(React.Fragment, { key: a.text }, i > 0 ? ' · ' : null, h('a', { href: a.href, target: '_blank', rel: 'noopener noreferrer' }, a.text)))))
      }

      /**
       * What the Map view shows: the real map when it may start, the drawn one (MapView) when it may not or has failed, with the reason in its caption and a button to try the
       * real one again. A failure is remembered for a minute so that going back and forth between the views does not wait for the timeout each time.
       */
      const MapSwitch = (props) => {
        const [mode, setMode] = useState(() => mapDecision(props.placed.length))
        const count = useRef(props.placed.length)
        count.current = props.placed.length
        const ask = () => setMode(mapDecision(count.current))
        const failed = (why) => { mapFailure = { at: Date.now(), why }; setMode({ use: false, why }) }
        const retry = () => { mapFailure = null; ask() }
        useEffect(() => {
          const onLine = () => { if (!mode.use && mode.why !== 'webgl' && mode.why !== 'empty') retry() }
          window.addEventListener('online', onLine)
          return () => window.removeEventListener('online', onLine)
        }, [mode.use, mode.why])
        useEffect(() => { if (mode.why === 'empty' && props.placed.length > 0) ask() }, [props.placed.length])
        const real = mode.use && props.placed.length > 0
        if (real) return h(RealMap, Object.assign({}, props, { onFail: failed }))
        const why = props.placed.length === 0 ? 'empty' : mode.why
        return h(MapView, Object.assign({}, props, { why, onRetry: why === 'webgl' || why === 'empty' || why === '' ? undefined : retry }))
      }
      /** The shape of the page's two columns in the map view: the cards on the left, the map that follows the page on the right. */
      const Bones = () => h('div', { className: 'kbcg-cards', 'aria-busy': 'true' }, [0, 1, 2, 3, 4, 5].map((i) => h('div', { key: i, className: 'kbcg-card', style: { cursor: 'default' } },
        h('div', { className: 'kbcg-bone', style: { aspectRatio: '4/3', borderRadius: 0 } }), h('div', { className: 'kbcg-body' }, h('div', { className: 'kbcg-bone', style: { height: 14, width: '70%' } }), h('div', { className: 'kbcg-bone', style: { height: 11, width: '45%' } })))))
      const onActivate = (fn) => (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); fn() } }

      /** Keeps the keyboard inside a dialog, closes it on Escape and gives the focus back to where it was. */
      const useDialog = (ref, onClose) => {
        const closeRef = useRef(onClose)
        closeRef.current = onClose
        useEffect(() => {
          const node = ref.current
          let before = null
          try { before = document.activeElement } catch (e) { before = null }
          const focusable = () => (node === null ? [] : Array.prototype.slice.call(node.querySelectorAll('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex="0"]')))
          try { const first = focusable()[0]; if (first !== undefined) first.focus() } catch (e) { /* the person clicks the first field */ }
          const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
            if (e.key !== 'Tab') return
            const list = focusable()
            if (list.length === 0) return
            const first = list[0]
            const last = list[list.length - 1]
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          }
          document.addEventListener('keydown', onKey, true)
          return () => {
            document.removeEventListener('keydown', onKey, true)
            try { if (before !== null && typeof before.focus === 'function' && document.contains(before)) before.focus() } catch (e) { /* the element is gone */ }
          }
        }, [])
      }

      // ── the form (new and edit) ──────────────────────────────────────────────────────────────────────────
      const FormDialog = (props) => {
        const { types, row, onClose, onSave } = props
        const editing = row !== null
        const known = editing ? typeOf(types, row) : types[0]
        const [form, setForm] = useState(() => formOf(known === null ? types[0] : known, row))
        const [problem, setProblem] = useState('')
        const [busy, setBusy] = useState(false)
        const ref = useRef(null)
        useDialog(ref, onClose)
        const type = editing ? known : (typeOf(types, { type: form.type }) || types[0])
        const set = (patch) => setForm((f) => Object.assign({}, f, patch))
        const setField = (key, value) => setForm((f) => Object.assign({}, f, { fields: Object.assign({}, f.fields, { [key]: value }) }))
        const pickType = (id) => { const next = typeOf(types, { type: id }) || types[0]; setForm((f) => Object.assign(formOf(next, null), { title: f.title, subtitle: f.subtitle, price_text: f.price_text })) }
        const submit = async (e) => {
          if (e !== undefined && e.preventDefault) e.preventDefault()
          if (busy) return
          if (form.title.trim() === '') { setProblem('title'); return }
          const built = payloadOf(type, form, editing)
          if (built.ok !== true) { setProblem('field:' + built.field); return }
          setProblem('')
          setBusy(true)
          const message = await onSave(built.body)
          setBusy(false)
          if (message !== null) setProblem('server:' + message)
        }
        // a type whose card reads its subtitle or its price from a field has no use for the item's own line: asking for both would be two prices
        const card = type !== null && type.card !== undefined ? type.card : {}
        const showSubtitle = type === null || card.subtitle === undefined || card.subtitle === 'subtitle'
        const showPrice = type === null || card.price === undefined
        const heading = editing ? kt('Modifier', 'Edit') + ' · ' + (type === null ? row.title : pick(type.label, humanize(type.id))) : (types.length === 1 ? newLabel(types) : kt('Nouvel élément', 'New item'))
        const input = (def) => {
          const id = 'kbcg-f-' + def.key
          const label = pick(def.label, humanize(def.key)) + (def.type === 'money' && def.currency ? ' (' + def.currency + ')' : '')
          const bad = problem === 'field:' + def.key
          let control
          if (def.type === 'choice') control = h('select', { id, className: 'kbcg-in', 'data-kb': 'catalog-field-' + def.key, value: form.fields[def.key], onChange: (e) => setField(def.key, e.target.value) }, h('option', { value: '' }, '—'), def.options.map((o) => h('option', { key: o, value: o }, o)))
          else control = h('input', { id, className: 'kbcg-in', 'data-kb': 'catalog-field-' + def.key, type: def.type === 'number' || def.type === 'money' ? 'number' : (def.type === 'date' ? 'date' : (def.type === 'email' ? 'email' : (def.type === 'url' ? 'url' : 'text'))), step: def.type === 'number' || def.type === 'money' ? 'any' : undefined, maxLength: def.type === 'number' || def.type === 'money' || def.type === 'date' ? undefined : 300, value: form.fields[def.key], 'aria-invalid': bad ? 'true' : undefined, onChange: (e) => setField(def.key, e.target.value) })
          return h('div', { key: def.key, className: 'kbcg-field' }, h('label', { htmlFor: id }, label), control, bad ? h('span', { className: 'kbcg-fe', role: 'alert' }, kt('Un nombre est attendu.', 'A number is expected.')) : null)
        }
        return h('div', { className: 'kbcg-veil', 'data-kb': 'catalog-veil', onMouseDown: (e) => { if (e.target === e.currentTarget && !busy) onClose() } },
          h('form', { className: 'kbcg-dlg', ref, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbcg-dlg-title', 'data-kb': 'catalog-dialog', 'data-mode': editing ? 'edit' : 'new', noValidate: true, onSubmit: submit },
            h('h3', { id: 'kbcg-dlg-title' }, heading),
            !editing && types.length > 1 ? h('div', { className: 'kbcg-field' }, h('label', { htmlFor: 'kbcg-f-type' }, kt('Type', 'Type')),
              h('select', { id: 'kbcg-f-type', className: 'kbcg-in', 'data-kb': 'catalog-field-type', value: form.type, onChange: (e) => pickType(e.target.value) }, types.map((t) => h('option', { key: t.id, value: t.id }, pick(t.label, humanize(t.id)))))) : null,
            h('div', { className: 'kbcg-field' }, h('label', { htmlFor: 'kbcg-f-title' }, kt('Titre', 'Title')),
              h('input', { id: 'kbcg-f-title', className: 'kbcg-in', 'data-kb': 'catalog-field-title', type: 'text', maxLength: 200, value: form.title, required: true, 'aria-required': 'true', 'aria-invalid': problem === 'title' ? 'true' : undefined, 'aria-describedby': problem === 'title' ? 'kbcg-title-err' : undefined, onChange: (e) => set({ title: e.target.value }) }),
              problem === 'title' ? h('span', { id: 'kbcg-title-err', className: 'kbcg-fe', role: 'alert', 'data-kb': 'catalog-title-error' }, kt('Un titre est nécessaire.', 'A title is required.')) : null),
            showSubtitle ? h('div', { className: 'kbcg-field' }, h('label', { htmlFor: 'kbcg-f-subtitle' }, kt('Sous-titre', 'Subtitle')),
              h('input', { id: 'kbcg-f-subtitle', className: 'kbcg-in', 'data-kb': 'catalog-field-subtitle', type: 'text', maxLength: 200, value: form.subtitle, onChange: (e) => set({ subtitle: e.target.value }) })) : null,
            h('div', { className: 'kbcg-grid2' },
              showPrice ? h('div', { className: 'kbcg-field' }, h('label', { htmlFor: 'kbcg-f-price_text' }, kt('Prix', 'Price')),
                h('input', { id: 'kbcg-f-price_text', className: 'kbcg-in', 'data-kb': 'catalog-field-price_text', type: 'text', maxLength: 60, value: form.price_text, onChange: (e) => set({ price_text: e.target.value }) })) : null,
              type !== null ? h('div', { className: 'kbcg-field' }, h('label', { htmlFor: 'kbcg-f-status' }, kt('Statut', 'Status')),
                h('select', { id: 'kbcg-f-status', className: 'kbcg-in', 'data-kb': 'catalog-field-status', value: form.status, onChange: (e) => set({ status: e.target.value }) }, type.statuses.map((s) => h('option', { key: s.key, value: s.key }, pick(s.label, humanize(s.key)))))) : null),
            type !== null && type.fields.length > 0 ? h('div', { className: 'kbcg-grid2' }, type.fields.map(input)) : null,
            editing && type === null ? h('p', { className: 'kbcg-fe', style: { color: 'inherit' }, 'data-kb': 'catalog-generic-note' }, kt('Ton thème ne définit plus le type de cet élément : seuls son titre, son sous-titre et son prix se modifient.', 'Your theme no longer defines this item’s type: only its title, subtitle and price can be edited.')) : null,
            problem.indexOf('server:') === 0 ? h('div', { className: 'kbcg-banner err', role: 'alert', 'data-kb': 'catalog-form-error' }, Ic('alert', 16), h('span', { className: 'sp' }, problem.slice(7))) : null,
            h('div', { className: 'acts' },
              h('button', { type: 'button', className: 'kbcg-btn', 'data-kb': 'catalog-cancel', onClick: onClose, disabled: busy }, kt('Annuler', 'Cancel')),
              h('button', { type: 'submit', className: 'kbcg-btn primary', 'data-kb': 'catalog-save', disabled: busy }, busy ? kt('Enregistrement…', 'Saving…') : (editing ? kt('Enregistrer', 'Save') : kt('Ajouter', 'Add'))))))
      }

      const ConfirmDialog = (props) => {
        const ref = useRef(null)
        const [busy, setBusy] = useState(false)
        useDialog(ref, props.onClose)
        return h('div', { className: 'kbcg-veil', onMouseDown: (e) => { if (e.target === e.currentTarget && !busy) props.onClose() } },
          h('div', { className: 'kbcg-dlg', ref, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'kbcg-cf-title', 'aria-describedby': 'kbcg-cf-body', 'data-kb': 'catalog-confirm' },
            h('h3', { id: 'kbcg-cf-title' }, props.title),
            h('p', { id: 'kbcg-cf-body' }, props.body),
            h('div', { className: 'acts' },
              h('button', { type: 'button', className: 'kbcg-btn', 'data-kb': 'catalog-confirm-cancel', onClick: props.onClose, disabled: busy }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbcg-btn danger', 'data-kb': 'catalog-confirm-ok', disabled: busy, onClick: async () => { setBusy(true); await props.onConfirm(); setBusy(false) } }, props.action))))
      }

      // ── the detail panel ─────────────────────────────────────────────────────────────────────────────────
      const Panel = (props) => {
        const { row, types, index } = props
        const type = typeOf(types, row)
        const card = cardOf(type, row)
        const closeRef = useRef(null)
        useEffect(() => { try { if (closeRef.current !== null) closeRef.current.focus() } catch (e) { /* nothing to focus */ } }, [row.id])
        useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') props.onClose() }
          document.addEventListener('keydown', onKey)
          return () => document.removeEventListener('keydown', onKey)
        }, [])
        const stored = row.fields === null || row.fields === undefined ? {} : row.fields
        // the picture reference and the place are drawn (the photograph, the map), not listed
        const drawn = type === null ? [] : [type.card === undefined ? undefined : type.card.image, type.map === undefined ? undefined : type.map.lat, type.map === undefined ? undefined : type.map.lng].filter((k) => k !== undefined)
        const known = type === null ? [] : type.fields.filter((d) => drawn.indexOf(d.key) < 0 && stored[d.key] !== undefined && stored[d.key] !== null && stored[d.key] !== '').map((d) => ({ key: d.key, label: pick(d.label, humanize(d.key)), def: d, value: stored[d.key] }))
        const loose = Object.keys(stored).filter((k) => type === null || type.fields.every((d) => d.key !== k)).filter((k) => stored[k] !== null && stored[k] !== '').map((k) => ({ key: k, label: humanize(k), def: null, value: stored[k] }))
        const shown = known.concat(loose)
        const value = (f) => {
          const text = valueText(f.def, f.value)
          if (f.def !== null && f.def.type === 'url' && /^https?:\/\//.test(text)) return h('a', { href: text, target: '_blank', rel: 'noopener noreferrer' }, text)
          if (f.def !== null && f.def.type === 'email') return h('a', { href: 'mailto:' + text }, text)
          return text
        }
        const archived = archivedRow(row)
        return h('aside', { className: 'kbcg-panel' + (props.inline ? ' inline' : ''), role: 'complementary', 'aria-label': kt('Détails', 'Details'), 'data-kb': 'catalog-panel', 'data-id': row.id },
          h('button', { type: 'button', className: 'x', ref: closeRef, 'aria-label': kt('Fermer', 'Close'), 'data-kb': 'catalog-close', onClick: props.onClose }, Ic('x', 16)),
          h(Picture, { type, row, index, wide: true }, h(StatusTag, { type, row })),
          h('h3', null, card.title),
          card.subtitle !== '' && card.subtitle !== card.title ? h(SubLine, { card, tag: 'p', className: 'sub' }) : null,
          card.price !== '' || card.flag !== null ? h('p', { className: 'sub' }, card.price, card.price !== '' && card.flag !== null ? ' · ' : '', card.flag !== null ? h('span', { className: 'kbcg-flag', 'data-kb': 'catalog-flag' }, card.flag) : null) : null,
          h(ChipRow, { type, row }),
          row.demo === true || archived ? h('div', { className: 'badges' }, row.demo === true ? h(DemoTag) : null, archived ? h(Tag, { kb: 'catalog-archived-badge' }, kt('Archivé', 'Archived')) : null) : null,
          shown.length > 0 ? h('dl', { className: 'kbcg-dl' }, shown.map((f) => h(React.Fragment, { key: f.key }, h('dt', null, f.label), h('dd', null, value(f))))) : null,
          h('div', { className: 'kbcg-acts' },
            archived ? null : h('button', { type: 'button', className: 'kbcg-btn sm primary', 'data-kb': 'catalog-edit', onClick: props.onEdit }, Ic('edit', 14), kt('Modifier', 'Edit')),
            archived
              ? h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-restore', onClick: props.onRestore }, Ic('undo', 14), kt('Restaurer', 'Restore'))
              : h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-archive', onClick: props.onArchive }, Ic('archive', 14), kt('Archiver', 'Archive'))),
          typeof row.updated_at === 'string' ? h('p', { className: 'kbcg-foot' }, kt('Modifié le ', 'Updated ') + dateText(row.updated_at.slice(0, 10))) : null)
      }

      // ── the results ──────────────────────────────────────────────────────────────────────────────────────
      const Cards = (props) => h('div', { className: 'kbcg-cards', 'data-kb': 'catalog-cards' }, props.rows.map((row, i) => {
        const type = typeOf(props.types, row)
        const card = cardOf(type, row)
        const on = props.short.indexOf(row.id) >= 0
        return h('article', { key: row.id, className: 'kbcg-card kz-lift kz-in' + (props.hot === row.id ? ' hot' : ''), style: { '--kz-i': Math.min(i, 14) }, 'data-kb': 'catalog-card', 'data-id': row.id, 'data-known': type === null ? 'no' : 'yes', 'aria-current': props.selected === row.id ? 'true' : undefined, onMouseEnter: () => props.onHover(row.id), onMouseLeave: () => props.onHover(null) },
          h('button', { type: 'button', className: 'kbcg-open', 'data-kb': 'catalog-card-open', onClick: () => props.onOpen(row, i) },
            h(Picture, { type, row, index: i }, h(StatusTag, { type, row }), row.demo === true ? h(DemoTag) : null),
            h('span', { className: 'kbcg-body' },
              h('b', null, card.title),
              card.subtitle !== '' ? h(SubLine, { card, tag: 'small' }) : null,
              h(ChipRow, { type, row }),
              card.price !== '' ? h('span', { className: 'kbcg-price', 'data-kb': 'catalog-price' }, card.price) : null,
              card.flag !== null ? h('small', { className: 'kbcg-flag', 'data-kb': 'catalog-flag' }, card.flag) : null)),
          h(Heart, { on, onToggle: () => props.onShort(row.id) }))
      }))
      const Table = (props) => {
        const notes = props.rows.some((row) => cardOf(typeOf(props.types, row), row).flag !== null)
        return h('table', { className: 'kbcg-tbl', 'data-kb': 'catalog-list' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, kt('Élément', 'Item')), h('th', { scope: 'col' }, kt('Statut', 'Status')), h('th', { scope: 'col' }, kt('Prix', 'Price')), notes ? h('th', { scope: 'col' }, kt('Note', 'Note')) : null)),
        h('tbody', null, props.rows.map((row, i) => {
          const type = typeOf(props.types, row)
          const card = cardOf(type, row)
          const open = () => props.onOpen(row, i)
          return h('tr', { key: row.id, className: 'r kz-in' + (props.hot === row.id ? ' hot' : ''), style: { '--kz-i': Math.min(i, 14) }, tabIndex: 0, 'data-kb': 'catalog-row', 'data-id': row.id, 'data-known': type === null ? 'no' : 'yes', 'aria-current': props.selected === row.id ? 'true' : undefined, onClick: open, onKeyDown: onActivate(open), onMouseEnter: () => props.onHover(row.id), onMouseLeave: () => props.onHover(null) },
            h('td', null, h('div', { className: 'who' }, h('span', { className: 'kbcg-thumb' }, h(Picture, { type, row, index: i })), h('div', null, h('b', null, card.title, row.demo === true ? ' ' : null, row.demo === true ? h(DemoTag) : null), card.subtitle !== '' ? h(SubLine, { card, tag: 'small' }) : null, h(ChipRow, { type, row })))),
            h('td', null, h(StatusTag, { type, row })),
            h('td', null, h('b', null, card.price)),
            notes ? h('td', { className: 'muted' }, card.flag !== null ? h('span', { className: 'kbcg-flag', 'data-kb': 'catalog-flag' }, card.flag) : '') : null)
        })))
      }

      // ── the bar: the product's own (`props.toolbar.KbToolbar`) when the core hands it over, else this one ─────────────────────────────────────
      // The core does not hand the toolbar to a business page yet (measured in a sandbox: `props.toolbar` is null), so this is what the person sees today.
      // It is the same pieces as KbToolbar, drawn with the core's own classes (`kb6-*`): a ghost magnifier that opens the search pill, the view group, then the
      // primary action, so the page looks like Skills and Dashboards and takes the product's look when the core changes it.
      const PlainBar = (props) => {
        const [open, setOpen] = useState(false)
        const input = useRef(null)
        const shown = open || props.query.trim().length > 0
        useEffect(() => { if (open) { try { if (input.current !== null) input.current.focus() } catch (e) { /* the person clicks the field */ } } }, [open])
        const word = kt('Rechercher', 'Search')
        const clear = () => { if (props.query.length > 0) props.onQuery(''); setOpen(false) }
        return h('div', { className: 'kb6-toolbar', 'data-kb': 'catalog-own-bar' },
          h('div', { className: 'kb6-tb-row' },
            h('div', { className: 'kb6-tb-tools' },
              shown ? null : h('button', { type: 'button', className: 'kb6-tb-ghost', 'data-kb': 'catalog-search-toggle', title: word, 'aria-label': word, 'aria-expanded': 'false', onClick: () => setOpen(true) }, Ic('search', 17)),
              h('div', { className: 'kb6-search kb6-search-inline kb6-tb-search' + (shown ? '' : ' closed'), role: 'search' },
                Ic('search', 14),
                h('input', { ref: input, type: 'search', 'data-kb': 'catalog-search', value: props.query, placeholder: word, 'aria-label': word, onChange: (e) => props.onQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); clear() } } }),
                shown ? h('button', { type: 'button', className: 'kb6-tb-clear', 'data-kb': 'catalog-search-clear', 'aria-label': props.query.length > 0 ? kt('Effacer la recherche', 'Clear the search') : word, onClick: clear }, Ic('x', 13)) : null),
              props.views.length > 1 ? h('div', { className: 'kb6-tb-viewgrp', role: 'group', 'aria-label': kt('Affichage', 'View') }, props.views.map((v) => {
                const label = v === 'cards' ? kt('Cartes', 'Cards') : (v === 'map' ? kt('Carte', 'Map') : kt('Liste', 'List'))
                return h('button', { key: v, type: 'button', className: 'kb6-tb-vbtn' + (props.view === v ? ' on' : ''), 'data-kb': 'catalog-view', 'data-view': v, 'aria-label': label, title: label, 'aria-pressed': props.view === v ? 'true' : 'false', onClick: () => props.onView(v) }, Ic(v === 'cards' ? 'grid' : (v === 'map' ? 'map' : 'list'), 16))
              })) : null),
            h('div', { className: 'kb6-tb-trailing' }, props.trailing)))
      }

      /** The state of the bar when the product's own hook is not there: the same shape, kept in the page. */
      const useLocalBar = (pageId, defaults) => {
        const [st, setSt] = useState(() => Object.assign({ query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'cards' }, defaults))
        const update = (patch) => setSt((prev) => Object.assign({}, prev, patch))
        return [st, update]
      }

      // ── the page ─────────────────────────────────────────────────────────────────────────────────────────
      function CatalogPage (props) {
        const toolbar = props !== null && props !== undefined && props.toolbar !== null && props.toolbar !== undefined && typeof props.toolbar === 'object' ? props.toolbar : null
        const KbBar = toolbar !== null && typeof toolbar.KbToolbar === 'function' ? toolbar.KbToolbar : null
        const [types, setTypes] = useState(null)
        const [source, setSource] = useState('default')
        // the bar's state is the product's own (kept per page, search and view included) when it is handed over, else this page's
        const useBar = toolbar !== null && typeof toolbar.useToolbarState === 'function' ? toolbar.useToolbarState : useLocalBar
        const [bar, updateBar] = useBar('catalog', { viewMode: readView() === '' ? 'cards' : readView() })
        const q = typeof bar.query === 'string' ? bar.query : ''
        const setQ = (v) => updateBar({ query: v })
        const [dq, setDq] = useState(q)
        const [short, setShort] = useState(readShortlist)
        const [hot, setHot] = useState(null)
        const [typeKey, setTypeKey] = useState('')
        const [status, setStatus] = useState('')
        const [archived, setArchived] = useState(false)
        const view = bar.viewMode
        const [data, setData] = useState(null)
        const [err, setErr] = useState(null)
        const [tick, setTick] = useState(0)
        const [typesTick, setTypesTick] = useState(0)
        const [sel, setSel] = useState(null)
        const [dlg, setDlg] = useState(null)
        const [confirm, setConfirm] = useState(false)
        const [toast, setToast] = useState(null)
        const [more, setMore] = useState(false)
        const seq = useRef(0)
        const alive = useRef(true)
        useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

        // the types of the active theme (one question; a theme installed later shows after the page is opened again)
        useEffect(() => {
          let live = true
          ;(async () => {
            const r = await api('GET', 'types')
            if (!live) return
            if (failed(r)) { setErr({ code: codeOf(r), status: r.status }); setTypes([]); return }
            setTypes(r.json.types)
            setSource(r.json.source)
          })()
          return () => { live = false }
        }, [typesTick])

        useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t) }, [q])

        const query = (offset) => {
          const p = ['limit=' + PAGE, 'offset=' + offset]
          if (dq.trim() !== '') p.push('q=' + encodeURIComponent(dq.trim()))
          if (typeKey !== '') p.push('type=' + encodeURIComponent(typeKey))
          if (status !== '' && !archived) p.push('status=' + encodeURIComponent(status))
          if (archived) p.push('archived=only')
          return 'list?' + p.join('&')
        }
        // the list: asked again when a filter or the search changes, or after a write
        useEffect(() => {
          if (types === null) return undefined
          const mine = seq.current + 1
          seq.current = mine
          ;(async () => {
            const r = await api('GET', query(0))
            if (!alive.current || seq.current !== mine) return
            if (failed(r)) { setErr({ code: codeOf(r), status: r.status }); return }
            setErr(null)
            setData(r.json)
          })()
          return undefined
        }, [types, dq, typeKey, status, archived, tick])

        const reload = () => setTick((n) => n + 1)
        const say = (text, undo) => setToast({ text, undo: undo || null, at: Date.now() })
        useEffect(() => {
          if (toast === null) return undefined
          const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3500)
          return () => clearTimeout(t)
        }, [toast])

        const list = types === null ? [] : types
        const views = viewsOf(list, typeKey)
        const shownView = views.indexOf(view) >= 0 ? view : views[0]
        const changeView = (v) => { updateBar({ viewMode: v }); saveView(v) }
        const loaded = data === null ? [] : data.rows
        const favOnly = bar.fav === true
        // the shortlist is kept in this browser; « favourites only » and the sort work on the rows that are loaded
        const rows = sortRows(favOnly ? loaded.filter((r) => short.indexOf(r.id) >= 0) : loaded, bar.sort, bar.dir)
        const toggleShort = (id) => { const next = short.indexOf(id) >= 0 ? short.filter((x) => x !== id) : short.concat([id]); setShort(next); saveShortlist(next) }
        const selected = sel === null ? null : (rows.find((r) => r.id === sel.id) || sel)
        const filtering = dq.trim() !== '' || typeKey !== '' || status !== '' || favOnly
        const clearFilters = () => { setQ(''); setDq(''); setTypeKey(''); setStatus(''); updateBar({ fav: false }) }
        // closing the panel gives the keyboard back to the card or row that opened it
        const returnTo = useRef(null)
        const open = (row) => setSel(row)
        const closePanel = () => { if (sel !== null) returnTo.current = sel.id; setSel(null) }
        useEffect(() => {
          if (sel !== null || returnTo.current === null) return
          const id = returnTo.current
          returnTo.current = null
          try {
            const el = document.querySelector('[data-kb="catalog-card"][data-id="' + id + '"] .kbcg-open, [data-kb="catalog-row"][data-id="' + id + '"]')
            if (el !== null && el !== undefined && typeof el.focus === 'function') el.focus()
          } catch (e) { /* the row is gone (archived): nothing to focus */ }
        }, [sel])

        const save = (editing) => async (body) => {
          const r = editing === null ? await api('POST', 'create', body) : await api('POST', 'update', { id: editing.id, patch: body })
          if (failed(r)) return errorText(codeOf(r), r.status)
          setDlg(null)
          if (editing === null) { clearFilters(); setArchived(false); setSel(r.json.row); say(kt('Ajouté : ', 'Added: ') + r.json.row.title) } else { setSel(r.json.row); say(kt('Enregistré : ', 'Saved: ') + r.json.row.title) }
          reload()
          return null
        }
        const archive = async (row) => {
          const r = await api('POST', 'archive', { id: row.id })
          if (failed(r)) { say(errorText(codeOf(r), r.status)); return }
          setSel(null)
          say(kt('Archivé : ', 'Archived: ') + row.title, { id: row.id })
          reload()
        }
        const restore = async (row) => {
          const r = await api('POST', 'restore', { id: row.id })
          if (failed(r)) { say(errorText(codeOf(r), r.status)); return }
          setSel(null)
          say(kt('Restauré : ', 'Restored: ') + row.title)
          reload()
        }
        const clearDemo = async () => {
          const r = await api('POST', 'clear-demo', { confirm: true })
          setConfirm(false)
          if (failed(r)) { say(errorText(codeOf(r), r.status)); return }
          setSel(null)
          say(kt('Données d’exemple supprimées.', 'Sample data removed.'))
          reload()
        }

        const title = pageTitle(list, source)
        const addButton = h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'catalog-new', disabled: types === null || list.length === 0 || (err !== null && data === null), onClick: () => setDlg({ row: null }) }, Ic('plus', 14), ' ', newLabel(list))
        const onBar = (patch) => { updateBar(patch); if (patch !== null && typeof patch === 'object' && (patch.viewMode === 'cards' || patch.viewMode === 'list' || patch.viewMode === 'map')) saveView(patch.viewMode) }
        const sortOptions = [{ id: 'modified', label: kt('Dernière modification', 'Latest change') }, { id: 'price', label: kt('Prix', 'Price') }, { id: 'name', label: kt('Nom', 'Name') }]
        const help = typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-catalog' }) : null
        const header = h('div', { className: 'kb6-headrow kbcg-head' },
          h('div', { className: 'kb6-headcol' },
            h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title', 'data-kb': 'catalog-title' }, title), help),
            h('p', { className: 'kb8-sub' }, kt('Ce que tu vends, loues ou recrutes, en cartes, en liste ou sur une carte.', 'What you sell, rent or recruit for, as cards, a list or on a map.'))),
          KbBar !== null
            ? h(KbBar, { state: shownView === bar.viewMode ? bar : Object.assign({}, bar, { viewMode: shownView }), onUpdate: onBar, views, viewLabels: true, sortOptions, showFav: true, searchPlaceholder: kt('Rechercher', 'Search'), trailing: addButton })
            : h(PlainBar, { query: q, onQuery: setQ, views, view: shownView, onView: changeView, trailing: addButton }))

        // states
        let body
        if (types === null || (data === null && err === null)) {
          body = h('div', { 'data-kb': 'catalog-loading' }, h('span', { className: 'kbcg-sr', role: 'status' }, kt('Chargement…', 'Loading…')), h(Bones))
        } else if (err !== null && data === null) {
          body = h('div', { className: 'kbcg-banner err', role: 'alert', 'data-kb': 'catalog-error', 'data-code': err.code }, Ic('alert', 18), h('span', { className: 'sp' }, errorText(err.code, err.status)),
            h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-retry', onClick: () => { setErr(null); setData(null); if (types.length === 0) { setTypes(null); setTypesTick((n) => n + 1) } else reload() } }, Ic('refresh', 14), kt('Réessayer', 'Try again')))
        } else {
          const chips = chipsOf(list, typeKey, data.counts, data.countsPartial)
          const allCount = data.countsPartial === true ? null : sumCounts(data.counts)
          const none = rows.length === 0
          const trulyEmpty = data.total === 0 && !filtering && !archived
          const placed = shownView === 'map' ? placedRows(rows, list) : []
          const results0 = { rows, types: list, selected: selected === null ? null : selected.id, onOpen: open, short, onShort: toggleShort, hot, onHover: setHot }
          // a pin opens the item and brings its card into view in the list beside the map
          const pickOnMap = (row) => { open(row); setTimeout(() => { try { const el = document.querySelector('[data-kb="catalog-panel"]'); if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch (e) { /* the list stays where it is */ } }, 60) }
          const results = none
            ? (archived
              ? h('div', { className: 'kbcg-empty', 'data-kb': 'catalog-empty', 'data-why': 'archived' }, h('b', null, kt('Rien dans les archives', 'Nothing archived')), h('span', null, kt('Les éléments archivés apparaissent ici, et tu peux les restaurer.', 'Archived items appear here, and you can restore them.')))
              : filtering
                ? h('div', { className: 'kbcg-empty', 'data-kb': 'catalog-empty', 'data-why': 'filter' }, h('b', null, kt('Aucun résultat', 'No match')), h('span', null, kt('Aucun élément ne correspond à cette recherche ou à ce filtre.', 'No item matches this search or filter.')), h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-clear-filters', onClick: clearFilters }, kt('Effacer la recherche et les filtres', 'Clear search and filters')))
                : h('div', { className: 'kbcg-empty', 'data-kb': 'catalog-empty', 'data-why': 'empty' }, h('b', null, kt('Rien ici pour l’instant', 'Nothing here yet')), h('span', null, kt('Ajoute ton premier élément, ou demande à ton agent de le faire.', 'Add your first item, or ask your agent to do it.')), h('button', { type: 'button', className: 'kbcg-btn sm primary', 'data-kb': 'catalog-empty-new', onClick: () => setDlg({ row: null }) }, Ic('plus', 14), newLabel(list))))
            : (shownView === 'list' ? h(Table, results0) : (shownView === 'map'
              ? h('div', { className: 'kbcg-split', 'data-kb': 'catalog-split' }, h('div', { style: { minWidth: 0 } }, [selected !== null ? h(Panel, { key: 'panel', row: selected, types: list, index: Math.max(0, rows.findIndex((r) => r.id === selected.id)), inline: true, onClose: closePanel, onEdit: () => setDlg({ row: selected }), onArchive: () => archive(selected), onRestore: () => restore(selected) }) : null, h(Cards, Object.assign({ key: 'cards' }, results0))]), h(MapSwitch, { placed: placed, unplaced: rows.length - placed.length, seed: seedOf(typeKey !== '' ? typeKey : (list.length > 0 ? list[0].id : 'town')), selected: selected === null ? null : selected.id, hot, onHover: setHot, onPick: pickOnMap }))
              : h(Cards, results0)))
          const loadMore = async () => {
            setMore(true)
            const mine = seq.current
            const r = await api('GET', query(loaded.length))
            setMore(false)
            if (!alive.current || seq.current !== mine) return
            if (failed(r)) { say(errorText(codeOf(r), r.status)); return }
            setData((d) => Object.assign({}, r.json, { rows: d.rows.concat(r.json.rows) }))
          }
          body = h(React.Fragment, null,
            data.demo.items > 0 && !archived ? h('div', { className: 'kbcg-banner', 'data-kb': 'catalog-demo-banner' }, h('span', { className: 'sp' }, kt('Données d’exemple : ces lignes montrent à quoi ressemble la page.', 'Sample data: these rows show what the page looks like.')),
              h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-demo-clear', onClick: () => setConfirm(true) }, kt('Supprimer les données d’exemple', 'Clear sample data'))) : null,
            h('div', { className: 'kbcg-tools', 'data-kb': 'catalog-filters' },
              trulyEmpty ? null : h(React.Fragment, null, list.length > 1 ? h(React.Fragment, null,
                h('button', { type: 'button', className: 'kbcg-chip', 'data-kb': 'catalog-type-chip', 'data-type': '', 'aria-pressed': typeKey === '' ? 'true' : 'false', onClick: () => { setTypeKey(''); setStatus('') } }, kt('Tous les types', 'All types')),
                list.map((t) => h('button', { key: t.id, type: 'button', className: 'kbcg-chip', 'data-kb': 'catalog-type-chip', 'data-type': t.id, 'aria-pressed': typeKey === t.id ? 'true' : 'false', onClick: () => { setTypeKey(t.id); setStatus('') } }, pick(t.plural, humanize(t.id)))),
                null) : null,
              archived ? null : h(React.Fragment, null,
                h('button', { type: 'button', className: 'kbcg-chip', 'data-kb': 'catalog-chip', 'data-status': '', 'aria-pressed': status === '' ? 'true' : 'false', onClick: () => setStatus('') }, kt('Tous', 'All'), allCount === null ? null : h('span', { className: 'n' }, allCount)),
                chips.map((c) => h('button', { key: c.key, type: 'button', className: 'kbcg-chip', 'data-kb': 'catalog-chip', 'data-status': c.key, 'aria-pressed': status === c.key ? 'true' : 'false', onClick: () => setStatus(status === c.key ? '' : c.key) }, c.label, c.count === null ? null : h('span', { className: 'n' }, c.count)))),
                null),
              h('button', { type: 'button', className: 'kbcg-chip' + (trulyEmpty || archived ? '' : ' kbcg-toggle'), 'data-kb': 'catalog-archived', 'aria-pressed': archived ? 'true' : 'false', onClick: () => { setArchived(!archived); setSel(null) } }, Ic('archive', 13), ' ', kt('Voir les archives', 'Show archived'))),
            err !== null ? h('div', { className: 'kbcg-banner err', role: 'alert', 'data-kb': 'catalog-error', 'data-code': err.code }, Ic('alert', 18), h('span', { className: 'sp' }, errorText(err.code, err.status)), h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-retry', onClick: reload }, Ic('refresh', 14), kt('Réessayer', 'Try again'))) : null,
            h('div', { className: 'kbcg-main' + (selected !== null && shownView !== 'map' ? ' withpanel' : '') },
              h('div', { style: { minWidth: 0 } }, results,
                data.total > loaded.length ? h('div', { className: 'kbcg-more', 'data-kb': 'catalog-more' }, h('span', null, loaded.length + ' / ' + data.total), h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-more-btn', disabled: more, onClick: loadMore }, more ? kt('Chargement…', 'Loading…') : kt('Afficher la suite', 'Show more'))) : null),
              selected !== null && shownView !== 'map' ? h(Panel, { row: selected, types: list, index: Math.max(0, rows.findIndex((r) => r.id === selected.id)), onClose: closePanel, onEdit: () => setDlg({ row: selected }), onArchive: () => archive(selected), onRestore: () => restore(selected) }) : null))
        }

        return h('div', { className: 'kbcg', 'data-kb': 'catalog-page' },
          header,
          body,
          dlg !== null && list.length > 0 ? h(FormDialog, { key: dlg.row === null ? 'new' : 'edit-' + dlg.row.id, types: list, row: dlg.row, onClose: () => setDlg(null), onSave: save(dlg.row) }) : null,
          confirm ? h(ConfirmDialog, {
            title: kt('Supprimer les données d’exemple ?', 'Clear the sample data?'),
            body: kt('Les lignes d’exemple disparaissent' + (data !== null && data.demo.all > data.demo.items ? ' (' + data.demo.all + ' au total : les exemples de Contacts et de Pipeline aussi)' : '') + '. Ce que tu as ajouté toi-même reste.', 'The sample rows go away' + (data !== null && data.demo.all > data.demo.items ? ' (' + data.demo.all + ' in all: the samples of Contacts and Pipeline too)' : '') + '. What you added yourself stays.'),
            action: kt('Supprimer', 'Clear'),
            onClose: () => setConfirm(false),
            onConfirm: clearDemo,
          }) : null,
          toast !== null ? h('div', { className: 'kbcg-toast', role: 'status', 'aria-live': 'polite', 'data-kb': 'catalog-toast' }, h('span', null, toast.text),
            toast.undo ? h('button', { type: 'button', className: 'kbcg-btn sm', 'data-kb': 'catalog-undo', onClick: async () => { const id = toast.undo.id; setToast(null); const r = await api('POST', 'restore', { id }); if (failed(r)) say(errorText(codeOf(r), r.status)); else reload() } }, Ic('undo', 14), kt('Annuler', 'Undo')) : null) : null)
      }

      // ── mounting ─────────────────────────────────────────────────────────────────────────────────────────
      function apply (ctx) {
        // the styles, one node, taken away with the plugin
        ctx.effect(() => {
          if (document.getElementById(STYLE_ID)) return undefined
          const el = document.createElement('style')
          el.id = STYLE_ID
          el.setAttribute('data-plugin', '@local/kybernos-catalog')
          el.textContent = CSS
          document.head.appendChild(el)
          return () => { el.remove() }
        }, 'kybernos-catalog: styles')
        // the row of the menu: declared here, taken back with the plugin. The core builds `window.__KB_MENU__` when ITS client is applied, and measured in a
        // sandbox that is AFTER this plugin's apply (the core's client comes late in the load order), so the row waits for the registry: every 150 ms for 15 s at most,
        // then gives up (a core without the registry draws no row). The wait and the row are both taken away with the plugin.
        ctx.effect(() => {
          let off = null
          let timer = null
          let tries = 0
          let gone = false
          const declare = () => {
            try {
              const registry = window.__KB_MENU__
              if (registry === undefined || registry === null || typeof registry.register !== 'function') return false
              off = registry.register(MENU_ROW)
              return true
            } catch (e) { return true }
          }
          const wait = () => {
            timer = null
            if (gone || declare() || (tries += 1) >= MENU_TRIES) return
            timer = setTimeout(wait, MENU_EVERY)
          }
          wait()
          return () => { gone = true; if (timer !== null) clearTimeout(timer); try { if (typeof off === 'function') off() } catch (e) { /* already taken back */ } }
        }, 'kybernos-catalog: menu row')
        // the page
        ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, key: ROW_ID }, CatalogPage)), 'kybernos-catalog: page')
      }

      return {
        name: 'kybernos-catalog',
        inject: ['slots'],
        apply (ctx) {
          try { apply(ctx) } catch (e) { console.warn('[kybernos-catalog] page not mounted:', e) }
        },
        __test: { pick, humanize, valueText, cardOf, flagText, viewsOf, chipsOf, sumCounts, pageTitle, newLabel, errorText, formOf, payloadOf, typeOf, statusOf, CatalogPage, FormDialog, Panel, CSS, pictureRef, fallbackArt, energyHue, statText, cardChips, pinPrice, placedRows, projectPins, sortRows, townBlocks, MapView, Picture, Cards, Table, worldPx, clusterPins, aloneZoom, boundsOf, clusterAction, mapGate, startVerdict, parseColor, colorHex, flipColor, paletteFrom, tweakStyle, whyText, MapSwitch, RealMap, MAP_BUDGET_MS, MAP_RETRY_MS, MAP_STYLE_URL, MAP_LIB, ATTRIBUTION, resetMapState: () => { mapFailure = null; webglKnown = null; mapLibPromise = null; mapStyleCache = null; tokenCx = null } },
      }
    } catch (e) {
      console.warn('[kybernos-catalog] disabled:', e)
      return { apply () {} }
    }
  }
})
