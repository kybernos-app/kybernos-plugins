// ═══════════════════════════════════════════════════════
// kybernos-db — browser half: the « Tables » page of the « Business » group.
//
// The person's own databases, drawn from what they (or Kaby) defined: a table of records in any of four views (table, board, cards, calendar), each view a saved
// way of looking at one table (a filter, up to three sorts, the fields shown). Every view is the person's to change and a change is saved as they go; Kaby changes
// them too (« Modify view » opens a chat that asks her), and a change she made while the page is open shows as a message with an Undo.
//
// The page imports the SAME pure rules the agent runs (the host serves `core/` at /kybernos-db/core/): what a filter matches, how a sort orders and what a value may
// be is decided in one place. Search, filter and sort run here on the records read, so a keystroke never waits for the host. The host is asked for the state every
// few seconds (a fingerprint says whether anything changed) and for the records only when it did.
//
// The core hands the page `{ toolbar: { KbToolbar } }` for the header row; without it (a test, an older core) the page draws a plain search box. The view controls go in
// the toolbar's `trailing` slot, so the product's bar stays the one thing that draws search. « Modify view » uses `window.__KB_ASK__`, the core's way to open a chat with
// a first message already written; without it the sentence is offered to copy.
//
// It declares its row in the menu (`window.__KB_MENU__`) and mounts the page on the keyed slot `main.kybernos-business`. Every animation stops under
// `prefers-reduced-motion`. The factory always returns a plugin: on any error it is a disabled one.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-db',
  factory: (require) => {
    try {
      const NAME = 'kybernos-db'
      const BASE = '/kybernos-db'
      const CORE_URL = BASE + '/core/index.mjs'
      const ROW_ID = 'tables'
      const SLOT = 'main.kybernos-business'
      const SEL_KEY = 'kybernos.db.selection'
      const POLL_MS = 3000 // how often the state is asked; the page asks nothing while the tab is hidden
      const SAVE_MS = 450 // a view being edited is saved this long after the last click
      const TOAST_MS = 4200
      const TOAST_UNDO_MS = 8000
      const MENU_WAIT_MS = 250
      const MENU_TRIES = 120 // the core's registry is waited for 30 s at most
      const CAL_SHOW = 3 // events drawn in a day of the calendar before « +n »

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          // French only when the resolved language IS French (the 'kybernos' default or a fr base); every other language gets English.
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const pack = kt.pack || (kt.pack = {})
        if (pack[fr] === undefined) pack[fr] = { fr, en }
        return (lang() === 'fr' ? fr : en)
      }
      const plural = (n, fr1, frN, en1, enN) => (n === 1 ? kt(fr1, en1) : kt(frN, enN))

      // ── the core: the files the agent runs, read from the host (tests hand a module in) ──────────────────────────────────
      let K = null
      const loadCore = () => (K !== null ? Promise.resolve(K) : import(CORE_URL).then((m) => { K = m; return m }))
      const useCore = (mod) => { K = mod }

      // ── pure helpers (tested without a browser) ─────────────────────────────────────────────────────────────────────────
      const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
      const copy = (v) => JSON.parse(JSON.stringify(v))
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

      // The colours of a choice's options: a hue per colour, grey having none. The chip takes its tone from the hue, so every theme reads it.
      const COLOR_HUE = { red: 4, amber: 38, green: 142, teal: 176, blue: 214, purple: 268, pink: 332 }
      const hueOfColor = (color) => (COLOR_HUE[color] === undefined ? null : COLOR_HUE[color])
      const optionOf = (field, key) => (Array.isArray(field.options) ? field.options.find((o) => o.key === key) : undefined)

      const fmtNumber = (n) => { try { return n.toLocaleString(lang()) } catch (e) { return String(n) } }
      const fmtMoney = (field, n) => {
        try {
          const places = typeof field.precision === 'number' ? field.precision : 2
          return new Intl.NumberFormat(lang(), { style: 'currency', currency: field.currency, minimumFractionDigits: places, maximumFractionDigits: places }).format(n)
        } catch (e) { return fmtNumber(n) }
      }
      const fmtDate = (iso) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return String(iso) } }
      const fmtStamp = (iso) => { try { return new Date(iso).toLocaleString(lang(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (e) { return String(iso) } }
      const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
      const MASK = '••••••'
      const TRAIL_MAX = 12

      /** The title of a record as a list or a link shows it. */
      const titleOf = (obj, rec) => {
        const v = rec.values[obj.title]
        return typeof v === 'string' && v !== '' ? v : kt('Sans titre', 'Untitled')
      }

      /** What a record's `ctx` says to the core: today, and the titles a link shows. `related` maps an object key to its records (not read yet: shown as …). */
      const makeCtx = (today, objects, related) => {
        const resolve = (field, id) => {
          const target = objects.find((o) => o.key === field.to)
          const rows = related[field.to]
          if (!target || !Array.isArray(rows)) return { loading: true, title: '…' }
          const rec = rows.find((r) => r.id === id)
          return rec ? { title: titleOf(target, rec) } : { missing: true, title: kt('Lien supprimé', 'Removed link') }
        }
        return { today, resolve, label: (field, value) => (field.type === 'relation' ? resolve(field, value).title : value) }
      }

      // ── links between tables ──────────────────────────────────────────────────────────────────────────────────────────────
      /** Every link field of the database whose target table exists: what the « How it's built » panel lists and draws. */
      const relationFields = (objects) => {
        const out = []
        for (const o of objects) {
          for (const f of o.fields) {
            if (f.type !== 'relation') continue
            const target = objects.find((x) => x.key === f.to)
            if (!target) continue
            out.push({ from: o.key, fromLabel: o.label, field: f.key, label: f.label, to: target.key, toLabel: target.label, many: f.many === true, inverse: typeof f.inverse === 'string' && f.inverse !== '' ? f.inverse : null })
          }
        }
        return out
      }
      /** What the target table calls the link when it shows it from its side. */
      const seenAs = (rel) => (rel.inverse !== null ? rel.inverse : rel.fromLabel)
      /** Where the map of links puts each table, and how each link is drawn between two of them (a straight line, a curve when two links share the same pair, a loop on its own table). */
      const MAP_W = 640
      const NODE_W = 156
      const NODE_H = 46
      const mapLayout = (objects) => {
        const n = objects.length
        const nodes = []
        let height = 120
        if (n <= 2) {
          objects.forEach((o, i) => nodes.push({ key: o.key, label: o.label, x: n === 1 ? MAP_W / 2 : MAP_W * (i === 0 ? 0.27 : 0.73), y: 70 }))
        } else if (n <= 8) {
          height = 330
          const rx = 215
          const ry = 118
          objects.forEach((o, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; nodes.push({ key: o.key, label: o.label, x: Math.round(MAP_W / 2 + rx * Math.cos(a)), y: Math.round(height / 2 + ry * Math.sin(a)) }) })
        } else {
          const cols = Math.ceil(Math.sqrt(n * 1.6))
          const rows = Math.ceil(n / cols)
          height = rows * 110 + 20
          objects.forEach((o, i) => nodes.push({ key: o.key, label: o.label, x: Math.round(((i % cols) + 0.5) * (MAP_W / cols)), y: 55 + Math.floor(i / cols) * 110 }))
        }
        const at = (key) => nodes.find((x) => x.key === key)
        // the point where a line from the node's centre to (tx, ty) leaves its box
        const edge = (node, tx, ty) => {
          const dx = tx - node.x
          const dy = ty - node.y
          if (dx === 0 && dy === 0) return { x: node.x, y: node.y }
          const k = Math.min(dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx), dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy))
          return { x: Math.round(node.x + dx * k), y: Math.round(node.y + dy * k) }
        }
        const rels = relationFields(objects)
        const pair = (r) => (r.from < r.to ? r.from + '|' + r.to : r.to + '|' + r.from)
        const sizes = {}
        const seen = {}
        for (const r of rels) if (r.from !== r.to) sizes[pair(r)] = (sizes[pair(r)] || 0) + 1
        const edges = []
        for (const r of rels) {
          const a = at(r.from)
          const b = at(r.to)
          const label = r.label + (r.many ? ' · n' : ' · 1')
          if (r.from === r.to) {
            const top = a.y - NODE_H / 2
            seen[r.from] = (seen[r.from] || 0) + 1
            const spread = 26 + (seen[r.from] - 1) * 24
            edges.push({ rel: r, label, d: 'M ' + (a.x + 34) + ' ' + top + ' C ' + (a.x + 34 + spread) + ' ' + (top - 54 - (seen[r.from] - 1) * 12) + ' ' + (a.x - 34 - spread) + ' ' + (top - 54 - (seen[r.from] - 1) * 12) + ' ' + (a.x - 34) + ' ' + top, lx: a.x, ly: top - 50 - (seen[r.from] - 1) * 12 })
            continue
          }
          const k = pair(r)
          const idx = (seen[k] = (seen[k] || 0) + 1) - 1
          const off = (idx - (sizes[k] - 1) / 2) * 44
          // the side of the pair a link bends towards does not depend on its direction, so two opposite links never cross
          const lo = r.from < r.to ? a : b
          const hi = r.from < r.to ? b : a
          const len = Math.hypot(hi.x - lo.x, hi.y - lo.y) || 1
          const mx = (a.x + b.x) / 2 + (-(hi.y - lo.y) / len) * off * 2
          const my = (a.y + b.y) / 2 + ((hi.x - lo.x) / len) * off * 2
          const p0 = edge(a, off === 0 ? b.x : mx, off === 0 ? b.y : my)
          const p1 = edge(b, off === 0 ? a.x : mx, off === 0 ? a.y : my)
          if (off === 0) edges.push({ rel: r, label, d: 'M ' + p0.x + ' ' + p0.y + ' L ' + p1.x + ' ' + p1.y, lx: Math.round((p0.x + p1.x) / 2), ly: Math.round((p0.y + p1.y) / 2) })
          else edges.push({ rel: r, label, d: 'M ' + p0.x + ' ' + p0.y + ' Q ' + Math.round(mx) + ' ' + Math.round(my) + ' ' + p1.x + ' ' + p1.y, lx: Math.round(0.25 * p0.x + 0.5 * mx + 0.25 * p1.x), ly: Math.round(0.25 * p0.y + 0.5 * my + 0.25 * p1.y) })
        }
        return { width: MAP_W, height, nodes, edges }
      }
      const TYPE_NAME = () => ({
        text: kt('Texte', 'Text'), longtext: kt('Texte long', 'Long text'), number: kt('Nombre', 'Number'), money: kt('Montant', 'Amount'), date: kt('Date', 'Date'), checkbox: kt('Case à cocher', 'Checkbox'),
        choice: kt('Choix', 'Choice'), multichoice: kt('Choix multiples', 'Multiple choice'), person: kt('Personne', 'Person'), url: kt('Lien web', 'Web link'), email: kt('E-mail', 'Email'), phone: kt('Téléphone', 'Phone'),
        relation: kt('Lien', 'Link'), attachment: kt('Fichiers', 'Files'),
      })

      /** A value as plain text, for a cell that is not drawn rich, a tooltip, a chip. A secret field is never spelled out. */
      const cellText = (field, value, ctx) => {
        if (field.protection === 'secret') return value === null || value === undefined || value === '' ? '' : MASK
        if (value === null || value === undefined || value === '') return ''
        switch (field.type) {
          case 'number': return fmtNumber(value)
          case 'money': return fmtMoney(field, value)
          case 'date': return fmtDate(value)
          case 'checkbox': return value === true ? kt('Oui', 'Yes') : ''
          case 'choice': { const o = optionOf(field, value); return o ? o.label : String(value) }
          case 'multichoice': return value.map((k) => { const o = optionOf(field, k); return o ? o.label : k }).join(', ')
          case 'relation': return (field.many ? value : [value]).map((id) => ctx.label(field, id)).join(', ')
          case 'attachment': return value.length + ' ' + plural(value.length, 'fichier', 'fichiers', 'file', 'files')
          default: return String(value)
        }
      }

      // ── words for the filter ────────────────────────────────────────────────────────────────────────────────────────────
      const WITHIN_TEXT = () => ({
        next7: kt('les 7 prochains jours', 'the next 7 days'),
        next30: kt('les 30 prochains jours', 'the next 30 days'),
        past7: kt('les 7 derniers jours', 'the last 7 days'),
        past30: kt('les 30 derniers jours', 'the last 30 days'),
      })
      const opLabel = (field, op) => {
        const family = K.familyOf(field)
        switch (op) {
          case 'contains': return kt('contient', 'contains')
          case 'ncontains': return kt('ne contient pas', 'does not contain')
          case 'is': return kt('est', 'is')
          case 'isnot': return kt('n’est pas', 'is not')
          case 'empty': return family === 'files' ? kt('sans fichier', 'has no file') : kt('est vide', 'is empty')
          case 'nempty': return family === 'files' ? kt('avec fichier', 'has a file') : kt('n’est pas vide', 'is not empty')
          case 'eq': return '='
          case 'ne': return '≠'
          case 'lt': return '<'
          case 'gt': return '>'
          case 'le': return '≤'
          case 'ge': return '≥'
          case 'before': return kt('est avant', 'is before')
          case 'after': return kt('est après', 'is after')
          case 'within': return kt('est dans', 'is within')
          case 'checked': return kt('est coché', 'is checked')
          case 'unchecked': return kt('n’est pas coché', 'is not checked')
          case 'in': return family === 'many' ? kt('contient l’un de', 'has any of') : kt('est l’un de', 'is any of')
          case 'nin': return family === 'many' ? kt('ne contient aucun de', 'has none of') : kt('n’est aucun de', 'is none of')
          case 'all': return kt('contient tous', 'has all of')
          default: return String(op)
        }
      }
      /** The words for a date relative to today: today, tomorrow, yesterday, in 7 days, 3 days ago. */
      const relDay = (n) => (n === 0 ? kt('aujourd’hui', 'today') : n === 1 ? kt('demain', 'tomorrow') : n === -1 ? kt('hier', 'yesterday')
        : n > 0 ? kt('dans ' + n + ' jours', 'in ' + n + ' days') : kt('il y a ' + (-n) + ' jours', -n + ' days ago'))
      const DATE_PRESETS = [0, 1, -1, 7, -7, 30, -30]

      /** The field the key names, or a stand-in so a damaged condition still draws. */
      const fieldOf = (obj, key) => obj.fields.find((f) => f.key === key) || { key, label: key, type: 'text', protection: 'normal' }

      const valueText = (obj, c, ctx) => {
        if (K.NO_VALUE_OPS.includes(c.op)) return ''
        const f = fieldOf(obj, c.k)
        const v = c.v
        if (f.type === 'date') {
          if (c.op === 'within') return WITHIN_TEXT()[v] || String(v)
          if (plain(v) && typeof v.d === 'string') return fmtDate(v.d)
          if (plain(v) && typeof v.n === 'number') return relDay(v.n)
          return ''
        }
        if (f.type === 'number' || f.type === 'money') return typeof v === 'number' ? fmtNumber(v) : ''
        if (Array.isArray(v)) return v.map((x) => cellText(Object.assign({}, f, { type: f.type === 'multichoice' ? 'choice' : f.type, many: false }), x, ctx)).join(', ')
        if (f.type === 'choice' || f.type === 'relation') return cellText(Object.assign({}, f, { many: false }), v, ctx)
        if (f.type === 'person' && v === K.ME) return kt('moi', 'me')
        return String(v === null || v === undefined ? '' : v)
      }
      /** « Status is Paid », « Due is within the next 7 days »: one condition as a sentence. */
      const conditionText = (obj, c, ctx) => {
        const f = fieldOf(obj, c.k)
        const v = valueText(obj, c, ctx)
        return f.label + ' ' + opLabel(f, c.op) + (v === '' ? '' : ' ' + v)
      }
      const conjText = (conj) => (conj === 'or' ? kt('ou', 'or') : kt('et', 'and'))
      const itemText = (obj, item, ctx) => (K.isGroup(item) ? '(' + K.flatConditions(item).map((c) => conditionText(obj, c, ctx)).join(' ' + conjText(item.conj) + ' ') + ')' : conditionText(obj, item, ctx))

      /** How a value is typed for a condition: nothing, a text, a number, a date (a day relative to today or an exact one), a window, one key, or a list of keys. */
      const valueKind = (field, op) => {
        if (K.NO_VALUE_OPS.includes(op)) return 'none'
        const family = K.familyOf(field)
        if (family === 'text') return 'text'
        if (family === 'number') return 'number'
        if (family === 'date') return op === 'within' ? 'within' : 'day'
        if (family === 'one') return op === 'in' || op === 'nin' ? 'list' : 'one'
        if (family === 'many') return 'list'
        return 'none'
      }
      const defaultOp = (field) => {
        const family = K.familyOf(field)
        return family === 'text' ? 'contains' : family === 'number' ? 'eq' : family === 'date' ? 'is' : family === 'checkbox' ? 'checked' : family === 'many' ? 'in' : family === 'files' ? 'nempty' : 'is'
      }
      const defaultValueFor = (field, op) => {
        switch (valueKind(field, op)) {
          case 'text': return ''
          case 'number': return null
          case 'day': return { n: 0 }
          case 'within': return 'next7'
          case 'list': return []
          case 'one': return ''
          default: return undefined
        }
      }
      /** A fresh condition on a field (incomplete until the person gives it a value; the saved view never holds an incomplete one). */
      const newCondition = (field) => { const op = defaultOp(field); const v = defaultValueFor(field, op); return v === undefined ? { k: field.key, op } : { k: field.key, op, v } }
      /** The condition with another operator: the value stays when the new operator takes the same kind of value, else it starts again. */
      const withOp = (field, c, op) => {
        const v = valueKind(field, c.op) === valueKind(field, op) && c.v !== undefined ? c.v : defaultValueFor(field, op)
        return v === undefined ? { k: c.k, op } : { k: c.k, op, v }
      }
      /** Fields a condition can be about: those with operators. */
      const filterable = (obj) => obj.fields.filter((f) => K.opsFor(f).length > 0)

      // The filter is a tree two levels deep; a position is « 2 » (the third item) or « 1.0 » (the first condition of the second item), as the core's checks say.
      const pathIdx = (p) => (p === '' ? [] : String(p).split('.').map(Number))
      const nodeAt = (flt, p) => pathIdx(p).reduce((n, i) => n.items[i], flt)
      const mapAt = (flt, p, fn) => {
        const go = (node, idxs) => (idxs.length === 0 ? fn(node) : Object.assign({}, node, { items: node.items.map((it, i) => (i === idxs[0] ? go(it, idxs.slice(1)) : it)) }))
        return go(flt, pathIdx(p))
      }
      const removeAt = (flt, p) => {
        const idxs = pathIdx(p)
        const last = idxs[idxs.length - 1]
        return mapAt(flt, idxs.slice(0, -1).join('.'), (g) => Object.assign({}, g, { items: g.items.filter((_, j) => j !== last) }))
      }
      const addItem = (flt, p, item) => mapAt(flt, p, (g) => Object.assign({}, g, { items: g.items.concat([item]) }))
      const countConditions = (flt) => K.flatConditions(flt).filter((c) => !K.isGroup(c) && c.k !== undefined).length
      /** The conditions the filter really applies (complete ones), for the count on the button and the chips. */
      const liveFilter = (flt, fields) => K.prepareFilter(flt, fields)

      // ── words for the sort ──────────────────────────────────────────────────────────────────────────────────────────────
      const dirLabels = (field) => {
        switch (K.familyOf(field)) {
          case 'text': return ['A → Z', 'Z → A']
          case 'number': return [kt('Du plus petit au plus grand', 'Low to high'), kt('Du plus grand au plus petit', 'High to low')]
          case 'date': return [kt('Le plus ancien d’abord', 'Oldest first'), kt('Le plus récent d’abord', 'Newest first')]
          case 'checkbox': return [kt('Non coché d’abord', 'Unchecked first'), kt('Coché d’abord', 'Checked first')]
          default: return field.type === 'choice' ? [kt('Dans l’ordre des choix', 'In the order of the choices'), kt('Dans l’ordre inverse', 'In reverse order')] : [kt('Croissant', 'Ascending'), kt('Décroissant', 'Descending')]
        }
      }
      const sortableFields = (obj) => obj.fields.filter(K.isSortable)
      /** The sorts after a click on a column heading: one sort that goes ascending, descending, off; with shift, a further sort is added. */
      const nextSorts = (sorts, key, shift) => {
        const i = sorts.findIndex((s) => s.k === key)
        if (shift) {
          if (i < 0) return sorts.length < K.SORT_MAX ? sorts.concat([{ k: key, dir: 'asc' }]) : sorts
          return sorts[i].dir === 'asc' ? sorts.map((s, j) => (j === i ? { k: key, dir: 'desc' } : s)) : sorts.filter((_, j) => j !== i)
        }
        if (sorts.length === 1 && i === 0) return sorts[0].dir === 'asc' ? [{ k: key, dir: 'desc' }] : []
        return [{ k: key, dir: 'asc' }]
      }

      // ── views ───────────────────────────────────────────────────────────────────────────────────────────────────────────
      const KIND_WORD = () => ({ table: kt('Tableau', 'Table'), board: kt('Tableau kanban', 'Board'), cards: kt('Cartes', 'Cards'), calendar: kt('Calendrier', 'Calendar'), map: kt('Carte', 'Map') })
      const KIND_ICON = { table: 'table', board: 'board', cards: 'cards', calendar: 'calendar', map: 'map' }
      const defaultViewId = (obj) => 'default-' + obj.key
      /** The view an object shows until it has a saved one: a plain table. */
      const defaultView = (obj) => ({ id: defaultViewId(obj), name: kt('Tableau', 'Table'), kind: 'table', owner: 'me', fav: true, state: { flt: K.blankFilter(), sorts: [], hidden: [] } })
      /** The view as the host stores it: the filter and the sorts cut to what can apply, so a half-edited condition is never saved. */
      const savable = (view, obj) => {
        const out = copy(view)
        const state = plain(out.state) ? out.state : {}
        out.state = Object.assign({}, state, { flt: K.prepareFilter(state.flt || K.blankFilter(), obj.fields), sorts: K.prepareSorts(state.sorts || [], obj.fields), hidden: Array.isArray(state.hidden) ? state.hidden : [] })
        return out
      }
      /** The views in the order the bar shows them: the favourites, and the current one when it is not a favourite. */
      const barViews = (views, currentId) => views.filter((v) => v.fav || v.id === currentId)

      /** `{ [view id]: { object, view, rev, by } }` for every view of a database's objects. */
      const viewIndex = (objects) => {
        const out = {}
        for (const o of objects) for (const v of o.views || []) out[v.id] = { object: o.key, view: v, rev: ((o.stamps || {})[v.id] || {}).rev, by: ((o.stamps || {})[v.id] || {}).by }
        return out
      }
      /** What Kaby did to the views between two reads of the state: a view she changed (with how it was), or made. Not what the person did, nor what waits to be saved. */
      const agentViewEvents = (before, after, pending) => {
        const out = []
        for (const id of Object.keys(after)) {
          if (pending.has(id) || after[id].by !== 'agent') continue
          const was = before[id]
          if (was === undefined) out.push({ kind: 'made', id, object: after[id].object, view: after[id].view })
          else if (was.rev !== after[id].rev) out.push({ kind: 'changed', id, object: after[id].object, view: after[id].view, before: was.view })
        }
        return out
      }

      // ── board and calendar ──────────────────────────────────────────────────────────────────────────────────────────────
      /** The columns of a board: one per option of the choice field, and one for the records with none. */
      const boardColumns = (field, rows) => {
        const cols = (field.options || []).map((o) => ({ key: o.key, label: o.label, color: o.color, rows: rows.filter((r) => r.values[field.key] === o.key) }))
        const none = rows.filter((r) => !optionOf(field, r.values[field.key]))
        if (none.length > 0) cols.push({ key: '', label: kt('Sans ' + field.label.toLowerCase(), 'No ' + field.label.toLowerCase()), color: undefined, rows: none })
        return cols
      }
      /** The first picture a record holds, looking at its attachment fields in order (a hidden or secret one is skipped): `{ field, file }`, or null. */
      const pictureOf = (obj, rec, hidden) => {
        for (const f of obj.fields) {
          if (f.type !== 'attachment' || f.protection === 'secret' || hidden.includes(f.key)) continue
          const list = rec.values[f.key]
          const file = Array.isArray(list) ? list.find(isImage) : undefined
          if (file !== undefined) return { field: f, file }
        }
        return null
      }
      /** The money field a board adds up in each column: the first one that is shown and not protected (a protected value reaches the page masked). */
      const totalField = (obj, hidden) => obj.fields.find((f) => f.type === 'money' && f.protection === 'normal' && !hidden.includes(f.key))
      /** The sum of a money field over the rows of a column; null when none of them has an amount (a column of unpriced rows says nothing instead of 0). */
      const columnTotal = (field, rows) => {
        const amounts = rows.map((r) => r.values[field.key]).filter((v) => typeof v === 'number')
        return amounts.length === 0 ? null : amounts.reduce((a, b) => a + b, 0)
      }
      // ── the map view: the records that have a place, and the real map ────────────────────────────────────────────────────────────
      /** The shortest pin text of an amount: « €385k », « €1.45M », « €780 » (the symbol of the currency, in a narrow form, first). */
      const compactMoney = (field, n) => {
        let sym = ''
        try { sym = new Intl.NumberFormat('en', { style: 'currency', currency: field.currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((x) => x.type === 'currency').value } catch (e) { sym = '' }
        if (Math.abs(n) >= 1000000) return sym + String(Math.round(n / 10000) / 100).replace(/\.?0+$/, '') + 'M'
        if (Math.abs(n) >= 10000) return sym + Math.round(n / 1000) + 'k'
        return sym + fmtNumber(n)
      }
      /** The amount a pin stands for, in full for a screen reader (« €385,000 »); empty when the record has none to say. */
      const pinAmount = (obj, rec, hidden) => {
        const f = totalField(obj, hidden)
        const v = f === undefined ? undefined : rec.values[f.key]
        return typeof v === 'number' ? fmtMoney(f, v) : ''
      }
      /** What a pin says for a record: its first shown money field when it has an amount, else its title cut short. */
      const pinLabel = (obj, rec, hidden) => {
        const f = totalField(obj, hidden)
        const v = f === undefined ? undefined : rec.values[f.key]
        if (typeof v === 'number') return compactMoney(f, v)
        const t = titleOf(obj, rec)
        const chars = Array.from(t)
        return chars.length > 14 ? chars.slice(0, 13).join('') + '…' : t
      }
      /** The records that have a place (the view's latitude and longitude fields, both numbers in range), as { row: { id, title, label, amount }, lat, lng }, in the order of the rows. */
      const placedRecords = (obj, view, rows) => {
        const out = []
        for (const rec of rows) {
          const lat = rec.values[view.lat]
          const lng = rec.values[view.lng]
          if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push({ row: { id: rec.id, title: titleOf(obj, rec), label: pinLabel(obj, rec, view.state.hidden), amount: pinAmount(obj, rec, view.state.hidden) }, lat, lng })
        }
        return out
      }
      const GEO_W = 1000
      const GEO_H = 720
      /** The screen place of every pin on the 1000 x 720 map: the box around them (a little padded) fills it, north up, east right. */
      const projectPins = (placed, width, height) => {
        const W = width === undefined ? GEO_W : width
        const H = height === undefined ? GEO_H : height
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
      const MAP_LIB = { js: BASE + '/vendor/maplibre-gl.js?v=' + MAP_LIB_VERSION, css: BASE + '/vendor/maplibre-gl.css?v=' + MAP_LIB_VERSION }
      const MAP_STYLE_HOST = 'https://tiles.openfreemap.org/styles/' // every theme of the map comes from this one host, the one the manifest names (net:tiles.openfreemap.org)
      const MAP_STYLE_URL = MAP_STYLE_HOST + 'positron'
      const MAP_STYLE_KEY = 'kybernos.db.mapstyle.v1'
      /**
       * The map themes on offer, in the order of the menu. `style` is the OpenFreeMap style the theme starts from (the three exist: the live check asks each one); `scheme` is
       * how it is coloured: 'page' follows the page's light or dark, 'light' and 'dark' are the quiet map in that mode whatever the page is, null keeps the style's own colours
       * (more detail and colour: Streets and Bright, whose colours are only calmed by `calm`, a share of their saturation taken away so that the pins stay the loudest thing).
       */
      const MAP_STYLES = [
        { id: 'auto', style: 'positron', scheme: 'page', label: ['Auto', 'Auto'] },
        { id: 'light', style: 'positron', scheme: 'light', label: ['Clair', 'Light'] },
        { id: 'dark', style: 'positron', scheme: 'dark', label: ['Sombre', 'Dark'] },
        { id: 'streets', style: 'liberty', scheme: null, calm: 0.4, label: ['Rues', 'Streets'] },
        { id: 'bright', style: 'bright', scheme: null, calm: 0.5, label: ['Vif', 'Bright'] },
      ]
      /** The theme of an id; Auto for anything else (an old or hand-edited value never breaks the map). */
      const mapStyleOf = (id) => MAP_STYLES.find((m) => m.id === id) || MAP_STYLES[0]
      const mapStyleUrl = (id) => MAP_STYLE_HOST + mapStyleOf(id).style
      /** The theme this browser remembers: Auto when nothing is stored, the value is not one of ours, or the storage cannot be read. */
      const readMapStyle = () => { try { return mapStyleOf(window.localStorage.getItem(MAP_STYLE_KEY)).id } catch (e) { return 'auto' } }
      const saveMapStyle = (id) => { try { window.localStorage.setItem(MAP_STYLE_KEY, mapStyleOf(id).id) } catch (e) { /* no storage: the choice lasts for this page */ } }
      const MAP_BUDGET_MS = 8000 // library + style + first tiles must be on screen by then, else the drawn map takes over
      const MAP_RETRY_MS = 60000 // after a failure the drawn map shows at once for this long (the button asks again)
      const MAP_MAX_ZOOM = 18
      // The room kept round the places when the whole set is brought into view, so that no pill is cut by the edge or lies under what the map carries: the three buttons on
      // the right (10 px from the edge, 34 wide, and a pill is up to 80 px wide, centred on its place), the caption (top left on a phone), the credit at the bottom.
      const MAP_FIT = { padding: { top: 80, bottom: 64, left: 56, right: 92 }, maxZoom: 15.5 }
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
       * The pins as the screen shows them at a zoom: places whose pins would overlap (closer than `box` in pixels) make one cluster, with its count and the middle
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
          out.push({ key: items.length === 1 ? 'p' + ids[0] : 'c' + ids.slice().sort().join('-'), lat: items.reduce((n, q) => n + q.lat, 0) / items.length, lng: items.reduce((n, q) => n + q.lng, 0) / items.length, items, count: items.length })
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
      let mapLibPromise = null // the library's one load (a failed one is forgotten, so the next view asks again)
      let mapStyleCache = {} // the style of each theme, asked once per page load
      let webglKnown = null
      let tokenCx = null

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
      /** A colour with `k` of its saturation taken away and a little of the lightness given back: the detailed styles keep their hues but stop shouting over the pins. */
      const calmColor = (c, k) => { const [h, s, l] = rgbToHsl(c); return hslToRgb(h, s * (1 - k), l + (1 - l) * k * 0.3).concat(c.length > 3 ? [c[3]] : []) }
      /** The paint properties whose colour is a surface (not a text): the ones `calm` works on. */
      const CALM_PAINT = /^(fill|line|background)(-outline)?-color$/
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
      /** How far along the way from the surface to the ink a text colour sits (0: the surface, 1: the ink), by luminance. */
      const alongInk = (tok, c) => { const d = lumaOf(tok.t1) - lumaOf(tok.l1); return Math.abs(d) < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (lumaOf(c) - lumaOf(tok.l1)) / d)) }
      /** The page's tokens as the OTHER mode would have them: surface and ink swapped, the two softer inks as far along the way as they were (a light map in a dark page, and the reverse). */
      const flipTokens = (tok) => Object.assign({}, tok, { l1: tok.t1, t1: tok.l1, t2: mixColor(tok.t1, tok.l1, alongInk(tok, tok.t2)), t3: mixColor(tok.t1, tok.l1, alongInk(tok, tok.t3)) })
      /**
       * The palette of a theme for this page: `null` for a theme that keeps its style's own colours (Streets, Bright); for the others the page's own recipe, or the same recipe on the
       * flipped tokens when the theme is the other mode than the page (Light in a dark page, Dark in a light one).
       */
      const mapPalette = (tok, id) => {
        const scheme = mapStyleOf(id).scheme
        if (scheme === null) return null
        const own = paletteFrom(tok)
        if (scheme === 'page' || (scheme === 'dark') === own.dark) return own
        return paletteFrom(flipTokens(tok))
      }
      /** What the style loses, whatever the page: shields, airports, the dashed lines of districts, tunnels, piers, ice, bridges of motorways, state names; and of the detailed styles (Streets, Bright) the places of interest, the arrows of one-way streets, the 3D buildings, ferries and cable cars. */
      const STYLE_HIDE = /^(highway-shield|road_shield|airport|aeroway|boundary_3|boundary_disputed|railway_(transit|service)|label_state|tunnel[_-]|road_(area_)?pier|landcover[_-](ice|glacier)|highway_motorway_bridge|poi_|road_one_?way|building-3d|ferry|cablecar)/
      /** A layer that paints with a picture of the sprite: with no sprite (it is never asked for) it could only be an error on the console. */
      const needsSprite = (layer) => layer.paint !== undefined && (layer.paint['fill-pattern'] !== undefined || layer.paint['line-pattern'] !== undefined || layer.paint['background-pattern'] !== undefined)
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
       * A basemap style (OpenFreeMap's « positron », « liberty » or « bright », as fetched) made quiet and ours: the layers a map of pins does not need are dropped, street and district
       * names are fewer, the colours come from the palette (a layer no role knows keeps its colour in a light page and has its lightness turned over in a dark one; with no palette
       * the style keeps its own, calmed by `options.calm`), the dot icons and the sprite are gone (so the sprite is never asked for), and names follow the person's language.
       * Pure: the style it was given is not touched.
       */
      const tweakStyle = (style, palette, options) => {
        const opts = options === undefined ? {} : options
        const out = JSON.parse(JSON.stringify(style))
        out.layers = out.layers.filter((layer) => !STYLE_HIDE.test(layer.id) && !needsSprite(layer))
        delete out.sprite
        for (const layer of out.layers) {
          if (STYLE_MINZOOM[layer.id] !== undefined) layer.minzoom = STYLE_MINZOOM[layer.id]
          if (layer.type === 'symbol' && layer.layout !== undefined) {
            for (const k of Object.keys(layer.layout)) if (k.indexOf('icon-') === 0) delete layer.layout[k]
            if (opts.lang === 'fr' && layer.layout['text-field'] !== undefined) layer.layout['text-field'] = renamed(layer.layout['text-field'], 'fr')
          }
          if (layer.paint === undefined) continue
          if (palette === null || palette === undefined) {
            if (typeof opts.calm === 'number' && opts.calm > 0) for (const k of Object.keys(layer.paint)) if (CALM_PAINT.test(k)) layer.paint[k] = recolor(layer.paint[k], (c) => colorHex(calmColor(c, opts.calm)))
            continue
          }
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
      const monthOf = (iso) => String(iso).slice(0, 7)
      const shiftMonth = (ym, d) => {
        const parts = ym.split('-').map(Number)
        const t = parts[0] * 12 + (parts[1] - 1) + d
        return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0')
      }
      /** The 42 days (six weeks, Monday first) that show a month, as { iso, out } where out says the day belongs to a neighbouring month. */
      const monthGrid = (ym) => {
        const parts = ym.split('-').map(Number)
        const first = new Date(Date.UTC(parts[0], parts[1] - 1, 1, 12))
        const start = new Date(first)
        start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
        const days = []
        for (let i = 0; i < 42; i++) {
          const d = new Date(start)
          d.setUTCDate(start.getUTCDate() + i)
          const iso = d.toISOString().slice(0, 10)
          days.push({ iso, day: d.getUTCDate(), out: monthOf(iso) !== ym })
        }
        return days
      }
      const monthLabel = (ym) => { try { const p = ym.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, 1, 12)).toLocaleDateString(lang(), { month: 'long', year: 'numeric', timeZone: 'UTC' }) } catch (e) { return ym } }
      const weekdayLabels = () => { const out = []; for (let i = 0; i < 7; i++) { try { out.push(new Date(Date.UTC(2024, 0, 1 + i, 12)).toLocaleDateString(lang(), { weekday: 'short', timeZone: 'UTC' })) } catch (e) { out.push(String(i)) } } return out }

      // ── the sentences a chat starts with ─────────────────────────────────────────────────────────────────────────────────
      /** The start of the chat that asks Kaby about what is on screen: the app, the table and the view, so she needs no guess; the person finishes the sentence. */
      const askAbout = (db, obj, view) => {
        const where = obj === null || obj === undefined
          ? kt('dans mon app « ' + db.name + ' » (base ' + db.id + ')', 'in my app “' + db.name + '” (database ' + db.id + ')')
          : kt('dans mon app « ' + db.name + ' » (base ' + db.id + '), table « ' + obj.label + ' » (clé ' + obj.key + ')' + (view ? ', vue « ' + view.name + ' » (id ' + view.id + ')' : ''),
            'in my app “' + db.name + '” (database ' + db.id + '), table “' + obj.label + '” (key ' + obj.key + ')' + (view ? ', view “' + view.name + '” (id ' + view.id + ')' : ''))
        return kt('Sur la page Apps, ' + where + ' : ', 'On the Apps page, ' + where + ': ')
      }
      /** What Kaby is asked to build when the person describes an app. */
      const buildText = (text) => (text.trim() === ''
        ? kt('Sur la page Apps, je voudrais suivre : ', 'On the Apps page, I would like to keep track of: ')
        : kt('Sur la page Apps : ' + text.trim() + '\nUtilise le skill db-builder pour concevoir les tables, puis montre-moi ce qui a été créé.', 'On the Apps page: ' + text.trim() + '\nUse the db-builder skill to design the tables, then show me what was created.'))
      const EXAMPLES = () => [kt('Mes tâches, avec un statut et une échéance', 'My tasks, with a status and a due date'), kt('Mes clients et leurs commandes', 'My customers and their orders'), kt('Ma collection de livres', 'My book collection')]
      /** Three shapes with no trade attached: each is a sentence Kaby builds from, not a template. */
      const STARTS = () => [
        { id: 'contacts', name: kt('Contacts', 'Contacts'), line: kt('Les personnes et les entreprises que tu côtoies, et des notes sur chacune.', 'The people and companies you deal with, and notes about each.'), text: kt('une app de contacts : personnes et entreprises avec e-mail, téléphone et ville, plus des notes liées à chaque contact', 'a contacts app: people and companies with email, phone and city, plus notes linked to each contact') },
        { id: 'tasks', name: kt('Tâches', 'Tasks'), line: kt('Ce qu’il y a à faire, par qui et pour quand.', 'What to do, who does it and when.'), text: kt('une liste de tâches avec un statut, une échéance et une priorité', 'a task list with a status, a due date and a priority') },
        { id: 'collection', name: kt('Collection', 'Collection'), line: kt('Un catalogue de ce que tu possèdes ou vends, avec photos.', 'A catalogue of what you own or sell, with photos.'), text: kt('un catalogue d’objets avec un nom, une catégorie, une photo, une quantité et un prix', 'a catalogue of items with a name, a category, a photo, a quantity and a price') },
      ]
      const HUES = Object.keys(COLOR_HUE).map((k) => COLOR_HUE[k])
      /** A hue and a letter stand for an app that has no picture of its own: the same app always gets the same ones. */
      const appHue = (id) => { let n = 0; for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) % 997; return HUES[n % HUES.length] }
      const monogram = (name) => { const c = Array.from(String(name).trim())[0]; return c === undefined ? '?' : c.toUpperCase() }
      /** Whether what was typed is the name to confirm a deletion: exactly, since a near miss must not delete. */
      const confirmOk = (typed, expected) => typeof expected === 'string' && expected !== '' && typed === expected
      /** Rows an app holds: the tables on screen, deleted rows not counted. */
      const rowsIn = (app) => app.objects.reduce((n, o) => n + (Number.isInteger(o.count) ? o.count : 0), 0)

      // ── the host ────────────────────────────────────────────────────────────────────────────────────────────────────────
      /** `{ ok, … }` always: a network failure, an unreadable answer or a refusal is an answer too. The session cookie travels with the request; a body goes as JSON. */
      const call = async (method, path, body) => {
        try {
          const res = await fetch(BASE + path, { method, cache: 'no-store', credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
          let data = null
          try { data = await res.json() } catch (e) { data = null }
          if (data !== null && typeof data === 'object' && typeof data.ok === 'boolean') return data
          return { ok: false, error: res.status === 401 ? 'sign-in required' : (res.status === 403 ? 'origin refused' : 'network') }
        } catch (e) { return { ok: false, error: 'network' } }
      }
      const qs = (params) => '?' + Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== false).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] === true ? '1' : params[k])).join('&')
      /** One sentence for each answer the host can give. */
      const errorText = (r) => {
        const code = r && r.error
        const known = {
          network: kt('Le serveur local ne répond pas. Réessaie dans un instant.', 'The local server does not answer. Try again in a moment.'),
          'sign-in required': kt('Ta session a expiré : recharge la page pour te reconnecter.', 'Your session has expired: reload the page to sign in again.'),
          'origin refused': kt('Cette page n’est pas ouverte depuis l’adresse de ton ordinateur.', 'This page is not open from your computer’s own address.'),
          sqlite_unavailable: kt('Cette version de Node ne sait pas ouvrir les bases. Il faut Node 22.5 ou plus récent.', 'This version of Node cannot open databases. Node 22.5 or newer is needed.'),
          db_newer: kt('Cette base vient d’une version plus récente de Kybernos.', 'This database comes from a newer version of Kybernos.'),
          not_a_db: kt('Ce fichier n’est pas une base Kybernos.', 'This file is not a Kybernos database.'),
          unknown_object: kt('Cette table n’existe plus.', 'This table no longer exists.'),
          missing: kt('Cet enregistrement n’existe plus.', 'This record no longer exists.'),
          deleted: kt('Cet enregistrement a été supprimé.', 'This record was deleted.'),
          unknown_db: kt('Cette app n’existe plus.', 'This app no longer exists.'),
          archived: kt('Cette app ou cette table est rangée : rétablis-la d’abord.', 'This app or table is put away: restore it first.'),
          'not-archived': kt('Range-la d’abord : on ne supprime que ce qui est rangé.', 'Put it away first: only what is archived can be deleted.'),
          published: kt('Cette app est publiée : arrête sa publication d’abord.', 'This app is published: unpublish it first.'),
          confirm: kt('Le nom saisi n’est pas le bon.', 'The name typed is not the right one.'),
          // Publish: the web app and the hosting behind it (a refusal always says what was left as it was)
          unreachable: kt('L’app web ne répond pas. Rien n’a été perdu : réessaie dans un instant.', 'The web app is not answering. Nothing was lost: try again in a moment.'),
          refused: kt('L’app web a refusé la clé de cet ordinateur.', 'The web app refused this computer’s key.'),
          space: kt('L’app web a un problème de son côté. Réessaie plus tard.', 'The web app has a problem on its side. Try again later.'),
          'rate-limited': kt('L’app web demande d’aller moins vite : réessaie dans une minute.', 'The web app asks to slow down: try again in a minute.'),
          'hosting-failed': kt('L’hébergement n’a pas pu préparer l’app web. Rien n’a été publié.', 'The hosting could not set up the web app. Nothing was published.'),
          mismatch: kt('Ce que contient l’app web n’est pas ce qui était attendu. Rien n’a été modifié ici.', 'What the web app holds is not what was expected. Nothing was changed here.'),
          changed: kt('L’app a changé pendant la publication. Rien n’a été publié : réessaie.', 'The app changed while it was being published. Nothing was published: try again.'),
          'db-exists': kt('Une copie de cette app est déjà dans l’app web.', 'A copy of this app is already in the web app.'),
          sensitive: kt('Cette app a des champs sensibles ou secrets : elle ne peut pas être publiée.', 'This app has sensitive or secret fields, so it cannot be published.'),
          budget: kt('Le budget prévu pour l’app web est épuisé.', 'The budget for the web app is used up.'),
          busy: kt('Une publication ou un retrait est déjà en cours pour cette app : attends qu’il se termine.', 'This app is being published or unpublished: wait for that to end.'),
          'not-published': kt('Cette app n’est pas publiée.', 'This app is not published.'),
          registry: kt('La liste des apps publiées n’a pas pu être enregistrée sur cet ordinateur. Réessaie.', 'The list of published apps could not be saved on this computer. Try again.'),
          'too-large': kt('Cette app est trop grosse pour l’app web.', 'This app is too large for the web app.'),
          unavailable: kt('La publication n’est pas disponible sur cet ordinateur.', 'Publishing is not available on this computer.'),
          failed: kt('Ça n’a pas marché. Réessaie.', 'That did not work. Try again.'),
          popup: kt('Le navigateur a bloqué le nouvel onglet : autorise les fenêtres pour cette page, puis réessaie.', 'The browser blocked the new tab: allow pop-ups for this page, then try again.'),
        }
        if (known[code] !== undefined) return known[code]
        return typeof (r && r.message) === 'string' && r.message !== '' ? r.message : kt('Cette valeur n’est pas acceptée.', 'This value is not accepted.')
      }

      // ── Publish: an app that lives in a web app. The host decides what is possible; the page only draws what the state says ──────
      /** The `published` object the state gives an app (`{ slug, url, since, lastSync, syncError }`), or null. */
      const pubOf = (app) => (plain(app) && plain(app.published) && typeof app.published.url === 'string' ? app.published : null)
      /** True when the host offers Publish at all: without it the page shows no Publish control. */
      const canPublishVia = (hosting) => plain(hosting) && hosting.available === true
      const hostWord = (url) => { try { return new URL(url).host } catch (e) { return '' } }
      /** « just now », « 3 min ago »… for a moment in the past; an empty string when the moment is not a date. */
      const agoWord = (iso, now) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return ''
        const s = Math.max(0, Math.round(((typeof now === 'number' ? now : Date.now()) - t) / 1000))
        if (s < 60) return kt('à l’instant', 'just now')
        const m = Math.floor(s / 60)
        if (m < 60) return kt('il y a ' + m + ' min', m + ' min ago')
        const hr = Math.floor(m / 60)
        if (hr < 24) return kt('il y a ' + hr + ' h', hr + ' h ago')
        const d = Math.floor(hr / 24)
        return kt('il y a ' + d + ' j', d + ' d ago')
      }
      /** What the page says of the copy kept on this computer: when it was last brought up to date, or why it could not be. */
      const syncLine = (pub, now) => {
        const ago = typeof pub.lastSync === 'string' ? agoWord(pub.lastSync, now) : ''
        if (plain(pub.syncError)) {
          const code = pub.syncError.code
          const why = code === 'refused' ? kt('L’app web a refusé la clé de cet ordinateur.', 'The web app refused this computer’s key.')
            : code === 'unreachable' || code === 'space' || code === 'rate-limited' ? kt('L’app web ne répond pas.', 'The web app is not answering.')
              : kt('La copie venue de l’app web n’a pas pu être vérifiée.', 'The copy from the web app could not be checked.')
          return why + ' ' + (ago !== '' ? kt('Dernière mise à jour ' + ago + '.', 'Last synced ' + ago + '.') : kt('Tu vois la copie gardée sur cet ordinateur.', 'You are seeing the copy kept on this computer.'))
        }
        return ago !== '' ? kt('Synchronisée ' + ago, 'Synced ' + ago) : kt('Copie gardée sur cet ordinateur', 'Copy kept on this computer')
      }
      const priceWord = (n, cur) => { try { return new Intl.NumberFormat(lang(), { style: 'currency', currency: cur }).format(n) } catch (e) { return String(n) + ' ' + cur } }
      /**
       * Opens the web app of a published app in a new tab. The tab is opened FIRST, inside the click that asked for it, so a pop-up blocker lets it through, and is pointed at the
       * host's one-time link once that is made. The link is a secret for ten minutes: it is never kept, shown or logged here. `ports` ({ open, call }) is for the tests.
       */
      const openWebApp = async (dbId, ports) => {
        const open = (ports && ports.open) || ((...a) => window.open(...a))
        const ask = (ports && ports.call) || call
        let win = null
        try { win = open('', '_blank') } catch (e) { win = null }
        if (win === null || win === undefined) return { ok: false, error: 'popup' }
        try { win.opener = null } catch (e) { /* the tab is ours alone until it is pointed away */ }
        const shut = () => { try { win.close() } catch (e) { /* already closed */ } }
        const r = await ask('POST', '/open-web', { db: dbId })
        if (!r || r.ok !== true) { shut(); return r || { ok: false, error: 'failed' } }
        let target = null
        try { const u = new URL(r.url); if (u.protocol === 'https:' || u.protocol === 'http:') target = u.href } catch (e) { target = null }
        if (target === null) { shut(); return { ok: false, error: 'failed' } }
        try { win.location.href = target } catch (e) { shut(); return { ok: false, error: 'failed' } }
        return { ok: true }
      }

      // ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
      const SHOWN_IN_PLACE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] // what the page draws as a picture; the host decides from the bytes and hands over anything else (a PDF, an SVG) as a download
      const isImage = (f) => SHOWN_IN_PLACE.indexOf(String(f.type).toLowerCase()) >= 0
      /** Where a file a row holds is read from (the host serves it only to a row that holds it). */
      const fileUrl = (dbId, objKey, id, field, f) => BASE + '/file' + qs({ db: dbId, object: objKey, id, field: field.key, hash: f.hash })


      // ── styles: DSH's tokens only; a choice's colour is a hue the chip's tone is made from (hsl of a hue) ──────────────────
      const CSS = `
        .kbtb{display:block;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;min-width:0}
        .kbtb *{box-sizing:border-box}
        .kbtb button{font:inherit}
        .kbtb :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbtb-main{container:kbtb-page / inline-size;display:flex;flex-direction:column;gap:14px;min-width:0}
        .kbtb .kb6-headrow .kb8-primary{gap:7px;transition:transform .14s cubic-bezier(.2,.8,.2,1),filter .14s}
        .kbtb .kb6-headrow .kb8-primary:active{transform:scale(.97)}
        .kbtb .kb6-tb-row{gap:8px 10px}
        .kbtb .kb6-tb-trailing{padding-top:0;min-width:0;max-width:100%;margin-inline-start:auto}
        .kbtb .kb6-search-inline input:focus-visible{outline:none}
        .kbtb-muted{color:var(--dsw-alias-label-tertiary)}
        .kbtb-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-weight:550;font-size:13px;cursor:pointer;transition:background .15s,transform .14s}
        .kbtb-btn:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-btn:active{transform:scale(.97)}
        .kbtb-btn.sm{height:30px;padding:0 11px;font-size:12px}
        .kbtb-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:650}
        .kbtb-btn.primary:hover{filter:brightness(.96)}
        .kbtb-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
        .kbtb-btn[disabled]{opacity:.5;cursor:not-allowed}
        .kbtb-ib{display:inline-grid;place-items:center;width:30px;height:30px;flex:none;border-radius:50%;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s,transform .14s}
        .kbtb-ib.sm{width:26px;height:26px}
        .kbtb-ib:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbtb-ib:active{transform:scale(.88)}
        .kbtb-ib.on{color:var(--dsw-alias-state-warn-primary)}
        .kbtb-ib.on svg{fill:currentColor}
        .kbtb-ib[disabled]{opacity:.35;cursor:not-allowed}
        .kbtb-lnk,.kbtb-link{border:none;background:transparent;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;padding:4px 6px;font-size:12px;border-radius:6px}
        .kbtb-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none;margin-inline-start:auto}
        .kbtb-lnk:hover,.kbtb-link:hover{color:var(--dsw-alias-label-primary)}
        .kbtb-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
        .kbtb-banner.warn{border-color:var(--dsw-alias-state-warn-primary)}
        .kbtb-banner .sp{flex:1 1 220px;min-width:0}
        .kbtb-banner b{color:var(--dsw-alias-label-primary)}

        .kbtb-tabs{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
        .kbtb-tab{height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;transition:background .16s,color .16s,border-color .16s,transform .14s}
        .kbtb-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
        .kbtb-tab:active{transform:scale(.96)}
        .kbtb-tab[aria-selected="true"]{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}

        .kbtb-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-height:24px}
        .kbtb-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;max-width:100%}
        .kbtb-chip svg{color:var(--dsw-alias-label-tertiary);flex:none}
        .kbtb-chip.ord{background:transparent}
        .kbtb-ft{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .kbtb-chip button{display:inline-grid;place-items:center;width:20px;height:20px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
        .kbtb-chip button:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbtb-count{margin-inline-start:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}

        .kbtb-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;min-width:0}
        .kbtb-plainbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
        .kbtb-vgrp{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);max-width:100%;overflow-x:auto;scrollbar-width:none}
        .kbtb-vbtn{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:none;border-radius:999px;background:transparent;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:background .16s,color .16s,transform .14s}
        .kbtb-vbtn:hover{color:var(--dsw-alias-label-primary)}
        .kbtb-vbtn:active{transform:scale(.96)}
        .kbtb-vbtn[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
        .kbtb-vl{max-width:140px;overflow:hidden;text-overflow:ellipsis}
        .kbtb-pw{position:relative;display:inline-flex}
        .kbtb-tp{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 13px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s,transform .14s}
        .kbtb-tp:hover,.kbtb-tp.open{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
        .kbtb-tp:active{transform:scale(.97)}
        .kbtb-tp.on{color:var(--dsw-alias-label-primary)}
        .kbtb-tp.kb svg{color:var(--dsw-alias-brand-primary)}
        .kbtb-badge{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;font-weight:650;display:inline-grid;place-items:center;font-variant-numeric:tabular-nums}
        .kbtb-new{white-space:nowrap}

        .kbtb-pop{position:absolute;z-index:40;top:calc(100% + 6px);inset-inline-end:0;width:min(520px,92vw);max-height:min(72vh,580px);overflow:auto;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 34px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);text-align:start;animation:kbtb-pop .16s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-pop.views,.kbtb-pop.fields,.kbtb-pop.sort,.kbtb-pop.modify{width:min(420px,92vw)}
        .kbtb-pop.filter{width:min(640px,94vw)}
        .kbtb-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 8px}
        .kbtb-ph h4{margin:0;font-size:13px;font-weight:650}
        .kbtb-rst{border:none;background:transparent;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;font-size:12px}
        .kbtb-rst:hover{color:var(--dsw-alias-label-primary)}
        .kbtb-note{margin:6px 0;color:var(--dsw-alias-label-secondary);font-size:12px}
        .kbtb-note.faint{color:var(--dsw-alias-label-tertiary)}
        .kbtb-psep{height:1px;background:var(--dsw-alias-border-l1);margin:10px 0}
        .kbtb-cadd{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:8px 0 2px}
        .kbtb-lnkadd{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600;cursor:pointer;padding:4px 2px;border-radius:6px}
        .kbtb-lnkadd:hover{text-decoration:underline}
        .kbtb-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
        .kbtb-pill:hover{background:var(--dsw-alias-bg-layer-2)}

        .kbtb-vlist{display:flex;flex-direction:column;gap:2px}
        .kbtb-vrow{display:flex;align-items:center;gap:2px;border-radius:10px;padding:2px 2px 2px 4px}
        .kbtb-vrow.cur{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-vsel{flex:1;min-width:0;display:flex;align-items:center;gap:9px;height:32px;border:none;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:start;border-radius:8px;padding:0 4px}
        .kbtb-vsel[aria-current="true"]{font-weight:650}
        .kbtb-vk{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);flex:none}
        .kbtb-vn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-made{display:inline-grid;place-items:center;color:var(--dsw-alias-brand-primary)}

        .kbtb-find{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}
        .kbtb-find input{flex:1;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none}
        .kbtb-frows{display:flex;flex-direction:column;margin:8px 0;max-height:300px;overflow:auto}
        .kbtb-frow{display:flex;align-items:center;gap:10px;min-height:34px;padding:0 4px}
        .kbtb-fl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-sw{position:relative;width:34px;height:20px;flex:none;border:none;border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;transition:background .16s;padding:0}
        .kbtb-sw i{position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);transition:transform .16s}
        .kbtb-sw.on{background:var(--dsw-alias-brand-primary)}
        .kbtb-sw.on i{transform:translateX(14px)}
        .kbtb-sw[disabled]{opacity:.5;cursor:not-allowed}

        .kbtb-sel,.kbtb-inp,.kbtb-in{height:34px;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 9px;font:inherit;font-size:13px}
        .kbtb-sel:focus,.kbtb-inp:focus,.kbtb-in:focus{border-color:var(--dsw-alias-brand-primary);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
        .kbtb-inp::placeholder,.kbtb-in::placeholder{color:var(--dsw-alias-label-tertiary)}
        .kbtb-clist{display:flex;flex-direction:column;gap:6px}
        .kbtb-crow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px}
        .kbtb-crow>.kbtb-cl{width:52px;flex:none;line-height:34px;color:var(--dsw-alias-label-secondary);font-size:12px}
        .kbtb-sel.cl{width:62px;flex:none;padding:0 4px}
        .kbtb-sel.cf{flex:1 1 130px;max-width:190px}
        .kbtb-sel.co{flex:1 1 120px;max-width:170px}
        .kbtb-cv{flex:2 1 160px;min-width:0}
        .kbtb-cv .kbtb-inp,.kbtb-cv .kbtb-sel{width:100%}
        .kbtb-cv2{display:flex;gap:6px;flex-wrap:wrap}
        .kbtb-cv2.col{flex-direction:column;flex-wrap:nowrap}
        .kbtb-cv2>*{flex:1 1 120px}
        .kbtb-cv2.col>*{flex:0 0 auto}
        .kbtb-crow.grow{flex-wrap:nowrap}
        .kbtb-cgrp{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px}
        .kbtb-sel.mv{display:flex;align-items:center;justify-content:space-between;gap:6px;text-align:start;cursor:pointer;width:100%}
        .kbtb-sel.mv span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-sel.mv .ph0{color:var(--dsw-alias-label-tertiary)}
        .kbtb-mlist{display:flex;flex-direction:column;max-height:200px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:3px}
        .kbtb-oi{display:flex;align-items:center;gap:8px;min-height:30px;padding:0 8px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:start}
        .kbtb-oi:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-oi .ck{width:13px;height:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;flex:none}
        .kbtb-oi.on{font-weight:600}
        .kbtb-srow{display:flex;gap:6px;margin:0 0 6px;align-items:center}
        .kbtb-srow .kbtb-sel{flex:1;min-width:0}

        .kbtb-mline{display:flex;align-items:center;gap:8px;height:42px;padding:0 6px 0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
        .kbtb-mline:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
        .kbtb-mline.wide{width:min(560px,100%)}
        .kbtb-mic{color:var(--dsw-alias-brand-primary);display:inline-grid}
        .kbtb-mi{flex:1;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
        .kbtb-mi:focus-visible,.kbtb-find input:focus-visible{outline:none}
        .kbtb-mgo{display:inline-grid;place-items:center;width:30px;height:30px;border:none;border-radius:9px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);cursor:pointer}
        .kbtb-mgo[disabled]{opacity:.4;cursor:not-allowed}
        .kbtb-mex{display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:6px 0}
        .kbtb-mex.center{flex-direction:row;flex-wrap:wrap;justify-content:center}
        .kbtb-ex{max-width:100%;padding:6px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;text-align:start}
        .kbtb-ex:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}

        .kbtb-body{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
        .kbtb-body.has-drawer{grid-template-columns:minmax(0,1fr) minmax(300px,380px)}
        .kbtb-content{min-width:0;display:flex;flex-direction:column;gap:12px}
        .kbtb-tblwrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
        .kbtb-tbl{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
        .kbtb-tbl th{position:sticky;top:0;z-index:1;text-align:start;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 10px;white-space:nowrap}
        .kbtb-tbl th.num,.kbtb-tbl td.num{text-align:end}
        .kbtb-tbl td{padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle;max-width:320px}
        .kbtb-tbl tbody tr{cursor:pointer;transition:background .12s}
        .kbtb-tbl tbody tr:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-tbl tbody tr.sel{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
        .kbtb-tbl tbody tr:last-child td{border-bottom:none}
        .kbtb-tbl td.ti button{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-weight:600;cursor:pointer;padding:0;text-align:start}
        .kbtb-th{display:inline-flex;align-items:center;gap:2px;height:36px}
        .kbtb-thb{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 6px;border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}
        .kbtb-thb:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbtb-thb.static{cursor:default}
        .kbtb-thb.static:hover{background:transparent;color:inherit}
        .kbtb-thf{display:inline-grid;place-items:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .14s}
        .kbtb-tbl th:hover .kbtb-thf,.kbtb-thf:focus-visible,.kbtb-thf.on{opacity:1}
        .kbtb-thf.on{color:var(--dsw-alias-brand-primary)}
        .kbtb-thf:hover{background:var(--dsw-alias-bg-layer-3)}
        .kbtb-sn{font-size:10px;color:var(--dsw-alias-label-tertiary)}
        .kbtb-pager{display:flex;align-items:center;gap:12px;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px}

        .kbtb-t{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-num{font-variant-numeric:tabular-nums}
        .kbtb-nil{color:var(--dsw-alias-label-tertiary)}
        .kbtb-mask{letter-spacing:1px;color:var(--dsw-alias-label-tertiary)}
        .kbtb-tick{display:inline-grid;color:var(--dsw-alias-state-success-primary)}
        .kbtb-a{color:var(--dsw-alias-brand-primary);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;max-width:100%;vertical-align:bottom}
        .kbtb-a:hover{text-decoration:underline}
        .kbtb-files{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary)}
        .kbtb-opts{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center}
        .kbtb-opt{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:22px;padding:0 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .kbtb-opt i,.kbtb-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
        .kbtb-opt.hue{background:hsl(var(--kbtb-h) 70% 50% / .16)}
        .kbtb-opt.hue i,.kbtb-dot.hue{background:hsl(var(--kbtb-h) 70% 48%)}
        .kbtb-rel{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
        .kbtb-more{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}
        button.kbtb-rel{font-family:inherit;background:transparent;cursor:pointer;transition:border-color .14s,color .14s,background .14s}
        button.kbtb-rel.go:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
        button.kbtb-rel.go:active{transform:scale(.97)}
        .kbtb-rel.gone{color:var(--dsw-alias-label-tertiary);border-style:dashed}
        .kbtb-rel.edit{padding:0 2px 0 8px;max-width:100%;gap:4px}
        .kbtb-lf{display:flex;flex-direction:column;gap:12px;padding:14px 18px 6px;border-top:1px solid var(--dsw-alias-border-l1)}
        p.kbtb-lf{margin:0;border-top:1px solid var(--dsw-alias-border-l1)}
        .kbtb-lft{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary)}
        .kbtb-lg{display:flex;flex-direction:column;gap:6px;min-width:0}
        .kbtb-lgh{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
        .kbtb-lgh b{font-size:13px}
        .kbtb-lgc{min-width:20px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}
        .kbtb-lgv{color:var(--dsw-alias-label-tertiary);font-size:11.5px}

        .kbtb-tab.sm{height:28px;padding:0 12px;font-size:12px}
        .kbtb-mapw{display:flex;flex-direction:column;gap:12px}
        .kbtb-map{width:100%;height:auto;max-height:380px;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
        .kbtb-mn{cursor:pointer;outline:none}
        .kbtb-mn rect{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);stroke-width:1.2;transition:stroke .14s}
        .kbtb-mn.on rect{stroke:var(--dsw-alias-brand-primary);stroke-width:2}
        .kbtb-mn:hover rect,.kbtb-mn:focus-visible rect{stroke:var(--dsw-alias-brand-primary)}
        .kbtb-mn text{fill:var(--dsw-alias-label-primary);font-size:13px;font-weight:650;pointer-events:none}
        .kbtb-mp{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5}
        .kbtb-mk{fill:var(--dsw-alias-label-tertiary)}
        .kbtb-ml{fill:var(--dsw-alias-label-secondary);font-size:11px;paint-order:stroke;stroke:var(--dsw-alias-bg-layer-2);stroke-width:5px;stroke-linejoin:round}
        .kbtb-maplist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;font-size:13px}
        .kbtb-maplist .kbtb-note{margin:0}
        .kbtb-mapnone{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;color:var(--dsw-alias-label-secondary);font-size:13px}
        .kbtb-link.flat{margin-inline-start:0}

        .kbtb-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}
        .kbtb-col{flex:0 0 260px;display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid transparent;min-height:90px;transition:border-color .14s,background .14s}
        .kbtb-col.over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-2))}
        .kbtb-colh{display:flex;align-items:center;gap:8px;padding:2px 2px 2px 6px;font-weight:650}
        .kbtb-colt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-colc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
        .kbtb-colv{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
        .kbtb-bcard{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:grab;transition:border-color .14s,transform .14s,opacity .14s}
        .kbtb-bcard:hover{border-color:var(--dsw-alias-border-l2)}
        .kbtb-bcard.drag{opacity:.45}
        .kbtb-bt{font-weight:600;overflow-wrap:anywhere}
        .kbtb-bm{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}

        .kbtb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
        .kbtb-tile{display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);text-align:start;cursor:pointer;min-width:0;transition:border-color .14s,transform .14s}
        .kbtb-tile:hover{border-color:var(--dsw-alias-border-l2)}
        .kbtb-tile:active{transform:scale(.985)}
        .kbtb-im{display:inline-grid;place-items:center;width:38px;height:38px;flex:none;border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-weight:700}
        .kbtb-im.hue{background:hsl(var(--kbtb-h) 70% 50% / .18);color:hsl(var(--kbtb-h) 55% 38%)}
        .kbtb-im.pic{object-fit:cover;display:block;padding:0}
        .kbtb-im.none{display:inline-grid}
        .kbtb-tile.cov{flex-direction:column;align-items:stretch;gap:0;padding:0;overflow:hidden}
        .kbtb-tile.cov .kbtb-tb{padding:10px 12px 12px}
        .kbtb-cv{display:block;aspect-ratio:16/10;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
        .kbtb-cimg{display:block;width:100%;height:100%;object-fit:cover}
        .kbtb-cimg.ph,.kbtb-cimg.none{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:30px;font-weight:700}
        .kbtb-cimg.ph.hue{background:hsl(var(--kbtb-h) 70% 50% / .18);color:hsl(var(--kbtb-h) 55% 38%)}
        .kbtb-tb{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
        .kbtb-tt{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-tl2{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
        .kbtb-k{color:var(--dsw-alias-label-tertiary);flex:none}
        .kbtb-geo{--kbtb-l1:var(--dsw-alias-bg-layer-1);--kbtb-l2:var(--dsw-alias-bg-layer-2);--kbtb-l3:var(--dsw-alias-bg-layer-3);--kbtb-b2:var(--dsw-alias-border-l2);--kbtb-b3:var(--dsw-alias-border-l3);--kbtb-t1:var(--dsw-alias-label-primary);--kbtb-t2:var(--dsw-alias-label-secondary);--kbtb-t3:var(--dsw-alias-label-tertiary);--kbtb-fg:var(--dsw-alias-label-primary-foreground);--kbtb-accent:var(--dsw-alias-brand-primary-new-color,var(--dsw-alias-state-business-primary));--kbtb-blue:var(--dsw-alias-state-business-primary);--kbtb-hover:var(--dsw-alias-interactive-bg-hover);--kbtb-ok:var(--dsw-alias-state-success-primary);--kbtb-warn:var(--dsw-alias-state-warn-primary);--kbtb-bad:var(--dsw-alias-state-error-primary);--kbtb-bone:var(--dsw-alias-bg-skeleton);position:relative;height:min(680px,calc(100vh - 300px));min-height:360px;border:1px solid var(--kbtb-b2);border-radius:16px;overflow:hidden;background:var(--kbtb-map-land)}
        .kbtb-drawn{--kbtb-map-land:color-mix(in srgb,var(--kbtb-l2) 86%,var(--kbtb-warn));--kbtb-map-block:color-mix(in srgb,var(--kbtb-l1) 90%,var(--kbtb-l3));--kbtb-map-street:var(--kbtb-l1);display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}
        .kbtb-drawn.drag{cursor:grabbing}
        .kbtb-drawn .land{fill:var(--kbtb-map-land)}
        .kbtb-drawn .block{fill:var(--kbtb-map-block)}
        .kbtb-drawn .street{stroke:var(--kbtb-map-street);fill:none;stroke-linecap:round}
        .kbtb-drawn .park{fill:color-mix(in srgb,var(--kbtb-ok) 34%,var(--kbtb-l2))}
        .kbtb-drawn .water{fill:color-mix(in srgb,var(--kbtb-blue) 34%,var(--kbtb-l2))}
        .kbtb-drawn .river{fill:none;stroke:color-mix(in srgb,var(--kbtb-blue) 34%,var(--kbtb-l2));stroke-linecap:round}
        .kbtb-pin{cursor:pointer;outline:none}
        .kbtb-pin .body{transform-origin:0 0;transition:transform .16s cubic-bezier(.2,.8,.2,1)}
        .kbtb-pin .bubble{fill:var(--kbtb-l1);stroke:var(--kbtb-b3);stroke-width:1.2;filter:drop-shadow(0 3px 5px color-mix(in srgb,var(--kbtb-t1) 28%,transparent))}
        .kbtb-pin .tail{fill:var(--kbtb-l1);stroke:var(--kbtb-b3);stroke-width:1.2}
        .kbtb-pin text{fill:var(--kbtb-t1);font-size:13px;font-weight:700;text-anchor:middle;pointer-events:none;font-variant-numeric:tabular-nums}
        .kbtb-pin:hover .body,.kbtb-pin.on .body,.kbtb-pin:focus-visible .body{transform:scale(1.16)}
        .kbtb-pin.on .bubble,.kbtb-pin.on .tail,.kbtb-pin:hover .bubble,.kbtb-pin:hover .tail{fill:var(--kbtb-t1);stroke:var(--kbtb-t1)}
        .kbtb-pin.on text,.kbtb-pin:hover text{fill:var(--kbtb-l1)}
        .kbtb-pin:focus-visible .bubble{stroke:var(--kbtb-accent);stroke-width:2.4}
        .kbtb-geoctl{position:absolute;inset-inline-end:10px;top:10px;display:flex;flex-direction:column;gap:6px;z-index:2}
        .kbtb-geoctl>button{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--kbtb-b2);background:color-mix(in srgb,var(--kbtb-l1) 92%,transparent);color:var(--kbtb-t1);transition:background-color .15s,transform .14s}
        .kbtb-geoctl>button:hover:not(:disabled){background:var(--kbtb-l1);transform:translateY(-1px)}
        .kbtb-geoctl>button:active:not(:disabled){transform:scale(.94)}
        .kbtb-geoctl>button:disabled{opacity:.5;cursor:default}
        .kbtb-geoctl>button[aria-expanded="true"]{background:var(--kbtb-l1);border-color:var(--kbtb-b3)}
        .kbtb-geothemes{position:absolute;inset-inline-end:42px;top:0;z-index:3;min-width:128px;display:flex;flex-direction:column;gap:1px;padding:4px;border-radius:12px;border:1px solid var(--kbtb-b2);background:color-mix(in srgb,var(--kbtb-l1) 97%,transparent);box-shadow:0 8px 24px color-mix(in srgb,var(--kbtb-t1) 18%,transparent);animation:kbtb-pop .16s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-geothemes [role="menuitemradio"]{display:flex;align-items:center;justify-content:space-between;gap:12px;height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--kbtb-t1);font:inherit;font-size:13px;text-align:start;cursor:pointer;transition:background-color .12s}
        .kbtb-geothemes [role="menuitemradio"]:hover{background:var(--kbtb-hover)}
        .kbtb-geothemes [role="menuitemradio"][aria-checked="true"]{font-weight:650;color:var(--kbtb-accent)}
        .kbtb-geothemes-note{margin:2px 6px 4px;max-width:150px;font-size:11.5px;line-height:15px;color:var(--kbtb-bad)}
        .kbtb-geonote{position:absolute;inset-inline-start:10px;bottom:10px;z-index:2;display:flex;gap:8px;align-items:center;max-width:calc(100% - 20px);padding:5px 10px;border-radius:999px;font-size:12px;color:var(--kbtb-t2);background:color-mix(in srgb,var(--kbtb-l1) 90%,transparent);border:1px solid var(--kbtb-b2)}
        .kbtb-pin.ghost{pointer-events:none}
        .kbtb-geo[data-map="real"],.kbtb-geo[data-map="loading"]{background:var(--kbtb-l2)}
        .kbtb-gl{position:absolute;inset:0;z-index:0}
        .kbtb-gl.maplibregl-map{position:absolute;font:inherit;color:inherit}
        .kbtb-gl .maplibregl-canvas:focus-visible{outline:2px solid var(--kbtb-accent);outline-offset:-2px}
        .kbtb-gl .maplibregl-cooperative-gesture-screen{font:inherit;font-size:14px;background:color-mix(in srgb,var(--kbtb-t1) 55%,transparent);color:var(--kbtb-l1)}
        .kbtb-geoload{position:absolute;inset:0;z-index:1;display:grid;place-items:center}
        .kbtb-geoload .kbtb-bone{position:absolute;inset:0;border-radius:0;opacity:.55}
        .kbtb-geoload-text{position:relative;padding:6px 14px;border-radius:999px;border:1px solid var(--kbtb-b2);background:color-mix(in srgb,var(--kbtb-l1) 92%,transparent);color:var(--kbtb-t2);font-size:12.5px}
        .kbtb-attr{position:absolute;inset-inline-end:6px;bottom:5px;z-index:2;max-width:calc(100% - 12px);display:flex;align-items:center;justify-content:flex-end;gap:4px;padding:1px 5px;border-radius:5px;font-size:9px;line-height:12px;white-space:nowrap;color:var(--kbtb-t2);background:color-mix(in srgb,var(--kbtb-l1) 84%,transparent)}
        .kbtb-attr a{color:inherit;text-decoration:none}
        .kbtb-attr a:hover{color:var(--kbtb-t1);text-decoration:underline}
        .kbtb-attr-gauge{position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap}
        .kbtb-attr.fold{padding:0;background:transparent;align-items:flex-end}
        .kbtb-attr-i{position:relative;flex:none;width:18px;height:18px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid var(--kbtb-b2);background:color-mix(in srgb,var(--kbtb-l1) 90%,transparent);color:var(--kbtb-t2);cursor:pointer}
        .kbtb-attr-i::after{content:'';position:absolute;inset:-8px}
        .kbtb-attr-i:hover{color:var(--kbtb-t1);background:var(--kbtb-l1)}
        .kbtb-attr.open .kbtb-attr-text{order:-1;white-space:normal;max-width:calc(100vw - 80px);padding:5px 9px;border-radius:9px;border:1px solid var(--kbtb-b2);background:color-mix(in srgb,var(--kbtb-l1) 96%,transparent);font-size:10.5px;line-height:15px;text-align:end}
        .kbtb-geolink{display:inline-flex;align-items:center;gap:4px;margin-inline-start:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--kbtb-b2);background:transparent;font-size:11.5px;color:var(--kbtb-t1);transition:background-color .15s}
        .kbtb-geolink:hover{background:var(--kbtb-hover)}
        .kbtb-rp{z-index:1;display:block;padding:0;margin:0;border:0;background:transparent;font:inherit;color:var(--kbtb-t1);cursor:pointer;outline:none}
        .kbtb-rp .b{display:flex;flex-direction:column;align-items:center;transform-origin:50% 100%;transition:transform .16s cubic-bezier(.2,.8,.2,1)}
        .kbtb-rp .p{display:block;min-width:46px;height:25px;padding:0 11px;border-radius:13px;border:1px solid var(--kbtb-b3);background:var(--kbtb-l1);color:var(--kbtb-t1);font-size:13px;font-weight:700;line-height:23px;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 3px 8px color-mix(in srgb,var(--kbtb-t1) 22%,transparent);transition:background-color .15s,color .15s,border-color .15s}
        .kbtb-rp .t{display:block;width:9px;height:9px;margin-top:-5px;border-right:1px solid var(--kbtb-b3);border-bottom:1px solid var(--kbtb-b3);background:var(--kbtb-l1);transform:rotate(45deg);transition:background-color .15s,border-color .15s}
        .kbtb-rp:hover,.kbtb-rp.hot,.kbtb-rp:focus-visible{z-index:3}
        .kbtb-rp:hover .b,.kbtb-rp.hot .b,.kbtb-rp.sel .b,.kbtb-rp:focus-visible .b{transform:translateY(-2px) scale(1.08)}
        .kbtb-rp:hover .p,.kbtb-rp.hot .p{background:var(--kbtb-t1);border-color:var(--kbtb-t1);color:var(--kbtb-l1)}
        .kbtb-rp:hover .t,.kbtb-rp.hot .t{background:var(--kbtb-t1);border-color:var(--kbtb-t1)}
        .kbtb-rp.sel{z-index:4}
        .kbtb-rp.sel{--kbtb-pick:color-mix(in srgb,var(--kbtb-accent) 82%,var(--kbtb-t1))}
        .kbtb-rp.sel .p{background:var(--kbtb-pick);border-color:var(--kbtb-pick);color:var(--kbtb-fg)}
        .kbtb-rp.sel .t{background:var(--kbtb-pick);border-color:var(--kbtb-pick)}
        .kbtb-rp:focus-visible .p{outline:2px solid var(--kbtb-accent);outline-offset:2px}
        .kbtb-gl[data-scheme="dark"] .kbtb-rp .p{background:var(--kbtb-l3);box-shadow:0 3px 10px color-mix(in srgb,var(--kbtb-l1) 70%,transparent)}
        .kbtb-gl[data-scheme="dark"] .kbtb-rp .t{background:var(--kbtb-l3)}
        .kbtb-gl[data-scheme="dark"] .kbtb-rp:hover .p,.kbtb-gl[data-scheme="dark"] .kbtb-rp.hot .p{background:var(--kbtb-t1)}
        .kbtb-gl[data-scheme="dark"] .kbtb-rp:hover .t,.kbtb-gl[data-scheme="dark"] .kbtb-rp.hot .t{background:var(--kbtb-t1)}
        .kbtb-gl[data-scheme="dark"] .kbtb-rp.sel .p,.kbtb-gl[data-scheme="dark"] .kbtb-rp.sel .t{background:var(--kbtb-pick)}
        .kbtb-rp.cluster .p{min-width:34px;height:34px;padding:0 6px;border-radius:17px;corner-shape:round;line-height:32px;text-align:center}
        .kbtb-rp.cluster .t{display:none}
        .kbtb-bone{background:var(--kbtb-bone);border-radius:8px;animation:kbtb-pulse 1.4s ease-in-out infinite}
        @media (pointer:coarse){.kbtb-rp::after{content:'';position:absolute;inset:-8px -6px}}
        @media (max-width:900px){.kbtb-geo{height:360px;min-height:0}}
        @media (max-width:640px){.kbtb-geo[data-map="real"] .kbtb-geonote,.kbtb-geo[data-map="loading"] .kbtb-geonote{top:10px;bottom:auto;max-width:calc(100% - 64px)}}
        @media (prefers-reduced-motion:reduce){.kbtb-rp .b,.kbtb-rp .p,.kbtb-rp .t,.kbtb-geolink,.kbtb-pin .body,.kbtb-geoctl>button,.kbtb-geothemes [role="menuitemradio"]{transition:none}.kbtb-rp:hover .b,.kbtb-rp.hot .b,.kbtb-rp.sel .b,.kbtb-rp:focus-visible .b,.kbtb-pin:hover .body,.kbtb-pin.on .body{transform:none}.kbtb-bone,.kbtb-geothemes{animation:none}}

        .kbtb-cal{display:flex;flex-direction:column;gap:10px}
        .kbtb-calh{display:flex;align-items:center;gap:8px}
        .kbtb-calh b{font-size:15px;margin-inline-end:auto;text-transform:capitalize}
        .kbtb-calg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
        .kbtb-cald{padding:8px;text-align:center;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
        .kbtb-cc{min-height:92px;padding:5px;display:flex;flex-direction:column;gap:3px;border-inline-end:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
        .kbtb-cc:nth-child(7n){border-inline-end:none}
        .kbtb-cc.out{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
        .kbtb-cc.today .kbtb-dn b{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border-radius:999px;padding:1px 7px}
        .kbtb-dn{display:flex;align-items:center;justify-content:space-between;font-size:12px}
        .kbtb-ce{display:block;width:100%;height:22px;padding:0 7px;border:none;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:11.5px;text-align:start;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
        .kbtb-ce.hue{background:hsl(var(--kbtb-h) 70% 50% / .2)}
        .kbtb-ce:hover{filter:brightness(.95)}

        .kbtb-drawer{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);min-width:0;animation:kbtb-slide .26s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-dh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 14px 10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:15px}
        .kbtb-dh b{overflow-wrap:anywhere;flex:1;min-width:0}
        .kbtb-dfields{display:flex;flex-direction:column;gap:14px;padding:16px 18px}
        .kbtb-df{display:flex;flex-direction:column;gap:5px;min-width:0}
        .kbtb-dl{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:5px}
        .kbtb-prot{display:inline-grid;color:var(--dsw-alias-label-tertiary)}
        .kbtb-ferr{color:var(--dsw-alias-state-error-primary);font-size:12px;flex-basis:100%}
        .kbtb-fthumb.none{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}
        .kbtb-fchips{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;vertical-align:middle}
        .kbtb-fchip{position:relative;display:inline-flex;align-items:center;min-width:0;height:24px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}
        .kbtb-fchip .kbtb-fa{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:150px;height:100%;padding:0 8px;color:inherit;text-decoration:none;border-radius:inherit}
        .kbtb-fchip .kbtb-fa:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-fchip.pic{border:none}
        .kbtb-fchip.pic .kbtb-fa{padding:0}
        .kbtb-fcn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .kbtb-fthumb{width:28px;height:28px;display:block;object-fit:cover;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-fchip.pic{height:28px}
        .kbtb-dfoot{display:flex;gap:8px;justify-content:flex-end;padding-top:4px}
        .kbtb-dfoot.split{justify-content:space-between;align-items:center;padding:12px 18px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
        .kbtb-stamp{color:var(--dsw-alias-label-tertiary);font-size:11.5px}

        .kbtb-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:44px 20px;text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-secondary)}
        .kbtb-empty b{color:var(--dsw-alias-label-primary);font-size:15px}
        .kbtb-empty.big{padding:64px 20px}
        .kbtb-empty span{max-width:520px}

        .kbtb-toast{position:fixed;bottom:18px;inset-inline-start:50%;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;max-width:min(560px,92vw);background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);border-radius:12px;padding:10px 14px;font-size:13px;animation:kbtb-rise .24s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-toast svg{flex:none}
        .kbtb-tact{border:none;background:transparent;color:inherit;font-weight:700;text-decoration:underline;cursor:pointer;padding:2px 4px;border-radius:6px}

        @keyframes kbtb-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
        @keyframes kbtb-slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
        @keyframes kbtb-pulse{0%,100%{opacity:.5}50%{opacity:1}}
        @keyframes kbtb-rise{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
        @container kbtb-page (max-width:760px){
          .kbtb-body.has-drawer{grid-template-columns:minmax(0,1fr)}
          .kbtb-drawer{position:relative;top:auto;max-height:none}
          .kbtb-tl{display:none}
          .kbtb-tp{padding:0 11px}
          .kbtb-badge{margin-inline-start:-2px}
          .kbtb-bar{justify-content:flex-start}
          .kbtb .kb6-tb-trailing{margin-inline-start:0;flex-basis:100%}
        }
        @media (max-width:640px){
          .kbtb-pop{position:fixed;inset-inline:8px;bottom:8px;top:auto;width:auto!important;max-height:72vh}
          .kbtb-crow.grow{flex-wrap:wrap}
        }
        @media (prefers-reduced-motion:reduce){
          .kbtb *,.kbtb-toast{animation:none!important;transition:none!important}
        }

        .kbtb-head .kbtb-actions,.kbtb-actions{display:flex;align-items:center;gap:8px}
        .kbtb-back{display:inline-grid;place-items:center;width:34px;height:34px;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s,transform .14s}
        .kbtb-back:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
        .kbtb-back:active{transform:scale(.92)}
        .kbtb-titlerow{gap:10px}
        .kbtb-apptile{display:inline-grid;place-items:center;width:46px;height:46px;flex:none;border-radius:14px;background:hsl(var(--kbtb-h) 70% 50% / .16);color:color-mix(in srgb,hsl(var(--kbtb-h) 70% 46%) 78%,var(--dsw-alias-label-primary));font-size:20px;font-weight:650}
        .kbtb-apptile.s{width:34px;height:34px;border-radius:10px;font-size:16px}
        .kbtb-tabs2{align-items:center}
        .kbtb-tabsep{width:1px;height:20px;margin:0 6px;background:var(--dsw-alias-border-l2)}
        .kbtb-tab.rel{display:inline-flex;align-items:center;gap:7px}
        .kbtb-tbrow{min-width:0}

        .kbtb-gallery{display:flex;flex-direction:column;gap:22px;padding-bottom:72px} /* room under the last row for a card's menu, which hangs lower than the card */
        .kbtb-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
        .kbtb-appcard{position:relative;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s,box-shadow .15s}
        .kbtb-appcard:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}
        .kbtb-appcard.arch{background:var(--dsw-alias-bg-layer-2);gap:6px;padding-bottom:12px}
        .kbtb-appopen{display:flex;flex-direction:column;align-items:flex-start;gap:12px;flex:1;width:100%;padding:18px 18px 16px;border:none;border-radius:inherit;background:transparent;color:inherit;text-align:start;cursor:pointer}
        .kbtb-appopen.static{cursor:default}
        .kbtb-appopen:focus-visible{outline-offset:-2px}
        .kbtb-appmid{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%}
        .kbtb-appname{font-size:16px;font-weight:650;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-appline{color:var(--dsw-alias-label-secondary);font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .kbtb-appline.small{font-size:12px;color:var(--dsw-alias-label-tertiary)}
        .kbtb-sects{display:flex;flex-wrap:wrap;gap:6px}
        .kbtb-sect{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px}
        .kbtb-sect b{font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
        .kbtb-appfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .kbtb-state{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-state.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
        .kbtb-state.add{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
        .kbtb-appkeb{position:absolute;top:12px;inset-inline-end:12px;z-index:2}
        .kbtb-row2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:0 14px}
        .kbtb-tx{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-weight:550;cursor:pointer}
        .kbtb-tx:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbtb-tx.bad{color:var(--dsw-alias-state-error-primary)}
        .kbtb-archived{display:flex;flex-direction:column;gap:10px}
        .kbtb-fold{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 6px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;cursor:pointer}
        .kbtb-fold:hover{color:var(--dsw-alias-label-primary)}
        .kbtb-emptytile{display:inline-grid;place-items:center;width:54px;height:54px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
        .kbtb-newapp{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
        .kbtb-newapp .kbtb-mline{width:min(640px,100%);height:48px}
        .kbtb-newapp .kbtb-mex{flex-direction:row;flex-wrap:wrap;margin:0}
        .kbtb-sec{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:14px}
        .kbtb-sec .kbtb-gal{margin-top:8px}
        .kbtb-sh{margin:0;font-size:15px;font-weight:650}
        .kbtb-sub{margin:0;max-width:640px;color:var(--dsw-alias-label-secondary);font-size:13px}
        .kbtb-relations{display:flex;flex-direction:column;gap:10px}

        .kbtb-mi2{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:0 10px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;text-align:start}
        .kbtb-mi2:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-mi2.bad{color:var(--dsw-alias-state-error-primary)}
        .kbtb-pop.sm{width:min(250px,92vw)}
        .kbtb-pop.archt{width:min(420px,92vw)}
        .kbtb-alist{display:flex;flex-direction:column}
        .kbtb-arow{display:flex;flex-direction:column;gap:2px;padding:8px 2px;border-top:1px solid var(--dsw-alias-border-l1)}
        .kbtb-arow:first-child{border-top:none}
        .kbtb-arow .kbtb-row2{padding:0}
        .kbtb-aname{display:flex;flex-direction:column}
        .kbtb-aname small{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-pw .kbtb-ib.open{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}

        .kbtb-dv{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
        .kbtb-long{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}

        .kbtb-layer{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px}
        .kbtb-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 40%,transparent);animation:kbtb-pop .16s ease both}
        .kbtb-dlg{position:relative;width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:24px;border-radius:20px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 60px color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent);animation:kbtb-pop .18s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-dlg h3{margin:0;font-size:18px;font-weight:650;letter-spacing:-.005em;overflow-wrap:anywhere}
        .kbtb-dlgh{display:flex;align-items:center;gap:14px}
        .kbtb-lead{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13.5px}
        .kbtb-facts{display:flex;flex-direction:column;margin:18px 0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}
        .kbtb-fact{display:grid;grid-template-columns:minmax(90px,30%) 1fr;gap:12px;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
        .kbtb-fact:first-child{border-top:none}
        .kbtb-fact dt{color:var(--dsw-alias-label-tertiary);font-size:12.5px}
        .kbtb-fact dd{margin:0;font-size:13px;min-width:0;overflow-wrap:anywhere}
        .kbtb-fact dd small{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-fact.warn dd{color:var(--dsw-alias-state-error-primary)}
        .kbtb-typed{display:flex;flex-direction:column;gap:6px;margin-top:16px;font-size:13px;color:var(--dsw-alias-label-secondary)}
        .kbtb-typed b{color:var(--dsw-alias-label-primary)}
        .kbtb-typed .kbtb-inp{width:100%}
        .kbtb-opts2{display:flex;flex-direction:column;gap:12px;margin-top:16px}
        .kbtb-ck{display:flex;align-items:flex-start;gap:10px;font-size:13px;cursor:pointer}
        .kbtb-ck input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}
        .kbtb-ck small{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
        @media (max-width:640px){
          .kbtb-gal{grid-template-columns:1fr}
          .kbtb-fact{grid-template-columns:1fr;gap:2px}
          .kbtb-dlg{padding:20px}
        }
        @media (prefers-reduced-motion:reduce){.kbtb-scrim,.kbtb-dlg{animation:none}}
        .kbtb .kb6-headrow .kbtb-btn{height:38px;padding:0 16px;border-radius:12px;white-space:nowrap}
        .kbtb .kb6-headrow .kbtb-actions{flex-wrap:wrap}
        @media (max-width:640px){.kbtb .kb6-headrow .kbtb-btn{padding:0 12px}}
        .kbtb-pub{display:inline-flex;align-items:center;gap:6px;height:24px;max-width:100%;min-width:0;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
        .kbtb-pub svg{flex:none}
        .kbtb-pub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-pub.bad{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
        .kbtb-pub.hd{height:22px}
        .kbtb-pubnote > svg{flex:none;color:var(--dsw-alias-state-success-primary)}
        .kbtb-pubnote.warn > svg{color:var(--dsw-alias-state-warn-primary)}
        .kbtb-pubnote .sp{display:flex;flex-direction:column;gap:2px}
        .kbtb-sync{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-pubnote.warn .kbtb-sync{color:var(--dsw-alias-label-secondary)}
        .kbtb-pubsent{font-size:12.5px}
        .kbtb-mi2.dis{opacity:.55;cursor:not-allowed}
        .kbtb-mi2.dis:hover{background:transparent}
        .kbtb-mi2 .kbtb-why{margin-inline-start:auto;color:var(--dsw-alias-label-tertiary);font-size:11.5px;white-space:nowrap}
`

      const ICONS = {
        plus: ['M5 12h14', 'M12 5v14'],
        search: ['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
        x: ['M18 6 6 18', 'M6 6l12 12'],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        star: ['M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z'],
        filter: ['M3 4h18l-7 8.5V19l-4 2v-8.5z'],
        sort: ['M7 4v16', 'M3 16l4 4 4-4', 'M17 20V4', 'M13 8l4-4 4 4'],
        up: ['M12 19V5', 'M5 12l7-7 7 7'],
        down: ['M12 5v14', 'M19 12l-7 7-7-7'],
        eye: ['M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
        table: ['M3 5h18v14H3z', 'M3 10h18', 'M9 5v14'],
        board: ['M4 4h4.5v16H4z', 'M9.75 4h4.5v10h-4.5z', 'M15.5 4H20v13h-4.5z'],
        cards: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
        calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
        sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z'],
        trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
        copy: ['M9 9h11v11H9z', 'M5 15V5h10'],
        edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
        chevL: ['M15 6l-6 6 6 6'],
        chevR: ['M9 6l6 6-6 6'],
        chevD: ['M6 9l6 6 6-6'],
        undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
        clip: ['M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7'],
        link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
        arrow: ['M5 12h14', 'M12 5l7 7-7 7'],
        lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
        map: ['M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z', 'M9 4v13.5', 'M15 6.5V20'],
        layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
        fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
        minus: ['M5 12h14'],
        info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
        refresh: ['M21 12a9 9 0 0 0-15-6.7L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 15 6.7L21 16', 'M21 21v-5h-5'],
        dots: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
        archive: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
        restore: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
        globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z'],
        external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
        upload: ['M12 16V4', 'M6 10l6-6 6 6', 'M4 20h16'],
        apps: ['M4 4h6.5v6.5H4z', 'M13.5 4H20v6.5h-6.5z', 'M4 13.5h6.5V20H4z', 'M16.75 13.5v6.5', 'M13.5 16.75H20'],
        nodes: ['M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M10.5 8.5 7.5 15.5', 'M13.5 8.5l3 7'],
        db: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
      }

      /** The tab after the tables: how they connect. Not a table's key (those are words), so it cannot clash with one. */
      const REL_TAB = '@relations'
      /** The templates the core offers, if it does: `{ list(): Promise<[template]>, add(id, { sample, kit }): Promise<{ ok, appId? }> }`. None, and the page shows no templates. */
      const tplSeam = () => { try { const s = window.__KB_TEMPLATES__; return plain(s) && typeof s.list === 'function' && typeof s.add === 'function' ? s : null } catch (e) { return null } }
      const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
      /** One template as the page draws it, or null when what the core sent is not a template. */
      const templateOf = (x) => {
        if (!plain(x) || typeof x.id !== 'string' || x.id === '' || typeof x.name !== 'string' || x.name === '') return null
        return { id: x.id.slice(0, 80), name: x.name.slice(0, 80), line: str(x.line, 200), tag: str(x.tag, 40), extras: str(x.extras, 160), tables: (Array.isArray(x.tables) ? x.tables : []).filter((t) => typeof t === 'string' && t !== '').map((t) => t.slice(0, 40)).slice(0, 12), have: x.have === true, appId: typeof x.appId === 'string' && x.appId !== '' ? x.appId : null }
      }

      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React
        const svg = (name, size) => h('svg', { width: size || 15, height: size || 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, (ICONS[name] || []).map((d, i) => h('path', { key: i, d })))
        const stop = (e) => { try { e.stopPropagation() } catch (x) { /* a synthetic event without it */ } }
        // ── cells ───────────────────────────────────────────────────────────────────────────────────────────────────────────
        /** A choice option as a chip: its colour is a hue the theme's tones are built from, grey having none. */
        const Opt = ({ field, value }) => {
          const o = optionOf(field, value)
          const hue = o ? hueOfColor(o.color) : null
          return h('span', { className: 'kbtb-opt' + (hue === null ? '' : ' hue'), style: hue === null ? undefined : { '--kbtb-h': hue } }, h('i', { 'aria-hidden': 'true' }), o ? o.label : String(value))
        }
        const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
        /** The same `ctx` without the way to open a linked row: a card is itself one button, and a button does not hold another. */
        const noOpen = (ctx) => (typeof ctx.open === 'function' ? Object.assign({}, ctx, { open: undefined }) : ctx)
        /** The records a link field points at, as chips; a chip opens its record when the page can (`ctx.open`), and a record that was deleted is shown as such. */
        const LinkChips = ({ field, value, ctx, max }) => {
          const ids = field.many ? value : [value]
          return h('span', { className: 'kbtb-opts' },
            ids.slice(0, max).map((id) => {
              const r = ctx.resolve(field, id)
              if (r.missing) return h('span', { key: id, className: 'kbtb-rel gone', 'data-kb': 'tables-link-gone', title: kt('Cette ligne a été supprimée.', 'This row was deleted.') }, svg('link', 11), r.title)
              if (typeof ctx.open === 'function' && !r.loading) return h('button', { key: id, type: 'button', className: 'kbtb-rel go', 'data-kb': 'tables-link', 'data-object': field.to, 'data-id': id, title: kt('Ouvrir ', 'Open ') + r.title, onClick: (e) => { stop(e); ctx.open(field, id) } }, svg('link', 11), r.title)
              return h('span', { key: id, className: 'kbtb-rel' }, svg('link', 11), r.title)
            }),
            ids.length > max ? h('span', { className: 'kbtb-more' }, '+' + (ids.length - max)) : null)
        }
        /** A picture of a file the row holds; the file's icon in its place when the host cannot give the picture (the file is gone). */
        const Thumb = ({ src, cls }) => {
          const [bad, setBad] = useState(false)
          return bad ? h('span', { className: cls + ' none' }, svg('clip', 14)) : h('img', { className: cls, src, alt: '', loading: 'lazy', onError: () => setBad(true) })
        }
        /** The files of a cell: a thumbnail for a picture, a name for the rest, each opening its file. */
        const FileChips = ({ field, rec, ctx }) => {
          const list = rec.values[field.key]
          const max = 3
          return h('span', { className: 'kbtb-fchips', 'data-kb': 'tables-files' },
            list.slice(0, max).map((f) => {
              const url = ctx.fileUrl(field, rec, f)
              const pic = isImage(f)
              const attrs = Object.assign({ className: 'kbtb-fa', title: f.name + ' · ' + fmtBytes(f.size), 'aria-label': f.name + ' (' + fmtBytes(f.size) + ')', href: url, onClick: stop }, isImage(f) ? { target: '_blank', rel: 'noopener noreferrer' } : { download: f.name })
              return h('span', { key: f.hash, className: 'kbtb-fchip' + (pic ? ' pic' : ''), 'data-kb': 'tables-file', 'data-hash': f.hash },
                h('a', attrs, pic ? h(Thumb, { src: url, cls: 'kbtb-fthumb' }) : [svg('clip', 12), h('span', { key: 'n', className: 'kbtb-fcn' }, f.name)]))
            }),
            list.length > max ? h('span', { className: 'kbtb-more' }, '+' + (list.length - max)) : null)
        }
        /** What a record holds in a field, drawn for a table cell, a card or a board card. */
        const Cell = ({ field, rec, ctx }) => {
          const v = rec.values[field.key]
          if (field.type === 'checkbox') return v === true ? h('span', { className: 'kbtb-tick', role: 'img', 'aria-label': kt('Coché', 'Checked') }, svg('check', 14)) : null
          if (empty(v)) return null
          if (field.protection === 'secret') return h('span', { className: 'kbtb-mask' }, MASK)
          switch (field.type) {
            case 'choice': return h(Opt, { field, value: v })
            case 'multichoice': return h('span', { className: 'kbtb-opts' }, v.map((k) => h(Opt, { key: k, field, value: k })))
            case 'relation': return h(LinkChips, { field, value: v, ctx, max: 2 })
            case 'url': return h('a', { className: 'kbtb-a', href: v, target: '_blank', rel: 'noopener noreferrer', onClick: stop }, v)
            case 'email': return h('a', { className: 'kbtb-a', href: 'mailto:' + v, onClick: stop }, v)
            case 'phone': return h('a', { className: 'kbtb-a', href: 'tel:' + v.replace(/[^+\d]/g, ''), onClick: stop }, v)
            case 'attachment': return typeof ctx.fileUrl === 'function' ? h(FileChips, { field, rec, ctx }) : h('span', { className: 'kbtb-files' }, svg('clip', 12), cellText(field, v, ctx))
            case 'number': case 'money': return h('span', { className: 'kbtb-num' }, cellText(field, v, ctx))
            default: return h('span', { className: 'kbtb-t' }, cellText(field, v, ctx))
          }
        }

        // ── popovers ────────────────────────────────────────────────────────────────────────────────────────────────────────
        /** The panel under a bar button: kept inside the window, and a bottom sheet on a phone (by the CSS). */
        const Pop = ({ label, cls, children }) => {
          const ref = useRef(null)
          useLayoutEffect(() => {
            const el = ref.current
            if (el === null) return
            try {
              el.style.translate = ''
              if (getComputedStyle(el).position === 'fixed') return // the narrow layout's sheet is placed by the CSS alone
              const r = el.getBoundingClientRect()
              const vw = document.documentElement.clientWidth
              // the page area, not the window: the sidebar is part of the window and a menu must not slide under it
              const root = el.closest('[data-kb="tables-page"]')
              const area = root === null ? null : root.getBoundingClientRect()
              const lo = Math.max(8, area === null ? 0 : area.left + 8)
              const hi = Math.min(vw - 8, area === null || area.right <= 0 ? vw : area.right - 8)
              const shift = r.left < lo ? lo - r.left : (r.right > hi ? hi - r.right : 0)
              // `translate`, not `transform`: the entrance animation holds `transform` (fill: both) and would undo it
              if (shift !== 0) el.style.translate = Math.round(shift) + 'px 0'
            } catch (e) { /* no layout: the CSS position stands */ }
          })
          return h('div', { ref, className: 'kbtb-pop ' + (cls || ''), role: 'dialog', 'aria-label': label }, children)
        }
        const PopHead = ({ title, reset, onReset }) => h('div', { className: 'kbtb-ph' }, h('h4', null, title), reset ? h('button', { type: 'button', className: 'kbtb-rst', onClick: onReset }, kt('Réinitialiser', 'Reset')) : null)
        const Btn = ({ icon, children, ...rest }) => h('button', Object.assign({ type: 'button' }, rest), icon ? svg(icon, 14) : null, children)

        // Views: choose one. Kaby makes, renames and removes them: a chat opens for that.
        const ViewsPop = ({ p }) => {
          const row = (v) => {
            const cur = v.id === p.view.id
            return h('div', { key: v.id, className: 'kbtb-vrow' + (cur ? ' cur' : '') },
              h('button', { type: 'button', className: 'kbtb-vsel', 'aria-current': cur ? 'true' : undefined, 'data-kb': 'tables-view-pick', onClick: () => p.selectView(v.id) },
                h('span', { className: 'kbtb-vk' }, svg(KIND_ICON[v.kind], 14)), h('span', { className: 'kbtb-vn' }, v.name),
                v.owner === 'kaby' ? h('span', { className: 'kbtb-made', title: kt('Créée par Kaby', 'Made by Kaby') }, svg('sparkle', 12)) : null),
              h('button', { type: 'button', className: 'kbtb-ib sm' + (v.fav ? ' on' : ''), 'aria-pressed': v.fav ? 'true' : 'false', 'data-kb': 'tables-view-fav', 'aria-label': v.fav ? kt('Retirer « ' + v.name + ' » de la barre', 'Remove “' + v.name + '” from the bar') : kt('Afficher « ' + v.name + ' » dans la barre', 'Show “' + v.name + '” in the bar'), title: v.fav ? kt('Dans la barre', 'In the bar') : kt('Afficher dans la barre', 'Show in the bar'), onClick: () => p.favView(v.id) }, svg('star', 14)))
          }
          return h('div', null,
            h(PopHead, { title: kt('Vues', 'Views') + ' · ' + p.views.length }),
            h('div', { className: 'kbtb-vlist' }, p.views.map(row)),
            h('div', { className: 'kbtb-psep' }),
            h('button', { type: 'button', className: 'kbtb-mi2', 'data-kb': 'tables-view-ask', onClick: () => p.askKaby() }, svg('sparkle', 15), kt('Nouvelle vue… (ouvre un chat avec Kaby)', 'New view… (opens a chat with Kaby)')),
            h('p', { className: 'kbtb-note faint' }, kt('Une vue est une façon enregistrée de regarder tes lignes : présentation, filtre, tri et champs. Elle ne change jamais les données. Kaby crée, renomme et retire les vues : demande-lui dans un chat.', 'A view is a saved way of looking at your rows: layout, filter, sort and fields. It never changes the data. Kaby makes, renames and removes views: ask in a chat.')))
        }

        // Fields: which ones this view shows (the title always stays).
        const FieldsPop = ({ p }) => {
          const [find, setFind] = useState('')
          const hidden = p.view.state.hidden
          const q = K.fold(find.trim())
          const list = p.obj.fields.filter((f) => q === '' || K.fold(f.label).includes(q))
          const toggle = (key) => p.editView((v) => { v.state.hidden = hidden.includes(key) ? hidden.filter((k) => k !== key) : hidden.concat([key]); return v })
          const setAll = (hide) => p.editView((v) => { v.state.hidden = hide ? p.obj.fields.filter((f) => f.key !== p.obj.title).map((f) => f.key) : []; return v })
          return h('div', null,
            h(PopHead, { title: kt('Champs', 'Fields') }),
            h('label', { className: 'kbtb-find' }, svg('search', 14), h('input', { type: 'search', value: find, 'aria-label': kt('Chercher un champ', 'Find a field'), placeholder: kt('Chercher un champ', 'Find a field'), onChange: (e) => setFind(e.target.value) })),
            h('div', { className: 'kbtb-frows' }, list.map((f) => {
              const lock = f.key === p.obj.title
              const on = !hidden.includes(f.key)
              return h('div', { key: f.key, className: 'kbtb-frow' }, h('span', { className: 'kbtb-fl' }, f.label),
                h('button', { type: 'button', role: 'switch', className: 'kbtb-sw' + (on ? ' on' : ''), 'aria-checked': on ? 'true' : 'false', 'aria-label': kt('Montrer ' + f.label, 'Show ' + f.label), disabled: lock, title: lock ? kt('Le titre est toujours affiché', 'The title is always shown') : undefined, 'data-kb': 'tables-field-switch', onClick: () => toggle(f.key) }, h('i')))
            })),
            h('div', { className: 'kbtb-cadd' }, h(Btn, { className: 'kbtb-pill', onClick: () => setAll(true) }, kt('Tout cacher', 'Hide all')), h(Btn, { className: 'kbtb-pill', onClick: () => setAll(false) }, kt('Tout montrer', 'Show all'))),
            h('p', { className: 'kbtb-note faint' }, kt('Vaut pour le tableau, les cartes et le kanban. Les champs existent pour toute la table ; ici tu choisis seulement ce que cette vue montre.', 'Applies to the table, the cards and the board. The fields exist for the whole table; here you only choose what this view shows.')))
        }

        // Filter: « In this view, show rows where … », one row per condition, one level of groups.
        const NumInput = ({ value, onChange }) => {
          const [text, setText] = useState(typeof value === 'number' ? String(value) : '')
          return h('input', { className: 'kbtb-inp', type: 'text', inputMode: 'decimal', value: text, placeholder: kt('Saisis un nombre', 'Enter a number'), 'aria-label': kt('Valeur', 'Value'), onChange: (e) => { const t = e.target.value; setText(t); const n = Number(t.replace(',', '.')); onChange(t.trim() !== '' && Number.isFinite(n) ? n : null) } })
        }
        /** The values a condition on a field can be about, `[{ v, l }]`: the options of a choice, the records of a link; none for a free value. */
        const choicesOf = (p, f) => {
          if (f.type === 'choice' || f.type === 'multichoice') return (f.options || []).map((o) => ({ v: o.key, l: o.label }))
          if (f.type === 'relation') {
            const target = p.db.objects.find((o) => o.key === f.to)
            const rows = p.related[f.to]
            return target && Array.isArray(rows) ? rows.map((r) => ({ v: r.id, l: titleOf(target, r) })) : []
          }
          return null
        }
        const uiOps = (f) => K.opsFor(f).filter((op) => !(f.type === 'person' && (op === 'in' || op === 'nin')))
        const ValueCell = ({ p, f, c, path, open, setOpen }) => {
          const kind = valueKind(f, c.op)
          const set = (v) => p.setFlt(mapAt(p.flt, path, () => ({ k: c.k, op: c.op, v })))
          const choices = choicesOf(p, f)
          switch (kind) {
            case 'text': return h('input', { className: 'kbtb-inp', type: 'text', value: typeof c.v === 'string' ? c.v : '', placeholder: kt('Saisis une valeur', 'Enter a value'), 'aria-label': kt('Valeur', 'Value'), onChange: (e) => set(e.target.value) })
            case 'number': return h(NumInput, { value: c.v, onChange: set })
            case 'day': {
              const exact = plain(c.v) && typeof c.v.d === 'string'
              const n = plain(c.v) && typeof c.v.n === 'number' ? c.v.n : 0
              const days = DATE_PRESETS.includes(n) ? DATE_PRESETS : DATE_PRESETS.concat([n])
              return h('div', { className: 'kbtb-cv2' },
                h('select', { className: 'kbtb-sel', 'aria-label': kt('Valeur', 'Value'), value: exact ? 'exact' : 'n:' + n, onChange: (e) => (e.target.value === 'exact' ? set({ d: p.ctx.today }) : set({ n: Number(e.target.value.slice(2)) })) },
                  days.map((d) => h('option', { key: d, value: 'n:' + d }, relDay(d))), h('option', { value: 'exact' }, kt('une date précise', 'a given date'))),
                exact ? h('input', { className: 'kbtb-inp', type: 'date', value: c.v.d, 'aria-label': kt('Date', 'Date'), onChange: (e) => { if (e.target.value !== '') set({ d: e.target.value }) } }) : null)
            }
            case 'within': return h('select', { className: 'kbtb-sel', 'aria-label': kt('Valeur', 'Value'), value: c.v, onChange: (e) => set(e.target.value) }, K.WITHIN.map((w) => h('option', { key: w, value: w }, WITHIN_TEXT()[w])))
            case 'one':
              if (choices === null) return h('input', { className: 'kbtb-inp', type: 'text', value: typeof c.v === 'string' ? c.v : '', placeholder: kt('Saisis une valeur', 'Enter a value'), 'aria-label': kt('Valeur', 'Value'), onChange: (e) => set(e.target.value) })
              return h('select', { className: 'kbtb-sel', 'aria-label': kt('Valeur', 'Value'), value: typeof c.v === 'string' ? c.v : '', onChange: (e) => set(e.target.value) }, h('option', { value: '' }, kt('Choisir…', 'Select…')), choices.map((x) => h('option', { key: x.v, value: x.v }, x.l)))
            case 'list': {
              const list = Array.isArray(c.v) ? c.v : []
              const names = list.map((v) => (choices || []).find((x) => x.v === v)).filter(Boolean).map((x) => x.l)
              const toggle = (v) => set(list.includes(v) ? list.filter((x) => x !== v) : list.concat([v]))
              return h('div', { className: 'kbtb-cv2 col' },
                h('button', { type: 'button', className: 'kbtb-sel mv', 'aria-expanded': open === path ? 'true' : 'false', 'aria-label': kt('Valeurs : ', 'Values: ') + (names.join(', ') || kt('aucune', 'none')), onClick: () => setOpen(open === path ? null : path) }, h('span', { className: names.length ? '' : 'ph0' }, names.join(', ') || kt('Choisir…', 'Select…')), svg('chevD', 12)),
                open === path ? h('div', { className: 'kbtb-mlist', role: 'group' }, (choices || []).length === 0 ? h('p', { className: 'kbtb-note' }, kt('Rien à choisir pour l’instant.', 'Nothing to choose yet.'))
                  : choices.map((x) => { const on = list.includes(x.v); return h('button', { key: x.v, type: 'button', className: 'kbtb-oi' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onClick: () => toggle(x.v) }, on ? svg('check', 13) : h('span', { className: 'ck' }), h('span', null, x.l)) })) : null)
            }
            default: return null
          }
        }
        const FilterPop = ({ p }) => {
          const [open, setOpen] = useState(null)
          const fields = filterable(p.obj)
          const flt = p.flt
          const total = flt.items.length
          const lead = (g, i, gp) => {
            if (i === 0) return h('span', { className: 'kbtb-cl' }, kt('Où', 'Where'))
            if (i === 1) return h('select', { className: 'kbtb-sel cl', value: g.conj, 'aria-label': kt('Relier les conditions par', 'Combine the conditions with'), onChange: (e) => p.setFlt(gp === '' ? Object.assign({}, flt, { conj: e.target.value }) : mapAt(flt, gp, (x) => Object.assign({}, x, { conj: e.target.value }))) }, h('option', { value: 'and' }, conjText('and')), h('option', { value: 'or' }, conjText('or')))
            return h('span', { className: 'kbtb-cl' }, conjText(g.conj))
          }
          const cond = (c, path, ld) => {
            const f = fieldOf(p.obj, c.k)
            return h('div', { key: path, className: 'kbtb-crow', 'data-kb': 'tables-cond', 'data-path': path },
              ld,
              h('select', { className: 'kbtb-sel cf', value: c.k, 'aria-label': kt('Champ', 'Field'), onChange: (e) => p.setFlt(mapAt(flt, path, () => newCondition(fieldOf(p.obj, e.target.value)))) }, fields.map((x) => h('option', { key: x.key, value: x.key }, x.label))),
              h('select', { className: 'kbtb-sel co', value: c.op, 'aria-label': kt('Opérateur', 'Operator'), onChange: (e) => p.setFlt(mapAt(flt, path, () => withOp(f, c, e.target.value))) }, uiOps(f).map((op) => h('option', { key: op, value: op }, opLabel(f, op)))),
              h('div', { className: 'kbtb-cv' }, h(ValueCell, { p, f, c, path, open, setOpen })),
              h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-label': kt('Retirer cette condition', 'Remove this condition'), onClick: () => p.setFlt(removeAt(flt, path)) }, svg('x', 14)))
          }
          const group = (g, path, ld) => h('div', { key: path, className: 'kbtb-crow grow', 'data-kb': 'tables-group', 'data-path': path },
            ld,
            h('div', { className: 'kbtb-cgrp', role: 'group', 'aria-label': kt('Groupe de conditions', 'Condition group') },
              g.items.map((c, j) => cond(c, path + '.' + j, lead(g, j, path))),
              h('div', null, h('button', { type: 'button', className: 'kbtb-lnkadd', onClick: () => p.setFlt(addItem(flt, path, newCondition(fields[0]))) }, svg('plus', 13), kt('Ajouter une condition', 'Add condition')))),
            h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-label': kt('Supprimer ce groupe', 'Delete this group'), onClick: () => p.setFlt(removeAt(flt, path)) }, svg('trash', 14)))
          if (fields.length === 0) return h('div', null, h(PopHead, { title: kt('Filtre', 'Filter') }), h('p', { className: 'kbtb-note' }, kt('Aucun champ ne peut filtrer.', 'No field can filter.')))
          return h('div', null,
            h(PopHead, { title: kt('Filtre', 'Filter'), reset: total > 0, onReset: () => p.setFlt(K.blankFilter()) }),
            total > 0
              ? h('div', null, h('p', { className: 'kbtb-note' }, kt('Dans cette vue, montrer les lignes', 'In this view, show the rows')), h('div', { className: 'kbtb-clist' }, flt.items.map((it, i) => (K.isGroup(it) ? group(it, String(i), lead(flt, i, '')) : cond(it, String(i), lead(flt, i, ''))))))
              : h('p', { className: 'kbtb-note' }, kt('Aucune condition : toutes les lignes sont montrées.', 'No condition: every row is shown.')),
            h('div', { className: 'kbtb-cadd' },
              h('button', { type: 'button', className: 'kbtb-lnkadd', 'data-kb': 'tables-cond-add', onClick: () => p.setFlt(addItem(flt, '', newCondition(fields[0]))) }, svg('plus', 13), kt('Ajouter une condition', 'Add condition')),
              h('button', { type: 'button', className: 'kbtb-lnkadd', 'data-kb': 'tables-group-add', onClick: () => p.setFlt(addItem(flt, '', { conj: 'and', items: [newCondition(fields[0])] })) }, svg('plus', 13), kt('Ajouter un groupe', 'Add condition group'))),
            h('p', { className: 'kbtb-note faint' }, kt('Ou dis-le en une phrase : ', 'Or say it in a line: '), h('button', { type: 'button', className: 'kbtb-lnk', 'data-kb': 'tables-filter-ask', onClick: () => p.askKaby() }, kt('demande à Kaby', 'ask Kaby'))))
        }

        // Sort: up to three, each with a direction in the words of its type.
        const SortPop = ({ p }) => {
          const sorts = p.view.state.sorts
          const fields = sortableFields(p.obj)
          const used = sorts.map((s) => s.k)
          const set = (next) => p.editView((v) => { v.state.sorts = next; return v })
          const row = (s, i) => {
            const f = fieldOf(p.obj, s.k)
            const dl = dirLabels(f)
            return h('div', { key: i, className: 'kbtb-srow', 'data-kb': 'tables-sort-row' },
              h('select', { className: 'kbtb-sel', value: s.k, 'aria-label': kt('Tri ' + (i + 1) + ' : champ', 'Sort ' + (i + 1) + ': field'), onChange: (e) => set(sorts.map((x, j) => (j === i ? { k: e.target.value, dir: x.dir } : x))) }, fields.filter((x) => x.key === s.k || !used.includes(x.key)).map((x) => h('option', { key: x.key, value: x.key }, x.label))),
              h('select', { className: 'kbtb-sel', value: s.dir, 'aria-label': kt('Tri ' + (i + 1) + ' : sens', 'Sort ' + (i + 1) + ': direction'), onChange: (e) => set(sorts.map((x, j) => (j === i ? { k: x.k, dir: e.target.value } : x))) }, h('option', { value: 'asc' }, dl[0]), h('option', { value: 'desc' }, dl[1])),
              h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-label': kt('Retirer ce tri', 'Remove this sort'), onClick: () => set(sorts.filter((_, j) => j !== i)) }, svg('x', 14)))
          }
          const free = fields.find((f) => !used.includes(f.key))
          return h('div', null,
            h(PopHead, { title: kt('Trier par', 'Sort by'), reset: sorts.length > 0, onReset: () => set([]) }),
            sorts.length ? sorts.map(row) : h('p', { className: 'kbtb-note' }, kt('Aucun tri : les changements les plus récents d’abord.', 'No sort: the latest changes come first.')),
            h('div', { className: 'kbtb-cadd' }, sorts.length < K.SORT_MAX && free ? h('button', { type: 'button', className: 'kbtb-lnkadd', 'data-kb': 'tables-sort-add', onClick: () => set(sorts.concat([{ k: free.key, dir: 'asc' }])) }, svg('plus', 13), sorts.length ? kt('Ajouter un autre tri', 'Add another sort') : kt('Ajouter un tri', 'Add a sort')) : h('span', { className: 'kbtb-note faint' }, sorts.length >= K.SORT_MAX ? kt('Trois tris au plus.', 'Three sorts at most.') : '')),
            p.view.kind === 'table' ? h('p', { className: 'kbtb-note faint' }, kt('Dans le tableau, clique sur un titre de colonne pour trier dessus ; Maj-clic ajoute un deuxième tri.', 'In the table, click a column heading to sort by it; Shift-click adds a second sort.')) : null)
        }

        // The bar: the views, then Views / Fields / Filter / Sort and the table's own menu. It sits in the product toolbar's trailing slot. Nothing here changes a row: Kaby does that.
        const MenuButton = ({ p, id, icon, label, badge, cls, tip, children }) => {
          const open = p.menu === id
          return h('span', { className: 'kbtb-pw' },
            h('button', { type: 'button', className: 'kbtb-tp' + (cls || '') + (badge ? ' on' : '') + (open ? ' open' : ''), 'data-kb': 'tables-menu-' + id, 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false', 'aria-label': label + (badge ? ', ' + badge + ' ' + kt('actif', 'active') : ''), title: tip, onClick: () => p.setMenu(open ? null : id) },
              svg(icon, 15), h('span', { className: 'kbtb-tl' }, label), badge ? h('span', { className: 'kbtb-badge' }, badge) : null),
            open ? h(Pop, { label, cls: id }, children) : null)
        }
        /** A menu of single actions (a ⋯ button and its list): each item is `{ id, icon, label, danger, hint }`, `onPick(id)` runs it. */
        const ActionMenu = ({ p, id, label, items, onPick, hook, head, wrap }) => {
          const open = p.menu === id
          return h('span', { className: 'kbtb-pw' + (wrap ? ' ' + wrap : '') },
            h('button', { type: 'button', className: 'kbtb-ib' + (open ? ' open' : ''), 'data-kb': hook, 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false', 'aria-label': label, title: label, onClick: (e) => { stop(e); p.setMenu(open ? null : id) } }, svg('dots', 18)),
            open ? h(Pop, { label, cls: 'sm' },
              head || null,
              items.map((it) => (it.sep ? h('div', { key: it.id, className: 'kbtb-psep' })
                : it.hint ? h('p', { key: it.id, className: 'kbtb-note faint' }, it.hint)
                  : it.locked ? h('button', { key: it.id, type: 'button', role: 'menuitem', 'aria-disabled': 'true', className: 'kbtb-mi2 dis', 'data-kb': hook + '-' + it.id, title: kt('Arrête la publication pour changer cela', 'Unpublish to change this'), onClick: stop }, svg(it.icon, 15), it.label, h('span', { className: 'kbtb-why' }, it.locked))
                    : h('button', { key: it.id, type: 'button', role: 'menuitem', className: 'kbtb-mi2' + (it.danger ? ' bad' : ''), 'data-kb': hook + '-' + it.id, onClick: (e) => { stop(e); p.setMenu(null); onPick(it.id) } }, svg(it.icon, 15), it.label)))) : null)
        }
        const TableMenu = ({ p }) => h(ActionMenu, { p, id: 'topt', hook: 'tables-menu-topt', label: kt('Options de la table', 'Table options'), onPick: (id) => (id === 'ask' ? p.askKaby() : p.confirmArchive(p.db.id, p.obj.key)),
          items: [{ id: 'ask', icon: 'sparkle', label: kt('Demander à Kaby au sujet de cette table', 'Ask Kaby about this table') }, { id: 'sep', sep: true }, { id: 'archive', icon: 'archive', label: kt('Ranger la table…', 'Archive table…') }] })
        const Bar = ({ p }) => {
          const nCond = countConditions(p.view.state.flt)
          const shown = barViews(p.views, p.view.id)
          const kindOf = p.view.kind
          return h('div', { className: 'kbtb-bar', 'data-kb': 'tables-bar' },
            h('div', { className: 'kbtb-vgrp', role: 'group', 'aria-label': kt('Vues', 'Views') }, shown.map((v) => h('button', { key: v.id, type: 'button', className: 'kbtb-vbtn', 'aria-pressed': v.id === p.view.id ? 'true' : 'false', 'data-kb': 'tables-view', 'data-view': v.id, title: v.name, onClick: () => p.selectView(v.id) }, svg(KIND_ICON[v.kind], 15), h('span', { className: 'kbtb-vl' }, v.name)))),
            h(MenuButton, { p, id: 'views', icon: 'table', label: kt('Vues', 'Views'), badge: p.views.length > 1 ? String(p.views.length) : '', tip: kt('Toutes les vues', 'All views') }, h(ViewsPop, { p })),
            kindOf === 'calendar' ? null : h(MenuButton, { p, id: 'fields', icon: 'eye', label: kt('Champs', 'Fields'), badge: p.view.state.hidden.length ? String(p.view.state.hidden.length) : '', tip: kt('Choisir les champs que tu vois', 'Choose which fields you see') }, h(FieldsPop, { p })),
            h(MenuButton, { p, id: 'filter', icon: 'filter', label: kt('Filtre', 'Filter'), badge: nCond ? String(nCond) : '', tip: kt('Filtrer cette vue', 'Filter this view') }, h(FilterPop, { p })),
            h(MenuButton, { p, id: 'sort', icon: 'sort', label: kt('Tri', 'Sort'), badge: p.view.state.sorts.length ? String(p.view.state.sorts.length) : '', tip: kt('Trier cette vue', 'Sort this view') }, h(SortPop, { p })),
            h(TableMenu, { p }))
        }

        // ── the four views ──────────────────────────────────────────────────────────────────────────────────────────────────
        const PAGE_STEP = 200 // rows drawn at a time: the host sends up to 5,000, the DOM does not need them all at once
        const rowWord = (n) => plural(n, 'ligne', 'lignes', 'row', 'rows')
        const MoreRows = ({ shown, total, onMore }) => (shown >= total ? null : h('div', { className: 'kbtb-pager' }, h('span', null, shown + ' / ' + total),
          h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'tables-more', onClick: onMore }, kt('Afficher la suite', 'Show more'))))

        const TableView = ({ p }) => {
          const [limit, setLimit] = useState(PAGE_STEP)
          useEffect(() => { setLimit(PAGE_STEP) }, [p.view.id, p.obj.key, p.query])
          const hidden = p.view.state.hidden
          const title = p.obj.fields.find((f) => f.key === p.obj.title)
          const cols = [title].concat(p.obj.fields.filter((f) => f.key !== p.obj.title && !hidden.includes(f.key)))
          const sorts = p.view.state.sorts
          const conds = K.flatConditions(p.view.state.flt).filter((c) => !K.isGroup(c))
          const th = (f) => {
            const i = sorts.findIndex((s) => s.k === f.key)
            const s = sorts[i]
            const num = f.type === 'number' || f.type === 'money'
            const filtered = conds.some((c) => c.k === f.key)
            const ind = s ? [svg(s.dir === 'asc' ? 'up' : 'down', 12), sorts.length > 1 ? h('span', { key: 'n', className: 'kbtb-sn' }, String(i + 1)) : null] : null
            return h('th', { key: f.key, className: num ? 'num' : '', scope: 'col', 'aria-sort': s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
              h('span', { className: 'kbtb-th' },
                K.isSortable(f)
                  ? h('button', { type: 'button', className: 'kbtb-thb', 'data-kb': 'tables-th-sort', title: kt('Trier par ' + f.label + '. Maj-clic l’ajoute au tri.', 'Sort by ' + f.label + '. Shift-click adds it to the sort.'), onClick: (e) => p.sortBy(f.key, e.shiftKey === true) }, f.protection !== 'normal' ? svg('lock', 11) : null, f.label, ind)
                  : h('span', { className: 'kbtb-thb static' }, f.protection !== 'normal' ? svg('lock', 11) : null, f.label),
                K.opsFor(f).length > 0 ? h('button', { type: 'button', className: 'kbtb-thf' + (filtered ? ' on' : ''), 'data-kb': 'tables-th-filter', 'aria-label': kt('Filtrer par ' + f.label, 'Filter by ' + f.label), title: kt('Filtrer par ' + f.label, 'Filter by ' + f.label), onClick: () => p.filterBy(f.key) }, svg('filter', 11)) : null))
          }
          const shown = p.rows.slice(0, limit)
          return h('div', null,
            h('div', { className: 'kbtb-tblwrap' }, h('table', { className: 'kbtb-tbl', 'data-kb': 'tables-table' },
              h('thead', null, h('tr', null, cols.map(th))),
              h('tbody', null, shown.map((r) => h('tr', { key: r.id, className: p.drawer && p.drawer.id === r.id ? 'sel' : '', 'data-kb': 'tables-row', 'data-id': r.id, onClick: () => p.openRecord(r.id) },
                cols.map((f) => (f.key === p.obj.title
                  ? h('td', { key: f.key, className: 'ti' }, h('button', { type: 'button', 'data-kb': 'tables-open', title: titleOf(p.obj, r), onClick: (e) => { stop(e); p.openRecord(r.id) } }, titleOf(p.obj, r)))
                  : h('td', { key: f.key, className: f.type === 'number' || f.type === 'money' ? 'num' : '' }, h(Cell, { field: f, rec: r, ctx: p.ctx }))))))))),
            h(MoreRows, { shown: shown.length, total: p.rows.length, onMore: () => setLimit((n) => n + PAGE_STEP) }))
        }

        const metaFields = (p, skip, max) => p.obj.fields.filter((f) => f.key !== p.obj.title && !skip.includes(f.key) && !p.view.state.hidden.includes(f.key) && f.protection !== 'secret' && f.type !== 'longtext' && f.type !== 'attachment').slice(0, max)

        const BoardView = ({ p }) => {
          const by = p.obj.fields.find((f) => f.key === p.view.by)
          if (!by) return null
          const cols = boardColumns(by, p.rows)
          const meta = metaFields(p, [by.key], 3)
          const sum = totalField(p.obj, p.view.state.hidden)
          return h('div', { className: 'kbtb-board', 'data-kb': 'tables-board' }, cols.map((col) => {
            const hue = hueOfColor(col.color)
            const total = sum === undefined ? null : columnTotal(sum, col.rows)
            return h('div', { key: col.key === '' ? '__none' : col.key, className: 'kbtb-col', 'data-col': col.key },
              h('div', { className: 'kbtb-colh' }, h('i', { className: 'kbtb-dot' + (hue === null ? '' : ' hue'), style: hue === null ? undefined : { '--kbtb-h': hue }, 'aria-hidden': 'true' }), h('span', { className: 'kbtb-colt' }, col.label), h('span', { className: 'kbtb-colc' }, String(col.rows.length)),
                total === null ? null : h('span', { className: 'kbtb-colv', 'data-kb': 'tables-col-total', title: kt('Total : ', 'Total: ') + sum.label }, fmtMoney(sum, total))),
              col.rows.map((r) => h('div', { key: r.id, className: 'kbtb-bcard', role: 'button', tabIndex: 0, 'data-kb': 'tables-card', 'data-id': r.id,
                onClick: () => p.openRecord(r.id),
                onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); p.openRecord(r.id) } } },
              h('div', { className: 'kbtb-bt' }, titleOf(p.obj, r)),
              meta.length ? h('div', { className: 'kbtb-bm' }, meta.map((f) => h(Cell, { key: f.key, field: f, rec: r, ctx: p.ctx }))) : null)))
          }))
        }

        const CardsView = ({ p }) => {
          const [limit, setLimit] = useState(PAGE_STEP)
          useEffect(() => { setLimit(PAGE_STEP) }, [p.view.id, p.obj.key, p.query])
          const tone = p.obj.fields.find((f) => f.type === 'choice' && f.protection !== 'secret')
          const lines = metaFields(p, tone ? [tone.key] : [], 3)
          const shown = p.rows.slice(0, limit)
          return h('div', null,
            h('div', { className: 'kbtb-cards', 'data-kb': 'tables-cards' }, shown.map((r) => {
              const o = tone ? optionOf(tone, r.values[tone.key]) : undefined
              const hue = o ? hueOfColor(o.color) : null
              const name = titleOf(p.obj, r)
              const pic = typeof p.ctx.fileUrl === 'function' ? pictureOf(p.obj, r, p.view.state.hidden) : null
              const src = pic === null ? null : p.ctx.fileUrl(pic.field, r, pic.file)
              const letter = Array.from(name)[0].toUpperCase()
              const hueCls = hue === null ? '' : ' hue'
              const tint = hue === null ? undefined : { '--kbtb-h': hue }
              const lead = p.view.cover === true
                ? h('span', { className: 'kbtb-cv', 'data-kb': 'tables-cover' }, src !== null ? h(Thumb, { src, cls: 'kbtb-cimg' }) : h('span', { className: 'kbtb-cimg ph' + hueCls, style: tint, 'aria-hidden': 'true' }, letter))
                : src !== null
                  ? h(Thumb, { src, cls: 'kbtb-im pic' })
                  : h('span', { className: 'kbtb-im' + hueCls, style: tint, 'aria-hidden': 'true' }, letter)
              return h('button', { key: r.id, type: 'button', className: 'kbtb-tile' + (p.view.cover === true ? ' cov' : ''), 'data-kb': 'tables-card', 'data-id': r.id, onClick: () => p.openRecord(r.id) },
                lead,
                h('span', { className: 'kbtb-tb' }, h('span', { className: 'kbtb-tt' }, name),
                  tone && !empty(r.values[tone.key]) ? h('span', null, h(Cell, { field: tone, rec: r, ctx: noOpen(p.ctx) })) : null,
                  lines.map((f) => (empty(r.values[f.key]) && f.type !== 'checkbox' ? null : h('span', { key: f.key, className: 'kbtb-tl2' }, h('span', { className: 'kbtb-k' }, f.label), h(Cell, { field: f, rec: r, ctx: noOpen(p.ctx) }))))))
            })),
            h(MoreRows, { shown: shown.length, total: p.rows.length, onMore: () => setLimit((n) => n + PAGE_STEP) }))
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
          const blocks = useMemo(() => townBlocks(props.seed), [props.seed])
          // the canvas has the shape of its box (1000 units wide), so the pins fill it and a pin keeps the size of a finger whatever the box is
          const H = size.w > 0 && size.h > 0 ? Math.max(480, Math.min(1500, Math.round(GEO_W * size.h / size.w))) : GEO_H
          const px = size.w > 0 ? GEO_W / size.w : 1
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
          const zoom = (f) => setCam((c) => { const k = Math.min(4, Math.max(0.8, c.k * f)); return { k, tx: GEO_W / 2 - (GEO_W / 2 - c.tx) * (k / c.k), ty: dims.current.H / 2 - (dims.current.H / 2 - c.ty) * (k / c.k) } })
          useEffect(() => {
            const el = box.current
            if (el === null) return undefined
            const wheel = (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15) }
            el.addEventListener('wheel', wheel, { passive: false })
            return () => el.removeEventListener('wheel', wheel)
          }, [])
          const unit = () => px
          const down = (e) => { if (e.target.closest !== undefined && e.target.closest('.kbtb-pin') !== null) return; grab.current = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty }; setDrag(true); try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* no capture: the drag stops at the edge */ } }
          const move = (e) => { const g = grab.current; if (g === null) return; const u = unit(); setCam((c) => Object.assign({}, c, { tx: g.tx + (e.clientX - g.x) * u, ty: g.ty + (e.clientY - g.y) * u })) }
          const up = () => { grab.current = null; setDrag(false) }
          const pins = projectPins(props.placed, GEO_W, H)
          const lit = (pin) => pin.row.id === props.hot || pin.row.id === props.selected
          const pinOf = (pin, ghost) => {
            const row = pin.row
            const label = row.label
            const w = Math.max(46, Math.round(label.length * 8.4 + 22))
            const on = lit(pin)
            const x = Math.round((pin.x * cam.k + cam.tx) * 10) / 10
            const y = Math.round((pin.y * cam.k + cam.ty) * 10) / 10
            const pick = () => props.onPick(row)
            if (ghost === true) return h('g', { key: 'g' + row.id, className: 'kbtb-pin on ghost', transform: 'translate(' + x + ' ' + y + ') scale(' + px + ')', 'aria-hidden': 'true', style: { pointerEvents: 'none' } }, h('g', { className: 'body' }, h('path', { className: 'tail', d: 'M-6 -4 L0 7 L6 -4 Z' }), h('rect', { className: 'bubble', x: -w / 2, y: -28, width: w, height: 25, rx: 12.5 }), h('text', { y: -10 }, label)))
            return h('g', { key: row.id, className: 'kbtb-pin' + (on ? ' on' : ''), transform: 'translate(' + x + ' ' + y + ') scale(' + px + ')', tabIndex: 0, role: 'button', 'data-kb': 'tables-pin', 'data-id': row.id, 'aria-label': row.title + (row.amount === '' ? '' : ', ' + row.amount), 'aria-pressed': row.id === props.selected ? 'true' : 'false', onClick: pick, onKeyDown: onActivate(pick), onMouseEnter: () => props.onHover(row.id), onMouseLeave: () => props.onHover(null), onFocus: () => props.onHover(row.id), onBlur: () => props.onHover(null) },
              h('g', { className: 'body' }, h('path', { className: 'tail', d: 'M-6 -4 L0 7 L6 -4 Z' }), h('rect', { className: 'bubble', x: -w / 2, y: -28, width: w, height: 25, rx: 12.5 }), h('text', { y: -10 }, label)))
          }
          const why = props.why === undefined ? '' : props.why
          return h('div', { className: 'kbtb-geo', 'data-kb': 'tables-map-box', 'data-map': 'drawn' },
            h('svg', { ref: box, className: 'kbtb-drawn' + (drag ? ' drag' : ''), 'data-map': 'drawn', viewBox: '0 0 ' + GEO_W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': kt('Carte schématique des lignes', 'Schematic map of the rows'), 'data-kb': 'tables-map', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
              h('g', { transform: 'translate(' + cam.tx + ' ' + cam.ty + ') scale(' + cam.k + ')' },
                h('rect', { className: 'land', x: -2000, y: -1500, width: 5000, height: 4000 }),
                blocks.map((b, i) => h('rect', { key: i, className: b.park ? 'park' : 'block', x: b.x, y: b.y, width: b.w, height: b.h, rx: b.park ? 22 : 7 })),
                h('path', { className: 'street', d: 'M-600 ' + Math.round(H * 0.17) + ' L1700 ' + Math.round(H * 0.72), strokeWidth: 15 }), h('path', { className: 'street', d: 'M330 -400 L610 ' + (H + 400), strokeWidth: 15 }),
                h('path', { className: 'water', d: 'M-900 ' + (H - 30) + ' C -300 ' + (H - 70) + ' 200 ' + (H - 14) + ' 480 ' + (H - 44) + ' S 1000 ' + (H - 12) + ' 1900 ' + (H - 52) + ' L1900 ' + (H + 1200) + ' L-900 ' + (H + 1200) + ' Z' }),
                h('path', { className: 'river', d: 'M1200 -420 C 1000 ' + Math.round(H * 0.03) + ' 900 ' + Math.round(H * 0.24) + ' 790 ' + Math.round(H * 0.42) + ' S 610 ' + Math.round(H * 0.74) + ' 520 ' + (H - 34), strokeWidth: 24 })),
              pins.map((pin) => pinOf(pin, false)), pins.filter(lit).map((pin) => pinOf(pin, true))),
            h(MapControls, { onIn: () => zoom(1.4), onOut: () => zoom(1 / 1.4), onFit: () => setCam({ k: 1, tx: 0, ty: 0 }) }),
            h(MapNote, { lead: kt('Carte schématique', 'Schematic map'), placed: props.placed.length, unplaced: props.unplaced },
              whyText(why) !== '' ? h('span', { 'data-kb': 'tables-map-why', 'data-why': why }, ' · ' + whyText(why)) : null,
              props.onRetry === undefined ? null : h('button', { type: 'button', className: 'kbtb-geolink', 'data-kb': 'tables-map-retry', onClick: props.onRetry }, svg('refresh', 12), kt('Réessayer', 'Try again'))))
        }
        // ── the real map: loading and the page parts ──────────────────────────────────────────────────────────────────────────────────
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
            for (const node of [link, script]) { node.setAttribute('data-plugin', '@local/kybernos-db'); node.onload = done; node.onerror = () => reject(new Error('map file')); made.push(node); document.head.appendChild(node) }
          })
          mapLibPromise.catch(() => { mapLibPromise = null; for (const node of made) { try { node.remove() } catch (e) { /* already gone */ } } })
          return mapLibPromise
        }
        /** The style of a theme as OpenFreeMap serves it (a promise), asked once per page load and per style; no cookie and no referrer go with the request. */
        const loadMapStyle = (id, signal) => {
          const url = mapStyleUrl(id)
          if (mapStyleCache[url] === undefined) {
            const asked = (async () => {
              const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal })
              if (!res.ok) throw new Error('map style ' + res.status)
              const json = await res.json()
              if (json === null || typeof json !== 'object' || !Array.isArray(json.layers)) throw new Error('map style shape')
              return json
            })()
            mapStyleCache[url] = asked
            asked.catch(() => { if (mapStyleCache[url] === asked) delete mapStyleCache[url] })
          }
          return mapStyleCache[url]
        }
        const hasWebGL = () => {
          if (webglKnown === null) { try { const c = document.createElement('canvas'); webglKnown = !!(c.getContext('webgl2') || c.getContext('webgl')) } catch (e) { webglKnown = false } }
          return webglKnown
        }
        const inBackground = () => { try { return document.visibilityState === 'hidden' } catch (e) { return false } }
        const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
        const mapDecision = (count) => mapGate({ placed: count, webgl: hasWebGL(), online: typeof navigator === 'undefined' || navigator.onLine !== false, failure: mapFailure, now: Date.now() })
        /** The page's tokens, resolved where the map sits, as [r, g, b] each (a canvas turns any CSS colour into numbers); null when the page cannot say. */
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
              const raw = style.getPropertyValue('--kbtb-' + k).trim()
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
          const root = domNode('button', 'kbtb-rp')
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
          pin.root.setAttribute('data-kb', one ? 'tables-pin' : 'tables-cluster')
          if (one) pin.root.setAttribute('data-id', String(row.id)); else pin.root.removeAttribute('data-id')
          pin.pill.textContent = one ? row.label : String(cluster.count)
          pin.root.setAttribute('aria-label', one ? row.title + (row.amount === '' ? '' : ', ' + row.amount) : cluster.count + kt(' lignes ici : zoomer', ' rows here: zoom in'))
          if (!one) pin.root.removeAttribute('aria-pressed')
        }

        /**
         * The theme menu of the real map: a button under the others that opens a small menu of radio items (the arrows, Home and End move, Enter or a click picks, Escape closes and the
         * focus goes back to the button, Tab leaves). `props.choice` is the theme in use, `props.failed` says the last pick could not be had.
         */
        const MapThemes = (props) => {
          const [open, setOpen] = useState(false)
          const btn = useRef(null)
          const menu = useRef(null)
          const items = () => (menu.current === null ? [] : Array.prototype.slice.call(menu.current.querySelectorAll('[role="menuitemradio"]')))
          const close = (back) => { setOpen(false); if (back) { try { btn.current.focus() } catch (e) { /* no button to focus */ } } }
          useEffect(() => {
            if (!open) return undefined
            const list = items()
            const here = list.find((e) => e.getAttribute('aria-checked') === 'true') || list[0]
            try { if (here !== undefined) here.focus() } catch (e) { /* the person clicks */ }
            const away = (e) => { if (menu.current !== null && !menu.current.contains(e.target) && btn.current !== null && !btn.current.contains(e.target)) setOpen(false) }
            document.addEventListener('pointerdown', away, true)
            return () => document.removeEventListener('pointerdown', away, true)
          }, [open])
          useEffect(() => { if (props.failed) setOpen(true) }, [props.failed]) // a theme that could not be had says so where the person is looking
          const onKey = (e) => {
            const list = items()
            const at = list.indexOf(document.activeElement)
            const go = (i) => { e.preventDefault(); try { list[(i + list.length) % list.length].focus() } catch (err) { /* no item */ } }
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(at + 1)
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(at - 1)
            else if (e.key === 'Home') go(0)
            else if (e.key === 'End') go(list.length - 1)
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) } else if (e.key === 'Tab') close(false)
          }
          const name = kt('Thème de la carte', 'Map theme')
          return h(React.Fragment, null,
            h('button', { type: 'button', ref: btn, 'data-kb': 'tables-map-theme', 'aria-label': name, title: name, 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false', disabled: props.disabled === true, onClick: () => setOpen(!open) }, svg('layers', 16)),
            open ? h('div', { ref: menu, className: 'kbtb-geothemes', role: 'menu', 'aria-label': name, 'data-kb': 'tables-map-themes', onKeyDown: onKey },
              MAP_STYLES.map((m) => h('button', { key: m.id, type: 'button', role: 'menuitemradio', 'aria-checked': m.id === props.choice ? 'true' : 'false', tabIndex: m.id === props.choice ? 0 : -1, 'data-kb': 'tables-map-theme-' + m.id, onClick: () => { close(true); props.onChoose(m.id) } },
                h('span', null, kt(m.label[0], m.label[1])), m.id === props.choice ? svg('check', 14) : null)),
              props.failed ? h('p', { className: 'kbtb-geothemes-note', role: 'alert', 'data-kb': 'tables-map-theme-failed' }, kt('Ce thème n’a pas pu être chargé.', 'This theme could not be loaded.')) : null) : null)
        }
        /** The zoom and fit buttons, the same for the real map and the drawn one; the real map adds the theme button (`props.themes`). */
        const MapControls = (props) => h('div', { className: 'kbtb-geoctl' },
          h('button', { type: 'button', 'data-kb': 'tables-map-zoom-in', 'aria-label': kt('Zoom avant', 'Zoom in'), title: kt('Zoom avant', 'Zoom in'), onClick: props.onIn }, svg('plus', 16)),
          h('button', { type: 'button', 'data-kb': 'tables-map-zoom-out', 'aria-label': kt('Zoom arrière', 'Zoom out'), title: kt('Zoom arrière', 'Zoom out'), onClick: props.onOut }, svg('minus', 16)),
          h('button', { type: 'button', 'data-kb': 'tables-map-fit', 'aria-label': kt('Tout voir', 'Show everything'), title: kt('Tout voir', 'Show everything'), onClick: props.onFit }, svg('fit', 16)),
          props.themes === undefined ? null : h(MapThemes, props.themes))
        /** The caption of a map: what it is (the drawn one says so), how many places, how many items have none. */
        const MapNote = (props) => h('div', { className: 'kbtb-geonote', 'data-kb': 'tables-map-note' }, svg('map', 14),
          h('span', null, props.lead === undefined ? null : props.lead, props.lead === undefined ? null : ' · ', props.placed + (props.placed === 1 ? kt(' lieu', ' place') : kt(' lieux', ' places'))),
          props.unplaced > 0 ? h('span', { 'data-kb': 'tables-map-unplaced' }, ' · ' + props.unplaced + kt(' sans emplacement', ' without a place')) : null,
          props.children)

        const attributionLinks = () => ATTRIBUTION.map((a, i) => h(React.Fragment, { key: a.text }, i > 0 ? ' · ' : null, h('a', { href: a.href, target: '_blank', rel: 'noopener noreferrer' }, a.text)))
        /**
         * The credit the data licences ask for, as small as it can be read: one line of 9 px text in the corner, its box no bigger than the text. Where that line would run into the
         * caption (or past the edge of a narrow map) it folds into a small « i » button that opens the same words, closes with Escape or a click elsewhere. A hidden copy of the line
         * is what is measured, so the choice does not wait for the line to have been drawn. `props.sig` says when the caption beside it has changed.
         */
        const MapAttribution = (props) => {
          const [fold, setFold] = useState(false)
          const [open, setOpen] = useState(false)
          const root = useRef(null)
          const gauge = useRef(null)
          useEffect(() => {
            const box = root.current === null ? null : root.current.parentNode
            if (box === null || box === undefined) return undefined
            const decide = () => {
              try {
                const need = gauge.current === null ? 0 : gauge.current.getBoundingClientRect().width + 16
                const b = box.getBoundingClientRect()
                const note = box.querySelector('.kbtb-geonote')
                let room = b.width - 12
                if (note !== null) { const n = note.getBoundingClientRect(); if (n.top > b.top + b.height / 2) room = b.right - n.right - 14 } // a caption along the bottom takes its share
                setFold(need > room)
              } catch (e) { setFold(false) }
            }
            decide()
            let watcher = null
            try { watcher = new ResizeObserver(decide); watcher.observe(box) } catch (e) { watcher = null }
            return () => { if (watcher !== null) watcher.disconnect() }
          }, [props.sig])
          useEffect(() => {
            if (!open) return undefined
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); try { root.current.querySelector('button').focus() } catch (err) { /* no button */ } } }
            const away = (e) => { if (root.current !== null && !root.current.contains(e.target)) setOpen(false) }
            document.addEventListener('keydown', onKey, true)
            document.addEventListener('pointerdown', away, true)
            return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', away, true) }
          }, [open])
          const name = kt('Crédits de la carte', 'Map credits')
          return h('div', { ref: root, className: 'kbtb-attr' + (fold ? ' fold' : '') + (fold && open ? ' open' : ''), 'data-kb': 'tables-map-attribution', 'data-fold': fold ? 'true' : 'false' },
            h('span', { ref: gauge, className: 'kbtb-attr-gauge', 'aria-hidden': 'true' }, ATTRIBUTION.map((a) => a.text).join(' · ')),
            fold ? h('button', { type: 'button', className: 'kbtb-attr-i', 'data-kb': 'tables-map-attribution-i', 'aria-label': name, title: name, 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(!open) }, svg('info', 12)) : null,
            fold && !open ? null : h('span', { className: 'kbtb-attr-text', 'data-kb': 'tables-map-attribution-text' }, attributionLinks()))
        }
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
          const [choice, setChoice] = useState(readMapStyle)
          const [themeFailed, setThemeFailed] = useState(false)
          const want = useRef(choice) // the theme asked for (the map follows it a moment later: the style may have to be fetched)

          useEffect(() => {
            const st = { lib: null, map: null, seq: 0, choice: 'auto', styleName: '', apply: () => {}, pins: new Map(), order: '', refocus: null, waiting: false, ready: false, dead: false, loaded: false, ok: 0, errors: 0, t0: Date.now(), down: null, abort: null, timer: null, ticker: null, watcher: null, sig: '', styleSrc: null, sync: () => {}, paint: () => {} }
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
            const start = (lib, style, id) => {
              const box = host.current
              if (box === null) return
              const tok = readTokens(box)
              st.sig = (tok === null ? '' : tokensSig(tok)) + '|' + lang() + '|' + id
              st.styleSrc = style
              st.styleName = mapStyleOf(id).style
              st.choice = id
              st.lib = lib
              const palette0 = tok === null ? null : mapPalette(tok, id)
              box.setAttribute('data-scheme', tok !== null && paletteFrom(tok).dark ? 'dark' : 'light') // the pills follow the page, whatever the map's theme
              box.setAttribute('data-style', id)
              const narrow = (() => { try { return window.matchMedia('(max-width: 900px)').matches } catch (e) { return false } })()
              let map
              try {
                map = new lib.Map({
                  container: box,
                  style: tweakStyle(style, palette0, { lang: lang(), calm: mapStyleOf(id).calm }),
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
              const markZoom = () => { if (st.map !== null) { const c = st.map.getCenter(); box.setAttribute('data-zoom', st.map.getZoom().toFixed(1)); box.setAttribute('data-center', c.lat.toFixed(4) + ',' + c.lng.toFixed(4)) } } // read by the live check
              map.on('load', () => { st.loaded = true; markZoom(); verdict() })
              map.on('zoomend', () => { markZoom(); st.sync() })
              map.on('moveend', markZoom)
              // a light or dark page that changes while the map is open, or a theme the person picks, gives the map its style again: the pins, the clusters, the selection and the camera stay as they are
              st.apply = async () => {
                if (st.map === null || !st.ready || st.dead) return
                const id = want.current
                const t = readTokens(box)
                const sig = (t === null ? '' : tokensSig(t)) + '|' + lang() + '|' + id
                if (sig === st.sig) return
                if (t === null && id === st.choice) return // the page cannot say what it looks like: the map keeps what it has
                const mine = (st.seq += 1)
                let src = st.styleSrc
                if (mapStyleOf(id).style !== st.styleName) {
                  try { src = await loadMapStyle(id, st.abort === null ? undefined : st.abort.signal) } catch (e) {
                    if (st.dead || mine !== st.seq) return
                    want.current = st.choice // the theme could not be had: the map keeps the one it has, and the menu says so
                    setChoice(st.choice)
                    setThemeFailed(true)
                    return
                  }
                  if (st.dead || mine !== st.seq || st.map === null) return
                  st.styleSrc = src
                  st.styleName = mapStyleOf(id).style
                }
                st.sig = sig
                st.choice = id
                box.setAttribute('data-scheme', t !== null && paletteFrom(t).dark ? 'dark' : 'light')
                box.setAttribute('data-style', id)
                st.map.setStyle(tweakStyle(src, t === null ? null : mapPalette(t, id), { lang: lang(), calm: mapStyleOf(id).calm }), { diff: true })
                saveMapStyle(id) // remembered only once the map wears it
              }
              st.ticker = setInterval(st.apply, 1500)
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
                let id = want.current
                let style = null
                try { style = await loadMapStyle(id, st.abort === null ? undefined : st.abort.signal) } catch (e) {
                  if (st.dead || mapStyleOf(id).style === mapStyleOf('auto').style) throw e
                  id = 'auto' // the remembered theme cannot be had (a style that is gone, a host that does not serve it): the quiet map comes instead, never the drawing
                  want.current = id
                  setChoice(id)
                  style = await loadMapStyle(id, st.abort === null ? undefined : st.abort.signal)
                }
                if (st.dead) return
                start(lib, style, id)
              } catch (e) { fail(step) }
            })()
            return teardown
          }, [])

          // the items changed (a filter, an edit, the next page): the pins are made again, and the map looks at the new set if some of it is out of view
          const idsSig = props.placed.map((q) => q.row.id).join(',')
          const itemsSig = props.placed.map((q) => q.row.id + ':' + q.lat + ':' + q.lng + ':' + q.row.label + ':' + q.row.amount + ':' + q.row.title).join('|')
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
          const choose = (id) => {
            want.current = mapStyleOf(id).id
            setChoice(want.current)
            setThemeFailed(false)
            const st = live.current
            if (st !== null) st.apply()
          }
          const placed = props.placed.length
          return h('div', { className: 'kbtb-geo', 'data-kb': 'tables-map-box', 'data-map': ready ? 'real' : 'loading' },
            h('div', { ref: host, className: 'kbtb-gl', 'data-kb': 'tables-map', 'data-map': 'real', role: 'group', 'aria-label': kt('Carte des lignes', 'Map of the rows') }),
            ready ? null : h('div', { className: 'kbtb-geoload', 'data-kb': 'tables-map-loading', role: 'status' }, h('span', { className: 'kbtb-bone' }), h('span', { className: 'kbtb-geoload-text' }, kt('Chargement de la carte…', 'Loading the map…'))),
            h(MapControls, {
              key: 'controls',
              themes: { choice, failed: themeFailed, disabled: !ready, onChoose: choose },
              onIn: go((map, ms) => map.zoomIn({ duration: ms })),
              onOut: go((map, ms) => map.zoomOut({ duration: ms })),
              onFit: go((map, ms) => { const b = boundsOf(latest.current.placed); if (b !== null) map.fitBounds(b, Object.assign({ duration: ms * 2 }, MAP_FIT)) }),
            }),
            h(MapNote, { key: 'note', placed, unplaced: props.unplaced }),
            h(MapAttribution, { key: 'credit', sig: placed + ':' + props.unplaced }))
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
          if (real) return h(React.Fragment, null, h(RealMap, Object.assign({}, props, { key: 'real', onFail: failed }))) // keyed, so the drawn map that may replace it is never taken for the same component
          const why = props.placed.length === 0 ? 'empty' : mode.why
          return h(React.Fragment, null, h(MapView, Object.assign({}, props, { key: 'drawn', why, onRetry: why === 'webgl' || why === 'empty' || why === '' ? undefined : retry })))
        }
        const onActivate = (fn) => (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); fn() } }

        /** The Map view: the records that have a place, on the real map when it may start and on the drawn one when it may not; a pin opens its record, and the open record lights its pin. */
        const GeoView = ({ p }) => {
          const [hot, setHot] = useState(null)
          const placed = useMemo(() => placedRecords(p.obj, p.view, p.rows), [p.obj, p.view.lat, p.view.lng, p.view.state.hidden, p.rows])
          return h(MapSwitch, { placed, unplaced: p.rows.length - placed.length, hot, selected: p.drawer ? p.drawer.id : null, seed: seedOf(p.db.id + '/' + p.obj.key), onPick: (r) => p.openRecord(r.id), onHover: setHot })
        }

        const CalendarView = ({ p }) => {
          const f = p.obj.fields.find((x) => x.key === p.view.date)
          if (!f) return null
          const ym = p.months[p.view.id] || monthOf(p.ctx.today)
          const tone = p.obj.fields.find((x) => x.type === 'choice' && x.protection !== 'secret')
          const dated = p.rows.filter((r) => typeof r.values[f.key] === 'string')
          const undated = p.rows.length - dated.length
          const days = monthGrid(ym)
          const go = (to) => p.setMonth(p.view.id, to)
          const weekdays = weekdayLabels()
          return h('div', { className: 'kbtb-cal', 'data-kb': 'tables-calendar' },
            h('div', { className: 'kbtb-calh' }, h('b', null, monthLabel(ym)),
              h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'tables-cal-today', onClick: () => go(monthOf(p.ctx.today)) }, kt('Aujourd’hui', 'Today')),
              h('button', { type: 'button', className: 'kbtb-ib', 'aria-label': kt('Mois précédent', 'Previous month'), 'data-kb': 'tables-cal-prev', onClick: () => go(shiftMonth(ym, -1)) }, svg('chevL', 16)),
              h('button', { type: 'button', className: 'kbtb-ib', 'aria-label': kt('Mois suivant', 'Next month'), 'data-kb': 'tables-cal-next', onClick: () => go(shiftMonth(ym, 1)) }, svg('chevR', 16))),
            h('div', { className: 'kbtb-calg' },
              weekdays.map((w, i) => h('div', { key: 'w' + i, className: 'kbtb-cald' }, w)),
              days.map((d) => {
                const day = dated.filter((r) => r.values[f.key] === d.iso)
                return h('div', { key: d.iso, className: 'kbtb-cc' + (d.out ? ' out' : '') + (d.iso === p.ctx.today ? ' today' : '') },
                  h('div', { className: 'kbtb-dn' }, h('b', null, String(d.day))),
                  day.slice(0, CAL_SHOW).map((r) => {
                    const o = tone ? optionOf(tone, r.values[tone.key]) : undefined
                    const hue = o ? hueOfColor(o.color) : null
                    return h('button', { key: r.id, type: 'button', className: 'kbtb-ce' + (hue === null ? '' : ' hue'), style: hue === null ? undefined : { '--kbtb-h': hue }, 'data-kb': 'tables-event', 'data-id': r.id, title: titleOf(p.obj, r), onClick: () => p.openRecord(r.id) }, titleOf(p.obj, r))
                  }),
                  day.length > CAL_SHOW ? h('span', { className: 'kbtb-more' }, '+' + (day.length - CAL_SHOW)) : null)
              })),
            undated > 0 ? h('p', { className: 'kbtb-note faint' }, kt(undated + ' ' + rowWord(undated) + ' sans date ne sont pas dans le calendrier.', undated + ' ' + rowWord(undated) + ' without a date ' + (undated === 1 ? 'is' : 'are') + ' not in the calendar.')) : null)
        }

        // ── the chips under the header: one per condition (one for an « or »), one for the sort, and the count ────────────────
        const Chips = ({ p }) => {
          const flt = p.view.state.flt
          const sorts = p.view.state.sorts
          const items = flt.items
          const chip = (key, text, aria, onRemove, ord) => h('span', { key, className: 'kbtb-chip' + (ord ? ' ord' : ''), 'data-kb': 'tables-chip' }, svg(ord ? 'sort' : 'filter', 12), h('span', { className: 'kbtb-ft' }, text),
            h('button', { type: 'button', 'aria-label': aria, onClick: onRemove }, svg('x', 11)))
          const fchips = flt.conj === 'or' && items.length > 1
            ? [chip('or', items.map((it) => itemText(p.obj, it, p.ctx)).join(' ' + conjText('or') + ' '), kt('Retirer le filtre', 'Remove the filter'), () => p.setFlt(K.blankFilter()))]
            : items.map((it, i) => chip('f' + i, itemText(p.obj, it, p.ctx), kt('Retirer : ', 'Remove: ') + itemText(p.obj, it, p.ctx), () => p.setFlt(removeAt(flt, String(i)))))
          const ochip = sorts.length ? [chip('sort', kt('Tri : ', 'Sort: ') + sorts.map((s) => fieldOf(p.obj, s.k).label + ' ' + (s.dir === 'asc' ? '↑' : '↓')).join(', '), kt('Retirer le tri', 'Remove the sort'), () => p.editView((v) => { v.state.sorts = []; return v }), true)] : []
          const all = p.all.length
          const n = p.rows.length
          return h('div', { className: 'kbtb-chips', 'data-kb': 'tables-chips' }, fchips, ochip,
            items.length > 1 && flt.conj !== 'or' ? h('button', { type: 'button', className: 'kbtb-lnk', onClick: () => p.setFlt(K.blankFilter()) }, kt('Effacer les filtres', 'Clear filters')) : null,
            h('span', { className: 'kbtb-count', 'data-kb': 'tables-count', role: 'status' }, p.rec.status === 'ok' ? (n === all ? all + ' ' + rowWord(all) : n + kt(' sur ', ' of ') + all) + (p.rec.truncated ? ' +' : '') : ''))
        }

        /** « Linked from »: the rows of other tables that point at this one, one group per link field, read from the host (the links are kept on their own side, this side is computed). */
        const LinkedFrom = ({ p, id }) => {
          const [st, setSt] = useState({ status: 'loading', groups: [], error: null })
          const fp = p.db.fingerprint
          useEffect(() => {
            let off = false
            ;(async () => {
              const r = await call('GET', '/links' + qs({ db: p.db.id, object: p.obj.key, id }))
              if (off) return
              setSt((cur) => (r.ok ? { status: 'ok', groups: r.groups, error: null } : { status: 'error', groups: cur.groups, error: r }))
            })()
            return () => { off = true }
          }, [p.db.id, p.obj.key, id, fp])
          if (st.status === 'loading' || (st.status === 'ok' && st.groups.length === 0)) return null
          if (st.status === 'error' && st.groups.length === 0) return h('p', { className: 'kbtb-lf kbtb-note faint', 'data-kb': 'tables-linked-error' }, kt('Les lignes qui renvoient ici ne sont pas lisibles pour l’instant.', 'The rows that link here cannot be read right now.'))
          return h(LinkedGroups, { p, groups: st.groups })
        }
        const LinkedGroups = ({ p, groups }) => h('section', { className: 'kbtb-lf', 'data-kb': 'tables-linked', 'aria-label': kt('Lié depuis', 'Linked from') },
          h('h4', { className: 'kbtb-lft' }, svg('link', 12), kt('Lié depuis', 'Linked from')),
          groups.map((g) => {
            const name = (r) => (r.title === '' ? kt('Sans titre', 'Untitled') : r.title)
            return h('div', { key: g.object + '/' + g.field, className: 'kbtb-lg', 'data-kb': 'tables-linked-group', 'data-object': g.object, 'data-field': g.field },
              h('div', { className: 'kbtb-lgh' }, h('b', null, g.inverse !== null ? g.inverse : g.objectLabel), h('span', { className: 'kbtb-lgc', 'data-kb': 'tables-linked-count' }, String(g.count)), h('span', { className: 'kbtb-lgv' }, kt('via ', 'via ') + (g.inverse !== null ? g.objectLabel + ' › ' : '') + g.fieldLabel)),
              g.records.length === 0
                ? h('span', { className: 'kbtb-nil' }, kt('Aucune pour l’instant.', 'None yet.'))
                : h('span', { className: 'kbtb-opts' },
                  g.records.map((r) => h('button', { key: r.id, type: 'button', className: 'kbtb-rel go', 'data-kb': 'tables-link', 'data-object': g.object, 'data-id': r.id, title: kt('Ouvrir ', 'Open ') + name(r), onClick: () => p.openLinked(g.object, r.id) }, svg('link', 11), name(r))),
                  g.count > g.records.length ? h('span', { className: 'kbtb-more' }, '+' + (g.count - g.records.length)) : null))
          }))
        // ── the record drawer: a row read in full. Nothing in it is edited by hand; Kaby changes rows, and the drawer shows the result. ──
        /** One field of the drawer: its label and what the row holds there. */
        const FieldRow = ({ field, rec, p }) => {
          const v = rec.values[field.key]
          const long = field.type === 'longtext' && !empty(v) && field.protection !== 'secret'
          return h('div', { className: 'kbtb-df' + (field.key === p.obj.title ? ' title' : ''), 'data-kb': 'tables-field-' + field.key },
            h('span', { className: 'kbtb-dl' }, field.label, field.protection !== 'normal' ? h('span', { className: 'kbtb-prot', title: kt('Protégé : ', 'Protected: ') + field.protection }, svg('lock', 11)) : null),
            long ? h('p', { className: 'kbtb-long' }, String(v)) : empty(v) && field.type !== 'checkbox' ? h('span', { className: 'kbtb-nil' }, '—') : h('span', { className: 'kbtb-dv' }, h(Cell, { field, rec, ctx: p.ctx }), field.type === 'checkbox' && v !== true ? h('span', { className: 'kbtb-nil' }, kt('Non', 'No')) : null))
        }
        const Drawer = ({ p }) => {
          const d = p.drawer
          const rec = p.all.find((r) => r.id === d.id)
          const ordered = [p.obj.fields.find((f) => f.key === p.obj.title)].concat(p.obj.fields.filter((f) => f.key !== p.obj.title))
          const closeBtn = h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'tables-drawer-close', 'aria-label': kt('Fermer', 'Close'), onClick: p.closeDrawer }, svg('x', 16))
          const trail = Array.isArray(d.trail) ? d.trail : []
          const backText = trail.length > 0 ? kt('Retour à ', 'Back to ') + trail[trail.length - 1].label : ''
          const backBtn = trail.length > 0 ? h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'tables-drawer-back', 'aria-label': backText, title: backText, onClick: p.goBack }, svg('chevL', 16)) : null
          if (!rec) {
            // the row of another table is read after the table is: until then it is not missing, only not here yet
            const wait = p.rec.status === 'loading'
            return h('aside', { className: 'kbtb-drawer', 'data-kb': 'tables-drawer', 'aria-label': kt('Ligne', 'Row') }, h('div', { className: 'kbtb-dh' }, backBtn, h('b', null, wait ? kt('Chargement…', 'Loading…') : kt('Cette ligne n’existe plus.', 'This row no longer exists.')), closeBtn))
          }
          return h('aside', { className: 'kbtb-drawer', 'data-kb': 'tables-drawer', 'aria-label': titleOf(p.obj, rec) },
            h('div', { className: 'kbtb-dh' }, backBtn, h('b', null, titleOf(p.obj, rec)), closeBtn),
            h('div', { className: 'kbtb-dfields' }, ordered.map((f) => h(FieldRow, { key: f.key, field: f, rec, p }))),
            h(LinkedFrom, { p, id: rec.id }),
            h('div', { className: 'kbtb-dfoot split' },
              h('span', { className: 'kbtb-stamp' }, kt('Créée le ', 'Created ') + fmtStamp(rec.created.at), h('br'), kt('Modifiée le ', 'Modified ') + fmtStamp(rec.modified.at)),
              h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'tables-drawer-ask', onClick: () => p.askKaby() }, svg('sparkle', 14), kt('Demander à Kaby', 'Ask Kaby'))))
        }

        // ── empty states ────────────────────────────────────────────────────────────────────────────────────────────────────
        const Empty = ({ p, why }) => {
          if (why === 'filtered') {
            return h('div', { className: 'kbtb-empty', 'data-kb': 'tables-empty', 'data-why': 'filtered' }, h('b', null, kt('Aucune ligne ne correspond.', 'No row matches.')), h('span', null, kt('Essaie une autre recherche, ou efface le filtre.', 'Try another search, or clear the filter.')),
              h('button', { type: 'button', className: 'kbtb-btn', onClick: p.clearAll }, kt('Tout effacer', 'Clear everything')))
          }
          return h('div', { className: 'kbtb-empty', 'data-kb': 'tables-empty', 'data-why': 'none' }, h('b', null, kt('Pas encore de ligne', 'No rows yet')),
            h('span', null, kt('Demande à Kaby de remplir cette table : elle te demandera ton accord pour ce qui est protégé.', 'Ask Kaby to fill this table: she will ask your approval for what is protected.')),
            h('button', { type: 'button', className: 'kbtb-btn primary', 'data-kb': 'tables-empty-ask', onClick: () => p.askKaby() }, svg('sparkle', 14), kt('Demander à Kaby', 'Ask Kaby')))
        }

        // ── the Apps gallery: one card per app ──────────────────────────────────────────────────────────────────────────────
        const tablesWord = (n) => n + ' ' + plural(n, 'table', 'tables', 'table', 'tables')
        const rowsWord = (n) => n + ' ' + rowWord(n)
        const linksWord = (n) => n + ' ' + plural(n, 'lien', 'liens', 'link', 'links')
        /** The mark of an app that has no picture of its own: its first letter on a hue only it has. */
        const Tile = ({ app, size }) => h('span', { className: 'kbtb-apptile' + (size === 's' ? ' s' : ''), style: { '--kbtb-h': appHue(app.id) }, 'aria-hidden': 'true' }, monogram(app.name))
        // ── Publish: what the page shows of an app that lives in a web app ──
        /** The pill of a published app: on its card (with the web app's host) and next to its name. It turns to a warning, with another icon, when the copy cannot be refreshed. */
        const PubPill = ({ pub, hd }) => {
          const bad = plain(pub.syncError)
          const host = hostWord(pub.url)
          return h('span', { className: 'kbtb-pub' + (bad ? ' bad' : '') + (hd ? ' hd' : ''), 'data-kb': hd ? 'apps-published-pill' : 'apps-card-published', title: bad ? syncLine(pub) : host },
            svg(bad ? 'alert' : 'globe', 12), h('span', null, kt('Publiée', 'Published') + (hd || host === '' ? '' : ' · ' + host)))
        }
        /** Under the tabs of a published app: where it lives, how fresh the copy is, why the structure is locked, and the two things that can be done about it. */
        const PublishedNote = ({ p }) => {
          const pub = pubOf(p.db)
          if (pub === null) return null
          const bad = plain(pub.syncError)
          const update = kt('Mettre la copie à jour maintenant', 'Update the copy now')
          return h('div', { className: 'kbtb-banner kbtb-pubnote' + (bad ? ' warn' : ''), 'data-kb': 'apps-published-note' },
            svg(bad ? 'alert' : 'globe', 16),
            h('span', { className: 'sp' },
              h('span', null, h('b', null, hostWord(pub.url)), h('span', { className: 'kbtb-sync', 'data-kb': 'apps-sync' }, ' · ' + syncLine(pub))),
              h('span', { className: 'kbtb-pubsent' }, kt('Les lignes s’écrivent dans l’app web et sont recopiées ici. La structure et les vues enregistrées ne changent plus tant que l’app est publiée ; les filtres et les tris marchent, pour cette visite seulement.', 'Rows are written in the web app and copied here. The structure and the saved views can’t change while the app is published; filters and sorting still work, for this visit only.'))),
            h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'apps-refresh', 'aria-label': update, title: update, disabled: p.syncBusy === p.db.id, onClick: () => p.refreshNow(p.db.id) }, svg('refresh', 16)),
            h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'apps-unpublish', onClick: () => p.openUnpublish(p.db.id) }, kt('Arrêter la publication…', 'Unpublish…')))
        }
        const AppCard = ({ p, app }) => {
          const objs = app.objects
          const pub = pubOf(app)
          return h('div', { className: 'kbtb-appcard', 'data-kb': 'apps-card', 'data-db': app.id },
            h('button', { type: 'button', className: 'kbtb-appopen', 'data-kb': 'apps-open', onClick: () => p.openApp(app.id) },
              h(Tile, { app }),
              h('span', { className: 'kbtb-appmid' },
                h('span', { className: 'kbtb-appname' }, app.name),
                h('span', { className: 'kbtb-appline' }, objs.length === 0 ? kt('Aucune table pour l’instant', 'No table yet') : tablesWord(objs.length) + ' · ' + rowsWord(rowsIn(app)))),
              h('span', { className: 'kbtb-sects' }, objs.slice(0, 3).map((o) => h('span', { key: o.key, className: 'kbtb-sect' }, h('b', null, fmtNumber(Number.isInteger(o.count) ? o.count : 0)), ' ', o.label)),
                objs.length > 3 ? h('span', { className: 'kbtb-sect' }, kt('+' + (objs.length - 3) + ' autres', '+' + (objs.length - 3) + ' more')) : null),
              pub !== null ? h(PubPill, { pub }) : h('span', { className: 'kbtb-state' }, svg('lock', 12), kt('Privée, sur cet ordinateur', 'Private, on this computer'))),
            h(ActionMenu, { p, id: 'card:' + app.id, hook: 'apps-card-menu', wrap: 'kbtb-appkeb', label: kt('Plus d’actions pour ', 'More actions for ') + app.name,
              items: [{ id: 'open', icon: 'arrow', label: kt('Ouvrir', 'Open') }, { id: 'ask', icon: 'sparkle', label: kt('Demander à Kaby', 'Ask Kaby') }]
                .concat(pub !== null ? [{ id: 'web', icon: 'external', label: kt('Ouvrir l’app web', 'Open web app') }] : canPublishVia(p.hosting) ? [{ id: 'publish', icon: 'upload', label: kt('Publier…', 'Publish…') }] : [])
                .concat([{ id: 'sep', sep: true }], pub !== null ? [{ id: 'unpublish', icon: 'globe', label: kt('Arrêter la publication…', 'Unpublish…') }, { id: 'archive', icon: 'archive', label: kt('Ranger…', 'Archive…'), locked: kt('Arrête la publication d’abord', 'Unpublish first') }] : [{ id: 'archive', icon: 'archive', label: kt('Ranger…', 'Archive…') }]),
              onPick: (id) => (id === 'open' ? p.openApp(app.id) : id === 'ask' ? p.askKaby(askAbout(app, null, null)) : id === 'web' ? p.openWeb(app.id) : id === 'publish' ? p.openPublish(app.id) : id === 'unpublish' ? p.openUnpublish(app.id) : p.confirmArchive(app.id, null)) }))
        }
        /** An app put away: kept, hidden from Kaby, and only here can it come back or go for good. */
        const ArchivedCard = ({ p, app }) => h('div', { className: 'kbtb-appcard arch', 'data-kb': 'apps-archived', 'data-db': app.id },
          h('div', { className: 'kbtb-appopen static' }, h(Tile, { app }),
            h('span', { className: 'kbtb-appmid' }, h('span', { className: 'kbtb-appname' }, app.name), h('span', { className: 'kbtb-appline' }, tablesWord(app.tables) + ' · ' + rowsWord(app.rows) + ' · ' + kt('gardée, cachée de Kaby', 'kept, hidden from Kaby')))),
          h('span', { className: 'kbtb-row2' },
            h('button', { type: 'button', className: 'kbtb-tx', 'data-kb': 'apps-restore', onClick: () => p.restoreApp(app.id) }, svg('restore', 14), kt('Rétablir', 'Restore')),
            h('button', { type: 'button', className: 'kbtb-tx bad', 'data-kb': 'apps-delete', onClick: () => p.confirmDelete(app.id, null) }, kt('Supprimer pour de bon…', 'Delete forever…'))))
        const Gallery = ({ p }) => h('div', { className: 'kbtb-gallery', 'data-kb': 'apps-gallery' },
          p.dbs.length === 0
            ? h('div', { className: 'kbtb-empty big', 'data-kb': 'apps-none' }, h('span', { className: 'kbtb-emptytile' }, svg('apps', 24)), h('b', null, kt('Pas encore d’app', 'No app yet')),
              h('span', null, kt('Décris à Kaby ce que tu veux suivre et elle le met en place, ou pars d’un modèle prêt pour ton métier.', 'Describe what you want to keep track of and Kaby sets it up, or start from a ready-made template for your trade.')),
              h('button', { type: 'button', className: 'kbtb-btn primary', 'data-kb': 'apps-none-new', onClick: () => p.newApp() }, svg('plus', 14), kt('Nouvelle app', 'New app')))
            : h('div', { className: 'kbtb-gal' }, p.dbs.map((app) => h(AppCard, { key: app.id, p, app }))),
          p.archived.length > 0 ? h('div', { className: 'kbtb-archived' },
            h('button', { type: 'button', className: 'kbtb-fold', 'data-kb': 'apps-fold', 'aria-expanded': p.fold ? 'true' : 'false', onClick: () => p.setFold(!p.fold) }, kt('Rangées · ', 'Archived · ') + p.archived.length, svg(p.fold ? 'chevD' : 'chevR', 16)),
            p.fold ? h('div', { className: 'kbtb-gal' }, p.archived.map((app) => h(ArchivedCard, { key: app.id, p, app }))) : null) : null)

        // ── a new app: described to Kaby, started from a template, or from a simple shape ─────────────────────────────────────
        const TemplateCard = ({ p, t }) => h('div', { className: 'kbtb-appcard', 'data-kb': 'apps-template', 'data-id': t.id },
          h('button', { type: 'button', className: 'kbtb-appopen', onClick: () => (t.have && t.appId !== null ? p.openApp(t.appId) : p.openTemplate(t.id)) },
            h(Tile, { app: { id: t.id, name: t.name } }),
            h('span', { className: 'kbtb-appmid' }, h('span', { className: 'kbtb-appname' }, t.name), h('span', { className: 'kbtb-appline' }, t.line)),
            h('span', { className: 'kbtb-sects' }, t.tables.slice(0, 3).map((n) => h('span', { key: n, className: 'kbtb-sect' }, n)), t.tables.length > 3 ? h('span', { className: 'kbtb-sect' }, '+' + (t.tables.length - 3)) : null),
            t.extras !== '' ? h('span', { className: 'kbtb-appline small' }, kt('Vient avec ', 'Comes with ') + t.extras + '.') : null,
            h('span', { className: 'kbtb-appfoot' }, t.tag !== '' ? h('span', { className: 'kbtb-state' }, t.tag) : null,
              t.have ? h('span', { className: 'kbtb-state ok' }, svg('check', 13), kt('Dans tes apps', 'In your apps')) : h('span', { className: 'kbtb-state add' }, svg('plus', 13), kt('Utiliser ce modèle', 'Use template')))))
        const NewApp = ({ p }) => {
          const [text, setText] = useState('')
          const send = (e) => { if (e) e.preventDefault(); if (text.trim() !== '') p.askKaby(buildText(text)) }
          const tpl = p.templates !== null && p.templates.status === 'ok' ? p.templates.list : []
          return h('div', { className: 'kbtb-newapp', 'data-kb': 'apps-new' },
            h('form', { className: 'kbtb-mline wide', onSubmit: send },
              h('span', { className: 'kbtb-mic' }, svg('sparkle', 15)),
              h('input', { className: 'kbtb-mi', type: 'text', autoComplete: 'off', autoFocus: true, 'data-kb': 'tables-build-input', 'aria-label': kt('Décris ton app à Kaby', 'Describe your app to Kaby'), placeholder: kt('Décris ton app à Kaby', 'Describe your app to Kaby'), value: text, onChange: (e) => setText(e.target.value) }),
              h('button', { type: 'submit', className: 'kbtb-mgo', 'data-kb': 'tables-build-send', disabled: text.trim() === '', 'aria-label': kt('Envoyer à Kaby', 'Send to Kaby') }, svg('arrow', 15))),
            h('div', { className: 'kbtb-mex' }, EXAMPLES().map((t) => h('button', { key: t, type: 'button', className: 'kbtb-ex', onClick: () => setText(t) }, t))),
            h('p', { className: 'kbtb-note' }, kt('Kaby propose les tables et les liens dans un chat. Rien n’est créé avant ton accord.', 'Kaby proposes the tables and the links in a chat. Nothing is created before you approve.')),
            tpl.length > 0 ? h('section', { className: 'kbtb-sec', 'data-kb': 'apps-templates' },
              h('h4', { className: 'kbtb-sh' }, kt('Partir d’un modèle', 'Start from a template')),
              h('p', { className: 'kbtb-sub' }, kt('Un modèle est une app prête pour un métier, avec des lignes d’exemple. Il peut aussi apporter son tableau de bord, ses automatisations, ses skills et son équipe d’agents.', 'A template is a ready-made app for a trade, with sample rows. It can also bring its dashboard, automations, skills and agent team.')),
              h('div', { className: 'kbtb-gal' }, tpl.map((t) => h(TemplateCard, { key: t.id, p, t })))) : null,
            h('section', { className: 'kbtb-sec', 'data-kb': 'apps-starts' },
              h('h4', { className: 'kbtb-sh' }, kt('Départs simples', 'Simple starts')),
              h('p', { className: 'kbtb-sub' }, kt('Trois formes sans métier attaché. Kaby les met en place dans un chat.', 'Three shapes with no trade attached. Kaby sets them up in a chat.')),
              h('div', { className: 'kbtb-gal' }, STARTS().map((st) => h('div', { key: st.id, className: 'kbtb-appcard' },
                h('button', { type: 'button', className: 'kbtb-appopen', 'data-kb': 'apps-start', 'data-id': st.id, onClick: () => p.askKaby(buildText(st.text)) },
                  h(Tile, { app: { id: st.id, name: st.name } }),
                  h('span', { className: 'kbtb-appmid' }, h('span', { className: 'kbtb-appname' }, st.name), h('span', { className: 'kbtb-appline' }, st.line)),
                  h('span', { className: 'kbtb-appfoot' }, h('span', { className: 'kbtb-state add' }, svg('sparkle', 13), kt('Mettre en place avec Kaby', 'Set up with Kaby')))))))))
        }

        // ── one app: its header, its tabs (the tables, then Relations), and the confirmations that put away or delete ─────────
        /** The ⋯ of an app: its archived tables, and putting the app away. */
        const AppMenu = ({ p }) => {
          const away = p.db.archivedObjects || []
          const pub = pubOf(p.db)
          const open = p.menu === 'app' || p.menu === 'archt'
          const row = (t) => h('div', { key: t.key, className: 'kbtb-arow', 'data-kb': 'apps-archived-table', 'data-object': t.key },
            h('span', { className: 'kbtb-aname' }, h('b', null, t.label), h('small', null, (t.count || 0) + ' ' + rowWord(t.count || 0) + ' · ' + kt('gardée, cachée de Kaby', 'kept, hidden from Kaby'))),
            h('span', { className: 'kbtb-row2' },
              h('button', { type: 'button', className: 'kbtb-tx', 'data-kb': 'apps-table-restore', onClick: () => p.restoreTable(p.db.id, t.key) }, svg('restore', 14), kt('Rétablir', 'Restore')),
              h('button', { type: 'button', className: 'kbtb-tx bad', 'data-kb': 'apps-table-delete', onClick: () => p.confirmDelete(p.db.id, t.key) }, kt('Supprimer pour de bon…', 'Delete forever…'))))
          return h('span', { className: 'kbtb-pw' },
            h('button', { type: 'button', className: 'kbtb-ib' + (open ? ' open' : ''), 'data-kb': 'apps-menu', 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false', 'aria-label': kt('Plus d’actions', 'More actions'), title: kt('Plus d’actions', 'More actions'), onClick: () => p.setMenu(open ? null : 'app') }, svg('dots', 18)),
            p.menu === 'app' ? h(Pop, { label: kt('Plus d’actions', 'More actions'), cls: 'sm' },
              away.length > 0 ? h('button', { type: 'button', role: 'menuitem', className: 'kbtb-mi2', 'data-kb': 'apps-menu-archt', onClick: () => p.setMenu('archt') }, svg('archive', 15), kt('Tables rangées · ', 'Archived tables · ') + away.length)
                : h('p', { className: 'kbtb-note faint' }, kt('Aucune table rangée.', 'No archived table.')),
              h('div', { className: 'kbtb-psep' }),
              pub !== null ? h('button', { type: 'button', role: 'menuitem', className: 'kbtb-mi2', 'data-kb': 'apps-menu-unpublish', onClick: () => p.openUnpublish(p.db.id) }, svg('globe', 15), kt('Arrêter la publication…', 'Unpublish…')) : null,
              pub !== null ? h('button', { type: 'button', role: 'menuitem', 'aria-disabled': 'true', className: 'kbtb-mi2 dis', 'data-kb': 'apps-menu-archive', title: kt('Arrête la publication pour changer cela', 'Unpublish to change this'), onClick: stop }, svg('archive', 15), kt('Ranger l’app…', 'Archive app…'), h('span', { className: 'kbtb-why' }, kt('Arrête la publication d’abord', 'Unpublish first')))
                : h('button', { type: 'button', role: 'menuitem', className: 'kbtb-mi2', 'data-kb': 'apps-menu-archive', onClick: () => p.confirmArchive(p.db.id, null) }, svg('archive', 15), kt('Ranger l’app…', 'Archive app…'))) : null,
            p.menu === 'archt' ? h(Pop, { label: kt('Tables rangées', 'Archived tables'), cls: 'archt' }, h(PopHead, { title: kt('Tables rangées', 'Archived tables') }), h('div', { className: 'kbtb-alist' }, away.map(row))) : null)
        }
        const AppHeader = ({ p, tile, title, pill, sub, back, backLabel, actions }) => h('header', { className: 'kb6-headrow' },
          h('div', { className: 'kb6-headcol' },
            h('div', { className: 'kb6-titlerow kbtb-titlerow' },
              back ? h('button', { type: 'button', className: 'kbtb-back', 'data-kb': 'apps-back', 'aria-label': backLabel, title: backLabel, onClick: back }, svg('chevL', 18)) : null,
              tile || null, h('h1', { className: 'kb6-title' }, title), pill || null, help()),
            sub ? h('p', { className: 'kb8-sub' }, sub) : null),
          actions || null)
        const Tabs = ({ p }) => h('div', { className: 'kbtb-tabs kbtb-tabs2', role: 'tablist', 'aria-label': kt('Tables', 'Tables'), 'data-kb': 'tables-tabs' },
          p.db.objects.map((o) => h('button', { key: o.key, type: 'button', role: 'tab', className: 'kbtb-tab', 'aria-selected': !p.relTab && p.obj !== null && o.key === p.obj.key ? 'true' : 'false', 'data-kb': 'tables-tab', 'data-object': o.key, onClick: () => p.openTable(o.key) }, o.label)),
          p.db.objects.length > 1 ? [
            h('span', { key: 'sep', className: 'kbtb-tabsep', 'aria-hidden': 'true' }),
            h('button', { key: REL_TAB, type: 'button', role: 'tab', className: 'kbtb-tab rel', 'aria-selected': p.relTab ? 'true' : 'false', 'data-kb': 'tables-tab-relations', onClick: () => p.openTable(REL_TAB) }, svg('nodes', 15), kt('Relations', 'Relations'))] : null)

        // ── how the tables connect: the map and the list of links ─────────────────────────────────────────────────────────────
        const linkAskText = (db) => kt(
          'Sur la page Apps, dans l’app « ' + db.name + ' » (base ' + db.id + '), relie deux de mes tables avec un champ de lien (relation_add), en donnant un nom au lien vu de l’autre côté (inverse). Si ce n’est pas clair, demande-moi lesquelles.',
          'On the Apps page, in the app “' + db.name + '” (database ' + db.id + '), link two of my tables with a link field (relation_add), naming the link as the other table sees it (inverse). If it is unclear, ask me which ones.')
        const short = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
        const LinkMap = ({ p, objects, rels }) => {
          const m = useMemo(() => mapLayout(objects), [objects])
          const pick = (key) => p.openTable(key)
          const word = (r) => (r.many ? kt('plusieurs', 'many') : kt('un seul', 'one'))
          return h('div', { className: 'kbtb-mapw' },
            h('svg', { className: 'kbtb-map', viewBox: '0 0 ' + m.width + ' ' + m.height, role: 'img', 'data-kb': 'tables-map', 'aria-label': kt('Carte des liens entre les tables', 'Map of the links between the tables') },
              h('defs', null, h('marker', { id: 'kbtb-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', className: 'kbtb-mk' }))),
              m.edges.map((e) => h('g', { key: e.rel.from + '.' + e.rel.field, className: 'kbtb-me', 'data-kb': 'tables-map-link', 'data-from': e.rel.from, 'data-to': e.rel.to, 'data-field': e.rel.field },
                h('path', { d: e.d, className: 'kbtb-mp', markerEnd: 'url(#kbtb-arrow)' }),
                h('text', { x: e.lx, y: e.ly - 6, textAnchor: 'middle', className: 'kbtb-ml' }, short(e.label, 26)))),
              m.nodes.map((n) => h('g', { key: n.key, className: 'kbtb-mn', role: 'button', tabIndex: 0, 'data-kb': 'tables-map-node', 'data-object': n.key, 'aria-label': kt('Ouvrir la table ', 'Open the table ') + n.label,
                onClick: () => pick(n.key), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(n.key) } } },
              h('rect', { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 12 }),
              h('text', { x: n.x, y: n.y + 4.5, textAnchor: 'middle' }, short(n.label, 20))))),
            rels.length === 0
              ? h('div', { className: 'kbtb-mapnone', 'data-kb': 'tables-map-none' }, h('span', null, kt('Aucune table n’est encore reliée à une autre.', 'No table is linked to another yet.')),
                h('button', { type: 'button', className: 'kbtb-link flat', 'data-kb': 'tables-map-ask', onClick: () => p.askKaby(linkAskText(p.db)) }, svg('sparkle', 13), kt('Demander à Kaby de relier deux tables', 'Ask Kaby to link two tables')))
              : h('ul', { className: 'kbtb-maplist', 'data-kb': 'tables-map-list' }, rels.map((r) => h('li', { key: r.from + '.' + r.field },
                h('b', null, r.fromLabel + ' › ' + r.label), ' → ', r.toLabel, h('span', { className: 'kbtb-note faint' }, ' · ' + word(r) + ' · ' + kt('vu de ', 'seen from ') + r.toLabel + kt(' sous le nom « ', ' as “') + seenAs(r) + kt(' »', '”'))))))
        }
        /** The Relations tab: one more way to look at the app, never the one it opens on. */
        const RelationsView = ({ p }) => h('section', { className: 'kbtb-relations', 'data-kb': 'tables-relations', 'aria-label': kt('Relations', 'Relations') },
          h(LinkMap, { p, objects: p.db.objects, rels: relationFields(p.db.objects) }),
          h('p', { className: 'kbtb-note faint' }, kt('Chaque ligne porte le nom du champ qui tient le lien. Clique sur une table pour l’ouvrir.', 'Each line is named after the field that holds the link. Click a table to open it.')))

        // ── confirmations: putting an app or a table away, deleting it for good, adding a template ────────────────────────────
        const Dialog = ({ label, onClose, children }) => h('div', { className: 'kbtb-layer' },
          h('div', { className: 'kbtb-scrim', onClick: onClose }),
          h('div', { className: 'kbtb-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, 'data-kb': 'apps-dialog' }, children))
        const Facts = ({ rows }) => h('dl', { className: 'kbtb-facts' }, rows.map((r) => h('div', { key: r.k, className: 'kbtb-fact' + (r.warn ? ' warn' : '') }, h('dt', null, r.k), h('dd', null, r.v, r.sm ? h('small', null, r.sm) : null))))
        /** What the dialog says and shows for its target: the app or table, what is kept or lost, and the name to type back when it is for good. */
        const describeTarget = (p, d) => {
          const app = p.dbs.find((x) => x.id === d.db) || p.archived.find((x) => x.id === d.db) || null
          const away = app !== null && Array.isArray(app.archivedObjects) ? app.archivedObjects : []
          const table = d.table === null ? null : ((app !== null && Array.isArray(app.objects) ? app.objects : []).find((o) => o.key === d.table) || away.find((o) => o.key === d.table) || null)
          const name = d.table === null ? (app === null ? '' : app.name) : (table === null ? '' : table.label)
          return { app, table, name }
        }
        const AppDialog = ({ p }) => {
          const d = p.dialog
          const [typed, setTyped] = useState('')
          const { app, table, name } = describeTarget(p, d)
          const close = () => { if (!d.busy) p.closeDialog() }
          const wholeApp = d.table === null
          const imp = d.impact
          let title, lead, rows
          if (d.kind === 'archive') {
            title = kt('Ranger « ' + name + ' » ?', 'Archive “' + name + '”?')
            lead = wholeApp ? kt('Elle quitte tes apps et Kaby ne la voit plus. Rien n’est supprimé.', 'It leaves your apps and Kaby stops seeing it. Nothing is deleted.') : kt('Elle quitte les onglets et Kaby ne la voit plus.', 'It leaves the tabs and Kaby stops seeing it.')
            rows = wholeApp
              ? [{ k: kt('Gardé', 'Kept'), v: tablesWord(app === null ? 0 : app.objects.length) + ' · ' + rowsWord(app === null ? 0 : rowsIn(app)) + ' · ' + kt('leurs liens et leurs vues', 'their links and views') },
                { k: kt('Rétablir', 'Restore'), v: kt('À tout moment, depuis « Rangées » sous tes apps', 'Any time, from “Archived” under your apps') },
                { k: kt('Supprimer', 'Delete'), v: kt('Seulement depuis là, quand tu le décides', 'Only from there, when you decide') }]
              : [{ k: kt('Gardé', 'Kept'), v: (table === null ? 0 : (table.count || 0)) + ' ' + rowWord(table === null ? 0 : (table.count || 0)) + (table !== null && Array.isArray(table.fields) ? ' · ' + table.fields.length + ' ' + plural(table.fields.length, 'champ', 'champs', 'field', 'fields') : ''), sm: kt('Ses liens avec les autres tables sont gardés, en pause', 'Its links to the other tables are kept, paused') },
                { k: kt('Rétablir', 'Restore'), v: kt('À tout moment, depuis le menu ⋯ de l’app › Tables rangées', 'Any time, from the ⋯ menu of the app › Archived tables') }]
          } else {
            title = kt('Supprimer « ' + name + ' » pour de bon ?', 'Delete “' + name + '” for good?')
            lead = wholeApp ? kt('Cela ne peut pas être annulé. Si tu peux en avoir encore besoin, garde-la rangée.', 'This can’t be undone. If you may need it again, keep it archived.') : kt('Cela ne peut pas être annulé.', 'This can’t be undone.')
            if (imp === null) rows = [{ k: kt('Ce qui disparaît', 'What disappears'), v: d.error === null ? kt('Calcul en cours…', 'Working it out…') : '—' }]
            else if (wholeApp) {
              rows = [{ k: kt('Ce qui disparaît', 'What disappears'), v: [tablesWord(imp.tables), rowsWord(imp.rows)].concat(imp.links > 0 ? [linksWord(imp.links)] : [], imp.files > 0 ? [imp.files + ' ' + plural(imp.files, 'fichier', 'fichiers', 'file', 'files')] : [], [kt('leurs vues', 'their views')]).join(' · '), warn: true },
                { k: kt('Peut-elle revenir ?', 'Can it come back?'), v: kt('Non', 'No'), sm: kt('Il n’y a plus de copie une fois supprimée', 'There is no copy once it is deleted') }]
            } else {
              rows = [{ k: kt('Ce qui disparaît', 'What disappears'), v: imp.rows + ' ' + rowWord(imp.rows) + ' · ' + imp.fields + ' ' + plural(imp.fields, 'champ', 'champs', 'field', 'fields'), warn: true },
                { k: kt('Liens retirés', 'Links removed'), v: imp.cut.length === 0 ? kt('Aucun', 'None') : imp.cut.map((c) => c.objectLabel + ' › ' + c.fieldLabel + ' (' + linksWord(c.links) + ')').join(' ; '), sm: imp.cut.length === 0 ? '' : kt('Les tables liées perdent leur champ « ' + name + ' »', 'The linked tables lose their “' + name + '” field') }]
            }
          }
          const sure = d.kind === 'archive' || (imp !== null && confirmOk(typed, name))
          return h(Dialog, { label: title, onClose: close },
            h('h3', null, title), h('p', { className: 'kbtb-lead' }, lead), h(Facts, { rows }),
            d.kind === 'delete' ? h('label', { className: 'kbtb-typed' }, h('span', null, kt('Tape le nom pour confirmer : ', 'Type the name to confirm: '), h('b', null, name)),
              h('input', { className: 'kbtb-inp', type: 'text', autoComplete: 'off', autoFocus: true, 'data-kb': 'apps-typed', 'aria-label': kt('Tape le nom pour confirmer', 'Type the name to confirm'), value: typed, onChange: (e) => setTyped(e.target.value) })) : null,
            d.error ? h('p', { className: 'kbtb-ferr', role: 'alert', 'data-kb': 'apps-dialog-error' }, d.error) : null,
            h('div', { className: 'kbtb-acts' },
              h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-cancel', disabled: d.busy, onClick: close }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbtb-btn ' + (d.kind === 'delete' ? 'danger' : 'primary'), 'data-kb': 'apps-confirm', disabled: !sure || d.busy, onClick: () => p.runDialog(typed) }, d.kind === 'delete' ? kt('Supprimer pour de bon', 'Delete forever') : kt('Ranger', 'Archive'))))
        }
        const TemplateDialog = ({ p }) => {
          const d = p.dialog
          const t = d.template
          return h(Dialog, { label: kt('Ajouter ', 'Add ') + t.name, onClose: () => { if (!d.busy) p.closeDialog() } },
            h('div', { className: 'kbtb-dlgh' }, h(Tile, { app: { id: t.id, name: t.name } }), h('div', null, h('h3', null, kt('Ajouter « ' + t.name + ' » ?', 'Add “' + t.name + '”?')), h('p', { className: 'kbtb-lead' }, t.line))),
            h(Facts, { rows: [{ k: kt('App', 'App'), v: tablesWord(t.tables.length), sm: kt('Créée ici, sur cet ordinateur', 'Created here, on this computer') }] }),
            h('div', { className: 'kbtb-opts2' },
              h('label', { className: 'kbtb-ck' }, h('input', { type: 'checkbox', 'data-kb': 'apps-opt-sample', checked: d.opts.sample, onChange: (e) => p.setTemplateOpt('sample', e.target.checked) }), h('span', null, kt('Ajouter des lignes d’exemple', 'Add sample rows'), h('small', null, kt('Pour que les vues et le tableau de bord ne soient pas vides. Demande à Kaby de les effacer ensuite.', 'So the views and the dashboard are not empty. Ask Kaby to clear them later.')))),
              t.extras !== '' ? h('label', { className: 'kbtb-ck' }, h('input', { type: 'checkbox', 'data-kb': 'apps-opt-kit', checked: d.opts.kit, onChange: (e) => p.setTemplateOpt('kit', e.target.checked) }), h('span', null, kt('Ajouter aussi ce qui vient avec', 'Also add what comes with it'), h('small', null, t.extras.charAt(0).toUpperCase() + t.extras.slice(1) + '.'))) : null),
            d.error ? h('p', { className: 'kbtb-ferr', role: 'alert', 'data-kb': 'apps-dialog-error' }, d.error) : null,
            h('div', { className: 'kbtb-acts' },
              h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-cancel', disabled: d.busy, onClick: () => p.closeDialog() }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbtb-btn primary', 'data-kb': 'apps-confirm', disabled: d.busy, onClick: () => p.runDialog('') }, d.busy ? kt('Ajout…', 'Adding…') : kt('Ajouter l’app', 'Add app'))))
        }
        const fieldList = (items, withProtection) => items.slice(0, 6).map((x) => x.objectLabel + ' › ' + x.fieldLabel + (withProtection ? ' (' + (x.protection === 'secret' ? 'secret' : kt('sensible', 'sensitive')) + ')' : '')).join(' ; ') + (items.length > 6 ? kt(' et ' + (items.length - 6) + ' autres', ' and ' + (items.length - 6) + ' more') : '')
        /** The card of Publish: what goes, where, what it costs, what changes for the app while it is published. Nothing leaves before the confirm button. */
        const PublishDialog = ({ p }) => {
          const d = p.dialog
          const app = p.dbs.find((x) => x.id === d.db) || null
          const name = app === null ? '' : app.name
          const card = d.card
          const can = card !== null && card.can === true
          const hosting = card !== null && plain(card.hosting) ? card.hosting : {}
          const close = () => { if (!d.busy) p.closeDialog() }
          const title = kt('Publier « ' + name + ' » ?', 'Publish “' + name + '”?')
          let lead = ''
          let rows = []
          if (card === null) lead = d.error === null ? kt('Vérification en cours…', 'Checking…') : ''
          else if (can) {
            lead = kt('Une copie de l’app part dans une app web. Ensuite c’est l’app web qui tient les données ; cet ordinateur en garde une copie en lecture seule.', 'A copy of the app goes to a web app. From then on the web app holds the data, and this computer keeps a read-only copy of it.')
            const price = Number.isFinite(hosting.pricePerMonth) && typeof hosting.currency === 'string' && hosting.currency !== ''
            const budget = plain(hosting.budget) && typeof hosting.budget.label === 'string' && hosting.budget.label !== '' ? hosting.budget : null
            rows = [
              { k: kt('Ce qui part', 'What goes'), v: [tablesWord(card.tables), rowsWord(card.rows)].concat(card.files > 0 ? [card.files + ' ' + plural(card.files, 'fichier', 'fichiers', 'file', 'files')] : []).join(' · '), sm: fmtBytes(card.bytes) },
              { k: kt('Où', 'Where'), v: (typeof hosting.name === 'string' && hosting.name !== '' ? hosting.name : kt('Une app web', 'A web app')) + (typeof hosting.region === 'string' && hosting.region !== '' ? ' · ' + hosting.region : ''),
                sm: card.where === 'existing' ? kt('Dans l’app web que tu as déjà', 'Into the web app you already have') : kt('Une nouvelle app web est préparée', 'A new web app is set up') },
            ]
            if (price) rows.push({ k: kt('Coût estimé', 'Estimated cost'), v: priceWord(hosting.pricePerMonth, hosting.currency) + kt(' par mois', ' a month') })
            if (budget !== null) rows.push({ k: kt('Budget', 'Budget'), v: budget.label, sm: Number.isFinite(budget.remaining) ? fmtNumber(budget.remaining) + kt(' restant', ' left') : '' })
            if (hosting.alwaysOn === true) rows.push({ k: kt('Disponibilité', 'Availability'), v: kt('Reste disponible quand cet ordinateur est éteint', 'Stays available when this computer is off') })
            if (Array.isArray(card.personal) && card.personal.length > 0) rows.push({ k: kt('Données personnelles', 'Personal data'), v: fieldList(card.personal, false), sm: kt('Ces champs partent dans l’app web avec le reste.', 'These fields go to the web app with the rest.') })
            rows.push({ k: kt('Pendant la publication', 'While published'), v: kt('Les lignes s’écrivent dans l’app web. La structure et les vues ne changent plus ici ; arrête la publication pour les changer.', 'Rows are written in the web app. The structure and the views can’t change here; unpublish to change them.') })
          } else {
            const why = {
              sensitive: kt('Cette app a des champs marqués sensibles ou secrets. Ils ne partent jamais dans une app web : elle ne peut pas être publiée telle quelle.', 'This app has fields marked sensitive or secret. They are never sent to a web app, so it can’t be published as it is.'),
              budget: kt('Le budget prévu pour l’app web est épuisé.', 'The budget for the web app is used up.'),
              'too-big': kt('Cette app est trop grosse pour être publiée d’un coup (' + fmtBytes(card.bytes) + ').', 'This app is too big to publish in one go (' + fmtBytes(card.bytes) + ').'),
              archived: kt('Cette app est rangée : rétablis-la d’abord.', 'This app is archived: restore it first.'),
              busy: kt('Une publication ou un retrait est déjà en cours pour cette app.', 'This app is already being published or unpublished.'),
              published: kt('Cette app est déjà publiée.', 'This app is already published.'),
              unavailable: kt('La publication n’est pas disponible sur cet ordinateur.', 'Publishing is not available on this computer.'),
            }
            lead = why[card.reason] || kt('Cette app ne peut pas être publiée pour l’instant.', 'This app can’t be published right now.')
            if (card.reason === 'sensitive' && Array.isArray(card.blocked)) rows = [{ k: kt('Champs', 'Fields'), v: fieldList(card.blocked, true), sm: kt('Demande à Kaby de les retirer ou de changer leur protection, puis réessaie.', 'Ask Kaby to remove them or change their protection, then try again.') }]
            if (card.reason === 'budget' && plain(hosting.budget) && typeof hosting.budget.label === 'string') rows = [{ k: kt('Budget', 'Budget'), v: hosting.budget.label, sm: Number.isFinite(hosting.budget.remaining) ? fmtNumber(hosting.budget.remaining) + kt(' restant', ' left') : '' }]
          }
          return h(Dialog, { label: title, onClose: close },
            h('div', { className: 'kbtb-dlgh' }, app === null ? null : h(Tile, { app }), h('div', null, h('h3', null, title), lead !== '' ? h('p', { className: 'kbtb-lead' }, lead) : null)),
            rows.length > 0 ? h(Facts, { rows }) : null,
            d.busy ? h('p', { className: 'kbtb-note faint', role: 'status', 'data-kb': 'apps-publishing' }, kt('Cela peut prendre une minute.', 'This can take a minute.')) : null,
            d.error ? h('p', { className: 'kbtb-ferr', role: 'alert', 'data-kb': 'apps-dialog-error' }, d.error) : null,
            h('div', { className: 'kbtb-acts' },
              h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-cancel', disabled: d.busy, onClick: close }, can || (card === null && d.error === null) ? kt('Annuler', 'Cancel') : kt('Fermer', 'Close')),
              can ? h('button', { type: 'button', className: 'kbtb-btn primary', 'data-kb': 'apps-confirm', disabled: d.busy, onClick: () => p.runDialog('') }, d.busy ? kt('Publication…', 'Publishing…') : kt('Publier', 'Publish')) : null))
        }
        /** Unpublish: the app comes back as the web app holds it now. When the web app cannot be reached, the way out that keeps this computer's copy is offered, behind the app's typed name. */
        const UnpublishDialog = ({ p }) => {
          const d = p.dialog
          const [typed, setTyped] = useState('')
          const app = p.dbs.find((x) => x.id === d.db) || null
          const name = app === null ? '' : app.name
          const pub = pubOf(app)
          const close = () => { if (!d.busy) p.closeDialog() }
          const ago = pub !== null && typeof pub.lastSync === 'string' ? agoWord(pub.lastSync) : ''
          const title = d.forget ? kt('Garder la copie locale de « ' + name + ' » ?', 'Keep the local copy of “' + name + '”?') : kt('Arrêter la publication de « ' + name + ' » ?', 'Unpublish “' + name + '”?')
          const lead = d.forget
            ? kt('À utiliser seulement si l’app web reste injoignable. Cet ordinateur garde sa copie et oublie l’app web, sans rien lui demander.', 'Use this only if the web app stays out of reach. This computer keeps its copy and forgets the web app, without asking it anything.')
            : kt('L’app revient sur cet ordinateur telle qu’elle est dans l’app web à l’instant, puis l’app web est retirée.', 'The app comes back to this computer as it is in the web app right now, then the web app is taken down.')
          const rows = d.forget
            ? [{ k: kt('Gardé ici', 'Kept here'), v: kt('La copie de cet ordinateur', 'The copy on this computer'), sm: ago !== '' ? kt('Telle qu’elle était ' + ago, 'As it was ' + ago) : '' },
              { k: kt('L’app web', 'The web app'), v: kt('Laissée telle quelle, en ligne. Cet ordinateur ne la suit plus, et ce qui y est écrit ensuite ne revient pas ici.', 'Left as it is, online. This computer stops following it, and what is written there afterwards does not come back here.'), warn: true }]
            : [{ k: kt('Revient ici', 'Comes back'), v: kt('Toutes les lignes et tous les fichiers, tels qu’ils sont dans l’app web', 'Every row and file, as they are in the web app') },
              { k: kt('L’app web', 'The web app'), v: kt('Est retirée : plus personne ne peut l’ouvrir', 'Is taken down: nobody can open it any more') },
              { k: kt('Ensuite', 'Afterwards'), v: kt('L’app redevient privée : tu peux changer sa structure et ses vues, et la publier de nouveau plus tard.', 'The app is private again: you can change its structure and views, and publish it again later.') }]
          const sure = !d.forget || confirmOk(typed, name)
          return h(Dialog, { label: title, onClose: close },
            h('div', { className: 'kbtb-dlgh' }, app === null ? null : h(Tile, { app }), h('div', null, h('h3', null, title), h('p', { className: 'kbtb-lead' }, lead))),
            h(Facts, { rows }),
            d.forget ? h('label', { className: 'kbtb-typed' }, h('span', null, kt('Tape le nom pour confirmer : ', 'Type the name to confirm: '), h('b', null, name)),
              h('input', { className: 'kbtb-inp', type: 'text', autoComplete: 'off', autoFocus: true, 'data-kb': 'apps-typed', 'aria-label': kt('Tape le nom pour confirmer', 'Type the name to confirm'), value: typed, onChange: (e) => setTyped(e.target.value) })) : null,
            d.busy && !d.forget ? h('p', { className: 'kbtb-note faint', role: 'status', 'data-kb': 'apps-unpublishing' }, kt('Cela peut prendre un moment.', 'This can take a moment.')) : null,
            d.error ? h('p', { className: 'kbtb-ferr', role: 'alert', 'data-kb': 'apps-dialog-error' }, d.error) : null,
            h('div', { className: 'kbtb-acts' },
              h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-cancel', disabled: d.busy, onClick: close }, kt('Annuler', 'Cancel')),
              d.canForget === true && !d.forget ? h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-forget', disabled: d.busy, onClick: () => p.startForget() }, kt('Garder ma copie locale…', 'Keep my local copy…')) : null,
              h('button', { type: 'button', className: 'kbtb-btn danger', 'data-kb': 'apps-confirm', disabled: !sure || d.busy, onClick: () => p.runDialog(typed) }, d.forget ? kt('Garder ma copie et oublier l’app web', 'Keep my copy and forget the web app') : d.busy ? kt('Retrait…', 'Unpublishing…') : kt('Arrêter la publication', 'Unpublish'))))
        }
        const Dialogs = ({ p }) => (p.dialog === null ? null : p.dialog.kind === 'template' ? h(TemplateDialog, { p }) : p.dialog.kind === 'publish' ? h(PublishDialog, { p }) : p.dialog.kind === 'unpublish' ? h(UnpublishDialog, { p }) : h(AppDialog, { p }))

        // ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
        const EMPTY_SEL = { db: '', object: '', views: {} }
        const readSel = () => {
          try {
            const v = JSON.parse(localStorage.getItem(SEL_KEY) || 'null')
            return plain(v) ? { db: typeof v.db === 'string' ? v.db : '', object: typeof v.object === 'string' ? v.object : '', views: plain(v.views) ? v.views : {} } : EMPTY_SEL
          } catch (e) { return EMPTY_SEL }
        }
        const writeSel = (s) => { try { localStorage.setItem(SEL_KEY, JSON.stringify(s)) } catch (e) { /* private mode: the choice lasts until the page closes */ } return s }
        const help = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-db' }) : null)

        const Page = (props) => {
          const tb = props.toolbar !== null && props.toolbar !== undefined && typeof props.toolbar.KbToolbar === 'function' ? props.toolbar : null
          const [coreState, setCoreState] = useState(K !== null ? 'ok' : 'loading')
          const [data, setData] = useState({ status: 'loading', dbs: [], archived: [], unreadable: [], today: '', hosting: null, error: null, stale: false })
          const [sel, setSel] = useState(readSel)
          const [rec, setRec] = useState({ key: '', status: 'idle', rows: [], fingerprint: '', truncated: false, error: null })
          const [related, setRelated] = useState({})
          const [reload, setReload] = useState(0)
          const [query, setQuery] = useState('')
          const [menu, setMenu] = useState(null)
          const [, setDrafts] = useState({})
          const [work, setWork] = useState(null)
          const [drawer, setDrawer] = useState(null)
          const [newApp, setNewApp] = useState(false)
          const [fold, setFold] = useState(false)
          const [dialog, setDialog] = useState(null)
          const [templates, setTemplates] = useState(null)
          const [toast, setToast] = useState(null)
          const [months, setMonths] = useState({})
          const [syncBusy, setSyncBusy] = useState('')
          const [, setClock] = useState(0)
          const live = useRef({})
          const alive = useRef(true)
          const draftRef = useRef({})
          const dialogRef = useRef(null)
          const saveTimers = useRef({})
          const seen = useRef({})
          const lastRaw = useRef('')
          const inflight = useRef(false)
          const toastTimer = useRef(null)
          const toastSeq = useRef(0)
          const triedDefault = useRef(new Set())
          const wrapRef = useRef(null)

          // ── what is on screen: the gallery, the form for a new app, or one app (a table, or the Relations tab) ──
          const db = data.dbs.find((d) => d.id === sel.db) || null
          const relTab = db !== null && sel.object === REL_TAB && db.objects.length > 1
          const obj = db !== null && !relTab ? (db.objects.find((o) => o.key === sel.object) || db.objects[0] || null) : null
          const ready = coreState === 'ok' && db !== null && obj !== null
          const screen = newApp ? 'new' : db !== null ? 'app' : 'gallery'
          const serverViews = ready ? (obj.views.length > 0 ? obj.views : [defaultView(obj)]) : []
          const views = serverViews.map((v) => (draftRef.current[v.id] !== undefined && draftRef.current[v.id].object === obj.key && draftRef.current[v.id].db === db.id ? draftRef.current[v.id].view : v))
          const wanted = ready ? sel.views[db.id + '/' + obj.key] : undefined
          const view = ready ? (views.find((v) => v.id === wanted) || views.find((v) => v.fav) || views[0]) : null
          const flt = ready ? (menu === 'filter' && work !== null && work.viewId === view.id ? work.flt : view.state.flt) : null
          const ctx = useMemo(() => {
            if (!ready) return null
            const c = makeCtx(data.today, db.objects, related)
            c.open = (field, id) => live.current.openLinked(field.to, id)
            c.fileUrl = (field, r, f) => fileUrl(live.current.db.id, live.current.obj.key, r.id, field, f)
            return c
          }, [ready, data.today, db, related])
          const mine = rec.key === (ready ? db.id + '/' + obj.key : '') ? rec : { rows: [], status: 'loading', truncated: false }
          const rows = useMemo(() => (ready && mine.status === 'ok' ? K.queryRecords(mine.rows, { fields: obj.fields, q: query, flt, sorts: view.state.sorts }, ctx) : []), [ready, mine, obj, query, flt, view, ctx])
          live.current = { db, obj, view, views, ready, sel: sel.views, all: mine.rows, openLinked: () => {} }
          dialogRef.current = dialog

          // ── small helpers ──
          const say = useCallback((text, action) => {
            toastSeq.current += 1
            setToast({ id: toastSeq.current, text, action: action || null })
            try { if (toastTimer.current !== null) clearTimeout(toastTimer.current) } catch (e) { /* no timers */ }
            toastTimer.current = setTimeout(() => { if (alive.current) setToast(null) }, action ? TOAST_UNDO_MS : TOAST_MS)
          }, [])
          const choose = (patch) => setSel((s) => writeSel(Object.assign({}, s, patch)))
          const patchView = (dbId, objKey, view2) => setData((d) => Object.assign({}, d, { dbs: d.dbs.map((x) => (x.id !== dbId ? x : Object.assign({}, x, { objects: x.objects.map((o) => (o.key !== objKey ? o : Object.assign({}, o, { views: o.views.some((v) => v.id === view2.id) ? o.views.map((v) => (v.id === view2.id ? view2 : v)) : o.views.concat([view2]) }))) }))) }))

          // ── the state, and what Kaby did to the views meanwhile ──
          const refresh = useCallback(async () => {
            if (inflight.current) return
            inflight.current = true
            try {
              const r = await call('GET', '/state')
              if (!alive.current) return
              if (!r.ok) { setData((d) => (d.status === 'ok' ? Object.assign({}, d, { stale: true }) : Object.assign({}, d, { status: 'error', error: r }))); return }
              const raw = JSON.stringify(r)
              if (raw === lastRaw.current) { setData((d) => (d.stale ? Object.assign({}, d, { stale: false }) : d)); return }
              lastRaw.current = raw
              const events = []
              const pending = new Set(Object.keys(draftRef.current))
              for (const d of r.dbs) {
                const idx = viewIndex(d.objects)
                if (seen.current[d.id] !== undefined) for (const e of agentViewEvents(seen.current[d.id], idx, pending)) events.push(Object.assign({ db: d.id }, e))
                seen.current[d.id] = idx
              }
              setData({ status: 'ok', dbs: r.dbs, archived: Array.isArray(r.archived) ? r.archived : [], unreadable: r.unreadable || [], today: r.today, hosting: plain(r.hosting) ? r.hosting : null, error: null, stale: false })
              if (events.length > 0) announce(events)
            } finally { inflight.current = false }
          }, [])
          const announce = (events) => {
            const e = events[0]
            if (events.length > 1) { say(kt('Kaby a changé ' + events.length + ' vues.', 'Kaby changed ' + events.length + ' views.')); return }
            if (e.kind === 'made') {
              say(kt('Kaby a créé la vue « ' + e.view.name + ' ».', 'Kaby made the view “' + e.view.name + '”.'), { label: kt('Ouvrir', 'Open'), run: () => choose({ db: e.db, object: e.object, views: Object.assign({}, live.current.sel, { [e.db + '/' + e.object]: e.id }) }) })
              return
            }
            say(kt('Kaby a modifié la vue « ' + e.view.name + ' ».', 'Kaby changed the view “' + e.view.name + '”.'), { label: kt('Annuler', 'Undo'), run: async () => { const r = await call('POST', '/view', { db: e.db, object: e.object, op: 'save', view: e.before }); if (!r.ok) say(errorText(r)); refresh() } })
          }

          // ── saving a view as it is edited (its filter, sort and fields: what the person sees, never a row) ──
          const putDraft = (id, entry) => { draftRef.current = Object.assign({}, draftRef.current, { [id]: entry }); setDrafts(draftRef.current) }
          const dropDraft = (id, entry) => { if (draftRef.current[id] !== entry) return; const next = Object.assign({}, draftRef.current); delete next[id]; draftRef.current = next; setDrafts(next) }
          const saveDraft = async (id) => {
            const entry = draftRef.current[id]
            if (entry === undefined || entry.local === true) return
            try { clearTimeout(saveTimers.current[id]) } catch (e) { /* no timer */ }
            delete saveTimers.current[id]
            const r = await call('POST', '/view', { db: entry.db, object: entry.object, op: 'save', view: savable(entry.view, entry.obj) })
            if (!alive.current) return
            if (r.ok) patchView(entry.db, entry.object, r.view)
            else say(errorText(r))
            dropDraft(id, entry)
            refresh()
          }
          const schedule = (id, now) => {
            try { clearTimeout(saveTimers.current[id]) } catch (e) { /* no timer */ }
            if (now) { saveDraft(id); return }
            saveTimers.current[id] = setTimeout(() => saveDraft(id), SAVE_MS)
          }
          /** Changes a view of the current table and saves it; `fn` gets a copy and returns the changed view. */
          const updateView = (id, fn, now) => {
            const L = live.current
            if (!L.ready) return
            const base = L.views.find((v) => v.id === id)
            if (!base) return
            const next = fn(copy(base))
            if (same(next, base)) return
            // a published app's saved views are the web app's: an edit lasts for this visit only and is never sent
            const local = pubOf(L.db) !== null
            putDraft(id, { view: next, db: L.db.id, object: L.obj.key, obj: L.obj, local })
            if (!local) schedule(id, now === true)
          }
          const editView = (fn) => { const L = live.current; if (L.ready) updateView(L.view.id, fn, false) }
          const setFlt = (next) => {
            const L = live.current
            if (!L.ready) return
            setWork({ viewId: L.view.id, flt: next })
            editView((v) => { v.state.flt = K.prepareFilter(next, L.obj.fields); return v })
          }
          const sortBy = (key, shift) => editView((v) => { v.state.sorts = nextSorts(v.state.sorts, key, shift); return v })
          const filterBy = (key) => {
            const L = live.current
            const f = L.obj.fields.find((x) => x.key === key)
            if (!f) return
            if (!K.flatConditions(L.view.state.flt).some((c) => !K.isGroup(c) && c.k === key)) {
              const next = K.prepareFilter(L.view.state.flt, L.obj.fields)
              setWork({ viewId: L.view.id, flt: Object.assign({}, next, { items: next.items.concat([newCondition(f)]) }) })
            }
            setMenu('filter')
          }
          const clearAll = () => { setQuery(''); setFlt(K.blankFilter()) }
          const selectView = (id) => { const L = live.current; choose({ views: Object.assign({}, sel.views, { [L.db.id + '/' + L.obj.key]: id }) }); setMenu(null) }

          // ── rows are read here: one opens in the drawer, a link followed from it opens the row it points at ──
          const openRecord = (id) => { setMenu(null); setDrawer({ id }) }
          /** Opens a row of any table of the app (a chip, a « Linked from » row): the table comes up under the drawer, and Back returns to where the click was. */
          const openLinked = (objKey, id) => {
            const L = live.current
            if (!L.ready || !L.db.objects.some((o) => o.key === objKey)) return
            setMenu(null)
            setDrawer((d) => {
              let trail = []
              if (d !== null) {
                const here = L.all.find((r) => r.id === d.id)
                trail = (Array.isArray(d.trail) ? d.trail : []).concat([{ object: L.obj.key, id: d.id, label: here ? titleOf(L.obj, here) : L.obj.label }])
              } else trail = [{ object: L.obj.key, id: null, label: L.obj.label }]
              return { id, trail: trail.slice(-TRAIL_MAX) }
            })
            if (objKey !== L.obj.key) { setQuery(''); choose({ object: objKey }) }
          }
          const goBack = () => {
            if (drawer === null || !Array.isArray(drawer.trail) || drawer.trail.length === 0) return
            const prev = drawer.trail[drawer.trail.length - 1]
            setDrawer(prev.id === null ? null : { id: prev.id, trail: drawer.trail.slice(0, -1) })
            if (prev.object !== live.current.obj.key) { setQuery(''); choose({ object: prev.object }) }
          }
          const openTable = (key) => { setQuery(''); setDrawer(null); setMenu(null); choose({ object: key }) }
          const openApp = (id) => { setQuery(''); setDrawer(null); setMenu(null); setDialog(null); setNewApp(false); choose({ db: id, object: '' }) }
          const goGallery = () => { setQuery(''); setDrawer(null); setMenu(null); setDialog(null); setNewApp(false); choose({ db: '' }) }
          const startNew = () => { setMenu(null); setDrawer(null); setNewApp(true) }
          live.current.openLinked = openLinked

          // ── Kaby: a chat opens with the sentence written, the person reads it and sends it ──
          const ask = (text) => { try { if (typeof window.__KB_ASK__ === 'function') return window.__KB_ASK__(text) !== false } catch (e) { /* the chat could not open */ } return false }
          /** Opens a chat about what is on screen (or with `text`); when no chat can open, the sentence is copied instead. */
          const askKaby = (text) => {
            const L = live.current
            const sentence = typeof text === 'string' ? text : (L.db === null ? buildText('') : askAbout(L.db, L.obj, L.ready ? L.view : null))
            setMenu(null)
            if (ask(sentence)) return
            try { navigator.clipboard.writeText(sentence).then(() => say(kt('Le chat ne peut pas s’ouvrir d’ici : la phrase est copiée, colle-la dans un chat avec Kaby.', 'The chat cannot open from here: the sentence is copied, paste it in a chat with Kaby.')), () => say(kt('Le chat ne peut pas s’ouvrir d’ici. Ouvre un chat avec Kaby et décris le changement.', 'The chat cannot open from here. Open a chat with Kaby and describe the change.'))) } catch (e) { say(kt('Le chat ne peut pas s’ouvrir d’ici. Ouvre un chat avec Kaby et décris le changement.', 'The chat cannot open from here. Open a chat with Kaby and describe the change.')) }
          }

          // ── putting away, bringing back, deleting for good ──
          const appCall = (body) => call('POST', '/app', body)
          const restoreApp = async (id) => {
            const r = await appCall({ db: id, op: 'restore' })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            say(kt('App rétablie.', 'App restored.'))
            refresh()
          }
          const restoreTable = async (dbId, key) => {
            setMenu(null)
            const r = await appCall({ db: dbId, object: key, op: 'restore' })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            say(kt('Table rétablie.', 'Table restored.'))
            refresh()
          }
          const isPublished = (dbId) => pubOf(data.dbs.find((x) => x.id === dbId)) !== null
          const confirmArchive = (dbId, objKey) => {
            setMenu(null)
            if (isPublished(dbId)) { say(errorText({ error: 'published' })); return }
            setDialog({ kind: 'archive', db: dbId, table: objKey || null, impact: null, busy: false, error: null })
          }
          const confirmDelete = async (dbId, objKey) => {
            setMenu(null)
            if (isPublished(dbId)) { say(errorText({ error: 'published' })); return }
            const target = objKey || null
            setDialog({ kind: 'delete', db: dbId, table: target, impact: null, busy: false, error: null })
            const r = await call('GET', '/impact' + qs({ db: dbId, object: target || '' }))
            if (!alive.current) return
            setDialog((d) => (d !== null && d.kind === 'delete' && d.db === dbId && d.table === target ? Object.assign({}, d, r.ok ? { impact: r } : { error: errorText(r) }) : d))
          }
          const runDialog = async (typed) => {
            const d = dialogRef.current
            if (d === null || d.busy) return
            setDialog(Object.assign({}, d, { busy: true, error: null }))
            if (d.kind === 'template') {
              const seam = tplSeam()
              const r = seam === null ? { ok: false, error: 'network' } : await Promise.resolve().then(() => seam.add(d.template.id, { sample: d.opts.sample, kit: d.opts.kit })).catch(() => ({ ok: false }))
              if (!alive.current) return
              if (!r || r.ok !== true) { setDialog((cur) => (cur === null ? cur : Object.assign({}, cur, { busy: false, error: r && typeof r.message === 'string' && r.message !== '' ? r.message : kt('L’app n’a pas pu être ajoutée.', 'The app could not be added.') }))); return }
              setDialog(null)
              await refresh()
              if (!alive.current) return
              if (typeof r.appId === 'string' && r.appId !== '') openApp(r.appId); else setNewApp(false)
              say(kt('App ajoutée.', 'App added.'))
              return
            }
            if (d.kind === 'publish') {
              const r = await call('POST', '/publish', { db: d.db, confirm: true })
              if (!alive.current) return
              if (!r.ok) { setDialog((cur) => (cur === null ? cur : Object.assign({}, cur, { busy: false, error: errorText(r) }))); return }
              setDialog(null)
              const host = plain(r.published) ? hostWord(r.published.url) : ''
              say(host !== '' ? kt('Publiée sur ' + host + '.', 'Published at ' + host + '.') : kt('Publiée.', 'Published.'), { label: kt('Ouvrir l’app web', 'Open web app'), run: () => openWeb(d.db) })
              refresh()
              return
            }
            if (d.kind === 'unpublish') {
              const r = await call('POST', '/unpublish', d.forget ? { db: d.db, forget: true, confirm: typed } : { db: d.db })
              if (!alive.current) return
              if (!r.ok) { setDialog((cur) => (cur === null ? cur : Object.assign({}, cur, { busy: false, error: errorText(r), canForget: r.canForget === true || cur.canForget === true }))); return }
              setDialog(null)
              dropLocalDrafts(d.db)
              say(r.forgotten === true ? kt('Cet ordinateur ne suit plus l’app web. Ta copie est gardée.', 'This computer no longer follows the web app. Your copy is kept.') : kt('Publication arrêtée. L’app est de nouveau sur cet ordinateur seulement.', 'Unpublished. The app is back on this computer only.'))
              refresh()
              return
            }
            const body = { db: d.db, op: d.kind, confirm: typed }
            if (d.table !== null) body.object = d.table
            const r = await appCall(body)
            if (!alive.current) return
            if (!r.ok) { setDialog((cur) => (cur === null ? cur : Object.assign({}, cur, { busy: false, error: errorText(r) }))); return }
            setDialog(null)
            const L = live.current
            if (d.kind === 'archive') {
              if (d.table === null && L.db !== null && L.db.id === d.db) choose({ db: '' })
              if (d.table !== null && L.obj !== null && L.obj.key === d.table) choose({ object: '' })
              say(d.table === null ? kt('App rangée. Elle est sous « Rangées », sous tes apps.', 'App archived. Find it under “Archived” below your apps.') : kt('Table rangée. Rétablis-la depuis le menu ⋯ de l’app.', 'Table archived. Restore it from the ⋯ menu of the app.'),
                { label: kt('Annuler', 'Undo'), run: () => (d.table === null ? restoreApp(d.db) : restoreTable(d.db, d.table)) })
            } else say(d.table === null ? kt('App supprimée pour de bon.', 'App deleted for good.') : kt('Table supprimée pour de bon.', 'Table deleted for good.'))
            refresh()
          }
          // ── Publish: the card, the web app, the copy kept here ──
          const openPublish = async (dbId) => {
            setMenu(null)
            setDialog({ kind: 'publish', db: dbId, card: null, busy: false, error: null })
            const r = await call('GET', '/publish-check' + qs({ db: dbId }))
            if (!alive.current) return
            setDialog((d) => (d !== null && d.kind === 'publish' && d.db === dbId ? Object.assign({}, d, r.ok ? { card: r } : { error: errorText(r) }) : d))
          }
          const openUnpublish = (dbId) => { setMenu(null); setDialog({ kind: 'unpublish', db: dbId, forget: false, canForget: false, busy: false, error: null }) }
          const startForget = () => setDialog((d) => (d !== null && d.kind === 'unpublish' ? Object.assign({}, d, { forget: true, error: null }) : d))
          /** The edits a person made to the views of an app while it was published are gone with the publication. */
          const dropLocalDrafts = (dbId) => {
            const next = {}
            for (const k of Object.keys(draftRef.current)) { const e = draftRef.current[k]; if (!(e.local === true && e.db === dbId)) next[k] = e }
            draftRef.current = next
            setDrafts(next)
          }
          const openWeb = async (dbId) => {
            setMenu(null)
            const r = await openWebApp(dbId)
            if (!alive.current) return
            if (!r.ok) say(errorText(r))
          }
          const refreshNow = async (dbId) => {
            setSyncBusy(dbId)
            const r = await call('POST', '/refresh', { db: dbId })
            if (!alive.current) return
            setSyncBusy('')
            if (!r.ok) say(errorText(r))
            await refresh()
          }
          const openTemplate = (id) => {
            const t = templates !== null && templates.status === 'ok' ? templates.list.find((x) => x.id === id) : undefined
            if (t !== undefined) setDialog({ kind: 'template', template: t, opts: { sample: true, kit: true }, busy: false, error: null })
          }
          const setTemplateOpt = (key, on) => setDialog((d) => (d !== null && d.kind === 'template' ? Object.assign({}, d, { opts: Object.assign({}, d.opts, { [key]: on === true }) }) : d))

          // ── effects ──
          useEffect(() => {
            alive.current = true
            return () => {
              alive.current = false
              try { if (toastTimer.current !== null) clearTimeout(toastTimer.current) } catch (e) { /* no timers */ }
              for (const id of Object.keys(saveTimers.current)) { try { clearTimeout(saveTimers.current[id]) } catch (e) { /* no timer */ } }
              // an edit still waiting for its save is sent now: leaving the page must not lose the last click
              for (const id of Object.keys(draftRef.current)) { const e = draftRef.current[id]; if (e.local !== true) call('POST', '/view', { db: e.db, object: e.object, op: 'save', view: savable(e.view, e.obj) }) }
            }
          }, [])
          useEffect(() => {
            if (K !== null) { setCoreState('ok'); return undefined }
            let live2 = true
            loadCore().then(() => { if (live2) setCoreState('ok') }, () => { if (live2) setCoreState('error') })
            return () => { live2 = false }
          }, [])
          useEffect(() => {
            if (coreState !== 'ok') return undefined
            refresh()
            const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh() }, POLL_MS)
            const vis = () => { if (document.visibilityState === 'visible') refresh() }
            try { document.addEventListener('visibilitychange', vis) } catch (e) { /* no document */ }
            return () => { clearInterval(t); try { document.removeEventListener('visibilitychange', vis) } catch (e) { /* no document */ } }
          }, [coreState])
          // the records of the table on screen: read again when the host's fingerprint of the app moves
          const fingerprint = db !== null ? db.fingerprint : ''
          useEffect(() => {
            if (!ready) return undefined
            const key = db.id + '/' + obj.key
            if (rec.key === key && rec.fingerprint === fingerprint && rec.status === 'ok') return undefined
            let cancelled = false
            ;(async () => {
              if (rec.key !== key) setRec({ key, status: 'loading', rows: [], fingerprint: '', truncated: false, error: null })
              const r = await call('GET', '/records' + qs({ db: db.id, object: obj.key }))
              if (cancelled || !alive.current) return
              const targets = Array.from(new Set(obj.fields.filter((f) => f.type === 'relation').map((f) => f.to))).filter((t) => db.objects.some((o) => o.key === t))
              const rel = {}
              await Promise.all(targets.map(async (t) => { const x = await call('GET', '/records' + qs({ db: db.id, object: t })); if (x.ok) rel[t] = x.records }))
              if (cancelled || !alive.current) return
              setRelated(rel)
              setRec(r.ok ? { key, status: 'ok', rows: r.records, fingerprint: r.fingerprint, truncated: r.truncated === true, error: null } : { key, status: 'error', rows: [], fingerprint: '', truncated: false, error: r })
            })()
            return () => { cancelled = true }
          }, [ready, ready ? db.id : '', ready ? obj.key : '', fingerprint, reload])
          // a table with no saved view gets a plain one, so the first change of what is shown has somewhere to live
          useEffect(() => {
            if (!ready || obj.views.length > 0 || pubOf(db) !== null) return // a published app's views are not ours to save
            const key = db.id + '/' + obj.key
            if (triedDefault.current.has(key)) return
            triedDefault.current.add(key)
            call('POST', '/view', { db: db.id, object: obj.key, op: 'save', view: savable(defaultView(obj), obj) }).then(() => { if (alive.current) refresh() })
          }, [ready, ready ? db.id : '', ready ? obj.key : '', ready ? obj.views.length : 0, ready ? pubOf(db) !== null : false])
          // "Synced 3 min ago" moves on its own, between two changes of the state
          const showsSync = db !== null && pubOf(db) !== null
          useEffect(() => {
            if (!showsSync) return undefined
            const t = setInterval(() => setClock((n) => n + 1), 20000)
            return () => clearInterval(t)
          }, [showsSync])
          // the templates the core offers, read when the form for a new app opens (none, when the core does not offer any)
          useEffect(() => {
            if (!newApp) return undefined
            const seam = tplSeam()
            if (seam === null) { setTemplates({ status: 'absent', list: [] }); return undefined }
            let off = false
            setTemplates({ status: 'loading', list: [] })
            Promise.resolve().then(() => seam.list()).then(
              (list) => { if (!off && alive.current) setTemplates({ status: 'ok', list: (Array.isArray(list) ? list : []).map(templateOf).filter((t) => t !== null) }) },
              () => { if (!off && alive.current) setTemplates({ status: 'absent', list: [] }) })
            return () => { off = true }
          }, [newApp])
          useEffect(() => { if (menu !== 'filter') setWork(null) }, [menu])
          useEffect(() => {
            if (menu === null && drawer === null && dialog === null) return undefined
            // a dialog closes first, then a menu, then the drawer
            const onKey = (e) => { if (e.key === 'Escape') { if (dialogRef.current !== null) { if (!dialogRef.current.busy) setDialog(null) } else if (menu !== null) setMenu(null); else if (drawer !== null) setDrawer(null) } }
            const onDown = (e) => { try { if (menu !== null && e.target.closest && e.target.closest('.kbtb-pw') === null && e.target.closest('[data-kb="tables-th-filter"]') === null) setMenu(null) } catch (x) { setMenu(null) } }
            document.addEventListener('keydown', onKey, true)
            document.addEventListener('mousedown', onDown, true)
            return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true) }
          }, [menu, drawer, dialog])

          // ── the page API the screens, the bar and the popovers share ──
          const p = {
            dbs: data.dbs, archived: data.archived, templates, fold, setFold, dialog,
            db, obj, relTab, view, views, rows, all: mine.rows, rec: mine, ctx, related, flt, menu, drawer, query, months,
            setMenu, setFlt, editView, sortBy, filterBy, clearAll, selectView, askKaby, say,
            favView: (id) => updateView(id, (v) => { v.fav = !v.fav; return v }, true),
            openRecord, openLinked, goBack, openTable, openApp, goGallery, newApp: startNew, closeDrawer: () => setDrawer(null),
            confirmArchive, confirmDelete, restoreApp, restoreTable, closeDialog: () => setDialog(null), runDialog, openTemplate, setTemplateOpt,
            hosting: data.hosting, syncBusy, openPublish, openUnpublish, startForget, openWeb, refreshNow,
            setMonth: (id, ym) => setMonths((m) => Object.assign({}, m, { [id]: ym })),
          }

          // ── drawing ──
          const searchPlaceholder = ready ? kt('Rechercher dans ' + obj.label, 'Search in ' + obj.label) : kt('Rechercher', 'Search')
          const toolbar = !ready ? null
            : tb !== null
              ? h(tb.KbToolbar, { state: { query }, onUpdate: (patch) => { if (patch !== null && typeof patch.query === 'string') setQuery(patch.query) }, hideView: true, hideSort: true, showFav: false, searchPlaceholder, trailing: h(Bar, { p }) })
              : h('div', { className: 'kbtb-plainbar' }, h('label', { className: 'kbtb-find' }, svg('search', 14), h('input', { type: 'search', value: query, 'aria-label': searchPlaceholder, placeholder: searchPlaceholder, onChange: (e) => setQuery(e.target.value) })), h(Bar, { p }))
          const loading = coreState === 'loading' || (data.status === 'loading' && coreState !== 'error')
          const failed = coreState === 'error' || data.status === 'error'

          let head
          let body
          if (loading) {
            head = h(AppHeader, { p, title: kt('Apps', 'Apps') })
            body = h('div', { role: 'status', 'data-kb': 'tables-loading', className: 'kbtb-muted' }, kt('Chargement des apps…', 'Loading apps…'))
          } else if (failed) {
            head = h(AppHeader, { p, title: kt('Apps', 'Apps') })
            body = h('div', { className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-error' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les apps ne sont pas lisibles pour l’instant.', 'Apps cannot be read right now.')), ' ', coreState === 'error' ? kt('Les règles de lecture ne se chargent pas.', 'The reading rules do not load.') : errorText(data.error)),
              h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'tables-retry', onClick: () => { if (coreState === 'error') { setCoreState('loading'); loadCore().then(() => setCoreState('ok'), () => setCoreState('error')) } else refresh() } }, kt('Réessayer', 'Try again')))
          } else if (screen === 'new') {
            head = h(AppHeader, { p, title: kt('Nouvelle app', 'New app'), back: () => setNewApp(false), backLabel: kt('Retour aux apps', 'Back to Apps') })
            body = h(NewApp, { p })
          } else if (screen === 'gallery') {
            head = h(AppHeader, { p, title: kt('Apps', 'Apps'), sub: kt('Tes données, gardées sur cet ordinateur. Chaque app a ses tables, ses lignes et ses vues.', 'Your data, kept on this computer. Each app has its tables, rows and views.'),
              actions: h('button', { type: 'button', className: 'kb8-primary kbtb-new', 'data-kb': 'apps-new', onClick: startNew }, svg('plus', 15), kt('Nouvelle app', 'New app')) })
            body = h(Gallery, { p })
          } else {
            const pub = pubOf(db)
            head = h(AppHeader, { p, tile: h(Tile, { app: db, size: 's' }), title: db.name, pill: pub !== null ? h(PubPill, { pub, hd: true }) : null, back: goGallery, backLabel: kt('Toutes les apps', 'All apps'),
              actions: h('div', { className: 'kbtb-actions' },
                pub !== null ? h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-open-web', onClick: () => openWeb(db.id) }, svg('external', 15), kt('Ouvrir l’app web', 'Open web app'))
                  : canPublishVia(data.hosting) ? h('button', { type: 'button', className: 'kbtb-btn', 'data-kb': 'apps-publish', onClick: () => openPublish(db.id) }, svg('upload', 15), kt('Publier…', 'Publish…')) : null,
                h('button', { type: 'button', className: 'kb8-primary kbtb-new', 'data-kb': 'tables-ask-kaby', onClick: () => askKaby() }, svg('sparkle', 15), kt('Demander à Kaby', 'Ask Kaby')),
                h(AppMenu, { p })) })
            if (db.objects.length === 0) {
              body = h('div', { className: 'kbtb-empty big', 'data-kb': 'tables-none' }, h('b', null, kt('Pas encore de table', 'No table yet')), h('span', null, kt('Dis à Kaby ce que tu veux suivre dans cette app : elle construit les tables et les champs, tu vois ce qui change avant que ce soit fait.', 'Tell Kaby what you want to keep track of in this app: she builds the tables and the fields, and you see what changes before it is done.')),
                h('button', { type: 'button', className: 'kbtb-btn primary', onClick: () => askKaby() }, svg('sparkle', 14), kt('Demander à Kaby', 'Ask Kaby')))
            } else if (relTab) body = h(RelationsView, { p })
            else if (mine.status === 'loading') body = h('div', { role: 'status', 'data-kb': 'tables-loading', className: 'kbtb-muted' }, kt('Chargement des lignes…', 'Loading rows…'))
            else if (mine.status === 'error') {
              body = h('div', { className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-error' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les lignes ne sont pas lisibles.', 'The rows cannot be read.')), ' ', errorText(mine.error)),
                h('button', { type: 'button', className: 'kbtb-btn sm', onClick: () => setReload((n) => n + 1) }, kt('Réessayer', 'Try again')))
            } else if (ready && rows.length === 0 && view.kind !== 'calendar' && view.kind !== 'board') body = h(Empty, { p, why: mine.rows.length > 0 ? 'filtered' : 'none' })
            else if (ready) body = view.kind === 'board' ? h(BoardView, { p }) : view.kind === 'cards' ? h(CardsView, { p }) : view.kind === 'calendar' ? h(CalendarView, { p }) : view.kind === 'map' ? h(GeoView, { p }) : h(TableView, { p })
          }

          const banners = [].concat(
            screen === 'app' && !loading && !failed && db !== null && pubOf(db) !== null ? [h(PublishedNote, { key: 'published', p })] : [],
            screen === 'gallery' ? data.unreadable.map((u) => h('div', { key: 'u' + u.id, className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-unreadable' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, u.name + ' : '), errorText(u)))) : [],
            data.stale ? [h('div', { key: 'stale', className: 'kbtb-banner', role: 'status', 'data-kb': 'tables-stale' }, svg('alert', 16), h('span', { className: 'sp' }, kt('Le serveur local ne répond plus : ce que tu vois peut dater de quelques secondes.', 'The local server is not answering: what you see may be a few seconds old.')))] : [])

          const inTable = screen === 'app' && ready && !loading && !failed
          return h('div', { className: 'kbtb', 'data-kb': 'tables-page', 'data-screen': screen, 'data-view': ready ? view.kind : '', ref: wrapRef },
            h('style', { 'data-plugin': '@local/kybernos-db' }, CSS),
            h('div', { className: 'kbtb-main' },
              head,
              screen === 'app' && !loading && !failed && db !== null ? h(Tabs, { p }) : null,
              banners,
              inTable ? h('div', { className: 'kbtb-tbrow' }, toolbar) : null,
              inTable ? h(Chips, { p }) : null,
              h('div', { className: 'kbtb-body' + (drawer !== null && inTable ? ' has-drawer' : '') },
                h('div', { className: 'kbtb-content' }, body),
                inTable && drawer !== null ? h(Drawer, { key: drawer.id, p }) : null)),
            h(Dialogs, { p }),
            toast !== null ? h('div', { className: 'kbtb-toast', role: 'status', 'data-kb': 'tables-toast', key: toast.id }, svg('check', 15), h('span', null, toast.text), toast.action ? h('button', { type: 'button', className: 'kbtb-tact', 'data-kb': 'tables-toast-action', onClick: () => { const run = toast.action.run; setToast(null); run() } }, toast.action.label) : null) : null)
        }
        // the pieces, handed out for the tests (they render each one in a state the page takes a while to reach)
        Page.parts = { PubPill, PublishedNote, PublishDialog, UnpublishDialog, Bar, MenuButton, ActionMenu, TableMenu, ViewsPop, FieldsPop, FilterPop, SortPop, ValueCell, TableView, BoardView, CardsView, CalendarView, GeoView, MapSwitch, RealMap, MapView, Chips, Drawer, FieldRow, Empty, Gallery, AppCard, ArchivedCard, NewApp, TemplateCard, AppHeader, AppMenu, Tabs, RelationsView, AppDialog, TemplateDialog, Dialogs, Cell, Opt, LinkChips, LinkedFrom, LinkedGroups, LinkMap, Thumb, FileChips }
        return Page
      }

      // ── the plugin ──────────────────────────────────────────────────────────────────────────────────────────────────────
      const start = (ctx) => {
        try {
          const React = require('react')
          const slots = ctx.slots
          if (slots === null || slots === undefined || typeof slots.inject !== 'function') return
          const Page = build(React)
          // The row of the menu: declared here, taken back when the plugin is switched off. The core publishes its registry when IT is applied, and the order in
          // which two plugins are applied is DSH's, so the row waits for the registry instead of assuming it is there.
          ctx.effect(() => {
            let off = null
            let timer = null
            let tries = 0
            const declare = () => {
              timer = null
              try {
                if (window.__KB_MENU__ && typeof window.__KB_MENU__.register === 'function') { off = window.__KB_MENU__.register({ id: ROW_ID, group: 'business', icon: 'grid', labelKey: 'business.apps', label: { en: 'Apps', fr: 'Apps' }, order: 40 }); return }
              } catch (e) { return }
              tries += 1
              if (tries < MENU_TRIES) timer = setTimeout(declare, MENU_WAIT_MS)
            }
            declare()
            return () => {
              try { if (timer !== null) clearTimeout(timer) } catch (e) { /* no timers */ }
              timer = null
              tries = MENU_TRIES
              try { if (typeof off === 'function') off() } catch (e) { /* already taken back */ }
              off = null
            }
          }, 'kybernos-db: menu row')
          ctx.effect(() => slots.inject(SLOT, () => slots.register({ name: SLOT, key: ROW_ID }, Page)), 'kybernos-db: page')
        } catch (e) { console.warn('[kybernos-db] page not mounted:', e) }
      }

      return {
        name: NAME,
        inject: ['slots'],
        apply: start,
        __test: { pubOf, canPublishVia, hostWord, agoWord, syncLine, priceWord, openWebApp, useCore, loadCore, kt, lang, plural, plain, copy, same, hueOfColor, optionOf, fmtNumber, fmtMoney, fmtDate, fmtBytes, MASK, titleOf, makeCtx, isImage, fileUrl, relationFields, seenAs, mapLayout, TYPE_NAME, cellText, opLabel, relDay, fieldOf, valueText, conditionText, itemText, valueKind, defaultOp, defaultValueFor, newCondition, withOp, filterable, pathIdx, nodeAt, mapAt, removeAt, addItem, countConditions, liveFilter, dirLabels, sortableFields, nextSorts, defaultView, savable, barViews, viewIndex, agentViewEvents, boardColumns, pictureOf, totalField, columnTotal, resetMapState: () => { mapFailure = null; webglKnown = null; mapLibPromise = null; mapStyleCache = {} }, MAP_STYLE_KEY, MAP_STYLE_URL, MAP_BUDGET_MS, MAP_RETRY_MS, MAP_LIB, readMapStyle, saveMapStyle, flipColor, compactMoney, pinLabel, pinAmount, placedRecords, MAP_STYLES, mapStyleOf, mapStyleUrl, worldPx, clusterPins, aloneZoom, boundsOf, clusterAction, mapGate, startVerdict, projectPins, parseColor, colorHex, paletteFrom, mapPalette, tweakStyle, flipTokens, monthOf, shiftMonth, monthGrid, monthLabel, askAbout, buildText, STARTS, appHue, monogram, confirmOk, rowsIn, tplSeam, templateOf, REL_TAB, errorText, qs, call, build, CSS, ICONS, ROW_ID, SLOT, SEL_KEY, DATE_PRESETS },
      }
    } catch (e) {
      console.warn('[kybernos-db] disabled:', e)
      return { apply () {} }
    }
  }
})
