// @local/kybernos-skills — client for the full flow (Yours · Discover · Team).
//
// Single mechanism ARB-1: this module injects itself into the 'main.kybernos-skills' slot
// published by the kybernos pivot (batch B4) — no peer export, no require bridge.
//
// Frozen contracts consumed (host: kybernos-skills/index.js):
//   GET  /kybernos-skills/skills            -> { ok, skills[], roots[], complete }
//   GET  /kybernos-skills/status            -> { ok, roots[{path,source,exists}] }
//   GET  /kybernos-skills/index[?view=&page=&perPage=] -> { ok, total, hasMore, skills[] }
//   GET  /kybernos-skills/search[?q=]        -> { ok, count, durationMs, skills[] }
//   GET  /kybernos-skills/curated            -> { ok, owners[{owner,skills[]}], totalSkills }
//   GET  /kybernos-skills/audit[?source=&skill=] -> { ok, audits[{provider,status,summary}] }
//   POST /kybernos-skills/toggle  {root,name,active}
//   POST /kybernos-skills/create  {root,name,description,whenToUse,body,modelInvocable}
//   POST /kybernos-skills/install {source,name,root}
//   POST /kybernos-skills/skill/read {root,name} -> { ok, text, folder, file, files, actions{reveal,edit,duplicate,delete} }   (the panel of Yours)
//   POST /kybernos-skills/skill/reveal {root,name,target:'folder'|'file'} · /skill/duplicate {root,name} · /skill/delete {root,name}
//   GET  /kybernos-skills/preview?source=&name= -> { ok, found, folder, description, text, url }   (the panel of Discover)
//   Team (docs/dev/team-skills-contract.md): GET /kybernos-cloud/team/skills[?view=] · /item?id= · POST …/add · …/review · …/retire · …/delete,
//   and on the disk side POST /kybernos-skills/team/pack {root,name} · /team/install {root,name,version,files,teamId,replace}
//
// Rendering faithful to docs/handoff/skills-ui/maquette.html: Yours/Discover segment, toolbar
// (search, filters, sort, Add), Featured row, grid, pagination, a panel on the right of the list
// for the open skill (Yours: its real SKILL.md and actions; Discover: its own repository, folder and text),
// modals. The style rules are the mockup's, VERBATIM, with two exceptions:
// (1) they are scoped under `.kbs-root`, so that none of them can touch the
// rest of the GUI; (2) the ones whose selector exists identically in the pivot
// (kb8-card, kb8-grid, kb8-tile, kb8-pill, kb8-page…) are dropped — the pivot stays
// owner of its design system.
window.__ModuleLoader__.load({
  id: '@local/kybernos-skills',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── icons: Lucide paths verbatim from maquette.html:223-248 ─────────────
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
        check: ['M20 6 9 17l-5-5'],
        dl: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
        github: ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'],
        wand: ['m15 4-1 1', 'm9 9-1 1', 'M4 20l10.5-10.5a2.1 2.1 0 0 0-3-3L1 17l3 3z', 'm14 7 3 3', 'M14.5 3.5 15 3', 'M19 9l.5-.5'],
        info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
        star: ['M11.5 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z'],
        folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 1 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
        code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
        lock: ['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
        file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
        refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
        globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z']
      }
      const icon = (name, size) => h('svg', {
        key: 'i' + name + size,
        width: size || 16, height: size || 16, viewBox: '0 0 24 24', 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
      }, (PATHS[name] || PATHS.pkg).map((d, i) => h('path', { key: i, d })))

      // ── mockup utilities (:252-258) ────────────────────────────────
      const hue = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x }
      const tile = (name, ic, cls) => {
        const u = hue(String(name))
        // `kbs-sm`: the tile of a table ROW. Same visual language as the cards of the other
        // tabs, simply at the scale of a row. Without it, Discover looked like a raw table
        // dropped next to the rest of the interface.
        const taille = cls === 'lg' ? 22 : (cls === 'kbs-sm' ? 15 : 18)
        return h('span', {
          className: 'kb8-tile' + (cls ? ' ' + cls : ''),
          style: { background: 'hsl(' + u + ' 42% 17%)', color: 'hsl(' + u + ' 72% 72%)', border: '1px solid hsl(' + u + ' 40% 26%)' }
        }, icon(ic || 'pkg', taille))
      }
      // The mockup only had small numbers: its format broke beyond a million
      // (“3476k” for 3,476,000). The real index goes past a million from its very first row.
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
        'err.preview': { fr: 'Aperçu impossible.', en: 'Preview failed.' },
        'err.feat': { fr: 'mise en avant impossible', en: 'could not update Featured' },
        'err.index': { fr: 'index indisponible', en: 'index unavailable' },
        'err.noanswer': { fr: 'la route /kybernos-skills/ ne répond pas', en: 'the /kybernos-skills/ route is not responding' },
        'err.audit': { fr: 'audit indisponible', en: 'audit unavailable' },
        'err.create': { fr: 'création impossible', en: 'creation failed' },
        'err.install': { fr: 'installation impossible', en: 'installation failed' },
        'he.root_not_allowed': { fr: 'Ce dossier n’est pas l’un de tes dossiers de skills modifiables.', en: 'That folder is not one of your writable skills folders.' },
        'he.invalid_name': { fr: 'Nom invalide : minuscules, chiffres et tirets, sans accent.', en: 'Invalid name: lowercase letters, digits and hyphens, no accents.' },
        'he.name_too_long': { fr: 'Nom trop long ({max} caractères au plus).', en: 'Name too long ({max} characters at most).' },
        'he.active_required': { fr: 'L’état à appliquer (actif ou non) est absent.', en: 'The state to apply (on or off) is missing.' },
        'he.skill_not_found': { fr: 'Skill introuvable.', en: 'Skill not found.' },
        'he.skill_ambiguous': { fr: 'Plusieurs dossiers portent ce nom : impossible de choisir.', en: 'Several folders have this name: cannot choose.' },
        'he.double_marker': { fr: 'SKILL.md et SKILL.md.disabled existent tous deux : état ambigu, rien n’a été renommé.', en: 'Both SKILL.md and SKILL.md.disabled exist: the state is ambiguous, nothing was renamed.' },
        'he.path_outside_root': { fr: 'Chemin hors du dossier de skills : refusé.', en: 'Path outside the skills folder: refused.' },
        'he.real_path_outside_root': { fr: 'Le chemin réel sort du dossier de skills : refusé.', en: 'The real path leaves the skills folder: refused.' },
        'he.timeout': { fr: 'Délai dépassé.', en: 'Timed out.' },
        'he.network_unavailable': { fr: 'Réseau indisponible.', en: 'Network unavailable.' },
        'he.index_url_refused': { fr: 'Adresse de l’index refusée : https, ou http sur cette machine ; sans identifiant, sans paramètres.', en: 'Index address refused: https, or http on this machine; no credentials, no parameters.' },
        'he.index_url_env': { fr: 'L’adresse est imposée par la variable KYBERNOS_SKILLS_INDEX_URL : modifie-la là.', en: 'The address is set by the KYBERNOS_SKILLS_INDEX_URL variable: change it there.' },
        'he.index_unavailable': { fr: 'L’index n’a pas répondu (HTTP {http}).', en: 'The index did not answer (HTTP {http}).' },
        'he.query_too_short': { fr: 'Recherche : au moins 2 caractères.', en: 'Search: at least 2 characters.' },
        'he.invalid_source': { fr: 'Source invalide (attendu : propriétaire/dépôt).', en: 'Invalid source (expected owner/repo).' },
        'he.not_github': { fr: 'Source non GitHub ({source}) : cette route n’installe que depuis un dépôt GitHub.', en: 'Not a GitHub source ({source}): this route only installs from a GitHub repository.' },
        'he.github_rate_limited': { fr: 'GitHub limite les lectures anonymes (HTTP {http}) : réessaie plus tard.', en: 'GitHub is limiting anonymous reads (HTTP {http}): try again later.' },
        'he.not_found': { fr: 'Ce skill n\'est plus dans le catalogue : recharge la liste.', en: 'That skill is no longer in the catalogue: reload the list.' },
        'he.not_writable': { fr: 'Ce skill n\'est pas dans l\'un de tes dossiers de skills modifiables : il n\'est pas supprimé.', en: 'That skill is not in one of your writable skills folders: it is not deleted.' },
        'he.not_a_folder': { fr: 'Ce skill n\'est pas un dossier (un simple fichier .md) : cette action ne s\'applique pas.', en: 'That skill is not a folder (a single .md file): this action does not apply.' },
        'he.is_link': { fr: 'Ce dossier est un lien : le registre de DSH ignore les liens, et rien n\'est touché.', en: 'That folder is a link: the DSH registry ignores links, and nothing was touched.' },
        'he.delete_failed': { fr: 'Le dossier n\'a pas pu être supprimé (droits ?).', en: 'The folder could not be deleted (permissions?).' },
        'he.no_copy_name': { fr: 'Il y a déjà trop de copies de ce skill : supprime-en une.', en: 'There are already too many copies of that skill: delete one.' },
        'he.opener_unavailable': { fr: 'Aucun programme pour l\'ouvrir sur cet ordinateur.', en: 'No program to open it with on this computer.' },
        'he.not_local': { fr: 'DSH tourne sur une autre machine : rien ne s\'ouvre ici.', en: 'DSH runs on another machine: nothing opens here.' },
        'he.already_installed': { fr: 'Un skill de ce nom est déjà installé dans ce dossier.', en: 'A skill with this name is already installed in this folder.' },
        'he.repo_not_found': { fr: 'Dépôt introuvable : {source}.', en: 'Repository not found: {source}.' },
        'he.download_failed': { fr: 'Téléchargement impossible (HTTP {http}).', en: 'Download failed (HTTP {http}).' },
        'he.tar_missing': { fr: 'tar est introuvable sur cette machine : extraction impossible.', en: 'tar is not available on this machine: cannot extract.' },
        'he.archive_unreadable': { fr: 'Archive illisible.', en: 'Unreadable archive.' },
        'he.skill_not_in_repo': { fr: 'Skill « {name} » introuvable dans {source}.', en: 'Skill “{name}” not found in {source}.' },
        'he.repo_ambiguous': { fr: '{count} dossiers de {source} portent ce nom.', en: '{count} folders of {source} have this name.' },
        'he.copy_incomplete': { fr: 'Copie incomplète : SKILL.md absent.', en: 'Incomplete copy: SKILL.md is missing.' },
        'he.description_required': { fr: 'Une description est requise.', en: 'A description is required.' },
        'he.description_too_long': { fr: 'Description trop longue ({max} caractères au plus).', en: 'Description too long ({max} characters at most).' },
        'he.exists': { fr: 'Un skill de ce nom existe déjà dans ce dossier.', en: 'A skill with this name already exists in this folder.' },
        'he.write_failed': { fr: 'Écriture impossible dans {dest}.', en: 'Could not write to {dest}.' },
        'he.origin_refused': { fr: 'Origine refusée.', en: 'Origin refused.' },
        'he.request_failed': { fr: 'Requête impossible.', en: 'The request failed.' },
        'he.body_too_large': { fr: 'Requête trop volumineuse.', en: 'The request is too large.' },
        'he.root_missing': { fr: 'Le dossier est absent de la requête.', en: 'The folder is missing from the request.' },
        'he.skill_not_in_registry': { fr: 'Skill introuvable dans le registre.', en: 'Skill not found in the registry.' },
        'notice.featOn': { fr: '« {name} » mis en avant (Featured)', en: '“{name}” added to Featured' },
        'notice.featOff': { fr: '« {name} » retiré de Featured', en: '“{name}” removed from Featured' },
        'notice.off': { fr: '« {name} » désactivé', en: '“{name}” disabled' },
        'notice.on': { fr: '« {name} » activé', en: '“{name}” enabled' },
        'notice.created': { fr: '« {name} » créé et actif', en: '“{name}” created and active' },
        'notice.installed': { fr: '« {name} » installé', en: '“{name}” installed' },
        'notice.files': { fr: ' — {n} fichiers', en: ' — {n} files' },
        'notice.files.1': { fr: ' — 1 fichier', en: ' — 1 file' },
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
        'src.search.1': { fr: '1 résultat affiché sur {total} — API skills.sh, {ms}', en: '1 result shown of {total} — skills.sh API, {ms}' },
        'src.unknownDur': { fr: 'durée inconnue', en: 'unknown duration' },
        'src.curated': { fr: '{n} skills first-party répartis sur {o} propriétaires — généré le {d}', en: '{n} first-party skills across {o} owners — generated {d}' },
        'src.index': { fr: '{n} skills classés — API officielle skills.sh, vue « {v} »', en: '{n} skills ranked — official skills.sh API, “{v}” view' },
        'src.index.1': { fr: '1 skill classé — API officielle skills.sh, vue « {v} »', en: '1 skill ranked — official skills.sh API, “{v}” view' },
        'add.create': { fr: 'Créer un skill', en: 'Create a skill' },
        'add.install': { fr: 'Installer un skill', en: 'Install a skill' },
        'add.github': { fr: 'Importer depuis GitHub', en: 'Import from GitHub' },
        'add.search': { fr: 'Chercher dans l\'index', en: 'Search the index' },
        'add.manual': { fr: 'Installer à la main (owner/repo)', en: 'Install manually (owner/repo)' },
        'add.top': { fr: 'Voir les plus installés', en: 'See the most installed' },
        'ph.yours': { fr: 'Rechercher un skill…', en: 'Search skills…' },
        'ph.discover': { fr: 'Chercher dans les skills (nom et description)…', en: 'Search skills (name and description)…' },
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
        'mod.unknown': { fr: 'date inconnue', en: 'unknown date' },
        'card.copyTitle': { fr: 'Copier l\'invocation à coller dans le composeur', en: 'Copy the invocation to paste in the composer' },
        'cover.alt': { fr: 'Illustration de {name}', en: 'Illustration for {name}' },
        // Featured tab: the picks Kybernos proposes
        'cap.featured': { fr: 'Les choix de Kybernos : chacun s’installe en un clic et montre ce que disent ses audits de sécurité.', en: 'Picked by Kybernos: each one installs in one click and shows what its security audits said.' },
        'ph.featured': { fr: 'Chercher un skill, une tâche, un auteur…', en: 'Search a skill, a task, an author…' },
        'pick.all': { fr: 'Tous', en: 'All' },
        'sort.editorial': { fr: 'Ordre éditorial', en: 'Editorial order' },
        'pcat.Documents': { fr: 'Documents', en: 'Documents' },
        'pcat.Data': { fr: 'Données', en: 'Data' },
        'pcat.Design': { fr: 'Design', en: 'Design' },
        'pcat.Media': { fr: 'Médias', en: 'Media' },
        'pcat.Research': { fr: 'Recherche', en: 'Research' },
        'pcat.Marketing': { fr: 'Marketing', en: 'Marketing' },
        'pcat.Automation': { fr: 'Automatisation', en: 'Automation' },
        'pcat.Build': { fr: 'Construire', en: 'Build' },
        'pick.audited': { fr: 'Audité · {n}', en: 'Audited · {n}' },
        'pick.warn1': { fr: '1 alerte', en: '1 warning' },
        'pick.warnN': { fr: '{n} alertes', en: '{n} warnings' },
        'pick.auditTip': { fr: 'Verdicts des audits skills.sh', en: 'skills.sh audit verdicts' },
        'need.firecrawl': { fr: 'Demande une clé Firecrawl', en: 'Needs a Firecrawl key' },
        'need.tavily': { fr: 'Demande un compte Tavily', en: 'Needs a Tavily account' },
        'need.google': { fr: 'Demande une connexion Google', en: 'Needs a Google sign-in' },
        'pick.installed': { fr: 'Installé', en: 'Installed' },
        'pick.use': { fr: 'Utiliser', en: 'Use' },
        'pick.details': { fr: 'Détails', en: 'Details' },
        'pick.by': { fr: 'Créé par {who}', en: 'Created by {who}' },
        'pick.count': { fr: '{n} installations', en: '{n} installs' },
        'pick.count.1': { fr: '1 installation', en: '1 install' },
        'pick.try': { fr: 'Essaie', en: 'Try asking' },
        'pick.pinNeedsInstall': { fr: 'Installe ce skill pour l’épingler', en: 'Install this skill to pin it' },
        'pick.bg': { fr: 'Fond des couvertures', en: 'Cover background' },
        'pick.bg.tint': { fr: 'Teinte', en: 'Tint' },
        'pick.bg.plain': { fr: 'Neutre', en: 'Plain' },
        'pick.loading': { fr: 'Chargement des choix…', en: 'Loading the picks…' },
        'pick.none': { fr: 'Aucun skill ne correspond', en: 'No skill matches' },
        'pick.nonehint': { fr: 'Essaie une autre catégorie ou efface la recherche.', en: 'Try another category or clear the search.' },
        'pick.asof': { fr: 'Choix et verdicts d’audit relevés le {d}.', en: 'Picks and audit verdicts read on {d}.' },
        'pick.crumb': { fr: 'Choix de Kybernos', en: 'Featured' },
        'pick.back': { fr: 'Retour à Featured', en: 'Back to Featured' },
        'pick.copyPrompt': { fr: 'Copier avec /nom', en: 'Copy with /name' },
        'pick.facts': { fr: 'Le skill', en: 'The skill' },
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
        'd.direct': { fr: 'L\'installation directe reste possible par « Importer depuis GitHub ».', en: 'Direct install is still possible via “Import from GitHub”.' },
        'd.hint': { fr: 'C’est souvent passager : réessaie dans un instant. Tes skills installés et l’onglet Team ne sont pas touchés.', en: 'This is often temporary: try again in a moment. Your installed skills and the Team tab are not affected.' },
        'd.retry': { fr: 'Réessayer', en: 'Try again' },
        // The source the Discover index is read from (the relay), and the setting that names another one.
        'src.line': { fr: 'Source', en: 'Source' },
        'src.default': { fr: 'relais Kybernos (par défaut)', en: 'Kybernos relay (default)' },
        'src.custom': { fr: 'adresse personnalisée', en: 'custom address' },
        'src.env': { fr: 'imposée par KYBERNOS_SKILLS_INDEX_URL', en: 'set by KYBERNOS_SKILLS_INDEX_URL' },
        'src.refused': { fr: 'adresse refusée', en: 'address refused' },
        'src.change': { fr: 'Changer', en: 'Change' },
        'src.title': { fr: 'Source de l’index', en: 'Index source' },
        'src.what': { fr: 'Une source est l’endroit où l’onglet Discover lit sa liste de skills publics. Par défaut, c’est le relais Kybernos : une copie en lecture seule de l’index skills.sh, rafraîchie environ toutes les heures, donc sans compte ni clé.', en: 'A source is where the Discover tab reads its list of public skills from. The default is the Kybernos relay: a read-only copy of the skills.sh index, refreshed about every hour, so no account or key is needed.' },
        'src.sub': { fr: 'Aucun identifiant n’est envoyé, et la réponse est bornée en taille.', en: 'No credential is sent, and the answer is capped in size.' },
        'src.field': { fr: 'Adresse du relais', en: 'Relay address' },
        'src.hint': { fr: 'https://… (ou http://localhost… pour un essai sur cette machine). Laisse vide pour le relais Kybernos.', en: 'https://… (or http://localhost… for a test on this machine). Leave empty for the Kybernos relay.' },
        'src.envnote': { fr: 'La variable d’environnement KYBERNOS_SKILLS_INDEX_URL décide de l’adresse : elle prime sur ce réglage. Modifie-la là pour changer de source.', en: 'The KYBERNOS_SKILLS_INDEX_URL environment variable decides the address: it overrides this setting. Change it there to change the source.' },
        'src.reset': { fr: 'Utiliser le relais Kybernos', en: 'Use the Kybernos relay' },
        'src.save': { fr: 'Enregistrer', en: 'Save' },
        'src.saving': { fr: 'Enregistrement…', en: 'Saving…' },
        'src.savedCustom': { fr: 'Source de l’index : {host}', en: 'Index source: {host}' },
        'src.savedDefault': { fr: 'Source de l’index : relais Kybernos', en: 'Index source: Kybernos relay' },
        'err.source': { fr: 'enregistrement impossible', en: 'could not save' },
        // ── Settings page « Skills » (catalogue): the routes that decide where skills come from ──
        'set.nav': { fr: 'Compétences', en: 'Skills' },
        'set.h1': { fr: 'Compétences', en: 'Skills' },
        'set.lead': { fr: 'D’où viennent les skills de ce profil : la source de l’index (Discover) et les dossiers dans lesquels les installations sont écrites.', en: 'Where this profile’s skills come from: the index source (Discover) and the folders installs are written to.' },
        'set.srcH': { fr: 'Source de l’index', en: 'Index source' },
        'set.srcMissing': { fr: 'La route /kybernos-skills/index-source ne répond pas sur cet hôte.', en: 'The /kybernos-skills/index-source route is not answering on this host.' },
        'set.rootsH': { fr: 'Dossiers modifiables', en: 'Writable folders' },
        'set.rootsSub': { fr: 'La création et l’installation de skills s’écrivent uniquement dans ces dossiers.', en: 'Skill creation and installs are written only to these folders.' },
        'set.rootExists': { fr: 'présent', en: 'present' },
        'set.rootMissing': { fr: 'à créer', en: 'will be created' },
        'set.rootWrite': { fr: 'écriture', en: 'write' },
        'set.rootRead': { fr: 'lecture seule', en: 'read-only' },
        'set.rootsMissing': { fr: 'La route /kybernos-skills/status ne répond pas sur cet hôte.', en: 'The /kybernos-skills/status route is not answering on this host.' },
        'set.countsH': { fr: 'Aperçu du profil', en: 'Profile at a glance' },
        'set.installed': { fr: 'skills installés', en: 'skills installed' },
        'set.active': { fr: 'actifs', en: 'active' },
        'set.disabled': { fr: 'désactivés', en: 'disabled' },
        'set.featured': { fr: 'mis en avant', en: 'featured' },
        'th.result': { fr: 'RÉSULTAT', en: 'RESULT' },
        'th.state': { fr: 'ÉTAT', en: 'STATE' },
        'd.empty.search': { fr: 'Essaie un autre terme (au moins 2 caractères).', en: 'Try another term (at least 2 characters).' },
        'd.empty.page': { fr: 'Cette page est vide.', en: 'This page is empty.' },
        'btn.install': { fr: 'Installer', en: 'Install' },
        'det.unknownSrc': { fr: 'source inconnue', en: 'unknown source' },
        'det.whatBody': { fr: 'Installer télécharge l\'archive du dépôt {source} depuis GitHub, y trouve le dossier du skill « {name} » (son frontmatter porte name et description), puis le COPIE dans ton dossier de skills ({dest}). Le skill y est actif au prochain tour de tes agents. Aucun lien symbolique : le registre de DSH ignore les liens, un skill lié serait installé sans jamais apparaître. Rien d\'autre n\'est écrit.', en: 'Installing downloads the archive of the {source} repository from GitHub, finds the “{name}” skill folder inside it (its frontmatter carries name and description), then COPIES it into your skills folder ({dest}). The skill is available to your agents on their next turn. No symlinks: the DSH registry ignores links, so a linked skill would be installed without ever showing up. Nothing else is written.' },
        'det.installTip': { fr: 'Télécharge {source} depuis GitHub et copie le skill « {name} » dans ton dossier de skills ({dest}) : disponible pour tes agents au prochain tour.', en: 'Downloads {source} from GitHub and copies the “{name}” skill into your skills folder ({dest}): available to your agents on their next turn.' },
        'det.installHelp': { fr: 'Ce bouton télécharge le dépôt {source} depuis GitHub, y trouve le skill « {name} » puis le copie dans ton dossier de skills ({dest}) — disponible pour tes agents au prochain tour.', en: 'This button downloads the {source} repository from GitHub, finds the “{name}” skill inside it and copies it into your skills folder ({dest}) — available to your agents on their next turn.' },
        'det.row.owner': { fr: 'Publié par', en: 'Published by' },
        'det.row.repo': { fr: 'Dépôt source', en: 'Source repository' },
        'det.row.type': { fr: 'Type de source', en: 'Source type' },
        'det.row.installs': { fr: 'Installations (index)', en: 'Installs (index)' },
        'det.row.page': { fr: 'Page skills.sh', en: 'skills.sh page' },
        'det.rootph': { fr: '<racine>', en: '<root>' },
        'det.local.what': { fr: 'Ce qu\'il fait', en: 'What it does' },
        'det.local.when': { fr: 'Quand l\'utiliser', en: 'When to use it' },
        'det.local.loading': { fr: 'Chargement du contenu réel du skill…', en: 'Loading the skill\'s real contents…' },
        'det.audits': { fr: 'Audits de sécurité — skills.sh', en: 'Security audits — skills.sh' },
        'det.auditLoading': { fr: 'chargement des audits…', en: 'loading audits…' },
        'det.auditNone': { fr: 'aucun audit publié pour ce skill', en: 'no audit published for this skill' },
        'det.audited': { fr: 'audité', en: 'audited' },
        'det.unknown': { fr: 'inconnu', en: 'unknown' },
        'det.root': { fr: 'Dossier', en: 'Folder' },
        'det.modified': { fr: 'Modifié', en: 'Modified' },
        'det.unknownDate': { fr: 'date inconnue', en: 'unknown date' },
        'det.thirdParty': { fr: 'Le contenu vient d\'un dépôt tiers : DSH ne l\'audite pas ; ces verdicts sont ceux publiés par skills.sh.', en: 'The content comes from a third-party repo: DSH does not audit it; these verdicts are the ones published by skills.sh.' },
        'panel.close': { fr: 'Fermer', en: 'Close' },
        'panel.copyPath': { fr: 'Copier le chemin', en: 'Copy the path' },
        'panel.truncated': { fr: 'Fichier long : seul le début est affiché.', en: 'Long file: only the start is shown.' },
        'panel.files': { fr: '{n} fichiers dans le dossier', en: '{n} files in the folder' },
        'panel.files.1': { fr: '1 fichier dans le dossier', en: '1 file in the folder' },
        'act.reveal': { fr: 'Ouvrir le dossier', en: 'Open folder' },
        'act.reveal.tip': { fr: 'Ouvre le dossier du skill sur cet ordinateur', en: 'Opens the skill\'s folder on this computer' },
        'act.edit': { fr: 'Modifier', en: 'Edit' },
        'act.edit.tip': { fr: 'Ouvre SKILL.md dans ton éditeur de texte', en: 'Opens SKILL.md in your text editor' },
        'act.duplicate': { fr: 'Dupliquer', en: 'Duplicate' },
        'act.duplicate.tip': { fr: 'Crée une copie dans ton dossier de skills, sous un nom libre', en: 'Makes a copy in your skills folder, under a free name' },
        'act.delete': { fr: 'Supprimer', en: 'Delete' },
        'act.delete.tip': { fr: 'Supprime le dossier du skill (après confirmation)', en: 'Deletes the skill\'s folder (after you confirm)' },
        'act.readonly': { fr: 'Ce skill est en lecture seule : tu peux l\'ouvrir ou le dupliquer, pas le supprimer.', en: 'This skill is read-only: you can open or duplicate it, not delete it.' },
        'del.title': { fr: 'Supprimer « {name} » ?', en: 'Delete “{name}”?' },
        'del.body': { fr: 'Le dossier {path} et tout ce qu\'il contient sont supprimés pour de bon. Il n\'y a pas de corbeille : cela ne peut pas être annulé.', en: 'The folder {path} and everything in it are deleted for good. There is no trash: this cannot be undone.' },
        'del.deleting': { fr: 'Suppression…', en: 'Deleting…' },
        'notice.deleted': { fr: '« {name} » supprimé.', en: '“{name}” deleted.' },
        'notice.duplicated': { fr: '« {name} » dupliqué : « {copy} » est dans ton dossier de skills.', en: '“{name}” duplicated: “{copy}” is in your skills folder.' },
        'notice.opened': { fr: 'Ouvert sur cet ordinateur.', en: 'Opened on this computer.' },
        'dp.folder': { fr: 'Dossier dans le dépôt', en: 'Folder in the repository' },
        'dp.folderUnknown': { fr: 'trouvé par son frontmatter à l\'installation', en: 'found by its frontmatter when installing' },
        'dp.root': { fr: 'racine du dépôt', en: 'repository root' },
        'dp.loading': { fr: 'Lecture du dépôt sur GitHub…', en: 'Reading the repository on GitHub…' },
        'dp.start': { fr: 'Début de SKILL.md', en: 'Start of SKILL.md' },
        'dp.notfound': { fr: 'Aucun dossier « {name} » dans le dépôt : l\'installation cherche, dans toute l\'archive, le skill dont le frontmatter porte ce nom.', en: 'No “{name}” folder in the repository: the install looks, in the whole archive, for the skill whose frontmatter carries that name.' },
        'dp.nopreview': { fr: 'Aperçu indisponible : {why}', en: 'Preview unavailable: {why}' },
        'dp.viewgh': { fr: 'Voir sur GitHub', en: 'View on GitHub' },
        'ic.title': { fr: 'Installer « {name} » ?', en: 'Install “{name}”?' },
        'ic.repo': { fr: 'Dépôt', en: 'Repository' },
        'ic.folder': { fr: 'Dossier dans l\'archive', en: 'Folder in the archive' },
        'ic.dest': { fr: 'Copié vers', en: 'Copied to' },
        'ic.after': { fr: 'Tu pourras le désactiver ou le supprimer depuis « Yours ».', en: 'You can switch it off or delete it from “Yours”.' },
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
        // ── Team skills (docs/dev/team-skills-contract.md) ──
        'tm.seg': { fr: 'Team', en: 'Team' },
        'cap.team': { fr: 'Les skills que ton équipe a approuvés, partagés avec tous les membres de {ws}.', en: 'Skills your team approved, shared with every member of {ws}.' },
        'tm.v.approved': { fr: 'Approuvés', en: 'Approved' },
        'tm.v.mine': { fr: 'Mes propositions', en: 'My proposals' },
        'tm.v.review': { fr: 'À valider', en: 'To review' },
        'tm.v.retired': { fr: 'Retirés', en: 'Retired' },
        'tm.who.member': { fr: '{ws} · tu es membre · un admin valide ce que tu proposes', en: '{ws} · you are a member · an admin approves what you propose' },
        'tm.who.admin': { fr: '{ws} · tu es admin · les membres ne voient pas encore ce qui est à valider', en: '{ws} · you are an admin · members do not see the review queue yet' },
        'tm.search': { fr: 'Chercher dans les skills de l’équipe', en: 'Search team skills' },
        'tm.propose': { fr: 'Proposer un skill', en: 'Propose a skill' },
        'tm.add': { fr: 'Ajouter un skill', en: 'Add a skill' },
        'tm.th.skill': { fr: 'SKILL', en: 'SKILL' },
        'tm.th.by': { fr: 'AJOUTÉ PAR', en: 'ADDED BY' },
        'tm.th.version': { fr: 'VERSION', en: 'VERSION' },
        'tm.install': { fr: 'Installer', en: 'Install' },
        'tm.update': { fr: 'Mettre à jour', en: 'Update' },
        'tm.installed': { fr: 'Installé', en: 'Installed' },
        'tm.own': { fr: 'Tu as le tien', en: 'You have your own' },
        'tm.edited': { fr: 'modifié ici', en: 'edited here' },
        'tm.newer': { fr: 'plus récent : {v}', en: 'newer: {v}' },
        'tm.withdraw': { fr: 'Retirer ma proposition', en: 'Withdraw' },
        'tm.retire': { fr: 'Retirer de l’équipe', en: 'Retire from the team' },
        'tm.st.proposed': { fr: 'En attente', en: 'Pending' },
        'tm.st.approved': { fr: 'Approuvé', en: 'Approved' },
        'tm.st.rejected': { fr: 'Refusé', en: 'Rejected' },
        'tm.st.retired': { fr: 'Retiré', en: 'Retired' },
        'tm.loading': { fr: 'Chargement des skills de l’équipe…', en: 'Loading the team’s skills…' },
        'tm.empty.approved': { fr: 'Aucun skill approuvé pour l’instant', en: 'No approved skill yet' },
        'tm.empty.approvedHint': { fr: 'Propose-en un : un admin le valide, puis tout le monde peut l’installer.', en: 'Propose one: an admin reviews it, then everyone can install it.' },
        'tm.empty.mine': { fr: 'Tu n’as rien proposé', en: 'You have not proposed anything' },
        'tm.empty.mineHint': { fr: 'Choisis l’un de tes skills et propose-le à l’équipe.', en: 'Pick one of your skills and propose it to the team.' },
        'tm.empty.review': { fr: 'Rien à valider', en: 'Nothing to review' },
        'tm.empty.reviewHint': { fr: 'Les nouvelles propositions apparaissent ici.', en: 'New proposals show up here.' },
        'tm.empty.retired': { fr: 'Rien n’a été retiré', en: 'Nothing has been retired' },
        'tm.empty.retiredHint': { fr: 'Un skill retiré reste dans l’historique, mais plus personne ne peut l’installer.', en: 'A retired skill stays in the history, but nobody can install it any more.' },
        'tm.lock.plan.t': { fr: 'Les skills d’équipe font partie du plan Team', en: 'Team skills are part of the Team plan' },
        'tm.lock.plan.b': { fr: 'Partage des skills avec les personnes avec qui tu travailles : un membre en propose un, un admin l’approuve, tout le monde l’installe. Tes propres skills restent privés dans Yours.', en: 'Share skills with the people you work with: any member proposes one, an admin approves it, everyone installs it. Your own skills stay private in Yours.' },
        'tm.lock.signin.t': { fr: 'Connecte-toi à Kybernos Cloud pour utiliser les skills d’équipe', en: 'Sign in to Kybernos Cloud to use Team skills' },
        'tm.lock.signin.b': { fr: 'Les skills d’équipe vivent dans l’espace de ton équipe. Connecte ton compte depuis le menu du compte, puis reviens ici.', en: 'Team skills live in your team’s workspace. Connect your account from the account menu, then come back.' },
        'tm.lock.space.t': { fr: 'Passe sur un espace d’équipe', en: 'Switch to a team workspace' },
        'tm.lock.space.b': { fr: 'Les skills d’équipe appartiennent à un espace d’équipe. Ton espace actif n’en est pas un.', en: 'Team skills belong to a team workspace. Your active workspace is not one.' },
        'tm.lock.server.t': { fr: 'Indisponible sur ce serveur', en: 'Not available on this server' },
        'tm.lock.server.b': { fr: 'Ce serveur Kybernos ne propose pas les skills d’équipe.', en: 'This Kybernos server does not offer Team skills.' },
        'tm.lock.reconnect.t': { fr: 'Ta session Kybernos a expiré', en: 'Your Kybernos session has expired' },
        'tm.lock.reconnect.b': { fr: 'Reconnecte ton compte, puis rouvre cet onglet.', en: 'Reconnect your account, then reopen this tab.' },
        'tm.lock.net.t': { fr: 'Le serveur de l’équipe est injoignable', en: 'The team server cannot be reached' },
        'tm.lock.net.b': { fr: 'Vérifie ta connexion, puis réessaie.', en: 'Check your connection, then try again.' },
        'tm.lock.other.t': { fr: 'Les skills d’équipe ne répondent pas', en: 'Team skills are not answering' },
        'tm.retry': { fr: 'Réessayer', en: 'Try again' },
        'tm.back': { fr: 'Retour à Yours', en: 'Back to Yours' },
        'tm.seePlan': { fr: 'Voir le plan Team', en: 'See the Team plan' },
        'tm.det.back': { fr: 'Skills d’équipe', en: 'Team skills' },
        'tm.det.approvedBy': { fr: 'Ajouté par {a} le {d}, approuvé par {r}.', en: 'Added by {a} on {d}, approved by {r}.' },
        'tm.det.proposedBy': { fr: 'Proposé par {a} le {d}.', en: 'Proposed by {a} on {d}.' },
        'tm.det.files': { fr: 'Ce qui sera copié', en: 'What gets copied' },
        'tm.det.count': { fr: '{n} fichiers · {size}', en: '{n} files · {size}' },
        'tm.det.count.1': { fr: '1 fichier · {size}', en: '1 file · {size}' },
        'cap.teamLocked': { fr: 'Les skills partagés par ton équipe.', en: 'Skills shared by your team.' },
        'tm.det.entry': { fr: 'entrée', en: 'entry' },
        'tm.det.pick': { fr: 'Choisis un fichier pour le lire.', en: 'Pick a file to read it.' },
        'tm.det.loading': { fr: 'Chargement des fichiers…', en: 'Loading the files…' },
        'tm.det.into': { fr: 'Dans', en: 'Into' },
        'tm.det.checks': { fr: 'Vérifié avant toute écriture', en: 'Checked before anything is written' },
        'tm.det.chk1': { fr: 'Les fichiers donnent la version {v}, celle que ton admin a approuvée', en: 'The files hash to version {v}, the one your admin approved' },
        'tm.det.chk2': { fr: 'Chaque chemin reste dans le dossier du skill', en: 'Every path stays inside the skill folder' },
        'tm.det.chk3': { fr: 'Fichiers texte seulement, aucun secret', en: 'Text files only, no secret' },
        'tm.det.never': { fr: 'Si un skill de ce nom existe déjà à cet endroit, rien n’est écrasé : on te le dit, et tu choisis.', en: 'If a skill with this name already exists there, nothing is overwritten: you are told, and you choose.' },
        'tm.det.updateNote': { fr: 'Cela remplace ta version installée ({old}), car tu ne l’as pas modifiée.', en: 'This replaces your installed version ({old}), because you have not edited it.' },
        'tm.det.editedNote': { fr: 'Tu as modifié ce skill ici : il ne sera pas remplacé. Mets tes changements de côté, puis mets à jour.', en: 'You edited this skill here, so it will not be replaced. Move your changes aside, then update.' },
        'tm.det.ownNote': { fr: 'Tu as déjà un skill de ce nom qui ne vient pas de l’équipe : il ne sera pas touché. Renomme-le ou supprime-le pour installer celui de l’équipe.', en: 'You already have a skill with this name that is not from the team: it will not be touched. Rename or remove it to install the team’s.' },
        'tm.det.installedNote': { fr: 'Cette version est déjà installée.', en: 'This version is already installed.' },
        'tm.det.notApproved': { fr: 'Ce skill n’est pas (ou plus) approuvé : il ne peut pas être installé.', en: 'This skill is not (or no longer) approved: it cannot be installed.' },
        'tm.det.retireAsk': { fr: 'Retirer « {name} » ? Ceux qui l’ont installé gardent leur copie, personne d’autre ne pourra l’installer.', en: 'Retire “{name}”? Members who installed it keep their copy, nobody else can install it.' },
        'tm.det.retireYes': { fr: 'Retirer', en: 'Retire' },
        'tm.script': { fr: 'contient un script', en: 'contains a script' },
        'tm.p.title': { fr: 'Proposer un skill à {ws}', en: 'Propose a skill to {ws}' },
        'tm.p.titleAdmin': { fr: 'Ajouter un skill à {ws}', en: 'Add a skill to {ws}' },
        'tm.p.sub': { fr: 'Un admin le relit avant que quiconque puisse l’installer. Ta copie reste exactement telle quelle.', en: 'An admin reviews it before anyone can install it. Your own copy stays exactly as it is.' },
        'tm.p.subAdmin': { fr: 'En tant qu’admin, ton skill est disponible pour tous les membres tout de suite. Ta copie reste exactement telle quelle.', en: 'As an admin, your skill is available to every member right away. Your own copy stays exactly as it is.' },
        'tm.p.pick': { fr: 'Skill', en: 'Skill' },
        'tm.p.choose': { fr: 'Choisis l’un de tes skills', en: 'Choose one of your skills' },
        'tm.p.none': { fr: 'Aucun de tes skills ne peut être partagé : seuls ceux de tes dossiers (~/.dsh/skills, ~/.agents/skills) peuvent être proposés.', en: 'None of your skills can be shared: only skills of your own folders (~/.dsh/skills, ~/.agents/skills) can be proposed.' },
        'tm.p.packing': { fr: 'Lecture du skill…', en: 'Reading the skill…' },
        'tm.p.send': { fr: 'Ce qui sera envoyé', en: 'What will be sent' },
        'tm.p.checks': { fr: 'Contrôles', en: 'Checks' },
        'tm.p.ck.name': { fr: 'Nom valide', en: 'Name valid' },
        'tm.p.ck.text': { fr: 'Fichiers texte seulement', en: 'Text files only' },
        'tm.p.ck.secret': { fr: 'Aucun secret trouvé', en: 'No secret found' },
        'tm.p.ck.size': { fr: '{n} fichiers sur 50 · {kb} Ko sur 1 Mo', en: '{n} of 50 files · {kb} KB of 1 MB' },
        'tm.p.note': { fr: 'Note pour l’admin (facultatif)', en: 'Note for the admin (optional)' },
        'tm.p.noteAdmin': { fr: 'Note (facultatif)', en: 'Note (optional)' },
        'tm.p.submit': { fr: 'Proposer à l’équipe', en: 'Propose to the team' },
        'tm.p.submitAdmin': { fr: 'Ajouter à l’équipe', en: 'Add to the team' },
        'tm.p.sending': { fr: 'Envoi…', en: 'Sending…' },
        'tm.p.foot': { fr: 'Les mêmes contrôles sont refaits sur le serveur : un skill qui passe ici ne sera pas refusé plus tard pour ces raisons.', en: 'The same checks run again on the server, so a skill that passes here cannot be refused later for these reasons.' },
        'tm.p.bad.secret': { fr: '{file}, ligne {line} : cela ressemble à une clé ou un jeton secret. Retire-le du fichier, puis propose à nouveau. La clé elle-même n’est jamais affichée ni envoyée.', en: '{file}, line {line}: this looks like a secret key or token. Remove it from the file, then propose again. The key itself is never shown or sent.' },
        'tm.p.bad.binary': { fr: '{file} : seuls les fichiers texte peuvent être partagés. Retire-le, ou mentionne-le dans SKILL.md.', en: '{file}: only text files can be shared. Remove it, or mention it in SKILL.md instead.' },
        'tm.p.bad.big': { fr: '{file} dépasse 256 Ko.', en: '{file} is over 256 KB.' },
        'tm.p.bad.many': { fr: 'Plus de 50 fichiers.', en: 'More than 50 files.' },
        'tm.p.bad.total': { fr: 'Plus de 1 Mo au total.', en: 'Over 1 MB in total.' },
        'tm.p.bad.path': { fr: '{file} : ce nom de fichier ne peut pas être partagé (lettres, chiffres, - _ . et / seulement ; pas de nom que Windows ne sait pas écrire, pas deux noms qui ne diffèrent que par la casse, pas un fichier qui est aussi un dossier).', en: '{file}: this file name cannot be shared (letters, digits, - _ . and / only; no name Windows cannot write, no two names that differ only by case, no file that is also a folder).' },
        'tm.p.bad.frontmatter': { fr: 'SKILL.md doit porter le même nom que le dossier et une description.', en: 'SKILL.md needs a name that matches the folder and a description.' },
        'tm.p.bad.description': { fr: 'La description de SKILL.md contient un caractère qui ne peut pas être enregistré.', en: 'The description in SKILL.md holds a character that cannot be stored.' },
        'tm.p.bad.name': { fr: 'Le nom du skill n’est pas valide.', en: 'The skill name is not valid.' },
        'tm.p.bad.nofile': { fr: 'Il manque un fichier SKILL.md.', en: 'There is no SKILL.md.' },
        'tm.p.bad.disabled': { fr: 'Active d’abord le skill.', en: 'Turn the skill on first.' },
        'tm.p.bad.other': { fr: 'Ce skill ne peut pas être partagé ({code}).', en: 'This skill cannot be shared ({code}).' },
        'tm.n.proposed': { fr: 'Proposé à l’équipe. Un admin relira « {name} ».', en: 'Proposed to the team. An admin will review “{name}”.' },
        'tm.n.added': { fr: '« {name} » est maintenant disponible pour l’équipe.', en: '“{name}” is now available to the team.' },
        'tm.n.installed': { fr: '« {name} » installé ({n} fichiers).', en: '“{name}” installed ({n} files).' },
        'tm.n.installed.1': { fr: '« {name} » installé (1 fichier).', en: '“{name}” installed (1 file).' },
        'tm.n.updated': { fr: '« {name} » mis à jour.', en: '“{name}” updated.' },
        'tm.n.approved': { fr: '« {name} » approuvé.', en: '“{name}” approved.' },
        'tm.n.rejected': { fr: '« {name} » refusé.', en: '“{name}” rejected.' },
        'tm.n.retired': { fr: '« {name} » retiré de l’équipe.', en: '“{name}” retired from the team.' },
        'tm.n.withdrawn': { fr: 'Proposition retirée.', en: 'Proposal withdrawn.' },
        'tm.e.admin_required': { fr: 'Seul un admin peut faire cela.', en: 'Only an admin can do that.' },
        'tm.e.duplicate': { fr: 'Ce skill est déjà proposé ou approuvé.', en: 'This skill is already proposed or approved.' },
        'tm.e.team_full': { fr: 'L’équipe a déjà le nombre maximal de skills.', en: 'The team already has the maximum number of skills.' },
        'tm.e.too_many_proposals': { fr: 'Tu as déjà le nombre maximal de propositions en attente.', en: 'You already have the maximum number of proposals waiting.' },
        'tm.e.too_large': { fr: 'Le skill est trop volumineux.', en: 'The skill is too large.' },
        'tm.e.not_pending': { fr: 'Quelqu’un a décidé avant toi. La liste a été rafraîchie.', en: 'Someone decided before you. The list has been refreshed.' },
        'tm.e.not_approved': { fr: 'Ce skill n’est plus approuvé.', en: 'It is not approved any more.' },
        'tm.e.skill_not_found': { fr: 'Ce skill n’existe plus.', en: 'This skill no longer exists.' },
        'tm.e.reconnect_required': { fr: 'Ta session Kybernos a expiré : reconnecte ton compte.', en: 'Your Kybernos session has expired: reconnect your account.' },
        'tm.e.network': { fr: 'Le serveur de l’équipe est injoignable.', en: 'The team server cannot be reached.' },
        'tm.e.workspace_not_found': { fr: 'Cet espace d’équipe n’est plus accessible.', en: 'This team workspace is no longer available.' },
        'tm.e.not_on_this_server': { fr: 'Ce serveur ne propose pas les skills d’équipe.', en: 'This server does not offer Team skills.' },
        'tm.e.forbidden': { fr: 'Le serveur a refusé.', en: 'The server refused.' },
        'tm.e.invalid_response': { fr: 'Réponse inattendue du serveur.', en: 'Unexpected answer from the server.' },
        'tm.e.invalid_skill': { fr: 'Le serveur refuse ce skill ({reason}).', en: 'The server refuses this skill ({reason}).' },
        'tm.e.scan_rejected': { fr: 'Le serveur a trouvé un secret dans {file}.', en: 'The server found a secret in {file}.' },
        'tm.e.exists': { fr: 'Un skill de ce nom est déjà dans ce dossier. Rien n’a été modifié.', en: 'A skill with this name is already in this folder. Nothing was changed.' },
        'tm.e.version_mismatch': { fr: 'Les fichiers ne correspondent pas à la version approuvée. Rien n’a été écrit.', en: 'The files do not match the approved version. Nothing was written.' },
        'tm.e.modified': { fr: 'Tu as modifié ce skill ici : il n’a pas été remplacé.', en: 'You edited this skill here, so it was not replaced.' },
        'tm.e.root_not_allowed': { fr: 'Ce dossier n’est pas l’un de tes dossiers de skills.', en: 'That folder is not one of your skills folders.' },
        'tm.e.write_failed': { fr: 'Impossible d’écrire le skill. Rien n’a été modifié.', en: 'Could not write the skill. Nothing was changed.' },
        'tm.e.conflict': { fr: 'Le serveur ne peut pas faire cela maintenant.', en: 'The server cannot do that right now.' },
        'tm.e.bad_request': { fr: 'Le serveur n’a pas compris la demande.', en: 'The server did not understand the request.' },
        'tm.e.skill_ambiguous': { fr: 'Deux skills portent ce nom dans ce dossier.', en: 'Two skills with this name exist in that folder.' },
        'tm.e.other': { fr: 'Échec ({code}).', en: 'Failed ({code}).' },
        'tm.r.banner': { fr: 'Un skill est une instruction que les agents de tes membres suivront, et il peut venir avec des fichiers. Ouvre les fichiers avant d’approuver. Une approbation ne se modifie pas : refuse avec une note pour demander un changement.', en: 'A skill is an instruction your members’ agents will follow, and it can come with files. Open the files before you approve. An approval cannot be edited: reject with a note to ask for a change.' },
        'tm.r.new': { fr: 'Nouveau', en: 'New' },
        'tm.r.updateOf': { fr: 'Mise à jour', en: 'Update' },
        'tm.r.replaces': { fr: 'Approuver remplace la version que les membres peuvent installer aujourd’hui ({v}). Ceux qui l’ont installée verront « Mettre à jour ».', en: 'Approving replaces the version members can install today ({v}). Members who installed it see “Update”.' },
        'tm.r.by': { fr: 'Proposé par {a} · {d}', en: 'Proposed by {a} · {d}' },
        'tm.r.approve': { fr: 'Approuver', en: 'Approve' },
        'tm.r.reject': { fr: 'Refuser…', en: 'Reject…' },
        'tm.r.rejectNote': { fr: 'Pourquoi ? (le proposeur le verra)', en: 'Why? (the proposer will see it)' },
        'tm.r.rejectYes': { fr: 'Refuser', en: 'Reject' },
        'tm.r.changed': { fr: 'modifié', en: 'changed' },
        'tm.r.fnew': { fr: 'nouveau', en: 'new' },
        'tm.r.removed': { fr: 'supprimé', en: 'removed' },
        'tm.r.scan': { fr: 'Contrôlé par le serveur : aucun secret · {n} fichiers · {kb} Ko', en: 'Checked by the server: no secret · {n} files · {kb} KB' },
        'tm.r.scan.1': { fr: 'Contrôlé par le serveur : aucun secret · 1 fichier · {kb} Ko', en: 'Checked by the server: no secret · 1 file · {kb} KB' },
        'tm.r.tooBig': { fr: 'Trop long pour une comparaison ligne à ligne.', en: 'Too long to compare line by line.' },
        'tm.r.rejectedWith': { fr: 'Refusé : {note}', en: 'Rejected: {note}' },
        'tm.r.noNote': { fr: 'Refusé, sans note.', en: 'Rejected, no note.' },
        // The animated help of the page (window.__KB_HELP__.Intro): what it says, and the words of its little mock.
        'intro.title': { fr: 'Les skills en trois étapes', en: 'Skills in three steps' },
        'intro.caption': { fr: 'Un skill est choisi dans Featured, installé en un clic, puis listé dans Yours.', en: 'A skill is picked in Featured, installed with one click, then listed under Yours.' },
        'intro.s1t': { fr: 'Choisis', en: 'Pick one' },
        'intro.s1b': { fr: 'Featured montre nos choix et ce que disent leurs audits de sécurité. Discover classe les skills publics.', en: 'Featured shows our picks and what their security audits said. Discover ranks the public ones.' },
        'intro.s2t': { fr: 'Installe', en: 'Install it' },
        'intro.s2b': { fr: 'Un clic, puis confirme. Le skill est copié sur cet ordinateur.', en: 'One click, then confirm. The skill is copied to this computer.' },
        'intro.s3t': { fr: 'Laisse tes agents s’en servir', en: 'Let your agents use it' },
        'intro.s3b': { fr: 'Il apparaît dans Yours. Tes agents le chargent quand ta demande lui correspond.', en: 'It is listed under Yours. Your agents load it when your request fits it.' },
        'intro.m.row': { fr: 'Documents Word', en: 'Word documents' },
        'intro.m.st1': { fr: 'Featured', en: 'Featured' },
        'intro.m.st2': { fr: 'Installation…', en: 'Installing…' },
        'intro.m.st3': { fr: 'Installé', en: 'Installed' },
        'intro.m.open': { fr: 'Ouvrir', en: 'Open' },
      }
      // Language: what Kybernos resolved. « kybernos » (the French of the product) or fr* is French; every other language, translated
      // or not, and anything unresolved reads English. Read at call time.
      const tlang = () => {
        try {
          const l = String(window.__KB_LANG_RESOLVE__())
          return l === 'kybernos' || l.split(/[-_]/)[0] === 'fr' ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const isEn = () => tlang() === 'en'
      // Text separator, locale-aware: French ' : ', English ': '.
      const sep = () => (isEn() ? ': ' : ' : ')
      // A row can have a « .1 » twin (« 1 file »): it is used when the count {n} is 1.
      const t = (key, vars) => {
        const k = vars !== null && vars !== undefined && vars.n !== undefined && String(vars.n) === '1' && STR[key + '.1'] !== undefined ? key + '.1' : key
        const row = STR[k]
        if (row === null || row === undefined) return key
        const out = tlang() === 'fr' ? row.fr : (row.en !== null && row.en !== undefined ? row.en : row.fr)
        if (vars === null || vars === undefined) return out
        return out.replace(/\{(\w+)\}/g, (m, k2) => (vars[k2] === undefined ? m : String(vars[k2])))
      }
      const PAGE = 6
      // Rows of the Discover ranking per page by default (the user can ask for more in the filters).
      const DISC_PER = 20

      // ── skeleton screens ──────────────────────────────────────────────────────────────────────
      // ONE helper for every list of the GUI, published by the core plugin (window.__KB_SKEL__): bones in the SAME boxes as the
      // real rows (same classes: nothing moves when the data lands), a soft shimmer, a short fade-in for the real rows, and no
      // motion under prefers-reduced-motion. Read at render time and optional: without the core, a list says « Loading… » as before.
      const skel = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }
      const bone = (w, hgt, extra, radius) => { const k = skel(); return k === null ? null : k.bone(w, hgt, extra, radius) }
      // The class suffix that fades the i-th real row in (first screenful only).
      const appear = (i) => { const k = skel(); return k !== null && typeof k.appear === 'function' ? k.appear(i) : '' }
      // `kind`: 'cards' (Yours), 'rows' (the ranking), 'team' (the team table). Null when the core's helper is not there.
      const skeletonOf = (kind, n) => {
        const k = skel()
        if (k === null) return null
        const idx = Array.from({ length: n }, (_, i) => i)
        if (kind === 'cards') {
          return k.wrap(t('y.loading'), '', h('div', { className: 'kb8-grid' }, idx.map((i) => h('div', { key: 'sk' + i, className: 'kb8-card static kb-sk-row' },
            h('div', { className: 'kb-row', style: { minHeight: 40, flexWrap: 'nowrap' } },
              bone(38, 38, null, 13),
              h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '6px', flex: '1' } }, bone(i % 2 === 0 ? '55%' : '40%', 13), bone('45%', 10)),
              bone(36, 20, 'pill'), bone(26, 26, 'round')),
            h('div', { className: 'desc', style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '9px', height: 61, minHeight: 61 } }, bone('94%', 10), bone('82%', 10), bone('58%', 10)),
            h('div', { className: 'kb8-pills', style: { height: 26, alignItems: 'center' } }, bone(52, 20, 'pill')),
            h('div', { className: 'foot', style: { height: 33, boxSizing: 'border-box' } }, bone(14, 14, 'round'), bone(110, 10), h('span', { className: 'grow' }), bone(72, 22, 'pill'))))))
        }
        if (kind === 'team') {
          return k.wrap(t('tm.loading'), 'kbs-table kbt', [
            h('div', { key: 'hd', className: 'kbt-head' }, h('span', null), h('span', null, t('tm.th.skill')), h('span', null, t('tm.th.by')), h('span', null, t('tm.th.version')), h('span', null)),
            idx.map((i) => h('div', { key: 'r' + i, className: 'kbs-row kb-sk-row' },
              h('span', { className: 'who' }, bone(30, 30, null, 10)),
              h('span', { className: 'kbt-name' }, bone(i % 2 === 0 ? '46%' : '34%', 13), bone('70%', 10)),
              h('span', { className: 'kbt-by' }, bone('60%', 11), bone('40%', 10)),
              h('span', { className: 'badges' }, bone(54, 20, 'pill')),
              h('span', { className: 'kbt-act' }, bone(80, 30, null, 9))))])
        }
        return k.wrap(t('d.query'), 'kbs-table', [
          h('div', { key: 'hd', className: 'kbs-head' },
            h('span', { className: 'rank' }, '#'), h('span', { className: 'who' }, 'SKILL'), h('span', { className: 'src' }, 'SOURCE'),
            h('span', { className: 'badges' }, t('th.state')), h('span', { className: 'inst' }, 'INSTALLATIONS')),
          idx.map((i) => h('div', { key: 'r' + i, className: 'kbs-row kb-sk-row' },
            h('span', { className: 'rank' }, bone(18, 10)),
            h('span', { className: 'who' }, bone(30, 30, null, 10), bone(i % 3 === 0 ? '55%' : (i % 3 === 1 ? '40%' : '48%'), 13)),
            h('span', { className: 'src' }, bone('62%', 11)),
            h('span', { className: 'badges' }, bone(50, 20, 'pill')),
            h('span', { className: 'inst' }, bone(36, 11))))])
      }

      const CSS = `
.kbs-root{display:flex;flex-direction:column;flex:1;min-height:0}
/* Third exception to the mockup (see header): the Yours/Discover banner
   was drawn full-frame, with its own margins (22 px) and its own
   scale (46 squares, 43 primary button, 52 core-plugin search). The page is
   already laid out by .kbg-root (30/34 px) and its tabs are 28 px .kb4-tab
   elements: we line up with them — same column, same pill, same scale. */
.kbs-root{gap:16px}
.kbs-root .kbs-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:0 0 auto}
.kbs-root .kbs-top-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.kbs-root .kbs-h1{margin:0;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbs-root .kbs-sub{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:720px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbs-root .kbs-ctlrow{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;min-height:44px;position:relative}
.kbs-root .kbs-ctlrow .kb-toolbar{margin:0;flex:1 1 0;min-width:0;justify-content:flex-end}
.kbs-root .kbs-ctlrow .kb8-search{flex:0 1 260px}
.kbs-root .kbsub{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:0;box-sizing:content-box;background:transparent;border:none}
/* Sub-tab capsule identical to .kb7-subtabs (Connections): discreet container, active one as a raised card. */
.kbs-root .kbsub-group{display:inline-flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.kbs-root .kbsub button.kb-seg{display:inline-flex;align-items:center;gap:8px;height:34px;border:0;border-radius:999px;padding:0 16px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.kbs-root .kbsub button.kb-seg:hover{color:var(--dsw-alias-label-primary)}
.kbs-root .kbsub button.kb-seg.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kbs-root .kbsub .count{font-family:ui-monospace,monospace;font-size:11px;color:inherit;opacity:.95}
/* A phone (A5-05): four tabs with their counts need 395 px in a 332 px strip, and the strip slid sideways with « Team » out of
   sight and no hint that it was there. Tighter tabs and no counts (they are on the pages) need about 295 px: all four fit. */
@media (max-width:440px){
.kbs-root .kbsub button.kb-seg{padding:0 10px;gap:6px}
.kbs-root .kbsub .count{display:none}
}
.kbs-root .kbsub .kb8-mono{flex:1 1 0;min-width:0;text-align:end;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The panel body is injected INSIDE .kbg-root, which already carries the page
   margins (30/34/40). It was taking those of .kb8-page (30/28/36): all the
   content was shifted by 28 px relative to the title and the tabs, and the
   useful column lost 56 px. We cancel these inner margins — the plugin's column
   then joins the page's column.
   The same selector also makes .kb8-page NON-scrolling, and that is deliberate.
   Measured on 21 Sep 2026, Resources tab > Skills, 1400x950 window: the
   panel is bounded by .kbg-root (950 px for 2816 px of content), but
   .kbs-root sits between the two WITHOUT constraining the height (its
   flex:1/min-height:0 assumes a flex parent, whereas .kbg-root is a block). The
   max-height:100% of .kb8-page then resolves against .kbs-root, which is as tall as all the
   content: .kb8-page is 2633 px for 2633 px, so it never overflows while
   remaining a scrolling container (overflow-y:auto). Combined with the
   overscroll-behavior:contain that the core plugin then set on .kb8-page, the
   wheel was consumed there and never bubbled up to .kbg-root: the panel did not
   scroll at all (0 px over 4 wheel notches, whereas the neighbouring Composio
   tab, which has no interposed .kb8-page, scrolled 600 px). We
   hand control back to the only real scroller, .kbg-root: gesture restored, rendering
   unchanged.
   Since then, the core plugin no longer sets contain on page bodies (scroll contract
   in kybernos-plugin/client.js): the gesture would therefore work even
   without this rule. It stays, for two reasons: removing a scrolling container
   that serves no purpose, and making the intent explicit where a future
   panel will sit between a page and its host. */
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
/* LABELLED controls: same styling as the core plugin's .kb6-tb-filterbtn (38 px, radius 11, l1
   border, layer-1 background). The state — active filter, current sort, current view — is read on the button
   instead of being hidden behind a bare icon, as in the rest of the GUI. */
.kbs-root .kb-tool-lab{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto}
.kbs-root .kb-tool-lab:hover,.kbs-root .kb-tool-lab.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.kbs-root .kb-tool-lab .n{min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.kbs-root .kb8-ghost{display:inline-flex;align-items:center;gap:8px;height:38px;background:transparent;color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2);border-radius:11px;padding:0 15px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbs-root .kb8-primary{height:38px;padding:0 14px;font-size:13px;border-radius:11px}
.kbs-root .kb8-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The filters panel followed the mockup as an INLINE CARD: when open, it pushed the
   list down by 145 px and only closed through its own button. The core plugin puts its
   filters in a popover anchored to the button (.kb6-tb-pop): we follow the same convention, while
   keeping the mockup's three rows (View, Rows, Source / State, Root). */
.kbs-root .kb-filters{position:absolute;right:0;top:calc(100% + 6px);z-index:60;display:flex;flex-direction:column;gap:10px;width:min(560px,calc(100vw - 56px));box-sizing:border-box;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 34px rgba(0,0,0,.3)}
.kbs-root .kb-filters .head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 4px}
.kbs-root .kb-filters .head .t{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.kbs-root .kb-filters .head .raz{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:3px 6px;border-radius:7px}
.kbs-root .kb-filters .head .raz:hover{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kb-filter-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.kbs-root .kb-filter-row .lbl{font-size:12px;color:var(--dsw-alias-label-caption);min-width:74px}
.kbs-root .kb8-chip:not(.on):hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Ranking table: one row per skill, not a card. This is what makes an index of
   9 827 rows browsable — fifty rows on screen, and a fixed pager instead of a
   "Load more" buried under 3 380 px of cards. */
/* Same tokens as the core plugin's .kb8-card: bg-layer-1, border-l1, radius 16 — the table must
   read like the other tabs, not like a raw table dropped next to them. */
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
.kbs-root .kbs-instpill{display:inline-flex;align-items:center;gap:5px}
.kbs-root .kbs-rowinstall{height:28px;padding:0 10px;font-size:12px;gap:5px;border-radius:9px;display:inline-flex;align-items:center}
.kbs-root .kbs-sorthead{border:0;background:transparent;padding:0;margin:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer;text-align:start;display:flex;align-items:center;gap:6px}
.kbs-root .kbs-sorthead.inst{justify-content:flex-end}
.kbs-root .kbs-sorthead:hover,.kbs-root .kbs-sorthead.on{color:var(--dsw-alias-label-primary)}
.kbs-root .kbs-sorthead .arr{font-size:12px}
/* ROW tile: row scale, same styling as .kb8-tile (38px / radius 13). */
.kbs-root .kb8-tile.kbs-sm{width:30px;height:30px;border-radius:10px}
/* A row is ~48 px tall: fifty fit in a tab's screen. */
/* A request in flight is visible, without making the previous page disappear. */
.kbs-root .kbs-table.loading{opacity:.55}
/* Pager: current page, total pages, and jumps. No more button at the bottom of a growing list. */
.kbs-root .kbs-pager{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0 2px;flex-wrap:wrap}
.kbs-root .kbs-pager .pg{min-width:38px;height:38px;padding:0 9px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,monospace;font-size:12.5px;cursor:pointer}
.kbs-root .kbs-pager .pg:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbs-pager .pg.on{background:var(--kb-switch-on,#4d7cfe);border-color:transparent;color:#fff;font-weight:600}
.kbs-root .kbs-pager .t{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption)}
/* Audit banner: the data that replaces "community, not audited". */
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
.kbs-root .kbs-ylist{display:flex;flex-direction:column;gap:8px}
.kbs-root .kbs-yrow{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;min-width:0}
.kbs-root .kbs-yrow:hover{border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-yrow.sel{border-color:var(--dsw-alias-brand-primary)}
.kbs-root .kbs-yrow .who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:0 0 230px}
.kbs-root .kbs-yrow .desc{flex:1 1 0;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbs-yrow .when{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.kbs-root .kbs-yrow .acts{flex:none;display:flex;align-items:center;gap:8px}
.kbs-root .kb-pager{display:flex;align-items:center;justify-content:center;gap:16px;padding:6px 0 2px}
.kbs-root .kb-pager .t{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption)}
.kbs-root .kb-sw{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;border:none;flex:0 0 auto;transition:background .15s}
.kbs-root .kb-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s;display:block}
.kbs-root .kb-sw.on{background:var(--kb-switch-on,#4d7cfe)}
.kbs-root .kb-sw.on i{transform:translateX(16px);background:#fff}
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
/* Local skill sheet (a Yours card opens it): its own head and rows, reusing the pivot's tokens. */
.kbs-root .kb-local{display:flex;flex-direction:column;gap:16px;max-width:980px}
.kbs-root .kb-local-tabs{display:flex;gap:8px}
.kbs-root .kb-local-rows{display:flex;flex-direction:column;gap:10px}
.kbs-root .kb-local-rows .row{display:flex;gap:14px;align-items:baseline;font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.kbs-root .kb-local-rows .row>span:first-child{min-width:120px;color:var(--dsw-alias-label-caption);flex:none}
.kbs-root .kb-local-body{margin:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow:auto;max-height:60vh}
/* A card that opens a sheet says so: pointer and hover, instead of the skeleton's static class (cursor:default). */
.kbs-root .kb8-card{cursor:pointer}
.kbs-root .kb8-card:focus-visible{outline:2px solid var(--dsw-alias-border-focus,#4d7cfe);outline-offset:2px}
.kbs-root .kb-menu-wrap{position:relative;display:inline-flex}
/* The three popovers of the panel (Create, Sort, Filters) take the exact tokens of the core plugin's
   .kb6-tb-pop: l1 border, radius 13, shadow 0 14px 34px .3. They used to float higher
   and darker than those of the rest of the GUI. */
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
/* — additions outside the mockup: only what the real flow requires (forms, notices) — */
.kbs-root .kbs-fields{display:flex;flex-direction:column;gap:13px}
.kbs-root .kbs-label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-input,.kbs-root .kbs-area,.kbs-root .kbs-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;padding:10px 12px}
.kbs-root .kbs-area{min-height:104px;resize:vertical;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6}
.kbs-root .kbs-input:focus,.kbs-root .kbs-area:focus,.kbs-root .kbs-select:focus{outline:none;border-color:var(--kb-switch-on,#4d7cfe)}
.kbs-root .kbs-check{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbs-root .kbs-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbs-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.kbs-root .kbs-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:210;display:flex;align-items:center;gap:9px;padding:11px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 34px rgba(0,0,0,.5);font-size:13px;color:var(--dsw-alias-label-primary);max-width:70vw}
.kbs-root .kbs-toast.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.kbs-root .kbs-copy{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);border-radius:999px;padding:3px 9px;font-family:ui-monospace,monospace;font-size:11px;cursor:pointer}
.kbs-root .kbs-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
/* The panel on the right of Yours and Discover: the list stays, the panel sits next to it and follows the scroll. Under 1100 px it goes
   above the list instead, where it is the first thing seen. */
.kbs-root .kbs-split.open{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start}
.kbs-root .kbs-list{min-width:0}
.kbs-root .kbs-panel{position:sticky;top:12px;display:flex;flex-direction:column;gap:12px;min-width:0;box-sizing:border-box;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);max-height:calc(100vh - 32px);overflow:auto}
.kbs-root .kbs-panel>*{flex:0 0 auto}
.kbs-root .kbs-panel-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.kbs-root .kbs-panel-top .kb-tool{width:30px;height:30px;border-radius:9px;flex:0 0 auto}
.kbs-root .kbs-panel .kb-detail-head .kb8-tile.lg{width:44px;height:44px;border-radius:14px;flex:0 0 auto}
.kbs-root .kbs-panel .kb-local-rows .row{flex-wrap:wrap;gap:6px 14px}
.kbs-root .kbs-panel .kb-local-rows .row>span:first-child{min-width:96px}
.kbs-root .kbs-panel .kb-local-rows .row>span:last-child{min-width:0;flex:1 1 140px}
.kbs-root .kbs-panel .kb-local-body{max-height:300px}
.kbs-root .kbs-panel .kbs-path{display:flex;align-items:flex-start;gap:8px;overflow-wrap:anywhere}
.kbs-root .kbs-panel .kbs-desc{margin:0;font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-panel-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:4px}
.kbs-root .kbs-panel-acts a.kb8-ghost{text-decoration:none}
.kbs-root .kb8-ghost.warn{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.kbs-root .kb8-card.sel{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.kbs-root .kbs-row.sel{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
/* With the panel open the ranking is narrower: the repository and the badges columns give way (they are in the panel). */
.kbs-root .kbs-split.open .kbs-head,.kbs-root .kbs-split.open .kbs-row{grid-template-columns:36px minmax(0,1fr) 84px;gap:10px;padding:8px 14px}
.kbs-root .kbs-split.open .kbs-head .src,.kbs-root .kbs-split.open .kbs-head .badges,.kbs-root .kbs-split.open .kbs-row .src,.kbs-root .kbs-split.open .kbs-row .badges{display:none}
@media (max-width:1100px){
  .kbs-root .kbs-split.open{grid-template-columns:minmax(0,1fr)}
  .kbs-root .kbs-split.open .kbs-panel{order:-1;position:static;max-height:none}
}
.kbs-root .kbs-nowrap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* — Featured: the same rows as the ranking below it (same grid, same height); the cover, when there is one, is the row's tile. */
.kbs-root .kbs-feat{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}
.kbs-root .kbs-feat-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.kbs-root .kbs-feat-head .t{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-feat-head .s{font-size:12px;color:var(--dsw-alias-label-caption)}
.kbs-root .kbs-row .who .kb8-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbs-row.feat .kbs-fdesc{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-row.feat .rank{display:flex;justify-content:flex-end}
.kbs-root .kb8-tile.kbs-cover{overflow:hidden;padding:0}
.kbs-root .kb8-tile.kbs-cover img{width:100%;height:100%;object-fit:cover;display:block}
.kbs-root .kbs-star-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);cursor:pointer;padding:0;flex:0 0 auto}
.kbs-root .kbs-star-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.kbs-root .kbs-star-btn.on{color:#f7c46c;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
/* — Where the index is read from — */
.kbs-root .kbs-srcline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline .k{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbs-srcline .v{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kbs-root .kbs-srcline .w::before{content:'·';margin-right:8px}
@media (max-width:520px){.kbs-root .kbs-srcline .w::before{display:none}}
.kbs-root .kbs-link{background:none;border:none;padding:3px 6px;border-radius:7px;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.kbs-root .kbs-link:hover{background:var(--dsw-alias-bg-layer-2)}
/* — Team skills: the table reuses the one from Discover (same tokens), only the columns change — */
.kbs-root .kbt .kbt-head,.kbs-root .kbt .kbs-row{display:grid;grid-template-columns:44px minmax(200px,1.7fr) minmax(120px,1fr) 210px 150px;align-items:center;gap:14px;padding:8px 18px}
.kbs-root .kbt .kbt-head{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbt .kbs-row{min-height:56px}
.kbs-root .kbt .badges{display:flex;gap:6px;flex-wrap:wrap}
.kbs-root .kbt-name{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbs-root .kbt-name .n{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-name .d{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-by{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.kbs-root .kbt-by .d{display:block;color:var(--dsw-alias-label-caption)}
.kbs-root .kbt-act{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap}
.kbs-root .kbt-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.kbs-root .kbt-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbt-btn.solid{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border-color:transparent;font-weight:600}
.kbs-root .kbt-btn.solid:hover{opacity:.9}
.kbs-root .kbt-btn.danger{color:var(--dsw-alias-state-error-primary)}
.kbs-root .kbt-btn[disabled]{opacity:.45;cursor:default}
.kbs-root .kbt-subrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.kbs-root .kbt-stack{display:flex;flex-direction:column;gap:16px}
.kbs-root .kbt-files{border:1px solid var(--dsw-alias-border-l1);border-radius:13px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.kbs-root .kbt-file{display:grid;grid-template-columns:22px minmax(0,1fr) 70px auto;gap:10px;align-items:center;width:100%;box-sizing:border-box;padding:8px 14px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.kbs-root .kbt-file:last-child{border-bottom:0}
.kbs-root .kbt-file:hover,.kbs-root .kbt-file.on{background:var(--dsw-alias-interactive-bg-hover)}
.kbs-root .kbt-file.warn{box-shadow:inset 2px 0 0 var(--dsw-alias-state-warn-primary)}
.kbs-root .kbt-file .p{font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbs-root .kbt-file .z{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-caption);text-align:right}
.kbs-root .kbt-code{margin:0;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:13px;padding:12px 14px;white-space:pre-wrap;overflow:auto;max-height:320px;word-break:break-word}
.kbs-root .kbt-code .add{display:block;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.kbs-root .kbt-code .del{display:block;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.kbs-root .kbt-code .gap{display:block;color:var(--dsw-alias-label-caption)}
.kbs-root .kbt-banner{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.kbs-root .kbt-banner.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}
.kbs-root .kbt-banner.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}
.kbs-root .kbt-banner svg{flex:0 0 auto;margin-top:1px}
.kbs-root .kbt-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}
.kbs-root .kbt-card .head{display:flex;align-items:flex-start;gap:14px}
.kbs-root .kbt-card .grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.kbs-root .kbt-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);display:inline-block;flex:0 0 auto}
.kbs-root .kbt-kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 14px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbt-kv .k{color:var(--dsw-alias-label-secondary)}
.kbs-root .kbt-cap{font-size:12px;color:var(--dsw-alias-label-caption);line-height:1.5}
.kbs-root .kbt-sheet{width:660px}
.kbs-root .kb8-primary[disabled]{opacity:.45;cursor:default}
/* Tables that follow the width of THEIR column, not of the window: below 720 px the STATE column steps aside, below 480 the
   source too, so the last column — the one that says how installed a skill is — is never the one that gets cut off. */
.kbs-root .kb8-page{container-type:inline-size}
@container (max-width:720px){
.kbs-root .kbs-head,.kbs-root .kbs-row{grid-template-columns:36px minmax(0,1.6fr) minmax(0,1fr) 108px;gap:10px;padding:8px 12px}
.kbs-root .kbs-head .badges,.kbs-root .kbs-row .badges{display:none}
.kbs-root .kbt .kbt-head,.kbs-root .kbt .kbs-row{grid-template-columns:36px minmax(0,1fr) auto;gap:10px;padding:8px 12px}
.kbs-root .kbt .kbt-head>:nth-child(3),.kbs-root .kbt .kbt-head>:nth-child(4),.kbs-root .kbt .kbs-row .kbt-by,.kbs-root .kbt .kbs-row .badges{display:none}
}
@container (max-width:480px){
.kbs-root .kbs-head,.kbs-root .kbs-row{grid-template-columns:30px minmax(0,1fr) 108px}
.kbs-root .kbs-head .src,.kbs-root .kbs-row .src{display:none}
.kbs-root .kbs-row.feat .kbs-fdesc{display:none}
}
/* — Featured tab: the picks Kybernos proposes. Cover = ONE cut-out per skill (transparent), composed here: a category tint (or the plain
   card surface), the creator and the count on the right of the title, the actions on hover (always on touch) — */
.kbs-root .kbsf-t{--cv-bg:#f4e6d6;--cv-bg2:#ecd5ba}
.kbs-root .kbsf-t[data-cat=Data]{--cv-bg:#dff0e2;--cv-bg2:#c6e4cc}
.kbs-root .kbsf-t[data-cat=Design]{--cv-bg:#ece4f8;--cv-bg2:#dccff2}
.kbs-root .kbsf-t[data-cat=Media]{--cv-bg:#fbe0dc;--cv-bg2:#f6c8c2}
.kbs-root .kbsf-t[data-cat=Research]{--cv-bg:#dde9fa;--cv-bg2:#c4d8f5}
.kbs-root .kbsf-t[data-cat=Marketing]{--cv-bg:#f9f0c8;--cv-bg2:#f2e29a}
.kbs-root .kbsf-t[data-cat=Automation]{--cv-bg:#d7f0ed;--cv-bg2:#b9e3de}
.kbs-root .kbsf-t[data-cat=Build]{--cv-bg:#e4e7f5;--cv-bg2:#cfd4ee}
body[data-ds-dark-theme] .kbs-root .kbsf-t{--cv-bg:#3a2e24;--cv-bg2:#4a3a2c}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Data]{--cv-bg:#203629;--cv-bg2:#2a4a37}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Design]{--cv-bg:#2d2644;--cv-bg2:#3b3159}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Media]{--cv-bg:#402524;--cv-bg2:#55302e}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Research]{--cv-bg:#202d45;--cv-bg2:#2a3b5c}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Marketing]{--cv-bg:#3a3420;--cv-bg2:#4d4528}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Automation]{--cv-bg:#1c3835;--cv-bg2:#264b47}
body[data-ds-dark-theme] .kbs-root .kbsf-t[data-cat=Build]{--cv-bg:#272a43;--cv-bg2:#343a5c}
.kbs-root .kbsf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;align-items:stretch}
.kbs-root .kbsf-card{container-type:inline-size;position:relative;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .16s ease,border-color .16s ease}
.kbs-root .kbsf-card:hover,.kbs-root .kbsf-card.sel{border-color:var(--dsw-alias-brand-primary)}
.kbs-root .kbsf-card:hover{transform:translateY(-3px)}
.kbs-root .kbsf-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.kbs-root .kbsf-pic{position:relative;aspect-ratio:16/9;overflow:hidden;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-pic{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-pic .kbsf-cut{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 7px 9px rgba(30,18,6,.30))}
.kbs-root .kbsf-pic .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px}
.kbs-root .kbsf-tag{position:absolute;inset-block-start:10px;inset-inline-start:10px;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;background:rgba(255,253,248,.88);color:#26221e}
.kbs-root .kbsf-star{position:absolute;inset-block-start:6px;inset-inline-end:6px;background:rgba(255,253,248,.88);color:#6b625a;border-color:transparent}
.kbs-root .kbsf-star:disabled{opacity:.55;cursor:default}
.kbs-root .kbsf-star.on{color:#c98a00}
.kbs-root .kbsf-star.on svg{fill:currentColor}
.kbs-root .kbsf-body{display:flex;flex-direction:column;gap:8px;padding:14px 16px 16px;flex:1;min-width:0}
.kbs-root .kbsf-trow{display:flex;align-items:flex-start;gap:10px}
.kbs-root .kbsf-title{flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.25;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-side{display:flex;align-items:center;gap:10px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);padding-top:2px}
.kbs-root .kbsf-by{display:inline-flex;align-items:center;gap:6px;min-width:0}
.kbs-root .kbsf-by .nm{display:none;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@container (min-width:330px){.kbs-root .kbsf-by .nm{display:inline}}
.kbs-root .kbsf-av{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex:none}
.kbs-root .kbsf-cnt{display:inline-flex;align-items:center;gap:4px;font-family:ui-monospace,monospace;font-size:11.5px}
.kbs-root .kbsf-out{margin:0;font-size:13.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.8em}
.kbs-root .kbsf-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:24px}
.kbs-root .kbsf-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;line-height:1;padding:5px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.kbs-root .kbsf-pill.ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbs-root .kbsf-pill.warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.kbs-root .kbsf-pill.need{color:var(--dsw-alias-state-business-primary,#5686fe)}
/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */
body:not([data-ds-dark-theme]) .kbs-root{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}
/* The state inks are the fills (2.1 to 4.2:1 on white): in the light schemes they are pulled toward the text colour (audit A1-11). */
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 50%,var(--dsw-alias-label-primary))}
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 50%,var(--dsw-alias-label-primary))}
body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.need{color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 60%,var(--dsw-alias-label-primary))}
.kbs-root .kbsf-acts{display:flex;align-items:center;gap:8px;margin-top:auto;min-height:32px;transition:opacity .14s ease}
@media (hover:hover){
.kbs-root .kbsf-card .kbsf-acts{opacity:0}
.kbs-root .kbsf-card:hover .kbsf-acts,.kbs-root .kbsf-card:focus-within .kbsf-acts{opacity:1}
}
.kbs-root .kbsf-acts .kb8-primary{height:32px;padding:0 14px;font-size:13px;border-radius:10px;gap:6px}
.kbs-root .kbsf-acts .kb8-ghost{height:32px;padding:0 12px;font-size:13px;gap:6px}
/* — Featured, a pick opened: the page's width, not a side panel — */
.kbs-root .kbsf-detail{container-type:inline-size;display:flex;flex-direction:column;gap:18px}
.kbs-root .kbsf-dback{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.kbs-root .kbsf-dhero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);border:1px solid var(--dsw-alias-border-l1);border-radius:22px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbsf-dpic{position:relative;min-height:380px;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-dpic{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-dpic .kbsf-cut{position:absolute;inset:7%;width:86%;height:86%;object-fit:contain;filter:drop-shadow(0 12px 16px rgba(30,18,6,.32))}
.kbs-root .kbsf-dpic .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:96px;height:96px}
.kbs-root .kbsf-dtx{padding:30px 34px;display:flex;flex-direction:column;gap:14px;justify-content:center;min-width:0}
.kbs-root .kbsf-dtitle{margin:0;font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-dout{margin:0;font-size:16px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-dacts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
.kbs-root .kbsf-dacts .kbsf-rstar{position:static}
.kbs-root .kbsf-try{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2);margin-top:4px}
.kbs-root .kbsf-trytxt{font-size:14px;color:var(--dsw-alias-label-primary)}
.kbs-root .kbsf-try .kbs-link{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.kbs-root .kbsf-dcols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}
.kbs-root .kbsf-dcard .kbs-desc{margin:0;font-size:14px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-dcard{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:18px 20px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px;min-width:0}
@container (max-width:760px){
.kbs-root .kbsf-dhero{grid-template-columns:1fr}
.kbs-root .kbsf-dpic{min-height:240px}
.kbs-root .kbsf-dtx{padding:22px}
.kbs-root .kbsf-dcols{grid-template-columns:1fr}
}
/* — Featured, list view: the same pick as a row — */
.kbs-root .kbsf-list{container-type:inline-size;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden}
.kbs-root .kbsf-row{display:grid;grid-template-columns:88px minmax(0,1.5fr) minmax(0,1fr) auto;gap:16px;align-items:center;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer;background:var(--dsw-alias-bg-layer-1)}
.kbs-root .kbsf-row:first-child{border-top:0}
.kbs-root .kbsf-row:hover,.kbs-root .kbsf-row.sel{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.kbs-root .kbsf-th{position:relative;width:88px;aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,var(--cv-bg),var(--cv-bg2))}
.kbs-root .kbsf-plain .kbsf-th{background:var(--dsw-alias-bg-layer-2)}
.kbs-root .kbsf-th .kbsf-cut{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 4px 5px rgba(30,18,6,.30))}
.kbs-root .kbsf-th .kb8-tile{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);width:40px;height:40px}
.kbs-root .kbsf-mn{min-width:0;display:flex;flex-direction:column;gap:3px}
.kbs-root .kbsf-mn .kbsf-out{-webkit-line-clamp:1;min-height:0}
.kbs-root .kbsf-meta{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.kbs-root .kbsf-racts{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.kbs-root .kbsf-racts .kb8-primary{height:32px;padding:0 14px;font-size:13px;border-radius:10px;gap:6px}
.kbs-root .kbsf-racts .kb8-ghost{height:32px;padding:0 12px;font-size:13px;gap:6px}
.kbs-root .kbsf-rstar{position:static;background:transparent;color:var(--dsw-alias-label-secondary)}
.kbs-root .kbsf-rstar:disabled{opacity:.45;cursor:default}
.kbs-root .kbsf-rstar.on{color:#c98a00}
.kbs-root .kbsf-rstar.on svg{fill:currentColor}
@container (max-width:760px){
.kbs-root .kbsf-row{grid-template-columns:72px minmax(0,1fr) auto;gap:12px}
.kbs-root .kbsf-row .kbsf-pills{display:none}
.kbs-root .kbsf-th{width:72px}
}
@container (max-width:520px){
.kbs-root .kbsf-row{grid-template-columns:56px minmax(0,1fr)}
.kbs-root .kbsf-th{width:56px;border-radius:11px}
.kbs-root .kbsf-racts{grid-column:1 / -1;justify-content:flex-start}
.kbs-root .kbsf-meta .kbsf-by .nm{display:none}
}
.kbs-root .kbsf-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:2px 0 14px}
.kbs-root .kbsf-chips .grow{flex:1}
.kbs-root .kbsf-seg{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}
.kbs-root .kbsf-seg button{border:0;background:transparent;width:32px;height:28px;padding:0;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.kbs-root .kbsf-seg button.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px rgba(20,20,19,.14)}
.kbs-root .kbsf-seg .sw{display:block;width:16px;height:16px;border-radius:5px}
.kbs-root .kbsf-seg .sw.tint{background:linear-gradient(135deg,#f4e6d6 0%,#c4d8f5 100%)}
.kbs-root .kbsf-seg .sw.plain{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}
.kbs-root .kbsf-foot{margin-top:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}
/* — Settings page « Skills » (catalogue): its own scope (.kbss-page), not .kbs-root, so nothing
   here can reach the Skills panel; the shared input/link/note vocabulary is re-stated here because
   the kbs-* rules above are scoped to .kbs-root — */
.kbss-page{display:flex;flex-direction:column;gap:22px;width:100%;max-width:720px;box-sizing:border-box}
.kbss-page .kbss-h1{margin:0;font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kbss-page .kbss-lead{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.kbss-page .kbss-h2{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbss-page .kbss-sub{margin:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline .k{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-srcline .v{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kbss-page .kbss-srcline .w::before{content:'·';margin-right:8px}
@media (max-width:520px){.kbss-page .kbss-srcline .w::before{display:none}}
.kbss-page .kbss-link{background:none;border:none;padding:3px 6px;border-radius:7px;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.kbss-page .kbss-link:hover{background:var(--dsw-alias-bg-layer-2)}
.kbss-page .kbss-fields{display:flex;flex-direction:column;gap:8px}
.kbss-page .kbss-label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-caption)}
.kbss-page .kbss-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;padding:10px 12px}
.kbss-page .kbss-input:focus{outline:none;border-color:var(--kb-switch-on,#4d7cfe)}
.kbss-page .kbss-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.kbss-page .kbss-err{font-size:13px;color:var(--dsw-alias-state-error-primary)}
.kbss-page .kbss-note{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-caption)}
.kbss-page .kbss-root-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-root-row .p{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 220px}
.kbss-page .kbss-kpis{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.kbss-page .kbss-kpis .n{font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kbss-page .kbss-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-caption)}
`

      // ── route access ────────────────────────────────────────────────────
      // An unreadable body is not a network outage: we name the HTTP status, because the most
      // frequent case in development is a route that is simply ABSENT (host module not yet
      // reloaded) — and "unreachable" would send us looking for the fault in the wrong place.
      const lire = async (r) => {
        try { return await r.json() } catch (e) {
          return { ok: false, error: r.ok === true ? t('err.unreadable') : t('err.noroute', { s: r.status }) }
        }
      }
      // The DISPLAYED session accompanies every call: it is what sets the PROJECT, hence the project
      // skills the catalogue must show, and the scope to invalidate after a write. Without a
      // session (tab opened outside a session), nothing is added: original behaviour kept.
      let kbSkSid = ''
      const avecSession = (path) => (kbSkSid === '' ? path : path + (path.indexOf('?') === -1 ? '?' : '&') + 'sessionId=' + encodeURIComponent(kbSkSid))
      const corpsSession = (body) => (kbSkSid === '' ? body : Object.assign({}, body === null || body === undefined ? {} : body, { sessionId: kbSkSid }))
      const getJson = (path) => fetch(avecSession(path), { headers: { accept: 'application/json' } }).then(lire)
      const postJson = (path, body) => fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(corpsSession(body))
      }).then(lire)
      // A host answer is a code in `error`, with the facts its sentence needs (`source`, `name`, `http`…): the sentence is the screen's, in the
      // screen's language. A code with no sentence (a host from before this change answers in French) is shown as it came.
      const why = (j, fallback) => {
        const code = (j !== null && j !== undefined && typeof j.error === 'string') ? j.error : ''
        if (code === '') return fallback
        if (STR['he.' + code] === undefined) return code
        const text = t('he.' + code, { source: j.source, name: j.name, http: j.http, count: j.count, max: j.max, dest: j.dest })
        // The relay's own words are added when they say more than the sentence ("index unavailable" under « The index did not answer »
        // was the same thing twice).
        const detail = typeof j.detail === 'string' ? j.detail.trim() : ''
        if (detail === '' || /^(the )?(skills )?index (is )?(un)?available\.?$/i.test(detail)) return text
        return text + ' — ' + detail
      }
      const skillKey = (s) => String(s.root) + '\u0000' + String(s.name)

      function KybernosSkills(props) {
        // Scope of the view: the session the tab represents. Published from the render so that the
        // helpers attach it to every call; the loading effect, however, depends on `sid`.
        const sid = (props !== null && props !== undefined && typeof props.sessionId === 'string') ? props.sessionId : ''
        kbSkSid = sid
        // Featured is the landing tab; a host that has no picks (not restarted yet) sends the screen back to Yours (see `picks` below).
        const [mode, setMode] = React.useState('featured')                       // featured | yours | discover | team
        const [q, setQ] = React.useState({ featured: '', yours: '', discover: '', team: '' })
        const [sort, setSort] = React.useState({ featured: 'editorial', yours: 'recent', discover: 'installs' })
        const [dir, setDir] = React.useState({ featured: -1, yours: -1, discover: -1 })
        // Cards or list, per tab, kept in this browser: Yours is cards by default (as it was), Discover is the ranking table (as it was).
        const [views, setViews] = React.useState(() => {
          try {
            const j = JSON.parse(window.localStorage.getItem('kybernos.skills.views'))
            return { yours: j !== null && j.yours === 'list' ? 'list' : 'cards', discover: j !== null && j.discover === 'cards' ? 'cards' : 'list', featured: j !== null && j.featured === 'list' ? 'list' : 'cards' }
          } catch (e) { return { yours: 'cards', discover: 'list', featured: 'cards' } }
        })
        const setView = (m, v) => setViews((prev) => {
          const next = { ...prev, [m]: v }
          try { window.localStorage.setItem('kybernos.skills.views', JSON.stringify(next)) } catch (e) { /* a convenience only */ }
          return next
        })
        const [page, setPage] = React.useState({ yours: 1 })
        // The index is PAGINATED server-side: `iview` chooses the ranking, `ipage` is 0-indexed like the
        // API, `iper` the page size. This is what replaces the endless "Load more" — at
        // 9 827 skills, we do not scroll: we page, or we search.
        const [iview, setIview] = React.useState('all-time')
        const [ipage, setIpage] = React.useState(0)
        const [iper, setIper] = React.useState(DISC_PER)
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
        // The last failure of the index: { text, code, http }. `discTick` re-asks (« Try again »); `manualRetry` tells the effect that
        // the user asked, so it does not add its own automatic second attempt on top.
        const [discErr, setDiscErr] = React.useState(null)
        const [discTick, setDiscTick] = React.useState(0)
        const manualRetry = React.useRef(false)
        // The relay the index is read from ({ origin: default | setting | env, host, url, refused, editable }), the window that
        // names another one, and what it is doing.
        const [src, setSrc] = React.useState(null)
        const [srcOpen, setSrcOpen] = React.useState(false)
        const [srcBusy, setSrcBusy] = React.useState(false)
        const [srcErr, setSrcErr] = React.useState('')
        const [audit, setAudit] = React.useState(null)     // security audits of the open skill
        // Curated owners (GET /kybernos-skills/curated), kept to say who PUBLISHES a skill: an index
        // entry carries `source` (owner/repo) but no owner label of its own.
        const [curatedOwners, setCuratedOwners] = React.useState(null)
        const [busy, setBusy] = React.useState({})
        const [errors, setErrors] = React.useState({})
        const [notice, setNotice] = React.useState(null)
        const [roots, setRoots] = React.useState([])
        const [modal, setModal] = React.useState(null)                        // null | create | install
        const [detail, setDetail] = React.useState(null)
        // A card of the Yours tab opens its panel on the right (`local`, the skill); a row of Discover opens `detail` (the index entry).
        // The list stays on screen in both cases: the panel sits next to it.
        const [local, setLocal] = React.useState(null)
        // The skill's REAL SKILL.md, what the host will let the screen do with it (`actions`), its folder: asked of the host when the panel
        // opens (POST /kybernos-skills/skill/read), kept here so that it survives the parent re-rendering.
        const [localRead, setLocalRead] = React.useState({ state: 'idle', data: null, error: '' })
        const localKey = local === null ? '' : skillKey(local)
        React.useEffect(() => {
          if (local === null) { setLocalRead({ state: 'idle', data: null, error: '' }); return undefined }
          let stopped = false
          setLocalRead({ state: 'loading', data: null, error: '' })
          postJson('/kybernos-skills/skill/read', { root: local.root, name: local.name }).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && typeof j.text === 'string') setLocalRead({ state: 'ready', data: j, error: '' })
            else setLocalRead({ state: 'error', data: null, error: why(j, t('err.unexpected', { r: 'skill' })) })
          }).catch(() => {
            if (stopped !== true && alive.current === true) setLocalRead({ state: 'error', data: null, error: t('err.unavail', { r: 'skill' }) })
          })
          return () => { stopped = true }
        }, [localKey])
        // What a Discover card knows beyond the index: the folder, description and start of SKILL.md of the skill in ITS repository.
        const [preview, setPreview] = React.useState({ state: 'idle', data: null, error: '' })
        // The two confirmations: install (a Discover entry) and delete (a skill of Yours). Nothing is written before the click inside them.
        const [askInstall, setAskInstall] = React.useState(null)
        const [askDelete, setAskDelete] = React.useState(null)
        // Featured: the highlighted list, controlled by the user. `items` follows the order of the
        // file; an item `found:false` (skill gone from the registry) is skipped at render, not erased.
        const [feat, setFeat] = React.useState({ phase: 'idle', items: [] })
        // The picks Kybernos proposes (GET /kybernos-skills/picks): `absent` = a host that does not have the route, or an empty file.
        const [picks, setPicks] = React.useState({ phase: 'loading', items: [], asOf: '' })
        const [pcat, setPcat] = React.useState('all')                            // all | one of the picks' categories
        // The cover background (the category tint, or the plain card surface), kept in this browser.
        const [coverBg, setCoverBgState] = React.useState(() => {
          try { return window.localStorage.getItem('kybernos.skills.coverbg') === 'plain' ? 'plain' : 'tint' } catch (e) { return 'tint' }
        })
        const setCoverBg = (v) => {
          setCoverBgState(v)
          try { window.localStorage.setItem('kybernos.skills.coverbg', v) } catch (e) { /* a convenience only */ }
        }
        // Team skills: what the account says about the active workspace (its role and counts, or why the tab is locked), the skill
        // that is open, the sub-view, the propose sheet, and a counter that makes the list read again.
        const [tsum, setTsum] = React.useState({ phase: 'loading' })
        const [teamOpen, setTeamOpen] = React.useState(null)
        const [teamView, setTeamView] = React.useState('approved')
        const [teamSheet, setTeamSheet] = React.useState(false)
        const [teamVer, setTeamVer] = React.useState(0)
        const alive = React.useRef(true)

        React.useEffect(() => () => { alive.current = false }, [])

        // Closing the three popovers (Filters, Sort, Create/Install) on an outside click and
        // on Escape. Without this, an open menu only closed through its own button: you
        // could click in the list, switch tabs, and leave it open behind. Same
        // mechanics as the pivot's popovers (.kb6-tb-mwrap): a click inside the popover or on
        // its button does not close it, everything else does.
        React.useEffect(() => {
          if (showFilters !== true && sortOpen !== true && addOpen !== true) return undefined
          const ferme = () => { setShowFilters(false); setSortOpen(false); setAddOpen(false) }
          const onDown = (e) => {
            try {
              if (e !== null && e.target !== null && typeof e.target.closest === 'function' && e.target.closest('.kb-menu-wrap') !== null) return
            } catch (e2) { /* exotic target */ }
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

        const loadPicks = React.useCallback(() => {
          getJson('/kybernos-skills/picks').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items) && j.items.length > 0) {
              setPicks({ phase: 'ready', items: j.items, asOf: typeof j.asOf === 'string' ? j.asOf : '' })
            } else setPicks({ phase: 'absent', items: [], asOf: '' })
          }).catch(() => { if (alive.current === true) setPicks({ phase: 'absent', items: [], asOf: '' }) })
        }, [])
        React.useEffect(() => { if (picks.phase === 'absent') setMode((m) => (m === 'featured' ? 'yours' : m)) }, [picks.phase])

        // Star = feature / unfeature. The response carries the up-to-date list: we follow it as is,
        // without reloading — one round trip less, and the displayed order stays the file's.
        // POST on /featured/toggle (and not /featured): the webServer's exact table is indexed
        // by path alone, a GET+POST on the same path throws "duplicate" AT MOUNT (measured).
        const toggleFeatured = (name, reason) => {
          postJson('/kybernos-skills/featured/toggle', { name, why: reason || '' }).then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setFeat((m) => ({ ...m, phase: 'ready', items: j.items }))
              setNotice({ kind: 'ok', text: j.featured === true ? t('notice.featOn', { name }) : t('notice.featOff', { name }) })
            } else setNotice({ kind: 'err', text: why(j, t('err.feat')) })
          }).catch(() => {
            if (alive.current === true) setNotice({ kind: 'err', text: t('err.unavail', { r: 'featured' }) })
          })
        }

        // One cheap call tells the tab what to show: the count, a dot when an admin has proposals to review, a lock and the reason, or
        // nothing at all when kybernos-cloud is not loaded (its routes then answer a page, not JSON).
        const loadTeam = React.useCallback(() => {
          fetch('/kybernos-cloud/team/skills?view=approved&limit=1', { headers: { accept: 'application/json' } })
            .then((r) => r.json().then((j) => j, () => null))
            .then((j) => {
              if (alive.current !== true) return
              if (j === null || typeof j !== 'object') { setTsum({ phase: 'absent' }); return }
              if (j.ok === true) setTsum({ phase: 'ready', role: j.role, counts: j.counts !== null && typeof j.counts === 'object' ? j.counts : { approved: 0, pending: 0 }, workspaceName: typeof j.workspaceName === 'string' ? j.workspaceName : '' })
              else setTsum({ phase: 'locked', kind: teamLockOf(typeof j.error === 'string' ? j.error : ''), detail: typeof j.error === 'string' ? j.error : '' })
            })
            .catch(() => { if (alive.current === true) setTsum({ phase: 'absent' }) })
        }, [])

        // The workspace may have changed in the sidebar since the last look: read again whenever the tab is opened.
        React.useEffect(() => { if (mode === 'team') loadTeam() }, [mode])

        // `curatedOwners` is { byRepo: owner/repo → publisher, ids: Set of owner/repo/name }. It used to be keyed by the skill's NAME: the first curated skill of that name gave its publisher to every other skill called the same: 250
        // names are shared by several publishers, and `grill-me` of mattpocock/skills read « published by flutter ».
        const loadCuratedOwners = React.useCallback(() => {
          getJson('/kybernos-skills/curated').then((j) => {
            if (alive.current !== true) return
            const owners = (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.owners)) ? j.owners : []
            const byRepo = {}
            const ids = new Set()
            for (const o of owners) {
              const owner = o !== null && typeof o === 'object' && typeof o.owner === 'string' ? o.owner : ''
              if (owner === '') continue
              for (const s of (Array.isArray(o.skills) ? o.skills : [])) {
                if (s === null || typeof s !== 'object' || typeof s.source !== 'string' || typeof s.name !== 'string') continue
                if (byRepo[s.source] === undefined) byRepo[s.source] = owner
                ids.add(s.source + '/' + s.name)
              }
            }
            setCuratedOwners({ byRepo, ids })
          }).catch(() => { /* no curated set (route or relay absent): the owner row is simply not shown */ })
        }, [])

        const loadSource = React.useCallback(() => {
          getJson('/kybernos-skills/index-source').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') setSrc(j.source)
          }).catch(() => { /* a host from before this setting has no such route: the line is simply not shown */ })
        }, [])

        React.useEffect(() => {
          loadCatalogue()
          loadFeatured()
          loadPicks()
          loadTeam()
          loadSource()
          loadCuratedOwners()
          getJson('/kybernos-skills/status').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.roots)) {
              setRoots(j.roots.filter((r) => r !== null && typeof r.path === 'string'))
            }
          }).catch(() => { /* without roots, the modals fall back on the host, which revalidates everything */ })
        }, [loadCatalogue, loadFeatured, loadTeam, loadSource, loadCuratedOwners])

        // One request for the three paginated views, another for the search, one for the curated
        // set. The server announces `total` and `hasMore`: pagination guesses nothing, and that is
        // precisely what was missing when we scraped 571 entries from a page of 9 827 skills.
        const dq = q.discover
        const dneedle = dq.trim()
        const discKind = dneedle.length >= 2 ? 'search' : (iview === 'curated' ? 'curated' : 'index')
        React.useEffect(() => {
          if (mode !== 'discover') return undefined
          let stopped = false
          let retryTimer = null
          const auto = manualRetry.current !== true
          manualRetry.current = false
          setDiscPhase('loading')
          const route = discKind === 'search'
            ? '/kybernos-skills/search?q=' + encodeURIComponent(dneedle) + '&limit=100'
            : (discKind === 'curated'
              ? '/kybernos-skills/curated'
              : '/kybernos-skills/index?view=' + encodeURIComponent(iview) + '&page=' + ipage + '&perPage=' + iper)
          // A relay that answers 502 / 503 / 504, or a network that blinks, is usually back a moment later: the page asks once more
          // by itself before saying anything. A refused address, a 404 or an unreadable answer is not transient, and a second
          // attempt after that one is the user's (« Try again »).
          const transient = (j) => j !== null && typeof j === 'object' && (j.error === 'timeout' || j.error === 'network_unavailable' ||
            (j.error === 'index_unavailable' && [500, 502, 503, 504].indexOf(j.http) >= 0))
          const fail = (j, text) => {
            setDiscPhase('error')
            setDiscErr({ text, code: (j !== null && typeof j === 'object' && typeof j.error === 'string') ? j.error : 'noanswer', http: (j !== null && typeof j === 'object') ? j.http : undefined })
          }
          const go = (first) => {
            getJson(route).then((j) => {
              if (stopped === true || alive.current !== true) return
              if (j !== null && typeof j === 'object' && j.ok === true) { setDisc(j); setDiscPhase('ready'); setDiscErr(null); return }
              if (first === true && auto === true && transient(j) === true) { retryTimer = setTimeout(() => go(false), 1500); return }
              fail(j, why(j, t('err.index')))
            }).catch(() => {
              if (stopped === true || alive.current !== true) return
              // This `catch` is the one for OUR route (DSH itself): the index has nothing to do with it, and the state says so.
              if (first === true && auto === true) { retryTimer = setTimeout(() => go(false), 1500); return }
              fail(null, t('err.noanswer'))
            })
          }
          // The debounce only makes sense for typing: the other requests start from a click.
          const timer = setTimeout(() => go(true), discKind === 'search' ? 350 : 0)
          return () => { stopped = true; clearTimeout(timer); if (retryTimer !== null) clearTimeout(retryTimer) }
        }, [mode, dneedle, discKind, iview, ipage, iper, discTick])

        // Any filter change goes back to the first page: otherwise we can end up
        // on an empty page after narrowing a search.
        React.useEffect(() => { setPage((p) => ({ ...p, yours: 1 })) }, [q.yours, stateFilter, sourceFilter, sort.yours, dir.yours])
        React.useEffect(() => { setIpage(0) }, [dneedle, iview, iper])

        // Audits are requested ONLY for the open skill: one request per row would be
        // rude for a fifty-row table.
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

        // The same for the preview: asked only for the open card, only for a GitHub source (the others cannot be read this way), and a
        // card that is closed or replaced drops its answer.
        React.useEffect(() => {
          if (detail === null) { setPreview({ state: 'idle', data: null, error: '' }); return undefined }
          if (detail.installable !== true) { setPreview({ state: 'none', data: null, error: '' }); return undefined }
          let stopped = false
          setPreview({ state: 'loading', data: null, error: '' })
          getJson('/kybernos-skills/preview?source=' + encodeURIComponent(detail.source) + '&name=' + encodeURIComponent(detail.name)).then((j) => {
            if (stopped === true || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) setPreview({ state: j.found === true ? 'ready' : 'missing', data: j, error: '' })
            else setPreview({ state: 'error', data: null, error: why(j, t('err.preview')) })
          }).catch(() => {
            if (stopped !== true && alive.current === true) setPreview({ state: 'error', data: null, error: t('err.unavail', { r: 'preview' }) })
          })
          return () => { stopped = true }
        }, [detail === null ? '' : detail.source + '/' + detail.name])

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

        // The three response shapes are reduced to ONE list, so the render only has one case.
        //   index   : { skills, total, hasMore, page }
        //   search  : { skills, count, durationMs }
        //   curated : { owners[{owner, skills[]}], totalOwners, totalSkills }
        // The curated set is flattened and marked `official`: the badge finally comes from a first-party SET,
        // and no longer from a flag picked out of a page's HTML.
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

        // ── ranking pagination ────────────────────────────────────────────────
        // It comes from the SERVER for the three ranked views; the curated set is rendered
        // in one block (100 owners, 6 533 skills) and is paginated locally.
        const discTotal = discKind === 'index'
          ? (disc !== null && Number.isFinite(disc.total) ? disc.total : discList.length)
          : (discKind === 'search'
            ? (disc !== null && Number.isFinite(disc.count) ? disc.count : discList.length)
            : discList.length)
        const discPages = Math.max(1, Math.ceil(discTotal / iper))
        // The DISPLAYED page is the one of the data RECEIVED, never the one we just asked for:
        // during loading, `ipage` advances before the response, and the "#" column would then show
        // the ranks of page 3 above the rows of page 1 — observed for real.
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
              // ARB-3: "changed" is true or false, both are successes — the displayed
              // state first follows the returned skill, then the list is resynchronized.
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
          } catch (e) { /* fallback below */ }
          setNotice({ kind: 'err', text: t('copy.unavail') })
        }

        // « Try again » on the index: the same request once more, with no automatic extra attempt.
        const retryDiscover = () => { manualRetry.current = true; setDiscTick((n) => n + 1) }

        // Names another relay (or, with an empty address, puts the Kybernos one back). The host validates with the same rule as the
        // environment variable; what it answers is shown as it is. A new source drops what was shown from the old one.
        const saveSource = (url) => {
          if (srcBusy === true) return
          setSrcBusy(true); setSrcErr('')
          postJson('/kybernos-skills/index-source/set', { url }).then((j) => {
            if (alive.current !== true) return
            setSrcBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') {
              setSrc(j.source); setSrcOpen(false)
              setNotice({ kind: 'ok', text: j.source.origin === 'setting' ? t('src.savedCustom', { host: j.source.host }) : t('src.savedDefault') })
              setDisc(null); setDiscErr(null); setIpage(0); manualRetry.current = true; setDiscTick((n) => n + 1)
            } else setSrcErr(why(j, t('err.source')))
          }).catch(() => {
            if (alive.current !== true) return
            setSrcBusy(false); setSrcErr(t('err.unavail', { r: 'index-source' }))
          })
        }

        const count = catPhase === 'ready' ? String(skills.length) : '0'
        const shownYours = filtered.slice(0, page.yours * PAGE)

        // Opening a modal starts from a clean screen: without this, the error of the previous
        // attempt would stay displayed above a still-empty form.
        const openModal = (kind) => {
          setErrors((m) => { const n = { ...m }; delete n.__modal; return n })
          setModal(kind)
        }

        // ── fragments ─────────────────────────────────────────────────────────
        const primary = (label, act, ic, disabled, title) => h('button', {
          type: 'button', className: 'kb8-primary', onClick: act, disabled: disabled === true, title: title
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

        // VIEWS offered by the official API. "Curated" is not a ranking but the first-party
        // set: it is therefore presented separately, and it marks its entries `official`.
        const VUES = [
          ['all-time', 'All Time', t('view.alltime')],
          ['trending', 'Trending', t('view.trending')],
          ['hot', 'Hot', t('view.hot')],
          ['curated', 'Curated', t('view.curated')]
        ]

        const razoirFiltres = () => {
          if (mode === 'discover') { setIview('all-time'); setIper(DISC_PER) }
          else { setStateFilter('all'); setSourceFilter('all') }
        }
        // Number of active filters: the state is read on the button (.kb-tool-lab .n), like the
        // "Filters 1" of the pivot. In Discover the view is written in plain text on the button, so only
        // the rows-per-page setting counts here.
        const filtresActifs = () => mode === 'discover'
          ? (iper === DISC_PER ? 0 : 1)
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
                [DISC_PER, 50, 100, 250].map((n) => chip(String(n), iper === n, () => setIper(n), 'n' + n))),
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
          const isYours = mode === 'yours' || mode === 'featured'
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
          const isFeat = mode === 'featured'
          const isYours = mode === 'yours' || isFeat
          return h('div', null,
            h('div', { className: 'kb-toolbar' },
              h('div', { className: 'kb8-search' }, icon('search', 14),
                h('input', {
                  placeholder: isFeat ? t('ph.featured') : (isYours ? t('ph.yours') : t('ph.discover')),
                  value: isFeat ? q.featured : (isYours ? q.yours : q.discover),
                  onChange: (e) => { const v = e.target.value; setQ((m) => isFeat ? { ...m, featured: v } : (isYours ? { ...m, yours: v } : { ...m, discover: v })) }
                })),
              isFeat ? null : h('div', { className: 'kb-menu-wrap' },
                h('button', {
                  type: 'button', className: 'kb-tool-lab' + (showFilters ? ' on' : ''), title: isYours ? t('flt.title') : t('flt.viewTitle'),
                  onClick: () => { setShowFilters(!showFilters); setSortOpen(false); setAddOpen(false) }
                }, icon('sliders', 16),
                  h('span', null, isYours ? t('flt.title') : t('flt.viewPrefix') + vueLabel()),
                  filtresActifs() > 0 ? h('span', { className: 'n' }, String(filtresActifs())) : null,
                  icon('chev', 14)),
                showFilters ? renderFilters() : null),
              isFeat ? null : h('div', { className: 'kb-menu-wrap' },
                h('button', { type: 'button', className: 'kb-tool-lab' + (sortOpen ? ' on' : ''), title: t('sort.by'), onClick: () => { setSortOpen(!sortOpen); setAddOpen(false); setShowFilters(false) } }, icon('sort', 16), h('span', null, sortLabel(isYours)), icon('chev', 14)),
                sortOpen ? renderSortMenu() : null)
            ),
            // The filter panel now lives INSIDE the .kb-menu-wrap of its button
            // (anchored popover, .kb6-tb-pop convention of the pivot): no more inline card
            // pushing the list down. The state stays readable on the labelled button.
            null)
        }

        const renderTeamToolbar = () => h('div', { className: 'kb-toolbar' },
          h('div', { className: 'kb8-search' }, icon('search', 14),
            h('input', { placeholder: t('tm.search'), value: q.team, onChange: (e) => { const v = e.target.value; setQ((m) => ({ ...m, team: v })) } })),
          primary(teamRoleAdmin(tsum.role) ? t('tm.add') : t('tm.propose'), () => setTeamSheet(true), 'plus'))

        const renderTeam = () => {
          if (tsum.phase === 'loading') return skeletonOf('team', 5) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.loading')))
          if (tsum.phase !== 'ready') return h(TeamLocked, { kind: tsum.phase === 'locked' ? tsum.kind : 'other', detail: tsum.detail, onRetry: loadTeam, onBack: () => setMode('yours') })
          return h(TeamSkills, {
            sum: tsum, local: skills, roots, needle: q.team, view: teamView, onView: setTeamView, ver: teamVer, openId: teamOpen, onOpen: setTeamOpen,
            notify: setNotice, onChanged: loadCatalogue, onSummary: loadTeam
          })
        }

        const yourCard = (s, i) => {
          const k = skillKey(s)
          const on = s.active === true
          const err = errors[k]
          // The card opens its panel on the right: its inner buttons stop the propagation and keep their own action.
          const pick = () => { setLocal(s); setDetail(null); setModal(null) }
          return h('div', {
            key: k, className: 'kb8-card' + (local !== null && skillKey(local) === k ? ' sel' : '') + appear(i), role: 'button', tabIndex: 0,
            'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-card-' + k,
            onClick: pick,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }
          },
            h('div', { className: 'kb-row' },
              tile(s.name, 'pkg'),
              h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
                h('span', { className: 'kb8-name' }, s.name),
                h('span', { className: 'kb8-parent kbs-nowrap' }, (s.source || '') + ' · ' + String(s.root || ''))),
              s.writable === true
                ? h('button', {
                    type: 'button', className: 'kb-sw' + (on ? ' on' : ''), title: on ? t('card.disable') : t('card.enable'),
                    disabled: busy[k] === true, onClick: (e) => { e.stopPropagation(); toggle(s) }
                  }, h('i', null))
                : h('span', { className: 'kb8-pill' }, t('card.readonly')),
              h('button', {
                type: 'button', className: 'kbs-star-btn' + (featNames.has(s.name) ? ' on' : ''),
                title: featNames.has(s.name) ? t('feat.remove') : t('feat.add'),
                onClick: (e) => { e.stopPropagation(); toggleFeatured(s.name) }
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
                onClick: (e) => { e.stopPropagation(); copy('/' + s.name) }
              }, icon('code', 12), '/' + s.name)),
            err ? h('div', { className: 'kbs-err' }, err) : null)
        }

        // ── Ranking TABLE ─────────────────────────────────────────────────────
        // CARDS for a ranking of 9 827 rows are what made scrolling endless: six cards per screen,
        // and "Load more" at the bottom of a 3 380 px page.
        // A row is ~34 px tall: fifty fit on screen, and the pager stays fixed.
        // ── Featured: fragments of the highlighted row ────────────────────────
        // The set of featured names (found items only): the star on the Yours cards and on the
        // detail page fills from here, with no duplicated state.
        const featNames = React.useMemo(() => new Set(feat.items.filter((it) => it.found !== false).map((it) => it.name)), [feat])

        // Cover: the folder's image if it exists (as the row's small tile), otherwise the PIVOT TILE (tile(), same look
        // as the cards of the other tabs) — never a visual that falls outside the theme.
        const coverArt = (it) => {
          if (it.cover !== null && it.cover !== undefined && it.cover !== '') {
            return h('span', { className: 'kb8-tile kbs-sm kbs-cover' }, h('img', {
              src: it.cover, alt: t('cover.alt', { name: it.name }), loading: 'lazy',
              onError: (e) => { try { e.target.style.display = 'none' } catch (e2) { /* the dark tile is enough */ } }
            }))
          }
          return tile(it.name, 'pkg', 'kbs-sm')
        }

        // Featured rows are the SAME rows as the ranking below (same columns, same height): a card here and a row there made
        // the page read as two lists. A click opens the skill in Yours: the Discover panel is an INSTALL panel, it has nothing to say
        // about a local skill. The star at the left takes it off the list.
        const featRow = (it, i) => h('div', {
          key: it.name, className: 'kbs-row feat' + appear(i), 'data-kb': 'feat-row', title: it.description !== '' ? it.description : undefined,
          onClick: () => {
            // The skill's own panel when it is in the catalogue; else Yours filtered on the name, as before.
            const own = skills.find((x) => x.name === it.name)
            setMode('yours'); setDetail(null); setModal(null)
            if (own !== undefined) setLocal(own)
            else setQ((m) => ({ ...m, yours: it.name }))
          }
        },
          h('span', { className: 'rank' }, h('button', {
            type: 'button', className: 'kbs-star-btn on', title: t('feat.remove'), 'aria-label': t('feat.remove') + ' — ' + it.name,
            onClick: (e) => { e.stopPropagation(); toggleFeatured(it.name) }
          }, icon('star', 14))),
          h('span', { className: 'who' }, coverArt(it), h('span', { className: 'kb8-name' }, it.name),
            h('span', { className: 'kbs-fdesc' }, it.description !== '' ? it.description : t('card.nodesc'))),
          h('span', { className: 'kb8-parent src kbs-nowrap' }, it.source || t('feat.localskill')),
          h('span', { className: 'badges' }, it.active === false ? h('span', { className: 'kb8-pill warn' }, t('card.disabled')) : h('span', { className: 'kb8-pill ok' }, t('card.active'))),
          h('span', { className: 'inst' }, typeof it.modifiedAt === 'string' && Number.isNaN(Date.parse(it.modifiedAt)) === false ? today(it.modifiedAt) : ''))

        const installed = (x) => skills.some((s) => s.name === x.name)

        const ligne = (x, i) => h('div', {
          key: x.source + '/' + x.name,
          className: 'kbs-row' + (installed(x) ? ' has' : '') + (detail !== null && detail.source === x.source && detail.name === x.name ? ' sel' : '') + appear(i),
          onClick: () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
        },
          h('span', { className: 'rank' }, String(discFrom + i)),
          // The TILE is what makes a row belong to the same universe as the cards of the
          // other tabs (kb8-tile, kb8-name, kb8-parent, kb8-pill: the pivot's tokens).
          h('span', { className: 'who' }, tile(x.name, 'pkg', 'kbs-sm'), h('span', { className: 'kb8-name' }, x.name)),
          h('span', { className: 'kb8-parent src kbs-nowrap' }, x.source),
          h('span', { className: 'badges' },
            x.official === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : null,
            // The state is always said: « Installed » (a check), or the way to install it. Never an empty cell.
            installed(x) ? h('span', { key: 'i', className: 'kb8-pill ok kbs-instpill' }, icon('check', 12), t('row.installed')) : null,
            installed(x) !== true && x.installable === true
              ? h('button', {
                key: 'b', type: 'button', className: 'kb8-ghost kbs-rowinstall', 'data-kb': 'row-install',
                title: t('det.installTip', { source: x.source, name: x.name, dest: installDest }),
                onClick: (e) => { e.stopPropagation(); setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) }
              }, icon('dl', 13), t('btn.install'))
              : null,
            // 15 % of the catalogue is hosted outside GitHub (`well-known`): we SAY so here rather than
            // offering a button that will fail further on.
            x.installable !== true ? h('span', { key: 'w', className: 'kb8-pill warn' }, t('row.offgh')) : null),
          h('span', { className: 'inst' }, nf(x.installs)))

        // A skill of Yours as a row (the list view): the same facts and the same gestures as its card, on one line.
        const yourRow = (s, i) => {
          const k = skillKey(s)
          const on = s.active === true
          const err = errors[k]
          const pick = () => { setLocal(s); setDetail(null); setModal(null) }
          return h('div', {
            key: k, className: 'kbs-yrow' + (local !== null && skillKey(local) === k ? ' sel' : '') + appear(i), role: 'button', tabIndex: 0,
            'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-row-' + k,
            onClick: pick,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }
          },
            tile(s.name, 'pkg', 'kbs-sm'),
            h('span', { className: 'who' }, h('span', { className: 'kb8-name' }, s.name), h('span', { className: 'kb8-parent kbs-nowrap' }, (s.source || '') + ' · ' + String(s.root || ''))),
            h('span', { className: 'desc', title: s.description !== '' ? s.description : undefined }, s.description !== '' ? s.description : t('card.nodesc')),
            h('span', { className: 'kb8-pills' },
              on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
              s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
              s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.noedit')) : null),
            h('span', { className: 'when' }, s.modifiedAt !== '' ? today(s.modifiedAt) : ''),
            h('span', { className: 'acts' },
              s.writable === true
                ? h('button', {
                    type: 'button', className: 'kb-sw' + (on ? ' on' : ''), title: on ? t('card.disable') : t('card.enable'),
                    disabled: busy[k] === true, onClick: (e) => { e.stopPropagation(); toggle(s) }
                  }, h('i', null))
                : h('span', { className: 'kb8-pill' }, t('card.readonly')),
              h('button', {
                type: 'button', className: 'kbs-star-btn' + (featNames.has(s.name) ? ' on' : ''),
                title: featNames.has(s.name) ? t('feat.remove') : t('feat.add'),
                onClick: (e) => { e.stopPropagation(); toggleFeatured(s.name) }
              }, icon('star', 14))),
            err ? h('span', { className: 'kbs-err' }, err) : null)
        }

        // A ranking entry as a card (the cards view of Discover): what the row says, in a card. The click opens the same install panel.
        const discCard = (x, i) => h('div', {
          key: x.source + '/' + x.name, role: 'button', tabIndex: 0, 'data-kb': 'disc-card',
          className: 'kb8-card' + (installed(x) ? ' has' : '') + (detail !== null && detail.source === x.source && detail.name === x.name ? ' sel' : '') + appear(i),
          'aria-label': x.name + ' — ' + t('cap.detail'),
          onClick: () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) },
          onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(x); setLocal(null); setModal(null); setAudit(null) } }
        },
          h('div', { className: 'kb-row' },
            tile(x.name, 'pkg'),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
              h('span', { className: 'kb8-name' }, x.name),
              h('span', { className: 'kb8-parent kbs-nowrap' }, x.source))),
          h('div', { className: 'kb8-pills' },
            x.official === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : null,
            installed(x) ? h('span', { key: 'i', className: 'kb8-pill' }, t('row.installed')) : null,
            x.installable !== true ? h('span', { key: 'w', className: 'kb8-pill warn' }, t('row.offgh')) : null),
          h('div', { className: 'foot' }, icon('pkg', 13), h('span', null, nf(x.installs)), h('span', { className: 'grow' }), h('span', { className: 'kb8-mono' }, '#' + String(discFrom + i))))

        // A featured skill as a card: the same click as its row (it opens the skill in Yours).
        const featCard = (it, i) => h('div', {
          key: 'f:' + it.name, role: 'button', tabIndex: 0, className: 'kb8-card feat' + appear(i), 'data-kb': 'feat-card',
          title: it.description !== '' ? it.description : undefined,
          onClick: () => {
            const own = skills.find((x) => x.name === it.name)
            setMode('yours'); setDetail(null); setModal(null)
            if (own !== undefined) setLocal(own)
            else setQ((m) => ({ ...m, yours: it.name }))
          }
        },
          h('div', { className: 'kb-row' },
            coverArt(it),
            h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', flex: '1' } },
              h('span', { className: 'kb8-name' }, it.name),
              h('span', { className: 'kb8-parent kbs-nowrap' }, it.source || t('feat.localskill'))),
            h('button', {
              type: 'button', className: 'kbs-star-btn on', title: t('feat.remove'), 'aria-label': t('feat.remove') + ' — ' + it.name,
              onClick: (e) => { e.stopPropagation(); toggleFeatured(it.name) }
            }, icon('star', 14))),
          h('div', { className: 'desc' }, it.description !== '' ? it.description : t('card.nodesc')),
          h('div', { className: 'kb8-pills' }, it.active === false ? h('span', { className: 'kb8-pill warn' }, t('card.disabled')) : h('span', { className: 'kb8-pill ok' }, t('card.active'))))

        // ── Featured tab: the picks Kybernos proposes ─────────────────────────────────────────────────────
        // A pick is data (title, outcome, creator, count, audits, one cut-out) and nothing else: Install goes through the SAME confirmation
        // and the same host route as a Discover entry, Details opens the same panel (real SKILL.md, live audits), Use copies `/name`.
        const frLike = () => { const l = tlang(); return l === 'kybernos' || l.slice(0, 2).toLowerCase() === 'fr' }
        const pickText = (o) => (o !== null && typeof o === 'object' ? (frLike() ? o.fr : o.en) : '')
        const pickAsEntry = (p) => ({ id: p.source + '/' + p.id, source: p.source, name: p.id, installs: p.installs, installable: true, official: false, sourceType: 'github', url: '' })
        const PICK_CATS = ['Documents', 'Data', 'Design', 'Media', 'Research', 'Marketing', 'Automation', 'Build']
        const pickCounts = () => { const c = {}; picks.items.forEach((p) => { c[p.category] = (c[p.category] || 0) + 1 }); return c }
        const pickList = () => {
          let a = picks.items.slice()
          if (pcat !== 'all') a = a.filter((p) => p.category === pcat)
          const needle = q.featured.trim().toLowerCase()
          if (needle !== '') a = a.filter((p) => (pickText(p.title) + ' ' + p.id + ' ' + pickText(p.outcome) + ' ' + t('pcat.' + p.category) + ' ' + p.source).toLowerCase().indexOf(needle) >= 0)
          if (sort.featured === 'installs') a.sort((x, y) => (dir.featured === -1 ? y.installs - x.installs : x.installs - y.installs))
          else if (sort.featured === 'name') a.sort((x, y) => pickText(x.title).localeCompare(pickText(y.title)) * (dir.featured === -1 ? -1 : 1))
          // The user's own pins (the star) come first, whatever the order.
          return a.filter((p) => featNames.has(p.id)).concat(a.filter((p) => !featNames.has(p.id)))
        }
        // The pieces a pick shows, shared by its card and its row.
        const pickCover = (p) => (p.cover !== null && p.cover !== undefined && p.cover !== ''
          ? h('img', { className: 'kbsf-cut', src: p.cover, alt: '', loading: 'lazy', onError: (e) => { try { e.target.style.display = 'none' } catch (e2) { /* the tint is enough */ } } })
          : tile(p.id, 'pkg'))
        const pickBy = (p) => {
          const owner = String(p.source).split('/')[0]
          return h('span', { className: 'kbsf-by', title: t('pick.by', { who: owner }) },
            h('span', { className: 'kbsf-av', style: { background: 'hsl(' + hue(owner) + ' 45% 32%)' }, 'aria-hidden': 'true' }, owner.charAt(0).toUpperCase()),
            h('span', { className: 'nm' }, owner))
        }
        const pickCnt = (p) => {
          const full = t('pick.count', { n: p.installs.toLocaleString(isEn() ? 'en-US' : 'fr-FR') })
          return h('span', { className: 'kbsf-cnt', title: full, 'aria-label': full }, icon('dl', 13), nf(p.installs))
        }
        const pickPills = (p, isIn) => {
          const warns = p.audits.filter((a) => a[1] !== 'pass').length
          return h('div', { className: 'kbsf-pills' },
            isIn === true ? h('span', { key: 'in', className: 'kbsf-pill ok' }, icon('check', 12), t('pick.installed')) : null,
            p.audits.length === 0 ? null : (warns === 0
              ? h('span', { key: 'au', className: 'kbsf-pill ok', title: t('pick.auditTip') }, icon('shield', 12), t('pick.audited', { n: p.audits.length }))
              : h('span', { key: 'au', className: 'kbsf-pill warn', title: t('pick.auditTip') }, icon('alert', 12), warns === 1 ? t('pick.warn1') : t('pick.warnN', { n: warns }))),
            p.needs !== null && p.needs !== undefined ? h('span', { key: 'nd', className: 'kbsf-pill need' }, icon('info', 12), t('need.' + p.needs)) : null)
        }
        // Install (or Use when it is already there) and Details: the same two gestures in the card and in the row.
        const pickButtons = (p, x, isIn, openIt) => [
          isIn === true
            ? h('button', { key: 'use', type: 'button', className: 'kb8-ghost', 'data-kb': 'pick-use', onClick: (e) => { e.stopPropagation(); copy('/' + p.id) } }, icon('code', 14), h('span', null, t('pick.use')))
            : h('button', {
              key: 'ins', type: 'button', className: 'kb8-primary', 'data-kb': 'pick-install',
              onClick: (e) => { e.stopPropagation(); setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) }
            }, icon('dl', 14), h('span', null, t('btn.install'))),
          h('button', { key: 'det', type: 'button', className: 'kb8-ghost', 'data-kb': 'pick-details', onClick: (e) => { e.stopPropagation(); openIt() } }, h('span', null, t('pick.details')))
        ]
        const pickStar = (p, isIn, cls) => {
          const pinned = featNames.has(p.id)
          return h('button', {
            type: 'button', className: 'kbs-star-btn ' + cls + (pinned ? ' on' : ''), disabled: isIn !== true,
            title: isIn === true ? (pinned ? t('feat.remove') : t('feat.add')) : t('pick.pinNeedsInstall'),
            'aria-label': (pinned ? t('feat.remove') : t('feat.add')) + ' — ' + pickText(p.title),
            onClick: (e) => { e.stopPropagation(); toggleFeatured(p.id) }
          }, icon('star', 14))
        }
        const pickCard = (p, i) => {
          const x = pickAsEntry(p)
          const isIn = installed(x)
          const openIt = () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
          const title = pickText(p.title)
          return h('article', {
            key: 'pk:' + p.id, role: 'button', tabIndex: 0, 'data-kb': 'pick-card',
            className: 'kbsf-card' + (detail !== null && detail.source === p.source && detail.name === p.id ? ' sel' : '') + appear(i),
            title: t('pick.try') + sep() + pickText(p.prompt), 'aria-label': title + ' — ' + t('cap.detail'),
            onClick: openIt,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt() } }
          },
            h('div', { className: 'kbsf-pic kbsf-t', 'data-cat': p.category },
              pickCover(p),
              h('span', { className: 'kbsf-tag' }, t('pcat.' + p.category)),
              pickStar(p, isIn, 'kbsf-star')),
            h('div', { className: 'kbsf-body' },
              h('div', { className: 'kbsf-trow' },
                h('div', { className: 'kbsf-title' }, title),
                h('div', { className: 'kbsf-side' }, pickBy(p), pickCnt(p))),
              h('p', { className: 'kbsf-out' }, pickText(p.outcome)),
              pickPills(p, isIn),
              // The actions show on hover and on keyboard focus (always on a touch screen); their place is reserved, so the card does not jump.
              h('div', { className: 'kbsf-acts' }, pickButtons(p, x, isIn, openIt))))
        }
        // The same pick as a row (the list view): a square thumbnail, the title with its outcome and its facts, the verdicts, the actions.
        // Rows are dense and scanned: their actions are always there, not on hover.
        const pickRow = (p, i) => {
          const x = pickAsEntry(p)
          const isIn = installed(x)
          const openIt = () => { setDetail(x); setLocal(null); setModal(null); setAudit(null) }
          const title = pickText(p.title)
          return h('div', {
            key: 'pr:' + p.id, role: 'button', tabIndex: 0, 'data-kb': 'pick-row',
            className: 'kbsf-row' + (detail !== null && detail.source === p.source && detail.name === p.id ? ' sel' : '') + appear(i),
            title: t('pick.try') + sep() + pickText(p.prompt), 'aria-label': title + ' — ' + t('cap.detail'),
            onClick: openIt,
            onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt() } }
          },
            h('div', { className: 'kbsf-th kbsf-t', 'data-cat': p.category }, pickCover(p)),
            h('div', { className: 'kbsf-mn' },
              h('div', { className: 'kbsf-title' }, title),
              h('p', { className: 'kbsf-out' }, pickText(p.outcome)),
              h('div', { className: 'kbsf-meta' }, h('span', null, t('pcat.' + p.category)), pickBy(p), pickCnt(p))),
            pickPills(p, isIn),
            h('div', { className: 'kbsf-racts' }, pickStar(p, isIn, 'kbsf-rstar'), pickButtons(p, x, isIn, openIt)))
        }

        // Pager based on the SERVER `total`. We no longer load "a bit more" at the bottom of a growing list:
        // we go to the wanted page, and the number of pages is known in advance.
        // It sits under the table only: the table shows 20 rows by default, so the bottom is a short scroll away.
        const pagerIndex = () => {
          const first = Math.max(0, Math.min(discPage - 2, Math.max(0, discPages - 5)))
          const around = []
          for (let p = first; p < Math.min(discPages, first + 5); p++) around.push(p)
          return h('div', { className: 'kbs-pager' },
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

        // Yours stays small (tens of items): "Load more" is enough there, a pager would be noise.
        const pagerYours = (shown, total) => h('div', { className: 'kbs-pager' },
          shown < total
            ? h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setPage((p) => ({ ...p, yours: p.yours + 1 })) }, icon('plus', 15), ' ' + t('pg.more'))
            : null,
          h('span', { className: 't' }, t('pg.of', { a: shown, n: total })))

        const empty = (title, hint) => h('div', { className: 'kb-empty' }, icon('search', 24),
          h('span', { className: 'kb8-name' }, title), h('span', { className: 'kb8-parent' }, hint))

        const renderFeatured = () => {
          if (picks.phase === 'loading') return skeletonOf('cards', 6) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('pick.loading')))
          const counts = pickCounts()
          const list = pickList()
          return h('div', null,
            h('div', { className: 'kbsf-chips' },
              chip(t('pick.all') + ' ' + picks.items.length, pcat === 'all', () => setPcat('all'), 'all'),
              PICK_CATS.filter((c) => counts[c] > 0).map((c) => chip(t('pcat.' + c) + ' ' + counts[c], pcat === c, () => setPcat(c), c)),
              h('span', { className: 'grow' }),
              // Two small swatches rather than words, so the choice stays on the chips' row: a category tint, or the plain card surface.
              h('span', { className: 'kbsf-seg', role: 'group', 'aria-label': t('pick.bg') },
                h('button', { type: 'button', className: coverBg === 'tint' ? 'on' : '', 'aria-pressed': coverBg === 'tint' ? 'true' : 'false', title: t('pick.bg') + sep() + t('pick.bg.tint'), 'aria-label': t('pick.bg') + sep() + t('pick.bg.tint'), 'data-kb': 'pick-bg-tint', onClick: () => setCoverBg('tint') }, h('i', { className: 'sw tint' })),
                h('button', { type: 'button', className: coverBg === 'plain' ? 'on' : '', 'aria-pressed': coverBg === 'plain' ? 'true' : 'false', title: t('pick.bg') + sep() + t('pick.bg.plain'), 'aria-label': t('pick.bg') + sep() + t('pick.bg.plain'), 'data-kb': 'pick-bg-plain', onClick: () => setCoverBg('plain') }, h('i', { className: 'sw plain' })))),
            list.length === 0
              ? empty(t('pick.none'), t('pick.nonehint'))
              : (views.featured === 'list'
                ? h('div', { className: 'kbsf-list' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'picks-list' }, list.map(pickRow))
                : h('div', { className: 'kbsf-grid' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'picks-grid' }, list.map(pickCard))),
            picks.asOf !== '' ? h('div', { className: 'kbsf-foot' }, t('pick.asof', { d: today(picks.asOf) })) : null)
        }

        const renderYours = () => {
          if (catPhase === 'loading' && cat === null) return skeletonOf('cards', 6) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('y.loading')))
          if (catPhase === 'error') return h('div', { className: 'kb-empty' },
            h('span', { className: 'kb8-name' }, t('y.loadfail')), h('span', { className: 'kb8-parent' }, catError),
            h('button', { type: 'button', className: 'kb8-ghost', onClick: loadCatalogue }, t('y.retry')))
          if (filtered.length === 0) {
            return skills.length === 0
              ? empty(t('y.none'), t('y.nonehint'))
              : empty(t('y.noresult'), t('y.nofilter'))
          }
          return h('div', null,
            views.yours === 'list'
              ? h('div', { className: 'kbs-ylist', 'data-kb': 'yours-list' }, shownYours.map(yourRow))
              : h('div', { className: 'kb8-grid' }, shownYours.map(yourCard)),
            pagerYours(shownYours.length, filtered.length))
        }

        // Where the ranking comes from, and the way to change it. The address in use is shown as a host, never as a credential.
        const renderSourceLine = () => {
          if (src === null) return null
          const where = src.origin === 'env' ? t('src.env') : (src.origin === 'setting' ? t('src.custom') : t('src.default'))
          return h('div', { className: 'kbs-srcline', 'data-kb': 'index-source' },
            icon('globe', 14),
            h('span', { className: 'k' }, t('src.line')),
            src.refused === true
              ? h('span', { className: 'kb8-pill warn' }, t('src.refused'))
              : h('span', { className: 'v', title: src.url !== null ? src.url : undefined }, src.host),
            h('span', { className: 'w' }, where),
            h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'index-source-change', onClick: () => { setSrcErr(''); setSrcOpen(true) } }, t('src.change')))
        }

        // ONE list, featured first (UB-12): the featured rows are prepended to the ranking table on
        // page 1 without a search, instead of sitting in a second, separate table above it.
        const featRows = (feat.phase === 'ready' && discKind === 'index' && dneedle === '' && discPage === 0)
          ? feat.items.filter((it) => it.found !== false).map(featRow) : []
        const featCards = (feat.phase === 'ready' && discKind === 'index' && dneedle === '' && discPage === 0)
          ? feat.items.filter((it) => it.found !== false).map((it, i) => featCard(it, i)) : []
        // A column header that orders the page: the same order as the bar's (name, or installs), the same direction. A second click on the
        // column in use flips the direction; a new column starts from its natural one (A to Z, most installed first). Only the index is
        // ordered by the page: a search keeps its relevance and the curated set its install order.
        const sortHead = (label, key, cls) => {
          if (discKind !== 'index') return h('span', { className: cls }, label)
          const on = sort.discover === key
          return h('button', {
            type: 'button', className: cls + ' kbs-sorthead' + (on ? ' on' : ''), 'data-kb': 'sort-' + key,
            'aria-sort': on ? (dir.discover === -1 ? 'descending' : 'ascending') : 'none', title: t('sort.by') + sep() + label,
            onClick: () => {
              if (on) setDir((m) => ({ ...m, discover: -m.discover }))
              else { setSort((m) => ({ ...m, discover: key })); setDir((m) => ({ ...m, discover: key === 'name' ? 1 : -1 })) }
            }
          }, label, on ? h('span', { className: 'arr', 'aria-hidden': 'true' }, dir.discover === -1 ? '↓' : '↑') : null)
        }
        const renderDiscover = () => {
          const sourceLine = renderSourceLine()
          if (discPhase === 'loading' && disc === null) {
            // Bones: the featured list (known already), a pager's worth of space, then rows in the ranking's own grid.
            const bones = skeletonOf('rows', 8)
            return h('div', null, sourceLine,
              bones === null ? h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('d.query')))
                : h('div', { key: 'sk' }, bones))
          }
          if (discPhase === 'error') {
            // The failure is THIS tab's: Yours and Team do not depend on the index and are untouched. A clear sentence, a way to
            // ask again, and — the address being the user's to change — a way to change it.
            const refused = discErr !== null && discErr.code === 'index_url_refused'
            return h('div', null,
              h('div', { className: 'kb-empty', role: 'alert', 'data-kb': 'disc-error' },
                icon('alert', 24),
                h('span', { className: 'kb8-name' }, t('d.down')),
                h('span', { className: 'kb8-parent' }, discErr !== null ? discErr.text : ''),
                refused === true ? null : h('span', { className: 'kb8-parent' }, t('d.hint')),
                h('div', { className: 'kb-row', style: { justifyContent: 'center', marginTop: '4px' } },
                  refused === true ? null : h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'disc-retry', onClick: retryDiscover }, icon('refresh', 15), h('span', null, t('d.retry'))),
                  src !== null && src.editable !== false
                    ? h('button', { type: 'button', className: refused === true ? 'kb8-primary' : 'kb8-ghost', 'data-kb': 'disc-change-source', onClick: () => { setSrcErr(''); setSrcOpen(true) } }, t('src.change'))
                    : null),
                h('span', { className: 'kb8-parent' }, t('d.direct'))))
          }
          return h('div', null,
            sourceLine,
            views.discover === 'cards'
              ? (discShown.length === 0 && featCards.length === 0
                ? empty(t('y.noresult'), discKind === 'search' ? t('d.empty.search') : t('d.empty.page'))
                : h('div', { className: 'kb8-grid' + (discPhase === 'loading' ? ' loading' : ''), 'data-kb': 'discover-cards' }, featCards.concat(discShown.map(discCard))))
              : h('div', { className: 'kbs-table' + (discPhase === 'loading' ? ' loading' : '') },
              h('div', { className: 'kbs-head' },
                h('span', { className: 'rank' }, '#'),
                sortHead(discKind === 'search' ? t('th.result') : 'SKILL', 'name', 'who'),
                h('span', { className: 'src' }, 'SOURCE'),
                h('span', { className: 'badges' }, t('th.state')),
                sortHead('INSTALLATIONS', 'installs', 'inst')),
              discShown.length === 0
                ? empty(t('y.noresult'), discKind === 'search' ? t('d.empty.search') : t('d.empty.page'))
                : featRows.concat(discShown.map(ligne))),
            discShown.length === 0 ? null : pagerIndex())
        }

        // ── the right-hand panels (the list stays next to them) ───────────────────────────────────────
        // The folder an install writes into: the user's own skills folder when it is among the writable ones the host named, else the first
        // writable one. `roots` are the host's WRITABLE roots (GET status), never the project's read-only ones.
        const installDest = (roots.find((r) => r.source === 'user-dsh') || roots[0] || { path: '~/.dsh/skills' }).path
        const curatedOf = (x) => ({
          owner: curatedOwners !== null ? curatedOwners.byRepo[x.source] : undefined,
          curated: x.official === true || (curatedOwners !== null && curatedOwners.ids.has(x.source + '/' + x.name))
        })

        // One call for the three actions that go through the host; what comes back is announced, and the list is read again.
        const skillAct = (kind, s) => {
          const k = 'act:' + kind + ':' + skillKey(s)
          if (busy[k] === true) return
          setBusy((m) => ({ ...m, [k]: true }))
          const target = kind === 'reveal' ? 'folder' : (kind === 'edit' ? 'file' : undefined)
          const path = kind === 'duplicate' ? '/kybernos-skills/skill/duplicate' : (kind === 'delete' ? '/kybernos-skills/skill/delete' : '/kybernos-skills/skill/reveal')
          const done = () => setBusy((m) => { const n = { ...m }; delete n[k]; return n })
          postJson(path, { root: s.root, name: s.name, target }).then((j) => {
            if (alive.current !== true) return
            done()
            if (j === null || typeof j !== 'object' || j.ok !== true) {
              setAskDelete(null)
              setNotice({ kind: 'err', text: why(j, t('err.unexpected', { r: kind })) })
              return
            }
            if (kind === 'delete') {
              setAskDelete(null); setLocal(null); loadCatalogue()
              setNotice({ kind: 'ok', text: t('notice.deleted', { name: s.name }) })
            } else if (kind === 'duplicate') {
              loadCatalogue()
              if (j.skill !== null && typeof j.skill === 'object') setLocal(j.skill)
              setNotice({ kind: 'ok', text: t('notice.duplicated', { name: s.name, copy: j.name }) })
            } else setNotice({ kind: 'ok', text: t('notice.opened') })
          }).catch(() => {
            if (alive.current !== true) return
            done(); setAskDelete(null)
            setNotice({ kind: 'err', text: t('err.unavail', { r: kind }) })
          })
        }

        // ── Featured: a pick, opened. It uses the width of the page instead of a side panel: the picture and the title as on the card, big, then
        // the facts, the audits and the start of SKILL.md side by side. The data is what the Discover panel already reads (the repository's
        // real SKILL.md, the live audits); only the arrangement is new.
        const renderPickDetail = () => {
          const p = picks.items.find((it) => detail !== null && it.source === detail.source && it.id === detail.name)
          if (p === undefined) return renderFeatured()
          const x = pickAsEntry(p)
          const isIn = installed(x)
          const pv = preview.state === 'ready' && preview.data !== null ? preview.data : null
          const ghUrl = pv !== null && typeof pv.url === 'string' && pv.url !== '' ? pv.url : 'https://github.com/' + p.source
          const c = curatedOf(x)
          const publisher = c.owner !== undefined && c.owner !== '' ? c.owner : String(p.source).split('/')[0]
          const row = (label, value, key) => h('div', { key, className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
          const folderText = pv !== null ? (pv.folder !== '' ? pv.folder : t('dp.root')) : (preview.state === 'loading' ? t('dp.loading') : t('dp.folderUnknown'))
          let skillText = null
          if (preview.state === 'loading') skillText = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, t('dp.loading'))
          else if (pv !== null) skillText = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, pv.text + (pv.truncated === true ? '\n…' : ''))
          else if (preview.state === 'missing') skillText = h('div', { className: 'kb-note', 'data-kb': 'preview-missing' }, icon('info', 14), h('span', null, t('dp.notfound', { name: p.id })))
          else if (preview.state === 'error') skillText = h('div', { className: 'kb-note', 'data-kb': 'preview-error' }, icon('info', 14), h('span', null, t('dp.nopreview', { why: preview.error })))
          const auditLines = audit === null || audit === undefined || audit.phase === 'loading'
            ? h('span', { className: 'kb8-mono' }, t('det.auditLoading'))
            : (audit.phase === 'error'
              ? h('span', { className: 'ligne' }, audit.error)
              : (audit.audits.length === 0
                ? h('span', { className: 'kb8-mono' }, t('det.auditNone'))
                : audit.audits.map((a, i) => h('div', { key: 'a' + i, className: 'ligne' },
                  h('span', { className: 'kb8-pill ' + (a.status === 'pass' ? 'ok' : 'warn') }, a.status === 'pass' ? t('det.audited') : (a.status !== '' ? a.status : t('det.unknown'))),
                  h('span', null, a.provider + (a.summary !== '' ? ' — ' + a.summary : ''))))))
          const title = pickText(p.title)
          return h('article', { className: 'kbsf-detail' + (coverBg === 'plain' ? ' kbsf-plain' : ''), 'data-kb': 'pick-detail', 'aria-label': title },
            h('button', { type: 'button', className: 'kbs-link kbsf-dback', 'data-kb': 'pick-back', onClick: () => setDetail(null) }, icon('back', 14), ' ' + t('pick.back')),
            h('div', { className: 'kbsf-dhero' },
              h('div', { className: 'kbsf-dpic kbsf-t', 'data-cat': p.category },
                pickCover(p),
                h('span', { className: 'kbsf-tag' }, t('pcat.' + p.category))),
              h('div', { className: 'kbsf-dtx' },
                h('h2', { className: 'kbsf-dtitle' }, title),
                h('div', { className: 'kbsf-meta' }, pickBy(p), pickCnt(p), h('span', { className: 'kb8-mono' }, '/' + p.id)),
                h('p', { className: 'kbsf-dout' }, pickText(p.outcome)),
                pickPills(p, isIn),
                h('div', { className: 'kbsf-dacts' },
                  isIn === true
                    ? h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'pick-use', onClick: () => copy('/' + p.id) }, icon('code', 15), h('span', null, t('pick.use')))
                    : h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'pick-install', onClick: () => { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) } }, icon('dl', 15), h('span', null, t('btn.install'))),
                  h('a', { href: ghUrl, target: '_blank', rel: 'noreferrer', className: 'kb8-ghost', 'data-kb': 'act-github' }, icon('github', 15), h('span', null, t('dp.viewgh'))),
                  pickStar(p, isIn, 'kbsf-rstar')),
                h('div', { className: 'kbsf-try' },
                  h('span', { className: 'kb-section-label' }, t('pick.try')),
                  h('span', { className: 'kbsf-trytxt' }, pickText(p.prompt)),
                  h('button', { type: 'button', className: 'kbs-link', 'data-kb': 'pick-copyprompt', onClick: () => copy('/' + p.id + ' ' + pickText(p.prompt)) }, icon('code', 13), ' ' + t('pick.copyPrompt'))))),
            h('div', { className: 'kbsf-dcols' },
              h('section', { className: 'kbsf-dcard' },
                h('span', { className: 'kb-section-label' }, t('pick.facts')),
                pv !== null && pv.description !== '' ? h('p', { className: 'kbs-desc', 'data-kb': 'preview-desc' }, pv.description) : null,
                h('div', { className: 'kb-local-rows' },
                  row(t('det.row.repo'), 'github.com/' + p.source, 'repo'),
                  row(t('dp.folder'), folderText, 'folder'),
                  row(t('det.row.owner'), publisher, 'owner'),
                  row(t('det.row.installs'), nf(p.installs), 'installs'),
                  row(t('det.row.type'), 'github', 'type'))),
              h('section', { className: 'kbsf-dcard kbs-audit' },
                h('span', { className: 'kb8-mono' }, icon('shield', 14), ' ' + t('det.audits')),
                auditLines,
                h('span', { className: 'kb8-mono' }, t('det.thirdParty')))),
            h('section', { className: 'kbsf-dcard' },
              h('span', { className: 'kb-section-label' }, t('dp.start')),
              skillText))
        }

        const renderPanel = () => {
          if (mode === 'yours' && local !== null) {
            const s = skills.find((x) => skillKey(x) === skillKey(local)) || local
            return h(SkillPanel, {
              s, read: localRead, err: errors[skillKey(s)],
              busyKind: ['reveal', 'edit', 'duplicate', 'delete'].find((kd) => busy['act:' + kd + ':' + skillKey(s)] === true) || '',
              onClose: () => setLocal(null), onAct: (kind) => { if (kind === 'delete') setAskDelete(s); else skillAct(kind, s) }, onCopy: copy
            })
          }
          if (mode === 'discover' && detail !== null) {
            const x = detail
            const c = curatedOf(x)
            return h(DiscoverPanel, {
              x, preview, audit, dest: installDest, crumb: 'Discover', owner: c.owner, curated: c.curated, installed: skills.some((s) => s.name === x.name),
              starred: featNames.has(x.name), onClose: () => setDetail(null),
              onInstall: () => { setAskInstall(x); setErrors((m) => { const n = { ...m }; delete n.__modal; return n }) },
              onStar: () => toggleFeatured(x.name)
            })
          }
          return null
        }

        const renderModal = () => {
          if (srcOpen === true) return h(SourceModal, { source: src, busy: srcBusy, error: srcErr, onClose: () => setSrcOpen(false), onSubmit: saveSource })
          if (teamSheet === true && tsum.phase === 'ready') return h(ProposeSheet, {
            local: skills, ws: tsum.workspaceName || '', admin: teamRoleAdmin(tsum.role), onClose: () => setTeamSheet(false),
            onDone: (name) => {
              setTeamSheet(false); setTeamView(teamRoleAdmin(tsum.role) ? 'approved' : 'mine'); setTeamVer((n) => n + 1); loadTeam()
              setNotice({ kind: 'ok', text: t(teamRoleAdmin(tsum.role) ? 'tm.n.added' : 'tm.n.proposed', { name }) })
            }
          })
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
          if (askDelete !== null) return h(DeleteConfirm, {
            s: askDelete, files: localRead.state === 'ready' && localRead.data !== null ? localRead.data.files : null,
            busy: busy['act:delete:' + skillKey(askDelete)] === true,
            onClose: () => setAskDelete(null), onConfirm: () => skillAct('delete', askDelete)
          })
          if (askInstall !== null) return h(InstallConfirm, {
            x: askInstall, dest: installDest, folder: preview.state === 'ready' && preview.data !== null ? preview.data.folder : null,
            busy: busy.__modal === true, error: errors.__modal,
            onClose: () => setAskInstall(null),
            onConfirm: () => {
              const x = askInstall
              setBusy((m) => ({ ...m, __modal: true }))
              postJson('/kybernos-skills/install', { source: x.source, name: x.name, root: installDest }).then((j) => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                if (j !== null && typeof j === 'object' && j.ok === true) {
                  // From Featured we stay on Featured: the card turns to « Installed » in place. From Discover the new skill opens in Yours.
                  const fromFeatured = mode === 'featured'
                  setAskInstall(null); if (fromFeatured !== true) setDetail(null); setMode(fromFeatured ? 'featured' : 'yours'); loadCatalogue()
                  if (fromFeatured !== true && j.skill !== null && typeof j.skill === 'object') setLocal(j.skill)
                  setNotice({ kind: 'ok', text: t('notice.installed', { name: x.name }) + (j.files ? t('notice.files', { n: j.files }) : '') })
                } else setErrors((m) => ({ ...m, __modal: why(j, t('err.install')) }))
              }).catch(() => {
                if (alive.current !== true) return
                setBusy((m) => { const n = { ...m }; delete n.__modal; return n })
                setErrors((m) => ({ ...m, __modal: t('err.unavail', { r: 'install' }) }))
              })
            }
          })
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

        const panel = renderPanel()
        const list = h('div', null, mode === 'featured' ? (detail !== null ? renderPickDetail() : renderFeatured()) : (mode === 'yours' ? renderYours() : (mode === 'team' ? renderTeam() : renderDiscover())))
        const body = panel === null
          ? list
          : h('div', { className: 'kbs-split open' }, h('div', { className: 'kbs-list' }, list), panel)

        // (1 Oct) Same header as "Connections": title + subtitle on the left, main action on the right, then a
        // control row (sub-tabs on the left, search / filter / sort on the right).
        const capTxt = mode === 'featured'
          ? t('cap.featured')
          : mode === 'yours'
          ? t('cap.yours', { a: activeCount, n: skills.length })
          : (mode === 'team' ? (tsum.phase === 'ready' ? t('cap.team', { ws: tsum.workspaceName || '…' }) : t('cap.teamLocked')) : (discKind === 'search' ? t('cap.search') : t('cap.rank')))
        // The shared bar (search, filter, order, and the primary action as its trailing item) sits in the header row, where Agent
        // Teams, Creations, Automations, Workspaces and Connectors put it. The page receives it as props from kybernos-plugin (a
        // bundle cannot see KbToolbar); mounted alone, it keeps its own controls on the tabs' row, as before.
        const tools = props !== null && props !== undefined && props.toolbar !== null && typeof props.toolbar === 'object' ? props.toolbar : null
        const KbBar = tools !== null && typeof tools.KbToolbar === 'function' ? tools.KbToolbar : null
        const barState = () => {
          if (mode === 'featured') {
            return { query: q.featured, sort: sort.featured, dir: dir.featured === -1 ? 'desc' : 'asc', types: pcat === 'all' ? [] : ['cat:' + pcat], period: 'all', fav: false, viewMode: views.featured }
          }
          if (mode === 'discover') {
            return { query: q.discover, sort: sort.discover === 'name' ? 'name' : (iview === 'all-time' ? 'installs' : iview), dir: dir.discover === -1 ? 'desc' : 'asc', types: iper === DISC_PER ? [] : ['rows:' + iper], period: 'all', fav: false, viewMode: views.discover }
          }
          const types = []
          if (stateFilter !== 'all') types.push('st:' + stateFilter)
          if (sourceFilter !== 'all') types.push('src:' + sourceFilter)
          return { query: q[mode], sort: sort.yours, dir: dir.yours === -1 ? 'desc' : 'asc', types: mode === 'yours' ? types : [], period: 'all', fav: false, viewMode: views.yours }
        }
        // The bar's changes go to the page's own setters. The two filter groups of Yours (state, source) and the rows of Discover are
        // single choices: the one just ticked replaces the previous one of its group.
        const barUpdate = (patch) => {
          if (patch === null || typeof patch !== 'object') return
          if (mode === 'featured') {
            if (patch.query !== undefined) { const v = String(patch.query); setQ((m) => ({ ...m, featured: v })); setDetail(null) }
            if (patch.viewMode !== undefined) { setView('featured', patch.viewMode === 'list' ? 'list' : 'cards'); setDetail(null) }
            if (patch.sort !== undefined) {
              const k2 = ['editorial', 'installs', 'name'].indexOf(patch.sort) >= 0 ? patch.sort : 'editorial'
              // A new order starts from its natural direction: Most installed high to low, Name A to Z.
              setSort((m) => ({ ...m, featured: k2 })); setDir((m) => ({ ...m, featured: k2 === 'name' ? 1 : -1 }))
            }
            if (patch.dir !== undefined) setDir((m) => ({ ...m, featured: patch.dir === 'asc' ? 1 : -1 }))
            if (patch.types !== undefined) {
              const cur = pcat === 'all' ? [] : ['cat:' + pcat]
              const added = patch.types.filter((x2) => cur.indexOf(x2) < 0)
              setPcat(added.length > 0 ? String(added[added.length - 1]).slice(4) : 'all'); setDetail(null)
            }
            return
          }
          if (patch.query !== undefined) { const v = String(patch.query); setQ((m) => ({ ...m, [mode]: v })) }
          if (patch.viewMode !== undefined && (mode === 'yours' || mode === 'discover')) setView(mode, patch.viewMode === 'list' ? 'list' : 'cards')
          if (mode === 'discover') {
            if (patch.sort !== undefined) {
              if (patch.sort === 'name') setSort((m) => ({ ...m, discover: 'name' }))
              else { setSort((m) => ({ ...m, discover: 'installs' })); setIview(patch.sort === 'installs' ? 'all-time' : String(patch.sort)) }
            }
            if (patch.dir !== undefined) setDir((m) => ({ ...m, discover: patch.dir === 'asc' ? 1 : -1 }))
            if (patch.types !== undefined) {
              const cur = iper === DISC_PER ? [] : ['rows:' + iper]
              const added = patch.types.filter((x) => cur.indexOf(x) < 0)
              const pick = added.length > 0 ? String(added[added.length - 1]) : ''
              setIper(/^rows:\d+$/.test(pick) ? Number(pick.slice(5)) : DISC_PER)
            }
            return
          }
          if (patch.sort !== undefined) setSort((m) => ({ ...m, yours: String(patch.sort) }))
          if (patch.dir !== undefined) setDir((m) => ({ ...m, yours: patch.dir === 'asc' ? 1 : -1 }))
          if (patch.types !== undefined && mode === 'yours') {
            const cur = barState().types
            let st = stateFilter
            let so = sourceFilter
            for (const x of cur) if (patch.types.indexOf(x) < 0) { if (String(x).startsWith('st:')) st = 'all'; else so = 'all' }
            for (const x of patch.types) {
              if (cur.indexOf(x) >= 0) continue
              if (String(x).startsWith('st:')) st = String(x).slice(3)
              else if (String(x).startsWith('src:')) so = String(x).slice(4)
            }
            setStateFilter(st); setSourceFilter(so)
          }
        }
        const barSorts = () => (mode === 'featured'
          ? [{ id: 'editorial', label: t('sort.editorial') }, { id: 'installs', label: t('sort.installs') }, { id: 'name', label: t('sort.name') }]
          : mode === 'discover'
          ? VUES.map((v) => ({ id: v[0] === 'all-time' ? 'installs' : v[0], label: v[1] })).concat([{ id: 'name', label: t('sort.name') }])
          : [{ id: 'recent', label: t('sort.recent') }, { id: 'name', label: t('sort.name') }])
        const barFacets = () => (mode === 'featured'
          ? { type: { options: PICK_CATS.filter((c) => pickCounts()[c] > 0).map((c) => ({ id: 'cat:' + c, label: t('pcat.' + c), count: pickCounts()[c] })) } }
          : mode === 'discover'
          ? { type: { options: [DISC_PER, 50, 100, 250].map((n) => ({ id: 'rows:' + n, label: t('flt.rows') + ': ' + n })) } }
          : { type: { options: [{ id: 'st:active', label: t('card.active'), count: activeCount }, { id: 'st:disabled', label: t('card.disabled'), count: skills.length - activeCount }]
            .concat(sources.map((s) => ({ id: 'src:' + s, label: s, count: skills.filter((x) => x.source === s).length }))) } })
        const teamBarShown = mode === 'team' && tsum.phase === 'ready' && teamOpen === null
        const barShown = KbBar !== null && (mode === 'discover' || (mode === 'featured' && picks.phase === 'ready') || (mode === 'yours' && skills.length > 0) || teamBarShown)
        const teamAction = primary(teamRoleAdmin(tsum.role) ? t('tm.add') : t('tm.propose'), () => setTeamSheet(true), 'plus')
        const headAction = mode === 'team' ? (teamBarShown ? teamAction : null) : renderAdd()
        const helpBtn = (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-skills' }) : null)
        // The animated help: opens the first time the page is visited (the hub remembers it was closed), and the card of the button above can bring it back.
        const introNode = (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Intro
          ? h(window.__KB_HELP__.Intro, {
            id: 'kybernos-skills',
            title: t('intro.title'),
            caption: t('intro.caption'),
            steps: [{ t: t('intro.s1t'), b: t('intro.s1b') }, { t: t('intro.s2t'), b: t('intro.s2b') }, { t: t('intro.s3t'), b: t('intro.s3b') }],
            mock: { bar: 'Skills', rows: [t('intro.m.row')], hot: 'PDF', states: [t('intro.m.st1'), t('intro.m.st2'), t('intro.m.st3')], actions: [t('btn.install'), t('intro.m.st2'), t('intro.m.open')] }
          })
          : null)
        return h('div', { className: 'kbs-root' },
          KbBar !== null
            ? h('div', { className: 'kb6-headrow' },
              h('div', { className: 'kb6-headcol' },
                h('div', { className: 'kb6-titlerow' }, h('h1', { className: 'kb6-title' }, 'Skills'), helpBtn),
                h('p', { className: 'kb8-sub', title: capTxt }, capTxt)),
              barShown === true
                ? h(KbBar, {
                  state: barState(),
                  onUpdate: barUpdate,
                  searchPlaceholder: mode === 'team' ? t('tm.search') : (mode === 'featured' ? t('ph.featured') : (mode === 'yours' ? t('ph.yours') : t('ph.discover'))),
                  sortOptions: mode === 'team' ? [] : barSorts(),
                  hideSort: mode === 'team',
                  facets: mode === 'team' ? {} : barFacets(),
                  total: mode === 'featured' ? picks.items.length : (mode === 'yours' ? skills.length : (mode === 'discover' ? discTotal : 0)),
                  shown: mode === 'featured' ? pickList().length : (mode === 'yours' ? filtered.length : (mode === 'discover' ? discList.length : 0)),
                  hideView: mode === 'team',
                  views: ['cards', 'list'],
                  showFav: false,
                  trailing: headAction,
                })
                : h('div', { className: 'kb6-headacts' }, headAction))
            : h('div', { className: 'kbs-top' },
              h('div', { className: 'kbs-top-txt' },
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } }, helpBtn),
                h('h2', { className: 'kbs-h1' }, 'Skills'),
                h('p', { className: 'kbs-sub', title: capTxt }, capTxt)),
              mode !== 'team' ? renderAdd() : null),
          introNode,
          h('div', { className: 'kbs-ctlrow' },
            h('nav', { className: 'kbsub' },
              // Same capsule as the "Connections" sub-tabs (Your connections / Discover): one single language.
              h('div', { className: 'kbsub-group', role: 'tablist' },
                picks.phase !== 'absent' ? h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'featured' ? 'true' : 'false', className: 'kb-seg' + (mode === 'featured' ? ' on' : ''), 'data-kb': 'seg-featured', onClick: () => { setMode('featured'); setDetail(null); setLocal(null) } },
                  'Featured ', h('span', { className: 'count' }, picks.phase === 'ready' ? String(picks.items.length) : '—')) : null,
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'yours' ? 'true' : 'false', className: 'kb-seg' + (mode === 'yours' ? ' on' : ''), onClick: () => { setMode('yours'); setDetail(null); setLocal(null) } },
                  'Yours ', h('span', { className: 'count' }, count)),
                h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'discover' ? 'true' : 'false', className: 'kb-seg' + (mode === 'discover' ? ' on' : ''), onClick: () => { setMode('discover'); setDetail(null); setLocal(null) } },
                  'Discover ', h('span', { className: 'count' }, disc !== null && Array.isArray(disc.skills) ? String(disc.skills.length) : '—')),
                tsum.phase !== 'absent' ? h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'team' ? 'true' : 'false', className: 'kb-seg' + (mode === 'team' ? ' on' : ''), onClick: () => { setMode('team'); setDetail(null); setLocal(null); setTeamOpen(null) } },
                  'Team ', tsum.phase === 'ready' ? h('span', { className: 'count' }, String((tsum.counts && tsum.counts.approved) || 0)) : (tsum.phase === 'locked' ? icon('lock', 13) : h('span', { className: 'count' }, '—')),
                  tsum.phase === 'ready' && teamRoleAdmin(tsum.role) && tsum.counts && tsum.counts.pending > 0 ? h('span', { className: 'kbt-dot', title: t('tm.v.review') }) : null) : null)),
            KbBar !== null ? null : (mode === 'team' ? (tsum.phase === 'ready' && teamOpen === null ? renderTeamToolbar() : null) : renderToolbar())),
          h('div', { className: 'kb8-page' }, body),
          renderModal(),
          notice !== null ? h('div', { className: 'kbs-toast' + (notice.kind === 'err' ? ' err' : '') },
            icon(notice.kind === 'err' ? 'info' : 'check', 15), h('span', null, notice.text)) : null)
      }

      // A skill of Yours, opened: the real SKILL.md, where it lives, and what the host will let the screen do with it. The actions are only
      // the ones the host's answer lists (`read.data.actions`): a host that has not been restarted lists none, and none is drawn.
      function SkillPanel(props) {
        const s = props.s
        const r = props.read
        const ready = r.state === 'ready' && r.data !== null
        const acts = ready && r.data.actions !== null && typeof r.data.actions === 'object' ? r.data.actions : {}
        const folder = ready && typeof r.data.folder === 'string' ? r.data.folder : (typeof s.folder === 'string' ? s.folder : '')
        const on = s.active === true
        const busy = props.busyKind !== ''
        const act = (kind, label, tip, cls) => acts[kind] === true
          ? h('button', { key: kind, type: 'button', className: cls, 'data-kb': 'act-' + kind, title: tip, disabled: busy, onClick: () => props.onAct(kind) }, label)
          : null
        return h('aside', { className: 'kbs-panel', 'aria-label': s.name + ' — ' + t('cap.detail'), 'data-kb': 'skill-panel' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, 'Yours › ' + s.name),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          h('div', { className: 'kb-detail-head' },
            tile(s.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('span', { className: 'kb8-h1', style: { fontSize: '19px', overflowWrap: 'anywhere' } }, s.name),
              h('div', { className: 'kb8-pills' },
                on ? h('span', { key: 'st', className: 'kb8-pill ok' }, t('card.active')) : h('span', { key: 'st', className: 'kb8-pill warn' }, t('card.disabled')),
                s.collision === true ? h('span', { key: 'co', className: 'kb8-pill warn' }, t('card.dup')) : null,
                s.writable !== true ? h('span', { key: 'ro', className: 'kb8-pill' }, t('card.readonly')) : null))),
          h('div', { className: 'kb-local-rows' },
            h('div', { className: 'row' }, h('span', null, t('det.root')),
              h('span', { className: 'kb8-mono kbs-path', title: folder }, folder !== '' ? folder : String(s.root || ''),
                folder !== '' ? h('button', { type: 'button', className: 'kbs-copy', title: t('panel.copyPath'), onClick: () => props.onCopy(folder) }, icon('code', 12)) : null)),
            h('div', { className: 'row' }, h('span', null, t('det.modified')), h('span', { className: 'kb8-mono' }, s.modifiedAt !== '' ? today(s.modifiedAt) : t('det.unknownDate'))),
            s.description !== '' ? h('div', { className: 'row' }, h('span', null, t('det.local.what')), h('span', null, s.description)) : null,
            s.whenToUse !== undefined && s.whenToUse !== null && String(s.whenToUse).trim() !== ''
              ? h('div', { className: 'row' }, h('span', null, t('det.local.when')), h('span', null, String(s.whenToUse).trim()))
              : null),
          h('span', { className: 'kb-section-label' }, 'SKILL.md'),
          r.state === 'error'
            ? h('div', { className: 'kbs-err', role: 'alert' }, r.error)
            : h('pre', { className: 'kb-local-body', 'data-kb': 'skill-text' }, ready ? r.data.text : t('det.local.loading')),
          ready && r.data.truncated === true ? h('span', { className: 'kb8-mono' }, t('panel.truncated')) : null,
          ready && r.data.files > 0 ? h('span', { className: 'kb8-mono' }, t('panel.files', { n: r.data.files + (r.data.filesMore === true ? '+' : '') })) : null,
          props.err ? h('div', { className: 'kbs-err' }, props.err) : null,
          h('div', { className: 'kbs-panel-acts' },
            act('reveal', h('span', null, t('act.reveal')), t('act.reveal.tip'), 'kb8-primary'),
            act('edit', h('span', null, t('act.edit')), t('act.edit.tip'), 'kb8-ghost'),
            act('duplicate', h('span', null, t('act.duplicate')), t('act.duplicate.tip'), 'kb8-ghost'),
            act('delete', h('span', null, t('act.delete')), t('act.delete.tip'), 'kb8-ghost warn')),
          ready && s.writable !== true ? h('span', { className: 'kb8-mono' }, t('act.readonly')) : null)
      }

      // A Discover card, opened: its own repository, folder, description and the start of its SKILL.md (read from the repository by the
      // host), who publishes it, its audits, and Install — which asks first.
      function DiscoverPanel(props) {
        const x = props.x
        const p = props.preview
        const pv = p.state === 'ready' && p.data !== null ? p.data : null
        const publisher = props.owner !== undefined && props.owner !== '' ? props.owner : String(x.source || '').split('/')[0]
        const audit = props.audit
        const ghUrl = pv !== null && typeof pv.url === 'string' && pv.url !== '' ? pv.url : 'https://github.com/' + x.source
        const row = (label, value, key) => h('div', { key, className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
        const folderText = pv !== null ? (pv.folder !== '' ? pv.folder : t('dp.root'))
          : (p.state === 'loading' ? t('dp.loading') : t('dp.folderUnknown'))
        let text = null
        if (p.state === 'loading') text = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, t('dp.loading'))
        else if (pv !== null) text = h('pre', { className: 'kb-local-body', 'data-kb': 'preview-text' }, pv.text + (pv.truncated === true ? '\n…' : ''))
        else if (p.state === 'missing') text = h('div', { className: 'kb-note', 'data-kb': 'preview-missing' }, icon('info', 14), h('span', null, t('dp.notfound', { name: x.name })))
        else if (p.state === 'error') text = h('div', { className: 'kb-note', 'data-kb': 'preview-error' }, icon('info', 14), h('span', null, t('dp.nopreview', { why: p.error })))
        else if (p.state === 'none') text = h('div', { className: 'kb-note', 'data-kb': 'preview-none' }, icon('info', 14), h('span', null, x.sourceType === 'well-known' ? t('row.cantInstall.wk') : t('row.cantInstall.ng')))
        return h('aside', { className: 'kbs-panel', 'aria-label': x.name + ' — ' + t('cap.detail'), 'data-kb': 'disc-panel' },
          h('div', { className: 'kbs-panel-top' },
            h('span', { className: 'kb8-mono kbs-nowrap' }, (props.crumb || 'Discover') + ' › ' + x.name),
            h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('panel.close'), title: t('panel.close'), onClick: props.onClose }, '✕')),
          h('div', { className: 'kb-detail-head' },
            tile(x.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('span', { className: 'kb8-h1', style: { fontSize: '19px', overflowWrap: 'anywhere' } }, x.name),
              h('div', { className: 'kb8-pills' },
                props.curated === true ? h('span', { key: 'o', className: 'kb8-pill ok' }, 'curated') : h('span', { key: 'o', className: 'kb8-pill' }, t('row.community')),
                props.installed === true ? h('span', { key: 'i', className: 'kb8-pill' }, t('row.already')) : null))),
          pv !== null && pv.description !== '' ? h('p', { className: 'kbs-desc', 'data-kb': 'preview-desc' }, pv.description) : null,
          h('div', { className: 'kb-local-rows' },
            row(t('det.row.repo'), 'github.com/' + x.source, 'repo'),
            row(t('dp.folder'), folderText, 'folder'),
            row(t('det.row.owner'), publisher, 'owner'),
            row(t('det.row.installs'), nf(x.installs), 'installs'),
            row(t('det.row.type'), x.sourceType !== '' && x.sourceType !== undefined ? String(x.sourceType) : t('det.unknownSrc'), 'type'),
            x.url !== '' && x.url !== undefined && x.url !== null
              ? h('div', { key: 'page', className: 'row' }, h('span', null, t('det.row.page')),
                  h('a', { href: String(x.url), target: '_blank', rel: 'noreferrer', className: 'kb8-mono', style: { overflowWrap: 'anywhere', color: 'var(--dsw-alias-brand-primary,#4f8cff)' } }, String(x.url)))
              : null),
          h('span', { className: 'kb-section-label' }, t('dp.start')),
          text,
          h('div', { className: 'kbs-audit', style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '11px' } },
            h('span', { className: 'kb8-mono' }, icon('shield', 14), ' ' + t('det.audits')),
            audit === null || audit === undefined || audit.phase === 'loading'
              ? h('span', { className: 'kb8-mono' }, t('det.auditLoading'))
              : (audit.phase === 'error'
                ? h('span', { className: 'ligne' }, audit.error)
                : (audit.audits.length === 0
                  ? h('span', { className: 'kb8-mono' }, t('det.auditNone'))
                  : audit.audits.map((a, i) => h('div', { key: 'a' + i, className: 'ligne' },
                      h('span', { className: 'kb8-pill ' + (a.status === 'pass' ? 'ok' : 'warn') }, a.status === 'pass' ? t('det.audited') : (a.status !== '' ? a.status : t('det.unknown'))),
                      h('span', null, a.provider + (a.summary !== '' ? ' — ' + a.summary : '')))))),
            h('span', { className: 'kb8-mono' }, t('det.thirdParty'))),
          h('div', { className: 'kbs-panel-acts' },
            x.installable === true && props.installed !== true
              ? h('button', {
                  type: 'button', className: 'kb8-primary', 'data-kb': 'act-install',
                  title: t('det.installTip', { source: x.source, name: x.name, dest: props.dest }), onClick: props.onInstall
                }, icon('plus', 15), h('span', null, t('btn.install')))
              : (x.installable === true
                ? h('button', {
                    type: 'button', className: 'kbs-star-btn' + (props.starred ? ' on' : ''),
                    title: props.starred ? t('feat.remove') : t('feat.add'), onClick: props.onStar
                  }, icon('star', 14))
                : h('span', { className: 'kb8-pill warn', title: x.sourceType === 'well-known' ? t('row.cantInstall.wk') : t('row.cantInstall.ng') }, t('row.cantInstall'))),
            x.installable === true
              ? h('a', { href: ghUrl, target: '_blank', rel: 'noreferrer', className: 'kb8-ghost', 'data-kb': 'act-github' }, icon('github', 15), h('span', null, t('dp.viewgh')))
              : null))
      }

      // Escape closes a confirmation, in the capture phase so the page behind never sees it.
      const useEscape = (onClose) => {
        React.useEffect(() => {
          const onKey = (e) => { if (e !== null && e.key === 'Escape') { e.stopPropagation(); onClose() } }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [])
      }

      // « Install ? » — before anything is downloaded or written, what the button will do, for THIS skill: its repository, the folder it
      // sits in (when the repository's listing showed it), and the exact folder it will be copied to.
      function InstallConfirm(props) {
        const x = props.x
        useEscape(props.onClose)
        const dest = String(props.dest)
        const sepr = dest.indexOf('\\') >= 0 && dest.indexOf('/') < 0 ? '\\' : '/'
        const target = dest.replace(/[\\/]+$/, '') + sepr + x.name
        const row = (label, value) => h('div', { className: 'row' }, h('span', null, label), h('span', { className: 'kb8-mono', style: { overflowWrap: 'anywhere' } }, value))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('ic.title', { name: x.name }), 'data-kb': 'install-confirm', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('ic.title', { name: x.name })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('det.whatBody', { source: x.source, name: x.name, dest })),
            h('div', { className: 'kb-local-rows' },
              row(t('ic.repo'), 'github.com/' + x.source),
              row(t('ic.folder'), props.folder !== null && props.folder !== undefined ? (props.folder !== '' ? props.folder : t('dp.root')) : t('dp.folderUnknown')),
              row(t('ic.dest'), target)),
            h('div', { className: 'kb-note' }, icon('info', 14), h('span', null, t('ic.after'))),
            props.error ? h('div', { className: 'kbs-err', role: 'alert' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'install-confirm-no', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'install-confirm-yes', disabled: props.busy === true, onClick: props.onConfirm },
                icon('plus', 15), props.busy === true ? t('m.downloading') : t('btn.install')))))
      }

      // « Delete ? » — a skill's folder is removed for good (no trash): said first, with the folder and how many files go with it.
      function DeleteConfirm(props) {
        const s = props.s
        useEscape(props.onClose)
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('del.title', { name: s.name }), 'data-kb': 'delete-confirm', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('del.title', { name: s.name })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('del.body', { path: String(s.folder || s.root || '') })),
            typeof props.files === 'number' && props.files > 0 ? h('span', { className: 'kb8-mono' }, t('panel.files', { n: props.files })) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'delete-confirm-no', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-ghost warn', 'data-kb': 'delete-confirm-yes', disabled: props.busy === true, onClick: props.onConfirm },
                props.busy === true ? t('del.deleting') : t('act.delete')))))
      }

      // Create modal: the four fields that make up a valid SKILL.md, nothing more.
      function CreateModal(props) {
        const [name, setName] = React.useState('')
        const [description, setDescription] = React.useState('')
        const [whenToUse, setWhenToUse] = React.useState('')
        const [content, setContent] = React.useState('')
        const [root, setRoot] = React.useState(props.roots.length > 0 ? props.roots[0].path : '')
        const [quiet, setQuiet] = React.useState(false)
        const field = (label, node) => h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, label), node)
        // The same rule as the host's (a lowercase kebab name, 64 characters at most), said while typing: the « /name » line only
        // promises a command once the name can be one, and a bad name says why under its field (A3-27).
        const nameRule = name === '' ? null : (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? (name.length > 64 ? 'name_too_long' : null) : 'invalid_name')
        const select = (value, onChange) => h('select', { className: 'kbs-select', value, onChange: (e) => onChange(e.target.value) },
          props.roots.length === 0
            ? h('option', { value: '' }, t('m.defroot'))
            : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('add.create')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('m.createSub')),
            field(t('m.name'), h(React.Fragment, null,
              h('input', { className: 'kbs-input', value: name, placeholder: t('m.nameph'), 'aria-invalid': nameRule !== null ? 'true' : 'false', onChange: (e) => setName(e.target.value) }),
              nameRule !== null ? h('div', { className: 'kbs-err', role: 'alert', 'data-kb': 'create-name-error' }, t('he.' + nameRule, { max: 64 })) : null)),
            field(t('m.desc'), h('textarea', { className: 'kbs-area', style: { minHeight: '70px' }, value: description, onChange: (e) => setDescription(e.target.value) })),
            field(t('m.when'), h('input', { className: 'kbs-input', value: whenToUse, onChange: (e) => setWhenToUse(e.target.value) })),
            field(t('m.content'), h('textarea', { className: 'kbs-area', value: content, placeholder: t('m.contentph'), onChange: (e) => setContent(e.target.value) })),
            field(t('f.root'), select(root, setRoot)),
            h('label', { className: 'kbs-check' },
              h('input', { type: 'checkbox', checked: quiet, onChange: (e) => setQuiet(e.target.checked) }),
              h('span', null, t('m.quiet', { n: name !== '' && nameRule === null ? name : t('m.nameWord') }))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true || nameRule !== null,
                onClick: () => props.onSubmit({ name, description, whenToUse, body: content, root, modelInvocable: quiet !== true })
              }, icon('wand', 15), props.busy.__modal === true ? t('m.creating') : t('m.createBtn')))))
      }

      // The index source: the relay the Discover tab reads. The address is the user's to name (a company server, a test), with the
      // SAME rule as the KYBERNOS_SKILLS_INDEX_URL variable; when that variable is set it decides and this window only says so.
      function SourceModal(props) {
        const s0 = props.source
        const editable = s0 === null || s0.editable !== false
        const [value, setValue] = React.useState(s0 !== null && s0.origin === 'setting' && typeof s0.url === 'string' ? s0.url : '')
        React.useEffect(() => {
          const onKey = (e) => { if (e !== null && e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [])
        const now = s0 === null ? '' : (s0.refused === true ? t('src.refused') : s0.host) + ' · ' + (s0.origin === 'env' ? t('src.env') : (s0.origin === 'setting' ? t('src.custom') : t('src.default')))
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal', 'data-kb': 'index-source-modal', role: 'dialog', 'aria-label': t('src.title'), onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, t('src.title')), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', 'aria-label': t('m.cancel'), onClick: props.onClose }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, t('src.what') + ' ' + t('src.sub')),
            now !== '' ? h('div', { className: 'kb-note' }, icon('globe', 14), h('span', null, now)) : null,
            editable === true
              ? h('div', { className: 'kbs-fields' },
                  h('span', { className: 'kbs-label' }, t('src.field')),
                  h('input', {
                    className: 'kbs-input', 'data-kb': 'index-source-input', value, spellCheck: false, autoFocus: true,
                    placeholder: s0 !== null && typeof s0.defaultUrl === 'string' ? s0.defaultUrl : 'https://skills.kybernos.app/v1',
                    onChange: (e) => setValue(e.target.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); props.onSubmit(value) } }
                  }),
                  h('span', { className: 'kb8-sub', style: { fontSize: '12px', color: 'var(--dsw-alias-label-caption)' } }, t('src.hint')))
              : h('div', { className: 'kb-callout' }, icon('info', 16), h('span', null, t('src.envnote'))),
            props.error ? h('div', { className: 'kbs-err', role: 'alert' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              editable === true && s0 !== null && s0.origin === 'setting'
                ? h('button', { type: 'button', className: 'kb8-ghost', 'data-kb': 'index-source-reset', style: { marginRight: 'auto' }, disabled: props.busy === true, onClick: () => props.onSubmit('') }, t('src.reset'))
                : null,
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              editable === true
                ? h('button', { type: 'button', className: 'kb8-primary', 'data-kb': 'index-source-save', disabled: props.busy === true, onClick: () => props.onSubmit(value) }, props.busy === true ? t('src.saving') : t('src.save'))
                : null)))
      }

      // Import modal: a GitHub source as owner/repo, prefilled from the open detail page.
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
            // Destination, then the exact effect of the button below — before the click, not after.
            field(t('m.destRoot'), h('select', {
              className: 'kbs-select', value: root, onChange: (e) => setRoot(e.target.value),
              title: t('det.installTip', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') })
            },
              props.roots.length === 0
                ? h('option', { value: '' }, t('m.defroot'))
                : props.roots.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate')))))),
            h('div', { className: 'kb-note', 'data-kb': 'install-effect' },
              icon('info', 14),
              h('span', null, t('det.installHelp', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') }))),
            props.error ? h('div', { className: 'kbs-err' }, props.error) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', {
                type: 'button', className: 'kb8-primary', disabled: props.busy.__modal === true,
                title: t('det.installTip', { source: source.trim() || t('det.rootph'), name: name.trim() || t('det.rootph'), dest: root !== '' ? root : t('m.defroot') }),
                onClick: () => props.onSubmit({ source: source.trim(), name: name.trim(), root })
              }, icon('github', 15), props.busy.__modal === true ? t('m.downloading') : t('btn.install')))))
      }

      // ── Team skills ─────────────────────────────────────────────────────────────
      // The Team tab (docs/dev/team-skills-contract.md, the "Skills Team catalogue" mockup). The server half is
      // /kybernos-cloud/team/skills* (kybernos-cloud, the account token and the active workspace); the disk half is
      // /kybernos-skills/team/pack and /team/install. This page carries the files from one to the other, so neither plugin imports
      // the other and no skill content is kept anywhere.
      const TEAM_LOCKS = { non_connecte: 'signin', 'non connecte': 'signin', offre_requise: 'plan', aucun_espace: 'space', not_on_this_server: 'server', reconnect_required: 'reconnect', network: 'net' }
      const teamLockOf = (code) => (TEAM_LOCKS[code] !== undefined ? TEAM_LOCKS[code] : 'other')
      const TEAM_SCRIPT_RE = /\.(?:sh|bash|zsh|fish|py|rb|pl|php|js|mjs|cjs|ts|ps1|bat|cmd)$/i
      // Shown to the reviewer, who must see that a skill comes with something that runs.
      const teamScripts = (files) => files.filter((f) => TEAM_SCRIPT_RE.test(f.path) || /^scripts?\//i.test(f.path) || String(f.content).startsWith('#!')).map((f) => f.path)
      const byteLen = (s) => { try { return new TextEncoder().encode(String(s)).length } catch (e) { return String(s).length } }
      const kbOf = (n) => { const v = n / 1024; return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)) }
      const sizeOf = (n) => (n < 1024 ? String(n) + ' B' : kbOf(n) + ' KB')
      const shortV = (v) => String(v === null || v === undefined ? '' : v).slice(0, 7)
      const teamRoleAdmin = (role) => role === 'owner' || role === 'admin'

      // One word of the server or of the disk half → a sentence. A word nobody planned is still shown, with its code.
      const teamWord = (j) => {
        const code = j !== null && j !== undefined && typeof j === 'object' && typeof j.error === 'string' ? j.error : 'other'
        const key = 'tm.e.' + code
        if (STR[key] !== undefined) return t(key, { reason: j.reason || '?', file: j.file || '?', code })
        return t('tm.e.other', { code })
      }
      const packWord = (j) => {
        const f = j.file || ''
        if (j.error === 'scan_rejected' || j.reason === 'scan_rejected') return t('tm.p.bad.secret', { file: f, line: j.line || '?' })
        if (j.error === 'skill_disabled') return t('tm.p.bad.disabled')
        const by = { binary: 'tm.p.bad.binary', file_too_large: 'tm.p.bad.big', too_many_files: 'tm.p.bad.many', too_large: 'tm.p.bad.total', bad_path: 'tm.p.bad.path', frontmatter: 'tm.p.bad.frontmatter', name: 'tm.p.bad.name', description: 'tm.p.bad.description', no_skill_md: 'tm.p.bad.nofile' }
        if (by[j.reason] !== undefined) return t(by[j.reason], { file: f })
        if (j.error === 'skill_not_found' || j.error === 'root_not_allowed') return teamWord(j)
        return t('tm.p.bad.other', { code: j.reason || j.error || '?' })
      }

      // A small line diff for a reviewer: changed lines with two lines of context. null when a file is too long to compare.
      const lineDiff = (aText, bText) => {
        const a = String(aText).split('\n')
        const b = String(bText).split('\n')
        if (a.length > 1200 || b.length > 1200) return null
        const n = a.length
        const m = b.length
        const dp = []
        for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1))
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        const out = []
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++ } else { out.push(['+', b[j]]); j++ }
        }
        while (i < n) out.push(['-', a[i++]])
        while (j < m) out.push(['+', b[j++]])
        const keep = out.map(() => false)
        out.forEach((l, k) => { if (l[0] !== ' ') for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < out.length) keep[k + d] = true })
        const lines = []
        let gap = false
        out.forEach((l, k) => {
          if (keep[k]) { if (gap && lines.length > 0) lines.push(['@', '…']); lines.push(l); gap = false } else gap = true
        })
        return lines
      }
      const codeBox = (text, diffAgainst) => {
        if (diffAgainst === undefined || diffAgainst === null) return h('pre', { className: 'kbt-code' }, String(text))
        const d = lineDiff(diffAgainst, text)
        if (d === null) return h('div', { className: 'kbt-code' }, t('tm.r.tooBig'))
        return h('pre', { className: 'kbt-code' }, d.map((l, k) => h('span', { key: k, className: l[0] === '+' ? 'add' : (l[0] === '-' ? 'del' : (l[0] === '@' ? 'gap' : null)), style: l[0] === ' ' ? { display: 'block' } : null }, (l[0] === '@' ? '' : l[0] + ' ') + l[1])))
      }
      const banner = (kind, ic, text) => h('div', { className: 'kbt-banner' + (kind === '' ? '' : ' ' + kind) }, icon(ic, 16), h('span', null, text))
      const filesList = (files, sel, onPick, statuses) => h('div', { className: 'kbt-files' }, files.map((f) => {
        const st = statuses !== undefined && statuses !== null ? statuses[f.path] : undefined
        return h('button', {
          key: f.path, type: 'button', className: 'kbt-file' + (sel === f.path ? ' on' : '') + (TEAM_SCRIPT_RE.test(f.path) || /^scripts?\//i.test(f.path) ? ' warn' : ''),
          onClick: () => onPick(f.path)
        }, icon('file', 14), h('span', { className: 'p' }, f.path), h('span', { className: 'z' }, sizeOf(byteLen(f.content))),
        st !== undefined && st !== 'same' ? h('span', { className: 'kb8-pill ' + (st === 'removed' ? '' : 'warn') }, t(st === 'changed' ? 'tm.r.changed' : (st === 'new' ? 'tm.r.fnew' : 'tm.r.removed'))) : (f.path === 'SKILL.md' ? h('span', { className: 'kb8-pill' }, t('tm.det.entry')) : h('span', null)))
      }))

      // Why the Team tab shows nothing to do: not signed in, not on the plan, no team workspace, not on this server…
      // The page of the plans: the console of the ACTIVE server (its « Plan & Credits » page, with its own sign-in in a browser), which
      // the cloud host reports (`/kybernos-cloud/server`): no address is written here. Opened in a new tab: this screen stays where it is.
      function TeamLocked(props) {
        const kind = props.kind
        const planPair = React.useState('')
        const planUrl = planPair[0]
        React.useEffect(() => {
          if (kind !== 'plan') return undefined
          let alive = true
          fetch('/kybernos-cloud/server', { headers: { accept: 'application/json' } }).then((r) => r.json().catch(() => null))
            .then((j) => { if (alive === true && j !== null && j.ok === true && j.server !== null && typeof j.server === 'object' && typeof j.server.console === 'string') planPair[1](j.server.console) })
            .catch(() => { /* no plans link */ })
          return () => { alive = false }
        }, [kind])
        const known = ['plan', 'signin', 'space', 'server', 'reconnect', 'net'].indexOf(kind) >= 0
        const retriable = kind === 'net' || kind === 'other' || kind === 'reconnect'
        return h('div', { className: 'kb-empty' }, icon(kind === 'plan' || kind === 'signin' || kind === 'space' ? 'lock' : 'alert', 24),
          h('span', { className: 'kb8-name' }, t(known ? 'tm.lock.' + kind + '.t' : 'tm.lock.other.t')),
          h('span', { className: 'kb8-parent', style: { maxWidth: '520px' } }, known ? t('tm.lock.' + kind + '.b') : (props.detail || '')),
          h('div', { className: 'kb-row', style: { justifyContent: 'center' } },
            kind === 'plan' && planUrl !== '' ? h('a', { className: 'kb8-primary', href: planUrl, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none' } }, t('tm.seePlan')) : null,
            retriable ? h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onRetry }, t('tm.retry')) : null,
            h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onBack }, t('tm.back'))))
      }

      // A local skill that can be proposed, from the catalogue: one of the two writable folders, switched on.
      const proposable = (skills) => skills.filter((s) => s.writable === true && s.active === true)

      function ProposeSheet(props) {
        const cands = proposable(props.local)
        const [pick, setPick] = React.useState('')
        const [pack, setPack] = React.useState({ phase: 'idle' })
        const [note, setNote] = React.useState('')
        const [sending, setSending] = React.useState(false)
        const [err, setErr] = React.useState('')
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        const chosen = cands.filter((s) => skillKey(s) === pick)[0]
        React.useEffect(() => {
          if (chosen === undefined) { setPack({ phase: 'idle' }); return undefined }
          let stop = false
          setPack({ phase: 'loading' }); setErr('')
          postJson('/kybernos-skills/team/pack', { root: chosen.root, name: chosen.name }).then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true) setPack({ phase: 'ready', data: j })
            else setPack({ phase: 'bad', text: packWord(j !== null && typeof j === 'object' ? j : {}) })
          }).catch(() => { if (!stop && alive.current === true) setPack({ phase: 'bad', text: t('err.unavail', { r: 'team/pack' }) }) })
          return () => { stop = true }
        }, [pick])
        const submit = () => {
          if (pack.phase !== 'ready' || sending) return
          setSending(true); setErr('')
          postJson('/kybernos-cloud/team/skills/add', { name: pack.data.name, description: pack.data.description, files: pack.data.files, note: note.trim() }).then((j) => {
            if (alive.current !== true) return
            setSending(false)
            if (j !== null && typeof j === 'object' && j.ok === true) props.onDone(pack.data.name)
            else setErr(teamWord(j))
          }).catch(() => { if (alive.current === true) { setSending(false); setErr(t('tm.e.network')) } })
        }
        const d = pack.phase === 'ready' ? pack.data : null
        return h('div', { className: 'kb-overlay', onClick: props.onClose },
          h('div', { className: 'kb-modal kbt-sheet', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'kb-row' }, h('span', { className: 'kb8-h2' }, props.admin ? t('tm.p.titleAdmin', { ws: props.ws }) : t('tm.p.title', { ws: props.ws })), h('span', { style: { flex: '1' } }),
              h('button', { type: 'button', className: 'kb-tool', onClick: props.onClose, 'aria-label': t('m.cancel') }, '✕')),
            h('p', { className: 'kb8-sub', style: { margin: '0' } }, props.admin ? t('tm.p.subAdmin') : t('tm.p.sub')),
            cands.length === 0
              ? banner('', 'info', t('tm.p.none'))
              : h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.p.pick')),
                h('select', { className: 'kbs-select', value: pick, onChange: (e) => setPick(e.target.value) },
                  h('option', { value: '' }, t('tm.p.choose')),
                  cands.map((s) => h('option', { key: skillKey(s), value: skillKey(s) }, s.name + ' · ' + s.root))),
                chosen !== undefined && chosen.description !== '' ? h('span', { className: 'kbt-cap' }, chosen.description) : null),
            pack.phase === 'loading' ? h('span', { className: 'kb8-mono' }, t('tm.p.packing')) : null,
            pack.phase === 'bad' ? banner('err', 'alert', pack.text) : null,
            d !== null ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.p.send')),
              filesList(d.files, '', () => {}, null)) : null,
            d !== null ? h('div', { className: 'kbt-kv' }, h('span', { className: 'k' }, t('tm.p.checks')),
              h('span', { className: 'kb8-pills' },
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.name')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.text')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.secret')),
                h('span', { className: 'kb8-pill ok' }, t('tm.p.ck.size', { n: d.count, kb: kbOf(d.bytes) })))) : null,
            d !== null && d.scripts.length > 0 ? banner('warn', 'alert', t('tm.script') + sep() + d.scripts.join(', ')) : null,
            h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, props.admin ? t('tm.p.noteAdmin') : t('tm.p.note')),
              h('textarea', { className: 'kbs-area', style: { minHeight: '70px', fontFamily: 'inherit', fontSize: '13px' }, value: note, maxLength: 280, onChange: (e) => setNote(e.target.value) })),
            err !== '' ? h('div', { className: 'kbs-err' }, err) : null,
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: props.onClose }, t('m.cancel')),
              h('button', { type: 'button', className: 'kb8-primary', disabled: pack.phase !== 'ready' || sending, onClick: submit },
                sending ? t('tm.p.sending') : (props.admin ? t('tm.p.submitAdmin') : t('tm.p.submit')))),
            h('span', { className: 'kbt-cap' }, t('tm.p.foot'))))
      }

      // The admin's queue: every proposal with its files (and what changed since the approved version) BEFORE the decision.
      function TeamReviewCard(props) {
        const s = props.skill
        const [st, setSt] = React.useState({ phase: 'loading', files: [], base: null })
        const [sel, setSel] = React.useState('')
        const [rejecting, setRejecting] = React.useState(false)
        const [why2, setWhy2] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => {
          let stop = false
          const one = (id) => getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(id))
          Promise.all([one(s.id), s.replaces !== null && s.replaces !== undefined ? one(s.replaces) : Promise.resolve(null)]).then(([a, b]) => {
            if (stop || alive.current !== true) return
            if (a === null || a.ok !== true || !Array.isArray(a.skill.files)) { setSt({ phase: 'error', files: [], base: null, error: teamWord(a) }); return }
            const files = a.skill.files
            const base = b !== null && b.ok === true && Array.isArray(b.skill.files) ? b.skill.files : null
            setSt({ phase: 'ready', files, base })
            const changed = base === null ? null : files.filter((f) => { const o = base.filter((x) => x.path === f.path)[0]; return o === undefined || o.content !== f.content })[0]
            setSel(changed !== undefined && changed !== null ? changed.path : (files.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : (files[0] !== undefined ? files[0].path : '')))
          }).catch(() => { if (!stop && alive.current === true) setSt({ phase: 'error', files: [], base: null, error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [s.id])
        const decide = (decision) => {
          if (busy) return
          setBusy(true)
          const payload = { id: s.id, decision }
          if (decision === 'reject' && why2.trim() !== '') payload.note = why2.trim()
          postJson('/kybernos-cloud/team/skills/review', payload).then((j) => {
            if (alive.current !== true) return
            setBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true) props.onDone({ kind: 'ok', text: t(decision === 'approve' ? 'tm.n.approved' : 'tm.n.rejected', { name: s.name }) })
            else props.onDone({ kind: 'err', text: teamWord(j) }, j !== null && typeof j === 'object' && (j.error === 'not_pending' || j.error === 'skill_not_found'))
          }).catch(() => { if (alive.current === true) { setBusy(false); props.onDone({ kind: 'err', text: t('tm.e.network') }) } })
        }
        const files = st.files
        const statuses = {}
        let shown = files
        if (st.base !== null) {
          files.forEach((f) => { const o = st.base.filter((x) => x.path === f.path)[0]; statuses[f.path] = o === undefined ? 'new' : (o.content === f.content ? 'same' : 'changed') })
          const gone = st.base.filter((o) => !files.some((f) => f.path === o.path))
          gone.forEach((o) => { statuses[o.path] = 'removed' })
          shown = files.concat(gone)
        }
        const cur = shown.filter((f) => f.path === sel)[0]
        const baseOf = cur !== undefined && st.base !== null ? st.base.filter((x) => x.path === cur.path)[0] : undefined
        const scripts = teamScripts(files)
        return h('div', { className: 'kbt-card' },
          h('div', { className: 'head' }, tile(s.name, 'pkg', 'kbs-sm'),
            h('div', { className: 'grow' },
              h('div', { className: 'kb-row', style: { gap: '8px' } },
                h('span', { className: 'kb8-name' }, s.name),
                h('span', { className: 'kb8-pill ' + (s.replaces !== null && s.replaces !== undefined ? 'info' : 'ok') }, s.replaces !== null && s.replaces !== undefined ? t('tm.r.updateOf') : t('tm.r.new')),
                scripts.length > 0 ? h('span', { className: 'kb8-pill warn' }, t('tm.script')) : null,
                h('span', { className: 'kb8-pill' }, shortV(s.version))),
              h('span', { className: 'kb8-parent' }, t('tm.r.by', { a: s.proposedName || '—', d: s.proposedAt ? today(s.proposedAt) : '' }) + (s.note ? ' · “' + s.note + '”' : '')),
              s.replaces !== null && s.replaces !== undefined && st.base !== null ? h('span', { className: 'kbt-cap' }, t('tm.r.replaces', { v: '#' + s.replaces })) : null),
            h('div', { className: 'kbt-act' },
              h('button', { type: 'button', className: 'kbt-btn danger', disabled: busy || st.phase !== 'ready', onClick: () => setRejecting(!rejecting) }, t('tm.r.reject')),
              h('button', { type: 'button', className: 'kbt-btn solid', disabled: busy || st.phase !== 'ready', onClick: () => decide('approve') }, t('tm.r.approve')))),
          rejecting ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbs-label' }, t('tm.r.rejectNote')),
            h('textarea', { className: 'kbs-area', style: { minHeight: '60px', fontFamily: 'inherit', fontSize: '13px' }, value: why2, maxLength: 280, onChange: (e) => setWhy2(e.target.value) }),
            h('div', { className: 'kbs-actions' },
              h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setRejecting(false) }, t('m.cancel')),
              h('button', { type: 'button', className: 'kbt-btn danger', disabled: busy, onClick: () => decide('reject') }, t('tm.r.rejectYes')))) : null,
          st.phase === 'loading' ? h('span', { className: 'kb8-mono' }, t('tm.det.loading')) : null,
          st.phase === 'error' ? h('div', { className: 'kbs-err' }, st.error) : null,
          st.phase === 'ready' ? h('div', { className: 'kbt-stack' },
            filesList(shown, sel, setSel, st.base !== null ? statuses : null),
            cur === undefined ? null : codeBox(cur.content, statuses[cur.path] === 'changed' && baseOf !== undefined ? baseOf.content : null),
            h('span', { className: 'kbt-cap' }, t('tm.r.scan', { n: files.length, kb: kbOf(s.bytes || files.reduce((a, f) => a + byteLen(f.content), 0)) }))) : null)
      }

      // One skill, opened: its files first (what will be copied), then the install panel.
      function TeamDetail(props) {
        const [st, setSt] = React.useState({ phase: 'loading', skill: null, error: '' })
        const [sel, setSel] = React.useState('')
        const writable = props.roots
        const [root, setRoot] = React.useState(writable.length > 0 ? writable[0].path : '')
        const [asking, setAsking] = React.useState(false)
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        React.useEffect(() => {
          let stop = false
          setSt({ phase: 'loading', skill: null, error: '' })
          getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(props.id)).then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.skill !== undefined) {
              setSt({ phase: 'ready', skill: j.skill, error: '' })
              setSel(j.skill.files.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : (j.skill.files[0] !== undefined ? j.skill.files[0].path : ''))
            } else setSt({ phase: 'error', skill: null, error: teamWord(j) })
          }).catch(() => { if (!stop && alive.current === true) setSt({ phase: 'error', skill: null, error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [props.id, props.tick])
        const back = h('button', { type: 'button', className: 'kb-back', onClick: props.onClose }, icon('back', 15), ' ' + t('tm.det.back'))
        if (st.phase === 'loading') return h('div', null, back, h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.det.loading'))))
        if (st.phase === 'error') return h('div', null, back, h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-name' }, st.error)))
        const s = st.skill
        const rel = props.relationOf(s)
        const approved = s.status === 'approved'
        const cur = s.files.filter((f) => f.path === sel)[0]
        const scripts = teamScripts(s.files)
        const busy = props.busy['i' + s.id] === true
        const canInstall = approved && rel.kind !== 'own' && rel.kind !== 'installed' && !(rel.kind === 'update' && rel.edited === true)
        const action = () => props.onInstall(s, rel, root)
        const note = !approved ? t('tm.det.notApproved')
          : (rel.kind === 'update' ? (rel.edited === true ? t('tm.det.editedNote') : t('tm.det.updateNote', { old: shortV(rel.local.teamVersion) }))
            : (rel.kind === 'own' ? t('tm.det.ownNote') : (rel.kind === 'installed' ? t('tm.det.installedNote') : t('tm.det.never'))))
        return h('div', null, back,
          h('div', { className: 'kb-detail-head' }, tile(s.name, 'pkg', 'lg'),
            h('div', { className: 'meta' },
              h('div', { className: 'kb-row', style: { gap: '9px' } }, h('span', { className: 'kb8-h1', style: { fontSize: '22px' } }, s.name),
                h('span', { className: 'kb8-pill ' + (approved ? 'ok' : (s.status === 'rejected' ? 'warn' : '')) }, t('tm.st.' + s.status)),
                h('span', { className: 'kb8-pill' }, shortV(s.version)),
                h('span', { className: 'kb8-pill' }, t('tm.det.count', { n: s.fileCount, size: sizeOf(s.bytes) })),
                scripts.length > 0 ? h('span', { className: 'kb8-pill warn' }, t('tm.script')) : null),
              h('span', { className: 'kb8-parent' }, s.description)),
            canInstall ? h('button', { type: 'button', className: 'kb8-primary', disabled: busy, onClick: action }, icon(rel.kind === 'update' ? 'dl' : 'plus', 15), h('span', null, rel.kind === 'update' ? t('tm.update') : t('tm.install'))) : null),
          h('span', { className: 'kb8-parent' }, s.reviewedName ? t('tm.det.approvedBy', { a: s.proposedName || '—', d: today(s.proposedAt || ''), r: s.reviewedName }) : t('tm.det.proposedBy', { a: s.proposedName || '—', d: today(s.proposedAt || '') })),
          h('div', { className: 'kb-cols', style: { marginTop: '16px' } },
            h('div', { className: 'kbt-stack' },
              h('span', { className: 'kb-section-label' }, t('tm.det.files')),
              filesList(s.files, sel, setSel, null),
              cur === undefined ? h('span', { className: 'kb8-mono' }, t('tm.det.pick')) : codeBox(cur.content, null)),
            h('div', { className: 'kb-panel' },
              h('span', { className: 'kb-section-label' }, t('tm.det.into')),
              rel.kind === 'update'
                ? h('span', { className: 'kb8-mono' }, rel.local.root)
                : h('select', { className: 'kbs-select', value: root, onChange: (e) => setRoot(e.target.value) },
                  writable.length === 0 ? h('option', { value: '' }, t('m.defroot')) : writable.map((r) => h('option', { key: r.path, value: r.path }, r.path + (r.exists === true ? '' : '  ' + t('m.willCreate'))))),
              h('span', { className: 'kb-section-label', style: { marginTop: '4px' } }, t('tm.det.checks')),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('shield', 15)), h('span', null, t('tm.det.chk1', { v: shortV(s.version) }))),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('folder', 15)), h('span', null, t('tm.det.chk2'))),
              h('div', { className: 'row' }, h('span', { className: 'ic' }, icon('code', 15)), h('span', null, t('tm.det.chk3'))),
              canInstall ? h('button', { type: 'button', className: 'kb8-primary', disabled: busy, style: { justifyContent: 'center' }, onClick: action }, rel.kind === 'update' ? t('tm.update') : t('tm.install')) : null,
              h('span', { className: 'kbt-cap' }, note),
              props.admin && approved
                ? (asking
                  ? h('div', { className: 'kbs-fields' }, h('span', { className: 'kbt-cap' }, t('tm.det.retireAsk', { name: s.name })),
                    h('div', { className: 'kbs-actions' },
                      h('button', { type: 'button', className: 'kb8-ghost', onClick: () => setAsking(false) }, t('m.cancel')),
                      h('button', { type: 'button', className: 'kbt-btn danger', onClick: () => props.onRetire(s) }, t('tm.det.retireYes'))))
                  : h('button', { type: 'button', className: 'kbt-btn danger', style: { alignSelf: 'flex-start' }, onClick: () => setAsking(true) }, t('tm.retire')))
                : null)))
      }

      // The tab: sub-views, the table, the queue, the opened skill. `sum` is what the parent already knows (role, counts, workspace).
      function TeamSkills(props) {
        const sum = props.sum
        const admin = teamRoleAdmin(sum.role)
        const view = props.view
        const setView = props.onView
        const [list, setList] = React.useState({ phase: 'loading', skills: [], error: '' })
        const [tick, setTick] = React.useState(0)
        const [busy, setBusy] = React.useState({})
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])
        const reload = () => { setTick((n) => n + 1); props.onSummary() }
        React.useEffect(() => {
          if (admin !== true && (view === 'proposed' || view === 'retired')) { setView('approved'); return undefined }
          if (admin === true && view === 'mine') { setView('approved'); return undefined }
          let stop = false
          setList((m) => ({ ...m, phase: 'loading' }))
          getJson('/kybernos-cloud/team/skills?view=' + (view === 'retired' ? 'all' : view) + '&limit=200').then((j) => {
            if (stop || alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.skills)) {
              setList({ phase: 'ready', skills: view === 'retired' ? j.skills.filter((s) => s.status === 'retired') : j.skills, error: '' })
            } else setList({ phase: 'error', skills: [], error: teamWord(j) })
          }).catch(() => { if (!stop && alive.current === true) setList({ phase: 'error', skills: [], error: t('tm.e.network') }) })
          return () => { stop = true }
        }, [view, tick, props.ver])

        // What this machine already has under that name: nothing, the team's skill (same or older version, edited or not), or the user's own.
        const relationOf = (s) => {
          const here = props.local.filter((x) => x.name === s.name && x.writable === true)
          if (here.length === 0) return { kind: 'install' }
          const l = here.filter((x) => typeof x.teamVersion === 'string')[0]
          if (l === undefined) return { kind: 'own', local: here[0] }
          if (l.teamVersion === s.version) return { kind: 'installed', local: l }
          return { kind: 'update', local: l, edited: l.teamModified === true }
        }
        const install = async (s, rel, root) => {
          const k = 'i' + s.id
          if (busy[k] === true) return
          setBusy((m) => ({ ...m, [k]: true }))
          try {
            const item = await getJson('/kybernos-cloud/team/skills/item?id=' + encodeURIComponent(s.id))
            if (item === null || item.ok !== true || !Array.isArray(item.skill.files)) { props.notify({ kind: 'err', text: teamWord(item) }); return }
            const update = rel.kind === 'update'
            const res = await postJson('/kybernos-skills/team/install', { root: update ? rel.local.root : root, name: s.name, version: item.skill.version, files: item.skill.files, teamId: s.id, replace: update })
            if (res !== null && res.ok === true) { props.notify({ kind: 'ok', text: update ? t('tm.n.updated', { name: s.name }) : t('tm.n.installed', { name: s.name, n: res.files }) }); props.onChanged() }
            else props.notify({ kind: 'err', text: teamWord(res) })
          } catch (e) { props.notify({ kind: 'err', text: t('tm.e.network') }) } finally {
            if (alive.current === true) setBusy((m) => { const n = { ...m }; delete n[k]; return n })
          }
        }
        const act = async (path, body, okText, after) => {
          try {
            const j = await postJson(path, body)
            if (j !== null && typeof j === 'object' && j.ok === true) { props.notify({ kind: 'ok', text: okText }); if (after) after() } else { props.notify({ kind: 'err', text: teamWord(j) }); if (j !== null && j.error === 'not_pending') reload() }
          } catch (e) { props.notify({ kind: 'err', text: t('tm.e.network') }) }
          reload()
        }
        const retire = (s) => act('/kybernos-cloud/team/skills/retire', { id: s.id }, t('tm.n.retired', { name: s.name }), () => props.onOpen(null))
        const withdraw = (s) => act('/kybernos-cloud/team/skills/delete', { id: s.id }, t('tm.n.withdrawn'))

        if (props.openId !== null) {
          return h(TeamDetail, { id: props.openId, tick, local: props.local, roots: props.roots, admin, busy, relationOf, onInstall: install, onRetire: retire, onClose: () => props.onOpen(null) })
        }

        const counts = sum.counts || { approved: 0, pending: 0 }
        const views = admin ? [['approved', counts.approved], ['proposed', counts.pending], ['retired', null]] : [['approved', counts.approved], ['mine', counts.pending]]
        const names = { approved: 'tm.v.approved', mine: 'tm.v.mine', proposed: 'tm.v.review', retired: 'tm.v.retired' }
        const needle = props.needle.trim().toLowerCase()
        const rows = list.skills.filter((s) => needle === '' || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
        const emptyKey = { approved: 'approved', mine: 'mine', proposed: 'review', retired: 'retired' }[view]

        const verPills = (s, rel) => {
          const out = []
          if (rel !== null && rel.kind === 'update') {
            out.push(h('span', { key: 'o', className: 'kb8-pill' }, shortV(rel.local.teamVersion)))
            out.push(h('span', { key: 'n', className: 'kb8-pill info' }, t('tm.newer', { v: shortV(s.version) })))
            if (rel.edited === true) out.push(h('span', { key: 'e', className: 'kb8-pill warn' }, t('tm.edited')))
          } else out.push(h('span', { key: 'v', className: 'kb8-pill' }, shortV(s.version)))
          return out
        }
        const rowActions = (s, rel) => {
          if (view === 'mine') {
            if (s.status === 'proposed') return [h('button', { key: 'w', type: 'button', className: 'kbt-btn', onClick: (e) => { e.stopPropagation(); withdraw(s) } }, t('tm.withdraw'))]
            return [h('span', { key: 's', className: 'kb8-pill ' + (s.status === 'approved' ? 'ok' : (s.status === 'rejected' ? 'warn' : '')) }, t('tm.st.' + s.status))]
          }
          if (s.status === 'retired') return [h('span', { key: 's', className: 'kb8-pill' }, t('tm.st.retired'))]
          const bz = busy['i' + s.id] === true
          if (rel.kind === 'installed') return [h('span', { key: 's', className: 'kb8-pill ok' }, t('tm.installed'))]
          if (rel.kind === 'own') return [h('span', { key: 's', className: 'kb8-pill warn', title: t('tm.det.ownNote') }, t('tm.own'))]
          return [h('button', { key: 'i', type: 'button', className: 'kbt-btn solid', disabled: bz || (rel.kind === 'update' && rel.edited === true), title: rel.kind === 'update' && rel.edited === true ? t('tm.det.editedNote') : undefined,
            onClick: (e) => { e.stopPropagation(); install(s, rel, (props.roots[0] || { path: '' }).path) } }, rel.kind === 'update' ? t('tm.update') : t('tm.install'))]
        }
        const row = (s, i) => {
          const rel = view === 'mine' || s.status === 'retired' ? null : relationOf(s)
          return h('div', { key: s.id, className: 'kbs-row' + (rel !== null && (rel.kind === 'installed' || rel.kind === 'update') ? ' has' : '') + appear(i), onClick: () => props.onOpen(s.id) },
            h('span', { className: 'who' }, tile(s.name, 'pkg', 'kbs-sm')),
            h('span', { className: 'kbt-name' }, h('span', { className: 'n' }, s.name),
              h('span', { className: 'd' }, view === 'mine' && s.status === 'rejected' ? (s.reviewNote ? t('tm.r.rejectedWith', { note: s.reviewNote }) : t('tm.r.noNote')) : s.description)),
            h('span', { className: 'kbt-by' }, s.proposedName || '—', h('span', { className: 'd' }, s.proposedAt ? today(s.proposedAt) : '')),
            h('span', { className: 'badges' }, verPills(s, rel)),
            h('span', { className: 'kbt-act' }, rowActions(s, rel)))
        }

        let body
        if (list.phase === 'loading' && list.skills.length === 0) body = skeletonOf('team', 5) || h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-mono' }, t('tm.loading')))
        else if (list.phase === 'error') body = h('div', { className: 'kb-empty' }, h('span', { className: 'kb8-name' }, list.error), h('button', { type: 'button', className: 'kb8-ghost', onClick: reload }, t('tm.retry')))
        else if (view === 'proposed') {
          body = rows.length === 0
            ? h('div', { className: 'kb-empty' }, icon('check', 24), h('span', { className: 'kb8-name' }, t('tm.empty.review')), h('span', { className: 'kb8-parent' }, t('tm.empty.reviewHint')))
            : h('div', { className: 'kbt-stack' }, banner('warn', 'alert', t('tm.r.banner')),
              rows.map((s) => h(TeamReviewCard, { key: s.id, skill: s, onDone: (notice, refresh) => { props.notify(notice); reload(); if (refresh) props.onSummary() } })))
        } else if (rows.length === 0) {
          body = needle !== '' ? h('div', { className: 'kb-empty' }, icon('search', 24), h('span', { className: 'kb8-name' }, t('y.noresult')), h('span', { className: 'kb8-parent' }, t('y.nofilter')))
            : h('div', { className: 'kb-empty' }, icon('pkg', 24), h('span', { className: 'kb8-name' }, t('tm.empty.' + emptyKey)), h('span', { className: 'kb8-parent' }, t('tm.empty.' + emptyKey + 'Hint')))
        } else {
          body = h('div', { className: 'kbs-table kbt' + (list.phase === 'loading' ? ' loading' : '') },
            h('div', { className: 'kbt-head' }, h('span', null), h('span', null, t('tm.th.skill')), h('span', null, t('tm.th.by')), h('span', null, t('tm.th.version')), h('span', null)),
            rows.map(row))
        }

        return h('div', { className: 'kbt-stack' },
          h('div', { className: 'kbt-subrow' },
            h('nav', { className: 'kbsub' }, h('div', { className: 'kbsub-group', role: 'tablist' }, views.map((v) => h('button', {
              key: v[0], type: 'button', role: 'tab', 'aria-selected': view === v[0] ? 'true' : 'false', className: 'kb-seg' + (view === v[0] ? ' on' : ''), onClick: () => setView(v[0])
            }, t(names[v[0]]) + ' ', v[1] === null ? null : h('span', { className: 'count' }, String(v[1])), v[0] === 'proposed' && counts.pending > 0 ? h('span', { className: 'kbt-dot' }) : null)))),
            h('span', { className: 'kb8-mono', style: { flex: 'none', textAlign: 'left' } }, t(admin ? 'tm.who.admin' : 'tm.who.member', { ws: sum.workspaceName || '' }))),
          body)
      }

      // ── Settings page « Skills » (catalogue) ─────────────────────────────────────────────────────
      // Everything here comes from routes the host already serves (index-source, index-source/set,
      // status, skills, featured): the page names where skills come from and where they are written,
      // and changes the relay. Nothing is invented, and a route that is absent is said so.
      function SkillsSettingsPage() {
        const [src, setSrc] = React.useState(null)
        const [srcOpen, setSrcOpen] = React.useState(false)
        const [srcBusy, setSrcBusy] = React.useState(false)
        const [srcErr, setSrcErr] = React.useState('')
        const [roots, setRoots] = React.useState(null)          // null = route not answering
        const [counts, setCounts] = React.useState(null)        // { installed, active, disabled, featured }
        const alive = React.useRef(true)
        React.useEffect(() => () => { alive.current = false }, [])

        React.useEffect(() => {
          getJson('/kybernos-skills/index-source').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') setSrc(j.source)
          }).catch(() => { /* a host from before this setting answers nothing: the card says so */ })
          getJson('/kybernos-skills/status').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.roots)) {
              setRoots(j.roots.filter((r) => r !== null && typeof r.path === 'string'))
            } else setRoots([])
          }).catch(() => { if (alive.current === true) setRoots([]) })
          // Counts of THIS profile's catalogue (the /skills route answers the same shape as the panel's
          // catalogue); the Featured list is its own route. A failure simply leaves the section out.
          getJson('/kybernos-skills/skills').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.skills)) {
              const list = j.skills
              setCounts({
                installed: list.length,
                active: list.filter((s) => s !== null && typeof s === 'object' && s.active === true).length,
                disabled: list.filter((s) => s !== null && typeof s === 'object' && s.active !== true).length,
                featured: null
              })
            }
          }).catch(() => { /* the counts are a bonus, never an error */ })
          getJson('/kybernos-skills/featured').then((j) => {
            if (alive.current !== true) return
            if (j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.items)) {
              setCounts((c) => (c === null ? { installed: 0, active: 0, disabled: 0, featured: j.items.length } : Object.assign({}, c, { featured: j.items.length })))
            }
          }).catch(() => { /* same */ })
        }, [])

        // Same write as the Discover tab's source line (POST /index-source/set): the host validates the
        // address with the rule of the KYBERNOS_SKILLS_INDEX_URL variable and answers the new state.
        const saveSource = (url) => {
          if (srcBusy === true) return
          setSrcBusy(true); setSrcErr('')
          postJson('/kybernos-skills/index-source/set', { url }).then((j) => {
            if (alive.current !== true) return
            setSrcBusy(false)
            if (j !== null && typeof j === 'object' && j.ok === true && j.source !== null && typeof j.source === 'object') {
              setSrc(j.source); setSrcOpen(false)
            } else setSrcErr(why(j, t('err.source')))
          }).catch(() => {
            if (alive.current !== true) return
            setSrcBusy(false); setSrcErr(t('err.unavail', { r: 'index-source' }))
          })
        }

        // The relay card: the host as a code line (never a credential), where it comes from, and the
        // button that names another one. The modal is the panel's own window (SourceModal), reused as is.
        const sourceCard = () => {
          const where = src === null ? '' : (src.origin === 'env' ? t('src.env') : (src.origin === 'setting' ? t('src.custom') : t('src.default')))
          return h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-source' },
            h('h3', { className: 'kbss-h2' }, t('set.srcH')),
            h('p', { className: 'kbss-sub' }, t('src.what')),
            src === null
              ? h('p', { className: 'kbss-sub' }, t('set.srcMissing'))
              : h('div', { className: 'kbss-srcline', 'data-kb': 'index-source' },
                  icon('globe', 14),
                  h('span', { className: 'k' }, t('src.line')),
                  src.refused === true
                    ? h('span', { className: 'kb8-pill warn' }, t('src.refused'))
                    : h('span', { className: 'v', title: src.url !== null ? src.url : undefined }, src.host),
                  h('span', { className: 'w' }, where),
                  h('button', {
                    type: 'button', className: 'kbss-link', 'data-kb': 'index-source-change',
                    disabled: srcBusy === true, onClick: () => { setSrcErr(''); setSrcOpen(true) }
                  }, t('src.change'))),
            srcErr === '' ? null : h('div', { className: 'kbss-err', role: 'alert' }, srcErr),
            srcOpen === true
              ? h(SourceModal, { source: src, busy: srcBusy, error: srcErr, onClose: () => setSrcOpen(false), onSubmit: saveSource })
              : null)
        }

        // The write policy: the only folders the host writes to (GET /status answers them with
        // their origin and whether they exist on disk). A root the host reports as read-only
        // stays visible with the word "read-only", never with a write it does not have.
        const rootsCard = () => h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-roots' },
          h('h3', { className: 'kbss-h2' }, t('set.rootsH')),
          h('p', { className: 'kbss-sub' }, t('set.rootsSub')),
          roots === null || roots.length === 0
            ? h('p', { className: 'kbss-sub' }, t('set.rootsMissing'))
            : roots.map((r) => h('div', { key: r.path, className: 'kbss-root-row', 'data-kb': 'skills-settings-root' },
                icon('folder', 14),
                h('span', { className: 'p', title: r.path }, r.path),
                h('span', { className: 'kb8-pill' }, r.source),
                h('span', { className: 'kb8-pill' + (r.exists === true ? ' ok' : ' warn') }, r.exists === true ? t('set.rootExists') : t('set.rootMissing')),
                h('span', { className: 'kb8-pill' + (r.writable === false ? ' warn' : ' ok') }, r.writable === false ? t('set.rootRead') : t('set.rootWrite')))))

        const countsCard = () => counts === null
          ? null
          : h('div', { className: 'kbss-card', 'data-kb': 'skills-settings-counts' },
              h('h3', { className: 'kbss-h2' }, t('set.countsH')),
              h('div', { className: 'kbss-kpis' },
                h('span', null, h('span', { className: 'n' }, nf(counts.installed)), ' ', t('set.installed')),
                h('span', null, h('span', { className: 'n' }, nf(counts.active)), ' ', t('set.active')),
                h('span', null, h('span', { className: 'n' }, nf(counts.disabled)), ' ', t('set.disabled')),
                counts.featured === null ? null : h('span', null, h('span', { className: 'n' }, nf(counts.featured)), ' ', t('set.featured'))))

        return h('div', { className: 'kbss-page', 'data-kb': 'kybernos-skills-settings' },
          h('h2', { className: 'kbss-h1' }, t('set.h1')),
          h('p', { className: 'kbss-lead' }, t('set.lead')),
          sourceCard(),
          rootsCard(),
          countsCard())
      }

      /** A settings page that fails to render must never take the Settings dialog down with it. */
      class KbSettingsBoundary extends React.Component {
        constructor (props) { super(props); this.state = { failed: false } }
        static getDerivedStateFromError () { return { failed: true } }
        componentDidCatch (e) { try { console.error('[kybernos-skills] settings page crashed:', e) } catch (e2) { /* console gone */ } }
        render () {
          if (this.state.failed !== true) return this.props.children
          return h('div', { className: 'kbss-page', role: 'alert' }, h('p', { className: 'kbss-err' }, t('y.loadfail')))
        }
      }

      // Stylesheet set ONCE, by id, and refreshed on every apply of the
      // module. Before, it lived in a ctx.effect: when the plugin reloaded
      // (patchReload) the previous effect was unmounted, the stylesheet
      // removed — and if the new apply returned early (`slots` service not
      // ready yet), it was never set again. The panel stayed mounted with
      // only the pivot's styles (stacked toolbar, overlapping labels,
      // search at 52 px): the page looked broken without any error being
      // raised. Same mechanism as the pivot: set by id, never removed,
      // content updated if the module's version changed.
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
        } catch (e) { /* head unavailable */ }
      }

      function apply(ctx) {
        // Styles first: they are needed as soon as the panel is mounted,
        // even if the slot is not available yet.
        kbStyle(CSS)
        const slots = ctx.get('slots')
        if (slots === undefined) {
          console.error('[kybernos-skills] service slots indisponible: pas d interface')
          return
        }
        slots.inject('main.kybernos-skills', () => slots.register(
          { name: 'main.kybernos-skills' },
          KybernosSkills))
        // ── the catalogue's Settings page ──
        // Same seat as the other bundles' settings pages (kybernos-websearch, kybernos-usage, …):
        // settings.section { id, order, label }. The label is a FUNCTION so it follows the current
        // language (models' page does the same); the order sits between the core's Voice (25) and
        // Commands (27). Registered LAST and guarded: a slot that is not there yet is never fatal.
        try {
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-skills', order: 26, label: () => t('set.nav') },
            (props) => {
              try { return h(KbSettingsBoundary, props, h(SkillsSettingsPage, props)) } catch (e) { return null }
            }))
        } catch (kbSettingsError) {
          try { console.warn('[kybernos-skills] settings section not mounted', kbSettingsError) } catch (e2) { /* console gone */ }
        }
      }

      return {
        inject: ['slots'],
        apply(ctx) { apply(ctx) }
      }
    } catch (kbBootError) {
      try {
        console.error('[kybernos-skills] chargement impossible — plugin desactive, GUI preservee', kbBootError)
      } catch (e2) { /* console unavailable */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
