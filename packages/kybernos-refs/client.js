// kybernos-refs — moitié navigateur.
//
// Le comportement de la maquette v3 (docs/handoff/references-epurees/
// maquette-v3) sur les VRAIS messages du chat : chaque lien http d'un message
// assistant devient une pastille placée EN FIN de bloc (phrase), alignée sur la
// ligne de texte ; au survol une nappe d'accent et une flèche ↗ apparaissent ;
// un clic ouvre une carte de source au-dessus, avec l'URL et « Ouvrir ».
//
// Ce que le code ne fait JAMAIS :
//   - toucher au DOM que React gère structurellement : le lien d'origine est
//     laissé en place (masqué par CSS), seuls DEUX nœuds sont ajoutés à la FIN
//     du bloc (le wrapper pastille+carte) — React ne les connaît pas et n'a
//     pas à les retirer lui-même ;
//   - transformater les liens hors messages (`div[class*="_markdown_"]`) ni
//     ceux à l'intérieur de code (`pre`, `code`).
//
// Chargé via window.__ModuleLoader__.load — même forme que les paquets ui-*.
// CONTRAT DU RUNNER (incident du 26/09, mesuré) : la FACTORY doit RETOURNER
// un plugin cordis — un objet avec `apply(ctx)` (et `inject` si le contexte
// expose des services requis). Une factory qui ne retourne rien rend
// « invalid plugin, received undefined » et casse TOUTE l'entrée (« Failed to
// load plugins »). En cas d'erreur d'évaluation on retourne un plugin
// DÉSACTIVÉ : on dégrade, la GUI est préservée.
window.__ModuleLoader__.load({
  id: '@local/kybernos-refs',
  factory() {
    try {

      // ── CSS ──────────────────────────────────────────────────────────────
      // Jetons --dsw-alias-* mesurés live (26/09/2026) : le gris de citation
      // est le jeton prévu par DSH (le bg-layer-2 de kbm-pill rend
      // blanc-sur-blanc en clair) ; la nappe de survol (14 %/24 %) se pose en
      // background-image pour s'ADDITIONNER au gris — en shorthand `background`
      // elle le remplace et devient invisible (leçon maquette v3).
      const css = `
[data-kyb-remplacee] { display: none !important; }
.kyb-refs-cite { display: inline-flex; white-space: nowrap; position: relative; vertical-align: baseline; margin-left: 6px; }
.kyb-refs-pastille {
  position: relative; display: inline-flex; align-items: center; height: 24px; padding: 0 8px;
  border-radius: 12px; font-size: 12px; line-height: 1; text-decoration: none;
  /* !important : le sélecteur de liens du message (._markdown_ a) gagne en
     spécificité et peignait la pastille en bleu lien (constat capture 26/09). */
  color: var(--dsw-alias-label-secondary, #cfd3d6) !important;
  text-decoration: none !important;
  background-color: var(--dsw-alias-markdown-citation, rgba(128, 128, 128, 0.16)) !important;
  cursor: pointer; vertical-align: -0.5px;
}
.kyb-refs-pastille:hover, .kyb-refs-cite.kyb-refs-ouverte .kyb-refs-pastille {
  color: var(--dsw-alias-label-primary, inherit) !important;
  background-image: linear-gradient(var(--dsw-alias-interactive-bg-hover-accent, rgba(128, 128, 128, 0.16)), var(--dsw-alias-interactive-bg-hover-accent, rgba(128, 128, 128, 0.16)));
}
.kyb-refs-fleche {
  width: 6px; height: 6px; margin-left: 4px; opacity: 0; transition: opacity 120ms ease;
  border-top: 1.5px solid var(--dsw-alias-brand-primary, currentColor);
  border-right: 1.5px solid var(--dsw-alias-brand-primary, currentColor);
  transform: rotate(45deg) translateY(-1px);
}
.kyb-refs-pastille:hover .kyb-refs-fleche, .kyb-refs-cite.kyb-refs-ouverte .kyb-refs-fleche { opacity: 1; }
.kyb-refs-carte {
  display: none; position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30;
  width: 320px; max-width: min(320px, 86vw); padding: 12px 14px; text-align: left; white-space: normal;
  background: var(--dsw-alias-bg-base, #151517);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent, 0 4px 16px rgba(0, 0, 0, 0.2));
}
.kyb-refs-cite.kyb-refs-ouverte .kyb-refs-carte { display: block; }
.kyb-refs-cite.kyb-refs-dessous .kyb-refs-carte { bottom: auto; top: calc(100% + 8px); }
.kyb-refs-titre { display: block; font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--dsw-alias-label-primary, inherit); }
.kyb-refs-source { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); }
.kyb-refs-source svg { flex: none; width: 14px; height: 14px; }
.kyb-refs-pied { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.kyb-refs-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #cfd3d6); }
.kyb-refs-ouvrir { flex: none; font-size: 12px; color: var(--dsw-alias-link, #7aaaff); text-decoration: underline; text-underline-offset: 2px; }
`
      // ── utilitaires ──────────────────────────────────────────────────────
      // Posés à l'ACTIVATION (apply), pas au chargement du module : le runner
      // démarre le plugin après l'hydratation du shell.

      const GLOBE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="2.8" ry="6.2"/><path d="M2 8h12"/></svg>'

      /** « https://llm-stats.com/… » → « llm-stats » (étiquette de la pastille). */
      function nomSource(url) {
        try {
          var h = new URL(url, location.href).hostname.replace(/^www\./, '')
          var bouts = h.split('.')
          return bouts.length > 1 ? bouts[bouts.length - 2] : h
        } catch (e) { return 'source' }
      }

      function hote(url) {
        try { return new URL(url, location.href).hostname.replace(/^www\./, '') } catch (e) { return url }
      }

      function fermerTous() {
        document.querySelectorAll('.kyb-refs-cite.kyb-refs-ouverte').forEach(function (c) {
          c.classList.remove('kyb-refs-ouverte', 'kyb-refs-dessous')
        })
      }

      /** Ouvre (ou ferme) la carte d'une pastille, avec clampe aux bords. */
      function basculer(cite) {
        var deja = cite.classList.contains('kyb-refs-ouverte')
        fermerTous()
        if (deja) return
        var pastille = cite.querySelector('.kyb-refs-pastille')
        if (!pastille) return
        cite.classList.add('kyb-refs-ouverte')
        var carte = cite.querySelector('.kyb-refs-carte')
        if (carte) {
          var r = pastille.getBoundingClientRect()
          var largeur = Math.min(320, Math.max(220, Math.min(320, window.innerWidth * 0.86)))
          cite.classList.toggle('kyb-refs-dessous', r.top < largeur * 0.9 + 24)
          var debordement = r.left + largeur - (window.innerWidth - 12)
          carte.style.left = debordement > 0 ? (-debordement) + 'px' : '0px'
        }
      }

      /** Construit le wrapper pastille + carte pour UN lien d'origine. */
      function construireCite(lien) {
        var url = lien.href
        var texte = (lien.textContent || '').trim()
        var nom = nomSource(url)
        var cite = document.createElement('span')
        cite.className = 'kyb-refs-cite'
        cite.setAttribute('data-kyb-refs', '1')

        var pastille = document.createElement('a')
        pastille.className = 'kyb-refs-pastille'
        pastille.href = url
        pastille.textContent = nom
        var fleche = document.createElement('span')
        fleche.className = 'kyb-refs-fleche'
        fleche.setAttribute('aria-hidden', 'true')
        pastille.append(fleche)

        var carte = document.createElement('span')
        carte.className = 'kyb-refs-carte'
        carte.setAttribute('role', 'dialog')
        var titre = document.createElement('span')
        titre.className = 'kyb-refs-titre'
        titre.textContent = texte || hote(url)
        var source = document.createElement('span')
        source.className = 'kyb-refs-source'
        source.innerHTML = GLOBE
        var hoteSpan = document.createElement('span')
        hoteSpan.textContent = hote(url)
        source.append(hoteSpan)
        var pied = document.createElement('span')
        pied.className = 'kyb-refs-pied'
        var urlSpan = document.createElement('span')
        urlSpan.className = 'kyb-refs-url'
        urlSpan.textContent = url
        var ouvrir = document.createElement('a')
        ouvrir.className = 'kyb-refs-ouvrir'
        ouvrir.href = url
        ouvrir.target = '_blank'
        ouvrir.rel = 'noreferrer noopener'
        ouvrir.textContent = 'Ouvrir ↗'
        pied.append(urlSpan, ouvrir)
        carte.append(titre, source, pied)

        cite.append(pastille, carte)
        return cite
      }

      /** Le bloc de fin de phrase : le paragraphe/list item porteur du lien. */
      function blocDuLien(lien) {
        return lien.closest('p, li, h1, h2, h3, h4, h5, blockquote, dd, dt, td, th') || lien.parentElement
      }

      // ── la passe de transformation ───────────────────────────────────────
      // Idempotente : ne écrit le DOM QUE si quelque chose manque (lien non
      // transformé, wrapper déplacé par le rendu de streaming) — sinon elle ne
      // touche à rien et l'observateur retombe en sommeil.

      function passe() {
        var messages = document.querySelectorAll('div[class*="_markdown_"]')
        messages.forEach(function (message) {
          var liens = message.querySelectorAll('a[href^="http"]')
          liens.forEach(function (lien) {
            // TOUT le wrapper (pastille, carte, « Ouvrir ») est hors jeu : la
            // pastille EST un <a href^=http>, la laisse dans le sélecteur
            // faisait transformer les pastilles entre elles (cascade mesurée
            // le 26/09 : 42 cites → 1 938 en quelques passes).
            if (lien.closest('.kyb-refs-cite')) return
            if (lien.hasAttribute('data-kyb-remplacee')) {
              // déjà traité : garder la pastille en FIN de bloc (le streaming
              // peut avoir ajouté du texte après elle)
              var cite = lien.parentElement ? lien.parentElement.querySelector(':scope > .kyb-refs-cite') : null
              if (cite) {
                var bloc = blocDuLien(lien)
                if (bloc && bloc.lastElementChild !== cite) bloc.append(cite)
              }
              return
            }
            if (lien.closest('pre, code')) return
            var bloc = blocDuLien(lien)
            if (!bloc) return
            var cite = construireCite(lien)
            bloc.append(cite)
            lien.setAttribute('data-kyb-remplacee', '1')
          })
        })
      }

      // ── le plugin retourné au runner ─────────────────────────────────────
      // Tout le câblage DOM (styles, écouteurs, observateur) se pose à
      // l'activation, une seule fois par page.

      return {
        apply() {
          const styleTag = document.createElement('style')
          styleTag.dataset.plugin = '@local/kybernos-refs'
          styleTag.textContent = css
          document.head.append(styleTag)

          document.addEventListener('click', function (e) {
            var pastille = e.target.closest ? e.target.closest('.kyb-refs-pastille') : null
            if (pastille) {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return // ouverture native du lien
              e.preventDefault()
              basculer(pastille.closest('.kyb-refs-cite'))
              return
            }
            if (!e.target.closest || !e.target.closest('.kyb-refs-carte')) fermerTous()
          }, true)

          document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') fermerTous()
          }, true)

          var programmé = null
          var observateur = new MutationObserver(function () {
            if (programmé) return
            programmé = setTimeout(function () {
              programmé = null
              try { passe() } catch (err) { console.warn('[kybernos-refs] passe interrompue :', err) }
            }, 200)
          })
          observateur.observe(document.documentElement, { childList: true, subtree: true })
          passe()
        }
      }

    } catch (err) {
      console.warn('[kybernos-refs] désactivé :', err)
      return { apply() { /* plugin désactivé après erreur de chargement */ } }
    }
  }
})
