// ═══════════════════════════════════════════════════════════════════════════
// kybernos-maintenance — client. Settings page « About » (À propos).
//
// The section id stays `kybernos-maintenance` (stored state and tests depend on
// it); only the visible label changed. The page merges identity and
// maintenance, one question per block:
//   · IDENTITY   : the Kybernos wordmark (shared brand component, with a text
//                  fallback), a « Version <x> · beta » line, « Check now » ;
//   · STATUS     : one compact block — dot + state label + one-line verdict +
//                  « Copy the command » when there is something to do ;
//   · NUMBERS    : three tiles — DSH engine · Kybernos · Tested zone ;
//   · LINKS      : licence, trademark policy, modules (plain text: there is no
//                  safe in-app link to those files or to another Settings
//                  section) ;
//   · TECHNICAL DETAILS : ONE collapsed disclosure holding everything else —
//                  the four stat cards (Engine, Plugin, Compatibility, Update),
//                  the last operation, earlier updates, the update procedure,
//                  the plugin contract, the per-version compatibility matrix
//                  and the engine surfaces. Open/closed is remembered in
//                  localStorage, closed by default.
// Data: GET /kybernos-maintenance/state (host, read-only). The client invents
// nothing: levels and notes are computed host side.
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-maintenance/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    // Language: the SAME rule as kbt in the main plugin (« kybernos » + no
    // kybernos.theme.lang key + English shell => English), read through the
    // resolver it exposes. Any language other than French falls back to English,
    // like kbt.
    const kbLang = () => {
      try { if (typeof window.__KB_LANG_RESOLVE__ === 'function') return String(window.__KB_LANG_RESOLVE__()) } catch (e) { /* resolver absent */ }
      try {
        const a = window.__KB_I18N_ACTIVE__
        if (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined && String(a.lang) !== '') return String(a.lang)
      } catch (e) { /* outside a browser */ }
      return 'kybernos'
    }
    const kbEn = () => { const l = kbLang(); return l !== 'kybernos' && l.slice(0, 2).toLowerCase() !== 'fr' }
    // kbp(fr, en): a pair of labels; hs(): sentences measured by the host (in
    // French); nv(): levels.
    const kbp = (fr, en) => (kbEn() ? en : fr)
    const NIV_EN = { Parfaite: 'Perfect', Compatible: 'Compatible', Partielle: 'Partial', 'Hors zone': 'Out of range', Inconnue: 'Unknown', Aucune: 'None', Possible: 'Possible', 'Recommandée': 'Recommended', Requise: 'Required' }
    const nv = (n) => (kbEn() && NIV_EN[n] !== undefined ? NIV_EN[n] : n)
    const HS_STATIC = {
      'inconnu': 'unknown',
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
.kbmz-page{padding:0;max-width:720px;font-size:14px;line-height:normal;display:flex;flex-direction:column;gap:18px}
.kbmz-titre{margin:0;font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
[data-slot="settings.section"]:has(.kbmz-page){width:100%;max-width:none}
/* Identity: wordmark + version on the left, « Check now » on the right */
.kbmz-haut{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.kbmz-id{display:flex;flex-direction:column;gap:6px;min-width:0}
.kbmz-marque{display:flex;align-items:center;line-height:1;color:var(--dsw-alias-label-primary)}
.kbmz-version{font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.kbmz-bouton{border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.kbmz-bouton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbmz-bouton[data-primaire="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbmz-bouton:disabled{opacity:.6;cursor:default}
.kbmz-bouton:focus-visible,.kbmz-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* Status: dot + state + one-line verdict + action, border tinted by the state */
.kbmz-status{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 16px;border-radius:12px;border:1px solid var(--kbmz-ton);background:linear-gradient(0deg,var(--kbmz-tbg,transparent),var(--kbmz-tbg,transparent)),var(--dsw-alias-bg-layer-1)}
.kbmz-dot{width:10px;height:10px;border-radius:5px;flex:none;margin-top:5px;background:var(--kbmz-tdot)}
.kbmz-status-txt{display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px}
.kbmz-kicker{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--kbmz-tc)}
.kbmz-verdict{font-size:14px;line-height:1.45;color:var(--dsw-alias-label-primary)}
.kbmz-problemes{margin:4px 0 0;padding-inline-start:18px;font-size:13px;color:var(--dsw-alias-label-primary)}
.kbmz-problemes li{margin:3px 0}
.kbmz-status[data-tone="ok"]{--kbmz-ton:rgba(52,199,89,.35);--kbmz-tbg:rgba(52,199,89,.08);--kbmz-tc:#2fae52;--kbmz-tdot:#34c759}
.kbmz-status[data-tone="info"]{--kbmz-ton:rgba(59,158,255,.38);--kbmz-tbg:rgba(59,158,255,.08);--kbmz-tc:#3b9eff;--kbmz-tdot:#3b9eff}
.kbmz-status[data-tone="warn"]{--kbmz-ton:rgba(245,165,36,.4);--kbmz-tbg:rgba(245,165,36,.08);--kbmz-tc:#d98a0b;--kbmz-tdot:#f5a524}
.kbmz-status[data-tone="bad"]{--kbmz-ton:rgba(255,92,92,.4);--kbmz-tbg:rgba(255,92,92,.08);--kbmz-tc:#e5484d;--kbmz-tdot:#ff5c5c}
/* Three key numbers */
.kbmz-tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.kbmz-tuile{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.kbmz-tuile-l{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kbmz-tuile-v{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.kbmz-nw{white-space:nowrap}
/* Links row */
.kbmz-liens{display:flex;flex-wrap:wrap;gap:4px 20px;font-size:13px;color:var(--dsw-alias-label-secondary)}
/* Technical details: ONE disclosure */
.kbmz-toggle{display:flex;align-items:center;gap:10px;width:100%;padding:12px 2px;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;text-align:start;cursor:pointer}
.kbmz-toggle-h{font-weight:400;color:var(--dsw-alias-label-tertiary)}
.kbmz-toggle:hover .kbmz-toggle-h{color:var(--dsw-alias-label-secondary)}
.kbmz-chev{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .15s ease}
.kbmz-toggle[aria-expanded="true"] .kbmz-chev{transform:rotate(90deg)}
html[dir="rtl"] .kbmz-chev{transform:scaleX(-1)}
html[dir="rtl"] .kbmz-toggle[aria-expanded="true"] .kbmz-chev{transform:scaleX(-1) rotate(90deg)}
@media (prefers-reduced-motion:reduce){.kbmz-chev{transition:none}}
.kbmz-panel{display:flex;flex-direction:column;gap:16px;padding-top:6px}
.kbmz-panel[hidden]{display:none}
/* Stat cards (inside the details) */
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
/* Level badges + 4-notch bar */
.kbmz-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em}
.kbmz-badge[data-niveau="Parfaite"],.kbmz-badge[data-niveau="Aucune"],.kbmz-badge[data-niveau="réussi"]{background:rgba(52,199,89,.14);color:#2fae52}
.kbmz-badge[data-niveau="Compatible"],.kbmz-badge[data-niveau="Possible"]{background:rgba(59,158,255,.14);color:#3b9eff}
.kbmz-badge[data-niveau="Partielle"],.kbmz-badge[data-niveau="Recommandée"],.kbmz-badge[data-niveau="retour-arriere"]{background:rgba(245,165,36,.16);color:#d98a0b}
.kbmz-badge[data-niveau="Hors zone"],.kbmz-badge[data-niveau="Requise"],.kbmz-badge[data-niveau="Inconnue"],.kbmz-badge[data-niveau="echec"]{background:rgba(255,92,92,.15);color:#e5484d}
[data-kbr-theme="clair"] .kbmz-badge,.kbmz-badge{color:var(--kbmz-badge-c,var(--dsw-alias-label-primary))}
.kbmz-bar{display:inline-flex;gap:4px}
.kbmz-bar span{width:17px;height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-active)}
.kbmz-bar span[data-on="true"]{background:var(--kbmz-ton-bar,#34c759)}
/* Generic cards + journal */
.kbmz-carte{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}
.kbmz-sec{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-label-primary)}
.kbmz-sub{margin:10px 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.kbmz-ligne{display:flex;gap:12px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px;align-items:baseline}
.kbmz-ligne:first-of-type{border-top:0;padding-top:2px}
.kbmz-date{flex:none;width:120px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.kbmz-quoi{flex:none;width:64px;color:var(--dsw-alias-label-secondary)}
.kbmz-vers{flex:1;min-width:0;overflow-wrap:anywhere}
.kbmz-res{flex:none}
.kbmz-vide{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:6px 0}
.kbmz-proc{background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbmz-cmd{display:flex;align-items:center;gap:8px;margin-top:6px}
.kbmz-cmd code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-primary);flex:1;min-width:0;overflow-wrap:anywhere}
.kbmz-cmd button{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);flex:none}
.kbmz-cmd button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* Compatibility matrix */
.kbmz-mat-tete,.kbmz-mat-ligne{display:grid;grid-template-columns:150px 120px minmax(0,1fr) 150px;gap:12px;align-items:center}
.kbmz-mat-tete{padding:0 12px 6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kbmz-mat-ligne{padding:11px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);margin-top:6px;font-size:13px;background:var(--dsw-alias-bg-layer-1)}
.kbmz-mat-ligne[data-ici="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbmz-mat-v{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbmz-mat-ligne .kbmz-repere{text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kbmz-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px;font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:12px}
.kbmz-legend span{display:inline-flex;align-items:center;gap:8px}
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
      titre: 'À propos',
      moteurDsh: 'Moteur DSH',
      zoneTestee: 'Zone testée',
      licence: 'Licence Apache-2.0',
      marque: 'Politique de marque',
      modules: 'Modules : Kybernos Suite',
      details: 'Détails techniques',
      detailsAide: 'compatibilité, dernière opération, journal',
      indispo: 'État indisponible — le serveur DSH ne répond pas sur /kybernos-maintenance/state.',
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
      derniere: 'Dernière opération',
      synchro: 'Synchronisé',
      ok: 'Tout va bien — moteur et plugin synchronisés',
      avancer: 'Moteur en avance',
      detailAvancer: 'Moteur plus récent que la version testée avec ce plugin — ça fonctionne, à valider ensemble.',
      partielle: 'Compatibilité partielle',
      detailPartielle: 'Ça démarre, mais des retouches ne sont pas posées sur ce moteur : mettre à jour est recommandé.',
      action: 'Action requise',
      detailAction: 'Le moteur est hors de la zone supportée par le plugin.',
      afaire: 'À vérifier',
      detailInconnu: 'La compatibilité n’a pas pu être mesurée : la zone de compatibilité est absente du dépôt.',
      verifier: 'Vérifier maintenant',
      copierCmd: 'Copier la commande',
      copieCmd: 'Commande copiée ✓',
      contract: 'Contrat du plugin',
      majPrecedentes: 'Mises à jour précédentes',
      rien: 'Aucune mise à jour enregistrée pour l’instant.',
      procTitre: 'Pour mettre à jour (une commande, depuis un terminal)',
      procL1: 'cd <dossier du dépôt dsh-kybernos>',
      procL2: 'node scripts/dsh-lifecycle.mjs doctor     # état, ne change rien',
      procL3: 'node scripts/dsh-lifecycle.mjs upgrade    # photo + mise à jour + vérification',
      procL4: 'En cas d’échec, la machine revient toute seule à l’état d’avant.',
      copier: 'Copier',
      copie: 'Copié ✓',
      surfaces: 'Surfaces du moteur',
      natifs: 'Capacités natives livrées',
      doublons: 'Recoupements à arbitrer'
    }

    const EN = {
      titre: 'About',
      moteurDsh: 'DSH engine',
      zoneTestee: 'Tested zone',
      licence: 'License Apache-2.0',
      marque: 'Trademark policy',
      modules: 'Modules: Kybernos Suite',
      details: 'Technical details',
      detailsAide: 'compatibility, last operation, journal',
      indispo: 'Status unavailable — the DSH server did not answer on /kybernos-maintenance/state.',
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
      derniere: 'Last operation',
      synchro: 'In sync',
      ok: 'All good — engine and plugin in sync',
      avancer: 'Engine ahead',
      detailAvancer: 'Engine newer than the version tested with this plugin — it works, to be validated together.',
      partielle: 'Partial compatibility',
      detailPartielle: 'It starts, but some patches are not applied on this engine: updating is recommended.',
      action: 'Action required',
      detailAction: 'The engine is outside the range supported by the plugin.',
      afaire: 'To check',
      detailInconnu: 'Compatibility could not be measured: the compatibility range is missing from the repository.',
      verifier: 'Check now',
      copierCmd: 'Copy the command',
      copieCmd: 'Command copied ✓',
      contract: 'Plugin contract',
      majPrecedentes: 'Earlier updates',
      rien: 'No update recorded yet.',
      procTitre: 'To update (one command, from a terminal)',
      procL1: 'cd <dsh-kybernos repository folder>',
      procL2: 'node scripts/dsh-lifecycle.mjs doctor     # status, changes nothing',
      procL3: 'node scripts/dsh-lifecycle.mjs upgrade    # snapshot + update + check',
      procL4: 'If it fails, the machine rolls back to its previous state by itself.',
      copier: 'Copy',
      copie: 'Copied ✓',
      surfaces: 'Engine surfaces',
      natifs: 'Native capabilities shipped',
      doublons: 'Overlaps to arbitrate'
    }
    const t = (k) => (kbEn() ? (EN[k] ?? FR[k]) : FR[k]) ?? k

    // Scale of the levels for the 4-notch bar (increasing health).
    const ECHELLE = ['Hors zone', 'Partielle', 'Compatible', 'Parfaite']
    const TONE_PAR_NIVEAU = { Parfaite: 'ok', Compatible: 'info', Partielle: 'warn', 'Hors zone': 'bad' }

    // ── pure logic (exposed through `__test`) ──────────────────────────────

    // « 1.0.0-beta.1 » -> { core: '1.0.0', canal: 'beta', rang: '1' }; a stable
    // « 1.0.0 » has an empty canal; anything that is not a semver (a git hash,
    // « inconnu ») returns null and is shown as it is.
    const decouperVersion = (v) => {
      const m = /^(\d+\.\d+\.\d+)(?:-([A-Za-z]+)(?:[.-]?(\d+))?[0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z.-]+)?$/.exec(typeof v === 'string' ? v : '')
      return m === null ? null : { core: m[1], canal: m[2] || '', rang: m[3] || '' }
    }
    // The line under the wordmark: « Version 1.0.0 · beta 1 ». The exact string
    // stays reachable (title attribute, Kybernos tile).
    const ligneVersion = (v) => {
      const d = decouperVersion(v)
      if (d === null) return 'Version ' + hs(String(v))
      return 'Version ' + d.core + (d.canal !== '' ? ' · ' + d.canal + (d.rang !== '' ? ' ' + d.rang : '') : '')
    }
    // The version the page shows for the plugin: the shipped semver when the
    // host read one, else what the host state already had (the git hash).
    const versionPlugin = (etat) => (typeof etat.version === 'string' && etat.version !== ''
      ? etat.version
      : (typeof etat.plugin === 'string' && etat.plugin !== '' ? etat.plugin : 'inconnu'))
    const zoneTexte = (compat) => (compat !== null && compat !== undefined && compat.min !== null
      ? compat.min + (compat.max ? ' → ' + compat.max : '') : '—')

    // The status: the SAME computation as the old hero (tone: problems > level >
    // green; label: out of range > problems > level), now returned as data.
    const statutDe = (etat) => {
      const problemes = Array.isArray(etat.problemes) ? etat.problemes : []
      const niveau = etat.niveau || 'Inconnue'
      const compat = etat.compat || null
      const tone = problemes.length > 0
        ? (compat !== null && compat.horsZone ? 'bad' : 'warn')
        : (TONE_PAR_NIVEAU[niveau] || 'ok')
      let cle = 'inconnu'
      if (niveau === 'Hors zone') cle = 'action'
      else if (problemes.length > 0) cle = 'afaire'
      else if (niveau === 'Parfaite') cle = 'ok'
      else if (niveau === 'Compatible') cle = 'avancer'
      else if (niveau === 'Partielle') cle = 'partielle'
      return { tone, cle, problemes }
    }

    // What the host answered is a state only when it carries the fields the page
    // reads without a guard; a 500 answers { erreur } and must not crash the page.
    const etatValide = (j) => j !== null && typeof j === 'object' && Array.isArray(j.problemes) && typeof j.global === 'string'

    // « Technical details » open/closed, remembered per browser. Everything is
    // guarded: storage can be absent or throw (private window, blocked data).
    const CLE_DETAILS = 'kybernos.maintenance.details'
    const stockage = () => { try { return window.localStorage } catch (e) { return null } }
    const lireOuvert = (st) => { try { return st.getItem(CLE_DETAILS) === '1' } catch (e) { return false } }
    const ecrireOuvert = (st, ouvert) => { try { st.setItem(CLE_DETAILS, ouvert ? '1' : '0') } catch (e) { /* storage unavailable */ } }
    const ID_DETAILS = 'kbmz-details'

    // ── the wordmark ───────────────────────────────────────────────────────
    // It comes from the shared brand component of the main bundle
    // (window.__KB_BRAND__ = { Wordmark, Mark }, React function components
    // taking { size }). It may be absent (main bundle off, tests): plain text
    // then. A boundary keeps a component that throws from taking the page down.
    class Garde extends React.Component {
      constructor (props) { super(props); this.state = { casse: false } }
      static getDerivedStateFromError () { return { casse: true } }
      render () { return this.state.casse ? this.props.repli : this.props.children }
    }
    const marque = (taille) => {
      const repli = h('span', { style: { fontWeight: 700, fontSize: taille } }, 'Kybernos')
      try {
        const B = window.__KB_BRAND__
        if (B && B.Wordmark) return h(Garde, { repli }, h(B.Wordmark, { size: taille }))
      } catch (e) { /* brand component unreachable */ }
      return repli
    }

    function Page ({ etat, onRafraichir, charge }) {
      const resTexte = { reussi: kbp('✓ réussi', '✓ succeeded'), echec: kbp('✗ échec', '✗ failed'), 'retour-arriere': kbp('↩ retour arrière', '↩ rolled back') }
      const resCouleur = { reussi: 'reussi', echec: 'echec', 'retour-arriere': 'retour-arriere' }
      const [copie, setCopie] = React.useState(null)
      const [ouvert, setOuvert] = React.useState(() => lireOuvert(stockage()))
      const basculer = () => { const n = !ouvert; setOuvert(n); ecrireOuvert(stockage(), n) }
      const copier = (txt, cle) => {
        try {
          navigator.clipboard.writeText(txt)
            .then(() => { setCopie(cle); setTimeout(() => setCopie(null), 1600) })
            .catch(() => {})
        } catch (e) { /* clipboard unavailable */ }
      }
      const CMD = 'node scripts/dsh-lifecycle.mjs '

      // ── reading the state measured by the host ─────────────────────────────
      const compat = etat.compat || null
      const niveau = etat.niveau || 'Inconnue'
      const distant = etat.distant || { ok: false, latest: null }
      const maj = etat.maj || { niveau: 'Inconnue', cible: null, note: t('registreKo') }
      const st = statutDe(etat)
      const libelle = { ok: t('synchro'), avancer: t('avancer'), partielle: t('partielle'), action: t('action'), afaire: t('afaire'), inconnu: t('afaire') }[st.cle]
      // One-line verdict: the first problem when there is one, else the sentence of the level.
      const verdict = (st.cle === 'action' || st.cle === 'afaire')
        ? (st.problemes.length > 0 ? hs(st.problemes[0]) : t('detailAction'))
        : { ok: t('ok'), avancer: t('detailAvancer'), partielle: t('detailPartielle'), inconnu: t('detailInconnu') }[st.cle]
      const autresProblemes = st.problemes.slice(1)
      const cmdMaj = maj.niveau !== 'Aucune' && maj.niveau !== 'Inconnue' && maj.cible !== null
        ? CMD + 'upgrade' : null

      // Journal: the last operation in a banner, the earlier ones in their own card.
      const journal = etat.journal || []
      const ligneJournal = (e, i) => h('div', { className: 'kbmz-ligne', key: i },
        h('span', { className: 'kbmz-date' }, String(e.date || '').replace('T', ' ').slice(0, 16)),
        h('span', { className: 'kbmz-quoi' }, t(e.quoi)),
        h('span', { className: 'kbmz-vers' }, `${e.de} → ${e.vers}${e.raison ? ' — ' + e.raison : ''}`),
        h('span', { className: 'kbmz-res' }, h('span', { className: 'kbmz-badge', 'data-niveau': resCouleur[e.resultat] || '' }, resTexte[e.resultat] || e.resultat)))

      // Engine surfaces (audit).
      const s = etat.surfaces || null
      const natifsNatifs = (s && s.natifs) || []
      const doublonsNatifs = (s && s.doublons) || []
      const blocSurfaces = s === null ? null : h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-surfaces' },
        h('div', { className: 'kbmz-sec' }, t('surfaces')),
        h('div', { className: 'kbmz-ligne' },
          h('span', { className: 'kbmz-vers' }, s.erreur !== undefined
            ? kbp('Audit impossible : ', 'Audit failed: ') + s.erreur
            : `${s.conformes}/${s.total} ` + kbp('contrats du moteur conformes', 'engine contracts compliant') +
              (s.mesureesSurVierge > 0 ? ` (${s.mesureesSurVierge} ` + kbp('mesurés sur une sauvegarde vierge', 'measured on a clean backup') + ')' : ''))),
        natifsNatifs.length > 0 ? h('div', { className: 'kbmz-sub' }, t('natifs')) : null,
        natifsNatifs.map((n, i) => h('div', { className: 'kbmz-ligne', key: 'n' + i },
          h('span', { className: 'kbmz-date' }, n.monte ? kbp('● montée', '● mounted') : n.livre ? kbp('○ non montée', '○ not mounted') : kbp('— absente', '— absent')),
          h('span', { className: 'kbmz-vers' }, `${n.paquet} — ${hs(n.quoi)}`))),
        doublonsNatifs.length > 0 ? h('div', { className: 'kbmz-sub' }, t('doublons')) : null,
        doublonsNatifs.map((d, i) => h('div', { className: 'kbmz-ligne', key: 'd' + i },
          h('span', { className: 'kbmz-vers' }, hs(d)))))

      // ── identity block ─────────────────────────────────────────────────────
      const versionBrute = versionPlugin(etat)
      const entete = h('div', { className: 'kbmz-haut' },
        h('div', { className: 'kbmz-id' },
          h('div', { className: 'kbmz-marque', 'data-kb': 'maintenance-brand' }, marque(30)),
          h('div', { className: 'kbmz-version', 'data-kb': 'maintenance-version', title: decouperVersion(versionBrute) !== null ? versionBrute : undefined }, ligneVersion(versionBrute))),
        h('button', { type: 'button', className: 'kbmz-bouton', 'data-kb': 'maintenance-refresh', onClick: onRafraichir, disabled: charge }, charge ? '…' : t('verifier')))

      // ── status block ───────────────────────────────────────────────────────
      const statut = h('div', { className: 'kbmz-status', 'data-tone': st.tone, 'data-kb': 'maintenance-status' },
        h('span', { className: 'kbmz-dot', 'aria-hidden': 'true' }),
        h('div', { className: 'kbmz-status-txt', role: 'status' },
          h('span', { className: 'kbmz-kicker' }, libelle),
          h('span', { className: 'kbmz-verdict' }, verdict),
          autresProblemes.length > 0 ? h('ul', { className: 'kbmz-problemes' }, autresProblemes.map((p, i) => h('li', { key: i }, hs(p)))) : null),
        cmdMaj !== null
          ? h('button', { type: 'button', className: 'kbmz-bouton', 'data-primaire': 'true', 'data-kb': 'maintenance-copy-upgrade', onClick: () => copier(cmdMaj, 'maj') }, copie === 'maj' ? t('copieCmd') : t('copierCmd'))
          : null)

      // ── the three key numbers ──────────────────────────────────────────────
      const tuile = (cle, libelleTuile, valeur) => h('div', { className: 'kbmz-tuile', 'data-kb': 'maintenance-tile-' + cle },
        h('span', { className: 'kbmz-tuile-l' }, libelleTuile),
        h('span', { className: 'kbmz-tuile-v' }, valeur))
      const tuiles = h('div', { className: 'kbmz-tuiles', 'data-kb': 'maintenance-tiles' },
        tuile('engine', t('moteurDsh'), hs(etat.global)),
        tuile('kybernos', 'Kybernos', hs(versionBrute)),
        tuile('zone', t('zoneTestee'), compat !== null && compat.min !== null
          ? h(React.Fragment, null, h('span', { className: 'kbmz-nw' }, compat.min), compat.max ? ' → ' : null, compat.max ? h('span', { className: 'kbmz-nw' }, compat.max) : null)
          : zoneTexte(compat)))

      // ── links row (plain text, see the header) ─────────────────────────────
      const liens = h('div', { className: 'kbmz-liens', 'data-kb': 'maintenance-links' },
        h('span', null, t('licence')), h('span', null, t('marque')), h('span', null, t('modules')))

      // ── technical details: the four stat cards ─────────────────────────────
      const carteMoteur = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-engine-card' },
        h('span', { className: 'kbmz-stat-l' }, t('moteur')),
        h('span', { className: 'kbmz-stat-v' },
          h('code', null, hs(etat.global)),
          h('span', { className: 'kbmz-fleche', 'data-dir': etat.direction || 'same', title: distant.ok ? `latest ${distant.latest || '—'} · next ${distant.next || '—'} · alpha ${distant.alpha || '—'}` : t('registreKo') },
            etat.direction === 'up' ? '↑' : etat.direction === 'down' ? '↓' : '=')),
        h('span', { className: 'kbmz-stat-n' }, hs(distant.note) || t('registreKo')))
      const cartePlugin = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-plugin-card' },
        h('span', { className: 'kbmz-stat-l' }, t('plugin')),
        h('span', { className: 'kbmz-stat-v' }, h('code', null, hs(etat.plugin))),
        h('span', { className: 'kbmz-stat-n' }, compat && compat.min !== null
          ? `${t('zone')} : ${zoneTexte(compat)}` : kbp('zone de compatibilité absente', 'compatibility range missing')))
      const carteCompat = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-compat-card' },
        h('span', { className: 'kbmz-stat-l' }, t('compat')),
        h('span', { className: 'kbmz-stat-v' },
          h('span', { className: 'kbmz-badge', 'data-niveau': niveau }, nv(niveau)),
          h('span', { className: 'kbmz-bar', style: { '--kbmz-ton-bar': st.tone === 'bad' ? '#ff453a' : st.tone === 'warn' ? '#ff9f0a' : st.tone === 'info' ? '#3b9eff' : '#34c759' }, 'aria-hidden': 'true' }, ECHELLE.map((n) => h('span', { key: n, 'data-on': ECHELLE.indexOf(niveau) >= ECHELLE.indexOf(n) && niveau !== 'Inconnue' ? 'true' : 'false' })))),
        h('span', { className: 'kbmz-stat-n' }, etat.testee ? kbp('testée avec le plugin : ', 'tested with the plugin: ') + etat.testee : kbp('aucune version testée déclarée', 'no tested version declared')))
      const carteMaj = h('div', { className: 'kbmz-stat', 'data-kb': 'maintenance-update-card' },
        h('span', { className: 'kbmz-stat-l' }, t('maj')),
        h('span', { className: 'kbmz-stat-v' }, h('span', { className: 'kbmz-badge', 'data-niveau': maj.niveau }, nv(maj.niveau))),
        h('span', { className: 'kbmz-stat-n' }, `${hs(maj.note)}${maj.cible ? ` → ${maj.cible}` : ''}`))

      // ── technical details: contract + matrix ───────────────────────────────
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

      // ── technical details: the disclosure ──────────────────────────────────
      const bascule = h('button', { type: 'button', className: 'kbmz-toggle', 'data-kb': 'maintenance-details-toggle', 'aria-expanded': ouvert ? 'true' : 'false', 'aria-controls': ID_DETAILS, onClick: basculer },
        h('svg', { className: 'kbmz-chev', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
          h('path', { d: 'M6 3.5 10.5 8 6 12.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })),
        h('span', null, t('details')),
        h('span', { className: 'kbmz-toggle-h' }, t('detailsAide')))
      const panneau = h('div', { id: ID_DETAILS, className: 'kbmz-panel', hidden: !ouvert, 'data-kb': 'maintenance-details' },
        h('div', { className: 'kbmz-cartes' }, carteMoteur, cartePlugin, carteCompat, carteMaj),
        h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-last-op' },
          h('div', { className: 'kbmz-sec' }, t('derniere')),
          journal.length === 0 ? h('div', { className: 'kbmz-vide' }, t('rien')) : ligneJournal(journal[0], 0)),
        journal.length > 1 ? h('div', { className: 'kbmz-carte', 'data-kb': 'maintenance-journal' },
          h('div', { className: 'kbmz-sec' }, t('majPrecedentes')),
          journal.slice(1).map((e, i) => ligneJournal(e, i))) : null,
        h('div', { className: 'kbmz-carte' },
          h('div', { className: 'kbmz-sec' }, t('procTitre')),
          h('div', { className: 'kbmz-proc' },
            h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL1')),
              h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL1'), 'l1') }, copie === 'l1' ? t('copie') : t('copier'))),
            h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL2')),
              h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL2'), 'l2') }, copie === 'l2' ? t('copie') : t('copier'))),
            h('div', { className: 'kbmz-cmd' }, h('code', null, t('procL3')),
              h('button', { type: 'button', 'data-kb': 'maintenance-copy', onClick: () => copier(t('procL3'), 'l3') }, copie === 'l3' ? t('copie') : t('copier'))),
            h('div', { className: 'kbmz-ligne', style: { borderTop: '0', color: 'inherit' } }, t('procL4')))),
        contrat,
        matrice,
        blocSurfaces)

      return h('div', { className: 'kbmz-page' },
        // The help button sits IN the title row: the page's children keep the order the About tests pin.
        h('h1', { className: 'kbmz-titre', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } }, t('titre'),
          (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-maintenance' }) : null)),
        entete,
        statut,
        tuiles,
        liens,
        h('div', null, bascule, panneau))
    }

    // The container: loads the state measured by the host (read-only GET) and
    // reloads on demand. Nothing is invented client side.
    function Conteneur () {
      const [etat, setEtat] = React.useState(null)
      const [echec, setEchec] = React.useState(false)
      const [charge, setCharge] = React.useState(false)
      const charger = React.useCallback(() => {
        setCharge(true)
        try {
          fetch('/kybernos-maintenance/state')
            .then((r) => r.json())
            .then((j) => { if (etatValide(j)) { setEtat(j); setEchec(false) } else setEchec(true) })
            .catch(() => { setEchec(true) })
            .finally(() => setCharge(false))
        } catch (e) { setEchec(true); setCharge(false) }
      }, [])
      React.useEffect(() => { poserCss(); charger() }, [charger])
      if (etat === null && echec) {
        return h('div', { className: 'kbmz-page' },
          h('h1', { className: 'kbmz-titre' }, t('titre')),
          h('div', { className: 'kbmz-status', 'data-tone': 'warn', 'data-kb': 'maintenance-status' },
            h('span', { className: 'kbmz-dot', 'aria-hidden': 'true' }),
            h('div', { className: 'kbmz-status-txt', role: 'status' }, h('span', { className: 'kbmz-verdict' }, t('indispo'))),
            h('button', { type: 'button', className: 'kbmz-bouton', 'data-kb': 'maintenance-refresh', onClick: charger, disabled: charge }, charge ? '…' : t('verifier'))))
      }
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
    /** Pure. The signed release is what the Suite can actually install, so when it names a suite newer than this one it decides
     *  what is announced (and says whether this install can apply it). Anything else (no key, offline, nothing newer) leaves the
     *  host's own answer untouched. `distant` = the `distant` block of the hub's refresh answer. */
    const fusionnerSigne = (info, distant) => {
      if (info === null || typeof info !== 'object' || distant === null || typeof distant !== 'object') return info
      // Hosted (a server, a container: rebuilt, not patched in place) is known from the hub whatever the signed release says.
      const heberge = distant.hebergement !== undefined && distant.hebergement !== null && distant.hebergement.heberge === true
      const marque = (i) => (heberge === true && i.pack !== undefined && i.pack !== null && typeof i.pack === 'object' ? { ...i, pack: { ...i.pack, heberge } } : i)
      if (distant.plusRecent !== true || typeof distant.suite !== 'string') return marque(info)
      const pk = info.pack || {}
      if (typeof pk.installee !== 'string') return marque(info)
      const aj = distant.miseAJour || {}
      return {
        ...info,
        pack: { ...pk, latest: distant.suite, disponible: true, joignable: true, signe: true, applicable: aj.possible === true, raison: aj.raison || null, heberge },
        pending: { kind: 'kybernos', cible: distant.suite, installee: pk.installee, requis: false, note: '' }
      }
    }
    /** Which way this install is updated. Pure.
     *  'suite' the Suite downloads, installs and restarts from here (one click) · 'heberge' a server or container: rebuild the instance ·
     *  'archive' an unpacked archive: ./kybernos-update · 'git' a development checkout · 'moteur' the DSH engine · null nothing pending. */
    const modeMiseAJour = (info) => {
      const p = info !== null && typeof info === 'object' && info.pending !== null && info.pending !== undefined ? info.pending : null
      if (p === null) return null
      if (p.kind !== 'kybernos') return 'moteur'
      const pk = info.pack || {}
      if (pk.heberge === true) return 'heberge'
      if (pk.signe === true && pk.applicable === true) return 'suite'
      return pk.git !== true ? 'archive' : 'git'
    }
    const updFetch = async (force) => {
      const r = await fetch('/kybernos-maintenance/update' + (force === true ? '?force=1' : ''), { cache: 'no-store' })
      if (r.ok !== true) throw new Error('HTTP ' + String(r.status))
      const j = await r.json()
      if (j === null || typeof j !== 'object' || j.ok !== true) throw new Error('réponse inattendue')
      // The signed catalogue (the Suite's own check). It never blocks or breaks the host's answer.
      try {
        const s = await fetch('/kybernos-hub/catalogue/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cache: 'no-store' })
        if (s.ok === true) { const sj = await s.json(); return fusionnerSigne(j, sj !== null && typeof sj === 'object' ? sj.distant : null) }
      } catch (e) { /* the hub is optional here */ }
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

    /** The words for one step of the Suite's update, from GET /kybernos-hub/update/status. */
    const motMaj = (t) => {
      if (t === null || typeof t !== 'object') return ''
      if (t.etat === 'telechargement') return kbp('Téléchargement et vérification de l’archive…', 'Downloading and checking the archive…')
      if (t.etat === 'extraction') return kbp('Extraction…', 'Extracting…')
      if (t.etat === 'installation') return kbp('Installation (une photo est prise avant)…', 'Installing (a snapshot is taken first)…')
      if (t.etat === 'relance') return '✓ ' + kbp('Kybernos ' + String(t.version || '') + ' est installé. DSH redémarre : la page se recharge toute seule (sinon, rechargez-la).', 'Kybernos ' + String(t.version || '') + ' is installed. DSH is restarting: the page reloads by itself (if it does not, reload it).')
      if (t.etat === 'termine') return '✓ ' + kbp('Kybernos ' + String(t.version || '') + ' est installé. Redémarrez DSH pour terminer.', 'Kybernos ' + String(t.version || '') + ' is installed. Restart DSH to finish.')
      if (t.etat === 'echec') return kbp('La mise à jour a échoué, rien n’a changé : ', 'The update failed and nothing changed: ') + String(t.erreur || '')
      return ''
    }
    /** Restarts DSH through the hub, the route the Suite panel already uses (it needs the explicit confirmation sent here: the click on
     *  "Update now" says it in the dialog). True only when the hub confirms it started the restart. `appel` is fetch (a seam for the tests). */
    const updRelancer = async (appel) => {
      try {
        const x = await (appel || fetch)('/kybernos-hub/relaunch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
        const b = await x.json().catch(() => null)
        return x.status === 200 && b !== null && typeof b === 'object' && b.ok === true
      } catch (e) { return false }
    }
    /** Starts the Suite's update from the dialog (the host does the work; this only asks and follows). */
    const updRun = async (btn, statut, fin) => {
      btn.disabled = true
      statut.textContent = kbp('Démarrage…', 'Starting…')
      let r = null
      try {
        const x = await fetch('/kybernos-hub/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
        r = { code: x.status, body: await x.json().catch(() => null) }
      } catch (e) { r = null }
      if (r === null || r.code !== 202) {
        statut.textContent = kbp('La mise à jour n’a pas pu démarrer', 'The update could not start') + (r !== null && r.body !== null && r.body.error ? ' (' + String(r.body.error) + ')' : '') + '.'
        btn.disabled = false
        return
      }
      const suivre = async () => {
        let t = null
        try { const x = await fetch('/kybernos-hub/update/status', { cache: 'no-store' }); t = await x.json() } catch (e) { t = null }
        if (t === null || t.ok !== true) { setTimeout(() => { void suivre() }, 3000); return }
        statut.textContent = motMaj(t)
        if (t.etat === 'termine') {
          fin()
          try { window.__kbUpdate = null; window.dispatchEvent(new Event('kybernos:update')) } catch (e) { /* no window */ }
          // The click said "install and restart": restart now. If the hub cannot (no relaunch tool on this machine) the dialog keeps
          // saying "Restart DSH to finish", as before.
          statut.textContent = motMaj({ etat: 'relance', version: t.version })
          if (await updRelancer() !== true) statut.textContent = motMaj(t)
          return
        }
        if (t.etat === 'echec') { btn.disabled = false; return }
        setTimeout(() => { void suivre() }, 2000)
      }
      void suivre()
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

      let viaSuite = false
      let statutMaj = null
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
        const mode = modeMiseAJour(info)
        if (mode === 'heberge') {
          // A server or container deployment is rebuilt. Replacing files in a running container would be lost at the next redeploy.
          dlg.appendChild(upEl('p', 'kbup-note', kbp('Cette instance tourne sur un serveur ou dans un conteneur (Coolify, Docker…). Elle ne se met pas à jour sur place : elle se reconstruit.', 'This instance runs on a server or in a container (Coolify, Docker…). It is not updated in place: it is rebuilt.')))
          step(kbp('Redéployez ou redémarrez l’instance pour qu’elle reparte de la dernière version du Dockerfile. Si la construction réutilise son cache, forcez-la sans cache : sinon l’ancienne version est conservée.', 'Redeploy or restart the instance so that it starts from the latest version of the Dockerfile. If the build reuses its cache, force it without cache: otherwise the old version is kept.'))
          step(kbp('Gardez le volume de données attaché s’il y en a un : vos sessions et réglages y vivent. Sans volume, un redéploiement repart d’une instance vide.', 'Keep the data volume attached if there is one: your sessions and settings live in it. Without a volume, a redeploy starts from an empty instance.'))
        } else if (mode === 'suite') {
          viaSuite = true
          dlg.appendChild(upEl('p', 'kbup-note', kbp('Kybernos télécharge l’archive signée, vérifie son empreinte, prend une photo de votre installation puis installe. En cas d’échec, tout revient à l’état d’avant. Ensuite DSH redémarre tout seul ; les sessions en cours reprennent après le redémarrage.', 'Kybernos downloads the signed archive, checks its hash, snapshots your install, then installs. If anything fails, everything goes back to how it was. Then DSH restarts by itself; running sessions pick up again after the restart.')))
          statutMaj = upEl('p', 'kbup-note'); statutMaj.setAttribute('role', 'status'); statutMaj.setAttribute('data-kb', 'upd-status')
          dlg.appendChild(statutMaj)
        } else if (p.kind === 'kybernos' && pk.git !== true) {
          step(kbp('Téléchargez la dernière archive du dépôt et décompressez-la.', 'Download the latest archive of the repository and extract it.'))
          step(kbp('Dans un terminal, depuis le dossier décompressé :', 'In a terminal, from the extracted folder:'), './kybernos-update')
        } else if (p.kind === 'kybernos') {
          step(kbp('Dans le dépôt, récupérez la dernière version :', 'In the repository, fetch the latest version:'), 'git pull')
          step(kbp('Puis lancez la mise à jour :', 'Then run the update:'), 'node scripts/dsh-lifecycle.mjs upgrade')
        } else {
          step(kbp('Dans un terminal, depuis le dépôt :', 'In a terminal, from the repository:'), 'node scripts/dsh-lifecycle.mjs upgrade')
        }
        if (viaSuite !== true && mode !== 'heberge') step(kbp('Redémarrez DSH si le robot le demande. Une photo est prise avant : en cas d’échec, tout revient à l’état d’avant.', 'Restart DSH if asked. A snapshot is taken first: if anything fails, everything goes back to how it was.'))
        if (viaSuite !== true) dlg.appendChild(steps)
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
      if (viaSuite === true) {
        // Once installed the dialog has nothing left to postpone or skip: only "Close" stays.
        const fin = () => {
          foot.querySelectorAll('.kbup-b').forEach((b) => { if (b !== go) b.remove() })
          go.textContent = kbp('Fermer', 'Close'); go.disabled = false; go.removeAttribute('data-kb'); go.onclick = close
        }
        const go = upBtn(kbp('Mettre à jour maintenant', 'Update now'), 'kbup-b main', () => { void updRun(go, statutMaj, fin) })
        go.setAttribute('data-kb', 'upd-go')
        foot.appendChild(go)
      } else if (p !== null && p.kind === 'kybernos' && info.pack && info.pack.depot) {
        const a = upEl('a', 'kbup-b main', modeMiseAJour(info) === 'heberge' ? kbp('Voir cette version', 'See this release') : kbp('Ouvrir la page de téléchargement', 'Open the download page'))
        a.href = info.pack.depot + (modeMiseAJour(info) === 'heberge' && /github\.com/.test(info.pack.depot) ? '/releases/latest' : ''); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.textDecoration = 'none'; a.style.display = 'inline-flex'; a.style.alignItems = 'center'
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

    // The export contract of a cordis entry: the services the context MUST
    // expose. Without `slots`, the entry would stay « loading » (measured
    // contract: kybernos-sessions/client.js, kybernos-theme/client.js).
    return {
      inject: ['slots'],
      apply (ctx) {
        const slots = ctx.slots
        if (slots === undefined || slots === null) {
          try { console.error('[kybernos-maintenance] slots service unavailable: no interface') } catch (e) { /* */ }
          return
        }
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-maintenance', order: 13, label: kbp('À propos', 'About') },
          () => h(Conteneur)))
        // Update detection: never blocks startup.
        try { updBoot() } catch (e) { try { console.warn('[kybernos-maintenance] detection des mises a jour indisponible', e) } catch (e2) { /* console */ } }
      },
      __test: { fusionnerSigne, modeMiseAJour, updRelancer, motMaj, decouperVersion, ligneVersion, versionPlugin, zoneTexte, statutDe, etatValide, lireOuvert, ecrireOuvert, CLE_DETAILS, ID_DETAILS, Page, FR, EN }
    }
  }
})
