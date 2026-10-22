// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-models — client: « Model catalog », a custom model catalogue,
// at the foot of the Settings → Models page.
//
// What the screen does (mock-up « Model catalog — capabilities override »):
// every model of a configured route is a line (ID + display name) that unfolds
// into a « Model details » sheet: INPUT, OUTPUT, CAPABILITIES, TYPE,
// LIMITS, PRICING, METADATA. Three layers are stacked —
//
//     base    what the harness knows without consulting anything
//     remote  what models.dev answers for that id
//     ov      what the user overrides
//
// and the effective value is always `ov`, else `remote` (if synchronised),
// else `base`. The dots say where a value comes from: blue = models.dev,
// amber = override. A revert per field, « Clear N overrides » for all, and
// « Restore defaults » at the panel level.
//
// ── THE TWO LEVELS (the honest point of this screen) ───────────────────────
// The harness only accepts, PER installed model, six fields (`llm-pi-ai` →
// `providers.<route>.modelOverrides.<id>`): `name`, `contextWindow`,
// `maxTokens`, `input` (text/image), `reasoningEfforts`, `compat`. Those are
// really APPLIED: written to settings.yaml, they change the calls that
// follow, with no restart. All the other fields of the mock-up (pricing,
// type, family, knowledge, release, weights, TTS/image/video outputs, search,
// s2s, max input) have NO equivalent in the configuration: they are Kybernos
// ANNOTATIONS, kept in the plugin's file and read by the Kybernos
// views (cost, readability). Every control therefore carries a discreet
// marker: link = applied to the harness, tag = annotation.
//
// Phase 1 (this commit): the screen is complete on a FROZEN SET (`KBM.live` false) and
// writes nothing. The real wiring lives in `kbMSave` and `kbMLoad`, in a single
// place, so that the switch happens without touching the components.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-models',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: what Kybernos resolved, otherwise English ────────────────────
      // French is the French of the product (the locale id « kybernos », or any fr*); every other language, translated or not,
      // reads English. Read at CALL time, never at definition.
      let kbCtx = null
      const kbIsFr = () => {
        try {
          const l = String(window.__KB_LANG_RESOLVE__())
          return l === 'kybernos' || l.split(/[-_]/)[0] === 'fr'
        } catch (e) { return false }
      }
      // Text separator, locale-aware: French ' : ', English ': '.
      const sep = () => (kbIsFr() ? ' : ' : ': ')
      const KB_M_T = {
        'kb.models.surface.entry': { kybernos: 'Fournisseur IA et modèles', en: 'AI provider and models' },
        'kb.models.surface.hint': { kybernos: 'Tes fournisseurs et leurs modèles, au même endroit.', en: 'Your providers and their models, in one place.' },
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
        'kb.prov.add.desc.cat': { kybernos: 'Choisis OpenAI, Anthropic, Kimi… dans le catalogue et colle ta clé API.', en: 'Pick OpenAI, Anthropic, Kimi… from the catalog and paste your API key.' },
        'kb.prov.add.desc.perso': { kybernos: 'Branche n’importe quel endpoint compatible OpenAI : ta passerelle, un serveur local, un revendeur.', en: 'Plug in any OpenAI-compatible endpoint: your gateway, a local server, a reseller.' },
        'kb.prov.add.fournisseur': { kybernos: 'Fournisseur', en: 'Provider' },
        'kb.prov.add.choisir': { kybernos: 'Choisir un fournisseur…', en: 'Choose a provider…' },
        'kb.prov.add.cle.label': { kybernos: 'Clé API', en: 'API key' },
        'kb.prov.add.cle.ph': { kybernos: 'Colle la clé — ou laisse vide pour la poser plus tard', en: 'Paste the key — or leave blank to add it later' },
        'kb.prov.add.cle.note': { kybernos: 'Stockée dans le coffre local du harnais, jamais dans tes réglages.', en: 'Stored in the harness’s local vault, never in your settings.' },
        'kb.prov.add.cle.voir': { kybernos: 'Afficher', en: 'Show' },
        'kb.prov.add.cle.cacher': { kybernos: 'Masquer', en: 'Hide' },
        'kb.prov.add.reglages': { kybernos: 'Réglages avancés', en: 'Advanced settings' },
        'kb.prov.add.fait.cleok': { kybernos: '{slug} est ajouté et sa clé est enregistrée.', en: '{slug} was added and its key saved.' },
        'kb.prov.add.fait.cleko': { kybernos: '{slug} est ajouté, mais la clé n’a pas pu être enregistrée — pose-la via le flux natif.', en: '{slug} was added, but its key could not be saved — add it through the native flow.' },
        'kb.prov.add.sans.modeles': { kybernos: 'Le catalogue installé ne décrit pas {slug} et aucun modèle n’a répondu ({raison}) — la liste des modèles doit être déclarée à la main (bouton « Fetch models » après l’ajout, ou API personnalisée).', en: 'The installed catalog does not describe {slug} and no model answered ({raison}) — the model list must be declared by hand (“Fetch models” after adding, or Custom API).' },
        'kb.prov.add.grp.free': { kybernos: 'Modèles gratuits (quota)', en: 'Free models (quota)' },
        'kb.prov.add.grp.pop': { kybernos: 'Populaires', en: 'Popular' },
        'kb.prov.add.grp.tous': { kybernos: 'Tous les fournisseurs', en: 'All providers' },
        'kb.prov.add.resultat1': { kybernos: '1 résultat', en: '1 result' },
        'kb.prov.add.resultatsN': { kybernos: '{n} résultats', en: '{n} results' },
        'kb.prov.add.aucun': { kybernos: 'Aucun fournisseur — essaie l’onglet « API personnalisée ».', en: 'No provider — try the “Custom API” tab.' },
        'kb.prov.add.pied': { kybernos: '{n} fournisseurs · models.dev · ↑↓ pour naviguer, Entrée pour choisir', en: '{n} providers · models.dev · ↑↓ to browse, Enter to pick' },
        'kb.prov.add.url.a.completer': { kybernos: 'URL propre à ton compte — à compléter dans les réglages avancés.', en: 'Account-specific URL — complete it in advanced settings.' },
        'kb.prov.add.presets': { kybernos: 'Fournisseurs connus', en: 'Known providers' },
        'kb.prov.add.chercher': { kybernos: 'Rechercher un fournisseur…', en: 'Search a provider…' },
        'kb.prov.free': { kybernos: 'Free models · quota', en: 'Free models · quota' },
        'kb.prov.free.titre': { kybernos: 'Ce fournisseur propose des modèles gratuits sous quota — voir sa collection « free ».', en: 'This provider offers free models under quota — see its “free” collection.' },
        'kb.prov.free.lien': { kybernos: 'Voir les modèles gratuits', en: 'See free models' },
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
        'kb.models.clearfield.live': { kybernos: 'Retirer la surcharge — la clé est effacée de tes réglages', en: 'Remove the override — the key is deleted from your settings' },
        'kb.models.sync.src': { kybernos: 'valeur models.dev', en: 'value from models.dev' },
        'kb.models.ov.src': { kybernos: 'surchargé par toi', en: 'overridden by you' },
        'kb.models.legend.sync': { kybernos: 'models.dev', en: 'models.dev' },
        'kb.models.legend.ov': { kybernos: 'surcharge', en: 'Override' },
        'kb.models.mark.wire': { kybernos: 'Écrit dans tes réglages — appliqué aux appels suivants', en: 'Written to your settings — applied to later calls' },
        'kb.models.mark.note': { kybernos: "Annotation Kybernos — n'affecte pas les appels de modèle", en: 'Kybernos annotation — does not affect model calls' },
        'kb.models.wire.note': { kybernos: 'Marqueur : maillon = écrit dans tes réglages (effet réel) · étiquette = annotation locale.', en: 'Marker: link = written to your settings (real effect) · tag = local annotation.' },
        'kb.models.status.loading': { kybernos: 'Recherche de {id} sur models.dev…', en: 'Looking up {id} on models.dev…' },
        'kb.models.status.matched': { kybernos: '{id} reconnu · {n} valeurs récupérées', en: 'Matched {id} · {n} values fetched' },
        'kb.models.status.kept': { kybernos: '{n} surcharge(s) conservée(s)', en: '{n} override(s) kept' },
        'kb.models.status.stale': { kybernos: 'index hors ligne (cache de plus de 6 h)', en: 'index offline (cache older than 6 h)' },
        'kb.models.status.idle': { kybernos: 'Pas encore synchronisé. La récupération préremplit capacités, limites et tarifs. Tes modifications gagnent toujours.', en: 'Not synced yet. Fetching pre-fills capabilities, limits and pricing. Your own edits always win.' },
        'kb.models.note.type': { kybernos: "models.dev n'a pas de drapeau Search : règle-le toi-même. S2S et le type de modèle se déduisent des modalités d'entrée et de sortie.", en: 'models.dev has no Search flag, so set it yourself. S2S and Model type are derived from the input and output modalities.' },
        'kb.models.sec.input': { kybernos: 'Entrée', en: 'Input' },
        'kb.models.sec.output': { kybernos: 'Sortie', en: 'Output' },
        'kb.models.sec.caps': { kybernos: 'Capacités', en: 'Capabilities' },
        'kb.models.sec.type': { kybernos: 'Type', en: 'Type' },
        'kb.models.sec.limits': { kybernos: 'Limites', en: 'Limits' },
        'kb.models.sec.pricing': { kybernos: 'Tarifs', en: 'Pricing' },
        'kb.models.sec.meta': { kybernos: 'Métadonnées', en: 'Metadata' },
        // ── notes externes (Artificial Analysis + BenchLM) ────────────────────
        'kb.models.sec.scores': { kybernos: 'Notes externes', en: 'External scores' },
        'kb.models.scores.hint': { kybernos: 'deux sources, jamais fusionnées', en: 'two sources, never merged' },
        'kb.models.scores.loading': { kybernos: 'Lecture des catalogues…', en: 'Reading the catalogues…' },
        // « in no catalogue » would be WRONG when the model is there twice
        // (AA lists « Claude 4.5 Sonnet » as Reasoning and Non-reasoning: same words,
        // two models) — the refusal to guess must read as such.
        // A BROKEN read must not read as « no score »: it is an outage
        // disguised as a result, and the user would look for the model
        // instead of the route. Two states, two sentences.
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
        // The Score column, the filter and the sort need a snapshot: a fresh install has none until the person asks for it (V-37).
        'kb.models.scores.load': { kybernos: 'Charger les notes des modèles', en: 'Load model scores' },
        'kb.models.scores.loadHint': { kybernos: 'Lit deux pages publiques (Artificial Analysis et BenchLM), au plus une fois par jour. Rien n’est lu avant ton clic.', en: 'Reads two public pages (Artificial Analysis and BenchLM), at most once a day. Nothing is read before you click.' },
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
        'kb.models.empty': { kybernos: 'Aucun modèle à afficher pour l\'instant — ajoute-en un, ou configure une route dans Models.', en: 'No model to show yet — add one, or configure a route in Models.' },
        // field labels
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
        'kb.ds.ctx': { kybernos: 'Fenêtre de contexte', en: 'Context window' },
        'kb.ds.max': { kybernos: 'Tokens de sortie max', en: 'Max output tokens' },
        'kb.ds.image': { kybernos: 'Images en entrée', en: 'Image input' },
        'kb.ds.url.hint': { kybernos: 'Laisser vide pour le point d’accès officiel de DeepSeek.', en: 'Leave empty for DeepSeek’s official endpoint.' },
        'kb.ds.account.note': { kybernos: 'Ce fournisseur se connecte avec ton compte DeepSeek : pas de clé ici, seulement le catalogue de modèles.', en: 'This provider signs in with your DeepSeek account: no key here, only the model catalog.' },
        'kb.ds.err.row': { kybernos: 'Modèle {n} : {why}', en: 'Model {n}: {why}' },
        'kb.ds.err.id': { kybernos: 'l’identifiant est requis', en: 'the model ID is required' },
        'kb.ds.err.dup': { kybernos: 'identifiant en double', en: 'duplicate model ID' },
        'kb.ds.err.name': { kybernos: 'le nom ne peut pas être vide', en: 'the display name cannot be empty' },
        'kb.ds.err.ctx': { kybernos: 'la fenêtre de contexte doit être un nombre positif (131072, 256K, 1M)', en: 'the context window must be a positive count (131072, 256K, 1M)' },
        'kb.ds.err.max': { kybernos: 'les tokens de sortie doivent être un nombre positif (8192, 64K, 1M)', en: 'max output tokens must be a positive count (8192, 64K, 1M)' },
        'kb.fetch.btn': { kybernos: 'Récupérer les modèles disponibles', en: 'Fetch available models' },
        'kb.fetch.busy': { kybernos: 'Interrogation du fournisseur…', en: 'Asking the provider…' },
        'kb.fetch.needsurl': { kybernos: 'Renseigne d’abord l’URL de base, puis récupère.', en: 'Enter the base URL first, then fetch.' },
        'kb.fetch.empty': { kybernos: 'Le fournisseur n’a listé aucun modèle. Ajoute-les à la main.', en: 'The provider listed no models. Add them by hand.' },
        'kb.fetch.unavailable': { kybernos: 'Cette version de DSH ne sait pas interroger un fournisseur.', en: 'This DSH version cannot ask a provider for its models.' },
        'kb.fetch.timeout': { kybernos: 'Le fournisseur n’a pas répondu à temps.', en: 'The provider did not answer in time.' },
        'kb.fetch.err': { kybernos: 'Récupération impossible : {raison}', en: 'Could not fetch: {raison}' },
        'kb.fetch.src.live': { kybernos: 'Liste en direct de {host}.', en: 'Live list from {host}.' },
        'kb.fetch.src.catalog': { kybernos: 'Liste en direct indisponible ({raison}). Voici les modèles livrés avec DSH pour ce fournisseur, peut-être périmés.', en: 'Live list unavailable ({raison}). These are the models DSH ships for this provider, possibly out of date.' },
        'kb.fetch.why.key': { kybernos: 'le fournisseur refuse la clé (HTTP {status})', en: 'the provider refused the key (HTTP {status})' },
        'kb.fetch.why.refused': { kybernos: 'le fournisseur a répondu HTTP {status}{detail}', en: 'the provider answered HTTP {status}{detail}' },
        'kb.fetch.why.unreachable': { kybernos: 'le fournisseur est injoignable', en: 'the provider could not be reached' },
        'kb.fetch.why.bad': { kybernos: 'sa réponse n’est pas une liste de modèles', en: 'its answer is not a model list' },
        'kb.fetch.why.big': { kybernos: 'sa réponse est trop volumineuse', en: 'its answer is too large' },
        'kb.fetch.why.host': { kybernos: 'ce DSH ne sait pas encore lire la liste en direct (relance-le)', en: 'this DSH cannot read the live list yet (restart it)' },
        'kb.fetch.why.noaddr': { kybernos: 'aucune adresse connue pour ce fournisseur', en: 'no address is known for this provider' },
        'kb.pv.err.nobase': { kybernos: 'L’adresse de ce fournisseur est inconnue : renseigne l’« URL de base » dans « Paramètres personnalisés », puis réessaie.', en: 'This provider’s address is unknown: set the Base URL under Customized settings, then try again.' },
        'kb.pv.saved.custom': { kybernos: 'Appliqué. {n} modèle(s) personnalisé(s) ajouté(s) à {slug}.', en: 'Applied. {n} custom model(s) added to {slug}.' },
        'kb.pv.saved.custom.guess': { kybernos: ' Le protocole n’a pas pu être confirmé auprès du fournisseur : OpenAI Chat par défaut.', en: ' DSH could not confirm the protocol with the provider: OpenAI Chat by default.' },
        'kb.pv.custom.title': { kybernos: 'Modèles personnalisés', en: 'Custom models' },
        'kb.pv.custom.hint': { kybernos: 'Hors du catalogue de DSH : ils vivent dans une route à part de ce fournisseur, avec leur propre protocole, et se comptent avec lui.', en: 'Outside DSH’s catalog: they live in a route of their own for this provider, with their own protocol, and count with it.' },
        'kb.pv.custom.remove': { kybernos: 'Retirer {id}', en: 'Remove {id}' },
        'kb.models.custom.tag': { kybernos: 'perso', en: 'custom' },
        'kb.fetch.undescribed': { kybernos: 'Hors du catalogue de DSH', en: 'Not in DSH’s catalog' },
        'kb.fetch.undescribed.note': { kybernos: '{n} modèle(s) ne sont pas dans le catalogue de DSH : ils sont ajoutés comme modèles personnalisés de ce fournisseur, et DSH cherche le protocole qu’ils parlent.', en: '{n} model(s) are not in DSH’s catalog: they are added as custom models of this provider, and DSH finds the protocol they speak.' },
        'kb.fetch.title': { kybernos: 'Choisir les modèles à ajouter', en: 'Choose models to add' },
        'kb.fetch.desc': { kybernos: 'Voici les modèles que ce fournisseur propose. Coche ceux à ajouter.', en: 'These are the models this provider has available. Choose the ones to add.' },
        'kb.fetch.replaces': { kybernos: 'La liste que tu gardes remplace celle de {slug} : les modèles non cochés ne seront plus proposés. « Rétablir les modèles par défaut » ramène la liste d’origine.', en: 'The list you keep replaces {slug}’s built-in one: models you leave unchecked will no longer be offered. “Restore default models” brings the built-in list back.' },
        'kb.fetch.search': { kybernos: 'Rechercher un modèle', en: 'Search models' },
        'kb.fetch.all': { kybernos: 'Tout cocher', en: 'Select all' },
        'kb.fetch.none': { kybernos: 'Tout décocher', en: 'Deselect all' },
        'kb.fetch.nomatch': { kybernos: 'Aucun modèle ne correspond.', en: 'No matching models.' },
        'kb.fetch.known': { kybernos: 'Déjà ajouté', en: 'Already added' },
        'kb.fetch.count': { kybernos: '{n} sur {total} cochés', en: '{n} of {total} selected' },
        'kb.fetch.adopt': { kybernos: 'Ajouter la sélection', en: 'Add selected' },
        'kb.fetch.restore': { kybernos: 'Rétablir les modèles par défaut', en: 'Restore default models' },
        'kb.fetch.restored': { kybernos: 'Les modèles par défaut reviendront quand tu appliqueras.', en: 'The built-in models come back when you apply.' },
        'kb.health.aria': { kybernos: 'Santé des modèles', en: 'Model health' },
        'kb.health.chip.one': { kybernos: '1 modèle ne répond pas', en: '1 model not answering' },
        'kb.health.chip.many': { kybernos: '{n} modèles ne répondent pas', en: '{n} models not answering' },
        'kb.health.chip.all': { kybernos: 'Aucun modèle ne répond', en: 'No model is answering' },
        'kb.health.title.one': { kybernos: '1 modèle sur {total} ne répond plus', en: '1 of {total} models is not answering' },
        'kb.health.title.many': { kybernos: '{n} modèles sur {total} ne répondent plus', en: '{n} of {total} models are not answering' },
        'kb.health.title.all': { kybernos: 'Aucun modèle configuré ne répond', en: 'No configured model is answering' },
        'kb.health.all.detail': { kybernos: 'Rien n’a répondu sur les {total} modèles vérifiés — la panne ressemble à la connexion ou aux clés API, pas à un modèle.', en: 'Nothing answered across {total} checked models — this looks like the connection or the API keys, not one model.' },
        'kb.health.impact': { kybernos: 'Les fonctions qui les emploient ne tourneront pas tant qu’ils ne répondent pas. Change de modèle, ou corrige leurs clés API.', en: 'Features that use them cannot run until they answer. Change the model, or fix their API keys.' },
        'kb.health.cause.key': { kybernos: 'inaccessible avec la clé actuelle', en: 'not accessible with the current key' },
        'kb.health.cause.gone': { kybernos: 'disparu chez le fournisseur', en: 'gone from the provider' },
        'kb.health.cause.refused': { kybernos: 'refusé par le fournisseur', en: 'refused by the provider' },
        'kb.health.cause.text': { kybernos: 'ne prend pas de requête texte', en: 'unable to take a text request' },
        'kb.health.cause.silent': { kybernos: 'muet (aucune réponse)', en: 'silent (no answer)' },
        'kb.health.cause.other': { kybernos: 'échec pour une autre raison', en: 'fails for another reason' },
        'kb.health.more': { kybernos: '+ {n} autres', en: '+ {n} more' },
        'kb.health.fixkey': { kybernos: 'Vérifier la clé', en: 'Check key' },
        'kb.health.fixkey.t': { kybernos: 'Ouvrir {slug} pour changer sa clé API', en: 'Open {slug} to change its API key' },
        'kb.health.recheck': { kybernos: 'Revérifier', en: 'Recheck' },
        'kb.health.checking': { kybernos: 'Vérification…', en: 'Checking…' },
        'kb.health.show': { kybernos: 'Afficher les indisponibles ({n})', en: 'Show unavailable ({n})' },
        'kb.health.why.cloud': { kybernos: 'Hors de ta formule Kybernos, ou compte non connecté', en: 'Not in your Kybernos plan, or account not connected' },
        'kb.health.why.free': { kybernos: 'Refusé : n’est peut-être plus gratuit, ou quota épuisé', en: 'Refused: may no longer be free, or quota used up' },
        'kb.health.why.key': { kybernos: 'Clé refusée, ou ta formule ici n’inclut pas ce modèle', en: 'Key refused, or your plan here does not include this model' },
        'kb.health.why.gone': { kybernos: 'Le fournisseur ne propose plus ce modèle', en: 'The provider no longer offers this model' },
        'kb.health.why.refused': { kybernos: 'Le fournisseur a refusé la requête (réglages du modèle invalides)', en: 'The provider refused the request (invalid model settings)' },
        'kb.health.why.text': { kybernos: 'Ne prend pas de message texte (modèle d’image, d’audio ou autre)', en: 'Cannot take a text message (an image, audio or other kind of model)' },
        'kb.health.why.silent': { kybernos: 'Pas de réponse dans le délai', en: 'No answer in time' },
        'kb.health.why.other': { kybernos: 'Échec pour une autre raison', en: 'Fails for another reason' },
        'kb.health.hidden': { kybernos: '{n} modèles indisponibles sont masqués', en: '{n} unavailable models are hidden' },
        'kb.health.hidden.one': { kybernos: '1 modèle indisponible est masqué', en: '1 unavailable model is hidden' },
        'kb.health.showdown': { kybernos: 'Afficher les indisponibles ({n})', en: 'Show unavailable ({n})' },
        'kb.health.hidedown': { kybernos: 'Masquer les indisponibles', en: 'Hide unavailable' },
        'kb.health.rowwhy': { kybernos: 'Indisponible : {why}', en: 'Unavailable: {why}' },
        'kb.health.hide': { kybernos: 'Masquer 1 h', en: 'Hide for 1 hour' },
        'kb.models.statut.down': { kybernos: 'Ne répondent pas', en: 'Not answering' },
        'kb.models.prov.empty': { kybernos: 'Aucun fournisseur exposé pour le moment.', en: 'No provider exposed yet.' },
        'kb.models.prov.model1': { kybernos: 'modèle', en: 'model' },
        'kb.models.prov.modelN': { kybernos: 'modèles', en: 'models' },
        'kb.prov.off.badge': { kybernos: 'Désactivé', en: 'Disabled' },
        'kb.prov.off.disable': { kybernos: 'Désactiver {slug}', en: 'Disable {slug}' },
        'kb.prov.off.enable': { kybernos: 'Réactiver {slug}', en: 'Enable {slug}' },
        'kb.prov.off.locked': { kybernos: 'Défini par le profil : ne peut pas être désactivé ici.', en: 'Defined by the profile: it cannot be disabled here.' },
        'kb.prov.off.managed': { kybernos: 'Géré par Kybernos Cloud : déconnecte le compte pour le retirer.', en: 'Managed by Kybernos Cloud: disconnect the account to remove it.' },
        'kb.prov.off.dlg.title': { kybernos: 'Désactiver {slug} ?', en: 'Disable {slug}?' },
        'kb.prov.off.dlg.body': { kybernos: 'Les sessions qui utilisent un modèle de {slug} ne pourront plus l’appeler. Le réactiver rétablit tout à l’identique : clé, modèles et réglages.', en: 'Sessions that use a {slug} model will no longer be able to call it. Enabling it again restores everything as it was: key, models and settings.' },
        'kb.prov.off.dlg.ok': { kybernos: 'Désactiver', en: 'Disable' },
        'kb.prov.off.dlg.cancel': { kybernos: 'Annuler', en: 'Cancel' },
        'kb.prov.off.err': { kybernos: 'Impossible de désactiver {slug} : {raison}', en: 'Could not disable {slug}: {raison}' },
        'kb.prov.on.err': { kybernos: 'Impossible de réactiver {slug} : {raison}', en: 'Could not enable {slug}: {raison}' },
        'kb.nat.open': { kybernos: 'Ouvrir la page native de DSH', en: 'Open DSH’s native Models page' },
        'kb.nat.note.t': { kybernos: 'Page native de DSH', en: 'DSH’s native page' },
        'kb.nat.note.b': { kybernos: 'Tout ce qui se fait ici se fait aussi dans « Fournisseur IA et modèles », avec plus de détails. Les deux pages lisent et écrivent les mêmes réglages : elles restent synchronisées.', en: 'Everything done here can also be done in “AI provider and models”, with more detail. Both pages read and write the same settings, so they stay in sync.' },
        'kb.nat.back': { kybernos: 'Ouvrir Fournisseur IA et modèles', en: 'Open AI provider and models' },
        'kb.nat.hide': { kybernos: 'Masquer la page native du menu des Réglages', en: 'Hide DSH’s native page from the Settings menu' },
        'kb.nat.show': { kybernos: 'Afficher cette page dans le menu des Réglages', en: 'Show this page in the Settings menu' },
        'kb.nat.crash.t': { kybernos: 'Cette page n’a pas pu s’afficher.', en: 'This page could not be displayed.' },
        'kb.nat.crash.b': { kybernos: 'La page native de DSH reste disponible.', en: 'DSH’s native Models page is still available.' },
        'kb.models.menu.sync': { kybernos: 'Synchroniser tous les modèles avec models.dev', en: 'Sync all models with models.dev' },
        'kb.models.menu.chips': { kybernos: 'Afficher les puces de capacités sous la recherche', en: 'Show capability filter chips under the search' },
        'kb.models.mx.filter': { kybernos: 'cliquer pour filtrer', en: 'click to filter' },
        'kb.pv.title.add': { kybernos: 'Ajouter un fournisseur de modèles', en: 'Add model provider' },
        'kb.pv.diag': { kybernos: 'Config à réparer', en: 'Config error' },
        'kb.pv.custom': { kybernos: 'Perso', en: 'Custom' },
        'kb.pv.builtin': { kybernos: 'Intégré à DSH', en: 'Built into DSH' },
        'kb.pv.edit': { kybernos: 'Modifier {slug}', en: 'Edit {slug}' },
        'kb.pv.more': { kybernos: 'Plus d’actions pour {slug}', en: 'More for {slug}' },
        'kb.pv.more.page': { kybernos: 'Plus d’actions', en: 'More actions' },
        'kb.pv.close': { kybernos: 'Fermer', en: 'Close' },
        'kb.pv.menu.add': { kybernos: 'Ajouter un modèle…', en: 'Add model…' },
        'kb.pv.menu.delete': { kybernos: 'Supprimer…', en: 'Delete…' },
        'kb.pv.key.ok': { kybernos: 'Clé API configurée', en: 'API key configured' },
        'kb.pv.key.missing': { kybernos: 'Clé API absente', en: 'API key missing' },
        'kb.pv.key.unknown': { kybernos: 'État de la clé inconnu', en: 'Key state unknown' },
        'kb.pv.wait.n': { kybernos: 'Fournisseurs sans clé ou désactivés ({n})', en: 'Providers with no key or switched off ({n})' },
        'kb.pv.wait.hint': { kybernos: 'Ils ne répondent à rien tant que leur clé n’est pas posée : ajoute-la, ou active-les.', en: 'They answer nothing until their key is set: add it, or switch them on.' },
        'kb.pv.empty.nokey': { kybernos: 'Pas encore de clé : ajoute-la, puis récupère les modèles.', en: 'No key yet: add it, then fetch the models.' },
        'kb.pv.empty.fetch': { kybernos: 'Aucun modèle pour l’instant : récupère-les chez le fournisseur.', en: 'No model yet: fetch them from the provider.' },
        'kb.pv.key.ph.set': { kybernos: 'Configurée — saisis une nouvelle valeur pour la remplacer', en: 'Configured — enter a new value to replace' },
        'kb.pv.key.ph.blank': { kybernos: 'Saisis une clé, ou laisse vide pour l’authentification par environnement', en: 'Enter an API key, or leave blank to use environment authentication' },
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
        'kb.pv.models.catalog': { kybernos: 'Ce fournisseur utilise son catalogue. Ajoute un modèle seulement pour en déclarer un de plus.', en: 'This provider uses its catalog. Add a model only to declare an extra one.' },
        'kb.pv.apply': { kybernos: 'Appliquer', en: 'Apply' },
        'kb.pv.cancel': { kybernos: 'Annuler', en: 'Cancel' },
        'kb.pv.create': { kybernos: 'Créer le fournisseur', en: 'Create provider' },
        'kb.pv.saved': { kybernos: 'Appliqué. Pris en compte à la prochaine requête, sans redémarrage.', en: 'Applied. It takes effect on the next request, no restart.' },
        'kb.pv.saved.key.ko': { kybernos: 'Appliqué, mais la clé n’a pas pu être enregistrée.', en: 'Applied, but the key could not be saved.' },
        'kb.pv.save.err': { kybernos: 'Impossible d’appliquer : {raison}', en: 'Could not apply: {raison}' },
        'kb.pv.add.err': { kybernos: 'Impossible d’ajouter : {raison}', en: 'Could not add: {raison}' },
        'kb.pv.del.title': { kybernos: 'Supprimer {slug} ?', en: 'Delete {slug}?' },
        'kb.pv.del.body1': { kybernos: 'Cela retire le fournisseur, son modèle, ses surcharges et sa clé. Pour tout garder, désactive-le plutôt.', en: 'This removes the provider, its model, its overrides and its key. To keep it, disable it instead.' },
        'kb.pv.del.body': { kybernos: 'Cela retire le fournisseur, ses {n} modèles, leurs surcharges et sa clé. Pour tout garder, désactive-le plutôt.', en: 'This removes the provider, its {n} models, their overrides and its key. To keep them, disable it instead.' },
        'kb.pv.del.type': { kybernos: 'Saisis {slug} pour confirmer', en: 'Type {slug} to confirm' },
        'kb.pv.del.ok': { kybernos: 'Supprimer le fournisseur', en: 'Delete provider' },
        'kb.pv.del.instead': { kybernos: 'Désactiver plutôt', en: 'Disable instead' },
        'kb.pv.del.err': { kybernos: 'Impossible de supprimer {slug} : {raison}', en: 'Could not delete {slug}: {raison}' },
        'kb.pv.zone.off': { kybernos: 'Activé', en: 'Enabled' },
        'kb.pv.zone.off.d': { kybernos: 'Désactive-le pour masquer ses modèles et bloquer les appels. Rien n’est supprimé.', en: 'Turn it off to hide its models and block calls. Nothing is deleted.' },
        'kb.pv.sw.aria': { kybernos: '{slug} activé', en: '{slug} enabled' },
        'kb.pv.zone.del': { kybernos: 'Supprimer le fournisseur', en: 'Delete provider' },
        'kb.pv.zone.del.d': { kybernos: 'Le retire avec ses modèles, ses surcharges et sa clé.', en: 'Removes it with its models, overrides and key.' },
        'kb.pv.hostnote': { kybernos: 'Désactiver demande un redémarrage de DSH : la nouvelle version n’est pas encore chargée.', en: 'Disabling needs a DSH restart: the new version is not loaded yet.' },
        'kb.pv.err.pick': { kybernos: 'Choisis un fournisseur.', en: 'Choose a provider.' },
        'kb.pv.err.slug': { kybernos: 'Identifiant invalide : minuscules, chiffres et tirets.', en: 'Invalid identifier: lowercase letters, digits and dashes.' },
        'kb.pv.err.taken': { kybernos: 'Ce fournisseur existe déjà.', en: 'This provider already exists.' },
        'kb.pv.err.url': { kybernos: 'URL de base invalide : http(s) requis.', en: 'Invalid base URL: http(s) required.' },
        'kb.pv.err.models': { kybernos: 'Ajoute au moins un modèle : rien ne peut le deviner.', en: 'Add at least one model: nothing can default it.' },
        'kb.pv.err.template': { kybernos: 'Remplace ${…} par les valeurs de ton compte.', en: 'Replace the ${…} with your account’s values.' },
        'kb.pv.search': { kybernos: 'Rechercher un fournisseur ou un modèle', en: 'Search providers or models' },
        'kb.pv.search.none': { kybernos: 'Aucun fournisseur ne correspond.', en: 'No matching providers.' },
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
        'kb.models.tri.score': { kybernos: 'Score (le plus haut d’abord)', en: 'Score (highest first)' },
        'kb.models.filter.score': { kybernos: 'Score', en: 'Score' },
        'kb.models.score.any': { kybernos: 'Tous', en: 'Any' },
        'kb.models.score.min': { kybernos: '{n} et plus', en: '{n}+' },
        'kb.models.score.badge': { kybernos: 'Indice d’intelligence {n} — Artificial Analysis (plus haut = mieux)', en: 'Intelligence index {n} — Artificial Analysis (higher is better)' },
        'kb.models.tri.name': { kybernos: 'Nom', en: 'Name' },
        'kb.models.tri.context': { kybernos: 'Contexte', en: 'Context' },
        'kb.models.tri.provider': { kybernos: 'Fournisseur', en: 'Provider' },
        // SHORT values for the filter trigger: the Settings box is only
        // 556 or 720 px wide, « Provider · All providers » on four filters wrapped
        // there. The drop-down menu keeps the long labels.
        'kb.models.opt.allprov': { kybernos: 'Tous', en: 'All' },
        'kb.models.opt.alltypes': { kybernos: 'Tous', en: 'All' },
        'kb.models.opt.anystatus': { kybernos: 'Indifférent', en: 'Any' },
        'kb.models.reset': { kybernos: 'Réinitialiser les filtres', en: 'Reset filters' },
        'kb.models.count': { kybernos: '{a} sur {b} modèles', en: '{a} of {b} models' },
        'kb.models.syncN': { kybernos: 'Synchroniser {n} depuis models.dev', en: 'Sync {n} from models.dev' },
        'kb.models.col.model': { kybernos: 'Modèle', en: 'Model' },
        'kb.models.col.prov': { kybernos: 'Fournisseur', en: 'Provider' },
        'kb.models.col.caps': { kybernos: 'Capacités', en: 'Capabilities' },
        'kb.models.col.context': { kybernos: 'Contexte', en: 'Context' },
        'kb.models.col.price': { kybernos: 'Prix entrée / sortie', en: 'Price in / out' },
        'kb.models.col.source': { kybernos: 'Source', en: 'Source' },
        'kb.models.col.synced': { kybernos: 'Synchronisé', en: 'Synced' },
        'kb.models.col.pending': { kybernos: 'Pas encore synchronisé', en: 'Not synced' },
        'kb.models.col.nosync': { kybernos: 'Sans fiche', en: 'No match' },
        'kb.models.col.fetching': { kybernos: 'Synchronisation…', en: 'Fetching…' },
        'kb.models.col.previewed': { kybernos: '{n} prévisualisées', en: '{n} previewed' },
        'kb.models.ovline': { kybernos: '{n} surcharges · {m} appliquées', en: '{n} overrides · {m} applied' },
        'kb.models.ovline1': { kybernos: '1 surcharge · {m} appliquée', en: '1 override · {m} applied' },
        // The row's amber pill: short on screen, complete in the tooltip.
        'kb.models.ovpill': { kybernos: '{n} surcharges', en: '{n} overrides' },
        'kb.models.ovpill1': { kybernos: '1 surcharge', en: '1 override' },
        'kb.models.ovtip': { kybernos: '{n} surcharges déclarées · {m} changent réellement le harnais', en: '{n} overrides declared · {m} actually change the harness' },
        'kb.models.textonly': { kybernos: 'Texte seul', en: 'Text only' },
        'kb.models.more': { kybernos: '+{n}', en: '+{n}' },
        'kb.models.prov.local': { kybernos: 'Ajouté ici', en: 'Added here' },
        'kb.models.w.unknown': { kybernos: 'Inconnu', en: 'Unknown' },
        'kb.models.w.open': { kybernos: 'Poids ouverts', en: 'Open weights' },
        'kb.models.w.closed': { kybernos: 'Poids fermés', en: 'Closed weights' },
        // model types
        'kb.models.t.chat': { kybernos: 'Chat', en: 'Chat' },
        'kb.models.t.embedding': { kybernos: 'Embedding', en: 'Embedding' },
        'kb.models.t.image': { kybernos: 'Image', en: 'Image' },
        'kb.models.t.video': { kybernos: 'Vidéo', en: 'Video' },
        'kb.models.t.audio': { kybernos: 'Audio', en: 'Audio' },
        'kb.models.t.realtime': { kybernos: 'Temps réel', en: 'Realtime' },
        'kb.models.t.rerank': { kybernos: 'Rerank', en: 'Rerank' },
        'kb.models.t.moderation': { kybernos: 'Modération', en: 'Moderation' },
        'kb.models.phase.sample': { kybernos: 'Jeu de données figé — aucune écriture (phase sans câblage)', en: 'Fixed sample data — nothing is written (pre-wiring phase)' },
        'kb.models.phase.live': { kybernos: 'Catalogue vivant — les réglages marqués d\u2019un maillon s\u2019appliquent déjà à DSH', en: 'Live data — the settings marked with a link already apply to DSH' },
        'kb.models.loading': { kybernos: 'Lecture de tes réglages…', en: 'Reading your settings…' },
        'kb.models.reload': { kybernos: 'Réessayer', en: 'Retry' },
        'kb.models.loaderror': { kybernos: 'Lecture impossible', en: 'Load failed' },
        // A route of this plugin's host half that does not answer (DSH not restarted after an update): the same sentence as the other settings pages.
        'kb.models.hostdown': { kybernos: 'L’assistant de cette page ne répond pas. Si DSH vient d’être mis à jour, redémarre DSH, puis appuie sur Réessayer.', en: 'This page’s helper is not answering. If DSH was just updated, restart DSH, then press Retry.' },
        'kb.models.empty.live': { kybernos: 'aucun modèle configuré dans llm-pi-ai', en: 'no model configured in llm-pi-ai' },
        'kb.models.route': { kybernos: 'route', en: 'route' },
        // ── « AI provider and models » header block (settings.models.header) ──
        // ── Kybernos Cloud card (redesign of 2026-09-21, from the mock-up) ─
        // The English follows the mock-up word for word; the French translates it.
        'kb.hero.badge': { kybernos: 'Recommandé', en: 'Recommended' },
        'kb.hero.connected': { kybernos: 'Connecté', en: 'Connected' },
        'kb.hero.title.free': { kybernos: 'Commence gratuitement', en: 'Start for free' },
        'kb.hero.title.in': { kybernos: '{n} modèles inclus', en: '{n} models included' },
        'kb.hero.title.in.one': { kybernos: '1 modèle inclus', en: '1 model included' },
        'kb.hero.connect': { kybernos: 'Connecter Kybernos Cloud', en: 'Connect to Kybernos Cloud' },
        'kb.hero.connect.short': { kybernos: 'Connecter', en: 'Connect' },
        'kb.hero.addkey.short': { kybernos: 'ou ajouter une clé', en: 'or add a key' },
        'kb.hero.models.tip': { kybernos: 'Voir les modèles de Kybernos Cloud', en: 'See the Kybernos Cloud models' },
        'kb.hero.connect.tip': { kybernos: 'Ouvre la carte Kybernos Cloud (appairage, profil, import des modèles).', en: 'Opens the Kybernos Cloud card (pairing, profile, model import).' },
        'kb.hero.addkey': { kybernos: 'Ajoute ta clé d\u2019API', en: 'Add your API key' },
        'kb.hero.addkey.tip': { kybernos: 'Ouvre l\u2019ajout de fournisseur natif — ta propre clé, ta propre route ; la carte n\u2019écrit rien.', en: 'Opens the native Add provider flow — your own key, your own route; the card writes nothing.' },
        'kb.models.local': { kybernos: 'ligne locale — non déclarée dans tes réglages', en: 'local row — not declared in your settings' },
        'kb.models.readonly': { kybernos: 'Le harnais est en LECTURE SEULE : aucune écriture possible.', en: 'The harness is READ-ONLY: no write is possible.' },
        'kb.models.error.remote': { kybernos: 'remotes indisponibles', en: 'remotes unavailable' },
        'kb.models.error.readonly': { kybernos: 'harnais en lecture seule', en: 'harness is read-only' },
        'kb.models.error.nokey': { kybernos: 'renseigne la route et l identifiant', en: 'set the route and the model id' },
        'kb.models.error.path': { kybernos: 'chemin d écriture inconnu', en: 'unknown write path' },
        'kb.models.error.local': { kybernos: 'ligne locale : les champs appliqués exigent un modèle déclaré', en: 'local row: applied fields need a declared model' },
        'kb.models.error.number': { kybernos: 'entre un nombre positif (131072, 256K, 1M)', en: 'enter a positive count (131072, 256K, 1M)' },
        'kb.models.error.wire': { kybernos: 'valeur non traduisible (niveaux de raisonnement inconnus : synchronise d abord)', en: 'value cannot be translated (unknown reasoning levels: sync first)' },
        'kb.models.error.conflict': { kybernos: 'Tes réglages ont changé entre-temps — relus', en: 'Your settings changed meanwhile — reloaded' },
        'kb.models.error.refus': { kybernos: 'refus du harnais', en: 'harness refusal' },
        'kb.models.error.reseau': { kybernos: 'erreur réseau', en: 'network error' },
        'kb.models.error.index': { kybernos: "l index models.dev n est pas disponible sur ce poste — les valeurs de tes réglages restent la seule source", en: 'the models.dev index is not available on this machine — the values in your settings remain the only source' },
        'kb.models.error.herite': { kybernos: 'les modèles de cette route viennent d une couche inférieure — ce panneau ne réécrit pas une liste héritée', en: 'this route\'s models come from a lower layer — this panel does not rewrite an inherited list' },
        'kb.models.input.implicite.route': { kybernos: 'input non déclaré : les pastilles montrent le défaut de la route', en: 'input not declared: the chips show the route default' },
        'kb.models.input.implicite.defaut': { kybernos: 'input non déclaré : les pastilles montrent le défaut du harnais (texte)', en: 'input not declared: the chips show the harness default (text)' },
        'kb.models.remove.annotations': { kybernos: 'Effacer les annotations de', en: 'Clear annotations of' },
        'kb.models.remove.note': { kybernos: 'annotations effacées — les surcharges de tes réglages restent (retire-les champ par champ)', en: 'annotations cleared — the overrides in your settings remain (remove them field by field)' },
        'kb.models.restore.arm': { kybernos: 'Confirmer : retirer TOUTES les surcharges ?', en: 'Confirm: remove ALL overrides?' },
        'kb.models.restore.note': { kybernos: 'surcharges retirées : ', en: 'overrides removed: ' },
        'kb.models.error.nomatch': { kybernos: 'models.dev ne connaît pas ce modèle — aucun préremplissage', en: 'models.dev does not know this model — no prefill' },
        'kb.models.error': { kybernos: 'Écriture refusée', en: 'Write refused' },
      }
      const m = (key, vars) => {
        const lang = kbIsFr() ? 'kybernos' : 'en'
        const entry = KB_M_T[key]
        let text = entry === null || entry === undefined ? key : (entry[lang] !== undefined ? entry[lang] : (entry.en !== undefined ? entry.en : key))
        if (vars !== null && vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }

      // ── icons: exact paths of the mock-up (Lucide) ─────────────────────
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
        alert: ['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
        link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
        tag: ['M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
        external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
        plus: ['M12 5v14', 'M5 12h14'],
        pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
        more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
        x: ['M6 6l12 12', 'M18 6 6 18'],
        undo: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
        // the Kybernos Cloud card (mock-up 2026-09-21): CTA arrow,
        // personal API key, cloud (brand, path of the kybernos-cloud plugin)
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

      // ── styles: the same contract as the repository's other plugins ───────────
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

      // ── DSH-CONTROLS:BEGIN ── (generated by scripts/build-model-catalog-css.mjs) ──
      // @deepseek-ai/dsh-client-ui-primitives@0.1.6-alpha.2 — 21761 characters, 11 modules.
      const DSH_CONTROLS_CSS = "/* ── Button — the actions (h36 r18 capsule, primary/ghost/outline/toolbar variants) ─────────────────────────────── */\n/* Capsule geometry from the figma Button component (1:155 instances:\n * h36, pad 14/7, gap 4, r18; the wide New Session form is r24 at h38 —\n * owners with the wide form set their own radius/width). */\n.kbm-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  border: none;\n  border-radius: 18px;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  padding: 0 14px;\n}\n\n.kbm-btn:disabled {\n  cursor: not-allowed;\n  opacity: 0.4;\n}\n\n.kbm-btn-md {\n  height: 36px;\n}\n\n/* Compact height for dense rows; no dedicated figma node (Icon_container\n * 28x28 is the icon-only form) — geometry is ours. */\n.kbm-btn-sm {\n  height: 28px;\n  font-size: 12px;\n  line-height: 18px;\n  padding: 0 10px;\n  border-radius: 14px;\n}\n\n.kbm-btn-primary {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n\n.kbm-btn-primary:hover:not(:disabled) {\n  background: var(--dsw-alias-button-primary-hover);\n}\n\n.kbm-btn-ghost:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-ghost:active:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n/* Dialog Cancel (figma 451:18655): bordered capsule on transparent fill. */\n.kbm-btn-outline {\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: transparent;\n}\n\n.kbm-btn-outline:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-btn-toolbar {\n  background: var(--dsw-alias-button-tool-bar-fill);\n}\n\n.kbm-btn-toolbar:hover:not(:disabled) {\n  background: var(--dsw-alias-button-tool-bar-hover);\n}\n\n.kbm-btn-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n}\n\n/* ── Input — the search field (wrap + icon + input) ─────────────────────────────── */\n.kbm-in-wrap {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 32px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.kbm-in-wrap:focus-within {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.kbm-in-icon {\n  display: inline-flex;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-in-input {\n  flex: 1;\n  min-width: 0;\n  border: none;\n  outline: none;\n  background: transparent;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-in-input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n/* ── Pill — the selectable filter chips ─────────────────────────────── */\n.kbm-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 24px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.kbm-pill-interactive {\n  cursor: pointer;\n}\n\n.kbm-pill-interactive:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.kbm-pill-active {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-button-ghost-active-fill);\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border);\n}\n\n/* ── Tag — the read-only labels (8 tones) ─────────────────────────────── */\n/* Capsule geometry is fixed: a tag reads as one size everywhere, and only its\n * palette varies. Tone colors ride background/border/color so a render site can\n * still position the tag with its own class without touching the palette. */\n.kbm-tag {\n  display: inline-flex;\n  align-items: center;\n  border-radius: 999px;\n  corner-shape: round;\n  padding: 1px 8px;\n  font-size: 11px;\n  line-height: 17px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.kbm-tag[data-tone='outline'] {\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-tag[data-tone='solid'] {\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n\n.kbm-tag[data-tone='neutral'] {\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-tag[data-tone='quiet'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Status tones tint their own color for the fill, so a palette change moves\n * fill and text together and neither needs a second token. The tint is 10%,\n * except `warning`, which keeps the 12% the plugin inventory's conditional\n * tag shipped with — matching it is what makes this a pure consolidation. */\n.kbm-tag[data-tone='success'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-tag[data-tone='info'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.kbm-tag[data-tone='warning'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-tag[data-tone='danger'] {\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* ── StateDot — the state dots (done/warning/error/idle) ─────────────────────────────── */\n/* Ongoing blue has no alias token (state-business-primary is the 500 step,\n * not this 450) — component-level var pinned to the static scale instead. */\n.kbm-dot,\n.kbm-dot-matrix {\n  --dsh-state-ongoing: var(--dsw-static-deepseek-450);\n}\n\n/* Solid states: same-color halo via a 0.10-opacity outer layer (::before)\n * with a 6/10-scale solid core. Layer color rides currentColor set per state. */\n.kbm-dot {\n  position: relative;\n  display: inline-block;\n  flex: none;\n}\n\n.kbm-dot::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n  opacity: 0.1;\n}\n\n.kbm-dot::after {\n  content: '';\n  position: absolute;\n  inset: 20%;\n  border-radius: 50%;\n  corner-shape: round;\n  background: currentColor;\n}\n\n.kbm-dot[data-state='done'] {\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.kbm-dot[data-state='warning'] {\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n.kbm-dot[data-state='error'] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* Idle is the absence of activity, not a fourth outcome: it stays on the\n * tertiary label color so it recedes beside the three outcome colors. */\n.kbm-dot[data-state='idle'] {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Pixel chase: each outer cell holds a discrete brightness step (flat keyframe\n * holds, no tweening — the retro feel), peaking when the chase hits it and\n * decaying over the next three cells. Phase offsets come from per-rect\n * animation-delay (index * -125ms) set inline by the component. */\n.kbm-dot-matrix {\n  flex: none;\n  color: var(--dsh-state-ongoing);\n}\n\n.kbm-dot-cell {\n  fill: currentColor;\n  opacity: 0.15;\n  animation: kbm-dsh-state-dot-chase 1s infinite;\n}\n\n@keyframes kbm-dsh-state-dot-chase {\n  0%, 12.4% { opacity: 1; }\n  12.5%, 24.9% { opacity: 0.6; }\n  25%, 37.4% { opacity: 0.35; }\n  37.5%, 100% { opacity: 0.15; }\n}\n\n/* ── Switch — the switches ─────────────────────────────── */\n/* The on/off appearance keys off aria-checked rather than a parallel class, so\n * the visual state cannot disagree with the state assistive technology reads.\n *\n * The track is a capsule: its radius is half its height, so the corners consume\n * the whole side and the global superellipse would square the ends off against\n * the round thumb inside it. `corner-shape: round` opts the track out, the way\n * every full-round radius does. The corner-shape spec does not catch this one —\n * it recognizes 50%, 100%, and radii at or above 99px, not a radius that is\n * full-round only relative to its own box. */\n.kbm-sw {\n  box-sizing: border-box;\n  position: relative;\n  flex: 0 0 auto;\n  width: 36px;\n  height: 20px;\n  padding: 2px;\n  border: 0;\n  border-radius: 10px;\n  corner-shape: round;\n  background: var(--dsw-alias-border-l3);\n  cursor: pointer;\n}\n\n.kbm-sw[aria-checked='true'] {\n  background: var(--dsw-alias-brand-primary);\n}\n\n.kbm-sw:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.kbm-sw:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-sw-thumb {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  corner-shape: round;\n  background: var(--dsw-alias-label-primary-foreground);\n  transition: transform 120ms ease;\n}\n\n.kbm-sw[aria-checked='true'] .kbm-sw-thumb {\n  transform: translateX(16px);\n}\n\n/* ── Checkbox — the checkboxes ─────────────────────────────── */\n.kbm-ck {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 14px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.kbm-ck input {\n  flex: 0 0 auto;\n  width: 16px;\n  height: 16px;\n  margin: 0;\n  accent-color: var(--dsw-alias-brand-primary);\n  cursor: inherit;\n}\n\n.kbm-ck input:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.kbm-ck:has(input:disabled) {\n  cursor: default;\n  opacity: 0.5;\n}\n\n/* ── Menu — the dropdown menus (routes, sort) ─────────────────────────────── */\n.kbm-menu-root {\n  position: relative;\n  display: inline-flex;\n}\n\n/* Dropdown card (figma MenuDropdown 122:9481 / 419:16920): menu surface,\n * r12, elevation-prominent (hairline stroke in shadow), 4px inset padding. */\n.kbm-menu-list,\n.kbm-menu-submenu {\n  /* min-widths below are the design's outer card widths — include the pad. */\n  box-sizing: border-box;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n  border: 0;\n  border-radius: 20px;\n  background: var(--dsw-specific-menu);\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  box-shadow: var(--dsw-elevation-prominent);\n  /* Elevated surface: the scrollbar thumb takes the l2 elevation tokens. The\n     declaration sits on the card rather than on `.scrollable .viewport`\n     because the elevation is a property of this surface, and the custom\n     properties inherit down to whichever descendant actually scrolls (see\n     ui-theme styles/scrollbar.css for the rebinding contract). */\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n/* Primary card is 218 wide in the design across both hosts. */\n.kbm-menu-list {\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n  z-index: 100;\n  min-width: 218px;\n  max-width: 360px;\n}\n\n/* Portal mode: fixed in the viewport, coordinates supplied inline from the\n * anchor rect (side/align resolved in JS, the in-place offset rules above\n * don't apply). Portaled lists must layer above modal overlays (z 1000) —\n * an anchor inside a dialog still expects its menu on top. */\n.kbm-menu-portal {\n  position: fixed;\n  top: auto;\n  left: auto;\n  z-index: 1100;\n}\n\n/* Open above the anchor (empty-state workspace chip: figma 122:9481). */\n.kbm-menu-sideTop {\n  top: auto;\n  bottom: calc(100% + 4px);\n}\n\n.kbm-menu-alignEnd {\n  left: auto;\n  right: 0;\n}\n\n/* Viewport fit: the card stops 12px short of the viewport's top/bottom edges\n * (24 = 2 × the portal MARGIN in Menu.tsx) and taller content scrolls inside\n * .viewport, so a pinned .footer stays visible. Menus with submenu rows skip\n * this class — the overflow clip would crop the side card, so they rely on\n * staying short. */\n.kbm-menu-scrollable {\n  max-height: calc(100vh - 24px);\n}\n\n.kbm-menu-viewport {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n}\n\n.kbm-menu-scrollable .kbm-menu-viewport {\n  overflow-y: auto;\n}\n\n/* Pinned rows below the scroll region; l2 hairline (l1 is near-invisible on\n * the menu surface) mirrors the .separator spacing. */\n.kbm-menu-footer {\n  flex: none;\n  display: flex;\n  flex-direction: column;\n  margin-top: 4px;\n  padding-top: 4px;\n  border-top: 0.5px solid var(--dsw-alias-border-l2);\n}\n\n.kbm-menu-itemWrap {\n  position: relative;\n}\n\n/* Menu cell (figma .Menu_cell): min-h 40, r10, pad 10/8, 14/22 primary,\n * gap 8 between leading icon / label / trailing check. */\n.kbm-menu-item {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 40px;\n  padding: 8px 10px;\n  border: none;\n  border-radius: 10px;\n  background: transparent;\n  cursor: pointer;\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n  text-align: left;\n}\n\n.kbm-menu-item:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Arrow navigation moves real focus, so the row the keyboard is on carries the\n   same fill the pointer gets: the fill is the row's focus indication, and the\n   browser's default ring would double it. */\n.kbm-menu-item:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: none;\n}\n\n.kbm-menu-denseList .kbm-menu-item {\n  min-height: 34px;\n  padding-block: 5px;\n}\n\n.kbm-menu-denseList .kbm-menu-label {\n  padding-block: 4px;\n}\n\n.kbm-menu-list.kbm-menu-compactList,\n.kbm-menu-submenu.kbm-menu-compactList {\n  min-width: 164px;\n  padding: 2px;\n  border-radius: 7px;\n}\n\n.kbm-menu-compactList .kbm-menu-item {\n  min-height: 26px;\n  gap: 6px;\n  padding: 3px 7px;\n  border-radius: 5px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.kbm-menu-compactList .kbm-menu-itemIcon {\n  width: 14px;\n  height: 14px;\n}\n\n.kbm-menu-compactList .kbm-menu-separator {\n  margin: 2px;\n}\n\n.kbm-menu-compactList .kbm-menu-label {\n  padding: 4px 7px;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.kbm-menu-item:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.kbm-menu-itemIcon {\n  display: inline-flex;\n  flex: none;\n  width: 16px;\n  height: 16px;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.kbm-menu-itemLabel {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.kbm-menu-check {\n  flex: none;\n  color: var(--dsw-alias-label-primary);\n}\n\n/* Selected cell keeps the plain fill (marker is the trailing check); the\n * class remains as a hook for owner-side emphasis. */\n.kbm-menu-selected {\n  background: transparent;\n}\n\n/* Fill-mode selection: the row holds the hover fill instead of a check. */\n.kbm-menu-selectedFill {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Destructive row: error text/icon, danger hover fill. */\n.kbm-menu-danger {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger .kbm-menu-itemIcon {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.kbm-menu-danger:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n}\n\n.kbm-menu-danger:focus-visible:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  outline: none;\n}\n\n/* Heading row: non-interactive small grey text, padding aligned with items. */\n.kbm-menu-label {\n  padding: 8px 10px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Separator cell (figma 122:9481): py 4 / px 2 around the hairline. */\n.kbm-menu-separator {\n  height: 0.5px;\n  margin: 4px 2px;\n  background: var(--dsw-alias-border-l1);\n}\n\n/* Nested card to the right of the parent row (figma 419:16920).\n * Bottom-aligned with the parent menu card (grows upward): itemWrap sits in\n * .list's 4px pad, so bottom: -4px matches the list's outer bottom edge.\n * Horizontal: list pad (4px) + 6px card gap = 10px past itemWrap — plain\n * `100% + 6px` collapses to ~2px between outer card edges.\n * ::before bridges the full gap so the pointer can cross without mouseLeave. */\n.kbm-menu-submenu {\n  position: absolute;\n  top: auto;\n  bottom: -4px;\n  left: calc(100% + 10px);\n  z-index: 101;\n  min-width: 163px;\n}\n\n.kbm-menu-submenu::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  left: -10px;\n  width: 10px;\n}\n\n/* ── Modal — the detail surface ─────────────────────────────── */\n/* Full-viewport layer (figma Mask + Dialog 451:18655): mask + centered card. */\n.kbm-mdl-root {\n  position: fixed;\n  inset: 0;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 24px;\n}\n\n/* User/spec mask: rgba(0,0,0,0.24) + blur(2px) via --dsw-alias-bg-mask-1 /\n   --dsw-mask-blur (light); dark theme raises mask opacity. */\n.kbm-mdl-mask {\n  position: absolute;\n  inset: 0;\n  background: var(--dsw-alias-bg-mask-1);\n  backdrop-filter: var(--dsw-mask-blur);\n}\n\n/* Dialog card: r24, elevation-prominent, layer-2 fill, pb 24. */\n.kbm-mdl-dialog {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  width: min(380px, 100%);\n  padding: 0 0 24px;\n  overflow: hidden;\n  border: 0;\n  border-radius: 24px;\n  background: var(--dsw-alias-bg-layer-2);\n  box-shadow: var(--dsw-elevation-prominent);\n}\n\n.kbm-mdl-content {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n}\n\n/* Header row (figma Title row): pad l24/t22/r14/b12, SPACE_BETWEEN —\n * title left, close button right. */\n.kbm-mdl-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 22px 14px 12px 24px;\n}\n\n.kbm-mdl-title {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500; /* figma wt510, rendered 500 */\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-close {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.kbm-mdl-close:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* Description and body share the 332px content column (24px side pads). */\n.kbm-mdl-description {\n  margin: 0;\n  padding: 0 24px;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 400;\n  color: var(--dsw-alias-label-primary);\n}\n\n.kbm-mdl-body {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  margin-top: 20px;\n  padding: 0 24px;\n}\n\n.kbm-mdl-footer {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 0 24px;\n}\n\n/* ── Tooltip — the help bubbles ─────────────────────────────── */\n.kbm-tip-bubble {\n  position: fixed;\n  z-index: 100;\n  /* Fixed-position shrink-to-fit measures only the space from `left` to the\n     viewport edge, so anchors near the right edge would wrap early;\n     max-content sizes by the label alone, capped at half the viewport. */\n  width: max-content;\n  max-width: 50vw;\n  padding: 3px 7px;\n  border-radius: 8px;\n  background: var(--dsw-alias-tooltip-bg);\n  color: var(--dsw-static-neutral-bluish-00);\n  font-size: 13px;\n  line-height: 20px;\n  white-space: pre-line;\n  /* Unbreakable tokens (URLs, paths) must not push past max-width. */\n  overflow-wrap: break-word;\n  pointer-events: none;\n  animation: kbm-tooltip-in 150ms var(--ds-ease-in-out);\n}\n\n.kbm-tip-bubble[data-side='right'] {\n  transform: translateY(-50%);\n}\n\n.kbm-tip-bubble[data-side='bottom'] {\n  transform: translateX(-50%);\n}\n\n.kbm-tip-bubble[data-side='top'] {\n  transform: translate(-50%, -100%);\n}\n\n@keyframes kbm-tooltip-in {\n  from { opacity: 0; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .kbm-tip-bubble {\n    animation: none;\n  }\n}\n\n/* ── DisclosureRow — the expandable row (title + content side by side) ─────────────────────────────── */\n/* Shared disclosure header: [16px leading] gap 6 [title 13/24] at the default\n   size. The Settings font-size preference moves the row through the\n   body-published axis: title size follows the secondary tier\n   (--dsh-content-font-size-secondary: one step under the body — setting −1 at\n   ≤14, setting −2 above), and the row height, leading box, and glyph edge\n   shift by the body px delta so the icon keeps its optical share of the\n   line. */\n\n.kbm-dr-root {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n}\n\n.kbm-dr-row {\n  position: relative;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  height: calc(24px + var(--dsh-content-font-delta, 0px));\n  min-width: 0;\n}\n\n.kbm-dr-row[data-expandable] {\n  cursor: pointer;\n}\n\n.kbm-dr-leading {\n  position: relative;\n  flex: none;\n  width: calc(16px + var(--dsh-content-font-delta, 0px));\n  height: calc(16px + var(--dsh-content-font-delta, 0px));\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  margin-right: 6px;\n  padding: 0;\n  border: none;\n  background: none;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Flow-row glyphs render at 14px inside the 16px box; the CSS edge overrides\n   each svg's own width/height attributes so every registered icon scales\n   without a per-callsite size prop. StateDot (its svg carries data-state)\n   stays at its fixed figma size — it is a status mark, not text furniture. */\n.kbm-dr-leading svg:not([data-state]) {\n  width: calc(14px + var(--dsh-content-font-delta, 0px));\n  height: calc(14px + var(--dsh-content-font-delta, 0px));\n}\n\nbutton.kbm-dr-leading {\n  cursor: pointer;\n}\n\n.kbm-dr-iconIdle {\n  display: inline-flex;\n  opacity: 1;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-chevronHover {\n  position: absolute;\n  inset: 0;\n  margin: auto;\n  opacity: 0;\n  transition: opacity 100ms ease;\n}\n\n.kbm-dr-row:hover .kbm-dr-iconIdle {\n  opacity: 0;\n}\n\n.kbm-dr-row:hover .kbm-dr-chevronHover {\n  opacity: 1;\n}\n\n.kbm-dr-title {\n  flex: none;\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: calc(24px + var(--dsh-content-font-delta, 0px));\n  color: var(--dsw-alias-label-secondary);\n}"
      // ── DSH-CONTROLS:END ──

      // ── the catalogue: definition of the mock-up's fields ───────────────
      // `wire` names the `llm-pi-ai` field this control REALLY writes —
      // absent = Kybernos annotation. It is the only table that decides the badge.
      //
      // Nothing invented: the only `compat` of the mock-up that has a real
      // equivalent is reasoning (`reasoningEfforts`); S2S, Search and Structured
      // output have NO matching field on the harness side (the ~20 `compat` switches
      // talk about reasoning format, developer role, maxTokens field,
      // chat template — not about those capabilities). Marking them
      // « applied » would be a lie: they stay annotations.
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
      // KB-MX-PURE-BEGIN
      // The capability columns of the models table: nine fixed slots, always in this order, so a column reads
      // top to bottom ("which models see images?"). Every other active capability (tts, video out, structured
      // output, temperature) has no slot and is counted in a "+N" cell; text OUT is the baseline and never counted.
      const KB_MATRIX = ['textIn', 'vision', 'audioIn', 'video', 'imageGen', 'search', 'tools', 's2s', 'reasoning']
      /** `activeKeys` (the capabilities a model has) → which slots are lit and which extras are left. Pure. */
      const kbMxSlots = (activeKeys) => {
        const act = Array.isArray(activeKeys) ? activeKeys : []
        return { slots: KB_MATRIX.map((k) => act.indexOf(k) >= 0), extras: act.filter((k) => KB_MATRIX.indexOf(k) < 0 && k !== 'textOut') }
      }
      // KB-MX-PURE-END
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

      // ── layer 1: what the harness knows without consulting anything ─────────────
      const BASE = {
        textIn: true, vision: false, video: false, audioIn: false, textOut: true, tts: false,
        imageGen: false, videoGen: false, tools: false, search: false, s2s: false,
        reasoning: false, structured: false, temperature: false, type: '',
        context: '', inputLimit: '', outputLimit: '',
        costIn: '', costOut: '', cacheRead: '', cacheWrite: '',
        family: '', knowledge: '', release: '', weights: '',
      }
      // ── layer 2: what a models.dev answer sets (frozen sample) ────
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

      // ── the state: a single store, subscribed to by the local React ─────────────────
      // `live` is THE switch: false = frozen set and no write (phase with no
      // wiring), true = remotes + settings.yaml (wired phase).
      // `live` = the panel reads settings.yaml and writes through the real channels.
      // The frozen mode stays reachable (`?kybernos-models=sample`): it is what the
      // step-1 proof checks, and it never writes anything.
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
        ds: {},
        dsDir: [],
        dsKey: { ref: '', configured: null },
        userProviders: {},
        baseProviders: {},
        // The external scores: the global instant (to tell the freshness) and
        // the state of the background read (to start only one at a time).
        scoresAt: null,
        // The headline score of each model ("route/id" → number), read in one call for the whole list.
        scoreOf: {},
        scoreLoaded: false,
        scoresRunning: false,
        scoresAskedAt: null,
        // The Kybernos Cloud account, as the Cloud card read it: null = not read yet · false = disconnected · true = connected.
        cloud: null,
        listeners: new Set(),
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
        // Decision of 2025-09-20: models.dev's value is shown AS SOON AS
        // the sheet is there, even if the synchronisation is not yet confirmed —
        // `kbmPending` marks it « filled in, not yet applied ».
        if (mo.remote[k] !== undefined) return mo.remote[k]
        return KBM.live === true ? '' : BASE[k]
      }
      /** Filled in by models.dev, not yet confirmed by the synchronisation. */
      const kbmPending = (mo, k) => kbmIsOv(mo, k) !== true && mo.synced !== true && mo.remote[k] !== undefined
      const kbmVal = (mo, k) => (kbmHas(mo.ov, k) ? mo.ov[k] : kbmUnder(mo, k))
      const kbmIsOv = (mo, k) => kbmHas(mo.ov, k)
      const kbmIsSync = (mo, k) => kbmIsOv(mo, k) !== true && mo.synced === true && mo.remote[k] !== undefined
      const kbmCountOv = (mo) => Object.keys(mo.ov).length
      /** A control applied to the harness, or a mere Kybernos annotation. */
      const kbmWireOf = (k) => {
        // The display name is an applied field, even though it lives in the model's
        // line and not in a section (`llm-pi-ai` → `modelOverrides.<id>.name`).
        if (k === 'name') return 'name'
        for (const c of CAPS) if (c.k === k && c.wire !== undefined) return c.wire
        for (const f of LIMITS) if (f.k === k && f.wire !== undefined) return f.wire
        return null
      }
      const kbmIsWired = (k) => kbmWireOf(k) !== null
      /** The split announced in the panel's foot — computed, never written.
       *  Six REAL fields (name, text input, image input, reasoningEfforts,
       *  contextWindow, maxTokens); every other control of the mock-up
       *  is a local annotation. */
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

      // ── writes: the value goes to memory first, then through the real channel ─────
      // Phase with no wiring: nothing leaves the page. Wired phase: the `wire`
      // fields go through `remote.settings.mutate` (settings.yaml, validated by
      // the service), the others through the plugin's annotations file.
      const kbmSave = (mo, k, v, ifRefused) => {
        if (KBM.live !== true) return true
        // Optimistic: the screen follows the gesture, the real channel (settings.yaml or
        // annotations file) answers afterwards; a refusal lands in
        // `mo.error` and stays shown on the row. `ifRefused` (optional) is called when the channel
        // refused, to take back what the screen showed on trust.
        Promise.resolve(kbMPersist(mo, k, v))
          .then((ok) => { if (ok === false && typeof ifRefused === 'function') ifRefused() })
          .catch(() => { /* kbMPersist never rejects */ })
        return true
      }
      /** The refusal that belongs to field `k` (drawn under it, inside the sheet), or null. It stays attached only while it is still
       *  the model's current message: a later error of another kind is drawn at the top of the sheet instead (A3-10). */
      const kbmFieldError = (mo, k) => (mo.error !== null && mo.error !== undefined && mo.errorAt !== null && mo.errorAt !== undefined && mo.errorAt.k === k && mo.errorAt.text === mo.error ? mo.error : null)
      const kbmFieldOwned = (mo) => mo.error !== null && mo.error !== undefined && mo.errorAt !== null && mo.errorAt !== undefined && mo.errorAt.text === mo.error
      const kbmSet = (mo, k, v) => {
        const had = Object.prototype.hasOwnProperty.call(mo.ov, k)
        const previous = mo.ov[k]
        const next = Object.assign({}, mo.ov)
        if (v === kbmUnder(mo, k)) delete next[k]
        else next[k] = v
        mo.ov = next
        // Cleared BEFORE saving: a refusal sets it again, and it used to be wiped right after (the write is refused
        // synchronously for a value that cannot be translated), so the user never saw why nothing changed.
        mo.error = null
        const takeBack = () => {
          const back = Object.assign({}, mo.ov)
          if (had) back[k] = previous
          else delete back[k]
          mo.ov = back
          kbmNotify()
        }
        if (kbmSave(mo, k, v, takeBack) !== true) { mo.error = m('kb.models.error'); kbmNotify(); return false }
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
      // « Restore defaults » = erase ALL the overrides, not the models.dev
      // values: it is exactly the mock-up's `clearOverrides`, and it
      // leaves the prefilled catalogue intact (the sync is not run again).
      // In real mode it is a WIDE write (every override of every
      // model): two clicks, and the number of overrides removed is shown.
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
        // Opening the sheet is asking what it will show: the notes
        // arrive after the render, never before (no screen waits for the network).
        if (mo.open === true && mo.scores === undefined && KBM.live === true) {
          kbMScoresLoad(mo, false).catch(() => { /* notes best-effort */ })
        }
      }
      const kbmRename = (mo, value) => {
        mo.name = value
        // The display name IS an applied field (`name`): it follows the same channel.
        if (mo.live === true || KBM.live === true) kbmSet(mo, 'name', value)
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
        // In real mode, a DECLARED model does not disappear from here: settings.yaml
        // serves it. The trash therefore erases its local annotations and SAYS so —
        // a line that comes back after a reload would be a lie.
        const k2 = kbMKey(mo)
        if (k2 === null) return
        Promise.resolve(kbMAnnotations(k2, null)).then(() => {
          const next = {}
          for (const k of Object.keys(mo.ov)) if (kbmIsWired(k) === true) next[k] = mo.ov[k]
          mo.ov = next
          mo.error = m('kb.models.remove.note')
          kbmNotify()
        }).catch((e) => {
          mo.error = m('kb.models.error.reseau') + sep() + String(e && e.message ? e.message : e)
          kbmNotify()
        })
      }
      /** Synchronisation: when frozen the sample is replayed; in real mode the
       *  host's models.dev index is read (one request, answers cached). */
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
        // Synchronising a row ALSO triggers the read of the two
        // score catalogues — in the background, once for all the
        // rows — then re-reads this model's notes.
        kbMScoresRefresh(false)
        Promise.resolve(kbMSyncLive(mo)).then(() => kbMScoresLoad(mo, false)).catch(() => { /* notes best-effort */ })
      }
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

      // ── phase with no wiring: the mock-up's frozen set ───────────────────
      const SAMPLE = [
        { route: 'groq', id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', open: false, synced: true, remote: Object.assign({}, BASE, REMOTE_LLAMA8), ov: {} },
        { route: 'groq', id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', open: false, synced: true, remote: Object.assign({}, BASE, REMOTE_LLAMA70), ov: {} },
        { route: 'openai', id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', open: true, synced: true, remote: Object.assign({}, BASE, REMOTE), ov: { search: true, context: '65536' } },
        { route: 'openai', id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B', open: false, synced: false, remote: {}, ov: {} },
      ]
      // The frozen set only exists OUTSIDE real mode: in real mode the panel starts
      // empty, reads settings.yaml, and never invents a line.
      if (KBM.live !== true) KBM.models = SAMPLE.map((s, i) => kbmMakeModel(s, 'ech-' + String(i + 1)))

      // ── rendering: the mock-up's building blocks ───────────────────────────────
      // KB-CAP-PURE-BEGIN
      // ── a context size as a short label ──
      // K is 1 000 and M is 1 000 000 on the way in (kbDsParseCapacity: "256K" is 256000) and on the way out, so a label
      // reads back as itself: 256000 is "256K", and 262144 is "262.1K", never "256K" (typed back, that would be 256000).
      // The exact count goes in the tooltip (kbCapExact). It used to read a multiple of 1024 as binary: 256000 showed
      // "250K" and 128000 "125K" (A3-11). Pure.
      const kbCapLabel = (v) => {
        const n = Number(v)
        if (v === '' || v === null || v === undefined || Number.isFinite(n) !== true || n <= 0) return ''
        const one = (x) => String(Math.round(x * 10) / 10)
        if (n >= 999950) return one(n / 1e6) + 'M'
        if (n >= 1000) return one(n / 1e3) + 'K'
        return String(n)
      }
      /** "262,144" — the exact count behind a label, or '' when there is none. Pure. */
      const kbCapExact = (v) => {
        const n = Number(v)
        return v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
      }
      // KB-CAP-PURE-END
      const pretty = kbCapLabel
      const Dot = (props) => h('span', { className: 'kbmp-dot ' + (props.src === 'ov' ? 'ov' : 'sync'), title: m(props.src === 'ov' ? 'kb.models.ov.src' : 'kb.models.sync.src') })
      /** « Applied to the harness » or « Kybernos annotation » marker. */
      const Mark = (props) => h('span', {
        className: 'kbm-mark' + (props.wire === true ? ' wire' : ''),
        title: m(props.wire === true ? 'kb.models.mark.wire' : 'kb.models.mark.note'),
        'data-kbm': props.wire === true ? 'mark-wire' : 'mark-note',
      }, Ic(props.wire === true ? 'link' : 'tag', 12))

      /** The kit's tooltip: an anchor (children) + a `kbm-tip-bubble` bubble
       *  revealed on hover and on keyboard focus. The native `title` waits
       *  a second and gets lost in the GUI; the kit's bubble is immediate,
       *  styled like the rest, and readable in the check screenshots. */
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
        // Icon only + the kit's tooltip: the sheet gains the width of the label
        // on every chip (14 capabilities + 8 types), the full label lives
        // in the bubble and the aria-label — same contract as the rows'
        // icons. (The native `title` waits ~1 s and gets lost in the GUI.)
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

      /** In real mode, a text field keeps its typing local and only writes
       *  settings.yaml on blur (or Enter): not one write per character,
       *  no invalid intermediate state in the file. */
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
        // At the real level, « clear » means REMOVE the key from settings.yaml:
        // the label says so, because the value that disappears may be the
        // user's (the harness then falls back on the catalogue).
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
            suffix === '' ? null : h('span', { className: 'kbm-suffix', title: def.pretty === true && kbCapExact(value) !== '' ? kbCapExact(value) : undefined }, suffix)),
          kbmFieldError(mo, def.k) !== null ? h('div', { className: 'kbm-ferr', 'data-kbm': 'field-error', role: 'alert' }, kbmFieldError(mo, def.k)) : null)
      }

      // ── external notes: what the two catalogues say about THIS model ────
      // Rendered READ-ONLY. Nothing here is a harness field nor a
      // Kybernos annotation: so there is no override pill, no
      // wiring marker, no way back — the value and its provenance,
      // and nothing else. A number without provenance is a number that lies.
      const kbNum = (v, dec) => {
        const n = Number(v)
        if (isFinite(n) !== true) return '—'
        const s = n.toFixed(dec === undefined ? 1 : dec)
        return kbIsFr() ? s.replace('.', ',') : s
      }
      /** AA publishes its evaluations as a fraction (0.5185) and its indices as points
       *  (−5.3): the percentage is rendered for the former, the point for the
       *  latter — an index is never converted into a percentage. */
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
      /** The evaluations shown, in reading order. */
      const AA_SHOW = ['scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'mmmuPro', 'lcr', 'critpt', 'tau2', 'tauBanking', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre', 'omniscience']
      /** BenchLM's categories, in order. */
      const BL_SHOW = ['coding', 'agentic', 'reasoning', 'knowledge', 'multimodalGrounded', 'instructionFollowing', 'multilingual', 'math', 'external']

      const ScoreLine = (props) => h('span', { className: 'kbm-sc-it' },
        // The label is sometimes long (« Terminal-Bench 4.0 »): the cell cuts it
        // rather than bend the grid, and the tooltip gives it whole.
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
            h('span', { className: 'kbm-sc-lic' }, 'Cc by-nc 4.0'),
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
          // The state CARRIES its name in the DOM: « being read » is not
          // « no score », and a check that waits for the absence must be able to
          // tell them apart — the old single attribute confused them and turned
          // green a read still in flight.
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
              // The name of the type comes from models.dev: when it is overridden, the
              // return label says WHAT it goes back to, as in the mock-up.
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
            // The notes come from TWO public pages, not from the harness: they
            // are neither editable nor marked, and the section says so.
            h(Section, { id: 'scores', label: 'kb.models.sec.scores', hint: m('kb.models.scores.hint'), wide: true },
              h(Scores, { mo: mo })),
            h('div', { className: 'kbm-note kbm-wirenote' }, m('kb.models.wire.note'))))
      }

      // ══ THE WIRED SCREEN ═════════════════════════════════════════════════════
      // The mock-up as it is wired: the mock-up's two tabs
      // (Providers first — the decision), the dense list and its filter, and
      // the editor that the arrow opens in a dialog. The `data-kbm` hooks do not
      // change: the contract of the two levels is the same, only the screen
      // changes. The screen state (tab, search, filters, sort) is not persisted
      // and writes nothing.

      const UI = { tab: 'providers', q: '', pq: '', prov: 'all', type: 'all', statut: 'any', tri: 'name', score: 'any', caps: {}, menu: null, page: 1, edit: null, showDown: false }
      // Changing a filter (or a tab) goes back to the first page: staying on
      // a page that no longer exists would show an empty list.
      const uiSet = (k, v) => { UI[k] = v; if (k !== 'page') UI.page = 1; kbmNotify() }
      const uiCap = (k) => { UI.caps[k] = UI.caps[k] !== true; UI.page = 1; kbmNotify() }
      /** The provider a model is shown under: its route, or the provider a companion route (its custom models) belongs to. */
      const kbProvOf = (route) => { const parent = kbCompanionOf(route, KBM.routes.concat(KBM.parked.map((x) => x.slug))); return parent === null ? route : parent }
      /** The routes that are providers: all but the companion routes (a provider's custom models). */
      const kbProvRoutes = () => { const known = KBM.routes.concat(KBM.parked.map((x) => x.slug)); return KBM.routes.filter((r) => kbCompanionOf(r, known) === null) }
      const uiProvs = () => {
        const out = []
        for (const mo of KBM.models) { const r = kbProvOf(mo.route); if (r !== '' && out.indexOf(r) < 0) out.push(r) }
        return out
      }
      const uiReset = () => {
        UI.q = ''
        UI.prov = 'all'
        UI.type = 'all'
        UI.statut = 'any'
        UI.tri = 'name'
        UI.score = 'any'
        UI.caps = {}
        kbmNotify()
      }
      const uiFiltre = () => {
        if (UI.q.trim() !== '' || UI.prov !== 'all' || UI.type !== 'all' || UI.statut !== 'any' || UI.score !== 'any') return true
        for (const k of Object.keys(UI.caps)) if (UI.caps[k] === true) return true
        return false
      }
      /** The mock-up's sort: on the DISPLAYED value, pending sheet
       *  included — not on a `val` that ignored unconfirmed values. */
      const uiNombre = (mo, k) => {
        const brut = String(kbmVal(mo, k) === null || kbmVal(mo, k) === undefined ? '' : kbmVal(mo, k)).replace(/[^0-9.]/g, '')
        const n = Number(brut)
        return brut !== '' && isFinite(n) ? n : -1
      }
      const uiRows = () => {
        const cherche = UI.q.trim().toLowerCase()
        const caps = CAPS.filter((c) => UI.caps[c.k] === true)
        const down = UI.statut === 'down' ? kbHealthDown(kbHealthGet()) : null
        // The models that do not answer are folded away until asked for: a list of 126 where 74 fail first shows the 52 that work.
        // A provider picked by name (its card, or the filter) is asked about as a whole: its models are all there, each with its reason on the row.
        const hidden = UI.statut !== 'down' && UI.showDown !== true && UI.prov === 'all' ? kbHealthDown(kbHealthGet()) : null
        const rows = KBM.models.filter((mo) => {
          if (hidden !== null && hidden[mo.route + '/' + mo.id] === true) return false
          if (UI.prov !== 'all' && kbProvOf(mo.route) !== UI.prov) return false
          if (UI.type !== 'all' && String(kbmVal(mo, 'type')) !== UI.type) return false
          if (UI.statut === 'ov' && kbmCountOv(mo) === 0) return false
          if (UI.statut === 'sync' && mo.synced !== true) return false
          if (UI.statut === 'pending' && mo.synced === true) return false
          if (UI.score !== 'any' && !(typeof KBM.scoreOf[mo.route + '/' + mo.id] === 'number' && KBM.scoreOf[mo.route + '/' + mo.id] >= Number(UI.score))) return false
          if (down !== null && down[mo.route + '/' + mo.id] !== true) return false
          for (const c of caps) if (kbmVal(mo, c.k) !== true) return false
          if (cherche !== '') {
            const foin = (mo.id + ' ' + mo.name + ' ' + mo.route + ' ' + String(kbmVal(mo, 'type'))).toLowerCase()
            if (foin.indexOf(cherche) < 0) return false
          }
          return true
        })
        if (UI.tri === 'context') return rows.sort((a, b) => uiNombre(b, 'context') - uiNombre(a, 'context'))
        if (UI.tri === 'score') return rows.sort((a, b) => kbScoreRank(KBM.scoreOf[b.route + '/' + b.id]) - kbScoreRank(KBM.scoreOf[a.route + '/' + a.id]) || String(a.name || a.id).localeCompare(String(b.name || b.id)))
        if (UI.tri === 'provider') return rows.sort((a, b) => (a.route + ' ' + a.id).localeCompare(b.route + ' ' + b.id))
        return rows.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
      }
      // KB-SCORE-PURE-BEGIN
      /** A sort key: the score, and a model without one after every model that has one. Pure. */
      const kbScoreRank = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : -1)
      /** The « Score ≥ » steps of the filter, only up to what the list reaches (no « 60+ » when nothing scores above 45). Pure. */
      const kbScoreSteps = (scores) => {
        const top = Math.max(0, ...Object.keys(scores || {}).map((k) => Number(scores[k])).filter((n) => Number.isFinite(n)))
        return [10, 20, 30, 40, 50, 60, 70].filter((n) => n <= top)
      }
      // KB-SCORE-PURE-END
      const uiCaps = (mo) => CAPS.filter((c) => kbmVal(mo, c.k) === true)
      /** The tooltip of a capability icon: the label THEN the link —
       *  an icon alone says neither what it names, nor whether the datum is
       *  applied to the harness or annotated (the panel's public contract). */
      const kbmCapTip = (c) => m(c.t) + ' — ' + (c.wire === undefined ? m('kb.models.mark.note') : m('kb.models.mark.wire'))
      const uiTypeDef = (mo) => TYPES.filter((t) => t.id === String(kbmVal(mo, 'type')))[0] || null
      const uiSync = (mo) => {
        if (mo.loading === true) return { txt: m('kb.models.col.fetching'), cls: 'wait' }
        if (mo.synced === true) return { txt: m('kb.models.col.synced'), cls: 'ok' }
        if (Object.keys(mo.remote).length > 0) return { txt: m('kb.models.col.pending'), cls: 'wait' }
        return { txt: m('kb.models.col.nosync'), cls: 'no' }
      }
      // The sheet's values are shown even when unconfirmed: and it SAYS so.
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
        // Offered while the health chip has something to say (and while it is the active choice, so the menu never shows a value it lacks).
      ].concat(kbHealthGet() !== null || UI.statut === 'down' ? [{ v: 'down', t: m('kb.models.statut.down') }] : [])
      const OPT_TRI = () => [
        { v: 'name', t: m('kb.models.tri.name') },
        { v: 'context', t: m('kb.models.tri.context') },
        { v: 'provider', t: m('kb.models.tri.provider') },
      ].concat(Object.keys(KBM.scoreOf).length > 0 ? [{ v: 'score', t: m('kb.models.tri.score') }] : [])

      const Loupe = () => h('svg', { className: 'kbmp-loupe', viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' },
        h('circle', { cx: 7, cy: 7, r: 4.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M10.6 10.6 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))

      /** A capability chip: it filters the list. Icon + label: eight
       *  mute pills did not say what they filtered. */
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

      /** DSH's `Menu`: a trigger + a list, closed on a click outside.
       *
       *  `props.field` — and NEVER `props.key`: React reserves `key` for
       *  reconciliation and does not pass it to the component. The four filters
       *  therefore read `UI[undefined]`, displayed « Provider · undefined » and
       *  applied nothing (the selection was written to `UI.undefined`). */
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

      // One skeleton helper for every list of the GUI, published by the core plugin (window.__KB_SKEL__: bones in the
      // boxes of the real rows, a soft shimmer, nothing under reduced motion). Without it the old line of text shows.
      const skelOf = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }

      /** A line of the dense list — and, when it is open, the mock-up's
       *  editor in a dialog. The dialog lives INSIDE the line (fixed position):
       *  the line's hooks stay valid as they are. */
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
        const label = mo.route === '' ? '—' : (KBM.live === true ? pvLabel(kbProvOf(mo.route)) : mo.route)
        const custom = mo.route !== '' && kbProvOf(mo.route) !== mo.route
        const mx = kbMxSlots(caps.map((c) => c.k))
        const capIcon = (c, size) => h(Tip, { key: c.k, text: kbmCapTip(c) }, h('span', { className: 'kbmp-capi', style: { color: c.tint } }, Ic(c.icon, size)))
        // ── MODEL : name, then "id · type · price". Narrow containers also show the provider and the capability
        //    icons on that line (the dedicated columns appear from 860 px).
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cmodel', key: 'm' },
          h('div', { className: 'kbmp-nameline' },
            h('input', Object.assign({
              className: 'kbm-in-input kbmp-nom', 'aria-label': m('kb.models.name'), 'data-kbm': 'model-name',
              title: mo.name || mo.id,
            }, draft))),
          h('div', { className: 'kbmp-metaline' },
            h('input', {
              className: 'kbm-in-input kbmp-id', value: mo.id, 'aria-label': m('kb.models.id'),
              'data-kbm': 'model-id', readOnly: KBM.live === true && mo.route !== '',
              title: mo.id, onChange: (ev) => { mo.id = ev.target.value; kbmNotify() },
            }),
            type === null ? null : h('span', { className: 'kbmp-msep kbmp-sep2', key: 'st' }, '·'),
            type === null ? null : h('span', { className: 'kbmp-mtype', key: 'ty' }, h('span', { className: 'kbmp-tyi', style: { color: type.tint } }, Ic(type.icon, 12)), m(type.t)),
            prix === null ? null : h('span', { className: 'kbmp-msep kbmp-sep2', key: 'sp' }, '·'),
            prix === null ? null : h('span', { className: 'kbmp-mprix', key: 'pr', title: m('kb.models.col.price') }, prix),
            typeof KBM.scoreOf[mo.route + '/' + mo.id] === 'number' ? h('span', { className: 'kbmp-score', key: 'sc', 'data-kbm': 'row-score', title: m('kb.models.score.badge', { n: KBM.scoreOf[mo.route + '/' + mo.id] }) }, 'II ' + String(KBM.scoreOf[mo.route + '/' + mo.id])) : null,
            props.down !== undefined ? h('span', { className: 'kbmp-why', 'data-kbm': 'row-why', title: props.down.code }, m('kb.health.rowwhy', { why: m(kbHealthWhy(props.down, kbHealthFree(props.down.route, mo.id, Object.keys(FREE_LINKS)))) })) : null,
            h('span', { className: 'kbmp-nar', key: 'nar' },
              KBM.live === true ? h('span', { className: 'kbmp-msep' }, '·') : null,
              KBM.live === true ? h('span', { className: 'kbmp-mcellroute' }, mo.route === '' ? null : h(LogoProv, { route: kbProvOf(mo.route), taille: 14 }), h('span', { className: 'kbmp-mroute', title: m('kb.models.route') + ' ' + mo.route }, label)) : null,
              caps.length === 0 ? null : h('span', { className: 'kbmp-caprow' }, visibles.map((c) => capIcon(c, 16)), reste > 0 ? h('span', { className: 'kbmp-plus' }, m('kb.models.more', { n: reste })) : null)))))
        // ── PROVIDER: its icon and its whole name (no more "ant…").
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cprov', key: 'p' },
          mo.route === '' ? h('span', { className: 'kbmp-dim' }, '—')
            : [h(LogoProv, { route: kbProvOf(mo.route), taille: 16, key: 'l' }), h('span', { className: 'kbmp-provname', key: 'n', 'data-kbm': 'row-route', title: m('kb.models.route') + ' ' + mo.route }, label), custom ? h('span', { className: 'kbpv-tag', key: 't', 'data-kbm': 'row-custom' }, m('kb.models.custom.tag')) : null]))
        // ── CAPABILITIES: the compact list (narrow) and the fixed-slot matrix (wide); CSS shows one.
        colonnes.push(h('div', { className: 'kbmp-c kbmp-ccaps', key: 'c' },
          caps.length === 0
            ? h('span', { className: 'kbmp-dim kbmp-capsl' }, '—')
            : h('span', { className: 'kbmp-caprow kbmp-capsl' },
              caps.slice(0, 4).map((c) => capIcon(c, 16)),
              (caps.length - 4 > 0 || (caps.length === 2 && caps[0].k === 'textIn' && caps[1].k === 'textOut'))
                ? h('span', { className: 'kbmp-txtonly' }, m('kb.models.textonly'))
                : null,
              caps.length - 4 > 0 ? h('span', { className: 'kbmp-plus' }, m('kb.models.more', { n: caps.length - 4 })) : null),
          h('span', { className: 'kbmp-mx', 'data-kbm': 'row-matrix' },
            KB_MATRIX.map((k, i) => h('span', { className: 'kbmp-mxc', key: k }, mx.slots[i] === true ? capIcon(CAPS.filter((c) => c.k === k)[0], 15) : h('span', { className: 'kbmp-mxoff', 'aria-hidden': 'true' }))),
            h('span', { className: 'kbmp-mxc', key: 'x' }, mx.extras.length === 0 ? null
              : h(Tip, { text: mx.extras.map((k) => m(CAPS.filter((c) => c.k === k)[0].t)).join(' · ') }, h('span', { className: 'kbmp-plus' }, '+' + String(mx.extras.length)))))))
        colonnes.push(h('div', { className: 'kbmp-c kbmp-cctx', key: 'x' },
          ctx === '' ? h('span', { className: 'kbmp-dim' }, '—') : h('span', { title: kbCapExact(ctx) !== '' ? kbCapExact(ctx) : undefined }, pretty(ctx) === '' ? ctx : pretty(ctx))))
        // ── SOURCE: where the values come from, then how many are yours (amber text, only when there are some:
        //    a pill on every row said nothing).
        colonnes.push(h('div', { className: 'kbmp-c kbmp-csrc', key: 's' },
          h('span', { className: 'kbmp-sy ' + sy.cls, title: sy.txt }, h('span', { className: 'kbmp-point' }), sy.txt),
          avis === null ? null : h('span', { className: 'kbmp-avis', title: avis }, avis),
          nOv > 0
            ? h(Tip, { text: m(nOv > 1 ? 'kb.models.ovline' : 'kb.models.ovline1', { n: nOv, m: kept }) + ' — ' + m('kb.models.ovtip', { n: nOv, m: kept }) },
              h('span', { className: 'kbmp-ovline', 'data-kbm': 'ovpill' }, m(nOv > 1 ? 'kb.models.ovpill' : 'kb.models.ovpill1', { n: nOv })))
            : null))
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
        // While the sheet is open its mask covers the row: the message is drawn inside the sheet then (A3-10).
        ouvert !== true && mo.error !== null && mo.error !== undefined ? h('div', { className: 'kbmp-err', 'data-kbm': 'row-error', role: 'status' }, String(mo.error)) : null,
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
          h('div', { className: 'kbm-mdl-body kbmp-mdlbody' },
            mo.error !== null && mo.error !== undefined && kbmFieldOwned(mo) !== true ? h('div', { className: 'kbmp-err kbmp-err-mdl', 'data-kbm': 'modal-error', role: 'alert' }, String(mo.error)) : null,
            h(Details, { mo: mo }))))
          : null)
      }

      /** The catalogue list is long: it is cut into pages (10 lines),
       *  and the footer always says where we are in the filtered total. */
      const ROWS_PAR_PAGE = 10
      /** The catalogue list: dense, its filters, its counter. The old
       *  « Providers » tab is melted in: the native rows below
       *  already manage the providers (key, route, deletion) — a duplicate
       *  of the same list said nothing more. The API key and the base
       *  URL stay OUTSIDE the panel (the warning says so at the top). */
      // « Providers » tab: DSH's native section stays EMPTY under our
      // panel — DSH's Edit/Delete rows live in the native
      // « Models » page, not in this section — so the tab showed nothing
      // at all while announcing « Providers 9 » (finding of the visual
      // campaign). Here we list what the host really exposes: the route and the
      // number of models it carries. Nothing is invented.
      // ── provider logos: Simple Icons CDN, initial-chip fallback ──────
      // A missing logo (offline, unknown route) breaks nothing: the chip
      // takes the first letter of the route. Mapping by substring, because
      // real routes carry suffixes (qwen-token-plan, vercel-ai-
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
        const found = LOGO_SLUGS.find((p) => r.indexOf(p[0]) >= 0)
        return found === undefined ? null : found[1]
      }
      // KB-LOGO-PURE-BEGIN
      // A provider logo comes from this bundle (logos/, served by /kybernos-models/logo), never from a third-party CDN: a page that shows
      // twenty logos must not tell a CDN which providers a person looks at (it used to ask an icon CDN). The slugs above are
      // simple-icons names; each maps to the models.dev logo the bundle ships, and a provider without one shows its initial.
      const LOGO_ALIAS = { googlegemini: 'google', qwen: 'alibaba', ollama: 'ollama-cloud', mistralai: 'mistral', together: 'togetherai', ovh: 'ovhcloud', alibabacloud: 'alibaba' }
      const kbLogoLocalId = (slug, catalogue) => {
        const s = String(slug === null || slug === undefined ? '' : slug)
        const id = Object.prototype.hasOwnProperty.call(LOGO_ALIAS, s) ? LOGO_ALIAS[s] : s
        const list = Array.isArray(catalogue) ? catalogue : []
        const found = list.find((p) => p !== null && typeof p === 'object' && p.id === id && p.logo === true)
        return found === undefined ? null : found.id
      }
      // KB-LOGO-PURE-END
      // ── provider catalogue (source: https://models.dev/providers/) ──
      // Entries: { id, nom, env, url, logo, libre }. `libre` marks the providers that offer FREE models under a quota
      // (OpenRouter: openrouter.ai/collections/free-models; NVIDIA NIM preview: build.nvidia.com/models → nim_type_preview).
      // The `logo` slug is a simple-icons name, turned into the logo the bundle ships by kbLogoLocalId; none → the initial.
      // A prefill writes nothing by itself: it proposes slug, baseURL and env variable name, and the person confirms with « Add ».
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
      // « free models under quota » links — the two providers of the
      // request (02/10); a future `libre` entry of the catalogue will have its own.
      const FREE_LINKS = {
        openrouter: 'https://openrouter.ai/collections/free-models',
        nvidia: 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview',
      }
      // The full models.dev catalogue (~210 providers), served by the host; until
      // it has arrived (or if the host is old), the short list
      // above stands. `libre` and the « free » links stay ours.
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
      /** The catalogue entry (SVG logo available) that matches a route: exact id, else the longest id prefix. */
      const kbLogoEntree = (route) => {
        const r = String(route || '').toLowerCase()
        let best = null
        for (const p of KB_CATALOGUE) {
          if (p.logo !== true) continue
          if (r === p.id || r.indexOf(p.id + '-') === 0) { if (best === null || p.id.length > best.id.length) best = p }
        }
        return best
      }
      /** Logo chip for a catalogue slug: the local logo that matches it, otherwise the initial. */
      const LogoSlug = ({ slug, nom, taille }) => {
        const t = taille || 18
        const local = slug ? kbLogoLocalId(slug, KB_CATALOGUE) : null
        if (local !== null) return h(LogoMd, { id: local, nom: nom || slug, taille: t })
        return h('span', { className: 'kbmp-logo kbmp-logo-chip', style: { width: t + 6, height: t + 6, fontSize: Math.max(9, t - 6) } },
          String(nom || slug || '?').charAt(0).toUpperCase())
      }
      /** models.dev logo served by the host, painted as a mask: it takes the theme's colour (light/dark). */
      const LogoMd = ({ id, nom, taille }) => {
        const t = taille || 18
        const u = 'url(/kybernos-models/logo?id=' + encodeURIComponent(id) + ')'
        return h('span', { className: 'kbmp-logo kbmp-logo-mask', role: 'img', 'aria-label': nom || id, style: { width: t, height: t, WebkitMaskImage: u, maskImage: u } })
      }
      /** Rounded square tile carrying the logo (or the initial). */
      const LogoTile = ({ p, taille, tuile }) => {
        const t = taille || 16
        const inner = p.logo === true ? h(LogoMd, { id: p.id, nom: p.nom, taille: t })
          : (typeof p.logo === 'string' && p.logo !== '' ? h(LogoSlug, { slug: p.logo, nom: p.nom, taille: t })
            : h('span', { className: 'kbmp-tuile-init' }, String(p.nom || p.id).charAt(0).toUpperCase()))
        return h('span', { className: 'kbmp-tuile', style: { width: tuile || 28, height: tuile || 28 } }, inner)
      }
      /** Green « Free models · quota » badge, linking to the collection. */
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
        const t = taille || 18
        const ent = kbLogoEntree(route)
        if (ent !== null) return h(LogoMd, { id: ent.id, nom: route, taille: t })
        const slug = logoSlugDe(route)
        const local = slug === null ? null : kbLogoLocalId(slug, KB_CATALOGUE)
        if (local !== null) return h(LogoMd, { id: local, nom: route, taille: t })
        return h('span', { className: 'kbmp-logo kbmp-logo-chip', style: { width: t + 6, height: t + 6, fontSize: Math.max(9, t - 6) } },
          String(route).charAt(0).toUpperCase())
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
        // The engine's directory often names a provider by its own id ("openrouter"): that is the id again, not a name, so it does not stop the search for one.
        const engineName = kbPvIsObj(d) && typeof d.name === 'string' && d.name.trim() !== '' ? d.name : null
        if (engineName !== null && engineName.trim().toLowerCase() !== String(route).toLowerCase()) return engineName
        const prof = kbMOBJ(KBM.userProviders)[route]
        if (kbPvIsObj(prof) && typeof prof.displayName === 'string' && prof.displayName.trim() !== '') return prof.displayName
        // A provider the catalogue knows is named as the catalogue names it ("OpenRouter", "Anthropic"), not by its id ("openrouter"): the list
        // mixed proper names and raw ids.
        const known = catDe(route)
        if (known !== null && typeof known.nom === 'string' && known.nom.trim() !== '') return known.nom
        return engineName !== null ? engineName : route
      }
      const pvEditDraft = (route) => {
        const prof = kbPvIsObj(kbMOBJ(KBM.userProviders)[route]) ? KBM.userProviders[route] : {}
        const rows = Array.isArray(prof.models) ? prof.models.filter((x) => kbPvIsObj(x)).map((x) => ({ id: String(x.id || ''), name: typeof x.name === 'string' ? x.name : '' })) : []
        return { key: '', voir: false, adv: false, name: typeof prof.displayName === 'string' ? prof.displayName : '', url: typeof prof.baseURL === 'string' ? prof.baseURL : '',
          proto: typeof prof.api === 'string' ? prof.api : 'openai-completions', models: rows, hadModels: Array.isArray(prof.models), touched: false, custom: pvIsCustom(route) }
      }
      const pvAddDraft = () => ({ tab: 'catalog', prov: null, id: '', name: '', url: '', proto: 'openai-completions', key: '', voir: false, models: [], adv: false, liste: true, q: '', act: 0 })

      const PvField = (props) => h('div', { className: 'kbpv-fld' },
        h('label', { className: 'kbpv-fl', htmlFor: props.id }, props.label),
        props.children,
        props.err ? h('span', { className: 'kbpv-err', role: 'alert' }, props.err) : (props.hint ? h('span', { className: 'kbpv-hint' }, props.hint) : null))

      /** The models of a draft: id and display name per row, delete, add — and "Fetch available models", which asks the
       *  engine what the provider serves and lets the user tick the ones to add (the native page's picker). */
      // `required`: the add form of a custom provider, which cannot be created with no model (nothing can default one):
      // the empty state then says so, in place of the « no models will be shown » of an edit.
      const PvModels = ({ d, set, custom, probe, blocked, slug, required }) => {
        const rows = d.models
        const [fp, setFp] = React.useState({ busy: false, err: null, cands: null, picked: {}, q: '', src: null })
        const setRows = (next) => set({ models: next, touched: true, restoreModels: false })
        const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
        const askable = kbFetchAskable(probe)
        const close = () => setFp((st) => ({ ...st, cands: null, picked: {}, q: '' }))
        const open = fp.cands !== null
        React.useEffect(() => {
          if (open !== true) return undefined
          // Escape closes the picker and nothing else: window capture runs before the drawer's own document capture.
          const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close() } }
          window.addEventListener('keydown', key, true)
          return () => window.removeEventListener('keydown', key, true)
        }, [open])
        const ask = async () => {
          setFp((st) => ({ ...st, busy: true, err: null }))
          // A catalog route is answered by the provider's own endpoint first (a custom one is already asked over the wire by the engine).
          const out = await kbFetchRun(kbMApi(), probe, { live: custom !== true })
          if (out.kind === 'refused') {
            setFp((st) => ({ ...st, busy: false, err: out.unavailable === true ? m('kb.fetch.unavailable') : (out.timeout === true ? m('kb.fetch.timeout') : m('kb.fetch.err', { raison: out.message !== '' ? out.message : '—' })) }))
            return
          }
          if (out.models.length === 0) { setFp((st) => ({ ...st, busy: false, err: m('kb.fetch.empty') })); return }
          // A model outside the engine's catalog is tagged (and not ticked on opening): it is added as a custom model of this provider.
          const cands = out.live === true ? kbFetchTagUndescribed(out.models, out.described) : out.models
          setFp({ busy: false, err: null, cands, picked: kbFetchPreselect(cands, rows), q: '', src: out.live === true ? { live: true, url: out.url } : (out.live === false ? { live: false, why: out.why } : null) })
        }
        const renderPicker = () => {
          const shown = kbFetchFilter(fp.cands, fp.q)
          const have = new Set(rows.map((r) => String(r.id).trim()))
          const free = shown.filter((c) => !have.has(c.id))
          const allOn = free.length > 0 && free.every((c) => fp.picked[c.id] === true)
          const n = fp.cands.filter((c) => fp.picked[c.id] === true && !have.has(c.id)).length
          const tick = (ids, on) => setFp((st) => { const picked = { ...st.picked }; for (const id of ids) { if (on) picked[id] = true; else delete picked[id] } return { ...st, picked } })
          return h('div', { className: 'kbm-mdl-root', 'data-kbm': 'fetch-dialog', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) close() } },
            h('div', { className: 'kbm-mdl-mask' }),
            h('div', { className: 'kbm-mdl-dialog kbmp-mdl kbpv-fetch', role: 'dialog', 'aria-modal': 'true', 'aria-label': m('kb.fetch.title') },
              h('div', { className: 'kbm-mdl-header' }, h('div', { className: 'kbm-mdl-title' }, m('kb.fetch.title'))),
              h('div', { className: 'kbm-mdl-body kbpv-fetch-body' },
                h('p', { className: 'kbpv-fetch-desc' }, m('kb.fetch.desc')),
                fp.src !== null && fp.src !== undefined
                  ? h('p', { className: fp.src.live === true ? 'kbpv-fetch-desc' : 'kbpv-fetch-note', role: 'status', 'data-kbm': 'fetch-source', 'data-kbm-live': fp.src.live === true ? '1' : '0' },
                    fp.src.live === true ? m('kb.fetch.src.live', { host: kbFetchHost(fp.src.url) }) : m('kb.fetch.src.catalog', { raison: m(fp.src.why.key, fp.src.why.vars) }))
                  : null,
                fp.cands.some((c) => c.undescribed === true) ? h('p', { className: 'kbpv-fetch-note', role: 'status', 'data-kbm': 'fetch-undescribed' }, m('kb.fetch.undescribed.note', { n: fp.cands.filter((c) => c.undescribed === true).length })) : null,
                custom === true ? null : h('p', { className: 'kbpv-fetch-note', 'data-kbm': 'fetch-replaces' }, m('kb.fetch.replaces', { slug: slug || '' })),
                h('div', { className: 'kbpv-fetch-bar' },
                  h('input', { type: 'search', className: 'kbm-in-input kbpv-in', 'data-kbm': 'fetch-search', autoFocus: true, placeholder: m('kb.fetch.search'), 'aria-label': m('kb.fetch.search'), value: fp.q, onChange: (ev) => { const q = ev.target.value; setFp((st) => ({ ...st, q })) } }),
                  h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', 'data-kbm': 'fetch-all', disabled: free.length === 0, onClick: () => tick(free.map((c) => c.id), !allOn) }, allOn ? m('kb.fetch.none') : m('kb.fetch.all'))),
                shown.length === 0
                  ? h('p', { className: 'kbpv-hint', role: 'status', 'data-kbm': 'fetch-nomatch' }, m('kb.fetch.nomatch'))
                  : h('ul', { className: 'kbpv-fetch-list', 'data-kbm': 'fetch-list' }, shown.map((c) => {
                    const known = have.has(c.id)
                    const meta = known ? m('kb.fetch.known') : c.undescribed === true ? m('kb.fetch.undescribed') : [c.contextWindow !== undefined ? kbFetchSize(c.contextWindow) : null, c.input !== undefined && !(c.input.length === 1 && c.input[0] === 'text') ? c.input.join(' · ') : null].filter(Boolean).join(' · ')
                    return h('li', { key: c.id, 'data-kbm': 'fetch-row', 'data-kbm-id': c.id },
                      h('label', { className: 'kbpv-fetch-lab' + (known ? ' kbpv-fetch-known' : '') },
                        h('input', { type: 'checkbox', checked: known || fp.picked[c.id] === true, disabled: known, onChange: () => tick([c.id], fp.picked[c.id] !== true) }),
                        h('span', { className: 'kbpv-fetch-id', title: c.name !== undefined ? c.name : c.id }, c.id),
                        c.name !== undefined && c.name !== c.id ? h('span', { className: 'kbpv-fetch-nm' }, c.name) : null,
                        meta !== '' ? h('span', { className: 'kbpv-fetch-meta' }, meta) : null))
                  })),
                h('div', { className: 'kbpv-fetch-foot' },
                  h('span', { className: 'kbpv-hint', 'data-kbm': 'fetch-count' }, m('kb.fetch.count', { n, total: fp.cands.length })),
                  h('span', { className: 'kbpv-fetch-act' },
                    h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'fetch-cancel', onClick: close }, m('kb.pv.cancel')),
                    h('button', { type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'fetch-adopt', disabled: n === 0, onClick: () => { setRows(kbFetchApply(rows, fp.cands, fp.picked)); close() } }, m('kb.fetch.adopt') + ' (' + String(n) + ')'))))))
        }
        const canRestore = custom !== true && d.restoreModels !== true && (d.hadModels === true || rows.length > 0)
        return h('div', { className: 'kbpv-fld', 'data-kbm': 'pv-models' },
          h('div', { className: 'kbpv-mhead' }, h('span', { className: 'kbpv-fl' }, m('kb.pv.models')),
            h('span', { className: 'kbpv-mact' },
              canRestore ? h('button', { type: 'button', className: 'kbpv-lnk', 'data-kbm': 'fetch-restore', onClick: () => set({ models: [], touched: true, restoreModels: true }) }, m('kb.fetch.restore')) : null,
              h('button', { type: 'button', className: 'kbpv-lnk', 'data-kbm': 'fetch-open', disabled: fp.busy === true || blocked !== null || !askable,
                title: blocked !== null ? blocked : (!askable ? m('kb.fetch.needsurl') : undefined), onClick: ask }, fp.busy === true ? m('kb.fetch.busy') : m('kb.fetch.btn')))),
          fp.err !== null ? h('span', { className: 'kbpv-err', role: 'alert', 'data-kbm': 'fetch-err' }, fp.err) : null,
          rows.length === 0
            ? h('p', { className: required === true && d.restoreModels !== true ? 'kbpv-err' : 'kbpv-hint', 'data-kbm': d.restoreModels === true ? 'fetch-restored' : (required === true ? 'pv-models-required' : undefined) }, m(d.restoreModels === true ? 'kb.fetch.restored' : (custom ? (required === true ? 'kb.pv.err.models' : 'kb.pv.models.none') : 'kb.pv.models.catalog')))
            : h('div', { className: 'kbpv-mrows' }, rows.map((r, i) => h('div', { className: 'kbpv-mrow', key: i, 'data-kbm': 'pv-model-row' },
              h('input', { className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: m('kb.pv.model.id'), 'aria-label': m('kb.pv.model.id') + ' ' + String(i + 1), value: r.id, onChange: (ev) => upd(i, 'id', ev.target.value) }),
              h('input', { className: 'kbm-in-input kbpv-in', placeholder: m('kb.pv.model.name'), 'aria-label': m('kb.pv.model.name') + ' ' + String(i + 1), value: r.name, onChange: (ev) => upd(i, 'name', ev.target.value) }),
              h('button', { type: 'button', className: 'kbpv-ib kbpv-ib-danger', 'aria-label': m('kb.pv.model.del', { n: i + 1 }), title: m('kb.pv.model.del', { n: i + 1 }), onClick: () => setRows(rows.filter((_, j) => j !== i)) }, Ic('trash', 15))))),
          // Rows exist but none has an ID yet: Create is still blocked, and the reason stays on screen.
          required === true && rows.length > 0 && kbPvRows(rows).length === 0 ? h('p', { className: 'kbpv-err', role: 'alert', 'data-kbm': 'pv-models-required' }, m('kb.pv.err.models')) : null,
          h('div', null, h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'pv-model-add', onClick: () => setRows(rows.concat([{ id: '', name: '' }])) }, Ic('plus', 13), m('kb.pv.model.add'))),
          open ? renderPicker() : null)
      }

      /** The catalog of a DeepSeek adapter: id, display name, context window, max output tokens, image input, delete. The rows are
       *  the full records, so what this page does not show (description, system-prompt and tool update modes) travels with them. */
      const DsModels = ({ d, set, inherited, defaults }) => {
        const rows = d.rows
        const bad = d.touched === true && d.restoreModels !== true ? kbDsValidate(rows) : null
        const setRows = (next) => set({ rows: next, touched: true, restoreModels: false })
        const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
        const cap = (i, field) => {
          const key = String(i) + ':' + field
          if (d.buf !== undefined && d.buf[key] !== undefined) return d.buf[key]
          return rows[i][field] === undefined ? '' : kbDsFormatCapacity(rows[i][field])
        }
        const setCap = (i, field, text) => set({ rows: rows.map((r, j) => (j === i ? { ...r, [field]: kbDsParseCapacity(text) } : r)), buf: { ...(d.buf || {}), [String(i) + ':' + field]: text }, touched: true, restoreModels: false })
        const canRestore = d.restoreModels !== true && (d.overridden === true || d.touched === true)
        return h('div', { className: 'kbpv-fld', 'data-kbm': 'ds-models' },
          h('div', { className: 'kbpv-mhead' }, h('span', { className: 'kbpv-fl' }, m('kb.pv.models')),
            h('span', { className: 'kbpv-mact' },
              canRestore ? h('button', { type: 'button', className: 'kbpv-lnk', 'data-kbm': 'ds-restore', onClick: () => set({ rows: kbDsRows(inherited), buf: {}, touched: false, restoreModels: true }) }, m('kb.fetch.restore')) : null)),
          d.restoreModels === true ? h('p', { className: 'kbpv-hint', 'data-kbm': 'ds-restored' }, m('kb.fetch.restored')) : null,
          bad !== null ? h('span', { className: 'kbpv-err', role: 'alert', 'data-kbm': 'ds-err' }, m('kb.ds.err.row', { n: bad.index + 1, why: m(bad.key) })) : null,
          h('div', { className: 'kbpv-mrows' }, rows.map((r, i) => h('div', { className: 'kbpv-dsrow', key: i, 'data-kbm': 'ds-row' },
            h('input', { className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: m('kb.pv.model.id'), 'aria-label': m('kb.pv.model.id') + ' ' + String(i + 1), value: typeof r.id === 'string' ? r.id : '', onChange: (ev) => upd(i, { id: ev.target.value }) }),
            h('input', { className: 'kbm-in-input kbpv-in', placeholder: m('kb.pv.model.name'), 'aria-label': m('kb.pv.model.name') + ' ' + String(i + 1), value: typeof r.name === 'string' ? r.name : '', onChange: (ev) => upd(i, { name: ev.target.value === '' ? undefined : ev.target.value }) }),
            h('button', { type: 'button', className: 'kbpv-ib kbpv-ib-danger', 'aria-label': m('kb.pv.model.del', { n: i + 1 }), title: m('kb.pv.model.del', { n: i + 1 }), onClick: () => set({ rows: rows.filter((_, j) => j !== i), buf: {}, touched: true, restoreModels: false }) }, Ic('trash', 15)),
            h('div', { className: 'kbpv-dsopts' },
              h('label', { className: 'kbpv-dscap' }, h('span', null, m('kb.ds.ctx')),
                h('input', { className: 'kbm-in-input kbpv-in', 'data-kbm': 'ds-ctx', placeholder: defaults.ctx, value: cap(i, 'contextWindow'), onChange: (ev) => setCap(i, 'contextWindow', ev.target.value) })),
              h('label', { className: 'kbpv-dscap' }, h('span', null, m('kb.ds.max')),
                h('input', { className: 'kbm-in-input kbpv-in', 'data-kbm': 'ds-max', placeholder: defaults.max, value: cap(i, 'maxTokens'), onChange: (ev) => setCap(i, 'maxTokens', ev.target.value) })),
              h('label', { className: 'kbpv-dsimg' },
                h('input', { type: 'checkbox', 'data-kbm': 'ds-img', checked: kbDsHasImage(r), onChange: (ev) => upd(i, kbDsSetImage(r, ev.target.checked)) }), h('span', null, m('kb.ds.image'))))))),
          h('div', null, h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'ds-model-add', onClick: () => setRows(rows.concat([{ id: '', inputModalities: ['text'] }])) }, Ic('plus', 13), m('kb.pv.model.add'))))
      }

      // KB-TRAP-PURE-BEGIN
      /** Where Tab goes inside a dialog, so the focus never leaves it (A3-40): the element to focus, or null to let the
       *  browser take the next step by itself. `items` are the tabbable elements in order; an `active` that is not among
       *  them (focus outside the dialog, or on its frame) is brought back in at the end the key is heading for. Pure. */
      const kbTrapTarget = (items, active, shift) => {
        if (!Array.isArray(items) || items.length === 0) return null
        const i = items.indexOf(active)
        if (shift === true) return i <= 0 ? items[items.length - 1] : null
        return i === -1 || i === items.length - 1 ? items[0] : null
      }
      // KB-TRAP-PURE-END
      const KB_TABBABLE = 'a[href],button,input,select,textarea,[tabindex]'
      const kbTabbables = (box) => Array.from(box.querySelectorAll(KB_TABBABLE)).filter((el) => el.disabled !== true && el.tabIndex >= 0 && el.type !== 'hidden' && el.getClientRects().length > 0)
      const PvDrawer = ({ label, onClose, children, footer, head }) => {
        const boxRef = React.useRef(null)
        React.useEffect(() => {
          // Captured first so that DSH, which also listens for Escape, does not close Settings under the panel. Tab stays
          // inside the panel: its overlay is modal, and the page behind it must not be reachable from the keyboard.
          const key = (ev) => {
            if (ev.key === 'Escape') { ev.stopPropagation(); onClose() }
            else if (ev.key === 'Tab' && boxRef.current !== null) {
              const to = kbTrapTarget(kbTabbables(boxRef.current), document.activeElement, ev.shiftKey)
              if (to !== null) { ev.preventDefault(); to.focus() }
            }
          }
          document.addEventListener('keydown', key, true)
          return () => document.removeEventListener('keydown', key, true)
        }, [onClose])
        // The element that had the focus before the panel opened (read during the first render, before the panel's own
        // autofocus): the focus goes back to it when the panel closes.
        const openerRef = React.useRef(undefined)
        if (openerRef.current === undefined) openerRef.current = document.activeElement
        React.useEffect(() => () => {
          const opener = openerRef.current
          try { if (opener !== null && opener !== undefined && typeof opener.focus === 'function' && document.contains(opener)) opener.focus() } catch (e) { /* focus is a courtesy */ }
        }, [])
        return h('div', { className: 'kbpv-layer', 'data-kbm': 'pv-drawer' },
          h('div', { className: 'kbpv-mask', onMouseDown: onClose }),
          h('div', { className: 'kbpv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabIndex: -1, ref: boxRef },
            h('header', null, head, h('button', { type: 'button', className: 'kbpv-ib', 'aria-label': m('kb.pv.close'), onClick: onClose }, Ic('x', 16))),
            h('div', { className: 'kbpv-body' }, children),
            h('footer', null, footer)))
      }

      const ProviderList = () => {
        const [, forcer] = React.useReducer((x) => x + 1, 0)
        const [ui, setUi] = React.useState({ drawer: null, dlg: null, menu: null, busy: false, err: null, note: null, typed: '', waitOpen: false })
        const [dr, setDr] = React.useState(null)
        const patch = (o) => setUi((u) => ({ ...u, ...o }))
        const setD = (o) => setDr((d) => ({ ...d, ...o }))
        // Escape closes the confirmation (disable / delete) and nothing else, so the drawer behind it stays: window capture runs
        // before the drawer's own document capture.
        const confirming = ui.dlg !== null
        React.useEffect(() => {
          if (confirming !== true) return undefined
          const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); setUi((u) => ({ ...u, dlg: null, typed: '' })) } }
          window.addEventListener('keydown', key, true)
          return () => window.removeEventListener('keydown', key, true)
        }, [confirming])
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
        // The companion routes (a provider's custom models) are not providers of their own: the grid draws the provider, whose count includes them.
        const knownRoutes = KBM.routes.concat(KBM.parked.map((x) => x.slug))
        const routes = kbProvRoutes()
        const parkedShown = kbMParkedShown(KBM.parked, routes).filter((x) => kbCompanionOf(x.slug, knownRoutes) === null)
        const taken = routes.concat(parkedShown.map((p) => p.slug))
        const ro = KBM.writable !== true
        const countOf = (route) => KBM.models.filter((mo) => kbProvOf(mo.route) === route).length
        const keyOf = (route) => {
          const entry = catDe(route)
          return kbPvKeyState(kbMOBJ(KBM.userProviders)[route], entry !== null ? entry.env : null, KBM.keys)
        }
        const closeAll = () => { setDr(null); setUi((u) => ({ ...u, drawer: null, dlg: null, menu: null, busy: false, err: null, typed: '' })) }
        const openEdit = (route, addModel, showModels) => {
          const d = pvEditDraft(route)
          if (showModels === true) d.adv = true // the folded block holds the "Fetch available models" panel
          if (addModel === true) { d.adv = true; d.models = d.models.concat([{ id: '', name: '' }]); d.touched = true }
          setDr(d); patch({ drawer: { mode: 'edit', id: route }, menu: null, err: null, note: null })
        }
        const openAdd = () => { setDr(pvAddDraft()); patch({ drawer: { mode: 'add' }, menu: null, err: null, note: null }) }
        const dsCards = kbDsCardsOf(KBM.ds, KBM.dsDir)
        // DeepSeek (the two adapters outside llm-pi-ai): the draft holds the catalog rows as full records.
        const openDs = (ns) => {
          const v = KBM.ds[ns]
          if (v === undefined) return
          const overridden = Array.isArray(v.user.models)
          setDr({ ds: true, ns, key: '', voir: false, adv: ns === 'llm-deepseek' ? false : true, url: ns === 'llm-deepseek' ? (typeof v.user.baseURL === 'string' ? v.user.baseURL : '') : undefined, rows: kbDsRows(v.value.models), buf: {}, overridden, touched: false, restoreModels: false })
          patch({ drawer: { mode: 'ds', id: ns }, menu: null, err: null, note: null })
        }
        const doDsSave = async (ns) => {
          const out = await run(() => kbDsSave(ns, dr), 'kb.pv.save.err', ns)
          if (out === undefined) return
          setDr(null); patch({ drawer: null, busy: false, note: m(out.keyOk === false ? 'kb.pv.saved.key.ko' : 'kb.pv.saved') })
        }
        // The health chip asks for a provider's Edit panel ("Fix key"): done once the list is on screen. A provider that
        // cannot be edited here (read-only page, managed route, unknown route) shows its models instead.
        React.useEffect(() => {
          if (UI.edit === null) return undefined
          const route = UI.edit
          UI.edit = null
          if (KBM.routes.indexOf(route) >= 0 && KBM.writable === true && kbMParkBlock(route, KBM.userProviders, KBM.baseProviders) !== 'managed') openEdit(route, false)
          else { UI.prov = route; UI.tab = 'models'; kbmNotify() }
          return undefined
        })
        const run = async (fn, errKey, slug) => {
          patch({ busy: true, err: null })
          try { const out = await fn(); return out }
          catch (e) {
            patch({ busy: false, err: m(errKey, { slug: slug || '', raison: String(e && e.message ? e.message : e) }) })
            return undefined
          }
        }
        const doSave = async (route) => {
          const out = await run(() => kbPvSaveSmart(route, { ...dr, models: dr.touched === true ? dr.models : undefined }), 'kb.pv.save.err', route)
          if (out === undefined) return
          const said = out.custom !== null && out.custom !== undefined ? m('kb.pv.saved.custom', { n: out.customN, slug: route }) + (out.custom.guessed > 0 ? m('kb.pv.saved.custom.guess') : '') : m(out.keyOk === false ? 'kb.pv.saved.key.ko' : 'kb.pv.saved')
          setDr(null); patch({ drawer: null, busy: false, note: said })
        }
        const doCreate = async () => {
          const d = { ...dr }
          if (d.tab === 'catalog') { const p = catDe(d.prov); d.name = p !== null ? p.nom : d.id }
          const out = await run(() => kbPvCreate(d), 'kb.pv.add.err', d.id)
          if (out === undefined) return
          setDr(null); uiSet('prov', out.slug)
          patch({ drawer: null, busy: false, waitOpen: true, note: m(out.keyOk === false ? 'kb.prov.add.fait.cleko' : (out.keyOk === true ? 'kb.prov.add.fait.cleok' : 'kb.prov.add.fait'), { slug: out.slug }) })
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
          // A switch is named by what it controls, its state is announced by aria-checked; the action (or why it is locked) is the tooltip.
          disabled: locked === true || ui.busy === true, title: why, 'aria-label': m('kb.pv.sw.aria', { slug: route }),
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
            h('span', { className: 'kbpv-logo' }, h(LogoProv, { route, taille: 30 })),
            h('div', { className: 'kbpv-cbody' },
              h('span', { className: 'kbpv-nm' },
                h('button', { type: 'button', className: 'kbpv-link', 'data-kbm': 'prov-voir', 'aria-label': m('kb.prov.voir') + ' · ' + label, onClick: () => { uiSet('prov', route); uiSet('tab', 'models') } }, label),
                ks === 'none' ? null : h('i', { className: 'kbpv-kd kbpv-kd-' + ks, title: m(ks === 'ok' ? 'kb.pv.key.ok' : (ks === 'missing' ? 'kb.pv.key.missing' : 'kb.pv.key.unknown')) })),
              h('span', { className: 'kbpv-meta', 'data-kbm': 'prov-name' },
                custom ? h('span', { className: 'kbpv-tag' }, m('kb.pv.custom')) : null,
                off !== true && kbPvIsObj(KBM.dir[route]) && KBM.dir[route].error !== '' ? h('span', { className: 'kbpv-tag kbpv-tag-warn', title: KBM.dir[route].error, 'data-kbm': 'prov-diag' }, m('kb.pv.diag')) : null,
                h('span', null, String(count) + ' ' + m(count === 1 ? 'kb.models.prov.model1' : 'kb.models.prov.modelN'))),
              // A route with no model serves nothing: say what to do next instead of leaving a silent card (A3-32).
              count === 0 && off !== true && bloc === null && ro !== true
                ? h('button', { type: 'button', className: 'kbpv-next', 'data-kbm': 'prov-next', onClick: () => openEdit(route, false, true) }, m(ks === 'missing' ? 'kb.pv.empty.nokey' : 'kb.pv.empty.fetch'))
                : null,
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

        // ── the custom models of a provider (its companion routes), under its own list of models ──
        const renderCustomModels = (route) => {
          const items = []
          for (const slug of kbCompanionsOf(route, KBM.routes)) {
            const prof = kbMOBJ(KBM.userProviders)[slug]
            const proto = kbPvIsObj(prof) && typeof prof.api === 'string' ? prof.api : ''
            const known = PV_PROTOS.filter((x) => x[0] === proto)[0]
            for (const mo of (kbPvIsObj(prof) && Array.isArray(prof.models) ? prof.models : [])) if (kbPvIsObj(mo) && typeof mo.id === 'string') items.push({ id: mo.id, name: typeof mo.name === 'string' ? mo.name : '', proto: known !== undefined ? m(known[1]) : proto })
          }
          if (items.length === 0) return null
          return h('div', { className: 'kbpv-fld', 'data-kbm': 'pv-custom' },
            h('span', { className: 'kbpv-fl' }, m('kb.pv.custom.title')),
            h('div', { className: 'kbpv-mrows' }, items.map((x) => h('div', { className: 'kbpv-mrow', key: x.id, 'data-kbm': 'pv-custom-row', 'data-kbm-id': x.id },
              h('span', { className: 'kbm-in-input kbpv-in kbpv-mono kbpv-static', title: x.name !== '' ? x.name : x.id }, x.id),
              h('span', { className: 'kbpv-hint' }, x.proto),
              h('button', { type: 'button', className: 'kbpv-ib kbpv-ib-danger', 'data-kbm': 'pv-custom-del', disabled: ro || ui.busy === true, 'aria-label': m('kb.pv.custom.remove', { id: x.id }), title: m('kb.pv.custom.remove', { id: x.id }),
                onClick: async () => { const out = await run(() => kbCompanionRemove(route, x.id).then(() => true), 'kb.pv.save.err', route); if (out === true) patch({ busy: false }) } }, Ic('trash', 15))))),
            h('p', { className: 'kbpv-hint' }, m('kb.pv.custom.hint')))
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
            h(PvModels, { d: dr, set: setD, custom: dr.custom === true, probe: kbFetchProbe(route, dr), blocked: urlBad ? m('kb.pv.err.url') : null, slug: route }),
            dr.custom === true ? null : renderCustomModels(route)) : null,
          h('div', { className: 'kbpv-zone' },
            h('div', { className: 'kbpv-z' }, h('div', null, h('b', null, m('kb.pv.zone.off')), h('span', null, m('kb.pv.zone.off.d'))),
              renderSwitch({ route, on: true, locked: ro || KBM.parkHost !== true || bloc !== null, why: KBM.parkHost !== true ? m('kb.pv.hostnote') : bloc === 'managed' ? m('kb.prov.off.managed') : (bloc === 'profile' ? m('kb.prov.off.locked') : m('kb.prov.off.disable', { slug: route })) })),
            h('div', { className: 'kbpv-z' }, h('div', null, h('b', null, m('kb.pv.zone.del')), h('span', null, m('kb.pv.zone.del.d'))),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline kbpv-danger', disabled: ro || bloc !== null, 'data-kbm': 'pv-delete', onClick: () => patch({ dlg: { type: 'del', id: route }, typed: '' }) }, m('kb.pv.menu.delete')))))
        }

        // ── DeepSeek panel: key (official only), then the folded custom settings; the account adapter shows its catalog directly ──
        const renderDsEdit = () => {
          const ns = ui.drawer.id
          const card = dsCards.filter((c) => c.ns === ns)[0]
          const v = KBM.ds[ns]
          if (card === undefined || v === undefined) return null
          const official = ns === 'llm-deepseek'
          const urlBad = official && dr.url !== undefined && dr.url.trim() !== '' && !kbPvUrlOk(dr.url)
          const rowsBad = dr.touched === true && dr.restoreModels !== true && kbDsValidate(dr.rows) !== null
          const inherited = Array.isArray(v.base.models) ? v.base.models : v.value.models
          const defaults = { ctx: Number.isInteger(v.value.defaultContextWindow) ? kbDsFormatCapacity(v.value.defaultContextWindow) : '', max: Number.isInteger(v.value.maxTokens) ? kbDsFormatCapacity(v.value.maxTokens) : '' }
          const stored = KBM.dsKey.configured
          const catalog = h(DsModels, { d: dr, set: setD, inherited, defaults })
          return h(PvDrawer, {
            label: m('kb.pv.edit', { slug: card.provider }), onClose: closeAll,
            head: h('span', { className: 'kbpv-dh' }, h('span', { className: 'kbpv-logo' }, h(LogoProv, { route: 'deepseek', taille: 20 })), h('span', { className: 'kbpv-dt' }, card.name)),
            footer: [h('button', { key: 'c', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-outline', 'data-kbm': 'pv-cancel', onClick: closeAll }, m('kb.pv.cancel')),
              h('button', { key: 'a', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'pv-apply', disabled: ui.busy === true || urlBad || rowsBad || ro, onClick: () => doDsSave(ns) }, m('kb.pv.apply'))],
          },
          ui.err ? h('div', { className: 'kbpv-fail', role: 'alert', 'data-kbm': 'pv-fail' }, ui.err) : null,
          official ? h(PvField, { id: 'pv-key', label: m('kb.prov.add.cle.label'), hint: m('kb.prov.add.cle.note') },
            h('span', { className: 'kbpv-keyrow' },
              h('input', { id: 'pv-key', className: 'kbm-in-input kbpv-in', type: dr.voir === true ? 'text' : 'password', autoComplete: 'off', spellCheck: false, 'data-kbm': 'pv-key',
                placeholder: m(stored === true ? 'kb.pv.key.ph.set' : 'kb.pv.key.ph.blank'), value: dr.key, onChange: (ev) => setD({ key: ev.target.value }) }),
              h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-ghost', tabIndex: -1, onClick: () => setD({ voir: dr.voir !== true }) }, m(dr.voir === true ? 'kb.prov.add.cle.cacher' : 'kb.prov.add.cle.voir')))) : h('p', { className: 'kbpv-hint', 'data-kbm': 'ds-account-note' }, m('kb.ds.account.note')),
          official ? h('button', { type: 'button', className: 'kbpv-adv', 'data-kbm': 'pv-adv', 'aria-expanded': dr.adv === true ? 'true' : 'false', onClick: () => setD({ adv: dr.adv !== true }) }, Ic('chevron', 14), m('kb.pv.customized')) : null,
          official ? (dr.adv === true ? h('div', { className: 'kbpv-advbox', 'data-kbm': 'pv-advbox' },
            h(PvField, { id: 'pv-url', label: m('kb.pv.url'), err: urlBad ? m('kb.pv.err.url') : null, hint: urlBad ? null : m('kb.ds.url.hint') }, h('input', { id: 'pv-url', className: 'kbm-in-input kbpv-in kbpv-mono', placeholder: 'https://api.deepseek.com', value: dr.url, onChange: (ev) => setD({ url: ev.target.value }) })),
            catalog) : null) : catalog)
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
              h('button', { key: 'a', type: 'button', className: 'kbm-btn kbm-btn-md kbm-btn-primary', 'data-kbm': 'prov-ok', disabled: ui.busy === true || block !== null || ro, title: block !== null ? m('kb.pv.err.' + block) : undefined, onClick: doCreate }, m(catalog ? 'kb.pv.apply' : 'kb.pv.create'))],
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
              h(PvModels, { key: 'mo', d: dr, set: setD, custom: true, required: true, probe: kbFetchProbe(null, dr), blocked: dr.url.trim() !== '' && !kbPvUrlOk(dr.url) ? m('kb.pv.err.url') : null, slug: null })]
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
              h('div', { className: 'kbm-mdl-body kbmp-off-dlg-body' }, h('p', null, m(n === 1 ? 'kb.pv.del.body1' : 'kb.pv.del.body', { n })),
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
        // ── a built-in DeepSeek card ──
        const renderDsCard = (c) => {
              const official = c.ns === 'llm-deepseek'
              const count = Array.isArray(KBM.ds[c.ns].value.models) ? KBM.ds[c.ns].value.models.length : 0
              const ks = official ? (KBM.dsKey.configured === true ? 'ok' : (KBM.dsKey.configured === false ? 'missing' : 'unknown')) : 'none'
              return h('div', { key: c.ns, className: 'kbpv-card', 'data-kbm': 'prov-card', 'data-prov': c.provider },
                h('span', { className: 'kbpv-logo' }, h(LogoProv, { route: 'deepseek', taille: 30 })),
                h('div', { className: 'kbpv-cbody' },
                  h('span', { className: 'kbpv-nm' }, h('span', { className: 'kbpv-link kbpv-static' }, c.name),
                    ks === 'none' ? null : h('i', { className: 'kbpv-kd kbpv-kd-' + ks, title: m(ks === 'ok' ? 'kb.pv.key.ok' : (ks === 'missing' ? 'kb.pv.key.missing' : 'kb.pv.key.unknown')) })),
                  h('span', { className: 'kbpv-meta', 'data-kbm': 'prov-name' }, h('span', { className: 'kbpv-tag' }, m('kb.pv.builtin')), h('span', null, String(count) + ' ' + m(count === 1 ? 'kb.models.prov.model1' : 'kb.models.prov.modelN')))),
                h('div', { className: 'kbpv-right' }, h('div', { className: 'kbpv-acts' },
                  h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'prov-edit', disabled: ro, title: m('kb.pv.edit', { slug: c.provider }), 'aria-label': m('kb.pv.edit', { slug: c.provider }), onClick: (ev) => { ev.stopPropagation(); openDs(c.ns) } }, Ic('pencil', 15)))))
            }
        // The cards in the order they have always had, each with whether it waits (no key yet, or switched off).
        const wordsOf = (route) => route + ' ' + pvLabel(route) + ' ' + KBM.models.filter((mo) => mo.route === route).map((mo) => mo.id + ' ' + (mo.name || '')).join(' ')
        const cards = dsCards.map((c) => ({ node: renderDsCard(c), waiting: c.ns === 'llm-deepseek' && KBM.dsKey.configured === false, hay: c.provider + ' ' + c.name + ' deepseek' }))
          .concat(routes.map((route) => ({ node: renderCard({ route }), waiting: keyOf(route) === 'missing', hay: wordsOf(route), cloud: route === 'kybernos' })))
          .concat(parkedShown.map((p) => ({ node: renderCard({ route: p.slug, off: true }), waiting: true, hay: p.slug + ' ' + p.models.join(' ') })))
        // While a search is typed the answer is the matching providers, all of them (a provider with no key included), with no fold and no Cloud card.
        const searching = String(UI.pq).trim() !== ''
        // The Kybernos Cloud card (first cell of the grid) IS the « kybernos » provider while the account is connected: its plain card is not drawn
        // beside it. Not when the account is known to be disconnected (a « kybernos » route written by hand would be unreachable), nor in a search
        // result, where the Cloud card steps aside and the provider has to be findable.
        const listed = cards.filter((x) => !(x.cloud === true && KBM.cloud !== false))
        const hits = searching ? kbPvSearch(cards, UI.pq) : listed
        const fold = kbPvFold(listed.map((x) => x.waiting))
        const ready = listed.filter((x) => !x.waiting)
        const waiting = listed.filter((x) => x.waiting)
        return h('div', { className: 'kbpv', 'data-kbm': 'prov-list' },
          h('div', { className: 'kbpv-head' },
            h('span', { className: 'kbm-in-wrap kbmp-search kbpv-search' }, Loupe(),
              h('input', { className: 'kbm-in-input', type: 'search', placeholder: m('kb.pv.search'), 'aria-label': m('kb.pv.search'), 'data-kbm': 'prov-search', value: UI.pq, onChange: (ev) => uiSet('pq', ev.target.value) })),
            h('span', { className: 'kbpv-grow' }),
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-models' }) : null),
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
            // The Kybernos Cloud card is the first cell of the grid, full width, before the first provider: above the tabs it pushed them down
            // on this tab only, so they jumped 85 px between Providers and Models. A component, not a call: KybernosHero owns hooks.
            searching ? null : h(KybernosHero, { key: 'kb-hero' }),
            (searching ? hits : (fold.fold && !ui.waitOpen ? ready : listed)).map((x) => x.node)),
          searching && hits.length === 0 ? h('p', { className: 'kbpv-hint', role: 'status', 'data-kbm': 'prov-nomatch' }, m('kb.pv.search.none')) : null,
          fold.fold && !searching ? h('button', { type: 'button', className: 'kbpv-fold', 'data-kbm': 'prov-wait-toggle', 'aria-expanded': ui.waitOpen ? 'true' : 'false', onClick: () => patch({ waitOpen: !ui.waitOpen }) },
            h('span', { className: 'kbpv-fold-chev' + (ui.waitOpen ? ' open' : ''), 'aria-hidden': 'true' }, Ic('chevron', 13)), m('kb.pv.wait.n', { n: fold.waiting })) : null,
          fold.fold && !searching && ui.waitOpen ? h('p', { className: 'kbpv-fold-hint', 'data-kbm': 'prov-wait-hint' }, m('kb.pv.wait.hint')) : null,
          fold.fold && !searching && ui.waitOpen ? h('div', { className: 'kbpv-cards kbpv-cards-wait', 'data-kbm': 'prov-cards-wait' }, waiting.map((x) => x.node)) : null,
          ui.drawer !== null && ui.drawer.mode === 'edit' && dr !== null ? renderEdit() : null,
          ui.drawer !== null && ui.drawer.mode === 'add' && dr !== null ? renderAdd() : null,
          ui.drawer !== null && ui.drawer.mode === 'ds' && dr !== null ? renderDsEdit() : null,
          renderDialogs())
      }
      /** A column header that sorts the list (the same sort the Sort menu drives). */
      const kbmSortHead = (key, label) => {
        const on = UI.tri === key
        return h('button', { type: 'button', className: 'kbmp-thb' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-kbm': 'sort-' + key,
          title: m('kb.models.sort') + ' · ' + label, onClick: () => uiSet('tri', key) }, label, on ? h('span', { className: 'kbmp-thar' }, Ic('chevron', 10)) : null)
      }
      const KB_CHIPS_PREF = 'kb.models.capChips'
      /** Capability filter chips under the search bar. From 860 px the column headers filter too, so the chips are off
       *  there unless asked for; below that there are no header filters and the chips always show. */
      const kbmChipsOn = () => { try { return window.localStorage.getItem(KB_CHIPS_PREF) === '1' } catch (e) { return false } }
      const ListView = () => {
        const rows = uiRows()
        const pages = Math.max(1, Math.ceil(rows.length / ROWS_PAR_PAGE))
        const page = Math.min(Math.max(1, Number(UI.page) || 1), pages)
        const debut = (page - 1) * ROWS_PAR_PAGE
        const pageRows = rows.slice(debut, debut + ROWS_PAR_PAGE)
        const toutes = KBM.models
        // « N of N » is the provider's own count (its card says the same number); the unavailable fold, and its count, belong to the unscoped list.
        const scope = UI.prov === 'all' ? toutes : toutes.filter((mo) => mo.route === UI.prov)
        const downIdx = kbHealthIndex(kbHealthGet())
        const downN = scope.filter((mo) => downIdx[mo.route + '/' + mo.id] !== undefined).length
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
              kbScoreSteps(KBM.scoreOf).length > 0 ? h(Menu, { id: 'score', field: 'score', defaut: 'any', label: m('kb.models.filter.score'), options: [{ v: 'any', t: m('kb.models.score.any') }].concat(kbScoreSteps(KBM.scoreOf).map((n) => ({ v: String(n), t: m('kb.models.score.min', { n }) }))) }) : null,
              h(Menu, { id: 'tri', field: 'tri', defaut: 'name', label: m('kb.models.sort'), options: OPT_TRI() }))),
          h('div', { className: 'kbmp-capsbar' + (kbmChipsOn() === true ? ' kbmp-capsbar-on' : '') }, h('span', { className: 'kbmp-caps' }, capFiltres
            .map((k) => CAPS.filter((c) => c.k === k)[0])
            .filter((c) => c !== undefined)
            .map((c) => h(CapFiltre, { def: c, key: c.k })))),
          h('div', { className: 'kbmp-resbar' },
            h('span', { 'data-kbm': 'count' }, m('kb.models.count', { a: rows.length, b: scope.length })),
            uiFiltre() === true
              ? h('button', { type: 'button', className: 'kbmp-link', 'data-kbm': 'reset', onClick: uiReset }, m('kb.models.reset'))
              : null,
            // The failing ones are folded away; this brings them back, each with its reason on the row.
            downN > 0 && UI.statut !== 'down' && UI.prov === 'all'
              ? h('button', { type: 'button', className: 'kbmp-link', 'data-kbm': 'toggle-down', 'aria-pressed': UI.showDown === true ? 'true' : 'false', onClick: () => uiSet('showDown', UI.showDown !== true) },
                UI.showDown === true ? m('kb.health.hidedown') : m('kb.health.showdown', { n: downN }))
              : null,
            // No score is known yet (a fresh install): a visible way to get them, never an automatic read of two outside sites.
            KBM.live === true && Object.keys(KBM.scoreOf).length === 0
              ? h('button', { type: 'button', className: 'kbmp-link', 'data-kbm': 'scores-load', disabled: KBM.scoresRunning === true, title: m('kb.models.scores.loadHint'), onClick: () => { kbMScoresStart() } },
                KBM.scoresRunning === true ? m('kb.models.scores.refreshing') : m('kb.models.scores.load'))
              : null,
            h('span', { className: 'kbmp-grow' }),
            h('button', {
              type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'sync-list',
              onClick: () => { for (const mo of rows) kbmSync(mo.key) },
            }, Ic('download', 13), h('span', null, m('kb.models.syncN', { n: rows.length })))),
          h('div', { className: 'kbmp-table', 'data-kbm': 'list' },
            // The model's columns live in the MODEL cell (name + line
            // id · route · type · price): the table therefore has only five columns,
            // and none is cut at 556 px.
            h('div', { className: 'kbmp-thead' },
              h('div', { className: 'kbmp-th kbmp-c-model', key: 'model' }, kbmSortHead('name', m('kb.models.col.model'))),
              h('div', { className: 'kbmp-th kbmp-c-prov', key: 'prov' }, kbmSortHead('provider', m('kb.models.col.prov'))),
              h('div', { className: 'kbmp-th kbmp-c-caps', key: 'caps' },
                h('span', { className: 'kbmp-thl' }, m('kb.models.col.caps')),
                h('span', { className: 'kbmp-mx kbmp-mxh', 'data-kbm': 'matrix-head' },
                  KB_MATRIX.map((k) => {
                    const def = CAPS.filter((c) => c.k === k)[0]
                    const on = UI.caps[k] === true
                    return h('button', { type: 'button', key: k, className: 'kbmp-mxc kbmp-mxbtn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
                      'data-kbm': 'mxfilter-' + k, title: m(def.t) + ' — ' + m('kb.models.mx.filter'), 'aria-label': m('kb.models.mx.filter') + ': ' + m(def.t),
                      onClick: () => uiCap(k) }, h('span', { className: 'kbmp-capi', style: on ? undefined : { color: def.tint } }, Ic(def.icon, 14)))
                  }),
                  h('span', { className: 'kbmp-mxc', key: 'x' }))),
              h('div', { className: 'kbmp-th kbmp-c-context', key: 'context' }, kbmSortHead('context', m('kb.models.col.context'))),
              h('div', { className: 'kbmp-th kbmp-c-source', key: 'source' }, m('kb.models.col.source')),
              h('div', { className: 'kbmp-th kbmp-c-act', key: 'act' })),
            toutes.length === 0 && KBM.loading === true && skelOf() !== null
              ? skelOf().wrap(m('kb.models.loading'), '', [0, 1, 2, 3, 4].map((i) => h('div', { key: 'sk' + i, className: 'kbm-item kbmp-lig kb-sk-row' },
                h('div', { className: 'kbmp-cols' },
                  h('div', { className: 'kbmp-c kbmp-cmodel' }, skelOf().bone(i % 2 === 0 ? '62%' : '48%', 13), skelOf().bone('40%', 10)),
                  h('div', { className: 'kbmp-c kbmp-cprov' }, skelOf().bone(16, 16, 'round'), skelOf().bone('60%', 12)),
                  h('div', { className: 'kbmp-c kbmp-ccaps' }, skelOf().bone(70, 14)),
                  h('div', { className: 'kbmp-c kbmp-cctx' }, skelOf().bone(40, 12)),
                  h('div', { className: 'kbmp-c kbmp-csrc' }, skelOf().bone(70, 12)),
                  h('div', { className: 'kbmp-c kbmp-cact' }, skelOf().bone(18, 18, null, 5))))))
              : null,
            toutes.length === 0 && KBM.loading !== true
              ? h('div', { className: 'kbmp-dim kbmp-empty' }, KBM.live === true ? m('kb.models.empty.live') : m('kb.models.empty'))
              : null,
            rows.length === 0 && toutes.length > 0
              ? h('div', { className: 'kbmp-dim kbmp-empty', 'data-kbm': 'novide' }, m('kb.models.empty'))
              : null,
            pageRows.map((mo) => h(Row, { mo: mo, key: mo.key, down: downIdx[mo.route + '/' + mo.id] })),
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

      // ── the Kybernos panel: ONE block, above the native one ──────────
      // It sits in `settings.models.header`: the Settings → Models page keeps its native
      // provider list intact below, and the Kybernos catalogue
      // lives above it, in this single block (tabs, list,
      // pagination). The old duplicate — a call-to-action block at the top AND a panel
      // re-titled « Models » at the foot — is melted in here: one title.
      // ── the Kybernos Cloud card (settings.models.header) ────────────────
      // The redesign of 2026-09-21 follows the mock-up: a night-blue brand card
      // above the native rows — K logo, name, « Recommended » badge,
      // big title, pitch, three ticked gains, and on the right the white CTA
      // « Connect to Kybernos Cloud », the « or » separator, then
      // « Add your API key ». Two states:
      //   · discovered — the mock-up word for word (title « Start for free »);
      //   · connected  — the same template, but the model count is the one
      //                  that REALLY lives in settings.yaml (kybernos route), a « Connected » badge is added,
      //                  the CTA goes (the account is in the account menu), and « Recommended », « or » and
      //                  « Add your API key » go (V-28: a connected paid account has no key; a Free one keeps it).
      // The card writes NOTHING: it reads /kybernos-cloud/status (same-origin,
      // read-only) and delegates the pairing to the kybernos-cloud plugin through
      // the window event `kybernos-cloud:open`; « Add your API key » opens the page's
      // native « Add provider » flow, which stays the only path
      // to a personal key. In frozen mode (?kybernos-models=sample),
      // there is no network read: the card renders the mock-up's discovered state.
      // KB-HERO-PURE-BEGIN
      /** The plan key of the connected account (`space_plan.key`, else `user.plan`), lower case, or null when the status does not say. Pure. */
      const kbHeroPlan = (res) => {
        const o = res !== null && typeof res === 'object' ? res : {}
        const sp = o.space_plan !== null && typeof o.space_plan === 'object' ? o.space_plan.key : undefined
        if (typeof sp === 'string' && sp !== '') return sp.toLowerCase()
        const u = o.user !== null && typeof o.user === 'object' ? o.user.plan : undefined
        return typeof u === 'string' && u !== '' ? u.toLowerCase() : null
      }
      /** « Add your API key » next to Kybernos Cloud: offered while the account is not connected, and on a Free account. A connected
       *  paid account has nothing to paste (V-28). Pure. */
      const kbHeroShowKey = (connected, plan) => connected !== true || plan === 'free'
      // KB-HERO-PURE-END
      const HERO_MODELS_FALLBACK = 19 // the mock-up: « 19 curated models » (the free plan's catalogue)
      const kbmHeroModels = () => KBM.models.filter((mo) => mo.route === 'kybernos')
      const KybernosHero = () => {
        kbmUse()
        const mine = KBM.live === true ? kbmHeroModels() : []
        const [cloud, setCloud] = React.useState(null) // null = unknown · false = disconnected · true = connected
        const [plan, setPlan] = React.useState(null) // the account's plan key ('free', …); null when the status does not say
        React.useEffect(() => {
          if (KBM.live !== true) return undefined
          let mort = false
          fetch('/kybernos-cloud/status', { headers: { 'content-type': 'application/json' } })
            .then((r) => r.json())
            .then((res) => { if (mort !== true) { KBM.cloud = res !== null && typeof res === 'object' && res.connected === true; kbmNotify(); setCloud(KBM.cloud); setPlan(kbHeroPlan(res)) } })
            .catch(() => { if (mort !== true) { KBM.cloud = false; kbmNotify() } })
          return () => { mort = true }
        }, [])
        const connecte = cloud === true
        const n = mine.length > 0 ? mine.length : HERO_MODELS_FALLBACK
        const ouvrirCloud = () => {
          try { window.dispatchEvent(new CustomEvent('kybernos-cloud:open')) } catch (e) { /* cloud card not mounted */ }
        }
        const ajouterCle = () => {
          // The native « Add provider » button lives in the same section, under the
          // rows: the card first switches to the Providers tab (which alone
          // shows the native UX), then clicks — a single write path.
          uiSet('tab', 'providers')
          const btn = Array.from(document.querySelectorAll('button'))
            .filter((b) => /^add provider$/i.test((b.innerText || '').trim()))[0]
          if (btn) btn.click()
        }
        // Mock-up A (2026-10-20): the anatomy of a provider card — logo tile, name + dot, one line under it, the action on the right — on the night blue.
        // Connected: no button (and « or add a key » on a Free account). Not connected: « Connect » and « or add a key ». The name opens the Models view
        // on its models once they exist; the card IS the « kybernos » provider (the plain card of that route is not drawn beside it).
        const voirModeles = () => { uiSet('prov', 'kybernos'); uiSet('tab', 'models') }
        const nom = connecte === true && mine.length > 0
          ? h('button', { type: 'button', className: 'kbpv-link', 'data-kbmh': 'models', title: m('kb.hero.models.tip'), onClick: voirModeles }, 'Kybernos Cloud')
          : h('span', null, 'Kybernos Cloud')
        return h('div', { className: 'kbpv-card kbmh-hero', 'data-kbmh': 'block' },
          h('span', { className: 'kbpv-logo kbmh-hero-logo', 'aria-hidden': 'true' }, 'K'),
          h('div', { className: 'kbpv-cbody' },
            h('span', { className: 'kbmh-hero-name' }, nom,
              connecte === true ? h('i', { className: 'kbmh-hero-dot', 'data-kbmh': 'badge-on', title: m('kb.hero.connected') }) : null),
            h('span', { className: 'kbmh-hero-sub', 'data-kbmh': 'title' },
              connecte === true
                ? [h('span', { key: 'sr', className: 'kbmh-hero-sr' }, m('kb.hero.connected') + '. '), m(n === 1 ? 'kb.hero.title.in.one' : 'kb.hero.title.in', { n })]
                : [h('span', { key: 'tag', className: 'kbmh-hero-tag', 'data-kbmh': 'badge' }, m('kb.hero.badge')), ' ', m('kb.hero.title.free')])),
          // (The load error is told once, by the panel's banner right under the tab bar, which also has the Retry.)
          h('div', { className: 'kbmh-hero-side' },
            // Connected, there is nothing to press here: the account (e-mail, plan, teams, disconnect) is in the account menu, which is where « Manage » used to lead.
            connecte === true ? null : h('button', {
              type: 'button', className: 'kbmh-hero-btn', 'data-kbmh': 'connect',
              title: m('kb.hero.connect.tip'), 'aria-label': m('kb.hero.connect'), onClick: ouvrirCloud,
            }, m('kb.hero.connect.short')),
            kbHeroShowKey(connecte, plan) ? h('button', {
              type: 'button', className: 'kbmh-hero-alt', 'data-kbmh': 'addkey',
              title: m('kb.hero.addkey.tip'), 'aria-label': m('kb.hero.addkey'), onClick: ajouterCle,
            }, m('kb.hero.addkey.short')) : null))
      }

      // ── the order marker of the kybernos row (provider-card seat) ──
      // The seat is rendered in EVERY provider card (also in the
      // add draft, whose route does not exist yet): only the really configured
      // kybernos row is marked. Nothing visible — the
      // row keeps its native look, the CSS does the rest.
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
        // The section attribute drives the display of the two contents (CSS
        // below): Providers → DSH's native UX; Models → the catalogue.
        // On unmount the attribute goes: the native rows come back.
        React.useEffect(() => {
          const rootEl = document.querySelector('[data-slot="kybernos-models-header"]')
          const sec = rootEl !== null ? rootEl.closest('[data-slot="settings.section"]') : null
          if (sec === null) return undefined
          sec.setAttribute('data-kbm-tab', UI.tab === 'providers' ? 'providers' : 'models')
          return () => { sec.removeAttribute('data-kbm-tab') }
        })
        // The Score column is read once the Models tab is up and the models are known (and again after a newer snapshot).
        React.useEffect(() => { if (UI.tab !== 'providers') kbMScoreListLoad(false) })
        React.useEffect(() => {
          const fermerMenu = () => { if (UI.menu !== null) { UI.menu = null; kbmNotify() } }
          // Escape closes the menu or the details sheet and nothing else: capturing it first, and stopping it when we
          // used it, keeps DSH from also closing Settings under the sheet.
          const touche = (ev) => {
            if (ev.key !== 'Escape') return
            if (UI.menu !== null) { UI.menu = null; kbmNotify(); ev.stopPropagation(); return }
            let ferme = false
            for (const mo of KBM.models) if (mo.open === true) { mo.open = false; ferme = true }
            if (ferme === true) { kbmNotify(); ev.stopPropagation() }
          }
          document.addEventListener('click', fermerMenu)
          document.addEventListener('keydown', touche, true)
          return () => {
            document.removeEventListener('click', fermerMenu)
            document.removeEventListener('keydown', touche, true)
          }
        }, [])
        return h('div', { className: 'kbm-root kbmp', 'data-slot': 'kybernos-models-header' },
          KBM.live === true && KBM.loading === true && skelOf() === null ? h('div', { className: 'kbmp-dim', 'data-kbm': 'loading' }, m('kb.models.loading')) : null,
          KBM.live === true && KBM.loadError !== null ? h('div', { className: 'kbm-warn', 'data-kbm': 'loaderror' },
            // The helper-not-answering sentence stands on its own; any other reason follows « Load failed: ».
            (KBM.loadError === m('kb.models.hostdown') ? '' : m('kb.models.loaderror') + sep()) + String(KBM.loadError),
            h('button', { type: 'button', className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kbm': 'reload', onClick: () => { kbMLoad() } }, m('kb.models.reload'))) : null,
          // Two tabs, one visible content at a time:
          //  · « Providers » shows DSH's NATIVE UX (the rows with
          //    Edit/Delete under our panel) — the data-kbm-tab attribute
          //    set on the section reveals the list and hides the catalogue;
          //  · « Models » (our creation) shows the detailed catalogue and
          //    hides the native rows, one at a time, never two lists.
          h('div', { className: 'kbmp-tabs', role: 'tablist', 'data-kbm': 'tabs' },
            h('button', {
              type: 'button', role: 'tab', 'data-kbm': 'tab-providers',
              'aria-selected': UI.tab === 'providers',
              className: 'kbm-pill' + (UI.tab === 'providers' ? ' kbm-pill-active' : ' kbm-pill-interactive'),
              onClick: () => uiSet('tab', 'providers'),
            }, m('kb.models.tab.providers', { n: kbProvRoutes().length + kbDsCardsOf(KBM.ds, KBM.dsDir).length })),
            h('button', {
              type: 'button', role: 'tab', 'data-kbm': 'tab-models',
              'aria-selected': UI.tab !== 'providers',
              className: 'kbm-pill' + (UI.tab !== 'providers' ? ' kbm-pill-active' : ' kbm-pill-interactive'),
              onClick: () => uiSet('tab', 'models'),
            }, m('kb.models.tab.models', { n: KBM.models.length })),
            h(HealthChip, null),
            UI.tab !== 'providers' ? h('span', { className: 'kbmp-tabsend' },
              h(Tip, { text: m('kb.models.sub') + ' · ' + (KBM.live === true ? m('kb.models.phase.live') : m('kb.models.phase.sample')) + ' · ' + m('kb.models.mark.wire') + ' · ' + m('kb.models.mark.note') },
                h('span', { className: 'kbmp-info', 'data-kbm': 'phase', tabIndex: 0, role: 'img', 'aria-label': m('kb.models.sub') }, Ic('info', 15))),
              h('span', { className: 'kbpv-menuwrap' },
                h('button', { type: 'button', className: 'kbpv-ib', 'data-kbm': 'models-more', 'aria-haspopup': 'menu', 'aria-expanded': UI.menu === '__page' ? 'true' : 'false', 'aria-label': m('kb.pv.more.page'), title: m('kb.pv.more.page'),
                  onClick: (ev) => { ev.stopPropagation(); uiSet('menu', UI.menu === '__page' ? null : '__page') } }, Ic('more', 16)),
                UI.menu === '__page' ? h('div', { className: 'kbpv-menu kbpv-menu-head', role: 'menu', 'data-kbm': 'models-menu', onClick: (ev) => ev.stopPropagation() },
                  h('button', { type: 'button', role: 'menuitem', 'data-kbm': 'fetch', onClick: () => { UI.menu = null; for (const mo of KBM.models) kbmSync(mo.key); kbmNotify() } }, Ic('download', 14), m('kb.models.menu.sync')),
                  h('button', { type: 'button', role: 'menuitem', className: 'kbpv-danger' + (KBM.confirmRestore === true ? ' kbmp-armed' : ''), 'data-kbm': 'restore',
                    onClick: () => { kbmRestoreAll(); if (KBM.confirmRestore !== true) UI.menu = null; kbmNotify() } }, Ic('undo', 14), KBM.confirmRestore === true ? m('kb.models.restore.arm') : m('kb.models.restore')),
                  h('hr', null),
                  h('button', { type: 'button', role: 'menuitem', 'aria-checked': kbmChipsOn() ? 'true' : 'false', 'data-kbm': 'chips-toggle',
                    onClick: () => { try { window.localStorage.setItem(KB_CHIPS_PREF, kbmChipsOn() ? '0' : '1') } catch (e) { /* per-viewer convenience */ } UI.menu = null; kbmNotify() } }, Ic(kbmChipsOn() ? 'check' : 'tag', 14), m('kb.models.menu.chips')),
                  h('button', { type: 'button', role: 'menuitem', 'data-kbm': 'native-open', onClick: () => { UI.menu = null; kbmNotify(); kbNatOpen() } }, Ic('external', 14), m('kb.nat.open'))) : null)) : null),
          // The catalog's description, the "Live data" state, Restore defaults and Fetch used to stack four
          // bands above the search: they are now an info icon and one ⋯ menu on the tab bar.
          UI.tab !== 'providers' && KBM.live === true && KBM.writable === false ? h('div', { className: 'kbm-warn', 'data-kbm': 'readonly' }, m('kb.models.readonly')) : null,
          UI.tab !== 'providers' ? (
          KBM.restoredNote !== null && KBM.restoredNote !== undefined
            ? h('div', { className: 'kbmp-note', 'data-kbm': 'restored' }, m('kb.models.restore.note') + String(KBM.restoredNote))
            : null
          ) : null,
          // One visible content at a time: the provider list on
          // the Providers tab, the detailed catalogue on the Models tab.
          UI.tab === 'providers' ? h(ProviderList, null) : h(ListView, null)
        )
      }

      // ── panel CSS: the mock-up's layout, in the theme's tokens.
      //    The CONTROLS come from DSH's CSS above (same rules
      //    as the mock-up): here there is only the grid and the spacing.
      const CSS_PANEL = [
        '.kbm-root.kbmp{container-type:inline-size;margin:0 0 26px;padding:0 0 26px;border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:14px}',
        '/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */',
        'body:not([data-ds-dark-theme]) .kbm-root.kbmp{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}',
        '.kbmp [hidden]{display:none!important}',
        // ── panel header: subtitle + state + actions on one line ───
        '.kbm-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}',
        '.kbm-headleft{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}',
        '.kbm-sub{font-size:12.5px;color:var(--dsw-alias-label-tertiary);max-width:62ch}',
        // Page header (Settings template 02/10): title 18/600, subtitle 13 at 6 px, next block at 20 px.
        '.kbm-page{box-sizing:border-box;width:100%;max-width:720px}',
        // The core plugin caps every child of a Settings section at 720 px; this page, with a table and a card grid, uses the room it has.
        '[class$="_options"] [data-slot="settings.section"]>.kbm-page:has(.kbm-root.kbmp){max-width:1120px}',
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
        // 30 px on both tabs: the Models tab adds two 30 px icon buttons at the end of the row, which made the row 2 px taller there and moved the tabs by 1 px.
        '.kbmp-tabs{position:relative;display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:30px}',
        '.kbmp-tabs .kbm-pill{height:28px;padding:0 12px;font-size:13px;cursor:pointer}',
        '.kbmp-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:8px}',
        '.kbmp-dim{color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-pager{display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:.5px solid var(--dsw-alias-border-l1)}',
        '.kbmp-pageinfo{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-right:auto}',
        '.kbmp-pagenum{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:44px;text-align:center}',
        '.kbmp-empty{padding:22px 12px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
        // ── liste des fournisseurs (onglet Providers) ────────────────────────
        /* cartes fournisseurs : grille 2 colonnes, logo + nom + compteur + voir */
        '.kbmp-logo{display:inline-flex;border-radius:5px}',
        '.kbmp-logo-chip{align-items:center;justify-content:center;border-radius:7px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-weight:600;line-height:1}',
        '.kbmp-c.kbmp-cprov{flex-direction:row;align-items:center;gap:8px}',
        '.kbmp-cols .kbmp-mx,.kbmp-thead .kbmp-mx,.kbmp-sep2{display:none}',
        // Below 860 px the provider and the capability icons sit on a line of their own under the id: whole, never "ant…".
        '.kbmp-metaline{flex-wrap:wrap}',
        '.kbmp-nar{display:flex;flex:1 0 100%;align-items:center;gap:6px;min-width:0}',
        '.kbmp-nar .kbmp-mroute{max-width:none}',
        // From 860 px the table reads in columns: the provider in full, and nine fixed capability slots (a column of
        // eyes answers "which models see images?" at a glance; the header icons filter).
        '@container (min-width: 860px){.kbmp-table .kbmp-thead,.kbmp-table .kbmp-cols{grid-template-columns:minmax(0,1.9fr) minmax(0,1fr) 236px 64px 118px 56px;gap:14px;padding:0 16px}.kbmp-table .kbmp-thead .kbmp-c-prov,.kbmp-table .kbmp-cols .kbmp-cprov{display:flex}.kbmp-table .kbmp-cols .kbmp-nar{display:none}.kbmp-table .kbmp-cols .kbmp-capsl,.kbmp-table .kbmp-thead .kbmp-thl{display:none}.kbmp-table .kbmp-cols .kbmp-mx,.kbmp-table .kbmp-thead .kbmp-mx{display:grid;grid-template-columns:repeat(10,22px);justify-content:space-between;align-items:center}.kbmp-table .kbmp-cols .kbmp-cctx{text-align:right}.kbmp-table .kbmp-thead .kbmp-c-context{justify-content:flex-end}.kbmp-capsbar:not(.kbmp-capsbar-on){display:none}}',
        '.kbmp-provname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.kbmp-mxc{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px}',
        '.kbmp-mxoff{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-border-l4)}',
        '.kbmp-mxbtn{border:0;background:transparent;border-radius:7px;padding:0;cursor:pointer;opacity:.7}',
        '.kbmp-mxbtn:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbmp-mxbtn.on{opacity:1;background:var(--dsw-alias-bg-layer-3);box-shadow:0 0 0 .5px var(--dsw-alias-border-l4)}',
        '.kbmp-mxbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
        '.kbmp-thb{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}',
        '.kbmp-thb:hover,.kbmp-thb.on{color:var(--dsw-alias-label-primary)}',
        '.kbmp-thb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}',
        '.kbmp-thar{display:inline-flex;transform:rotate(90deg)}',
        '.kbmp-ovline{font-size:11px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap}',
        '.kbmp-why{flex:1 0 100%;font-size:11.5px;line-height:16px;color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 62%,var(--dsw-alias-label-primary))}',
        '.kbmp-score{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.kbmp-resbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-grow{flex:1}',
        '.kbmp-link{border:0;background:transparent;padding:2px 4px;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
        '.kbmp-tabsend{margin-left:auto;display:inline-flex;align-items:center;gap:4px}',
        // Model health chip (the alert of the study model), on the tab bar: small at rest, the detail in a popover. The popover is
        // anchored to the tab bar (not to the chip), so it fits at any width.
        '.kbhc{display:inline-flex}',
        '.kbhc-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;border:.5px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer}',
        '.kbhc-chip svg{color:var(--dsw-alias-state-warn-primary);flex:none}',
        '.kbhc-chip:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,transparent)}',
        '.kbhc-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.kbhc-pop{position:absolute;z-index:25;left:0;top:calc(100% + 6px);box-sizing:border-box;width:min(430px,100%);display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.3)}',
        '.kbhc-title{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}',
        '.kbhc-detail{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
        '.kbhc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto}',
        '.kbhc-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:1px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.kbhc-list code{justify-self:start;max-width:100%;overflow-wrap:anywhere;font-size:11.5px;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
        '.kbhc-cause{grid-column:1;min-width:0}',
        '.kbhc-list .kbhc-btn{grid-column:2;grid-row:1 / span 2;align-self:center}',
        '.kbhc-acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px}',
        '.kbhc-btn{height:26px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
        '.kbhc-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbhc-btn[disabled]{opacity:.55;cursor:default}',
        '.kbhc-btn-quiet{border-color:transparent;color:var(--dsw-alias-label-secondary);margin-left:auto}',
        '.kbmp-info{display:inline-flex;color:var(--dsw-alias-label-tertiary);cursor:help}',
        '.kbmp-info:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:50%}',
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
        // border-box: min-height is the card's height, padding included (as a content box it came to 76 + 28 = 106 px, 30 px of empty air). 70 = the 46 px logo + 2 × 12 px of padding.
        '.kbpv-card{box-sizing:border-box;position:relative;display:flex;align-items:center;gap:14px;padding:12px 14px;min-height:70px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2)}',
        '.kbpv-card:hover,.kbpv-card:focus-within{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3)}',
        '.kbpv-off{opacity:.62}',
        '.kbpv-off:hover{opacity:.92}',
        '.kbpv-logo{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
        // On a card the logo is the first thing read: a 46 px tile with a 30 px drawing (the drawers' headers keep the small one).
        '.kbpv-card>.kbpv-logo{width:46px;height:46px;border-radius:12px}',
        '.kbpv-search{flex:0 1 320px;min-width:160px}',
        '.kbpv-cbody{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}',
        '.kbpv-cbody .kbmp-free{position:relative;z-index:1;align-self:flex-start;margin-top:3px}',
        '.kbpv-nm{display:flex;align-items:center;min-width:0;font-family:ui-monospace,monospace;font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.kbpv-link{all:unset;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-link::after{content:"";position:absolute;inset:0;border-radius:14px}',
        '.kbpv-link:focus-visible::after{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
        '.kbpv-static{cursor:default}',
        '.kbpv-static::after{display:none}',
        '.kbpv-next{align-self:flex-start;margin-top:3px;padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);text-align:left;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
        '.kbpv-fold{display:flex;align-items:center;gap:6px;margin:12px 0 0;padding:6px 2px;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}',
        '.kbpv-fold:hover{color:var(--dsw-alias-label-primary)}',
        '.kbpv-fold:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:6px}',
        '.kbpv-fold-chev{display:inline-flex;transition:transform .12s}.kbpv-fold-chev.open{transform:rotate(90deg)}',
        '.kbpv-fold-hint{margin:2px 0 10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
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
        '.kbpv-mhead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
        '.kbpv-mact{display:inline-flex;align-items:center;gap:14px;flex-wrap:wrap}',
        // DeepSeek catalog rows: id, name and delete on the first line, the three options under them.
        '.kbpv-dsrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 30px;gap:6px;align-items:center;padding-bottom:10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-dsopts{grid-column:1 / -1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:6px 10px;align-items:end}',
        '.kbpv-dscap{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        '.kbpv-dsimg{display:inline-flex;align-items:center;gap:6px;height:36px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
        '.kbpv-lnk{border:0;background:transparent;padding:2px 0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
        '.kbpv-lnk:hover:not([disabled]){color:var(--dsw-alias-label-primary)}',
        '.kbpv-lnk:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}',
        '.kbpv-lnk[disabled]{opacity:.5;cursor:default;text-decoration:none}',
        // "Fetch available models": the picker is a dialog above the drawer (kbm-mdl-root sits at z-index 1000).
        '.kbpv-fetch{width:min(520px,100%);gap:6px}',
        '.kbpv-fetch-body{display:flex;flex-direction:column;gap:12px;padding:0 24px;margin-top:0}',
        '.kbpv-fetch-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-fetch-note{margin:0;padding:8px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-state-warn-primary);font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
        '.kbpv-fetch-bar{display:flex;gap:8px;align-items:center}',
        '.kbpv-fetch-bar input{flex:1;min-width:0}',
        '.kbpv-fetch-list{list-style:none;margin:0;padding:0;max-height:min(340px,45vh);overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px}',
        '.kbpv-fetch-list li+li{border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.kbpv-fetch-lab{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 12px;cursor:pointer}',
        '.kbpv-fetch-lab:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.kbpv-fetch-lab input{grid-row:1 / span 2;margin:0}',
        '.kbpv-fetch-id{grid-column:2;font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-fetch-nm{grid-column:2;grid-row:2;font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.kbpv-fetch-meta{grid-column:3;grid-row:1 / span 2;font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.kbpv-fetch-known{opacity:.55;cursor:default}',
        '.kbpv-fetch-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
        '.kbpv-fetch-act{display:inline-flex;gap:8px}',
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
        '.kbpv-cb-grp{padding:8px 10px 4px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
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
        /* add-provider form */
        // ── preset picker + « free models · quota » badge (02/10) ─────
        '.kbmp-free{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:9px;font-size:10.5px;line-height:14px;font-weight:600;color:#0b7a3b;background:rgba(34,197,94,.16);white-space:nowrap}',
        '.kbmp-free-sm{height:16px;padding:0 6px;font-size:10px}',
        // The dark green ink is for the light scheme; on the dark layers it was 1.9:1 (dark green on a dark green tint).
        'body[data-ds-dark-theme] .kbmp-free{color:var(--dsw-alias-state-success-primary)}',
        // Light scheme: the capability tints are 500-level colours (emerald 2.5:1, amber 2.2:1 on white); darkened as a whole.
        'body:not([data-ds-dark-theme]) .kbmp-capi{filter:brightness(.72)}',
        '.kbmp-free-lien{color:inherit;text-decoration:none;font-weight:700;display:inline-block;padding:5px 8px;margin:-5px -8px}',
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
        /* logo in the model row */
        '.kbmp-mcellroute{display:inline-flex;align-items:center;gap:5px;min-width:0}',
        // ── the two tabs, one content each ─────────────────────────────
        // Providers (default): DSH's native UX — the rows under our
        // panel remain the only interface that writes key and base URL.
        // Models: our catalogue, and the native rows withdraw —
        // never two lists visible at the same time.
        '[data-slot="settings.section"][data-kbm-tab="providers"] .kbmp-listwrap{display:none}',
        '[data-slot="settings.section"][data-kbm-tab="models"] ul{display:none}',
        // ── liste Models : recherche, quatre filtres, puces, table ──────────
        '.kbmp-listwrap{display:flex;flex-direction:column;gap:10px}',
        '.kbmp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.kbmp-search{flex:1 1 240px;min-width:200px}',
        '.kbmp-loupe{flex:none;color:var(--dsw-alias-label-tertiary)}',
        '.kbmp-search .kbm-in-input::-webkit-search-cancel-button{display:none}',
        // the shared input's placeholder is label-dimmed: 1.6:1 on the dark layer, 1.3:1 on white
        '.kbmp-search .kbm-in-input::placeholder,.kbm-in-input.kbpv-in::placeholder{color:var(--dsw-alias-label-secondary)}',
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
        // ICON + LABEL chips: eight mute discs did not say
        // what they filtered.
        '.kbmp-cap{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
        '.kbmp-cap:hover{border-color:var(--dsw-alias-border-l3)}',
        '.kbmp-cap .kbmp-capi{display:inline-flex}',
        '.kbmp-cap.on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}',
        '.kbmp-cap.on .kbmp-capi{color:currentColor!important}',
        'body:not([data-ds-dark-theme]) .kbmp-cap.on .kbmp-capi{filter:none}',
        // The panel's table lives in a 556 or 720 px column (the Settings
        // box): five columns, of which only one shares the room. The
        // model carries name + « id · route · type · price » — no empty
        // column left, no truncated name.
        '.kbmp-table{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
        '.kbmp-thead,.kbmp-cols{display:grid;grid-template-columns:minmax(0,1fr) 52px 84px 44px;gap:8px;align-items:center;padding:0 10px}',
        '.kbmp-thead .kbmp-c-caps,.kbmp-cols .kbmp-ccaps,.kbmp-thead .kbmp-c-prov,.kbmp-cols .kbmp-cprov{display:none}',
        '@container (min-width: 620px){.kbmp-thead,.kbmp-cols{grid-template-columns:minmax(0,1fr) 88px 58px 104px 46px}.kbmp-thead .kbmp-c-caps,.kbmp-cols .kbmp-ccaps{display:flex}.kbmp-nar .kbmp-caprow{display:none}.kbmp-mtype,.kbmp-mprix,.kbmp-sep2{display:inline-flex;align-items:center;gap:4px}}',
        '.kbmp-mtype,.kbmp-mprix{display:none}',
        // The row's two actions: a 24 px zone, aligned ON the
        // same line (the rule `.kbmp-c{flex-direction:column}` would otherwise
        // win over a plain `.kbmp-cact`).
        '.kbmp-c.kbmp-cact{flex-direction:row;align-items:center;justify-content:flex-end;gap:2px;opacity:0;transition:opacity .12s}',
        '@media (hover:none){.kbmp-c.kbmp-cact{opacity:1}}',
        '@media (prefers-reduced-motion:reduce){.kbmp-c.kbmp-cact{transition:none}}',
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
        // At 556 px, the longest name in the catalogue (249 px) fitted by 1 px only:
        // under 620 px it drops to 12.5 px, and keeps its place whatever happens.
        '@container (max-width: 619px){.kbmp-nom{font-size:12.5px}}',
        // The model's context line: id (mono), route, type, price.
        '.kbmp-metaline{display:flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        // `field-sizing` (Chrome 123+): the field takes the width of its id
        // instead of a fixed size that cut « anthropic/claude-sonnet ».
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
        // The override is told on the name's line: it describes the model, not
        // the source, and the whole sentence (« 5 overrides · 0 applied ») did not
        // fit in the SOURCE column.
        // The overrides pill: discreet (amber border, no
        // fill) — 69 imported models almost all carry some, an
        // orange flat on every row shouted louder than the table.
        // ── the kit's tooltip: placed above the anchor, revealed on
        //    hover and on keyboard focus; the visual style comes from
        //    .kbm-tip-bubble (DSH kit), here only the place is set.
        '.kbm-tipwrap{position:relative;display:inline-flex;max-width:100%}',
        '.kbm-tip{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:90;pointer-events:none;opacity:0;transition:opacity 120ms ease;width:max-content;max-width:min(320px,72vw);white-space:normal;text-align:left}',
        '.kbm-tipwrap:hover .kbm-tip,.kbm-tipwrap:focus-within .kbm-tip{opacity:1}',
        '.kbmp-lig .kbm-tipwrap{line-height:0}',
        '.kbmp-avis{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmp-chev{display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
        '.kbmp-chev.open{transform:rotate(90deg)}',
        '.kbmp-danger{color:var(--dsw-alias-state-error-primary)}',
        '.kbmp-err{margin:0 12px 8px;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
        '.kbmp-err-mdl{margin:0 0 12px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);font-size:13px}',
        '.kbm-ferr{margin-top:4px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary)}',
        // Catalogue rows INSIDE a provider card: the model and its
        // context line are enough, the card's header says the route.
        // TWO columns (model + actions): a single one would push the
        // actions onto an implicit second row, twice as tall for nothing.
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
        '.kbmp-dot{width:7px;height:7px;border-radius:999px;flex:none;display:inline-block}',
        '.kbmp-dot.sync{background:var(--dsw-alias-state-business-primary)}',
        '.kbmp-dot.ov{background:var(--dsw-alias-state-warn-primary)}',
        // Icon-only chips: the label lives in the button's title/aria-label,
        // the pill and the link complete the state. Fixed width
        // (icon only): fourteen capabilities take one line less.
        '.kbm-chip{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:30px;min-width:34px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer}',
        '.kbm-chip:hover{border-color:var(--dsw-alias-border-l3)}',
        '.kbm-chip.on{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}',
        '.kbm-chip .kbm-ico{display:inline-flex;align-items:center}',
        '.kbm-chip.on .kbm-mark{color:currentColor}',
        '.kbm-chip.on .kbmp-dot{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}',
        '.kbm-sec{display:flex;flex-direction:column;gap:9px}',
        '.kbm-seclab{display:flex;align-items:baseline;gap:8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}',
        '.kbm-sechint{font-size:11px;font-weight:500;letter-spacing:0;text-transform:none;margin-top:3px}',
        '.kbm-chips{display:flex;flex-wrap:wrap;gap:8px}',
        '.kbm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:12px}',
        '.kbm-grid.wide{grid-template-columns:repeat(auto-fit,minmax(158px,1fr))}',
        // The class names are those of the Field component: do not reinvent them.
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
        // The label wraps instead of being cut: « Terminal-Bench 4.0 »
        // was truncated to « Terminal-Bench ... » in a ~150 px cell, and a
        // clipped benchmark name reads badly. The value itself is never cut.
        '.kbm-sc-l{font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbm-sc-v{font-size:11.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex:none}',
        '.kbm-sc-foot{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:15px}',
        '.kbm-scmeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
        '.kbm-sc-empty{margin:0}',
        '.kbm-wirenote{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
        // ── « Kybernos Models » header block (the page's header seat) ──
        '.kbm-root.kbmh{margin-top:0;padding-top:0;border-top:none;gap:10px;flex-direction:column}',
        // ── the Kybernos Cloud card: the first cell of the provider grid (mock-up A, 2026-10-20) ──
        // Same anatomy as a provider card (logo tile, name + dot, a line under it, the action on the right), on a BRAND blue that does not follow the
        // theme: it reads the same in light and dark. One value per colour: #1F2A4D the night blue (#243158 hovered), #2C3A63 its border (#3A4B80
        // hovered), #FFFFFF the button and the logo tile, #EAF0FF / #B9C4DE the light texts, #34C759 the green of the connected dot.
        '.kbpv-card.kbmh-hero{background:#1F2A4D;border-color:#2C3A63;color:#EAF0FF}',
        '.kbpv-card.kbmh-hero:hover,.kbpv-card.kbmh-hero:focus-within{background:#243158;border-color:#3A4B80}',
        '.kbmh-hero>.kbmh-hero-logo{background:#FFFFFF;color:#10182B;font-size:22px;font-weight:700;line-height:1}',
        '.kbmh-hero-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:14.5px;font-weight:600;color:#FFFFFF;white-space:nowrap}',
        '.kbmh-hero-name .kbpv-link{font-weight:600}',
        '.kbmh-hero-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#34C759}',
        '.kbmh-hero-sub{font-size:12.5px;line-height:18px;color:#B9C4DE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbmh-hero-tag{display:inline-block;margin-right:4px;padding:0 6px;border-radius:999px;border:.5px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);font-size:10px;line-height:16px;color:#C7D2E8}',
        // The actions sit above the card-wide link of the name (the provider cards do the same with their own).
        '.kbmh-hero-side{position:relative;z-index:1;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
        '.kbmh-hero-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 12px;border:none;border-radius:9px;background:#FFFFFF;color:#10182B;font-family:inherit;font-size:12.5px;font-weight:600;line-height:18px;white-space:nowrap;cursor:pointer}',
        '.kbmh-hero-btn:hover{background:#E8EDF9}',
        '.kbmh-hero-btn:focus-visible,.kbmh-hero-alt:focus-visible{outline:2px solid #FFFFFF;outline-offset:2px}',
        '.kbmh-hero-alt{all:unset;box-sizing:border-box;font-size:11px;line-height:14px;color:#B9C4DE;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;cursor:pointer}',
        '.kbmh-hero-alt:hover{color:#FFFFFF}',
        '.kbmh-hero-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
        // ── the « Kybernos Cloud » row at the head of the native list ─────────
        // The native list (ul of the ModelsSection module) is already a flex
        // column: `order:-1` lifts the marked row without touching the DOM nor
        // the DSH core. The marker is invisible; the seat's outlet renders an
        // anchor `display:contents`, so a descendant `:has()` is enough — only the
        // kybernos row carries .kbm-rowmark.
        '.kbm-rowmark{display:none!important}',
        'li:has(.kbm-rowmark){order:-1}',
        '@media (prefers-reduced-motion: no-preference){.kbmp *{transition:background-color .15s ease,border-color .15s ease,color .15s ease}}',
      ].join('\n')

      // DSH controls (kbm-*) are shared by Models and Sessions: a single <style id="kbm-controls-style"> for both.
      const kbPoseControles = () => {
        if (typeof document === 'undefined' || document.getElementById('kbm-controls-style')) return
        const st = document.createElement('style')
        st.id = 'kbm-controls-style'
        st.textContent = DSH_CONTROLS_CSS
        document.head.appendChild(st)
      }
      const CSS = CSS_PANEL


      // ── wired phase: a single place to fill (step 2) ──────────────────
      // Today `KBM.live` is false: the screen works on the frozen set and
      // writes nothing. At step 2, these three functions become the only place
      // that touches the network — the components do not change.
      //   kbMPersist : `wire` fields → `remote.settings.mutate('llm-pi-ai', …)`,
      //                annotations → POST /kybernos-models/annotations/save;
      //   kbMLoad    : fills KBM.models from `remote.llm` + `settings.describe`;
      //   kbMSyncLive: reads GET /kybernos-models/modelsdev?route=…&id=… (cached index).
      // ── The real fields: a control → a path in `llm-pi-ai` ───────
      // What the harness schema REALLY accepts per model:
      //   name: string · contextWindow: int>0 · maxTokens: int>0
      //   input: subset of ['text','image'] · reasoningEfforts: false | dict
      //   compat: ~20 switches (no control in the mock-up: outside the panel)
      // A model lives under `models[i]` (declared route: it has a `models` list)
      // or under `modelOverrides.<id>` (catalogue route). The harness REFUSES
      // `modelOverrides` next to a `models` list — hence the two paths.
      const KB_NS = 'llm-pi-ai'
      const KB_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      // KB-NUM-PURE-BEGIN
      // A count typed in the model sheet: "131072", "256K", "1M", "1.5M" (decimal suffixes, like the native page and the DeepSeek
      // form below), or a number; "128 000", "128,000" and "128_000" still work. Anything else, zero, a negative or an absurd size
      // (more than 100 million) gives null: the write is refused, with a message. It used to strip every non-digit, so "256K"
      // was written as 256 and "abc12" as 12. Pure.
      const KB_COUNT_MAX = 1e8
      const kbMNum = (v) => {
        if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v <= KB_COUNT_MAX ? Math.round(v) : null
        let t = String(v === null || v === undefined ? '' : v).trim().replace(/[\s_]/g, '')
        if (/^\d{1,3}(,\d{3})+(\.\d+)?[km]?$/i.test(t)) t = t.replace(/,/g, '')
        const n = kbDsParseCapacity(t)
        return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= KB_COUNT_MAX ? Math.round(n) : null
      }
      // KB-NUM-PURE-END
      const kbMFieldOf = (k) => {
        if (k === 'name') return 'name'
        if (k === 'context') return 'contextWindow'
        if (k === 'outputLimit') return 'maxTokens'
        if (k === 'textIn' || k === 'vision') return 'input'
        if (k === 'reasoning') return 'reasoningEfforts'
        return null
      }
      /** The write path, or an explicit error.
       *  The settings service does NOT traverse arrays (`path` only accepts
       *  strings and an array is not an object): for a declared route
       *  the whole `models` LIST is therefore rewritten — starting again from the
       *  USER layer, never from the resolved layer (which would materialise the
       *  schema's defaults, for example `input: []`). */
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
      /** The wire value, or the `KB_REFUS` sentinel when translation is
       *  impossible (unknown reasoning levels) — we refuse instead of
       *  writing an invented value. */
      const KB_REFUS = Symbol('refused')
      /** The EFFECTIVE modalities of an entry that does not write `input`:
       *  the route's if it declares them, otherwise the harness default
       *  (`llm-pi-ai`: DEFAULT_INPUT = ['text']). Never guessed further. */
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

      /** The local annotations: read at load, patched field by field. */
      const kbMAnnotations = async (key, fields) => {
        const url = fields === undefined ? '/kybernos-models/annotations' : '/kybernos-models/annotations/save'
        const res = await fetch(url, fields === undefined ? { headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, fields }) })
        if (res.status !== 200) throw new Error('HTTP ' + String(res.status))
        const body = await res.json()
        if (body === null || body.ok !== true) throw new Error(String(body && body.error ? body.error : 'refused'))
        return body
      }

      /** The local journal (host): every write attempt leaves a
       *  line there. Best-effort: an unavailable journal never blocks a gesture. */
      const kbMJournal = async (event) => {
        try {
          await fetch('/kybernos-models/journal', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
          })
        } catch (e) { /* journal best-effort */ }
      }
      /** A service that does not answer must not leave the panel hanging:
       *  after the delay, control is handed back and the screen says so. */
      const kbMTimeout = (promise, ms) => new Promise((resolve) => {
        let done = false
        const timer = setTimeout(() => {
          if (done === true) return
          done = true
          resolve({ ok: false, error: { code: 'timeout', message: 'no answer from the settings service in ' + String(ms) + ' ms' } })
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

      /** The host contract: the list of real fields, compared with ours.
       *  If the two diverge, the panel SAYS so instead of showing a
       *  flattering count. */
      const KB_PANEL_FIELDS = ['contextWindow', 'input', 'maxTokens', 'name', 'reasoningEfforts']
      // `compat` is indeed writable by the harness (~20 switches)
      // but the mock-up exposes NO control for it: it is therefore « outside the
      // panel », listed here so that the contract stays true without lying.
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

      /** Writing a control. Two channels, never mixed. */
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
            if (wire === KB_REFUS) { mo.error = m(k === 'context' || k === 'outputLimit' ? 'kb.models.error.number' : 'kb.models.error.wire'); mo.errorAt = { k, text: mo.error }; kbmNotify(); return false }
            // A return to the lower layer's value is written by removing the
            // key: what the harness already applies is not declared again.
            if ((k === 'textIn' || k === 'vision') && Array.isArray(mo.raw.input) !== true && kbMSameList(wire, kbMInputBase(mo)) === true) del = true
          }
          const plan = kbMOps(mo, k, del, wire)
          if (plan.error !== undefined) { mo.error = plan.error; kbmNotify(); return false }
          const ops = plan.ops
          await kbMJournal({ niveau: 'settings', route: mo.route, id: mo.id, champ: k, op: ops[0].op, chemin: plan.path, valeur: ops[0].value === undefined ? null : ops[0].value, revision: KBM.revision })
          const raw = await kbMTimeout(api.settings.mutate(KB_NS, ops, KBM.revision), 8000)
          const resp = raw === null || raw === undefined ? { ok: false, error: { code: 'empty', message: 'empty answer' } } : raw
          if (resp.ok !== true) {
            const code = resp.error && resp.error.code ? resp.error.code : 'refused'
            await kbMJournal({ niveau: 'settings', route: mo.route, id: mo.id, champ: k, ok: false, code, message: String(resp.error && resp.error.message ? resp.error.message : '') })
            if (code === 'settings/conflict') {
              mo.error = m('kb.models.error.conflict')
              setTimeout(() => { kbMLoad() }, 400)
            } else {
              mo.error = m('kb.models.error.refus') + sep() + String(resp.error && resp.error.message ? resp.error.message : code)
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
          mo.error = m('kb.models.error.reseau') + sep() + String(e && e.message ? e.message : e)
          kbmNotify()
          return false
        }
      }

      /** A reload loses nothing. The acquired states of a row — models.dev
       *  sheet, external notes, open row, refusal to show — come back
       *  on the row with the SAME KEY (`route/id`). An « Add a model » line
       *  being typed also survives: it does not come from the document, only a
       *  document can replace it. */
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
          // A write refusal stays shown (the write did not happen) — except
          // the revision conflict, which this very reload has just settled.
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
          // The two DeepSeek adapters live in their own namespaces; the page edits both (see KB-DS-PURE).
          KBM.ds = {}
          for (const ns of KB_DS_NS) {
            const v = namespaces.filter((n) => n.ns === ns)[0]
            if (v !== undefined) KBM.ds[ns] = { ns, user: kbMOBJ(v.user), base: kbMOBJ(v.base), value: kbMOBJ(v.value), revision: typeof v.revision === 'number' ? v.revision : null }
          }
          KBM.hasDeepseek = Object.keys(KBM.ds).length > 0
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
          await kbMLoadDsKey(api)
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
              // Catalogue route: the installed catalogue is not readable from here,
              // so the overrides already set are shown (and « Add model »
              // creates one). Nothing is invented.
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
          // The local annotations (the second level) — never on top of a
          // real field: a wired control takes its value from settings.yaml.
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
          // The browser's own text for a refused connection or an HTML answer (« Failed to fetch », « Load failed ») is not
          // something to read: say what it means.
          const brut = String(e && e.message ? e.message : e)
          // (By the message, not the error class: a TypeError can also be a bug of ours, which must stay visible.)
          KBM.loadError = /^(failed to fetch|load failed|networkerror)|unexpected token|is not valid json/i.test(brut) ? m('kb.models.hostdown') : brut
          kbmNotify()
          kbMRefreshDone()
          return false
        }
      }

      // ── Refresh driven by DSH's invalidations ───────────────
      // The NATIVE Models page re-subscribes to the four signals below; this
      // panel read settings.yaml ONLY ONCE, when mounted. A
      // provider or a model added while the page is open therefore did not
      // show up in it — the page had to be reloaded (bug seen twice
      // on 23/09/2026: « I added mimo, but I cannot find it in
      // Models »). The same signals are listened to, writing nothing: a short delay
      // absorbs the bursts, and a read already running is replayed when it ends
      // rather than doubled.
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

      /** A safe object: not null, not undefined, not an array. */
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
            KBM.dsDir = rows.filter((e) => kbPvIsObj(e) && typeof e.provider === 'string' && KB_DS_NS.indexOf(e.settingsNs) >= 0).map((e) => ({ ns: e.settingsNs, provider: e.provider, name: typeof e.displayName === 'string' ? e.displayName : '' }))
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
          const entry = catDe(route)
          const ref = kbPvKeyRefOf(prof, entry !== null ? entry.env : null)
          if (kbPvIsObj(prof) && ref !== null && refs.indexOf(ref) < 0) refs.push(ref)
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
      const kbMMutateRetry = async (api, ops, ns = KB_NS) => {
        for (let essai = 0; essai < 2; essai += 1) {
          // Each namespace has its own revision: the models' (llm-pi-ai) or a DeepSeek adapter's.
          const rev = ns === KB_NS ? KBM.revision : (KBM.ds[ns] !== undefined ? KBM.ds[ns].revision : null)
          const raw = await kbMTimeout(api.settings.mutate(ns, ops, rev), 8000)
          const resp = raw === null || raw === undefined ? { ok: false, error: { code: 'empty', message: 'empty answer' } } : raw
          if (resp.ok === true) {
            if (resp.value && typeof resp.value.revision === 'number') { if (ns === KB_NS) KBM.revision = resp.value.revision; else if (KBM.ds[ns] !== undefined) KBM.ds[ns].revision = resp.value.revision }
            return resp
          }
          if (!(resp.error && resp.error.code === 'settings/conflict') || essai === 1) return resp
          await kbMLoad()
        }
        return { ok: false, error: { code: 'refused' } }
      }
      const kbMErrText = (resp) => String(resp && resp.error ? (resp.error.message || resp.error.code) : 'refused')

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
        // The provider's companions (its custom models) are switched off with it.
        for (const c of kbCompanionsOf(route, KBM.routes)) { try { await kbMDisable(c) } catch (e) { /* it stays on: the provider is off */ } }
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
        // ...and so are the companions that were switched off with it.
        for (const pk of KBM.parked.filter((x) => kbCompanionOf(x.slug, [slug]) !== null)) { try { await kbMEnable(pk.slug) } catch (e) { /* stays off */ } }
      }
      // KB-PARK-ACTIONS-END

      // KB-HEALTH-PURE-BEGIN
      // ── Model health chip ──
      // kybernos-sessions probes the configured models and publishes the verdict on a small public contract
      // (`window.__kybernosHealth` and a `kybernos-health` event on `window`); this page only DRAWS it, on the tab
      // bar. The rules below are pure so the tests can run them as written.
      const KB_HEALTH_CAUSES = ['key', 'gone', 'refused', 'text', 'silent', 'other']
      /** What `get()` returned, checked: a view with at least one failing model, or null (nothing to say). Anything
       *  unexpected reads as null — the chip must never throw into the page. Pure. */
      const kbHealthView = (raw) => {
        if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.alertes)) return null
        const alertes = []
        for (const a of raw.alertes) {
          if (a === null || typeof a !== 'object' || typeof a.cle !== 'string' || a.cle === '') continue
          const cut = a.cle.indexOf('/')
          alertes.push({
            cle: a.cle,
            route: typeof a.route === 'string' && a.route !== '' ? a.route : (cut < 0 ? a.cle : a.cle.slice(0, cut)),
            cause: KB_HEALTH_CAUSES.indexOf(a.cause) >= 0 ? a.cause : 'other',
            code: typeof a.code === 'string' ? a.code.slice(0, 40) : ''
          })
        }
        if (alertes.length === 0) return null
        const total = Number(raw.total)
        return { alertes, total: total >= alertes.length ? total : alertes.length, tousEnEchec: raw.tousEnEchec === true, checking: raw.checking === true }
      }
      /** [{ cause, n }] in the fixed order above (the actionable key problems first); causes nobody has are left out. Pure. */
      const kbHealthCauses = (alertes) => KB_HEALTH_CAUSES.map((c) => ({ cause: c, n: alertes.filter((a) => a.cause === c).length })).filter((c) => c.n > 0)
      /** The rows to list: at most `max`, key problems first, then by key; `more` counts the rest. Pure. */
      const kbHealthRows = (alertes, max) => {
        const sorted = alertes.slice().sort((a, b) => (KB_HEALTH_CAUSES.indexOf(a.cause) - KB_HEALTH_CAUSES.indexOf(b.cause)) || (a.cle < b.cle ? -1 : (a.cle > b.cle ? 1 : 0)))
        return { rows: sorted.slice(0, max), more: Math.max(0, sorted.length - max) }
      }
      /** The failing models as a lookup by "route/id" (what the Models tab filters on). Pure. */
      const kbHealthDown = (vue) => {
        const out = {}
        if (vue !== null) for (const a of vue.alertes) out[a.cle] = true
        return out
      }
      /** The failing models as a lookup by "route/id" to what is known about them (the page words the cause on the row). Pure. */
      const kbHealthIndex = (vue) => {
        const out = {}
        if (vue !== null) for (const a of vue.alertes) out[a.cle] = a
        return out
      }
      /** Is this model free to call? The Free LLMs route, an id that says so, or a provider known for a free quota. Pure. */
      const kbHealthFree = (route, id, freeRoutes) => route === 'opencode-free' || /(:free|-free)$/i.test(String(id)) || (Array.isArray(freeRoutes) && freeRoutes.indexOf(route) >= 0)
      /** The sentence (a key under kb.health.why.*) that says WHY a model is not answering, for the person to act on: a key problem is
       *  « not in your Kybernos plan » for a Kybernos Cloud model, « may no longer be free » for a free one, « the key is refused » for the
       *  rest (V-29). Pure. */
      const kbHealthWhy = (alerte, free) => {
        if (alerte.cause === 'key') return alerte.route === 'kybernos' ? 'kb.health.why.cloud' : (free === true ? 'kb.health.why.free' : 'kb.health.why.key')
        return 'kb.health.why.' + alerte.cause
      }
      // KB-HEALTH-PURE-END
      /** The published view, or null: no bundle, no study model, nothing failing, or the hour of silence is running. */
      const kbHealthGet = () => {
        try {
          const bus = window.__kybernosHealth
          return bus !== null && bus !== undefined && typeof bus.get === 'function' ? kbHealthView(bus.get()) : null
        } catch (e) { return null }
      }
      const kbHealthCall = (name) => {
        try {
          const bus = window.__kybernosHealth
          if (bus !== null && bus !== undefined && typeof bus[name] === 'function') bus[name]()
        } catch (e) { /* the chip is a convenience: a dead bus changes nothing else */ }
      }
      const HealthChip = () => {
        kbmUse()
        const [, tick] = React.useState(0)
        React.useEffect(() => {
          // The whole panel re-reads the verdict: the Models tab folds the failing models away, it must hear of a new one too.
          const on = () => { tick((n) => n + 1); kbmNotify() }
          window.addEventListener('kybernos-health', on)
          return () => window.removeEventListener('kybernos-health', on)
        }, [])
        const vue = kbHealthGet()
        if (vue === null) return null
        const open = UI.menu === '__health'
        const n = vue.alertes.length
        const all = vue.tousEnEchec === true
        const label = all ? m('kb.health.chip.all') : (n === 1 ? m('kb.health.chip.one') : m('kb.health.chip.many', { n }))
        const lines = kbHealthRows(vue.alertes, 6)
        const showThem = () => { UI.menu = null; UI.tab = 'models'; UI.q = ''; UI.prov = 'all'; UI.type = 'all'; UI.caps = {}; UI.statut = 'down'; UI.page = 1; UI.showDown = true; kbmNotify() }
        const hide = () => { kbHealthCall('hide'); UI.menu = null; if (UI.statut === 'down') UI.statut = 'any'; kbmNotify() }
        const fixKey = (route) => { UI.menu = null; UI.tab = 'providers'; UI.edit = route; kbmNotify() }
        return h('span', { className: 'kbhc', 'data-kbm': 'health' },
          h('button', {
            type: 'button', className: 'kbhc-chip', 'data-kbm': 'health-chip', 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
            'aria-label': m('kb.health.aria') + ' — ' + label, title: m('kb.health.aria'),
            onClick: (ev) => { ev.stopPropagation(); uiSet('menu', open ? null : '__health') },
          }, Ic('alert', 14), label),
          open ? h('div', { className: 'kbhc-pop', role: 'dialog', 'aria-label': m('kb.health.aria'), 'data-kbm': 'health-pop', onClick: (ev) => ev.stopPropagation() },
            h('div', { className: 'kbhc-title' }, all ? m('kb.health.title.all') : (n === 1 ? m('kb.health.title.one', { total: vue.total }) : m('kb.health.title.many', { n, total: vue.total }))),
            all
              ? h('div', { className: 'kbhc-detail', 'data-kbm': 'health-all' }, m('kb.health.all.detail', { total: vue.total }))
              : [
                h('div', { key: 'c', className: 'kbhc-detail', 'data-kbm': 'health-causes' }, kbHealthCauses(vue.alertes).map((c) => String(c.n) + ' ' + m('kb.health.cause.' + c.cause)).join(' · ')),
                h('ul', { key: 'l', className: 'kbhc-list', 'data-kbm': 'health-list' },
                  lines.rows.map((a) => h('li', { key: a.cle, 'data-kbm': 'health-row', 'data-kbm-key': a.cle },
                    h('code', { title: a.cle }, a.cle),
                    h('span', { className: 'kbhc-cause', 'data-kbm': 'health-why', title: a.code }, m(kbHealthWhy(a, kbHealthFree(a.route, a.cle.slice(a.route.length + 1), Object.keys(FREE_LINKS))))),
                    a.cause === 'key' ? h('button', { type: 'button', className: 'kbhc-btn', 'data-kbm': 'health-fix', title: m('kb.health.fixkey.t', { slug: a.route }), onClick: () => fixKey(a.route) }, m('kb.health.fixkey')) : null)),
                  lines.more > 0 ? h('li', { key: 'more', className: 'kbhc-detail' }, m('kb.health.more', { n: lines.more })) : null),
                h('div', { key: 'i', className: 'kbhc-detail' }, m('kb.health.impact'))],
            h('div', { className: 'kbhc-acts' },
              h('button', { type: 'button', className: 'kbhc-btn', 'data-kbm': 'health-recheck', disabled: vue.checking === true, onClick: () => kbHealthCall('recheck') }, vue.checking === true ? m('kb.health.checking') : m('kb.health.recheck')),
              h('button', { type: 'button', className: 'kbhc-btn', 'data-kbm': 'health-show', onClick: showThem }, m('kb.health.show', { n })),
              h('button', { type: 'button', className: 'kbhc-btn kbhc-btn-quiet', 'data-kbm': 'health-hide', onClick: hide }, m('kb.health.hide')))) : null)
      }

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
      /** Whether the native cell is hidden when nothing is stored. `true` since this page does everything the native one
       *  does (providers, the models tab, "Fetch available models", both DeepSeek adapters); the native page stays one click
       *  away (⋯ menu, and the note on the native page itself). */
      const KB_NAT_DEFAULT_HIDDEN = true
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
      /** The credential reference a route reads its key from: the one its profile names, else the one the catalogue gives that
       *  provider (a catalog add with the key left blank writes no `apiKeyEnv` yet), else null (a route that names no key at
       *  all, such as a local endpoint: nothing to say about it). Pure. */
      const kbPvKeyRefOf = (prof, catEnv) => (kbPvIsObj(prof) && typeof prof.apiKeyEnv === 'string' && prof.apiKeyEnv !== '' ? prof.apiKeyEnv : (typeof catEnv === 'string' && catEnv !== '' ? catEnv : null))
      /** 'ok' | 'missing' | 'unknown' for a route that has a key reference, 'none' for one that has not. A catalog provider added
       *  without its key is 'missing', like every other provider without one (it showed no dot at all: A3-32). Pure. */
      const kbPvKeyState = (prof, catEnv, keys) => {
        const ref = kbPvKeyRefOf(prof, catEnv)
        if (ref === null) return 'none'
        const st = keys !== null && typeof keys === 'object' ? keys[ref] : undefined
        return st === true ? 'ok' : (st === false ? 'missing' : 'unknown')
      }
      /** Which cards wait under a fold. A provider with no key (or switched off) answers nothing, so once at least one provider works they
       *  fold away and the first view is the ones that do; with none working everything stays in view (a fold over the whole page would
       *  hide the page). `flags` is one boolean per card, true = waiting. Pure. */
      const kbPvFold = (flags) => {
        const list = Array.isArray(flags) ? flags : []
        const waiting = list.filter((x) => x === true).length
        return { fold: waiting > 0 && waiting < list.length, waiting }
      }
      /** The providers that match a search: every word typed must be among the provider's own words (its slug, its name, the ids and names of the
       *  models it serves), case and accents ignored, so « claude » finds every provider that serves one. An empty query keeps everything. Pure. */
      const kbPvSearch = (items, q) => {
        const flat = (s) => String(s === undefined || s === null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
        const words = flat(q).split(/\s+/).filter((w) => w !== '')
        if (words.length === 0) return items
        return items.filter((x) => { const hay = flat(x.hay); return words.every((w) => hay.indexOf(w) >= 0) })
      }
      // ── Custom models of a catalog provider: a route of their own ──
      // The engine takes ONE `api` and ONE `baseURL` per route and none per model, and a model its installed catalog does not describe has
      // neither: on a route whose catalog serves several protocols it is refused (« model "x" needs an api… », then « …needs a baseURL… »).
      // Setting them on the route would bind every other model to them. So such a model lives in a COMPANION route of the provider
      // (`<route>-custom-<chat|resp|msgs>`, one per protocol, declared with its own api and address, the provider's key reference): the page
      // draws it as part of the provider (its card counts it, the Models tab lists it under the provider, the Edit panel removes it).
      /** The model the engine refuses for want of a protocol or an address, or null for any other message. Pure. */
      const kbPvRefusedModel = (message) => { const mm = /model "([^"]+)" needs (?:an api|a baseURL)/.exec(String(message === undefined || message === null ? '' : message)); return mm === null ? null : mm[1] }
      const KB_COMP_SUFFIX = { 'openai-completions': 'chat', 'openai-responses': 'resp', 'anthropic-messages': 'msgs' }
      const KB_COMP_RE = /^(.+)-custom-(chat|resp|msgs)$/
      /** The route that holds a provider's custom models for one protocol. Pure. */
      const kbCompanionSlug = (route, api) => route + '-custom-' + (KB_COMP_SUFFIX[api] !== undefined ? KB_COMP_SUFFIX[api] : 'chat')
      /** The provider a companion slug belongs to when that provider is among `known`, else null (a route that merely looks like one is not). Pure. */
      const kbCompanionOf = (slug, known) => { const mm = KB_COMP_RE.exec(String(slug)); return mm !== null && Array.isArray(known) && known.indexOf(mm[1]) >= 0 ? mm[1] : null }
      /** The companions of a provider among `slugs`. Pure. */
      const kbCompanionsOf = (route, slugs) => (Array.isArray(slugs) ? slugs : []).filter((s) => { const mm = KB_COMP_RE.exec(String(s)); return mm !== null && mm[1] === route })
      /** The profile of a companion: the provider's key reference, the protocol and address its models speak, and their entries (an entry that already exists
       *  keeps its tuned fields). `before` is the saved companion, if any. Pure. */
      const kbCompanionProfile = (parent, parentRoute, keyRef, api, baseURL, rows, before) => {
        const next = kbPvIsObj(before) ? { ...before } : {}
        const label = kbPvIsObj(parent) && typeof parent.displayName === 'string' && parent.displayName.trim() !== '' ? parent.displayName.trim() : parentRoute
        next.displayName = label + ' (custom)'
        next.api = api
        next.baseURL = baseURL
        if (typeof keyRef === 'string' && keyRef !== '') next.apiKeyEnv = keyRef
        const existing = Array.isArray(next.models) ? next.models : []
        const merged = kbPvMergeModels(existing, existing.map((e) => ({ id: e.id, name: typeof e.name === 'string' ? e.name : '' })).concat(rows))
        next.models = merged
        return next
      }
      /** Model rows (id + optional name) from a draft: drops blank ids, keeps the first of a duplicate. Pure. */
      const kbPvRows = (rows) => {
        const seen = new Set()
        const out = []
        for (const r of Array.isArray(rows) ? rows : []) {
          const id = String(r && r.id !== undefined ? r.id : '').trim()
          if (id === '' || seen.has(id)) continue
          seen.add(id)
          const row = { id, name: String(r && r.name !== undefined ? r.name : '').trim() }
          // What "Fetch available models" disclosed (capacities, input types) rides along on a new row.
          if (Number.isInteger(r.contextWindow) && r.contextWindow > 0) row.contextWindow = r.contextWindow
          if (Number.isInteger(r.maxTokens) && r.maxTokens > 0) row.maxTokens = r.maxTokens
          if (Array.isArray(r.input) && r.input.length > 0 && r.input.every((x) => typeof x === 'string')) row.input = r.input.slice()
          out.push(row)
        }
        return out
      }
      /** Draft model rows → the profile's `models`, keeping every other field the existing entry carried. Pure. */
      const kbPvMergeModels = (existing, rows) => {
        const byId = new Map()
        for (const e of Array.isArray(existing) ? existing : []) if (kbPvIsObj(e) && typeof e.id === 'string') byId.set(e.id, e)
        return kbPvRows(rows).map((r) => {
          // An entry that already exists keeps every field it carried (the user may have tuned them); a new one takes
          // what the endpoint disclosed.
          const base = byId.has(r.id) ? { ...byId.get(r.id) } : { id: r.id }
          if (!byId.has(r.id)) {
            if (r.contextWindow !== undefined) base.contextWindow = r.contextWindow
            if (r.maxTokens !== undefined) base.maxTokens = r.maxTokens
            if (r.input !== undefined) base.input = r.input
          }
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
        if (d.restoreModels === true) delete next.models // back to the adapter's built-in list
        else if (d.models !== undefined) {
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
        // A route the installed catalog does not describe serves nothing until its models are
        // listed (measured on gmicloud, 08/10: the native add refuses with “resolves no models”).
        // A catalog add with a pasted key asks the endpoint over the wire — the same
        // `llm.discoverModels` call the fetch panel uses — and adopts the answer as its list.
        if (prof.models === undefined && d.tab === 'catalog' && String(d.key || '').trim() !== '') {
          const found = await kbFetchRun(api, kbFetchProbe(slug, d))
          if (found.kind === 'found' && found.models.length > 0) prof.models = found.models.map(kbFetchAdopt)
          else if (found.kind === 'refused' && found.unavailable !== true) throw new Error(m('kb.prov.add.sans.modeles', { raison: found.message }))
        }
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
        const gone = [slug].concat(kbCompanionsOf(slug, KBM.routes))
        const resp = await kbMMutateRetry(api, gone.map((s) => ({ op: 'unset', path: ['providers', s] })))
        await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'delete', chemin: ['providers', slug], ok: resp.ok === true })
        if (resp.ok !== true) throw new Error(kbMErrText(resp))
        if (KBM.parked.some((p) => p.slug === slug)) { try { await kbMParkCall('forget', { slug }) } catch (e) { /* the copy stays hidden */ } }
        await kbMLoad()
      }
      /** Ask the host which protocol a model speaks (it asks the provider, with the stored key). When it cannot say, OpenAI chat at the provider's
       *  address. Never throws. */
      const kbCompanionProbe = async (route, id, base) => {
        try {
          const res = await kbMTimeout(fetch('/kybernos-models/models/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route, model: id }) }), 45000)
          let out = null
          if (res !== null && res !== undefined && typeof res.json === 'function') { try { out = await res.json() } catch (e) { out = null } }
          if (kbPvIsObj(out) && out.ok === true && typeof out.api === 'string' && typeof out.baseURL === 'string') return { api: out.api, baseURL: out.baseURL, found: true }
        } catch (e) { /* the default below */ }
        return { api: 'openai-completions', baseURL: base, found: false }
      }
      /** Add custom models to a provider: one companion route per protocol, created or completed. `guessed` counts the models whose protocol could not be
       *  confirmed (the default was taken). */
      const kbCompanionAdd = async (api, route, rows) => {
        const parent = kbMOBJ(KBM.userProviders)[route]
        const entry = catDe(route)
        const keyRef = kbPvKeyRefOf(parent, entry !== null ? entry.env : null)
        const base = kbPvIsObj(parent) && typeof parent.baseURL === 'string' && parent.baseURL !== '' ? parent.baseURL : (entry !== null && typeof entry.url === 'string' ? entry.url : '')
        if (base === '') throw new Error(m('kb.pv.err.nobase'))
        const groups = new Map()
        let guessed = 0
        for (const row of rows) {
          const pr = await kbCompanionProbe(route, String(row.id).trim(), base)
          if (pr.found !== true) guessed += 1
          const slug = kbCompanionSlug(route, pr.api)
          if (!groups.has(slug)) groups.set(slug, { api: pr.api, baseURL: pr.baseURL, rows: [] })
          groups.get(slug).rows.push(row)
        }
        for (const [slug, g] of groups) {
          const before = kbMOBJ(KBM.userProviders)[slug]
          const after = kbCompanionProfile(parent, route, keyRef, g.api, g.baseURL, g.rows, before)
          const ops = kbPvIsObj(before) ? kbPvDiffOps(['providers', slug], before, after) : [{ op: 'set', path: ['providers', slug], value: after }]
          const resp = await kbMMutateRetry(api, ops)
          await kbMJournal({ niveau: 'settings', route: slug, champ: 'provider', op: 'set', chemin: ['providers', slug], ok: resp.ok === true })
          if (resp.ok !== true) throw new Error(kbMErrText(resp))
        }
        return { routes: Array.from(groups.keys()), guessed }
      }
      /** Remove one custom model from the provider's companions; a companion left with no model goes with it. */
      const kbCompanionRemove = async (route, id) => {
        const api = kbMApi()
        if (api === null || api.settings === null) throw new Error(m('kb.models.error.remote'))
        if (KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const ops = []
        for (const slug of kbCompanionsOf(route, KBM.routes)) {
          const prof = kbMOBJ(KBM.userProviders)[slug]
          const list = kbPvIsObj(prof) && Array.isArray(prof.models) ? prof.models : []
          if (!list.some((x) => kbPvIsObj(x) && x.id === id)) continue
          const rest = list.filter((x) => !(kbPvIsObj(x) && x.id === id))
          if (rest.length === 0) ops.push({ op: 'unset', path: ['providers', slug] })
          else ops.push({ op: 'set', path: ['providers', slug, 'models'], value: rest })
        }
        if (ops.length === 0) return false
        const resp = await kbMMutateRetry(api, ops)
        await kbMJournal({ niveau: 'settings', route, champ: 'provider', op: 'edit', chemin: ['providers', route + '-custom'], ok: resp.ok === true })
        if (resp.ok !== true) throw new Error(kbMErrText(resp))
        await kbMLoad()
        return true
      }
      /** Save an edit. A model the engine refuses for want of a protocol or an address (outside its catalog, on a provider whose catalog serves several)
       *  is not an error: it becomes a custom model of the provider (kbCompanionAdd) and the rest is saved as usual. */
      const kbPvSaveSmart = async (slug, d) => {
        const api = kbMApi()
        const extra = []
        let draft = d
        let out = null
        for (let guard = 0; guard < 80 && out === null; guard += 1) {
          try { out = await kbPvSave(slug, draft) } catch (e) {
            const bad = kbPvRefusedModel(e && e.message)
            const rows = Array.isArray(draft.models) ? draft.models : []
            if (bad === null || !rows.some((r) => String(r.id).trim() === bad)) throw e
            // The refused row and every row flagged as outside the catalog (the same cause): they move to the companion.
            const moving = rows.filter((r) => String(r.id).trim() === bad || r.outside === true)
            for (const r of moving) if (!extra.some((x) => String(x.id).trim() === String(r.id).trim())) extra.push(r)
            draft = { ...draft, models: rows.filter((r) => moving.indexOf(r) < 0), touched: true }
          }
        }
        if (out === null) throw new Error(m('kb.pv.save.err', { slug, raison: 'too many refused models' }))
        let custom = null
        if (extra.length > 0) { custom = await kbCompanionAdd(api, slug, extra); await kbMLoad() }
        return { ...out, custom, customN: extra.length }
      }
      // KB-PV-ACTIONS-END
      // KB-QK-BEGIN
      // ── A key pasted outside this page: the first-run wizard's seam (window.__KB_MODELS__) ───────────────
      // The wizard asks for a provider and a key, nothing else; the write is the one the Add provider flow makes (kbPvCreate,
      // or, when the route is already declared, only its key), so a key saved from the wizard looks exactly like one saved here.
      // The four providers the wizard offers: the address and the key reference come from the shipped catalogue.
      const KB_QK_PROVIDERS = ['anthropic', 'openai', 'deepseek', 'google']
      const kbQkEntry = async (provider) => {
        let entry = catDe(provider)
        if (entry === null || typeof entry.url !== 'string' || entry.url === '') {
          try {
            const r = await fetch('/kybernos-models/providers', { headers: { accept: 'application/json' } })
            const b = r.status === 200 ? await r.json() : null
            if (b !== null && Array.isArray(b.providers) && b.providers.length > 0) { KB_CATALOGUE = kbCatalogueFusion(b.providers); entry = catDe(provider) }
          } catch (e) { entry = null }
        }
        return entry !== null && typeof entry.url === 'string' && entry.url !== '' ? entry : null
      }
      /** @returns {Promise<{ok:true,slug:string,existed:boolean}|{ok:false,reason:string}>} reason is a code, never a provider's words */
      const kbQuickKey = async (provider, key) => {
        if (KB_QK_PROVIDERS.indexOf(provider) < 0) return { ok: false, reason: 'unknown_provider' }
        const value = typeof key === 'string' ? key.trim() : ''
        if (value === '') return { ok: false, reason: 'empty' }
        const api = kbMApi()
        if (api === null || api.settings === null) return { ok: false, reason: 'unavailable' }
        try {
          await kbMLoad()
          if (KBM.loadError !== null && KBM.loadError !== undefined) return { ok: false, reason: 'unavailable' }
          if (KBM.writable !== true) return { ok: false, reason: 'readonly' }
          const entry = await kbQkEntry(provider)
          if (entry === null) return { ok: false, reason: 'unknown_provider' }
          const declared = kbMOBJ(KBM.userProviders)[provider]
          if (kbPvIsObj(declared)) {
            // Already a route of this profile: only its key is missing or stale.
            const ref = typeof declared.apiKeyEnv === 'string' && declared.apiKeyEnv !== '' ? declared.apiKeyEnv : kbPvKeyRef(provider)
            if (ref !== declared.apiKeyEnv) {
              const resp = await kbMMutateRetry(api, [{ op: 'set', path: ['providers', provider, 'apiKeyEnv'], value: ref }])
              if (resp.ok !== true) return { ok: false, reason: 'write_refused' }
            }
            const stored = await kbPvCredential(api, ref, value)
            await kbMLoad()
            return stored === true ? { ok: true, slug: provider, existed: true } : { ok: false, reason: 'key_not_stored' }
          }
          const made = await kbPvCreate({ tab: 'catalog', prov: provider, id: provider, name: entry.nom, url: entry.url, proto: 'openai-completions', key: value, models: [] })
          return made.keyOk === false ? { ok: false, reason: 'key_not_stored' } : { ok: true, slug: made.slug, existed: false }
        } catch (e) { return { ok: false, reason: 'refused' } }
      }
      /** Store one credential by its reference, for a route that is already declared and only lacks its key (the chat's card
       *  names it from the engine's own sentence). The reference must be a `*_API_KEY` name: nothing else is written here. */
      const kbQuickCredential = async (ref, key) => {
        if (typeof ref !== 'string' || !/^[A-Z][A-Z0-9_]{1,78}_API_KEY$/.test(ref)) return { ok: false, reason: 'bad_reference' }
        const value = typeof key === 'string' ? key.trim() : ''
        if (value === '') return { ok: false, reason: 'empty' }
        const api = kbMApi()
        if (api === null || api.credentials === null || api.credentials === undefined) return { ok: false, reason: 'unavailable' }
        try {
          const stored = await kbPvCredential(api, ref, value)
          if (stored !== true) return { ok: false, reason: 'key_not_stored' }
          try { await kbMLoad() } catch (e) { /* the page refreshes on its next load */ }
          return { ok: true }
        } catch (e) { return { ok: false, reason: 'refused' } }
      }
      // KB-QK-END
      // KB-FETCH-PURE-BEGIN
      // ── Fetch available models: ask the engine which models a provider serves ──
      // Measured on DSH 0.2.0-rc.2 (`llm.discoverModels(settingsNs, request)`, the call the native page makes): a route
      // the adapter's own catalog describes is answered from that catalog with no network call; a gateway or a
      // self-hosted server is asked over the wire, with the typed key for this call alone (never stored). Every
      // field but the id is optional. Nothing is written until the user applies the panel.
      /** The request for a draft. An edit names its route; an add (custom) names the endpoint the form shows. Pure. */
      const kbFetchProbe = (route, d) => {
        const p = {}
        const url = String(d.url || '').trim().replace(/\/+$/, '')
        if (typeof route === 'string' && route !== '') p.provider = route
        if (url !== '') p.baseURL = url
        if ((d.custom === true || d.tab === 'custom') && typeof d.proto === 'string' && d.proto !== '') p.api = d.proto
        if (String(d.key || '').trim() !== '') p.apiKey = String(d.key).trim()
        return p
      }
      /** Whether there is anything to ask: a route to name, or an endpoint. Pure. */
      const kbFetchAskable = (p) => typeof p.provider === 'string' || (typeof p.baseURL === 'string' && p.baseURL !== '')
      /** The well-formed candidates of an answer: a string id, the first of a duplicate, typed optional fields. Pure. */
      const kbFetchCandidates = (list) => {
        const seen = new Set()
        const out = []
        for (const c of Array.isArray(list) ? list : []) {
          if (c === null || typeof c !== 'object' || typeof c.id !== 'string' || c.id.trim() === '' || seen.has(c.id)) continue
          seen.add(c.id)
          const one = { id: c.id }
          if (typeof c.name === 'string' && c.name.trim() !== '') one.name = c.name.trim()
          if (Number.isInteger(c.contextWindow) && c.contextWindow > 0) one.contextWindow = c.contextWindow
          if (Number.isInteger(c.maxTokens) && c.maxTokens > 0) one.maxTokens = c.maxTokens
          if (Array.isArray(c.inputModalities) && c.inputModalities.every((x) => typeof x === 'string')) one.input = c.inputModalities.slice()
          out.push(one)
        }
        return out
      }
      /** The engine's answer as found / refused, never a throw. A timeout is told apart (its own message). Pure. */
      const kbFetchOutcome = (r) => {
        if (r !== null && typeof r === 'object' && r.ok === true && Array.isArray(r.value)) return { kind: 'found', models: kbFetchCandidates(r.value) }
        const e = r !== null && typeof r === 'object' && r.error !== null && typeof r.error === 'object' ? r.error : {}
        return { kind: 'refused', timeout: e.code === 'timeout', message: typeof e.message === 'string' ? e.message : '' }
      }
      /** A candidate as a draft row: id and name, plus the capacities the endpoint disclosed. Pure. */
      const kbFetchAdopt = (c) => {
        const row = { id: c.id, name: c.name !== undefined ? c.name : '' }
        if (c.contextWindow !== undefined) row.contextWindow = c.contextWindow
        if (c.maxTokens !== undefined) row.maxTokens = c.maxTokens
        if (c.input !== undefined) row.input = c.input.slice()
        if (c.undescribed === true) row.outside = true // outside the engine's catalog: a custom model of the provider (see kbCompanionAdd)
        return row
      }
      /** The ids ticked on opening: those not already in the draft (a model already there has nothing to adopt). Pure. */
      const kbFetchPreselect = (cands, rows) => {
        const have = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r && r.id !== undefined ? r.id : '').trim()))
        const picked = {}
        for (const c of cands) if (!have.has(c.id) && c.undescribed !== true) picked[c.id] = true
        return picked
      }
      /** Search over id and display name, case-insensitive. Pure. */
      const kbFetchFilter = (cands, q) => {
        const t = String(q || '').trim().toLowerCase()
        return t === '' ? cands : cands.filter((c) => c.id.toLowerCase().indexOf(t) >= 0 || (c.name !== undefined && c.name.toLowerCase().indexOf(t) >= 0))
      }
      /** The draft rows plus the ticked candidates. A row already there is kept exactly as it is (it may be tuned);
       *  the empty placeholder rows of the form go. Pure. */
      const kbFetchApply = (rows, cands, picked) => {
        const kept = (Array.isArray(rows) ? rows : []).filter((r) => String(r && r.id !== undefined ? r.id : '').trim() !== '' || String(r && r.name !== undefined ? r.name : '').trim() !== '')
        const have = new Set(kept.map((r) => String(r.id).trim()))
        const out = kept.slice()
        for (const c of cands) if (picked[c.id] === true && !have.has(c.id)) out.push(kbFetchAdopt(c))
        return out
      }
      /** The size of a fetched model, in the same words as the Context column (kbCapLabel): 256000 is "256K", 262144 "262.1K". Pure. */
      const kbFetchSize = (n) => kbCapLabel(n)
      /** The host's live answer (`POST /kybernos-models/models/live`) as found, or the reason there is none. Never a throw. Pure. */
      const kbFetchLiveOutcome = (r) => {
        if (r !== null && typeof r === 'object' && r.ok === true && Array.isArray(r.models)) return { kind: 'found', models: kbFetchCandidates(r.models), url: typeof r.url === 'string' ? r.url : '' }
        const o = r !== null && typeof r === 'object' ? r : {}
        return { kind: 'none', why: typeof o.error === 'string' ? o.error : 'host', status: Number.isInteger(o.status) ? o.status : 0, detail: typeof o.detail === 'string' ? o.detail : '' }
      }
      /** The live ids, each with the name and capacities the engine's catalog gives it where the endpoint disclosed none. The live list
       *  decides which models exist; the catalog only fills in what a bare `{id}` listing leaves out. Pure. */
      const kbFetchMerge = (live, catalog) => {
        const by = new Map((Array.isArray(catalog) ? catalog : []).map((c) => [c.id, c]))
        return live.map((c) => {
          const k = by.get(c.id)
          if (k === undefined) return c
          const one = { ...c }
          if ((one.name === undefined || one.name === one.id) && k.name !== undefined && k.name !== k.id) one.name = k.name
          if (one.contextWindow === undefined && k.contextWindow !== undefined) one.contextWindow = k.contextWindow
          if (one.maxTokens === undefined && k.maxTokens !== undefined) one.maxTokens = k.maxTokens
          if (one.input === undefined && k.input !== undefined) one.input = k.input
          return one
        })
      }
      /** Why there is no live list, as a string key and its values (the page words it). 401 and 403 say « the key »; any other refusal says what the provider said. Pure. */
      const kbFetchWhy = (none) => {
        const s = none.status
        if (none.why === 'refused') return s === 401 || s === 403 ? { key: 'kb.fetch.why.key', vars: { status: s } } : { key: 'kb.fetch.why.refused', vars: { status: s, detail: none.detail !== '' ? ': ' + none.detail : '' } }
        const keys = { unreachable: 'kb.fetch.why.unreachable', 'bad-reply': 'kb.fetch.why.bad', 'too-big': 'kb.fetch.why.big', host: 'kb.fetch.why.host' }
        return { key: keys[none.why] !== undefined ? keys[none.why] : 'kb.fetch.why.noaddr', vars: {} }
      }
      /** Tag the candidates the engine's catalog does not describe (`described` is its ids): they are added as custom models of the provider, so
       *  they are not ticked on opening. `described` null or empty = the engine could not say: nothing is tagged. Pure. */
      const kbFetchTagUndescribed = (cands, described) => {
        if (!Array.isArray(described) || described.length === 0) return cands
        const known = new Set(described)
        return cands.map((c) => (known.has(c.id) ? c : { ...c, undescribed: true }))
      }
      /** The host name of an address, for « Live list from opencode.ai ». Pure. */
      const kbFetchHost = (url) => { try { return new URL(String(url)).hostname } catch (e) { return String(url) } }
      // KB-FETCH-PURE-END
      // KB-FETCH-ACTIONS-BEGIN
      /** Ask the engine. Never throws: a service this DSH lacks, a refusal and a timeout all come back as `refused`. */
      const kbFetchEngine = async (api, probe) => {
        const llm = api === null ? null : api.llm
        if (llm === null || llm === undefined || typeof llm.discoverModels !== 'function') return { kind: 'refused', timeout: false, message: '', unavailable: true }
        try { return kbFetchOutcome(await kbMTimeout(llm.discoverModels(KB_NS, probe), 30000)) }
        catch (e) { return { kind: 'refused', timeout: false, message: String(e && e.message ? e.message : e) } }
      }
      /** Ask the host for the provider's own list, right now (live-models.mjs). Never throws: a host without the route (not restarted yet),
       *  a timeout and a refusal all come back as `none` with their reason. */
      const kbFetchLive = async (probe) => {
        try {
          const body = { route: probe.provider }
          // The address being typed is not saved yet: the list is the provider's own (the host reads its saved or catalogue address). It goes along
          // only beside a key typed for the same call: the person typed both, so the key may go where they said (live-models.mjs).
          if (typeof probe.apiKey === 'string') { body.key = probe.apiKey; if (typeof probe.baseURL === 'string') body.baseURL = probe.baseURL; if (typeof probe.api === 'string') body.api = probe.api }
          const res = await kbMTimeout(fetch('/kybernos-models/models/live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), 25000)
          if (res === null || res === undefined || typeof res.json !== 'function') return kbFetchLiveOutcome(null)
          let out = null
          try { out = await res.json() } catch (e) { out = null }
          return kbFetchLiveOutcome(out)
        } catch (e) { return kbFetchLiveOutcome(null) }
      }
      /** Fetch available models. By default the engine answers (a route its adapter ships a catalog of is answered from that catalog,
       *  with no network call). `opts.live` asks the provider's own endpoint first, through the host, so a model added yesterday shows
       *  up; the engine's answer is the fallback (and says why the live one is missing), and where the endpoint lists bare ids only it
       *  fills in the capacities its catalog knows. Never throws. */
      const kbFetchRun = async (api, probe, opts) => {
        if (opts === undefined || opts === null || opts.live !== true || typeof probe.provider !== 'string') return kbFetchEngine(api, probe)
        const live = await kbFetchLive(probe)
        if (live.kind === 'found') {
          let models = live.models
          let described = null
          if (models.length > 0) {
            const eng = await kbFetchEngine(api, probe)
            if (eng.kind === 'found') { described = eng.models.map((c) => c.id); models = kbFetchMerge(models, eng.models) }
          }
          return { kind: 'found', models, live: true, url: live.url, described }
        }
        const eng = await kbFetchEngine(api, probe)
        return eng.kind === 'found' ? { ...eng, live: false, why: kbFetchWhy(live) } : eng
      }
      // KB-FETCH-ACTIONS-END
      // KB-DS-PURE-BEGIN
      // ── DeepSeek: the two adapters that live outside llm-pi-ai ──
      // Measured on DSH 0.2.0-rc.2 (dsh-client-ui-settings-models): `deepseek-official` is the namespace `llm-deepseek` (an API
      // key under the profile's own `apiKeyEnv`, default DEEPSEEK_API_KEY; a base URL; a model catalog) and `deepseek-account`
      // is `llm-deepseek-account` (the catalog only: it signs in with the user's account). The namespace IS the profile (its
      // settings path is empty). The catalog `models` is replaced as ONE array: the first edit materializes every inherited row
      // into a user override, with the fields this page does not show (description, systemPromptUpdate, toolUpdate…), and
      // Restore removes the override instead of copying the defaults into it.
      const KB_DS_NS = ['llm-deepseek', 'llm-deepseek-account']
      const kbDsObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
      const kbDsScale = { k: 1e3, m: 1e6 }
      /** "256K", "1M", "131072" → a count; blank → undefined (inherit); anything else → NaN. Decimal suffixes, like the native page. Pure. */
      const kbDsParseCapacity = (text) => {
        const t = String(text === undefined || text === null ? '' : text).trim()
        if (t === '') return undefined
        const m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(t)
        if (m === null) return NaN
        const scaled = Number(m[1]) * (m[2] === undefined ? 1 : kbDsScale[m[2].toLowerCase()])
        const rounded = Math.round(scaled)
        return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
      }
      /** The shortest spelling that survives a round trip through the parser. Pure. */
      const kbDsFormatCapacity = (n) => {
        if (!Number.isInteger(n) || n <= 0) return String(n)
        if (n % 1e6 === 0) return String(n / 1e6) + 'M'
        if (n % 1e3 === 0) return String(n / 1e3) + 'K'
        return String(n)
      }
      /** Catalog rows as records, every field kept. Pure. */
      const kbDsRows = (value) => (Array.isArray(value) ? value.map((e) => (kbDsObj(e) ? { ...e } : {})) : [])
      /** The first invalid row — { index, key } — by the adapter's own rules, or null. Pure. */
      const kbDsValidate = (rows) => {
        const seen = new Set()
        const list = Array.isArray(rows) ? rows : []
        for (let index = 0; index < list.length; index += 1) {
          const r = list[index]
          const id = typeof r.id === 'string' ? r.id.trim() : ''
          if (id === '') return { index, key: 'kb.ds.err.id' }
          if (seen.has(id)) return { index, key: 'kb.ds.err.dup' }
          seen.add(id)
          if (r.name !== undefined && (typeof r.name !== 'string' || r.name === '')) return { index, key: 'kb.ds.err.name' }
          if (r.contextWindow !== undefined && !(Number.isInteger(r.contextWindow) && r.contextWindow > 0)) return { index, key: 'kb.ds.err.ctx' }
          if (r.maxTokens !== undefined && !(Number.isInteger(r.maxTokens) && r.maxTokens > 0)) return { index, key: 'kb.ds.err.max' }
        }
        return null
      }
      /** Rows as they are written: ids trimmed, an empty name or an unset capacity removed, every other field untouched. Pure. */
      const kbDsCleanRows = (rows) => (Array.isArray(rows) ? rows : []).map((r) => {
        const o = { ...r, id: String(r.id).trim() }
        for (const k of ['name', 'contextWindow', 'maxTokens']) if (o[k] === undefined || o[k] === '') delete o[k]
        return o
      })
      const kbDsHasImage = (r) => Array.isArray(r.inputModalities) && r.inputModalities.indexOf('image') >= 0
      /** Image input on or off; text stays. Pure. */
      const kbDsSetImage = (r, on) => {
        const base = Array.isArray(r.inputModalities) && r.inputModalities.length > 0 ? r.inputModalities.filter((x) => x !== 'image') : ['text']
        return { ...r, inputModalities: on === true ? base.concat(['image']) : base }
      }
      /** The user layer after the edit. `d.url` is undefined for the account adapter (it has no endpoint to set). Pure. */
      const kbDsEditProfile = (user, d) => {
        const next = { ...(kbDsObj(user) ? user : {}) }
        if (d.url !== undefined) {
          const url = String(d.url).trim().replace(/\/+$/, '')
          if (url === '') delete next.baseURL
          else next.baseURL = url
        }
        if (d.restoreModels === true) delete next.models
        else if (d.touched === true) next.models = kbDsCleanRows(d.rows)
        return next
      }
      /** The credential reference of the official adapter: the one its profile names, else the derived one. Pure. */
      const kbDsKeyRef = (value) => (kbDsObj(value) && typeof value.apiKeyEnv === 'string' && value.apiKeyEnv !== '' ? value.apiKeyEnv : 'DEEPSEEK_OFFICIAL_API_KEY')
      // KB-DS-PURE-END
      // KB-DS-ACTIONS-BEGIN
      /** The two DeepSeek cards: [{ ns, provider, name }], from the engine's directory when it has them, else the defaults. */
      const kbDsCardsOf = (ds, dir) => {
        const defaults = { 'llm-deepseek': { provider: 'deepseek-official', name: 'DeepSeek' }, 'llm-deepseek-account': { provider: 'deepseek-account', name: 'DeepSeek Account' } }
        return KB_DS_NS.filter((ns) => ds[ns] !== undefined).map((ns) => {
          const e = (Array.isArray(dir) ? dir : []).filter((x) => x.ns === ns)[0]
          return { ns, provider: e !== undefined && e.provider !== '' ? e.provider : defaults[ns].provider, name: e !== undefined && e.name !== '' ? e.name : defaults[ns].name }
        })
      }
      /** Save a DeepSeek edit: only changed keys are written, against that namespace's own revision; a typed key goes to the
       *  credential store under the profile's reference (official adapter only). */
      const kbDsSave = async (ns, d) => {
        const api = kbMApi()
        if (api === null || api.settings === null) throw new Error(m('kb.models.error.remote'))
        if (KBM.writable !== true) throw new Error(m('kb.models.error.readonly'))
        const view = KBM.ds[ns]
        if (view === undefined) throw new Error(m('kb.models.error.remote'))
        if (d.restoreModels !== true && d.touched === true) {
          const bad = kbDsValidate(d.rows)
          if (bad !== null) throw new Error(m('kb.ds.err.row', { n: bad.index + 1, why: m(bad.key) }))
        }
        if (d.url !== undefined && String(d.url).trim() !== '' && !kbPvUrlOk(d.url)) throw new Error(m('kb.pv.err.url'))
        const next = kbDsEditProfile(view.user, d)
        const ops = kbPvDiffOps([], view.user, next)
        if (ops.length > 0) {
          const resp = await kbMMutateRetry(api, ops, ns)
          await kbMJournal({ niveau: 'settings', route: ns, champ: 'deepseek', op: 'edit', chemin: [ns], ok: resp.ok === true })
          if (resp.ok !== true) throw new Error(kbMErrText(resp))
        }
        let keyOk = null
        if (ns === 'llm-deepseek' && String(d.key || '').trim() !== '') keyOk = await kbPvCredential(api, kbDsKeyRef(view.value), String(d.key).trim())
        await kbMLoad()
        return { changed: ops.length, keyOk }
      }
      /** Is the official adapter's key stored? One `credentials.describe`; a missing dot is better than a failed load. */
      const kbMLoadDsKey = async (api) => {
        const view = KBM.ds['llm-deepseek']
        KBM.dsKey = { ref: view === undefined ? '' : kbDsKeyRef(view.value), configured: null }
        const cr = api.credentials
        if (view === undefined || cr === null || cr === undefined || typeof cr.describe !== 'function') return
        try {
          const r = await kbMTimeout(cr.describe([KBM.dsKey.ref]), 8000)
          const v = r !== null && r !== undefined && r.ok === true && kbDsObj(r.value) ? r.value : {}
          if (kbDsObj(v[KBM.dsKey.ref]) && typeof v[KBM.dsKey.ref].configured === 'boolean') KBM.dsKey.configured = v[KBM.dsKey.ref].configured
        } catch (e) { /* unknown stays unknown */ }
      }
      // KB-DS-ACTIONS-END
      /** A `models[i]`/`modelOverrides.<id>` entry → the panel's control keys.
       *  Only the PRESENT keys appear: that is what makes
       *  an override visible. */
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

      /** A model's external notes: a read of a snapshot held by the host
       *  (two public pages, 24 h disk cache). Best-effort: an unavailable catalogue
       *  never blocks the controls, it leaves the section empty. */
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
          // A newer snapshot than the one the Score column was read from: read the column again.
          if (KBM.scoreAtSeen !== KBM.scoresAt) { KBM.scoreAtSeen = KBM.scoresAt; KBM.scoreLoaded = false }
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
      /** Triggers the read of the two catalogues, in the background. The answer
       *  leaves right away: a ~4 MB scrape never makes the screen wait.
       *  Called by a row's synchronisation, it coalesces — the « Sync N » button
       *  asks for it N times, the network once. */
      /** The headline score of every listed model, in ONE call (the badge, the filter and the sort of the Models tab). Best-effort: a host
       *  without the route, or with no snapshot yet, leaves the column empty. */
      const kbMScoreListLoad = async (force) => {
        if (KBM.live !== true || KBM.models.length === 0) return false
        if (KBM.scoreLoaded === true && force !== true) return false
        KBM.scoreLoaded = true
        try {
          const res = await fetch('/kybernos-models/scores/list', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ models: KBM.models.filter((mo) => mo.route !== '' && mo.id !== '').map((mo) => ({ key: mo.route + '/' + mo.id, name: mo.name })) }),
          })
          const body = await res.json()
          // A host without the route (not restarted) or an unreadable answer: no column, and no new try on every render.
          if (body === null || body.ok !== true || body.scores === null || typeof body.scores !== 'object') return false
          KBM.scoreOf = body.scores
          KBM.scoreAtSeen = body.at === undefined ? null : body.at
          kbmNotify()
          return true
        } catch (e) { return false }
      }
      /** « Load model scores »: the person asks the host to read the two catalogues, we wait for the read to end, then the Score column is
       *  read once more. Without a snapshot the Models tab shows no score at all, so this is the way in (nothing is read before the click). */
      const kbMScoresStart = async () => {
        if (KBM.live !== true || KBM.scoresRunning === true) return false
        const started = await kbMScoresRefresh(true)
        if (started === null) return false
        // The host answers right away and goes on in the background: look at its status until the job is over (two minutes at most).
        for (let i = 0; i < 80; i += 1) {
          await new Promise((r) => setTimeout(r, 1500))
          let st = null
          try { st = await (await fetch('/kybernos-models/scores/status')).json() } catch (e) { st = null }
          if (st !== null && typeof st === 'object' && (st.job === null || st.job === undefined || st.job.running !== true)) break
        }
        KBM.scoresRunning = false
        KBM.scoreLoaded = false
        kbmNotify()
        return kbMScoreListLoad(true)
      }
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

      /** Prefill: the models.dev index of the host half (one fetch for
       *  all, 6 h disk cache). No invention: no match →
       *  no values, and the panel says so. */
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
            // The index being unavailable is NOT « unknown model »: say it right.
            mo.remote = {}
            mo.synced = false
            mo.error = body.error === 'modelsdev-unavailable' ? m('kb.models.error.index') : (m('kb.models.error.reseau') + sep() + String(body.error === undefined ? 'inconnu' : body.error))
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
          mo.error = m('kb.models.error.reseau') + sep() + String(e && e.message ? e.message : e)
          kbmNotify()
          return false
        }
      }
      // ── OUR surface: a NEW menu in Settings ───────────────────────
      // Decision P3b (23/09/2026): the catalogue stops being a tenant of
      // the harness's « Settings → Models » page.
      // Revision of 24/09/2026, on the user's request (« it must be in
      // Settings, a new Menu »): the surface is no longer a sidebar
      // entry, it is a Settings SECTION — the sidebar
      // becomes native again, and the catalogue goes where it is looked for.
      //
      // The seat is `settings.section`, the very one the package
      // `dsh-client-ui-settings-models` occupies (`id: 'models'`, `order: 10`):
      // we take our own id and come after its.
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
      // (02/10) No more « Local models » mount point here: this panel
      // only lives in the dedicated « Ollama local models » section.

      return {
        // `remote` carries the two namespaces used: settings (read and
        // write of llm-pi-ai) and llm (model discovery). The names are
        // those of the native Models page, to write at exactly the same place.
        inject: ['slots', 'remote', 'remote.settings', 'remote.llm', 'remote.credentials', 'locale'],
        apply(ctx) {
          kbCtx = ctx
          const slots = ctx.get('slots')
          if (slots === undefined || slots === null) {
            console.error('[kybernos-models] slots service unavailable: no interface')
            return
          }
          ctx.effect(() => { kbPoseControles(); return styles.insert(CSS) }, 'kybernos-models: styles')
          // The first-run wizard (kybernos-plugin) saves a pasted key through this; it checks the function is there.
          ctx.effect(() => {
            const seam = { saveKey: kbQuickKey, saveCredential: kbQuickCredential, providers: KB_QK_PROVIDERS.slice() }
            try { window.__KB_MODELS__ = seam } catch (e) { /* no window */ }
            return () => { try { if (window.__KB_MODELS__ === seam) delete window.__KB_MODELS__ } catch (e) { /* no window */ } }
          }, 'kybernos-models: wizard seam')
          // Three seats on the native Models page: the Kybernos Cloud card
          // BEFORE the provider list (seat settings.models.header that
          // the harness declares in its Models section), the detailed catalogue
          // in the panel's body, and the order marker in the
          // provider-card seat (one per native row).
          slots.inject('settings.models.header', () => slots.register(
            { name: 'settings.models.header', id: 'kybernos-models', order: -100 },
            Panel))
          // ── the « Kybernos Cloud » row at the head of the native list ──────
          // The provider-card seat is rendered IN every row of the list
          // (key = settings namespace). This component only paints an
          // invisible marker in the really configured kybernos row; the
          // plugin's CSS then lifts that row (`order:-1` on the
          // list, already a flex column). The row stays 100 % native —
          // Edit, Delete, key and model editor — only its DISPLAY position
          // changes: « just before DeepSeek », as requested.
          // Zero DSH core patch.
          slots.inject('settings.models.provider-card', () => slots.register(
            { name: 'settings.models.provider-card', key: 'llm-pi-ai', id: 'kybernos-rowmark', priority: 0 },
            RowMark))
          // ── our own surface: a Settings section ───────────────
          // `settings.section` is declared by `@deepseek-ai/dsh-client-ui-settings`;
          // we inject into it (replayed if the declaration comes back) and register
          // our menu under our own identifier, AFTER the native Models
          // (`order: 10`) so as not to move theirs.
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
          // The same invalidations as the native Models page: a provider,
          // a key or a model added ELSEWHERE (native page, another screen, another
          // session) makes the document read again — without reloading the page. An edit
          // of cordis.patch.yml made OUTSIDE the GUI emits nothing (no watcher
          // in the installed harness, measured on 23/09/2026): that one only shows
          // after a DSH restart.
          ctx.effect(() => {
            const remote = ctx.remote
            const fermer = []
            if (remote !== null && remote !== undefined && typeof remote.$on === 'function') {
              for (const ev of ['settings/document-updated', 'credentials/reference-updated', 'llm/adapters-updated']) {
                try { fermer.push(remote.$on(ev, kbMRefresh)) } catch (e) { /* signal absent: the others remain */ }
              }
            }
            if (typeof ctx.on === 'function') {
              try { fermer.push(ctx.on('connection/reset', kbMRefresh)) } catch (e) { /* same */ }
            }
            return () => {
              if (kbMRefreshTimer !== null) { clearTimeout(kbMRefreshTimer); kbMRefreshTimer = null }
              for (const f of fermer) { try { if (typeof f === 'function') f() } catch (e) { /* already closed */ } }
            }
          }, 'kybernos-models: catalogue invalidations')
        },
      }
    } catch (kbBootError) {
      try { console.error('[kybernos-models] chargement impossible — plugin desactive, GUI preservee', kbBootError) } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin desactive apres erreur de chargement */ } }
    }
  },
})
