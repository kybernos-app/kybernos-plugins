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
      const STAGGER_MAX = 14

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
      /** The records a link picker offers: the ones not chosen yet whose title holds what was typed, by title, at most `max`. */
      const linkOptions = (target, rows, chosen, q, max) => {
        const need = typeof q === 'string' ? q.trim().toLowerCase() : ''
        const taken = new Set(chosen)
        const all = []
        for (const r of Array.isArray(rows) ? rows : []) {
          if (taken.has(r.id)) continue
          const title = titleOf(target, r)
          if (need !== '' && !title.toLowerCase().includes(need)) continue
          all.push({ id: r.id, title })
        }
        all.sort((a, b) => a.title.localeCompare(b.title, lang()))
        return { items: all.slice(0, max), total: all.length }
      }
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
      const KIND_WORD = () => ({ table: kt('Tableau', 'Table'), board: kt('Tableau kanban', 'Board'), cards: kt('Cartes', 'Cards'), calendar: kt('Calendrier', 'Calendar') })
      const KIND_ICON = { table: 'table', board: 'board', cards: 'cards', calendar: 'calendar' }
      const defaultViewId = (obj) => 'default-' + obj.key
      /** The view an object shows until it has a saved one: a plain table. */
      const defaultView = (obj) => ({ id: defaultViewId(obj), name: kt('Tableau', 'Table'), kind: 'table', owner: 'me', fav: true, state: { flt: K.blankFilter(), sorts: [], hidden: [] } })
      /** A name for a new view of a kind that no view of the object has yet: « Board », then « Board 2 »… */
      const freshName = (views, kind) => {
        const base = KIND_WORD()[kind]
        const taken = new Set(views.map((v) => v.name))
        if (!taken.has(base)) return base
        let n = 2
        while (taken.has(base + ' ' + n)) n += 1
        return base + ' ' + n
      }
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

      // ── the chat sentence « Modify view » writes ────────────────────────────────────────────────────────────────────────
      /** The first message of the chat that asks Kaby to change a view: which view, which table, and the limit of what she may change. */
      const askText = (db, obj, view, text) => kt(
        'Sur la page Tables, modifie la vue « ' + view.name + ' » (id ' + view.id + ') de la table « ' + obj.label + ' » (clé ' + obj.key + ', base ' + db.id + ') comme suit : ' + text.trim() + '\nUtilise view_save avec cet id de vue, et ne change que ce que la vue montre (filtre, tri, champs, présentation), jamais les enregistrements ni la structure.',
        'On the Tables page, change the view “' + view.name + '” (id ' + view.id + ') of the table “' + obj.label + '” (key ' + obj.key + ', database ' + db.id + ') as follows: ' + text.trim() + '\nUse view_save with that view id and change only what the view shows (filter, sort, fields, layout), never the records or the structure.')
      /** What Kaby is asked to build when there is no table yet. */
      const buildText = (text) => (text.trim() === ''
        ? kt('Sur la page Tables, je voudrais suivre : ', 'On the Tables page, I would like to keep track of: ')
        : kt('Sur la page Tables : ' + text.trim() + '\nUtilise le skill db-builder pour concevoir les tables, puis montre-moi ce qui a été créé.', 'On the Tables page: ' + text.trim() + '\nUse the db-builder skill to design the tables, then show me what was created.'))
      const EXAMPLES = () => [kt('Mes tâches, avec un statut et une échéance', 'My tasks, with a status and a due date'), kt('Mes clients et leurs commandes', 'My customers and their orders'), kt('Ma collection de livres', 'My book collection')]

      /** Views an object is asked for in the Modify view examples. */
      const modifyExamples = (obj) => {
        const out = []
        const choice = obj.fields.find((f) => f.type === 'choice')
        const date = obj.fields.find((f) => f.type === 'date')
        const num = obj.fields.find((f) => f.type === 'number' || f.type === 'money')
        if (choice && choice.options.length > 1) out.push(kt(choice.label + ' : ' + choice.options[0].label + ' seulement', choice.label + ': only ' + choice.options[0].label))
        if (date) out.push(kt(date.label + ' dans les 7 prochains jours, la plus proche d’abord', date.label + ' in the next 7 days, soonest first'))
        if (num) out.push(kt(num.label + ' : les plus grands d’abord', num.label + ': biggest first'))
        const other = obj.fields.find((f) => f.key !== obj.title && !['choice', 'date'].includes(f.type) && f !== num)
        if (other) out.push(kt('Cacher la colonne ' + other.label, 'Hide the ' + other.label + ' column'))
        return out.slice(0, 3)
      }

      // ── the host ────────────────────────────────────────────────────────────────────────────────────────────────────────
      /** `{ ok, … }` always: a network failure, an unreadable answer or a refusal is an answer too. The session cookie travels with the request. A file (a Blob) goes as its raw bytes, anything else as JSON. */
      const call = async (method, path, body) => {
        try {
          const raw = typeof Blob !== 'undefined' && body instanceof Blob
          const res = await fetch(BASE + path, { method, cache: 'no-store', credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' }, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) })
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
          'too-big': kt('Ce fichier est trop gros pour ce champ.', 'This file is too big for this field.'),
          'too-many': kt('Il y a déjà le maximum de fichiers dans ce champ.', 'This field already holds the most files it can.'),
        }
        if (known[code] !== undefined) return known[code]
        return typeof (r && r.message) === 'string' && r.message !== '' ? r.message : kt('Cette valeur n’est pas acceptée.', 'This value is not accepted.')
      }

      // ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
      const MAX_FILE_BYTES = 25 * 1024 * 1024 // the core's cap (types.mjs); a field may ask for less, and its `maxBytes` says so
      const MAX_FILES = 20
      const SHOWN_IN_PLACE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] // what the page draws as a picture; the host decides from the bytes and hands over anything else (a PDF, an SVG) as a download
      const isImage = (f) => SHOWN_IN_PLACE.indexOf(String(f.type).toLowerCase()) >= 0
      const capOf = (field) => (Number.isInteger(field.maxBytes) && field.maxBytes > 0 ? field.maxBytes : MAX_FILE_BYTES)
      /** Where a file a row holds is read from (the host serves it only to a row that holds it). */
      const fileUrl = (dbId, objKey, id, field, f) => BASE + '/file' + qs({ db: dbId, object: objKey, id, field: field.key, hash: f.hash })
      /** Which of the files chosen are sent: each within the field's cap, and no more in all than a field holds. Nothing is sent for the others; they come back with the reason. Pure. */
      const planFiles = (field, held, files) => {
        const cap = capOf(field)
        const room = MAX_FILES - (Array.isArray(held) ? held.length : 0)
        const ok = []
        const failed = []
        for (const f of files) {
          if (f.size > cap) failed.push({ name: f.name, why: 'too-big', cap })
          else if (ok.length >= room) failed.push({ name: f.name, why: 'too-many' })
          else ok.push(f)
        }
        return { ok, failed }
      }
      const failText = (x) => {
        const n = '« ' + x.name + ' »'
        if (x.why === 'too-big') return kt(n + ' dépasse ' + fmtBytes(x.cap) + '.', '“' + x.name + '” is over ' + fmtBytes(x.cap) + '.')
        if (x.why === 'too-many') return kt(n + ' : ' + MAX_FILES + ' fichiers au plus dans un champ.', '“' + x.name + '”: a field holds ' + MAX_FILES + ' files at most.')
        if (x.why === 'same') return kt(n + ' est déjà là.', '“' + x.name + '” is already there.')
        return kt(n + ' : ', '“' + x.name + '”: ') + x.message
      }
      /** What the drop of files into a field left behind, as one sentence for a toast or a note. */
      const filesSummary = (added, failed) => {
        const parts = []
        if (added > 0) parts.push(added === 1 ? kt('1 fichier ajouté.', '1 file added.') : kt(added + ' fichiers ajoutés.', added + ' files added.'))
        if (failed.length > 0) parts.push(failText(failed[0]) + (failed.length > 1 ? kt(' (+' + (failed.length - 1) + ' autres)', ' (+' + (failed.length - 1) + ' more)') : ''))
        return parts.join(' ')
      }


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

        .kbtb-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
        .kbtb-dbsel{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary)}
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
        .kbtb-vname{flex:1;min-width:0;display:flex;align-items:center;gap:9px}
        .kbtb-vk{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);flex:none}
        .kbtb-vn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-made{display:inline-grid;place-items:center;color:var(--dsw-alias-brand-primary)}
        .kbtb-vcreate{display:flex;flex-wrap:wrap;gap:8px}
        .kbtb-vc{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
        .kbtb-vc:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}

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
        .kbtb-rel-t{border:none;background:transparent;padding:0;font:inherit;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        button.kbtb-rel-t{cursor:pointer;border-radius:4px}
        button.kbtb-rel-t:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}
        .kbtb-rel-t.gone{text-decoration:line-through}
        .kbtb-rel-x{display:inline-grid;place-items:center;width:18px;height:18px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
        .kbtb-rel-x:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbtb-links{display:flex;flex-direction:column;gap:8px;min-width:0}
        .kbtb-linkrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
        .kbtb-linkrow .kbtb-pill{gap:6px}
        .kbtb-lp{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);animation:kbtb-pop .16s ease-out both}
        .kbtb-lp .kbtb-find{height:32px}
        .kbtb-lp .kbtb-find input{flex:1;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none}
        .kbtb-lpl{display:flex;flex-direction:column;gap:2px;max-height:210px;overflow-y:auto}
        .kbtb-lpo{display:block;width:100%;padding:7px 9px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:start;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbtb-lpo:hover,.kbtb-lpo:focus-visible{background:var(--dsw-alias-bg-layer-2)}
        .kbtb-lp .kbtb-note{margin:2px 4px}
        .kbtb-lf{display:flex;flex-direction:column;gap:12px;padding:14px 18px 6px;border-top:1px solid var(--dsw-alias-border-l1)}
        p.kbtb-lf{margin:0;border-top:1px solid var(--dsw-alias-border-l1)}
        .kbtb-lft{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary)}
        .kbtb-lg{display:flex;flex-direction:column;gap:6px;min-width:0}
        .kbtb-lgh{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
        .kbtb-lgh b{font-size:13px}
        .kbtb-lgc{min-width:20px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}
        .kbtb-lgv{color:var(--dsw-alias-label-tertiary);font-size:11.5px}

        .kbtb-built{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);animation:kbtb-pop .18s ease-out both}
        .kbtb-bh{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
        .kbtb-bh b{font-size:14px;margin-inline-end:auto}
        .kbtb-tab.sm{height:28px;padding:0 12px;font-size:12px}
        .kbtb-bgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
        .kbtb-bcol{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
        .kbtb-bcol h4{margin:0;font-size:13.5px}
        .kbtb-bl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
        .kbtb-bf{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;min-width:0}
        .kbtb-bfl{font-size:13px;font-weight:600;overflow-wrap:anywhere}
        .kbtb-bft{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
        .kbtb-bfx{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
        .kbtb-bback{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2)}
        .kbtb-bbt{display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-weight:600}
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
        .kbtb-plus{display:inline-grid;place-items:center;width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .12s}
        .kbtb-cc:hover .kbtb-plus,.kbtb-plus:focus-visible{opacity:1}
        .kbtb-plus:hover{background:var(--dsw-alias-bg-layer-3)}
        .kbtb-ce{display:block;width:100%;height:22px;padding:0 7px;border:none;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:11.5px;text-align:start;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
        .kbtb-ce.hue{background:hsl(var(--kbtb-h) 70% 50% / .2)}
        .kbtb-ce:hover{filter:brightness(.95)}

        .kbtb-drawer{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);min-width:0;animation:kbtb-slide .26s cubic-bezier(.2,.8,.2,1) both}
        .kbtb-dh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 14px 10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:15px}
        .kbtb-dh b{overflow-wrap:anywhere;flex:1;min-width:0}
        .kbtb-dfields{display:flex;flex-direction:column;gap:14px;padding:16px 18px}
        .kbtb-df{display:flex;flex-direction:column;gap:5px;min-width:0}
        .kbtb-dl{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:5px}
        .kbtb-req{color:var(--dsw-alias-state-error-primary)}
        .kbtb-prot{display:inline-grid;color:var(--dsw-alias-label-tertiary)}
        .kbtb-in{width:100%}
        textarea.kbtb-in{height:auto;padding:8px 9px;resize:vertical;line-height:1.45}
        .kbtb-secret{display:flex;align-items:center;gap:4px}
        .kbtb-numfield{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .kbtb-numfield .kbtb-in{flex:1 1 140px;text-align:end;font-variant-numeric:tabular-nums}
        .kbtb-unit{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbtb-ferr{color:var(--dsw-alias-state-error-primary);font-size:12px;flex-basis:100%}
        .kbtb-picks{display:flex;flex-wrap:wrap;gap:6px}
        .kbtb-pick{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
        .kbtb-pick.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
        .kbtb-filelist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
        .kbtb-filesed{display:flex;flex-direction:column;gap:8px;min-width:0}
        .kbtb-filelist li{display:flex;align-items:center;gap:10px;min-width:0;color:var(--dsw-alias-label-secondary)}
        .kbtb-fmeta{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
        .kbtb-fn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%}
        .kbtb-fs{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
        .kbtb-thumb,.kbtb-fico{width:40px;height:40px;flex:none;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-thumb{object-fit:cover;display:block}
        .kbtb-fico,.kbtb-thumb.none,.kbtb-fthumb.none{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}
        .kbtb-drop{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;padding:9px 11px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;transition:border-color .14s,background .14s}
        .kbtb-drop.over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
        .kbtb-drop .kbtb-pill[disabled]{opacity:.45;cursor:not-allowed}
        .kbtb-tbl td.files{position:relative}
        .kbtb-tbl td.files.drop{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-3px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
        .kbtb-hint,.kbtb-sending{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-inline-start:6px}
        .kbtb-sending{animation:kbtb-pulse 1.1s ease-in-out infinite}
        .kbtb-fchips{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;vertical-align:middle}
        .kbtb-fchip{position:relative;display:inline-flex;align-items:center;min-width:0;height:24px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}
        .kbtb-fchip .kbtb-fa{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:150px;height:100%;padding:0 8px;color:inherit;text-decoration:none;border-radius:inherit}
        .kbtb-fchip .kbtb-fa:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-fchip.pic{border:none}
        .kbtb-fchip.pic .kbtb-fa{padding:0}
        .kbtb-fcn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .kbtb-fthumb{width:28px;height:28px;display:block;object-fit:cover;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-fchip.pic{height:28px}
        .kbtb-fx{position:absolute;top:-7px;inset-inline-end:-7px;display:inline-grid;place-items:center;width:16px;height:16px;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;transition:opacity .12s}
        .kbtb-fx:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}
        .kbtb-fchip:hover .kbtb-fx,.kbtb-fchip:focus-within .kbtb-fx{opacity:1}
        @media (hover:none){.kbtb-fx{display:none}}
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
        db: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
      }

      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React
        const svg = (name, size) => h('svg', { width: size || 15, height: size || 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, (ICONS[name] || []).map((d, i) => h('path', { key: i, d })))
        const stop = (e) => { try { e.stopPropagation() } catch (x) { /* a synthetic event without it */ } }
        /** Whether a drag carries files from outside the page (a board card being moved carries none). */
        const hasFiles = (e) => { try { return Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0 } catch (x) { return false } }
        /** The drag and drop of a field that takes files: the events to put on its box, and whether a drag is over it. */
        const useDropFiles = (send) => {
          const [over, setOver] = useState(false)
          return [over, {
            onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy' } catch (x) { /* no effect to set */ } setOver(true) },
            onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) },
            onDrop: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); send(Array.from(e.dataTransfer.files)) },
          }]
        }

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
        /** The files of a cell: a thumbnail for a picture, a name for the rest, each opening its file; an × on hover or focus takes one off. */
        const FileChips = ({ field, rec, ctx }) => {
          const list = rec.values[field.key]
          const max = 3
          return h('span', { className: 'kbtb-fchips', 'data-kb': 'tables-files' },
            list.slice(0, max).map((f) => {
              const url = ctx.fileUrl(field, rec, f)
              const pic = isImage(f)
              const attrs = Object.assign({ className: 'kbtb-fa', title: f.name + ' · ' + fmtBytes(f.size), 'aria-label': f.name + ' (' + fmtBytes(f.size) + ')', href: url, onClick: stop }, isImage(f) ? { target: '_blank', rel: 'noopener noreferrer' } : { download: f.name })
              return h('span', { key: f.hash, className: 'kbtb-fchip' + (pic ? ' pic' : ''), 'data-kb': 'tables-file', 'data-hash': f.hash },
                h('a', attrs, pic ? h(Thumb, { src: url, cls: 'kbtb-fthumb' }) : [svg('clip', 12), h('span', { key: 'n', className: 'kbtb-fcn' }, f.name)]),
                typeof ctx.removeFile === 'function' ? h('button', { type: 'button', className: 'kbtb-fx', 'data-kb': 'tables-file-remove', 'aria-label': kt('Retirer ', 'Remove ') + f.name, onClick: (e) => { stop(e); ctx.removeFile(rec, field, f) } }, svg('x', 10)) : null)
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

        // Views: choose, star, rename, duplicate, delete, create.
        const ViewsPop = ({ p }) => {
          const [renaming, setRenaming] = useState(null)
          const [name, setName] = useState('')
          const kinds = ['table', 'board', 'cards', 'calendar'].filter((k) => K.kindAvailable(p.obj.fields, k))
          const commit = (v) => { const n = name.trim(); setRenaming(null); if (n !== '' && n !== v.name) p.renameView(v.id, n.slice(0, 60)) }
          const row = (v) => {
            const cur = v.id === p.view.id
            const head = renaming === v.id
              ? h('span', { className: 'kbtb-vname' }, h('span', { className: 'kbtb-vk' }, svg(KIND_ICON[v.kind], 14)),
                h('input', { className: 'kbtb-inp', type: 'text', autoFocus: true, maxLength: 60, value: name, 'aria-label': kt('Nom de la vue', 'View name'), onChange: (e) => setName(e.target.value), onBlur: () => commit(v), onKeyDown: (e) => { if (e.key === 'Enter') commit(v); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } } }))
              : h('button', { type: 'button', className: 'kbtb-vsel', 'aria-current': cur ? 'true' : undefined, 'data-kb': 'tables-view-pick', onClick: () => p.selectView(v.id) },
                h('span', { className: 'kbtb-vk' }, svg(KIND_ICON[v.kind], 14)), h('span', { className: 'kbtb-vn' }, v.name),
                v.owner === 'kaby' ? h('span', { className: 'kbtb-made', title: kt('Créée par Kaby', 'Made by Kaby') }, svg('sparkle', 12)) : null)
            return h('div', { key: v.id, className: 'kbtb-vrow' + (cur ? ' cur' : '') },
              head,
              h('button', { type: 'button', className: 'kbtb-ib sm' + (v.fav ? ' on' : ''), 'aria-pressed': v.fav ? 'true' : 'false', 'aria-label': v.fav ? kt('Retirer « ' + v.name + ' » de la barre', 'Remove “' + v.name + '” from the bar') : kt('Afficher « ' + v.name + ' » dans la barre', 'Show “' + v.name + '” in the bar'), title: v.fav ? kt('Dans la barre', 'In the bar') : kt('Afficher dans la barre', 'Show in the bar'), onClick: () => p.favView(v.id) }, svg('star', 14)),
              h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-label': kt('Renommer « ' + v.name + ' »', 'Rename “' + v.name + '”'), title: kt('Renommer', 'Rename'), onClick: () => { setName(v.name); setRenaming(v.id) } }, svg('edit', 14)),
              h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-label': kt('Dupliquer « ' + v.name + ' »', 'Duplicate “' + v.name + '”'), title: kt('Dupliquer', 'Duplicate'), onClick: () => p.dupView(v.id) }, svg('copy', 14)),
              h('button', { type: 'button', className: 'kbtb-ib sm', disabled: p.views.length < 2, 'aria-label': kt('Supprimer « ' + v.name + ' »', 'Delete “' + v.name + '”'), title: p.views.length < 2 ? kt('Une table garde au moins une vue', 'A table keeps at least one view') : kt('Supprimer', 'Delete'), onClick: () => p.removeView(v.id) }, svg('trash', 14)))
          }
          return h('div', null,
            h(PopHead, { title: kt('Vues', 'Views') + ' · ' + p.views.length }),
            h('div', { className: 'kbtb-vlist' }, p.views.map(row)),
            h('div', { className: 'kbtb-psep' }),
            h(PopHead, { title: kt('Créer une vue', 'Create a view') }),
            h('div', { className: 'kbtb-vcreate' }, kinds.map((k) => h('button', { key: k, type: 'button', className: 'kbtb-vc', 'data-kb': 'tables-view-new-' + k, onClick: () => p.createView(k) }, h('span', { className: 'kbtb-vk' }, svg(KIND_ICON[k], 14)), KIND_WORD()[k]))),
            h('p', { className: 'kbtb-note faint' }, kt('Une vue est une façon enregistrée de regarder tes lignes : présentation, filtre, tri et champs. Elle ne change jamais les données. Kaby prépare les premières ; chacune est à toi, et tes changements s’enregistrent au fil de l’eau.', 'A view is a saved way of looking at your rows: layout, filter, sort and fields. It never changes the data. Kaby makes the first ones; every view is yours to change, and changes save as you go.')))
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
            h('p', { className: 'kbtb-note faint' }, kt('Ou dis-le en une phrase : ', 'Or say it in a line: '), h('button', { type: 'button', className: 'kbtb-lnk', onClick: () => p.setMenu('modify') }, kt('Modifier la vue', 'Modify view'))))
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

        // Modify view: one line, sent to Kaby in a chat the person reads and sends.
        const ModifyPop = ({ p }) => {
          const [text, setText] = useState('')
          const [state, setState] = useState('idle')
          const ex = modifyExamples(p.obj)
          const send = (e) => {
            if (e) e.preventDefault()
            if (text.trim() === '') return
            const sentence = askText(p.db, p.obj, p.view, text)
            if (p.ask(sentence)) { p.setMenu(null); return }
            setState('copy')
            try { navigator.clipboard.writeText(sentence).then(() => setState('copied'), () => setState('copy')) } catch (x) { setState('copy') }
          }
          return h('div', null,
            h(PopHead, { title: kt('Modifier la vue', 'Modify view') }),
            h('form', { className: 'kbtb-mline', onSubmit: send },
              h('span', { className: 'kbtb-mic' }, svg('sparkle', 15)),
              h('input', { className: 'kbtb-mi', type: 'text', autoFocus: true, autoComplete: 'off', 'data-kb': 'tables-modify-input', 'aria-label': kt('Décris comment changer cette vue', 'Describe how to change this view'), placeholder: kt('Décris comment changer cette vue', 'Describe how to change this view'), value: text, onChange: (e) => { setText(e.target.value); setState('idle') } }),
              h('button', { type: 'submit', className: 'kbtb-mgo', 'data-kb': 'tables-modify-send', disabled: text.trim() === '', 'aria-label': kt('Envoyer à Kaby', 'Send to Kaby') }, svg('arrow', 15))),
            state === 'idle' ? h('div', null, h('p', { className: 'kbtb-note' }, kt('Par exemple :', 'Try, for example:')),
              h('div', { className: 'kbtb-mex' }, ex.map((t) => h('button', { key: t, type: 'button', className: 'kbtb-ex', onClick: () => setText(t) }, t))),
              h('p', { className: 'kbtb-note faint' }, kt('Un chat s’ouvre avec ta phrase déjà écrite : tu la relis et tu l’envoies. Kaby ne change que cette vue : ce que tu vois, jamais les données ni la structure.', 'A chat opens with your sentence already written: you read it and send it. Kaby changes this view only: what you see, never the data or the structure.')))
              : h('p', { className: 'kbtb-note', role: 'status' }, state === 'copied' ? kt('Le chat ne peut pas s’ouvrir d’ici : la phrase est copiée, colle-la dans un chat avec Kaby.', 'The chat cannot open from here: the sentence is copied, paste it in a chat with Kaby.') : kt('Le chat ne peut pas s’ouvrir d’ici. Ouvre un chat avec Kaby et décris le changement.', 'The chat cannot open from here. Open a chat with Kaby and describe the change.')))
        }

        // The bar: the views, then Views / Fields / Filter / Sort, Modify view and the primary action. It sits in the product toolbar's trailing slot.
        const MenuButton = ({ p, id, icon, label, badge, cls, tip, children }) => {
          const open = p.menu === id
          return h('span', { className: 'kbtb-pw' },
            h('button', { type: 'button', className: 'kbtb-tp' + (cls || '') + (badge ? ' on' : '') + (open ? ' open' : ''), 'data-kb': 'tables-menu-' + id, 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false', 'aria-label': label + (badge ? ', ' + badge + ' ' + kt('actif', 'active') : ''), title: tip, onClick: () => p.setMenu(open ? null : id) },
              svg(icon, 15), h('span', { className: 'kbtb-tl' }, label), badge ? h('span', { className: 'kbtb-badge' }, badge) : null),
            open ? h(Pop, { label, cls: id }, children) : null)
        }
        const Bar = ({ p }) => {
          const nCond = countConditions(p.view.state.flt)
          const shown = barViews(p.views, p.view.id)
          const kindOf = p.view.kind
          return h('div', { className: 'kbtb-bar', 'data-kb': 'tables-bar' },
            h('div', { className: 'kbtb-vgrp', role: 'group', 'aria-label': kt('Vues', 'Views') }, shown.map((v) => h('button', { key: v.id, type: 'button', className: 'kbtb-vbtn', 'aria-pressed': v.id === p.view.id ? 'true' : 'false', 'data-kb': 'tables-view', 'data-view': v.id, title: v.name, onClick: () => p.selectView(v.id) }, svg(KIND_ICON[v.kind], 15), h('span', { className: 'kbtb-vl' }, v.name)))),
            h(MenuButton, { p, id: 'views', icon: 'table', label: kt('Vues', 'Views'), badge: p.views.length > 1 ? String(p.views.length) : '', tip: kt('Toutes les vues : choisir, créer, renommer', 'All views: choose, create, rename') }, h(ViewsPop, { p })),
            kindOf === 'calendar' ? null : h(MenuButton, { p, id: 'fields', icon: 'eye', label: kt('Champs', 'Fields'), badge: p.view.state.hidden.length ? String(p.view.state.hidden.length) : '', tip: kt('Choisir les champs que tu vois', 'Choose which fields you see') }, h(FieldsPop, { p })),
            h(MenuButton, { p, id: 'filter', icon: 'filter', label: kt('Filtre', 'Filter'), badge: nCond ? String(nCond) : '', tip: kt('Filtrer cette vue', 'Filter this view') }, h(FilterPop, { p })),
            h(MenuButton, { p, id: 'sort', icon: 'sort', label: kt('Tri', 'Sort'), badge: p.view.state.sorts.length ? String(p.view.state.sorts.length) : '', tip: kt('Trier cette vue', 'Sort this view') }, h(SortPop, { p })),
            h(MenuButton, { p, id: 'modify', icon: 'sparkle', label: kt('Modifier la vue', 'Modify view'), badge: '', cls: ' kb', tip: kt('Dis à Kaby, en une phrase, comment changer cette vue', 'Tell Kaby, in a line, how to change this view') }, h(ModifyPop, { p })),
            h('button', { type: 'button', className: 'kb8-primary kbtb-new', 'data-kb': 'tables-new', onClick: () => p.newRecord(null) }, svg('plus', 15), kt('Nouvelle ligne', 'New row')))
        }

        // ── the four views ──────────────────────────────────────────────────────────────────────────────────────────────────
        const PAGE_STEP = 200 // rows drawn at a time: the host sends up to 5,000, the DOM does not need them all at once
        const rowWord = (n) => plural(n, 'ligne', 'lignes', 'row', 'rows')
        const MoreRows = ({ shown, total, onMore }) => (shown >= total ? null : h('div', { className: 'kbtb-pager' }, h('span', null, shown + ' / ' + total),
          h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'tables-more', onClick: onMore }, kt('Afficher la suite', 'Show more'))))

        /** The cell of a field of files: it shows them, and takes files dropped on it. */
        const FileTd = ({ field, rec, p }) => {
          const [over, events] = useDropFiles((files) => p.dropFiles(rec, field, files))
          const sending = p.sending[rec.id + '/' + field.key] || 0
          return h('td', Object.assign({ className: 'files' + (over ? ' drop' : ''), 'data-kb': 'tables-cell-files', 'data-field': field.key }, events),
            h(Cell, { field, rec, ctx: p.ctx }),
            over ? h('span', { className: 'kbtb-hint' }, kt('Déposer ici', 'Drop here')) : null,
            sending > 0 ? h('span', { className: 'kbtb-sending', role: 'status' }, kt('Envoi…', 'Sending…')) : null)
        }
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
                  : f.type === 'attachment'
                    ? h(FileTd, { key: f.key, field: f, rec: r, p })
                    : h('td', { key: f.key, className: f.type === 'number' || f.type === 'money' ? 'num' : '' }, h(Cell, { field: f, rec: r, ctx: p.ctx }))))))))),
            h(MoreRows, { shown: shown.length, total: p.rows.length, onMore: () => setLimit((n) => n + PAGE_STEP) }))
        }

        const metaFields = (p, skip, max) => p.obj.fields.filter((f) => f.key !== p.obj.title && !skip.includes(f.key) && !p.view.state.hidden.includes(f.key) && f.protection !== 'secret' && f.type !== 'longtext' && f.type !== 'attachment').slice(0, max)

        const BoardView = ({ p }) => {
          const by = p.obj.fields.find((f) => f.key === p.view.by)
          const [drag, setDrag] = useState(null)
          const [over, setOver] = useState(null)
          if (!by) return null
          const cols = boardColumns(by, p.rows)
          const meta = metaFields(p, [by.key], 3)
          const sum = totalField(p.obj, p.view.state.hidden)
          return h('div', { className: 'kbtb-board', 'data-kb': 'tables-board' }, cols.map((col) => {
            const hue = hueOfColor(col.color)
            const total = sum === undefined ? null : columnTotal(sum, col.rows)
            return h('div', { key: col.key === '' ? '__none' : col.key, className: 'kbtb-col' + (over === col.key ? ' over' : ''), 'data-col': col.key,
              onDragOver: (e) => { if (drag !== null) { e.preventDefault(); if (over !== col.key) setOver(col.key) } },
              onDragLeave: () => { if (over === col.key) setOver(null) },
              onDrop: (e) => { e.preventDefault(); if (drag !== null) p.moveRecord(drag, by.key, col.key); setDrag(null); setOver(null) } },
            h('div', { className: 'kbtb-colh' }, h('i', { className: 'kbtb-dot' + (hue === null ? '' : ' hue'), style: hue === null ? undefined : { '--kbtb-h': hue }, 'aria-hidden': 'true' }), h('span', { className: 'kbtb-colt' }, col.label), h('span', { className: 'kbtb-colc' }, String(col.rows.length)),
              total === null ? null : h('span', { className: 'kbtb-colv', 'data-kb': 'tables-col-total', title: kt('Total : ', 'Total: ') + sum.label }, fmtMoney(sum, total)),
              h('button', { type: 'button', className: 'kbtb-ib sm', 'data-kb': 'tables-col-add', 'aria-label': kt('Ajouter une ligne dans ' + col.label, 'Add a row to ' + col.label), onClick: () => p.newRecord({ [by.key]: col.key === '' ? null : col.key }) }, svg('plus', 14))),
            col.rows.map((r) => h('div', { key: r.id, className: 'kbtb-bcard' + (drag === r.id ? ' drag' : ''), role: 'button', tabIndex: 0, draggable: true, 'data-kb': 'tables-card', 'data-id': r.id,
              onDragStart: (e) => { setDrag(r.id); try { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move' } catch (x) { /* a drag without data transfer */ } },
              onDragEnd: () => { setDrag(null); setOver(null) },
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
                  h('div', { className: 'kbtb-dn' }, h('b', null, String(d.day)), h('button', { type: 'button', className: 'kbtb-plus', 'data-kb': 'tables-cal-add', 'aria-label': kt('Ajouter une ligne le ' + fmtDate(d.iso), 'Add a row on ' + fmtDate(d.iso)), onClick: () => p.newRecord({ [f.key]: d.iso }) }, svg('plus', 12))),
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

        // ── the record drawer ───────────────────────────────────────────────────────────────────────────────────────────────
        const TextEditor = ({ field, value, onCommit, disabled }) => {
          const [t, setT] = useState(value === null || value === undefined ? '' : String(value))
          const commit = () => { const next = t === '' ? null : t; if (next !== (value === undefined ? null : value)) onCommit(next) }
          const long = field.type === 'longtext'
          const type = field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'
          return h(long ? 'textarea' : 'input', { className: 'kbtb-in', type: long ? undefined : type, rows: long ? 4 : undefined, value: t, disabled, 'data-kb': 'tables-field-' + field.key, 'aria-label': field.label, onChange: (e) => setT(e.target.value), onBlur: commit, onKeyDown: (e) => { if (e.key === 'Enter' && !long) { e.preventDefault(); e.target.blur() } } })
        }
        const SecretEditor = ({ field, value, onCommit }) => {
          const [t, setT] = useState(value === null || value === undefined ? '' : String(value))
          const [shown, setShown] = useState(false)
          return h('span', { className: 'kbtb-secret' },
            h('input', { className: 'kbtb-in', type: shown ? 'text' : 'password', autoComplete: 'off', value: t, 'data-kb': 'tables-field-' + field.key, 'aria-label': field.label, onChange: (e) => setT(e.target.value), onBlur: () => { const next = t === '' ? null : t; if (next !== (value === undefined ? null : value)) onCommit(next) } }),
            h('button', { type: 'button', className: 'kbtb-ib sm', 'aria-pressed': shown ? 'true' : 'false', 'aria-label': shown ? kt('Cacher la valeur', 'Hide the value') : kt('Montrer la valeur', 'Show the value'), onClick: () => setShown(!shown) }, svg('eye', 14)))
        }
        const NumberEditor = ({ field, value, onCommit }) => {
          const [t, setT] = useState(typeof value === 'number' ? String(value) : '')
          const [bad, setBad] = useState(false)
          const commit = () => {
            if (t.trim() === '') { setBad(false); if (value !== null && value !== undefined) onCommit(null); return }
            const n = Number(t.replace(',', '.'))
            if (!Number.isFinite(n)) { setBad(true); return }
            setBad(false)
            if (n !== value) onCommit(n)
          }
          return h('span', { className: 'kbtb-numfield' },
            h('input', { className: 'kbtb-in', type: 'text', inputMode: 'decimal', value: t, 'data-kb': 'tables-field-' + field.key, 'aria-label': field.label, 'aria-invalid': bad ? 'true' : undefined, onChange: (e) => { setT(e.target.value); setBad(false) }, onBlur: commit, onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } } }),
            field.type === 'money' ? h('span', { className: 'kbtb-unit' }, field.currency) : null,
            bad ? h('span', { className: 'kbtb-ferr', role: 'alert' }, kt('Saisis un nombre.', 'Enter a number.')) : null)
        }
        /** A link field: the records it points at as chips (each opens its record, each can be taken off), and a picker over the other table's rows to add one. */
        const PICK_MAX = 50
        const RelationEditor = ({ field, value, onCommit, p }) => {
          const [open, setOpen] = useState(false)
          const [q, setQ] = useState('')
          const root = useRef(null)
          const addBtn = useRef(null)
          const target = p.db.objects.find((o) => o.key === field.to)
          const rows = p.related[field.to]
          const ids = empty(value) ? [] : (field.many ? value : [value])
          const saved = p.drawer !== null && p.drawer.mode === 'edit'
          useEffect(() => {
            if (!open) return undefined
            const onDown = (e) => { try { if (root.current !== null && !root.current.contains(e.target)) setOpen(false) } catch (x) { setOpen(false) } }
            document.addEventListener('mousedown', onDown, true)
            return () => document.removeEventListener('mousedown', onDown, true)
          }, [open])
          if (!target) return h('span', { className: 'kbtb-ferr', 'data-kb': 'tables-field-' + field.key }, kt('La table liée n’existe plus.', 'The table this field links to no longer exists.'))
          const close = () => { setOpen(false); setQ(''); try { if (addBtn.current !== null) addBtn.current.focus() } catch (e) { /* no focus */ } }
          // after a pick in a many link the picker stays for the next one: focus goes back to its search (the row clicked is gone, and a focus lost to the page would make Escape close the drawer)
          const pick = (id) => {
            onCommit(field.many ? ids.concat([id]) : id)
            if (!field.many) { close(); return }
            setQ('')
            try { root.current.querySelector('input').focus() } catch (e) { /* no input */ }
          }
          const drop = (id) => { const next = ids.filter((x) => x !== id); onCommit(next.length === 0 ? null : (field.many ? next : next[0])) }
          const found = rows === undefined ? { items: [], total: 0 } : linkOptions(target, rows, ids, q, PICK_MAX)
          const onFind = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); return }
            if (e.key === 'Enter') { e.preventDefault(); if (found.items.length > 0) pick(found.items[0].id); return }
            if (e.key === 'ArrowDown') { e.preventDefault(); try { const first = root.current.querySelector('[data-kb="tables-link-option"]'); if (first !== null) first.focus() } catch (x) { /* no list */ } }
          }
          const onList = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); return }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            try {
              const all = Array.from(root.current.querySelectorAll('[data-kb="tables-link-option"]'))
              const at = all.indexOf(document.activeElement)
              const next = all[at + (e.key === 'ArrowDown' ? 1 : -1)]
              if (next !== undefined) next.focus(); else if (e.key === 'ArrowUp') root.current.querySelector('input').focus()
            } catch (x) { /* no list */ }
          }
          const chip = (id) => {
            const r = p.ctx.resolve(field, id)
            const body = r.missing
              ? h('span', { className: 'kbtb-rel-t gone', title: kt('Cette ligne a été supprimée.', 'This row was deleted.') }, r.title)
              : saved && !r.loading && typeof p.ctx.open === 'function'
                ? h('button', { type: 'button', className: 'kbtb-rel-t', 'data-kb': 'tables-link', 'data-object': field.to, 'data-id': id, title: kt('Ouvrir ', 'Open ') + r.title, onClick: () => p.ctx.open(field, id) }, r.title)
                : h('span', { className: 'kbtb-rel-t' }, r.title)
            return h('span', { key: id, className: 'kbtb-rel edit' + (r.missing ? ' gone' : '') }, svg('link', 11), body,
              h('button', { type: 'button', className: 'kbtb-rel-x', 'data-kb': 'tables-link-remove', 'aria-label': kt('Retirer le lien vers ', 'Remove the link to ') + r.title, onClick: () => drop(id) }, svg('x', 11)))
          }
          const addLabel = field.many ? kt('Ajouter…', 'Add…') : (ids.length > 0 ? kt('Changer…', 'Change…') : kt('Choisir…', 'Choose…'))
          return h('div', { className: 'kbtb-links', ref: root, 'data-kb': 'tables-field-' + field.key },
            h('div', { className: 'kbtb-linkrow' },
              ids.map(chip),
              h('button', { type: 'button', ref: addBtn, className: 'kbtb-pill', 'data-kb': 'tables-link-add', 'aria-expanded': open ? 'true' : 'false', onClick: () => { setOpen(!open); setQ('') } }, svg(ids.length > 0 && !field.many ? 'edit' : 'plus', 12), addLabel)),
            open ? h('div', { className: 'kbtb-lp', 'data-kb': 'tables-link-picker' },
              h('label', { className: 'kbtb-find' }, svg('search', 14), h('input', { type: 'search', autoFocus: true, autoComplete: 'off', value: q, 'data-kb': 'tables-link-find', 'aria-label': kt('Chercher dans ', 'Search in ') + target.label, placeholder: kt('Chercher dans ', 'Search in ') + target.label, onChange: (e) => setQ(e.target.value), onKeyDown: onFind })),
              rows === undefined
                ? h('p', { className: 'kbtb-note faint' }, p.rec.status === 'ok' ? kt('La liste n’a pas pu être lue.', 'The list could not be read.') : kt('Chargement…', 'Loading…'))
                : found.items.length === 0
                  ? h('p', { className: 'kbtb-note faint', 'data-kb': 'tables-link-none' }, rows.length === 0 ? kt('Il n’y a encore aucune ligne dans ' + target.label + '.', 'There is no row in ' + target.label + ' yet.') : q.trim() !== '' ? kt('Aucune ligne ne correspond.', 'No row matches.') : kt('Tout est déjà lié.', 'Everything is already linked.'))
                  : h('div', { className: 'kbtb-lpl', role: 'listbox', 'aria-label': target.label, onKeyDown: onList },
                    found.items.map((o) => h('button', { key: o.id, type: 'button', role: 'option', 'aria-selected': 'false', className: 'kbtb-lpo', 'data-kb': 'tables-link-option', 'data-id': o.id, onClick: () => pick(o.id) }, o.title))),
              found.total > PICK_MAX ? h('p', { className: 'kbtb-note faint' }, kt(PICK_MAX + ' sur ' + found.total + ' : tape pour affiner.', PICK_MAX + ' of ' + found.total + ': type to narrow it down.')) : null) : null)
        }
        /** A field of files: what the row holds (a picture for an image, name and size for the rest, each opening its file), an × to take one off, and a box to drop files in or choose them. */
        const AttachEditor = ({ field, value, onCommit, p }) => {
          const [sending, setSending] = useState(0)
          const [notes, setNotes] = useState([])
          const input = useRef(null)
          const held = useRef([])
          const list = Array.isArray(value) ? value : []
          held.current = list
          const saved = p.drawer !== null && p.drawer.mode === 'edit'
          const id = saved ? p.drawer.id : ''
          const full = list.length >= MAX_FILES
          // the row may have moved while the files were on their way: what is added goes onto what the row holds when they have arrived
          const send = async (files) => {
            if (files.length === 0 || sending > 0) return
            setNotes([])
            setSending(files.length)
            const out = await p.attach(field, files, held.current)
            if (out.added.length > 0) await onCommit(held.current.concat(out.added))
            setSending(0)
            setNotes(out.failed)
          }
          const [over, events] = useDropFiles(send)
          const remove = (f) => {
            if (saved) { p.removeFile({ id }, field, f); return }
            const next = held.current.filter((x) => x.hash !== f.hash)
            onCommit(next.length === 0 ? null : next)
          }
          return h('div', { className: 'kbtb-filesed', 'data-kb': 'tables-field-' + field.key },
            list.length > 0 ? h('ul', { className: 'kbtb-filelist', 'data-kb': 'tables-filelist' }, list.map((f) => {
              const url = saved ? fileUrl(p.db.id, p.obj.key, id, field, f) : null
              const name = url === null
                ? h('span', { className: 'kbtb-fn' }, f.name)
                : h('a', Object.assign({ className: 'kbtb-fn kbtb-a', href: url, 'data-kb': 'tables-file-open' }, isImage(f) ? { target: '_blank', rel: 'noopener noreferrer' } : { download: f.name }), f.name)
              return h('li', { key: f.hash, 'data-kb': 'tables-file', 'data-hash': f.hash },
                url !== null && isImage(f) ? h(Thumb, { src: url, cls: 'kbtb-thumb' }) : h('span', { className: 'kbtb-fico' }, svg('clip', 15)),
                h('span', { className: 'kbtb-fmeta' }, name, h('span', { className: 'kbtb-fs' }, fmtBytes(f.size))),
                h('button', { type: 'button', className: 'kbtb-ib sm', 'data-kb': 'tables-file-remove', 'aria-label': kt('Retirer ', 'Remove ') + f.name, onClick: () => remove(f) }, svg('x', 13)))
            })) : null,
            h('div', Object.assign({ className: 'kbtb-drop' + (over ? ' over' : ''), 'data-kb': 'tables-drop' }, events),
              h('input', { type: 'file', multiple: true, hidden: true, ref: input, tabIndex: -1, 'data-kb': 'tables-file-input', 'aria-label': field.label, onChange: (e) => { const picked = Array.from(e.target.files || []); e.target.value = ''; send(picked) } }),
              h('button', { type: 'button', className: 'kbtb-pill', 'data-kb': 'tables-file-add', disabled: sending > 0 || full, onClick: () => { try { input.current.click() } catch (e) { /* no input */ } } }, svg('plus', 12), kt('Choisir des fichiers…', 'Choose files…')),
              h('span', { className: 'kbtb-note faint', role: sending > 0 ? 'status' : undefined },
                sending > 0 ? kt('Envoi de ' + sending + ' ' + plural(sending, 'fichier', 'fichiers', 'file', 'files') + '…', 'Sending ' + sending + ' ' + plural(sending, 'file', 'files', 'file', 'files') + '…')
                  : full ? kt(MAX_FILES + ' fichiers au plus dans un champ.', 'A field holds ' + MAX_FILES + ' files at most.')
                    : kt('ou dépose-les ici (' + fmtBytes(capOf(field)) + ' au plus chacun)', 'or drop them here (' + fmtBytes(capOf(field)) + ' at most each)'))),
            notes.map((x, i) => h('span', { key: i, className: 'kbtb-ferr', role: 'alert', 'data-kb': 'tables-file-error' }, failText(x))))
        }
        const Editor = ({ field, value, onCommit, p }) => {
          if (field.protection === 'secret' && (field.type === 'text' || field.type === 'longtext' || field.type === 'url' || field.type === 'email' || field.type === 'phone')) return h(SecretEditor, { field, value, onCommit })
          switch (field.type) {
            case 'text': case 'longtext': case 'url': case 'email': case 'phone': case 'person': return h(TextEditor, { field, value, onCommit })
            case 'number': case 'money': return h(NumberEditor, { field, value, onCommit })
            case 'date': return h('input', { className: 'kbtb-in', type: 'date', value: typeof value === 'string' ? value : '', 'data-kb': 'tables-field-' + field.key, 'aria-label': field.label, onChange: (e) => onCommit(e.target.value === '' ? null : e.target.value) })
            case 'checkbox': return h('button', { type: 'button', role: 'switch', className: 'kbtb-sw' + (value === true ? ' on' : ''), 'aria-checked': value === true ? 'true' : 'false', 'aria-label': field.label, 'data-kb': 'tables-field-' + field.key, onClick: () => onCommit(value !== true) }, h('i'))
            case 'choice': return h('select', { className: 'kbtb-in', value: typeof value === 'string' ? value : '', 'data-kb': 'tables-field-' + field.key, 'aria-label': field.label, onChange: (e) => onCommit(e.target.value === '' ? null : e.target.value) }, h('option', { value: '' }, '—'), field.options.map((o) => h('option', { key: o.key, value: o.key }, o.label)))
            case 'multichoice': {
              const list = Array.isArray(value) ? value : []
              return h('div', { className: 'kbtb-picks', role: 'group', 'aria-label': field.label, 'data-kb': 'tables-field-' + field.key }, field.options.map((o) => {
                const on = list.includes(o.key)
                return h('button', { key: o.key, type: 'button', className: 'kbtb-pick' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onClick: () => { const next = on ? list.filter((k) => k !== o.key) : list.concat([o.key]); onCommit(next.length ? next : null) } }, on ? svg('check', 12) : null, o.label)
              }))
            }
            case 'relation': return h(RelationEditor, { field, value, onCommit, p })
            case 'attachment': return h(AttachEditor, { field, value, onCommit, p })
            default: return null
          }
        }
        /** One field of the drawer: its label, its editor, and what the host said when it refused the value. */
        const FieldRow = ({ field, value, commit, p, error }) => {
          const [err, setErr] = useState('')
          const onCommit = async (v) => { setErr(''); const r = await commit(field.key, v); if (r && r.ok === false) setErr(errorText(r)) }
          return h('div', { className: 'kbtb-df' + (field.key === p.obj.title ? ' title' : '') },
            h('label', { className: 'kbtb-dl' }, field.label, field.required ? h('span', { className: 'kbtb-req', 'aria-hidden': 'true' }, ' *') : null, field.protection !== 'normal' ? h('span', { className: 'kbtb-prot', title: kt('Protégé : ', 'Protected: ') + field.protection }, svg('lock', 11)) : null),
            h(Editor, { key: field.type === 'relation' || field.type === 'attachment' ? 'stay' : JSON.stringify(value === undefined ? null : value), field, value, onCommit, p }),
            err !== '' || error ? h('span', { className: 'kbtb-ferr', role: 'alert' }, err || error) : null)
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
        const Drawer = ({ p }) => {
          const d = p.drawer
          const rec = d.mode === 'edit' ? p.all.find((r) => r.id === d.id) : null
          const [vals, setVals] = useState(() => Object.assign({}, d.prefill || {}))
          const [errs, setErrs] = useState({})
          const [busy, setBusy] = useState(false)
          const [top, setTop] = useState('')
          const ordered = [p.obj.fields.find((f) => f.key === p.obj.title)].concat(p.obj.fields.filter((f) => f.key !== p.obj.title))
          const closeBtn = h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'tables-drawer-close', 'aria-label': kt('Fermer', 'Close'), onClick: p.closeDrawer }, svg('x', 16))
          const trail = Array.isArray(d.trail) ? d.trail : []
          const backText = trail.length > 0 ? kt('Retour à ', 'Back to ') + trail[trail.length - 1].label : ''
          const backBtn = trail.length > 0 ? h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'tables-drawer-back', 'aria-label': backText, title: backText, onClick: p.goBack }, svg('chevL', 16)) : null
          if (d.mode === 'edit' && !rec) {
            // the row of another table is read after the table is: until then it is not missing, only not here yet
            const wait = p.rec.status === 'loading'
            return h('aside', { className: 'kbtb-drawer', 'data-kb': 'tables-drawer', 'aria-label': kt('Ligne', 'Row') }, h('div', { className: 'kbtb-dh' }, backBtn, h('b', null, wait ? kt('Chargement…', 'Loading…') : kt('Cette ligne n’existe plus.', 'This row no longer exists.')), closeBtn))
          }
          const submit = async (e) => {
            if (e) e.preventDefault()
            const missing = {}
            for (const f of ordered) if (f.required && empty(vals[f.key]) && f.type !== 'checkbox') missing[f.key] = kt('Ce champ est obligatoire.', 'This field is required.')
            if (Object.keys(missing).length) { setErrs(missing); setTop(''); return }
            setBusy(true)
            const r = await p.createRecord(vals)
            setBusy(false)
            if (r.ok) { p.closeDrawer(); p.say(kt('Ligne ajoutée.', 'Row added.'), { label: kt('Ouvrir', 'Open'), run: () => p.openRecord(r.record.id) }); return }
            const next = {}
            for (const x of Array.isArray(r.errors) ? r.errors : []) { const key = String(x.path || '').split('.')[0]; if (next[key] === undefined && p.obj.fields.some((f) => f.key === key)) next[key] = x.message }
            setErrs(next)
            setTop(Object.keys(next).length ? '' : errorText(r))
          }
          const isNew = d.mode === 'new'
          const body = ordered.map((f) => h(FieldRow, { key: f.key, field: f, p, error: errs[f.key],
            value: isNew ? vals[f.key] : rec.values[f.key],
            commit: isNew ? async (key, v) => { setVals((cur) => Object.assign({}, cur, { [key]: v })); setErrs((cur) => Object.assign({}, cur, { [key]: undefined })); return { ok: true } } : (key, v) => p.updateField(rec.id, key, v) }))
          const name = isNew ? kt('Nouvelle ligne', 'New row') : titleOf(p.obj, rec)
          return h('aside', { className: 'kbtb-drawer', 'data-kb': 'tables-drawer', 'aria-label': name },
            h('div', { className: 'kbtb-dh' }, backBtn, h('b', null, name), closeBtn),
            h('form', { className: 'kbtb-dfields', onSubmit: submit, noValidate: true }, body,
              top !== '' ? h('p', { className: 'kbtb-ferr', role: 'alert' }, top) : null,
              isNew ? h('div', { className: 'kbtb-dfoot' }, h('button', { type: 'button', className: 'kbtb-btn', onClick: p.closeDrawer }, kt('Annuler', 'Cancel')), h('button', { type: 'submit', className: 'kbtb-btn primary', 'data-kb': 'tables-create', disabled: busy }, kt('Ajouter', 'Add'))) : null),
            isNew ? null : h(LinkedFrom, { p, id: rec.id }),
            isNew ? null : h('div', { className: 'kbtb-dfoot split' },
              h('span', { className: 'kbtb-stamp' }, kt('Créée le ', 'Created ') + fmtStamp(rec.created.at), h('br'), kt('Modifiée le ', 'Modified ') + fmtStamp(rec.modified.at)),
              h('button', { type: 'button', className: 'kbtb-btn danger', 'data-kb': 'tables-delete', onClick: () => p.deleteRecord(rec.id) }, svg('trash', 14), kt('Supprimer', 'Delete'))))
        }

        // ── empty states ────────────────────────────────────────────────────────────────────────────────────────────────────
        const Empty = ({ p, why }) => {
          if (why === 'filtered') {
            return h('div', { className: 'kbtb-empty', 'data-kb': 'tables-empty', 'data-why': 'filtered' }, h('b', null, kt('Aucune ligne ne correspond.', 'No row matches.')), h('span', null, kt('Essaie une autre recherche, ou efface le filtre.', 'Try another search, or clear the filter.')),
              h('button', { type: 'button', className: 'kbtb-btn', onClick: p.clearAll }, kt('Tout effacer', 'Clear everything')))
          }
          return h('div', { className: 'kbtb-empty', 'data-kb': 'tables-empty', 'data-why': 'none' }, h('b', null, kt('Pas encore de ligne', 'No rows yet')),
            h('span', null, kt('Ajoute la première, ou demande à Kaby de remplir cette table : elle te demandera ton accord pour ce qui est protégé.', 'Add the first one, or ask Kaby to fill this table: she will ask your approval for what is protected.')),
            h('button', { type: 'button', className: 'kbtb-btn primary', 'data-kb': 'tables-empty-new', onClick: () => p.newRecord(null) }, svg('plus', 14), kt('Nouvelle ligne', 'New row')))
        }
        const NoTables = ({ p }) => {
          const [text, setText] = useState('')
          const send = (e) => { if (e) e.preventDefault(); if (text.trim() !== '') p.ask(buildText(text)) }
          return h('div', { className: 'kbtb-empty big', 'data-kb': 'tables-none' },
            h('b', null, kt('Pas encore de table', 'No table yet')),
            h('span', null, kt('Dis à Kaby ce que tu veux suivre : elle construit les tables et les champs, tu vois ce qui change avant que ce soit fait.', 'Tell Kaby what you want to keep track of: she builds the tables and the fields, and you see what changes before it is done.')),
            h('form', { className: 'kbtb-mline wide', onSubmit: send },
              h('span', { className: 'kbtb-mic' }, svg('sparkle', 15)),
              h('input', { className: 'kbtb-mi', type: 'text', autoComplete: 'off', 'data-kb': 'tables-build-input', 'aria-label': kt('Ce que tu veux suivre', 'What you want to keep track of'), placeholder: kt('Ce que tu veux suivre', 'What you want to keep track of'), value: text, onChange: (e) => setText(e.target.value) }),
              h('button', { type: 'submit', className: 'kbtb-mgo', 'data-kb': 'tables-build-send', disabled: text.trim() === '', 'aria-label': kt('Envoyer à Kaby', 'Send to Kaby') }, svg('arrow', 15))),
            h('div', { className: 'kbtb-mex center' }, EXAMPLES().map((t) => h('button', { key: t, type: 'button', className: 'kbtb-ex', onClick: () => setText(t) }, t))))
        }

        // ── how it's built: the fields of each table, and the map of the links between them ─────────────────────────────────────
        const linkAskText = (db) => kt(
          'Sur la page Tables, dans la base « ' + db.name + ' » (id ' + db.id + '), relie deux de mes tables avec un champ de lien (relation_add), en donnant un nom au lien vu de l’autre côté (inverse). Si ce n’est pas clair, demande-moi lesquelles.',
          'On the Tables page, in the database “' + db.name + '” (id ' + db.id + '), link two of my tables with a link field (relation_add), naming the link as the other table sees it (inverse). If it is unclear, ask me which ones.')
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
              m.nodes.map((n) => h('g', { key: n.key, className: 'kbtb-mn' + (n.key === p.obj.key ? ' on' : ''), role: 'button', tabIndex: 0, 'data-kb': 'tables-map-node', 'data-object': n.key, 'aria-label': kt('Ouvrir la table ', 'Open the table ') + n.label,
                onClick: () => pick(n.key), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(n.key) } } },
              h('rect', { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 12 }),
              h('text', { x: n.x, y: n.y + 4.5, textAnchor: 'middle' }, short(n.label, 20))))),
            rels.length === 0
              ? h('div', { className: 'kbtb-mapnone', 'data-kb': 'tables-map-none' }, h('span', null, kt('Aucune table n’est encore reliée à une autre.', 'No table is linked to another yet.')),
                h('button', { type: 'button', className: 'kbtb-link flat', 'data-kb': 'tables-map-ask', onClick: () => p.ask(linkAskText(p.db)) }, svg('sparkle', 13), kt('Demander à Kaby de relier deux tables', 'Ask Kaby to link two tables')))
              : h('ul', { className: 'kbtb-maplist', 'data-kb': 'tables-map-list' }, rels.map((r) => h('li', { key: r.from + '.' + r.field },
                h('b', null, r.fromLabel + ' › ' + r.label), ' → ', r.toLabel, h('span', { className: 'kbtb-note faint' }, ' · ' + word(r) + ' · ' + kt('vu de ', 'seen from ') + r.toLabel + kt(' sous le nom « ', ' as “') + seenAs(r) + kt(' »', '”'))))))
        }
        const BuiltPanel = ({ p }) => {
          const objects = p.db.objects
          const rels = relationFields(objects)
          const names = TYPE_NAME()
          const tab = p.built === 'map' ? 'map' : 'fields'
          const tabBtn = (id, label) => h('button', { key: id, type: 'button', role: 'tab', className: 'kbtb-tab sm', 'aria-selected': tab === id ? 'true' : 'false', 'data-kb': 'tables-built-tab', 'data-tab': id, onClick: () => p.setBuilt(id) }, label)
          const fieldLine = (o, f) => {
            let kind = names[f.type] || f.type
            if (f.type === 'relation') {
              const target = objects.find((x) => x.key === f.to)
              kind = target ? kt('Lien vers ', 'Link to ') + target.label + ' · ' + (f.many ? kt('plusieurs', 'many') : kt('un seul', 'one')) : kt('Lien vers une table qui n’existe plus', 'Link to a table that no longer exists')
            } else if (f.type === 'money') kind += ' · ' + f.currency
            else if (f.options && f.options.length) kind += ' · ' + f.options.map((x) => x.label).join(', ')
            const flags = [].concat(f.key === o.title ? [kt('titre', 'title')] : [], f.required ? [kt('obligatoire', 'required')] : [], f.protection !== 'normal' ? [f.protection] : [])
            return h('li', { key: f.key, className: 'kbtb-bf', 'data-kb': 'tables-built-field', 'data-field': f.key },
              h('span', { className: 'kbtb-bfl' }, f.label), h('span', { className: 'kbtb-bft' }, kind), flags.length ? h('span', { className: 'kbtb-bfx' }, flags.join(' · ')) : null)
          }
          const fields = h('div', { className: 'kbtb-bgrid', 'data-kb': 'tables-built-fields' }, objects.map((o) => {
            const from = rels.filter((r) => r.to === o.key)
            return h('section', { key: o.key, className: 'kbtb-bcol', 'data-kb': 'tables-built-table', 'data-object': o.key },
              h('h4', null, o.label),
              h('ul', { className: 'kbtb-bl' }, o.fields.map((f) => fieldLine(o, f))),
              from.length === 0 ? null : h('div', { className: 'kbtb-bback' },
                h('span', { className: 'kbtb-bbt' }, svg('link', 11), kt('Lié depuis les autres tables', 'Linked from other tables')),
                h('ul', { className: 'kbtb-bl' }, from.map((r) => h('li', { key: r.from + '.' + r.field, className: 'kbtb-bf', 'data-kb': 'tables-built-back' }, h('span', { className: 'kbtb-bfl' }, seenAs(r)), h('span', { className: 'kbtb-bft' }, kt('depuis ', 'from ') + r.fromLabel + ' › ' + r.label))))))
          }))
          return h('section', { className: 'kbtb-built', 'data-kb': 'tables-built-panel', 'aria-label': kt('Comment c’est construit', 'How it’s built') },
            h('div', { className: 'kbtb-bh' },
              h('b', null, kt('Comment c’est construit', 'How it’s built')),
              h('div', { className: 'kbtb-tabs', role: 'tablist', 'aria-label': kt('Vue du plan', 'Way to look at the plan') }, tabBtn('fields', kt('Champs', 'Fields')), tabBtn('map', kt('Carte des liens', 'Map of links'))),
              h('button', { type: 'button', className: 'kbtb-ib', 'data-kb': 'tables-built-close', 'aria-label': kt('Fermer', 'Close'), onClick: () => p.setBuilt(null) }, svg('x', 16))),
            tab === 'map' ? h(LinkMap, { p, objects, rels }) : fields)
        }

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
          const [data, setData] = useState({ status: 'loading', dbs: [], unreadable: [], today: '', error: null, stale: false })
          const [sel, setSel] = useState(readSel)
          const [rec, setRec] = useState({ key: '', status: 'idle', rows: [], fingerprint: '', truncated: false, error: null })
          const [related, setRelated] = useState({})
          const [reload, setReload] = useState(0)
          const [query, setQuery] = useState('')
          const [menu, setMenu] = useState(null)
          const [, setDrafts] = useState({})
          const [work, setWork] = useState(null)
          const [drawer, setDrawer] = useState(null)
          const [built, setBuilt] = useState(null)
          const [toast, setToast] = useState(null)
          const [sending, setSending] = useState({}) // files on their way into a cell of the table, by row and field
          const [months, setMonths] = useState({})
          const live = useRef({})
          const alive = useRef(true)
          const draftRef = useRef({})
          const saveTimers = useRef({})
          const seen = useRef({})
          const lastRaw = useRef('')
          const inflight = useRef(false)
          const toastTimer = useRef(null)
          const toastSeq = useRef(0)
          const triedDefault = useRef(new Set())
          const wrapRef = useRef(null)

          // ── what is on screen ──
          const db = data.dbs.find((d) => d.id === sel.db) || data.dbs[0] || null
          const obj = db !== null ? (db.objects.find((o) => o.key === sel.object) || db.objects[0] || null) : null
          const ready = coreState === 'ok' && db !== null && obj !== null
          const serverViews = ready ? (obj.views.length > 0 ? obj.views : [defaultView(obj)]) : []
          const views = serverViews.map((v) => (draftRef.current[v.id] !== undefined && draftRef.current[v.id].object === obj.key ? draftRef.current[v.id].view : v))
          const wanted = ready ? sel.views[db.id + '/' + obj.key] : undefined
          const view = ready ? (views.find((v) => v.id === wanted) || views.find((v) => v.fav) || views[0]) : null
          const flt = ready ? (menu === 'filter' && work !== null && work.viewId === view.id ? work.flt : view.state.flt) : null
          const ctx = useMemo(() => {
            if (!ready) return null
            const c = makeCtx(data.today, db.objects, related)
            c.open = (field, id) => live.current.openLinked(field.to, id)
            c.fileUrl = (field, r, f) => fileUrl(live.current.db.id, live.current.obj.key, r.id, field, f)
            c.removeFile = (r, field, f) => live.current.removeFile(r, field, f)
            return c
          }, [ready, data.today, db, related])
          const mine = rec.key === (ready ? db.id + '/' + obj.key : '') ? rec : { rows: [], status: 'loading', truncated: false }
          const rows = useMemo(() => (ready && mine.status === 'ok' ? K.queryRecords(mine.rows, { fields: obj.fields, q: query, flt, sorts: view.state.sorts }, ctx) : []), [ready, mine, obj, query, flt, view, ctx])
          live.current = { db, obj, view, views, ready, sel: sel.views, all: mine.rows, openLinked: () => {}, removeFile: () => {} }

          // ── small helpers ──
          const say = useCallback((text, action) => {
            toastSeq.current += 1
            setToast({ id: toastSeq.current, text, action: action || null })
            try { if (toastTimer.current !== null) clearTimeout(toastTimer.current) } catch (e) { /* no timers */ }
            toastTimer.current = setTimeout(() => { if (alive.current) setToast(null) }, action ? TOAST_UNDO_MS : TOAST_MS)
          }, [])
          const choose = (patch) => setSel((s) => writeSel(Object.assign({}, s, patch)))
          const patchView = (dbId, objKey, view2) => setData((d) => Object.assign({}, d, { dbs: d.dbs.map((x) => (x.id !== dbId ? x : Object.assign({}, x, { objects: x.objects.map((o) => (o.key !== objKey ? o : Object.assign({}, o, { views: o.views.some((v) => v.id === view2.id) ? o.views.map((v) => (v.id === view2.id ? view2 : v)) : o.views.concat([view2]) }))) }))) }))
          const dropView = (dbId, objKey, id) => setData((d) => Object.assign({}, d, { dbs: d.dbs.map((x) => (x.id !== dbId ? x : Object.assign({}, x, { objects: x.objects.map((o) => (o.key !== objKey ? o : Object.assign({}, o, { views: o.views.filter((v) => v.id !== id) }))) }))) }))

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
              setData({ status: 'ok', dbs: r.dbs, unreadable: r.unreadable || [], today: r.today, error: null, stale: false })
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

          // ── saving a view as it is edited ──
          const putDraft = (id, entry) => { draftRef.current = Object.assign({}, draftRef.current, { [id]: entry }); setDrafts(draftRef.current) }
          const dropDraft = (id, entry) => { if (draftRef.current[id] !== entry) return; const next = Object.assign({}, draftRef.current); delete next[id]; draftRef.current = next; setDrafts(next) }
          const saveDraft = async (id) => {
            const entry = draftRef.current[id]
            if (entry === undefined) return
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
            putDraft(id, { view: next, db: L.db.id, object: L.obj.key, obj: L.obj })
            schedule(id, now === true)
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

          // ── views: choose, create, rename, duplicate, delete ──
          const selectView = (id) => { const L = live.current; choose({ views: Object.assign({}, sel.views, { [L.db.id + '/' + L.obj.key]: id }) }); setMenu(null) }
          const createView = async (kind, from) => {
            const L = live.current
            const body = from ? Object.assign(copy(from), { name: from.name + ' ' + kt('(copie)', '(copy)'), owner: 'me' }) : { name: freshName(L.views, kind), kind, owner: 'me', fav: true, state: { flt: K.blankFilter(), sorts: [], hidden: [] } }
            delete body.id
            const r = await call('POST', '/view', { db: L.db.id, object: L.obj.key, op: 'save', view: savable(body, L.obj) })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            patchView(L.db.id, L.obj.key, r.view)
            choose({ views: Object.assign({}, sel.views, { [L.db.id + '/' + L.obj.key]: r.view.id }) })
            setMenu(null)
            refresh()
          }
          const removeView = async (id) => {
            const L = live.current
            const gone = L.views.find((v) => v.id === id)
            if (!gone || L.views.length < 2) return
            const r = await call('POST', '/view', { db: L.db.id, object: L.obj.key, op: 'remove', id })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            dropView(L.db.id, L.obj.key, id)
            if (L.view.id === id) choose({ views: Object.assign({}, sel.views, { [L.db.id + '/' + L.obj.key]: undefined }) })
            say(kt('Vue « ' + gone.name + ' » supprimée.', 'View “' + gone.name + '” deleted.'), { label: kt('Annuler', 'Undo'), run: async () => { const back = await call('POST', '/view', { db: L.db.id, object: L.obj.key, op: 'save', view: gone }); if (!back.ok) say(errorText(back)); refresh() } })
            refresh()
          }

          // ── records ──
          const writeCall = (op, extra) => { const L = live.current; return call('POST', '/write', Object.assign({ db: L.db.id, object: L.obj.key, op }, extra)) }
          const patchRows = (fn) => setRec((s) => Object.assign({}, s, { rows: fn(s.rows) }))
          const createRecord = async (values) => {
            const clean = {}
            for (const k of Object.keys(values)) if (values[k] !== undefined) clean[k] = values[k]
            const r = await writeCall('create', { values: clean })
            if (r.ok && alive.current) { patchRows((rs) => [r.record].concat(rs)); refresh() }
            return r
          }
          const updateField = async (id, key, value) => {
            const r = await writeCall('update', { id, values: { [key]: value } })
            if (r.ok && alive.current) { patchRows((rs) => rs.map((x) => (x.id === id ? r.record : x))); refresh() }
            return r
          }
          // ── files ──
          const rowFiles = (id, key) => { const r = live.current.all.find((x) => x.id === id); return r !== undefined && Array.isArray(r.values[key]) ? r.values[key] : [] }
          /** Sends the files chosen, one by one; what the host kept comes back as `added` (to go onto the row), the others as `failed` with the reason. Nothing is written to the row here. */
          const attach = async (field, files, held) => {
            const L = live.current
            const plan = planFiles(field, held, files)
            const added = []
            const failed = plan.failed.slice()
            const have = new Set((Array.isArray(held) ? held : []).map((x) => x.hash))
            for (const file of plan.ok) {
              if (!alive.current) break
              const r = await call('POST', '/upload' + qs({ db: L.db.id, object: L.obj.key, field: field.key, name: file.name, type: file.type }), file)
              if (!r.ok) { failed.push({ name: file.name, why: 'host', message: errorText(r) }); continue }
              if (have.has(r.file.hash)) { failed.push({ name: file.name, why: 'same' }); continue }
              have.add(r.file.hash)
              added.push(r.file)
            }
            return { added, failed }
          }
          /** Files dropped on a cell of the table: sent, then added to what the row holds there. */
          const dropFiles = async (r, field, files) => {
            if (files.length === 0) return
            const k = r.id + '/' + field.key
            setSending((s) => Object.assign({}, s, { [k]: files.length }))
            let text = ''
            try {
              const out = await attach(field, files, rowFiles(r.id, field.key))
              let added = out.added.length
              if (added > 0) {
                const res = await updateField(r.id, field.key, rowFiles(r.id, field.key).concat(out.added))
                if (res.ok === false) { added = 0; text = errorText(res) }
              }
              if (text === '') text = filesSummary(added, out.failed)
            } finally {
              if (alive.current) setSending((s) => { const n = Object.assign({}, s); delete n[k]; return n })
            }
            if (alive.current && text !== '') say(text)
          }
          /** Takes one file off a row; the Undo puts the list back as it was (the file stays on this computer for a week, until nothing holds it). */
          const removeFile = async (r, field, f) => {
            const L = live.current
            const before = rowFiles(r.id, field.key)
            const next = before.filter((x) => x.hash !== f.hash)
            const res = await updateField(r.id, field.key, next.length === 0 ? null : next)
            if (!alive.current) return
            if (res.ok === false) { say(errorText(res)); return }
            say(kt('Fichier retiré.', 'File removed.'), { label: kt('Annuler', 'Undo'), run: async () => {
              const back = await call('POST', '/write', { db: L.db.id, object: L.obj.key, op: 'update', id: r.id, values: { [field.key]: before } })
              if (!back.ok) say(errorText(back))
              refresh()
            } })
          }
          const restoreRecord = async (id) => {
            const r = await writeCall('restore', { id })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            patchRows((rs) => (rs.some((x) => x.id === id) ? rs : [r.record].concat(rs)))
            say(kt('Ligne rétablie.', 'Row restored.'))
            refresh()
          }
          const deleteRecord = async (id) => {
            const r = await writeCall('delete', { id })
            if (!alive.current) return
            if (!r.ok) { say(errorText(r)); return }
            patchRows((rs) => rs.filter((x) => x.id !== id))
            setDrawer((d) => (d !== null && d.id === id ? null : d))
            say(kt('Ligne supprimée.', 'Row deleted.'), { label: kt('Annuler', 'Undo'), run: () => restoreRecord(id) })
            refresh()
          }
          const moveRecord = async (id, fieldKey, colKey) => {
            const row = rec.rows.find((x) => x.id === id)
            const target = colKey === '' ? null : colKey
            if (!row || (row.values[fieldKey] === undefined ? null : row.values[fieldKey]) === target) return
            const r = await updateField(id, fieldKey, target)
            if (r.ok === false) say(errorText(r))
          }
          const openRecord = (id) => { setMenu(null); setDrawer({ mode: 'edit', id }) }
          const newRecord = (prefill) => { setMenu(null); setDrawer({ mode: 'new', prefill: prefill || {}, nonce: Date.now() }) }
          /** Opens a row of any table of the database (a chip, a « Linked from » row): the table comes up under the drawer, and Back returns to where the click was. */
          const openLinked = (objKey, id) => {
            const L = live.current
            if (!L.ready || !L.db.objects.some((o) => o.key === objKey)) return
            setMenu(null)
            setDrawer((d) => {
              let trail = []
              if (d !== null && d.mode === 'edit') {
                const here = L.all.find((r) => r.id === d.id)
                trail = (Array.isArray(d.trail) ? d.trail : []).concat([{ object: L.obj.key, id: d.id, label: here ? titleOf(L.obj, here) : L.obj.label }])
              } else if (d === null) trail = [{ object: L.obj.key, id: null, label: L.obj.label }]
              return { mode: 'edit', id, trail: trail.slice(-TRAIL_MAX) }
            })
            if (objKey !== L.obj.key) { setQuery(''); choose({ object: objKey }) }
          }
          const goBack = () => {
            if (drawer === null || !Array.isArray(drawer.trail) || drawer.trail.length === 0) return
            const prev = drawer.trail[drawer.trail.length - 1]
            setDrawer(prev.id === null ? null : { mode: 'edit', id: prev.id, trail: drawer.trail.slice(0, -1) })
            if (prev.object !== live.current.obj.key) { setQuery(''); choose({ object: prev.object }) }
          }
          const openTable = (key) => { setQuery(''); setDrawer(null); setMenu(null); choose({ object: key }) }
          live.current.openLinked = openLinked
          live.current.removeFile = removeFile
          const ask = (text) => { try { if (typeof window.__KB_ASK__ === 'function') { window.__KB_ASK__(text); return true } } catch (e) { /* the chat could not open */ } return false }

          // ── effects ──
          useEffect(() => {
            alive.current = true
            return () => {
              alive.current = false
              try { if (toastTimer.current !== null) clearTimeout(toastTimer.current) } catch (e) { /* no timers */ }
              for (const id of Object.keys(saveTimers.current)) { try { clearTimeout(saveTimers.current[id]) } catch (e) { /* no timer */ } }
              // an edit still waiting for its save is sent now: leaving the page must not lose the last click
              for (const id of Object.keys(draftRef.current)) { const e = draftRef.current[id]; call('POST', '/view', { db: e.db, object: e.object, op: 'save', view: savable(e.view, e.obj) }) }
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
          // the records of the table on screen: read again when the host's fingerprint of the database moves
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
          // a table with no saved view gets a plain one, so the first edit has somewhere to live
          useEffect(() => {
            if (!ready || obj.views.length > 0) return
            const key = db.id + '/' + obj.key
            if (triedDefault.current.has(key)) return
            triedDefault.current.add(key)
            call('POST', '/view', { db: db.id, object: obj.key, op: 'save', view: savable(defaultView(obj), obj) }).then(() => { if (alive.current) refresh() })
          }, [ready, ready ? db.id : '', ready ? obj.key : '', ready ? obj.views.length : 0])
          useEffect(() => { if (menu !== 'filter') setWork(null) }, [menu])
          useEffect(() => {
            if (menu === null && drawer === null && built === null) return undefined
            // a link picker closes itself on Escape; the key then goes no further
            const onKey = (e) => { if (e.key === 'Escape') { if (menu !== null) setMenu(null); else if (e.target && e.target.closest && e.target.closest('.kbtb-lp') !== null) return; else if (drawer !== null) setDrawer(null); else setBuilt(null) } }
            const onDown = (e) => { try { if (menu !== null && e.target.closest && e.target.closest('.kbtb-pw') === null && e.target.closest('[data-kb="tables-th-filter"]') === null) setMenu(null) } catch (x) { setMenu(null) } }
            document.addEventListener('keydown', onKey, true)
            document.addEventListener('mousedown', onDown, true)
            return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true) }
          }, [menu, drawer, built])

          // ── the page API the bar, the popovers and the views share ──
          const p = ready ? {
            db, obj, view, views, rows, all: mine.rows, rec: mine, ctx, related, flt, menu, drawer, query, months,
            setMenu, setFlt, editView, sortBy, filterBy, clearAll, selectView, createView: (k) => createView(k, null), dupView: (id) => createView(null, views.find((v) => v.id === id)), removeView, ask, say,
            renameView: (id, name) => updateView(id, (v) => { v.name = name; return v }, true),
            favView: (id) => updateView(id, (v) => { v.fav = !v.fav; return v }, true),
            openRecord, newRecord, openLinked, goBack, openTable, built, setBuilt, closeDrawer: () => setDrawer(null), createRecord, updateField, deleteRecord, moveRecord, attach, dropFiles, removeFile, sending,
            setMonth: (id, ym) => setMonths((m) => Object.assign({}, m, { [id]: ym })),
          } : null

          // ── drawing ──
          const header = (bar) => h('header', { className: 'kb6-headrow' },
            h('div', { className: 'kb6-headcol' },
              h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title' }, ready ? obj.label : kt('Tables', 'Tables')), help()),
              h('p', { className: 'kb8-sub' }, kt('Tes bases de données : des tables, des lignes, des vues. Tout reste sur cet ordinateur.', 'Your databases: tables, rows, views. Everything stays on this computer.'))),
            bar)
          const searchPlaceholder = ready ? kt('Rechercher dans ' + obj.label, 'Search in ' + obj.label) : kt('Rechercher', 'Search')
          const toolbar = !ready ? null
            : tb !== null
              ? h(tb.KbToolbar, { state: { query }, onUpdate: (patch) => { if (patch !== null && typeof patch.query === 'string') setQuery(patch.query) }, hideView: true, hideSort: true, showFav: false, searchPlaceholder, trailing: h(Bar, { p }) })
              : h('div', { className: 'kbtb-plainbar' }, h('label', { className: 'kbtb-find' }, svg('search', 14), h('input', { type: 'search', value: query, 'aria-label': searchPlaceholder, placeholder: searchPlaceholder, onChange: (e) => setQuery(e.target.value) })), h(Bar, { p }))

          let body
          if (coreState === 'loading' || (data.status === 'loading' && coreState !== 'error')) {
            body = h('div', { role: 'status', 'data-kb': 'tables-loading', className: 'kbtb-muted' }, kt('Chargement des tables…', 'Loading tables…'))
          } else if (coreState === 'error' || data.status === 'error') {
            body = h('div', { className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-error' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les tables ne sont pas lisibles pour l’instant.', 'Tables cannot be read right now.')), ' ', coreState === 'error' ? kt('Les règles de lecture ne se chargent pas.', 'The reading rules do not load.') : errorText(data.error)),
              h('button', { type: 'button', className: 'kbtb-btn sm', 'data-kb': 'tables-retry', onClick: () => { if (coreState === 'error') { setCoreState('loading'); loadCore().then(() => setCoreState('ok'), () => setCoreState('error')) } else refresh() } }, kt('Réessayer', 'Try again')))
          } else if (!ready) {
            body = h(NoTables, { p: { ask } })
          } else if (mine.status === 'loading') {
            body = h('div', { role: 'status', 'data-kb': 'tables-loading', className: 'kbtb-muted' }, kt('Chargement des lignes…', 'Loading rows…'))
          } else if (mine.status === 'error') {
            body = h('div', { className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-error' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les lignes ne sont pas lisibles.', 'The rows cannot be read.')), ' ', errorText(mine.error)),
              h('button', { type: 'button', className: 'kbtb-btn sm', onClick: () => setReload((n) => n + 1) }, kt('Réessayer', 'Try again')))
          } else if (rows.length === 0 && view.kind !== 'calendar' && view.kind !== 'board') {
            body = h(Empty, { p, why: mine.rows.length > 0 ? 'filtered' : 'none' })
          } else {
            body = view.kind === 'board' ? h(BoardView, { p }) : view.kind === 'cards' ? h(CardsView, { p }) : view.kind === 'calendar' ? h(CalendarView, { p }) : h(TableView, { p })
          }

          const strip = ready ? h('div', { className: 'kbtb-strip' },
            data.dbs.length > 1 ? h('label', { className: 'kbtb-dbsel' }, svg('db', 14), h('select', { className: 'kbtb-sel', value: db.id, 'data-kb': 'tables-db', 'aria-label': kt('Base de données', 'Database'), onChange: (e) => { setQuery(''); choose({ db: e.target.value, object: '' }) } }, data.dbs.map((d) => h('option', { key: d.id, value: d.id }, d.name)))) : null,
            h('div', { className: 'kbtb-tabs', role: 'tablist', 'aria-label': kt('Tables', 'Tables') }, db.objects.map((o) => h('button', { key: o.key, type: 'button', role: 'tab', className: 'kbtb-tab', 'aria-selected': o.key === obj.key ? 'true' : 'false', 'data-kb': 'tables-tab', 'data-object': o.key, onClick: () => { setQuery(''); setDrawer(null); setMenu(null); choose({ db: db.id, object: o.key }) } }, o.label))),
            h('button', { type: 'button', className: 'kbtb-link', 'data-kb': 'tables-built', 'aria-expanded': built !== null ? 'true' : 'false', onClick: () => setBuilt(built === null ? 'fields' : null) }, svg('link', 13), kt('Comment c’est construit', 'How it’s built')),
            h('button', { type: 'button', className: 'kbtb-link flat', 'data-kb': 'tables-ask-kaby', onClick: () => ask(buildText('')) }, svg('sparkle', 13), kt('Demander à Kaby…', 'Ask Kaby…'))) : null

          const banners = [].concat(
            data.unreadable.map((u) => h('div', { key: 'u' + u.id, className: 'kbtb-banner warn', role: 'alert', 'data-kb': 'tables-unreadable' }, svg('alert', 16), h('span', { className: 'sp' }, h('b', null, u.name + ' : '), errorText(u)))),
            data.stale ? [h('div', { key: 'stale', className: 'kbtb-banner', role: 'status', 'data-kb': 'tables-stale' }, svg('alert', 16), h('span', { className: 'sp' }, kt('Le serveur local ne répond plus : ce que tu vois peut dater de quelques secondes.', 'The local server is not answering: what you see may be a few seconds old.')))] : [])

          return h('div', { className: 'kbtb', 'data-kb': 'tables-page', 'data-view': ready ? view.kind : '', ref: wrapRef },
            h('style', { 'data-plugin': '@local/kybernos-db' }, CSS),
            h('div', { className: 'kbtb-main' },
              header(toolbar),
              strip,
              banners,
              ready && built !== null ? h(BuiltPanel, { p }) : null,
              ready ? h(Chips, { p }) : null,
              h('div', { className: 'kbtb-body' + (drawer !== null ? ' has-drawer' : '') },
                h('div', { className: 'kbtb-content' }, body),
                ready && drawer !== null ? h(Drawer, { key: drawer.mode + (drawer.id || drawer.nonce), p }) : null)),
            toast !== null ? h('div', { className: 'kbtb-toast', role: 'status', 'data-kb': 'tables-toast', key: toast.id }, svg('check', 15), h('span', null, toast.text), toast.action ? h('button', { type: 'button', className: 'kbtb-tact', 'data-kb': 'tables-toast-action', onClick: () => { const run = toast.action.run; setToast(null); run() } }, toast.action.label) : null) : null)
        }
        // the pieces, handed out for the tests (they render each one in a state the page takes a while to reach)
        Page.parts = { Bar, MenuButton, ViewsPop, FieldsPop, FilterPop, SortPop, ModifyPop, ValueCell, TableView, BoardView, CardsView, CalendarView, Chips, Drawer, Empty, NoTables, Cell, Opt, LinkChips, RelationEditor, LinkedFrom, LinkedGroups, BuiltPanel, LinkMap, Thumb, FileChips, FileTd, AttachEditor }
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
                if (window.__KB_MENU__ && typeof window.__KB_MENU__.register === 'function') { off = window.__KB_MENU__.register({ id: ROW_ID, group: 'business', icon: 'grid', labelKey: 'business.tables', label: { en: 'Tables', fr: 'Tables' }, order: 40 }); return }
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
        __test: { useCore, loadCore, kt, lang, plural, plain, copy, same, hueOfColor, optionOf, fmtNumber, fmtMoney, fmtDate, fmtBytes, MASK, titleOf, makeCtx, planFiles, failText, filesSummary, capOf, isImage, fileUrl, MAX_FILE_BYTES, MAX_FILES, relationFields, seenAs, linkOptions, mapLayout, TYPE_NAME, cellText, opLabel, relDay, fieldOf, valueText, conditionText, itemText, valueKind, defaultOp, defaultValueFor, newCondition, withOp, filterable, pathIdx, nodeAt, mapAt, removeAt, addItem, countConditions, liveFilter, dirLabels, sortableFields, nextSorts, defaultView, freshName, savable, barViews, viewIndex, agentViewEvents, boardColumns, pictureOf, totalField, columnTotal, monthOf, shiftMonth, monthGrid, monthLabel, askText, buildText, modifyExamples, errorText, qs, call, build, CSS, ICONS, ROW_ID, SLOT, SEL_KEY, DATE_PRESETS },
      }
    } catch (e) {
      console.warn('[kybernos-db] disabled:', e)
      return { apply () {} }
    }
  }
})
