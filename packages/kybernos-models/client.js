// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-models — client : « Model catalog », catalogue de modèles
// personnalisé, en pied de la page Réglages → Models.
//
// Ce que fait l'écran (maquette « Model catalog — capabilities override ») :
// chaque modèle d'une route configurée est une ligne (ID + nom affiché) qui se
// déplie en une fiche « Model details » : INPUT, OUTPUT, CAPABILITIES, TYPE,
// LIMITS, PRICING, METADATA. Trois couches se superposent —
//
//     base    ce que le harnais sait sans rien consulter
//     remote  ce que models.dev répond pour cet id
//     ov      ce que l'utilisateur surcharge
//
// et la valeur effective est toujours `ov` sinon `remote` (si synchronisé)
// sinon `base`. Les pastilles disent d'où vient la valeur : bleu = models.dev,
// ambre = surcharge. Un revert par champ, « Clear N overrides » pour tout, et
// « Restore defaults » au niveau du panneau.
//
// ── LES DEUX NIVEAUX (le point honnête de cet écran) ───────────────────────
// Le harnais n'accepte, PAR MODÈLE installé, que six champs (`llm-pi-ai` →
// `providers.<route>.modelOverrides.<id>`) : `name`, `contextWindow`,
// `maxTokens`, `input` (text/image), `reasoningEfforts`, `compat`. Ceux-là sont
// réellement APPLIQUÉS : écrits dans settings.yaml, ils changent les appels
// suivants, sans redémarrage. Tous les autres champs de la maquette (pricing,
// type, family, knowledge, release, weights, sorties TTS/image/vidéo, search,
// s2s, max input) n'ont AUCUN équivalent dans la configuration : ce sont des
// ANNOTATIONS Kybernos, conservées dans le fichier du plugin et lues par les
// vues Kybernos (coût, lisibilité). Chaque contrôle porte donc un marqueur
// discret : maillon = appliqué au harnais, étiquette = annotation.
//
// Phase 1 (ce commit) : l'écran est complet sur un JEU FIGÉ (`KBM.live` faux) et
// n'écrit rien. Le branchement réel vit dans `kbMSave` et `kbMLoad`, à un seul
// endroit, pour que la bascule se fasse sans toucher aux composants.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-models',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── langue : la locale DSH quand elle répond, sinon anglais ────────────
      // Lue à l'APPEL, jamais à la définition : le service peut ne pas être
      // injecté et `ctx` n'existe qu'après apply().
      let kbCtx = null
      let kbLocaleRead = () => 'en'
      const KB_M_T = {
        'kb.models.title': { kybernos: 'Modèles', en: 'Models' },
        'kb.models.surface.entry': { kybernos: 'Fournisseur IA & modèles', en: 'AI Provider & Models' },
        'kb.models.surface.hint': { kybernos: "Notre catalogue vit ici, sur sa propre page : la page Réglages ▸ Models du harnais reste native, et rien n'est masqué.", en: 'Our catalog lives here, on its own page: the harness Settings → Models page stays native, and nothing is hidden.' },
        'kb.models.sub': { kybernos: 'Catalogue de modèles personnalisé — prefill models.dev, surcharge par champ.', en: 'Customized model catalog — models.dev prefill, per-field override.' },
        'kb.models.page.info': { kybernos: '{a}–{b} sur {n} modèles', en: '{a}–{b} of {n} models' },
        'kb.models.page.prev': { kybernos: 'Page précédente', en: 'Previous page' },
        'kb.models.page.next': { kybernos: 'Page suivante', en: 'Next page' },
        'kb.models.restore': { kybernos: 'Rétablir les défauts', en: 'Restore defaults' },
        'kb.prov.voir': { kybernos: 'Voir les modèles', en: 'View models' },
        'kb.prov.add': { kybernos: 'Ajouter un fournisseur', en: 'Add provider' },
        'kb.prov.add.slug': { kybernos: 'Identifiant', en: 'Identifier' },
        'kb.prov.add.fait': { kybernos: '{slug} est ajouté.', en: '{slug} was added.' },
        'kb.prov.add.deja': { kybernos: 'Déjà ajouté', en: 'Already added' },
        'kb.prov.add.tab.cat': { kybernos: 'Fournisseur du catalogue', en: 'Catalog provider' },
        'kb.prov.add.tab.perso': { kybernos: 'API personnalisée', en: 'Custom API' },
        'kb.prov.add.desc.cat': { kybernos: 'Choisissez OpenAI, Anthropic, Kimi… dans le catalogue et collez votre clé API.', en: 'Pick OpenAI, Anthropic, Kimi… from the catalog and paste your API key.' },
        'kb.prov.add.desc.perso': { kybernos: 'Branchez n’importe quel endpoint compatible OpenAI : votre passerelle, un serveur local, un revendeur.', en: 'Plug in any OpenAI-compatible endpoint: your gateway, a local server, a reseller.' },
        'kb.prov.add.fournisseur': { kybernos: 'Fournisseur', en: 'Provider' },
        'kb.prov.add.choisir': { kybernos: 'Choisir un fournisseur…', en: 'Choose a provider…' },
        'kb.prov.add.cle.label': { kybernos: 'Clé API', en: 'API key' },
        'kb.prov.add.cle.ph': { kybernos: 'Collez la clé — ou laissez vide pour la poser plus tard', en: 'Paste the key — or leave blank to add it later' },
        'kb.prov.add.cle.note': { kybernos: 'Stockée dans le coffre local du harnais, jamais dans settings.yaml.', en: 'Stored in the harness’s local vault, never in settings.yaml.' },
        'kb.prov.add.cle.voir': { kybernos: 'Afficher', en: 'Show' },
        'kb.prov.add.cle.cacher': { kybernos: 'Masquer', en: 'Hide' },
        'kb.prov.add.reglages': { kybernos: 'Réglages avancés', en: 'Advanced settings' },
        'kb.prov.add.fait.cleok': { kybernos: '{slug} est ajouté et sa clé est enregistrée.', en: '{slug} was added and its key saved.' },
        'kb.prov.add.fait.cleko': { kybernos: '{slug} est ajouté, mais la clé n’a pas pu être enregistrée — posez-la via le flux natif.', en: '{slug} was added, but its key could not be saved — add it through the native flow.' },
        'kb.prov.add.grp.free': { kybernos: 'Modèles gratuits (quota)', en: 'Free models (quota)' },
        'kb.prov.add.grp.pop': { kybernos: 'Populaires', en: 'Popular' },
        'kb.prov.add.grp.tous': { kybernos: 'Tous les fournisseurs', en: 'All providers' },
        'kb.prov.add.resultat1': { kybernos: '1 résultat', en: '1 result' },
        'kb.prov.add.resultatsN': { kybernos: '{n} résultats', en: '{n} results' },
        'kb.prov.add.aucun': { kybernos: 'Aucun fournisseur — essayez l’onglet « API personnalisée ».', en: 'No provider — try the “Custom API” tab.' },
        'kb.prov.add.pied': { kybernos: '{n} fournisseurs · models.dev · ↑↓ pour naviguer, Entrée pour choisir', en: '{n} providers · models.dev · ↑↓ to browse, Enter to pick' },
        'kb.prov.add.url.a.completer': { kybernos: 'URL propre à votre compte — à compléter dans les réglages avancés.', en: 'Account-specific URL — complete it in advanced settings.' },
        'kb.prov.add.presets': { kybernos: 'Fournisseurs connus', en: 'Known providers' },
        'kb.prov.add.chercher': { kybernos: 'Rechercher un fournisseur…', en: 'Search a provider…' },
        'kb.prov.free': { kybernos: 'Free models · quota', en: 'Free models · quota' },
        'kb.prov.free.titre': { kybernos: 'Ce fournisseur propose des modèles gratuits sous quota — voir sa collection « free ».', en: 'This provider offers free models under quota — see its “free” collection.' },
        'kb.prov.free.lien': { kybernos: 'Voir les modèles gratuits', en: 'See free models' },
        'kb.models.fetch': { kybernos: 'Récupérer les modèles disponibles', en: 'Fetch available models' },
        'kb.models.add': { kybernos: 'Ajouter un modèle', en: 'Add model' },
        'kb.models.details': { kybernos: 'Détails du modèle', en: 'Model details' },
        'kb.models.id': { kybernos: 'ID du modèle', en: 'Model ID' },
        'kb.models.name': { kybernos: "Nom affiché", en: 'Display name' },
        'kb.models.show': { kybernos: 'Afficher les détails de', en: 'Show details for' },
        'kb.models.hide': { kybernos: 'Masquer les détails de', en: 'Hide details for' },
        'kb.models.delete': { kybernos: 'Supprimer le modèle', en: 'Delete model' },
        'kb.models.openmd': { kybernos: 'Ouvrir models.dev', en: 'Open models.dev' },
        'kb.models.sync': { kybernos: 'Synchroniser depuis models.dev', en: 'Fetch from models.dev' },
        'kb.models.resync': { kybernos: 'Resynchroniser depuis models.dev', en: 'Re-sync from models.dev' },
        'kb.models.fetching': { kybernos: 'Récupération…', en: 'Fetching…' },
        'kb.models.clear1': { kybernos: 'Effacer la surcharge', en: 'Clear override' },
        'kb.models.clearN': { kybernos: 'Effacer {n} surcharges', en: 'Clear {n} overrides' },
        'kb.models.revert': { kybernos: 'Revenir à {v}', en: 'Revert to {v}' },
        'kb.models.clearfield': { kybernos: 'Effacer la surcharge', en: 'Clear override' },
        'kb.models.clearfield.live': { kybernos: 'Retirer la surcharge — la clé est effacée de settings.yaml', en: 'Remove the override — the key is deleted from settings.yaml' },
        'kb.models.sync.src': { kybernos: 'valeur models.dev', en: 'value from models.dev' },
        'kb.models.ov.src': { kybernos: 'surcharge de vous', en: 'overridden by you' },
        'kb.models.legend.sync': { kybernos: 'models.dev', en: 'models.dev' },
        'kb.models.legend.ov': { kybernos: 'surcharge', en: 'Override' },
        'kb.models.legend.wire': { kybernos: 'appliqué au harnais', en: 'applied to the harness' },
        'kb.models.legend.note': { kybernos: 'annotation Kybernos', en: 'Kybernos annotation' },
        'kb.models.foot.wired': { kybernos: '{n} contrôles appliqués — 5 champs de llm-pi-ai', en: '{n} controls applied — 5 llm-pi-ai fields' },
        'kb.models.foot.note': { kybernos: '{n} annotations Kybernos', en: '{n} Kybernos annotations' },
        'kb.models.mark.wire': { kybernos: 'Écrit dans settings.yaml — appliqué aux appels suivants', en: 'Written to settings.yaml — applied to later calls' },
        'kb.models.mark.note': { kybernos: "Annotation Kybernos — n'affecte pas les appels de modèle", en: 'Kybernos annotation — does not affect model calls' },
        'kb.models.wire.note': { kybernos: 'Marqueur : maillon = écrit dans settings.yaml (effet réel) · étiquette = annotation locale.', en: 'Marker: link = written to settings.yaml (real effect) · tag = local annotation.' },
        'kb.models.status.loading': { kybernos: 'Recherche de {id} sur models.dev…', en: 'Looking up {id} on models.dev…' },
        'kb.models.status.matched': { kybernos: '{id} reconnu · {n} valeurs récupérées', en: 'Matched {id} · {n} values fetched' },
        'kb.models.status.kept': { kybernos: '{n} surcharge(s) conservée(s)', en: '{n} override(s) kept' },
        'kb.models.status.stale': { kybernos: 'index hors ligne (cache de plus de 6 h)', en: 'index offline (cache older than 6 h)' },
        'kb.models.status.idle': { kybernos: 'Pas encore synchronisé. La récupération préremplit capacités, limites et tarifs. Vos modifications gagnent toujours.', en: 'Not synced yet. Fetching pre-fills capabilities, limits and pricing. Your own edits always win.' },
        'kb.models.note.type': { kybernos: "models.dev n'a pas de drapeau Search : réglez-le vous-même. S2S et le type de modèle se déduisent des modalités d'entrée et de sortie.", en: 'models.dev has no Search flag, so set it yourself. S2S and Model type are derived from the input and output modalities.' },
        'kb.models.sec.input': { kybernos: 'Entrée', en: 'INPUT' },
        'kb.models.sec.output': { kybernos: 'Sortie', en: 'OUTPUT' },
        'kb.models.sec.caps': { kybernos: 'Capacités', en: 'CAPABILITIES' },
        'kb.models.sec.type': { kybernos: 'Type', en: 'TYPE' },
        'kb.models.sec.limits': { kybernos: 'Limites', en: 'LIMITS' },
        'kb.models.sec.pricing': { kybernos: 'Tarifs', en: 'PRICING' },
        'kb.models.sec.meta': { kybernos: 'Métadonnées', en: 'METADATA' },
        // ── notes externes (Artificial Analysis + BenchLM) ────────────────────
        'kb.models.sec.scores': { kybernos: 'Notes externes', en: 'EXTERNAL SCORES' },
        'kb.models.scores.hint': { kybernos: 'deux sources, jamais fusionnées', en: 'two sources, never merged' },
        'kb.models.scores.loading': { kybernos: 'Lecture des catalogues…', en: 'Reading the catalogues…' },
        // « dans aucun catalogue » serait FAUX quand le modèle y figure deux fois
        // (AA liste « Claude 4.5 Sonnet » en Reasoning et Non-reasoning : mêmes mots,
        // deux modèles) — le refus de deviner doit se lire comme tel.
        // Une lecture CASSÉE ne doit pas se lire « aucune note » : c'est une
        // panne déguisée en résultat, et l'utilisateur chercherait le modèle au
        // lieu de la route. Deux états, deux phrases.
        'kb.models.scores.failed': { kybernos: 'Relevé illisible : la route des notes n’a pas répondu.', en: 'Reading failed: the scores route did not answer.' },
        'kb.models.scores.empty': { kybernos: 'Aucune note : aucun rapprochement sûr dans l’un ou l’autre catalogue.', en: 'No score: no unambiguous match in either catalogue.' },
        'kb.models.scores.intelligence': { kybernos: 'Intelligence', en: 'Intelligence' },
        'kb.models.scores.overall': { kybernos: 'Note globale', en: 'Overall' },
        'kb.models.scores.provisional': { kybernos: 'provisoire', en: 'provisional' },
        'kb.models.scores.verified': { kybernos: 'vérifiée', en: 'verified' },
        'kb.models.scores.unranked': { kybernos: 'non classé', en: 'not ranked' },
        'kb.models.scores.rank': { kybernos: 'rang {n}', en: 'rank {n}' },
        'kb.models.scores.coverage': { kybernos: '{n} épreuves · {m} classables · confiance {c}/3', en: '{n} benchmarks · {m} rankable · confidence {c}/3' },
        'kb.models.scores.method': { kybernos: 'rapproché par {m}', en: 'matched by {m}' },
        'kb.models.scores.method.slug': { kybernos: 'identifiant exact', en: 'exact id' },
        'kb.models.scores.method.nom': { kybernos: 'nom', en: 'name' },
        'kb.models.scores.method.id-court': { kybernos: 'nom court, sur identifiant', en: 'short name, on identifier' },
        'kb.models.scores.method.nom-sans-qualificatif': { kybernos: 'nom sans qualificatif', en: 'name without qualifier' },
        'kb.models.scores.method.nom-en-desordre': { kybernos: 'même mots, autre ordre', en: 'same words, other order' },
        'kb.models.scores.estimated': { kybernos: 'estimée', en: 'estimated' },
        'kb.models.scores.old': { kybernos: 'périmé', en: 'stale' },
        'kb.models.scores.note': {
          kybernos: 'Deux provenances, jamais fusionnées : les indices « coding » et « agentic » d’Artificial Analysis et de BenchLM ne mesurent pas la même chose (sur MiMo-V2.5-Pro, 21,3 contre 58,9 d’agentic — les deux chiffres sont vrais). Les valeurs viennent des pages publiques, pas de l’API ; l’API payante ajouterait les scores par épreuve.',
          en: 'Two provenances, never merged: the “coding” and “agentic” indices from Artificial Analysis and BenchLM do not measure the same thing (on MiMo-V2.5-Pro, 21.3 vs 58.9 agentic — both numbers are true). Values come from the public pages, not the API; the paid API would add per-benchmark scores.',
        },
        'kb.models.scores.price': { kybernos: '{a} $ entrée · {b} $ sortie, par million de jetons', en: '{a} $ in · {b} $ out, per million tokens' },
        'kb.models.scores.tok': { kybernos: '{n} jetons/s', en: '{n} tokens/s' },
        'kb.models.scores.ttft': { kybernos: '1ᵉʳ jeton {n} s', en: 'first token {n} s' },
        'kb.models.scores.reload': { kybernos: 'Relire', en: 'Re-read' },
        'kb.models.scores.reload.all': { kybernos: 'Relever les catalogues', en: 'Refresh catalogues' },
        'kb.models.scores.refreshing': { kybernos: 'Relevé en cours…', en: 'Refreshing…' },
        'kb.models.scores.refreshed': { kybernos: 'Catalogues relevés', en: 'Catalogues refreshed' },
        'kb.models.scores.fresh': { kybernos: 'déjà à jour', en: 'already up to date' },
        'kb.models.scores.stale': { kybernos: 'relevé du {d}', en: 'read on {d}' },
        'kb.models.cat.agentic': { kybernos: 'Agentique', en: 'Agentic' },
        'kb.models.cat.coding': { kybernos: 'Code', en: 'Coding' },
        'kb.models.cat.reasoning': { kybernos: 'Raisonnement', en: 'Reasoning' },
        'kb.models.cat.knowledge': { kybernos: 'Connaissances', en: 'Knowledge' },
        'kb.models.cat.multimodalGrounded': { kybernos: 'Multimodal', en: 'Multimodal' },
        'kb.models.cat.multilingual': { kybernos: 'Multilingue', en: 'Multilingual' },
        'kb.models.cat.instructionFollowing': { kybernos: 'Consignes', en: 'Instruction following' },
        'kb.models.cat.math': { kybernos: 'Mathématiques', en: 'Math' },
        'kb.models.cat.external': { kybernos: 'Externe', en: 'External' },
        'kb.models.pricing.unit': { kybernos: 'USD / 1M tokens', en: 'USD / 1M tokens' },
        'kb.models.usd': { kybernos: 'USD', en: 'USD' },
        'kb.models.empty': { kybernos: 'Aucun modèle à afficher pour l\'instant — ajoutez-en un, ou configurez une route dans Models.', en: 'No model to show yet — add one, or configure a route in Models.' },
        // libellés de champs
        'kb.models.f.textIn': { kybernos: 'Texte entrant', en: 'Text In' },
        'kb.models.f.vision': { kybernos: 'Vision', en: 'Vision' },
        'kb.models.f.video': { kybernos: 'Vidéo', en: 'Video' },
        'kb.models.f.audioIn': { kybernos: 'Audio entrant', en: 'Audio In' },
        'kb.models.f.textOut': { kybernos: 'Texte sortant', en: 'Text Out' },
        'kb.models.f.tts': { kybernos: 'Synthèse vocale', en: 'TTS' },
        'kb.models.f.imageGen': { kybernos: 'Génération d\'images', en: 'Image Gen' },
        'kb.models.f.videoGen': { kybernos: 'Génération de vidéos', en: 'Video Gen' },
        'kb.models.f.tools': { kybernos: 'Outils', en: 'Tools' },
        'kb.models.f.search': { kybernos: 'Recherche', en: 'Search' },
        'kb.models.f.s2s': { kybernos: 'Speech to speech', en: 'S2S' },
        'kb.models.f.reasoning': { kybernos: 'Raisonnement', en: 'Reasoning' },
        'kb.models.f.structured': { kybernos: 'Sortie structurée', en: 'Structured output' },
        'kb.models.f.temperature': { kybernos: 'Température', en: 'Temperature' },
        'kb.models.f.context': { kybernos: 'Fenêtre de contexte', en: 'Context window' },
        'kb.models.f.inputLimit': { kybernos: 'Entrée maximale', en: 'Max input' },
        'kb.models.f.outputLimit': { kybernos: 'Sortie maximale', en: 'Max output' },
        'kb.models.f.costIn': { kybernos: 'Entrée', en: 'Input' },
        'kb.models.f.costOut': { kybernos: 'Sortie', en: 'Output' },
        'kb.models.f.cacheRead': { kybernos: 'Lecture de cache', en: 'Cache read' },
        'kb.models.f.cacheWrite': { kybernos: 'Écriture de cache', en: 'Cache write' },
        'kb.models.f.family': { kybernos: 'Famille', en: 'Family' },
        'kb.models.f.knowledge': { kybernos: 'Connaissances arrêtées à', en: 'Knowledge cutoff' },
        'kb.models.f.release': { kybernos: 'Date de sortie', en: 'Release date' },
        'kb.models.f.weights': { kybernos: 'Poids', en: 'Weights' },
        'kb.models.tab.models': { kybernos: 'Modèles {n}', en: 'Models {n}' },
        'kb.models.tab.providers': { kybernos: 'Fournisseurs {n}', en: 'Providers {n}' },
        'kb.models.prov.empty': { kybernos: 'Aucun fournisseur exposé pour le moment.', en: 'No provider exposed yet.' },
        'kb.models.prov.model1': { kybernos: 'modèle', en: 'model' },
        'kb.models.prov.modelN': { kybernos: 'modèles', en: 'models' },
        'kb.prov.off.badge': { kybernos: 'Désactivé', en: 'Disabled' },
        'kb.prov.off.disable': { kybernos: 'Désactiver {slug}', en: 'Disable {slug}' },
        'kb.prov.off.enable': { kybernos: 'Réactiver {slug}', en: 'Enable {slug}' },
        'kb.prov.off.locked': { kybernos: 'Défini par le profil : ne peut pas être désactivé ici.', en: 'Defined by the profile: it cannot be disabled here.' },
        'kb.prov.off.managed': { kybernos: 'Géré par Kybernos Cloud : déconnectez le compte pour le retirer.', en: 'Managed by Kybernos Cloud: disconnect the account to remove it.' },
        'kb.prov.off.dlg.title': { kybernos: 'Désactiver {slug} ?', en: 'Disable {slug}?' },
        'kb.prov.off.dlg.body': { kybernos: 'Les sessions qui utilisent un modèle de {slug} ne pourront plus l’appeler. Le réactiver rétablit tout à l’identique : clé, modèles et réglages.', en: 'Sessions that use a {slug} model will no longer be able to call it. Enabling it again restores everything as it was: key, models and settings.' },
        'kb.prov.off.dlg.ok': { kybernos: 'Désactiver', en: 'Disable' },
        'kb.prov.off.dlg.cancel': { kybernos: 'Annuler', en: 'Cancel' },
        'kb.prov.off.err': { kybernos: 'Impossible de désactiver {slug} : {raison}', en: 'Could not disable {slug}: {raison}' },
        'kb.prov.on.err': { kybernos: 'Impossible de réactiver {slug} : {raison}', en: 'Could not enable {slug}: {raison}' },
        'kb.nat.open': { kybernos: 'Ouvrir la page native de DSH', en: 'Open DSH’s native Models page' },
        'kb.nat.note.t': { kybernos: 'Page native de DSH', en: 'DSH’s native page' },
        'kb.nat.note.b': { kybernos: 'Tout ce qui se fait ici se fait aussi dans « Fournisseur IA & modèles », avec plus de détails. Les deux pages lisent et écrivent les mêmes réglages : elles restent synchronisées.', en: 'Everything done here can also be done in “AI Provider & Models”, with more detail. Both pages read and write the same settings, so they stay in sync.' },
        'kb.nat.back': { kybernos: 'Ouvrir Fournisseur IA & modèles', en: 'Open AI Provider & Models' },
        'kb.nat.hide': { kybernos: 'Masquer la page native du menu des Réglages', en: 'Hide DSH’s native page from the Settings menu' },
        'kb.nat.show': { kybernos: 'Afficher cette page dans le menu des Réglages', en: 'Show this page in the Settings menu' },
        'kb.nat.crash.t': { kybernos: 'Cette page n’a pas pu s’afficher.', en: 'This page could not be displayed.' },
        'kb.nat.crash.b': { kybernos: 'La page native de DSH reste disponible.', en: 'DSH’s native Models page is still available.' },
        'kb.pv.title.add': { kybernos: 'Ajouter un fournisseur de modèles', en: 'Add model provider' },
        'kb.pv.diag': { kybernos: 'Config à réparer', en: 'Config error' },
        'kb.pv.custom': { kybernos: 'Perso', en: 'Custom' },
        'kb.pv.builtin': { kybernos: 'Intégré à DSH', en: 'Built into DSH' },
        'kb.pv.builtin.edit': { kybernos: 'Se modifie sur la page native de DSH', en: 'Edited on DSH’s native page' },
        'kb.pv.edit': { kybernos: 'Modifier {slug}', en: 'Edit {slug}' },
        'kb.pv.more': { kybernos: 'Plus d’actions pour {slug}', en: 'More for {slug}' },
        'kb.pv.more.page': { kybernos: 'Plus d’actions', en: 'More actions' },
        'kb.pv.close': { kybernos: 'Fermer', en: 'Close' },
        'kb.pv.menu.add': { kybernos: 'Ajouter un modèle…', en: 'Add model…' },
        'kb.pv.menu.delete': { kybernos: 'Supprimer…', en: 'Delete…' },
        'kb.pv.key.ok': { kybernos: 'Clé API configurée', en: 'API key configured' },
        'kb.pv.key.missing': { kybernos: 'Clé API absente', en: 'API key missing' },
        'kb.pv.key.unknown': { kybernos: 'État de la clé inconnu', en: 'Key state unknown' },
        'kb.pv.key.ph.set': { kybernos: 'Configurée — saisissez une nouvelle valeur pour la remplacer', en: 'Configured — enter a new value to replace' },
        'kb.pv.key.ph.blank': { kybernos: 'Saisissez une clé, ou laissez vide pour l’authentification par environnement', en: 'Enter an API key, or leave blank to use environment authentication' },
        'kb.pv.customized': { kybernos: 'Réglages personnalisés', en: 'Customized settings' },
        'kb.pv.name': { kybernos: 'Nom affiché', en: 'Display name' },
        'kb.pv.url': { kybernos: 'URL de base', en: 'Base URL' },
        'kb.pv.url.default': { kybernos: 'Défaut du fournisseur', en: 'Provider default' },
        'kb.pv.proto': { kybernos: 'Protocole API', en: 'API protocol' },
        'kb.pv.proto.chat': { kybernos: 'OpenAI Chat Completions', en: 'OpenAI Chat Completions' },
        'kb.pv.proto.resp': { kybernos: 'OpenAI Responses', en: 'OpenAI Responses' },
        'kb.pv.proto.msgs': { kybernos: 'Anthropic Messages', en: 'Anthropic Messages' },
        'kb.pv.provider.id': { kybernos: 'Identifiant du fournisseur', en: 'Provider ID' },
        'kb.pv.provider.id.hint': { kybernos: 'Identifiant en minuscules, commençant par une lettre, qui nomme ce fournisseur dans les requêtes et comme nom de son identifiant de clé.', en: 'Lowercase identifier, starting with a letter, that uniquely names this provider in requests and as its credential name.' },
        'kb.pv.models': { kybernos: 'Modèles', en: 'Models' },
        'kb.pv.model.id': { kybernos: 'Identifiant du modèle', en: 'Model ID' },
        'kb.pv.model.name': { kybernos: 'Nom affiché', en: 'Display name' },
        'kb.pv.model.del': { kybernos: 'Supprimer le modèle {n}', en: 'Delete model {n}' },
        'kb.pv.model.add': { kybernos: 'Ajouter un modèle', en: 'Add model' },
        'kb.pv.models.none': { kybernos: 'Aucun modèle ne sera proposé dans le sélecteur. Les identifiants non listés peuvent toujours être envoyés directement.', en: 'No models will be shown in the selector. Unlisted IDs can still be sent directly.' },
        'kb.pv.models.catalog': { kybernos: 'Ce fournisseur utilise son catalogue. Ajoutez un modèle seulement pour en déclarer un de plus.', en: 'This provider uses its catalog. Add a model only to declare an extra one.' },
        'kb.pv.apply': { kybernos: 'Appliquer', en: 'Apply' },
        'kb.pv.cancel': { kybernos: 'Annuler', en: 'Cancel' },
        'kb.pv.create': { kybernos: 'Créer le fournisseur', en: 'Create provider' },
        'kb.pv.saved': { kybernos: 'Appliqué. Pris en compte à la prochaine requête, sans redémarrage.', en: 'Applied. It takes effect on the next request, no restart.' },
        'kb.pv.saved.key.ko': { kybernos: 'Appliqué, mais la clé n’a pas pu être enregistrée.', en: 'Applied, but the key could not be saved.' },
        'kb.pv.save.err': { kybernos: 'Impossible d’appliquer : {raison}', en: 'Could not apply: {raison}' },
        'kb.pv.add.err': { kybernos: 'Impossible d’ajouter : {raison}', en: 'Could not add: {raison}' },
        'kb.pv.del.title': { kybernos: 'Supprimer {slug} ?', en: 'Delete {slug}?' },
        'kb.pv.del.body': { kybernos: 'Cela retire le fournisseur, ses {n} modèles, leurs surcharges et sa clé. Pour tout garder, désactivez-le plutôt.', en: 'This removes the provider, its {n} models, their overrides and its key. To keep them, disable it instead.' },
        'kb.pv.del.type': { kybernos: 'Saisissez {slug} pour confirmer', en: 'Type {slug} to confirm' },
        'kb.pv.del.ok': { kybernos: 'Supprimer le fournisseur', en: 'Delete provider' },
        'kb.pv.del.instead': { kybernos: 'Désactiver plutôt', en: 'Disable instead' },
        'kb.pv.del.err': { kybernos: 'Impossible de supprimer {slug} : {raison}', en: 'Could not delete {slug}: {raison}' },
        'kb.pv.zone.off': { kybernos: 'Désactiver', en: 'Disable' },
        'kb.pv.zone.off.d': { kybernos: 'Masque ses modèles et bloque les appels. Rien n’est supprimé.', en: 'Hides its models and blocks calls. Nothing is deleted.' },
        'kb.pv.zone.del': { kybernos: 'Supprimer le fournisseur', en: 'Delete provider' },
        'kb.pv.zone.del.d': { kybernos: 'Le retire avec ses modèles, ses surcharges et sa clé.', en: 'Removes it with its models, overrides and key.' },
        'kb.pv.hostnote': { kybernos: 'Désactiver demande un redémarrage de DSH : les nouvelles routes de l’hôte ne sont pas encore chargées.', en: 'Disabling needs a DSH restart: the new host routes are not loaded yet.' },
        'kb.pv.err.pick': { kybernos: 'Choisissez un fournisseur.', en: 'Choose a provider.' },
        'kb.pv.err.slug': { kybernos: 'Identifiant invalide : minuscules, chiffres et tirets.', en: 'Invalid identifier: lowercase letters, digits and dashes.' },
        'kb.pv.err.taken': { kybernos: 'Ce fournisseur existe déjà.', en: 'This provider already exists.' },
        'kb.pv.err.url': { kybernos: 'URL de base invalide : http(s) requis.', en: 'Invalid base URL: http(s) required.' },
        'kb.pv.err.models': { kybernos: 'Ajoutez au moins un modèle : rien ne peut le deviner.', en: 'Add at least one model: nothing can default it.' },
        'kb.pv.err.template': { kybernos: 'Remplacez ${…} par les valeurs de votre compte.', en: 'Replace the ${…} with your account’s values.' },
        'kb.models.search': { kybernos: 'Rechercher par nom, id, fournisseur ou type', en: 'Search by name, id, provider or type' },
        'kb.models.allprov': { kybernos: 'Tous les fournisseurs', en: 'All providers' },
        'kb.models.alltypes': { kybernos: 'Tous les types', en: 'All types' },
        'kb.models.anystatus': { kybernos: 'Tous les états', en: 'Any status' },
        'kb.models.statut.ov': { kybernos: 'Avec surcharges', en: 'Has overrides' },
        'kb.models.statut.sync': { kybernos: 'Synchronisés', en: 'Synced' },
        'kb.models.statut.pending': { kybernos: 'Pas encore synchronisés', en: 'Not synced yet' },
        'kb.models.sort': { kybernos: 'Trier', en: 'Sort' },
        'kb.models.filter.prov': { kybernos: 'Fournisseur', en: 'Provider' },
        'kb.models.filter.type': { kybernos: 'Type', en: 'Type' },
        'kb.models.filter.statut': { kybernos: 'État', en: 'Status' },
        'kb.models.tri.name': { kybernos: 'Nom', en: 'Name' },
        'kb.models.tri.context': { kybernos: 'Contexte', en: 'Context' },
        'kb.models.tri.provider': { kybernos: 'Fournisseur', en: 'Provider' },
        // Valeurs COURTES du déclencheur de filtre : la boîte Réglages ne fait
        // que 556 ou 720 px, « Provider · All providers » sur quatre filtres y
        // passait à la ligne. Le menu déroulant, lui, garde les libellés longs.
        'kb.models.opt.allprov': { kybernos: 'Tous', en: 'All' },
        'kb.models.opt.alltypes': { kybernos: 'Tous', en: 'All' },
        'kb.models.opt.anystatus': { kybernos: 'Indifférent', en: 'Any' },
        'kb.models.reset': { kybernos: 'Réinitialiser les filtres', en: 'Reset filters' },
        'kb.models.count': { kybernos: '{a} sur {b} modèles', en: '{a} of {b} models' },
        'kb.models.syncN': { kybernos: 'Synchroniser {n} depuis models.dev', en: 'Sync {n} from models.dev' },
        'kb.models.capsfilter': { kybernos: 'Capacités', en: 'CAPABILITIES' },
        'kb.models.col.model': { kybernos: 'Modèle', en: 'MODEL' },
        'kb.models.col.prov': { kybernos: 'Fournisseur', en: 'PROVIDER' },
        'kb.models.col.type': { kybernos: 'Type', en: 'TYPE' },
        'kb.models.col.caps': { kybernos: 'Capacités', en: 'CAPABILITIES' },
        'kb.models.col.context': { kybernos: 'Contexte', en: 'CONTEXT' },
        'kb.models.col.price': { kybernos: 'Prix entrée / sortie', en: 'PRICE IN / OUT' },
        'kb.models.col.source': { kybernos: 'Source', en: 'SOURCE' },
        'kb.models.col.synced': { kybernos: 'Synchronisé', en: 'Synced' },
        'kb.models.col.pending': { kybernos: 'Pas encore synchronisé', en: 'Not synced' },
        'kb.models.col.nosync': { kybernos: 'Sans fiche', en: 'No match' },
        'kb.models.col.fetching': { kybernos: 'Synchronisation…', en: 'Fetching…' },
        'kb.models.col.previewed': { kybernos: '{n} prévisualisées', en: '{n} previewed' },
        'kb.models.ovline': { kybernos: '{n} surcharges · {m} appliquées', en: '{n} overrides · {m} applied' },
        'kb.models.ovline1': { kybernos: '1 surcharge · {m} appliquée', en: '1 override · {m} applied' },
        // La pastille ambre de la ligne : courte à l'écran, complète en infobulle.
        'kb.models.ovpill': { kybernos: '{n} surcharges', en: '{n} overrides' },
        'kb.models.ovpill1': { kybernos: '1 surcharge', en: '1 override' },
        'kb.models.ovtip': { kybernos: '{n} surcharges déclarées · {m} changent réellement le harnais', en: '{n} overrides declared · {m} actually change the harness' },
        'kb.models.textonly': { kybernos: 'Texte seul', en: 'Text only' },
        'kb.models.more': { kybernos: '+{n}', en: '+{n}' },
        'kb.models.prov.local': { kybernos: 'Ajouté ici', en: 'Added here' },
        'kb.models.w.unknown': { kybernos: 'Inconnu', en: 'Unknown' },
        'kb.models.w.open': { kybernos: 'Poids ouverts', en: 'Open weights' },
        'kb.models.w.closed': { kybernos: 'Poids fermés', en: 'Closed weights' },
        // types de modèle
        'kb.models.t.chat': { kybernos: 'Chat', en: 'Chat' },
        'kb.models.t.embedding': { kybernos: 'Embedding', en: 'Embedding' },
        'kb.models.t.image': { kybernos: 'Image', en: 'Image' },
        'kb.models.t.video': { kybernos: 'Vidéo', en: 'Video' },
        'kb.models.t.audio': { kybernos: 'Audio', en: 'Audio' },
        'kb.models.t.realtime': { kybernos: 'Temps réel', en: 'Realtime' },
        'kb.models.t.rerank': { kybernos: 'Rerank', en: 'Rerank' },
        'kb.models.t.moderation': { kybernos: 'Modération', en: 'Moderation' },
        'kb.models.phase.sample': { kybernos: 'Jeu de données figé — aucune écriture (phase sans câblage)', en: 'Fixed sample data — nothing is written (pre-wiring phase)' },
        'kb.models.phase.live': { kybernos: 'Catalogue vivant — les réglages marqués d\u2019un maillon s\u2019appliquent déjà à DSH', en: 'Live data — 5 llm-pi-ai fields written to settings.yaml, the rest as annotations' },
        'kb.models.loading': { kybernos: 'Lecture de settings.yaml…', en: 'Reading settings.yaml…' },
        'kb.models.reload': { kybernos: 'Réessayer', en: 'Retry' },
        'kb.models.loaderror': { kybernos: 'Lecture impossible', en: 'Load failed' },
        'kb.models.empty.live': { kybernos: 'aucun modèle configuré dans llm-pi-ai', en: 'no model configured in llm-pi-ai' },
        'kb.models.route': { kybernos: 'route', en: 'route' },
        // ── bloc d'en-tête « AI Provider & Models » (settings.models.header) ──
        'kb.head.title': { kybernos: 'AI Provider & Models', en: 'AI Provider & Models' },
        'kb.head.pitch': { kybernos: 'Utilisez notre liste d\u2019LLM sélectionnés, avec replis automatiques et routage automatique — un seul abonnement.', en: 'Use our curated list of LLMs, with automatic fallbacks, auto-routing — one subscription.' },
        'kb.head.count': { kybernos: '{n} modèles de votre abonnement — le catalogue détaillé vit dans l\u2019onglet « Liste des modèles ».', en: '{n} model(s) from your subscription — the detailed catalog lives in the Model list tab.' },
        'kb.head.more': { kybernos: '+{n} autres', en: '+{n} more' },
        'kb.head.less': { kybernos: 'Réduire', en: 'Show less' },
        'kb.head.pair': { kybernos: 'Aucun modèle Kybernos pour l\u2019instant — couplez Kybernos Cloud pour importer les modèles inclus dans votre abonnement.', en: 'No Kybernos models yet — pair Kybernos Cloud to import the models your subscription includes.' },
        // ── carte Kybernos Cloud (refonte du 2026-09-21, d'après la maquette) ─
        // L'anglais reprend la maquette au mot près ; le français la traduit.
        'kb.hero.badge': { kybernos: 'Recommandé', en: 'Recommended' },
        'kb.hero.connected': { kybernos: 'Connecté', en: 'Connected' },
        'kb.hero.title.free': { kybernos: 'Commencez gratuitement', en: 'Start for free' },
        'kb.hero.title.in': { kybernos: '{n} modèles sélectionnés, inclus', en: '{n} curated models, included' },
        'kb.hero.pitch.free': { kybernos: 'Utilisez notre liste de LLM sélectionnés — aucune clé d\u2019API à mettre à jour.', en: 'Use our curated list of LLMs — no API keys to update.' },
        'kb.hero.pitch.in': { kybernos: 'Importés depuis votre abonnement Kybernos — aucune clé d\u2019API à mettre à jour.', en: 'Imported from your Kybernos subscription — no API keys to update.' },
        'kb.hero.f.fallback': { kybernos: 'Repli automatique', en: 'Auto-fallback' },
        'kb.hero.f.fallback.tip': { kybernos: 'Si un modèle est indisponible, le modèle sélectionné suivant prend le relais tout seul.', en: 'If a model is unavailable, the next curated model takes over automatically.' },
        'kb.hero.f.guard': { kybernos: 'Garde-fous pour protéger vos données', en: 'Guardrails to protect your data' },
        'kb.hero.f.guard.tip': { kybernos: 'Les requêtes restent sous les politiques de Kybernos Cloud — vos clés ne sortent jamais du coffre local.', en: 'Requests stay under Kybernos Cloud policies — your keys never leave the local vault.' },
        'kb.hero.f.models': { kybernos: '{n} modèles sélectionnés', en: '{n} curated models' },
        'kb.hero.f.models.tip': { kybernos: 'Le catalogue Kybernos Cloud inclus dans votre formule — importé dans DSH sans clé à saisir.', en: 'The Kybernos Cloud catalog included with your plan — imported into DSH with no key to type.' },
        'kb.hero.connect': { kybernos: 'Connecter Kybernos Cloud', en: 'Connect to Kybernos Cloud' },
        'kb.hero.manage': { kybernos: 'Gérer Kybernos Cloud', en: 'Manage Kybernos Cloud' },
        'kb.hero.connect.tip': { kybernos: 'Ouvre la carte Kybernos Cloud (appairage, profil, import des modèles).', en: 'Opens the Kybernos Cloud card (pairing, profile, model import).' },
        'kb.hero.or': { kybernos: 'ou', en: 'or' },
        'kb.hero.addkey': { kybernos: 'Ajoutez votre clé d\u2019API', en: 'Add your API key' },
        'kb.hero.addkey.tip': { kybernos: 'Ouvre l\u2019ajout de fournisseur natif — votre propre clé, votre propre route ; la carte n\u2019écrit rien.', en: 'Opens the native Add provider flow — your own key, your own route; the card writes nothing.' },
        'kb.models.local': { kybernos: 'ligne locale — non déclarée dans settings.yaml', en: 'local row — not declared in settings.yaml' },
        'kb.models.readonly': { kybernos: 'Le harnais est en LECTURE SEULE : aucune écriture possible.', en: 'The harness is READ-ONLY: no write is possible.' },
        'kb.models.contract.ok': { kybernos: 'contrat host confirmé (compat hors panneau)', en: 'host contract confirmed (compat outside the panel)' },
        'kb.models.contract.ko': { kybernos: 'CONTRAT HOST DIVERGENT', en: 'HOST CONTRACT DIVERGES' },
        'kb.models.error.remote': { kybernos: 'remotes indisponibles', en: 'remotes unavailable' },
        'kb.models.error.readonly': { kybernos: 'harnais en lecture seule', en: 'harness is read-only' },
        'kb.models.error.nokey': { kybernos: 'renseignez la route et l identifiant', en: 'set the route and the model id' },
        'kb.models.error.path': { kybernos: 'chemin d écriture inconnu', en: 'unknown write path' },
        'kb.models.error.local': { kybernos: 'ligne locale : les champs appliqués exigent un modèle déclaré', en: 'local row: applied fields need a declared model' },
        'kb.models.error.wire': { kybernos: 'valeur non traduisible (niveaux de raisonnement inconnus : synchronisez d abord)', en: 'value cannot be translated (unknown reasoning levels: sync first)' },
        'kb.models.error.conflict': { kybernos: 'settings.yaml a changé entre-temps — relu', en: 'settings.yaml changed meanwhile — reloaded' },
        'kb.models.error.refus': { kybernos: 'refus du harnais', en: 'harness refusal' },
        'kb.models.error.reseau': { kybernos: 'erreur réseau', en: 'network error' },
        'kb.models.error.index': { kybernos: "l index models.dev n est pas disponible sur ce poste — les valeurs de settings.yaml restent la seule source", en: 'the models.dev index is not available on this machine — settings.yaml values remain the only source' },
        'kb.models.error.herite': { kybernos: 'les modèles de cette route viennent d une couche inférieure — ce panneau ne réécrit pas une liste héritée', en: 'this route\'s models come from a lower layer — this panel does not rewrite an inherited list' },
        'kb.models.input.implicite.route': { kybernos: 'input non déclaré : les pastilles montrent le défaut de la route', en: 'input not declared: the chips show the route default' },
        'kb.models.input.implicite.defaut': { kybernos: 'input non déclaré : les pastilles montrent le défaut du harnais (texte)', en: 'input not declared: the chips show the harness default (text)' },
        'kb.models.remove.annotations': { kybernos: 'Effacer les annotations de', en: 'Clear annotations of' },
        'kb.models.remove.note': { kybernos: 'annotations effacées — les surcharges de settings.yaml restent (retirez-les champ par champ)', en: 'annotations cleared — the settings.yaml overrides remain (remove them field by field)' },
        'kb.models.restore.arm': { kybernos: 'Confirmer : retirer TOUTES les surcharges ?', en: 'Confirm: remove ALL overrides?' },
        'kb.models.restore.note': { kybernos: 'surcharges retirées : ', en: 'overrides removed: ' },
        'kb.models.error.nomatch': { kybernos: 'models.dev ne connaît pas ce modèle — aucun préremplissage', en: 'models.dev does not know this model — no prefill' },
        'kb.models.error': { kybernos: 'Écriture refusée', en: 'Write refused' },
      }
      const m = (key, vars) => {
        let lang = 'kybernos'
        try {
          const brut = String((window.__KB_I18N_ACTIVE__ && window.__KB_I18N_ACTIVE__.lang) || localStorage.getItem('kybernos.theme.lang') || '')
          if (brut !== '') lang = brut
          else {
            lang = String(kbLocaleRead())
            // Politique de langue (chasse Settings 27/09) : sans choix
            // Kybernos, suivre le shell uniquement pour les langues
            // réellement traduites (ar/he/fa/ur) — sinon français.
            if (['ar', 'he', 'fa', 'ur'].indexOf(lang.split(/[-_]/)[0]) < 0) lang = 'kybernos'
          }
        } catch (e) { lang = 'kybernos' }
        const entry = KB_M_T[key]
        let text = entry === null || entry === undefined ? key : (entry[lang] !== undefined ? entry[lang] : (entry.en !== undefined ? entry.en : key))
        if (vars !== null && vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }

      // ── icônes : tracés exacts de la maquette (Lucide) ─────────────────────
      const ICONS = {
        type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
        eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
        video: ['M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14', 'M4 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
        mic: ['M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v4'],
        volume: ['M11 5L6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
        image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M21 15l-5-5L5 21'],
        film: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M7 3v18', 'M17 3v18', 'M3 12h18', 'M3 7.5h4', 'M3 16.5h4', 'M17 7.5h4', 'M17 16.5h4'],
        wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
        globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
        headphones: ['M3 14v-2a9 9 0 0 1 18 0v2', 'M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z', 'M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'],
        bulb: ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z'],
        braces: ['M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1', 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'],
        thermometer: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z'],
        chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
        layers: ['M12 2 2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
        bars: ['M2 10v3', 'M6 6v11', 'M10 3v18', 'M14 8v7', 'M18 5v13', 'M22 10v3'],
        rerank: ['M21 16l-4 4-4-4', 'M17 20V4', 'M3 8l4-4 4 4', 'M7 4v16'],
        shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
        chevron: ['M9 6l6 6-6 6'],
        trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14', 'M10 11v6', 'M14 11v6'],
        revert: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
        refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
        download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
        clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 7v5l3 2'],
        check: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M8 12l3 3 5-6'],
        info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 8h.01', 'M11 12h1v4h1'],
        link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
        tag: ['M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
        external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
        plus: ['M12 5v14', 'M5 12h14'],
        pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
        more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
        x: ['M6 6l12 12', 'M18 6 6 18'],
        undo: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
        // la carte Kybernos Cloud (maquette 2026-09-21) : flèche du CTA,
        // clé d'API personnelle, nuage (marque, tracé du plugin kybernos-cloud)
        arrowright: ['M5 12h14', 'M12 5l7 7-7 7'],
        key: ['M15.5 7.5l3 3L22 7l-3-3-3.5 3.5z', 'M12 3a5 5 0 0 0-4.9 6L2.6 13.5a2 2 0 0 0-.6 1.4V19a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1v-1h1a2 2 0 0 0 1.4-.6l.5-.5A5 5 0 0 0 12 3z'],
        cloud: ['M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.2 3.9 3.9 0 0 0 7 18Z'],
      }
      const Ic = (name, size) => {
        const d = ICONS[name]
        if (d === undefined) return null
        const w = size === undefined ? 16 : size
        return h('svg', { width: w, height: w, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false', style: { flex: 'none' } },
          d.map((p, i) => h('path', { d: p, key: i })))
      }

      // ── styles : le même contrat que les autres plugins du dépôt ───────────
      const styles = (() => {
        const tags = new Set()
        return {
          insert(css) {
            if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
            const tag = document.createElement('style')
            tag.dataset.plugin = '@local/kybernos-models'
            tag.textContent = css
            document.head.append(tag)
            tags.add(tag)
            return () => { tags.delete(tag); tag.remove() }
          },
          get count() { return tags.size },
        }
      })()

      // ── DSH-CONTROLS:BEGIN ── (généré par scripts/build-model-catalog-css.mjs) ──
      // @deepseek-ai/dsh-client-ui-primitives@0.1.6-alpha.2 — 21761 caractères, 11 modules.
      const DSH_CONTROLS_CSS = "/* ── Button — les actions (capsule h36 r18, variantes primary/ghost/outline/toolbar) ─────────────────────────────── */\n/* Capsule geometry from the figma Button component (1:155 instances:\n * h36, pad 14/7, gap 4, r18; the wide New Session form is r24 at h38 —\n * owners with the wide form set their own radius/width). */\n.kbm-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  border: none;\n  border-radius: 18px;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  padding: 0 14px;\n}\n\n.kbm-btn:disabled {\n  cursor: not-allowed;\n  opacity: 0.4;\n}\n\n.kbm-btn-md {\n  height: 36px;\n}\n\n/* Compact height for dense rows; no dedicated figma node (Icon_container\n * 28x28 is the icon-only form) — geometry is ours. */\n.kbm-btn-sm {\n  height: 28px;\n  font-size: 12px;\n  line-height: 18px;\n  padding: 0 10px;\n  border-radius: 14px;\n}\n\n.kbm-btn-primary {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n\n.kbm-btn-primary:hover:not(:disabled) {\n  background: var(--dsw-alias-button-primary-hover);\n}\n\n.kbm-btn-ghost:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-ghost:active:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n/* Dialog Cancel (figma 451:18655): bordered capsule on transparent fill. */\n.kbm-btn-outline {\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: transparent;\n}\n\n.kbm-btn-outline:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-toolbar {\n  background: var(--dsw-alias-button-tool-bar-fill);\n}\n\n.kbm-btn-toolbar:hover:not(:disabled) {\n  background: var(--dsw-alias-button-tool-bar-hover);\n}\n\n.kbm-btn-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n}\n\n/* ── Input — le champ de recherche (wrap + icône + input) ─────────────────────────────── */\n.kbm-in-wrap {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 32px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.kbm-in-wrap:focus-within {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.kbm-in-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-in-input {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  outline: none;\n  background: transparent;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-in-input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n/* ── Pill — les puces de filtre sélectionnables ─────────────────────────────── */\n.kbm-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 24px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.kbm-pill-interactive {\n  cursor: pointer;\n}\n\n.kbm-pill-interactive:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-pill-active {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-button-ghost-active-fill);\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border);\n}\n\n/* ── Tag — les étiquettes en lecture seule (8 tons) ─────────────────────────────── */\n/* Capsule geometry is fixed: a tag reads as one size everywhere, and only its\n * palette varies. Tone colors ride background/border/color so a render site can\n * still position the tag with its own class without touching the palette. */\n.kbm-tag {\n  display: inline-flex;\n  align-items: center;\n  border-radius: 999px;\n  corner-shape: round;\n  padding: 1px 8px;\n  font-size: 11px;\n  line-height: 17px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.kbm-tag[data-tone='outline'] {\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-tag[data-tone='solid'] {\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n\n.kbm-tag[data-tone='neutral'] {\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-tag[data-tone='quiet'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Status tones tint their own color for the fill, so a palette change moves\n * fill and text together and neither needs a second token. The tint is 10%,\n * except `warning`, which keeps the 12% the plugin inventory's conditional\n * tag shipped with — matching it is what makes this a pure consolidation. */\n.kbm-tag[data-tone='success'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-tag[data-tone='info'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.kbm-tag[data-tone='warning'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-tag[data-tone='danger'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* ── StateDot — les pastilles d'état (done/warning/error/idle) ─────────────────────────────── */\n/* Ongoing blue has no alias token (state-business-primary is the 500 step,\n * not this 450) — component-level var pinned to the static scale instead. */\n.kbm-dot,\n.kbm-dot-matrix {\n  --dsh-state-ongoing: var(--dsw-static-deepseek-450);\n}\n\n/* Solid states: same-color halo via a 0.10-opacity outer layer (::before)\n * with a 6/10-scale solid core. Layer color rides currentColor set per state. */\n.kbm-dot {\n  position: relative;\n  display: inline-block;\n  flex: none;\n}\n\n.kbm-dot::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n  opacity: 0.1;\n}\n\n.kbm-dot::after {\n  content: '';\n  position: absolute;\n  inset: 20%;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n}\n\n.kbm-dot[data-state='done'] {\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-dot[data-state='warning'] {\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-dot[data-state='error'] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* Idle is the absence of activity, not a fourth outcome: it stays on the\n * tertiary label color so it recedes beside the three outcome colors. */\n.kbm-dot[data-state='idle'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Pixel chase: each outer cell holds a discrete brightness step (flat keyframe\n * holds, no tweening — the retro feel), peaking when the chase hits it and\n * decaying over the next three cells. Phase offsets come from per-rect\n * animation-delay (index * -125ms) set inline by the component. */\n.kbm-dot-matrix {\n  flex: none;\n  color: var(--dsh-state-ongoing);\n}\n\n.kbm-dot-cell {\n  fill: currentColor;\n  opacity: 0.15;\n  animation: kbm-dsh-state-dot-chase 1s infinite;\n}\n\n@keyframes kbm-dsh-state-dot-chase {\n  0%, 12.4% { opacity: 1; }\n  12.5%, 24.9% { opacity: 0.6; }\n  25%, 37.4% { opacity: 0.35; }\n  37.5%, 100% { opacity: 0.15; }\n}\n\n/* ── Switch — les bascules ─────────────────────────────── */\n/* The on/off appearance keys off aria-checked rather than a parallel class, so\n * the visual state cannot disagree with the state assistive technology reads.\n *\n * The track is a capsule: its radius is half its height, so the corners consume\n * the whole side and the global superellipse would square the ends off against\n * the round thumb inside it. `corner-shape: round` opts the track out, the way\n * every full-round radius does. The corner-shape spec does not catch this one —\n * it recognizes 50%, 100%, and radii at or above 99px, not a radius that is\n * full-round only relative to its own box. */\n.kbm-sw {\n  box-sizing: border-box;\n  position: relative;\n  flex: 0 0 auto;\n  width: 36px;\n  height: 20px;\n  padding: 2px;\n  border: 0;\n  border-radius: 10px;\n  corner-shape: round;\n  background: var(--dsw-alias-border-l3);\n  cursor: pointer;\n}\n\n.kbm-sw[aria-checked='true'] {\n  background: var(--dsw-alias-brand-primary);\n}\n\n.kbm-sw:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.kbm-sw:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-sw-thumb {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  corner-shape: round;\n  background: var(--dsw-alias-label-primary-foreground);\n  transition: transform 120ms ease;\n}\n\n.kbm-sw[aria-checked='true'] .kbm-sw-thumb {\n  transform: translateX(16px);\n}\n\n/* ── Checkbox — les cases à cocher ─────────────────────────────── */\n.kbm-ck {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 14px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.kbm-ck input {\n  flex: 0 0 auto;\n  width: 16px;\n  height: 16px;\n  margin: 0;\n  accent-color: var(--dsw-alias-brand-primary);\n  cursor: inherit;\n}\n\n.kbm-ck input:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-ck:has(input:disabled) {\n  cursor: default;\n  opacity: 0.5;\n}\n\n/* ── Menu — les menus déroulants (routes, tri) ─────────────────────────────── */\n.kbm-menu-root {\n  position: relative;\n  display: inline-flex;\n}\n\n/* Dropdown card (figma MenuDropdown 122:9481 / 419:16920): menu surface,\n * r12, elevation-prominent (hairline stroke in shadow), 4px inset padding. */\n.kbm-menu-list,\n.kbm-menu-submenu {\n  /* min-widths below are the design's outer card widths — include the pad. */\n  box-sizing: border-box;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n  border: 0;\n  border-radius: 20px;\n  background: var(--dsw-specific-menu);\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  box-shadow: var(--dsw-elevation-prominent);\n  /* Elevated surface: the scrollbar thumb takes the l2 elevation tokens. The\n     declaration sits on the card rather than on `.scrollable .viewport`\n     because the elevation is a property of this surface, and the custom\n     properties inherit down to whichever descendant actually scrolls (see\n     ui-theme styles/scrollbar.css for the rebinding contract). */\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n/* Primary card is 218 wide in the design across both hosts. */\n.kbm-menu-list {\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n  z-index: 100;\n  min-width: 218px;\n  max-width: 360px;\n}\n\n/* Portal mode: fixed in the viewport, coordinates supplied inline from the\n * anchor rect (side/align resolved in JS, the in-place offset rules above\n * don't apply). Portaled lists must layer above modal overlays (z 1000) —\n * an anchor inside a dialog still expects its menu on top. */\n.kbm-menu-portal {\n  position: fixed;\n  top: auto;\n  left: auto;\n  z-index: 1100;\n}\n\n/* Open above the anchor (empty-state workspace chip: figma 122:9481). */\n.kbm-menu-sideTop {\n  top: auto;\n  bottom: calc(100% + 4px);\n}\n\n.kbm-menu-alignEnd {\n  left: auto;\n  right: 0;\n}\n\n/* Viewport fit: the card stops 12px short of the viewport's top/bottom edges\n * (24 = 2 × the portal MARGIN in Menu.tsx) and taller content scrolls inside\n * .viewport, so a pinned .footer stays visible. Menus with submenu rows skip\n * this class — the overflow clip would crop the side card, so they rely on\n * staying short. */\n.kbm-menu-scrollable {\n  max-height: calc(100vh - 24px);\n}\n\n.kbm-menu-viewport {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n}\n\n.kbm-menu-scrollable .kbm-menu-viewport {\n  overflow-y: auto;\n}\n\n/* Pinned rows below the scroll region; l2 hairline (l1 is near-invisible on\n * the menu surface) mirrors the .separator spacing. */\n.kbm-menu-footer {\n  flex: none;\n  display: flex;\n  flex-direction: column;\n  margin-top: 4px;\n  padding-top: 4px;\n  border-top: 0.5px solid var(--dsw-alias-border-l2);\n}\n\n.kbm-menu-itemWrap {\n  position: relative;\n}\n\n/* Menu cell (figma .Menu_cell): min-h 40, r10, pad 10/8, 14/22 primary,\n * gap 8 between leading icon / label / trailing check. */\n.kbm-menu-item {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 40px;\n  padding: 8px 10px;\n  border: none;\n  border-radius: 10px;\n  background: transparent;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  text-align: left;\n}\n\n.kbm-menu-item:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Arrow navigation moves real focus, so the row the keyboard is on carries the\n   same fill the pointer gets: the fill is the row's focus indication, and the\n   browser's default ring would double it. */\n.kbm-menu-item:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: none;\n}\n\n.kbm-menu-denseList .kbm-menu-item {\n  min-height: 34px;\n  padding-block: 5px;\n}\n\n.kbm-menu-denseList .kbm-menu-label {\n  padding-block: 4px;\n}\n\n.kbm-menu-list.kbm-menu-compactList,\n.kbm-menu-submenu.kbm-menu-compactList {\n  min-width: 164px;\n  padding: 2px;\n  border-radius: 7px;\n}\n\n.kbm-menu-compactList .kbm-menu-item {\n  min-height: 26px;\n  gap: 6px;\n  padding: 3px 7px;\n  border-radius: 5px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.kbm-menu-compactList .kbm-menu-itemIcon {\n  width: 14px;\n  height: 14px;\n}\n\n.kbm-menu-compactList .kbm-menu-separator {\n  margin: 2px;\n}\n\n.kbm-menu-compactList .kbm-menu-label {\n  padding: 4px 7px;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.kbm-menu-item:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.kbm-menu-itemIcon {\n  display: inline-flex;\n  flex: none;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-menu-itemLabel {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.kbm-menu-check {\n  flex: none;\n  color: var(--dsw-alias-label-primary);\n}\n\n/* Selected cell keeps the plain fill (marker is the trailing check); the\n * class remains as a hook for owner-side emphasis. */\n.kbm-menu-selected {\n  background: transparent;\n}\n\n/* Fill-mode selection: the row holds the hover fill instead of a check. */\n.kbm-menu-selectedFill {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Destructive row: error text/icon, danger hover fill. */\n.kbm-menu-danger {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger .kbm-menu-itemIcon {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n}\n\n.kbm-menu-danger:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  outline: none;\n}\n\n/* Heading row: non-interactive small grey text, padding aligned with items. */\n.kbm-menu-label {\n  padding: 8px 10px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Separator cell (figma 122:9481): py 4 / px 2 around the hairline. */\n.kbm-menu-separator {\n  height: 0.5px;\n  margin: 4px 2px;\n  background: var(--dsw-alias-border-l1);\n}\n\n/* Nested card to the right of the parent row (figma 419:16920).\n * Bottom-aligned with the parent menu card (grows upward): itemWrap sits in\n * .list's 4px pad, so bottom: -4px matches the list's outer bottom edge.\n * Horizontal: list pad (4px) + 6px card gap = 10px past itemWrap — plain\n * `100% + 6px` collapses to ~2px between outer card edges.\n * ::before bridges the full gap so the pointer can cross without mouseLeave. */\n.kbm-menu-submenu {\n  position: absolute;\n  top: auto;\n  bottom: -4px;\n  left: calc(100% + 10px);\n  z-index: 101;\n  min-width: 163px;\n}\n\n.kbm-menu-submenu::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  left: -10px;\n  width: 10px;\n}\n\n/* ── Modal — la surface de détail ─────────────────────────────── */\n/* Full-viewport layer (figma Mask + Dialog 451:18655): mask + centered card. */\n.kbm-mdl-root {\n  position: fixed;\n  inset: 0;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 24px;\n}\n\n/* User/spec mask: rgba(0,0,0,0.24) + blur(2px) via --dsw-alias-bg-mask-1 /\n   --dsw-mask-blur (light); dark theme raises mask opacity. */\n.kbm-mdl-mask {\n  position: absolute;\n  inset: 0;\n  background: var(--dsw-alias-bg-mask-1);\n  backdrop-filter: var(--dsw-mask-blur);\n}\n\n/* Dialog card: r24, elevation-prominent, layer-2 fill, pb 24. */\n.kbm-mdl-dialog {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  width: min(380px, 100%);\n  padding: 0 0 24px;\n  overflow: hidden;\n  border: 0;\n  border-radius: 24px;\n  background: var(--dsw-alias-bg-layer-2);\n  box-shadow: var(--dsw-elevation-prominent);\n}\n\n.kbm-mdl-content {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n}\n\n/* Header row (figma Title row): pad l24/t22/r14/b12, SPACE_BETWEEN —\n * title left, close button right. */\n.kbm-mdl-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 22px 14px 12px 24px;\n}\n\n.kbm-mdl-title {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500; /* figma wt510, rendered 500 */\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-close {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-mdl-close:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Description and body share the 332px content column (24px side pads). */\n.kbm-mdl-description {\n  margin: 0;\n  padding: 0 24px;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 400;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-body {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  margin-top: 20px;\n  padding: 0 24px;\n}\n\n.kbm-mdl-footer {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 0 24px;\n}\n\n/* ── Tooltip — les bulles d'aide ─────────────────────────────── */\n.kbm-tip-bubble {\n  position: fixed;\n  z-index: 100;\n  /* Fixed-position shrink-to-fit measures only the space from `left` to the\n     viewport edge, so anchors near the right edge would wrap early;\n     max-content sizes by the label alone, capped at half the viewport. */\n  width: max-content;\n  max-width: 50vw;\n  padding: 3px 7px;\n  border-radius: 8px;\n  background: var(--dsw-alias-tooltip-bg);\n  color: var(--dsw-static-neutral-bluish-00);\n  font-size: 13px;\n  line-height: 20px;\n  white-space: pre-line;\n  /* Unbreakable tokens (URLs, paths) must not push past max-width. */\n  overflow-wrap: break-word;\n  pointer-events: none;\n  animation: kbm-tooltip-in 150ms var(--ds-ease-in-out);\n}\n\n.kbm-tip-bubble[data-side='right'] {\n  transform: translateY(-50%);\n}\n\n.kbm-tip-bubble[data-side='bottom'] {\n  transform: translateX(-50%);\n}\n\n.kbm-tip-bubble[data-side='top'] {\n  transform: translate(-50%, -100%);\n}\n\n@keyframes kbm-tooltip-in {\n  from { opacity: 0; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .kbm-tip-bubble {\n    animation: none;\n  }\n}\n\n/* ── DisclosureRow — la ligne dépliable (titre + contenu côte à côte) ─────────────────────────────── */\n/* Shared disclosure header: [16px leading] gap 6 [title 13/24] at the default\n   size. The Settings font-size preference moves the row through the\n   body-published axis: title size follows the secondary tier\n   (--dsh-content-font-size-secondary: one step under the body — setting −1 at\n   ≤14, setting −2 above), and the row height, leading box, and glyph edge\n   shift by the body px delta so the icon keeps its optical share of the\n   line. */\n\n.kbm-dr-root {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n}\n\n.kbm-dr-row {\n  position: relative;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  height: calc(24px + var(--dsh-content-font-delta, 0px));\n  min-width: 0;\n}\n\n.kbm-dr-row[data-expandable] {\n  cursor: pointer;\n}\n\n.kbm-dr-leading {\n  position: relative;\n  flex: none;\n  width: calc(16px + var(--dsh-content-font-delta, 0px));\n  height: calc(16px + var(--dsh-content-font-delta, 0px));\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  margin-right: 6px;\n  padding: 0;\n  border: none;\n  background: none;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Flow-row glyphs render at 14px inside the 16px box; the CSS edge overrides\n   each svg's own width/height attributes so every registered icon scales\n   without a per-callsite size prop. StateDot (its svg carries data-state)\n   stays at its fixed figma size — it is a status mark, not text furniture. */\n.kbm-dr-leading svg:not([data-state]) {\n  width: calc(14px + var(--dsh-content-font-delta, 0px));\n  height: calc(14px + var(--dsh-content-font-delta, 0px));\n}\n\nbutton.kbm-dr-leading {\n  cursor: pointer;\n}\n\n.kbm-dr-iconIdle {\n  display: inline-flex;\n  opacity: 1;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-chevronHover {\n  position: absolute;\n  inset: 0;\n  margin: auto;\n  opacity: 0;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-row:hover .kbm-dr-iconIdle {\n  opacity: 0;\n}\n\n.kbm-dr-row:hover .kbm-dr-chevronHover {\n  opacity: 1;\n}\n\n.kbm-dr-title {\n  flex: none;\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: calc(24px + var(--dsh-content-font-delta, 0px));\n  color: var(--dsw-alias-label-secondary);\n}"
      // ── DSH-CONTROLS:END ──

      // ── le catalogue : définition des champs de la maquette ───────────────
      // `wire` nomme le champ `llm-pi-ai` que ce contrôle écrit RÉELLEMENT —
      // absent = annotation Kybernos. C'est la seule table qui décide du badge.
      //
      // Rien d'inventé : le seul `compat` de la maquette qui ait un équivalent
      // réel est le raisonnement (`reasoningEfforts`) ; S2S, Search et Structured
      // output n'ont AUCUN champ correspondant côté harnais (les ~20 commutateurs
      // `compat` parlent de format de raisonnement, de rôle developer, de champ
      // maxTokens, de template de chat — pas de ces capacités-là). Les marquer
      // « appliqué » serait un mensonge : ils restent des annotations.
      const CAPS = [
        { k: 'textIn', t: 'kb.models.f.textIn', icon: 'type', tint: '#6366f1', sec: 'input', wire: 'input.text' },
        { k: 'vision', t: 'kb.models.f.vision', icon: 'eye', tint: '#10b981', sec: 'input', wire: 'input.image' },
        { k: 'video', t: 'kb.models.f.video', icon: 'video', tint: '#ef4444', sec: 'input' },
        { k: 'audioIn', t: 'kb.models.f.audioIn', icon: 'mic', tint: '#f59e0b', sec: 'input' },
        { k: 'textOut', t: 'kb.models.f.textOut', icon: 'type', tint: '#8b5cf6', sec: 'output' },
        { k: 'tts', t: 'kb.models.f.tts', icon: 'volume', tint: '#3b82f6', sec: 'output' },
        { k: 'imageGen', t: 'kb.models.f.imageGen', icon: 'image', tint: '#ec4899', sec: 'output' },
        { k: 'videoGen', t: 'kb.models.f.videoGen', icon: 'film', tint: '#ef4444', sec: 'output' },
        { k: 'tools', t: 'kb.models.f.tools', icon: 'wrench', tint: '#f97316', sec: 'caps' },
        { k: 'search', t: 'kb.models.f.search', icon: 'globe', tint: '#14b8a6', sec: 'caps' },
        { k: 's2s', t: 'kb.models.f.s2s', icon: 'headphones', tint: '#ec4899', sec: 'caps' },
        { k: 'reasoning', t: 'kb.models.f.reasoning', icon: 'bulb', tint: '#eab308', sec: 'caps', wire: 'reasoningEfforts' },
        { k: 'structured', t: 'kb.models.f.structured', icon: 'braces', tint: '#8b5cf6', sec: 'caps' },
        { k: 'temperature', t: 'kb.models.f.temperature', icon: 'thermometer', tint: '#ef4444', sec: 'caps' },
      ]
      const TYPES = [
        { id: 'chat', t: 'kb.models.t.chat', icon: 'chat', tint: '#6366f1' },
        { id: 'embedding', t: 'kb.models.t.embedding', icon: 'layers', tint: '#10b981' },
        { id: 'image', t: 'kb.models.t.image', icon: 'image', tint: '#3b82f6' },
        { id: 'video', t: 'kb.models.t.video', icon: 'film', tint: '#ef4444' },
        { id: 'audio', t: 'kb.models.t.audio', icon: 'bars', tint: '#f59e0b' },
        { id: 'realtime', t: 'kb.models.t.realtime', icon: 'headphones', tint: '#ec4899' },
        { id: 'rerank', t: 'kb.models.t.rerank', icon: 'rerank', tint: '#14b8a6' },
        { id: 'moderation', t: 'kb.models.t.moderation', icon: 'shield', tint: '#f97316' },
      ]
      const LIMITS = [
        { k: 'context', t: 'kb.models.f.context', pretty: true, wire: 'contextWindow' },
        { k: 'inputLimit', t: 'kb.models.f.inputLimit', pretty: true },
        { k: 'outputLimit', t: 'kb.models.f.outputLimit', pretty: true, wire: 'maxTokens' },
      ]
      const PRICING = [
        { k: 'costIn', t: 'kb.models.f.costIn', unit: 'kb.models.usd' },
        { k: 'costOut', t: 'kb.models.f.costOut', unit: 'kb.models.usd' },
        { k: 'cacheRead', t: 'kb.models.f.cacheRead', unit: 'kb.models.usd' },
        { k: 'cacheWrite', t: 'kb.models.f.cacheWrite', unit: 'kb.models.usd' },
      ]
      const META = [
        { k: 'family', t: 'kb.models.f.family' },
        { k: 'knowledge', t: 'kb.models.f.knowledge', ph: 'YYYY-MM' },
        { k: 'release', t: 'kb.models.f.release', ph: 'YYYY-MM-DD' },
        { k: 'weights', t: 'kb.models.f.weights', select: true },
      ]

      // ── couche 1 : ce que le harnais sait sans rien consulter ─────────────
      const BASE = {
        textIn: true, vision: false, video: false, audioIn: false, textOut: true, tts: false,
        imageGen: false, videoGen: false, tools: false, search: false, s2s: false,
        reasoning: false, structured: false, temperature: false, type: '',
        context: '', inputLimit: '', outputLimit: '',
        costIn: '', costOut: '', cacheRead: '', cacheWrite: '',
        family: '', knowledge: '', release: '', weights: '',
      }
      // ── couche 2 : ce qu'une réponse models.dev pose (échantillon figé) ────
      const REMOTE = {
        textIn: true, vision: false, video: false, audioIn: false, textOut: true, tts: false,
        imageGen: false, videoGen: false, tools: true, s2s: false,
        reasoning: true, structured: true, temperature: true, type: 'chat',
        context: '131072', outputLimit: '32768',
        costIn: '0.15', costOut: '0.75',
        family: 'gpt-oss', knowledge: '2024-06', release: '2025-08-05', weights: 'Open',
      }
      const REMOTE_LLAMA8 = {
        textIn: true, vision: false, out: true, textOut: true, tools: true, structured: true,
        temperature: true, reasoning: false, type: 'chat',
        context: '131072', outputLimit: '8192', costIn: '0.05', costOut: '0.08',
        family: 'llama', knowledge: '2023-12', release: '2024-07-23', weights: 'Open',
      }
      const REMOTE_LLAMA70 = {
        textIn: true, textOut: true, tools: true, structured: true, temperature: true, reasoning: false,
        type: 'chat', context: '131072', outputLimit: '32768', costIn: '0.59', costOut: '0.79',
        family: 'llama', knowledge: '2023-12', release: '2024-12-06', weights: 'Open',
      }

      // ── l'état : un seul store, abonné par le React local ─────────────────
      // `live` est LA bascule : faux = jeu figé et aucune écriture (phase sans
      // câblage), vrai = remotes + settings.yaml (phase câblée).
      // `live` = le panneau lit settings.yaml et écrit par les canaux réels.
      // Le mode figé reste accessible (`?kybernos-models=sample`) : c'est ce que
      // vérifie la preuve de l'étape 1, et ça n'écrit jamais rien.
      const kbMSampleMode = () => {
        try { return /[?&]kybernos-models=sample/.test(String(window.location.search)) } catch (e) { return false }
      }
      const KBM = {
        live: kbMSampleMode() !== true,
        loading: false,
        writable: null,
        revision: null,
        routes: [],
        annotations: {},
        written: null,
        contract: null,
        hostVersion: null,
        loadError: null,
        confirmRestore: false,
        restoredNote: null,
        models: [],
        // Parked ("disabled") providers, from the host store; `parkHost` is false
        // while the host half has not been restarted: no switch is shown then.
        parked: [],
        parkHost: false,
        keys: {},
        dir: {},
        hasDeepseek: false,
        userProviders: {},
        baseProviders: {},
        // Les notes externes : l'instant global (pour dire la fraîcheur) et
        // l'état du relevé de fond (pour n'en déclencher qu'un à la fois).
        scoresAt: null,
        scoresRunning: false,
        scoresAskedAt: null,
        listeners: new Set(),
        seq: 0,
      }
      const kbmNotify = () => { for (const fn of Array.from(KBM.listeners)) { try { fn() } catch (e) { /* abonne parti */ } } }
      const kbmUse = () => {
        const pair = React.useState(0)
        const bump = pair[1]
        React.useEffect(() => {
          const fn = () => bump((n) => n + 1)
          KBM.listeners.add(fn)
          return () => { KBM.listeners.delete(fn) }
        }, [])
        return pair[0]
      }
      const kbmModel = (key) => {
        for (const mo of KBM.models) if (mo.key === key) return mo
        return null
      }
      const kbmHas = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
      const kbmUnder = (mo, k) => {
        if (kbmHas(mo.baseCtl, k)) return mo.baseCtl[k]
        // Décision du 2025-09-20 : la valeur de models.dev s'affiche DÈS qu'on
        // a la fiche, même si la synchronisation n'est pas encore confirmée —
        // `kbmPending` la marque « renseignée, pas encore appliquée ».
        if (mo.remote[k] !== undefined) return mo.remote[k]
        return KBM.live === true ? '' : BASE[k]
      }
      /** Renseigné par models.dev, pas encore confirmé par la synchronisation. */
      const kbmPending = (mo, k) => kbmIsOv(mo, k) !== true && mo.synced !== true && mo.remote[k] !== undefined
      const kbmVal = (mo, k) => (kbmHas(mo.ov, k) ? mo.ov[k] : kbmUnder(mo, k))
      const kbmIsOv = (mo, k) => kbmHas(mo.ov, k)
      const kbmIsSync = (mo, k) => kbmIsOv(mo, k) !== true && mo.synced === true && mo.remote[k] !== undefined
      const kbmCountOv = (mo) => Object.keys(mo.ov).length
      /** Un contrôle appliqué au harnais, ou une simple annotation Kybernos. */
      const kbmWireOf = (k) => {
        // Le nom affiché est un champ appliqué, même s'il vit dans la ligne du
        // modèle et non dans une section (`llm-pi-ai` → `modelOverrides.<id>.name`).
        if (k === 'name') return 'name'
        for (const c of CAPS) if (c.k === k && c.wire !== undefined) return c.wire
        for (const f of LIMITS) if (f.k === k && f.wire !== undefined) return f.wire
        return null
      }
      const kbmIsWired = (k) => kbmWireOf(k) !== null
      /** Le partage annoncé dans le pied du panneau — calculé, jamais écrit.
       *  Six champs RÉELS (name, input texte, input image, reasoningEfforts,
       *  contextWindow, maxTokens) ; tous les autres contrôles de la maquette
       *  sont des annotations locales. */
      const kbmCounts = () => {
        let note = 0
        const bump = (k) => { if (kbmIsWired(k) !== true) note += 1 }
        for (const c of CAPS) bump(c.k)
        bump('type')
        for (const f of LIMITS) bump(f.k)
        for (const f of PRICING) bump(f.k)
        for (const f of META) bump(f.k)
        return { wired: 6, note }
      }

      // ── écritures : la valeur part en mémoire, puis par le canal réel ─────
      // Phase sans câblage : rien ne sort de la page. Phase câblée : les champs
      // `wire` passent par `remote.settings.mutate` (settings.yaml, validé par
      // le service), les autres par le fichier d'annotations du plugin.
      const kbmSave = (mo, k, v) => {
        if (KBM.live !== true) return true
        // Optimiste : l'écran suit le geste, le canal réel (settings.yaml ou
        // fichier d'annotations) répond ensuite ; un refus atterrit dans
        // `mo.error` et reste affiché sur la ligne.
        Promise.resolve(kbMPersist(mo, k, v)).catch(() => { /* kbMPersist ne rejette pas */ })
        return true
      }
      const kbmSet = (mo, k, v) => {
        const next = Object.assign({}, mo.ov)
        if (v === kbmUnder(mo, k)) delete next[k]
        else next[k] = v
        mo.ov = next
        if (kbmSave(mo, k, v) !== true) { mo.error = m('kb.models.error'); kbmNotify(); return false }
        mo.error = null
        kbmNotify()
        return true
      }
      const kbmRevert = (mo, k) => {
        const next = Object.assign({}, mo.ov)
        delete next[k]
        mo.ov = next
        kbmSave(mo, k, null)
        kbmNotify()
      }
      const kbmClear = (mo) => {
        for (const k of Object.keys(mo.ov)) kbmSave(mo, k, null)
        mo.ov = {}
        kbmNotify()
      }
      // « Restore defaults » = effacer TOUTES les surcharges, pas les valeurs
      // models.dev : c'est exactement `clearOverrides` de la maquette, et ça
      // laisse le catalogue prérempli intact (on ne relance pas la synchro).
      // En mode réel c'est une écriture LARGE (toutes les surcharges de tous les
      // modèles) : deux clics, et le nombre de surcharges retirées est affiché.
      const kbmRestoreAll = () => {
        if (KBM.live === true && KBM.confirmRestore !== true) {
          KBM.confirmRestore = true
          kbmNotify()
          setTimeout(() => { KBM.confirmRestore = false; kbmNotify() }, 8000)
          return
        }
        KBM.confirmRestore = false
        let n = 0
        for (const mo of KBM.models) {
          n += Object.keys(mo.ov).length
          kbmClear(mo)
        }
        KBM.restoredNote = KBM.live === true ? String(n) : null
        kbmNotify()
      }
      const kbmOpen = (key) => {
        const mo = kbmModel(key)
        if (mo === null) return
        mo.open = mo.open !== true
        kbmNotify()
        // Ouvrir la fiche, c'est demander ce qu'elle montrera : les notes
        // arrivent après le rendu, jamais avant (aucun écran n'attend le réseau).
        if (mo.open === true && mo.scores === undefined && KBM.live === true) {
          kbMScoresLoad(mo, false).catch(() => { /* notes best-effort */ })
        }
      }
      const kbmRename = (mo, value) => {
        mo.name = value
        // Le nom affiché EST un champ appliqué (`name`) : il suit le même canal.
        if (mo.live === true || KBM.live === true) kbmSet(mo, 'name', value)
        kbmNotify()
      }
      const kbmAdd = () => {
        KBM.seq += 1
        const key = 'nouveau-' + String(KBM.seq)
        const route = KBM.routes.length > 0 ? KBM.routes[0] : ''
        KBM.models.push(kbmMakeModel({ route, kind: 'local', index: -1, id: '', name: '', open: true, synced: false, remote: {}, ov: {} }, key))
        kbmNotify()
      }
      const kbmRemove = (key) => {
        const mo = kbmModel(key)
        if (mo === null) return
        if (KBM.live !== true || mo.kind === 'local') {
          KBM.models = KBM.models.filter((x) => x.key !== key)
          kbmNotify()
          return
        }
        // En mode réel, un modèle DÉCLARÉ ne disparaît pas d'ici : settings.yaml
        // le sert. La corbeille efface donc ses annotations locales et le DIT —
        // une ligne qui revient après rechargement serait un mensonge.
        const k2 = kbMKey(mo)
        if (k2 === null) return
        Promise.resolve(kbMAnnotations(k2, null)).then(() => {
          const next = {}
          for (const k of Object.keys(mo.ov)) if (kbmIsWired(k) === true) next[k] = mo.ov[k]
          mo.ov = next
          mo.error = m('kb.models.remove.note')
          kbmNotify()
        }).catch((e) => {
          mo.error = m('kb.models.error.reseau') + ' : ' + String(e && e.message ? e.message : e)
          kbmNotify()
        })
      }
      /** Synchronisation : en figé on rejoue l'échantillon ; en réel on lit
       *  l'index models.dev du host (une requête, réponses mises en cache). */
      const kbmSync = (key) => {
        const mo = kbmModel(key)
        if (mo === null || mo.loading === true) return
        if (KBM.live !== true) {
          mo.loading = true
          kbmNotify()
          setTimeout(() => {
            const current = kbmModel(key)
            if (current === null) return
            current.loading = false
            current.synced = true
            current.remote = Object.assign({}, REMOTE, current.remoteSeed || {})
            kbmNotify()
          }, 1100)
          return
        }
        // La synchronisation d'une ligne déclenche AUSSI le relevé des deux
        // catalogues de notes — en arrière-plan, une seule fois pour toutes les
        // lignes — puis relit les notes de ce modèle.
        kbMScoresRefresh(false)
        Promise.resolve(kbMSyncLive(mo)).then(() => kbMScoresLoad(mo, false)).catch(() => { /* notes best-effort */ })
      }
      const kbmSyncAll = () => { kbMSyncAll() }

      const kbmMakeModel = (src, key) => ({
        key: key,
        route: src.route, id: src.id, name: src.name,
        kind: src.kind === undefined ? 'sample' : src.kind,
        index: src.index === undefined ? -1 : src.index,
        raw: Object.assign({}, src.raw || {}),
        defaultInput: Array.isArray(src.defaultInput) ? src.defaultInput.slice() : null,
        userModels: Array.isArray(src.userModels) ? src.userModels : null,
        baseCtl: Object.assign({}, src.baseCtl || {}),
        open: src.open === true, synced: src.synced === true, loading: false,
        remote: Object.assign({}, src.remote || {}), remoteSeed: src.remoteSeed || null, ov: Object.assign({}, src.ov || {}),
        error: null,
      })

      // ── phase sans câblage : le jeu figé de la maquette ───────────────────
      const SAMPLE = [
        { route: 'groq', id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', open: false, synced: true, remote: Object.assign({}, BASE, REMOTE_LLAMA8), ov: {} },
        { route: 'groq', id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', open: false, synced: true, remote: Object.assign({}, BASE, REMOTE_LLAMA70), ov: {} },
        { route: 'openai', id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', open: true, synced: true, remote: Object.assign({}, BASE, REMOTE), ov: { search: true, context: '65536' } },
        { route: 'openai', id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B', open: false, synced: false, remote: {}, ov: {} },
      ]
      // Le jeu figé n'existe QU'HORS mode réel : en mode réel le panneau part
      // vide, lit settings.yaml, et n'invente jamais une ligne.
      if (KBM.live !== true) KBM.models = SAMPLE.map((s, i) => kbmMakeModel(s, 'ech-' + String(i + 1)))

      // ── rendu : les briques de la maquette ───────────────────────────────
      const pretty = (v) => {
        const n = Number(v)
        if (v === '' || v === null || v === undefined || isFinite(n) !== true || n === 0) return ''
        const court = (x) => String(Math.round(x * 10) / 10)
        if (n >= 1048576 && n % 1048576 === 0) return String(n / 1048576) + 'M'
        if (n >= 1024 && n % 1024 === 0) return String(n / 1024) + 'K'
        // Les routes déclarent aussi des fenêtres rondes (1000000, 200000) :
        // la maquette les écrit 1M / 200K.
        if (n >= 1000000) return court(n / 1000000) + 'M'
        if (n >= 1000) return court(n / 1000) + 'K'
        return String(n)
      }
      const Dot = (props) => h('span', { className: 'kbm-dot ' + (props.src === 'ov' ? 'ov' : 'sync'), title: m(props.src === 'ov' ? 'kb.models.ov.src' : 'kb.models.sync.src') })
      /** Marqueur « appliqué au harnais » ou « annotation Kybernos ». */
      const Mark = (props) => h('span', {
        className: 'kbm-mark' + (props.wire === true ? ' wire' : ''),
        title: m(props.wire === true ? 'kb.models.mark.wire' : 'kb.models.mark.note'),
        'data-kbm': props.wire === true ? 'mark-wire' : 'mark-note',
      }, Ic(props.wire === true ? 'link' : 'tag', 12))

      /** L'infobulle du kit : un ancre (children) + une bulle `kbm-tip-bubble`
       *  révélée au survol et au focus clavier. Le `title` natif attend une
       *  seconde et se perd dans la GUI ; la bulle du kit est immédiate,
       *  stylée comme le reste, et lisible dans les captures de contrôle. */
      const Tip = (props) => h('span', { className: 'kbm-tipwrap' },
        props.children,
        props.text != null && props.text !== ''
          ? h('span', { className: 'kbm-tip kbm-tip-bubble', role: 'tooltip' }, props.text)
          : null)

      const Chip = (props) => {
        const mo = props.mo
        const def = props.def
        const on = kbmVal(mo, def.k) === true
        const ov = kbmIsOv(mo, def.k)
        const sy = kbmIsSync(mo, def.k)
        // Icône seule + infobulle du kit : la fiche gagne la largeur du libellé
        // sur chaque puce (14 capacités + 8 types), le libellé complet vit
        // dans la bulle et l'aria-label — même contrat que les icônes des
        // rangées. (Le `title` natif attend ~1 s et se perd dans la GUI.)
        const src = ov === true ? m('kb.models.ov.src') : (sy === true ? m('kb.models.sync.src') : null)
        const tip = m(def.t) + ' — ' + (src !== null
          ? src
          : (def.wire === undefined ? m('kb.models.mark.note') : m('kb.models.mark.wire')))
        return h(Tip, { text: tip },
          h('button', {
            type: 'button', role: 'switch', 'aria-checked': on === true,
            className: 'kbm-chip' + (on === true ? ' on' : ''),
            'aria-label': tip,
            'data-kbm': 'chip-' + def.k,
            onClick: () => kbmSet(mo, def.k, on !== true),
          },
          h('span', { className: 'kbm-ico', style: (on === true || def.tint === undefined) ? undefined : { color: def.tint } }, Ic(def.icon, 16)),
          (ov === true || sy === true) ? h(Dot, { src: ov === true ? 'ov' : 'sync', key: 'dot' }) : null))
      }

      const TypeChip = (props) => {
        const mo = props.mo
        const def = props.def
        const on = String(kbmVal(mo, 'type')) === def.id
        const ov = kbmIsOv(mo, 'type')
        const sy = kbmIsSync(mo, 'type')
        const src = ov === true ? m('kb.models.ov.src') : (sy === true ? m('kb.models.sync.src') : null)
        const tip = m(def.t) + (on === true && src !== null ? ' — ' + src : '')
        return h(Tip, { text: tip },
          h('button', {
            type: 'button', 'aria-pressed': on,
            className: 'kbm-chip kbm-type' + (on === true ? ' on' : ''), 'data-kbm': 'type-' + def.id,
            'aria-label': tip,
            onClick: () => kbmSet(mo, 'type', def.id),
          },
          h('span', { className: 'kbm-ico', style: (on === true || def.tint === undefined) ? undefined : { color: def.tint } }, Ic(def.icon, 16)),
          (on === true && (ov === true || sy === true)) ? h(Dot, { src: ov === true ? 'ov' : 'sync', key: 'dot' }) : null))
      }

      /** En mode réel, un champ texte garde sa frappe en local et n'écrit
       *  settings.yaml qu'au blur (ou Entrée) : pas une écriture par caractère,
       *  pas d'état intermédiaire invalide dans le fichier. */
      const useDraft = (value, commit) => {
        const pair = React.useState(null)
        const draft = pair[0]
        const setDraft = pair[1]
        if (KBM.live !== true) return { value: value, onChange: (e) => commit(e.target.value) }
        return {
          value: draft === null ? value : draft,
          onChange: (e) => setDraft(e.target.value),
          onBlur: () => {
            if (draft === null) return
            setDraft(null)
            if (draft !== value) commit(draft)
          },
          onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() },
        }
      }

      const Field = (props) => {
        const mo = props.mo
        const def = props.def
        const raw = kbmVal(mo, def.k)
        const value = raw === null || raw === undefined ? '' : String(raw)
        const ov = kbmIsOv(mo, def.k)
        const sy = kbmIsSync(mo, def.k)
        const under = kbmUnder(mo, def.k)
        const underText = under === null || under === undefined ? '' : String(under)
        // Au niveau réel, « effacer » veut dire RETIRER la clé de settings.yaml :
        // l'étiquette le dit, parce que la valeur disparue peut être celle de
        // l'utilisateur (le harnais reprend alors le catalogue).
        const revertLabel = underText === ''
          ? (KBM.live === true ? m('kb.models.clearfield.live') : m('kb.models.clearfield'))
          : m('kb.models.revert', { v: underText })
        const suffix = def.pretty === true ? pretty(value) : (def.unit === undefined ? '' : m(def.unit))
        const inputId = 'kbm-f-' + mo.key + '-' + def.k
        return h('div', { className: 'kbm-field' },
          h('div', { className: 'kbm-fieldhead' },
            h('div', { className: 'kbm-flabel' },
              h('label', { htmlFor: inputId }, m(def.t)),
              sy === true ? h(Dot, { src: 'sync' }) : (ov === true ? h(Dot, { src: 'ov' }) : null),
              h(Mark, { wire: def.wire !== undefined })),
            ov === true ? h('button', {
              type: 'button', className: 'kbm-revert', title: revertLabel, 'aria-label': revertLabel,
              'data-kbm': 'revert-' + def.k, onClick: () => kbmRevert(mo, def.k),
            }, Ic('revert', 13)) : null),
          h('div', { className: 'kbm-fbody' },
            def.select === true
              ? h('select', {
                id: inputId, className: 'kbm-finput' + (ov === true ? ' ov' : ''), value: value,
                'data-kbm': 'field-' + def.k,
                onChange: (e) => kbmSet(mo, def.k, e.target.value),
              },
              h('option', { value: '' }, m('kb.models.w.unknown')),
              h('option', { value: 'Open' }, m('kb.models.w.open')),
              h('option', { value: 'Closed' }, m('kb.models.w.closed')))
              : h('input', Object.assign({
                id: inputId, className: 'kbm-finput' + (ov === true ? ' ov' : ''), value: value,
                placeholder: def.ph === undefined ? '—' : def.ph, 'data-kbm': 'field-' + def.k,
              }, useDraft(value, (v) => kbmSet(mo, def.k, v)))),
            suffix === '' ? null : h('span', { className: 'kbm-suffix' }, suffix)))
      }

      // ── notes externes : ce que les deux catalogues disent de CE modèle ────
      // Rendu en LECTURE SEULE. Rien ici n'est un champ du harnais ni une
      // annotation Kybernos : il n'y a donc ni pastille de surcharge, ni
      // marqueur de câblage, ni retour en arrière — la valeur et sa provenance,
      // et rien d'autre. Un nombre sans provenance est un nombre qui ment.
      const kbLocaleFr = () => String(kbLocaleRead()).indexOf('fr') === 0
      const kbNum = (v, dec) => {
        const n = Number(v)
        if (isFinite(n) !== true) return '—'
        const s = n.toFixed(dec === undefined ? 1 : dec)
        return kbLocaleFr() ? s.replace('.', ',') : s
      }
      /** AA publie ses épreuves en fraction (0,5185) et ses indices en points
       *  (−5,3) : on rend le pourcentage pour les premières, le point pour les
       *  seconds — sans jamais convertir un indice en pourcentage. */
      const kbEval = (v) => {
        const n = Number(v)
        if (isFinite(n) !== true) return '—'
        return n >= 0 && n <= 1 ? kbNum(n * 100, 1) + ' %' : kbNum(n, 1)
      }
      const kbDate = (at) => {
        const d = new Date(Number(at))
        if (isFinite(d.getTime()) !== true) return '—'
        const p = (x) => (x < 10 ? '0' + String(x) : String(x))
        return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + 'h' + p(d.getMinutes())
      }
      const kbMethod = (meth) => m('kb.models.scores.method', { m: m('kb.models.scores.method.' + String(meth === undefined || meth === null ? 'slug' : meth)) })
      /** Les épreuves affichées, dans l'ordre de lecture. */
      const AA_SHOW = ['scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'mmmuPro', 'lcr', 'critpt', 'tau2', 'tauBanking', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre', 'omniscience']
      /** Les catégories de BenchLM, dans l'ordre. */
      const BL_SHOW = ['coding', 'agentic', 'reasoning', 'knowledge', 'multimodalGrounded', 'instructionFollowing', 'multilingual', 'math', 'external']

      const ScoreLine = (props) => h('span', { className: 'kbm-sc-it' },
        // L'intitulé est long parfois (« Terminal-Bench 4.0 ») : la cellule le
        // tronque plutôt que de tordre la grille, et l'infobulle le rend entier.
        h('span', { className: 'kbm-sc-l', title: props.label }, props.label),
        h('span', { className: 'kbm-sc-v' }, props.value))

      const ScoreAa = (props) => {
        const m2 = props.mo.scores.aa
        const e = m2.entry
        const labels = props.labels === undefined || props.labels === null ? {} : props.labels
        const items = []
        for (const k of AA_SHOW) {
          const v = e[k]
          if (v === null || v === undefined) continue
          const l = labels[k]
          items.push({ k: k, label: l === undefined || l.name === null ? k : l.name, value: kbEval(v) })
        }
        const prix = []
        if (e.price1mInputTokens !== undefined || e.price1mOutputTokens !== undefined) {
          prix.push(m('kb.models.scores.price', { a: kbNum(e.price1mInputTokens, 2), b: kbNum(e.price1mOutputTokens, 2) }))
        }
        if (e.medianOutputTokensPerSecond !== undefined) prix.push(m('kb.models.scores.tok', { n: kbNum(e.medianOutputTokensPerSecond, 0) }))
        if (e.medianTimeToFirstTokenSeconds !== undefined) prix.push(m('kb.models.scores.ttft', { n: kbNum(e.medianTimeToFirstTokenSeconds, 2) }))
        return h('div', { className: 'kbm-sc', 'data-kbm': 'score-aa' },
          h('div', { className: 'kbm-sc-h' },
            h('a', { className: 'kbm-sc-src', href: 'https://artificialanalysis.ai/models/' + encodeURIComponent(m2.slug), target: '_blank', rel: 'noreferrer' },
              h('span', null, 'Artificial Analysis'), Ic('external', 12)),
            m2.method === 'slug' ? null : h('span', { className: 'kbm-sc-warn' }, kbMethod(m2.method))),
          h('div', { className: 'kbm-sc-main' },
            h('span', { className: 'kbm-sc-big' }, kbNum(e.intelligenceIndex, 1)),
            h('span', { className: 'kbm-sc-biglab' }, m('kb.models.scores.intelligence') + (e.intelligenceIndexIsEstimated === true ? ' · ' + m('kb.models.scores.estimated') : ''))),
          items.length === 0 ? null : h('div', { className: 'kbm-sc-vals' }, items.map((it) => h(ScoreLine, { key: it.k, label: it.label, value: it.value }))),
          prix.length === 0 ? null : h('div', { className: 'kbm-sc-foot' }, prix.join(' · ')))
      }

      const ScoreBl = (props) => {
        const m2 = props.mo.scores.benchlm
        const e = m2.entry
        const cats = e.verifiedCategories !== null && e.verifiedCategories !== undefined ? e.verifiedCategories : (e.categories === null || e.categories === undefined ? {} : e.categories)
        const items = []
        for (const k of BL_SHOW) {
          const v = cats[k]
          if (v === null || v === undefined) continue
          items.push({ k: k, label: m('kb.models.cat.' + k), value: kbNum(v, 1) })
        }
        const provisoire = e.displayScore === null || e.displayScore === undefined
        const grande = provisoire ? e.provisionalDisplayScore : e.displayScore
        const cov = e.coverage === null || e.coverage === undefined ? null : e.coverage
        const pied = []
        if (e.verifiedDisplayScore !== null && e.verifiedDisplayScore !== undefined) pied.push(m('kb.models.scores.verified') + ' ' + kbNum(e.verifiedDisplayScore, 1))
        if (cov !== null && cov.trustedBenchmarkCount !== undefined) {
          pied.push(m('kb.models.scores.coverage', { n: cov.trustedBenchmarkCount, m: cov.rankableBenchmarkCount, c: cov.scoreConfidence }))
        }
        const lien = typeof e.url === 'string' && e.url.length > 0 ? e.url : 'https://benchlm.ai/models/' + encodeURIComponent(m2.slug)
        return h('div', { className: 'kbm-sc', 'data-kbm': 'score-benchlm' },
          h('div', { className: 'kbm-sc-h' },
            h('a', { className: 'kbm-sc-src', href: lien, target: '_blank', rel: 'noreferrer' },
              h('span', null, 'BenchLM'), Ic('external', 12)),
            h('span', { className: 'kbm-sc-lic' }, 'CC BY-NC 4.0'),
            m2.method === 'slug' ? null : h('span', { className: 'kbm-sc-warn' }, kbMethod(m2.method))),
          h('div', { className: 'kbm-sc-main' },
            h('span', { className: 'kbm-sc-big' + (grande === null || grande === undefined ? ' vide' : '') }, kbNum(grande, 1)),
            h('span', { className: 'kbm-sc-biglab' },
              m('kb.models.scores.overall')
              + (provisoire && grande !== null && grande !== undefined ? ' · ' + m('kb.models.scores.provisional') : '')
              + ' · ' + (e.overallRank === null || e.overallRank === undefined ? m('kb.models.scores.unranked') : m('kb.models.scores.rank', { n: e.overallRank })))),
          items.length === 0 ? null : h('div', { className: 'kbm-sc-vals' }, items.map((it) => h(ScoreLine, { key: it.k, label: it.label, value: it.value }))),
          pied.length === 0 ? null : h('div', { className: 'kbm-sc-foot' }, pied.join(' · ')))
      }

      const Scores = (props) => {
        const mo = props.mo
        const sc = mo.scores
        if (sc === null || sc === undefined) {
          const mot = mo.scoresLoading === true
            ? m('kb.models.scores.loading')
            : (mo.scoresFailed === true ? m('kb.models.scores.failed') : m('kb.models.scores.empty'))
          // L'état PORTE son nom dans le DOM : « en cours de lecture » n'est pas
          // « aucune note », et un contrôle qui attend l'absence doit pouvoir le
          // distinguer — l'ancien attribut unique les confondait et faisait
          // passer au vert une lecture encore en vol.
          const etat = mo.scoresLoading === true ? 'scores-loading' : (mo.scoresFailed === true ? 'scores-failed' : 'scores-idle')
          return h('div', { className: 'kbm-scwrap', 'data-kbm': etat },
            h('div', { className: 'kbm-note' }, mot))
        }
        const aa = sc.aa === null || sc.aa === undefined ? null : sc.aa
        const bl = sc.benchlm === null || sc.benchlm === undefined ? null : sc.benchlm
        const vide = aa === null && bl === null
        return h('div', { className: 'kbm-scwrap', 'data-kbm': 'scores' },
          vide ? h('div', { className: 'kbm-note kbm-sc-empty' }, m('kb.models.scores.empty')) : null,
          vide ? null : h('div', { className: 'kbm-sccards' },
            aa === null ? null : h(ScoreAa, { mo: mo, labels: sc.labels }),
            bl === null ? null : h(ScoreBl, { mo: mo, labels: sc.labels })),
          h('div', { className: 'kbm-note' }, m('kb.models.scores.note')),
          h('div', { className: 'kbm-scmeta' },
            sc.at === null || sc.at === undefined ? null
              : h('span', { className: 'kbm-sc-date' }, m('kb.models.scores.stale', { d: kbDate(sc.at) }) + (sc.stale === true ? ' · ' + m('kb.models.scores.old') : '')),
            h('button', { type: 'button', className: 'kbm-link', 'data-kbm': 'scores-reload', disabled: mo.scoresLoading === true, onClick: () => kbMScoresLoad(mo, true) },
              Ic('refresh', 13), h('span', null, m('kb.models.scores.reload'))),
            h('button', { type: 'button', className: 'kbm-link', 'data-kbm': 'scores-refresh', disabled: KBM.scoresRunning === true, onClick: () => { kbMScoresRefresh(true).then(() => kbMScoresLoad(mo, true)) } },
              Ic('download', 13), h('span', null, KBM.scoresRunning === true ? m('kb.models.scores.refreshing') : m('kb.models.scores.reload.all')))))
      }

      const Section = (props) => h('div', { className: 'kbm-sec', 'data-kbm': 'section-' + props.id },
        h('div', { className: 'kbm-seclab' },
          h('div', null, m(props.label)),
          props.hint === undefined ? null : h('div', { className: 'kbm-sechint' }, props.hint),
          props.aside === undefined ? null : props.aside),
        h('div', { className: (props.wrap === true ? 'kbm-chips' : 'kbm-grid') + (props.wide === true ? ' wide' : '') }, props.children))

      const Details = (props) => {
        const mo = props.mo
        const nOv = kbmCountOv(mo)
        const nRemote = Object.keys(mo.remote).length
        const kept = Object.keys(mo.ov).filter((k) => mo.remote[k] !== undefined).length
        let statusText = m('kb.models.status.idle')
        let statusIcon = 'info'
        let statusClass = 'idle'
        if (mo.loading === true) { statusText = m('kb.models.status.loading', { id: mo.id }); statusIcon = 'clock'; statusClass = 'loading' }
        else if (mo.synced === true) {
          statusText = m('kb.models.status.matched', { id: mo.id, n: nRemote })
            + (mo.stale === true ? ' · ' + m('kb.models.status.stale') : '')
            + (kept > 0 ? ' · ' + m('kb.models.status.kept', { n: kept }) : '')
          statusIcon = 'check'
          statusClass = 'ok'
        }
        const syncLabel = mo.loading === true ? m('kb.models.fetching') : (mo.synced === true ? m('kb.models.resync') : m('kb.models.sync'))
        const bySec = (sec) => CAPS.filter((c) => c.sec === sec)
        return h('div', { className: 'kbm-details', 'data-kbm': 'details' },
          h('div', { className: 'kbm-dhead' },
            h('div', { className: 'kbm-dtitle' }, m('kb.models.details')),
            h('div', { className: 'kbm-dacts' },
              nOv > 0 ? h('button', { type: 'button', className: 'kbm-link', 'data-kbm': 'clear', onClick: () => kbmClear(mo) },
                m(nOv > 1 ? 'kb.models.clearN' : 'kb.models.clear1', { n: nOv })) : null,
              h('a', { className: 'kbm-link', href: 'https://models.dev/', target: '_blank', rel: 'noreferrer', 'data-kbm': 'openmd' },
                m('kb.models.openmd'), Ic('external', 13)),
              h('button', { type: 'button', className: 'kbm-link kbm-primary', 'data-kbm': 'sync', disabled: mo.loading === true, onClick: () => kbmSync(mo.key) },
                Ic(mo.synced === true || mo.loading === true ? 'refresh' : 'download', 14),
                h('span', null, syncLabel)))),
          h('div', { className: 'kbm-status' },
            h('span', { className: 'kbm-statusline kbm-' + statusClass, 'data-kbm': 'status' }, Ic(statusIcon, 14), h('span', null, statusText)),
            h('span', { className: 'kbm-legend' },
              h('span', { className: 'kbm-it' }, h(Dot, { src: 'sync' }), m('kb.models.legend.sync')),
              h('span', { className: 'kbm-it' }, h(Dot, { src: 'ov' }), m('kb.models.legend.ov')))),
          h('div', { className: 'kbm-secs' },
            h(Section, { id: 'input', label: 'kb.models.sec.input', wrap: true }, bySec('input').map((c) => h(Chip, { mo: mo, def: c, key: c.k }))),
            KBM.live === true && mo.baseCtl.__inputImplicite !== undefined
              ? h('div', { className: 'kbm-note', 'data-kbm': 'input-implicite' }, mo.baseCtl.__inputImplicite === 'route' ? m('kb.models.input.implicite.route') : m('kb.models.input.implicite.defaut'))
              : null,
            h(Section, { id: 'output', label: 'kb.models.sec.output', wrap: true }, bySec('output').map((c) => h(Chip, { mo: mo, def: c, key: c.k }))),
            h(Section, { id: 'caps', label: 'kb.models.sec.caps', wrap: true }, bySec('caps').map((c) => h(Chip, { mo: mo, def: c, key: c.k }))),
            h(Section, {
              id: 'type', label: 'kb.models.sec.type', wrap: true,
              // Le nom du type vient de models.dev : quand il est surchargé, le
              // libellé de retour dit À QUOI on revient, comme dans la maquette.
              aside: kbmIsOv(mo, 'type') === true
                ? h('button', {
                  type: 'button', className: 'kbm-minirevert', 'data-kbm': 'revert-type',
                  title: kbmUnder(mo, 'type') === '' ? m('kb.models.clearfield') : m('kb.models.revert', { v: kbmUnder(mo, 'type') }),
                  onClick: () => kbmRevert(mo, 'type'),
                }, kbmUnder(mo, 'type') === '' ? m('kb.models.clearfield') : m('kb.models.revert', { v: kbmUnder(mo, 'type') }))
                : null,
            }, TYPES.map((t) => h(TypeChip, { mo: mo, def: t, key: t.id }))),
            h('div', { className: 'kbm-note' }, m('kb.models.note.type')),
            h('div', { className: 'kbm-sep' }),
            h(Section, { id: 'limits', label: 'kb.models.sec.limits' }, LIMITS.map((f) => h(Field, { mo: mo, def: f, key: f.k }))),
            h(Section, { id: 'pricing', label: 'kb.models.sec.pricing', hint: m('kb.models.pricing.unit'), wide: true }, PRICING.map((f) => h(Field, { mo: mo, def: f, key: f.k }))),
            h(Section, { id: 'meta', label: 'kb.models.sec.meta', wide: true }, META.map((f) => h(Field, { mo: mo, def: f, key: f.k }))),
            h('div', { className: 'kbm-sep' }),
            // Les notes viennent de DEUX pages publiques, pas du harnais : elles
            // ne sont ni éditables ni marquées, et la section le dit.
            h(Section, { id: 'scores', label: 'kb.models.sec.scores', hint: m('kb.models.scores.hint'), wide: true },
              h(Scores, { mo: mo })),
            h('div', { className: 'kbm-note kbm-wirenote' }, m('kb.models.wire.note'))))
      }

      // ══ L'ÉCRAN CÂBLÉ ═════════════════════════════════════════════════════
      // La maquette telle qu'elle est branchée : les deux onglets de la maquette
      // (Providers d'abord — la décision), la liste dense et son filtre, et
      // l'éditeur que la flèche ouvre en dialogue. Les hooks `data-kbm` ne
      // changent pas : le contrat des deux niveaux est le même, seul l'écran
      // change. L'état d'écran (onglet, recherche, filtres, tri) ne se persiste
      // pas et n'écrit rien.

      const UI = { tab: 'providers', q: '', prov: 'all', type: 'all', statut: 'any', tri: 'name', caps: {}, menu: null, page: 1 }
      // Changer un filtre (ou d'onglet) ramène à la première page : rester à
      // une page qui n'existe plus afficherait une liste vide.
      const uiSet = (k, v) => { UI[k] = v; if (k !== 'page') UI.page = 1; kbmNotify() }
      const uiCap = (k) => { UI.caps[k] = UI.caps[k] !== true; UI.page = 1; kbmNotify() }
      const uiProvs = () => {
        const out = []
        for (const mo of KBM.models) if (mo.route !== '' && out.indexOf(mo.route) < 0) out.push(mo.route)
        return out
      }
      const uiReset = () => {
        UI.q = ''
        UI.prov = 'all'
        UI.type = 'all'
        UI.statut = 'any'
        UI.tri = 'name'
        UI.caps = {}
        kbmNotify()
      }
      const uiFiltre = () => {
        if (UI.q.trim() !== '' || UI.prov !== 'all' || UI.type !== 'all' || UI.statut !== 'any') return true
        for (const k of Object.keys(UI.caps)) if (UI.caps[k] === true) return true
        return false
      }
      /** Le tri de la maquette : sur la valeur AFFICHÉE, fiche en attente
       *  comprise — pas sur un `val` qui ignorait les valeurs non confirmées. */
      const uiNombre = (mo, k) => {
        const brut = String(kbmVal(mo, k) === null || kbmVal(mo, k) === undefined ? '' : kbmVal(mo, k)).replace(/[^0-9.]/g, '')
        const n = Number(brut)
        return brut !== '' && isFinite(n) ? n : -1
      }
      const uiRows = () => {
        const cherche = UI.q.trim().toLowerCase()
        const caps = CAPS.filter((c) => UI.caps[c.k] === true)
        const rows = KBM.models.filter((mo) => {
          if (UI.prov !== 'all' && mo.route !== UI.prov) return false
          if (UI.type !== 'all' && String(kbmVal(mo, 'type')) !== UI.type) return false
          if (UI.statut === 'ov' && kbmCountOv(mo) === 0) return false
          if (UI.statut === 'sync' && mo.synced !== true) return false
          if (UI.statut === 'pending' && mo.synced === true) return false
          for (const c of caps) if (kbmVal(mo, c.k) !== true) return false
          if (cherche !== '') {
            const foin = (mo.id + ' ' + mo.name + ' ' + mo.route + ' ' + String(kbmVal(mo, 'type'))).toLowerCase()
            if (foin.indexOf(cherche) < 0) return false
          }
          return true
        })
        if (UI.tri === 'context') return rows.sort((a, b) => uiNombre(b, 'context') - uiNombre(a, 'context'))
        if (UI.tri === 'provider') return rows.sort((a, b) => (a.route + ' ' + a.id).localeCompare(b.route + ' ' + b.id))
        return rows.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
      }
      const uiCaps = (mo) => CAPS.filter((c) => kbmVal(mo, c.k) === true)
      /** L'infobulle d'une icône de capacité : le libellé PUIS le maillon —
       *  une icône seule ne dit ni ce qu'elle nomme, ni si la donnée est
       *  appliquée au harnais ou annotée (le contrat public du panneau). */
      const kbmCapTip = (c) => m(c.t) + ' — ' + (c.wire === undefined ? m('kb.models.mark.note') : m('kb.models.mark.wire'))
      const uiTypeDef = (mo) => TYPES.filter((t) => t.id === String(kbmVal(mo, 'type')))[0] || null
      const uiSync = (mo) => {
        if (mo.loading === true) return { txt: m('kb.models.col.fetching'), cls: 'wait' }
        if (mo.synced === true) return { txt: m('kb.models.col.synced'), cls: 'ok' }
        if (Object.keys(mo.remote).length > 0) return { txt: m('kb.models.col.pending'), cls: 'wait' }
        return { txt: m('kb.models.col.nosync'), cls: 'no' }
      }
      // Les valeurs de la fiche s'affichent même non confirmées : on le DIT.
      const uiAvis = (mo) => (mo.synced !== true && mo.loading !== true && Object.keys(mo.remote).length > 0
        ? m('kb.models.col.previewed', { n: Object.keys(mo.remote).length })
        : null)
      const uiPrix = (mo) => {
        const a = String(kbmVal(mo, 'costIn') === null || kbmVal(mo, 'costIn') === undefined ? '' : kbmVal(mo, 'costIn'))
        const b = String(kbmVal(mo, 'costOut') === null || kbmVal(mo, 'costOut') === undefined ? '' : kbmVal(mo, 'costOut'))
        if (a === '' && b === '') return null
        return '$' + (a === '' ? '—' : a) + ' / $' + (b === '' ? '—' : b)
      }
      const OPT_STATUT = () => [
        { v: 'any', t: m('kb.models.anystatus'), c: m('kb.models.opt.anystatus') },
        { v: 'ov', t: m('kb.models.statut.ov') },
        { v: 'sync', t: m('kb.models.statut.sync') },
        { v: 'pending', t: m('kb.models.statut.pending') },
      ]
      const OPT_TRI = () => [
        { v: 'name', t: m('kb.models.tri.name') },
        { v: 'context', t: m('kb.models.tri.context') },
        { v: 'provider', t: m('kb.models.tri.provider') },
      ]

      const Loupe = () => h('svg', { className: 'kbmp-loupe', viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' },
        h('circle', { cx: 7, cy: 7, r: 4.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M10.6 10.6 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))

      /** Une puce de capacité : elle filtre la liste. Icône + libellé : huit
       *  pastilles muettes ne disaient pas ce qu'elles filtraient. */
      const CapFiltre = (props) => {
        const on = UI.caps[props.def.k] === true
        return h('button', {
          type: 'button', className: 'kbmp-cap' + (on === true ? ' on' : ''), 'aria-pressed': on,
          'data-kbm': 'capfilter-' + props.def.k, title: m(props.def.t), 'aria-label': m(props.def.t),
          onClick: () => uiCap(props.def.k),
        },
        h('span', { className: 'kbmp-capi', style: on === true ? undefined : { color: props.def.tint } }, Ic(props.def.icon, 13)),
        h('span', { className: 'kbmp-caplab' }, m(props.def.t)))
      }

      /** Le `Menu` de DSH : un déclencheur + une liste, fermés au clic dehors.
       *
       *  `props.field` — et JAMAIS `props.key` : React réserve `key` pour la
       *  réconciliation et ne le passe pas au composant. Les quatre filtres
       *  lisaient donc `UI[undefined]`, affichaient « Provider · undefined » et
       *  n'appliquaient rien (la sélection s'écrivait sur `UI.undefined`). */
      const Menu = (props) => {
        const ouvert = UI.menu === props.id
        const choix = props.options.filter((o) => o.v === UI[props.field])[0]
        const actif = choix !== undefined && choix.v !== props.defaut
        const dit = choix === undefined ? props.label : (choix.c !== undefined ? choix.c : choix.t)
        return h('div', { className: 'kbm-menu-root kbmp-menu' },
          h('button', {
            type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline kbmp-trig' + (actif === true ? ' on' : ''),
            'data-kbm': 'menu-' + props.id, 'aria-haspopup': 'listbox', 'aria-expanded': ouvert,
            'aria-label': props.label + ' — ' + dit, title: props.label + ' — ' + dit,
            onClick: (ev) => { ev.stopPropagation(); uiSet('menu', ouvert === true ? null : props.id) },
          },
          h('span', { className: 'kbmp-triglab' }, props.label + ' · '),
          h('span', { className: 'kbmp-trigval' }, dit),
          h('span', { className: 'kbmp-trigchev' }, Ic('chevron', 13))),
          ouvert === true
            ? h('div', { className: 'kbm-menu-list kbmp-pop', role: 'listbox' },
              props.options.map((o) => h('button', {
                type: 'button', role: 'option', key: o.v, 'aria-selected': o.v === UI[props.field],
                className: 'kbm-menu-item' + (o.v === UI[props.field] ? ' kbm-menu-selected' : ''),
                'data-kbm': 'opt-' + props.id + '-' + o.v,
                onClick: (ev) => { ev.stopPropagation(); UI[props.field] = o.v; UI.page = 1; UI.menu = null; kbmNotify() },
              }, h('span', { className: 'kbm-menu-itemLabel' }, o.t))))
            : null)
      }

      /** Une ligne de la liste dense — et, quand elle est ouverte, l'éditeur de
       *  la maquette en dialogue. Le dialogue vit DANS la ligne (position fixe) :
       *  les hooks de la ligne restent valables tels quels. */
      const Row = (props) => {
        const mo = props.mo
        const ouvert = mo.open === true
        const caps = uiCaps(mo)
        const type = uiTypeDef(mo)
        const sy = uiSync(mo)
        const avis = uiAvis(mo)
        const nOv = kbmCountOv(mo)
        const kept = Object.keys(mo.ov).filter((k) => mo.remote[k] !== undefined).length
        const draft = useDraft(mo.name, (v) => kbmRename(mo, v))
        const visibles = caps.slice(0, 4)
        const reste = caps.length - visibles.length
        const prix = uiPrix(mo)
        const ctx = String(kbmVal(mo, 'context') === null || kbmVal(mo, 'context') === undefined ? '' : kbmVal(mo, 'context'))
        const colonnes = []
        // ── MODEL : le nom, puis une ligne de contexte (id · route · type ·
        //    prix). Portée par la cellule du nom à l'écran étroit : c'est ce
        //    qui rend la table lisible à 556 px sans colonnes vides ni
        //    troncature du nom (l'ancienne grille ne laissait que ~139 px au
        //    modèle, d'où « Claude Sonnet 4.5 (O… »).
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cmodel', key: 'm' },
          h('div', { className: 'kbmp-nameline' },
            h('input', Object.assign({
              className: 'kbm-in-input kbmp-nom', 'aria-label': m('kb.models.name'), 'data-kbm': 'model-name',
              title: mo.name || mo.id,
            }, draft)),
            nOv > 0
              ? h(Tip, {
                key: 'ov',
                text: m(nOv > 1 ? 'kb.models.ovline' : 'kb.models.ovline1', { n: nOv, m: kept }) + ' — ' + m('kb.models.ovtip', { n: nOv, m: kept }),
              },
              h('span', {
                className: 'kbmp-ovpill', 'data-kbm': 'ovpill',
              }, m(nOv > 1 ? 'kb.models.ovpill' : 'kb.models.ovpill1', { n: nOv })))
              : null),
          h('div', { className: 'kbmp-metaline' },
            h('input', {
              className: 'kbm-in-input kbmp-id', value: mo.id, 'aria-label': m('kb.models.id'),
              'data-kbm': 'model-id', readOnly: KBM.live === true && mo.route !== '',
              title: mo.id, onChange: (ev) => { mo.id = ev.target.value; kbmNotify() },
            }),
            KBM.live === true
              ? h('span', { className: 'kbmp-msep' }, '·')
              : null,
            KBM.live === true
              ? h('span', { className: 'kbmp-mcellroute' },
                mo.route === '' ? null : h(LogoProv, { route: mo.route, taille: 14 }),
                h('span', { className: 'kbmp-mroute', 'data-kbm': 'row-route', title: m('kb.models.route') + ' ' + mo.route }, mo.route === '' ? '—' : mo.route))
              : h('span', { className: 'kbmp-mroute' }, mo.route === '' ? '—' : mo.route),
            h('span', { className: 'kbmp-mcaps' },
              caps.length === 0
                ? null
                : h('span', { className: 'kbmp-caprow' }, visibles.map((c) => h(Tip, { key: c.k, text: kbmCapTip(c) }, h('span', { className: 'kbmp-capi', style: { color: c.tint } }, Ic(c.icon, 16)))),
                  reste > 0 ? h('span', { className: 'kbmp-plus' }, m('kb.models.more', { n: reste })) : null)),
            type === null
              ? null
              : h('span', { className: 'kbmp-mtype' }, h('span', { className: 'kbmp-tyi', style: { color: type.tint } }, Ic(type.icon, 12)), m(type.t)),
            prix === null ? null : h('span', { className: 'kbmp-mprix' }, prix))))
        // ── CAPABILITIES : la colonne des icônes, sur les écrans larges.
        colonnes.push(h('div', { className: 'kbmp-c kbmp-ccaps', key: 'c' },
          caps.length === 0
            ? h('span', { className: 'kbmp-vide' }, '—')
            : h('span', { className: 'kbmp-caprow' },
              caps.slice(0, 4).map((c) => h(Tip, { key: c.k, text: kbmCapTip(c) }, h('span', { className: 'kbmp-capi', style: { color: c.tint } }, Ic(c.icon, 16)))),
              (caps.length - 4 > 0 || (caps.length === 2 && caps[0].k === 'textIn' && caps[1].k === 'textOut'))
                ? h('span', { className: 'kbmp-txtonly' }, m('kb.models.textonly'))
                : null,
              caps.length - 4 > 0 ? h('span', { className: 'kbmp-plus' }, m('kb.models.more', { n: caps.length - 4 })) : null)))
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cctx', key: 'x' },
          ctx === '' ? h('span', { className: 'kbmp-vide' }, '—') : h('span', null, pretty(ctx) === '' ? ctx : pretty(ctx))))
        // ── SOURCE : la provenance seule. La pastille ambre des surcharges vit
        //    sur la ligne du nom : elle décrit le modèle, pas la source, et
        //    « 5 overrides · 0 applied » débordait de ces 96 px.
        colonnes.push(h('div', { className: 'kbmp-c kbmp-csrc', key: 's' },
          h('span', { className: 'kbmp-sy ' + sy.cls, title: sy.txt }, h('span', { className: 'kbmp-point' }), sy.txt),
          avis === null ? null : h('span', { className: 'kbmp-avis', title: avis }, avis)))
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cact', key: 'a' },
          h('button', {
            type: 'button', className: 'kbm-btn kbm-btn-icon kbm-btn-ghost', 'data-kbm': 'expand',
            'aria-expanded': ouvert, 'aria-label': (ouvert === true ? m('kb.models.hide') : m('kb.models.show')) + ' ' + mo.id,
            onClick: () => kbmOpen(mo.key),
          }, h('span', { className: 'kbmp-chev' + (ouvert === true ? ' open' : '') }, Ic('chevron', 16))),
          h('button', {
            type: 'button', className: 'kbm-btn kbm-btn-icon kbm-btn-ghost kbmp-danger', 'data-kbm': 'remove',
            'aria-label': (KBM.live === true && mo.kind !== 'local' ? m('kb.models.remove.annotations') : m('kb.models.delete')) + ' ' + (mo.id || mo.name || ''),
            onClick: () => kbmRemove(mo.key),
          }, Ic('trash', 16))))
        return h('div', {
          className: 'kbm-item kbmp-lig' + (ouvert === true ? ' open' : '') + (props.compact === true ? ' compact' : ''),
          'data-kbm': 'item', 'data-kbm-key': mo.route + '/' + mo.id, 'data-kbm-kind': mo.kind,
        },
        h('div', { className: 'kbmp-cols' }, colonnes),
        KBM.live === true && mo.kind === 'local' ? h('div', { className: 'kbmp-note', 'data-kbm': 'row-local' }, m('kb.models.local')) : null,
        mo.error !== null && mo.error !== undefined ? h('div', { className: 'kbmp-err', 'data-kbm': 'row-error', role: 'status' }, String(mo.error)) : null,
        ouvert === true
          ? h('div', {
            className: 'kbm-mdl-root', 'data-kbm': 'modal',
            onMouseDown: (ev) => { if (ev.target === ev.currentTarget) kbmOpen(mo.key) },
          },
          h('div', { className: 'kbm-mdl-mask' }),
          h('div', {
            className: 'kbm-mdl-dialog kbmp-mdl', role: 'dialog', 'aria-modal': 'true',
            'aria-label': m('kb.models.details') + ' — ' + mo.id,
          },
          h('div', { className: 'kbm-mdl-header' },
            h('div', { className: 'kbmp-mdlhead' },
              h('div', { className: 'kbm-mdl-title' }, mo.name || mo.id),
              h('div', { className: 'kbmp-mdlsub' }, (KBM.live === true && mo.route !== '' ? mo.route + ' · ' : '') + mo.id
                + (mo.kind === 'local' ? ' · ' + m('kb.models.prov.local') : ''))),
            h('button', {
              type: 'button', className: 'kbm-mdl-close', 'data-kbm': 'close',
              'aria-label': m('kb.models.hide') + ' ' + mo.id, onClick: () => kbmOpen(mo.key),
            }, h('span', { className: 'kbmp-x' }, '×'))),
          h('div', { className: 'kbm-mdl-body kbmp-mdlbody' }, h(Details, { mo: mo }))))
          : null)
      }

      /** La liste du catalogue est longue : on la découpe par pages (10 lignes),
       *  et le pied de page dit toujours où l'on est sur le total filtré. */
      const ROWS_PAR_PAGE = 10
      /** La liste du catalogue : dense, ses filtres, son compteur. L'ancien
       *  onglet « Providers » est fondu : les rangées natives au-dessous
       *  gèrent déjà les fournisseurs (clé, route, suppression) — un doublon
       *  de la même liste ne disait rien de plus. La clé d'API et l'URL de
       *  base restent HORS du panneau (l'avertissement le dit en tête). */
      // Onglet « Providers » : la section native de DSH reste VIDE sous notre
      // panneau — les rangées Edit/Delete de DSH vivent dans la page native
      // « Models », pas dans cette section — donc l'onglet n'affichait rien du
      // tout alors qu'il annonce « Fournisseurs 9 » (constat de la campagne
      // visuelle). On liste ici ce que le host expose vraiment : la route et le
      // nombre de modèles qu'elle porte. Rien n'est inventé.
      // ── logos fournisseurs : Simple Icons CDN, repli puce-initiale ──────
      // Un logo manquant (hors ligne, route inconnue) ne casse rien : la puce
      // reprend la première lettre de la route. Mapping par sous-chaîne, car
      // les routes réelles portent des suffixes (qwen-token-plan, vercel-ai-
      // gateway, xiaomi-token-plan-ams…).
      const LOGO_SLUGS = [
        ['openrouter', 'openrouter'], ['anthropic', 'anthropic'], ['deepseek', 'deepseek'],
        ['google', 'google'], ['gemini', 'googlegemini'], ['openai', 'openai'],
        ['qwen', 'qwen'], ['vercel', 'vercel'], ['ollama', 'ollama'], ['xiaomi', 'xiaomi'],
        ['mistral', 'mistralai'], ['groq', 'groq'], ['perplexity', 'perplexity'],
        ['huggingface', 'huggingface'], ['together', 'togetherai'], ['xai', 'xai'],
      ]
      const logoSlugDe = (route) => {
        const r = String(route || '').toLowerCase()
        const trouvée = LOGO_SLUGS.find((p) => r.indexOf(p[0]) >= 0)
        return trouvée === undefined ? null : trouvée[1]
      }
      // ── catalogue de fournisseurs (source : https://models.dev/providers/) ──
      // Entrées : { id, nom, env, url, logo, libre }. `libre` marque les
      // fournisseurs qui proposent des modèles GRATUITS sous quota
      // (OpenRouter : openrouter.ai/collections/free-models ; NVIDIA NIM
      // preview : build.nvidia.com/models → nim_type_preview). Le slug
      // `logo` vise cdn.simpleicons.org ; absent ou en échec → puce-initiale.
      // Un préremplissage n'écrit rien tout seul : il propose slug, baseURL
      // et nom de variable d'env, l'utilisateur confirme avec « Ajouter ».
      const PROV_CATALOG = [
        { id: 'openrouter', nom: 'OpenRouter', env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1', logo: 'openrouter', libre: true },
        { id: 'nvidia', nom: 'NVIDIA NIM', env: 'NVIDIA_API_KEY', url: 'https://integrate.api.nvidia.com/v1', logo: 'nvidia', libre: true },
        { id: 'groq', nom: 'Groq', env: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1', logo: 'groq' },
        { id: 'cerebras', nom: 'Cerebras', env: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1', logo: 'cerebras' },
        { id: 'mistral', nom: 'Mistral', env: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1', logo: 'mistralai' },
        { id: 'cohere', nom: 'Cohere', env: 'COHERE_API_KEY', url: 'https://api.cohere.ai/compatibility/v1', logo: 'cohere' },
        { id: 'xai', nom: 'xAI', env: 'XAI_API_KEY', url: 'https://api.x.ai/v1', logo: 'xai' },
        { id: 'perplexity', nom: 'Perplexity', env: 'PERPLEXITY_API_KEY', url: 'https://api.perplexity.ai', logo: 'perplexity' },
        { id: 'togetherai', nom: 'Together AI', env: 'TOGETHER_API_KEY', url: 'https://api.together.xyz/v1', logo: 'togetherai' },
        { id: 'fireworks-ai', nom: 'Fireworks AI', env: 'FIREWORKS_API_KEY', url: 'https://api.fireworks.ai/inference/v1', logo: null },
        { id: 'deepinfra', nom: 'Deep Infra', env: 'DEEPINFRA_API_KEY', url: 'https://api.deepinfra.com/v1/openai', logo: null },
        { id: 'novita-ai', nom: 'Novita AI', env: 'NOVITA_API_KEY', url: 'https://api.novita.ai/openai', logo: null },
        { id: 'siliconflow', nom: 'SiliconFlow', env: 'SILICONFLOW_API_KEY', url: 'https://api.siliconflow.com/v1', logo: null },
        { id: 'huggingface', nom: 'Hugging Face', env: 'HF_TOKEN', url: 'https://router.huggingface.co/v1', logo: 'huggingface' },
        { id: 'chutes', nom: 'Chutes', env: 'CHUTES_API_KEY', url: 'https://llm.chutes.ai/v1', logo: null },
        { id: 'nano-gpt', nom: 'NanoGPT', env: 'NANO_GPT_API_KEY', url: 'https://nano-gpt.com/api/v1', logo: null },
        { id: 'zai', nom: 'Z.AI', env: 'ZHIPU_API_KEY', url: 'https://api.z.ai/api/paas/v4', logo: null },
        { id: 'zhipuai', nom: 'Zhipu AI', env: 'ZHIPU_API_KEY', url: 'https://open.bigmodel.cn/api/paas/v4', logo: null },
        { id: 'moonshotai', nom: 'Moonshot AI', env: 'MOONSHOT_API_KEY', url: 'https://api.moonshot.ai/v1', logo: null },
        { id: 'minimax', nom: 'MiniMax', env: 'MINIMAX_API_KEY', url: 'https://api.minimax.io/v1', logo: null },
        { id: 'alibaba', nom: 'Alibaba (DashScope)', env: 'DASHSCOPE_API_KEY', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', logo: 'alibabacloud' },
        { id: 'stepfun-ai', nom: 'StepFun', env: 'STEPFUN_API_KEY', url: 'https://api.stepfun.ai/v1', logo: null },
        { id: 'baseten', nom: 'Baseten', env: 'BASETEN_API_KEY', url: 'https://inference.baseten.co/v1', logo: null },
        { id: 'nebius', nom: 'Nebius', env: 'NEBIUS_API_KEY', url: 'https://api.tokenfactory.nebius.com/v1', logo: null },
        { id: 'ovhcloud', nom: 'OVHcloud AI', env: 'OVHCLOUD_API_KEY', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', logo: 'ovh' },
        { id: 'scaleway', nom: 'Scaleway', env: 'SCALEWAY_API_KEY', url: 'https://api.scaleway.ai/v1', logo: 'scaleway' },
        { id: 'crusoe', nom: 'Crusoe', env: 'CRUSOE_API_KEY', url: 'https://api.inference.crusoecloud.com/v1', logo: null },
        { id: 'vultr', nom: 'Vultr', env: 'VULTR_API_KEY', url: 'https://api.vultrinference.com/v1', logo: 'vultr' },
        { id: 'digitalocean', nom: 'DigitalOcean', env: 'DIGITALOCEAN_ACCESS_TOKEN', url: 'https://inference.do-ai.run/v1', logo: 'digitalocean' },
        { id: 'hetzner', nom: 'Hetzner', env: 'HETZNER_API_KEY', url: 'https://inference.hetzner.com/api/v1', logo: 'hetzner' },
        { id: 'vercel', nom: 'Vercel AI Gateway', env: 'AI_GATEWAY_API_KEY', url: 'https://ai-gateway.vercel.sh/v1', logo: 'vercel' },
        { id: 'requesty', nom: 'Requesty', env: 'REQUESTY_API_KEY', url: 'https://router.requesty.ai/v1', logo: null },
        { id: 'aihubmix', nom: 'AIHubMix', env: 'AIHUBMIX_API_KEY', url: 'https://aihubmix.com/v1', logo: null },
        { id: '302ai', nom: '302.AI', env: '302AI_API_KEY', url: 'https://api.302.ai/v1', logo: null },
        { id: 'poe', nom: 'Poe', env: 'POE_API_KEY', url: 'https://api.poe.com/v1', logo: null },
        { id: 'venice', nom: 'Venice AI', env: 'VENICE_API_KEY', url: 'https://api.venice.ai/api/v1', logo: null },
        { id: 'upstage', nom: 'Upstage', env: 'UPSTAGE_API_KEY', url: 'https://api.upstage.ai/v1/solar', logo: null },
        { id: 'sarvam', nom: 'Sarvam AI', env: 'SARVAM_API_KEY', url: 'https://api.sarvam.ai/v1', logo: null },
        { id: 'ai21', nom: 'AI21 Labs', env: 'AI21_API_KEY', url: 'https://api.ai21.com/studio/v1', logo: null },
        { id: 'modelscope', nom: 'ModelScope', env: 'MODELSCOPE_API_KEY', url: 'https://api-inference.modelscope.cn/v1', logo: null },
        { id: 'ollama-cloud', nom: 'Ollama Cloud', env: 'OLLAMA_API_KEY', url: 'https://ollama.com/v1', logo: 'ollama' },
        { id: 'lmstudio', nom: 'LM Studio', env: 'LMSTUDIO_API_KEY', url: 'http://127.0.0.1:1234/v1', logo: null },
        { id: 'friendli', nom: 'FriendliAI', env: 'FRIENDLI_TOKEN', url: 'https://api.friendli.ai/serverless/v1', logo: null },
        { id: 'io-net', nom: 'IO.NET', env: 'IOINTELLIGENCE_API_KEY', url: 'https://api.intelligence.io.solutions/api/v1', logo: null },
        { id: 'kilo', nom: 'Kilo Gateway', env: 'KILO_API_KEY', url: 'https://api.kilo.ai/api/gateway', logo: null },
        { id: 'nearai', nom: 'NEAR AI Cloud', env: 'NEARAI_API_KEY', url: 'https://cloud-api.near.ai/v1', logo: null },
        { id: 'edenai', nom: 'Eden AI', env: 'EDENAI_API_KEY', url: 'https://api.edenai.run/v3', logo: null },
        { id: 'helicone', nom: 'Helicone', env: 'HELICONE_API_KEY', url: 'https://ai-gateway.helicone.ai/v1', logo: null },
      ]
      // Liens « modèles gratuits sous quota » — les deux fournisseurs de la
      // demande (02/10) ; une future entrée `libre` du catalogue aura le sien.
      const FREE_LINKS = {
        openrouter: 'https://openrouter.ai/collections/free-models',
        nvidia: 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview',
      }
      // Catalogue complet models.dev (~210 fournisseurs), servi par l'hôte ; tant
      // qu'il n'est pas arrivé (ou si l'hôte est ancien), la courte liste
      // ci-dessus fait foi. `libre` et les liens « free » restent les nôtres.
      let KB_CATALOGUE = PROV_CATALOG
      let KB_CAT_CHARGE = false
      const POPULAIRES = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai', 'openrouter', 'togetherai', 'fireworks-ai',
        'cerebras', 'perplexity', 'moonshotai', 'zhipuai', 'alibaba', 'nvidia', 'deepinfra', 'huggingface', 'vercel', 'github-models']
      const kbCatalogueFusion = (liste) => {
        const libres = new Set(PROV_CATALOG.filter((p) => p.libre === true).map((p) => p.id))
        const vus = new Set()
        const out = liste.map((p) => { vus.add(p.id); return { ...p, libre: libres.has(p.id) } })
        for (const c of PROV_CATALOG) if (!vus.has(c.id)) out.push({ id: c.id, nom: c.nom, env: c.env, url: c.url, doc: '', logo: c.logo || false, libre: c.libre === true })
        return out.sort((a, b) => a.nom.localeCompare(b.nom, 'en', { sensitivity: 'base' }))
      }
      const catDe = (slug) => KB_CATALOGUE.find((p) => p.id === slug) || null
      /** Entrée du catalogue (logo SVG disponible) qui correspond à une route : id exact, sinon id-préfixe le plus long. */
      const kbLogoEntree = (route) => {
        const r = String(route || '').toLowerCase()
        let best = null
        for (const p of KB_CATALOGUE) {
          if (p.logo !== true) continue
          if (r === p.id || r.indexOf(p.id + '-') === 0) { if (best === null || p.id.length > best.id.length) best = p }
        }
        return best
      }
      /** Puce logo par slug de catalogue (simpleicons) — repli initiale. */
      const LogoSlug = ({ slug, nom, taille }) => {
        const [echec, setEchec] = React.useState(false)
        const t = taille || 18
        if (!slug || echec === true) {
          return h('span', { className: 'kbmp-logo kbmp-logo-chip', style: { width: t + 6, height: t + 6, fontSize: Math.max(9, t - 6) } },
            String(nom || slug || '?').charAt(0).toUpperCase())
        }
        return h('img', { className: 'kbmp-logo', src: 'https://cdn.simpleicons.org/' + slug, width: t, height: t, alt: '', loading: 'lazy', onError: () => setEchec(true) })
      }
      /** Logo models.dev servi par l'hôte, peint en masque : il prend la couleur du thème (clair/sombre). */
      const LogoMd = ({ id, nom, taille }) => {
        const t = taille || 18
        const u = 'url(/kybernos-models/logo?id=' + encodeURIComponent(id) + ')'
        return h('span', { className: 'kbmp-logo kbmp-logo-mask', role: 'img', 'aria-label': nom || id, style: { width: t, height: t, WebkitMaskImage: u, maskImage: u } })
      }
      /** Tuile carrée arrondie portant le logo (ou l'initiale). */
      const LogoTile = ({ p, taille, tuile }) => {
        const t = taille || 16
        const inner = p.logo === true ? h(LogoMd, { id: p.id, nom: p.nom, taille: t })
          : (typeof p.logo === 'string' && p.logo !== '' ? h(LogoSlug, { slug: p.logo, nom: p.nom, taille: t })
            : h('span', { className: 'kbmp-tuile-init' }, String(p.nom || p.id).charAt(0).toUpperCase()))
        return h('span', { className: 'kbmp-tuile', style: { width: tuile || 28, height: tuile || 28 } }, inner)
      }
      /** Badge vert « Free models · quota », avec lien vers la collection. */
      const BadgeFree = ({ slug, petit }) => {
        const lien = FREE_LINKS[slug]
        const cls = petit === true ? 'kbmp-free kbmp-free-sm' : 'kbmp-free'
        const contenu = [h('span', { key: 't', className: 'kbmp-free-t' }, m('kb.prov.free'))]
        if (lien) {
          contenu.push(h('a', { key: 'l', className: 'kbmp-free-lien', href: lien, target: '_blank', rel: 'noreferrer', title: m('kb.prov.free.lien') }, '↗'))
        }
        return h('span', { className: cls, title: m('kb.prov.free.titre'), 'data-kbm': 'prov-free' }, contenu)
      }
      const LogoProv = ({ route, taille }) => {
        const [echec, setEchec] = React.useState(false)
        const t = taille || 18
        const slug = logoSlugDe(route)
        const ent = kbLogoEntree(route)
        if (ent !== null) return h(LogoMd, { id: ent.id, nom: route, taille: t })
        if (slug === null || echec === true) {
          return h('span', { className: 'kbmp-logo kbmp-logo-chip', style: { width: t + 6, height: t + 6, fontSize: Math.max(9, t - 6) } },
            String(route).charAt(0).toUpperCase())
        }
        return h('img', { className: 'kbmp-logo', src: 'https://cdn.simpleicons.org/' + slug, width: t, height: t, alt: '', loading: 'lazy', onError: () => setEchec(true) })
      }

      // ═══ Providers tab ═══════════════════════════════════════════════════════════════
      // Cards read at rest (logo, name, count, key dot, free-models link); the actions
      // (switch, edit, more) appear on hover and focus, and stay visible on touch screens.
      // Edit and Add open a side panel built like DSH's own editor: the key first, the rest
      // folded under "Customized settings", models as two fields (id + display name).
      const PV_PROTOS = [['openai-completions', 'kb.pv.proto.chat'], ['openai-responses', 'kb.pv.proto.resp'], ['anthropic-messages', 'kb.pv.proto.msgs']]
      /** A hand-declared route: what the engine's directory says (`declared`), else whatever models.dev does not carry. */
      const pvIsCustom = (route) => (kbPvIsObj(KBM.dir[route]) ? KBM.dir[route].declared === true : KB_CATALOGUE.every((p) => p.id !== route))
      const pvLabel = (route) => {
        const d = KBM.dir[route]
        if (kbPvIsObj(d) && typeof d.name === 'string' && d.name.trim() !== '') return d.name
        const prof = kbMOBJ(KBM.userProviders)[route]
        return kbPvIsObj(prof) && typeof prof.displayName === 'string' && prof.displayName.trim() !== '' ? prof.displayName : route
      }
      const pvEditDraft = (route) => {
        const prof = kbPvIsObj(kbMOBJ(KBM.userProviders)[route]) ? KBM.userProviders[route] : {}
        const rows = Array.isArray(prof.models) ? prof.models.filter((x) => kbPvIsObj(x)).map((x) => ({ id: String(x.id || ''), name: typeof x.name === 'string' ? x.name : '' })) : []
        return { key: '', voir: false, adv: false, name: typeof prof.displayName === 'string' ? prof.displayName : '', url: typeof prof.baseURL === 'string' ? prof.baseURL : '',
          proto: typeof prof.api === 'string' ? prof.api : 'openai-completions', models: rows, touched: false, custom: pvIsCustom(route) }
      }
      const pvAddDraft = () => ({ tab: 'catalog', prov: null, id: '', name: '', url: '', proto: 'openai-completions', key: '', voir: false, models: [], adv: false, liste: true, q: '', act: 0 })

      const PvField = (props) => h('div', { className: 'kbpv-fld' },
        h('label', { className: 'kbpv-fl', htmlFor: props.id }, props.label),
        props.children,
        props.err ? h('span', { className: 'kbpv-err', role: 'alert' }, props.err) : (props.hint ? h('span', { className: 'kbpv-hint' }, props.hint) : null))

      /** The models of a draft: two fields per row (id, display name), delete, add. */
      const PvModels = ({ d, set, custom }) => {
        const rows = d.models
        const upd = (i, k, v) => set({ models: rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)), touched: true })
        return h('div', { className: 'kbpv-fld', 'data-kbm': 'pv-models' },
          h('div', { className: 'kbpv-mhead' }, h('span', { className: 'kbpv-fl' }, m('kb.pv.models'))),
          rows.length === 0
            ? h('p', { className: 'kbpv-hint' }, m(custom ? 'kb.pv.models.none' : 'kb.pv.models.catalog'))
            : h('div', { className: 'kbpv-mrows' }, rows.map((r, i) => h('div', { className: 'kbpv-mrow', key: i, 'data-kbm': 'pv-model-row' },
              h('input', { className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: m('kb.pv.model.id'), 'aria-label': m('kb.pv.model.id') + ' ' + String(i + 1), value: r.id, onChange: (ev) => upd(i, 'id', ev.target.value) }),
              h('input', { className: 'kbm-in-input kbpv-in', placeholder: m('kb.pv.model.name'), 'aria-label': m('kb.pv.model.name') + ' ' + String(i + 1), value: r.name, onChange: (ev) => upd(i, 'name', ev.target.value) }),
              h('button', { type: 'button', className: 'kbpv-ib kbpv-ib-danger', 'aria-label': m('kb.pv.model.del', { n: i + 1 }), title: m('kb.pv.model.del', { n: i + 1 }), onClick: () => set({ models: rows.filter((_, j) => j !== i), touched: true }) }, Ic('trash', 15))))),
          h('div', null, h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'pv-model-add', onClick: () => set({ models: rows.concat([{ id: '', name: '' }]), touched: true }) }, Ic('plus', 13), m('kb.pv.model.add'))))
      }

      const PvDrawer = ({ label, onClose, children, footer, head }) => {
        React.useEffect(() => {
          const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose() } }
          document.addEventListener('keydown', key)
          return () => document.removeEventListener('keydown', key)
        }, [onClose])
        return h('div', { className: 'kbpv-layer', 'data-kbm': 'pv-drawer' },
          h('div', { className: 'kbpv-mask', onMouseDown: onClose }),
          h('div', { className: 'kbpv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
            h('header', null, head, h('button', { type: 'button', className: 'kbpv-ib', 'aria-label': m('kb.pv.close'), onClick: onClose }, Ic('x', 16))),
            h('div', { className: 'kbpv-body' }, children),
            h('footer', null, footer)))
      }

      const ProviderList = () => {
        const [, forcer] = React.useReducer((x) => x + 1, 0)
        const [ui, setUi] = React.useState({ drawer: null, dlg: null, menu: null, busy: false, err: null, note: null, typed: '' })
        const [dr, setDr] = React.useState(null)
        const patch = (o) => setUi((u) => ({ ...u, ...o }))
        const setD = (o) => setDr((d) => ({ ...d, ...o }))
        React.useEffect(() => {
          if (KB_CAT_CHARGE === true || KBM.live !== true) return undefined
          KB_CAT_CHARGE = true
          let mort = false
          fetch('/kybernos-models/providers', { headers: { accept: 'application/json' } })
            .then((r) => (r.status === 200 ? r.json() : null))
            .then((b) => {
              if (b !== null && Array.isArray(b.providers) && b.providers.length > 0) KB_CATALOGUE = kbCatalogueFusion(b.providers)
              else KB_CAT_CHARGE = false
              if (mort !== true) forcer()
            })
            .catch(() => { KB_CAT_CHARGE = false })
          return () => { mort = true }
        }, [])
        React.useEffect(() => {
          const close = () => { setUi((u) => (u.menu !== null ? { ...u, menu: null } : u)) }
          document.addEventListener('click', close)
          return () => document.removeEventListener('click', close)
        }, [])
        // The models.dev list closes when you press anywhere else, and that press still does its job
        // (a full-screen backdrop would swallow it: the first click on a tab only closed the list).
        const listOpen = dr !== null && dr.liste === true
        React.useEffect(() => {
          if (listOpen !== true) return undefined
          const away = (ev) => {
            const t = ev.target
            if (t !== null && t !== undefined && typeof t.closest === 'function' && t.closest('.kbpv-cb') !== null) return
            setDr((d) => (d !== null && d.liste === true ? { ...d, liste: false } : d))
          }
          document.addEventListener('mousedown', away)
          return () => document.removeEventListener('mousedown', away)
        }, [listOpen])
        const routes = KBM.routes.slice()
        const parkedShown = kbMParkedShown(KBM.parked, routes)
        const taken = routes.concat(parkedShown.map((p) => p.slug))
        const ro = KBM.writable !== true
        const countOf = (route) => KBM.models.filter((mo) => mo.route === route).length
        const keyOf = (route) => {
          const prof = kbMOBJ(KBM.userProviders)[route]
          const ref = kbPvIsObj(prof) && typeof prof.apiKeyEnv === 'string' ? prof.apiKeyEnv : null
          if (ref === null) return 'none'
          const st = KBM.keys[ref]
          return st === true ? 'ok' : (st === false ? 'missing' : 'unknown')
        }
        const closeAll = () => { setDr(null); setUi((u) => ({ ...u, drawer: null, dlg: null, menu: null, busy: false, err: null, typed: '' })) }
        const openEdit = (route, addModel) => {
          const d = pvEditDraft(route)
          if (addModel === true) { d.adv = true; d.models = d.models.concat([{ id: '', name: '' }]); d.touched = true }
          setDr(d); patch({ drawer: { mode: 'edit', id: route }, menu: null, err: null, note: null })
        }
        const openAdd = () => { setDr(pvAddDraft()); patch({ drawer: { mode: 'add' }, menu: null, err: null, note: null }) }
        const run = async (fn, errKey, slug) => {
          patch({ busy: true, err: null })
          try { const out = await fn(); return out }
          catch (e) { patch({ busy: false, err: m(errKey, { slug: slug || '', raison: String(e && e.message ? e.message : e) }) }); return undefined }
        }
        const doSave = async (route) => {
          const out = await run(() => kbPvSave(route, { ...dr, models: dr.touched === true ? dr.models : undefined }), 'kb.pv.save.err', route)
          if (out === undefined) return
          setDr(null); patch({ drawer: null, busy: false, note: m(out.keyOk === false ? 'kb.pv.saved.key.ko' : 'kb.pv.saved') })
        }
        const doCreate = async () => {
          const d = { ...dr }
          if (d.tab === 'catalog') { const p = catDe(d.prov); d.name = p !== null ? p.nom : d.id }
          const out = await run(() => kbPvCreate(d), 'kb.pv.add.err', d.id)
          if (out === undefined) return
          setDr(null); uiSet('prov', out.slug)
          patch({ drawer: null, busy: false, note: m(out.keyOk === false ? 'kb.prov.add.fait.cleko' : (out.keyOk === true ? 'kb.prov.add.fait.cleok' : 'kb.prov.add.fait'), { slug: out.slug }) })
        }
        const doDisable = async (route) => {
          patch({ dlg: null })
          const out = await run(() => kbMDisable(route).then(() => true), 'kb.prov.off.err', route)
          if (out === true) patch({ busy: false, drawer: null })
        }
        const doEnable = async (slug) => {
          const out = await run(() => kbMEnable(slug).then(() => true), 'kb.prov.on.err', slug)
          if (out === true) patch({ busy: false })
        }
        const doDelete = async (route) => {
          patch({ dlg: null })
          const out = await run(() => kbPvDelete(route).then(() => true), 'kb.pv.del.err', route)
          if (out === true) { setDr(null); patch({ busy: false, drawer: null, typed: '' }) }
        }

        // ── one card ──
        const renderSwitch = ({ route, on, locked, why }) => h('button', {
          type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', className: 'kbpv-sw' + (on ? ' on' : ''), 'data-kbm': 'prov-switch',
          disabled: locked === true || ui.busy === true, title: why, 'aria-label': why,
          onClick: (ev) => { ev.stopPropagation(); if (on) patch({ dlg: { type: 'off', id: route } }); else doEnable(route) },
        }, h('span', { className: 'kbpv-sw-k' }))
        const renderCard = ({ route, off }) => {
          const label = off === true ? route : pvLabel(route)
          const pk = KBM.parked.find((p) => p.slug === route)
          const count = off === true ? (pk !== undefined ? pk.models.length : 0) : countOf(route)
          const custom = pvIsCustom(route)
          const bloc = off === true ? null : kbMParkBlock(route, KBM.userProviders, KBM.baseProviders)
          const ks = off === true ? 'none' : keyOf(route)
          const free = FREE_LINKS[route] !== undefined && off !== true
          const hostOff = KBM.parkHost !== true
          const swWhy = off === true ? m('kb.prov.off.enable', { slug: route }) : (bloc === 'managed' ? m('kb.prov.off.managed') : (bloc === 'profile' ? m('kb.prov.off.locked') : m('kb.prov.off.disable', { slug: route })))
          return h('div', { key: (off === true ? 'off-' : '') + route, className: 'kbpv-card' + (off === true ? ' kbpv-off' : ''), 'data-kbm': off === true ? 'prov-card-off' : 'prov-card', 'data-prov': route },
            h('span', { className: 'kbpv-logo' }, h(LogoProv, { route, taille: 20 })),
            h('div', { className: 'kbpv-cbody' },
              h('span', { className: 'kbpv-nm' },
                h('button', { type: 'button', className: 'kbpv-link', 'data-kbm': 'prov-voir', 'aria-label': m('kb.prov.voir') + ' · ' + label, onClick: () => { uiSet('prov', route); uiSet('tab', 'models') } }, label),
                ks === 'none' ? null : h('i', { className: 'kbpv-kd kbpv-kd-' + ks, title: m(ks === 'ok' ? 'kb.pv.key.ok' : (ks === 'missing' ? 'kb.pv.key.missing' : 'kb.pv.key.unknown')) })),
              h('span', { className: 'kbpv-meta', 'data-kbm': 'prov-name' },
                custom ? h('span', { className: 'kbpv-tag' }, m('kb.pv.custom')) : null,
                off !== true && kbPvIsObj(KBM.dir[route]) && KBM.dir[route].error !== '' ? h('span', { className: 'kbpv-tag kbpv-tag-warn', title: KBM.dir[route].error, 'data-kbm': 'prov-diag' }, m('kb.pv.diag')) : null,
                h('span', null, String(count) + ' ' + m(count === 1 ? 'kb.models.prov.model1' : 'kb.models.prov.modelN'))),
              free ? h(BadgeFree, { slug: route, petit: true }) : null),
            h('div', { className: 'kbpv-right' },
              off === true ? h('span', { className: 'kbpv-rest' }, h('span', { className: 'kbpv-tag', 'data-kbm': 'prov-off-badge' }, m('kb.prov.off.badge'))) : null,
              h('div', { className: 'kbpv-acts' },
                renderSwitch({ route, on: off !== true, locked: ro || hostOff || (off !== true && bloc !== null), why: ro ? m('kb.models.readonly') : (hostOff ? m('kb.pv.hostnote') : swWhy) }),
                off === true ? null : h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'prov-edit', disabled: ro || bloc === 'managed', title: m('kb.pv.edit', { slug: route }), 'aria-label': m('kb.pv.edit', { slug: route }), onClick: (ev) => { ev.stopPropagation(); openEdit(route, false) } }, Ic('pencil', 15)),
                off === true ? null : h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'prov-more', 'aria-haspopup': 'menu', 'aria-expanded': ui.menu === route ? 'true' : 'false', title: m('kb.pv.more', { slug: route }), 'aria-label': m('kb.pv.more', { slug: route }), onClick: (ev) => { ev.stopPropagation(); patch({ menu: ui.menu === route ? null : route }) } }, Ic('more', 15)))),
            ui.menu === route ? h('div', { className: 'kbpv-menu', role: 'menu', 'data-kbm': 'prov-menu', onClick: (ev) => ev.stopPropagation() },
              h('button', { type: 'button', role: 'menuitem', onClick: () => { uiSet('prov', route); uiSet('tab', 'models') } }, Ic('chevron', 14), m('kb.prov.voir')),
              h('button', { type: 'button', role: 'menuitem', disabled: ro || bloc !== null, 'data-kbm': 'prov-add-model', onClick: () => openEdit(route, true) }, Ic('plus', 14), m('kb.pv.menu.add')),
              h('hr', null),
              h('button', { type: 'button', role: 'menuitem', className: 'kbpv-danger', disabled: ro || bloc !== null, 'data-kbm': 'prov-delete', onClick: () => patch({ dlg: { type: 'del', id: route }, menu: null, typed: '' }) }, Ic('trash', 14), m('kb.pv.menu.delete'))) : null)
        }

        // ── Edit panel ──
        const renderEdit = () => {
          const route = ui.drawer.id
          const label = pvLabel(route)
          const bloc = kbMParkBlock(route, KBM.userProviders, KBM.baseProviders)
          const ks = keyOf(route)
          const urlBad = dr.url.trim() !== '' && !kbPvUrlOk(dr.url)
          return h(PvDrawer, {
            label: m('kb.pv.edit', { slug: route }), onClose: closeAll,
            head: h('span', { className: 'kbpv-dh' }, h('span', { className: 'kbpv-logo' }, h(LogoProv, { route, taille: 20 })), h('span', { className: 'kbpv-dt' }, label)),
            footer: [h('button', { key: 'c', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'pv-cancel', onClick: closeAll }, m('kb.pv.cancel')),
              h('button', { key: 'a', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'pv-apply', disabled: ui.busy === true || urlBad || ro, onClick: () => doSave(route) }, m('kb.pv.apply'))],
          },
          ui.err ? h('div', { className: 'kbpv-fail', role: 'alert', 'data-kbm': 'pv-fail' }, ui.err) : null,
          h(PvField, { id: 'pv-key', label: m('kb.prov.add.cle.label'), hint: m('kb.prov.add.cle.note') },
            h('span', { className: 'kbpv-keyrow' },
              h('input', { id: 'pv-key', className: 'kbm-in-input kbpv-in', type: dr.voir === true ? 'text' : 'password', autoComplete: 'off', spellCheck: false, 'data-kbm': 'pv-key',
                placeholder: m(ks === 'ok' ? 'kb.pv.key.ph.set' : 'kb.pv.key.ph.blank'), value: dr.key, onChange: (ev) => setD({ key: ev.target.value }) }),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', tabIndex: -1, onClick: () => setD({ voir: dr.voir !== true }) }, m(dr.voir === true ? 'kb.prov.add.cle.cacher' : 'kb.prov.add.cle.voir')))),
          h('button', { type: 'button', className: 'kbpv-adv', 'data-kbm': 'pv-adv', 'aria-expanded': dr.adv === true ? 'true' : 'false', onClick: () => setD({ adv: dr.adv !== true }) }, Ic('chevron', 14), m('kb.pv.customized')),
          dr.adv === true ? h('div', { className: 'kbpv-advbox', 'data-kbm': 'pv-advbox' },
            dr.custom === true ? h(PvField, { id: 'pv-name', label: m('kb.pv.name') }, h('input', { id: 'pv-name', className: 'kbm-in-input kbpv-in', placeholder: route, value: dr.name, onChange: (ev) => setD({ name: ev.target.value }) })) : null,
            h(PvField, { id: 'pv-url', label: m('kb.pv.url'), err: urlBad ? m('kb.pv.err.url') : null }, h('input', { id: 'pv-url', className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: m('kb.pv.url.default'), value: dr.url, onChange: (ev) => setD({ url: ev.target.value }) })),
            dr.custom === true ? h(PvField, { id: 'pv-proto', label: m('kb.pv.proto') }, h('select', { id: 'pv-proto', className: 'kbm-in-input kbpv-in', value: dr.proto, onChange: (ev) => setD({ proto: ev.target.value }) }, PV_PROTOS.map((x) => h('option', { key: x[0], value: x[0] }, m(x[1]))))) : null,
            h(PvModels, { d: dr, set: setD, custom: dr.custom === true })) : null,
          h('div', { className: 'kbpv-zone' },
            h('div', { className: 'kbpv-z' }, h('div', null, h('b', null, m('kb.pv.zone.off')), h('span', null, m('kb.pv.zone.off.d'))),
              renderSwitch({ route, on: true, locked: ro || KBM.parkHost !== true || bloc !== null, why: KBM.parkHost !== true ? m('kb.pv.hostnote') : bloc === 'managed' ? m('kb.prov.off.managed') : (bloc === 'profile' ? m('kb.prov.off.locked') : m('kb.prov.off.disable', { slug: route })) })),
            h('div', { className: 'kbpv-z' }, h('div', null, h('b', null, m('kb.pv.zone.del')), h('span', null, m('kb.pv.zone.del.d'))),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline kbpv-danger', disabled: ro || bloc !== null, 'data-kbm': 'pv-delete', onClick: () => patch({ dlg: { type: 'del', id: route }, typed: '' }) }, m('kb.pv.menu.delete')))))
        }

        // ── Add panel: the catalog picker keeps its search, groups, icons and keyboard ──
        const renderAdd = () => {
          const catalog = dr.tab === 'catalog'
          const q = dr.q.trim().toLowerCase()
          const filtre = KB_CATALOGUE.filter((p) => q === '' || p.nom.toLowerCase().indexOf(q) >= 0 || p.id.indexOf(q) >= 0 || String(p.env).toLowerCase().indexOf(q) >= 0)
          let sections
          if (q !== '') sections = [{ id: 'res', titre: m(filtre.length === 1 ? 'kb.prov.add.resultat1' : 'kb.prov.add.resultatsN', { n: filtre.length }), items: filtre }]
          else {
            const last = (arr) => arr.filter((p) => taken.indexOf(p.id) < 0).concat(arr.filter((p) => taken.indexOf(p.id) >= 0))
            const libres = filtre.filter((p) => p.libre === true)
            const pop = POPULAIRES.map((id) => filtre.find((p) => p.id === id)).filter((p) => p !== undefined && p.libre !== true)
            const vus = new Set(libres.concat(pop).map((p) => p.id))
            const reste = filtre.filter((p) => !vus.has(p.id))
            sections = [{ id: 'free', titre: m('kb.prov.add.grp.free'), items: last(libres) }, { id: 'pop', titre: m('kb.prov.add.grp.pop'), items: last(pop) },
              { id: 'tous', titre: m('kb.prov.add.grp.tous') + ' · ' + String(reste.length), items: last(reste) }].filter((sec) => sec.items.length > 0)
          }
          const ordre = []
          for (const sec of sections) for (const p of sec.items) if (taken.indexOf(p.id) < 0) ordre.push(p)
          const preset = catalog && dr.prov ? catDe(dr.prov) : null
          const choose = (p) => {
            setDr((d) => ({ ...d, prov: p.id, id: p.id, url: p.url, adv: d.adv === true || p.modele === true || p.url === '', liste: false, q: '', act: 0 }))
            setTimeout(() => { try { const el = document.getElementById('pv-key'); if (el) el.focus() } catch (e) { /* best-effort */ } }, 30)
          }
          const move = (delta) => {
            if (ordre.length === 0) return
            setDr((d) => ({ ...d, act: (((d.act || 0) + delta) % ordre.length + ordre.length) % ordre.length }))
            setTimeout(() => { try { const el = document.querySelector('.kbpv-opt-act'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) } catch (e) { /* best-effort */ } }, 0)
          }
          const block = kbPvAddBlock(dr, taken)
          const hint = block === 'slug' || block === 'taken' || block === 'url' || block === 'template' ? m('kb.pv.err.' + block) : null
          const renderCombo = () => h('div', { className: 'kbpv-cb' },
            h('button', { type: 'button', className: 'kbpv-cb-btn', 'data-kbm': 'prov-combo', 'aria-haspopup': 'listbox', 'aria-expanded': dr.liste === true ? 'true' : 'false', onClick: () => setD({ liste: dr.liste !== true }) },
              preset !== null
                ? h('span', { className: 'kbpv-cb-val' }, h(LogoTile, { p: preset, taille: 14, tuile: 26 }), h('span', null, preset.nom), preset.libre === true ? h(BadgeFree, { slug: preset.id, petit: true }) : null)
                : h('span', { className: 'kbpv-cb-ph' }, m('kb.prov.add.choisir')),
              h('span', { className: 'kbpv-cb-chev' }, Ic('chevron', 14))),
            dr.liste === true ? h('div', { className: 'kbpv-cb-pop', 'data-kbm': 'prov-picker' },
              h('span', { className: 'kbm-in-wrap kbpv-cb-q' }, Loupe(),
                h('input', { className: 'kbm-in-input', type: 'search', placeholder: m('kb.prov.add.chercher'), 'aria-label': m('kb.prov.add.chercher'), value: dr.q, autoFocus: true, autoComplete: 'off',
                  onChange: (ev) => setD({ q: ev.target.value, act: 0 }),
                  onKeyDown: (ev) => {
                    if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1) }
                    else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1) }
                    else if (ev.key === 'Enter') { const pa = ordre[Math.min(dr.act || 0, ordre.length - 1)]; if (pa !== undefined) { ev.preventDefault(); ev.stopPropagation(); choose(pa) } }
                    else if (ev.key === 'Escape') { ev.stopPropagation(); setD({ liste: false }) }
                  } })),
              h('div', { className: 'kbpv-cb-liste', role: 'listbox', 'aria-label': m('kb.prov.add.presets') },
                sections.map((sec) => h('div', { key: sec.id },
                  h('div', { className: 'kbpv-cb-grp' }, sec.titre),
                  sec.items.map((p) => {
                    const deja = taken.indexOf(p.id) >= 0
                    const idx = ordre.indexOf(p)
                    return h('div', { key: p.id, role: 'option', 'aria-selected': dr.prov === p.id ? 'true' : 'false', 'aria-disabled': deja ? 'true' : 'false', 'data-kbm': 'prov-preset', 'data-preset': p.id,
                      className: 'kbpv-opt' + (deja ? ' kbpv-opt-deja' : '') + (idx >= 0 && idx === (dr.act || 0) ? ' kbpv-opt-act' : ''),
                      onClick: deja ? undefined : () => choose(p), onMouseEnter: () => { if (idx >= 0 && idx !== dr.act) setD({ act: idx }) } },
                    h(LogoTile, { p, taille: 16, tuile: 30 }),
                    h('span', { className: 'kbpv-opt-c' }, h('span', { className: 'kbpv-opt-n' }, p.nom), h('span', { className: 'kbpv-opt-e' }, deja ? m('kb.prov.add.deja') : (p.env !== '' ? p.env : String(p.url).replace(/^https?:\/\//, '').replace(/\/+$/, '')))),
                    p.libre === true ? h(BadgeFree, { slug: p.id, petit: true }) : null)
                  }))),
                sections.length === 0 ? h('span', { className: 'kbpv-cb-none' }, m('kb.prov.add.aucun')) : null),
              h('span', { className: 'kbpv-cb-note' }, m('kb.prov.add.pied', { n: KB_CATALOGUE.length }))) : null)
          const keyField = h(PvField, { id: 'pv-key', label: m('kb.prov.add.cle.label'), hint: m('kb.prov.add.cle.note') },
            h('span', { className: 'kbpv-keyrow' },
              h('input', { id: 'pv-key', className: 'kbm-in-input kbpv-in', type: dr.voir === true ? 'text' : 'password', autoComplete: 'off', spellCheck: false, 'data-kbm': 'prov-key',
                placeholder: m('kb.prov.add.cle.ph'), value: dr.key, onChange: (ev) => setD({ key: ev.target.value }) }),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', tabIndex: -1, onClick: () => setD({ voir: dr.voir !== true }) }, m(dr.voir === true ? 'kb.prov.add.cle.cacher' : 'kb.prov.add.cle.voir'))))
          const tab = (id, key) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': dr.tab === id ? 'true' : 'false', className: 'kbpv-tab' + (dr.tab === id ? ' kbpv-tab-on' : ''), 'data-kbm': 'prov-mode-' + (id === 'catalog' ? 'catalogue' : 'perso'),
            onClick: () => { if (dr.tab !== id) setDr({ ...pvAddDraft(), tab: id, liste: id === 'catalog' }) } }, m(key))
          return h(PvDrawer, {
            label: m('kb.pv.title.add'), onClose: closeAll,
            head: h('span', { className: 'kbpv-dt' }, m('kb.pv.title.add')),
            footer: [h('button', { key: 'c', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', onClick: closeAll }, m('kb.pv.cancel')),
              h('button', { key: 'a', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'prov-ok', disabled: ui.busy === true || block !== null || ro, onClick: doCreate }, m(catalog ? 'kb.pv.apply' : 'kb.pv.create'))],
          },
          ui.err ? h('div', { className: 'kbpv-fail', role: 'alert', 'data-kbm': 'pv-fail' }, ui.err) : null,
          h('div', { className: 'kbpv-tabs', role: 'tablist', 'data-kbm': 'prov-mode' }, tab('catalog', 'kb.prov.add.tab.cat'), tab('custom', 'kb.prov.add.tab.perso')),
          h('p', { className: 'kbpv-desc' }, m(catalog ? 'kb.prov.add.desc.cat' : 'kb.prov.add.desc.perso')),
          catalog ? h('div', { className: 'kbpv-fld' }, h('span', { className: 'kbpv-fl' }, m('kb.prov.add.fournisseur')), renderCombo(),
            preset !== null ? h('div', { className: 'kbpv-pinfo', 'data-kbm': 'prov-host' }, h(LogoTile, { p: preset, taille: 22, tuile: 40 }),
              h('span', { className: 'kbpv-pinfo-c' }, h('span', { className: 'kbpv-pinfo-n' }, preset.nom, preset.libre === true ? h(BadgeFree, { slug: preset.id, petit: true }) : null),
                h('span', { className: 'kbpv-pinfo-h' + (dr.url === '' || dr.url.indexOf('${') >= 0 ? ' kbpv-pinfo-warn' : '') }, dr.url === '' || dr.url.indexOf('${') >= 0 ? m('kb.prov.add.url.a.completer') : String(dr.url).replace(/^https?:\/\//, '').replace(/\/+$/, '')))) : null) : null,
          catalog && preset === null ? null : keyFieldFor(),
          null)
          function keyFieldFor () {
            if (catalog) {
              return [keyField,
                h('button', { key: 'adv', type: 'button', className: 'kbpv-adv', 'data-kbm': 'pv-adv', 'aria-expanded': dr.adv === true ? 'true' : 'false', onClick: () => setD({ adv: dr.adv !== true }) }, Ic('chevron', 14), m('kb.prov.add.reglages')),
                dr.adv === true ? h('div', { key: 'box', className: 'kbpv-advbox' },
                  h(PvField, { id: 'pv-slug', label: m('kb.prov.add.slug'), err: dr.id !== '' && (block === 'slug' || block === 'taken') ? m('kb.pv.err.' + block) : null }, h('input', { id: 'pv-slug', className: 'kbm-in-input kbpv-in kbpv-mono', value: dr.id, onChange: (ev) => setD({ id: ev.target.value.toLowerCase() }) })),
                  h(PvField, { id: 'pv-url', label: m('kb.pv.url'), err: dr.url !== '' && (block === 'url' || block === 'template') ? m('kb.pv.err.' + block) : null }, h('input', { id: 'pv-url', className: 'kbm-in-input kbpv-in kbpv-mono', value: dr.url, onChange: (ev) => setD({ url: ev.target.value }) }))) : null]
            }
            return [
              h(PvField, { key: 'id', id: 'pv-slug', label: m('kb.pv.provider.id'), hint: m('kb.pv.provider.id.hint'), err: dr.id !== '' && (block === 'slug' || block === 'taken') ? m('kb.pv.err.' + block) : null },
                h('input', { id: 'pv-slug', className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: 'acme-gateway', autoComplete: 'off', value: dr.id, onChange: (ev) => setD({ id: ev.target.value.toLowerCase() }) })),
              h(PvField, { key: 'nm', id: 'pv-name', label: m('kb.pv.name') }, h('input', { id: 'pv-name', className: 'kbm-in-input kbpv-in', placeholder: m('kb.pv.name'), value: dr.name, onChange: (ev) => setD({ name: ev.target.value }) })),
              h(PvField, { key: 'url', id: 'pv-url', label: m('kb.pv.url'), err: dr.url !== '' && (block === 'url' || block === 'template') ? m('kb.pv.err.' + block) : null },
                h('input', { id: 'pv-url', className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: 'https://gateway.example/v1', value: dr.url, onChange: (ev) => setD({ url: ev.target.value }) })),
              h(PvField, { key: 'pr', id: 'pv-proto', label: m('kb.pv.proto') }, h('select', { id: 'pv-proto', className: 'kbm-in-input kbpv-in', value: dr.proto, onChange: (ev) => setD({ proto: ev.target.value }) }, PV_PROTOS.map((x) => h('option', { key: x[0], value: x[0] }, m(x[1]))))),
              keyField,
              h(PvModels, { key: 'mo', d: dr, set: setD, custom: true })]
          }
        }

        // ── dialogs: disable (as before) and delete (typed confirmation) ──
        const renderDialogs = () => {
          if (ui.dlg === null) return null
          const route = ui.dlg.id
          const label = pvLabel(route)
          const close = () => patch({ dlg: null, typed: '' })
          if (ui.dlg.type === 'off') {
            return h('div', { className: 'kbm-mdl-root', 'data-kbm': 'prov-off-dialog', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) close() } },
              h('div', { className: 'kbm-mdl-mask' }),
              h('div', { className: 'kbm-mdl-dialog kbmp-mdl kbmp-off-dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': m('kb.prov.off.dlg.title', { slug: route }) },
                h('div', { className: 'kbm-mdl-header' }, h('div', { className: 'kbm-mdl-title' }, m('kb.prov.off.dlg.title', { slug: route }))),
                h('div', { className: 'kbm-mdl-body kbmp-off-dlg-body' }, h('p', null, m('kb.prov.off.dlg.body', { slug: route })),
                  h('div', { className: 'kbmp-off-dlg-act' },
                    h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'prov-off-cancel', onClick: close }, m('kb.prov.off.dlg.cancel')),
                    h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'prov-off-ok', onClick: () => doDisable(route) }, m('kb.prov.off.dlg.ok'))))))
          }
          const n = countOf(route)
          const okType = ui.typed.trim() === route
          return h('div', { className: 'kbm-mdl-root', 'data-kbm': 'prov-del-dialog', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) close() } },
            h('div', { className: 'kbm-mdl-mask' }),
            h('div', { className: 'kbm-mdl-dialog kbmp-mdl kbmp-off-dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': m('kb.pv.del.title', { slug: label }) },
              h('div', { className: 'kbm-mdl-header' }, h('div', { className: 'kbm-mdl-title' }, m('kb.pv.del.title', { slug: label }))),
              h('div', { className: 'kbm-mdl-body kbmp-off-dlg-body' }, h('p', null, m('kb.pv.del.body', { n })),
                h('label', { className: 'kbpv-fld' }, h('span', { className: 'kbpv-fl' }, m('kb.pv.del.type', { slug: route })),
                  h('input', { className: 'kbm-in-input kbpv-in kbpv-mono', autoComplete: 'off', autoFocus: true, 'data-kbm': 'prov-del-type', value: ui.typed, onChange: (ev) => patch({ typed: ev.target.value }) })),
                h('div', { className: 'kbmp-off-dlg-act' },
                  h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'prov-del-instead', onClick: () => patch({ dlg: { type: 'off', id: route }, typed: '' }) }, m('kb.pv.del.instead')),
                  h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'prov-del-cancel', onClick: close }, m('kb.prov.off.dlg.cancel')),
                  h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbpv-danger-fill', 'data-kbm': 'prov-del-ok', disabled: !okType || ui.busy === true, onClick: () => doDelete(route) }, m('kb.pv.del.ok'))))))
        }

        // ── the list ──
        if (routes.length === 0 && parkedShown.length === 0 && KBM.hasDeepseek !== true && ui.drawer === null) {
          return h('div', { className: 'kbmp-empty', 'data-kbm': 'prov-empty' }, m('kb.models.prov.empty'),
            h('div', { className: 'kbmp-prov-addct' }, h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'prov-add', disabled: ro, onClick: openAdd }, Ic('plus', 14), m('kb.prov.add'))))
        }
        return h('div', { className: 'kbpv', 'data-kbm': 'prov-list' },
          h('div', { className: 'kbpv-head' },
            h('span', { className: 'kbpv-grow' }),
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'prov-add', disabled: ro, title: ro ? m('kb.models.readonly') : undefined, onClick: openAdd }, Ic('plus', 14), m('kb.prov.add')),
            h('span', { className: 'kbpv-menuwrap' },
              h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'prov-head-more', 'aria-haspopup': 'menu', 'aria-expanded': ui.menu === '__head' ? 'true' : 'false', 'aria-label': m('kb.pv.more.page'), title: m('kb.pv.more.page'), onClick: (ev) => { ev.stopPropagation(); patch({ menu: ui.menu === '__head' ? null : '__head' }) } }, Ic('more', 16)),
              ui.menu === '__head' ? h('div', { className: 'kbpv-menu kbpv-menu-head', role: 'menu', onClick: (ev) => ev.stopPropagation() },
                h('button', { type: 'button', role: 'menuitem', 'data-kbm': 'native-open', onClick: () => { patch({ menu: null }); kbNatOpen() } }, Ic('external', 14), m('kb.nat.open')),
                h('button', { type: 'button', role: 'menuitem', 'aria-checked': kbNatPrefGet() === true ? 'true' : 'false', 'data-kbm': 'native-hide', onClick: () => { kbNatPrefSet(kbNatPrefGet() !== true); kbNatApply(); patch({ menu: null }) } }, Ic(kbNatPrefGet() === true ? 'check' : 'eye', 14), m('kb.nat.hide'))) : null)),
          ui.note !== null ? h('div', { className: 'kbpv-note', role: 'status', 'data-kbm': 'prov-ok' }, h('span', null, ui.note), h('button', { type: 'button', className: 'kbpv-ib', 'aria-label': m('kb.pv.close'), onClick: () => patch({ note: null }) }, Ic('x', 14))) : null,
          ui.err !== null && ui.drawer === null ? h('div', { className: 'kbpv-fail', role: 'alert', 'data-kbm': 'prov-off-err' }, ui.err) : null,
          KBM.parkHost !== true ? h('div', { className: 'kbpv-hostnote', role: 'status', 'data-kbm': 'park-host-note' }, Ic('info', 14), m('kb.pv.hostnote')) : null,
          h('div', { className: 'kbpv-cards', 'data-kbm': 'prov-cards' },
            KBM.hasDeepseek === true ? h('div', { className: 'kbpv-card', 'data-kbm': 'prov-card', 'data-prov': 'deepseek' },
              h('span', { className: 'kbpv-logo' }, h(LogoProv, { route: 'deepseek', taille: 20 })),
              h('div', { className: 'kbpv-cbody' }, h('span', { className: 'kbpv-nm' }, h('span', { className: 'kbpv-link kbpv-static' }, 'DeepSeek')), h('span', { className: 'kbpv-meta' }, m('kb.pv.builtin'))),
              h('div', { className: 'kbpv-right' }, h('div', { className: 'kbpv-acts' }, h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'prov-edit-native', title: m('kb.pv.builtin.edit'), 'aria-label': m('kb.pv.builtin.edit'), onClick: () => { kbNatOpen() } }, Ic('pencil', 15))))) : null,
            routes.map((route) => renderCard({ route })),
            parkedShown.map((p) => renderCard({ route: p.slug, off: true }))),
          ui.drawer !== null && ui.drawer.mode === 'edit' && dr !== null ? renderEdit() : null,
          ui.drawer !== null && ui.drawer.mode === 'add' && dr !== null ? renderAdd() : null,
          renderDialogs())
      }
      const ListView = () => {
        const rows = uiRows()
        const pages = Math.max(1, Math.ceil(rows.length / ROWS_PAR_PAGE))
        const page = Math.min(Math.max(1, Number(UI.page) || 1), pages)
        const debut = (page - 1) * ROWS_PAR_PAGE
        const pageRows = rows.slice(debut, debut + ROWS_PAR_PAGE)
        const toutes = KBM.models
        const capFiltres = ['vision', 'audioIn', 'imageGen', 'video', 'search', 'tools', 's2s', 'reasoning']
        const optsProv = [{ v: 'all', t: m('kb.models.allprov'), c: m('kb.models.opt.allprov') }].concat(uiProvs().map((r) => ({ v: r, t: r })))
        const optsType = [{ v: 'all', t: m('kb.models.alltypes'), c: m('kb.models.opt.alltypes') }].concat(TYPES.map((t) => ({ v: t.id, t: m(t.t) })))
        return h('div', { className: 'kbmp-listwrap' },
          h('div', { className: 'kbmp-bar' },
            h('span', { className: 'kbm-in-wrap kbmp-search' }, Loupe(),
              h('input', {
                className: 'kbm-in-input', type: 'search', placeholder: m('kb.models.search'),
                'aria-label': m('kb.models.search'), 'data-kbm': 'search', value: UI.q,
                onChange: (ev) => uiSet('q', ev.target.value),
              })),
            h('span', { className: 'kbmp-menus' },
              h(Menu, { id: 'prov', field: 'prov', defaut: 'all', label: m('kb.models.filter.prov'), options: optsProv }),
              h(Menu, { id: 'type', field: 'type', defaut: 'all', label: m('kb.models.filter.type'), options: optsType }),
              h(Menu, { id: 'statut', field: 'statut', defaut: 'any', label: m('kb.models.filter.statut'), options: OPT_STATUT() }),
              h(Menu, { id: 'tri', field: 'tri', defaut: 'name', label: m('kb.models.sort'), options: OPT_TRI() }))),
          h('div', { className: 'kbmp-capsbar' },
            h('span', { className: 'kbmp-caps' }, capFiltres
              .map((k) => CAPS.filter((c) => c.k === k)[0])
              .filter((c) => c !== undefined)
              .map((c) => h(CapFiltre, { def: c, key: c.k }))),
            h('span', { className: 'kbmp-compteur' },
              h('span', { 'data-kbm': 'count' }, m('kb.models.count', { a: rows.length, b: toutes.length })),
              h('button', {
                type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost kbmp-reset', 'data-kbm': 'reset',
                disabled: uiFiltre() !== true, onClick: uiReset,
              }, m('kb.models.reset')),
              h('button', {
                type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'sync-list',
                onClick: () => { for (const mo of rows) kbmSync(mo.key) },
              }, Ic('download', 14), h('span', null, m('kb.models.syncN', { n: rows.length }))))),
          h('div', { className: 'kbmp-table', 'data-kbm': 'list' },
            // Les colonnes du modèle vivent dans la cellule MODEL (nom + ligne
            // id · route · type · prix) : la table n'a donc que cinq colonnes,
            // et aucune ne se tronque à 556 px.
            h('div', { className: 'kbmp-thead' },
              ['model', 'caps', 'context', 'source'].map((c) => h('div', { className: 'kbmp-th kbmp-c-' + c, key: c }, m('kb.models.col.' + c))),
              h('div', { className: 'kbmp-th kbmp-c-act', key: 'act' })),
            toutes.length === 0 && KBM.loading !== true
              ? h('div', { className: 'kbmp-vide kbmp-empty' }, KBM.live === true ? m('kb.models.empty.live') : m('kb.models.empty'))
              : null,
            rows.length === 0 && toutes.length > 0
              ? h('div', { className: 'kbmp-vide kbmp-empty', 'data-kbm': 'novide' }, m('kb.models.empty'))
              : null,
            pageRows.map((mo) => h(Row, { mo: mo, key: mo.key })),
            rows.length > ROWS_PAR_PAGE
              ? h('div', { className: 'kbmp-pager', 'data-kbm': 'pager' },
                  h('span', { className: 'kbmp-pageinfo', 'data-kbm': 'pageinfo' },
                    m('kb.models.page.info', { a: debut + 1, b: debut + pageRows.length, n: rows.length })),
                  h('button', {
                    type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', 'data-kbm': 'page-prev',
                    'aria-label': m('kb.models.page.prev'), title: m('kb.models.page.prev'),
                    disabled: page <= 1, onClick: () => uiSet('page', page - 1),
                  }, h('span', { className: 'kbmp-chev', style: { transform: 'rotate(180deg)' } }, Ic('chevron', 14))),
                  h('span', { className: 'kbmp-pagenum', 'data-kbm': 'pagenum' }, page + ' / ' + pages),
                  h('button', {
                    type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', 'data-kbm': 'page-next',
                    'aria-label': m('kb.models.page.next'), title: m('kb.models.page.next'),
                    disabled: page >= pages, onClick: () => uiSet('page', page + 1),
                  }, h('span', { className: 'kbmp-chev' }, Ic('chevron', 14))))
              : null))
      }

      // ── le panneau Kybernos : UN seul bloc, au-dessus du natif ──────────
      // Il siège `settings.models.header` : la page Réglages → Models garde sa
      // liste de fournisseurs native intacte en dessous, et le catalogue
      // Kybernos vit au-dessus d'elle, dans ce bloc unique (onglets, liste,
      // pagination). L'ancien doublon — un bloc d'appel en tête ET un panneau
      // re-titré « Models » en pied — est fondu ici : un seul titre.
      // ── la carte Kybernos Cloud (settings.models.header) ────────────────
      // La refonte du 2026-09-21 suit la maquette : une carte de marque bleu
      // nuit au-dessus des rangées natives — logo K, nom, badge « Recommended »,
      // grand titre, pitch, trois acquis cochés, et à droite le CTA blanc
      // « Connect to Kybernos Cloud », le séparateur « or », puis
      // « Add your API key ». Deux états :
      //   · découvert  — la maquette au mot près (titre « Start for free ») ;
      //   · couplé     — le même gabarit, mais le compte de modèles est celui
      //                  qui vit RÉELLEMENT dans settings.yaml (route kybernos),
      //                  un badge « Connected » s'ajoute et le CTA devient
      //                  « Manage Kybernos Cloud ».
      // La carte n'écrit RIEN : elle lit /kybernos-cloud/status (same-origin,
      // lecture seule) et délègue le couplage au plugin kybernos-cloud via
      // l'événement fenêtre `kybernos-cloud:open` ; « Add your API key » ouvre
      // le flux natif « Add provider » de la page, qui reste le seul chemin
      // vers une clé personnelle. En mode figé (?kybernos-models=sample),
      // aucune lecture réseau : la carte rend l'état découvert de la maquette.
      const HERO_MODELS_FALLBACK = 19 // la maquette : « 19 curated models » (le catalogue de la formule gratuite)
      const kbmHeroModels = () => KBM.models.filter((mo) => mo.route === 'kybernos')
      const KybernosHero = () => {
        kbmUse()
        const mine = KBM.live === true ? kbmHeroModels() : []
        const [cloud, setCloud] = React.useState(null) // null = inconnu · false = déconnecté · true = couplé
        React.useEffect(() => {
          if (KBM.live !== true) return undefined
          let mort = false
          fetch('/kybernos-cloud/status', { headers: { 'content-type': 'application/json' } })
            .then((r) => r.json())
            .then((res) => { if (mort !== true) setCloud(res !== null && typeof res === 'object' && res.connected === true) })
            .catch(() => {})
          return () => { mort = true }
        }, [])
        const connecte = cloud === true
        const n = mine.length > 0 ? mine.length : HERO_MODELS_FALLBACK
        const ouvrirCloud = () => {
          try { window.dispatchEvent(new CustomEvent('kybernos-cloud:open')) } catch (e) { /* carte cloud non montée */ }
        }
        const ajouterCle = () => {
          // Le bouton natif « Add provider » vit dans la même section, sous les
          // rangées : la carte passe d'abord sur l'onglet Providers (qui seul
          // montre l'UX natif), puis clique — un seul chemin d'écriture.
          uiSet('tab', 'providers')
          const btn = Array.from(document.querySelectorAll('button'))
            .filter((b) => /^add provider$/i.test((b.innerText || '').trim()))[0]
          if (btn) btn.click()
        }
        return h('div', { className: 'kbmh-hero', 'data-kbmh': 'block' },
          h('div', { className: 'kbmh-hero-main' },
            h('div', { className: 'kbmh-hero-brand' },
              h('span', { className: 'kbmh-hero-logo', 'aria-hidden': 'true' }, 'K'),
              h('span', { className: 'kbmh-hero-name' }, 'Kybernos Cloud'),
              h('span', { className: 'kbmh-hero-pill', 'data-kbmh': 'badge' }, m('kb.hero.badge')),
              connecte === true
                ? h('span', { className: 'kbmh-hero-pill kbmh-hero-pill-on', 'data-kbmh': 'badge-on' },
                  h('span', { className: 'kbmh-hero-pill-dot', 'aria-hidden': 'true' }), m('kb.hero.connected'))
                : null),
            h('div', { className: 'kbmh-hero-title', 'data-kbmh': 'title' },
              connecte === true ? m('kb.hero.title.in', { n }) : m('kb.hero.title.free')),
            h('div', { className: 'kbmh-hero-pitch', 'data-kbmh': 'pitch' },
              connecte === true ? m('kb.hero.pitch.in') : m('kb.hero.pitch.free')),
            h('div', { className: 'kbmh-hero-feats', 'data-kbmh': 'feats' },
              h('span', { className: 'kbmh-hero-feat', title: m('kb.hero.f.fallback.tip') },
                h('span', { className: 'kbmh-hero-feat-i' }, Ic('check', 14)), m('kb.hero.f.fallback')),
              h('span', { className: 'kbmh-hero-feat', title: m('kb.hero.f.guard.tip') },
                h('span', { className: 'kbmh-hero-feat-i' }, Ic('check', 14)), m('kb.hero.f.guard'))),
            KBM.live === true && KBM.loadError !== null
              ? h('div', { className: 'kbm-warn', 'data-kbmh': 'loaderror' },
                m('kb.models.loaderror') + ' : ' + String(KBM.loadError))
              : null),
          h('div', { className: 'kbmh-hero-cta' },
            h('button', {
              type: 'button', className: 'kbmh-hero-btn', 'data-kbmh': 'connect',
              title: m('kb.hero.connect.tip'), onClick: ouvrirCloud,
            },
              h('span', { className: 'kbmh-hero-btn-i' }, Ic(connecte === true ? 'cloud' : 'arrowright', 15)),
              h('span', null, connecte === true ? m('kb.hero.manage') : m('kb.hero.connect'))),
            h('div', { className: 'kbmh-hero-or', 'aria-hidden': 'true' },
              h('span', { className: 'kbmh-hero-or-line' }),
              h('span', { className: 'kbmh-hero-or-txt' }, m('kb.hero.or')),
              h('span', { className: 'kbmh-hero-or-line' })),
            h('button', {
              type: 'button', className: 'kbmh-hero-btn kbmh-hero-btn-ghost', 'data-kbmh': 'addkey',
              title: m('kb.hero.addkey.tip'), onClick: ajouterCle,
            },
              h('span', { className: 'kbmh-hero-btn-i' }, Ic('key', 15)),
              h('span', null, m('kb.hero.addkey')))))
      }

      // ── le marqueur d'ordre de la rangée kybernos (siège provider-card) ──
      // Le siège est rendu dans CHAQUE carte de fournisseur (aussi dans le
      // brouillon d'ajout, dont la route n'existe pas encore) : on ne marque
      // que la rangée kybernos réellement configurée. Rien de visible — la
      // rangée garde son apparence native, le CSS fait le reste.
      const RowMark = (props) => {
        const p = props || {}
        const entry = p.provider
        const id = entry !== undefined && entry !== null ? entry.provider : null
        if (id !== 'kybernos' || p.configured !== true) return null
        return h('span', { className: 'kbm-rowmark', hidden: true, 'aria-hidden': 'true' })
      }

      const Panel = () => {
        kbmUse()
        const counts = kbmCounts()
        // L'attribut de section pilote l'affichage des deux contenus (CSS
        // ci-dessous) : Providers → l'UX natif de DSH ; Models → le catalogue.
        // Au démontage l'attribut saute : les rangées natives reviennent.
        React.useEffect(() => {
          const rootEl = document.querySelector('[data-slot="kybernos-models-header"]')
          const sec = rootEl !== null ? rootEl.closest('[data-slot="settings.section"]') : null
          if (sec === null) return undefined
          sec.setAttribute('data-kbm-tab', UI.tab === 'providers' ? 'providers' : 'models')
          return () => { sec.removeAttribute('data-kbm-tab') }
        })
        React.useEffect(() => {
          const fermerMenu = () => { if (UI.menu !== null) { UI.menu = null; kbmNotify() } }
          const touche = (ev) => {
            if (ev.key !== 'Escape') return
            if (UI.menu !== null) { UI.menu = null; kbmNotify(); return }
            let ferme = false
            for (const mo of KBM.models) if (mo.open === true) { mo.open = false; ferme = true }
            if (ferme === true) kbmNotify()
          }
          document.addEventListener('click', fermerMenu)
          document.addEventListener('keydown', touche)
          return () => {
            document.removeEventListener('click', fermerMenu)
            document.removeEventListener('keydown', touche)
          }
        }, [])
        return h('div', { className: 'kbm-root kbmp', 'data-slot': 'kybernos-models-header' },
          KybernosHero(),
          KBM.live === true && KBM.loading === true ? h('div', { className: 'kbmp-vide', 'data-kbm': 'loading' }, m('kb.models.loading')) : null,
          KBM.live === true && KBM.loadError !== null ? h('div', { className: 'kbm-warn', 'data-kbm': 'loaderror' },
            m('kb.models.loaderror') + ' : ' + String(KBM.loadError),
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'reload', onClick: () => { kbMLoad() } }, m('kb.models.reload'))) : null,
          // Deux onglets, un seul contenu visible à la fois :
          //  · « Providers » montre l'UX NATIF de DSH (les rangées avec
          //    Edit/Delete sous notre panneau) — l'attribut data-kbm-tab
          //    posé sur la section révèle la liste et masque le catalogue ;
          //  · « Models » (notre création) montre le catalogue détaillé et
          //    masque les rangées natives, une à la fois, jamais deux listes.
          h('div', { className: 'kbmp-tabs', role: 'tablist', 'data-kbm': 'tabs' },
            h('button', {
              type: 'button', role: 'tab', 'data-kbm': 'tab-providers',
              'aria-selected': UI.tab === 'providers',
              className: 'kbm-pill' + (UI.tab === 'providers' ? ' kbm-pill-active' : ' kbm-pill-interactive'),
              onClick: () => uiSet('tab', 'providers'),
            }, m('kb.models.tab.providers', { n: KBM.routes.length + (KBM.hasDeepseek === true ? 1 : 0) })),
            h('button', {
              type: 'button', role: 'tab', 'data-kbm': 'tab-models',
              'aria-selected': UI.tab !== 'providers',
              className: 'kbm-pill' + (UI.tab !== 'providers' ? ' kbm-pill-active' : ' kbm-pill-interactive'),
              onClick: () => uiSet('tab', 'models'),
            }, m('kb.models.tab.models', { n: KBM.models.length }))),
          // Le catalogue de modèles (description, état « Live data », Restore defaults,
          // Fetch available models) ne concerne que l'onglet Models : il vit sous les onglets.
          UI.tab !== 'providers' ? (
          h('div', { className: 'kbm-head' },
            h('div', { className: 'kbm-headleft' },
              h('div', { className: 'kbm-sub', 'data-kbm': 'sub' }, m('kb.models.sub')),
              h('div', {
                className: 'kbm-phase' + (KBM.live === true ? ' live' : ''),
                'data-kbm': 'phase',
                title: m('kb.models.mark.wire') + ' · ' + m('kb.models.mark.note'),
              }, KBM.live === true ? m('kb.models.phase.live') : m('kb.models.phase.sample')),
              KBM.live === true && KBM.writable === false ? h('div', { className: 'kbm-warn', 'data-kbm': 'readonly' }, m('kb.models.readonly')) : null),
            h('div', { className: 'kbm-acts' },
              h('button', {
                type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline' + (KBM.confirmRestore === true ? ' kbmp-armed' : ''),
                'data-kbm': 'restore', onClick: kbmRestoreAll,
              }, Ic('undo', 14), h('span', null, KBM.confirmRestore === true ? m('kb.models.restore.arm') : m('kb.models.restore'))),
              h('button', {
                type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'fetch',
                onClick: () => { for (const mo of KBM.models) kbmSync(mo.key) },
              }, Ic('download', 14), h('span', null, m('kb.models.fetch')))))
          ) : null,
          UI.tab !== 'providers' ? (
          KBM.restoredNote !== null && KBM.restoredNote !== undefined
            ? h('div', { className: 'kbmp-note', 'data-kbm': 'restored' }, m('kb.models.restore.note') + String(KBM.restoredNote))
            : null
          ) : null,
          // Un seul contenu visible a la fois : la liste des fournisseurs sur
          // l'onglet Providers, le catalogue detaille sur l'onglet Models.
          UI.tab === 'providers' ? h(ProviderList, null) : h(ListView, null)
        )
      }

      // ── CSS du panneau : la mise en page de la maquette, dans les jetons du
      //    thème. Les CONTRÔLES viennent du CSS de DSH ci-dessus (mêmes règles
      //    que la maquette) : ici, il n'y a que la grille et les espacements.
      const CSS_PANEL = [
        '.kbm-root.kbmp{container-type:inline-size;margin:0 0 26px;padding:0 0 26px;border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:14px}',
        '.kbmp [hidden]{display:none!important}',
        // ── en-tête du panneau : sous-titre + état + actions sur une ligne ───
        '.kbm-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}',
        '.kbm-headleft{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}',
        '.kbm-sub{font-size:12.5px;color:var(--dsw-alias-label-tertiary);max-width:62ch}',
        // En-tête de page (gabarit Réglages 02/10) : titre 18/600, sous-titre 13 à 6 px, bloc suivant à 20 px.
        '.kbm-page{box-sizing:border-box;width:100%;max-width:720px}',
        '.kbm-h1{margin:0;font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
        '.kbm-pagehead{margin:0 0 20px}',
        '.kbm-pagehead .kbm-sub{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:none}',
        "[data-slot=\"settings.section\"]:has(.kbm-page){width:100%;max-width:none}",
        '.kbm-phase{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.kbm-phase.live{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
        '.kbm-phase.live::before{content:"";width:5px;height:5px;border-radius:999px;background:currentColor}',
        '.kbm-warn{margin-top:8px;font-size:12px;color:var(--dsw-alias-state-warn-primary)}',
        '.kbm-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.kbmp-armed{border-color:var(--dsw-alias-state-warn-primary)!important;color:var(--dsw-alias-state-warn-primary)}',
        '.kbmp-tabs{display:flex;gap:8px;align-items:center}',
        '.kbmp-tabs .kbm-pill{height:28px;padding:0 12px;font-size:13px;cursor:pointer}',
        '.kbmp-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:8px}',
        '.kbmp-vide{color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-pager{display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:.5px solid var(--dsw-alias-border-l1)}',
        '.kbmp-pageinfo{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-right:auto}',
        '.kbmp-pagenum{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:44px;text-align:center}',
        '.kbmp-empty{padding:22px 12px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
        // ── liste des fournisseurs (onglet Providers) ────────────────────────
        /* cartes fournisseurs : grille 2 colonnes, logo + nom + compteur + voir */
        '.kbmp-logo{display:inline-flex;border-radius:5px}',
        '.kbmp-logo-chip{align-items:center;justify-content:center;border-radius:7px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-weight:600;line-height:1}',
        '.kbmp-prov-addct{margin-top:10px}',
        '[data-kb-native-nav]{display:none!important}',
        '.kbpv{display:flex;flex-direction:column;gap:10px}',
        '.kbpv-head{display:flex;align-items:center;gap:8px}',
        '.kbpv-grow{flex:1}',
        '.kbpv-menuwrap{position:relative}',
        '.kbpv-ib{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;border-radius:50%;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
        '.kbpv-ib:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.kbpv-ib:disabled{opacity:.35;cursor:not-allowed}',
        '.kbpv-ib-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}',
        '.kbpv-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}',
        '.kbpv-card{position:relative;display:flex;align-items:center;gap:12px;padding:12px 14px;min-height:64px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2)}',
        '.kbpv-card:hover,.kbpv-card:focus-within{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3)}',
        '.kbpv-off{opacity:.62}',
        '.kbpv-off:hover{opacity:.92}',
        '.kbpv-logo{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
        '.kbpv-cbody{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}',
        '.kbpv-cbody .kbmp-free{position:relative;z-index:1;align-self:flex-start;margin-top:3px}',
        '.kbpv-nm{display:flex;align-items:center;min-width:0;font-family:ui-monospace,monospace;font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.kbpv-link{all:unset;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-link::after{content:"";position:absolute;inset:0;border-radius:14px}',
        '.kbpv-link:focus-visible::after{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
        '.kbpv-static{cursor:default}',
        '.kbpv-static::after{display:none}',
        '.kbpv-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-tag{font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
        '.kbpv-tag-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
        '.kbpv-kd{flex:none;width:7px;height:7px;border-radius:50%;margin-left:8px;background:var(--dsw-alias-state-success-primary)}',
        '.kbpv-kd-missing{background:var(--dsw-alias-state-error-primary)}',
        '.kbpv-kd-unknown{background:var(--dsw-alias-border-l4)}',
        '.kbpv-right{display:grid;flex:none;align-items:center;justify-items:end}',
        '.kbpv-right>*{grid-area:1/1}',
        '.kbpv-rest{display:flex;gap:6px;align-items:center;opacity:1;transition:opacity .12s}',
        '.kbpv-card:hover .kbpv-rest,.kbpv-card:focus-within .kbpv-rest{opacity:0;pointer-events:none}',
        '.kbpv-acts{display:flex;align-items:center;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s;position:relative;z-index:1}',
        '.kbpv-card:hover .kbpv-acts,.kbpv-card:focus-within .kbpv-acts,.kbpv-acts:focus-within{opacity:1;pointer-events:auto}',
        '@media (hover:none){.kbpv-acts{opacity:1;pointer-events:auto}.kbpv-rest{display:none}}',
        '@media (prefers-reduced-motion:reduce){.kbpv-acts,.kbpv-rest{transition:none}}',
        '.kbpv-sw{position:relative;flex:none;width:34px;height:20px;margin-inline:4px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:background .15s}',
        '.kbpv-sw.on{background:var(--dsw-alias-brand-primary);border-color:transparent}',
        '.kbpv-sw:disabled{opacity:.45;cursor:not-allowed}',
        '.kbpv-sw:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.kbpv-sw-k{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s,background .15s}',
        '.kbpv-sw.on .kbpv-sw-k{transform:translateX(14px);background:var(--dsw-alias-label-primary-foreground)}',
        '.kbpv-menu{position:absolute;z-index:20;right:10px;top:46px;min-width:190px;padding:4px;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.3)}',
        '.kbpv-menu-head{right:0;top:36px}',
        '.kbpv-menu button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;text-align:left;padding:7px 10px;border-radius:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
        '.kbpv-menu button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbpv-menu button:disabled{opacity:.4;cursor:not-allowed}',
        '.kbpv-menu hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2);margin:4px 0}',
        '.kbpv-danger{color:var(--dsw-alias-state-error-primary)!important}',
        '.kbpv-danger-fill{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);border:0}',
        '.kbpv-danger-fill:disabled{opacity:.4;cursor:not-allowed}',
        '.kbpv-note{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 14px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);font-size:13px}',
        '.kbpv-fail{padding:8px 12px;border-radius:12px;border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:13px}',
        '.kbpv-hostnote{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-layer{position:fixed;inset:0;z-index:60}',
        '.kbpv-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1)}',
        '.kbpv-drawer{position:absolute;top:0;right:0;bottom:0;width:min(460px,100%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-left:.5px solid var(--dsw-alias-border-l3)}',
        '.kbpv-drawer header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-dh{display:flex;align-items:center;gap:12px;min-width:0}',
        '.kbpv-dt{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-body{flex:1;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:16px}',
        '.kbpv-drawer footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 16px;border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-fld{display:flex;flex-direction:column;gap:6px}',
        '.kbpv-fl{font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}',
        '.kbpv-err{font-size:12px;color:var(--dsw-alias-state-error-primary)}',
        '.kbpv-in{width:100%;min-height:36px;padding:0 12px;border-radius:12px}',
        '.kbm-in-input.kbpv-in{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
        '.kbm-in-input.kbpv-in:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
        '.kbpv-mono{font-family:ui-monospace,monospace;font-size:13px}',
        '.kbpv-keyrow{display:flex;gap:6px}',
        '.kbpv-keyrow .kbpv-in{flex:1}',
        '.kbpv-adv{display:flex;align-items:center;gap:6px;width:100%;border:0;border-top:.5px solid var(--dsw-alias-border-l2);background:transparent;padding:10px 0 4px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.kbpv-adv svg{transition:transform .15s}',
        '.kbpv-adv[aria-expanded="true"] svg{transform:rotate(90deg)}',
        '.kbpv-advbox{display:flex;flex-direction:column;gap:14px}',
        '.kbpv-mhead{display:flex;justify-content:space-between;align-items:center}',
        '.kbpv-mrows{display:flex;flex-direction:column;gap:8px}',
        '.kbpv-mrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 30px;gap:6px;align-items:center}',
        '.kbpv-zone{margin-top:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px}',
        '.kbpv-z{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px}',
        '.kbpv-z+.kbpv-z{border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-z b{display:block;font-weight:500}',
        '.kbpv-z span{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-tabs{display:inline-flex;align-self:flex-start;padding:3px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-tab{border:0;background:transparent;padding:6px 12px;border-radius:9px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.kbpv-tab-on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3)}',
        '.kbpv-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-cb{position:relative}',
        '.kbpv-cb-btn{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:6px 12px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);text-align:left;cursor:pointer}',
        '.kbpv-cb-btn[aria-expanded="true"]{border-color:var(--dsw-alias-border-l4)}',
        '.kbpv-cb-val{flex:1;min-width:0;display:flex;align-items:center;gap:10px}',
        '.kbpv-cb-ph{flex:1;color:var(--dsw-alias-label-tertiary);font-size:14px}',
        '.kbpv-cb-chev{display:inline-flex;transform:rotate(90deg);color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-cb-pop{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:25;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.4)}',
        '.kbpv-cb-q{display:flex;align-items:center;gap:8px;padding:0 12px;height:42px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-cb-liste{max-height:330px;overflow:auto;padding:4px}',
        '.kbpv-cb-grp{padding:8px 10px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-opt{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:10px;cursor:pointer}',
        '.kbpv-opt-act,.kbpv-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbpv-opt-deja{opacity:.5;cursor:default}',
        '.kbpv-opt-c{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.kbpv-opt-n{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-opt-e{font:11px/16px ui-monospace,monospace;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-opt-deja .kbpv-opt-e{font-family:inherit}',
        '.kbpv-cb-none{display:block;padding:18px 12px;font-size:13px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-cb-note{padding:8px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-pinfo{display:flex;align-items:center;gap:12px;margin-top:8px;padding:10px 12px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-pinfo-c{min-width:0;display:flex;flex-direction:column;gap:2px}',
        '.kbpv-pinfo-n{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:500}',
        '.kbpv-pinfo-h{font:12px/16px ui-monospace,monospace;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-pinfo-warn{font-family:inherit;color:var(--dsw-alias-state-warn-primary)}',
        '.kbpv-native{margin:16px 0 0;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:8px}',
        '.kbpv-native-t{font-weight:600;font-size:14px}',
        '.kbpv-native p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-native-act{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}',
        '.kbpv-native-chk{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        /* disabled providers: greyed card + switch (the same pill as the Suite's) */
        '.kbmp-off-dlg{max-width:440px}',
        '.kbmp-off-dlg .kbm-mdl-body{margin-top:0}',
        '.kbmp-off-dlg-body p{margin:0 0 16px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary)}',
        '.kbmp-off-dlg-act{display:flex;justify-content:flex-end;gap:8px}',
        /* formulaire d'ajout de fournisseur */
        // ── sélecteur de presets + badge « free models · quota » (02/10) ─────
        '.kbmp-free{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:9px;font-size:10.5px;line-height:14px;font-weight:600;color:#0b7a3b;background:rgba(34,197,94,.16);white-space:nowrap}',
        '.kbmp-free-sm{height:16px;padding:0 6px;font-size:10px}',
        '.kbmp-free-lien{color:inherit;text-decoration:none;font-weight:700}',
        '.kbmp-free-lien:hover{text-decoration:underline}',
        '[dir="rtl"] .kbmp-free{direction:ltr}',
        '@keyframes kbmpIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
        '.kbm-in-input.kbmp-form-in{flex:0 0 auto;width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px;transition:border-color .12s,box-shadow .12s}',
        '.kbm-in-input.kbmp-form-in:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '.kbm-in-input.kbmp-form-in:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}',
        '.kbm-in-input.kbmp-form-in::placeholder{color:var(--dsw-alias-label-tertiary);opacity:.75}',
        '.kbm-in-input.kbmp-in-err{border-color:var(--dsw-alias-state-error-primary)}',
        '.kbmp-logo-mask{display:inline-block;flex:none;background-color:currentColor;color:var(--dsw-alias-label-primary);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}',
        '.kbmp-tuile{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);box-sizing:border-box}',
        '.kbmp-tuile-init{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
        '.kbmp-card-logo .kbmp-logo-mask{color:var(--dsw-alias-label-primary)}',
        /* logo dans la ligne de modèle */
        '.kbmp-mcellroute{display:inline-flex;align-items:center;gap:5px;min-width:0}',
        // ── les deux onglets, un contenu chacun ─────────────────────────────
        // Providers (défaut) : l'UX natif de DSH — les rangées sous notre
        // panneau restent la seule interface qui écrit clé et URL de base.
        // Models : notre catalogue, et les rangées natives se retirent —
        // jamais deux listes visibles en même temps.
        '[data-slot="settings.section"][data-kbm-tab="providers"] .kbmp-listwrap{display:none}',
        '[data-slot="settings.section"][data-kbm-tab="models"] ul{display:none}',
        // ── liste Models : recherche, quatre filtres, puces, table ──────────
        '.kbmp-listwrap{display:flex;flex-direction:column;gap:10px}',
        '.kbmp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.kbmp-search{flex:1 1 240px;min-width:200px}',
        '.kbmp-loupe{flex:none;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-search .kbm-in-input::-webkit-search-cancel-button{display:none}',
        '.kbmp-menus{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
        '.kbmp-menu{position:relative}',
        '.kbmp-trig{gap:5px;white-space:nowrap;padding:0 10px;font-size:12.5px}',
        '.kbmp-triglab{color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-trigval{color:var(--dsw-alias-label-secondary);font-weight:500;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbmp-trig.on{border-color:var(--dsw-alias-state-business-primary)}',
        '.kbmp-trig.on .kbmp-triglab,.kbmp-trig.on .kbmp-trigval,.kbmp-trig.on .kbmp-trigchev{color:var(--dsw-alias-state-business-primary)}',
        '.kbmp-trigchev{display:inline-flex;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:60;min-width:200px;max-height:320px;overflow:auto;padding:4px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.28)}',
        '.kbmp-pop .kbm-menu-item{display:flex;width:100%;align-items:center;gap:8px;padding:7px 9px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:left;cursor:pointer}',
        '.kbmp-pop .kbm-menu-item:hover{background:var(--dsw-alias-bg-layer-3)}',
        '.kbmp-pop .kbm-menu-selected{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}',
        '.kbmp-capsbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
        '.kbmp-caps{display:flex;gap:6px;flex-wrap:wrap;min-width:0}',
        // Des puces ICÔNE + LIBELLÉ : huit rondelles muettes ne disaient pas
        // ce qu'elles filtraient.
        '.kbmp-cap{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
        '.kbmp-cap:hover{border-color:var(--dsw-alias-border-l3)}',
        '.kbmp-cap .kbmp-capi{display:inline-flex}',
        '.kbmp-cap.on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}',
        '.kbmp-cap.on .kbmp-capi{color:currentColor!important}',
        '.kbmp-compteur{margin-left:auto;display:flex;align-items:center;gap:8px}',
        '.kbmp-compteur [data-kbm="count"]{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-reset{color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-reset:disabled{opacity:.45;cursor:default}',
        // La table du panneau vit dans une colonne de 556 ou 720 px (la boîte
        // Réglages) : cinq colonnes, dont une seule se partage la place. Le
        // modèle porte nom + « id · route · type · prix » — plus aucune
        // colonne vide, plus aucun nom tronqué.
        '.kbmp-table{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
        '.kbmp-thead,.kbmp-cols{display:grid;grid-template-columns:minmax(0,1fr) 52px 84px 44px;gap:8px;align-items:center;padding:0 10px}',
        '.kbmp-thead .kbmp-c-caps,.kbmp-cols .kbmp-ccaps{display:none}',
        '.kbmp-mcaps{display:inline-flex;align-items:center;gap:5px;flex:none}',
        '@container (min-width: 620px){.kbmp-thead,.kbmp-cols{grid-template-columns:minmax(0,1fr) 88px 58px 104px 46px}.kbmp-thead .kbmp-c-caps,.kbmp-cols .kbmp-ccaps{display:flex}.kbmp-mcaps{display:none}.kbmp-mtype,.kbmp-mprix{display:inline-flex;align-items:center;gap:4px}}',
        '.kbmp-mtype,.kbmp-mprix{display:none}',
        // Les deux actions de la ligne : une zone de 24 px, alignées SUR la
        // même ligne (la règle `.kbmp-c{flex-direction:column}` passerait
        // sinon devant un simple `.kbmp-cact`).
        '.kbmp-c.kbmp-cact{flex-direction:row;align-items:center;justify-content:flex-end;gap:2px;opacity:.55}',
        '.kbmp-c.kbmp-cact .kbm-btn{width:24px;height:24px;padding:0;border-radius:8px}',
        '.kbmp-thead{height:32px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:10px;letter-spacing:.03em;color:var(--dsw-alias-label-tertiary)}',        '.kbmp-th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmp-lig{border-bottom:.5px solid var(--dsw-alias-border-l1)}',
        '.kbmp-lig:last-child{border-bottom:none}',
        '.kbmp-lig .kbmp-cols{min-height:40px;padding-top:6px;padding-bottom:6px}',
        '.kbmp-lig:hover .kbmp-cols{background:var(--dsw-alias-bg-layer-3)}',
        '.kbmp-lig.open .kbmp-cols{background:var(--dsw-alias-bg-layer-3)}',
        '.kbmp-lig:hover .kbmp-cact,.kbmp-lig:focus-within .kbmp-cact,.kbmp-lig.open .kbmp-cact{opacity:1}',
        '.kbmp-c{min-width:0;display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
        '.kbmp-cmodel{gap:2px}',
        '.kbmp-nameline{display:flex;align-items:center;gap:6px;min-width:0}',
        '.kbmp-cmodel .kbmp-nom{height:20px;padding:0}',
        '.kbmp-nom{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        // À 556 px, le nom le plus long du catalogue (249 px) ne tenait qu'à 1 px près :
        // sous 620 px il passe à 12,5 px, et garde sa place quoi qu'il arrive.
        '@container (max-width: 619px){.kbmp-nom{font-size:12.5px}}',
        // La ligne de contexte du modèle : id (mono), route, type, prix.
        '.kbmp-metaline{display:flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        // `field-sizing` (Chrome 123+) : le champ prend la largeur de son id
        // au lieu d'une taille fixe qui coupait « anthropic/claude-sonnet ».
        '.kbmp-id{flex:0 1 auto;min-width:0;max-width:100%;field-sizing:content;height:16px;line-height:16px;padding:0;font-size:11.5px!important;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code)}',
        '.kbmp-id[readonly]{cursor:default}',
        '.kbmp-msep{flex:none;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-mroute{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);max-width:40%}',
        '.kbmp-mtype,.kbmp-mprix{flex:none;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-tyi{display:inline-flex}',
        '.kbmp-caprow{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}',
        '.kbmp-capi{display:inline-flex}',
        '.kbmp-plus{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-txtonly{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-cctx{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmp-csrc{gap:3px}',
        '.kbmp-sy{display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmp-point{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-tertiary);flex:none}',
        '.kbmp-sy.ok .kbmp-point{background:var(--dsw-alias-state-success-primary)}',
        '.kbmp-sy.wait .kbmp-point{background:var(--dsw-alias-state-business-primary)}',
        // La surcharge se dit sur la ligne du nom : elle décrit le modèle, pas
        // la source, et la phrase entière (« 5 overrides · 0 applied ») ne
        // tenait pas dans la colonne SOURCE.
        // La pastille des surcharges : discrète (bordure ambrée, pas de
        // remplissage) — 69 modèles importés en portent presque tous, un
        // aplat orange sur chaque ligne criait plus fort que la table.
        '.kbmp-ovpill{display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:999px;flex:none;border:.5px solid var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-primary);font-size:10.5px;font-weight:500;white-space:nowrap;opacity:.85}',
        // ── l'infobulle du kit : placée au-dessus de l'ancre, révélée au
        //    survol et au focus clavier ; le style visuel vient de
        //    .kbm-tip-bubble (kit DSH), ici on ne règle que la place.
        '.kbm-tipwrap{position:relative;display:inline-flex;max-width:100%}',
        '.kbm-tip{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:90;pointer-events:none;opacity:0;transition:opacity 120ms ease;width:max-content;max-width:min(320px,72vw);white-space:normal;text-align:left}',
        '.kbm-tipwrap:hover .kbm-tip,.kbm-tipwrap:focus-within .kbm-tip{opacity:1}',
        '.kbmp-lig .kbm-tipwrap{line-height:0}',
        '.kbmp-avis{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmp-chev{display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
        '.kbmp-chev.open{transform:rotate(90deg)}',
        '.kbmp-danger{color:var(--dsw-alias-state-error-primary)}',
        '.kbmp-err{margin:0 12px 8px;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
        // Lignes du catalogue DANS une carte fournisseur : le modèle et sa
        // ligne de contexte suffisent, l'en-tête de la carte dit la route.
        // DEUX colonnes (modèle + actions) : une seule ferait passer les
        // actions sur un second rang implicite, deux fois plus haut pour rien.
        '.kbmp-lig.compact .kbmp-cols{grid-template-columns:minmax(0,1fr) 52px;min-height:36px;padding:4px 8px}',
        '.kbmp-lig.compact .kbmp-ccaps,.kbmp-lig.compact .kbmp-cctx,.kbmp-lig.compact .kbmp-csrc{display:none}',
        '.kbmp-lig.compact .kbmp-mroute,.kbmp-lig.compact .kbmp-msep{display:none}',
        '.kbmp-lig.compact .kbmp-cact{opacity:1}',
        '.kbmp-mdl{width:min(780px,100%)!important;max-height:min(86vh,900px)}',
        '.kbmp-mdlhead{min-width:0}',
        '.kbmp-mdlsub{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code)}',
        '.kbmp-x{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:17px;line-height:1;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-mdlbody{overflow:auto}',
        '.kbm-foot{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.kbm-it{display:inline-flex;align-items:center;gap:6px}',
        '.kbm-foot [data-kbm="add"]{margin-left:auto}',
        '.kbm-mark{display:inline-flex}',
        '.kbm-mark.wire{color:var(--dsw-alias-state-business-primary)}',
        '.kbm-mark:not(.wire){color:var(--dsw-alias-label-tertiary)}',
        '.kbm-contract.ko{color:var(--dsw-alias-state-error-primary)}',
        '.kbm-dot{width:7px;height:7px;border-radius:999px;flex:none;display:inline-block}',
        '.kbm-dot.sync{background:var(--dsw-alias-state-business-primary)}',
        '.kbm-dot.ov{background:var(--dsw-alias-state-warn-primary)}',
        // Puces icône-seule : le libellé vit dans le title/aria-label du
        // bouton, la pastille et le maillon complètent l'état. Largeur fixe
        // (icône seule) : quatorze capacités tiennent sur une ligne de moins.
        '.kbm-chip{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:30px;min-width:34px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer}',
        '.kbm-chip:hover{border-color:var(--dsw-alias-border-l3)}',
        '.kbm-chip.on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}',
        '.kbm-chip .kbm-ico{display:inline-flex;align-items:center}',
        '.kbm-chip.on .kbm-mark{color:currentColor}',
        '.kbm-chip.on .kbm-dot{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}',
        '.kbm-sec{display:flex;flex-direction:column;gap:9px}',
        '.kbm-seclab{display:flex;align-items:baseline;gap:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.kbm-sechint{font-size:11px;font-weight:500;letter-spacing:0;text-transform:none;margin-top:3px}',
        '.kbm-chips{display:flex;flex-wrap:wrap;gap:8px}',
        '.kbm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:12px}',
        '.kbm-grid.wide{grid-template-columns:repeat(auto-fit,minmax(158px,1fr))}',
        // Les noms de classes sont ceux du composant Field : ne pas les réinventer.
        '.kbm-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
        '.kbm-fieldhead{display:flex;align-items:center;justify-content:space-between;gap:8px}',
        '.kbm-flabel{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}',
        '.kbm-flabel label{cursor:pointer}',
        '.kbm-revert{display:inline-flex;border:none;background:transparent;color:var(--dsw-alias-state-warn-primary);cursor:pointer;padding:0}',
        '.kbm-fbody{display:flex;align-items:center;gap:6px;height:32px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
        '.kbm-fbody:focus-within{border-color:var(--dsw-alias-state-business-primary)}',
        '.kbm-fbody:has(.kbm-finput.ov){border-color:var(--dsw-alias-state-warn-primary)}',
        '.kbm-finput{flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.kbm-finput.ov,.kbm-fbody:has(.kbm-finput.ov) .kbm-suffix{color:var(--dsw-alias-state-warn-primary)}',
        '.kbm-fbody select.kbm-finput{cursor:pointer;appearance:none}',
        '.kbm-suffix{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.kbm-dtitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.kbm-item{position:relative}',
        '.kbm-details{display:flex;flex-direction:column;gap:14px;padding:0 24px 4px}',
        '.kbm-dhead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
        '.kbm-dacts{display:flex;align-items:center;gap:14px}',
        '.kbm-link{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-decoration:none;cursor:pointer;padding:0}',
        '.kbm-link.kbm-primary{color:var(--dsw-alias-state-business-primary)}',
        '.kbm-status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
        '.kbm-statusline{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.kbm-statusline.ok{color:var(--dsw-alias-state-success-primary)}',
        '.kbm-statusline.loading{color:var(--dsw-alias-state-business-primary)}',
        '.kbm-legend{display:inline-flex;gap:12px}',
        '.kbm-legend .kbm-it{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        '.kbm-secs{display:flex;flex-direction:column;gap:16px}',
        '.kbm-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:16px}',
        '.kbm-sep{height:.5px;background:var(--dsw-alias-border-l2)}',
        // ── notes externes : deux cartes de provenance, en lecture seule ─────
        '.kbm-scwrap{display:flex;flex-direction:column;gap:10px;min-width:0}',
        '.kbm-sccards{display:grid;grid-template-columns:repeat(auto-fit,minmax(248px,1fr));gap:10px}',
        '.kbm-sc{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
        '.kbm-sc-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
        '.kbm-sc-src{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);text-decoration:none}',
        '.kbm-sc-src:hover{color:var(--dsw-alias-state-business-primary)}',
        '.kbm-sc-lic{font-size:10.5px;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l3);border-radius:6px;padding:1px 5px;white-space:nowrap}',
        '.kbm-sc-warn{font-size:10.5px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap}',
        '.kbm-sc-date{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap}',
        '.kbm-scmeta .kbm-sc-date{margin-left:0}',
        '.kbm-sc-main{display:flex;align-items:baseline;gap:8px;min-width:0}',
        '.kbm-sc-big{font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:26px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
        '.kbm-sc-big.vide{color:var(--dsw-alias-label-tertiary)}',
        '.kbm-sc-biglab{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0}',
        '.kbm-sc-vals{display:grid;grid-template-columns:1fr;gap:2px 0;min-width:0}',
        '.kbm-sc-it{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}',
        // L'intitulé passe à la ligne au lieu d'être coupé : « Terminal-Bench 4.0 »
        // se tronquait en « Terminal-Bench ... » dans une cellule de ~150 px, et un
        // nom d'épreuve amputé se lit mal. La valeur, elle, ne se coupe jamais.
        '.kbm-sc-l{font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbm-sc-v{font-size:11.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex:none}',
        '.kbm-sc-foot{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:15px}',
        '.kbm-scmeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
        '.kbm-sc-empty{margin:0}',
        '.kbm-wirenote{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        // ── bloc d'en-tête « Kybernos Models » (le siège header de la page) ──
        '.kbm-root.kbmh{margin-top:0;padding-top:0;border-top:none;gap:10px;flex-direction:column}',
        // ── la carte Kybernos Cloud (maquette du 2026-09-21) ────────────────
        // La carte est une carte de MARQUE : son bleu nuit ne suit pas le
        // thème — elle se lit pareil en clair et en sombre, comme un bloc
        // sponsor. Une seule valeur par couleur, documentée ici.
        //   #1F2A4D le bleu nuit · #FFFFFF le blanc des CTA · #EAF0FF/#B9C4DE
        //   les textes clairs · #34C759 le vert des coches et du badge connecté.
        // La colonne CTA reste À DROITE comme sur la maquette : elle est fixe
        // (~248px) et le texte prend le reste — la section fait ~504px utiles,
        // pas 1382 comme le visuel, donc les tailles sont recalibrées.
        '.kbmh-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;background:#1F2A4D;border:.5px solid #2C3A63;border-radius:14px;padding:20px 22px}',
        '.kbmh-hero-main{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1 1 210px}',
        '.kbmh-hero-brand{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.kbmh-hero-logo{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:#FFFFFF;color:#10182B;font-size:16px;font-weight:700;line-height:1;flex:none}',
        '.kbmh-hero-name{font-size:14px;font-weight:600;color:#EAF0FF;white-space:nowrap}',
        '.kbmh-hero-pill{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 9px;border-radius:999px;border:.5px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);font-size:11px;color:#C7D2E8;white-space:nowrap}',
        '.kbmh-hero-pill-dot{width:6px;height:6px;border-radius:999px;background:#34C759;flex:none}',
        '.kbmh-hero-pill-on{border-color:rgba(52,199,89,.45);background:rgba(52,199,89,.16);color:#7CE3A4}',
        '.kbmh-hero-title{font-size:25px;font-weight:700;letter-spacing:-.02em;color:#FFFFFF;line-height:1.16}',
        '.kbmh-hero-pitch{font-size:13px;color:#B9C4DE;line-height:19px;max-width:56ch}',
        '.kbmh-hero-feats{display:flex;align-items:flex-start;flex-direction:column;gap:5px;margin-top:3px}',
        '.kbmh-hero-feat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#EAF0FF}',
        '.kbmh-hero-feat-i{display:inline-flex;color:#34C759;flex:none}',
        '.kbmh-hero-cta{display:flex;flex-direction:column;justify-content:center;gap:8px;flex:0 0 248px;min-width:0}',
        '.kbmh-hero-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:42px;padding:0 14px;border:none;border-radius:10px;background:#FFFFFF;color:#10182B;font-size:13.5px;font-weight:600;line-height:18px;cursor:pointer;font-family:inherit;text-align:center}',
        '.kbmh-hero-btn:hover{background:#E8EDF9}',
        '.kbmh-hero-btn:focus-visible{outline:2px solid #FFFFFF;outline-offset:2px}',
        '.kbmh-hero-btn-ghost{background:transparent;border:.5px solid rgba(255,255,255,.30);color:#FFFFFF}',
        '.kbmh-hero-btn-ghost:hover{background:rgba(255,255,255,.10)}',
        '.kbmh-hero-btn-i{display:inline-flex;flex:none}',
        '.kbmh-hero-or{display:flex;align-items:center;gap:10px}',
        '.kbmh-hero-or-line{flex:1;height:1px;background:rgba(255,255,255,.20)}',
        '.kbmh-hero-or-txt{font-size:11.5px;color:#9FACCB;white-space:nowrap}',
        // ── version compacte (02/10) : une bande de ~70 px au lieu d'un bloc de ~200 px ──
        // Ligne 1 : marque + pastilles ; ligne 2 : titre ; actions à droite, sur une ligne.
        // Le pitch et les deux points forts (Auto-fallback, Guardrails) sont masqués : ils
        // restent dans le DOM (info-bulles des puces, hooks data-kbmh) pour les contrôles.
        '.kbmh-hero{padding:10px 14px;gap:8px 16px;border-radius:12px}',
        '.kbmh-hero-main{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:6px 14px;flex:1 1 300px;min-width:0}',
        '.kbmh-hero-brand{grid-column:1/-1;flex-wrap:nowrap;gap:8px}',
        '.kbmh-hero-logo{width:26px;height:26px;border-radius:7px;font-size:13px}',
        '.kbmh-hero-name{font-size:13.5px}',
        '.kbmh-hero-pill{height:19px;padding:0 8px;font-size:10.5px}',
        '.kbmh-hero-title{grid-column:1;font-size:14px;font-weight:600;letter-spacing:-.005em;line-height:1.3;color:#EAF0FF;white-space:nowrap}',
        '.kbmh-hero-pitch,.kbmh-hero-feats{display:none}',
        '.kbmh-hero-cta{flex-direction:row;align-items:center;flex:0 0 auto;gap:8px}',
        '.kbmh-hero-btn{height:28px;padding:0 10px;font-size:12px;border-radius:8px}',
        '.kbmh-hero-or{display:none}',
        // Étroit : la colonne CTA passe sous le texte et s'étale en ligne.
        '@container (max-width: 520px){.kbmh-hero{flex-direction:column;align-items:stretch;gap:14px;padding:18px}.kbmh-hero-cta{flex-basis:auto}}',
        // ── la rangée « Kybernos Cloud » en tête de la liste native ─────────
        // La liste native (ul du module ModelsSection) est déjà une colonne
        // flex : `order:-1` remonte la rangée marquée sans toucher au DOM ni
        // au cœur DSH. Le marqueur est invisible ; l'outlet du siège rend un
        // ancre `display:contents`, donc `:has()` descendant suffit — seule la
        // rangée kybernos porte .kbm-rowmark.
        '.kbm-rowmark{display:none!important}',
        'li:has(.kbm-rowmark){order:-1}',
        '@media (prefers-reduced-motion: no-preference){.kbmp *{transition:background-color .15s ease,border-color .15s ease,color .15s ease}}',
      ].join('\n')

      // Les contrôles DSH (kbm-*) sont communs à Models et Sessions : un seul <style id="kbm-controls-style"> pour les deux.
      const kbPoseControles = () => {
        if (typeof document === 'undefined' || document.getElementById('kbm-controls-style')) return
        const st = document.createElement('style')
        st.id = 'kbm-controls-style'
        st.textContent = DSH_CONTROLS_CSS
        document.head.appendChild(st)
      }
      const CSS = CSS_PANEL


      // ── phase câblée : un seul point à remplir (étape 2) ──────────────────
      // Aujourd'hui `KBM.live` est faux : l'écran travaille sur le jeu figé et
      // n'écrit rien. À l'étape 2, ces trois fonctions deviennent le seul endroit
      // qui touche le réseau — les composants, eux, ne changent pas.
      //   kbMPersist : champs `wire` → `remote.settings.mutate('llm-pi-ai', …)`,
      //                annotations → POST /kybernos-models/annotations/save ;
      //   kbMLoad    : remplit KBM.models depuis `remote.llm` + `settings.describe` ;
      //   kbMSyncLive: lit GET /kybernos-models/modelsdev?route=…&id=… (index caché).
      // ── Les champs réels : un contrôle → un chemin dans `llm-pi-ai` ───────
      // Ce que le schéma du harnais accepte RÉELLEMENT par modèle :
      //   name: string · contextWindow: int>0 · maxTokens: int>0
      //   input: sous-ensemble de ['text','image'] · reasoningEfforts: false | dict
      //   compat: ~20 commutateurs (pas de contrôle dans la maquette : hors panneau)
      // Un modèle vit sous `models[i]` (route déclarée : elle a une liste `models`)
      // ou sous `modelOverrides.<id>` (route catalogue). Le harnais REFUSE
      // `modelOverrides` à côté d'une liste `models` — d'où les deux chemins.
      const KB_NS = 'llm-pi-ai'
      const KB_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      const kbMNum = (v) => {
        const n = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(/[^0-9.-]/g, ''))
        return Number.isFinite(n) && n > 0 ? Math.round(n) : null
      }
      const kbMFieldOf = (k) => {
        if (k === 'name') return 'name'
        if (k === 'context') return 'contextWindow'
        if (k === 'outputLimit') return 'maxTokens'
        if (k === 'textIn' || k === 'vision') return 'input'
        if (k === 'reasoning') return 'reasoningEfforts'
        return null
      }
      /** Le chemin d'écriture, ou une erreur explicite.
       *  Le service settings ne traverse PAS les tableaux (`path` n'accepte que
       *  des chaînes et un tableau n'est pas un objet) : pour une route déclarée
       *  on réécrit donc la LISTE `models` entière — en repartant de la couche
       *  UTILISATEUR, jamais de la couche résolue (qui matérialiserait les
       *  défauts du schéma, par exemple `input: []`). */
      const kbMOps = (mo, k, del, wire) => {
        const field = kbMFieldOf(k)
        if (field === null) return { error: m('kb.models.error.path') }
        if (mo.kind !== 'declared') {
          const path = ['providers', mo.route, 'modelOverrides', mo.id, field]
          return { path: path.join('/'), ops: [del === true ? { op: 'unset', path } : { op: 'set', path, value: wire }] }
        }
        if (Array.isArray(mo.userModels) !== true) return { error: m('kb.models.error.herite') }
        const index = mo.userModels.findIndex((e) => kbMOBJ(e).id === mo.id)
        if (index < 0) return { error: m('kb.models.error.herite') }
        const list = mo.userModels.map((e) => Object.assign({}, kbMOBJ(e)))
        if (del === true) delete list[index][field]
        else list[index][field] = wire
        return {
          path: 'providers.' + mo.route + '.models[' + String(index) + '].' + field,
          ops: [{ op: 'set', path: ['providers', mo.route, 'models'], value: list }],
        }
      }
      /** La valeur de fil, ou la sentinelle `KB_REFUS` quand la traduction est
       *  impossible (niveaux de raisonnement inconnus) — on refuse au lieu
       *  d'écrire une valeur inventée. */
      const KB_REFUS = Symbol('refus')
      /** Les modalités EFFECTIVES d'une entrée qui n'écrit pas `input` :
       *  celles de la route si elle les déclare, sinon le défaut du harnais
       *  (`llm-pi-ai` : DEFAULT_INPUT = ['text']). Jamais deviné plus loin. */
      const kbMInputBase = (mo) => {
        if (Array.isArray(mo.raw.input)) return mo.raw.input
        if (Array.isArray(mo.defaultInput)) return mo.defaultInput
        return ['text']
      }
      const kbMSameList = (a, b) => {
        const x = a.slice().sort().join(',')
        const y = b.slice().sort().join(',')
        return x === y
      }
      const kbMWireValue = (mo, k, v) => {
        if (k === 'name') return v === '' || v === null || v === undefined ? KB_REFUS : String(v)
        if (k === 'context' || k === 'outputLimit') {
          const n = kbMNum(v)
          return n === null ? KB_REFUS : n
        }
        if (k === 'textIn' || k === 'vision') {
          const cur = kbMInputBase(mo)
          const textOn = k === 'textIn' ? v === true : cur.indexOf('text') >= 0
          const imageOn = k === 'vision' ? v === true : cur.indexOf('image') >= 0
          const out = []
          if (textOn) out.push('text')
          if (imageOn) out.push('image')
          return out
        }
        if (k === 'reasoning') {
          if (v !== true) return false
          const levels = Array.isArray(mo.remote.reasoningLevels) ? mo.remote.reasoningLevels : []
          const dict = {}
          for (const lvl of levels) if (KB_LEVELS.indexOf(lvl) >= 0) dict[lvl] = lvl
          return Object.keys(dict).length === 0 ? KB_REFUS : dict
        }
        return KB_REFUS
      }

      const kbMApi = () => {
        const c = kbCtx
        if (c === null || c === undefined || c.remote === null || c.remote === undefined) return null
        const settings = c.remote.settings === undefined ? null : c.remote.settings
        const llm = c.remote.llm === undefined ? null : c.remote.llm
        const credentials = c.remote.credentials === undefined ? null : c.remote.credentials
        return { settings, llm, credentials }
      }
      const kbMKey = (mo) => (mo.route === '' || mo.id === '' ? null : mo.route + '/' + mo.id)

      /** Les annotations locales : lues au chargement, patchées champ par champ. */
      const kbMAnnotations = async (key, fields) => {
        const url = fields === undefined ? '/kybernos-models/annotations' : '/kybernos-models/annotations/save'
        const res = await fetch(url, fields === undefined ? { headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, fields }) })
        if (res.status !== 200) throw new Error('HTTP ' + String(res.status))
        const body = await res.json()
        if (body === null || body.ok !== true) throw new Error(String(body && body.error ? body.error : 'refus'))
        return body
      }

      /** Le journal local (host) : chaque tentative d'écriture y laisse une
       *  ligne. Best-effort : un journal indisponible ne bloque jamais un geste. */
      const kbMJournal = async (event) => {
        try {
          await fetch('/kybernos-models/journal', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
          })
        } catch (e) { /* journal best-effort */ }
      }
      /** Un service qui ne répond pas ne doit pas laisser le panneau suspendu :
       *  au-delà du délai, on rend la main et l'écran le dit. */
      const kbMTimeout = (promise, ms) => new Promise((resolve) => {
        let done = false
        const timer = setTimeout(() => {
          if (done === true) return
          done = true
          resolve({ ok: false, error: { code: 'timeout', message: 'aucune réponse du service settings en ' + String(ms) + ' ms' } })
        }, ms)
        Promise.resolve(promise).then((v) => {
          if (done === true) return
          done = true
          clearTimeout(timer)
          resolve(v)
        }, (e) => {
          if (done === true) return
          done = true
          clearTimeout(timer)
          resolve({ ok: false, error: { code: 'exception', message: String(e && e.message ? e.message : e) } })
        })
      })

      /** Le contrat host : la liste des champs réels, comparée à la nôtre.
       *  Si les deux divergent, le panneau le DIT au lieu d'afficher un compte
       *  flatteur. */
      const KB_PANEL_FIELDS = ['contextWindow', 'input', 'maxTokens', 'name', 'reasoningEfforts']
      // `compat` est belle et bien inscriptible par le harnais (~20 commutateurs)
      // mais la maquette n'en expose AUCUN contrôle : il est donc « hors
      // panneau », listé ici pour que le contrat reste vrai sans mentir.
      const KB_HORS_PANNEAU = ['compat']
      const kbMVerifyContract = async () => {
        const res = await fetch('/kybernos-models/status', { headers: { accept: 'application/json' } })
        const body = await res.json()
        const theirs = Array.isArray(body.wired) ? body.wired : []
        const unknown = theirs.filter((f) => KB_PANEL_FIELDS.indexOf(f) < 0 && KB_HORS_PANNEAU.indexOf(f) < 0)
        const missing = KB_PANEL_FIELDS.filter((f) => theirs.indexOf(f) < 0)
        KBM.contract = (unknown.length === 0 && missing.length === 0) ? 'ok'
          : 'ecart : ' + (unknown.length > 0 ? 'host seul ' + unknown.join(',') : '') + (missing.length > 0 ? ' panneau seul ' + missing.join(',') : '')
        KBM.hostVersion = body.version === undefined ? null : body.version
      }

      /** Écriture d'un contrôle. Deux canaux, jamais mélangés. */
      const kbMPersist = async (mo, k, v) => {
        const api = kbMApi()
        if (api === null || api.settings === null) { mo.error = m('kb.models.error.remote'); kbmNotify(); return false }
        if (KBM.writable !== true) { mo.error = m('kb.models.error.readonly'); kbmNotify(); return false }
        try {
          if (kbmIsWired(k) !== true) {
            const key = kbMKey(mo)
            if (key === null) { mo.error = m('kb.models.error.nokey'); kbmNotify(); return false }
            const fields = {}
            fields[k] = v
            await kbMAnnotations(key, fields)
            await kbMJournal({ niveau: 'annotation', route: mo.route, id: mo.id, champ: k, valeur: v, ok: true })
            mo.error = null
            kbmNotify()
            return true
          }
          if (mo.kind === 'local') { mo.error = m('kb.models.error.local'); kbmNotify(); return false }
          let del = v === null || v === undefined
          let wire = null
          if (del !== true) {
            wire = kbMWireValue(mo, k, v)
            if (wire === KB_REFUS) { mo.error = m('kb.models.error.wire'); kbmNotify(); return false }
            // Un retour à la valeur de la couche inférieure s'écrit en retirant la
            // clé : on ne redéclare pas ce que le harnais applique déjà.
            if ((k === 'textIn' || k === 'vision') && Array.isArray(mo.raw.input) !== true && kbMSameList(wire, kbMInputBase(mo)) === true) del = true
          }
          const plan = kbMOps(mo, k, del, wire)
          if (plan.error !== undefined) { mo.error = plan.error; kbmNotify(); return false }
          const ops = plan.ops
          await kbMJournal({ niveau: 'settings', route: mo.route, id: mo.id, champ: k, op: ops[0].op, chemin: plan.path, valeur: ops[0].value === undefined ? null : ops[0].value, revision: KBM.revision })
          const raw = await kbMTimeout(api.settings.mutate(KB_NS, ops, KBM.revision), 8000)
          const resp = raw === null || raw === undefined ? { ok: false, error: { code: 'vide', message: 'réponse vide' } } : raw
          if (resp.ok !== true) {
            const code = resp.error && resp.error.code ? resp.error.code : 'refus'
            await kbMJournal({ niveau: 'settings', route: mo.route, id: mo.id, champ: k, ok: false, code, message: String(resp.error && resp.error.message ? resp.error.message : '') })
            if (code === 'settings/conflict') {
              mo.error = m('kb.models.error.conflict')
              setTimeout(() => { kbMLoad() }, 400)
            } else {
              mo.error = m('kb.models.error.refus') + ' : ' + String(resp.error && resp.error.message ? resp.error.message : code)
            }
            kbmNotify()
            return false
          }
          await kbMJournal({ niveau: 'settings', route: mo.route, id: mo.id, champ: k, ok: true, revision: resp.value && typeof resp.value.revision === 'number' ? resp.value.revision : null })
          if (resp.value !== null && resp.value !== undefined) {
            if (typeof resp.value.revision === 'number') KBM.revision = resp.value.revision
            KBM.written = (KBM.written === null ? 0 : KBM.written) + 1
          }
          mo.error = null
          kbmNotify()
          return true
        } catch (e) {
          mo.error = m('kb.models.error.reseau') + ' : ' + String(e && e.message ? e.message : e)
          kbmNotify()
          return false
        }
      }

      /** Un rechargement ne perd rien. Les états acquis d'une rangée — fiche
       *  models.dev, notes externes, rangée ouverte, refus à afficher — reviennent
       *  sur la rangée de MÊME CLÉ (`route/id`). Une ligne « Ajouter un modèle »
       *  en cours de saisie survit aussi : elle ne vient pas du document, seul un
       *  document peut la remplacer. */
      const kbMReprendre = (avant, apres) => {
        const par = new Map(avant.map((mo) => [mo.key, mo]))
        for (const mo of apres) {
          const old = par.get(mo.key)
          if (old === undefined) continue
          mo.open = old.open
          mo.synced = old.synced
          mo.remote = old.remote
          if (old.stale !== undefined) mo.stale = old.stale
          if (old.scores !== undefined) mo.scores = old.scores
          if (old.scoresAt !== undefined) mo.scoresAt = old.scoresAt
          if (old.scoresFailed !== undefined) mo.scoresFailed = old.scoresFailed
          // Un refus d'écriture reste affiché (l'écriture n'a pas eu lieu) — sauf
          // le conflit de révision, que ce rechargement vient justement de régler.
          if (typeof old.error === 'string' && old.error !== m('kb.models.error.conflict')) mo.error = old.error
        }
        const cles = new Set(apres.map((mo) => mo.key))
        for (const b of avant) if (b.kind === 'local' && cles.has(b.key) !== true) apres.push(b)
        return apres
      }

      /** Lecture : settings.yaml (couches value/base/user) + annotations locales. */
      const kbMLoad = async () => {
        const api = kbMApi()
        if (api === null || api.settings === null) { KBM.loadError = m('kb.models.error.remote'); KBM.loading = false; kbmNotify(); return false }
        KBM.loading = true
        kbmNotify()
        try {
          const resp = await api.settings.describe()
          if (resp === null || resp.ok !== true) throw new Error(String(resp && resp.error ? resp.error.code || resp.error.message : 'describe'))
          KBM.writable = resp.value.writable === true
          const namespaces = Array.isArray(resp.value.namespaces) ? resp.value.namespaces : []
          KBM.hasDeepseek = namespaces.some((n) => n.ns === 'llm-deepseek')
          const view = namespaces.filter((n) => n.ns === KB_NS)[0]
          if (view === undefined) throw new Error('namespace ' + KB_NS + ' absent')
          KBM.revision = typeof view.revision === 'number' ? view.revision : null
          const annotations = await kbMAnnotations()
          KBM.annotations = annotations === null || annotations.models === undefined ? {} : annotations.models
          await kbMLoadParked()
          const valueProviders = kbMProviders(view.value)
          const userProviders = kbMProviders(view.user)
          const baseProviders = kbMProviders(view.base)
          const routes = Object.keys(valueProviders)
          KBM.userProviders = userProviders
          KBM.baseProviders = baseProviders
          await kbMLoadKeys(api, userProviders)
          await kbMLoadDirectory(api)
          const avant = KBM.models
          const rows = []
          for (const route of routes) {
            const prof = kbMOBJ(valueProviders[route])
            const models = Array.isArray(prof.models) ? prof.models : []
            const user = kbMOBJ(userProviders[route])
            const base = kbMOBJ(baseProviders[route])
            if (models.length > 0) {
              const userModels = Array.isArray(user.models) ? user.models : []
              const baseModels = Array.isArray(base.models) ? base.models : []
              for (let i = 0; i < models.length; i += 1) {
                const m2 = kbMOBJ(models[i])
                const id = typeof m2.id === 'string' ? m2.id : ''
                const baseCtl = kbMControlsFromEntry(baseModels[i])
                const declaredInput = Array.isArray(m2.input)
                if (declaredInput !== true && baseCtl.textIn === undefined) {
                  const eff = Array.isArray(prof.defaultInput) ? prof.defaultInput : ['text']
                  baseCtl.textIn = eff.indexOf('text') >= 0
                  baseCtl.vision = eff.indexOf('image') >= 0
                  baseCtl.__inputImplicite = Array.isArray(prof.defaultInput) ? 'route' : 'defaut'
                }
                rows.push(kbmMakeModel({
                  route, kind: 'declared', index: i, id,
                  name: typeof m2.name === 'string' ? m2.name : id,
                  open: false, synced: false, remote: {},
                  defaultInput: Array.isArray(prof.defaultInput) ? prof.defaultInput : null,
                  userModels: Array.isArray(user.models) ? user.models : null,
                  raw: m2, baseCtl: baseCtl, ov: kbMControlsFromEntry(userModels[i]),
                }, route + '/' + id))
              }
            } else {
              // Route catalogue : le catalogue installé n'est pas lisible d'ici,
              // donc on montre les surcharges déjà posées (et « Add model » en
              // crée une). Rien n'est inventé.
              const overrides = kbMOBJ(user.modelOverrides)
              for (const id of Object.keys(overrides)) {
                rows.push(kbmMakeModel({
                  route, kind: 'catalog', index: -1, id,
                  name: id, open: false, synced: false, remote: {},
                  raw: overrides[id], baseCtl: {}, ov: kbMControlsFromEntry(overrides[id]),
                }, route + '/' + id))
              }
            }
          }
          // Les annotations locales (le deuxième niveau) — jamais par-dessus un
          // champ réel : un contrôle câblé tient sa valeur de settings.yaml.
          for (const mo of rows) {
            const key = kbMKey(mo)
            const noted = key === null ? undefined : KBM.annotations[key]
            if (noted === undefined || noted === null) continue
            for (const k of Object.keys(noted)) {
              if (kbmIsWired(k) === true) continue
              if (kbmHas(mo.ov, k)) continue
              mo.ov[k] = noted[k]
            }
          }
          KBM.routes = routes
          KBM.models = kbMReprendre(avant, rows)
          KBM.loadError = null
          KBM.loading = false
          try { await kbMVerifyContract() } catch (e2) { KBM.contract = 'indisponible' }
          kbmNotify()
          kbMRefreshDone()
          return true
        } catch (e) {
          KBM.loading = false
          KBM.loadError = String(e && e.message ? e.message : e)
          kbmNotify()
          kbMRefreshDone()
          return false
        }
      }

      // ── Rafraîchissement piloté par les invalidations de DSH ───────────────
      // La page Models NATIVE se réabonne aux quatre signaux ci-dessous ; ce
      // panneau, lui, lisait settings.yaml UNE SEULE FOIS, à sa pose. Un
      // fournisseur ou un modèle ajouté pendant que la page est ouverte n'y
      // apparaissait donc pas — il fallait recharger la page (bug constaté deux
      // fois le 23/09/2026 : « j'ai ajouté mimo, mais je ne trouve pas dans
      // Models »). On écoute les mêmes signaux, sans rien écrire : un délai court
      // absorbe les rafales, et une lecture déjà en cours est rejouée à sa fin
      // plutôt que doublée.
      let kbMRefreshTimer = null
      let kbMRefreshPending = false
      const kbMRefresh = () => {
        if (KBM.live !== true) return
        if (KBM.loading === true) { kbMRefreshPending = true; return }
        if (kbMRefreshTimer !== null) return
        kbMRefreshTimer = setTimeout(() => {
          kbMRefreshTimer = null
          if (KBM.loading === true) { kbMRefreshPending = true; return }
          kbMLoad()
        }, 300)
      }
      const kbMRefreshDone = () => {
        if (kbMRefreshPending !== true) return
        kbMRefreshPending = false
        kbMRefresh()
      }

      /** Un objet sûr : ni null, ni undefined, ni tableau. */
      const kbMOBJ = (v) => (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v) === true) ? {} : v
      const kbMProviders = (layer) => {
        const safe = kbMOBJ(layer)
        return kbMOBJ(safe.providers)
      }
      // KB-PARK-PURE-BEGIN
      /** Routes another Kybernos feature writes itself (kybernos-cloud sets `providers.kybernos` on
       *  every sync): parking one would be undone by the next sync, so it is locked instead. */
      const KB_MANAGED_ROUTES = ['kybernos']
      /** Why a route cannot be disabled here: 'managed' (written by a Kybernos feature), 'profile'
       *  (not in the user layer, or the base layer declares it too: an `unset` on the user layer
       *  would just reveal the base copy), or null when it can be. Pure. */
      const kbMParkBlock = (route, userProviders, baseProviders) => {
        const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
        if (KB_MANAGED_ROUTES.indexOf(route) >= 0) return 'managed'
        const ok = own(userProviders, route) && !own(baseProviders, route) &&
          userProviders[route] !== null && typeof userProviders[route] === 'object' && !Array.isArray(userProviders[route])
        return ok ? null : 'profile'
      }
      const kbMParkable = (route, userProviders, baseProviders) => kbMParkBlock(route, userProviders, baseProviders) === null
      /** The parked entries to show: those whose slug is not active (a stale copy left by an
       *  interrupted enable is hidden, never auto-deleted). Pure. */
      const kbMParkedShown = (parked, activeRoutes) =>
        (Array.isArray(parked) ? parked : []).filter((p) => p !== null && typeof p === 'object' && typeof p.slug === 'string' && activeRoutes.indexOf(p.slug) < 0)
      // KB-PARK-PURE-END

      // KB-PARK-ACTIONS-BEGIN
      /** The engine's own directory of configurable providers: display name, "declared" (a route only
       *  configuration knows: a gateway, a self-hosted server) and a configuration diagnostic. */
      const kbMLoadDirectory = async (api) => {
        const dir = {}
        const llm = api.llm
        if (llm !== null && llm !== undefined && typeof llm.listConfigurableProviders === 'function') {
          try {
            const r = await kbMTimeout(llm.listConfigurableProviders(), 8000)
            const rows = r !== null && r !== undefined && r.ok === true && Array.isArray(r.value) ? r.value : []
            for (const e of rows) if (kbPvIsObj(e) && typeof e.provider === 'string' && e.settingsNs === KB_NS) dir[e.provider] = { declared: e.declared === true, name: typeof e.displayName === 'string' ? e.displayName : '', error: typeof e.error === 'string' ? e.error : '' }
          } catch (e) { /* the heuristic below takes over */ }
        }
        KBM.dir = dir
      }
      /** Which referenced credentials exist (`credentials.describe`): one call for every provider that names one. */
      const kbMLoadKeys = async (api, userProviders) => {
        const refs = []
        for (const route of Object.keys(kbMOBJ(userProviders))) {
          const prof = kbMOBJ(userProviders)[route]
          if (kbPvIsObj(prof) && typeof prof.apiKeyEnv === 'string' && refs.indexOf(prof.apiKeyEnv) < 0) refs.push(prof.apiKeyEnv)
        }
        const keys = {}
        const cr = api.credentials
        if (refs.length > 0 && cr !== null && cr !== undefined && typeof cr.describe === 'function') {
          try {
            const r = await kbMTimeout(cr.describe(refs), 8000)
            const v = r !== null && r !== undefined && r.ok === true && kbPvIsObj(r.value) ? r.value : {}
            for (const ref of refs) if (kbPvIsObj(v[ref]) && typeof v[ref].configured === 'boolean') keys[ref] = v[ref].configured
          } catch (e) { /* a missing dot is better than a failed load */ }
        }
        KBM.keys = keys
      }
      /** Same-origin call to the host's parked-provider routes. Throws the host's error code. */
      const kbMParkCall = async (path, body) => {
        const res = await fetch('/kybernos-models/providers/' + path, body === undefined
          ? { headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        let out = null
        try { out = await res.json() } catch (e) { out = null }
        if (out === null || out.ok !== true) throw new Error(String(out !== null && out.error ? out.error : 'HTTP ' + String(res.status)))
        return out
      }
      const kbMLoadParked = async () => {
        try {
          const b = await kbMParkCall('parked')
          KBM.parked = Array.isArray(b.parked) ? b.parked : []
          KBM.parkHost = true
        } catch (e) { KBM.parked = []; KBM.parkHost = false }
      }
      /** One settings write; on a revision conflict reload once and retry. Returns the response. */
      const kbMMutateRetry = async (api, ops) => {
        for (let essai = 0; essai < 2; essai += 1) {
          const raw = await kbMTimeout(api.settings.mutate(KB_NS, ops, KBM.revision), 8000)
          const resp = raw === null || raw === undefined ? { ok: false, error: { code: 'vide', message: 'empty answer' } } : raw
          if (resp.ok === true) { if (resp.value && typeof resp.value.revision === 'number') KBM.revision = resp.value.revision; return resp }
          if (!(resp.error && resp.error.code === 'settings/conflict') || essai === 1) return resp
          await kbMLoad()
        }
        return { ok: false, error: { code: 'refus' } }
      }
      const kbMErrText = (resp) => String(resp && resp.error ? (resp.error.message || resp.error.code) : 'refus')

      /** Disable = park the user-layer profile on the host, THEN drop the route from the settings.
       *  The profile is saved first: if the settings write fails the copy is forgotten and nothing
       *  changed; if we crash in between, the provider is still active and the stale copy is hidden. */
      const kbMDisable = async (route) => {
        const api = kbMApi()
        if (api === null || api.settings === null || KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const bloc = kbMParkBlock(route, KBM.userProviders, KBM.baseProviders)
        if (bloc !== null) throw new Error(m(bloc === 'managed' ? 'kb.prov.off.managed' : 'kb.prov.off.locked'))
        const ids = KBM.models.filter((mo) => mo.route === route).map((mo) => mo.id).filter((x) => x !== '')
        const body = { slug: route, profile: KBM.userProviders[route], models: ids }
        try { await kbMParkCall('park', body) } catch (e) {
          if (!(e && e.message === 'already-parked')) throw e
          // The provider is active in the settings, which is the truth: replace the stale copy.
          await kbMParkCall('forget', { slug: route })
          await kbMParkCall('park', body)
        }
        const resp = await kbMMutateRetry(api, [{ op: 'unset', path: ['providers', route] }])
        await kbMJournal({ niveau: 'settings', route, champ: 'provider', op: 'unset', chemin: ['providers', route], ok: resp.ok === true })
        if (resp.ok !== true) {
          try { await kbMParkCall('forget', { slug: route }) } catch (e) { /* the copy stays hidden while the route is active */ }
          throw new Error(kbMErrText(resp))
        }
        await kbMLoad()
      }
      /** Enable = write the saved profile back, THEN forget the copy (never the other way round). */
      const kbMEnable = async (slug) => {
        const api = kbMApi()
        if (api === null || api.settings === null || KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const taken = await kbMParkCall('take', { slug })
        if (KBM.routes.indexOf(slug) < 0) {
          const resp = await kbMMutateRetry(api, [{ op: 'set', path: ['providers', slug], value: taken.profile }])
          await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'set', chemin: ['providers', slug], ok: resp.ok === true })
          if (resp.ok !== true) throw new Error(kbMErrText(resp))
        }
        await kbMParkCall('forget', { slug })
        await kbMLoad()
      }
      // KB-PARK-ACTIONS-END

      // KB-NATIVE-PURE-BEGIN
      // ── DSH's own Models page: hidden while this page owns the job, one click away ──
      // The native page and this one read and write the SAME settings namespace and listen to
      // the same invalidations, so they stay in sync by construction. The engine offers no way
      // to unregister another plugin's Settings section, so the native menu entry is hidden in
      // the DOM, only while this plugin is active and healthy, and the page stays reachable
      // (`kbNatOpen`). Its label is read from DSH's own locale (`settings.models` / `nav`).
      const KB_NAT_PREF = 'kb.models.hideNative'
      /** Which cells of a menu to hide: the one carrying the native label, only in a list that
       *  also carries our own label (so an unrelated "Models" button is never touched). Pure. */
      const kbNatPick = (groups, nativeLabel, ownLabel) => {
        const out = []
        if (typeof nativeLabel !== 'string' || nativeLabel === '' || nativeLabel === ownLabel) return out
        for (let g = 0; g < groups.length; g += 1) {
          const texts = groups[g].map((c) => String(c).trim())
          if (texts.length < 3 || texts.indexOf(ownLabel) < 0) continue
          const i = texts.indexOf(nativeLabel)
          if (i >= 0) out.push({ group: g, index: i })
        }
        return out
      }
      /** Whether the native cell is hidden when nothing is stored. Flip to `true` once this page does everything the
       *  native one does (the Models tab, "Fetch available models", DeepSeek). */
      const KB_NAT_DEFAULT_HIDDEN = false
      /** The stored choice wins ('1' hide, '0' show); with none, the default above. Pure. */
      const kbNatHidden = (stored, dflt) => (stored === '1' ? true : (stored === '0' ? false : dflt === true))
      // KB-NATIVE-PURE-END
      let kbNatOwner = false
      const kbNatPrefGet = () => { try { return kbNatHidden(window.localStorage.getItem(KB_NAT_PREF), KB_NAT_DEFAULT_HIDDEN) } catch (e) { return KB_NAT_DEFAULT_HIDDEN } }
      const kbNatPrefSet = (hide) => { try { window.localStorage.setItem(KB_NAT_PREF, hide === true ? '1' : '0') } catch (e) { /* per-viewer convenience */ } }
      const kbNatLabel = () => {
        try {
          const loc = kbCtx !== null && kbCtx !== undefined && typeof kbCtx.get === 'function' ? kbCtx.get('locale') : null
          if (loc === null || loc === undefined || typeof loc.bind !== 'function') return null
          const v = loc.bind('settings.models')('nav')
          return typeof v === 'string' && v !== '' && v !== 'nav' ? v : null
        } catch (e) { return null }
      }
      /** The menu cells grouped by parent, with the native label and ours resolved. */
      const kbNatScan = () => {
        const nat = kbNatLabel()
        const own = m('kb.models.surface.entry')
        const parents = new Map()
        for (const b of Array.from(document.querySelectorAll('button'))) {
          const p = b.parentElement
          if (p === null) continue
          if (!parents.has(p)) parents.set(p, [])
          parents.get(p).push(b)
        }
        const lists = Array.from(parents.values())
        const picks = kbNatPick(lists.map((l) => l.map((b) => b.innerText || '')), nat, own)
        return { cells: picks.map((p) => lists[p.group][p.index]), own, lists }
      }
      const kbNatApply = () => {
        try {
          const hide = kbNatOwner === true && kbNatPrefGet() === true
          for (const el of Array.from(document.querySelectorAll('[data-kb-native-nav]'))) if (!hide) el.removeAttribute('data-kb-native-nav')
          if (hide !== true) return
          for (const el of kbNatScan().cells) if (!el.hasAttribute('data-kb-native-nav')) el.setAttribute('data-kb-native-nav', '1')
        } catch (e) { /* a cosmetic guard never breaks the page */ }
      }
      /** Open DSH's native page: its menu cell may be hidden, a programmatic click still works. */
      const kbNatOpen = () => {
        try {
          const cell = kbNatScan().cells[0] || document.querySelector('[data-kb-native-nav]')
          if (cell === undefined || cell === null) return false
          cell.click()
          return true
        } catch (e) { return false }
      }
      const kbNatOpenOurs = () => {
        try {
          const own = m('kb.models.surface.entry')
          const cell = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === own && b.parentElement !== null && b.parentElement.querySelectorAll('button').length >= 3)
          if (cell === undefined) return false
          cell.click()
          return true
        } catch (e) { return false }
      }
      /** The note shown under DSH's native page (its `settings.models.footer` seat). */
      const NativeNote = () => {
        kbmUse()
        const [hide, setHide] = React.useState(kbNatPrefGet())
        if (kbNatOwner !== true) return null
        return h('div', { className: 'kbpv-native', 'data-kbm': 'native-note', role: 'note' },
          h('div', { className: 'kbpv-native-t' }, m('kb.nat.note.t')),
          h('p', null, m('kb.nat.note.b')),
          h('div', { className: 'kbpv-native-act' },
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'native-back', onClick: () => { kbNatOpenOurs() } }, m('kb.nat.back')),
            h('label', { className: 'kbpv-native-chk' },
              h('input', { type: 'checkbox', checked: hide !== true, 'data-kbm': 'native-show', onChange: (ev) => { const show = ev.target.checked === true; kbNatPrefSet(show !== true); setHide(show !== true); kbNatApply() } }),
              m('kb.nat.show'))))
      }
      /** A page that fails to render must never cost the user DSH's native page. */
      class KbBoundary extends React.Component {
        constructor (props) { super(props); this.state = { failed: false } }
        static getDerivedStateFromError () { return { failed: true } }
        componentDidCatch (e) { kbNatOwner = false; kbNatApply(); try { console.error('[kybernos-models] page crashed:', e) } catch (e2) { /* console gone */ } }
        render () {
          if (this.state.failed !== true) return this.props.children
          return h('div', { className: 'kbm-warn', 'data-kbm': 'crashed', role: 'alert' },
            h('b', null, m('kb.nat.crash.t')), ' ', m('kb.nat.crash.b'), ' ',
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', onClick: () => { kbNatOpen() } }, m('kb.nat.open')))
        }
      }

      // KB-PV-PURE-BEGIN
      // ── Providers: the writes, in the shape the native Models page uses ────────
      // Measured on DSH 0.2.0-rc.2 (dsh-client-ui-settings-models): a typed key goes to
      // `credentials.set(ref, value)` and the profile records `apiKeyEnv`; a save writes
      // only the keys that changed (`set`) or went away (`unset`); a delete removes the
      // credential FIRST, then unsets the route. The page never asks for a variable name.
      const KB_PV_SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/
      /** `<ROUTE>_API_KEY`, the reference the native page derives when the profile has none. Pure. */
      const kbPvKeyRef = (slug) => String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_API_KEY'
      /** A parseable http(s) URL without an unfilled `${…}` template. Pure. */
      const kbPvUrlOk = (url) => /^https?:\/\/[^\s]+$/.test(String(url).trim()) && String(url).indexOf('${') < 0
      const kbPvIsObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
      /** Model rows (id + optional name) from a draft: drops blank ids, keeps the first of a duplicate. Pure. */
      const kbPvRows = (rows) => {
        const seen = new Set()
        const out = []
        for (const r of Array.isArray(rows) ? rows : []) {
          const id = String(r && r.id !== undefined ? r.id : '').trim()
          if (id === '' || seen.has(id)) continue
          seen.add(id)
          out.push({ id, name: String(r && r.name !== undefined ? r.name : '').trim() })
        }
        return out
      }
      /** Draft model rows → the profile's `models`, keeping every other field the existing entry carried. Pure. */
      const kbPvMergeModels = (existing, rows) => {
        const byId = new Map()
        for (const e of Array.isArray(existing) ? existing : []) if (kbPvIsObj(e) && typeof e.id === 'string') byId.set(e.id, e)
        return kbPvRows(rows).map((r) => {
          const base = byId.has(r.id) ? { ...byId.get(r.id) } : { id: r.id }
          if (r.name === '') delete base.name
          else base.name = r.name
          return base
        })
      }
      /** The ops that turn `before` into `after` at `base`: a `set` per changed key, an `unset` per removed one. Pure. */
      const kbPvDiffOps = (base, before, after) => {
        const a = kbPvIsObj(before) ? before : {}
        const b = kbPvIsObj(after) ? after : {}
        const ops = []
        for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ops.push({ op: 'set', path: [...base, k], value: b[k] })
        for (const k of Object.keys(a)) if (!(k in b)) ops.push({ op: 'unset', path: [...base, k] })
        return ops
      }
      /** Edit draft → the new profile. Display name / protocol only exist on hand-declared routes. Pure. */
      const kbPvEditProfile = (slug, before, d, custom) => {
        const next = { ...(kbPvIsObj(before) ? before : {}) }
        const url = String(d.url || '').trim().replace(/\/+$/, '')
        if (url === '') delete next.baseURL
        else next.baseURL = url
        if (custom === true) {
          const name = String(d.name || '').trim()
          if (name === '') delete next.displayName
          else next.displayName = name
          if (typeof d.proto === 'string' && d.proto !== '') next.api = d.proto
        }
        if (d.models !== undefined) {
          const models = kbPvMergeModels(next.models, d.models)
          if (models.length > 0 || Array.isArray(next.models)) next.models = models
        }
        if (String(d.key || '').trim() !== '' && typeof next.apiKeyEnv !== 'string') next.apiKeyEnv = kbPvKeyRef(slug)
        return next
      }
      /** Add draft → the profile to create. Pure. */
      const kbPvNewProfile = (d) => {
        const slug = String(d.id || '').trim().toLowerCase()
        const prof = { api: typeof d.proto === 'string' && d.proto !== '' ? d.proto : 'openai-completions', baseURL: String(d.url || '').trim().replace(/\/+$/, '') }
        const name = String(d.name || '').trim()
        if (name !== '') prof.displayName = name
        if (String(d.key || '').trim() !== '') prof.apiKeyEnv = String(d.env || '').trim() !== '' ? String(d.env).trim() : kbPvKeyRef(slug)
        // No `retryPolicy` and no empty `modelOverrides`: DSH 0.2.0-rc.2 rejects the old `{ attempts, … }` shape
        // (measured: "retryPolicy expected { mode: \"normal\", maxRetries?, … }"), and the engine's own default
        // (normal mode, bounded by the plugin's cap of 10) is what a new route should get.
        const models = kbPvMergeModels([], d.models)
        if (models.length > 0) prof.models = models
        return prof
      }
      /** Why an add draft cannot be saved yet (a message key), or null. Pure. */
      const kbPvAddBlock = (d, takenSlugs) => {
        const slug = String(d.id || '').trim().toLowerCase()
        if (d.tab === 'catalog' && !d.prov) return 'pick'
        if (!KB_PV_SLUG.test(slug)) return 'slug'
        if (d.tab === 'custom' && kbPvRows(d.models).length === 0) return 'models'
        if (takenSlugs.indexOf(slug) >= 0) return 'taken'
        if (!kbPvUrlOk(d.url)) return String(d.url || '').indexOf('${') >= 0 ? 'template' : 'url'
        return null
      }
      // KB-PV-PURE-END

      // KB-PV-ACTIONS-BEGIN
      const kbPvCredential = async (api, ref, value) => {
        const cr = api.credentials
        if (cr === null || cr === undefined || typeof cr.set !== 'function') return false
        try { const r = await kbMTimeout(cr.set(ref, value), 8000); return !(r !== null && r !== undefined && r.ok === false) } catch (e) { return false }
      }
      /** Create a provider. The key is stored after the route; a failed key never undoes the route. */
      const kbPvCreate = async (d) => {
        const api = kbMApi()
        if (api === null || api.settings === null) throw new Error(m('kb.models.error.remote'))
        if (KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const slug = String(d.id || '').trim().toLowerCase()
        const taken = KBM.routes.concat(KBM.parked.map((p) => p.slug))
        const block = kbPvAddBlock(d, taken)
        if (block !== null) throw new Error(m('kb.pv.err.' + block))
        const prof = kbPvNewProfile(d)
        const resp = await kbMMutateRetry(api, [{ op: 'set', path: ['providers', slug], value: prof }])
        await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'set', chemin: ['providers', slug], ok: resp.ok === true })
        if (resp.ok !== true) throw new Error(kbMErrText(resp))
        let keyOk = null
        if (String(d.key || '').trim() !== '') keyOk = await kbPvCredential(api, prof.apiKeyEnv, String(d.key).trim())
        await kbMLoad()
        return { slug, keyOk }
      }
      /** Save an edit: only changed fields are written; a typed key goes to the credential store. */
      const kbPvSave = async (slug, d) => {
        const api = kbMApi()
        if (api === null || api.settings === null) throw new Error(m('kb.models.error.remote'))
        if (KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const before = kbMOBJ(KBM.userProviders)[slug]
        if (!kbPvIsObj(before)) throw new Error(m('kb.prov.off.locked'))
        const custom = d.custom === true
        if (String(d.url || '').trim() !== '' && !kbPvUrlOk(d.url)) throw new Error(m('kb.pv.err.url'))
        const after = kbPvEditProfile(slug, before, d, custom)
        const ops = kbPvDiffOps(['providers', slug], before, after)
        if (ops.length > 0) {
          const resp = await kbMMutateRetry(api, ops)
          await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'edit', chemin: ['providers', slug], ok: resp.ok === true })
          if (resp.ok !== true) throw new Error(kbMErrText(resp))
        }
        let keyOk = null
        if (String(d.key || '').trim() !== '') keyOk = await kbPvCredential(api, typeof after.apiKeyEnv === 'string' ? after.apiKeyEnv : kbPvKeyRef(slug), String(d.key).trim())
        await kbMLoad()
        return { changed: ops.length, keyOk }
      }
      /** Delete = credential first, then the route (the order the native page uses); a stale parked copy goes too. */
      const kbPvDelete = async (slug) => {
        const api = kbMApi()
        if (api === null || api.settings === null) throw new Error(m('kb.models.error.remote'))
        if (KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const bloc = kbMParkBlock(slug, KBM.userProviders, KBM.baseProviders)
        if (bloc !== null) throw new Error(m(bloc === 'managed' ? 'kb.prov.off.managed' : 'kb.prov.off.locked'))
        const prof = kbMOBJ(KBM.userProviders)[slug]
        if (typeof prof.apiKeyEnv === 'string' && api.credentials !== null && api.credentials !== undefined && typeof api.credentials.unset === 'function') {
          let r = null
          try { r = await kbMTimeout(api.credentials.unset(prof.apiKeyEnv), 8000) } catch (e) { r = { ok: false, error: { message: String(e && e.message ? e.message : e) } } }
          if (r !== null && r !== undefined && r.ok === false) throw new Error(String(r.error && r.error.message ? r.error.message : 'credential'))
        }
        const resp = await kbMMutateRetry(api, [{ op: 'unset', path: ['providers', slug] }])
        await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'delete', chemin: ['providers', slug], ok: resp.ok === true })
        if (resp.ok !== true) throw new Error(kbMErrText(resp))
        if (KBM.parked.some((p) => p.slug === slug)) { try { await kbMParkCall('forget', { slug }) } catch (e) { /* the copy stays hidden */ } }
        await kbMLoad()
      }
      // KB-PV-ACTIONS-END
      /** Une entrée `models[i]`/`modelOverrides.<id>` → les clés de contrôle du
       *  panneau. Seules les clés PRÉSENTES apparaissent : c'est ce qui fait
       *  qu'une surcharge se voit. */
      const kbMControlsFromEntry = (entry) => {
        const out = {}
        if (entry === null || entry === undefined || typeof entry !== 'object' || Array.isArray(entry) === true) return out
        if (typeof entry.name === 'string') out.name = entry.name
        if (typeof entry.contextWindow === 'number') out.context = String(entry.contextWindow)
        if (typeof entry.maxTokens === 'number') out.outputLimit = String(entry.maxTokens)
        if (Array.isArray(entry.input)) {
          out.textIn = entry.input.indexOf('text') >= 0
          out.vision = entry.input.indexOf('image') >= 0
        }
        if (entry.reasoningEfforts !== undefined) out.reasoning = entry.reasoningEfforts !== false
        if (entry.__inputImplicite !== undefined) out.__inputImplicite = entry.__inputImplicite
        return out
      }

      /** Les notes externes d'un modèle : lecture d'un instantané tenu par l'hôte
       *  (deux pages publiques, cache disque 24 h). Best-effort : un catalogue
       *  indisponible ne bloque jamais les contrôles, il laisse la section vide. */
      const kbMScoresLoad = async (mo, force) => {
        const key = kbMKey(mo)
        if (key === null) { mo.scores = null; mo.scoresFailed = false; kbmNotify(); return false }
        mo.scoresLoading = true
        kbmNotify()
        try {
          let url = '/kybernos-models/scores?key=' + encodeURIComponent(key)
          if (typeof mo.remote.name === 'string' && mo.remote.name.length > 0) url += '&name=' + encodeURIComponent(mo.remote.name)
          else if (typeof mo.name === 'string' && mo.name.length > 0) url += '&name=' + encodeURIComponent(mo.name)
          if (force === true) url += '&force=1'
          const res = await fetch(url, { headers: { accept: 'application/json' } })
          const body = await res.json()
          mo.scoresLoading = false
          if (body === null || body.ok !== true) { mo.scores = null; mo.scoresFailed = true; kbmNotify(); return false }
          mo.scoresFailed = false
          mo.scores = {
            at: body.at === undefined ? null : body.at,
            stale: body.stale === true,
            labels: body.labels === undefined || body.labels === null ? {} : body.labels,
            aa: body.aa === undefined ? null : body.aa,
            benchlm: body.benchlm === undefined ? null : body.benchlm,
          }
          KBM.scoresAt = body.at === undefined ? null : body.at
          KBM.scoresRunning = body.running === true
          kbmNotify()
          return true
        } catch (e) {
          mo.scoresLoading = false
          mo.scores = null
          mo.scoresFailed = true
          kbmNotify()
          return false
        }
      }
      /** Déclenche le relevé des deux catalogues, en arrière-plan. La réponse
       *  part tout de suite : un scrape de ~4 Mo ne fait jamais attendre l'écran.
       *  Appelée par la synchronisation d'une ligne, elle se coalesce — le bouton
       *  « Synchroniser N » la sollicite N fois, le réseau une seule. */
      const kbMScoresRefresh = async (force) => {
        if (force !== true) {
          if (KBM.scoresRunning === true) return null
          if (typeof KBM.scoresAskedAt === 'number' && (Date.now() - KBM.scoresAskedAt) < 60000) return null
        }
        KBM.scoresAskedAt = Date.now()
        try {
          const res = await fetch('/kybernos-models/scores/sync', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ force: force === true }),
          })
          const body = await res.json()
          KBM.scoresRunning = body !== null && body.running === true && body.started === true
          kbmNotify()
          return body
        } catch (e) { return null }
      }

      /** Préremplissage : l'index models.dev de la moitié host (un fetch pour
       *  tous, cache disque 6 h). Aucune invention : pas de correspondance →
       *  pas de valeurs, et le panneau le dit. */
      const kbMSyncLive = async (mo) => {
        if (mo.route === '' || mo.id === '') { mo.synced = true; mo.remote = {}; mo.error = m('kb.models.error.nokey'); kbmNotify(); return false }
        if (mo.loading === true) return false
        mo.loading = true
        mo.error = null
        kbmNotify()
        try {
          const res = await fetch('/kybernos-models/modelsdev?route=' + encodeURIComponent(mo.route) + '&id=' + encodeURIComponent(mo.id), { headers: { accept: 'application/json' } })
          const body = await res.json()
          mo.loading = false
          mo.synced = true
          if (body !== null && body.ok === false) {
            // L'index indisponible n'est PAS « modèle inconnu » : le dire juste.
            mo.remote = {}
            mo.synced = false
            mo.error = body.error === 'modelsdev-unavailable' ? m('kb.models.error.index') : (m('kb.models.error.reseau') + ' : ' + String(body.error === undefined ? 'inconnu' : body.error))
          } else if (body !== null && body.match !== null && body.match !== undefined) {
            mo.remote = Object.assign({}, body.match)
            mo.stale = body.stale === true
            mo.error = null
          } else {
            mo.remote = {}
            mo.error = m('kb.models.error.nomatch')
          }
          kbmNotify()
          return true
        } catch (e) {
          mo.loading = false
          mo.synced = false
          mo.error = m('kb.models.error.reseau') + ' : ' + String(e && e.message ? e.message : e)
          kbmNotify()
          return false
        }
      }
      const kbMSyncAll = () => { for (const mo of KBM.models) kbMSyncLive(mo) }

      // ── NOTRE surface : un menu NEUF dans Réglages ───────────────────────
      // Décision P3b (23/09/2026) : le catalogue cesse d'être un locataire de
      // la page « Réglages → Models » du harnais.
      // Révision du 24/09/2026, sur demande utilisateur (« il devra être dans
      // Settings, un nouveau Menu ») : la surface n'est plus une entrée de la
      // barre latérale, c'est une SECTION de Réglages — la barre latérale
      // redevient native, et le catalogue se range là où on le cherche.
      //
      // Le siège est `settings.section`, celui-là même que le paquet
      // `dsh-client-ui-settings-models` occupe (`id: 'models'`, `order: 10`) :
      // on prend notre propre id et on passe après le sien.
      const SURFACE_ID = 'kybernos-models'
      const ModelsGlyph = (props) => Ic(
        'key',
        props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 18)
      const ModelsMain = () => h('div', {
        className: 'kbm-page',
        'data-kb': 'kybernos-models-page',
      },
      h('div', { className: 'kbm-pagehead' },
        h('h1', { className: 'kbm-h1' }, m('kb.models.surface.entry')),
        h('div', { className: 'kbm-sub' }, m('kb.models.surface.hint'))),
      h(KbBoundary, null, h(Panel, null)))
      // (02/10) Plus de point de montage « Modèles locaux » ici : ce panneau
      // vit uniquement dans la section dédiée « Ollama Local Models ».

      return {
        // `remote` porte les deux namespaces utilisés : settings (lecture et
        // écriture de llm-pi-ai) et llm (découverte de modèles). Les noms sont
        // ceux de la page Models native, pour écrire exactement au même endroit.
        inject: ['slots', 'remote', 'remote.settings', 'remote.llm', 'remote.credentials', 'locale'],
        apply(ctx) {
          kbCtx = ctx
          kbLocaleRead = () => {
            try {
              if (kbCtx === null || kbCtx === undefined || typeof kbCtx.get !== 'function') return 'en'
              const svc = kbCtx.get('locale')
              if (svc !== null && svc !== undefined && typeof svc.getLocale === 'function') {
                const snap = svc.getLocale()
                if (snap !== null && snap !== undefined && snap.active !== null && snap.active !== undefined) return String(snap.active)
              }
            } catch (e) { /* langue par defaut : en */ }
            return 'en'
          }
          const slots = ctx.get('slots')
          if (slots === undefined || slots === null) {
            console.error('[kybernos-models] service slots indisponible: pas d interface')
            return
          }
          ctx.effect(() => { kbPoseControles(); return styles.insert(CSS) }, 'kybernos-models: styles')
          // Trois sièges sur la page Models native : la carte Kybernos Cloud
          // AVANT la liste des fournisseurs (siège settings.models.header que
          // le harnais déclare dans sa section Models), le catalogue détaillé
          // dans le corps du panneau, et le marqueur d'ordre dans le siège
          // provider-card (un par rangée native).
          slots.inject('settings.models.header', () => slots.register(
            { name: 'settings.models.header', id: 'kybernos-models', order: -100 },
            Panel))
          // ── la rangée « Kybernos Cloud » en tête de la liste native ──────
          // Le siège provider-card est rendu DANS chaque rangée de la liste
          // (clé = namespace de settings). Ce composant ne peint un marqueur
          // invisible que dans la rangée kybernos réellement configurée ; le
          // CSS du plugin remonte ensuite cette rangée (`order:-1` sur la
          // liste, déjà une colonne flex). La rangée reste 100 % native —
          // Edit, Delete, éditeur de clé et de modèles — seule sa position
          // D'AFFICHAGE change : « juste avant DeepSeek », comme demandé.
          // Zéro patch du cœur DSH.
          slots.inject('settings.models.provider-card', () => slots.register(
            { name: 'settings.models.provider-card', key: 'llm-pi-ai', id: 'kybernos-rowmark', priority: 0 },
            RowMark))
          // ── notre propre surface : une section de Réglages ───────────────
          // `settings.section` est déclaré par `@deepseek-ai/dsh-client-ui-settings` ;
          // on s'y injecte (rejoué si la déclaration revient) et on enregistre
          // notre menu sous notre propre identifiant, APRÈS les Models natifs
          // (`order: 10`) pour ne pas déplacer le leur.
          ctx.effect(() => slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: SURFACE_ID, order: 20,
              label: () => m('kb.models.surface.entry') },
            ModelsMain)), 'kybernos-models: section de Reglages')
          // DSH's own Models page: footer note, and the menu cell hidden while this plugin is healthy.
          try {
            slots.inject('settings.models.footer', () => slots.register({ name: 'settings.models.footer', id: 'kybernos-native-note', order: 100 }, NativeNote))
          } catch (e) { /* the seat is optional */ }
          ctx.effect(() => {
            kbNatOwner = true
            kbNatApply()
            const tick = setInterval(kbNatApply, 1200)
            return () => { clearInterval(tick); kbNatOwner = false; kbNatApply() }
          }, 'kybernos-models: native page menu cell')
          if (KBM.live === true) { try { kbMLoad() } catch (e) { /* chargement best-effort */ } }
          // Les mêmes invalidations que la page Models native : un fournisseur,
          // une clé ou un modèle ajouté AILLEURS (page native, autre écran, autre
          // session) refait lire le document — sans recharger la page. Une édition
          // de cordis.patch.yml faite HORS de la GUI n'émet rien (aucun watcher
          // dans le harnais installé, mesuré le 23/09/2026) : celle-là ne se voit
          // qu'après une relance de DSH.
          ctx.effect(() => {
            const remote = ctx.remote
            const fermer = []
            if (remote !== null && remote !== undefined && typeof remote.$on === 'function') {
              for (const ev of ['settings/document-updated', 'credentials/reference-updated', 'llm/adapters-updated']) {
                try { fermer.push(remote.$on(ev, kbMRefresh)) } catch (e) { /* signal absent : les autres restent */ }
              }
            }
            if (typeof ctx.on === 'function') {
              try { fermer.push(ctx.on('connection/reset', kbMRefresh)) } catch (e) { /* idem */ }
            }
            return () => {
              if (kbMRefreshTimer !== null) { clearTimeout(kbMRefreshTimer); kbMRefreshTimer = null }
              for (const f of fermer) { try { if (typeof f === 'function') f() } catch (e) { /* déjà fermé */ } }
            }
          }, 'kybernos-models: invalidations du catalogue')
        },
      }
    } catch (kbBootError) {
      try { console.error('[kybernos-models] chargement impossible — plugin desactive, GUI preservee', kbBootError) } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin desactive apres erreur de chargement */ } }
    }
  },
})
