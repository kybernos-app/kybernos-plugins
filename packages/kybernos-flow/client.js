// ═══════════════════════════════════════════════════════════════════════════
// kybernos-flow — moitié client : la poignée de réordonnancement de la file.
//
// REMPLACE la moitié cliente de `scripts/patch-dsh-queue-move.mjs`, qui
// réécrivait le composant `QueueDock` dans `dsh-client-ui-conversation`. Ici le
// composant natif n'est pas touché : on le décore.
//
//   · repère : `[data-queue-dock]` — attribut NATIF et stable (les classes CSS
//     du moteur sont hachées, on ne s'appuie que sur leurs suffixes) ;
//   · une poignée (six points, SVG, révélée au survol et au focus) est ajoutée
//     en tête de chaque ligne de la liste, quand il y en a au moins deux ;
//   · le geste : pointerdown sur la poignée (capture du pointeur) → pointermove
//     → pointerup ; Alt+↑ / Alt+↓ au clavier depuis la poignée ;
//   · l'indicateur de dépôt se pose sur la couture native de la ligne visée
//     (`inset 0 ±2px 0 var(--dsw-alias-brand-primary)`) : aucune ligne ne bouge ;
//   · le déplacement passe par la route hôte `/kybernos/queue-move`. Les lignes
//     du DOM n'ont pas d'identifiant : le client lit la file de l'hôte (identités
//     + aperçus), vérifie qu'elle correspond à ce qu'il voit (même nombre de
//     lignes, même aperçu pour la ligne tenue) puis envoie des IDENTIFIANTS. Un
//     écart = file périmée : rien n'est envoyé ;
//   · SONDE DE CAPACITÉ : tant que l'hôte ne répond pas `supported: true`
//     (moteur sans la méthode interne attendue, session non vivante), AUCUNE
//     poignée n'est rendue — l'interface ne promet pas un geste qui ne ferait
//     rien.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-flow',
  factory: () => {
    const NAME = 'kybernos-flow'
    const ROUTE = '/kybernos/queue-move'
    const MARQUE_POIGNEE = 'queue-drag-handle'
    const MARQUE_STYLE = 'kybernos-flow-style'
    /** Durée de validité d'un verdict de capacité pour une session. */
    const TTL_SONDE_MS = 10000
    const BRAND = 'var(--dsw-alias-brand-primary, #3b82f6)'

    const lang = () => {
      try {
        const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
        const s = String(l || '')
        // French only when the resolved language IS French (the 'kybernos' default
        // or a fr base); every other language — translated (es…) or not — gets
        // English, never French.
        return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
      } catch { return 'fr' }
    }
    const kt = (fr, en) => (lang() === 'fr' ? fr : en)

    // ── Fonctions pures (jouées par test-client.mjs) ──────────────────────────

    const normaliser = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase()

    /** Le texte vu dans le DOM et l'aperçu de l'hôte désignent-ils le même message ? Vide d'un côté = on ne tranche pas. */
    const memeApercu = (dom, hote) => {
      const a = normaliser(dom)
      const b = normaliser(hote)
      if (a === '' || b === '') return true
      const n = Math.min(12, a.length, b.length)
      return a.slice(0, n) === b.slice(0, n)
    }

    /**
     * La couture de dépôt, lue sur le MILIEU de chaque ligne : au-dessus du milieu
     * de la ligne n → avant elle ; sous le milieu de la dernière → en fin de file
     * (`rects.length`). Toute l'ordonnée de la liste porte une cible.
     */
    const cibleDeDepot = (rects, y) => {
      for (let i = 0; i < rects.length; i += 1) if (y < rects[i].top + rects[i].height / 2) return i
      return rects.length
    }

    /** Déposer la ligne `de` devant `cible` change-t-il quelque chose ? */
    const deplacementUtile = (de, cible) => cible !== de && cible !== de + 1

    /**
     * Confronte la file de l'hôte à ce que le DOM montre.
     * @returns {{ok: true, messageId: string, beforeId: string|null} | {ok: false, raison: string}}
     */
    const resoudre = (items, apercusDom, de, cible) => {
      const file = (Array.isArray(items) ? items : []).filter((i) => i && i.lane === 'next-turn')
      if (file.length !== apercusDom.length) return { ok: false, raison: 'file-perimee (' + String(file.length) + ' côté hôte, ' + String(apercusDom.length) + ' à l’écran)' }
      if (de < 0 || de >= file.length || cible < 0 || cible > file.length) return { ok: false, raison: 'indices-hors-file' }
      if (!memeApercu(apercusDom[de], file[de].preview)) return { ok: false, raison: 'apercu-different' }
      return { ok: true, messageId: file[de].id, beforeId: cible === file.length ? null : file[cible].id }
    }

    // ── DOM ───────────────────────────────────────────────────────────────────

    const POIGNEE_SVG = '<svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="3.5" cy="5" r="1.4"/><circle cx="8.5" cy="5" r="1.4"/><circle cx="3.5" cy="10" r="1.4"/><circle cx="8.5" cy="10" r="1.4"/><circle cx="3.5" cy="15" r="1.4"/><circle cx="8.5" cy="15" r="1.4"/></g></svg>'

    const poserStyle = () => {
      if (typeof document === 'undefined' || document.querySelector('style[data-' + MARQUE_STYLE + ']') !== null) return
      const s = document.createElement('style')
      s.setAttribute('data-' + MARQUE_STYLE, '')
      s.textContent =
        '[data-kb="' + MARQUE_POIGNEE + '"]{flex:none;width:12px;height:20px;margin-inline-end:-4px;display:inline-flex;align-items:center;justify-content:center;cursor:grab;opacity:0;touch-action:none;user-select:none;color:var(--dsw-alias-label-tertiary, currentColor)}' +
        '[data-queue-dock] li:hover>[data-kb="' + MARQUE_POIGNEE + '"],[data-kb="' + MARQUE_POIGNEE + '"]:focus-visible,[data-queue-dock][data-kb-dragging] [data-kb="' + MARQUE_POIGNEE + '"]{opacity:.7}' +
        '[data-kb="' + MARQUE_POIGNEE + '"]:active{cursor:grabbing}' +
        '[data-kb-held]{opacity:.45}'
      document.head.appendChild(s)
    }

    /** Lignes réordonnables : les messages admis, hors bande « en cours d'envoi », avec leurs actions. */
    const rangees = (dock) => Array.from(dock.querySelectorAll('ul > li')).filter((li) => String(li.className).indexOf('_pendingRow') < 0 && li.querySelector('button') !== null)

    const apercuDeLigne = (li) => {
      const el = li.querySelector('[class*="_preview"]')
      return el === null ? '' : String(el.textContent || '')
    }

    // ── Session et réseau ─────────────────────────────────────────────────────

    const sessionCourante = (uiWorkspace) => {
      try {
        const ref = uiWorkspace && uiWorkspace.mainReference
        if (ref && typeof ref.sessionId === 'string' && ref.sessionId.length > 0) return ref.sessionId
        const sel = uiWorkspace && uiWorkspace.selection
        const snap = sel && typeof sel.getSnapshot === 'function' ? sel.getSnapshot() : sel
        if (snap && typeof snap.sessionId === 'string' && snap.sessionId.length > 0) return snap.sessionId
      } catch { /* service sans mainReference */ }
      try {
        const brut = window.localStorage.getItem('dsh.sessions.current')
        if (typeof brut === 'string' && brut.length > 0) {
          const p = JSON.parse(brut)
          if (p && typeof p.sessionId === 'string' && p.sessionId.length > 0) return p.sessionId
        }
      } catch { /* pas de persistance lisible */ }
      return null
    }

    const lireFile = async (sessionId) => {
      const r = await fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
      return r.json()
    }

    const envoyerDeplacement = async (sessionId, messageId, beforeId) => {
      const r = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId, messageId, beforeId }),
      })
      let corps = null
      try { corps = await r.json() } catch { /* corps vide */ }
      return { ok: r.ok === true && corps !== null && corps.ok === true, corps }
    }

    // ── Plugin ────────────────────────────────────────────────────────────────

    const apply = (ctx) => {
      if (typeof document === 'undefined') return
      const uiWorkspace = (() => { try { return ctx.get('uiWorkspace') } catch { return undefined } })()
      poserStyle()

      /** sessionId → { ok, at } */
      const sondes = new Map()
      let planifie = false
      let tenue = null

      const capable = async (sessionId) => {
        const connu = sondes.get(sessionId)
        if (connu !== undefined && Date.now() - connu.at < TTL_SONDE_MS) return connu.ok
        let ok = false
        try { const r = await lireFile(sessionId); ok = r && r.supported === true } catch { ok = false }
        sondes.set(sessionId, { ok, at: Date.now() })
        return ok
      }

      const statut = (dock, texte) => {
        try {
          let el = dock.querySelector('[data-kb="queue-move-status"]')
          if (el === null) {
            el = document.createElement('div')
            el.setAttribute('data-kb', 'queue-move-status')
            el.setAttribute('role', 'status')
            el.style.cssText = 'font-size:12px;padding:4px 12px;color:var(--dsw-alias-label-tertiary, inherit)'
            dock.appendChild(el)
          }
          el.textContent = texte
          setTimeout(() => { try { el.remove() } catch { /* déjà parti */ } }, 3000)
        } catch { /* décor : jamais bloquant */ }
      }

      const nettoyerIndicateurs = (dock) => {
        for (const li of dock.querySelectorAll('li')) {
          if (li.hasAttribute('data-kb-drop')) { li.removeAttribute('data-kb-drop'); li.style.boxShadow = '' }
          if (li.hasAttribute('data-kb-held')) li.removeAttribute('data-kb-held')
        }
        dock.removeAttribute('data-kb-dragging')
      }

      const indiquer = (dock, lignes, cible) => {
        for (const li of lignes) { li.style.boxShadow = ''; li.removeAttribute('data-kb-drop') }
        if (lignes.length === 0) return
        const fin = cible >= lignes.length
        const li = fin ? lignes[lignes.length - 1] : lignes[cible]
        li.setAttribute('data-kb-drop', fin ? 'end' : 'before')
        li.style.boxShadow = 'inset 0 ' + (fin ? '-2px' : '2px') + ' 0 ' + BRAND
      }

      const deplacer = async (dock, de, cible) => {
        const sessionId = sessionCourante(uiWorkspace)
        if (sessionId === null) return
        const lignes = rangees(dock)
        if (!deplacementUtile(de, cible)) return
        try {
          const file = await lireFile(sessionId)
          if (file.supported !== true) { statut(dock, kt('Réordonnancement indisponible.', 'Reordering unavailable.')); return }
          const choix = resoudre(file.items, lignes.map(apercuDeLigne), de, cible)
          if (choix.ok === false) { console.info('[' + NAME + '] déplacement ignoré : ' + choix.raison); return }
          const r = await envoyerDeplacement(sessionId, choix.messageId, choix.beforeId)
          if (r.ok === false) statut(dock, kt('Impossible de réordonner ce message.', 'Could not reorder this message.'))
        } catch (erreur) {
          console.warn('[' + NAME + '] déplacement échoué', erreur)
          statut(dock, kt('Impossible de réordonner ce message.', 'Could not reorder this message.'))
        }
      }

      const brancherPoignee = (dock, handle) => {
        handle.addEventListener('pointerdown', (e) => {
          if (e.button !== undefined && e.button !== 0) return
          const lignes = rangees(dock)
          const li = handle.closest('li')
          const de = lignes.indexOf(li)
          if (de < 0) return
          e.preventDefault()
          try { handle.setPointerCapture(e.pointerId) } catch { /* capture facultative */ }
          tenue = { de, cible: de }
          li.setAttribute('data-kb-held', '')
          dock.setAttribute('data-kb-dragging', '')
        })
        handle.addEventListener('pointermove', (e) => {
          if (tenue === null) return
          const lignes = rangees(dock)
          const rects = lignes.map((l) => l.getBoundingClientRect())
          tenue.cible = cibleDeDepot(rects, e.clientY)
          indiquer(dock, lignes, tenue.cible)
        })
        const finir = (e, valider) => {
          if (tenue === null) return
          const { de, cible } = tenue
          tenue = null
          try { handle.releasePointerCapture(e.pointerId) } catch { /* déjà relâché */ }
          nettoyerIndicateurs(dock)
          if (valider) deplacer(dock, de, cible)
        }
        handle.addEventListener('pointerup', (e) => finir(e, true))
        handle.addEventListener('pointercancel', (e) => finir(e, false))
        handle.addEventListener('keydown', (e) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          const lignes = rangees(dock)
          const de = lignes.indexOf(handle.closest('li'))
          if (de < 0) return
          e.preventDefault()
          const cible = e.key === 'ArrowUp' ? de - 1 : de + 2
          if (cible < 0 || cible > lignes.length) return
          deplacer(dock, de, cible).then(() => { try { handle.focus() } catch { /* ligne recréée */ } })
        })
      }

      const decorer = async (dock) => {
        const lignes = rangees(dock)
        if (lignes.length < 2) {
          for (const h of dock.querySelectorAll('[data-kb="' + MARQUE_POIGNEE + '"]')) h.remove()
          return
        }
        const sessionId = sessionCourante(uiWorkspace)
        if (sessionId === null || (await capable(sessionId)) === false) return
        for (const li of rangees(dock)) {
          if (li.querySelector('[data-kb="' + MARQUE_POIGNEE + '"]') !== null) continue
          const handle = document.createElement('span')
          handle.setAttribute('data-kb', MARQUE_POIGNEE)
          handle.setAttribute('role', 'button')
          handle.setAttribute('tabindex', '0')
          handle.setAttribute('aria-label', kt('Glisser pour réordonner ce message en attente', 'Drag to reorder this queued message'))
          handle.innerHTML = POIGNEE_SVG
          brancherPoignee(dock, handle)
          li.insertBefore(handle, li.firstChild)
        }
      }

      const balayer = () => {
        planifie = false
        for (const dock of document.querySelectorAll('[data-queue-dock]')) decorer(dock).catch(() => { /* décor : jamais bloquant */ })
      }
      const planifier = () => {
        if (planifie) return
        planifie = true
        setTimeout(balayer, 60)
      }

      ctx.effect(() => {
        const observateur = new MutationObserver(planifier)
        observateur.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
        planifier()
        return () => { observateur.disconnect() }
      }, 'kybernos-flow: poignee de reordonnancement de la file')
    }

    return {
      name: NAME,
      inject: ['uiWorkspace'],
      apply,
      // Exposé pour test-client.mjs ; le chargeur DSH l'ignore.
      __test: { memeApercu, cibleDeDepot, deplacementUtile, resoudre, rangees },
    }
  },
})
