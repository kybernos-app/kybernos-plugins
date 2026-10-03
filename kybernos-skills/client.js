// @local/kybernos-skills — client du parcours complet (Yours · Discover).
//
// Mécanisme unique ARB-1 : ce module s'injecte dans l'emplacement 'main.kybernos-skills'
// publié par le pivot kybernos (lot B4) — aucun export pair, aucun pont require.
//
// Contrats gelés consommés (hôte : kybernos-skills/index.js) :
//   GET  /kybernos-skills/skills            -> { ok, skills[], roots[], complete }
//   GET  /kybernos-skills/status            -> { ok, roots[{path,source,exists}] }
//   GET  /kybernos-skills/index[?view=&page=&perPage=] -> { ok, total, hasMore, skills[] }
//   GET  /kybernos-skills/search[?q=]        -> { ok, count, durationMs, skills[] }
//   GET  /kybernos-skills/curated            -> { ok, owners[{owner,skills[]}], totalSkills }
//   GET  /kybernos-skills/audit[?source=&skill=] -> { ok, audits[{provider,status,summary}] }
//   POST /kybernos-skills/toggle  {root,name,active}
//   POST /kybernos-skills/create  {root,name,description,whenToUse,body,modelInvocable}
//   POST /kybernos-skills/install {source,name,root}
//
// Rendu fidèle à docs/handoff/skills-ui/maquette.html : segment Yours/Discover, barre
// d'outils (recherche, filtres, tri, Add), rangée Featured, grille, pagination, fiche,
// modales. Les règles de style sont celles de la maquette, VERBATIM, à deux exceptions
// près : (1) elles sont confinées sous `.kbs-root`, pour qu'aucune ne puisse toucher le
// reste de la GUI ; (2) celles dont le sélecteur existe à l'identique dans le pivot
// (kb8-card, kb8-grid, kb8-tile, kb8-pill, kb8-page…) sont écartées — le pivot reste
// propriétaire de son système de design.
window.__ModuleLoader__.load({
  id: '@local/kybernos-skills',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── icônes : tracés Lucide verbatim de maquette.html:223-248 ─────────────
      const PATHS = {
        search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.34-4.34'],
        sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
        sort: ['m3 16 4 4 4-4', 'M7 20V4', 'm21 8-4-4-4 4', 'M17 4v16'],
        plus: ['M5 12h14', 'M12 5v14'],
        chev: ['m6 9 6 6 6-6'],
        chevR: ['m9 6 6 6-6 6'],
        back: ['M19 12H5', 'm12 19-7-7 7-7'],
        pkg: ['M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z', 'M12 22V12', 'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7'],
        shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
        dl: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
        up: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
        check: ['M20 6 9 17l-5-5'],
        github: ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'],
        wand: ['m15 4-1 1', 'm9 9-1 1', 'M4 20l10.5-10.5a2.1 2.1 0 0 0-3-3L1 17l3 3z', 'm14 7 3 3', 'M14.5 3.5 15 3', 'M19 9l.5-.5'],
        plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
        info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
        star: ['M11.5 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z'],
        folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 1 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
        eye: ['M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
        code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6']
      }
      const icon = (name, size) => h('svg', {
        key: 'i' + name + size,
        width: size || 16, height: size || 16, viewBox: '0 0 24 24', 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
      }, (PATHS[name] || PATHS.pkg).map((d, i) => h('path', { key: i, d })))

      // ── utilitaires de la maquette (:252-258) ────────────────────────────────
      const hue = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x }
      const tile = (name, ic, cls) => {
        const u = hue(String(name))
        // `kbs-sm` : la tuile d'une LIGNE de tableau. Meme langue visuelle que les cartes des autres
        // onglets, simplement a l'echelle d'une ligne. Sans elle, Discover ressemblait a un tableau
        // brut pose a cote du reste de l'interface.
        const taille = cls === 'lg' ? 22 : (cls === 'kbs-sm' ? 15 : 18)
        return h('span', {
          className: 'kb8-tile' + (cls ? ' ' + cls : ''),
          style: { background: 'hsl(' + u + ' 42% 17%)', color: 'hsl(' + u + ' 72% 72%)', border: '1px solid hsl(' + u + ' 40% 26%)' }
        }, icon(ic || 'pkg', taille))
      }
      // La maquette n'avait que des petits nombres : son format cassait au-dela du million
      // (« 3476k » pour 3 476 000). L'index reel depasse le million des sa premiere ligne.
      const nf = (n) => {
        const v = Number(n)
        if (Number.isFinite(v) === false) return '0'
        const court = (x, u) => x.toFixed(1).replace('.0', '').replace('.', isEn() ? '.' : ',') + u
        if (v >= 1e6) return court(v / 1e6, 'M')
        if (v >= 1e3) return court(v / 1e3, 'k')
        return String(v)
      }
      const today = (iso) => { try { return new Date(iso).toLocaleDateString(isEn() ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch (e) { return '' } }
      const STR = {
        'err.unreadable': { fr: 'réponse illisible du serveur', en: 'unreadable server response' },
        'err.noroute': { fr: 'route absente (HTTP {s})', en: 'route missing (HTTP {s})' },
        'err.unexpected': { fr: 'réponse inattendue de /kybernos-skills/{r}', en: 'unexpected response from /kybernos-skills/{r}' },
        'err.unavail': { fr: 'route /kybernos-skills/{r} indisponible', en: 'route /kybernos-skills/{r} unavailable' },
        'err.feat': { fr: 'mise en avant impossible', en: 'could not update Featured' },
        'err.index': { fr: 'index indisponible', en: 'index unavailable' },
        'err.noanswer': { fr: 'la route /kybernos-skills/ ne répond pas', en: 'the /kybernos-skills/ route is not responding' },
        'err.audit': { fr: 'audit indisponible', en: 'audit unavailable' },
        'err.reconnect': { fr: 'reconnexion impossible', en: 'reconnection failed' },
        'err.create': { fr: 'création impossible', en: 'creation failed' },
        'err.install': { fr: 'installation impossible', en: 'installation failed' },
        'notice.featOn': { fr: '« {name} » mis en avant (Featured)', en: '“{name}” added to Featured' },
        'notice.featOff': { fr: '« {name} » retiré de Featured', en: '“{name}” removed from Featured' },
        'notice.off': { fr: '« {name} » désactivé', en: '“{name}” disabled' },
        'notice.on': { fr: '« {name} » activé', en: '“{name}” enabled' },
        'notice.created': { fr: '« {name} » créé et actif', en: '“{name}” created and active' },
        'notice.installed': { fr: '« {name} » installé', en: '“{name}” installed' },
        'notice.files': { fr: ' — {n} fichiers', en: ' — {n} files' },
        'notice.reconnected': { fr: 'Index reconnecté — jeton Vercel renouvelé', en: 'Index reconnected — Vercel token renewed' },
        'copy.ok': { fr: 'Copié : {text} — colle-le dans le composeur', en: 'Copied: {text} — paste it in the composer' },
        'copy.denied': { fr: 'copie refusée par le navigateur', en: 'copy denied by the browser' },
        'copy.unavail': { fr: 'copie indisponible dans ce navigateur', en: 'copy unavailable in this browser' },
        'sort.recent': { fr: 'Récemment modifié', en: 'Recently modified' },
        'sort.recent.sub': { fr: 'date du SKILL.md sur le disque', en: 'SKILL.md date on disk' },
        'sort.name': { fr: 'Nom', en: 'Name' },
        'sort.alpha': { fr: 'ordre alphabétique', en: 'alphabetical order' },
        'sort.installs': { fr: 'Le plus installé', en: 'Most installed' },
        'sort.installs.sub': { fr: 'compteur d\'installations de l\'index', en: 'install count from the index' },
        'sort.by': { fr: 'Trier par', en: 'Sort by' },
        'sort.fallback': { fr: 'Trier', en: 'Sort' },
        'sort.desc': { fr: 'Décroissant', en: 'Descending' },
        'sort.asc': { fr: 'Croissant', en: 'Ascending' },
        'sort.noteYours': { fr: 'Le tri porte sur les skills installés dans ton profil.', en: 'Sorting applies to the skills installed in your profile.' },
        'sort.noteDisc': { fr: 'Le classement vient de l\'API officielle skills.sh — vue « {v} ».', en: 'Ranking comes from the official skills.sh API — “{v}” view.' },
        'view.alltime': { fr: 'les plus installés, depuis toujours', en: 'most installed, all time' },
        'view.trending': { fr: 'la progression récente', en: 'recent growth' },
        'view.hot': { fr: 'la dernière heure, comparée à hier', en: 'last hour, compared to yesterday' },
        'view.curated': { fr: 'le set first-party de skills.sh', en: 'the skills.sh first-party set' },
        'flt.title': { fr: 'Filtres', en: 'Filters' },
        'flt.rankrows': { fr: 'Classement et lignes', en: 'Ranking and rows' },
        'flt.reset': { fr: 'Réinitialiser', en: 'Reset' },
        'flt.view': { fr: 'Vue', en: 'View' },
        'flt.viewPrefix': { fr: 'Vue : ', en: 'View: ' },
        'flt.viewTitle': { fr: 'Vue et nombre de lignes', en: 'View and row count' },
        'flt.rows': { fr: 'Lignes', en: 'Rows' },
        'flt.state': { fr: 'État', en: 'State' },
        'flt.all': { fr: 'Tous', en: 'All' },
        'flt.allf': { fr: 'Toutes', en: 'All' },
        'flt.active': { fr: 'Actifs ({n})', en: 'Active ({n})' },
        'flt.disabled': { fr: 'Désactivés ({n})', en: 'Disabled ({n})' },
        'f.root': { fr: 'Racine', en: 'Root' },
        'src.search': { fr: '{n} résultats affichés sur {total} — API skills.sh, {ms}', en: '{n} results shown of {total} — skills.sh API, {ms}' },
        'src.unknownDur': { fr: 'durée inconnue', en: 'unknown duration' },
        'src.curated': { fr: '{n} skills first-party répartis sur {o} propriétaires — généré le {d}', en: '{n} first-party skills across {o} owners — generated {d}' },
        'src.index': { fr: '{n} skills classés — API officielle skills.sh, vue « {v} »', en: '{n} skills ranked — official skills.sh API, “{v}” view' },
        'add.create': { fr: 'Créer un skill', en: 'Create a skill' },
        'add.install': { fr: 'Installer un skill', en: 'Install a skill' },
        'add.github': { fr: 'Importer depuis GitHub', en: 'Import from GitHub' },
        'add.search': { fr: 'Chercher dans l\'index', en: 'Search the index' },
        'add.manual': { fr: 'Installer à la main (owner/repo)', en: 'Install manually (owner/repo)' },
        'add.top': { fr: 'Voir les plus installés', en: 'See the most installed' },
        'ph.yours': { fr: 'Rechercher un skill…', en: 'Search skills…' },
        'ph.discover': { fr: 'Chercher dans 9 827 skills (nom et description)…', en: 'Search 9,827 skills (name and description)…' },
        'card.disable': { fr: 'Désactiver', en: 'Disable' },
        'card.enable': { fr: 'Activer', en: 'Enable' },
        'card.readonly': { fr: 'lecture seule', en: 'read-only' },
        'feat.remove': { fr: 'Retirer de Featured', en: 'Remove from Featured' },
        'feat.add': { fr: 'Mettre en avant (Featured)', en: 'Add to Featured' },
        'card.nodesc': { fr: '— sans description —', en: '— no description —' },
        'card.active': { fr: 'actif', en: 'active' },
        'card.disabled': { fr: 'désactivé', en: 'disabled' },
        'card.dup': { fr: 'doublon', en: 'duplicate' },
        'card.noedit': { fr: 'non modifiable', en: 'not editable' },
        'mod.on': { fr: 'Modifié le {d}', en: 'Modified {d}' },
        'mod.on.lc': { fr: 'modifié le {d}', en: 'modified {d}' },
        'mod.unknown': { fr: 'date inconnue', en: 'unknown date' },
        'card.copyTitle': { fr: 'Copier l\'invocation à coller dans le composeur', en: 'Copy the invocation to paste in the composer' },
        'cover.alt': { fr: 'Illustration de {name}', en: 'Illustration for {name}' },
        'feat.localskill': { fr: 'skill local', en: 'local skill' },
        'row.installed': { fr: 'installé', en: 'installed' },
        'row.offgh': { fr: 'hors GitHub', en: 'off GitHub' },
        'row.community': { fr: 'communauté', en: 'community' },
        'row.already': { fr: 'déjà installé', en: 'already installed' },
        'row.cantInstall': { fr: 'installation impossible', en: 'cannot install' },
        'row.cantInstall.wk': { fr: 'Contenu hébergé hors GitHub', en: 'Content hosted outside GitHub' },
        'row.cantInstall.ng': { fr: 'Source non GitHub', en: 'Non-GitHub source' },
        'pg.prev': { fr: 'Précédent', en: 'Previous' },
        'pg.next': { fr: 'Suivant', en: 'Next' },
        'pg.page': { fr: 'page {p} / {n}', en: 'page {p} / {n}' },
        'pg.rows': { fr: 'lignes {a}–{b} sur {n}', en: 'rows {a}–{b} of {n}' },
        'pg.more': { fr: 'Charger plus', en: 'Load more' },
        'pg.of': { fr: '{a} sur {n}', en: '{a} of {n}' },
        'y.loading': { fr: 'Chargement…', en: 'Loading…' },
        'y.loadfail': { fr: 'Impossible de charger les skills', en: 'Could not load skills' },
        'y.retry': { fr: 'Réessayer', en: 'Retry' },
        'y.none': { fr: 'Aucun skill installé', en: 'No skills installed' },
        'y.nonehint': { fr: 'Crée-en un, ou importe-en un depuis GitHub.', en: 'Create one, or import one from GitHub.' },
        'y.noresult': { fr: 'Aucun résultat', en: 'No results' },
        'y.nofilter': { fr: 'Change de filtre ou de terme.', en: 'Change the filter or search term.' },
        'd.query': { fr: 'Interrogation de l\'index…', en: 'Querying the index…' },
        'd.down': { fr: 'Index indisponible', en: 'Index unavailable' },
        'd.oidc': { fr: 'L\'index passe par l\'API officielle skills.sh, qui exige un jeton Vercel OIDC — il vit environ 12 h.', en: 'The index uses the official skills.sh API, which requires a Vercel OIDC token — it lasts about 12 h.' },
        'd.reconnect': { fr: 'Reconnecter l\'index', en: 'Reconnect the index' },
        'd.direct': { fr: 'L\'installation directe reste possible par « Importer depuis GitHub ».', en: 'Direct install is still possible via “Import from GitHub”.' },
        'feat.sub': { fr: 'mis en avant — liste tenue à l\'étoile, dans l\'ordre du fichier', en: 'featured — list kept by star, in file order' },
        'th.result': { fr: 'RÉSULTAT', en: 'RESULT' },
        'th.state': { fr: 'ÉTAT', en: 'STATE' },
        'd.empty.search': { fr: 'Essaie un autre terme (au moins 2 caractères).', en: 'Try another term (at least 2 characters).' },
        'd.empty.page': { fr: 'Cette page est vide.', en: 'This page is empty.' },
        'det.by': { fr: 'par {s} · {n} installations', en: 'by {s} · {n} installs' },
        'btn.install': { fr: 'Installer', en: 'Install' },
        'det.provenance': { fr: 'Provenance', en: 'Provenance' },
        'det.unknownSrc': { fr: 'source inconnue', en: 'unknown source' },
        'det.what': { fr: 'Ce que fait l\'installation', en: 'What installing does' },
        'det.whatBody': { fr: 'L\'archive du dépôt est téléchargée, le dossier du skill est trouvé par son frontmatter, puis COPIÉ dans la racine choisie. Aucun lien symbolique : le registre de DSH ignore les liens, un skill lié serait installé sans jamais apparaître.', en: 'The repo archive is downloaded, the skill folder is found through its frontmatter, then COPIED into the chosen root. No symlinks: the DSH registry ignores links, so a linked skill would be installed without ever showing up.' },
        'det.rootph': { fr: '<racine>', en: '<root>' },
        'det.checks': { fr: 'Vérification', en: 'Checks' },
        'det.declared': { fr: 'Installations déclarées par l\'index', en: 'Installs reported by the index' },
        'det.frontmatter': { fr: 'Frontmatter relu avant copie : name et description obligatoires', en: 'Frontmatter re-read before copying: name and description required' },
        'det.target': { fr: 'Cible : {p}', en: 'Target: {p}' },
        'det.audits': { fr: 'Audits de sécurité — skills.sh', en: 'Security audits — skills.sh' },
        'det.auditLoading': { fr: 'chargement des audits…', en: 'loading audits…' },
        'det.auditNone': { fr: 'aucun audit publié pour ce skill', en: 'no audit published for this skill' },
        'det.audited': { fr: 'audité', en: 'audited' },
        'det.unknown': { fr: 'inconnu', en: 'unknown' },
        'det.thirdParty': { fr: 'Le contenu vient d\'un dépôt tiers : DSH ne l\'audite pas ; ces verdicts sont ceux publiés par skills.sh.', en: 'The content comes from a third-party repo: DSH does not audit it; these verdicts are the ones published by skills.sh.' },
        'cap.detail': { fr: 'fiche du skill', en: 'skill details' },
        'cap.yours': { fr: 'installés dans ce profil · {a} actifs sur {n}', en: 'installed in this profile · {a} of {n} active' },
        'cap.search': { fr: 'index skills.sh · recherche sur nom et description', en: 'skills.sh index · search by name and description' },
        'cap.rank': { fr: 'index skills.sh · classement par installations', en: 'skills.sh index · ranked by installs' },
        'm.defroot': { fr: 'racine par défaut de l\'hôte', en: 'host default root' },
        'm.willCreate': { fr: '(sera créée)', en: '(will be created)' },
        'm.createSub': { fr: 'Le fichier est la seule source : un dossier et un SKILL.md valide, découverts au prochain rafraîchissement.', en: 'The file is the only source: a folder and a valid SKILL.md, picked up at the next refresh.' },
        'm.name': { fr: 'Nom (minuscules, chiffres, tirets)', en: 'Name (lowercase, digits, hyphens)' },
        'm.nameph': { fr: 'mon-skill', en: 'my-skill' },
        'm.desc': { fr: 'Description — dit à l\'agent QUAND charger ce skill', en: 'Description — tells the agent WHEN to load this skill' },
        'm.when': { fr: 'Quand l\'utiliser (optionnel)', en: 'When to use it (optional)' },
        'm.content': { fr: 'Contenu (optionnel)', en: 'Content (optional)' },
        'm.contentph': { fr: '# Étapes\n\n1. …', en: '# Steps\n\n1. …' },
        'm.quiet': { fr: 'Ne pas l\'annoncer au modèle : il reste invocable par « /{n} », mais ne coûte aucun jeton tant qu\'il n\'est pas chargé.', en: 'Do not announce it to the model: it stays invocable via “/{n}”, but costs no tokens until loaded.' },
        'm.nameWord': { fr: 'nom', en: 'name' },
        'm.cancel': { fr: 'Annuler', en: 'Cancel' },
        'm.creating': { fr: 'Création…', en: 'Creating…' },
        'm.createBtn': { fr: 'Créer le skill', en: 'Create skill' },
        'm.importTitle': { fr: 'Importer un skill depuis GitHub', en: 'Import a skill from GitHub' },
        'm.importSub': { fr: 'Le dépôt public est téléchargé, le dossier du skill est trouvé par son frontmatter, puis copié — jamais lié.', en: 'The public repo is downloaded, the skill folder is found through its frontmatter, then copied — never linked.' },
        'm.repo': { fr: 'Dépôt (owner/repo)', en: 'Repository (owner/repo)' },
        'm.examples': { fr: 'exemples : anthropics/skills · microsoft/playwright-cli · vercel-labs/skills', en: 'examples: anthropics/skills · microsoft/playwright-cli · vercel-labs/skills' },
        'm.skillInRepo': { fr: 'Nom du skill dans ce dépôt', en: 'Skill name in this repo' },
        'm.destRoot': { fr: 'Racine de destination', en: 'Destination root' },
        'm.downloading': { fr: 'Téléchargement…', en: 'Downloading…' },
      }
      // Langue : même mécanisme que kybernos-composio (kbt). Service `locale` de l'hôte ; « kybernos »
      // est le défaut du thème : sans choix explicite (kybernos.theme.lang absent) et sous un shell
      // anglais, on sert l'anglais. Sans service : repli localStorage puis <html lang>.
      let localeSvc = null
      const tlang = () => {
        if (localeSvc === null || localeSvc === undefined) {
          try { const st = localStorage.getItem('kybernos.theme.lang'); if (st === 'en' || st === 'fr') return st } catch (e) { }
          try { if (String(document.documentElement.lang || '').slice(0, 2).toLowerCase() === 'en') return 'en' } catch (e) { }
          return 'fr'
        }
        let lang = 'kybernos'
        try { if (typeof localeSvc.current === 'function') lang = String(localeSvc.current() || '') } catch (e) { }
        if (lang === 'kybernos') {
          try {
            if (localStorage.getItem('kybernos.theme.lang') === null && typeof localeSvc.getLocale === 'function') {
              const snap = localeSvc.getLocale()
              if (snap !== null && snap !== undefined && String(snap.active) === 'en') lang = 'en'
            }
          } catch (e) { /* storage ou service indisponible : défaut */ }
        }
        return lang
      }
      const isEn = () => tlang().slice(0, 2).toLowerCase() === 'en'
      const t = (key, vars) => {
        const row = STR[key]
        if (row === null || row === undefined) return key
        const lang = tlang()
        let out = row.fr
        if (lang !== 'kybernos' && lang !== 'fr') {
          const tag = lang.slice(0, 2).toLowerCase()
          if (row[tag] !== null && row[tag] !== undefined) out = row[tag]
        }
        if (vars === null || vars === undefined) return out
        return out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))
      }
      const PAGE = 6

      const CSS = `
.kbs-root{display:flex;flex-direction:column;flex:1;min-height:0}
/* Troisieme exception a la maquette (cf. en-tete) : le bandeau Yours/Discover
   etait dessine en plein cadre, avec ses propres cotes (22 px) et sa propre
   echelle (carres 46, bouton principal 43, recherche du pivot 52). La page est
   deja mise en page par .kbg-root (30/34 px) et ses onglets sont des .kb4-tab
   de 28 px : on s'aligne sur eux — meme colonne, meme pilule, meme echelle. */
.kbs-root{gap:16px}
.kbs-root .kbs-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:0 0 auto}
.kbs-root .kbs-top-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.kbs-root .kbs-h1{margin:0;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbs-root .kbs-sub{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:720px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbs-root .kbs-ctlrow{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;min-height:44px;position:relative}
.kbs-root .kbs-ctlrow .kb-toolbar{margin:0;flex:1 1 0;min-width:0;justify-content:flex-end}
.kbs-root .kbs-ctlrow .kb8-search{flex:0 1 260px}
.kbs-root .kbsub{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:0;box-sizing:content-box;background:transparent;border:none}
/* Capsule de sous-onglets identique à .kb7-subtabs (Connections) : conteneur discret, actif en carte surélevée. */
.kbs-root .kbsub-group{display:inline-flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kbsub button.kb-seg{display:inline-flex;align-items:center;gap:8px;height:34px;border:0;border-radius:999px;padding:0 16px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.kbs-root .kbsub button.kb-seg:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kbsub button.kb-seg.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kbs-root .kbsub .count{font-family:ui-monospace,monospace;font-size:11px;color:inherit;opacity:.7}
.kbs-root .kbsub .kb8-mono{flex:1 1 0;min-width:0;text-align:end;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Le corps du panneau est injecte DANS .kbg-root, qui porte deja les marges de
   la page (30/34/40). Il reprenait celles de .kb8-page (30/28/36) : tout le
   contenu etait decale de 28 px par rapport au titre et aux onglets, et la
   colonne utile perdait 56 px. On annule ces marges interieures — la colonne
   du plugin rejoint alors celle de la page.
   Le meme selecteur rend aussi .kb8-page NON defilant, et c'est volontaire.
   Mesure du 21/09/2026, onglet Ressources > Skills, fenetre 1400x950 : le
   panneau est borne par .kbg-root (950 px pour 2816 px de contenu), mais
   .kbs-root s'intercale entre les deux SANS contraindre la hauteur (son
   flex:1/min-height:0 suppose un parent flex, or .kbg-root est un bloc). Le
   max-height:100% de .kb8-page se resout alors contre .kbs-root, haut de tout
   le contenu : .kb8-page fait 2633 px pour 2633 px, il ne deborde jamais tout
   en restant un conteneur defilant (overflow-y:auto). Combine a
   l'overscroll-behavior:contain que le pivot posait alors sur .kb8-page, la
   molette etait consommee la et ne remontait jamais a .kbg-root : le panneau ne
   defilait plus du tout (0 px sur 4 crans de molette, alors que l'onglet
   Composio voisin, qui n'a pas de .kb8-page interpose, defilait de 600 px). On
   rend la main au seul vrai defileur, .kbg-root : geste restaure, rendu
   inchange.
   Depuis, le pivot ne pose plus contain sur les corps de page (contrat de
   defilement dans kybernos-plugin/client.js) : le geste passerait donc meme
   sans cette regle. Elle reste, pour deux raisons : supprimer un conteneur
   defilant qui ne sert a rien, et rendre l'intention explicite la ou un futur
   panneau s'intercalera entre une page et son hote. */
.kbs-root .kb8-page{padding:0;overflow:visible;max-height:none}
.kbs-root .kb8-h2{margin:0;font-size:16px;font-weight:600}
.kbs-root .kb8-mono{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kbs-root .kb-row.end{justify-content:flex-end}
.kbs-root .kb-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.kbs-root .kb8-search{flex:1 1 220px;min-width:0;height:38px;box-sizing:border-box;border-radius:11px;padding:0 12px}
.kbs-root .kb8-search input{font-size:13px}
.kbs-root .kb8-search svg{color:var(--dsw-alias-label-caption);flex:0 0 auto}
.kbs-root .kb-tool{width:38px;height:38px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.kbs-root .kb-tool:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-tool.on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
/* Controles LIBELLES : meme facture que .kb6-tb-filterbtn du pivot (38 px, rayon 11, bordure
   l1, fond layer-1). L'etat — filtre actif, tri courant, vue courante — se lit sur le bouton
   au lieu d'etre cache derriere une icone nue, comme dans le reste de la GUI. */
.kbs-root .kb-tool-lab{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto}
.kbs-root .kb-tool-lab:hover,.kbs-root .kb-tool-lab.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-tool-lab .n{min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.kbs-root .kb8-ghost{display:inline-flex;align-items:center;gap:8px;height:38px;background:transparent;color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:0 15px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbs-root .kb8-primary{height:38px;padding:0 14px;font-size:13px;border-radius:11px}
.kbs-root .kb8-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Le panneau de filtres suivait la maquette en CARTE EN LIGNE : ouverte, elle poussait la
   liste de 145 px vers le bas et ne se refermait que par son propre bouton. Le pivot met ses
   filtres dans un popover ancre au bouton (.kb6-tb-pop) : on suit la meme convention, en
   gardant les trois rangees de la maquette (Vue, Lignes, Source / Etat, Racine). */
.kbs-root .kb-filters{position:absolute;right:0;top:calc(100% + 6px);z-index:60;display:flex;flex-direction:column;gap:10px;width:min(560px,calc(100vw - 56px));box-sizing:border-box;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-filters .head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 4px}
.kbs-root .kb-filters .head .t{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-filters .head .raz{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:3px 6px;border-radius:7px}
.kbs-root .kb-filters .head .raz:hover{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kb-filter-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.kbs-root .kb-filter-row .lbl{font-size:12px;color:var(--dsw-alias-label-caption);min-width:74px}
.kbs-root .kb8-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Tableau du classement : une ligne par skill, pas une carte. C'est ce qui rend un index de
   9 827 lignes parcourable — cinquante lignes a l'ecran, et un pager fixe au lieu d'un
   « Charger plus » enfoui sous 3 380 px de cartes. */
/* Memes jetons que .kb8-card du pivot : bg-layer-1, border-l1, rayon 16 — le tableau doit se
   lire comme les autres onglets, pas comme un tableau brut pose a cote d'eux. */
.kbs-root .kbs-table{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbs-head,.kbs-root .kbs-row{display:grid;grid-template-columns:44px minmax(200px,1.6fr) minmax(130px,1fr) 150px 100px;align-items:center;gap:14px;padding:8px 18px}
.kbs-root .kbs-head{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbs-row{border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;transition:background .12s}
.kbs-root .kbs-row:last-child{border-bottom:none}
.kbs-root .kbs-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbs-row.has{box-shadow:inset 2px 0 0 var(--dsw-alias-state-success-primary)}
.kbs-root .kbs-row .rank{font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-caption);text-align:right}
.kbs-root .kbs-row .who{display:flex;align-items:center;gap:11px;min-width:0}
.kbs-root .kbs-row .who .kb8-name{font-size:14px}
.kbs-root .kbs-row .src{overflow:hidden;text-overflow:ellipsis}
.kbs-root .kbs-row .badges{display:flex;gap:6px;flex-wrap:wrap}
.kbs-root .kbs-row .inst{font-family:ui-monospace,monospace;font-size:12.5px;color:var(--dsw-alias-label-secondary);text-align:right}
/* Tuile de LIGNE : echelle d'une ligne, meme facture que .kb8-tile (38px / rayon 13). */
.kbs-root .kb8-tile.kbs-sm{width:30px;height:30px;border-radius:10px}
/* Une ligne mesure ~48 px : cinquante tiennent dans l'ecran d'un onglet. */
/* Une requete en vol se voit, sans faire disparaitre la page precedente. */
.kbs-root .kbs-table.loading{opacity:.55}
/* Pager : page courante, total de pages, et sauts. Plus de bouton en bas d'une liste qui grandit. */
.kbs-root .kbs-pager{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0 2px;flex-wrap:wrap}
.kbs-root .kbs-pager .pg{min-width:38px;height:38px;padding:0 9px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,monospace;font-size:12.5px;cursor:pointer}
.kbs-root .kbs-pager .pg:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbs-pager .pg.on{background:var(--kb-switch-on,#4d7cfe);border-color:transparent;color:#fff;font-weight:600}
.kbs-root .kbs-pager .t{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-pager.haut{padding:0 0 10px}
/* Bandeau d'audit : la donnee qui remplace « communaute, non audite ». */
.kbs-root .kbs-audit{display:flex;flex-direction:column;gap:9px}
.kbs-root .kbs-audit .ligne{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-star-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;letter-spacing:.03em; padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent);color:#f7c46c}
.kbs-root .kb8-card.static{cursor:default}
.kbs-root .kb8-card.static:hover{transform:none;border-color:var(--dsw-alias-border-l1)}
.kbs-root .kb8-card .desc{font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:60px}
.kbs-root .kb8-card .foot{display:flex;align-items:center;gap:11px;font-size:12px;color:var(--dsw-alias-label-caption);border-top:1px solid var(--dsw-alias-border-l1);padding-top:11px}
.kbs-root .kb8-card .foot .grow{flex:1}
.kbs-root .kb8-tile.lg{width:54px;height:54px;border-radius:17px}
.kbs-root .kb8-pill.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.kbs-root .kb8-pill.warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.kbs-root .kb8-pill.info{color:#9dbaff;background:color-mix(in srgb,var(--kb-switch-on,#4d7cfe) 20%,transparent)}
.kbs-root .kb-pager{display:flex;align-items:center;justify-content:center;gap:16px;padding:6px 0 2px}
.kbs-root .kb-pager .t{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sw{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;border:none;flex:0 0 auto;transition:background .15s}
.kbs-root .kb-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;display:block}
.kbs-root .kb-sw.on{background:var(--kb-switch-on,#4d7cfe)}
.kbs-root .kb-sw.on i{transform:translateX(16px)}
.kbs-root .kb-back{display:inline-flex;align-items:center;gap:8px;background:none;border:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13.5px;cursor:pointer;padding:0;width:fit-content}
.kbs-root .kb-back:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kb-detail-head{display:flex;align-items:center;gap:16px}
.kbs-root .kb-detail-head .meta{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.kbs-root .kb-badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--kb-switch-on,#4d7cfe) 22%,transparent);color:#9dbaff;border:1px solid color-mix(in srgb,var(--kb-switch-on,#4d7cfe) 40%,transparent)}
.kbs-root .kb-cols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:26px;align-items:start}
.kbs-root .kb-panel{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.kbs-root .kb-panel .row{display:flex;align-items:center;gap:12px;font-size:13.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-panel .row .ic{width:30px;height:30px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.kbs-root .kb-section-label{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbs-root .kb8-tab:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kb8-tab .n{font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-contents{display:grid;grid-template-columns:290px minmax(0,1fr);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);min-height:420px}
.kbs-root .kb-tree{border-right:1px solid var(--dsw-alias-border-l1);padding:12px 8px;overflow:auto}
.kbs-root .kb-node{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.kbs-root .kb-node:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kb-node.on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-node.dir{color:var(--dsw-alias-label-tertiary)}
.kbs-root .kb-node .nm{overflow:hidden;text-overflow:ellipsis}
.kbs-root .kb-node .caret{width:12px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-preview{display:flex;flex-direction:column;min-width:0}
.kbs-root .kb-preview-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kb-preview-head .path{font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kb-preview-body{padding:22px 26px;overflow:auto;font-size:14px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-preview-body h1{font-size:23px;margin:0 0 14px;color:var(--dsw-alias-label-primary)}
.kbs-root .kb-preview-body h2{font-size:16px;margin:24px 0 10px;color:var(--dsw-alias-label-primary)}
.kbs-root .kb-preview-body p{margin:0 0 12px}
.kbs-root .kb-preview-body code{font-family:ui-monospace,monospace;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);padding:2px 6px;border-radius:6px;color:var(--dsw-alias-label-primary)}
.kbs-root .kb-preview-body pre{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;overflow:auto;font-size:12.5px}
.kbs-root .kb-preview-body ul{margin:0 0 12px;padding-left:20px}
.kbs-root .kb-preview-body li{margin:5px 0}
.kbs-root .kb-menu-wrap{position:relative;display:inline-flex}
/* Les trois popovers du panneau (Créer, Trier, Filtres) reprennent les jetons exacts de
   .kb6-tb-pop du pivot : bordure l1, rayon 13, ombre 0 14px 34px .3. Ils flottaient plus
   haut et plus sombres que ceux du reste de la GUI. */
.kbs-root .kb-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:320px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-menu button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border:none;background:transparent;border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.kbs-root .kb-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kb-menu button svg{color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.kbs-root .kb-sortmenu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:290px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-sort-head{display:flex;align-items:center;padding:9px 12px 7px}
.kbs-root .kb-sort-head .lbl{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1}
.kbs-root .kb-dir{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:7px}
.kbs-root .kb-dir:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-sort-opt{display:flex;align-items:flex-start;gap:9px;width:100%;padding:9px 11px;border:none;background:transparent;border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.kbs-root .kb-sort-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kb-sort-opt .tk{width:14px;color:var(--dsw-alias-label-primary);opacity:0;flex:0 0 auto;margin-top:2px}
.kbs-root .kb-sort-opt.on .tk{opacity:1}
.kbs-root .kb-sort-opt .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbs-root .kb-sort-opt .sub{font-size:11.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sort-note{display:flex;gap:8px;padding:9px 11px 6px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px; font-size:11px;line-height:1.45;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sort-note svg{flex:0 0 auto;margin-top:1px}
.kbs-root .kb-overlay{position:fixed;inset:0;background:#00000080;display:flex;align-items:center;justify-content:center;z-index:100;padding:24px}
.kbs-root .kb-modal{width:580px;max-width:96vw;max-height:88vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:16px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.kbs-root .kb-drop{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:36px 20px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:center}
.kbs-root .kb-drop:hover{border-color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kb-req{font-size:13.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.kbs-root .kb-req ul{margin:8px 0 0;padding-left:18px}
.kbs-root .kb-req li{margin:6px 0}
.kbs-root .kb-note{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:56px 24px;background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l1);border-radius:18px;text-align:center;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-callout{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--kb-switch-on,#4d7cfe);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
/* — ajouts hors maquette : uniquement ce que le parcours réel exige (formulaires, avis) — */
.kbs-root .kbs-fields{display:flex;flex-direction:column;gap:13px}
.kbs-root .kbs-label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-input,.kbs-root .kbs-area,.kbs-root .kbs-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;padding:10px 12px}
.kbs-root .kbs-area{min-height:104px;resize:vertical;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6}
.kbs-root .kbs-input:focus,.kbs-root .kbs-area:focus,.kbs-root .kbs-select:focus{outline:none;border-color:var(--kb-switch-on,#4d7cfe)}
.kbs-root .kbs-check{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbs-root .kbs-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbs-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.kbs-root .kbs-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:210;display:flex;align-items:center;gap:9px;padding:11px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 34px rgba(0,0,0,.5);font-size:13px;color:var(--dsw-alias-label-primary);max-width:70vw}
.kbs-root .kbs-toast.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.kbs-root .kbs-copy{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);border-radius:999px;padding:3px 9px;font-family:ui-monospace,monospace;font-size:11px;cursor:pointer}
.kbs-root .kbs-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-nowrap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* — Featured : cartes à pochette — mêmes jetons que .kb8-card (bg-layer-1, border-l1,
   rayon 16) : la rangée doit se lire comme le reste des onglets, pas comme une
   marketplace posée à côté. Hover = bordure l2, SANS lift (les autres cartes ne lèvent pas). */
.kbs-root .kbs-feat{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}
.kbs-root .kbs-feat-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.kbs-root .kbs-feat-head .t{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-feat-head .s{font-size:12px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-feat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.kbs-root .kbs-feat-card{position:relative;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column;cursor:pointer;transition:border-color .12s}
.kbs-root .kbs-feat-card:hover{border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-feat-cover{height:148px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.kbs-root .kbs-feat-cover img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.kbs-root .kbs-feat-cover .kb8-tile.lg{width:64px;height:64px;border-radius:19px}
.kbs-root .kbs-feat-body{padding:13px 15px 14px;display:flex;flex-direction:column;gap:7px;flex:1}
.kbs-root .kbs-feat-name{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbs-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);min-height:39px}
.kbs-root .kbs-feat-foot{display:flex;align-items:center;gap:8px;margin-top:auto;border-top:1px solid var(--dsw-alias-border-l1);padding-top:11px}
.kbs-root .kbs-feat-foot .when{font-size:12px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-star-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);cursor:pointer;padding:0;flex:0 0 auto}
.kbs-root .kbs-star-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-star-btn.on{color:#f7c46c;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.kbs-root .kbs-feat-card .kbs-star-btn{position:absolute;top:9px;right:9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent);backdrop-filter:blur(4px)}
`

      // ── accès aux routes ────────────────────────────────────────────────────
      // Un corps illisible n'est pas une panne réseau : on nomme le statut HTTP, parce que le cas
      // le plus fréquent en développement est une route simplement ABSENTE (module hôte pas encore
      // rechargé) — et « injoignable » enverrait chercher la panne au mauvais endroit.
      const lire = async (r) => {
        try { return await r.json() } catch (e) {
          return { ok: false, error: r.ok === true ? t('err.unreadable') : t('err.noroute', { s: r.status }) }
        }
      }
      // La session AFFICHEE accompagne chaque appel : c'est elle qui fixe le PROJET, donc les skills
      // de projet que le catalogue doit montrer, et la portee a invalider apres une ecriture. Sans
      // session (onglet ouvert hors session), rien n'est ajoute : comportement d'origine conserve.
      let kbSkSid = ''
      const avecSession = (path) => (kbSkSid === '' ? path : path + (path.indexOf('?') === -1 ? '?' : '&') + 'sessionId=' + encodeURIComponent(kbSkSid))
      const corpsSession = (body) => (kbSkSid === '' ? body : Object.assign({}, body === null || body === undefined ? {} : body, { sessionId: kbSkSid }))
      const getJson = (path) => fetch(avecSession(path), { headers: { accept: 'application/json' } }).then(lire)
      const postJson = (path, body) => fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(corpsSession(body))
      }).then(lire)
      const why = (j, fallback) => (j !== null && j !== undefined && typeof j.error === 'string' && j.error !== '') ? j.error : fallback
      const skillKey = (s) => String(s.root) + '\u0000' + String(s.name)

      function KybernosSkills(props) {
        // Portee de la vue : la session que l'onglet represente. Publiee des le rendu pour que les
        // helpers l'attachent a chaque appel ; l'effet de chargement, lui, depend de `sid`.
        const sid = (props !== null && props !== undefined && typeof props.sessionId === 'string') ? props.sessionId : ''
        kbSkSid = sid
        const [mode, setMode] = React.useState('yours')                       // yours | discover
        const [q, setQ] = React.useState({ yours: '', discover: '' })
        const [sort, setSort] = React.useState({ yours: 'recent', discover: 'installs' })
        const [dir, setDir] = React.useState({ yours: -1, discover: -1 })
        const [page, setPage] = React.useState({ yours: 1 })
        // L'index est PAGINE cote serveur : `iview` choisit le classement, `ipage` est 0-indexe comme
        // l'API, `iper` la taille de page. C'est ce qui remplace le « Charger plus » sans fin — a
        // 9 827 skills, on ne fait pas defiler : on page, ou on cherche.
        const [iview, setIview] = React.useState('all-time')
        const [ipage, setIpage] = React.useState(0)
        const [iper, setIper] = React.useState(50)
        const [showFilters, setShowFilters] = React.useState(false)
        const [sortOpen, setSortOpen] = React.useState(false)
        const [addOpen, setAddOpen] = React.useState(false)
        const [stateFilter, setStateFilter] = React.useState('all')           // all | active | disabled
        const [sourceFilter, setSourceFilter] = React.useState('all')
        const [cat, setCat] = React.useState(null)
        const [catPhase, setCatPhase] = React.useState('loading')
        const [catError, setCatError] = React.useState('')
        const [disc, setDisc] = React.useState(null)
        const [discPhase, setDiscPhase] = React.useState('idle')
        const [discError, setDiscError] = React.useState('')
        const [audit, setAudit] = React.useState(null)     // audits de securite du skill ouvert
        const [index, setIndex] = React.useState(null)     // etat du jeton OIDC (jamais sa valeur)
        const [busy, setBusy] = React.useState({})
        const [errors, setErrors] = React.useState({})
        const [notice, setNotice] = React.useState(null)
        const [roots, setRoots] = React.useState([])
        const [modal, setModal] = React.useState(null)                        // null | create | install
        const [detail, setDetail] = React.useState(null)
        // Featured : la liste mise en avant, contrôlée par l'utilisateur. `items` suit l'ordre du
        // fichier ; un item `found:false` (skill disparu du registre) est sauté au rendu, pas effacé.
        const [feat, setFeat] = React.useState({ phase: 'idle', items: [] })
        const alive = React.useRef(true)

        React.useEffect(() => () => { alive.current = false }, [])

        // Fermeture des trois popovers (Filtres, Trier, Creer/Installer) au clic exterieur et
        // a Echap. Sans ca, un menu ouvert ne se refermait que par son propre bouton : on
        // pouvait cliquer dans la liste, changer d'onglet, et le laisser ouvert derriere. Meme
        // mecanique que les popovers du pivot (.kb6-tb-mwrap) : un clic dans le popover ou sur
        // son bouton ne ferme pas, tout le reste ferme.
        React.useEffect(() => {
          if (showFilters !== true && sortOpen !== true && addOpen !== true) return undefined
          const ferme = () => { setShowFilters(false); setSortOpen(false); setAddOpen(false) }
          const onDown = (e) => {
            try {
              if (e !== null && e.target !== null && typeof e.target.closest === 'function' && e.target.closest('.kb-menu-wrap') !== null) return
            } catch (e2) { /* cible exotique */ }
            ferme()
          }
          const onKey = (e) => { if (e !== null && e.key === 'Escape') ferme() }
          document.addEventListener('mousedown', onDown, true)
          document.addEventListener('keydown', onKey, true)
          return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true) }
        }, [showFilters, sortOpen, addOpen])

        const loadCatalogue = React.useCallback(() => {
          setCatPhase('loading')
          getJson('/kybernos-skills/skills').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) { setCat(j); setCatPhase('ready'); setCatError('') }
            else { setCatPhase('error'); setCatError(why(j, t('err.unexpected', { r: 'skills' }))) }
          }).catch(() => {
            if (alive.current !== true) return
            setCatPhase('error'); setCatError(t('err.unavail', { r: 'skills' }))
          })
        }, [sid])

        const loadFeatured = React.useCallback(() => {
          getJson('/kybernos-skills/featured').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setFeat({ phase: 'ready', items: j.items })
            } else setFeat({ phase: 'error', items: [] })
          }).catch(() => { if (alive.current === true) setFeat({ phase: 'error', items: [] }) })
        }, [sid])

        // Étoile = (dé)mettre en avant. La réponse porte la liste à jour : on la suit telle quelle,
        // sans recharger — un aller-retour de moins, et l'ordre affiché reste celui du fichier.
        // POST sur /featured/toggle (et non /featured) : la table exact du webServer est indexée
        // par chemin seul, un GET+POST de même path jette « duplicate » AU MONTAGE (mesuré).
        const toggleFeatured = (name, why) => {
          postJson('/kybernos-skills/featured/toggle', { name, why: why || '' }).then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setFeat((m) => ({ ...m, phase: 'ready', items: j.items }))
              setNotice({ kind: 'ok', text: j.featured === true ? t('notice.featOn', { name }) : t('notice.featOff', { name }) })
            } else setNotice({ kind: 'err', text: why(j, t('err.feat')) })
          }).catch(() => {
            if (alive.current === true) setNotice({ kind: 'err', text: t('err.unavail', { r: 'featured' }) })
          })
        }

        React.useEffect(() => {
          loadCatalogue()
          loadFeatured()
          getJson('/kybernos-skills/status').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.roots)) {
              setRoots(j.roots.filter((r) => r !== null && typeof r.path === 'string'))
            }
            if (j !== null && typeof j === 'object' && j.index !== undefined) setIndex(j.index)
          }).catch(() => { /* sans racines, les modales retombent sur l'hôte qui revalide tout */ })
        }, [loadCatalogue, loadFeatured])

        // Une requête pour les trois vues paginées, une autre pour la recherche, une pour le set
        // curated. Le serveur annonce `total` et `hasMore` : la pagination ne devine rien, et c'est
        // précisément ce qui manquait quand on scrapait 571 entrées d'une page de 9 827 skills.
        const dq = q.discover
        const dneedle = dq.trim()
        const discKind = dneedle.length >= 2 ? 'search' : (iview === 'curated' ? 'curated' : 'index')
        React.useEffect(() => {
          if (mode !== 'discover') return undefined
          let stopped = false
          setDiscPhase('loading')
          const route = discKind === 'search'
            ? '/kybernos-skills/search?q=' + encodeURIComponent(dneedle) + '&limit=100'
            : (discKind === 'curated'
              ? '/kybernos-skills/curated'
              : '/kybernos-skills/index?view=' + encodeURIComponent(iview) + '&page=' + ipage + '&perPage=' + iper)
          // Le debounce n'a de sens que pour la frappe : les autres requêtes partent d'un clic.
          const timer = setTimeout(() => {
            getJson(route).then((j) => {
              if (stopped === true || alive.current !== true) return
              if (j !== null && typeof j === 'object' && j.ok === true) { setDisc(j); setDiscPhase('ready'); setDiscError('') }
              else { setDiscPhase('error'); setDiscError(why(j, t('err.index'))) }
            }).catch(() => {
              if (stopped === true || alive.current !== true) return
              // Ce `catch` est celui de NOTRE route : si elle tombe, l'index n'y est pour rien.
            // Accuser skills.sh ici serait un mensonge de diagnostic — l'état d'erreur dit
            // juste en dessous d'où vient l'index et ce qu'il exige.
            setDiscPhase('error'); setDiscError(t('err.noanswer'))
            })
          }, discKind === 'search' ? 350 : 0)
          return () => { stopped = true; clearTimeout(timer) }
        }, [mode, dneedle, discKind, iview, ipage, iper])

        // Tout changement de filtre ramène à la première page : sinon on peut se retrouver
        // sur une page vide après avoir resserré une recherche.
        React.useEffect(() => { setPage((p) => ({ ...p, yours: 1 })) }, [q.yours, stateFilter, sourceFilter, sort.yours, dir.yours])
        React.useEffect(() => { setIpage(0) }, [dneedle, iview, iper])

        // Les audits ne sont demandés QUE pour le skill ouvert : une requête par ligne serait
        // impolie pour un tableau de cinquante lignes.
        React.useEffect(() => {
          if (detail === null) { setAudit(null); return undefined }
          let stopped = false
          setAudit({ phase: 'loading' })
          getJson('/kybernos-skills/audit?source=' + encodeURIComponent(detail.source) + '&skill=' + encodeURIComponent(detail.name)).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) {
              setAudit({ phase: 'ready', audits: Array.isArray(j.audits) ? j.audits : [], note: j.note })
            } else {
              setAudit({ phase: 'error', error: why(j, t('err.audit')) })
            }
          }).catch(() => {
            if (stopped !== true && alive.current === true) setAudit({ phase: 'error', error: t('err.unavail', { r: 'audit' }) })
          })
          return () => { stopped = true }
        }, [detail])

        React.useEffect(() => {
          if (notice === null) return undefined
          const t = setTimeout(() => { if (alive.current === true) setNotice(null) }, 4200)
          return () => clearTimeout(t)
        }, [notice])

        const skills = (cat !== null && Array.isArray(cat.skills)) ? cat.skills : []
        const activeCount = skills.filter((s) => s.active === true).length
        const sources = React.useMemo(() => {
          const set = new Set()
          skills.forEach((s) => { if (typeof s.source === 'string' && s.source !== '') set.add(s.source) })
          return Array.from(set).sort()
        }, [skills])

        const filtered = React.useMemo(() => {
          const needle = q.yours.trim().toLowerCase()
          let list = skills
          if (needle !== '') {
            list = list.filter((s) => String(s.name).toLowerCase().includes(needle) ||
              String(s.description || '').toLowerCase().includes(needle) ||
              String(s.whenToUse || '').toLowerCase().includes(needle))
          }
          if (stateFilter === 'active') list = list.filter((s) => s.active === true)
          if (stateFilter === 'disabled') list = list.filter((s) => s.active !== true)
          if (sourceFilter !== 'all') list = list.filter((s) => s.source === sourceFilter)
          const copy = list.slice()
          const d = dir.yours, k = sort.yours
          copy.sort((a, b) => k === 'name'
            ? d * String(a.name).localeCompare(String(b.name))
            : d * String(a.modifiedAt || '').localeCompare(String(b.modifiedAt || '')))
          return copy
        }, [skills, q.yours, stateFilter, sourceFilter, sort.yours, dir.yours])

        // Les trois formes de réponse sont ramenées à UNE liste, pour que le rendu n'ait qu'un cas.
        //   index   : { skills, total, hasMore, page }
        //   search  : { skills, count, durationMs }
        //   curated : { owners[{owner, skills[]}], totalOwners, totalSkills }
        // Le set curated est aplati et marqué `official` : la pastille vient enfin d'un ENSEMBLE
        // first-party, et non plus d'un drapeau glané dans le HTML d'une page.
        const discList = React.useMemo(() => {
          if (disc === null) return []
          if (discKind === 'curated') {
            const owners = Array.isArray(disc.owners) ? disc.owners : []
            const flat = []
            owners.forEach((o) => {
              (Array.isArray(o.skills) ? o.skills : []).forEach((s) => { flat.push({ ...s, official: true, owner: o.owner }) })
            })
            return flat.sort((a, b) => (b.installs || 0) - (a.installs || 0))
          }
          const items = Array.isArray(disc.skills) ? disc.skills : []
          const copy = items.slice()
          if (discKind === 'index') {
            const d = dir.discover, k = sort.discover
            copy.sort((a, b) => k === 'name'
              ? d * String(a.name).localeCompare(String(b.name))
              : d * ((a.installs || 0) - (b.installs || 0)))
          }
          return copy
        }, [disc, discKind, sort.discover, dir.discover])

        // ── pagination du classement ──────────────────────────────────────────
        // Elle vient du SERVEUR pour les trois vues classées ; le set curated, lui, est rendu d'un
        // bloc (100 propriétaires, 6 533 skills) et se pagine localement.
        const discTotal = discKind === 'index'
          ? (disc !== null && Number.isFinite(disc.total) ? disc.total : discList.length)
          : (discKind === 'search'
            ? (disc !== null && Number.isFinite(disc.count) ? disc.count : discList.length)
            : discList.length)
        const discPages = Math.max(1, Math.ceil(discTotal / iper))
        // La page AFFICHÉE est celle de la DONNÉE reçue, jamais celle qu'on vient de demander :
        // pendant le chargement, `ipage` avance avant la réponse, et la colonne « # » afficherait
        // alors les rangs de la page 3 au-dessus des lignes de la page 1 — constaté en vrai.
        const discPage = discKind === 'index'
          ? (disc !== null && Number.isFinite(disc.page) ? disc.page : ipage)
          : Math.min(ipage, discPages - 1)
        const discShown = discKind === 'index' ? discList : discList.slice(discPage * iper, discPage * iper + iper)
        const discFrom = discTotal === 0 ? 0 : discPage * iper + 1
        const discTo = discKind === 'index' ? Math.min((discPage + 1) * iper, discTotal) : Math.min(discPage * iper + discShown.length, discTotal)

        // ── actions ───────────────────────────────────────────────────────────
        const toggle = (skill) => {
          if (skill.writable !== true) return
          const k = skillKey(skill)
          if (busy[k] === true) return
          setErrors((m) => { const n = { ...m }; delete n[k]; return n })
          setBusy((m) => ({ ...m, [k]: true }))
          postJson('/kybernos-skills/toggle', { root: skill.root, name: skill.name, active: skill.active !== true }).then((j) => {
            if (alive.current !== true) return
            setBusy((m) => { const n = { ...m }; delete n[k]; return n })
            if (j !== null && typeof j === 'object' && j.ok === true) {
              // ARB-3 : « changed » vaut true ou false, les deux sont des succès — l'état
              // affiché suit d'abord le skill renvoyé, puis la liste est resynchronisée.
              if (j.skill !== null && typeof j.skill === 'object') {
                const ret = j.skill
                setCat((c) => c === null ? c : { ...c, skills: c.skills.map((s) => (s.root === ret.root && s.name === ret.name) ? ret : s) })
              }
              loadCatalogue()
              setNotice({ kind: 'ok', text: skill.active === true ? t('notice.off', { name: skill.name }) : t('notice.on', { name: skill.name }) })
            } else {
              setErrors((m) => ({ ...m, [k]: why(j, t('err.unexpected', { r: 'toggle' })) }))
            }
          }).catch(() => {
            if (alive.current !== true) return
            setBusy((m) => { const n = { ...m }; delete n[k]; return n })
            setErrors((m) => ({ ...m, [k]: t('err.unavail', { r: 'toggle' }) }))
          })
        }

        const copy = (text) => {
          try {
            if (navigator !== undefined && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text).then(
                () => { if (alive.current === true) setNotice({ kind: 'ok', text: t('copy.ok', { text }) }) },
                () => { if (alive.current === true) setNotice({ kind: 'err', text: t('copy.denied') }) })
              return
            }
          } catch (e) { /* repli ci-dessous */ }
          setNotice({ kind: 'err', text: t('copy.unavail') })
        }

        const count = catPhase === 'ready' ? String(skills.length) : '0'
        const shownYours = filtered.slice(0, page.yours * PAGE)

        // Ouvrir une modale repart d'un ecran propre : sans cela, l'erreur de la tentative
        // precedente resterait affichee au-dessus d'un formulaire encore vide.
        const openModal = (kind) => {
          setErrors((m) => { const n = { ...m }; delete n.__modal; return n })
          setModal(kind)
        }

        // ── fragments ─────────────────────────────────────────────────────────
        const primary = (label, act, ic, disabled) => h('button', {
          type: 'button', className: 'kb8-primary', onClick: act, disabled: disabled === true
        }, ic ? icon(ic, 15) : null, h('span', null, label))

        const renderSortMenu = () => {
          const isYours = mode === 'yours'
          const k = isYours ? sort.yours : sort.discover
          const opts = isYours
            ? [['recent', t('sort.recent'), t('sort.recent.sub')], ['name', t('sort.name'), t('sort.alpha')]]
            : [['installs', t('sort.installs'), t('sort.installs.sub')], ['name', t('sort.name'), t('sort.alpha')]]
          const d = isYours ? dir.yours : dir.discover
          return h('div', { className: 'kb-sortmenu' },
            h('div', { className: 'kb-sort-head' },
              h('span', { className: 'lbl' }, t('sort.by')),
              h('button', {
                type: 'button', className: 'kb-dir', title: d === -1 ? t('sort.desc') : t('sort.asc'),
                onClick: () => setDir((m) => isYours ? { ...m, yours: -m.yours } : { ...m, discover: -m.discover })
              }, d === -1 ? '↓' : '↑')),
            opts.map((o) => h('button', {
              key: o[0], type: 'button', className: 'kb-sort-opt' + (k === o[0] ? ' on' : ''),
              onClick: () => { setSort((m) => isYours ? { ...m, yours: o[0] } : { ...m, discover: o[0] }); setSortOpen(false) }
            }, h('span', { className: 'tk' }, icon('check', 13)),
               h('span', { className: 'tx' }, h('span', null, o[1]), h('span', { className: 'sub' }, o[2])))),
            h('div', { className: 'kb-sort-note' }, icon('info', 13),
              h('span', null, isYours
                ? t('sort.noteYours')
                : t('sort.noteDisc', { v: iview }))))
        }

        const chip = (label, on, act, key) => h('button', {
          key: key || label, type: 'button', className: 'kb8-chip' + (on ? ' on' : ''), onClick: act
        }, label)

        // VUES offertes par l'API officielle. « Curated » n'est pas un classement mais le set
        // first-party : il est donc présenté à part, et il marque ses entrées `official`.
        const VUES = [
          ['all-time', 'All Time', t('view.alltime')],
          ['trending', 'Trending', t('view.trending')],
          ['hot', 'Hot', t('view.hot')],
          ['curated', 'Curated', t('view.curated')]
        ]

        const razoirFiltres = () => {
          if (mode === 'discover') { setIview('all-time'); setIper(50) }
          else { setStateFilter('all'); setSourceFilter('all') }
        }
        // Nombre de filtres actifs : l'etat se lit sur le bouton (.kb-tool-lab .n), comme le
        // « Filters 1 » du pivot. En Discover la vue est ecrite en clair sur le bouton, seules
        // les lignes comptent donc ici.
        const filtresActifs = () => mode === 'discover'
          ? (iper === 50 ? 0 : 1)
          : (stateFilter === 'all' ? 0 : 1) + (sourceFilter === 'all' ? 0 : 1)
        const vueLabel = () => { const v = VUES.filter((x) => x[0] === iview)[0]; return v !== undefined ? v[1] : 'All Time' }
        const sortLabel = (isYours) => {
          const k = isYours ? sort.yours : sort.discover
          const v = (isYours
            ? [['recent', t('sort.recent')], ['name', t('sort.name')]]
            : [['installs', t('sort.installs')], ['name', t('sort.name')]]).filter((x) => x[0] === k)[0]
          return v !== undefined ? v[1] : t('sort.fallback')
        }

        const renderFilters = () => {
          const tete = h('div', { className: 'head' },
            h('span', { className: 't' }, mode === 'discover' ? t('flt.rankrows') : t('flt.title')),
            h('button', { type: 'button', className: 'raz', onClick: razoirFiltres }, t('flt.reset')))
          if (mode === 'discover') {
            return h('div', { className: 'kb-filters' }, tete,
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, t('flt.view')),
                VUES.map((v) => chip(v[1] + (v[0] === 'all-time' && discTotal > 0 && discKind === 'index' ? ' (' + discTotal + ')' : ''), iview === v[0], () => setIview(v[0]), v[0]))),
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, t('flt.rows')),
                [25, 50, 100, 250].map((n) => chip(String(n), iper === n, () => setIper(n), 'n' + n))),
              h('div', { className: 'kb-filter-row' },
                h('span', { className: 'lbl' }, 'Source'),
                h('span', { className: 'kb8-mono' }, discKind === 'search'
                  ? t('src.search', { n: discList.length, total: discTotal, ms: (disc !== null && Number.isFinite(disc.durationMs) ? disc.durationMs + ' ms' : t('src.unknownDur')) })
                  : (discKind === 'curated'
                    ? t('src.curated', { n: discTotal, o: (disc !== null && Number.isFinite(disc.totalOwners) ? disc.totalOwners : '?'), d: String(disc !== null && disc.generatedAt ? disc.generatedAt : '').slice(0, 10) })
                    : t('src.index', { n: discTotal, v: iview })))))
          }
          return h('div', { className: 'kb-filters' }, tete,
            h('div', { className: 'kb-filter-row' },
              h('span', { className: 'lbl' }, t('flt.state')),
              chip(t('flt.all'), stateFilter === 'all', () => setStateFilter('all')),
              chip(t('flt.active', { n: activeCount }), stateFilter === 'active', () => setStateFilter('active')),
              chip(t('flt.disabled', { n: skills.length - activeCount }), stateFilter === 'disabled', () => setStateFilter('disabled'))),
            h('div', { className: 'kb-filter-row' },
              h('span', { className: 'lbl' }, t('f.root')),
              chip(t('flt.allf'), sourceFilter === 'all', () => setSourceFilter('all')),
              sources.map((s) => chip(s, sourceFilter === s, () => setSourceFilter(s), s))))
        }

        const renderAdd = () => {
          const isYours = mode === 'yours'
          return h('div', { className: 'kb-menu-wrap' },
                h('button', {
                  type: 'button', className: 'kb8-primary',
                  onClick: () => { setAddOpen(!addOpen); setSortOpen(false); setShowFilters(false) }
                }, icon('plus', 16), h('span', null, isYours ? t('add.create') : t('add.install')), icon('chev', 14)),
                addOpen ? h('div', { className: 'kb-menu' },
                  (isYours
                    ? [['wand', t('add.create'), 'create'], ['github', t('add.github'), 'install'], ['search', t('add.search'), 'discover']]
                    : [['plus', t('add.manual'), 'install'], ['search', t('add.top'), 'featured']]
                  ).map((a) => h('button', {
                    key: a[2], type: 'button',
                    onClick: () => {
                      setAddOpen(false)
                      if (a[2] === 'discover') setMode('discover')
                      else if (a[2] === 'featured') { setQ((m) => ({ ...m, discover: '' })); setIview('all-time'); setIpage(0); setMode('discover') }
                      else openModal(a[2])
                    }
                  }, icon(a[0], 17), h('span', null, a[1]))))
                  : null)
        }

        const renderToolbar = () => {
          const isYours = mode === 'yours'
          return h('div', null,
            h('div', { className: 'kb-toolbar' },
              h('div', { className: 'kb8-search' }, icon('search', 14),
                h('input', {
                  placeholder: isYours ? t('ph.yours') : t('ph.discover'),
                  value: isYours ? q.yours : q.discover,
                  onChange: (e) => { const v = e.target.value; setQ((m) => isYours ? { ...m, yours: v } : { ...m, discover: v }) }
                })),
              h('div', { className: 'kb-menu-wrap' },
                h('button', {
                  type: 'button', className: 'kb-tool-lab' + (showFilters ? ' on' : ''), title: isYours ? t('flt.title') : t('flt.viewTitle'),
                  onClick: () => { setShowFilters(!showFilters); setSortOpen(false); setAddOpen(false) }
                }, icon('sliders', 16),
                  h('span', null, isYours ? t('flt.title') : t('flt.viewPrefix') + vueLabel()),
                  filtresActifs() > 0 ? h('span', { className: 'n' }, String(filtresActifs())) : null,
                  icon('chev', 14)),
                showFilters ? renderFilters() : null),
              h('div', { className: 'kb-menu-wrap' },
                h('button', { type: 'button', className: 'kb-tool-lab' + (sortOpen ? ' on' : ''), title: t('sort.by'), onClick: () => { setSortOpen(!sortOpen); setAddOpen(false); setShowFilters(false) } }, icon('sort', 16), h('span', null, sortLabel(isYours)), icon('chev', 14)),
                sortOpen ? renderSortMenu() : null)
            ),
            // Le panneau de filtres vit maintenant DANS le .kb-menu-wrap de son bouton
            // (popover ancre, convention .kb6-tb-pop du pivot) : plus de carte en ligne qui
            // poussait la liste vers le bas. L'etat reste lisible sur le bouton libelle.
            null)
        }

        const yourCard = (s) => {
          const k = skillKey(s)
          const on = s.active === true
          const err = errors[k]
          return h('div', { key: k, className: 'kb8-card static' },
            h('div', { className: 'kb-row' },
              tile(s.name, 'pkg'),
              h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
                h('span', { className: 'kb8-name' }, s.name),
                h('span', { className: 'kb8-parent kbs-nowrap' }, (s.source || '') + ' · ' + String(s.root || ''))),
              s.writable === true
                ? h('button', {
                    type: 'button', className: 'kb-sw' + (on ? ' on' : ''), title: on ? t('card.disable') : t('card.enable'),
                    disabled: busy[k] === true, onClick: () => toggle(s)
                  }, h('i', null))
                : h('span', { className: 'kb8-pill' }, t('card.readonly')),
              h('button', {
                type: 'button', className: 'kbs-star-btn' + (featNames.has(s.name) ? ' on' : ''),
                title: featNames.has(s.name) ? t('feat.remove') : t('feat.add'),
                onClick: () => toggleFeatured(s.name)
              }, icon('star', 14))),
            h('div', { className: 'desc' }, s.description !== '' ? s.description : t('card.nodesc')),
            h('div', { className: 'kb8-pills' },
              on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
              s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
              s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.noedit')) : null),
            h('div', { className: 'foot' },
              icon('shield', 13),
              h('span', null, s.modifiedAt !== '' ? t('mod.on', { d: today(s.modifiedAt) }) : t('mod.unknown')),
              h('span', { className: 'grow' }),
              h('button', {
                type: 'button', className: 'kbs-copy', title: t('card.copyTitle'),
                onClick: () => copy('/' + s.name)
              }, icon('code', 12), '/' + s.name)),
            err ? h('div', { className: 'kbs-err' }, err) : null)
        }

        // ── TABLEAU du classement ─────────────────────────────────────────────
        // Des CARTES pour un classement de 9 827 lignes, c'est ce qui rendait le défilement
        // interminable : six cartes par écran, et « Charger plus » au bas d'une page de 3 380 px.
        // Une ligne fait ~34 px : cinquante tiennent à l'écran, et le pager reste fixe.
        // ── Featured : fragments de la rangée mise en avant ───────────────────
        // Le set des noms featuretés (items found seulement) : l'étoile des cartes Yours et de la
        // fiche se remplit depuis ici, sans état dupliqué.
        const featNames = React.useMemo(() => new Set(feat.items.filter((it) => it.found !== false).map((it) => it.name)), [feat])

        // Pochette : l'image du dossier si elle existe, sinon la TUILE DU PIVOT (tile(), même
        // facture que les cartes des autres onglets) — jamais un visuel qui sort du thème.
        const coverArt = (it) => {
          if (it.cover !== null && it.cover !== undefined && it.cover !== '') {
            return h('img', {
              src: it.cover, alt: t('cover.alt', { name: it.name }), loading: 'lazy',
              onError: (e) => { try { e.target.style.display = 'none' } catch (e2) { /* la tuile sombre suffit */ } }
            })
          }
          return tile(it.name, 'pkg', 'lg')
        }

        // Clic sur une carte Featured = retrouver le skill dans Yours (filtre pré-rempli) :
        // la fiche Discover est une fiche d'INSTALLATION, elle n'a rien à dire d'un skill local.
        const featCard = (it) => h('div', {
          key: it.name, className: 'kbs-feat-card',
          onClick: () => { setMode('yours'); setQ((m) => ({ ...m, yours: it.name })); setDetail(null) }
        },
          h('div', { className: 'kbs-feat-cover' }, coverArt(it)),
          h('div', { className: 'kbs-feat-body' },
            h('span', { className: 'kbs-feat-name', title: it.name }, it.name),
            h('span', { className: 'kbs-clamp2' }, it.description !== '' ? it.description : t('card.nodesc')),
            h('div', { className: 'kbs-feat-foot' },
              h('span', { className: 'kb8-pill' }, it.source || t('feat.localskill')),
              h('span', { className: 'when' }, it.modifiedAt !== '' ? t('mod.on.lc', { d: today(it.modifiedAt) }) : ''),
              h('span', { style: { flex: '1' } }),
              h('button', {
                type: 'button', className: 'kbs-star-btn on', title: t('feat.remove'),
                onClick: (e) => { e.stopPropagation(); toggleFeatured(it.name) }
              }, icon('star', 14)))))

        const installed = (x) => skills.some((s) => s.name === x.name)

        const ligne = (x, i) => h('div', {
          key: x.source + '/' + x.name,
          className: 'kbs-row' + (installed(x) ? ' has' : ''),
          onClick: () => { setDetail(x); setModal(null); setAudit(null) }
        },
          h('span', { className: 'rank' }, String(discFrom + i)),
          // La TUILE est ce qui fait qu'une ligne appartient au meme univers que les cartes des
          // autres onglets (kb8-tile, kb8-name, kb8-parent, kb8-pill : les jetons du pivot).
          h('span', { className: 'who' }, tile(x.name, 'pkg', 'kbs-sm'), h('span', { className: 'kb8-name' }, x.name)),
          h('span', { className: 'kb8-parent src kbs-nowrap' }, x.source),
          h('span', { className: 'badges' },
            x.official === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : null,
            installed(x) ? h('span', { key: 'i', className: 'kb8-pill' }, t('row.installed')) : null,
            // 15 % du catalogue est hébergé hors GitHub (`well-known`) : on le DIT ici plutôt que de
            // proposer un bouton qui échouera plus loin.
            x.installable !== true ? h('span', { key: 'w', className: 'kb8-pill warn' }, t('row.offgh')) : null),
          h('span', { className: 'inst' }, nf(x.installs)))

        // Pager sur `total` SERVEUR. On ne charge plus « un peu plus » en bas d'une liste qui grandit :
        // on va à la page voulue, et le nombre de pages est connu d'avance.
        // `haut` : le même pager est rendu AU-DESSUS du tableau. Avec cinquante lignes, le pager du
        // bas n'est atteignable qu'en défilant — exactement le geste qu'on cherchait à supprimer.
        const pagerIndex = (haut) => {
          const first = Math.max(0, Math.min(discPage - 2, Math.max(0, discPages - 5)))
          const around = []
          for (let p = first; p < Math.min(discPages, first + 5); p++) around.push(p)
          return h('div', { className: 'kbs-pager' + (haut === true ? ' haut' : '') },
            h('button', {
              type: 'button', className: 'kb8-ghost', disabled: discPage <= 0,
              onClick: () => setIpage(Math.max(0, discPage - 1))
            }, icon('back', 14), ' ' + t('pg.prev')),
            around.map((p) => h('button', {
              key: p, type: 'button', className: 'pg' + (p === discPage ? ' on' : ''), onClick: () => setIpage(p)
            }, String(p + 1))),
            h('span', { className: 'kb8-mono' }, t('pg.page', { p: discPage + 1, n: discPages })),
            h('button', {
              type: 'button', className: 'kb8-ghost', disabled: discPage >= discPages - 1,
              onClick: () => setIpage(Math.min(discPages - 1, discPage + 1))
            }, t('pg.next') + ' ', icon('chevR', 14)),
            h('span', { className: 't' }, t('pg.rows', { a: discFrom, b: discTo, n: discTotal })))
        }

        // Yours reste petit (des dizaines) : « Charger plus » y suffit, un pager serait du bruit.
        const pagerYours = (shown, total) => h('div', { className: 'kbs-pager' },
          shown < total
            ? h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setPage((p) => ({ ...p, yours: p.yours + 1 })) }, icon('plus', 15), ' ' + t('pg.more'))
            : null,
          h('span', { className: 't' }, t('pg.of', { a: shown, n: total })))

        const empty = (title, hint) => h('div', { className: 'kb-empty' }, icon('search', 24),
          h('span', { className: 'kb8-name' }, title), h('span', { className: 'kb8-parent' }, hint))

        const renderYours = () => {
          if (catPhase === 'loading' && cat === null) return h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('y.loading')))
          if (catPhase === 'error') return h('div', { className: 'kb-empty' },
            h('span', { className: 'kb8-name' }, t('y.loadfail')), h('span', { className: 'kb8-parent' }, catError),
            h('button', { type: 'button', className: 'kb8-ghost', onClick: loadCatalogue }, t('y.retry')))
          if (filtered.length === 0) {
            return skills.length === 0
              ? empty(t('y.none'), t('y.nonehint'))
              : empty(t('y.noresult'), t('y.nofilter'))
          }
          return h('div', null,
            h('div', { className: 'kb8-grid' }, shownYours.map(yourCard)),
            pagerYours(shownYours.length, filtered.length))
        }

        // Le jeton OIDC vit ~12 h. Plutôt qu'un « erreur 401 » opaque, on dit quoi faire et on le fait.
        const reconnect = () => {
          setDiscPhase('loading')
          postJson('/kybernos-skills/reconnect', {}).then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.index !== undefined) setIndex(j.index)
            if (j !== null && typeof j === 'object' && j.ok === true) {
              setNotice({ kind: 'ok', text: t('notice.reconnected') })
              setDisc(null); setDiscPhase('idle')
            } else {
              setDiscPhase('error'); setDiscError(why(j, t('err.reconnect')))
            }
          }).catch(() => {
            if (alive.current !== true) return
            setDiscPhase('error'); setDiscError(t('err.unavail', { r: 'reconnect' }))
          })
        }

        const renderDiscover = () => {
          if (discPhase === 'loading' && disc === null) return h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('d.query')))
          if (discPhase === 'error') {
            return h('div', { className: 'kb-empty' },
              h('span', { className: 'kb8-name' }, t('d.down')),
              h('span', { className: 'kb8-parent' }, discError),
              h('span', { className: 'kb8-parent' }, t('d.oidc')),
              h('button', { type: 'button', className: 'kb8-ghost', onClick: reconnect }, icon('plug', 15), ' ' + t('d.reconnect')),
              h('span', { className: 'kb8-parent' }, t('d.direct')))
          }
          return h('div', null,
            // Rangée Featured : seulement sur la page 1 du classement, sans recherche — elle met
            // en avant, elle ne participe ni au tri ni au filtrage.
            feat.phase === 'ready' && discKind !== 'search' && dneedle === '' && discPage === 0 &&
              feat.items.some((it) => it.found !== false)
              ? h('div', { className: 'kbs-feat' },
                  h('div', { className: 'kbs-feat-head' },
                    h('span', { className: 't' }, 'Featured'),
                    h('span', { className: 's' }, feat.items.filter((it) => it.found !== false).length +
                      ' ' + t('feat.sub'))),
                  h('div', { className: 'kbs-feat-grid' },
                    feat.items.filter((it) => it.found !== false).map(featCard)))
              : null,
            discShown.length === 0 ? null : pagerIndex(true),
            h('div', { className: 'kbs-table' + (discPhase === 'loading' ? ' loading' : '') },
              h('div', { className: 'kbs-head' },
                h('span', { className: 'rank' }, '#'),
                h('span', { className: 'who' }, discKind === 'search' ? t('th.result') : 'SKILL'),
                h('span', { className: 'src' }, 'SOURCE'),
                h('span', { className: 'badges' }, t('th.state')),
                h('span', { className: 'inst' }, 'INSTALLATIONS')),
              discShown.length === 0
                ? empty(t('y.noresult'), discKind === 'search' ? t('d.empty.search') : t('d.empty.page'))
                : discShown.map(ligne)),
            discShown.length === 0 ? null : pagerIndex())
        }

        const renderDetail = () => {
          const x = detail
          const already = skills.some((s) => s.name === x.name)
          return h('div', null,
            h('button', { type: 'button', className: 'kb-back', onClick: () => setDetail(null) }, icon('back', 15), ' Discover › ' + x.name),
            h('div', { className: 'kb-detail-head' },
              tile(x.name, 'pkg', 'lg'),
              h('div', { className: 'meta' },
                h('div', { className: 'kb-row', style: { gap: '9px' } },
                  h('span', { className: 'kb8-h1', style: { fontSize: '22px' } }, x.name),
                  x.official === true ? h('span', { className: 'kb8-pill ok' }, 'curated') : h('span', { className: 'kb8-pill' }, t('row.community'))),
                h('span', { className: 'kb8-parent' }, t('det.by', { s: x.source, n: nf(x.installs) }))),
              already === true
                ? h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                    h('span', { className: 'kb8-pill ok' }, t('row.already')),
                    h('button', {
                      type: 'button', className: 'kbs-star-btn' + (featNames.has(x.name) ? ' on' : ''),
                      title: featNames.has(x.name) ? t('feat.remove') : t('feat.add'),
                      onClick: () => toggleFeatured(x.name)
                    }, icon('star', 14)))
                : (x.installable === true
                  ? primary(t('btn.install'), () => openModal('install'), 'plus')
                  : h('span', { className: 'kb8-pill warn', title: x.sourceType === 'well-known' ? t('row.cantInstall.wk') : t('row.cantInstall.ng') }, t('row.cantInstall')))),
            h('div', { className: 'kb-cols' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '22px' } },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
                  h('span', { className: 'kb-section-label' }, t('det.provenance')),
                  h('div', { className: 'kb8-pills' },
                    h('span', { className: 'kb8-pill' }, x.source),
                    // Le type de source explique POURQUOI l'installation est possible ou non.
                    h('span', { className: 'kb8-pill' + (x.installable === true ? '' : ' warn') }, x.sourceType !== '' && x.sourceType !== undefined ? x.sourceType : t('det.unknownSrc')),
                    x.official === true ? h('span', { className: 'kb8-pill ok' }, 'curated') : null)),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
                  h('span', { className: 'kb-section-label' }, t('det.what')),
                  h('p', { className: 'kb8-sub', style: { maxWidth: 'none', fontSize: '15px' } },
                    t('det.whatBody')),
                  h('pre', { style: { margin: '0', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '12px 14px', fontFamily: 'ui-monospace,monospace', fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)', overflow: 'auto' } },
                    'POST /kybernos-skills/install\n{ "source": "' + x.source + '", "name": "' + x.name + '", "root": "' + t('det.rootph') + '" }'))),
              h('div', { className: 'kb-panel' },
                h('span', { className: 'kb-section-label', style: { textTransform: 'none', fontSize: '13px', letterSpacing: '0', color: 'var(--dsw-alias-label-secondary)' } }, t('det.checks')),
                h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('dl', 15)),
                  h('span', null, t('det.declared')), h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-caption)' } }, nf(x.installs))),
                h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('shield', 15)),
                  h('span', null, t('det.frontmatter'))),
                h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('folder', 15)),
                  h('span', null, t('det.target', { p: (roots.length > 0 ? roots[0].path : '~/.dsh/skills') }))),
                h('div', { className: 'kbs-audit', style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '11px' } },
                  h('span', { className: 'kb8-mono' }, icon('shield', 14), ' ' + t('det.audits')),
                  audit === null || audit.phase === 'loading'
                    ? h('span', { className: 'kb8-mono' }, t('det.auditLoading'))
                    : (audit.phase === 'error'
                      ? h('span', { className: 'ligne' }, audit.error)
                      : (audit.audits.length === 0
                        ? h('span', { className: 'kb8-mono' }, t('det.auditNone'))
                        : audit.audits.map((a, i) => h('div', { key: 'a' + i, className: 'ligne' },
                            h('span', { className: 'kb8-pill ' + (a.status === 'pass' ? 'ok' : 'warn') }, a.status === 'pass' ? t('det.audited') : (a.status !== '' ? a.status : t('det.unknown'))),
                            h('span', null, a.provider + (a.summary !== '' ? ' — ' + a.summary : '')))))),
                  h('span', { className: 'kb8-mono' }, t('det.thirdParty'))))))
        }

        const renderModal = () => {
          if (modal === 'create') return h(CreateModal, { roots, busy, onClose: () => setModal(null), onSubmit: (form) => {
            setBusy((m) => ({ ...m, __modal: true }))
            postJson('/kybernos-skills/create', form).then((j) => {
              if (alive.current !== true) return
              setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
              if (j !== null && typeof j === 'object' && j.ok === true) {
                setModal(null); loadCatalogue(); setNotice({ kind: 'ok', text: t('notice.created', { name: form.name }) })
              } else setErrors((m) => ({ ...m, __modal: why(j, t('err.create')) }))
            }).catch(() => {
              if (alive.current !== true) return
              setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
              setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'create' }) }))
            })
          }, error: errors.__modal })
          if (modal === 'install') return h(InstallModal, {
            roots, busy, preset: detail,
            onClose: () => setModal(null),
            onSubmit: (form) => {
              setBusy((m) => ({ ...m, __modal: true }))
              postJson('/kybernos-skills/install', form).then((j) => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                if (j !== null && typeof j === 'object' && j.ok === true) {
                  setModal(null); setDetail(null); setMode('yours'); loadCatalogue()
                  setNotice({ kind: 'ok', text: t('notice.installed', { name: form.name }) + (j.files ? t('notice.files', { n: j.files }) : '') })
                } else setErrors((m) => ({ ...m, __modal: why(j, t('err.install')) }))
              }).catch(() => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'install' }) }))
              })
            }, error: errors.__modal })
          return null
        }

        const body = detail !== null
          ? renderDetail()
          : h('div', null, mode === 'yours' ? renderYours() : renderDiscover())

        // (01/10) Même en-tête que « Connections » : titre + sous-titre à gauche, action principale à droite, puis une
        // rangée de contrôle (sous-onglets à gauche, recherche / filtre / tri à droite).
        const capTxt = detail !== null ? t('cap.detail') : (mode === 'yours'
          ? t('cap.yours', { a: activeCount, n: skills.length })
          : (discKind === 'search' ? t('cap.search') : t('cap.rank')))
        return h('div', { className: 'kbs-root' },
          h('div', { className: 'kbs-top' },
            h('div', { className: 'kbs-top-txt' },
              h('h2', { className: 'kbs-h1' }, 'Skills'),
              h('p', { className: 'kbs-sub', title: capTxt }, capTxt)),
            detail === null ? renderAdd() : null),
          h('div', { className: 'kbs-ctlrow' },
            h('nav', { className: 'kbsub' },
              // Même capsule que les sous-onglets de « Connections » (Vos connexions / Découvrir) : un seul langage.
              h('div', { className: 'kbsub-group', role: 'tablist' },
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'yours' ? 'true' : 'false', className: 'kb-seg' + (mode === 'yours' ? ' on' : ''), onClick: () => { setMode('yours'); setDetail(null) } },
                  'Yours ', h('span', { className: 'count' }, count)),
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'discover' ? 'true' : 'false', className: 'kb-seg' + (mode === 'discover' ? ' on' : ''), onClick: () => { setMode('discover'); setDetail(null) } },
                  'Discover ', h('span', { className: 'count' }, disc !== null && Array.isArray(disc.skills) ? String(disc.skills.length) : '—')))),
            detail === null ? renderToolbar() : null),
          h('div', { className: 'kb8-page' }, body),
          renderModal(),
          notice !== null ? h('div', { className: 'kbs-toast' + (notice.kind === 'err' ? ' err' : '') },
            icon(notice.kind === 'err' ? 'info' : 'check', 15), h('span', null, notice.text)) : null)
      }

      // Modale de création : les quatre champs qui composent un SKILL.md valide, rien de plus.
      function CreateModal(props) {
        const [name, setName] = React.useState('')
        const [description, setDescription] = React.useState('')
        const [whenToUse, setWhenToUse] = React.useState('')
        const [content, setContent] = React.useState('')
        const [root, setRoot] = React.useState(props.roots.length > 0 ? props.roots[0].path : '')
        const [quiet, setQuiet] = React.useState(false)
        const field = (label, node) => h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, label), node)
        const select = (value, onChange) => h('select', { className: 'kbs-select', value, onChange: (e) => onChange(e.target.value) },
          props.roots.length === 0
            ? h('option', { value: '' }, t('m.defroot'))
            : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('add.create')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('m.createSub')),
            field(t('m.name'), h('input', { className: 'kbs-input', value: name, placeholder: t('m.nameph'), onChange: (e) => setName(e.target.value) })),
            field(t('m.desc'), h('textarea', { className: 'kbs-area', style: { minHeight: '70px' }, value: description, onChange: (e) => setDescription(e.target.value) })),
            field(t('m.when'), h('input', { className: 'kbs-input', value: whenToUse, onChange: (e) => setWhenToUse(e.target.value) })),
            field(t('m.content'), h('textarea', { className: 'kbs-area', value: content, placeholder: t('m.contentph'), onChange: (e) => setContent(e.target.value) })),
            field(t('f.root'), select(root, setRoot)),
            h('label', { className: 'kbs-check' },
              h('input', { type: 'checkbox', checked: quiet, onChange: (e) => setQuiet(e.target.checked) }),
              h('span', null, t('m.quiet', { n: name || t('m.nameWord') }))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true,
                onClick: () => props.onSubmit({ name, description, whenToUse, body: content, root, modelInvocable: quiet !== true })
              }, icon('wand', 15), props.busy.__modal === true ? t('m.creating') : t('m.createBtn')))))
      }

      // Modale d'import : une source GitHub en owner/repo, pré-remplie depuis la fiche ouverte.
      function InstallModal(props) {
        const p = props.preset
        const [source, setSource] = React.useState(p !== null ? String(p.source) : '')
        const [name, setName] = React.useState(p !== null ? String(p.name) : '')
        const [root, setRoot] = React.useState(props.roots.length > 0 ? props.roots[0].path : '')
        const field = (label, node, hint) => h('div', { className: 'kbs-fields' },
          h('span', { className: 'kbs-label' }, label), node,
          hint ? h('span', { className: 'kb8-mono' }, hint) : null)
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('m.importTitle')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('m.importSub')),
            field(t('m.repo'), h('input', { className: 'kbs-input', value: source, placeholder: 'anthropics/skills', onChange: (e) => setSource(e.target.value) }),
              t('m.examples')),
            field(t('m.skillInRepo'), h('input', { className: 'kbs-input', value: name, placeholder: 'skill-creator', onChange: (e) => setName(e.target.value) })),
            field(t('m.destRoot'), h('select', { className: 'kbs-select', value: root, onChange: (e) => setRoot(e.target.value) },
              props.roots.length === 0
                ? h('option', { value: '' }, t('m.defroot'))
                : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true,
                onClick: () => props.onSubmit({ source: source.trim(), name: name.trim(), root })
              }, icon('github', 15), props.busy.__modal === true ? t('m.downloading') : t('btn.install')))))
      }

      // Feuille de style posee UNE fois, par identifiant, et rafraichie a chaque
      // application du module. Avant, elle vivait dans un ctx.effect : au
      // rechargement du plugin (patchReload) l'effet precedent etait demonte, la
      // feuille retiree — et si le nouvel apply sortait tot (service `slots` pas
      // encore pret), elle n'etait jamais reposee. Le panneau restait monte avec
      // les seuls styles du pivot (barre d'outils empilee, etiquettes recouvertes,
      // recherche a 52 px) : la page paraissait cassee sans qu'aucune erreur ne
      // remonte. Meme mecanique que le pivot : pose par id, jamais retiree,
      // contenu remis a jour si la version du module a change.
      const CSS_ID = 'kb-skills-css'
      const kbStyle = (css) => {
        try {
          if (typeof document === 'undefined' || document === null) return
          let st = document.getElementById(CSS_ID)
          if (st === null) {
            st = document.createElement('style')
            st.id = CSS_ID
            const head = document.head !== null && document.head !== undefined ? document.head : document.documentElement
            if (head === null || head === undefined) return
            head.appendChild(st)
          }
          if (st.textContent !== css) st.textContent = css
        } catch (e) { /* head indisponible */ }
      }

      function apply(ctx) {
        // Les styles d'abord : ils sont necessaires des que le panneau est monte,
        // meme si l'emplacement n'est pas encore disponible.
        kbStyle(CSS)
        try { const loc = ctx.get('locale'); if (loc !== undefined && loc !== null) localeSvc = loc } catch (e) { /* repli localStorage / <html lang> */ }
        const slots = ctx.get('slots')
        if (slots === undefined) {
          console.error('[kybernos-skills] service slots indisponible: pas d interface')
          return
        }
        slots.inject('main.kybernos-skills', () => slots.register(
          { name: 'main.kybernos-skills' },
          KybernosSkills))
      }

      return {
        inject: ['slots', 'locale'],
        apply(ctx) { apply(ctx) }
      }
    } catch (kbBootError) {
      try {
        console.error('[kybernos-skills] chargement impossible — plugin desactive, GUI preservee', kbBootError)
      } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin desactive apres erreur de chargement */ } }
    }
  },
})
