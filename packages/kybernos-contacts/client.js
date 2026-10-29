// ═══════════════════════════════════════════════════════
// kybernos-contacts — browser half: the Contacts page of the « Business » group.
//
// A list of the people and companies of the person's work, with search, a kind switch (People / Companies), the theme's types and tags as filters, a
// detail panel (fields, linked company or people, notes that are added and never edited), and a dialog to add or change a contact. The words
// (types, fields, tags) come from the active theme through the host's /schema route; with no theme there are plain defaults.
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
      const PAGE_SIZE = 100
      const MENU_WAIT_MS = 250
      const MENU_TRIES = 120 // the core's registry is waited for 30 s at most

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

      // ── styles: DSH's tokens only ───────────────────────────────────────────────────────────────────────────────────────
      const CSS = `
        .kbcts{container:kbcts-page / inline-size;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:13.5px;min-width:0}
        .kbcts *{box-sizing:border-box}
        .kbcts button{font:inherit}
        .kbcts :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbcts .kb6-headrow .kb8-primary{gap:7px}
        .kbcts .kb8-primary[disabled]{opacity:.5;cursor:not-allowed;filter:none}
        .kbcts-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
        .kbcts-search{position:relative;display:inline-flex;align-items:center;flex:1 1 220px;max-width:340px;min-width:0}
        .kbcts-search svg{position:absolute;left:11px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
        .kbcts-in{height:36px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:13.5px;min-width:0}
        .kbcts-in::placeholder{color:var(--dsw-alias-label-tertiary)}
        .kbcts-in:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
        .kbcts-search .kbcts-in{padding-left:34px}
        textarea.kbcts-in{height:auto;padding:9px 12px;resize:vertical;line-height:1.45}
        select.kbcts-in{padding-right:8px}
        .kbcts-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
        .kbcts-seg button{padding:5px 14px;border:none;border-radius:9px;background:transparent;font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}
        .kbcts-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}
        .kbcts-chips{display:flex;flex-wrap:wrap;gap:6px}
        .kbcts-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:6px 13px;font-size:12.5px;cursor:pointer;white-space:nowrap}
        .kbcts-chip:hover{border-color:var(--dsw-alias-border-l2)}
        .kbcts-chip[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
        .kbcts-link{border:none;background:transparent;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;padding:4px 6px;font-size:12.5px}
        .kbcts-link:hover{color:var(--dsw-alias-label-primary)}
        .kbcts-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-weight:550;font-size:13px;cursor:pointer;white-space:nowrap}
        .kbcts-btn:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbcts-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:650}
        .kbcts-btn.primary:hover{filter:brightness(.96)}
        .kbcts-btn.sm{height:30px;padding:0 11px;font-size:12.5px}
        .kbcts-btn[disabled]{opacity:.5;cursor:not-allowed}
        .kbcts-count{margin-inline-start:auto;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
        .kbcts-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
        .kbcts-banner.warn{border-color:var(--dsw-alias-state-warn-primary)}
        .kbcts-banner.warn svg{color:var(--dsw-alias-state-warn-primary)}
        .kbcts-banner .sp{flex:1 1 220px;min-width:0}
        .kbcts-banner b{color:var(--dsw-alias-label-primary)}
        .kbcts-body{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
        .kbcts-body.has-panel{grid-template-columns:minmax(0,1fr) 340px}
        .kbcts-tw{container:kbcts-table / inline-size;overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
        .kbcts-tbl{width:100%;border-collapse:collapse;table-layout:fixed}
        .kbcts-tbl .col-type{width:118px}
        .kbcts-tbl .col-tags{width:210px}
        .kbcts-tbl .col-upd{width:112px}
        .kbcts-tbl td{overflow:hidden}
        .kbcts-tbl .col-tags .kbcts-tags{flex-wrap:nowrap;overflow:hidden}
        .kbcts-tbl .col-tags .kbcts-tag{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
        .kbcts-more{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbcts-tbl th{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-weight:650;text-align:left;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
        .kbcts-tbl td{padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
        .kbcts-tbl tbody tr:last-child td{border-bottom:none}
        .kbcts-tbl tr.r{cursor:pointer}
        .kbcts-tbl tr.r:hover td{background:var(--dsw-alias-bg-layer-2)}
        .kbcts-tbl tr.r[aria-current="true"] td{background:var(--dsw-alias-bg-layer-2)}
        .kbcts-tbl tr.r:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
        .kbcts-tbl tr.arch td{opacity:.6}
        .kbcts-who{display:flex;align-items:center;gap:11px;min-width:0}
        .kbcts-av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);flex:none}
        .kbcts-av.co{border-radius:9px}
        .kbcts-av.lg{width:52px;height:52px;font-size:17px}
        .kbcts-who b{display:flex;align-items:center;gap:7px;font-weight:600;min-width:0}
        .kbcts-who b span.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-who small{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbcts-who>div{min-width:0}
        .kbcts-tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border:none}
        button.kbcts-tag{cursor:pointer}
        button.kbcts-tag:hover{color:var(--dsw-alias-label-primary)}
        .kbcts-tag.demo{background:transparent;border:1px dashed var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));font-weight:600;font-size:11px;padding:1px 8px}
        .kbcts-tags{display:flex;flex-wrap:wrap;gap:5px}
        .kbcts-muted{color:var(--dsw-alias-label-tertiary)}
        .kbcts-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:34px 20px;text-align:center;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:center;gap:10px}
        .kbcts-empty b{font-size:15px;color:var(--dsw-alias-label-primary)}
        .kbcts-bone{display:block;border-radius:8px;background:var(--dsw-alias-bg-skeleton,var(--dsw-alias-bg-layer-3));animation:kbctspulse 1.4s ease-in-out infinite}
        @keyframes kbctspulse{50%{opacity:.5}}
        @media (prefers-reduced-motion:reduce){.kbcts-bone{animation:none}}
        .kbcts-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
        .kbcts-panel{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:18px 18px 22px;display:flex;flex-direction:column;gap:6px;min-width:0}
        .kbcts-panel h3{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
        .kbcts-panel .sub{color:var(--dsw-alias-label-secondary);margin-top:2px}
        .kbcts-x{position:absolute;top:10px;inset-inline-end:10px;width:30px;height:30px;border-radius:8px;border:none;background:transparent;display:grid;place-items:center;color:var(--dsw-alias-label-secondary);cursor:pointer}
        .kbcts-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
        .kbcts-panel .head{display:flex;gap:12px;align-items:center;padding-inline-end:30px}
        .kbcts-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 14px;margin:12px 0 0}
        .kbcts-dl dt{color:var(--dsw-alias-label-tertiary)}
        .kbcts-dl dd{margin:0;overflow-wrap:anywhere}
        .kbcts-panel h4{margin:16px 0 6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-weight:650}
        .kbcts-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
        .kbcts-list li button{width:100%;display:flex;gap:8px;align-items:center;text-align:left;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
        .kbcts-list li button:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbcts-linkrow{display:flex;gap:8px;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;font-size:13px;min-width:0}
        .kbcts-linkrow .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
        .kbcts-notes{border-inline-start:2px solid var(--dsw-alias-border-l1);padding-inline-start:12px;display:flex;flex-direction:column;gap:10px;margin:0;list-style:none}
        .kbcts-notes b{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600;display:block}
        .kbcts-notes div{white-space:pre-wrap;overflow-wrap:anywhere}
        .kbcts-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .kbcts-toast{position:sticky;bottom:12px;align-self:flex-start;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted);border-radius:10px;padding:8px 14px;font-size:13px;z-index:2}
        .kbcts-scrim{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent);display:grid;place-items:center;padding:16px}
        .kbcts-dialog{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:14px}
        .kbcts-dialog h2{margin:0;font-size:18px;font-weight:700}
        .kbcts-field{display:flex;flex-direction:column;gap:5px;min-width:0}
        .kbcts-field label,.kbcts-field .lbl{font-size:12.5px;font-weight:600}
        .kbcts-field .err{color:var(--dsw-alias-state-error-primary);font-size:12px}
        .kbcts-field .hint{color:var(--dsw-alias-label-tertiary);font-size:12px}
        .kbcts-row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
        .kbcts-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px}
        .kbcts-alert{padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-size:13px}
        @container kbcts-page (max-width:760px){
          .kbcts-body.has-panel{grid-template-columns:minmax(0,1fr)}
          .kbcts-body.has-panel .kbcts-tw,.kbcts-body.has-panel .kbcts-pager{display:none}
          .kbcts-panel{position:relative;top:auto;max-height:none;overflow-y:visible}
        }
        @container kbcts-page (max-width:560px){
          .kbcts-search{max-width:none;flex-basis:100%}
          .kbcts-count{margin-inline-start:0}
        }
        @container kbcts-table (max-width:700px){
          .kbcts-tbl .col-tags{display:none}
        }
        @container kbcts-table (max-width:470px){
          .kbcts-tbl .col-upd{display:none}
        }
      `

      // ── icons: a few paths, drawn in the colour of the text ────────────────────────────────────────────────────────────
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
      }

      // ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useRef } = React
        const Ic = (name, size) => h('svg', { width: size || 15, height: size || 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }, (ICONS[name] || []).map((d, i) => h('path', { key: i, d })))
        const help = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-contacts' }) : null)
        const DEFAULT_SCHEMA = { themed: false, themes: [], types: [{ key: 'person', kind: 'person', label: { en: 'Person', fr: 'Personne' } }, { key: 'company', kind: 'company', label: { en: 'Company', fr: 'Entreprise' } }], fields: [], tags: [] }

        const Bones = () => h('div', { className: 'kbcts-tw', 'aria-busy': 'true' }, [0, 1, 2, 3, 4].map((i) => h('div', { key: i, style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px', borderBottom: i < 4 ? '1px solid var(--dsw-alias-border-l1)' : 'none' } },
          h('span', { className: 'kbcts-bone', style: { width: 32, height: 32, borderRadius: '50%', flex: 'none' } }),
          h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 } }, h('span', { className: 'kbcts-bone', style: { width: '38%', height: 12 } }), h('span', { className: 'kbcts-bone', style: { width: '24%', height: 10 } })),
          h('span', { className: 'kbcts-bone', style: { width: 70, height: 18 } }))))

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
          const text = (id, label, key, extra) => h('div', { className: 'kbcts-field' },
            h('label', { htmlFor: id }, label),
            h('input', Object.assign({ id, className: 'kbcts-in', value: form[key], onChange: (e) => set({ [key]: e.target.value }), 'aria-invalid': errs[key] !== undefined ? 'true' : undefined }, extra)),
            errs[key] !== undefined ? h('span', { className: 'err', role: 'alert' }, errs[key]) : null)
          const typeOptions = own.map((t) => h('option', { key: t.key, value: t.key }, tx(t.label, t.key)))
          if (form.type !== '' && !own.some((t) => t.key === form.type)) typeOptions.push(h('option', { key: form.type, value: form.type }, form.type + ' ' + kt('(hors thème)', '(not in the theme)')))
          const companyOptions = companiesState[0].filter((c) => !editing || c.id !== props.contact.id)
          if (form.companyId !== '' && !companyOptions.some((c) => String(c.id) === form.companyId) && props.company) companyOptions.push({ id: props.company.id, name: props.company.name })
          const tagList = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          const toggleTag = (t) => set({ tags: (tagList.indexOf(t) >= 0 ? tagList.filter((x) => x !== t) : tagList.concat([t])).join(', ') })
          const title = editing ? kt('Modifier le contact', 'Edit contact') : (form.kind === 'company' ? kt('Nouvelle entreprise', 'New company') : kt('Nouveau contact', 'New contact'))
          return h('div', { className: 'kbcts-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
            h('div', { className: 'kbcts-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbcts-dlg-title', 'data-kb': 'contacts-dialog', ref: boxRef, onKeyDown: onKey },
              h('h2', { id: 'kbcts-dlg-title' }, title),
              problem[0] !== null ? h('div', { className: 'kbcts-alert', role: 'alert', 'data-kb': 'contacts-form-error' }, problem[0]) : null,
              !editing ? h('div', { className: 'kbcts-field' }, h('span', { className: 'lbl', id: 'kbcts-kind-lbl' }, kt('Genre', 'Kind')),
                h('div', { className: 'kbcts-seg', role: 'group', 'aria-labelledby': 'kbcts-kind-lbl', style: { alignSelf: 'flex-start' } },
                  ['person', 'company'].map((k) => h('button', { key: k, type: 'button', 'aria-pressed': form.kind === k, 'data-kb': 'contacts-form-kind', 'data-kind': k, onClick: () => { const t = typesOf(schema, k); set({ kind: k, type: t.length > 0 ? t[0].key : '', companyId: k === 'company' ? '' : form.companyId }) } }, k === 'company' ? kt('Entreprise', 'Company') : kt('Personne', 'Person'))))) : null,
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
                schema.tags.length > 0 ? h('div', { className: 'kbcts-chips', style: { marginTop: 4 } }, schema.tags.map((t) => h('button', { key: t, type: 'button', className: 'kbcts-chip', 'aria-pressed': tagList.indexOf(t) >= 0, onClick: () => toggleTag(t) }, t))) : null),
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
          const shell = (children) => h('aside', { className: 'kbcts-panel', 'data-kb': 'contacts-panel', 'data-id': props.id, 'aria-label': kt('Détail du contact', 'Contact details'), onKeyDown: onKey },
            h('button', { type: 'button', className: 'kbcts-x', ref: closeRef, 'data-kb': 'contacts-panel-close', 'aria-label': kt('Fermer', 'Close'), onClick: props.onClose }, Ic('x', 16)), children)
          if (props.state === 'loading' || (detail === null && props.state !== 'error')) return shell(h('div', { 'aria-busy': 'true', role: 'status', className: 'kbcts-muted', 'data-kb': 'contacts-panel-loading' }, kt('Chargement…', 'Loading…')))
          if (props.state === 'error' || detail === null) return shell(h('div', { className: 'kbcts-alert', role: 'alert', 'data-kb': 'contacts-panel-error' }, errorText(props.error && props.error.error, props.error && props.error.detail)))
          const rows = []
          if (c.email !== '') rows.push([kt('E-mail', 'Email'), c.email])
          for (const f of schema.fields) { const v = fieldDisplay(f, c.fields[f.key]); if (v !== '') rows.push([fieldLabel(f), v]) }
          for (const k of Object.keys(c.fields)) if (!schema.fields.some((f) => f.key === k) && c.fields[k] !== null && c.fields[k] !== '') rows.push([fieldLabel({ key: k }), String(c.fields[k])])
          rows.push([kt('Modifié', 'Updated'), relTime(c.updated_at)])
          const linked = []
          if (detail.company !== null) linked.push(h('li', { key: 'co' }, h('button', { type: 'button', 'data-kb': 'contacts-linked', 'data-id': detail.company.id, onClick: () => props.onOpen(detail.company.id, 'company') }, Ic('building', 14), h('span', null, detail.company.name), detail.company.archived ? h('span', { className: 'kbcts-tag' }, kt('archivé', 'archived')) : null)))
          for (const p of detail.people) linked.push(h('li', { key: 'p' + p.id }, h('button', { type: 'button', 'data-kb': 'contacts-linked', 'data-id': p.id, onClick: () => props.onOpen(p.id, 'person') }, h('span', { className: 'kbcts-av', style: { width: 22, height: 22, fontSize: 9 } }, initials(p.name)), h('span', null, p.name))))
          const cards = Array.isArray(detail.cards) ? detail.cards : []
          return shell(h(React.Fragment, null,
            h('div', { className: 'head' }, h('span', { className: 'kbcts-av lg' + (c.kind === 'company' ? ' co' : '') }, initials(c.name)), h('div', { style: { minWidth: 0 } }, h('h3', null, c.name), h('div', { className: 'sub' }, typeLabel(schema, c) + (detail.company !== null ? ' · ' + detail.company.name : '')))),
            h('div', { className: 'kbcts-tags', style: { marginTop: 8 } }, c.demo ? h('span', { className: 'kbcts-tag demo', 'data-kb': 'contacts-demo-badge' }, 'demo') : null, c.archived_at !== null ? h('span', { className: 'kbcts-tag', 'data-kb': 'contacts-archived-badge' }, kt('Archivé', 'Archived')) : null),
            h('dl', { className: 'kbcts-dl' }, rows.map((r, i) => h(React.Fragment, { key: i }, h('dt', null, r[0]), h('dd', null, r[1])))),
            c.tags.length > 0 ? h('div', null, h('h4', null, kt('Étiquettes', 'Tags')), h('div', { className: 'kbcts-tags' }, c.tags.map((t) => h('span', { key: t, className: 'kbcts-tag' }, t)))) : null,
            h('h4', null, c.kind === 'company' ? kt('Personnes', 'People') : kt('Entreprise', 'Company')),
            linked.length > 0 ? h('ul', { className: 'kbcts-list' }, linked) : h('div', { className: 'kbcts-muted' }, c.kind === 'company' ? kt('Personne n’est rattaché pour l’instant.', 'Nobody is linked yet.') : kt('Aucune entreprise liée.', 'No linked company.')),
            cards.length > 0 ? h('div', null, h('h4', null, kt('Travail lié', 'Linked work')), h('ul', { className: 'kbcts-list' }, cards.map((c) => h('li', { key: c.id, 'data-kb': 'contacts-card' }, h('span', { className: 'kbcts-linkrow' }, Ic('arrow', 14), h('span', { className: 'n' }, c.title), h('span', { className: 'kbcts-muted' }, c.flow + ' · ' + c.stage)))))) : null,
            h('h4', null, 'Notes'),
            detail.notes.length > 0 ? h('ul', { className: 'kbcts-notes' }, detail.notes.map((n) => h('li', { key: n.id, 'data-kb': 'contacts-note' }, h('b', null, dateTime(n.created_at) + (n.actor === 'agent' ? ' · ' + kt('agent', 'agent') : '')), h('div', null, n.body)))) : h('div', { className: 'kbcts-muted', 'data-kb': 'contacts-no-notes' }, kt('Pas encore de note.', 'No notes yet.')),
            h('div', { className: 'kbcts-field', style: { marginTop: 10 } },
              h('label', { htmlFor: 'kbcts-note' }, kt('Ajouter une note', 'Add a note')),
              h('textarea', { id: 'kbcts-note', className: 'kbcts-in', rows: 2, maxLength: 4000, 'data-kb': 'contacts-note-input', value: noteState[0], onChange: (e) => noteState[1](e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote() } } }),
              h('span', { className: 'hint' }, kt('Une note ne se modifie pas : elle garde l’historique.', 'A note is not edited: it keeps the history.'))),
            problem[0] !== null ? h('div', { className: 'kbcts-alert', role: 'alert', style: { marginTop: 8 } }, problem[0]) : null,
            h('div', { className: 'kbcts-acts' },
              h('button', { type: 'button', className: 'kbcts-btn sm primary', 'data-kb': 'contacts-note-add', disabled: busyState[0] || noteState[0].trim() === '', onClick: addNote }, kt('Ajouter la note', 'Add note')),
              h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-edit', onClick: () => props.onEdit(c, detail.company) }, Ic('edit', 14), kt('Modifier', 'Edit')),
              c.archived_at === null
                ? h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-archive', disabled: busyState[0], onClick: toggleArchive }, Ic('archive', 14), kt('Archiver', 'Archive'))
                : h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-restore', disabled: busyState[0], onClick: toggleArchive }, Ic('undo', 14), kt('Restaurer', 'Restore')))))
        }

        const ContactsPage = () => {
          const [filters, setFilters] = useState({ kind: 'person', type: '', tag: '', archived: false, offset: 0 })
          const [qInput, setQInput] = useState('')
          const [q, setQ] = useState('')
          const [schema, setSchema] = useState(DEFAULT_SCHEMA)
          const [list, setList] = useState({ status: 'loading', rows: [], total: 0, demo: 0, truncated: false, error: null })
          const [openId, setOpenId] = useState(null)
          const [detail, setDetail] = useState({ state: 'idle', data: null, error: null })
          const [dialog, setDialog] = useState(null)
          const [toast, setToast] = useState(null)
          const [reload, setReload] = useState(0)
          const [, setRedraw] = useState(0)
          const focusPanel = useRef(false)
          const toastTimer = useRef(null)
          const say = (text) => { setToast(text); try { if (toastTimer.current !== null) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4500) } catch (e) { /* no timers */ } }

          // The page redraws when the theme's menu words change (the title is the word the menu gives the row).
          useEffect(() => {
            const again = () => setRedraw((n) => n + 1)
            const events = ['kb-domain-change']
            try { events.forEach((ev) => window.addEventListener(ev, again)) } catch (e) { /* no events */ }
            return () => { try { events.forEach((ev) => window.removeEventListener(ev, again)) } catch (e) { /* gone */ } try { if (toastTimer.current !== null) clearTimeout(toastTimer.current) } catch (e) { /* gone */ } }
          }, [])
          useEffect(() => { let alive = true; call('GET', '/schema').then((r) => { if (alive && r.ok) setSchema(r.schema) }); return () => { alive = false } }, [reload])
          // A search waits for the typing to pause.
          useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setFilters((f) => (f.offset === 0 ? f : Object.assign({}, f, { offset: 0 }))) }, 220); return () => clearTimeout(t) }, [qInput])
          useEffect(() => {
            let alive = true
            setList((l) => (l.status === 'ok' ? l : Object.assign({}, l, { status: 'loading' })))
            call('GET', '/list' + query({ q, kind: filters.kind, type: filters.type, tag: filters.tag, archived: filters.archived, limit: PAGE_SIZE, offset: filters.offset })).then((r) => {
              if (!alive) return
              if (r.ok) setList({ status: 'ok', rows: r.rows, total: r.total, demo: r.demo, truncated: r.truncated === true, error: null })
              else setList({ status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: r })
            })
            return () => { alive = false }
          }, [q, filters.kind, filters.type, filters.tag, filters.archived, filters.offset, reload])
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

          const open = (id, kind) => {
            focusPanel.current = true
            if (kind !== undefined && kind !== filters.kind) setFilters((f) => Object.assign({}, f, { kind, type: '', offset: 0 }))
            setOpenId(id)
          }
          const closePanel = () => {
            const id = openId
            setOpenId(null)
            try { setTimeout(() => { const row = document.querySelector('[data-kb="contacts-row"][data-id="' + id + '"]'); if (row) row.focus() }, 0) } catch (e) { /* no focus */ }
          }
          const patch = (p) => setFilters((f) => Object.assign({}, f, p, { offset: p.offset === undefined ? 0 : p.offset }))
          const anyFilter = q !== '' || filters.type !== '' || filters.tag !== '' || filters.archived
          const clearFilters = () => { setQInput(''); setQ(''); setFilters((f) => ({ kind: f.kind, type: '', tag: '', archived: false, offset: 0 })) }
          const onSaved = (contact, wasEditing) => {
            setDialog(null)
            say(wasEditing ? kt('Contact enregistré.', 'Contact saved.') : (contact.kind === 'company' ? kt('Entreprise ajoutée.', 'Company added.') : kt('Contact ajouté.', 'Contact added.')))
            if (!wasEditing && contact.kind !== filters.kind) setFilters((f) => Object.assign({}, f, { kind: contact.kind, type: '', offset: 0 }))
            focusPanel.current = false
            setReload((n) => n + 1)
            if (!wasEditing) setOpenId(contact.id)
          }
          const onRowKey = (e, id) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id) } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
              if (sib && typeof sib.focus === 'function') sib.focus()
            }
          }

          const title = domainLabel() || kt('Contacts', 'Contacts')
          const header = h('header', { className: 'kb6-headrow' },
            h('div', { className: 'kb6-headcol' },
              h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title' }, title), help()),
              h('p', { className: 'kb8-sub' }, kt('Les personnes et les entreprises de ton travail, avec leurs notes. Tout reste sur cet ordinateur.', 'The people and companies of your work, with their notes. Everything stays on this computer.'))),
            h('div', { className: 'kb6-headacts' },
              h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'contacts-new', disabled: list.status === 'error', onClick: () => setDialog({ mode: 'new', kind: filters.kind }) }, Ic('plus', 15), filters.kind === 'company' ? kt('Nouvelle entreprise', 'New company') : kt('Nouveau contact', 'New contact'))))

          const own = typesOf(schema, filters.kind)
          const tags = tagChoices(schema, list.rows)
          const tools = h('div', { className: 'kbcts-tools', role: 'search' },
            h('span', { className: 'kbcts-search' }, Ic('search', 15),
              h('input', { type: 'search', className: 'kbcts-in', 'data-kb': 'contacts-search', value: qInput, maxLength: 200, placeholder: kt('Rechercher un nom ou un e-mail', 'Search a name or an email'), 'aria-label': kt('Rechercher dans les contacts', 'Search contacts'), onChange: (e) => setQInput(e.target.value) })),
            h('div', { className: 'kbcts-seg', role: 'group', 'aria-label': kt('Genre', 'Kind') },
              ['person', 'company'].map((k) => h('button', { key: k, type: 'button', 'data-kb': 'contacts-kind', 'data-kind': k, 'aria-pressed': filters.kind === k, onClick: () => patch({ kind: k, type: '' }) }, k === 'company' ? kt('Entreprises', 'Companies') : kt('Personnes', 'People')))),
            own.length > 1 ? h('div', { className: 'kbcts-chips', role: 'group', 'aria-label': kt('Type', 'Type') },
              [{ key: '', label: kt('Tous', 'All') }].concat(own.map((t) => ({ key: t.key, label: tx(t.label, t.key) }))).map((t) => h('button', { key: t.key || 'all', type: 'button', className: 'kbcts-chip', 'data-kb': 'contacts-type', 'data-type': t.key, 'aria-pressed': filters.type === t.key, onClick: () => patch({ type: t.key }) }, t.label))) : null,
            tags.length > 0 ? h('select', { className: 'kbcts-in', style: { width: 'auto', height: 34 }, 'data-kb': 'contacts-tag', 'aria-label': kt('Filtrer par étiquette', 'Filter by tag'), value: filters.tag, onChange: (e) => patch({ tag: e.target.value }) },
              h('option', { value: '' }, kt('Toutes les étiquettes', 'All tags')), tags.map((t) => h('option', { key: t, value: t }, t))) : null,
            h('button', { type: 'button', className: 'kbcts-chip', 'data-kb': 'contacts-archived', 'aria-pressed': filters.archived, onClick: () => patch({ archived: !filters.archived }) }, kt('Archivés inclus', 'Show archived')),
            anyFilter ? h('button', { type: 'button', className: 'kbcts-link', 'data-kb': 'contacts-clear-filters', onClick: clearFilters }, kt('Effacer les filtres', 'Clear filters')) : null,
            list.status === 'ok' && (list.total > 0 || anyFilter) ? h('span', { className: 'kbcts-count', 'data-kb': 'contacts-count', role: 'status' }, list.total + ' ' + (filters.kind === 'company' ? (list.total === 1 ? kt('entreprise', 'company') : kt('entreprises', 'companies')) : (list.total === 1 ? kt('personne', 'person') : kt('personnes', 'people'))) + (list.truncated ? ' +' : '')) : null)

          const demoBanner = list.status === 'ok' && list.demo > 0
            ? h('div', { className: 'kbcts-banner', 'data-kb': 'contacts-demo-banner' }, h('span', { className: 'kbcts-tag demo' }, 'demo'),
              h('span', { className: 'sp' }, kt('Ces lignes sont des exemples pour essayer la page. Tu peux les effacer d’un geste : ce que tu ajoutes reste.', 'These rows are examples so you can try the page. You can clear them in one go: what you add stays.')),
              h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-clear-demo', onClick: () => setDialog({ mode: 'clear' }) }, kt('Effacer les données d’exemple', 'Clear sample data')))
            : null

          let body
          if (list.status === 'loading') {
            body = h('div', null, h('div', { role: 'status', 'data-kb': 'contacts-loading', className: 'kbcts-muted', style: { margin: '0 0 8px' } }, kt('Chargement des contacts…', 'Loading contacts…')), h(Bones))
          } else if (list.status === 'error') {
            body = h('div', { className: 'kbcts-banner warn', role: 'alert', 'data-kb': 'contacts-error' }, Ic('alert', 16), h('span', { className: 'sp' }, h('b', null, kt('Les contacts ne sont pas lisibles pour l’instant.', 'Contacts cannot be read right now.')), ' ', errorText(list.error.error, list.error.detail)),
              h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-retry', onClick: () => setReload((n) => n + 1) }, kt('Réessayer', 'Try again')))
          } else if (list.rows.length === 0) {
            body = anyFilter
              ? h('div', { className: 'kbcts-empty', 'data-kb': 'contacts-empty', 'data-why': 'filtered' }, h('b', null, kt('Aucun contact ne correspond.', 'No contact matches.')), h('span', null, kt('Essaie une autre recherche, ou efface les filtres.', 'Try another search, or clear the filters.')), h('button', { type: 'button', className: 'kbcts-btn sm', onClick: clearFilters }, kt('Effacer les filtres', 'Clear filters')))
              : h('div', { className: 'kbcts-empty', 'data-kb': 'contacts-empty', 'data-why': 'none' },
                h('b', null, filters.kind === 'company' ? kt('Pas encore d’entreprise', 'No companies yet') : kt('Pas encore de contact', 'No contacts yet')),
                h('span', null, kt('Ajoute la première fiche, ou demande à un agent de le faire : il te demandera ton accord avant d’écrire.', 'Add the first one, or ask an agent to: it will ask for your approval before writing.')),
                h('span', { className: 'kbcts-muted' }, kt('Un thème peut apporter quelques lignes d’exemple pour essayer.', 'A theme can bring a few sample rows to try things out.')),
                h('button', { type: 'button', className: 'kbcts-btn primary', 'data-kb': 'contacts-empty-new', onClick: () => setDialog({ mode: 'new', kind: filters.kind }) }, Ic('plus', 14), filters.kind === 'company' ? kt('Ajouter une entreprise', 'Add a company') : kt('Ajouter un contact', 'Add a contact')))
          } else {
            const first = filters.offset + 1
            const last = filters.offset + list.rows.length
            body = h(React.Fragment, null,
              h('div', { className: 'kbcts-tw' }, h('table', { className: 'kbcts-tbl', 'data-kb': 'contacts-table' },
                h('thead', null, h('tr', null, h('th', { scope: 'col' }, kt('Nom', 'Name')), h('th', { scope: 'col', className: 'col-type' }, kt('Type', 'Type')), h('th', { scope: 'col', className: 'col-tags' }, kt('Étiquettes', 'Tags')), h('th', { scope: 'col', className: 'col-upd' }, kt('Modifié', 'Updated')))),
                h('tbody', null, list.rows.map((r) => h('tr', { key: r.id, className: 'r' + (r.archived_at !== null ? ' arch' : ''), tabIndex: 0, 'data-kb': 'contacts-row', 'data-id': r.id, 'data-demo': r.demo ? '1' : '0', 'aria-current': openId === r.id ? 'true' : undefined, onClick: () => open(r.id), onKeyDown: (e) => onRowKey(e, r.id) },
                  h('td', null, h('div', { className: 'kbcts-who' }, h('span', { className: 'kbcts-av' + (r.kind === 'company' ? ' co' : ''), 'aria-hidden': 'true' }, initials(r.name)),
                    h('div', null, h('b', null, h('span', { className: 'n' }, r.name), r.demo ? h('span', { className: 'kbcts-tag demo', 'data-kb': 'contacts-demo-badge' }, 'demo') : null, r.archived_at !== null ? h('span', { className: 'kbcts-tag' }, kt('archivé', 'archived')) : null), h('small', null, r.company !== null ? r.company.name : r.email)))),
                  h('td', { className: 'col-type' }, h('span', { className: 'kbcts-tag' }, typeLabel(schema, r))),
                  h('td', { className: 'col-tags' }, h('div', { className: 'kbcts-tags' }, r.tags.slice(0, 3).map((t) => h('button', { key: t, type: 'button', className: 'kbcts-tag', 'data-kb': 'contacts-row-tag', title: kt('Filtrer par cette étiquette', 'Filter by this tag'), onClick: (e) => { e.stopPropagation(); patch({ tag: t }) } }, t)), r.tags.length > 3 ? h('span', { className: 'kbcts-more' }, '+' + (r.tags.length - 3)) : null)),
                  h('td', { className: 'col-upd kbcts-muted' }, relTime(r.updated_at))))))),
              list.total > PAGE_SIZE || filters.offset > 0 ? h('div', { className: 'kbcts-pager', 'data-kb': 'contacts-pager' },
                h('span', null, first + '–' + last + ' / ' + list.total),
                h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-pager-prev', disabled: filters.offset === 0, onClick: () => setFilters((f) => Object.assign({}, f, { offset: Math.max(0, f.offset - PAGE_SIZE) })) }, kt('Précédent', 'Previous')),
                h('button', { type: 'button', className: 'kbcts-btn sm', 'data-kb': 'contacts-pager-next', disabled: last >= list.total, onClick: () => setFilters((f) => Object.assign({}, f, { offset: f.offset + PAGE_SIZE })) }, kt('Suivant', 'Next'))) : null)
          }

          const panel = openId !== null
            ? h(Panel, { key: 'panel', id: openId, state: detail.state, detail: detail.data, error: detail.error, schema, focusOnOpen: focusPanel.current, onClose: closePanel, onOpen: open,
              onEdit: (contact, company) => setDialog({ mode: 'edit', contact, company }),
              onChanged: (what) => { focusPanel.current = false; if (what === 'note') say(kt('Note ajoutée.', 'Note added.')); else if (what === 'archive') say(kt('Contact archivé. Il reste dans « Archivés inclus ».', 'Contact archived. It stays under “Show archived”.')); else say(kt('Contact restauré.', 'Contact restored.')); setReload((n) => n + 1) } })
            : null

          return h('div', { className: 'kbcts', 'data-kb': 'contacts-page' },
            h('style', { 'data-plugin': '@local/kybernos-contacts' }, CSS),
            header,
            demoBanner,
            tools,
            h('div', { className: 'kbcts-body' + (panel !== null ? ' has-panel' : '') }, h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 } }, body), panel),
            toast !== null ? h('div', { className: 'kbcts-toast', role: 'status', 'data-kb': 'contacts-toast' }, toast) : null,
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
        __test: { kt, tx, lang, initials, relTime, kindLabel, typeLabel, typesOf, fieldLabel, fieldDisplay, errorText, checkForm, formBody, emptyForm, tagChoices, domainLabel, query, build, CSS, ICONS, ROW_ID, SLOT }
      }
    } catch (e) {
      console.warn('[kybernos-contacts] disabled:', e)
      return { apply () {} }
    }
  }
})
