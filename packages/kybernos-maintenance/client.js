// ═══════════════════════════════════════════════════════════════════════════
// kybernos-maintenance — client. Page Réglages « Maintenance ».
//
// Refonte 30/09 inspirée de la maquette « Maintenance DSH – refonte » (une
// question par carte, états nommés, niveaux de compatibilité lisibles) :
//   · HERO ÉTAT : pastille + libellé d'état, verdict, détail, versions,
//     « Vérifier maintenant » + « Copier la commande » quand il y a à faire ;
//   · 4 CARTES STAT : Moteur (↕ vs npm latest) · Plugin (hash + zone) ·
//     Compatibilité (Parfaite/Compatible/Partielle/Hors zone + barre 4 crans)
//     · Mise à jour (Aucune/Possible/Recommandée/Requise) ;
//   · DERNIÈRE OPÉRATION en bandeau, procédure une commande par ligne ;
//   · BASCULE Simple/Avancé : l'avancé ajoute le contrat du plugin, la
//     matrice de compatibilité par version, le journal complet et les
//     surfaces du moteur (audit).
// Données : GET /kybernos-maintenance/state (host, lecture seule). Le client
// n'invente rien : niveaux et notes sont calculés côté hôte.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-maintenance/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    // Langue : MÊME règle que kbt du plugin principal (« kybernos » + aucune clé
    // kybernos.theme.lang + shell en anglais => anglais), lue via le résolveur qu'il expose.
    // Toute langue autre que le français retombe sur l'anglais, comme kbt.
    const kbLang = () => {
      try { if (typeof window.__KB_LANG_RESOLVE__ === 'function') return String(window.__KB_LANG_RESOLVE__()) } catch (e) { /* résolveur absent */ }
      try {
        const a = window.__KB_I18N_ACTIVE__
        if (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined && String(a.lang) !== '') return String(a.lang)
      } catch (e) { /* hors navigateur */ }
      return 'kybernos'
    }
    const kbEn = () => { const l = kbLang(); return l !== 'kybernos' && l.slice(0, 2).toLowerCase() !== 'fr' }
    // kbp(fr, en) : paire de libellés ; hs() : phrases mesurées par l'hôte (en français) ; nv() : niveaux.
    const kbp = (fr, en) => (kbEn() ? en : fr)
    const NIV_EN = { Parfaite: 'Perfect', Compatible: 'Compatible', Partielle: 'Partial', 'Hors zone': 'Out of range', Inconnue: 'Unknown', Aucune: 'None', Possible: 'Possible', 'Recommandée': 'Recommended', Requise: 'Required' }
    const nv = (n) => (kbEn() && NIV_EN[n] !== undefined ? NIV_EN[n] : n)
    const HS_STATIC = {
      'Le serveur a démarré avant la dernière mise à jour : il sert encore l\'ancien moteur. Redémarre DSH.': 'The server started before the last update: it is still serving the old engine. Restart DSH.',
      'Moteur hors de la zone supportée — reviens à la version testée ou attends un plugin adapté.': 'Engine outside the supported range — go back to the tested version or wait for a matching plugin.',
      'Registre npm injoignable — impossible de savoir si une mise à jour existe.': 'npm registry unreachable — cannot tell whether an update exists.',
      'Une version plus récente du moteur réactiverait les retouches non posées.': 'A newer engine version would re-enable the patches that are not applied.',
      'Version publiée prête ; dans la zone supportée, rien ne presse.': 'Published version ready; within the supported range, no rush.',
      'Version publiée dans la zone supportée, même contrat.': 'Published version within the supported range, same contract.',
      'Moteur plus récent que la plus récente version publiée (installation locale).': 'Engine newer than the newest published version (local install).',
      'Moteur plus récent que la version testée — la prochaine campagne de tests la validera.': 'Engine newer than the tested version — the next test run will validate it.',
      'Moteur installé = plus récente version publiée, tous canaux.': 'Installed engine = newest published version, all channels.',
      'Testée ensemble, retouches posées.': 'Tested together, patches applied.',
      'Zone de compatibilité absente du dépôt.': 'Compatibility range missing from the repository.',
      'Plus ancien que le minimum supporté.': 'Older than the supported minimum.',
      'Plus récent que le maximum supporté — ne doit pas tourner.': 'Newer than the supported maximum — must not run.',
      'Dans la zone, pas encore testée avec ce plugin.': 'Within range, not yet tested with this plugin.',
      'Démarrerait, des retouches en moins.': 'Would start, with fewer patches.',
      'testée': 'tested', 'installée': 'installed',
      'dictée locale (SenseVoice ONNX), bundle optionnel « Voice input »': 'local dictation (SenseVoice ONNX), optional “Voice input” bundle',
      'édition de la configuration des plugins (couture officielle)': 'plugin configuration editing (official seam)',
      'registre d\'agent presets (sélection par session)': 'agent preset registry (per-session selection)',
      'comptes et facturation (DeepSeek seulement)': 'accounts and billing (DeepSeek only)',
      'compétences Office (Word / PPT / Excel)': 'Office skills (Word / PPT / Excel)',
    }
    const HS_RX = [
      [/^Des paquets DSH du profil sont épinglés à une autre version que le moteur \((\d+)\)\.$/, 'DSH profile packages are pinned to a different version than the engine ($1).'],
      [/^Le paquet (.+) n'est pas lié au profil\.$/, 'Package $1 is not linked to the profile.'],
      [/^Le bundle (.+) n'est pas déclaré\.$/, 'Bundle $1 is not declared.'],
      [/^La version du moteur \((.+)\) n'a jamais été testée avec ce plugin\.$/, 'Engine version ($1) has never been tested with this plugin.'],
      [/^à jour — dernière publiée : (.+)$/, 'up to date — latest published: $1'],
      [/^à jour de la plus récente publiée \((.+)\)$/, 'up to date with the newest published ($1)'],
      [/^plus récente publiée : (.+) \(canal (.+) — hors zone supportée\)$/, 'newest published: $1 (channel $2 — outside the supported range)'],
      [/^plus récente publiée : (.+) \(canal (.+) — dans la zone\)$/, 'newest published: $1 (channel $2 — within the range)'],
      [/^en avance sur la plus récente publiée \((.+)\)$/, 'ahead of the newest published ($1)'],
      [/^Minimum demandé par le plugin : (.+)\.$/, 'Minimum required by the plugin: $1.'],
      [/^Une version plus récente existe \((.+), canal (.+)\) mais elle est hors de la zone supportée — attendre un plugin adapté\.$/, 'A newer version exists ($1, channel $2) but it is outside the supported range — wait for a matching plugin.'],
      [/^(.+) recoupe le natif « (.+) » \((.+)\)\.$/, '$1 overlaps the native “$2” ($3).'],
    ]
    const hs = (s) => {
      if (kbEn() === false || typeof s !== 'string') return s
      if (HS_STATIC[s] !== undefined) return HS_STATIC[s]
      for (let i = 0; i < HS_RX.length; i++) { if (HS_RX[i][0].test(s)) return s.replace(HS_RX[i][0], HS_RX[i][1]) }
      return s
    }

    const CSS = `
.kbmz-page{padding:0;max-width:720px;font-size:14px;line-height:normal;display:flex;flex-direction:column;gap:20px}
.kbmz-titre{margin:0;font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbmz-sous{margin:6px 0 0;max-width:720px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
[data-slot="settings.section"]:has(.kbmz-page){width:100%;max-width:none}
/* Bascule Simple/Avancé (maquette 30/09) */
.kbmz-haut{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.kbmz-seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex:none}
.kbmz-seg button{border:0;background:transparent;border-radius:8px;padding:5px 14px;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit}
.kbmz-seg button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-active));color:var(--dsw-alias-label-primary);font-weight:600}
/* Hero état : pastille + verdict + actions, bord teinté par l'état */
.kbmz-hero{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:14px;border:1px solid var(--kbmz-ton,-);background:linear-gradient(0deg,var(--kbmz-tbg,transparent),var(--kbmz-tbg,transparent)),var(--dsw-alias-bg-layer-1)}
.kbmz-dot{width:12px;height:12px;border-radius:6px;flex:none;margin-top:4px;background:var(--kbmz-tdot)}
.kbmz-hero-txt{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.kbmz-kicker{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--kbmz-tc)}
.kbmz-hero-txt b{font-size:14px;color:var(--dsw-alias-label-primary)}
.kbmz-hero-detail{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbmz-versions{color:var(--dsw-alias-label-secondary);font-size:13px;font-variant-numeric:tabular-nums}
.kbmz-actions{display:flex;flex-direction:column;gap:8px;flex:none}
.kbmz-bouton{border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.kbmz-bouton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbmz-bouton[data-primaire="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbmz-bouton:disabled{opacity:.6;cursor:default}
/* 4 cartes stat */
.kbmz-cartes{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.kbmz-stat{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.kbmz-stat-l{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbmz-stat-v{font-size:20px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;min-width:0}
.kbmz-stat-v code{font-family:ui-monospace,Menlo,monospace;font-size:16px}
.kbmz-fleche{font-size:14px;font-weight:700}
.kbmz-fleche[data-dir="up"]{color:#3b9eff}
.kbmz-fleche[data-dir="down"]{color:#ff9f0a}
.kbmz-fleche[data-dir="same"]{color:var(--dsw-alias-label-tertiary)}
.kbmz-stat-n{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
/* Badges de niveau + barre 4 crans */
.kbmz-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em}
.kbmz-badge[data-niveau="Parfaite"],.kbmz-badge[data-niveau="Aucune"],.kbmz-badge[data-niveau="réussi"]{background:rgba(52,199,89,.14);color:#2fae52}
.kbmz-badge[data-niveau="Compatible"],.kbmz-badge[data-niveau="Possible"]{background:rgba(59,158,255,.14);color:#3b9eff}
.kbmz-badge[data-niveau="Partielle"],.kbmz-badge[data-niveau="Recommandée"],.kbmz-badge[data-niveau="retour-arriere"]{background:rgba(245,165,36,.16);color:#d98a0b}
.kbmz-badge[data-niveau="Hors zone"],.kbmz-badge[data-niveau="Requise"],.kbmz-badge[data-niveau="Inconnue"],.kbmz-badge[data-niveau="echec"]{background:rgba(255,92,92,.15);color:#e5484d}
[data-kbr-theme="clair"] .kbmz-badge,.kbmz-badge{color:var(--kbmz-badge-c,var(--dsw-alias-label-primary))}
.kbmz-bar{display:inline-flex;gap:4px}
.kbmz-bar span{width:17px;height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-active)}
.kbmz-bar span[data-on="true"]{background:var(--kbmz-ton-bar,#34c759)}
/* Cartes génériques + journal */
.kbmz-carte{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}
.kbmz-sec{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-label-primary)}
.kbmz-problemes{margin:0;padding-inline-start:18px;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbmz-problemes li{margin:3px 0}
.kbmz-ligne{display:flex;gap:12px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px;align-items:baseline}
.kbmz-ligne:first-of-type{border-top:0;padding-top:2px}
.kbmz-date{flex:none;width:120px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbmz-quoi{flex:none;width:64px;color:var(--dsw-alias-label-secondary)}
.kbmz-vers{flex:1;min-width:0;overflow-wrap:anywhere}
.kbmz-res{flex:none}
.kbmz-vide{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:6px 0}
.kbmz-details{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.kbmz-details summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbmz-details summary:hover{color:var(--dsw-alias-label-primary)}
.kbmz-details .kbmz-sec{margin-top:10px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.kbmz-proc{background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbmz-cmd{display:flex;align-items:center;gap:8px;margin-top:6px}
.kbmz-cmd code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-primary);flex:1;min-width:0;overflow-wrap:anywhere}
.kbmz-cmd button{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);flex:none}
.kbmz-cmd button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* Matrice de compatibilité (vue avancée) */
.kbmz-mat-tete,.kbmz-mat-ligne{display:grid;grid-template-columns:150px 120px minmax(0,1fr) 150px;gap:12px;align-items:center}
.kbmz-mat-tete{padding:0 12px 6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbmz-mat-ligne{padding:11px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);margin-top:6px;font-size:13px;background:var(--dsw-alias-bg-layer-1)}
.kbmz-mat-ligne[data-ici="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbmz-mat-v{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbmz-mat-ligne .kbmz-repere{text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbmz-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px;font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:12px}
.kbmz-legend span{display:inline-flex;align-items:center;gap:8px}
/* Tonalités (ok / info / warn / bad) posées en variables locales */
.kbmz-hero[data-tone="ok"]{--kbmz-ton:#34c759;--kbmz-tbg:rgba(52,199,89,.08);--kbmz-tc:#2fae52;--kbmz-tdot:#34c759;border-color:rgba(52,199,89,.35)}
.kbmz-hero[data-tone="info"]{--kbmz-ton:#3b9eff;--kbmz-tbg:rgba(59,158,255,.08);--kbmz-tc:#3b9eff;--kbmz-tdot:#3b9eff;border-color:rgba(59,158,255,.38)}
.kbmz-hero[data-tone="warn"]{--kbmz-ton:#ff9f0a;--kbmz-tbg:rgba(245,165,36,.08);--kbmz-tc:#d98a0b;--kbmz-tdot:#f5a524;border-color:rgba(245,165,36,.4)}
.kbmz-hero[data-tone="bad"]{--kbmz-ton:#ff453a;--kbmz-tbg:rgba(255,92,92,.08);--kbmz-tc:#e5484d;--kbmz-tdot:#ff5c5c;border-color:rgba(255,92,92,.4)}
`

    let cssPose = false
    const poserCss = () => {
      if (cssPose || typeof document === 'undefined') return
      const s = document.createElement('style')
      s.id = 'kbmz-style'
      s.textContent = CSS
      document.head.appendChild(s)
      cssPose = true
    }

    const FR = {
      titre: 'Maintenance',
      'sous.titre': 'État du moteur et du plugin, compatibilité et mises à jour — ce que le robot mesure, ici affiché.',
      vueSimple: 'Simple',
      vueAvance: 'Avancé',
      moteur: 'Moteur (harness)',
      plugin: 'Plugin Kybernos',
      compat: 'Compatibilité',
      maj: 'Mise à jour',
      registreKo: 'Registre npm injoignable',
      zone: 'Plage de moteurs supportée',
      testee: 'Parfaitement compatible (testée)',
      surfacesReq: 'Surfaces du moteur requises',
      niveauxTitre: 'Compatibilité du plugin selon la version du moteur',
      colMoteur: 'Moteur',
      colNiveau: 'Niveau',
      colDetail: 'Détail',
      colReperes: 'Repères',
      installee: 'installée',
      derniere: 'Dernière opération',
      ok: 'Tout va bien — moteur et plugin synchronisés',
      detailOk: 'Le moteur installé est dans la zone supportée et au niveau de la version testée.',
      avancer: 'Moteur en avance',
      detailAvancer: 'Moteur plus récent que la version testée avec ce plugin — ça fonctionne, à valider ensemble.',
      partielle: 'Compatibilité partielle',
      detailPartielle: 'Ça démarre, mais des retouches ne sont pas posées sur ce moteur : mettre à jour est recommandé.',
      action: 'Action requise',
      detailAction: 'Le moteur est hors de la zone supportée par le plugin.',
      afaire: 'À vérifier',
      detailAfaire: 'Le robot a relevé des écarts à corriger (voir la liste).',
      verifier: 'Vérifier maintenant',
      verifie: 'Vérifié à l’instant',
      copierCmd: 'Copier la commande',
      copieCmd: 'Commande copiée ✓',
      contract: 'Contrat du plugin',
      majRecentes: 'Mises à jour récentes',
      rien: 'Aucune mise à jour enregistrée pour l’instant.',
      moteurMin: 'moteur',
      pluginMot: 'plugin',
      procTitre: 'Pour mettre à jour (une commande, depuis un terminal)',
      procL1: 'cd <dossier du dépôt dsh-kybernos>',
      procL2: 'node scripts/dsh-lifecycle.mjs doctor     # état, ne change rien',
      procL3: 'node scripts/dsh-lifecycle.mjs upgrade    # photo + mise à jour + vérification',
      procL4: 'En cas d’échec, la machine revient toute seule à l’état d’avant.',
      rafr: 'Vérifier',
      copier: 'Copier',
      copie: 'Copié ✓',
      surfaces: 'Détails techniques : surfaces du moteur',
      surfacesOuvert: 'Voir les surfaces du moteur, capacités natives et recoupements',
      natifs: 'Capacités natives livrées',
      doublons: 'Recoupements à arbitrer'
    }

    const EN = {
      titre: 'Maintenance',
      'sous.titre': 'Engine and plugin status, compatibility and updates — what the robot measures, shown here.',
      vueSimple: 'Simple',
      vueAvance: 'Advanced',
      moteur: 'Engine (harness)',
      plugin: 'Kybernos plugin',
      compat: 'Compatibility',
      maj: 'Update',
      registreKo: 'npm registry unreachable',
      zone: 'Supported engine range',
      testee: 'Perfectly compatible (tested)',
      surfacesReq: 'Required engine surfaces',
      niveauxTitre: 'Plugin compatibility by engine version',
      colMoteur: 'Engine',
      colNiveau: 'Level',
      colDetail: 'Detail',
      colReperes: 'Markers',
      installee: 'installed',
      derniere: 'Last operation',
      ok: 'All good — engine and plugin in sync',
      detailOk: 'The installed engine is within the supported range and at the tested version level.',
      avancer: 'Engine ahead',
      detailAvancer: 'Engine newer than the version tested with this plugin — it works, to be validated together.',
      partielle: 'Partial compatibility',
      detailPartielle: 'It starts, but some patches are not applied on this engine: updating is recommended.',
      action: 'Action required',
      detailAction: 'The engine is outside the range supported by the plugin.',
      afaire: 'To check',
      detailAfaire: 'The robot found discrepancies to fix (see the list).',
      verifier: 'Check now',
      verifie: 'Checked just now',
      copierCmd: 'Copy the command',
      copieCmd: 'Command copied ✓',
      contract: 'Plugin contract',
      majRecentes: 'Recent updates',
      rien: 'No update recorded yet.',
      moteurMin: 'engine',
      pluginMot: 'plugin',
      procTitre: 'To update (one command, from a terminal)',
      procL1: 'cd <dsh-kybernos repository folder>',
      procL2: 'node scripts/dsh-lifecycle.mjs doctor     # status, changes nothing',
      procL3: 'node scripts/dsh-lifecycle.mjs upgrade    # snapshot + update + check',
      procL4: 'If it fails, the machine rolls back to its previous state by itself.',
      rafr: 'Check',
      copier: 'Copy',
      copie: 'Copied ✓',
      surfaces: 'Technical details: engine surfaces',
      surfacesOuvert: 'Show engine surfaces, native capabilities and overlaps',
      natifs: 'Native capabilities shipped',
      doublons: 'Overlaps to arbitrate'
    }

    // Étendue des niveaux pour la barre 4 crans (ordre croissant de santé).
    const ECHELLE = ['Hors zone', 'Partielle', 'Compatible', 'Parfaite']
    const TONE_PAR_NIVEAU = { Parfaite: 'ok', Compatible: 'info', Partielle: 'warn', 'Hors zone': 'bad' }

    function Page ({ etat, onRafraichir, charge }) {
      const t = (k) => (kbEn() ? (EN[k] ?? FR[k]) : FR[k]) ?? k
      const resTexte = { reussi: kbp('✓ réussi', '✓ succeeded'), echec: kbp('✗ échec', '✗ failed'), 'retour-arriere': kbp('↩ retour arrière', '↩ rolled back') }
      const resCouleur = { reussi: 'reussi', echec: 'echec', 'retour-arriere': 'retour-arriere' }
      const [copie, setCopie] = React.useState(null)
      const [vue, setVue] = React.useState('simple')
      const copier = (txt, cle) => {
        try {
          navigator.clipboard.writeText(txt)
            .then(() => { setCopie(cle); setTimeout(() => setCopie(null), 1600) })
            .catch(() => {})
        } catch (e) { /* presse-papiers indisponible */ }
      }
      const CMD = 'node scripts/dsh-lifecycle.mjs '

      // ── lecture de l'état mesuré par l'hôte ────────────────────────────────
      const compat = etat.compat || null
      const niveau = etat.niveau || 'Inconnue'
      const distant = etat.distant || { ok: false, latest: null }
      const maj = etat.maj || { niveau: 'Inconnue', cible: null, note: t('registreKo') }
      const problemePrincipal = etat.problemes.length > 0
      // Tonalité du hero : problèmes > niveau de compat > défaut vert.
      const tone = problemePrincipal
        ? (compat && compat.horsZone ? 'bad' : 'warn')
        : (TONE_PAR_NIVEAU[niveau] || 'ok')
      const hero = (() => {
        if (niveau === 'Hors zone') return { kicker: t('action'), titre: t('action'), detail: problemePrincipal ? hs(etat.problemes[0]) : t('detailAction') }
        if (problemePrincipal) return { kicker: t('afaire'), titre: hs(etat.problemes[0]), detail: etat.problemes.slice(1).map(hs).join(' ') || hs(maj.note) }
        if (niveau === 'Parfaite') return { kicker: kbp('Synchronisé', 'In sync'), titre: t('ok'), detail: t('detailOk') }
        if (niveau === 'Compatible') return { kicker: t('avancer'), titre: t('avancer'), detail: t('detailAvancer') }
        if (niveau === 'Partielle') return { kicker: t('partielle'), titre: t('partielle'), detail: t('detailPartielle') }
        if (niveau === 'Hors zone') return { kicker: t('action'), titre: t('action'), detail: t('detailAction') }
        return { kicker: t('afaire'), titre: t('ok'), detail: t('detailAfaire') }
      })()
      const crans = ECHELLE.indexOf(niveau) === -1 ? 0 : ECHELLE.indexOf(niveau) + 1
      const cmdMaj = maj.niveau !== 'Aucune' && maj.niveau !== 'Inconnue' && maj.cible !== null
        ? CMD + 'upgrade' : null

      // Journal : la dernière opération en bandeau (simple), tout en avancé.
      const journal = etat.journal || []
      const ligneJournal = (e, i) => h('div', { className: 'kbmz-ligne', key: i },
        h('span', { className: 'kbmz-date' }, String(e.date || '').replace('T', ' ').slice(0, 16)),
        h('span', { className: 'kbmz-quoi' }, t(e.quoi)),
        h('span', { className: 'kbmz-vers' }, `${e.de} → ${e.vers}${e.raison ? ' — ' + e.raison : ''}`),
        h('span', { className: 'kbmz-res' }, h('span', { className: 'kbmz-badge', 'data-niveau': resCouleur[e.resultat] || '' }, resTexte[e.resultat] || e.resultat)))

      // Surfaces du moteur (audit) — vue avancée uniquement.
      const s = etat.surfaces || null
      const natifsNatifs = (s && s.natifs) || []
      const doublonsNatifs = (s && s.doublons) || []
      const blocSurfaces = s === null ? null : h('details', { className: 'kbmz-details' },
        h('summary', null, t('surfacesOuvert')),
        h('div', { className: 'kbmz-ligne' },
          h('span', { className: 'kbmz-vers' }, s.erreur !== undefined
            ? kbp('Audit impossible : ', 'Audit failed: ') + s.erreur
            : `${s.conformes}/${s.total} ` + kbp('contrats du moteur conformes', 'engine contracts compliant') +
              (s.mesureesSurVierge > 0 ? ` (${s.mesureesSurVierge} ` + kbp('mesurés sur une sauvegarde vierge', 'measured on a clean backup') + ')' : ''))),
        natifsNatifs.length > 0 ? h('div', { className: 'kbmz-sec' }, t('natifs')) : null,
        natifsNatifs.map((n, i) => h('div', { className: 'kbmz-ligne', key: 'n' + i },
          h('span', { className: 'kbmz-date' }, n.monte ? kbp('● montée', '● mounted') : n.livre ? kbp('○ non montée', '○ not mounted') : kbp('— absente', '— absent')),
          h('span', { className: 'kbmz-vers' }, `${n.paquet} — ${hs(n.quoi)}`))),
        doublonsNatifs.length > 0 ? h('div', { className: 'kbmz-sec' }, t('doublons')) : null,
        doublonsNatifs.map((d, i) => h('div', { className: 'kbmz-ligne', key: 'd' + i },
          h('span', { className: 'kbmz-vers' }, hs(d)))))

      // ── les 4 cartes stat ──────────────────────────────────────────────────
      const carteMoteur = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-engine-card' },
        h('span', { className: 'kbmz-stat-l' }, t('moteur')),
        h('span', { className: 'kbmz-stat-v' },
          h('code', null, etat.global),
          h('span', { className: 'kbmz-fleche', 'data-dir': etat.direction || 'same', title: distant.ok ? `latest ${distant.latest || '—'} · next ${distant.next || '—'} · alpha ${distant.alpha || '—'}` : t('registreKo') },
            etat.direction === 'up' ? '↑' : etat.direction === 'down' ? '↓' : '=')),
        h('span', { className: 'kbmz-stat-n' }, hs(distant.note) || t('registreKo')))
      const cartePlugin = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-plugin-card' },
        h('span', { className: 'kbmz-stat-l' }, t('plugin')),
        h('span', { className: 'kbmz-stat-v' }, h('code', null, etat.plugin)),
        h('span', { className: 'kbmz-stat-n' }, compat && compat.min !== null
          ? `${t('zone')} : ${compat.min}${compat.max ? ' → ' + compat.max : ''}` : kbp('zone de compatibilité absente', 'compatibility range missing')))
      const carteCompat = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-compat-card' },
        h('span', { className: 'kbmz-stat-l' }, t('compat')),
        h('span', { className: 'kbmz-stat-v' },
          h('span', { className: 'kbmz-badge', 'data-niveau': niveau }, nv(niveau)),
          h('span', { className: 'kbmz-bar', style: { '--kbmz-ton-bar': tone === 'bad' ? '#ff453a' : tone === 'warn' ? '#ff9f0a' : tone === 'info' ? '#3b9eff' : '#34c759' }, 'aria-hidden': 'true' }, ECHELLE.map((n) => h('span', { key: n, 'data-on': ECHELLE.indexOf(niveau) >= ECHELLE.indexOf(n) && niveau !== 'Inconnue' ? 'true' : 'false' })))),
        h('span', { className: 'kbmz-stat-n' }, etat.testee ? kbp('testée avec le plugin : ', 'tested with the plugin: ') + etat.testee : kbp('aucune version testée déclarée', 'no tested version declared')))
      const carteMaj = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-update-card' },
        h('span', { className: 'kbmz-stat-l' }, t('maj')),
        h('span', { className: 'kbmz-stat-v' }, h('span', { className: 'kbmz-badge', 'data-niveau': maj.niveau }, nv(maj.niveau))),
        h('span', { className: 'kbmz-stat-n' }, `${hs(maj.note)}${maj.cible ? ` → ${maj.cible}` : ''}`))

      // ── vue avancée : contrat + matrice ────────────────────────────────────
      const contrat = h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-contract-card' },
        h('div', { className: 'kbmz-sec' }, `${t('contract')} ${etat.plugin}`),
        h('div', { className: 'kbmz-ligne' },
          h('span', { className: 'kbmz-date', style: { width: '190px' } }, t('zone')),
          h('span', { className: 'kbmz-vers' }, compat && compat.min !== null ? `≥ ${compat.min}${compat.max ? '  < ' + compat.max : ''}` : '—')),
        h('div', { className: 'kbmz-ligne' },
          h('span', { className: 'kbmz-date', style: { width: '190px' } }, t('testee')),
          h('span', { className: 'kbmz-vers' }, etat.testee || '—')),
        h('div', { className: 'kbmz-ligne' },
          h('span', { className: 'kbmz-date', style: { width: '190px' } }, t('surfacesReq')),
          h('span', { className: 'kbmz-vers' }, s && !s.erreur ? `${s.conformes}/${s.total}` : '—')),
        h('div', { className: 'kbmz-legend' },
          h('span', null, h('span', { className: 'kbmz-badge', 'data-niveau': 'Parfaite' }, nv('Parfaite')), kbp('testée ensemble', 'tested together')),
          h('span', null, h('span', { className: 'kbmz-badge', 'data-niveau': 'Compatible' }, nv('Compatible')), kbp('dans la zone, non testée', 'within range, not tested')),
          h('span', null, h('span', { className: 'kbmz-badge', 'data-niveau': 'Partielle' }, nv('Partielle')), kbp('démarre, retouches en moins', 'starts, fewer patches')),
          h('span', null, h('span', { className: 'kbmz-badge', 'data-niveau': 'Hors zone' }, nv('Hors zone')), kbp('ne doit pas tourner', 'must not run'))))
      const matrice = h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-compat-matrix' },
        h('div', { className: 'kbmz-sec' }, t('niveauxTitre')),
        h('div', { className: 'kbmz-mat-tete' },
          h('span', null, t('colMoteur')), h('span', null, t('colNiveau')), h('span', null, t('colDetail')), h('span', { style: { textAlign: 'right' } }, t('colReperes'))),
        (etat.versions || []).map((r, i) => h('div', { className: 'kbmz-mat-ligne', key: i, 'data-ici': (r.ici === true || r.v === etat.global) ? 'true' : 'false' },
          h('span', { className: 'kbmz-mat-v' }, r.v + (r.v === etat.global ? '  ●' : '')),
          h('span', null, h('span', { className: 'kbmz-badge', 'data-niveau': r.niveau }, nv(r.niveau))),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, hs(r.detail)),
          h('span', { className: 'kbmz-repere' }, String(r.repere).split(' · ').map(hs).join(' · ')))))

      // ── assemblage selon la vue ────────────────────────────────────────────
      return h('div', { className: 'kbmz-page' },
        h('div', { className: 'kbmz-haut' },
          h('div', null,
            h('h1', { className: 'kbmz-titre' }, t('titre')),
            h('p', { className: 'kbmz-sous' }, t('sous.titre'))),
          h('div', { className: 'kbmz-seg', role: 'group', 'aria-label': kbp('Vue', 'View') },
            h('button', { type: 'button', 'data-kb': 'maintenance-vue-simple', 'aria-pressed': vue === 'simple' ? 'true' : 'false', onClick: () => setVue('simple') }, t('vueSimple')),
            h('button', { type: 'button', 'data-kb': 'maintenance-vue-avance', 'aria-pressed': vue === 'avance' ? 'true' : 'false', onClick: () => setVue('avance') }, t('vueAvance')))),
        // HERO ÉTAT
        h('div', { className: 'kbmz-hero', 'data-tone': tone, 'data-kb': 'maintenance-hero' },
          h('span', { className: 'kbmz-dot', 'aria-hidden': 'true' }),
          h('div', { className: 'kbmz-hero-txt' },
            h('span', { className: 'kbmz-kicker' }, hero.kicker),
            h('b', null, hero.titre),
            hero.detail ? h('span', { className: 'kbmz-hero-detail' }, hero.detail) : null,
            h('span', { className: 'kbmz-versions' }, `${kbp('Moteur', 'Engine')} ${etat.global} · Plugin ${etat.plugin}${distant.ok && distant.latest ? ` · npm latest ${distant.latest}` : ''}`)),
          h('div', { className: 'kbmz-actions' },
            cmdMaj !== null
              ? h('button', { className: 'kbmz-bouton', 'data-primaire': 'true', 'data-kb': 'maintenance-copy-upgrade', onClick: () => copier(cmdMaj, 'maj') }, copie === 'maj' ? t('copieCmd') : t('copierCmd'))
              : null,
            h('button', { className: 'kbmz-bouton', 'data-kb': 'maintenance-refresh', onClick: onRafraichir, disabled: charge }, charge ? '…' : t('verifier')))),
        problemePrincipal ? h('ul', { className: 'kbmz-problemes' }, etat.problemes.map((p, i) => h('li', { key: i }, hs(p)))) : null,
        // 4 CARTES STAT
        h('div', { className: 'kbmz-cartes' }, carteMoteur, cartePlugin, carteCompat, carteMaj),
        // VUE SIMPLE : dernière opération + procédure
        vue === 'simple' ? h(React.Fragment, null,
          h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-last-op' },
            h('div', { className: 'kbmz-sec' }, t('derniere')),
            journal.length === 0 ? h('div', { className: 'kbmz-vide' }, t('rien'))
              : ligneJournal(journal[0], 0)),
          h('div', { className: 'kbmz-carte' },
            h('div', { className: 'kbmz-sec' }, t('procTitre')),
            h('div', { className: 'kbmz-proc' },
              h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL1')),
                h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL1'), 'l1') }, copie === 'l1' ? t('copie') : t('copier'))),
              h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL2')),
                h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL2'), 'l2') }, copie === 'l2' ? t('copie') : t('copier'))),
              h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL3')),
                h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL3'), 'l3') }, copie === 'l3' ? t('copie') : t('copier'))),
              h('div', { className: 'kbmz-ligne', style: { borderTop: '0', color: 'inherit' } }, t('procL4')))))
        // VUE AVANCÉE : contrat, matrice, journal complet, surfaces
          : h(React.Fragment, null,
            contrat,
            matrice,
            h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-journal' },
              h('div', { className: 'kbmz-sec' }, t('majRecentes')),
              journal.length === 0 ? h('div', { className: 'kbmz-vide' }, t('rien')) : journal.map(ligneJournal)),
            h('div', { className: 'kbmz-carte' }, blocSurfaces)))
    }

    // Le conteneur : charge l'état mesuré par l'hôte (GET lecture seule) et
    // recharge au besoin. Aucune invention côté client.
    function Conteneur () {
      const pair = React.useState(null)
      const etat = pair[0]
      const setEtat = pair[1]
      const chargePair = React.useState(false)
      const charge = chargePair[0]
      const setCharge = chargePair[1]
      const charger = React.useCallback(() => {
        setCharge(true)
        try {
          fetch('/kybernos-maintenance/state')
            .then((r) => r.json())
            .then((j) => setEtat(j))
            .catch(() => {})
            .finally(() => setCharge(false))
        } catch (e) { setCharge(false) }
      }, [])
      React.useEffect(() => { poserCss(); charger() }, [charger])
      if (etat === null) return h('div', { className: 'kbmz-page' }, '…')
      return h(Page, { etat, onRafraichir: charger, charge })
    }


    // ═══ Update available: detection + prompt (04/10) ═══════════════════════════
    // The account menu, a card at launch and the "Update" dialog share a single
    // state: `window.__kbUpdate` (null = up to date) + the `kybernos:update`
    // event. The host measures (GET /kybernos-maintenance/update: pack version
    // against the published VERSION, DSH engine like the Maintenance page); here
    // we decide WHEN to ask and HOW to notify without being intrusive:
    //   · a check ~15 s after startup, then every 6 h, and on returning to the
    //     tab if the last one is more than 6 h old;
    //   · a discreet card at launch, only once per version and per session;
    //     "Later" postpones it by 24 h, "Skip this version" silences it
    //     (unless the engine is below the minimum: then it stays);
    //   · the menu keeps the "Update available" line until it is applied —
    //     this is the reminder that never goes away.
    // Nothing installs by itself: the update goes through the lifecycle robot
    // (snapshot first, automatic rollback on failure); the dialog gives the
    // exact command to copy.
    const KB_UPD_SNOOZE = 'kybernos.update.snooze'
    const KB_UPD_SKIP = 'kybernos.update.skip'
    const KB_UPD_EVERY = 6 * 3600 * 1000
    const lsGet = (k) => { try { return window.localStorage.getItem(k) } catch (e) { return null } }
    const lsSet = (k, v) => { try { window.localStorage.setItem(k, v) } catch (e) { /* storage blocked: the card will come back */ } }
    const upd = { info: null, last: 0, busy: false, cardUp: false }

    const updLabel = (p) => (p.kind === 'kybernos' ? 'Kybernos ' : 'DSH ') + p.cible
    // The signal for the menu and the dot on the card: a SKIPPED version disappears (unless
    // it is required); a postponed version ("Later") stays flagged —
    // this is the reminder that never goes away.
    const updSignal = () => {
      const info = upd.info
      const p = info !== null && info.pending !== null && info.pending !== undefined ? info.pending : null
      const ignoree = p !== null && p.requis !== true && lsGet(KB_UPD_SKIP) === p.cible
      try { window.__kbUpdate = p === null || ignoree ? null : { kind: p.kind, cible: updLabel(p), version: p.cible, installee: p.installee, requis: p.requis === true } } catch (e) { /* outside a browser */ }
      try { window.dispatchEvent(new Event('kybernos:update')) } catch (e) { /* Event missing */ }
    }
    const updPublish = (info) => { upd.info = info; updSignal() }
    const updFetch = async (force) => {
      const r = await fetch('/kybernos-maintenance/update' + (force === true ? '?force=1' : ''), { cache: 'no-store' })
      if (r.ok !== true) throw new Error('HTTP ' + String(r.status))
      const j = await r.json()
      if (j === null || typeof j !== 'object' || j.ok !== true) throw new Error('réponse inattendue')
      return j
    }
    const updMuted = (p) => {
      if (p.requis === true) return false
      if (lsGet(KB_UPD_SKIP) === p.cible) return true
      try {
        const z = JSON.parse(lsGet(KB_UPD_SNOOZE) || 'null')
        return z !== null && z.cible === p.cible && typeof z.until === 'number' && z.until > Date.now()
      } catch (e) { return false }
    }

    const upEl = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = txt; return e }
    const upBtn = (label, cls, fn) => { const b = upEl('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b }
    const upCss = () => {
      if (document.querySelector('style[data-kybernos="kbup-css"]') !== null) return
      const st = document.createElement('style')
      st.dataset.kybernos = 'kbup-css'
      st.textContent = [
        '.kbup-card{position:fixed;left:12px;bottom:84px;z-index:2147482000;box-sizing:border-box;width:256px;padding:14px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,#26262a);color:var(--dsw-alias-label-primary);box-shadow:0 16px 40px rgba(0,0,0,.45);font-size:13px;line-height:1.45;animation:kbup-in .18s ease-out}',
        '@keyframes kbup-in{from{opacity:0;transform:translateY(8px)}}@media (prefers-reduced-motion:reduce){.kbup-card{animation:none}}',
        '.kbup-head{display:flex;align-items:center;gap:8px;font-weight:650;font-size:14px}',
        '.kbup-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#f5a524}',
        '.kbup-sub{margin:6px 0 0;color:var(--dsw-alias-label-secondary)}',
        '.kbup-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}',
        '.kbup-b{height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:550;cursor:pointer}',
        '.kbup-b:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbup-b.main{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}',
        '.kbup-b.main:hover{opacity:.9;background:var(--dsw-alias-label-primary)}',
        '.kbup-link{border:none;background:none;padding:0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
        '.kbup-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:16px}',
        '.kbup-dlg{box-sizing:border-box;width:100%;max-width:460px;max-height:calc(100vh - 32px);overflow:auto;padding:20px;border-radius:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,#26262a);color:var(--dsw-alias-label-primary);box-shadow:0 24px 64px rgba(0,0,0,.55);font-size:13.5px;line-height:1.5}',
        '.kbup-title{display:flex;align-items:center;gap:10px;margin:0;font-size:17px;font-weight:650;letter-spacing:-.01em}',
        '.kbup-ico{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbup-rows{display:flex;flex-direction:column;gap:6px;margin:14px 0 0;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.2))}',
        '.kbup-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
        '.kbup-row span:first-child{color:var(--dsw-alias-label-secondary)}',
        '.kbup-row b{font-variant-numeric:tabular-nums;font-weight:600;text-align:end}',
        '.kbup-note{margin:12px 0 0;color:var(--dsw-alias-label-secondary)}',
        '.kbup-steps{margin:14px 0 0;padding:0;list-style:none;counter-reset:s}',
        '.kbup-steps li{position:relative;margin:0 0 8px;padding-inline-start:26px;counter-increment:s}',
        '.kbup-steps li::before{content:counter(s);position:absolute;inset-inline-start:0;top:1px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);font-size:11px;font-weight:650;display:flex;align-items:center;justify-content:center}',
        '.kbup-cmd{display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 8px 7px 10px;border-radius:10px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.25));font-family:ui-monospace,Menlo,monospace;font-size:12px}',
        '.kbup-cmd code{flex:1 1 auto;min-width:0;overflow-x:auto;white-space:nowrap}',
        '.kbup-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px}',
        '.kbup-foot .grow{flex:1 1 auto}',
      ].join('')
      document.head.appendChild(st)
    }
    const updCloseCard = () => { const c = document.querySelector('.kbup-card'); if (c !== null) c.remove(); upd.cardUp = false }
    const updCopy = (txt, btn) => {
      const done = () => { const o = btn.textContent; btn.textContent = kbp('Copié ✓', 'Copied ✓'); setTimeout(() => { btn.textContent = o }, 1400) }
      try { navigator.clipboard.writeText(txt).then(done, () => { /* clipboard denied: the command stays visible */ }) } catch (e) { /* no clipboard */ }
    }

    /** The dialog: versions, what changes, the steps to follow — or "you are up to date". */
    const updDialog = (info, opts) => {
      upCss()
      updCloseCard()
      const old = document.querySelector('.kbup-scrim')
      if (old !== null) old.remove()
      const p = info !== null && info.pending !== null && info.pending !== undefined ? info.pending : null
      const prevFocus = document.activeElement
      const scrim = upEl('div', 'kbup-scrim')
      const dlg = upEl('div', 'kbup-dlg')
      dlg.setAttribute('role', 'dialog')
      dlg.setAttribute('aria-modal', 'true')
      const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); try { if (prevFocus && prevFocus.focus) prevFocus.focus() } catch (e) { /* unmounted */ } }
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
      document.addEventListener('keydown', onKey, true)
      scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close() })

      const title = upEl('h2', 'kbup-title')
      dlg.setAttribute('aria-label', p !== null ? kbp('Mise à jour disponible', 'Update available') : kbp('Vous êtes à jour', 'You are up to date'))
      const ico = upEl('span', 'kbup-ico', p !== null ? '↓' : '✓')
      ico.setAttribute('aria-hidden', 'true')
      title.appendChild(ico)
      title.appendChild(document.createTextNode(p !== null ? kbp('Mise à jour disponible', 'Update available') : kbp('Vous êtes à jour', 'You are up to date')))
      dlg.appendChild(title)

      const rows = upEl('div', 'kbup-rows')
      const row = (k, v) => { const r = upEl('div', 'kbup-row'); r.appendChild(upEl('span', null, k)); r.appendChild(upEl('b', null, v)); rows.appendChild(r) }
      if (info !== null) {
        const pk = info.pack || {}
        row('Kybernos', pk.installee === null || pk.installee === undefined ? kbp('inconnue', 'unknown')
          : (pk.disponible === true ? pk.installee + '  →  ' + pk.latest : pk.installee + (pk.joignable === true ? ' · ' + kbp('à jour', 'up to date') : ' · ' + kbp('dépôt injoignable', 'repository unreachable'))))
        const m = info.moteur || {}
        const mv = m.installee === null || m.installee === undefined || m.installee === 'inconnu' ? kbp('inconnu', 'unknown')
          : (m.cible ? m.installee + '  →  ' + m.cible : m.installee + (m.latest && m.latest !== m.installee ? ' · ' + kbp('plus récente publiée : ', 'latest published: ') + m.latest : ' · ' + kbp('à jour', 'up to date')))
        row('DSH', mv)
      }
      dlg.appendChild(rows)

      if (p !== null) {
        if (p.kind === 'moteur' && p.note) dlg.appendChild(upEl('p', 'kbup-note', hs(p.note)))
        if (p.requis === true) dlg.appendChild(upEl('p', 'kbup-note', kbp('Cette mise à jour est requise : le moteur installé est sous le minimum que ce plugin supporte.', 'This update is required: the installed engine is below the minimum this plugin supports.')))
        const steps = upEl('ol', 'kbup-steps')
        const step = (txt, cmd) => {
          const li = upEl('li'); li.appendChild(upEl('span', null, txt))
          if (cmd !== undefined) {
            const c = upEl('div', 'kbup-cmd'); c.appendChild(upEl('code', null, cmd))
            const b = upBtn(kbp('Copier', 'Copy'), 'kbup-b', () => updCopy(cmd, b)); c.appendChild(b); li.appendChild(c)
          }
          steps.appendChild(li)
        }
        const pk = info.pack || {}
        if (p.kind === 'kybernos' && pk.git !== true) {
          step(kbp('Téléchargez la dernière archive du dépôt et décompressez-la.', 'Download the latest archive of the repository and extract it.'))
          step(kbp('Dans un terminal, depuis le dossier décompressé :', 'In a terminal, from the extracted folder:'), './kybernos-update')
        } else if (p.kind === 'kybernos') {
          step(kbp('Dans le dépôt, récupérez la dernière version :', 'In the repository, fetch the latest version:'), 'git pull')
          step(kbp('Puis lancez la mise à jour :', 'Then run the update:'), 'node scripts/dsh-lifecycle.mjs upgrade')
        } else {
          step(kbp('Dans un terminal, depuis le dépôt :', 'In a terminal, from the repository:'), 'node scripts/dsh-lifecycle.mjs upgrade')
        }
        step(kbp('Redémarrez DSH si le robot le demande. Une photo est prise avant : en cas d’échec, tout revient à l’état d’avant.', 'Restart DSH if asked. A snapshot is taken first: if anything fails, everything goes back to how it was.'))
        dlg.appendChild(steps)
      } else if (info !== null && info.checkedAt) {
        let quand = ''
        try { quand = new Date(info.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { quand = '' }
        dlg.appendChild(upEl('p', 'kbup-note', kbp('Dernière vérification à ', 'Last checked at ') + quand + '.'))
      } else {
        dlg.appendChild(upEl('p', 'kbup-note', kbp('La vérification n’a pas abouti. Réessayez dans un instant.', 'The check did not complete. Try again in a moment.')))
      }

      const foot = upEl('div', 'kbup-foot')
      if (p !== null && p.requis !== true) {
        foot.appendChild(upBtn(kbp('Plus tard', 'Later'), 'kbup-b', () => { lsSet(KB_UPD_SNOOZE, JSON.stringify({ cible: p.cible, until: Date.now() + 24 * 3600 * 1000 })); close() }))
        foot.appendChild(upBtn(kbp('Ignorer cette version', 'Skip this version'), 'kbup-b', () => { lsSet(KB_UPD_SKIP, p.cible); updSignal(); close() }))
      }
      const grow = upEl('span', 'grow'); foot.appendChild(grow)
      const again = upBtn(kbp('Vérifier à nouveau', 'Check again'), 'kbup-link', () => { again.textContent = kbp('Vérification…', 'Checking…'); void updCheck(true, true) })
      foot.appendChild(again)
      if (p !== null && p.kind === 'kybernos' && info.pack && info.pack.depot) {
        const a = upEl('a', 'kbup-b main', kbp('Ouvrir la page de téléchargement', 'Open the download page'))
        a.href = info.pack.depot; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.textDecoration = 'none'; a.style.display = 'inline-flex'; a.style.alignItems = 'center'
        foot.appendChild(a)
      } else {
        foot.appendChild(upBtn(kbp('Fermer', 'Close'), 'kbup-b main', close))
      }
      dlg.appendChild(foot)
      scrim.appendChild(dlg)
      document.body.appendChild(scrim)
      try { (dlg.querySelector('.kbup-b.main') || dlg).focus() } catch (e) { /* focus */ }
      void opts
    }

    /** The launch card: discreet, once per version and per session. */
    const updCard = (info) => {
      const p = info.pending
      if (upd.cardUp === true || document.querySelector('.kbup-scrim') !== null) return
      let vue = null
      try { vue = window.sessionStorage.getItem('kybernos.update.card') } catch (e) { vue = null }
      if (vue === p.cible) return
      try { window.sessionStorage.setItem('kybernos.update.card', p.cible) } catch (e) { /* no session: at worst, the card comes back at the next check */ }
      upCss()
      upd.cardUp = true
      const card = upEl('div', 'kbup-card')
      card.setAttribute('role', 'status')
      const head = upEl('div', 'kbup-head'); head.appendChild(upEl('span', 'kbup-dot')); head.appendChild(document.createTextNode(kbp('Mise à jour disponible', 'Update available')))
      card.appendChild(head)
      card.appendChild(upEl('p', 'kbup-sub', updLabel(p) + ' — ' + kbp('vous avez ', 'you have ') + p.installee + '.'))
      const acts = upEl('div', 'kbup-actions')
      acts.appendChild(upBtn(kbp('Voir comment', 'See how'), 'kbup-b main', () => updDialog(upd.info)))
      if (p.requis !== true) acts.appendChild(upBtn(kbp('Plus tard', 'Later'), 'kbup-b', () => { lsSet(KB_UPD_SNOOZE, JSON.stringify({ cible: p.cible, until: Date.now() + 24 * 3600 * 1000 })); updCloseCard() }))
      card.appendChild(acts)
      document.body.appendChild(card)
    }

    /** One check. `manual`: the user asked for it (we always answer, even
     *  "up to date"); otherwise we stay silent unless there is news not postponed. */
    const updCheck = async (force, manual) => {
      if (upd.busy === true) return
      upd.busy = true
      let info = null
      try { info = await updFetch(force) } catch (e) { info = null }
      upd.busy = false
      upd.last = Date.now()
      if (info !== null) updPublish(info)
      if (manual === true) { updDialog(info); return }
      if (info !== null && info.pending !== null && info.pending !== undefined && updMuted(info.pending) !== true) updCard(info)
    }
    const updBoot = () => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      window.addEventListener('kybernos:menu:update', () => { if (upd.info !== null) updDialog(upd.info); else void updCheck(false, true) })
      window.addEventListener('kybernos:update:check', () => { void updCheck(true, true) })
      setTimeout(() => { void updCheck(false, false) }, 15000)
      setInterval(() => { void updCheck(false, false) }, KB_UPD_EVERY)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - upd.last > KB_UPD_EVERY) void updCheck(false, false) })
    }

    // Le contrat d'export d'une entrée cordis : les services que le contexte
    // DOIT exposer. Sans `slots`, l'entrée resterait « loading » (contrat
    // mesuré : kybernos-sessions/client.js, kybernos-theme/client.js).
    return {
      inject: ['slots'],
      apply (ctx) {
        const slots = ctx.slots
        if (slots === undefined || slots === null) {
          try { console.error('[kybernos-maintenance] service slots indisponible: pas d interface') } catch (e) { /* */ }
          return
        }
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-maintenance', order: 13, label: 'Maintenance' },
          () => h(Conteneur)))
        // Update detection: never blocks startup.
        try { updBoot() } catch (e) { try { console.warn('[kybernos-maintenance] detection des mises a jour indisponible', e) } catch (e2) { /* console */ } }
      }
    }
  }
})
