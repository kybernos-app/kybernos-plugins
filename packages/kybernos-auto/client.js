// ═══════════════════════════════════════════════════════════════════════════
// kybernos-auto — moitié client.
//
// DEUX surfaces, branchées sur /kybernos-auto/* (maquette composer-auto-c-health) :
//   1. panneau « Auto » ancré au menu du sélecteur de modèle du composer :
//      toggle PAR SESSION, Model/Effort verrouillés quand Auto est actif,
//      pastille « N of M models available » ;
//   2. section Settings « Auto routing » : whitelist, classifieur, santé locale
//      par modèle (latence, erreurs, cache hit, « warm cache »), relecture
//      automatique toutes les 60 s + « Re-check now ».
//
// i18n : le pont kbt/kbf vit dans @local/kybernos, qui expose
// window.__KB_LANG_RESOLVE__ — on le réutilise (en/fr, repli fr).
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-auto',
  factory (require) {
    const React = require('react')
    const h = React.createElement

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
    const kt = (fr, en) => lang() === 'fr' ? fr : en
    // Why a model is skipped, in the words of the Models tab's health chip (the host keeps the cause with the outcome).
    const CAUSES_TXT = {
      key: ['clé refusée', 'key refused'], gone: ['retiré chez le fournisseur', 'gone from the provider'],
      refused: ['refusé par le fournisseur', 'refused by the provider'], text: ['ne prend pas de requête texte', 'cannot take a text request'],
      silent: ['ne répond pas', 'not answering'], limit: ['limite de débit', 'rate limited'],
      'not-chat': ['pas un modèle de langage', 'not a language model'], other: ['échec', 'failing']
    }
    const causeTxt = (c) => { const t = CAUSES_TXT[c] || CAUSES_TXT.other; return kt(t[0], t[1]) }
    const heureTxt = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
    const statutTxt = (s, maintenant) => {
      if (s.etat === 'jamais') return kt('pas encore vérifié', 'not checked yet')
      if (s.etat === 'down') return kt('En pause · ', 'Paused · ') + causeTxt(s.cause) + (s.jusqua ? kt(' · réessai à ', ' · retry at ') + heureTxt(s.jusqua) : '')
      if (s.etat === 'degrade') return kt('À l’essai · ', 'On trial · ') + causeTxt(s.cause)
      const age = s.sonde && s.sonde.at ? Math.max(0, Math.round((maintenant - s.sonde.at) / 1000)) : null
      return kt('Sain', 'Healthy') + (age !== null ? kt(' · a répondu il y a ', ' · answered ') + age + (lang() === 'en' ? ' s ago' : ' s') : '')
    }

    // L'app ne met PAS l'id de session dans l'URL : elle le garde dans
    // localStorage « dsh.sessions.current ». L'URL ne sert que de repli.
    const sessionIdCourante = () => {
      try {
        const j = JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null')
        if (j !== null && typeof j === 'object' && typeof j.sessionId === 'string' && j.sessionId !== '') return j.sessionId
      } catch { /* illisible : repli URL */ }
      const m = (location.hash || '').match(/session-[a-f0-9-]{10,}/)
      return m ? m[0] : 'home'
    }

    const lireEtat = (sessionId) => fetch('/kybernos-auto/state?sessionId=' + encodeURIComponent(sessionId || ''))
      .then((r) => r.json()).catch(() => null)

    // ── 1. la rangée Auto DANS le menu du sélecteur de modèle ───────────────
    // Le menu natif (role=menu, position:fixed, géré par React) porte Model et
    // Effort. On y ajoute NOTRE rangée comme dernier enfant : séparateur, Auto +
    // toggle « Cette session seulement », pastille « N of M models available ».
    // Le menu est ancré par son bord HAUT : en grandissant il passerait sur la
    // puce du composer, donc on le remonte d'autant (transform, que le menu
    // natif ne touche pas). Un enfant étranger survit aux rendus React ; le tick
    // le repose si le menu a été recréé.
    let panneau = null
    let etatPanneau = null
    let chargement = false

    const actif = (etat) => etat !== null && (etat.sessionOn === true || etat.global === true)

    const menuOuvert = () => {
      const menus = [...document.querySelectorAll('[role="menu"], [class*="_menu"], .kbm-menu-list')]
      for (const m of menus) {
        const r = m.getBoundingClientRect()
        if (r.width > 40 && r.height >= 60 && (m.innerText || '').indexOf('Effort') !== -1) return m
      }
      return null
    }

    // Verrou : seuls Model et Effort (role=menuitem) sont grisés tant qu'Auto
    // est actif — notre rangée reste active pour pouvoir le couper.
    const verrouiller = (menu, on) => {
      for (const it of menu.querySelectorAll('[role="menuitem"]')) {
        it.style.opacity = on ? '0.4' : ''
        it.style.pointerEvents = on ? 'none' : ''
      }
    }

    const decaler = (menu) => {
      if (panneau === null || panneau.parentElement !== menu) return
      menu.style.transform = 'translateY(' + (-Math.round(panneau.offsetHeight)) + 'px)'
    }

    const construirePanneau = () => {
      const el = document.createElement('div')
      el.setAttribute('data-kb', 'auto-popover')
      el.className = 'kaa-pop'
      // Le menu natif réagit au pointeur / clavier : rien de ce qui se passe
      // dans notre rangée ne doit remonter jusqu'à lui.
      for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) el.addEventListener(ev, (e) => e.stopPropagation())
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const b = e.target.closest ? e.target.closest('[data-kb="auto-chip-toggle"]') : null
        if (b === null || b.disabled === true) return
        const ecrireSession = (suivant) => fetch('/kybernos-auto/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionIdCourante(), on: suivant })
        }).then((r) => r.json())
        const global = etatPanneau !== null && etatPanneau.global === true
        // Réglage global actif (forcé partout) : l'éteindre ICI le coupe pour de bon,
        // sinon le toggle resterait bloqué sur « On ». Puis l'état de la session.
        const suite = global
          ? fetch('/kybernos-auto/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoRouting: false })
          }).then((r) => r.json()).then((j) => (j && j.ok === true ? ecrireSession(false) : j))
          : ecrireSession(etatPanneau === null ? true : etatPanneau.sessionOn !== true)
        suite.then((j) => {
          if (j && j.ok === true) {
            etatPanneau = j
            rendrePanneau()
            const m = menuOuvert()
            if (m !== null) verrouiller(m, actif(j))
          }
        }).catch(() => {})
      })
      return el
    }

    // La rangée est construite UNE fois puis mise à jour sur place : reconstruire
    // le DOM retirait le bouton qui avait le focus, et le menu natif se fermait
    // (perte de focus). Les nœuds sont gardés dans `refs`.
    let refs = null
    const construireRangee = () => {
      panneau.textContent = ''
      const ligne = document.createElement('div')
      ligne.className = 'kaa-pop-row'
      const txt = document.createElement('div')
      const t = document.createElement('b')
      t.textContent = 'Auto'
      const aide = document.createElement('span')
      aide.className = 'kaa-help'
      aide.textContent = '?'
      aide.title = kt('Routage par classe pour cette session — le modèle de session ne change jamais.', 'Per-session class routing — the session model never changes.')
      t.append(' ', aide)
      const sous = document.createElement('small')
      txt.append(t, sous)
      const sw = document.createElement('button')
      sw.type = 'button'
      sw.setAttribute('data-kb', 'auto-chip-toggle')
      sw.setAttribute('aria-label', 'Auto')
      sw.append(document.createElement('span'))
      // Le bouton ne doit pas prendre le focus à la souris : le focus reste dans le menu.
      sw.addEventListener('mousedown', (e) => e.preventDefault())
      ligne.append(txt, sw)
      const pastille = document.createElement('div')
      pastille.className = 'kaa-pop-dispo'
      pastille.setAttribute('data-kb', 'auto-available')
      const pt = document.createElement('span')
      const ptxt = document.createElement('span')
      pastille.append(pt, ptxt)
      panneau.append(ligne, pastille)
      const sante = document.createElement('div')
      sante.className = 'kaa-sante-mini'
      sante.setAttribute('data-kb', 'auto-health-mini')
      panneau.append(ligne, pastille, sante)
      refs = { sous, sw, pt, ptxt, sante }
    }

    const rendrePanneau = () => {
      if (panneau === null || etatPanneau === null) return
      if (refs === null || panneau.contains(refs.sw) === false) construireRangee()
      // Tolérant à un hôte plus ancien (avant restart) : total/disponibles se recalculent.
      const etat = etatPanneau
      const sante = Array.isArray(etat.sante) ? etat.sante : []
      const total = typeof etat.total === 'number' ? etat.total : sante.length
      const disponibles = typeof etat.disponibles === 'number' ? etat.disponibles : sante.filter((v) => v.etat !== 'down').length
      const on = actif(etat)
      refs.sous.textContent = etat.global === true
        ? kt('Actif pour toutes les sessions — l’éteindre le coupe partout', 'On for all sessions — switching off disables it everywhere')
        : kt('Cette session seulement', 'This session only')
      refs.sw.setAttribute('aria-pressed', String(on))
      refs.sw.className = 'kaa-switch-btn' + (on ? ' on' : '')
      refs.pt.className = 'kaa-dot ' + (total === 0 ? 'warn' : (disponibles === 0 ? 'down' : (disponibles < total ? 'warn' : 'ok')))
      refs.ptxt.textContent = total === 0
        ? kt('Aucun modèle dans la whitelist', 'No model in the whitelist')
        : disponibles + kt(' sur ', ' of ') + total + (total > 1 ? kt(' modèles disponibles', ' models available') : kt(' modèle disponible', ' model available'))
      // Carte santé compacte (maquette c-health) : état, latence, erreurs.
      refs.sante.textContent = ''
      if (sante.length === 0) {
        const vide = document.createElement('div')
        vide.className = 'kaa-sm-vide'
        vide.textContent = kt('Aucun modèle dans la whitelist', 'No model in the whitelist')
        refs.sante.append(vide)
      } else {
        const entete = document.createElement('div')
        entete.className = 'kaa-sm-head'
        entete.textContent = kt('MODÈLE', 'MODEL') + '   ' + kt('LATENCE', 'LATENCY') + '   ' + kt('ERREURS', 'ERRORS')
        refs.sante.append(entete)
        for (const v of sante) {
          const ligneS = document.createElement('div')
          ligneS.className = 'kaa-sm-row' + (v.etat === 'down' ? ' out' : '')
          const nom = document.createElement('span')
          nom.className = 'kaa-sm-nom'
          const dot = document.createElement('span')
          dot.className = 'kaa-dot ' + (v.etat === 'ok' ? 'ok' : (v.etat === 'down' ? 'down' : (v.etat === 'degrade' ? 'warn' : 'idle')))
          nom.append(dot, document.createTextNode(' ' + v.modele.split('/').pop()))
          const etatL = document.createElement('small')
          etatL.textContent = statutTxt(v, Date.now())
          nom.append(etatL)
          const lat = document.createElement('span')
          lat.className = 'kaa-sm-num'
          lat.textContent = v.lastLatencyMs !== null ? (v.lastLatencyMs / 1000).toFixed(1) + ' s' : '—'
          const err = document.createElement('span')
          err.className = 'kaa-sm-num'
          err.textContent = v.erreurPct !== null ? v.erreurPct + '%' : '—'
          ligneS.append(nom, lat, err)
          refs.sante.append(ligneS)
        }
      }
      // Le sélecteur natif affiche « Auto » quand le mode est actif pour la
      // session (le texte d'origine est gardé et restitué à l'extinction).
      appliquerChipAuto(on)
      const menu = menuOuvert()
      if (menu !== null) decaler(menu)
    }

    // Label « Auto » sur la puce native : le texte d'origine est mémorisé dans
    // un dataset et restitué à l'extinction. Un re-render React peut restaurer
    // le nom du modèle — la réapplication est périodique (tick du composer).
    let chipOriginal = null
    const appliquerChipAuto = (on) => {
      const b = [...document.querySelectorAll('button')].find((x) => {
        const t = (x.textContent || '').trim()
        return x.dataset.kbAutoOriginal !== undefined || (/Default/.test(t) && t.length < 60)
      })
      if (b === null || b === undefined) return
      if (on === true) {
        if (b.dataset.kbAutoOriginal === undefined) { chipOriginal = b.textContent; b.dataset.kbAutoOriginal = chipOriginal }
        if ((b.textContent || '').indexOf('Auto') !== 0) b.textContent = 'Auto'
      } else if (b.dataset.kbAutoOriginal !== undefined) {
        b.textContent = b.dataset.kbAutoOriginal
        delete b.dataset.kbAutoOriginal
      }
    }

    const retirerPanneau = () => {
      if (panneau !== null) { panneau.remove(); panneau = null }
      etatPanneau = null
      refs = null
    }

    setInterval(() => {
      try {
        if (etatPanneau !== null) appliquerChipAuto(actif(etatPanneau))
        const menu = menuOuvert()
        if (menu === null) { if (panneau !== null) retirerPanneau(); return }
        // Dédoublonnage : plusieurs instances du client (hot reloads) peuvent
        // chacune attacher leur panneau — on ne garde que le nôtre.
        for (const ex of menu.querySelectorAll('[data-kb="auto-popover"], [data-kb="auto-menu-row"]')) {
          if (ex !== panneau) ex.remove()
        }
        if (panneau === null || panneau.parentElement !== menu) {
          if (chargement === true) return
          chargement = true
          lireEtat(sessionIdCourante()).then((j) => {
            chargement = false
            const m = menuOuvert()
            if (j === null || j.ok !== true || m === null) return
            etatPanneau = j
            if (panneau === null) panneau = construirePanneau()
            m.appendChild(panneau)
            rendrePanneau()
            verrouiller(m, actif(j))
          }).catch(() => { chargement = false })
        } else {
          verrouiller(menu, actif(etatPanneau))
          decaler(menu)
        }
      } catch (e) { /* DOM en transition : réessai au prochain tick */ }
    }, 300)

    // ── 2. la section Settings dédiée ───────────────────────────────────────
    const KbAutoSettings = () => {
      const etatPair = React.useState(null)
      const etat = etatPair[0]
      const setEtat = etatPair[1]
      const ajouterPair = React.useState('')
      const ajouter = ajouterPair[0]
      const setAjouter = ajouterPair[1]
      const msgPair = React.useState('')
      const msg = msgPair[0]
      const setMsg = msgPair[1]

      const maintenantPair = React.useState(Date.now())
      const maintenant = maintenantPair[0]
      const setMaintenant = maintenantPair[1]
      const sondagePair = React.useState(false)
      const sondage = sondagePair[0]
      const setSondage = sondagePair[1]
      const lire = () => lireEtat('').then((j) => { if (j && j.ok === true) setEtat(j) })
      // Relecture toutes les 60 s (intervalS) + horloge d'une seconde pour « Last check N s ago ».
      React.useEffect(() => {
        lire()
        const relecture = setInterval(lire, 60000)
        const horloge = setInterval(() => setMaintenant(Date.now()), 1000)
        return () => { clearInterval(relecture); clearInterval(horloge) }
      }, [])

      if (etat === null) return h('div', { className: 'kaa-page', 'data-kb': 'auto-settings' }, '…')

      const ecrire = (patch) => {
        fetch('/kybernos-auto/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
        }).then((r) => r.json()).then((j) => {
          if (j && j.ok === true) { setEtat(j); setMsg('') } else setMsg(j && j.erreur ? String(j.erreur) : 'Rejected.')
        }).catch((e) => setMsg(String(e && e.message ? e.message : e)))
      }
      // "Check now": the host asks every whitelist model a real, tiny question (the verdict cache is bypassed); a model whose
      // problem was fixed (a key, say) comes back at once instead of waiting for its pause to end.
      const sonder = () => {
        setSondage(true)
        setMsg('')
        fetch('/kybernos-auto/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          // A DSH started before the probe route existed answers 404: say what to do instead of a JSON parse error.
          .then((r) => (r.status === 404 ? Promise.reject(new Error(kt('Le serveur DSH n’a pas encore chargé cette version : redémarrez-le.', 'The DSH server has not loaded this version yet: restart it.'))) : r.json()))
          .then((j) => { setSondage(false); if (j && j.ok === true) setEtat(j); else setMsg(j && j.erreur ? String(j.erreur) : 'Rejected.') })
          .catch((e) => { setSondage(false); setMsg(String(e && e.message ? e.message : e)) })
      }
      const retirer = (m) => ecrire({ autoWhitelist: etat.whitelist.filter((x) => x !== m) })
      const ajouterModele = () => {
        const m = ajouter.trim()
        if (m === '' || etat.whitelist.indexOf(m) !== -1) return
        ecrire({ autoWhitelist: etat.whitelist.concat([m]) })
        setAjouter('')
      }

      return h('div', { className: 'kaa-page', 'data-kb': 'auto-settings' },
        h('h4', { className: 'kb6-title', style: { fontSize: '26px', fontWeight: 800, letterSpacing: '-.01em' } }, 'Auto routing ', h('span', { className: 'kaa-tag' }, 'session')),
        h('p', { className: 'kaa-intro' }, kt(
          'Chaque étape déléguée part vers le modèle le plus adapté parmi ceux activés ci-dessous — optimisé pour les hits de cache : Auto garde le modèle dont le cache est chaud et ne bascule que sur meilleur choix ou panne.',
          'Each delegated step goes to the best-fit model among the ones enabled below — optimized for cache hits: Auto keeps the warm-cache model and only switches on a clearly better fit or failure.')),
        h('div', { className: 'kaa-cache' },
          h('span', { 'aria-hidden': 'true' }, '⚡ '),
          h('span', null, kt('Optimisé cache : ', 'Cache-optimized: '), kt(
            "le modèle de session n'est jamais changé ; seules les délégations sont routées.",
            "the session model is never switched; only delegated work is routed."))),
        h('div', { className: 'kaa-ligne' },
          h('div', { className: 'kaa-ligne-txt' },
            h('b', null, kt('Toutes les sessions', 'All sessions')),
            h('span', null, kt('Activé : Auto est forcé dans toutes les sessions (réglage global hérité). Désactivé : chaque session choisit depuis le composer.', 'On: Auto is forced in every session (legacy global setting). Off: each session chooses from the composer.'))),
          h('button', {
            type: 'button', className: 'kaa-switch-btn' + (etat.global === true ? ' on' : ''), 'data-kb': 'auto-global-toggle',
            'aria-pressed': String(etat.global === true), 'aria-label': kt('Toutes les sessions', 'All sessions'),
            onClick: () => ecrire({ autoRouting: etat.global !== true })
          }, h('span', null))),
        h('div', { className: 'kaa-ligne' },
          h('div', { className: 'kaa-ligne-txt' },
            h('b', null, kt('Whitelist', 'Whitelist')),
            h('span', null, kt('Les SEULS modèles qu\'Auto peut choisir. Un modèle qui ne répond plus est mis en pause (disjoncteur) puis réessayé ; l\'ordre de la liste est l\'ordre de repli.', 'The ONLY models Auto may pick. A model that stops answering is paused (circuit breaker) and tried again later; the list order is the fallback order.'))),
          h('div', { className: 'kaa-chips-col' },
            h('div', { className: 'kaa-chips', 'data-kb': 'auto-whitelist-chips' },
              etat.whitelist.length === 0
                ? h('span', { className: 'kaa-vide' }, kt('Aucun modèle — le modèle de session sera utilisé', 'No model — the session model will be used'))
                : etat.whitelist.map((m) => h('span', { className: 'kaa-chip', key: m },
                  m, h('button', { type: 'button', 'data-kb': 'auto-whitelist-remove', onClick: () => retirer(m), 'aria-label': 'Remove ' + m }, '×')))),
            h('div', { className: 'kaa-ajout' },
              h('input', {
                className: 'kaa-ajout-in', 'data-kb': 'auto-whitelist-add', type: 'text',
                placeholder: kt('provider/model', 'provider/model'), value: ajouter,
                onChange: (ev) => setAjouter(ev.target.value),
                onKeyDown: (ev) => { if (ev.key === 'Enter') ajouterModele() }
              }),
              h('button', { type: 'button', className: 'kaa-ajout-btn', onClick: ajouterModele }, kt('Ajouter', 'Add'))))),
        h('div', { className: 'kaa-ligne' },
          h('div', { className: 'kaa-ligne-txt' },
            h('b', null, kt('Classifieur', 'Classifier')),
            h('span', null, kt('Le modèle local qui choisit la classe avant routage — il ne voit que le message courant, jamais l\'historique. Défaut : tev1 en local.', 'The local model that picks the class before routing — it only sees the current message, never the history. Default: local tev1.'))),
          h('input', {
            className: 'kaa-classifier', 'data-kb': 'auto-classifier-input', type: 'text',
            placeholder: 'ollama-local/tev1:0.8b', value: etat.classifier,
            onChange: (ev) => setEtat({ ...etat, classifier: ev.target.value }),
            onBlur: () => ecrire({ autoClassifier: etat.classifier })
          })),
        h('div', { className: 'kaa-sante', 'data-kb': 'auto-health' },
          h('div', { className: 'kaa-sante-tete' },
            h('b', null, kt('Santé locale', 'Local health'))),
          etat.sante.length === 0
            ? h('p', { className: 'kaa-vide' }, kt('Aucun modèle dans la whitelist.', 'No model in the whitelist.'))
            : h('table', { className: 'kaa-table' },
              h('thead', null, h('tr', null,
                h('th', null, kt('Modèle', 'Model')), h('th', null, kt('Latence', 'Latency')),
                h('th', null, kt('Erreurs', 'Errors')), h('th', null, kt('Cache hit', 'Cache hit')))),
              h('tbody', null, etat.sante.map((s) => h('tr', { key: s.modele, className: s.etat === 'down' ? 'out' : '' },
                h('td', null,
                  h('span', { className: 'kaa-dot ' + (s.etat === 'down' ? 'down' : (s.etat === 'degrade' ? 'warn' : 'ok')) }),
                  ' ', s.modele.split('/').pop(),
                  etat.chaud === s.modele ? h('span', { className: 'kaa-warm', 'data-kb': 'auto-warm-cache' }, kt('cache chaud', 'warm cache')) : null,
                  h('small', { 'data-kb': 'auto-health-status' },
                    statutTxt(s, maintenant),
                    s.calls > 0 ? ' · ' + s.calls + ' ' + (s.calls > 1 ? kt('appels', 'calls') : kt('appel', 'call')) : ''),
                  s.etat !== 'ok' && s.etat !== 'jamais' && s.lastError && s.lastError.message
                    ? h('small', { className: 'kaa-why', 'data-kb': 'auto-health-why', title: s.lastError.message }, s.lastError.code + ' — ' + s.lastError.message)
                    : null),
                h('td', null, s.lastLatencyMs !== null && s.lastLatencyMs !== undefined ? (s.lastLatencyMs / 1000).toFixed(1) + ' s' : '—'),
                h('td', null, s.erreurPct !== null ? s.erreurPct + '%' : '—'),
                h('td', null, s.cacheHitPct !== null && s.cacheHitPct !== undefined
                  ? h('span', null, s.cacheHitPct + '%', h('span', { className: 'kaa-bar' }, h('i', { style: { width: s.cacheHitPct + '%' } })))
                  : '—'))))),
          h('div', { className: 'kaa-meta' },
            h('span', { 'data-kb': 'auto-last-check' }, kt('Dernière lecture il y a ', 'Last check '),
              Math.max(0, Math.round((maintenant - (etat.checkedAt || maintenant)) / 1000)) + ' s',
              kt(' · toutes les ', ' ago · every '), (etat.intervalS || 60) + ' s'),
            h('button', { type: 'button', className: 'kaa-recheck', 'data-kb': 'auto-health-recheck', disabled: sondage, onClick: sonder }, sondage ? kt('Vérification…', 'Checking…') : kt('Vérifier maintenant', 'Check now'))),
          h('p', { className: 'kaa-note' }, kt(
            'Avant de choisir, Auto interroge les candidats (une vraie question minuscule, verdict gardé ' + (etat.ttlSondeS || 60) + ' s) et ne propose que des modèles qui répondent, avec jusqu’à ' + (etat.plafond || 10) + ' replis ordonnés. Latence, erreurs et cache hit viennent des délégations qui rapportent leur issue (POST /kybernos-auto/report) ; « — » tant qu’aucune n’a rapporté.',
            'Before choosing, Auto asks the candidates a real, tiny question (the verdict is kept for ' + (etat.ttlSondeS || 60) + ' s) and only offers models that answer, with up to ' + (etat.plafond || 10) + ' ordered fallbacks. Latency, errors and cache hit come from delegations that report their outcome (POST /kybernos-auto/report); "—" until one has.')),
          h('div', { className: 'kaa-foot' }, h('code', null, 'scope: session'))),
        msg !== '' ? h('p', { className: 'kaa-err' }, msg) : null)
    }

    const CSS = [
      '.kaa-help{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-tertiary);font-size:9px;font-weight:600}',
      '[data-kb=auto-popover]{position:relative;z-index:1;margin-top:4px;padding:4px 0 6px;border-top:0.5px solid var(--dsw-alias-border-l2);font:inherit;cursor:default}',
      '.kaa-pop-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 12px;border-radius:10px;font-size:13px}',
      '.kaa-pop-row b{display:flex;align-items:center;gap:6px;font-weight:500;font-size:13.5px;color:var(--dsw-alias-label-primary)}',
      '.kaa-pop-row small{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:2px}',
      '.kaa-switch-btn{width:34px;height:20px;border:0;border-radius:999px;cursor:pointer;position:relative;flex:none;background:var(--dsw-alias-border-l3)}',
      '.kaa-switch-btn:disabled{cursor:default;opacity:.7}',
      '.kaa-switch-btn.on{background:var(--dsw-alias-state-warn-primary)}',
      '.kaa-sante-mini{margin-top:8px;border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:6px;width:100%}',
      '.kaa-sm-head{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:0 0 4px}',
      '.kaa-sm-row{display:grid;grid-template-columns:minmax(0,1fr) 52px 44px;gap:6px;align-items:center;padding:5px 0;font-size:12.5px;color:var(--dsw-alias-label-primary)}',
      '.kaa-sm-row.out{opacity:.55}',
      '.kaa-sm-nom{display:flex;align-items:center;gap:6px;min-width:0;font-weight:500;flex-wrap:wrap}',
      '.kaa-sm-nom small{flex-basis:100%;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.kaa-sm-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:end}',
      '.kaa-sm-vide{font-size:12.5px;color:var(--dsw-alias-label-tertiary);padding:4px 0}',
      '.kaa-switch-btn span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:left 120ms ease}',
      '.kaa-switch-btn.on span{left:16px}',
      '.kaa-pop-dispo{display:flex;align-items:center;gap:6px;margin:2px 8px 2px;padding:8px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.kaa-tag{font-size:11px;font-weight:500;vertical-align:middle;padding:2px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
      '.kaa-warm{font-size:10.5px;font-weight:500;margin-inline-start:6px;padding:1px 6px;border-radius:6px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-brand-primary)}',
      '.kaa-bar{display:block;height:6px;margin-top:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.kaa-bar i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.kaa-meta{display:flex;justify-content:space-between;align-items:center;margin:10px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-foot{margin-top:10px;padding-top:10px;border-top:0.5px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-foot code{font:12px ui-monospace,Menlo,monospace}',
      '.kaa-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}',
      '.kaa-dot.ok{background:var(--dsw-alias-state-success-primary)}',
      '.kaa-dot.warn{background:var(--dsw-alias-state-warn-primary)}',
      '.kaa-dot.down{background:var(--dsw-alias-state-error-primary)}',
      '.kaa-page{padding:0;max-width:720px;font-size:14px;line-height:normal}',
      '.kaa-page h4{margin:0 0 2px;font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.25}',
      '.kaa-intro{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.kaa-cache{display:flex;gap:8px;align-items:flex-start;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);',
      'border-radius:10px;padding:9px 12px;margin-bottom:14px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.kaa-ligne{display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
      '.kaa-ligne-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.kaa-ligne-txt b{font-size:14px;font-weight:400}',
      '.kaa-ligne-txt span{font-size:13px;color:var(--dsw-alias-label-tertiary);line-height:1.45}',
      '.kaa-chips-col{flex:none;width:320px;display:flex;flex-direction:column;gap:8px}',
      '.kaa-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;min-height:40px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.kaa-vide{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-chip{font-size:12px;font-family:ui-monospace,Menlo,monospace;display:inline-flex;align-items:center;gap:6px;padding:2px 4px 2px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kaa-chip button{border:0;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;padding:0 4px;line-height:1}',
      '.kaa-chip button:hover{color:var(--dsw-alias-label-primary)}',
      '.kaa-ajout{display:flex;gap:6px}',
      '.kaa-ajout-in{flex:1;min-width:0;height:30px;padding:0 10px;font:500 12.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);',
      'background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.kaa-ajout-btn{flex:none;height:30px;padding:0 12px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;',
      'background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kaa-classifier{flex:none;width:280px;height:34px;padding:0 12px;font:500 13px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);',
      'background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px}',
      '.kaa-sante{margin:14px 0 0}',
      '.kaa-sante-tete{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}',
      '.kaa-sante-tete b{font-size:14px;font-weight:600}',
      '.kaa-recheck{border:0;background:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;font-size:12.5px;padding:0}',
      '.kaa-recheck:disabled{opacity:.6;cursor:default}',
      '.kaa-table small.kaa-why{font-family:ui-monospace,Menlo,monospace;font-size:11px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kaa-table{width:100%;border-collapse:collapse;font-size:13px}',
      '.kaa-table th{text-align:start;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);',
      'padding:0 8px 6px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);font-weight:500}',
      '.kaa-table td{padding:9px 8px 9px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);font-variant-numeric:tabular-nums}',
      '.kaa-table tr.out td{opacity:.55}',
      '.kaa-table small{display:block;margin-inline-start:16px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}',
      '.kaa-note{margin:8px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-vide{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-err{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '@media (max-width:640px){.kaa-ligne{flex-direction:column;gap:8px}.kaa-chips-col,.kaa-classifier{width:100%}}'
    ].join('\n')

    return {
      inject: ['slots'],
      apply (ctx) {
        const slots = ctx.slots
        if (slots === undefined || slots === null) {
          try { console.error('[kybernos-auto] service slots indisponible : pas d interface') } catch (e) { /* */ }
          return
        }
        // CSS : un tag dédié (pas de service styles requis — même technique que
        // les autres bundles qui possèdent leur feuille).
        try {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-auto'
          tag.textContent = CSS
          document.head.append(tag)
        } catch (e) { /* hors navigateur */ }
        try {
            slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-auto-page', order: 14, label: 'Auto Routing' },
            () => h(KbAutoSettings)))
        // Label « Auto » dès le montage : l'état de la session courante est lu
        // sans attendre l'ouverture du menu (défaut T6 de la passée du 02/10).
        try {
          const appliquerAuMontage = () => {
            let sid = 'home'
            try {
              const j = JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null')
              if (j && j.sessionId) sid = String(j.sessionId)
            } catch (e2) { /* localStorage absent */ }
            fetch('/kybernos-auto/state?sessionId=' + encodeURIComponent(sid))
              .then((r) => r.json())
              .then((st) => { if (st && st.ok === true) appliquerChipAuto(st.sessionOn === true || st.global === true) })
              .catch(() => { /* hors ligne : réessai au prochain tick */ })
          }
          appliquerAuMontage()
          setInterval(appliquerAuMontage, 5000)
        } catch (e3) { /* sans DOM */ }
        } catch (e) { console.error('[kybernos-auto] montage client impossible', e) }
      }
    }
  }
})
