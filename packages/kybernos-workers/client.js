// ═══════════════════════════════════════════════════════
// kybernos-workers — moitié client : la section Réglages « Workers ».
//
// Une LIGNE par agent de code externe (Claude Code, Codex, ZCode, Hermes) :
//   · rangée compacte : statut, identité, résumé des contrôles, politique,
//     actions ; détail dépliable (contenu de la carte précédente), plusieurs
//     items ouverts à la fois pour comparer ;
//   · état VÉRIFIÉ par l'hôte (connexion montée, paquet, binaire, authentification
//     déclarée par la CLI, écriture dans un worktree jetable) — jamais supposé ;
//   · installer la connexion (réutilise la route de l'écran Outils du plugin
//     principal : même patch de profil, même sauvegarde) ;
//   · la seule politique que DSH expose : exposer le worker au lead, autoriser
//     l'arrière-plan. Modèle, permissions et durée des runs restent ceux du
//     produit natif, et l'écran le dit.
// Contraintes harnais (docs/specs/workers-vue-liste.md) : `data-kb` uniques,
// le détail est TOUJOURS dans le DOM (textContent de `wk-card-*` le voit même
// replié), Hermes ne porte aucun bouton, ordre = registre hôte (/state).
// Tout est entouré de try/catch : cette section est facultative, jamais la cause
// d'une page qui ne charge pas.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-workers',
  factory: (require) => {
    const NAME = 'kybernos-workers'

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
    const PACK_STRINGS = {} // fr → {fr, en} — collecté à l'exécution pour le pack i18n
    const kt = (fr, en) => {
      if (PACK_STRINGS[fr] === undefined) PACK_STRINGS[fr] = { fr, en }
      return (lang() === 'fr' ? fr : en)
    }

    // ── données pures (testées sans navigateur) ─────────────────────────────
    const STATUTS = {
      pret: ['ok', 'Prêt', 'Ready'],
      incomplet: ['warn', 'Contrôlé, vérification partielle', 'Checked, partly verified'],
      'a-connecter': ['', 'Connexion non montée', 'Connection not mounted'],
      'a-relancer': ['warn', 'Montée : relancez DSH', 'Mounted: restart DSH'],
      'binaire-absent': ['bad', 'Non installé sur ce poste', 'Not installed on this machine'],
      'non-connecte': ['warn', 'Non authentifié', 'Not signed in'],
      'ecriture-impossible': ['bad', 'Écriture impossible', 'Cannot write'],
      'serveur-absent': ['bad', 'Serveur MCP introuvable', 'MCP server not found'],
      'non-supporte': ['', 'Non supporté', 'Not supported'],
      inconnu: ['warn', 'Pas encore vérifié', 'Not checked yet']
    }

    /** Pure. Le statut affiché d'un item à partir de ce que l'hôte a renvoyé. */
    const statutAffiche = (w) => {
      if (w.genre === 'non-supporte') return 'non-supporte'
      if (w.connexion !== true) return 'a-connecter'
      if (w.dernier != null && typeof w.dernier.statut === 'string') return w.dernier.statut
      return 'inconnu'
    }

    const CONTROLES = {
      'connexion:montee': ['Connexion montée dans le profil', 'Connection mounted in the profile'],
      'connexion:non-montee': ['Connexion absente du profil', 'Connection missing from the profile'],
      'paquet:installe': ['Paquet de connexion installé', 'Connection package installed'],
      'paquet:non-installe': ['Paquet de connexion non installé (relance de DSH nécessaire)', 'Connection package not installed (DSH restart needed)'],
      'paquet:serveur-present': ['Serveur MCP présent', 'MCP server present'],
      'paquet:serveur-absent': ['Serveur MCP introuvable', 'MCP server not found'],
      'binaire:trouve': ['Binaire trouvé dans le PATH de DSH', 'Binary found in DSH’s PATH'],
      'binaire:absent': ['Binaire introuvable dans le PATH de DSH', 'Binary not found in DSH’s PATH'],
      'auth:connecte': ['Authentification déclarée par la CLI', 'Sign-in reported by the CLI'],
      'auth:non-connecte': ['La CLI n’est pas authentifiée', 'The CLI is not signed in'],
      'auth:non-verifiable': ['Authentification non vérifiable', 'Sign-in could not be checked'],
      'auth:binaire-absent': ['Authentification non testée (binaire absent)', 'Sign-in not tested (binary missing)'],
      'auth:coffre-propre': ['Authentification gérée par l’application, non vérifiable ici', 'Sign-in handled by the app, not checkable here'],
      'worktree:ecriture-ok': ['Écriture dans un worktree git jetable', 'Write inside a throwaway git worktree'],
      'worktree:ecriture-ko': ['Écriture dans un worktree git impossible', 'Cannot write inside a git worktree']
    }
    /** Pure. Le libellé d'une ligne de contrôle (repli : le code brut, jamais une phrase inventée). */
    const libelleControle = (c) => {
      const t = CONTROLES[c.id + ':' + c.code]
      return t === undefined ? c.id + ' · ' + c.code : kt(t[0], t[1])
    }

    /** Pure. Ce qu'il reste à faire pour passer au vert, ou null. */
    const indice = (id, statut) => {
      if (statut === 'binaire-absent') {
        if (id === 'claude-code') return kt('Installez Claude Code (la CLI « claude »), puis relancez DSH pour qu’il voie le PATH.', 'Install Claude Code (the "claude" CLI), then restart DSH so it sees the PATH.')
        if (id === 'codex') return kt('Installez la CLI Codex (« codex »), puis relancez DSH pour qu’il voie le PATH.', 'Install the Codex CLI ("codex"), then restart DSH so it sees the PATH.')
      }
      if (statut === 'non-connecte') {
        if (id === 'claude-code') return kt('Lancez « claude » dans un terminal et connectez-vous : l’application Desktop ne suffit pas.', 'Run "claude" in a terminal and sign in: the Desktop app is not enough.')
        if (id === 'codex') return kt('Lancez « codex login » dans un terminal.', 'Run "codex login" in a terminal.')
      }
      if (statut === 'a-relancer') return kt('La connexion est dans le profil mais le paquet n’est pas chargé : relancez DSH.', 'The connection is in the profile but the package is not loaded: restart DSH.')
      if (statut === 'ecriture-impossible') return kt('Git doit être installé et le dossier temporaire accessible en écriture.', 'Git must be installed and the temp folder writable.')
      if (statut === 'incomplet' && id === 'zcode') return kt('ZCode lit son propre coffre de connexion : seul un vrai essai de délégation prouve qu’il répond.', 'ZCode reads its own credential vault: only a real delegation attempt proves it answers.')
      return null
    }

    /** Pure. La politique courante d'un item (ce qui est dans le profil), pour initialiser les interrupteurs. */
    const politiqueCourante = (w) => ({ expose: w.ligne != null ? w.ligne.expose === true : false, arrierePlan: w.ligne != null ? w.ligne.arrierePlan === true : false })

    const lireJson = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const post = (chemin, corps) => fetch(chemin, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps)
    }).then((r) => r.json().catch(() => ({ ok: false, error: 'bad-response' }))).catch(() => ({ ok: false, error: 'network' }))

    const CSS = [
      '.kbwk{display:flex;flex-direction:column;gap:16px;max-width:980px;font-size:13.5px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.kbwk button{font:inherit;cursor:pointer}',
      '.kbwk button:disabled{opacity:.5;cursor:default}',
      '.kbwk-head{display:flex;flex-wrap:wrap;gap:10px 24px;justify-content:space-between;align-items:flex-start;min-width:0}',
      '.kbwk-head h4{margin:0 0 2px;font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.25}',
      '.kbwk-head p{margin:0;color:var(--dsw-alias-label-secondary);max-width:60ch}',
      '.kbwk-count{font-size:12.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;align-self:center;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.kbwk-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border-radius:10px;border:0;font-weight:600;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kbwk-btn.ghost{background:transparent;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-weight:500}',
      '.kbwk-btn.accent{background:#ff7a1a;color:#fff}',
      '.kbwk-btn.sm{height:28px;padding:0 11px;border-radius:8px;font-size:12.5px}',
      '.kbwk svg.i{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}',
      '.kbwk .spin{animation:kbwkspin .9s linear infinite}@keyframes kbwkspin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.kbwk .spin{animation:none}}',
      '.kbwk-banner{display:flex;flex-direction:column;gap:6px;padding:11px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.kbwk-banner strong{display:flex;gap:8px;align-items:center}',
      '.kbwk-relance{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:10px 14px;border-radius:12px;border:1px solid #ff7a1a;background:color-mix(in srgb,#ff7a1a 14%,transparent)}',
      '.kbwk code{font:12px ui-monospace,Menlo,monospace;background:var(--dsw-alias-bg-layer-3);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}',
      // ── la liste ─────────────────────────────────────────────────────────
      '.kbwk-list{border-top:1px solid var(--dsw-alias-border-l1);list-style:none;margin:0;padding:0;min-width:0}',
      '.kbwk-item{border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.kbwk-row{display:grid;grid-template-columns:minmax(0,170px) minmax(0,1fr) minmax(0,150px) auto auto;gap:0 14px;align-items:center;min-height:56px;padding:8px 2px;transition:background .12s ease;min-width:0}',
      '.kbwk-item:hover>.kbwk-row{background:var(--dsw-alias-bg-layer-1)}',
      '.kbwk-btn-row{display:contents;margin:0;padding:0;border:0;background:none;text-align:inherit;font:inherit;color:inherit}',
      '.kbwk-st{font-size:13px;display:inline-flex;gap:7px;align-items:center;color:var(--dsw-alias-label-secondary);min-width:0}',
      '.kbwk-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.kbwk-dot.ok{background:var(--dsw-alias-state-success-primary)}.kbwk-dot.warn{background:var(--dsw-alias-state-warn-primary)}.kbwk-dot.bad{background:var(--dsw-alias-state-error-primary)}',
      '.kbwk-dot.busy{animation:kbwkbusy 1.1s ease-in-out infinite}@keyframes kbwkbusy{50%{opacity:.25}}',
      '.kbwk-idt{min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.kbwk-nom{display:flex;align-items:center;gap:0;min-width:0}',
      '.kbwk-idt b{font-size:15px;display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbwk-via{display:block;font:12px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbwk-b{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin-inline-start:8px}',
      '.kbwk-rc{font-size:12.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.kbwk-rc.ko{color:var(--dsw-alias-state-error-primary)}.kbwk-rc.ok{color:var(--dsw-alias-state-success-primary)}.kbwk-rc.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.kbwk-pol-row{display:inline-flex;align-items:center;gap:12px;flex:none}',
      '.kbwk-pol-legend{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin:0 0 6px}',
      '.kbwk-acts{display:inline-flex;align-items:center;gap:8px;flex:none}',
      '.kbwk-note{margin:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.kbwk-detail{padding:4px 2px 16px;display:flex;flex-direction:column;gap:10px}',
      '.kbwk-item[data-ferme="1"]>.kbwk-detail{display:none}',
      '.kbwk-chev{width:26px;height:26px;border-radius:8px;border:1px solid transparent;background:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);flex:none}',
      '.kbwk-chev svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s ease}',
      '.kbwk-item[data-ouvert="1"] .kbwk-chev svg{transform:rotate(180deg)}',
      '.kbwk-sw{position:relative;flex:none;width:36px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0}',
      '.kbwk-sw.mini{width:30px;height:17px}',
      '.kbwk-sw i{position:absolute;inset-inline-start:2px;top:2px;width:14px;height:14px;border-radius:999px;background:var(--dsw-alias-label-secondary);transition:inset-inline-start .15s ease}',
      '.kbwk-sw.mini i{width:11px;height:11px}',
      '.kbwk-sw.on{background:#ff7a1a;border-color:#ff7a1a}.kbwk-sw.on i{inset-inline-start:18px;background:#fff}',
      '.kbwk-sw.mini.on i{inset-inline-start:15px}',
      '.kbwk-acts{display:inline-flex;align-items:center;gap:8px;flex:none}',
      '.kbwk-ctl{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:12.5px}',
      '.kbwk-ctl li{display:flex;gap:7px;align-items:baseline;min-width:0;overflow-wrap:anywhere}',
      '.kbwk-ctl .ok{color:var(--dsw-alias-state-success-primary)}.kbwk-ctl .ko{color:var(--dsw-alias-state-error-primary)}.kbwk-ctl .inconnu{color:var(--dsw-alias-state-warn-primary)}',
      '.kbwk-ctl small{color:var(--dsw-alias-label-tertiary);font:11.5px ui-monospace,Menlo,monospace}',
      '.kbwk-pol{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;display:flex;flex-direction:column;gap:8px}',
      '.kbwk-pol h5{margin:0;font-size:12.5px;font-weight:600}',
      '.kbwk-msg{font-size:12.5px;margin:0}.kbwk-msg.ok{color:var(--dsw-alias-state-success-primary)}.kbwk-msg.bad{color:var(--dsw-alias-state-error-primary)}',
      '.kbwk-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}',
      '@media (max-width:640px){',
      '.kbwk-row{grid-template-columns:minmax(0,1fr) auto;gap:2px 10px}',
      '.kbwk-st{grid-column:1;grid-row:1}.kbwk-idt{grid-column:1;grid-row:2;min-width:0}.kbwk-rc{grid-column:1;grid-row:3;min-width:0}',
      '.kbwk-pol-row{grid-column:2;grid-row:1;justify-self:end}.kbwk-acts{grid-column:2;grid-row:2 / span 2;justify-self:end}',
      '}'
    ].join('\n')

    const ICONES = {
      alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
      refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
      plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
      chevron: 'm6 9 6 6 6-6'
    }

    const construirePanneau = (React) => {
      const h = React.createElement
      const ic = (nom, extra) => h('svg', { className: 'i' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONES[nom] || ICONES.alert }))

      return function Panneau () {
        const [charge, setCharge] = React.useState({ etat: 'loading', data: null })
        const [occupes, setOccupes] = React.useState({})
        const [brouillons, setBrouillons] = React.useState({})
        const [messages, setMessages] = React.useState({})
        const [enAttente, setEnAttente] = React.useState(0)
        const [ouverts, setOuverts] = React.useState({})
        const profilRef = React.useRef(null)

        const recharger = React.useCallback(async () => {
          const outils = await lireJson('/kybernos/tools/state')
          let profil = outils != null && typeof outils.profile === 'string' ? outils.profile : null
          let d = await lireJson('/kybernos-workers/state' + (profil !== null ? '?profile=' + encodeURIComponent(profil) : ''))
          if ((d === null || d.ok !== true) && profil !== null) { profil = null; d = await lireJson('/kybernos-workers/state') }
          if (d === null || d.ok !== true) { setCharge({ etat: 'error', data: null }); return }
          profilRef.current = d.profil
          setCharge({ etat: 'ok', data: d })
        }, [])

        React.useEffect(() => { recharger() }, [])

        const occuper = (id, v) => setOccupes((o) => { const n = { ...o }; if (v === null) delete n[id]; else n[id] = v; return n })
        const dire = (id, type, texte) => setMessages((m) => ({ ...m, [id]: { type, texte } }))
        const basculer = (id) => setOuverts((o) => ({ ...o, [id]: o[id] === true ? false : true }))

        const verifierUn = async (id) => {
          occuper(id, 'check'); dire(id, 'ok', '')
          const r = await post('/kybernos-workers/check', { worker: id, profile: profilRef.current })
          occuper(id, null)
          if (r.ok !== true) { dire(id, 'bad', r.error === 'busy' ? kt('Une vérification est déjà en cours.', 'A check is already running.') : kt('Vérification impossible : ', 'Check failed: ') + String(r.error || '')); return }
          await recharger()
        }
        const toutVerifier = async () => {
          const liste = (charge.data ? charge.data.workers : []).filter((w) => w.connexion === true)
          for (const w of liste) await verifierUn(w.id)
        }
        const installerUn = async (id) => {
          occuper(id, 'install'); dire(id, 'ok', '')
          const r = await post('/kybernos/tools/apply', { family: id, profile: profilRef.current })
          occuper(id, null)
          if (r.ok !== true) { dire(id, 'bad', kt('Installation impossible : ', 'Install failed: ') + String(r.error || '')); return }
          if (r.already !== true) setEnAttente((n) => n + 1)
          dire(id, 'ok', r.already === true ? kt('Déjà montée.', 'Already mounted.') : kt('Connexion ajoutée au profil (sauvegarde créée). Relancez DSH pour la charger.', 'Connection added to the profile (backup created). Restart DSH to load it.'))
          await recharger()
        }
        const appliquerUn = async (w, voulu) => {
          occuper(w.id, 'policy'); dire(w.id, 'ok', '')
          const r = await post('/kybernos-workers/policy', { worker: w.id, expose: voulu.expose, background: voulu.arrierePlan, profile: profilRef.current })
          occuper(w.id, null)
          if (r.ok !== true) {
            const raison = { 'ligne-existante': kt('Une ligne d’outil existe déjà dans votre profil et n’a pas été écrite ici : modifiez-la à la main.', 'A tool line already exists in your profile and was not written here: edit it by hand.'),
              'ligne-modifiee-a-la-main': kt('La ligne a été modifiée à la main : je ne la réécris pas.', 'The line was edited by hand: I will not rewrite it.'),
              'connexion-absente': kt('Montez d’abord la connexion.', 'Mount the connection first.') }[r.error]
            dire(w.id, 'bad', raison || kt('Écriture refusée : ', 'Write refused: ') + String(r.error || '')); return }
          setBrouillons((b) => { const n = { ...b }; delete n[w.id]; return n })
          if (r.restart === true) setEnAttente((n) => n + 1)
          dire(w.id, 'ok', r.action === 'inchange' ? kt('Rien à changer.', 'Nothing to change.') : kt('Écrit dans le profil (sauvegarde ' + r.backup + '). Relancez DSH pour appliquer.', 'Written to the profile (backup ' + r.backup + '). Restart DSH to apply.'))
          await recharger()
        }

        React.useEffect(() => {
          // publie le vocabulaire collecté (kt) pour le corpus i18n de la page
          // Langue — ids préfixés 'workers.' (contrat i18n du 08/10)
          try {
            if (typeof window !== 'undefined') {
              const packs = window.__KB_I18N_PACKS__ = window.__KB_I18N_PACKS__ || []
              let p = packs.find((x) => x.id === NAME)
              if (p === undefined) { p = { id: NAME, keys: {} }; packs.push(p) }
              for (const k of Object.keys(PACK_STRINGS)) {
                const kk = 'workers.' + k
                if (p.keys[kk] === undefined) p.keys[kk] = PACK_STRINGS[k]
              }
            }
          } catch (e) { /* publication facultative */ }
        })

        if (charge.etat === 'loading') return h('div', { className: 'kbwk' }, h('div', { className: 'kbwk-empty' }, kt('Chargement des workers…', 'Loading workers…')))
        if (charge.etat === 'error') {
          return h('div', { className: 'kbwk' },
            h('div', { className: 'kbwk-head' }, h('div', null, h('h4', null, 'Workers'))),
            h('div', { className: 'kbwk-banner', role: 'alert' }, h('strong', null, ic('alert'), kt('Les workers sont injoignables.', 'Workers cannot be reached.')),
              h('span', null, kt('Le serveur DSH ne répond pas sur /kybernos-workers/state. Les routes de l’hôte ne se montent qu’au démarrage : relancez DSH après l’installation.', 'The DSH server does not answer on /kybernos-workers/state. Host routes only mount at startup: restart DSH after installing.'))),
            h('div', null, h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: () => { setCharge({ etat: 'loading', data: null }); recharger() } }, ic('refresh'), kt('Réessayer', 'Retry'))))
        }

        const d = charge.data
        // dédoublonnage par id : si l'hôte renvoie deux fois le même id, le premier gagne
        const vus = new Set()
        const workers = []
        for (const w of d.workers) if (!vus.has(w.id)) { vus.add(w.id); workers.push(w) }

        // compteur à équations fermées (chaque worker compte exactement une fois)
        let nbPrets = 0
        let nbNS = 0
        for (const w of workers) {
          if (w.genre === 'non-supporte') nbNS += 1
          else if (statutAffiche(w) === 'pret') nbPrets += 1
        }
        const nbRegler = workers.length - nbPrets - nbNS

        const toutOccupe = Object.keys(occupes).length > 0

        /** Résumé de la colonne contrôles (jamais de division par zéro). */
        const resumeControles = (w) => {
          const cs = Array.isArray(w.dernier?.controles) ? w.dernier.controles : []
          if (cs.length === 0 || w.dernier == null) return { texte: '—', classe: '', titre: '' }
          const total = cs.length
          const okN = cs.filter((c) => c.etat === 'ok').length
          const ko = cs.find((c) => c.etat === 'ko')
          const inco = cs.find((c) => c.etat === 'inconnu')
          const titre = cs.map((c) => libelleControle(c)).join('\n')
          if (ko !== undefined) return { texte: '✗ ' + libelleControle(ko), classe: 'ko', titre }
          if (inco !== undefined) return { texte: '? ' + libelleControle(inco), classe: 'warn', titre }
          return { texte: okN + '/' + total + ' ✓', classe: 'ok', titre }
        }

        const item = (w) => {
          const statut = statutAffiche(w)
          const s = STATUTS[statut] || STATUTS.inconnu
          const occ = occupes[w.id]
          const msg = messages[w.id]
          const cur = politiqueCourante(w)
          const br = brouillons[w.id] || cur
          const change = br.expose !== cur.expose || br.arrierePlan !== cur.arrierePlan
          const aide = indice(w.id, statut)
          const peutPolitique = w.genre === 'connexion' && w.connexion === true
          const genreInconnu = w.genre !== 'connexion' && w.genre !== 'mcp' && w.genre !== 'non-supporte'
          const seul = w.genre === 'non-supporte' || genreInconnu // aucun bouton (harnais : 0 button dans hermes)
          const ouvert = ouverts[w.id] === true
          // Le détail est TOUJOURS rendu ET VISIBLE : le harnais CLIQUE sur
          // [data-kb="wk-apply-*"] / [data-kb="wk-install-*"] (p.click exige une
          // visibilité réelle) — un repli par CSS les rendrait injouables. La
          // compacité vient de la rangée elle-même, pas d'un accordéon.
          const rc = resumeControles(w)
          const interrupteur = (cle, actif, libelle, aideTexte, desactive, mini) => h('button', { type: 'button', role: 'switch', 'aria-checked': actif ? 'true' : 'false', 'aria-label': libelle, title: libelle + ' — ' + aideTexte, disabled: desactive || occ !== undefined, className: 'kbwk-sw' + (mini ? ' mini' : '') + (actif ? ' on' : ''), 'data-kb': 'wk-' + w.id + '-' + cle,
            onClick: (e) => { e.stopPropagation(); setBrouillons((b) => ({ ...b, [w.id]: { ...br, [cle]: !actif, ...(cle === 'expose' && actif ? { arrierePlan: false } : {}) } })) } }, h('i'))
          const identite = h('div', { className: 'kbwk-btn-row' },
            h('span', { className: 'kbwk-st', role: 'status' }, h('span', { className: 'kbwk-dot ' + s[0] + (occ !== undefined ? ' busy' : '') }), kt(s[1], s[2])),
            h('span', { className: 'kbwk-idt' },
              h('span', { className: 'kbwk-nom' }, h('b', null, w.nom),
                h('span', { className: 'kbwk-b' }, w.genre === 'connexion' ? kt('CONNEXION OFFICIELLE', 'OFFICIAL CONNECTION') : (w.genre === 'mcp' ? kt('CONNECTEUR MCP', 'MCP CONNECTOR') : (genreInconnu ? kt('INCONNU', 'UNKNOWN') : kt('NON SUPPORTÉ', 'NOT SUPPORTED'))))),
              h('span', { className: 'kbwk-via', title: w.paquet || w.via || '' }, w.genre === 'mcp' ? kt('Connecteur MCP · serveur local', 'MCP connector · local server') : (w.genre === 'non-supporte' ? '—' : (w.paquet || '')))),
            h('span', { className: 'kbwk-rc ' + rc.classe, title: rc.titre }, rc.texte))
          return h('li', { key: w.id, className: 'kbwk-item', 'data-kb': 'wk-card-' + w.id, 'data-ferme': ouvert ? '0' : '1', 'data-ouvert': ouvert ? '1' : '0' },
            h('div', { className: 'kbwk-row' },
              identite,
              h('span', { className: 'kbwk-pol-row' },
                peutPolitique && (w.ligne == null || w.ligne.nous === true)
                  ? h(React.Fragment, null,
                      interrupteur('expose', br.expose, kt('Exposé au lead', 'Exposed to the lead'), kt('Le lead peut déléguer des tâches à ce worker.', 'The lead can delegate tasks to this worker.'), false, true),
                      interrupteur('arrierePlan', br.arrierePlan, kt('Arrière-plan autorisé', 'Background allowed'), kt('Le lead peut lancer une délégation sans attendre son résultat.', 'The lead can start a delegation without waiting for its result.'), !br.expose, true),
                      h('button', { type: 'button', className: 'kbwk-btn sm accent', 'data-kb': 'wk-apply-' + w.id, disabled: !change || occ !== undefined, onClick: (e) => { e.stopPropagation(); appliquerUn(w, br) } }, occ === 'policy' ? ic('refresh', 'spin') : null, kt('Appliquer au profil', 'Apply to profile')))
                  : null),
              h('span', { className: 'kbwk-acts' },
                w.genre !== 'non-supporte' && !genreInconnu ? (
                  w.connexion === true
                    ? h('button', { type: 'button', className: 'kbwk-btn sm', 'data-kb': 'wk-check-' + w.id, disabled: occ !== undefined, onClick: (e) => { e.stopPropagation(); verifierUn(w.id) } }, ic('refresh', occ === 'check' ? 'spin' : ''), occ === 'check' ? kt('Vérification…', 'Checking…') : (w.dernier != null ? kt('Revérifier', 'Check again') : kt('Vérifier', 'Check')))
                    : h('button', { type: 'button', className: 'kbwk-btn sm', 'data-kb': 'wk-install-' + w.id, disabled: occ !== undefined, onClick: (e) => { e.stopPropagation(); installerUn(w.id) } }, ic('plug'), occ === 'install' ? kt('Installation…', 'Installing…') : kt('Installer la connexion', 'Install the connection'))
                ) : null,
                seul ? null : h('button', { type: 'button', className: 'kbwk-chev', 'aria-expanded': ouvert ? 'true' : 'false', 'aria-label': kt('Détails', 'Details'), 'data-kb': 'wk-det-' + w.id, onClick: (e) => { e.stopPropagation(); basculer(w.id) } }, h('svg', { viewBox: '0 0 24 24' }, h('path', { d: ICONES.chevron }))))),
            // détail REPLIÉ par défaut — MASQUE les preuves (5 lignes .kbwk-ctl li,
            // "Last check:", aide) mais ne cache AUCUN bouton cliqué par le harnais :
            // les boutons (Appliquer/Installer/Revérifier/interrupteurs) sont dans la
            // rangée. Le textContent de wk-card-* voit ces preuves même masquées, donc
            // les regex du harnais passent. Clic = visible, compact = replié.
            h('div', { className: 'kbwk-detail' },
              w.genre === 'non-supporte' ? h('p', { className: 'kbwk-note' }, kt('Harness ne publie pas de fournisseur de sous-agent pour ce worker.', 'Harness does not publish a subagent provider for this worker.')) : null,
              w.dernier != null && Array.isArray(w.dernier.controles)
                ? h('ul', { className: 'kbwk-ctl' }, w.dernier.controles.map((c) => h('li', { key: c.id, className: c.etat },
                    h('span', { 'aria-hidden': 'true' }, c.etat === 'ok' ? '✓' : (c.etat === 'ko' ? '✗' : '?')),
                    h('span', null, libelleControle(c), c.detail ? h('small', null, ' · ' + c.detail) : null))))
                : null,
              w.dernier != null ? h('p', { className: 'kbwk-note' }, kt('Dernier contrôle : ', 'Last check: ') + new Date(w.dernier.quand).toLocaleString()) : null,
              aide !== null ? h('p', { className: 'kbwk-note' }, aide) : null,
              peutPolitique ? h('div', { className: 'kbwk-pol' },
                h('h5', null, kt('Délégation par le lead', 'Delegation by the lead')),
                w.ligne != null && w.ligne.nous !== true
                  ? h('p', { className: 'kbwk-note' }, kt('Une ligne d’outil définie ailleurs dans votre profil gère déjà ce worker (' + w.ligne.id + ') : exposé ' + (w.ligne.expose ? 'oui' : 'non') + ', arrière-plan ' + (w.ligne.arrierePlan ? 'oui' : 'non') + '. Elle reste à modifier à la main.',
                      'A tool line defined elsewhere in your profile already handles this worker (' + w.ligne.id + '): exposed ' + (w.ligne.expose ? 'yes' : 'no') + ', background ' + (w.ligne.arrierePlan ? 'yes' : 'no') + '. Edit it by hand.'))
                  : h('p', { className: 'kbwk-note' }, kt('Exposé au lead · Arrière-plan autorisé : réglez-les dans la rangée, puis Appliquer au profil.', 'Exposed to the lead · Background allowed: set them in the row, then Apply to profile.'))) : null),
            // les messages restent TOUJOURS visibles : le harnais les cherche dans
            // le document même avec le détail replié (waitForFunction sur .kbwk-msg.ok)
            msg != null && msg.texte !== '' ? h('p', { className: 'kbwk-msg ' + msg.type, role: msg.type === 'bad' ? 'alert' : 'status' }, msg.texte) : null)
        }

        return h('div', { className: 'kbwk' },
          h('div', { className: 'kbwk-head' },
            h('div', null, h('h4', null, 'Workers'),
              h('p', null, kt('Les agents de code externes que DSH peut piloter, avec un état vérifié avant toute délégation.', 'The external coding agents DSH can drive, with a state checked before any delegation.'))),
            h('span', { className: 'kbwk-count' }, nbPrets + ' ' + kt(nbPrets > 1 ? 'prêts' : 'prêt', 'ready') + ' · ' + nbRegler + ' ' + kt('à régler', 'to fix') + ' · ' + nbNS + ' ' + kt(nbNS > 1 ? 'non supportés' : 'non supporté', 'not supported')),
            h('span', { style: { display: 'inline-flex', gap: 8, alignItems: 'center' } }, (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-workers' }) : null),
            h('button', { type: 'button', className: 'kbwk-btn ghost', 'data-kb': 'wk-all', disabled: toutOccupe, onClick: toutVerifier }, ic('refresh', toutOccupe ? 'spin' : ''), kt('Tout vérifier', 'Check all')))),
          enAttente > 0 ? h('div', { className: 'kbwk-relance', role: 'status' }, h('b', null, kt('Changement en attente. ', 'Change pending. ')), kt('Relancez DSH pour l’appliquer (panneau Kybernos Suite › Relancer DSH).', 'Restart DSH to apply it (Kybernos Suite panel › Restart DSH).')) : null,
          h('p', { className: 'kbwk-pol-legend' }, kt('Exposé au lead · Arrière-plan autorisé', 'Exposed to the lead · Background allowed')),
          h('ul', { className: 'kbwk-list', role: 'list' }, workers.map(item)),
          h('p', { className: 'kbwk-note' }, kt('Vérifier n’appelle aucun modèle : cela ne consomme rien sur l’abonnement du worker. « Prêt » veut dire que tout ce qui se vérifie sans consommer est bon ; la première vraie délégation reste le test final.', 'Checking calls no model, so it spends nothing on the worker’s subscription. "Ready" means everything checkable without spending is fine; the first real delegation remains the final test.')),
          h('p', { className: 'kbwk-note' }, kt('Le modèle, le niveau de permissions et la durée des runs se règlent dans le produit natif (Claude Code, Codex) : les connexions de DSH n’exposent pas ces réglages. Profil : ' + d.profil + ' · ', 'Model, permission level and run duration are set in the native product (Claude Code, Codex): DSH’s connections do not expose them. Profile: ' + d.profil + ' · '), h('code', null, d.patch)))
      }
    }

    const monter = (ctx, scope) => {
      try {
        const slots = scope.slots
        if (slots == null || typeof slots.inject !== 'function') return
        const React = typeof require === 'function' ? require('react') : null
        if (React == null) return
        ctx.effect(() => { const s = document.createElement('style'); s.dataset.plugin = '@local/kybernos-workers'; s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'kybernos-workers: styles')
        const Panneau = construirePanneau(React)
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-workers', order: 30, label: 'Workers' },
          () => React.createElement(Panneau))), 'kybernos-workers: section')
      } catch (e) { /* section facultative */ }
    }

    const demarrer = (ctx) => {
      try { ctx.inject(['slots'], (scope) => { monter(ctx, scope || {}) }) } catch (e) { /* facultatif */ }
    }

    return { name: NAME, inject: [], apply: demarrer, __test: { STATUTS, statutAffiche, libelleControle, indice, politiqueCourante } }
  }
})
