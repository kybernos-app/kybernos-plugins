// ═══════════════════════════════════════════════════════
// kybernos-contacts — browser half: the Contacts page of the « Business » group.
//
// A directory of the people and companies of the person's work: the product's own search/filter bar in the header row (search, the view switch with its
// words, filters and sort), a People / Companies switch with the theme's types as coloured chips, a rich list or a grid of cards, a detail panel (fields, linked
// company or people, notes as a timeline, added and never edited) and a dialog to add or change a contact. The words (types, fields, tags) come from the active
// theme through the host's /schema route; with no theme there are plain defaults.
//
// The core hands the page `{ toolbar: { KbToolbar, useToolbarState } }`; without it (a test, an older core) the page draws a plain bar of its own. The coloured tags,
// the avatars and the motion classes come from the shared kit `window.__KB_BIZ_KIT__`, read when the page renders; without it chips and initials are plain.
// Every animation stops under `prefers-reduced-motion`.
//
// It declares its row in the menu (`window.__KB_MENU__`, inside apply, taken back by the cleanup) and mounts the page on the keyed slot
// `main.kybernos-business` with the id of the row as its key. Everything is wrapped in try/catch: the factory always returns a plugin.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-contacts',
  factory: (require) => {
    try {
      const NAME = 'kybernos-contacts'
      const BASE = '/kybernos-contacts'
      const ROW_ID = 'contacts'
      const SLOT = 'main.kybernos-business'
      const PAGE_SIZE = 500 // the host answers 500 rows at most; facets, sort and period work on the rows read, so one page is as much as the host gives
      const MENU_WAIT_MS = 250
      const MENU_TRIES = 120 // the core's registry is waited for 30 s at most
      const MAX_TAG_OPTIONS = 24
      const CLOSE_MS = 170 // the panel's way out, as long as its animation
      const STAGGER_MAX = 14 // rows past this one appear together: a long list does not take seconds to show

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
      /** A theme's `{ en, fr }` label in the language of the page, else English, else the fallback. */
      const tx = (label, fallback) => (label !== null && typeof label === 'object' ? String(label[lang()] || label.en || fallback || '') : String(fallback || ''))

      // ── the shared kit: read when the page renders, never at load (the core applies after the plugins) ────────────────────
      const kitOf = () => {
        try {
          const k = typeof window !== 'undefined' ? window.__KB_BIZ_KIT__ : null
          return k !== null && k !== undefined && typeof k.Tag === 'function' && typeof k.Avatar === 'function' ? k : null
        } catch (e) { return null }
      }
      /** The hue (0-359) of a contact's type, the same one everywhere it is drawn; 212 without the kit. */
      const hueFor = (row) => {
        const k = kitOf()
        const key = row.type !== undefined && row.type !== '' ? row.type : row.kind
        try { if (k !== null && typeof k.tint === 'function') { const n = k.tint(String(key)); if (Number.isFinite(n)) return n } } catch (e) { /* the default hue reads fine */ }
        return 212
      }
      /** The hue of a type key (the kit's tint of the key); 212 without the kit. */
      const hueForKey = (key) => hueFor({ type: key, kind: '' })

      /** True when the person asked the system for less motion: the panel then closes at once instead of sliding out. */
      const calmMotion = () => { try { return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return true } }

      // ── pure helpers (tested without a browser) ────────────────────────────────────────────────────────────────────
      const initials = (name) => {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean)
        if (words.length === 0) return '?'
        const first = Array.from(words[0])[0]
        const second = words.length > 1 ? Array.from(words[words.length - 1])[0] : ''
        return (first + second).toUpperCase()
      }

      /** « 5 min ago », « yesterday », or the date: how long ago a contact changed. */
      const relTime = (iso, nowMs) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return ''
        const sec = Math.max(0, Math.round(((nowMs === undefined ? Date.now() : nowMs) - t) / 1000))
        if (sec < 60) return kt('à l’instant', 'just now')
        const min = Math.round(sec / 60)
        if (min < 60) return kt('il y a ' + min + ' min', min + ' min ago')
        const hours = Math.round(min / 60)
        if (hours < 24) return kt('il y a ' + hours + ' h', hours + ' h ago')
        const days = Math.round(hours / 24)
        if (days === 1) return kt('hier', 'yesterday')
        if (days < 30) return kt('il y a ' + days + ' jours', days + ' days ago')
        try { return new Date(t).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return String(iso).slice(0, 10) }
      }
      const dateTime = (iso) => { try { return new Date(iso).toLocaleString(lang(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (e) { return String(iso) } }

      const kindLabel = (kind) => (kind === 'company' ? kt('Entreprise', 'Company') : kt('Personne', 'Person'))
      /** The word for a row's type: the theme's label, else the plain kind (a type nobody defines any more is drawn as a plain person or company). */
      const typeLabel = (schema, row) => {
        const t = row.type === '' ? undefined : schema.types.find((x) => x.key === row.type && x.kind === row.kind)
        return t === undefined ? kindLabel(row.kind) : tx(t.label, t.key)
      }
      const typesOf = (schema, kind) => schema.types.filter((t) => t.kind === kind)
      const fieldLabel = (f) => tx(f.label, String(f.key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))
      /** The field a theme uses for the picture of a contact (`photo:<theme>/<name>`, a sample portrait): it is drawn as the face, so it is never listed as a field nor asked in the form. */
      const PICTURE_KEY = 'image'
      const pictureOf = (row) => { const v = row !== null && row !== undefined && row.fields !== null && typeof row.fields === 'object' ? row.fields[PICTURE_KEY] : undefined; return typeof v === 'string' && /^photo:[a-z0-9][a-z0-9-]{1,39}\/[a-z0-9][a-z0-9-]{1,59}$/.test(v) ? v : undefined }
      const withoutPicture = (schema) => (schema.fields.some((f) => f.key === PICTURE_KEY) ? Object.assign({}, schema, { fields: schema.fields.filter((f) => f.key !== PICTURE_KEY) }) : schema)

      /** How a custom field's value reads in the panel. */
      const fieldDisplay = (f, v) => {
        if (v === null || v === undefined || v === '') return ''
        try {
          if (f.type === 'money' && typeof v === 'number') return typeof f.currency === 'string' ? new Intl.NumberFormat(lang(), { style: 'currency', currency: f.currency }).format(v) : v.toLocaleString(lang())
          if (f.type === 'number' && typeof v === 'number') return v.toLocaleString(lang())
          if (f.type === 'date' && typeof v === 'string') return new Date(v + 'T00:00:00').toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' })
        } catch (e) { /* the raw value reads fine */ }
        return String(v)
      }

      /** One sentence for each answer the host can give. `detail` is the host's own wording of a bad field; it is English and short, so it is shown as it is. */
      const errorText = (code, detail) => {
        const known = {
          base_missing: kt('Les données métier partagées ne sont pas disponibles dans ce DSH. Mets Kybernos à jour, puis relance-le.', 'The shared business data is not available in this DSH. Update Kybernos, then restart it.'),
          sqlite_unavailable: kt('Cette version de Node ne sait pas ouvrir la base. Il faut Node 22.5 ou plus récent.', 'This version of Node cannot open the base. Node 22.5 or newer is needed.'),
          cannot_open: kt('Le fichier des contacts ne peut pas être ouvert (dossier protégé ou disque plein ?).', 'The contacts file cannot be opened (protected folder or full disk?).'),
          not_a_database: kt('Le fichier des contacts est abîmé : il n’a pas été modifié.', 'The contacts file is damaged: it was not changed.'),
          schema_newer: kt('Ces données viennent d’une version plus récente de Kybernos.', 'This data comes from a newer version of Kybernos.'),
          read_only: kt('Le fichier des contacts est en lecture seule.', 'The contacts file is read-only.'),
          busy: kt('Les contacts sont utilisés par un autre programme. Réessaie dans un instant.', 'The contacts are in use by another program. Try again in a moment.'),
          not_found: kt('Ce contact n’existe plus.', 'This contact no longer exists.'),
          bad_ref: kt('L’entreprise choisie n’existe plus.', 'The company you picked no longer exists.'),
          constraint: kt('Ces données ne sont pas acceptées.', 'These values are not accepted.'),
          confirm_required: kt('Il faut confirmer.', 'Please confirm.'),
          network: kt('Le serveur local ne répond pas. Réessaie dans un instant.', 'The local server is not answering. Try again in a moment.'),
          'sign-in required': kt('Ta session a expiré : recharge la page et reconnecte-toi.', 'Your session has expired: reload the page and sign in again.'),
          'origin refused': kt('Cette requête a été refusée par mesure de sécurité. Recharge la page.', 'This request was refused for safety. Reload the page.'),
          refused_on_phone: kt('Les contacts ne se modifient pas depuis le téléphone.', 'Contacts cannot be changed from the phone.'),
        }
        if (known[code] !== undefined) return known[code]
        if ((code === 'bad_field' || code === 'unknown_field' || code === 'missing_field' || code === 'not_allowed') && typeof detail === 'string' && detail !== '') return detail
        return kt('Ça n’a pas marché (' + String(code) + ').', 'That did not work (' + String(code) + ').')
      }

      /** What the dialog's inputs say about themselves, before the host is asked: `{ key: sentence }`. */
      const checkForm = (form, schema) => {
        const out = {}
        if (form.name.trim() === '') out.name = kt('Le nom est nécessaire.', 'The name is required.')
        else if (form.name.trim().length > 200) out.name = kt('200 caractères au plus.', 'At most 200 characters.')
        const mail = form.email.trim()
        if (mail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) out.email = kt('Une adresse e-mail est attendue.', 'An email address is expected.')
        for (const f of schema.fields) {
          const raw = String(form.fields[f.key] === undefined ? '' : form.fields[f.key]).trim()
          if (raw === '') continue
          if ((f.type === 'number' || f.type === 'money') && !Number.isFinite(Number(raw.replace(',', '.')))) out['f:' + f.key] = kt('Un nombre est attendu.', 'A number is expected.')
          if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) out['f:' + f.key] = kt('Une adresse e-mail est attendue.', 'An email address is expected.')
          if (f.type === 'url' && !/^https?:\/\/\S+$/i.test(raw)) out['f:' + f.key] = kt('Une adresse http ou https est attendue.', 'An http or https address is expected.')
        }
        return out
      }
      /** The body the host takes. On a change, a field the person emptied is sent as null (it clears it); on a new contact an empty field is left out. */
      const formBody = (form, schema, creating, had) => {
        const body = { name: form.name.trim(), type: form.type, email: form.email.trim(), tags: form.tags.split(',').map((t) => t.trim()).filter((t, i, all) => t !== '' && all.indexOf(t) === i), company_id: form.kind === 'person' && form.companyId !== '' ? Number(form.companyId) : null }
        if (creating) body.kind = form.kind
        const fields = {}
        for (const f of schema.fields) {
          const raw = String(form.fields[f.key] === undefined ? '' : form.fields[f.key]).trim()
          if (raw !== '') fields[f.key] = (f.type === 'number' || f.type === 'money') ? Number(raw.replace(',', '.')) : raw
          else if (!creating && had !== undefined && had.fields !== undefined && had.fields[f.key] !== undefined) fields[f.key] = null
        }
        if (Object.keys(fields).length > 0) body.fields = fields
        return body
      }
      const emptyForm = (kind, schema, contact, company) => {
        const own = typesOf(schema, kind)
        const fields = {}
        if (contact !== undefined) for (const f of schema.fields) if (contact.fields && contact.fields[f.key] !== undefined && contact.fields[f.key] !== null) fields[f.key] = String(contact.fields[f.key])
        return {
          kind: contact !== undefined ? contact.kind : kind,
          name: contact !== undefined ? contact.name : '',
          type: contact !== undefined ? contact.type : (own.length > 0 ? own[0].key : ''),
          email: contact !== undefined ? contact.email : '',
          companyId: contact !== undefined && contact.company_id !== null ? String(contact.company_id) : (company !== undefined ? String(company) : ''),
          tags: contact !== undefined ? contact.tags.join(', ') : '',
          fields,
        }
      }

      /** The tags a filter can offer: the theme's, then the ones the visible rows carry. */
      const tagChoices = (schema, rows) => {
        const out = schema.tags.slice()
        for (const r of rows) for (const t of r.tags) if (out.indexOf(t) < 0) out.push(t)
        return out
      }
      const domainLabel = () => { try { const l = window.__KB_DOMAIN__ && typeof window.__KB_DOMAIN__.label === 'function' ? window.__KB_DOMAIN__.label(ROW_ID) : null; return typeof l === 'string' && l !== '' ? l : null } catch (e) { return null } }

      // ── facets, period and sort: done here, on the rows the host gave ───────────────────────────────────────────────────
      // The toolbar keeps one list of facet ids: « t:buyer » is a type, « g:vip » a tag. A row passes when it has ONE of the chosen types and ONE of the chosen tags.
      const typeId = (key) => 't:' + key
      const tagId = (tag) => 'g:' + tag
      const SORTS = ['modified', 'name', 'created', 'type']
      const sortChoice = (v) => (SORTS.indexOf(v) >= 0 ? v : 'modified')

      /** The rows of one kind that pass the chosen facets and period. `o = { kind, types, period, nowMs }`. */
      const filterRows = (rows, o) => {
        const ids = Array.isArray(o.types) ? o.types : []
        const types = ids.filter((id) => id.indexOf('t:') === 0).map((id) => id.slice(2))
        const tags = ids.filter((id) => id.indexOf('g:') === 0).map((id) => id.slice(2))
        const days = o.period === '7' ? 7 : (o.period === '30' ? 30 : 0)
        const since = days > 0 ? (o.nowMs === undefined ? Date.now() : o.nowMs) - days * 86400000 : 0
        return rows.filter((r) => r.kind === o.kind && (types.length === 0 || types.indexOf(r.type) >= 0) && (tags.length === 0 || r.tags.some((t) => tags.indexOf(t) >= 0)) && (days === 0 || Date.parse(r.updated_at) >= since))
      }
      /** A sorted copy. The name breaks every tie, so the order never jumps between two reads. */
      const sortRows = (rows, sort, dir, schema) => {
        const sign = dir === 'asc' ? 1 : -1
        const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true })
        const time = (k) => (r) => { const t = Date.parse(r[k]); return Number.isFinite(t) ? t : 0 }
        const updated = time('updated_at')
        const created = time('created_at')
        let primary = byName
        if (sort === 'modified') primary = (a, b) => updated(a) - updated(b)
        else if (sort === 'created') primary = (a, b) => created(a) - created(b)
        else if (sort === 'type') primary = (a, b) => typeLabel(schema, a).localeCompare(typeLabel(schema, b), undefined, { sensitivity: 'base' })
        return rows.slice().sort((a, b) => (primary(a, b) * sign) || byName(a, b) || (a.id - b.id))
      }
      /** The options of the facet menu and the chips: the theme's types of the kind, then the tags, each with how many of `rows` carry it. A chosen id that matches nothing stays, at 0, so it can be taken off. */
      const facetOptions = (schema, kind, rows, selected) => {
        const own = rows.filter((r) => r.kind === kind)
        const typeCount = new Map()
        const tagCount = new Map()
        for (const r of own) {
          typeCount.set(r.type, (typeCount.get(r.type) || 0) + 1)
          for (const t of r.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
        }
        const chosen = Array.isArray(selected) ? selected : []
        const types = typesOf(schema, kind).map((t) => ({ id: typeId(t.key), group: 'type', key: t.key, text: tx(t.label, t.key), count: typeCount.get(t.key) || 0 }))
        const tags = tagChoices(schema, own).map((t) => ({ id: tagId(t), group: 'tag', key: t, text: t, count: tagCount.get(t) || 0 }))
          .sort((a, b) => (b.count - a.count) || a.text.localeCompare(b.text))
          .filter((o, i) => i < MAX_TAG_OPTIONS || chosen.indexOf(o.id) >= 0)
        const out = types.concat(tags)
        for (const id of chosen) {
          if (out.some((o) => o.id === id)) continue
          if (id.indexOf('g:') === 0) out.push({ id, group: 'tag', key: id.slice(2), text: id.slice(2), count: 0 })
          else if (id.indexOf('t:') === 0) out.push({ id, group: 'type', key: id.slice(2), text: id.slice(2), count: 0 })
        }
        return out
      }
      const toggleId = (list, id) => (list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat([id]))

      // ── the host ───────────────────────────────────────────────────────────────────────────────────────────────────────
      /** `{ ok, … }` always: a network failure, an unreadable answer or a refusal is an answer too. The session cookie travels with the request. */
      const call = async (method, path, body) => {
        try {
          const res = await fetch(BASE + path, { method, cache: 'no-store', credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
          let data = null
          try { data = await res.json() } catch (e) { data = null }
          if (data !== null && typeof data === 'object' && typeof data.ok === 'boolean') return data
          return { ok: false, error: res.status === 401 ? 'sign-in required' : (res.status === 403 ? 'origin refused' : 'network') }
        } catch (e) { return { ok: false, error: 'network' } }
      }
      const query = (params) => '?' + Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== false).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] === true ? '1' : params[k])).join('&')

      // ── styles: DSH's tokens and the kit's tints (hsl of a hue) only ────────────────────────────────────────────────────
      // Colour comes from var(--dsw-alias-*) or from `hsl(var(--kbcts-h) …)`, the hue of a type. The only literal colour is white, on a solid chip.
      const CSS = `
        .kbcts{display:block;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;min-width:0}
        .kbcts *{box-sizing:border-box}
        .kbcts button{font:inherit}
        .kbcts :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbcts-main{container:kbcts-page / inline-size;display:flex;flex-direction:column;gap:16px;min-width:0}
        .kbcts .kb6-headrow .kb8-primary{gap:7px}
        .kbcts .kb8-primary[disabled]{opacity:.5;cursor:not-allowed;filter:none}
        .kbcts .kb6-headrow .kb8-primary{transition:transform .14s cubic-bezier(.2,.8,.2,1),filter .14s}
        .kbcts .kb6-headrow .kb8-primary:active{transform:scale(.97)}
        .kbcts .kb6-tb-pop{max-height:min(70vh,560px);overflow-y:auto;left:auto;inset-inline-end:0}
        .kbcts .kb6-tb-pop>.kb6-tb-pophead.row+.kb6-tb-facetlabel{font-size:0;line-height:0;padding-block:0}
        .kbcts .kb6-tb-pop>.kb6-tb-pophead.row+.kb6-tb-facetlabel::before{content:var(--kbcts-facet,"");font-size:11px;line-height:1.5}
        .kbcts .kb6-tb-popitem:has(.kbcts-first-tag){margin-top:6px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1);border-radius:0 0 8px 8px}
        .kbcts .kb6-search-inline input:focus-visible{outline:none}
        .kbcts-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
        .kbcts-in{height:36px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:13px;min-width:0;transition:border-color .15s,box-shadow .15s}
        .kbcts-in::placeholder{color:var(--dsw-alias-label-tertiary)}
        .kbcts-in:focus{border-color:var(--dsw-alias-brand-primary);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
        textarea.kbcts-in{height:auto;padding:9px 12px;resize:vertical;line-height:1.45}
        select.kbcts-in{padding-right:8px}
        select.kbcts-sel{width:auto;height:38px;max-width:170px}
        .kbcts-strip{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px}
        .kbcts-seg{display:inline-flex;gap:2px;padding:4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
        .kbcts-seg button{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 14px;border:none;border-radius:999px;background:transparent;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .16s,color .16s,transform .14s cubic-bezier(.2,.8,.2,1),box-shadow .16s}
        .kbcts-seg button:hover{color:var(--dsw-alias-label-primary)}
        .kbcts-seg button:active{transform:scale(.96)}
        .kbcts-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
        .kbcts-seg .n{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
        .kbcts-fcs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
        .kbcts-fc{--kbcts-h:212;display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;white-space:nowrap;transition:background .16s,border-color .16s,color .16s,transform .14s cubic-bezier(.2,.8,.2,1)}
        .kbcts-fc i{width:7px;height:7px;border-radius:50%;background:hsl(var(--kbcts-h) 75% 52%);flex:none;transition:background .16s}
        .kbcts-fc:hover{border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-primary)}
        .kbcts-fc:active{transform:scale(.95)}
        .kbcts-fc .n{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
        .kbcts-fc.dim{opacity:.6}
        .kbcts-fc[aria-pressed="true"]{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);opacity:1}
        .kbcts-fc[aria-pressed="true"] i{background:var(--dsw-alias-label-primary-inverted,#fff)}
        .kbcts-fc.all:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
        .kbcts-fc.all[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
        .kbcts-fc.ghost:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
        .kbcts-fc.ghost[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
        .kbcts-fc.ghost svg{color:var(--dsw-alias-label-tertiary)}
        .kbcts-end{margin-inline-start:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
        .kbcts-count{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
        .kbcts-link{border:none;background:transparent;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;padding:4px 6px;font-size:12px;border-radius:6px}
        .kbcts-link:hover{color:var(--dsw-alias-label-primary)}
        .kbcts-tagwrap,.kbcts-popbox{display:inline-flex;max-width:100%;min-width:0}
        .kbcts-tag{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
        button.kbcts-tag{cursor:pointer}
        button.kbcts-tag:hover{color:var(--dsw-alias-label-primary)}
        .kbcts-tag.demo{background:transparent;border:1px dashed var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));font-weight:600;font-size:11px;padding:1px 8px}
        .kbcts-tags{display:flex;flex-wrap:wrap;gap:5px;min-width:0}
        .kbcts-more{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600}
        .kbcts-muted{color:var(--dsw-alias-label-tertiary)}
        .kbcts-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-weight:550;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,transform .14s cubic-bezier(.2,.8,.2,1),filter .15s}
        .kbcts a.kbcts-btn,.kbcts a.kbcts-ib{text-decoration:none}
        .kbcts-btn:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbcts-btn:active{transform:scale(.97)}
        .kbcts-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:650}
        .kbcts-btn.primary:hover{filter:brightness(.96)}
        .kbcts-btn.sm{height:30px;padding:0 11px;font-size:12px}
        .kbcts-btn.quiet{border-color:transparent;color:var(--dsw-alias-label-secondary)}
        .kbcts-btn[disabled]{opacity:.5;cursor:not-allowed}
        .kbcts-ib{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;text-decoration:none;transition:background .15s,color .15s,transform .14s cubic-bezier(.2,.8,.2,1)}
        .kbcts-ib:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbcts-ib:active{transform:scale(.88)}
        .kbcts-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
        .kbcts-banner.warn{border-color:var(--dsw-alias-state-warn-primary)}
        .kbcts-banner.warn svg{color:var(--dsw-alias-state-warn-primary)}
        .kbcts-banner>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
        .kbcts-banner .sp{flex:1 1 220px;min-width:0}
        .kbcts-banner b{color:var(--dsw-alias-label-primary)}
        .kbcts-body{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
        .kbcts-body.has-panel{grid-template-columns:minmax(0,1fr) 360px}
        .kbcts-tw{container:kbcts-table / inline-size;overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
        .kbcts-tbl{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
        .kbcts-tbl .col-type{width:152px}
        .kbcts-tbl .col-co{width:172px}
        .kbcts-tbl .col-tags{width:224px}
        .kbcts-tbl .col-upd{width:116px;position:relative}
        .kbcts-tbl td{overflow:hidden}
        .kbcts-tbl th{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600;text-align:start;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent)}
        .kbcts-tbl td{padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle;transition:background .15s,box-shadow .18s}
        .kbcts-tbl tbody tr:last-child td{border-bottom:none}
        .kbcts-tbl tr.r{--kbcts-h:212;cursor:pointer}
        .kbcts-tbl tr.r td:first-child{box-shadow:inset 3px 0 0 transparent}
        .kbcts-tbl tr.r:hover td,.kbcts-tbl tr.r:focus-within td{background:color-mix(in srgb,hsl(var(--kbcts-h) 80% 55%) 5%,var(--dsw-alias-bg-layer-2))}
        .kbcts-tbl tr.r:hover td:first-child,.kbcts-tbl tr.r:focus-within td:first-child{box-shadow:inset 3px 0 0 hsl(var(--kbcts-h) 70% 55% / .8)}
        .kbcts-tbl tr.r:active td{background:var(--dsw-alias-bg-layer-3)}
        .kbcts-tbl tr.r[aria-current="true"] td{background:color-mix(in srgb,hsl(var(--kbcts-h) 80% 55%) 9%,var(--dsw-alias-bg-layer-1))}
        .kbcts-tbl tr.r[aria-current="true"] td:first-child{box-shadow:inset 3px 0 0 hsl(var(--kbcts-h) 70% 55%)}
        .kbcts-tbl tr.r:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
        .kbcts-tbl tr.arch td{opacity:.6}
        .kbcts-tbl .col-tags .kbcts-tags{flex-wrap:nowrap;overflow:hidden;align-items:center}
        .kbcts-who{display:flex;align-items:center;gap:12px;min-width:0}
        .kbcts-who .kbcts-face{transition:transform .22s cubic-bezier(.3,1.6,.5,1)}
        tr.r:hover .kbcts-face,.kbcts-card:hover .kbcts-face{transform:scale(1.07)}
        .kbcts-who b{display:flex;align-items:center;gap:7px;font-weight:600;font-size:14px;min-width:0}
        .kbcts-who b span.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-who small{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-who>div{min-width:0}
        .kbcts-face{display:inline-flex;flex:none;line-height:0}
        .kbcts-av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);flex:none}
        .kbcts-av.co{border-radius:9px}
        .kbcts-co{display:flex;align-items:center;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary)}
        .kbcts-co svg{flex:none;color:var(--dsw-alias-label-tertiary)}
        .kbcts-comark{display:inline-flex;flex:none;line-height:0}
        .kbcts-co .kbcts-comark svg{color:inherit}
        .kbcts-co span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-ra{display:inline-flex;gap:2px;justify-content:flex-end;opacity:0;transform:translateX(6px);transition:opacity .16s,transform .18s cubic-bezier(.2,.8,.2,1)}
        .kbcts-tbl .kbcts-ra{position:absolute;inset-inline-end:8px;top:50%;margin-top:-15px}
        .kbcts-tbl .when{display:block;transition:opacity .16s}
        tr.r:hover .kbcts-ra,tr.r:focus-within .kbcts-ra,tr.r:focus .kbcts-ra,.kbcts-card:hover .kbcts-ra,.kbcts-card:focus-within .kbcts-ra,.kbcts-card:focus .kbcts-ra{opacity:1;transform:none}
        tr.r:hover .when,tr.r:focus-within .when,tr.r:focus .when{opacity:0}
        @media (hover:none){.kbcts-card .kbcts-ra{opacity:1;transform:none}.kbcts-tbl .kbcts-ra{display:none}.kbcts-tbl tr.r:hover .when,.kbcts-tbl tr.r:focus-within .when,.kbcts-tbl tr.r:focus .when{opacity:1}}
        .kbcts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
        .kbcts-cell{display:flex;min-width:0}
        .kbcts-cell>.kbcts-card{flex:1 1 auto}
        .kbcts-card{--kbcts-h:212;position:relative;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;cursor:pointer;min-width:0}
        .kbcts-card:hover{border-color:color-mix(in srgb,hsl(var(--kbcts-h) 70% 50%) 40%,var(--dsw-alias-border-l1))}
        .kbcts-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbcts-card[aria-current="true"]{border-color:hsl(var(--kbcts-h) 70% 55%);box-shadow:0 0 0 1px hsl(var(--kbcts-h) 70% 55%)}
        .kbcts-card.arch{opacity:.65}
        .kbcts-card .band{height:64px;background:linear-gradient(135deg,hsl(var(--kbcts-h) 40% 60% / .16),hsl(calc(var(--kbcts-h) + 42) 36% 62% / .05))}
        .kbcts-card .top{position:absolute;top:8px;inset-inline:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none}
        .kbcts-card .top>*{pointer-events:auto}
        .kbcts-card .top .kbcts-ra{width:auto;margin-inline-start:auto}
        .kbcts-card .top .kbcts-ib{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent);backdrop-filter:blur(4px)}
        .kbcts-card .top .kbcts-ib:hover{background:var(--dsw-alias-bg-layer-1)}
        .kbcts-card .inner{display:flex;flex-direction:column;flex:1 1 auto;gap:8px;padding:0 16px 14px;margin-top:-26px;min-width:0}
        .kbcts-card .face{align-self:flex-start;border-radius:50%;box-shadow:0 0 0 4px var(--dsw-alias-bg-layer-1);transition:transform .22s cubic-bezier(.3,1.6,.5,1)}
        .kbcts-card .face.co{border-radius:30%}
        .kbcts-card:hover .face{transform:scale(1.06)}
        .kbcts-card h3{margin:2px 0 0;font-size:14px;font-weight:650;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-card .mail{color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:-6px}
        .kbcts-card .tags{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
        .kbcts-card .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px;min-width:0}
        .kbcts-card .foot .kbcts-co{flex:1 1 auto;color:var(--dsw-alias-label-secondary)}
        .kbcts-card .foot time{flex:none}
        .kbcts-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:18px;padding:34px 20px;text-align:center;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:center;gap:10px}
        .kbcts-empty b{font-size:16px;color:var(--dsw-alias-label-primary)}
        .kbcts-empty .pic{width:168px;height:104px;border-radius:16px;margin-bottom:4px}
        .kbcts-bone{display:block;border-radius:8px;background:var(--dsw-alias-bg-skeleton,var(--dsw-alias-bg-layer-3));animation:kbctspulse 1.4s ease-in-out infinite}
        @keyframes kbctspulse{50%{opacity:.5}}
        .kbcts-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbcts-panel{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;min-width:0;animation:kbcts-slide .28s cubic-bezier(.2,.8,.2,1) both}
        .kbcts-panel.out{animation:kbcts-slide-out .17s ease-in both}
        .kbcts-pc{display:flex;flex-direction:column;min-width:0;animation:kbcts-fade .22s ease-out both}
        .kbcts-hero{--kbcts-h:212;display:flex;flex-direction:column;gap:12px;padding:20px 18px 14px;background:linear-gradient(160deg,hsl(var(--kbcts-h) 40% 60% / .14),hsl(calc(var(--kbcts-h) + 42) 36% 62% / .04) 70%,transparent)}
        .kbcts-hero .head{display:flex;gap:14px;align-items:center;padding-inline-end:30px;min-width:0}
        .kbcts-hero .head>div{min-width:0}
        .kbcts-panel h3{margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.25;overflow-wrap:anywhere}
        .kbcts-hero .meta{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;color:var(--dsw-alias-label-secondary)}
        .kbcts-hero .acts{display:flex;flex-wrap:wrap;gap:8px}
        .kbcts-pb{display:flex;flex-direction:column;gap:4px;padding:6px 18px 20px}
        .kbcts-x{position:absolute;top:10px;inset-inline-end:10px;z-index:2;width:30px;height:30px;border-radius:50%;border:none;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);display:grid;place-items:center;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,transform .14s cubic-bezier(.2,.8,.2,1)}
        .kbcts-x:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbcts-x:active{transform:scale(.88)}
        .kbcts-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px;margin:8px 0 0}
        .kbcts-dl dt{color:var(--dsw-alias-label-tertiary)}
        .kbcts-dl dd{margin:0;overflow-wrap:anywhere}
        .kbcts-panel h4{margin:16px 0 6px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600}
        .kbcts-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
        .kbcts-list li button{width:100%;display:flex;gap:10px;align-items:center;text-align:start;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:7px 10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;transition:background .15s,transform .14s cubic-bezier(.2,.8,.2,1),border-color .15s}
        .kbcts-list li button:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
        .kbcts-list li button:active{transform:scale(.98)}
        .kbcts-linkrow{display:flex;gap:8px;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:7px 10px;font-size:13px;min-width:0}
        .kbcts-linkrow .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
        .kbcts-compose{display:flex;flex-direction:column;gap:8px}
        .kbcts-compose .row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
        .kbcts-tl{display:flex;flex-direction:column;margin:12px 0 0;padding:0;list-style:none}
        .kbcts-tl li{--kbcts-h:212;position:relative;padding-inline-start:36px;padding-bottom:16px;min-width:0}
        .kbcts-tl li:last-child{padding-bottom:0}
        .kbcts-tl li::before{content:"";position:absolute;inset-inline-start:11px;top:26px;bottom:2px;width:2px;border-radius:1px;background:var(--dsw-alias-border-l1)}
        .kbcts-tl li:last-child::before{display:none}
        .kbcts-tl .dot{position:absolute;inset-inline-start:0;top:0;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,hsl(var(--kbcts-h) 80% 55%) 18%,transparent);color:color-mix(in srgb,hsl(var(--kbcts-h) 70% 42%) 80%,var(--dsw-alias-label-primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,hsl(var(--kbcts-h) 70% 50%) 25%,transparent)}
        .kbcts-tl b{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600;line-height:24px}
        .kbcts-tl div.t{white-space:pre-wrap;overflow-wrap:anywhere;padding-top:1px}
        .kbcts-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .kbcts-toast{position:sticky;bottom:14px;display:flex;align-items:center;gap:9px;width:fit-content;max-width:100%;margin-top:14px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);border-radius:12px;padding:9px 14px;font-size:13px;z-index:2;animation:kbcts-rise .24s cubic-bezier(.2,.8,.2,1) both}
        .kbcts-scrim{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent);display:grid;place-items:center;padding:16px;animation:kbcts-fade .18s ease-out both}
        .kbcts-dialog{width:min(540px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:20px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;animation:kbcts-rise .26s cubic-bezier(.2,.8,.2,1) both}
        .kbcts-dhead{display:flex;align-items:center;gap:12px}
        .kbcts-dialog h2{margin:0;font-size:20px;font-weight:700}
        .kbcts-field{display:flex;flex-direction:column;gap:5px;min-width:0}
        .kbcts-field label,.kbcts-field .lbl{font-size:12px;font-weight:600}
        .kbcts-field .err{color:var(--dsw-alias-state-error-primary);font-size:12px}
        .kbcts-field .hint{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbcts-chips{display:flex;flex-wrap:wrap;gap:6px}
        .kbcts-row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
        .kbcts-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px}
        .kbcts-alert{padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-size:13px}
        @keyframes kbcts-slide{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
        @keyframes kbcts-slide-out{to{opacity:0;transform:translateX(20px)}}
        @keyframes kbcts-fade{from{opacity:0}to{opacity:1}}
        @keyframes kbcts-rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
        @container kbcts-page (max-width:760px){
          .kbcts-body.has-panel{grid-template-columns:minmax(0,1fr)}
          .kbcts-body.has-panel .kbcts-tw,.kbcts-body.has-panel .kbcts-grid,.kbcts-body.has-panel .kbcts-pager{display:none}
          .kbcts-panel{position:relative;top:auto;max-height:none;overflow-y:visible}
        }
        @container kbcts-page (max-width:560px){
          .kbcts-end{margin-inline-start:0}
        }
        @container kbcts-table (max-width:760px){
          .kbcts-tbl .col-co{display:none}
        }
        @container kbcts-table (max-width:600px){
          .kbcts-tbl .col-tags{display:none}
        }
        @container kbcts-table (max-width:440px){
          .kbcts-tbl .col-upd{display:none}
        }
        @media (prefers-reduced-motion:reduce){
          .kbcts *,.kbcts *::before,.kbcts *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
          .kbcts-ra{transform:none}
        }
      `

      // ── icons: a few paths, drawn in the colour of the text (the kit has the business ones: pin, tag, clock, sparkle…) ──────
      const ICONS = {
        plus: ['M5 12h14', 'M12 5v14'],
        search: ['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
        x: ['M18 6 6 18', 'M6 6l12 12'],
        edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
        archive: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'],
        undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
        arrow: ['M5 12h14', 'M12 5l7 7-7 7'],
        building: ['M3 21h18', 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16', 'M19 21V11a2 2 0 0 0-2-2h-2', 'M9 7h2', 'M9 11h2', 'M9 15h2'],
        mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
        users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        plusdot: ['M12 8v8', 'M8 12h8'],
      }

      // ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useRef } = React
        const svg = (name, size) => h('svg', { width: size || 15, height: size || 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, (ICONS[name] || []).map((d, i) => h('path', { key: i, d })))
        /** An icon: the plugin's own drawing, else the kit's (business icons), else nothing. */
        const Ic = (name, size) => {
          if (ICONS[name] !== undefined) return svg(name, size)
          const k = kitOf()
          try { return k !== null && typeof k.Icon === 'function' ? k.Icon(name, size || 15) : null } catch (e) { return null }
        }
        const help = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-contacts' }) : null)
        const DEFAULT_SCHEMA = { themed: false, themes: [], types: [{ key: 'person', kind: 'person', label: { en: 'Person', fr: 'Personne' } }, { key: 'company', kind: 'company', label: { en: 'Company', fr: 'Entreprise' } }], fields: [], tags: [] }
        const DEFAULT_PREFS = { sort: 'modified', dir: 'desc', viewMode: 'list' }
        const NO_FIND = { query: '', types: [], period: 'all' }

        /** A coloured chip: the kit's when it is there (its colour follows the text unless `hue` is given), else a plain one. */
        const Chip = (o) => {
          const k = kitOf()
          const text = String(o.text === undefined ? '' : o.text)
          return h('span', { className: 'kbcts-tagwrap' }, k !== null ? h(k.Tag, o) : (typeof o.onClick === 'function'
            ? h('button', { type: 'button', className: 'kbcts-tag', title: o.title, 'aria-pressed': o.on === true, onClick: o.onClick }, text)
            : h('span', { className: 'kbcts-tag', title: o.title }, text)))
        }
        /** The picture of a contact: the kit's avatar (initials on a tint, a building for a company), else plain initials. Decorative: the name is written beside it. */
        const Face = (o) => {
          const k = kitOf()
          const size = o.size || 36
          if (k !== null) return h('span', { className: 'kbcts-face' + (o.className ? ' ' + o.className : ''), 'aria-hidden': 'true' }, h(k.Avatar, { name: o.name, size, kind: o.kind, image: o.image }))
          return h('span', { className: 'kbcts-face kbcts-av' + (o.kind === 'company' ? ' co' : '') + (o.className ? ' ' + o.className : ''), style: { width: size, height: size, fontSize: fontOf(size) }, 'aria-hidden': 'true' }, o.kind === 'company' ? Ic('building', Math.round(size * 0.5)) : initials(o.name))
        }
        /** The small mark of a company beside its name: the kit's drawn logo, else the plain building. */
        const CoMark = (o) => {
          const k = kitOf()
          return k !== null && typeof k.Logo === 'function' ? h('span', { className: 'kbcts-comark', 'aria-hidden': 'true' }, h(k.Logo, { name: o.name, size: o.size })) : Ic('building', o.size)
        }
        const fontOf = (size) => (size >= 48 ? 16 : 11) // the initials of a big face are 16 px, the others 11 px: both are on the scale
        const mailable = (email) => typeof email === 'string' && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)

        const Bones = () => h('div', { className: 'kbcts-tw', 'aria-busy': 'true' }, [0, 1, 2, 3, 4].map((i) => h('div', { key: i, style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px', borderBottom: i < 4 ? '1px solid var(--dsw-alias-border-l1)' : 'none' } },
          h('span', { className: 'kbcts-bone', style: { width: 36, height: 36, borderRadius: '50%', flex: 'none' } }),
          h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 } }, h('span', { className: 'kbcts-bone', style: { width: '38%', height: 12 } }), h('span', { className: 'kbcts-bone', style: { width: '24%', height: 10 } })),
          h('span', { className: 'kbcts-bone', style: { width: 70, height: 20, borderRadius: 11 } }))))

        // The dialog to add or change a contact.
        const ContactDialog = (props) => {
          const schema = props.schema
          const initial = emptyForm(props.kind, schema, props.contact, props.companyId)
          const formState = useState(initial)
          const form = formState[0]
          const setForm = formState[1]
          const errState = useState({})
          const problem = useState(null)
          const busyState = useState(false)
          const companiesState = useState([])
          const poppedState = useState('')
          const boxRef = useRef(null)
          const editing = props.contact !== undefined
          const own = typesOf(schema, form.kind)
          const set = (patch) => setForm((f) => Object.assign({}, f, patch))
          useEffect(() => {
            let alive = true
            const saved = typeof document !== 'undefined' ? document.activeElement : null
            const first = boxRef.current && boxRef.current.querySelector('[data-kb="contacts-form-name"]')
            if (first) first.focus()
            if (form.kind === 'person') {
              call('GET', '/list' + query({ kind: 'company', limit: 500 })).then((r) => { if (alive && r.ok) companiesState[1](r.rows.map((c) => ({ id: c.id, name: c.name }))) })
            }
            return () => { alive = false; try { if (saved && typeof saved.focus === 'function' && document.contains(saved)) saved.focus() } catch (e) { /* the opener is gone */ } }
          }, [])
          const save = async () => {
            const problems = checkForm(form, schema)
            errState[1](problems)
            problem[1](null)
            if (Object.keys(problems).length > 0) return
            busyState[1](true)
            const body = formBody(form, schema, !editing, props.contact)
            const r = editing ? await call('POST', '/update', Object.assign({ id: props.contact.id }, body)) : await call('POST', '/create', body)
            busyState[1](false)
            if (r.ok) props.onSaved(r.contact, editing)
            else problem[1](errorText(r.error, r.detail))
          }
          const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); return }
            if (e.key !== 'Tab' || !boxRef.current) return
            const nodes = Array.from(boxRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'))
            if (nodes.length === 0) return
            const first = nodes[0]
            const last = nodes[nodes.length - 1]
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          }
          const errs = errState[0]
          const typeOptions = own.map((t) => h('option', { key: t.key, value: t.key }, tx(t.label, t.key)))
          if (form.type !== '' && !own.some((t) => t.key === form.type)) typeOptions.push(h('option', { key: form.type, value: form.type }, form.type + ' ' + kt('(hors thème)', '(not in the theme)')))
          const companyOptions = companiesState[0].filter((c) => !editing || c.id !== props.contact.id)
          if (form.companyId !== '' && !companyOptions.some((c) => String(c.id) === form.companyId) && props.company) companyOptions.push({ id: props.company.id, name: props.company.name })
          const tagList = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          const toggleTag = (t) => { poppedState[1](tagList.indexOf(t) >= 0 ? '' : t); set({ tags: (tagList.indexOf(t) >= 0 ? tagList.filter((x) => x !== t) : tagList.concat([t])).join(', ') }) }
          const title = editing ? kt('Modifier le contact', 'Edit contact') : (form.kind === 'company' ? kt('Nouvelle entreprise', 'New company') : kt('Nouveau contact', 'New contact'))
          return h('div', { className: 'kbcts-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbcts-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbcts-dlg-title', 'data-kb': 'contacts-dialog', ref: boxRef, onKeyDown: onKey },
              h('div', { className: 'kbcts-dhead' }, h(Face, { name: form.name, size: 44, kind: form.kind, image: editing ? pictureOf(props.contact) : undefined }), h('h2', { id: 'kbcts-dlg-title' }, title)),
              problem[0] !== null ? h('div', { className: 'kbcts-alert', role: 'alert', 'data-kb': 'contacts-form-error' }, problem[0]) : null,
              !editing ? h('div', { className: 'kbcts-field' }, h('span', { className: 'lbl', id: 'kbcts-kind-lbl' }, kt('Genre', 'Kind')),
                h('div', { className: 'kbcts-seg', role: 'group', 'aria-labelledby': 'kbcts-kind-lbl', style: { alignSelf: 'flex-start' } },
                  ['person', 'company'].map((k) => h('button', { key: k, type: 'button', 'aria-pressed': form.kind === k, 'data-kb': 'contacts-form-kind', 'data-kind': k, onClick: () => { const t = typesOf(schema, k); set({ kind: k, type: t.length > 0 ? t[0].key : '', companyId: k === 'company' ? '' : form.companyId }) } }, Ic(k === 'company' ? 'building' : 'users', 14), k === 'company' ? kt('Entreprise', 'Company') : kt('Personne', 'Person'))))) : null,
              h('div', { className: 'kbcts-field' },
                h('label', { htmlFor: 'kbcts-f-name' }, kt('Nom', 'Name')),
                h('input', { id: 'kbcts-f-name', className: 'kbcts-in', 'data-kb': 'contacts-form-name', value: form.name, maxLength: 200, onChange: (e) => set({ name: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }, 'aria-invalid': errs.name !== undefined ? 'true' : undefined }),
                errs.name !== undefined ? h('span', { className: 'err', role: 'alert' }, errs.name) : null),
              h('div', { className: 'kbcts-row2' },
                own.length > 1 || (form.type !== '' && !own.some((t) => t.key === form.type)) ? h('div', { className: 'kbcts-field' }, h('label', { htmlFor: 'kbcts-f-type' }, kt('Type', 'Type')),
                  h('select', { id: 'kbcts-f-type', className: 'kbcts-in', 'data-kb': 'contacts-form-type', value: form.type, onChange: (e) => set({ type: e.target.value }) }, typeOptions)) : null,
                h('div', { className: 'kbcts-field' }, h('label', { htmlFor: 'kbcts-f-email' }, kt('E-mail', 'Email')),
                  h('input', { id: 'kbcts-f-email', className: 'kbcts-in', type: 'email', 'data-kb': 'contacts-form-email', value: form.email, maxLength: 254, onChange: (e) => set({ email: e.target.value }), 'aria-invalid': errs.email !== undefined ? 'true' : undefined }),
                  errs.email !== undefined ? h('span', { className: 'err', role: 'alert' }, errs.email) : null)),
              form.kind === 'person' ? h('div', { className: 'kbcts-field' }, h('label', { htmlFor: 'kbcts-f-company' }, kt('Entreprise', 'Company')),
                h('select', { id: 'kbcts-f-company', className: 'kbcts-in', 'data-kb': 'contacts-form-company', value: form.companyId, onChange: (e) => set({ companyId: e.target.value }) },
                  h('option', { value: '' }, kt('— aucune —', '— none —')),
                  companyOptions.map((c) => h('option', { key: c.id, value: String(c.id) }, c.name)))) : null,
              schema.fields.length > 0 ? h('div', { className: 'kbcts-row2' }, schema.fields.map((f) => {
                const id = 'kbcts-fld-' + f.key
                const bad = errs['f:' + f.key]
                const val = form.fields[f.key] === undefined ? '' : form.fields[f.key]
                const onChange = (e) => set({ fields: Object.assign({}, form.fields, { [f.key]: e.target.value }) })
                const input = f.type === 'choice'
                  ? h('select', { id, className: 'kbcts-in', value: val, onChange, 'data-kb': 'contacts-form-field', 'data-key': f.key }, h('option', { value: '' }, kt('— aucun —', '— none —')), (f.options || []).map((o) => h('option', { key: o, value: o }, o)))
                  : h('input', { id, className: 'kbcts-in', value: val, onChange, 'data-kb': 'contacts-form-field', 'data-key': f.key, type: f.type === 'date' ? 'date' : (f.type === 'email' ? 'email' : (f.type === 'url' ? 'url' : 'text')), inputMode: f.type === 'number' || f.type === 'money' ? 'decimal' : undefined, 'aria-invalid': bad !== undefined ? 'true' : undefined })
                return h('div', { className: 'kbcts-field', key: f.key }, h('label', { htmlFor: id }, fieldLabel(f) + (f.type === 'money' && f.currency ? ' (' + f.currency + ')' : '')), input, bad !== undefined ? h('span', { className: 'err', role: 'alert' }, bad) : null)
              })) : null,
              h('div', { className: 'kbcts-field' }, h('label', { htmlFor: 'kbcts-f-tags' }, kt('Étiquettes', 'Tags')),
                h('input', { id: 'kbcts-f-tags', className: 'kbcts-in', 'data-kb': 'contacts-form-tags', value: form.tags, placeholder: kt('séparées par des virgules', 'separated by commas'), onChange: (e) => set({ tags: e.target.value }) }),
                schema.tags.length > 0 ? h('div', { className: 'kbcts-chips', style: { marginTop: 4 } }, schema.tags.map((t) => h('span', { key: t + (poppedState[0] === t ? '!' : ''), className: 'kbcts-popbox' + (poppedState[0] === t ? ' kz-pop' : '') }, h(Chip, { text: t, on: tagList.indexOf(t) >= 0, onClick: () => toggleTag(t) })))) : null),
              h('div', { className: 'kbcts-foot' },
                h('button', { type: 'button', className: 'kbcts-btn', 'data-kb': 'contacts-form-cancel', onClick: props.onClose }, kt('Annuler', 'Cancel')),
                h('button', { type: 'button', className: 'kbcts-btn primary', 'data-kb': 'contacts-form-save', disabled: busyState[0], onClick: save }, editing ? kt('Enregistrer', 'Save') : (form.kind === 'company' ? kt('Ajouter l’entreprise', 'Add company') : kt('Ajouter le contact', 'Add contact'))))))
        }

        // The confirmation before the sample rows go.
        const ClearDialog = (props) => {
          const busyState = useState(false)
          const problem = useState(null)
          const boxRef = useRef(null)
          useEffect(() => {
            const saved = typeof document !== 'undefined' ? document.activeElement : null
            const first = boxRef.current && boxRef.current.querySelector('[data-kb="contacts-confirm-cancel"]')
            if (first) first.focus()
            return () => { try { if (saved && typeof saved.focus === 'function' && document.contains(saved)) saved.focus() } catch (e) { /* the opener is gone */ } }
          }, [])
          const run = async () => {
            busyState[1](true)
            const r = await call('POST', '/clear-demo', { confirm: true })
            busyState[1](false)
            if (r.ok) props.onDone(r.removed); else problem[1](errorText(r.error, r.detail))
          }
          const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); return }
            if (e.key !== 'Tab' || !boxRef.current) return
            const nodes = Array.from(boxRef.current.querySelectorAll('button:not([disabled])'))
            const first = nodes[0]
            const last = nodes[nodes.length - 1]
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          }
          return h('div', { className: 'kbcts-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbcts-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'kbcts-clr-title', 'aria-describedby': 'kbcts-clr-text', 'data-kb': 'contacts-confirm', ref: boxRef, onKeyDown: onKey },
              h('h2', { id: 'kbcts-clr-title' }, kt('Effacer les données d’exemple ?', 'Clear the sample data?')),
              h('p', { id: 'kbcts-clr-text', style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, kt('Les lignes marquées « demo » disparaissent des Contacts, et aussi des pages Catalog et Pipeline : elles partagent les mêmes données d’exemple. Ce que tu as ajouté toi-même reste.', 'The rows marked “demo” disappear from Contacts, and from the Catalog and Pipeline pages too: they share the same sample data. Whatever you added yourself stays.')),
              problem[0] !== null ? h('div', { className: 'kbcts-alert', role: 'alert' }, problem[0]) : null,
              h('div', { className: 'kbcts-foot' },
                h('button', { type: 'button', className: 'kbcts-btn', 'data-kb': 'contacts-confirm-cancel', onClick: props.onClose }, kt('Garder', 'Keep them')),
                h('button', { type: 'button', className: 'kbcts-btn primary', 'data-kb': 'contacts-confirm-clear', disabled: busyState[0], onClick: run }, kt('Effacer les données d’exemple', 'Clear sample data')))))
        }

        // The panel on one contact.
        const Panel = (props) => {
          const detail = props.detail
          const noteState = useState('')
          const busyState = useState(false)
          const problem = useState(null)
          const closeRef = useRef(null)
          useEffect(() => { if (props.focusOnOpen && closeRef.current) closeRef.current.focus() }, [props.id])
          const schema = props.schema
          const c = detail !== null ? detail.contact : null
          const addNote = async () => {
            if (noteState[0].trim() === '' || busyState[0]) return
            busyState[1](true)
            problem[1](null)
            const r = await call('POST', '/note', { id: props.id, text: noteState[0] })
            busyState[1](false)
            if (r.ok) { noteState[1](''); props.onChanged('note') } else problem[1](errorText(r.error, r.detail))
          }
          const toggleArchive = async () => {
            busyState[1](true)
            problem[1](null)
            const r = await call('POST', c.archived_at === null ? '/archive' : '/restore', { id: props.id })
            busyState[1](false)
            if (r.ok) props.onChanged(c.archived_at === null ? 'archive' : 'restore'); else problem[1](errorText(r.error, r.detail))
          }
          const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
          const shell = (children) => h('aside', { className: 'kbcts-panel' + (props.closing ? ' out' : ''), 'data-kb': 'contacts-panel', 'data-id': props.id, 'aria-label': kt('Détail du contact', 'Contact details'), onKeyDown: onKey },
            h('button', { type: 'button', className: 'kbcts-x', ref: closeRef, 'data-kb': 'contacts-panel-close', 'aria-label': kt('Fermer', 'Close'), onClick: props.onClose }, svg('x', 16)),
            h('div', { className: 'kbcts-pc', key: String(props.id) }, children))
          if (props.state === 'loading' || (detail === null && props.state !== 'error')) return shell(h('div', { 'aria-busy': 'true', role: 'status', className: 'kbcts-muted kbcts-pb', 'data-kb': 'contacts-panel-loading' }, kt('Chargement…', 'Loading…')))
          if (props.state === 'error' || detail === null) return shell(h('div', { className: 'kbcts-pb' }, h('div', { className: 'kbcts-alert', role: 'alert', 'data-kb': 'contacts-panel-error' }, errorText(props.error && props.error.error, props.error && props.error.detail))))
          const hue = hueFor(c)
          const rows = []
          if (c.email !== '') rows.push([kt('E-mail', 'Email'), c.email])
          for (const f of schema.fields) { const v = fieldDisplay(f, c.fields[f.key]); if (v !== '') rows.push([fieldLabel(f), v]) }
          for (const k of Object.keys(c.fields)) if (k !== PICTURE_KEY && !schema.fields.some((f) => f.key === k) && c.fields[k] !== null && c.fields[k] !== '') rows.push([fieldLabel({ key: k }), String(c.fields[k])])
          rows.push([kt('Modifié', 'Updated'), relTime(c.updated_at)])
          const linked = []
          if (detail.company !== null) linked.push(h('li', { key: 'co' }, h('button', { type: 'button', 'data-kb': 'contacts-linked', 'data-id': detail.company.id, onClick: () => props.onOpen(detail.company.id, 'company') }, h(Face, { name: detail.company.name, size: 28, kind: 'company' }), h('span', null, detail.company.name), detail.company.archived ? h('span', { className: 'kbcts-tag' }, kt('archivé', 'archived')) : null)))
          for (const p of detail.people) linked.push(h('li', { key: 'p' + p.id }, h('button', { type: 'button', 'data-kb': 'contacts-linked', 'data-id': p.id, onClick: () => props.onOpen(p.id, 'person') }, h(Face, { name: p.name, size: 28, kind: 'person', image: p.image === null ? undefined : p.image }), h('span', null, p.name))))
          const cards = Array.isArray(detail.cards) ? detail.cards : []
          return shell(h(React.Fragment, null,
            h('div', { className: 'kbcts-hero', style: { '--kbcts-h': hue } },
              h('div', { className: 'head' }, h(Face, { name: c.name, size: 60, kind: c.kind, image: pictureOf(c) }),
                h('div', null, h('h3', null, c.name),
                  h('div', { className: 'meta' }, h(Chip, { text: typeLabel(schema, c), hue, dot: true }), detail.company !== null ? h('span', { className: 'kbcts-co' }, h(CoMark, { name: detail.company.name, size: 16 }), h('span', null, detail.company.name)) : null))),
              c.demo || c.archived_at !== null ? h('div', { className: 'kbcts-tags' }, c.demo ? h('span', { className: 'kbcts-tag demo', 'data-kb': 'contacts-demo-badge' }, 'demo') : null, c.archived_at !== null ? h('span', { className: 'kbcts-tag', 'data-kb': 'contacts-archived-badge' }, kt('Archivé', 'Archived')) : null) : null,
              h('div', { className: 'acts' },
                mailable(c.email) ? h('a', { className: 'kbcts-btn sm', href: 'mailto:' + c.email, 'data-kb': 'contacts-mail' }, Ic('mail', 14), kt('Écrire', 'Email')) : null,
                h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-edit', onClick: () => props.onEdit(c, detail.company) }, Ic('edit', 14), kt('Modifier', 'Edit')))),
            h('div', { className: 'kbcts-pb' },
              h('dl', { className: 'kbcts-dl' }, rows.map((r, i) => h(React.Fragment, { key: i }, h('dt', null, r[0]), h('dd', null, r[1])))),
              c.tags.length > 0 ? h('div', null, h('h4', null, kt('Étiquettes', 'Tags')), h('div', { className: 'kbcts-tags' }, c.tags.map((t) => h(Chip, { key: t, text: t })))) : null,
              h('h4', null, c.kind === 'company' ? kt('Personnes', 'People') : kt('Entreprise', 'Company')),
              linked.length > 0 ? h('ul', { className: 'kbcts-list' }, linked) : h('div', { className: 'kbcts-muted' }, c.kind === 'company' ? kt('Personne n’est rattaché pour l’instant.', 'Nobody is linked yet.') : kt('Aucune entreprise liée.', 'No linked company.')),
              cards.length > 0 ? h('div', null, h('h4', null, kt('Travail lié', 'Linked work')), h('ul', { className: 'kbcts-list' }, cards.map((c) => h('li', { key: c.id, 'data-kb': 'contacts-card' }, h('span', { className: 'kbcts-linkrow' }, Ic('arrow', 14), h('span', { className: 'n' }, c.title), h('span', { className: 'kbcts-muted' }, c.flow + ' · ' + c.stage)))))) : null,
              h('h4', null, 'Notes'),
              h('div', { className: 'kbcts-compose' },
                h('label', { htmlFor: 'kbcts-note', className: 'kbcts-sr' }, kt('Ajouter une note', 'Add a note')),
                h('textarea', { id: 'kbcts-note', className: 'kbcts-in', rows: 2, maxLength: 4000, placeholder: kt('Ajouter une note…', 'Add a note…'), 'data-kb': 'contacts-note-input', value: noteState[0], onChange: (e) => noteState[1](e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote() } } }),
                h('div', { className: 'row' },
                  h('span', { className: 'kbcts-muted', style: { fontSize: 12 } }, kt('Une note ne se modifie pas : elle garde l’historique.', 'A note is not edited: it keeps the history.')),
                  h('button', { type: 'button', className: 'kbcts-btn sm primary', 'data-kb': 'contacts-note-add', disabled: busyState[0] || noteState[0].trim() === '', onClick: addNote }, kt('Ajouter la note', 'Add note')))),
              problem[0] !== null ? h('div', { className: 'kbcts-alert', role: 'alert', style: { marginTop: 8 } }, problem[0]) : null,
              detail.notes.length === 0 ? h('div', { className: 'kbcts-muted', 'data-kb': 'contacts-no-notes', style: { marginTop: 10 } }, kt('Pas encore de note.', 'No notes yet.')) : null,
              h('ul', { className: 'kbcts-tl', 'data-kb': 'contacts-timeline' },
                detail.notes.map((n, i) => h('li', { key: n.id, className: 'kz-in', style: { '--kz-i': Math.min(i, 6), '--kbcts-h': n.actor === 'agent' ? 262 : 212 }, 'data-kb': 'contacts-note' },
                  h('span', { className: 'dot', 'aria-hidden': 'true' }, n.actor === 'agent' ? Ic('sparkle', 13) : Ic('edit', 13)),
                  h('b', null, dateTime(n.created_at) + (n.actor === 'agent' ? ' · ' + kt('agent', 'agent') : '')),
                  h('div', { className: 't' }, n.body))),
                h('li', { key: 'born', className: 'kz-in', style: { '--kz-i': Math.min(detail.notes.length, 6), '--kbcts-h': 146 }, 'data-kb': 'contacts-created' },
                  h('span', { className: 'dot', 'aria-hidden': 'true' }, Ic('plusdot', 13)),
                  h('b', null, kt('Ajouté', 'Added') + ' · ' + dateTime(c.created_at)))),
              h('div', { className: 'kbcts-acts' },
                c.archived_at === null
                  ? h('button', { type: 'button', className: 'kbcts-btn sm quiet', 'data-kb': 'contacts-archive', disabled: busyState[0], onClick: toggleArchive }, Ic('archive', 14), kt('Archiver', 'Archive'))
                  : h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-restore', disabled: busyState[0], onClick: toggleArchive }, Ic('undo', 14), kt('Restaurer', 'Restore'))))))
        }

        // Row actions, shown on hover and on focus: write an email, change the contact. They never open the panel.
        const RowActions = (props) => {
          const r = props.row
          const stop = (e) => { e.stopPropagation() }
          return h('div', { className: 'kbcts-ra' },
            mailable(r.email) ? h('a', { className: 'kbcts-ib', href: 'mailto:' + r.email, 'data-kb': 'contacts-row-mail', title: kt('Écrire un e-mail', 'Send an email'), 'aria-label': kt('Écrire un e-mail à ', 'Send an email to ') + r.name, onClick: stop, onKeyDown: stop }, Ic('mail', 15)) : null,
            h('button', { type: 'button', className: 'kbcts-ib', 'data-kb': 'contacts-row-edit', title: kt('Modifier', 'Edit'), 'aria-label': kt('Modifier ', 'Edit ') + r.name, onClick: (e) => { e.stopPropagation(); props.onEdit(r) }, onKeyDown: stop }, Ic('edit', 15)))
        }
        /** A contact's tags as coloured chips, each one a filter; the others are counted. */
        const RowTags = (props) => {
          const r = props.row
          const shown = r.tags.slice(0, props.max)
          return h(React.Fragment, null,
            shown.map((t) => h('span', { key: t, className: 'kbcts-popbox', 'data-kb': 'contacts-row-tag' }, h(Chip, { text: t, title: kt('Filtrer par cette étiquette', 'Filter by this tag'), on: props.active.indexOf(tagId(t)) >= 0, onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); props.onTag(t) } }))),
            r.tags.length > props.max ? h('span', { className: 'kbcts-more' }, '+' + (r.tags.length - props.max)) : null)
        }

        const Table = (props) => {
          const people = props.kind === 'person'
          return h('div', { className: 'kbcts-tw' }, h('table', { className: 'kbcts-tbl', 'data-kb': 'contacts-table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, kt('Nom', 'Name')),
              h('th', { scope: 'col', className: 'col-type' }, kt('Type', 'Type')),
              people ? h('th', { scope: 'col', className: 'col-co' }, kt('Entreprise', 'Company')) : null,
              h('th', { scope: 'col', className: 'col-tags' }, kt('Étiquettes', 'Tags')),
              h('th', { scope: 'col', className: 'col-upd' }, kt('Modifié', 'Updated')))),
            h('tbody', null, props.rows.map((r, i) => h('tr', { key: r.id, className: 'r kz-in' + (r.archived_at !== null ? ' arch' : ''), style: { '--kz-i': Math.min(i, STAGGER_MAX), '--kbcts-h': hueFor(r) }, tabIndex: 0, 'data-kb': 'contacts-row', 'data-id': r.id, 'data-demo': r.demo ? '1' : '0', 'aria-current': props.openId === r.id ? 'true' : undefined, onClick: () => props.onOpen(r.id), onKeyDown: (e) => props.onKey(e, r.id) },
              h('td', null, h('div', { className: 'kbcts-who' }, h(Face, { name: r.name, size: 38, kind: r.kind, image: pictureOf(r) }),
                h('div', null, h('b', null, h('span', { className: 'n' }, r.name), r.demo ? h('span', { className: 'kbcts-tag demo', 'data-kb': 'contacts-demo-badge' }, 'demo') : null, r.archived_at !== null ? h('span', { className: 'kbcts-tag' }, kt('archivé', 'archived')) : null), h('small', null, r.email !== '' ? r.email : (r.company !== null ? r.company.name : ''))))),
              h('td', { className: 'col-type' }, h(Chip, { text: typeLabel(props.schema, r), hue: hueFor(r), dot: true })),
              people ? h('td', { className: 'col-co' }, r.company !== null ? h('div', { className: 'kbcts-co' }, h(CoMark, { name: r.company.name, size: 18 }), h('span', null, r.company.name)) : h('span', { className: 'kbcts-muted' }, '—')) : null,
              h('td', { className: 'col-tags' }, h('div', { className: 'kbcts-tags' }, h(RowTags, { row: r, max: 2, active: props.activeTags, onTag: props.onTag }))),
              h('td', { className: 'col-upd' }, h('span', { className: 'when kbcts-muted' }, relTime(r.updated_at)), h(RowActions, { row: r, onEdit: props.onEdit })))))))
        }

        const Cards = (props) => h('div', { className: 'kbcts-grid', 'data-kb': 'contacts-cards' }, props.rows.map((r, i) => {
          const hue = hueFor(r)
          return h('div', { key: r.id, className: 'kbcts-cell kz-in', style: { '--kz-i': Math.min(i, STAGGER_MAX) } }, h('article', { className: 'kbcts-card kz-lift' + (r.archived_at !== null ? ' arch' : ''), style: { '--kbcts-h': hue }, tabIndex: 0, 'data-kb': 'contacts-row', 'data-view': 'cards', 'data-id': r.id, 'data-demo': r.demo ? '1' : '0', 'aria-current': props.openId === r.id ? 'true' : undefined, onClick: () => props.onOpen(r.id), onKeyDown: (e) => props.onKey(e, r.id) },
            h('div', { className: 'band' }),
            h('div', { className: 'top' }, r.demo ? h('span', { className: 'kbcts-tag demo', 'data-kb': 'contacts-demo-badge' }, 'demo') : h('span', null), h(RowActions, { row: r, onEdit: props.onEdit })),
            h('div', { className: 'inner' },
              h(Face, { name: r.name, size: 56, kind: r.kind, image: pictureOf(r), className: 'face' + (r.kind === 'company' ? ' co' : '') }),
              h('h3', { title: r.name }, h('span', { className: 'n' }, r.name)),
              r.email !== '' ? h('div', { className: 'mail' }, r.email) : null,
              h('div', { className: 'tags' }, h(Chip, { text: typeLabel(props.schema, r), hue, dot: true }), r.archived_at !== null ? h('span', { className: 'kbcts-tag' }, kt('archivé', 'archived')) : null, h(RowTags, { row: r, max: 3, active: props.activeTags, onTag: props.onTag })),
              h('div', { className: 'foot' },
                r.company !== null ? h('div', { className: 'kbcts-co' }, h(CoMark, { name: r.company.name, size: 18 }), h('span', null, r.company.name)) : h('span', null),
                h('time', { dateTime: r.updated_at }, relTime(r.updated_at))))))
        }))

        // The row under the header: People / Companies, the theme's types as coloured chips, the tags in use, the count, the archived toggle.
        const Strip = (props) => {
          const popState = useState('')
          const pop = popState[0]
          const types = props.options.filter((o) => o.group === 'type')
          const activeTags = props.options.filter((o) => o.group === 'tag' && props.selected.indexOf(o.id) >= 0)
          const kinds = [{ k: 'person', label: kt('Personnes', 'People'), icon: 'users' }, { k: 'company', label: kt('Entreprises', 'Companies'), icon: 'building' }]
          const toggleType = (o) => { popState[1](props.selected.indexOf(o.id) >= 0 ? '' : o.id); props.onToggle(o.id) }
          return h('div', { className: 'kbcts-strip', 'data-kb': 'contacts-strip' },
            h('div', { className: 'kbcts-seg', role: 'group', 'aria-label': kt('Genre', 'Kind') },
              kinds.map((x) => h('button', { key: x.k, type: 'button', 'data-kb': 'contacts-kind', 'data-kind': x.k, 'aria-pressed': props.kind === x.k, onClick: () => props.onKind(x.k) },
                Ic(x.icon, 15), x.label, props.counts !== null ? h('span', { className: 'n' }, props.counts[x.k]) : null))),
            types.length > 1 ? h('div', { className: 'kbcts-fcs', role: 'group', 'aria-label': kt('Type', 'Type') },
              h('button', { type: 'button', className: 'kbcts-fc all', 'data-kb': 'contacts-type', 'data-type': '', 'aria-pressed': !props.selected.some((id) => id.indexOf('t:') === 0), onClick: props.onAllTypes }, kt('Tous', 'All')),
              types.map((o) => h('button', { key: o.id, type: 'button', className: 'kbcts-fc' + (o.count === 0 && props.selected.indexOf(o.id) < 0 ? ' dim' : '') + (pop === o.id ? ' kz-pop' : ''), style: { '--kbcts-h': props.hueOf(o.key) }, 'data-kb': 'contacts-type', 'data-type': o.key, 'aria-pressed': props.selected.indexOf(o.id) >= 0, onClick: () => toggleType(o) },
                h('i', { 'aria-hidden': 'true' }), o.text, h('span', { className: 'n' }, o.count)))) : null,
            activeTags.length > 0 ? h('div', { className: 'kbcts-fcs', role: 'group', 'aria-label': kt('Étiquettes choisies', 'Chosen tags') },
              activeTags.map((o) => h('span', { key: o.id, className: 'kbcts-popbox kz-pop', 'data-kb': 'contacts-active-tag' }, h(Chip, { text: o.text, icon: 'tag', on: true, title: kt('Retirer ce filtre', 'Remove this filter'), onClick: () => props.onToggle(o.id) })))) : null,
            h('div', { className: 'kbcts-end' },
              props.countText !== '' ? h('span', { className: 'kbcts-count', 'data-kb': 'contacts-count', role: 'status' }, props.countText) : null,
              h('button', { type: 'button', className: 'kbcts-fc ghost', 'data-kb': 'contacts-archived', 'aria-pressed': props.archived, onClick: props.onArchived }, Ic('archive', 14), kt('Archivés inclus', 'Show archived')),
              props.anyFilter ? h('button', { type: 'button', className: 'kbcts-link', 'data-kb': 'contacts-clear-filters', onClick: props.onClear }, kt('Effacer les filtres', 'Clear filters')) : null))
        }

        // The bar the page draws itself when the core does not hand over the product's own: the same pieces, with the core's classes.
        const PlainBar = (props) => {
          const openState = useState(false)
          const input = useRef(null)
          const open = openState[0]
          const shown = open || props.state.query.trim().length > 0
          useEffect(() => { if (open) { try { if (input.current !== null) input.current.focus() } catch (e) { /* the person clicks the field */ } } }, [open])
          const word = kt('Rechercher', 'Search')
          const clear = () => { if (props.state.query.length > 0) props.onUpdate({ query: '' }); openState[1](false) }
          const tags = props.options.filter((o) => o.group === 'tag')
          const chosenTag = props.state.types.filter((id) => id.indexOf('g:') === 0)[0] || ''
          return h('div', { className: 'kb6-toolbar', 'data-kb': 'contacts-own-bar' },
            h('div', { className: 'kb6-tb-row' },
              h('div', { className: 'kb6-tb-tools' },
                shown ? null : h('button', { type: 'button', className: 'kb6-tb-ghost', 'data-kb': 'contacts-search-toggle', title: word, 'aria-label': word, 'aria-expanded': 'false', onClick: () => openState[1](true) }, Ic('search', 17)),
                h('div', { className: 'kb6-search kb6-search-inline kb6-tb-search' + (shown ? '' : ' closed'), role: 'search' },
                  Ic('search', 14),
                  h('input', { ref: input, type: 'search', 'data-kb': 'contacts-search', value: props.state.query, maxLength: 200, placeholder: kt('Rechercher un nom ou un e-mail', 'Search a name or an email'), 'aria-label': kt('Rechercher dans les contacts', 'Search contacts'), onChange: (e) => props.onUpdate({ query: e.target.value }), onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); clear() } } }),
                  shown ? h('button', { type: 'button', className: 'kb6-tb-clear', 'data-kb': 'contacts-search-clear', 'aria-label': props.state.query.length > 0 ? kt('Effacer la recherche', 'Clear the search') : word, onClick: clear }, Ic('x', 13)) : null),
                h('div', { className: 'kb6-tb-viewgrp', role: 'group', 'aria-label': kt('Affichage', 'View') }, ['cards', 'list'].map((v) => {
                  const label = v === 'cards' ? kt('Cartes', 'Cards') : kt('Liste', 'List')
                  return h('button', { key: v, type: 'button', className: 'kb6-tb-vbtn lab' + (props.state.viewMode === v ? ' on' : ''), 'data-kb': 'contacts-view', 'data-view': v, 'aria-pressed': props.state.viewMode === v ? 'true' : 'false', onClick: () => props.onUpdate({ viewMode: v }) }, Ic(v === 'cards' ? 'grid' : 'list', 16), h('span', { className: 'kb6-tb-vlab' }, label))
                })),
                tags.length > 0 ? h('select', { className: 'kbcts-in kbcts-sel', 'data-kb': 'contacts-tag', 'aria-label': kt('Filtrer par étiquette', 'Filter by tag'), value: chosenTag, onChange: (e) => props.onUpdate({ types: props.state.types.filter((id) => id.indexOf('g:') !== 0).concat(e.target.value === '' ? [] : [e.target.value]) }) },
                  h('option', { value: '' }, kt('Toutes les étiquettes', 'All tags')), tags.map((o) => h('option', { key: o.id, value: o.id }, o.text))) : null,
                h('select', { className: 'kbcts-in kbcts-sel', 'data-kb': 'contacts-sort', 'aria-label': kt('Trier par', 'Sort by'), value: props.state.sort, onChange: (e) => props.onUpdate({ sort: e.target.value, dir: e.target.value === 'name' ? 'asc' : 'desc' }) },
                  props.sortOptions.map((o) => h('option', { key: o.id, value: o.id }, o.label)))),
              h('div', { className: 'kb6-tb-trailing' }, props.trailing)))
        }

        const ContactsPage = (props) => {
          // The core's bar and its state hook, when it hands them over. The hook keeps the view, the sort and its direction in this browser; the search, the facets and the period
          // are this page's own state, so a visit never opens on a filter nobody remembers.
          const tb = props !== null && props !== undefined && props.toolbar !== null && props.toolbar !== undefined && typeof props.toolbar === 'object' && typeof props.toolbar.KbToolbar === 'function' && typeof props.toolbar.useToolbarState === 'function' ? props.toolbar : null
          const [ownPrefs, setOwnPrefs] = useState(DEFAULT_PREFS)
          const [find, setFind] = useState(NO_FIND)
          const [filters, setFilters] = useState({ kind: 'person', archived: false, offset: 0 })
          const [q, setQ] = useState('')
          const [schema, setSchema] = useState(DEFAULT_SCHEMA)
          const [list, setList] = useState({ status: 'loading', rows: [], total: 0, demo: 0, truncated: false, error: null })
          const [openId, setOpenId] = useState(null)
          const [detail, setDetail] = useState({ state: 'idle', data: null, error: null })
          const [dialog, setDialog] = useState(null)
          const [toast, setToast] = useState(null)
          const [reload, setReload] = useState(0)
          const [, setRedraw] = useState(0)
          const [closing, setClosing] = useState(false)
          const shared = tb !== null ? tb.useToolbarState('contacts', DEFAULT_PREFS) : null
          const prefs = shared !== null ? shared[0] : ownPrefs
          const updPrefs = shared !== null ? shared[1] : (p) => setOwnPrefs((o) => Object.assign({}, o, p))
          const focusPanel = useRef(false)
          const toastTimer = useRef(null)
          const closeTimer = useRef(null)
          const say = (text) => { setToast(text); try { if (toastTimer.current !== null) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4500) } catch (e) { /* no timers */ } }
          try { const k = kitOf(); if (k !== null && typeof k.ensureCss === 'function') k.ensureCss() } catch (e) { /* the kit's motion classes do nothing, the page reads fine */ }

          // The page redraws when the theme's menu words change (the title is the word the menu gives the row).
          useEffect(() => {
            const again = () => setRedraw((n) => n + 1)
            const events = ['kb-domain-change']
            try { events.forEach((ev) => window.addEventListener(ev, again)) } catch (e) { /* no events */ }
            return () => { try { events.forEach((ev) => window.removeEventListener(ev, again)) } catch (e) { /* gone */ } try { if (toastTimer.current !== null) clearTimeout(toastTimer.current); if (closeTimer.current !== null) clearTimeout(closeTimer.current) } catch (e) { /* gone */ } }
          }, [])
          useEffect(() => { let alive = true; call('GET', '/schema').then((r) => { if (alive && r.ok) setSchema(withoutPicture(r.schema)) }); return () => { alive = false } }, [reload])
          // A search waits for the typing to pause; the host searches the names and the emails, the rest is done here.
          useEffect(() => { const t = setTimeout(() => { setQ(find.query.trim()); setFilters((f) => (f.offset === 0 ? f : Object.assign({}, f, { offset: 0 }))) }, 220); return () => clearTimeout(t) }, [find.query])
          useEffect(() => {
            let alive = true
            setList((l) => (l.status === 'ok' ? l : Object.assign({}, l, { status: 'loading' })))
            call('GET', '/list' + query({ q, archived: filters.archived, limit: PAGE_SIZE, offset: filters.offset })).then((r) => {
              if (!alive) return
              if (r.ok) setList({ status: 'ok', rows: r.rows, total: r.total, demo: r.demo, truncated: r.truncated === true, error: null })
              else setList({ status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: r })
            })
            return () => { alive = false }
          }, [q, filters.archived, filters.offset, reload])
          useEffect(() => {
            if (openId === null) { setDetail({ state: 'idle', data: null, error: null }); return undefined }
            let alive = true
            setDetail((d) => (d.data !== null && d.data.contact.id === openId ? d : { state: 'loading', data: null, error: null }))
            call('GET', '/get' + query({ id: openId })).then((r) => {
              if (!alive) return
              if (r.ok) setDetail({ state: 'ok', data: r, error: null })
              else if (r.error === 'not_found') { setOpenId(null) } else setDetail({ state: 'error', data: null, error: r })
            })
            return () => { alive = false }
          }, [openId, reload])

          const switchKind = (kind) => {
            setFilters((f) => (f.kind === kind && f.offset === 0 ? f : Object.assign({}, f, { kind, offset: 0 })))
            // the types of one kind mean nothing to the other; the tags are shared
            setFind((f) => (f.types.some((id) => id.indexOf('t:') === 0) ? Object.assign({}, f, { types: f.types.filter((id) => id.indexOf('g:') === 0) }) : f))
          }
          const open = (id, kind) => {
            focusPanel.current = true
            try { if (closeTimer.current !== null) clearTimeout(closeTimer.current) } catch (e) { /* no timers */ }
            closeTimer.current = null
            setClosing(false)
            if (kind !== undefined && kind !== filters.kind) switchKind(kind)
            setOpenId(id)
          }
          const closePanel = () => {
            const id = openId
            const done = () => {
              closeTimer.current = null
              setClosing(false)
              setOpenId(null)
              try { setTimeout(() => { const row = document.querySelector('[data-kb="contacts-row"][data-id="' + id + '"]'); if (row) row.focus() }, 0) } catch (e) { /* no focus */ }
            }
            if (calmMotion()) { done(); return }
            setClosing(true)
            try { closeTimer.current = setTimeout(done, CLOSE_MS) } catch (e) { done() }
          }
          const periodOf = find.period === '7' || find.period === '30' ? find.period : 'all'
          const anyFilter = q !== '' || find.query.trim() !== '' || find.types.length > 0 || periodOf !== 'all' || filters.archived
          const clearFilters = () => { setQ(''); setFind(NO_FIND); setFilters((f) => ({ kind: f.kind, archived: false, offset: 0 })) }
          const onSaved = (contact, wasEditing) => {
            setDialog(null)
            say(wasEditing ? kt('Contact enregistré.', 'Contact saved.') : (contact.kind === 'company' ? kt('Entreprise ajoutée.', 'Company added.') : kt('Contact ajouté.', 'Contact added.')))
            if (!wasEditing && contact.kind !== filters.kind) switchKind(contact.kind)
            focusPanel.current = false
            setReload((n) => n + 1)
            if (!wasEditing) setOpenId(contact.id)
          }
          const onRowKey = (e, id) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.target !== e.currentTarget) return // a key pressed on an action inside the row belongs to that action
              e.preventDefault(); open(id)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.currentTarget.tagName === 'ARTICLE')) {
              if (e.target !== e.currentTarget) return
              e.preventDefault() // the rows of a list answer the vertical arrows, the cards of a grid the horizontal ones too
              const next = e.key === 'ArrowDown' || e.key === 'ArrowRight'
              const grid = e.currentTarget.tagName === 'ARTICLE'
              const from = grid ? e.currentTarget.parentElement : e.currentTarget
              const near = next ? from.nextElementSibling : from.previousElementSibling
              const sib = grid && near !== null ? near.querySelector('[data-kb="contacts-row"]') : near
              if (sib && typeof sib.focus === 'function') sib.focus()
            }
          }

          // what the bar shows and does
          const sortKey = sortChoice(prefs.sort)
          const dir = prefs.dir === 'asc' ? 'asc' : 'desc'
          const view = prefs.viewMode === 'cards' ? 'cards' : 'list'
          const sortOptions = [
            { id: 'modified', label: kt('Dernière modification', 'Last updated') },
            { id: 'name', label: kt('Nom', 'Name') },
            { id: 'created', label: kt('Date d’ajout', 'Date added') },
            { id: 'type', label: kt('Type', 'Type') },
          ]
          const options = facetOptions(schema, filters.kind, list.rows, find.types)
          const barState = { query: find.query, sort: sortKey, dir, types: find.types, period: periodOf, fav: false, viewMode: view }
          const onBar = (p) => {
            if (p === null || p === undefined || typeof p !== 'object') return
            const f = {}
            if (typeof p.query === 'string') f.query = p.query.slice(0, 200)
            if (Array.isArray(p.types)) f.types = p.types.filter((x) => typeof x === 'string')
            if (p.period === 'all' || p.period === '7' || p.period === '30') f.period = p.period
            if (Object.keys(f).length > 0) setFind((cur) => Object.assign({}, cur, f))
            const pref = {}
            if (typeof p.sort === 'string' && SORTS.indexOf(p.sort) >= 0) pref.sort = p.sort
            if (p.dir === 'asc' || p.dir === 'desc') pref.dir = p.dir
            if (p.viewMode === 'cards' || p.viewMode === 'list') pref.viewMode = p.viewMode
            if (Object.keys(pref).length > 0) updPrefs(pref)
          }
          const toggleFacet = (id) => setFind((cur) => Object.assign({}, cur, { types: toggleId(cur.types, id) }))
          const filterByTag = (tag) => toggleFacet(tagId(tag))

          const title = domainLabel() || kt('Contacts', 'Contacts')
          const addButton = h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'contacts-new', disabled: list.status === 'error', onClick: () => setDialog({ mode: 'new', kind: filters.kind }) }, svg('plus', 15), filters.kind === 'company' ? kt('Nouvelle entreprise', 'New company') : kt('Nouveau contact', 'New contact'))
          // The facet menu: the label of its first group is written by the page's CSS (the core's reads « File type »), the options are coloured like the chips
          const facetMenu = {
            type: {
              options: options.map((o, i) => ({
                id: o.id, count: o.count,
                label: kitOf() !== null
                  ? h('span', { className: o.group === 'tag' && options[i - 1] !== undefined && options[i - 1].group === 'type' ? 'kbcts-first-tag' : undefined }, h(Chip, { text: o.text, hue: o.group === 'type' ? hueForKey(o.key) : undefined, dot: o.group === 'type' }))
                  : o.text,
              })),
            },
            period: true,
          }
          const header = h('header', { className: 'kb6-headrow' },
            h('div', { className: 'kb6-headcol' },
              h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title' }, title), help()),
              h('p', { className: 'kb8-sub' }, kt('Les personnes et les entreprises de ton travail, avec leurs notes. Tout reste sur cet ordinateur.', 'The people and companies of your work, with their notes. Everything stays on this computer.'))),
            tb !== null
              ? h(tb.KbToolbar, { state: barState, onUpdate: onBar, views: ['cards', 'list'], viewLabels: true, showFav: false, searchPlaceholder: kt('Rechercher un nom ou un e-mail', 'Search a name or an email'), sortOptions, facets: facetMenu, trailing: addButton })
              : h(PlainBar, { state: barState, onUpdate: onBar, options, sortOptions, trailing: addButton }))

          const demoBanner = list.status === 'ok' && list.demo > 0
            ? h('div', { className: 'kbcts-banner', 'data-kb': 'contacts-demo-banner' }, Ic('sparkle', 16), h('span', { className: 'kbcts-tag demo' }, 'demo'),
              h('span', { className: 'sp' }, kt('Ces lignes sont des exemples pour essayer la page. Tu peux les effacer d’un geste : ce que tu ajoutes reste.', 'These rows are examples so you can try the page. You can clear them in one go: what you add stays.')),
              h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-clear-demo', onClick: () => setDialog({ mode: 'clear' }) }, kt('Effacer les données d’exemple', 'Clear sample data')))
            : null

          const kindRows = list.rows.filter((r) => r.kind === filters.kind)
          const visible = list.status === 'ok' ? sortRows(filterRows(list.rows, { kind: filters.kind, types: find.types, period: periodOf }), sortKey, dir, schema) : []
          const complete = list.status === 'ok' && list.total <= list.rows.length && filters.offset === 0
          const counts = complete ? { person: list.rows.filter((r) => r.kind === 'person').length, company: list.rows.filter((r) => r.kind === 'company').length } : null
          const wordFor = (n) => (filters.kind === 'company' ? (n === 1 ? kt('entreprise', 'company') : kt('entreprises', 'companies')) : (n === 1 ? kt('personne', 'person') : kt('personnes', 'people')))
          const narrowed = visible.length !== kindRows.length
          const countText = list.status === 'ok' && (kindRows.length > 0 || anyFilter)
            ? visible.length + (narrowed ? kt(' sur ', ' of ') + kindRows.length : '') + ' ' + wordFor(narrowed ? 2 : visible.length) + (list.total > list.rows.length + filters.offset ? ' +' : '')
            : ''
          const strip = h(Strip, { kind: filters.kind, onKind: switchKind, counts, options, selected: find.types, onToggle: toggleFacet, onAllTypes: () => setFind((cur) => Object.assign({}, cur, { types: cur.types.filter((id) => id.indexOf('t:') !== 0) })), hueOf: hueForKey,
            archived: filters.archived, onArchived: () => setFilters((f) => Object.assign({}, f, { archived: !f.archived, offset: 0 })), anyFilter, onClear: clearFilters, countText })

          let body
          if (list.status === 'loading') {
            body = h('div', null, h('div', { role: 'status', 'data-kb': 'contacts-loading', className: 'kbcts-muted', style: { margin: '0 0 8px' } }, kt('Chargement des contacts…', 'Loading contacts…')), h(Bones))
          } else if (list.status === 'error') {
            body = h('div', { className: 'kbcts-banner warn', role: 'alert', 'data-kb': 'contacts-error' }, Ic('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les contacts ne sont pas lisibles pour l’instant.', 'Contacts cannot be read right now.')), ' ', errorText(list.error.error, list.error.detail)),
              h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-retry', onClick: () => setReload((n) => n + 1) }, kt('Réessayer', 'Try again')))
          } else if (visible.length === 0) {
            const art = (() => { const k = kitOf(); try { return k !== null && typeof k.Art === 'function' ? h('div', { className: 'pic kz-img', 'aria-hidden': 'true' }, h(k.Art, { spec: 'art:desk/contacts' })) : null } catch (e) { return null } })()
            body = anyFilter || kindRows.length > 0
              ? h('div', { className: 'kbcts-empty', 'data-kb': 'contacts-empty', 'data-why': 'filtered' }, art, h('b', null, kt('Aucun contact ne correspond.', 'No contact matches.')), h('span', null, kt('Essaie une autre recherche, ou efface les filtres.', 'Try another search, or clear the filters.')), h('button', { type: 'button', className: 'kbcts-btn sm', onClick: clearFilters }, kt('Effacer les filtres', 'Clear filters')))
              : h('div', { className: 'kbcts-empty', 'data-kb': 'contacts-empty', 'data-why': 'none' }, art,
                h('b', null, filters.kind === 'company' ? kt('Pas encore d’entreprise', 'No companies yet') : kt('Pas encore de contact', 'No contacts yet')),
                h('span', null, kt('Ajoute la première fiche, ou demande à un agent de le faire : il te demandera ton accord avant d’écrire.', 'Add the first one, or ask an agent to: it will ask for your approval before writing.')),
                h('span', { className: 'kbcts-muted' }, kt('Un thème peut apporter quelques lignes d’exemple pour essayer.', 'A theme can bring a few sample rows to try things out.')),
                h('button', { type: 'button', className: 'kbcts-btn primary', 'data-kb': 'contacts-empty-new', onClick: () => setDialog({ mode: 'new', kind: filters.kind }) }, svg('plus', 14), filters.kind === 'company' ? kt('Ajouter une entreprise', 'Add a company') : kt('Ajouter un contact', 'Add a contact')))
          } else {
            const first = filters.offset + 1
            const last = filters.offset + list.rows.length
            const shared2 = { rows: visible, schema, openId, activeTags: find.types, onOpen: (id) => open(id), onKey: onRowKey, onTag: filterByTag, onEdit: (r) => setDialog({ mode: 'edit', contact: r, company: r.company }) }
            body = h(React.Fragment, null,
              view === 'cards' ? h(Cards, shared2) : h(Table, Object.assign({ kind: filters.kind }, shared2)),
              list.total > PAGE_SIZE || filters.offset > 0 ? h('div', { className: 'kbcts-pager', 'data-kb': 'contacts-pager' },
                h('span', null, first + '–' + last + ' / ' + list.total),
                h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-pager-prev', disabled: filters.offset === 0, onClick: () => setFilters((f) => Object.assign({}, f, { offset: Math.max(0, f.offset - PAGE_SIZE) })) }, kt('Précédent', 'Previous')),
                h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-pager-next', disabled: last >= list.total, onClick: () => setFilters((f) => Object.assign({}, f, { offset: f.offset + PAGE_SIZE })) }, kt('Suivant', 'Next'))) : null)
          }

          const panel = openId !== null
            ? h(Panel, { key: 'panel', id: openId, state: detail.state, detail: detail.data, error: detail.error, schema, closing, focusOnOpen: focusPanel.current, onClose: closePanel, onOpen: open,
              onEdit: (contact, company) => setDialog({ mode: 'edit', contact, company }),
              onChanged: (what) => { focusPanel.current = false; if (what === 'note') say(kt('Note ajoutée.', 'Note added.')); else if (what === 'archive') say(kt('Contact archivé. Il reste dans « Archivés inclus ».', 'Contact archived. It stays under “Show archived”.')); else say(kt('Contact restauré.', 'Contact restored.')); setReload((n) => n + 1) } })
            : null

          return h('div', { className: 'kbcts', 'data-kb': 'contacts-page', 'data-view': view, style: { '--kbcts-facet': JSON.stringify(kt('Type et étiquettes', 'Type and tags')) } },
            h('style', { 'data-plugin': '@local/kybernos-contacts' }, CSS),
            h('div', { className: 'kbcts-main' },
              header,
              demoBanner,
              strip,
              h('div', { className: 'kbcts-body' + (panel !== null ? ' has-panel' : '') }, h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 } }, body), panel)),
            toast !== null ? h('div', { className: 'kbcts-toast', role: 'status', 'data-kb': 'contacts-toast' }, Ic('check', 15), toast) : null,
            dialog !== null && dialog.mode === 'clear' ? h(ClearDialog, { onClose: () => setDialog(null), onDone: (removed) => { setDialog(null); setOpenId(null); say(kt('Données d’exemple effacées.', 'Sample data cleared.')); setReload((n) => n + 1) } }) : null,
            dialog !== null && dialog.mode !== 'clear' ? h(ContactDialog, { key: dialog.mode + (dialog.contact ? dialog.contact.id : ''), schema, kind: dialog.kind || filters.kind, contact: dialog.contact, company: dialog.company, onClose: () => setDialog(null), onSaved }) : null)
        }
        return ContactsPage
      }

      // ── mount ──────────────────────────────────────────────────────────────────────────────────────────────────────────
      const start = (ctx) => {
        try {
          const React = typeof require === 'function' ? require('react') : null
          if (React === null || React === undefined) return
          const slots = ctx.slots
          if (slots === null || slots === undefined || typeof slots.inject !== 'function') return
          const Page = build(React)
          // The row of the menu: declared here, taken back when the plugin is switched off (the group disappears with its last row). The core publishes
          // its registry when IT is applied, and the order in which two plugins are applied is DSH's (measured in a sandbox: this plugin was applied first and
          // found no registry), so the row waits for the registry instead of assuming it is there.
          ctx.effect(() => {
            let off = null
            let timer = null
            let tries = 0
            const declare = () => {
              timer = null
              try {
                if (window.__KB_MENU__ && typeof window.__KB_MENU__.register === 'function') { off = window.__KB_MENU__.register({ id: ROW_ID, group: 'business', icon: 'users', labelKey: 'business.contacts', label: { en: 'Contacts', fr: 'Contacts' }, order: 10 }); return }
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
          }, 'kybernos-contacts: menu row')
          ctx.effect(() => slots.inject(SLOT, () => slots.register({ name: SLOT, key: ROW_ID }, Page)), 'kybernos-contacts: page')
        } catch (e) { console.warn('[kybernos-contacts] page not mounted:', e) }
      }

      return {
        name: NAME,
        inject: ['slots'],
        apply: start,
        __test: { PICTURE_KEY, pictureOf, withoutPicture, kt, tx, lang, initials, relTime, kindLabel, typeLabel, typesOf, fieldLabel, fieldDisplay, errorText, checkForm, formBody, emptyForm, tagChoices, domainLabel, query, build, CSS, ICONS, ROW_ID, SLOT, filterRows, sortRows, facetOptions, typeId, tagId, toggleId, sortChoice, hueFor, SORTS, PAGE_SIZE }
      }
    } catch (e) {
      console.warn('[kybernos-contacts] disabled:', e)
      return { apply () {} }
    }
  }
})
