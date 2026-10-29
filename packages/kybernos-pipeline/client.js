// kybernos-pipeline — browser half: the Pipeline board.
//
// One row in the « Business » group of the menu (window.__KB_MENU__, docs/dev/business-menu.md) and the page it opens, mounted on the keyed slot
// `main.kybernos-business`. The data is on the host (/kybernos-pipeline/*, always with the signed session cookie the page already carries); this file draws
// the columns the active theme defines, the total of each column in the theme's value format, and moves a card three ways: a real drag (pointer events, so a
// mouse, a pen and a finger behave alike), the arrow keys on a focused card (announced to screen readers), and the arrow button on the card.
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

      // ── styles: DSH tokens only ──────────────────────────────────────────────────────────────
      const STYLE_ID = 'kbpi-style'
      const CSS = `
.kbpi-root{display:flex;flex-direction:column;gap:14px;min-width:0}
.kbpi-headacts{flex-wrap:wrap}
.kbpi-btn{white-space:nowrap}
.kbpi-primary:disabled{opacity:.5;cursor:default}
.kbpi-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.kbpi-tabs{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);max-width:100%;overflow-x:auto}
.kbpi-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}
.kbpi-tab:hover{color:var(--dsw-alias-label-primary)}
.kbpi-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}
.kbpi-tab i{font-style:normal;margin-inline-start:6px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbpi-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4}
.kbpi-banner{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.kbpi-banner.bad{border-color:var(--dsw-alias-state-error-primary)}
.kbpi-banner.note{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent)}
.kbpi-banner .sp{flex:1 1 auto}
.kbpi-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;align-items:flex-start;scroll-snap-type:x proximity}
.kbpi-col{flex:1 0 214px;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px;min-height:300px;scroll-snap-align:start;transition:border-color .15s,background .15s}
.kbpi-col.over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1))}
.kbpi-col.unknown{border-style:dashed}
.kbpi-colh{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;padding:4px 6px 8px}
.kbpi-colh b{font-weight:650;color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.kbpi-colh span{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.kbpi-colh em{margin-inline-start:auto;font-style:normal;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.kbpi-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-height:40px}
.kbpi-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:14px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbpi-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 10px;display:flex;flex-direction:column;gap:5px;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none;color:var(--dsw-alias-label-primary);transition:border-color .12s}
.kbpi-card:hover{border-color:var(--dsw-alias-border-l2)}
.kbpi-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbpi-card.drag{opacity:.35}
.kbpi-card b{font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.kbpi-sub{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kbpi-chip{align-self:flex-start;max-width:100%;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.kbpi-av{width:22px;height:22px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:600;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);flex:none}
.kbpi-val{margin-inline-start:auto;color:var(--dsw-alias-label-primary);font-weight:650;font-variant-numeric:tabular-nums}
.kbpi-demo{font-size:11px;font-weight:600;color:var(--dsw-alias-state-warn-primary);border:1px solid currentColor;border-radius:999px;padding:0 6px;line-height:16px}
.kbpi-go{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);background:transparent;cursor:pointer;padding:0;flex:none}
.kbpi-go:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbpi-go:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kbpi-go[hidden]{display:none}
.kbpi-ghost{position:fixed;z-index:2147483000;pointer-events:none;margin:0;opacity:.95;transform:rotate(1.5deg);border-color:var(--dsw-alias-brand-primary);box-shadow:var(--dsw-elevation-prominent, 0 0 0 1px var(--dsw-alias-border-l2))}
.kbpi-bone{border-radius:8px;background:var(--dsw-alias-bg-layer-3);animation:kbpi-pulse 1.4s ease-in-out infinite}
@keyframes kbpi-pulse{50%{opacity:.45}}
@media (prefers-reduced-motion: reduce){.kbpi-bone{animation:none}.kbpi-col{transition:none}}
.kbpi-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.kbpi-arch{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.kbpi-arch h2{margin:0;font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}
.kbpi-arow{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbpi-arow span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbpi-modal{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:var(--dsw-alias-bg-mask-1)}
.kbpi-dlg{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.kbpi-dlg h2{margin:0;font-size:16px;font-weight:700}
.kbpi-dlg p{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbpi-f{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.kbpi-f input,.kbpi-f select{font:inherit;font-size:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px;box-sizing:border-box;width:100%;min-width:0}
.kbpi-f input:focus-visible,.kbpi-f select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kbpi-pick{display:flex;flex-direction:column;gap:4px;min-width:0}
.kbpi-row{display:flex;gap:10px}
.kbpi-row>*{flex:1 1 0}
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
.kbpi-toast{position:fixed;inset-inline-start:50%;bottom:22px;transform:translateX(-50%);z-index:2147483100;max-width:min(520px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:9px 14px;font-size:13px}
.kbpi-toast.bad{border-color:var(--dsw-alias-state-error-primary)}
@media (max-width: 560px){.kbpi-col{flex-basis:78vw}.kbpi-row{flex-direction:column}}
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
            h('div', { className: 'kbpi-row' },
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

      // ── one card ──────────────────────────────────────────────────────────────────────────────
      function Card (props) {
        const { card, flow, columns, dragging } = props
        const next = neighbour(columns, card.stage, 1)
        const nextLabel = next === null ? '' : pickLabel(columns.find((c) => c.stage === next).label) || next
        const label = card.title + (card.subtitle ? ', ' + card.subtitle : '') + (flow.value !== null && typeof card.value === 'number' ? ', ' + fmtValue(card.value, flow.value) : '') + (card.demo ? ', ' + kt('exemple', 'sample') : '')
        return h('li', { className: 'kbpi-cardli', style: { listStyle: 'none' } },
          h('article', {
            className: 'kbpi-card' + (dragging ? ' drag' : ''), tabIndex: 0, 'data-kb': 'pipeline-card', 'data-id': card.id, 'data-stage': card.stage, 'data-demo': card.demo ? '1' : '0',
            'aria-label': label, 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter',
            onPointerDown: (e) => props.onPointerDown(e, card),
            onClick: () => props.onOpen(card),
            onKeyDown: (e) => props.onKeyDown(e, card),
          },
          h('b', null, card.title),
          card.subtitle ? h('span', { className: 'kbpi-sub' }, card.subtitle) : null,
          card.item !== null ? h('span', { className: 'kbpi-chip', 'data-kb': 'pipeline-card-item', title: card.item.title }, card.item.title) : null,
          h('div', { className: 'kbpi-meta' },
            card.contact !== null ? h('span', { className: 'kbpi-av', 'data-kb': 'pipeline-card-contact', title: card.contact.name, 'aria-hidden': 'true' }, initials(card.contact.name)) : null,
            h('span', null, ageOf(card.since)),
            card.demo ? h('span', { className: 'kbpi-demo', 'data-kb': 'pipeline-demo' }, kt('démo', 'demo')) : null,
            flow.value !== null && typeof card.value === 'number' ? h('span', { className: 'kbpi-val' }, fmtValue(card.value, flow.value)) : null,
            h('button', { type: 'button', className: 'kbpi-go', hidden: next === null, 'data-act': 'next-stage', 'aria-label': kt('Déplacer vers « ', 'Move to “') + nextLabel + kt(' »', '”'), title: nextLabel,
              onClick: (e) => { e.stopPropagation(); props.onMove(card, next, 'button') }, onPointerDown: (e) => e.stopPropagation(), onKeyDown: (e) => e.stopPropagation() }, h(Arrow)))))
      }

      // ── the page ──────────────────────────────────────────────────────────────────────────────
      function PipelinePage () {
        const [flows, setFlows] = useState(null)
        const [flowId, setFlowId] = useState(() => rememberedFlow())
        const [board, setBoard] = useState(null)
        const [fail, setFail] = useState(null)
        const [dialog, setDialog] = useState(null)
        const [live, setLive] = useState('')
        const [toast, setToast] = useState(null)
        const [archived, setArchived] = useState(false)
        const [dragId, setDragId] = useState(null)
        const seq = useRef(0)
        const rootRef = useRef(null)
        const boardRef = useRef(null)
        boardRef.current = board
        const focusAfter = useRef(null)
        const suppressClick = useRef(false)
        const busyWrites = useRef(0)
        const dragging = useRef(false)
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
            if (r.ok) { setBoard(r.data); setFail(null) } else { setFail(r.error); if (r.error === 'unknown_flow') setBoard(null) }
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
          const again = () => { if (document.hidden || dragging.current || dialogRef.current !== null || busyWrites.current > 0 || flowRef.current === null) return; loadBoard(flowRef.current, archivedRef.current) }
          const timer = setInterval(again, 15000)
          document.addEventListener('visibilitychange', again)
          return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again) }
        }, [])
        // A keyboard move re-creates the card in its new column: give it the focus back.
        useEffect(() => {
          if (focusAfter.current === null || rootRef.current === null) return
          const el = rootRef.current.querySelector('[data-kb="pipeline-card"][data-id="' + focusAfter.current + '"]')
          if (el) { focusAfter.current = null; try { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch (e) { /* no focus here */ } }
        })

        const flow = board !== null ? board.flow : null
        const chosen = flow !== null ? flow : (flows !== null ? flows.flows.find((f) => f.id === flowId) || null : null)

        const moveCard = (card, stage, how) => {
          const now = boardRef.current
          if (now === null || stage === null || stage === card.stage) return
          const col = now.columns.find((c) => c.stage === stage)
          if (col === undefined) return
          const optimistic = moveInBoard(now, card.id, stage, new Date().toISOString())
          const after = optimistic.columns.find((c) => c.stage === stage)
          setBoard(optimistic)
          if (how === 'key') focusAfter.current = card.id
          say(kt(card.title + ' déplacée vers ' + pickLabel(col.label) + '. ' + after.count + ' carte(s) dans cette colonne' + (flow.value !== null ? ', ' + fmtValue(after.total, flow.value) : '') + '.',
            card.title + ' moved to ' + pickLabel(col.label) + '. ' + after.count + ' card(s) in that column' + (flow.value !== null ? ', ' + fmtValue(after.total, flow.value) : '') + '.'))
          busyWrites.current += 1
          api('move', { id: card.id, stage }).then((r) => {
            busyWrites.current -= 1
            if (!r.ok) { tell(errText(r.error, r.detail), 'bad'); say(errText(r.error, r.detail)) }
            return loadBoard(flowRef.current, archivedRef.current)
          })
        }

        const onKeyDown = (e, card) => {
          if (e.target !== e.currentTarget) return
          const cols = boardRef.current.columns
          const flip = rtl() ? -1 : 1
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const to = neighbour(cols, card.stage, (e.key === 'ArrowRight' ? 1 : -1) * flip)
            if (to === null) say(kt('Déjà dans la dernière colonne dans cette direction.', 'Already in the last column in that direction.'))
            else moveCard(card, to, 'key')
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const col = cols.find((c) => c.stage === card.stage)
            const at = col.cards.findIndex((x) => x.id === card.id)
            const other = col.cards[at + (e.key === 'ArrowDown' ? 1 : -1)]
            if (other) { const el = rootRef.current.querySelector('[data-kb="pipeline-card"][data-id="' + other.id + '"]'); if (el) el.focus() }
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setDialog({ kind: 'edit', card })
          }
        }

        /** A real drag with the pointer: a ghost follows it, the column under it lights up, and the card goes to the end of the column it is dropped on. */
        const onPointerDown = (e, card) => {
          if (e.button !== 0 || (e.target.closest && e.target.closest('button, input, select, a'))) return
          const sx = e.clientX
          const sy = e.clientY
          const src = e.currentTarget
          let ghost = null
          let over = null
          let started = false
          const colAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('[data-kb="pipeline-col"]') : null }
          const light = (col) => {
            if (over === col) return
            if (over) over.classList.remove('over')
            over = col
            if (over) over.classList.add('over')
          }
          const finish = () => {
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('pointercancel', onCancel, true)
            window.removeEventListener('keydown', onKey, true)
            if (ghost) ghost.remove()
            if (over) over.classList.remove('over')
            document.body.style.userSelect = ''
            if (started) { dragging.current = false; setDragId(null); suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
          }
          const onMove = (ev) => {
            if (!started) {
              if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return
              started = true
              dragging.current = true
              setDragId(card.id)
              document.body.style.userSelect = 'none'
              const box = src.getBoundingClientRect()
              ghost = src.cloneNode(true)
              ghost.classList.add('kbpi-ghost')
              ghost.classList.remove('drag')
              ghost.removeAttribute('data-kb')
              ghost.style.width = box.width + 'px'
              ghost.dataset.offX = String(sx - box.left)
              ghost.dataset.offY = String(sy - box.top)
              document.body.appendChild(ghost)
            }
            ghost.style.left = (ev.clientX - Number(ghost.dataset.offX)) + 'px'
            ghost.style.top = (ev.clientY - Number(ghost.dataset.offY)) + 'px'
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
            finish()
            if (was && stage !== null) moveCard(card, stage, 'drag')
          }
          const onCancel = () => finish()
          const onKey = (ev) => { if (ev.key === 'Escape') finish() }
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
          setBoard(null)
          loadBoard(id, archived)
        }
        const toggleArchived = () => { const on = !archived; archivedRef.current = on; setArchived(on); if (flowId !== null) loadBoard(flowId, on) }
        const saved = (what, card) => {
          focusAfter.current = what === 'archived' ? null : card.id
          setDialog(null)
          tell(what === 'created' ? kt('Carte ajoutée.', 'Card added.') : what === 'edited' ? kt('Carte enregistrée.', 'Card saved.') : kt('Carte archivée.', 'Card archived.'))
          loadAll()
        }
        const restore = (card) => api('restore', { id: card.id }).then((r) => { if (!r.ok) tell(errText(r.error, r.detail), 'bad'); else tell(kt('Carte restaurée.', 'Card restored.')); loadAll() })

        // ── drawing ──
        const title = chosen !== null ? pickLabel(chosen.label) : kt('Pipeline', 'Pipeline')
        const demoCount = flows !== null ? flows.demo : 0
        const newLabel = chosen !== null ? (pickLabel(chosen.newLabel) || kt('Nouvelle carte', 'New card')) : kt('Nouvelle carte', 'New card')
        const header = h('header', { className: 'kb6-headrow' },
          h('div', { className: 'kb6-headcol' },
            h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title', 'data-kb': 'pipeline-title' }, title), h(Help)),
            h('p', { className: 'kb8-sub', id: 'kbpi-sub' }, kt('Fais avancer chaque carte d’une étape à l’autre : glisse-la, ou donne-lui le focus et utilise les flèches gauche et droite ; Entrée pour la modifier.', 'Move each card from one stage to the next: drag it, or focus it and use the left and right arrows; Enter edits it.'))),
          h('div', { className: 'kb6-headacts kbpi-headacts' },
            demoCount > 0 ? h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'clear-demo', onClick: () => setDialog({ kind: 'clear' }) }, kt('Effacer les données d’exemple', 'Clear sample data')) : null,
            h('button', { type: 'button', className: 'kb6-btn kbpi-btn' + (archived ? ' kb6-btn-on' : ''), 'aria-pressed': archived, 'data-act': 'toggle-archived', onClick: toggleArchived }, kt('Archivées', 'Archived')),
            h('button', { type: 'button', className: 'kb8-primary kbpi-primary', 'data-act': 'new-card', disabled: flow === null, onClick: () => setDialog({ kind: 'new', stage: flow.stages[0].key }) }, h(Plus), newLabel)))

        const tabs = flows !== null && flows.flows.length > 1
          ? h('div', { className: 'kbpi-tabs', role: 'tablist', 'aria-label': kt('Tableaux', 'Boards') }, flows.flows.map((f) => h('button', { key: f.id, type: 'button', role: 'tab', className: 'kbpi-tab', 'aria-selected': f.id === flowId, 'data-kb': 'pipeline-tab', 'data-flow': f.id, onClick: () => chooseFlow(f.id) }, pickLabel(f.label), h('i', null, f.cards))))
          : null
        const currency = chosen !== null && chosen.value !== null && typeof chosen.value.currency === 'string' ? chosen.value.currency : null
        const tools = tabs !== null || currency !== null
          ? h('div', { className: 'kbpi-tools' }, tabs, currency !== null ? h('p', { className: 'kbpi-hint' }, kt('Totaux en ' + currency + '.', 'Totals in ' + currency + '.')) : null)
          : null

        let body
        if (fail !== null && board === null) {
          body = h('div', { className: 'kbpi-banner bad', role: 'alert', 'data-kb': 'pipeline-error' }, h('span', null, errText(fail)), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'retry', onClick: () => loadAll() }, kt('Réessayer', 'Try again')))
        } else if (board === null) {
          body = h('div', { className: 'kbpi-board', 'aria-busy': 'true', 'data-kb': 'pipeline-loading' },
            h('span', { className: 'kbpi-live', role: 'status' }, kt('Chargement du tableau…', 'Loading the board…')),
            [0, 1, 2, 3].map((i) => h('div', { key: i, className: 'kbpi-col' }, h(Bone, { w: '50%', hgt: 14 }), h('div', { style: { height: 10 } }), h(Bone, { hgt: 62 }), h('div', { style: { height: 8 } }), h(Bone, { hgt: 62 }))))
        } else {
          const cols = board.columns
          body = h(React.Fragment, null,
            fail !== null ? h('div', { className: 'kbpi-banner bad', role: 'alert', 'data-kb': 'pipeline-error' }, h('span', null, errText(fail)), h('span', { className: 'sp' }), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'retry', onClick: () => loadAll() }, kt('Réessayer', 'Try again'))) : null,
            board.count === 0 && board.columns.every((c) => c.cards.length === 0) ? h('div', { className: 'kbpi-banner note', 'data-kb': 'pipeline-empty' }, h('span', null, kt('Aucune carte pour l’instant. Ajoute la première avec « ' + newLabel + ' », ou demande à ton assistant.', 'No card yet. Add the first one with “' + newLabel + '”, or ask your assistant.'))) : null,
            board.truncated ? h('div', { className: 'kbpi-banner note' }, kt('Ce tableau est très long : seules les premières cartes sont affichées.', 'This board is very long: only the first cards are shown.')) : null,
            h('div', { className: 'kbpi-board', 'data-kb': 'pipeline-board', role: 'group', 'aria-label': title, 'aria-describedby': 'kbpi-sub' },
              cols.map((col) => h('div', { key: col.stage, className: 'kbpi-col' + (col.unknown ? ' unknown' : ''), role: 'group', 'data-kb': 'pipeline-col', 'data-stage': col.stage, 'data-count': col.count, 'data-total': col.total, 'aria-label': pickLabel(col.label) + ', ' + col.count },
                h('div', { className: 'kbpi-colh' }, h('b', null, pickLabel(col.label)), h('span', { 'data-kb': 'pipeline-col-count' }, col.count),
                  flow.value !== null && col.total !== 0 ? h('em', { 'data-kb': 'pipeline-col-total' }, fmtValue(col.total, flow.value)) : null),
                h('ul', { className: 'kbpi-cards' },
                  col.cards.length === 0 ? h('li', { style: { listStyle: 'none' } }, h('div', { className: 'kbpi-drop' }, kt('Dépose une carte ici', 'Drop a card here'))) : null,
                  col.cards.map((card) => h(Card, { key: card.id, card, flow, columns: cols, dragging: dragId === card.id, onPointerDown, onKeyDown, onMove: moveCard, onOpen: (c) => { if (!suppressClick.current) setDialog({ kind: 'edit', card: c }) } })))))),
            archived ? h('div', { className: 'kbpi-arch', 'data-kb': 'pipeline-archived' }, h('h2', null, kt('Cartes archivées', 'Archived cards')),
              board.archived === undefined || board.archived.length === 0
                ? h('p', { className: 'kbpi-hint' }, kt('Aucune carte archivée sur ce tableau.', 'No archived card on this board.'))
                : board.archived.map((c) => h('div', { key: c.id, className: 'kbpi-arow', 'data-kb': 'pipeline-archived-row', 'data-id': c.id }, h('span', null, c.title), h('button', { type: 'button', className: 'kb6-btn kbpi-btn', 'data-act': 'restore', onClick: () => restore(c) }, kt('Restaurer', 'Restore'))))) : null)
        }

        return h('div', { className: 'kbpi-root', ref: rootRef, 'data-kb': 'pipeline-page' },
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

      return { name: 'kybernos-pipeline', inject: ['slots'], apply, __test: { pickLabel, fmtValue, ageOf, initials, moveInBoard, neighbour, errText, round2, PipelinePage } }
    } catch (e) {
      console.warn('[kybernos-pipeline] disabled:', e)
      return { apply () {} }
    }
  }
})
