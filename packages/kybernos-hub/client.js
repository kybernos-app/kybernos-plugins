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
      try {
        const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
        const s = String(l || '')
        // French only when the resolved language IS French (the 'kybernos' default
        // or a fr base); every other language — translated (es…) or not — gets
        // English, never French.
        return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
      } catch (e) { return 'fr' }
    }
    const kt = (fr, en) => (lang() === 'fr' ? fr : en)

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

    /** Pure. The title a module shows: its human name, the id when the catalogue has none. */
    const titreDe = (m) => (m !== null && m !== undefined && typeof m.titre === 'string' && m.titre !== '' ? m.titre : String(m.id))

    /** Pure. Is the installed DSH inside the range the suite was tested on? `compat` = the maintenance payload's
     *  { min, max, horsZone } (null when unknown). 'ok' | 'hors' | 'inconnu'. */
    const verdictCompat = (compat) => {
      if (compat === null || compat === undefined) return 'inconnu'
      return compat.horsZone === true ? 'hors' : 'ok'
    }

    /** Pure. Filter + search. `filtre` is all | featured | installed | available | updates; `famille` ('' = every family).
     *  It keeps the order it is given, except Featured, which follows the catalogue's rank (`vedette`). `installes` is a
     *  Map name → bundle. */
    const filtrer = ({ modules, filtre, requete, installes, famille }) => {
      const q = String(requete || '').trim().toLowerCase()
      const out = modules.filter((m) => {
        if (famille !== undefined && famille !== '' && m.famille !== famille) return false
        if (q !== '') {
          const hay = (m.id + ' ' + titreDe(m) + ' ' + m.promesse.fr + ' ' + m.promesse.en).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        const b = installes.get(m.nom)
        if (filtre === 'featured') return typeof m.vedette === 'number'
        if (filtre === 'installed') return b !== undefined
        if (filtre === 'available') return b === undefined
        if (filtre === 'updates') return b !== undefined && typeof b.version === 'string' && comparerVersions(b.version, m.version) < 0
        return true
      })
      return filtre === 'featured' ? out.slice().sort((x, y) => x.vedette - y.vedette) : out
    }

    /** Pure. What to say about the answer of POST /kybernos-hub/catalogue/refresh. [fr, en]. */
    const messageCatalogue = (r) => {
      if (r === null || r === undefined || typeof r !== 'object') return ['Réponse illisible.', 'Unreadable answer.']
      // A DSH started before this version answers 404 (not JSON): `post` reports it as bad-response.
      if (r.error === 'bad-response' || r.error === 'network') return ['Le serveur DSH n’a pas encore chargé cette version : redémarrez-le.', 'The DSH server has not loaded this version yet: restart it.']
      if (r.ok === true) {
        return r.etat === 'nouveau'
          ? ['La suite ' + r.suite + ' est disponible (catalogue signé du ' + String(r.publieLe || '').slice(0, 10) + ').', 'Suite ' + r.suite + ' is available (signed catalogue of ' + String(r.publieLe || '').slice(0, 10) + ').']
          : ['Catalogue signé à jour (suite ' + r.suite + ').', 'Signed catalogue up to date (suite ' + r.suite + ').']
      }
      const t = {
        'pas-de-cle': ['Aucune clé de signature n’est installée : le catalogue en ligne ne peut pas être vérifié, il n’est donc pas demandé.', 'No signing key is installed: the online catalogue cannot be verified, so it is not asked for.'],
        url: ['L’adresse du catalogue n’est pas une adresse https valide (réglage catalogueUrl).', 'The catalogue address is not a valid https address (the catalogueUrl setting).'],
        reseau: ['Le catalogue en ligne est injoignable pour l’instant.', 'The online catalogue cannot be reached right now.'],
        signature: ['Le catalogue en ligne n’est pas signé par une clé de confiance : ignoré.', 'The online catalogue is not signed by a trusted key: ignored.'],
        'plus-ancien': ['Le catalogue en ligne est plus ancien que la suite installée : ignoré.', 'The online catalogue is older than the installed suite: ignored.'],
        forme: ['Le catalogue en ligne est mal formé : ignoré.', 'The online catalogue is malformed: ignored.'],
        taille: ['Le catalogue en ligne a une taille anormale : ignoré.', 'The online catalogue has an unusual size: ignored.'],
        cache: ['Impossible d’enregistrer le catalogue vérifié sur le disque.', 'Could not save the verified catalogue to disk.'],
        busy: ['Une opération est déjà en cours.', 'Another operation is already running.']
      }
      return t[r.erreur] || ['Catalogue en ligne refusé (' + String(r.erreur) + ').', 'Online catalogue refused (' + String(r.erreur) + ').']
    }

    /** Pure. Why an update cannot be applied from this page. [fr, en] or null when it can. */
    const raisonMiseAJour = (distant) => {
      if (distant === null || distant === undefined || distant.miseAJour === undefined || distant.miseAJour.possible === true) return null
      const t = {
        'development-checkout': ['Ce poste est une copie de développement (git) : mettez-la à jour avec git, pas avec une archive.', 'This machine is a development checkout (git): update it with git, not with an archive.'],
        'no-archive-for-platform': ['Cette version n’a pas d’archive pour ce système.', 'This release has no archive for this system.'],
        'no-key': ['Aucune clé de signature n’est installée.', 'No signing key is installed.'],
        'no-release': ['Aucun catalogue en ligne vérifié : cherchez les mises à jour d’abord.', 'No verified online catalogue: check for updates first.'],
        'up-to-date': ['La suite est à jour.', 'The suite is up to date.']
      }
      return t[distant.miseAJour.raison] || [String(distant.miseAJour.raison), String(distant.miseAJour.raison)]
    }

    /** Pure. The line shown while the update runs, and when it ends. [fr, en]. */
    const messageMiseAJour = (t) => {
      if (t === null || t === undefined) return null
      const etapes = { telechargement: ['Téléchargement de l’archive…', 'Downloading the archive…'], extraction: ['Vérification et extraction…', 'Verifying and extracting…'], installation: ['Installation : photo de sécurité, liaison, contrôle du démarrage…', 'Installing: safety snapshot, link, boot check…'] }
      if (etapes[t.etat] !== undefined) return etapes[t.etat]
      if (t.etat === 'termine') return ['Suite ' + t.version + ' installée. Relancez DSH pour l’activer.', 'Suite ' + t.version + ' installed. Restart DSH to turn it on.']
      if (t.etat === 'echec') {
        const e = { 'digest-mismatch': ['L’archive téléchargée ne correspond pas à l’empreinte signée : rien n’a été installé.', 'The downloaded archive does not match the signed digest: nothing was installed.'], 'robot-refused': ['L’installation a été refusée et annulée : votre installation actuelle est intacte.', 'The install was refused and rolled back: your current install is intact.'], 'bad-archive': ['L’archive est invalide : rien n’a été installé.', 'The archive is invalid: nothing was installed.'] }
        return e[t.erreur] || ['Mise à jour échouée (' + String(t.erreur) + ').', 'Update failed (' + String(t.erreur) + ').']
      }
      return null
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
      // family filter chips (no group headings: the chips filter, each card carries its family)
      '.kbsu-fams{display:flex;flex-wrap:wrap;gap:6px}',
      '.kbsu-fb{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.kbsu-fb[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}',
      '.kbsu-fb i,.kbsu-chip.fam i{width:8px;height:8px;border-radius:3px;background:var(--c);display:inline-block}',
      '.kbsu-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}',
      '.kbsu-chip.fam{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.kbsu-chip.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}',
      '.kbsu-chip.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}',
      '.kbsu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}',
      '.kbsu-card{display:flex;flex-direction:column;gap:9px;padding:13px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.kbsu-card.open{grid-column:1/-1}',
      '.kbsu-card.dim{opacity:.85}',
      '.kbsu-top{display:flex;gap:10px;align-items:flex-start}',
      // The module's artwork: a glyph on a tile coloured by its family (--c).
      '.kbsu-ico{width:40px;height:40px;border-radius:11px;background:radial-gradient(120% 120% at 20% 10%,color-mix(in srgb,var(--c) 70%,#fff) 0,var(--c) 38%,color-mix(in srgb,var(--c) 55%,#000) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 2px 6px rgba(0,0,0,.18);display:grid;place-items:center;flex:none}',
      '.kbsu-ico svg{width:26px;height:26px}.kbsu-ico.mid{width:52px;height:52px;border-radius:14px}.kbsu-ico.mid svg{width:35px;height:35px}.kbsu-ico.big{width:76px;height:76px;border-radius:19px}.kbsu-ico.big svg{width:51px;height:51px}',
      '.kbsu svg .a{fill:rgba(255,255,255,.30)}.kbsu svg .b{fill:rgba(255,255,255,.58)}.kbsu svg .w{fill:#fff}.kbsu svg .d{fill:rgba(0,0,0,.22)}.kbsu svg .l{fill:none;stroke:#fff;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
      '.kbsu-name{min-width:0;flex:1}',
      '.kbsu-name b{display:block;font-size:14.5px;font-weight:650;overflow-wrap:anywhere}',
      '.kbsu-name small{display:block;color:var(--dsw-alias-label-tertiary);font:11.5px ui-monospace,Menlo,monospace}',
      '.kbsu-card{cursor:pointer}.kbsu-card:hover{border-color:var(--dsw-alias-label-tertiary)}.kbsu-card.open{cursor:default}',
      '.kbsu-row{cursor:pointer}',
      // Featured: the same cards, larger, with the tagline and the full description
      '.kbsu-fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}',
      '.kbsu-vedette{padding:16px;gap:12px}',
      '.kbsu-tag{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ff7a1a;font-weight:700}',
      '.kbsu-vedette .kbsu-promise{font-size:13.5px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
      '.kbsu-promise{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.kbsu-badges{display:flex;flex-wrap:wrap;gap:6px}',
      '.kbsu-b{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
      '.kbsu-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:auto}',
      '.kbsu-st{font-size:12.5px;color:var(--dsw-alias-label-tertiary);display:inline-flex;gap:6px;align-items:center;min-width:0}',
      '.kbsu-st.ok{color:var(--dsw-alias-state-success-primary)}.kbsu-st.warn{color:var(--dsw-alias-state-warn-primary)}.kbsu-st.bad{color:var(--dsw-alias-state-error-primary)}',
      '.kbsu-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px;counter-reset:kbsu-s}',
      '.kbsu-steps li{display:flex;gap:10px;align-items:flex-start;color:var(--dsw-alias-label-secondary);counter-increment:kbsu-s}',
      '.kbsu-steps li::before{content:counter(kbsu-s);flex:none;width:20px;height:20px;border-radius:50%;margin-top:0;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kbsu-where,.kbsu-good{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-where b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.kbsu-good{padding-inline-start:12px;border-inline-start:2px solid var(--dsw-alias-border-l3)}',
      // The « ? How it works » button of any plugin page, and the card it opens (window.__KB_HELP__.Help).
      '.kbhp-wrap{position:relative;display:inline-block;max-width:100%}',
      '.kbhp-btn{appearance:none;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 6px;border-radius:16px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}',
      '.kbhp-btn:hover,.kbhp-btn[aria-expanded="true"]{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-primary)}',
      '.kbhp-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.kbhp-q{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kbhp-pop{box-sizing:border-box;position:absolute;inset-inline-end:0;top:calc(100% + 8px);z-index:60;width:min(420px,calc(100vw - 32px));max-height:min(70vh,560px);overflow-y:auto;padding:16px 18px;border-radius:18px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);text-align:start;white-space:normal;font-size:14px;line-height:1.5;background:linear-gradient(var(--dsw-specific-menu,#1c1c1f),var(--dsw-specific-menu,#1c1c1f)),var(--dsw-alias-bg-base,#151517);box-shadow:0 16px 44px rgba(0,0,0,.42);display:flex;flex-direction:column;gap:12px}',
      '.kbhp-pop h4{margin:0;font-size:17px;font-weight:700}',
      '.kbhp-pop h5{margin:0 0 8px;font-size:11.5px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.kbhp-pop p{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.kbhp-pop.start{inset-inline-end:auto;inset-inline-start:0}',
      '.kbhp-x{position:absolute;inset-inline-end:10px;top:10px;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px}',
      '.kbhp-x:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kbhp-act{appearance:none;align-self:flex-start;display:inline-flex;align-items:center;height:30px;padding:0 14px;border-radius:9px;border:0;font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kbsu-right{display:inline-flex;gap:8px;align-items:center}',
      '.kbsu-sw{position:relative;flex:none;width:36px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0}',
      '.kbsu-sw i{position:absolute;inset-inline-start:2px;top:2px;width:14px;height:14px;border-radius:999px;background:var(--dsw-alias-label-secondary);transition:inset-inline-start .15s ease}',
      '.kbsu-sw.on{background:#ff7a1a;border-color:#ff7a1a}.kbsu-sw.on i{inset-inline-start:18px;background:#fff}',
      '.kbsu-note{margin:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-line}',
      '.kbsu-cfg{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}',
      // the module's own page
      '.kbsu-crumb{display:flex;gap:8px;align-items:center;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-hero{display:flex;flex-wrap:wrap;gap:18px;align-items:center;padding:20px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.kbsu-htitle{flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px}',
      '.kbsu-htitle h4{margin:0;font-size:24px;font-weight:800;letter-spacing:-.01em}',
      '.kbsu-htitle p{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-hact{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.kbsu-cols{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:14px;align-items:start}',
      '.kbsu-panel{border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.kbsu-tabs{display:flex;gap:4px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.kbsu-tabs button{border:0;background:none;height:42px;padding:0 10px;color:var(--dsw-alias-label-secondary);border-bottom:2px solid transparent;font:inherit}',
      '.kbsu-tabs button[aria-selected="true"]{color:var(--dsw-alias-label-primary);border-color:#ff7a1a}',
      '.kbsu-body{padding:18px;display:flex;flex-direction:column;gap:16px}',
      '.kbsu-body p{margin:0;color:var(--dsw-alias-label-secondary);max-width:68ch}',
      '.kbsu-body h5{margin:0;font-size:14px}',
      '.kbsu-ticks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}',
      '.kbsu-ticks li{display:flex;gap:10px;align-items:flex-start;color:var(--dsw-alias-label-secondary)}',
      '.kbsu-ticks li::before{content:"✓";flex:none;width:18px;height:18px;border-radius:6px;margin-top:1px;display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--c) 30%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 60%,transparent)}',
      '.kbsu-dl{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px 10px;font-size:13px;margin:0}',
      '.kbsu-dl dt{color:var(--dsw-alias-label-tertiary)}.kbsu-dl dd{margin:0;overflow-wrap:anywhere}',
      '.kbsu-side{padding:16px;display:flex;flex-direction:column;gap:12px}',
      '@media (max-width:700px){.kbsu-cols{grid-template-columns:1fr}.kbsu-fgrid{grid-template-columns:1fr}}',
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

    // The artwork of a module: a 32px glyph in three tones (a / b translucent fills, l strokes, w solid, d shade), drawn on a
    // tile coloured by the module's family. The catalogue names the glyph (`glyphe`); an unknown name falls back to the cube.
    const GLYPHES = {
      cube:'<path class="a" d="M16 3.5l11.5 6.5v12L16 28.5 4.5 22V10z"/><path class="b" d="M16 16l11.5-6v12L16 28.5z"/><path class="l" d="M16 3.5l11.5 6.5v12L16 28.5 4.5 22V10zM4.5 10L16 16l11.5-6M16 16v12.5"/><circle class="w" cx="16" cy="16" r="1.8"/>',
      palette:'<path class="a" d="M16 3a13 13 0 1 0 0 26c2 0 3-1.2 3-2.6 0-1.9-1.6-2.2-1.6-3.8 0-1.4 1.1-2.2 2.6-2.2H23a6 6 0 0 0 6-6C29 8 23.5 3 16 3z"/><path class="l" d="M16 3a13 13 0 1 0 0 26c2 0 3-1.2 3-2.6 0-1.9-1.6-2.2-1.6-3.8 0-1.4 1.1-2.2 2.6-2.2H23a6 6 0 0 0 6-6C29 8 23.5 3 16 3z"/><circle class="w" cx="9.5" cy="14" r="2"/><circle class="w" cx="14" cy="8.5" r="2"/><circle class="w" cx="20.5" cy="9" r="2"/><circle class="b" cx="9" cy="20" r="2"/>',
      lang:'<rect class="a" x="3" y="4" width="17" height="14" rx="4"/><path class="d" d="M9 18l-1 5 5-4z"/><path class="l" d="M7.5 13.5L11.5 7l4 6.5M9 11.5h5"/><rect class="b" x="12" y="13" width="17" height="14" rx="4"/><path class="l" d="M17.5 17.5h8M21.5 16v1.5M18.5 24c3-1.5 4.5-3.5 5.2-6.5M24.5 24c-3-1-4.5-3-5-6.5"/>',
      chat:'<rect class="a" x="3" y="4" width="20" height="14" rx="4"/><rect class="b" x="9" y="12" width="20" height="14" rx="4"/><path class="l" d="M13.5 17.5h11M13.5 21h6"/><circle class="w" cx="8" cy="9" r="1.4"/><circle class="w" cx="12.5" cy="9" r="1.4"/><circle class="w" cx="17" cy="9" r="1.4"/>',
      info:'<circle class="a" cx="16" cy="16" r="13"/><circle class="l" cx="16" cy="16" r="13"/><circle class="b" cx="16" cy="16" r="8"/><path class="l" d="M16 14.5v6.5"/><circle class="w" cx="16" cy="10.7" r="1.4"/>',
      bolt:'<path class="a" d="M18.5 2L6 18h8l-2.5 12L26 12h-8.5z"/><path class="l" d="M18.5 2L6 18h8l-2.5 12L26 12h-8.5z"/><path class="w" d="M26 3.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 6l.6 1.4L7 8l-1.4.6L5 10l-.6-1.4L3 8l1.4-.6z"/>',
      slash:'<rect class="a" x="3" y="3.5" width="26" height="25" rx="7"/><rect class="l" x="3" y="3.5" width="26" height="25" rx="7"/><path class="l" d="M19 9l-6 14"/><path class="b" d="M7.5 22h5v2.5h-5zM20 22h4.5v2.5H20z"/>',
      refresh:'<circle class="a" cx="16" cy="16" r="12"/><path class="l" d="M6 14a10 10 0 0 1 17.5-5.5L26 11M26 5v6h-6M26 18a10 10 0 0 1-17.5 5.5L6 21M6 27v-6h6"/><circle class="w" cx="16" cy="16" r="2.6"/>',
      cpu:'<path class="l" d="M11 2v4M16 2v4M21 2v4M11 26v4M16 26v4M21 26v4M2 11h4M2 16h4M2 21h4M26 11h4M26 16h4M26 21h4"/><rect class="a" x="6" y="6" width="20" height="20" rx="4"/><rect class="l" x="6" y="6" width="20" height="20" rx="4"/><rect class="b" x="11" y="11" width="10" height="10" rx="2"/><path class="d" d="M13.5 16h5M16 13.5v5"/>',
      home:'<path class="a" d="M3 15L16 4l13 11v12H3z"/><path class="l" d="M3 15L16 4l13 11M6 13v14h20V13"/><rect class="b" x="11.5" y="14" width="9" height="9" rx="2"/><path class="l" d="M14 17h4M14 20h4"/>',
      route:'<circle class="b" cx="6.5" cy="16" r="3.5"/><path class="l" d="M10 16h5.5c2 0 3-2.5 5-6.5M15.5 16c2 0 3 0 5 0M15.5 16c2 0 3 2.5 5 6.5"/><rect class="a" x="21" y="4" width="8" height="8" rx="2.5"/><rect class="a" x="21" y="12.5" width="8" height="7" rx="2.5"/><rect class="b" x="21" y="21" width="8" height="8" rx="2.5"/><path class="l" d="M23 25l1.6 1.8L27.4 23"/><path class="l" d="M23 7l4 2M27 7l-4 2"/>',
      flow:'<rect class="a" x="3" y="5" width="17" height="5" rx="2.5"/><rect class="b" x="3" y="13.5" width="26" height="5" rx="2.5"/><rect class="a" x="3" y="22" width="12" height="5" rx="2.5"/><path class="w" d="M22 6.8l5 .9-5 .9z"/><path class="l" d="M25 22v7M25 22.5l5 1.8-5 1.8"/>',
      slides:'<rect class="a" x="3" y="4" width="26" height="18" rx="3"/><rect class="l" x="3" y="4" width="26" height="18" rx="3"/><path class="b" d="M8 19v-5h3v5zM13 19v-8h3v8zM18 19v-3h3v3z"/><path class="l" d="M23 14l2.5-3"/><path class="l" d="M10 27h12M16 22v5"/>',
      bricks:'<path class="a" d="M3 20l7 4v5l-7-4z"/><path class="b" d="M10 24l9-5v5l-9 5z"/><path class="a" d="M10 12l7 4-7 4-7-4z"/><path class="b" d="M17 7l7 4-7 4-7-4z"/><path class="l" d="M10 12l7 4-7 4-7-4zM17 7l7 4-7 4-7-4zM3 20l7 4 9-5"/><circle class="w" cx="17" cy="11" r="1.2"/><circle class="w" cx="10" cy="16" r="1.2"/>',
      box3d:'<path class="a" d="M16 3l12 7v12L16 29 4 22V10z"/><path class="l" d="M16 3l12 7v12L16 29 4 22V10zM4 10l12 7 12-7M16 17v12"/><path class="b" d="M16 17l12-7v12L16 29z"/><circle class="w" cx="16" cy="3" r="1.6"/><circle class="w" cx="28" cy="10" r="1.6"/><circle class="w" cx="4" cy="10" r="1.6"/><circle class="w" cx="16" cy="29" r="1.6"/>',
      app:'<rect class="a" x="5" y="3" width="22" height="26" rx="6"/><rect class="l" x="5" y="3" width="22" height="26" rx="6"/><rect class="b" x="9" y="8" width="14" height="9" rx="2.5"/><path class="l" d="M12 23.5h8"/><path class="w" d="M16 10.5v4M14 12.5h4"/>',
      link:'<path class="l" d="M13 19a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-1.5 1.5M19 13a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l1.5-1.5"/><rect class="b" x="2" y="2" width="10" height="7" rx="2.5"/><rect class="b" x="20" y="23" width="10" height="7" rx="2.5"/><path class="d" d="M4.5 5.5h5M22.5 26.5h5"/>',
      flowc:'<rect class="b" x="11" y="2.5" width="10" height="6" rx="2.5"/><path class="a" d="M16 12l6 4.5-6 4.5-6-4.5z"/><path class="l" d="M16 12l6 4.5-6 4.5-6-4.5zM16 8.5V12M16 21v3M22 16.5h3.5V24M10 16.5H6.5V24"/><rect class="b" x="2" y="24" width="9" height="6" rx="2"/><rect class="b" x="21" y="24" width="9" height="6" rx="2"/><rect class="a" x="11.5" y="24" width="9" height="6" rx="2"/>',
      db:'<path class="a" d="M4 7v18c0 2.2 5.4 4 12 4s12-1.8 12-4V7z"/><ellipse class="b" cx="16" cy="7" rx="12" ry="4"/><path class="l" d="M4 7v18c0 2.2 5.4 4 12 4s12-1.8 12-4V7M4 16c0 2.2 5.4 4 12 4s12-1.8 12-4"/><ellipse class="l" cx="16" cy="7" rx="12" ry="4"/><circle class="w" cx="22" cy="23.5" r="1.3"/>',
      play:'<rect class="a" x="3" y="5" width="26" height="18" rx="4"/><rect class="l" x="3" y="5" width="26" height="18" rx="4"/><circle class="b" cx="16" cy="14" r="5.5"/><path class="w" d="M14.6 11.5l4.4 2.5-4.4 2.5z"/><path class="l" d="M6 27h20"/><circle class="w" cx="14" cy="27" r="1.7"/>',
      plug:'<path class="l" d="M11 3v6M21 3v6"/><path class="a" d="M7 9h18v6a9 9 0 0 1-18 0z"/><path class="l" d="M7 9h18v6a9 9 0 0 1-18 0zM16 24v5"/><circle class="b" cx="16" cy="14" r="3.5"/><path class="w" d="M26 4.5l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z"/>',
      pc:'<rect class="a" x="3" y="5" width="26" height="17" rx="3"/><rect class="l" x="3" y="5" width="26" height="17" rx="3"/><path class="l" d="M10 27h12M16 22v5"/><path class="b" d="M20.5 18H12a3.5 3.5 0 1 1 .8-6.9 4.5 4.5 0 0 1 8.4 1.4 2.8 2.8 0 0 1-.7 5.5z"/>',
      wrench:'<path class="a" d="M20.5 4.5a7 7 0 0 0-6.8 9L3.5 23.7a3 3 0 0 0 4.3 4.3L18 17.8a7 7 0 0 0 9-6.8l-4 4-3.6-.6-.6-3.6 4-4a7 7 0 0 0-2.3-.3z"/><path class="l" d="M20.5 4.5a7 7 0 0 0-6.8 9L3.5 23.7a3 3 0 0 0 4.3 4.3L18 17.8a7 7 0 0 0 9-6.8l-4 4-3.6-.6-.6-3.6 4-4a7 7 0 0 0-2.3-.3z"/><circle class="w" cx="7" cy="25" r="1.4"/>',
      cloud:'<path class="a" d="M24 25H9a7 7 0 1 1 1.6-13.8A8 8 0 0 1 26 13.6 5.7 5.7 0 0 1 24 25z"/><path class="l" d="M24 25H9a7 7 0 1 1 1.6-13.8A8 8 0 0 1 26 13.6 5.7 5.7 0 0 1 24 25z"/><circle class="b" cx="16" cy="17.5" r="3"/><path class="l" d="M16 20.5v3"/>',
      brain:'<rect class="d" x="7" y="9" width="21" height="19" rx="4"/><rect class="a" x="5" y="6.5" width="21" height="19" rx="4"/><rect class="b" x="9" y="3" width="19" height="19" rx="4"/><path class="l" d="M13.5 9.5h10M13.5 13h10M13.5 16.5h6"/><path class="w" d="M23.5 18.3l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>',
      doc:'<path class="a" d="M7 3h13l6 6v20H7z"/><path class="b" d="M20 3l6 6h-6z"/><path class="l" d="M7 3h13l6 6v20H7zM11.5 15h10M11.5 19h10M11.5 23h6"/><path class="w" d="M11 10.5h3M11 8h6"/>',
      cal:'<rect class="a" x="3" y="6" width="26" height="22" rx="4"/><path class="b" d="M3 10a4 4 0 0 1 4-4h18a4 4 0 0 1 4 4v3H3z"/><path class="l" d="M3 13h26M10 3v6M22 3v6"/><path class="l" d="M10 21l3 3 6-7"/>'
}

    const ICONES = {
      box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12',
      plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
      check: 'M20 6 9 17l-5-5',
      alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
      refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
      search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM21 21l-4.3-4.3',
      grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM14 14h7v7h-7ZM3 14h7v7H3Z',
      list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
      grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
      up: 'm18 15-6-6-6 6',
      down: 'm6 9 6 6 6-6',
      reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
      back: 'm15 18-6-6 6-6'
    }

    const construirePanneau = (React, scope, ctx) => {
      const h = React.createElement
      const ic = (nom, extra) => h('svg', { className: 'i' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONES[nom] || ICONES.box }))
      // The module's artwork: its glyph on a tile coloured by its family. `taille` = '' | 'mid' | 'big'.
      const artwork = (m, fam, taille) => h('span', { className: 'kbsu-ico' + (taille ? ' ' + taille : ''), style: { '--c': (fam && fam.couleur) || '#5b6fd6' }, 'aria-hidden': 'true' },
        h('svg', { viewBox: '0 0 32 32', dangerouslySetInnerHTML: { __html: GLYPHES[m.glyphe] || GLYPHES.cube } }))
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
        const [filtreChoisi, setFiltre] = React.useState('featured')
        const [famille, setFamille] = React.useState('')
        const [detail, setDetail] = React.useState(null)
        const [ongletFiche, setOngletFiche] = React.useState('description')
        const [confirmerMaj, setConfirmerMaj] = React.useState(false)
        const [tacheMaj, setTacheMaj] = React.useState(null)
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
        // A host that predates the featured sheets serves a catalogue with none: Featured would be an empty page, so the panel opens on All.
        const filtre = filtreChoisi === 'featured' && !modules.some((m) => typeof m.vedette === 'number') ? 'all' : filtreChoisi
        const fullOrder = effectiveOrder(modules, order)
        const custom = isCustomOrder(modules, order)
        const visibles = filtrer({ modules: applyOrder(modules, order), filtre, requete, installes, famille })
        const nbInstalles = modules.filter((m) => installes.has(m.nom)).length
        const nbVedettes = modules.filter((m) => typeof m.vedette === 'number').length
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

        // "Check for updates": ask the online catalogue (the host verifies its signature; nothing unverified is ever shown), then reload.
        const verifier = async () => {
          setVerifie(true); setResume('')
          const r = await post('/kybernos-hub/catalogue/refresh', {})
          await recharger()
          setVerifie(false)
          const [fr, en] = messageCatalogue(r)
          setResume(kt(fr, en))
        }

        // Update the whole suite: the host downloads, verifies and installs; the page only polls its status.
        const suivreMaj = async () => {
          const t = await lireJson('/kybernos-hub/update/status')
          if (t === null || t.ok !== true) { setTimeout(suivreMaj, 3000); return }
          setTacheMaj(t)
          if (t.etat === 'termine') { setEnAttente((a) => ({ ...a, __suite: true })); recharger(); return }
          if (t.etat === 'echec') { recharger(); return }
          setTimeout(suivreMaj, 2000)
        }
        const mettreAJourSuite = async () => {
          setConfirmerMaj(false)
          setTacheMaj({ etat: 'telechargement' })
          const r = await post('/kybernos-hub/update', { confirm: true })
          if (r.ok !== true) { setTacheMaj({ etat: 'echec', erreur: r.error || 'update-failed' }); return }
          setTimeout(suivreMaj, 1500)
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
            parts.install = h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: () => (suite.distant && suite.distant.plusRecent === true ? setConfirmerMaj(true) : installer(m)) }, kt('Mettre à jour', 'Update'))
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

        // A click on a card or a row opens the module's page, unless it lands on a control (a button, the switch, the
        // module's own settings panel). Enter and Space do the same from the keyboard.
        const sourisSurControle = (e) => e.target.closest('button,a,input,select,textarea,[role="switch"],.kbsu-cfg') !== null
        const ouvrirFiche = (id) => (e) => { if (!sourisSurControle(e)) { setDetail(id); setOngletFiche('description') } }
        const clavierFiche = (id) => (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setDetail(id); setOngletFiche('description') } }
        const verdict = verdictCompat(compat)
        const chipFamille = (fam) => h('span', { className: 'kbsu-chip fam', style: { '--c': fam.couleur } }, h('i', null), kt(fam.fr, fam.en))
        // Compatibility speaks up on a card only when something is wrong; the full verdict is on the module's page.
        const chipCompat = (pleine) => verdict === 'hors'
          ? h('span', { className: 'kbsu-chip warn', title: kt('Cette version de DSH n’est pas dans la zone testée.', 'This DSH version is not in the tested range.') }, kt('Non testé sur votre DSH', 'Not tested on your DSH'))
          : (pleine && verdict === 'ok' ? h('span', { className: 'kbsu-chip ok' }, kt('Compatible avec DSH ', 'Works with DSH ') + (charge.maint && charge.maint.global ? charge.maint.global : '')) : null)

        const carte = (m, vedette) => {
          const p = cardParts(m, false)
          const version = 'v' + (p.bundle !== null && typeof p.bundle.version === 'string' ? p.bundle.version : m.version)
          return h('article', { key: m.id, className: 'kbsu-card' + (vedette ? ' kbsu-vedette' : '') + (p.estOuvert ? ' open' : '') + (p.etat === 'safe' ? ' dim' : ''), 'data-kb': 'suite-card', 'data-id': m.id, 'data-etat': p.etat, tabIndex: 0, 'aria-label': titreDe(m) + ', ' + kt('ouvrir sa page', 'open its page'), onClick: ouvrirFiche(m.id), onKeyDown: clavierFiche(m.id) },
            h('div', { className: 'kbsu-top' }, artwork(m, p.fam, vedette ? 'mid' : ''), h('div', { className: 'kbsu-name' },
              vedette && m.accroche ? h('div', { className: 'kbsu-tag' }, kt(m.accroche.fr, m.accroche.en)) : null,
              h('b', null, titreDe(m)), h('small', null, m.id + ' · ' + version))),
            h('p', { className: 'kbsu-promise' }, vedette && m.description ? kt(m.description.fr, m.description.en) : kt(m.promesse.fr, m.promesse.en)),
            h('div', { className: 'kbsu-badges' }, chipFamille(p.fam), m.socle ? h('span', { className: 'kbsu-b' }, kt('SOCLE', 'BASE')) : null, chipCompat(false)),
            notes[m.id] ? h('p', { className: 'kbsu-note', role: 'status' }, notes[m.id]) : null,
            h('div', { className: 'kbsu-foot' }, p.statut, p.install, p.reglages !== null || p.sw !== null ? h('span', { className: 'kbsu-right' }, p.reglages, p.sw) : null),
            p.estOuvert ? h('div', { className: 'kbsu-cfg', 'data-kb': 'suite-config' }, h(p.comp, { key: m.nom })) : null)
        }

        // ── The module's own page: header, what it does, compatibility, details. Nothing on it that the catalogue does not say.
        const tailleTexte = (ko) => (typeof ko !== 'number' ? '—' : (ko >= 1000 ? (ko / 1000).toFixed(1) + ' MB' : ko + ' KB'))
        const fiche = (m) => {
          const p = cardParts(m, false)
          const installee = p.bundle !== null && typeof p.bundle.version === 'string' ? p.bundle.version : null
          const compatLue = charge.maint && charge.maint.compat ? charge.maint.compat : null
          const dsh = charge.maint && charge.maint.global ? charge.maint.global : '—'
          const accroche = m.accroche ? kt(m.accroche.fr, m.accroche.en) : kt(m.promesse.fr, m.promesse.en)
          const texte = m.description ? kt(m.description.fr, m.description.en) : kt(m.promesse.fr, m.promesse.en)
          const onglet = (id, libelle) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': ongletFiche === id ? 'true' : 'false', 'data-kb': 'suite-onglet-' + id, onClick: () => setOngletFiche(id) }, libelle)
          const corps = ongletFiche === 'compat'
            ? h('div', { className: 'kbsu-body' },
              h('dl', { className: 'kbsu-dl' },
                h('dt', null, kt('Votre DSH', 'Your DSH')), h('dd', null, dsh),
                h('dt', null, kt('Zone testée', 'Tested range')), h('dd', null, compatLue !== null ? (compatLue.min || '?') + kt(' à ', ' to ') + (compatLue.max || '?') : kt('inconnue', 'unknown')),
                h('dt', null, kt('Verdict', 'Verdict')), h('dd', null, verdict === 'ok' ? h('span', { className: 'kbsu-chip ok' }, kt('Compatible', 'Works with your DSH')) : verdict === 'hors' ? chipCompat(true) : kt('Inconnu', 'Unknown'))),
              h('p', null, kt('Cette zone est celle de toute la suite : elle vient de dsh-compat.json, le contrat que le testeur de compatibilité applique à chaque installation et mise à jour.', 'This range is the whole suite’s: it comes from dsh-compat.json, the contract the compatibility check applies to every install and update.')))
            : h('div', { className: 'kbsu-body', style: { '--c': p.fam.couleur } },
              h('p', null, texte),
              Array.isArray(m.points) && m.points.length > 0 ? h('div', null, h('h5', { style: { marginBottom: 10 } }, kt('Ce que ça fait', 'What it does')), h('ul', { className: 'kbsu-ticks' }, m.points.map((pt, i) => h('li', { key: i }, kt(pt.fr, pt.en))))) : null,
              m.aide !== undefined && m.aide !== null ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 }, 'data-kb': 'suite-aide' },
                h('div', null, h('h5', { style: { marginBottom: 10 } }, kt('Comment l’utiliser', 'How to use it')), h('ol', { className: 'kbsu-steps' }, m.aide.steps.map((st, i) => h('li', { key: i }, kt(st.fr, st.en))))),
                h('p', { className: 'kbsu-where' }, h('b', null, kt('Où le trouver : ', 'Where to find it: ')), kt(m.aide.where.fr, m.aide.where.en)),
                m.aide.good ? h('p', { className: 'kbsu-good' }, kt(m.aide.good.fr, m.aide.good.en)) : null) : null,
              Array.isArray(m.notes) && m.notes.length > 0 ? h('div', null, h('h5', { style: { marginBottom: 10 } }, kt('Nouveautés de la version ', 'What’s new in ') + m.version), h('ul', { className: 'kbsu-ticks' }, m.notes.map((nt, i) => h('li', { key: i }, kt(nt.fr, nt.en))))) : null,
              m.socle ? h('p', { className: 'kbsu-st' }, kt('Fait partie du socle : il est livré sur chaque poste et ne s’éteint pas.', 'Part of the base: it ships on every machine and cannot be switched off.')) : null)
          return h('div', { className: 'kbsu-fiche', 'data-kb': 'suite-fiche', 'data-id': m.id, style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h('div', { className: 'kbsu-crumb' }, h('button', { type: 'button', className: 'kbsu-btn ghost sm', 'data-kb': 'suite-retour', onClick: () => setDetail(null) }, ic('back'), 'Kybernos Suite'), h('span', null, '/'), h('span', null, titreDe(m))),
            h('section', { className: 'kbsu-hero' }, artwork(m, p.fam, 'big'),
              h('div', { className: 'kbsu-htitle' }, h('h4', null, titreDe(m)), h('p', null, accroche), h('div', { className: 'kbsu-badges' }, chipFamille(p.fam), p.statut, chipCompat(true))),
              h('div', { className: 'kbsu-hact' }, p.install, p.reglages, p.sw)),
            notes[m.id] ? h('p', { className: 'kbsu-note', role: 'status' }, notes[m.id]) : null,
            p.estOuvert ? h('div', { className: 'kbsu-cfg', 'data-kb': 'suite-config' }, h(p.comp, { key: m.nom })) : null,
            h('div', { className: 'kbsu-cols' },
              h('main', { className: 'kbsu-panel' }, h('div', { className: 'kbsu-tabs', role: 'tablist' }, onglet('description', kt('Description', 'Description')), onglet('compat', kt('Compatibilité', 'Compatibility'))), corps),
              h('aside', { className: 'kbsu-panel kbsu-side' }, h('b', null, kt('Détails', 'Details')),
                h('dl', { className: 'kbsu-dl' },
                  h('dt', null, 'Version'), h('dd', null, installee !== null && installee !== m.version ? installee + ' → ' + m.version : (installee || m.version)),
                  h('dt', null, kt('Famille', 'Family')), h('dd', null, kt(p.fam.fr, p.fam.en)),
                  h('dt', null, kt('Poids', 'Size')), h('dd', null, tailleTexte(m.poids_ko)),
                  h('dt', null, 'Id'), h('dd', null, h('code', null, m.id)),
                  h('dt', null, 'Source'), h('dd', null, suite.catalogue.source === 'signe' ? kt('Catalogue signé', 'Signed catalogue') : kt('Catalogue livré avec la suite', 'Catalogue shipped with the suite'))))))
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
          return h('li', { key: m.id, className: cls, 'data-kb': 'suite-row', 'data-id': m.id, 'data-etat': p.etat, draggable: !p.estOuvert, tabIndex: 0, 'aria-label': titreDe(m) + ', ' + kt('ouvrir sa page', 'open its page'), onClick: ouvrirFiche(m.id), onKeyDown: clavierFiche(m.id), onDragStart: (e) => rowDragStart(e, m.id), onDragOver: (e) => rowDragOver(e, m.id), onDragLeave: rowDragLeave, onDrop: (e) => rowDrop(e, m.id), onDragEnd: dragEnd },
            h('div', { className: 'kbsu-rowmain' },
              h('span', { className: 'kbsu-grip', draggable: true, 'data-kb': 'suite-grip', 'aria-hidden': 'true', title: kt('Glisser pour réordonner', 'Drag to reorder') }, ic('grip')),
              artwork(m, p.fam, ''),
              h('div', { className: 'kbsu-rowname' }, h('b', { title: m.id }, titreDe(m)), h('span', { className: 'kbsu-promise', title: kt(m.promesse.fr, m.promesse.en) }, kt(m.promesse.fr, m.promesse.en))),
              h('span', { className: 'kbsu-famcol' }, h('span', { className: 'kbsu-b kbsu-famtag', title: p.fam.fr ? kt(p.fam.fr, p.fam.en) : undefined }, p.fam.fr ? kt(p.fam.fr, p.fam.en) : '')),
              p.statut,
              h('span', { className: 'kbsu-right kbsu-rowact' }, p.install, p.reglages, p.sw),
              h('span', { className: 'kbsu-mv' },
                h('button', { type: 'button', className: 'kbsu-ib', 'data-kb': 'suite-up', disabled: i === 0, 'aria-label': kt('Monter ', 'Move up ') + titreDe(m), title: kt('Monter', 'Move up'), onClick: () => moveRow(m.id, -1) }, ic('up')),
                h('button', { type: 'button', className: 'kbsu-ib', 'data-kb': 'suite-down', disabled: i === n - 1, 'aria-label': kt('Descendre ', 'Move down ') + titreDe(m), title: kt('Descendre', 'Move down'), onClick: () => moveRow(m.id, 1) }, ic('down')))),
            notes[m.id] ? h('p', { className: 'kbsu-note', role: 'status' }, notes[m.id]) : null,
            p.estOuvert ? h('div', { className: 'kbsu-cfg', 'data-kb': 'suite-config' }, h(p.comp, { key: m.nom })) : null)
        }

        const familleBtn = (id, libelle, couleur) => h('button', { key: id || 'all', type: 'button', className: 'kbsu-fb', 'data-kb': 'suite-fam-' + (id || 'all'), 'aria-pressed': famille === id ? 'true' : 'false', onClick: () => { setFamille(id); setResume('') } }, couleur ? h('i', { style: { '--c': couleur } }) : null, libelle)
        const segment = (id, libelle, n) => h('button', { key: id, type: 'button', 'aria-pressed': filtre === id ? 'true' : 'false', onClick: () => { setFiltre(id); setResume('') } }, libelle, h('span', { className: 'c' }, n))
        const dshVersion = charge.maint && charge.maint.global ? charge.maint.global : null

        const viewButton = (id, libelle, court, icone) => h('button', { key: id, type: 'button', 'data-kb': 'suite-view-' + id, 'aria-pressed': view === id ? 'true' : 'false', 'aria-label': libelle, title: libelle, onClick: () => chooseView(id) }, ic(icone), court)
        const aucun = h('div', { className: 'kbsu-empty' }, kt('Aucun module ne correspond.', 'No module matches.'))
        const orderLine = custom ? (orderSaved ? kt('Ordre personnalisé, enregistré dans ce navigateur', 'Custom order, saved in this browser') : kt('Ordre personnalisé, non enregistré (stockage du navigateur indisponible)', 'Custom order, not saved (browser storage unavailable)')) : kt('Ordre par défaut', 'Default order')

        return h('div', { className: 'kbsu', 'data-kb': 'suite', ref: rootRef },
          detail !== null ? null : h('div', { className: 'kbsu-head' },
            h('div', null, h('h4', null, 'Kybernos Suite'), h('p', null, kt('Les modules Kybernos de ce poste. Activez, installez ou ouvrez les paramètres sans quitter les Réglages.', 'The Kybernos modules on this machine. Switch, install or open settings without leaving Settings.'))),
            h('div', { className: 'kbsu-headr' },
              h('span', { className: 'kbsu-right' },
                typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-hub' }) : null,
                ouvrirGestionnaire !== null ? h('button', { type: 'button', className: 'kbsu-btn ghost', 'data-kb': 'suite-native', onClick: ouvrirGestionnaire }, ic('plug'), kt('Gestionnaire natif', 'Native manager')) : null,
                h('button', { type: 'button', className: 'kbsu-btn', 'data-kb': 'suite-verifier', disabled: verifie, onClick: verifier }, ic('refresh', verifie ? 'spin' : ''), verifie ? kt('Vérification…', 'Checking…') : kt('Rechercher des mises à jour', 'Check for updates'))),
              h('div', { className: 'kbsu-meta' },
                dshVersion !== null ? h('span', null, h('span', { className: 'kbsu-dot' + (horsZone ? ' warn' : '') }), 'DSH ' + dshVersion + (horsZone ? kt(' · hors de la zone testée', ' · outside the tested range') : kt(' · dans la zone testée', ' · inside the tested range'))) : null,
                h('span', { 'data-kb': 'suite-source' }, suite.catalogue.source === 'signe' && suite.catalogue.suite ? kt('Catalogue signé · suite ', 'Signed catalogue · suite ') + suite.catalogue.suite.version + ' · ' + String(suite.catalogue.suite.publieLe || '').slice(0, 10) : kt('Catalogue livré avec la suite', 'Catalogue shipped with the suite'))))),
          safe ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Mode sans échec actif : seul le socle est chargé.', 'Safe mode is on: only the base is loaded.')), h('span', null, kt('Pour en sortir : ', 'To leave it: '), h('code', null, 'node scripts/dsh-lifecycle.mjs safe-mode off'))) : null,
          (!safe && reco.mode === 'safe-recommande') ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Plusieurs démarrages récents ont échoué.', 'Several recent boots failed.')), h('span', null, String(reco.raison || ''), ' ', h('code', null, 'node scripts/dsh-lifecycle.mjs safe-mode status'))) : null,
          suite.distant && suite.distant.plusRecent === true && (tacheMaj === null || tacheMaj.etat === 'echec') ? h('div', { className: 'kbsu-relance', role: 'status', 'data-kb': 'suite-maj' },
            h('span', null, h('b', null, kt('La suite ' + suite.distant.suite + ' est disponible. ', 'Suite ' + suite.distant.suite + ' is available. ')), (() => { const r = raisonMiseAJour(suite.distant); return r === null ? kt('Elle met à jour tous les modules en une fois ; un seul redémarrage de DSH.', 'It updates every module at once; DSH restarts once.') : kt(r[0], r[1]) })()),
            raisonMiseAJour(suite.distant) !== null ? null
              : confirmerMaj ? h('span', { className: 'kbsu-right' }, h('span', { className: 'kbsu-st warn' }, kt('Archive vérifiée par empreinte signée, installation avec photo de sécurité et retour arrière automatique.', 'Archive checked against a signed digest, installed with a safety snapshot and automatic rollback.')),
                h('button', { type: 'button', className: 'kbsu-btn sm accent', 'data-kb': 'suite-maj-go', onClick: mettreAJourSuite }, kt('Mettre à jour la suite', 'Update the suite')),
                h('button', { type: 'button', className: 'kbsu-btn sm ghost', onClick: () => setConfirmerMaj(false) }, kt('Annuler', 'Cancel')))
                : h('button', { type: 'button', className: 'kbsu-btn sm accent', 'data-kb': 'suite-maj-ask', onClick: () => setConfirmerMaj(true) }, kt('Mettre à jour la suite', 'Update the suite')),
            tacheMaj !== null && tacheMaj.etat === 'echec' ? h('span', { className: 'kbsu-st bad', role: 'alert' }, (() => { const m = messageMiseAJour(tacheMaj); return m === null ? '' : kt(m[0], m[1]) })()) : null) : null,
          tacheMaj !== null && tacheMaj.etat !== 'echec' && tacheMaj.etat !== 'termine' ? h('div', { className: 'kbsu-relance', role: 'status', 'data-kb': 'suite-maj-en-cours' }, h('span', { className: 'kbsu-st' }, ic('refresh', 'spin'), (() => { const m = messageMiseAJour(tacheMaj); return m === null ? '' : kt(m[0], m[1]) })())) : null,
          nbEnAttente > 0 ? h('div', { className: 'kbsu-relance', role: 'status' },
            h('span', null, h('b', null, nbEnAttente + (nbEnAttente > 1 ? kt(' changements en attente. ', ' changes pending. ') : kt(' changement en attente. ', ' change pending. '))), enAttente.__suite === true ? kt('La suite est installée. Relancez DSH pour l’activer.', 'The suite is installed. Restart DSH to turn it on.') : kt('Relancez DSH pour les activer.', 'Restart DSH to turn them on.')),
            relance === 'running' ? h('span', { className: 'kbsu-st' }, ic('refresh', 'spin'), kt('Relance en cours… la page va se recharger.', 'Restarting… the page will reload.'))
              : confirmerRelance ? h('span', { className: 'kbsu-right' }, h('span', { className: 'kbsu-st warn' }, kt('Les sessions en cours seront interrompues, puis reprises.', 'Running sessions will be interrupted, then resumed.')),
                h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: relancer }, kt('Relancer maintenant', 'Restart now')),
                h('button', { type: 'button', className: 'kbsu-btn sm ghost', onClick: () => setConfirmerRelance(false) }, kt('Annuler', 'Cancel')))
                : h('button', { type: 'button', className: 'kbsu-btn sm accent', onClick: () => setConfirmerRelance(true) }, kt('Relancer DSH', 'Restart DSH')),
            relance === 'error' ? h('span', { className: 'kbsu-st bad' }, kt('Relance impossible depuis ici : demandez à l’agent « relance DSH ».', 'Cannot restart from here: ask the agent to "restart DSH".')) : null) : null,
          mgr === null ? h('div', { className: 'kbsu-banner', role: 'status' }, h('strong', null, ic('alert'), kt('Gestionnaire de plugins indisponible.', 'Plugin manager unavailable.')), h('span', null, kt('Le catalogue s’affiche, mais l’état installé et les interrupteurs ne sont pas disponibles sur cette version de DSH.', 'The catalogue shows, but installed state and switches are unavailable on this DSH version.'))) : null,
          detail !== null ? null : h('div', { className: 'kbsu-bar' },
            h('div', { className: 'kbsu-seg', role: 'group', 'aria-label': kt('Filtre', 'Filter') },
              segment('featured', kt('À la une', 'Featured'), nbVedettes), segment('all', kt('Tous', 'All'), modules.length), segment('installed', kt('Installés', 'Installed'), nbInstalles), segment('available', kt('Disponibles', 'Available'), modules.length - nbInstalles), segment('updates', kt('Mises à jour', 'Updates'), nbMaj)),
            h('label', { className: 'kbsu-search' }, ic('search'), h('input', { type: 'search', value: requete, placeholder: kt('Rechercher un module…', 'Search a module…'), 'aria-label': kt('Rechercher un module', 'Search a module'), onChange: (e) => { setRequete(e.target.value); setResume('') } })),
            h('span', { className: 'kbsu-right' },
              filtre === 'featured' ? null : h('div', { className: 'kbsu-seg view', role: 'group', 'aria-label': kt('Affichage', 'View') },
                viewButton('grid', kt('Vue en grille', 'Grid view'), kt('Grille', 'Grid'), 'grid'), viewButton('list', kt('Vue en liste', 'List view'), kt('Liste', 'List'), 'list')),
              custom ? h('button', { type: 'button', className: 'kbsu-btn ghost sm', 'data-kb': 'suite-order-reset', onClick: resetOrder }, ic('reset'), kt('Réinitialiser l’ordre', 'Reset order')) : null)),
          detail !== null ? null : h('div', { className: 'kbsu-fams', role: 'group', 'aria-label': kt('Famille', 'Family') }, familleBtn('', kt('Toutes les familles', 'All families'), null), suite.catalogue.familles.map((f) => familleBtn(f.id, kt(f.fr, f.en), f.couleur))),
          detail !== null ? null : h('div', { className: 'kbsu-subbar' },
            h('div', { className: 'kbsu-summary', role: 'status', 'aria-live': 'polite' }, resume || (nbInstalles + kt(' installés · ', ' installed · ') + (modules.length - nbInstalles) + kt(' disponibles', ' available') + (nbMaj > 0 ? ' · ' + nbMaj + kt(' mise(s) à jour', ' update(s)') : ''))),
            h('span', { className: 'kbsu-st' + (custom && !orderSaved ? ' warn' : ''), 'data-kb': 'suite-order-status' }, orderLine)),
          h('div', { className: 'kbsu-sr', role: 'status', 'aria-live': 'polite' }, announce),
          detail !== null ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 22 } }, view === 'list' && filtre !== 'featured'
            ? (visibles.length > 0 ? h('ul', { className: 'kbsu-list', role: 'list', 'data-kb': 'suite-list' }, visibles.map((m, i) => row(m, i, visibles.length))) : aucun)
            : (visibles.length > 0 ? h('div', { className: filtre === 'featured' ? 'kbsu-fgrid' : 'kbsu-grid', 'data-kb': 'suite-grid' }, visibles.map((m) => carte(m, filtre === 'featured'))) : aucun)),
          detail !== null ? (modules.filter((m) => m.id === detail)[0] !== undefined ? fiche(modules.filter((m) => m.id === detail)[0]) : null) : null)
      }
      return Panneau
    }

    // ── « ? How it works », for every plugin page ─────────────────────────────────────────────────────────────────────
    // The help of each module is written once (packages/<dir>/help.json), shipped in the catalogue and shown on the module's page in
    // the Suite. This is the same text behind a button any plugin page can put in its header:
    //   window.__KB_HELP__ && h(window.__KB_HELP__.Help, { id: '<bundle folder>' })
    // It renders nothing when the module, or its help, is not known — a plugin never depends on it being there.
    const construireAide = (React) => {
      const h = React.createElement
      const cache = { map: null, pending: null }
      const lireAides = () => {
        if (cache.map !== null) return Promise.resolve(cache.map)
        if (cache.pending === null) {
          cache.pending = fetch('/kybernos-hub/suite', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => {
            const map = {}
            for (const m of (j !== null && typeof j === 'object' && Array.isArray(j.modules) ? j.modules : [])) if (m !== null && typeof m === 'object' && typeof m.id === 'string') map[m.id] = m
            cache.map = map
            return map
          }).catch(() => { cache.pending = null; return {} })
        }
        return cache.pending
      }
      // `action` ({ label, onClick }) is optional: a page that has something more to show than the text (an interactive guide) adds
      // a button at the bottom of the card. The card closes first, then the page does its thing.
      function Help ({ id, action }) {
        const [open, setOpen] = React.useState(false)
        const [mod, setMod] = React.useState(null)
        const [side, setSide] = React.useState('end') // which edge of the button the card hangs from, so it stays on screen
        const wrap = React.useRef(null)
        React.useEffect(() => {
          let off = false
          lireAides().then((map) => { if (!off) setMod(map[id] !== undefined ? map[id] : null) })
          return () => { off = true }
        }, [id])
        React.useEffect(() => {
          if (!open) return undefined
          // The Settings dialog closes on Escape with a capture listener of its own: this one runs first, in capture, and only
          // when the card is open, so Escape closes the card and leaves the page behind it alone.
          if (wrap.current !== null) {
            const r = wrap.current.getBoundingClientRect()
            const w = Math.min(420, window.innerWidth - 32)
            const rtl = document.documentElement.dir === 'rtl'
            // Hang from the end edge (toward the right) unless the card would run out of the window there.
            setSide((rtl ? r.left + w > window.innerWidth - 16 : r.right - w < 16) ? 'start' : 'end')
          }
          const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
          const away = (e) => { if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false) }
          window.addEventListener('keydown', esc, true)
          document.addEventListener('mousedown', away)
          return () => { window.removeEventListener('keydown', esc, true); document.removeEventListener('mousedown', away) }
        }, [open])
        if (mod === null || mod.aide === undefined || mod.aide === null) return null
        const a = mod.aide
        return h('span', { className: 'kbhp-wrap', ref: wrap, 'data-kb': 'help', 'data-id': id },
          h('button', { type: 'button', className: 'kbhp-btn', 'data-kb': 'help-button', 'data-id': id, 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'kbhp-' + id, title: kt('Comment ça marche', 'How it works'), onClick: () => setOpen(!open) },
            h('span', { className: 'kbhp-q', 'aria-hidden': 'true' }, '?'), kt('Comment ça marche', 'How it works')),
          open ? h('section', { className: 'kbhp-pop' + (side === 'start' ? ' start' : ''), id: 'kbhp-' + id, role: 'dialog', 'aria-label': (mod.titre || id) + ' — ' + kt('Comment ça marche', 'How it works'), 'data-kb': 'help-panel' },
            h('button', { type: 'button', className: 'kbhp-x', 'aria-label': kt('Fermer', 'Close'), onClick: () => setOpen(false) }, '✕'),
            h('h4', null, mod.titre || id),
            h('p', null, kt(a.what.fr, a.what.en)),
            h('div', null, h('h5', null, kt('Comment l’utiliser', 'How to use it')), h('ol', { className: 'kbsu-steps' }, a.steps.map((st, i) => h('li', { key: i }, kt(st.fr, st.en))))),
            h('p', { className: 'kbsu-where' }, h('b', null, kt('Où le trouver : ', 'Where to find it: ')), kt(a.where.fr, a.where.en)),
            a.good ? h('p', { className: 'kbsu-good' }, kt(a.good.fr, a.good.en)) : null,
            action != null && typeof action.onClick === 'function' ? h('button', { type: 'button', className: 'kbhp-act', 'data-kb': 'help-action', onClick: () => { setOpen(false); action.onClick() } }, action.label) : null) : null)
      }
      return { version: 1, actions: true, Help }
    }

    const monterSuite = (ctx, scope, require) => {
      try {
        const slots = scope.slots
        if (slots == null || typeof slots.inject !== 'function') return
        const React = typeof require === 'function' ? require('react') : null
        if (React == null) return
        try { window.__KB_HELP__ = construireAide(React) } catch (e) { /* the pages then simply have no help button */ }
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

    return { name: NAME, inject: [], apply: demarrer, __test: { messageCatalogue, raisonMiseAJour, messageMiseAJour, ROUTE, ALIVE_AFTER_MS, TICK_MS, lireEchec, comparerVersions, deballer, etatCarte, filtrer, titreDe, verdictCompat, GLYPHES, ORDER_KEY, VIEW_KEY, parseOrder, effectiveOrder, applyOrder, isCustomOrder, storableOrder, moveTo, moveBy, browserStore, readOrder, writeOrder, readView, writeView } }
  }
})
