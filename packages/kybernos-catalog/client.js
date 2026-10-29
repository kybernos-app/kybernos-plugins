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
        plus2: 'M12 5v14M5 12h14',
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
      .kbcg-panel .x{position:absolute;inset-inline-end:10px;top:10px;width:30px;height:30px;border-radius:8px;border:0;background:color-mix(in srgb,var(--kbcg-l1) 85%,transparent);display:grid;place-items:center;color:var(--kbcg-t2)}
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
      .kbcg-mapbox{position:sticky;top:8px;height:min(740px,calc(100vh - 190px));min-height:360px;border:1px solid var(--kbcg-b2);border-radius:16px;overflow:hidden;background:var(--kbcg-map-land)}
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
      @media (max-width:900px){
        .kbcg-split{grid-template-columns:minmax(0,1fr)}
        .kbcg-mapbox{position:relative;top:0;height:300px;min-height:0;order:-1}
      }
      @media (max-width:1100px){
        .kbcg-main.withpanel{grid-template-columns:minmax(0,1fr)}
        .kbcg-panel{position:fixed;inset-inline:12px;bottom:12px;top:auto;max-height:70vh;z-index:900}
        .kbcg-panel .kbcg-tile{aspect-ratio:auto;height:84px}
      }
      @media (max-width:640px){.kbcg-grid2{grid-template-columns:1fr}}
      @media (prefers-reduced-motion:reduce){.kbcg-bone{animation:none}.kbcg-card,.kbcg-chip,.kbcg-btn,.kbcg-heart,.kbcg-pin .body,.kbcg-mapctl button,.kbcg-tbl tr.r{transition:none}.kbcg-panel.inline{animation:none}.kbcg-heart:hover,.kbcg-pin:hover .body,.kbcg-pin.on .body{transform:none}}
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
        return h('div', { className: 'kbcg-mapbox', 'data-kb': 'catalog-map-box' },
          h('svg', { ref: box, className: 'kbcg-map' + (drag ? ' drag' : ''), viewBox: '0 0 ' + MAP_W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': kt('Carte schématique des biens', 'Schematic map of the items'), 'data-kb': 'catalog-map', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
            h('g', { transform: 'translate(' + cam.tx + ' ' + cam.ty + ') scale(' + cam.k + ')' },
              h('rect', { className: 'land', x: -2000, y: -1500, width: 5000, height: 4000 }),
              blocks.map((b, i) => h('rect', { key: i, className: b.park ? 'park' : 'block', x: b.x, y: b.y, width: b.w, height: b.h, rx: b.park ? 22 : 7 })),
              h('path', { className: 'street', d: 'M-600 ' + Math.round(H * 0.17) + ' L1700 ' + Math.round(H * 0.72), strokeWidth: 15 }), h('path', { className: 'street', d: 'M330 -400 L610 ' + (H + 400), strokeWidth: 15 }),
              h('path', { className: 'water', d: 'M-900 ' + (H - 30) + ' C -300 ' + (H - 70) + ' 200 ' + (H - 14) + ' 480 ' + (H - 44) + ' S 1000 ' + (H - 12) + ' 1900 ' + (H - 52) + ' L1900 ' + (H + 1200) + ' L-900 ' + (H + 1200) + ' Z' }),
              h('path', { className: 'river', d: 'M1200 -420 C 1000 ' + Math.round(H * 0.03) + ' 900 ' + Math.round(H * 0.24) + ' 790 ' + Math.round(H * 0.42) + ' S 610 ' + Math.round(H * 0.74) + ' 520 ' + (H - 34), strokeWidth: 24 })),
            pins.map((pin) => pinOf(pin, false)), pins.filter(lit).map((pin) => pinOf(pin, true))),
          h('div', { className: 'kbcg-mapctl' },
            h('button', { type: 'button', 'data-kb': 'catalog-map-zoom-in', 'aria-label': kt('Zoom avant', 'Zoom in'), title: kt('Zoom avant', 'Zoom in'), onClick: () => zoom(1.4) }, Ic('plus2', 16)),
            h('button', { type: 'button', 'data-kb': 'catalog-map-zoom-out', 'aria-label': kt('Zoom arrière', 'Zoom out'), title: kt('Zoom arrière', 'Zoom out'), onClick: () => zoom(1 / 1.4) }, Ic('minus', 16)),
            h('button', { type: 'button', 'data-kb': 'catalog-map-fit', 'aria-label': kt('Tout voir', 'Show everything'), title: kt('Tout voir', 'Show everything'), onClick: () => setCam({ k: 1, tx: 0, ty: 0 }) }, Ic('fit', 16))),
          h('div', { className: 'kbcg-mapnote', 'data-kb': 'catalog-map-note' }, Ic('map', 14), h('span', null, kt('Carte schématique', 'Schematic map'), ' · ', props.placed.length + (props.placed.length === 1 ? kt(' lieu', ' place') : kt(' lieux', ' places'))), props.unplaced > 0 ? h('span', { 'data-kb': 'catalog-map-unplaced' }, ' · ' + props.unplaced + kt(' sans emplacement', ' without a place')) : null))
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
            ? h(KbBar, { state: bar, onUpdate: onBar, views, viewLabels: true, sortOptions, showFav: true, searchPlaceholder: kt('Rechercher', 'Search'), trailing: addButton })
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
              ? h('div', { className: 'kbcg-split', 'data-kb': 'catalog-split' }, h('div', { style: { minWidth: 0 } }, [selected !== null ? h(Panel, { key: 'panel', row: selected, types: list, index: Math.max(0, rows.findIndex((r) => r.id === selected.id)), inline: true, onClose: closePanel, onEdit: () => setDlg({ row: selected }), onArchive: () => archive(selected), onRestore: () => restore(selected) }) : null, h(Cards, Object.assign({ key: 'cards' }, results0))]), h(MapView, { placed: placedRows(rows, list), unplaced: rows.length - placedRows(rows, list).length, seed: seedOf(typeKey !== '' ? typeKey : (list.length > 0 ? list[0].id : 'town')), selected: selected === null ? null : selected.id, hot, onHover: setHot, onPick: pickOnMap }))
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
        __test: { pick, humanize, valueText, cardOf, flagText, viewsOf, chipsOf, sumCounts, pageTitle, newLabel, errorText, formOf, payloadOf, typeOf, statusOf, CatalogPage, FormDialog, Panel, CSS, pictureRef, fallbackArt, energyHue, statText, cardChips, pinPrice, placedRows, projectPins, sortRows, townBlocks, MapView, Picture, Cards, Table },
      }
    } catch (e) {
      console.warn('[kybernos-catalog] disabled:', e)
      return { apply () {} }
    }
  }
})
