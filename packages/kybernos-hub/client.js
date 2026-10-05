// ═══════════════════════════════════════════════════════
// kybernos-hub — client half: boot beacons, and the Kybernos Suite settings panel.
//
//   1. as soon as it loads → POST {type:'loading'}  (a GUI was served)
//   2. every TICK_MS it reads the page:
//        · DSH's "Failed to load plugins" screen is up → POST {type:'broken',
//          entries:[the bundles it names]} and stop;
//        · otherwise, after ALIVE_AFTER_MS with the page visible → POST
//          {type:'alive'} and stop.
//
// Why read the page: when a bundle fails to activate, DSH still serves a page and
// this client still runs on it. Measured on a real DSH 0.2.0-rc.2 with a
// sabotaged bundle — a bare "page stayed open" timer reported alive on a broken GUI.
// Everything is wrapped: this file must never be the reason a page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-hub',
  factory: (require) => {
    const NAME = 'kybernos-hub'
    const ROUTE = '/kybernos-hub/beacon'
    const TICK_MS = 2000
    const ALIVE_AFTER_MS = 8000
    const NOM_BUNDLE = /^@[a-z0-9._-]+\/[a-z0-9._-]+$/i

    /**
     * Pure. Reads the text of DSH's failure screen:
     *   "Failed to load plugins\n@local/x\nweb boot: 1 entry did not activate\n@local/x: import failed: …"
     * Returns null when the page is not that screen, else { entrees: [bundle names] }.
     */
    const lireEchec = (texte) => {
      const t = String(texte == null ? '' : texte)
      if (!/Failed to load plugins/i.test(t) && !/entr(y|ies) did not activate/i.test(t)) return null
      const noms = []
      const liste = t.match(/Failed to load plugins\s*\n([\s\S]*?)\n\s*web boot:/i)
      if (liste) for (const l of liste[1].split('\n')) if (NOM_BUNDLE.test(l.trim())) noms.push(l.trim())
      const re = /(@[a-z0-9._-]+\/[a-z0-9._-]+):\s*import failed/gi
      let m
      while ((m = re.exec(t)) !== null) noms.push(m[1])
      return { entrees: [...new Set(noms)].slice(0, 8) }
    }

    const envoyer = (corps) => fetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      keepalive: true
    }).then((r) => r.json()).catch(() => null)

    const apply = (ctx) => {
      try {
        let bootId = null
        let fini = false
        let ecoule = 0
        const annoncer = async () => {
          const r = await envoyer({ type: 'loading' })
          if (r !== null && r.ok === true && typeof r.bootId === 'string') bootId = r.bootId
        }
        const surveiller = async () => {
          if (fini) return
          ecoule += TICK_MS
          if (bootId === null) return
          const texte = typeof document !== 'undefined' && document.body ? document.body.innerText : ''
          const echec = lireEchec(texte)
          if (echec !== null) {
            const r = await envoyer({ type: 'broken', bootId, entries: echec.entrees })
            if (r !== null && r.ok === true) fini = true
            return
          }
          if (ecoule < ALIVE_AFTER_MS) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const r = await envoyer({ type: 'alive', bootId })
          if (r !== null && r.ok === true) fini = true
        }
        ctx.effect(() => {
          annoncer().catch(() => { /* never blocking */ })
          const minuteur = setInterval(() => { surveiller().catch(() => { /* never blocking */ }) }, TICK_MS)
          return () => { clearInterval(minuteur) }
        }, 'kybernos-hub: boot beacons')
      } catch (e) { /* the hub is optional: swallow */ }
    }


    // ═══ Suite panel ════════════════════════════════════════════════════════
    // A Settings section "Kybernos Suite": which modules exist (catalogue shipped in
    // this bundle), which are installed (DSH's native plugin manager), switch them,
    // install one (the lifecycle robot, on the host), open a module's own settings.
    // Two views of the same list (grid of cards by family, or one flat list) and a
    // user-defined order, both kept in this browser's localStorage only.
    // Nothing here may stop the boot beacon above: every entry point is wrapped.

    const lang = () => {
      try { const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__(); return String(l || '').split(/[-_]/)[0] } catch (e) { return 'fr' }
    }
    const kt = (fr, en) => (lang() === 'en' ? en : fr)

    /** Pure. "1.2.0" vs "1.10.0" → -1 | 0 | 1. Non-numeric parts compare as 0. */
    const comparerVersions = (a, b) => {
      const p = (v) => String(v == null ? '' : v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
      const x = p(a)
      const y = p(b)
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0)
        if (d !== 0) return d < 0 ? -1 : 1
      }
      return 0
    }

    /** Pure. The native manager answers { ok, value } over Remote, or the bare array. */
    const deballer = (reponse) => {
      if (Array.isArray(reponse)) return reponse
      if (reponse != null && reponse.ok === true && Array.isArray(reponse.value)) return reponse.value
      return null
    }

    /**
     * Pure. The state a card shows:
     *   busy · pending · available · safe · update · active · off
     */
    const etatCarte = ({ module: m, bundle, occupe, enAttente, securite }) => {
      if (occupe === true) return 'busy'
      if (enAttente === true) return 'pending'
      if (bundle == null) return 'available'
      if (securite === true && m.socle !== true && bundle.enabled !== true) return 'safe'
      if (typeof bundle.version === 'string' && comparerVersions(bundle.version, m.version) < 0) return 'update'
      return bundle.enabled === true ? 'active' : 'off'
    }

    /** Pure. Filter + search; keeps the order it is given. `installes` is a Map name → bundle. */
    const filtrer = ({ modules, filtre, requete, installes }) => {
      const q = String(requete || '').trim().toLowerCase()
      return modules.filter((m) => {
        if (q !== '') {
          const hay = (m.id + ' ' + m.promesse.fr + ' ' + m.promesse.en).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        const b = installes.get(m.nom)
        if (filtre === 'installed') return b !== undefined
        if (filtre === 'available') return b === undefined
        if (filtre === 'updates') return b !== undefined && typeof b.version === 'string' && comparerVersions(b.version, m.version) < 0
        return true
      })
    }

    // ── Order and view: pure helpers first, then a thin, total storage layer ─────────
    // The order is one list of module ids covering the WHOLE catalogue. It applies to
    // both views: inside each family in the grid, globally in the list.
    const ORDER_KEY = 'kybernos.suite.order.v1'
    const VIEW_KEY = 'kybernos.suite.view.v1'

    /** Pure. Same ids in the same sequence? */
    const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i])

    /** Pure. Stored text → array of unique non-empty ids. null, corrupt JSON or a wrong shape → []. */
    const parseOrder = (raw) => {
      try {
        const v = JSON.parse(raw)
        if (!Array.isArray(v)) return []
        return [...new Set(v.filter((id) => typeof id === 'string' && id !== ''))]
      } catch (e) { return [] }
    }

    /**
     * Pure. The ids of `modules` in display order: the saved ids that are still in the
     * catalogue (first occurrence wins), then every module the saved list does not know
     * (a new module), in catalogue order. Ids that left the catalogue are ignored.
     */
    const effectiveOrder = (modules, saved) => {
      const known = new Set(modules.map((m) => m.id))
      const seen = new Set()
      const head = []
      for (const id of (Array.isArray(saved) ? saved : [])) {
        if (known.has(id) && !seen.has(id)) { seen.add(id); head.push(id) }
      }
      return [...head, ...modules.filter((m) => !seen.has(m.id)).map((m) => m.id)]
    }

    /** Pure. The same module objects, sorted by effectiveOrder. The input is left alone. */
    const applyOrder = (modules, saved) => {
      const parId = new Map(modules.map((m) => [m.id, m]))
      return effectiveOrder(modules, saved).map((id) => parId.get(id))
    }

    /** Pure. Does the effective order differ from the catalogue order? */
    const isCustomOrder = (modules, saved) => !sameIds(effectiveOrder(modules, saved), modules.map((m) => m.id))

    /**
     * Pure. What to persist for `order`: the full id list, or null when it is just the
     * catalogue order (the key is then removed, so users who never customised keep
     * following the catalogue when a release reorders it).
     */
    const storableOrder = (modules, order) => (isCustomOrder(modules, order) ? effectiveOrder(modules, order) : null)

    /**
     * Pure. A new list with `id` placed just before (`before`) or just after `target`.
     * `order` is the FULL order, so rows hidden by a filter keep their place relative to
     * each other. Unknown ids, or id === target: the order comes back unchanged.
     */
    const moveTo = (order, id, target, before) => {
      if (id === target || order.indexOf(id) < 0 || order.indexOf(target) < 0) return order.slice()
      const rest = order.filter((x) => x !== id)
      rest.splice(rest.indexOf(target) + (before ? 0 : 1), 0, id)
      return rest
    }

    /**
     * Pure. Up (step -1) or down (+1) by one VISIBLE row. Choice made for filtered lists:
     * the row jumps over its visible neighbour, not over the rows the filter hides, so
     * the click always has a visible effect; hidden rows stay where they were relative to
     * everything else. At either end of the visible list nothing moves.
     * `visible` = the ids currently shown, in display order.
     */
    const moveBy = (order, visible, id, step) => {
      const i = visible.indexOf(id)
      const neighbour = i < 0 ? undefined : visible[i + step]
      return neighbour === undefined ? order.slice() : moveTo(order, id, neighbour, step < 0)
    }

    // localStorage can be absent, blocked or throw (private window, site data cleared):
    // every access is wrapped and the panel works without it. `store` is injectable for tests.
    const browserStore = () => { try { return window.localStorage || null } catch (e) { return null } }
    const readOrder = (store) => { try { return store ? parseOrder(store.getItem(ORDER_KEY)) : [] } catch (e) { return [] } }
    /** @returns {boolean} whether the write (null = remove the key) went through. */
    const writeOrder = (store, ids) => {
      try {
        if (!store) return false
        if (ids === null) store.removeItem(ORDER_KEY); else store.setItem(ORDER_KEY, JSON.stringify(ids))
        return true
      } catch (e) { return false }
    }
    const readView = (store) => { try { return store && store.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch (e) { return 'grid' } }
    const writeView = (store, view) => { try { if (!store) return false; store.setItem(VIEW_KEY, view === 'list' ? 'list' : 'grid'); return true } catch (e) { return false } }

    const post = (chemin, corps) => fetch(chemin, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps)
    }).then((r) => r.json().catch(() => ({ ok: false, error: 'bad-response' }))).catch(() => ({ ok: false, error: 'network' }))

    const CSS = [
      '.kbsu{position:relative;display:flex;flex-direction:column;gap:16px;max-width:980px;font-size:13.5px;color:var(--dsw-alias-label-primary)}',
      '.kbsu button{font:inherit;cursor:pointer}',
      '.kbsu button:disabled{opacity:.5;cursor:default}',
      '.kbsu-head{display:flex;flex-wrap:wrap;gap:10px 24px;justify-content:space-between;align-items:flex-start}',
      '.kbsu-head h4{margin:0 0 2px;font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.25}',
      '.kbsu-head p{margin:0;color:var(--dsw-alias-label-secondary);max-width:56ch}',
      '.kbsu-headr{display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
      '.kbsu-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:flex-end}',
      '.kbsu-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-inline-end:6px;background:var(--dsw-alias-state-success-primary)}',
      '.kbsu-dot.warn{background:var(--dsw-alias-state-warn-primary)}',
      '.kbsu-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border-radius:10px;border:0;font-weight:600;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kbsu-btn.ghost{background:transparent;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-weight:500}',
      '.kbsu-btn.accent{background:#ff7a1a;color:#fff}',
      '.kbsu-btn.sm{height:28px;padding:0 11px;border-radius:8px;font-size:12.5px}',
      '.kbsu svg.i{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}',
      '.kbsu .spin{animation:kbsuspin .9s linear infinite}@keyframes kbsuspin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.kbsu .spin{animation:none}}',
      '.kbsu-banner{display:flex;flex-direction:column;gap:6px;padding:11px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.kbsu-banner strong{display:flex;gap:8px;align-items:center}',
      '.kbsu-banner code,.kbsu code{font:12px ui-monospace,Menlo,monospace;background:var(--dsw-alias-bg-layer-3);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}',
      '.kbsu-relance{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:12px;border:1px solid #ff7a1a;background:color-mix(in srgb,#ff7a1a 14%,transparent)}',
      '.kbsu-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.kbsu-seg{display:inline-flex;padding:3px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.kbsu-seg button{border:0;border-radius:7px;padding:5px 11px;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kbsu-seg .c{font:12px ui-monospace,Menlo,monospace;margin-inline-start:6px}',
      '.kbsu-search{flex:1 1 220px;min-width:0;display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.kbsu-search input{flex:1;min-width:0;background:transparent;border:0;color:inherit;font:inherit;padding:8px 0;outline:none}',
      '.kbsu-summary{font-size:12.5px;color:var(--dsw-alias-label-tertiary);min-height:1.4em}',
      '.kbsu-fam{display:flex;flex-direction:column;gap:10px}',
      '.kbsu-fam h5{margin:0;font-size:15px;font-weight:600;display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}',
      '.kbsu-fam h5 span{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:13px}',
      '.kbsu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}',
      '.kbsu-card{display:flex;flex-direction:column;gap:9px;padding:13px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.kbsu-card.open{grid-column:1/-1}',
      '.kbsu-card.dim{opacity:.85}',
      '.kbsu-top{display:flex;gap:10px;align-items:flex-start}',
      '.kbsu-ico{width:34px;height:34px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;place-items:center;color:var(--dsw-alias-label-secondary);flex:none}',
      '.kbsu-name{min-width:0;flex:1}',
      '.kbsu-name b{font:600 13px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}',
      '.kbsu-name small{display:block;color:var(--dsw-alias-label-tertiary);font:12px ui-monospace,Menlo,monospace}',
      '.kbsu-promise{margin:0}',
      '.kbsu-badges{display:flex;flex-wrap:wrap;gap:6px}',
      '.kbsu-b{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
      '.kbsu-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:auto}',
      '.kbsu-st{font-size:12.5px;color:var(--dsw-alias-label-tertiary);display:inline-flex;gap:6px;align-items:center;min-width:0}',
      '.kbsu-st.ok{color:var(--dsw-alias-state-success-primary)}.kbsu-st.warn{color:var(--dsw-alias-state-warn-primary)}.kbsu-st.bad{color:var(--dsw-alias-state-error-primary)}',
      '.kbsu-right{display:inline-flex;gap:8px;align-items:center}',
      '.kbsu-sw{position:relative;flex:none;width:36px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0}',
      '.kbsu-sw i{position:absolute;inset-inline-start:2px;top:2px;width:14px;height:14px;border-radius:999px;background:var(--dsw-alias-label-secondary);transition:inset-inline-start .15s ease}',
      '.kbsu-sw.on{background:#ff7a1a;border-color:#ff7a1a}.kbsu-sw.on i{inset-inline-start:18px;background:#fff}',
      '.kbsu-note{margin:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-line}',
      '.kbsu-cfg{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}',
      '.kbsu-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}',
      // view toggle, order line, screen-reader announcements
      '.kbsu-seg.view button{display:inline-flex;align-items:center;gap:6px}',
      '.kbsu-subbar{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between;align-items:baseline}',
      '.kbsu-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      // list view: one flat list, one row per module
      '.kbsu-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.kbsu-row{position:relative;min-width:0;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.kbsu-row.dim{opacity:.85}.kbsu-row.dragging{opacity:.45}',
      '.kbsu-row.drop-before::before,.kbsu-row.drop-after::after{content:"";position:absolute;inset-inline:8px;height:3px;border-radius:3px;background:#ff7a1a;pointer-events:none}',
      '.kbsu-row.drop-before::before{top:-6px}.kbsu-row.drop-after::after{bottom:-6px}',
      '.kbsu-rowmain{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:9px 12px}',
      '.kbsu-grip{display:grid;place-items:center;flex:none;width:18px;height:34px;color:var(--dsw-alias-label-tertiary);cursor:grab}',
      '.kbsu-grip:hover{color:var(--dsw-alias-label-secondary)}.kbsu-grip:active{cursor:grabbing}',
      '.kbsu-rowname{flex:1 1 200px;min-width:0}',
      '.kbsu-rowname b{display:block;font:500 13px ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbsu-rowname .kbsu-promise{display:block;font-size:12.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbsu-famcol{flex:0 0 150px;min-width:0;display:flex}',
      '.kbsu-famtag{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbsu-row .kbsu-st{flex:0 0 150px}',
      '.kbsu-rowact{flex:0 0 auto;min-width:128px;justify-content:flex-end}',
      '.kbsu-mv{display:inline-flex;gap:4px;flex:none}',
      '.kbsu-ib{display:grid;place-items:center;width:28px;height:28px;padding:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-ib:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kbsu-row .kbsu-note{margin:0 12px 10px}',
      '.kbsu-row .kbsu-cfg{margin:0 12px 12px}',
      // A row is one line while the list is wide enough. Narrower (the list's own width, not the
      // viewport's: Settings has a sidebar), it takes two: grip, tile, name and move buttons, then
      // family, status and actions (an empty ::after forces the break).
      '.kbsu-list{container-type:inline-size}',
      '@container (max-width:860px){.kbsu-rowmain{row-gap:4px}.kbsu-rowmain::after{content:"";order:1;flex:0 0 100%;height:0}.kbsu-rowname{flex-basis:120px}.kbsu-mv{order:1}.kbsu-famcol{order:2;flex:0 1 auto}.kbsu-row .kbsu-st{order:2;flex:1 1 auto}.kbsu-rowact{order:2;min-width:0}}',
      '@media (max-width:520px){.kbsu-headr{align-items:flex-start}.kbsu-meta{justify-content:flex-start}}'
    ].join('\n')

    const ICONES = {
      box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12',
      cpu: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 9h6v6H9ZM15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2',
      users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
      layout: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 9h18M9 21V9',
      plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
      cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
      database: 'M12 3c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3ZM3 6v6c0 1.66 4.03 3 9 3s9-1.34 9-3V6M3 12v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6',
      check: 'M20 6 9 17l-5-5',
      alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
      refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
      search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM21 21l-4.3-4.3',
      grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM14 14h7v7h-7ZM3 14h7v7H3Z',
      list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
      grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
      up: 'm18 15-6-6-6 6',
      down: 'm6 9 6 6 6-6',
      reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5'
    }

    const construirePanneau = (React, scope, ctx) => {
      const h = React.createElement
      const ic = (nom, extra) => h('svg', { className: 'i' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONES[nom] || ICONES.box }))
      const slots = scope.slots
      const gestionnaire = () => {
        try {
          const m = (scope.remote && scope.remote.pluginManager) || (ctx.remote && ctx.remote.pluginManager) || null
          return m !== null && typeof m.listBundles === 'function' && typeof m.setBundleEnabled === 'function' ? m : null
        } catch (e) { return null }
      }
      // A module has its own settings screen when it registered one in the slot
      // plugins.bundle.config (key = package name) — the same bridge the old page used.
      const composantReglages = (nom) => {
        try {
          for (const en of (slots.entriesOfSlot('plugins.bundle.config') || [])) {
            if (en != null && en.component != null && en.options != null && String(en.options.key) === nom) return en.component
          }
        } catch (e) { /* none */ }
        return null
      }
      // DSH's own plugin panel (install / uninstall any bundle). Settings is a modal overlay:
      // close it first (same path as "Back to workspace"), then select the panel.
      const ouvrirGestionnaire = (scope.layout && typeof scope.layout.selectPanel === 'function')
        ? () => {
            try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } catch (e) { /* no document */ }
            try { scope.layout.selectPanel('plugins') } catch (e) { /* panel unavailable */ }
          }
        : null
      const lireJson = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

      const Panneau = () => {
        const [charge, setCharge] = React.useState({ etat: 'loading', suite: null, bundles: null, maint: null })
        const [filtre, setFiltre] = React.useState('all')
        const [requete, setRequete] = React.useState('')
        const [occupes, setOccupes] = React.useState({})
        const [notes, setNotes] = React.useState({})
        const [enAttente, setEnAttente] = React.useState({})
        const [ouvert, setOuvert] = React.useState(null)
        const [resume, setResume] = React.useState('')
        const [verifie, setVerifie] = React.useState(false)
        const [confirmerRelance, setConfirmerRelance] = React.useState(false)
        const [relance, setRelance] = React.useState('idle')
        // View and order: read once per mount, written on every change (see the helpers above).
        const [view, setView] = React.useState(() => readView(browserStore()))
        const [order, setOrder] = React.useState(() => readOrder(browserStore()))
        const [orderSaved, setOrderSaved] = React.useState(true)
        const [announce, setAnnounce] = React.useState('')
        const [dragId, setDragId] = React.useState(null)
        const [dropAt, setDropAt] = React.useState(null)
        const dragRef = React.useRef(null)
        const refocus = React.useRef(null)
        const rootRef = React.useRef(null)

        // A move re-orders the DOM and can drop keyboard focus: put it back on the button
        // that was just used (or its twin when that one is now disabled at an end). A layout
        // effect, so focus is back before the browser paints or the next key press.
        React.useLayoutEffect(() => {
          const w = refocus.current
          if (w === null) return
          refocus.current = null
          try {
            const rows = rootRef.current ? rootRef.current.querySelectorAll('[data-kb="suite-row"]') : []
            const row = Array.prototype.find.call(rows, (r) => r.dataset.id === w.id)
            if (!row) return
            let btn = row.querySelector('[data-kb="suite-' + w.dir + '"]')
            if (btn && btn.disabled) btn = row.querySelector('[data-kb="suite-' + (w.dir === 'up' ? 'down' : 'up') + '"]')
            if (btn && !btn.disabled) btn.focus()
          } catch (e) { /* focus is a courtesy */ }
        })

        const recharger = React.useCallback(async () => {
          const mgr = gestionnaire()
          const [suite, maint, rep] = await Promise.all([
            lireJson('/kybernos-hub/suite'),
            lireJson('/kybernos-maintenance/state'),
            mgr !== null ? Promise.resolve().then(() => mgr.listBundles()).catch(() => null) : Promise.resolve(null)
          ])
          const bundles = deballer(rep)
          if (suite === null || suite.ok !== true) { setCharge({ etat: 'error', suite: null, bundles, maint }); return }
          setCharge({ etat: 'ok', suite, bundles, maint })
        }, [])

        React.useEffect(() => {
          recharger()
          let debrancher = null
          try { if (ctx.remote && typeof ctx.remote.$on === 'function') debrancher = ctx.remote.$on('plugin-manager/changed', () => { recharger() }) } catch (e) { /* no listener */ }
          return () => { if (typeof debrancher === 'function') debrancher() }
        }, [])

        if (charge.etat === 'loading') return h('div', { className: 'kbsu' }, h('div', { className: 'kbsu-empty' }, kt('Chargement de la suite…', 'Loading the suite…')))
        if (charge.etat === 'error') {
          return h('div', { className: 'kbsu' },
            h('div', { className: 'kbsu-head' }, h('div', null, h('h4', null, 'Kybernos Suite'))),
            h('div', { className: 'kbsu-banner', role: 'alert' }, h('strong', null, ic('alert'), kt('Le catalogue de la suite est injoignable.', 'The suite catalogue cannot be reached.')),
              h('span', null, kt('Le serveur DSH ne répond pas sur /kybernos-hub/suite. Relancez DSH, ou utilisez le gestionnaire de plugins natif de DSH.', 'The DSH server does not answer on /kybernos-hub/suite. Restart DSH, or use DSH’s native plugin manager.'))),
            h('div', null, h('button', { type: 'button', className: 'kbsu-btn ghost', onClick: () => { setCharge({ etat: 'loading', suite: null, bundles: null, maint: null }); recharger() } }, ic('refresh'), kt('Réessayer', 'Retry'))))
        }

        const suite = charge.suite
        const modules = suite.modules
        const mgr = gestionnaire()
        const installes = new Map((charge.bundles || []).map((b) => [String(b.name), b]))
        const hub = suite.hub || {}
        const safe = hub.safe && hub.safe.active === true
        const reco = hub.recommendation || {}
        const compat = charge.maint && charge.maint.compat ? charge.maint.compat : null
        const horsZone = compat !== null && compat.horsZone === true
        const fullOrder = effectiveOrder(modules, order)
        const custom = isCustomOrder(modules, order)
        const visibles = filtrer({ modules: applyOrder(modules, order), filtre, requete, installes })
        const nbInstalles = modules.filter((m) => installes.has(m.nom)).length
        const nbMaj = modules.filter((m) => { const b = installes.get(m.nom); return b !== undefined && typeof b.version === 'string' && comparerVersions(b.version, m.version) < 0 }).length
        const nbEnAttente = Object.keys(enAttente).length

        const note = (id, texte) => setNotes((n) => ({ ...n, [id]: texte }))
        const occuper = (id, v) => setOccupes((o) => { const c = { ...o }; if (v) c[id] = true; else delete c[id]; return c })

        const basculer = async (m, bundle) => {
          const voulu = bundle.enabled !== true
          note(m.id, null); occuper(m.id, true)
          const r = await post('/kybernos-hub/module', { id: m.id, action: voulu ? 'activer' : 'desactiver' })
          if (r.ok !== true) { note(m.id, kt('Impossible d’enregistrer le choix : ', 'Could not save the choice: ') + (r.error || '')); occuper(m.id, false); return }
          try { await mgr.setBundleEnabled(m.nom, voulu) } catch (e) {
            await post('/kybernos-hub/module', { id: m.id, action: voulu ? 'desactiver' : 'activer' })
            note(m.id, String(e && e.message ? e.message : e))
          }
          occuper(m.id, false); recharger()
        }

        const installer = async (m) => {
          note(m.id, null); occuper(m.id, true)
          const r = await post('/kybernos-hub/module', { id: m.id, action: 'installer' })
          occuper(m.id, false)
          if (r.ok !== true) {
            note(m.id, kt('Installation refusée', 'Install refused') + (r.error ? ' (' + r.error + ')' : '') + (r.detail ? '\n' + r.detail : ''))
            return
          }
          setEnAttente((a) => ({ ...a, [m.id]: true }))
        }

        const relancer = async () => {
          setRelance('running')
          const r = await post('/kybernos-hub/relaunch', { confirm: true })
          if (r.ok !== true) { setRelance('error'); return }
          // DSH goes down and comes back: wait for the server, then reload the page.
          const debut = Date.now()
          const attendre = async () => {
            const e = await lireJson('/kybernos-hub/state')
            if (e !== null && e.ok === true && Date.now() - debut > 4000) { window.location.reload(); return }
            if (Date.now() - debut > 120000) { setRelance('error'); return }
            setTimeout(attendre, 2000)
          }
          setTimeout(attendre, 3000)
        }

        const verifier = async () => {
          setVerifie(true); setResume('')
          await recharger()
          setVerifie(false)
          setResume(kt('Catalogue livré avec la suite : à jour. Pas de catalogue en ligne pour l’instant.', 'Catalogue shipped with the suite: up to date. No online catalogue yet.'))
        }

        // What one module shows, shared by the grid card and the list row so both views use
        // the same states, strings, buttons and switch rules. `compact` = the one-line row.
        const cardParts = (m, compact) => {
          const bundle = installes.get(m.nom) || null
          const etat = etatCarte({ module: m, bundle, occupe: occupes[m.id] === true, enAttente: enAttente[m.id] === true, securite: safe })
          const fam = suite.catalogue.familles.find((f) => f.id === m.famille) || { icone: 'box' }
          const verrou = m.socle === true || (bundle !== null && bundle.readOnly === true)
          const comp = bundle !== null && bundle.enabled === true ? composantReglages(m.nom) : null
          const estOuvert = ouvert === m.id && comp !== null
          const parts = { bundle, etat, fam, comp, estOuvert, statut: null, install: null, reglages: null, sw: null }
          if (etat === 'busy') {
            const long = kt('Installation en cours : photo de sécurité, liaison, contrôle du démarrage. Quelques minutes.', 'Installing: safety snapshot, link, boot check. A few minutes.')
            parts.statut = h('span', { className: 'kbsu-st', title: compact ? long : undefined }, ic('refresh', 'spin'), compact ? kt('Installation…', 'Installing…') : long)
          } else if (etat === 'pending') {
            parts.statut = h('span', { className: 'kbsu-st ok' }, ic('check'), kt('Actif après relance', 'Active after restart'))
          } else if (etat === 'available') {
            parts.statut = h('span', { className: 'kbsu-st' }, kt('Non installé', 'Not installed'))
            parts.install = h('button', { type: 'button', className: 'kbsu-btn sm', onClick: () => installer(m) }, kt('Installer', 'Install'))
          } else if (etat === 'update') {
            parts.statut = h('span', { className: 'kbsu-st warn' }, ic('refresh'), kt('Version ', 'Version ') + m.version + kt(' disponible', ' available'))
            parts.install = h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: () => installer(m) }, kt('Mettre à jour', 'Update'))
          } else {
            const actif = etat === 'active'
            // The row says "Base" for an active base module (the card keeps "Active" + its BASE badge).
            const libelle = actif ? (compact && m.socle === true ? kt('Socle', 'Base') : kt('Actif', 'Active')) : etat === 'safe' ? kt('Désactivé par le mode sans échec', 'Off in safe mode') : kt('Désactivé', 'Off')
            parts.statut = h('span', { className: 'kbsu-st ' + (actif ? 'ok' : etat === 'safe' ? 'warn' : '') }, actif ? ic('check') : etat === 'safe' ? ic('alert') : null, libelle)
            if (comp !== null) parts.reglages = h('button', { type: 'button', className: 'kbsu-btn ghost sm', 'aria-expanded': estOuvert ? 'true' : 'false', onClick: () => setOuvert(estOuvert ? null : m.id) }, kt('Paramètres', 'Settings'))
            parts.sw = h('button', { type: 'button', className: 'kbsu-sw' + (actif ? ' on' : ''), role: 'switch', 'aria-checked': actif ? 'true' : 'false', 'aria-label': (actif ? kt('Désactiver ', 'Turn off ') : kt('Activer ', 'Turn on ')) + m.id, title: verrou ? kt('Socle : toujours actif', 'Base: always on') : '', disabled: verrou || mgr === null, onClick: () => basculer(m, bundle) }, h('i'))
          }
          return parts
        }

        const carte = (m) => {
          const p = cardParts(m, false)
          return h('article', { key: m.id, className: 'kbsu-card' + (p.estOuvert ? ' open' : '') + (p.etat === 'safe' ? ' dim' : ''), 'data-kb': 'suite-card', 'data-id': m.id, 'data-etat': p.etat },
            h('div', { className: 'kbsu-top' }, h('div', { className: 'kbsu-ico' }, ic(p.fam.icone)), h('div', { className: 'kbsu-name' }, h('b', null, m.id), h('small', null, 'v' + (p.bundle !== null && typeof p.bundle.version === 'string' ? p.bundle.version : m.version)))),
            h('p', { className: 'kbsu-promise' }, kt(m.promesse.fr, m.promesse.en)),
            h('div', { className: 'kbsu-badges' }, h('span', { className: 'kbsu-b' }, m.socle ? kt('SOCLE', 'BASE') : 'CORE')),
            notes[m.id] ? h('p', { className: 'kbsu-note', role: 'status' }, notes[m.id]) : null,
            h('div', { className: 'kbsu-foot' }, p.statut, p.install, p.reglages !== null || p.sw !== null ? h('span', { className: 'kbsu-right' }, p.reglages, p.sw) : null),
            p.estOuvert ? h('div', { className: 'kbsu-cfg', 'data-kb': 'suite-config' }, h(p.comp, { key: m.nom })) : null)
        }

        // ── Reordering (list view). The order is saved after every change, in this browser only.
        const visibleIds = visibles.map((m) => m.id)
        const saveOrder = (next, id) => {
          setOrder(next)
          setOrderSaved(writeOrder(browserStore(), storableOrder(modules, next)))
          const shown = next.filter((x) => visibleIds.indexOf(x) >= 0)
          setAnnounce(kt('« ' + id + ' » : position ' + (shown.indexOf(id) + 1) + ' sur ' + shown.length, '“' + id + '” moved to position ' + (shown.indexOf(id) + 1) + ' of ' + shown.length))
        }
        const moveRow = (id, step) => {
          const next = moveBy(fullOrder, visibleIds, id, step)
          if (sameIds(next, fullOrder)) return
          refocus.current = { id, dir: step < 0 ? 'up' : 'down' }
          saveOrder(next, id)
        }
        const resetOrder = () => {
          setOrder([]); setOrderSaved(true); writeOrder(browserStore(), null)
          setAnnounce(kt('Ordre par défaut rétabli', 'Default order restored'))
        }
        const chooseView = (v) => { setView(v); writeView(browserStore(), v) }

        // HTML5 drag and drop. The drag starts on the row (when its settings are closed) or on
        // its grip; the drop target is another row, and the pointer's half of that row says
        // whether the dragged row lands before or after it (the orange line shows it).
        const dragEnd = () => { dragRef.current = null; setDragId(null); setDropAt(null) }
        const dropBefore = (e) => { const main = e.currentTarget.firstElementChild || e.currentTarget; const r = main.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 }
        const rowDragStart = (e, id) => {
          // A draggable element inside an open settings panel is not ours.
          if (e.target !== e.currentTarget && !(e.target.dataset && e.target.dataset.kb === 'suite-grip')) return
          dragRef.current = id
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) } catch (er) { /* some browsers refuse */ }
          try { e.dataTransfer.setDragImage(e.currentTarget, 16, 16) } catch (er) { /* default ghost */ }
          // Styling the source in the same tick would also fade the drag image.
          setTimeout(() => { if (dragRef.current === id) setDragId(id) }, 0)
        }
        const rowDragOver = (e, id) => {
          if (dragRef.current === null) return
          e.preventDefault()
          try { e.dataTransfer.dropEffect = 'move' } catch (er) { /* ignore */ }
          const before = dropBefore(e)
          const next = id === dragRef.current ? null : { id, before }
          setDropAt((d) => ((d === null && next === null) || (d !== null && next !== null && d.id === next.id && d.before === next.before) ? d : next))
        }
        const rowDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null) }
        const rowDrop = (e, id) => {
          const src = dragRef.current
          if (src === null) return
          e.preventDefault()
          const before = dropBefore(e)
          dragEnd()
          const next = moveTo(fullOrder, src, id, before)
          if (!sameIds(next, fullOrder)) saveOrder(next, src)
        }

        const row = (m, i, n) => {
          const p = cardParts(m, true)
          const cls = 'kbsu-row' + (p.estOuvert ? ' open' : '') + (p.etat === 'safe' ? ' dim' : '') + (dragId === m.id ? ' dragging' : '') + (dropAt !== null && dropAt.id === m.id ? (dropAt.before ? ' drop-before' : ' drop-after') : '')
          return h('li', { key: m.id, className: cls, 'data-kb': 'suite-row', 'data-id': m.id, 'data-etat': p.etat, draggable: !p.estOuvert, onDragStart: (e) => rowDragStart(e, m.id), onDragOver: (e) => rowDragOver(e, m.id), onDragLeave: rowDragLeave, onDrop: (e) => rowDrop(e, m.id), onDragEnd: dragEnd },
            h('div', { className: 'kbsu-rowmain' },
              h('span', { className: 'kbsu-grip', draggable: true, 'data-kb': 'suite-grip', 'aria-hidden': 'true', title: kt('Glisser pour réordonner', 'Drag to reorder') }, ic('grip')),
              h('div', { className: 'kbsu-ico' }, ic(p.fam.icone)),
              h('div', { className: 'kbsu-rowname' }, h('b', { title: m.id }, m.id), h('span', { className: 'kbsu-promise', title: kt(m.promesse.fr, m.promesse.en) }, kt(m.promesse.fr, m.promesse.en))),
              h('span', { className: 'kbsu-famcol' }, h('span', { className: 'kbsu-b kbsu-famtag', title: p.fam.fr ? kt(p.fam.fr, p.fam.en) : undefined }, p.fam.fr ? kt(p.fam.fr, p.fam.en) : '')),
              p.statut,
              h('span', { className: 'kbsu-right kbsu-rowact' }, p.install, p.reglages, p.sw),
              h('span', { className: 'kbsu-mv' },
                h('button', { type: 'button', className: 'kbsu-ib', 'data-kb': 'suite-up', disabled: i === 0, 'aria-label': kt('Monter ', 'Move up ') + m.id, title: kt('Monter', 'Move up'), onClick: () => moveRow(m.id, -1) }, ic('up')),
                h('button', { type: 'button', className: 'kbsu-ib', 'data-kb': 'suite-down', disabled: i === n - 1, 'aria-label': kt('Descendre ', 'Move down ') + m.id, title: kt('Descendre', 'Move down'), onClick: () => moveRow(m.id, 1) }, ic('down')))),
            notes[m.id] ? h('p', { className: 'kbsu-note', role: 'status' }, notes[m.id]) : null,
            p.estOuvert ? h('div', { className: 'kbsu-cfg', 'data-kb': 'suite-config' }, h(p.comp, { key: m.nom })) : null)
        }

        const familles = suite.catalogue.familles.map((f) => {
          const items = visibles.filter((m) => m.famille === f.id)
          if (items.length === 0) return null
          return h('div', { key: f.id, className: 'kbsu-fam' }, h('h5', null, kt(f.fr, f.en), h('span', null, kt(f.ligne.fr, f.ligne.en))), h('div', { className: 'kbsu-grid' }, items.map(carte)))
        })

        const segment = (id, libelle, n) => h('button', { key: id, type: 'button', 'aria-pressed': filtre === id ? 'true' : 'false', onClick: () => { setFiltre(id); setResume('') } }, libelle, h('span', { className: 'c' }, n))
        const dshVersion = charge.maint && charge.maint.global ? charge.maint.global : null

        const viewButton = (id, libelle, court, icone) => h('button', { key: id, type: 'button', 'data-kb': 'suite-view-' + id, 'aria-pressed': view === id ? 'true' : 'false', 'aria-label': libelle, title: libelle, onClick: () => chooseView(id) }, ic(icone), court)
        const aucun = h('div', { className: 'kbsu-empty' }, kt('Aucun module ne correspond.', 'No module matches.'))
        const orderLine = custom ? (orderSaved ? kt('Ordre personnalisé, enregistré dans ce navigateur', 'Custom order, saved in this browser') : kt('Ordre personnalisé, non enregistré (stockage du navigateur indisponible)', 'Custom order, not saved (browser storage unavailable)')) : kt('Ordre par défaut', 'Default order')

        return h('div', { className: 'kbsu', 'data-kb': 'suite', ref: rootRef },
          h('div', { className: 'kbsu-head' },
            h('div', null, h('h4', null, 'Kybernos Suite'), h('p', null, kt('Les modules Kybernos de ce poste. Activez, installez ou ouvrez les paramètres sans quitter les Réglages.', 'The Kybernos modules on this machine. Switch, install or open settings without leaving Settings.'))),
            h('div', { className: 'kbsu-headr' },
              h('span', { className: 'kbsu-right' },
                ouvrirGestionnaire !== null ? h('button', { type: 'button', className: 'kbsu-btn ghost', 'data-kb': 'suite-native', onClick: ouvrirGestionnaire }, ic('plug'), kt('Gestionnaire natif', 'Native manager')) : null,
                h('button', { type: 'button', className: 'kbsu-btn', disabled: verifie, onClick: verifier }, ic('refresh', verifie ? 'spin' : ''), verifie ? kt('Vérification…', 'Checking…') : kt('Actualiser', 'Refresh'))),
              h('div', { className: 'kbsu-meta' },
                dshVersion !== null ? h('span', null, h('span', { className: 'kbsu-dot' + (horsZone ? ' warn' : '') }), 'DSH ' + dshVersion + (horsZone ? kt(' · hors de la zone testée', ' · outside the tested range') : kt(' · dans la zone testée', ' · inside the tested range'))) : null,
                h('span', null, kt('Catalogue livré avec la suite', 'Catalogue shipped with the suite'))))),
          safe ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Mode sans échec actif : seul le socle est chargé.', 'Safe mode is on: only the base is loaded.')), h('span', null, kt('Pour en sortir : ', 'To leave it: '), h('code', null, 'node scripts/dsh-lifecycle.mjs safe-mode off'))) : null,
          (!safe && reco.mode === 'safe-recommande') ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Plusieurs démarrages récents ont échoué.', 'Several recent boots failed.')), h('span', null, String(reco.raison || ''), ' ', h('code', null, 'node scripts/dsh-lifecycle.mjs safe-mode status'))) : null,
          nbEnAttente > 0 ? h('div', { className: 'kbsu-relance', role: 'status' },
            h('span', null, h('b', null, nbEnAttente + (nbEnAttente > 1 ? kt(' changements en attente. ', ' changes pending. ') : kt(' changement en attente. ', ' change pending. '))), kt('Relancez DSH pour les activer.', 'Restart DSH to turn them on.')),
            relance === 'running' ? h('span', { className: 'kbsu-st' }, ic('refresh', 'spin'), kt('Relance en cours… la page va se recharger.', 'Restarting… the page will reload.'))
              : confirmerRelance ? h('span', { className: 'kbsu-right' }, h('span', { className: 'kbsu-st warn' }, kt('Les sessions en cours seront interrompues, puis reprises.', 'Running sessions will be interrupted, then resumed.')),
                h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: relancer }, kt('Relancer maintenant', 'Restart now')),
                h('button', { type: 'button', className: 'kbsu-btn sm ghost', onClick: () => setConfirmerRelance(false) }, kt('Annuler', 'Cancel')))
                : h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: () => setConfirmerRelance(true) }, kt('Relancer DSH', 'Restart DSH')),
            relance === 'error' ? h('span', { className: 'kbsu-st bad' }, kt('Relance impossible depuis ici : demandez à l’agent « relance DSH ».', 'Cannot restart from here: ask the agent to "restart DSH".')) : null) : null,
          mgr === null ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Gestionnaire de plugins indisponible.', 'Plugin manager unavailable.')), h('span', null, kt('Le catalogue s’affiche, mais l’état installé et les interrupteurs ne sont pas disponibles sur cette version de DSH.', 'The catalogue shows, but installed state and switches are unavailable on this DSH version.'))) : null,
          h('div', { className: 'kbsu-bar' },
            h('div', { className: 'kbsu-seg', role: 'group', 'aria-label': kt('Filtre', 'Filter') },
              segment('all', kt('Tous', 'All'), modules.length), segment('installed', kt('Installés', 'Installed'), nbInstalles), segment('available', kt('Disponibles', 'Available'), modules.length - nbInstalles), segment('updates', kt('Mises à jour', 'Updates'), nbMaj)),
            h('label', { className: 'kbsu-search' }, ic('search'), h('input', { type: 'search', value: requete, placeholder: kt('Rechercher un module…', 'Search a module…'), 'aria-label': kt('Rechercher un module', 'Search a module'), onChange: (e) => { setRequete(e.target.value); setResume('') } })),
            h('span', { className: 'kbsu-right' },
              h('div', { className: 'kbsu-seg view', role: 'group', 'aria-label': kt('Affichage', 'View') },
                viewButton('grid', kt('Vue en grille', 'Grid view'), kt('Grille', 'Grid'), 'grid'), viewButton('list', kt('Vue en liste', 'List view'), kt('Liste', 'List'), 'list')),
              custom ? h('button', { type: 'button', className: 'kbsu-btn ghost sm', 'data-kb': 'suite-order-reset', onClick: resetOrder }, ic('reset'), kt('Réinitialiser l’ordre', 'Reset order')) : null)),
          h('div', { className: 'kbsu-subbar' },
            h('div', { className: 'kbsu-summary', role: 'status', 'aria-live': 'polite' }, resume || (nbInstalles + kt(' installés · ', ' installed · ') + (modules.length - nbInstalles) + kt(' disponibles', ' available') + (nbMaj > 0 ? ' · ' + nbMaj + kt(' mise(s) à jour', ' update(s)') : ''))),
            h('span', { className: 'kbsu-st' + (custom && !orderSaved ? ' warn' : ''), 'data-kb': 'suite-order-status' }, orderLine)),
          h('div', { className: 'kbsu-sr', role: 'status', 'aria-live': 'polite' }, announce),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 22 } }, view === 'list'
            ? (visibles.length > 0 ? h('ul', { className: 'kbsu-list', role: 'list', 'data-kb': 'suite-list' }, visibles.map((m, i) => row(m, i, visibles.length))) : aucun)
            : (familles.some((f) => f !== null) ? familles : aucun)))
      }
      return Panneau
    }

    const monterSuite = (ctx, scope, require) => {
      try {
        const slots = scope.slots
        if (slots == null || typeof slots.inject !== 'function') return
        const React = typeof require === 'function' ? require('react') : null
        if (React == null) return
        ctx.effect(() => { const s = document.createElement('style'); s.dataset.plugin = '@local/kybernos-hub'; s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'kybernos-hub: suite styles')
        const Panneau = construirePanneau(React, scope, ctx)
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-suite', order: 29, label: 'Kybernos Suite' },
          () => React.createElement(Panneau))), 'kybernos-hub: suite section')
      } catch (e) { /* the panel is optional: the boot beacon must survive it */ }
    }

    // The Suite panel needs Settings slots and DSH's native plugin manager. They are
    // requested here, AFTER the beacons are armed, and inside try/catch: an engine that
    // lacks one of them loses the panel, never the boot guard.
    const appliquerSuite = (ctx) => {
      const demander = (liste, repli) => {
        try {
          ctx.inject(liste, (scope) => { monterSuite(ctx, scope || {}, require) })
          return true
        } catch (e) { return repli === undefined ? false : repli() }
      }
      demander(['slots', 'remote', 'remote.pluginManager', 'layout'], () => demander(['slots', 'remote', 'remote.pluginManager'], () => demander(['slots', 'remote'])))
    }

    const demarrer = (ctx) => { apply(ctx); try { appliquerSuite(ctx) } catch (e) { /* optional */ } }

    return { name: NAME, inject: [], apply: demarrer, __test: { ROUTE, ALIVE_AFTER_MS, TICK_MS, lireEchec, comparerVersions, deballer, etatCarte, filtrer, ORDER_KEY, VIEW_KEY, parseOrder, effectiveOrder, applyOrder, isCustomOrder, storableOrder, moveTo, moveBy, browserStore, readOrder, writeOrder, readView, writeView } }
  }
})
