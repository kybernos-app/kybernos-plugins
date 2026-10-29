// kybernos-pipeline — browser half: the Pipeline board.
//
// One row in the « Business » group of the menu (window.__KB_MENU__, docs/dev/business-menu.md) and the page it opens, mounted on the keyed slot
// `main.kybernos-business`. The data is on the host (/kybernos-pipeline/*, always with the signed session cookie the page already carries); this file draws
// the columns the active theme defines, the total of each column in the theme's value format, and moves a card three ways: a real drag (pointer events, so a
// mouse, a pen and a finger behave alike), the arrow keys on a focused card (announced to screen readers), and the arrow button on the card.
// The search, the view switch (Columns, List, and Calendar when cards carry due dates), the filters and the sort are the product's own bar (`props.toolbar`,
// handed over by the core); the tags, avatars, drawings and gentle motion are the shared business kit (`window.__KB_BIZ_KIT__`), read when drawing.
// The factory always returns a plugin; every failure degrades to « no page », never to a broken entry.
window.__ModuleLoader__.load({
  id: '@local/kybernos-pipeline',
  factory: (require) => {
    try {
      const React = require('react')
      const h = React.createElement
      const { useState, useEffect, useRef, useCallback } = React

      // ── words ────────────────────────────────────────────────────────────────────────────────
      const lang = () => {
        try {
          const s = String((typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : document.documentElement.lang) || 'en').toLowerCase()
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => lang() === 'fr' ? fr : en
      /** The language code of the page for a theme's own words (`es`, `ar` when the theme gives them), else ''. */
      const labelLang = () => { try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : '').split(/[-_]/)[0].toLowerCase() } catch (e) { return '' } }
      /** `{ en, fr }` from the theme: the language of the page, else English. */
      const pickLabel = (label) => {
        if (label === null || typeof label !== 'object') return ''
        const l = lang() === 'fr' ? 'fr' : labelLang()
        return typeof label[l] === 'string' && label[l] !== '' ? label[l] : (typeof label.en === 'string' ? label.en : '')
      }

      // ── pure helpers (exposed as __test) ─────────────────────────────────────────────────────
      const round2 = (n) => Math.round(n * 100) / 100
      /** A value in the theme's format: money with its currency, or a plain number; empty when there is none. */
      const fmtValue = (n, value) => {
        if (typeof n !== 'number' || !Number.isFinite(n)) return ''
        const locale = lang() === 'fr' ? 'fr-FR' : undefined
        const digits = Number.isInteger(n) ? 0 : 2
        try {
          if (value !== null && value !== undefined && value.format === 'money' && typeof value.currency === 'string') return new Intl.NumberFormat(locale, { style: 'currency', currency: value.currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(n)
          return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
        } catch (e) { return String(n) }
      }
      /** How long a card has been in its column: « today », « 3d », « 2w ». */
      const ageOf = (iso, now) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return ''
        const days = Math.max(0, Math.floor(((typeof now === 'number' ? now : Date.now()) - t) / 86400000))
        if (days === 0) return kt('aujourd’hui', 'today')
        if (days < 14) return days + kt(' j', 'd')
        return Math.floor(days / 7) + kt(' sem.', 'w')
      }
      const initials = (name) => {
        const words = String(name || '').trim().split(/\s+/).filter((w) => w !== '')
        if (words.length === 0) return ''
        return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : '')).toUpperCase()
      }
      /** The board as it will be once the host has moved a card to the end of a column (shown at once; the host's answer replaces it). */
      const moveInBoard = (board, id, stage, sinceIso) => {
        let moved = null
        const without = board.columns.map((c) => {
          const at = c.cards.findIndex((x) => x.id === id)
          if (at < 0) return c
          moved = c.cards[at]
          const cards = c.cards.filter((x) => x.id !== id)
          return { ...c, cards, count: cards.length, total: round2(c.total - (typeof moved.value === 'number' ? moved.value : 0)) }
        })
        if (moved === null || !without.some((c) => c.stage === stage)) return board
        const columns = without.map((c) => (c.stage !== stage ? c : { ...c, cards: [...c.cards, { ...moved, stage, since: sinceIso }], count: c.count + 1, total: round2(c.total + (typeof moved.value === 'number' ? moved.value : 0)) }))
        return { ...board, columns }
      }
      /** The stage next to `stage` in the direction (-1 or 1), or null at the end. */
      const neighbour = (columns, stage, dir) => {
        const at = columns.findIndex((c) => c.stage === stage)
        const to = at + dir
        return at < 0 || to < 0 || to >= columns.length ? null : columns[to].stage
      }
      /** What the person reads for an error code of the host (or of the network). */
      const errText = (code, detail) => {
        switch (code) {
          case 'base_missing': return kt('Les données métier ne sont pas disponibles sur cet ordinateur. Relance Kybernos.', 'The business data is not available on this computer. Restart Kybernos.')
          case 'http_401': case 'http_403': case 'http_503': return kt('Ta session a expiré : recharge la page.', 'Your session has expired: reload the page.')
          case 'network': return kt('Le serveur local ne répond pas.', 'The local server does not answer.')
          case 'not_found': return kt('Cette carte n’existe plus.', 'This card no longer exists.')
          case 'archived': return kt('Cette carte est archivée : restaure-la d’abord.', 'This card is archived: restore it first.')
          case 'unknown_stage': return kt('Cette étape n’existe pas sur ce tableau.', 'This stage does not exist on this board.')
          case 'link_not_allowed': return kt('Ce tableau n’accepte pas ce lien.', 'This board does not take that link.')
          case 'busy': return kt('La base est occupée : réessaie dans un instant.', 'The base is busy: try again in a moment.')
          default: return kt('Action refusée', 'Refused') + (typeof detail === 'string' && detail !== '' ? kt(' : ', ': ') + detail : ' (' + String(code) + ')')
        }
      }

      /** One call to the host: `{ ok, data }` or `{ ok: false, error, detail }`; never rejects. */
      const api = (path, body) => {
        const init = body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        return fetch('/kybernos-pipeline/' + path, init).then((r) => r.json().then((j) => ({ status: r.status, json: j }), () => ({ status: r.status, json: null })))
          .then((r) => {
            if (r.status === 200 && r.json !== null && r.json.ok === true) return { ok: true, data: r.json }
            if (r.status === 200 && r.json !== null) return { ok: false, error: String(r.json.error), detail: r.json.detail }
            return { ok: false, error: 'http_' + r.status, detail: r.json !== null ? r.json.error : undefined }
          }, () => ({ ok: false, error: 'network' }))
      }

      const store = () => { try { return window.localStorage } catch (e) { return null } }
      const FLOW_KEY = 'kybernos.pipeline.flow.v1'
      const rememberedFlow = () => { try { return store().getItem(FLOW_KEY) } catch (e) { return null } }
      const rememberFlow = (id) => { try { store().setItem(FLOW_KEY, id) } catch (e) { /* nothing depends on it */ } }
      const rtl = () => { try { return window.getComputedStyle(document.documentElement).direction === 'rtl' } catch (e) { return false } }

      /** Keeps Tab inside a dialog: from the last control back to the first, and the other way round. */
      const trapTab = (e) => {
        if (e.key !== 'Tab') return
        const nodes = Array.prototype.filter.call(e.currentTarget.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])'), (n) => !n.disabled && n.offsetParent !== null)
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }

      // ── what the card can carry besides its own columns ─────────────────────────────────────────────
      // `card.fields` (a JSON object of the base's flow_card row) may hold { source, priority, due, tags }. The host's board route does not return `fields` yet:
      // every reader below tolerates its absence and draws nothing for what is not there.
      const DAY = 86400000
      const parseDue = (s) => {
        if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
        const y = Number(s.slice(0, 4))
        const m = Number(s.slice(5, 7))
        const d = Number(s.slice(8, 10))
        const t = new Date(y, m - 1, d)
        return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t : null
      }
      const dayStart = (now) => { const d = new Date(typeof now === 'number' ? now : Date.now()); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
      /** Whole days from today to the due date (negative when it is past); null when there is no valid date. */
      const dueIn = (due, now) => { const t = parseDue(due); return t === null ? null : Math.round((t.getTime() - dayStart(now).getTime()) / DAY) }
      const extrasOf = (card) => {
        const f = card !== null && typeof card === 'object' && card.fields !== null && typeof card.fields === 'object' && !Array.isArray(card.fields) ? card.fields : {}
        const text = (v, max) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : '')
        const tags = []
        for (const t of Array.isArray(f.tags) ? f.tags : []) { const x = text(t, 30); if (x !== '' && tags.indexOf(x) < 0 && tags.length < 6) tags.push(x) }
        return { source: text(f.source, 40), priority: f.priority === 'high' || f.priority === 'normal' || f.priority === 'low' ? f.priority : '', due: parseDue(f.due) === null ? '' : f.due, tags }
      }
      const norm = (x) => String(x === null || x === undefined ? '' : x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      /** Days a card has been in its column (whole days, 0 when the date is unreadable). */
      const daysIn = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.floor(((typeof now === 'number' ? now : Date.now()) - t) / DAY)) : 0 }

      // ── colours: one hue per stage, from the kit's soft hues ─────────────────────────────────────
      const STAGE_HUES = [236, 212, 192, 170, 146]
      const UNKNOWN_HUE = 38
      /** The hue of the stage at `index` among `count` known stages: indigo at the start, green at the end. */
      const stageHue = (index, count) => (count <= 1 ? STAGE_HUES[1] : STAGE_HUES[Math.round((index * (STAGE_HUES.length - 1)) / (count - 1))])
      const PRIORITY_HUE = { high: 8, normal: 212, low: 170 }
      const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true } catch (e) { return false } }

      // ── the picture of an item: the kit draws it, the item's own words say which kind (the board returns a title and a subtitle, no type) ──
      const ART_WORDS = [
        ['loft', /\b(loft|attic|grenier|combles)s?\b/],
        ['villa', /\bvillas?\b/],
        ['house', /\b(house|townhouse|maison|cottage|bungalow|pavillon)s?\b/],
        ['apartment', /\b(apartment|flat|studio|appartement|appart|duplex|penthouse)s?\b/],
        ['shop', /\b(shop|store|boutique|commercial|retail|cafe|restaurant|bakery|local)s?\b/],
        ['bottle', /\b(bottle|candle|carafe|wine|bouteille|bougie|huile|oil|perfume)s?\b/],
        ['bag', /\b(bag|tote|sac|pouch)s?\b/],
        ['box', /\b(box|parcel|coffret|colis|crate)s?\b/],
        ['desk', /\b(engineer|designer|manager|analyst|executive|developer|recruiter|officer|consultant|director|head of|ingenieur|responsable|analyste)s?\b/],
      ]
      /** `house`, `desk`… for a title, or '' when nothing in it says (then no picture is drawn rather than a wrong one). */
      const artKindOf = (text) => { const t = norm(text); for (const [kind, re] of ART_WORDS) if (re.test(t)) return kind; return '' }
      const COVER_KINDS = ['house', 'apartment', 'villa', 'loft', 'shop']
      /** The kit's spec for a drawing: its seed takes letters, digits, dot, dash and underscore only, so a title is folded into that. */
      const artSpec = (kind, text) => 'art:' + kind + '/' + String(text).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)
      const PHOTO_RE = /^photo:([a-z0-9][a-z0-9-]{1,39}\/[a-z0-9][a-z0-9-]{1,59})$/
      /** The picture of a linked item: its own (the host sends `item.image`, a shipped photograph or a drawn spec), else the drawing its words suggest, else null. */
      const itemPicture = (item, k, guessed) => {
        if (item === null || item === undefined) return null
        const ref = typeof item.image === 'string' ? item.image : ''
        const m = PHOTO_RE.exec(ref)
        if (m !== null) return h('img', { className: 'kbpi-photo', src: '/kybernos/themes/photo?id=' + encodeURIComponent(m[1]), alt: '', loading: 'lazy', decoding: 'async', draggable: false })
        if (k !== null && typeof k.Art === 'function' && typeof k.artOk === 'function' && k.artOk(ref)) return h(k.Art, { spec: ref })
        return guessed !== '' && k !== null && typeof k.Art === 'function' ? h(k.Art, { spec: artSpec(guessed, item.title) }) : null
      }

      // ── what is shown: search, facets, period, favourites, sort ──────────────────────────────────
      const SORTS = ['position', 'since', 'value', 'name']
      /** The facet options (with counts) the board offers: its stages, then priority, source and tags when cards carry them. */
      const facetOptions = (board) => {
        const cols = board.columns
        const out = cols.map((c) => ({ id: 'stage:' + c.stage, label: pickLabel(c.label) || c.stage, count: c.cards.length }))
        const count = (pick) => { const m = new Map(); for (const c of cols) for (const card of c.cards) for (const v of pick(extrasOf(card))) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))) }
        const prio = { high: kt('Haute', 'High'), normal: kt('Normale', 'Normal'), low: kt('Basse', 'Low') }
        for (const [v, n] of count((x) => (x.priority === '' ? [] : [x.priority]))) out.push({ id: 'prio:' + v, label: kt('Priorité : ', 'Priority: ') + prio[v], count: n })
        for (const [v, n] of count((x) => (x.source === '' ? [] : [x.source])).slice(0, 6)) out.push({ id: 'src:' + v, label: kt('Source : ', 'Source: ') + v, count: n })
        for (const [v, n] of count((x) => x.tags).slice(0, 8)) out.push({ id: 'tag:' + v, label: kt('Étiquette : ', 'Tag: ') + v, count: n })
        return out
      }
      const cardMatchesTypes = (card, types) => {
        if (types.length === 0) return true
        const x = extrasOf(card)
        const groups = { stage: [], prio: [], src: [], tag: [] }
        for (const t of types) { const at = t.indexOf(':'); if (at > 0 && groups[t.slice(0, at)] !== undefined) groups[t.slice(0, at)].push(t.slice(at + 1)) }
        const has = (list, test) => list.length === 0 || list.some(test)
        return has(groups.stage, (s) => s === card.stage) && has(groups.prio, (p) => p === x.priority) && has(groups.src, (s) => s === x.source) && has(groups.tag, (t) => x.tags.indexOf(t) >= 0)
      }
      const cardText = (card) => norm([card.title, card.subtitle, card.contact !== null && card.contact !== undefined ? card.contact.name : '', card.item !== null && card.item !== undefined ? card.item.title + ' ' + (card.item.subtitle || '') : '', extrasOf(card).source, extrasOf(card).tags.join(' ')].join(' '))
      const sortCards = (cards, sort, dir) => {
        if (sort === 'position') return dir === 'asc' ? cards.slice().reverse() : cards
        const sign = dir === 'asc' ? 1 : -1
        const key = (c) => (sort === 'value' ? (typeof c.value === 'number' ? c.value : Number.NEGATIVE_INFINITY) : sort === 'since' ? (Date.parse(c.since) || 0) : norm(c.title))
        return cards.slice().sort((a, b) => { const x = key(a); const y = key(b); return x === y ? 0 : (x < y ? -1 : 1) * sign })
      }
      /** The columns as the toolbar's choices show them: filtered, sorted, counts and totals recomputed; `shown` and `all` count the cards. */
      const visibleColumns = (board, tb, favs, now) => {
        const q = norm(tb.query).split(/\s+/).filter((w) => w !== '')
        const types = Array.isArray(tb.types) ? tb.types : []
        const days = tb.period === '7' ? 7 : tb.period === '30' ? 30 : 0
        const sort = SORTS.indexOf(tb.sort) >= 0 ? tb.sort : 'position'
        const stagesOnly = types.filter((t) => t.indexOf('stage:') === 0).map((t) => t.slice(6))
        let shown = 0
        let all = 0
        const columns = []
        for (const col of board.columns) {
          all += col.cards.length
          if (stagesOnly.length > 0 && stagesOnly.indexOf(col.stage) < 0) continue
          const kept = col.cards.filter((card) => {
            if (tb.fav === true && !favs.has(card.id)) return false
            if (days > 0 && (typeof now === 'number' ? now : Date.now()) - (Date.parse(card.since) || 0) > days * DAY) return false
            if (!cardMatchesTypes(card, types.filter((t) => t.indexOf('stage:') !== 0))) return false
            if (q.length > 0) { const text = cardText(card); if (!q.every((w) => text.indexOf(w) >= 0)) return false }
            return true
          })
          const cards = sortCards(kept, sort, tb.dir === 'asc' ? 'asc' : 'desc')
          shown += cards.length
          columns.push({ ...col, cards, count: cards.length, total: round2(cards.reduce((a, c) => a + (typeof c.value === 'number' ? c.value : 0), 0)) })
        }
        return { columns, shown, all }
      }
      const filtersOn = (tb) => (typeof tb.query === 'string' && tb.query.trim() !== '') || (Array.isArray(tb.types) && tb.types.length > 0) || tb.period === '7' || tb.period === '30' || tb.fav === true
      /** The views the data can fill: the board and the table always; the calendar only when a card carries a due date. */
      const viewsOf = (board) => (board !== null && board.columns.some((c) => c.cards.some((card) => extrasOf(card).due !== '')) ? ['columns', 'list', 'calendar'] : ['columns', 'list'])
      const FAV_KEY = 'kybernos.pipeline.fav.v1'
      const readFavs = () => { try { const a = JSON.parse(window.localStorage.getItem(FAV_KEY)); return new Set(Array.isArray(a) ? a.filter((n) => Number.isInteger(n)).slice(0, 500) : []) } catch (e) { return new Set() } }
      const writeFavs = (set) => { try { window.localStorage.setItem(FAV_KEY, JSON.stringify([...set].slice(-500))) } catch (e) { /* nothing depends on it */ } }
      const dueLabel = (days, due) => {
        if (days === 0) return kt('aujourd’hui', 'today')
        if (days === 1) return kt('demain', 'tomorrow')
        if (days === -1) return kt('hier', 'yesterday')
        if (days > 1 && days <= 3) return kt('dans ' + days + ' j', 'in ' + days + 'd')
        const t = parseDue(due)
        try { return new Intl.DateTimeFormat(lang() === 'fr' ? 'fr-FR' : undefined, { day: 'numeric', month: 'short' }).format(t) } catch (e) { return due }
      }
      const dueTitle = (days) => (days < 0 ? kt('En retard de ' + -days + ' jour(s)', 'Overdue by ' + -days + ' day(s)') : days === 0 ? kt('À faire aujourd’hui', 'Due today') : kt('À faire dans ' + days + ' jour(s)', 'Due in ' + days + ' day(s)'))

      // ── styles: DSH tokens, and the kit's soft hues (hsl of --kz-h) ─────────────────────────────
      const STYLE_ID = 'kbpi-style'
      const CSS = `
/* the text of a tint is darker than its fill on a light page and lighter on a dark one (the kit's tags keep one lightness: lifted here so they read in both) */
.kbpi-root{--kbpi-fg-s:75%;--kbpi-fg-l:31%}
body[data-ds-dark-theme] .kbpi-root,body[data-ds-dark-theme] .kbpi-ghost{--kbpi-fg-s:80%;--kbpi-fg-l:76%}
.kbpi-root .kz-tag:not(.on){color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor))}
.kbpi-root{--kbpi-ease:cubic-bezier(.23,1,.32,1);display:flex;flex-direction:column;gap:14px;min-width:0}
.kbpi-btn{white-space:nowrap}
/* the product's filter menu opens from its button to the right (left:0): next to the primary action it would leave the window, so here it opens to the left; it scrolls when a board has many tags */
.kbpi-root .kb6-tb-pop{left:auto;right:0;max-height:min(70vh,560px);overflow-y:auto}
[dir="rtl"] .kbpi-root .kb6-tb-pop{left:0;right:auto}
/* the bar's one facet list is not made of file types: its title is this page's own words (the core's label stays for the other pages) */
.kbpi-root .kb6-tb-pophead.row + .kb6-tb-facetlabel{font-size:0}
.kbpi-root .kb6-tb-pophead.row + .kb6-tb-facetlabel::after{content:var(--kbpi-facet,"");font-size:12px}
.kbpi-primary:disabled{opacity:.5;cursor:default}
.kbpi-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.kbpi-tools .sp{flex:1 1 auto}
.kbpi-tabs{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);max-width:100%;overflow-x:auto}
.kbpi-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s var(--kbpi-ease),color .15s var(--kbpi-ease)}
.kbpi-tab:hover{color:var(--dsw-alias-label-primary)}
.kbpi-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}
.kbpi-tab i{font-style:normal;margin-inline-start:6px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbpi-tab:focus-visible,.kbpi-link:focus-visible,.kbpi-star:focus-visible,.kbpi-add:focus-visible,.kbpi-cal-chip:focus-visible,.kbpi-calnav button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbpi-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4}
.kbpi-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 8px;border-radius:7px;cursor:pointer;white-space:nowrap}
.kbpi-link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-link[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}
.kbpi-strip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbpi-strip b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.kbpi-banner{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.kbpi-banner.bad{border-color:var(--dsw-alias-state-error-primary)}
.kbpi-banner.note{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent)}
.kbpi-banner .sp{flex:1 1 auto}
/* the board */
.kbpi-board{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 10px;align-items:flex-start;scroll-snap-type:x proximity;transition:opacity .15s var(--kbpi-ease)}
.kbpi-board.stale{opacity:.45;pointer-events:none}
.kbpi-col{--kz-h:212;flex:1 0 224px;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px;min-height:300px;scroll-snap-align:start;box-shadow:inset 0 3px 0 hsl(var(--kz-h) 72% 55% / .85);transition:border-color .15s var(--kbpi-ease),background .15s var(--kbpi-ease),box-shadow .15s var(--kbpi-ease)}
.kbpi-col.over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-layer-1));box-shadow:inset 0 3px 0 hsl(var(--kz-h) 72% 55% / .85),0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)}
.kbpi-col.over .kbpi-cards::after{content:"";display:block;height:46px;border:1.5px dashed var(--dsw-alias-brand-primary);border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);animation:kbpi-slot .18s var(--kbpi-ease) both}
.kbpi-col.unknown{border-style:dashed}
.kbpi-colh{display:flex;align-items:center;gap:8px;padding:6px 4px 2px}
.kbpi-colsum{min-height:20px;padding-block:0 8px;padding-inline:20px 4px;display:flex}
.kbpi-colh .dot{width:8px;height:8px;border-radius:50%;background:hsl(var(--kz-h) 75% 52%);flex:none}
.kbpi-colh b{font-weight:650;color:var(--dsw-alias-label-primary);min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent)}
.kbpi-sum{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.kbpi-add{width:22px;height:22px;border-radius:7px;display:inline-grid;place-items:center;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;flex:none;transition:background .15s var(--kbpi-ease),color .15s var(--kbpi-ease),transform .14s var(--kbpi-ease)}
.kbpi-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-add:active{transform:scale(.92)}
.kbpi-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-height:40px}
.kbpi-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:14px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* a card */
.kbpi-card{--kz-h:212;position:relative;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 11px 13px;display:flex;flex-direction:column;gap:8px;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none;color:var(--dsw-alias-label-primary)}
.kbpi-card.kz-lift{transition:transform .18s var(--kbpi-ease),box-shadow .18s var(--kbpi-ease),border-color .14s var(--kbpi-ease),opacity .15s var(--kbpi-ease)}
.kbpi-card:hover{border-color:var(--dsw-alias-border-l2)}
.kbpi-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbpi-card.drag{opacity:.35;transform:scale(.98);outline:1.5px dashed var(--dsw-alias-border-l2);outline-offset:-1px}
.kbpi-card.hold{opacity:0}
.kbpi-card.settle{animation:kbpi-settle .34s var(--kbpi-ease) both}
.kbpi-cover{margin:-10px -11px 0;height:76px;position:relative;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l1)}
.kbpi-ctop{display:flex;align-items:flex-start;gap:9px;min-width:0}
.kbpi-lead{flex:none;display:inline-flex;border-radius:50%}
.kbpi-lead.sq{border-radius:9px;overflow:hidden;width:32px;height:32px;align-items:center;justify-content:center;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent)}
.kbpi-ctext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;padding-inline-end:18px}
.kbpi-ctext b{font-weight:600;line-height:1.3;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kbpi-sub{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kbpi-leadwrap{position:relative;flex:none;display:inline-flex}
.kbpi-prio{position:absolute;inset-inline-end:-3px;inset-block-end:-3px;width:11px;height:11px;border-radius:50%;background:hsl(var(--kz-h) 75% 52%);border:2px solid var(--dsw-alias-bg-layer-2)}
.kbpi-card .kbpi-star{position:absolute;inset-block-start:6px;inset-inline-end:6px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px var(--dsw-alias-border-l1);z-index:1}
.kbpi-card .kbpi-star:hover{background:var(--dsw-alias-bg-layer-3)}
.kbpi-cell{display:inline-flex;align-items:center;gap:4px;justify-content:flex-end}
.kbpi-tbl td.main,.kbpi-tbl th.main{width:30%;min-width:240px}
.kbpi-star{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;flex:none;opacity:0;transition:opacity .15s var(--kbpi-ease),color .15s var(--kbpi-ease),background .15s var(--kbpi-ease),transform .14s var(--kbpi-ease)}
.kbpi-card:hover .kbpi-star,.kbpi-card:focus-within .kbpi-star,.kbpi-star.on,.kbpi-star:focus-visible,.kbpi-row:hover .kbpi-star{opacity:1}
.kbpi-star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-star:active{transform:scale(.88)}
.kbpi-star.on{--kz-h:38;color:hsl(var(--kz-h) 90% 50%)}
.kbpi-star.on svg{fill:currentColor}
.kbpi-tags{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0}
.kbpi-item{--kz-h:212;display:inline-flex;align-items:center;gap:6px;max-width:100%;height:22px;padding:0 9px 0 3px;border-radius:11px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,hsl(var(--kz-h) 70% 50%) 22%,transparent)}
.kbpi-item .pic{width:24px;height:16px;border-radius:8px;overflow:hidden;flex:none;display:inline-grid;place-items:center}
.kbpi-item .pic svg.kz-art{border-radius:0}
.kbpi-photo{display:block;width:100%;height:100%;object-fit:cover}
.kbpi-item span.t{overflow:hidden;text-overflow:ellipsis}
.kbpi-foot{display:flex;align-items:center;gap:6px;min-width:0}
.kbpi-foot .sp{flex:1 1 auto}
.kbpi-pill{--kz-h:212;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:11px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent)}
.kbpi-pill.calm{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);font-weight:500}
.kbpi-pill.dim{height:20px;padding:0 7px;font-size:11px}
.kbpi-demo{font-size:11px;font-weight:600;color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-label-primary));border:1px solid var(--dsw-alias-state-warn-primary);border-radius:999px;padding:0 6px;line-height:16px;white-space:nowrap}
.kbpi-go{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);background:transparent;cursor:pointer;padding:0;flex:none;transition:background .15s var(--kbpi-ease),color .15s var(--kbpi-ease),transform .14s var(--kbpi-ease)}
.kbpi-go:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-go:active{transform:scale(.92)}
.kbpi-go:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kbpi-go[hidden]{display:none}
.kbpi-bar{position:absolute;inset-inline:0;bottom:0;height:3px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.kbpi-bar i{display:block;height:100%;width:var(--p,0%);background:hsl(var(--kz-h) 70% 52%);border-start-end-radius:3px;border-end-end-radius:3px}
.kbpi-ghost{position:fixed;z-index:2147483000;pointer-events:none;margin:0;opacity:.97;transform:none;transform-origin:50% 40%;border-color:var(--dsw-alias-brand-primary);box-shadow:0 20px 34px -14px color-mix(in srgb,var(--dsw-alias-label-primary) 55%,transparent),0 0 0 1.5px var(--dsw-alias-brand-primary);transition:transform .14s cubic-bezier(.23,1,.32,1)}
.kbpi-ghost .kbpi-star,.kbpi-card.drag .kbpi-star{opacity:0}
.kbpi-board.dragging .kbpi-card{pointer-events:none}
.kbpi-bone{border-radius:8px;background:var(--dsw-alias-bg-layer-3);animation:kbpi-pulse 1.4s ease-in-out infinite}
.kbpi-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* the table */
.kbpi-tblwrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kbpi-tbl{width:100%;border-collapse:collapse;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbpi-tbl th{text-align:start;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.kbpi-tbl td{padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
.kbpi-tbl tr:last-child td{border-bottom:0}
.kbpi-tbl td.num,.kbpi-tbl th.num{text-align:end}
.kbpi-row{cursor:pointer;transition:background .14s var(--kbpi-ease)}
.kbpi-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbpi-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.kbpi-row .who{display:flex;align-items:center;gap:10px;min-width:0}
.kbpi-row .who>span.tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbpi-row .who b{font-weight:600;overflow-wrap:anywhere}
.kbpi-stagepill{--kz-h:212;position:relative;display:inline-flex;align-items:center;gap:6px;height:24px;padding-block:0;padding-inline:10px 8px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,hsl(var(--kz-h) 70% 50%) 22%,transparent);cursor:pointer;transition:background .15s var(--kbpi-ease)}
.kbpi-stagepill:hover{background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 26%,transparent)}
.kbpi-stagepill i{width:7px;height:7px;border-radius:50%;background:hsl(var(--kz-h) 75% 52%);flex:none}
.kbpi-stagepill select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font:inherit}
.kbpi-stagepill:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* the calendar */
.kbpi-calnav{display:flex;align-items:center;gap:8px}
.kbpi-calnav h2{margin:0;font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary);min-width:140px}
.kbpi-calnav button{height:28px;min-width:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;transition:background .15s var(--kbpi-ease),transform .14s var(--kbpi-ease)}
.kbpi-calnav button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-calnav button:active{transform:scale(.95)}
.kbpi-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.kbpi-cal .wd{padding:7px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.kbpi-day{min-height:92px;padding:6px;display:flex;flex-direction:column;gap:3px;border-inline-end:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
.kbpi-day:nth-child(7n){border-inline-end:0}
.kbpi-day.out{background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}
.kbpi-day.out .n{opacity:.5}
.kbpi-day .n{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;width:22px;height:22px;display:inline-grid;place-items:center;border-radius:11px}
.kbpi-day.today .n{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:700}
.kbpi-cal-chip{--kz-h:212;display:flex;align-items:center;gap:6px;width:100%;min-width:0;height:22px;padding:0 7px;border:0;border-radius:7px;font:inherit;font-size:11px;font-weight:600;text-align:start;cursor:pointer;color:color-mix(in srgb,hsl(var(--kz-h) var(--kbpi-fg-s,75%) var(--kbpi-fg-l,31%)) 78%,var(--dsw-alias-label-primary,currentColor));background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 15%,transparent);transition:background .15s var(--kbpi-ease),transform .14s var(--kbpi-ease)}
.kbpi-cal-chip:hover{background:color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 26%,transparent)}
.kbpi-cal-chip:active{transform:scale(.97)}
.kbpi-cal-chip i{width:6px;height:6px;border-radius:50%;background:hsl(var(--kz-h) 75% 52%);flex:none}
.kbpi-cal-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-more{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:0 7px}
.kbpi-arch{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.kbpi-arch h2{margin:0;font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}
.kbpi-arow{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbpi-arow span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-modal{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:var(--dsw-alias-bg-mask-1)}
.kbpi-dlg{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;animation:kbpi-dlg .2s var(--kbpi-ease) both}
.kbpi-dlg h2{margin:0;font-size:16px;font-weight:700}
.kbpi-dlg p{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbpi-f{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.kbpi-f input,.kbpi-f select{font:inherit;font-size:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px;box-sizing:border-box;width:100%;min-width:0}
.kbpi-f input:focus-visible,.kbpi-f select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kbpi-pick{display:flex;flex-direction:column;gap:4px;min-width:0}
.kbpi-row2{display:flex;gap:10px}
.kbpi-row2>*{flex:1 1 0}
.kbpi-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:4px}
.kbpi-acts .sp{flex:1 1 auto}
.kbpi-err{color:var(--dsw-alias-state-error-primary);font-size:12px}
.kbpi-sel{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 4px 3px 10px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:100%}
.kbpi-sel span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-sel button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;padding:0 6px;border-radius:999px}
.kbpi-sel button:hover{color:var(--dsw-alias-label-primary)}
.kbpi-list{list-style:none;margin:2px 0 0;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;max-height:150px;overflow:auto}
.kbpi-list button{display:flex;width:100%;gap:8px;align-items:baseline;text-align:start;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 10px;cursor:pointer}
.kbpi-list button:hover,.kbpi-list button:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.kbpi-list small{color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-toast{position:fixed;inset-inline-start:50%;bottom:22px;transform:translateX(-50%);z-index:2147483100;max-width:min(520px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:9px 14px;font-size:13px;animation:kbpi-toast .22s var(--kbpi-ease) both}
.kbpi-toast.bad{border-color:var(--dsw-alias-state-error-primary)}
@keyframes kbpi-pulse{50%{opacity:.45}}
@keyframes kbpi-slot{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes kbpi-settle{0%{transform:scale(1.035);box-shadow:0 0 0 3px color-mix(in srgb,hsl(var(--kz-h) 80% 55%) 35%,transparent)}100%{transform:none;box-shadow:0 0 0 0 transparent}}
@keyframes kbpi-dlg{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
@keyframes kbpi-toast{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media (hover:none){.kbpi-star{opacity:1}}
@media (prefers-reduced-motion: reduce){
  .kbpi-bone,.kbpi-card.settle,.kbpi-col.over .kbpi-cards::after,.kbpi-dlg,.kbpi-toast{animation:none}
  .kbpi-col,.kbpi-board,.kbpi-card,.kbpi-card.kz-lift,.kbpi-ghost,.kbpi-tab,.kbpi-go,.kbpi-add,.kbpi-star,.kbpi-row,.kbpi-stagepill,.kbpi-cal-chip,.kbpi-calnav button{transition:none}
  .kbpi-card.drag{transform:none}
}
@media (max-width: 560px){.kbpi-col{flex-basis:78vw}.kbpi-row2{flex-direction:column}.kbpi-day{min-height:64px}}
.kbpi-av{width:32px;height:32px;border-radius:50%;display:inline-grid;place-items:center;font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
`

      const Help = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-pipeline' }) : null)
      const Plus = () => h('svg', { width: 14, height: 14, style: { flex: 'none' }, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M12 5v14M5 12h14' }))
      const Arrow = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: rtl() ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6' }))
      const Bone = (props) => h('div', { className: 'kbpi-bone', style: { width: props.w || '100%', height: props.hgt || 14 } })

      // ── a contact or an item to link: a chip when chosen, a search otherwise ──────────────
      function LinkPicker (props) {
        const [q, setQ] = useState('')
        const [rows, setRows] = useState(null)
        const [open, setOpen] = useState(false)
        useEffect(() => {
          if (!open) return undefined
          let live = true
          const t = setTimeout(() => { api('links?kind=' + props.kind + '&q=' + encodeURIComponent(q)).then((r) => { if (live) setRows(r.ok ? r.data.rows : []) }) }, 180)
          return () => { live = false; clearTimeout(t) }
        }, [q, open])
        if (props.value !== null) {
          return h('div', { className: 'kbpi-f' }, h('span', null, props.label),
            h('span', { className: 'kbpi-sel', 'data-kb': 'pipeline-link-chip', 'data-kind': props.kind }, h('span', null, props.value.label),
              h('button', { type: 'button', 'aria-label': kt('Retirer le lien', 'Remove the link'), 'data-act': 'clear-link', 'data-kind': props.kind, onClick: () => props.onChange(null) }, '×')))
        }
        return h('div', { className: 'kbpi-pick' },
          h('label', { className: 'kbpi-f' }, props.label,
            h('input', { type: 'search', value: q, placeholder: kt('Chercher…', 'Search…'), 'data-kb': 'pipeline-link-input', 'data-kind': props.kind, autoComplete: 'off', onFocus: () => setOpen(true), onChange: (e) => { setQ(e.target.value); setOpen(true) } })),
          open && rows !== null ? (rows.length === 0
            ? h('p', null, kt('Rien trouvé.', 'Nothing found.'))
            : h('ul', { className: 'kbpi-list', 'data-kb': 'pipeline-link-list' }, rows.map((r) => h('li', { key: r.id }, h('button', { type: 'button', 'data-act': 'pick-link', 'data-id': r.id, onClick: () => { props.onChange({ id: r.id, label: r.label }); setOpen(false) } }, r.label, r.sub ? h('small', null, r.sub) : null))))) : null)
      }

      // ── the dialog to add or edit a card ──────────────────────────────────────────────────────
      function CardDialog (props) {
        const { flow, card, stage, onClose, onSaved } = props
        const editing = card !== null
        const [title, setTitle] = useState(editing ? card.title : '')
        const [subtitle, setSubtitle] = useState(editing ? card.subtitle : '')
        const [value, setValue] = useState(editing && typeof card.value === 'number' ? String(card.value) : '')
        const [pickStage, setPickStage] = useState(editing ? card.stage : stage)
        const [contact, setContact] = useState(editing && card.contact !== null ? { id: card.contact.id, label: card.contact.name } : null)
        const [item, setItem] = useState(editing && card.item !== null ? { id: card.item.id, label: card.item.title } : null)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)
        const first = useRef(null)
        useEffect(() => { if (first.current) first.current.focus() }, [])
        useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [])
        const submit = (e) => {
          e.preventDefault()
          if (busy) return
          const trimmed = title.trim()
          if (trimmed === '') { setError(kt('Donne un titre à la carte.', 'Give the card a title.')); return }
          let num = null
          if (flow.value !== null && value.trim() !== '') {
            num = Number(value.replace(',', '.'))
            if (!Number.isFinite(num)) { setError(kt('La valeur doit être un nombre.', 'The value must be a number.')); return }
          }
          const body = { title: trimmed, subtitle: subtitle.trim() }
          if (flow.value !== null) body.value = num
          if (flow.links.contact) body.contact_id = contact === null ? null : contact.id
          if (flow.links.item) body.item_id = item === null ? null : item.id
          setBusy(true)
          api(editing ? 'update' : 'create', editing ? { id: card.id, ...body } : { flow: flow.id, stage: pickStage, ...body }).then((r) => {
            setBusy(false)
            if (!r.ok) { setError(errText(r.error, r.detail)); return }
            onSaved(editing ? 'edited' : 'created', r.data.card)
          })
        }
        const archive = () => {
          setBusy(true)
          api('archive', { id: card.id }).then((r) => { setBusy(false); if (!r.ok) setError(errText(r.error, r.detail)); else onSaved('archived', card) })
        }
        const heading = editing ? kt('Modifier la carte', 'Edit the card') : (pickLabel(flow.newLabel) || kt('Nouvelle carte', 'New card'))
        return h('div', { className: 'kbpi-modal', 'data-kb': 'pipeline-dialog', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
          h('form', { className: 'kbpi-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbpi-dlg-h', onSubmit: submit, onKeyDown: trapTab },
            h('h2', { id: 'kbpi-dlg-h' }, heading),
            h('label', { className: 'kbpi-f' }, kt('Titre', 'Title'), h('input', { ref: first, value: title, maxLength: 200, 'data-kb': 'pipeline-field', 'data-field': 'title', onChange: (e) => setTitle(e.target.value) })),
            h('label', { className: 'kbpi-f' }, kt('Précision (facultatif)', 'Detail (optional)'), h('input', { value: subtitle, maxLength: 200, 'data-kb': 'pipeline-field', 'data-field': 'subtitle', onChange: (e) => setSubtitle(e.target.value) })),
            h('div', { className: 'kbpi-row2' },
              flow.value !== null ? h('label', { className: 'kbpi-f' }, kt('Valeur', 'Value') + (flow.value.currency ? ' (' + flow.value.currency + ')' : ''), h('input', { value, inputMode: 'decimal', 'data-kb': 'pipeline-field', 'data-field': 'value', onChange: (e) => setValue(e.target.value) })) : null,
              !editing ? h('label', { className: 'kbpi-f' }, kt('Étape', 'Stage'), h('select', { value: pickStage, 'data-kb': 'pipeline-field', 'data-field': 'stage', onChange: (e) => setPickStage(e.target.value) }, flow.stages.map((s) => h('option', { key: s.key, value: s.key }, pickLabel(s.label))))) : null),
            flow.links.contact ? h(LinkPicker, { kind: 'contact', label: kt('Contact lié', 'Linked contact'), value: contact, onChange: setContact }) : null,
            flow.links.item ? h(LinkPicker, { kind: 'item', label: kt('Élément lié', 'Linked item'), value: item, onChange: setItem }) : null,
            error !== null ? h('div', { className: 'kbpi-err', role: 'alert', 'data-kb': 'pipeline-dialog-error' }, error) : null,
            h('div', { className: 'kbpi-acts' },
              editing ? h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'archive', disabled: busy, onClick: archive }, kt('Archiver', 'Archive')) : null,
              h('span', { className: 'sp' }),
              h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'cancel', onClick: onClose }, kt('Annuler', 'Cancel')),
              h('button', { type: 'submit', className: 'kb6-btn kb6-btn-primary kbpi-btn', 'data-act': 'save', disabled: busy }, editing ? kt('Enregistrer', 'Save') : kt('Ajouter', 'Add')))))
      }

      function ConfirmClear (props) {
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)
        useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [])
        const go = () => { setBusy(true); api('clear-demo', {}).then((r) => { setBusy(false); if (!r.ok) setError(errText(r.error, r.detail)); else props.onDone(r.data.removed) }) }
        return h('div', { className: 'kbpi-modal', 'data-kb': 'pipeline-dialog', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
          h('div', { className: 'kbpi-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbpi-clr-h', onKeyDown: trapTab },
            h('h2', { id: 'kbpi-clr-h' }, kt('Effacer les données d’exemple ?', 'Clear the sample data?')),
            h('p', null, kt('Les lignes marquées « démo » disparaissent de Contacts, Catalogue et Pipeline. Ce que tu as ajouté toi-même reste.', 'The rows marked “demo” disappear from Contacts, Catalog and Pipeline. What you added yourself stays.')),
            error !== null ? h('div', { className: 'kbpi-err', role: 'alert' }, error) : null,
            h('div', { className: 'kbpi-acts' }, h('span', { className: 'sp' }),
              h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'cancel', onClick: props.onClose }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kb6-btn kb6-btn-primary kbpi-btn', 'data-act': 'confirm-clear', disabled: busy, onClick: go }, kt('Effacer', 'Clear')))))
      }

      // ── the kit: read when drawing, never at load (the core applies after the plugins); every use has a plain fallback ──────────────────────
      const kit = () => { try { const k = window.__KB_BIZ_KIT__; return k !== undefined && k !== null && typeof k.Tag === 'function' && typeof k.Avatar === 'function' ? k : null } catch (e) { return null } }
      const KIcon = (name, size) => { const k = kit(); try { return k !== null && typeof k.Icon === 'function' ? k.Icon(name, size) : null } catch (e) { return null } }
      /** A coloured chip: the kit's (the colour follows the text), else a calm pill. */
      function Chip (p) { const k = kit(); return k !== null ? h(k.Tag, p) : h('span', { className: 'kbpi-pill calm dim', title: p.title }, p.text) }
      const Star = () => h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z' }))
      const Chevron = () => h('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'm6 9 6 6 6-6' }))
      const Loupe = () => h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' }))

      // ── the numbers of a column: they pop when they change, and the total counts to its new value ──────────────────────────────────────
      /** A chip that pops each time `v` changes (not when it first appears). Reduced motion: the kit's own rule stops the pop. */
      function Tick (props) {
        const prev = useRef(props.v)
        const [n, setN] = useState(0)
        useEffect(() => { if (prev.current !== props.v) { prev.current = props.v; setN((k) => k + 1) } }, [props.v])
        return h(React.Fragment, { key: n }, h('span', { className: props.className + (n > 0 ? ' kz-pop' : ''), 'data-kb': props.kb }, props.children))
      }
      function Money (props) {
        const [shown, setShown] = useState(props.value)
        const cur = useRef(props.value)
        useEffect(() => {
          const from = cur.current
          const to = props.value
          if (from === to) return undefined
          if (reduced() || typeof requestAnimationFrame !== 'function') { cur.current = to; setShown(to); return undefined }
          let raf = 0
          const t0 = performance.now()
          const step = (t) => {
            const k = Math.min(1, (t - t0) / 360)
            const v = from + (to - from) * (1 - Math.pow(1 - k, 3))
            const val = k >= 1 ? to : (Number.isInteger(from) && Number.isInteger(to) ? Math.round(v) : round2(v))
            cur.current = val
            setShown(val)
            if (k < 1) raf = requestAnimationFrame(step)
          }
          raf = requestAnimationFrame(step)
          return () => { cancelAnimationFrame(raf) }
        }, [props.value])
        return h(Tick, { v: props.value, className: 'kbpi-sum', kb: 'pipeline-col-total' }, fmtValue(shown, props.flow.value))
      }
      /** The ghost of a dragged card flies to `rect` (where the card lands, or where it came from), then goes. Reduced motion: it just goes. */
      const flyTo = (ghost, rect, done) => {
        if (ghost === null || ghost === undefined) { done(); return }
        if (reduced()) { ghost.remove(); done(); return }
        ghost.style.transition = 'left .2s cubic-bezier(.23,1,.32,1), top .2s cubic-bezier(.23,1,.32,1), width .2s cubic-bezier(.23,1,.32,1), transform .2s cubic-bezier(.23,1,.32,1)'
        ghost.style.left = rect.left + 'px'
        ghost.style.top = rect.top + 'px'
        ghost.style.width = rect.width + 'px'
        ghost.style.transform = 'rotate(0deg) scale(1)'
        setTimeout(() => { ghost.remove(); done() }, 215)
      }

      // ── the product's search and filter bar, or this one when the core does not hand it over (a test, an older core) ──────────────────────
      /** The pieces of the product's bar that matter here: a ghost magnifier that opens the search pill, the view switch with its names, then the primary action. */
      function PlainBar (props) {
        const [open, setOpen] = useState(false)
        const input = useRef(null)
        const shown = open || props.query.trim().length > 0
        useEffect(() => { if (open && input.current !== null) { try { input.current.focus() } catch (e) { /* the person clicks the field */ } } }, [open])
        const word = kt('Rechercher', 'Search')
        const names = { columns: kt('Colonnes', 'Columns'), list: kt('Liste', 'List'), calendar: kt('Calendrier', 'Calendar') }
        const clear = () => { if (props.query.length > 0) props.onQuery(''); setOpen(false) }
        return h('div', { className: 'kb6-toolbar', 'data-kb': 'pipeline-own-bar' },
          h('div', { className: 'kb6-tb-row' },
            h('div', { className: 'kb6-tb-tools' },
              shown ? null : h('button', { type: 'button', className: 'kb6-tb-ghost', 'data-kb': 'pipeline-search-toggle', title: word, 'aria-label': word, 'aria-expanded': 'false', onClick: () => setOpen(true) }, h(Loupe)),
              h('div', { className: 'kb6-search kb6-search-inline kb6-tb-search' + (shown ? '' : ' closed'), role: 'search' },
                h('input', { ref: input, type: 'search', 'data-kb': 'pipeline-search', value: props.query, placeholder: word, 'aria-label': word, onChange: (e) => props.onQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); clear() } } }),
                shown ? h('button', { type: 'button', className: 'kb6-tb-clear', 'aria-label': kt('Effacer la recherche', 'Clear the search'), onClick: clear }, '×') : null),
              h('div', { className: 'kb6-tb-viewgrp', role: 'group', 'aria-label': kt('Affichage', 'View') }, props.views.map((v) => h('button', { key: v, type: 'button', className: 'kb6-tb-vbtn lab' + (props.view === v ? ' on' : ''), 'data-kb': 'pipeline-view', 'data-view': v, 'aria-pressed': props.view === v ? 'true' : 'false', onClick: () => props.onView(v) }, h('span', { className: 'kb6-tb-vlab' }, names[v]))))),
            h('div', { className: 'kb6-tb-trailing' }, props.trailing)))
      }
      /** The same state as the core's `useToolbarState`, kept in memory, for a page that is not handed the product's bar. */
      const useOwnBar = (pageId, defaults) => {
        const [st, set] = useState({ query: '', sort: defaults.sort, dir: 'desc', types: [], period: 'all', fav: false, viewMode: defaults.viewMode })
        return [st, (patch) => set((prev) => ({ ...prev, ...patch }))]
      }

      // ── one card ──────────────────────────────────────────────────────────────────────────────
      /** The picture on the left of a card: the contact's avatar, else a tile (the item's drawing, or a plain mark). */
      function Lead (props) {
        const { card, cover } = props
        const k = kit()
        const size = props.size || 32
        if (card.contact !== null && card.contact !== undefined) {
          return h('span', { className: 'kbpi-lead', 'data-kb': 'pipeline-card-contact', title: card.contact.name, 'aria-hidden': 'true' },
            k !== null ? h(k.Avatar, { name: card.contact.name, size, kind: card.contact.kind === 'company' ? 'company' : 'person' }) : h('span', { className: 'kbpi-av', style: { width: size, height: size } }, initials(card.contact.name)))
        }
        const kind = !cover && card.item !== null && card.item !== undefined ? artKindOf(card.item.title + ' ' + (card.item.subtitle || '')) : ''
        const pic = !cover && card.item !== null && card.item !== undefined ? itemPicture(card.item, k, kind) : null
        return h('span', { className: 'kbpi-lead sq', style: { width: size, height: size }, 'aria-hidden': 'true' },
          pic !== null ? pic : (KIcon('layers', Math.round(size * 0.5)) || initials(card.title)))
      }
      /** The linked item as a chip with a small drawing of it (when its words say what it is). */
      function ItemChip (props) {
        const k = kit()
        const item = props.item
        const kind = artKindOf(item.title + ' ' + (item.subtitle || ''))
        return h('span', { className: 'kbpi-item', 'data-kb': 'pipeline-card-item', title: item.title, style: { '--kz-h': k !== null && typeof k.tint === 'function' ? k.tint(item.title) : 212 } },
          h('span', { className: 'pic', 'aria-hidden': 'true' }, itemPicture(item, k, kind) || KIcon('tag', 12)),
          h('span', { className: 't' }, item.title))
      }
      /** How a card's age reads: calm, warm after a week, hot after two, unless it is in the last stage (done is not stuck). */
      const ageTone = (days, last) => (last ? null : days >= 14 ? 8 : days >= 7 ? 38 : null)

      function Card (props) {
        const { card, flow, columns, dragging } = props
        const [enter] = useState(() => props.quiet !== true)
        const next = neighbour(columns, card.stage, 1)
        const nextLabel = next === null ? '' : pickLabel(columns.find((c) => c.stage === next).label) || next
        const x = extrasOf(card)
        const days = daysIn(card.since)
        const warm = ageTone(days, props.last === true)
        const left = x.due === '' ? null : dueIn(x.due)
        const hasValue = flow.value !== null && typeof card.value === 'number'
        const kind = props.cover === true && card.item !== null && card.item !== undefined ? artKindOf(card.item.title + ' ' + (card.item.subtitle || '')) : ''
        const art = COVER_KINDS.indexOf(kind) >= 0 ? kind : ''
        // a linked item with a picture of its own (a photograph the template ships, or a drawn spec) gets the cover whatever its words say
        const own = props.cover === true && card.item !== null && card.item !== undefined && typeof card.item.image === 'string' && card.item.image !== ''
        const k = kit()
        const stageName = pickLabel(columns.find((c) => c.stage === card.stage).label) || card.stage
        const label = card.title + (card.subtitle ? ', ' + card.subtitle : '') + (hasValue ? ', ' + fmtValue(card.value, flow.value) : '') + (card.demo ? ', ' + kt('exemple', 'sample') : '')
          + (props.pos > 0 ? ', ' + kt('étape ' + props.pos + ' sur ' + props.of + ' : ', 'stage ' + props.pos + ' of ' + props.of + ': ') + stageName : '')
          + (x.priority !== '' ? ', ' + kt('priorité ', 'priority ') + x.priority : '') + (left !== null ? ', ' + dueTitle(left) : '')
        const tagBits = []
        if (card.item !== null && card.item !== undefined) tagBits.push(h(ItemChip, { key: 'item', item: card.item }))
        if (left !== null) tagBits.push(h(Chip, { key: 'due', text: dueLabel(left, x.due), icon: 'clock', hue: left < 0 ? 8 : left <= 3 ? 24 : 212, title: dueTitle(left) }))
        if (x.source !== '') tagBits.push(h(Chip, { key: 'src', text: x.source, icon: 'tag', title: kt('Source', 'Source') }))
        x.tags.slice(0, 3).forEach((t) => tagBits.push(h(Chip, { key: 'tag-' + t, text: t })))
        if (x.tags.length > 3) tagBits.push(h('span', { key: 'more', className: 'kbpi-pill calm dim', title: x.tags.slice(3).join(', ') }, '+' + (x.tags.length - 3)))
        if (card.demo) tagBits.push(h('span', { key: 'demo', className: 'kbpi-demo', 'data-kb': 'pipeline-demo' }, kt('démo', 'demo')))
        return h('li', { className: 'kbpi-cardli' + (enter ? ' kz-in' : ''), style: { listStyle: 'none', '--kz-i': props.i } },
          h('article', {
            className: 'kbpi-card kz-lift' + (dragging ? ' drag' : '') + (props.hold ? ' hold' : '') + (props.settle ? ' settle' : ''), style: { '--kz-h': props.hue }, tabIndex: 0, 'data-kb': 'pipeline-card', 'data-id': card.id, 'data-stage': card.stage, 'data-demo': card.demo ? '1' : '0',
            'aria-label': label, 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter',
            onPointerDown: (e) => props.onPointerDown(e, card),
            onClick: () => props.onOpen(card),
            onKeyDown: (e) => props.onKeyDown(e, card),
          },
          (art !== '' || own) && itemPicture(card.item, k, art) !== null ? h('div', { className: 'kbpi-cover kz-img', 'data-kb': 'pipeline-cover', 'aria-hidden': 'true' }, itemPicture(card.item, k, art)) : null,
          h('div', { className: 'kbpi-ctop' },
            h('span', { className: 'kbpi-leadwrap' }, h(Lead, { card, cover: art !== '' || own }),
              x.priority !== '' ? h('span', { className: 'kbpi-prio', 'data-kb': 'pipeline-priority', 'data-priority': x.priority, style: { '--kz-h': PRIORITY_HUE[x.priority] }, title: kt('Priorité ', 'Priority ') + x.priority, 'aria-hidden': 'true' }) : null),
            h('div', { className: 'kbpi-ctext' }, h('b', null, card.title), card.subtitle ? h('span', { className: 'kbpi-sub' }, card.subtitle) : null),
            h('button', { type: 'button', className: 'kbpi-star' + (props.fav ? ' on' : ''), 'data-act': 'toggle-fav', 'aria-pressed': props.fav ? 'true' : 'false', 'aria-label': props.fav ? kt('Retirer des favoris', 'Remove from favourites') : kt('Mettre en favori', 'Add to favourites'), title: props.fav ? kt('Retirer des favoris', 'Remove from favourites') : kt('Mettre en favori', 'Add to favourites'),
              onClick: (e) => { e.stopPropagation(); props.onFav(card) }, onPointerDown: (e) => e.stopPropagation(), onKeyDown: (e) => e.stopPropagation() }, h(Star))),
          tagBits.length > 0 ? h('div', { className: 'kbpi-tags' }, tagBits) : null,
          h('div', { className: 'kbpi-foot' },
            hasValue ? h('span', { className: 'kbpi-pill', 'data-kb': 'pipeline-value', style: { '--kz-h': props.hue } }, fmtValue(card.value, flow.value)) : null,
            h('span', { className: 'kbpi-pill dim' + (warm === null ? ' calm' : ''), 'data-kb': 'pipeline-age', style: warm === null ? undefined : { '--kz-h': warm }, title: warm === null ? undefined : kt('Dans cette étape depuis ' + days + ' jour(s)', 'In this stage for ' + days + ' day(s)') }, ageOf(card.since)),
            h('span', { className: 'sp' }),
            h('button', { type: 'button', className: 'kbpi-go', hidden: next === null, 'data-act': 'next-stage', 'aria-label': next === null ? undefined : kt('Déplacer vers « ', 'Move to “') + nextLabel + kt(' »', '”'), title: nextLabel,
              onClick: (e) => { e.stopPropagation(); props.onMove(card, next, 'button') }, onPointerDown: (e) => e.stopPropagation(), onKeyDown: (e) => e.stopPropagation() }, h(Arrow))),
          props.pos > 0 ? h('span', { className: 'kbpi-bar', 'aria-hidden': 'true', title: kt('Étape ' + props.pos + ' sur ' + props.of, 'Stage ' + props.pos + ' of ' + props.of) }, h('i', { style: { '--p': Math.round((props.pos / props.of) * 100) + '%' } })) : null))
      }

      // ── the three views ───────────────────────────────────────────────────────────────────────────
      function Board (props) {
        const { cols, flow, hues, newLabel } = props
        return h('div', { className: 'kbpi-board' + (props.dragging ? ' dragging' : '') + (props.stale ? ' stale' : ''), 'data-kb': 'pipeline-board', role: 'group', 'aria-label': props.title, 'aria-describedby': 'kbpi-sub', 'aria-busy': props.stale ? 'true' : undefined },
          cols.map((col, ci) => {
            const hue = hues.get(col.stage) || UNKNOWN_HUE
            return h('div', { key: col.stage, className: 'kbpi-col kz-in' + (col.unknown ? ' unknown' : ''), style: { '--kz-h': hue, '--kz-i': ci }, role: 'group', 'data-kb': 'pipeline-col', 'data-stage': col.stage, 'data-count': col.count, 'data-total': col.total, 'aria-label': pickLabel(col.label) + ', ' + col.count },
              h('div', { className: 'kbpi-colh' },
                h('i', { className: 'dot', 'aria-hidden': 'true' }), h('b', { title: pickLabel(col.label) }, pickLabel(col.label)),
                h(Tick, { v: col.count, className: 'kbpi-cnt', kb: 'pipeline-col-count' }, col.count),
                col.unknown ? null : h('button', { type: 'button', className: 'kbpi-add kz-press', 'data-act': 'add-in-stage', 'data-stage': col.stage, title: newLabel, 'aria-label': newLabel + kt(' dans « ', ' in “') + pickLabel(col.label) + kt(' »', '”'), onClick: () => props.onAdd(col.stage) }, h(Plus))),
              flow.value !== null ? h('div', { className: 'kbpi-colsum' }, col.total !== 0 ? h(Money, { value: col.total, flow }) : null) : null,
              h('ul', { className: 'kbpi-cards' },
                col.cards.length === 0 ? h('li', { style: { listStyle: 'none' } }, h('div', { className: 'kbpi-drop' }, kt('Dépose une carte ici', 'Drop a card here'))) : null,
                col.cards.map((card, i) => h(Card, {
                  key: card.id, card, flow, columns: cols, hue, i: Math.min(14, ci * 2 + i + 1), pos: props.pos.get(col.stage) || 0, of: props.of, last: props.lastStage === col.stage, cover: props.cover,
                  dragging: props.dragId === card.id, hold: props.landingId === card.id, settle: props.settleId === card.id, quiet: props.quietId === card.id, fav: props.favs.has(card.id),
                  onPointerDown: props.onPointerDown, onKeyDown: props.onKeyDown, onMove: props.onMove, onFav: props.onFav, onOpen: props.onOpen }))))
          }))
      }

      function Rows (props) {
        const { rows, flow, columns, hues } = props
        const extras = rows.some((c) => { const x = extrasOf(c); return x.source !== '' || x.tags.length > 0 || x.due !== '' || x.priority !== '' || (c.item !== null && c.item !== undefined) })
        return h('div', { className: 'kbpi-tblwrap kz-in', 'data-kb': 'pipeline-list' },
          h('table', { className: 'kbpi-tbl' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', className: 'main' }, kt('Carte', 'Card')), h('th', { scope: 'col' }, kt('Étape', 'Stage')), extras ? h('th', { scope: 'col' }, kt('Détails', 'Details')) : null,
              flow.value !== null ? h('th', { scope: 'col', className: 'num' }, kt('Valeur', 'Value')) : null, h('th', { scope: 'col' }, kt('Dans l’étape', 'In stage')), h('th', { scope: 'col' }, h('span', { className: 'kbpi-live' }, kt('Actions', 'Actions'))))),
            h('tbody', null, rows.map((card, i) => {
              const x = extrasOf(card)
              const days = daysIn(card.since)
              const col = columns.find((c) => c.stage === card.stage)
              const hue = hues.get(card.stage) || UNKNOWN_HUE
              const warm = ageTone(days, props.lastStage === card.stage)
              const left = x.due === '' ? null : dueIn(x.due)
              const next = neighbour(columns, card.stage, 1)
              const nextLabel = next === null ? '' : pickLabel(columns.find((c) => c.stage === next).label) || next
              const fav = props.favs.has(card.id)
              return h('tr', { key: card.id, className: 'kbpi-row' + (i < 14 ? ' kz-in' : ''), style: { '--kz-i': Math.min(i, 14), '--kz-h': hue }, tabIndex: 0, 'data-kb': 'pipeline-row', 'data-id': card.id, 'data-stage': card.stage, 'data-demo': card.demo ? '1' : '0',
                'aria-label': card.title + (card.subtitle ? ', ' + card.subtitle : '') + ', ' + (col ? pickLabel(col.label) : card.stage), 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter',
                onClick: () => props.onOpen(card), onKeyDown: (e) => props.onKeyDown(e, card) },
              h('td', { className: 'main' }, h('div', { className: 'who' }, h(Lead, { card, cover: false, size: 30 }),
                h('span', { className: 'tx' }, h('b', null, card.title, card.demo ? ' ' : null, card.demo ? h('span', { className: 'kbpi-demo', 'data-kb': 'pipeline-demo' }, kt('démo', 'demo')) : null), card.subtitle ? h('span', { className: 'kbpi-sub' }, card.subtitle) : null))),
              h('td', null, h('label', { className: 'kbpi-stagepill', style: { '--kz-h': hue }, onClick: (e) => e.stopPropagation() }, h('i', { 'aria-hidden': 'true' }), h('span', null, col ? pickLabel(col.label) : card.stage), h(Chevron),
                h('select', { value: card.stage, 'data-kb': 'pipeline-stage-select', 'aria-label': kt('Étape de « ', 'Stage of “') + card.title + kt(' »', '”'), onKeyDown: (e) => e.stopPropagation(), onChange: (e) => props.onMove(card, e.target.value, 'select') }, columns.filter((c) => !c.unknown || c.stage === card.stage).map((c) => h('option', { key: c.stage, value: c.stage }, pickLabel(c.label) || c.stage))))),
              extras ? h('td', null, h('div', { className: 'kbpi-tags' },
                x.priority !== '' ? h(Chip, { text: x.priority === 'high' ? kt('Haute', 'High') : x.priority === 'low' ? kt('Basse', 'Low') : kt('Normale', 'Normal'), hue: PRIORITY_HUE[x.priority], dot: true, title: kt('Priorité', 'Priority') }) : null,
                left !== null ? h(Chip, { text: dueLabel(left, x.due), icon: 'clock', hue: left < 0 ? 8 : left <= 3 ? 24 : 212, title: dueTitle(left) }) : null,
                x.source !== '' ? h(Chip, { text: x.source, icon: 'tag' }) : null,
                x.tags.slice(0, 3).map((t) => h(Chip, { key: t, text: t })),
                card.item !== null && card.item !== undefined ? h(ItemChip, { item: card.item }) : null)) : null,
              flow.value !== null ? h('td', { className: 'num' }, typeof card.value === 'number' ? h('span', { className: 'kbpi-pill', 'data-kb': 'pipeline-value', style: { '--kz-h': hue } }, fmtValue(card.value, flow.value)) : null) : null,
              h('td', null, h('span', { className: 'kbpi-pill dim' + (warm === null ? ' calm' : ''), 'data-kb': 'pipeline-age', style: warm === null ? undefined : { '--kz-h': warm } }, ageOf(card.since))),
              h('td', null, h('span', { className: 'kbpi-cell' },
                h('button', { type: 'button', className: 'kbpi-star' + (fav ? ' on' : ''), 'data-act': 'toggle-fav', 'aria-pressed': fav ? 'true' : 'false', 'aria-label': fav ? kt('Retirer des favoris', 'Remove from favourites') : kt('Mettre en favori', 'Add to favourites'), onClick: (e) => { e.stopPropagation(); props.onFav(card) }, onKeyDown: (e) => e.stopPropagation() }, h(Star)),
                h('button', { type: 'button', className: 'kbpi-go kz-press', hidden: next === null, 'data-act': 'next-stage', 'aria-label': kt('Déplacer vers « ', 'Move to “') + nextLabel + kt(' »', '”'), title: nextLabel, onClick: (e) => { e.stopPropagation(); props.onMove(card, next, 'button') }, onKeyDown: (e) => e.stopPropagation() }, h(Arrow)))))
            }))))
      }

      /** A month of due dates: each card is a chip on its day; the cards with no date are counted below. */
      function Calendar (props) {
        const { cards, hues } = props
        const locale = lang() === 'fr' ? 'fr-FR' : undefined
        const today = dayStart()
        const dated = cards.filter((c) => extrasOf(c).due !== '')
        const base = props.month !== null ? props.month : (() => {
          const ahead = dated.map((c) => parseDue(extrasOf(c).due)).filter((d) => d.getTime() >= today.getTime()).sort((a, b) => a - b)[0]
          const at = ahead !== undefined ? ahead : today
          return { y: at.getFullYear(), m: at.getMonth() }
        })()
        const first = new Date(base.y, base.m, 1)
        const start = new Date(base.y, base.m, 1 - ((first.getDay() + 6) % 7))
        const rows = Math.ceil((((first.getDay() + 6) % 7) + new Date(base.y, base.m + 1, 0).getDate()) / 7)
        const byDay = new Map()
        for (const c of dated) { const d = extrasOf(c).due; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(c) }
        const fmt = (opts, d) => { try { return new Intl.DateTimeFormat(locale, opts).format(d) } catch (e) { return '' } }
        const pad = (n) => (n < 10 ? '0' + n : String(n))
        const go = (delta) => { const d = new Date(base.y, base.m + delta, 1); props.onMonth({ y: d.getFullYear(), m: d.getMonth() }) }
        const cells = []
        for (let i = 0; i < rows * 7; i += 1) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
          const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
          const list = byDay.get(key) || []
          cells.push(h('div', { key, className: 'kbpi-day' + (d.getMonth() !== base.m ? ' out' : '') + (d.getTime() === today.getTime() ? ' today' : ''), 'data-kb': 'pipeline-day', 'data-day': key },
            h('span', { className: 'n' }, d.getDate()),
            list.slice(0, 3).map((c) => h('button', { key: c.id, type: 'button', className: 'kbpi-cal-chip', 'data-kb': 'pipeline-cal-card', 'data-id': c.id, style: { '--kz-h': hues.get(c.stage) || UNKNOWN_HUE }, title: c.title, onClick: () => props.onOpen(c) }, h('i', { 'aria-hidden': 'true' }), h('span', null, c.title))),
            list.length > 3 ? h('span', { className: 'kbpi-more' }, '+' + (list.length - 3)) : null))
        }
        const undated = cards.length - dated.length
        return h('div', { className: 'kz-in', 'data-kb': 'pipeline-calendar', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'kbpi-calnav' },
            h('button', { type: 'button', 'data-act': 'cal-prev', 'aria-label': kt('Mois précédent', 'Previous month'), onClick: () => go(-1) }, rtl() ? '›' : '‹'),
            h('h2', { 'aria-live': 'polite' }, fmt({ month: 'long', year: 'numeric' }, first)),
            h('button', { type: 'button', 'data-act': 'cal-next', 'aria-label': kt('Mois suivant', 'Next month'), onClick: () => go(1) }, rtl() ? '‹' : '›'),
            h('button', { type: 'button', 'data-act': 'cal-today', onClick: () => props.onMonth({ y: today.getFullYear(), m: today.getMonth() }) }, kt('Aujourd’hui', 'Today'))),
          h('div', { className: 'kbpi-cal', role: 'group', 'aria-label': fmt({ month: 'long', year: 'numeric' }, first) },
            [0, 1, 2, 3, 4, 5, 6].map((i) => h('div', { key: 'wd' + i, className: 'wd' }, fmt({ weekday: 'short' }, new Date(2024, 0, 1 + i)))), cells),
          undated > 0 ? h('p', { className: 'kbpi-hint', 'data-kb': 'pipeline-undated' }, kt(undated + ' carte(s) sans date d’échéance ne figurent pas ici.', undated + ' card(s) with no due date are not on this calendar.')) : null)
      }

      // ── the page ──────────────────────────────────────────────────────────────────────────────
      const BAR_DEFAULTS = { sort: 'position', viewMode: 'columns' }
      function PipelinePage (props) {
        // The product's own bar and its state hook come from the core (`props.toolbar`); without them (a test, an older core) this page draws a plain bar of its own.
        const toolbar = props !== null && props !== undefined && props.toolbar !== null && props.toolbar !== undefined && typeof props.toolbar === 'object' ? props.toolbar : null
        const KbBar = toolbar !== null && typeof toolbar.KbToolbar === 'function' ? toolbar.KbToolbar : null
        const useBar = toolbar !== null && typeof toolbar.useToolbarState === 'function' ? toolbar.useToolbarState : useOwnBar
        const [flows, setFlows] = useState(null)
        const [flowId, setFlowId] = useState(() => rememberedFlow())
        const [board, setBoard] = useState(null)
        const [fail, setFail] = useState(null)
        const [dialog, setDialog] = useState(null)
        const [live, setLive] = useState('')
        const [toast, setToast] = useState(null)
        const [archived, setArchived] = useState(false)
        const [dragId, setDragId] = useState(null)
        let bar
        try { bar = useBar('pipeline', BAR_DEFAULTS) } catch (e) { bar = useOwnBar('pipeline', BAR_DEFAULTS) }
        const tb = bar[0]
        const setTb = bar[1]
        const [favs, setFavs] = useState(() => readFavs())
        const [landingId, setLandingId] = useState(null)
        const [settleId, setSettleId] = useState(null)
        const [month, setMonth] = useState(null)
        const seq = useRef(0)
        const rootRef = useRef(null)
        const boardRef = useRef(null)
        boardRef.current = board
        const focusAfter = useRef(null)
        const suppressClick = useRef(false)
        const busyWrites = useRef(0)
        const dragging = useRef(false)
        const landing = useRef(null)
        const quiet = useRef(null)
        const visRef = useRef({ view: 'columns', columns: [], rows: [] })
        const flowRef = useRef(flowId)
        flowRef.current = flowId
        const archivedRef = useRef(archived)
        archivedRef.current = archived
        const dialogRef = useRef(dialog)
        dialogRef.current = dialog

        const say = (text) => { setLive(''); setTimeout(() => setLive(text), 30) }
        const tell = (text, tone) => { setToast({ text, tone: tone || 'ok' }); setTimeout(() => setToast((t) => (t !== null && t.text === text ? null : t)), 4500) }

        /** Reads the boards, then the board shown; the answer of an older question is dropped. */
        const loadBoard = useCallback((id, withArchived) => {
          const mine = seq.current + 1
          seq.current = mine
          return api('board?flow=' + encodeURIComponent(id) + (withArchived ? '&archived=1' : '')).then((r) => {
            if (mine !== seq.current) return
            if (r.ok) { setBoard(r.data); setFail(null) } else { setFail(r.error); setBoard((b) => (r.error === 'unknown_flow' || b === null || b.flow.id !== id ? null : b)) }
          })
        }, [])
        const loadAll = useCallback(() => api('flows').then((r) => {
          if (!r.ok) { setFail(r.error); return null }
          setFlows(r.data)
          const wanted = flowRef.current
          // nothing remembered: open the first board that holds cards (a template's own boards come after the empty default one)
          const pick = r.data.flows.some((f) => f.id === wanted) ? wanted : (r.data.flows.find((f) => f.cards > 0) || r.data.flows[0]).id
          if (pick !== wanted) { flowRef.current = pick; setFlowId(pick) }
          return loadBoard(pick, archivedRef.current)
        }), [])
        useEffect(() => { loadAll() }, [])
        // The agent moves cards from the host: look again now and then, and when the page comes back to the front. Never mid-drag, mid-dialog or mid-write.
        useEffect(() => {
          const again = () => { if (document.hidden || dragging.current || landing.current !== null || dialogRef.current !== null || busyWrites.current > 0 || flowRef.current === null) return; loadBoard(flowRef.current, archivedRef.current) }
          const timer = setInterval(again, 15000)
          document.addEventListener('visibilitychange', again)
          return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again) }
        }, [])
        useEffect(() => () => { try { document.querySelectorAll('.kbpi-ghost').forEach((g) => g.remove()); document.body.style.cursor = '' } catch (e) { /* page already gone */ } }, [])
        // A keyboard move re-creates the card in its new column: give it the focus back.
        useEffect(() => {
          if (focusAfter.current === null || rootRef.current === null) return
          const el = rootRef.current.querySelector('[data-kb="pipeline-card"][data-id="' + focusAfter.current + '"], [data-kb="pipeline-row"][data-id="' + focusAfter.current + '"]')
          if (el) { focusAfter.current = null; try { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch (e) { /* no focus here */ } }
        })
        // A card dropped on a column: the ghost that followed the pointer flies to the card's new place, then the card settles.
        useEffect(() => {
          const l = landing.current
          if (l === null || rootRef.current === null) return
          const el = rootRef.current.querySelector('[data-kb="pipeline-card"][data-id="' + l.id + '"]')
          const colEl = el !== null && el.closest ? el.closest('[data-kb="pipeline-col"]') : null
          if (colEl === null || colEl.getAttribute('data-stage') !== l.stage) return
          landing.current = null
          flyTo(l.ghost, el.getBoundingClientRect(), () => { setLandingId(null); setSettleId(l.id); setTimeout(() => setSettleId((s) => (s === l.id ? null : s)), 420) })
        })
        useEffect(() => { quiet.current = null })

        const flow = board !== null ? board.flow : null
        const chosen = (flows !== null ? flows.flows.find((f) => f.id === flowId) || null : null) || flow
        const stale = board !== null && flowId !== null && board.flow.id !== flowId

        // ── what the toolbar asks for ──
        const views = viewsOf(board)
        const view = views.indexOf(tb.viewMode) >= 0 ? tb.viewMode : 'columns'
        const shownBoard = board !== null ? visibleColumns(board, tb, favs, Date.now()) : { columns: [], shown: 0, all: 0 }
        const rowsList = (() => { const flat = shownBoard.columns.flatMap((c) => c.cards); return SORTS.indexOf(tb.sort) > 0 ? sortCards(flat, tb.sort, tb.dir === 'asc' ? 'asc' : 'desc') : flat })()
        visRef.current = { view, columns: shownBoard.columns, rows: rowsList }
        const known = board !== null ? board.columns.filter((c) => !c.unknown) : []
        const hues = new Map(known.map((c, i) => [c.stage, stageHue(i, known.length)]))
        const positions = new Map(known.map((c, i) => [c.stage, i + 1]))
        const lastStage = known.length > 0 ? known[known.length - 1].stage : null
        const options = board !== null ? facetOptions(board) : []
        const onBar = (patch) => {
          let p = patch
          if (p !== null && typeof p === 'object' && typeof p.viewMode === 'string' && views.indexOf(p.viewMode) < 0) { p = { ...p }; delete p.viewMode }
          if (p !== null && typeof p === 'object' && Object.keys(p).length > 0) setTb(p)
        }
        // A filter that names something this board does not have (a stage of another board, a tag nobody carries any more) is dropped, so it never hides cards unseen.
        useEffect(() => {
          if (board === null || stale || !Array.isArray(tb.types) || tb.types.length === 0) return
          const valid = new Set(options.map((o) => o.id))
          const kept = tb.types.filter((t) => valid.has(t))
          if (kept.length !== tb.types.length) setTb({ types: kept })
        }, [board, tb.types])
        const clearFilters = () => setTb({ query: '', types: [], period: 'all', fav: false })

        const moveCard = (card, stage, how) => {
          const now = boardRef.current
          if (now === null || stage === null || stage === card.stage || now.flow.id !== flowRef.current) return
          const col = now.columns.find((c) => c.stage === stage)
          if (col === undefined) return
          const optimistic = moveInBoard(now, card.id, stage, new Date().toISOString())
          const after = optimistic.columns.find((c) => c.stage === stage)
          quiet.current = card.id
          setBoard(optimistic)
          if (how === 'button') { setSettleId(card.id); setTimeout(() => setSettleId((s) => (s === card.id ? null : s)), 420) }
          if (how === 'key') focusAfter.current = card.id
          say(kt(card.title + ' déplacée vers ' + pickLabel(col.label) + '. ' + after.count + ' carte(s) dans cette colonne' + (now.flow.value !== null ? ', ' + fmtValue(after.total, now.flow.value) : '') + '.',
            card.title + ' moved to ' + pickLabel(col.label) + '. ' + after.count + ' card(s) in that column' + (now.flow.value !== null ? ', ' + fmtValue(after.total, now.flow.value) : '') + '.'))
          busyWrites.current += 1
          api('move', { id: card.id, stage }).then((r) => {
            busyWrites.current -= 1
            if (!r.ok) { tell(errText(r.error, r.detail), 'bad'); say(errText(r.error, r.detail)) }
            return loadBoard(flowRef.current, archivedRef.current)
          })
        }
        const toggleFav = (card) => {
          setFavs((prev) => { const next = new Set(prev); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); writeFavs(next); return next })
        }

        const onKeyDown = (e, card) => {
          if (e.target !== e.currentTarget || boardRef.current === null || boardRef.current.flow.id !== flowRef.current) return
          const vis = visRef.current
          const cols = vis.columns
          const flip = rtl() ? -1 : 1
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const to = neighbour(cols, card.stage, (e.key === 'ArrowRight' ? 1 : -1) * flip)
            if (to === null) say(kt('Déjà dans la dernière colonne dans cette direction.', 'Already in the last column in that direction.'))
            else moveCard(card, to, 'key')
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const ring = vis.view === 'list' ? vis.rows : (cols.find((c) => c.stage === card.stage) || { cards: [] }).cards
            const at = ring.findIndex((x) => x.id === card.id)
            const other = ring[at + (e.key === 'ArrowDown' ? 1 : -1)]
            if (other) { const el = rootRef.current.querySelector('[data-kb="pipeline-card"][data-id="' + other.id + '"], [data-kb="pipeline-row"][data-id="' + other.id + '"]'); if (el) el.focus() }
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setDialog({ kind: 'edit', card })
          }
        }

        /** A real drag with the pointer: a ghost (lifted, tilting with the hand) follows it, the column under it lights up with a slot where the card will go, the ghost flies to the
         *  card's new place when it is dropped and flies back when it is not. The card goes to the end of the column it is dropped on. */
        const onPointerDown = (e, card) => {
          if (e.button !== 0 || (e.target.closest && e.target.closest('button, input, select, a'))) return
          if (boardRef.current === null || boardRef.current.flow.id !== flowRef.current) return
          const sx = e.clientX
          const sy = e.clientY
          const src = e.currentTarget
          let ghost = null
          let over = null
          let started = false
          let lastX = sx
          let tilt = 0
          let rest = null
          const colAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('[data-kb="pipeline-col"]') : null }
          const light = (col) => {
            const target = col !== null && col.getAttribute('data-stage') === card.stage ? null : col // the column it came from is not a place to drop it
            if (over === target) return
            if (over) over.classList.remove('over')
            over = target
            if (over) over.classList.add('over')
          }
          const cleanup = () => {
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('pointercancel', onCancel, true)
            window.removeEventListener('keydown', onKey, true)
            if (rest !== null) clearTimeout(rest)
            if (over) over.classList.remove('over')
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            if (started) { dragging.current = false; suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
          }
          const back = () => { // not dropped anywhere: the ghost flies back to the card
            cleanup()
            if (!started) return
            flyTo(ghost, src.getBoundingClientRect(), () => setDragId(null))
          }
          const onMove = (ev) => {
            if (!started) {
              if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return
              started = true
              dragging.current = true
              setDragId(card.id)
              document.body.style.userSelect = 'none'
              document.body.style.cursor = 'grabbing'
              const box = src.getBoundingClientRect()
              ghost = src.cloneNode(true)
              ghost.classList.add('kbpi-ghost')
              ghost.classList.remove('drag', 'kz-lift', 'hold', 'settle')
              ghost.removeAttribute('data-kb')
              ghost.removeAttribute('tabindex')
              ghost.style.width = box.width + 'px'
              ghost.style.left = box.left + 'px'
              ghost.style.top = box.top + 'px'
              ghost.dataset.offX = String(sx - box.left)
              ghost.dataset.offY = String(sy - box.top)
              document.body.appendChild(ghost)
              void ghost.offsetWidth // the lift below is a transition from the card's own place
              ghost.style.transform = 'rotate(0deg) scale(1.03)'
            }
            const dx = ev.clientX - lastX
            lastX = ev.clientX
            tilt = Math.max(-5, Math.min(5, tilt * 0.6 + dx * 0.5))
            ghost.style.left = (ev.clientX - Number(ghost.dataset.offX)) + 'px'
            ghost.style.top = (ev.clientY - Number(ghost.dataset.offY)) + 'px'
            ghost.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg) scale(1.03)'
            if (rest !== null) clearTimeout(rest)
            rest = setTimeout(() => { if (ghost) ghost.style.transform = 'rotate(0deg) scale(1.03)' }, 90)
            light(colAt(ev.clientX, ev.clientY))
            const scroller = boardRef.current && rootRef.current ? rootRef.current.querySelector('[data-kb="pipeline-board"]') : null
            if (scroller) {
              const r = scroller.getBoundingClientRect()
              if (ev.clientX < r.left + 40) scroller.scrollLeft -= 14
              else if (ev.clientX > r.right - 40) scroller.scrollLeft += 14
            }
          }
          const onUp = (ev) => {
            const col = started ? colAt(ev.clientX, ev.clientY) : null
            const stage = col ? col.getAttribute('data-stage') : null
            const was = started
            if (was && stage !== null && stage !== card.stage) {
              cleanup()
              const mine = ghost
              landing.current = { id: card.id, stage, ghost: mine }
              setLandingId(card.id)
              setDragId(null)
              moveCard(card, stage, 'drag')
              setTimeout(() => { if (landing.current !== null && landing.current.ghost === mine) { landing.current = null; mine.remove(); setLandingId(null) } }, 1500) // the card never came: do not leave the ghost
            } else if (was) back()
            else cleanup()
          }
          const onCancel = () => back()
          const onKey = (ev) => { if (ev.key === 'Escape') back() }
          window.addEventListener('pointermove', onMove, true)
          window.addEventListener('pointerup', onUp, true)
          window.addEventListener('pointercancel', onCancel, true)
          window.addEventListener('keydown', onKey, true)
        }

        const chooseFlow = (id) => {
          if (id === flowId) return
          rememberFlow(id)
          flowRef.current = id
          setFlowId(id)
          setTb({ types: [] }) // the stages and tags of one board mean nothing on another
          loadBoard(id, archived) // the board on screen stays, dimmed, until the next one comes: no flash of empty skeletons
        }
        const toggleArchived = () => { const on = !archived; archivedRef.current = on; setArchived(on); if (flowId !== null) loadBoard(flowId, on) }
        const saved = (what, card) => {
          focusAfter.current = what === 'archived' ? null : card.id
          setDialog(null)
          tell(what === 'created' ? kt('Carte ajoutée.', 'Card added.') : what === 'edited' ? kt('Carte enregistrée.', 'Card saved.') : kt('Carte archivée.', 'Card archived.'))
          loadAll()
        }
        const restore = (card) => api('restore', { id: card.id }).then((r) => { if (!r.ok) tell(errText(r.error, r.detail), 'bad'); else tell(kt('Carte restaurée.', 'Card restored.')); loadAll() })
        const openCard = (c) => { if (!suppressClick.current) setDialog({ kind: 'edit', card: c }) }

        // ── drawing ──
        const title = chosen !== null ? pickLabel(chosen.label) : kt('Pipeline', 'Pipeline')
        const demoCount = flows !== null ? flows.demo : 0
        const newLabel = chosen !== null ? (pickLabel(chosen.newLabel) || kt('Nouvelle carte', 'New card')) : kt('Nouvelle carte', 'New card')
        const addButton = h('button', { type: 'button', className: 'kb8-primary kbpi-primary kz-press', 'data-act': 'new-card', disabled: flow === null || stale, onClick: () => setDialog({ kind: 'new', stage: flow.stages[0].key }) }, h(Plus), newLabel)
        const barState = { query: typeof tb.query === 'string' ? tb.query : '', sort: SORTS.indexOf(tb.sort) >= 0 ? tb.sort : 'position', dir: tb.dir === 'asc' ? 'asc' : 'desc', types: Array.isArray(tb.types) ? tb.types : [], period: tb.period === '7' || tb.period === '30' ? tb.period : 'all', fav: tb.fav === true, viewMode: view }
        const sortOptions = [{ id: 'position', label: kt('Ordre du tableau', 'Board order') }, { id: 'since', label: kt('Dernier déplacement', 'Last moved') }]
          .concat(flow !== null && flow.value !== null ? [{ id: 'value', label: kt('Valeur', 'Value') }] : []).concat([{ id: 'name', label: kt('Nom', 'Name') }])
        const header = h('header', { className: 'kb6-headrow' },
          h('div', { className: 'kb6-headcol' },
            h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title', 'data-kb': 'pipeline-title' }, title), h(Help)),
            h('p', { className: 'kb8-sub', id: 'kbpi-sub' }, kt('Fais avancer chaque carte d’une étape à l’autre : glisse-la, ou donne-lui le focus et utilise les flèches gauche et droite ; Entrée pour la modifier.', 'Move each card from one stage to the next: drag it, or focus it and use the left and right arrows; Enter edits it.'))),
          KbBar !== null
            ? h(KbBar, { state: barState, onUpdate: onBar, searchPlaceholder: kt('Rechercher une carte', 'Search cards'), sortOptions, facets: { type: { options }, period: true }, views, viewLabels: true, total: shownBoard.all, shown: shownBoard.shown, trailing: addButton })
            : h(PlainBar, { query: barState.query, onQuery: (q) => setTb({ query: q }), views, view, onView: (v) => setTb({ viewMode: v }), trailing: addButton }))

        const tabs = flows !== null && flows.flows.length > 1
          ? h('div', { className: 'kbpi-tabs', role: 'tablist', 'aria-label': kt('Tableaux', 'Boards') }, flows.flows.map((f) => h('button', { key: f.id, type: 'button', role: 'tab', className: 'kbpi-tab kz-press', 'aria-selected': f.id === flowId, 'data-kb': 'pipeline-tab', 'data-flow': f.id, onClick: () => chooseFlow(f.id) }, pickLabel(f.label), h('i', null, f.cards))))
          : null
        const currency = chosen !== null && chosen.value !== null && typeof chosen.value.currency === 'string' ? chosen.value.currency : null
        const active = filtersOn(tb)
        const tools = h('div', { className: 'kbpi-tools' }, tabs,
          active && board !== null ? h('span', { className: 'kbpi-strip', 'data-kb': 'pipeline-filter-strip', role: 'status' }, kt('Affichage de ', 'Showing '), h('b', null, shownBoard.shown), ' / ' + shownBoard.all + kt(' carte(s)', ' card(s)'),
            h('button', { type: 'button', className: 'kbpi-link', 'data-act': 'clear-filters', onClick: clearFilters }, kt('Tout afficher', 'Clear filters'))) : null,
          h('span', { className: 'sp' }),
          currency !== null ? h('p', { className: 'kbpi-hint' }, kt('Totaux en ' + currency + '.', 'Totals in ' + currency + '.')) : null,
          demoCount > 0 ? h('button', { type: 'button', className: 'kbpi-link', 'data-act': 'clear-demo', onClick: () => setDialog({ kind: 'clear' }) }, kt('Effacer les données d’exemple', 'Clear sample data')) : null,
          h('button', { type: 'button', className: 'kbpi-link', 'aria-pressed': archived, 'data-act': 'toggle-archived', onClick: toggleArchived }, kt('Archivées', 'Archived')))

        let body
        if (fail !== null && board === null) {
          body = h('div', { className: 'kbpi-banner bad', role: 'alert', 'data-kb': 'pipeline-error' }, h('span', null, errText(fail)), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'retry', onClick: () => loadAll() }, kt('Réessayer', 'Try again')))
        } else if (board === null) {
          body = h('div', { className: 'kbpi-board', 'aria-busy': 'true', 'data-kb': 'pipeline-loading' },
            h('span', { className: 'kbpi-live', role: 'status' }, kt('Chargement du tableau…', 'Loading the board…')),
            [0, 1, 2, 3].map((i) => h('div', { key: i, className: 'kbpi-col' }, h(Bone, { w: '50%', hgt: 14 }), h('div', { style: { height: 10 } }), h(Bone, { hgt: 62 }), h('div', { style: { height: 8 } }), h(Bone, { hgt: 62 }))))
        } else {
          const cols = shownBoard.columns
          const shared = { flow: board.flow, hues, favs, onMove: moveCard, onFav: toggleFav, onOpen: openCard, onKeyDown }
          const nothing = board.count === 0 && board.columns.every((c) => c.cards.length === 0)
          const results = view === 'list'
            ? h(Rows, { ...shared, key: 'list-' + board.flow.id, rows: rowsList, columns: cols, lastStage })
            : view === 'calendar'
              ? h(Calendar, { key: 'cal-' + board.flow.id, cards: rowsList, hues, month, onMonth: setMonth, onOpen: openCard })
              : h(Board, { ...shared, key: 'board-' + board.flow.id, cols, dragId, landingId, settleId, quietId: quiet.current, dragging: dragId !== null, stale, title, newLabel, pos: positions, of: known.length, lastStage, cover: true, onPointerDown, onAdd: (stage) => setDialog({ kind: 'new', stage }) })
          body = h(React.Fragment, null,
            fail !== null ? h('div', { className: 'kbpi-banner bad', role: 'alert', 'data-kb': 'pipeline-error' }, h('span', null, errText(fail)), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'retry', onClick: () => loadAll() }, kt('Réessayer', 'Try again'))) : null,
            nothing ? h('div', { className: 'kbpi-banner note', 'data-kb': 'pipeline-empty' }, h('span', null, kt('Aucune carte pour l’instant. Ajoute la première avec « ' + newLabel + ' », ou demande à ton assistant.', 'No card yet. Add the first one with “' + newLabel + '”, or ask your assistant.'))) : null,
            !nothing && shownBoard.shown === 0 ? h('div', { className: 'kbpi-banner note', 'data-kb': 'pipeline-nomatch' }, h('span', null, kt('Aucune carte ne correspond à cette recherche ou à ces filtres.', 'No card matches this search or these filters.')), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'clear-filters', onClick: clearFilters }, kt('Tout afficher', 'Clear filters'))) : null,
            board.truncated ? h('div', { className: 'kbpi-banner note' }, kt('Ce tableau est très long : seules les premières cartes sont affichées.', 'This board is very long: only the first cards are shown.')) : null,
            results,
            archived ? h('div', { className: 'kbpi-arch', 'data-kb': 'pipeline-archived' }, h('h2', null, kt('Cartes archivées', 'Archived cards')),
              board.archived === undefined || board.archived.length === 0
                ? h('p', { className: 'kbpi-hint' }, kt('Aucune carte archivée sur ce tableau.', 'No archived card on this board.'))
                : board.archived.map((c) => h('div', { key: c.id, className: 'kbpi-arow', 'data-kb': 'pipeline-archived-row', 'data-id': c.id }, h('span', null, c.title), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'restore', onClick: () => restore(c) }, kt('Restaurer', 'Restore'))))) : null)
        }

        return h('div', { className: 'kbpi-root', ref: rootRef, 'data-kb': 'pipeline-page', style: { '--kbpi-facet': JSON.stringify(kt('Étape, priorité, source, étiquette', 'Stage, priority, source, tag')) } },
          header, tools, body,
          h('div', { className: 'kbpi-live', role: 'status', 'aria-live': 'polite', 'data-kb': 'pipeline-live' }, live),
          dialog !== null && dialog.kind === 'clear' ? h(ConfirmClear, { onClose: () => setDialog(null), onDone: (removed) => { setDialog(null); tell(kt('Données d’exemple effacées.', 'Sample data cleared.')); loadAll() } }) : null,
          dialog !== null && (dialog.kind === 'new' || dialog.kind === 'edit') && flow !== null ? h(CardDialog, { key: dialog.kind === 'edit' ? dialog.card.id : 'new', flow, card: dialog.kind === 'edit' ? dialog.card : null, stage: dialog.stage, onClose: () => { if (dialog.kind === 'edit') focusAfter.current = dialog.card.id; setDialog(null) }, onSaved: saved }) : null,
          toast !== null ? h('div', { className: 'kbpi-toast' + (toast.tone === 'bad' ? ' bad' : ''), role: toast.tone === 'bad' ? 'alert' : 'status', 'data-kb': 'pipeline-toast' }, toast.text) : null)
      }

      // ── mounting ──────────────────────────────────────────────────────────────────────────────
      function apply (ctx) {
        try {
          ctx.effect(() => {
            if (document.getElementById(STYLE_ID)) return undefined
            const el = document.createElement('style')
            el.id = STYLE_ID
            el.setAttribute('data-plugin', '@local/kybernos-pipeline')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { el.remove() }
          }, 'kybernos-pipeline: styles')
          // The row in the « Business » group; switching the plugin off takes it back. The core makes its registry when ITS page half applies, which can come
          // after this one (measured in a sandbox: the registry was not there yet): look again for a few seconds before giving up. Nothing here may throw.
          ctx.effect(() => {
            let off = null
            let timer = null
            let tries = 0
            let gone = false
            const declare = () => {
              timer = null
              try {
                const menu = window.__KB_MENU__
                if (menu && typeof menu.register === 'function') { off = menu.register({ id: 'pipeline', group: 'business', icon: 'columns', labelKey: 'business.pipeline', label: { en: 'Pipeline', fr: 'Pipeline' }, order: 30 }); return }
              } catch (e) { return }
              if (!gone && tries < 100) { tries += 1; timer = setTimeout(declare, 100) }
            }
            declare()
            return () => { gone = true; if (timer !== null) clearTimeout(timer); try { if (typeof off === 'function') off() } catch (e) { /* already gone */ } }
          }, 'kybernos-pipeline: menu row')
          ctx.effect(() => ctx.slots.inject('main.kybernos-business', () => ctx.slots.register({ name: 'main.kybernos-business', key: 'pipeline' }, PipelinePage)), 'kybernos-pipeline: page')
        } catch (e) {
          console.warn('[kybernos-pipeline] page not mounted:', e)
        }
      }

      return { name: 'kybernos-pipeline', inject: ['slots'], apply, __test: { pickLabel, fmtValue, ageOf, initials, moveInBoard, neighbour, errText, round2, PipelinePage, artSpec, extrasOf, parseDue, dueIn, dueLabel, artKindOf, stageHue, facetOptions, cardMatchesTypes, visibleColumns, sortCards, viewsOf, filtersOn, Card, Rows, Calendar, Board, PlainBar } }
    } catch (e) {
      console.warn('[kybernos-pipeline] disabled:', e)
      return { apply () {} }
    }
  }
})
