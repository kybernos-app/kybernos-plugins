// ═══════════════════════════════════════════════════════════════════════════
// kybernos-auto — client half.
//
// TWO surfaces, wired to /kybernos-auto/* (mock-up composer-auto-c-health):
//   1. an « Auto » panel anchored in the composer's model-picker menu:
//      PER-SESSION toggle, Model/Effort locked while Auto is on,
//      « N of M models available » pill;
//   2. the « Auto routing » Settings section: the models Auto may use, the classifier, the local health
//      per model (latency, errors, cache hit, « warm cache »), automatic
//      re-read every 60 s + « Re-check now ».
//
// i18n: the kbt/kbf bridge lives in @local/kybernos, which exposes
// window.__KB_LANG_RESOLVE__ — reused here (en/fr, falls back to fr).
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

        // The app does NOT put the session id in the URL: it keeps it in
        // localStorage « dsh.sessions.current ». The URL is only a fallback.
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

        // ── 1. the Auto row INSIDE the model picker's menu ───────────────
        // The native menu (role=menu, position:fixed, managed by React) holds Model and
        // Effort. OUR row is added as its last child: separator, Auto +
        // « This session only » toggle, « N of M models available » pill.
        // The menu is anchored by its TOP edge: growing, it would cover the composer's
        // chip, so it is moved up by the same amount (transform, which the native menu
        // does not touch). A foreign child survives React renders; the tick
        // puts it back if the menu was recreated.
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

        // Lock: only Model and Effort (role=menuitem) are greyed out while Auto
        // is on — our row stays active so that it can be switched off.
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
            // The native menu reacts to pointer / keyboard: nothing that happens
            // in our row must bubble up to it.
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
                // Global setting on (forced everywhere): switching it off HERE really turns it off,
                // otherwise the toggle would stay stuck on « On ». Then the session's state.
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

        // The row is built ONCE then updated in place: rebuilding
        // the DOM removed the button that had the focus, and the native menu closed
        // (focus lost). The nodes are kept in `refs`.
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
            // The button must not take the focus on a mouse press: the focus stays in the menu.
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
      refs = { sous, sw, pt, ptxt, sante, pastille }
    }

    const rendrePanneau = () => {
      if (panneau === null || etatPanneau === null) return
      if (refs === null || panneau.contains(refs.sw) === false) construireRangee()
            // Tolerant of an older host (before a restart): total/available are recomputed.
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
      const ton = (total === 0 ? 'warn' : (disponibles === 0 ? 'down' : (disponibles < total ? 'warn' : 'ok')))
      refs.pt.className = 'kaa-dot ' + ton
      if (refs.pastille) refs.pastille.className = 'kaa-pop-dispo ' + ton
      refs.ptxt.textContent = total === 0
        ? kt('Aucun modèle dans la whitelist', 'No model in the whitelist')
        : disponibles + kt(' sur ', ' of ') + total + (total > 1 ? kt(' modèles disponibles', ' models available') : kt(' modèle disponible', ' model available'))
            // Compact health card (mock-up c-health): state, latency, errors.
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
            // The native picker shows « Auto » when the mode is on for the
            // session (the original text is kept and restored when it is switched off).
      appliquerChipAuto(on)
      const menu = menuOuvert()
      if (menu !== null) decaler(menu)
    }

        // « Auto » label on the native chip: the original text is remembered in
        // a dataset and restored when switched off. A React re-render can bring back
        // the model's name — so it is re-applied periodically (composer tick).
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
                // De-duplication: several instances of the client (hot reloads) may
                // each attach their panel — only ours is kept.
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

        // ── 2. the dedicated Settings section ───────────────────────────────
    // The page shows the first rows of the health table and folds the rest (« all models » can list a hundred).
    const SANTE_VISIBLE = 8
    // Why the host refused a typed list, in the person's language (it answers with a code and the entries at fault).
    const refusTxt = (j) => {
      const code = j !== null && typeof j === 'object' ? String(j.code || '') : ''
      const brut = j !== null && typeof j === 'object' && Array.isArray(j.cles) && j.cles.length > 0 ? String(j.cles[0]) : ''
      const x = brut.length > 60 ? brut.slice(0, 57) + '…' : brut
      if (code === 'liste-forme') return kt('« ' + x + ' » n’est pas de la forme fournisseur/modèle (par exemple openrouter/anthropic/claude-sonnet-4.5).', '“' + x + '” is not a provider/model name (for example openrouter/anthropic/claude-sonnet-4.5).')
      if (code === 'liste-inconnu') return kt('« ' + x + ' » n’est pas un modèle que vous avez configuré. Choisissez-en un dans la liste, ou ajoutez-le d’abord dans Fournisseur IA & modèles.', '“' + x + '” is not a model you have configured. Pick one from the list, or add it first in AI Provider & Models.')
      if (code === 'liste') return kt('La liste est trop longue (64 au plus) ou contient un doublon.', 'The list is too long (64 at most) or has a duplicate.')
      return j !== null && typeof j === 'object' && j.erreur ? String(j.erreur) : 'Rejected.'
    }
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
      // The typed list says why an entry was refused, under its own field (the banner at the bottom of the page is for the rest).
      const refusPair = React.useState('')
      const refus = refusPair[0]
      const setRefus = refusPair[1]
      // The models of the profile, for the picker and the check of what is typed.
      const modelesPair = React.useState(null)
      const modeles = modelesPair[0]
      const setModeles = modelesPair[1]
      const avancePair = React.useState(false)
      const avance = avancePair[0]
      const setAvance = avancePair[1]
      const toutPair = React.useState(false)
      const toutVoir = toutPair[0]
      const setToutVoir = toutPair[1]

      const maintenantPair = React.useState(Date.now())
      const maintenant = maintenantPair[0]
      const setMaintenant = maintenantPair[1]
      const sondagePair = React.useState(false)
      const sondage = sondagePair[0]
      const setSondage = sondagePair[1]
      const lire = () => lireEtat('').then((j) => { if (j && j.ok === true) setEtat(j) })
            // Re-read every 60 s (intervalS) + a one-second clock for « Last check N s ago ».
      React.useEffect(() => {
        lire()
        fetch('/kybernos-auto/models').then((r) => r.json()).then((j) => { if (j && j.ok === true && Array.isArray(j.models)) setModeles(j.models) }).catch(() => { /* a host without the route: the picker is empty */ })
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
      // The typed list: the answer comes back to the field that asked, with the host's reason in the person's language.
      const ecrireListe = (patch) => fetch('/kybernos-auto/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      }).then((r) => r.json()).then((j) => {
        if (j && j.ok === true) { setEtat(j); setMsg(''); setRefus(''); return true }
        setRefus(refusTxt(j))
        return false
      }).catch((e) => { setRefus(String(e && e.message ? e.message : e)); return false })
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
      const scope = etat.scope === 'free' || etat.scope === 'custom' ? etat.scope : 'all'
      const typee = Array.isArray(etat.explicite) ? etat.explicite : (scope === 'custom' ? etat.whitelist : [])
      const retirer = (m) => ecrireListe({ autoWhitelist: typee.filter((x) => x !== m) })
      const ajouterModele = () => {
        const m = ajouter.trim()
        if (m === '') return
        if (typee.indexOf(m) !== -1) { setRefus(kt('« ' + m + ' » est déjà dans la liste.', '“' + m + '” is already in the list.')); return }
        // The profile is known: say at once what is not in it, before asking the host (which says the same, and judges the form).
        if (Array.isArray(modeles) && modeles.length > 0 && modeles.every((x) => x.cle !== m)) { setRefus(refusTxt({ code: 'liste-inconnu', cles: [m] })); return }
        ecrireListe({ autoWhitelist: typee.concat([m]) }).then((fait) => { if (fait) setAjouter('') })
      }
      const choisirScope = (s) => {
        if (s === scope) return
        setRefus('')
        ecrire({ autoScope: s })
      }

      const failoverInfo = etat.failover !== undefined && etat.failover !== null ? etat.failover : { enabled: false, last: null }
      const failoverOn = failoverInfo.enabled === true
      const failoverLast = failoverInfo.last !== undefined ? failoverInfo.last : null
      const total = typeof etat.total === 'number' ? etat.total : etat.sante.length
      const disponibles = typeof etat.disponibles === 'number' ? etat.disponibles : etat.sante.filter((v) => v.etat !== 'down').length
      const lignes = toutVoir ? etat.sante : etat.sante.slice(0, SANTE_VISIBLE)
      const scopes = [['all', kt('Tous les modèles', 'All models')], ['free', kt('Modèles gratuits', 'Free models')], ['custom', kt('Ma liste', 'My list')]]
      const scopeAide = {
        all: kt('Tous les modèles des fournisseurs que vous avez connectés. Un modèle ajouté plus tard est pris en compte tout seul.', 'Every model of the providers you connected. A model you add later is included by itself.'),
        free: kt('Seulement ceux qui ne coûtent rien : les modèles Free LLMs, ceux marqués « :free » et les modèles locaux.', 'Only the ones that cost nothing: the Free LLMs models, the ones marked “:free” and local models.'),
        custom: kt('Seulement les modèles que vous choisissez ci-dessous. L’ordre de la liste est l’ordre de repli.', 'Only the models you pick below. The list order is the fallback order.')
      }
      const etatCourt = scope !== 'custom' && total === 0
        ? kt('Aucun modèle connecté pour l’instant : connectez Kybernos Cloud ou ajoutez un fournisseur (Fournisseur IA & modèles), Auto s’en servira.', 'No model is connected yet: connect Kybernos Cloud or add a provider (AI Provider & Models) and Auto will use it.')
        : (total === 0
          ? kt('Votre liste est vide : le modèle de la session sera utilisé.', 'Your list is empty: the session model will be used.')
          : total + (total > 1 ? kt(' modèles autorisés', ' models allowed') : kt(' modèle autorisé', ' model allowed')) + ' · ' + disponibles + kt(' répondent', ' answering'))
      return h('div', { className: 'kaa-page', 'data-kb': 'auto-settings' },
        h('h4', { className: 'kb6-title', style: { fontSize: '26px', fontWeight: 800, letterSpacing: '-.01em' } }, 'Auto Routing'),
        h('p', { className: 'kaa-intro' }, kt(
          'Auto envoie chaque tâche déléguée au modèle le plus adapté parmi ceux que vous autorisez. Le modèle de votre chat n’est jamais changé.',
          'Auto sends each delegated task to the best-fit model among the ones you allow. Your chat’s own model is never changed.')),
        h('div', { className: 'kaa-ligne' },
          h('div', { className: 'kaa-ligne-txt' },
            h('b', null, kt('Routage automatique', 'Automatic routing')),
            h('span', null, kt('Activé : Auto sert dans toutes les sessions. Désactivé : vous l’activez session par session, depuis le menu du modèle dans le composer.', 'On: Auto is used in every session. Off: you turn it on per session, from the model menu in the composer.'))),
          h('button', {
            type: 'button', className: 'kaa-switch-btn' + (etat.global === true ? ' on' : ''), 'data-kb': 'auto-global-toggle',
            'aria-pressed': String(etat.global === true), 'aria-label': kt('Routage automatique', 'Automatic routing'),
            onClick: () => ecrire({ autoRouting: etat.global !== true })
          }, h('span', null))),
        h('div', { className: 'kaa-ligne kaa-ligne-modeles' },
          h('div', { className: 'kaa-ligne-txt' },
            h('b', null, kt('Modèles qu’Auto peut utiliser', 'Models Auto may use')),
            h('span', { 'data-kb': 'auto-scope-help' }, scopeAide[scope]),
            h('span', { className: 'kaa-etat', 'data-kb': 'auto-state-line' }, etatCourt)),
          h('div', { className: 'kaa-chips-col' },
            h('div', { className: 'kaa-seg', role: 'radiogroup', 'aria-label': kt('Modèles qu’Auto peut utiliser', 'Models Auto may use'), 'data-kb': 'auto-scope' },
              scopes.map((x) => h('button', {
                key: x[0], type: 'button', role: 'radio', 'aria-checked': String(scope === x[0]), className: 'kaa-seg-btn' + (scope === x[0] ? ' on' : ''),
                'data-kb': 'auto-scope-' + x[0], onClick: () => choisirScope(x[0])
              }, x[1]))),
            scope === 'custom'
              ? h(React.Fragment, null,
                h('div', { className: 'kaa-chips', 'data-kb': 'auto-whitelist-chips' },
                  typee.length === 0
                    ? h('span', { className: 'kaa-vide' }, kt('Aucun modèle — le modèle de session sera utilisé', 'No model — the session model will be used'))
                    : typee.map((m) => h('span', { className: 'kaa-chip', key: m },
                      m, h('button', { type: 'button', 'data-kb': 'auto-whitelist-remove', onClick: () => retirer(m), 'aria-label': 'Remove ' + m }, '×')))),
                h('div', { className: 'kaa-ajout' },
                  h('input', {
                    className: 'kaa-ajout-in', 'data-kb': 'auto-whitelist-add', type: 'text', list: 'kaa-modeles', autoComplete: 'off', spellCheck: false,
                    'aria-invalid': refus !== '' ? 'true' : 'false', 'aria-describedby': refus !== '' ? 'kaa-refus' : undefined,
                    placeholder: kt('fournisseur/modèle — choisissez dans la liste', 'provider/model — pick from the list'), value: ajouter,
                    onChange: (ev) => { setAjouter(ev.target.value); if (refus !== '') setRefus('') },
                    onKeyDown: (ev) => { if (ev.key === 'Enter') ajouterModele() }
                  }),
                  h('datalist', { id: 'kaa-modeles' }, (Array.isArray(modeles) ? modeles : []).filter((x) => typee.indexOf(x.cle) === -1).map((x) => h('option', { key: x.cle, value: x.cle }))),
                  h('button', { type: 'button', className: 'kaa-ajout-btn', onClick: ajouterModele }, kt('Ajouter', 'Add'))),
                refus !== '' ? h('p', { className: 'kaa-refus', id: 'kaa-refus', role: 'alert', 'data-kb': 'auto-whitelist-error' }, refus) : null)
              : null)),
        h('button', {
          type: 'button', className: 'kaa-pli', 'data-kb': 'auto-advanced', 'aria-expanded': String(avance), onClick: () => setAvance(!avance)
        }, h('span', { 'aria-hidden': 'true' }, avance ? '▾ ' : '▸ '), kt('Réglages avancés', 'Advanced settings'), h('small', null, kt(' · repli du chat, classifieur, santé des modèles', ' · chat fallback, classifier, model health'))),
        avance ? h('div', { className: 'kaa-avance', 'data-kb': 'auto-advanced-body' },
          h('div', { className: 'kaa-cache' },
            h('span', { 'aria-hidden': 'true' }, '⚡ '),
            h('span', null, kt('Optimisé cache : ', 'Cache-optimized: '), kt(
              "le modèle de session n'est jamais changé ; seules les délégations sont routées (sauf si le repli du chat, plus bas, est activé). Auto garde le modèle dont le cache est chaud et ne bascule que sur meilleur choix ou panne.",
              "the session model is never switched; only delegated work is routed (unless the chat fallback, below, is on). Auto keeps the warm-cache model and only switches on a clearly better fit or failure."))),
          h('div', { className: 'kaa-ligne' },
            h('div', { className: 'kaa-ligne-txt' },
              h('b', null, kt('Repli du chat', 'Chat fallback')),
              h('span', null, kt(
                'Activé : quand le modèle de votre chat ne peut pas répondre (clé refusée, fournisseur en panne), la même étape part vers le modèle suivant de la liste, puis le vôtre est réessayé après une pause. Le modèle de repli peut avoir un autre coût ; ni l\'effort de raisonnement ni le plafond de sortie ne sont repris. Désactivé par défaut.',
                'On: when your chat\'s own model cannot answer (key refused, provider down), the same step goes to the next model of the list, then yours is tried again after a pause. The fallback model may cost differently; neither the reasoning effort nor the output cap carry over. Off by default.')),
              failoverOn && failoverLast !== null
                ? h('span', { className: 'kaa-why', 'data-kb': 'auto-failover-last' },
                  kt('Dernier repli : ', 'Last fallback: '), failoverLast.from, ' → ', failoverLast.to, ' (', failoverLast.code, ') · ',
                  Math.max(0, Math.round((maintenant - failoverLast.at) / 1000)) + ' s', kt(' plus tôt', ' ago'))
                : null),
            h('button', {
              type: 'button', className: 'kaa-switch-btn' + (failoverOn ? ' on' : ''), 'data-kb': 'auto-failover-toggle',
              'aria-pressed': String(failoverOn), 'aria-label': kt('Repli du chat', 'Chat fallback'),
              onClick: () => ecrire({ autoFailover: !failoverOn })
            }, h('span', null))),
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
              ? h('p', { className: 'kaa-vide' }, kt('Aucun modèle dans la liste.', 'No model in the list.'))
              : h('table', { className: 'kaa-table' },
                h('thead', null, h('tr', null,
                  h('th', null, kt('Modèle', 'Model')), h('th', null, kt('Latence', 'Latency')),
                  h('th', null, kt('Erreurs', 'Errors')), h('th', null, kt('Cache hit', 'Cache hit')))),
                h('tbody', null, lignes.map((s) => h('tr', { key: s.modele, className: s.etat === 'down' ? 'out' : '' },
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
            etat.sante.length > SANTE_VISIBLE
              ? h('button', { type: 'button', className: 'kaa-recheck', 'data-kb': 'auto-health-more', onClick: () => setToutVoir(!toutVoir) },
                toutVoir ? kt('Voir moins', 'Show fewer') : kt('Voir les ' + etat.sante.length + ' modèles', 'Show all ' + etat.sante.length + ' models'))
              : null,
            h('div', { className: 'kaa-meta' },
              h('span', { 'data-kb': 'auto-last-check' }, kt('Dernière lecture il y a ', 'Last check '),
                Math.max(0, Math.round((maintenant - (etat.checkedAt || maintenant)) / 1000)) + ' s',
                kt(' · toutes les ', ' ago · every '), (etat.intervalS || 60) + ' s'),
              h('button', { type: 'button', className: 'kaa-recheck', 'data-kb': 'auto-health-recheck', disabled: sondage, onClick: sonder }, sondage ? kt('Vérification…', 'Checking…') : kt('Vérifier maintenant', 'Check now'))),
            h('p', { className: 'kaa-note' }, kt(
              'Avant de choisir, Auto interroge les candidats (une vraie question minuscule, verdict gardé ' + (etat.ttlSondeS || 60) + ' s) et ne propose que des modèles qui répondent, avec jusqu’à ' + (etat.plafond || 10) + ' replis ordonnés. « Vérifier maintenant » interroge les ' + (etat.sondeMax || 20) + ' premiers de la liste. Latence, erreurs et cache hit viennent des délégations qui rapportent leur issue ; « — » tant qu’aucune n’a rapporté.',
              'Before choosing, Auto asks the candidates a real, tiny question (the verdict is kept for ' + (etat.ttlSondeS || 60) + ' s) and only offers models that answer, with up to ' + (etat.plafond || 10) + ' ordered fallbacks. “Check now” asks the first ' + (etat.sondeMax || 20) + ' of the list. Latency, errors and cache hit come from delegations that report their outcome; "—" until one has.')))) : null,
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
      '.kaa-switch-btn span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left 120ms ease}',
      '.kaa-switch-btn.on span{left:16px;background:var(--dsw-alias-label-primary-foreground)}',
      '.kaa-pop-dispo{display:flex;align-items:center;gap:6px;margin:2px 8px 2px;padding:8px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.kaa-pop-dispo.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}',
      '.kaa-pop-dispo.down{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}',
      '.kaa-warm{font-size:10.5px;font-weight:500;margin-inline-start:6px;padding:1px 6px;border-radius:6px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-brand-primary)}',
      '.kaa-bar{display:block;height:6px;margin-top:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.kaa-bar i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.kaa-meta{display:flex;justify-content:space-between;align-items:center;margin:10px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
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
      '.kaa-seg{display:flex;gap:2px;padding:2px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.kaa-seg-btn{flex:1;min-width:0;height:28px;padding:0 8px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-secondary);background:transparent}',
      '.kaa-seg-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kaa-seg-btn.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);box-shadow:0 0 0 .5px var(--dsw-alias-border-l4)}',
      '.kaa-seg-btn:focus-visible,.kaa-pli:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.kaa-etat{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.kaa-refus{margin:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-state-error-primary)}',
      '.kaa-pli{display:flex;align-items:baseline;gap:2px;width:100%;margin:6px 0 0;padding:14px 0;border:0;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:none;cursor:pointer;font:inherit;font-size:14px;color:var(--dsw-alias-label-primary);text-align:start}',
      '.kaa-pli small{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kaa-avance .kaa-cache{margin:14px 0 0}',
      '.kaa-ajout-in{flex:1;min-width:0;height:30px;padding:0 10px;font:500 12.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);',
      'background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.kaa-ajout-btn{flex:none;height:30px;padding:0 12px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;',
      'background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kaa-classifier{flex:none;width:280px;height:34px;padding:0 12px;font:500 13px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);',
      'background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px}',
      // the browser's default placeholder is a mid grey: 3.4:1 on the dark layer
      '.kaa-ajout-in::placeholder,.kaa-classifier::placeholder{color:var(--dsw-alias-label-secondary)}',
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
                // CSS: a dedicated tag (no styles service required — same technique as
                // the other bundles that own their stylesheet).
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
                // « Auto » label from the mount: the current session's state is read
                // without waiting for the menu to open (defect T6 of the 02/10 pass).
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
