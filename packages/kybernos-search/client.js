// kybernos-search — browser half.
//
// « Search everywhere »: one popup that searches the CONTENT of the chats (not only their titles), and the skills, memories, lessons,
// creations, automations and agent teams. The native search of the Workspaces list (a title filter) is not touched.
//
// Three ways in, safest first: a menu row (kybernos-plugin calls `window.__KB_SEARCH__.open()`), the ⌘K / Ctrl+K shortcut, and an icon
// injected next to the native search button of the Workspaces header (DSH has no slot there: a DOM sweep, like the Pinned section; if the
// markup moves, the icon is simply not there and the other two remain).
//
// Everything a result shows comes from the person's own chats and files, so it is NEVER put in the page as HTML: text nodes and
// <mark> elements only.
//
// Loaded through window.__ModuleLoader__.load. RUNNER CONTRACT: the factory must RETURN a plugin object (`apply`); on any error a
// disabled plugin is returned and the GUI is kept.
window.__ModuleLoader__.load({
  id: '@local/kybernos-search',
  factory () {
    try {
      // ── words ─────────────────────────────────────────────────────────────
      const lang = () => { try { return String((window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()) || '').split(/[-_]/)[0] } catch (e) { return 'fr' } }
      const kt = (fr, en) => (lang() === 'en' ? en : fr)

      // ── scopes: the order of the groups, their colour, and where each is read ──
      // `host`: searched by the host (the chats, which are big; the small files). `page`: read here from a route the page already uses.
      const SCOPES = [
        { id: 'chat', host: true, hue: '#4f8cff', label: () => kt('Chats', 'Chats'), icon: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' },
        { id: 'skill', host: true, hue: '#e84393', label: () => kt('Skills', 'Skills'), icon: '<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>' },
        { id: 'memory', host: false, hue: '#9b59f6', label: () => kt('Mémoires', 'Memories'), icon: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 4 10.8c0 1 .5 2 1.2 2.6A3.5 3.5 0 0 0 9.5 18a3.5 3.5 0 0 0 2.5-1V4.5A3.5 3.5 0 0 0 9.5 3zM14.5 3A3.5 3.5 0 0 1 18 6.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 20 10.8c0 1-.5 2-1.2 2.6A3.5 3.5 0 0 1 14.5 18a3.5 3.5 0 0 1-2.5-1"/>' },
        { id: 'lesson', host: true, hue: '#f5a623', label: () => kt('Leçons', 'Lessons'), icon: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>' },
        { id: 'creation', host: false, hue: '#1fa8e8', label: () => kt('Créations', 'Creations'), icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4-4-9 9"/>' },
        { id: 'automation', host: true, hue: '#16b894', label: () => kt('Automations', 'Automations'), icon: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>' },
        { id: 'team', host: true, hue: '#6c5ce7', label: () => kt('Agent Teams', 'Agent Teams'), icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 1 0 0-6M21 20c0-2.5-1.8-4.3-4-4.8"/>' }
      ]
      const DEFAULT_SCOPES = ['chat', 'skill', 'memory', 'lesson', 'creation']
      const KEY_SCOPES = 'kybernos.search.scopes'
      const KEY_REMEMBER = 'kybernos.search.remember'

      // KB-SEARCH-PURE-BEGIN
      // Pure helpers, cut out of this file and run by test-client.mjs. Same folding as the host (core.mjs): one character for one character.
      const NEEDS_FOLD = /[A-Z]|[^\x00-\x7f]/g
      const foldChar = (c) => {
        const code = c.charCodeAt(0)
        if (code < 128) return String.fromCharCode(code + 32)
        const f = c.normalize('NFD')[0].toLowerCase()
        return f.length === 1 ? f : c
      }
      const fold = (s) => String(s).replace(NEEDS_FOLD, foldChar)
      const queryTerms = (q) => {
        const seen = new Set()
        const out = []
        for (const w of fold(String(q === undefined || q === null ? '' : q)).split(/\s+/)) {
          if (w === '' || seen.has(w)) continue
          seen.add(w)
          out.push(w)
          if (out.length >= 6) break
        }
        return out
      }
      const marksOf = (folded, terms) => {
        const r = []
        for (const t of terms) {
          let at = 0
          for (let k = 0; k < 40; k += 1) {
            at = folded.indexOf(t, at)
            if (at < 0) break
            r.push([at, at + t.length])
            at += t.length
          }
        }
        r.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        const merged = []
        for (const x of r) {
          const last = merged[merged.length - 1]
          if (last !== undefined && x[0] <= last[1]) last[1] = Math.max(last[1], x[1])
          else merged.push([x[0], x[1]])
        }
        return merged
      }
      /** A long token that mixes letters and digits is almost always a key: it is never put on a screen. Same length. */
      const maskSecrets = (t) => String(t).replace(/[A-Za-z0-9_\-|+/=]{28,}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '•'.repeat(m.length) : m))
      /** Results of the page-side scopes (memories, creations): every word must be there; a window around the first match. */
      const localMatch = (items, q, scope) => {
        const terms = queryTerms(q)
        if (terms.length === 0) return []
        const out = []
        for (const it of items) {
          const titleF = fold(it.title)
          const textF = fold(it.text)
          if (!terms.every((t) => titleF.includes(t) || textF.includes(t))) continue
          let first = -1
          for (const t of terms) { const i = textF.indexOf(t); if (i >= 0 && (first < 0 || i < first)) first = i }
          const a = Math.max(0, (first < 0 ? 0 : first) - 70)
          const b = Math.min(it.text.length, (first < 0 ? 0 : first) + 150)
          const win = maskSecrets(it.text.slice(a, b).replace(/\s+/g, ' '))
          out.push({
            scope, id: it.id, title: it.title, titleMarks: marksOf(titleF, terms), meta: it.meta || {}, open: it.open || null,
            score: (it.pinned === true ? 5 : 0) + terms.reduce((n, t) => n + (titleF.includes(t) ? 6 : 0) + (textF.includes(t) ? 1 : 0), 0),
            hits: [{ r: 'doc', ts: null, text: win, marks: marksOf(fold(win), terms), pre: a > 0, post: b < it.text.length }]
          })
        }
        out.sort((x, y) => y.score - x.score)
        return out
      }
      /** Which scopes the host is asked for (the page-side ones are not sent: it would only be refused). */
      const hostScopes = (scopes) => SCOPES.filter((s) => s.host && scopes.indexOf(s.id) >= 0).map((s) => s.id)
      const normalizeScopes = (v) => {
        const known = SCOPES.map((s) => s.id)
        const list = Array.isArray(v) ? v.filter((x) => known.indexOf(x) >= 0) : []
        return list.length > 0 ? list : DEFAULT_SCOPES.slice()
      }
      // KB-SEARCH-PURE-END

      // ── storage (every access guarded: a blocked storage means defaults) ──────
      const lsGet = (k) => { try { return window.localStorage.getItem(k) } catch (e) { return null } }
      const lsSet = (k, v) => { try { window.localStorage.setItem(k, v) } catch (e) { /* blocked: defaults next time */ } }
      const readScopes = () => { try { return normalizeScopes(JSON.parse(lsGet(KEY_SCOPES) || 'null')) } catch (e) { return DEFAULT_SCOPES.slice() } }

      // ── DOM helpers ──────────────────────────────────────────────────────────
      const NS = 'http://www.w3.org/2000/svg'
      const el = (tag, cls, text) => {
        const e = document.createElement(tag)
        if (cls) e.className = cls
        if (text !== undefined && text !== null) e.textContent = text
        return e
      }
      const svgIcon = (inner, size = 16) => {
        const s = document.createElementNS(NS, 'svg')
        s.setAttribute('viewBox', '0 0 24 24')
        s.setAttribute('width', String(size))
        s.setAttribute('height', String(size))
        s.setAttribute('fill', 'none')
        s.setAttribute('stroke', 'currentColor')
        s.setAttribute('stroke-width', '1.9')
        s.setAttribute('stroke-linecap', 'round')
        s.setAttribute('stroke-linejoin', 'round')
        s.setAttribute('aria-hidden', 'true')
        s.innerHTML = inner // static constants of this file only
        return s
      }
      const ICON_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
      const ICON_SEARCH_PLUS = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/><path d="M10.5 7.8v5.4M7.8 10.5h5.4"/>'
      const ICON_GEAR = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'

      /** `text` with the [start,end) `marks` as <mark> elements, appended to `parent` (never innerHTML: the text is the person's chats). */
      const appendMarked = (parent, text, marks) => {
        let at = 0
        for (const [a, b] of marks || []) {
          if (a < at || b > text.length) continue
          if (a > at) parent.appendChild(document.createTextNode(text.slice(at, a)))
          parent.appendChild(el('mark', null, text.slice(a, b)))
          at = b
        }
        if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)))
      }

      const fmtWhen = (ms) => {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
        const days = Math.floor((Date.now() - ms) / 86400000)
        if (days <= 0) return kt('aujourd’hui', 'today')
        if (days === 1) return kt('hier', 'yesterday')
        if (days < 60) return kt('il y a ' + days + ' j', days + ' d ago')
        try { return new Date(ms).toLocaleDateString() } catch (e) { return '' }
      }

      // ── the styles (tokens with a fallback; one class prefix, kbsr-) ───────────
      const css = `
.kbsr-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;background:rgba(0,0,0,.42)}
.kbsr-dlg{width:min(980px,100%);max-height:78vh;display:flex;flex-direction:column;border-radius:20px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;position:relative;font:14px/1.45 var(--dsw-font-family,system-ui,sans-serif)}
.kbsr-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}
.kbsr-top>svg{flex:none;color:var(--dsw-alias-label-tertiary,#888)}
.kbsr-in{flex:1;min-width:0;height:34px;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit}
.kbsr-in::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.kbsr-kbd{font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));color:var(--dsw-alias-label-tertiary,#888)}
.kbsr-scopes{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}
.kbsr-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font:inherit;font-size:13px;opacity:.75}
.kbsr-chip[aria-pressed=true]{opacity:1;color:var(--dsw-alias-label-primary,#111);border-color:color-mix(in srgb,var(--h) 55%,transparent);background:color-mix(in srgb,var(--h) 13%,transparent)}
.kbsr-chip[aria-pressed=true] svg{color:var(--h)}
.kbsr-chip .kbsr-n{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums}
.kbsr-chip:focus-visible,.kbsr-ib:focus-visible,.kbsr-it:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5b8cff);outline-offset:1px}
.kbsr-ib{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;margin-inline-start:auto}
.kbsr-ib:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#111)}
.kbsr-pop{position:absolute;right:12px;top:118px;z-index:5;width:300px;padding:12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,#f4f4f5);box-shadow:0 12px 36px rgba(0,0,0,.28)}
.kbsr-pop h4{margin:0 0 8px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
.kbsr-opt{display:flex;align-items:flex-start;gap:10px;padding:7px 4px;font-size:13px;cursor:pointer}
.kbsr-opt small{display:block;color:var(--dsw-alias-label-tertiary,#888);font-size:11.5px}
.kbsr-btn{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:13px}
.kbsr-btn.main{background:var(--dsw-alias-brand-primary,#111);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.kbsr-body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);min-height:0;flex:1}
.kbsr-body.one{grid-template-columns:1fr}
.kbsr-list{overflow:auto;padding:6px 8px 10px;min-height:260px;border-inline-end:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}
.kbsr-body.one .kbsr-list{border:0}
.kbsr-grp{padding:10px 8px 4px;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--h);display:flex;gap:6px;align-items:center}
.kbsr-it{display:flex;gap:10px;padding:9px 8px;border-radius:12px;cursor:pointer;border:0;background:transparent;width:100%;text-align:start;color:inherit;font:inherit}
.kbsr-it:hover,.kbsr-it[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}
.kbsr-it[aria-selected=true]{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(128,128,128,.3))}
.kbsr-av{width:30px;height:30px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--h) 16%,transparent);color:var(--h)}
.kbsr-tx{min-width:0;display:flex;flex-direction:column;gap:2px;flex:1}
.kbsr-t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbsr-s{font-size:12.5px;color:var(--dsw-alias-label-secondary,#666);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kbsr-m{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888)}
.kbsr-dlg mark{background:color-mix(in srgb,#ffc53d 42%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.kbsr-prev{overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.kbsr-prev h3{margin:0;font-size:15px;overflow-wrap:anywhere}
.kbsr-msg{padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f4f4f5);font-size:13px;color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}
.kbsr-msg.hit{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));color:var(--dsw-alias-label-primary,#111)}
.kbsr-msg b{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#888);margin-bottom:3px}
.kbsr-act{display:flex;gap:8px;margin-top:auto}
.kbsr-empty{padding:26px 18px;color:var(--dsw-alias-label-secondary,#666);display:flex;flex-direction:column;gap:12px}
.kbsr-empty h3{margin:0;font-size:15px;color:var(--dsw-alias-label-primary,#111)}
.kbsr-bar{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.3));overflow:hidden}
.kbsr-bar i{display:block;height:100%;background:#4f8cff;border-radius:3px}
.kbsr-foot{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;padding:9px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.kbsr-foot .sp{flex:1}
.kbsr-hdr{color:var(--dsw-alias-brand-primary,#4f8cff)}
.kbsr-hdr-own{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:0;background:transparent;cursor:pointer}
.kbsr-hdr-own:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}
@media (max-width:720px){.kbsr-body{grid-template-columns:1fr}.kbsr-prev{display:none}.kbsr-list{border:0}.kbsr-dlg{max-height:88vh;border-radius:16px}}
`

      // ── the state of one open dialog ───────────────────────────────────────────
      let openCtx = null // the plugin context, for the services (uiWorkspace) read at click time
      let dlg = null     // { scrim, close } while open
      const pageCache = { memory: { at: 0, items: [] }, creation: { at: 0, items: [] } }

      const post = async (path, body) => {
        const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), cache: 'no-store' })
        let j = null
        try { j = await r.json() } catch (e) { j = null }
        return { status: r.status, body: j }
      }
      const getJson = async (path) => {
        const r = await fetch(path, { cache: 'no-store' })
        if (r.ok !== true) throw new Error('HTTP ' + String(r.status))
        return r.json()
      }

      /** Memories of the account (a route the page already uses; needs an account) and creations (the state the Creations page already loads). */
      const pageItems = async (scope) => {
        const c = pageCache[scope]
        if (Date.now() - c.at < 60000) return c.items
        let items = []
        try {
          if (scope === 'memory') {
            const j = await getJson('/kybernos-cloud/memory')
            const list = j !== null && typeof j === 'object' && Array.isArray(j.account) ? j.account : []
            items = list.filter((m) => m !== null && typeof m === 'object' && typeof m.content === 'string').map((m) => ({
              id: String(m.id), title: m.content.replace(/\s+/g, ' ').slice(0, 80), text: m.content, pinned: m.pinned === true,
              meta: { where: kt('Mémoire du compte', 'Account memory') + (m.kind ? ' · ' + String(m.kind) : '') }, open: null
            }))
          } else {
            // The Creations page's own source: the files the agents produced, by workspace (`artifacts`: path, name, mtimeMs, workspace).
            const j = await getJson('/kybernos/load')
            const list = j !== null && typeof j === 'object' && Array.isArray(j.artifacts) ? j.artifacts : []
            items = list.filter((a) => a !== null && typeof a === 'object' && typeof a.name === 'string').map((a) => ({
              id: String(a.path || a.name), title: a.name, text: [a.name, a.workspace, a.path].filter(Boolean).map(String).join(' · '),
              meta: { where: [kt('Créations', 'Creations'), a.workspace].filter(Boolean).join(' · '), when: typeof a.mtimeMs === 'number' ? a.mtimeMs : null },
              open: { kind: 'page', view: 'artifacts' }
            }))
          }
        } catch (e) { items = [] }
        pageCache[scope] = { at: Date.now(), items }
        return items
      }

      /** Open a result: a chat like a pinned one, a page through the Kybernos opener; anything else has nothing to open to. */
      const openResult = (r) => {
        if (r === null || r === undefined || r.open === null || r.open === undefined) return false
        try {
          if (r.open.kind === 'session') {
            const svc = openCtx !== null && typeof openCtx.get === 'function' ? openCtx.get('uiWorkspace') : null
            if (svc !== null && svc !== undefined && typeof svc.openSession === 'function') { svc.openSession(r.open.id); return true }
            return false
          }
          if (r.open.kind === 'page' && typeof window.__KB_OPEN__ === 'function') { window.__KB_OPEN__({ view: r.open.view }); return true }
        } catch (e) { /* navigation unavailable */ }
        return false
      }

      const closeDialog = () => { if (dlg !== null) { try { dlg.close() } catch (e) { /* gone */ } } }

      const openDialog = () => {
        if (dlg !== null) { try { dlg.focus() } catch (e) { /* gone */ } return }
        const previous = document.activeElement
        const S = { q: '', scopes: readScopes(), results: [], counts: {}, sel: 0, pop: false, host: { state: 'idle', done: 0, total: 0, chats: 0, updatedAt: null }, took: null, seq: 0, error: false }
        let remember = lsGet(KEY_REMEMBER) !== '0'

        const scrim = el('div', 'kbsr-scrim')
        scrim.setAttribute('data-kb', 'search-dialog')
        const box = el('div', 'kbsr-dlg')
        box.setAttribute('role', 'dialog')
        box.setAttribute('aria-modal', 'true')
        box.setAttribute('aria-label', kt('Rechercher partout', 'Search everywhere'))
        const top = el('div', 'kbsr-top')
        top.appendChild(svgIcon(ICON_SEARCH, 19))
        const input = el('input', 'kbsr-in')
        input.type = 'text'
        input.setAttribute('data-kb', 'search-input')
        input.setAttribute('autocomplete', 'off')
        input.setAttribute('spellcheck', 'false')
        input.placeholder = kt('Chercher dans les chats, skills, mémoires…', 'Search chats, skills, memories…')
        top.appendChild(input)
        top.appendChild(el('span', 'kbsr-kbd', 'Esc'))
        const scopesBar = el('div', 'kbsr-scopes')
        const pop = el('div', 'kbsr-pop')
        pop.hidden = true
        const body = el('div', 'kbsr-body')
        const foot = el('div', 'kbsr-foot')
        box.append(top, scopesBar, pop, body, foot)
        scrim.appendChild(box)

        const flat = () => S.results
        const render = () => {
          // scope chips with their counts
          scopesBar.textContent = ''
          for (const sc of SCOPES) {
            const on = S.scopes.indexOf(sc.id) >= 0
            const b = el('button', 'kbsr-chip')
            b.type = 'button'
            b.style.setProperty('--h', sc.hue)
            b.setAttribute('aria-pressed', String(on))
            b.setAttribute('data-act', 'scope')
            b.setAttribute('data-scope', sc.id)
            b.appendChild(svgIcon(sc.icon, 14))
            b.appendChild(document.createTextNode(sc.label()))
            if (on && S.q.trim() !== '' && typeof S.counts[sc.id] === 'number') b.appendChild(el('span', 'kbsr-n', String(S.counts[sc.id])))
            b.addEventListener('click', () => {
              const i = S.scopes.indexOf(sc.id)
              if (i >= 0) { if (S.scopes.length > 1) S.scopes.splice(i, 1) } else S.scopes.push(sc.id)
              if (remember) lsSet(KEY_SCOPES, JSON.stringify(S.scopes))
              S.sel = 0
              run()
              render()
            })
            scopesBar.appendChild(b)
          }
          const gear = el('button', 'kbsr-ib')
          gear.type = 'button'
          gear.setAttribute('data-act', 'params')
          gear.setAttribute('aria-label', kt('Paramètres de la recherche', 'Search parameters'))
          gear.title = kt('Paramètres de la recherche', 'Search parameters')
          gear.appendChild(svgIcon(ICON_GEAR, 16))
          gear.addEventListener('click', () => { S.pop = !S.pop; render() })
          scopesBar.appendChild(gear)

          // parameters
          pop.hidden = S.pop !== true
          pop.textContent = ''
          if (S.pop === true) {
            pop.appendChild(el('h4', null, kt('Paramètres de la recherche', 'Search parameters')))
            const row = el('label', 'kbsr-opt')
            const cb = el('input')
            cb.type = 'checkbox'
            cb.checked = remember
            cb.addEventListener('change', () => { remember = cb.checked; lsSet(KEY_REMEMBER, remember ? '1' : '0'); if (remember) lsSet(KEY_SCOPES, JSON.stringify(S.scopes)) })
            const lab = el('span', null, kt('Retenir mes portées', 'Remember my scopes'))
            lab.appendChild(el('small', null, kt('gardé sur cet ordinateur', 'kept on this computer')))
            row.append(cb, lab)
            pop.appendChild(row)
            const info = el('p', 'kbsr-m', S.host.chats + ' ' + kt('chats indexés', 'chats indexed') + (S.host.updatedAt ? ' · ' + fmtWhen(S.host.updatedAt) : ''))
            info.style.margin = '6px 4px'
            pop.appendChild(info)
            const rb = el('button', 'kbsr-btn', kt('Reconstruire l’index', 'Rebuild the index'))
            rb.type = 'button'
            rb.setAttribute('data-act', 'reindex')
            rb.addEventListener('click', async () => { try { await post('/kybernos-search/reindex', {}) } catch (e) { /* offline */ } S.pop = false; poll(); render() })
            pop.appendChild(rb)
          }

          // body
          body.textContent = ''
          const building = S.host.state === 'building'
          const results = flat()
          if (S.q.trim() === '') {
            body.className = 'kbsr-body one'
            const e = el('div', 'kbsr-empty')
            e.appendChild(el('h3', null, kt('Chercher partout sur cet ordinateur', 'Search everything on this computer')))
            e.appendChild(el('span', null, kt('Le contenu des chats (pas seulement leurs titres), les skills, les mémoires, les leçons, les créations, les automations et les équipes. Rien ne quitte cet ordinateur.', 'The content of your chats (not only their titles), skills, memories, lessons, creations, automations and agent teams. Nothing leaves this computer.')))
            if (building) {
              e.appendChild(el('strong', null, kt('Indexation des chats… ', 'Indexing your chats… ') + S.host.done + ' / ' + S.host.total))
              const bar = el('div', 'kbsr-bar')
              const fill = el('i')
              fill.style.width = (S.host.total > 0 ? Math.round(100 * S.host.done / S.host.total) : 0) + '%'
              bar.appendChild(fill)
              e.appendChild(bar)
              e.appendChild(el('span', null, kt('Fait une fois ; ensuite seuls les chats modifiés sont relus.', 'Done once; afterwards only the chats that changed are read.')))
            }
            body.appendChild(e)
          } else if (results.length === 0) {
            body.className = 'kbsr-body one'
            const e = el('div', 'kbsr-empty')
            if (S.error) e.appendChild(el('h3', null, kt('La recherche n’a pas répondu', 'The search did not answer')))
            else if (building) { e.appendChild(el('h3', null, kt('Indexation des chats… ', 'Indexing your chats… ') + S.host.done + ' / ' + S.host.total)); e.appendChild(el('span', null, kt('Les résultats arrivent au fur et à mesure.', 'Results appear as they are read.'))) } else {
              e.appendChild(el('h3', null, kt('Aucun résultat pour « ' + S.q.trim() + ' »', 'No result for “' + S.q.trim() + '”')))
              e.appendChild(el('span', null, kt('Essayez moins de mots, ou activez d’autres portées.', 'Try fewer words, or turn on other scopes.')))
            }
            body.appendChild(e)
          } else {
            body.className = 'kbsr-body'
            const list = el('div', 'kbsr-list')
            list.setAttribute('role', 'listbox')
            let n = 0
            for (const sc of SCOPES) {
              const rows = results.filter((r) => r.scope === sc.id)
              if (rows.length === 0) continue
              const g = el('div', 'kbsr-grp')
              g.style.setProperty('--h', sc.hue)
              g.appendChild(svgIcon(sc.icon, 14))
              g.appendChild(document.createTextNode(sc.label() + ' · ' + (typeof S.counts[sc.id] === 'number' ? S.counts[sc.id] : rows.length)))
              list.appendChild(g)
              for (const r of rows) {
                const i = n
                n += 1
                const b = el('button', 'kbsr-it')
                b.type = 'button'
                b.setAttribute('role', 'option')
                b.setAttribute('aria-selected', String(i === S.sel))
                b.setAttribute('data-act', 'result')
                b.setAttribute('data-i', String(i))
                const av = el('span', 'kbsr-av')
                av.style.setProperty('--h', sc.hue)
                av.appendChild(svgIcon(sc.icon, 16))
                const tx = el('span', 'kbsr-tx')
                const t = el('span', 'kbsr-t')
                appendMarked(t, r.title, r.titleMarks)
                tx.appendChild(t)
                if (r.hits.length > 0) {
                  const s = el('span', 'kbsr-s')
                  if (r.hits[0].pre) s.appendChild(document.createTextNode('… '))
                  appendMarked(s, r.hits[0].text, r.hits[0].marks)
                  if (r.hits[0].post) s.appendChild(document.createTextNode(' …'))
                  tx.appendChild(s)
                }
                const meta = [r.meta.where, fmtWhen(r.meta.when)].filter(Boolean).join(' · ')
                if (meta !== '') tx.appendChild(el('span', 'kbsr-m', meta))
                b.append(av, tx)
                b.addEventListener('click', () => { if (S.sel === i && openResult(r)) closeDialog(); else { S.sel = i; render() } })
                b.addEventListener('dblclick', () => { if (openResult(r)) closeDialog() })
                list.appendChild(b)
              }
            }
            body.appendChild(list)
            const cur = results[Math.min(S.sel, results.length - 1)]
            const prev = el('div', 'kbsr-prev')
            if (cur !== undefined) {
              const sc = SCOPES.find((x) => x.id === cur.scope)
              prev.appendChild(el('div', 'kbsr-m', [sc ? sc.label() : '', cur.meta.where].filter(Boolean).join(' · ')))
              const h = el('h3')
              appendMarked(h, cur.title, cur.titleMarks)
              prev.appendChild(h)
              cur.hits.forEach((m, k) => {
                const box2 = el('div', 'kbsr-msg' + (k === 0 ? ' hit' : ''))
                if (m.r === 'u' || m.r === 'a') box2.appendChild(el('b', null, m.r === 'u' ? kt('Vous', 'You') : kt('Assistant', 'Assistant')))
                if (m.pre) box2.appendChild(document.createTextNode('… '))
                appendMarked(box2, m.text, m.marks)
                if (m.post) box2.appendChild(document.createTextNode(' …'))
                prev.appendChild(box2)
              })
              const act = el('div', 'kbsr-act')
              if (cur.open !== null && cur.open !== undefined) {
                const ob = el('button', 'kbsr-btn main', kt('Ouvrir', 'Open'))
                ob.type = 'button'
                ob.setAttribute('data-act', 'open')
                ob.addEventListener('click', () => { if (openResult(cur)) closeDialog() })
                act.appendChild(ob)
              }
              const cb = el('button', 'kbsr-btn', kt('Copier', 'Copy'))
              cb.type = 'button'
              cb.setAttribute('data-act', 'copy')
              cb.addEventListener('click', () => { try { void navigator.clipboard.writeText(cur.hits.map((h) => h.text).join('\n\n') || cur.title) } catch (e) { /* no clipboard */ } })
              act.appendChild(cb)
              prev.appendChild(act)
            }
            body.appendChild(prev)
          }

          // footer
          foot.textContent = ''
          const key = (k, text) => { const s = el('span'); s.appendChild(el('span', 'kbsr-kbd', k)); s.appendChild(document.createTextNode(' ' + text)); return s }
          if (results.length > 0) { foot.append(key('↑↓', kt('naviguer', 'navigate')), key('↵', kt('ouvrir', 'open'))) }
          foot.append(key('Esc', kt('fermer', 'close')))
          foot.appendChild(el('span', 'sp'))
          const total = Object.values(S.counts).reduce((a, b) => a + b, 0)
          foot.appendChild(el('span', null, S.q.trim() !== '' && results.length > 0
            ? total + ' ' + kt('résultats', 'results') + (S.took !== null ? ' · ' + S.took + ' ms' : '') + ' · ' + kt('local uniquement', 'local only')
            : S.host.chats + ' ' + kt('chats', 'chats') + ' · ' + kt('local uniquement', 'local only')))
        }

        // ── searching ──────────────────────────────────────────────────────────
        let timer = null
        const run = () => {
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(async () => {
            timer = null
            const q = S.q.trim()
            const my = (S.seq += 1)
            if (q === '') { S.results = []; S.counts = {}; S.error = false; render(); return }
            const t0 = Date.now()
            let hostRes = { results: [], counts: {} }
            let failed = false
            const wantHost = hostScopes(S.scopes)
            const jobs = []
            if (wantHost.length > 0) {
              jobs.push(post('/kybernos-search/query', { q, scopes: wantHost }).then((r) => {
                if (r.status === 200 && r.body !== null && r.body.ok === true) hostRes = r.body
                else failed = true
              }).catch(() => { failed = true }))
            }
            const pageRes = []
            for (const scope of ['memory', 'creation']) {
              if (S.scopes.indexOf(scope) < 0) continue
              jobs.push(pageItems(scope).then((items) => { pageRes.push(...localMatch(items, q, scope)) }).catch(() => { /* an empty scope */ }))
            }
            await Promise.all(jobs)
            if (my !== S.seq) return // a newer query is in flight
            const counts = Object.assign({}, hostRes.counts)
            const all = hostRes.results.slice()
            for (const r of pageRes) { counts[r.scope] = (counts[r.scope] || 0) + 1; all.push(r) }
            // page-side scopes are capped like the host's
            const taken = {}
            S.results = all.filter((r) => { taken[r.scope] = (taken[r.scope] || 0) + 1; return taken[r.scope] <= 20 })
            S.counts = counts
            S.error = failed && S.results.length === 0
            S.took = Date.now() - t0
            S.sel = 0
            render()
          }, 120)
        }

        // ── the index: start it on the first open, follow it while it builds ────────
        let pollTimer = null
        const poll = async () => {
          if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null }
          let st = null
          try { st = await getJson('/kybernos-search/status') } catch (e) { st = null }
          if (st !== null && st.ok === true) {
            const wasBuilding = S.host.state === 'building'
            S.host = st
            if (st.state === 'building') { render(); if (S.q.trim() !== '') run(); pollTimer = setTimeout(poll, 900) } else if (wasBuilding) { render(); if (S.q.trim() !== '') run() }
          }
          render()
        }
        post('/kybernos-search/start', {}).then(() => poll()).catch(() => poll())

        // ── events ─────────────────────────────────────────────────────────────
        input.addEventListener('input', () => { S.q = input.value; S.sel = 0; run(); render() })
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (S.pop) { S.pop = false; render() } else closeDialog(); return }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const n = flat().length
            if (n === 0) return
            e.preventDefault()
            S.sel = Math.max(0, Math.min(n - 1, S.sel + (e.key === 'ArrowDown' ? 1 : -1)))
            render()
            const cur = body.querySelector('[aria-selected="true"]')
            if (cur !== null && typeof cur.scrollIntoView === 'function') cur.scrollIntoView({ block: 'nearest' })
            return
          }
          if (e.key === 'Enter') {
            const cur = flat()[Math.min(S.sel, flat().length - 1)]
            if (cur !== undefined && openResult(cur)) { e.preventDefault(); closeDialog() }
          }
        }
        document.addEventListener('keydown', onKey, true)
        scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeDialog() })

        dlg = {
          scrim,
          focus: () => input.focus(),
          close: () => {
            document.removeEventListener('keydown', onKey, true)
            if (timer !== null) clearTimeout(timer)
            if (pollTimer !== null) clearTimeout(pollTimer)
            S.seq += 1
            scrim.remove()
            dlg = null
            try { if (previous && typeof previous.focus === 'function') previous.focus() } catch (e) { /* unmounted */ }
          }
        }
        document.body.appendChild(scrim)
        render()
        try { input.focus() } catch (e) { /* focus */ }
      }

      // ── the header icon: next to the native search of the Workspaces list ───────
      const HEADER_ATTR = 'data-kb'
      const sweepHeader = () => {
        for (const header of document.querySelectorAll('[class*="sectionHeader"]')) {
          const native = header.querySelector('[class*="searchButton"]')
          if (native === null) continue
          if (header.querySelector('[data-kb="search-header"]') !== null) continue
          const like = header.querySelector('[class*="headerActions"] [class*="iconButton"]') || header.querySelector('[class*="iconButton"]')
          const b = document.createElement('button')
          b.type = 'button'
          b.setAttribute(HEADER_ATTR, 'search-header')
          b.setAttribute('aria-label', kt('Rechercher partout', 'Search everywhere'))
          b.title = kt('Rechercher partout (⌘K)', 'Search everywhere (⌘K)')
          // the same look as DSH's own icon buttons when we can borrow their class, our own otherwise
          b.className = (like !== null ? String(like.className).replace(/\bwide\b|_wide\b/g, '') : 'kbsr-hdr-own') + ' kbsr-hdr'
          b.appendChild(svgIcon(ICON_SEARCH_PLUS, 16))
          b.addEventListener('click', (ev) => { ev.stopPropagation(); openDialog() })
          // Two things measured on the real GUI: the native search button sits in a 28 px slot that clips what is added to it, and the
          // group of the other icon buttons has a FIXED width of 60 px (a third button there pushes « Add workspace » out of the
          // header). So the icon is a child of the header itself, right before that group; the header lays itself out around it.
          const actions = header.querySelector('[class*="headerActions"]')
          if (actions !== null && actions.parentNode === header) header.insertBefore(b, actions)
          else {
            const slot = native.closest('[class*="searchSlot"]')
            ;(slot !== null && slot.parentNode === header ? slot : native).insertAdjacentElement('afterend', b)
          }
        }
      }

      // ── the top icon: at the very top of the sidebar, beside « Collapse sidebar » ────────────────────────────────
      // It replaces the menu row. Found by the label of the collapse button (the sidebar's own), borrowing its class so it looks like
      // DSH's own icon buttons; only while the sidebar is open (a collapsed one has no such button, and no room).
      const sweepTop = () => {
        if (document.querySelector('[data-kb="search-top"]') !== null) return
        let collapse = null
        for (const b of document.querySelectorAll('button')) {
          const r = b.getBoundingClientRect()
          if (r.width === 0 || r.height === 0 || r.top < 0 || r.top > 80 || r.left > 360) continue
          if (/collapse|réduire|replier|masquer/i.test(String(b.getAttribute('aria-label') || b.title || '')) && /sidebar|barre|panneau/i.test(String(b.getAttribute('aria-label') || b.title || ''))) { collapse = b; break }
        }
        if (collapse === null || collapse.parentNode === null) return
        const b = document.createElement('button')
        b.type = 'button'
        b.setAttribute(HEADER_ATTR, 'search-top')
        b.setAttribute('aria-label', kt('Rechercher partout', 'Search everywhere'))
        b.title = kt('Rechercher partout (⌘K)', 'Search everywhere (⌘K)')
        b.className = String(collapse.className).replace(/\bwide\b|_wide\b/g, '') + ' kbsr-hdr kbsr-top'
        b.appendChild(svgIcon(ICON_SEARCH_PLUS, 16))
        b.addEventListener('click', (ev) => { ev.stopPropagation(); openDialog() })
        collapse.parentNode.insertBefore(b, collapse)
      }

      return {
        name: 'kybernos-search',
        apply (ctx) {
          openCtx = ctx
          const style = document.createElement('style')
          style.dataset.plugin = '@local/kybernos-search'
          style.textContent = css
          document.head.appendChild(style)
          try { window.__KB_SEARCH__ = { open: openDialog, close: closeDialog } } catch (e) { /* outside a browser */ }

          const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k') {
              e.preventDefault()
              e.stopPropagation()
              if (dlg !== null) closeDialog(); else openDialog()
            }
          }
          document.addEventListener('keydown', onKey, true)

          let scheduled = null
          const later = (records) => {
            if (scheduled !== null) return
            if (Array.isArray(records) && records.length > 0 && records.every((r) => r.target && r.target.closest && r.target.closest('.kbsr-scrim'))) return
            scheduled = setTimeout(() => { scheduled = null; try { sweepHeader() } catch (e) { /* the header moved: no icon */ } try { sweepTop() } catch (e) { /* the sidebar top moved: no icon */ } }, 250)
          }
          let observer = null
          try { observer = new MutationObserver(later); observer.observe(document.body, { childList: true, subtree: true }) } catch (e) { observer = null }
          try { sweepHeader() } catch (e) { /* no header yet */ }
          try { sweepTop() } catch (e) { /* no sidebar yet */ }

          const cleanup = () => {
            document.removeEventListener('keydown', onKey, true)
            if (observer !== null) observer.disconnect()
            if (scheduled !== null) clearTimeout(scheduled)
            closeDialog()
            style.remove()
            document.querySelectorAll('[data-kb="search-header"], [data-kb="search-top"]').forEach((n) => n.remove())
            try { delete window.__KB_SEARCH__ } catch (e) { /* gone */ }
          }
          if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => cleanup, 'kybernos-search: popup, shortcut and header icon')
        },
        __test: { fold, queryTerms, marksOf, maskSecrets, localMatch, hostScopes, normalizeScopes, SCOPES, DEFAULT_SCOPES }
      }
    } catch (err) {
      console.warn('[kybernos-search] disabled:', err)
      return { apply () { /* disabled after a load error */ } }
    }
  }
})
